/* Bundled for Vercel Node 22 Serverless Runtime via npm run build (source: server/vercel-handler.ts) */

// server/env.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
var envLoaded = false;
var PLACEHOLDER_VALUES = /* @__PURE__ */ new Set([
  "MY_GOOGLE_GEMINI_API_KEY",
  "MY_GEMINI_API_KEY",
  "MY_APP_URL",
  "your-google-gemini-api-key",
  "your-gemini-api-key",
  "your-strong-admin-passcode",
  "your-messaging-number-with-country-code",
  "+<country_code><number>",
  "change-me"
]);
var FILE_PREFERRED_KEYS = /* @__PURE__ */ new Set([
  "GEMINI_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODEL"
]);
var lastEnvReport = { directory: "", filesRead: [], overridden: [], conflicts: [], sources: {} };
function isPlaceholderValue(value) {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return PLACEHOLDER_VALUES.has(trimmed);
}
function readEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return { exists: false, values: {} };
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return { exists: true, values: dotenv.parse(text) };
  } catch {
    return { exists: false, values: {} };
  }
}
function shouldPreferEnvFiles(env = process.env) {
  const isProd = env.NODE_ENV === "production";
  const isVercel = env.VERCEL === "1" || env.VERCEL === "true" || Boolean(env.VERCEL_ENV);
  return !isProd && !isVercel;
}
function applyEnvFiles(opts) {
  const { cwd, env, preferFiles } = opts;
  const report = { directory: cwd, filesRead: [], overridden: [], conflicts: [], sources: {} };
  const local = readEnvFile(path.resolve(cwd, ".env.local"));
  const base = readEnvFile(path.resolve(cwd, ".env"));
  if (local.exists) report.filesRead.push(".env.local");
  if (base.exists) report.filesRead.push(".env");
  const merged = /* @__PURE__ */ new Map();
  for (const [key, value] of Object.entries(base.values)) {
    merged.set(key, { value, source: ".env" });
  }
  for (const [key, value] of Object.entries(local.values)) {
    const existing = merged.get(key);
    if (FILE_PREFERRED_KEYS.has(key) && isPlaceholderValue(value) && existing && !isPlaceholderValue(existing.value)) {
      continue;
    }
    merged.set(key, { value, source: ".env.local" });
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
    report.sources[key] = "process";
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
function resolveEnvDirectory(candidates) {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, ".env")) || fs.existsSync(path.join(dir, ".env.local"))) return dir;
  }
  return candidates[0] ?? process.cwd();
}
function getProjectRoot() {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  } catch {
    return null;
  }
}
function getEnvLoadReport() {
  return lastEnvReport;
}
function loadServerEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const root = getProjectRoot();
  lastEnvReport = applyEnvFiles({
    cwd: resolveEnvDirectory(root ? [root, process.cwd()] : [process.cwd()]),
    env: process.env,
    preferFiles: shouldPreferEnvFiles(process.env)
  });
  for (const key of lastEnvReport.overridden) {
    console.warn(
      `[Buddy Env] ${key} from ${lastEnvReport.sources[key]} replaced a different value inherited from your shell/OS environment. Remove the stale ${key} variable from your shell/OS to silence this notice.`
    );
  }
  for (const key of lastEnvReport.conflicts) {
    console.warn(
      `[Buddy Env] ${key} is set in the host/process environment and differs from your .env file; the host value is being used.`
    );
  }
}
function normalizeApiKey(raw) {
  if (!raw) return "";
  let value = raw.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
  const quotes = "\"'`\u201C\u201D\u2018\u2019";
  for (let i = 0; i < 3; i++) {
    const before = value;
    if (value.length >= 2 && quotes.includes(value[0]) && quotes.includes(value[value.length - 1])) {
      value = value.slice(1, -1).trim();
    }
    value = value.replace(/^(?:export\s+)?(?:GOOGLE_)?GEMINI_API_KEY\s*=\s*/i, "").trim();
    value = value.replace(/^Bearer\s+/i, "").trim();
    if (value === before) break;
  }
  return value;
}
function resolveGeminiKeyEntry() {
  loadServerEnv();
  const candidates = [
    { varName: "GEMINI_API_KEY", raw: process.env.GEMINI_API_KEY },
    { varName: "GOOGLE_GEMINI_API_KEY", raw: process.env.GOOGLE_GEMINI_API_KEY }
  ];
  for (const candidate of candidates) {
    if (isPlaceholderValue(candidate.raw)) continue;
    const normalized = normalizeApiKey(candidate.raw);
    if (!normalized || isPlaceholderValue(normalized)) continue;
    return { key: normalized, varName: candidate.varName };
  }
  return null;
}
function getGeminiApiKey() {
  return resolveGeminiKeyEntry()?.key ?? null;
}
function getGeminiKeyInfo() {
  loadServerEnv();
  const entry = resolveGeminiKeyEntry();
  if (!entry) {
    return {
      configured: false,
      varName: null,
      source: "none",
      length: 0,
      formatIssue: null,
      looksLikeStandardKey: false,
      fingerprint: null
    };
  }
  const { key, varName } = entry;
  let formatIssue = null;
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
    source: lastEnvReport.sources[varName] ?? "process",
    length: key.length,
    formatIssue,
    looksLikeStandardKey: /^(?:AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_.-]{20,})$/.test(key),
    fingerprint: crypto.createHash("sha256").update(key).digest("hex").slice(0, 8)
  };
}
function getAdminPasscode() {
  loadServerEnv();
  const raw = process.env.ADMIN_PASSCODE;
  if (isPlaceholderValue(raw)) return null;
  return raw.trim();
}
function normalizePhoneWithCountryCode(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, error: "Phone number cannot be empty." };
  }
  const collapsed = trimmed.replace(/[\s().-]+/g, "");
  if (!collapsed.startsWith("+")) {
    return {
      valid: false,
      error: 'Phone number must include a country code starting with "+" (8 to 15 digits).'
    };
  }
  const digits = collapsed.slice(1);
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return {
      valid: false,
      error: 'Phone number must start with "+" followed by country code and 8 to 15 digits total.'
    };
  }
  return { valid: true, e164: `+${digits}` };
}
function getRawEnvMessagingNumber() {
  loadServerEnv();
  const raw = process.env.BUDDY_MESSAGING_NUMBER;
  if (isPlaceholderValue(raw)) return null;
  return raw.trim();
}
var ephemeralFallbackJwtSecret = null;
function getJwtSecret() {
  loadServerEnv();
  const raw = process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET;
  if (raw && !isPlaceholderValue(raw)) {
    return raw.trim();
  }
  if (!ephemeralFallbackJwtSecret) {
    ephemeralFallbackJwtSecret = crypto.randomBytes(32).toString("hex");
  }
  return ephemeralFallbackJwtSecret;
}
loadServerEnv();

// server/app.ts
import crypto4 from "node:crypto";
import express from "express";

// shared/types.ts
var PERMISSION_PRESETS = {
  minimal: {
    checkin_status: true,
    checkin_responses: false,
    wellness_summaries: false,
    safety_alerts: true,
    scam_alerts: false,
    reminder_status: false,
    activity_summaries: false,
    ai_summaries: false,
    contact_info: true
  },
  balanced: {
    checkin_status: true,
    checkin_responses: true,
    wellness_summaries: true,
    safety_alerts: true,
    scam_alerts: true,
    reminder_status: true,
    activity_summaries: false,
    ai_summaries: false,
    contact_info: true
  },
  full: {
    checkin_status: true,
    checkin_responses: true,
    wellness_summaries: true,
    safety_alerts: true,
    scam_alerts: true,
    reminder_status: true,
    activity_summaries: true,
    ai_summaries: true,
    contact_info: true
  }
};

// server/ai.ts
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

// server/db.ts
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { DatabaseSync } from "node:sqlite";
var dbInstance = null;
var warnedEphemeral = false;
var DatabaseConfigError = class extends Error {
  constructor(message) {
    super(message);
    this.code = "DATABASE_NOT_PERSISTENT";
    this.statusCode = 503;
    this.name = "DatabaseConfigError";
  }
};
function isVercelRuntime() {
  return process.env.VERCEL === "1" || process.env.VERCEL === "true" || Boolean(process.env.VERCEL_ENV) || Boolean(process.env.NOW_REGION);
}
function isRailwayRuntime() {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.RAILWAY_PUBLIC_DOMAIN
  );
}
function isProductionDeployment() {
  return process.env.NODE_ENV === "production" || isVercelRuntime() || isRailwayRuntime();
}
function isInsideTmpDir(resolvedPath) {
  const tmpRoot = path2.resolve(os.tmpdir());
  return resolvedPath === tmpRoot || resolvedPath.startsWith(tmpRoot + path2.sep);
}
function validateDatabaseConfiguration() {
  const allowEphemeral = process.env.BUDDY_ALLOW_EPHEMERAL_DB === "true";
  if (allowEphemeral) {
    return;
  }
  const rawCustom = process.env.BUDDY_DB_PATH?.trim();
  const railwayVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (isVercelRuntime()) {
    const resolved = rawCustom && rawCustom !== ":memory:" ? path2.resolve(rawCustom) : null;
    if (!resolved || isInsideTmpDir(resolved)) {
      throw new DatabaseConfigError(
        'Persistent database configuration required: Vercel serverless functions use ephemeral /tmp storage that is wiped on cold starts and not shared across instances, causing "Session not found or expired" errors. Deploy Buddy Elder AI on a persistent Node.js server with a mounted volume (such as Railway with a /data volume and BUDDY_DB_PATH=/data/buddy-elder.db).'
      );
    }
  }
  if (isRailwayRuntime()) {
    if (!rawCustom && !railwayVolumeMount || rawCustom === ":memory:") {
      throw new DatabaseConfigError(
        "Persistent database configuration required: set BUDDY_DB_PATH=/data/buddy-elder.db and attach a persistent Railway volume mounted at /data so accounts and login sessions survive restarts and redeploys."
      );
    }
  }
  if (isProductionDeployment() && rawCustom === ":memory:") {
    throw new DatabaseConfigError(
      "In-memory SQLite (:memory:) cannot be used in production. Set BUDDY_DB_PATH to a persistent disk path (for example /data/buddy-elder.db)."
    );
  }
}
function getDbPath() {
  validateDatabaseConfiguration();
  const rawCustom = process.env.BUDDY_DB_PATH?.trim();
  if (rawCustom) {
    return rawCustom === ":memory:" ? rawCustom : path2.resolve(rawCustom);
  }
  const railwayVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (isRailwayRuntime() && railwayVolumeMount) {
    return path2.resolve(railwayVolumeMount, "buddy-elder.db");
  }
  if (isVercelRuntime()) {
    return path2.join(os.tmpdir(), "buddy-elder.db");
  }
  return path2.resolve(process.cwd(), "data", "buddy-elder.db");
}
function getDatabaseStatus() {
  try {
    validateDatabaseConfiguration();
  } catch (err) {
    return {
      engine: "sqlite",
      durable: false,
      mode: "misconfigured",
      warning: err instanceof Error ? err.message : "Persistent database configuration is missing."
    };
  }
  const rawCustom = process.env.BUDDY_DB_PATH?.trim();
  const railwayVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (rawCustom === ":memory:") {
    return {
      engine: "sqlite",
      durable: false,
      mode: "memory",
      warning: "In-memory SQLite database is active; data clears when the process exits."
    };
  }
  if (rawCustom || isRailwayRuntime() && railwayVolumeMount) {
    return { engine: "sqlite", durable: true, mode: "custom_path", warning: null };
  }
  if (isVercelRuntime()) {
    return {
      engine: "sqlite",
      durable: false,
      mode: "vercel_tmp_ephemeral",
      warning: "Running SQLite in Vercel ephemeral /tmp storage because BUDDY_ALLOW_EPHEMERAL_DB=true is set. Data resets on cold starts and is not shared across serverless instances."
    };
  }
  return { engine: "sqlite", durable: true, mode: "local_disk", warning: null };
}
function getDb() {
  if (dbInstance) {
    return dbInstance;
  }
  const dbPath = getDbPath();
  const status = getDatabaseStatus();
  if (!status.durable && !warnedEphemeral && status.warning) {
    warnedEphemeral = true;
    console.warn(`[Buddy Elder AI DB] ${status.warning}`);
  }
  try {
    if (dbPath !== ":memory:") {
      const dir = path2.dirname(dbPath);
      if (!fs2.existsSync(dir)) {
        fs2.mkdirSync(dir, { recursive: true });
      }
    }
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("PRAGMA busy_timeout = 5000;");
    if (dbPath !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA synchronous = NORMAL;");
    }
    runMigrations(db);
    dbInstance = db;
    return db;
  } catch (err) {
    if (err instanceof DatabaseConfigError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to initialize SQLite database at "${dbPath}". Check BUDDY_DB_PATH and directory permissions. (${msg})`
    );
  }
}
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL CHECK (role IN ('senior', 'caregiver', 'admin')),
      password_hash TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'mr', 'hinglish')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      text_size TEXT NOT NULL DEFAULT 'normal' CHECK (text_size IN ('sm', 'normal', 'lg', 'xl')),
      contrast_mode TEXT NOT NULL DEFAULT 'standard' CHECK (contrast_mode IN ('standard', 'high')),
      theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark')),
      reduced_motion INTEGER NOT NULL DEFAULT 0,
      voice_enabled INTEGER NOT NULL DEFAULT 1,
      voice_speed TEXT NOT NULL DEFAULT 'normal' CHECK (voice_speed IN ('slow', 'normal', 'fast')),
      voice_name TEXT,
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id TEXT PRIMARY KEY,
      senior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      relationship TEXT NOT NULL,
      phone TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS caregiver_links (
      id TEXT PRIMARY KEY,
      senior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caregiver_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      invite_code TEXT NOT NULL UNIQUE,
      relationship TEXT NOT NULL DEFAULT 'Family Member',
      sharing_level TEXT NOT NULL DEFAULT 'balanced' CHECK (sharing_level IN ('minimal', 'balanced', 'full')),
      permissions_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_requests (
      id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL REFERENCES caregiver_links(id) ON DELETE CASCADE,
      senior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caregiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_level TEXT NOT NULL CHECK (requested_level IN ('minimal', 'balanced', 'full')),
      requested_permissions_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permission_history (
      id TEXT PRIMARY KEY,
      senior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      link_id TEXT,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      last_status TEXT NOT NULL DEFAULT 'idle' CHECK (last_status IN ('idle', 'pending', 'responded', 'failed')),
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS check_ins (
      id TEXT PRIMARY KEY,
      senior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      checkin_date TEXT NOT NULL,
      mood TEXT NOT NULL CHECK (mood IN ('good', 'okay', 'not_good')),
      medication_taken TEXT,
      needs_help INTEGER,
      wants_family_call INTEGER,
      feels_safe INTEGER,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(senior_id, checkin_date)
    );

    CREATE TABLE IF NOT EXISTS scam_assessments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      input_type TEXT NOT NULL,
      content TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK (risk_level IN ('GREEN', 'YELLOW', 'RED')),
      explanation TEXT NOT NULL,
      indicators_json TEXT NOT NULL,
      actions_json TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lesson_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id TEXT NOT NULL,
      completed_steps_json TEXT NOT NULL,
      is_completed INTEGER NOT NULL DEFAULT 0,
      last_step INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, lesson_id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      senior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'informational')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      explanation TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      dedupe_key TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved')),
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      senior_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      voice_enabled INTEGER NOT NULL DEFAULT 1,
      delivery_status TEXT NOT NULL DEFAULT 'scheduled' CHECK (delivery_status IN ('scheduled', 'sent', 'acknowledged', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messaging_onboarding (
      id TEXT PRIMARY KEY,
      senior_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      setup_mode TEXT NOT NULL DEFAULT 'self' CHECK (setup_mode IN ('self', 'caregiver_assisted')),
      senior_phone TEXT,
      status TEXT NOT NULL DEFAULT 'not_started' CHECK (
        status IN ('not_started', 'instructions_viewed', 'ready_to_send', 'user_confirmed', 'backend_verified')
      ),
      verified_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_caregiver_links_senior ON caregiver_links(senior_id, status);
    CREATE INDEX IF NOT EXISTS idx_caregiver_links_caregiver ON caregiver_links(caregiver_id, status);
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_checkins_senior_date ON check_ins(senior_id, checkin_date DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_senior_status ON alerts(senior_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_dedupe ON alerts(senior_id, dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_reminders_senior ON reminders(senior_id, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
  `);
  const convCols = db.prepare(`PRAGMA table_info(conversations)`).all();
  const convColNames = new Set(convCols.map((c) => c.name));
  if (!convColNames.has("last_status")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN last_status TEXT NOT NULL DEFAULT 'idle';`);
  }
  if (!convColNames.has("last_error_code")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN last_error_code TEXT;`);
  }
  if (!convColNames.has("last_error_message")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN last_error_message TEXT;`);
  }
}

// server/ai.ts
var DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
var DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";
var FRIENDLY_AI_BUSY_MESSAGE = "Buddy is temporarily unable to answer because the AI service is busy. Your question has been saved. Please try again shortly. You can still use Learn Tech, Is This Safe?, Daily Check-In, and Reminders.";
var FRIENDLY_AI_QUOTA_MESSAGE = "Buddy\u2019s daily AI usage limit has been reached on the server right now. Your question has been saved. Please try again later or ask an administrator to check the Gemini API plan. You can still use Learn Tech, Is This Safe?, Daily Check-In, and Reminders.";
var VALID_GEMINI_MODEL_REGEX = /^(?:gemini|lyria|genie)-[a-z0-9][a-z0-9.-]{1,60}$/i;
var DEPRECATED_GEMINI_MODEL_REGEX = /^gemini-(?:1(?:\.|$)|2\.0(?:[.-]|$)|pro$)/i;
var KNOWN_NONEXISTENT_TEXT_MODEL_REGEX = /^gemini-(?:3\.5-(?:flash|pro)|3\.8-flash)\b/i;
var NON_CHAT_GEMINI_MODEL_REGEX = /(?:image|tts|live|transcribe|embedding|lyria|genie|robotics|computer-use|deep-research|veo|imagen|audio|aqa)/i;
var DISABLED_FALLBACK_VALUES = /* @__PURE__ */ new Set(["none", "off", "false", "disabled"]);
var UNSET_MODEL_VALUES = /* @__PURE__ */ new Set(["undefined", "null", "my_gemini_model", "my_gemini_fallback_model", "change-me"]);
var loggedInvalidModelWarning = false;
var loggedInvalidFallbackModelWarning = false;
function isUnsupportedChatModelOverride(modelName) {
  return DEPRECATED_GEMINI_MODEL_REGEX.test(modelName) || KNOWN_NONEXISTENT_TEXT_MODEL_REGEX.test(modelName) || NON_CHAT_GEMINI_MODEL_REGEX.test(modelName);
}
function cleanEnvModelString(raw) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  const unquoted = trimmed.replace(/^["'`\u201C\u201D\u2018\u2019]+|["'`\u201C\u201D\u2018\u2019]+$/g, "").trim();
  if (!unquoted || UNSET_MODEL_VALUES.has(unquoted.toLowerCase())) {
    return "";
  }
  return unquoted;
}
function normalizeGeminiModelName(raw, defaultModel = DEFAULT_GEMINI_MODEL) {
  const trimmed = cleanEnvModelString(raw);
  if (!trimmed) {
    return { model: defaultModel, invalidOverride: false };
  }
  const stripped = trimmed.replace(/^models\//i, "").trim();
  const lower = stripped.toLowerCase();
  const hasDoubleDot = stripped.includes("..") || stripped.endsWith(".") || stripped.endsWith("-");
  if (!hasDoubleDot && VALID_GEMINI_MODEL_REGEX.test(stripped) && !isUnsupportedChatModelOverride(lower)) {
    return { model: lower, invalidOverride: false };
  }
  if (defaultModel === DEFAULT_GEMINI_MODEL && !loggedInvalidModelWarning) {
    loggedInvalidModelWarning = true;
    console.warn(
      `[Buddy AI Config] Ignoring invalid or deprecated GEMINI_MODEL ("${lower}"); falling back to ${DEFAULT_GEMINI_MODEL}.`
    );
  }
  return { model: defaultModel, invalidOverride: true };
}
function getConfiguredGeminiModel() {
  return normalizeGeminiModelName(process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL).model;
}
function normalizeFallbackGeminiModel(raw, primaryModel = getConfiguredGeminiModel()) {
  const defaultFallback = primaryModel === DEFAULT_GEMINI_MODEL ? DEFAULT_GEMINI_FALLBACK_MODEL : DEFAULT_GEMINI_MODEL;
  const trimmed = cleanEnvModelString(raw);
  if (!trimmed) {
    return { model: defaultFallback === primaryModel ? null : defaultFallback, invalidOverride: false };
  }
  if (DISABLED_FALLBACK_VALUES.has(trimmed.toLowerCase())) {
    return { model: null, invalidOverride: false };
  }
  const normalized = normalizeGeminiModelName(trimmed, defaultFallback);
  if (normalized.invalidOverride && !loggedInvalidFallbackModelWarning) {
    loggedInvalidFallbackModelWarning = true;
    console.warn(
      `[Buddy AI Config] Ignoring invalid or deprecated GEMINI_FALLBACK_MODEL; falling back to ${defaultFallback}.`
    );
  }
  return {
    model: normalized.model === primaryModel ? null : normalized.model,
    invalidOverride: normalized.invalidOverride
  };
}
function getConfiguredFallbackGeminiModel(primaryModel = getConfiguredGeminiModel()) {
  return normalizeFallbackGeminiModel(process.env.GEMINI_FALLBACK_MODEL, primaryModel).model;
}
var MAX_TRANSIENT_RETRIES = 2;
var MODEL_DISCOVERY_TTL_MS = 5 * 60 * 1e3;
var NOT_FOUND_MODEL_TTL_MS = 30 * 60 * 1e3;
var WORKING_MODEL_TTL_MS = 10 * 60 * 1e3;
var AI_ATTEMPT_TIMEOUT_MS = 12e3;
var AI_TOTAL_BUDGET_MS = 28e3;
var VERIFIED_MODEL_PRIORITY = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-4-hydrogen",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-pro"
];
var discoveredModelsCache = /* @__PURE__ */ new Map();
var notFoundModelsCache = /* @__PURE__ */ new Map();
var lastWorkingModelCache = /* @__PURE__ */ new Map();
function getAiCacheScope() {
  return `${getGeminiKeyInfo().fingerprint ?? "default"}:${process.env.GOOGLE_GEMINI_BASE_URL ?? ""}`;
}
function isModelKnownNotFound(cacheScope, modelName) {
  const key = `${cacheScope}:${modelName}`;
  const expiresAt = notFoundModelsCache.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    notFoundModelsCache.delete(key);
    return false;
  }
  return true;
}
function recordModelOutcome(cacheScope, modelName, classified) {
  const key = `${cacheScope}:${modelName}`;
  if (!classified) {
    notFoundModelsCache.delete(key);
    lastWorkingModelCache.set(cacheScope, {
      model: modelName,
      expiresAt: Date.now() + WORKING_MODEL_TTL_MS
    });
    return;
  }
  if (classified.code === "AI_MODEL_ERROR") {
    notFoundModelsCache.set(key, Date.now() + NOT_FOUND_MODEL_TTL_MS);
    const working = lastWorkingModelCache.get(cacheScope);
    if (working?.model === modelName) {
      lastWorkingModelCache.delete(cacheScope);
    }
  }
}
function getLastWorkingModel(cacheScope) {
  const entry = lastWorkingModelCache.get(cacheScope);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    lastWorkingModelCache.delete(cacheScope);
    return null;
  }
  return isModelKnownNotFound(cacheScope, entry.model) ? null : entry.model;
}
function filterAndRankGeminiChatModels(rawModels) {
  const unique = /* @__PURE__ */ new Set();
  for (const item of rawModels) {
    const clean = (item?.name ?? "").replace(/^models\//i, "").trim().toLowerCase();
    if (!clean || !clean.startsWith("gemini-")) continue;
    if (isUnsupportedChatModelOverride(clean)) continue;
    if (Array.isArray(item.supportedActions) && item.supportedActions.length > 0 && !item.supportedActions.includes("generateContent")) {
      continue;
    }
    unique.add(clean);
  }
  return Array.from(unique).sort((a, b) => {
    const idxA = VERIFIED_MODEL_PRIORITY.indexOf(a);
    const idxB = VERIFIED_MODEL_PRIORITY.indexOf(b);
    const rankA = idxA === -1 ? Number.MAX_SAFE_INTEGER : idxA;
    const rankB = idxB === -1 ? Number.MAX_SAFE_INTEGER : idxB;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}
async function discoverAvailableGeminiModels(ai, cacheScope = getAiCacheScope()) {
  const cacheKey = cacheScope;
  const cached = discoveredModelsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }
  try {
    const pager = await withAttemptTimeout(
      () => ai.models.list({ config: { pageSize: 100 } }),
      6e3
    );
    const collected = Array.isArray(
      pager.page
    ) ? [...pager.page] : [];
    if (collected.length > 0 && typeof pager.hasNextPage === "function" && pager.hasNextPage() && typeof pager.nextPage === "function") {
      try {
        const page2 = await withAttemptTimeout(
          () => pager.nextPage(),
          4e3
        );
        if (Array.isArray(page2)) collected.push(...page2);
      } catch {
      }
    }
    const ranked = filterAndRankGeminiChatModels(collected);
    if (ranked.length > 0) {
      discoveredModelsCache.set(cacheKey, {
        models: ranked,
        expiresAt: Date.now() + MODEL_DISCOVERY_TTL_MS
      });
    }
    return ranked;
  } catch {
    return [];
  }
}
function getCandidateGeminiModels() {
  const primary = getConfiguredGeminiModel();
  const fallback = getConfiguredFallbackGeminiModel(primary);
  const list = fallback && fallback !== primary ? [primary, fallback] : [primary];
  const isDefaultPair = primary === DEFAULT_GEMINI_MODEL && fallback === DEFAULT_GEMINI_FALLBACK_MODEL;
  if (!isDefaultPair && fallback !== null && !list.includes("gemini-4-hydrogen")) {
    list.push("gemini-4-hydrogen");
  }
  return list;
}
function buildEffectiveCandidateModels(cacheScope) {
  const staticCandidates = getCandidateGeminiModels();
  const cachedDiscovered = discoveredModelsCache.get(cacheScope);
  const verifiedSet = cachedDiscovered && cachedDiscovered.expiresAt > Date.now() && cachedDiscovered.models.length > 0 ? new Set(cachedDiscovered.models) : null;
  const filtered = [];
  for (let idx = 0; idx < staticCandidates.length; idx++) {
    const modelName = staticCandidates[idx];
    if (isModelKnownNotFound(cacheScope, modelName)) continue;
    if (idx > 0 && verifiedSet && !verifiedSet.has(modelName)) continue;
    filtered.push(modelName);
  }
  const lastWorking = getLastWorkingModel(cacheScope);
  if (lastWorking && !staticCandidates.includes(lastWorking)) {
    return [lastWorking, ...filtered];
  }
  if (filtered.length === 0 && verifiedSet) {
    return Array.from(verifiedSet).filter((m) => !isModelKnownNotFound(cacheScope, m)).slice(0, 4);
  }
  return filtered.length > 0 ? filtered : staticCandidates;
}
var AiServiceError = class extends Error {
  constructor(message, statusCode, code, upstreamType, meta = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.upstreamType = upstreamType;
    this.retryAfterSeconds = meta.retryAfterSeconds;
    this.geminiErrorCode = meta.geminiErrorCode;
    this.rateLimitSource = meta.rateLimitSource;
    this.quotaExhausted = meta.quotaExhausted;
    this.retryCount = meta.retryCount;
    this.model = meta.model;
    this.attemptedModels = meta.attemptedModels;
    this.fallbackAttempted = meta.fallbackAttempted;
    this.upstreamStatus = meta.upstreamStatus;
  }
};
function redactSecrets(text) {
  let out = String(text ?? "");
  const key = getGeminiApiKey();
  if (key) out = out.split(key).join("[redacted]");
  return out.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]").replace(/AQ\.[0-9A-Za-z_.-]{20,}/g, "[redacted]");
}
function getClient() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new AiServiceError(
      `The AI assistant has no Gemini API key on the server. Add GEMINI_API_KEY to the .env file in the project folder (or to your host's environment variables), restart the server, and try again. Run "npm run diagnose:gemini" to check.`,
      503,
      "MISSING_API_KEY",
      "missing_api_key"
    );
  }
  const keyInfo = getGeminiKeyInfo();
  if (keyInfo.formatIssue && /whitespace|non-ASCII/.test(keyInfo.formatIssue)) {
    throw new AiServiceError(
      `${keyInfo.formatIssue} Re-paste the key as one line with no spaces, then restart the server.`,
      503,
      "AI_CONFIG_ERROR",
      "key_format_error"
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
function getAiStatus() {
  const normalized = normalizeGeminiModelName(process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);
  const fallback = normalizeFallbackGeminiModel(process.env.GEMINI_FALLBACK_MODEL, normalized.model);
  const keyInfo = getGeminiKeyInfo();
  return {
    configured: Boolean(getGeminiApiKey()),
    model: normalized.model,
    fallbackModel: fallback.model,
    ...keyInfo.formatIssue ? { keyWarning: keyInfo.formatIssue } : {},
    ...normalized.invalidOverride ? {
      modelWarning: `GEMINI_MODEL contains an unrecognized value and was ignored; using default ${DEFAULT_GEMINI_MODEL}. Check GEMINI_MODEL and GEMINI_API_KEY in environment secrets.`
    } : {},
    ...fallback.invalidOverride ? {
      fallbackModelWarning: `GEMINI_FALLBACK_MODEL contains an unrecognized value and was ignored; using fallback ${fallback.model ?? DEFAULT_GEMINI_FALLBACK_MODEL}.`
    } : {}
  };
}
function languageInstruction(language) {
  switch (language) {
    case "hi":
      return "Respond in warm, simple, clear Hindi (Devanagari script) suitable for an older adult. Keep technical terms simple.";
    case "mr":
      return "Respond in warm, simple, clear Marathi (Devanagari script) suitable for an older adult. Keep technical terms simple.";
    case "hinglish":
      return "Respond in warm, friendly Hinglish (conversational Hindi written in Latin/English letters mixed with simple everyday English words) suitable for an older adult.";
    default:
      return "Respond in warm, patient, easy-to-read English suitable for an older adult. Use short paragraphs and clear numbered steps.";
  }
}
function parseRetrySeconds(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.ceil(value);
  }
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  const secMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/i);
  if (secMatch) {
    const num = Number(secMatch[1]);
    return num > 0 ? Math.ceil(num) : void 0;
  }
  const intNum = Number(trimmed);
  if (Number.isFinite(intNum) && intNum > 0) {
    return Math.ceil(intNum);
  }
  return void 0;
}
function extractErrorContext(err) {
  const raw = err instanceof Error ? err.message : String(err ?? "Unknown AI provider error");
  const errObj = err;
  const sdkStatus = typeof errObj?.status === "number" ? errObj.status : void 0;
  const sdkCode = errObj?.code;
  let jsonMessage;
  let jsonCode;
  let jsonStatus;
  let detailRetrySeconds;
  let detailQuotaText = "";
  const reasons = [];
  const jsonStart = raw.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (typeof parsed?.error?.message === "string" && parsed.error.message.trim()) {
        jsonMessage = parsed.error.message.trim();
      }
      if (typeof parsed?.error?.code === "number") {
        jsonCode = parsed.error.code;
      }
      if (typeof parsed?.error?.status === "string") {
        jsonStatus = parsed.error.status;
      }
      if (Array.isArray(parsed?.error?.details)) {
        for (const d of parsed.error.details) {
          if (typeof d?.reason === "string" && d.reason) reasons.push(d.reason);
          if (d?.retryDelay) {
            const parsedSec = parseRetrySeconds(d.retryDelay);
            if (parsedSec !== void 0) detailRetrySeconds = parsedSec;
          }
          if (Array.isArray(d?.violations)) {
            detailQuotaText += " " + d.violations.map((v) => `${v?.quotaId ?? ""} ${v?.quotaMetric ?? ""} ${v?.description ?? ""}`).join(" ");
          }
        }
      }
    } catch {
    }
  }
  let headerRetrySeconds;
  const hdrs = errObj?.headers ?? errObj?.response?.headers;
  if (hdrs) {
    const rawHdr = typeof hdrs.get === "function" ? hdrs.get("retry-after") : hdrs["retry-after"] ?? hdrs["Retry-After"];
    headerRetrySeconds = parseRetrySeconds(rawHdr);
  }
  let textRetrySeconds;
  const retryTextMatch = raw.match(/retry\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i);
  if (retryTextMatch) {
    const num = Number(retryTextMatch[1]);
    if (Number.isFinite(num) && num > 0) textRetrySeconds = Math.ceil(num);
  }
  const retryAfterSeconds = headerRetrySeconds ?? detailRetrySeconds ?? textRetrySeconds;
  const friendly = jsonMessage || raw;
  const numericCode = jsonCode ?? sdkStatus ?? (typeof sdkCode === "number" ? sdkCode : void 0);
  const combinedLower = [
    raw,
    friendly,
    detailQuotaText,
    sdkStatus !== void 0 ? String(sdkStatus) : "",
    sdkCode !== void 0 ? String(sdkCode) : "",
    jsonCode !== void 0 ? String(jsonCode) : "",
    jsonStatus ?? ""
  ].join(" ").toLowerCase();
  const isDailyQuotaExhausted = combinedLower.includes("quota_exceeded") || combinedLower.includes("perday") || combinedLower.includes("per_day") || combinedLower.includes("requestsperday") || combinedLower.includes("daily quota") || combinedLower.includes("daily limit") || combinedLower.includes("limit: 0") || combinedLower.includes("billing") && combinedLower.includes("quota") || retryAfterSeconds !== void 0 && retryAfterSeconds > 60;
  const geminiErrorCode = jsonStatus || typeof sdkCode === "string" && sdkCode || (numericCode !== void 0 ? String(numericCode) : void 0);
  return {
    friendly,
    combinedLower,
    numericCode,
    geminiErrorCode,
    retryAfterSeconds,
    isDailyQuotaExhausted,
    googleStatus: jsonStatus,
    reasons,
    upstreamMessage: jsonMessage
  };
}
function classifyGeminiError(err, modelName = getConfiguredGeminiModel(), retryCount = 0) {
  if (err instanceof AiServiceError) {
    if (err.retryCount === void 0) err.retryCount = retryCount;
    if (!err.model) err.model = modelName;
    return err;
  }
  const {
    friendly,
    combinedLower,
    numericCode,
    geminiErrorCode,
    retryAfterSeconds,
    isDailyQuotaExhausted,
    googleStatus,
    reasons
  } = extractErrorContext(err);
  const hasStatus = numericCode !== void 0;
  const reasonSet = new Set(reasons.map((r) => r.toUpperCase()));
  const detailCode = reasons[0] ?? geminiErrorCode;
  const meta = {
    geminiErrorCode: detailCode,
    upstreamStatus: numericCode,
    retryCount,
    model: modelName
  };
  const has = (re) => re.test(combinedLower);
  if (numericCode === 504 || numericCode === 408 || googleStatus === "DEADLINE_EXCEEDED" || !hasStatus && has(/etimedout|timed out|timeout|aborterror/)) {
    return new AiServiceError(
      "Buddy took a little too long to answer. Your question has been saved. Please tap Retry in a moment.",
      504,
      "AI_TIMEOUT",
      "timeout",
      meta
    );
  }
  if (numericCode === 429 || googleStatus === "RESOURCE_EXHAUSTED" || !hasStatus && has(/resource_exhausted|rate limit|\bquota\b/)) {
    if (isDailyQuotaExhausted) {
      return new AiServiceError(
        FRIENDLY_AI_QUOTA_MESSAGE,
        429,
        "AI_QUOTA_EXHAUSTED",
        "quota_exhausted",
        {
          ...meta,
          retryAfterSeconds,
          geminiErrorCode: geminiErrorCode || "RESOURCE_EXHAUSTED",
          rateLimitSource: "gemini_provider",
          quotaExhausted: true
        }
      );
    }
    const waitHint = retryAfterSeconds ?? 15;
    return new AiServiceError(
      `Buddy is helping many people right now. Your question has been saved. Please wait ${waitHint} seconds and tap Retry.`,
      429,
      "AI_RATE_LIMIT",
      "rate_limit",
      {
        ...meta,
        retryAfterSeconds: waitHint,
        geminiErrorCode: geminiErrorCode || "RESOURCE_EXHAUSTED",
        rateLimitSource: "gemini_provider",
        quotaExhausted: false
      }
    );
  }
  const isLeaked = has(/leaked/);
  const isExpired = has(/api key (?:has )?expired|key expired/);
  const isInvalidKey = numericCode === 401 || googleStatus === "UNAUTHENTICATED" || reasonSet.has("API_KEY_INVALID") || reasonSet.has("API_KEY_NOT_FOUND") || has(/api key not valid|invalid api key|api_key_invalid|api key not found|pass a valid api key|unauthenticated/);
  if (isLeaked) {
    return new AiServiceError(
      "Google has disabled this GEMINI_API_KEY because it was reported as leaked/public. Create a brand-new key in Google AI Studio, put it in your server environment, and restart the server.",
      502,
      "AI_AUTH_ERROR",
      "key_leaked",
      meta
    );
  }
  if (isExpired) {
    return new AiServiceError(
      "The GEMINI_API_KEY has expired. Create a new key in Google AI Studio, put it in your server environment, and restart the server.",
      502,
      "AI_AUTH_ERROR",
      "key_expired",
      meta
    );
  }
  if (isInvalidKey) {
    return new AiServiceError(
      'Google rejected the GEMINI_API_KEY this server is using (key not valid). If you recently changed the key, restart the server and make sure no older GEMINI_API_KEY is set in your shell/OS environment or on your host (run "npm run diagnose:gemini" to see which source is used).',
      502,
      "AI_AUTH_ERROR",
      "auth_error",
      meta
    );
  }
  const isPermission = numericCode === 403 || googleStatus === "PERMISSION_DENIED" || has(/permission_denied|\"code\":403/);
  if (isPermission) {
    if (reasonSet.has("SERVICE_DISABLED") || has(/has not been used in project|api is not enabled|service_disabled|is disabled/)) {
      return new AiServiceError(
        "The Generative Language API is not enabled for the Google Cloud project that owns this GEMINI_API_KEY. Enable it in Google Cloud Console (or create the key in Google AI Studio), then try again.",
        502,
        "AI_PERMISSION_ERROR",
        "service_disabled",
        meta
      );
    }
    if ([...reasonSet].some((r) => r.startsWith("API_KEY_")) || has(/are blocked|referer|referrer|ip address|restriction|api_key_service_blocked/)) {
      return new AiServiceError(
        "This GEMINI_API_KEY has restrictions (API, website/referrer, or IP limits) that block this server. In Google Cloud Console > Credentials, remove the restriction or allow the Generative Language API for server use.",
        502,
        "AI_PERMISSION_ERROR",
        "key_restricted",
        meta
      );
    }
    if (has(/model/) && has(/access|allowlist|not allowed|not authorized|entitle/)) {
      return new AiServiceError(
        `This GEMINI_API_KEY does not have access to model "${modelName}". Set GEMINI_MODEL to a model your key can use (run "npm run diagnose:gemini" to check).`,
        502,
        "AI_MODEL_ERROR",
        "model_access_denied",
        meta
      );
    }
    return new AiServiceError(
      'Google denied permission for this request (HTTP 403 PERMISSION_DENIED). The key may be invalid, restricted, or its project may lack access. Run "npm run diagnose:gemini" for the exact cause.',
      502,
      "AI_AUTH_ERROR",
      "permission_denied",
      meta
    );
  }
  const isModelText = has(
    /unexpected model name format|is not found for api version|not supported for generatecontent|models\/\S+ is not found|model\b.{0,40}\b(?:not found|not supported|is not available)/
  );
  if (numericCode === 404 || googleStatus === "NOT_FOUND" || has(/\"code\":404/) || isModelText) {
    return new AiServiceError(
      `Configured Gemini model "${modelName}" is unavailable or unsupported for this API key. Your question has been saved. Ask an administrator to verify GEMINI_MODEL.`,
      502,
      "AI_MODEL_ERROR",
      "invalid_or_unavailable_model",
      meta
    );
  }
  if (googleStatus === "FAILED_PRECONDITION" || has(/user location is not supported|billing/)) {
    const region = has(/location is not supported/);
    return new AiServiceError(
      region ? "Google does not allow Gemini API use from this server location. Host the backend in a supported region." : "Google requires billing to be enabled on the project that owns this GEMINI_API_KEY before this model can be used.",
      502,
      "AI_PERMISSION_ERROR",
      region ? "location_unsupported" : "billing_required",
      meta
    );
  }
  if (numericCode === 400 || googleStatus === "INVALID_ARGUMENT") {
    return new AiServiceError(
      `Gemini rejected the request settings for model "${modelName}" (HTTP 400 INVALID_ARGUMENT). Details are in the server log.`,
      502,
      "AI_BAD_REQUEST",
      "bad_request",
      meta
    );
  }
  if (has(/fetch failed|enotfound|econnrefused|econnreset|ehostunreach|socket hang up|network/)) {
    return new AiServiceError(
      "Unable to reach the Gemini AI service due to a network connection issue. Please try again shortly.",
      502,
      "AI_NETWORK_ERROR",
      "network_error",
      meta
    );
  }
  if (numericCode === 503 || has(/unavailable|overloaded|high demand/)) {
    return new AiServiceError(
      FRIENDLY_AI_BUSY_MESSAGE,
      503,
      "UPSTREAM_ERROR",
      "service_unavailable",
      meta
    );
  }
  return new AiServiceError(
    `Unable to reach Buddy AI right now: ${redactSecrets(friendly).slice(0, 300)}`,
    502,
    "UPSTREAM_ERROR",
    "upstream_error",
    meta
  );
}
function getRetryDelayMs(err, attempt) {
  if (attempt < 1 || attempt > MAX_TRANSIENT_RETRIES) {
    return null;
  }
  const ctx = extractErrorContext(err);
  if (ctx.combinedLower.includes("etimedout") || ctx.combinedLower.includes("aborterror") || ctx.combinedLower.includes("aborted") || ctx.isDailyQuotaExhausted) {
    return null;
  }
  if (ctx.numericCode === 429 || ctx.combinedLower.includes("resource_exhausted") || ctx.combinedLower.includes("rate limit")) {
    if (ctx.retryAfterSeconds !== void 0) {
      if (ctx.retryAfterSeconds > 5) return null;
      return Math.min(2500, ctx.retryAfterSeconds * 1e3 + Math.floor(Math.random() * 250));
    }
    const base2 = 700 * Math.pow(2, attempt - 1);
    const jitter2 = Math.floor(Math.random() * 350);
    return Math.min(2500, base2 + jitter2);
  }
  const isTransientNetOr503 = ctx.numericCode === 503 || ctx.combinedLower.includes("unavailable") || ctx.combinedLower.includes("econnreset") || ctx.combinedLower.includes("fetch failed");
  if (!isTransientNetOr503) return null;
  const base = 600 * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 300);
  return Math.min(2500, base + jitter);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function withAttemptTimeout(fn, timeoutMs = 25e3) {
  const controller = new AbortController();
  let timer;
  return Promise.race([
    fn(controller.signal),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("ETIMEDOUT: AI service took too long to respond"));
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
function parseBuddyModelPayload(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new AiServiceError(
      "Buddy Elder AI returned an empty response. Please try asking your question again.",
      502,
      "AI_EMPTY_RESPONSE",
      "empty_response"
    );
  }
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenceMatch ? fenceMatch[1] : trimmed).trim();
  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.reply === "string" && parsed.reply.trim().length > 0) {
        const cleanSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s) => typeof s === "string" && s.trim().length > 0).slice(0, 3) : [];
        return { reply: parsed.reply.trim(), suggestions: cleanSuggestions };
      }
    } catch {
    }
  }
  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return { reply: candidate, suggestions: [] };
  }
  throw new AiServiceError(
    "Buddy Elder AI returned an unreadable response. Please tap Retry.",
    502,
    "AI_EMPTY_RESPONSE",
    "malformed_model_json"
  );
}
function extractCandidateText(response) {
  const blockReason = response.promptFeedback?.blockReason;
  const finishReason = response.candidates?.[0]?.finishReason;
  const safetyBlocked = Boolean(blockReason) || finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || finishReason === "BLOCKLIST" || finishReason === "RECITATION";
  if (safetyBlocked) {
    throw new AiServiceError(
      "I cannot answer that specific request safely. Please ask another question about daily technology, phone help, or staying safe online.",
      422,
      "AI_SAFETY_BLOCK",
      `safety_block:${blockReason || finishReason || "unknown"}`
    );
  }
  const directText = typeof response.text === "string" ? response.text.trim() : "";
  if (directText) return directText;
  const partText = (response.candidates?.[0]?.content?.parts ?? []).map((p) => typeof p.text === "string" ? p.text : "").join("").trim();
  return partText;
}
function supportsThinkingLevel(modelName) {
  return /^gemini-[34](?:[.-]|$)/i.test(modelName.trim());
}
function buildBuddyChatConfig(systemInstruction, signal, modelName = getConfiguredGeminiModel()) {
  return {
    ...signal ? { abortSignal: signal } : {},
    systemInstruction,
    ...supportsThinkingLevel(modelName) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {},
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        reply: {
          type: Type.STRING,
          description: "The warm, clear, step-by-step answer specifically answering the user question."
        },
        suggestions: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "2 short, helpful follow-up questions in the same language."
        }
      },
      required: ["reply", "suggestions"]
    }
  };
}
function shouldTryFallbackModel(err) {
  return err.code === "AI_QUOTA_EXHAUSTED" || err.code === "AI_RATE_LIMIT" || err.code === "AI_MODEL_ERROR" || err.code === "AI_TIMEOUT" || err.code === "UPSTREAM_ERROR" && err.upstreamStatus === 503;
}
async function generateBuddyReply(params) {
  const startedAt = Date.now();
  const budgetDeadline = startedAt + AI_TOTAL_BUDGET_MS;
  const ai = getClient();
  const cacheScope = getAiCacheScope();
  const candidateModels = buildEffectiveCandidateModels(cacheScope);
  const systemInstruction = [
    `You are Buddy Elder AI, a patient, respectful, and trustworthy digital companion helping ${params.userName}, a senior citizen.`,
    languageInstruction(params.language),
    "Give direct, practical, step-by-step instructions tailored specifically to the exact question asked (smartphones, WhatsApp, volume controls, bank/scam safety, Wi-Fi, internet, maps, and everyday tools).",
    "Keep responses concise (around 80-180 words unless detailed steps are needed) and easy to listen to when read aloud.",
    "STRICT SAFETY RULES:",
    "1. Never ask for or accept OTPs, passwords, bank PINs, card numbers, or Aadhaar/SSN details.",
    "2. Never diagnose medical conditions or prescribe treatments. If someone describes urgent medical pain, chest pain, breathing trouble, or immediate danger, gently advise calling local emergency services (112 / 108 / 911) or a doctor right away.",
    "3. Never claim to be emergency services, police, or a bank.",
    "4. If unsure, admit uncertainty honestly and suggest verifying with a trusted family member or official helpline.",
    "5. At the end, suggest 2 short helpful follow-up questions the senior can ask next."
  ].join("\n");
  const validHistory = params.history.filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0).slice(-12);
  const contents = [];
  for (const item of validHistory) {
    const role = item.role === "assistant" ? "model" : "user";
    const text = item.content.trim();
    if (contents.length === 0 && role === "model") {
      continue;
    }
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) {
      prev.parts[0].text = `${prev.parts[0].text}

${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }
  const lastTurn = contents[contents.length - 1];
  if (lastTurn && lastTurn.role === "user") {
    lastTurn.parts[0].text = `${lastTurn.parts[0].text}

${params.userMessage}`;
  } else {
    contents.push({
      role: "user",
      parts: [{ text: params.userMessage }]
    });
  }
  const attemptedModels = [];
  const attemptedSet = /* @__PURE__ */ new Set();
  const failedAttempts = [];
  let lastClassified = null;
  let totalFailures = 0;
  const invokeModel = async (modelName) => {
    const response = await withAttemptTimeout(
      (signal) => ai.models.generateContent({
        model: modelName,
        contents,
        config: buildBuddyChatConfig(systemInstruction, signal, modelName)
      }),
      AI_ATTEMPT_TIMEOUT_MS
    );
    const raw = extractCandidateText(
      response
    );
    const parsed = parseBuddyModelPayload(raw);
    recordModelOutcome(cacheScope, modelName);
    return {
      reply: parsed.reply,
      suggestions: parsed.suggestions,
      model: modelName,
      fallbackUsed: attemptedModels.length > 1 || modelName !== candidateModels[0],
      attemptedModels,
      durationMs: Date.now() - startedAt,
      retryCount: totalFailures
    };
  };
  for (let idx = 0; idx < candidateModels.length; idx++) {
    const modelName = candidateModels[idx];
    const hasNextFallback = idx < candidateModels.length - 1;
    attemptedModels.push(modelName);
    attemptedSet.add(modelName);
    try {
      return await invokeModel(modelName);
    } catch (err) {
      totalFailures++;
      const classified = classifyGeminiError(err, modelName, totalFailures - 1);
      recordModelOutcome(cacheScope, modelName, classified);
      classified.attemptedModels = [...attemptedModels];
      classified.fallbackAttempted = attemptedModels.length > 1;
      lastClassified = classified;
      failedAttempts.push({ model: modelName, rawErr: err, classified });
      if (hasNextFallback && shouldTryFallbackModel(classified)) {
        const nextModel = candidateModels[idx + 1];
        console.warn("[Buddy AI Model Fallback]", {
          fromModel: modelName,
          toModel: nextModel,
          reasonCode: classified.code,
          upstreamStatus: classified.upstreamStatus ?? null,
          geminiErrorCode: classified.geminiErrorCode ?? null,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        continue;
      }
      if (!shouldTryFallbackModel(classified)) {
        break;
      }
    }
  }
  if (lastClassified && shouldTryFallbackModel(lastClassified) && Date.now() < budgetDeadline) {
    const available = await discoverAvailableGeminiModels(ai, cacheScope);
    const extraCandidates = available.filter((m) => !attemptedSet.has(m) && !isModelKnownNotFound(cacheScope, m)).slice(0, 4);
    for (const extraModel of extraCandidates) {
      if (Date.now() >= budgetDeadline) break;
      const prevModel = attemptedModels[attemptedModels.length - 1] ?? candidateModels[0];
      console.warn("[Buddy AI Verified Model Fallback]", {
        fromModel: prevModel,
        toModel: extraModel,
        reasonCode: lastClassified.code,
        upstreamStatus: lastClassified.upstreamStatus ?? null,
        geminiErrorCode: lastClassified.geminiErrorCode ?? null,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      attemptedModels.push(extraModel);
      attemptedSet.add(extraModel);
      try {
        return await invokeModel(extraModel);
      } catch (err) {
        totalFailures++;
        const classified = classifyGeminiError(err, extraModel, totalFailures - 1);
        recordModelOutcome(cacheScope, extraModel, classified);
        classified.attemptedModels = [...attemptedModels];
        classified.fallbackAttempted = true;
        lastClassified = classified;
        failedAttempts.push({ model: extraModel, rawErr: err, classified });
        if (!shouldTryFallbackModel(classified)) {
          break;
        }
      }
    }
  }
  const activeRetryTargets = failedAttempts.filter((a) => {
    if (a.classified.code === "AI_AUTH_ERROR" || a.classified.code === "AI_PERMISSION_ERROR" || a.classified.code === "AI_QUOTA_EXHAUSTED" || a.classified.code === "AI_MODEL_ERROR" || a.classified.code === "AI_BAD_REQUEST" || a.classified.code === "AI_SAFETY_BLOCK" || a.classified.code === "AI_CONFIG_ERROR") {
      return false;
    }
    return getRetryDelayMs(a.rawErr, 1) !== null;
  });
  if (activeRetryTargets.length > 0 && lastClassified && shouldTryFallbackModel(lastClassified) && Date.now() < budgetDeadline) {
    let lastRawErr = activeRetryTargets[0].rawErr;
    let lastReasonCode = activeRetryTargets[0].classified.code;
    let lastGeminiCode = activeRetryTargets[0].classified.geminiErrorCode ?? null;
    for (let retryAttempt = 1; retryAttempt <= MAX_TRANSIENT_RETRIES; retryAttempt++) {
      if (activeRetryTargets.length === 0 || Date.now() >= budgetDeadline) break;
      const delayMs = getRetryDelayMs(lastRawErr, retryAttempt);
      if (delayMs === null) break;
      const targetIdx = retryAttempt % activeRetryTargets.length;
      const targetEntry = activeRetryTargets[targetIdx];
      const targetModel = targetEntry.model;
      console.warn("[Buddy AI Transient Retry]", {
        model: targetModel,
        attempt: retryAttempt,
        maxRetries: MAX_TRANSIENT_RETRIES,
        delayMs,
        reasonCode: lastReasonCode,
        geminiErrorCode: lastGeminiCode,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      await sleep(delayMs);
      try {
        return await invokeModel(targetModel);
      } catch (err) {
        totalFailures++;
        lastRawErr = err;
        const classified = classifyGeminiError(err, targetModel, totalFailures - 1);
        recordModelOutcome(cacheScope, targetModel, classified);
        classified.attemptedModels = [...attemptedModels];
        classified.fallbackAttempted = attemptedModels.length > 1;
        lastClassified = classified;
        lastReasonCode = classified.code;
        lastGeminiCode = classified.geminiErrorCode ?? null;
        failedAttempts.push({ model: targetModel, rawErr: err, classified });
        if (classified.code === "AI_AUTH_ERROR" || classified.code === "AI_PERMISSION_ERROR" || classified.code === "AI_BAD_REQUEST") {
          break;
        }
        if (classified.code === "AI_QUOTA_EXHAUSTED" || classified.code === "AI_MODEL_ERROR") {
          activeRetryTargets.splice(targetIdx, 1);
          if (activeRetryTargets.length > 0) {
            lastRawErr = activeRetryTargets[0].rawErr;
            lastReasonCode = activeRetryTargets[0].classified.code;
            lastGeminiCode = activeRetryTargets[0].classified.geminiErrorCode ?? null;
          }
        }
      }
    }
  }
  const transientValidFailure = failedAttempts.find((a) => a.classified.code === "UPSTREAM_ERROR" || a.classified.code === "AI_RATE_LIMIT")?.classified ?? null;
  const quotaValidFailure = failedAttempts.find((a) => a.classified.code === "AI_QUOTA_EXHAUSTED")?.classified ?? null;
  const finalError = lastClassified?.code === "AI_MODEL_ERROR" ? transientValidFailure ?? quotaValidFailure ?? lastClassified : lastClassified;
  if (finalError) {
    finalError.attemptedModels = attemptedModels;
    finalError.fallbackAttempted = attemptedModels.length > 1;
    if (finalError.code === "UPSTREAM_ERROR" && finalError.upstreamStatus === 503) {
      finalError.message = FRIENDLY_AI_BUSY_MESSAGE;
    }
    throw finalError;
  }
  throw new AiServiceError(
    FRIENDLY_AI_BUSY_MESSAGE,
    503,
    "UPSTREAM_ERROR",
    "no_model_available"
  );
}
function runDeterministicScamChecks(content, inputType = "message") {
  const lower = content.toLowerCase();
  const normalizedType = inputType.trim().toLowerCase();
  const indicators = [];
  let score = 0;
  const criticalPatterns = [
    {
      regex: /\b(otp|one[\s-]?time[\s-]?password|verification code|cvv|atm pin|upi pin|mpin|netbanking password)\b/i,
      label: "Requests OTP, PIN, password, or secret verification code",
      weight: 4
    },
    {
      regex: /\b(anydesk|teamviewer|quicksupport|rustdesk|screen[\s-]?share|remote access)\b/i,
      label: "Mentions remote screen-sharing software often abused in scams",
      weight: 4
    },
    {
      regex: /\b(kyc.{0,30}(expire|suspend|block|update|verify|pending)|(expire|suspend|block|update|verify|complete).{0,25}\bkyc\b|(bank\s*)?account\b.{0,30}(block|freeze|suspend|close|deactivat|hold)|debit card.{0,20}(block|suspend)|credit card.{0,20}(block|suspend)|pan.{0,20}update|sim.{0,20}(block|suspend))\b/i,
      label: "Threatens bank account, card, SIM, or KYC suspension/blocking",
      weight: 3
    },
    {
      regex: /\b(click (this|the|below|here)?\s*link|tap (this|the|below)?\s*link|open (this|the)\s*link|verify (now|here|immediately)|login here)\b/i,
      label: "Pressures you to click a verification link",
      weight: 2
    },
    {
      regex: /\b(urgent|immediately|today only|right now|within \d+\s*(min|mins|minute|minutes|hour|hours|hr|hrs)|last warning|final notice|act now)\b/i,
      label: "Creates urgent time pressure to rush your decision",
      weight: 2
    },
    {
      regex: /\b(lottery|prize|jackpot|won\s*(rs|₹|\$|inr|usd|lakh|crore)|lucky draw|gift voucher|free gift)\b/i,
      label: "Claims unexpected lottery, prize, or reward winnings",
      weight: 3
    },
    {
      regex: /\b(digital arrest|cbi|ncb|customs parcel|arrest warrant|police case|cyber crime notice|tax notice)\b/i,
      label: "Impersonates police, customs, tax, or government officials with threats",
      weight: 4
    },
    {
      regex: /\b(pay\s*now|urgent\s*(transfer|payment)|send\s*money|deposit\s*fee|processing\s*fee|upi collect|scan qr to receive|received by mistake|refund claim|lost my phone|new number.*money)\b/i,
      label: "Requests money transfer, fake refund/QR approval, or upfront fee",
      weight: 3
    },
    {
      regex: /(bit\.ly|tinyurl\.com|cutt\.ly|rb\.gy|shorturl|is\.gd|t\.co|http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
      label: "Contains shortened or raw IP web link",
      weight: 3
    },
    {
      regex: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:xyz|top|click|tk|ml|ga|cf|gq|work|loan|vip)(?:\/[^\s]*)?/i,
      label: "Uses an unfamiliar or high-risk domain extension",
      weight: 2
    },
    {
      regex: /\b(guaranteed\s*return|double\s*your\s*money|work\s*from\s*home.*daily|part[\s-]?time\s*job.*whatsapp|crypto\s*profit|guaranteed\s*profit)\b/i,
      label: "Promises unrealistic investment or work-from-home returns",
      weight: 3
    },
    {
      regex: /https?:\/\/[^\s]+/i,
      label: "Contains an external web link to verify carefully before opening",
      weight: 1
    }
  ];
  for (const p of criticalPatterns) {
    if (p.regex.test(lower)) {
      indicators.push(p.label);
      score += p.weight;
    }
  }
  if (normalizedType === "url" && score === 0) {
    const looksLikeDomain = /(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(lower);
    if (looksLikeDomain) {
      const suspiciousKeywordsInUrl = /(kyc|verify|login|secure|bank|update|account|wallet|refund|claim|support)/i.test(lower);
      if (suspiciousKeywordsInUrl) {
        indicators.push("Web link uses account-verification or banking keywords \u2014 verify official domain spelling");
        score += 3;
      } else {
        indicators.push("External link submitted \u2014 confirm the domain belongs to the official organization");
        score += 2;
      }
    }
  }
  if (normalizedType === "phone") {
    const compactPhone = content.replace(/[\s().-]+/g, "");
    const looksLikePhone = /^\+?\d{7,15}$/.test(compactPhone);
    if (looksLikePhone && score < 2) {
      indicators.push("Unknown phone number \u2014 caller identity cannot be verified from a number alone");
      score = Math.max(score, 2);
    }
  }
  const requiresPause = score >= 3 || /\b(urgent|immediately|within \d+ (min|hour)|today only|otp|upi|transfer|pay)\b/i.test(lower);
  if (score >= 4) {
    return { riskLevel: "RED", indicators, requiresPause: true };
  }
  if (score >= 2) {
    return { riskLevel: "YELLOW", indicators, requiresPause };
  }
  return { riskLevel: "GREEN", indicators, requiresPause: false };
}
function buildHeuristicScamResult(heuristic, inputType, source, fallbackReason) {
  const typeName = inputType.trim().toUpperCase() || "MESSAGE";
  const defaultRedActions = [
    "Do not click any links or call numbers listed inside this message.",
    "Never share OTPs, passwords, or bank/UPI PINs.",
    "Do not send money or install remote-access apps like AnyDesk or TeamViewer.",
    "Contact your bank or official institution directly using the phone number on the back of your card or passbook.",
    "Check with a trusted family member before taking any action."
  ];
  const defaultYellowActions = [
    "Pause and verify who actually sent this before replying or tapping anything.",
    "Open your official bank or service app directly rather than using links or numbers from the message.",
    "Ask a trusted family member to review this together with you."
  ];
  const defaultGreenActions = [
    "No obvious scam signs were detected, though automated checks cannot guarantee 100% safety.",
    "Still avoid sharing OTPs, PINs, or passwords with anyone."
  ];
  const matchedSummary = heuristic.indicators.length > 0 ? heuristic.indicators.slice(0, 3).join("; ") : "";
  let explanation;
  if (heuristic.riskLevel === "RED") {
    explanation = `Warning: This ${typeName} shows strong scam signs (${matchedSummary}). Real banks and official agencies do not threaten sudden account blocking or pressure you to click links or share secret codes.`;
  } else if (heuristic.riskLevel === "YELLOW") {
    explanation = matchedSummary ? `Caution: This ${typeName} contains warning signs (${matchedSummary}). Please verify it directly through an official app, card helpline, or family member before acting.` : `Caution: This ${typeName} should be verified independently before you reply, click links, or share personal details.`;
  } else {
    explanation = `No obvious scam patterns were detected in this ${typeName}. Even when a check looks safe, automated checks cannot guarantee 100% safety, so always verify unexpected requests.`;
  }
  return {
    riskLevel: heuristic.riskLevel,
    explanation,
    indicators: heuristic.indicators.length > 0 ? heuristic.indicators : ["No known high-risk scam patterns detected in this message"],
    recommendedActions: heuristic.riskLevel === "RED" ? defaultRedActions : heuristic.riskLevel === "YELLOW" ? defaultYellowActions : defaultGreenActions,
    requiresPause: heuristic.requiresPause,
    source,
    ...fallbackReason ? { fallbackReason } : {}
  };
}
async function analyzeScamContent(params) {
  const heuristic = runDeterministicScamChecks(params.content, params.inputType);
  const status = getAiStatus();
  if (!status.configured) {
    return buildHeuristicScamResult(heuristic, params.inputType, "heuristic_offline", "MISSING_API_KEY");
  }
  const cacheScope = getAiCacheScope();
  const candidateModels = [...buildEffectiveCandidateModels(cacheScope)];
  const attemptedScamModels = /* @__PURE__ */ new Set();
  const scamAiTimeoutMs = isVercelRuntime() ? 6e3 : 1e4;
  let lastClassified = null;
  let discoveredExpanded = false;
  for (let idx = 0; idx < candidateModels.length; idx++) {
    const modelName = candidateModels[idx];
    if (attemptedScamModels.has(modelName)) continue;
    attemptedScamModels.add(modelName);
    const hasNextFallback = idx < candidateModels.length - 1;
    try {
      const ai = getClient();
      const response = await withAttemptTimeout(
        (signal) => ai.models.generateContent({
          model: modelName,
          contents: `Analyze this ${params.inputType} for scam, phishing, UPI/bank fraud, impersonation, or social engineering risk:

"""${params.content}"""`,
          config: {
            abortSignal: signal,
            systemInstruction: [
              "You are a scam-protection advisor for senior citizens.",
              languageInstruction(params.language),
              "Classify riskLevel as GREEN (no obvious risk found), YELLOW (be careful / verify), or RED (likely scam).",
              "Never claim 100% certainty. Even for GREEN, remind the user that safety checks cannot guarantee safety.",
              "For RED, include clear protective instructions (no links, no OTPs/PINs/passwords, no remote apps, verify via official numbers, ask family)."
            ].join("\n"),
            ...supportsThinkingLevel(modelName) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {},
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                riskLevel: { type: Type.STRING, enum: ["GREEN", "YELLOW", "RED"] },
                explanation: { type: Type.STRING },
                indicators: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["riskLevel", "explanation", "indicators", "recommendedActions"]
            }
          }
        }),
        scamAiTimeoutMs
      );
      const rawText = extractCandidateText(
        response
      );
      const fenceMatch = rawText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      const cleanJson = (fenceMatch ? fenceMatch[1] : rawText).trim();
      const parsed = JSON.parse(cleanJson);
      recordModelOutcome(cacheScope, modelName);
      const rank = { GREEN: 1, YELLOW: 2, RED: 3 };
      const aiLevel = parsed.riskLevel && rank[parsed.riskLevel] ? parsed.riskLevel : heuristic.riskLevel;
      const finalLevel = rank[heuristic.riskLevel] > rank[aiLevel] ? heuristic.riskLevel : aiLevel;
      const mergedIndicators = Array.from(
        /* @__PURE__ */ new Set([
          ...Array.isArray(parsed.indicators) ? parsed.indicators.filter((x) => typeof x === "string" && x.trim()) : [],
          ...heuristic.indicators
        ])
      ).slice(0, 6);
      const fallbackActions = buildHeuristicScamResult(
        { ...heuristic, riskLevel: finalLevel },
        params.inputType,
        "heuristic_fallback"
      ).recommendedActions;
      const cleanAiActions = Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions.filter((x) => typeof x === "string" && x.trim()) : [];
      return {
        riskLevel: finalLevel,
        explanation: typeof parsed.explanation === "string" && parsed.explanation.trim() ? parsed.explanation.trim() : buildHeuristicScamResult({ ...heuristic, riskLevel: finalLevel }, params.inputType, "heuristic_fallback").explanation,
        indicators: mergedIndicators.length > 0 ? mergedIndicators : ["No immediate warning indicators detected, stay cautious"],
        recommendedActions: cleanAiActions.length > 0 ? cleanAiActions : fallbackActions,
        requiresPause: heuristic.requiresPause || finalLevel !== "GREEN",
        source: "ai"
      };
    } catch (err) {
      const classified = classifyGeminiError(err, modelName);
      recordModelOutcome(cacheScope, modelName, classified);
      lastClassified = classified;
      if (!hasNextFallback && !discoveredExpanded && shouldTryFallbackModel(classified)) {
        discoveredExpanded = true;
        const available = await discoverAvailableGeminiModels(getClient(), cacheScope);
        const extras = available.filter((m) => !attemptedScamModels.has(m) && !isModelKnownNotFound(cacheScope, m)).slice(0, 4);
        candidateModels.push(...extras);
      }
      if (idx < candidateModels.length - 1 && shouldTryFallbackModel(classified)) {
        console.warn("[Buddy Scam Check Fallback Switch]", {
          fromModel: modelName,
          toModel: candidateModels[idx + 1],
          reasonCode: classified.code,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        continue;
      }
      console.warn("[Buddy Scam Check Fallback]", {
        endpoint: "/api/scam/analyze",
        rateLimitSource: classified.rateLimitSource ?? null,
        httpStatus: classified.statusCode,
        geminiErrorCode: classified.geminiErrorCode ?? classified.code,
        upstreamStatus: classified.upstreamStatus ?? null,
        model: modelName,
        retryAfter: classified.retryAfterSeconds ?? null,
        retryCount: classified.retryCount ?? 0,
        inputType: params.inputType,
        fallbackReason: classified.code,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return buildHeuristicScamResult(heuristic, params.inputType, "heuristic_fallback", classified.code);
    }
  }
  return buildHeuristicScamResult(
    heuristic,
    params.inputType,
    "heuristic_fallback",
    lastClassified?.code ?? "UPSTREAM_ERROR"
  );
}

// server/ai-diagnostics.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function readSdkVersion() {
  try {
    const pkg = JSON.parse(
      fs3.readFileSync(path3.resolve(path3.dirname(fileURLToPath2(import.meta.url)), "../node_modules/@google/genai/package.json"), "utf8")
    );
    return pkg.version ?? null;
  } catch {
    return null;
  }
}
function withTimeout(fn, ms = 2e4) {
  let timer;
  return Promise.race([
    fn(),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("ETIMEDOUT: diagnostic step timed out")), ms);
    })
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
async function runGeminiDiagnostics(options = {}) {
  const model = getConfiguredGeminiModel();
  const fallbackModel = getConfiguredFallbackGeminiModel(model);
  const keyInfo = getGeminiKeyInfo();
  const envReport = getEnvLoadReport();
  const steps = [];
  let availableModels = [];
  let fallbackOk;
  let fallbackCategory;
  let fallbackMessage;
  let modelProbes;
  const report = () => {
    const failed = steps.find((s) => !s.ok && s.category !== "skipped");
    const overallOk = !failed && steps.length > 0 || Boolean(fallbackOk && failed?.id !== "auth" && failed?.id !== "config");
    let verdict = "Gemini key, model and chat request all work.";
    if (failed) {
      verdict = fallbackOk && fallbackModel ? `Primary model ${model} failed (${failed.message}), but fallback model ${fallbackModel} works.` : `${failed.label}: ${failed.message}`;
    }
    return {
      ok: overallOk,
      verdict,
      model,
      fallbackModel,
      ...fallbackCategory ? { fallbackOk, fallbackCategory, fallbackMessage } : {},
      availableModels,
      ...modelProbes ? { modelProbes } : {},
      sdkVersion: readSdkVersion(),
      key: {
        configured: keyInfo.configured,
        varName: keyInfo.varName,
        source: keyInfo.source,
        length: keyInfo.length,
        looksLikeStandardKey: keyInfo.looksLikeStandardKey,
        formatIssue: keyInfo.formatIssue,
        ...options.includeFingerprint ? { fingerprint: keyInfo.fingerprint } : {}
      },
      env: {
        directory: envReport.directory,
        filesRead: envReport.filesRead,
        overridden: envReport.overridden,
        conflicts: envReport.conflicts
      },
      steps
    };
  };
  const skip = (id, label, why) => steps.push({ id, label, ok: false, category: "skipped", message: `Skipped: ${why}` });
  if (!keyInfo.configured) {
    steps.push({
      id: "config",
      label: "Configuration",
      ok: false,
      category: "MISSING_API_KEY",
      message: "GEMINI_API_KEY is missing or still a placeholder in the server environment."
    });
    skip("auth", "Authentication", "no key configured");
    skip("model", "Model availability", "no key configured");
    skip("generate", "Minimal generation", "no key configured");
    skip("chat_request", "Chat request shape", "no key configured");
    return report();
  }
  steps.push({
    id: "config",
    label: "Configuration",
    ok: !keyInfo.formatIssue,
    category: keyInfo.formatIssue ? "AI_CONFIG_ERROR" : "ok",
    message: keyInfo.formatIssue ?? `Key loaded from ${keyInfo.varName ?? "GEMINI_API_KEY"} (${keyInfo.source}, ${keyInfo.length} characters).`
  });
  if (keyInfo.formatIssue) {
    skip("auth", "Authentication", "key format problem");
    skip("model", "Model availability", "key format problem");
    skip("generate", "Minimal generation", "key format problem");
    skip("chat_request", "Chat request shape", "key format problem");
    return report();
  }
  const ai = getClient();
  const runStep = async (id, label, okMessage, fn) => {
    try {
      const extra = await withTimeout(fn);
      steps.push({ id, label, ok: true, category: "ok", message: extra || okMessage });
      return true;
    } catch (err) {
      const c = classifyGeminiError(err, model);
      steps.push({
        id,
        label,
        ok: false,
        category: c.code,
        httpStatus: c.upstreamStatus,
        reason: c.geminiErrorCode,
        message: redactSecrets(c.message)
      });
      return false;
    }
  };
  const authOk = await runStep("auth", "Authentication", "Google accepted the key and the API is reachable.", async () => {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const page = Array.isArray(pager.page) ? pager.page : [];
    availableModels = page.map((m) => m.name?.replace(/^models\//, "") ?? "").filter((name) => Boolean(name)).slice(0, 100);
  });
  if (!authOk) {
    skip("model", "Model availability", "authentication failed");
    skip("generate", "Minimal generation", "authentication failed");
    skip("chat_request", "Chat request shape", "authentication failed");
    return report();
  }
  await runStep("model", "Model availability", `Model "${model}" exists for this key.`, async () => {
    const info = await ai.models.get({ model });
    const actions = info.supportedActions;
    if (Array.isArray(actions) && actions.length > 0 && !actions.includes("generateContent")) {
      throw new Error(`models/${model} is not supported for generateContent`);
    }
  });
  const genOk = await runStep("generate", "Minimal generation", "A tiny test prompt was answered.", async () => {
    await ai.models.generateContent({
      model,
      contents: "Reply with the single word: ok",
      config: { maxOutputTokens: 32 }
    });
  });
  if (!genOk) {
    skip("chat_request", "Chat request shape", "minimal generation failed");
  } else {
    await runStep("chat_request", "Chat request shape", "The chat request settings are accepted by this model.", async () => {
      await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: "Say hello in one short sentence." }] }],
        config: buildBuddyChatConfig("You are a friendly assistant.", void 0, model)
      });
    });
  }
  if (fallbackModel) {
    try {
      await withTimeout(
        () => ai.models.generateContent({
          model: fallbackModel,
          contents: [{ role: "user", parts: [{ text: "Say hello in one short sentence." }] }],
          config: buildBuddyChatConfig("You are a friendly assistant.", void 0, fallbackModel)
        }),
        25e3
      );
      fallbackOk = true;
      fallbackCategory = "ok";
      fallbackMessage = `Fallback model "${fallbackModel}" responded normally.`;
    } catch (err) {
      const c = classifyGeminiError(err, fallbackModel);
      fallbackOk = false;
      fallbackCategory = c.code;
      fallbackMessage = redactSecrets(c.message);
    }
  }
  if (options.probeModels) {
    const probeList = Array.from(
      /* @__PURE__ */ new Set([
        model,
        ...fallbackModel ? [fallbackModel] : [],
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-4-hydrogen",
        "gemini-3.1-flash-lite",
        "gemini-3.1-flash-lite-preview",
        "gemini-3-flash-preview",
        "gemini-flash-latest"
      ])
    );
    modelProbes = [];
    for (const candidate of probeList) {
      const t0 = Date.now();
      try {
        await withTimeout(
          () => ai.models.generateContent({
            model: candidate,
            contents: [{ role: "user", parts: [{ text: "Say hello in one short sentence." }] }],
            config: buildBuddyChatConfig("You are a friendly assistant.", void 0, candidate)
          }),
          2e4
        );
        modelProbes.push({ model: candidate, ok: true, durationMs: Date.now() - t0, category: "ok", message: "ok" });
      } catch (err) {
        const c = classifyGeminiError(err, candidate);
        modelProbes.push({
          model: candidate,
          ok: false,
          durationMs: Date.now() - t0,
          category: c.code,
          message: redactSecrets(c.message)
        });
      }
    }
  }
  return report();
}

// server/auth.ts
import crypto2 from "node:crypto";
var SESSION_COOKIE_NAME = "buddy_session";
var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
function base64UrlEncode(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64UrlDecode(input) {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) return null;
  const padded = input + "=".repeat((4 - input.length % 4) % 4);
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}
function signAuthJwt(payload) {
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = crypto2.createHmac("sha256", getJwtSecret()).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(sig)}`;
}
function verifyAuthJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, reason: "invalid" };
  }
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) {
    return { valid: false, reason: "invalid" };
  }
  const headerBuf = base64UrlDecode(headerB64);
  const payloadBuf = base64UrlDecode(payloadB64);
  const sigBuf = base64UrlDecode(sigB64);
  if (!headerBuf || !payloadBuf || !sigBuf) {
    return { valid: false, reason: "invalid" };
  }
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto2.createHmac("sha256", getJwtSecret()).update(signingInput).digest();
  if (sigBuf.length !== expectedSig.length || !crypto2.timingSafeEqual(sigBuf, expectedSig)) {
    return { valid: false, reason: "invalid" };
  }
  let header;
  let payload;
  try {
    header = JSON.parse(headerBuf.toString("utf8"));
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return { valid: false, reason: "invalid" };
  }
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    return { valid: false, reason: "invalid" };
  }
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string" || typeof payload.role !== "string" || typeof payload.jti !== "string" || !payload.jti || typeof payload.iat !== "number" || typeof payload.exp !== "number") {
    return { valid: false, reason: "invalid" };
  }
  const nowSec = Math.floor(Date.now() / 1e3);
  if (payload.exp <= nowSec) {
    return { valid: false, reason: "expired" };
  }
  return {
    valid: true,
    payload
  };
}
function hashPassword(password) {
  const salt = crypto2.randomBytes(16).toString("hex");
  const derived = crypto2.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}
function verifyPassword(password, storedHash) {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, "hex");
  const derived = crypto2.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto2.timingSafeEqual(keyBuf, derived);
}
function hashToken(token) {
  return crypto2.createHash("sha256").update(token).digest("hex");
}
function createSession(userId) {
  const db = getDb();
  const userRow = db.prepare(`SELECT id, email, role FROM users WHERE id = ? LIMIT 1`).get(userId);
  if (!userRow) {
    throw new Error("Cannot create session for unknown user.");
  }
  const sessionId = crypto2.randomUUID();
  const now = /* @__PURE__ */ new Date();
  const nowIso = now.toISOString();
  const iat = Math.floor(now.getTime() / 1e3);
  const exp = Math.floor((now.getTime() + SESSION_TTL_MS) / 1e3);
  const expiresAt = new Date(exp * 1e3).toISOString();
  const token = signAuthJwt({
    sub: userRow.id,
    email: userRow.email,
    role: userRow.role,
    jti: sessionId,
    iat,
    exp
  });
  const tokenHash = hashToken(token);
  db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).run(nowIso);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(sessionId, userId, tokenHash, expiresAt, nowIso);
  return { token, expiresAt };
}
function deleteSessionByHash(tokenHash) {
  const db = getDb();
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(tokenHash);
}
function isHttpsRequest(req) {
  const rawForwardedProto = req.headers["x-forwarded-proto"];
  const protoVal = Array.isArray(rawForwardedProto) ? rawForwardedProto[0] : rawForwardedProto;
  if (typeof protoVal === "string") {
    const firstProto = protoVal.split(",")[0].trim().toLowerCase();
    if (firstProto === "https") return true;
    if (firstProto === "http") return false;
  }
  if (req.secure || req.protocol === "https") return true;
  const rawForwardedHost = req.headers["x-forwarded-host"];
  const forwardedHost = typeof rawForwardedHost === "string" ? rawForwardedHost.split(",")[0]?.trim() : Array.isArray(rawForwardedHost) ? rawForwardedHost[0]?.split(",")[0]?.trim() : void 0;
  const host = forwardedHost || req.headers.host || "";
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  if (isLocalHost) {
    return false;
  }
  if (typeof req.headers.origin === "string" && req.headers.origin.startsWith("https://")) return true;
  if (typeof req.headers.referer === "string" && req.headers.referer.startsWith("https://")) return true;
  if (process.env.APP_URL?.startsWith("https://") || Boolean(process.env.RAILWAY_PUBLIC_DOMAIN) || Boolean(process.env.VERCEL)) {
    return true;
  }
  return false;
}
function setSessionCookie(req, res, token) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1e3);
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAgeSec}`
  ];
  if (isHttps) {
    parts.push("SameSite=None", "Secure", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}
function clearSessionCookie(req, res) {
  const isHttps = isHttpsRequest(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0"
  ];
  if (isHttps) {
    parts.push("SameSite=None", "Secure", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  res.setHeader("Set-Cookie", parts.join("; "));
}
function isUsableTokenValue(val) {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return false;
  return true;
}
function extractSessionCookies(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return [];
  const joined = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;
  const values = [];
  const seen = /* @__PURE__ */ new Set();
  for (const part of joined.split(";")) {
    const idx = part.indexOf("=");
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
function extractCandidateTokens(req) {
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && /^Bearer\s+/i.test(authHeader)) {
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (isUsableTokenValue(bearer)) {
      seen.add(bearer);
      candidates.push({ token: bearer, source: "bearer" });
    }
  }
  for (const cookieToken of extractSessionCookies(req)) {
    if (!seen.has(cookieToken)) {
      seen.add(cookieToken);
      candidates.push({ token: cookieToken, source: "cookie" });
    }
  }
  return candidates;
}
function hasSessionCookieHeader(req) {
  return extractSessionCookies(req).length > 0;
}
function validateSessionToken(token) {
  const jwtCheck = verifyAuthJwt(token);
  const tokenHash = hashToken(token);
  if (!jwtCheck.valid) {
    if (jwtCheck.reason === "expired") {
      deleteSessionByHash(tokenHash);
      return { status: "expired" };
    }
    return { status: "not_found" };
  }
  const db = getDb();
  const row = db.prepare(
    `SELECT u.id, u.email, u.name, u.phone, u.role, u.language, u.is_active, u.created_at, s.id as session_id, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
  ).get(tokenHash);
  if (!row || row.id !== jwtCheck.payload.sub) {
    return { status: "not_found" };
  }
  const expiresMs = new Date(row.expires_at).getTime();
  const nowMs = Date.now();
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    deleteSessionByHash(tokenHash);
    return { status: "expired" };
  }
  if (!row.is_active) {
    return { status: "inactive" };
  }
  let renewed = false;
  if (expiresMs - nowMs < SESSION_TTL_MS / 2) {
    const nextExpiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString();
    db.prepare(`UPDATE sessions SET expires_at = ? WHERE id = ?`).run(nextExpiresAt, row.session_id);
    renewed = true;
  }
  return {
    status: "valid",
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      phone: row.phone,
      role: row.role,
      language: row.language,
      is_active: Boolean(row.is_active),
      created_at: row.created_at
    },
    tokenHash,
    renewed
  };
}
function resolveSessionForRequest(req) {
  const candidates = extractCandidateTokens(req);
  if (candidates.length === 0) {
    return { status: "missing" };
  }
  let failureStatus = "not_found";
  for (const candidate of candidates) {
    const validation = validateSessionToken(candidate.token);
    if (validation.status === "valid") {
      return {
        status: "valid",
        user: validation.user,
        token: candidate.token,
        tokenHash: validation.tokenHash,
        source: candidate.source,
        renewed: validation.renewed
      };
    }
    if (validation.status === "inactive") {
      failureStatus = "inactive";
    } else if (validation.status === "expired" && failureStatus === "not_found") {
      failureStatus = "expired";
    }
  }
  return { status: failureStatus };
}
function verifyCsrf(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  if (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")) {
    next();
    return;
  }
  const customHeader = req.headers["x-requested-with"];
  if (customHeader === "BuddyElderAI") {
    next();
    return;
  }
  const origin = req.headers.origin;
  const rawForwardedHost = req.headers["x-forwarded-host"];
  const forwardedHost = typeof rawForwardedHost === "string" ? rawForwardedHost.split(",")[0]?.trim() : Array.isArray(rawForwardedHost) ? rawForwardedHost[0]?.split(",")[0]?.trim() : void 0;
  const host = forwardedHost || req.headers.host;
  if (origin && host) {
    try {
      const parsed = new URL(origin);
      if (parsed.host === host) {
        next();
        return;
      }
    } catch {
    }
  }
  res.status(403).json({ error: "Invalid request origin or missing security header." });
}
function requireAuth(req, res, next) {
  let resolution;
  try {
    resolution = resolveSessionForRequest(req);
  } catch (err) {
    console.error("[Buddy Auth DB Error]", {
      endpoint: req.path,
      error: err instanceof Error ? err.message : String(err)
    });
    res.status(503).json({
      success: false,
      code: "DATABASE_ERROR",
      error: "Unable to verify your session right now. Please try again in a moment."
    });
    return;
  }
  if (resolution.status === "missing") {
    res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      error: "Authentication required. Please sign in."
    });
    return;
  }
  if (resolution.status !== "valid") {
    if (hasSessionCookieHeader(req)) {
      clearSessionCookie(req, res);
    }
    if (resolution.status === "expired") {
      res.status(401).json({
        success: false,
        code: "SESSION_EXPIRED",
        error: "Session expired. Please sign in again."
      });
      return;
    }
    if (resolution.status === "inactive") {
      res.status(403).json({
        success: false,
        code: "ACCOUNT_INACTIVE",
        error: "Account is deactivated. Please contact an administrator."
      });
      return;
    }
    res.status(401).json({
      success: false,
      code: "SESSION_NOT_FOUND",
      error: "Session not found or expired. Please sign in again."
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
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "You do not have permission to access this resource." });
      return;
    }
    next();
  };
}
function ensureDefaultSettings(userId) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM user_settings WHERE user_id = ?`).get(userId);
  if (existing) {
    return {
      ...existing,
      reduced_motion: Boolean(existing.reduced_motion),
      voice_enabled: Boolean(existing.voice_enabled),
      notifications_enabled: Boolean(existing.notifications_enabled),
      onboarding_completed: Boolean(existing.onboarding_completed)
    };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `INSERT INTO user_settings (
      user_id, text_size, contrast_mode, theme, reduced_motion,
      voice_enabled, voice_speed, voice_name, notifications_enabled,
      onboarding_completed, updated_at
    ) VALUES (?, 'normal', 'standard', 'light', 0, 1, 'normal', NULL, 1, 0, ?)`
  ).run(userId, now);
  return {
    user_id: userId,
    text_size: "normal",
    contrast_mode: "standard",
    theme: "light",
    reduced_motion: false,
    voice_enabled: true,
    voice_speed: "normal",
    voice_name: null,
    notifications_enabled: true,
    onboarding_completed: false,
    updated_at: now
  };
}
function hasAdminConfigured() {
  const db = getDb();
  const hasEnvPasscode = Boolean(getAdminPasscode());
  const claimedRow = db.prepare(`SELECT value FROM system_config WHERE key = 'admin_passcode_hash'`).get();
  const adminUserRow = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
  return {
    hasEnvPasscode,
    hasClaimedPasscode: Boolean(claimedRow?.value),
    hasAdminUser: Boolean(adminUserRow?.id)
  };
}
function verifyAdminPasscode(passcode) {
  const envPass = getAdminPasscode();
  if (envPass) {
    const a = Buffer.from(passcode);
    const b = Buffer.from(envPass);
    if (a.length !== b.length) return false;
    return crypto2.timingSafeEqual(a, b);
  }
  const db = getDb();
  const claimedRow = db.prepare(`SELECT value FROM system_config WHERE key = 'admin_passcode_hash'`).get();
  if (!claimedRow?.value) return false;
  return verifyPassword(passcode, claimedRow.value);
}

// server/lessons.ts
var LESSONS_CATALOG = [
  {
    id: "smartphone-basics",
    category: "phone",
    durationMinutes: 4,
    title: {
      en: "Smartphone Basics & Volume",
      hi: "\u0938\u094D\u092E\u093E\u0930\u094D\u091F\u092B\u094B\u0928 \u0915\u0940 \u092C\u0941\u0928\u093F\u092F\u093E\u0926\u0940 \u092C\u093E\u0924\u0947\u0902 \u0914\u0930 \u0906\u0935\u093E\u091C\u093C",
      mr: "\u0938\u094D\u092E\u093E\u0930\u094D\u091F\u092B\u094B\u0928\u091A\u0940 \u092E\u0942\u0932\u092D\u0942\u0924 \u092E\u093E\u0939\u093F\u0924\u0940 \u0906\u0923\u093F \u0906\u0935\u093E\u091C",
      hinglish: "Smartphone Basics aur Volume Set Karna"
    },
    summary: {
      en: "Learn how to unlock your screen, adjust volume, and brighten the display comfortably.",
      hi: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u0905\u0928\u0932\u0949\u0915 \u0915\u0930\u0928\u093E, \u0906\u0935\u093E\u091C\u093C \u092C\u0922\u093C\u093E\u0928\u093E \u0914\u0930 \u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u0915\u0940 \u0930\u094B\u0936\u0928\u0940 \u0920\u0940\u0915 \u0915\u0930\u0928\u093E \u0938\u0940\u0916\u0947\u0902\u0964",
      mr: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u0905\u0928\u0932\u0949\u0915 \u0915\u0930\u0923\u0947, \u0906\u0935\u093E\u091C \u0935\u093E\u0922\u0935\u0923\u0947 \u0906\u0923\u093F \u0938\u094D\u0915\u094D\u0930\u0940\u0928\u091A\u093E \u092A\u094D\u0930\u0915\u093E\u0936 \u092F\u094B\u0917\u094D\u092F \u0920\u0947\u0935\u0923\u0947 \u0936\u093F\u0915\u093E.",
      hinglish: "Screen unlock karna, volume badhana aur brightness set karna seekhein."
    },
    steps: {
      en: [
        { stepNumber: 1, title: "Wake & Unlock Safely", instruction: "Press the side power button once to light up the screen, then swipe up gently or enter your PIN.", tip: "Never share your phone PIN with strangers." },
        { stepNumber: 2, title: "Increase Call & Media Volume", instruction: "Press the upper button on the side of your phone while talking or listening to make the sound louder.", tip: "Tap the speaker icon during a call if you want hands-free sound." },
        { stepNumber: 3, title: "Adjust Screen Brightness", instruction: "Swipe down from the very top edge of your screen and slide the sun bar to the right for clearer reading.", tip: "Brighter text helps outdoors; softer light feels calm at night." }
      ],
      hi: [
        { stepNumber: 1, title: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u0916\u094B\u0932\u0947\u0902", instruction: "\u092B\u093C\u094B\u0928 \u0915\u0947 \u0915\u093F\u0928\u093E\u0930\u0947 \u0915\u093E \u092A\u093E\u0935\u0930 \u092C\u091F\u0928 \u090F\u0915 \u092C\u093E\u0930 \u0926\u092C\u093E\u090F\u0901 \u0914\u0930 \u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u090A\u092A\u0930 \u0938\u094D\u0935\u093E\u0907\u092A \u0915\u0930\u0915\u0947 \u0905\u092A\u0928\u093E \u092A\u093F\u0928 \u0921\u093E\u0932\u0947\u0902\u0964", tip: "\u0905\u092A\u0928\u093E \u092B\u093C\u094B\u0928 \u092A\u093F\u0928 \u0915\u093F\u0938\u0940 \u0905\u0928\u091C\u093E\u0928 \u0935\u094D\u092F\u0915\u094D\u0924\u093F \u0915\u094B \u0928 \u092C\u0924\u093E\u090F\u0901\u0964" },
        { stepNumber: 2, title: "\u0906\u0935\u093E\u091C\u093C \u092C\u0922\u093C\u093E\u090F\u0901", instruction: "\u092C\u093E\u0924 \u0915\u0930\u0924\u0947 \u0938\u092E\u092F \u092B\u093C\u094B\u0928 \u0915\u0947 \u0915\u093F\u0928\u093E\u0930\u0947 \u090A\u092A\u0930 \u0935\u093E\u0932\u093E \u092C\u091F\u0928 \u0926\u092C\u093E\u0915\u0930 \u0906\u0935\u093E\u091C\u093C \u0924\u0947\u091C\u093C \u0915\u0930\u0947\u0902\u0964", tip: "\u092B\u093C\u094B\u0928 \u0926\u0942\u0930 \u0930\u0916\u0915\u0930 \u0938\u0941\u0928\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0938\u094D\u092A\u0940\u0915\u0930 \u0906\u0907\u0915\u0928 \u0926\u092C\u093E\u090F\u0901\u0964" },
        { stepNumber: 3, title: "\u0930\u094B\u0936\u0928\u0940 \u0920\u0940\u0915 \u0915\u0930\u0947\u0902", instruction: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u0915\u0947 \u090A\u092A\u0930 \u0938\u0947 \u0928\u0940\u091A\u0947 \u0938\u094D\u0935\u093E\u0907\u092A \u0915\u0930\u0947\u0902 \u0914\u0930 \u0938\u0942\u0930\u091C \u0935\u093E\u0932\u0947 \u0938\u094D\u0932\u093E\u0907\u0921\u0930 \u0915\u094B \u0926\u093E\u090F\u0901 \u0916\u093F\u0938\u0915\u093E\u090F\u0901\u0964", tip: "\u0938\u093E\u092B\u093C \u092A\u0922\u093C\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0930\u094B\u0936\u0928\u0940 \u0906\u0930\u093E\u092E\u0926\u093E\u092F\u0915 \u0930\u0916\u0947\u0902\u0964" }
      ],
      mr: [
        { stepNumber: 1, title: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u0909\u0918\u0921\u093E", instruction: "\u092B\u094B\u0928\u091A\u094D\u092F\u093E \u092C\u093E\u091C\u0942\u091A\u0947 \u092A\u0949\u0935\u0930 \u092C\u091F\u0923 \u090F\u0915\u0926\u093E \u0926\u093E\u092C\u093E, \u0935\u0930 \u0938\u094D\u0935\u093E\u0907\u092A \u0915\u0930\u093E \u0906\u0923\u093F \u0924\u0941\u092E\u091A\u093E \u092A\u093F\u0928 \u091F\u093E\u0915\u093E.", tip: "\u0905\u0928\u094B\u0933\u0916\u0940 \u0935\u094D\u092F\u0915\u094D\u0924\u0940\u0932\u093E \u092A\u093F\u0928 \u0938\u093E\u0902\u0917\u0942 \u0928\u0915\u093E." },
        { stepNumber: 2, title: "\u0906\u0935\u093E\u091C \u0935\u093E\u0922\u0935\u093E", instruction: "\u092C\u094B\u0932\u0924\u093E\u0928\u093E \u0915\u093F\u0902\u0935\u093E \u0910\u0915\u0924\u093E\u0928\u093E \u092C\u093E\u091C\u0942\u091A\u0947 \u0935\u0930\u091A\u0947 \u092C\u091F\u0923 \u0926\u093E\u092C\u0942\u0928 \u0906\u0935\u093E\u091C \u092E\u094B\u0920\u093E \u0915\u0930\u093E.", tip: "\u0939\u0901\u0921\u094D\u0938-\u092B\u094D\u0930\u0940 \u0910\u0915\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 \u0938\u094D\u092A\u0940\u0915\u0930 \u091A\u093F\u0928\u094D\u0939\u093E\u0935\u0930 \u091F\u0945\u092A \u0915\u0930\u093E." },
        { stepNumber: 3, title: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928 \u092A\u094D\u0930\u0915\u093E\u0936 \u0935\u093E\u0922\u0935\u093E", instruction: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928\u091A\u094D\u092F\u093E \u0935\u0930\u0942\u0928 \u0916\u093E\u0932\u0940 \u0938\u094D\u0935\u093E\u0907\u092A \u0915\u0930\u093E \u0906\u0923\u093F \u0938\u0942\u0930\u094D\u092F\u093E\u091A\u0947 \u091A\u093F\u0928\u094D\u0939 \u0909\u091C\u0935\u0940\u0915\u0921\u0947 \u0938\u0930\u0915\u0935\u093E.", tip: "\u0938\u094D\u092A\u0937\u094D\u091F \u0935\u093E\u091A\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 \u092F\u094B\u0917\u094D\u092F \u092A\u094D\u0930\u0915\u093E\u0936 \u0920\u0947\u0935\u093E." }
      ],
      hinglish: [
        { stepNumber: 1, title: "Screen Unlock Karein", instruction: "Side ka power button ek baar dabayein, upar swipe karein aur apna PIN daalein.", tip: "Apna phone PIN kisi anjaan ko mat batayein." },
        { stepNumber: 2, title: "Volume Badhayein", instruction: "Call ya video ke waqt side ka upar wala button dabakar awaaz tez karein.", tip: "Speaker icon dabakar aap hands-free sun sakte hain." },
        { stepNumber: 3, title: "Brightness Set Karein", instruction: "Screen ke upar se neeche swipe karein aur sun slider ko right le jayein.", tip: "Dhoop mein zyada aur raat mein halka brightness rakhein." }
      ]
    }
  },
  {
    id: "whatsapp-photos",
    category: "communication",
    durationMinutes: 5,
    title: {
      en: "WhatsApp Messages & Sending Photos",
      hi: "\u0935\u094D\u0939\u093E\u091F\u094D\u0938\u090F\u092A \u0938\u0902\u0926\u0947\u0936 \u0914\u0930 \u092B\u094B\u091F\u094B \u092D\u0947\u091C\u0928\u093E",
      mr: "\u0935\u094D\u0939\u0949\u091F\u094D\u0938\u0905\u0945\u092A \u092E\u0947\u0938\u0947\u091C \u0906\u0923\u093F \u092B\u094B\u091F\u094B \u092A\u093E\u0920\u0935\u0923\u0947",
      hinglish: "WhatsApp Message aur Photo Bhejna"
    },
    summary: {
      en: "Send messages, voice notes, and family photos step by step on WhatsApp.",
      hi: "\u0935\u094D\u0939\u093E\u091F\u094D\u0938\u090F\u092A \u092A\u0930 \u0938\u0902\u0926\u0947\u0936, \u0906\u0935\u093E\u091C\u093C \u0938\u0902\u0926\u0947\u0936 \u0914\u0930 \u092A\u0930\u093F\u0935\u093E\u0930 \u0915\u0940 \u0924\u0938\u094D\u0935\u0940\u0930\u0947\u0902 \u092D\u0947\u091C\u0928\u093E \u0938\u0940\u0916\u0947\u0902\u0964",
      mr: "\u0935\u094D\u0939\u0949\u091F\u094D\u0938\u0905\u0945\u092A\u0935\u0930 \u0938\u0902\u0926\u0947\u0936, \u0935\u094D\u0939\u0949\u0907\u0938 \u0928\u094B\u091F\u094D\u0938 \u0906\u0923\u093F \u0915\u0941\u091F\u0941\u0902\u092C\u093E\u091A\u0947 \u092B\u094B\u091F\u094B \u092A\u093E\u0920\u0935\u093E\u092F\u0932\u093E \u0936\u093F\u0915\u093E.",
      hinglish: "WhatsApp par message, voice note aur family photos bhejna seekhein."
    },
    steps: {
      en: [
        { stepNumber: 1, title: "Open Family Chat", instruction: "Tap the green WhatsApp icon, then tap the name of the family member you want to message.", tip: "Check the profile photo and name at the top before sending." },
        { stepNumber: 2, title: "Attach a Photo", instruction: "Tap the paperclip or camera icon next to the typing box, choose Gallery/Photos, pick your picture, and tap the green Send arrow.", tip: "You can add a short caption before tapping Send." },
        { stepNumber: 3, title: "Send a Voice Note", instruction: "Press and hold the green microphone icon while speaking, then lift your finger to send.", tip: "If you prefer typing, tap the message box to open the keyboard." }
      ],
      hi: [
        { stepNumber: 1, title: "\u091A\u0948\u091F \u0916\u094B\u0932\u0947\u0902", instruction: "\u0939\u0930\u0947 \u0935\u094D\u0939\u093E\u091F\u094D\u0938\u090F\u092A \u0906\u0907\u0915\u0928 \u0915\u094B \u0926\u092C\u093E\u090F\u0901 \u0914\u0930 \u092A\u0930\u093F\u0935\u093E\u0930 \u0915\u0947 \u0938\u0926\u0938\u094D\u092F \u0915\u093E \u0928\u093E\u092E \u091A\u0941\u0928\u0947\u0902\u0964", tip: "\u092D\u0947\u091C\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947 \u090A\u092A\u0930 \u0928\u093E\u092E \u091C\u093C\u0930\u0942\u0930 \u0926\u0947\u0916 \u0932\u0947\u0902\u0964" },
        { stepNumber: 2, title: "\u092B\u094B\u091F\u094B \u091A\u0941\u0928\u0947\u0902 \u0914\u0930 \u092D\u0947\u091C\u0947\u0902", instruction: "\u091F\u093E\u0907\u092A \u0915\u0930\u0928\u0947 \u0935\u093E\u0932\u0947 \u092C\u0949\u0915\u094D\u0938 \u0915\u0947 \u092A\u093E\u0938 \u0915\u0948\u092E\u0930\u093E \u092F\u093E \u0915\u094D\u0932\u093F\u092A \u0906\u0907\u0915\u0928 \u0926\u092C\u093E\u090F\u0901, \u092B\u094B\u091F\u094B \u091A\u0941\u0928\u0947\u0902 \u0914\u0930 \u0939\u0930\u093E \u0924\u0940\u0930 \u0926\u092C\u093E\u090F\u0901\u0964", tip: "\u092B\u094B\u091F\u094B \u0915\u0947 \u0938\u093E\u0925 \u091B\u094B\u091F\u093E \u0938\u0902\u0926\u0947\u0936 \u092D\u0940 \u0932\u093F\u0916 \u0938\u0915\u0924\u0947 \u0939\u0948\u0902\u0964" },
        { stepNumber: 3, title: "\u0906\u0935\u093E\u091C\u093C \u0938\u0902\u0926\u0947\u0936 \u092D\u0947\u091C\u0947\u0902", instruction: "\u0939\u0930\u0947 \u092E\u093E\u0907\u0915 \u092C\u091F\u0928 \u0915\u094B \u0926\u092C\u093E\u0915\u0930 \u0930\u0916\u0947\u0902, \u092C\u094B\u0932\u0947\u0902 \u0914\u0930 \u092D\u0947\u091C\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0909\u0902\u0917\u0932\u0940 \u0939\u091F\u093E \u0932\u0947\u0902\u0964", tip: "\u092C\u094B\u0932\u0924\u0947 \u0938\u092E\u092F \u092B\u093C\u094B\u0928 \u092A\u093E\u0938 \u0930\u0916\u0947\u0902\u0964" }
      ],
      mr: [
        { stepNumber: 1, title: "\u091A\u0945\u091F \u0909\u0918\u0921\u093E", instruction: "\u0939\u093F\u0930\u0935\u0947 \u0935\u094D\u0939\u0949\u091F\u094D\u0938\u0905\u0945\u092A \u091A\u093F\u0928\u094D\u0939 \u0926\u093E\u092C\u093E \u0906\u0923\u093F \u0915\u0941\u091F\u0941\u0902\u092C\u093E\u0924\u0940\u0932 \u0935\u094D\u092F\u0915\u094D\u0924\u0940\u091A\u0947 \u0928\u093E\u0935 \u0928\u093F\u0935\u0921\u093E.", tip: "\u0938\u0902\u0926\u0947\u0936 \u092A\u093E\u0920\u0935\u0923\u094D\u092F\u093E\u092A\u0942\u0930\u094D\u0935\u0940 \u0935\u0930 \u0928\u093E\u0935 \u0924\u092A\u093E\u0938\u093E." },
        { stepNumber: 2, title: "\u092B\u094B\u091F\u094B \u092A\u093E\u0920\u0935\u093E", instruction: "\u092C\u0949\u0915\u094D\u0938\u091C\u0935\u0933\u0940\u0932 \u0915\u0945\u092E\u0947\u0930\u093E \u0915\u093F\u0902\u0935\u093E \u0915\u094D\u0932\u093F\u092A \u091A\u093F\u0928\u094D\u0939 \u0926\u093E\u092C\u093E, \u0917\u0945\u0932\u0930\u0940\u0924\u0942\u0928 \u092B\u094B\u091F\u094B \u0928\u093F\u0935\u0921\u093E \u0906\u0923\u093F \u0939\u093F\u0930\u0935\u093E \u092C\u093E\u0923 \u0926\u093E\u092C\u093E.", tip: "\u092B\u094B\u091F\u094B\u0916\u093E\u0932\u0940 \u0932\u0939\u093E\u0928 \u0913\u0933 \u0932\u093F\u0939\u0942 \u0936\u0915\u0924\u093E." },
        { stepNumber: 3, title: "\u0935\u094D\u0939\u0949\u0907\u0938 \u092E\u0947\u0938\u0947\u091C \u092A\u093E\u0920\u0935\u093E", instruction: "\u0939\u093F\u0930\u0935\u093E \u092E\u093E\u0907\u0915 \u0926\u093E\u092C\u0942\u0928 \u0927\u0930\u093E, \u092C\u094B\u0932\u093E \u0906\u0923\u093F \u092A\u093E\u0920\u0935\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 \u092C\u094B\u091F \u0938\u094B\u0921\u093E.", tip: "\u092C\u094B\u0932\u0924\u093E\u0928\u093E \u092B\u094B\u0928 \u091C\u0935\u0933 \u0927\u0930\u093E." }
      ],
      hinglish: [
        { stepNumber: 1, title: "Chat Open Karein", instruction: "Green WhatsApp icon tap karein aur family member ka naam chunein.", tip: "Bhejne se pehle upar naam zaroor check karein." },
        { stepNumber: 2, title: "Photo Select Karke Send Karein", instruction: "Message box ke paas camera ya clip icon dabayein, photo select karein aur green send arrow dabayein.", tip: "Send se pehle chota caption likh sakte hain." },
        { stepNumber: 3, title: "Voice Note Bhejein", instruction: "Green mic button dabakar rakhein, bolein aur send karne ke liye ungli chhod dein.", tip: "Saaf awaaz ke liye phone paas rakhein." }
      ]
    }
  },
  {
    id: "video-calls",
    category: "communication",
    durationMinutes: 4,
    title: {
      en: "Making Clear Video Calls",
      hi: "\u0938\u093E\u092B\u093C \u0935\u0940\u0921\u093F\u092F\u094B \u0915\u0949\u0932 \u0915\u0930\u0928\u093E",
      mr: "\u0938\u094D\u092A\u0937\u094D\u091F \u0935\u094D\u0939\u093F\u0921\u093F\u0913 \u0915\u0949\u0932 \u0915\u0930\u0923\u0947",
      hinglish: "Clear Video Call Kaise Karein"
    },
    summary: {
      en: "Start a video call, keep your face well-lit, and switch camera or speaker easily.",
      hi: "\u0935\u0940\u0921\u093F\u092F\u094B \u0915\u0949\u0932 \u0936\u0941\u0930\u0942 \u0915\u0930\u0928\u093E, \u0930\u094B\u0936\u0928\u0940 \u092E\u0947\u0902 \u092C\u0948\u0920\u0928\u093E \u0914\u0930 \u0906\u0935\u093E\u091C\u093C-\u0915\u0948\u092E\u0930\u093E \u0928\u093F\u092F\u0902\u0924\u094D\u0930\u093F\u0924 \u0915\u0930\u0928\u093E \u0938\u0940\u0916\u0947\u0902\u0964",
      mr: "\u0935\u094D\u0939\u093F\u0921\u093F\u0913 \u0915\u0949\u0932 \u0938\u0941\u0930\u0942 \u0915\u0930\u0923\u0947, \u091A\u093E\u0902\u0917\u0932\u093E \u092A\u094D\u0930\u0915\u093E\u0936 \u0920\u0947\u0935\u0923\u0947 \u0906\u0923\u093F \u0915\u0945\u092E\u0947\u0930\u093E \u0935\u093E\u092A\u0930\u0923\u0947 \u0936\u093F\u0915\u093E.",
      hinglish: "Video call start karna, achi lighting rakhna aur camera switch karna seekhein."
    },
    steps: {
      en: [
        { stepNumber: 1, title: "Start the Video Call", instruction: "Open your family member chat in WhatsApp and tap the Video Camera icon at the top right.", tip: "Sit facing a window or lamp so family can see you clearly." },
        { stepNumber: 2, title: "Mute or End Safely", instruction: "Tap the red phone button when you finish talking. Tap the microphone icon only if you want to mute your voice briefly.", tip: "Keep the phone resting on a table so your arm does not get tired." }
      ],
      hi: [
        { stepNumber: 1, title: "\u0935\u0940\u0921\u093F\u092F\u094B \u0915\u0949\u0932 \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902", instruction: "\u0935\u094D\u0939\u093E\u091F\u094D\u0938\u090F\u092A \u091A\u0948\u091F \u0916\u094B\u0932\u0915\u0930 \u090A\u092A\u0930 \u0926\u093E\u0908\u0902 \u0913\u0930 \u0935\u0940\u0921\u093F\u092F\u094B \u0915\u0948\u092E\u0930\u093E \u0906\u0907\u0915\u0928 \u0926\u092C\u093E\u090F\u0901\u0964", tip: "\u091A\u0947\u0939\u0930\u0947 \u092A\u0930 \u0930\u094B\u0936\u0928\u0940 \u0930\u0939\u0947 \u0907\u0938\u0915\u0947 \u0932\u093F\u090F \u0916\u093F\u0921\u093C\u0915\u0940 \u092F\u093E \u0932\u093E\u0907\u091F \u0915\u0947 \u0938\u093E\u092E\u0928\u0947 \u092C\u0948\u0920\u0947\u0902\u0964" },
        { stepNumber: 2, title: "\u0915\u0949\u0932 \u0938\u092E\u093E\u092A\u094D\u0924 \u0915\u0930\u0947\u0902", instruction: "\u092C\u093E\u0924 \u092A\u0942\u0930\u0940 \u0939\u094B\u0928\u0947 \u092A\u0930 \u0932\u093E\u0932 \u092B\u093C\u094B\u0928 \u092C\u091F\u0928 \u0926\u092C\u093E\u090F\u0901\u0964", tip: "\u0939\u093E\u0925 \u0925\u0915\u0928\u0947 \u0938\u0947 \u092C\u091A\u093E\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u092B\u093C\u094B\u0928 \u0915\u094B \u092E\u0947\u091C\u093C \u092A\u0930 \u091F\u093F\u0915\u093E\u0915\u0930 \u0930\u0916\u0947\u0902\u0964" }
      ],
      mr: [
        { stepNumber: 1, title: "\u0935\u094D\u0939\u093F\u0921\u093F\u0913 \u0915\u0949\u0932 \u0938\u0941\u0930\u0942 \u0915\u0930\u093E", instruction: "\u0935\u094D\u0939\u0949\u091F\u094D\u0938\u0905\u0945\u092A \u091A\u0945\u091F\u092E\u0927\u094D\u092F\u0947 \u0935\u0930 \u0909\u091C\u0935\u0940\u0915\u0921\u0947 \u0905\u0938\u0932\u0947\u0932\u0947 \u0935\u094D\u0939\u093F\u0921\u093F\u0913 \u0915\u0945\u092E\u0947\u0930\u093E \u091A\u093F\u0928\u094D\u0939 \u0926\u093E\u092C\u093E.", tip: "\u091A\u0947\u0939\u0930\u093E \u0938\u094D\u092A\u0937\u094D\u091F \u0926\u093F\u0938\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 \u092A\u094D\u0930\u0915\u093E\u0936\u093E\u0938\u092E\u094B\u0930 \u092C\u0938\u093E." },
        { stepNumber: 2, title: "\u0915\u0949\u0932 \u092C\u0902\u0926 \u0915\u0930\u093E", instruction: "\u092C\u094B\u0932\u0942\u0928 \u091D\u093E\u0932\u094D\u092F\u093E\u0935\u0930 \u0932\u093E\u0932 \u092B\u094B\u0928 \u092C\u091F\u0923 \u0926\u093E\u092C\u093E.", tip: "\u0939\u093E\u0924 \u0926\u0941\u0916\u0942 \u0928\u092F\u0947 \u092E\u094D\u0939\u0923\u0942\u0928 \u092B\u094B\u0928 \u091F\u0947\u092C\u0932\u093E\u0935\u0930 \u091F\u0947\u0915\u0935\u0942\u0928 \u0920\u0947\u0935\u093E." }
      ],
      hinglish: [
        { stepNumber: 1, title: "Video Call Start Karein", instruction: "WhatsApp chat kholein aur upar right side mein video camera icon tap karein.", tip: "Light ke saamne baithein taaki chehra saaf dikhe." },
        { stepNumber: 2, title: "Call End Karein", instruction: "Baat khatam hone par red phone button dabayein.", tip: "Phone table par tikakar rakhein taaki haath na thake." }
      ]
    }
  },
  {
    id: "otp-upi-safety",
    category: "safety",
    durationMinutes: 5,
    title: {
      en: "OTP, UPI & Bank Safety",
      hi: "\u0913\u091F\u0940\u092A\u0940, \u092F\u0942\u092A\u0940\u0906\u0908 \u0914\u0930 \u092C\u0948\u0902\u0915 \u0938\u0941\u0930\u0915\u094D\u0937\u093E",
      mr: "\u0913\u091F\u0940\u092A\u0940, \u092F\u0942\u092A\u0940\u0906\u092F \u0906\u0923\u093F \u092C\u0901\u0915 \u0938\u0941\u0930\u0915\u094D\u0937\u093E",
      hinglish: "OTP, UPI aur Bank Safety Rules"
    },
    summary: {
      en: "Golden rules to protect your bank account, OTPs, QR codes, and UPI PIN.",
      hi: "\u0905\u092A\u0928\u0947 \u092C\u0948\u0902\u0915 \u0916\u093E\u0924\u0947, \u0913\u091F\u0940\u092A\u0940, \u0915\u094D\u092F\u0942\u0906\u0930 \u0915\u094B\u0921 \u0914\u0930 \u092F\u0942\u092A\u0940\u0906\u0908 \u092A\u093F\u0928 \u0915\u094B \u0938\u0941\u0930\u0915\u094D\u0937\u093F\u0924 \u0930\u0916\u0928\u0947 \u0915\u0947 \u0938\u0941\u0928\u0939\u0930\u0947 \u0928\u093F\u092F\u092E\u0964",
      mr: "\u0924\u0941\u092E\u091A\u0947 \u092C\u0901\u0915 \u0916\u093E\u0924\u0947, \u0913\u091F\u0940\u092A\u0940, \u0915\u094D\u092F\u0942\u0906\u0930 \u0915\u094B\u0921 \u0906\u0923\u093F \u092F\u0942\u092A\u0940\u0906\u092F \u092A\u093F\u0928 \u0938\u0941\u0930\u0915\u094D\u0937\u093F\u0924 \u0920\u0947\u0935\u0923\u094D\u092F\u093E\u091A\u0947 \u0928\u093F\u092F\u092E.",
      hinglish: "Apna bank account, OTP, QR code aur UPI PIN safe rakhne ke golden rules."
    },
    steps: {
      en: [
        { stepNumber: 1, title: "You Never Need a PIN to Receive Money", instruction: "To receive money in UPI, you do nothing\u2014never enter your UPI PIN or scan a QR code to receive funds.", tip: "A UPI PIN is ONLY for paying money out of your account." },
        { stepNumber: 2, title: "Keep Every OTP Secret", instruction: "Banks, police, electricity boards, and government offices NEVER call asking for your OTP or PIN.", tip: "If anyone pressures you urgently, hang up and check with family." },
        { stepNumber: 3, title: "Never Install Screen-Share Apps for Callers", instruction: "Refuse requests to download AnyDesk, TeamViewer, or QuickSupport from unknown callers.", tip: 'Use Buddy Elder AI\u2019s "Is This Safe?" checker whenever unsure.' }
      ],
      hi: [
        { stepNumber: 1, title: "\u092A\u0948\u0938\u0947 \u092A\u093E\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u092A\u093F\u0928 \u0928\u0939\u0940\u0902 \u0932\u0917\u0924\u093E", instruction: "\u0916\u093E\u0924\u0947 \u092E\u0947\u0902 \u092A\u0948\u0938\u0947 \u0906\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0915\u092D\u0940 \u092F\u0942\u092A\u0940\u0906\u0908 \u092A\u093F\u0928 \u0928\u0939\u0940\u0902 \u0921\u093E\u0932\u0928\u093E \u092A\u0921\u093C\u0924\u093E \u0914\u0930 \u0928 \u0939\u0940 \u0915\u094D\u092F\u0942\u0906\u0930 \u0915\u094B\u0921 \u0938\u094D\u0915\u0948\u0928 \u0915\u0930\u0928\u093E \u0939\u094B\u0924\u093E \u0939\u0948\u0964", tip: "\u092A\u093F\u0928 \u0915\u0947\u0935\u0932 \u092A\u0948\u0938\u0947 \u092D\u0947\u091C\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F \u0939\u094B\u0924\u093E \u0939\u0948\u0964" },
        { stepNumber: 2, title: "\u0913\u091F\u0940\u092A\u0940 \u0939\u092E\u0947\u0936\u093E \u0917\u0941\u092A\u094D\u0924 \u0930\u0916\u0947\u0902", instruction: "\u092C\u0948\u0902\u0915, \u092A\u0941\u0932\u093F\u0938 \u092F\u093E \u0915\u094B\u0908 \u092D\u0940 \u0938\u0930\u0915\u093E\u0930\u0940 \u0935\u093F\u092D\u093E\u0917 \u092B\u093C\u094B\u0928 \u092A\u0930 \u0913\u091F\u0940\u092A\u0940 \u0928\u0939\u0940\u0902 \u092E\u093E\u0901\u0917\u0924\u093E\u0964", tip: "\u0915\u094B\u0908 \u091C\u0932\u094D\u0926\u0940\u092C\u093E\u091C\u093C\u0940 \u0915\u0930\u0947 \u0924\u094B \u0924\u0941\u0930\u0902\u0924 \u0915\u0949\u0932 \u0915\u093E\u091F \u0926\u0947\u0902\u0964" },
        { stepNumber: 3, title: "\u0938\u094D\u0915\u094D\u0930\u0940\u0928-\u0936\u0947\u092F\u0930\u093F\u0902\u0917 \u0910\u092A \u0928 \u0921\u093E\u0932\u0947\u0902", instruction: "\u0915\u093F\u0938\u0940 \u0905\u0928\u091C\u093E\u0928 \u0915\u0949\u0932\u0930 \u0915\u0947 \u0915\u0939\u0928\u0947 \u092A\u0930 AnyDesk \u092F\u093E TeamViewer \u091C\u0948\u0938\u0947 \u0910\u092A \u0915\u092D\u0940 \u0921\u093E\u0909\u0928\u0932\u094B\u0921 \u0928 \u0915\u0930\u0947\u0902\u0964", tip: '\u0936\u0915 \u0939\u094B\u0928\u0947 \u092A\u0930 "Is This Safe?" \u092E\u0947\u0902 \u091C\u093E\u0901\u091A\u0947\u0902\u0964' }
      ],
      mr: [
        { stepNumber: 1, title: "\u092A\u0948\u0938\u0947 \u092E\u093F\u0933\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 \u092A\u093F\u0928 \u0932\u093E\u0917\u0924 \u0928\u093E\u0939\u0940", instruction: "\u092A\u0948\u0938\u0947 \u0938\u094D\u0935\u0940\u0915\u093E\u0930\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 \u0915\u0927\u0940\u0939\u0940 \u092F\u0942\u092A\u0940\u0906\u092F \u092A\u093F\u0928 \u091F\u093E\u0915\u0942 \u0928\u0915\u093E \u0915\u093F\u0902\u0935\u093E \u0915\u094D\u092F\u0942\u0906\u0930 \u0915\u094B\u0921 \u0938\u094D\u0915\u0945\u0928 \u0915\u0930\u0942 \u0928\u0915\u093E.", tip: "\u092A\u093F\u0928 \u092B\u0915\u094D\u0924 \u092A\u0948\u0938\u0947 \u092A\u093E\u0920\u0935\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 \u0905\u0938\u0924\u094B." },
        { stepNumber: 2, title: "\u0913\u091F\u0940\u092A\u0940 \u0915\u094B\u0923\u093E\u0932\u093E\u0939\u0940 \u0938\u093E\u0902\u0917\u0942 \u0928\u0915\u093E", instruction: "\u092C\u0901\u0915, \u092A\u094B\u0932\u0940\u0938 \u0915\u093F\u0902\u0935\u093E \u0938\u0930\u0915\u093E\u0930\u0940 \u0905\u0927\u093F\u0915\u093E\u0930\u0940 \u092B\u094B\u0928\u0935\u0930 \u0913\u091F\u0940\u092A\u0940 \u0915\u093F\u0902\u0935\u093E \u092A\u093F\u0928 \u092E\u093E\u0917\u0924 \u0928\u093E\u0939\u0940\u0924.", tip: "\u0918\u093E\u0908 \u0915\u0930\u0923\u093E\u0931\u094D\u092F\u093E \u0915\u0949\u0932\u0930\u091A\u093E \u092B\u094B\u0928 \u0932\u0917\u0947\u091A \u0915\u091F \u0915\u0930\u093E." },
        { stepNumber: 3, title: "\u0930\u093F\u092E\u094B\u091F \u0905\u0945\u092A \u0921\u093E\u0909\u0928\u0932\u094B\u0921 \u0915\u0930\u0942 \u0928\u0915\u093E", instruction: "\u0905\u0928\u094B\u0933\u0916\u0940 \u0935\u094D\u092F\u0915\u094D\u0924\u0940\u091A\u094D\u092F\u093E \u0938\u093E\u0902\u0917\u0923\u094D\u092F\u093E\u0935\u0930\u0942\u0928 AnyDesk \u0915\u093F\u0902\u0935\u093E TeamViewer \u0921\u093E\u0909\u0928\u0932\u094B\u0921 \u0915\u0930\u0942 \u0928\u0915\u093E.", tip: '\u0936\u0902\u0915\u093E \u0905\u0938\u0932\u094D\u092F\u093E\u0938 "Is This Safe?" \u0935\u093E\u092A\u0930\u093E.' }
      ],
      hinglish: [
        { stepNumber: 1, title: "Paise Lene Ke Liye PIN Nahi Lagta", instruction: "Account mein paise receive karne ke liye kabhi UPI PIN na daalein aur na QR scan karein.", tip: "UPI PIN sirf paise bhejne ke liye hota hai." },
        { stepNumber: 2, title: "OTP Hamesha Secret Rakhein", instruction: "Bank, police ya government call par kabhi OTP ya PIN nahi maangte.", tip: "Koi jaldi kare toh turant call cut kar dein." },
        { stepNumber: 3, title: "Screen-Share Apps Install Na Karein", instruction: "Anjaan caller ke kehne par AnyDesk ya TeamViewer kabhi install na karein.", tip: 'Doubt ho toh Buddy ke "Is This Safe?" mein check karein.' }
      ]
    }
  },
  {
    id: "google-maps-travel",
    category: "daily_tools",
    durationMinutes: 4,
    title: {
      en: "Using Google Maps & Finding Places",
      hi: "\u0917\u0942\u0917\u0932 \u092E\u0948\u092A\u094D\u0938 \u0938\u0947 \u0930\u093E\u0938\u094D\u0924\u093E \u0926\u0947\u0916\u0928\u093E",
      mr: "\u0917\u0942\u0917\u0932 \u092E\u0945\u092A\u094D\u0938\u0928\u0947 \u0930\u0938\u094D\u0924\u093E \u0936\u094B\u0927\u0923\u0947",
      hinglish: "Google Maps Se Rasta Aur Jagah Dhundhna"
    },
    summary: {
      en: "Search for clinics, pharmacies, or family homes and share your live location safely.",
      hi: "\u0905\u0938\u094D\u092A\u0924\u093E\u0932, \u0926\u0935\u093E \u0915\u0940 \u0926\u0941\u0915\u093E\u0928 \u092F\u093E \u0918\u0930 \u0915\u093E \u0930\u093E\u0938\u094D\u0924\u093E \u0916\u094B\u091C\u0928\u093E \u0914\u0930 \u092A\u0930\u093F\u0935\u093E\u0930 \u0915\u094B \u0932\u094B\u0915\u0947\u0936\u0928 \u092D\u0947\u091C\u0928\u093E \u0938\u0940\u0916\u0947\u0902\u0964",
      mr: "\u0926\u0935\u093E\u0916\u093E\u0928\u093E, \u0914\u0937\u0927\u093E\u0902\u091A\u0947 \u0926\u0941\u0915\u093E\u0928 \u0915\u093F\u0902\u0935\u093E \u0918\u0930\u093E\u091A\u093E \u0930\u0938\u094D\u0924\u093E \u0936\u094B\u0927\u093E\u092F\u0932\u093E \u0936\u093F\u0915\u093E.",
      hinglish: "Clinic, medical store ya ghar ka rasta dhundhna aur location share karna seekhein."
    },
    steps: {
      en: [
        { stepNumber: 1, title: "Search by Voice or Text", instruction: "Open Google Maps, tap the microphone icon in the top search bar, and say the place name clearly.", tip: 'Tap "Directions" to see travel time and route.' },
        { stepNumber: 2, title: "Share Location Only With Trusted Family", instruction: 'Tap the blue dot showing where you are, then tap "Share location" and pick only a trusted family member.', tip: "Set a time limit like 1 hour when sharing." }
      ],
      hi: [
        { stepNumber: 1, title: "\u092C\u094B\u0932\u0915\u0930 \u091C\u0917\u0939 \u0916\u094B\u091C\u0947\u0902", instruction: "\u0917\u0942\u0917\u0932 \u092E\u0948\u092A\u094D\u0938 \u0916\u094B\u0932\u0947\u0902, \u090A\u092A\u0930 \u092E\u093E\u0907\u0915 \u0906\u0907\u0915\u0928 \u0926\u092C\u093E\u090F\u0901 \u0914\u0930 \u091C\u0917\u0939 \u0915\u093E \u0928\u093E\u092E \u0938\u093E\u092B\u093C \u092C\u094B\u0932\u0947\u0902\u0964", tip: "\u0930\u093E\u0938\u094D\u0924\u093E \u0926\u0947\u0916\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F Directions \u0926\u092C\u093E\u090F\u0901\u0964" },
        { stepNumber: 2, title: "\u0938\u093F\u0930\u094D\u092B \u092A\u0930\u093F\u0935\u093E\u0930 \u0938\u0947 \u0932\u094B\u0915\u0947\u0936\u0928 \u0938\u093E\u091D\u093E \u0915\u0930\u0947\u0902", instruction: "\u0928\u0940\u0932\u0947 \u092C\u093F\u0902\u0926\u0941 \u092A\u0930 \u091F\u0948\u092A \u0915\u0930\u0915\u0947 \u0915\u0947\u0935\u0932 \u0905\u092A\u0928\u0947 \u0935\u093F\u0936\u094D\u0935\u0938\u0928\u0940\u092F \u092A\u0930\u093F\u0935\u093E\u0930\u091C\u0928 \u0915\u094B \u0932\u094B\u0915\u0947\u0936\u0928 \u092D\u0947\u091C\u0947\u0902\u0964", tip: "\u0938\u092E\u092F \u0938\u0940\u092E\u093E \u091A\u0941\u0928\u0928\u093E \u0938\u0941\u0930\u0915\u094D\u0937\u093F\u0924 \u0930\u0939\u0924\u093E \u0939\u0948\u0964" }
      ],
      mr: [
        { stepNumber: 1, title: "\u092C\u094B\u0932\u0942\u0928 \u0920\u093F\u0915\u093E\u0923 \u0936\u094B\u0927\u093E", instruction: "\u0917\u0942\u0917\u0932 \u092E\u0945\u092A\u094D\u0938 \u0909\u0918\u0921\u093E, \u0935\u0930\u091A\u094D\u092F\u093E \u092E\u093E\u0907\u0915 \u091A\u093F\u0928\u094D\u0939\u093E\u0935\u0930 \u091F\u0945\u092A \u0915\u0930\u0942\u0928 \u0920\u093F\u0915\u093E\u0923\u093E\u091A\u0947 \u0928\u093E\u0935 \u092C\u094B\u0932\u093E.", tip: "\u0930\u0938\u094D\u0924\u093E \u092A\u093E\u0939\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940 Directions \u0926\u093E\u092C\u093E." },
        { stepNumber: 2, title: "\u092B\u0915\u094D\u0924 \u0915\u0941\u091F\u0941\u0902\u092C\u093E\u0936\u0940 \u0932\u094B\u0915\u0947\u0936\u0928 \u0936\u0947\u0905\u0930 \u0915\u0930\u093E", instruction: "\u0928\u093F\u0933\u094D\u092F\u093E \u0920\u093F\u092A\u0915\u094D\u092F\u093E\u0935\u0930 \u091F\u0945\u092A \u0915\u0930\u0942\u0928 \u092B\u0915\u094D\u0924 \u0935\u093F\u0936\u094D\u0935\u093E\u0938\u0942 \u0915\u0941\u091F\u0941\u0902\u092C\u0940\u092F\u093E\u0902\u0928\u093E \u0932\u094B\u0915\u0947\u0936\u0928 \u092A\u093E\u0920\u0935\u093E.", tip: "\u0935\u0947\u0933\u0947\u091A\u0940 \u092E\u0930\u094D\u092F\u093E\u0926\u093E \u0928\u093F\u0935\u0921\u0923\u0947 \u0938\u0941\u0930\u0915\u094D\u0937\u093F\u0924 \u0905\u0938\u0924\u0947." }
      ],
      hinglish: [
        { stepNumber: 1, title: "Bolkar Jagah Search Karein", instruction: "Google Maps kholein, upar mic icon tap karein aur jagah ka naam bolein.", tip: "Rasta dekhne ke liye Directions tap karein." },
        { stepNumber: 2, title: "Sirf Family Ko Location Bhejein", instruction: "Blue dot par tap karke sirf bharosemand family member ko location share karein.", tip: "1 hour jaisa time limit set karna safe hai." }
      ]
    }
  },
  {
    id: "scam-awareness",
    category: "safety",
    durationMinutes: 5,
    title: {
      en: "Spotting Fake Calls, Links & Offers",
      hi: "\u0928\u0915\u0932\u0940 \u0915\u0949\u0932, \u0932\u093F\u0902\u0915 \u0914\u0930 \u0911\u092B\u093C\u0930 \u092A\u0939\u091A\u093E\u0928\u0928\u093E",
      mr: "\u092C\u0928\u093E\u0935\u091F \u0915\u0949\u0932, \u0932\u093F\u0902\u0915 \u0906\u0923\u093F \u0911\u092B\u0930\u094D\u0938 \u0913\u0933\u0916\u0923\u0947",
      hinglish: "Fake Calls, Links aur Offers Kaise Pehchanein"
    },
    summary: {
      en: "Recognize urgency tricks, lottery scams, fake courier SMS, and impersonation calls.",
      hi: "\u091C\u0932\u094D\u0926\u0940\u092C\u093E\u091C\u093C\u0940 \u0915\u093E \u0926\u092C\u093E\u0935, \u0932\u0949\u091F\u0930\u0940 \u0938\u0902\u0926\u0947\u0936, \u0928\u0915\u0932\u0940 \u0915\u0942\u0930\u093F\u092F\u0930 \u0932\u093F\u0902\u0915 \u0914\u0930 \u0920\u0917\u0940 \u0915\u0947 \u0924\u0930\u0940\u0915\u094B\u0902 \u0915\u094B \u092A\u0939\u091A\u093E\u0928\u0947\u0902\u0964",
      mr: "\u0918\u093E\u0908\u091A\u0947 \u0926\u0921\u092A\u0923, \u0932\u0949\u091F\u0930\u0940 \u0938\u0902\u0926\u0947\u0936 \u0906\u0923\u093F \u092C\u0928\u093E\u0935\u091F \u0915\u0942\u0930\u093F\u092F\u0930 \u0932\u093F\u0902\u0915 \u0913\u0933\u0916\u093E\u092F\u0932\u093E \u0936\u093F\u0915\u093E.",
      hinglish: "Urgency tricks, lottery messages aur fake courier SMS ko pehchanna seekhein."
    },
    steps: {
      en: [
        { stepNumber: 1, title: "Pause When Someone Rushes You", instruction: 'Scammers create fear or excitement ("Act in 10 minutes or account closes!"). Always pause for 30 seconds.', tip: "Real banks and officials give you time to verify in person." },
        { stepNumber: 2, title: "Check Web Addresses Carefully", instruction: "Avoid tapping unfamiliar links like bit.ly or strange spellings. Open the official app yourself instead.", tip: 'Paste any suspicious text into Buddy\u2019s "Is This Safe?" tool.' }
      ],
      hi: [
        { stepNumber: 1, title: "\u091C\u0932\u094D\u0926\u0940\u092C\u093E\u091C\u093C\u0940 \u092E\u0947\u0902 \u0930\u0941\u0915\u0947\u0902 \u0914\u0930 \u0938\u094B\u091A\u0947\u0902", instruction: "\u0920\u0917 \u0921\u0930 \u092F\u093E \u0932\u093E\u0932\u091A \u0926\u093F\u0916\u093E\u0924\u0947 \u0939\u0948\u0902\u0964 \u0915\u094B\u0908 \u092D\u0940 \u0915\u0926\u092E \u0909\u0920\u093E\u0928\u0947 \u0938\u0947 \u092A\u0939\u0932\u0947 30 \u0938\u0947\u0915\u0902\u0921 \u0930\u0941\u0915\u0947\u0902\u0964", tip: "\u0905\u0938\u0932\u0940 \u092C\u0948\u0902\u0915 \u0915\u092D\u0940 10 \u092E\u093F\u0928\u091F \u092E\u0947\u0902 \u0916\u093E\u0924\u093E \u092C\u0902\u0926 \u0915\u0930\u0928\u0947 \u0915\u0940 \u0927\u092E\u0915\u0940 \u0928\u0939\u0940\u0902 \u0926\u0947\u0924\u0947\u0964" },
        { stepNumber: 2, title: "\u0932\u093F\u0902\u0915 \u092A\u0930 \u0938\u0940\u0927\u0947 \u0915\u094D\u0932\u093F\u0915 \u0928 \u0915\u0930\u0947\u0902", instruction: "\u0905\u091C\u0940\u092C \u092F\u093E \u091B\u094B\u091F\u0947 \u0932\u093F\u0902\u0915 \u0916\u094B\u0932\u0928\u0947 \u0915\u0947 \u092C\u091C\u093E\u092F \u0939\u092E\u0947\u0936\u093E \u0906\u0927\u093F\u0915\u093E\u0930\u093F\u0915 \u0910\u092A \u092F\u093E \u0935\u0947\u092C\u0938\u093E\u0907\u091F \u0916\u0941\u0926 \u0916\u094B\u0932\u0947\u0902\u0964", tip: '\u0938\u0902\u0926\u093F\u0917\u094D\u0927 \u0938\u0902\u0926\u0947\u0936 \u0915\u094B "Is This Safe?" \u092E\u0947\u0902 \u091C\u093E\u0901\u091A\u0947\u0902\u0964' }
      ],
      mr: [
        { stepNumber: 1, title: "\u0918\u093E\u0908\u0924 \u0928\u093F\u0930\u094D\u0923\u092F \u0918\u0947\u090A \u0928\u0915\u093E", instruction: "\u092B\u0938\u0935\u0923\u0942\u0915 \u0915\u0930\u0923\u093E\u0930\u0947 \u092D\u0940\u0924\u0940 \u0915\u093F\u0902\u0935\u093E \u0906\u092E\u093F\u0937 \u0926\u093E\u0916\u0935\u0924\u093E\u0924. \u0915\u094B\u0923\u0924\u093E\u0939\u0940 \u0928\u093F\u0930\u094D\u0923\u092F \u0918\u0947\u0923\u094D\u092F\u093E\u092A\u0942\u0930\u094D\u0935\u0940 \u0969\u0966 \u0938\u0947\u0915\u0902\u0926 \u0925\u093E\u0902\u092C\u093E.", tip: "\u0916\u0930\u0940 \u092C\u0901\u0915 \u0915\u0927\u0940\u0939\u0940 \u0924\u093E\u0924\u094D\u0915\u093E\u0933 \u0916\u093E\u0924\u0947 \u092C\u0902\u0926 \u0915\u0930\u0923\u094D\u092F\u093E\u091A\u0940 \u0927\u092E\u0915\u0940 \u0926\u0947\u0924 \u0928\u093E\u0939\u0940." },
        { stepNumber: 2, title: "\u0905\u0928\u094B\u0933\u0916\u0940 \u0932\u093F\u0902\u0915\u0935\u0930 \u0915\u094D\u0932\u093F\u0915 \u0915\u0930\u0942 \u0928\u0915\u093E", instruction: "\u0932\u093F\u0902\u0915\u0935\u0930 \u091F\u0945\u092A \u0915\u0930\u0923\u094D\u092F\u093E\u0910\u0935\u091C\u0940 \u0928\u0947\u0939\u092E\u0940 \u0905\u0927\u093F\u0915\u0943\u0924 \u0905\u0945\u092A \u0938\u094D\u0935\u0924\u0903 \u0909\u0918\u0921\u093E.", tip: '\u0938\u0902\u0936\u092F\u093E\u0938\u094D\u092A\u0926 \u0938\u0902\u0926\u0947\u0936 "Is This Safe?" \u092E\u0927\u094D\u092F\u0947 \u0924\u092A\u093E\u0938\u093E.' }
      ],
      hinglish: [
        { stepNumber: 1, title: "Jaldi Mein Faisla Na Lein", instruction: "Scammers darr ya lalach dikhate hain. Koi bhi step lene se pehle 30 second rukein.", tip: "Asli bank kabhi 10 minute mein account band karne ki dhamki nahi dete." },
        { stepNumber: 2, title: "Unknown Link Click Na Karein", instruction: "Ajib links click karne ke bajay official app khud kholein.", tip: 'Shaq ho toh "Is This Safe?" mein paste karke check karein.' }
      ]
    }
  }
];

// server/permissions.ts
import crypto3 from "node:crypto";
function parsePermissions(jsonStr, fallbackLevel = "balanced") {
  const base = { ...PERMISSION_PRESETS[fallbackLevel] };
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      checkin_status: typeof parsed.checkin_status === "boolean" ? parsed.checkin_status : base.checkin_status,
      checkin_responses: typeof parsed.checkin_responses === "boolean" ? parsed.checkin_responses : base.checkin_responses,
      wellness_summaries: typeof parsed.wellness_summaries === "boolean" ? parsed.wellness_summaries : base.wellness_summaries,
      safety_alerts: typeof parsed.safety_alerts === "boolean" ? parsed.safety_alerts : base.safety_alerts,
      scam_alerts: typeof parsed.scam_alerts === "boolean" ? parsed.scam_alerts : base.scam_alerts,
      reminder_status: typeof parsed.reminder_status === "boolean" ? parsed.reminder_status : base.reminder_status,
      activity_summaries: typeof parsed.activity_summaries === "boolean" ? parsed.activity_summaries : base.activity_summaries,
      ai_summaries: typeof parsed.ai_summaries === "boolean" ? parsed.ai_summaries : base.ai_summaries,
      contact_info: typeof parsed.contact_info === "boolean" ? parsed.contact_info : base.contact_info
    };
  } catch {
    return base;
  }
}
function getActiveCaregiverLink(caregiverId, seniorId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT * FROM caregiver_links WHERE caregiver_id = ? AND senior_id = ? AND status = 'active' LIMIT 1`
  ).get(caregiverId, seniorId);
  if (!row) return null;
  return {
    link: row,
    permissions: parsePermissions(row.permissions_json, row.sharing_level)
  };
}
function recordPermissionHistory(seniorId, actorId, linkId, action, details) {
  const db = getDb();
  db.prepare(
    `INSERT INTO permission_history (id, senior_id, actor_id, link_id, action, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto3.randomUUID(), seniorId, actorId, linkId, action, JSON.stringify(details), (/* @__PURE__ */ new Date()).toISOString());
}
function recordAuditLog(userId, action, resource, details) {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, resource, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto3.randomUUID(), userId, action, resource, JSON.stringify(details), (/* @__PURE__ */ new Date()).toISOString());
}
function createNotification(userId, type, title, body) {
  const db = getDb();
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(crypto3.randomUUID(), userId, type, title, body, (/* @__PURE__ */ new Date()).toISOString());
}
function createAlertIfNotDuplicate(params) {
  const db = getDb();
  if (params.dedupeKey) {
    const existing = db.prepare(
      `SELECT id FROM alerts WHERE senior_id = ? AND dedupe_key = ? AND status != 'resolved' LIMIT 1`
    ).get(params.seniorId, params.dedupeKey);
    if (existing) {
      return { id: existing.id, created: false };
    }
  }
  const id = crypto3.randomUUID();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `INSERT INTO alerts (
      id, senior_id, type, severity, title, description, explanation,
      recommended_action, dedupe_key, is_read, status, reviewed_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', NULL, ?, ?)`
  ).run(
    id,
    params.seniorId,
    params.type,
    params.severity,
    params.title,
    params.description,
    params.explanation,
    params.recommendedAction,
    params.dedupeKey ?? null,
    now,
    now
  );
  const links = db.prepare(`SELECT caregiver_id, sharing_level, permissions_json FROM caregiver_links WHERE senior_id = ? AND status = 'active' AND caregiver_id IS NOT NULL`).all(params.seniorId);
  for (const link of links) {
    const perms = parsePermissions(link.permissions_json, link.sharing_level);
    const allowed = params.type === "scam_alert" && perms.scam_alerts || params.type !== "scam_alert" && perms.safety_alerts;
    if (allowed) {
      createNotification(
        link.caregiver_id,
        params.type,
        params.title,
        `${params.severity.toUpperCase()}: ${params.description}`
      );
    }
  }
  return { id, created: true };
}

// server/app.ts
function createRateLimiter(windowMs, maxRequests, options = {}) {
  const hits = /* @__PURE__ */ new Map();
  const limiterName = options.limiterName ?? "api_limiter";
  const keyByUser = options.keyByUser ?? false;
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const userId = keyByUser ? req.user?.id : void 0;
    const bucketKey = userId ? `user:${userId}` : `ip:${ip}`;
    const now = Date.now();
    if (hits.size > 1e3) {
      for (const [key, timestamps] of hits.entries()) {
        const active = timestamps.filter((ts) => now - ts < windowMs);
        if (active.length === 0) hits.delete(key);
        else hits.set(key, active);
      }
    }
    const list = (hits.get(bucketKey) ?? []).filter((ts) => now - ts < windowMs);
    if (list.length >= maxRequests) {
      const oldestTs = list[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1e3));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      console.warn("[Buddy Rate Limit]", {
        rateLimitSource: "express_limiter",
        limiter: limiterName,
        httpStatus: 429,
        retryAfter: retryAfterSeconds,
        endpoint: req.path,
        timestamp: new Date(now).toISOString()
      });
      res.status(429).json({
        success: false,
        code: "BACKEND_RATE_LIMIT",
        rateLimitSource: "express_limiter",
        retryAfterSeconds,
        error: {
          code: "BACKEND_RATE_LIMIT",
          message: `Buddy is helping many people right now. Please wait ${retryAfterSeconds} seconds before trying again.`,
          retryAfterSeconds,
          rateLimitSource: "express_limiter"
        }
      });
      return;
    }
    list.push(now);
    hits.set(bucketKey, list);
    next();
  };
}
function getMessagingConfigStatus() {
  const envRaw = getRawEnvMessagingNumber();
  if (envRaw) {
    const check = normalizePhoneWithCountryCode(envRaw);
    if (check.valid) {
      return { configured: true, number: check.e164, source: "env", error: null };
    }
    return {
      configured: false,
      number: null,
      source: "env",
      error: `BUDDY_MESSAGING_NUMBER is set in the server environment, but is invalid: ${check.error}`
    };
  }
  const db = getDb();
  const row = db.prepare(`SELECT value FROM system_config WHERE key = 'buddy_messaging_number'`).get();
  const dbRaw = row?.value?.trim();
  if (dbRaw) {
    const check = normalizePhoneWithCountryCode(dbRaw);
    if (check.valid) {
      return { configured: true, number: check.e164, source: "database", error: null };
    }
    return {
      configured: false,
      number: null,
      source: "database",
      error: `Saved messaging number is invalid: ${check.error}`
    };
  }
  return {
    configured: false,
    number: null,
    source: "none",
    error: "BUDDY_MESSAGING_NUMBER is not configured in the server environment or Admin Console."
  };
}
function generateInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += chars[crypto4.randomInt(0, chars.length)];
  }
  return `BE-${suffix}`;
}
function normalizeOriginEntry(raw) {
  const cleaned = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!cleaned) return null;
  try {
    const withScheme = /^[a-z]+:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}
function isProjectVercelPreviewOrigin(parsedOrigin) {
  if (parsedOrigin.protocol !== "https:") return false;
  const host = parsedOrigin.hostname.toLowerCase();
  return /^buddy-ai-agent-(?:3103|31)(?:-[a-z0-9-]+)*\.vercel\.app$/.test(host);
}
function matchesScopedWildcardOrigin(originUrl, pattern) {
  const cleaned = pattern.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "").toLowerCase();
  const match = cleaned.match(/^(https?):\/\/([^/]+)$/);
  if (!match) return false;
  const [, proto, hostPattern] = match;
  if (originUrl.protocol !== `${proto}:` || !hostPattern.includes("*")) return false;
  const wildcardRemoved = hostPattern.replace(/\*/g, "");
  if (!wildcardRemoved || wildcardRemoved.startsWith(".vercel.app") || wildcardRemoved.split(".").filter(Boolean).length < 3) {
    return false;
  }
  const regexStr = "^" + hostPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[a-z0-9-]+") + "$";
  return new RegExp(regexStr, "i").test(originUrl.hostname);
}
function isAllowedCorsOrigin(originHeader, requestHost, env = process.env) {
  let parsedOrigin;
  try {
    parsedOrigin = new URL(originHeader.trim());
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    return false;
  }
  if (requestHost && parsedOrigin.host.toLowerCase() === requestHost.toLowerCase()) {
    return true;
  }
  if (isProjectVercelPreviewOrigin(parsedOrigin)) {
    return true;
  }
  const normalizedOrigin = parsedOrigin.origin.toLowerCase();
  const configuredOrigins = /* @__PURE__ */ new Set();
  for (const single of [
    env.APP_URL,
    env.VERCEL_URL,
    env.VERCEL_BRANCH_URL,
    env.VERCEL_PROJECT_PRODUCTION_URL,
    env.RAILWAY_PUBLIC_DOMAIN,
    env.RAILWAY_STATIC_URL
  ]) {
    if (!single) continue;
    const norm = normalizeOriginEntry(single);
    if (norm) configuredOrigins.add(norm);
  }
  const isRailwayHost = Boolean(
    env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID || env.RAILWAY_VOLUME_MOUNT_PATH || env.RAILWAY_PUBLIC_DOMAIN
  );
  if (env.NODE_ENV !== "production" && !env.VERCEL && !isRailwayHost) {
    for (const devOrigin of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173"
    ]) {
      configuredOrigins.add(devOrigin);
    }
  }
  const wildcardPatterns = [];
  for (const rawEntry of (env.ALLOWED_ORIGINS ?? "").split(/[\s,]+/)) {
    const clean = rawEntry.trim();
    if (!clean) continue;
    if (clean.includes("*")) {
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
function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  getDb();
  app.locals.buddyMeta = {
    dbMode: getDatabaseStatus().mode,
    aiConfigured: getAiStatus().configured,
    messagingConfigured: getMessagingConfigStatus().configured
  };
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    const origin = typeof req.headers.origin === "string" ? req.headers.origin.trim() : "";
    let originAllowed = false;
    if (origin) {
      res.setHeader("Vary", "Origin");
      const rawForwardedHost = req.headers["x-forwarded-host"];
      const forwardedHost = typeof rawForwardedHost === "string" ? rawForwardedHost.split(",")[0]?.trim() : Array.isArray(rawForwardedHost) ? rawForwardedHost[0]?.split(",")[0]?.trim() : void 0;
      const host = forwardedHost || req.headers.host;
      originAllowed = isAllowedCorsOrigin(origin, host, process.env);
      if (originAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
        res.setHeader("Access-Control-Expose-Headers", "Retry-After");
        res.setHeader("Access-Control-Max-Age", "86400");
      }
    }
    if (req.method === "OPTIONS") {
      if (origin && !originAllowed) {
        res.status(403).json({
          success: false,
          code: "CORS_ORIGIN_DENIED",
          error: "Origin not allowed by CORS policy."
        });
        return;
      }
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", verifyCsrf);
  const authLimiter = createRateLimiter(6e4, 30, { limiterName: "auth_limiter", keyByUser: false });
  const chatLimiter = createRateLimiter(6e4, 20, { limiterName: "chat_limiter", keyByUser: true });
  const scamLimiter = createRateLimiter(6e4, 30, { limiterName: "scam_limiter", keyByUser: true });
  app.get("/api/health", (_req, res) => {
    let dbOk = false;
    try {
      const row = getDb().prepare("SELECT 1 AS ok").get();
      dbOk = row?.ok === 1;
    } catch {
      dbOk = false;
    }
    const messaging = getMessagingConfigStatus();
    const dbStatus = getDatabaseStatus();
    res.status(dbOk ? 200 : 503).json({
      ok: dbOk,
      status: dbOk ? "ok" : "degraded",
      uptimeSeconds: Math.floor(process.uptime()),
      nodeVersion: process.version,
      ai: getAiStatus(),
      messaging: {
        configured: messaging.configured,
        number: messaging.number,
        error: messaging.error
      },
      database: {
        ...dbStatus,
        ok: dbOk
      },
      adminSetup: hasAdminConfigured()
    });
  });
  app.use("/api/auth", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    res.setHeader("Pragma", "no-cache");
    next();
  });
  app.get("/api/auth/session", (req, res) => {
    const adminSetup = hasAdminConfigured();
    let resolution;
    try {
      resolution = resolveSessionForRequest(req);
    } catch (err) {
      console.error("[Buddy Auth Session DB Error]", {
        endpoint: req.path,
        error: err instanceof Error ? err.message : String(err)
      });
      res.status(503).json({
        success: false,
        code: "DATABASE_ERROR",
        error: "Unable to check your session right now. Please try again in a moment."
      });
      return;
    }
    if (resolution.status !== "valid") {
      if (resolution.status !== "missing" && hasSessionCookieHeader(req)) {
        clearSessionCookie(req, res);
      }
      res.json({
        authenticated: false,
        user: null,
        settings: null,
        adminSetup,
        ...resolution.status !== "missing" ? { reason: resolution.status } : {}
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
      adminSetup
    });
  });
  app.post("/api/auth/register", authLimiter, (req, res) => {
    const { email, password, name, phone, role, language } = req.body;
    const cleanEmail = email?.trim().toLowerCase();
    const cleanName = name?.trim();
    const selectedRole = role === "caregiver" ? "caregiver" : "senior";
    const selectedLang = language && ["en", "hi", "mr", "hinglish"].includes(language) ? language : "en";
    if (!cleanEmail || !cleanEmail.includes("@")) {
      res.status(400).json({ error: "Please enter a valid email address." });
      return;
    }
    if (!cleanName || cleanName.length < 2) {
      res.status(400).json({ error: "Please enter your full name." });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters long." });
      return;
    }
    let cleanPhone = null;
    if (phone?.trim()) {
      const phoneCheck = normalizePhoneWithCountryCode(phone);
      if (!phoneCheck.valid) {
        res.status(400).json({ error: phoneCheck.error });
        return;
      }
      cleanPhone = phoneCheck.e164;
    }
    const db = getDb();
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists. Please sign in." });
      return;
    }
    const userId = crypto4.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const passwordHash = hashPassword(password);
    db.prepare(
      `INSERT INTO users (id, email, name, phone, role, password_hash, language, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(userId, cleanEmail, cleanName, cleanPhone, selectedRole, passwordHash, selectedLang, now, now);
    const settings = ensureDefaultSettings(userId);
    if (selectedRole === "senior") {
      db.prepare(
        `INSERT OR IGNORE INTO messaging_onboarding (id, senior_id, setup_mode, senior_phone, status, verified_at, updated_at)
         VALUES (?, ?, 'self', ?, 'not_started', NULL, ?)`
      ).run(crypto4.randomUUID(), userId, cleanPhone, now);
    }
    const session = createSession(userId);
    setSessionCookie(req, res, session.token);
    recordAuditLog(userId, "user.register", "users", { role: selectedRole });
    res.status(201).json({
      user: {
        id: userId,
        email: cleanEmail,
        name: cleanName,
        phone: cleanPhone,
        role: selectedRole,
        language: selectedLang,
        is_active: true,
        created_at: now
      },
      settings,
      token: session.token
    });
  });
  app.post("/api/auth/login", authLimiter, (req, res) => {
    const { email, password } = req.body;
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail || !password) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }
    const db = getDb();
    const row = db.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`).get(cleanEmail);
    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }
    if (!row.is_active) {
      res.status(403).json({ error: "This account is inactive. Please contact an administrator." });
      return;
    }
    const settings = ensureDefaultSettings(row.id);
    const session = createSession(row.id);
    setSessionCookie(req, res, session.token);
    recordAuditLog(row.id, "user.login", "sessions", { role: row.role });
    res.json({
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        phone: row.phone,
        role: row.role,
        language: row.language,
        is_active: Boolean(row.is_active),
        created_at: row.created_at
      },
      settings,
      token: session.token
    });
  });
  app.post("/api/auth/admin/claim", authLimiter, (req, res) => {
    const { email, name, passcode } = req.body;
    const status = hasAdminConfigured();
    if (status.hasEnvPasscode || status.hasClaimedPasscode) {
      res.status(403).json({ error: "Admin access has already been configured. Please use Admin Sign In." });
      return;
    }
    const cleanEmail = email?.trim().toLowerCase() || "admin@buddyelder.local";
    const cleanName = name?.trim() || "Platform Administrator";
    if (!cleanEmail.includes("@")) {
      res.status(400).json({ error: "Please enter a valid administrator email address." });
      return;
    }
    if (!passcode || passcode.length < 8) {
      res.status(400).json({ error: "Admin passcode must be at least 8 characters." });
      return;
    }
    const db = getDb();
    const existing = db.prepare(`SELECT id, role FROM users WHERE email = ?`).get(cleanEmail);
    if (existing && existing.role !== "admin") {
      res.status(403).json({ error: "This email is already used by a non-administrator account." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const passHash = hashPassword(passcode);
    db.exec("BEGIN IMMEDIATE;");
    let userId;
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
        userId = crypto4.randomUUID();
        db.prepare(
          `INSERT INTO users (id, email, name, phone, role, password_hash, language, is_active, created_at, updated_at)
           VALUES (?, ?, ?, NULL, 'admin', ?, 'en', 1, ?, ?)`
        ).run(userId, cleanEmail, cleanName, passHash, now, now);
      }
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
    const settings = ensureDefaultSettings(userId);
    const session = createSession(userId);
    setSessionCookie(req, res, session.token);
    recordAuditLog(userId, "admin.claim", "system_config", { email: cleanEmail });
    const userRow = db.prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE id = ?`).get(userId);
    res.status(201).json({
      user: { ...userRow, is_active: Boolean(userRow.is_active) },
      settings,
      token: session.token
    });
  });
  app.post("/api/auth/admin/login", authLimiter, (req, res) => {
    const adminConfig = hasAdminConfigured();
    if (!adminConfig.hasEnvPasscode && !adminConfig.hasClaimedPasscode) {
      res.status(503).json({
        error: "Administrator passcode is not configured on the server (ADMIN_PASSCODE is missing). Set ADMIN_PASSCODE in environment variables or complete first-run setup.",
        code: "ADMIN_PASSCODE_MISSING"
      });
      return;
    }
    const { passcode, email } = req.body;
    if (!passcode || !passcode.trim()) {
      res.status(400).json({ error: "Administrator passcode is required." });
      return;
    }
    if (!verifyAdminPasscode(passcode)) {
      res.status(401).json({ error: "Invalid administrator passcode." });
      return;
    }
    const db = getDb();
    const cleanEmail = email?.trim().toLowerCase();
    let adminRow;
    if (cleanEmail) {
      const existingByEmail = db.prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE email = ? LIMIT 1`).get(cleanEmail);
      if (existingByEmail && existingByEmail.role !== "admin") {
        res.status(403).json({ error: "This email is registered as a non-administrator account." });
        return;
      }
      adminRow = existingByEmail;
    } else {
      adminRow = db.prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1`).get();
      if (!adminRow) {
        const inactiveAdmin = db.prepare(`SELECT id, email, name, phone, role, language, is_active, created_at FROM users WHERE role = 'admin' LIMIT 1`).get();
        if (inactiveAdmin) {
          adminRow = inactiveAdmin;
        }
      }
    }
    if (adminRow && !adminRow.is_active) {
      res.status(403).json({ error: "This administrator account is inactive. Please contact another administrator." });
      return;
    }
    if (!adminRow) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const id = crypto4.randomUUID();
      const adminEmail = cleanEmail || "admin@buddyelder.local";
      db.prepare(
        `INSERT INTO users (id, email, name, phone, role, password_hash, language, is_active, created_at, updated_at)
         VALUES (?, ?, 'Platform Administrator', NULL, 'admin', ?, 'en', 1, ?, ?)`
      ).run(id, adminEmail, hashPassword(passcode), now, now);
      adminRow = {
        id,
        email: adminEmail,
        name: "Platform Administrator",
        phone: null,
        role: "admin",
        language: "en",
        is_active: 1,
        created_at: now
      };
    }
    const settings = ensureDefaultSettings(adminRow.id);
    const session = createSession(adminRow.id);
    setSessionCookie(req, res, session.token);
    recordAuditLog(adminRow.id, "admin.login", "sessions", {});
    res.json({
      user: { ...adminRow, is_active: Boolean(adminRow.is_active) },
      settings,
      token: session.token
    });
  });
  app.post("/api/auth/forgot-password", authLimiter, (req, res) => {
    const { email } = req.body;
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail) {
      res.status(400).json({ error: "Please provide your registered email address." });
      return;
    }
    const db = getDb();
    const user = db.prepare(`SELECT id, is_active FROM users WHERE email = ?`).get(cleanEmail);
    if (!user || !user.is_active) {
      res.json({
        ok: true,
        message: "If that email exists, a verification reset code has been prepared."
      });
      return;
    }
    const resetCode = String(crypto4.randomInt(1e5, 999999));
    const now = /* @__PURE__ */ new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1e3).toISOString();
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare(`UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).run(nowIso, user.id);
      db.prepare(
        `INSERT INTO password_resets (id, user_id, code_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`
      ).run(crypto4.randomUUID(), user.id, hashToken(resetCode), expiresAt, nowIso);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
    const responsePayload = {
      ok: true,
      message: "Verification reset code generated. Enter the 6-digit code below to set a new password."
    };
    if (process.env.NODE_ENV !== "production") {
      responsePayload.devResetCode = resetCode;
    }
    res.json(responsePayload);
  });
  app.post("/api/auth/reset-password", authLimiter, (req, res) => {
    const { email, code, newPassword } = req.body;
    const cleanEmail = email?.trim().toLowerCase();
    if (!cleanEmail || !code || !newPassword || newPassword.length < 6) {
      res.status(400).json({ error: "Valid email, 6-digit code, and new password (min 6 chars) are required." });
      return;
    }
    const db = getDb();
    const user = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
    if (!user) {
      res.status(400).json({ error: "Invalid reset code or email." });
      return;
    }
    const codeHash = hashToken(code.trim());
    const resetRow = db.prepare(
      `SELECT id, expires_at, used_at FROM password_resets
         WHERE user_id = ? AND code_hash = ? ORDER BY created_at DESC LIMIT 1`
    ).get(user.id, codeHash);
    if (!resetRow || resetRow.used_at || new Date(resetRow.expires_at).getTime() <= Date.now()) {
      res.status(400).json({ error: "Reset code is invalid or expired." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
        hashPassword(newPassword),
        now,
        user.id
      );
      db.prepare(`UPDATE password_resets SET used_at = ? WHERE id = ?`).run(now, resetRow.id);
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
    recordAuditLog(user.id, "user.password_reset", "users", {});
    res.json({ ok: true, message: "Password updated successfully. Please sign in." });
  });
  app.post("/api/auth/logout", (req, res) => {
    try {
      for (const candidate of extractCandidateTokens(req)) {
        deleteSessionByHash(hashToken(candidate.token));
      }
    } catch {
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });
  app.get("/api/settings", requireAuth, (req, res) => {
    const settings = ensureDefaultSettings(req.user.id);
    res.json({ user: req.user, settings });
  });
  app.put("/api/settings", requireAuth, (req, res) => {
    const userId = req.user.id;
    const body = req.body;
    const db = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const currentSettings = ensureDefaultSettings(userId);
    const nextName = body.name?.trim() || req.user.name;
    let nextPhone = req.user.phone;
    if (body.phone !== void 0) {
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
    const nextLang = body.language && ["en", "hi", "mr", "hinglish"].includes(body.language) ? body.language : req.user.language;
    db.prepare(`UPDATE users SET name = ?, phone = ?, language = ?, updated_at = ? WHERE id = ?`).run(
      nextName,
      nextPhone,
      nextLang,
      now,
      userId
    );
    const nextTextSize = body.text_size && ["sm", "normal", "lg", "xl"].includes(body.text_size) ? body.text_size : currentSettings.text_size;
    const nextContrast = body.contrast_mode && ["standard", "high"].includes(body.contrast_mode) ? body.contrast_mode : currentSettings.contrast_mode;
    const nextTheme = body.theme && ["light", "dark"].includes(body.theme) ? body.theme : currentSettings.theme;
    const nextReducedMotion = typeof body.reduced_motion === "boolean" ? body.reduced_motion : currentSettings.reduced_motion;
    const nextVoiceEnabled = typeof body.voice_enabled === "boolean" ? body.voice_enabled : currentSettings.voice_enabled;
    const nextVoiceSpeed = body.voice_speed && ["slow", "normal", "fast"].includes(body.voice_speed) ? body.voice_speed : currentSettings.voice_speed;
    const nextVoiceName = body.voice_name !== void 0 ? body.voice_name : currentSettings.voice_name;
    const nextNotifications = typeof body.notifications_enabled === "boolean" ? body.notifications_enabled : currentSettings.notifications_enabled;
    const nextOnboarding = typeof body.onboarding_completed === "boolean" ? body.onboarding_completed : currentSettings.onboarding_completed;
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
      ...req.user,
      name: nextName,
      phone: nextPhone,
      language: nextLang
    };
    const updatedSettings = ensureDefaultSettings(userId);
    res.json({ user: updatedUser, settings: updatedSettings });
  });
  app.get("/api/account/export", requireAuth, (req, res) => {
    const userId = req.user.id;
    const db = getDb();
    const exportBundle = {
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      user: req.user,
      settings: ensureDefaultSettings(userId),
      emergencyContacts: db.prepare(`SELECT * FROM emergency_contacts WHERE senior_id = ?`).all(userId),
      checkIns: db.prepare(`SELECT * FROM check_ins WHERE senior_id = ? ORDER BY checkin_date DESC`).all(userId),
      lessonProgress: db.prepare(`SELECT * FROM lesson_progress WHERE user_id = ?`).all(userId),
      scamAssessments: db.prepare(`SELECT * FROM scam_assessments WHERE user_id = ?`).all(userId),
      reminders: db.prepare(`SELECT * FROM reminders WHERE senior_id = ?`).all(userId),
      conversations: db.prepare(`SELECT id, title, language, created_at FROM conversations WHERE user_id = ?`).all(userId)
    };
    res.json(exportBundle);
  });
  app.delete("/api/account", requireAuth, (req, res) => {
    const userId = req.user.id;
    const db = getDb();
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });
  app.get("/api/senior/contacts", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const contacts = db.prepare(`SELECT * FROM emergency_contacts WHERE senior_id = ? ORDER BY is_primary DESC, created_at ASC`).all(req.user.id);
    res.json({ contacts });
  });
  app.post("/api/senior/contacts", requireAuth, requireRole("senior"), (req, res) => {
    const { name, relationship, phone, isPrimary } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ error: "Contact name and phone number are required." });
      return;
    }
    const cleanedPhone = phone.trim();
    if (!/^[+\d\s()-]{6,20}$/.test(cleanedPhone)) {
      res.status(400).json({ error: "Please enter a valid phone number." });
      return;
    }
    const db = getDb();
    const id = crypto4.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.exec("BEGIN IMMEDIATE;");
    try {
      if (isPrimary) {
        db.prepare(`UPDATE emergency_contacts SET is_primary = 0 WHERE senior_id = ?`).run(req.user.id);
      }
      db.prepare(
        `INSERT INTO emergency_contacts (id, senior_id, name, relationship, phone, is_primary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.user.id, name.trim(), relationship?.trim() || "Family", cleanedPhone, isPrimary ? 1 : 0, now);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
    const contacts = db.prepare(`SELECT * FROM emergency_contacts WHERE senior_id = ? ORDER BY is_primary DESC, created_at ASC`).all(req.user.id);
    res.status(201).json({ contacts });
  });
  app.delete("/api/senior/contacts/:id", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    db.prepare(`DELETE FROM emergency_contacts WHERE id = ? AND senior_id = ?`).run(
      req.params.id,
      req.user.id
    );
    res.json({ ok: true });
  });
  app.get("/api/ai/status", requireAuth, (_req, res) => {
    res.json(getAiStatus());
  });
  const diagnoseLimiter = createRateLimiter(6e4, 3, { limiterName: "ai_diagnose_limiter", keyByUser: true });
  app.get("/api/ai/diagnose", requireAuth, requireRole("admin"), diagnoseLimiter, async (req, res) => {
    try {
      const probeModels = req.query.probe === "1" || req.query.probe === "true";
      res.json({ success: true, report: await runGeminiDiagnostics({ probeModels }) });
    } catch {
      res.status(500).json({ success: false, code: "DIAGNOSTIC_FAILED", error: { code: "DIAGNOSTIC_FAILED", message: "Diagnostic could not run." } });
    }
  });
  app.get("/api/ai/conversations", requireAuth, (req, res) => {
    const db = getDb();
    const conversations = db.prepare(`SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`).all(req.user.id);
    res.json({ conversations });
  });
  app.post("/api/ai/conversations", requireAuth, (req, res) => {
    const { title, language } = req.body;
    const db = getDb();
    const id = crypto4.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const lang = language && ["en", "hi", "mr", "hinglish"].includes(language) ? language : req.user.language;
    const convTitle = title?.trim() || "New Conversation";
    db.prepare(
      `INSERT INTO conversations (id, user_id, title, language, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.user.id, convTitle, lang, now, now);
    const conversation = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(id);
    res.status(201).json({ conversation });
  });
  app.get("/api/ai/conversations/:id/messages", requireAuth, (req, res) => {
    const db = getDb();
    const conv = db.prepare(`SELECT * FROM conversations WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const messages = db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(req.params.id);
    res.json({ success: true, conversation: conv, messages });
  });
  app.post("/api/ai/conversations/:id/messages", requireAuth, chatLimiter, async (req, res) => {
    const startedAt = Date.now();
    const routePath = "/api/ai/conversations/:id/messages";
    const currentModel = getAiStatus().model;
    const convId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const { message, language } = body;
    const cleanMsg = typeof message === "string" ? message.trim() : "";
    if (!convId || convId.length > 128) {
      res.status(400).json({
        success: false,
        code: "INVALID_INPUT",
        error: {
          code: "INVALID_INPUT",
          message: "Invalid conversation ID."
        }
      });
      return;
    }
    if (!cleanMsg) {
      res.status(400).json({
        success: false,
        code: "INVALID_INPUT",
        error: {
          code: "INVALID_INPUT",
          message: "Please type or speak a question first."
        }
      });
      return;
    }
    let dbErrorCategory = null;
    let savedUserMessage;
    try {
      const db = getDb();
      let conv;
      let existingMessages;
      try {
        conv = db.prepare(`SELECT id, title, language FROM conversations WHERE id = ? AND user_id = ?`).get(convId, req.user.id);
        if (!conv) {
          res.status(404).json({
            success: false,
            code: "CONVERSATION_NOT_FOUND",
            error: {
              code: "CONVERSATION_NOT_FOUND",
              message: "Conversation not found."
            }
          });
          return;
        }
        existingMessages = db.prepare(`SELECT id, role, content, language, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(conv.id);
      } catch (dbErr) {
        dbErrorCategory = "conversation_read_error";
        throw dbErr;
      }
      const lang = language && ["en", "hi", "mr", "hinglish"].includes(language) ? language : req.user.language;
      const nextTitle = conv.title === "New Conversation" ? cleanMsg.slice(0, 48) + (cleanMsg.length > 48 ? "\u2026" : "") : conv.title;
      const lastExisting = existingMessages[existingMessages.length - 1];
      const isRetryingLastUserTurn = Boolean(lastExisting) && lastExisting.role === "user" && lastExisting.content.trim() === cleanMsg;
      let historyForAi;
      try {
        if (isRetryingLastUserTurn && lastExisting) {
          savedUserMessage = {
            id: lastExisting.id,
            conversation_id: conv.id,
            role: "user",
            content: lastExisting.content,
            language: lang,
            created_at: lastExisting.created_at
          };
          historyForAi = existingMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
        } else {
          const lastMs = lastExisting ? Date.parse(lastExisting.created_at) : 0;
          const nowUser = new Date(Math.max(Date.now(), Number.isFinite(lastMs) ? lastMs + 1 : 0)).toISOString();
          const userMsgId = crypto4.randomUUID();
          db.exec("BEGIN IMMEDIATE;");
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
            db.exec("COMMIT;");
          } catch (innerErr) {
            db.exec("ROLLBACK;");
            throw innerErr;
          }
          savedUserMessage = {
            id: userMsgId,
            conversation_id: conv.id,
            role: "user",
            content: cleanMsg,
            language: lang,
            created_at: nowUser
          };
          historyForAi = existingMessages.map((m) => ({ role: m.role, content: m.content }));
        }
      } catch (dbErr) {
        dbErrorCategory = "message_write_error";
        throw dbErr;
      }
      const aiResult = await generateBuddyReply({
        history: historyForAi,
        userMessage: cleanMsg,
        language: lang,
        userName: req.user.name
      });
      const userMs = Date.parse(savedUserMessage.created_at);
      const nowBot = new Date(Math.max(Date.now(), (Number.isFinite(userMs) ? userMs : 0) + 1)).toISOString();
      const botMsgId = crypto4.randomUUID();
      try {
        db.exec("BEGIN IMMEDIATE;");
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
          db.exec("COMMIT;");
        } catch (innerErr) {
          db.exec("ROLLBACK;");
          throw innerErr;
        }
      } catch (dbErr) {
        dbErrorCategory = "message_write_error";
        throw dbErr;
      }
      console.info("[Buddy AI Chat]", {
        endpoint: routePath,
        httpStatus: 200,
        model: aiResult.model,
        fallbackUsed: aiResult.fallbackUsed,
        attemptedModels: aiResult.attemptedModels,
        retryCount: aiResult.retryCount,
        durationMs: Date.now() - startedAt,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        emptyResponse: false
      });
      res.status(200).json({
        success: true,
        reply: aiResult.reply,
        response: aiResult.reply,
        conversationId: conv.id,
        conversationStatus: "responded",
        model: aiResult.model,
        fallbackUsed: aiResult.fallbackUsed,
        attemptedModels: aiResult.attemptedModels,
        userMessage: savedUserMessage,
        assistantMessage: {
          id: botMsgId,
          conversation_id: conv.id,
          role: "assistant",
          content: aiResult.reply,
          language: lang,
          created_at: nowBot
        },
        suggestions: aiResult.suggestions,
        title: nextTitle
      });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      if (err instanceof AiServiceError) {
        if (savedUserMessage) {
          try {
            getDb().prepare(
              `UPDATE conversations
                 SET last_status = 'failed', last_error_code = ?, last_error_message = ?, updated_at = ?
                 WHERE id = ?`
            ).run(err.code, err.message.slice(0, 500), (/* @__PURE__ */ new Date()).toISOString(), convId);
          } catch {
          }
        }
        if (err.retryAfterSeconds) {
          res.setHeader("Retry-After", String(err.retryAfterSeconds));
        }
        const isExpectedTransientOrConfig = err.code === "AI_RATE_LIMIT" || err.code === "AI_QUOTA_EXHAUSTED" || err.code === "MISSING_API_KEY" || err.code === "AI_SAFETY_BLOCK" || err.code === "UPSTREAM_ERROR" && err.statusCode === 503;
        const logFn = isExpectedTransientOrConfig ? console.warn : console.error;
        logFn("[Buddy AI Chat Notice]", {
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
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          emptyResponse: err.code === "AI_EMPTY_RESPONSE",
          dbErrorCategory: null
        });
        res.status(err.statusCode).json({
          success: false,
          code: err.code,
          model: err.model ?? currentModel,
          ...savedUserMessage ? { conversationStatus: "failed" } : {},
          ...err.attemptedModels ? { attemptedModels: err.attemptedModels } : {},
          ...err.fallbackAttempted !== void 0 ? { fallbackAttempted: err.fallbackAttempted } : {},
          ...savedUserMessage ? { userMessageSaved: true, userMessage: savedUserMessage } : {},
          ...err.rateLimitSource ? { rateLimitSource: err.rateLimitSource } : {},
          ...err.retryAfterSeconds !== void 0 ? { retryAfterSeconds: err.retryAfterSeconds } : {},
          ...err.quotaExhausted !== void 0 ? { quotaExhausted: err.quotaExhausted } : {},
          ...err.upstreamStatus !== void 0 ? { upstreamStatus: err.upstreamStatus } : {},
          ...err.geminiErrorCode ? { geminiErrorCode: err.geminiErrorCode } : {},
          error: {
            code: err.code,
            message: err.message,
            ...err.attemptedModels ? { attemptedModels: err.attemptedModels } : {},
            ...err.rateLimitSource ? { rateLimitSource: err.rateLimitSource } : {},
            ...err.retryAfterSeconds !== void 0 ? { retryAfterSeconds: err.retryAfterSeconds } : {},
            ...err.quotaExhausted !== void 0 ? { quotaExhausted: err.quotaExhausted } : {}
          }
        });
        return;
      }
      const category = dbErrorCategory ?? "unexpected_server_error";
      if (savedUserMessage && !dbErrorCategory) {
        try {
          getDb().prepare(
            `UPDATE conversations
               SET last_status = 'failed', last_error_code = 'AI_SERVICE_ERROR', last_error_message = ?, updated_at = ?
               WHERE id = ?`
          ).run("Buddy is temporarily unable to respond. Please try again in a moment.", (/* @__PURE__ */ new Date()).toISOString(), convId);
        } catch {
        }
      }
      console.error("[Buddy AI Chat Failure]", {
        route: routePath,
        status: 500,
        errorCategory: category,
        geminiErrorType: null,
        model: currentModel,
        durationMs,
        emptyResponse: false,
        dbErrorCategory
      });
      res.status(500).json({
        success: false,
        code: "AI_SERVICE_ERROR",
        ...savedUserMessage ? { userMessageSaved: true, userMessage: savedUserMessage, conversationStatus: "failed" } : {},
        error: {
          code: "AI_SERVICE_ERROR",
          message: dbErrorCategory ? "Unable to save your conversation right now. Please try again in a moment." : "Buddy is temporarily unable to respond. Please try again in a moment."
        }
      });
    }
  });
  app.post("/api/ai/conversations/:id/clear", requireAuth, (req, res) => {
    const db = getDb();
    const conv = db.prepare(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
    if (!conv) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(req.params.id);
      db.prepare(
        `UPDATE conversations
         SET last_status = 'idle', last_error_code = NULL, last_error_message = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, req.params.id);
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
    res.json({ ok: true });
  });
  app.delete("/api/ai/conversations/:id", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
    res.json({ ok: true });
  });
  function parseJsonStringArray(raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  app.get("/api/scam/history", requireAuth, (req, res) => {
    try {
      const db = getDb();
      const assessments = db.prepare(`SELECT * FROM scam_assessments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(req.user.id);
      res.json({
        success: true,
        assessments: assessments.map((a) => {
          const indicators = parseJsonStringArray(a.indicators_json);
          const recommendedActions = parseJsonStringArray(a.actions_json);
          return {
            ...a,
            indicators,
            recommendedActions,
            actions: recommendedActions
          };
        })
      });
    } catch {
      res.status(500).json({
        success: false,
        code: "SCAM_HISTORY_ERROR",
        error: { code: "SCAM_HISTORY_ERROR", message: "Unable to load safety check history right now." }
      });
    }
  });
  app.post("/api/scam/analyze", requireAuth, scamLimiter, async (req, res) => {
    const startedAt = Date.now();
    const { content, inputType, language } = req.body;
    const cleanContent = typeof content === "string" ? content.trim() : "";
    if (!cleanContent) {
      res.status(400).json({
        success: false,
        code: "INVALID_INPUT",
        error: {
          code: "INVALID_INPUT",
          message: "Please paste a message, link, or phone number to check."
        }
      });
      return;
    }
    const lang = language && ["en", "hi", "mr", "hinglish"].includes(language) ? language : req.user.language;
    const rawType = typeof inputType === "string" ? inputType.trim().toLowerCase() : "message";
    const typeLabel = ["sms", "whatsapp", "url", "phone", "email", "message"].includes(rawType) ? rawType : "message";
    try {
      const result = await analyzeScamContent({
        content: cleanContent.slice(0, 4e3),
        inputType: typeLabel,
        language: lang
      });
      const id = crypto4.randomUUID();
      const now = (/* @__PURE__ */ new Date()).toISOString();
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
          req.user.id,
          typeLabel,
          cleanContent.slice(0, 2e3),
          result.riskLevel,
          result.explanation,
          JSON.stringify(result.indicators),
          JSON.stringify(result.recommendedActions),
          result.source,
          now
        );
      } catch (dbErr) {
        persisted = false;
        console.error("[Buddy Scam Check DB Warning]", {
          route: "/api/scam/analyze",
          dbErrorCategory: "assessment_insert_error",
          message: dbErr instanceof Error ? dbErr.message : "DB insert failed"
        });
      }
      if (req.user.role === "senior" && (result.riskLevel === "RED" || result.riskLevel === "YELLOW")) {
        try {
          const dedupeKey = `scam_${hashToken(cleanContent.slice(0, 200))}`;
          createAlertIfNotDuplicate({
            seniorId: req.user.id,
            type: "scam_alert",
            severity: result.riskLevel === "RED" ? "critical" : "warning",
            title: result.riskLevel === "RED" ? "High-Risk Scam Message Checked" : "Suspicious Message Checked",
            description: `${req.user.name} checked a suspicious ${typeLabel} (${result.riskLevel}).`,
            explanation: result.explanation,
            recommendedAction: result.recommendedActions[0] || "Check in with your family member gently.",
            dedupeKey
          });
        } catch {
        }
      }
      console.info("[Buddy Scam Check]", {
        route: "/api/scam/analyze",
        status: 200,
        inputType: typeLabel,
        riskLevel: result.riskLevel,
        source: result.source,
        fallbackReason: result.fallbackReason ?? null,
        persisted,
        durationMs: Date.now() - startedAt
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
        ...result.fallbackReason ? { fallbackReason: result.fallbackReason } : {},
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
          ...result.fallbackReason ? { fallbackReason: result.fallbackReason } : {},
          created_at: now
        }
      });
    } catch (err) {
      if (err instanceof AiServiceError) {
        res.status(err.statusCode).json({
          success: false,
          code: err.code,
          error: { code: err.code, message: err.message }
        });
        return;
      }
      console.error("[Buddy Scam Check Error]", {
        route: "/api/scam/analyze",
        durationMs: Date.now() - startedAt
      });
      res.status(500).json({
        success: false,
        code: "SCAM_CHECK_FAILED",
        error: {
          code: "SCAM_CHECK_FAILED",
          message: "Unable to analyze content right now. Please try again in a moment."
        }
      });
    }
  });
  app.post("/api/scam/report", requireAuth, requireRole("senior"), (req, res) => {
    const { content, notes } = req.body;
    if (!content?.trim()) {
      res.status(400).json({ error: "Please describe or paste the suspicious call/message." });
      return;
    }
    const dedupeKey = `report_${hashToken(content.trim().slice(0, 150))}`;
    const alertRes = createAlertIfNotDuplicate({
      seniorId: req.user.id,
      type: "scam_alert",
      severity: "critical",
      title: "Suspicious Call or Message Reported",
      description: `${req.user.name} requested family review for a suspicious contact.`,
      explanation: notes?.trim() || content.trim().slice(0, 400),
      recommendedAction: "Call your family member to verify and reassure them.",
      dedupeKey
    });
    res.status(201).json({ ok: true, alertId: alertRes.id });
  });
  app.post("/api/reader/parse-upload", requireAuth, (req, res) => {
    const { filename, content } = req.body;
    if (!filename || typeof content !== "string") {
      res.status(400).json({ error: "File name and content are required." });
      return;
    }
    const ext = filename.toLowerCase().split(".").pop() || "";
    if (!["txt", "md", "csv", "json", "log"].includes(ext)) {
      res.status(400).json({
        error: `Unsupported file format (.${ext}). Please upload plain text (.txt, .md, .csv) or paste the text directly.`
      });
      return;
    }
    if (!content.trim()) {
      res.status(400).json({ error: "The uploaded document is empty." });
      return;
    }
    res.json({ filename, text: content.slice(0, 5e4) });
  });
  app.get("/api/lessons", requireAuth, (req, res) => {
    const db = getDb();
    const progressRows = db.prepare(`SELECT * FROM lesson_progress WHERE user_id = ?`).all(req.user.id);
    const progressMap = new Map(
      progressRows.map((p) => [
        p.lesson_id,
        {
          completedSteps: JSON.parse(p.completed_steps_json),
          isCompleted: Boolean(p.is_completed),
          lastStep: p.last_step,
          updatedAt: p.updated_at
        }
      ])
    );
    const lessons = LESSONS_CATALOG.map((lesson) => ({
      ...lesson,
      progress: progressMap.get(lesson.id) ?? {
        completedSteps: [],
        isCompleted: false,
        lastStep: 1,
        updatedAt: null
      }
    }));
    const completedCount = lessons.filter((l) => l.progress.isCompleted).length;
    res.json({ lessons, completedCount, totalCount: lessons.length });
  });
  app.put("/api/lessons/:lessonId/progress", requireAuth, (req, res) => {
    const lesson = LESSONS_CATALOG.find((l) => l.id === req.params.lessonId);
    if (!lesson) {
      res.status(404).json({ error: "Lesson not found." });
      return;
    }
    const { completedSteps, lastStep, isCompleted } = req.body;
    const validSteps = Array.isArray(completedSteps) ? Array.from(new Set(completedSteps.filter((n) => Number.isInteger(n) && n >= 1))) : [];
    const stepPos = Number.isInteger(lastStep) && lastStep >= 1 ? lastStep : 1;
    const totalSteps = lesson.steps.en.length;
    const completed = Boolean(isCompleted) || validSteps.length >= totalSteps;
    const db = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = db.prepare(`SELECT id FROM lesson_progress WHERE user_id = ? AND lesson_id = ?`).get(req.user.id, lesson.id);
    if (existing) {
      db.prepare(
        `UPDATE lesson_progress SET completed_steps_json = ?, is_completed = ?, last_step = ?, updated_at = ?
         WHERE id = ?`
      ).run(JSON.stringify(validSteps), completed ? 1 : 0, stepPos, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO lesson_progress (id, user_id, lesson_id, completed_steps_json, is_completed, last_step, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto4.randomUUID(), req.user.id, lesson.id, JSON.stringify(validSteps), completed ? 1 : 0, stepPos, now);
    }
    res.json({
      lessonId: lesson.id,
      completedSteps: validSteps,
      isCompleted: completed,
      lastStep: stepPos,
      updatedAt: now
    });
  });
  app.get("/api/checkins", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const checkIns = db.prepare(`SELECT * FROM check_ins WHERE senior_id = ? ORDER BY checkin_date DESC LIMIT 30`).all(req.user.id);
    const formatted = checkIns.map((c) => ({
      ...c,
      needs_help: c.needs_help === null ? null : Boolean(c.needs_help),
      wants_family_call: c.wants_family_call === null ? null : Boolean(c.wants_family_call),
      feels_safe: c.feels_safe === null ? null : Boolean(c.feels_safe)
    }));
    res.json({
      todayCheckIn: formatted.find((c) => c.checkin_date === today) || null,
      history: formatted
    });
  });
  app.post("/api/checkins", requireAuth, requireRole("senior"), (req, res) => {
    const { mood, medicationTaken, needsHelp, wantsFamilyCall, feelsSafe, note, date } = req.body;
    if (!mood || !["good", "okay", "not_good"].includes(mood)) {
      res.status(400).json({ error: "Please select how you are feeling today." });
      return;
    }
    const checkinDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const db = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const existing = db.prepare(`SELECT id FROM check_ins WHERE senior_id = ? AND checkin_date = ?`).get(req.user.id, checkinDate);
    const needsHelpInt = needsHelp === null || needsHelp === void 0 ? null : needsHelp ? 1 : 0;
    const wantsCallInt = wantsFamilyCall === null || wantsFamilyCall === void 0 ? null : wantsFamilyCall ? 1 : 0;
    const feelsSafeInt = feelsSafe === null || feelsSafe === void 0 ? null : feelsSafe ? 1 : 0;
    const medVal = medicationTaken ?? null;
    const cleanNote = note?.trim().slice(0, 500) || null;
    let id;
    let updated = false;
    if (existing) {
      id = existing.id;
      updated = true;
      db.prepare(
        `UPDATE check_ins SET mood = ?, medication_taken = ?, needs_help = ?, wants_family_call = ?, feels_safe = ?, note = ?, updated_at = ?
         WHERE id = ?`
      ).run(mood, medVal, needsHelpInt, wantsCallInt, feelsSafeInt, cleanNote, now, id);
    } else {
      id = crypto4.randomUUID();
      db.prepare(
        `INSERT INTO check_ins (
          id, senior_id, checkin_date, mood, medication_taken,
          needs_help, wants_family_call, feels_safe, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.user.id, checkinDate, mood, medVal, needsHelpInt, wantsCallInt, feelsSafeInt, cleanNote, now, now);
    }
    if (feelsSafe === false) {
      createAlertIfNotDuplicate({
        seniorId: req.user.id,
        type: "safety_alert",
        severity: "critical",
        title: "Safety Check-in Concern",
        description: `${req.user.name} indicated they do not feel safe in today's check-in.`,
        explanation: cleanNote || 'Senior selected "No" for feeling safe during daily check-in.',
        recommendedAction: "Call your family member promptly to check in.",
        dedupeKey: `checkin_unsafe_${checkinDate}`
      });
    } else if (needsHelp === true || mood === "not_good" || wantsFamilyCall === true) {
      createAlertIfNotDuplicate({
        seniorId: req.user.id,
        type: "assistance_request",
        severity: needsHelp === true ? "warning" : "informational",
        title: wantsFamilyCall ? "Family Call Requested" : "Check-in Needs Attention",
        description: `${req.user.name} checked in (${mood.replace("_", " ")})${needsHelp ? " and asked for help" : ""}.`,
        explanation: cleanNote || "Reported during daily wellness check-in.",
        recommendedAction: "Give your family member a friendly call.",
        dedupeKey: `checkin_help_${checkinDate}`
      });
    }
    res.status(updated ? 200 : 201).json({
      updated,
      checkIn: {
        id,
        senior_id: req.user.id,
        checkin_date: checkinDate,
        mood,
        medication_taken: medVal,
        needs_help: needsHelp ?? null,
        wants_family_call: wantsFamilyCall ?? null,
        feels_safe: feelsSafe ?? null,
        note: cleanNote,
        updated_at: now
      }
    });
  });
  app.get("/api/permissions", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const links = db.prepare(
      `SELECT cl.*, u.name as caregiver_name, u.email as caregiver_email, u.phone as caregiver_phone
         FROM caregiver_links cl
         LEFT JOIN users u ON u.id = cl.caregiver_id
         WHERE cl.senior_id = ?
         ORDER BY cl.created_at DESC`
    ).all(req.user.id);
    const requests = db.prepare(
      `SELECT pr.*, u.name as caregiver_name, u.email as caregiver_email
         FROM permission_requests pr
         JOIN users u ON u.id = pr.caregiver_id
         WHERE pr.senior_id = ?
         ORDER BY pr.created_at DESC`
    ).all(req.user.id);
    const history = db.prepare(
      `SELECT ph.*, u.name as actor_name
         FROM permission_history ph
         JOIN users u ON u.id = ph.actor_id
         WHERE ph.senior_id = ?
         ORDER BY ph.created_at DESC LIMIT 25`
    ).all(req.user.id);
    res.json({
      links: links.map((l) => ({
        ...l,
        permissions: parsePermissions(l.permissions_json, l.sharing_level)
      })),
      requests: requests.map((r) => ({
        ...r,
        requestedPermissions: JSON.parse(r.requested_permissions_json)
      })),
      history
    });
  });
  app.post("/api/permissions/invite", requireAuth, requireRole("senior"), (req, res) => {
    const { relationship, sharingLevel } = req.body;
    const level = sharingLevel && ["minimal", "balanced", "full"].includes(sharingLevel) ? sharingLevel : "balanced";
    const perms = PERMISSION_PRESETS[level];
    const db = getDb();
    const id = crypto4.randomUUID();
    const inviteCode = generateInviteCode();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO caregiver_links (
        id, senior_id, caregiver_id, invite_code, relationship,
        sharing_level, permissions_json, status, created_at, updated_at
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(id, req.user.id, inviteCode, relationship?.trim() || "Family Member", level, JSON.stringify(perms), now, now);
    recordPermissionHistory(req.user.id, req.user.id, id, "invite.created", {
      relationship: relationship?.trim() || "Family Member",
      sharingLevel: level
    });
    res.status(201).json({
      id,
      inviteCode,
      sharingLevel: level,
      permissions: perms
    });
  });
  app.put("/api/permissions/links/:linkId", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const link = db.prepare(`SELECT * FROM caregiver_links WHERE id = ? AND senior_id = ?`).get(req.params.linkId, req.user.id);
    if (!link) {
      res.status(404).json({ error: "Family member link not found." });
      return;
    }
    const { sharingLevel, permissions } = req.body;
    const nextLevel = sharingLevel && ["minimal", "balanced", "full"].includes(sharingLevel) ? sharingLevel : link.sharing_level;
    const basePerms = sharingLevel ? { ...PERMISSION_PRESETS[nextLevel] } : parsePermissions(link.permissions_json, nextLevel);
    const nextPerms = parsePermissions(
      JSON.stringify({
        ...basePerms,
        ...permissions && typeof permissions === "object" ? permissions : {}
      }),
      nextLevel
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `UPDATE caregiver_links SET sharing_level = ?, permissions_json = ?, updated_at = ? WHERE id = ?`
    ).run(nextLevel, JSON.stringify(nextPerms), now, link.id);
    recordPermissionHistory(req.user.id, req.user.id, link.id, "permissions.updated", {
      sharingLevel: nextLevel,
      permissions: nextPerms
    });
    if (link.caregiver_id) {
      createNotification(
        link.caregiver_id,
        "permission_update",
        "Sharing Preferences Updated",
        `${req.user.name} updated family sharing to ${nextLevel}.`
      );
    }
    res.json({ id: link.id, sharingLevel: nextLevel, permissions: nextPerms });
  });
  app.post("/api/permissions/links/:linkId/revoke", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const link = db.prepare(`SELECT * FROM caregiver_links WHERE id = ? AND senior_id = ?`).get(req.params.linkId, req.user.id);
    if (!link) {
      res.status(404).json({ error: "Family member link not found." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`UPDATE caregiver_links SET status = 'revoked', updated_at = ? WHERE id = ?`).run(now, link.id);
    recordPermissionHistory(req.user.id, req.user.id, link.id, "access.revoked", {});
    if (link.caregiver_id) {
      createNotification(
        link.caregiver_id,
        "permission_revoked",
        "Family Access Revoked",
        `${req.user.name} revoked sharing access.`
      );
    }
    res.json({ ok: true });
  });
  app.post("/api/permissions/requests/:requestId/respond", requireAuth, requireRole("senior"), (req, res) => {
    const { decision } = req.body;
    if (decision !== "approved" && decision !== "rejected") {
      res.status(400).json({ error: "Decision must be approved or rejected." });
      return;
    }
    const db = getDb();
    const pr = db.prepare(`SELECT * FROM permission_requests WHERE id = ? AND senior_id = ?`).get(req.params.requestId, req.user.id);
    if (!pr || pr.status !== "pending") {
      res.status(404).json({ error: "Pending sharing request not found." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare(`UPDATE permission_requests SET status = ?, reviewed_at = ? WHERE id = ?`).run(decision, now, pr.id);
      if (decision === "approved") {
        const nextPerms = parsePermissions(pr.requested_permissions_json, pr.requested_level);
        db.prepare(
          `UPDATE caregiver_links SET sharing_level = ?, permissions_json = ?, updated_at = ? WHERE id = ?`
        ).run(pr.requested_level, JSON.stringify(nextPerms), now, pr.link_id);
      }
      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }
    recordPermissionHistory(req.user.id, req.user.id, pr.link_id, `request.${decision}`, {
      requestedLevel: pr.requested_level
    });
    createNotification(
      pr.caregiver_id,
      "permission_request",
      `Sharing Request ${decision === "approved" ? "Approved" : "Declined"}`,
      `${req.user.name} ${decision} your request for ${pr.requested_level} sharing.`
    );
    res.json({ ok: true, status: decision });
  });
  app.get("/api/messaging/onboarding", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const msgConfig = getMessagingConfigStatus();
    let row = db.prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`).get(req.user.id);
    if (!row) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const id = crypto4.randomUUID();
      db.prepare(
        `INSERT INTO messaging_onboarding (id, senior_id, setup_mode, senior_phone, status, verified_at, updated_at)
         VALUES (?, ?, 'self', ?, 'not_started', NULL, ?)`
      ).run(id, req.user.id, req.user.phone, now);
      row = {
        id,
        senior_id: req.user.id,
        setup_mode: "self",
        senior_phone: req.user.phone,
        status: "not_started",
        verified_at: null,
        updated_at: now
      };
    }
    res.json({
      configured: msgConfig.configured,
      messagingNumber: msgConfig.number,
      configError: msgConfig.error,
      source: msgConfig.source,
      onboarding: row,
      cliAvailable: true
    });
  });
  app.put("/api/messaging/onboarding", requireAuth, requireRole("senior"), (req, res) => {
    const { setupMode, seniorPhone, status } = req.body;
    const allowedUserStatuses = [
      "not_started",
      "instructions_viewed",
      "ready_to_send",
      "user_confirmed"
    ];
    if (status === "backend_verified") {
      res.status(403).json({
        error: "Backend verification can only be completed when the messaging backend receives HELLO from the senior phone."
      });
      return;
    }
    const msgConfig = getMessagingConfigStatus();
    if (status === "user_confirmed" && !msgConfig.configured) {
      res.status(503).json({
        error: msgConfig.error || "BUDDY_MESSAGING_NUMBER is not configured yet.",
        code: "MESSAGING_NUMBER_MISSING"
      });
      return;
    }
    let normalizedPhone;
    if (seniorPhone !== void 0) {
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
    const existing = db.prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`).get(req.user.id);
    const nextMode = setupMode && ["self", "caregiver_assisted"].includes(setupMode) ? setupMode : existing?.setup_mode || "self";
    const nextPhone = normalizedPhone !== void 0 ? normalizedPhone : existing?.senior_phone || req.user.phone;
    const nextStatus = status && allowedUserStatuses.includes(status) ? status : existing?.status || "not_started";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (existing) {
      db.prepare(
        `UPDATE messaging_onboarding SET setup_mode = ?, senior_phone = ?, status = ?, updated_at = ? WHERE senior_id = ?`
      ).run(nextMode, nextPhone, nextStatus, now, req.user.id);
    } else {
      db.prepare(
        `INSERT INTO messaging_onboarding (id, senior_id, setup_mode, senior_phone, status, verified_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      ).run(crypto4.randomUUID(), req.user.id, nextMode, nextPhone, nextStatus, now);
    }
    recordAuditLog(req.user.id, "messaging.onboarding_update", "messaging_onboarding", {
      setupMode: nextMode,
      status: nextStatus
    });
    const updated = db.prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`).get(req.user.id);
    res.json({ onboarding: updated });
  });
  app.post("/api/messaging/onboarding/disconnect", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `UPDATE messaging_onboarding SET status = 'not_started', verified_at = NULL, updated_at = ? WHERE senior_id = ?`
    ).run(now, req.user.id);
    recordAuditLog(req.user.id, "messaging.disconnect", "messaging_onboarding", {});
    const updated = db.prepare(`SELECT * FROM messaging_onboarding WHERE senior_id = ?`).get(req.user.id);
    res.json({ onboarding: updated });
  });
  app.get("/api/reminders", requireAuth, (req, res) => {
    const db = getDb();
    if (req.user.role === "senior") {
      const reminders2 = db.prepare(
        `SELECT r.*, u.name as created_by_name FROM reminders r
           JOIN users u ON u.id = r.created_by
           WHERE r.senior_id = ? ORDER BY r.scheduled_for ASC`
      ).all(req.user.id);
      res.json({ reminders: reminders2 });
      return;
    }
    if (req.user.role === "caregiver") {
      const seniorId = req.query.seniorId;
      if (!seniorId) {
        const links = db.prepare(`SELECT * FROM caregiver_links WHERE caregiver_id = ? AND status = 'active'`).all(req.user.id);
        const permittedSeniorIds = links.filter((l) => parsePermissions(l.permissions_json, l.sharing_level).reminder_status).map((l) => l.senior_id);
        if (permittedSeniorIds.length === 0) {
          res.json({ reminders: [] });
          return;
        }
        const placeholders = permittedSeniorIds.map(() => "?").join(",");
        const reminders3 = db.prepare(
          `SELECT r.*, u.name as senior_name FROM reminders r
             JOIN users u ON u.id = r.senior_id
             WHERE r.senior_id IN (${placeholders}) ORDER BY r.scheduled_for ASC`
        ).all(...permittedSeniorIds);
        res.json({ reminders: reminders3 });
        return;
      }
      const active = getActiveCaregiverLink(req.user.id, seniorId);
      if (!active || !active.permissions.reminder_status) {
        res.status(403).json({ error: "Not authorized to view reminders for this senior." });
        return;
      }
      const reminders2 = db.prepare(`SELECT * FROM reminders WHERE senior_id = ? ORDER BY scheduled_for ASC`).all(seniorId);
      res.json({ reminders: reminders2 });
      return;
    }
    const reminders = db.prepare(`SELECT * FROM reminders ORDER BY scheduled_for DESC LIMIT 100`).all();
    res.json({ reminders });
  });
  app.post("/api/reminders", requireAuth, (req, res) => {
    const { seniorId, category, title, message, scheduledFor, voiceEnabled } = req.body;
    const targetSeniorId = req.user.role === "senior" ? req.user.id : seniorId;
    if (!targetSeniorId || !title?.trim() || !scheduledFor) {
      res.status(400).json({ error: "Reminder title, schedule time, and senior target are required." });
      return;
    }
    if (req.user.role === "caregiver") {
      const active = getActiveCaregiverLink(req.user.id, targetSeniorId);
      if (!active || !active.permissions.reminder_status) {
        res.status(403).json({ error: "You do not have reminder permission for this senior." });
        return;
      }
    } else if (req.user.role !== "senior") {
      res.status(403).json({ error: "Only seniors or authorized caregivers can create reminders." });
      return;
    }
    const db = getDb();
    const id = crypto4.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO reminders (
        id, senior_id, created_by, category, title, message,
        scheduled_for, voice_enabled, delivery_status, retry_count, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 0, NULL, ?, ?)`
    ).run(
      id,
      targetSeniorId,
      req.user.id,
      category?.trim() || "custom",
      title.trim(),
      message?.trim() || title.trim(),
      scheduledFor,
      voiceEnabled === false ? 0 : 1,
      now,
      now
    );
    createNotification(
      targetSeniorId,
      "reminder",
      `New Reminder: ${title.trim()}`,
      `Scheduled for ${new Date(scheduledFor).toLocaleString()}`
    );
    const reminder = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id);
    res.status(201).json({ reminder });
  });
  app.post("/api/reminders/:id/acknowledge", requireAuth, requireRole("senior"), (req, res) => {
    const db = getDb();
    const reminder = db.prepare(`SELECT * FROM reminders WHERE id = ? AND senior_id = ?`).get(req.params.id, req.user.id);
    if (!reminder) {
      res.status(404).json({ error: "Reminder not found." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`UPDATE reminders SET delivery_status = 'acknowledged', updated_at = ? WHERE id = ?`).run(
      now,
      req.params.id
    );
    res.json({ ok: true, delivery_status: "acknowledged" });
  });
  app.post("/api/reminders/:id/deliver", requireAuth, (req, res) => {
    const { simulateFailure } = req.body;
    const db = getDb();
    const reminder = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(req.params.id);
    if (!reminder) {
      res.status(404).json({ error: "Reminder not found." });
      return;
    }
    if (req.user.role === "caregiver") {
      const active = getActiveCaregiverLink(req.user.id, reminder.senior_id);
      if (!active || !active.permissions.reminder_status) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else if (req.user.role === "senior" && reminder.senior_id !== req.user.id) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (simulateFailure) {
      db.prepare(
        `UPDATE reminders SET delivery_status = 'failed', retry_count = retry_count + 1, last_error = ?, updated_at = ? WHERE id = ?`
      ).run("Delivery channel unavailable. Please retry.", now, reminder.id);
      const updated2 = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(reminder.id);
      res.json({ reminder: updated2 });
      return;
    }
    db.prepare(
      `UPDATE reminders SET delivery_status = 'sent', last_error = NULL, updated_at = ? WHERE id = ?`
    ).run(now, reminder.id);
    createNotification(reminder.senior_id, "reminder", `Reminder: ${reminder.title}`, reminder.message);
    const updated = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(reminder.id);
    res.json({ reminder: updated });
  });
  app.post("/api/caregiver/link", requireAuth, requireRole("caregiver"), (req, res) => {
    const { inviteCode } = req.body;
    const cleanCode = inviteCode?.trim().toUpperCase();
    if (!cleanCode) {
      res.status(400).json({ error: "Please enter the family invite code." });
      return;
    }
    const db = getDb();
    const link = db.prepare(`SELECT * FROM caregiver_links WHERE invite_code = ? AND status = 'pending'`).get(cleanCode);
    if (!link) {
      res.status(404).json({ error: "Invite code is invalid or has already been used." });
      return;
    }
    const existingActive = db.prepare(`SELECT id FROM caregiver_links WHERE senior_id = ? AND caregiver_id = ? AND status = 'active'`).get(link.senior_id, req.user.id);
    if (existingActive) {
      res.status(409).json({ error: "You are already linked to this senior." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `UPDATE caregiver_links SET caregiver_id = ?, status = 'active', updated_at = ? WHERE id = ?`
    ).run(req.user.id, now, link.id);
    recordPermissionHistory(link.senior_id, req.user.id, link.id, "caregiver.linked", {
      caregiverEmail: req.user.email
    });
    createNotification(
      link.senior_id,
      "family_linked",
      "Family Member Linked",
      `${req.user.name} connected using your invite code.`
    );
    res.json({ ok: true, linkId: link.id, seniorId: link.senior_id });
  });
  app.get("/api/caregiver/dashboard", requireAuth, requireRole("caregiver"), (req, res) => {
    const db = getDb();
    const links = db.prepare(
      `SELECT cl.*, u.name as senior_name, u.phone as senior_phone, u.language as senior_language
         FROM caregiver_links cl
         JOIN users u ON u.id = cl.senior_id
         WHERE cl.caregiver_id = ? AND cl.status = 'active'
         ORDER BY cl.updated_at DESC`
    ).all(req.user.id);
    const seniors = links.map((link) => {
      const perms = parsePermissions(link.permissions_json, link.sharing_level);
      let latestCheckIn = null;
      let wellnessSummary = null;
      if (perms.checkin_status || perms.checkin_responses || perms.wellness_summaries) {
        const recentCheckins = db.prepare(`SELECT * FROM check_ins WHERE senior_id = ? ORDER BY checkin_date DESC LIMIT 14`).all(link.senior_id);
        if (recentCheckins.length > 0 && (perms.checkin_status || perms.checkin_responses)) {
          const latest = recentCheckins[0];
          latestCheckIn = {
            checkin_date: latest.checkin_date,
            updated_at: latest.updated_at,
            completed: true,
            ...perms.checkin_responses ? {
              mood: latest.mood,
              medication_taken: latest.medication_taken,
              needs_help: latest.needs_help === null ? null : Boolean(latest.needs_help),
              wants_family_call: latest.wants_family_call === null ? null : Boolean(latest.wants_family_call),
              feels_safe: latest.feels_safe === null ? null : Boolean(latest.feels_safe),
              note: latest.note
            } : {}
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
            completionRatePercent: Math.round(last7.length / 7 * 100),
            moodCounts,
            history: perms.checkin_responses ? last7.map((c) => ({
              checkin_date: c.checkin_date,
              mood: c.mood,
              medication_taken: c.medication_taken
            })) : []
          };
        }
      }
      const allAlerts = db.prepare(`SELECT * FROM alerts WHERE senior_id = ? ORDER BY created_at DESC LIMIT 30`).all(link.senior_id);
      const alerts = allAlerts.filter((a) => {
        if (a.type === "scam_alert") return perms.scam_alerts;
        return perms.safety_alerts;
      });
      const reminders = perms.reminder_status ? db.prepare(`SELECT * FROM reminders WHERE senior_id = ? ORDER BY scheduled_for ASC`).all(link.senior_id) : [];
      let activitySummary = null;
      if (perms.activity_summaries) {
        const lessonsDone = db.prepare(`SELECT COUNT(*) as cnt FROM lesson_progress WHERE user_id = ? AND is_completed = 1`).get(link.senior_id).cnt;
        const scamChecks = db.prepare(`SELECT COUNT(*) as cnt FROM scam_assessments WHERE user_id = ?`).get(link.senior_id).cnt;
        activitySummary = { lessonsCompleted: lessonsDone, totalLessons: LESSONS_CATALOG.length, scamChecksCount: scamChecks };
      }
      let aiSummary = null;
      if (perms.ai_summaries) {
        const convCount = db.prepare(`SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ?`).get(link.senior_id).cnt;
        aiSummary = {
          conversationCount: convCount,
          note: "Private chat messages remain confidential to the senior."
        };
      }
      const pendingRequests = db.prepare(`SELECT * FROM permission_requests WHERE link_id = ? ORDER BY created_at DESC LIMIT 5`).all(link.id);
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
        pendingRequests
      };
    });
    res.json({ seniors });
  });
  app.post("/api/caregiver/alerts/:alertId/status", requireAuth, requireRole("caregiver"), (req, res) => {
    const { status } = req.body;
    if (status !== "reviewed" && status !== "resolved") {
      res.status(400).json({ error: "Status must be reviewed or resolved." });
      return;
    }
    const db = getDb();
    const alert = db.prepare(`SELECT * FROM alerts WHERE id = ?`).get(req.params.alertId);
    if (!alert) {
      res.status(404).json({ error: "Alert not found." });
      return;
    }
    const active = getActiveCaregiverLink(req.user.id, alert.senior_id);
    const allowed = active && (alert.type === "scam_alert" && active.permissions.scam_alerts || alert.type !== "scam_alert" && active.permissions.safety_alerts);
    if (!allowed) {
      res.status(403).json({ error: "Not authorized to manage this alert." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`UPDATE alerts SET status = ?, is_read = 1, reviewed_by = ?, updated_at = ? WHERE id = ?`).run(
      status,
      req.user.id,
      now,
      alert.id
    );
    res.json({ ok: true, status });
  });
  app.post("/api/caregiver/permission-requests", requireAuth, requireRole("caregiver"), (req, res) => {
    const { linkId, requestedLevel, requestedPermissions, reason } = req.body;
    if (!linkId || !requestedLevel || !["minimal", "balanced", "full"].includes(requestedLevel) || !reason?.trim()) {
      res.status(400).json({ error: "Link ID, requested sharing level, and reason are required." });
      return;
    }
    const db = getDb();
    const link = db.prepare(`SELECT * FROM caregiver_links WHERE id = ? AND caregiver_id = ? AND status = 'active'`).get(linkId, req.user.id);
    if (!link) {
      res.status(403).json({ error: "Active link to this senior not found." });
      return;
    }
    const mergedPerms = parsePermissions(
      JSON.stringify({
        ...PERMISSION_PRESETS[requestedLevel],
        ...requestedPermissions && typeof requestedPermissions === "object" ? requestedPermissions : {}
      }),
      requestedLevel
    );
    const id = crypto4.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO permission_requests (
        id, link_id, senior_id, caregiver_id, requested_level,
        requested_permissions_json, reason, status, reviewed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`
    ).run(id, link.id, link.senior_id, req.user.id, requestedLevel, JSON.stringify(mergedPerms), reason.trim(), now);
    createNotification(
      link.senior_id,
      "permission_request",
      "Family Sharing Request",
      `${req.user.name} requested ${requestedLevel} sharing access: "${reason.trim()}"`
    );
    res.status(201).json({ id, status: "pending" });
  });
  app.get("/api/notifications", requireAuth, (req, res) => {
    const db = getDb();
    const notifications = db.prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`).all(req.user.id);
    res.json({
      notifications: notifications.map((n) => ({ ...n, is_read: Boolean(n.is_read) })),
      unreadCount: notifications.filter((n) => !n.is_read).length
    });
  });
  app.post("/api/notifications/:id/read", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`).run(
      req.params.id,
      req.user.id
    );
    res.json({ ok: true });
  });
  app.post("/api/notifications/read-all", requireAuth, (req, res) => {
    const db = getDb();
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.user.id);
    res.json({ ok: true });
  });
  app.post("/api/feedback", requireAuth, (req, res) => {
    const { category, rating, message } = req.body;
    if (!message?.trim() || !rating || rating < 1 || rating > 5) {
      res.status(400).json({ error: "Please provide a rating (1-5) and feedback message." });
      return;
    }
    const db = getDb();
    const id = crypto4.randomUUID();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(
      `INSERT INTO feedback (id, user_id, category, rating, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.user.id, category?.trim() || "general", Math.round(rating), message.trim().slice(0, 1e3), now);
    res.status(201).json({ id, created_at: now });
  });
  app.get("/api/feedback", requireAuth, (req, res) => {
    const db = getDb();
    if (req.user.role === "admin") {
      const items2 = db.prepare(
        `SELECT f.*, u.name as user_name, u.role as user_role FROM feedback f
           JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC LIMIT 50`
      ).all();
      res.json({ feedback: items2 });
      return;
    }
    const items = db.prepare(`SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(req.user.id);
    res.json({ feedback: items });
  });
  app.get("/api/admin/overview", requireAuth, requireRole("admin"), (_req, res) => {
    const db = getDb();
    const count = (sql) => db.prepare(sql).get().cnt;
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
        feedbackCount: count(`SELECT COUNT(*) as cnt FROM feedback`)
      },
      ai: getAiStatus(),
      messaging,
      database: getDatabaseStatus()
    });
  });
  app.get("/api/admin/users", requireAuth, requireRole("admin"), (_req, res) => {
    const db = getDb();
    const users = db.prepare(
      `SELECT id, email, name, phone, role, language, is_active, created_at FROM users ORDER BY created_at DESC`
    ).all();
    res.json({ users: users.map((u) => ({ ...u, is_active: Boolean(u.is_active) })) });
  });
  app.patch("/api/admin/users/:id", requireAuth, requireRole("admin"), (req, res) => {
    const targetId = req.params.id;
    const { isActive, role } = req.body;
    if (targetId === req.user.id && isActive === false) {
      res.status(400).json({ error: "You cannot deactivate your own active administrator account." });
      return;
    }
    const db = getDb();
    const existing = db.prepare(`SELECT id, role, is_active FROM users WHERE id = ?`).get(targetId);
    if (!existing) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const nextActive = typeof isActive === "boolean" ? isActive ? 1 : 0 : existing.is_active;
    const nextRole = role && ["senior", "caregiver", "admin"].includes(role) ? role : existing.role;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`UPDATE users SET is_active = ?, role = ?, updated_at = ? WHERE id = ?`).run(
      nextActive,
      nextRole,
      now,
      targetId
    );
    if (!nextActive) {
      db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(targetId);
    }
    recordAuditLog(req.user.id, "admin.user_update", "users", { targetId, isActive: Boolean(nextActive), role: nextRole });
    res.json({ ok: true, id: targetId, is_active: Boolean(nextActive), role: nextRole });
  });
  app.put("/api/admin/messaging-config", requireAuth, requireRole("admin"), (req, res) => {
    const { messagingNumber } = req.body;
    const clean = messagingNumber?.trim() || "";
    let normalizedValue = "";
    if (clean) {
      const phoneCheck = normalizePhoneWithCountryCode(clean);
      if (!phoneCheck.valid) {
        res.status(400).json({ error: phoneCheck.error });
        return;
      }
      normalizedValue = phoneCheck.e164;
    }
    const db = getDb();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (normalizedValue) {
      db.prepare(
        `INSERT INTO system_config (key, value, updated_at) VALUES ('buddy_messaging_number', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(normalizedValue, now);
    } else {
      db.prepare(`DELETE FROM system_config WHERE key = 'buddy_messaging_number'`).run();
    }
    recordAuditLog(req.user.id, "admin.messaging_config", "system_config", { configured: Boolean(normalizedValue) });
    const current = getMessagingConfigStatus();
    res.json({
      ...current,
      envOverride: Boolean(getRawEnvMessagingNumber())
    });
  });
  app.get("/api/admin/audit-logs", requireAuth, requireRole("admin"), (_req, res) => {
    const db = getDb();
    const logs = db.prepare(
      `SELECT a.*, u.email as actor_email FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 40`
    ).all();
    res.json({ logs });
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({
      success: false,
      code: "NOT_FOUND",
      error: "API endpoint not found."
    });
  });
  app.use((err, req, res, _next) => {
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({
        success: false,
        code: "INVALID_JSON",
        error: "Invalid JSON request body."
      });
      return;
    }
    if (err instanceof DatabaseConfigError) {
      console.error("[Buddy Elder AI Database Config Error]", {
        endpoint: req.path,
        code: err.code,
        message: err.message
      });
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          code: err.code,
          error: err.message
        });
      }
      return;
    }
    const message = err instanceof Error ? err.message : "Internal server error.";
    console.error("[Buddy Elder AI API Error]", {
      endpoint: req.path,
      method: req.method,
      message
    });
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        code: "SERVER_ERROR",
        error: process.env.NODE_ENV === "production" ? "Unexpected server error." : message
      });
    }
  });
  return app;
}

// server/vercel-handler.ts
var cachedApp = null;
function firstHeaderValue(value) {
  if (typeof value === "string") {
    const trimmed = value.split(",")[0]?.trim();
    return trimmed || null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const trimmed = String(value[0]).split(",")[0]?.trim();
    return trimmed || null;
  }
  return null;
}
function normalizeVercelRequestUrl(rawUrl, headers = {}) {
  const input = rawUrl || "/";
  let parsed;
  try {
    parsed = new URL(input, "http://localhost");
  } catch {
    return input;
  }
  if (parsed.searchParams.has("__buddy_path")) {
    const rawSub = parsed.searchParams.get("__buddy_path") ?? "";
    parsed.searchParams.delete("__buddy_path");
    const cleanSub = rawSub.replace(/^\/+/, "");
    const targetPath = cleanSub ? `/api/${cleanSub}` : "/api";
    const qs = parsed.searchParams.toString();
    return qs ? `${targetPath}?${qs}` : targetPath;
  }
  if (parsed.pathname === "/api/index" || parsed.pathname === "/api/index.mjs" || parsed.pathname === "/api/index.ts") {
    const forwarded = firstHeaderValue(headers["x-vercel-forwarded-path"]) || firstHeaderValue(headers["x-forwarded-uri"]) || firstHeaderValue(headers["x-rewrite-url"]);
    let targetPath = "/api";
    if (forwarded && forwarded.startsWith("/api")) {
      const forwardedPath = forwarded.split("?")[0];
      if (forwardedPath && forwardedPath !== "/api/index" && forwardedPath !== "/api/index.mjs" && forwardedPath !== "/api/index.ts") {
        targetPath = forwardedPath;
      }
    }
    const qs = parsed.searchParams.toString();
    return qs ? `${targetPath}?${qs}` : targetPath;
  }
  return input;
}
async function handler(req, res) {
  try {
    req.url = normalizeVercelRequestUrl(req.url, req.headers);
    if (!cachedApp) {
      cachedApp = createApp();
    }
    const app = cachedApp;
    await new Promise((resolve) => {
      if (res.writableEnded) {
        resolve();
        return;
      }
      const done = () => {
        res.off("finish", done);
        res.off("close", done);
        resolve();
      };
      res.on("finish", done);
      res.on("close", done);
      app(req, res);
    });
  } catch (err) {
    const isDbConfigErr = err instanceof DatabaseConfigError;
    const message = err instanceof Error ? err.message : "Server initialization failed.";
    console.error("[Buddy Elder AI Vercel Handler Error]", {
      code: isDbConfigErr ? err.code : "SERVER_INIT_ERROR",
      message
    });
    if (!res.headersSent) {
      res.statusCode = isDbConfigErr ? 503 : 500;
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          success: false,
          code: isDbConfigErr ? err.code : "SERVER_INIT_ERROR",
          error: {
            code: isDbConfigErr ? err.code : "SERVER_INIT_ERROR",
            message: isDbConfigErr || process.env.NODE_ENV !== "production" ? message : "Backend server initialization failed. Check server runtime and environment variables."
          }
        })
      );
    }
  }
}
export {
  handler as default,
  normalizeVercelRequestUrl
};
