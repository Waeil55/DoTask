// Side-panel side of page control: picks the tab, talks to content.js, takes screenshots,
// and (optionally) sends trusted input through Chrome's DevTools protocol.

import { bytesToBase64, sleep, isBlockedHost, hostOf, withTimeout } from './util.js'

// A busy or frozen page must never freeze DoTask: every call into a tab has a time limit.
const PING_MS = 2500
const INJECT_MS = 10000
const SEND_MS = { canvasFetch: 180000, settle: 12000 }
const DEFAULT_SEND_MS = 30000
const CAPTURE_MS = 8000

const params = new URLSearchParams(globalThis.location?.search || '')
let pinnedTabId = params.get('tab') ? Number(params.get('tab')) : null

export function pinTab(id) { pinnedTabId = id }

// organization policy: sites DoTask must never read or touch (set from settings)
let blockedSites = []
export function setBlockedSites(list) { blockedSites = Array.isArray(list) ? list : [] }
async function assertAllowed(tabId) {
  if (!blockedSites.length) return
  const t = await chrome.tabs.get(tabId).catch(() => null)
  if (t && isBlockedHost(t.url, blockedSites)) throw new Error(`Your organization blocks DoTask on ${hostOf(t.url)}.`)
}

export function isControllable(url) {
  return /^https?:\/\//i.test(url || '')
}

/** The tab DoTask works on: the active tab in this side panel's window. */
export async function getTargetTab() {
  if (pinnedTabId) {
    try { return await chrome.tabs.get(pinnedTabId) } catch { pinnedTabId = null }
  }
  let win
  try { win = await chrome.windows.getCurrent() } catch {}
  const [tab] = await chrome.tabs.query({ active: true, ...(win ? { windowId: win.id } : { lastFocusedWindow: true }) })
  if (tab && isControllable(tab.url)) return tab
  const all = await chrome.tabs.query(win ? { windowId: win.id } : {})
  const web = all.filter(t => isControllable(t.url)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
  return web[0] || tab
}

export async function ensureContent(tabId) {
  try {
    const r = await withTimeout(chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 }), PING_MS)
    if (r?.ok) return
  } catch {}
  const busy = 'The page is not responding. Wait for it to finish loading, then try again.'
  try {
    await withTimeout(chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }), INJECT_MS, busy)
  } catch (e) {
    if (e.name === 'TimeoutError') throw e
    await withTimeout(chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }), INJECT_MS, busy)
  }
}

/** Message the page script. frameId 0 is the page itself; other ids are embedded frames. */
export async function send(tabId, msg, frameId = 0, { timeout } = {}) {
  await assertAllowed(tabId)
  await ensureContent(tabId)
  const ms = timeout || SEND_MS[msg?.type] || DEFAULT_SEND_MS
  const r = await withTimeout(chrome.tabs.sendMessage(tabId, msg, { frameId }), ms,
    'The page did not answer in time. It may be busy; try again in a moment.')
  if (r && r.ok === false && r.error) throw new Error(r.error)
  return r
}

// ---------- embedded frames (course players, editors, widgets served by other sites) ----------
function originOf(u) {
  try { const o = new URL(u).origin; return o === 'null' ? '' : o } catch { return '' }
}

async function allFrames(tabId) {
  try { return (await chrome.webNavigation.getAllFrames({ tabId })) || [] } catch { return [] }
}

/** Message one frame; null if it does not answer. Injects the page script once if needed. */
async function frameMsg(tabId, frameId, msg, { timeout = 2500, inject = true } = {}) {
  const attempt = () => Promise.race([
    chrome.tabs.sendMessage(tabId, msg, { frameId }),
    new Promise(r => setTimeout(() => r(null), timeout))
  ])
  try { const r = await attempt(); if (r) return r } catch {}
  if (!inject) return null
  try { await withTimeout(chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content.js'] }), INJECT_MS) } catch { return null }
  try { return await attempt() } catch { return null }
}

/** Pair a parent's unreadable <iframe> boxes with the real frames Chrome reports. */
function pairFrames(boxes, kids) {
  const left = boxes.slice(), pairs = []
  const take = (kid, i) => { pairs.push([kid, left[i]]); left.splice(i, 1) }
  const rest = []
  for (const kid of kids) {
    const i = left.findIndex(b => b.src === kid.url)
    if (i >= 0) take(kid, i); else rest.push(kid)
  }
  const rest2 = []
  for (const kid of rest) {
    const i = left.findIndex(b => originOf(b.src) && originOf(b.src) === originOf(kid.url))
    if (i >= 0) take(kid, i); else rest2.push(kid)
  }
  rest2.forEach((kid) => { if (left.length) take(kid, 0) })
  return pairs
}

/** Child frames of `parentId` that the parent's own script cannot look into. */
function hiddenKids(frames, parentId, parentSnap) {
  const parent = frames.find(f => f.frameId === parentId)
  const po = originOf(parent?.url)
  const srcs = new Set((parentSnap.frames || []).map(b => b.src))
  return frames.filter(f => f.parentFrameId === parentId && /^https?:/i.test(f.url) && (originOf(f.url) !== po || srcs.has(f.url)))
}

/**
 * Page snapshot that also includes elements inside other sites' embedded frames.
 * Their elements get new ids; `idMap[id] = {frameId, localId, ox, oy}` routes actions back.
 */
export async function snapshotAll(tabId, options = {}, { maxFrames = 8, perFrame = 80 } = {}) {
  const top = await send(tabId, { type: 'snapshot', options }, 0)
  top.idMap = {}
  if (!top.frames?.length) return top
  const frames = await allFrames(tabId)
  if (!frames.length) return top
  const [vw, vh] = top.viewport || [innerWidth, innerHeight]
  const queue = [{ frameId: 0, snap: top, ox: 0, oy: 0, depth: 0, inView: true }]
  let nextId = top.elements.reduce((m, e) => Math.max(m, e.id), -1) + 1
  let merged = 0
  while (queue.length && merged < maxFrames) {
    const parent = queue.shift()
    if (!parent.snap.frames?.length || parent.depth >= 3) continue
    for (const [kid, box] of pairFrames(parent.snap.frames, hiddenKids(frames, parent.frameId, parent.snap))) {
      if (merged >= maxFrames) break
      const snap = await frameMsg(tabId, kid.frameId, { type: 'snapshot', options: { maxElements: perFrame, maxText: 1500 } })
      if (!snap || !Array.isArray(snap.elements)) continue
      merged++
      const ox = parent.ox + box.x, oy = parent.oy + box.y
      const inView = parent.inView && oy + box.h > 0 && oy < vh && ox + box.w > 0 && ox < vw
      let site = ''
      try { site = new URL(kid.url).hostname } catch {}
      for (const e of snap.elements) {
        const id = nextId++
        top.idMap[id] = { frameId: kid.frameId, localId: e.id, ox, oy }
        if (top.focusedId < 0 && snap.focusedId === e.id) top.focusedId = id
        top.elements.push({ ...e, id, frame: site, inView: inView && e.inView, box: e.box && [e.box[0] + ox, e.box[1] + oy, e.box[2], e.box[3]] })
      }
      top.totalInteractive += snap.totalInteractive || 0
      if (snap.text) top.text += `\n\n[Embedded frame from ${site}]\n${snap.text}`
      queue.push({ frameId: kid.frameId, snap, ox, oy, depth: parent.depth + 1, inView })
    }
  }
  return top
}

/** Full readable text of the page plus its embedded frames from other sites. */
export async function readAll(tabId, maxChars = 40000) {
  const top = await send(tabId, { type: 'readPage', maxChars }, 0)
  const frames = (await allFrames(tabId)).filter(f => f.frameId !== 0 && /^https?:/i.test(f.url))
  if (!frames.length) return top
  const topOrigin = originOf(frames.find(f => f.frameId === 0)?.url || top.url)
  let room = Math.max(0, maxChars - (top.text || '').length)
  for (const f of frames.slice(0, 8)) {
    if (room < 200) break
    if (originOf(f.url) === topOrigin) continue // same-site frames are already in the page text
    const r = await frameMsg(tabId, f.frameId, { type: 'readPage', maxChars: room }, { inject: false })
    const t = (r?.text || '').trim()
    if (t.length < 20) continue
    let site = ''
    try { site = new URL(f.url).hostname } catch {}
    const block = `\n\n[Embedded frame from ${site}]\n${t}`
    top.text += block
    room -= block.length
  }
  return top
}

/** The frame the user last typed in (edit) or selected text in (selection). */
export async function pickFrame(tabId, by = 'edit') {
  await ensureContent(tabId)
  const frames = (await allFrames(tabId)).filter(f => f.frameId === 0 || /^(https?:|about:)/i.test(f.url)).slice(0, 24)
  if (frames.length <= 1) return 0
  const infos = (await Promise.all(frames.map(async f => ({ frameId: f.frameId, info: await frameMsg(tabId, f.frameId, { type: 'focusInfo' }, { timeout: 1200, inject: false }) }))))
    .filter(x => x.info && x.info.ok !== false)
  let best
  if (by === 'selection') {
    best = infos.filter(x => x.info.selection).sort((a, b) => (b.info.selTs || 0) - (a.info.selTs || 0))[0]
  } else {
    best = infos.filter(x => x.info.editable).sort((a, b) => (b.info.editTs || 0) - (a.info.editTs || 0))[0] ||
      infos.filter(x => x.info.editTs).sort((a, b) => b.info.editTs - a.info.editTs)[0]
  }
  return best ? best.frameId : 0
}

export async function sendToFocusedFrame(tabId, msg, by = 'edit') {
  return send(tabId, msg, await pickFrame(tabId, by))
}

/**
 * Guided course mode: press the page's own Next/Continue control (never Submit/Finish).
 * Looks in the page first, then in embedded course players.
 */
export async function clickNext(tabId) {
  await ensureContent(tabId)
  const r0 = await frameMsg(tabId, 0, { type: 'clickNext' }, { inject: false })
  if (r0?.ok) return { ...r0, frameId: 0 }
  const frames = (await allFrames(tabId)).filter(f => f.frameId !== 0 && /^https?:/i.test(f.url)).slice(0, 12)
  for (const f of frames) {
    const r = await frameMsg(tabId, f.frameId, { type: 'clickNext' }, { timeout: 1500, inject: false })
    if (r?.ok) return { ...r, frameId: f.frameId }
  }
  return { ok: false, error: r0?.error || 'I could not find a Next button on this page.' }
}

/** Click at page coordinates, following the click into other sites' frames when needed. */
export async function clickAt(tabId, x, y) {
  let frameId = 0
  for (let depth = 0; depth < 4; depth++) {
    const r = await send(tabId, { type: 'act', action: { type: 'click_xy', x, y } }, frameId)
    if (!r?.forward) return r
    const kids = (await allFrames(tabId)).filter(f => f.parentFrameId === frameId)
    const kid = kids.find(f => f.url === r.forward.src) ||
      kids.find(f => originOf(f.url) && originOf(f.url) === originOf(r.forward.src)) ||
      (kids.length === 1 ? kids[0] : null)
    if (!kid) throw new Error('That spot is inside an embedded frame DoTask cannot reach')
    frameId = kid.frameId; x = r.forward.x; y = r.forward.y
  }
  throw new Error('Too many nested frames at that spot')
}

export async function waitForLoad(tabId, { timeout = 15000, signal } = {}) {
  const start = Date.now()
  await sleep(150, signal)
  while (Date.now() - start < timeout) {
    const t = await chrome.tabs.get(tabId).catch(() => null)
    if (!t) return
    if (t.status === 'complete') return
    await sleep(200, signal)
  }
}

export function normalizeUrl(input) {
  const s = String(input || '').trim()
  if (!s) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return 'http://' + s
  if (/^[^\s]+\.[a-z]{2,}(\/|:|$)/i.test(s)) return 'https://' + s
  return 'https://www.google.com/search?q=' + encodeURIComponent(s)
}

export async function navigate(tabId, url, signal) {
  await chrome.tabs.update(tabId, { url: normalizeUrl(url) })
  await waitForLoad(tabId, { signal })
}

let lastCapture = 0
/** JPEG screenshot of the visible tab, scaled down to save AI tokens. */
export async function screenshot(tab, { maxWidth = 1280, quality = 0.6 } = {}) {
  if (blockedSites.length && isBlockedHost(tab.url, blockedSites)) throw new Error(`Your organization blocks DoTask on ${hostOf(tab.url)}.`)
  const wait = 550 - (Date.now() - lastCapture) // Chrome allows ~2 captures/second
  if (wait > 0) await sleep(wait)
  lastCapture = Date.now()
  const dataUrl = await withTimeout(chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 }), CAPTURE_MS,
    'The screen picture took too long')
  const blob = await (await fetch(dataUrl)).blob()
  const bmp = await createImageBitmap(blob)
  const scale = Math.min(1, maxWidth / bmp.width)
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  const data = bytesToBase64(new Uint8Array(await out.arrayBuffer()))
  return { data, mimeType: 'image/jpeg', width: w, height: h }
}

// ---------- optional trusted input (chrome.debugger) ----------
const attached = new Set()

export async function hasNativePermission() {
  return chrome.permissions.contains({ permissions: ['debugger'] })
}
export async function requestNativePermission() {
  return chrome.permissions.request({ permissions: ['debugger'] })
}

async function cdp(tabId, method, params) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3')
    attached.add(tabId)
  }
  return chrome.debugger.sendCommand({ tabId }, method, params)
}

export async function detachNative(tabId) {
  if (!attached.has(tabId)) return
  attached.delete(tabId)
  try { await chrome.debugger.detach({ tabId }) } catch {}
}

if (globalThis.chrome?.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener((src) => attached.delete(src.tabId))
}

export async function nativeClick(tabId, x, y) {
  const base = { x, y, button: 'left', clickCount: 1 }
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mousePressed' })
  await cdp(tabId, 'Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' })
}

export async function nativeType(tabId, text) {
  await cdp(tabId, 'Input.insertText', { text })
}

export async function nativeKey(tabId, key) {
  const map = { Enter: [13, '\r'], Tab: [9, ''], Escape: [27, ''], Backspace: [8, ''], ArrowDown: [40, ''], ArrowUp: [38, ''], ArrowLeft: [37, ''], ArrowRight: [39, ''] }
  const [code, text] = map[key] || [0, key.length === 1 ? key : '']
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, windowsVirtualKeyCode: code, text })
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code })
}
