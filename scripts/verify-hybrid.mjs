import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve(import.meta.dirname,'..')
const app=fs.readFileSync(path.join(root,'web','app.js'),'utf8')
const html=fs.readFileSync(path.join(root,'web','index.html'),'utf8')
const checks=[
  ['selettore veloce ibrido', 'name="importMode" value="hybrid"'],
  ['selettore accurato', 'name="importMode" value="accurate"'],
  ['selettore solo locale', 'name="importMode" value="local"'],
  ['estrazione parallela', 'async function extractPdfLinesLocal'],
  ['valutazione qualità', 'function assessLocalQuality'],
  ['correzione testuale AI', "analysisMode: 'text_refine'"],
  ['fallback visivo completo', "analysisMode: 'full_pdf'"],
  ['cache 12 file', 'const keep = current.slice(0, 12)'],
]
const failures=[]
for(const [name,needle] of checks){ const source=needle.includes('name=')?html:app; if(!source.includes(needle)) failures.push(name) }
if(failures.length){ console.error('AUDIT IBRIDO NON SUPERATO'); failures.forEach(x=>console.error('- '+x)); process.exit(1) }
console.log('Audit importazione ibrida superato: percorso locale, correzione rapida e fallback completo presenti.')
