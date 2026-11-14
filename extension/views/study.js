// "Study" tab: AI tutor over a page, file or pasted text, with flashcards, quizzes and a
// live, interruptible voice tutor that can see your screen.

import { MODES, CARD_SCHEMA, tutorSystem, materialParts, saveDoc, listDocs, ensureDocText } from '../lib/tutor.js'
import { LiveSession, LIVE_TOOLS } from '../lib/live.js'
import { SentenceSpeaker, speak, stopSpeaking, BasicVoice, speechRecognitionAvailable } from '../lib/speech.js'
import { fileToAiPart } from '../lib/files.js'
import * as tabs from '../lib/tabs.js'
import { h, md, composer, toast, spinner, replace, promptDialog, openMicPermission, select } from '../lib/ui.js'
import { truncate, isAbort, fmtDate, sleep, fnv1a } from '../lib/util.js'
import { getFolders, addFolder, unlockFolders, listFiles, readFile, filesSupported } from '../lib/localfiles.js'
import { platform } from '../lib/platform.js'

const VOICE_RULES = `You are speaking out loud in a live voice conversation, like a friendly human tutor on a call.
- Keep each turn short (1–3 sentences) and conversational. Pause often so the learner can respond.
- Ask the learner questions to keep them thinking. Praise effort, correct gently.
- If the learner interrupts, stop and listen.
${platform.pages
    ? `- When screenshots of the learner's screen arrive, you can refer to what they are looking at.
- Use the scroll_page tool to move through the page when the learner asks ("scroll down") and read_page when you need exact wording.
- Use next_page only when the learner asks to go on to the next page, slide or lesson. Then briefly tell them what the new page is about.`
    : `- When pictures from the learner's camera arrive, you can see what they point it at (a worksheet, a book page, the board) and refer to it naturally.`}
- Never answer graded quiz or exam questions for the learner: help them reason it out instead.`
const START_HINT = platform.pages ? 'press **This page**, **Upload file** or **Paste text**' : 'tap **Photo**, **Upload file** or **Paste text**'

export function mount(root, ctx) {
  // phones: the camera stays off until the learner turns it on
  const st = { doc: null, history: [], live: null, basic: null, speakAnswers: false, seeScreen: platform.pages, useMaterial: true, frameTimer: null, controller: null }

  const sourceBox = h('div', { class: 'card flat' })
  const voiceBox = h('div', { class: 'card' })
  const modes = h('div', { class: 'chips' })
  const log = h('div', { class: 'chat', style: { marginTop: '10px' } })
  const setupHolder = h('div')
  const scroller = h('div', { class: 'scroll' }, setupHolder, sourceBox, h('div', { style: { height: '10px' } }), voiceBox, h('div', { class: 'section-title' }, 'Study modes'), modes, log)
  const speakToggle = h('button', { class: 'icon-btn', title: 'Speak answers aloud', onclick: () => { st.speakAnswers = !st.speakAnswers; speakToggle.classList.toggle('primary', st.speakAnswers); if (!st.speakAnswers) stopSpeaking() } }, '🔈')
  const box = composer({ placeholder: 'Ask your tutor anything…', onSubmit: (t) => ask(t), extra: [speakToggle] })
  root.append(scroller, h('div', { class: 'composer-wrap' }, box.el))
  const fileInput = h('input', { type: 'file', class: 'hidden', accept: '.pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.html,.htm,image/*' })
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) useFile(fileInput.files[0]); fileInput.value = '' })
  // phones: take a photo of a worksheet or book page (or pick one from the photo library)
  const photoInput = h('input', { type: 'file', class: 'hidden', accept: 'image/*', capture: 'environment' })
  photoInput.addEventListener('change', () => {
    const f = photoInput.files[0]
    photoInput.value = ''
    if (f) useFile(f, `Photo ${new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)
  })
  root.append(fileInput, photoInput)

  const scrollDown = () => requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight })

  // ---------------- material ----------------
  async function renderSource() {
    const d = st.doc
    const docs = await listDocs().catch(() => [])
    replace(sourceBox,
      h('div', { class: 'source-card' },
        h('div', { class: 'source-icon' }, d ? (d.kind === 'page' ? '🌐' : d.kind === 'text' ? '✍️' : d.kind === 'photo' ? '📷' : '📄') : '📚'),
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 700 } }, d ? truncate(d.name, 70) : 'What are we studying?'),
          h('div', { class: 'small muted' }, d ? (d.kind === 'page' ? 'Web page' : d.kind === 'text' ? 'Pasted text' : d.kind === 'photo' ? 'Photo' : 'File') + (d.text ? ` · ${Math.round(d.text.length / 1000)}k chars` : '') : platform.pages ? 'Use the page you are on, upload a file, or just ask.' : 'Take a photo of a page, upload a file, paste text, or just ask.')),
        d ? h('button', { class: 'btn ghost sm', onclick: () => { st.doc = null; st.history = []; renderSource() } }, '✕') : ''),
      h('div', { class: 'row gap-s wrap', style: { marginTop: '10px' } },
        platform.pages ? h('button', { class: 'btn sm', onclick: () => usePage() }, '🌐 This page') : h('button', { class: 'btn sm', onclick: () => photoInput.click() }, '📷 Photo'),
        platform.pages && d && d.kind === 'page' ? h('button', { class: 'btn sm primary', title: "Press the page's Next / Continue button and study the new page", onclick: () => nextPage() }, 'Next page ›') : '',
        h('button', { class: 'btn sm', onclick: () => fileInput.click() }, '📎 Upload file'),
        h('button', { class: 'btn sm', onclick: () => usePaste() }, '✍️ Paste text'),
        filesSupported() ? h('button', { class: 'btn sm', onclick: () => useMyFiles() }, '📁 My files') : '',
        docs.length ? select([['', `📚 Library (${docs.length})`], ...docs.slice(0, 30).map(x => [x.id, truncate(x.name, 40)])], '', (id) => {
          const x = docs.find(y => y.id === id)
          if (x) setDoc(x)
        }, { style: { width: 'auto', padding: '4px 8px', fontSize: '12px' } }) : ''))
  }

  function setDoc(doc) {
    st.doc = doc
    st.history = []
    renderSource()
    note(`📚 Now studying **${doc.name}**. Pick a study mode or ask me anything.`)
  }

  async function usePage() {
    const tab = await tabs.getTargetTab()
    if (!tab || !tabs.isControllable(tab.url)) return toast('Open the page you want to study first.', 'warn')
    try {
      if (/\.pdf($|[?#])/i.test(tab.url)) return useUrlFile(tab.url, tab.title)
      const page = await tabs.readAll(tab.id, 150000)
      if (!page.text || page.text.length < 80) return useUrlFile(tab.url, tab.title)
      setDoc(await saveDoc({ name: page.title || tab.url, kind: 'page', url: page.url, text: page.text }))
    } catch (e) {
      // Chrome's PDF viewer and some protected pages block reading: download the file instead
      try { await useUrlFile(tab.url, tab.title) } catch { toast(`Could not read this page: ${e.message}`, 'error') }
    }
  }

  /** Guided course mode: the learner (or the voice tutor) moves to the next page together. */
  async function nextPage({ quiet = false } = {}) {
    const tab = await tabs.getTargetTab()
    if (!tab || !tabs.isControllable(tab.url)) {
      if (!quiet) toast('Open the course page first.', 'warn')
      return { error: 'No web page is open' }
    }
    const before = st.doc?.kind === 'page' ? fnv1a(st.doc.text || '') : ''
    const r = await tabs.clickNext(tab.id)
    if (!r.ok) {
      if (!quiet) toast(r.error, 'warn', 6000)
      return { error: r.error }
    }
    await sleep(500)
    await tabs.waitForLoad(tab.id, { timeout: 10000 })
    await tabs.send(tab.id, { type: 'settle', options: { quietMs: 400, maxMs: 3000 } }).catch(() => {})
    let page = await tabs.readAll(tab.id, 150000)
    if (before && fnv1a(page.text || '') === before) { // slow course players: give it a moment
      await sleep(1500)
      page = await tabs.readAll(tab.id, 150000)
    }
    const same = before && fnv1a(page.text || '') === before
    const doc = await saveDoc({ id: st.doc?.kind === 'page' ? st.doc.id : undefined, name: page.title || tab.url, kind: 'page', url: page.url, text: page.text })
    st.doc = doc
    st.history = []
    renderSource()
    note(same
      ? `I pressed **${r.label}**, but the page looks the same. It may need you to finish something on it first.`
      : `➡️ Pressed **${r.label}**. Now studying **${truncate(doc.name, 80)}**. Pick a study mode or ask me anything.`)
    return { moved: !same, pressed: r.label, title: doc.name, text: truncate(page.text || '', 6000) }
  }

  async function useUrlFile(url, title) {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) throw new Error(`Download failed (${res.status})`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const name = decodeURIComponent(url.split('/').pop().split('?')[0]) || title || 'document'
    const part = await fileToAiPart({ name, mimeType: res.headers.get('content-type')?.split(';')[0], bytes }, { nativeMedia: ctx.ai().supportsNativeMedia })
    if (part.note && !part.text && !part.inline) throw new Error(part.note)
    setDoc(await saveDoc({ name: title || name, kind: 'file', url, text: part.text, inline: part.inline }))
  }

  async function useFile(file, photoName) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const part = await fileToAiPart({ name: file.name, mimeType: file.type, bytes }, { nativeMedia: ctx.ai().supportsNativeMedia })
      if (part.note && !part.text && !part.inline) return toast(part.note, 'warn', 7000)
      setDoc(await saveDoc({ name: photoName || file.name, kind: photoName ? 'photo' : 'file', text: part.text, inline: part.inline }))
      if (part.note) toast(part.note, 'warn', 7000)
    } catch (e) { toast(`Could not open ${file.name}: ${e.message}`, 'error') }
  }

  async function useMyFiles() {
    try {
      if (!(await getFolders()).length) await addFolder()
    } catch (e) {
      if (e.name !== 'AbortError') platform.openPermissionPage('?folder=1')
      return
    }
    await unlockFolders(false)
    const files = (await listFiles({ max: 600 })).filter(f => /\.(pdf|docx|pptx|xlsx|txt|md|csv|html?|png|jpe?g|webp)$/i.test(f.name))
    const q = h('input', { class: 'input', placeholder: 'Search your files…' })
    const list = h('div', { class: 'list', style: { maxHeight: '50vh', overflowY: 'auto' } })
    const dlg = h('dialog', { class: 'dialog' }, h('h3', null, 'Pick a file to study'), q, list,
      h('div', { class: 'row end', style: { marginTop: '10px' } }, h('button', { class: 'btn ghost', onclick: () => { dlg.close(); dlg.remove() } }, 'Cancel')))
    const draw = () => {
      const t = q.value.toLowerCase()
      replace(list, files.filter(f => !t || f.path.toLowerCase().includes(t)).slice(0, 80).map(f => h('button', {
        class: 'item', onclick: async () => {
          dlg.close(); dlg.remove()
          try {
            const file = await readFile(f.path)
            const part = await fileToAiPart(file, { nativeMedia: ctx.ai().supportsNativeMedia })
            if (part.note && !part.text && !part.inline) return toast(part.note, 'warn', 6000)
            setDoc(await saveDoc({ name: f.name, kind: 'file', text: part.text, inline: part.inline }))
          } catch (e) { toast(e.message, 'error') }
        }
      }, h('span', null, '📄'), h('div', { class: 'grow' }, h('div', { class: 'title' }, f.name), h('div', { class: 'sub' }, `${f.path} · ${fmtDate(f.modified)}`)))))
      if (!list.childElementCount) list.append(h('p', { class: 'small muted' }, files.length ? 'No match.' : 'No readable files found (or the folder is locked — allow it in Settings → My files).'))
    }
    q.addEventListener('input', draw)
    document.body.append(dlg)
    dlg.showModal()
    draw()
    q.focus()
  }

  async function usePaste() {
    const text = await promptDialog({ title: 'Paste what you want to study', placeholder: 'Notes, a chapter, an article…', multiline: true, ok: 'Study this' })
    if (text && text.trim()) setDoc(await saveDoc({ name: truncate(text.trim().split('\n')[0], 50) || 'Pasted text', kind: 'text', text }))
  }

  // ---------------- chat ----------------
  function note(text) { log.append(h('div', { class: 'msg ai' }, md(text))); scrollDown() }
  function aiMsg() {
    const body = h('div', null, spinner())
    const el = h('div', { class: 'msg ai' }, body, h('div', { class: 'tools' },
      h('button', { class: 'icon-btn sm', title: 'Read aloud', onclick: () => speak(el._text || '', { language: ctx.settings.language, rate: ctx.settings.speechRate }) }, '🔊'),
      h('button', { class: 'icon-btn sm', title: 'Copy', onclick: () => navigator.clipboard.writeText(el._text || '').then(() => toast('Copied', 'ok', 1200)) }, '⧉')))
    el.set = (t) => { el._text = t; body.replaceChildren(md(t)); scrollDown() }
    log.append(el); scrollDown()
    return el
  }

  async function ask(text, display = text) {
    const ai = ctx.ai()
    if (!ai.isConfigured()) { note('First connect an AI key in **Settings** (it is free).'); return }
    if (st.live) { st.live.sendText(text); addTranscript('user', text + ' '); return }
    log.append(h('div', { class: 'msg user' }, display)); scrollDown()
    const parts = [{ text }]
    if (!st.history.length && st.doc) parts.unshift(...materialParts(st.doc, ai.supportsNativeMedia))
    st.history.push({ role: 'user', parts })
    if (st.history.length > 18) st.history.splice(1, 2) // keep the material turn + recent turns
    const m = aiMsg()
    const speaker = st.speakAnswers ? new SentenceSpeaker({ language: ctx.settings.language, rate: ctx.settings.speechRate }) : null
    st.controller = new AbortController()
    try {
      let last = 0
      const r = await ai.generate({
        tier: 'smart', system: tutorSystem(ctx.settings), messages: st.history, signal: st.controller.signal,
        onText: (delta, full) => { speaker?.feed(delta); if (Date.now() - last > 100) { last = Date.now(); m.set(full) } }
      })
      speaker?.end()
      m.set(r.text)
      st.history.push({ role: 'model', parts: [{ text: r.text }] })
      return r.text
    } catch (e) {
      st.history.pop()
      speaker?.stop()
      m.set(isAbort(e) ? '_(stopped)_' : `⚠️ ${e.message}`)
    }
  }

  async function flashcards() {
    const ai = ctx.ai()
    if (!ai.isConfigured()) return note('First connect an AI key in **Settings**.')
    if (!st.doc) return note(`Give me something to study first: ${START_HINT}.`)
    log.append(h('div', { class: 'msg user' }, 'Make flashcards')); scrollDown()
    const holder = h('div', { class: 'msg ai', style: { maxWidth: '100%', width: '100%' } }, spinner(), ' Making flashcards…')
    log.append(holder)
    try {
      const r = await ai.generate({
        tier: 'smart', system: tutorSystem(ctx.settings), schema: CARD_SCHEMA,
        messages: [{ role: 'user', parts: [...materialParts(st.doc, ai.supportsNativeMedia), { text: 'Create 12 high-quality flashcards covering the most important ideas. Short questions, clear answers.' }] }]
      })
      const cards = r.json.cards || []
      replace(holder, h('div', { class: 'small muted', style: { marginBottom: '6px' } }, `${cards.length} flashcards — tap to flip`),
        h('div', { class: 'flashcards' }, cards.map(c => {
          const card = h('div', { class: 'flash', onclick: () => card.classList.toggle('flipped') },
            h('div', { class: 'flash-inner' }, h('div', { class: 'flash-face' }, c.q), h('div', { class: 'flash-face back' }, c.a)))
          return card
        })))
    } catch (e) { replace(holder, `⚠️ ${e.message}`) }
    scrollDown()
  }

  function renderModes() {
    replace(modes, Object.entries(MODES).map(([k, m]) => h('button', {
      class: 'chip',
      onclick: () => k === 'flashcards' ? flashcards() : st.doc || k === 'quiz' ? ask(m.prompt, m.label) : note(`Give me something to study first: ${START_HINT}.`)
    }, m.label)))
  }

  // ---------------- voice ----------------
  let transcriptEl, orb, stateLabel, camHolder, camVideo = null, lastRole = null, lastLine = null
  function addTranscript(role, text) {
    if (!transcriptEl) return
    if (lastRole !== role || !lastLine) {
      lastLine = h('p', { class: role === 'user' ? 'you' : '' }, h('strong', null, role === 'user' ? 'You: ' : 'Tutor: '))
      transcriptEl.append(lastLine)
      lastRole = role
    }
    lastLine.append(text)
    transcriptEl.scrollTop = transcriptEl.scrollHeight
  }

  function renderVoice() {
    const on = !!(st.live || st.basic)
    orb = h('div', { class: 'orb' })
    stateLabel = h('div', { class: 'small muted', style: { textAlign: 'center' } }, on ? 'Listening…' : 'Talk with your tutor — interrupt any time')
    transcriptEl = h('div', { class: 'live-transcript' })
    lastRole = null; lastLine = null
    const screen = h('input', { type: 'checkbox', checked: st.seeScreen, onchange: (e) => { st.seeScreen = e.target.checked; if (st.live) e.target.checked ? startFrames() : stopFrames() } })
    camHolder = h('div')
    const mat = h('input', { type: 'checkbox', checked: st.useMaterial, disabled: on, onchange: (e) => { st.useMaterial = e.target.checked } })
    replace(voiceBox,
      h('div', { class: 'row between' }, h('h3', { style: { margin: 0 } }, '🎙 Voice tutor'), h('span', { class: 'badge' }, ctx.ai().supportsLive ? 'Live · natural voice' : 'Basic voice')),
      orb, stateLabel,
      h('div', { class: 'row center gap', style: { marginTop: '10px' } },
        on ? [
          st.live ? h('button', { class: 'btn', onclick: (e) => { st.live.muted = !st.live.muted; e.target.textContent = st.live.muted ? '🎙 Unmute' : '🔇 Mute' } }, '🔇 Mute') : '',
          st.live ? h('button', { class: 'btn', onclick: () => st.live.flush() }, '✋ Quiet') : '',
          h('button', { class: 'btn danger', onclick: () => stopVoice() }, '■ Stop')
        ] : h('button', { class: 'btn primary big', onclick: () => startVoice() }, 'Start talking')),
      h('div', { class: 'row center gap wrap small', style: { marginTop: '8px' } },
        h('label', { class: 'check', style: { margin: 0 } }, screen, platform.pages ? 'See my screen' : 'Show my camera'),
        h('label', { class: 'check', style: { margin: 0 } }, mat, 'Use my material')),
      camHolder,
      transcriptEl)
    if (platform.camera?.on && camVideo) camHolder.append(camVideo)
  }

  async function startVoice() {
    const ai = ctx.ai()
    if (!ai.isConfigured()) return note('First connect an AI key in **Settings** (it is free).')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach(t => t.stop())
    } catch { return openMicPermission() }
    if (!ai.supportsLive) return startBasic()
    let doc = st.useMaterial ? st.doc : null
    renderVoice()
    orb.className = 'orb connecting'
    stateLabel.textContent = doc && !doc.text ? 'Preparing your material for voice…' : 'Connecting…'
    try {
      if (doc && !doc.text) doc = await ensureDocText(ai, doc)
      const system = `${tutorSystem(ctx.settings)}\n${VOICE_RULES}\nSpeak in ${ctx.settings.language || 'English'}.` +
        (doc?.text ? `\n\nSTUDY MATERIAL — “${doc.name}”:\n${truncate(doc.text, 30000)}` : '')
      st.live = new LiveSession({
        apiKey: ctx.settings.geminiApiKey, model: ctx.settings.liveModel, voice: ctx.settings.voiceName, system, tools: platform.pages ? LIVE_TOOLS : [],
        onToolCall: (name, args) => toolCall(name, args),
        onEvent: (e) => onLive(e)
      })
      await st.live.start()
      renderVoice()
      if (st.seeScreen) startFrames()
      st.live.sendText(doc ? `(The learner just opened a voice session to study “${doc.name}”. Greet them in one short sentence and suggest where to start.)` : '(The learner just opened a voice session. Greet them in one short sentence and ask what they want to learn.)')
    } catch (e) {
      st.live?.stop(); st.live = null
      renderVoice()
      toast(`${e.message} Switching to basic voice.`, 'warn', 7000)
      startBasic()
    }
  }

  function onLive(e) {
    if (!orb) return
    if (e.type === 'state') {
      orb.className = `orb ${e.state === 'speaking' ? 'speaking' : e.state === 'connecting' || e.state === 'reconnecting' ? 'connecting' : ''}`
      stateLabel.textContent = { listening: 'Listening… just talk', speaking: 'Tutor is speaking — talk to interrupt', connecting: 'Connecting…', reconnecting: 'Reconnecting…', closed: 'Voice session ended' }[e.state] || ''
      if (e.state === 'closed' && st.live) { stopFrames(); st.live = null; renderVoice() }
    } else if (e.type === 'level' && !st.live?.speaking) {
      orb.style.transform = `scale(${1 + Math.min(0.18, e.level * 1.8)})`
    } else if (e.type === 'transcript') addTranscript(e.role, e.text)
    else if (e.type === 'interrupted') lastRole = null
    else if (e.type === 'turn') lastRole = null
    else if (e.type === 'error') toast(e.message, 'error', 6000)
  }

  async function toolCall(name, args) {
    const tab = await tabs.getTargetTab()
    if (!tab || !tabs.isControllable(tab.url)) return { error: 'No web page is open' }
    if (name === 'scroll_page') {
      const r = await tabs.send(tab.id, { type: 'act', action: { type: 'scroll', direction: args.direction || 'down' } })
      return { scrolled: args.direction, position: r.scroll }
    }
    if (name === 'read_page') {
      const p = await tabs.snapshotAll(tab.id, { maxElements: 0, maxText: 8000 }, { perFrame: 0 })
      return { title: p.title, visibleText: truncate(p.text || '', 12000) }
    }
    if (name === 'next_page') return nextPage({ quiet: true })
    return { error: 'unknown tool' }
  }

  async function startFrames() {
    stopFrames()
    let lastSig = ''
    let grab
    if (platform.pages) {
      grab = async () => {
        const tab = await tabs.getTargetTab()
        if (!tab?.active || !tabs.isControllable(tab.url)) return null
        return tabs.screenshot(tab, { maxWidth: 960, quality: 0.5 })
      }
    } else {
      // phones: the tutor sees what the back camera sees, with a preview so the learner knows
      try {
        camVideo = await platform.camera.start()
        camHolder?.append(camVideo)
      } catch {
        st.seeScreen = false
        if (st.live) renderVoice()
        return platform.openPermissionPage()
      }
      grab = () => platform.camera.frame({ maxWidth: 960, quality: 0.5 })
    }
    st.frameTimer = setInterval(async () => {
      if (!st.live) return stopFrames()
      try {
        const shot = await grab()
        if (!shot) return
        const sig = shot.data.length + shot.data.slice(-200)
        if (sig === lastSig) return // nothing changed: save tokens
        lastSig = sig
        st.live?.sendImage(shot.data, shot.mimeType)
      } catch {}
    }, 1500)
  }
  function stopFrames() {
    clearInterval(st.frameTimer); st.frameTimer = null
    if (platform.camera?.on) { platform.camera.stop(); camVideo = null }
  }

  function startBasic() {
    if (!speechRecognitionAvailable()) return toast(platform.phone ? 'The voice tutor needs your Gemini key (Settings → AI brain).' : 'Voice is not available in this browser.', 'error', 7000)
    st.speakAnswers = true
    speakToggle.classList.add('primary')
    let busy = false
    st.basic = new BasicVoice({
      language: ctx.settings.language,
      onUtterance: async (text) => {
        if (busy) { st.controller?.abort() }
        busy = true
        addTranscript('user', text + ' ')
        const answer = await ask(text)
        if (answer) addTranscript('tutor', truncate(answer, 400))
        busy = false
      },
      onState: (s) => { if (s === 'denied') { stopVoice(); openMicPermission() } }
    })
    st.basic.start()
    renderVoice()
    stateLabel.textContent = 'Listening… (basic voice — add a Gemini key for natural live voice)'
  }

  function stopVoice() {
    stopFrames()
    st.live?.stop(); st.live = null
    st.basic?.stop(); st.basic = null
    stopSpeaking()
    renderVoice()
  }

  renderSource()
  renderModes()
  renderVoice()
  return {
    onShow: async (p) => {
      replace(setupHolder, ctx.setupCard() || '')
      if (p?.usePage && platform.pages) usePage()
      if (p?.explain) { setDoc(await saveDoc({ name: truncate(p.explain, 50), kind: 'text', text: p.explain })); ask('Explain this to me clearly, with an example.', 'Explain this') }
      if (p?.read) speak(p.read, { language: ctx.settings.language, rate: ctx.settings.speechRate })
    },
    onSettings: () => { replace(setupHolder, ctx.setupCard() || ''); if (!st.live && !st.basic) renderVoice() }
  }
}
