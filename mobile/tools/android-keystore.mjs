// Creates the Google Play UPLOAD key for DoTask, once, on the owner's machine.
//   Run:  cd mobile ; npm run android:keystore
//
// Writes (and never overwrites):
//   <home>/.dotask/dotask-upload.jks       the upload key (PKCS12, alias "upload")
//   <home>/.dotask/keystore.properties     what android/app/build.gradle reads to sign releases
// Both live outside the project folder so they can't be committed, zipped or synced
// with the source by accident.
//
// The password is typed hidden and handed to keytool through an environment
// variable (-storepass:env / -keypass:env), never on the command line, where other
// processes and shell history could see it.
//
// Node 22, ES module, no dependencies.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import process from 'node:process';

const DIR = join(homedir(), '.dotask');
const KEYSTORE = join(DIR, 'dotask-upload.jks');
const PROPS = join(DIR, 'keystore.properties');
const ALIAS = 'upload';
const PASS_ENV = 'DOTASK_UPLOAD_KEY_PASSWORD'; // only set in keytool's own environment
const MIN_LEN = 8;
const KEYTOOL = process.platform === 'win32' ? 'keytool.exe' : 'keytool';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// JAVA_HOME first (the JDK the owner chose), then the JDK bundled with Android
// Studio (what Gradle uses when JAVA_HOME is unset), then anything on PATH.
function findKeytool() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', KEYTOOL));
  candidates.push(join('C:\\Program Files\\Android\\Android Studio\\jbr\\bin', KEYTOOL));
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    const clean = dir.trim().replace(/^"(.*)"$/, '$1'); // Windows PATH entries may be quoted
    if (clean) candidates.push(join(clean, KEYTOOL));
  }
  return candidates.find(isFile);
}

// Reads one line from the terminal without echoing it. Raw mode lets us see each
// key press and print nothing; Ctrl+C still cancels.
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let chars = [];
    process.stdout.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();

    function done(err) {
      stdin.removeListener('data', onData);
      // Give the console back fully before keytool inherits it, otherwise a pending
      // read here could swallow the answers typed for keytool.
      // Order matters on Windows: pause() first (Node stops the console read on the
      // next tick), and only then leave raw mode. Leaving raw mode while a read is
      // still active makes libuv restart it as a blocking line read, which then has
      // to be cancelled by injecting a fake Enter key; setImmediate runs after that
      // tick, so no line read is ever started.
      stdin.pause();
      setImmediate(() => {
        stdin.setRawMode(false);
        process.stdout.write('\n');
        if (err) reject(err);
        else resolve(chars.join(''));
      });
    }

    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done();
        if (ch === '\u0003') return done(new Error('Cancelled.')); // Ctrl+C
        if (ch === '\u0008' || ch === '\u007f') { // Backspace (Windows / others)
          chars.pop();
          continue;
        }
        if (ch === '\u001b') return; // arrow/function keys: drop the escape sequence
        if (ch < ' ') continue; // other control keys
        chars.push(ch);
      }
    }

    stdin.on('data', onData);
  });
}

// java.util.Properties treats \ as an escape and = : # ! specially, and reads files
// as ISO-8859-1. Escape them the way Properties.store() does so the exact password
// and path come back out in Gradle.
function propEscape(value) {
  let out = '';
  for (const [i, ch] of [...value].entries()) {
    const code = ch.codePointAt(0);
    if (ch === '\\' || ch === '=' || ch === ':' || ch === '#' || ch === '!') out += `\\${ch}`;
    else if (ch === ' ' && i === 0) out += '\\ ';
    else if (code < 0x20 || code > 0x7e) {
      for (const unit of ch.split('')) out += `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`;
    } else out += ch;
  }
  return out;
}

console.log(`
DoTask - create the Google Play upload key
------------------------------------------
This makes the key you sign every Play upload with. Google keeps the real
app-signing key (Play App Signing); this one only proves uploads come from you.
Files: ${KEYSTORE}
       ${PROPS}
`);

// Never overwrite: replacing an upload key Play already knows would lock you out
// of updates until Google resets it.
for (const p of [KEYSTORE, PROPS]) {
  if (existsSync(p)) {
    fail(
      `Refusing to continue: ${p} already exists.\n` +
        'You already have an upload key. Keep using it. If you really mean to replace it,\n' +
        'move BOTH files somewhere safe first (do not delete them), then run this again.'
    );
  }
}

const keytool = findKeytool();
if (!keytool) {
  fail(
    'Could not find keytool. Install Android Studio (it bundles a JDK at\n' +
      'C:\\Program Files\\Android\\Android Studio\\jbr) or set JAVA_HOME to a JDK 17+.'
  );
}
console.log(`Using ${keytool}\n`);

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  fail(
    'This needs an interactive terminal so the password can be typed hidden.\n' +
      // winpty can't start "npm" (it is npm.cmd), so point Git Bash users at node.exe directly.
      'Run it from PowerShell or Windows Terminal (in Git Bash: winpty node tools/android-keystore.mjs).'
  );
}

console.log(
  `Choose a password (at least ${MIN_LEN} characters, letters/digits/symbols on a US keyboard).\n` +
    'Write it down now: it is needed for every release and cannot be recovered.\n'
);

let password;
try {
  for (;;) {
    const first = await askHidden('Password: ');
    if (first.length < MIN_LEN) {
      console.log(`Too short: use at least ${MIN_LEN} characters.\n`);
      continue;
    }
    // Plain printable ASCII only, so the password can be retyped on any keyboard
    // layout years from now and encodes the same in keytool, Gradle and Android Studio.
    if (!/^[\x20-\x7e]+$/.test(first)) {
      console.log('Please use only letters, digits, spaces and symbols found on a US keyboard.\n');
      continue;
    }
    const second = await askHidden('Same password again: ');
    if (first !== second) {
      console.log('The two entries did not match. Try again.\n');
      continue;
    }
    password = first;
    break;
  }
} catch (err) {
  fail(err.message);
}

mkdirSync(DIR, { recursive: true, mode: 0o700 });

console.log(
  '\nkeytool will now ask for your name, organisation, city and country.\n' +
    'They go into the certificate (Google Play does not show them to users).\n' +
    'Answer, then type "yes" to confirm.\n'
);

// PKCS12 (the modern default) uses one password for the store and the key, so the
// same value goes to both; stdio is inherited so the owner answers keytool directly.
const result = spawnSync(
  keytool,
  [
    '-genkeypair', '-v',
    '-keystore', KEYSTORE,
    '-storetype', 'PKCS12',
    '-alias', ALIAS,
    '-keyalg', 'RSA',
    '-keysize', '2048',
    '-validity', '10000', // ~27 years; Play requires validity past 2033
    '-storepass:env', PASS_ENV,
    '-keypass:env', PASS_ENV,
  ],
  { stdio: 'inherit', env: { ...process.env, [PASS_ENV]: password } }
);

if (result.error) fail(`Could not run keytool: ${result.error.message}`);
if (result.status !== 0 || !isFile(KEYSTORE)) {
  fail(`keytool did not finish (exit code ${result.status}). Nothing was written to ${PROPS}.`);
}

// Forward slashes: they work on Windows and need no escaping in .properties.
const storeFile = KEYSTORE.replace(/\\/g, '/');
const properties = [
  `# DoTask Google Play upload key, created ${new Date().toISOString()} by mobile/tools/android-keystore.mjs`,
  '# SECRET: contains the keystore password. Never commit, email or upload this file.',
  `storeFile=${propEscape(storeFile)}`,
  `storePassword=${propEscape(password)}`,
  `keyAlias=${ALIAS}`,
  `keyPassword=${propEscape(password)}`,
  '',
].join('\n');

try {
  // "wx" = fail if it appeared meanwhile; 0600 = owner-only where the OS honours it.
  writeFileSync(PROPS, properties, { encoding: 'latin1', flag: 'wx', mode: 0o600 });
} catch (err) {
  fail(`The key was created, but ${PROPS} could not be written: ${err.message}`);
}

console.log(`
Done.
  Upload key : ${KEYSTORE}
  Gradle file: ${PROPS}

BACK IT UP NOW
  - Keep two offline copies of dotask-upload.jks AND the password, in different
    places (for example two USB drives, or one USB drive plus a printed note in a
    safe). A password manager entry for the password is a good extra.
  - Never put the key or keystore.properties in the project folder, git, email or
    chat.
  - If the key or password is lost, you cannot publish updates until you ask Google
    to reset the upload key (Play Console > your app > App integrity > App signing
    > Request upload key reset), which takes a few days.

Next: npm run android:release   (rebuilds the web files first; see mobile/ANDROID.md)
`);
