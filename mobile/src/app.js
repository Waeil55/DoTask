// Phone app shell: bottom tabs, first-run welcome with the AI data notice, Canvas over native HTTP,
// a safety copy of student history, Android back button. Screens are shared with the extension.

import './lib/chrome-shim.js' // must be first: shared code expects chrome.storage
import { installFetchBridge, isNative, os, App, StatusBar, Style, Filesystem, Directory, Preferences, SplashScreen } from './lib/native.js'
import { AIClient, AIError } from './lib/ai.js'
import { getSettings, saveSettings, onSettingsChanged, recordUsage } from './lib/settings.js'
import { db, exportAll, importAll } from './lib/db.js'
import { platform } from './lib/platform.js'
import { h, toast } from './lib/ui.js'
import * as teachView from './views/teach.js'
import * as studyView from './views/study.js'
import * as writeView from './views/write.js'
import * as settingsView from './views/settings.js'

installFetchBridge()
document.body.classList.add('phone', `os-${os}`)

const views = { teach: teachView, study: studyView, write: writeView, settings: settingsView }
const mounted = {}

/** AI client that sends nothing until the user has agreed to the data notice. */
class PhoneAI extends AIClient {
  isConfigured() { return !!ctx.settings.aiConsent && super.isConfigured() }
  get supportsLive() { return !!ctx.settings.aiConsent && super.supportsLive }
  async generate(req) {
    if (!ctx.settings.aiConsent) throw new AIError('First allow DoTask to use Google Gemini (tap “Review and allow” at the top).')
    return super.generate(req)
  }
}

const ctx = {
  settings: await getSettings(),
  platform,
  ai() { return new PhoneAI(ctx.settings, { onUsage: (u) => recordUsage(u).catch(() => {}) }) },
  go(name, payload) {
    if (!views[name]) name = 'study'
    for (const b of document.querySelectorAll('nav.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === name))
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === `view-${name}`)
    if (!mounted[name]) mounted[name] = views[name].mount(document.getElementById(`view-${name}`), ctx) || {}
    mounted[name].onShow?.(payload)
    ctx.current = name
  },
  /** Card at the top of each screen until the AI is ready to use. */
  setupCard() {
    if (!ctx.settings.aiConsent) {
      return h('div', { class: 'card welcome' },
        h('h3', null, 'Before the AI can help'),
        h('p', null, 'DoTask sends what you ask to Google Gemini using your own free key. Nothing goes to a DoTask server.'),
        h('button', { class: 'btn primary', onclick: () => welcome(true) }, 'Review and allow'))
    }
    if (new AIClient(ctx.settings).isConfigured()) return null
    return h('div', { class: 'card welcome' },
      h('h3', null, 'Connect your free AI key'),
      h('ol', { class: 'steps' },
        h('li', null, 'Open ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank' }, 'aistudio.google.com/apikey'), ' and tap “Create API key” (free).'),
        h('li', null, 'Copy the key.'),
        h('li', null, 'Paste it in Settings → AI brain.')),
      h('button', { class: 'btn', onclick: () => ctx.go('settings') }, 'Open Settings'))
  },
  listeners: new Set(),
  onTabChange(fn) { ctx.listeners.add(fn); return () => ctx.listeners.delete(fn) }
}

async function reloadSettings() {
  ctx.settings = await getSettings()
  for (const m of Object.values(mounted)) m.onSettings?.()
}
onSettingsChanged(reloadSettings)

// ---------- first run: who are you + what is shared with Google ----------
function welcome(fromCard = false) {
  return new Promise((resolve) => {
    const role = h('div', { class: 'seg', style: { margin: '8px 0 12px' } },
      [['teacher', '🍎 I teach'], ['student', '🎓 I’m a student']].map(([id, label]) => h('button', {
        'aria-pressed': String((ctx.settings.role || 'student') === id),
        onclick: (e) => { for (const b of role.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); role.dataset.value = id }
      }, label)))
    role.dataset.value = ctx.settings.role || 'student'
    const done = async (allow) => {
      ctx.settings = await saveSettings({ role: role.dataset.value, aiConsent: allow, onboarded: true })
      dlg.close(); dlg.remove()
      for (const m of Object.values(mounted)) m.onSettings?.()
      if (!fromCard) ctx.go(role.dataset.value === 'teacher' ? 'teach' : 'study')
      resolve(allow)
    }
    const dlg = h('dialog', { class: 'dialog welcome-dialog' },
      h('h2', null, 'Welcome to DoTask'),
      h('p', { class: 'muted' }, 'An AI helper for teachers and students that runs on your own free AI key.'),
      // Google's Gemini API terms do not allow apps meant for people under 18
      h('p', { class: 'small muted' }, 'For teachers and adult learners, 18 and over.'),
      fromCard ? '' : role,
      h('div', { class: 'card flat consent' },
        h('h3', null, 'What DoTask sends to Google Gemini'),
        h('p', { class: 'small' }, 'Only when you use an AI feature, DoTask sends it directly from this phone to Google Gemini, under your own API key:'),
        h('ul', { class: 'small' },
          h('li', null, 'what you type or ask, and the files, photos or pasted text you add'),
          h('li', null, 'your voice, while the voice tutor is on'),
          h('li', null, 'what your camera shows, only while “Show my camera” is on'),
          h('li', null, 'for teachers: student work from Canvas, with student names left out')),
        h('p', { class: 'small' }, 'Google’s Gemini API terms apply. On a free-tier key, Google may use this content to improve its products, so use a paid-tier key for real student records. DoTask has no server: your key, settings and student history stay on this phone. ',
          h('a', { href: 'https://dotask5.web.app/privacy.html', target: '_blank' }, 'Privacy policy'))),
      h('div', { class: 'row gap end', style: { marginTop: '12px' } },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Not now'),
        h('button', { class: 'btn primary', onclick: () => done(true) }, 'Allow and continue')))
    dlg.addEventListener('cancel', (e) => e.preventDefault())
    document.body.append(dlg)
    dlg.showModal()
  })
}

// ---------- links open in the in-app browser, never inside DoTask ----------
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]')
  if (!a) return
  const href = a.getAttribute('href')
  if (/^https?:\/\//i.test(href)) { e.preventDefault(); platform.openUrl(href) }
})

// ---------- safety copy of student history ----------
// iOS and Android may clear a web view's storage when the phone is nearly full. A copy in the app's
// private files brings it back. Deleting all data in Settings deletes the copy too.
const BACKUP = 'dotask-safety-copy.json'
const MARK = 'dotask.dbMarker'
async function dbMarker() { return (await db.get('kv', 'marker'))?.v }
async function setMarkers() {
  const v = String(Date.now())
  await db.put('kv', { k: 'marker', v })
  await Preferences.set({ key: MARK, value: v })
}
async function saveSafetyCopy() {
  if (!isNative) return
  try {
    const data = await exportAll()
    await Filesystem.writeFile({ path: BACKUP, directory: Directory.Data, data: JSON.stringify(data), encoding: 'utf8' })
  } catch (e) { console.warn('safety copy failed', e) }
}
async function restoreIfCleared() {
  if (!isNative) return
  const { value: expected } = await Preferences.get({ key: MARK })
  const actual = await dbMarker().catch(() => null)
  if (expected && !actual) {
    try {
      const file = await Filesystem.readFile({ path: BACKUP, directory: Directory.Data, encoding: 'utf8' })
      const n = await importAll(JSON.parse(file.data))
      toast(`Your phone cleared DoTask’s storage, so DoTask restored ${n} saved records.`, 'ok', 8000)
    } catch { /* no copy yet */ }
  }
  if (!actual) await setMarkers()
}
globalThis.addEventListener('dotask:wiped', async () => {
  await Filesystem.deleteFile({ path: BACKUP, directory: Directory.Data }).catch(() => {})
  await setMarkers()
})

// ---------- app lifecycle ----------
if (isNative) {
  App.addListener('pause', () => saveSafetyCopy())
  setInterval(saveSafetyCopy, 5 * 60 * 1000)
  App.addListener('backButton', ({ canGoBack }) => {
    const open = document.querySelector('dialog[open]')
    if (open) { open.close(); open.remove?.(); return }
    if (ctx.current !== 'study' && ctx.current !== 'teach') return ctx.go(ctx.settings.role === 'teacher' ? 'teach' : 'study')
    if (canGoBack) history.back(); else App.minimizeApp()
  })
  StatusBar.setStyle({ style: Style.Default }).catch(() => {})
}

window.addEventListener('unhandledrejection', (e) => {
  const m = e.reason?.message || String(e.reason)
  if (e.reason?.name !== 'AbortError') toast(m, 'error', 6000)
})

document.querySelector('nav.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]')
  if (b) ctx.go(b.dataset.view)
})

await restoreIfCleared().catch(() => {})
ctx.go(ctx.settings.role === 'teacher' ? 'teach' : 'study')
SplashScreen.hide().catch(() => {})
if (!ctx.settings.onboarded) welcome()
