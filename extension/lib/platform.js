// What this host can do. The browser extension's copy (the phone app ships its own lib/platform.js).
// Shared screens check these flags instead of assuming browser tabs exist.

export const platform = {
  kind: 'extension',
  phone: false,
  /** Reading and acting on web pages. */
  pages: true,
  /** Folder access on this computer (File System Access API). */
  folders: true,
  /** Trusted clicks through the browser's debugger. */
  nativeInput: true,
  /** Canvas through the teacher's signed-in browser tab. */
  canvasViaTab: true,
  version: () => chrome.runtime.getManifest().version,
  asset: (p) => chrome.runtime.getURL(p),
  openUrl: (url) => chrome.tabs.create({ url }),
  openPermissionPage: (query = '') => chrome.tabs.create({ url: chrome.runtime.getURL(`permission.html${query}`) }),
  /** Phones only: live camera for the voice tutor. */
  camera: null,
  /** Phones only: share sheet. */
  share: null
}
