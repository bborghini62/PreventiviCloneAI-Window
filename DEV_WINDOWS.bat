@echo off
setlocal
cd /d %~dp0
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust non e installato. Installalo da https://rustup.rs e riapri il Prompt dei comandi.
  start https://rustup.rs
  pause
  exit /b 1
)
call npm install
if errorlevel 1 exit /b 1
call npm run verify
if errorlevel 1 exit /b 1
call npx tauri dev
