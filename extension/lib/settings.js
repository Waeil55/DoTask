// Settings live in chrome.storage.local (this browser only). IT admins can force values
// through Chrome enterprise policy (chrome.storage.managed, see managed_schema.json).

import { GEMINI_DEFAULTS, estimateCost } from './ai.js'

export const DEFAULTS = {
  provider: 'gemini',
  geminiApiKey: '',
  openaiBaseUrl: 'http://localhost:11434/v1',
  openaiApiKey: '',
  fastModel: GEMINI_DEFAULTS.fastModel,
  smartModel: GEMINI_DEFAULTS.smartModel,
  liveModel: GEMINI_DEFAULTS.liveModel,
  useFallbacks: true,
  voiceName: 'Aoede',
  language: 'English',
  speechRate: 1.05,
  permissionMode: 'smart', // review | smart | auto
  maxSteps: 40,
  vision: 'auto', // auto | always | never
  nativeInput: false,
  teacherName: '',
  gradingStyle: '',
  feedbackTone: 'warm, specific and encouraging',
  feedbackLength: 'medium',
  canvasToken: '',
  canvasUrl: '',
  canvasClientId: '', // phones: OAuth developer key from the school's Canvas admin
  canvasClientSecret: '',
  canvasRefreshToken: '',
  canvasDemo: false, // Demo School: fictional sample data, no Canvas needed
  freeTierKey: true,
  onboarded: false
}

let cachedManaged = null
let managedPromise = null

/** Policy lookup can take seconds at browser startup, so never block the UI on it. */
export function managedReady() {
  if (!managedPromise) {
    managedPromise = Promise.resolve()
      .then(() => chrome.storage.managed.get(null))
      .then((v) => { cachedManaged = v || {} }, () => { cachedManaged = {} })
  }
  return managedPromise
}

let managedSlow = false // the policy lookup missed its first 400 ms: stop waiting on it (the panel reloads when it lands)

export async function getManaged() {
  if (cachedManaged) return cachedManaged
  if (managedSlow) return {}
  await Promise.race([managedReady(), new Promise(r => setTimeout(r, 400))])
  if (!cachedManaged) managedSlow = true
  return cachedManaged || {}
}

export async function getSettings() {
  const [local, managed] = await Promise.all([chrome.storage.local.get('settings'), getManaged()])
  const s = { ...DEFAULTS, ...(local.settings || {}) }
  for (const k of ['provider', 'geminiApiKey', 'openaiBaseUrl', 'openaiApiKey', 'fastModel', 'smartModel', 'liveModel', 'permissionMode']) {
    if (managed[k] !== undefined && managed[k] !== '') s[k] = managed[k]
  }
  s.allowAutopilot = managed.allowAutopilot !== false
  if (!s.allowAutopilot && s.permissionMode === 'auto') s.permissionMode = 'smart'
  s.blockedSites = Array.isArray(managed.blockedSites) ? managed.blockedSites : []
  s.locked = managed.lockSettings === true
  s.managedKeys = Object.keys(managed)
  return s
}

export async function saveSettings(patch) {
  const { settings = {} } = await chrome.storage.local.get('settings')
  const next = { ...settings, ...patch }
  await chrome.storage.local.set({ settings: next })
  return getSettings()
}

export function onSettingsChanged(fn) {
  chrome.storage.onChanged.addListener((changes, area) => {
    // a policy change: look it up again, and wait for it again like the first time
    if (area === 'managed') { cachedManaged = null; managedPromise = null; managedSlow = false; managedReady().then(fn); return }
    if (area === 'local' && changes.settings) fn()
  })
}

// ---- usage meter (local only) ----
const today = () => new Date().toISOString().slice(0, 10)

export async function recordUsage({ model, inputTokens, outputTokens }) {
  const { usage = {} } = await chrome.storage.local.get('usage')
  const d = today()
  const day = usage[d] || { requests: 0, input: 0, output: 0, cost: 0 }
  day.requests++
  day.input += inputTokens
  day.output += outputTokens
  day.cost += estimateCost(model, inputTokens, outputTokens)
  usage[d] = day
  for (const k of Object.keys(usage).sort().slice(0, -60)) delete usage[k]
  await chrome.storage.local.set({ usage })
}

export async function getUsage() {
  const { usage = {} } = await chrome.storage.local.get('usage')
  const days = Object.keys(usage).sort()
  const month = days.filter(d => d.slice(0, 7) === today().slice(0, 7))
  const sum = (keys) => keys.reduce((a, k) => ({
    requests: a.requests + usage[k].requests, input: a.input + usage[k].input,
    output: a.output + usage[k].output, cost: a.cost + usage[k].cost
  }), { requests: 0, input: 0, output: 0, cost: 0 })
  return { today: usage[today()] || sum([]), month: sum(month) }
}
