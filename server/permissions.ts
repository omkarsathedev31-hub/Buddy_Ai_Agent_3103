import crypto from 'node:crypto';
import {
  PERMISSION_PRESETS,
  type GranularPermissions,
  type SharingLevel,
} from '../shared/types.ts';
import { getDb } from './db.ts';

export interface CaregiverLinkRow {
  id: string;
  senior_id: string;
  caregiver_id: string | null;
  invite_code: string;
  relationship: string;
  sharing_level: SharingLevel;
  permissions_json: string;
  status: 'pending' | 'active' | 'revoked';
  created_at: string;
  updated_at: string;
}

export function parsePermissions(jsonStr: string, fallbackLevel: SharingLevel = 'balanced'): GranularPermissions {
  const base = { ...PERMISSION_PRESETS[fallbackLevel] };
  try {
    const parsed = JSON.parse(jsonStr) as Partial<GranularPermissions>;
    return {
      checkin_status: typeof parsed.checkin_status === 'boolean' ? parsed.checkin_status : base.checkin_status,
      checkin_responses:
        typeof parsed.checkin_responses === 'boolean' ? parsed.checkin_responses : base.checkin_responses,
      wellness_summaries:
        typeof parsed.wellness_summaries === 'boolean' ? parsed.wellness_summaries : base.wellness_summaries,
      safety_alerts: typeof parsed.safety_alerts === 'boolean' ? parsed.safety_alerts : base.safety_alerts,
      scam_alerts: typeof parsed.scam_alerts === 'boolean' ? parsed.scam_alerts : base.scam_alerts,
      reminder_status: typeof parsed.reminder_status === 'boolean' ? parsed.reminder_status : base.reminder_status,
      activity_summaries:
        typeof parsed.activity_summaries === 'boolean' ? parsed.activity_summaries : base.activity_summaries,
      ai_summaries: typeof parsed.ai_summaries === 'boolean' ? parsed.ai_summaries : base.ai_summaries,
      contact_info: typeof parsed.contact_info === 'boolean' ? parsed.contact_info : base.contact_info,
    };
  } catch {
    return base;
  }
}

export function getActiveCaregiverLink(caregiverId: string, seniorId: string): {
  link: CaregiverLinkRow;
  permissions: GranularPermissions;
} | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM caregiver_links WHERE caregiver_id = ? AND senior_id = ? AND status = 'active' LIMIT 1`
    )
    .get(caregiverId, seniorId) as CaregiverLinkRow | undefined;

  if (!row) return null;
  return {
    link: row,
    permissions: parsePermissions(row.permissions_json, row.sharing_level),
  };
}

export function recordPermissionHistory(
  seniorId: string,
  actorId: string,
  linkId: string | null,
  action: string,
  details: Record<string, unknown>
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO permission_history (id, senior_id, actor_id, link_id, action, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), seniorId, actorId, linkId, action, JSON.stringify(details), new Date().toISOString());
}

export function recordAuditLog(
  userId: string | null,
  action: string,
  resource: string,
  details: Record<string, unknown>
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, resource, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), userId, action, resource, JSON.stringify(details), new Date().toISOString());
}

export function createNotification(userId: string, type: string, title: string, body: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, body, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(crypto.randomUUID(), userId, type, title, body, new Date().toISOString());
}

export function createAlertIfNotDuplicate(params: {
  seniorId: string;
  type: string;
  severity: 'critical' | 'warning' | 'informational';
  title: string;
  description: string;
  explanation: string;
  recommendedAction: string;
  dedupeKey?: string;
}): { id: string; created: boolean } {
  const db = getDb();
  if (params.dedupeKey) {
    const existing = db
      .prepare(
        `SELECT id FROM alerts WHERE senior_id = ? AND dedupe_key = ? AND status != 'resolved' LIMIT 1`
      )
      .get(params.seniorId, params.dedupeKey) as { id: string } | undefined;
    if (existing) {
      return { id: existing.id, created: false };
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
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

  // Notify authorized caregivers according to their permissions
  const links = db
    .prepare(`SELECT caregiver_id, sharing_level, permissions_json FROM caregiver_links WHERE senior_id = ? AND status = 'active' AND caregiver_id IS NOT NULL`)
    .all(params.seniorId) as Array<{
    caregiver_id: string;
    sharing_level: SharingLevel;
    permissions_json: string;
  }>;

  for (const link of links) {
    const perms = parsePermissions(link.permissions_json, link.sharing_level);
    const allowed =
      (params.type === 'scam_alert' && perms.scam_alerts) ||
      (params.type !== 'scam_alert' && perms.safety_alerts);
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
