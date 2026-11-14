// "Settings" tab.

import { AIClient, GEMINI_DEFAULTS } from '../lib/ai.js'
import { saveSettings, getUsage } from '../lib/settings.js'
import { VOICES } from '../lib/live.js'
import { exportAll, importAll, wipeAll, recentAudit } from '../lib/db.js'
import { getFolders, addFolder, removeFolder, permissionState, unlockFolders, filesSupported } from '../lib/localfiles.js'
import { hasNativePermission, requestNativePermission } from '../lib/tabs.js'
import { h, toast, select, field, replace, confirmDialog, spinner } from '../lib/ui.js'
import { platform } from '../lib/platform.js'
import { signOutCanvas } from '../lib/canvas.js'

const PRESETS = [
  ['Ollama (free, runs on this PC, most private)', 'http://localhost:11434/v1'],
  ['LM Studio (free, on this PC)', 'http://localhost:1234/v1'],
  ['Groq (free tier, very fast)', 'https://api.groq.com/openai/v1'],
  ['OpenRouter (many free models)', 'https://openrouter.ai/api/v1'],
  ['OpenAI', 'https://api.openai.com/v1']
].filter(([, url]) => !platform.phone || url.startsWith('https://')) // a phone cannot reach this PC's localhost

export function mount(root, ctx) {
  const wrap = h('div', { class: 'scroll' })
  root.append(wrap)
  let models = []

  const save = async (patch) => { ctx.settings = await saveSettings(patch) }
  const s = () => ctx.settings

  function input(key, attrs = {}, transform = (v) => v) {
    const el = h('input', { class: 'input', value: s()[key] ?? '', ...attrs })
    el.addEventListener('change', () => save({ [key]: transform(el.value) }).then(() => toast('Saved', 'ok', 900)))
    return el
  }
  function area(key, attrs = {}) {
    const el = h('textarea', { class: 'input', rows: 3, value: s()[key] ?? '', ...attrs })
    el.addEventListener('change', () => save({ [key]: el.value }).then(() => toast('Saved', 'ok', 900)))
    return el
  }
  function check(key, label, hint, onTrue) {
    const el = h('input', { type: 'checkbox', checked: !!s()[key] })
    el.addEventListener('change', async () => {
      if (el.checked && onTrue && !(await onTrue())) { el.checked = false; return }
      await save({ [key]: el.checked })
    })
    return h('label', { class: 'check' }, el, h('span', null, label, hint ? h('span', { class: 'hint' }, hint) : ''))
  }
  function secret(key, placeholder) {
    const el = input(key, { type: 'password', placeholder, autocomplete: 'off', spellcheck: false }, (v) => v.trim())
    return h('div', { class: 'row gap-s' }, el, h('button', { class: 'icon-btn', title: 'Show / hide', onclick: () => { el.type = el.type === 'password' ? 'text' : 'password' } }, '👁'))
  }
  const card = (title, ...children) => h('div', { class: 'card' }, h('h3', null, title), ...children)

  async function render() {
    const st = s()
    const usage = await getUsage().catch(() => null)
    const ai = new AIClient(st)
    const datalist = h('datalist', { id: 'model-list' }, models.filter(m => m.text).map(m => h('option', { value: m.id }, m.label)))
    const liveList = h('datalist', { id: 'live-list' }, models.filter(m => m.live).map(m => h('option', { value: m.id }, m.label)))
    const testOut = h('div', { class: 'small', style: { marginTop: '6px' } })

    const aiCard = st.locked ? card('AI', h('p', { class: 'small muted' }, 'Your organization manages the AI settings.')) : card('AI brain',
      h('div', { class: 'seg', style: { marginBottom: '10px' } },
        [['gemini', 'Google Gemini (free)'], ['openai', 'Other / local']].map(([id, label]) => h('button', {
          'aria-pressed': String(st.provider === id),
          onclick: async () => {
            const patch = { provider: id }
            if (id === 'openai' && /^gemini/.test(st.fastModel)) Object.assign(patch, { fastModel: '', smartModel: '' })
            if (id === 'gemini' && !/^gemini/.test(st.fastModel)) Object.assign(patch, { fastModel: GEMINI_DEFAULTS.fastModel, smartModel: GEMINI_DEFAULTS.smartModel })
            models = []
            await save(patch); render()
          }
        }, label))),
      st.provider === 'gemini' ? [
        field('Gemini API key', secret('geminiApiKey', 'Paste your key (starts with AIza…)'),
          h('span', null, 'Free: ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank' }, 'aistudio.google.com/apikey'), platform.phone
            ? ` → Create API key. The key is kept in this ${platform.kind === 'android' ? 'phone’s Android Keystore' : 'device’s Keychain'}.`
            : ' → Create API key. The key stays in this browser only.')),
        check('freeTierKey', 'This is a free-tier key', 'Free-tier requests may be used by Google to improve its models. For student records, a paid-tier key costs pennies per class and keeps data out of training.'),
        platform.phone ? check('aiConsent', 'Allow DoTask to send my requests to Google Gemini', 'Needed for every AI feature. Sent only when you use one: what you ask, files and photos you add, your voice in voice mode, camera pictures while “Show my camera” is on, and student work with names left out.') : ''
      ] : [
        field('Server', select([['', 'Choose a preset…'], ...PRESETS.map(([l, u]) => [u, l])], '', async (v) => { if (v) { await save({ openaiBaseUrl: v }); render() } })),
        field('Base URL', input('openaiBaseUrl', { placeholder: 'http://localhost:11434/v1' }, (v) => v.trim())),
        field('API key (if the server needs one)', secret('openaiApiKey', 'optional for Ollama / LM Studio'))
      ],
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary sm', onclick: async () => {
          replace(testOut, spinner(), ' Testing…')
          try {
            const r = await ctx.ai().generate({ tier: 'fast', prompt: 'Reply with exactly: DoTask is ready', maxTokens: 20 })
            replace(testOut, h('span', { style: { color: 'var(--ok)' } }, `✓ Works (${r.model}): ${r.text.trim().slice(0, 60)}`))
            if (!st.onboarded) await save({ onboarded: true })
          } catch (e) { replace(testOut, h('span', { style: { color: 'var(--danger)' } }, `✗ ${e.message}`)) }
        } }, 'Test connection'),
        h('button', { class: 'btn sm', onclick: async () => {
          replace(testOut, spinner(), ' Loading models…')
          try { models = await ctx.ai().listModels(); toast(`${models.length} models available`, 'ok'); render() } catch (e) { replace(testOut, h('span', { style: { color: 'var(--danger)' } }, e.message)) }
        } }, 'Load models')),
      testOut,
      h('details', { style: { marginTop: '10px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'Models'),
        h('div', { style: { marginTop: '8px' } },
          datalist, liveList,
          field(platform.pages ? 'Fast model (web tasks, quick answers)' : 'Fast model (quick answers)', input('fastModel', { list: 'model-list' }, (v) => v.trim())),
          field('Smart model (grading, tutoring, writing)', input('smartModel', { list: 'model-list' }, (v) => v.trim())),
          st.provider === 'gemini' ? field('Live voice model', input('liveModel', { list: 'live-list' }, (v) => v.trim()), 'Used for the real-time voice tutor.') : '',
          st.provider === 'gemini' ? check('useFallbacks', 'Switch to another free model when a limit is reached', 'Each Gemini model has its own free daily quota.') : '')))

    const voiceCard = card('Voice & language',
      field('Language you want DoTask to speak and write', input('language', { placeholder: 'English' })),
      field('Tutor voice', select(VOICES, st.voiceName, (v) => save({ voiceName: v }))),
      field(`Read-aloud speed (${st.speechRate})`, h('input', { type: 'range', min: 0.7, max: 1.6, step: 0.05, value: st.speechRate, style: { width: '100%' }, onchange: (e) => save({ speechRate: Number(e.target.value) }).then(render) })))

    const agentCard = !platform.pages ? '' : card('Web tasks',
      field('Default permission', select([['review', 'Review every action'], ['smart', 'Ask before risky actions (recommended)'], ...(st.allowAutopilot ? [['auto', 'Full autopilot']] : [])], st.permissionMode, (v) => save({ permissionMode: v }))),
      field('Maximum steps per task', input('maxSteps', { type: 'number', min: 3, max: 200 }, (v) => Math.max(3, Math.min(200, Number(v) || 40)))),
      field('Screenshots', select([['auto', 'When needed (cheapest)'], ['always', 'Every step (best for tricky sites)'], ['never', 'Never (text only)']], st.vision, (v) => save({ vision: v }))),
      check('nativeInput', 'Trusted clicks & typing', 'For strict sites that ignore normal clicks. Chrome shows a “DoTask is debugging this browser” bar while a task runs.', async () => {
        if (await hasNativePermission()) return true
        return requestNativePermission()
      }))

    const teachCard = card('Teaching',
      field('Your name / sign-off', input('teacherName', { placeholder: 'e.g. Ms. Rivera' })),
      field('How you like to grade', area('gradingStyle', { placeholder: 'e.g. Focus on ideas over grammar. Be generous with partial credit. Always suggest one next step.' })),
      field('Feedback tone', input('feedbackTone')),
      field('Feedback length', select([['short', 'Short'], ['medium', 'Medium'], ['long', 'Detailed']], st.feedbackLength, (v) => save({ feedbackLength: v }))),
      platform.canvasViaTab
        ? h('details', null, h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'Canvas access token (optional)'),
          h('p', { class: 'hint' }, 'Not needed — DoTask uses your signed-in Canvas tab. Use a token only if you want Canvas access without an open tab (Canvas → Account → Settings → New access token).'),
          field('Canvas URL', input('canvasUrl', { placeholder: 'https://yourschool.instructure.com' }, (v) => v.trim())),
          field('Token', secret('canvasToken', 'Canvas access token')))
        : phoneCanvas())

    // Phones: show which Canvas is connected, and sign out (deletes the token on the Canvas side too)
    function phoneCanvas() {
      const signedIn = st.canvasDemo ? 'Demo School (sample data)'
        : st.canvasRefreshToken || st.canvasToken ? `${st.canvasUrl || 'Canvas'}${st.canvasToken && !st.canvasRefreshToken ? ' (personal token)' : ''}` : ''
      return h('div', { style: { marginTop: '8px' } },
        h('div', { class: 'small', style: { fontWeight: 600 } }, 'Canvas'),
        h('p', { class: 'hint' }, signedIn ? `Connected: ${signedIn}` : 'Not connected. Connect on the Teach screen.'),
        signedIn ? h('button', { class: 'btn sm', onclick: async () => {
          if (!(await confirmDialog({ title: st.canvasDemo ? 'Leave Demo School?' : 'Sign out of Canvas?', body: 'Your student history stays on this device.', ok: st.canvasDemo ? 'Leave demo' : 'Sign out' }))) return
          if (!st.canvasDemo) await signOutCanvas(st)
          await save(st.canvasDemo ? { canvasDemo: false } : { canvasRefreshToken: '', canvasToken: '', canvasClientSecret: '' })
          toast(st.canvasDemo ? 'Left Demo School' : 'Signed out of Canvas', 'ok')
          render()
        } }, st.canvasDemo ? 'Leave Demo School' : 'Sign out of Canvas') : '',
        platform.internal ? h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'small', style: { cursor: 'pointer' } }, 'Testing: personal access token'),
          field('Canvas URL', input('canvasUrl', { placeholder: 'https://yourschool.instructure.com', inputmode: 'url', autocapitalize: 'off', spellcheck: false }, (v) => v.trim())),
          field('Token', secret('canvasToken', 'Canvas access token'))) : '')
    }

    const filesBox = h('div')
    const filesCard = !platform.folders ? '' : card('My files',
      h('p', { class: 'small muted' }, 'Give DoTask access to folders on this computer (for example Documents\\Teaching). It can then open Word, PowerPoint, Excel and PDF files and save new Word documents there. It cannot see anything outside these folders, and it never overwrites a file.'),
      filesBox)
    renderFiles(filesBox)

    const usageCard = card('Usage',
      usage ? h('dl', { class: 'kv' },
        h('dt', null, 'Today'), h('dd', null, `${usage.today.requests} AI requests · ${Math.round((usage.today.input + usage.today.output) / 1000)}k tokens`),
        h('dt', null, 'This month'), h('dd', null, `${usage.month.requests} requests · ${Math.round((usage.month.input + usage.month.output) / 1000)}k tokens`),
        h('dt', null, 'Cost'), h('dd', null, st.provider === 'gemini' && st.freeTierKey ? '$0 (free tier)' : `≈ $${usage.month.cost.toFixed(2)} this month at list price`)) : '')

    const auditBox = h('div', { class: 'audit hidden' })
    const dataCard = card('Your data',
      h('p', { class: 'small muted' }, platform.phone
        ? 'Everything (student history, drafts, study files, settings) is stored only on this device. There is no DoTask server.'
        : 'Everything (student history, drafts, study files, settings) is stored only in this browser. There is no DoTask server.'),
      h('div', { class: 'row gap-s wrap' },
        h('button', { class: 'btn sm', onclick: async () => {
          const data = await exportAll()
          const name = `dotask-backup-${new Date().toISOString().slice(0, 10)}.json`
          if (platform.share) return platform.share({ title: name, file: { name, bytes: new TextEncoder().encode(JSON.stringify(data)), mimeType: 'application/json' } })
          const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
          const a = h('a', { href: url, download: name })
          document.body.append(a); a.click(); a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 5000)
        } }, '⬇ Back up'),
        h('button', { class: 'btn sm', onclick: () => {
          const f = h('input', { type: 'file', accept: '.json' })
          f.addEventListener('change', async () => {
            try { const n = await importAll(JSON.parse(await f.files[0].text())); toast(`Restored ${n} records`, 'ok') } catch (e) { toast(e.message, 'error') }
          })
          f.click()
        } }, '⬆ Restore'),
        h('button', { class: 'btn sm', onclick: async () => {
          auditBox.classList.toggle('hidden')
          const rows = await recentAudit(150)
          replace(auditBox, rows.length ? rows.map(r => h('div', null, h('strong', null, new Date(r.ts).toLocaleString()), ` · ${r.action}`, r.goal ? ` · ${r.goal.slice(0, 80)}` : '', r.desc ? ` · ${r.desc}` : '', r.userId ? ` · student ${r.userId}` : '')) : 'No activity yet.')
        } }, '🧾 Activity log'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!(await confirmDialog({ title: 'Delete all DoTask data?', body: `Student history, drafts, study files and the activity log will be erased from this ${platform.phone ? 'device' : 'browser'}. Settings and your AI key stay.`, ok: 'Delete everything', danger: true, typeToConfirm: 'DELETE' }))) return
          await wipeAll(); toast('All data deleted', 'ok')
        } }, 'Delete all')),
      auditBox)

    const about = h('p', { class: 'small muted', style: { textAlign: 'center', margin: '14px 0 4px' } },
      `DoTask ${platform.version()} · AI runs with your own key · `,
      platform.phone ? (platform.kind === 'android' ? 'Android app' : platform.kind === 'ios' ? 'iPhone & iPad app' : 'Phone app')
        : st.managedKeys.length ? `Managed by your organization (${st.managedKeys.length} policies)` : 'Personal edition',
      platform.phone ? [' · ', h('a', { href: 'https://dotask5.web.app/privacy.html', target: '_blank' }, 'Privacy')] : '')

    replace(wrap, ctx.setupCard() ? h('div', { class: 'notice', style: { marginBottom: '10px' } }, 'Start here: paste a free Gemini key below and press “Test connection”.') : '',
      aiCard, voiceCard, agentCard, teachCard, filesCard, usageCard, dataCard, about)
  }

  async function renderFiles(box) {
    if (!filesSupported()) return replace(box, h('p', { class: 'small' }, 'Folder access is not available in this browser.'))
    const folders = await getFolders()
    const rows = []
    for (const f of folders) {
      const state = await permissionState(f, true)
      rows.push(h('div', { class: 'item', style: { cursor: 'default' } },
        h('span', null, '📁'),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, f.name), h('div', { class: 'sub' }, state === 'granted' ? 'Access allowed' : 'Locked — click Allow (Chrome asks once per session)')),
        state !== 'granted' ? h('button', { class: 'btn sm', onclick: async () => { await unlockFolders(true); renderFiles(box) } }, 'Allow') : '',
        h('button', { class: 'btn ghost sm', onclick: async () => { await removeFolder(f.id); renderFiles(box) } }, 'Remove')))
    }
    replace(box, rows.length ? h('div', { class: 'list' }, rows) : '',
      h('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: async () => {
        try { const f = await addFolder(); toast(`Added ${f.name}`, 'ok'); renderFiles(box) } catch (e) {
          if (e.name === 'AbortError') return
          platform.openPermissionPage('?folder=1')
        }
      } }, '+ Add folder'))
  }

  render()
  return { onShow: () => render(), onSettings: () => {} }
}
