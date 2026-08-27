#!/bin/zsh
set -e
cd "${0:A:h}"
if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust non è installato. Installalo da https://rustup.rs e riapri il Terminale."
  open "https://rustup.rs"
  read "?Premi Invio per chiudere..."
  exit 1
fi
npm install
npm run verify
npx tauri dev
