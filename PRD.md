# Product Requirements Document (PRD) — Buddy Elder AI

## 1. Vision & Purpose
**Buddy Elder AI** ("Stay Safe. Live Confidently.") is an accessible, multilingual assistance platform connecting two primary user groups through a unified, permission-controlled backend:
1. **Senior / Elderly Users** (`senior`): High-legibility, calm, voice-friendly tools for AI companionship, scam protection, digital literacy, daily wellness check-ins, audio reading, reminders, family calling, and messaging onboarding.
2. **Family / Caregivers** (`caregiver`) & **Administrators** (`admin`): Clean monitoring dashboards showing *only* senior-authorized wellness summaries, safety/scam alerts, scheduled reminders, permission requests, and platform administration.

## 2. Supported Languages
- English (`en`)
- Hindi (`hi` — हिन्दी)
- Marathi (`mr` — मराठी)
- Hinglish (`hinglish`)

Language changes apply dynamically to core UI copy, AI Buddy responses, and Web Speech TTS/STT locale selection without restarting the app.

## 3. Core Functional Modules
1. **Onboarding & Settings**: Welcome splash, language choice, role choice, voice setup (enable/disable, speed: slow/normal/fast, voice preview), accessibility controls (Small/Normal/Large/Extra-Large text, High-Contrast, Light/Dark theme, Reduced Motion), emergency contacts, data export, and account deletion.
2. **AI Buddy**: Server-side `@google/genai` (`gemini-3.1-flash-lite` with `gemini-3.5-flash` fallback) conversational assistant with multi-turn persistence, conversation list/create/clear/delete, voice input, spoken read-aloud/stop/repeat, safety guardrails (no medical diagnosis, no OTP/PIN requests, emergency redirection), and honest error/retry handling when `GOOGLE_GEMINI_API_KEY` is unavailable.
3. **Is This Safe? (Scam Detection & Pause)**: Text/URL/phone/message analyzer combining deterministic risk heuristics + Gemini structured assessment (`GREEN`, `YELLOW`, `RED`), 30-second "Pause & Think" safety modal for urgent financial/OTP threats, automatic caregiver safety alert (when permitted), and Call Safety guide.
4. **Read This (Audio Reader)**: Paste text or upload `.txt`/`.md`/`.csv`/`.json` documents, read aloud with play/pause/resume/stop/repeat, speed selector, sentence/chunk skip forward & back, active sentence highlighting, and language selection.
5. **Learn Technology (Digital Education)**: Interactive step-by-step lessons (Smartphone Basics, Phone Settings, WhatsApp & Photos, Video Calls, Google Maps, UPI & OTP Safety, Scam Awareness) with audio read-aloud and persistent database progress tracking.
6. **Daily Check-in**: "How are you today?" (`good`, `okay`, `not_good`) + optional medication, help needed, speak to family, and feel safe questions (skippable), duplicate same-day update/handling, history, and permission-filtered caregiver visibility.
7. **Family Permission Centre**: Senior-controlled sharing levels (`minimal`, `balanced`, `full`), granular toggles (`checkin_status`, `checkin_responses`, `wellness_summaries`, `safety_alerts`, `scam_alerts`, `reminder_status`, `activity_summaries`, `ai_summaries`, `contact_info`), never auto-sharing private AI chats, invite code generation, immediate revocation, and caregiver access-request review (approve/reject).
8. **Caregiver Portal**: Invitation-code senior linking, permission-enforced dashboard, alert inbox with severity filters (`all`, `critical`, `warning`, `informational`) & resolution workflow, wellness trends, reminder creation/scheduling/delivery tracking/retry, and sharing request submission.
9. **Senior Messaging Onboarding & CLI**: Strict senior-owned-phone initiation rule (`HELLO` sent from the senior's own phone, whether self-setup or caregiver-assisted), honest `BUDDY_MESSAGING_NUMBER` configuration state, copy number / copy `HELLO` / `sms:` tap-to-message, honest 5-step status progression (`not_started`, `instructions_viewed`, `ready_to_send`, `user_confirmed`, `backend_verified`), plus a preserved local messaging CLI (`scripts/messaging-cli.ts`) for developer verification.
10. **Admin Portal & Feedback**: First-run admin claim/login, platform stats, user list, role/status management, messaging config inspection, and user feedback review.
