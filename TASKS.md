# Buddy Elder AI — Master Tasks Checklist

Priority levels:
- **P0**: Security, data loss, crashes, broken authentication
- **P1**: Core functionality and critical backend/database/AI integration
- **P2**: Feature workflows, messaging onboarding, notifications, persistence
- **P3**: Accessibility, multilingual UI, responsiveness, error/loading/empty states
- **P4**: Performance, build optimization, cleanup

## Phase 0–2: Audit, Docs & Baseline
- [x] **T0.1 (P1)** Inspect repository & create `INTEGRATION_AUDIT.md` | Status: VERIFIED
- [x] **T0.2 (P1)** Create `PRD.md`, `ARCHITECTURE.md`, `DESIGN.md`, `RULES.md`, `TASKS.md`, `MEMORY.md`, `TESTING_REPORT.md` | Status: VERIFIED
- [x] **T0.3 (P1)** Configure `metadata.json`, `index.html`, `.env.example`, `package.json`, `src/index.css` | Status: VERIFIED (`vite build` + `tsc --noEmit` pass)

## Phase 3: Core Backend, Database & Auth (P0/P1)
- [x] **T1.1 (P0)** Implement `server/db.ts` (`node:sqlite` schema, foreign keys, indexes) | Status: VERIFIED (`tests/api.test.ts`)
- [x] **T1.2 (P0)** Implement `server/auth.ts` (`scrypt` password hashing, DB session cookies, CSRF & origin protection, RBAC middleware, first-run admin claim) | Status: VERIFIED (`tests/api.test.ts`)
- [x] **T1.3 (P0)** Implement `server/permissions.ts` (permission defaults, caregiver authorization filter, audit logging) | Status: VERIFIED (`tests/api.test.ts`)
- [x] **T1.4 (P1)** Implement `server/ai.ts` (`@google/genai` `gemini-3.1-flash-lite` + `gemini-3.5-flash` fallback chat & scam analysis with safety prompts & honest 503 error propagation when key missing) | Status: VERIFIED (503 honest missing-key behavior + deterministic scam heuristics verified in `tests/api.test.ts`; live Gemini call requires `GOOGLE_GEMINI_API_KEY` secret)
- [x] **T1.5 (P1)** Implement `server/app.ts` & `server.ts` (Express app, rate limiter, REST endpoints, Vite dev middleware & prod static serving) | Status: VERIFIED (`node server.ts` prod startup + `/api/health` 200)

## Phase 4–14: Senior Application (P1/P2/P3)
- [x] **T2.1 (P1)** Build centralized API client (`src/lib/api.ts`) and Auth/Settings/i18n contexts (`src/contexts/AppContext.tsx`, `src/lib/i18n.ts`) | Status: VERIFIED (`tsc --noEmit` + `vite build`)
- [x] **T2.2 (P1)** Build Onboarding Splash, Language Selector (EN/HI/MR/Hinglish), Role Auth, Password Reset, Admin Claim & Senior Voice Setup (`src/components/AuthOnboarding.tsx`) | Status: VERIFIED (`tsc --noEmit` + `vite build` + API tests)
- [x] **T2.3 (P1)** Build Senior Accessible Dashboard & Navigation (`src/components/SeniorDashboard.tsx`) | Status: VERIFIED (`tsc --noEmit` + `vite build`)
- [x] **T2.4 (P1)** Build AI Buddy Chat with voice input, TTS playback, history, delete/clear, retry (`src/components/AiBuddyView.tsx`) | Status: VERIFIED (UI compiled; API persistence/error state tested)
- [x] **T2.5 (P2)** Build Scam Detection ("Is This Safe?"), 30s Pause & Think Safety Modal, and Call Safety (`src/components/ScamSafetyView.tsx`) | Status: VERIFIED (`tests/api.test.ts` RED/GREEN + alert creation)
- [x] **T2.6 (P2)** Build Audio Reader ("Read This") with paste/file upload, playback controls, speed, skip, highlight (`src/components/AudioReaderView.tsx`) | Status: VERIFIED (`tsc --noEmit` + `vite build`)
- [x] **T2.7 (P2)** Build Digital Education ("Learn Technology") with step-by-step lessons, TTS, and persistent progress (`src/components/LearnTechView.tsx`) | Status: VERIFIED (`tests/api.test.ts`)
- [x] **T2.8 (P2)** Build Daily Check-in & Wellness History (`src/components/DailyCheckinView.tsx`) | Status: VERIFIED (`tests/api.test.ts` create + duplicate update + alert)
- [x] **T2.9 (P1)** Build Family Permission Centre, Invite Codes, Emergency Contacts & Call My Family (`src/components/FamilyPermissionsView.tsx`) | Status: VERIFIED (`tests/api.test.ts`)
- [x] **T2.10 (P2)** Build Senior Messaging Onboarding (`HELLO` from senior's own phone, self & caregiver-assisted, honest status) + `scripts/messaging-cli.ts` | Status: VERIFIED (`tests/api.test.ts` + CLI `verify-hello`)
- [x] **T2.11 (P3)** Build Senior Reminders, Help, Feedback & Accessibility Settings (text size, contrast, light/dark, voice, data export, delete account) (`src/components/SettingsView.tsx`, `src/components/RemindersHelpView.tsx`) | Status: VERIFIED (`tests/api.test.ts` + `vite build`)

## Phase 15–16: Caregiver & Admin Applications (P0/P1/P2)
- [x] **T3.1 (P1)** Build Caregiver Dashboard, Senior Linking via Invite Code, Authorized Wellness Summaries, Alerts Inbox & Resolution, Reminders & Retry, Sharing Requests (`src/components/CaregiverDashboard.tsx`) | Status: VERIFIED (`tests/api.test.ts`)
- [x] **T3.2 (P0)** Build Admin Dashboard, User Management, Role/Active Controls, Messaging Number Config & Feedback Review (`src/components/AdminDashboard.tsx`) | Status: VERIFIED (`tests/api.test.ts`)

## Phase 24–27: Testing, Build & Verification (P0/P1)
- [x] **T4.1 (P0)** Write & execute backend API & authorization integration tests (`tests/api.test.ts`) | Status: VERIFIED (PASS)
- [x] **T4.2 (P1)** Run `npm run lint` (`tsc --noEmit`) and `npm run build` (`vite build`) | Status: VERIFIED (PASS)
- [x] **T4.3 (P1)** Verify production server startup (`NODE_ENV=production node server.ts`) and `/api/health` | Status: VERIFIED (PASS)
- [x] **T4.4 (P1)** Update `TESTING_REPORT.md`, `MEMORY.md`, `INTEGRATION_AUDIT.md`, and `TASKS.md` | Status: VERIFIED
