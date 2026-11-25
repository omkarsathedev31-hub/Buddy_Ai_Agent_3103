import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-gemini-test-'));
process.env.BUDDY_DB_PATH = path.join(tmpDir, 'test.db');
delete process.env.GOOGLE_GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_MODEL;
delete process.env.ADMIN_PASSCODE;

const { applyEnvFiles, normalizeApiKey, getGeminiKeyInfo, resolveEnvDirectory, validateGeminiStartupConfig } = await import('../server/env.ts');
const {
  FRIENDLY_AI_BUSY_MESSAGE,
  FRIENDLY_AI_QUOTA_MESSAGE,
  buildBuddyChatConfig,
  classifyGeminiError,
  clearModelDiscoveryCacheForTests,
  filterAndRankGeminiChatModels,
  generateBuddyReply,
  getRetryDelayMs,
  supportsThinkingLevel,
} = await import('../server/ai.ts');
const { runGeminiDiagnostics } = await import('../server/ai-diagnostics.ts');
const { createApp } = await import('../server/app.ts');
const { resetDbForTests } = await import('../server/db.ts');

// ---------- Fake keys (never real) ----------
const KEY_GOOD = 'AIzaGOODKEYGOODKEYGOODKEYGOODKEYGOOD1';
const KEY_BAD = 'AIzaBADKEYBADKEYBADKEYBADKEYBADKEYBAD2';
const KEY_RESTRICTED = 'AIzaRESTRICTEDRESTRICTEDRESTRICTED3333';
const KEY_QUOTA = 'AIzaQUOTAQUOTAQUOTAQUOTAQUOTAQUOTA44';
const ALL_FAKE_KEYS = [KEY_GOOD, KEY_BAD, KEY_RESTRICTED, KEY_QUOTA];

// ---------- Mock Gemini server ----------
let missingModel = false;
let failingModels: Record<string, { status: number; body: Record<string, unknown> }> = {};
let transientFailCounts: Record<string, { remaining: number; status: number; body: Record<string, unknown> }> = {};
let mockListedModels: Array<{ name: string; supportedActions?: string[] }> = [
  { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
  { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
];
let modelCalls: string[] = [];
const mock = http.createServer((req, res) => {
  let bodyText = '';
  req.on('data', (c) => (bodyText += c));
  req.on('end', () => handle(req, res, bodyText));
});

function handle(req: http.IncomingMessage, res: http.ServerResponse, bodyText: string) {
  const key = String(req.headers['x-goog-api-key'] ?? '');
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const url = req.url ?? '';
  const isGenerate = req.method === 'POST' && url.includes(':generateContent');
  const matchedModel = /\/models\/([^/:?]+)/.exec(url)?.[1];
  if (isGenerate && matchedModel) {
    modelCalls.push(matchedModel);
  }
  if (key === KEY_BAD) {
    return send(400, {
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
      },
    });
  }
  if (key === KEY_RESTRICTED) {
    return send(403, {
      error: {
        code: 403,
        message: 'Requests to this API are blocked.',
        status: 'PERMISSION_DENIED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_SERVICE_BLOCKED' }],
      },
    });
  }
  if (key === KEY_QUOTA && isGenerate) {
    return send(429, {
      error: {
        code: 429,
        message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0',
        status: 'RESOURCE_EXHAUSTED',
      },
    });
  }
  if (isGenerate && matchedModel && transientFailCounts[matchedModel] && transientFailCounts[matchedModel].remaining > 0) {
    const spec = transientFailCounts[matchedModel];
    spec.remaining -= 1;
    return send(spec.status, spec.body);
  }
  if (isGenerate && matchedModel && failingModels[matchedModel]) {
    const failSpec = failingModels[matchedModel];
    return send(failSpec.status, failSpec.body);
  }
  if (isGenerate) {
    // Echo what Gemini received, so tests can prove replies are not hardcoded and history is sent.
    let turns = 0;
    let lastText = '';
    try {
      const parsed = JSON.parse(bodyText) as { contents?: Array<{ role?: string; parts?: Array<{ text?: string }> }> | string };
      if (Array.isArray(parsed.contents)) {
        turns = parsed.contents.length;
        lastText = parsed.contents[parsed.contents.length - 1]?.parts?.[0]?.text ?? '';
      }
    } catch {
      /* ignore */
    }
    return send(200, {
      candidates: [
        {
          finishReason: 'STOP',
          content: {
            role: 'model',
            parts: [{ text: JSON.stringify({ reply: `ANSWER[turns=${turns}] ${lastText}`, suggestions: ['A follow-up?'] }) }],
          },
        },
      ],
    });
  }
  if (req.method === 'GET' && /\/models\/[^/?]+/.test(url.split('?')[0])) {
    if (missingModel) {
      return send(404, { error: { code: 404, message: 'models/x is not found for API version v1beta', status: 'NOT_FOUND' } });
    }
    return send(200, { name: `models/${matchedModel || 'gemini-3.1-flash-lite'}`, supportedActions: ['generateContent'] });
  }
  if (req.method === 'GET' && url.split('?')[0].endsWith('/models')) {
    return send(200, {
      models: mockListedModels,
    });
  }
  return send(404, { error: { code: 404, message: 'unexpected route', status: 'NOT_FOUND' } });
}

let mockUrl = '';
let appServer: http.Server;
let baseUrl = '';
const logged: string[] = [];
const origWarn = console.warn;
const origError = console.error;
const origInfo = console.info;

test.before(async () => {
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', () => r()));
  mockUrl = `http://127.0.0.1:${(mock.address() as { port: number }).port}`;
  process.env.GOOGLE_GEMINI_BASE_URL = mockUrl;
  const capture = (...a: unknown[]) => logged.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  console.warn = capture;
  console.error = capture;
  console.info = capture;
  const app = createApp();
  await new Promise<void>((r) => {
    appServer = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
      r();
    });
  });
});

test.after(async () => {
  console.warn = origWarn;
  console.error = origError;
  console.info = origInfo;
  await new Promise<void>((r) => appServer.close(() => r()));
  await new Promise<void>((r) => mock.close(() => r()));
  resetDbForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ================= env loading =================
function envDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmpDir, 'env-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('env: a saved .env key beats a stale shell/OS key in development, reporting names only', () => {
  const cwd = envDir({ '.env': 'GOOGLE_GEMINI_API_KEY="NEW_VALUE"\n' });
  const env: NodeJS.ProcessEnv = { GOOGLE_GEMINI_API_KEY: 'STALE_SHELL_VALUE' };
  const report = applyEnvFiles({ cwd, env, preferFiles: true });
  assert.equal(env.GOOGLE_GEMINI_API_KEY, 'NEW_VALUE');
  assert.deepEqual(report.overridden, ['GOOGLE_GEMINI_API_KEY']);
  assert.equal(report.sources.GOOGLE_GEMINI_API_KEY, '.env');
  assert.ok(!JSON.stringify(report).includes('STALE_SHELL_VALUE') && !JSON.stringify(report).includes('NEW_VALUE'));
});

test('env: production/host environment keeps its own value and only flags the conflict', () => {
  const cwd = envDir({ '.env': 'GOOGLE_GEMINI_API_KEY=FILE_VALUE\n' });
  const env: NodeJS.ProcessEnv = { GOOGLE_GEMINI_API_KEY: 'HOST_VALUE' };
  const report = applyEnvFiles({ cwd, env, preferFiles: false });
  assert.equal(env.GOOGLE_GEMINI_API_KEY, 'HOST_VALUE');
  assert.deepEqual(report.conflicts, ['GOOGLE_GEMINI_API_KEY']);
});

test('env: .env.local beats .env, but a placeholder in .env.local never masks a real .env key', () => {
  let cwd = envDir({ '.env': 'GOOGLE_GEMINI_API_KEY=FROM_ENV\n', '.env.local': 'GOOGLE_GEMINI_API_KEY=FROM_LOCAL\n' });
  let env: NodeJS.ProcessEnv = {};
  applyEnvFiles({ cwd, env, preferFiles: true });
  assert.equal(env.GOOGLE_GEMINI_API_KEY, 'FROM_LOCAL');

  cwd = envDir({ '.env': 'GOOGLE_GEMINI_API_KEY=FROM_ENV\n', '.env.local': 'GOOGLE_GEMINI_API_KEY="your-google-gemini-api-key"\n' });
  env = {};
  applyEnvFiles({ cwd, env, preferFiles: true });
  assert.equal(env.GOOGLE_GEMINI_API_KEY, 'FROM_ENV');
});

test('env: ordinary variables keep shell precedence; empty/placeholder inherited values never block files; BOM tolerated', () => {
  const cwd = envDir({ '.env': '\uFEFFGOOGLE_GEMINI_API_KEY=REAL\nPORT=3000\nADMIN_PASSCODE=from-file\n' });
  const env: NodeJS.ProcessEnv = { PORT: '4000', GOOGLE_GEMINI_API_KEY: '', ADMIN_PASSCODE: 'change-me' };
  applyEnvFiles({ cwd, env, preferFiles: true });
  assert.equal(env.PORT, '4000');
  assert.equal(env.GOOGLE_GEMINI_API_KEY, 'REAL');
  assert.equal(env.ADMIN_PASSCODE, 'from-file');
});

test('env: pasted keys are normalized (quotes, prefix, whitespace, zero-width chars) and key info never exposes the key', () => {
  assert.equal(normalizeApiKey(`  "${KEY_GOOD}"\n`), KEY_GOOD);
  assert.equal(normalizeApiKey(`GOOGLE_GEMINI_API_KEY=${KEY_GOOD}`), KEY_GOOD);
  assert.equal(normalizeApiKey(`GEMINI_API_KEY=${KEY_GOOD}`), KEY_GOOD);
  assert.equal(normalizeApiKey(`Bearer ${KEY_GOOD}`), KEY_GOOD);
  assert.equal(normalizeApiKey(`\u200B${KEY_GOOD}\uFEFF`), KEY_GOOD);
  process.env.GOOGLE_GEMINI_API_KEY = `"${KEY_GOOD}"`;
  const info = getGeminiKeyInfo();
  assert.equal(info.configured, true);
  assert.equal(info.formatIssue, null);
  assert.equal(info.length, KEY_GOOD.length);
  assert.ok(!JSON.stringify(info).includes(KEY_GOOD));
  process.env.GOOGLE_GEMINI_API_KEY = 'AIzaPART1 AIzaPART2PADPADPADPADPAD';
  assert.match(getGeminiKeyInfo().formatIssue ?? '', /whitespace/);
  delete process.env.GOOGLE_GEMINI_API_KEY;
});

test('env: GEMINI_API_KEY configures Gemini directly, takes precedence over GOOGLE_GEMINI_API_KEY, and startup validation reports cleanly', () => {
  delete process.env.GOOGLE_GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const missingStartup = validateGeminiStartupConfig();
  assert.equal(missingStartup.configured, false);
  assert.equal(missingStartup.valid, false);
  assert.match(missingStartup.message, /GEMINI_API_KEY/);

  process.env.GEMINI_API_KEY = KEY_GOOD;
  const infoPrimary = getGeminiKeyInfo();
  assert.equal(infoPrimary.configured, true);
  assert.equal(infoPrimary.varName, 'GEMINI_API_KEY');
  assert.equal(infoPrimary.length, KEY_GOOD.length);
  assert.ok(!JSON.stringify(infoPrimary).includes(KEY_GOOD));

  const okStartup = validateGeminiStartupConfig();
  assert.equal(okStartup.configured, true);
  assert.equal(okStartup.valid, true);
  assert.equal(okStartup.varName, 'GEMINI_API_KEY');
  assert.ok(!okStartup.message.includes(KEY_GOOD));

  process.env.GOOGLE_GEMINI_API_KEY = KEY_BAD;
  assert.equal(getGeminiKeyInfo().varName, 'GEMINI_API_KEY');
  assert.equal(getGeminiKeyInfo().length, KEY_GOOD.length);

  delete process.env.GEMINI_API_KEY;
  assert.equal(getGeminiKeyInfo().configured, true);
  assert.equal(getGeminiKeyInfo().varName, 'GOOGLE_GEMINI_API_KEY');
  delete process.env.GOOGLE_GEMINI_API_KEY;
});

test('env: .env is found from the project root even when the server is launched from another folder', () => {
  const root = envDir({ '.env': 'GOOGLE_GEMINI_API_KEY=ROOT_VALUE\n' });
  const elsewhere = envDir({});
  assert.equal(resolveEnvDirectory([root, elsewhere]), root);
  // falls back to the launch folder only when the project root has no env file
  const emptyRoot = envDir({});
  const launch = envDir({ '.env': 'GOOGLE_GEMINI_API_KEY=LAUNCH_VALUE\n' });
  assert.equal(resolveEnvDirectory([emptyRoot, launch]), launch);
  const env: NodeJS.ProcessEnv = {};
  applyEnvFiles({ cwd: resolveEnvDirectory([root, elsewhere]), env, preferFiles: true });
  assert.equal(env.GOOGLE_GEMINI_API_KEY, 'ROOT_VALUE');
});

test('env: a shell-provided PLACEHOLDER or EMPTY key (e.g. injected by an IDE) never hides the real key in .env', () => {
  const cwd = envDir({ '.env': 'GOOGLE_GEMINI_API_KEY=REAL_VALUE\n' });
  for (const inherited of ['MY_GOOGLE_GEMINI_API_KEY', 'MY_GEMINI_API_KEY', '', '   ', 'your-google-gemini-api-key', 'your-gemini-api-key']) {
    const env: NodeJS.ProcessEnv = { GOOGLE_GEMINI_API_KEY: inherited };
    applyEnvFiles({ cwd, env, preferFiles: false });
    assert.equal(env.GOOGLE_GEMINI_API_KEY, 'REAL_VALUE', `inherited=${JSON.stringify(inherited)}`);
  }
});

// ================= error classification =================
function apiErr(status: number, message: string, gStatus: string, reason?: string) {
  const err = new Error(
    JSON.stringify({
      error: {
        code: status,
        message,
        status: gStatus,
        details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] : undefined,
      },
    })
  ) as Error & { status: number };
  err.name = 'ApiError';
  err.status = status;
  return err;
}

test('classification: distinct real-world Google failures get distinct, accurate results', () => {
  const m = 'gemini-4-hydrogen';
  const c = (e: Error) => classifyGeminiError(e, m);
  assert.equal(c(apiErr(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT', 'API_KEY_INVALID')).upstreamType, 'auth_error');
  assert.equal(c(apiErr(400, 'API key expired. Please renew the API key.', 'INVALID_ARGUMENT', 'API_KEY_INVALID')).upstreamType, 'key_expired');
  assert.equal(c(apiErr(403, 'Your API key was reported as leaked.', 'PERMISSION_DENIED')).upstreamType, 'key_leaked');
  // project number containing "429" must NOT look like a rate limit
  const disabled = c(apiErr(403, 'Generative Language API has not been used in project 429123456 before or it is disabled.', 'PERMISSION_DENIED', 'SERVICE_DISABLED'));
  assert.equal(disabled.code, 'AI_PERMISSION_ERROR');
  assert.equal(disabled.upstreamType, 'service_disabled');
  assert.equal(c(apiErr(403, 'blocked', 'PERMISSION_DENIED', 'API_KEY_SERVICE_BLOCKED')).upstreamType, 'key_restricted');
  assert.equal(c(apiErr(403, 'Permission denied: no access to model gemini-4-hydrogen.', 'PERMISSION_DENIED')).code, 'AI_MODEL_ERROR');
  assert.equal(c(apiErr(404, 'models/x is not found', 'NOT_FOUND')).code, 'AI_MODEL_ERROR');
  assert.equal(c(apiErr(400, 'User location is not supported for the API use.', 'FAILED_PRECONDITION')).upstreamType, 'location_unsupported');
  assert.equal(c(apiErr(400, 'Thinking level is not supported for this model.', 'INVALID_ARGUMENT')).code, 'AI_BAD_REQUEST');
  assert.equal(c(apiErr(429, 'Quota exceeded, limit: 0', 'RESOURCE_EXHAUSTED')).code, 'AI_QUOTA_EXHAUSTED');
  const withDetail = c(apiErr(403, 'x', 'PERMISSION_DENIED', 'API_KEY_SERVICE_BLOCKED'));
  assert.equal(withDetail.upstreamStatus, 403);
  assert.equal(withDetail.geminiErrorCode, 'API_KEY_SERVICE_BLOCKED');
});

// ================= diagnostics against mock Gemini =================
test('diagnostic: healthy key passes every step and never contains the key', async () => {
  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  const report = await runGeminiDiagnostics({ includeFingerprint: true });
  assert.equal(report.ok, true, JSON.stringify(report.steps));
  assert.deepEqual(report.steps.map((s) => s.category), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.ok(!JSON.stringify(report).includes(KEY_GOOD));
});

test('diagnostic: separates invalid key, restricted key, missing model and exhausted quota', async () => {
  process.env.GOOGLE_GEMINI_API_KEY = KEY_BAD;
  let r = await runGeminiDiagnostics();
  assert.equal(r.steps.find((s) => s.id === 'auth')?.category, 'AI_AUTH_ERROR');
  assert.equal(r.steps.find((s) => s.id === 'model')?.category, 'skipped');

  process.env.GOOGLE_GEMINI_API_KEY = KEY_RESTRICTED;
  r = await runGeminiDiagnostics();
  assert.equal(r.steps.find((s) => s.id === 'auth')?.category, 'AI_PERMISSION_ERROR');

  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  missingModel = true;
  r = await runGeminiDiagnostics();
  missingModel = false;
  assert.equal(r.steps.find((s) => s.id === 'auth')?.ok, true);
  assert.equal(r.steps.find((s) => s.id === 'model')?.category, 'AI_MODEL_ERROR');

  process.env.GOOGLE_GEMINI_API_KEY = KEY_QUOTA;
  r = await runGeminiDiagnostics();
  assert.equal(r.steps.find((s) => s.id === 'auth')?.ok, true);
  assert.equal(r.steps.find((s) => s.id === 'generate')?.category, 'AI_QUOTA_EXHAUSTED');

  delete process.env.GOOGLE_GEMINI_API_KEY;
  r = await runGeminiDiagnostics();
  assert.equal(r.steps[0].category, 'MISSING_API_KEY');
  assert.ok(!JSON.stringify(r).includes('AIza'));
});

// ================= full login -> chat flow =================
async function api(urlPath: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { 'X-Requested-With': 'BuddyElderAI' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  const raw = await res.text();
  return { status: res.status, raw, data: JSON.parse(raw) as Record<string, any>, cookie };
}

test('login, session and AI chat work end-to-end with a valid key; failures are precise and secret-free', async () => {
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Test Senior', email: 'gem@example.com', phone: '+919800000099', password: 'password123', role: 'senior', language: 'en' },
  });
  assert.equal(reg.status, 201);
  const cookie = reg.cookie!;
  assert.equal((await api('/api/auth/session', { cookie })).data.authenticated, true);

  const conv = await api('/api/ai/conversations', { method: 'POST', cookie, body: { title: 'Gemini test' } });
  const convId = conv.data.conversation.id as string;
  const send = () => api(`/api/ai/conversations/${convId}/messages`, { method: 'POST', cookie, body: { message: 'How do I restart my phone?', language: 'en' } });

  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  let r = await send();
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.data.reply, r.data.response);
  assert.equal(r.data.conversationId, convId);
  assert.match(String(r.data.response), /^ANSWER\[turns=\d+\] How do I restart my phone\?/);

  // a DIFFERENT question gets a DIFFERENT answer (not hardcoded)
  const q2 = await api(`/api/ai/conversations/${convId}/messages`, { method: 'POST', cookie, body: { message: 'Is this SMS from my bank safe?', language: 'en' } });
  assert.equal(q2.status, 200, q2.raw);
  assert.notEqual(q2.data.response, r.data.response);
  assert.match(String(q2.data.response), /Is this SMS from my bank safe\?/);

  // a follow-up carries earlier turns to Gemini (context is kept)
  const turnsOf = (resp: unknown) => Number(/turns=(\d+)/.exec(String(resp))?.[1]);
  assert.ok(turnsOf(q2.data.response) > turnsOf(r.data.response), 'follow-up must include prior conversation history');

  // conversation is saved and can be reloaded (persistence)
  const saved = await api(`/api/ai/conversations/${convId}/messages`, { cookie });
  assert.equal(saved.status, 200);
  assert.ok((saved.data.messages as unknown[]).length >= 4);

  // a replaced (now invalid) key is reported as an auth problem with upstream detail, no secret
  process.env.GOOGLE_GEMINI_API_KEY = KEY_BAD;
  r = await send();
  assert.equal(r.status, 502);
  assert.equal(r.data.code, 'AI_AUTH_ERROR');
  assert.equal(r.data.upstreamStatus, 400);
  assert.equal(r.data.geminiErrorCode, 'API_KEY_INVALID');

  process.env.GOOGLE_GEMINI_API_KEY = KEY_RESTRICTED;
  r = await send();
  assert.equal(r.data.code, 'AI_PERMISSION_ERROR');

  // swapping back to the good key works immediately (no stale client/key cached)
  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  r = await send();
  assert.equal(r.status, 200);

  // diagnostic endpoint is admin-only
  assert.equal((await api('/api/ai/diagnose', { cookie })).status, 403);
  assert.equal((await api('/api/ai/diagnose')).status, 401);

  // no response body or server log line ever contains any key
  const everything = logged.join('\n') + r.raw;
  for (const k of ALL_FAKE_KEYS) assert.ok(!everything.includes(k), 'API key leaked');
});

test('scam checker still degrades to heuristics when Gemini rejects the key', async () => {
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Scam Tester', email: 'scam@example.com', phone: '+919800000098', password: 'password123', role: 'senior', language: 'en' },
  });
  process.env.GOOGLE_GEMINI_API_KEY = KEY_BAD;
  const r = await api('/api/scam/analyze', {
    method: 'POST',
    cookie: reg.cookie,
    body: { content: 'Your KYC will be blocked. Share OTP now', inputType: 'message', language: 'en' },
  });
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.data.result?.source ?? r.data.source, 'heuristic_fallback');
  delete process.env.GOOGLE_GEMINI_API_KEY;
});

test('generateBuddyReply uses the key currently in the environment on every call', async () => {
  process.env.GOOGLE_GEMINI_API_KEY = KEY_BAD;
  await assert.rejects(() => generateBuddyReply({ history: [], userMessage: 'hi', language: 'en', userName: 'A' }), (e: any) => e.code === 'AI_AUTH_ERROR');
  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  const ok = await generateBuddyReply({ history: [], userMessage: 'hi', language: 'en', userName: 'A' });
  assert.match(ok.reply, /^ANSWER\[turns=\d+\] hi/);
  delete process.env.GOOGLE_GEMINI_API_KEY;
});

test('buildBuddyChatConfig enables thinkingConfig for Gemini 3/4 models and omits it for Gemini 2.5 overrides', () => {
  assert.equal(supportsThinkingLevel('gemini-4-hydrogen'), true);
  assert.equal(supportsThinkingLevel('gemini-3.1-flash-lite'), true);
  assert.equal(supportsThinkingLevel('gemini-2.5-flash'), false);

  const cfg4 = buildBuddyChatConfig('Be helpful', undefined, 'gemini-4-hydrogen');
  assert.ok('thinkingConfig' in cfg4);

  const cfg25 = buildBuddyChatConfig('Be helpful', undefined, 'gemini-2.5-flash');
  assert.equal('thinkingConfig' in cfg25, false);
});

test('model fallback switches to GEMINI_FALLBACK_MODEL on quota/503/404 without duplicate calls, skips fallback on auth errors, and saves user questions before AI failure without duplicating retries', async () => {
  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODEL;

  try {
    // 1. Primary quota exceeded -> automatically switches once to fallback and succeeds
    modelCalls = [];
    failingModels = {
      'gemini-2.5-flash': {
        status: 429,
        body: {
          error: {
            code: 429,
            message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0',
            status: 'RESOURCE_EXHAUSTED',
          },
        },
      },
    };
    const resQuotaFallback = await generateBuddyReply({
      history: [],
      userMessage: 'How do I connect Bluetooth?',
      language: 'en',
      userName: 'Meera',
    });
    assert.equal(resQuotaFallback.model, 'gemini-2.5-flash-lite');
    assert.equal(resQuotaFallback.fallbackUsed, true);
    assert.deepEqual(resQuotaFallback.attemptedModels, ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    assert.deepEqual(modelCalls, ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    assert.match(resQuotaFallback.reply, /How do I connect Bluetooth\?/);

    // 2. Primary 503 temporary service unavailable -> switches ONCE immediately with zero duplicate AI calls
    modelCalls = [];
    failingModels = {
      'gemini-2.5-flash': {
        status: 503,
        body: { error: { code: 503, message: 'Service temporarily overloaded', status: 'UNAVAILABLE' } },
      },
    };
    const res503Fallback = await generateBuddyReply({
      history: [],
      userMessage: 'How do I zoom text?',
      language: 'en',
      userName: 'Meera',
    });
    assert.equal(res503Fallback.model, 'gemini-2.5-flash-lite');
    assert.equal(res503Fallback.fallbackUsed, true);
    assert.deepEqual(modelCalls, ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);

    // 3. Permanent invalid-key error -> NEVER tries fallback model
    modelCalls = [];
    failingModels = {};
    process.env.GOOGLE_GEMINI_API_KEY = KEY_BAD;
    await assert.rejects(
      () =>
        generateBuddyReply({
          history: [],
          userMessage: 'Should not retry fallback',
          language: 'en',
          userName: 'Meera',
        }),
      (err: any) => err.code === 'AI_AUTH_ERROR' && err.fallbackAttempted === false
    );
    assert.deepEqual(modelCalls, ['gemini-2.5-flash']);

    // 4. End-to-end chat route: when BOTH primary and fallback hit daily quota,
    // user question is STILL saved in SQLite, friendly elderly message is returned, and retries do not duplicate messages
    process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Fallback Senior',
        email: 'fallback@example.com',
        phone: '+919800000077',
        password: 'password123',
        role: 'senior',
        language: 'en',
      },
    });
    assert.equal(reg.status, 201);
    const cookie = reg.cookie!;
    const conv = await api('/api/ai/conversations', { method: 'POST', cookie, body: { title: 'Fallback test' } });
    const convId = conv.data.conversation.id as string;

    failingModels = {
      'gemini-2.5-flash': {
        status: 429,
        body: { error: { code: 429, message: 'Daily quota limit: 0', status: 'RESOURCE_EXHAUSTED' } },
      },
      'gemini-2.5-flash-lite': {
        status: 429,
        body: { error: { code: 429, message: 'Daily quota limit: 0', status: 'RESOURCE_EXHAUSTED' } },
      },
    };

    const failBoth = await api(`/api/ai/conversations/${convId}/messages`, {
      method: 'POST',
      cookie,
      body: { message: 'How do I turn on flashlight?', language: 'en' },
    });
    assert.equal(failBoth.status, 429);
    assert.equal(failBoth.data.code, 'AI_QUOTA_EXHAUSTED');
    assert.equal(failBoth.data.conversationStatus, 'failed');
    assert.equal(failBoth.data.userMessageSaved, true);
    assert.equal(failBoth.data.userMessage?.content, 'How do I turn on flashlight?');
    assert.deepEqual(failBoth.data.attemptedModels, ['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    assert.equal(failBoth.data.error?.message, FRIENDLY_AI_QUOTA_MESSAGE);

    // Verify user question and conversation failed status persisted in DB immediately despite 429 failure
    const afterFailMsgs = await api(`/api/ai/conversations/${convId}/messages`, { cookie });
    assert.equal((afterFailMsgs.data.messages as unknown[]).length, 1);
    assert.equal(afterFailMsgs.data.messages[0].content, 'How do I turn on flashlight?');
    assert.equal(afterFailMsgs.data.conversation?.last_status, 'failed');
    assert.equal(afterFailMsgs.data.conversation?.last_error_code, 'AI_QUOTA_EXHAUSTED');
    assert.equal(afterFailMsgs.data.conversation?.last_error_message, FRIENDLY_AI_QUOTA_MESSAGE);

    // Retry when fallback recovers -> does NOT duplicate user message, appends assistant reply, and clears failure status
    failingModels = {
      'gemini-2.5-flash': {
        status: 429,
        body: { error: { code: 429, message: 'Daily quota limit: 0', status: 'RESOURCE_EXHAUSTED' } },
      },
    };
    const retryRecover = await api(`/api/ai/conversations/${convId}/messages`, {
      method: 'POST',
      cookie,
      body: { message: 'How do I turn on flashlight?', language: 'en' },
    });
    assert.equal(retryRecover.status, 200, retryRecover.raw);
    assert.equal(retryRecover.data.model, 'gemini-2.5-flash-lite');
    assert.equal(retryRecover.data.fallbackUsed, true);
    assert.equal(retryRecover.data.conversationStatus, 'responded');

    const afterRecoverMsgs = await api(`/api/ai/conversations/${convId}/messages`, { cookie });
    assert.equal((afterRecoverMsgs.data.messages as unknown[]).length, 2);
    assert.equal(afterRecoverMsgs.data.messages[0].role, 'user');
    assert.equal(afterRecoverMsgs.data.messages[1].role, 'assistant');
    assert.equal(afterRecoverMsgs.data.conversation?.last_status, 'responded');
    assert.equal(afterRecoverMsgs.data.conversation?.last_error_code, null);
    assert.equal(afterRecoverMsgs.data.conversation?.last_error_message, null);

    // Clear resets conversation status back to idle
    const cleared = await api(`/api/ai/conversations/${convId}/clear`, { method: 'POST', cookie });
    assert.equal(cleared.status, 200);
    const afterClearMsgs = await api(`/api/ai/conversations/${convId}/messages`, { cookie });
    assert.equal((afterClearMsgs.data.messages as unknown[]).length, 0);
    assert.equal(afterClearMsgs.data.conversation?.last_status, 'idle');
  } finally {
    failingModels = {};
    transientFailCounts = {};
    modelCalls = [];
    clearModelDiscoveryCacheForTests();
    delete process.env.GOOGLE_GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test('verified model discovery filters deprecated/non-text models and transient 503 errors recover via discovery and bounded retry', async () => {
  // 1. Model filtering & priority ranking excludes deprecated 1.5/2.0 and non-text models
  const ranked = filterAndRankGeminiChatModels([
    { name: 'models/gemini-1.5-flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-2.0-flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-lite-image', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-tts', supportedActions: ['generateContent'] },
    { name: 'models/gemini-embedding-2', supportedActions: ['embedContent'] },
    { name: 'models/gemini-4-hydrogen', supportedActions: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-lite', supportedActions: ['generateContent'] },
  ]);
  assert.deepEqual(ranked, ['gemini-2.5-flash', 'gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

  // 2. Retry delay respects max retry limit (no infinite loops)
  const transient503Err = Object.assign(
    new Error(JSON.stringify({ error: { code: 503, message: 'Service unavailable', status: 'UNAVAILABLE' } })),
    { status: 503 }
  );
  assert.ok((getRetryDelayMs(transient503Err, 1) ?? 0) >= 600);
  assert.ok((getRetryDelayMs(transient503Err, 2) ?? 0) >= 1200);
  assert.equal(getRetryDelayMs(transient503Err, 3), null);

  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODEL;

  try {
    // 3. When primary + configured fallback both hit 503 UNAVAILABLE, verified model discovery
    // routes cleanly to an available listed model (gemini-4-hydrogen)
    clearModelDiscoveryCacheForTests();
    modelCalls = [];
    mockListedModels = [
      { name: 'models/gemini-1.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
      { name: 'models/gemini-4-hydrogen', supportedActions: ['generateContent'] },
    ];
    failingModels = {
      'gemini-2.5-flash': {
        status: 503,
        body: { error: { code: 503, message: 'High demand', status: 'UNAVAILABLE' } },
      },
      'gemini-2.5-flash-lite': {
        status: 503,
        body: { error: { code: 503, message: 'High demand', status: 'UNAVAILABLE' } },
      },
    };

    const recoveredViaDiscovery = await generateBuddyReply({
      history: [],
      userMessage: 'How do I turn up volume?',
      language: 'en',
      userName: 'Asha',
    });
    assert.equal(recoveredViaDiscovery.model, 'gemini-4-hydrogen');
    assert.equal(recoveredViaDiscovery.fallbackUsed, true);
    assert.deepEqual(recoveredViaDiscovery.attemptedModels, [
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-4-hydrogen',
    ]);

    // 4. When all candidates transiently return 503 once, bounded exponential backoff + jitter
    // recovers cleanly on retry without an infinite loop
    clearModelDiscoveryCacheForTests();
    failingModels = {};
    modelCalls = [];
    mockListedModels = [
      { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
    ];
    transientFailCounts = {
      'gemini-2.5-flash': {
        remaining: 1,
        status: 503,
        body: { error: { code: 503, message: 'Temporary overload', status: 'UNAVAILABLE' } },
      },
      'gemini-2.5-flash-lite': {
        remaining: 1,
        status: 503,
        body: { error: { code: 503, message: 'Temporary overload', status: 'UNAVAILABLE' } },
      },
    };

    const recoveredViaRetry = await generateBuddyReply({
      history: [],
      userMessage: 'How do I check missed calls?',
      language: 'en',
      userName: 'Asha',
    });
    assert.equal(recoveredViaRetry.fallbackUsed, true);
    assert.ok(recoveredViaRetry.retryCount >= 2);
    assert.ok(modelCalls.length === 3);
  } finally {
    failingModels = {};
    transientFailCounts = {};
    mockListedModels = [
      { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
    ];
    modelCalls = [];
    clearModelDiscoveryCacheForTests();
    delete process.env.GOOGLE_GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test('non-existent or deprecated model overrides (e.g. gemini-3.5-flash, gemini-2.0-flash) are rejected so 503 failover never triggers 404 NOT_FOUND', async () => {
  const { getAiStatus, getCandidateGeminiModels, normalizeGeminiModelName, normalizeFallbackGeminiModel } =
    await import('../server/ai.ts');

  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
  process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash';

  try {
    assert.equal(normalizeFallbackGeminiModel('gemini-3.5-flash', 'gemini-3.1-flash-lite').invalidOverride, true);
    assert.equal(normalizeFallbackGeminiModel('gemini-3.5-flash', 'gemini-3.1-flash-lite').model, 'gemini-2.5-flash');
    assert.equal(normalizeGeminiModelName('gemini-3.8-flash').invalidOverride, true);
    assert.equal(normalizeGeminiModelName('gemini-3.8-flash').model, 'gemini-2.5-flash');
    assert.equal(normalizeGeminiModelName('gemini-2.0-flash').invalidOverride, true);
    assert.equal(normalizeGeminiModelName('gemini-1.5-flash').model, 'gemini-2.5-flash');

    const status = getAiStatus();
    assert.equal(status.model, 'gemini-3.1-flash-lite');
    assert.equal(status.fallbackModel, 'gemini-2.5-flash');
    assert.ok(status.fallbackModelWarning);
    assert.deepEqual(getCandidateGeminiModels(), ['gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-4-hydrogen']);

    modelCalls = [];
    failingModels = {
      'gemini-3.1-flash-lite': {
        status: 503,
        body: { error: { code: 503, message: 'High demand', status: 'UNAVAILABLE' } },
      },
    };
    const recovered = await generateBuddyReply({
      history: [],
      userMessage: 'How do I check my messages?',
      language: 'en',
      userName: 'Meera',
    });
    assert.equal(recovered.model, 'gemini-2.5-flash');
    assert.equal(recovered.fallbackUsed, true);
    assert.deepEqual(modelCalls, ['gemini-3.1-flash-lite', 'gemini-2.5-flash']);
    assert.equal(modelCalls.includes('gemini-3.5-flash'), false);
  } finally {
    failingModels = {};
    modelCalls = [];
    clearModelDiscoveryCacheForTests();
    delete process.env.GOOGLE_GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});

test('caches 404 NOT_FOUND models, promotes verified working discovered model, and keeps retrying remaining 503 targets when another hits quota', async () => {
  process.env.GOOGLE_GEMINI_API_KEY = KEY_GOOD;
  process.env.GEMINI_MODEL = 'gemini-2.5-flash';
  process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';

  try {
    // 1. First request encounters 503 on primary, 404 NOT_FOUND on unverified fallback & speculative 4-hydrogen,
    //    discovers gemini-3-flash-preview, and succeeds.
    clearModelDiscoveryCacheForTests();
    modelCalls = [];
    mockListedModels = [
      { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-3-flash-preview', supportedActions: ['generateContent'] },
    ];
    failingModels = {
      'gemini-2.5-flash': {
        status: 503,
        body: { error: { code: 503, message: 'High demand', status: 'UNAVAILABLE' } },
      },
      'gemini-3.1-flash-lite': {
        status: 404,
        body: { error: { code: 404, message: 'models/gemini-3.1-flash-lite is not found', status: 'NOT_FOUND' } },
      },
      'gemini-4-hydrogen': {
        status: 404,
        body: { error: { code: 404, message: 'models/gemini-4-hydrogen is not found', status: 'NOT_FOUND' } },
      },
    };

    const first = await generateBuddyReply({
      history: [],
      userMessage: 'How do I make text bigger?',
      language: 'en',
      userName: 'Meera',
    });
    assert.equal(first.model, 'gemini-3-flash-preview');
    assert.equal(first.fallbackUsed, true);
    assert.deepEqual(modelCalls, [
      'gemini-2.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-4-hydrogen',
      'gemini-3-flash-preview',
    ]);

    // 2. Subsequent request immediately uses promoted working discovered model (1 call, zero 404/503 errors)
    modelCalls = [];
    const second = await generateBuddyReply({
      history: [],
      userMessage: 'How do I adjust brightness?',
      language: 'en',
      userName: 'Meera',
    });
    assert.equal(second.model, 'gemini-3-flash-preview');
    assert.deepEqual(modelCalls, ['gemini-3-flash-preview']);

    // 3. Phase 2 retry: if one transient target hits AI_QUOTA_EXHAUSTED on retry, continue retrying remaining 503 target
    clearModelDiscoveryCacheForTests();
    delete process.env.GEMINI_FALLBACK_MODEL;
    mockListedModels = [
      { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
    ];
    modelCalls = [];
    failingModels = {};
    transientFailCounts = {
      'gemini-2.5-flash': {
        remaining: 2, // fails in Phase 1 and on retry attempt 2 -> wait: retry attempt 1 hits lite, retry attempt 2 hits flash
        status: 503,
        body: { error: { code: 503, message: 'Temporary overload', status: 'UNAVAILABLE' } },
      },
      'gemini-2.5-flash-lite': {
        remaining: 1,
        status: 503,
        body: { error: { code: 503, message: 'Temporary overload', status: 'UNAVAILABLE' } },
      },
    };
    const phase2Recovered = await generateBuddyReply({
      history: [],
      userMessage: 'How do I check missed calls?',
      language: 'en',
      userName: 'Meera',
    });
    assert.equal(phase2Recovered.model, 'gemini-2.5-flash-lite');

    // 4. Error prioritization: valid 503 model failure beats fallback 404 AI_MODEL_ERROR
    clearModelDiscoveryCacheForTests();
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-3.1-flash-lite';
    mockListedModels = [];
    modelCalls = [];
    transientFailCounts = {};
    failingModels = {
      'gemini-2.5-flash': {
        status: 503,
        body: { error: { code: 503, message: 'Temporary overload', status: 'UNAVAILABLE' } },
      },
      'gemini-3.1-flash-lite': {
        status: 404,
        body: { error: { code: 404, message: 'models/gemini-3.1-flash-lite is not found', status: 'NOT_FOUND' } },
      },
      'gemini-4-hydrogen': {
        status: 404,
        body: { error: { code: 404, message: 'models/gemini-4-hydrogen is not found', status: 'NOT_FOUND' } },
      },
    };
    await assert.rejects(
      () =>
        generateBuddyReply({
          history: [],
          userMessage: 'Test priority',
          language: 'en',
          userName: 'Meera',
        }),
      (err: any) =>
        err.code === 'UPSTREAM_ERROR' &&
        err.statusCode === 503 &&
        err.message === FRIENDLY_AI_BUSY_MESSAGE
    );

    // 5. Distinct user-friendly error messages are preserved (not collapsed to generic busy message)
    clearModelDiscoveryCacheForTests();
    mockListedModels = [];
    failingModels = {
      'gemini-2.5-flash': {
        status: 504,
        body: { error: { code: 504, message: 'Deadline exceeded', status: 'DEADLINE_EXCEEDED' } },
      },
      'gemini-3.1-flash-lite': {
        status: 504,
        body: { error: { code: 504, message: 'Deadline exceeded', status: 'DEADLINE_EXCEEDED' } },
      },
      'gemini-4-hydrogen': {
        status: 504,
        body: { error: { code: 504, message: 'Deadline exceeded', status: 'DEADLINE_EXCEEDED' } },
      },
    };
    await assert.rejects(
      () =>
        generateBuddyReply({
          history: [],
          userMessage: 'Test timeout message',
          language: 'en',
          userName: 'Meera',
        }),
      (err: any) =>
        err.code === 'AI_TIMEOUT' &&
        err.message.includes('too long') &&
        err.message !== FRIENDLY_AI_BUSY_MESSAGE
    );

    clearModelDiscoveryCacheForTests();
    failingModels = {
      'gemini-2.5-flash': {
        status: 429,
        body: { error: { code: 429, message: 'Rate limit exceeded. Please retry in 12s', status: 'RESOURCE_EXHAUSTED' } },
      },
      'gemini-3.1-flash-lite': {
        status: 429,
        body: { error: { code: 429, message: 'Rate limit exceeded. Please retry in 12s', status: 'RESOURCE_EXHAUSTED' } },
      },
      'gemini-4-hydrogen': {
        status: 429,
        body: { error: { code: 429, message: 'Rate limit exceeded. Please retry in 12s', status: 'RESOURCE_EXHAUSTED' } },
      },
    };
    await assert.rejects(
      () =>
        generateBuddyReply({
          history: [],
          userMessage: 'Test rate limit message',
          language: 'en',
          userName: 'Meera',
        }),
      (err: any) =>
        err.code === 'AI_RATE_LIMIT' &&
        err.retryAfterSeconds === 12 &&
        err.message.includes('12 seconds') &&
        err.message !== FRIENDLY_AI_BUSY_MESSAGE
    );
  } finally {
    failingModels = {};
    transientFailCounts = {};
    mockListedModels = [
      { name: 'models/gemini-2.5-flash', supportedActions: ['generateContent'] },
      { name: 'models/gemini-2.5-flash-lite', supportedActions: ['generateContent'] },
    ];
    modelCalls = [];
    clearModelDiscoveryCacheForTests();
    delete process.env.GOOGLE_GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
  }
});


