import fs from 'node:fs'
const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
const required = [
  'function getRowDisplayTotal(row)',
  'return ownRowTotal(row)',
  'function effectiveGrossTotal(row)',
  'function effectiveNetTotal(row)',
]
const forbidden = [
  "if (row.kind === 'item' && pricedChildrenFor(row.id).length) return 0",
  'if (pricedChildren.length) return pricedChildren.reduce',
]
const missing = required.filter(token => !source.includes(token))
const presentForbidden = forbidden.filter(token => source.includes(token))
if (missing.length || presentForbidden.length) {
  console.error('REGRESSIONE CALCOLO NON SUPERATA')
  missing.forEach(token => console.error(`- manca: ${token}`))
  presentForbidden.forEach(token => console.error(`- logica sostitutiva ancora presente: ${token}`))
  process.exit(1)
}
function own(row) {
  if (!row.calculate || row.quantity == null || row.quantity === '') return 0
  const net = (Number(row.unitPrice) || 0) * (1 - (Number(row.discountPct) || 0) / 100)
  return net * (Number(row.quantity) || 0)
}
const parent = { calculate: true, quantity: 17.25, unitPrice: 25, discountPct: 0 }
const child = { calculate: true, quantity: 3.75, unitPrice: 30, discountPct: 0 }
if (Math.abs(own(parent) - 431.25) > 1e-9) throw new Error('Il totale del padre deve restare indipendente')
if (Math.abs(own(child) - 112.5) > 1e-9) throw new Error('La sottovoce deve calcolare indipendentemente')
if (Math.abs((own(parent)+own(child)) - 543.75) > 1e-9) throw new Error('Il totale complessivo deve sommare le righe con Calcola attivo')
console.log('Audit calcolo superato: voce principale e sottovoci calcolano in modo indipendente, senza sostituzioni automatiche.')
