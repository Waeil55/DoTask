// Phone-only stand-in for the extension's tabs.js. Phones have no browser tabs that another app
// may read or control, so page features say so clearly instead of failing silently.

const NO_PAGES = 'Reading and controlling web pages needs the DoTask browser extension on a computer.'
const fail = async () => { throw new Error(NO_PAGES) }

export function pinTab() {}
export function setBlockedSites() {}
export function isControllable() { return false }
export async function getTargetTab() { return null }
export const ensureContent = fail
export const send = fail
export const snapshotAll = fail
export const readAll = fail
export async function pickFrame() { return 0 }
export const sendToFocusedFrame = fail
export async function clickNext() { return { ok: false, error: NO_PAGES } }
export const clickAt = fail
export async function waitForLoad() {}
export function normalizeUrl(s) { return String(s || '') }
export const navigate = fail
export const screenshot = fail
export async function hasNativePermission() { return false }
export async function requestNativePermission() { return false }
export async function detachNative() {}
export const nativeClick = fail
export const nativeType = fail
export const nativeKey = fail
