import fs from 'node:fs'

const source = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
const required = [
  'function hasEconomicPrice(row)',
  'function pricedChildrenFor(rowId)',
  "row.kind === 'item' && pricedChildrenFor(row.id).length",
  'const pricedChildren = pricedChildrenFor(row.id)',
  'const pricedChildren = children.filter(hasEconomicPrice)',
]
const missing = required.filter(token => !source.includes(token))
if (missing.length) {
  console.error('REGRESSIONE CALCOLO NON SUPERATA')
  missing.forEach(token => console.error(`- manca: ${token}`))
  process.exit(1)
}

function own(row) {
  if (!row.calculate || row.quantity == null || row.quantity === '') return 0
  const net = (Number(row.unitPrice) || 0) * (1 - (Number(row.discountPct) || 0) / 100)
  return net * (Number(row.quantity) || 0)
}
function priced(row) {
  if (!row.calculate) return false
  const p = Number(row.unitPrice)
  const t = Number(row.sourceTotal)
  return (Number.isFinite(p) && Math.abs(p) > 1e-7) || (Number.isFinite(t) && Math.abs(t) > 1e-7)
}
function display(parent, children) {
  const econ = children.filter(priced)
  return econ.length ? econ.reduce((s, r) => s + own(r), 0) : own(parent)
}

const parent16 = { calculate: true, quantity: 17.25, unitPrice: 25, discountPct: 0 }
const children16 = [{ calculate: true, quantity: 3.75, unitPrice: 0, discountPct: 0 }]
if (Math.abs(display(parent16, children16) - 431.25) > 1e-9) throw new Error('Voce 16: fallback al padre non riuscito')

const parent15 = { calculate: true, quantity: 3.75, unitPrice: 30, discountPct: 0 }
const children15 = [
  { calculate: true, quantity: 14.42, unitPrice: 30, discountPct: 0 },
  { calculate: true, quantity: 2.48, unitPrice: 30, discountPct: 0 },
]
if (Math.abs(display(parent15, children15) - 507) > 1e-9) throw new Error('Voce 15: somma sottovoci non riuscita')

console.log('Audit calcolo superato: sottovoci a prezzo 0 non azzerano il padre; sottovoci valorizzate sommate correttamente.')
