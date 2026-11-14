// Free browser speech (Web Speech API): read-aloud and a basic voice mode that works
// with any AI provider. Speaks sentence-by-sentence while the answer is still streaming.

let voicesReady
function voices() {
  if (!voicesReady) {
    voicesReady = new Promise(resolve => {
      const v = speechSynthesis.getVoices()
      if (v.length) return resolve(v)
      speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices())
      setTimeout(() => resolve(speechSynthesis.getVoices()), 1500)
    })
  }
  return voicesReady
}

const LANG_CODES = { english: 'en', arabic: 'ar', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it', chinese: 'zh', japanese: 'ja', korean: 'ko', hindi: 'hi', russian: 'ru', turkish: 'tr', urdu: 'ur', vietnamese: 'vi', tagalog: 'fil', amharic: 'am', swahili: 'sw' }

export function langCode(language) {
  const k = String(language || 'english').toLowerCase().trim()
  return LANG_CODES[k] || (k.length <= 5 ? k : 'en')
}

export async function bestVoice(language) {
  const code = langCode(language)
  const list = (await voices()).filter(v => v.lang.toLowerCase().startsWith(code))
  const score = (v) => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1)
  return list.sort((a, b) => score(b) - score(a))[0] || null
}

function cleanForSpeech(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/[*_#>`|]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Speaks text as it streams in. feed(delta) as chunks arrive; end() when complete. */
export class SentenceSpeaker {
  constructor({ language, rate = 1.05, onStart, onEnd } = {}) {
    this.language = language
    this.rate = rate
    this.buf = ''
    this.pending = 0
    this.onStart = onStart
    this.onEnd = onEnd
    this.stopped = false
  }
  feed(delta) {
    if (this.stopped) return
    this.buf += delta
    // speak every complete sentence (short utterances also avoid Chrome's long-utterance cutoff)
    let m
    while ((m = this.buf.match(/^([\s\S]{12,}?[.!?。؟:\n])(\s+)/))) {
      this.buf = this.buf.slice(m[0].length)
      this.#say(m[1])
    }
    if (this.buf.length > 400) { // very long run-on text: cut at a comma or space
      const cut = Math.max(this.buf.lastIndexOf(', ', 300), this.buf.lastIndexOf(' ', 300))
      if (cut > 50) { this.#say(this.buf.slice(0, cut + 1)); this.buf = this.buf.slice(cut + 1) }
    }
  }
  end() {
    if (this.buf.trim()) this.#say(this.buf)
    this.buf = ''
    if (!this.pending) this.onEnd?.()
  }
  async #say(text) {
    const t = cleanForSpeech(text)
    if (!t || this.stopped) return
    this.pending++
    const u = new SpeechSynthesisUtterance(t)
    const v = await bestVoice(this.language)
    if (this.stopped) return
    if (v) u.voice = v
    u.lang = v?.lang || langCode(this.language)
    u.rate = this.rate
    u.onstart = () => this.onStart?.()
    u.onend = u.onerror = () => { if (--this.pending === 0 && !this.buf) this.onEnd?.() }
    speechSynthesis.speak(u)
  }
  stop() {
    this.stopped = true
    this.buf = ''
    this.pending = 0
    speechSynthesis.cancel()
    this.onEnd?.()
  }
}

export function speak(text, { language, rate } = {}) {
  speechSynthesis.cancel()
  const s = new SentenceSpeaker({ language, rate })
  s.feed(text + ' ')
  s.end()
  return s
}

export function stopSpeaking() { speechSynthesis.cancel() }

export function speechRecognitionAvailable() {
  return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition)
}

/**
 * Basic hands-free voice loop with barge-in (stops speaking as soon as you talk).
 * onUtterance(text) should return a Promise that resolves after the reply is spoken/started.
 */
export class BasicVoice {
  constructor({ language, onUtterance, onInterim, onState }) {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition
    if (!SR) throw new Error('Speech recognition is not available in this browser.')
    this.rec = new SR()
    this.rec.lang = langCode(language)
    this.rec.continuous = true
    this.rec.interimResults = true
    this.running = false
    this.rec.onspeechstart = () => { speechSynthesis.cancel(); onState?.('listening') }
    this.rec.onresult = (ev) => {
      let interim = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]
        if (r.isFinal) {
          const text = r[0].transcript.trim()
          if (text) onUtterance(text)
        } else interim += r[0].transcript
      }
      onInterim?.(interim)
    }
    this.rec.onerror = (e) => { if (e.error === 'not-allowed') { this.running = false; onState?.('denied') } }
    this.rec.onend = () => { if (this.running) { try { this.rec.start() } catch {} } else onState?.('closed') }
  }
  start() { this.running = true; this.rec.start() }
  stop() { this.running = false; try { this.rec.stop() } catch {}; speechSynthesis.cancel() }
}
