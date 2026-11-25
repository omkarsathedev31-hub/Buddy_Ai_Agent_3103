import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

let envLoaded = false;

const PLACEHOLDER_VALUES = new Set([
  'MY_GOOGLE_GEMINI_API_KEY',
  'MY_GEMINI_API_KEY',
  'MY_APP_URL',
  'your-google-gemini-api-key',
  'your-gemini-api-key',
  'your-strong-admin-passcode',
  'your-messaging-number-with-country-code',
  '+<country_code><number>',
  'change-me',
]);

/**
 * Variables where a stale value inherited from the shell / OS must never silently beat the
 * value the developer just saved in .env.local / .env during local development.
 */
const FILE_PREFERRED_KEYS = new Set([
  'GEMINI_API_KEY',
  'GOOGLE_GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_FALLBACK_MODEL',
]);

export type EnvValueSource = 'process' | '.env.local' | '.env';

export interface EnvLoadReport {
  /** Folder the .env files were read from (the project root, or the launch folder as a fallback). */
  directory: string;
  filesRead: string[];
  /** Variable NAMES (never values) where a .env file replaced a different inherited value. */
  overridden: string[];
  /** Variable NAMES (never values) where the inherited value won although a .env file differs. */
  conflicts: string[];
  sources: Record<string, EnvValueSource>;
}

let lastEnvReport: EnvLoadReport = { directory: '', filesRead: [], overridden: [], conflicts: [], sources: {} };

export function isPlaceholderValue(value: string | undefined | null): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_VALUES.has(trimmed);
}

function readEnvFile(file: string): { exists: boolean; values: Record<string, string> } {
  try {
    if (!fs.existsSync(file)) return { exists: false, values: {} };
    // Windows editors often save UTF-8 with a BOM, which would corrupt the first variable name.
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return { exists: true, values: dotenv.parse(text) };
  } catch {
    return { exists: false, values: {} };
  }
}

/**
 * Whether .env files should win over values inherited from the shell/OS for GEMINI_* keys.
 * True for local development; false on hosts (Vercel, NODE_ENV=production) where the platform's
 * own environment is the source of truth.
 */
export function shouldPreferEnvFiles(env: NodeJS.ProcessEnv = process.env): boolean {
  const isProd = env.NODE_ENV === 'production';
  const isVercel = env.VERCEL === '1' || env.VERCEL === 'true' || Boolean(env.VERCEL_ENV);
  return !isProd && !isVercel;
}

/**
 * Pure, testable env-file merge. Precedence:
 *   - Every variable: .env.local > .env, and an inherited (shell/host) value wins for ordinary variables
 *     (so `PORT=4000 npm run dev` keeps working).
 *   - GOOGLE_GEMINI_API_KEY / GEMINI_MODEL in local development: the saved .env.local / .env value wins over a
 *     stale shell/OS value, because "I replaced my key but nothing changed" is almost always that.
 *   - Empty or placeholder inherited values never block a real file value.
 *   - A placeholder in .env.local (copied from .env.example) never masks a real value in .env.
 * Only variable names are ever reported, never values.
 */
export function applyEnvFiles(opts: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  preferFiles: boolean;
}): EnvLoadReport {
  const { cwd, env, preferFiles } = opts;
  const report: EnvLoadReport = { directory: cwd, filesRead: [], overridden: [], conflicts: [], sources: {} };

  const local = readEnvFile(path.resolve(cwd, '.env.local'));
  const base = readEnvFile(path.resolve(cwd, '.env'));
  if (local.exists) report.filesRead.push('.env.local');
  if (base.exists) report.filesRead.push('.env');

  const merged = new Map<string, { value: string; source: EnvValueSource }>();
  for (const [key, value] of Object.entries(base.values)) {
    merged.set(key, { value, source: '.env' });
  }
  for (const [key, value] of Object.entries(local.values)) {
    const existing = merged.get(key);
    if (
      FILE_PREFERRED_KEYS.has(key) &&
      isPlaceholderValue(value) &&
      existing &&
      !isPlaceholderValue(existing.value)
    ) {
      continue;
    }
    merged.set(key, { value, source: '.env.local' });
  }

  for (const [key, { value, source }] of merged) {
    const inherited = env[key];
    const hasInherited = !isPlaceholderValue(inherited);
    const managed = FILE_PREFERRED_KEYS.has(key);

    if (!hasInherited) {
      env[key] = value;
      if (managed) report.sources[key] = source;
      continue;
    }

    if (!managed) continue;

    report.sources[key] = 'process';
    if (inherited !== value && !isPlaceholderValue(value)) {
      if (preferFiles) {
        env[key] = value;
        report.sources[key] = source;
        report.overridden.push(key);
      } else {
        report.conflicts.push(key);
      }
    }
  }

  return report;
}

/**
 * Picks the folder to read .env files from. The project root (found relative to this source file) is preferred,
 * so the key is found no matter which folder the server was launched from (VS Code tasks, Windows shortcuts, etc.).
 * The launch folder is only used when the project root has no .env / .env.local.
 */
export function resolveEnvDirectory(candidates: string[]): string {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, '.env')) || fs.existsSync(path.join(dir, '.env.local'))) return dir;
  }
  return candidates[0] ?? process.cwd();
}

function getProjectRoot(): string | null {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  } catch {
    return null;
  }
}

export function getEnvLoadReport(): EnvLoadReport {
  return lastEnvReport;
}

export function loadServerEnv(): void {
  if (envLoaded) return;
  envLoaded = true;

  const root = getProjectRoot();
  lastEnvReport = applyEnvFiles({
    cwd: resolveEnvDirectory(root ? [root, process.cwd()] : [process.cwd()]),
    env: process.env,
    preferFiles: shouldPreferEnvFiles(process.env),
  });

  for (const key of lastEnvReport.overridden) {
    console.warn(
      `[Buddy Env] ${key} from ${lastEnvReport.sources[key]} replaced a different value inherited from your shell/OS environment. ` +
        `Remove the stale ${key} variable from your shell/OS to silence this notice.`
    );
  }
  for (const key of lastEnvReport.conflicts) {
    console.warn(
      `[Buddy Env] ${key} is set in the host/process environment and differs from your .env file; the host value is being used.`
    );
  }
}

/**
 * Normalizes a pasted API key: removes zero-width characters/BOM, surrounding whitespace, wrapping quotes
 * (hosting dashboards often store them literally), and an accidentally pasted "GEMINI_API_KEY=" / "Bearer " prefix.
 */
export function normalizeApiKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let value = raw.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
  const quotes = '"\'`\u201C\u201D\u2018\u2019';
  for (let i = 0; i < 3; i++) {
    const before = value;
    if (value.length >= 2 && quotes.includes(value[0]) && quotes.includes(value[value.length - 1])) {
      value = value.slice(1, -1).trim();
    }
    value = value.replace(/^(?:export\s+)?(?:GOOGLE_)?GEMINI_API_KEY\s*=\s*/i, '').trim();
    value = value.replace(/^Bearer\s+/i, '').trim();
    if (value === before) break;
  }
  return value;
}

export type GeminiKeyVarName = 'GEMINI_API_KEY' | 'GOOGLE_GEMINI_API_KEY';

function resolveGeminiKeyEntry(): { key: string; varName: GeminiKeyVarName } | null {
  loadServerEnv();
  const candidates: Array<{ varName: GeminiKeyVarName; raw: string | undefined }> = [
    { varName: 'GEMINI_API_KEY', raw: process.env.GEMINI_API_KEY },
    { varName: 'GOOGLE_GEMINI_API_KEY', raw: process.env.GOOGLE_GEMINI_API_KEY },
  ];
  for (const candidate of candidates) {
    if (isPlaceholderValue(candidate.raw)) continue;
    const normalized = normalizeApiKey(candidate.raw);
    if (!normalized || isPlaceholderValue(normalized)) continue;
    return { key: normalized, varName: candidate.varName };
  }
  return null;
}

export function getGeminiApiKey(): string | null {
  return resolveGeminiKeyEntry()?.key ?? null;
}

export interface GeminiKeyInfo {
  configured: boolean;
  varName: GeminiKeyVarName | null;
  source: EnvValueSource | 'none';
  length: number;
  /** Human-readable problem with the key's shape, or null. Never contains the key. */
  formatIssue: string | null;
  /** True when the key matches a known Google key shape (AIza... or AQ....). Informational only. */
  looksLikeStandardKey: boolean;
  /** One-way SHA-256 prefix so you can tell whether the key changed after a restart. Not reversible. */
  fingerprint: string | null;
}

/** Describes the configured Gemini key WITHOUT exposing it. */
export function getGeminiKeyInfo(): GeminiKeyInfo {
  loadServerEnv();
  const entry = resolveGeminiKeyEntry();
  if (!entry) {
    return {
      configured: false,
      varName: null,
      source: 'none',
      length: 0,
      formatIssue: null,
      looksLikeStandardKey: false,
      fingerprint: null,
    };
  }

  const { key, varName } = entry;
  let formatIssue: string | null = null;
  if (/\s/.test(key)) {
    formatIssue = `${varName} contains whitespace or a line break in the middle of the value.`;
  } else if (/[^\x21-\x7E]/.test(key)) {
    formatIssue = `${varName} contains non-ASCII or non-printable characters.`;
  } else if (key.length < 20) {
    formatIssue = `${varName} is unusually short; it may have been truncated when pasted.`;
  }

  return {
    configured: true,
    varName,
    source: lastEnvReport.sources[varName] ?? 'process',
    length: key.length,
    formatIssue,
    looksLikeStandardKey: /^(?:AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_.-]{20,})$/.test(key),
    fingerprint: crypto.createHash('sha256').update(key).digest('hex').slice(0, 8),
  };
}

export interface GeminiStartupValidation {
  configured: boolean;
  valid: boolean;
  varName: GeminiKeyVarName | null;
  source: EnvValueSource | 'none';
  message: string;
}

export function validateGeminiStartupConfig(): GeminiStartupValidation {
  loadServerEnv();
  const info = getGeminiKeyInfo();
  const envReport = getEnvLoadReport();
  if (!info.configured) {
    return {
      configured: false,
      valid: false,
      varName: null,
      source: 'none',
      message:
        `GEMINI_API_KEY was not found (or is still a placeholder) in process.env or .env files ` +
        `(checked ${envReport.directory || process.cwd()}; files found: ${envReport.filesRead.join(', ') || 'none'}). ` +
        `Set GEMINI_API_KEY in Railway/host environment variables or .env and restart the server.`,
    };
  }
  if (info.formatIssue) {
    return {
      configured: true,
      valid: false,
      varName: info.varName,
      source: info.source,
      message: info.formatIssue,
    };
  }
  return {
    configured: true,
    valid: true,
    varName: info.varName,
    source: info.source,
    message: `Gemini API key loaded from ${info.varName} (source: ${info.source}, length: ${info.length}).`,
  };
}

export function getAdminPasscode(): string | null {
  loadServerEnv();
  const raw = process.env.ADMIN_PASSCODE;
  if (isPlaceholderValue(raw)) return null;
  return raw!.trim();
}

export function normalizePhoneWithCountryCode(
  raw: string
): { valid: true; e164: string } | { valid: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, error: 'Phone number cannot be empty.' };
  }

  // Strip common formatting punctuation while preserving leading +
  const collapsed = trimmed.replace(/[\s().-]+/g, '');
  if (!collapsed.startsWith('+')) {
    return {
      valid: false,
      error: 'Phone number must include a country code starting with "+" (8 to 15 digits).',
    };
  }

  const digits = collapsed.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return {
      valid: false,
      error: 'Phone number must start with "+" followed by country code and 8 to 15 digits total.',
    };
  }

  return { valid: true, e164: `+${digits}` };
}

export function getRawEnvMessagingNumber(): string | null {
  loadServerEnv();
  const raw = process.env.BUDDY_MESSAGING_NUMBER;
  if (isPlaceholderValue(raw)) return null;
  return raw!.trim();
}

let ephemeralFallbackJwtSecret: string | null = null;

export function isJwtSecretConfiguredInEnv(): boolean {
  loadServerEnv();
  const raw = process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET;
  return Boolean(raw && !isPlaceholderValue(raw) && raw.trim().length >= 16);
}

export function getJwtSecret(): string {
  loadServerEnv();
  const raw = process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET;
  if (raw && !isPlaceholderValue(raw)) {
    return raw.trim();
  }
  if (!ephemeralFallbackJwtSecret) {
    ephemeralFallbackJwtSecret = crypto.randomBytes(32).toString('hex');
  }
  return ephemeralFallbackJwtSecret;
}

loadServerEnv();
