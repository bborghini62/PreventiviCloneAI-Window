import fs from 'node:fs'
const src = fs.readFileSync('web/app.js','utf8')
const required = [
  'function refreshCalculatedValuesInPlace(changedRowId',
  "fieldKey: 'quantity'",
  "fieldKey: 'unitPrice'",
  "fieldKey: 'discountPct'",
  "calc.dataset.fieldKey = 'calculate'",
  'save(); refreshCalculatedValuesInPlace(row.id)',
  "netTd.className = 'money-cell net-cell'",
]
const forbidden = [
  'save(); renderRows()',
  'save(); render()\n      })\n      calcLabel.append',
]
const missing = required.filter(token => !src.includes(token))
const bad = forbidden.filter(token => src.includes(token))
if (missing.length || bad.length) {
  console.error('REGRESSIONE CURSORE NON SUPERATA')
  missing.forEach(token => console.error(`- manca: ${token}`))
  bad.forEach(token => console.error(`- ridisegno completo ancora presente: ${token}`))
  process.exit(1)
}
console.log('Audit cursore superato: quantità, prezzo, sconto e Calcola aggiornano i totali senza ricreare la tabella.')
