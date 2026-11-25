import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let dbInstance: DatabaseSync | null = null;
let warnedEphemeral = false;

export class DatabaseConfigError extends Error {
  code = 'DATABASE_NOT_PERSISTENT';
  statusCode = 503;

  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

export function isVercelRuntime(): boolean {
  return (
    process.env.VERCEL === '1' ||
    process.env.VERCEL === 'true' ||
    Boolean(process.env.VERCEL_ENV) ||
    Boolean(process.env.NOW_REGION)
  );
}

export function isRailwayRuntime(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_VOLUME_MOUNT_PATH ||
      process.env.RAILWAY_PUBLIC_DOMAIN
  );
}

export function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === 'production' || isVercelRuntime() || isRailwayRuntime();
}

function isInsideTmpDir(resolvedPath: string): boolean {
  const tmpRoot = path.resolve(os.tmpdir());
  return resolvedPath === tmpRoot || resolvedPath.startsWith(tmpRoot + path.sep);
}

export function validateDatabaseConfiguration(): void {
  const allowEphemeral = process.env.BUDDY_ALLOW_EPHEMERAL_DB === 'true';
  if (allowEphemeral) {
    return;
  }

  const rawCustom = process.env.BUDDY_DB_PATH?.trim();
  const railwayVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();

  if (isVercelRuntime()) {
    const resolved = rawCustom && rawCustom !== ':memory:' ? path.resolve(rawCustom) : null;
    if (!resolved || isInsideTmpDir(resolved)) {
      throw new DatabaseConfigError(
        'Persistent database configuration required: Vercel serverless functions use ephemeral /tmp storage that is wiped on cold starts and not shared across instances, causing "Session not found or expired" errors. Deploy Buddy Elder AI on a persistent Node.js server with a mounted volume (such as Railway with a /data volume and BUDDY_DB_PATH=/data/buddy-elder.db).'
      );
    }
  }

  if (isRailwayRuntime()) {
    if ((!rawCustom && !railwayVolumeMount) || rawCustom === ':memory:') {
      throw new DatabaseConfigError(
        'Persistent database configuration required: set BUDDY_DB_PATH=/data/buddy-elder.db and attach a persistent Railway volume mounted at /data so accounts and login sessions survive restarts and redeploys.'
      );
    }
  }

  if (isProductionDeployment() && rawCustom === ':memory:') {
    throw new DatabaseConfigError(
      'In-memory SQLite (:memory:) cannot be used in production. Set BUDDY_DB_PATH to a persistent disk path (for example /data/buddy-elder.db).'
    );
  }
}

export function getDbPath(): string {
  validateDatabaseConfiguration();
  const rawCustom = process.env.BUDDY_DB_PATH?.trim();
  if (rawCustom) {
    return rawCustom === ':memory:' ? rawCustom : path.resolve(rawCustom);
  }
  const railwayVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (isRailwayRuntime() && railwayVolumeMount) {
    return path.resolve(railwayVolumeMount, 'buddy-elder.db');
  }
  if (isVercelRuntime()) {
    return path.join(os.tmpdir(), 'buddy-elder.db');
  }
  return path.resolve(process.cwd(), 'data', 'buddy-elder.db');
}

export function getDatabaseStatus(): {
  engine: 'sqlite';
  durable: boolean;
  mode: 'memory' | 'custom_path' | 'local_disk' | 'vercel_tmp_ephemeral' | 'misconfigured';
  warning: string | null;
} {
  try {
    validateDatabaseConfiguration();
  } catch (err) {
    return {
      engine: 'sqlite',
      durable: false,
      mode: 'misconfigured',
      warning: err instanceof Error ? err.message : 'Persistent database configuration is missing.',
    };
  }

  const rawCustom = process.env.BUDDY_DB_PATH?.trim();
  const railwayVolumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (rawCustom === ':memory:') {
    return {
      engine: 'sqlite',
      durable: false,
      mode: 'memory',
      warning: 'In-memory SQLite database is active; data clears when the process exits.',
    };
  }
  if (rawCustom || (isRailwayRuntime() && railwayVolumeMount)) {
    return { engine: 'sqlite', durable: true, mode: 'custom_path', warning: null };
  }
  if (isVercelRuntime()) {
    return {
      engine: 'sqlite',
      durable: false,
      mode: 'vercel_tmp_ephemeral',
      warning:
        'Running SQLite in Vercel ephemeral /tmp storage because BUDDY_ALLOW_EPHEMERAL_DB=true is set. Data resets on cold starts and is not shared across serverless instances.',
    };
  }
  return { engine: 'sqlite', durable: true, mode: 'local_disk', warning: null };
}

export function getDb(): DatabaseSync {
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
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    if (dbPath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
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

export function closeDb(): void {
  if (!dbInstance) {
    return;
  }
  try {
    dbInstance.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // Ignore checkpoint errors for in-memory or already closing DB
  }
  try {
    dbInstance.close();
  } finally {
    dbInstance = null;
  }
}

export function resetDbForTests(): void {
  closeDb();
  warnedEphemeral = false;
}

function runMigrations(db: DatabaseSync): void {
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

  // Idempotent additive migrations for pre-existing persistent SQLite databases
  const convCols = db.prepare(`PRAGMA table_info(conversations)`).all() as Array<{ name: string }>;
  const convColNames = new Set(convCols.map((c) => c.name));
  if (!convColNames.has('last_status')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN last_status TEXT NOT NULL DEFAULT 'idle';`);
  }
  if (!convColNames.has('last_error_code')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN last_error_code TEXT;`);
  }
  if (!convColNames.has('last_error_message')) {
    db.exec(`ALTER TABLE conversations ADD COLUMN last_error_message TEXT;`);
  }
}
