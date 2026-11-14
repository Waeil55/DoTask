# DoTask: Google Play Console listing (Android)

Version 2.1.0, package `com.agapecare.dotask`. Everything inside a ```text block is ready to paste.
Character counts were measured with a script on the exact text in each block.

Rules this listing follows on purpose:
- "Canvas" and "Gemini" stay out of the title, the short description and the icon. The full description introduces
  them as "Works with Canvas LMS" and "uses Google Gemini with your own API key", and later uses them only to
  describe what the app connects to (nominative use), with the non-affiliation line at the end.
- Android wording only (Keystore, phone); the iOS listing has its own text.
- No placeholder may reach the public listing. `{{REVIEWER_GEMINI_KEY}}` goes only in App access, which only Google sees.

---

## Main store listing

### App name / title (limit 30): 29 characters

```text
DoTask: AI Teaching Assistant
```

### Short description (limit 80): 79 characters

```text
Grading drafts you review, a voice study tutor, and writing help. Your own key.
```

### Full description (limit 4000): 3,240 characters

```text
DoTask is an AI assistant for teachers and adult learners. It drafts grades and feedback for you to review, tutors you by voice, and helps you write. It uses Google Gemini with your own API key, which you can get free from Google AI Studio. There is no DoTask account, no subscription and no DoTask server.

TEACH
Works with Canvas LMS. Sign in to your school's Canvas through your browser, or explore the fictional Demo School with sample data first.
• Grading drafts: DoTask suggests rubric scores and feedback for a submission, following your rubric and your notes.
• You stay in charge: you review and edit each draft, then post it yourself, one student at a time. Nothing posts until you press the button with that student's name.
• Per-student history: each student's grades and comments are kept on your phone and are never mixed between students.
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
• Your settings, student history and drafts are stored only on your phone. Your API key and Canvas sign-in are protected by the Android Keystore.
• DoTask asks your permission before it sends anything to the AI. Content is sent only when you use a feature, straight from your phone to Google (or the provider you set up) and to your school's Canvas, over encrypted connections.
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

### Graphics

| Asset | Spec | Status |
|---|---|---|
| App icon | 512 x 512, 32-bit PNG, up to 1 MB | Exists: `mobile/store/play-icon-512.png` |
| Feature graphic | 1024 x 500, JPEG or 24-bit PNG (no transparency) | OWNER TO MAKE. Brand name and the check mark only; no "Canvas"/"Gemini" text, no third-party logos, no device frames needed. |
| Phone screenshots | 4 to 8 images, **1080 x 1920** portrait (at least 4 at 1080 px or more are needed for Play's larger promotional placements) | OWNER TO CAPTURE. Same five screens as the App Store list (Demo School grading draft, a student's history, Study from a photo, voice tutor with "Show my camera", Write reply), plus optionally Settings. Demo School data only. |
| Tablet screenshots | Optional (7-inch and 10-inch) | Recommended later if the layout is tested on tablets. |

## Categorization and contact details

| Field | Value |
|---|---|
| App or game | App |
| Category | Education |
| Tags (up to 5) | Pick the closest matches the Console offers, for example: Teaching tools, Study, Flashcards, Productivity, AI assistant. Avoid any tag naming a brand. |
| Email (required, shown publicly) | `waeil.usa@gmail.com` |
| Website | https://dotask5.web.app/ |
| Phone | Leave blank (optional) |
| Privacy policy | https://dotask5.web.app/privacy.html |
| Free or paid | Free. No in-app products, no subscriptions. |

## App content (Policy > App content)

### Privacy policy
https://dotask5.web.app/privacy.html

### Ads
**No, my app does not contain ads.**

### App access
Choose **"All or some functionality in my app is restricted"** and add one set of instructions.
Kept under 500 characters to fit the "Any other information" field.

- Name: `Demo School and AI key`
- Username: `Not needed (DoTask has no accounts)`
- Password: `Not needed`
- Any other information (409 characters with the placeholder; a real 39-character key makes it 424):

```text
No login is needed. On the welcome screen choose "I teach", then "Allow and continue". In Settings paste this review-only, quota-capped key and tap Test connection: {{REVIEWER_GEMINI_KEY}}. In Teach tap "Try Demo School": a fictional school with sample students, so no Canvas account is needed. A real Canvas sign-in needs a developer key from a school's Canvas admin. Study and Write work with the key alone.
```

Full test steps: `mobile/store/review-notes.txt`. Use a separate review-only key (own Google Cloud project,
restricted to the Generative Language API, low daily quota) and delete it after approval.

### Content rating (IARC questionnaire)
- Category: **Reference, News, or Educational**.
- Violence, fear, sexuality, nudity, profanity, crude humor, drugs, alcohol, tobacco: **No** to all.
- Gambling, simulated gambling, real-money features: **No**.
- "Does the app allow users to interact or exchange content with other users?" **Yes**: a teacher can post grades,
  comments, replies and announcements to the school's own Canvas courses, and read students' messages and posts.
- Shares the user's physical location: **No**. Digital purchases: **No**. Web browser or search engine: **No**.
- If asked whether the app generates content with AI: **Yes**.
- Expected result: a low age rating with the "Users Interact" notice. The rating describes content, not audience;
  the audience is set to 18+ below.

### Target audience and content
- Target age groups: **18 and over only**. Do not tick any younger group.
- "Could your store listing unintentionally appeal to children?" **No**.
- Not in the Designed for Families program; Families policy does not apply.
- Reason: teachers and adult learners, and Google's Gemini API terms do not allow apps directed to, or likely to be
  used by, people under 18.

### Other declarations
- News app: No. Government app: No. Health app: No. Financial features: None. COVID-19 app: No.
- Photo and video permissions: not used. Photos and files come through the system photo picker and file picker.
- Advertising ID: not used.

### Data safety

Why "collected" but "not shared": Play counts data as collected when the app sends it off the device, even though
the developer never receives it. It is not "shared" because each transfer is started by the user, after an in-app
disclosure and consent, to services acting for the user: Google Gemini under the user's own key, and the user's own
school Canvas. Play exempts user-initiated transfers and transfers to service providers from "sharing".

Overview answers:

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS, and WSS for the voice tutor) |
| Account creation | "My app does not allow users to create an account." Users only sign in to an existing school Canvas account, which DoTask does not own. |
| Do you provide a way for users to request that their data is deleted? | Yes: in-app Settings > Delete all, and uninstalling. Optional URL: https://dotask5.web.app/support.html#delete |
| Independent security review | No |

Data types (every row: Collected = Yes, Shared = No, Processed ephemerally = **No** because Google may keep
free-tier content, Purpose = **App functionality** only):

| Play category → type | What it is in DoTask | Required or optional |
|---|---|---|
| Personal info → Name | The teacher's own sign-off name, if set in Settings, and names inside Canvas messages and discussion posts sent for reply drafts. Grading prompts leave out student names. | Optional (sign-off and Canvas reply drafts only) |
| Messages → Other in-app messages | Canvas Inbox messages, submission comments and discussion posts sent for reply drafts. | Optional |
| Photos and videos → Photos | Photos of pages, images picked from the gallery, camera pictures while "Show my camera" is on. | Optional |
| Audio → Voice or sound recordings | The learner's voice while the voice tutor is on. | Optional |
| Files and docs → Files and docs | PDFs, Word and text files the user uploads; submission files from Canvas when grading. | Optional |
| App activity → Other user-generated content | Typed questions, pasted text, study material, student work, rubric scores, grades, feedback drafts. | Required (every AI feature sends what the user typed or chose) |

Not collected: location, contacts, financial info, health, calendar, app interactions, search history, installed
apps, device or other IDs, crash logs, diagnostics.

## AI-generated content policy: OWNER DECISION NEEDED

Google Play's AI-Generated Content policy requires apps that generate content with AI to let users **report or flag
offensive AI output from inside the app**, without leaving it, so the developer can use the reports to improve
safety. DoTask has no server today, so it has nowhere to send a report. Choose one before the production release:

- **(a) In-app report form that posts to a Google Form the owner creates.** The app sends the flagged text and an
  optional note to the form's response endpoint; responses land in the owner's Google Sheet. No Firebase code, no
  database. Downsides: the form-post endpoint is not an official API and can change, and spam control is limited.
- **(b) A write-only Firestore "reports" collection on the existing `dotask5` Firebase project.** Security rules allow
  `create` only (no read, update or delete from the app), with size and field checks; App Check reduces abuse. Uses
  an official, documented API and stays within the free plan for this volume. Downside: more setup, and the app gains
  a Firebase dependency or REST call.

Either way, the report should send only what the user chooses to report (the AI output and their note), never
student names, keys or tokens, and the user should see exactly what will be sent. Once reporting exists, update:
the privacy policy (a new "Reports you send us" section), this Data safety form (the developer then collects the
reported content), and Apple's App Privacy answers.

## Release path for a new personal developer account

Personal Play developer accounts created after November 13, 2023 must run a **closed test with at least 12 testers
who stay opted in for at least 14 consecutive days** before they can apply for production access. Internal testing
does not count.

1. Create a closed testing track, upload the release AAB (`npm run android:release` produces it), add a tester
   email list or Google Group with 12 or more people, and share the opt-in link.
2. Keep at least 12 testers opted in for 14 days in a row; ask them to actually use Teach (Demo School), Study and
   Write so there is feedback to report.
3. Apply for production access from the Dashboard and answer the questions about the test.
4. Organization accounts (D-U-N-S verified) are not subject to this requirement.

The upload key and keystore are the owner's to create and keep safe; never commit them.
