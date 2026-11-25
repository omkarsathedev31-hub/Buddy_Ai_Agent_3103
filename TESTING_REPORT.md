# Testing Report — Buddy Elder AI

## Summary
- **Integration & Unit Test Suite (`npx tsx --test tests/api.test.ts`)**: PASSED (8 test suites, 0 failures — covering 16 full-stack API workflow stages, Vercel serverless handler, AI Buddy model validation & payload/error parsing, frontend `apiRequest` HTML/JSON/`Retry-After` resilience, runtime scam fallback, API base URL guards, Gemini `429` transient vs daily-quota classification + bounded backoff guard, and Express user-keyed independent `createRateLimiter` buckets).
- **Clean `npm install` Dependency Resolution (`npm install --package-lock-only` & `bun audit`)**: PASSED (0 `ERESOLVE` conflicts, 0 vulnerabilities).
- **TypeScript Type Check (`npm run lint` / `tsc --noEmit`)**: PASSED (0 errors).
- **Production Bundle (`npm run build` / `vite build`)**: PASSED (built cleanly in `dist/` with zero config warnings).
- **Dev Server Health & Live Verification (`http://127.0.0.1:3000`)**: PASSED (`GET /api/health` -> HTTP `200`, SQLite durable `true`, `ai.configured: true`, `ai.model: gemini-4-hydrogen` with invalid `GEMINI_MODEL` override safely ignored and never exposed; live `POST /api/ai/conversations/:id/messages` reached Gemini with configured model `gemini-4-hydrogen` and surfaced structured HTTP `429 AI_QUOTA_EXHAUSTED` with `rateLimitSource: 'gemini_provider'`, `quotaExhausted: true`, `Retry-After` header `83188`, while `POST /api/scam/analyze` remained independent and returned HTTP `200` `RED` with `heuristic_fallback`).

## Verified Workflows in `tests/api.test.ts`
1. **Unauthenticated Guard**: `/api/checkins` rejected with HTTP `401` without session cookie or Bearer token.
2. **Registration, Session Persistence, Phone E.164 Validation & Invalid Login**: Senior and Caregiver accounts created (`201`), cookie + Bearer auth verified via `/api/auth/session` and `/api/settings`, unsafe/malformed phone inputs (`javascript:alert(1)`, missing `+` country code) rejected (`400`), formatted numbers normalized (`+91 98000-00001` -> `+919800000001`), wrong password rejected (`401`).
3. **RBAC Isolation**: Senior blocked from `/api/admin/overview` (`403`).
4. **Admin Passcode Config, Claim & Login Guards**:
   - With `ADMIN_PASSCODE` unset and unclaimed, `POST /api/auth/admin/login` returns explicit HTTP `503` (`ADMIN_PASSCODE_MISSING`).
   - First-run admin claim succeeds (`201`); second claim attempt rejected (`403`).
   - Attempting admin login with a non-admin user email returns `403` (instead of a SQLite constraint `500`); wrong passcode returns `401`; valid passcode returns `200`.
5. **Messaging Number Validation & Error Reporting**:
   - Missing messaging number blocks `user_confirmed` onboarding with HTTP `503` (`MESSAGING_NUMBER_MISSING`).
   - Missing `+` country code in `PUT /api/admin/messaging-config` rejected (`400`).
   - Formatted international number is normalized cleanly to E.164 (`+14155238886`).
6. **Daily Check-in & Same-Day Deduplication**: Second check-in on same day updated existing record (`updated: true`, 1 row in history) and generated a caregiver alert.
7. **Family Permission Enforcement & Payload Sanitization**: Caregiver linked via invite code; `minimal` sharing hides `wellnessSummary` and `mood`; after caregiver request + senior approval (`full`), both become visible; `PUT /api/permissions/links/:linkId` strips arbitrary/unknown properties before storing; revoking access immediately drops linked seniors to `0`.
8. **Is This Safe? Scam Detection & Runtime Fallback**:
   - Empty input returns standardized `400` (`INVALID_INPUT`).
   - Screenshot EMAIL input (`Your bank account will be blocked today. Click this link immediately to update your KYC.`), SMS scam (`AnyDesk` + `OTP` + `bit.ly`), WhatsApp urgent money request, suspicious URL (`.xyz` + `kyc`), unknown international phone (`YELLOW`), suspicious account-suspension email (`RED`), and safe family SMS (`GREEN`) all returned distinct explanations, matched indicators, tailored actions, and persisted in `scam_assessments`.
   - Runtime AI provider failures (`AI_AUTH_ERROR`, `AI_RATE_LIMIT`, `AI_QUOTA_EXHAUSTED`, timeout) cleanly degrade to `source: 'heuristic_fallback'` with valid JSON instead of crashing or returning HTML.
9. **AI Buddy Contract, Model Validation, Rate-Limit Handling & Error Classification**:
   - Unmatched `/api/*` endpoints return JSON `404`; `/api/ai/conversations` creates and lists conversations cleanly.
   - `normalizeGeminiModelName` / `getConfiguredGeminiModel` validate `GEMINI_MODEL` overrides, fall back to `gemini-4-hydrogen` on malformed/token-like values without exposing raw env strings in `/api/health` or `/api/ai/status`, respect valid model overrides verbatim (`gemini-2.5-flash`), and normalize history turn alternation before calling Gemini.
   - Empty messages return structured JSON `400` (`INVALID_INPUT`); missing conversations return JSON `404` (`CONVERSATION_NOT_FOUND`); unset `GOOGLE_GEMINI_API_KEY` returns JSON `503` (`{ success: false, code: 'MISSING_API_KEY', error: { code, message } }`).
   - `parseBuddyModelPayload` cleanly parses standard JSON, markdown-fenced ```` ```json ```` responses, and plain-text prose fallbacks while throwing `AI_EMPTY_RESPONSE` on empty payloads.
   - `classifyGeminiError` and `getRetryDelayMs` distinguish transient `429` (`AI_RATE_LIMIT`, `Retry-After` parsing, bounded 2-attempt backoff only when `Retry-After <= 5s`) from daily quota exhaustion (`AI_QUOTA_EXHAUSTED`, `quotaExhausted: true`, never retried), plus `404`/`NOT_FOUND` -> `AI_MODEL_ERROR`, `503`/`UNAVAILABLE` -> `503`, `ETIMEDOUT` -> `AI_TIMEOUT`, `401`/`403`/`API_KEY_INVALID` -> `AI_AUTH_ERROR`, and `fetch failed` -> `AI_NETWORK_ERROR`.
10. **Express Rate Limiter Isolation**:
    - `createRateLimiter` separates `authLimiter` (IP-keyed, 30/min), `chatLimiter` (user-keyed, 20/min), and `scamLimiter` (user-keyed, 30/min), sets HTTP `Retry-After`, returns `BACKEND_RATE_LIMIT` with `rateLimitSource: 'express_limiter'`, isolates shared-IP household users, and ensures AI Buddy rate limits never block Is This Safe?.
11. **Frontend `apiRequest` HTML, JSON & `Retry-After` Resilience**:
    - HTML responses returned with HTTP `200` (SPA/proxy fallback) throw diagnostic `ApiError` (`INVALID_RESPONSE`).
    - Nested `{ success: false, error: { code, message } }` payloads extract `code`, `message`, `retryAfterSeconds` (including HTTP `Retry-After` header), `rateLimitSource`, and `quotaExhausted`.
    - Standardized `{ success: true, response, conversationId }` responses resolve cleanly.
12. **Digital Education Persistence**: Saving all steps for `smartphone-basics` persisted `isCompleted: true` and updated `completedCount: 1`.
13. **Reminders Delivery & Retry**: Scheduled reminder -> simulated delivery failure (`failed`, `retry_count: 1`) -> retried delivery (`sent`) -> senior acknowledged (`acknowledged`).
14. **Messaging Onboarding & CLI**: Browser attempt to set `backend_verified` directly rejected (`403`); senior saved `user_confirmed`; `scripts/messaging-cli.ts verify-hello` updated status to `backend_verified`.
15. **Logout**: `/api/auth/logout` cleared session; subsequent `/api/auth/session` returned `authenticated: false`.
16. **Environment Variable Overrides & Origin-Allowlist CORS**: Validated `ADMIN_PASSCODE`, `BUDDY_MESSAGING_NUMBER`, `ALLOWED_ORIGINS` CORS preflight/headers, malformed JSON `400`, and SQLite durability reporting.

## External-Secret Dependent Items (Not Mocked)
- Live Gemini AI enrichment (`source: 'ai'`) requires an active, non-quota-exhausted `GOOGLE_GEMINI_API_KEY` in the runtime environment (`gemini-3.1-flash-lite` with `gemini-3.5-flash` fallback verified as configured models).
- Server-level `ADMIN_PASSCODE` and `BUDDY_MESSAGING_NUMBER` must be configured in `.env`/`.env.local` locally or Vercel / host Environment Variables in production.
- External SMS/WhatsApp network carrier delivery and password-reset email delivery are external integrations not configured yet.


