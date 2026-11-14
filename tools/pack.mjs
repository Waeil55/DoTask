// Zips ./extension into ./dist/DoTask-<version>.zip (Chrome Web Store upload / sharing).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeZip } from '../extension/lib/docx.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXT = path.join(ROOT, 'extension')
const { version } = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
const files = []
;(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full)
    else files.push({ name: path.relative(EXT, full).split(path.sep).join('/'), data: new Uint8Array(fs.readFileSync(full)) })
  }
})(EXT)
fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true })
const out = path.join(ROOT, 'dist', `DoTask-${version}.zip`)
fs.writeFileSync(out, writeZip(files))
console.log(`${files.length} files -> ${out}`)
