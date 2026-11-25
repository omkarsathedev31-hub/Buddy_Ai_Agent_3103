import './env.ts';
import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  PERMISSION_PRESETS,
  type AlertSeverity,
  type CheckinMood,
  type GranularPermissions,
  type MessagingOnboardingStatus,
  type MessagingSetupMode,
  type SharingLevel,
  type SupportedLanguage,
  type UserRole,
} from '../shared/types.ts';
import { analyzeScamContent, AiServiceError, generateBuddyReply, getAiStatus } from './ai.ts';
import { runGeminiDiagnostics } from './ai-diagnostics.ts';
import {
  clearSessionCookie,
  createSession,
  deleteSessionByHash,
  ensureDefaultSettings,
  extractCandidateTokens,
  hasAdminConfigured,
  hasSessionCookieHeader,
  hashPassword,
  hashToken,
  requireAuth,
  requireRole,
  resolveSessionForRequest,
  setSessionCookie,
  verifyAdminPasscode,
  verifyCsrf,
  verifyPassword,
  type AuthenticatedRequest,
  type RequestSessionResolution,
} from './auth.ts';
import { DatabaseConfigError, getDatabaseStatus, getDb } from './db.ts';
import { getRawEnvMessagingNumber, normalizePhoneWithCountryCode } from './env.ts';
import { LESSONS_CATALOG } from './lessons.ts';
import {
  createAlertIfNotDuplicate,
  createNotification,
  getActiveCaregiverLink,
  parsePermissions,
  recordAuditLog,
  recordPermissionHistory,
} from './permissions.ts';

export function createRateLimiter(
  windowMs: number,
  maxRequests: number,
  options: { limiterName?: string; keyByUser?: boolean } = {}
) {
  const hits = new Map<string, number[]>();
  const limiterName = options.limiterName ?? 'api_limiter';
  const keyByUser = options.keyByUser ?? false;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const userId = keyByUser ? (req as AuthenticatedRequest).user?.id : undefined;
    const bucketKey = userId ? `user:${userId}` : `ip:${ip}`;
    const now = Date.now();
    if (hits.size > 1000) {
      for (const [key, timestamps] of hits.entries()) {
        const active = timestamps.filter((ts) => now - ts < windowMs);
        if (active.length === 0) hits.delete(key);
        else hits.set(key, active);
      }
    }
    const list = (hits.get(bucketKey) ?? []).filter((ts) => now - ts < windowMs);
    if (list.length >= maxRequests) {
      const oldestTs = list[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      console.warn('[Buddy Rate Limit]', {
        rateLimitSource: 'express_limiter',
        limiter: limiterName,
        httpStatus: 429,
        retryAfter: retryAfterSeconds,
        endpoint: req.path,
        timestamp: new Date(now).toISOString(),
      });
      res.status(429).json({
        success: false,
        code: 'BACKEND_RATE_LIMIT',
        rateLimitSource: 'express_limiter',
        retryAfterSeconds,
        error: {
          code: 'BACKEND_RATE_LIMIT',
          message: `Buddy is helping many people right now. Please wait ${retryAfterSeconds} seconds before trying again.`,
          retryAfterSeconds,
          rateLimitSource: 'express_limiter',
        },
      });
      return;
    }
    list.push(now);
    hits.set(bucketKey, list);
    next();
  };
}

export interface MessagingConfigStatus {
  configured: boolean;
  number: string | null;
  source: 'env' | 'database' | 'none';
  error: string | null;
}

export function getMessagingConfigStatus(): MessagingConfigStatus {
  const envRaw = getRawEnvMessagingNumber();
  if (envRaw) {
    const check = normalizePhoneWithCountryCode(envRaw);
    if (check.valid) {
      return { configured: true, number: check.e164, source: 'env', error: null };
    }
    return {
      configured: false,
      number: null,
      source: 'env',
      error: `BUDDY_MESSAGING_NUMBER is set in the server environment, but is invalid: ${check.error}`,
    };
  }

  const db = getDb();
  const row = db
    .prepare(`SELECT value FROM system_config WHERE key = 'buddy_messaging_number'`)
    .get() as { value: string } | undefined;
  const dbRaw = row?.value?.trim();
  if (dbRaw) {
    const check = normalizePhoneWithCountryCode(dbRaw);
    if (check.valid) {
      return { configured: true, number: check.e164, source: 'database', error: null };
    }
    return {
      configured: false,
      number: null,
      source: 'database',
      error: `Saved messaging number is invalid: ${check.error}`,
    };
  }

  return {
    configured: false,
    number: null,
    source: 'none',
    error: 'BUDDY_MESSAGING_NUMBER is not configured in the server environment or Admin Console.',
  };
}

export function getConfiguredMessagingNumber(): string | null {
  return getMessagingConfigStatus().number;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[crypto.randomInt(0, chars.length)];
  }
  return `BE-${suffix}`;
}

function normalizeOriginEntry(raw: string): string | null {
  const cleaned = raw.trim().replace(/^["']+|["']+$/g, '').trim();
  if (!cleaned) return null;
  try {
    const withScheme = /^[a-z]+:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function isProjectVercelPreviewOrigin(parsedOrigin: URL): boolean {
  if (parsedOrigin.protocol !== 'https:') return false;
  const host = parsedOrigin.hostname.toLowerCase();
  return /^buddy-ai-agent-31(?:-[a-z0-9-]+)*\.vercel\.app$/.test(host);
}

function matchesScopedWildcardOrigin(originUrl: URL, pattern: string): boolean {
  const cleaned = pattern.trim().replace(/^["']+|["']+$/g, '').replace(/\/+$/, '').toLowerCase();
  const match = cleaned.match(/^(https?):\/\/([^/]+)$/);
  if (!match) return false;
  const [, proto, hostPattern] = match;
  if (originUrl.protocol !== `${proto}:` || !hostPattern.includes('*')) return false;

  // Refuse overly broad wildcards like "*", "*.vercel.app", "*.com"
  const wildcardRemoved = hostPattern.replace(/\*/g, '');
  if (!wildcardRemoved || wildcardRemoved.startsWith('.vercel.app') || wildcardRemoved.split('.').filter(Boolean).length < 3) {
    return false;
  }

  const regexStr =
    '^' +
    hostPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[a-z0-9-]+') +
    '$';
  return new RegExp(regexStr, 'i').test(originUrl.hostname);
}

export function isAllowedCorsOrigin(
  originHeader: string,
  requestHost?: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originHeader.trim());
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    return false;
  }

  if (requestHost && parsedOrigin.host.toLowerCase() === requestHost.toLowerCase()) {
    return true;
  }

  if (isProjectVercelPreviewOrigin(parsedOrigin)) {
    return true;
  }

  const normalizedOrigin = parsedOrigin.origin.toLowerCase();
  const configuredOrigins = new Set<string>();

  for (const single of [
    env.APP_URL,
    env.VERCEL_URL,
    env.VERCEL_BRANCH_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.RAILWAY_PUBLIC_DOMAIN,
    env.RAILWAY_STATIC_URL,
  ]) {
    if (!single) continue;
    const norm = normalizeOriginEntry(single);
    if (norm) configuredOrigins.add(norm);
  }

  if (env.NODE_ENV !== 'production' && !env.VERCEL) {
    for (const devOrigin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4173',
      'http://127.0.0.1:4173',
    ]) {
      configuredOrigins.add(devOrigin);
    }
  }

  const wildcardPatterns: string[] = [];
  for (const rawEntry of (env.ALLOWED_ORIGINS ?? '').split(/[\s,]+/)) {
    const clean = rawEntry.trim();
    if (!clean) continue;
    if (clean.includes('*')) {
      wildcardPatterns.push(clean);
      continue;
    }
    const norm = normalizeOriginEntry(clean);
    if (norm) configuredOrigins.add(norm);
  }

  if (configuredOrigins.has(normalizedOrigin)) {
    return true;
  }

  return wildcardPatterns.some((pattern) => matchesScopedWildcardOrigin(parsedOrigin, pattern));
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Initialize database on startup
  getDb();
  app.locals.buddyMeta = {
    dbMode: getDatabaseStatus().mode,
    aiConfigured: getAiStatus().configured,
    messagingConfigured: getMessagingConfigStatus().configured,
  };

  // Security headers & explicit origin-allowlist CORS (never wildcard * with credentials)
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    const origin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    let originAllowed = false;
    if (origin) {
      res.setHeader('Vary', 'Origin');
      const rawForwardedHost = req.headers['x-forwarded-host'];
      const forwardedHost =
        typeof rawForwardedHost === 'string'
          ? rawForwardedHost.split(',')[0]?.trim()
          : Array.isArray(rawForwardedHost)
          ? rawForwardedHost[0]?.split(',')[0]?.trim()
          : undefined;
      const host = forwardedHost || req.headers.host;
      originAllowed = isAllowedCorsOrigin(origin, host, process.env);
      if (originAllowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    }

    if (req.method === 'OPTIONS') {
      if (origin && !originAllowed) {
        res.status(403).json({
          success: false,
          code: 'CORS_ORIGIN_DENIED',
          error: 'Origin not allowed by CORS policy.',
        });
        return;
      }
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', verifyCsrf);

  const authLimiter = createRateLimiter(60_000, 30, { limiterName: 'auth_limiter', keyByUser: false });
  const chatLimiter = createRateLimiter(60_000, 20, { limiterName: 'chat_limiter', keyByUser: true });
  const scamLimiter = createRateLimiter(60_000, 30, { limiterName: 'scam_limiter', keyByUser: true });

  // Health & Integration Status (reports live DB, AI & messaging readiness without secrets)
  app.get('/api/health', (_req, res) => {
    let dbOk = false;
    try {
      const row = getDb().prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
      dbOk = row?.ok === 1;
    } catch {
      dbOk = false;
    }

    const messaging = getMessagingConfigStatus();
    const dbStatus = getDatabaseStatus();
    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      status: dbOk ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      ai: getAiStatus(),
      messaging: {
        configured: messaging.configured,
        number: messaging.number,
        error: messaging.error,
      },
      database: {
        ...dbStatus,
        ok: dbOk,
      },
      adminSetup: hasAdminConfigured(),
    });
  });

  app.use('/api/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  // Session Inspection
  app.get('/api/auth/session', (req: AuthenticatedRequest, res) => {
    const adminSetup = hasAdminConfigured();
    let resolution: RequestSessionResolution;
    try {
      resolution = resolveSessionForRequest(req);
    } catch (err) {
      console.error('[Buddy Auth Session DB Error]', {
        endpoint: req.path,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(503).json({
        success: false,
        code: 'DATABASE_ERROR',
        error: 'Unable to check your session right now. Please try again in a moment.',
      });
      return;
    }

    if (resolution.status !== 'valid') {
      if (resolution.status !== 'missing' && hasSessionCookieHeader(req)) {
        clearSessionCookie(req, res);
      }
      res.json({
        authenticated: false,
        user: null,
        settings: null,
        adminSetup,
        ...(resolution.status !== 'missing' ? { reason: resolution.status } : {}),
      });
      return;
    }

    if (resolution.renewed && hasSessionCookieHeader(req)) {
      setSessionCookie(req, res, resolution.token);
    }

    const settings = ensureDefaultSettings(resolution.user.id);
    res.json({
      authenticated: true,
      token: resolution.token,
      user: resolution.user,
      settings,
      adminSetup,
    });
  });

  // Register (Senior or Caregiver only)
  app.post('/api/auth/register', authLimiter, (req, res) => {
    const { email, password, name, phone, role, language } = req.body as {
      email?: string;
      password?: string;
      name?: string;
      phone?: string;
      role?: UserRole;
      language?: SupportedLanguage;
    };

    const cleanEmail = email?.trim().toLowerCase();
    const cleanName = name?.trim();
    const selectedRole: UserRole = role === 'caregiver' ? 'caregiver' : 'senior';
    const selectedLang: SupportedLanguage =
      language && ['en', 'hi', 'mr', 'hinglish'].includes(language) ? language : 'en';

    if (!cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Please enter a valid email address.' });
      return;
    }
    if (!cleanName || cleanName.length < 2) {
      res.status(400).json({ error: 'Please enter your full name.' });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      return;
    }

    let cleanPhone: string | null = null;
    if (phone?.trim()) {
      const phoneCheck = normalizePhoneWithCountryCode(phone);
      if (!phoneCheck.valid) {
        res.status(400).json({ error: phoneCheck.error });
        return;
      }
      cleanPhone = phoneCheck.e164;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail) as
      | { id: string }
      | undefined;
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      return;
    }

    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordHash = hashPassword(password);

    db.prepare(
      `INSERT INTO users (id, email, name, phone, role, password_hash, language, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(userId, cleanEmail, cleanName, cleanPhone, selectedRole, passwordHash, selectedLang, now, now);

    const settings = ensureDefaultSettings(userId);
    if (selectedRole === 'senior') {
      db.prepare(
        `INSERT OR IGNORE INTO messaging_onboarding (id, senior_id, setup_mode, senior_phone, status, verified_at, updated_at)
         VALUES (?, ?, 'self', ?, 'not_started', NULL, ?)`
      ).run(crypto.randomUUID(), userId, cleanPhone, now);
    }

    const session = createSession(userId);
    setSessionCookie(req, res, session.token);
    recordAuditLog(userId, 'user.register', 'users', { role: selectedRole });

    res.status(201).json({
      user: {
        id: userId,
        email: cleanEmail,
        name: cleanName,
        phone: cleanPhone,
        role: selectedRole,
        language: selectedLang,
        is_active: true,
        created_at: now,
      },
      settings,
      token: session.token,
    });
  });

  // Login
  app.post('/api/auth/login', authLimiter, (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const db = getDb();
    const row = db
      .prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`)
      .get(cleanEmail) as
      | {
          id: string;
          email: string;
          name: string;
          phone: string | null;
          role: UserRole;
          password_hash: string;
          language: SupportedLanguage;
          is_active: number;
          created_at: string;
        }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    if (!row.is_active) {
      res.status(403).json({ error: 'This account is inactive. Please contact an administrator.' });
      return;
    }

    const settings = ensureDefaultSettings(row.id);
    const session = createSession(row.id);
    setSessionCookie(req, res, session.token);
    recordAuditLog(row.id, 'user.login', 'sessions', { role: row.role });

    res.json({
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
      settings,
      token: session.token,
    });
  });

  // First-Run Admin Claim (only when no env passcode & no claimed passcode yet)
  app.post('/api/auth/admin/claim', authLimiter, (req, res) => {
    const { email, name, passcode } = req.body as { email?: string; name?: string; passcode?: string };
    const status = hasAdminConfigured();
    if (status.hasEnvPasscode || status.hasClaimedPasscode) {
      res.status(403).json({ error: 'Admin access has already been configured. Please use Admin Sign In.' });
      return;
    }
    const cleanEmail = email?.trim().toLowerCase() || 'admin@buddyelder.local';
    const cleanName = name?.trim() || 'Platform Administrator';
    if (!cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Please enter a valid administrator email address.' });
      return;
    }
    if (!passcode || passcode.length < 8) {
      res.status(400).json({ error: 'Admin passcode must be at least 8 characters.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT id, role FROM users WHERE email = ?`).get(cleanEmail) as
      | { id: string; role: UserRole }
      | undefined;
    if (existing && existing.role !== 'admin') {
      res.status(403).json({ error: 'This email is already used by a non-administrator account.' });
      return;
    }

    const now = new Date().toISOString();
    const passHash = hashPassword(passcode);

    db.exec('BEGIN IMMEDIATE;');
    let userId: string;
    try {
      db.prepare(
        `INSERT INTO system_config (key, value, updated_at) VALUES ('admin_passcode_hash', ?, ?)`
      ).run(passHash, now);

      if (existing) {
        userId = existing.id;
        db.prepare(`UPDATE users SET role = 'admin', password_hash = ?, is_active = 1, updated_at = ? WHERE id = ?`).run(
          passHash,
          now,
          userId
        );
      } else {
        userId = crypto.randomUUID();
        db.prepare(
          `INSERT INTO users (id, email, name, phone, role, password_hash, language, is_active, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 'admin', ?, 'en', 1, ?, ?)`
        ).run(userId, cleanEmail, cleanName, passHash, now, now);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const settings = ensureDefaultSettings(userId);
    const session = createSession(userId);
    setSessionCookie(req, res, session.token);
    recordAuditLog(userId, 'admin.claim', 'system_config', { email: cleanEmail });

    const userRow = db
      .prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE id = ?`)
      .get(userId) as {
      id: string;
      email: string;
      name: string;
      phone: string | null;
      role: UserRole;
      language: SupportedLanguage;
      is_active: number;
      created_at: string;
    };

    res.status(201).json({
      user: { ...userRow, is_active: Boolean(userRow.is_active) },
      settings,
      token: session.token,
    });
  });

  // Admin Passcode Sign In
  app.post('/api/auth/admin/login', authLimiter, (req, res) => {
    const adminConfig = hasAdminConfigured();
    if (!adminConfig.hasEnvPasscode && !adminConfig.hasClaimedPasscode) {
      res.status(503).json({
        error:
          'Administrator passcode is not configured on the server (ADMIN_PASSCODE is missing). Set ADMIN_PASSCODE in environment variables or complete first-run setup.',
        code: 'ADMIN_PASSCODE_MISSING',
      });
      return;
    }

    const { passcode, email } = req.body as { passcode?: string; email?: string };
    if (!passcode || !passcode.trim()) {
      res.status(400).json({ error: 'Administrator passcode is required.' });
      return;
    }
    if (!verifyAdminPasscode(passcode)) {
      res.status(401).json({ error: 'Invalid administrator passcode.' });
      return;
    }

    const db = getDb();
    const cleanEmail = email?.trim().toLowerCase();

    type AdminRow = {
      id: string;
      email: string;
      name: string;
      phone: string | null;
      role: UserRole;
      language: SupportedLanguage;
      is_active: number;
      created_at: string;
    };

    let adminRow: AdminRow | undefined;
    if (cleanEmail) {
      const existingByEmail = db
        .prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE email = ? LIMIT 1`)
        .get(cleanEmail) as AdminRow | undefined;
      if (existingByEmail && existingByEmail.role !== 'admin') {
        res.status(403).json({ error: 'This email is registered as a non-administrator account.' });
        return;
      }
      adminRow = existingByEmail;
    } else {
      adminRow = db
        .prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1`)
        .get() as AdminRow | undefined;
      if (!adminRow) {
        const inactiveAdmin = db
          .prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE role = 'admin' LIMIT 1`)
          .get() as AdminRow | undefined;
        if (inactiveAdmin) {
          adminRow = inactiveAdmin;
        }
      }
    }

    if (adminRow && !adminRow.is_active) {
      res.status(403).json({ error: 'This administrator account is inactive. Please contact another administrator.' });
      return;
    }

    if (!adminRow) {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const adminEmail = cleanEmail || 'admin@buddyelder.local';
      db.prepare(
        `INSERT INTO users (id, email, name, phone, role, password_hash, language, is_active, created_at, updated_at)
         VALUES (?, ?, 'Platform Administrator', NULL, 'admin', ?, 'en', 1, ?, ?)`
      ).run(id, adminEmail, hashPassword(passcode), now, now);
      adminRow = {
        id,
        email: adminEmail,
        name: 'Platform Administrator',
        phone: null,
        role: 'admin',
        language: 'en',
        is_active: 1,
        created_at: now,
      };
    }

    const settings = ensureDefaultSettings(adminRow.id);
    const session = createSession(adminRow.id);
    setSessionCookie(req, res, session.token);
    recordAuditLog(adminRow.id, 'admin.login', 'sessions', {});

    res.json({
      user: { ...adminRow, is_active: Boolean(adminRow.is_active) },
      settings,
      token: session.token,
    });
  });

  // Forgot Password & Reset Password
  app.post('/api/auth/forgot-password', authLimiter, (req, res) => {
    const { email } = req.body as { email?: string };
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail) {
      res.status(400).json({ error: 'Please provide your registered email address.' });
      return;
    }

    const db = getDb();
    const user = db.prepare(`SELECT id, is_active FROM users WHERE email = ?`).get(cleanEmail) as
      | { id: string; is_active: number }
      | undefined;

    if (!user || !user.is_active) {
      res.json({
        ok: true,
        message: 'If that email exists, a verification reset code has been prepared.',
      });
      return;
    }

    const resetCode = String(crypto.randomInt(100000, 999999));
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).run(nowIso, user.id);
      db.prepare(
        `INSERT INTO password_resets (id, user_id, code_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      ).run(crypto.randomUUID(), user.id, hashToken(resetCode), expiresAt, nowIso);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const responsePayload: Record<string, unknown> = {
      ok: true,
      message: 'Verification reset code generated. Enter the 6-digit code below to set a new password.',
    };
    if (process.env.NODE_ENV !== 'production') {
      responsePayload.devResetCode = resetCode;
    }
    res.json(responsePayload);
  });

  app.post('/api/auth/reset-password', authLimiter, (req, res) => {
    const { email, code, newPassword } = req.body as {
      email?: string;
      code?: string;
      newPassword?: string;
    };
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail || !code || !newPassword || newPassword.length < 6) {
      res.status(400).json({ error: 'Valid email, 6-digit code, and new password (min 6 chars) are required.' });
      return;
    }

    const db = getDb();
    const user = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail) as
      | { id: string }
      | undefined;
    if (!user) {
      res.status(400).json({ error: 'Invalid reset code or email.' });
      return;
    }

    const codeHash = hashToken(code.trim());
    const resetRow = db
      .prepare(
        `SELECT id, expires_at, used_at FROM password_resets
         WHERE user_id = ? AND code_hash = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(user.id, codeHash) as { id: string; expires_at: string; used_at: string | null } | undefined;

    if (!resetRow || resetRow.used_at || new Date(resetRow.expires_at).getTime() <= Date.now()) {
      res.status(400).json({ error: 'Reset code is invalid or expired.' });
      return;
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
        hashPassword(newPassword),
        now,
        user.id
      );
      db.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).run(now, resetRow.id);
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    recordAuditLog(user.id, 'user.password_reset', 'users', {});

    res.json({ ok: true, message: 'Password updated successfully. Please sign in.' });
  });

  // Logout (idempotent: revokes any presented candidate session tokens and clears cookie)
  app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
    try {
      for (const candidate of extractCandidateTokens(req)) {
        deleteSessionByHash(hashToken(candidate.token));
      }
    } catch {
      // Clear browser cookie even if session cleanup encounters an already-closed/missing row
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Profile & Settings
  app.get('/api/settings', requireAuth, (req: AuthenticatedRequest, res) => {
    const settings = ensureDefaultSettings(req.user!.id);
    res.json({ user: req.user, settings });
  });

  app.put('/api/settings', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const body = req.body as {
      name?: string;
      phone?: string;
      language?: SupportedLanguage;
      text_size?: 'sm' | 'normal' | 'lg' | 'xl';
      contrast_mode?: 'standard' | 'high';
      theme?: 'light' | 'dark';
      reduced_motion?: boolean;
      voice_enabled?: boolean;
      voice_speed?: 'slow' | 'normal' | 'fast';
      voice_name?: string | null;
      notifications_enabled?: boolean;
      onboarding_completed?: boolean;
    };

    const db = getDb();
    const now = new Date().toISOString();
    const currentSettings = ensureDefaultSettings(userId);

    const nextName = body.name?.trim() || req.user!.name;
    let nextPhone = req.user!.phone;
    if (body.phone !== undefined) {
      const trimmedPhone = body.phone.trim();
      if (!trimmedPhone) {
        nextPhone = null;
      } else {
        const phoneCheck = normalizePhoneWithCountryCode(trimmedPhone);
        if (!phoneCheck.valid) {
          res.status(400).json({ error: phoneCheck.error });
          return;
        }
        nextPhone = phoneCheck.e164;
      }
    }
    const nextLang: SupportedLanguage =
      body.language && ['en', 'hi', 'mr', 'hinglish'].includes(body.language)
        ? body.language
        : req.user!.language;

    db.prepare(`UPDATE users SET name = ?, phone = ?, language = ?, updated_at = ? WHERE id = ?`).run(
      nextName,
      nextPhone,
      nextLang,
      now,
      userId
    );

    const nextTextSize =
      body.text_size && ['sm', 'normal', 'lg', 'xl'].includes(body.text_size)
        ? body.text_size
        : currentSettings.text_size;
    const nextContrast =
      body.contrast_mode && ['standard', 'high'].includes(body.contrast_mode)
        ? body.contrast_mode
        : currentSettings.contrast_mode;
    const nextTheme = body.theme && ['light', 'dark'].includes(body.theme) ? body.theme : currentSettings.theme;
    const nextReducedMotion =
      typeof body.reduced_motion === 'boolean' ? body.reduced_motion : currentSettings.reduced_motion;
    const nextVoiceEnabled =
      typeof body.voice_enabled === 'boolean' ? body.voice_enabled : currentSettings.voice_enabled;
    const nextVoiceSpeed =
      body.voice_speed && ['slow', 'normal', 'fast'].includes(body.voice_speed)
        ? body.voice_speed
        : currentSettings.voice_speed;
    const nextVoiceName = body.voice_name !== undefined ? body.voice_name : currentSettings.voice_name;
    const nextNotifications =
      typeof body.notifications_enabled === 'boolean'
        ? body.notifications_enabled
        : currentSettings.notifications_enabled;
    const nextOnboarding =
      typeof body.onboarding_completed === 'boolean'
        ? body.onboarding_completed
        : currentSettings.onboarding_completed;

    db.prepare(
      `UPDATE user_settings SET
        text_size = ?, contrast_mode = ?, theme = ?, reduced_motion = ?,
        voice_enabled = ?, voice_speed = ?, voice_name = ?,
        notifications_enabled = ?, onboarding_completed = ?, updated_at = ?
       WHERE user_id = ?`
    ).run(
      nextTextSize,
      nextContrast,
      nextTheme,
      nextReducedMotion ? 1 : 0,
      nextVoiceEnabled ? 1 : 0,
      nextVoiceSpeed,
      nextVoiceName,
      nextNotifications ? 1 : 0,
      nextOnboarding ? 1 : 0,
      now,
      userId
    );

    const updatedUser = {
      ...req.user!,
      name: nextName,
      phone: nextPhone,
      language: nextLang,
    };
    const updatedSettings = ensureDefaultSettings(userId);
    res.json({ user: updatedUser, settings: updatedSettings });
  });

  // Data Export & Account Deletion
  app.get('/api/account/export', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const db = getDb();
    const exportBundle = {
      exportedAt: new Date().toISOString(),
      user: req.user,
      settings: ensureDefaultSettings(userId),
      emergencyContacts: db.prepare(`SELECT * FROM emergency_contacts WHERE senior_id = ?`).all(userId),
      checkIns: db.prepare(`SELECT * FROM check_ins WHERE senior_id = ? ORDER BY checkin_date DESC`).all(userId),
      lessonProgress: db.prepare(`SELECT * FROM lesson_progress WHERE user_id = ?`).all(userId),
      scamAssessments: db.prepare(`SELECT * FROM scam_assessments WHERE user_id = ?`).all(userId),
      reminders: db.prepare(`SELECT * FROM reminders WHERE senior_id = ?`).all(userId),
      conversations: db
        .prepare(`SELECT id, title, language, created_at FROM conversations WHERE user_id = ?`)
        .all(userId),
    };
    res.json(exportBundle);
  });

  app.delete('/api/account', requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const db = getDb();
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // Emergency Contacts
  app.get('/api/senior/contacts', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const contacts = db
      .prepare(`SELECT * FROM emergency_contacts WHERE senior_id = ? ORDER BY is_primary DESC, created_at ASC`)
      .all(req.user!.id);
    res.json({ contacts });
  });

  app.post('/api/senior/contacts', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const { name, relationship, phone, isPrimary } = req.body as {
      name?: string;
      relationship?: string;
      phone?: string;
      isPrimary?: boolean;
    };
    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ error: 'Contact name and phone number are required.' });
      return;
    }
    const cleanedPhone = phone.trim();
    if (!/^[+\d\s()-]{6,20}$/.test(cleanedPhone)) {
      res.status(400).json({ error: 'Please enter a valid phone number.' });
      return;
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      if (isPrimary) {
        db.prepare(`UPDATE emergency_contacts SET is_primary = 0 WHERE senior_id = ?`).run(req.user!.id);
      }
      db.prepare(
        `INSERT INTO emergency_contacts (id, senior_id, name, relationship, phone, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.user!.id, name.trim(), relationship?.trim() || 'Family', cleanedPhone, isPrimary ? 1 : 0, now);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    const contacts = db
      .prepare(`SELECT * FROM emergency_contacts WHERE senior_id = ? ORDER BY is_primary DESC, created_at ASC`)
      .all(req.user!.id);
    res.status(201).json({ contacts });
  });

  app.delete('/api/senior/contacts/:id', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    db.prepare(`DELETE FROM emergency_contacts WHERE id = ? AND senior_id = ?`).run(
      req.params.id,
      req.user!.id
    );
    res.json({ ok: true });
  });

  // AI Buddy Chat
  app.get('/api/ai/status', requireAuth, (_req, res) => {
    res.json(getAiStatus());
  });

  // Admin-only Gemini diagnostic (auth / model / generation tested separately; never returns the key)
  const diagnoseLimiter = createRateLimiter(60_000, 3, { limiterName: 'ai_diagnose_limiter', keyByUser: true });
  app.get('/api/ai/diagnose', requireAuth, requireRole('admin'), diagnoseLimiter, async (req, res) => {
    try {
      const probeModels = req.query.probe === '1' || req.query.probe === 'true';
      res.json({ success: true, report: await runGeminiDiagnostics({ probeModels }) });
    } catch {
      res.status(500).json({ success: false, code: 'DIAGNOSTIC_FAILED', error: { code: 'DIAGNOSTIC_FAILED', message: 'Diagnostic could not run.' } });
    }
  });

  app.get('/api/ai/conversations', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const conversations = db
      .prepare(`SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`)
      .all(req.user!.id);
    res.json({ conversations });
  });

  app.post('/api/ai/conversations', requireAuth, (req: AuthenticatedRequest, res) => {
    const { title, language } = req.body as { title?: string; language?: SupportedLanguage };
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const lang: SupportedLanguage =
      language && ['en', 'hi', 'mr', 'hinglish'].includes(language) ? language : req.user!.language;
    const convTitle = title?.trim() || 'New Conversation';

    db.prepare(
      `INSERT INTO conversations (id, user_id, title, language, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.user!.id, convTitle, lang, now, now);

    const conversation = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id);
    res.status(201).json({ conversation });
  });

  app.get('/api/ai/conversations/:id/messages', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const conv = db
      .prepare(`SELECT * FROM conversations WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.user!.id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const messages = db
      .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
      .all(req.params.id);
    res.json({ success: true, conversation: conv, messages });
  });

  app.post('/api/ai/conversations/:id/messages', requireAuth, chatLimiter, async (req: AuthenticatedRequest, res) => {
    const startedAt = Date.now();
    const routePath = '/api/ai/conversations/:id/messages';
    const currentModel = getAiStatus().model;
    const convId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}) as {
      message?: unknown;
      language?: SupportedLanguage;
    };
    const { message, language } = body;
    const cleanMsg = typeof message === 'string' ? message.trim() : '';

    if (!convId || convId.length > 128) {
      res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid conversation ID.',
        },
      });
      return;
    }

    if (!cleanMsg) {
      res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        error: {
          code: 'INVALID_INPUT',
          message: 'Please type or speak a question first.',
        },
      });
      return;
    }

    let dbErrorCategory: string | null = null;
    let savedUserMessage:
      | {
          id: string;
          conversation_id: string;
          role: 'user';
          content: string;
          language: SupportedLanguage;
          created_at: string;
        }
      | undefined;

    try {
      const db = getDb();
      let conv: { id: string; title: string; language: SupportedLanguage } | undefined;
      let existingMessages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        language: SupportedLanguage;
        created_at: string;
      }>;

      try {
        conv = db
          .prepare(`SELECT id, title, language FROM conversations WHERE id = ? AND user_id = ?`)
          .get(convId, req.user!.id) as
          | { id: string; title: string; language: SupportedLanguage }
          | undefined;

        if (!conv) {
          res.status(404).json({
            success: false,
            code: 'CONVERSATION_NOT_FOUND',
            error: {
              code: 'CONVERSATION_NOT_FOUND',
              message: 'Conversation not found.',
            },
          });
          return;
        }

        existingMessages = db
          .prepare(`SELECT id, role, content, language, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
          .all(conv.id) as Array<{
          id: string;
          role: 'user' | 'assistant';
          content: string;
          language: SupportedLanguage;
          created_at: string;
        }>;
      } catch (dbErr) {
        dbErrorCategory = 'conversation_read_error';
        throw dbErr;
      }

      const lang: SupportedLanguage =
        language && ['en', 'hi', 'mr', 'hinglish'].includes(language) ? language : req.user!.language;
      const nextTitle =
        conv.title === 'New Conversation' ? cleanMsg.slice(0, 48) + (cleanMsg.length > 48 ? '…' : '') : conv.title;

      // Save the user's question BEFORE attempting the AI request so it is never lost on failure.
      // If the conversation's last message is already the exact same unanswered user question, reuse it
      // rather than inserting a duplicate row on retry.
      const lastExisting = existingMessages[existingMessages.length - 1];
      const isRetryingLastUserTurn =
        Boolean(lastExisting) && lastExisting.role === 'user' && lastExisting.content.trim() === cleanMsg;

      let historyForAi: Array<{ role: 'user' | 'assistant'; content: string }>;
      try {
        if (isRetryingLastUserTurn && lastExisting) {
          savedUserMessage = {
            id: lastExisting.id,
            conversation_id: conv.id,
            role: 'user',
            content: lastExisting.content,
            language: lang,
            created_at: lastExisting.created_at,
          };
          historyForAi = existingMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
        } else {
          const lastMs = lastExisting ? Date.parse(lastExisting.created_at) : 0;
          const nowUser = new Date(Math.max(Date.now(), Number.isFinite(lastMs) ? lastMs + 1 : 0)).toISOString();
          const userMsgId = crypto.randomUUID();
          db.exec('BEGIN IMMEDIATE;');
          try {
            db.prepare(
              `INSERT INTO messages (id, conversation_id, role, content, language, created_at)
               VALUES (?, ?, 'user', ?, ?, ?)`
            ).run(userMsgId, conv.id, cleanMsg, lang, nowUser);

            db.prepare(
              `UPDATE conversations
               SET title = ?, language = ?, last_status = 'pending', last_error_code = NULL, last_error_message = NULL, updated_at = ?
               WHERE id = ?`
            ).run(nextTitle, lang, nowUser, conv.id);
            db.exec('COMMIT;');
          } catch (innerErr) {
            db.exec('ROLLBACK;');
            throw innerErr;
          }
          savedUserMessage = {
            id: userMsgId,
            conversation_id: conv.id,
            role: 'user',
            content: cleanMsg,
            language: lang,
            created_at: nowUser,
          };
          historyForAi = existingMessages.map((m) => ({ role: m.role, content: m.content }));
        }
      } catch (dbErr) {
        dbErrorCategory = 'message_write_error';
        throw dbErr;
      }

      const aiResult = await generateBuddyReply({
        history: historyForAi,
        userMessage: cleanMsg,
        language: lang,
        userName: req.user!.name,
      });

      const userMs = Date.parse(savedUserMessage.created_at);
      const nowBot = new Date(Math.max(Date.now(), (Number.isFinite(userMs) ? userMs : 0) + 1)).toISOString();
      const botMsgId = crypto.randomUUID();

      try {
        db.exec('BEGIN IMMEDIATE;');
        try {
          db.prepare(
            `INSERT INTO messages (id, conversation_id, role, content, language, created_at)
             VALUES (?, ?, 'assistant', ?, ?, ?)`
          ).run(botMsgId, conv.id, aiResult.reply, lang, nowBot);

          db.prepare(
            `UPDATE conversations
             SET title = ?, language = ?, last_status = 'responded', last_error_code = NULL, last_error_message = NULL, updated_at = ?
             WHERE id = ?`
          ).run(nextTitle, lang, nowBot, conv.id);
          db.exec('COMMIT;');
        } catch (innerErr) {
          db.exec('ROLLBACK;');
          throw innerErr;
        }
      } catch (dbErr) {
        dbErrorCategory = 'message_write_error';
        throw dbErr;
      }

      console.info('[Buddy AI Chat]', {
        endpoint: routePath,
        httpStatus: 200,
        model: aiResult.model,
        fallbackUsed: aiResult.fallbackUsed,
        attemptedModels: aiResult.attemptedModels,
        retryCount: aiResult.retryCount,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
        emptyResponse: false,
      });

      res.status(200).json({
        success: true,
        reply: aiResult.reply,
        response: aiResult.reply,
        conversationId: conv.id,
        conversationStatus: 'responded',
        model: aiResult.model,
        fallbackUsed: aiResult.fallbackUsed,
        attemptedModels: aiResult.attemptedModels,
        userMessage: savedUserMessage,
        assistantMessage: {
          id: botMsgId,
          conversation_id: conv.id,
          role: 'assistant',
          content: aiResult.reply,
          language: lang,
          created_at: nowBot,
        },
        suggestions: aiResult.suggestions,
        title: nextTitle,
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (err instanceof AiServiceError) {
        if (savedUserMessage) {
          try {
            getDb()
              .prepare(
                `UPDATE conversations
                 SET last_status = 'failed', last_error_code = ?, last_error_message = ?, updated_at = ?
                 WHERE id = ?`
              )
              .run(err.code, err.message.slice(0, 500), new Date().toISOString(), convId);
          } catch {
            // Never let status persistence override the structured AI error response
          }
        }
        if (err.retryAfterSeconds) {
          res.setHeader('Retry-After', String(err.retryAfterSeconds));
        }
        const isExpectedTransientOrConfig =
          err.code === 'AI_RATE_LIMIT' ||
          err.code === 'AI_QUOTA_EXHAUSTED' ||
          err.code === 'MISSING_API_KEY' ||
          err.code === 'AI_SAFETY_BLOCK' ||
          (err.code === 'UPSTREAM_ERROR' && err.statusCode === 503);
        const logFn = isExpectedTransientOrConfig ? console.warn : console.error;
        logFn('[Buddy AI Chat Notice]', {
          endpoint: routePath,
          rateLimitSource: err.rateLimitSource ?? null,
          httpStatus: err.statusCode,
          errorCategory: err.code,
          geminiErrorCode: err.geminiErrorCode ?? err.upstreamType ?? err.code,
          upstreamStatus: err.upstreamStatus ?? null,
          cause: err.upstreamType ?? null,
          model: err.model ?? currentModel,
          attemptedModels: err.attemptedModels ?? [err.model ?? currentModel],
          fallbackAttempted: err.fallbackAttempted ?? false,
          userMessageSaved: Boolean(savedUserMessage),
          retryAfter: err.retryAfterSeconds ?? null,
          retryCount: err.retryCount ?? 0,
          durationMs,
          timestamp: new Date().toISOString(),
          emptyResponse: err.code === 'AI_EMPTY_RESPONSE',
          dbErrorCategory: null,
        });
        res.status(err.statusCode).json({
          success: false,
          code: err.code,
          model: err.model ?? currentModel,
          ...(savedUserMessage ? { conversationStatus: 'failed' } : {}),
          ...(err.attemptedModels ? { attemptedModels: err.attemptedModels } : {}),
          ...(err.fallbackAttempted !== undefined ? { fallbackAttempted: err.fallbackAttempted } : {}),
          ...(savedUserMessage ? { userMessageSaved: true, userMessage: savedUserMessage } : {}),
          ...(err.rateLimitSource ? { rateLimitSource: err.rateLimitSource } : {}),
          ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
          ...(err.quotaExhausted !== undefined ? { quotaExhausted: err.quotaExhausted } : {}),
          ...(err.upstreamStatus !== undefined ? { upstreamStatus: err.upstreamStatus } : {}),
          ...(err.geminiErrorCode ? { geminiErrorCode: err.geminiErrorCode } : {}),
          error: {
            code: err.code,
            message: err.message,
            ...(err.attemptedModels ? { attemptedModels: err.attemptedModels } : {}),
            ...(err.rateLimitSource ? { rateLimitSource: err.rateLimitSource } : {}),
            ...(err.retryAfterSeconds !== undefined ? { retryAfterSeconds: err.retryAfterSeconds } : {}),
            ...(err.quotaExhausted !== undefined ? { quotaExhausted: err.quotaExhausted } : {}),
          },
        });
        return;
      }

      const category = dbErrorCategory ?? 'unexpected_server_error';
      if (savedUserMessage && !dbErrorCategory) {
        try {
          getDb()
            .prepare(
              `UPDATE conversations
               SET last_status = 'failed', last_error_code = 'AI_SERVICE_ERROR', last_error_message = ?, updated_at = ?
               WHERE id = ?`
            )
            .run('Buddy is temporarily unable to respond. Please try again in a moment.', new Date().toISOString(), convId);
        } catch {
          // ignore
        }
      }
      console.error('[Buddy AI Chat Failure]', {
        route: routePath,
        status: 500,
        errorCategory: category,
        geminiErrorType: null,
        model: currentModel,
        durationMs,
        emptyResponse: false,
        dbErrorCategory,
      });
      res.status(500).json({
        success: false,
        code: 'AI_SERVICE_ERROR',
        ...(savedUserMessage ? { userMessageSaved: true, userMessage: savedUserMessage, conversationStatus: 'failed' } : {}),
        error: {
          code: 'AI_SERVICE_ERROR',
          message:
            dbErrorCategory
              ? 'Unable to save your conversation right now. Please try again in a moment.'
              : 'Buddy is temporarily unable to respond. Please try again in a moment.',
        },
      });
    }
  });

  app.post('/api/ai/conversations/:id/clear', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const conv = db
      .prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.user!.id);
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(req.params.id);
      db.prepare(
        `UPDATE conversations
         SET last_status = 'idle', last_error_code = NULL, last_error_message = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, req.params.id);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
    res.json({ ok: true });
  });

  app.delete('/api/ai/conversations/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    db.prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).run(req.params.id, req.user!.id);
    res.json({ ok: true });
  });

  function parseJsonStringArray(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  // Scam Detection ("Is This Safe?")
  app.get('/api/scam/history', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const db = getDb();
      const assessments = db
        .prepare(`SELECT * FROM scam_assessments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
        .all(req.user!.id) as Array<{
        id: string;
        input_type: string;
        content: string;
        risk_level: 'GREEN' | 'YELLOW' | 'RED';
        explanation: string;
        indicators_json: string;
        actions_json: string;
        source: string;
        created_at: string;
      }>;

      res.json({
        success: true,
        assessments: assessments.map((a) => {
          const indicators = parseJsonStringArray(a.indicators_json);
          const recommendedActions = parseJsonStringArray(a.actions_json);
          return {
            ...a,
            indicators,
            recommendedActions,
            actions: recommendedActions,
          };
        }),
      });
    } catch {
      res.status(500).json({
        success: false,
        code: 'SCAM_HISTORY_ERROR',
        error: { code: 'SCAM_HISTORY_ERROR', message: 'Unable to load safety check history right now.' },
      });
    }
  });

  app.post('/api/scam/analyze', requireAuth, scamLimiter, async (req: AuthenticatedRequest, res) => {
    const startedAt = Date.now();
    const { content, inputType, language } = req.body as {
      content?: unknown;
      inputType?: unknown;
      language?: SupportedLanguage;
    };
    const cleanContent = typeof content === 'string' ? content.trim() : '';
    if (!cleanContent) {
      res.status(400).json({
        success: false,
        code: 'INVALID_INPUT',
        error: {
          code: 'INVALID_INPUT',
          message: 'Please paste a message, link, or phone number to check.',
        },
      });
      return;
    }

    const lang: SupportedLanguage =
      language && ['en', 'hi', 'mr', 'hinglish'].includes(language) ? language : req.user!.language;
    const rawType = typeof inputType === 'string' ? inputType.trim().toLowerCase() : 'message';
    const typeLabel = ['sms', 'whatsapp', 'url', 'phone', 'email', 'message'].includes(rawType)
      ? rawType
      : 'message';

    try {
      const result = await analyzeScamContent({
        content: cleanContent.slice(0, 4000),
        inputType: typeLabel,
        language: lang,
      });

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      let persisted = true;

      try {
        const db = getDb();
        db.prepare(
          `INSERT INTO scam_assessments (
            id, user_id, input_type, content, risk_level, explanation,
            indicators_json, actions_json, source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id,
          req.user!.id,
          typeLabel,
          cleanContent.slice(0, 2000),
          result.riskLevel,
          result.explanation,
          JSON.stringify(result.indicators),
          JSON.stringify(result.recommendedActions),
          result.source,
          now
        );
      } catch (dbErr) {
        persisted = false;
        console.error('[Buddy Scam Check DB Warning]', {
          route: '/api/scam/analyze',
          dbErrorCategory: 'assessment_insert_error',
          message: dbErr instanceof Error ? dbErr.message : 'DB insert failed',
        });
      }

      // Trigger permission-aware alert if YELLOW or RED for a senior
      if (req.user!.role === 'senior' && (result.riskLevel === 'RED' || result.riskLevel === 'YELLOW')) {
        try {
          const dedupeKey = `scam_${hashToken(cleanContent.slice(0, 200))}`;
          createAlertIfNotDuplicate({
            seniorId: req.user!.id,
            type: 'scam_alert',
            severity: result.riskLevel === 'RED' ? 'critical' : 'warning',
            title: result.riskLevel === 'RED' ? 'High-Risk Scam Message Checked' : 'Suspicious Message Checked',
            description: `${req.user!.name} checked a suspicious ${typeLabel} (${result.riskLevel}).`,
            explanation: result.explanation,
            recommendedAction: result.recommendedActions[0] || 'Check in with your family member gently.',
            dedupeKey,
          });
        } catch {
          // Alert dispatch failure must never break returning the safety result
        }
      }

      console.info('[Buddy Scam Check]', {
        route: '/api/scam/analyze',
        status: 200,
        inputType: typeLabel,
        riskLevel: result.riskLevel,
        source: result.source,
        fallbackReason: result.fallbackReason ?? null,
        persisted,
        durationMs: Date.now() - startedAt,
      });

      res.status(200).json({
        success: true,
        id,
        riskLevel: result.riskLevel,
        risk_level: result.riskLevel,
        explanation: result.explanation,
        indicators: result.indicators,
        recommendedActions: result.recommendedActions,
        actions: result.recommendedActions,
        requiresPause: result.requiresPause,
        source: result.source,
        ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
        persisted,
        created_at: now,
        assessment: {
          id,
          input_type: typeLabel,
          risk_level: result.riskLevel,
          riskLevel: result.riskLevel,
          explanation: result.explanation,
          indicators: result.indicators,
          recommendedActions: result.recommendedActions,
          actions: result.recommendedActions,
          requiresPause: result.requiresPause,
          source: result.source,
          ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
          created_at: now,
        },
      });
    } catch (err) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({
          success: false,
          code: err.code,
          error: { code: err.code, message: err.message },
        });
        return;
      }
      console.error('[Buddy Scam Check Error]', {
        route: '/api/scam/analyze',
        durationMs: Date.now() - startedAt,
      });
      res.status(500).json({
        success: false,
        code: 'SCAM_CHECK_FAILED',
        error: {
          code: 'SCAM_CHECK_FAILED',
          message: 'Unable to analyze content right now. Please try again in a moment.',
        },
      });
    }
  });

  app.post('/api/scam/report', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const { content, notes } = req.body as { content?: string; notes?: string };
    if (!content?.trim()) {
      res.status(400).json({ error: 'Please describe or paste the suspicious call/message.' });
      return;
    }

    const dedupeKey = `report_${hashToken(content.trim().slice(0, 150))}`;
    const alertRes = createAlertIfNotDuplicate({
      seniorId: req.user!.id,
      type: 'scam_alert',
      severity: 'critical',
      title: 'Suspicious Call or Message Reported',
      description: `${req.user!.name} requested family review for a suspicious contact.`,
      explanation: notes?.trim() || content.trim().slice(0, 400),
      recommendedAction: 'Call your family member to verify and reassure them.',
      dedupeKey,
    });

    res.status(201).json({ ok: true, alertId: alertRes.id });
  });

  // Audio Reader Document Upload Parser (honest text-format support)
  app.post('/api/reader/parse-upload', requireAuth, (req, res) => {
    const { filename, content } = req.body as { filename?: string; content?: string };
    if (!filename || typeof content !== 'string') {
      res.status(400).json({ error: 'File name and content are required.' });
      return;
    }
    const ext = filename.toLowerCase().split('.').pop() || '';
    if (!['txt', 'md', 'csv', 'json', 'log'].includes(ext)) {
      res.status(400).json({
        error: `Unsupported file format (.${ext}). Please upload plain text (.txt, .md, .csv) or paste the text directly.`,
      });
      return;
    }
    if (!content.trim()) {
      res.status(400).json({ error: 'The uploaded document is empty.' });
      return;
    }
    res.json({ filename, text: content.slice(0, 50_000) });
  });

  // Digital Education Lessons & Progress
  app.get('/api/lessons', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const progressRows = db
      .prepare(`SELECT * FROM lesson_progress WHERE user_id = ?`)
      .all(req.user!.id) as Array<{
      lesson_id: string;
      completed_steps_json: string;
      is_completed: number;
      last_step: number;
      updated_at: string;
    }>;

    const progressMap = new Map(
      progressRows.map((p) => [
        p.lesson_id,
        {
          completedSteps: JSON.parse(p.completed_steps_json) as number[],
          isCompleted: Boolean(p.is_completed),
          lastStep: p.last_step,
          updatedAt: p.updated_at,
        },
      ])
    );

    const lessons = LESSONS_CATALOG.map((lesson) => ({
      ...lesson,
      progress: progressMap.get(lesson.id) ?? {
        completedSteps: [],
        isCompleted: false,
        lastStep: 1,
        updatedAt: null,
      },
    }));

    const completedCount = lessons.filter((l) => l.progress.isCompleted).length;
    res.json({ lessons, completedCount, totalCount: lessons.length });
  });

  app.put('/api/lessons/:lessonId/progress', requireAuth, (req: AuthenticatedRequest, res) => {
    const lesson = LESSONS_CATALOG.find((l) => l.id === req.params.lessonId);
    if (!lesson) {
      res.status(404).json({ error: 'Lesson not found.' });
      return;
    }

    const { completedSteps, lastStep, isCompleted } = req.body as {
      completedSteps?: number[];
      lastStep?: number;
      isCompleted?: boolean;
    };

    const validSteps = Array.isArray(completedSteps)
      ? Array.from(new Set(completedSteps.filter((n) => Number.isInteger(n) && n >= 1)))
      : [];
    const stepPos = Number.isInteger(lastStep) && (lastStep as number) >= 1 ? (lastStep as number) : 1;
    const totalSteps = lesson.steps.en.length;
    const completed = Boolean(isCompleted) || validSteps.length >= totalSteps;

    const db = getDb();
    const now = new Date().toISOString();
    const existing = db
      .prepare(`SELECT id FROM lesson_progress WHERE user_id = ? AND lesson_id = ?`)
      .get(req.user!.id, lesson.id) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE lesson_progress SET completed_steps_json = ?, is_completed = ?, last_step = ?, updated_at = ?
         WHERE id = ?`
      ).run(JSON.stringify(validSteps), completed ? 1 : 0, stepPos, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO lesson_progress (id, user_id, lesson_id, completed_steps_json, is_completed, last_step, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), req.user!.id, lesson.id, JSON.stringify(validSteps), completed ? 1 : 0, stepPos, now);
    }

    res.json({
      lessonId: lesson.id,
      completedSteps: validSteps,
      isCompleted: completed,
      lastStep: stepPos,
      updatedAt: now,
    });
  });

  // Daily Check-in (Senior)
  app.get('/api/checkins', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const checkIns = db
      .prepare(`SELECT * FROM check_ins WHERE senior_id = ? ORDER BY checkin_date DESC LIMIT 30`)
      .all(req.user!.id) as Array<{
      id: string;
      senior_id: string;
      checkin_date: string;
      mood: CheckinMood;
      medication_taken: string | null;
      needs_help: number | null;
      wants_family_call: number | null;
      feels_safe: number | null;
      note: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const formatted = checkIns.map((c) => ({
      ...c,
      needs_help: c.needs_help === null ? null : Boolean(c.needs_help),
      wants_family_call: c.wants_family_call === null ? null : Boolean(c.wants_family_call),
      feels_safe: c.feels_safe === null ? null : Boolean(c.feels_safe),
    }));

    res.json({
      todayCheckIn: formatted.find((c) => c.checkin_date === today) || null,
      history: formatted,
    });
  });

  app.post('/api/checkins', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const { mood, medicationTaken, needsHelp, wantsFamilyCall, feelsSafe, note, date } = req.body as {
      mood?: CheckinMood;
      medicationTaken?: 'yes' | 'no' | 'skipped' | null;
      needsHelp?: boolean | null;
      wantsFamilyCall?: boolean | null;
      feelsSafe?: boolean | null;
      note?: string;
      date?: string;
    };

    if (!mood || !['good', 'okay', 'not_good'].includes(mood)) {
      res.status(400).json({ error: 'Please select how you are feeling today.' });
      return;
    }

    const checkinDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
    const db = getDb();
    const now = new Date().toISOString();

    const existing = db
      .prepare(`SELECT id FROM check_ins WHERE senior_id = ? AND checkin_date = ?`)
      .get(req.user!.id, checkinDate) as { id: string } | undefined;

    const needsHelpInt = needsHelp === null || needsHelp === undefined ? null : needsHelp ? 1 : 0;
    const wantsCallInt = wantsFamilyCall === null || wantsFamilyCall === undefined ? null : wantsFamilyCall ? 1 : 0;
    const feelsSafeInt = feelsSafe === null || feelsSafe === undefined ? null : feelsSafe ? 1 : 0;
    const medVal = medicationTaken ?? null;
    const cleanNote = note?.trim().slice(0, 500) || null;

    let id: string;
    let updated = false;

    if (existing) {
      id = existing.id;
      updated = true;
      db.prepare(
        `UPDATE check_ins SET mood = ?, medication_taken = ?, needs_help = ?, wants_family_call = ?, feels_safe = ?, note = ?, updated_at = ?
         WHERE id = ?`
      ).run(mood, medVal, needsHelpInt, wantsCallInt, feelsSafeInt, cleanNote, now, id);
    } else {
      id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO check_ins (
          id, senior_id, checkin_date, mood, medication_taken,
          needs_help, wants_family_call, feels_safe, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.user!.id, checkinDate, mood, medVal, needsHelpInt, wantsCallInt, feelsSafeInt, cleanNote, now, now);
    }

    // Create permission-aware alerts if senior needs help or doesn't feel safe
    if (feelsSafe === false) {
      createAlertIfNotDuplicate({
        seniorId: req.user!.id,
        type: 'safety_alert',
        severity: 'critical',
        title: 'Safety Check-in Concern',
        description: `${req.user!.name} indicated they do not feel safe in today's check-in.`,
        explanation: cleanNote || 'Senior selected "No" for feeling safe during daily check-in.',
        recommendedAction: 'Call your family member promptly to check in.',
        dedupeKey: `checkin_unsafe_${checkinDate}`,
      });
    } else if (needsHelp === true || mood === 'not_good' || wantsFamilyCall === true) {
      createAlertIfNotDuplicate({
        seniorId: req.user!.id,
        type: 'assistance_request',
        severity: needsHelp === true ? 'warning' : 'informational',
        title: wantsFamilyCall ? 'Family Call Requested' : 'Check-in Needs Attention',
        description: `${req.user!.name} checked in (${mood.replace('_', ' ')})${needsHelp ? ' and asked for help' : ''}.`,
        explanation: cleanNote || 'Reported during daily wellness check-in.',
        recommendedAction: 'Give your family member a friendly call.',
        dedupeKey: `checkin_help_${checkinDate}`,
      });
    }

    res.status(updated ? 200 : 201).json({
      updated,
      checkIn: {
        id,
        senior_id: req.user!.id,
        checkin_date: checkinDate,
        mood,
        medication_taken: medVal,
        needs_help: needsHelp ?? null,
        wants_family_call: wantsFamilyCall ?? null,
        feels_safe: feelsSafe ?? null,
        note: cleanNote,
        updated_at: now,
      },
    });
  });

  // Family Permission Centre (Senior)
  app.get('/api/permissions', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const links = db
      .prepare(
        `SELECT cl.*, u.name as caregiver_name, u.email as caregiver_email, u.phone as caregiver_phone
         FROM caregiver_links cl
         LEFT JOIN users u ON u.id = cl.caregiver_id
         WHERE cl.senior_id = ?
         ORDER BY cl.created_at DESC`
      )
      .all(req.user!.id) as Array<{
      id: string;
      senior_id: string;
      caregiver_id: string | null;
      invite_code: string;
      relationship: string;
      sharing_level: SharingLevel;
      permissions_json: string;
      status: string;
      caregiver_name: string | null;
      caregiver_email: string | null;
      caregiver_phone: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const requests = db
      .prepare(
        `SELECT pr.*, u.name as caregiver_name, u.email as caregiver_email
         FROM permission_requests pr
         JOIN users u ON u.id = pr.caregiver_id
         WHERE pr.senior_id = ?
         ORDER BY pr.created_at DESC`
      )
      .all(req.user!.id) as Array<{
      id: string;
      link_id: string;
      requested_level: SharingLevel;
      requested_permissions_json: string;
      reason: string;
      status: string;
      caregiver_name: string;
      caregiver_email: string;
      created_at: string;
      reviewed_at: string | null;
    }>;

    const history = db
      .prepare(
        `SELECT ph.*, u.name as actor_name
         FROM permission_history ph
         JOIN users u ON u.id = ph.actor_id
         WHERE ph.senior_id = ?
         ORDER BY ph.created_at DESC LIMIT 25`
      )
      .all(req.user!.id);

    res.json({
      links: links.map((l) => ({
        ...l,
        permissions: parsePermissions(l.permissions_json, l.sharing_level),
      })),
      requests: requests.map((r) => ({
        ...r,
        requestedPermissions: JSON.parse(r.requested_permissions_json),
      })),
      history,
    });
  });

  app.post('/api/permissions/invite', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const { relationship, sharingLevel } = req.body as {
      relationship?: string;
      sharingLevel?: SharingLevel;
    };
    const level: SharingLevel =
      sharingLevel && ['minimal', 'balanced', 'full'].includes(sharingLevel) ? sharingLevel : 'balanced';
    const perms = PERMISSION_PRESETS[level];

    const db = getDb();
    const id = crypto.randomUUID();
    const inviteCode = generateInviteCode();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO caregiver_links (
        id, senior_id, caregiver_id, invite_code, relationship,
        sharing_level, permissions_json, status, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(id, req.user!.id, inviteCode, relationship?.trim() || 'Family Member', level, JSON.stringify(perms), now, now);

    recordPermissionHistory(req.user!.id, req.user!.id, id, 'invite.created', {
      relationship: relationship?.trim() || 'Family Member',
      sharingLevel: level,
    });

    res.status(201).json({
      id,
      inviteCode,
      sharingLevel: level,
      permissions: perms,
    });
  });

  app.put('/api/permissions/links/:linkId', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const link = db
      .prepare(`SELECT * FROM caregiver_links WHERE id = ? AND senior_id = ?`)
      .get(req.params.linkId, req.user!.id) as
      | { id: string; caregiver_id: string | null; sharing_level: SharingLevel; permissions_json: string; status: string }
      | undefined;

    if (!link) {
      res.status(404).json({ error: 'Family member link not found.' });
      return;
    }

    const { sharingLevel, permissions } = req.body as {
      sharingLevel?: SharingLevel;
      permissions?: Partial<GranularPermissions>;
    };

    const nextLevel: SharingLevel =
      sharingLevel && ['minimal', 'balanced', 'full'].includes(sharingLevel) ? sharingLevel : link.sharing_level;
    const basePerms = sharingLevel ? { ...PERMISSION_PRESETS[nextLevel] } : parsePermissions(link.permissions_json, nextLevel);
    const nextPerms: GranularPermissions = parsePermissions(
      JSON.stringify({
        ...basePerms,
        ...(permissions && typeof permissions === 'object' ? permissions : {}),
      }),
      nextLevel
    );

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE caregiver_links SET sharing_level = ?, permissions_json = ?, updated_at = ? WHERE id = ?`
    ).run(nextLevel, JSON.stringify(nextPerms), now, link.id);

    recordPermissionHistory(req.user!.id, req.user!.id, link.id, 'permissions.updated', {
      sharingLevel: nextLevel,
      permissions: nextPerms,
    });
    if (link.caregiver_id) {
      createNotification(
        link.caregiver_id,
        'permission_update',
        'Sharing Preferences Updated',
        `${req.user!.name} updated family sharing to ${nextLevel}.`
      );
    }

    res.json({ id: link.id, sharingLevel: nextLevel, permissions: nextPerms });
  });

  app.post('/api/permissions/links/:linkId/revoke', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const link = db
      .prepare(`SELECT * FROM caregiver_links WHERE id = ? AND senior_id = ?`)
      .get(req.params.linkId, req.user!.id) as { id: string; caregiver_id: string | null } | undefined;

    if (!link) {
      res.status(404).json({ error: 'Family member link not found.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE caregiver_links SET status = 'revoked', updated_at = ? WHERE id = ?`).run(now, link.id);
    recordPermissionHistory(req.user!.id, req.user!.id, link.id, 'access.revoked', {});
    if (link.caregiver_id) {
      createNotification(
        link.caregiver_id,
        'permission_revoked',
        'Family Access Revoked',
        `${req.user!.name} revoked sharing access.`
      );
    }
    res.json({ ok: true });
  });

  app.post('/api/permissions/requests/:requestId/respond', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const { decision } = req.body as { decision?: 'approved' | 'rejected' };
    if (decision !== 'approved' && decision !== 'rejected') {
      res.status(400).json({ error: 'Decision must be approved or rejected.' });
      return;
    }

    const db = getDb();
    const pr = db
      .prepare(`SELECT * FROM permission_requests WHERE id = ? AND senior_id = ?`)
      .get(req.params.requestId, req.user!.id) as
      | {
          id: string;
          link_id: string;
          caregiver_id: string;
          requested_level: SharingLevel;
          requested_permissions_json: string;
          status: string;
        }
      | undefined;

    if (!pr || pr.status !== 'pending') {
      res.status(404).json({ error: 'Pending sharing request not found.' });
      return;
    }

    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.prepare(`UPDATE permission_requests SET status = ?, reviewed_at = ? WHERE id = ?`).run(decision, now, pr.id);

      if (decision === 'approved') {
        const nextPerms = parsePermissions(pr.requested_permissions_json, pr.requested_level);
        db.prepare(
          `UPDATE caregiver_links SET sharing_level = ?, permissions_json = ?, updated_at = ? WHERE id = ?`
        ).run(pr.requested_level, JSON.stringify(nextPerms), now, pr.link_id);
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    recordPermissionHistory(req.user!.id, req.user!.id, pr.link_id, `request.${decision}`, {
      requestedLevel: pr.requested_level,
    });
    createNotification(
      pr.caregiver_id,
      'permission_request',
      `Sharing Request ${decision === 'approved' ? 'Approved' : 'Declined'}`,
      `${req.user!.name} ${decision} your request for ${pr.requested_level} sharing.`
    );

    res.json({ ok: true, status: decision });
  });

  // Senior Messaging Onboarding (Strict senior-owned phone rule)
  app.get('/api/messaging/onboarding', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const msgConfig = getMessagingConfigStatus();
    let row = db
      .prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`)
      .get(req.user!.id) as
      | {
          id: string;
          senior_id: string;
          setup_mode: MessagingSetupMode;
          senior_phone: string | null;
          status: MessagingOnboardingStatus;
          verified_at: string | null;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO messaging_onboarding (id, senior_id, setup_mode, senior_phone, status, verified_at, updated_at)
         VALUES (?, ?, 'self', ?, 'not_started', NULL, ?)`
      ).run(id, req.user!.id, req.user!.phone, now);
      row = {
        id,
        senior_id: req.user!.id,
        setup_mode: 'self',
        senior_phone: req.user!.phone,
        status: 'not_started',
        verified_at: null,
        updated_at: now,
      };
    }

    res.json({
      configured: msgConfig.configured,
      messagingNumber: msgConfig.number,
      configError: msgConfig.error,
      source: msgConfig.source,
      onboarding: row,
      cliAvailable: true,
    });
  });

  app.put('/api/messaging/onboarding', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const { setupMode, seniorPhone, status } = req.body as {
      setupMode?: MessagingSetupMode;
      seniorPhone?: string;
      status?: MessagingOnboardingStatus;
    };

    // Browser cannot spoof backend_verified!
    const allowedUserStatuses: MessagingOnboardingStatus[] = [
      'not_started',
      'instructions_viewed',
      'ready_to_send',
      'user_confirmed',
    ];
    if (status === 'backend_verified') {
      res.status(403).json({
        error: 'Backend verification can only be completed when the messaging backend receives HELLO from the senior phone.',
      });
      return;
    }

    const msgConfig = getMessagingConfigStatus();
    if (status === 'user_confirmed' && !msgConfig.configured) {
      res.status(503).json({
        error: msgConfig.error || 'BUDDY_MESSAGING_NUMBER is not configured yet.',
        code: 'MESSAGING_NUMBER_MISSING',
      });
      return;
    }

    let normalizedPhone: string | null | undefined;
    if (seniorPhone !== undefined) {
      const trimmedPhone = seniorPhone.trim();
      if (!trimmedPhone) {
        normalizedPhone = null;
      } else {
        const phoneCheck = normalizePhoneWithCountryCode(trimmedPhone);
        if (!phoneCheck.valid) {
          res.status(400).json({ error: phoneCheck.error });
          return;
        }
        normalizedPhone = phoneCheck.e164;
      }
    }

    const db = getDb();
    const existing = db
      .prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`)
      .get(req.user!.id) as
      | {
          id: string;
          setup_mode: MessagingSetupMode;
          senior_phone: string | null;
          status: MessagingOnboardingStatus;
          verified_at: string | null;
        }
      | undefined;

    const nextMode: MessagingSetupMode =
      setupMode && ['self', 'caregiver_assisted'].includes(setupMode)
        ? setupMode
        : existing?.setup_mode || 'self';
    const nextPhone = normalizedPhone !== undefined ? normalizedPhone : existing?.senior_phone || req.user!.phone;
    const nextStatus: MessagingOnboardingStatus =
      status && allowedUserStatuses.includes(status)
        ? status
        : existing?.status || 'not_started';

    const now = new Date().toISOString();
    if (existing) {
      db.prepare(
        `UPDATE messaging_onboarding SET setup_mode = ?, senior_phone = ?, status = ?, updated_at = ? WHERE senior_id = ?`
      ).run(nextMode, nextPhone, nextStatus, now, req.user!.id);
    } else {
      db.prepare(
        `INSERT INTO messaging_onboarding (id, senior_id, setup_mode, senior_phone, status, verified_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      ).run(crypto.randomUUID(), req.user!.id, nextMode, nextPhone, nextStatus, now);
    }

    recordAuditLog(req.user!.id, 'messaging.onboarding_update', 'messaging_onboarding', {
      setupMode: nextMode,
      status: nextStatus,
    });

    const updated = db.prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`).get(req.user!.id);
    res.json({ onboarding: updated });
  });

  app.post('/api/messaging/onboarding/disconnect', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE messaging_onboarding SET status = 'not_started', verified_at = NULL, updated_at = ? WHERE senior_id = ?`
    ).run(now, req.user!.id);
    recordAuditLog(req.user!.id, 'messaging.disconnect', 'messaging_onboarding', {});
    const updated = db.prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`).get(req.user!.id);
    res.json({ onboarding: updated });
  });

  // Reminders (Senior & Authorized Caregiver)
  app.get('/api/reminders', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    if (req.user!.role === 'senior') {
      const reminders = db
        .prepare(
          `SELECT r.*, u.name as created_by_name FROM reminders r
           JOIN users u ON u.id = r.created_by
           WHERE r.senior_id = ? ORDER BY r.scheduled_for ASC`
        )
        .all(req.user!.id);
      res.json({ reminders });
      return;
    }

    if (req.user!.role === 'caregiver') {
      const seniorId = req.query.seniorId as string | undefined;
      if (!seniorId) {
        const links = db
          .prepare(`SELECT * FROM caregiver_links WHERE caregiver_id = ? AND status = 'active'`)
          .all(req.user!.id) as Array<{ senior_id: string; sharing_level: SharingLevel; permissions_json: string }>;
        const permittedSeniorIds = links
          .filter((l) => parsePermissions(l.permissions_json, l.sharing_level).reminder_status)
          .map((l) => l.senior_id);
        if (permittedSeniorIds.length === 0) {
          res.json({ reminders: [] });
          return;
        }
        const placeholders = permittedSeniorIds.map(() => '?').join(',');
        const reminders = db
          .prepare(
            `SELECT r.*, u.name as senior_name FROM reminders r
             JOIN users u ON u.id = r.senior_id
             WHERE r.senior_id IN (${placeholders}) ORDER BY r.scheduled_for ASC`
          )
          .all(...permittedSeniorIds);
        res.json({ reminders });
        return;
      }

      const active = getActiveCaregiverLink(req.user!.id, seniorId);
      if (!active || !active.permissions.reminder_status) {
        res.status(403).json({ error: 'Not authorized to view reminders for this senior.' });
        return;
      }
      const reminders = db
        .prepare(`SELECT * FROM reminders WHERE senior_id = ? ORDER BY scheduled_for ASC`)
        .all(seniorId);
      res.json({ reminders });
      return;
    }

    const reminders = db.prepare(`SELECT * FROM reminders ORDER BY scheduled_for DESC LIMIT 100`).all();
    res.json({ reminders });
  });

  app.post('/api/reminders', requireAuth, (req: AuthenticatedRequest, res) => {
    const { seniorId, category, title, message, scheduledFor, voiceEnabled } = req.body as {
      seniorId?: string;
      category?: string;
      title?: string;
      message?: string;
      scheduledFor?: string;
      voiceEnabled?: boolean;
    };

    const targetSeniorId = req.user!.role === 'senior' ? req.user!.id : seniorId;
    if (!targetSeniorId || !title?.trim() || !scheduledFor) {
      res.status(400).json({ error: 'Reminder title, schedule time, and senior target are required.' });
      return;
    }

    if (req.user!.role === 'caregiver') {
      const active = getActiveCaregiverLink(req.user!.id, targetSeniorId);
      if (!active || !active.permissions.reminder_status) {
        res.status(403).json({ error: 'You do not have reminder permission for this senior.' });
        return;
      }
    } else if (req.user!.role !== 'senior') {
      res.status(403).json({ error: 'Only seniors or authorized caregivers can create reminders.' });
      return;
    }

    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO reminders (
        id, senior_id, created_by, category, title, message,
        scheduled_for, voice_enabled, delivery_status, retry_count, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0, NULL, ?, ?)`
    ).run(
      id,
      targetSeniorId,
      req.user!.id,
      category?.trim() || 'custom',
      title.trim(),
      message?.trim() || title.trim(),
      scheduledFor,
      voiceEnabled === false ? 0 : 1,
      now,
      now
    );

    createNotification(
      targetSeniorId,
      'reminder',
      `New Reminder: ${title.trim()}`,
      `Scheduled for ${new Date(scheduledFor).toLocaleString()}`
    );

    const reminder = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id);
    res.status(201).json({ reminder });
  });

  app.post('/api/reminders/:id/acknowledge', requireAuth, requireRole('senior'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const reminder = db
      .prepare(`SELECT * FROM reminders WHERE id = ? AND senior_id = ?`)
      .get(req.params.id, req.user!.id);
    if (!reminder) {
      res.status(404).json({ error: 'Reminder not found.' });
      return;
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE reminders SET delivery_status = 'acknowledged', updated_at = ? WHERE id = ?`).run(
      now,
      req.params.id
    );
    res.json({ ok: true, delivery_status: 'acknowledged' });
  });

  app.post('/api/reminders/:id/deliver', requireAuth, (req: AuthenticatedRequest, res) => {
    const { simulateFailure } = req.body as { simulateFailure?: boolean };
    const db = getDb();
    const reminder = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id) as
      | { id: string; senior_id: string; title: string; message: string; retry_count: number }
      | undefined;
    if (!reminder) {
      res.status(404).json({ error: 'Reminder not found.' });
      return;
    }

    if (req.user!.role === 'caregiver') {
      const active = getActiveCaregiverLink(req.user!.id, reminder.senior_id);
      if (!active || !active.permissions.reminder_status) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    } else if (req.user!.role === 'senior' && reminder.senior_id !== req.user!.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const now = new Date().toISOString();
    if (simulateFailure) {
      db.prepare(
        `UPDATE reminders SET delivery_status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ? WHERE id = ?`
      ).run('Delivery channel unavailable. Please retry.', now, reminder.id);
      const updated = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(reminder.id);
      res.json({ reminder: updated });
      return;
    }

    db.prepare(
      `UPDATE reminders SET delivery_status = 'sent', last_error = NULL, updated_at = ? WHERE id = ?`
    ).run(now, reminder.id);
    createNotification(reminder.senior_id, 'reminder', `Reminder: ${reminder.title}`, reminder.message);

    const updated = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(reminder.id);
    res.json({ reminder: updated });
  });

  // Caregiver Portal
  app.post('/api/caregiver/link', requireAuth, requireRole('caregiver'), (req: AuthenticatedRequest, res) => {
    const { inviteCode } = req.body as { inviteCode?: string };
    const cleanCode = inviteCode?.trim().toUpperCase();
    if (!cleanCode) {
      res.status(400).json({ error: 'Please enter the family invite code.' });
      return;
    }

    const db = getDb();
    const link = db
      .prepare(`SELECT * FROM caregiver_links WHERE invite_code = ? AND status = 'pending'`)
      .get(cleanCode) as { id: string; senior_id: string; sharing_level: SharingLevel } | undefined;

    if (!link) {
      res.status(404).json({ error: 'Invite code is invalid or has already been used.' });
      return;
    }

    const existingActive = db
      .prepare(`SELECT id FROM caregiver_links WHERE senior_id = ? AND caregiver_id = ? AND status = 'active'`)
      .get(link.senior_id, req.user!.id);
    if (existingActive) {
      res.status(409).json({ error: 'You are already linked to this senior.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE caregiver_links SET caregiver_id = ?, status = 'active', updated_at = ? WHERE id = ?`
    ).run(req.user!.id, now, link.id);

    recordPermissionHistory(link.senior_id, req.user!.id, link.id, 'caregiver.linked', {
      caregiverEmail: req.user!.email,
    });
    createNotification(
      link.senior_id,
      'family_linked',
      'Family Member Linked',
      `${req.user!.name} connected using your invite code.`
    );

    res.json({ ok: true, linkId: link.id, seniorId: link.senior_id });
  });

  app.get('/api/caregiver/dashboard', requireAuth, requireRole('caregiver'), (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const links = db
      .prepare(
        `SELECT cl.*, u.name as senior_name, u.phone as senior_phone, u.language as senior_language
         FROM caregiver_links cl
         JOIN users u ON u.id = cl.senior_id
         WHERE cl.caregiver_id = ? AND cl.status = 'active'
         ORDER BY cl.updated_at DESC`
      )
      .all(req.user!.id) as Array<{
      id: string;
      senior_id: string;
      relationship: string;
      sharing_level: SharingLevel;
      permissions_json: string;
      senior_name: string;
      senior_phone: string | null;
      senior_language: SupportedLanguage;
    }>;

    const seniors = links.map((link) => {
      const perms = parsePermissions(link.permissions_json, link.sharing_level);

      // Check-ins filtered strictly by permissions
      let latestCheckIn: Record<string, unknown> | null = null;
      let wellnessSummary: Record<string, unknown> | null = null;

      if (perms.checkin_status || perms.checkin_responses || perms.wellness_summaries) {
        const recentCheckins = db
          .prepare(`SELECT * FROM check_ins WHERE senior_id = ? ORDER BY checkin_date DESC LIMIT 14`)
          .all(link.senior_id) as Array<{
          id: string;
          checkin_date: string;
          mood: CheckinMood;
          medication_taken: string | null;
          needs_help: number | null;
          wants_family_call: number | null;
          feels_safe: number | null;
          note: string | null;
          updated_at: string;
        }>;

        if (recentCheckins.length > 0 && (perms.checkin_status || perms.checkin_responses)) {
          const latest = recentCheckins[0];
          latestCheckIn = {
            checkin_date: latest.checkin_date,
            updated_at: latest.updated_at,
            completed: true,
            ...(perms.checkin_responses
              ? {
                  mood: latest.mood,
                  medication_taken: latest.medication_taken,
                  needs_help: latest.needs_help === null ? null : Boolean(latest.needs_help),
                  wants_family_call: latest.wants_family_call === null ? null : Boolean(latest.wants_family_call),
                  feels_safe: latest.feels_safe === null ? null : Boolean(latest.feels_safe),
                  note: latest.note,
                }
              : {}),
          };
        }

        if (perms.wellness_summaries) {
          const last7 = recentCheckins.slice(0, 7);
          const moodCounts = { good: 0, okay: 0, not_good: 0 };
          for (const item of last7) {
            moodCounts[item.mood]++;
          }
          wellnessSummary = {
            checkInsLast7Days: last7.length,
            completionRatePercent: Math.round((last7.length / 7) * 100),
            moodCounts,
            history: perms.checkin_responses
              ? last7.map((c) => ({
                  checkin_date: c.checkin_date,
                  mood: c.mood,
                  medication_taken: c.medication_taken,
                }))
              : [],
          };
        }
      }

      // Alerts filtered strictly by safety_alerts / scam_alerts permissions
      const allAlerts = db
        .prepare(`SELECT * FROM alerts WHERE senior_id = ? ORDER BY created_at DESC LIMIT 30`)
        .all(link.senior_id) as Array<{
        id: string;
        type: string;
        severity: AlertSeverity;
        title: string;
        description: string;
        explanation: string;
        recommended_action: string;
        is_read: number;
        status: string;
        created_at: string;
      }>;

      const alerts = allAlerts.filter((a) => {
        if (a.type === 'scam_alert') return perms.scam_alerts;
        return perms.safety_alerts;
      });

      const reminders = perms.reminder_status
        ? db.prepare(`SELECT * FROM reminders WHERE senior_id = ? ORDER BY scheduled_for ASC`).all(link.senior_id)
        : [];

      let activitySummary: Record<string, unknown> | null = null;
      if (perms.activity_summaries) {
        const lessonsDone = (
          db
            .prepare(`SELECT COUNT(*) as cnt FROM lesson_progress WHERE user_id = ? AND is_completed = 1`)
            .get(link.senior_id) as { cnt: number }
        ).cnt;
        const scamChecks = (
          db
            .prepare(`SELECT COUNT(*) as cnt FROM scam_assessments WHERE user_id = ?`)
            .get(link.senior_id) as { cnt: number }
        ).cnt;
        activitySummary = { lessonsCompleted: lessonsDone, totalLessons: LESSONS_CATALOG.length, scamChecksCount: scamChecks };
      }

      // Never share private AI conversation transcripts; only count/high-level topic title if ai_summaries is enabled
      let aiSummary: Record<string, unknown> | null = null;
      if (perms.ai_summaries) {
        const convCount = (
          db.prepare(`SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ?`).get(link.senior_id) as { cnt: number }
        ).cnt;
        aiSummary = {
          conversationCount: convCount,
          note: 'Private chat messages remain confidential to the senior.',
        };
      }

      const pendingRequests = db
        .prepare(`SELECT * FROM permission_requests WHERE link_id = ? ORDER BY created_at DESC LIMIT 5`)
        .all(link.id);

      return {
        linkId: link.id,
        seniorId: link.senior_id,
        seniorName: link.senior_name,
        seniorLanguage: link.senior_language,
        relationship: link.relationship,
        sharingLevel: link.sharing_level,
        permissions: perms,
        seniorPhone: perms.contact_info ? link.senior_phone : null,
        latestCheckIn,
        wellnessSummary,
        alerts,
        reminders,
        activitySummary,
        aiSummary,
        pendingRequests,
      };
    });

    res.json({ seniors });
  });

  app.post('/api/caregiver/alerts/:alertId/status', requireAuth, requireRole('caregiver'), (req: AuthenticatedRequest, res) => {
    const { status } = req.body as { status?: 'reviewed' | 'resolved' };
    if (status !== 'reviewed' && status !== 'resolved') {
      res.status(400).json({ error: 'Status must be reviewed or resolved.' });
      return;
    }

    const db = getDb();
    const alert = db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(req.params.alertId) as
      | { id: string; senior_id: string; type: string }
      | undefined;
    if (!alert) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }

    const active = getActiveCaregiverLink(req.user!.id, alert.senior_id);
    const allowed =
      active &&
      ((alert.type === 'scam_alert' && active.permissions.scam_alerts) ||
        (alert.type !== 'scam_alert' && active.permissions.safety_alerts));

    if (!allowed) {
      res.status(403).json({ error: 'Not authorized to manage this alert.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE alerts SET status = ?, is_read = 1, reviewed_by = ?, updated_at = ? WHERE id = ?`).run(
      status,
      req.user!.id,
      now,
      alert.id
    );
    res.json({ ok: true, status });
  });

  app.post('/api/caregiver/permission-requests', requireAuth, requireRole('caregiver'), (req: AuthenticatedRequest, res) => {
    const { linkId, requestedLevel, requestedPermissions, reason } = req.body as {
      linkId?: string;
      requestedLevel?: SharingLevel;
      requestedPermissions?: Partial<GranularPermissions>;
      reason?: string;
    };

    if (!linkId || !requestedLevel || !['minimal', 'balanced', 'full'].includes(requestedLevel) || !reason?.trim()) {
      res.status(400).json({ error: 'Link ID, requested sharing level, and reason are required.' });
      return;
    }

    const db = getDb();
    const link = db
      .prepare(`SELECT * FROM caregiver_links WHERE id = ? AND caregiver_id = ? AND status = 'active'`)
      .get(linkId, req.user!.id) as { id: string; senior_id: string } | undefined;

    if (!link) {
      res.status(403).json({ error: 'Active link to this senior not found.' });
      return;
    }

    const mergedPerms = parsePermissions(
      JSON.stringify({
        ...PERMISSION_PRESETS[requestedLevel],
        ...(requestedPermissions && typeof requestedPermissions === 'object' ? requestedPermissions : {}),
      }),
      requestedLevel
    );
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO permission_requests (
        id, link_id, senior_id, caregiver_id, requested_level,
        requested_permissions_json, reason, status, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`
    ).run(id, link.id, link.senior_id, req.user!.id, requestedLevel, JSON.stringify(mergedPerms), reason.trim(), now);

    createNotification(
      link.senior_id,
      'permission_request',
      'Family Sharing Request',
      `${req.user!.name} requested ${requestedLevel} sharing access: "${reason.trim()}"`
    );

    res.status(201).json({ id, status: 'pending' });
  });

  // Notifications
  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    const notifications = db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`)
      .all(req.user!.id) as Array<{
      id: string;
      type: string;
      title: string;
      body: string;
      is_read: number;
      created_at: string;
    }>;

    res.json({
      notifications: notifications.map((n) => ({ ...n, is_read: Boolean(n.is_read) })),
      unreadCount: notifications.filter((n) => !n.is_read).length,
    });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(
      req.params.id,
      req.user!.id
    );
    res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user!.id);
    res.json({ ok: true });
  });

  // Feedback
  app.post('/api/feedback', requireAuth, (req: AuthenticatedRequest, res) => {
    const { category, rating, message } = req.body as {
      category?: string;
      rating?: number;
      message?: string;
    };
    if (!message?.trim() || !rating || rating < 1 || rating > 5) {
      res.status(400).json({ error: 'Please provide a rating (1-5) and feedback message.' });
      return;
    }
    const db = getDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO feedback (id, user_id, category, rating, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.user!.id, category?.trim() || 'general', Math.round(rating), message.trim().slice(0, 1000), now);
    res.status(201).json({ id, created_at: now });
  });

  app.get('/api/feedback', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = getDb();
    if (req.user!.role === 'admin') {
      const items = db
        .prepare(
          `SELECT f.*, u.name as user_name, u.role as user_role FROM feedback f
           JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 50`
        )
        .all();
      res.json({ feedback: items });
      return;
    }
    const items = db
      .prepare(`SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`)
      .all(req.user!.id);
    res.json({ feedback: items });
  });

  // Admin Portal
  app.get('/api/admin/overview', requireAuth, requireRole('admin'), (_req, res) => {
    const db = getDb();
    const count = (sql: string) => (db.prepare(sql).get() as { cnt: number }).cnt;
    const messaging = getMessagingConfigStatus();
    res.json({
      stats: {
        totalUsers: count(`SELECT COUNT(*) as cnt FROM users`),
        seniors: count(`SELECT COUNT(*) as cnt FROM users WHERE role = 'senior'`),
        caregivers: count(`SELECT COUNT(*) as cnt FROM users WHERE role = 'caregiver'`),
        admins: count(`SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'`),
        totalCheckIns: count(`SELECT COUNT(*) as cnt FROM check_ins`),
        openAlerts: count(`SELECT COUNT(*) as cnt FROM alerts WHERE status != 'resolved'`),
        scamAssessments: count(`SELECT COUNT(*) as cnt FROM scam_assessments`),
        lessonsCompleted: count(`SELECT COUNT(*) as cnt FROM lesson_progress WHERE is_completed = 1`),
        feedbackCount: count(`SELECT COUNT(*) as cnt FROM feedback`),
      },
      ai: getAiStatus(),
      messaging,
      database: getDatabaseStatus(),
    });
  });

  app.get('/api/admin/users', requireAuth, requireRole('admin'), (_req, res) => {
    const db = getDb();
    const users = db
      .prepare(
        `SELECT id, email, name, phone, role, language, is_active, created_at FROM users ORDER BY created_at DESC`
      )
      .all() as Array<{
      id: string;
      email: string;
      name: string;
      phone: string | null;
      role: UserRole;
      language: SupportedLanguage;
      is_active: number;
      created_at: string;
    }>;
    res.json({ users: users.map((u) => ({ ...u, is_active: Boolean(u.is_active) })) });
  });

  app.patch('/api/admin/users/:id', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res) => {
    const targetId = req.params.id;
    const { isActive, role } = req.body as { isActive?: boolean; role?: UserRole };

    if (targetId === req.user!.id && isActive === false) {
      res.status(400).json({ error: 'You cannot deactivate your own active administrator account.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare(`SELECT id, role, is_active FROM users WHERE id = ?`).get(targetId) as
      | { id: string; role: UserRole; is_active: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    const nextActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : existing.is_active;
    const nextRole: UserRole = role && ['senior', 'caregiver', 'admin'].includes(role) ? role : existing.role;
    const now = new Date().toISOString();

    db.prepare(`UPDATE users SET is_active = ?, role = ?, updated_at = ? WHERE id = ?`).run(
      nextActive,
      nextRole,
      now,
      targetId
    );
    if (!nextActive) {
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetId);
    }

    recordAuditLog(req.user!.id, 'admin.user_update', 'users', { targetId, isActive: Boolean(nextActive), role: nextRole });
    res.json({ ok: true, id: targetId, is_active: Boolean(nextActive), role: nextRole });
  });

  app.put('/api/admin/messaging-config', requireAuth, requireRole('admin'), (req: AuthenticatedRequest, res) => {
    const { messagingNumber } = req.body as { messagingNumber?: string };
    const clean = messagingNumber?.trim() || '';
    let normalizedValue = '';
    if (clean) {
      const phoneCheck = normalizePhoneWithCountryCode(clean);
      if (!phoneCheck.valid) {
        res.status(400).json({ error: phoneCheck.error });
        return;
      }
      normalizedValue = phoneCheck.e164;
    }

    const db = getDb();
    const now = new Date().toISOString();
    if (normalizedValue) {
      db.prepare(
        `INSERT INTO system_config (key, value, updated_at) VALUES ('buddy_messaging_number', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(normalizedValue, now);
    } else {
      db.prepare(`DELETE FROM system_config WHERE key = 'buddy_messaging_number'`).run();
    }
    recordAuditLog(req.user!.id, 'admin.messaging_config', 'system_config', { configured: Boolean(normalizedValue) });
    const current = getMessagingConfigStatus();
    res.json({
      ...current,
      envOverride: Boolean(getRawEnvMessagingNumber()),
    });
  });

  app.get('/api/admin/audit-logs', requireAuth, requireRole('admin'), (_req, res) => {
    const db = getDb();
    const logs = db
      .prepare(
        `SELECT a.*, u.email as actor_email FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 40`
      )
      .all();
    res.json({ logs });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      error: 'API endpoint not found.',
    });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        success: false,
        code: 'INVALID_JSON',
        error: 'Invalid JSON request body.',
      });
      return;
    }
    if (err instanceof DatabaseConfigError) {
      console.error('[Buddy Elder AI Database Config Error]', {
        endpoint: req.path,
        code: err.code,
        message: err.message,
      });
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          code: err.code,
          error: err.message,
        });
      }
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error.';
    console.error('[Buddy Elder AI API Error]', {
      endpoint: req.path,
      method: req.method,
      message,
    });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        code: 'SERVER_ERROR',
        error: process.env.NODE_ENV === 'production' ? 'Unexpected server error.' : message,
      });
    }
  });

  return app;
}
