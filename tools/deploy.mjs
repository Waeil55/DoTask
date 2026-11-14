// Builds the download site into ./dist/site (with the freshly packed extension zip) and
// publishes it to Firebase Hosting. Hosting only: nothing else in the project is touched.
//   npm run deploy            build and publish
//   npm run deploy -- --dry   build only
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist', 'site')
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'))

execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pack.mjs')], { stdio: 'inherit' })

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(OUT, 'downloads'), { recursive: true })
fs.cpSync(path.join(ROOT, 'site'), OUT, { recursive: true })
fs.copyFileSync(path.join(ROOT, 'extension', 'icons', 'icon48.png'), path.join(OUT, 'icon-48.png'))

const zipName = `DoTask-${version}.zip`
const zip = path.join(ROOT, 'dist', zipName)
fs.copyFileSync(zip, path.join(OUT, 'downloads', zipName))

// never publish anything that looks like a real key
const text = fs.readFileSync(zip).toString('latin1')
if (/AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}/.test(text)) throw new Error('The zip contains something that looks like an API key. Not publishing.')

const size = `${Math.round(fs.statSync(zip).size / 1024)} KB`
const page = path.join(OUT, 'index.html')
fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replaceAll('{{VERSION}}', version).replaceAll('{{SIZE}}', size))
console.log(`site built: ${zipName}, ${size}`)

if (process.argv.includes('--dry')) process.exit(0)
execFileSync('firebase', ['deploy', '--only', 'hosting', '--project', 'dotask5', '--message', `"DoTask ${version} download page"`], { cwd: ROOT, stdio: 'inherit', shell: true })
