#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js LTS from https://nodejs.org first."; exit 1; }
[ -d node_modules ] || npm install
echo "Checking your Gemini key..."
npm run diagnose:gemini
echo "Starting Buddy Elder AI at http://localhost:3000"
npm run dev
