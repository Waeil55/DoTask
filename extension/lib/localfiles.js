// "My Files": secure access to folders on this computer that the user picks
// (File System Access API). DoTask can only see folders you added, Chrome asks you to
// allow access, and every write by the agent needs approval in Review/Ask-if-risky mode.

import { db } from './db.js'
import { textToDocx } from './docx.js'

const SKIP = /^(\.|node_modules$|\$RECYCLE|System Volume Information|AppData$)/i

export function filesSupported() {
  return typeof globalThis.showDirectoryPicker === 'function'
}

export async function getFolders() {
  const row = await db.get('kv', 'folders')
  return row?.v || []
}

async function setFolders(list) { await db.put('kv', { k: 'folders', v: list }) }

/** Ask the user to pick a folder. Must run from a click. */
export async function addFolder() {
  const handle = await showDirectoryPicker({ id: 'dotask', mode: 'readwrite' })
  const list = await getFolders()
  for (const f of list) if (await f.handle.isSameEntry?.(handle)) return f
  let name = handle.name
  let n = 2
  while (list.some(f => f.name === name)) name = `${handle.name} (${n++})`
  const folder = { id: `f-${Date.now()}`, name, handle, addedAt: Date.now() }
  await setFolders([...list, folder])
  return folder
}

export async function removeFolder(id) {
  await setFolders((await getFolders()).filter(f => f.id !== id))
}

export async function permissionState(folder, write = false) {
  try { return await folder.handle.queryPermission({ mode: write ? 'readwrite' : 'read' }) } catch { return 'denied' }
}

/** Request access (needs a recent click). Returns names of folders that are now usable. */
export async function unlockFolders(write = true) {
  const ok = []
  for (const f of await getFolders()) {
    let s = await permissionState(f, write)
    if (s === 'prompt') { try { s = await f.handle.requestPermission({ mode: write ? 'readwrite' : 'read' }) } catch {} }
    if (s === 'granted') ok.push(f.name)
  }
  return ok
}

export async function usableFolders() {
  const out = []
  for (const f of await getFolders()) if (await permissionState(f) === 'granted') out.push(f)
  return out
}

/** Recursive listing. Paths look like "FolderName/sub/file.docx". */
export async function listFiles({ under = '', max = 400, depth = 5 } = {}) {
  const out = []
  const [top, ...rest] = String(under).split('/').filter(Boolean)
  for (const f of await usableFolders()) {
    if (top && f.name !== top) continue
    let dir = f.handle
    try { for (const seg of rest) dir = await dir.getDirectoryHandle(seg) } catch { continue }
    await walk(dir, [f.name, ...rest].join('/'), depth)
  }
  async function walk(dir, prefix, d) {
    for await (const [name, h] of dir.entries()) {
      if (out.length >= max) return
      if (SKIP.test(name)) continue
      const path = `${prefix}/${name}`
      if (h.kind === 'directory') { if (d > 0) await walk(h, path, d - 1) }
      else {
        try { const file = await h.getFile(); out.push({ path, name, size: file.size, modified: file.lastModified }) } catch {}
      }
    }
  }
  return out.sort((a, b) => b.modified - a.modified)
}

async function resolve(path, { create = false } = {}) {
  const segs = String(path).split('/').filter(Boolean)
  if (segs.some(s => s === '..' || s === '.')) throw new Error('Invalid path')
  const folder = (await usableFolders()).find(f => f.name === segs[0])
  if (!folder) throw new Error(`Folder “${segs[0]}” is not connected or not unlocked. Add it in Settings → My files.`)
  let dir = folder.handle
  for (const s of segs.slice(1, -1)) dir = await dir.getDirectoryHandle(s, { create })
  const name = segs[segs.length - 1]
  if (!name || segs.length < 2) throw new Error('Give a file path like Folder/file.docx')
  return { dir, name }
}

export async function readFile(path) {
  const { dir, name } = await resolve(path)
  const file = await (await dir.getFileHandle(name)).getFile()
  return { name: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), size: file.size }
}

/** Write text to a file. .docx paths become real Word documents. Refuses to overwrite unless asked. */
export async function writeFile(path, text, { overwrite = false } = {}) {
  const { dir, name } = await resolve(path, { create: true })
  if (!overwrite) {
    try { await dir.getFileHandle(name); throw new Error(`${name} already exists. Choose a new name (DoTask never overwrites your files without asking).`) } catch (e) { if (!/NotFound/i.test(e.name)) throw e }
  }
  const fh = await dir.getFileHandle(name, { create: true })
  const w = await fh.createWritable()
  const data = /\.docx$/i.test(name) ? textToDocx(text, { title: name.replace(/\.docx$/i, '') }) : new TextEncoder().encode(text)
  await w.write(data)
  await w.close()
  return { path, bytes: data.length }
}

/** Save to the user's Downloads (no folder access needed). */
export function downloadFile(name, text) {
  const data = /\.docx$/i.test(name) ? textToDocx(text, { title: name.replace(/\.docx$/i, '') }) : new TextEncoder().encode(text)
  const type = /\.docx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain'
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
