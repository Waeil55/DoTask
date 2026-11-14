// Phone-only: the small part of the chrome.* extension API that the shared code uses
// (settings, usage meter, links). Must be imported before anything else.
//  - chrome.storage.local  -> Capacitor Preferences (UserDefaults / SharedPreferences)
//  - secret settings       -> iOS Keychain / Android Keystore, never stored in plain preferences
//  - chrome.storage.managed -> empty (no organization policy on phones yet)

import { Preferences, Browser, isNative, secretGet, secretSet } from './native.js'

const SECRET_SETTINGS = ['geminiApiKey', 'openaiApiKey', 'canvasToken', 'canvasRefreshToken', 'canvasClientSecret']
const PREFIX = 'dotask.'
const listeners = new Set()
const session = new Map()

async function readKey(k) {
  const { value } = await Preferences.get({ key: PREFIX + k })
  if (value == null) return undefined
  try { return JSON.parse(value) } catch { return undefined }
}

async function allKeys() {
  const { keys } = await Preferences.keys()
  return keys.filter(k => k.startsWith(PREFIX)).map(k => k.slice(PREFIX.length))
}

function wantedKeys(keys) {
  if (keys == null) return null
  if (typeof keys === 'string') return [keys]
  if (Array.isArray(keys)) return keys
  return Object.keys(keys)
}

const local = {
  async get(keys) {
    const list = wantedKeys(keys) || await allKeys()
    const out = {}
    for (const k of list) {
      const v = await readKey(k)
      if (v !== undefined) out[k] = v
      else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k]
    }
    if (list.includes('settings')) {
      const s = { ...(out.settings || {}) }
      for (const name of SECRET_SETTINGS) {
        const v = await secretGet(name)
        if (v) s[name] = v
      }
      out.settings = s
    }
    return out
  },
  async set(items) {
    const changes = {}
    for (const [k, v] of Object.entries(items || {})) {
      let stored = v
      if (k === 'settings' && v && typeof v === 'object') {
        stored = { ...v }
        for (const name of SECRET_SETTINGS) {
          if (name in stored) { await secretSet(name, stored[name]); delete stored[name] }
        }
      }
      await Preferences.set({ key: PREFIX + k, value: JSON.stringify(stored) })
      changes[k] = { newValue: v }
    }
    emit(changes, 'local')
  },
  async remove(keys) {
    const changes = {}
    for (const k of wantedKeys(keys) || []) {
      await Preferences.remove({ key: PREFIX + k })
      if (k === 'settings') for (const name of SECRET_SETTINGS) await secretSet(name, '')
      changes[k] = { newValue: undefined }
    }
    emit(changes, 'local')
  },
  async clear() {
    for (const k of await allKeys()) await Preferences.remove({ key: PREFIX + k })
    for (const name of SECRET_SETTINGS) await secretSet(name, '')
  }
}

function emit(changes, area) {
  for (const fn of listeners) { try { fn(changes, area) } catch (e) { console.error(e) } }
}

const sessionArea = {
  async get(keys) {
    const out = {}
    for (const k of wantedKeys(keys) || [...session.keys()]) if (session.has(k)) out[k] = session.get(k)
    return out
  },
  async set(items) { for (const [k, v] of Object.entries(items || {})) session.set(k, v) },
  async remove(keys) { for (const k of wantedKeys(keys) || []) session.delete(k) }
}

const noopEvent = { addListener() {}, removeListener() {}, hasListener: () => false }

globalThis.chrome = {
  storage: {
    local,
    session: sessionArea,
    managed: { get: async () => ({}) },
    onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn), hasListener: (fn) => listeners.has(fn) }
  },
  runtime: {
    getURL: (p) => new URL(String(p).replace(/^\//, ''), location.href).href,
    getManifest: () => ({ version: globalThis.DOTASK_VERSION || '' }),
    onMessage: noopEvent,
    sendMessage: async () => undefined
  },
  tabs: {
    // links open in the in-app browser (SFSafariViewController / Custom Tabs)
    create: async ({ url }) => { if (isNative) await Browser.open({ url }); else window.open(url, '_blank', 'noopener') },
    query: async () => [],
    get: async () => { throw new Error('No browser tabs on a phone') },
    onActivated: noopEvent,
    onUpdated: noopEvent,
    onCreated: noopEvent
  },
  windows: { getCurrent: async () => null, onFocusChanged: noopEvent }
}
