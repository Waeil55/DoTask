// Provider-agnostic AI client. Talks directly to the provider from the user's browser:
// no DoTask server, no hosting bill. Supports Google Gemini (free tier friendly) and any
// OpenAI-compatible endpoint (Ollama/LM Studio locally, Groq, OpenRouter, OpenAI, ...).

import { parseJsonLoose, sleep, isAbort } from './util.js'

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'

// Paid-tier list prices per 1M tokens (input, output), used only for the usage estimate.
export const PRICES = {
  'gemini-3.8-flash': [0.75, 3.75],
  'gemini-3.6-flash': [0.75, 3.75],
  'gemini-3.5-flash-lite': [0.30, 2.50],
  'gemini-3.1-flash-lite': [0.25, 1.50]
}

export const GEMINI_DEFAULTS = {
  fastModel: 'gemini-3.5-flash-lite',
  smartModel: 'gemini-3.6-flash',
  liveModel: 'gemini-3.8-live',
  // Each model has its own free-tier quota, so falling back spreads work across free quotas.
  fallbacks: {
    fast: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'],
    smart: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']
  }
}

export class AIError extends Error {
  constructor(message, { status, retryable = false, retryAfterMs, quota = false, timeout = false } = {}) {
    super(message)
    this.name = 'AIError'
    this.status = status
    this.retryable = retryable
    this.retryAfterMs = retryAfterMs
    this.quota = quota
    this.timeout = timeout
  }
}

// How long one request may take before DoTask gives up on that model and tries the next free one.
export const TIMEOUTS = { fast: 45000, smart: 150000, streamIdle: 60000 }

/** Convert a standard JSON schema (lowercase types) into Gemini's responseSchema dialect. */
export function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s
  const out = {}
  if (s.type) out.type = String(Array.isArray(s.type) ? s.type.find(t => t !== 'null') : s.type).toUpperCase()
  if (Array.isArray(s.type) && s.type.includes('null')) out.nullable = true
  if (s.nullable) out.nullable = true
  if (s.description) out.description = s.description
  if (s.enum) out.enum = s.enum.map(String)
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]))
    out.propertyOrdering = Object.keys(s.properties)
  }
  if (s.required) out.required = s.required
  if (s.items) out.items = toGeminiSchema(s.items)
  return out
}

function thinkingFor(model, tier) {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: tier === 'smart' ? 512 : 0 }
  if (/^gemini-3/.test(model) && !/pro/.test(model)) return { thinkingLevel: tier === 'smart' ? 'LOW' : 'MINIMAL' }
  return undefined
}

function parseRetryDelay(body) {
  const details = body?.error?.details || []
  for (const d of details) {
    if (d.retryDelay) {
      const m = String(d.retryDelay).match(/([\d.]+)s/)
      if (m) return Math.ceil(Number(m[1]) * 1000)
    }
  }
  return undefined
}

function friendlyGeminiError(status, body, model) {
  const msg = body?.error?.message || `HTTP ${status}`
  if (status === 400 && /API key/i.test(msg)) return new AIError('Your Gemini API key is not valid. Open Settings and paste a key from aistudio.google.com/apikey.', { status })
  if (status === 403) return new AIError(`Gemini refused the request: ${msg}`, { status })
  if (status === 404) return new AIError(`Model “${model}” is not available to your key. Open Settings → Load models and pick another.`, { status, quota: true })
  if (status === 429) {
    const perDay = /per.?day|daily/i.test(JSON.stringify(body || {}))
    return new AIError(perDay ? `Daily free limit reached for ${model}.` : `Rate limit reached for ${model}.`,
      { status, retryable: !perDay, quota: true, retryAfterMs: parseRetryDelay(body) })
  }
  if (status >= 500) return new AIError(`Gemini is busy (${status}). Retrying…`, { status, retryable: true })
  return new AIError(msg, { status })
}

async function readSSE(response, onEvent, signal) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      if (signal?.aborted) { reader.cancel().catch(() => {}); throw Object.assign(new Error('Stopped'), { name: 'AbortError' }) }
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '')
        const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')
        if (data && data !== '[DONE]') {
          try { onEvent(JSON.parse(data)) } catch (e) { if (e instanceof AIError) throw e }
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }
}

export class AIClient {
  /**
   * @param {object} settings resolved settings (see settings.js)
   * @param {{ onUsage?: Function, fetchImpl?: Function }} [opts]
   */
  constructor(settings, { onUsage, fetchImpl } = {}) {
    this.s = settings
    this.onUsage = onUsage
    this.fetch = fetchImpl || ((...a) => fetch(...a))
    this.noThinking = new Set()
  }

  get provider() { return this.s.provider === 'openai' ? 'openai' : 'gemini' }
  get supportsNativeMedia() { return this.provider === 'gemini' }
  get supportsLive() { return this.provider === 'gemini' && !!this.s.geminiApiKey }

  modelFor(tier) {
    return tier === 'smart' ? this.s.smartModel : this.s.fastModel
  }

  isConfigured() {
    return this.provider === 'gemini' ? !!this.s.geminiApiKey : !!this.s.openaiBaseUrl
  }

  /**
   * @param {{tier?: 'fast'|'smart', system?: string, prompt?: string, messages?: Array, schema?: object,
   *          temperature?: number, maxTokens?: number, signal?: AbortSignal, onText?: (delta: string, full: string) => void}} req
   * @returns {Promise<{text: string, json?: any, model: string}>}
   */
  async generate(req) {
    if (!this.isConfigured()) {
      throw new AIError(this.provider === 'gemini'
        ? 'Add your free Gemini API key in Settings first (aistudio.google.com/apikey).'
        : 'Set your OpenAI-compatible base URL in Settings first.')
    }
    const messages = req.messages || [{ role: 'user', parts: [{ text: req.prompt || '' }] }]
    const tier = req.tier || 'fast'
    const primary = this.modelFor(tier)
    const chain = this.provider === 'gemini' && this.s.useFallbacks !== false
      ? [primary, ...GEMINI_DEFAULTS.fallbacks[tier === 'smart' ? 'smart' : 'fast']].filter((m, i, a) => m && a.indexOf(m) === i)
      : [primary]
    let lastErr
    for (const [i, model] of chain.entries()) {
      const isLast = i === chain.length - 1
      try {
        const r = await this.#withRetry(() => this.provider === 'gemini'
          ? this.#gemini(model, tier, messages, req)
          : this.#openai(model, messages, req), req.signal, isLast)
        if (req.schema) r.json = parseJsonLoose(r.text)
        return r
      } catch (e) {
        if (isAbort(e)) throw e
        lastErr = e
        if (!(e instanceof AIError && (e.quota || e.timeout))) throw e
        // quota, model unavailable or too slow: try the next free model in the chain
      }
    }
    throw lastErr
  }

  async #withRetry(fn, signal, waitOnQuota = true) {
    let attempt = 0
    while (true) {
      try {
        return await fn()
      } catch (e) {
        if (isAbort(e) || !(e instanceof AIError) || !e.retryable || attempt >= 2) throw e
        if (e.quota && !waitOnQuota) throw e // switch to the next free model instead of waiting
        attempt++
        await sleep(Math.min(e.retryAfterMs || 1500 * 2 ** attempt, 20000), signal)
      }
    }
  }

  async #gemini(model, tier, messages, req) {
    const contents = messages.map(m => ({
      role: m.role === 'model' || m.role === 'assistant' ? 'model' : 'user',
      parts: m.parts.map(p => p.inline ? { inlineData: { mimeType: p.inline.mimeType, data: p.inline.data } } : { text: String(p.text ?? '') })
    }))
    const generationConfig = {
      temperature: req.temperature ?? (req.schema ? 0.2 : 0.7),
      maxOutputTokens: req.maxTokens || 4096
    }
    if (req.schema) {
      generationConfig.responseMimeType = 'application/json'
      generationConfig.responseSchema = toGeminiSchema(req.schema)
    }
    const thinking = this.noThinking.has(model) ? undefined : thinkingFor(model, tier)
    if (thinking) generationConfig.thinkingConfig = thinking
    const body = { contents, generationConfig }
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] }

    const stream = typeof req.onText === 'function'
    const url = `${GEMINI}/models/${encodeURIComponent(model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`

    // Our own controller: the caller's Stop button still works, and a silent network or model
    // gives up after a while instead of hanging forever. Streams only time out when they go quiet.
    if (req.signal?.aborted) throw Object.assign(new Error('Stopped'), { name: 'AbortError' })
    const ctl = new AbortController()
    const onStop = () => ctl.abort()
    req.signal?.addEventListener('abort', onStop, { once: true })
    const limit = stream ? TIMEOUTS.streamIdle : (tier === 'smart' ? TIMEOUTS.smart : TIMEOUTS.fast)
    let timedOut = false
    let timer
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort() }, limit) }
    const done = () => { clearTimeout(timer); req.signal?.removeEventListener('abort', onStop) }
    arm()

    let text = ''
    let usage
    try {
      const res = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.s.geminiApiKey },
        body: JSON.stringify(body),
        signal: ctl.signal
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        if (res.status === 400 && thinking && /thinking/i.test(errBody?.error?.message || '')) {
          this.noThinking.add(model)
          done()
          return this.#gemini(model, tier, messages, req)
        }
        throw friendlyGeminiError(res.status, errBody, model)
      }
      const take = (chunk) => {
        if (chunk.promptFeedback?.blockReason) throw new AIError(`Gemini blocked this request (${chunk.promptFeedback.blockReason}).`)
        const cand = chunk.candidates?.[0]
        const delta = (cand?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('')
        if (delta) { text += delta; if (stream) req.onText(delta, text) }
        if (cand?.finishReason === 'SAFETY' && !text) throw new AIError('Gemini declined to answer this for safety reasons.')
        if (chunk.usageMetadata) usage = chunk.usageMetadata
      }
      if (stream) await readSSE(res, (chunk) => { arm(); take(chunk) }, ctl.signal)
      else take(await res.json())
    } catch (e) {
      if (timedOut && !req.signal?.aborted) {
        throw new AIError(`${model} did not answer within ${Math.round(limit / 1000)} seconds.`, { timeout: true })
      }
      throw e
    } finally {
      done()
    }
    this.onUsage?.({
      provider: 'gemini', model,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0)
    })
    if (!text) throw new AIError('The AI returned an empty answer. Try again.', { retryable: true })
    return { text, model }
  }

  async #openai(model, messages, req) {
    const base = String(this.s.openaiBaseUrl || '').replace(/\/+$/, '')
    const out = []
    let system = req.system || ''
    if (req.schema) system += `\n\nReply ONLY with a JSON object matching this JSON schema:\n${JSON.stringify(req.schema)}`
    if (system) out.push({ role: 'system', content: system.trim() })
    for (const m of messages) {
      const role = m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user'
      const parts = []
      for (const p of m.parts) {
        if (p.inline && /^image\//.test(p.inline.mimeType)) parts.push({ type: 'image_url', image_url: { url: `data:${p.inline.mimeType};base64,${p.inline.data}` } })
        else if (p.inline) parts.push({ type: 'text', text: `[Attached ${p.inline.mimeType} could not be sent to this provider]` })
        else parts.push({ type: 'text', text: String(p.text ?? '') })
      }
      out.push({ role, content: parts.every(p => p.type === 'text') ? parts.map(p => p.text).join('\n') : parts })
    }
    const stream = typeof req.onText === 'function'
    const body = {
      model, messages: out, stream,
      temperature: req.temperature ?? (req.schema ? 0.2 : 0.7),
      max_tokens: req.maxTokens || 4096
    }
    if (req.schema) body.response_format = { type: 'json_object' }
    const headers = { 'Content-Type': 'application/json' }
    if (this.s.openaiApiKey) headers.Authorization = `Bearer ${this.s.openaiApiKey}`
    const res = await this.fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: req.signal })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new AIError(`AI provider error ${res.status}: ${t.slice(0, 300)}`, {
        status: res.status, retryable: res.status === 429 || res.status >= 500
      })
    }
    let text = ''
    let usage
    if (stream) {
      await readSSE(res, (chunk) => {
        const delta = chunk.choices?.[0]?.delta?.content || ''
        if (delta) { text += delta; req.onText(delta, text) }
        if (chunk.usage) usage = chunk.usage
      }, req.signal)
    } else {
      const j = await res.json()
      text = j.choices?.[0]?.message?.content || ''
      usage = j.usage
    }
    this.onUsage?.({ provider: 'openai', model, inputTokens: usage?.prompt_tokens || 0, outputTokens: usage?.completion_tokens || 0 })
    if (!text) throw new AIError('The AI returned an empty answer.', { retryable: true })
    return { text, model }
  }

  async listModels() {
    if (this.provider === 'gemini') {
      const res = await this.fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': this.s.geminiApiKey } })
      if (!res.ok) throw friendlyGeminiError(res.status, await res.json().catch(() => null), 'models')
      const j = await res.json()
      return (j.models || []).map(m => ({
        id: m.name.replace(/^models\//, ''),
        label: m.displayName || m.name,
        text: (m.supportedGenerationMethods || []).includes('generateContent'),
        live: (m.supportedGenerationMethods || []).includes('bidiGenerateContent')
      }))
    }
    const base = String(this.s.openaiBaseUrl || '').replace(/\/+$/, '')
    const headers = this.s.openaiApiKey ? { Authorization: `Bearer ${this.s.openaiApiKey}` } : {}
    const res = await this.fetch(`${base}/models`, { headers })
    if (!res.ok) throw new AIError(`Could not list models (${res.status}).`)
    const j = await res.json()
    return (j.data || j.models || []).map(m => ({ id: m.id || m.name, label: m.id || m.name, text: true, live: false }))
  }
}

export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICES[model]
  if (!p) return 0
  return (inputTokens * p[0] + outputTokens * p[1]) / 1e6
}
