// Real-service check: talks to the REAL Gemini API and Gemini Live voice service with your key,
// and (optionally) reads from your real Canvas. It never posts anything to Canvas.
//
//   npm run smoke                                  (asks for your Gemini key)
//   PowerShell:  $env:GEMINI_API_KEY="AIza..."; npm run smoke
//   Optional Canvas (read-only):
//     $env:CANVAS_URL="https://yourschool.instructure.com"; $env:CANVAS_TOKEN="..."; npm run smoke
//     (Canvas → Account → Settings → New access token)
//
// Cost: a handful of tiny requests. Free on a free-tier key.

import readline from 'node:readline/promises'
import { AIClient, GEMINI_DEFAULTS, estimateCost } from '../extension/lib/ai.js'
import { DEFAULTS } from '../extension/lib/settings.js'
import { WS_URL, buildSetup, LIVE_TOOLS } from '../extension/lib/live.js'
import { GRADE_SCHEMA, gradingSystem } from '../extension/lib/grader.js'

let failed = 0
const pass = (m) => console.log(`  ✓ ${m}`)
const fail = (m) => { failed++; console.log(`  ✗ ${m}`) }
const info = (m) => console.log(`    ${m}`)

async function askKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim()
  if (!process.stdin.isTTY) return ''
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const k = await rl.question('Paste your Gemini API key (from aistudio.google.com/apikey): ')
  rl.close()
  return k.trim()
}

const key = await askKey()
if (!key) {
  console.log('No key given. Set GEMINI_API_KEY or run this in a terminal so it can ask you.')
  process.exit(2)
}

const usage = { input: 0, output: 0, cost: 0 }
const settings = { ...DEFAULTS, geminiApiKey: key, useFallbacks: false }
const ai = new AIClient(settings, {
  onUsage: (u) => { usage.input += u.inputTokens; usage.output += u.outputTokens; usage.cost += estimateCost(u.model, u.inputTokens, u.outputTokens) }
})

console.log('\nGemini API (real)')
// 1. the models DoTask uses exist for this key
let models = []
try {
  models = await ai.listModels()
  pass(`key works — ${models.length} models available`)
} catch (e) {
  fail(`key check failed: ${e.message}`)
  process.exit(1)
}
const ids = new Set(models.map(m => m.id))
for (const [role, id] of [['fast (web steps)', settings.fastModel], ['smart (grading, tutoring)', settings.smartModel]]) {
  if (ids.has(id)) pass(`${role} model ${id} exists`)
  else {
    fail(`${role} model ${id} is NOT available`)
    info(`similar: ${models.filter(m => m.text && /flash/.test(m.id)).map(m => m.id).slice(0, 8).join(', ') || '(none)'}`)
  }
}
const live = models.find(m => m.id === settings.liveModel)
if (live) pass(`voice model ${settings.liveModel} exists${live.live ? ' (supports live audio)' : ''}`)
else {
  fail(`voice model ${settings.liveModel} is NOT available`)
  info(`live-capable: ${models.filter(m => m.live).map(m => m.id).slice(0, 8).join(', ') || '(none listed)'}`)
}
const fallbacks = [...new Set([...GEMINI_DEFAULTS.fallbacks.fast, ...GEMINI_DEFAULTS.fallbacks.smart])]
const missing = fallbacks.filter(f => !ids.has(f))
if (missing.length) info(`free fallbacks not available on this key (skipped automatically): ${missing.join(', ')}`)
else pass(`all ${fallbacks.length} free fallback models exist`)

// 2. plain answer from the fast model
try {
  const r = await ai.generate({ tier: 'fast', prompt: 'Reply with exactly the word: READY', temperature: 0, maxTokens: 20 })
  if (/READY/i.test(r.text)) pass(`fast model answers (${r.model})`)
  else fail(`fast model gave an unexpected answer: ${r.text.slice(0, 80)}`)
} catch (e) { fail(`fast model: ${e.message}`) }

// 3. streaming (Study / Write tabs)
try {
  let chunks = 0
  const r = await ai.generate({ tier: 'fast', prompt: 'Count from 1 to 20, comma separated.', temperature: 0, maxTokens: 200, onText: () => { chunks++ } })
  if (chunks >= 1 && /20/.test(r.text)) pass(`streaming works (${chunks} chunks)`)
  else fail(`streaming returned ${chunks} chunks: ${r.text.slice(0, 60)}`)
} catch (e) { fail(`streaming: ${e.message}`) }

// 4. structured grading with the anti-mix-up reference (Teach tab)
try {
  const ref = 'ref' + Math.random().toString(36).slice(2, 8)
  const r = await ai.generate({
    tier: 'smart', system: gradingSystem(settings), schema: GRADE_SCHEMA, temperature: 0.2, maxTokens: 1500,
    prompt: `STUDENT REF: ${ref}\nASSIGNMENT: Explain photosynthesis in 2-3 sentences. Points possible: 10\nRUBRIC: none\n\nSUBMISSION (attempt 1):\n"""\nPlants use sunlight, water and carbon dioxide to make glucose and oxygen. Chlorophyll in the leaves captures the light.\n"""`
  })
  const j = r.json || {}
  if (j.student_ref === ref) pass('grading echoes the one-time student reference (mix-up guard works)')
  else fail(`grading did not echo the reference (got ${JSON.stringify(j.student_ref)})`)
  if (typeof j.score === 'number' && j.score >= 0 && j.score <= 10) pass(`grading returns a score (${j.score}/10) and feedback (${String(j.comment || '').length} chars)`)
  else fail(`grading score missing or out of range: ${JSON.stringify(j).slice(0, 120)}`)
} catch (e) { fail(`grading: ${e.message}`) }

// 5. live voice: connect, ask for a short spoken reply, receive audio + transcript
console.log('\nGemini Live voice (real)')
await new Promise((resolve) => {
  const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(key)}`)
  let audioBytes = 0, transcript = '', setupOk = false
  const done = (ok, msg) => {
    clearTimeout(timer)
    try { ws.close() } catch {}
    ok ? pass(msg) : fail(msg)
    resolve()
  }
  const timer = setTimeout(() => done(false, setupOk ? `no complete spoken reply within 30 s (audio ${audioBytes} bytes)` : 'no setup reply within 30 s'), 30000)
  ws.onopen = () => ws.send(JSON.stringify({ setup: buildSetup({ model: settings.liveModel, voice: settings.voiceName, system: 'You are a friendly tutor. Keep answers very short.', tools: LIVE_TOOLS }) }))
  ws.onmessage = async (ev) => {
    let msg
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(await ev.data.arrayBuffer()).toString()) } catch { return }
    if (msg.setupComplete !== undefined && !setupOk) {
      setupOk = true
      pass(`voice session opens with ${settings.liveModel} (voice ${settings.voiceName}, page tools on)`)
      ws.send(JSON.stringify({ realtimeInput: { text: 'Say: hello, ready to study?' } }))
    }
    for (const p of msg.serverContent?.modelTurn?.parts || []) if (p.inlineData?.data) audioBytes += Buffer.from(p.inlineData.data, 'base64').length
    if (msg.serverContent?.outputTranscription?.text) transcript += msg.serverContent.outputTranscription.text
    if (msg.serverContent?.turnComplete) {
      done(audioBytes > 4800, audioBytes > 4800
        ? `tutor spoke ${(audioBytes / 48000).toFixed(1)} s of audio${transcript ? `: “${transcript.trim().slice(0, 60)}”` : ''}`
        : `turn finished but almost no audio (${audioBytes} bytes)`)
    }
  }
  ws.onerror = () => {}
  ws.onclose = (ev) => { if (!setupOk) done(false, `voice connection refused${ev.reason ? `: ${ev.reason}` : ''} (check the voice model name)`) }
})

// 6. Canvas, read-only (optional)
const curl = (process.env.CANVAS_URL || '').replace(/\/+$/, '')
const ctoken = process.env.CANVAS_TOKEN || ''
if (curl && ctoken) {
  console.log('\nCanvas (real, read-only)')
  const get = async (p) => {
    const res = await fetch(curl + p, { headers: { Authorization: `Bearer ${ctoken}`, Accept: 'application/json+canvas-string-ids' } })
    if (!res.ok) throw new Error(`${p.split('?')[0]} → HTTP ${res.status}`)
    return JSON.parse((await res.text()).replace(/^while\(1\);/, ''))
  }
  try {
    const me = await get('/api/v1/users/self')
    pass(`signed in to Canvas as user ${me.id}`)
    const courses = await get('/api/v1/courses?enrollment_type=teacher&per_page=50&state[]=available')
    pass(`you teach ${courses.length} active course(s)`)
    const c = courses[0]
    if (c) {
      const as = await get(`/api/v1/courses/${c.id}/assignments?per_page=50`)
      pass(`first course has ${as.length} assignment(s)`)
      const a = as.find(x => x.needs_grading_count > 0) || as[0]
      if (a) {
        const subs = await get(`/api/v1/courses/${c.id}/assignments/${a.id}/submissions?per_page=50&include[]=submission_comments`)
        pass(`assignment ${a.id}: ${subs.length} submission(s) readable, ${subs.reduce((n, s) => n + (s.submission_comments || []).length, 0)} comment(s)`)
      }
    }
  } catch (e) { fail(`Canvas: ${e.message}`) }
} else {
  console.log('\nCanvas: skipped (set CANVAS_URL and CANVAS_TOKEN to also check your Canvas, read-only)')
}

console.log(`\nTokens used: ${usage.input} in / ${usage.output} out · estimated cost $${usage.cost.toFixed(4)} (free on a free-tier key)`)
console.log(failed ? `\n${failed} check(s) FAILED — send this output to get it fixed.` : '\nAll real-service checks passed.')
process.exit(failed ? 1 : 0)
