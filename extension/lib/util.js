// Pure helpers shared by the side panel and tests. No chrome.* access here.

export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError())
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()) }, { once: true })
})

export function abortError() {
  const e = new Error('Stopped')
  e.name = 'AbortError'
  return e
}

export const isAbort = (e) => e?.name === 'AbortError'

/** Settle with `promise`, or reject with a TimeoutError once `ms` pass. A stalled tab or network never hangs DoTask. */
export function withTimeout(promise, ms, message = 'This took too long') {
  let timer
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { name: 'TimeoutError' })), ms)
  })
  return Promise.race([Promise.resolve(promise), late]).finally(() => clearTimeout(timer))
}

/** Extract the first JSON object/array from a model reply (tolerates code fences and chatter). */
export function parseJsonLoose(text) {
  if (text == null) throw new Error('Empty AI reply')
  if (typeof text === 'object') return text
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  try { return JSON.parse(s) } catch {}
  const start = s.search(/[[{]/)
  if (start < 0) throw new Error('AI reply contained no JSON')
  const open = s[start], close = open === '{' ? '}' : ']'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) return JSON.parse(s.slice(start, i + 1))
  }
  throw new Error('AI reply had unterminated JSON')
}

/** Convert HTML to readable plain text without executing anything. */
export function htmlToText(html) {
  if (!html) return ''
  return String(html)
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Plain text -> safe minimal HTML paragraphs (for Canvas messages that accept HTML). */
export function textToHtml(text) {
  const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}

/** Parse an RFC 5988 Link header into { rel: url }. */
export function parseLinkHeader(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/)
    if (m) out[m[2].trim()] = m[1]
  }
  return out
}

export function truncate(s, n) {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n) + `… [${s.length - n} more chars]` : s
}

// ---- keeping a person's name out of AI requests ----
// The AI writes NAME_TOKEN where the name goes and the device fills it in, so the name itself
// never has to be sent. hideName() swaps the name back to the token in text that mentions it.
export const NAME_TOKEN = '{{NAME}}'
// "[Student Name]", "[student's first name]", "[Recipient Name]": always the person written to
const NAMED_PLACEHOLDER = /\[(?:the\s+)?(?:student|recipient|pupil)(?:'s)?\s+(?:first\s+|full\s+)?name\]/gi
// a bare "[Name]" only after a greeting: elsewhere (a sign-off) it may mean the sender
const GREETING_PLACEHOLDER = /\b(hi|hello|hey|dear|good\s+(?:morning|afternoon|evening))(,?\s+)\[(?:first\s+|full\s+)?name\]/gi
// first names that are also everyday words: only their capitalised form counts as the name
const NAME_WORDS = new Set(('will may june april august grace hope joy faith rose mark bill pat sue art rob jack frank ' +
  'amber ivy lily sky summer autumn dawn eve gene glen guy jean ray rich sandy max chase hunter page reed wade drew dean ' +
  'don penny ruby crystal ginger holly iris jade pearl violet brook cliff dale lane miles nick pierce rusty stone storm ' +
  'angel star sunny bud cash colt duke king prince bob carol destiny harmony honor justice liberty mercy patience ' +
  'river ocean rain bay sage hazel heather daisy blossom honey melody precious unique royal major').split(' '))
// words the app itself writes around names ("Student (date): …"), and Canvas's "Test Student"
const NOT_NAMES = new Set(['student', 'test', 'anonymous', 'me', 'you'])
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Puts `name` where text has NAME_TOKEN or a "[Student Name]"-style placeholder. */
export function fillName(text, name) {
  if (!name) return text
  return String(text).split(NAME_TOKEN).join(name)
    .replace(NAMED_PLACEHOLDER, name)
    .replace(GREETING_PLACEHOLDER, (m, hi, gap) => hi + gap + name)
}

/** Replaces each given name (the whole name and every part of it) with NAME_TOKEN. */
export function hideName(text, ...names) {
  let out = String(text ?? '')
  const all = new Set()
  for (const raw of names) {
    const full = String(raw ?? '').replace(/\s+/g, ' ').trim()
    if (!full) continue
    all.add(full)
    for (const p of full.split(/[\s,]+|-(?=\p{L})/u)) {
      if (p.replace(/[^\p{L}]/gu, '').length >= 2 && !NOT_NAMES.has(p.toLowerCase())) all.add(p)
    }
  }
  if (!out || !all.size) return out
  for (const n of [...all].sort((a, b) => b.length - a.length)) {
    const flags = NAME_WORDS.has(n.toLowerCase()) ? 'gu' : 'giu'
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escRe(n)}(?![\\p{L}\\p{N}_])`, flags), NAME_TOKEN)
  }
  return out
}

/** Short text for the screen: cut at a word boundary with "…". (truncate() is for AI prompts.) */
export function shorten(s, n) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (s.length <= n) return s
  const cut = s.slice(0, n)
  const space = cut.lastIndexOf(' ')
  return (space > n * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?–—-]+$/, '') + '…'
}

export function fnv1a(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export function randomToken(len = 8) {
  const a = new Uint8Array(len)
  crypto.getRandomValues(a)
  return Array.from(a, b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')
}

export function bytesToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export function base64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const RISKY_WORDS = /\b(submit|send|post|publish|delete|remove|trash|pay|purchase|buy|order|checkout|check out|confirm|transfer|withdraw|sign up|register|enroll|unenroll|drop|grade|save and submit|reply all|archive|unsubscribe|accept|agree|approve|deactivate|cancel (?:subscription|account|order))\b/i
const SENSITIVE_FIELD = /pass(word|code)?|pwd|otp|one.?time|2fa|mfa|cvv|cvc|card.?(number|no)|cc-?num|security.?code|ssn|social.?security|routing|iban|account.?number|pin\b/i

/** Decide whether an agent action needs user approval in "smart" mode. */
export function assessRisk(action, element) {
  if (!action) return { risky: false }
  if (action.type === 'navigate' || action.type === 'scroll' || action.type === 'wait' ||
      action.type === 'read' || action.type === 'done' || action.type === 'ask_user' || action.type === 'back') {
    return { risky: false }
  }
  if (action.type === 'write_file') return { risky: true, reason: `Creates a new file on your computer: ${action.path || ''}` }
  if (action.type === 'list_files' || action.type === 'read_file') return { risky: false }
  const label = [element?.label, element?.text, element?.name, element?.type, element?.href].filter(Boolean).join(' ')
  if (action.type === 'type' && element && (element.type === 'password' || SENSITIVE_FIELD.test(label))) {
    return { risky: true, blocked: true, reason: 'This looks like a password, payment or ID field. DoTask never types those — please fill it yourself.' }
  }
  const isSearch = !!element && (element.type === 'search' || element.role === 'searchbox' ||
    element.role === 'combobox' || /search|find|filter/i.test(label))
  if (action.type === 'type' && action.submit && !isSearch) return { risky: true, reason: 'Types and submits the form.' }
  if (action.type === 'press' && /^enter$/i.test(action.key || '') && !isSearch) {
    return { risky: true, reason: 'Pressing Enter may submit a form or send a message.' }
  }
  if ((action.type === 'click' || action.type === 'click_xy') && RISKY_WORDS.test(label)) {
    return { risky: true, reason: `Clicks “${(element?.label || element?.text || '').slice(0, 60)}”, which may send, submit, pay or delete something.` }
  }
  if (element?.type === 'submit' && action.type === 'click') return { risky: true, reason: 'Clicks a submit button.' }
  if (action.risky) return { risky: true, reason: action.risk_reason || 'The AI flagged this step as having consequences.' }
  return { risky: false }
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

export function isBlockedHost(url, blockedSites = []) {
  const h = hostOf(url)
  return blockedSites.some(b => {
    const s = String(b).toLowerCase().trim().replace(/^\*\./, '')
    return s && (h === s || h.endsWith('.' + s))
  })
}

/** Stable pastel color for a student id — a visual anti-mix-up cue. */
export function colorFor(id) {
  const h = parseInt(fnv1a(String(id)).slice(0, 6), 16) % 360
  return `hsl(${h} 70% 42%)`
}

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
}

export function fmtDate(d) {
  if (!d) return ''
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function clampScore(score, possible) {
  const n = Number(score)
  if (!Number.isFinite(n)) return null
  const max = Number(possible)
  const lo = Math.max(0, n)
  return Number.isFinite(max) && max > 0 ? Math.min(lo, max) : lo
}
