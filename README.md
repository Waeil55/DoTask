# DoTask 2.0 — AI for teaching, studying and getting things done

DoTask is a Chrome/Edge extension that opens as a side panel next to any website. It runs **entirely in your browser** on **your own free AI key**: no DoTask server, no hosting bill, no subscription.

| Tab | What it does |
|---|---|
| **⚡ Do** | Tell it a task in plain words. It reads the page, scrolls, clicks, types and fills forms, using your own logins. That includes content inside embedded frames (course players, rich-text editors, widgets from other sites). You choose how much freedom it gets. |
| **🍎 Teach** | Canvas assistant. It drafts grades and feedback for each submission (rubric-aware) and you review before anything posts. It keeps every student's grades and comments (loaded automatically the first time you open a student), replies to students' submission comments, and writes Inbox replies, discussion replies and announcements. |
| **🎓 Study** | Tutor for any page, PDF, Word, PowerPoint or Excel file. It explains, summarizes, quizzes you and makes flashcards. **Guided course mode**: press **Next page ›** (or tell the voice tutor "next") to move through an online lesson together. **Live voice tutor**: talk naturally, interrupt anytime, it can see your screen and scroll the page. |
| **✉️ Write** | Reply to any email, comment or post, or write something new. Insert it into the page, copy it, or save it as a Word document. |
| **⚙️ Settings** | AI key and models, voice, permissions, your grading style, folder access, usage meter, backup, activity log. |

---

## Install (3 minutes)

1. **Remove the old DoTask extension** if it is installed: open `chrome://extensions` and click **Remove** on "DoTask — Chrome Agent".
2. On `chrome://extensions` (or `edge://extensions`), turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder `DoTask\extension`.
4. Pin DoTask (puzzle-piece icon → pin), then click it or press **Alt+Shift+D** to open the side panel.
5. Get a free AI key at **https://aistudio.google.com/apikey** → *Create API key* → copy it.
6. In DoTask → **Settings**, paste the key and press **Test connection**. Done.

**Check it against the real services (1 minute, free):** in this folder run `npm run smoke`, paste your key when asked. It checks that your key works, that DoTask's models exist for it, grading with the anti-mix-up reference, streaming, and a real spoken reply from the voice tutor. To also check your Canvas (read-only, nothing is posted), first set `CANVAS_URL` and `CANVAS_TOKEN` (Canvas → Account → Settings → New access token).

> Sharing with colleagues: send them **https://dotask5.web.app**. They download the zip, unzip it and follow steps 2–6 (choosing the unzipped folder in step 3). To publish for one-click install, upload the same zip to the Chrome Web Store ($5 one-time developer fee).

---

## How permission works

The **Do** tab has three modes:

- **Review all**: DoTask asks before every click or keystroke.
- **Ask if risky** (default): it works on its own but stops for your OK before anything that **sends, submits, posts, buys, deletes, grades or creates a file**.
- **Autopilot**: it does everything without asking.

In every mode:
- **Stop** (in the panel, or the red button DoTask shows on the page) halts it instantly.
- It **never types passwords, one-time codes, card or bank numbers, or ID numbers**. It asks you to do those yourself.
- It treats text on web pages and in emails as untrusted, so instructions hidden in a page can't take it over.
- Everything it does is written to the **Activity log** (Settings → Your data).

Grading has its own switch: drafts always wait for your review unless you tick **Auto-post** for that run.

## How DoTask never mixes up students

1. **One AI request = one student's one submission.** Submissions are never batched together.
2. **Names never go to the AI.** Each request carries a random one-time reference that the AI must echo back. If it doesn't match, the draft is thrown away.
3. Every record is stored under **Canvas user ID + course + assignment + attempt**.
4. Before posting, DoTask **re-fetches that student's submission** and checks it is still the same person and attempt. If the student resubmitted, it refuses and asks you to redraft.
5. Each student gets their own color and name banner on the review card, and the button says **"Post to Jane"**.

6. Replies to a student's comment are re-checked the same way, and they only add a comment: they never change the grade.

This is covered by an automated end-to-end test (`npm run e2e`) with two students and prompt-injection text in a submission.

## My Files (secure access to your computer)

Settings → **My files** → **Add folder** (for example `Documents\Teaching`). DoTask can then:
- open Word, PowerPoint, Excel, PDF, text and image files in **Study** (📁 My files) and in **Do** tasks ("open my unit 3 lesson plan and make a quiz from it");
- create new Word documents ("write a parent letter about the field trip and save it as Word").

It sees **only the folders you add**, Chrome asks you to allow access, it **never overwrites** an existing file, and creating a file counts as a risky step that needs your OK.

Why not an .exe? A browser extension works inside your real browser with your real logins, and heavy sites like Canvas, Gmail and Microsoft 365 work normally. A separate program needs its own built-in browser, which those sites often treat as a bot. It would also need a paid code-signing certificate and far broader access to your computer. Controlling desktop apps (the Word/Excel programs themselves) would need a small optional helper later.

## Cost and privacy

- **$0** with a free Gemini key. DoTask uses the cheapest suitable model for each job (flash-lite for web steps, flash for grading and tutoring). If one model's free daily limit runs out, it switches to another free model automatically.
- **Important for student records:** on the free tier, Google may use requests to improve its models. Student names are never sent, but submission text is. For real student data, use a **paid-tier key** (roughly a few cents for a whole class of essays) or a **local model** (Settings → Other / local → Ollama). Settings → Usage shows your requests and estimated cost.
- All data (student history, drafts, study files, settings) lives **only in this browser**. Use **Back up / Restore** to move it to another computer.

## What DoTask won't do (on purpose)

- **Take graded quizzes or exams for a student, or click through course or training content just to mark it complete.** It teaches the material so the learner can pass it themselves. Guided course mode only presses *Next / Continue* when you ask, and never presses Submit, Finish or Mark complete. Faked completions of required training (for example healthcare compliance courses) can put people at risk and get the learner in trouble.
- **Solve CAPTCHAs or get around site restrictions, paywalls or bot checks.**
- **Type passwords or payment details.**

## For organizations (enterprise rollout)

IT can force-install DoTask and lock its settings with Chrome policy:
- **ExtensionInstallForcelist**: install it on every managed browser.
- **3rdparty → extensions → \<DoTask id\>**: managed settings, defined in [`extension/managed_schema.json`](extension/managed_schema.json).

Example managed configuration:

```json
{
  "provider": "gemini",
  "geminiApiKey": "<organization paid-tier key>",
  "permissionMode": "smart",
  "allowAutopilot": false,
  "blockedSites": ["payroll.example.org", "bank.example.com"],
  "lockSettings": true
}
```

## Developers

```
extension/            the whole app (Manifest V3, no build step)
  sidepanel.*         UI shell; views/ holds one file per tab
  content.js          page reader/actor (runs in every frame) + Canvas same-origin API bridge
  lib/ai.js           Gemini + OpenAI-compatible client, free-model fallback
  lib/agent.js        browser agent loop and permission gate
  lib/canvas.js       Canvas REST client (signed-in tab, phone sign-in, token, or Demo School)
  lib/demo-canvas.js  Demo School: fictional class that runs inside the app (for trying DoTask and App Review)
  lib/platform.js     what this host can do (the phone app ships its own copy)
  lib/grader.js       grading pipeline with the anti-mix-up checks
  lib/live.js         Gemini Live real-time voice
  lib/files.js        PDF/Word/PowerPoint/Excel reading (no libraries)
  lib/docx.js         Word writer; lib/localfiles.js folder access
site/                 download page (npm run deploy)
tests/unit.test.mjs   unit tests           → npm test   (tests/demo-canvas.test.mjs covers Demo School)
tests/real-ai.mjs     the same journeys against the real Gemini API (needs GEMINI_API_KEY) → npm run real
mobile/               the phone app (see below)
tests/e2e.mjs         real-Chromium test (20 checks): mock Canvas, mock Gemini + Live voice, cross-site frames → npm run e2e
tools/                icons, pack (zip), screenshots, smoke (real Gemini/Live/Canvas check → npm run smoke)
_archive/v1/          the previous version (kept, not used)
```

Requires Node 22+ for tests (`npm install` once, which pulls in Playwright). The extension itself needs nothing installed.

## Phone app (iPhone and Android)

`mobile/` is the same app for phones, built with Capacitor. There is no separate code base: `mobile/build.mjs` copies the extension's shared screens and libraries into `mobile/www`, then layers the phone versions of a few files on top (`mobile/src`). The shared screens check `platform` flags instead of assuming browser tabs exist.

| | Browser extension | Phone app |
|---|---|---|
| Canvas | your signed-in Canvas tab | sign in through the browser (OAuth, your school's developer key), or **Demo School** |
| Study | the page you are on, files | photo of a page, files, pasted text |
| Voice tutor | sees your screen, moves through lessons | sees through the camera ("Show my camera") |
| Write | inserts into the page | share sheet, copy, save as Word |
| Web tasks | yes | no (a phone app cannot drive other apps) |
| Keys | browser storage | iOS Keychain / Android Keystore |

```
cd mobile
npm ci
node build.mjs                      # add --internal for a test build that allows a personal Canvas token
node tests/mobile-e2e.mjs           # phone-sized browser test (BROWSER=msedge on this PC; SHOTS=1 saves store screenshots)
npx cap sync                        # copy www into the iOS and Android projects
```

- **Android:** see `mobile/ANDROID.md` (debug APK, upload key, release bundle, Play Console steps).
- **iPhone:** see `mobile/IOS.md`. Builds run on GitHub's cloud Macs (`.github/workflows/ios.yml`), because Xcode only runs on a Mac.
- **Store listings, privacy answers and review notes:** `mobile/store/`. Privacy and support pages: `site/privacy.html`, `site/support.html`.

The phone app is for adults (18+), because Google's Gemini API terms do not allow apps meant for people under 18. Canvas sign-in on phones uses OAuth because Instructure's API policy does not allow apps to ask users for personal access tokens.

**Download site:** `site/` is a small static page that offers the zip. `npm run deploy` packs the extension, builds the page into `dist/site` and publishes it to Firebase Hosting (`dotask5.web.app`, hosting only). `npm run deploy -- --dry` builds without publishing.

**Old version cleanup:** v1's Cloud Run service was deleted on 2026-11-07. In project `dotask5`, v1 still leaves about 5 GB of container images (Artifact Registry repository `dotask`), which cost a small monthly storage fee, plus a Cloud Build bucket and two saved secrets. v2 uses none of them. Keep Firebase Hosting: the download site uses it.
