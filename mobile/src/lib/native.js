// Phone-only: access to Capacitor's native plugins. In a normal browser (tests, previews) every
// plugin falls back to its web version, so the same code runs everywhere.

import { Capacitor, CapacitorHttp } from '../vendor/capacitor-core.js'
import { Preferences } from '../vendor/plugins/preferences/index.js'
import { SecureStorage } from '../vendor/plugins/secure-storage/index.js'
import { Share } from '../vendor/plugins/share/index.js'
import { Browser } from '../vendor/plugins/browser/index.js'
import { Filesystem, Directory } from '../vendor/plugins/filesystem/index.js'
import { App } from '../vendor/plugins/app/index.js'
import { StatusBar, Style } from '../vendor/plugins/status-bar/index.js'
import { Keyboard } from '../vendor/plugins/keyboard/index.js'
import { SplashScreen } from '../vendor/plugins/splash-screen/index.js'
import { base64ToBytes } from './util.js'

export { Capacitor, Preferences, SecureStorage, Share, Browser, Filesystem, Directory, App, StatusBar, Style, Keyboard, SplashScreen }

/** true inside the iOS/Android app, false in a normal browser */
export const isNative = Capacitor.isNativePlatform()
/** 'ios' | 'android' | 'web' */
export const os = Capacitor.getPlatform()

// ---------- secrets: iOS Keychain / Android Keystore (not synced to iCloud) ----------
export async function secretGet(name) {
  try { return (await SecureStorage.get(name)) ?? '' } catch { return '' }
}
export async function secretSet(name, value) {
  if (value) await SecureStorage.set(name, String(value))
  else await SecureStorage.remove(name).catch(() => {})
}

// ---------- HTTP ----------
// A web page may only call sites that allow it (CORS). Canvas does not allow apps, so in the app
// requests to other sites go through the phone's own HTTP stack instead. AI providers stay on the
// web view's fetch because they allow it and their answers stream word by word.
const WEBVIEW_HOSTS = /(^|\.)(googleapis\.com|groq\.com|openrouter\.ai|openai\.com)$/i
const webFetch = globalThis.fetch.bind(globalThis)

function aborted() {
  return Object.assign(new Error('Stopped'), { name: 'AbortError' })
}

/** fetch() replacement: same API, but cross-site calls in the app skip CORS. */
export async function bridgedFetch(input, init = {}) {
  const req = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const url = new URL(req ? req.url : String(input), location.href)
  if (!isNative || url.origin === location.origin || WEBVIEW_HOSTS.test(url.hostname) || !/^https?:$/.test(url.protocol)) {
    return webFetch(input, init)
  }
  const signal = init.signal || req?.signal
  if (signal?.aborted) throw aborted()
  const headers = {}
  new Headers(init.headers || req?.headers || {}).forEach((v, k) => { headers[k] = v })
  // Instructure asks native API clients to identify themselves
  if (!headers['user-agent']) headers['user-agent'] = `DoTask/${globalThis.DOTASK_VERSION || '2'} (${os === 'ios' ? 'iOS' : 'Android'})`
  let data
  if (init.body != null) {
    const type = headers['content-type'] || ''
    if (/json/i.test(type) && typeof init.body === 'string') data = JSON.parse(init.body)
    // iOS native HTTP only accepts a plain object for form bodies
    else if (/x-www-form-urlencoded/i.test(type)) data = Object.fromEntries(new URLSearchParams(String(init.body)))
    else data = init.body
  }
  const call = CapacitorHttp.request({
    url: url.href,
    method: String(init.method || req?.method || 'GET').toUpperCase(),
    headers,
    data,
    responseType: 'arraybuffer',
    connectTimeout: 30000,
    readTimeout: 180000
  })
  const r = await (signal
    ? Promise.race([call, new Promise((_, reject) => signal.addEventListener('abort', () => reject(aborted()), { once: true }))])
    : call)
  const lower = {}
  for (const [k, v] of Object.entries(r.headers || {})) lower[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v)
  const type = lower['content-type'] || ''
  let bytes
  if (r.data == null || r.data === '') bytes = new Uint8Array(0)
  else if (typeof r.data !== 'string') bytes = new TextEncoder().encode(JSON.stringify(r.data)) // JSON is parsed natively
  else if (/json/i.test(type) || (os === 'android' && r.status >= 400)) bytes = new TextEncoder().encode(r.data)
  else bytes = base64ToBytes(r.data.replace(/\s+/g, '')) // binary-safe: native returns base64
  const empty = r.status === 204 || r.status === 205 || r.status === 304
  return new Response(empty ? null : bytes, { status: r.status, headers: lower })
}

export function installFetchBridge() {
  if (isNative) globalThis.fetch = bridgedFetch
}
