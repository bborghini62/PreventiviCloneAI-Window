import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const html = await readFile(resolve(root, 'web', 'index.html'), 'utf8')
const js = await readFile(resolve(root, 'web', 'app.js'), 'utf8')

const buttonIds = [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/gi)].map(match => match[1])
const expectedBindings = {
  importButton: 'el.importButton.addEventListener',
  undoImportButton: 'el.undoImportButton.addEventListener',
  toggleOriginalButton: 'el.toggleOriginalButton.addEventListener',
  toggleCoverButton: 'el.toggleCoverButton.addEventListener',
  printSettingsButton: 'el.printSettingsButton.addEventListener',
  printButton: 'el.printButton.addEventListener',
  saveProjectButton: 'el.saveProjectButton.addEventListener',
  openProjectButton: 'el.openProjectButton.addEventListener',
  exportCsvButton: 'el.exportCsvButton.addEventListener',
  newProjectButton: 'el.newProjectButton.addEventListener',
  cancelAnalysisButton: 'el.cancelAnalysisButton.addEventListener',
  closeOriginalButton: 'el.closeOriginalButton.addEventListener',
  addCoverFieldButton: 'el.addCoverFieldButton.addEventListener',
  resetCoverButton: 'el.resetCoverButton.addEventListener',
  disableCoverButton: 'el.disableCoverButton.addEventListener',
  addItemButton: 'el.addItemButton.addEventListener',
  addSectionButton: 'el.addSectionButton.addEventListener',
  applyDiscountButton: 'el.applyDiscountButton.addEventListener',
  cancelFirstPageModeButton: 'el.cancelFirstPageModeButton.addEventListener',
  confirmFirstPageModeButton: 'el.confirmFirstPageModeButton.addEventListener',
  closeImportReviewButton: 'el.closeImportReviewButton.addEventListener',
  cancelImportReviewButton: 'el.cancelImportReviewButton.addEventListener',
  confirmImportReviewButton: 'el.confirmImportReviewButton.addEventListener',
  closePrintSettingsButton: 'el.closePrintSettingsButton.addEventListener',
  resetPrintSettingsButton: 'el.resetPrintSettingsButton.addEventListener',
  cancelPrintSettingsButton: 'el.cancelPrintSettingsButton.addEventListener',
  printNowButton: 'el.printNowButton.addEventListener',
}

const failures = []
for (const id of buttonIds) {
  if (!js.includes(`document.querySelector('#${id}')`)) failures.push(`${id}: elemento non registrato`)
  const binding = expectedBindings[id]
  if (!binding) failures.push(`${id}: controllo non previsto nell'audit`)
  else if (!js.includes(binding)) failures.push(`${id}: evento click non collegato`)
}

const dynamicChecks = [
  ['Voce sopra', "appendMenuOption(insertGroup, 'item-before', 'Voce sopra')"],
  ['Voce sotto', "appendMenuOption(insertGroup, 'item-after', 'Voce sotto')"],
  ['Sottovoce con prezzo', "appendMenuOption(insertGroup, 'sub-price', 'Sottovoce con prezzo')"],
  ['Nota / specifica', "appendMenuOption(insertGroup, 'sub-note', 'Nota / specifica')"],
  ['Elimina riga', "createButton('×', 'Elimina'"],
  ['Duplica riga', "createButton('⧉', 'Duplica'"],
  ['Sposta riga', "createButton('↑', 'Sposta su'"],
  ['Dialogo interno', 'async function appConfirm'],
  ['Stampa desktop', "invoke('print_current_window'"],
  ['Salvataggio desktop', "invoke('save_file_with_dialog'"],
]
for (const [name, needle] of dynamicChecks) {
  if (!js.includes(needle)) failures.push(`${name}: funzione mancante`)
}

if (process.env.SKIP_PDFJS_AUDIT !== '1') {
  for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
    try {
      const info = await stat(resolve(root, 'web', 'vendor', 'pdfjs', file))
      if (info.size < 10_000) failures.push(`${file}: file PDF.js incompleto`)
    } catch {
      failures.push(`${file}: eseguire npm run prepare:pdfjs`)
    }
  }
}

if (failures.length) {
  console.error('\nAUDIT PULSANTI NON SUPERATO')
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`Audit superato: ${buttonIds.length} pulsanti statici e ${dynamicChecks.length} funzioni dinamiche controllate.`)
