// Tiny DOM toolkit. Everything is built with text nodes — untrusted text (web pages,
// student work, emails) is never inserted as HTML.
import { platform } from './platform.js'

export function h(tag, props, ...children) {
  const el = document.createElement(tag)
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k === 'dataset') Object.assign(el.dataset, v)
      else if (k in el && typeof v !== 'string') el[k] = v
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v
      else el.setAttribute(k, v === true ? '' : v)
    }
  }
  append(el, children)
  return el
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

export const $ = (sel, root = document) => root.querySelector(sel)
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el }
export function replace(el, ...children) { clear(el); append(el, children); return el }

export function toast(message, kind = 'info', ms = 3800) {
  let host = document.getElementById('toasts')
  if (!host) { host = h('div', { id: 'toasts' }); document.body.append(host) }
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, message)
  host.append(t)
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300) }, ms)
}

/** Modal confirm. Returns true/false. */
export function confirmDialog({ title, body, ok = 'OK', cancel = 'Cancel', danger = false, typeToConfirm }) {
  return new Promise(resolve => {
    const input = typeToConfirm ? h('input', { class: 'input', placeholder: `Type ${typeToConfirm} to confirm` }) : null
    const okBtn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, disabled: !!typeToConfirm }, ok)
    const dlg = h('dialog', { class: 'dialog' },
      h('h3', null, title),
      body ? (body instanceof Node ? body : h('p', { class: 'muted' }, body)) : null,
      input,
      h('div', { class: 'row end gap' },
        h('button', { class: 'btn ghost', onclick: () => done(false) }, cancel), okBtn))
    input?.addEventListener('input', () => { okBtn.disabled = input.value.trim() !== typeToConfirm })
    okBtn.addEventListener('click', () => done(true))
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false) })
    function done(v) { dlg.close(); dlg.remove(); resolve(v) }
    document.body.append(dlg)
    dlg.showModal()
  })
}

export function promptDialog({ title, body, placeholder = '', value = '', ok = 'OK', multiline = false }) {
  return new Promise(resolve => {
    const input = multiline
      ? h('textarea', { class: 'input', rows: 6, placeholder, value })
      : h('input', { class: 'input', placeholder, value })
    const dlg = h('dialog', { class: 'dialog' },
      h('h3', null, title), body ? h('p', { class: 'muted' }, body) : null, input,
      h('div', { class: 'row end gap' },
        h('button', { class: 'btn ghost', onclick: () => done(null) }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => done(input.value) }, ok)))
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null) })
    function done(v) { dlg.close(); dlg.remove(); resolve(v) }
    document.body.append(dlg)
    dlg.showModal()
    input.focus()
  })
}

/** Safe, small markdown renderer (headings, lists, bold, italic, code, links as text). */
export function md(text) {
  const frag = document.createDocumentFragment()
  const lines = String(text || '').replace(/\r/g, '').split('\n')
  let list = null, listType = null, code = null
  const flushList = () => { if (list) { frag.append(list); list = null; listType = null } }
  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) { frag.append(h('pre', null, h('code', null, code.join('\n')))); code = null }
      else code.push(line)
      continue
    }
    if (/^```/.test(line)) { flushList(); code = []; continue }
    const hm = line.match(/^(#{1,4})\s+(.*)/)
    if (hm) { flushList(); frag.append(h(`h${Math.min(6, hm[1].length + 2)}`, null, inline(hm[2]))); continue }
    const ul = line.match(/^\s*[-*•]\s+(.*)/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/)
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol'
      if (listType !== type) { flushList(); list = h(type); listType = type }
      list.append(h('li', null, inline((ul || ol)[1])))
      continue
    }
    flushList()
    if (!line.trim()) continue
    if (/^>\s?/.test(line)) { frag.append(h('blockquote', null, inline(line.replace(/^>\s?/, '')))); continue }
    frag.append(h('p', null, inline(line)))
  }
  if (code) frag.append(h('pre', null, h('code', null, code.join('\n'))))
  flushList()
  return frag
}

function inline(s) {
  const out = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let last = 0, m
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**') || t.startsWith('__')) out.push(h('strong', null, t.slice(2, -2)))
    else if (t.startsWith('`')) out.push(h('code', null, t.slice(1, -1)))
    else if (t.startsWith('[')) {
      const lm = t.match(/\[([^\]]+)\]\(([^)]+)\)/)
      out.push(/^https?:\/\//.test(lm[2]) ? h('a', { href: lm[2], target: '_blank', rel: 'noopener' }, lm[1]) : lm[1])
    } else out.push(h('em', null, t.slice(1, -1)))
    last = m.index + t.length
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text)
  toast('Copied', 'ok', 1500)
}

export function avatar(name, color, size = 34) {
  const initials = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'
  return h('span', { class: 'avatar', style: { background: color, width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px' } }, initials)
}

export function select(options, value, onchange, attrs = {}) {
  return h('select', { class: 'input', onchange: (e) => onchange(e.target.value), ...attrs },
    options.map(o => {
      const [v, label] = Array.isArray(o) ? o : [o, o]
      return h('option', { value: v, selected: String(v) === String(value) }, label)
    }))
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null)
}

export function spinner() { return h('span', { class: 'spinner', 'aria-label': 'Working' }) }

export function empty(icon, title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon' }, icon), h('h3', null, title), text ? h('p', { class: 'muted' }, text) : null,
    actions.length ? h('div', { class: 'row center gap wrap' }, actions) : null)
}

/** Auto-grow textarea + Enter to submit (Shift+Enter = newline). */
export function composer({ placeholder, onSubmit, mic = true, extra = [] }) {
  const ta = h('textarea', { class: 'composer-input', rows: 1, placeholder })
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px' }
  ta.addEventListener('input', grow)
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() }
  })
  const send = h('button', { class: 'icon-btn primary', title: 'Send (Enter)', onclick: () => submit() }, '➤')
  const micBtn = mic ? h('button', { class: 'icon-btn', title: 'Dictate', onclick: () => dictate() }, '🎙') : null
  function submit() {
    const v = ta.value.trim()
    if (!v) return
    ta.value = ''; grow()
    onSubmit(v)
  }
  let rec = null
  function dictate() {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
    if (!SR) return toast('Dictation is not available in this browser', 'warn')
    if (rec) { rec.stop(); return }
    rec = new SR()
    rec.interimResults = true
    const base = ta.value
    micBtn.classList.add('live')
    rec.onresult = (ev) => { ta.value = base + Array.from(ev.results).map(r => r[0].transcript).join(''); grow() }
    rec.onerror = (e) => { if (e.error === 'not-allowed') openMicPermission() }
    rec.onend = () => { micBtn.classList.remove('live'); rec = null }
    rec.start()
  }
  const el = h('div', { class: 'composer' }, ta, ...extra, micBtn, send)
  return { el, ta, setValue: (v) => { ta.value = v; grow(); ta.focus() }, focus: () => ta.focus() }
}

export function openMicPermission() {
  if (platform.phone) return platform.openPermissionPage()
  platform.openPermissionPage()
  toast('Allow the microphone in the tab that opened, then come back.', 'info', 6000)
}
