import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8')
const styles = fs.readFileSync(path.join(root, 'web', 'styles.css'), 'utf8')

function fail(message) {
  console.error(`\nREGRESSIONE STAMPA NON SUPERATA\n- ${message}\n`)
  process.exit(1)
}

const start = app.indexOf('function buildPrintableClone()')
const end = app.indexOf('\nfunction clearDesktopPrintSnapshot()', start)
if (start < 0 || end < 0) fail('funzione buildPrintableClone non trovata')
const block = app.slice(start, end)

const controlsPos = block.indexOf('sourceControls')
const removeNoPrintPos = block.indexOf("querySelectorAll('.no-print')")
if (controlsPos < 0 || removeNoPrintPos < 0 || controlsPos > removeNoPrintPos) {
  fail('i controlli vengono sincronizzati dopo la rimozione dei blocchi no-print')
}
if (!block.includes("classList.contains('description-textarea')")) {
  fail('manca la protezione contro la doppia stampa delle descrizioni')
}
if (!app.includes("core.invoke('print_current_window', {\n        orientation: settings.orientation")) {
  fail('orientamento non passato alla stampa nativa')
}
if (!styles.includes('body.desktop-print-snapshot > *:not(#desktopPrintHost)')) {
  fail('manca l’isolamento del documento stampabile')
}
if (!styles.includes('.sheet-table .col-total') || !styles.includes('width: 13% !important')) {
  fail('larghezza della colonna Totale non protetta')
}

console.log('Audit regressione stampa superato:')
console.log('- sincronizzazione controlli prima della rimozione no-print')
console.log('- descrizione stampata una sola volta')
console.log('- orientamento inviato alla stampa nativa')
console.log('- documento stampabile isolato dalla UI')
console.log('- colonna Totale protetta')
