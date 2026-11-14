// DoTask page controller. Runs in every http(s) page (isolated world).
// It only acts when the DoTask side panel asks, and shows a visible badge while working.
(() => {
  if (window.__dotaskContent) return
  window.__dotaskContent = true

  const INTERACTIVE = [
    'a[href]', 'button', 'input:not([type=hidden])', 'select', 'textarea', 'summary', 'details',
    '[role=button]', '[role=link]', '[role=checkbox]', '[role=radio]', '[role=tab]', '[role=menuitem]',
    '[role=menuitemcheckbox]', '[role=menuitemradio]', '[role=option]', '[role=switch]', '[role=combobox]',
    '[role=textbox]', '[role=searchbox]', '[role=slider]', '[role=spinbutton]', '[role=treeitem]', '[role=gridcell]',
    '[contenteditable=""]', '[contenteditable=true]', '[onclick]', '[tabindex]:not([tabindex="-1"])'
  ].join(',')
  const POINTER_TAGS = new Set(['DIV', 'SPAN', 'LI', 'IMG', 'svg', 'I', 'P', 'TD', 'TR', 'LABEL', 'SECTION', 'ARTICLE'])

  let elements = [] // id -> element (index)
  let lastEditable = null
  let lastEditTs = 0
  let lastSelection = ''
  let lastSelTs = 0
  const IS_TOP = window === window.top

  document.addEventListener('focusin', (e) => {
    const t = deepActive(e.target)
    if (isEditable(t)) { lastEditable = t; lastEditTs = Date.now() }
  }, true)
  document.addEventListener('selectionchange', () => {
    const s = String(window.getSelection() || '').trim()
    if (s) { lastSelection = s; lastSelTs = Date.now() }
  })

  /** Focused element, looking inside shadow roots and same-origin iframes (rich-text editors). */
  function deepActive(el) {
    for (let i = 0; i < 10 && el; i++) {
      if (el.shadowRoot && el.shadowRoot.activeElement) { el = el.shadowRoot.activeElement; continue }
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        let inner = null
        try { inner = el.contentDocument && el.contentDocument.activeElement } catch {}
        if (inner) { el = inner; continue }
      }
      break
    }
    return el
  }
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false
    if (el.isContentEditable) return true
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly
    if (el.tagName === 'INPUT') return !el.disabled && !el.readOnly && /^(text|search|email|url|tel|number|)$/i.test(el.type || '')
    return false
  }
  const clean = (s, n = 100) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

  function isVisible(el, rect) {
    if (rect.width < 1 || rect.height < 1) return false
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) return false
    return true
  }

  function labelOf(el) {
    const aria = el.getAttribute('aria-label')
    if (aria) return clean(aria)
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = by.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.innerText || '').join(' ')
      if (clean(t)) return clean(t)
    }
    if (el.id && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      try {
        const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (l && clean(l.innerText)) return clean(l.innerText)
      } catch {}
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const wrap = el.closest('label')
      if (wrap && clean(wrap.innerText)) return clean(wrap.innerText)
    }
    const txt = el.tagName === 'INPUT' ? '' : clean(el.innerText || el.textContent)
    if (txt) return txt
    const img = el.querySelector?.('img[alt]')
    return clean(el.getAttribute('title') || el.getAttribute('alt') || img?.alt || el.getAttribute('placeholder') ||
      el.getAttribute('name') || (el.tagName === 'INPUT' && /button|submit|reset/.test(el.type) ? el.value : '') ||
      el.getAttribute('data-tooltip') || '')
  }

  function roleOf(el) {
    const r = el.getAttribute('role')
    if (r) return r
    const t = el.tagName
    if (t === 'A') return 'link'
    if (t === 'BUTTON' || t === 'SUMMARY') return 'button'
    if (t === 'SELECT') return 'select'
    if (t === 'TEXTAREA') return 'textbox'
    if (t === 'INPUT') {
      const ty = (el.type || 'text').toLowerCase()
      if (/checkbox|radio/.test(ty)) return ty
      if (/button|submit|reset|image/.test(ty)) return 'button'
      return ty === 'search' ? 'searchbox' : 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return 'clickable'
  }

  /** Walk document, open shadow roots and same-origin iframes. */
  function collect(root, ox, oy, vw, vh, out, pointerBudget) {
    let nodes
    try { nodes = root.querySelectorAll('*') } catch { return }
    const interactive = new Set()
    try { root.querySelectorAll(INTERACTIVE).forEach(n => interactive.add(n)) } catch {}
    for (const el of nodes) {
      if (el.hasAttribute('data-dotask-ui')) continue
      if (el.shadowRoot) collect(el.shadowRoot, ox, oy, vw, vh, out, pointerBudget)
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
        try {
          const doc = el.contentDocument
          if (doc) {
            const r = el.getBoundingClientRect()
            collect(doc, ox + r.left, oy + r.top, vw, vh, out, pointerBudget)
          }
        } catch {}
        continue
      }
      let isInteractive = interactive.has(el)
      if (!isInteractive && POINTER_TAGS.has(el.tagName) && pointerBudget.n-- > 0) {
        const st = getComputedStyle(el)
        if (st.cursor === 'pointer' && el.parentElement && getComputedStyle(el.parentElement).cursor !== 'pointer') isInteractive = true
      }
      if (!isInteractive) continue
      if (el.disabled && el.tagName !== 'INPUT') continue
      const rect = el.getBoundingClientRect()
      if (!isVisible(el, rect)) continue
      const x = rect.left + ox, y = rect.top + oy
      out.push({ el, x, y, w: rect.width, h: rect.height, inView: y + rect.height > 0 && y < vh && x + rect.width > 0 && x < vw })
    }
  }

  function describe(item, id) {
    const el = item.el
    const d = { id, tag: el.tagName.toLowerCase(), role: roleOf(el), label: labelOf(el) }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      d.type = (el.type || 'text').toLowerCase()
      if (d.type === 'password') d.value = el.value ? '••••' : ''
      else if (/checkbox|radio/.test(d.type)) d.checked = el.checked
      else d.value = clean(el.value, 120)
      if (el.placeholder) d.placeholder = clean(el.placeholder, 60)
      if (el.name) d.name = clean(el.name, 40)
      if (el.required) d.required = true
    } else if (el.tagName === 'SELECT') {
      d.value = clean(el.options[el.selectedIndex]?.text, 60)
      d.options = Array.from(el.options).slice(0, 20).map(o => clean(o.text, 40))
    } else if (el.isContentEditable) {
      d.value = clean(el.innerText, 120)
    }
    const ac = el.getAttribute('aria-checked'); if (ac) d.checked = ac === 'true'
    const ae = el.getAttribute('aria-expanded'); if (ae) d.expanded = ae === 'true'
    const as = el.getAttribute('aria-selected'); if (as === 'true') d.selected = true
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') d.disabled = true
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || ''
      if (href && !href.startsWith('javascript:')) d.href = href.length > 80 ? href.slice(0, 80) + '…' : href
      if (el.target === '_blank') d.newTab = true
    }
    d.inView = item.inView
    d.box = [Math.round(item.x), Math.round(item.y), Math.round(item.w), Math.round(item.h)]
    return d
  }

  function visibleText(maxChars) {
    const vh = innerHeight
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
    const parts = []
    let total = 0
    const cache = new Map()
    let node
    while ((node = walker.nextNode()) && total < maxChars) {
      const t = node.nodeValue.replace(/\s+/g, ' ').trim()
      if (!t) continue
      const p = node.parentElement
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName) || p.closest('[data-dotask-ui]')) continue
      let ok = cache.get(p)
      if (ok === undefined) {
        const r = p.getBoundingClientRect()
        ok = r.width > 0 && r.height > 0 && r.bottom > -vh * 0.25 && r.top < vh * 1.25 && getComputedStyle(p).visibility !== 'hidden'
        cache.set(p, ok)
      }
      if (!ok) continue
      parts.push(t)
      total += t.length + 1
    }
    return parts.join(' ').slice(0, maxChars)
  }

  function scrollInfo() {
    const se = document.scrollingElement || document.documentElement
    let target = se
    if (se.scrollHeight <= se.clientHeight + 4) {
      const inner = findScrollable()
      if (inner) target = inner
    }
    return {
      y: Math.round(target === se ? scrollY : target.scrollTop),
      max: Math.round(target.scrollHeight - target.clientHeight),
      viewport: innerHeight,
      container: target === se ? 'page' : 'inner'
    }
  }

  function findScrollable() {
    let best = null, bestArea = 0
    for (const el of document.querySelectorAll('div,main,section,article,ul')) {
      if (el.scrollHeight <= el.clientHeight + 20) continue
      const st = getComputedStyle(el)
      if (!/(auto|scroll)/.test(st.overflowY)) continue
      const r = el.getBoundingClientRect()
      const area = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * r.width
      if (area > bestArea) { best = el; bestArea = area }
    }
    return best
  }

  function snapshot({ maxElements = 220, maxText = 6000 } = {}) {
    const items = []
    collect(document, 0, 0, innerWidth, innerHeight, items, { n: 3000 })
    // in-view first, then nearest below/above
    items.sort((a, b) => (b.inView - a.inView) || (Math.abs(a.y) - Math.abs(b.y)))
    const chosen = items.slice(0, maxElements)
    chosen.sort((a, b) => (a.y - b.y) || (a.x - b.x))
    elements = chosen.map(i => i.el)
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 25).map(h => clean(h.innerText, 80)).filter(Boolean)
    const active = deepActive(document.activeElement)
    // iframes this script cannot look into (other sites): their position lets the panel merge them
    const frames = []
    for (const f of document.querySelectorAll('iframe,frame')) {
      let readable = false
      try { readable = !!f.contentDocument } catch {}
      if (readable) continue
      const r = f.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      frames.push({ src: f.src, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
    }
    return {
      frames,
      url: location.href,
      title: document.title,
      elements: chosen.map((it, i) => describe(it, i)),
      totalInteractive: items.length,
      text: visibleText(maxText),
      headings,
      scroll: scrollInfo(),
      focusedId: elements.indexOf(active),
      dpr: devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      readyState: document.readyState
    }
  }

  // ---------- visible feedback ----------
  let ui = null
  function ensureUi() {
    if (ui) return ui
    const host = document.createElement('div')
    host.setAttribute('data-dotask-ui', '')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>
      .hl{position:fixed;border:2px solid #6d5dfc;border-radius:6px;box-shadow:0 0 0 4px rgba(109,93,252,.25);transition:all .15s ease;display:none}
      .pill{position:fixed;right:16px;bottom:16px;display:none;align-items:center;gap:10px;pointer-events:auto;
        font:600 13px/1.2 system-ui,sans-serif;color:#fff;background:#1f1b3a;padding:9px 10px 9px 14px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25)}
      .dot{width:8px;height:8px;border-radius:50%;background:#34d399;animation:p 1s infinite alternate}
      @keyframes p{to{opacity:.3}}
      button{all:unset;cursor:pointer;background:#ef4444;color:#fff;padding:5px 11px;border-radius:999px;font-weight:700}
    </style><div class="hl"></div><div class="pill"><span class="dot"></span><span class="msg">DoTask is working</span><button>Stop</button></div>`
    root.querySelector('button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'agent.stop' }).catch(() => {}))
    document.documentElement.appendChild(host)
    ui = { host, hl: root.querySelector('.hl'), pill: root.querySelector('.pill'), msg: root.querySelector('.msg') }
    return ui
  }
  /** Element rect relative to the top window (adds same-origin iframe offsets). */
  function topRect(el) {
    const r = el.getBoundingClientRect()
    let left = r.left, top = r.top
    let win = el.ownerDocument.defaultView
    while (win && win !== window && win.frameElement) {
      const fr = win.frameElement.getBoundingClientRect()
      left += fr.left; top += fr.top
      win = win.parent
    }
    return { left, top, width: r.width, height: r.height }
  }
  function highlight(el) {
    const u = ensureUi()
    const r = topRect(el)
    Object.assign(u.hl.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 6 + 'px', height: r.height + 6 + 'px' })
    clearTimeout(highlight.t)
    highlight.t = setTimeout(() => { u.hl.style.display = 'none' }, 900)
  }

  // ---------- actions ----------
  function getEl(id) {
    const el = elements[id]
    if (!el || !el.isConnected) throw new Error(`Element #${id} is no longer on the page`)
    return el
  }
  function center(el) {
    const r = el.getBoundingClientRect()
    return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
  }
  /** `at` = {clientX, clientY} in el's own document; without it, the element's centre. */
  function fireClick(el, at = null) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: el.ownerDocument.defaultView, ...(at || center(el)), button: 0 }
    const W = el.ownerDocument.defaultView
    el.dispatchEvent(new W.PointerEvent('pointerover', opts))
    el.dispatchEvent(new W.MouseEvent('mouseover', opts))
    el.dispatchEvent(new W.PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true }))
    el.dispatchEvent(new W.MouseEvent('mousedown', opts))
    if (typeof el.focus === 'function') el.focus({ preventScroll: true })
    el.dispatchEvent(new W.PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true }))
    el.dispatchEvent(new W.MouseEvent('mouseup', opts))
    // el.click() would report position (0, 0); a point click must carry its coordinates. Labels
    // are the exception: Chrome ignores a positioned click on a label while text is selected,
    // and a label does not need the exact spot anyway
    if (at && !el.closest?.('label')) el.dispatchEvent(new W.MouseEvent('click', { ...opts, detail: 1 }))
    else el.click()
  }
  function setNativeValue(el, value) {
    const W = el.ownerDocument.defaultView || window
    const proto = el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? W.HTMLSelectElement.prototype : W.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, value)
    else el.value = value
  }
  function typeInto(el, text, clear = true) {
    el.focus()
    if (el.isContentEditable) {
      const sel = el.ownerDocument.getSelection()
      const range = el.ownerDocument.createRange()
      range.selectNodeContents(el)
      if (!clear) range.collapse(false)
      sel.removeAllRanges(); sel.addRange(range)
      if (!el.ownerDocument.execCommand('insertText', false, text)) {
        if (clear) el.textContent = ''
        el.append(text)
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      }
      return
    }
    setNativeValue(el, clear ? text : (el.value || '') + text)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function pressKey(el, key) {
    const target = el || deepActive(document.activeElement) || document.body
    const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Space: 32, ' ': 32 }
    const k = key === 'Space' ? ' ' : key
    const init = { key: k, code: key === ' ' ? 'Space' : key, keyCode: codes[key] || 0, which: codes[key] || 0, bubbles: true, cancelable: true, composed: true }
    const notCancelled = target.dispatchEvent(new KeyboardEvent('keydown', init))
    target.dispatchEvent(new KeyboardEvent('keypress', init))
    target.dispatchEvent(new KeyboardEvent('keyup', init))
    if (key === 'Enter' && notCancelled && target.form && target.tagName === 'INPUT') {
      try { target.form.requestSubmit() } catch { target.form.submit() }
    }
  }
  function scrollPage({ direction = 'down', amount = 'page', id }) {
    if (id != null) { getEl(id).scrollIntoView({ block: 'center', behavior: 'instant' }); return scrollInfo() }
    const se = document.scrollingElement || document.documentElement
    let target = se.scrollHeight > se.clientHeight + 4 ? null : findScrollable()
    const h = (target ? target.clientHeight : innerHeight) * (amount === 'half' ? 0.5 : 0.85)
    const before = target ? target.scrollTop : scrollY
    const top = direction === 'top' ? -1e9 : direction === 'bottom' ? 1e9 : direction === 'up' ? -h : h
    const abs = direction === 'top' || direction === 'bottom'
    if (target) abs ? target.scrollTo({ top: top < 0 ? 0 : target.scrollHeight, behavior: 'instant' }) : target.scrollBy({ top, behavior: 'instant' })
    else abs ? scrollTo({ top: top < 0 ? 0 : se.scrollHeight, behavior: 'instant' }) : scrollBy({ top, behavior: 'instant' })
    const after = target ? target.scrollTop : scrollY
    return { ...scrollInfo(), moved: Math.round(after - before) }
  }
  function elementAtPoint(x, y) { return pointIn(x, y).el }
  /** The element at a viewport point, looking into same-origin frames and shadow roots;
   *  x/y come back in that element's own document. */
  function pointIn(x, y) {
    let doc = document, el = doc.elementFromPoint(x, y)
    let ox = 0, oy = 0
    while (el && (el.tagName === 'IFRAME' || el.tagName === 'FRAME')) {
      try {
        const inner = el.contentDocument // null for another site's frame
        if (!inner) break
        const b = frameContentBox(el)
        ox += b.left; oy += b.top
        doc = inner
        el = doc.elementFromPoint(x - ox, y - oy)
      } catch { break }
    }
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x - ox, y - oy)
      if (!inner || inner === el) break
      el = inner
    }
    // nested: el sits in a same-origin frame of this page, not in this page itself
    return { el, x: x - ox, y: y - oy, nested: doc !== document }
  }
  /** Where a frame's page starts in its parent's viewport: inside its border and padding. */
  function frameContentBox(frame) {
    const r = frame.getBoundingClientRect()
    const cs = frame.ownerDocument.defaultView.getComputedStyle(frame)
    return { left: r.left + frame.clientLeft + (parseFloat(cs.paddingLeft) || 0), top: r.top + frame.clientTop + (parseFloat(cs.paddingTop) || 0) }
  }

  async function act(a) {
    const before = location.href
    let el = a.id != null && a.id !== -1 ? getEl(a.id) : null
    if (!el && ['click', 'type', 'select', 'check', 'hover', 'focus'].includes(a.type)) {
      throw new Error(`The ${a.type} action needs an element id from the list`)
    }
    switch (a.type) {
      case 'click':
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
        highlight(el); fireClick(el); break
      case 'click_xy': {
        const p = pointIn(a.x, a.y)
        el = p.el
        if (!el) throw new Error('Nothing clickable at that point')
        if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
          // another site's frame: hand the click to the script running inside it
          const b = frameContentBox(el)
          return { ok: true, forward: { src: el.src, x: p.x - b.left, y: p.y - b.top, nested: p.nested } }
        }
        // click the exact point, not the element's centre: on a canvas, map or video the
        // target is one spot inside a big element
        highlight(el); fireClick(el, { clientX: p.x, clientY: p.y }); break
      }
      case 'type':
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        highlight(el); typeInto(el, String(a.text ?? ''), a.clear !== false)
        if (a.submit) pressKey(el, 'Enter')
        break
      case 'select': {
        highlight(el)
        if (el.tagName !== 'SELECT') { fireClick(el); break }
        const want = String(a.value ?? a.text ?? '').toLowerCase()
        const opt = Array.from(el.options).find(o => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ||
          Array.from(el.options).find(o => o.text.toLowerCase().includes(want))
        if (!opt) throw new Error(`Option “${a.value}” not found`)
        setNativeValue(el, opt.value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        break
      }
      case 'check':
        highlight(el)
        if ((el.checked ?? el.getAttribute('aria-checked') === 'true') !== (a.checked !== false)) fireClick(el)
        break
      case 'press': pressKey(el, a.key || 'Enter'); break
      case 'hover': {
        highlight(el)
        const o = { bubbles: true, ...center(el) }
        el.dispatchEvent(new PointerEvent('pointerover', o)); el.dispatchEvent(new MouseEvent('mouseover', o)); el.dispatchEvent(new MouseEvent('mouseenter', o))
        break
      }
      case 'focus': el.focus(); highlight(el); break
      case 'scroll': return { ok: true, scroll: scrollPage(a) }
      case 'back': history.back(); return { ok: true, navigated: true }
      default: throw new Error(`Unknown action ${a.type}`)
    }
    await new Promise(r => setTimeout(r, 60))
    return { ok: true, navigated: location.href !== before }
  }

  function settle({ quietMs = 350, maxMs = 4000 } = {}) {
    return new Promise(resolve => {
      const start = Date.now()
      let last = Date.now()
      const mo = new MutationObserver(() => { last = Date.now() })
      mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
      const tick = () => {
        const now = Date.now()
        if ((document.readyState === 'complete' && now - last >= quietMs) || now - start > maxMs) {
          mo.disconnect(); resolve({ ok: true, waited: now - start })
        } else setTimeout(tick, 80)
      }
      tick()
    })
  }

  function readPage(maxChars = 60000) {
    const main = document.querySelector('main, article, [role=main], #content, #main') || document.body
    let text = (main?.innerText || '').trim()
    if (text.length < 400 && main !== document.body) text = document.body.innerText.trim()
    // include same-origin iframe content (Canvas, LMS players)
    for (const f of document.querySelectorAll('iframe')) {
      try { const t = f.contentDocument?.body?.innerText; if (t && t.trim()) text += `\n\n[Embedded frame]\n${t.trim()}` } catch {}
    }
    return { url: location.href, title: document.title, text: text.replace(/\n{3,}/g, '\n\n').slice(0, maxChars), truncated: text.length > maxChars }
  }

  function focusInfo() {
    const a = deepActive(document.activeElement)
    return { editable: isEditable(a), editTs: lastEditTs, selection: String(window.getSelection() || '').trim() || lastSelection, selTs: lastSelTs, top: IS_TOP }
  }

  function insertText(text) {
    const active = deepActive(document.activeElement)
    let el = isEditable(active) ? active : (lastEditable && lastEditable.isConnected ? lastEditable : null)
    if (!el) throw new Error('Click into the text box on the page first, then press Insert again.')
    if (el.isContentEditable) {
      el.focus()
      const doc = el.ownerDocument
      if (!doc.execCommand('insertText', false, text)) { el.append(text); el.dispatchEvent(new InputEvent('input', { bubbles: true })) }
    } else {
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length
      el.focus()
      setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(end))
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    highlight(el)
    return { ok: true }
  }

  // ---------- guided course mode: find and press the page's "Next" control ----------
  const NEXT_RE = /^(next|next page|next slide|next lesson|next module|next section|continue|continue to next|siguiente|suivant|weiter|التالي|›|»|→|>|next ›|next →|next »)$/i
  const NEVER_RE = /submit|finish|complete|turn in|grade|send|post|pay|delete|quiz|exam|test/i
  function clickNext() {
    const items = []
    collect(document, 0, 0, innerWidth, innerHeight, items, { n: 1500 })
    const scored = []
    for (const it of items) {
      const el = it.el
      const label = labelOf(el)
      const rel = el.getAttribute('rel') === 'next' || /\bnext\b/i.test(el.getAttribute('aria-label') || '') || /\bnext\b/i.test(el.className?.baseVal ?? el.className ?? '')
      if (NEVER_RE.test(label)) continue
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
      let score = 0
      if (NEXT_RE.test(label.trim())) score += 10
      else if (/^next\b|\bnext\s*(page|slide|lesson|›|→|»)?$/i.test(label.trim())) score += 7
      if (rel) score += 5
      if (!score) continue
      if (it.inView) score += 2
      scored.push({ el, label, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]
    if (!best) return { ok: false, error: 'I could not find a Next button on this page.' }
    best.el.scrollIntoView({ block: 'center', behavior: 'instant' })
    highlight(best.el)
    fireClick(best.el)
    return { ok: true, label: best.label || 'Next' }
  }

  // ---------- Canvas LMS bridge (uses the teacher's own signed-in session) ----------
  function csrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  }
  function nextLink(h) {
    if (!h) return null
    for (const part of h.split(',')) {
      const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/)
      if (m) return m[1]
    }
    return null
  }
  async function canvasFetch({ path, method = 'GET', body, all = false, maxPages = 50 }) {
    const url = new URL(path, location.origin)
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) throw new Error('Canvas bridge only calls this site\'s /api/')
    const headers = { Accept: 'application/json+canvas-string-ids, application/json' }
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      headers['X-CSRF-Token'] = csrfToken()
      headers['X-Requested-With'] = 'XMLHttpRequest'
    }
    const out = []
    let next = url.href, pages = 0
    while (next) {
      const res = await fetch(next, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
      const raw = await res.text()
      let data = null
      try { data = raw ? JSON.parse(raw.replace(/^while\(1\);/, '')) : null } catch { data = raw }
      if (!res.ok) {
        const msg = data?.errors?.[0]?.message || data?.message || (typeof data === 'string' ? data.slice(0, 200) : '') || res.statusText
        return { ok: false, status: res.status, error: msg }
      }
      if (!all || !Array.isArray(data)) return { ok: true, status: res.status, data }
      out.push(...data)
      next = ++pages < maxPages ? nextLink(res.headers.get('Link')) : null
    }
    return { ok: true, status: 200, data: out }
  }
  function canvasInfo() {
    const isCanvas = !!document.querySelector('#application.ic-app, .ic-app, link[href*="instructure"], script[src*="instructure"]') ||
      /instructure\.com$/.test(location.hostname)
    const m = location.pathname.match(/\/courses\/(\d+)(?:\/(assignments|discussion_topics|gradebook|quizzes)\/?(\d+)?)?/)
    const sg = location.search.match(/assignment_id=(\d+)/)
    const su = location.search.match(/student_id=(\d+)/)
    return {
      isCanvas, origin: location.origin, host: location.hostname,
      courseId: m?.[1] || null,
      section: m?.[2] || null,
      itemId: m?.[3] || sg?.[1] || null,
      studentId: su?.[1] || null
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const run = async () => {
      switch (msg.type) {
        case 'ping': return { ok: true, url: location.href }
        case 'snapshot': return snapshot(msg.options)
        case 'act': return act(msg.action)
        case 'settle': return settle(msg.options)
        case 'readPage': return readPage(msg.maxChars)
        case 'selection': return { text: String(window.getSelection() || '').trim() || lastSelection, url: location.href, title: document.title }
        case 'focusInfo': return focusInfo()
        case 'clickNext': return clickNext()
        case 'insertText': return insertText(msg.text)
        case 'overlay': {
          const u = ensureUi()
          u.pill.style.display = msg.show ? 'flex' : 'none'
          if (msg.text) u.msg.textContent = msg.text
          return { ok: true }
        }
        case 'box': {
          const el = getEl(msg.id)
          el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
          const r = topRect(el)
          return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 }
        }
        case 'pointAt': {
          const el = elementAtPoint(msg.x, msg.y)
          return el ? { tag: el.tagName.toLowerCase(), label: labelOf(el) } : null
        }
        case 'canvasInfo': return canvasInfo()
        case 'canvasFetch': return canvasFetch(msg)
        default: return { ok: false, error: 'unknown message' }
      }
    }
    run().then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message || String(e) }))
    return true
  })
})()
