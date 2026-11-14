// Writes the fastlane `deliver` metadata folder (mobile/fastlane/metadata) from the reviewed listing text in
// mobile/store/app-store.md and mobile/store/review-notes.txt, so the two never drift apart.
//   node tools/make-fastlane-metadata.mjs
// The reviewer Gemini key and the review phone number are NOT written here: the "iOS App Store listing"
// workflow fills them in from repository secrets at upload time.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(here, rel), 'utf8').replace(/\r\n/g, '\n') // Windows line endings
const md = read('store/app-store.md')

/** The ```text block under the heading that starts with `title`. */
function block(title) {
  const at = md.indexOf(`## ${title}`)
  if (at < 0) throw new Error(`app-store.md has no "## ${title}" section`)
  const m = md.slice(at).match(/```text\n([\s\S]*?)\n```/)
  if (!m) throw new Error(`No text block under "${title}"`)
  return m[1].trim()
}

const LIMITS = { name: 30, subtitle: 30, promotional_text: 170, description: 4000, keywords: 100 }
const en = {
  name: block('App name'),
  subtitle: block('Subtitle'),
  promotional_text: block('Promotional text'),
  description: block('Description'),
  keywords: block('Keywords'),
  marketing_url: 'https://dotask5.web.app/',
  privacy_url: 'https://dotask5.web.app/privacy.html',
  support_url: 'https://dotask5.web.app/support.html'
}
for (const [k, max] of Object.entries(LIMITS)) {
  const n = [...en[k]].length
  if (n > max) throw new Error(`${k} is ${n} characters (limit ${max})`)
}
if (/\{\{/.test(Object.values(en).join(''))) throw new Error('A placeholder would reach the public listing')

const notes = read('store/review-notes.txt').trim()

const out = path.join(here, 'fastlane/metadata')
const files = {
  'copyright.txt': '2026 Agape Care',
  'primary_category.txt': 'EDUCATION',
  'secondary_category.txt': 'PRODUCTIVITY',
  ...Object.fromEntries(Object.entries(en).map(([k, v]) => [`en-US/${k}.txt`, v])),
  // the contact name and phone come from secrets in the listing workflow (this repo is public)
  'review_information/email_address.txt': 'waeil.usa@gmail.com',
  'review_information/demo_user.txt': '',
  'review_information/demo_password.txt': '',
  // keeps {{REVIEWER_GEMINI_KEY}}; the workflow replaces it from a secret and refuses to upload if it can't
  'review_information/notes.txt': notes
}
for (const [rel, text] of Object.entries(files)) {
  const p = path.join(out, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text + (text ? '\n' : ''))
}
console.log(`Wrote ${Object.keys(files).length} metadata files to ${path.relative(process.cwd(), out) || out}`)
console.log(Object.entries(LIMITS).map(([k, max]) => `  ${k}: ${[...en[k]].length}/${max}`).join('\n'))
console.log(`  review notes: ${[...notes].length}/4000 before the key is inserted`)
