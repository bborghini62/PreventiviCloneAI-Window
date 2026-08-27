import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).toString()

const IS_TAURI_DESKTOP = Boolean(window.__TAURI__?.core?.invoke)
const WORKER_BASE_URL = 'https://round-violet-13ba.bruno-c77.workers.dev'

function apiUrl(path) {
  if (!IS_TAURI_DESKTOP || !String(path).startsWith('/api/')) return path
  return new URL(path, WORKER_BASE_URL).toString()
}

async function appFetch(input, init = {}) {
  const resolved = apiUrl(input)
  const nativeFetch = window.__TAURI__?.http?.fetch
  if (IS_TAURI_DESKTOP && typeof nativeFetch === 'function') {
    return nativeFetch(resolved, init)
  }
  return fetch(resolved, init)
}

function appDialog(message, { title = 'Preventivi Clone AI', confirm = false } = {}) {
  return new Promise(resolve => {
    const existing = document.querySelector('.app-dialog-backdrop')
    if (existing) existing.remove()

    const backdrop = document.createElement('div')
    backdrop.className = 'app-dialog-backdrop no-print'
    backdrop.setAttribute('role', 'dialog')
    backdrop.setAttribute('aria-modal', 'true')

    const card = document.createElement('section')
    card.className = 'app-dialog-card'
    const heading = document.createElement('h2')
    heading.textContent = title
    const text = document.createElement('p')
    text.textContent = String(message || '')
    const actions = document.createElement('div')
    actions.className = 'app-dialog-actions'

    const finish = value => {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      resolve(value)
    }
    const onKey = event => {
      if (event.key === 'Escape') finish(false)
      if (event.key === 'Enter' && confirm) finish(true)
    }
    document.addEventListener('keydown', onKey)

    if (confirm) {
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'soft'
      cancel.textContent = 'Annulla'
      cancel.addEventListener('click', () => finish(false))
      actions.append(cancel)
    }

    const accept = document.createElement('button')
    accept.type = 'button'
    accept.className = 'primary'
    accept.textContent = confirm ? 'Conferma' : 'OK'
    accept.addEventListener('click', () => finish(true))
    actions.append(accept)

    card.append(heading, text, actions)
    backdrop.append(card)
    document.body.append(backdrop)
    setTimeout(() => accept.focus(), 0)
  })
}

async function appAlert(message, title = 'Preventivi Clone AI') {
  await appDialog(message, { title, confirm: false })
}

async function appConfirm(message, title = 'Conferma operazione') {
  return appDialog(message, { title, confirm: true })
}

const STORAGE_KEY = 'preventivi-clone-ai-desktop-beta6-2-9-cursor-stable'
const LEGACY_STORAGE_KEY_627 = 'preventivi-clone-ai-desktop-beta6-2-7-hybrid'
const LEGACY_STORAGE_KEYS = [LEGACY_STORAGE_KEY_627, 'preventivi-clone-ai-prova-094', 'preventivi-clone-ai-prova-093', 'preventivi-clone-ai-prova-092', 'preventivi-clone-ai-prova-09', 'preventivi-clone-ai-prova-083', 'preventivi-clone-ai-prova-082', 'preventivi-clone-ai-prova-08', 'preventivi-clone-ai-prova-07', 'preventivi-clone-ai-prova-06', 'preventivi-clone-ai-prova-05', 'preventivi-clone-ai-prova-04']
const UNITS = ['A CORPO', 'MQ', 'M2', 'M²', 'ML', 'MC', 'M3', 'M³', 'KG', 'NR', 'CAD', 'PZ', 'ORE', 'ORA', 'GG', 'LT', 'M', 'TON', 'Q.LI', 'AC', 'MT', 'N']
const MONTHS = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre'

const defaultPrintSettings = () => ({
  screenFontSize: 11,
  screenDescriptionMode: 'full',
  screenDescriptionLines: 4,
  fontSize: 7,
  orientation: 'landscape',
  pageSize: 'A4',
  fitToPage: true,
  showDiscount: true,
  showNet: true,
  showDetails: true,
  showNotes: true,
  showFullHeader: true,
  descriptionMode: 'full',
  descriptionLines: 4,
})

const emptyCover = () => ({ available: false, enabled: false, suggested: false, mode: 'cover', showBackground: true, pageWidth: 595, pageHeight: 842, backgroundDataUrl: '', blocks: [], originalBlocks: [] })

const emptyProject = () => ({
  header: { titolo: '', cliente: '', indirizzo: '', dataDocumento: '', mittente: '' },
  cover: emptyCover(),
  rows: [],
  fileName: '',
  vatPct: 10,
  notes: '',
  stats: null,
  printSettings: defaultPrintSettings(),
})

let state = emptyProject()
let warnings = []
let importBackup = null
let originalUrl = ''
let showOriginal = false
let loading = false
let pendingAiImport = null
let pendingFirstPageFile = null
let activeImportSession = null
let desktopPrintCleanupTimer = null

const AI_CACHE_PREFIX = 'preventivi-clone-ai-ai-cache-hybrid-v1:'
const AI_CACHE_INDEX_KEY = 'preventivi-clone-ai-ai-cache-hybrid-v1-index'

async function fileFingerprint(file) {
  const head = file.slice(0, Math.min(file.size, 160 * 1024))
  const tail = file.size > 160 * 1024 ? file.slice(Math.max(0, file.size - 160 * 1024)) : new Blob([])
  const sample = await new Blob([file.name, '|', String(file.size), '|', String(file.lastModified || 0), '|', head, '|', tail]).arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', sample)
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

function cachedAiResult(fingerprint) {
  try {
    const raw = localStorage.getItem(`${AI_CACHE_PREFIX}${fingerprint}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.result || null
  } catch (_) {
    return null
  }
}

function saveCachedAiResult(fingerprint, result, file) {
  try {
    const key = `${AI_CACHE_PREFIX}${fingerprint}`
    localStorage.setItem(key, JSON.stringify({ createdAt: Date.now(), fileName: file.name, fileSize: file.size, result }))
    const current = JSON.parse(localStorage.getItem(AI_CACHE_INDEX_KEY) || '[]').filter(item => item?.fingerprint !== fingerprint)
    current.unshift({ fingerprint, createdAt: Date.now() })
    const keep = current.slice(0, 12)
    current.slice(12).forEach(item => localStorage.removeItem(`${AI_CACHE_PREFIX}${item.fingerprint}`))
    localStorage.setItem(AI_CACHE_INDEX_KEY, JSON.stringify(keep))
  } catch (_) {
    // La cache accelera le prove successive, ma non deve mai bloccare l'importazione.
  }
}

function applyAiCoverSuggestion(local, aiDocument, firstPageMode = 'auto') {
  const suggested = Boolean(aiDocument?.cover_page_present)
  if (local?.cover) {
    local.cover.suggested = suggested
    local.cover.mode = firstPageMode === 'specification' ? 'specification' : 'cover'
    if (firstPageMode === 'cover' || firstPageMode === 'specification') {
      local.cover.enabled = local.cover.available
    } else if (firstPageMode === 'ignore') {
      local.cover.enabled = false
      local.cover.available = false
    } else {
      local.cover.enabled = suggested && local.cover.available
    }
  }
  return local
}

function attachOriginalPdf(file) {
  if (!originalUrl) originalUrl = URL.createObjectURL(file)
  showOriginal = true
  renderOriginal()
}

const el = {
  importButton: document.querySelector('#importButton'),
  undoImportButton: document.querySelector('#undoImportButton'),
  toggleOriginalButton: document.querySelector('#toggleOriginalButton'),
  toggleCoverButton: document.querySelector('#toggleCoverButton'),
  printSettingsButton: document.querySelector('#printSettingsButton'),
  printButton: document.querySelector('#printButton'),
  fileInput: document.querySelector('#fileInput'),
  saveProjectButton: document.querySelector('#saveProjectButton'),
  openProjectButton: document.querySelector('#openProjectButton'),
  exportCsvButton: document.querySelector('#exportCsvButton'),
  newProjectButton: document.querySelector('#newProjectButton'),
  projectInput: document.querySelector('#projectInput'),
  fileNameLabel: document.querySelector('#fileNameLabel'),
  workspace: document.querySelector('#workspace'),
  originalPanel: document.querySelector('#originalPanel'),
  originalFrame: document.querySelector('#originalFrame'),
  closeOriginalButton: document.querySelector('#closeOriginalButton'),
  dropZone: document.querySelector('#dropZone'),
  dropTitle: document.querySelector('#dropTitle'),
  analysisProgressOverlay: document.querySelector('#analysisProgressOverlay'),
  analysisProgressTitle: document.querySelector('#analysisProgressTitle'),
  analysisProgressDetail: document.querySelector('#analysisProgressDetail'),
  analysisProgressElapsed: document.querySelector('#analysisProgressElapsed'),
  analysisProgressBar: document.querySelector('#analysisProgressBar'),
  cancelAnalysisButton: document.querySelector('#cancelAnalysisButton'),
  analysisCard: document.querySelector('#analysisCard'),
  statsGrid: document.querySelector('#statsGrid'),
  detectedColumns: document.querySelector('#detectedColumns'),
  warnings: document.querySelector('#warnings'),
  documentSheet: document.querySelector('#documentSheet'),
  coverEditorSection: document.querySelector('#coverEditorSection'),
  coverPage: document.querySelector('#coverPage'),
  coverBackgroundImage: document.querySelector('#coverBackgroundImage'),
  coverFields: document.querySelector('#coverFields'),
  coverBackgroundToggle: document.querySelector('#coverBackgroundToggle'),
  addCoverFieldButton: document.querySelector('#addCoverFieldButton'),
  resetCoverButton: document.querySelector('#resetCoverButton'),
  disableCoverButton: document.querySelector('#disableCoverButton'),
  mittente: document.querySelector('#mittente'),
  dataDocumento: document.querySelector('#dataDocumento'),
  titolo: document.querySelector('#titolo'),
  cliente: document.querySelector('#cliente'),
  indirizzo: document.querySelector('#indirizzo'),
  addItemButton: document.querySelector('#addItemButton'),
  addSectionButton: document.querySelector('#addSectionButton'),
  searchField: document.querySelector('#searchField'),
  globalDiscount: document.querySelector('#globalDiscount'),
  screenFontSizeQuick: document.querySelector('#screenFontSizeQuick'),
  screenDescriptionQuick: document.querySelector('#screenDescriptionQuick'),
  applyDiscountButton: document.querySelector('#applyDiscountButton'),
  rowsBody: document.querySelector('#rowsBody'),
  notes: document.querySelector('#notes'),
  vatPct: document.querySelector('#vatPct'),
  vatPrint: document.querySelector('#vatPrint'),
  grossSubtotal: document.querySelector('#grossSubtotal'),
  discountTotal: document.querySelector('#discountTotal'),
  subtotal: document.querySelector('#subtotal'),
  vatTotal: document.querySelector('#vatTotal'),
  grandTotal: document.querySelector('#grandTotal'),
  printSettingsModal: document.querySelector('#printSettingsModal'),
  closePrintSettingsButton: document.querySelector('#closePrintSettingsButton'),
  cancelPrintSettingsButton: document.querySelector('#cancelPrintSettingsButton'),
  resetPrintSettingsButton: document.querySelector('#resetPrintSettingsButton'),
  printNowButton: document.querySelector('#printNowButton'),
  screenFontSize: document.querySelector('#screenFontSize'),
  screenDescriptionDisplay: document.querySelector('#screenDescriptionDisplay'),
  printFontSize: document.querySelector('#printFontSize'),
  printOrientation: document.querySelector('#printOrientation'),
  printPageSize: document.querySelector('#printPageSize'),
  printFitToPage: document.querySelector('#printFitToPage'),
  printShowDiscount: document.querySelector('#printShowDiscount'),
  printShowNet: document.querySelector('#printShowNet'),
  printShowDetails: document.querySelector('#printShowDetails'),
  printShowNotes: document.querySelector('#printShowNotes'),
  printShowFullHeader: document.querySelector('#printShowFullHeader'),
  printDescriptionMode: document.querySelector('#printDescriptionMode'),
  printDescriptionLines: document.querySelector('#printDescriptionLines'),
  printDescriptionLinesField: document.querySelector('#printDescriptionLinesField'),
  printPreviewPage: document.querySelector('#printPreviewPage'),
  printPreviewText: document.querySelector('#printPreviewText'),
  printSettingsSummary: document.querySelector('#printSettingsSummary'),
  importReviewModal: document.querySelector('#importReviewModal'),
  closeImportReviewButton: document.querySelector('#closeImportReviewButton'),
  cancelImportReviewButton: document.querySelector('#cancelImportReviewButton'),
  confirmImportReviewButton: document.querySelector('#confirmImportReviewButton'),
  importReviewSummary: document.querySelector('#importReviewSummary'),
  importReviewWarnings: document.querySelector('#importReviewWarnings'),
  reviewTitle: document.querySelector('#reviewTitle'),
  reviewClient: document.querySelector('#reviewClient'),
  reviewAddress: document.querySelector('#reviewAddress'),
  reviewDate: document.querySelector('#reviewDate'),
  reviewRowsBody: document.querySelector('#reviewRowsBody'),
  firstPageModeModal: document.querySelector('#firstPageModeModal'),
  firstPageFileName: document.querySelector('#firstPageFileName'),
  firstPageModeHint: document.querySelector('#firstPageModeHint'),
  cancelFirstPageModeButton: document.querySelector('#cancelFirstPageModeButton'),
  confirmFirstPageModeButton: document.querySelector('#confirmFirstPageModeButton'),
}

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeSpaces(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeForMatch(value) {
  return normalizeSpaces(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function parseItalianNumber(value) {
  const cleaned = String(value ?? '')
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(/[’'´`]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : null
}

function isExactNumber(value) {
  const text = String(value ?? '').trim().replace(/\s/g, '')
  return /^-?(?:\d{1,3}(?:[.'’´`]\d{3})+|\d{1,9})(?:[.,]\d{1,4})?$/.test(text)
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
    .format(Number.isFinite(value) ? value : 0)
}

function formatNumber(value) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 4 }).format(Number(value) || 0)
}

function safeFilePart(value) {
  return (value || 'preventivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function escapeCsv(value) {
  return `"${String(value).replace(/"/g, '""')}"`
}

async function downloadBlob(blob, fileName) {
  if (IS_TAURI_DESKTOP) {
    try {
      const bytes = [...new Uint8Array(await blob.arrayBuffer())]
      return await window.__TAURI__.core.invoke('save_file_with_dialog', {
        suggestedName: fileName,
        bytes,
      })
    } catch (error) {
      console.error('Salvataggio desktop non riuscito', error)
      await appAlert(`Non è stato possibile salvare il file. ${error?.message || error || ''}`)
      return false
    }
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 500)
  return true
}

function netUnitPrice(row) {
  const discount = Math.min(Math.max(Number(row.discountPct) || 0, 0), 100)
  return (Number(row.unitPrice) || 0) * (1 - discount / 100)
}

function ownRowTotal(row) {
  if (!row.calculate || row.quantity === null || row.quantity === '') return 0
  return netUnitPrice(row) * (Number(row.quantity) || 0)
}

function childRowsFor(rowId) {
  return state.rows.filter(candidate => candidate.parentId === rowId)
}

function parentNumberForSubRows(parent) {
  const explicit = normalizeSpaces(parent?.code).match(/^(\d+[A-Za-z]?)/)
  if (explicit) return explicit[1]
  const items = state.rows.filter(candidate => candidate.kind === 'item' && !candidate.parentId)
  const index = items.findIndex(candidate => candidate.id === parent?.id)
  return index >= 0 ? String(index + 1) : ''
}

function synchronizeSubRowNumbers() {
  let changed = false
  state.rows.filter(row => row.kind === 'item' && !row.parentId).forEach(parent => {
    const prefix = parentNumberForSubRows(parent)
    let sequence = 0
    childRowsFor(parent.id).forEach(child => {
      if (child.kind === 'detail') {
        sequence += 1
        const nextCode = prefix ? `${prefix}.${sequence}` : String(sequence)
        if (!child.autoSubNumber) {
          child.codeBeforeAutoSubNumber = child.code || ''
          child.autoSubNumber = true
          changed = true
        }
        if (child.code !== nextCode) {
          child.code = nextCode
          changed = true
        }
      } else if (child.autoSubNumber) {
        child.code = child.codeBeforeAutoSubNumber || ''
        delete child.codeBeforeAutoSubNumber
        delete child.autoSubNumber
        changed = true
      }
    })
  })
  return changed
}

function calculatedChildrenFor(rowId) {
  return childRowsFor(rowId).filter(candidate => candidate.calculate)
}

// Una sottovoce deve sostituire economicamente la voce principale solo quando
// contiene davvero un prezzo/importo. Le sottorighe di sola misurazione con
// prezzo 0 restano informative e non devono azzerare il totale del padre.
function hasEconomicPrice(row) {
  if (!row?.calculate) return false
  const unitPrice = Number(row.unitPrice)
  const sourceTotal = Number(row.sourceTotal)
  return (Number.isFinite(unitPrice) && Math.abs(unitPrice) > 0.0000001)
    || (Number.isFinite(sourceTotal) && Math.abs(sourceTotal) > 0.0000001)
}

function pricedChildrenFor(rowId) {
  return childRowsFor(rowId).filter(hasEconomicPrice)
}

function rowGrossTotal(row) {
  if (!row.calculate || row.quantity === null || row.quantity === '') return 0
  return (Number(row.unitPrice) || 0) * (Number(row.quantity) || 0)
}

function effectiveGrossTotal(row) {
  if (row.kind === 'item' && pricedChildrenFor(row.id).length) return 0
  return rowGrossTotal(row)
}

function effectiveNetTotal(row) {
  if (row.kind === 'item' && pricedChildrenFor(row.id).length) return 0
  return ownRowTotal(row)
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('Salvataggio completo non riuscito; provo senza immagine della copertina.', error)
    const compact = clone(state)
    if (compact.cover) compact.cover.backgroundDataUrl = ''
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(compact)) } catch {}
  }
}

function normalizeProject(project, fallbackPrintSettings = defaultPrintSettings()) {
  const base = emptyProject()
  return {
    ...base,
    ...project,
    header: { ...base.header, ...(project?.header || {}) },
    cover: { ...emptyCover(), ...(project?.cover || {}), blocks: Array.isArray(project?.cover?.blocks) ? project.cover.blocks : [], originalBlocks: Array.isArray(project?.cover?.originalBlocks) ? project.cover.originalBlocks : [] },
    rows: Array.isArray(project?.rows) ? project.rows : [],
    printSettings: { ...defaultPrintSettings(), ...fallbackPrintSettings, ...(project?.printSettings || {}) },
  }
}

function load() {
  try {
    let saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!saved) {
      for (const key of LEGACY_STORAGE_KEYS) {
        const legacy = JSON.parse(localStorage.getItem(key) || 'null')
        if (legacy) {
          saved = legacy
          break
        }
      }
    }
    if (saved?.header && Array.isArray(saved?.rows)) {
      state = normalizeProject(saved)
      save()
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
}

function getPrintSettings() {
  state.printSettings = { ...defaultPrintSettings(), ...(state.printSettings || {}) }
  return state.printSettings
}

function pageContentWidthMm(settings) {
  const widths = {
    'A4-landscape': 281,
    'A4-portrait': 194,
    'A3-landscape': 404,
    'A3-portrait': 281,
  }
  return widths[`${settings.pageSize}-${settings.orientation}`] || 281
}

function pageCssSize(settings) {
  const sizes = {
    'A4-landscape': '297mm 210mm',
    'A4-portrait': '210mm 297mm',
    'A3-landscape': '420mm 297mm',
    'A3-portrait': '297mm 420mm',
  }
  return sizes[`${settings.pageSize}-${settings.orientation}`] || '297mm 210mm'
}

function screenDescriptionValue(settings = getPrintSettings()) {
  const lines = Math.min(Math.max(Number(settings.screenDescriptionLines) || 4, 1), 12)
  return settings.screenDescriptionMode === 'limited' ? String(lines) : 'full'
}

function applyScreenDescriptionLayout() {
  const settings = getPrintSettings()
  const limited = settings.screenDescriptionMode === 'limited'
  const lines = Math.min(Math.max(Number(settings.screenDescriptionLines) || 4, 1), 12)
  settings.screenDescriptionLines = lines
  document.body.classList.toggle('screen-limit-description', limited)
  document.documentElement.style.setProperty('--screen-description-lines', String(lines))

  requestAnimationFrame(() => {
    document.querySelectorAll('.description-textarea').forEach(textarea => {
      textarea.style.height = 'auto'
      if (limited) {
        const computed = getComputedStyle(textarea)
        const lineHeight = Number.parseFloat(computed.lineHeight) || ((Number(settings.screenFontSize) || 11) * 1.35)
        const padding = (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0)
        const border = (Number.parseFloat(computed.borderTopWidth) || 0) + (Number.parseFloat(computed.borderBottomWidth) || 0)
        const targetHeight = Math.ceil(lineHeight * lines + padding + border)
        textarea.style.height = `${targetHeight}px`
        textarea.style.overflowY = textarea.scrollHeight > targetHeight + 1 ? 'auto' : 'hidden'
        textarea.style.resize = 'none'
      } else {
        textarea.style.height = `${Math.max(textarea.scrollHeight, 48)}px`
        textarea.style.overflowY = 'hidden'
        textarea.style.resize = 'vertical'
      }
    })
  })
}

function applyScreenSettings() {
  const settings = getPrintSettings()
  const size = Math.min(Math.max(Number(settings.screenFontSize) || 11, 9), 16)
  settings.screenFontSize = size
  const root = document.documentElement
  root.style.setProperty('--screen-font-size', `${size}px`)
  root.style.setProperty('--screen-small-size', `${Math.max(size - 1, 8)}px`)
  root.style.setProperty('--screen-meta-size', `${Math.max(size - 2, 8)}px`)
  root.style.setProperty('--screen-money-size', `${size}px`)
  root.style.setProperty('--screen-total-summary-size', `${size}px`)
  root.style.setProperty('--screen-grand-total-size', `${Math.max(size + 2, 11)}px`)
  root.style.setProperty('--screen-title-size', `${Math.max(size + 7, 16)}px`)
  root.style.setProperty('--screen-textarea-min-height', `${Math.max(48, Math.round(size * 4.4))}px`)
  if (el.screenFontSizeQuick) el.screenFontSizeQuick.value = String(size)
  if (el.screenFontSize) el.screenFontSize.value = String(size)
  const descriptionValue = screenDescriptionValue(settings)
  if (el.screenDescriptionQuick) el.screenDescriptionQuick.value = descriptionValue
  if (el.screenDescriptionDisplay) el.screenDescriptionDisplay.value = descriptionValue
  applyScreenDescriptionLayout()
}

function updatePrintPreview() {
  const settings = getPrintSettings()
  const orientationLabel = settings.orientation === 'portrait' ? 'Verticale' : 'Orizzontale'
  el.printPreviewPage.className = `print-preview-page ${settings.orientation} ${settings.pageSize.toLowerCase()}`
  el.printPreviewText.style.fontSize = `${Math.max(8, settings.fontSize + 1)}px`
  const screenDescriptionLabel = settings.screenDescriptionMode === 'limited' ? `video ${settings.screenDescriptionLines} righe` : 'video descr. completa'
  const descriptionLabel = settings.descriptionMode === 'limited' ? `stampa ${settings.descriptionLines} righe` : 'stampa descr. completa'
  el.printSettingsSummary.textContent = `Video ${settings.screenFontSize} px · ${screenDescriptionLabel} · ${settings.pageSize} · ${orientationLabel} · ${settings.fontSize} pt · ${descriptionLabel}`
  el.printSettingsButton.textContent = `Video ${settings.screenFontSize} px · ${settings.pageSize} ${settings.orientation === 'portrait' ? 'vert.' : 'orizz.'} · ${settings.fontSize} pt`
  if (el.printDescriptionLinesField) el.printDescriptionLinesField.classList.toggle('setting-disabled', settings.descriptionMode !== 'limited')
  if (el.printDescriptionLines) el.printDescriptionLines.disabled = settings.descriptionMode !== 'limited'
}

function applyPrintSettings() {
  const settings = getPrintSettings()
  applyScreenSettings()
  const root = document.documentElement
  const body = document.body
  root.style.setProperty('--print-font-size', `${settings.fontSize}pt`)
  root.style.setProperty('--print-heading-size', `${Math.max(settings.fontSize + 5, 11)}pt`)
  root.style.setProperty('--print-small-size', `${Math.max(settings.fontSize - 0.7, 5.5)}pt`)
  root.style.setProperty('--print-note-size', `${Math.max(settings.fontSize, 6)}pt`)

  body.classList.toggle('print-hide-discount', !settings.showDiscount)
  body.classList.toggle('print-hide-net', !settings.showNet)
  body.classList.toggle('print-hide-details', !settings.showDetails)
  body.classList.toggle('print-hide-notes', !settings.showNotes)
  body.classList.toggle('print-hide-header', !settings.showFullHeader)
  body.classList.toggle('print-limit-description', settings.descriptionMode === 'limited')
  body.classList.toggle('print-fit-page', Boolean(settings.fitToPage))
  body.dataset.printOrientation = settings.orientation
  body.dataset.printPageSize = settings.pageSize

  let style = document.querySelector('#dynamicPrintStyle')
  if (!style) {
    style = document.createElement('style')
    style.id = 'dynamicPrintStyle'
    document.head.append(style)
  }
  const pageWidth = pageContentWidthMm(settings)
  // La stampa deve sempre rimanere entro l'area utile della pagina.
  // L'opzione "Adatta" controlla la densità, non permette più alla tabella
  // di uscire dai margini o di tagliare la colonna Totale.
  const sheetWidth = `${pageWidth}mm`
  const maxWidth = `${pageWidth}mm`
  root.style.setProperty('--print-page-width', `${pageWidth}mm`)
  const descriptionLines = Math.min(Math.max(Number(settings.descriptionLines) || 4, 1), 12)
  const cssPageSize = pageCssSize(settings)
  style.textContent = `
    @page { size: ${cssPageSize}; margin: 8mm; }
    @media print {
      :root { --print-page-width: ${pageWidth}mm; }
      .document-sheet { width: ${sheetWidth} !important; max-width: ${maxWidth} !important; margin-left: auto !important; margin-right: auto !important; }
      body.print-limit-description .print-description {
        display: -webkit-box !important;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: ${descriptionLines};
        max-height: ${descriptionLines * 1.22}em;
        overflow: hidden !important;
      }
    }
  `
  updatePrintPreview()
}

function syncPrintSettingsControls() {
  const settings = getPrintSettings()
  el.screenFontSize.value = String(settings.screenFontSize)
  el.screenFontSizeQuick.value = String(settings.screenFontSize)
  const screenDescription = screenDescriptionValue(settings)
  el.screenDescriptionDisplay.value = screenDescription
  el.screenDescriptionQuick.value = screenDescription
  el.printFontSize.value = String(settings.fontSize)
  el.printOrientation.value = settings.orientation
  el.printPageSize.value = settings.pageSize
  el.printFitToPage.checked = Boolean(settings.fitToPage)
  el.printShowDiscount.checked = Boolean(settings.showDiscount)
  el.printShowNet.checked = Boolean(settings.showNet)
  el.printShowDetails.checked = Boolean(settings.showDetails)
  el.printShowNotes.checked = Boolean(settings.showNotes)
  el.printShowFullHeader.checked = Boolean(settings.showFullHeader)
  el.printDescriptionMode.value = settings.descriptionMode === 'limited' ? 'limited' : 'full'
  el.printDescriptionLines.value = String(Math.min(Math.max(Number(settings.descriptionLines) || 4, 1), 12))
  applyPrintSettings()
}

function openPrintSettings() {
  syncPrintSettingsControls()
  el.printSettingsModal.hidden = false
  document.body.classList.add('modal-open')
}

function closePrintSettings() {
  el.printSettingsModal.hidden = true
  document.body.classList.remove('modal-open')
}

function updatePrintSettingsFromControls() {
  state.printSettings = {
    screenFontSize: Math.min(Math.max(Number(el.screenFontSize.value) || 11, 9), 16),
    screenDescriptionMode: el.screenDescriptionDisplay.value === 'full' ? 'full' : 'limited',
    screenDescriptionLines: el.screenDescriptionDisplay.value === 'full' ? 4 : Math.min(Math.max(Number(el.screenDescriptionDisplay.value) || 4, 1), 12),
    fontSize: Number(el.printFontSize.value) || 7,
    orientation: el.printOrientation.value === 'portrait' ? 'portrait' : 'landscape',
    pageSize: el.printPageSize.value === 'A3' ? 'A3' : 'A4',
    fitToPage: el.printFitToPage.checked,
    showDiscount: el.printShowDiscount.checked,
    showNet: el.printShowNet.checked,
    showDetails: el.printShowDetails.checked,
    showNotes: el.printShowNotes.checked,
    showFullHeader: el.printShowFullHeader.checked,
    descriptionMode: el.printDescriptionMode.value === 'limited' ? 'limited' : 'full',
    descriptionLines: Math.min(Math.max(Number(el.printDescriptionLines.value) || 4, 1), 12),
  }
  save()
  applyPrintSettings()
}

function staticPrintControl(control, ownerDocument) {
  const tag = control.tagName.toLowerCase()
  const replacement = ownerDocument.createElement(tag === 'textarea' ? 'div' : 'span')
  replacement.className = `${control.className || ''} print-static-control`.trim()
  replacement.removeAttribute('id')

  if (tag === 'select') {
    replacement.textContent = control.selectedOptions?.[0]?.textContent || control.value || ''
  } else if (tag === 'input' && ['checkbox', 'radio'].includes(String(control.type).toLowerCase())) {
    replacement.textContent = control.checked ? '✓' : ''
  } else {
    replacement.textContent = control.value || ''
  }

  if (tag === 'textarea') replacement.style.whiteSpace = 'pre-wrap'
  return replacement
}


function buildPrintableClone() {
  const source = el.documentSheet
  const clone = source.cloneNode(true)

  // IMPORTANTE: i controlli vanno sincronizzati PRIMA di eliminare i blocchi
  // .no-print. Se si eliminano prima, gli indici tra DOM vivo e clone slittano
  // e valori come “11 px” o “Azioni riga…” finiscono nelle celle del computo.
  const sourceControls = [...source.querySelectorAll('input, textarea, select')]
  const cloneControls = [...clone.querySelectorAll('input, textarea, select')]
  cloneControls.forEach((control, index) => {
    const liveControl = sourceControls[index]
    if (!liveControl) {
      control.remove()
      return
    }

    // Le descrizioni hanno già un gemello .print-description aggiornato in
    // tempo reale. Non stampiamo anche il textarea statico, altrimenti il testo
    // comparirebbe due volte.
    if (liveControl.classList.contains('description-textarea')) {
      control.remove()
      return
    }

    control.replaceWith(staticPrintControl(liveControl, clone.ownerDocument))
  })

  // Solo dopo la sincronizzazione si eliminano toolbar, menu, pulsanti e
  // controlli strutturali non destinati alla stampa.
  clone.querySelectorAll('.no-print').forEach(node => node.remove())
  clone.querySelectorAll('[hidden]').forEach(node => node.remove())
  clone.querySelectorAll('script').forEach(node => node.remove())

  clone.querySelectorAll('.print-only').forEach(node => {
    node.style.display = 'block'
  })
  clone.querySelectorAll('.print-description').forEach(node => {
    node.style.display = 'block'
  })

  return clone
}

function clearDesktopPrintSnapshot() {
  if (desktopPrintCleanupTimer) {
    clearTimeout(desktopPrintCleanupTimer)
    desktopPrintCleanupTimer = null
  }
  document.querySelector('#desktopPrintHost')?.remove()
  document.body.classList.remove('desktop-print-snapshot')
}

function prepareDesktopPrintSnapshot() {
  clearDesktopPrintSnapshot()
  applyPrintSettings()

  const host = document.createElement('div')
  host.id = 'desktopPrintHost'
  host.setAttribute('aria-hidden', 'true')
  host.append(buildPrintableClone())
  document.body.append(host)
  document.body.classList.add('desktop-print-snapshot')

  // Fallback: la WebView non emette sempre afterprint quando si annulla.
  desktopPrintCleanupTimer = setTimeout(clearDesktopPrintSnapshot, 5 * 60 * 1000)
  return host
}

window.addEventListener('afterprint', clearDesktopPrintSnapshot)

function buildPrintableDocument() {
  applyPrintSettings()

  const clone = buildPrintableClone()

  const settings = getPrintSettings()
  const dynamicStyle = document.querySelector('#dynamicPrintStyle')?.textContent || ''
  const stylesheetUrl = new URL('styles.css?v=1.0.0-ai-beta6-2-6-print-regression', window.location.href).href
  const printBodyClasses = [...document.body.classList].filter(name => name.startsWith('print-')).join(' ')
  const rootStyle = [
    `--print-font-size:${settings.fontSize}pt`,
    `--print-heading-size:${Math.max(settings.fontSize + 5, 11)}pt`,
    `--print-small-size:${Math.max(settings.fontSize - 0.7, 5.5)}pt`,
    `--print-note-size:${Math.max(settings.fontSize, 6)}pt`,
    `--print-page-width:${pageContentWidthMm(settings)}mm`,
  ].join(';')

  return `<!doctype html>
<html lang="it" style="${rootStyle}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Preventivi Clone AI — Stampa</title>
  <link rel="stylesheet" href="${stylesheetUrl}">
  <style>
    ${dynamicStyle}
    html, body { background: #fff !important; }
    body { margin: 0; padding: 0; color: #111; }
    .print-launchbar {
      position: sticky; top: 0; z-index: 99999; display: flex; justify-content: center;
      gap: 12px; padding: 12px; background: #17324d; box-shadow: 0 4px 18px rgba(0,0,0,.18);
    }
    .print-launchbar button {
      appearance: none; border: 0; border-radius: 9px; padding: 11px 20px;
      font: 700 14px system-ui,-apple-system,"Segoe UI",sans-serif; cursor: pointer;
    }
    .print-launchbar .print-action { background: #fff; color: #17324d; }
    .print-launchbar .close-action { background: #dbe5ec; color: #17324d; }
    .print-window-content { padding: 12px; }
    .print-window-content .document-sheet {
      width: var(--print-page-width, 281mm); max-width: var(--print-page-width, 281mm); margin: 0 auto; box-shadow: none; border: 0;
    }
    .print-static-control { box-sizing: border-box; white-space: pre-wrap; overflow-wrap: anywhere; }
    .document-title.print-static-control { display: block; width: 100%; text-align: center; font-weight: 800; }
    .sender-field.print-static-control, .date-field.print-static-control { display: block; width: 100%; }
    .sheet-table .print-static-control { display: block; width: 100%; min-height: 1em; }
    .print-only, .print-description { display: block !important; }
    @media print {
      .print-launchbar { display: none !important; }
      .print-window-content { padding: 0 !important; }
    }
  </style>
</head>
<body class="${printBodyClasses}" data-print-orientation="${settings.orientation}" data-print-page-size="${settings.pageSize}">
  <div class="print-launchbar">
    <button class="print-action" type="button" onclick="window.focus(); window.print()">Stampa / Salva PDF</button>
    <button class="close-action" type="button" onclick="window.close()">Chiudi</button>
  </div>
  <main class="print-window-content">${clone.outerHTML}</main>
  <script>
    window.addEventListener('load', function () {
      window.focus();
      setTimeout(function () {
        try { window.print(); } catch (_) {}
      }, 450);
    });
  <\/script>
</body>
</html>`
}

async function printDocument(event) {
  event?.preventDefault?.()
  event?.stopPropagation?.()

  if (!state.rows.length) {
    await appAlert('Non ci sono voci da stampare.')
    return
  }

  if (!el.printSettingsModal.hidden) updatePrintSettingsFromControls()
  applyPrintSettings()
  closePrintSettings()
  const settings = getPrintSettings()

  if (IS_TAURI_DESKTOP) {
    try {
      // Creiamo una fotografia statica del solo preventivo: la WebView nativa
      // non deve più impaginare toolbar, campi editabili o larghezze video.
      prepareDesktopPrintSnapshot()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await window.__TAURI__.core.invoke('print_current_window', {
        orientation: settings.orientation,
      })
      return
    } catch (error) {
      clearDesktopPrintSnapshot()
      console.error('Stampa desktop non disponibile', error)
      await appAlert(`Non è stato possibile aprire la stampa. ${error?.message || error || ''}`)
      return
    }
  }

  // La finestra viene aperta direttamente dal clic dell'utente. Questo evita
  // i blocchi di stampa di Safari, Chrome e delle WebView quando window.print()
  // viene invocato dalla pagina applicativa complessa.
  let printWindow = null
  try {
    printWindow = window.open('', '_blank', 'width=1280,height=900')
  } catch (_) {
    printWindow = null
  }

  if (!printWindow) {
    try {
      window.focus()
      window.print()
    } catch (error) {
      console.error('Stampa non disponibile', error)
      await appAlert('Il browser ha bloccato la finestra di stampa. Consenti i popup per questo sito e riprova.')
    }
    return
  }

  try {
    printWindow.document.open()
    printWindow.document.write(buildPrintableDocument())
    printWindow.document.close()
  } catch (error) {
    console.error('Preparazione stampa non riuscita', error)
    try { printWindow.close() } catch (_) {}
    await appAlert('Non è stato possibile preparare il documento di stampa. Ricarica la pagina e riprova.')
  }
}

function explodeTextItem(item, page, pageWidth, pageHeight) {
  const raw = String(item.str ?? '')
  const x = Number(item.transform?.[4] ?? 0)
  const y = Number(item.transform?.[5] ?? 0)
  const width = Math.max(Number(item.width ?? 0), 1)
  const height = Math.max(Math.abs(Number(item.height ?? item.transform?.[3] ?? 8)), 4)
  const matches = [...raw.matchAll(/\S+/g)]
  if (matches.length <= 1) {
    return raw.trim() ? [{ text: raw.trim(), x, y, width, height, fontName: item.fontName || '', page, pageWidth, pageHeight }] : []
  }
  return matches.map(match => {
    const start = match.index ?? 0
    return {
      text: match[0],
      x: x + width * (start / Math.max(raw.length, 1)),
      y,
      width: Math.max(width * (match[0].length / Math.max(raw.length, 1)), 1),
      height,
      fontName: item.fontName || '',
      page,
      pageWidth,
      pageHeight,
    }
  })
}


function coverBlocksFromLines(lines, pageWidth, pageHeight) {
  const blocks = []
  for (const line of lines.filter(candidate => candidate.page === 1)) {
    const tokens = line.tokens || []
    if (!tokens.length || !normalizeSpaces(line.text)) continue
    const left = Math.min(...tokens.map(token => token.x))
    const right = Math.max(...tokens.map(token => token.x + token.width))
    const maxHeight = Math.max(...tokens.map(token => token.height || 8))
    const top = Math.max(0, pageHeight - line.y - maxHeight * 1.05)
    const fontName = tokens.map(token => token.fontName || '').join(' ')
    const bold = /bold|black|heavy|demi/i.test(fontName) || /^[^a-zà-öø-ÿ]*[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ\s\d.,:;()'\-/]+$/.test(line.text)
    const center = (left + right) / 2
    const centered = Math.abs(center - pageWidth / 2) < pageWidth * .07 && right - left > pageWidth * .24
    blocks.push({
      id: id(), text: line.text,
      xPct: Math.max(0, left / pageWidth * 100),
      yPct: Math.max(0, top / pageHeight * 100),
      wPct: Math.min(100 - left / pageWidth * 100, Math.max(5, (right - left) / pageWidth * 100 + 1.2)),
      hPct: Math.max(1.7, maxHeight / pageHeight * 100 * 1.45),
      fontPt: Math.max(5.5, Math.min(24, maxHeight * .82)),
      bold, align: centered ? 'center' : 'left',
    })
  }
  return blocks
}

async function renderFirstPageBackground(page) {
  try {
    const viewport = page.getViewport({ scale: 1.35 })
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { alpha: false })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    return canvas.toDataURL('image/jpeg', .76)
  } catch (error) {
    console.warn('Impossibile creare lo sfondo della prima pagina.', error)
    return ''
  }
}

function isLikelyCoverPage(lines, primus) {
  const first = lines.filter(line => line.page === 1)
  const text = normalizeForMatch(first.map(line => line.text).join(' '))
  const numberedItems = first.filter(line => /^\d{1,4}[a-z]?\s+\D/i.test(line.text) && (line.tokens?.[0]?.x ?? 999) < (line.pageWidth || 595) * .15).length
  if (primus && /computo metrico|elenco prezzi|quadro economico/.test(text)) return true
  if (/oggetto\s*:|committente\s*:|il tecnico|data\s*,/.test(text) && numberedItems === 0) return true
  return first.length <= 24 && numberedItems === 0 && /preventivo|offerta|computo|capitolato/.test(text)
}

function reconstructLines(tokens) {
  const sorted = [...tokens].sort((a, b) => Math.abs(b.y - a.y) > 2.8 ? b.y - a.y : a.x - b.x)
  const groups = []
  for (const token of sorted) {
    const tolerance = Math.max(2.5, token.height * 0.34)
    const group = groups.find(candidate => Math.abs(candidate.y - token.y) <= tolerance)
    if (group) group.tokens.push(token)
    else groups.push({ y: token.y, tokens: [token] })
  }
  return groups
    .sort((a, b) => b.y - a.y)
    .map(group => {
      const lineTokens = group.tokens.sort((a, b) => a.x - b.x)
      const first = lineTokens[0]
      return {
        page: first.page,
        y: group.y,
        pageWidth: first.pageWidth,
        pageHeight: first.pageHeight,
        tokens: lineTokens,
        text: normalizeSpaces(lineTokens.map(token => token.text).join(' ')),
      }
    })
    .filter(line => line.text)
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function strongestCluster(values, tolerance = 13) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const clusters = []
  for (const value of sorted) {
    const cluster = clusters.find(candidate => Math.abs((median(candidate) ?? value) - value) <= tolerance)
    if (cluster) cluster.push(value)
    else clusters.push([value])
  }
  clusters.sort((a, b) => b.length - a.length)
  return median(clusters[0])
}

function allClusters(values, tolerance = 13) {
  if (!values.length) return []
  const sorted = [...values].sort((a, b) => a - b)
  const clusters = []
  for (const value of sorted) {
    const cluster = clusters.find(candidate => Math.abs((median(candidate) ?? value) - value) <= tolerance)
    if (cluster) cluster.push(value)
    else clusters.push([value])
  }
  return clusters
    .map(cluster => ({ center: median(cluster) ?? 0, count: cluster.length }))
    .sort((a, b) => a.center - b.center)
}

function canonicalUnitAt(tokens, index) {
  const current = String(tokens[index]?.text ?? '').toUpperCase().replace(/[.,:]$/g, '')
  const next = String(tokens[index + 1]?.text ?? '').toUpperCase().replace(/[.,:]$/g, '')
  if (current === 'A' && next === 'CORPO') return { unit: 'A CORPO', length: 2 }
  const found = UNITS.find(unit => unit !== 'A CORPO' && current === unit)
  return found ? { unit: found, length: 1 } : null
}

function headerPosition(lines, patterns) {
  const positions = []
  for (const line of lines) {
    for (const token of line.tokens) {
      const normalized = normalizeForMatch(token.text)
      if (patterns.some(pattern => pattern.test(normalized))) positions.push(token.x)
    }
  }
  return median(positions)
}

function detectColumns(lines) {
  const pageWidth = median(lines.map(line => line.pageWidth)) ?? 595
  const unitXs = []
  const currencyNumberXs = []
  const numberXs = []
  const itemDescriptionXs = []

  for (const line of lines) {
    for (let index = 0; index < line.tokens.length; index += 1) {
      const token = line.tokens[index]
      const unit = canonicalUnitAt(line.tokens, index)
      if (unit) unitXs.push(token.x)
      if (token.text === '€' && isExactNumber(line.tokens[index + 1]?.text ?? '')) {
        currencyNumberXs.push(line.tokens[index + 1].x)
      }
      if (isExactNumber(token.text) && token.x > pageWidth * 0.42 && token.x < pageWidth * 0.92) {
        const parsed = parseItalianNumber(token.text)
        if (parsed !== null && !(parsed >= 1900 && parsed <= 2100)) numberXs.push(token.x)
      }
    }
    const start = line.text.match(/^(\d{1,4}[A-Za-z]?)\s+\D/)
    if (start && line.tokens.length > 1 && line.tokens[0].x < pageWidth * 0.14) {
      const secondToken = line.tokens[1]
      // Se il numero articolo è centrato verticalmente, sulla sua stessa riga
      // può comparire direttamente l'unità di misura. Non usarla come inizio
      // della descrizione, altrimenti la colonna testo viene spostata a destra.
      if (secondToken.x < pageWidth * 0.48 && !canonicalUnitAt(line.tokens, 1)) itemDescriptionXs.push(secondToken.x)
    }
  }

  const headerLines = lines.filter(line => /(designazione|descrizione|articolo|quantita|qta|unitario|totale|importo|u\. mis|unita)/.test(normalizeForMatch(line.text)))
  const descriptionHeaderX = headerPosition(headerLines, [/^descrizione$/, /^designazione$/, /^articolo$/])
  const unitHeaderX = headerPosition(headerLines, [/^u\.?m\.?$/, /^u\.?$/, /^mis\.?$/, /^um$/, /^unita$/])
  const quantityHeaderX = headerPosition(headerLines, [/^quantita$/, /^qta$/, /^q\.ta$/])
  const unitPriceHeaderX = headerPosition(headerLines, [/^unitario$/, /^p\.u\.?$/])
  const totalHeaderX = headerPosition(headerLines, [/^totale$/, /^importo$/])

  const unitX = strongestCluster(unitXs) ?? unitHeaderX ?? pageWidth * 0.55
  const currencyClusters = allClusters(currencyNumberXs, 12).filter(cluster => cluster.count >= 2)
  const priceX = currencyClusters[0]?.center ?? unitPriceHeaderX
  const totalX = currencyClusters[1]?.center ?? totalHeaderX
  const quantityCandidates = numberXs.filter(x => x >= unitX + 8 && x <= (priceX ?? pageWidth * 0.78) - 8)
  const quantityX = strongestCluster(quantityCandidates, 13) ?? quantityHeaderX ?? pageWidth * 0.64
  const descriptionStart = median(itemDescriptionXs) ?? descriptionHeaderX ?? pageWidth * 0.08

  return { pageWidth, codeRight: Math.max(descriptionStart - 7, pageWidth * 0.055), descriptionStart, unitX, quantityX, priceX: priceX ?? null, totalX: totalX ?? null }
}

function detectHeader(lines) {
  const firstPage = lines.filter(line => line.page === 1).slice(0, 40)
  const texts = firstPage.map(line => line.text)
  const propertyLine = texts.find(line => /propriet[aà]'?/i.test(line)) ?? ''
  const clientMatch = propertyLine.match(/propriet[aà]'?\s*[:\-]?\s*(.+?)(?:\s+-\s+|$)/i)
  const dateRegex = new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\s+20\\d{2}\\b`, 'i')
  const dateLine = texts.find(line => dateRegex.test(line)) ?? ''
  const dateMatch = dateLine.match(dateRegex)
  const mittente = texts.find(line => /studio|societ[aà]|impresa|ditta|arch\.|ing\./i.test(line) && line.length < 130) ?? ''
  const titleCandidates = texts.filter(line => {
    const normalized = normalizeForMatch(line)
    if (/designazione|quantita|prezzo|unitario|totale|formule/.test(normalized)) return false
    return /(ristrutturazione|computo|preventivo|offerta|lavori|manutenzione)/.test(normalized)
  })
  const title = normalizeSpaces(titleCandidates.slice(0, 2).join(' - '))
  const address = texts.find(line => /\b(via|viale|piazza|corso|loc\.)\b/i.test(line) && !/studio|tel|mail/i.test(line)) ?? ''
  return { titolo: title, cliente: normalizeSpaces(clientMatch?.[1] ?? ''), indirizzo: normalizeSpaces(address), dataDocumento: dateMatch?.[0] ?? '', mittente: normalizeSpaces(mittente) }
}

function isRepeatedHeader(line) {
  const text = normalizeForMatch(line.text)
  if (/^impianti e materiali\b/.test(text)) return false
  return /^studio\b/.test(text) || /tel\.?\s*\d|mail\s*:|@/.test(text) || /designazione dei lavori|descrizione.*quantita/.test(text) || /^n[°º]?\s*rif/.test(text) || /^u\.?\s*mis/.test(text) || /prezzo\s+prezzo|unitario\s+totale/.test(text) || /formule quantita/.test(text)
}

function isMetadataTitle(line) {
  const text = normalizeForMatch(line.text)
  if (line.page !== 1 || line.y < line.pageHeight * 0.86) return false
  return /ristrutturazione|proprieta|preventivo|offerta|computo/.test(text)
}

function isSectionLine(line) {
  const text = normalizeSpaces(line.text)
  const normalized = normalizeForMatch(text).replace(/^[-–—\s]+|[-–—\s]+$/g, '')
  const knownSection = /^(opere edili|impianti e materiali|opere elettriche|opere idrauliche|opere da fabbro|forniture|materiali)(?:\s|$)/.test(normalized)
  if (knownSection && text.length < 100) return true
  if (/\d|€/.test(text) || findUnit(line)) return false
  const firstX = line.tokens[0]?.x ?? 0
  if (firstX < line.pageWidth * 0.15) return false
  const letters = text.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '')
  if (letters.length < 6 || text.length > 70) return false
  const uppercase = letters.replace(/[^A-ZÀ-ÖØ-Þ]/g, '').length / letters.length
  return uppercase > 0.9 && !/totale|iva|proprieta|ristrutturazione/.test(normalized)
}

function isTotalLine(line) {
  return /^(totale|iva)\b/i.test(normalizeSpaces(line.text))
}

function findUnit(line, model = null) {
  for (let index = 0; index < line.tokens.length; index += 1) {
    const token = line.tokens[index]
    if (model && Math.abs(token.x - model.unitX) > 48) continue
    const found = canonicalUnitAt(line.tokens, index)
    if (found) return { unit: found.unit, tokenIndex: index, tokenLength: found.length }
  }
  return null
}

function numericTokenNear(tokens, targetX, minX, maxX, maxDistance = 36) {
  const candidates = tokens.filter(token => {
    if (!isExactNumber(token.text) || token.x < minX || token.x > maxX) return false
    const value = parseItalianNumber(token.text)
    return value !== null && !(value >= 1900 && value <= 2100)
  })
  candidates.sort((a, b) => Math.abs(a.x - targetX) - Math.abs(b.x - targetX))
  const nearest = candidates[0] ?? null
  return nearest && Math.abs(nearest.x - targetX) <= maxDistance ? nearest : null
}

function currencyValues(line) {
  const values = []
  for (let index = 0; index < line.tokens.length; index += 1) {
    if (line.tokens[index].text === '€') {
      const value = parseItalianNumber(line.tokens[index + 1]?.text ?? '')
      if (value !== null) values.push(value)
    }
  }
  return values
}

function textFromTokens(tokens) {
  return normalizeSpaces(tokens.filter(token => token.text !== '€').map(token => token.text).join(' '))
}

function extractMeasurement(line, model) {
  const unitFound = findUnit(line, model)
  if (!unitFound) return null
  const unitToken = line.tokens[unitFound.tokenIndex]
  const quantityToken = numericTokenNear(
    line.tokens.slice(unitFound.tokenIndex + unitFound.tokenLength),
    model.quantityX,
    unitToken.x + 3,
    (model.priceX ?? model.pageWidth * 0.82) - 4,
  )
  const commercial = currencyValues(line)
  const beforeTokens = line.tokens.filter((token, index) => index < unitFound.tokenIndex && token.x >= model.descriptionStart - 4)
  return {
    line,
    unit: unitFound.unit,
    quantity: quantityToken ? parseItalianNumber(quantityToken.text) : null,
    unitPrice: commercial[0] ?? 0,
    sourceTotal: commercial[1] ?? null,
    textBefore: textFromTokens(beforeTokens),
    firstTextX: beforeTokens[0]?.x ?? unitToken.x,
  }
}

function extractDetail(line, model) {
  if (findUnit(line, model)) return null
  const quantityToken = numericTokenNear(line.tokens, model.quantityX, model.descriptionStart + 15, (model.priceX ?? model.pageWidth * 0.82) - 4)
  if (!quantityToken) return null
  const descriptionTokens = line.tokens.filter(token => token.x >= model.descriptionStart + 8 && token.x < quantityToken.x - 3)
  const description = textFromTokens(descriptionTokens)
  if (description.length < 3) return null
  return { line, description, quantity: parseItalianNumber(quantityToken.text), firstTextX: descriptionTokens[0]?.x ?? model.descriptionStart }
}

function cleanMainLine(line, model, removeCode = false) {
  let tokens = line.tokens.filter(token => token.x >= model.descriptionStart - 4 && token.x < model.unitX - 6)
  if (removeCode && tokens.length && /^\d{1,4}[A-Za-z]?$/.test(tokens[0].text)) tokens = tokens.slice(1)
  return textFromTokens(tokens)
}


function canonicalizeUnitText(value) {
  const normalized = normalizeForMatch(value)
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^a\s*corpo$/.test(normalized)) return 'A CORPO'
  if (/^(mq|m2|m²)$/.test(normalized)) return 'MQ'
  if (/^(mc|m3|m³)$/.test(normalized)) return 'MC'
  if (/^(ml)$/.test(normalized)) return 'ML'
  if (/^(kg)$/.test(normalized)) return 'KG'
  if (/^(nr|n|cad|pz)$/.test(normalized)) return normalized === 'nr' || normalized === 'n' ? 'NR' : normalized.toUpperCase()
  if (/^(ore|ora)$/.test(normalized)) return normalized.toUpperCase()
  return normalizeSpaces(value).toUpperCase()
}

function isPrimusDocument(lines) {
  const normalized = lines.map(line => normalizeForMatch(line.text))
  const hasPrimus = normalized.some(text => /primus\s+by/.test(text))
  const hasNumOrd = normalized.some(text => /num\.?ord/.test(text) || (/tariffa/.test(text) && /designazione/.test(text)))
  const hasDimensions = normalized.some(text => text.replace(/\s+/g, '') === 'dimensioni' || /par\.?ug/.test(text))
  const hasSommano = normalized.some(text => /^sommano\b/.test(text))
  return (hasPrimus || hasNumOrd) && hasDimensions && hasSommano
}

function tokenX(lines, predicate) {
  const values = []
  lines.forEach(line => line.tokens.forEach(token => {
    if (predicate(normalizeForMatch(token.text), token, line)) values.push(token.x)
  }))
  return median(values)
}

function detectPrimusColumns(lines) {
  const body = lines.filter(line => line.page > 1)
  const pageWidth = median(body.map(line => line.pageWidth)) ?? 595
  // `DESIGNAZIONE` è centrato nell'intestazione della colonna: il suo x non
  // coincide con il bordo sinistro effettivo. Nei computi PriMus le righe
  // descrittive iniziano normalmente 7–12 punti prima; usare direttamente
  // l'x del titolo tagliava la prima parola di ogni riga (es. “Istallazione”,
  // “Scavo”, “PROVVISTA”). Ricaviamo quindi il bordo reale dalla colonna.
  const descriptionHeaderX = tokenX(body, text => text === 'designazione') ?? pageWidth * 0.142
  const descriptionStart = Math.max(pageWidth * 0.115, descriptionHeaderX - Math.max(8, pageWidth * 0.014))
  const dimensionsStart = tokenX(body, text => /^par\.?ug\.?$/.test(text)) ?? pageWidth * 0.37
  const quantityStart = tokenX(body, text => text === 'quantita') ?? pageWidth * 0.68
  const unitPriceStart = tokenX(body, text => text === 'unitario') ?? pageWidth * 0.78
  const totalStart = tokenX(body, text => text === 'totale') ?? pageWidth * 0.88

  // PriMus colloca il numero d'ordine in una colonna molto stretta e stabile.
  // Calcolarne il centro evita che anni (es. 2018) o misure (es. 400) presenti
  // nella descrizione vengano scambiati per nuove voci.
  const itemNumberXs = []
  body.forEach(line => line.tokens.forEach(token => {
    const value = Number(token.text)
    if (!/^\d{1,4}$/.test(token.text)) return
    if (!Number.isFinite(value) || value < 1 || (value >= 1900 && value <= 2100)) return
    if (token.x >= descriptionStart - 16) return
    if (line.y > line.pageHeight * 0.84 || line.y < line.pageHeight * 0.045) return
    itemNumberXs.push(token.x)
  }))
  const numOrdX = strongestCluster(itemNumberXs, 8) ?? pageWidth * 0.032

  return {
    pageWidth,
    numOrdX,
    numOrdTolerance: Math.max(9, pageWidth * 0.018),
    codeRight: descriptionStart - 5,
    descriptionStart,
    descriptionRight: dimensionsStart - 5,
    dimensionsStart,
    quantityStart,
    unitPriceStart,
    totalStart,
  }
}

function collectPrimusLabel(firstPage, label, stopLabels = []) {
  const index = firstPage.findIndex(line => normalizeForMatch(line.text).includes(normalizeForMatch(label)))
  if (index < 0) return ''
  const parts = []
  const source = firstPage[index]
  const regex = new RegExp(`${label}\\s*:?\\s*`, 'i')
  const sameLine = source.text.replace(regex, '').trim()
  if (sameLine && normalizeForMatch(sameLine) !== normalizeForMatch(source.text)) parts.push(sameLine)
  for (let offset = 1; offset <= 4 && index + offset < firstPage.length; offset += 1) {
    const line = firstPage[index + offset]
    const normalized = normalizeForMatch(line.text)
    if (stopLabels.some(stop => normalized.includes(normalizeForMatch(stop)))) break
    if (/^pag\.?\s*\d+|^data\b|^il tecnico|primus\s+by/.test(normalized)) break
    const usefulTokens = line.tokens.filter(token => token.x > line.pageWidth * 0.22)
    const text = textFromTokens(usefulTokens)
    if (text) parts.push(text)
  }
  return normalizeSpaces(parts.join(' '))
}

function detectPrimusHeader(lines) {
  const firstPage = lines.filter(line => line.page === 1)
  const oggetto = collectPrimusLabel(firstPage, 'OGGETTO', ['COMMITTENTE'])
  const cliente = collectPrimusLabel(firstPage, 'COMMITTENTE', ['DATA'])
  const top = firstPage
    .filter(line => line.y > line.pageHeight * 0.80 && !/pag\.|primus/i.test(line.text))
    .slice(0, 2)
    .map(line => line.text)
    .join(' - ')
  const titleLine = firstPage.find(line => /computo\s+metrico/i.test(line.text))?.text ?? 'COMPUTO METRICO'
  const addressMatch = oggetto.match(/\b(?:via|viale|piazza|corso|localit[aà]|loc\.)\b.+$/i)
  const title = oggetto || titleLine
  return {
    titolo: normalizeSpaces(title),
    cliente: normalizeSpaces(cliente),
    indirizzo: normalizeSpaces(addressMatch?.[0] ?? ''),
    dataDocumento: '',
    mittente: normalizeSpaces(top),
  }
}

function isPrimusNoise(line) {
  const normalized = normalizeForMatch(line.text)
  const compact = normalized.replace(/\s+/g, '')
  if (line.page === 1) return true
  if (compact === 'riporto' || compact === 'ariportare') return true
  if (/^pag\.?\s*\d+$/.test(normalized)) return true
  if (/^committente\s*:/.test(normalized) || /primus\s+by/.test(normalized)) return true
  if (/^<pdx\b/.test(normalized) || line.text.length > 500) return true
  if (/^data\b|^il tecnico\b/.test(normalized)) return true
  if (line.y > line.pageHeight * 0.84 && (/num\.?ord|tariffa|designazione|dimensioni|importi|par\.?ug|lung\.?|larg\.?|h\/peso|quantita|unitario|totale/.test(normalized))) return true
  return false
}

function primusColumnTokens(line, model, fromX, toX) {
  return line.tokens.filter(token => token.x >= fromX && token.x < toX)
}

function primusDescription(line, model) {
  return textFromTokens(primusColumnTokens(line, model, model.descriptionStart - 3, model.descriptionRight + 3))
}

function primusNumbers(line, model, fromX, toX) {
  return primusColumnTokens(line, model, fromX, toX)
    .filter(token => isExactNumber(token.text))
    .map(token => ({ raw: token.text, value: parseItalianNumber(token.text), x: token.x }))
    .filter(item => item.value !== null)
}

function parsePrimusSummary(line, model) {
  const description = primusDescription(line, model)
  const normalized = normalizeForMatch(description)
  if (!/^sommano\b/.test(normalized)) return null
  const unitText = description.replace(/^\s*SOMMANO\s*/i, '').trim()
  const quantity = primusNumbers(line, model, model.quantityStart - 8, model.unitPriceStart - 4).at(-1)?.value ?? null
  const unitPrice = primusNumbers(line, model, model.unitPriceStart - 8, model.totalStart - 4).at(-1)?.value ?? 0
  const sourceTotal = primusNumbers(line, model, model.totalStart - 8, model.pageWidth + 5).at(-1)?.value ?? null
  return { unit: canonicalizeUnitText(unitText), quantity, unitPrice, sourceTotal }
}

function findPrimusItemNumber(line, model) {
  const candidates = line.tokens.filter(token => {
    if (!/^\d{1,4}$/.test(token.text)) return false
    const value = Number(token.text)
    if (!Number.isFinite(value) || value < 1 || (value >= 1900 && value <= 2100)) return false
    return Math.abs(token.x - model.numOrdX) <= model.numOrdTolerance
  })
  candidates.sort((a, b) => Math.abs(a.x - model.numOrdX) - Math.abs(b.x - model.numOrdX))
  return candidates[0] ?? null
}

function primusTariffFragment(line, model, numberToken = null) {
  const tokens = line.tokens.filter(token => {
    if (numberToken && token === numberToken) return false
    return token.x >= model.numOrdX - 5 && token.x < model.descriptionStart - 4
  })
  const text = normalizeSpaces(tokens.map(token => token.text).join(' ')).replace(/\s+/g, '')
  if (!text || /^\d+$/.test(text)) return ''
  if (text.length > 55) return ''
  // Codici PriMus e prezzari: DPE_Str_Fond_01a, TOS23_..., 01.A04.001 ecc.
  const codeLike = /[_./-]/.test(text) || (/[A-Za-z]/.test(text) && /\d/.test(text))
  return codeLike ? text : ''
}

function inferUnitFromLabel(value, fallback = '') {
  const text = normalizeSpaces(value).replace(/^parziale\s*/i, '').trim()
  const candidate = text.split(/\s+/).at(-1) ?? ''
  const unit = canonicalizeUnitText(candidate)
  return UNITS.includes(unit) || ['MC', 'MQ', 'ML', 'KG'].includes(unit) ? unit : fallback
}

function dedupeAdjacent(parts) {
  const result = []
  let previous = ''
  for (const part of parts) {
    const normalized = normalizeForMatch(part)
    if (!normalized || normalized === previous) continue
    result.push(part)
    previous = normalized
  }
  return result
}

function parsePrimusRows(lines, model) {
  const rows = []
  const warnings = []
  let sectionId
  let current = null
  let lastNumber = 0

  const flush = () => {
    if (!current) return
    const itemId = id()
    const summaryLine = [...current.lines].reverse().find(line => parsePrimusSummary(line, model))
    const summary = summaryLine ? parsePrimusSummary(summaryLine, model) : null
    const tariff = current.tariffParts.join('').replace(/\s+/g, '')
    const code = tariff ? `${current.number} · ${tariff}` : current.number
    const descriptionParts = []
    const details = []

    current.lines.forEach(line => {
      const desc = primusDescription(line, model)
      const normalized = normalizeForMatch(desc)
      if (!desc || /^sommano\b/.test(normalized)) return

      const dimensions = primusNumbers(line, model, model.dimensionsStart - 5, model.quantityStart - 5)
      const result = primusNumbers(line, model, model.quantityStart - 8, model.unitPriceStart - 4).at(-1)
      const isPartial = /^parziale\b/.test(normalized)
      // Una riga descrittiva PriMus può contenere anni, norme e misure nel testo
      // (es. D.M. 17/01/2018). Non deve essere scambiata per una misurazione.
      // Consideriamo misura solo una riga con un risultato nella colonna Quantità
      // e almeno un fattore numerico nelle vere colonne DIMENSIONI.
      const hasMeasurement = Boolean(result && dimensions.length > 0)

      if (isPartial || hasMeasurement) {
        // Le righe di misura restano collegate alla voce ma non duplicano la descrizione principale.
        const expression = dimensions.length
          ? `${dimensions.map(value => value.raw).join(' × ')} = ${result?.raw ?? ''}`
          : (result?.raw ?? '')
        const label = desc || 'Misurazione'
        // Una misura semplice priva di descrizione è già rappresentata dal SOMMANO.
        if (desc || dimensions.length > 1 || isPartial) {
          details.push({
            description: expression ? `${label} (${expression})` : label,
            unit: inferUnitFromLabel(label, summary?.unit ?? ''),
            quantity: result?.value ?? null,
            page: line.page,
          })
        }
        return
      }
      descriptionParts.push(desc)
    })

    let description = normalizeSpaces(dedupeAdjacent(descriptionParts).join(' '))
    if (!description) description = `Voce ${current.number}`
    rows.push({
      id: itemId,
      kind: 'item',
      sectionId,
      code,
      description,
      unit: summary?.unit ?? '',
      quantity: summary?.quantity ?? null,
      unitPrice: summary?.unitPrice ?? 0,
      discountPct: 0,
      calculate: Boolean(summary?.unit && summary.quantity !== null),
      page: current.page,
      confidence: summary?.unit && summary.quantity !== null ? 'high' : 'medium',
      sourceTotal: summary?.sourceTotal ?? null,
    })
    details.forEach(detail => rows.push({
      id: id(), kind: 'detail', parentId: itemId, sectionId, code: '', description: detail.description,
      unit: detail.unit, quantity: detail.quantity, unitPrice: 0, discountPct: 0, calculate: false,
      page: detail.page, confidence: 'high',
    }))
    current = null
  }

  for (const line of lines) {
    if (!line.text || isPrimusNoise(line)) continue
    const normalized = normalizeForMatch(line.text)
    if (/^lavori\s+a\s+misura$/.test(normalized)) {
      flush()
      sectionId = id()
      rows.push({ id: sectionId, kind: 'section', sectionId, code: '', description: 'LAVORI A MISURA', unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: line.page, confidence: 'high' })
      continue
    }
    if (/^(parziale\s+lavori|t\s*o\s*t\s*a\s*l\s*e\b)/.test(normalized)) {
      flush()
      rows.push({ id: id(), kind: 'total', sectionId, code: '', description: line.text.replace(/\b0[,.]00\b/g, '').trim(), unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: line.page, confidence: 'high' })
      continue
    }

    const numberToken = findPrimusItemNumber(line, model)
    if (numberToken) {
      const number = Number(numberToken.text)
      // La posizione è il criterio principale; la progressione elimina ulteriori falsi positivi.
      const plausibleSequence = lastNumber === 0 || number > lastNumber
      if (plausibleSequence) {
        flush()
        current = { number: numberToken.text, tariffParts: [], lines: [line], page: line.page }
        lastNumber = number
        const sameLineTariff = primusTariffFragment(line, model, numberToken)
        if (sameLineTariff) current.tariffParts.push(sameLineTariff)
        continue
      }
    }
    if (!current) continue
    const tariffPart = primusTariffFragment(line, model)
    if (tariffPart && !current.tariffParts.includes(tariffPart)) current.tariffParts.push(tariffPart)
    current.lines.push(line)
  }
  flush()

  const items = rows.filter(row => row.kind === 'item')
  if (!items.length) warnings.push('Formato PriMus riconosciuto, ma non sono state trovate voci numerate.')
  if (items.some(row => !row.unit || row.quantity === null)) warnings.push('Alcune voci PriMus non hanno una riga SOMMANO completa e richiedono controllo.')
  if (items.length && lastNumber !== items.length) warnings.push(`Riconosciute ${items.length} voci PriMus; verificare eventuali salti nella numerazione fino alla voce ${lastNumber}.`)
  return { rows, warnings }
}

function findGenericItemCode(line, model) {
  const firstToken = line.tokens?.[0]
  if (!firstToken || firstToken.x >= model.codeRight) return null
  if (!/^\d{1,4}[A-Za-z]?$/.test(firstToken.text)) return null
  const numeric = Number.parseInt(firstToken.text, 10)
  if (!Number.isFinite(numeric) || (numeric >= 1900 && numeric <= 2100)) return null
  return firstToken.text
}

function genericDescriptionText(line, model) {
  return cleanMainLine(line, model, false)
}

function isPreludeForUpcomingGenericItem(lines, index, model, alreadyPending = false) {
  const line = lines[index]
  if (!line?.tokens?.length) return false
  if (findUnit(line, model) || currencyValues(line).length) return false
  const description = genericDescriptionText(line, model)
  if (description.length < 2) return false
  const firstDescriptionToken = line.tokens.find(token => token.x >= model.descriptionStart - 4 && token.x < model.unitX - 6)
  if (!firstDescriptionToken) return false

  let upcomingCode = false
  for (let offset = 1; offset <= 5 && index + offset < lines.length; offset += 1) {
    const candidate = lines[index + offset]
    if (candidate.page !== line.page) break
    const verticalDistance = Math.abs(candidate.y - line.y)
    if (verticalDistance > 42) break
    if (findGenericItemCode(candidate, model)) {
      upcomingCode = true
      break
    }
  }
  if (!upcomingCode) return false
  if (alreadyPending) return true

  const previous = lines[index - 1]
  if (!previous || previous.page !== line.page) return true
  // Un salto verticale marcato indica l'inizio visivo di una nuova riga
  // della tabella, anche se il numero articolo è centrato più in basso.
  return Math.abs(previous.y - line.y) >= 19
}

function parseRows(lines, model) {
  const rows = []
  const parseWarnings = []
  let currentSectionId
  let current = null
  let pendingPrelude = []

  const flushItem = () => {
    if (!current) return
    const itemId = id()
    const firstLine = current.lines[0]
    const mainParts = []
    const details = []
    const measurements = []

    current.lines.forEach((line, index) => {
      const measurement = extractMeasurement(line, model)
      if (measurement) {
        measurements.push(measurement)
        return
      }
      const detail = extractDetail(line, model)
      if (detail && detail.firstTextX > model.descriptionStart + 18) {
        details.push(detail)
        return
      }
      const cleaned = cleanMainLine(line, model, index === 0)
      if (cleaned) mainParts.push(cleaned)
    })

    const descriptiveMeasurements = measurements.filter(measurement => measurement.textBefore)
    const useChildren = measurements.length > 1 && descriptiveMeasurements.length >= 2
    const primaryMeasurement = measurements.at(-1)
    if (!useChildren && primaryMeasurement?.textBefore && primaryMeasurement.firstTextX <= model.descriptionStart + 22) {
      mainParts.push(primaryMeasurement.textBefore)
    }

    let description = normalizeSpaces(mainParts.join(' '))
    if (!description) description = normalizeSpaces(firstLine.text.replace(/^\d{1,4}[A-Za-z]?\s+/, ''))

    if (useChildren) {
      rows.push({ id: itemId, kind: 'item', sectionId: currentSectionId, code: current.code, description, unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: current.page, confidence: 'medium' })
      measurements.forEach(measurement => {
        rows.push({
          id: id(), kind: 'detail', parentId: itemId, sectionId: currentSectionId, code: '',
          description: measurement.textBefore || `Misurazione ${measurement.unit}`,
          unit: measurement.unit, quantity: measurement.quantity, unitPrice: measurement.unitPrice,
          discountPct: 0, calculate: measurement.quantity !== null, page: measurement.line.page,
          confidence: measurement.quantity !== null ? 'high' : 'medium', sourceTotal: measurement.sourceTotal,
        })
      })
    } else {
      const measurement = primaryMeasurement
      rows.push({
        id: itemId, kind: 'item', sectionId: currentSectionId, code: current.code, description,
        unit: measurement?.unit ?? '', quantity: measurement?.quantity ?? null,
        unitPrice: measurement?.unitPrice ?? 0, discountPct: 0,
        calculate: Boolean(measurement?.unit && measurement.quantity !== null), page: current.page,
        confidence: measurement?.unit && measurement.quantity !== null ? 'high' : 'medium', sourceTotal: measurement?.sourceTotal,
      })
      const measurementDetails = measurements
        .filter(candidate => candidate !== measurement && candidate.textBefore)
        .map(candidate => ({ line: candidate.line, description: candidate.textBefore, quantity: candidate.quantity, firstTextX: candidate.firstTextX }))
      if (measurement?.textBefore && measurement.firstTextX > model.descriptionStart + 22) {
        measurementDetails.push({ line: measurement.line, description: measurement.textBefore, quantity: measurement.quantity, firstTextX: measurement.firstTextX })
      }
      ;[...details, ...measurementDetails].forEach(detail => {
        rows.push({ id: id(), kind: 'detail', parentId: itemId, sectionId: currentSectionId, code: '', description: detail.description, unit: '', quantity: detail.quantity, unitPrice: 0, discountPct: 0, calculate: false, page: detail.line.page, confidence: 'medium' })
      })
    }
    current = null
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.text || isRepeatedHeader(line) || isMetadataTitle(line)) continue
    if (isSectionLine(line)) {
      flushItem()
      pendingPrelude = []
      const sectionId = id()
      currentSectionId = sectionId
      rows.push({ id: sectionId, kind: 'section', sectionId, code: '', description: normalizeSpaces(line.text.replace(/^[-–—\s]+|[-–—\s]+$/g, '')), unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: line.page, confidence: 'high' })
      continue
    }
    if (isTotalLine(line)) {
      flushItem()
      pendingPrelude = []
      rows.push({ id: id(), kind: 'total', sectionId: currentSectionId, code: '', description: line.text.replace(/€\s*[\d.,]+/g, '').trim(), unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: line.page, confidence: 'high' })
      continue
    }

    const itemCode = findGenericItemCode(line, model)
    if (itemCode) {
      flushItem()
      current = { code: itemCode, lines: [...pendingPrelude, line], page: line.page }
      pendingPrelude = []
      continue
    }

    // In molti preventivi tabellari il numero articolo è centrato verticalmente
    // e viene estratto 1–2 righe dopo l'inizio della descrizione. Conserviamo
    // quelle righe per la voce successiva invece di accodarle alla precedente.
    if (isPreludeForUpcomingGenericItem(lines, index, model, pendingPrelude.length > 0)) {
      pendingPrelude.push(line)
      continue
    }

    if (current) current.lines.push(line)
  }
  flushItem()

  const itemRows = rows.filter(row => row.kind === 'item')
  if (!itemRows.length) parseWarnings.push('Nessuna voce numerata riconosciuta automaticamente.')
  if (itemRows.some(row => !row.unit && !rows.some(candidate => candidate.parentId === row.id && candidate.calculate))) {
    parseWarnings.push('Alcune voci non hanno una misurazione certa: sono evidenziate per il controllo.')
  }
  if (rows.some(row => row.calculate && row.quantity === null)) parseWarnings.push('Alcune quantità devono essere completate manualmente.')
  return { rows, warnings: parseWarnings }
}

async function buildLocalPdfContext(file, aiDocument = null, firstPageMode = 'auto') {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data }).promise
  if (firstPageMode === 'ignore') return { pages: pdf.numPages, cover: emptyCover() }
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const tokens = content.items.flatMap(item => explodeTextItem(item, 1, viewport.width, viewport.height))
  const firstPageLines = reconstructLines(tokens)
  const coverBlocks = coverBlocksFromLines(firstPageLines, viewport.width, viewport.height)
  const suggested = Boolean(aiDocument?.cover_page_present)
  return {
    pages: pdf.numPages,
    cover: {
      ...emptyCover(), available: firstPageMode !== 'ignore' && coverBlocks.length > 0, enabled: firstPageMode === 'cover' || firstPageMode === 'specification' ? coverBlocks.length > 0 : suggested, suggested, mode: firstPageMode === 'specification' ? 'specification' : 'cover',
      showBackground: true, pageWidth: viewport.width, pageHeight: viewport.height,
      backgroundDataUrl: await renderFirstPageBackground(page),
      blocks: clone(coverBlocks), originalBlocks: clone(coverBlocks),
    },
  }
}


async function extractPdfLinesLocal(file, session = null) {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data }).promise
  const pageNumbers = Array.from({ length: pdf.numPages }, (_, index) => index + 1)
  const lines = []
  const concurrency = Math.min(4, Math.max(1, pdf.numPages))
  let completed = 0

  async function worker() {
    while (pageNumbers.length) {
      ensureImportActive(session)
      const pageNumber = pageNumbers.shift()
      if (!pageNumber) return
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const tokens = content.items.flatMap(item => explodeTextItem(item, pageNumber, viewport.width, viewport.height))
      lines.push(...reconstructLines(tokens))
      completed += 1
      showAnalysisProgress(
        'Lettura locale veloce…',
        `Analisi di testo e coordinate: pagina ${completed} di ${pdf.numPages}.`,
        Math.min(34, 8 + Math.round(completed / Math.max(pdf.numPages, 1) * 25)),
      )
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  lines.sort((a, b) => a.page - b.page || b.y - a.y)
  return { pdf, lines, pages: pdf.numPages }
}

function assessLocalQuality(parsed, meta = {}) {
  const rows = parsed.rows || []
  const items = rows.filter(row => row.kind === 'item')
  const details = rows.filter(row => row.kind === 'detail')
  const descriptions = items.filter(row => normalizeSpaces(row.description).length >= 18).length
  const measured = items.filter(row => row.unit && row.quantity !== null).length
  const coded = items.filter(row => normalizeSpaces(row.code)).length
  const textChars = Number(meta.textChars) || 0
  const warningsCount = (parsed.warnings || []).length
  const scanned = textChars < Math.max(220, (meta.pages || 1) * 70)

  let score = scanned ? .08 : .22
  if (items.length) score += Math.min(.16, .07 + Math.log10(items.length + 1) * .055)
  if (items.length) score += descriptions / items.length * .19
  if (items.length) score += measured / items.length * .27
  if (items.length) score += coded / items.length * .08
  if (meta.primus && items.length >= 2) score += .09
  if (rows.some(row => row.kind === 'section')) score += .03
  if (details.length) score += .025
  score -= Math.min(.16, warningsCount * .035)
  if (!items.length) score = Math.min(score, .18)
  score = Math.max(0, Math.min(1, score))

  return {
    score,
    scanned,
    items: items.length,
    measured: measured,
    descriptionCoverage: items.length ? descriptions / items.length : 0,
    measurementCoverage: items.length ? measured / items.length : 0,
    tier: score >= .84 ? 'high' : score >= .54 ? 'medium' : 'low',
  }
}

function compactLocalContext(parsed, lines, quality) {
  const draftRows = (parsed.rows || []).map((row, index) => ({
    row_key: `local_${index + 1}`,
    parent_index: row.parentId ? (parsed.rows || []).findIndex(candidate => candidate.id === row.parentId) : -1,
    kind: row.kind,
    number_code: row.code || '',
    description: row.description || '',
    unit: row.unit || '',
    quantity: row.quantity,
    unit_price: row.unitPrice,
    total: row.sourceTotal,
    source_page: row.page || 1,
    confidence: row.confidence || 'medium',
  }))
  const layoutLines = lines.map(line => ({
    p: line.page,
    y: Math.round(line.y * 10) / 10,
    t: line.text,
  }))
  const payload = {
    local_engine: 'hybrid-layout-v1',
    quality,
    document: parsed.header,
    stats: parsed.stats,
    warnings: parsed.warnings,
    draft_rows: draftRows,
    layout_lines: layoutLines,
  }
  let text = JSON.stringify(payload)
  if (text.length > 650000) {
    payload.layout_lines = layoutLines.filter((_, index) => index % 2 === 0)
    payload.warnings = [...(payload.warnings || []), 'Contesto locale ridotto per dimensione.']
    text = JSON.stringify(payload)
  }
  return text
}

async function buildLocalHybridAnalysis(file, firstPageMode = 'auto', session = null) {
  const coverPromise = buildLocalPdfContext(file, null, firstPageMode)
  const extracted = await extractPdfLinesLocal(file, session)
  const allLines = extracted.lines
  const textChars = allLines.reduce((sum, line) => sum + line.text.length, 0)
  const primus = isPrimusDocument(allLines)
  const likelyCover = firstPageMode === 'auto' && isLikelyCoverPage(allLines, primus) && extracted.pages > 1
  const excludeFirst = firstPageMode === 'cover' || firstPageMode === 'specification' || firstPageMode === 'ignore' || likelyCover
  let parserLines = excludeFirst ? allLines.filter(line => line.page !== 1) : allLines

  // Il parser PriMus storico considera pagina 1 una copertina. Per i computi
  // economici di una sola pagina usiamo una copia logica come pagina 2,
  // mantenendo poi il numero pagina originale nelle righe prodotte.
  const singlePagePrimus = primus && extracted.pages === 1
  if (singlePagePrimus) parserLines = parserLines.map(line => ({ ...line, page: 2 }))

  const model = primus ? detectPrimusColumns(parserLines) : detectColumns(parserLines)
  const rowResult = primus ? parsePrimusRows(parserLines, model) : parseRows(parserLines, model)
  if (singlePagePrimus) rowResult.rows.forEach(row => { if (row.page === 2) row.page = 1 })
  const header = primus ? detectPrimusHeader(allLines) : detectHeader(allLines)
  const localContext = await coverPromise
  if (localContext.cover) {
    localContext.cover.suggested = likelyCover
    localContext.cover.mode = firstPageMode === 'specification' ? 'specification' : 'cover'
    if (firstPageMode === 'ignore') {
      localContext.cover.enabled = false
      localContext.cover.available = false
    } else if (firstPageMode === 'cover' || firstPageMode === 'specification') {
      localContext.cover.enabled = localContext.cover.available
    } else {
      localContext.cover.enabled = likelyCover && localContext.cover.available
    }
  }
  const items = rowResult.rows.filter(row => row.kind === 'item')
  const details = rowResult.rows.filter(row => row.kind === 'detail')
  const parsed = {
    header,
    cover: localContext.cover,
    rows: rowResult.rows,
    warnings: [...new Set(rowResult.warnings || [])],
    stats: {
      profile: primus ? 'Importazione ibrida locale · PriMus/ACCA' : 'Importazione ibrida locale · tabella adattiva',
      pages: extracted.pages,
      sections: rowResult.rows.filter(row => row.kind === 'section').length,
      items: items.length,
      details: details.length,
      calculableRows: rowResult.rows.filter(row => row.calculate).length,
      detectedColumns: primus
        ? ['Num.Ord./Tariffa', 'Designazione', 'Dimensioni', 'Quantità', 'Unitario', 'Totale']
        : ['N./Cod.', 'Descrizione', 'U.M.', 'Quantità', ...(model.priceX ? ['Prezzo unitario'] : []), ...(model.totalX ? ['Totale'] : [])],
    },
    suggestedVatPct: null,
  }
  const quality = assessLocalQuality(parsed, { primus, pages: extracted.pages, textChars })
  return { parsed, quality, lines: allLines, localContext: compactLocalContext(parsed, allLines, quality) }
}

function confidenceLabel(score) {
  const value = Number(score)
  if (Number.isFinite(value) && value >= .86) return 'high'
  if (Number.isFinite(value) && value >= .64) return 'medium'
  return 'low'
}

function normalizeAiUnit(value) {
  const raw = normalizeSpaces(value).toUpperCase()
  if (!raw) return ''
  if (raw === 'M2' || raw === 'M²' || raw === 'MQ') return 'MQ'
  if (raw === 'M3' || raw === 'M³' || raw === 'MC') return 'MC'
  if (raw === 'MT' || raw === 'M.L.' || raw === 'ML') return 'ML'
  if (raw === 'N' || raw === 'PZ' || raw === 'CAD') return raw
  return raw
}

function mapAiDocument(ai, local) {
  const sourceRows = Array.isArray(ai?.rows) ? ai.rows : []
  const keyToId = new Map()
  sourceRows.forEach((row, index) => keyToId.set(row.row_key || `r${index + 1}`, id()))
  const sectionIdByName = new Map()
  let activeSectionId = null
  const rows = []

  sourceRows.forEach((source, index) => {
    const key = source.row_key || `r${index + 1}`
    const kind = source.kind || 'item'
    if (kind === 'section') {
      activeSectionId = keyToId.get(key)
      const sectionName = normalizeSpaces(source.description || source.section_title || 'SEZIONE')
      sectionIdByName.set(normalizeForMatch(sectionName), activeSectionId)
      rows.push({ id: activeSectionId, kind: 'section', sectionId: activeSectionId, code: source.number || source.code || '', description: sectionName, unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: Number(source.source_page) || 0, confidence: confidenceLabel(source.confidence) })
      return
    }

    let sectionId = activeSectionId
    const sectionName = normalizeSpaces(source.section_title)
    if (sectionName && sectionIdByName.has(normalizeForMatch(sectionName))) sectionId = sectionIdByName.get(normalizeForMatch(sectionName))

    if (kind === 'section_total' || kind === 'grand_total') {
      rows.push({ id: keyToId.get(key), kind: 'total', sectionId: kind === 'grand_total' ? null : sectionId, code: source.number || source.code || '', description: normalizeSpaces(source.description || (kind === 'grand_total' ? 'TOTALE COMPLESSIVO' : 'TOTALE SEZIONE')), unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: Number(source.source_page) || 0, confidence: confidenceLabel(source.confidence), sourceTotal: source.total })
      return
    }

    const appKind = kind === 'subitem' ? 'detail' : kind === 'note' ? 'note' : 'item'
    const quantity = source.quantity === null || source.quantity === '' ? null : Number(source.quantity)
    let unitPrice = source.unit_price === null || source.unit_price === '' ? null : Number(source.unit_price)
    const sourceTotal = source.total === null || source.total === '' ? null : Number(source.total)
    let finalQuantity = Number.isFinite(quantity) ? quantity : null
    if (!Number.isFinite(unitPrice) && Number.isFinite(sourceTotal) && Number.isFinite(finalQuantity) && finalQuantity !== 0) unitPrice = sourceTotal / finalQuantity
    if (!Number.isFinite(unitPrice) && Number.isFinite(sourceTotal)) { unitPrice = sourceTotal; finalQuantity = finalQuantity ?? 1 }
    const calculate = appKind !== 'note' && Number.isFinite(finalQuantity) && Number.isFinite(unitPrice)
    const parentId = source.parent_row_key ? keyToId.get(source.parent_row_key) : null
    rows.push({
      id: keyToId.get(key), kind: appKind, parentId: parentId || undefined, sectionId,
      code: normalizeSpaces([source.number, source.code].filter(Boolean).join(source.number && source.code ? ' · ' : '')),
      description: normalizeSpaces(source.description), unit: normalizeAiUnit(source.unit),
      quantity: finalQuantity, unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      discountPct: Number(source.discount_pct) || 0, calculate, page: Number(source.source_page) || 0,
      confidence: confidenceLabel(source.confidence), sourceTotal,
      calcExpression: normalizeSpaces(source.calculation_expression),
    })
  })

  const itemRows = rows.filter(row => row.kind === 'item')
  const details = rows.filter(row => row.kind === 'detail' || row.kind === 'note')
  const warnings = Array.isArray(ai?.warnings) ? ai.warnings.filter(Boolean) : []
  if (rows.some(row => row.confidence === 'low')) warnings.push('Sono presenti dati a bassa affidabilità: controllare le righe evidenziate in rosso.')
  if (!itemRows.length) warnings.push('Il motore AI non ha individuato voci principali con sufficiente certezza.')
  return {
    header: {
      titolo: normalizeSpaces(ai?.document?.title),
      cliente: normalizeSpaces(ai?.document?.client),
      indirizzo: normalizeSpaces(ai?.document?.address),
      dataDocumento: normalizeSpaces(ai?.document?.date),
      mittente: normalizeSpaces(ai?.document?.issuer),
    },
    cover: local.cover,
    rows,
    warnings: [...new Set(warnings)],
    stats: {
      profile: normalizeSpaces(ai?.document?.profile) || 'Analisi visiva AI',
      pages: local.pages,
      sections: rows.filter(row => row.kind === 'section').length,
      items: itemRows.length,
      details: details.length,
      calculableRows: rows.filter(row => row.calculate).length,
      detectedColumns: Array.isArray(ai?.document?.detected_columns) ? ai.document.detected_columns : [],
    },
    suggestedVatPct: ai?.document?.vat_percent,
  }
}


let analysisUiStartedAt = 0
let analysisUiTimer = null

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')
  return minutes ? `${minutes}:${remainder}` : `${seconds}s`
}

function showAnalysisProgress(title, detail, percent = 8) {
  if (!analysisUiStartedAt) analysisUiStartedAt = Date.now()
  el.analysisProgressTitle.textContent = title
  el.analysisProgressDetail.textContent = detail
  el.analysisProgressBar.style.width = `${Math.max(4, Math.min(96, percent))}%`
  el.analysisProgressOverlay.hidden = false
  document.body.classList.add('analysis-running')
  if (!analysisUiTimer) {
    analysisUiTimer = setInterval(() => {
      el.analysisProgressElapsed.textContent = `Tempo trascorso: ${formatElapsed(Date.now() - analysisUiStartedAt)}`
    }, 500)
  }
  el.analysisProgressElapsed.textContent = `Tempo trascorso: ${formatElapsed(Date.now() - analysisUiStartedAt)}`
}

function hideAnalysisProgress() {
  el.analysisProgressOverlay.hidden = true
  document.body.classList.remove('analysis-running')
  if (analysisUiTimer) clearInterval(analysisUiTimer)
  analysisUiTimer = null
  analysisUiStartedAt = 0
  el.analysisProgressBar.style.width = '8%'
}

async function verifyAiService(session) {
  showAnalysisProgress('Verifica del motore AI…', 'Controllo della connessione protetta e della configurazione Cloudflare.', 6)
  const response = await fetchWithTimeout('/api/health', {}, 20000, session)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'Il motore AI non risponde correttamente.')
  if (!payload?.configured) throw new Error('La chiave OpenAI non risulta configurata nel Worker Cloudflare.')
  return payload
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

class ImportCancelledError extends Error {
  constructor() { super('Importazione interrotta dall’utente.'); this.name = 'ImportCancelledError' }
}

function ensureImportActive(session) {
  if (session?.cancelled) throw new ImportCancelledError()
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000, session = null) {
  ensureImportActive(session)
  const controller = new AbortController()
  session?.controllers?.add(controller)
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await appFetch(url, { ...options, signal: controller.signal, cache: 'no-store' })
  } catch (error) {
    if (session?.cancelled) throw new ImportCancelledError()
    if (error?.name === 'AbortError') throw new Error('Il servizio non ha risposto entro il tempo previsto. Riprova tra poco.')
    throw error
  } finally {
    clearTimeout(timer)
    session?.controllers?.delete(controller)
  }
}

function analysisProgressText(status, elapsedMs) {
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = String(elapsedSeconds % 60).padStart(2, '0')
  const time = minutes ? `${minutes}:${seconds}` : `${elapsedSeconds}s`
  const label = status === 'queued' ? 'Analisi in coda' : 'Analisi visiva AI in corso'
  return `<span class="ai-progress">${label}… ${time}<br><small>Il programma resta attivo; i PDF complessi possono richiedere alcuni minuti.</small></span>`
}

async function runRemoteAnalysis(file, firstPageMode, session, options = {}) {
  const startedAt = Date.now()
  const analysisMode = options.analysisMode || 'full_pdf'
  const localContext = options.localContext || ''
  const cacheFingerprint = options.cacheFingerprint || ''
  const localCover = options.localCover || null
  const form = new FormData()
  form.append('first_page_mode', firstPageMode)
  form.append('analysis_mode', analysisMode)
  form.append('source_file_name', file.name)
  if (analysisMode === 'text_refine') form.append('local_context', localContext)
  else form.append('pdf', file, file.name)

  showAnalysisProgress(
    analysisMode === 'text_refine' ? 'Correzione AI rapida…' : 'Analisi visiva AI completa…',
    analysisMode === 'text_refine'
      ? 'Il testo e le coordinate sono già stati letti sul computer. L’AI controlla soltanto struttura e righe dubbie.'
      : `Invio protetto di “${file.name}” per il riconoscimento visivo completo.`,
    analysisMode === 'text_refine' ? 42 : 18,
  )

  const startResponse = await fetchWithTimeout('/api/analyze/start', { method: 'POST', body: form }, 180000, session)
  const startPayload = await startResponse.json().catch(() => ({}))
  if (!startResponse.ok || !startPayload?.job_id) {
    throw new Error(startPayload?.error || startPayload?.message || `Errore avvio analisi AI (${startResponse.status})`)
  }

  const jobId = startPayload.job_id
  if (session) session.jobId = jobId
  let status = startPayload.status || 'queued'
  let transientErrors = 0
  const maxWaitMs = analysisMode === 'text_refine' ? 7 * 60 * 1000 : 15 * 60 * 1000

  while (Date.now() - startedAt < maxWaitMs) {
    ensureImportActive(session)
    const elapsed = Date.now() - startedAt
    const base = analysisMode === 'text_refine' ? 48 : 34
    const progress = Math.min(92, base + Math.floor(elapsed / (analysisMode === 'text_refine' ? 4500 : 8000)))
    showAnalysisProgress(
      status === 'queued' ? 'Analisi in coda…' : (analysisMode === 'text_refine' ? 'Controllo rapido delle righe…' : 'Riconoscimento visivo in corso…'),
      analysisMode === 'text_refine'
        ? 'Correzione di numerazione, descrizioni, unità, quantità, prezzi e collegamenti tra sottovoci.'
        : 'Riconoscimento completo di intestazione, colonne, sezioni, descrizioni e valori economici.',
      progress,
    )
    await wait(status === 'queued' ? 1200 : 1700)
    ensureImportActive(session)

    let statusResponse, payload
    try {
      statusResponse = await fetchWithTimeout(`/api/analyze/status?id=${encodeURIComponent(jobId)}`, {}, 60000, session)
      payload = await statusResponse.json().catch(() => ({}))
      transientErrors = 0
    } catch (error) {
      transientErrors += 1
      if (transientErrors <= 3) {
        await wait(1000 * transientErrors)
        continue
      }
      throw error
    }

    if (statusResponse.ok && payload?.status === 'completed' && payload?.result) {
      if (cacheFingerprint) saveCachedAiResult(cacheFingerprint, payload.result, file)
      const local = localCover || await buildLocalPdfContext(file, payload.result.document, firstPageMode)
      const parsed = mapAiDocument(payload.result, applyAiCoverSuggestion(local, payload.result.document, firstPageMode))
      if (analysisMode === 'text_refine') {
        parsed.warnings.unshift('Importazione ibrida: lettura locale completata e controllo AI rapido applicato soltanto alle righe dubbie.')
        parsed.stats.profile = `Ibrida veloce · controllo AI testuale · ${parsed.stats.profile}`
      } else {
        parsed.warnings.unshift('Analisi visiva AI completa utilizzata per documento complesso o modalità accurata.')
        parsed.stats.profile = `AI completa · ${parsed.stats.profile}`
      }
      return parsed
    }
    if (statusResponse.status === 202 || payload?.status === 'queued' || payload?.status === 'in_progress') {
      status = payload?.status || status
      continue
    }
    throw new Error(payload?.error || payload?.message || `Errore analisi AI (${statusResponse.status})`)
  }
  throw new Error(analysisMode === 'text_refine' ? 'La correzione rapida ha superato 7 minuti.' : 'L’analisi ha superato 15 minuti.')
}

async function parsePdf(file, firstPageMode = 'auto', session = null, importMode = 'hybrid') {
  const fingerprint = await fileFingerprint(file)
  const cacheFingerprint = `${fingerprint}:${firstPageMode}:${importMode}:hybrid-v1`
  const cached = cachedAiResult(cacheFingerprint)
  if (cached) {
    showAnalysisProgress('Risultato già disponibile…', 'Questo PDF è già stato analizzato: apertura immediata.', 90)
    const local = await buildLocalPdfContext(file, cached.document, firstPageMode)
    return mapAiDocument(cached, applyAiCoverSuggestion(local, cached.document, firstPageMode))
  }

  if (importMode === 'accurate') {
    await verifyAiService(session)
    return runRemoteAnalysis(file, firstPageMode, session, { analysisMode: 'full_pdf', cacheFingerprint })
  }

  let local
  try {
    local = await buildLocalHybridAnalysis(file, firstPageMode, session)
  } catch (error) {
    if (error?.name === 'ImportCancelledError' || session?.cancelled || importMode === 'local') throw error
    showAnalysisProgress('Lettura locale non disponibile…', 'Passaggio automatico all’analisi visiva completa del PDF.', 18)
    await verifyAiService(session)
    return runRemoteAnalysis(file, firstPageMode, session, { analysisMode: 'full_pdf', cacheFingerprint })
  }
  ensureImportActive(session)
  const percent = Math.round(local.quality.score * 100)

  if (importMode === 'local') {
    local.parsed.warnings.unshift(`Modalità solo locale: affidabilità stimata ${percent}%. Nessun costo API.`)
    local.parsed.stats.profile += ` · ${percent}%`
    return local.parsed
  }

  if (local.quality.tier === 'high') {
    local.parsed.warnings.unshift(`Importazione ibrida veloce completata localmente (${percent}%): nessuna attesa AI e nessun costo API.`)
    local.parsed.stats.profile += ` · affidabilità ${percent}%`
    showAnalysisProgress('Importazione locale completata…', `Riconoscimento affidabile al ${percent}%. Apertura immediata dell’editor.`, 94)
    return local.parsed
  }

  await verifyAiService(session)
  if (local.quality.tier === 'medium' && !local.quality.scanned) {
    try {
      return await runRemoteAnalysis(file, firstPageMode, session, {
        analysisMode: 'text_refine',
        localContext: local.localContext,
        cacheFingerprint,
        localCover: { pages: local.parsed.stats.pages, cover: local.parsed.cover },
      })
    } catch (error) {
      if (error?.name === 'ImportCancelledError' || session?.cancelled) throw error
      showAnalysisProgress('Passaggio alla modalità accurata…', 'La correzione rapida non è stata sufficiente. Avvio del controllo visivo completo.', 28)
      return runRemoteAnalysis(file, firstPageMode, session, { analysisMode: 'full_pdf', cacheFingerprint })
    }
  }

  showAnalysisProgress('PDF complesso o scansione…', 'Il testo locale non è sufficiente: avvio automatico dell’analisi visiva completa.', 20)
  return runRemoteAnalysis(file, firstPageMode, session, { analysisMode: 'full_pdf', cacheFingerprint })
}

function createButton(text, title, className, handler) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = text
  button.title = title
  if (className) button.className = className
  button.addEventListener('click', handler)
  return button
}

function createInput(value, onInput, options = {}) {
  const input = document.createElement('input')
  input.value = value ?? ''
  if (options.type) input.type = options.type
  if (options.step) input.step = options.step
  if (options.className) input.className = options.className
  if (options.disabled) input.disabled = true
  if (options.placeholder) input.placeholder = options.placeholder
  if (options.fieldKey) input.dataset.fieldKey = options.fieldKey
  input.addEventListener(options.eventName || 'input', () => onInput(input.value))
  return input
}

function createTextarea(value, rows, onInput, options = {}) {
  const textarea = document.createElement('textarea')
  textarea.rows = rows
  textarea.value = value ?? ''
  if (options.fieldKey) textarea.dataset.fieldKey = options.fieldKey
  textarea.addEventListener('input', () => onInput(textarea.value))
  return textarea
}

function captureRowsViewState() {
  const active = document.activeElement
  const row = active?.closest?.('tr[data-id]')
  const fieldKey = active?.dataset?.fieldKey || ''
  return {
    rowId: row?.dataset?.id || '',
    fieldKey,
    selectionStart: typeof active?.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active?.selectionEnd === 'number' ? active.selectionEnd : null,
    windowX: window.scrollX || 0,
    windowY: window.scrollY || 0,
    tableScrollTop: el.rowsBody?.parentElement?.scrollTop || 0,
    tableScrollLeft: el.rowsBody?.parentElement?.scrollLeft || 0,
  }
}

function restoreRowsViewState(viewState) {
  if (!viewState) return
  const restore = () => {
    const container = el.rowsBody?.closest?.('.sheet-table-wrap')
    if (container) {
      container.scrollTop = viewState.tableScrollTop || 0
      container.scrollLeft = viewState.tableScrollLeft || 0
    }
    if (viewState.rowId && viewState.fieldKey) {
      const row = [...el.rowsBody.querySelectorAll('tr[data-id]')].find(candidate => candidate.dataset.id === viewState.rowId)
      const target = row ? [...row.querySelectorAll('[data-field-key]')].find(candidate => candidate.dataset.fieldKey === viewState.fieldKey) : null
      if (target && !target.disabled) {
        try { target.focus({ preventScroll: true }) } catch (_) { target.focus() }
        if (typeof target.setSelectionRange === 'function' && viewState.selectionStart !== null) {
          try { target.setSelectionRange(viewState.selectionStart, viewState.selectionEnd ?? viewState.selectionStart) } catch (_) {}
        }
      }
    }
    window.scrollTo(viewState.windowX || 0, viewState.windowY || 0)
  }
  requestAnimationFrame(() => requestAnimationFrame(restore))
}

function updateRow(idValue, patch) {
  state.rows = state.rows.map(row => row.id === idValue ? { ...row, ...patch } : row)
  save()
}

function getRowDisplayTotal(row) {
  if (row.kind === 'item') {
    const pricedChildren = pricedChildrenFor(row.id)
    if (pricedChildren.length) return pricedChildren.reduce((sum, candidate) => sum + ownRowTotal(candidate), 0)
  }
  return ownRowTotal(row)
}

function sectionTotalFor(sectionId) {
  const rows = sectionId ? state.rows.filter(row => row.sectionId === sectionId) : state.rows
  return rows.reduce((sum, row) => sum + effectiveNetTotal(row), 0)
}


function coverState() {
  state.cover = { ...emptyCover(), ...(state.cover || {}) }
  state.cover.blocks = Array.isArray(state.cover.blocks) ? state.cover.blocks : []
  state.cover.originalBlocks = Array.isArray(state.cover.originalBlocks) ? state.cover.originalBlocks : []
  return state.cover
}

function updateCoverFieldScale() {
  const cover = coverState()
  if (!cover.enabled || !el.coverPage.clientWidth) return
  const scale = el.coverPage.clientWidth / Math.max(Number(cover.pageWidth) || 595, 1)
  el.coverFields.querySelectorAll('.cover-field-shell').forEach(shell => {
    const block = cover.blocks.find(candidate => candidate.id === shell.dataset.blockId)
    if (!block) return
    const text = shell.querySelector('.cover-field-text')
    if (text) text.style.fontSize = `${Math.max(.7, Number(block.fontPt || 8) / Math.max(Number(cover.pageWidth) || 595, 1) * 100)}cqw`
  })
}

function persistCoverBox(block, shell) {
  const rect = shell.getBoundingClientRect()
  const pageRect = el.coverPage.getBoundingClientRect()
  if (!pageRect.width || !pageRect.height) return
  block.xPct = Math.max(0, Math.min(98, (rect.left - pageRect.left) / pageRect.width * 100))
  block.yPct = Math.max(0, Math.min(98, (rect.top - pageRect.top) / pageRect.height * 100))
  block.wPct = Math.max(2, Math.min(100 - block.xPct, rect.width / pageRect.width * 100))
  block.hPct = Math.max(1.2, Math.min(100 - block.yPct, rect.height / pageRect.height * 100))
  save()
}

function makeCoverField(block) {
  const shell = document.createElement('div')
  shell.className = 'cover-field-shell'
  shell.dataset.blockId = block.id
  shell.style.left = `${block.xPct}%`
  shell.style.top = `${block.yPct}%`
  shell.style.width = `${block.wPct}%`
  shell.style.height = `${block.hPct}%`

  const text = document.createElement('div')
  text.className = 'cover-field-text'
  text.contentEditable = 'true'
  text.spellcheck = false
  text.textContent = block.text || ''
  text.style.fontWeight = block.bold ? '700' : '400'
  text.style.fontSize = `${Math.max(.7, Number(block.fontPt || 8) / Math.max(Number(coverState().pageWidth) || 595, 1) * 100)}cqw`
  text.style.textAlign = block.align || 'left'
  text.addEventListener('input', () => { block.text = text.innerText.replace(/\n{3,}/g, '\n\n'); save() })

  const controls = document.createElement('div')
  controls.className = 'cover-field-controls no-print'
  const drag = createButton('⋮⋮', 'Sposta campo', 'cover-drag-handle', () => {})
  const remove = createButton('×', 'Elimina campo', 'cover-delete-field', () => {
    state.cover.blocks = state.cover.blocks.filter(candidate => candidate.id !== block.id)
    save(); renderCover()
  })
  controls.append(drag, remove)
  shell.append(text, controls)

  drag.addEventListener('pointerdown', event => {
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const startLeft = shell.offsetLeft
    const startTop = shell.offsetTop
    drag.setPointerCapture?.(event.pointerId)
    const move = moveEvent => {
      const maxLeft = el.coverPage.clientWidth - shell.offsetWidth
      const maxTop = el.coverPage.clientHeight - shell.offsetHeight
      shell.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + moveEvent.clientX - startX))}px`
      shell.style.top = `${Math.max(0, Math.min(maxTop, startTop + moveEvent.clientY - startY))}px`
    }
    const finish = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', finish)
      persistCoverBox(block, shell)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', finish, { once: true })
  })
  shell.addEventListener('pointerup', () => persistCoverBox(block, shell))
  return shell
}

function renderCover() {
  const cover = coverState()
  const active = Boolean(cover.available && cover.enabled)
  el.coverEditorSection.hidden = !active
  el.toggleCoverButton.disabled = !cover.available
  const isSpecification = cover.mode === 'specification'
  el.toggleCoverButton.textContent = active ? (isSpecification ? 'Nascondi capitolato' : 'Nascondi prima pagina') : (isSpecification ? 'Pagina capitolato' : 'Prima pagina originale')
  const eyebrow = document.querySelector('#coverModeEyebrow')
  const title = document.querySelector('#coverModeTitle')
  const help = document.querySelector('#coverModeHelp')
  if (eyebrow) eyebrow.textContent = isSpecification ? 'PAGINA DEL CAPITOLATO' : 'COPERTINA ORIGINALE'
  if (title) title.textContent = isSpecification ? 'Prima pagina conservata come capitolato editabile' : 'Prima pagina riutilizzata e completamente editabile'
  if (help) help.textContent = isSpecification ? 'La pagina resta separata dalle voci economiche. Modifica, sposta, ridimensiona, aggiungi o elimina i campi.' : 'Modifica direttamente i testi. Puoi spostare, ridimensionare, aggiungere o eliminare i campi senza perdere l’impaginazione originale.'
  if (!active) return
  el.coverPage.style.aspectRatio = `${cover.pageWidth || 595} / ${cover.pageHeight || 842}`
  el.coverBackgroundToggle.checked = cover.showBackground !== false
  el.coverBackgroundImage.src = cover.backgroundDataUrl || ''
  el.coverBackgroundImage.classList.toggle('is-hidden', cover.showBackground === false || !cover.backgroundDataUrl)
  el.coverFields.innerHTML = ''
  cover.blocks.forEach(block => el.coverFields.append(makeCoverField(block)))
  if (!cover.blocks.length) {
    const empty = document.createElement('div')
    empty.className = 'cover-empty-message no-print'
    empty.textContent = 'Nessun campo presente. Usa “+ Campo” per aggiungere un testo modificabile.'
    el.coverFields.append(empty)
  }
  requestAnimationFrame(updateCoverFieldScale)
}

function toggleCover() {
  const cover = coverState()
  if (!cover.available) return
  cover.enabled = !cover.enabled
  save(); renderCover()
}

function addCoverField() {
  const cover = coverState()
  cover.available = true
  cover.enabled = true
  cover.blocks.push({ id: id(), text: 'Nuovo campo', xPct: 10, yPct: 10, wPct: 32, hPct: 3.2, fontPt: 10, bold: false, align: 'left' })
  save(); renderCover()
}

async function resetCover() {
  const cover = coverState()
  if (!(await appConfirm('Ripristinare tutti i testi e le posizioni della prima pagina originale?'))) return
  cover.blocks = clone(cover.originalBlocks || [])
  cover.showBackground = true
  save(); renderCover()
}

function renderHeader() {
  el.mittente.value = state.header.mittente || ''
  el.dataDocumento.value = state.header.dataDocumento || ''
  el.titolo.value = state.header.titolo || ''
  el.cliente.value = state.header.cliente || ''
  el.indirizzo.value = state.header.indirizzo || ''
  el.notes.value = state.notes || ''
  el.vatPct.value = state.vatPct ?? 10
  el.vatPrint.textContent = `${formatNumber(state.vatPct)}%`
  el.fileNameLabel.textContent = state.fileName || 'Nessun PDF importato'
}

function renderAnalysis() {
  const visible = Boolean(state.stats || warnings.length)
  el.analysisCard.hidden = !visible
  el.statsGrid.innerHTML = ''
  el.detectedColumns.innerHTML = ''
  el.warnings.innerHTML = ''
  if (!visible) return

  if (state.stats) {
    const cards = [
      [state.stats.profile || 'Adattivo', 'Formato'],
      [state.stats.pages, 'Pagine'],
      [state.stats.sections, 'Sezioni'],
      [state.stats.items, 'Voci'],
      [state.stats.details, 'Sottorighe'],
      [state.stats.calculableRows, 'Righe calcolabili'],
    ]
    cards.forEach(([value, label]) => {
      const box = document.createElement('div')
      const strong = document.createElement('strong')
      const span = document.createElement('span')
      strong.textContent = value
      span.textContent = label
      box.append(strong, span)
      el.statsGrid.append(box)
    })
    const label = document.createElement('span')
    label.textContent = 'Colonne riconosciute:'
    el.detectedColumns.append(label)
    state.stats.detectedColumns.forEach(column => {
      const badge = document.createElement('b')
      badge.textContent = column
      el.detectedColumns.append(badge)
    })
  }
  warnings.forEach(warning => {
    const box = document.createElement('div')
    box.className = 'warning'
    box.textContent = `⚠ ${warning}`
    el.warnings.append(box)
  })
}

function renderTotals() {
  const gross = state.rows.reduce((sum, row) => sum + effectiveGrossTotal(row), 0)
  const subtotal = state.rows.reduce((sum, row) => sum + effectiveNetTotal(row), 0)
  const discount = gross - subtotal
  const vat = subtotal * (Number(state.vatPct) || 0) / 100
  const total = subtotal + vat
  el.grossSubtotal.textContent = formatCurrency(gross)
  el.discountTotal.textContent = `- ${formatCurrency(discount)}`
  el.subtotal.textContent = formatCurrency(subtotal)
  el.vatTotal.textContent = formatCurrency(vat)
  el.grandTotal.textContent = formatCurrency(total)
  el.vatPrint.textContent = `${formatNumber(state.vatPct)}%`
}

function findPreviousRow(rowId, predicate) {
  const index = state.rows.findIndex(candidate => candidate.id === rowId)
  for (let i = index - 1; i >= 0; i -= 1) {
    if (predicate(state.rows[i])) return state.rows[i]
  }
  return null
}

function changeRowKind(row, nextKind) {
  if (!row || row.kind === nextKind) return
  const structuralKinds = new Set(['section', 'total'])
  const leavingStructuralKind = structuralKinds.has(row.kind) && !structuralKinds.has(nextKind)
  const enteringStructuralKind = !structuralKinds.has(row.kind) && structuralKinds.has(nextKind)
  const leavingNote = row.kind === 'note' && nextKind !== 'note'
  const enteringNote = row.kind !== 'note' && nextKind === 'note'

  if (enteringStructuralKind) {
    row.kindBeforeStructural = row.kind
    row.calculateBeforeStructural = Boolean(row.calculate)
    row.sectionIdBeforeStructural = row.sectionId || null
    row.parentIdBeforeStructural = row.parentId || null
  }
  if (enteringNote) {
    row.kindBeforeNote = row.kind
    row.calculateBeforeNote = Boolean(row.calculate)
    row.parentIdBeforeNote = row.parentId || null
  }

  row.kind = nextKind

  if (structuralKinds.has(nextKind)) {
    row.calculate = false
    delete row.parentId
    if (nextKind === 'section') row.sectionId = row.id
    if (nextKind === 'total' && !row.sectionId) {
      row.sectionId = findPreviousRow(row.id, candidate => candidate.kind === 'section')?.sectionId || null
    }
  } else {
    if (leavingStructuralKind) {
      row.calculate = typeof row.calculateBeforeStructural === 'boolean'
        ? row.calculateBeforeStructural
        : nextKind === 'item'
      row.sectionId = row.sectionIdBeforeStructural
        || findPreviousRow(row.id, candidate => candidate.kind === 'section')?.sectionId
        || null
    }
    if (leavingNote) {
      row.calculate = typeof row.calculateBeforeNote === 'boolean'
        ? row.calculateBeforeNote
        : nextKind !== 'note'
    }

    if (nextKind === 'item') {
      delete row.parentId
    } else if (nextKind === 'detail' || nextKind === 'note') {
      row.parentId = row.parentIdBeforeStructural
        || row.parentIdBeforeNote
        || row.parentId
        || findPreviousRow(row.id, candidate => candidate.kind === 'item')?.id
        || null
      if (nextKind === 'note') {
        row.calculate = false
        row.unit = ''
        row.quantity = null
      }
    }
  }

  save()
  render()
}

function createKindSelect(row, compact = false) {
  const select = document.createElement('select')
  select.className = compact ? 'kind-select kind-select-compact' : 'kind-select'
  ;[
    ['item', 'Voce principale'],
    ['detail', 'Sottovoce'],
    ['note', 'Nota / testo'],
    ['section', 'Sezione'],
    ['total', 'Totale sezione'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    select.append(option)
  })
  select.value = row.kind
  select.title = 'Tipo di riga'
  select.addEventListener('change', () => changeRowKind(row, select.value))
  return select
}

function resolveParentItem(row) {
  if (!row) return null
  if (row.kind === 'item') return row
  if (row.parentId) return state.rows.find(candidate => candidate.id === row.parentId) || null
  return findPreviousRow(row.id, candidate => candidate.kind === 'item')
}

function newItemRow() {
  return {
    id: id(), kind: 'item', code: '', description: 'Nuova voce', unit: 'NR', quantity: 1,
    unitPrice: 0, discountPct: 0, calculate: true, page: 0, confidence: 'high',
    sectionId: state.rows.slice().reverse().find(candidate => candidate.kind === 'section')?.sectionId || null,
  }
}

function topLevelAnchor(row) {
  if (!row?.parentId) return row
  return state.rows.find(candidate => candidate.id === row.parentId) || row
}

function blockEndIndex(row) {
  const index = state.rows.findIndex(candidate => candidate.id === row.id)
  if (index < 0) return state.rows.length - 1
  if (row.kind !== 'item') return index
  let end = index
  while (end + 1 < state.rows.length && state.rows[end + 1].parentId === row.id) end += 1
  return end
}

function insertItemRelative(referenceRow, position = 'after') {
  const anchor = topLevelAnchor(referenceRow)
  const anchorIndex = state.rows.findIndex(candidate => candidate.id === anchor?.id)
  const row = newItemRow()
  row.sectionId = anchor?.sectionId || findPreviousRow(anchor?.id, candidate => candidate.kind === 'section')?.sectionId || null
  const insertIndex = position === 'before' ? Math.max(anchorIndex, 0) : blockEndIndex(anchor) + 1
  state.rows.splice(insertIndex, 0, row)
  save(); render()
}

function insertStructuralRelative(referenceRow, kind, position = 'after') {
  const anchor = topLevelAnchor(referenceRow)
  const anchorIndex = state.rows.findIndex(candidate => candidate.id === anchor?.id)
  const insertIndex = position === 'before' ? Math.max(anchorIndex, 0) : blockEndIndex(anchor) + 1
  const row = {
    id: id(), kind, sectionId: kind === 'section' ? null : (anchor?.sectionId || null), code: '',
    description: kind === 'section' ? 'NUOVA SEZIONE' : 'TOTALE SEZIONE', unit: '', quantity: null,
    unitPrice: 0, discountPct: 0, calculate: false, page: 0, confidence: 'high',
  }
  if (kind === 'section') row.sectionId = row.id
  state.rows.splice(insertIndex, 0, row)
  save(); render()
}

function addSubRow(parentOrChild, calculable = true) {
  const parent = resolveParentItem(parentOrChild)
  if (!parent) {
    void appAlert('Prima crea o seleziona una voce principale a cui collegare la sottovoce.')
    return
  }
  const row = {
    id: id(), kind: calculable ? 'detail' : 'note', parentId: parent.id, sectionId: parent.sectionId,
    code: '', description: calculable ? 'Nuova sottovoce con prezzo' : 'Nota o specifica della voce',
    unit: calculable ? (parent.unit || 'NR') : '', quantity: calculable ? 1 : null, unitPrice: 0,
    discountPct: 0, calculate: calculable, page: parent.page || 0, confidence: 'high',
  }
  const parentIndex = state.rows.findIndex(candidate => candidate.id === parent.id)
  let insertIndex = parentIndex + 1
  while (insertIndex < state.rows.length && state.rows[insertIndex].parentId === parent.id) insertIndex += 1
  state.rows.splice(insertIndex, 0, row)
  synchronizeSubRowNumbers()
  save(); render()
}

function handleInsertAction(row, action) {
  if (!action) return
  if (action === 'item-before') insertItemRelative(row, 'before')
  if (action === 'item-after') insertItemRelative(row, 'after')
  if (action === 'sub-price') addSubRow(row, true)
  if (action === 'sub-note') addSubRow(row, false)
  if (action === 'section-before') insertStructuralRelative(row, 'section', 'before')
  if (action === 'total-after') insertStructuralRelative(row, 'total', 'after')
  if (action.startsWith('kind-')) changeRowKind(row, action.slice(5))
}

function appendMenuOption(parent, value, label, disabled = false) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = label
  option.disabled = disabled
  parent.append(option)
}

function createInsertSelect(row) {
  const select = document.createElement('select')
  select.className = 'insert-select row-action-select'
  select.title = 'Inserisci nuove righe oppure cambia il tipo della riga corrente'
  appendMenuOption(select, '', 'Azioni riga…')

  const insertGroup = document.createElement('optgroup')
  insertGroup.label = 'Inserisci'
  appendMenuOption(insertGroup, 'item-before', 'Voce sopra')
  appendMenuOption(insertGroup, 'item-after', 'Voce sotto')
  appendMenuOption(insertGroup, 'sub-price', 'Sottovoce con prezzo')
  appendMenuOption(insertGroup, 'sub-note', 'Nota / specifica')
  appendMenuOption(insertGroup, 'section-before', 'Sezione sopra')
  appendMenuOption(insertGroup, 'total-after', 'Totale sezione sotto')
  select.append(insertGroup)

  const kindGroup = document.createElement('optgroup')
  kindGroup.label = 'Trasforma la riga in'
  ;[
    ['item', 'Voce principale'],
    ['detail', 'Sottovoce'],
    ['note', 'Nota / testo'],
    ['section', 'Sezione'],
    ['total', 'Totale sezione'],
  ].forEach(([kind, label]) => appendMenuOption(kindGroup, `kind-${kind}`, label, row.kind === kind))
  select.append(kindGroup)

  select.addEventListener('change', () => {
    const action = select.value
    select.value = ''
    handleInsertAction(row, action)
  })
  return select
}

function renderRows() {
  const viewState = captureRowsViewState()
  if (synchronizeSubRowNumbers()) save()
  const term = normalizeSpaces(el.searchField.value).toLowerCase()
  const matching = new Set()
  if (term) {
    state.rows.forEach(row => {
      if (`${row.code} ${row.description} ${row.unit}`.toLowerCase().includes(term)) {
        matching.add(row.id)
        if (row.parentId) matching.add(row.parentId)
      }
    })
  }
  const visibleRows = term
    ? state.rows.filter(row => matching.has(row.id) || (row.parentId && matching.has(row.parentId)))
    : state.rows

  el.rowsBody.innerHTML = ''
  if (!visibleRows.length) {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = 9
    td.className = 'empty-row'
    td.textContent = state.rows.length ? 'Nessuna riga corrisponde alla ricerca.' : 'Importa un PDF oppure aggiungi una voce.'
    tr.append(td)
    el.rowsBody.append(tr)
    renderTotals()
    restoreRowsViewState(viewState)
    return
  }

  visibleRows.forEach((row, visibleIndex) => {
    const tr = document.createElement('tr')
    tr.dataset.id = row.id

    if (row.kind === 'section') {
      tr.className = 'section-row'
      const td = document.createElement('td')
      td.colSpan = 8
      td.append(createInput(row.description, value => updateRow(row.id, { description: value }), { fieldKey: 'description' }))
      const actions = document.createElement('td')
      actions.className = 'row-controls row-controls-structural no-print'
      actions.append(
        createInsertSelect(row),
        createButton('↑', 'Sposta su', '', () => moveRow(row.id, -1)),
        createButton('↓', 'Sposta giù', '', () => moveRow(row.id, 1)),
        createButton('×', 'Elimina', 'delete', () => deleteRow(row)),
      )
      tr.append(td, actions)
      el.rowsBody.append(tr)
      return
    }

    if (row.kind === 'total') {
      tr.className = 'source-total-row'
      const td = document.createElement('td')
      td.colSpan = 7
      td.append(createInput(row.description, value => updateRow(row.id, { description: value }), { fieldKey: 'description' }))
      const totalTd = document.createElement('td')
      totalTd.className = 'calculated-total'
      totalTd.textContent = formatCurrency(sectionTotalFor(row.sectionId))
      const actions = document.createElement('td')
      actions.className = 'row-controls row-controls-structural no-print'
      actions.append(
        createInsertSelect(row),
        createButton('↑', 'Sposta su', '', () => moveRow(row.id, -1)),
        createButton('↓', 'Sposta giù', '', () => moveRow(row.id, 1)),
        createButton('×', 'Elimina', 'delete', () => deleteRow(row)),
      )
      tr.append(td, totalTd, actions)
      el.rowsBody.append(tr)
      return
    }

    const isNote = row.kind === 'note'
    tr.className = `${row.kind}-row${row.confidence === 'high' ? '' : ` confidence-${row.confidence}`}`

    const codeTd = document.createElement('td')
    codeTd.className = 'code-cell'
    if (row.kind === 'detail') {
      const subCode = createInput(row.code, () => {}, { disabled: true })
      subCode.classList.add('auto-sub-code')
      subCode.title = 'Numerazione automatica collegata alla voce principale'
      codeTd.append(subCode)
    } else {
      codeTd.append(createInput(row.code, value => {
        row.code = value
        synchronizeSubRowNumbers()
        save()
        if (row.kind === 'item') renderRows()
      }, { eventName: 'change', fieldKey: 'code' }))
    }
    if (row.page > 0) {
      const small = document.createElement('small')
      small.textContent = `p. ${row.page}`
      codeTd.append(small)
    }

    const descriptionTd = document.createElement('td')
    descriptionTd.className = (row.kind === 'detail' || isNote) ? 'description-cell indented' : 'description-cell'
    const editor = document.createElement('div')
    editor.className = 'description-editor'
    if (row.kind === 'detail' || isNote) {
      const branch = document.createElement('span')
      branch.className = 'branch'
      branch.textContent = '↳'
      editor.append(branch)
    }
    const printDescription = document.createElement('div')
    printDescription.className = 'print-description print-only'
    printDescription.textContent = row.description || ''
    const descriptionTextarea = createTextarea(row.description, row.kind === 'item' ? 3 : 2, value => {
      updateRow(row.id, { description: value })
      printDescription.textContent = value
      applyScreenDescriptionLayout()
    }, { fieldKey: 'description' })
    descriptionTextarea.classList.add('description-textarea')
    editor.append(descriptionTextarea, printDescription)
    descriptionTd.append(editor)

    const meta = document.createElement('div')
    meta.className = 'row-meta no-print'
    meta.append(createButton('Elimina', 'Elimina questa riga', 'inline-delete', () => deleteRow(row)))

    if (!isNote) {
      const calcLabel = document.createElement('label')
      calcLabel.className = 'calculate-toggle'
      const calc = document.createElement('input')
      calc.type = 'checkbox'
      calc.dataset.fieldKey = 'calculate'
      calc.checked = Boolean(row.calculate)
      calc.addEventListener('change', () => {
        row.calculate = calc.checked
        save(); render()
      })
      calcLabel.append(calc, document.createTextNode('Calcola'))
      meta.append(calcLabel)
    }

    if (row.kind === 'item') {
      meta.append(
        createButton('+ Sottovoce prezzo', 'Aggiungi una componente con quantità e prezzo specifici', 'inline-add', () => addSubRow(row, true)),
        createButton('+ Nota', 'Aggiungi una riga descrittiva senza prezzo', 'inline-add', () => addSubRow(row, false)),
      )
    }

    if (row.confidence !== 'high') {
      const review = document.createElement('span')
      review.className = 'review-badge'
      review.textContent = 'Da controllare'
      meta.append(review)
    }
    const children = childRowsFor(row.id)
    if (children.length) {
      const pricedChildren = children.filter(hasEconomicPrice)
      const childTotal = pricedChildren.reduce((sum, candidate) => sum + ownRowTotal(candidate), 0)
      const group = document.createElement('span')
      group.className = 'group-badge'
      group.textContent = `${children.length} sottovoci · ${pricedChildren.length} con prezzo · ${formatCurrency(childTotal)}`
      meta.append(group)
    }
    descriptionTd.append(meta)

    const unitTd = document.createElement('td')
    unitTd.append(createInput(isNote ? '' : row.unit, value => updateRow(row.id, { unit: value.toUpperCase() }), { className: 'unit-input', disabled: isNote, fieldKey: 'unit' }))

    const quantityTd = document.createElement('td')
    quantityTd.append(createInput(isNote ? '' : (row.quantity ?? ''), value => {
      row.quantity = value === '' ? null : Number(value)
      save(); renderRows()
    }, { type: 'number', step: '0.0001', className: 'number-input', disabled: isNote, eventName: 'change', fieldKey: 'quantity' }))

    const priceTd = document.createElement('td')
    priceTd.append(createInput(row.unitPrice ?? 0, value => {
      row.unitPrice = Number(value) || 0
      save(); renderRows()
    }, { type: 'number', step: '0.01', className: 'number-input', disabled: isNote || !row.calculate, eventName: 'change', fieldKey: 'unitPrice' }))

    const discountTd = document.createElement('td')
    discountTd.append(createInput(row.discountPct ?? 0, value => {
      row.discountPct = Number(value) || 0
      save(); renderRows()
    }, { type: 'number', step: '0.01', className: 'number-input', disabled: isNote || !row.calculate, eventName: 'change', fieldKey: 'discountPct' }))

    const netTd = document.createElement('td')
    netTd.className = 'money-cell'
    netTd.textContent = (!isNote && row.calculate) ? formatCurrency(netUnitPrice(row)) : '—'

    const totalTd = document.createElement('td')
    totalTd.className = 'money-cell total-cell'
    totalTd.textContent = isNote ? '—' : formatCurrency(getRowDisplayTotal(row))

    const actionsTd = document.createElement('td')
    actionsTd.className = 'row-controls no-print'
    const up = createButton('↑', 'Sposta su', '', () => moveRow(row.id, -1))
    up.disabled = visibleIndex === 0
    actionsTd.append(createInsertSelect(row), up)
    actionsTd.append(createButton('↓', 'Sposta giù', '', () => moveRow(row.id, 1)))
    actionsTd.append(
      createButton('⧉', 'Duplica', '', () => duplicateRow(row)),
      createButton('×', 'Elimina', 'delete', () => deleteRow(row)),
    )

    tr.append(codeTd, descriptionTd, unitTd, quantityTd, priceTd, discountTd, netTd, totalTd, actionsTd)
    el.rowsBody.append(tr)
  })
  renderTotals()
  restoreRowsViewState(viewState)
}

function renderOriginal() {
  const active = Boolean(showOriginal && originalUrl)
  el.originalPanel.hidden = !active
  el.originalPanel.classList.toggle('is-open', active)
  el.workspace.classList.toggle('split-view', active)
  el.toggleOriginalButton.disabled = !originalUrl
  el.toggleOriginalButton.textContent = active ? 'Nascondi originale' : 'Affianca originale'
  if (active) {
    if (el.originalFrame.src !== originalUrl) el.originalFrame.src = originalUrl
  } else {
    el.originalFrame.removeAttribute('src')
  }
}

function renderButtons() {
  const hasRows = state.rows.length > 0
  el.undoImportButton.disabled = !importBackup
  el.toggleCoverButton.disabled = !coverState().available
  el.printSettingsButton.disabled = !hasRows
  el.printButton.disabled = !hasRows
  el.saveProjectButton.disabled = !hasRows
  el.exportCsvButton.disabled = !hasRows
  el.importButton.disabled = loading
  el.importButton.textContent = loading ? 'Analisi in corso…' : 'Importa PDF'
  const hasImportedPdf = Boolean(normalizeSpaces(state.fileName))
  const hideDropZone = hasImportedPdf || loading
  el.dropZone.hidden = hideDropZone
  el.dropZone.classList.toggle('is-hidden', hideDropZone)
}

function render() {
  renderHeader()
  renderCover()
  renderAnalysis()
  renderRows()
  renderOriginal()
  renderButtons()
  applyPrintSettings()
}

function reviewKindLabel(kind) {
  return ({ section: 'Sezione', item: 'Voce', detail: 'Sottovoce', note: 'Nota', total: 'Totale sezione' })[kind] || 'Voce'
}

function renderImportReview() {
  const parsed = pendingAiImport?.parsed
  if (!parsed) return
  el.reviewTitle.value = parsed.header.titolo || ''
  el.reviewClient.value = parsed.header.cliente || ''
  el.reviewAddress.value = parsed.header.indirizzo || ''
  el.reviewDate.value = parsed.header.dataDocumento || ''
  el.importReviewSummary.textContent = `${parsed.stats.items} voci, ${parsed.stats.details} sottorighe/note, ${parsed.stats.pages} pagine. Correggi i dati prima di confermare.`
  el.importReviewWarnings.innerHTML = ''
  parsed.warnings.forEach(text => { const box = document.createElement('div'); box.className = 'warning'; box.textContent = `⚠ ${text}`; el.importReviewWarnings.append(box) })
  el.reviewRowsBody.innerHTML = ''
  parsed.rows.forEach(row => {
    const tr = document.createElement('tr')
    tr.className = `confidence-${row.confidence || 'medium'}`
    const kindTd = document.createElement('td')
    const kindSelect = document.createElement('select'); kindSelect.className = 'review-kind'
    ;[['section','Sezione'],['item','Voce'],['detail','Sottovoce'],['note','Nota'],['total','Totale sezione']].forEach(([value,label]) => { const option=document.createElement('option'); option.value=value; option.textContent=label; option.selected=row.kind===value; kindSelect.append(option) })
    kindSelect.addEventListener('change', () => { row.kind = kindSelect.value })
    kindTd.append(kindSelect)

    const codeTd = document.createElement('td'); const code = createInput(row.code, value => { row.code=value }); code.className='review-number'; codeTd.append(code)
    const descTd = document.createElement('td'); const desc=createTextarea(row.description,2,value=>{row.description=value}); descTd.append(desc)
    const unitTd=document.createElement('td'); const unit=createInput(row.unit,value=>{row.unit=value}); unit.className='review-small'; unitTd.append(unit)
    const qtyTd=document.createElement('td'); const qty=createInput(row.quantity ?? '',value=>{row.quantity=value===''?null:parseItalianNumber(value)},{className:'review-small'}); qtyTd.append(qty)
    const priceTd=document.createElement('td'); const price=createInput(row.unitPrice ?? 0,value=>{row.unitPrice=parseItalianNumber(value)??0},{className:'review-small'}); priceTd.append(price)
    const sourceTd=document.createElement('td'); sourceTd.textContent=Number.isFinite(Number(row.sourceTotal))?formatCurrency(Number(row.sourceTotal)):'—'
    const confidenceTd=document.createElement('td'); const badge=document.createElement('span'); badge.className=`confidence-badge ${row.confidence||'medium'}`; badge.textContent=({high:'Alta',medium:'Media',low:'Bassa'})[row.confidence]||'Media'; confidenceTd.append(badge)
    const removeTd=document.createElement('td'); removeTd.append(createButton('×','Escludi questa riga','delete',()=>{ parsed.rows=parsed.rows.filter(candidate=>candidate.id!==row.id && candidate.parentId!==row.id); renderImportReview() }))
    tr.append(kindTd,codeTd,descTd,unitTd,qtyTd,priceTd,sourceTd,confidenceTd,removeTd)
    el.reviewRowsBody.append(tr)
  })
}

function openImportReview(parsed, file) {
  pendingAiImport = { parsed, file }
  renderImportReview()
  el.importReviewModal.hidden = false
  document.body.classList.add('modal-open')
}

function closeImportReview() {
  if (pendingAiImport?.objectUrl) URL.revokeObjectURL(pendingAiImport.objectUrl)
  pendingAiImport = null
  importBackup = null
  el.importReviewModal.hidden = true
  document.body.classList.remove('modal-open')
}

function confirmImportReview() {
  if (!pendingAiImport) return
  const { parsed, file } = pendingAiImport
  parsed.header.titolo = el.reviewTitle.value
  parsed.header.cliente = el.reviewClient.value
  parsed.header.indirizzo = el.reviewAddress.value
  parsed.header.dataDocumento = el.reviewDate.value
  let activeSectionId = null
  let lastItemId = null
  parsed.rows.forEach(row => {
    if (row.kind === 'section') {
      row.sectionId = row.id
      delete row.parentId
      row.calculate = false
      activeSectionId = row.id
      lastItemId = null
      return
    }
    row.sectionId = activeSectionId
    if (row.kind === 'item') {
      delete row.parentId
      lastItemId = row.id
    } else if (row.kind === 'detail' || row.kind === 'note') {
      if (!row.parentId) row.parentId = lastItemId || undefined
    } else if (row.kind === 'total') {
      delete row.parentId
      row.calculate = false
    }
  })
  if (originalUrl) URL.revokeObjectURL(originalUrl)
  originalUrl = URL.createObjectURL(file)
  showOriginal = true
  state = {
    header: parsed.header,
    cover: parsed.cover || emptyCover(),
    rows: parsed.rows,
    fileName: file.name,
    vatPct: Number.isFinite(Number(parsed.suggestedVatPct)) ? Number(parsed.suggestedVatPct) : (state.vatPct || 10),
    notes: '', stats: parsed.stats,
    printSettings: { ...defaultPrintSettings(), ...(state.printSettings || {}) },
  }
  warnings = parsed.warnings
  pendingAiImport = null
  el.importReviewModal.hidden = true
  document.body.classList.remove('modal-open')
  save(); render()
}

function selectedFirstPageMode() {
  return document.querySelector('input[name="firstPageMode"]:checked')?.value || 'auto'
}

const IMPORT_MODE_KEY = 'preventivi-clone-ai-last-import-mode'

function selectedImportMode() {
  return document.querySelector('input[name="importMode"]:checked')?.value || localStorage.getItem(IMPORT_MODE_KEY) || 'hybrid'
}

function restoreImportModeChoice() {
  const preferred = localStorage.getItem(IMPORT_MODE_KEY) || 'hybrid'
  const radio = document.querySelector(`input[name="importMode"][value="${preferred}"]`)
  if (radio) radio.checked = true
}

async function inspectFirstPageMode(file) {
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjsLib.getDocument({ data }).promise
    const page = await pdf.getPage(1)
    const content = await page.getTextContent()
    const text = content.items.map(item => String(item.str || '')).join(' ').toLowerCase()
    const signals = [
      /num\.?\s*ord/, /tariffa/, /designazione/, /quantit[aà]/,
      /importi?/, /unitario/, /totale/, /u\.?\s*m\.?/, /sommano/
    ]
    const signalCount = signals.filter(pattern => pattern.test(text)).length
    return { pages: pdf.numPages, hasEconomicTable: signalCount >= 4 }
  } catch (error) {
    console.warn('Pre-controllo prima pagina non riuscito:', error)
    return { pages: 0, hasEconomicTable: false }
  }
}

async function openFirstPageModeModal(file) {
  pendingFirstPageFile = file
  restoreImportModeChoice()
  el.firstPageFileName.textContent = file.name
  const radios = [...document.querySelectorAll('input[name="firstPageMode"]')]
  radios.forEach(radio => { radio.disabled = false; radio.closest('label')?.classList.remove('option-disabled') })
  const automatic = document.querySelector('input[name="firstPageMode"][value="auto"]')
  if (automatic) automatic.checked = true
  if (el.firstPageModeHint) el.firstPageModeHint.textContent = 'Controllo rapido della prima pagina…'
  el.firstPageModeModal.hidden = false
  document.body.classList.add('modal-open')

  const info = await inspectFirstPageMode(file)
  if (pendingFirstPageFile !== file) return
  if (info.pages === 1 && info.hasEconomicTable) {
    radios.filter(radio => radio.value !== 'auto').forEach(radio => {
      radio.disabled = true
      radio.closest('label')?.classList.add('option-disabled')
    })
    if (automatic) automatic.checked = true
    if (el.firstPageModeHint) el.firstPageModeHint.textContent = 'Documento di una sola pagina con tabella economica: il riconoscimento automatico è obbligatorio per non perdere le voci.'
  } else if (info.hasEconomicTable) {
    if (el.firstPageModeHint) el.firstPageModeHint.textContent = 'La prima pagina sembra contenere voci economiche. È consigliato il riconoscimento automatico.'
  } else if (info.pages > 1) {
    if (el.firstPageModeHint) el.firstPageModeHint.textContent = `${info.pages} pagine rilevate. Puoi scegliere come trattare la prima pagina.`
  } else {
    if (el.firstPageModeHint) el.firstPageModeHint.textContent = 'Scegli come trattare la prima pagina.'
  }
}

function closeFirstPageModeModal() {
  pendingFirstPageFile = null
  el.firstPageModeModal.hidden = true
  document.body.classList.remove('modal-open')
}

async function cancelActiveImport() {
  const session = activeImportSession
  if (!session || session.cancelled) return
  session.cancelled = true
  showAnalysisProgress('Interruzione dell’importazione…', 'Il progetto precedente viene mantenuto. Arresto dell’analisi AI in corso.', 100)
  session.controllers.forEach(controller => controller.abort())
  session.controllers.clear()
  if (session.jobId) {
    try {
      await appFetch('/api/analyze/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: session.jobId }),
        cache: 'no-store',
      })
    } catch (_) {}
  }
}

async function importPdf(file, firstPageMode = 'auto', importMode = 'hybrid') {
  if (!file?.name?.toLowerCase().endsWith('.pdf')) {
    await appAlert('Seleziona un file PDF.')
    return
  }
  loading = true
  warnings = []
  const session = { cancelled: false, jobId: '', controllers: new Set() }
  activeImportSession = session
  importBackup = clone(state)
  attachOriginalPdf(file)
  renderButtons()
  showAnalysisProgress('Preparazione del documento…', `Il PDF originale è già aperto a sinistra. Avvio dell’analisi di “${file.name}”.`, 4)
  try {
    const parsed = await parsePdf(file, firstPageMode, session, importMode)
    ensureImportActive(session)
    loading = false
    renderButtons()
    showAnalysisProgress('Editor completo pronto', 'Caricamento di tutte le funzioni della Beta 6.2.', 100)
    openImportReview(parsed, file)
    confirmImportReview()
    setTimeout(() => hideAnalysisProgress(), 350)
  } catch (error) {
    console.error(error)
    loading = false
    if (error?.name === 'ImportCancelledError' || session.cancelled) {
      if (!state.fileName && originalUrl) {
        URL.revokeObjectURL(originalUrl)
        originalUrl = ''
        showOriginal = false
      }
      warnings = ['Importazione interrotta: il progetto precedente è rimasto invariato.']
      render()
      setTimeout(() => hideAnalysisProgress(), 500)
      return
    }
    renderButtons()
    showAnalysisProgress('Analisi non riuscita', error.message || 'Controlla la configurazione del servizio.', 100)
    setTimeout(() => hideAnalysisProgress(), 1800)
    await appAlert(`Analisi AI non riuscita. ${error.message || 'Controlla la configurazione del servizio.'}`)
  } finally {
    if (activeImportSession === session) activeImportSession = null
  }
}

function undoImport() {
  if (!importBackup) return
  state = importBackup
  importBackup = null
  warnings = ['Importazione annullata: è stato ripristinato il progetto precedente.']
  showOriginal = false
  if (originalUrl) URL.revokeObjectURL(originalUrl)
  originalUrl = ''
  save(); render()
}

function addItem(afterId) {
  if (afterId) {
    const reference = state.rows.find(candidate => candidate.id === afterId)
    if (reference) return insertItemRelative(reference, 'after')
  }
  const row = newItemRow()
  row.code = String(state.rows.filter(item => item.kind === 'item').length + 1)
  state.rows.push(row)
  save(); render()
}

function addSection() {
  const sectionId = id()
  state.rows.push({ id: sectionId, kind: 'section', sectionId, code: '', description: 'NUOVA SEZIONE', unit: '', quantity: null, unitPrice: 0, discountPct: 0, calculate: false, page: 0, confidence: 'high' })
  save(); render()
}

function addDetail(parent) {
  addSubRow(parent, true)
}

function duplicateRow(row) {
  const index = state.rows.findIndex(item => item.id === row.id)
  if (index < 0) return
  if (row.kind === 'item') {
    const children = childRowsFor(row.id)
    const newParentId = id()
    const parentCopy = { ...clone(row), id: newParentId, code: row.code ? `${row.code} copia` : '' }
    const childCopies = children.map(child => ({ ...clone(child), id: id(), parentId: newParentId }))
    state.rows.splice(blockEndIndex(row) + 1, 0, parentCopy, ...childCopies)
  } else {
    const copyRow = { ...clone(row), id: id(), code: row.code ? `${row.code} copia` : '' }
    state.rows.splice(index + 1, 0, copyRow)
  }
  save(); render()
}

async function deleteRow(row) {
  if (!(await appConfirm(`Eliminare “${row.description || row.code || 'questa riga'}”?`))) return
  const parentId = row.parentId || null
  state.rows = state.rows.filter(candidate => candidate.id !== row.id && candidate.parentId !== row.id)
  if (parentId) {
    const parent = state.rows.find(candidate => candidate.id === parentId)
    if (parent && !pricedChildrenFor(parent.id).length && parent.calculateBeforeComponents) {
      parent.calculate = true
      delete parent.calculateBeforeComponents
    }
  }
  save(); render()
}

function topLevelBlocks() {
  const blocks = []
  for (let index = 0; index < state.rows.length;) {
    const row = state.rows[index]
    if (row.parentId) {
      blocks.push({ start: index, end: index, row })
      index += 1
      continue
    }
    let end = index
    if (row.kind === 'item') {
      while (end + 1 < state.rows.length && state.rows[end + 1].parentId === row.id) end += 1
    }
    blocks.push({ start: index, end, row })
    index = end + 1
  }
  return blocks
}

function moveRow(rowId, direction) {
  const row = state.rows.find(candidate => candidate.id === rowId)
  if (!row || !direction) return
  if (row.parentId) {
    const siblings = state.rows.filter(candidate => candidate.parentId === row.parentId)
    const siblingIndex = siblings.findIndex(candidate => candidate.id === row.id)
    const targetSibling = siblings[siblingIndex + direction]
    if (!targetSibling) return
    const from = state.rows.findIndex(candidate => candidate.id === row.id)
    const [moved] = state.rows.splice(from, 1)
    const adjustedTo = state.rows.findIndex(candidate => candidate.id === targetSibling.id)
    state.rows.splice(direction < 0 ? adjustedTo : adjustedTo + 1, 0, moved)
  } else {
    const blocks = topLevelBlocks()
    const blockIndex = blocks.findIndex(block => block.row.id === row.id)
    const targetBlock = blocks[blockIndex + direction]
    const currentBlock = blocks[blockIndex]
    if (!currentBlock || !targetBlock) return
    const movedRows = state.rows.splice(currentBlock.start, currentBlock.end - currentBlock.start + 1)
    const targetStartAfterRemoval = state.rows.findIndex(candidate => candidate.id === targetBlock.row.id)
    const insertAt = direction < 0 ? targetStartAfterRemoval : blockEndIndex(targetBlock.row) + 1
    state.rows.splice(insertAt, 0, ...movedRows)
  }
  save(); render()
}

function applyDiscount() {
  const discount = Number(el.globalDiscount.value) || 0
  state.rows = state.rows.map(row => row.calculate ? { ...row, discountPct: discount } : row)
  save(); render()
}

async function saveProject() {
  const content = JSON.stringify(state, null, 2)
  await downloadBlob(new Blob([content], { type: 'application/json;charset=utf-8' }), `${safeFilePart(state.header.cliente || state.header.titolo)}.preventivo.json`)
}

async function loadProject(file) {
  try {
    const parsed = JSON.parse(await file.text())
    if (!parsed.header || !Array.isArray(parsed.rows)) throw new Error('Formato non valido')
    importBackup = clone(state)
    state = normalizeProject(parsed, state.printSettings)
    warnings = ['Progetto caricato correttamente. La copertina editabile viene conservata; il PDF completo di confronto non è incluso.']
    showOriginal = false
    if (originalUrl) URL.revokeObjectURL(originalUrl)
    originalUrl = ''
    save(); render()
  } catch (error) {
    console.error(error)
    await appAlert('Il file selezionato non è un progetto valido di Preventivi Clone AI.')
  }
}

async function exportCsv() {
  const headings = ['Tipo', 'Codice', 'Descrizione', 'UM', 'Quantità', 'Prezzo unitario', 'Sconto %', 'Prezzo netto', 'Totale']
  const data = state.rows.map(row => [
    row.kind, row.code, row.description, row.unit, row.quantity ?? '',
    (Number(row.unitPrice) || 0).toFixed(2).replace('.', ','),
    (Number(row.discountPct) || 0).toFixed(2).replace('.', ','),
    netUnitPrice(row).toFixed(2).replace('.', ','),
    getRowDisplayTotal(row).toFixed(2).replace('.', ','),
  ])
  const content = [headings, ...data].map(line => line.map(escapeCsv).join(';')).join('\n')
  await downloadBlob(new Blob([`\ufeff${content}`], { type: 'text/csv;charset=utf-8' }), `${safeFilePart(state.header.cliente || state.header.titolo)}.csv`)
}

async function newProject() {
  if (state.rows.length && !(await appConfirm('Creare un nuovo progetto e cancellare quello corrente?'))) return
  importBackup = clone(state)
  const currentPrintSettings = { ...getPrintSettings() }
  state = emptyProject()
  state.printSettings = currentPrintSettings
  warnings = []
  showOriginal = false
  if (originalUrl) URL.revokeObjectURL(originalUrl)
  originalUrl = ''
  save(); render()
}

function bindHeaderInput(element, key) {
  element.addEventListener('input', () => {
    state.header[key] = element.value
    save()
  })
}

bindHeaderInput(el.mittente, 'mittente')
bindHeaderInput(el.dataDocumento, 'dataDocumento')
bindHeaderInput(el.titolo, 'titolo')
bindHeaderInput(el.cliente, 'cliente')
bindHeaderInput(el.indirizzo, 'indirizzo')

el.notes.addEventListener('input', () => { state.notes = el.notes.value; save() })
el.vatPct.addEventListener('input', () => { state.vatPct = Number(el.vatPct.value) || 0; save(); renderTotals() })
el.searchField.addEventListener('input', renderRows)
el.screenFontSizeQuick.addEventListener('change', () => {
  const settings = getPrintSettings()
  settings.screenFontSize = Math.min(Math.max(Number(el.screenFontSizeQuick.value) || 11, 9), 16)
  save()
  applyPrintSettings()
  if (el.screenFontSize) el.screenFontSize.value = String(settings.screenFontSize)
})
el.screenDescriptionQuick.addEventListener('change', () => {
  const settings = getPrintSettings()
  const selected = el.screenDescriptionQuick.value
  settings.screenDescriptionMode = selected === 'full' ? 'full' : 'limited'
  settings.screenDescriptionLines = selected === 'full' ? 4 : Math.min(Math.max(Number(selected) || 4, 1), 12)
  save()
  if (el.screenDescriptionDisplay) el.screenDescriptionDisplay.value = screenDescriptionValue(settings)
  applyScreenDescriptionLayout()
  updatePrintPreview()
})
el.importButton.addEventListener('click', () => el.fileInput.click())
el.closeImportReviewButton.addEventListener('click', closeImportReview)
el.cancelImportReviewButton.addEventListener('click', closeImportReview)
el.confirmImportReviewButton.addEventListener('click', confirmImportReview)
el.fileInput.addEventListener('change', () => {
  const file = el.fileInput.files?.[0]
  if (file) openFirstPageModeModal(file)
  el.fileInput.value = ''
})
el.dropZone.addEventListener('click', () => el.fileInput.click())
el.dropZone.addEventListener('dragover', event => event.preventDefault())
el.dropZone.addEventListener('drop', event => {
  event.preventDefault()
  const file = event.dataTransfer.files?.[0]
  if (file) openFirstPageModeModal(file)
})
el.cancelAnalysisButton.addEventListener('click', cancelActiveImport)
el.cancelFirstPageModeButton.addEventListener('click', closeFirstPageModeModal)
el.confirmFirstPageModeButton.addEventListener('click', () => {
  const file = pendingFirstPageFile
  const mode = selectedFirstPageMode()
  const importMode = selectedImportMode()
  localStorage.setItem(IMPORT_MODE_KEY, importMode)
  closeFirstPageModeModal()
  if (file) importPdf(file, mode, importMode)
})
el.undoImportButton.addEventListener('click', undoImport)
el.toggleOriginalButton.addEventListener('click', () => { showOriginal = !showOriginal; renderOriginal() })
el.toggleCoverButton.addEventListener('click', toggleCover)
el.coverBackgroundToggle.addEventListener('change', () => { coverState().showBackground = el.coverBackgroundToggle.checked; save(); renderCover() })
el.addCoverFieldButton.addEventListener('click', addCoverField)
el.resetCoverButton.addEventListener('click', resetCover)
el.disableCoverButton.addEventListener('click', () => { coverState().enabled = false; save(); renderCover() })
el.closeOriginalButton.addEventListener('click', () => { showOriginal = false; renderOriginal() })
el.printSettingsButton.addEventListener('click', openPrintSettings)
el.printButton.addEventListener('click', printDocument)
el.closePrintSettingsButton.addEventListener('click', closePrintSettings)
el.cancelPrintSettingsButton.addEventListener('click', closePrintSettings)
el.printNowButton.addEventListener('click', printDocument)
el.resetPrintSettingsButton.addEventListener('click', () => {
  state.printSettings = defaultPrintSettings()
  save()
  syncPrintSettingsControls()
})
;[
  el.screenFontSize,
  el.screenDescriptionDisplay,
  el.printFontSize,
  el.printOrientation,
  el.printPageSize,
  el.printFitToPage,
  el.printShowDiscount,
  el.printShowNet,
  el.printShowDetails,
  el.printShowNotes,
  el.printShowFullHeader,
  el.printDescriptionMode,
  el.printDescriptionLines,
].forEach(control => control.addEventListener('change', updatePrintSettingsFromControls))
el.printSettingsModal.addEventListener('click', event => {
  if (event.target === el.printSettingsModal) closePrintSettings()
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !el.printSettingsModal.hidden) closePrintSettings()
})
el.addItemButton.addEventListener('click', () => addItem())
el.addSectionButton.addEventListener('click', addSection)
el.applyDiscountButton.addEventListener('click', applyDiscount)
el.saveProjectButton.addEventListener('click', () => { void saveProject() })
el.openProjectButton.addEventListener('click', () => el.projectInput.click())
el.projectInput.addEventListener('change', () => {
  const file = el.projectInput.files?.[0]
  if (file) loadProject(file)
  el.projectInput.value = ''
})
el.exportCsvButton.addEventListener('click', () => { void exportCsv() })
el.newProjectButton.addEventListener('click', () => { void newProject() })
window.addEventListener('resize', updateCoverFieldScale)
window.addEventListener('beforeprint', applyPrintSettings)
window.addEventListener('beforeunload', () => { if (originalUrl) URL.revokeObjectURL(originalUrl) })

window.addEventListener('error', event => {
  console.error('Errore applicazione', event.error || event.message)
})
window.addEventListener('unhandledrejection', event => {
  console.error('Operazione non completata', event.reason)
})

load()
render()
