# Engineering Memory — Buddy Elder AI

## Completed Implementation State
- Built unified Express (`server.ts`, `server/app.ts`) + React 19 (`src/`) + SQLite (`server/db.ts`) Buddy Elder AI platform.
- Implemented server-side `@google/genai` (`gemini-3.1-flash-lite` with `gemini-3.5-flash` fallback) integration in `server/ai.ts` with honest 503 reporting when `GOOGLE_GEMINI_API_KEY` is missing.
- Implemented `scrypt` password hashing, `HttpOnly` cookie sessions (`SameSite=None; Secure; Partitioned` over HTTPS), CSRF header/origin checks, first-run admin claim, and strict server-side caregiver permission filtering (`server/permissions.ts`).
- Implemented Senior App (`SeniorDashboard`, `AiBuddyView`, `ScamSafetyView`, `AudioReaderView`, `LearnTechView`, `DailyCheckinView`, `FamilyPermissionsView`, `MessagingOnboardingView`, `RemindersHelpView`, `SettingsView`), Caregiver Portal (`CaregiverDashboard`), Admin Console (`AdminDashboard`), and Developer Messaging CLI (`scripts/messaging-cli.ts`).

## Verification Completed
- `npx tsx --test tests/api.test.ts` passed (15 end-to-end stages including `ADMIN_PASSCODE` 503/403/401/env checks, `BUDDY_MESSAGING_NUMBER` & user phone E.164 normalization/400/503 checks, permissions payload sanitization, and strict origin-allowlist CORS).
- Fixed `npm install` `ERESOLVE` peer conflict by upgrading `esbuild` to `^0.28.0` and `@google/genai` to `^2.32.0`, and pinned `"engines": { "node": "22.x" }` for `node:sqlite`.
- Eliminated Vite 8 config deprecation warning by switching `vite.config.ts` from `__dirname` to `import.meta.dirname`.
- Added centralized server-only env loader (`server/env.ts`) supporting `.env.local` + `.env` without overriding host variables, placeholder filtering, and E.164 country-code validation.
- Hardened `server/app.ts` admin claim/login, CORS allowlist (`ALLOWED_ORIGINS`/`APP_URL`), phone validation on `/api/auth/register` & `/api/settings`, permissions sanitization on `/api/permissions/links/:linkId`, and `forgot-password` prior-code invalidation.
- Synced SPA URL routing with `history.pushState`/`popstate` across `AuthOnboarding`, `SeniorDashboard`, and `CaregiverDashboard`, and added visible `try/catch` error alerts in `CaregiverDashboard`, `SettingsView`, `FamilyPermissionsView`, and `RemindersHelpView`.
- Added Vercel deployment configuration (`vercel.json`, `api/index.ts`, optional `VITE_API_BASE_URL` in `src/lib/api.ts`, `/tmp` SQLite fallback in `server/db.ts`).

## Environment Dependencies
- `GOOGLE_GEMINI_API_KEY`: Required in `.env`/`.env.local` or host/Vercel secrets for live Gemini AI Buddy responses and AI-enhanced scam explanations.
- `BUDDY_MESSAGING_NUMBER`: Server-side messaging number in E.164 format (`+<country_code><number>`), or configurable fallback via Admin Console / `npm run cli:messaging -- set-number <number>`.
- `ADMIN_PASSCODE`: Server-only administrator passcode (never prefixed with `VITE_` or `NEXT_PUBLIC_`); if unset, first administrator can claim access via First-Run Admin Setup.
- `ALLOWED_ORIGINS` & `VITE_API_BASE_URL`: Optional variables when hosting frontend and persistent Node backend on separate origins.
