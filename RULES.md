# Engineering & Safety Rules — Buddy Elder AI

1. **Single Unified Codebase**: All senior, caregiver, admin, API, database, and AI features live in one repository with one shared database and auth system.
2. **Server-Side AI Only**: `@google/genai` is imported and called strictly in `server/`. Never expose `GOOGLE_GEMINI_API_KEY` or provider credentials to the browser.
3. **Honest Integration States**: Never return fake AI responses, fake SMS/WhatsApp activations, or hardcoded user metrics. If `GOOGLE_GEMINI_API_KEY` or `BUDDY_MESSAGING_NUMBER` is missing, surface an accurate configuration/error state with retry/admin guidance.
4. **Senior Ownership of Data & Messaging**:
   - The senior controls all caregiver sharing levels (`minimal`, `balanced`, `full`) and individual permission toggles.
   - Caregivers cannot escalate their own permissions; private AI chat transcripts are never shared automatically.
   - The first WhatsApp/SMS `HELLO` message must come from the senior's own phone number.
5. **AI Safety Boundaries**:
   - Never diagnose medical conditions or claim to provide emergency services.
   - Never guarantee scam detection is 100% accurate.
   - Never ask for OTPs, passwords, or bank PINs.
   - Direct immediate life/safety emergencies to local emergency numbers (`112` / `100` / `108` / `911` as applicable) without blocking behind a 30-second pause.
6. **Zero Untested Claims**: Update `TASKS.md` and `TESTING_REPORT.md` only after running real automated and end-to-end verification.
