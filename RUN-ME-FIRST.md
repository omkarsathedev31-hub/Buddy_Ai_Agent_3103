# Buddy Elder AI - Run It in 4 Steps

1. **Install Node.js** (LTS version) from https://nodejs.org (one time only).
2. **Add your Gemini key.** Open the file named `.env` in this folder with Notepad or VS Code.
   Replace `your-gemini-api-key` with your real key (keep the quotes, one line). Save.
   Free key: https://aistudio.google.com/apikey
3. **Start the app.**
   - Windows: double-click `start-windows.bat`
   - Mac/Linux: run `./start-mac-linux.sh`
   - VS Code: open a NEW terminal, run `npm install` then `npm run dev`
4. Open **http://localhost:3000**, create an account, and open **AI Buddy**.

## If the AI does not answer
Run `npm run diagnose:gemini`. It shows PASS/FAIL for each step and the exact cause
(invalid key, restricted key, model, quota, network). It never prints your key.

Common fix: an OLD key left in your Windows/Mac environment. Close all terminals and open a new one.
The app already prefers the key saved in `.env` and prints a notice if it replaced an old one.

## Useful commands
- `npm run dev`             start the website (development)
- `npm run build`           create the production build
- `npm start`               run in production mode
- `npm run lint`            TypeScript check
- `npm run diagnose:gemini` test the Gemini connection

## Your data
Accounts, sessions and conversations are stored in `./data/buddy-elder.db` on your computer
(created automatically). Back up that file to keep your data.

## Deploying for Persistent Logins & Data (Railway Recommended)
Vercel serverless functions use temporary `/tmp` storage that resets and isn't shared between instances, causing `"Session not found or expired"` errors. Host Buddy Elder AI on a persistent Node.js 22 server such as **Railway**:
1. Add a **Volume** mounted at `/data`.
2. Set environment variables:
   - `NODE_ENV=production`
   - `BUDDY_DB_PATH=/data/buddy-elder.db`
   - `GEMINI_API_KEY` (your Gemini key — server-side only)
   - `ADMIN_PASSCODE` (strong admin passcode)
   - `APP_URL` and `ALLOWED_ORIGINS` (`https://buddy-ai-agent-31-1x82.vercel.app`)
   - Leave `VITE_API_BASE_URL` empty on Railway; set `VITE_API_BASE_URL` on Vercel to your Railway backend URL.
3. Build command: `npm run build` · Start command: `npm start`.
