// Demo Canvas backend: run with  node --test tests/demo-canvas.test.mjs
// Drives the in-app demo through the real Canvas class (the same calls teach.js makes), so a
// path or shape mismatch between canvas.js and the demo shows up here.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEMO_ORIGIN, demoTransport, resetDemo, createDemoStore } from '../extension/lib/demo-canvas.js'
import { Canvas, flattenEntries } from '../extension/lib/canvas.js'
import { needsGrading, postedGradeFor } from '../extension/lib/grader.js'

// isolated store + no latency, so each test starts from the seed data and runs fast
function demo() {
  const store = createDemoStore()
  const api = demoTransport(store, { delay: [0, 0] })
  const canvas = new Canvas({ transport: api, origin: DEMO_ORIGIN, mode: 'demo' })
  return { store, api, canvas }
}
const C = '501', ESSAY = '7001', LAB = '7002'

test('users/self is the fictional teacher, and the host is the reserved demo host', async () => {
  const { canvas } = demo()
  canvas.me = await canvas.api('/api/v1/users/self')
  assert.equal(canvas.me.id, '9001')
  assert.equal(canvas.me.name, 'Ms. Rivera')
  assert.equal(canvas.host, 'demo-school.dotask.invalid')
})

test('courses: one teaching course with the fields the course list shows', async () => {
  const { canvas } = demo()
  const courses = await canvas.teachingCourses()
  assert.equal(courses.length, 1)
  const c = courses[0]
  assert.equal(c.id, '501')
  assert.equal(c.name, 'Biology 101 (Demo)')
  assert.equal(c.total_students, 5)
  assert.ok(c.enrollments.some(e => e.type === 'teacher'))
  assert.ok(c.course_code && c.term?.name)
})

test('assignments: essay with a 2-criterion rubric and a lab reflection without one', async () => {
  const { canvas } = demo()
  const list = await canvas.assignments(C)
  assert.deepEqual(list.map(a => a.id).sort(), [ESSAY, LAB])
  const essay = list.find(a => a.id === ESSAY)
  assert.equal(essay.name, 'Essay: How photosynthesis works')
  assert.equal(essay.points_possible, 20)
  assert.equal(essay.grading_type, 'points')
  assert.equal(essay.published, true)
  assert.deepEqual(essay.submission_types, ['online_text_entry'])
  assert.equal(essay.use_rubric_for_grading, true)
  assert.deepEqual(essay.rubric.map(c => [c.id, c.points]), [['c1', 10], ['c2', 10]])
  for (const c of essay.rubric) {
    assert.ok(c.description && c.ratings.length >= 3, 'each criterion has a description and ratings')
    for (const r of c.ratings) assert.ok(r.id && typeof r.points === 'number' && r.description)
  }
  assert.equal(essay.needs_grading_count, 4, 'four essays submitted, one not')
  assert.ok(essay.description.includes('photosynthesis'))
  assert.ok(essay.due_at && !Number.isNaN(Date.parse(essay.due_at)))
  const lab = await canvas.assignment(C, LAB)
  assert.equal(lab.name, 'Lab reflection')
  assert.equal(lab.points_possible, 10)
  assert.equal(lab.rubric, undefined)
  assert.equal(lab.needs_grading_count, 3)
})

test('essay submissions: five students, the mix of quality, and a student question', async () => {
  const { canvas } = demo()
  const subs = await canvas.submissions(C, ESSAY)
  assert.equal(subs.length, 5)
  assert.deepEqual(subs.map(s => s.user_id).sort(), ['8001', '8002', '8003', '8004', '8005'])
  const names = new Set()
  for (const s of subs) {
    assert.equal(s.assignment_id, ESSAY)
    assert.equal(s.user.id, s.user_id)
    assert.ok(s.user.name && s.user.sortable_name && s.user.short_name)
    assert.equal(s.user.avatar_url, null)
    assert.ok(Array.isArray(s.submission_comments) && Array.isArray(s.attachments))
    names.add(s.user.name)
  }
  assert.equal(names.size, 5, 'distinct student names')

  const by = Object.fromEntries(subs.map(s => [s.user_id, s]))
  const missing = subs.filter(s => s.workflow_state === 'unsubmitted')
  assert.equal(missing.length, 1)
  assert.equal(missing[0].submitted_at, null)
  assert.equal(missing[0].body, null)
  assert.equal(subs.filter(needsGrading).length, 4, 'grader.js sees four to grade')

  const words = (s) => s.body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
  assert.ok(words(by['8001']) > 250, 'strong essay is full length')
  assert.match(by['8001'].body, /Calvin cycle/)
  assert.match(by['8002'].body, /oxygen from the CO2/, 'decent essay carries the misconception')
  assert.ok(words(by['8003']) < 60, 'weak essay is short')
  assert.equal(by['8003'].late, true)
  assert.match(by['8004'].body, /Volcano/i, 'off-topic essay is obviously off-topic')
  assert.doesNotMatch(by['8004'].body, /photosynthesis|chlorophyll/i)

  const asking = subs.filter(s => s.submission_comments.some(c => c.author_id === s.user_id))
  assert.equal(asking.length, 1, 'exactly one student comment to reply to')
  assert.match(asking[0].submission_comments[0].comment, /\?/)
  assert.ok(asking[0].submission_comments[0].author_name && asking[0].submission_comments[0].created_at)
})

test('lab reflection: three submitted reflections', async () => {
  const { canvas } = demo()
  const subs = await canvas.submissions(C, LAB)
  const done = subs.filter(s => s.workflow_state === 'submitted' && s.submitted_at && s.body)
  assert.equal(done.length, 3)
})

test('grade PUT persists: score, grade, rubric and comment show on re-fetch', async () => {
  const { canvas } = demo()
  const essay = await canvas.assignment(C, ESSAY)
  const before = await canvas.submission(C, ESSAY, '8001')
  const res = await canvas.grade(C, ESSAY, {
    userId: '8001', postedGrade: postedGradeFor(essay, 19),
    comment: 'Clear and accurate — great use of the Calvin cycle.',
    rubric: { c1: { points: 10, comments: 'Accurate' }, c2: { points: 9, comments: '' }, bogus: { points: 5 } }
  })
  assert.equal(res.user_id, '8001')
  assert.equal(res.workflow_state, 'graded')
  assert.equal(res.score, 19)
  assert.equal(res.grade, '19')
  assert.equal(res.grader_id, '9001')
  assert.deepEqual(Object.keys(res.rubric_assessment).sort(), ['c1', 'c2'], 'unknown criteria are ignored')
  assert.equal(res.rubric_assessment.c1.rating_id, 'c1_r1')
  assert.equal(res.rubric_assessment.c2.rating_id, null, '9 matches no rating exactly')

  const again = await canvas.submission(C, ESSAY, '8001')
  assert.equal(again.workflow_state, 'graded')
  assert.equal(again.score, 19)
  assert.equal(again.attempt, before.attempt, 'grading does not change the attempt')
  assert.equal(again.rubric_assessment.c2.points, 9)
  const last = again.submission_comments.at(-1)
  assert.equal(again.submission_comments.length, before.submission_comments.length + 1)
  assert.equal(last.author_id, '9001')
  assert.equal(last.author_name, 'Ms. Rivera')
  assert.equal(last.comment, 'Clear and accurate — great use of the Calvin cycle.')
  assert.equal(needsGrading(again), false)
  assert.equal((await canvas.assignment(C, ESSAY)).needs_grading_count, 3, 'badge count drops')
})

test('comment-only PUT appends a teacher comment without grading', async () => {
  const { canvas } = demo()
  const before = await canvas.submission(C, ESSAY, '8002')
  await canvas.grade(C, ESSAY, { userId: '8002', comment: 'The word equation is fine — the balanced one is a bonus.' })
  const after = await canvas.submission(C, ESSAY, '8002')
  assert.equal(after.workflow_state, 'submitted')
  assert.equal(after.score, null)
  assert.equal(after.submission_comments.length, before.submission_comments.length + 1)
  assert.equal(after.submission_comments.at(-1).author_id, '9001')
  // the student's original question stays first
  assert.equal(after.submission_comments[0].author_id, '8002')
})

test('rubric-only PUT scores from the rubric; percent and blank grades work too', async () => {
  const { canvas, api } = demo()
  const r = await canvas.grade(C, ESSAY, { userId: '8003', rubric: { c1: { points: 4, comments: '' }, c2: { points: 4, comments: '' } } })
  assert.equal(r.workflow_state, 'graded')
  assert.equal(r.score, 8)
  const p = await canvas.grade(C, LAB, { userId: '8001', postedGrade: '85%' })
  assert.equal(p.score, 8.5)
  assert.equal(p.grade, '85%')
  const cleared = await api(`/api/v1/courses/${C}/assignments/${LAB}/submissions/8001`, { method: 'PUT', body: { submission: { posted_grade: '' } } })
  assert.equal(cleared.workflow_state, 'submitted')
  assert.equal(cleared.score, null)
  await assert.rejects(canvas.grade(C, LAB, { userId: '8001', postedGrade: 'A+' }), e => e.name === 'CanvasError' && e.status === 422)
})

test('anonymous_submissions and unknown students 404', async () => {
  const { canvas } = demo()
  await assert.rejects(canvas.grade(C, ESSAY, { anonymousId: 'abcde', postedGrade: '10' }), e => e.status === 404 && e.name === 'CanvasError')
  await assert.rejects(canvas.submission(C, ESSAY, '9001'), e => e.status === 404)
})

test('students and per-student history (with assignment objects)', async () => {
  const { canvas } = demo()
  const students = await canvas.students(C)
  assert.equal(students.length, 5)
  for (const s of students) assert.ok(s.id && s.name && s.sortable_name && s.short_name && s.avatar_url === null)

  const hist = await canvas.studentSubmissions(C, '8002')
  assert.ok(hist.length >= 4)
  assert.ok(hist.every(s => s.user_id === '8002'), 'never another student\'s work')
  for (const s of hist) assert.ok(s.assignment?.id && s.assignment.name && s.assignment.points_possible > 0)
  const graded = hist.filter(s => s.workflow_state === 'graded')
  assert.ok(graded.length >= 2, 'past graded work exists')
  for (const s of graded) {
    assert.equal(typeof s.score, 'number')
    assert.ok(s.submission_comments.some(c => c.author_id === '9001'), 'with teacher feedback')
  }
  const all = await canvas.api(`/api/v1/courses/${C}/students/submissions?student_ids[]=all`, { all: true })
  assert.equal(new Set(all.map(s => s.user_id)).size, 5)
  assert.deepEqual(await canvas.api(`/api/v1/courses/${C}/students/submissions`), [], 'no student_ids: the teacher has none')
})

test('discussion: topic, threaded view with participants, posting and replying', async () => {
  const { canvas } = demo()
  canvas.me = await canvas.api('/api/v1/users/self')
  const topics = await canvas.discussionTopics(C)
  assert.equal(topics.length, 1)
  const t = topics[0]
  assert.ok(t.title && t.posted_at && t.discussion_subentry_count === 4 && t.unread_count > 0)
  const full = await canvas.api(`/api/v1/courses/${C}/discussion_topics/${t.id}`)
  assert.ok(full.message.length > 20)

  let view = await canvas.discussionView(C, t.id)
  let entries = flattenEntries(view)
  assert.equal(entries.filter(e => e.depth === 0).length, 3, 'three student entries')
  const nested = entries.filter(e => e.depth === 1)
  assert.equal(nested.length, 1, 'one nested reply')
  assert.ok(entries.every(e => e.name !== 'Unknown'), 'every author is a participant')

  const target = entries.find(e => e.depth === 0 && e.userId === '8004')
  await canvas.replyToEntry(C, t.id, target.id, '<p>Interesting idea, Jonah — what pigments are left when chlorophyll breaks down?</p>')
  await canvas.postEntry(C, t.id, '<p>Great discussion, everyone.</p>')
  view = await canvas.discussionView(C, t.id)
  entries = flattenEntries(view)
  const mine = entries.filter(e => e.userId === '9001')
  assert.equal(mine.length, 2)
  assert.ok(mine.every(e => e.name === 'Ms. Rivera'))
  assert.equal(mine.find(e => e.parentId).parentId, target.id)
  assert.equal((await canvas.discussionTopics(C))[0].discussion_subentry_count, 6)
  await assert.rejects(canvas.replyToEntry(C, t.id, '123456', 'hi'), e => e.status === 404)
  await assert.rejects(canvas.postEntry(C, t.id, '<p> </p>'), e => e.status === 422)
})

test('announcements: list by context code, create (now and scheduled)', async () => {
  const { canvas, api } = demo()
  const before = await canvas.announcements(C)
  assert.equal(before.length, 2)
  for (const a of before) assert.ok(a.title && a.posted_at)
  // teach.js links each row to html_url; the demo has no website, so no dead .invalid links
  assert.ok(before.every(a => a.html_url === null), 'announcement rows are not links in the demo')
  assert.deepEqual(await api('/api/v1/announcements?context_codes[]=course_999'), [])

  const made = await canvas.createAnnouncement(C, { title: 'Lab goggles on Friday', message: '<p>Bring goggles.</p>' })
  assert.equal(made.is_announcement, true)
  assert.equal(made.html_url, null)
  const after = await canvas.announcements(C)
  assert.equal(after.length, 3)
  assert.equal(after[0].title, 'Lab goggles on Friday', 'newest first')
  assert.equal((await canvas.discussionTopics(C)).length, 1, 'announcements are not discussions')

  const later = new Date(Date.now() + 3 * 86400000).toISOString()
  const sched = await canvas.createAnnouncement(C, { title: 'Quiz next week', message: '<p>Study chapter 4.</p>', delayedPostAt: later })
  assert.equal(sched.posted_at, null)
  assert.equal(sched.delayed_post_at, later)
  assert.equal((await canvas.announcements(C)).length, 4)
})

test('inbox: scopes, detail, add_message and mark read', async () => {
  const { canvas } = demo()
  canvas.me = await canvas.api('/api/v1/users/self')
  const unread = await canvas.conversations('unread')
  assert.equal(unread.length, 1)
  const all = await canvas.conversations('inbox')
  assert.equal(all.length, 2)
  for (const c of all) {
    assert.ok(c.subject && c.last_message && c.last_message_at && c.participants.length === 2)
    assert.ok(c.participants.every(p => p.id && p.name))
    assert.equal(c.messages, undefined, 'list rows carry no messages')
  }
  const id = unread[0].id
  const detail = await canvas.conversation(id)
  assert.equal(detail.workflow_state, 'unread', 'auto_mark_as_read=false keeps it unread')
  assert.ok(detail.messages.length >= 1 && detail.messages.every(m => m.id && m.author_id && m.body && m.created_at))
  assert.ok(detail.context_name)

  await canvas.addMessage(id, 'Of course, Sofia — Monday is fine. Feel better!')
  const after = await canvas.conversation(id)
  assert.equal(after.messages.length, detail.messages.length + 1)
  assert.equal(after.messages[0].author_id, '9001', 'newest first, like Canvas')
  assert.equal(after.last_message, 'Of course, Sofia — Monday is fine. Feel better!')
  await assert.rejects(canvas.addMessage(id, '   '), e => e.status === 422)

  await canvas.api(`/api/v1/conversations/${id}`, { method: 'PUT', body: { conversation: { workflow_state: 'unread' } } })
  assert.equal((await canvas.conversations('unread')).length, 1)
  await canvas.markRead(id)
  assert.equal((await canvas.conversations('unread')).length, 0)
  assert.equal((await canvas.conversations('inbox')).length, 2)
})

test('unknown paths, courses and origins 404 like canvas.js', async () => {
  const { api } = demo()
  const is404 = (e) => e instanceof Error && e.name === 'CanvasError' && e.status === 404 &&
    e.message === 'Canvas could not find that item (it may have been deleted).'
  await assert.rejects(api('/api/v1/nope'), is404)
  await assert.rejects(api('/api/v1/courses/999/assignments'), is404)
  await assert.rejects(api('/api/v1/courses/501/assignments/123'), is404)
  await assert.rejects(api('/api/v1/users/self', { method: 'DELETE' }), is404)
  await assert.rejects(api('https://real-school.example.com/api/v1/users/self'), is404)
  // the full demo URL works the same as a path; unrelated query strings are ignored
  assert.equal((await api(`${DEMO_ORIGIN}/api/v1/users/self?foo=bar`)).id, '9001')
  assert.equal((await api('/api/v1/courses/501/users?per_page=1&page=2')).length, 5)
})

test('results are deep copies: callers cannot change the store', async () => {
  const { canvas, api } = demo()
  const subs = await canvas.submissions(C, ESSAY)
  subs[0].user.name = 'HACKED'
  subs[0].submission_comments.push({ comment: 'x' })
  subs[0].workflow_state = 'graded'
  const a = await canvas.assignment(C, ESSAY)
  a.rubric[0].points = 999
  const fresh = await canvas.submissions(C, ESSAY)
  assert.notEqual(fresh[0].user.name, 'HACKED')
  assert.equal(fresh[0].submission_comments.length, subs[0].submission_comments.length - 1)
  assert.notEqual(fresh[0].workflow_state, 'graded')
  assert.equal((await canvas.assignment(C, ESSAY)).rubric[0].points, 10)

  // the request body is copied too
  const body = { comment: { text_comment: 'Original' } }
  await api(`/api/v1/courses/${C}/assignments/${ESSAY}/submissions/8001`, { method: 'PUT', body })
  body.comment.text_comment = 'Changed later'
  const s = await canvas.submission(C, ESSAY, '8001')
  assert.equal(s.submission_comments.at(-1).comment, 'Original')
})

test('resetDemo restores the initial data', async () => {
  const { store, canvas } = demo()
  await canvas.grade(C, ESSAY, { userId: '8002', postedGrade: '12', comment: 'ok' })
  await canvas.createAnnouncement(C, { title: 'Temp', message: 'x' })
  await canvas.markRead('5001')
  resetDemo(store)
  const s = await canvas.submission(C, ESSAY, '8002')
  assert.equal(s.workflow_state, 'submitted')
  assert.equal(s.submission_comments.length, 1)
  assert.equal((await canvas.announcements(C)).length, 2)
  assert.equal((await canvas.conversations('unread')).length, 1)
})

test('the shared session store persists across transports, resets, and has a small delay', async () => {
  resetDemo()
  const a = demoTransport()
  const b = demoTransport()
  const t0 = Date.now()
  await a(`/api/v1/courses/${C}/assignments/${LAB}/submissions/8003`, { method: 'PUT', body: { submission: { posted_grade: '6' } } })
  assert.ok(Date.now() - t0 >= 55, 'simulated latency so spinners show')
  assert.equal((await b(`/api/v1/courses/${C}/assignments/${LAB}/submissions/8003`)).score, 6, 'same session store')
  resetDemo()
  assert.equal((await b(`/api/v1/courses/${C}/assignments/${LAB}/submissions/8003`)).score, null)
  // isolated stores never see the shared one
  const { canvas } = demo()
  assert.equal((await canvas.submission(C, LAB, '8003')).score, null)
})

test('late flags and seconds_late agree with the due and submitted dates', async () => {
  const { api } = demo()
  const all = await api(`/api/v1/courses/${C}/students/submissions?student_ids[]=all`)
  for (const s of all.filter(x => x.submitted_at)) {
    const over = (Date.parse(s.submitted_at) - Date.parse(s.assignment.due_at)) / 1000
    assert.equal(s.late, over > 0, `late flag for ${s.assignment_id}:${s.user_id}`)
    // seconds, not milliseconds: grader.js tells the AI how many hours late the work was
    if (s.late) assert.ok(Math.abs(s.seconds_late - over) < 60, `seconds_late for ${s.assignment_id}:${s.user_id}`)
  }
})

test('new comment ids never repeat after a reset (device history is keyed by comment id)', async () => {
  const store = createDemoStore()
  const api = demoTransport(store, { delay: [60, 60] })
  const put = (uid, text) => api(`/api/v1/courses/${C}/assignments/${ESSAY}/submissions/${uid}`, { method: 'PUT', body: { comment: { text_comment: text } } })
  const first = (await put('8002', 'First session')).submission_comments.at(-1).id
  resetDemo(store)
  const second = (await put('8001', 'Second session')).submission_comments.at(-1).id
  assert.notEqual(first, second)
})

test('all demo people are the fictional cast', async () => {
  const { canvas } = demo()
  const people = [await canvas.api('/api/v1/users/self'), ...await canvas.students(C)]
  assert.deepEqual(people.map(p => p.name), ['Ms. Rivera', 'Maya Okafor', 'Liam Castellano', 'Priya Raghavan', 'Jonah Whitfield', 'Sofia Lindqvist'])
  const text = JSON.stringify([await canvas.conversations('inbox'), await canvas.submissions(C, ESSAY)])
  assert.doesNotMatch(text, /@[a-z0-9-]+\.[a-z]/i, 'no email addresses anywhere')
})
