# DoTask for Android: build and publish

Owner guide for building DoTask on Windows and releasing it on Google Play.
All commands are for **PowerShell**, starting in the `DoTask` folder.

## What is already set up

- **Version** comes from `"version"` in `mobile/package.json` (now 2.1.0).
  Play's versionCode is worked out from it: `major*10000 + minor*100 + patch`,
  so 2.1.0 is 20100. Play refuses an upload whose versionCode it has already seen,
  so **bump the version before every upload**. To re-upload the same version, set
  `$env:DOTASK_VERSION_CODE = "20101"` for that build only.
- **Permissions**: internet, microphone and camera (live voice tutor only, asked
  the first time it's used). Camera and mic are marked optional, so devices without
  them can still install the app. No storage, media or background permissions.
- **Backup is off**: no app data goes to Google Drive backup or to a new phone
  during setup. Student records stay on this device; saved keys are tied to this
  device's secure hardware anyway. After a phone change, users enter their Gemini
  key and sign in to Canvas again.
- **Canvas sign-in** returns to the app through `com.agapecare.dotask:/oauth/canvas`.
  That exact redirect URI must be in the Canvas developer key.
- **Release signing** reads `keystore.properties` from (first one found):
  `$env:DOTASK_KEYSTORE_PROPERTIES`, then `%USERPROFILE%\.dotask\keystore.properties`,
  then `mobile\android\keystore.properties`. With none of them, release builds come
  out unsigned and Gradle prints a warning.

## 0. One-time tools

1. Install **Node 22** and **Android Studio** (it brings the Android SDK and a JDK).
2. Open Android Studio once and let it install the SDK (default:
   `%LOCALAPPDATA%\Android\Sdk`).
3. **JDK 21** for Gradle. On this PC `JAVA_HOME` already points at Microsoft
   OpenJDK 21, which is right. Do **not** point it at Android Studio's bundled
   `jbr`: here that is Java 25, and Gradle 8.14.3 cannot run on Java 25 (builds
   fail with *Unsupported class file major version 69*). In Android Studio set
   *Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK* to
   `JAVA_HOME` for the same reason.
4. `mobile\android\local.properties` (git-ignored) tells Gradle where the SDK is.
   If a build says *SDK location not found* on another PC, open `mobile\android`
   once in Android Studio (it writes that file), or set `ANDROID_HOME`.

## 1. Debug APK (try it on your own phone)

```powershell
cd mobile
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The APK is `mobile\android\app\build\outputs\apk\debug\app-debug.apk`.
On the phone, turn on **Developer options > USB debugging**, connect it, then:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```

(`npm run android:debug` in `mobile` does the build steps in one go.)

## 2. Create the upload key (once, ever)

```powershell
cd mobile
npm run android:keystore
```

It asks for a password twice (hidden, at least 8 characters), then keytool asks
for your name and organisation. It creates, and never overwrites:

- `%USERPROFILE%\.dotask\dotask-upload.jks` (the upload key)
- `%USERPROFILE%\.dotask\keystore.properties` (path and password, read by Gradle)

**Back up both files and the password straight away**: two offline copies in
different places (for example two USB drives), plus the password in a password
manager. Never put them in the project folder, git, email or chat. If they are
lost you can't ship updates until Google resets the upload key (see section 6).

Run it from PowerShell or Windows Terminal; Git Bash can't hide the password
(if you must use it, run `winpty node tools/android-keystore.mjs` from `mobile`;
`winpty npm ...` fails because npm is a .cmd file).

## 3. Release build (AAB for Google Play)

```powershell
cd mobile
npm run build
npx cap sync android
cd android
.\gradlew.bat bundleRelease
```

(`npm run android:release` in `mobile` does the same in one go.)

Gradle prints `DoTask: signing release with the upload key from ...`. The bundle is
`mobile\android\app\build\outputs\bundle\release\app-release.aab`.

Check the signature (jarsigner comes with the JDK):

```powershell
& "$env:JAVA_HOME\bin\jarsigner.exe" -verify -verbose -certs app\build\outputs\bundle\release\app-release.aab
```

It must end with **jar verified.** A warning that the certificate is self-signed
is normal for an upload key. "jar is unsigned" means `keystore.properties` was not
found: rerun section 2 or set `DOTASK_KEYSTORE_PROPERTIES`.

To see the key's fingerprints (Play Console shows the same under App integrity):

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\.dotask\dotask-upload.jks" -alias upload
```

**CI** (optional, `.github/workflows/android.yml`, run by hand from Actions): add
the repository secrets `ANDROID_KEYSTORE_B64` (base64 of `dotask-upload.jks`, e.g.
`[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.dotask\dotask-upload.jks"))`),
`ANDROID_STORE_PASSWORD` and `ANDROID_KEY_PASSWORD` (both the upload-key password)
and `ANDROID_KEY_ALIAS` = `upload`. The job writes a temporary `keystore.properties`,
points `DOTASK_KEYSTORE_PROPERTIES` at it and deletes it afterwards. CI sets
versionCode to 20100 + run number, so if you upload both CI and local builds, check
that each new upload's versionCode is higher than the last one Play has seen.

## 4. Google Play Console, first release

1. **Developer account**: sign up at <https://play.google.com/console/signup>
   (one-time US$25). Choose *Personal* or *Organization* (an organization needs a
   D-U-N-S number). Complete **identity verification** (government ID, address,
   contact email and phone, and confirming access to an Android phone through the
   Play Console app). Verification can take a few days.
2. **Create app**: name *DoTask*, default language, *App*, *Free*, accept the
   declarations. The package name `com.agapecare.dotask` is fixed for good once
   the first bundle is uploaded.
3. **App content** (Policy and programs > App content). Fill in every form:
   - *Privacy policy*: a public URL (for example a page on the download site).
     Play requires one for every app, and it must cover the camera and microphone
     use and what is sent to Gemini and Canvas.
   - *App access*: say that features need the user's own Gemini API key, and
     Teach needs a Canvas account. Give reviewers step-by-step instructions and,
     ideally, a test Gemini key with a low quota, or they may reject the app
     (ready-made text: `mobile/store/review-notes.txt`, `mobile/store/google-play.md`).
   - *Ads*: No. *Advertising ID*: not used.
   - *Content rating*: answer the questionnaire (education / productivity tool).
   - *Target audience and content*: **18 and over only** (teachers and adult
     learners); not designed to appeal to children.
   - *Data safety*: there is no DoTask server, account, ads or analytics, but
     data does leave the phone to services the user sets up: Google's Gemini API
     (with the user's own key) gets prompts, documents, student work, and for the
     live tutor voice audio and camera images; the user's Canvas site gets
     what the teacher chooses to post. Declare those data types (for example
     personal info such as names, messages, files and docs, photos and videos,
     audio), mark them *encrypted in transit*, *not used for ads*, and explain
     that everything is stored on the device and removed by clearing the app or
     uninstalling. There are no accounts, so no account-deletion URL is needed.
     Check each answer against Play's current definitions before submitting.
   - Answer *No* to the news, health, financial, government and COVID forms.
4. **Store listing** (texts in `mobile/store/google-play.md`): short and full description, 512x512 icon
   (`mobile/store/play-icon-512.png`), a 1024x500 feature graphic, at least two
   phone screenshots (tablet screenshots help), category *Education*, contact email.
5. **Internal testing** (Test and release > Testing > Internal testing):
   create a release, keep **Play App Signing** with the Google-generated key (Google
   holds the app signing key; you sign uploads with your upload key), upload
   `app-release.aab`, add release notes, save, review, roll out. Add testers by
   email and send them the opt-in link.
6. **Closed testing** (personal accounts): before Production unlocks you must run
   a closed test with **at least 12 testers opted in for at least 14 days in a
   row**. Then on the Dashboard choose **Apply for production** and answer the
   questions. Organization accounts can skip this.
7. **Production**: create a release from the tested bundle and roll out (a staged
   rollout, e.g. 20%, is safer for the first one).

## 5. Every update

1. Bump `"version"` in `mobile/package.json` (e.g. 2.1.0 to 2.1.1).
2. Section 3: build and verify the AAB.
3. Upload it to internal testing, check it, then promote it to production.

## 6. If the upload key is lost or leaked

Play Console > your app > App integrity > App signing > **Request upload key
reset**. Move the old files out of `%USERPROFILE%\.dotask`, run
`npm run android:keystore` again, export the new certificate for Google:

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -export -rfc -keystore "$env:USERPROFILE\.dotask\dotask-upload.jks" -alias upload -file upload_certificate.pem
```

and upload `upload_certificate.pem` in that form. Existing users are not affected,
because Google keeps the app signing key.
