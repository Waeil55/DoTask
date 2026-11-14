// Canvas sign-in for the phone app: OAuth2 authorization code + PKCE through the system browser
// (SFSafariViewController / Chrome Custom Tabs). The teacher signs in on their school's own Canvas
// page; DoTask never sees the password. Instructure requires OAuth for apps used by many people,
// so the school's Canvas admin creates a developer key and gives the teacher its Client ID.
//
// Redirect URI (the admin enters this on the developer key):  com.agapecare.dotask:/oauth/canvas
// It is registered as a URL scheme in Info.plist and as an intent filter in AndroidManifest.xml.

import { Browser, App, isNative } from './native.js'
import { bytesToBase64 } from './util.js'

export const REDIRECT_URI = 'com.agapecare.dotask:/oauth/canvas'
const SIGN_IN_LIMIT_MS = 10 * 60 * 1000

const b64url = (bytes) => bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)))

async function pkce() {
  const verifier = random(48) // 64 chars, inside RFC 7636's 43–128
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  return { verifier, challenge: b64url(digest) }
}

class OAuthError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'CanvasError'; this.status = status }
}

/** POST to Canvas's token endpoint (goes through native HTTP: Canvas sends no CORS headers). */
async function tokenRequest(origin, params) {
  const res = await fetch(`${origin}/login/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch {}
  if (!res.ok || !data.access_token) {
    const why = data.error_description || data.error || `HTTP ${res.status}`
    throw new OAuthError(res.status === 400 || res.status === 401
      ? `Canvas did not accept the sign-in (${why}). Sign in again, or ask your Canvas admin to check DoTask's developer key.`
      : `Canvas sign-in failed (${why}).`, res.status || 400)
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || params.refresh_token || '',
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    user: data.user || null
  }
}

/** Opens the school's Canvas sign-in page and resolves with tokens once Canvas redirects back. */
export async function signIn({ origin, clientId, clientSecret = '' }) {
  if (!isNative) throw new OAuthError('Canvas sign-in works in the installed app.')
  const { verifier, challenge } = await pkce()
  const state = random(16)
  const url = new URL('/login/oauth2/auth', origin)
  url.search = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI, state,
    code_challenge: challenge, code_challenge_method: 'S256'
  }).toString()

  const code = await new Promise((resolve, reject) => {
    const handles = []
    let done = false
    let closedTimer = null
    const finish = (fn, v) => {
      if (done) return
      done = true
      clearTimeout(limit); clearTimeout(closedTimer)
      handles.forEach(h => h.then(x => x.remove()).catch(() => {}))
      Browser.close().catch(() => {}) // iOS closes the sheet; Android brings the app back by itself
      fn(v)
    }
    const limit = setTimeout(() => finish(reject, new OAuthError('Canvas sign-in took too long. Try again.')), SIGN_IN_LIMIT_MS)
    handles.push(App.addListener('appUrlOpen', ({ url: back }) => {
      if (!back || !back.startsWith(REDIRECT_URI)) return
      const q = new URL(back.replace(REDIRECT_URI, 'https://redirect.invalid/')).searchParams
      if (q.get('state') !== state) return finish(reject, new OAuthError('Canvas sign-in did not match. Try again.'))
      if (q.get('error')) return finish(reject, new OAuthError(q.get('error') === 'access_denied' ? 'You cancelled the Canvas sign-in.' : `Canvas sign-in failed (${q.get('error_description') || q.get('error')}).`))
      if (!q.get('code')) return finish(reject, new OAuthError('Canvas did not send a sign-in code.'))
      finish(resolve, q.get('code'))
    }))
    // The learner closed the browser without finishing. On Android the redirect can arrive
    // just after the tab closes, so wait a moment before calling it cancelled.
    handles.push(Browser.addListener('browserFinished', () => {
      closedTimer = setTimeout(() => finish(reject, new OAuthError('Canvas sign-in was closed before it finished.')), 2500)
    }))
    Browser.open({ url: url.href, presentationStyle: 'popover' }).catch(e => finish(reject, e))
  })

  return tokenRequest(origin, {
    grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret,
    redirect_uri: REDIRECT_URI, code, code_verifier: verifier
  })
}

/** Canvas access tokens last about an hour; the refresh token gets a new one without a browser. */
export function refresh({ origin, clientId, clientSecret = '', refreshToken }) {
  return tokenRequest(origin, { grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken })
}

/** Signs DoTask out of Canvas (deletes the token on the Canvas side). Best effort. */
export async function revoke({ origin, accessToken }) {
  if (!accessToken) return
  await fetch(`${origin}/login/oauth2/token`, { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {})
}
