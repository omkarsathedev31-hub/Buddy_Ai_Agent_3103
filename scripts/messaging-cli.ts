import '../server/env.ts';
import { getDb } from '../server/db.ts';
import { getRawEnvMessagingNumber, normalizePhoneWithCountryCode } from '../server/env.ts';
import { recordAuditLog } from '../server/permissions.ts';

function printUsage() {
  console.log(`
Buddy Elder AI — Messaging Onboarding CLI

Commands:
  status                          Show configured messaging number and onboarding records
  verify-hello <senior_phone>     Verify incoming HELLO from a senior's own phone number
  set-number <phone_number>       Set buddy_messaging_number in local database config (E.164 with + country code)
  clear-number                    Clear buddy_messaging_number from local database config
`);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const db = getDb();

  if (!cmd || cmd === 'help' || cmd === '--help') {
    printUsage();
    return;
  }

  if (cmd === 'status') {
    const envRaw = getRawEnvMessagingNumber();
    const dbNumRow = db
      .prepare(`SELECT value FROM system_config WHERE key = 'buddy_messaging_number'`)
      .get() as { value: string } | undefined;
    const raw = envRaw || dbNumRow?.value || null;
    if (!raw) {
      console.log('Configured Messaging Number: NOT CONFIGURED');
    } else {
      const check = normalizePhoneWithCountryCode(raw);
      console.log(
        'Configured Messaging Number:',
        check.valid ? `${check.e164} (${envRaw ? 'env' : 'database'})` : `INVALID (${check.error})`
      );
    }
    const records = db
      .prepare(
        `SELECT m.*, u.name, u.email FROM messaging_onboarding m
         JOIN users u ON u.id = m.senior_id ORDER BY m.updated_at DESC`
      )
      .all();
    console.log('Onboarding Records:', JSON.stringify(records, null, 2));
    return;
  }

  if (cmd === 'set-number') {
    const num = args[1]?.trim() || '';
    const check = normalizePhoneWithCountryCode(num);
    if (!check.valid) {
      console.error(`Error: ${check.error}`);
      process.exit(1);
    }
    db.prepare(
      `INSERT INTO system_config (key, value, updated_at) VALUES ('buddy_messaging_number', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(check.e164, new Date().toISOString());
    console.log('Saved messaging number:', check.e164);
    return;
  }

  if (cmd === 'clear-number') {
    db.prepare(`DELETE FROM system_config WHERE key = 'buddy_messaging_number'`).run();
    console.log('Cleared configured messaging number.');
    return;
  }

  if (cmd === 'verify-hello') {
    const phoneArg = args[1]?.trim() || '';
    const check = normalizePhoneWithCountryCode(phoneArg);
    if (!check.valid) {
      console.error(`Error: ${check.error}`);
      process.exit(1);
    }
    const rows = db
      .prepare(`SELECT * FROM messaging_onboarding WHERE senior_phone IS NOT NULL`)
      .all() as Array<{ id: string; senior_id: string; senior_phone: string }>;

    const matched = rows.find((r) => {
      const normalizedRow = normalizePhoneWithCountryCode(r.senior_phone);
      return normalizedRow.valid ? normalizedRow.e164 === check.e164 : r.senior_phone.trim() === check.e164;
    });

    if (!matched) {
      console.error(
        `No onboarding record found matching senior phone "${check.e164}". Ensure senior entered their own phone number with country code first.`
      );
      process.exit(1);
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE messaging_onboarding SET senior_phone = ?, status = 'backend_verified', verified_at = ?, updated_at = ? WHERE id = ?`
    ).run(check.e164, now, now, matched.id);
    recordAuditLog(matched.senior_id, 'messaging.cli_verified', 'messaging_onboarding', { phone: check.e164 });
    console.log(`Verified HELLO initiation from senior phone ${check.e164} at ${now}.`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printUsage();
  process.exit(1);
}

main();
