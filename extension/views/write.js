// "Write" tab: reply to any email/comment/post, or write something new; insert it into the
// page, copy it, or save it as a Word document.

import { draftReply, improveText, TONES } from '../lib/compose.js'
import * as tabs from '../lib/tabs.js'
import { getFolders, writeFile, downloadFile, unlockFolders, filesSupported } from '../lib/localfiles.js'
import { audit } from '../lib/db.js'
import { h, toast, select, replace, promptDialog } from '../lib/ui.js'
import { speak } from '../lib/speech.js'
import { isAbort, truncate } from '../lib/util.js'
import { platform } from '../lib/platform.js'

const KINDS = [['email', 'Email reply'], ['comment', 'Comment / feedback'], ['discussion', 'Discussion post'], ['message', 'Chat message'], ['new', 'Something new (letter, lesson plan, notes…)']]

export function mount(root, ctx) {
  let kind = 'email', tone = 'Warm', controller = null
  const original = h('textarea', { class: 'input', rows: 5, placeholder: platform.pages ? 'Paste the email or comment you are replying to — or use the buttons below to grab it from the page.' : 'Paste the email or comment you are replying to.' })
  const intent = h('textarea', { class: 'input', rows: 2, placeholder: 'What do you want to say? (optional) — e.g. “thank them, say yes to the meeting on Tuesday, ask for the form”' })
  const lang = h('input', { class: 'input', value: ctx.settings.language || 'English', style: { width: '130px' } })
  const out = h('textarea', { class: 'input', rows: 10, placeholder: 'Your draft appears here. Edit it freely.' })
  const setup = h('div')
  const goBtn = h('button', { class: 'btn primary', onclick: () => go() }, '✨ Write it')
  const stopBtn = h('button', { class: 'btn hidden', onclick: () => controller?.abort() }, 'Stop')

  async function pasteIn() {
    try {
      const t = await navigator.clipboard.readText()
      if (!t) return toast('Copy the message first, then tap Paste.', 'warn')
      original.value = t
    } catch { toast('Long-press the box and choose Paste.', 'info') }
  }

  async function grab(what) {
    const tab = await tabs.getTargetTab()
    if (!tab || !tabs.isControllable(tab.url)) return toast('Open the page with the message first.', 'warn')
    try {
      if (what === 'selection') {
        const r = await tabs.sendToFocusedFrame(tab.id, { type: 'selection' }, 'selection')
        if (!r.text) return toast('Select (highlight) the message on the page first.', 'warn')
        original.value = r.text
      } else {
        const r = await tabs.readAll(tab.id, 12000)
        original.value = r.text
      }
    } catch (e) { toast(e.message, 'error') }
  }

  async function go() {
    const ai = ctx.ai()
    if (!ai.isConfigured()) return toast('Add your AI key in Settings first.', 'warn')
    controller = new AbortController()
    goBtn.disabled = true; stopBtn.classList.remove('hidden')
    out.value = ''
    try {
      await draftReply({
        ai, settings: ctx.settings, kind: KINDS.find(k => k[0] === kind)[1],
        original: kind === 'new' ? '' : original.value.trim(),
        context: kind === 'new' && original.value.trim() ? `Background material:\n${original.value}` : '',
        intent: intent.value.trim() || (kind === 'new' ? 'Write it.' : ''), tone, language: lang.value,
        signal: controller.signal, onText: (_d, full) => { out.value = full; out.scrollTop = out.scrollHeight }
      })
    } catch (e) { if (!isAbort(e)) toast(e.message, 'error') }
    goBtn.disabled = false; stopBtn.classList.add('hidden')
  }

  async function tweak(how) {
    if (!out.value.trim()) return
    out.disabled = true
    try { out.value = await improveText({ ai: ctx.ai(), settings: { ...ctx.settings, language: lang.value }, text: out.value, how }) } catch (e) { toast(e.message, 'error') }
    out.disabled = false
  }

  async function insert() {
    if (!out.value.trim()) return toast('Nothing to insert yet.', 'warn')
    const tab = await tabs.getTargetTab()
    if (!tab || !tabs.isControllable(tab.url)) return toast('Open the page first.', 'warn')
    try {
      await tabs.sendToFocusedFrame(tab.id, { type: 'insertText', text: out.value }, 'edit')
      await audit('write.inserted', { url: tab.url, chars: out.value.length })
      toast('Inserted. Review it on the page, then send it yourself.', 'ok', 5000)
    } catch (e) { toast(e.message, 'error', 6000) }
  }

  async function saveWord() {
    if (!out.value.trim()) return toast('Nothing to save yet.', 'warn')
    const suggested = truncate(out.value.trim().split('\n')[0].replace(/[\\/:*?"<>|#]/g, '').trim(), 40) || 'DoTask document'
    const folders = filesSupported() ? await getFolders() : []
    const where = folders.length ? `Saved into your folder “${folders[0].name}”.` : platform.phone ? 'Then choose where it goes: Files, Drive, email…' : 'Saved to your Downloads folder.'
    const name = await promptDialog({ title: 'Save as Word document', body: where, value: `${suggested}.docx`, ok: 'Save' })
    if (!name) return
    const file = /\.(docx|txt|md)$/i.test(name) ? name : `${name}.docx`
    try {
      if (folders.length) {
        await unlockFolders(true)
        await writeFile(`${folders[0].name}/${file}`, out.value)
        toast(`Saved ${file} in ${folders[0].name} ✓`, 'ok')
      } else {
        await downloadFile(file, out.value)
        if (!platform.phone) toast(`Saved ${file} to Downloads ✓`, 'ok')
      }
    } catch (e) { toast(e.message, 'error', 6000) }
  }

  const kindSeg = h('div', { class: 'chips' })
  function renderKinds() {
    replace(kindSeg, KINDS.map(([id, label]) => h('button', { class: `chip ${kind === id ? 'on' : ''}`, onclick: () => { kind = id; renderKinds(); original.placeholder = id === 'new' ? 'Optional background: notes, facts, or a document to base it on.' : 'Paste the message you are replying to — or grab it from the page.' } }, label)))
  }
  renderKinds()

  root.append(h('div', { class: 'scroll' }, setup,
    h('div', { class: 'section-title', style: { marginTop: 0 } }, 'What are you writing?'), kindSeg,
    h('div', { class: 'section-title' }, 'Message you received'), original,
    h('div', { class: 'row gap-s wrap', style: { marginTop: '6px' } },
      platform.pages ? [
        h('button', { class: 'btn sm', onclick: () => grab('selection') }, '✂️ Use highlighted text'),
        h('button', { class: 'btn sm', onclick: () => grab('page') }, '🌐 Use whole page')
      ] : h('button', { class: 'btn sm', onclick: () => pasteIn() }, '📋 Paste')),
    h('div', { class: 'section-title' }, 'What do you want to say?'), intent,
    h('div', { class: 'row gap wrap', style: { marginTop: '8px' } }, select(TONES, tone, (v) => { tone = v }, { style: { width: 'auto' } }), lang, goBtn, stopBtn),
    h('div', { class: 'section-title' }, 'Draft'), out,
    h('div', { class: 'row gap-s wrap', style: { marginTop: '6px' } },
      h('button', { class: 'btn sm', onclick: () => tweak('Make it shorter.') }, 'Shorter'),
      h('button', { class: 'btn sm', onclick: () => tweak('Make it more formal and professional.') }, 'More formal'),
      h('button', { class: 'btn sm', onclick: () => tweak('Make it warmer and friendlier.') }, 'Warmer'),
      h('button', { class: 'btn sm', onclick: () => tweak('Fix grammar, spelling and clarity only.') }, 'Fix grammar'),
      h('button', { class: 'btn sm', onclick: async () => { const l = await promptDialog({ title: 'Translate to…', value: 'Spanish', ok: 'Translate' }); if (l) tweak(`Translate it into ${l}. Keep the tone.`) } }, 'Translate'),
      h('button', { class: 'icon-btn sm', title: 'Read aloud', onclick: () => speak(out.value, { language: lang.value, rate: ctx.settings.speechRate }) }, '🔊')),
    h('div', { class: 'row gap wrap', style: { marginTop: '12px' } },
      platform.pages ? h('button', { class: 'btn ok', onclick: () => insert() }, '⤵ Insert into page')
        : h('button', { class: 'btn ok', onclick: () => out.value.trim() ? platform.share({ title: 'DoTask draft', text: out.value }) : toast('Nothing to share yet.', 'warn') }, '↗ Share'),
      h('button', { class: 'btn', onclick: () => out.value && navigator.clipboard.writeText(out.value).then(() => toast('Copied', 'ok', 1200)) }, '⧉ Copy'),
      h('button', { class: 'btn', onclick: () => saveWord() }, '💾 Save as Word')),
    h('p', { class: 'hint' }, platform.pages
      ? 'Tip: click into the reply box on the website first, then press “Insert into page”. DoTask never presses Send for you here.'
      : 'Tip: DoTask never sends anything for you. Copy or share the draft into your email, Canvas or chat app and send it yourself.')))

  return {
    onShow: (p) => {
      replace(setup, ctx.setupCard() || '')
      if (p?.original) { original.value = p.original; kind = 'email'; renderKinds() }
    },
    onSettings: () => replace(setup, ctx.setupCard() || '')
  }
}
