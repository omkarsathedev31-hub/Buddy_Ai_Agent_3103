import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { PublicUser, UserRole, UserSettings } from '../shared/types.ts';
import { getDb } from './db.ts';
import { getAdminPasscode, getJwtSecret } from './env.ts';

export const SESSION_COOKIE_NAME = 'buddy_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthenticatedRequest extends Request {
  user?: PublicUser;
  sessionTokenHash?: string;
}

export interface AuthJwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  jti: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const b64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(b64, 'base64');
  } catch {
    return null;
  }
}

export function signAuthJwt(payload: AuthJwtPayload): string {
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(sig)}`;
}

export function verifyAuthJwt(
  token: string
): { valid: true; payload: AuthJwtPayload } | { valid: false; reason: 'expired' | 'invalid' } {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'invalid' };
  }
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) {
    return { valid: false, reason: 'invalid' };
  }

  const headerBuf = base64UrlDecode(headerB64);
  const payloadBuf = base64UrlDecode(payloadB64);
  const sigBuf = base64UrlDecode(sigB64);
  if (!headerBuf || !payloadBuf || !sigBuf) {
    return { valid: false, reason: 'invalid' };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest();
  if (sigBuf.length !== expectedSig.length || !crypto.timingSafeEqual(sigBuf, expectedSig)) {
    return { valid: false, reason: 'invalid' };
  }

  let header: { alg?: unknown; typ?: unknown };
  let payload: Partial<AuthJwtPayload>;
  try {
    header = JSON.parse(headerBuf.toString('utf8')) as { alg?: unknown; typ?: unknown };
    payload = JSON.parse(payloadBuf.toString('utf8')) as Partial<AuthJwtPayload>;
  } catch {
    return { valid: false, reason: 'invalid' };
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return { valid: false, reason: 'invalid' };
  }

  if (
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.email !== 'string' ||
    typeof payload.role !== 'string' ||
    typeof payload.jti !== 'string' ||
    !payload.jti ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    return { valid: false, reason: 'invalid' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) {
    return { valid: false, reason: 'expired' };
  }

  return {
    valid: true,
    payload: payload as AuthJwtPayload,
  };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function pruneExpiredSessions(): void {
  const db = getDb();
  const nowIso = new Date().toISOString();
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(nowIso);
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const db = getDb();
  const userRow = db
    .prepare(`SELECT id, email, role FROM users WHERE id = ? LIMIT 1`)
    .get(userId) as { id: string; email: string; role: UserRole } | undefined;
  if (!userRow) {
    throw new Error('Cannot create session for unknown user.');
  }

  const sessionId = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = Math.floor((now.getTime() + SESSION_TTL_MS) / 1000);
  const expiresAt = new Date(exp * 1000).toISOString();

  const token = signAuthJwt({
    sub: userRow.id,
    email: userRow.email,
    role: userRow.role,
    jti: sessionId,
    iat,
    exp,
  });
  const tokenHash = hashToken(token);

  // Clean up expired sessions opportunistically when issuing a new session
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(nowIso);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, userId, tokenHash, expiresAt, nowIso);
  return { token, expiresAt };
}

export function deleteSessionByHash(tokenHash: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}

export function isHttpsRequest(req: Request): boolean {
  const rawForwardedProto = req.headers['x-forwarded-proto'];
  const protoVal = Array.isArray(rawForwardedProto) ? rawForwardedProto[0] : rawForwardedProto;
  if (typeof protoVal === 'string') {
    const firstProto = protoVal.split(',')[0].trim().toLowerCase();
    if (firstProto === 'https') return true;
    if (firstProto === 'http') return false;
  }
  if (req.secure || req.protocol === 'https') return true;

  const rawForwardedHost = req.headers['x-forwarded-host'];
  const forwardedHost =
    typeof rawForwardedHost === 'string'
      ? rawForwardedHost.split(',')[0]?.trim()
      : Array.isArray(rawForwardedHost)
      ? rawForwardedHost[0]?.split(',')[0]?.trim()
      : undefined;
  const host = forwardedHost || req.headers.host || '';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);

  if (isLocalHost) {
    return false;
  }

  if (typeof req.headers.origin === 'string' && req.headers.origin.startsWith('https://')) return true;
  if (typeof req.headers.referer === 'string' && req.headers.referer.startsWith('https://')) return true;

  if (
    process.env.APP_URL?.startsWith('https://') ||
    Boolean(process.env.RAILWAY_PUBLIC_DOMAIN) ||
    Boolean(process.env.VERCEL)
  ) {
    return true;
  }
  return false;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function parseCookies(cookieHeader: string | string[] | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const joined = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  const result: Record<string, string> = {};
  for (const part of joined.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function isUsableTokenValue(val: string | undefined | null): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return false;
  return true;
}

export function extractSessionCookies(req: Request): string[] {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return [];
  const joined = Array.isArray(cookieHeader) ? cookieHeader.join('; ') : cookieHeader;
  const values: string[] = [];
  const seen = new Set<string>();
  for (const part of joined.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== SESSION_COOKIE_NAME) continue;
    const rawVal = part.slice(idx + 1).trim();
    let decoded = rawVal;
    try {
      decoded = decodeURIComponent(rawVal);
    } catch {
      decoded = rawVal;
    }
    if (isUsableTokenValue(decoded) && !seen.has(decoded)) {
      seen.add(decoded);
      values.push(decoded);
    }
  }
  return values;
}

export interface AuthTokenCandidate {
  token: string;
  source: 'bearer' | 'cookie';
}

export function extractCandidateTokens(req: Request): AuthTokenCandidate[] {
  const candidates: AuthTokenCandidate[] = [];
  const seen = new Set<string>();

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader)) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (isUsableTokenValue(bearer)) {
      seen.add(bearer);
      candidates.push({ token: bearer, source: 'bearer' });
    }
  }

  for (const cookieToken of extractSessionCookies(req)) {
    if (!seen.has(cookieToken)) {
      seen.add(cookieToken);
      candidates.push({ token: cookieToken, source: 'cookie' });
    }
  }

  return candidates;
}

export function extractToken(req: Request): string | null {
  return extractCandidateTokens(req)[0]?.token ?? null;
}

export function hasSessionCookieHeader(req: Request): boolean {
  return extractSessionCookies(req).length > 0;
}

export type SessionValidationResult =
  | {
      status: 'valid';
      user: PublicUser;
      tokenHash: string;
      renewed: boolean;
    }
  | {
      status: 'not_found' | 'expired' | 'inactive';
    };

export function validateSessionToken(token: string): SessionValidationResult {
  const jwtCheck = verifyAuthJwt(token);
  const tokenHash = hashToken(token);
  if (!jwtCheck.valid) {
    if (jwtCheck.reason === 'expired') {
      deleteSessionByHash(tokenHash);
      return { status: 'expired' };
    }
    return { status: 'not_found' };
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.phone, u.role, u.language, u.is_active, u.created_at, s.id as session_id, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | (Omit<PublicUser, 'is_active'> & { is_active: number; session_id: string; expires_at: string })
    | undefined;

  if (!row || row.id !== jwtCheck.payload.sub) {
    return { status: 'not_found' };
  }

  const expiresMs = new Date(row.expires_at).getTime();
  const nowMs = Date.now();
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    deleteSessionByHash(tokenHash);
    return { status: 'expired' };
  }

  if (!row.is_active) {
    return { status: 'inactive' };
  }

  // Sliding expiration: extend session when less than half the 7-day window remains
  let renewed = false;
  if (expiresMs - nowMs < SESSION_TTL_MS / 2) {
    const nextExpiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString();
    db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(nextExpiresAt, row.session_id);
    renewed = true;
  }

  return {
    status: 'valid',
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      role: row.role,
      language: row.language,
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
    },
    tokenHash,
    renewed,
  };
}

export type RequestSessionResolution =
  | {
      status: 'valid';
      user: PublicUser;
      token: string;
      tokenHash: string;
      source: 'bearer' | 'cookie';
      renewed: boolean;
    }
  | {
      status: 'missing' | 'not_found' | 'expired' | 'inactive';
    };

export function resolveSessionForRequest(req: Request): RequestSessionResolution {
  const candidates = extractCandidateTokens(req);
  if (candidates.length === 0) {
    return { status: 'missing' };
  }

  let failureStatus: 'not_found' | 'expired' | 'inactive' = 'not_found';
  for (const candidate of candidates) {
    const validation = validateSessionToken(candidate.token);
    if (validation.status === 'valid') {
      return {
        status: 'valid',
        user: validation.user,
        token: candidate.token,
        tokenHash: validation.tokenHash,
        source: candidate.source,
        renewed: validation.renewed,
      };
    }
    if (validation.status === 'inactive') {
      failureStatus = 'inactive';
    } else if (validation.status === 'expired' && failureStatus === 'not_found') {
      failureStatus = 'expired';
    }
  }

  return { status: failureStatus };
}

export function verifyCsrf(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  // Requests using explicit Authorization Bearer token are immune to cookie CSRF
  if (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')) {
    next();
    return;
  }
  const customHeader = req.headers['x-requested-with'];
  if (customHeader === 'BuddyElderAI') {
    next();
    return;
  }
  const origin = req.headers.origin;
  const rawForwardedHost = req.headers['x-forwarded-host'];
  const forwardedHost =
    typeof rawForwardedHost === 'string'
      ? rawForwardedHost.split(',')[0]?.trim()
      : Array.isArray(rawForwardedHost)
      ? rawForwardedHost[0]?.split(',')[0]?.trim()
      : undefined;
  const host = forwardedHost || req.headers.host;
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      if (parsed.host === host) {
        next();
        return;
      }
    } catch {
      // fall through to 403
    }
  }
  res.status(403).json({ error: 'Invalid request origin or missing security header.' });
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  let resolution: RequestSessionResolution;
  try {
    resolution = resolveSessionForRequest(req);
  } catch (err) {
    console.error('[Buddy Auth DB Error]', {
      endpoint: req.path,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(503).json({
      success: false,
      code: 'DATABASE_ERROR',
      error: 'Unable to verify your session right now. Please try again in a moment.',
    });
    return;
  }

  if (resolution.status === 'missing') {
    res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      error: 'Authentication required. Please sign in.',
    });
    return;
  }

  if (resolution.status !== 'valid') {
    if (hasSessionCookieHeader(req)) {
      clearSessionCookie(req, res);
    }
    if (resolution.status === 'expired') {
      res.status(401).json({
        success: false,
        code: 'SESSION_EXPIRED',
        error: 'Session expired. Please sign in again.',
      });
      return;
    }
    if (resolution.status === 'inactive') {
      res.status(403).json({
        success: false,
        code: 'ACCOUNT_INACTIVE',
        error: 'Account is deactivated. Please contact an administrator.',
      });
      return;
    }
    res.status(401).json({
      success: false,
      code: 'SESSION_NOT_FOUND',
      error: 'Session not found or expired. Please sign in again.',
    });
    return;
  }

  if (resolution.renewed && hasSessionCookieHeader(req)) {
    setSessionCookie(req, res, resolution.token);
  }

  req.user = resolution.user;
  req.sessionTokenHash = resolution.tokenHash;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'You do not have permission to access this resource.' });
      return;
    }
    next();
  };
}

export function ensureDefaultSettings(userId: string): UserSettings {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM user_settings WHERE user_id = ?`).get(userId) as
    | (Omit<UserSettings, 'reduced_motion' | 'voice_enabled' | 'notifications_enabled' | 'onboarding_completed'> & {
        reduced_motion: number;
        voice_enabled: number;
        notifications_enabled: number;
        onboarding_completed: number;
      })
    | undefined;

  if (existing) {
    return {
      ...existing,
      reduced_motion: Boolean(existing.reduced_motion),
      voice_enabled: Boolean(existing.voice_enabled),
      notifications_enabled: Boolean(existing.notifications_enabled),
      onboarding_completed: Boolean(existing.onboarding_completed),
    };
  }

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_settings (
      user_id, text_size, contrast_mode, theme, reduced_motion,
      voice_enabled, voice_speed, voice_name, notifications_enabled,
      onboarding_completed, updated_at
    ) VALUES (?, 'normal', 'standard', 'light', 0, 1, 'normal', NULL, 1, 0, ?)`
  ).run(userId, now);

  return {
    user_id: userId,
    text_size: 'normal',
    contrast_mode: 'standard',
    theme: 'light',
    reduced_motion: false,
    voice_enabled: true,
    voice_speed: 'normal',
    voice_name: null,
    notifications_enabled: true,
    onboarding_completed: false,
    updated_at: now,
  };
}

export function hasAdminConfigured(): {
  hasEnvPasscode: boolean;
  hasClaimedPasscode: boolean;
  hasAdminUser: boolean;
} {
  const db = getDb();
  const hasEnvPasscode = Boolean(getAdminPasscode());
  const claimedRow = db.prepare(`SELECT value FROM system_config WHERE key = 'admin_passcode_hash'`).get() as
    | { value: string }
    | undefined;
  const adminUserRow = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get() as
    | { id: string }
    | undefined;
  return {
    hasEnvPasscode,
    hasClaimedPasscode: Boolean(claimedRow?.value),
    hasAdminUser: Boolean(adminUserRow?.id),
  };
}

export function verifyAdminPasscode(passcode: string): boolean {
  const envPass = getAdminPasscode();
  if (envPass) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPass);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  const db = getDb();
  const claimedRow = db.prepare(`SELECT value FROM system_config WHERE key = 'admin_passcode_hash'`).get() as
    | { value: string }
    | undefined;
  if (!claimedRow?.value) return false;
  return verifyPassword(passcode, claimedRow.value);
}
