#!/bin/zsh
set -e
cd "${0:A:h}"

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust non è installato. Installalo da https://rustup.rs e riapri il Terminale."
  open "https://rustup.rs"
  read "?Premi Invio per chiudere..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm non è installato. Installa Node.js 20 o successivo."
  open "https://nodejs.org/"
  read "?Premi Invio per chiudere..."
  exit 1
fi

echo "Installazione dipendenze..."
npm install

echo "Controllo pulsanti, moduli desktop e regressione stampa..."
npm run verify

echo "Creazione applicazione macOS..."
npx tauri build

echo ""
echo "Build macOS completata."
echo "Trovi .app e .dmg in: src-tauri/target/release/bundle/"
read "?Premi Invio per chiudere..."
