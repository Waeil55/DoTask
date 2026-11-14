// Dependency-free document reading: ZIP (docx/pptx/xlsx), naive PDF text, plain text.
// Works in Chrome extension pages and in Node 18+ (DecompressionStream is built in).

import { bytesToBase64, htmlToText } from './util.js'

async function inflate(bytes, format) {
  const ds = new DecompressionStream(format)
  const stream = new Blob([bytes]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const dec = new TextDecoder('utf-8')

/** Minimal ZIP reader. Returns Map<name, () => Promise<Uint8Array>>. */
export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('Not a ZIP file')
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break
    const method = view.getUint16(p + 10, true)
    const csize = view.getUint32(p + 20, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const localOff = view.getUint32(p + 42, true)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    entries.set(name, async () => {
      const lNameLen = view.getUint16(localOff + 26, true)
      const lExtraLen = view.getUint16(localOff + 28, true)
      const start = localOff + 30 + lNameLen + lExtraLen
      const data = bytes.subarray(start, start + csize)
      if (method === 0) return data
      if (method === 8) return inflate(data, 'deflate-raw')
      throw new Error(`Unsupported ZIP compression method ${method}`)
    })
  }
  return entries
}

function xmlText(xml, paraTag, textTag) {
  const re = new RegExp(`<${textTag}(?:\\s[^>]*)?>([^<]*)</${textTag}>|<[wa]:tab\\s*/>|<[wa]:br\\s*/>`, 'g')
  return xml.split(`</${paraTag}>`).map(p => {
    let s = ''
    for (const m of p.matchAll(re)) s += m[1] !== undefined ? m[1] : (m[0].includes('tab') ? '\t' : '\n')
    return s
  }).join('\n')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function docxText(zip) {
  const parts = []
  for (const name of ['word/document.xml', 'word/footnotes.xml', 'word/comments.xml']) {
    if (zip.has(name)) parts.push(xmlText(dec.decode(await zip.get(name)()), 'w:p', 'w:t'))
  }
  return parts.filter(Boolean).join('\n\n')
}

async function pptxText(zip) {
  const slides = [...zip.keys()]
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]))
  const out = []
  for (const [i, name] of slides.entries()) {
    const text = xmlText(dec.decode(await zip.get(name)()), 'a:p', 'a:t')
    const notesName = `ppt/notesSlides/notesSlide${name.match(/(\d+)\.xml/)[1]}.xml`
    const notes = zip.has(notesName) ? xmlText(dec.decode(await zip.get(notesName)()), 'a:p', 'a:t') : ''
    out.push(`--- Slide ${i + 1} ---\n${text}${notes ? `\n[Speaker notes] ${notes}` : ''}`)
  }
  return out.join('\n\n')
}

async function xlsxText(zip) {
  if (!zip.has('xl/sharedStrings.xml')) return ''
  const xml = dec.decode(await zip.get('xl/sharedStrings.xml')())
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => m[1].replace(/<[^>]+>/g, '')).join('\n')
}

function pdfStringToText(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => {
    const map = { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' }
    return map[e] ?? String.fromCharCode(parseInt(e, 8))
  })
}

/** Best-effort PDF text (works for most text PDFs; scanned or CID-font PDFs need Gemini's native PDF reading). */
export async function pdfText(bytes) {
  const latin = new TextDecoder('latin1').decode(bytes)
  const chunks = []
  const re = /<<([^]*?)>>\s*stream\r?\n/g
  let m
  while ((m = re.exec(latin))) {
    const dataStart = m.index + m[0].length
    const end = latin.indexOf('endstream', dataStart)
    if (end < 0) break
    const dict = m[1]
    if (/\/Subtype\s*\/Image|\/Type\s*\/XObject/.test(dict)) { re.lastIndex = end; continue }
    const len = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/)
    let stop = len ? Math.min(end, dataStart + Number(len[1])) : end
    while (stop > dataStart && (bytes[stop - 1] === 0x0a || bytes[stop - 1] === 0x0d)) stop-- // EOL before endstream
    let data = bytes.subarray(dataStart, stop)
    try {
      if (/\/FlateDecode/.test(dict)) data = await inflate(data, 'deflate')
      else if (/\/Filter/.test(dict)) { re.lastIndex = end; continue }
    } catch { re.lastIndex = end; continue }
    const content = new TextDecoder('latin1').decode(data)
    if (!/\bBT\b/.test(content)) { re.lastIndex = end; continue }
    let line = ''
    const ops = /\((?:\\.|[^\\)])*\)|\[(?:\\.|[^\]])*\]\s*TJ|T\*|Td|TD|Tm|ET|'|"/g
    let o
    while ((o = ops.exec(content))) {
      const tok = o[0]
      if (tok.startsWith('(')) line += pdfStringToText(tok.slice(1, -1))
      else if (tok.startsWith('[')) {
        for (const part of tok.matchAll(/\((?:\\.|[^\\)])*\)|(-?\d+(?:\.\d+)?)/g)) {
          if (part[0].startsWith('(')) line += pdfStringToText(part[0].slice(1, -1))
          else if (Number(part[1]) < -200) line += ' '
        }
      } else if (tok === 'ET' || tok === 'T*' || tok === 'Td' || tok === 'TD' || tok === "'" || tok === '"') {
        if (line.trim()) chunks.push(line); line = ''
      }
    }
    if (line.trim()) chunks.push(line)
    re.lastIndex = end
  }
  const text = chunks.join('\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  const printable = text.replace(/[^\x20-\x7e\n -ɏ]/g, '').length
  return printable > text.length * 0.85 ? text : ''
}

export function guessMime(name = '', fallback = 'application/octet-stream') {
  const ext = String(name).toLowerCase().split('.').pop()
  return ({
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html', htm: 'text/html',
    json: 'application/json', rtf: 'application/rtf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
  })[ext] || fallback
}

const INLINE_LIMIT = 18 * 1024 * 1024

/**
 * Turn a file into AI-ready parts.
 * @returns {Promise<{ text?: string, inline?: {mimeType: string, data: string}, note?: string }>}
 */
export async function fileToAiPart({ name, mimeType, bytes }, { nativeMedia = true } = {}) {
  const mime = mimeType && mimeType !== 'application/octet-stream' ? mimeType : guessMime(name)
  const label = name || 'file'
  if (/^text\/|json|csv|markdown/.test(mime)) {
    const raw = dec.decode(bytes)
    return { text: /html/.test(mime) ? htmlToText(raw) : raw }
  }
  if (/wordprocessingml|presentationml|spreadsheetml/.test(mime) || /\.(docx|pptx|xlsx)$/i.test(label)) {
    const zip = readZip(bytes)
    const text = /presentationml|\.pptx$/i.test(mime + label) ? await pptxText(zip)
      : /spreadsheetml|\.xlsx$/i.test(mime + label) ? await xlsxText(zip) : await docxText(zip)
    return { text: text || '(document had no readable text)' }
  }
  if (mime === 'application/pdf') {
    if (nativeMedia && bytes.length <= INLINE_LIMIT) return { inline: { mimeType: mime, data: bytesToBase64(bytes) } }
    const text = await pdfText(bytes)
    return text ? { text } : { note: `Could not read text from ${label} (scanned PDF?). Use Gemini to read PDFs natively.` }
  }
  if (/^(image|audio|video)\//.test(mime)) {
    if (!nativeMedia) return { note: `${label} is ${mime}; this AI provider cannot read media files.` }
    if (bytes.length > INLINE_LIMIT) return { note: `${label} is too large to send (${Math.round(bytes.length / 1048576)} MB).` }
    return { inline: { mimeType: mime, data: bytesToBase64(bytes) } }
  }
  if (mime === 'application/msword' || /\.doc$/i.test(label)) {
    return { note: `${label} is an old .doc file. Ask the student to resubmit as .docx or PDF.` }
  }
  return { note: `${label} (${mime}) cannot be read by DoTask.` }
}
