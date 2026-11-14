// Builds mobile/www: the extension's shared code (AI, Canvas, grading, tutor, views) plus the
// phone-only files in mobile/src, plus Capacitor's JavaScript modules. No bundler: plain ES modules.
// The build fails if any import or named export does not resolve, so a missing phone stub can
// never ship as a blank screen.
//   node build.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const ext = path.join(root, 'extension')
const src = path.join(here, 'src')
const out = path.join(here, 'www')
const nm = path.join(here, 'node_modules')
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'))

// Screens that work on a phone. "Do" (controlling websites) needs the desktop browser extension.
const VIEWS = ['teach', 'study', 'write', 'settings']
// Extension modules that only make sense with browser tabs; never shipped in the app.
const SKIP_LIB = new Set(['agent.js'])

// Capacitor plugins used by the app: folder name in www/vendor/plugins -> npm package
const PLUGINS = {
  preferences: '@capacitor/preferences',
  'secure-storage': '@aparajita/capacitor-secure-storage',
  filesystem: '@capacitor/filesystem',
  share: '@capacitor/share',
  browser: '@capacitor/browser',
  app: '@capacitor/app',
  'status-bar': '@capacitor/status-bar',
  keyboard: '@capacitor/keyboard',
  'splash-screen': '@capacitor/splash-screen'
}

const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to) }
const copyDir = (from, to, filter = () => true) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) copyDir(a, b, filter)
    else if (filter(e.name)) copy(a, b)
  }
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// 1. shared code from the extension
for (const f of fs.readdirSync(path.join(ext, 'lib'))) {
  if (f.endsWith('.js') && !SKIP_LIB.has(f)) copy(path.join(ext, 'lib', f), path.join(out, 'lib', f))
}
for (const v of VIEWS) copy(path.join(ext, 'views', `${v}.js`), path.join(out, 'views', `${v}.js`))
copy(path.join(ext, 'sidepanel.css'), path.join(out, 'sidepanel.css'))
copyDir(path.join(ext, 'audio'), path.join(out, 'audio'))
copyDir(path.join(ext, 'icons'), path.join(out, 'icons'), (n) => /\.(png|svg)$/i.test(n))

// 2. phone-only files win over the extension's versions (platform.js, tabs.js, localfiles.js, ...)
copyDir(src, out)
const platformFile = path.join(out, 'lib', 'platform.js')
const internal = process.argv.includes('--internal') || process.env.DOTASK_INTERNAL === '1'
fs.writeFileSync(platformFile, fs.readFileSync(platformFile, 'utf8')
  .replaceAll('__DOTASK_VERSION__', pkg.version)
  .replaceAll('__DOTASK_INTERNAL__', String(internal)))

// 3. Capacitor's own modules, with bare imports rewritten to relative paths
const vendor = path.join(out, 'vendor')
copy(path.join(nm, '@capacitor/core/dist/index.js'), path.join(vendor, 'capacitor-core.js'))
copy(path.join(nm, '@capacitor/synapse/dist/synapse.mjs'), path.join(vendor, 'capacitor-synapse.js'))
for (const [name, npmName] of Object.entries(PLUGINS)) {
  const from = path.join(nm, npmName, 'dist', 'esm')
  if (!fs.existsSync(from)) throw new Error(`Missing ${npmName}. Run npm install in mobile/.`)
  const to = path.join(vendor, 'plugins', name)
  copyDir(from, to, (n) => n.endsWith('.js'))
  for (const f of fs.readdirSync(to)) {
    const p = path.join(to, f)
    const code = fs.readFileSync(p, 'utf8')
      .replace(/(from\s+|import\(\s*)'@capacitor\/core'/g, "$1'../../capacitor-core.js'")
      .replace(/(from\s+|import\(\s*)'@capacitor\/synapse'/g, "$1'../../capacitor-synapse.js'")
      // bundler-style './web' -> browser-style './web.js'
      .replace(/(from\s+|import\(\s*)'(\.{1,2}\/[^']+?)'/g, (m, lead, spec) =>
        !/\.m?js$/.test(spec) && fs.existsSync(path.join(to, `${spec}.js`)) ? `${lead}'${spec}.js'` : m)
      .replace(/\/\/# sourceMappingURL=.*$/m, '')
    fs.writeFileSync(p, code)
  }
}

// 4. every relative import must point at a real file, and every named import must be exported there
const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p) } }
walk(out)
const exportsOf = new Map()
function exportNames(file) {
  if (exportsOf.has(file)) return exportsOf.get(file)
  const code = fs.readFileSync(file, 'utf8')
  const names = new Set()
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (n) names.add(n) }
  }
  if (/export\s+\*\s+from/.test(code)) names.add('*')
  exportsOf.set(file, names)
  return names
}
const problems = []
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8')
  for (const m of code.matchAll(/(?:import|export)\s+([\s\S]*?)\s+from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)|^import\s+'([^']+)'/gm)) {
    const spec = m[2] || m[3] || m[4]
    if (!spec) continue
    const rel = path.relative(out, file)
    if (!spec.startsWith('.')) { problems.push(`${rel}: bare import '${spec}' (no bundler in the app)`); continue }
    const target = path.resolve(path.dirname(file), spec)
    if (!fs.existsSync(target)) { problems.push(`${rel}: '${spec}' does not exist`); continue }
    const clause = m[1] || ''
    const named = clause.match(/\{([^}]*)\}/)
    if (named && target.endsWith('.js')) {
      const have = exportNames(target)
      if (have.has('*')) continue
      for (const part of named[1].split(',')) {
        const n = part.trim().split(/\s+as\s+/)[0].trim()
        if (n && n !== 'default' && !have.has(n)) problems.push(`${rel}: '${n}' is not exported by ${spec}`)
      }
    }
  }
}
if (problems.length) {
  console.error(`Build failed: ${problems.length} broken import(s)\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`Built mobile/www (DoTask ${pkg.version}${internal ? ", internal build" : ""}): ${files.length} modules, all imports resolve.`)
