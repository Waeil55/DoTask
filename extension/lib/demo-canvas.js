// Demo Canvas: a fictional "Demo School" Canvas backend that runs entirely inside the app.
// It lets App Review, screenshots and brand-new users try every Teach feature (grading drafts,
// per-student history, comment replies, inbox, discussions, announcements) without a real Canvas.
//
// Contract (same as the transports in canvas.js):
//   transport(path, { method = 'GET', body, all = false }) → Promise of parsed JSON data
//   (for all=true the full array). Errors are rejected as Error objects with name 'CanvasError'
//   and a numeric status, so callers treat them exactly like canvas.js's CanvasError.
//
// Why no import from canvas.js: canvas.js imports this file, so importing CanvasError back would
// make a cycle. Plain errors with the same name/status/message are indistinguishable to callers.
//
// Everything here is invented: Demo School, Ms. Rivera and the students are not real people.
// Writes (grades, comments, posts, replies, announcements, messages) persist in memory for the
// session only; nothing ever leaves the device. The origin uses the reserved .invalid TLD
// (RFC 2606), so any "Open in Canvas" link built from it can never reach a real server.

export const DEMO_ORIGIN = 'https://demo-school.dotask.invalid'

const COURSE_ID = '501'
const TEACHER_ID = '9001'
const NOT_FOUND = 'Canvas could not find that item (it may have been deleted).'
const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000

function canvasError(message, status) {
  const e = new Error(message)
  e.name = 'CanvasError'
  e.status = status
  return e
}
const notFound = () => canvasError(NOT_FOUND, 404)
// same wording canvas.js's friendly() uses for a 422
const rejected = (why) => canvasError(`Canvas rejected the data: ${why}`, 422)

// Data is plain JSON, so a JSON round trip is a complete deep copy and works in every WebView
// (structuredClone is missing from older Android System WebViews that minSdk 24 still allows).
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))

// ---------------------------------------------------------------------------------------------
// Seed data. Dates are relative to "now" so the demo always looks current in screenshots.
// ---------------------------------------------------------------------------------------------

function seed(now = Date.now()) {
  const ago = (days, hours = 0) => new Date(now - days * DAY - hours * HOUR).toISOString()
  const html = (...paras) => paras.map(p => `<p>${p}</p>`).join('')
  const url = (p) => `${DEMO_ORIGIN}${p}`

  const teacher = { id: TEACHER_ID, name: 'Ms. Rivera', sortable_name: 'Rivera, Ms.', short_name: 'Ms. Rivera', avatar_url: null }
  const person = (id, first, last) => ({ id, name: `${first} ${last}`, sortable_name: `${last}, ${first}`, short_name: first, avatar_url: null })
  // Names are invented and deliberately avoid well-known public figures' names, because
  // screenshots and App Review show them as fictional students.
  const students = [
    person('8001', 'Maya', 'Okafor'), // strong writer
    person('8002', 'Liam', 'Castellano'), // solid, but holds a common misconception
    person('8003', 'Priya', 'Raghavan'), // very brief answers
    person('8004', 'Jonah', 'Whitfield'), // sometimes answers the wrong prompt
    person('8005', 'Sofia', 'Lindqvist') // hasn't submitted the essay yet
  ]

  const course = {
    id: COURSE_ID, name: 'Biology 101 (Demo)', course_code: 'BIO-101-DEMO', workflow_state: 'available',
    term: { id: '1', name: 'Demo Term' },
    enrollments: [{ type: 'teacher', role: 'TeacherEnrollment', enrollment_state: 'active', user_id: TEACHER_ID }],
    default_view: 'modules', time_zone: 'America/Chicago', html_url: url(`/courses/${COURSE_ID}`)
  }

  const rating = (cid, n, points, description, long_description) => ({ id: `${cid}_r${n}`, points, description, long_description })
  const assignments = {
    // past work: only reached through per-student history (students/submissions includes the
    // assignment object) and by id, so the Grade list stays the two assignments the demo is about
    6001: {
      id: '6001', name: 'Worksheet: Cell organelles', points_possible: 10, due_at: ago(30),
      description: html('Name five organelles found in plant cells and explain what each one does in one or two sentences.'),
      submission_types: ['online_text_entry'], listed: false
    },
    6002: {
      id: '6002', name: 'Lab report: Osmosis in potato cores', points_possible: 20, due_at: ago(18),
      description: html('Write up the potato core osmosis lab: hypothesis, data table, results and a conclusion explaining which way water moved and why.'),
      submission_types: ['online_text_entry'], listed: false
    },
    7001: {
      id: '7001', name: 'Essay: How photosynthesis works', points_possible: 20, due_at: ago(2),
      description: html(
        // the length range matches the sample essays (strong one ≈270 words), so the AI does not
        // mark the best essay down for being short
        'In 250–400 words, explain how photosynthesis works <strong>in your own words</strong>.',
        'Include: where it happens in the cell, its inputs and outputs, the role of light and chlorophyll, the two main stages, and why photosynthesis matters for life on Earth.'),
      submission_types: ['online_text_entry'], listed: true, use_rubric_for_grading: true,
      rubric: [
        {
          id: 'c1', description: 'Scientific accuracy', points: 10, criterion_use_range: false,
          long_description: 'Correctly explains where photosynthesis happens, its inputs and outputs, and the roles of light and chlorophyll.',
          ratings: [
            rating('c1', 1, 10, 'Accurate and complete', 'All key ideas are correct, including the light reactions and the Calvin cycle.'),
            rating('c1', 2, 7, 'Mostly accurate', 'Key ideas are present with a minor error or gap.'),
            rating('c1', 3, 4, 'Partly accurate', 'Several key ideas are missing, or there is a significant misconception.'),
            rating('c1', 4, 0, 'Not addressed', 'Does not explain photosynthesis.')
          ]
        },
        {
          id: 'c2', description: 'Clarity and organization', points: 10, criterion_use_range: false,
          long_description: 'Ideas are explained in the student’s own words, in a logical order, using scientific vocabulary correctly.',
          ratings: [
            rating('c2', 1, 10, 'Clear and well organized', 'Logical order, clear paragraphs, vocabulary used correctly.'),
            rating('c2', 2, 7, 'Mostly clear', 'Generally easy to follow, with some loose or unclear parts.'),
            rating('c2', 3, 4, 'Hard to follow', 'Very short, disorganized, or vocabulary used incorrectly.'),
            rating('c2', 4, 0, 'Not addressed', 'No meaningful writing on the topic.')
          ]
        }
      ],
      rubric_settings: { id: '1101', title: 'Photosynthesis essay rubric', points_possible: 20, free_form_criterion_comments: false, hide_score_total: false }
    },
    7002: {
      id: '7002', name: 'Lab reflection', points_possible: 10, due_at: ago(1),
      description: html(
        // 100–200 words: the strong sample reflection is ≈110 words, the weak ones fall short
        'Floating leaf disk lab: in 100–200 words, describe what you observed, what the results tell you about light and photosynthesis, and one thing you would change if you repeated the experiment.'),
      submission_types: ['online_text_entry'], listed: true
    }
  }
  for (const [i, a] of Object.values(assignments).entries()) {
    Object.assign(a, {
      course_id: COURSE_ID, grading_type: 'points', published: true, anonymous_grading: false,
      position: i + 1, html_url: url(`/courses/${COURSE_ID}/assignments/${a.id}`)
    })
  }

  let cid = 90000
  const comment = (authorId, text, when) => {
    const who = authorId === TEACHER_ID ? teacher : students.find(s => s.id === authorId)
    return { id: String(++cid), author_id: authorId, author_name: who.name, author: { id: authorId, display_name: who.name, avatar_image_url: null }, comment: text, created_at: when, edited_at: null }
  }

  const submissions = {}
  const sub = (aid, uid, f = {}) => {
    const submitted = f.workflow_state !== 'unsubmitted'
    submissions[`${aid}:${uid}`] = {
      id: `${aid}${uid.slice(-2)}`, user_id: uid, assignment_id: aid,
      attempt: submitted ? 1 : null, workflow_state: 'submitted',
      submission_type: submitted ? 'online_text_entry' : null, body: null, url: null,
      // every demo due date is in the past, so Canvas would flag unsubmitted work as missing
      submitted_at: null, late: false, missing: !submitted, excused: false, seconds_late: 0,
      score: null, grade: null, entered_score: null, entered_grade: null, graded_at: null, grader_id: null, posted_at: null,
      grade_matches_current_submission: true, attachments: [], submission_comments: [],
      preview_url: url(`/courses/${COURSE_ID}/assignments/${aid}/submissions/${uid}?preview=1`),
      ...f
    }
  }
  const graded = (aid, uid, score, submittedDaysAgo, text, teacherComment, f = {}) => sub(aid, uid, {
    workflow_state: 'graded', body: html(text), submitted_at: ago(submittedDaysAgo),
    score, grade: String(score), entered_score: score, entered_grade: String(score),
    graded_at: ago(submittedDaysAgo - 2), posted_at: ago(submittedDaysAgo - 2), grader_id: TEACHER_ID,
    submission_comments: [comment(TEACHER_ID, teacherComment, ago(submittedDaysAgo - 2))],
    ...f
  })

  // ---- past graded work (per-student history) ----
  graded('6001', '8001', 10, 31, 'Nucleus: holds the DNA and controls the cell. Chloroplast: where photosynthesis happens. Mitochondria: release energy from glucose in cellular respiration. Cell wall: a rigid layer of cellulose that supports the cell. Central vacuole: stores water and keeps the cell firm.',
    'Excellent, Maya — every function is accurate and clearly worded. Your note that the vacuole keeps the cell firm will be useful when we get to osmosis.')
  graded('6001', '8002', 8, 31, 'Nucleus controls the cell. Chloroplasts make food for the plant using sunlight. Mitochondria are the powerhouse of the cell. Cell wall protects the cell. Ribosomes make proteins.',
    'Good work, Liam. Try to go beyond “powerhouse of the cell” — explain what the mitochondria actually do (they release energy from glucose).')
  graded('6001', '8003', 6, 30, 'Nucleus - brain of the cell. Chloroplast - green. Cell wall - outside. Mitochondria - energy. Vacuole - water.',
    'Priya, you know the organelles, but one-word answers do not show what each one does. Next time, write a full sentence for each.')
  graded('6001', '8004', 7, 31, 'The nucleus has the DNA. Chloroplasts do photosynthesis. Mitochondria give energy. The cell membrane lets things in and out. I also looked up the Golgi body which packages proteins.',
    'Nice extra research on the Golgi body, Jonah! The prompt asked for plant-cell organelles, so make sure to include the cell wall and vacuole.')
  graded('6001', '8005', 9, 31, 'Nucleus: stores DNA and directs the cell. Chloroplast: captures light to make sugar. Mitochondria: break down sugar to release energy. Cell wall: supports and protects. Vacuole: stores water and nutrients.',
    'Very clear and accurate, Sofia. Small detail: the cell wall is made of cellulose — worth mentioning.')

  graded('6002', '8001', 18, 19, 'Hypothesis: potato cores in salt water will lose mass. Results: in 0% salt the cores gained 0.4 g, in 5% salt they lost 0.6 g. Conclusion: water moved by osmosis from the side with less solute to the side with more solute, so the cores in salt water shrank.',
    'Strong report, Maya. Your data table was very clear. To reach full marks, discuss sources of error (for example, how blotting the cores could change the mass).')
  graded('6002', '8002', 14, 19, 'Hypothesis: the salt water cores will get bigger. Results: the salt water ones got smaller and the fresh water ones got bigger. Conclusion: the salt moved into the potato which pushed the water out.',
    'Good data, Liam, but check your conclusion: the salt did not move into the potato — water moved out of it, toward the higher salt concentration. Watch which substance is actually moving.')
  graded('6002', '8003', 11, 18, 'The potato in salt water got smaller. The other one got bigger. This is osmosis.',
    'Your observations are correct, Priya, but the report needs a hypothesis, the data table and an explanation of why water moved. Please aim for complete sections.')
  graded('6002', '8004', 9, 19, 'The bean seeds in the dark grew taller than the ones in the light because they were looking for light. The ones in the light were shorter but greener.',
    'Jonah, this describes our earlier bean germination activity, not the potato osmosis lab. I gave credit for the lab skills shown — please double-check the prompt before submitting.')
  graded('6002', '8005', 15, 17, 'Hypothesis: cores in salt solution will lose mass because water will leave the cells. Results: 0% salt +0.3 g, 2% salt −0.1 g, 5% salt −0.5 g. Conclusion: the more salt, the more water left the potato by osmosis.',
    'Good, accurate conclusion, Sofia — and nice use of three concentrations. This was submitted a day late; let me know early if you need more time.',
    { late: true, seconds_late: 24 * 60 * 60 }) // submitted 17 days ago, due 18 days ago

  // ---- Essay: How photosynthesis works (needs grading) ----
  sub('7001', '8001', {
    submitted_at: ago(3, 5),
    body: html(
      'Photosynthesis is the process plants, algae and some bacteria use to turn light energy into chemical energy stored in sugar. In plants it happens mostly in the leaves, inside organelles called chloroplasts. Chloroplasts contain a green pigment called chlorophyll, which absorbs mainly red and blue light and reflects green light. That is why leaves look green to us.',
      'The overall equation is 6CO<sub>2</sub> + 6H<sub>2</sub>O + light energy → C<sub>6</sub>H<sub>12</sub>O<sub>6</sub> + 6O<sub>2</sub>. Carbon dioxide enters the leaf through tiny pores called stomata, and water travels up from the roots through the xylem.',
      'Photosynthesis happens in two stages. In the light-dependent reactions, which take place in the thylakoid membranes, chlorophyll absorbs light and the energy is used to split water molecules. This releases oxygen as a by-product and makes ATP and NADPH, which carry energy to the next stage. In the Calvin cycle, which happens in the stroma, the plant uses that ATP and NADPH to fix carbon dioxide into glucose. The Calvin cycle does not use light directly, but it depends on the products of the light reactions, so it slows down in the dark.',
      'Photosynthesis matters for almost all life on Earth. It produces the oxygen we breathe, and the glucose plants make is the base of nearly every food chain. Plants use some of the glucose for their own cellular respiration and turn some into cellulose to build cell walls. Photosynthesis also removes carbon dioxide from the atmosphere, which helps regulate Earth’s climate. Without it there would be no food for animals and far less oxygen in the air.')
  })
  sub('7001', '8002', {
    submitted_at: ago(2, 9),
    body: html(
      'Photosynthesis is how plants make their own food. It happens in the chloroplasts, which have chlorophyll in them. Chlorophyll is green and it captures the energy from sunlight.',
      'Plants take in carbon dioxide from the air and water from the soil. Using the energy from the sun, they turn these into glucose and oxygen. The plant splits the carbon dioxide molecules, and the oxygen from the CO2 is released into the air while the carbon is used to make sugar. Plants also get most of their food and mass from the nutrients in the soil, and photosynthesis just gives them some extra energy.',
      'The word equation is carbon dioxide + water → glucose + oxygen. Light is needed for it to happen, which is why plants can’t do photosynthesis at night.',
      'Photosynthesis is important because it gives us oxygen to breathe and food to eat. If there were no plants, animals would not survive. I think this shows how everything in nature is connected.'),
    submission_comments: [comment('8002', 'Hi Ms. Rivera — do we need the balanced chemical equation, or is the word equation okay? I can add it if it’s needed.', ago(2, 8))]
  })
  sub('7001', '8003', {
    // seconds_late is in seconds (grader.js shows it to the AI as hours late): due 48 h ago,
    // submitted 27 h ago → 21 h late
    submitted_at: ago(1, 3), late: true, seconds_late: (DAY - 3 * HOUR) / 1000,
    body: html('Photosynthesis is when plants use sunlight to make food. They need sunlight, water and air. It happens in the leaves because they are green. Then the plant makes oxygen. It is important because we need oxygen.')
  })
  sub('7001', '8004', {
    submitted_at: ago(2, 20),
    body: html(
      '<strong>My Volcano Report</strong>',
      'Volcanoes form where tectonic plates pull apart or push together, and also over hot spots in the mantle. Magma rises because it is less dense than the rock around it. When enough pressure builds up, it erupts through the crust as lava, ash and gas.',
      'There are three main types of volcanoes. Shield volcanoes have gentle slopes and runny lava. Cinder cones are small and steep. Composite volcanoes are tall and can have very explosive eruptions because their lava is thick and traps gas.',
      'My favorite part of this project was building a model volcano with baking soda and vinegar. Next time I would add red food coloring so the lava looks more realistic.')
  })
  sub('7001', '8005', { workflow_state: 'unsubmitted' })

  // ---- Lab reflection (3 submitted, 2 not yet) ----
  sub('7002', '8001', {
    submitted_at: ago(1, 6),
    body: html(
      'Under the bright lamp, 8 of our 10 leaf disks floated within 12 minutes, but under the dim lamp only 3 floated after 20 minutes. The disks float because photosynthesis produces oxygen that collects in the air spaces of the leaf, making the disks less dense.',
      'This shows that more light increases the rate of photosynthesis, at least up to a point. Light provides the energy for the light-dependent reactions, so with more light the leaves produced oxygen faster.',
      'If I repeated the experiment, I would put a container of water between the lamp and the cups, because the bright lamp also warmed the water, so temperature might have affected our results too.')
  })
  sub('7002', '8002', {
    submitted_at: ago(1, 2),
    body: html(
      'In our experiment the leaf disks under the lamp floated faster than the ones in the shade. After 15 minutes 7 disks were floating under the lamp and only 2 in the shade.',
      'This means light makes photosynthesis go faster because the plant gets more energy. The bubbles that made the disks float are from the oxygen the plant makes.',
      'Next time I would use more disks and do more trials so the results are more reliable.')
  })
  sub('7002', '8003', {
    // due 24 h ago, submitted 20 h ago, so Canvas would flag it late
    submitted_at: ago(0, 20), late: true, seconds_late: 4 * 60 * 60,
    body: html('The disks floated in the light. In the dark they stayed at the bottom. Light helps photosynthesis. I would do it again with more time.')
  })
  sub('7002', '8004', { workflow_state: 'unsubmitted' })
  sub('7002', '8005', { workflow_state: 'unsubmitted' })

  // ---- discussion + announcements (Canvas keeps both as discussion topics) ----
  const author = { id: TEACHER_ID, display_name: teacher.name, avatar_image_url: null }
  const topic = (f) => ({
    discussion_type: 'threaded', published: true, locked: false, read_state: 'read', unread_count: 0,
    user_name: teacher.name, author, last_reply_at: null, delayed_post_at: null,
    context_code: `course_${COURSE_ID}`, is_announcement: false,
    // null, not a demo URL: teach.js renders each recent announcement as <a href={html_url}>, and
    // Demo School has no website (canvas.js webUrl() is null in demo too). A .invalid link would
    // open the phone's browser on an error page (a "broken link" for App Review); without an
    // href the row is simply not a link.
    html_url: null, ...f
  })
  const topics = [
    topic({
      id: '3001', title: 'Why do leaves change color in autumn?', posted_at: ago(5), read_state: 'unread', unread_count: 2,
      message: html('We have learned that chlorophyll makes leaves green. Using what you know about pigments and photosynthesis, explain why many leaves turn yellow, orange or red in the fall.', 'Post your answer, then reply to at least one classmate.')
    }),
    topic({
      id: '3002', title: 'Welcome to Biology 101 (Demo)!', is_announcement: true, posted_at: ago(21),
      message: html('Welcome, everyone! This term we will explore cells, energy, genetics and ecosystems.', 'Please read the syllabus and bring a notebook to every lab. I’m looking forward to a great term!', '— Ms. Rivera')
    }),
    topic({
      id: '3003', title: 'Photosynthesis essay due this week', is_announcement: true, posted_at: ago(6),
      message: html('A reminder that the essay “How photosynthesis works” is due this week. Aim for 250–400 words in your own words.', 'Office hours are on Thursday after class if you would like feedback on a draft.')
    })
  ]
  const entries = [
    { id: '4001', topic_id: '3001', user_id: '8001', parent_id: null, created_at: ago(4, 6),
      message: html('Leaves change color because trees stop making chlorophyll when the days get shorter and colder. The green chlorophyll breaks down, which reveals yellow and orange pigments called carotenoids that were in the leaf all along. Some trees also make new red pigments called anthocyanins in the fall.') },
    { id: '4002', topic_id: '3001', user_id: '8004', parent_id: null, created_at: ago(4, 2),
      message: html('I think the leaves change color because it gets cold and the leaves start to freeze and die, kind of like how your fingers turn red when it’s cold outside.') },
    { id: '4003', topic_id: '3001', user_id: '8003', parent_id: null, created_at: ago(3, 7),
      message: html('The tree stops making chlorophyll so the green goes away. I wonder why some trees turn red and others turn yellow?') },
    { id: '4004', topic_id: '3001', user_id: '8002', parent_id: '4003', created_at: ago(3, 1),
      message: html('Priya, I read that the red comes from a different pigment that some trees make in the fall, and yellow pigments were already there. So it depends on the kind of tree!') }
  ]

  // ---- inbox ----
  const participants = (...ids) => ids.map(id => {
    const p = id === TEACHER_ID ? teacher : students.find(s => s.id === id)
    return { id, name: p.name, full_name: p.name, avatar_url: null }
  })
  let mid = 95000
  const message = (authorId, body, when, people) => ({
    id: String(++mid), created_at: when, body, author_id: authorId, generated: false,
    media_comment: null, forwarded_messages: [], attachments: [], participating_user_ids: people
  })
  const conversations = [
    {
      id: '5001', subject: 'Missed class — essay extension?', workflow_state: 'unread', starred: false, subscribed: true, private: true,
      context_code: `course_${COURSE_ID}`, context_name: course.name, participants: participants(TEACHER_ID, '8005'),
      messages: [
        message('8005', 'Hi Ms. Rivera, I was home sick on Tuesday and Wednesday and missed the lesson on the Calvin cycle. Could I please have until Monday to turn in the photosynthesis essay? I can bring a note from home. Thank you, Sofia', ago(0, 14), [TEACHER_ID, '8005'])
      ]
    },
    {
      id: '5002', subject: 'Question about the lab reflection', workflow_state: 'read', starred: false, subscribed: true, private: true,
      context_code: `course_${COURSE_ID}`, context_name: course.name, participants: participants(TEACHER_ID, '8001'),
      messages: [ // newest first, like Canvas
        message('8001', 'That makes sense, thank you! I’ll add it to my reflection.', ago(2, 1), [TEACHER_ID, '8001']),
        message(TEACHER_ID, 'Great question, Maya. Yes — if the lamp warmed the water, temperature is a variable you didn’t control, so it’s worth mentioning as a possible source of error.', ago(2, 3), [TEACHER_ID, '8001']),
        message('8001', 'Hi Ms. Rivera, should we also talk about how the lamp made the water warmer? I noticed the cups felt warm at the end.', ago(2, 6), [TEACHER_ID, '8001'])
      ]
    }
  ]

  // New ids start at the current time, not a fixed number: the device keeps synced Canvas
  // comments under "<host>:c:<comment id>" (db.js addFeedback) across app restarts, while this
  // store is rebuilt each session. A fixed start would hand the next session's first comment the
  // same id as the last session's, overwriting that record (possibly under another student).
  // Each write waits ≥60 ms, so a later seed always starts above every id handed out before it.
  return { teacher, students, course, assignments, submissions, topics, entries, conversations, nextId: now }
}

// ---------------------------------------------------------------------------------------------
// Store. One shared in-memory store per app session; tests can make isolated ones.
// ---------------------------------------------------------------------------------------------

const shared = {}

/** A fresh, isolated demo store (mostly for tests). Pass it to demoTransport() / resetDemo(). */
export function createDemoStore() { return { db: seed() } }

/** Restore the initial demo data (and fresh, "current" dates). Existing transports see the reset. */
export function resetDemo(store = shared) { store.db = seed() }

const dbOf = (store) => store.db || (store.db = seed())
const newId = (db) => String(db.nextId++)
const nowIso = () => new Date().toISOString()

// ---------------------------------------------------------------------------------------------
// Views: build API-shaped objects from the stored records (always returned as deep copies).
// ---------------------------------------------------------------------------------------------

function course(db, id) {
  if (String(id) !== COURSE_ID) throw notFound()
  return { ...db.course, total_students: db.students.length }
}

function assignment(db, cid, aid) {
  course(db, cid)
  const a = db.assignments[aid]
  if (!a) throw notFound()
  const subs = Object.values(db.submissions).filter(s => s.assignment_id === a.id)
  const { listed, ...out } = a
  return {
    ...out,
    // computed live so the Grade list's "N to grade" badge drops as the teacher posts grades
    needs_grading_count: subs.filter(needsGrading).length,
    has_submitted_submissions: subs.some(s => !!s.submitted_at)
  }
}

// same rule as grader.js's needsGrading, copied so this module stays dependency-free
// (grader.js pulls in the local database and file readers)
function needsGrading(s) {
  return s.workflow_state === 'pending_review' || (s.workflow_state === 'submitted' && !!s.submitted_at) ||
    (!!s.submitted_at && s.grade_matches_current_submission === false)
}

function student(db, uid) {
  const s = db.students.find(x => x.id === String(uid))
  if (!s) throw notFound()
  return s
}

function findSub(db, cid, aid, uid) {
  assignment(db, cid, aid)
  const s = db.submissions[`${aid}:${uid}`]
  if (!s) throw notFound()
  return s
}

function subView(db, s, { withAssignment = false } = {}) {
  const out = { ...s, user: { ...student(db, s.user_id) } }
  if (withAssignment) out.assignment = assignment(db, COURSE_ID, s.assignment_id)
  return out
}

function topicOf(db, cid, tid) {
  course(db, cid)
  const t = db.topics.find(x => x.id === String(tid))
  if (!t) throw notFound()
  return t
}

function topicView(db, t) {
  const list = db.entries.filter(e => e.topic_id === t.id)
  return {
    ...t,
    discussion_subentry_count: list.length,
    last_reply_at: list.reduce((m, e) => (!m || e.created_at > m ? e.created_at : m), t.last_reply_at)
  }
}

function personName(db, id) {
  return id === TEACHER_ID ? db.teacher.name : db.students.find(s => s.id === id)?.name || 'Unknown'
}

function entryView(db, e) {
  return {
    id: e.id, user_id: e.user_id, user_name: personName(db, e.user_id), parent_id: e.parent_id,
    created_at: e.created_at, updated_at: e.created_at, message: e.message, read_state: 'read', rating_count: null, rating_sum: null
  }
}

/** GET .../discussion_topics/:id/view — the threaded tree plus everyone who posted. */
function discussionView(db, t) {
  const list = db.entries.filter(e => e.topic_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const build = (parentId) => list.filter(e => e.parent_id === parentId).map(e => {
    const node = { ...entryView(db, e) }
    delete node.user_name // the real view endpoint puts names in participants, not on entries
    const replies = build(e.id)
    if (replies.length) node.replies = replies // Canvas omits the key when there are none
    return node
  })
  const ids = [...new Set(list.map(e => e.user_id))]
  return {
    unread_entries: [], forced_entries: [], entry_ratings: {}, new_entries: [],
    participants: ids.map(id => ({ id, display_name: personName(db, id), avatar_image_url: null, html_url: `${DEMO_ORIGIN}/courses/${COURSE_ID}/users/${id}` })),
    view: build(null)
  }
}

function convoOf(db, id) {
  const c = db.conversations.find(x => x.id === String(id))
  if (!c) throw notFound()
  return c
}

function convoSummary(c) {
  const { messages, ...rest } = c
  const last = messages[0]
  const mine = messages.find(m => m.author_id === TEACHER_ID)
  return {
    ...rest,
    last_message: last?.body || '', last_message_at: last?.created_at || null,
    last_authored_message: mine?.body || null, last_authored_message_at: mine?.created_at || null,
    message_count: messages.length, audience: rest.participants.map(p => p.id).filter(id => id !== TEACHER_ID),
    properties: mine ? ['last_author'] : [], avatar_url: null
  }
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

/** Turn a posted_grade into { score, grade } the way Canvas does for these assignments. */
function parseGrade(raw, a) {
  const s = String(raw).trim()
  const possible = Number(a.points_possible) || 0
  if (/^(complete|pass)$/i.test(s)) return { score: possible, grade: 'complete' }
  if (/^(incomplete|fail)$/i.test(s)) return { score: 0, grade: 'incomplete' }
  const pct = s.match(/^(-?\d+(?:\.\d+)?)\s*%$/)
  if (pct) return { score: Math.round(possible * Number(pct[1])) / 100, grade: `${Number(pct[1])}%` }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return { score: Number(s), grade: String(Number(s)) }
  throw rejected(`“${s}” is not a valid grade for this assignment.`)
}

/** PUT .../submissions/:userId — grade, comment and/or rubric assessment for one student. */
function gradeSubmission(db, cid, aid, uid, body) {
  const s = findSub(db, cid, aid, uid)
  const a = db.assignments[aid]
  const b = body || {}
  const when = nowIso()
  let result = null // { score, grade } once a grade is set, '' when cleared

  if (b.submission && typeof b.submission === 'object' && 'posted_grade' in b.submission) { // `in` throws on non-objects
    const g = b.submission.posted_grade
    result = g === null || g === undefined || String(g).trim() === '' ? '' : parseGrade(g, a)
  }
  if (b.rubric_assessment && typeof b.rubric_assessment === 'object') {
    const ra = {}
    for (const c of a.rubric || []) {
      const v = b.rubric_assessment[c.id]
      if (!v || typeof v !== 'object') continue // unknown criteria are ignored, like Canvas
      const points = v.points === '' || v.points == null ? null : Number(v.points)
      if (points != null && !Number.isFinite(points)) throw rejected(`points for “${c.description}” must be a number.`)
      ra[c.id] = { rating_id: c.ratings?.find(r => r.points === points)?.id ?? null, comments: String(v.comments || ''), points }
    }
    if (Object.keys(ra).length) {
      s.rubric_assessment = ra
      // with "use this rubric for grading", Canvas scores from the rubric when no grade is sent
      if (result === null && a.use_rubric_for_grading) {
        const score = Object.values(ra).reduce((t, x) => t + (Number(x.points) || 0), 0)
        result = { score, grade: String(score) }
      }
    }
  }
  if (result === '') {
    Object.assign(s, { score: null, grade: null, entered_score: null, entered_grade: null, graded_at: null, grader_id: null, posted_at: null,
      workflow_state: s.submitted_at ? 'submitted' : 'unsubmitted' })
  } else if (result) {
    Object.assign(s, {
      score: result.score, grade: result.grade, entered_score: result.score, entered_grade: result.grade,
      workflow_state: 'graded', graded_at: when, posted_at: when, grader_id: TEACHER_ID,
      grade_matches_current_submission: true, excused: false, missing: false
    })
  }
  const text = typeof b.comment?.text_comment === 'string' ? b.comment.text_comment.trim() : ''
  if (text) {
    s.submission_comments.push({
      id: newId(db), author_id: TEACHER_ID, author_name: db.teacher.name,
      author: { id: TEACHER_ID, display_name: db.teacher.name, avatar_image_url: null },
      comment: text, created_at: when, edited_at: null
    })
  }
  return subView(db, s)
}

function addEntry(db, t, parentId, body) {
  const message = typeof body?.message === 'string' ? body.message : ''
  if (!message.replace(/<[^>]*>/g, '').trim()) throw rejected('the message is empty.')
  const e = { id: newId(db), topic_id: t.id, user_id: TEACHER_ID, parent_id: parentId, created_at: nowIso(), message }
  db.entries.push(e)
  return entryView(db, e)
}

/** POST .../discussion_topics — an announcement when is_announcement is set, else a discussion. */
function createTopic(db, cid, body) {
  course(db, cid)
  const b = body || {}
  const yes = (v) => v === true || v === 'true' || v === 1 || v === '1'
  let delayed = null
  if (b.delayed_post_at) {
    delayed = new Date(b.delayed_post_at)
    if (Number.isNaN(delayed.getTime())) throw rejected('the scheduled date is not valid.')
  }
  const now = new Date()
  const id = newId(db)
  const t = {
    id, title: String(b.title || '').trim() || 'No Title', message: String(b.message || ''),
    is_announcement: yes(b.is_announcement), published: b.published === undefined ? true : yes(b.published),
    // a future delayed_post_at means "scheduled": not posted yet
    posted_at: delayed && delayed > now ? null : now.toISOString(),
    delayed_post_at: delayed ? delayed.toISOString() : null,
    discussion_type: 'threaded', locked: false, read_state: 'read', unread_count: 0,
    user_name: db.teacher.name, author: { id: TEACHER_ID, display_name: db.teacher.name, avatar_image_url: null },
    last_reply_at: null, context_code: `course_${COURSE_ID}`, html_url: null // no demo website: see topic() in seed()
  }
  db.topics.push(t)
  return topicView(db, t)
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

const byDate = (key) => (a, b) => String(b[key] || '').localeCompare(String(a[key] || ''))
const C = '/api/v1/courses/(\\d+)'

const routes = [
  ['GET', '/api/v1/users/self', (db) => db.teacher],
  ['GET', '/api/v1/courses', (db) => [course(db, COURSE_ID)]],
  ['GET', C, (db, [cid]) => course(db, cid)],

  ['GET', `${C}/assignments`, (db, [cid]) => {
    course(db, cid)
    return Object.values(db.assignments).filter(a => a.listed).map(a => assignment(db, cid, a.id))
      .sort((x, y) => String(x.due_at).localeCompare(String(y.due_at)))
  }],
  ['GET', `${C}/assignments/(\\d+)`, (db, [cid, aid]) => assignment(db, cid, aid)],
  ['GET', `${C}/assignments/(\\d+)/submissions`, (db, [cid, aid]) => {
    assignment(db, cid, aid)
    // one row per enrolled student, including "unsubmitted" ones, like Canvas
    return db.students.map(st => db.submissions[`${aid}:${st.id}`]).filter(Boolean).map(s => subView(db, s))
  }],
  ['GET', `${C}/assignments/(\\d+)/submissions/(\\d+)`, (db, [cid, aid, uid]) => subView(db, findSub(db, cid, aid, uid))],
  ['PUT', `${C}/assignments/(\\d+)/submissions/(\\d+)`, (db, [cid, aid, uid], q, body) => gradeSubmission(db, cid, aid, uid, body)],
  // anonymous_submissions/... has no route: demo assignments are not anonymous, so it 404s

  ['GET', `${C}/(?:users|students)`, (db, [cid], q) => {
    course(db, cid)
    const types = q.getAll('enrollment_type[]').concat(q.getAll('enrollment_type'))
    if (types.length && !types.includes('student')) return types.includes('teacher') ? [db.teacher] : []
    const only = q.getAll('user_ids[]')
    return db.students.filter(s => !only.length || only.includes(s.id))
  }],
  ['GET', `${C}/students/submissions`, (db, [cid], q) => {
    course(db, cid)
    const ids = q.getAll('student_ids[]')
    // Canvas defaults to the caller (the teacher, who has no submissions); "all" means everyone
    const want = ids.includes('all') ? null : new Set(ids)
    const assignmentIds = q.getAll('assignment_ids[]')
    return Object.values(db.submissions)
      .filter(s => (!want || want.has(s.user_id)) && (!assignmentIds.length || assignmentIds.includes(s.assignment_id)))
      .sort(byDate('submitted_at'))
      .map(s => subView(db, s, { withAssignment: true }))
  }],

  ['GET', `${C}/discussion_topics`, (db, [cid], q) => {
    course(db, cid)
    const announcements = /^(1|true)$/.test(q.get('only_announcements') || '')
    return db.topics.filter(t => t.is_announcement === announcements).map(t => topicView(db, t)).sort(byDate('last_reply_at'))
  }],
  ['POST', `${C}/discussion_topics`, (db, [cid], q, body) => createTopic(db, cid, body)],
  ['GET', `${C}/discussion_topics/(\\d+)`, (db, [cid, tid]) => topicView(db, topicOf(db, cid, tid))],
  ['GET', `${C}/discussion_topics/(\\d+)/view`, (db, [cid, tid]) => discussionView(db, topicOf(db, cid, tid))],
  ['GET', `${C}/discussion_topics/(\\d+)/entries`, (db, [cid, tid]) => {
    const t = topicOf(db, cid, tid)
    return db.entries.filter(e => e.topic_id === t.id && !e.parent_id).map(e => entryView(db, e)).sort(byDate('created_at'))
  }],
  ['POST', `${C}/discussion_topics/(\\d+)/entries`, (db, [cid, tid], q, body) => addEntry(db, topicOf(db, cid, tid), null, body)],
  ['POST', `${C}/discussion_topics/(\\d+)/entries/(\\d+)/replies`, (db, [cid, tid, eid], q, body) => {
    const t = topicOf(db, cid, tid)
    if (!db.entries.some(e => e.topic_id === t.id && e.id === eid)) throw notFound()
    return addEntry(db, t, eid, body)
  }],

  ['GET', '/api/v1/announcements', (db, m, q) => {
    const codes = new Set(q.getAll('context_codes[]'))
    return db.topics.filter(t => t.is_announcement && codes.has(t.context_code))
      .map(t => topicView(db, t))
      .sort((a, b) => String(b.posted_at || b.delayed_post_at).localeCompare(String(a.posted_at || a.delayed_post_at)))
  }],

  ['GET', '/api/v1/conversations', (db, m, q) => {
    const scope = q.get('scope') || 'inbox'
    const keep = {
      unread: c => c.workflow_state === 'unread',
      starred: c => c.starred,
      archived: c => c.workflow_state === 'archived',
      sent: c => c.messages.some(x => x.author_id === TEACHER_ID)
    }[scope] || (c => c.workflow_state !== 'archived')
    return db.conversations.filter(keep).map(convoSummary).sort(byDate('last_message_at'))
  }],
  ['GET', '/api/v1/conversations/unread_count', (db) => ({ unread_count: String(db.conversations.filter(c => c.workflow_state === 'unread').length) })],
  ['GET', '/api/v1/conversations/(\\d+)', (db, [id], q) => {
    const c = convoOf(db, id)
    // Canvas marks a conversation read when it is opened, unless auto_mark_as_read is false
    if (!/^(0|false)$/.test(q.get('auto_mark_as_read') || '') && c.workflow_state === 'unread') c.workflow_state = 'read'
    return { ...convoSummary(c), messages: c.messages }
  }],
  ['PUT', '/api/v1/conversations/(\\d+)', (db, [id], q, body) => {
    const c = convoOf(db, id)
    const u = body?.conversation || {}
    if (u.workflow_state !== undefined) {
      if (!['read', 'unread', 'archived'].includes(u.workflow_state)) throw rejected('unknown conversation state.')
      c.workflow_state = u.workflow_state
    }
    if (u.starred !== undefined) c.starred = u.starred === true || u.starred === 'true'
    if (u.subscribed !== undefined) c.subscribed = u.subscribed === true || u.subscribed === 'true'
    return convoSummary(c)
  }],
  ['POST', '/api/v1/conversations/(\\d+)/add_message', (db, [id], q, body) => {
    const c = convoOf(db, id)
    const text = typeof body?.body === 'string' ? body.body.trim() : ''
    if (!text) throw rejected('the message is empty.')
    c.messages.unshift({
      id: newId(db), created_at: nowIso(), body: text, author_id: TEACHER_ID, generated: false, media_comment: null,
      forwarded_messages: [], attachments: [], participating_user_ids: c.participants.map(p => p.id)
    })
    c.workflow_state = 'read' // replying reads the conversation
    // Canvas answers with the conversation; here it carries the whole thread (handy for the UI)
    return { ...convoSummary(c), messages: c.messages }
  }]
].map(([method, pattern, handler]) => [method, new RegExp(`^${pattern}$`), handler])

/**
 * A transport for the Canvas class that answers from the in-memory demo store.
 * @param {object} [store] from createDemoStore(); defaults to the shared session store
 * @param {{ delay?: [number, number] }} [options] random latency range in ms (default 60–150) so
 *   spinners appear as they would with a real Canvas; tests pass [0, 0]
 */
export function demoTransport(store = shared, { delay = [60, 150] } = {}) {
  return async (path, { method = 'GET', body } = {}) => {
    const [min, max] = Array.isArray(delay) ? delay : [Number(delay) || 0, Number(delay) || 0]
    const ms = min + Math.random() * Math.max(0, max - min)
    if (ms > 0) await new Promise(r => setTimeout(r, ms))
    let u
    try { u = new URL(path, DEMO_ORIGIN) } catch { throw notFound() }
    if (u.origin !== DEMO_ORIGIN) throw notFound()
    const p = u.pathname.replace(/\/+$/, '') || '/'
    const verb = String(method).toUpperCase()
    // copy the body so the caller changing its object later cannot change what was stored
    let input = body
    if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = {} } }
    input = clone(input)
    const db = dbOf(store)
    for (const [m, re, handler] of routes) {
      if (m !== verb) continue
      const match = p.match(re)
      if (match) return clone(handler(db, match.slice(1), u.searchParams, input))
    }
    throw notFound()
  }
}
