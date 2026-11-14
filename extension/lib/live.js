// Real-time voice tutor over the Gemini Live API (WebSocket, native audio in/out).
// - Mic audio streams as 16 kHz PCM; the tutor answers with natural speech.
// - Talking over the tutor interrupts it instantly (server VAD -> "interrupted" -> flush audio).
// - Optional: sends a screenshot of the current tab every ~1.5 s so the tutor sees what you see.
// - Tools let the tutor scroll and read the page you are on.
import { platform } from './platform.js'

import { base64ToBytes, bytesToBase64 } from './util.js'

export const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

export const VOICES = ['Aoede', 'Kore', 'Leda', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Orus']

export const LIVE_TOOLS = [{
  functionDeclarations: [
    {
      name: 'scroll_page',
      description: "Scroll the learner's current web page.",
      parameters: { type: 'OBJECT', properties: { direction: { type: 'STRING', enum: ['up', 'down', 'top', 'bottom'] } }, required: ['direction'] }
    },
    {
      name: 'read_page',
      description: "Get the text of the learner's current web page (use when you need exact wording).",
      parameters: { type: 'OBJECT', properties: {} }
    },
    {
      name: 'next_page',
      description: "Press the page's own Next / Continue button to move to the next page, slide or lesson, then return the new page's text. Use ONLY when the learner asks to move on. It never submits quizzes or answers.",
      parameters: { type: 'OBJECT', properties: {} }
    }
  ]
}]

export async function requestMic() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach(t => t.stop())
    return true
  } catch (e) {
    return false
  }
}

/** The Live API "setup" message (shared by the app and tools/smoke.mjs). */
export function buildSetup({ model, voice, system, tools }, handle = null) {
  const setup = {
    model: `models/${model}`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      ...(voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } : {})
    },
    systemInstruction: { parts: [{ text: system }] },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: handle ? { handle } : {}
  }
  if (tools) setup.tools = tools
  return setup
}

export class LiveSession {
  /**
   * @param {{apiKey: string, model: string, voice?: string, system: string, tools?: Array,
   *          onToolCall?: (name: string, args: object) => Promise<any>,
   *          onEvent: (e: {type: string, [k: string]: any}) => void}} o
   */
  constructor(o) {
    this.o = o
    this.ws = null
    this.handle = null
    this.closedByUser = false
    this.sources = new Set()
    this.nextTime = 0
    this.speaking = false
    this.muted = false
  }

  emit(type, data = {}) { this.o.onEvent?.({ type, ...data }) }

  async start() {
    this.closedByUser = false
    this.emit('state', { state: 'connecting' })
    await this.#connect()
    await this.#startMic()
    this.emit('state', { state: 'listening' })
  }

  #connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(this.o.apiKey)}`)
      this.ws = ws
      let ready = false
      ws.onopen = () => {
        ws.send(JSON.stringify({ setup: buildSetup(this.o, this.handle) }))
      }
      ws.onmessage = async (ev) => {
        let msg
        try {
          const raw = typeof ev.data === 'string' ? ev.data : await ev.data.text()
          msg = JSON.parse(raw)
        } catch { return }
        if (msg.setupComplete !== undefined && !ready) { ready = true; resolve() }
        this.#onMessage(msg)
      }
      ws.onerror = () => { if (!ready) reject(new Error('Could not connect to Gemini Live. Check your API key and the Live model in Settings.')) }
      ws.onclose = (ev) => {
        if (!ready) {
          reject(new Error(ev.reason ? `Gemini Live closed: ${ev.reason}` : 'Gemini Live refused the connection. Check the Live model name in Settings.'))
          return
        }
        if (this.ws !== ws) return // replaced by a resumed connection
        if (!this.closedByUser && this.handle) {
          this.emit('state', { state: 'reconnecting' })
          this.#connect().then(() => this.emit('state', { state: 'listening' }), (e) => { this.emit('error', { message: e.message }); this.stop() })
        } else if (!this.closedByUser) {
          this.emit('error', { message: ev.reason || 'The voice session ended.' })
          this.stop()
        }
      }
    })
  }

  async #startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    this.inCtx = new AudioContext({ sampleRate: 16000 })
    await this.inCtx.audioWorklet.addModule(platform.asset('audio/pcm-recorder.js'))
    const src = this.inCtx.createMediaStreamSource(this.stream)
    this.worklet = new AudioWorkletNode(this.inCtx, 'pcm-recorder')
    this.worklet.port.onmessage = ({ data }) => {
      this.emit('level', { level: data.level })
      if (this.muted || this.ws?.readyState !== WebSocket.OPEN) return
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: bytesToBase64(new Uint8Array(data.pcm)), mimeType: 'audio/pcm;rate=16000' } } }))
    }
    src.connect(this.worklet)
    this.outCtx = new AudioContext({ sampleRate: 24000 })
  }

  async #onMessage(msg) {
    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.handle = msg.sessionResumptionUpdate.newHandle
    }
    if (msg.goAway) {
      // server will disconnect soon: reconnect proactively with the resumption handle
      if (this.handle && !this.closedByUser) {
        const old = this.ws
        this.#connect().then(() => { try { old.close() } catch {} }).catch(() => {})
      }
    }
    if (msg.toolCall?.functionCalls?.length) {
      const responses = []
      for (const fc of msg.toolCall.functionCalls) {
        let result
        try { result = await this.o.onToolCall?.(fc.name, fc.args || {}) } catch (e) { result = { error: e.message } }
        responses.push({ id: fc.id, name: fc.name, response: { result: result ?? 'ok' } })
        this.emit('tool', { name: fc.name, args: fc.args })
      }
      this.ws?.send(JSON.stringify({ toolResponse: { functionResponses: responses } }))
    }
    const sc = msg.serverContent
    if (!sc) return
    if (sc.interrupted) { this.flush(); this.emit('interrupted') }
    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data && /audio/.test(part.inlineData.mimeType || 'audio')) {
        const rate = Number((part.inlineData.mimeType || '').match(/rate=(\d+)/)?.[1]) || 24000
        this.#play(base64ToBytes(part.inlineData.data), rate)
      }
    }
    if (sc.inputTranscription?.text) this.emit('transcript', { role: 'user', text: sc.inputTranscription.text })
    if (sc.outputTranscription?.text) this.emit('transcript', { role: 'tutor', text: sc.outputTranscription.text })
    if (sc.turnComplete) this.emit('turn')
  }

  #play(bytes, rate) {
    if (!this.outCtx) return
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2))
    const buf = this.outCtx.createBuffer(1, samples.length, rate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < samples.length; i++) ch[i] = samples[i] / 32768
    const src = this.outCtx.createBufferSource()
    src.buffer = buf
    src.connect(this.outCtx.destination)
    const t = Math.max(this.outCtx.currentTime + 0.02, this.nextTime)
    src.start(t)
    this.nextTime = t + buf.duration
    this.sources.add(src)
    if (!this.speaking) { this.speaking = true; this.emit('state', { state: 'speaking' }) }
    src.onended = () => {
      this.sources.delete(src)
      if (!this.sources.size) { this.speaking = false; this.emit('state', { state: 'listening' }) }
    }
  }

  /** Stop the tutor's voice immediately (keeps the session open). */
  flush() {
    for (const s of this.sources) { try { s.stop() } catch {} }
    this.sources.clear()
    this.nextTime = 0
    if (this.speaking) { this.speaking = false; this.emit('state', { state: 'listening' }) }
  }

  sendText(text) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.flush()
    this.ws.send(JSON.stringify({ realtimeInput: { text } }))
  }

  sendImage(b64, mimeType = 'image/jpeg') {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ realtimeInput: { video: { data: b64, mimeType } } }))
  }

  setMuted(m) { this.muted = m }

  stop() {
    this.closedByUser = true
    this.flush()
    try { this.ws?.close() } catch {}
    this.ws = null
    try { this.worklet?.disconnect() } catch {}
    this.stream?.getTracks().forEach(t => t.stop())
    this.inCtx?.close().catch(() => {})
    this.outCtx?.close().catch(() => {})
    this.inCtx = this.outCtx = this.stream = this.worklet = null
    this.emit('state', { state: 'closed' })
  }
}
