// App shell: tabs, shared context, site chip, right-click actions.

import { AIClient } from './lib/ai.js'
import { getSettings, onSettingsChanged, recordUsage, managedReady } from './lib/settings.js'
import { getTargetTab, isControllable, setBlockedSites } from './lib/tabs.js'
import { h, toast } from './lib/ui.js'
import * as doView from './views/do.js'
import * as teachView from './views/teach.js'
import * as studyView from './views/study.js'
import * as writeView from './views/write.js'
import * as settingsView from './views/settings.js'

const views = { do: doView, teach: teachView, study: studyView, write: writeView, settings: settingsView }
const mounted = {}

const ctx = {
  settings: await getSettings(),
  ai() { return new AIClient(ctx.settings, { onUsage: (u) => recordUsage(u).catch(() => {}) }) },
  go(name, payload) {
    for (const b of document.querySelectorAll('nav.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === name))
    for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === `view-${name}`)
    if (!mounted[name]) mounted[name] = views[name].mount(document.getElementById(`view-${name}`), ctx) || {}
    mounted[name].onShow?.(payload)
    ctx.current = name
  },
  /** Card shown when no AI key is configured yet. */
  setupCard() {
    if (new AIClient(ctx.settings).isConfigured()) return null
    return h('div', { class: 'card welcome' },
      h('h3', null, 'Welcome to DoTask 👋'),
      h('p', null, 'Connect a free AI brain in 1 minute:'),
      h('ol', { class: 'steps' },
        h('li', null, 'Open ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank' }, 'aistudio.google.com/apikey'), ' and click “Create API key” (free).'),
        h('li', null, 'Copy the key.'),
        h('li', null, 'Paste it in Settings.')),
      h('button', { class: 'btn', onclick: () => ctx.go('settings') }, 'Open Settings'))
  },
  listeners: new Set(),
  onTabChange(fn) { ctx.listeners.add(fn); return () => ctx.listeners.delete(fn) }
}

document.querySelector('nav.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]')
  if (b) ctx.go(b.dataset.view)
})

setBlockedSites(ctx.settings.blockedSites)

async function reloadSettings() {
  ctx.settings = await getSettings()
  setBlockedSites(ctx.settings.blockedSites)
  for (const m of Object.values(mounted)) m.onSettings?.()
}
onSettingsChanged(reloadSettings)
// organization policies may arrive a few seconds after startup
managedReady().then(() => { if (ctx.settings.managedKeys.length === 0) reloadSettings() })

// ---- the "working on" chip ----
const chip = document.getElementById('siteChip')
async function refreshChip() {
  const tab = await getTargetTab().catch(() => null)
  ctx.tab = tab
  if (tab && isControllable(tab.url)) {
    const host = new URL(tab.url).hostname.replace(/^www\./, '')
    chip.textContent = host
    chip.title = `DoTask works on: ${tab.title || host}`
  } else {
    chip.textContent = 'No website open'
    chip.title = 'Open a website in this window'
  }
  for (const fn of ctx.listeners) fn(tab)
}
chrome.tabs.onActivated.addListener(refreshChip)
chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete' || info.url) refreshChip() })
chrome.windows.onFocusChanged.addListener(refreshChip)
refreshChip()

// ---- right-click actions from the page ----
async function takePending() {
  const { pendingAction } = await chrome.storage.session.get('pendingAction')
  if (!pendingAction || Date.now() - pendingAction.ts > 60000) return
  await chrome.storage.session.remove('pendingAction')
  if (pendingAction.kind === 'reply') ctx.go('write', { original: pendingAction.text })
  else if (pendingAction.kind === 'explain') ctx.go('study', { explain: pendingAction.text })
  else if (pendingAction.kind === 'read') ctx.go('study', { read: pendingAction.text })
  else if (pendingAction.kind === 'study') ctx.go('study', { usePage: true })
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'pendingAction') takePending()
  if (msg?.type === 'agent.stop') mounted.do?.stop?.()
})

window.addEventListener('unhandledrejection', (e) => {
  const m = e.reason?.message || String(e.reason)
  if (e.reason?.name !== 'AbortError') toast(m, 'error', 6000)
})

const startView = new URLSearchParams(location.search).get('view') || (ctx.settings.onboarded ? 'do' : (new AIClient(ctx.settings).isConfigured() ? 'do' : 'settings'))
ctx.go(startView)
takePending()
