// Canvas LMS client. Transports:
// - session: the teacher's own signed-in Canvas tab (browser extension; same-origin requests from content.js)
// - oauth:   phones; OAuth2 + PKCE sign-in with the school's developer key, token refreshed automatically
// - token:   a personal access token (extension settings, or internal phone builds for testing)
// - demo:    Demo School, fictional sample data that never leaves the device

import { parseLinkHeader } from './util.js'
import * as tabs from './tabs.js'
import { platform } from './platform.js'

export class CanvasError extends Error {
  constructor(message, status) { super(message); this.name = 'CanvasError'; this.status = status }
}

function friendly(status, error, mode = 'session') {
  if (status === 401) return mode === 'token'
    ? 'Canvas did not accept the access token. Check the Canvas address, or make a new token in Canvas → Account → Settings.'
    : mode === 'oauth' ? 'Your Canvas sign-in has expired. Sign in again.'
      : 'Canvas says you are not signed in. Sign in to Canvas in this tab and try again.'
  if (status === 403) return `Canvas denied this (${error || 'no permission'}). Your role may not allow it.`
  if (status === 404) return 'Canvas could not find that item (it may have been deleted).'
  if (status === 422) return `Canvas rejected the data: ${error}`
  return `Canvas error ${status}: ${error}`
}

function tabTransport(tabId) {
  return async (path, { method = 'GET', body, all = false } = {}) => {
    const r = await tabs.send(tabId, { type: 'canvasFetch', path, method, body, all })
    if (!r) throw new CanvasError('The Canvas tab did not answer. Reload it and try again.')
    if (!r.ok) throw new CanvasError(friendly(r.status, r.error), r.status)
    return r.data
  }
}

/** Bearer-token REST transport. getToken(force) returns the current token (force = get a fresh one). */
function bearerTransport(origin, getToken, mode) {
  return async (path, { method = 'GET', body, all = false } = {}) => {
    const out = []
    let next = new URL(path, origin).href
    let pages = 0
    let retried = false
    while (next) {
      // never send the token anywhere but the teacher's own Canvas
      if (new URL(next).origin !== origin) throw new CanvasError('Canvas sent a link to another site, so DoTask stopped.')
      const headers = { Authorization: `Bearer ${await getToken(false)}`, Accept: 'application/json+canvas-string-ids, application/json' }
      if (body) headers['Content-Type'] = 'application/json'
      const res = await fetch(next, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text.replace(/^while\(1\);/, '')) : null } catch { data = text }
      // OAuth access tokens expire after about an hour: refresh once and repeat the same request
      if (res.status === 401 && mode === 'oauth' && !retried) { retried = true; await getToken(true); continue }
      if (!res.ok) throw new CanvasError(friendly(res.status, data?.errors?.[0]?.message || res.statusText, mode), res.status)
      if (!all || !Array.isArray(data)) return data
      out.push(...data)
      next = ++pages < 50 ? parseLinkHeader(res.headers.get('Link')).next : null
    }
    return out
  }
}

// Phones: the OAuth access token lives in memory only; the refresh token is in secure storage.
const oauth = { key: '', accessToken: '', expiresAt: 0, refreshing: null }

/** Keeps the access token from a fresh sign-in so the first requests don't need a refresh. */
export function rememberCanvasSignIn(origin, clientId, tokens) {
  Object.assign(oauth, { key: `${origin}|${clientId}`, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt })
}
/** Signs out on the Canvas side too (best effort) and forgets the in-memory token. */
export async function signOutCanvas(settings) {
  const token = oauth.accessToken
  Object.assign(oauth, { key: '', accessToken: '', expiresAt: 0 })
  try {
    if (token && settings?.canvasUrl) await platform.canvasAuth?.revoke({ origin: new URL(settings.canvasUrl).origin, accessToken: token })
  } catch {}
}

function oauthTokens(origin, settings) {
  const key = `${origin}|${settings.canvasClientId}`
  return async (force) => {
    if (!force && oauth.key === key && oauth.accessToken && Date.now() < oauth.expiresAt - 60_000) return oauth.accessToken
    if (!settings.canvasRefreshToken) throw new CanvasError(friendly(401, '', 'oauth'), 401)
    oauth.refreshing ||= platform.canvasAuth.refresh({ origin, clientId: settings.canvasClientId, clientSecret: settings.canvasClientSecret, refreshToken: settings.canvasRefreshToken })
      .then(t => { Object.assign(oauth, { key, accessToken: t.accessToken, expiresAt: t.expiresAt }); return t.accessToken })
      .catch(e => { throw e.status === 400 || e.status === 401 ? new CanvasError(friendly(401, '', 'oauth'), 401) : e })
      .finally(() => { oauth.refreshing = null })
    return oauth.refreshing
  }
}

let demoApi = null // Demo School keeps its changes (posted grades, replies) until the app restarts

export class Canvas {
  constructor({ transport, origin, tabId = null, mode }) {
    this.api = transport
    this.origin = origin
    this.host = new URL(origin).hostname
    this.tabId = tabId
    this.mode = mode
    this.me = null
  }

  /** Find Canvas: Demo School, then phone sign-in, then a token, then the active tab, then any open Canvas tab. */
  static async connect(settings) {
    if (settings.canvasDemo) {
      const { demoTransport, DEMO_ORIGIN } = await import('./demo-canvas.js')
      demoApi ||= demoTransport()
      const c = new Canvas({ transport: demoApi, origin: DEMO_ORIGIN, mode: 'demo' })
      c.me = await c.api('/api/v1/users/self')
      return c
    }
    let origin = ''
    try { if (settings.canvasUrl) origin = new URL(/^https?:/.test(settings.canvasUrl) ? settings.canvasUrl : 'https://' + settings.canvasUrl).origin } catch {}
    if (origin && settings.canvasClientId && platform.canvasAuth && (settings.canvasRefreshToken || oauth.key === `${origin}|${settings.canvasClientId}`)) {
      const getToken = oauthTokens(origin, settings)
      const c = new Canvas({ transport: bearerTransport(origin, getToken, 'oauth'), origin, mode: 'oauth' })
      c.getToken = getToken
      c.me = await c.api('/api/v1/users/self')
      return c
    }
    if (settings.canvasToken && origin) {
      const getToken = async () => settings.canvasToken
      const c = new Canvas({ transport: bearerTransport(origin, getToken, 'token'), origin, mode: 'token' })
      c.getToken = getToken
      c.me = await c.api('/api/v1/users/self')
      return c
    }
    if (!platform.canvasViaTab) return null
    const candidates = []
    const active = await tabs.getTargetTab()
    if (active) candidates.push(active)
    for (const t of await chrome.tabs.query({})) if (t.id !== active?.id && tabs.isControllable(t.url)) candidates.push(t)
    for (const t of candidates) {
      if (!tabs.isControllable(t.url)) continue
      let info
      try { info = await tabs.send(t.id, { type: 'canvasInfo' }) } catch { continue }
      if (!info?.isCanvas) continue
      const c = new Canvas({ transport: tabTransport(t.id), origin: info.origin, tabId: t.id, mode: 'session' })
      try { c.me = await c.api('/api/v1/users/self') } catch (e) { if (t === active) throw e; continue }
      c.pageInfo = info
      return c
    }
    return null
  }

  /** Link to Canvas in a browser (null in Demo School, which has no website). */
  webUrl(path) { return this.mode === 'demo' ? null : `${this.origin}${path}` }

  speedGraderUrl(courseId, assignmentId, userId) {
    if (this.mode === 'demo') return null
    return `${this.origin}/courses/${courseId}/gradebook/speed_grader?assignment_id=${assignmentId}${userId ? `&student_id=${userId}` : ''}`
  }

  async teachingCourses() {
    const all = await this.api('/api/v1/courses?enrollment_state=active&per_page=100&include[]=term&include[]=total_students', { all: true })
    const teach = all.filter(c => (c.enrollments || []).some(e => ['teacher', 'ta', 'designer'].includes(e.type)))
    return teach.length ? teach : all
  }

  assignments(courseId) {
    return this.api(`/api/v1/courses/${courseId}/assignments?per_page=100&order_by=due_at&include[]=rubric_assessment`, { all: true })
  }
  assignment(courseId, id) { return this.api(`/api/v1/courses/${courseId}/assignments/${id}`) }

  submissions(courseId, assignmentId) {
    return this.api(`/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?per_page=100&include[]=user&include[]=submission_comments&include[]=rubric_assessment`, { all: true })
  }
  submission(courseId, assignmentId, userId) {
    return this.api(`/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions/${userId}?include[]=user&include[]=submission_comments&include[]=rubric_assessment`)
  }
  students(courseId) {
    return this.api(`/api/v1/courses/${courseId}/users?enrollment_type[]=student&enrollment_state[]=active&per_page=100&include[]=avatar_url`, { all: true })
  }
  studentSubmissions(courseId, userId) {
    return this.api(`/api/v1/courses/${courseId}/students/submissions?student_ids[]=${userId}&include[]=assignment&include[]=submission_comments&include[]=rubric_assessment&per_page=100`, { all: true })
  }

  /** Post a grade and/or comment for exactly one student. */
  grade(courseId, assignmentId, { userId, anonymousId, postedGrade, comment, rubric }) {
    const body = {}
    if (postedGrade !== undefined && postedGrade !== null && postedGrade !== '') body.submission = { posted_grade: String(postedGrade) }
    if (comment) body.comment = { text_comment: comment }
    if (rubric && Object.keys(rubric).length) body.rubric_assessment = rubric
    const who = anonymousId ? `anonymous_submissions/${anonymousId}` : `submissions/${userId}`
    return this.api(`/api/v1/courses/${courseId}/assignments/${assignmentId}/${who}`, { method: 'PUT', body })
  }

  discussionTopics(courseId) {
    return this.api(`/api/v1/courses/${courseId}/discussion_topics?per_page=50&order_by=recent_activity`, { all: true })
  }
  discussionView(courseId, topicId) {
    return this.api(`/api/v1/courses/${courseId}/discussion_topics/${topicId}/view?include_new_entries=1`)
  }
  replyToEntry(courseId, topicId, entryId, message) {
    return this.api(`/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries/${entryId}/replies`, { method: 'POST', body: { message } })
  }
  postEntry(courseId, topicId, message) {
    return this.api(`/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries`, { method: 'POST', body: { message } })
  }

  announcements(courseId) {
    return this.api(`/api/v1/announcements?context_codes[]=course_${courseId}&per_page=10&active_only=true`)
  }
  /** Post (or schedule) an announcement to a whole course. */
  createAnnouncement(courseId, { title, message, delayedPostAt }) {
    const body = { title, message, is_announcement: true, published: true }
    if (delayedPostAt) body.delayed_post_at = new Date(delayedPostAt).toISOString()
    return this.api(`/api/v1/courses/${courseId}/discussion_topics`, { method: 'POST', body })
  }

  conversations(scope = 'unread') {
    return this.api(`/api/v1/conversations?scope=${scope}&per_page=50`)
  }
  conversation(id) { return this.api(`/api/v1/conversations/${id}?auto_mark_as_read=false`) }
  addMessage(id, body) { return this.api(`/api/v1/conversations/${id}/add_message`, { method: 'POST', body: { body } }) }
  markRead(id) { return this.api(`/api/v1/conversations/${id}`, { method: 'PUT', body: { conversation: { workflow_state: 'read' } } }) }

  /** Download a submission attachment. Attachment URLs carry a verifier, so no cookies are needed. */
  async download(url) {
    // Attachment links carry a verifier, and Canvas redirects them to file storage: sending the
    // token there would leak it (and storage rejects double auth). Only verifier-less links on the
    // teacher's own Canvas get the token.
    const u = new URL(url)
    const headers = this.getToken && u.origin === this.origin && !u.searchParams.has('verifier') ? { Authorization: `Bearer ${await this.getToken(false)}` } : {}
    const res = await fetch(url, { headers, credentials: 'include' })
    if (!res.ok) throw new CanvasError(`Could not download the file (${res.status})`, res.status)
    return new Uint8Array(await res.arrayBuffer())
  }
}

/** Plain-text view of a Canvas discussion entry tree (for AI context). */
export function flattenEntries(view) {
  const people = new Map((view.participants || []).map(p => [String(p.id), p.display_name]))
  const out = []
  const walk = (entries, depth) => {
    for (const e of entries || []) {
      if (e.deleted) continue
      out.push({ id: String(e.id), userId: String(e.user_id), name: people.get(String(e.user_id)) || 'Unknown', message: e.message || '', depth, createdAt: e.created_at, parentId: e.parent_id ? String(e.parent_id) : null })
      walk(e.replies, depth + 1)
    }
  }
  walk(view.view, 0)
  return out
}
