# Architecture — Buddy Elder AI

## Overview
Unified full-stack TypeScript application running a single Express server (`server.ts`) on port `3000` with Vite middleware in development and static asset serving in production.

## Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), Lucide Icons, Motion (`motion/react` with reduced-motion support).
- **Backend**: Express 4 (`server.ts`), custom modular API routes (`/api/*`), Node.js native `node:sqlite` (`DatabaseSync`), Node.js `node:crypto` (`scryptSync`, `createHmac`, `timingSafeEqual`).
- **AI Engine**: `@google/genai` SDK (`GEMINI_MODEL`, defaulting to `gemini-3.1-flash-lite`, with automatic `GEMINI_FALLBACK_MODEL` failover defaulting to `gemini-3.5-flash`) invoked strictly server-side (`server/ai.ts`) with `User-Agent: aistudio-build` telemetry header.
- **Voice & Audio**: Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition` + `window.speechSynthesis`) wrapped in an accessible React hook with graceful capability detection.
- **Messaging CLI**: `scripts/messaging-cli.ts` interacting with the shared SQLite `messaging_onboarding` & `audit_logs` tables and `BUDDY_MESSAGING_NUMBER` configuration.

## Database Schema (`data/buddy-elder.db`)
All tables use foreign keys (`PRAGMA foreign_keys = ON;`), ISO timestamps, and parameterized prepared statements:
1. `users`: `id`, `email`, `name`, `phone`, `role` (`senior` | `caregiver` | `admin`), `password_hash`, `language`, `is_active`, `created_at`, `updated_at`
2. `sessions`: `id`, `user_id`, `token_hash`, `expires_at`, `created_at`
3. `system_config`: `key`, `value`, `updated_at` (stores claimed admin hash fallback & messaging settings)
4. `user_settings`: `user_id`, `text_size`, `contrast_mode`, `theme`, `reduced_motion`, `voice_enabled`, `voice_speed`, `voice_name`, `notifications_enabled`, `onboarding_completed`, `updated_at`
5. `emergency_contacts`: `id`, `senior_id`, `name`, `relationship`, `phone`, `is_primary`, `created_at`
6. `caregiver_links`: `id`, `senior_id`, `caregiver_id`, `invite_code`, `relationship`, `sharing_level` (`minimal` | `balanced` | `full`), `permissions_json`, `status` (`pending` | `active` | `revoked`), `created_at`, `updated_at`
7. `permission_requests`: `id`, `link_id`, `senior_id`, `caregiver_id`, `requested_level`, `requested_permissions_json`, `reason`, `status` (`pending` | `approved` | `rejected`), `reviewed_at`, `created_at`
8. `permission_history`: `id`, `senior_id`, `actor_id`, `link_id`, `action`, `details_json`, `created_at`
9. `conversations`: `id`, `user_id`, `title`, `language`, `created_at`, `updated_at`
10. `messages`: `id`, `conversation_id`, `role` (`user` | `assistant`), `content`, `language`, `created_at`
11. `check_ins`: `id`, `senior_id`, `checkin_date`, `mood` (`good` | `okay` | `not_good`), `medication_taken`, `needs_help`, `wants_family_call`, `feels_safe`, `note`, `created_at`, `updated_at`
12. `scam_assessments`: `id`, `user_id`, `input_type`, `content`, `risk_level` (`GREEN` | `YELLOW` | `RED`), `explanation`, `indicators_json`, `actions_json`, `source` (`ai` | `heuristic_fallback`), `created_at`
13. `lesson_progress`: `id`, `user_id`, `lesson_id`, `completed_steps_json`, `is_completed`, `last_step`, `updated_at`
14. `alerts`: `id`, `senior_id`, `type`, `severity` (`critical` | `warning` | `informational`), `title`, `description`, `explanation`, `recommended_action`, `dedupe_key`, `is_read`, `status` (`open` | `reviewed` | `resolved`), `reviewed_by`, `created_at`, `updated_at`
15. `reminders`: `id`, `senior_id`, `created_by`, `category`, `title`, `message`, `scheduled_for`, `voice_enabled`, `delivery_status` (`scheduled` | `sent` | `acknowledged` | `failed`), `retry_count`, `last_error`, `created_at`, `updated_at`
16. `notifications`: `id`, `user_id`, `type`, `title`, `body`, `is_read`, `created_at`
17. `messaging_onboarding`: `id`, `senior_id`, `setup_mode` (`self` | `caregiver_assisted`), `senior_phone`, `status` (`not_started` | `instructions_viewed` | `ready_to_send` | `user_confirmed` | `backend_verified`), `verified_at`, `updated_at`
18. `feedback`: `id`, `user_id`, `category`, `rating`, `message`, `created_at`
19. `audit_logs`: `id`, `user_id`, `action`, `resource`, `details_json`, `created_at`

## Security & Authorization Model
- **Password Hashing**: `crypto.scryptSync` with random 16-byte salt and `timingSafeEqual`.
- **Session Management**: `HttpOnly` cookie (`buddy_session`) + DB-backed session token hash with 7-day expiry, `SameSite=None; Secure; Partitioned` on HTTPS and `SameSite=Lax` on local HTTP. Also supports `Authorization: Bearer` for programmatic/test clients.
- **CSRF Guard**: All state-changing API calls (`POST`, `PUT`, `PATCH`, `DELETE`) require either `X-Requested-With: BuddyElderAI` or matching same-origin `Origin`/`Host`.
- **Permission Enforcement**: Caregiver endpoints strictly query `caregiver_links` (`status = 'active'`) and filter every returned field (check-ins, wellness trends, alerts, reminders) through `permissions_json` on the server. Caregivers cannot modify their own permissions or view raw AI chat transcripts.
- **Rate Limiting**: Express middleware limits auth attempts and AI generation endpoints per IP/user.
