// Phone-only stand-in for the extension's localfiles.js. Phones have no "folders on this
// computer"; documents are picked with the system file picker and saved through the share sheet
// (Save to Files, Google Drive, email, ...).

import { textToDocx } from './docx.js'
import { platform } from './platform.js'

const NO_FOLDERS = 'Folder access is only available in the DoTask browser extension.'

export function filesSupported() { return false }
export async function getFolders() { return [] }
export async function addFolder() { throw Object.assign(new Error(NO_FOLDERS), { name: 'AbortError' }) }
export async function removeFolder() {}
export async function permissionState() { return 'denied' }
export async function unlockFolders() { return [] }
export async function usableFolders() { return [] }
export async function listFiles() { return [] }
export async function readFile() { throw new Error(NO_FOLDERS) }
export async function writeFile() { throw new Error(NO_FOLDERS) }

/** "Save as Word" on a phone: builds the file and opens the share sheet. */
export async function downloadFile(name, text) {
  const docx = /\.docx$/i.test(name)
  const bytes = docx ? textToDocx(text, { title: name.replace(/\.docx$/i, '') }) : new TextEncoder().encode(text)
  const mimeType = docx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain'
  return platform.share({ title: name, file: { name, bytes, mimeType } })
}
