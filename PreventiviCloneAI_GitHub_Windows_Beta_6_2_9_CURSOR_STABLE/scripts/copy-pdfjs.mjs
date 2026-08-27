import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = resolve(root, 'node_modules', 'pdfjs-dist', 'build')
const targetDir = resolve(root, 'web', 'vendor', 'pdfjs')
const files = ['pdf.min.mjs', 'pdf.worker.min.mjs']

await mkdir(targetDir, { recursive: true })
for (const file of files) {
  const source = resolve(sourceDir, file)
  const target = resolve(targetDir, file)
  await stat(source)
  await copyFile(source, target)
  console.log(`PDF.js copiato: ${file}`)
}
