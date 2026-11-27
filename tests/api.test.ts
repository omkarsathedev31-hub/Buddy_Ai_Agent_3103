import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-elder-test-'));
const dbFile = path.join(tmpDir, 'test.db');
process.env.BUDDY_DB_PATH = dbFile;
delete process.env.GOOGLE_GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.BUDDY_MESSAGING_NUMBER;
delete process.env.ADMIN_PASSCODE;

const { createApp } = await import('../server/app.ts');
const { resetDbForTests } = await import('../server/db.ts');

let server: http.Server;
let baseUrl: string;

test.before(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(
  urlPath: string,
  opts: { method?: string; body?: unknown; cookie?: string } = {}
): Promise<{ status: number; data: Record<string, unknown>; setCookie?: string }> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'BuddyElderAI',
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.cookie) headers['Cookie'] = opts.cookie;

  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const rawCookie = res.headers.get('set-cookie');
  const cookiePair = rawCookie ? rawCookie.split(';')[0] : undefined;
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data, setCookie: cookiePair };
}

test('End-to-end auth, RBAC, permissions, safety, lessons, reminders, messaging & admin flows', async () => {
  // 1. Health & unauthenticated guard
  const health = await api('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  const unauthCheckins = await api('/api/checkins');
  assert.equal(unauthCheckins.status, 401);

  // 2. Register Senior & verify session persistence via cookie AND Bearer token (iframe fallback)
  const seniorReg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Asha Deshmukh',
      email: 'asha@example.com',
      phone: '+919800000001',
      password: 'password123',
      role: 'senior',
      language: 'en',
    },
  });
  assert.equal(seniorReg.status, 201);
  assert.ok(seniorReg.setCookie);
  assert.ok(typeof seniorReg.data.token === 'string' && seniorReg.data.token.length > 10);
  const seniorCookie = seniorReg.setCookie!;
  const seniorBearer = seniorReg.data.token as string;

  // Verify PUT /api/settings works with Authorization Bearer token alone (no cookie)
  const bearerSettingsRes = await fetch(`${baseUrl}/api/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BuddyElderAI',
      'Authorization': `Bearer ${seniorBearer}`,
    },
    body: JSON.stringify({ voice_enabled: true, voice_speed: 'normal', onboarding_completed: true }),
  });
  assert.equal(bearerSettingsRes.status, 200);

  // Reject unsafe/malformed phone numbers on register & settings; normalize formatted phone numbers
  const unsafePhoneReg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Bad Phone User',
      email: 'badphone@example.com',
      phone: 'javascript:alert(1)',
      password: 'password123',
      role: 'senior',
    },
  });
  assert.equal(unsafePhoneReg.status, 400);

  const missingCodePhoneSettings = await api('/api/settings', {
    method: 'PUT',
    cookie: seniorCookie,
    body: { phone: '9800000001' },
  });
  assert.equal(missingCodePhoneSettings.status, 400);

  const normalizedPhoneSettings = await api('/api/settings', {
    method: 'PUT',
    cookie: seniorCookie,
    body: { phone: '+91 98000-00001' },
  });
  assert.equal(normalizedPhoneSettings.status, 200);
  assert.equal((normalizedPhoneSettings.data.user as Record<string, unknown>).phone, '+919800000001');

  const sessionCheck = await api('/api/auth/session', { cookie: seniorCookie });
  assert.equal(sessionCheck.status, 200);
  assert.equal(sessionCheck.data.authenticated, true);

  // Invalid login rejected
  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'asha@example.com', password: 'wrong' },
  });
  assert.equal(badLogin.status, 401);

  // Senior blocked from Admin routes
  const seniorAdminTry = await api('/api/admin/overview', { cookie: seniorCookie });
  assert.equal(seniorAdminTry.status, 403);

  // 3. Register Caregiver
  const cgReg = await api('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Rohan Deshmukh',
      email: 'rohan@example.com',
      password: 'password123',
      role: 'caregiver',
    },
  });
  assert.equal(cgReg.status, 201);
  const cgCookie = cgReg.setCookie!;

  // 4. Missing ADMIN_PASSCODE returns explicit 503 error before claim/env config
  const missingAdminLogin = await api('/api/auth/admin/login', {
    method: 'POST',
    body: { passcode: 'Anything123' },
  });
  assert.equal(missingAdminLogin.status, 503);
  assert.equal(missingAdminLogin.data.code, 'ADMIN_PASSCODE_MISSING');

  // First-run Admin Claim + double-claim lock + non-admin email guard + messaging config
  const adminClaim = await api('/api/auth/admin/claim', {
    method: 'POST',
    body: { email: 'admin@example.com', name: 'Chief Admin', passcode: 'AdminPass#2026' },
  });
  assert.equal(adminClaim.status, 201);
  const adminCookie = adminClaim.setCookie!;

  const secondClaim = await api('/api/auth/admin/claim', {
    method: 'POST',
    body: { email: 'hacker@example.com', passcode: 'HackerPass123' },
  });
  assert.equal(secondClaim.status, 403);

  const nonAdminEmailAdminLogin = await api('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'asha@example.com', passcode: 'AdminPass#2026' },
  });
  assert.equal(nonAdminEmailAdminLogin.status, 403);

  const wrongAdminPassLogin = await api('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'admin@example.com', passcode: 'WrongPass' },
  });
  assert.equal(wrongAdminPassLogin.status, 401);

  const validAdminLogin = await api('/api/auth/admin/login', {
    method: 'POST',
    body: { email: 'admin@example.com', passcode: 'AdminPass#2026' },
  });
  assert.equal(validAdminLogin.status, 200);

  // Messaging number missing -> user_confirmed blocked with 503
  const missingMsgConfirm = await api('/api/messaging/onboarding', {
    method: 'PUT',
    cookie: seniorCookie,
    body: { seniorPhone: '+919800000001', status: 'user_confirmed' },
  });
  assert.equal(missingMsgConfirm.status, 503);
  assert.equal(missingMsgConfirm.data.code, 'MESSAGING_NUMBER_MISSING');

  // Messaging number missing country code rejected with 400
  const badMsgNum = await api('/api/admin/messaging-config', {
    method: 'PUT',
    cookie: adminCookie,
    body: { messagingNumber: '9800000001' },
  });
  assert.equal(badMsgNum.status, 400);

  // Formatted number with country code is normalized to E.164
  const setMsgNum = await api('/api/admin/messaging-config', {
    method: 'PUT',
    cookie: adminCookie,
    body: { messagingNumber: '+1 (415) 523-8886' },
  });
  assert.equal(setMsgNum.status, 200);
  assert.equal(setMsgNum.data.configured, true);
  assert.equal(setMsgNum.data.number, '+14155238886');

  // 5. Daily Check-in + same-day duplicate handling + alert trigger
  const ci1 = await api('/api/checkins', {
    method: 'POST',
    cookie: seniorCookie,
    body: { mood: 'okay', medicationTaken: 'yes', needsHelp: false, feelsSafe: true, note: 'Morning check' },
  });
  assert.equal(ci1.status, 201);
  assert.equal(ci1.data.updated, false);

  const ci2 = await api('/api/checkins', {
    method: 'POST',
    cookie: seniorCookie,
    body: { mood: 'not_good', medicationTaken: 'yes', needsHelp: true, feelsSafe: true, note: 'Need help with phone' },
  });
  assert.equal(ci2.status, 200);
  assert.equal(ci2.data.updated, true);

  const ciHist = await api('/api/checkins', { cookie: seniorCookie });
  assert.equal((ciHist.data.history as unknown[]).length, 1);

  // 6. Permissions & Caregiver Linking (minimal hides check-in responses)
  const inviteRes = await api('/api/permissions/invite', {
    method: 'POST',
    cookie: seniorCookie,
    body: { relationship: 'Son', sharingLevel: 'minimal' },
  });
  assert.equal(inviteRes.status, 201);
  const inviteCode = inviteRes.data.inviteCode as string;
  const linkId = inviteRes.data.id as string;

  const linkRedeem = await api('/api/caregiver/link', {
    method: 'POST',
    cookie: cgCookie,
    body: { inviteCode },
  });
  assert.equal(linkRedeem.status, 200);

  const cgDashMinimal = await api('/api/caregiver/dashboard', { cookie: cgCookie });
  assert.equal(cgDashMinimal.status, 200);
  const seniorViewMin = (cgDashMinimal.data.seniors as Array<Record<string, unknown>>)[0];
  assert.equal(seniorViewMin.wellnessSummary, null);
  assert.equal((seniorViewMin.latestCheckIn as Record<string, unknown>).mood, undefined);

  // Caregiver requests Full sharing -> Senior approves -> Wellness summary visible
  const reqAccess = await api('/api/caregiver/permission-requests', {
    method: 'POST',
    cookie: cgCookie,
    body: { linkId, requestedLevel: 'full', reason: 'Help manage appointments' },
  });
  assert.equal(reqAccess.status, 201);

  const seniorApprove = await api(`/api/permissions/requests/${reqAccess.data.id}/respond`, {
    method: 'POST',
    cookie: seniorCookie,
    body: { decision: 'approved' },
  });
  assert.equal(seniorApprove.status, 200);

  const cgDashFull = await api('/api/caregiver/dashboard', { cookie: cgCookie });
  const seniorViewFull = (cgDashFull.data.seniors as Array<Record<string, unknown>>)[0];
  assert.ok(seniorViewFull.wellnessSummary);
  assert.equal((seniorViewFull.latestCheckIn as Record<string, unknown>).mood, 'not_good');

  // Verify PUT /api/permissions/links/:linkId strips arbitrary/unknown properties
  const sanitizePerms = await api(`/api/permissions/links/${linkId}`, {
    method: 'PUT',
    cookie: seniorCookie,
    body: {
      sharingLevel: 'full',
      permissions: {
        scam_alerts: true,
        injectedAdminFlag: true,
        __proto__Test: 'malicious',
      },
    },
  });
  assert.equal(sanitizePerms.status, 200);
  const returnedPerms = sanitizePerms.data.permissions as Record<string, unknown>;
  assert.equal(returnedPerms.scam_alerts, true);
  assert.equal('injectedAdminFlag' in returnedPerms, false);
  assert.equal('__proto__Test' in returnedPerms, false);

  const permListAfter = await api('/api/permissions', { cookie: seniorCookie });
  assert.equal(permListAfter.status, 200);
  const storedLinkPerms = ((permListAfter.data.links as Array<Record<string, unknown>>)[0].permissions) as Record<string, unknown>;
  assert.equal('injectedAdminFlag' in storedLinkPerms, false);

  // 7. Scam Detection (Screenshot EMAIL case, SMS, WhatsApp, URL, Phone, Safe GREEN, Empty 400 & History)
  const emptyScam = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: seniorCookie,
    body: { inputType: 'email', content: '   ' },
  });
  assert.equal(emptyScam.status, 400);
  assert.equal(emptyScam.data.success, false);
  assert.equal(emptyScam.data.code, 'INVALID_INPUT');

  const scamScreenshotEmail = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: seniorCookie,
    body: {
      inputType: 'email',
      content: 'Your bank account will be blocked today.\nClick this link immediately to update your KYC.',
    },
  });
  assert.equal(scamScreenshotEmail.status, 200);
  assert.equal(scamScreenshotEmail.data.success, true);
  assert.equal(scamScreenshotEmail.data.riskLevel, 'RED');
  assert.equal(scamScreenshotEmail.data.risk_level, 'RED');
  assert.equal(scamScreenshotEmail.data.requiresPause, true);
  assert.equal(scamScreenshotEmail.data.persisted, true);
  assert.equal((scamScreenshotEmail.data.assessment as Record<string, unknown>).risk_level, 'RED');
  assert.ok(Array.isArray(scamScreenshotEmail.data.actions) && scamScreenshotEmail.data.actions.length > 0);
  assert.ok(String(scamScreenshotEmail.data.explanation).includes('EMAIL'));

  const scamRed = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: seniorCookie,
    body: {
      inputType: 'sms',
      content: 'URGENT: Your bank KYC expired. Download AnyDesk and share your OTP immediately at bit.ly/kyc-now',
    },
  });
  assert.equal(scamRed.status, 200);
  assert.equal(scamRed.data.riskLevel, 'RED');
  assert.equal(scamRed.data.requiresPause, true);

  const scamWhatsapp = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: seniorCookie,
    body: {
      inputType: 'whatsapp',
      content: 'Hi Mom, I lost my phone. Urgent transfer needed today, send money right now.',
    },
  });
  assert.equal(scamWhatsapp.status, 200);
  assert.equal(scamWhatsapp.data.riskLevel, 'RED');

  const scamUrl = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: seniorCookie,
    body: {
      inputType: 'url',
      content: 'https://bank-kyc-verify-now.xyz/login',
    },
  });
  assert.equal(scamUrl.status, 200);
  assert.ok(scamUrl.data.riskLevel === 'YELLOW' || scamUrl.data.riskLevel === 'RED');

  const scamPhone = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: seniorCookie,
    body: {
      inputType: 'phone',
      content: '+44 7911 123456',
    },
  });
  assert.equal(scamPhone.status, 200);
  assert.equal(scamPhone.data.riskLevel, 'YELLOW');

  const scamGreen = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: seniorCookie,
    body: { inputType: 'sms', content: 'Hi Mom, coming over for tea at 5 PM!' },
  });
  assert.equal(scamGreen.status, 200);
  assert.equal(scamGreen.data.riskLevel, 'GREEN');
  assert.notEqual(scamGreen.data.explanation, scamScreenshotEmail.data.explanation);

  const scamHistory = await api('/api/scam/history', { cookie: seniorCookie });
  assert.equal(scamHistory.status, 200);
  assert.equal(scamHistory.data.success, true);
  assert.equal((scamHistory.data.assessments as unknown[]).length, 6);

  // 8. AI Buddy honest unconfigured 503 check + conversation list + unmatched /api 404 JSON check
  const unknownApi = await api('/api/nonexistent-endpoint');
  assert.equal(unknownApi.status, 404);
  assert.equal(unknownApi.data.error, 'API endpoint not found.');

  const convCreate = await api('/api/ai/conversations', {
    method: 'POST',
    cookie: seniorCookie,
    body: { language: 'en' },
  });
  assert.equal(convCreate.status, 201);
  const convObj = convCreate.data.conversation as Record<string, unknown>;
  const convId = convObj.id as string;
  assert.ok(typeof convObj.updated_at === 'string' && convObj.updated_at.length > 0);

  const convList = await api('/api/ai/conversations', { cookie: seniorCookie });
  assert.equal(convList.status, 200);
  assert.equal((convList.data.conversations as unknown[]).length, 1);

  const emptyAiSend = await api(`/api/ai/conversations/${convId}/messages`, {
    method: 'POST',
    cookie: seniorCookie,
    body: { message: '   ' },
  });
  assert.equal(emptyAiSend.status, 400);
  assert.equal(emptyAiSend.data.success, false);
  assert.equal(emptyAiSend.data.code, 'INVALID_INPUT');
  assert.equal((emptyAiSend.data.error as Record<string, unknown>).code, 'INVALID_INPUT');

  const missingConvSend = await api(`/api/ai/conversations/non-existent-conv-id/messages`, {
    method: 'POST',
    cookie: seniorCookie,
    body: { message: 'How do I connect Wi-Fi?' },
  });
  assert.equal(missingConvSend.status, 404);
  assert.equal(missingConvSend.data.success, false);
  assert.equal(missingConvSend.data.code, 'CONVERSATION_NOT_FOUND');

  const aiSend = await api(`/api/ai/conversations/${convId}/messages`, {
    method: 'POST',
    cookie: seniorCookie,
    body: { message: 'How do I send a photo on WhatsApp?' },
  });
  assert.equal(aiSend.status, 503);
  assert.equal(aiSend.data.success, false);
  assert.equal(aiSend.data.code, 'MISSING_API_KEY');
  assert.equal(aiSend.data.userMessageSaved, true);
  assert.equal((aiSend.data.userMessage as Record<string, unknown>).content, 'How do I send a photo on WhatsApp?');
  assert.equal((aiSend.data.error as Record<string, unknown>).code, 'MISSING_API_KEY');

  const convMsgsAfter503 = await api(`/api/ai/conversations/${convId}/messages`, { cookie: seniorCookie });
  assert.equal((convMsgsAfter503.data.messages as unknown[]).length, 1);

  // 9. Lessons Progress Persistence
  const lesSave = await api('/api/lessons/smartphone-basics/progress', {
    method: 'PUT',
    cookie: seniorCookie,
    body: { completedSteps: [1, 2, 3], lastStep: 3, isCompleted: true },
  });
  assert.equal(lesSave.status, 200);
  assert.equal(lesSave.data.isCompleted, true);

  const lesGet = await api('/api/lessons', { cookie: seniorCookie });
  assert.equal(lesGet.data.completedCount, 1);

  // 10. Reminders create, fail + retry, acknowledge
  const seniorId = (seniorReg.data.user as Record<string, unknown>).id as string;
  const remCreate = await api('/api/reminders', {
    method: 'POST',
    cookie: cgCookie,
    body: {
      seniorId,
      category: 'water',
      title: 'Drink water',
      scheduledFor: new Date(Date.now() + 60000).toISOString(),
    },
  });
  assert.equal(remCreate.status, 201);
  const remId = (remCreate.data.reminder as Record<string, unknown>).id as string;

  const remFail = await api(`/api/reminders/${remId}/deliver`, {
    method: 'POST',
    cookie: cgCookie,
    body: { simulateFailure: true },
  });
  assert.equal((remFail.data.reminder as Record<string, unknown>).delivery_status, 'failed');
  assert.equal((remFail.data.reminder as Record<string, unknown>).retry_count, 1);

  const remRetry = await api(`/api/reminders/${remId}/deliver`, {
    method: 'POST',
    cookie: cgCookie,
    body: { simulateFailure: false },
  });
  assert.equal((remRetry.data.reminder as Record<string, unknown>).delivery_status, 'sent');

  const remAck = await api(`/api/reminders/${remId}/acknowledge`, {
    method: 'POST',
    cookie: seniorCookie,
  });
  assert.equal(remAck.status, 200);

  // 11. Messaging Onboarding strict senior-owned phone & CLI verification
  const spoofVerify = await api('/api/messaging/onboarding', {
    method: 'PUT',
    cookie: seniorCookie,
    body: { status: 'backend_verified' },
  });
  assert.equal(spoofVerify.status, 403);

  const userConfirm = await api('/api/messaging/onboarding', {
    method: 'PUT',
    cookie: seniorCookie,
    body: { setupMode: 'caregiver_assisted', seniorPhone: '+919800000001', status: 'user_confirmed' },
  });
  assert.equal(userConfirm.status, 200);

  execFileSync('npx', ['tsx', 'scripts/messaging-cli.ts', 'verify-hello', '+919800000001'], {
    env: { ...process.env, BUDDY_DB_PATH: dbFile },
  });

  const msgAfterCli = await api('/api/messaging/onboarding', { cookie: seniorCookie });
  assert.equal((msgAfterCli.data.onboarding as Record<string, unknown>).status, 'backend_verified');

  // 12. Revoke caregiver access immediately blocks caregiver visibility
  const revokeRes = await api(`/api/permissions/links/${linkId}/revoke`, {
    method: 'POST',
    cookie: seniorCookie,
  });
  assert.equal(revokeRes.status, 200);

  const cgAfterRevoke = await api('/api/caregiver/dashboard', { cookie: cgCookie });
  assert.equal((cgAfterRevoke.data.seniors as unknown[]).length, 0);

  // 13. Logout invalidates session
  const logoutRes = await api('/api/auth/logout', { method: 'POST', cookie: seniorCookie });
  assert.equal(logoutRes.status, 200);

  const afterLogout = await api('/api/auth/session', { cookie: seniorCookie });
  assert.equal(afterLogout.data.authenticated, false);

  // 14. Environment variable overrides for ADMIN_PASSCODE and BUDDY_MESSAGING_NUMBER
  process.env.ADMIN_PASSCODE = 'ServerEnvAdmin#99';
  process.env.BUDDY_MESSAGING_NUMBER = '+44 20 7946 0999';
  try {
    const envHealth = await api('/api/health');
    assert.equal(envHealth.status, 200);
    assert.equal((envHealth.data.messaging as Record<string, unknown>).configured, true);
    assert.equal((envHealth.data.messaging as Record<string, unknown>).number, '+442079460999');
    assert.equal((envHealth.data.adminSetup as Record<string, unknown>).hasEnvPasscode, true);

    const envAdminLogin = await api('/api/auth/admin/login', {
      method: 'POST',
      body: { email: 'admin@example.com', passcode: 'ServerEnvAdmin#99' },
    });
    assert.equal(envAdminLogin.status, 200);

    // Invalid env messaging number yields explicit configuration error instead of crashing
    process.env.BUDDY_MESSAGING_NUMBER = 'not-a-phone';
    const invalidEnvHealth = await api('/api/health');
    assert.equal(invalidEnvHealth.status, 200);
    assert.equal((invalidEnvHealth.data.messaging as Record<string, unknown>).configured, false);
    assert.ok(String((invalidEnvHealth.data.messaging as Record<string, unknown>).error).includes('BUDDY_MESSAGING_NUMBER'));
  } finally {
    delete process.env.ADMIN_PASSCODE;
    delete process.env.BUDDY_MESSAGING_NUMBER;
  }

  // 15. Strict Origin-Allowlist CORS headers & preflight verification
  process.env.ALLOWED_ORIGINS = ' https://buddy-elder-ui.vercel.app/ , https://buddy-ai-agent-3103-*.vercel.app ';
  try {
    const allowedPreflight = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://buddy-elder-ui.vercel.app' },
    });
    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), 'https://buddy-elder-ui.vercel.app');
    assert.equal(allowedPreflight.headers.get('access-control-allow-credentials'), 'true');
    assert.ok(allowedPreflight.headers.get('access-control-allow-headers')?.includes('X-Requested-With'));
    assert.ok(allowedPreflight.headers.get('access-control-expose-headers')?.includes('Retry-After'));

    // Production 3103 origin, Vercel 3103 preview origin, and legacy 31 origins must all be allowed
    for (const projectOrigin of [
      'https://buddy-ai-agent-3103.vercel.app',
      'https://buddy-ai-agent-3103-8arqyh10d-om-d8c9.vercel.app',
      'https://buddy-ai-agent-3103-git-main.vercel.app',
      'https://buddy-ai-agent-31-1x82.vercel.app',
      'https://buddy-ai-agent-31-1x82-8lcsgklmf-om-d8c9.vercel.app',
      'https://buddy-ai-agent-31-git-main.vercel.app',
    ]) {
      const projectPreflight = await fetch(`${baseUrl}/api/auth/session`, {
        method: 'OPTIONS',
        headers: {
          Origin: projectOrigin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type, Authorization, X-Requested-With',
        },
      });
      assert.equal(projectPreflight.status, 204, `Expected preflight 204 for ${projectOrigin}`);
      assert.equal(projectPreflight.headers.get('access-control-allow-origin'), projectOrigin);
      assert.equal(projectPreflight.headers.get('access-control-allow-credentials'), 'true');
    }

    // Unrelated Vercel origins, lookalikes, and non-HTTPS schemes must be rejected
    for (const badOrigin of [
      'https://untrusted-site.vercel.app',
      'https://buddy-ai-agent-3103evil.vercel.app',
      'https://evil-buddy-ai-agent-3103.vercel.app',
      'https://buddy-ai-agent-3104.vercel.app',
      'http://buddy-ai-agent-3103.vercel.app',
    ]) {
      const unlistedCors = await fetch(`${baseUrl}/api/health`, {
        method: 'GET',
        headers: { Origin: badOrigin },
      });
      assert.equal(unlistedCors.status, 200);
      assert.equal(unlistedCors.headers.get('access-control-allow-origin'), null, `Must reject ${badOrigin}`);

      const deniedPreflight = await fetch(`${baseUrl}/api/auth/session`, {
        method: 'OPTIONS',
        headers: { Origin: badOrigin },
      });
      assert.equal(deniedPreflight.status, 403, `Must reject preflight for ${badOrigin}`);
      assert.equal(deniedPreflight.headers.get('access-control-allow-origin'), null);
    }

    // Broad wildcards like *.vercel.app must never be honored, and Railway runtime suppresses localhost dev origins
    const { isAllowedCorsOrigin } = await import('../server/app.ts');
    assert.equal(
      isAllowedCorsOrigin('https://unrelated-app.vercel.app', 'buddyaiagent3103-production.up.railway.app', {
        ALLOWED_ORIGINS: 'https://*.vercel.app',
        NODE_ENV: 'production',
      }),
      false
    );
    assert.equal(
      isAllowedCorsOrigin('http://localhost:3000', 'buddyaiagent3103-production.up.railway.app', {
        RAILWAY_PUBLIC_DOMAIN: 'buddyaiagent3103-production.up.railway.app',
      }),
      false
    );
    assert.equal(
      isAllowedCorsOrigin('https://buddy-ai-agent-3103-8arqyh10d-om-d8c9.vercel.app', 'buddyaiagent3103-production.up.railway.app', {
        NODE_ENV: 'production',
        APP_URL: 'https://buddy-ai-agent-3103.vercel.app',
      }),
      true
    );
  } finally {
    delete process.env.ALLOWED_ORIGINS;
  }

  // 16. Malformed JSON returns JSON 400, unknown API POST returns JSON 404, & database durability reported cleanly
  const badJsonRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BuddyElderAI',
    },
    body: '{invalid-json',
  });
  assert.equal(badJsonRes.status, 400);
  const badJsonData = (await badJsonRes.json()) as Record<string, unknown>;
  assert.equal(badJsonData.error, 'Invalid JSON request body.');

  const unknownPostRes = await fetch(`${baseUrl}/api/ai/does-not-exist`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BuddyElderAI',
    },
    body: JSON.stringify({ test: true }),
  });
  assert.equal(unknownPostRes.status, 404);
  assert.ok((unknownPostRes.headers.get('content-type') || '').includes('application/json'));
  const unknownPostData = (await unknownPostRes.json()) as Record<string, unknown>;
  assert.equal(unknownPostData.code, 'NOT_FOUND');

  const dbStatusHealth = await api('/api/health');
  assert.equal((dbStatusHealth.data.database as Record<string, unknown>).engine, 'sqlite');
  assert.equal((dbStatusHealth.data.database as Record<string, unknown>).durable, true);
});

test('Vercel serverless handler (server/vercel-handler.ts & bundled api/index.mjs) normalizes rewrites and never returns HTML', async () => {
  const { default: vercelHandler, normalizeVercelRequestUrl } = await import('../server/vercel-handler.ts');
  assert.equal(typeof vercelHandler, 'function');

  // Verify rewrite path normalization preserves subpaths and existing query strings
  assert.equal(
    normalizeVercelRequestUrl('/api/index.mjs?__buddy_path=ai/conversations/abc-123/messages&lang=en'),
    '/api/ai/conversations/abc-123/messages?lang=en'
  );
  assert.equal(normalizeVercelRequestUrl('/api/index.mjs'), '/api');
  assert.equal(
    normalizeVercelRequestUrl('/api/ai/conversations/abc-123/messages'),
    '/api/ai/conversations/abc-123/messages'
  );

  await new Promise<void>((resolve, reject) => {
    const tempServer = http.createServer((req, res) => {
      void vercelHandler(req as never, res as never);
    });
    tempServer.listen(0, '127.0.0.1', async () => {
      try {
        const addr = tempServer.address();
        const url = addr && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}` : '';

        const healthRes = await fetch(`${url}/api/health`);
        assert.equal(healthRes.status, 200);
        assert.ok((healthRes.headers.get('content-type') || '').includes('application/json'));
        const healthBody = (await healthRes.json()) as Record<string, unknown>;
        assert.equal(healthBody.ok, true);

        // Simulated Vercel rewrite /api/(.*) -> /api/index.mjs?__buddy_path=$1
        const rewrittenHealth = await fetch(`${url}/api/index.mjs?__buddy_path=health`);
        assert.equal(rewrittenHealth.status, 200);
        assert.ok((rewrittenHealth.headers.get('content-type') || '').includes('application/json'));
        const rewrittenHealthBody = (await rewrittenHealth.json()) as Record<string, unknown>;
        assert.equal(rewrittenHealthBody.ok, true);

        const rewrittenChat = await fetch(
          `${url}/api/index.mjs?__buddy_path=ai/conversations/f9ee5610-5f09-491e-9b01-25492a144fda/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Requested-With': 'BuddyElderAI',
            },
            body: JSON.stringify({ message: 'Hello Buddy' }),
          }
        );
        // Unauthenticated request reaches Express auth guard and returns JSON 401 (never HTML)
        assert.equal(rewrittenChat.status, 401);
        assert.ok((rewrittenChat.headers.get('content-type') || '').includes('application/json'));

        const rootApiRes = await fetch(`${url}/api`);
        assert.equal(rootApiRes.status, 404);
        assert.ok((rootApiRes.headers.get('content-type') || '').includes('application/json'));
        const rootApiBody = (await rootApiRes.json()) as Record<string, unknown>;
        assert.equal(rootApiBody.code, 'NOT_FOUND');

        const missingApiRes = await fetch(`${url}/api/does-not-exist`);
        assert.equal(missingApiRes.status, 404);
        assert.ok((missingApiRes.headers.get('content-type') || '').includes('application/json'));
        const missingApiBody = (await missingApiRes.json()) as Record<string, unknown>;
        assert.equal(missingApiBody.code, 'NOT_FOUND');

        resolve();
      } catch (err) {
        reject(err);
      } finally {
        tempServer.close();
      }
    });
  });

  // Also verify the compiled api/index.mjs ESM bundle when present on disk
  const builtApiPath = path.resolve(process.cwd(), 'api', 'index.mjs');
  if (fs.existsSync(builtApiPath)) {
    const builtMod = (await import(builtApiPath)) as { default?: unknown };
    assert.equal(typeof builtMod.default, 'function');
  }
});

test('AI Buddy model payload parsing and Gemini error classification handle edge cases', async () => {
  const { parseBuddyModelPayload, classifyGeminiError, getConfiguredGeminiModel, normalizeGeminiModelName, getAiStatus } =
    await import('../server/ai.ts');

  assert.equal(getConfiguredGeminiModel(), 'gemini-2.5-flash');

  // Invalid GEMINI_MODEL overrides (e.g. mistakenly pasted token or placeholder) fall back safely
  assert.deepEqual(normalizeGeminiModelName('AQ.SampleInvalidPastedTokenValue123'), {
    model: 'gemini-2.5-flash',
    invalidOverride: true,
  });
  assert.deepEqual(normalizeGeminiModelName('AIzaSyFakeKeyPastedIntoModelVar'), {
    model: 'gemini-2.5-flash',
    invalidOverride: true,
  });
  assert.deepEqual(normalizeGeminiModelName('models/gemini-3.1-flash-lite'), {
    model: 'gemini-3.1-flash-lite',
    invalidOverride: false,
  });
  assert.deepEqual(normalizeGeminiModelName('"gemini-2.5-flash"'), {
    model: 'gemini-2.5-flash',
    invalidOverride: false,
  });

  const prevModelEnv = process.env.GEMINI_MODEL;
  const prevFallbackEnv = process.env.GEMINI_FALLBACK_MODEL;
  process.env.GEMINI_MODEL = 'AQ.MistakenTokenString';
  process.env.GEMINI_FALLBACK_MODEL = 'gemini-4-hydrogen';
  try {
    assert.equal(getConfiguredGeminiModel(), 'gemini-2.5-flash');
    const aiStatus = getAiStatus();
    assert.equal(aiStatus.model, 'gemini-2.5-flash');
    assert.equal(aiStatus.fallbackModel, 'gemini-4-hydrogen');
    assert.ok(aiStatus.modelWarning && !aiStatus.modelWarning.includes('AQ.MistakenTokenString'));

    process.env.GEMINI_FALLBACK_MODEL = 'none';
    assert.equal(getAiStatus().fallbackModel, null);
  } finally {
    if (prevModelEnv === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prevModelEnv;
    if (prevFallbackEnv === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
    else process.env.GEMINI_FALLBACK_MODEL = prevFallbackEnv;
  }

  // Structured JSON responses for sample elder-care questions
  const whatsappParsed = parseBuddyModelPayload(
    JSON.stringify({
      reply: '1. Open WhatsApp.\n2. Tap the paperclip icon.\n3. Choose Gallery and tap Send.',
      suggestions: ['How do I zoom in on a photo?', 'How do I save a photo?'],
    })
  );
  assert.ok(whatsappParsed.reply.includes('paperclip'));
  assert.equal(whatsappParsed.suggestions.length, 2);

  // Markdown-fenced JSON from Gemini
  const fencedParsed = parseBuddyModelPayload(
    '```json\n{"reply": "Press the top volume-up button on the side of your phone.", "suggestions": ["How do I mute ringtone?"]}\n```'
  );
  assert.ok(fencedParsed.reply.includes('volume-up'));
  assert.equal(fencedParsed.suggestions[0], 'How do I mute ringtone?');

  // Clean plain-text fallback when model returns prose instead of JSON wrapper
  const plainTextParsed = parseBuddyModelPayload(
    'Hang up immediately if anyone asks for your OTP or bank PIN. Call the official number on the back of your card.'
  );
  assert.ok(plainTextParsed.reply.includes('OTP'));
  assert.deepEqual(plainTextParsed.suggestions, []);

  // Empty response throws AI_EMPTY_RESPONSE instead of SyntaxError
  assert.throws(() => parseBuddyModelPayload('   '), (err: unknown) => {
    return err instanceof Error && (err as { code?: string }).code === 'AI_EMPTY_RESPONSE';
  });

  // Error classifications (preserving JSON code/status even when message text omits them)
  assert.equal(classifyGeminiError(new Error('{"error":{"code":404,"message":"models/bad is not found"}}')).code, 'AI_MODEL_ERROR');
  assert.equal(
    classifyGeminiError(
      new Error('{"error":{"code":400,"message":"* GenerateContentRequest.model: unexpected model name format\\n","status":"INVALID_ARGUMENT"}}')
    ).code,
    'AI_MODEL_ERROR'
  );
  assert.equal(classifyGeminiError(new Error('{"error":{"code":429,"message":"Too many requests","status":"RESOURCE_EXHAUSTED"}}')).code, 'AI_RATE_LIMIT');
  assert.equal(classifyGeminiError(new Error('{"error":{"code":403,"message":"Forbidden","status":"PERMISSION_DENIED"}}')).code, 'AI_AUTH_ERROR');
  assert.equal(classifyGeminiError(new Error('{"error":{"code":503,"message":"Service overloaded","status":"UNAVAILABLE"}}')).statusCode, 503);
  assert.equal(classifyGeminiError(new Error('ETIMEDOUT: AI service took too long')).code, 'AI_TIMEOUT');
  assert.equal(classifyGeminiError(new Error('API_KEY_INVALID: bad key')).code, 'AI_AUTH_ERROR');
  assert.equal(classifyGeminiError(new Error('TypeError: fetch failed')).code, 'AI_NETWORK_ERROR');
});

test('Frontend apiRequest diagnoses HTML SPA fallbacks and extracts standardized JSON payloads', async () => {
  const { apiRequest, ApiError } = await import('../src/lib/api.ts');
  const originalFetch = globalThis.fetch;

  try {
    // 1. HTML returned with HTTP 200 (proxy/SPA fallback scenario)
    globalThis.fetch = (async () =>
      new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })) as typeof fetch;

    await assert.rejects(
      () => apiRequest('/api/ai/conversations/1/messages', { method: 'POST', body: { message: 'Wi-Fi?' } }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === 'INVALID_RESPONSE' &&
        err.message.includes('HTML page instead of JSON')
    );

    // 2. Standardized backend error { success: false, error: { code, message } }
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 'MISSING_API_KEY',
          error: { code: 'MISSING_API_KEY', message: 'Add GOOGLE_GEMINI_API_KEY in Settings.' },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    await assert.rejects(
      () => apiRequest('/api/ai/conversations/1/messages', { method: 'POST', body: { message: 'Internet?' } }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === 'MISSING_API_KEY' &&
        err.message === 'Add GOOGLE_GEMINI_API_KEY in Settings.'
    );

    // 3. Standardized success response { success: true, response, conversationId }
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          response: 'Open Settings and tap Wi-Fi to connect.',
          conversationId: 'conv-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as typeof fetch;

    const ok = await apiRequest<{ success: boolean; response: string; conversationId: string }>(
      '/api/ai/conversations/1/messages',
      { method: 'POST', body: { message: 'How do I connect to Wi-Fi?' } }
    );
    assert.equal(ok.success, true);
    assert.ok(ok.response.includes('Wi-Fi'));
    assert.equal(ok.conversationId, 'conv-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Scam detection falls back cleanly to heuristic_fallback when Gemini fails at runtime', async () => {
  const { analyzeScamContent } = await import('../server/ai.ts');
  const prevKey = process.env.GOOGLE_GEMINI_API_KEY;
  process.env.GOOGLE_GEMINI_API_KEY = 'AIzaSyFakeInvalidKeyForFallbackUnitTestOnly';
  try {
    const res = await analyzeScamContent({
      content: 'Your bank account will be blocked today. Click this link immediately to update your KYC.',
      inputType: 'email',
      language: 'en',
    });
    assert.equal(res.riskLevel, 'RED');
    assert.equal(res.source, 'heuristic_fallback');
    assert.ok(res.fallbackReason);
    assert.equal(res.requiresPause, true);
    assert.ok(res.indicators.length >= 2);
    assert.ok(res.recommendedActions.length >= 3);
  } finally {
    if (prevKey === undefined) delete process.env.GOOGLE_GEMINI_API_KEY;
    else process.env.GOOGLE_GEMINI_API_KEY = prevKey;
  }
});

test('resolveApiBase prevents localhost calls from production sites, routes Vercel project origins to Railway, avoids duplicate /api, and checkBackendHealth verifies JSON status', async () => {
  const { resolveApiBase, buildApiUrl, apiRequest, checkBackendHealth, DEFAULT_PRODUCTION_BACKEND_URL, ApiError } = await import('../src/lib/api.ts');
  const prodLoc = {
    protocol: 'https:',
    hostname: 'buddy-elder.vercel.app',
    origin: 'https://buddy-elder.vercel.app',
  };
  const project3103ProdLoc = {
    protocol: 'https:',
    hostname: 'buddy-ai-agent-3103.vercel.app',
    origin: 'https://buddy-ai-agent-3103.vercel.app',
  };
  const project3103PreviewLoc = {
    protocol: 'https:',
    hostname: 'buddy-ai-agent-3103-8arqyh10d-om-d8c9.vercel.app',
    origin: 'https://buddy-ai-agent-3103-8arqyh10d-om-d8c9.vercel.app',
  };
  const projectVercelProdLoc = {
    protocol: 'https:',
    hostname: 'buddy-ai-agent-31-1x82.vercel.app',
    origin: 'https://buddy-ai-agent-31-1x82.vercel.app',
  };
  const projectVercelPreviewLoc = {
    protocol: 'https:',
    hostname: 'buddy-ai-agent-31-1x82-8lcsgklmf-om-d8c9.vercel.app',
    origin: 'https://buddy-ai-agent-31-1x82-8lcsgklmf-om-d8c9.vercel.app',
  };
  const projectVercelBranchLoc = {
    protocol: 'https:',
    hostname: 'buddy-ai-agent-31-git-main.vercel.app',
    origin: 'https://buddy-ai-agent-31-git-main.vercel.app',
  };
  const localDevLoc = {
    protocol: 'http:',
    hostname: 'localhost',
    origin: 'http://localhost:3000',
  };
  const aiStudioPreviewLoc = {
    protocol: 'https:',
    hostname: 'ais-dev-2qxhk3go2y6jbo5wdgpa3t-670663735174.asia-northeast1.run.app',
    origin: 'https://ais-dev-2qxhk3go2y6jbo5wdgpa3t-670663735174.asia-northeast1.run.app',
  };

  assert.equal(DEFAULT_PRODUCTION_BACKEND_URL, 'https://buddyaiagent3103-production.up.railway.app');
  assert.equal(resolveApiBase('undefined', prodLoc, false).baseUrl, '');
  assert.equal(resolveApiBase('/api', prodLoc, false).baseUrl, '');
  assert.equal(resolveApiBase('undefined', project3103ProdLoc, false).baseUrl, DEFAULT_PRODUCTION_BACKEND_URL);
  assert.equal(resolveApiBase('undefined', project3103PreviewLoc, false).baseUrl, DEFAULT_PRODUCTION_BACKEND_URL);
  assert.equal(resolveApiBase('undefined', projectVercelProdLoc, false).baseUrl, DEFAULT_PRODUCTION_BACKEND_URL);
  assert.equal(resolveApiBase('undefined', projectVercelPreviewLoc, false).baseUrl, DEFAULT_PRODUCTION_BACKEND_URL);
  assert.equal(resolveApiBase('undefined', projectVercelBranchLoc, false).baseUrl, DEFAULT_PRODUCTION_BACKEND_URL);
  // Misconfigured Vercel self-origin automatically heals to the Railway backend URL
  assert.equal(
    resolveApiBase('https://buddy-ai-agent-3103.vercel.app', project3103ProdLoc, false).baseUrl,
    DEFAULT_PRODUCTION_BACKEND_URL
  );
  assert.equal(
    resolveApiBase('https://buddy-ai-agent-31-1x82.vercel.app', projectVercelProdLoc, false).baseUrl,
    DEFAULT_PRODUCTION_BACKEND_URL
  );
  // Private Railway internal domain must never be used in browser code
  assert.equal(resolveApiBase('https://buddyaiagent3103.railway.internal', project3103ProdLoc, false).baseUrl, '');
  assert.ok(resolveApiBase('https://buddyaiagent3103.railway.internal', project3103ProdLoc, false).configError);
  // Local dev (localhost:3000 / Vite proxy) always stays local in dev mode even if .env has remote URL
  assert.equal(resolveApiBase('', localDevLoc, true).baseUrl, '');
  assert.equal(resolveApiBase(DEFAULT_PRODUCTION_BACKEND_URL, localDevLoc, true).baseUrl, '');
  assert.equal(resolveApiBase('http://localhost:3000', localDevLoc, true).baseUrl, 'http://localhost:3000');

  assert.equal(
    resolveApiBase('buddyaiagent3103-production.up.railway.app', prodLoc, false).baseUrl,
    'https://buddyaiagent3103-production.up.railway.app'
  );
  assert.equal(
    resolveApiBase('buddyaiagent3103-production.up.railway.app/api/', prodLoc, false).baseUrl,
    'https://buddyaiagent3103-production.up.railway.app'
  );
  assert.equal(resolveApiBase('buddyaiagent3103-production.up.railway.app', aiStudioPreviewLoc, false).baseUrl, '');
  assert.equal(resolveApiBase('http://localhost:3000', prodLoc, false).baseUrl, '');
  assert.ok(resolveApiBase('http://localhost:3000', prodLoc, false).configError);
  assert.equal(resolveApiBase('https://api.buddyelder.com/api/', prodLoc, false).baseUrl, 'https://api.buddyelder.com');
  assert.ok(resolveApiBase('not-a-url', prodLoc, false).configError);
  assert.ok(resolveApiBase('http://api.buddyelder.com', prodLoc, false).configError);

  // buildApiUrl never duplicates /api
  assert.equal(
    buildApiUrl(`${DEFAULT_PRODUCTION_BACKEND_URL}/api/`, '/api/ai/conversations/123/messages'),
    `${DEFAULT_PRODUCTION_BACKEND_URL}/api/ai/conversations/123/messages`
  );
  assert.equal(
    buildApiUrl(DEFAULT_PRODUCTION_BACKEND_URL, '/api/api/ai/conversations/123/messages'),
    `${DEFAULT_PRODUCTION_BACKEND_URL}/api/ai/conversations/123/messages`
  );
  assert.equal(buildApiUrl('', 'api/health'), '/api/health');

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    await assert.rejects(
      () => apiRequest('/api/health'),
      (err: unknown) => err instanceof ApiError && err.code === 'BACKEND_UNAVAILABLE' && err.status === 0
    );

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, status: 'degraded' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(
      () => checkBackendHealth(),
      (err: unknown) => err instanceof ApiError && err.status === 503
    );

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, status: 'ok', database: { engine: 'sqlite', durable: true, mode: 'custom_path', ok: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    const healthy = await checkBackendHealth();
    assert.equal(healthy.ok, true);
    assert.equal(healthy.status, 'ok');

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'API endpoint not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(
      () => apiRequest('/api/missing-route'),
      (err: unknown) => err instanceof ApiError && err.code === 'NOT_FOUND' && err.status === 404
    );

    // 429 rate-limit metadata + saved userMessage extraction (body + Retry-After header)
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: 'AI_QUOTA_EXHAUSTED',
          rateLimitSource: 'gemini_provider',
          quotaExhausted: true,
          attemptedModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
          userMessageSaved: true,
          userMessage: {
            id: 'msg-u-1',
            role: 'user',
            content: 'WhatsApp?',
            language: 'en',
            created_at: '2026-11-21T10:00:00.000Z',
          },
          error: {
            code: 'AI_QUOTA_EXHAUSTED',
            message: 'Quota reached for both models.',
          },
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '14',
          },
        }
      )) as typeof fetch;

    await assert.rejects(
      () => apiRequest('/api/ai/conversations/1/messages', { method: 'POST', body: { message: 'WhatsApp?' } }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.status === 429 &&
        err.code === 'AI_QUOTA_EXHAUSTED' &&
        err.retryAfterSeconds === 14 &&
        err.rateLimitSource === 'gemini_provider' &&
        err.quotaExhausted === true &&
        err.userMessageSaved === true &&
        err.userMessage?.id === 'msg-u-1' &&
        Array.isArray(err.attemptedModels) &&
        err.attemptedModels.length === 2
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini 429 classification distinguishes transient rate limit vs daily quota exhaustion and respects GEMINI_MODEL', async () => {
  const { classifyGeminiError, getRetryDelayMs, getConfiguredGeminiModel } = await import('../server/ai.ts');

  // Configured GEMINI_MODEL must always be respected verbatim (never silently substituted)
  const prevModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  try {
    assert.equal(getConfiguredGeminiModel(), 'gemini-2.5-flash');
  } finally {
    if (prevModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prevModel;
  }

  // Transient 429 with retryDelay: 12s -> AI_RATE_LIMIT, wait hint = 12s, skips auto-retry (>5s)
  const transient429Err = new Error(
    JSON.stringify({
      error: {
        code: 429,
        message: 'Resource exhausted. Please retry in 12s.',
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
      },
    })
  );
  const transientClassified = classifyGeminiError(transient429Err, 'gemini-4-hydrogen', 0);
  assert.equal(transientClassified.code, 'AI_RATE_LIMIT');
  assert.equal(transientClassified.statusCode, 429);
  assert.equal(transientClassified.retryAfterSeconds, 12);
  assert.equal(transientClassified.quotaExhausted, false);
  assert.equal(transientClassified.rateLimitSource, 'gemini_provider');
  assert.ok(transientClassified.message.includes('12 seconds'));
  assert.equal(getRetryDelayMs(transient429Err, 1), null);

  // Transient 429 with short retryDelay: 2s -> bounded retry allowed once
  const short429Err = new Error(
    JSON.stringify({
      error: {
        code: 429,
        message: 'Too many requests',
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' }],
      },
    })
  );
  const shortDelay = getRetryDelayMs(short429Err, 1);
  assert.ok(typeof shortDelay === 'number' && shortDelay >= 2000 && shortDelay <= 2300);

  // Daily quota exhaustion (RequestsPerDay / limit: 0) -> AI_QUOTA_EXHAUSTED, never retried
  const dailyQuotaErr = new Error(
    JSON.stringify({
      error: {
        code: 429,
        message: 'Quota exceeded for quota metric GenerateRequestsPerDayPerProjectPerModel',
        status: 'RESOURCE_EXHAUSTED',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
            violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel', quotaMetric: 'requests_per_day' }],
          },
        ],
      },
    })
  );
  const dailyClassified = classifyGeminiError(dailyQuotaErr, 'gemini-3.1-flash-lite', 0);
  assert.equal(dailyClassified.code, 'AI_QUOTA_EXHAUSTED');
  assert.equal(dailyClassified.statusCode, 429);
  assert.equal(dailyClassified.quotaExhausted, true);
  assert.equal(dailyClassified.rateLimitSource, 'gemini_provider');
  assert.equal(dailyClassified.model, 'gemini-3.1-flash-lite');
  assert.ok(dailyClassified.message.includes('daily AI usage limit'));
  assert.ok(dailyClassified.message.includes('Is This Safe?'));
  assert.equal(getRetryDelayMs(dailyQuotaErr, 1), null);
});

test('Express createRateLimiter isolates user buckets, keeps AI Buddy & Scam Checker independent, and emits Retry-After', async () => {
  const expressMod = await import('express');
  const { createRateLimiter } = await import('../server/app.ts');

  const miniApp = expressMod.default();
  const chatLimiter = createRateLimiter(60_000, 2, { limiterName: 'chat_test', keyByUser: true });
  const scamLimiter = createRateLimiter(60_000, 2, { limiterName: 'scam_test', keyByUser: true });

  miniApp.use((req, _res, next) => {
    const uid = req.headers['x-test-user'];
    if (typeof uid === 'string') {
      (req as { user?: { id: string } }).user = { id: uid };
    }
    next();
  });

  miniApp.post('/chat', chatLimiter, (_req, res) => res.json({ ok: true }));
  miniApp.post('/scam', scamLimiter, (_req, res) => res.json({ ok: true }));

  await new Promise<void>((resolve, reject) => {
    const srv = miniApp.listen(0, '127.0.0.1', async () => {
      try {
        const addr = srv.address();
        const url = addr && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}` : '';

        // User A makes 2 chat requests (ok), 3rd triggers Express 429 with Retry-After
        assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers: { 'x-test-user': 'user-a' } })).status, 200);
        assert.equal((await fetch(`${url}/chat`, { method: 'POST', headers: { 'x-test-user': 'user-a' } })).status, 200);

        const limited = await fetch(`${url}/chat`, { method: 'POST', headers: { 'x-test-user': 'user-a' } });
        assert.equal(limited.status, 429);
        const retryHeader = Number(limited.headers.get('retry-after'));
        assert.ok(Number.isFinite(retryHeader) && retryHeader >= 1);
        const limitedJson = (await limited.json()) as Record<string, unknown>;
        assert.equal(limitedJson.code, 'BACKEND_RATE_LIMIT');
        assert.equal(limitedJson.rateLimitSource, 'express_limiter');

        // User B on the same IP is NOT blocked by User A's chat limit
        const userBOk = await fetch(`${url}/chat`, { method: 'POST', headers: { 'x-test-user': 'user-b' } });
        assert.equal(userBOk.status, 200);

        // User A's Scam Checker limiter is independent of User A's Chat limiter
        const scamOk = await fetch(`${url}/scam`, { method: 'POST', headers: { 'x-test-user': 'user-a' } });
        assert.equal(scamOk.status, 200);

        resolve();
      } catch (err) {
        reject(err);
      } finally {
        srv.close();
      }
    });
  });
});

test('Production DB config guards reject ephemeral Vercel/Railway/memory storage without silent fallback', async () => {
  const { DatabaseConfigError, getDbPath, getDatabaseStatus } = await import('../server/db.ts');
  const prevVercel = process.env.VERCEL;
  const prevRailway = process.env.RAILWAY_ENVIRONMENT;
  const prevDbPath = process.env.BUDDY_DB_PATH;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllowEphemeral = process.env.BUDDY_ALLOW_EPHEMERAL_DB;

  try {
    delete process.env.BUDDY_ALLOW_EPHEMERAL_DB;

    // 1. Vercel without BUDDY_DB_PATH must fail loudly
    process.env.VERCEL = '1';
    delete process.env.BUDDY_DB_PATH;
    assert.throws(() => getDbPath(), (err: unknown) => err instanceof DatabaseConfigError && err.code === 'DATABASE_NOT_PERSISTENT');
    assert.equal(getDatabaseStatus().mode, 'misconfigured');
    assert.equal(getDatabaseStatus().durable, false);

    // 2. Vercel pointing into os.tmpdir() must also fail loudly
    process.env.BUDDY_DB_PATH = path.join(os.tmpdir(), 'ephemeral.db');
    assert.throws(() => getDbPath(), (err: unknown) => err instanceof DatabaseConfigError && err.code === 'DATABASE_NOT_PERSISTENT');

    // 3. Railway without BUDDY_DB_PATH must fail loudly
    delete process.env.VERCEL;
    delete process.env.BUDDY_DB_PATH;
    process.env.RAILWAY_ENVIRONMENT = 'production';
    assert.throws(() => getDbPath(), (err: unknown) => err instanceof DatabaseConfigError && err.code === 'DATABASE_NOT_PERSISTENT');

    // 4. Railway with explicit persistent volume path succeeds cleanly
    process.env.BUDDY_DB_PATH = '/data/buddy-elder.db';
    assert.equal(getDbPath(), path.resolve('/data/buddy-elder.db'));
    assert.equal(getDatabaseStatus().durable, true);
    assert.equal(getDatabaseStatus().mode, 'custom_path');

    // 4b. Railway with RAILWAY_VOLUME_MOUNT_PATH and unset BUDDY_DB_PATH resolves automatically to mounted volume
    delete process.env.BUDDY_DB_PATH;
    process.env.RAILWAY_VOLUME_MOUNT_PATH = '/data';
    assert.equal(getDbPath(), path.resolve('/data/buddy-elder.db'));
    assert.equal(getDatabaseStatus().durable, true);
    assert.equal(getDatabaseStatus().mode, 'custom_path');
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;

    // 5. :memory: is rejected in NODE_ENV=production
    delete process.env.RAILWAY_ENVIRONMENT;
    process.env.NODE_ENV = 'production';
    process.env.BUDDY_DB_PATH = ':memory:';
    assert.throws(() => getDbPath(), (err: unknown) => err instanceof DatabaseConfigError && err.code === 'DATABASE_NOT_PERSISTENT');
  } finally {
    if (prevVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = prevVercel;
    if (prevRailway === undefined) delete process.env.RAILWAY_ENVIRONMENT;
    else process.env.RAILWAY_ENVIRONMENT = prevRailway;
    if (prevDbPath === undefined) delete process.env.BUDDY_DB_PATH;
    else process.env.BUDDY_DB_PATH = prevDbPath;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevAllowEphemeral === undefined) delete process.env.BUDDY_ALLOW_EPHEMERAL_DB;
    else process.env.BUDDY_ALLOW_EPHEMERAL_DB = prevAllowEphemeral;
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
  }
});

test('Sessions and user data persist across server restarts, enforce expiry/invalid tokens, and set secure proxy cookies', async () => {
  const { closeDb, getDb } = await import('../server/db.ts');
  const { hashToken } = await import('../server/auth.ts');

  const persistRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-persist-test-'));
  const nestedDbPath = path.join(persistRoot, 'nested-volume', 'buddy-elder.db');
  const prevDbPath = process.env.BUDDY_DB_PATH;

  let srv1: http.Server | undefined;
  let srv2: http.Server | undefined;

  try {
    closeDb();
    process.env.BUDDY_DB_PATH = nestedDbPath;

    // Boot server instance 1 (should auto-create nested-volume directory)
    const app1 = createApp();
    const url1 = await new Promise<string>((resolve) => {
      srv1 = app1.listen(0, '127.0.0.1', () => {
        const addr = srv1!.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });

    assert.equal(fs.existsSync(path.dirname(nestedDbPath)), true);

    // Register & check HTTPS-proxied cookie attributes vs local HTTP cookie attributes
    const localReg = await fetch(`${url1}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'BuddyElderAI',
      },
      body: JSON.stringify({
        name: 'Meera Kulkarni',
        email: 'meera@example.com',
        password: 'password123',
        role: 'senior',
      }),
    });
    assert.equal(localReg.status, 201);
    const localSetCookie = localReg.headers.get('set-cookie') || '';
    assert.ok(localSetCookie.includes('HttpOnly'));
    assert.ok(localSetCookie.includes('SameSite=Lax'));
    assert.equal(localSetCookie.includes('Secure'), false);

    // Simulated HTTPS reverse proxy login (e.g. Railway edge TLS)
    const httpsLogin = await fetch(`${url1}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'BuddyElderAI',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': 'buddy.up.railway.app',
      },
      body: JSON.stringify({ email: 'meera@example.com', password: 'password123' }),
    });
    assert.equal(httpsLogin.status, 200);
    const httpsSetCookie = httpsLogin.headers.get('set-cookie') || '';
    assert.ok(httpsSetCookie.includes('HttpOnly'));
    assert.ok(httpsSetCookie.includes('Secure'));
    assert.ok(httpsSetCookie.includes('SameSite=None'));
    assert.ok(httpsSetCookie.includes('Partitioned'));

    const persistedCookie = httpsSetCookie.split(';')[0];
    const loginPayload = (await httpsLogin.json()) as { token: string };
    const persistedToken = loginPayload.token;

    // Create persisted check-in on instance 1
    const checkinRes = await fetch(`${url1}/api/checkins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'BuddyElderAI',
        Cookie: persistedCookie,
      },
      body: JSON.stringify({ mood: 'good', medicationTaken: 'yes', feelsSafe: true }),
    });
    assert.equal(checkinRes.status, 201);

    // Shut down server instance 1 and checkpoint + close SQLite cleanly
    await new Promise<void>((resolve) => srv1!.close(() => resolve()));
    srv1 = undefined;
    closeDb();

    // Boot server instance 2 against the SAME persistent SQLite file
    const app2 = createApp();
    const url2 = await new Promise<string>((resolve) => {
      srv2 = app2.listen(0, '127.0.0.1', () => {
        const addr = srv2!.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });

    // Session & data MUST survive server restart (browser refresh scenario)
    const sessionAfterRestart = await fetch(`${url2}/api/auth/session`, {
      headers: { Cookie: persistedCookie },
    });
    assert.equal(sessionAfterRestart.status, 200);
    const sessionData = (await sessionAfterRestart.json()) as {
      authenticated: boolean;
      user: { email: string };
    };
    assert.equal(sessionData.authenticated, true);
    assert.equal(sessionData.user.email, 'meera@example.com');

    const checkinsAfterRestart = await fetch(`${url2}/api/checkins`, {
      headers: { Cookie: persistedCookie },
    });
    assert.equal(checkinsAfterRestart.status, 200);
    const checkinsData = (await checkinsAfterRestart.json()) as { todayCheckIn: { mood: string } | null };
    assert.equal(checkinsData.todayCheckIn?.mood, 'good');

    // Invalid token returns HTTP 401 JSON
    const invalidTokenRes = await fetch(`${url2}/api/settings`, {
      headers: { Cookie: 'buddy_session=totally-invalid-token-value' },
    });
    assert.equal(invalidTokenRes.status, 401);
    const invalidTokenBody = (await invalidTokenRes.json()) as { error: string };
    assert.ok(invalidTokenBody.error.includes('Session not found or expired'));

    // Sliding renewal: backdate session expiry to < 2 days left -> request renews it
    const nearExpiryIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    getDb()
      .prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`)
      .run(nearExpiryIso, hashToken(persistedToken));

    const slidingRes = await fetch(`${url2}/api/settings`, {
      headers: { Cookie: persistedCookie },
    });
    assert.equal(slidingRes.status, 200);
    assert.ok((slidingRes.headers.get('set-cookie') || '').includes('buddy_session='));

    // Expired session returns HTTP 401 JSON and deletes session row
    const expiredIso = new Date(Date.now() - 60_000).toISOString();
    getDb()
      .prepare(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`)
      .run(expiredIso, hashToken(persistedToken));

    const expiredRes = await fetch(`${url2}/api/settings`, {
      headers: { Cookie: persistedCookie },
    });
    assert.equal(expiredRes.status, 401);
    const expiredBody = (await expiredRes.json()) as { error: string };
    assert.ok(expiredBody.error.includes('Session expired'));
    const remaining = getDb()
      .prepare(`SELECT COUNT(*) AS cnt FROM sessions WHERE token_hash = ?`)
      .get(hashToken(persistedToken)) as { cnt: number };
    assert.equal(remaining.cnt, 0);
  } finally {
    if (srv1) await new Promise<void>((resolve) => srv1!.close(() => resolve()));
    if (srv2) await new Promise<void>((resolve) => srv2!.close(() => resolve()));
    closeDb();
    if (prevDbPath === undefined) delete process.env.BUDDY_DB_PATH;
    else process.env.BUDDY_DB_PATH = prevDbPath;
    fs.rmSync(persistRoot, { recursive: true, force: true });
  }
});

test('Auth lifecycle handles stale Bearer/duplicate cookie fallback, cross-origin no-store headers, idempotent logout, and re-login', async () => {
  const vercelOrigin = 'https://buddy-ai-agent-3103-8arqyh10d-om-d8c9.vercel.app';
  const email = `auth_cycle_${Date.now()}@example.com`;

  // 1. Register -> verify no-store headers & CORS credentials
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: vercelOrigin,
      'X-Requested-With': 'BuddyElderAI',
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({
      name: 'Kiran Joshi',
      email,
      password: 'StrongPassword#1',
      role: 'senior',
      language: 'en',
    }),
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.headers.get('access-control-allow-origin'), vercelOrigin);
  assert.equal(regRes.headers.get('access-control-allow-credentials'), 'true');
  assert.ok((regRes.headers.get('cache-control') || '').includes('no-store'));

  const regCookie = (regRes.headers.get('set-cookie') || '').split(';')[0];
  const regBody = (await regRes.json()) as { token: string };
  assert.ok(regCookie.startsWith('buddy_session='));
  assert.ok(regBody.token.length > 20);

  // 2. Stale Bearer token + valid buddy_session cookie falls back cleanly without clearing the valid cookie
  const fallbackRes = await fetch(`${baseUrl}/api/settings`, {
    headers: {
      Origin: vercelOrigin,
      Authorization: 'Bearer stale-expired-token-value',
      Cookie: regCookie,
    },
  });
  assert.equal(fallbackRes.status, 200);
  assert.equal(fallbackRes.headers.get('set-cookie'), null);

  // 3. Duplicate cookie header where an old cookie precedes/follows the valid cookie resolves to valid session
  const dupCookieSession = await fetch(`${baseUrl}/api/auth/session`, {
    headers: {
      Origin: vercelOrigin,
      Cookie: `buddy_session=old-stale-cookie; ${regCookie}; buddy_session=another-stale-cookie`,
    },
  });
  assert.equal(dupCookieSession.status, 200);
  assert.ok((dupCookieSession.headers.get('cache-control') || '').includes('no-store'));
  const dupSessionData = (await dupCookieSession.json()) as { authenticated: boolean; user: { email: string } };
  assert.equal(dupSessionData.authenticated, true);
  assert.equal(dupSessionData.user.email, email);

  // 4. Logout invalidates session, clears cookie, and subsequent logout is idempotent (200)
  const logout1 = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Origin: vercelOrigin,
      'X-Requested-With': 'BuddyElderAI',
      Authorization: `Bearer ${regBody.token}`,
      Cookie: regCookie,
    },
  });
  assert.equal(logout1.status, 200);
  assert.ok((logout1.headers.get('set-cookie') || '').includes('Max-Age=0'));

  const afterLogoutProtected = await fetch(`${baseUrl}/api/ai/conversations`, {
    headers: { Origin: vercelOrigin, Cookie: regCookie },
  });
  assert.equal(afterLogoutProtected.status, 401);

  const logout2 = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Origin: vercelOrigin,
      'X-Requested-With': 'BuddyElderAI',
      Cookie: regCookie,
    },
  });
  assert.equal(logout2.status, 200);

  // 5. Re-login issues a fresh valid session & works across protected features
  const reloginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: vercelOrigin,
      'X-Requested-With': 'BuddyElderAI',
    },
    body: JSON.stringify({ email, password: 'StrongPassword#1' }),
  });
  assert.equal(reloginRes.status, 200);
  const reloginBody = (await reloginRes.json()) as { token: string };
  const notifRes = await fetch(`${baseUrl}/api/notifications`, {
    headers: {
      Origin: vercelOrigin,
      Authorization: `Bearer ${reloginBody.token}`,
    },
  });
  assert.equal(notifRes.status, 200);
});

test('Frontend apiRequest ignores stale pre-login 401s while notifying on active-session 401s', async () => {
  const { apiRequest, setAuthToken, setOnUnauthorizedHandler, ApiError } = await import('../src/lib/api.ts');
  const originalFetch = globalThis.fetch;
  const unauthorizedMessages: string[] = [];

  try {
    setAuthToken('old-token-1');
    setOnUnauthorizedHandler((msg) => {
      unauthorizedMessages.push(msg);
    });

    // Simulate a slow request started under old-token-1 while the user signs in with new-token-2
    let resolveSlowFetch!: (res: Response) => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveSlowFetch = resolve;
      })) as typeof fetch;

    const staleRequestPromise = apiRequest('/api/notifications');
    setAuthToken('new-token-2');
    resolveSlowFetch(
      new Response(JSON.stringify({ error: 'Session not found or expired. Please sign in again.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await assert.rejects(() => staleRequestPromise, (err: unknown) => err instanceof ApiError && err.status === 401);
    assert.equal(unauthorizedMessages.length, 0);

    // An active-session 401 under current token SHOULD invoke onUnauthorizedHandler
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'Session not found or expired. Please sign in again.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;

    await assert.rejects(() => apiRequest('/api/notifications'), (err: unknown) => err instanceof ApiError && err.status === 401);
    assert.equal(unauthorizedMessages.length, 1);
    assert.ok(unauthorizedMessages[0].includes('Session not found'));
  } finally {
    setOnUnauthorizedHandler(null);
    setAuthToken(null);
    globalThis.fetch = originalFetch;
  }
});

test('JWT signing, verification, tampered/expired rejection, browser-refresh Bearer hydration, and multi-feature session flow', async () => {
  const { signAuthJwt, verifyAuthJwt, hashToken } = await import('../server/auth.ts');
  const { getDb } = await import('../server/db.ts');
  const crypto = await import('node:crypto');

  const email = `jwt_flow_${Date.now()}@example.com`;
  const password = 'ValidPassword#2026';

  // 1. Register -> receives 3-part HS256 JWT with valid claims & signature
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BuddyElderAI',
    },
    body: JSON.stringify({
      name: 'Ramesh Nair',
      email,
      password,
      role: 'senior',
      language: 'en',
    }),
  });
  assert.equal(regRes.status, 201);
  const regJson = (await regRes.json()) as { token: string; user: { id: string; email: string; role: string } };
  const parts = regJson.token.split('.');
  assert.equal(parts.length, 3);

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as { alg: string; typ: string };
  assert.equal(header.alg, 'HS256');
  assert.equal(header.typ, 'JWT');

  const verified = verifyAuthJwt(regJson.token);
  assert.equal(verified.valid, true);
  if (verified.valid) {
    assert.equal(verified.payload.sub, regJson.user.id);
    assert.equal(verified.payload.email, email);
    assert.equal(verified.payload.role, 'senior');
    assert.ok(verified.payload.jti.length > 10);
    assert.ok(verified.payload.exp > verified.payload.iat);
  }

  // 2. Wrong password returns 401 Invalid email or password without breaking existing user credentials
  const wrongPwRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BuddyElderAI',
    },
    body: JSON.stringify({ email, password: 'WrongPassword123' }),
  });
  assert.equal(wrongPwRes.status, 401);
  const wrongPwJson = (await wrongPwRes.json()) as { error: string };
  assert.equal(wrongPwJson.error, 'Invalid email or password.');

  // Valid login succeeds right after failed password attempt
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'BuddyElderAI',
    },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(loginRes.status, 200);
  const loginCookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
  const loginJson = (await loginRes.json()) as { token: string };

  // 3. Browser refresh flow: /api/auth/session with cookie returns JWT so client rehydrates Bearer auth
  const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: loginCookie },
  });
  assert.equal(sessionRes.status, 200);
  const sessionJson = (await sessionRes.json()) as { authenticated: boolean; token?: string; user: { id: string } };
  assert.equal(sessionJson.authenticated, true);
  assert.equal(sessionJson.token, loginJson.token);
  assert.equal(sessionJson.user.id, regJson.user.id);

  // 4. Unauthenticated request returns 401; multi-feature access succeeds using ONLY Authorization: Bearer <JWT> (no cookies)
  const unauthRes = await fetch(`${baseUrl}/api/settings`);
  assert.equal(unauthRes.status, 401);

  const bearerHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionJson.token}`,
  };

  const featureGets = [
    '/api/settings',
    '/api/ai/status',
    '/api/ai/conversations',
    '/api/checkins',
    '/api/lessons',
    '/api/reminders',
    '/api/notifications',
    '/api/scam/history',
    '/api/permissions',
    '/api/messaging/onboarding',
    '/api/senior/contacts',
  ];
  for (const endpoint of featureGets) {
    const featureRes: Response = await fetch(`${baseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${sessionJson.token}` },
    });
    assert.equal(featureRes.status, 200, `Expected 200 for ${endpoint}, got ${featureRes.status}`);
  }

  // Create AI conversation & check-in & scam check in one continuous session
  const convRes = await fetch(`${baseUrl}/api/ai/conversations`, {
    method: 'POST',
    headers: bearerHeaders,
    body: JSON.stringify({ title: 'JWT Session Check' }),
  });
  assert.equal(convRes.status, 201);

  const scamRes = await fetch(`${baseUrl}/api/scam/analyze`, {
    method: 'POST',
    headers: bearerHeaders,
    body: JSON.stringify({ content: 'Share your bank OTP immediately or account blocked', inputType: 'sms' }),
  });
  assert.equal(scamRes.status, 200);

  // 5. Tampered JWT (wrong signature / altered payload) is rejected with 401
  const tamperedPayload = Buffer.from(
    JSON.stringify({
      sub: regJson.user.id,
      email,
      role: 'admin',
      jti: 'forged-jti',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url');
  const forgedJwt = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  const forgedRes = await fetch(`${baseUrl}/api/settings`, {
    headers: { Authorization: `Bearer ${forgedJwt}` },
  });
  assert.equal(forgedRes.status, 401);

  // 6. Expired JWT is rejected with 401 Session expired and cleans up matching session row
  const expiredSessionId = crypto.randomUUID();
  const expiredJwt = signAuthJwt({
    sub: regJson.user.id,
    email,
    role: 'senior',
    jti: expiredSessionId,
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 60,
  });
  getDb()
    .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(
      expiredSessionId,
      regJson.user.id,
      hashToken(expiredJwt),
      new Date(Date.now() + 3600_000).toISOString(),
      new Date().toISOString()
    );

  const expiredJwtRes = await fetch(`${baseUrl}/api/settings`, {
    headers: { Authorization: `Bearer ${expiredJwt}` },
  });
  assert.equal(expiredJwtRes.status, 401);
  const expiredJwtJson = (await expiredJwtRes.json()) as { code: string; error: string };
  assert.equal(expiredJwtJson.code, 'SESSION_EXPIRED');

  const remainingExpired = getDb()
    .prepare(`SELECT COUNT(*) AS cnt FROM sessions WHERE token_hash = ?`)
    .get(hashToken(expiredJwt)) as { cnt: number };
  assert.equal(remainingExpired.cnt, 0);
});




