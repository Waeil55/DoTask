// What this host can do. The phone app's copy (the browser extension ships its own lib/platform.js).
// Shared screens check these flags instead of assuming browser tabs exist.

import { isNative, os, Browser, Share, Filesystem, Directory } from './native.js'
import { bytesToBase64 } from './util.js'
import * as canvasAuth from './canvas-oauth.js'

const VERSION = '__DOTASK_VERSION__'
// Internal/TestFlight builds (node build.mjs --internal) may use a personal Canvas token for the
// owner's own account. Store builds may not: Instructure requires OAuth for apps with many users.
const INTERNAL = '__DOTASK_INTERNAL__' === 'true'
globalThis.DOTASK_VERSION = VERSION

/** Live camera for the voice tutor ("Show my camera"). */
function createCamera() {
  let stream = null
  let video = null
  return {
    get on() { return !!stream },
    /** Starts the back camera and returns a muted <video> preview element. */
    async start() {
      if (stream) return video
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      })
      video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true, className: 'camera-preview' })
      video.setAttribute('playsinline', '')
      video.srcObject = stream
      await video.play().catch(() => {})
      return video
    },
    /** One JPEG frame, scaled down to save AI tokens. */
    async frame({ maxWidth = 960, quality = 0.5 } = {}) {
      if (!video || !video.videoWidth) throw new Error('The camera is not ready')
      const scale = Math.min(1, maxWidth / video.videoWidth)
      const w = Math.round(video.videoWidth * scale), h = Math.round(video.videoHeight * scale)
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
      canvas.getContext('2d').drawImage(video, 0, 0, w, h)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
      return { data, mimeType: 'image/jpeg', width: w, height: h }
    },
    stop() {
      stream?.getTracks().forEach(t => t.stop())
      if (video) { video.srcObject = null; video.remove() }
      stream = null
      video = null
    }
  }
}

// closing the share sheet without choosing an app is not an error
const cancelled = (e) => { if (!/cancel/i.test(String(e?.message || e))) throw e }

export const platform = {
  kind: os, // 'ios' | 'android' | 'web'
  phone: true,
  /** Reading and acting on web pages (needs the desktop browser extension). */
  pages: false,
  /** Folder access on a computer. */
  folders: false,
  /** Trusted clicks through the browser's debugger. */
  nativeInput: false,
  /** Canvas through the signed-in browser tab (phones use an access token instead). */
  canvasViaTab: false,
  /** Canvas OAuth sign-in through the system browser (signIn / refresh / revoke). */
  canvasAuth,
  internal: INTERNAL,
  version: () => VERSION,
  asset: (p) => new URL(String(p).replace(/^\//, ''), location.href).href,
  openUrl: async (url) => {
    if (isNative) await Browser.open({ url })
    else window.open(url, '_blank', 'noopener')
  },
  openPermissionPage: async () => {
    const { toast } = await import('./ui.js') // dynamic: ui.js imports this file
    toast(os === 'android'
      ? 'Allow the microphone (and camera) for DoTask: Android Settings → Apps → DoTask → Permissions.'
      : 'Allow the microphone (and camera) for DoTask: iPhone Settings → DoTask.', 'warn', 9000)
  },
  camera: createCamera(),
  /** Opens the share sheet with text or a file (bytes). Returns false if sharing is not available. */
  async share({ title, text, file }) {
    if (!isNative) {
      if (file) {
        const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mimeType }))
        const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
        document.body.append(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        return true
      }
      if (navigator.share) { await navigator.share({ title, text }).catch(() => {}); return true }
      return false
    }
    if (file) {
      const safe = file.name.replace(/[\\/:*?"<>|]/g, '_')
      const w = await Filesystem.writeFile({ path: safe, data: bytesToBase64(file.bytes), directory: Directory.Cache })
      await Share.share({ title: title || safe, files: [w.uri], dialogTitle: title || safe }).catch(cancelled)
    } else {
      await Share.share({ title, text, dialogTitle: title }).catch(cancelled)
    }
    return true
  }
}
