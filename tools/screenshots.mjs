// Renders each side-panel tab at side-panel size into ./screenshots (for docs/review).
import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXT = path.join(ROOT, 'extension')
const OUT = process.argv[2] || path.join(ROOT, 'screenshots')
fs.mkdirSync(OUT, { recursive: true })
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotask-shots-'))
const ctx = await chromium.launchPersistentContext(dir, {
  channel: process.env.BROWSER || 'chromium', headless: true, viewport: { width: 400, height: 760 },
  colorScheme: process.env.DARK ? 'dark' : 'light',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
})
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const id = new URL(sw.url()).host
const page = await ctx.newPage()
await page.goto(`chrome-extension://${id}/sidepanel.html?view=settings`)
if (!process.env.FRESH) await page.evaluate(() => chrome.storage.local.set({ settings: { geminiApiKey: 'demo', onboarded: true } }))
for (const v of ['do', 'teach', 'study', 'write', 'settings']) {
  await page.goto(`chrome-extension://${id}/sidepanel.html?view=${v}`)
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(OUT, `${v}.png`) })
}
await ctx.close()
fs.rmSync(dir, { recursive: true, force: true })
console.log('screenshots in', OUT)
