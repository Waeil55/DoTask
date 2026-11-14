// Local database (IndexedDB) — every record about a student is keyed by
// [canvasHost, canvasUserId] so two students can never share or overwrite records.

const DB_NAME = 'dotask'
const VERSION = 1
let dbPromise

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // students: one row per person per Canvas instance
      const students = db.createObjectStore('students', { keyPath: ['host', 'userId'] })
      students.createIndex('byName', 'sortableName')
      // feedback: every comment/grade/note ever seen or written, per student
      const fb = db.createObjectStore('feedback', { keyPath: 'id' })
      fb.createIndex('byStudent', ['host', 'userId'])
      fb.createIndex('byAssignment', ['host', 'courseId', 'assignmentId'])
      // drafts: AI grade drafts awaiting review, one per submission attempt
      const drafts = db.createObjectStore('drafts', { keyPath: ['host', 'courseId', 'assignmentId', 'userId', 'attempt'] })
      drafts.createIndex('byAssignment', ['host', 'courseId', 'assignmentId'])
      drafts.createIndex('byStudent', ['host', 'userId'])
      // study documents and tutor chats
      db.createObjectStore('docs', { keyPath: 'id' })
      // audit trail of everything the AI did or the user approved
      const audit = db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true })
      audit.createIndex('byTime', 'ts')
      db.createObjectStore('kv', { keyPath: 'k' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function store(name, mode = 'readonly') {
  const db = await open()
  return db.transaction(name, mode).objectStore(name)
}

export const db = {
  async get(name, key) { return wrap((await store(name)).get(key)) },
  async put(name, value) { return wrap((await store(name, 'readwrite')).put(value)) },
  async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)) },
  async all(name) { return wrap((await store(name)).getAll()) },
  async byIndex(name, index, key) { return wrap((await store(name)).index(index).getAll(key)) },
  async clear(name) { return wrap((await store(name, 'readwrite')).clear()) },
  async count(name) { return wrap((await store(name)).count()) }
}

// ---------- students ----------
export async function upsertStudent({ host, userId, name, sortableName, avatarUrl, courseId, courseName }) {
  if (!host || userId == null) throw new Error('Student record needs host and userId')
  const key = [host, String(userId)]
  const prev = (await db.get('students', key)) || { host, userId: String(userId), courses: {}, notes: '', createdAt: Date.now() }
  const next = {
    ...prev,
    name: name || prev.name,
    sortableName: sortableName || name || prev.sortableName,
    avatarUrl: avatarUrl || prev.avatarUrl,
    updatedAt: Date.now()
  }
  if (courseId) next.courses = { ...prev.courses, [courseId]: courseName || prev.courses?.[courseId] || '' }
  await db.put('students', next)
  return next
}

export async function getStudent(host, userId) {
  return db.get('students', [host, String(userId)])
}

export async function setStudentNotes(host, userId, notes) {
  const s = await getStudent(host, userId)
  if (!s) throw new Error('Unknown student')
  s.notes = notes
  s.updatedAt = Date.now()
  await db.put('students', s)
}

// ---------- feedback ----------
/**
 * kind: canvas-comment | posted | note | grade
 * Canvas comments use their Canvas id so re-syncing never duplicates them.
 */
export async function addFeedback(entry) {
  const { host, userId, kind } = entry
  if (!host || userId == null || !kind) throw new Error('Feedback needs host, userId, kind')
  const id = entry.id || (entry.canvasCommentId
    ? `${host}:c:${entry.canvasCommentId}`
    : `${host}:${userId}:${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`)
  const row = { ...entry, id, userId: String(userId), createdAt: entry.createdAt || Date.now() }
  await db.put('feedback', row)
  return row
}

export async function feedbackForStudent(host, userId) {
  const rows = await db.byIndex('feedback', 'byStudent', [host, String(userId)])
  // defensive: never return anything that is not this exact student
  return rows.filter(r => r.host === host && r.userId === String(userId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

// ---------- drafts ----------
export function draftKey({ host, courseId, assignmentId, userId, attempt }) {
  return [host, String(courseId), String(assignmentId), String(userId), Number(attempt) || 0]
}

export async function saveDraft(d) {
  const [host, courseId, assignmentId, userId, attempt] = draftKey(d)
  const row = { ...d, host, courseId, assignmentId, userId, attempt, updatedAt: Date.now() }
  await db.put('drafts', row)
  return row
}

export async function getDraft(k) { return db.get('drafts', draftKey(k)) }

export async function draftsForAssignment(host, courseId, assignmentId) {
  return db.byIndex('drafts', 'byAssignment', [host, String(courseId), String(assignmentId)])
}

// ---------- audit ----------
export async function audit(action, details = {}) {
  try {
    await db.put('audit', { ts: Date.now(), action, ...details })
  } catch (e) {
    console.warn('audit failed', e)
  }
}

export async function recentAudit(limit = 200) {
  const rows = await db.all('audit')
  return rows.sort((a, b) => b.ts - a.ts).slice(0, limit)
}

// ---------- backup ----------
const STORES = ['students', 'feedback', 'drafts', 'docs', 'audit', 'kv']

export async function exportAll() {
  const out = { app: 'DoTask', version: 2, exportedAt: new Date().toISOString() }
  for (const s of STORES) out[s] = await db.all(s)
  return out
}

export async function importAll(data) {
  if (data?.app !== 'DoTask') throw new Error('This is not a DoTask backup file')
  let n = 0
  for (const s of STORES) {
    for (const row of data[s] || []) {
      if (s === 'audit') delete row.id
      await db.put(s, row)
      n++
    }
  }
  return n
}

export async function wipeAll() {
  for (const s of STORES) await db.clear(s)
  // the phone app also deletes its safety copy, so wiped data never comes back
  globalThis.dispatchEvent?.(new Event('dotask:wiped'))
}
