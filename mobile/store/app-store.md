# DoTask: App Store Connect listing (iPhone)

Version 2.1.0, bundle ID `com.agapecare.dotask`, iPhone only (`TARGETED_DEVICE_FAMILY = 1` in the Xcode project,
see mobile/IOS.md). Everything inside a ```text block is ready to paste.
Character counts were measured with a script on the exact text in each block (Apple counts characters, not bytes).

Rules this listing follows on purpose:
- "Canvas" and "Gemini" never appear in the name, subtitle, promotional text, keywords or icon text. They appear only
  in the description, introduced as "Works with Canvas LMS" and "uses Google Gemini with your own API key", and
  later only to describe what the app connects to (nominative use), with the non-affiliation line at the end.
- No other platforms (Android, Chrome) are mentioned, because App Review Guideline 2.3.10 rejects that.
- No placeholder may reach the public listing. `{{REVIEWER_GEMINI_KEY}}` belongs only in the private App Review
  Information section (the owner pastes a review-only key there).

---

## App name (limit 30): 29 characters

```text
DoTask: AI Teaching Assistant
```

Fallback if Apple says the name is taken: `DoTask: Teach, Study, Write` (27).

## Subtitle (limit 30): 30 characters

```text
Grading help and a study tutor
```

## Promotional text (limit 170): 168 characters

Promotional text can be changed at any time without a new build.

```text
Draft grades and feedback you review before posting, study with a voice tutor that sees through your camera, and write in any language. No account, no ads, no tracking.
```

## Description (limit 4000): 3,230 characters

```text
DoTask is an AI assistant for teachers and adult learners. It drafts grades and feedback for you to review, tutors you by voice, and helps you write. It uses Google Gemini with your own API key, which you can get free from Google AI Studio. There is no DoTask account, no subscription and no DoTask server.

TEACH
Works with Canvas LMS. Sign in to your school's Canvas through your browser, or explore the fictional Demo School with sample data first.
• Grading drafts: DoTask suggests rubric scores and feedback for a submission, following your rubric and your notes.
• You stay in charge: you review and edit each draft, then post it yourself, one student at a time. Nothing posts until you press the button with that student's name.
• Per-student history: each student's grades and comments are kept on your device and are never mixed between students.
• Grading prompts leave out student names.
• Drafts replies to submission comments, Inbox messages and discussions, and drafts announcements for your courses.

STUDY
• Take a photo of a page, upload a file (PDF, Word, text or images) or paste text.
• Ask for an explanation, a summary, a quiz, flashcards or a study plan.
• Live voice tutor: talk naturally, the way you would with a person. Turn on "Show my camera" and the tutor can see what your camera shows.
• The tutor explains and quizzes you so you learn the material yourself. It does not complete graded quizzes or exams for you.

WRITE
• Draft replies in any tone and any language.
• Translate and polish your own writing.
• Copy it, share it, or save it as a Word document.

YOUR KEY, YOUR DATA
• Uses Google Gemini with your own API key. A free key from Google AI Studio is enough to start. You can also connect an OpenAI-compatible provider you choose.
• Settings shows your usage and an estimated cost.
• Your settings, student history and drafts are stored only on your device. Your API key and Canvas sign-in are kept in the Keychain.
• DoTask asks your permission before it sends anything to the AI. Content is sent only when you use a feature, straight from your device to Google (or the provider you set up) and to your school's Canvas, over encrypted connections.
• No ads, no analytics, no tracking. The developer receives none of your data.
• Back up through the share sheet, or delete your data in Settings.

GOOD TO KNOW
• On a free-tier Gemini key, Google may use what you send to improve its products, and people may review it. For student records, use a paid-tier key with billing turned on; a whole class usually costs a few cents. In the EEA, the UK and Switzerland, Google's terms require a paid-tier key.
• Use DoTask as your school's policies allow, including FERPA and other student-privacy rules.
• AI output is always a draft. Check it before you post or share it.
• DoTask is for adults 18 and over.
• Connecting a real Canvas needs a developer key that your school's Canvas administrator creates once. Our support page has the settings to send them.
• The microphone and camera are used only after you tap to start the voice tutor or take a photo. Everything else works without them.

DoTask is an independent app. It is not affiliated with or endorsed by Instructure (Canvas) or Google.
```

## Keywords (limit 100): 99 characters

No spaces after commas (spaces waste characters). Words already in the name (DoTask, AI, teaching, assistant)
are indexed anyway, so they are not repeated. No trademarks, no competitor names.

```text
teacher,grading,rubric,feedback,tutor,study,flashcards,quiz,classroom,voice,summarize,translate,lms
```

## Category, price, URLs, copyright

| Field | Value |
|---|---|
| Primary category | Education |
| Secondary category | Productivity |
| Price | Free (tier 0). No in-app purchases, no subscriptions. |
| Support URL | https://dotask5.web.app/support.html |
| Privacy Policy URL | https://dotask5.web.app/privacy.html |
| Marketing URL | https://dotask5.web.app/ |
| Copyright | `2026 Agape Care` (OWNER: make this match the legal name on your Apple developer account) |
| Content rights | "Does your app contain, show, or access third-party content?" Yes: it shows the user's own Canvas course content and AI text from Google Gemini, both reached with the user's own credentials. |
| Advertising Identifier (IDFA) | No |
| Sign in with Apple | Not required. Guideline 4.8 exempts education apps that sign in with an existing education account, and DoTask has no account of its own. |

## Age rating questionnaire: end at 18+

Why 18+: Google's Gemini API terms do not allow apps directed to, or likely to be used by, people under 18, and
DoTask's audience is teachers and adult learners. The content itself is mild, so the honest answers below calculate
a low rating; the 18+ comes from the override at the end, not from inflating any answer.

| Question group | Answer | Reason |
|---|---|---|
| Parental controls / age assurance | No | DoTask has neither. |
| Unrestricted web access | No | The system Safari view opens only for Canvas sign-in and for links the user taps. DoTask has no address bar or web-browsing feature. |
| Advertising | No | No ads. |
| Messaging and chat | Yes | A teacher can reply to Canvas Inbox messages and course discussions from the app. The conversation happens inside the school's own Canvas. |
| User-generated content | OWNER CALL, suggested Yes | The app shows students' discussion posts and messages from the teacher's own Canvas courses. There is no public or community space; the school moderates Canvas. If a reviewer then asks for Guideline 1.2 tools (report, block, filter), answer that this content lives in the school's Canvas, where the teacher is the moderator and Canvas's own reporting and moderation apply; DoTask adds no new audience. |
| AI / chatbot content (if the form asks) | Yes | Grading drafts, tutor answers and writing drafts are generated by Google Gemini. |
| Profanity, horror, alcohol/tobacco/drugs, medical, sexual content, nudity, violence (all kinds) | None | None of this is in the app. AI output follows Google's safety filters. |
| Gambling, simulated gambling, contests, loot boxes | None / No | None. |

Finally, use the age rating override ("choose a higher age rating") and select **18+**. If the form wording
differs from the table, answer the content accurately and still finish with the 18+ override.

## App Privacy ("nutrition label")

### Why anything is declared at all
The developer receives nothing. But Apple counts data as "collected" when it leaves the device and a third party
(here Google, through the Gemini API) can keep it longer than it takes to answer the request. On a free-tier key,
Google may keep content to improve its products and humans may review it, so DoTask declares it. Data sent to the
user's own school Canvas is declared in the same types, because grades, comments and replies are written there.

### Answers
- "Do you or your third-party partners collect data from this app?" **Yes.**
- Tracking ("used to track you"): **No** for every type. No ads, no data brokers, no linking with other companies' data for advertising. No ATT prompt is needed.
- Linked to the user: **Yes** for every type. Requests go out under the user's own API key, which belongs to their Google account, and Canvas calls are made as the signed-in teacher.
- Purposes for every type: **App Functionality** (it is the request the user asked for) and **Other Purposes** (on a free-tier key Google may use the content to improve its own products, which is not a DoTask purpose but must be disclosed).

| Data type (Apple's names) | What it is in DoTask |
|---|---|
| User Content → Other User Content | Typed questions, pasted text, uploaded files (PDF, Word, text), study material, student work, rubric scores, grades and feedback. Grading prompts leave out student names. |
| User Content → Audio Data | The learner's voice while the live voice tutor is on. |
| User Content → Photos or Videos | Photos of pages, images the user picks, and camera pictures while "Show my camera" is on. |
| User Content → Emails or Text Messages | Canvas Inbox messages and discussion posts sent to the AI when the teacher asks for a reply draft. |
| Contact Info → Name | The teacher's own sign-off name, if set in Settings (added to prompts so drafts can be signed), and names that appear inside messages and discussion posts sent for reply drafts. Grading prompts leave out student names. |

Not collected: location, contacts, identifiers for ads, usage data, diagnostics, purchases, health, financial info,
browsing history, search history.

If an AI-output report feature is added later (Google Play requires one, see google-play.md), revisit this label:
the developer would then receive the reported content.

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in `mobile/ios/App/App/Info.plist` (checked). This is accurate: DoTask
uses only the encryption built into iOS (HTTPS and WSS through the system networking stack, and the Keychain). With
the key present, App Store Connect skips the encryption questions for each build, and no export documents or
year-end self-classification report are needed.

## Screenshots

Required size:
- iPhone 6.9-inch display: **1320 x 2868** portrait (PNG or JPEG, no transparency), 1 to 10 images. Apple scales these down for smaller iPhones.
- No iPad screenshots: the app is iPhone only (`TARGETED_DEVICE_FAMILY = 1`). If iPad support is ever turned on
  (`1,2`), App Store Connect will also require 13-inch iPad screenshots (2064 x 2752).

Use only the fictional Demo School data. No real student names, no real school, no third-party logos (no
Instructure or Google logos). Show the real app UI. Captions are optional overlays.

| # | Screen | Suggested caption |
|---|---|---|
| 1 | Teach, Demo School: a grading draft with rubric scores, feedback and the "Post to (student)" button | Grading drafts you review and post |
| 2 | Teach: one student's history of grades and comments | Every student's history, kept apart |
| 3 | Study: a photo of a page turned into an explanation, quiz or flashcards | Snap a page. Get a quiz. |
| 4 | Study: the live voice tutor with "Show my camera" on | A tutor you can talk to |
| 5 | Write: a reply drafted in a chosen tone or language, with Copy, Share and Save as Word | Replies in any tone or language |

Optional 6th: Settings showing the consent text, usage and cost estimate, and Delete all ("Your key. Your device.
No account.").

## App Review Information

- Sign-in required: **No** (untick "Sign-in required"; there is no DoTask account). Request approval of Demo School in the notes instead.
- Contact: owner's name, phone, and `waeil.usa@gmail.com`.
- Notes: paste `mobile/store/review-notes.txt` (3,951 characters as saved, contact address included; limit 4,000),
  after replacing `{{REVIEWER_GEMINI_KEY}}` with a review-only key (a 39-character key makes it 3,967). If the total
  goes over 4,000, shorten the AGE paragraph first.
- Reviewer key: create it in a separate Google Cloud project, restrict it to the Generative Language API, set a low
  daily request quota on that project, and delete the key once the app is approved. Never put a key in the public
  listing, in a screenshot, or in this repository.
- Attachment (optional): a short screen recording of Demo School grading and the voice tutor helps the review.
