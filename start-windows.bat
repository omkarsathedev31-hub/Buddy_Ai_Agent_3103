@echo off
title Buddy Elder AI
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing, please wait a few minutes the first time...
  call npm install
)
echo.
echo Checking your Gemini key...
call npm run diagnose:gemini
echo.
echo Starting Buddy Elder AI. Open http://localhost:3000 in your browser.
call npm run dev
pause
