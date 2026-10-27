// Извлечение выбранных пакетов из app.asar DSH в .reference/asar (read-only справка).
import * as asar from '@electron/asar'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const archive = 'C:\\Users\\galan\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
const outRoot = resolve(process.argv[2] ?? '.reference/asar')
const prefixes = process.argv.slice(3)
if (!existsSync(outRoot)) mkdirSync(outRoot, { recursive: true })

const files = asar.listPackage(archive)
let n = 0
for (const f of files) {
  const norm = f.replace(/\\/g, '/')
  const rel = norm.replace(/^\//, '')
  if (!prefixes.some((p) => rel.startsWith(p))) continue
  if (!/\.(js|mjs|cjs|d\.ts|json|md|yml|yaml|css|html|map)$/.test(rel)) continue
  const target = join(outRoot, rel)
  mkdirSync(dirname(target), { recursive: true })
  try {
    // extractFile ожидает путь в нативном формате архива (с обратными слешами)
    const buf = asar.extractFile(archive, f.replace(/^\\/, ''))
    writeFileSync(target, buf)
    n++
  } catch (e) {
    console.error('skip', rel, e.message)
  }
}
console.log('extracted files:', n)
