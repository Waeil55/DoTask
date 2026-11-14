// End-to-end test of the phone app's web layer (mobile/www) in a phone-sized browser.
// Gemini and Gemini Live are mocked; Canvas is the built-in Demo School.
// Native plugins run their web fallbacks here, so this checks the shared screens, the phone
// flags, consent, secure key split, Demo School grading, study (photo + paste), the voice tutor
// with the camera, writing, and that nothing overflows sideways.
//   cd mobile && node build.mjs && node tests/mobile-e2e.mjs
//   BROWSER=msedge       use Edge (when Windows blocks Playwright's Chromium)
//   SHOTS=1              also save store screenshots (App Store 6.9" into fastlane/screenshots, Google Play phone into store/screenshots)
//   HEADED=1             watch it run

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const WWW = path.resolve(here, '../www')
const STORE = path.resolve(here, '../store/screenshots')
const FASTLANE = path.resolve(here, '../fastlane/screenshots/en-US') // what the App Store listing workflow uploads
if (!fs.existsSync(path.join(WWW, 'index.html'))) { console.error('Build first: node build.mjs'); process.exit(2) }

// ---------------- static server for www ----------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  let file = path.join(WWW, decodeURIComponent(u.pathname))
  if (!file.startsWith(WWW)) { res.writeHead(403); return res.end() }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found') }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const APP = `http://127.0.0.1:${server.address().port}/index.html`

// ---------------- mock Gemini ----------------
const reply = (text) => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } })
const GOOD = /chlorophyll|light energy|glucose/i
function grade(prompt) {
  const ref = prompt.match(/STUDENT REF: (\w+)/)?.[1] || ''
  const work = (prompt.split(/SUBMISSION[^\n]*:/)[1] || '').slice(0, 4000)
  const good = GOOD.test(work)
  const off = !/photosynth|plant|light|sun/i.test(work)
  const c1 = off ? 0 : good ? 9 : 5, c2 = off ? 0 : good ? 8 : 4
  return {
    student_ref: ref, score: c1 + c2,
    rubric: [{ criterion_id: 'c1', points: c1, comment: good ? 'Accurate inputs and outputs.' : 'Some key steps are missing.' },
      { criterion_id: 'c2', points: c2, comment: good ? 'Clear structure.' : 'Add more detail.' }],
    comment: off ? 'This response is about a different topic. Please re-read the prompt and explain how photosynthesis works.'
      : good ? 'Great work! You clearly explained how chlorophyll captures light energy and how the plant makes glucose. Next step: connect the light reactions to the Calvin cycle.'
        : 'Good start. You named sunlight and water; next, explain where the oxygen comes from and what chlorophyll does.',
    private_note: off ? 'Off-topic submission.' : '', confidence: 0.86, flags: off ? ['off_topic'] : []
  }
}
const aiCalls = []
const live = { setups: 0, images: 0, audio: 0, texts: [] }

// ---------------- browser ----------------
let browser
try {
  browser = await chromium.launch({
    channel: process.env.BROWSER || 'chromium',
    headless: !process.env.HEADED,
    // the fake camera shows a worksheet page on a desk (tests/fixtures/camera-page.mjpeg), not the test pattern
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-video-capture=${path.join(here, 'fixtures', 'camera-page.mjpeg')}`]
  })
} catch (e) {
  console.error(`Could not start the test browser: ${e.message.split('\n')[0]}\nTry BROWSER=msedge.`)
  server.close(); process.exit(2)
}

let passed = 0
const ok = (name) => { passed++; console.log(`  ✓ ${name}`) }

async function newPhone({ width = 390, height = 844, scale = 2 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: scale, isMobile: true, hasTouch: true,
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
  })
  context.setDefaultTimeout(30000)
  context.setDefaultNavigationTimeout(90000)
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) })
    const body = JSON.parse(req.postData() || '{}')
    const system = body.systemInstruction?.parts?.[0]?.text || ''
    const prompt = (body.contents || []).flatMap(c => c.parts).map(p => p.text || '').join('\n')
    aiCalls.push({ url: req.url(), key: req.headers()['x-goog-api-key'], system: system.slice(0, 50), hasImage: (body.contents || []).flatMap(c => c.parts).some(p => p.inlineData) })
    if (req.url().includes('streamGenerateContent')) {
      const chunks = /tutor/i.test(system)
        ? ['Photosynthesis is how plants ', 'turn sunlight, water and carbon dioxide into glucose and oxygen. ', 'Quick check: where in the cell does it happen?']
        : ['Hi Jordan,\n\nThanks for letting me know. ', 'Yes, you can have a three-day extension. ', 'Rest up, and send it when you are ready.\n\nBest,\nMs. Rivera']
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: chunks.map(t => `data: ${JSON.stringify(reply(t))}\n\n`).join('') })
    }
    let out
    if (/teaching assistant/i.test(system)) out = grade(prompt)
    else if (body.generationConfig?.responseSchema?.properties?.cards) out = { cards: [{ q: 'What pigment absorbs light?', a: 'Chlorophyll' }, { q: 'Which gas do plants release?', a: 'Oxygen' }] }
    else out = 'Hi Jordan,\n\nThanks for letting me know. Yes, you can have a three-day extension. Rest up, and send it when you are ready.\n\nBest,\nMs. Rivera'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply(typeof out === 'string' ? out : JSON.stringify(out))) })
  })
  await context.routeWebSocket(/generativelanguage\.googleapis\.com/, (ws) => {
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw))
      if (msg.setup) {
        live.setups++
        ws.send(JSON.stringify({ setupComplete: {} }))
      } else if (msg.realtimeInput?.video) live.images++
      else if (msg.realtimeInput?.audio) live.audio++
      else if (msg.realtimeInput?.text) {
        live.texts.push(msg.realtimeInput.text)
        const pcm = Buffer.alloc(24000 * 2 * 0.3)
        ws.send(JSON.stringify({ serverContent: { outputTranscription: { text: 'Hi! Show me the page you are working on.' }, modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.toString('base64') } }] } } }))
        ws.send(JSON.stringify({ serverContent: { turnComplete: true } }))
      }
    })
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(`console: ${m.text()}`) })
  return { context, page, errors }
}

const tab = (page, name) => page.click(`nav.tabs button[data-view="${name}"]`)
async function noSideways(page, where) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  assert.ok(sw <= cw + 1, `${where}: page is ${sw}px wide in a ${cw}px screen (sideways scrolling)`)
}
const shot = async (page, dir, name) => {
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(400)
  // hide passing toasts so they don't cover the screen in store screenshots
  await page.evaluate(() => { const t = document.getElementById('toasts'); if (t) t.style.visibility = 'hidden' })
  await page.screenshot({ path: path.join(dir, `${name}.png`) })
  await page.evaluate(() => { const t = document.getElementById('toasts'); if (t) t.style.visibility = '' })
}

/** The whole user journey. `shots` = folder for store screenshots (or null). */
async function journey({ size, shots = null, prefix = '', label }) {
  const { context, page, errors } = await newPhone(size)
  const step = (name) => label ? ok(`${label}: ${name}`) : ok(name)
  try {
    await page.goto(APP)

    // ---- first run: role + AI consent ----
    const dlg = page.locator('dialog.welcome-dialog')
    await dlg.waitFor()
    assert.match(await dlg.innerText(), /18 and over/)
    assert.match(await dlg.innerText(), /What DoTask sends to Google Gemini/)
    await dlg.locator('button', { hasText: 'I teach' }).click()
    await dlg.locator('button', { hasText: 'Allow and continue' }).click()
    await page.locator('#view-teach').waitFor({ state: 'visible' })
    await page.locator('#view-teach >> text=Connect your free AI key').waitFor()
    step('welcome asks role and AI consent (18+), then opens Teach')

    // ---- AI key typed in Settings goes to secure storage, not plain preferences ----
    await tab(page, 'settings')
    const keyInput = page.locator('#view-settings input[placeholder^="Paste your key"]')
    await keyInput.fill('test-phone-key')
    await keyInput.press('Tab')
    await page.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings?.geminiApiKey === 'test-phone-key')
    const plain = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => /dotask\.settings/.test(k)).map(([, v]) => v).join(''))
    assert.ok(plain.length > 0, 'settings were saved to Preferences')
    assert.ok(!plain.includes('test-phone-key'), 'the API key must not sit in plain Preferences')
    assert.equal(await page.locator('#view-settings h3', { hasText: 'Web tasks' }).count(), 0, 'no web-agent card on phones')
    assert.equal(await page.locator('#view-settings >> text=localhost').count(), 0, 'no localhost presets on phones')
    await noSideways(page, 'Settings')
    step('API key is stored apart from settings; desktop-only cards hidden')

    // ---- Teach: phone sign-in screen, then Demo School ----
    await page.evaluate(() => chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, freeTierKey: false } })))
    await tab(page, 'teach')
    await page.locator('#view-teach >> text=Sign in with Canvas').waitFor()
    assert.ok(await page.locator('#view-teach >> text=Client ID').first().isVisible())
    assert.equal(await page.locator('#view-teach >> text=personal access token').count(), 0, 'store builds never ask for a personal token')
    await noSideways(page, 'Teach sign-in')
    await page.locator('#view-teach button', { hasText: 'Try Demo School' }).click()
    await page.locator('#view-teach >> text=Demo School').first().waitFor()
    await page.locator('#view-teach .item', { hasText: 'Biology 101' }).click()
    await page.locator('#view-teach .item', { hasText: 'photosynthesis' }).first().click()
    step('phone Canvas screen offers sign-in and Demo School; demo course opens')

    // ---- Draft every submission, check scores differ, post one ----
    const draftBtn = page.locator('#view-teach button', { hasText: /Draft \d* ?with AI/ })
    await draftBtn.click()
    await page.waitForFunction(() => !document.querySelector('#view-teach')?.innerText.includes('Drafting'), null, { timeout: 120000 })
    const queue = await page.locator('#view-teach').innerText()
    const scores = [...queue.matchAll(/Draft (\d+)\/20/g)].map(m => Number(m[1]))
    assert.ok(scores.length >= 3, `expected 3+ drafts, saw: ${scores.join(', ')}`)
    assert.ok(new Set(scores).size >= 2, `scores should differ between students: ${scores.join(', ')}`)
    const names = aiCalls.filter(c => /teaching assistant/i.test(c.system))
    assert.ok(names.length >= 3, 'one AI request per student')
    await noSideways(page, 'Grading queue')
    step(`drafts one grade per student (${scores.join(', ')})`)

    await page.locator('#view-teach .item', { hasText: /Draft \d+\/20/ }).first().click()
    const postBtn = page.locator('#view-teach button', { hasText: /✓ Post to / })
    await postBtn.waitFor()
    await shot(page, shots, prefix + '1-grading-review')
    const who = (await postBtn.innerText()).replace(/.*Post to /, '').trim()
    await postBtn.click()
    // the app confirms with a toast and moves on to the next student
    await page.locator('#toasts .toast', { hasText: /Posted to|error|failed|Safety/i }).first().waitFor({ timeout: 30000 })
    const toastText = await page.locator('#toasts .toast').allInnerTexts()
    assert.ok(toastText.some(t => t.includes(`Posted to ${who}`)), `posting failed: ${toastText.join(' | ')}`)
    step(`posts the grade to ${who} in Demo School`)

    // ---- Students: history for that student ----
    await page.locator('#view-teach .seg button', { hasText: 'Students' }).click()
    await page.locator('#view-teach .item', { hasText: who }).first().click()
    await page.locator('#view-teach').getByText(/photosynthesis/i).first().waitFor()
    await shot(page, shots, prefix + '2-student-history')
    await noSideways(page, 'Student history')
    step('student history shows the posted work')

    // ---- Study: paste, explain (streams), photo, flashcards ----
    await tab(page, 'study')
    assert.equal(await page.locator('#view-study button', { hasText: 'This page' }).count(), 0, 'no "This page" on phones')
    assert.ok(await page.locator('#view-study button', { hasText: 'Photo' }).first().isVisible())
    await page.locator('#view-study button', { hasText: 'Paste text' }).click()
    await page.locator('dialog[open] textarea').fill('Photosynthesis happens in chloroplasts. Chlorophyll absorbs light energy. Plants use water and carbon dioxide to make glucose and release oxygen.')
    await page.locator('dialog[open] button', { hasText: 'Study this' }).click()
    await page.locator('#view-study button', { hasText: 'Explain it' }).click()
    await page.locator('#view-study .msg.ai', { hasText: 'Quick check' }).waitFor()
    await shot(page, shots, prefix + '3-study-tutor')
    step('study: pasted notes, streamed explanation')

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await page.setInputFiles('#view-study input[type=file][accept="image/*"]', { name: 'worksheet.png', mimeType: 'image/png', buffer: png })
    await page.locator('#view-study >> text=/Now studying \\*?\\*?Photo/').first().waitFor()
    await page.locator('#view-study button', { hasText: 'Flashcards' }).click()
    await page.locator('#view-study >> text=What pigment absorbs light?').waitFor()
    assert.ok(aiCalls.some(c => c.hasImage), 'the photo was sent to the AI as an image')
    await noSideways(page, 'Study')
    step('study: photo of a page, then flashcards from it')

    // ---- Voice tutor with the camera ----
    const startBtn = page.locator('#view-study button', { hasText: 'Start talking' })
    if (!(await startBtn.count())) await page.locator('#view-study button', { hasText: /Voice|🎙/ }).first().click()
    await startBtn.click()
    await page.waitForFunction(() => document.querySelector('#view-study')?.innerText.includes('Show my camera'))
    const before = live.images
    await page.locator('#view-study label', { hasText: 'Show my camera' }).click()
    await page.locator('#view-study video.camera-preview').waitFor({ timeout: 15000 })
    await page.waitForFunction(() => true, null, { timeout: 100 })
    for (let i = 0; i < 40 && live.images <= before; i++) await page.waitForTimeout(250)
    assert.ok(live.setups >= 1, 'voice session started')
    assert.ok(live.images > before, 'camera pictures reach the tutor while "Show my camera" is on')
    assert.equal(await page.locator('#view-study video.camera-preview').count(), 1, 'one camera preview')
    const studyText = await page.locator('#view-study').innerText()
    assert.ok(!/(null|undefined|NaN)/.test(studyText), `stray value on the Study screen: ${studyText.match(/.{0,40}(null|undefined|NaN).{0,20}/)?.[0]}`)
    await shot(page, shots, prefix + '4-voice-tutor')
    await page.locator('#view-study button', { hasText: /Stop|End/ }).first().click()
    await page.waitForFunction(() => !document.querySelector('#view-study video.camera-preview'), null, { timeout: 10000 })
    step('voice tutor sees through the camera, and the camera turns off when it ends')

    // ---- Write: paste-in, draft, share instead of insert ----
    await tab(page, 'write')
    assert.equal(await page.locator('#view-write button', { hasText: 'Insert into page' }).count(), 0)
    assert.ok(await page.locator('#view-write button', { hasText: 'Share' }).first().isVisible())
    await page.locator('#view-write textarea').first().fill('Hi Ms. Rivera, I have been sick this week. Could I get a few extra days for the lab report? Thanks, Jordan')
    await page.locator('#view-write button', { hasText: 'Write it' }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('#view-write textarea')].some(t => /three-day extension/.test(t.value)))
    await shot(page, shots, prefix + '5-write-reply')
    await noSideways(page, 'Write')
    step('write: drafts a reply; Share replaces "Insert into page"')

    // ---- every AI call used the header key, never the URL ----
    assert.ok(aiCalls.length > 0 && aiCalls.every(c => c.key === 'test-phone-key' && !/[?&]key=/.test(c.url)), 'AI calls must use the x-goog-api-key header')
    assert.deepEqual(errors, [], 'no errors in the app')
    step('AI calls use the header key; no errors in the app')
  } finally {
    await context.close()
  }
}

let failed = false
try {
  console.log('\nPhone app (390x844)')
  await journey({ size: { width: 390, height: 844, scale: 2 } })
  if (process.env.SHOTS) {
    console.log('\nStore screenshots')
    await journey({ size: { width: 440, height: 956, scale: 3 }, shots: FASTLANE, prefix: 'iPhone69-', label: 'App Store 1320x2868' })
    await journey({ size: { width: 360, height: 640, scale: 3 }, shots: path.join(STORE, 'play-phone'), label: 'Google Play 1080x1920' })
  }
} catch (e) {
  failed = true
  console.error(`\n  ✗ ${e.message.split('\n').slice(0, 6).join('\n    ')}`)
} finally {
  await browser.close()
  server.close()
}
console.log(`\n${failed ? 'FAILED after' : 'Phone e2e passed:'} ${passed} checks`)
process.exit(failed ? 1 : 0)
