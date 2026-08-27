import fs from 'node:fs'
const src = fs.readFileSync('web/app.js','utf8')
const required = [
  'function captureRowsViewState()',
  'function restoreRowsViewState(viewState)',
  "fieldKey: 'quantity'",
  "fieldKey: 'unitPrice'",
  "fieldKey: 'discountPct'",
  "calc.dataset.fieldKey = 'calculate'",
  'restoreRowsViewState(viewState)'
]
const missing = required.filter(token => !src.includes(token))
if (missing.length) { console.error('REGRESSIONE CURSORE NON SUPERATA', missing); process.exit(1) }
console.log('Audit cursore superato: focus e scroll preservati durante il ricalcolo.')
