// "Teach" tab: Canvas grading assistant, per-student history, Inbox and Discussions.

import { Canvas, flattenEntries, rememberCanvasSignIn } from '../lib/canvas.js'
import { draftGrade, postDraft, syncSubmissions, needsGrading, userKeyOf } from '../lib/grader.js'
import { draftReply, improveText, TONES } from '../lib/compose.js'
import { db, draftsForAssignment, feedbackForStudent, getStudent, setStudentNotes, upsertStudent, saveDraft, audit, addFeedback } from '../lib/db.js'
import { h, md, toast, spinner, avatar, select, empty, confirmDialog, replace, field } from '../lib/ui.js'
import { saveSettings } from '../lib/settings.js'
import { platform } from '../lib/platform.js'
import { colorFor, fmtDate, htmlToText, isAbort, textToHtml, truncate, clampScore } from '../lib/util.js'
import { speak } from '../lib/speech.js'

export function mount(root, ctx) {
  const st = {
    canvas: null, sub: 'grade', courses: null, course: null, assignments: null, assignment: null,
    subs: null, drafts: new Map(), filter: 'needs', reviewIndex: null, batch: null,
    students: null, student: null, studentQuery: '', convos: null, convo: null, convoScope: 'unread',
    topics: null, topic: null, autoSynced: new Set()
  }
  const head = h('div', { class: 'pad', style: { paddingBottom: '0' } })
  const body = h('div', { class: 'scroll' })
  root.append(head, body)

  const ai = () => ctx.ai()
  const key = (o) => `${o.userId}:${o.attempt}`
  const loading = (text) => replace(body, h('div', { class: 'status-line' }, spinner(), text))
  const fail = (e, retry) => replace(body, h('div', { class: 'notice danger' }, e.message),
    retry ? h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn', onclick: retry }, 'Try again')) : '')

  // ---------------- connection ----------------
  let connecting = null
  function connect(silent = false) {
    if (!connecting) connecting = doConnect(silent).finally(() => { connecting = null })
    return connecting
  }
  async function doConnect(silent) {
    if (!silent) loading(platform.canvasViaTab ? 'Looking for your Canvas tab…' : 'Connecting to Canvas…')
    const before = st.canvas ? `${st.canvas.mode}|${st.canvas.host}|${st.canvas.me?.id}` : ''
    try {
      st.canvas = await Canvas.connect(ctx.settings)
    } catch (e) {
      st.canvas = null
      if (!platform.canvasViaTab) { renderHead(); return renderNotConnected(silent ? '' : e.message) }
      if (!silent) return fail(e, () => connect())
    }
    const after = st.canvas ? `${st.canvas.mode}|${st.canvas.host}|${st.canvas.me?.id}` : ''
    if (before && after !== before) {
      // a different Canvas (or Demo School): never show one site's courses or students on another
      Object.assign(st, { courses: null, course: null, assignments: null, assignment: null, subs: null, drafts: new Map(), reviewIndex: null,
        students: null, student: null, convos: null, convo: null, topics: null, topic: null, autoSynced: new Set() })
    }
    renderHead()
    if (!st.canvas) return renderNotConnected()
    // jump to what the teacher is looking at in Canvas
    const info = st.canvas.pageInfo
    await loadCourses()
    if (info?.courseId) {
      const course = st.courses?.find(c => String(c.id) === String(info.courseId))
      if (course) {
        if (info.section === 'assignments' && info.itemId) return openCourse(course, info.itemId, info.studentId)
        if (info.section === 'gradebook' && info.itemId) return openCourse(course, info.itemId, info.studentId)
        if (info.section === 'discussion_topics' && info.itemId) { st.sub = 'discuss'; renderHead(); st.course = course; return openTopic({ id: info.itemId, title: 'Discussion' }) }
        return openCourse(course)
      }
    }
    render()
  }

  function renderHead() {
    const c = st.canvas
    const subnav = h('div', { class: 'seg', style: { marginTop: '8px' } },
      [['grade', 'Grade'], ['students', 'Students'], ['inbox', 'Inbox'], ['discuss', 'Discuss'], ['announce', 'Announce']].map(([id, label]) =>
        h('button', { 'aria-pressed': String(st.sub === id), disabled: !c, onclick: () => { st.sub = id; renderHead(); render() } }, label)))
    replace(head,
      ctx.setupCard() || '',
      h('div', { class: 'row gap between' },
        c?.mode === 'demo' ? h('div', { class: 'small' }, h('span', { class: 'badge warn' }, '● Demo School'), ' ', h('span', { class: 'muted' }, 'Sample data — nothing is sent to a real Canvas'))
          : c ? h('div', { class: 'small' }, h('span', { class: 'badge ok' }, '● Canvas'), ' ', h('strong', null, c.me?.name || ''), h('span', { class: 'muted' }, ` · ${c.host}`))
            : h('div', { class: 'small muted' }, 'Canvas not connected'),
        c?.mode === 'demo'
          ? h('button', { class: 'btn sm', onclick: async () => { ctx.settings = await saveSettings({ canvasDemo: false }); connect() } }, 'Leave demo')
          : h('button', { class: 'btn sm', onclick: () => connect() }, c ? '⟳ Refresh' : 'Connect')),
      ctx.settings.provider === 'gemini' && ctx.settings.freeTierKey && c && c.mode !== 'demo' ? h('div', { class: 'notice warn small', style: { marginTop: '8px' } },
        'Privacy: student names are never sent to the AI, but submission text is. Google may use free-tier data to improve its models — for real student records use a paid-tier key (pennies per class) or a local model. ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.go('settings') } }, 'Settings')) : '',
      subnav)
  }

  const tryDemo = async () => { ctx.settings = await saveSettings({ canvasDemo: true }); connect() }

  function renderNotConnected(error = '') {
    if (!platform.canvasViaTab) return renderPhoneConnect(error)
    replace(body, empty('🍎', 'Connect Canvas',
      'Open your Canvas site (for example yourschool.instructure.com) in a tab in this window, sign in, then press Connect. DoTask uses your own Canvas login — no token or password needed.',
      h('button', { class: 'btn primary', onclick: () => connect() }, 'Connect'),
      h('button', { class: 'btn', onclick: () => platform.openUrl('https://canvas.instructure.com/login') }, 'Open Canvas'),
      h('button', { class: 'btn', onclick: tryDemo }, '🏫 Try Demo School')))
  }

  // Phones have no signed-in Canvas tab: the teacher signs in on their school's Canvas page
  // (OAuth with the school's developer key). DoTask never sees the password.
  function renderPhoneConnect(error) {
    const plain = { autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: false }
    const url = h('input', { class: 'input', placeholder: 'https://yourschool.instructure.com', value: ctx.settings.canvasUrl || '', inputmode: 'url', ...plain })
    const clientId = h('input', { class: 'input', placeholder: 'For example 170000000000123', value: ctx.settings.canvasClientId || '', ...plain })
    const secret = h('input', { class: 'input', type: 'password', placeholder: ctx.settings.canvasClientSecret ? 'Saved (type a new one to replace it)' : 'Only if your admin gave you one', ...plain })
    const origin = () => { try { return url.value.trim() ? new URL(/^https?:/i.test(url.value.trim()) ? url.value.trim() : `https://${url.value.trim()}`).origin : '' } catch { return '' } }
    const signInBtn = h('button', { class: 'btn primary', onclick: async () => {
      const o = origin(), id = clientId.value.trim()
      if (!o || !id) return toast('Enter your Canvas address and the Client ID from your Canvas admin.', 'warn')
      if (!/^https:/.test(o)) return toast('The Canvas address must start with https://', 'warn')
      signInBtn.disabled = true
      try {
        const sec = secret.value.trim() || ctx.settings.canvasClientSecret || ''
        const tokens = await platform.canvasAuth.signIn({ origin: o, clientId: id, clientSecret: sec })
        rememberCanvasSignIn(o, id, tokens)
        ctx.settings = await saveSettings({ canvasUrl: o, canvasClientId: id, canvasClientSecret: sec, canvasRefreshToken: tokens.refreshToken, canvasToken: '', canvasDemo: false })
        connect()
      } catch (e) {
        toast(e.message, 'error', 9000)
      } finally { signInBtn.disabled = false }
    } }, 'Sign in with Canvas')

    // personal tokens: only in internal test builds, for the owner's own account (Instructure's API policy)
    const tokenBox = platform.internal || ctx.settings.canvasToken ? (() => {
      const token = h('input', { class: 'input', type: 'password', placeholder: ctx.settings.canvasToken ? 'Saved token' : 'Canvas access token', ...plain })
      return h('details', { style: { marginTop: '12px' } }, h('summary', { class: 'small', style: { cursor: 'pointer' } }, 'Testing: personal access token (your own account only)'),
        field('Access token', token),
        h('button', { class: 'btn sm', onclick: async () => {
          const o = origin(), t = token.value.trim() || ctx.settings.canvasToken
          if (!o || !t) return toast('Enter your Canvas address and access token.', 'warn')
          ctx.settings = await saveSettings({ canvasUrl: o, canvasToken: t, canvasDemo: false })
          connect()
        } }, 'Connect with token'))
    })() : ''

    replace(body, h('div', { class: 'card canvas-connect' },
      h('h3', null, '🍎 Connect Canvas'),
      error ? h('div', { class: 'notice danger small', style: { marginBottom: '8px' } }, error) : '',
      h('p', { class: 'small' }, 'Sign in on your school’s own Canvas page. DoTask never sees your password, and you can sign out any time in Settings.'),
      field('Canvas address', url),
      field('Client ID', clientId, 'Your Canvas admin creates a DoTask developer key once for the whole school and gives you its Client ID.'),
      h('details', null, h('summary', { class: 'small', style: { cursor: 'pointer' } }, 'Client secret (only if your admin gave you one)'), field('Client secret', secret)),
      h('div', { class: 'row gap wrap', style: { marginTop: '8px' } },
        signInBtn,
        h('button', { class: 'btn', onclick: () => platform.openUrl('https://dotask5.web.app/support.html#canvas') }, 'Setup for admins')),
      tokenBox,
      h('hr', { style: { margin: '16px 0', border: 0, borderTop: '1px solid var(--line, #e3e3ea)' } }),
      h('p', { class: 'small muted' }, 'No Canvas login yet, or just looking around?'),
      h('button', { class: 'btn', onclick: tryDemo }, '🏫 Try Demo School (sample data)')))
  }

  function render() {
    if (!st.canvas) return renderNotConnected()
    if (st.sub === 'grade') return st.assignment ? renderQueue() : st.course ? renderAssignments() : renderCourses()
    if (st.sub === 'students') return st.student ? renderStudent() : renderStudents()
    if (st.sub === 'inbox') return st.convo ? renderConvo() : renderInbox()
    if (st.sub === 'discuss') return st.topic ? renderTopic() : renderTopics()
    if (st.sub === 'announce') return renderAnnounce()
  }

  // ---------------- courses ----------------
  async function loadCourses() {
    if (st.courses) return
    st.courses = await st.canvas.teachingCourses()
  }

  function courseList(onPick) {
    if (!st.courses?.length) return empty('📚', 'No courses found', 'Your Canvas account has no active courses where you teach.')
    return h('div', { class: 'list' }, st.courses.map(c => h('button', { class: 'item', onclick: () => onPick(c) },
      h('div', { class: 'grow' }, h('div', { class: 'title' }, c.name), h('div', { class: 'sub' }, [c.course_code, c.term?.name, c.total_students != null ? `${c.total_students} students` : ''].filter(Boolean).join(' · '))),
      h('span', { class: 'muted' }, '›'))))
  }

  async function renderCourses() {
    try { await loadCourses() } catch (e) { return fail(e, () => renderCourses()) }
    replace(body, h('div', { class: 'section-title' }, 'Your courses'), courseList(c => openCourse(c)))
  }

  function backBtn(label, fn) { return h('button', { class: 'btn ghost sm', onclick: fn }, `‹ ${label}`) }

  // ---------------- assignments ----------------
  async function openCourse(course, assignmentId, studentId) {
    st.course = course; st.assignment = null; st.assignments = null; st.sub = 'grade'; st.students = null; st.topics = null
    renderHead()
    loading('Loading assignments…')
    try {
      st.assignments = await st.canvas.assignments(course.id)
    } catch (e) { return fail(e, () => openCourse(course)) }
    if (assignmentId) {
      const a = st.assignments.find(x => String(x.id) === String(assignmentId))
      if (a) return openAssignment(a, studentId)
    }
    renderAssignments()
  }

  function renderAssignments() {
    const list = [...(st.assignments || [])].filter(a => a.published !== false)
      .sort((a, b) => (b.needs_grading_count || 0) - (a.needs_grading_count || 0) || new Date(b.due_at || 0) - new Date(a.due_at || 0))
    replace(body,
      h('div', { class: 'row between' }, backBtn('Courses', () => { st.course = null; render() }), h('span', { class: 'small muted' }, st.course.name)),
      h('div', { class: 'section-title' }, 'Assignments'),
      list.length ? h('div', { class: 'list' }, list.map(a => h('button', { class: 'item', onclick: () => openAssignment(a) },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, a.name),
          h('div', { class: 'sub' }, [a.points_possible != null ? `${a.points_possible} pts` : '', a.due_at ? `due ${fmtDate(a.due_at)}` : '', a.rubric ? 'rubric' : ''].filter(Boolean).join(' · '))),
        a.needs_grading_count ? h('span', { class: 'badge warn' }, `${a.needs_grading_count} to grade`) : h('span', { class: 'badge' }, '✓'))))
        : empty('📝', 'No assignments', 'This course has no published assignments yet.'))
  }

  // ---------------- grading queue ----------------
  async function openAssignment(a, focusStudentId) {
    st.assignment = a; st.reviewIndex = null
    loading('Loading submissions…')
    try {
      const [full, subs, drafts] = await Promise.all([
        st.canvas.assignment(st.course.id, a.id),
        st.canvas.submissions(st.course.id, a.id),
        draftsForAssignment(st.canvas.host, st.course.id, a.id)
      ])
      st.assignment = full
      st.subs = subs.filter(s => s.user_id != null || s.anonymous_id)
      st.drafts = new Map(drafts.map(d => [key(d), d]))
      const notes = await db.get('kv', notesKey())
      st.notes = notes?.v || ''
      // remember every student's comments locally (never mixes: keyed by Canvas user id)
      syncSubmissions({ canvas: st.canvas, course: st.course, assignment: full, subs: st.subs }).catch(() => {})
    } catch (e) { return fail(e, () => openAssignment(a)) }
    if (focusStudentId) {
      st.filter = 'all'
      const i = visibleSubs().findIndex(s => String(s.user_id) === String(focusStudentId))
      if (i >= 0) return openReview(i)
    }
    renderQueue()
  }

  const notesKey = () => `notes:${st.canvas.host}:${st.course.id}:${st.assignment.id}`
  const draftOf = (sub) => st.drafts.get(`${userKeyOf(sub)}:${Number(sub.attempt) || 0}`)
  const nameOf = (sub) => sub.user?.name || (sub.anonymous_id ? `Anonymous ${sub.anonymous_id}` : `Student ${sub.user_id}`)

  function statusOf(sub) {
    const d = draftOf(sub)
    if (d?.status === 'posted') return ['ok', `Posted ${d.postedGrade ?? ''}`]
    if (d) return ['primary', `Draft ${d.score ?? '–'}/${d.possible}`]
    if (needsGrading(sub)) return ['warn', sub.grade_matches_current_submission === false ? 'Resubmitted' : 'Needs grading']
    if (sub.workflow_state === 'graded') return ['', `Graded ${sub.grade ?? ''}`]
    return ['', 'Not submitted']
  }

  function visibleSubs() {
    const all = [...st.subs].sort((a, b) => String(a.user?.sortable_name || '').localeCompare(String(b.user?.sortable_name || '')))
    if (st.filter === 'needs') return all.filter(s => needsGrading(s) && draftOf(s)?.status !== 'posted')
    if (st.filter === 'drafts') return all.filter(s => draftOf(s) && draftOf(s).status !== 'posted')
    return all
  }

  function renderQueue() {
    const a = st.assignment
    const subs = visibleSubs()
    const notes = h('textarea', { class: 'input', rows: 2, placeholder: 'Your grading notes for this assignment (optional) — e.g. “focus on thesis and evidence; don’t take off for spelling”', value: st.notes || '' })
    notes.addEventListener('change', async () => { st.notes = notes.value; await db.put('kv', { k: notesKey(), v: notes.value }) })
    const autopost = h('input', { type: 'checkbox', checked: !!st.autopost, disabled: !ctx.settings.allowAutopilot })
    autopost.addEventListener('change', async () => {
      if (autopost.checked) {
        const ok = await confirmDialog({ title: 'Post without review?', body: 'Grades and feedback will be posted to Canvas right after the AI drafts them. You can still edit in Canvas afterwards. Recommended only after you have checked several drafts.', ok: 'Yes, auto-post', danger: true })
        autopost.checked = ok
      }
      st.autopost = autopost.checked
    })
    const counts = { needs: st.subs.filter(s => needsGrading(s) && draftOf(s)?.status !== 'posted').length, drafts: st.subs.filter(s => draftOf(s) && draftOf(s).status !== 'posted').length, all: st.subs.length }
    const batchBox = h('div')
    replace(body,
      h('div', { class: 'row between' }, backBtn('Assignments', () => { st.assignment = null; render() }),
        st.canvas.speedGraderUrl(st.course.id, a.id) ? h('a', { class: 'small', href: st.canvas.speedGraderUrl(st.course.id, a.id), target: '_blank' }, 'SpeedGrader ↗') : ''),
      h('h3', { style: { marginTop: '6px' } }, a.name),
      h('div', { class: 'small muted' }, [`${a.points_possible ?? 0} pts`, a.grading_type, a.rubric ? `rubric (${a.rubric.length} criteria)` : 'no rubric', a.anonymous_grading ? 'anonymous grading' : ''].filter(Boolean).join(' · ')),
      h('div', { style: { margin: '10px 0' } }, notes),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', disabled: !!st.batch, onclick: () => draftAll() }, `✨ Draft ${counts.needs ? counts.needs + ' ' : ''}with AI`),
        h('label', { class: 'check small', style: { margin: 0 } }, autopost, 'Auto-post (no review)')),
      batchBox,
      h('div', { class: 'seg', style: { margin: '10px 0' } },
        [['needs', `To grade (${counts.needs})`], ['drafts', `Drafts (${counts.drafts})`], ['all', `All (${counts.all})`]].map(([id, label]) =>
          h('button', { 'aria-pressed': String(st.filter === id), onclick: () => { st.filter = id; renderQueue() } }, label))),
      subs.length ? h('div', { class: 'list' }, subs.map((s, i) => {
        const [kind, label] = statusOf(s)
        const d = draftOf(s)
        return h('button', { class: 'item', onclick: () => openReview(i) },
          avatar(nameOf(s), colorFor(userKeyOf(s)), 30),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, nameOf(s)),
            h('div', { class: 'sub' }, [s.submitted_at ? `submitted ${fmtDate(s.submitted_at)}` : 'no submission', s.late ? 'LATE' : '', s.attempt > 1 ? `attempt ${s.attempt}` : '', d?.confidence != null && d.status !== 'posted' ? `${Math.round(d.confidence * 100)}% sure` : ''].filter(Boolean).join(' · '))),
          h('span', { class: `badge ${kind}` }, label))
      })) : empty('🎉', st.filter === 'needs' ? 'Nothing left to grade' : 'Nothing here', ''))
    if (st.batch) renderBatch(batchBox)
    st.batchBox = batchBox
  }

  function renderBatch(box) {
    const b = st.batch
    replace(box, h('div', { class: 'card flat', style: { marginTop: '10px' } },
      h('div', { class: 'row between small' }, h('span', null, spinner(), ` ${b.label}`), h('button', { class: 'btn sm', onclick: () => b.controller.abort() }, 'Stop')),
      h('div', { class: 'progress', style: { marginTop: '8px' } }, h('div', { style: { width: `${Math.round(100 * b.done / Math.max(1, b.total))}%` } })),
      b.errors.length ? h('div', { class: 'small', style: { color: 'var(--danger)', marginTop: '6px' } }, b.errors.slice(-3).join(' · ')) : ''))
  }

  async function draftAll() {
    const targets = st.subs.filter(s => needsGrading(s) && !draftOf(s))
    if (!targets.length) return toast('Every submission that needs grading already has a draft.', 'info')
    if (!ai().isConfigured()) return toast('Add your AI key in Settings first.', 'warn')
    const controller = new AbortController()
    st.batch = { controller, total: targets.length, done: 0, errors: [], label: '' }
    renderQueue()
    const course = st.course, assignment = st.assignment
    for (const sub of targets) {
      if (controller.signal.aborted) break
      st.batch.label = `Drafting ${st.batch.done + 1} of ${st.batch.total}: ${nameOf(sub)}`
      if (st.batchBox?.isConnected) renderBatch(st.batchBox)
      try {
        const d = await draftGrade({ ai: ai(), canvas: st.canvas, settings: ctx.settings, course, assignment, sub, instructions: st.notes, signal: controller.signal })
        st.drafts.set(key(d), d)
        if (st.autopost && ctx.settings.allowAutopilot) {
          const p = await postDraft({ canvas: st.canvas, course, assignment, draft: d })
          st.drafts.set(key(p), p)
        }
      } catch (e) {
        if (isAbort(e)) break
        st.batch.errors.push(`${nameOf(sub)}: ${e.message}`)
        if (/API key|Settings first/.test(e.message)) break
      }
      st.batch.done++
    }
    const errs = st.batch.errors.length
    st.batch = null
    toast(errs ? `Finished with ${errs} problem(s).` : 'All drafts are ready for your review.', errs ? 'warn' : 'ok')
    if (st.assignment === assignment && st.reviewIndex == null) renderQueue()
  }

  // ---------------- review one student ----------------
  async function openReview(i) {
    const list = visibleSubs()
    if (i < 0 || i >= list.length) { st.reviewIndex = null; return renderQueue() }
    st.reviewIndex = i
    const sub = list[i]
    st.reviewList = list
    const uid = userKeyOf(sub)
    const history = uid.startsWith('anon-') ? [] : await feedbackForStudent(st.canvas.host, uid)
    renderReview(sub, history.filter(r => (r.kind === 'posted' || r.kind === 'canvas-comment' || r.kind === 'grade' || r.kind === 'note') && r.userId === uid))
  }

  function renderReview(sub, history) {
    const a = st.assignment, uid = userKeyOf(sub), color = colorFor(uid)
    const list = st.reviewList, i = st.reviewIndex
    let d = draftOf(sub)
    const preview = sub.body ? truncate(htmlToText(sub.body), 4000) : ''
    const draftBox = h('div')

    const head = h('div', { class: 'student-head', style: { background: color } },
      avatar(nameOf(sub), color, 42),
      h('div', { class: 'grow' }, h('div', { class: 'name' }, nameOf(sub)),
        h('div', { class: 'meta' }, [`Canvas ID ${sub.user_id ?? 'hidden'}`, `attempt ${sub.attempt || 0}`, sub.submitted_at ? fmtDate(sub.submitted_at) : 'not submitted', sub.late ? 'LATE' : ''].filter(Boolean).join(' · '))),
      h('span', { class: 'small' }, `${i + 1}/${list.length}`))

    const subCard = h('div', { class: 'card flat' },
      h('h4', null, 'Submission'),
      preview ? h('div', { class: 'preview' }, preview) : '',
      sub.url ? h('p', { class: 'small' }, 'Link: ', h('a', { href: sub.url, target: '_blank' }, truncate(sub.url, 60))) : '',
      (sub.attachments || []).length ? h('div', { class: 'chips', style: { marginTop: '6px' } }, sub.attachments.map(f => h('a', { class: 'chip', href: f.url, target: '_blank' }, `📎 ${truncate(f.display_name, 40)}`))) : '',
      !preview && !sub.url && !(sub.attachments || []).length ? h('p', { class: 'small muted' }, sub.submission_type ? `Type: ${sub.submission_type}` : 'No submission yet.') : '',
      st.canvas.speedGraderUrl(st.course.id, a.id, sub.user_id) ? h('a', { class: 'small', href: st.canvas.speedGraderUrl(st.course.id, a.id, sub.user_id), target: '_blank' }, 'Open in SpeedGrader ↗') : '')

    function renderDraft() {
      if (!d) {
        return replace(draftBox, h('div', { class: 'card flat' },
          h('p', { class: 'small muted' }, 'No AI draft yet for this attempt.'),
          h('button', { class: 'btn primary', onclick: () => generate() }, '✨ Draft grade & feedback')))
      }
      const posted = d.status === 'posted'
      const scoreIn = h('input', { class: 'input', type: 'number', step: 'any', min: 0, value: d.score ?? '' })
      scoreIn.addEventListener('input', () => { d.score = clampScore(scoreIn.value, d.possible) })
      const rubricRows = (a.rubric || []).map(c => {
        let r = d.rubric.find(x => x.criterion_id === String(c.id))
        if (!r) { r = { criterion_id: String(c.id), points: 0, comment: '' }; d.rubric.push(r) }
        const pts = h('input', { class: 'input', type: 'number', step: 'any', min: 0, max: c.points, value: r.points })
        const com = h('input', { class: 'input', placeholder: 'criterion comment', value: r.comment || '' })
        pts.addEventListener('input', () => {
          r.points = clampScore(pts.value, c.points) ?? 0
          d.score = clampScore(d.rubric.reduce((s, x) => s + (Number(x.points) || 0), 0), d.possible)
          scoreIn.value = d.score
        })
        com.addEventListener('input', () => { r.comment = com.value })
        return h('div', { class: 'rubric-row' }, h('div', null, h('div', { class: 'crit' }, c.description, h('span', { class: 'muted' }, ` /${c.points}`)), com), pts)
      })
      const comment = h('textarea', { class: 'input', rows: 7, value: d.comment || '' })
      comment.addEventListener('input', () => { d.comment = comment.value })
      const tweak = async (how) => {
        comment.disabled = true
        try { d.comment = await improveText({ ai: ai(), settings: ctx.settings, text: comment.value, how }); comment.value = d.comment } catch (e) { toast(e.message, 'error') }
        comment.disabled = false
      }
      replace(draftBox, h('div', { class: `card ${posted ? 'flat' : 'hl'}` },
        h('div', { class: 'row gap wrap' },
          posted ? h('span', { class: 'badge ok' }, `✓ Posted ${fmtDate(d.postedAt)}`) : h('span', { class: 'badge primary' }, 'AI draft — review before posting'),
          h('span', { class: `badge ${d.confidence >= 0.75 ? 'ok' : d.confidence >= 0.5 ? 'warn' : 'danger'}` }, `${Math.round((d.confidence || 0) * 100)}% confident`),
          (d.flags || []).map(f => h('span', { class: `badge ${f === 'excellent' ? 'ok' : 'warn'}` }, f.replace(/_/g, ' ')))),
        d.privateNote ? h('div', { class: 'notice small', style: { marginTop: '8px' } }, '🔒 Note for you: ', d.privateNote) : '',
        (d.notes || []).length ? h('div', { class: 'notice warn small', style: { marginTop: '6px' } }, d.notes.join(' ')) : '',
        h('div', { class: 'row gap', style: { marginTop: '10px' } }, h('div', { class: 'score-box' }, scoreIn, h('span', { class: 'muted' }, `/ ${d.possible}`)), h('div', { class: 'grow' }),
          h('span', { class: 'small muted' }, a.grading_type !== 'points' ? a.grading_type.replace(/_/g, ' ') : '')),
        rubricRows.length ? h('div', { style: { marginTop: '8px' } }, rubricRows) : '',
        h('div', { class: 'field-label', style: { marginTop: '10px' } }, `Feedback to ${nameOf(sub).split(' ')[0]}`),
        comment,
        h('div', { class: 'row gap-s wrap', style: { marginTop: '6px' } },
          h('button', { class: 'btn sm', onclick: () => tweak('Make it shorter, keep the most useful points.') }, 'Shorter'),
          h('button', { class: 'btn sm', onclick: () => tweak('Make it warmer and more encouraging without losing the specific advice.') }, 'Warmer'),
          h('button', { class: 'btn sm', onclick: () => tweak('Make it more specific and actionable.') }, 'More specific'),
          h('button', { class: 'btn sm', onclick: () => tweak('Fix grammar and clarity only.') }, 'Polish'),
          h('button', { class: 'icon-btn sm', title: 'Read aloud', onclick: () => speak(comment.value, { language: ctx.settings.language }) }, '🔊')),
        h('div', { class: 'row gap wrap', style: { marginTop: '12px' } },
          h('button', { class: 'btn ok', onclick: () => post() }, posted ? `↻ Re-post to ${nameOf(sub).split(' ')[0]}` : `✓ Post to ${nameOf(sub).split(' ')[0]}`),
          h('button', { class: 'btn', onclick: () => save() }, 'Save'),
          h('button', { class: 'btn ghost', onclick: () => generate() }, '↻ Redo'))))
    }

    async function generate() {
      replace(draftBox, h('div', { class: 'card flat' }, h('div', { class: 'status-line' }, spinner(), `Reading ${nameOf(sub).split(' ')[0]}’s work and drafting…`)))
      try {
        d = await draftGrade({ ai: ai(), canvas: st.canvas, settings: ctx.settings, course: st.course, assignment: a, sub, instructions: st.notes })
        st.drafts.set(key(d), d)
      } catch (e) {
        replace(draftBox, h('div', { class: 'notice danger' }, e.message), h('button', { class: 'btn', style: { marginTop: '8px' }, onclick: () => generate() }, 'Try again'))
        return
      }
      renderDraft()
    }
    async function save() {
      d = await saveDraft(d); st.drafts.set(key(d), d)
      toast(`Saved draft for ${nameOf(sub)}`, 'ok')
    }
    async function post() {
      if (d.score == null && a.grading_type !== 'not_graded') return toast('Enter a score first.', 'warn')
      try {
        await saveDraft(d)
        d = await postDraft({ canvas: st.canvas, course: st.course, assignment: a, draft: d })
        st.drafts.set(key(d), d)
        sub.workflow_state = 'graded'; sub.grade = d.postedGrade; sub.grade_matches_current_submission = true
        toast(`Posted to ${nameOf(sub)} ✓`, 'ok')
        // move on to the next student
        const next = visibleSubs()
        st.reviewList = next
        if (next.length) openReview(Math.min(i, next.length - 1))
        else renderQueue()
      } catch (e) { toast(e.message, 'error', 7000) }
    }

    // the submission's comment thread, with a reply box when the student wrote something
    const comments = (sub.submission_comments || []).slice().sort((x, y) => new Date(x.created_at) - new Date(y.created_at))
    const isStudent = (c) => sub.user_id != null && String(c.author_id) === String(sub.user_id)
    const replyHolder = h('div')
    const first = String(nameOf(sub)).split(/\s+/)[0]
    const openReply = () => {
      // names stay out of the AI request: the thread says "Student" and "Me"
      const thread = comments.map(c => `${isStudent(c) ? 'Student' : 'Me'} (${fmtDate(c.created_at)}): ${c.comment}`).join('\n\n')
      replace(replyHolder, replyEditor({
        kind: 'reply to a student comment on their Canvas assignment',
        original: thread,
        context: `Assignment: ${a.name}.${d?.comment ? `\nMy feedback on this submission: ${truncate(d.comment, 1500)}` : ''}`,
        sendLabel: `Send to ${first}`,
        intentPlaceholder: 'What do you want to tell them? (optional)',
        onSend: async (text) => {
          const ok = await confirmDialog({ title: `Send this comment to ${nameOf(sub)}?`, body: truncate(text, 500), ok: `Send to ${first}` })
          if (!ok) return
          // make sure the comment lands on this exact student's submission
          const fresh = await st.canvas.submission(st.course.id, a.id, sub.user_id)
          if (String(fresh.user_id) !== String(sub.user_id)) throw new Error('Student check failed, so nothing was sent.')
          await st.canvas.grade(st.course.id, a.id, { userId: sub.user_id, comment: text })
          await addFeedback({
            host: st.canvas.host, userId: uid, kind: 'posted', courseId: String(st.course.id), courseName: st.course.name,
            assignmentId: String(a.id), assignmentName: a.name, text, authorId: st.canvas.me?.id, author: st.canvas.me?.name
          })
          await audit('comment.reply', { courseId: st.course.id, assignmentId: a.id, userId: uid })
          toast(`Comment sent to ${first}`, 'ok')
          try {
            const updated = await st.canvas.submission(st.course.id, a.id, sub.user_id)
            const k = st.subs.indexOf(sub)
            if (k >= 0 && String(updated.user_id) === String(sub.user_id)) st.subs[k] = { ...sub, submission_comments: updated.submission_comments }
          } catch {}
          openReview(i)
        }
      }))
    }
    const commentsBox = comments.length || sub.user_id != null ? h('div', { class: 'card flat' },
      h('div', { class: 'row between' }, h('h4', { style: { margin: 0 } }, `Comments${comments.length ? ` (${comments.length})` : ''}`),
        sub.user_id != null ? h('button', { class: 'btn sm', onclick: openReply }, comments.some(isStudent) ? `↩ Reply to ${first}` : `💬 Comment to ${first}`) : ''),
      comments.length ? h('div', { class: 'chat', style: { marginTop: '8px' } }, comments.map(c =>
        h('div', { class: `msg ${isStudent(c) ? 'ai' : 'user'}` },
          h('div', { class: 'small', style: { opacity: 0.8, marginBottom: '2px' } }, `${c.author_name || (isStudent(c) ? first : 'You')} · ${fmtDate(c.created_at)}`),
          c.comment))) : '',
      replyHolder) : ''

    const historyBox = history.length ? h('details', { class: 'card flat' },
      h('summary', { style: { cursor: 'pointer', fontWeight: 650 } }, `Earlier feedback for ${nameOf(sub)} (${history.length})`),
      h('div', { class: 'timeline', style: { marginTop: '8px' } }, history.slice(0, 15).map(r => tlItem(r)))) : ''

    replace(body,
      h('div', { class: 'row between' }, backBtn('Queue', () => { st.reviewIndex = null; renderQueue() }),
        h('div', { class: 'row gap-s' },
          h('button', { class: 'btn sm', disabled: i === 0, onclick: () => openReview(i - 1) }, '‹ Prev'),
          h('button', { class: 'btn sm', disabled: i >= list.length - 1, onclick: () => openReview(i + 1) }, 'Next ›'))),
      h('div', { class: 'stack', style: { marginTop: '8px' } }, head, subCard, draftBox, commentsBox, historyBox))
    renderDraft()
  }

  function tlItem(r) {
    const title = r.kind === 'grade' ? `${r.assignmentName || 'Assignment'} — grade ${r.grade ?? r.score ?? ''}${r.possible ? ` (of ${r.possible} pts)` : ''}`
      : `${r.assignmentName || ''}${r.kind === 'posted' ? ' · you posted' : r.author ? ` · ${r.author}` : ''}${r.grade ? ` · ${r.grade}` : ''}`
    return h('div', { class: `tl-item ${r.kind === 'grade' ? 'grade' : ''}` },
      h('div', { class: 'when' }, `${fmtDate(r.createdAt)} · ${r.courseName || ''}`),
      h('div', { style: { fontWeight: 600, fontSize: '13px' } }, title),
      r.text ? h('div', { class: 'body' }, r.text) : '')
  }

  // ---------------- students ----------------
  async function renderStudents() {
    if (!st.course) {
      try { await loadCourses() } catch (e) { return fail(e, () => renderStudents()) }
      return replace(body, h('div', { class: 'section-title' }, 'Pick a course'), courseList(async c => { st.course = c; st.students = null; renderStudents() }))
    }
    if (!st.students) {
      loading('Loading students…')
      try { st.students = await st.canvas.students(st.course.id) } catch (e) { return fail(e, () => renderStudents()) }
      for (const s of st.students) upsertStudent({ host: st.canvas.host, userId: s.id, name: s.name, sortableName: s.sortable_name, avatarUrl: s.avatar_url, courseId: st.course.id, courseName: st.course.name }).catch(() => {})
    }
    const q = h('input', { class: 'input', placeholder: 'Search students…', value: st.studentQuery })
    const listBox = h('div', { class: 'list', style: { marginTop: '8px' } })
    const draw = () => {
      const s = q.value.toLowerCase()
      st.studentQuery = q.value
      replace(listBox, st.students.filter(x => !s || x.name.toLowerCase().includes(s) || String(x.id) === s).map(x =>
        h('button', { class: 'item', onclick: () => openStudent(x) }, avatar(x.name, colorFor(x.id), 30),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, x.name), h('div', { class: 'sub' }, `Canvas ID ${x.id}`)), h('span', { class: 'muted' }, '›'))))
    }
    q.addEventListener('input', draw)
    replace(body, h('div', { class: 'row between' }, backBtn('Courses', () => { st.course = null; st.students = null; renderStudents() }), h('span', { class: 'small muted' }, st.course.name)),
      h('div', { style: { marginTop: '8px' } }, q), listBox)
    draw()
  }

  async function openStudent(s) {
    st.student = s
    renderStudent()
  }

  async function renderStudent() {
    const s = st.student
    const host = st.canvas.host
    const rec = (await getStudent(host, s.id)) || {}
    const rows = await feedbackForStudent(host, s.id)
    // first visit: load this student's grades and comments from Canvas automatically
    if (!rows.length && !st.autoSynced.has(`${host}:${s.id}`)) {
      st.autoSynced.add(`${host}:${s.id}`)
      return syncStudent()
    }
    const grades = rows.filter(r => r.kind === 'grade' && r.score != null && Number(r.possible) > 0)
    const avg = grades.length ? Math.round(100 * grades.reduce((a, r) => a + r.score / r.possible, 0) / grades.length) : null
    const notes = h('textarea', { class: 'input', rows: 3, placeholder: 'Private notes about this student (kept only in this browser)', value: rec.notes || '' })
    notes.addEventListener('change', () => setStudentNotes(host, s.id, notes.value).then(() => toast('Notes saved', 'ok', 1200)))
    const summaryBox = h('div')
    replace(body,
      h('div', { class: 'row between' }, backBtn('Students', () => { st.student = null; renderStudents() })),
      h('div', { class: 'stack', style: { marginTop: '8px' } },
        h('div', { class: 'student-head', style: { background: colorFor(s.id) } }, avatar(s.name, colorFor(s.id), 42),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, s.name), h('div', { class: 'meta' }, `Canvas ID ${s.id} · ${st.course?.name || ''}`))),
        h('div', { class: 'card flat' },
          h('dl', { class: 'kv' }, h('dt', null, 'Graded items saved'), h('dd', null, String(grades.length)), h('dt', null, 'Average'), h('dd', null, avg != null ? `${avg}%` : '—'),
            h('dt', null, 'Comments saved'), h('dd', null, String(rows.filter(r => r.kind !== 'grade').length))),
          h('div', { class: 'row gap wrap', style: { marginTop: '10px' } },
            h('button', { class: 'btn primary sm', onclick: () => syncStudent() }, '⟳ Load all grades & comments'),
            h('button', { class: 'btn sm', disabled: !rows.length, onclick: () => summarize(rows, summaryBox) }, '✨ Progress summary'))),
        summaryBox,
        h('div', null, h('div', { class: 'field-label' }, 'Your notes'), notes),
        h('div', { class: 'section-title' }, 'History'),
        rows.length ? h('div', { class: 'timeline' }, rows.map(tlItem)) : h('p', { class: 'small muted' }, 'Nothing saved yet. Press “Load all grades & comments”.')))
  }

  async function syncStudent() {
    const s = st.student
    loading(`Loading everything for ${s.name}…`)
    try {
      const subs = await st.canvas.studentSubmissions(st.course.id, s.id)
      for (const sub of subs) {
        if (String(sub.user_id) !== String(s.id)) continue // never store another student's data here
        const assignment = sub.assignment || { id: sub.assignment_id, name: 'Assignment' }
        await syncSubmissions({ canvas: st.canvas, course: st.course, assignment, subs: [{ ...sub, user: { name: s.name, sortable_name: s.sortable_name } }] })
      }
      await audit('student.synced', { userId: s.id, courseId: st.course.id, count: subs.length })
      toast(`Saved ${subs.length} submissions for ${s.name}`, 'ok')
    } catch (e) { toast(e.message, 'error') }
    renderStudent()
  }

  async function summarize(rows, box) {
    replace(box, h('div', { class: 'status-line' }, spinner(), 'Summarizing…'))
    const text = rows.slice(0, 60).map(r => `${fmtDate(r.createdAt)} | ${r.assignmentName || ''} | ${r.kind}${r.grade ? ` | grade ${r.grade}` : ''}${r.score != null && r.possible ? ` | ${r.score}/${r.possible}` : ''}${r.text ? ` | ${truncate(r.text, 300)}` : ''}`).join('\n')
    try {
      const m = h('div', { class: 'msg ai', style: { maxWidth: '100%' } })
      replace(box, m)
      await ai().generate({
        tier: 'smart',
        system: 'You help a teacher understand ONE student\'s progress from their grade and feedback history. Write: overall trend, strengths, recurring issues, and 2-3 suggestions for the teacher. Be concise and factual; do not invent data. Refer to the student as "the student".',
        prompt: `HISTORY (newest first):\n${text}`,
        onText: (_d, full) => replace(m, md(full))
      })
    } catch (e) { replace(box, h('div', { class: 'notice danger' }, e.message)) }
  }

  // ---------------- inbox ----------------
  async function renderInbox() {
    loading('Loading Canvas Inbox…')
    try { st.convos = await st.canvas.conversations(st.convoScope) } catch (e) { return fail(e, () => renderInbox()) }
    replace(body,
      h('div', { class: 'row between' }, h('div', { class: 'section-title', style: { margin: 0 } }, 'Canvas Inbox'),
        select([['unread', 'Unread'], ['inbox', 'All'], ['starred', 'Starred']], st.convoScope, (v) => { st.convoScope = v; renderInbox() }, { style: { width: 'auto' } })),
      st.convos.length ? h('div', { class: 'list', style: { marginTop: '8px' } }, st.convos.map(c => h('button', { class: 'item', onclick: () => { st.convo = c; renderConvo() } },
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, c.subject || '(no subject)'),
          h('div', { class: 'sub' }, `${(c.participants || []).map(p => p.name).slice(0, 3).join(', ')} · ${fmtDate(c.last_message_at)}`),
          h('div', { class: 'sub' }, truncate(c.last_message, 90))),
        c.workflow_state === 'unread' ? h('span', { class: 'badge primary' }, 'new') : ''))) : empty('📭', 'Inbox zero', 'No conversations here.'))
  }

  async function renderConvo() {
    loading('Opening conversation…')
    let c
    try { c = await st.canvas.conversation(st.convo.id) } catch (e) { return fail(e, () => renderConvo()) }
    const people = new Map((c.participants || []).map(p => [String(p.id), p.name]))
    const msgs = [...(c.messages || [])].reverse()
    const thread = msgs.map(m => `${people.get(String(m.author_id)) || 'Someone'} (${fmtDate(m.created_at)}): ${m.body}`).join('\n\n')
    const lastFromOther = [...msgs].reverse().find(m => String(m.author_id) !== String(st.canvas.me?.id))
    const replyBox = replyEditor({
      kind: 'Canvas Inbox message',
      original: lastFromOther?.body || msgs[msgs.length - 1]?.body || '',
      context: `Course: ${c.context_name || ''}\nSubject: ${c.subject}\nFull thread:\n${thread}`,
      sendLabel: 'Send reply',
      onSend: async (text) => {
        await st.canvas.addMessage(c.id, text)
        await audit('inbox.replied', { conversationId: c.id })
        toast('Reply sent ✓', 'ok')
        st.convo = null; renderInbox()
      }
    })
    replace(body,
      h('div', { class: 'row between' }, backBtn('Inbox', () => { st.convo = null; renderInbox() }),
        h('button', { class: 'btn sm', onclick: async () => { await st.canvas.markRead(c.id); toast('Marked as read', 'ok', 1200) } }, 'Mark read')),
      h('h3', { style: { marginTop: '6px' } }, c.subject || '(no subject)'),
      h('div', { class: 'chat', style: { marginTop: '8px' } }, msgs.map(m => {
        const mine = String(m.author_id) === String(st.canvas.me?.id)
        return h('div', { class: `msg ${mine ? 'user' : 'ai'}` }, h('div', { class: 'small', style: { opacity: .8, marginBottom: '2px' } }, `${people.get(String(m.author_id)) || 'Someone'} · ${fmtDate(m.created_at)}`), m.body)
      })),
      h('div', { class: 'section-title' }, 'Reply'), replyBox)
  }

  /** Reusable "draft with AI → edit → send" box. */
  function replyEditor({ kind, original, context, sendLabel, onSend, intentPlaceholder }) {
    const intent = h('input', { class: 'input', placeholder: intentPlaceholder || 'What do you want to say? (optional — e.g. “yes, extend to Friday”)' })
    let tone = 'Warm'
    const out = h('textarea', { class: 'input', rows: 7, placeholder: 'Your reply…' })
    const sendBtn = h('button', { class: 'btn ok', onclick: async () => {
      const text = out.value.trim()
      if (!text) return toast('Write or draft a reply first.', 'warn')
      sendBtn.disabled = true
      try { await onSend(text) } catch (e) { toast(e.message, 'error') }
      sendBtn.disabled = false
    } }, sendLabel)
    const draftBtn = h('button', { class: 'btn primary', onclick: async () => {
      draftBtn.disabled = true
      out.value = ''
      try {
        await draftReply({ ai: ai(), settings: ctx.settings, kind, original, context, intent: intent.value, tone, onText: (_d, full) => { out.value = full } })
      } catch (e) { toast(e.message, 'error') }
      draftBtn.disabled = false
    } }, '✨ Draft')
    return h('div', { class: 'card flat' },
      intent,
      h('div', { class: 'row gap', style: { margin: '8px 0' } }, select(TONES, tone, (v) => { tone = v }, { style: { width: 'auto' } }), draftBtn),
      out,
      h('div', { class: 'row gap', style: { marginTop: '8px' } }, sendBtn, h('span', { class: 'small muted' }, 'Nothing is sent until you press this.')))
  }

  // ---------------- discussions ----------------
  async function renderTopics() {
    if (!st.course) {
      try { await loadCourses() } catch (e) { return fail(e, () => renderTopics()) }
      return replace(body, h('div', { class: 'section-title' }, 'Pick a course'), courseList(c => { st.course = c; st.topics = null; renderTopics() }))
    }
    loading('Loading discussions…')
    try { st.topics = await st.canvas.discussionTopics(st.course.id) } catch (e) { return fail(e, () => renderTopics()) }
    replace(body,
      h('div', { class: 'row between' }, backBtn('Courses', () => { st.course = null; renderTopics() }), h('span', { class: 'small muted' }, st.course.name)),
      h('div', { class: 'section-title' }, 'Discussions'),
      st.topics.length ? h('div', { class: 'list' }, st.topics.map(t => h('button', { class: 'item', onclick: () => openTopic(t) },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, t.title), h('div', { class: 'sub' }, `${t.discussion_subentry_count || 0} replies · ${fmtDate(t.last_reply_at || t.posted_at)}`)),
        t.unread_count ? h('span', { class: 'badge primary' }, `${t.unread_count} unread`) : ''))) : empty('💬', 'No discussions', ''))
  }

  async function openTopic(t) {
    st.topic = t
    renderTopic()
  }

  async function renderTopic() {
    const t = st.topic
    loading('Loading posts…')
    let view, full
    try {
      ;[view, full] = await Promise.all([
        st.canvas.discussionView(st.course.id, t.id),
        st.canvas.api(`/api/v1/courses/${st.course.id}/discussion_topics/${t.id}`)
      ])
    } catch (e) { return fail(e, () => renderTopic()) }
    const me = String(st.canvas.me?.id)
    const entries = flattenEntries(view)
    const answered = new Set(entries.filter(e => e.userId === me && e.parentId).map(e => e.parentId))
    const prompt = `Discussion: ${full.title}\nPrompt from teacher: ${htmlToText(full.message)}`
    const unanswered = entries.filter(e => e.depth === 0 && e.userId !== me && !answered.has(e.id))
    const boxes = new Map()
    const entryCard = (e) => {
      const replyHolder = h('div')
      boxes.set(e.id, replyHolder)
      const openReply = () => {
        if (replyHolder.firstChild) return
        replyHolder.append(replyEditor({
          kind: 'teacher reply to a student discussion post',
          original: htmlToText(e.message),
          context: `${prompt}\nThe reply should acknowledge a specific point the student made and extend their thinking with a question or connection. 2-5 sentences.`,
          sendLabel: `Post reply to ${e.name.split(' ')[0]}`,
          intentPlaceholder: 'Optional: what you want to say',
          onSend: async (text) => {
            await st.canvas.replyToEntry(st.course.id, t.id, e.id, textToHtml(text))
            await audit('discussion.replied', { topicId: t.id, entryId: e.id })
            toast(`Reply posted to ${e.name} ✓`, 'ok')
            renderTopic()
          }
        }))
      }
      return h('div', { class: 'card flat', style: { marginLeft: `${Math.min(3, e.depth) * 14}px` } },
        h('div', { class: 'row gap' }, avatar(e.name, colorFor(e.userId), 26), h('div', { class: 'grow' }, h('strong', null, e.name), h('span', { class: 'small muted' }, ` · ${fmtDate(e.createdAt)}`)),
          e.userId === me ? h('span', { class: 'badge' }, 'you') : answered.has(e.id) ? h('span', { class: 'badge ok' }, 'answered') : ''),
        h('div', { class: 'small', style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, truncate(htmlToText(e.message), 1500)),
        e.userId !== me ? h('button', { class: 'btn sm', style: { marginTop: '6px' }, onclick: openReply }, '↩ Reply') : '',
        replyHolder)
    }
    replace(body,
      h('div', { class: 'row between' }, backBtn('Discussions', () => { st.topic = null; renderTopics() }),
        st.canvas.webUrl(`/courses/${st.course.id}/discussion_topics/${t.id}`) ? h('a', { class: 'small', href: st.canvas.webUrl(`/courses/${st.course.id}/discussion_topics/${t.id}`), target: '_blank' }, 'Open in Canvas ↗') : ''),
      h('h3', { style: { marginTop: '6px' } }, full.title),
      h('details', { class: 'card flat' }, h('summary', { style: { cursor: 'pointer' } }, 'Prompt'), h('div', { class: 'small', style: { whiteSpace: 'pre-wrap', marginTop: '6px' } }, htmlToText(full.message))),
      h('div', { class: 'row between', style: { margin: '10px 0' } },
        h('span', { class: 'small muted' }, `${entries.length} posts · ${unanswered.length} without your reply`),
        unanswered.length ? h('button', { class: 'btn sm primary', onclick: async () => {
          for (const e of unanswered) {
            const holder = boxes.get(e.id)
            holder.parentElement.querySelector('button.btn.sm')?.click()
            const btn = holder.querySelector('.btn.primary')
            btn?.click()
            await new Promise(r => setTimeout(r, 400))
            while (btn?.disabled) await new Promise(r => setTimeout(r, 300))
          }
          toast('Drafts ready — review and post each one.', 'ok')
        } }, `✨ Draft ${unanswered.length} replies`) : ''),
      h('div', { class: 'stack' }, entries.map(entryCard)))
  }

  // ---------------- announcements ----------------
  async function renderAnnounce() {
    if (!st.course) {
      try { await loadCourses() } catch (e) { return fail(e, () => renderAnnounce()) }
      return replace(body, h('div', { class: 'section-title' }, 'Announce to which course?'), courseList(c => { st.course = c; renderAnnounce() }))
    }
    const course = st.course
    const about = h('textarea', { class: 'input', rows: 3, placeholder: 'What is it about? e.g. “Essay 2 due date moved to Friday 11:59pm; office hours Thursday 3–4pm”' })
    let tone = 'Warm'
    const title = h('input', { class: 'input', placeholder: 'Title' })
    const text = h('textarea', { class: 'input', rows: 9, placeholder: 'Announcement text' })
    const when = h('input', { class: 'input', type: 'datetime-local' })
    const recent = h('div', { class: 'small muted' }, spinner())
    const draftBtn = h('button', { class: 'btn primary', onclick: async () => {
      if (!about.value.trim()) return toast('Write what the announcement is about first.', 'warn')
      draftBtn.disabled = true
      try {
        const r = await ai().generate({
          tier: 'smart',
          system: `You write clear, friendly course announcements for a teacher to post in Canvas. Write as the teacher (first person). Plain text with short paragraphs; bullets with "- " when listing. Include every date, time and action students must take. No placeholders. Language: ${ctx.settings.language || 'English'}.${ctx.settings.teacherName ? ` Sign as ${ctx.settings.teacherName}.` : ''}`,
          prompt: `COURSE: ${course.name}\nTONE: ${tone}\nWHAT TO ANNOUNCE: ${about.value}`,
          schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] }
        })
        title.value = r.json.title || ''
        text.value = r.json.body || ''
      } catch (e) { toast(e.message, 'error') }
      draftBtn.disabled = false
    } }, '✨ Draft')
    const postBtn = h('button', { class: 'btn ok', onclick: async () => {
      if (!title.value.trim() || !text.value.trim()) return toast('Add a title and text first.', 'warn')
      const scheduled = when.value ? new Date(when.value) : null
      const ok = await confirmDialog({
        title: scheduled ? 'Schedule this announcement?' : 'Post this announcement now?',
        body: `“${title.value}” goes to everyone in ${course.name}${scheduled ? ` on ${scheduled.toLocaleString()}` : ' right away'}. Canvas may notify students by email.`,
        ok: scheduled ? 'Schedule' : 'Post now'
      })
      if (!ok) return
      postBtn.disabled = true
      try {
        await st.canvas.createAnnouncement(course.id, { title: title.value.trim(), message: textToHtml(text.value.trim()), delayedPostAt: when.value || null })
        await audit('announcement.posted', { courseId: course.id, title: title.value, scheduled: when.value || null })
        toast(scheduled ? 'Announcement scheduled ✓' : 'Announcement posted ✓', 'ok')
        renderAnnounce()
      } catch (e) { toast(e.message, 'error', 7000); postBtn.disabled = false }
    } }, '📣 Post to class')
    replace(body,
      h('div', { class: 'row between' }, backBtn('Courses', () => { st.course = null; renderAnnounce() }), h('span', { class: 'small muted' }, course.name)),
      h('div', { class: 'section-title' }, 'New announcement'),
      h('div', { class: 'card flat' }, about,
        h('div', { class: 'row gap', style: { margin: '8px 0' } }, select(TONES, tone, (v) => { tone = v }, { style: { width: 'auto' } }), draftBtn),
        h('div', { class: 'field-label' }, 'Title'), title,
        h('div', { class: 'field-label', style: { marginTop: '8px' } }, 'Text'), text,
        h('div', { class: 'field-label', style: { marginTop: '8px' } }, 'Schedule (optional — leave empty to post now)'), when,
        h('div', { class: 'row gap', style: { marginTop: '10px' } }, postBtn, h('span', { class: 'small muted' }, 'Nothing is posted until you confirm.'))),
      h('div', { class: 'section-title' }, 'Recent announcements'), recent)
    try {
      const list = await st.canvas.announcements(course.id)
      replace(recent, list.length ? h('div', { class: 'list' }, list.map(a => h('a', { class: 'item', href: a.html_url, target: '_blank' },
        h('div', { class: 'grow' }, h('div', { class: 'title' }, a.title), h('div', { class: 'sub' }, fmtDate(a.posted_at || a.delayed_post_at)))))) : 'No recent announcements.')
    } catch (e) { replace(recent, e.message) }
  }

  connect(true)
  return {
    onShow: () => { if (!st.canvas) connect(true) },
    onSettings: () => renderHead()
  }
}
