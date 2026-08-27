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
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm non e installato. Installa Node.js 20 o successivo.
  start https://nodejs.org/
  pause
  exit /b 1
)
echo Installazione dipendenze...
call npm install
if errorlevel 1 exit /b 1
echo Controllo pulsanti, moduli desktop e regressione stampa...
call npm run verify
if errorlevel 1 exit /b 1
echo Creazione applicazione Windows...
call npx tauri build
if errorlevel 1 exit /b 1
echo.
echo Build Windows completata. Cerca Setup.exe/MSI in src-tauri\target\release\bundle\.
pause
