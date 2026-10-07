/**
 * `homie-studio standalone plan|build|run|steam|ci <game>`: A STANDALONE COPY OF A GAME (standalone/STANDALONE.md).
 *
 * The same built web game (site/dist/games/<id>, byte for byte but one script in its index.html) in the thinnest
 * shell each platform has: Electron for macOS, Windows and Linux (the kind of build Steam accepts for upload),
 * Capacitor for iOS and Android (the files the stores accept for upload; whether a store takes a game is the
 * store's to say). One static page frames the game in every one of them (standalone/shell/),
 * and multiplayer is still the studio's own deployed Worker: the page asks its Lobby for a room and opens the room's
 * socket. With no connection, or no room that answers, the game plays offline with its bots.
 *
 * Nothing here is written by hand twice. The wrappers are other people's maintained tools, installed at exact
 * versions (lib/standalone-pins.json) into a project of its own, .studio/standalone/<id>/, on the first build: this
 * package gains no dependency, and a studio that never makes a standalone copy downloads none of them. That folder
 * is git-ignored and made again by every build; the only committed things are the optional "standalone" block in
 * games/<id>/game.json and, when asked for, .github/workflows/standalone.yml.
 *
 * What a target needs is checked first and said as a row (the setup status's shape): a target whose prerequisite is
 * missing is SKIPPED with that row and its fix, and the others still build. Signing reads the environment only.
 * Nothing is uploaded: the steps for Steam, App Store Connect and Google Play are printed for the person to run.
 *
 * WHAT A RESULT SAYS. `built` means the tool finished and the file it should have made is there, at the path the
 * result gives (looked at, never worked out from a name). A desktop build for this computer's own system is also
 * STARTED once (the shell's self-check) and the result says whether the game loaded; every other target says
 * "built, not started on this computer". A release that could not be signed is said as UNSIGNED and is not `ok`.
 */
import { spawn } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { build as buildSite, uiOf } from './build.mjs';
import { compareVersions } from './changelog.mjs';
import { GAME_ID, PACKAGE_ROOT, isWorkersDev, listGames, readStudio, siteUrl } from './studio.mjs';
import { pinnedVersion } from './upgrade.mjs';
import { STUDIO_VERSION } from './version.mjs';
import { sharePlaces } from '../worker/pages.mjs';
import {
  DESKTOP, MISSING, STANDALONE_PINS, TARGETS, capacitorConfig, configScript, cspBlocksInline, electronApp, electronPackage, entitlementsPlist, exportOptionsPlist,
  patchAndroidManifest, patchGradle, patchInfoPlist, projectPackage, standaloneBlock, standaloneMeta, steamAppBuild, steamLaunch, withNetScript, workflowYaml,
} from './standalone-files.mjs';
import { iconSource, writeIcons } from './standalone-icons.mjs';

export const STANDALONE_VERBS = ['plan', 'build', 'run', 'steam', 'ci'];
/** The first toolkit whose Worker answers an app's Lobby call: a site deployed with an older one sends copies offline. */
export const STANDALONE_SINCE = '0.32.0';
/** The Android platform Capacitor 8's project compiles against (its compileSdkVersion): the SDK must have it. */
export const ANDROID_PLATFORM = 36;
const SHELL = join(PACKAGE_ROOT, 'standalone', 'shell');
const ELECTRON = join(PACKAGE_ROOT, 'standalone', 'electron');
/**
 * The wrapper tools' whole tree at exact versions with their checksums. Made by npm from the pins (a package.json
 * with every desktop and mobile pin as devDependencies, then `npm install --package-lock-only`), with npm's
 * "deprecated" notes taken out. Make it again when a pin moves: a test holds it to the pins.
 */
const LOCK = join(PACKAGE_ROOT, 'lib', 'standalone-lock.json');

export const standaloneDir = (root, id) => join(root, '.studio', 'standalone', id);

/* ------------------------------------------------------------------ running other people's tools */

const running = new Set();
const endGroup = (child) => {
  // The tool and everything it started (Gradle's workers, xcodebuild's compilers): its whole process group.
  try { if (process.platform !== 'win32' && child.pid && child.homieGroup) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* gone */ } }
};
let guarded = false;
function guard() {
  if (guarded) return;
  guarded = true;
  process.on('exit', () => { for (const c of running) endGroup(c); });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { for (const c of running) endGroup(c); process.exit(sig === 'SIGINT' ? 130 : 143); });
}

/**
 * Run a program and wait: { code, stdout, stderr }, never throwing (127: not installed; 124: out of time, and then
 * the program AND everything it started is ended, not only the program). It keeps only the end of what was printed
 * (an Xcode build prints megabytes), and never echoes the command line: `say` gets the program's own lines, which is
 * why nothing secret is ever put in an argument (see androidSigning). `shell` is for Windows' .cmd and .bat
 * launchers only, always with fixed words.
 */
export function runTool(cmd, args, { cwd, env, timeout = 10 * 60_000, say = null, stdio = null, shell = false } = {}) {
  return new Promise((done) => {
    const keep = { out: [], err: [] };
    let settled = false;
    let child;
    const finish = (code) => { if (!settled) { settled = true; clearTimeout(timer); running.delete(child); done({ code, stdout: keep.out.join(''), stderr: keep.err.join('') }); } };
    const own = !stdio && process.platform !== 'win32';
    let timer = null;
    try { child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: stdio ?? ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: own, ...(shell ? { shell: true } : {}) }); } catch (error) { keep.err.push(String(error?.message ?? error)); finish(127); return; }
    child.homieGroup = own;
    guard();
    running.add(child);
    timer = setTimeout(() => { endGroup(child); finish(124); }, timeout);
    const take = (list) => (d) => { const t = String(d); list.push(t); while (list.length > 400) list.shift(); if (say) for (const l of t.split('\n')) if (l.trim()) say(l.slice(0, 300)); };
    child.stdout?.on('data', take(keep.out));
    child.stderr?.on('data', take(keep.err));
    child.on('error', (error) => { keep.err.push(String(error.message)); finish(error.code === 'ENOENT' ? 127 : 1); });
    child.on('close', (code) => finish(code ?? 1));
  });
}
const tail = (r, n = 8) => `${r.stdout}\n${r.stderr}`.split('\n').map((l) => l.trim()).filter(Boolean).slice(-n).join(' | ').slice(0, 900);
const lastJson = (text) => { for (const l of String(text).trim().split('\n').reverse()) { try { const o = JSON.parse(l); if (o && typeof o === 'object') return o; } catch { /* not that line */ } } return null; };

/**
 * The environment a tool is given: this one's, WITHOUT the signing values (HOMIE_ANDROID_*, HOMIE_APPLE_*) unless the
 * tool is the one that signs. npm, Capacitor, CocoaPods' and Gradle's own downloads and every script they run never
 * see a keystore password or an identity's name.
 */
export function toolEnv(env = process.env, keep = []) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^HOMIE_(ANDROID|APPLE)_/.test(k) || keep.includes(k)) out[k] = v;
  return out;
}

/* ------------------------------------------------------------------ what this computer has */

/** The Android SDK folder: the environment's, else where Android Studio puts it. Null when there is none. */
export function androidSdk({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  const usual = platform === 'darwin' ? join(home, 'Library', 'Android', 'sdk') : platform === 'win32' ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Android', 'Sdk') : join(home, 'Android', 'Sdk');
  for (const [dir, from] of [[env.ANDROID_HOME, 'ANDROID_HOME'], [env.ANDROID_SDK_ROOT, 'ANDROID_SDK_ROOT'], [usual, 'the usual place']]) {
    if (!dir || !existsSync(join(dir, 'platforms'))) continue;
    let platforms = [];
    try { platforms = readdirSync(join(dir, 'platforms')).filter((n) => /^android-\d+/.test(n)).sort((a, b) => parseFloat(a.slice(8)) - parseFloat(b.slice(8))); } catch { platforms = []; }
    return { dir, from, platforms, fits: platforms.includes(`android-${ANDROID_PLATFORM}`) };
  }
  return null;
}

/** The JDKs Gradle can run on with the Android Gradle plugin Capacitor 8 uses: 21 is what it is built for. */
export const JDK_FITS = (major) => major >= 21 && major <= 24;
const jdkMajor = (text) => { const m = /version "(\d+)(?:\.(\d+))?/.exec(String(text)); return m ? (m[1] === '1' && m[2] ? Number(m[2]) : Number(m[1])) : null; };
/**
 * A JDK for the Android build: JAVA_HOME's, the `java` on the PATH, or the one Android Studio carries for exactly
 * this, the first that fits. { home (null: the PATH's), major, from, seen: [{ from, major }] }; home and major are
 * null when none fits.
 */
export async function findJdk({ env = process.env, platform = process.platform, exec = runTool } = {}) {
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  const studio = platform === 'darwin' ? ['/Applications/Android Studio.app/Contents/jbr/Contents/Home'] : platform === 'win32' ? [join(env.ProgramFiles || 'C:\\Program Files', 'Android', 'Android Studio', 'jbr')] : ['/opt/android-studio/jbr', '/usr/local/android-studio/jbr'];
  const places = [[env.JAVA_HOME || null, 'JAVA_HOME'], [null, 'java on the PATH'], ...studio.map((d) => [d, 'Android Studio\'s own JDK'])];
  const seen = [];
  for (const [home, from] of places) {
    if (from !== 'java on the PATH' && (!home || !existsSync(join(home, 'bin', exe)))) continue;
    const r = await exec(home ? join(home, 'bin', exe) : 'java', ['-version'], { timeout: 8000 });
    const major = r.code === 0 ? jdkMajor(`${r.stderr}\n${r.stdout}`) : null;
    if (major === null) continue;
    seen.push({ from, major });
    if (JDK_FITS(major)) return { home, major, from, seen };
  }
  return { home: null, major: null, from: null, seen };
}

/** How a value gets into the environment the AI's commands run in, for somebody who works in a desktop app. Never the value itself. */
export const ENV_HOW = 'Set it yourself, where your AI\'s commands run, never in the chat: in a terminal, `export NAME=…` and start your AI from that terminal; for a desktop app on a Mac, `launchctl setenv NAME …` in Terminal and then open the app again; in the GitHub workflow it is a repository secret.';

/**
 * What the five targets need on this computer, as rows of the setup status's shape. Read-only: `--version` of a few
 * tools, whether a folder is there, and how many signing identities of the right kind the keychain has (a count,
 * never a name). A row is `ok` only for what was looked at and found; what could not be looked at says so.
 */
export async function standaloneRows({ platform = process.platform, exec = runTool, env = process.env, home = homedir() } = {}) {
  const mac = platform === 'darwin';
  const rows = [];
  const ci = 'homie-studio standalone ci <game> writes a GitHub workflow that builds it on GitHub\'s own machine instead.';

  // Xcode, with its iOS platform (Xcode installs without one since 15): the iOS build, and nothing else.
  {
    const r = mac ? await exec('xcodebuild', ['-version'], { timeout: 15_000 }) : { code: 127, stdout: '' };
    const version = r.code === 0 ? /Xcode\s+([\d.]+)/.exec(r.stdout)?.[1] ?? null : null;
    const sdks = version ? await exec('xcodebuild', ['-showsdks'], { timeout: 20_000 }) : { code: 1, stdout: '' };
    const ios = sdks.code === 0 && /-sdk iphonesimulator/.test(sdks.stdout) && /-sdk iphoneos/.test(sdks.stdout);
    rows.push({
      id: 'standalone-xcode', label: 'Xcode', need: 'for the iOS build', state: version && ios ? 'ok' : 'optional',
      detail: version ? (ios ? `Xcode ${version}, with its iOS platform` : `Xcode ${version}, without its iOS platform`) : mac ? 'not installed, or only the command line tools' : 'an iOS app is built on a Mac',
      unlocks: 'the iOS build of a game (standalone build --for ios)',
      fix: version && ios ? null : !mac ? { who: 'ai', say: ci } : version ? { who: 'person', say: 'In Xcode: Settings, Components, get the iOS platform (several GB). Then build again.' } : { who: 'person', open: 'https://apps.apple.com/app/xcode/id497799835', say: 'Install Xcode from the Mac App Store (several GB), open it once so it finishes installing with its iOS platform, then build again.' },
    });
  }
  // The Android SDK with the platform the project compiles against, and a JDK that Gradle runs on.
  {
    const sdk = androidSdk({ env, platform, home });
    rows.push({
      id: 'standalone-android', label: 'Android SDK', need: 'for the Android build', state: sdk?.fits ? 'ok' : 'optional',
      detail: sdk ? (sdk.fits ? `found (${sdk.from}), with android-${ANDROID_PLATFORM}; its build tools and licences were not checked` : `found (${sdk.from}), without the android-${ANDROID_PLATFORM} platform the build compiles against${sdk.platforms.length ? ` (it has ${sdk.platforms.slice(-3).join(', ')})` : ''}`) : 'not found: no ANDROID_HOME, and none where Android Studio puts it',
      unlocks: 'the Android build of a game (standalone build --for android)',
      fix: sdk?.fits ? null : sdk ? { who: 'person', say: `In Android Studio: Settings, Languages & Frameworks, Android SDK, tick "Android ${ANDROID_PLATFORM}" (API ${ANDROID_PLATFORM}) and Apply. Or: ${ci}` } : { who: 'person', open: 'https://developer.android.com/studio', say: `Install Android Studio and open it once: it downloads the SDK to its usual place. Or: ${ci}` },
    });
    const jdk = await findJdk({ env, platform, exec });
    const saw = jdk.seen.map((s) => `${s.from} is ${s.major}`).join('; ');
    rows.push({
      id: 'standalone-jdk', label: 'JDK', need: 'for the Android build', state: jdk.major ? 'ok' : 'optional',
      detail: jdk.major ? `JDK ${jdk.major} (${jdk.from})${jdk.seen.length > 1 ? `; passed over: ${jdk.seen.filter((s) => s.major !== jdk.major || s.from !== jdk.from).map((s) => `${s.from} is ${s.major}`).join(', ')}` : ''}` : saw ? `${saw}: Android's build needs JDK 21 (22 to 24 also run it)` : 'no Java found',
      unlocks: 'Gradle, which builds the Android app',
      fix: jdk.major ? null : { who: 'person', open: 'https://adoptium.net/temurin/releases/?version=21', say: 'Install JDK 21 (Temurin 21 is free) and point JAVA_HOME at it, or install Android Studio, which carries its own. Nothing is installed for you.' },
    });
  }
  // Signing for a release. macOS: a Developer ID Application identity (how many, never a name) and the name the
  // environment gives. iOS: the team id. Each is its own row: one being there says nothing about the other.
  {
    const r = mac ? await exec('security', ['find-identity', '-v', '-p', 'codesigning'], { timeout: 10_000 }) : { code: 127, stdout: '' };
    const looked = mac && r.code === 0;
    const developerId = looked ? r.stdout.split('\n').filter((l) => /"Developer ID Application: /.test(l)).length : 0;
    const others = looked ? Math.max(0, Number(/(\d+) valid identit/.exec(r.stdout)?.[1] ?? 0) - developerId) : 0;
    const identity = Boolean(env.HOMIE_APPLE_IDENTITY);
    rows.push({
      id: 'standalone-apple-signing', label: 'macOS signing', need: 'for a macOS release', state: looked && developerId > 0 && identity ? 'ok' : !mac || looked ? 'optional' : 'unknown',
      detail: !mac ? 'a macOS app is signed on a Mac' : !looked ? 'could not check the keychain (the security tool did not answer)' : `${developerId} Developer ID Application ${developerId === 1 ? 'identity' : 'identities'} in the keychain${others ? ` (and ${others} of another kind, which cannot sign a release)` : ''}; HOMIE_APPLE_IDENTITY ${identity ? 'is set (that it names one of them is checked when a release is signed)' : 'is not set'}`,
      unlocks: 'a signed macOS app: without a signature macOS will not open the app on another Mac',
      fix: looked && developerId > 0 && identity ? null : { who: 'person', open: 'https://developer.apple.com/account/resources/certificates/list', say: `${developerId > 0 ? '' : 'With an Apple Developer membership, make a "Developer ID Application" certificate (Xcode, Settings, Accounts, Manage Certificates). '}Put the identity's name in HOMIE_APPLE_IDENTITY. ${ENV_HOW}` },
    });
    const profile = Boolean(env.HOMIE_APPLE_NOTARY_PROFILE);
    rows.push({
      id: 'standalone-notary', label: 'Apple notarization', need: 'for a macOS release', state: mac && profile ? 'later' : 'optional',
      detail: !mac ? 'notarization is done on a Mac' : profile ? 'HOMIE_APPLE_NOTARY_PROFILE is set; whether the keychain has that profile and Apple accepts it is not checked until a release is notarized' : 'HOMIE_APPLE_NOTARY_PROFILE is not set',
      unlocks: 'a notarized macOS app: without it macOS refuses to open the app, and Steam asks for it',
      fix: mac && profile ? null : { who: 'person', run: 'xcrun notarytool store-credentials "homie-notary"', say: `Run that in your own terminal (it asks for your Apple ID, team id and an app-specific password, and keeps them in the keychain), then set HOMIE_APPLE_NOTARY_PROFILE to homie-notary. ${ENV_HOW}` },
    });
    const team = Boolean(env.HOMIE_APPLE_TEAM);
    rows.push({
      id: 'standalone-ios-signing', label: 'iOS signing', need: 'for an iOS release', state: mac && team ? 'later' : 'optional',
      detail: !mac ? 'an iOS app is signed on a Mac' : team ? 'HOMIE_APPLE_TEAM is set; that Xcode is signed in to an Apple account of that team (Xcode, Settings, Accounts) is not checked until a release is archived' : 'HOMIE_APPLE_TEAM is not set',
      unlocks: 'an iOS archive and its .ipa for App Store Connect',
      fix: mac && team ? null : { who: 'person', open: 'https://developer.apple.com/account#MembershipDetailsCard', say: `With an Apple Developer membership: sign in to it in Xcode (Settings, Accounts), and put your team id (ten letters and digits, on that page) in HOMIE_APPLE_TEAM. ${ENV_HOW}` },
    });
  }
  // A phone for trying a build on (standalone run --for ios --device): what Xcode's own device list says is
  // connected now, by model, and whether its Developer Mode is on. Nothing is asked of the phone itself.
  if (mac) {
    const found = await phones({ exec, env });
    const here = found.ok ? found.phones.filter((p) => p.here) : [];
    const ready = here.filter((p) => p.trusted && p.developerMode === true);
    const one = (p) => `${p.model}${!p.trusted ? ', which does not trust this Mac yet' : p.developerMode === true ? ', Developer Mode on' : p.developerMode === false ? ', Developer Mode OFF' : ', Developer Mode not known'}`;
    rows.push({
      id: 'standalone-phone', label: 'A phone for trying a build', need: 'optional', state: !found.ok ? 'unknown' : ready.length === 1 && here.length === 1 ? 'ok' : 'optional',
      detail: !found.ok ? `could not check (${found.why})` : here.length ? `connected: ${here.map(one).join('; ')}${here.length > 1 ? ' (a run takes one phone: unplug the others)' : ''}` : 'no iPhone or iPad is connected now',
      unlocks: 'the game on your own iPhone or iPad, over the cable (standalone run <game> --for ios --device): it adds the phone to your Apple team\'s device list',
      fix: !found.ok || (ready.length === 1 && here.length === 1) ? null : !here.length ? { who: 'person', say: 'Plug the phone in with a cable, unlock it, and tap Trust if it asks about this computer.' } : here.some((p) => !p.trusted) ? { who: 'person', say: deviceTrouble('not paired').fix } : here.some((p) => p.developerMode !== true) ? { who: 'person', say: deviceTrouble('Developer Mode disabled').fix } : { who: 'person', say: 'Unplug all but the one phone to try the game on.' },
    });
  }
  // steamcmd: only to upload, which a person does.
  {
    const r = await exec(platform === 'win32' ? 'where' : 'which', ['steamcmd'], { timeout: 5000 });
    rows.push({
      id: 'standalone-steamcmd', label: 'steamcmd', need: 'optional', state: r.code === 0 ? 'ok' : 'optional', detail: r.code === 0 ? 'found' : 'not found on the PATH',
      unlocks: 'uploading a build to Steam yourself (standalone steam <game> writes the build file and the exact command)',
      fix: r.code === 0 ? null : { who: 'person', open: 'https://partner.steamgames.com/doc/sdk/uploading', say: 'Steam\'s own uploader comes with the Steamworks SDK, in its content builder folder. You sign in to it yourself; nothing is uploaded for you.' },
    });
  }
  return rows;
}

/** Why a target cannot be built here, with the row that says how to fix it; null when it can. */
function gate(target, { platform, rows, release, env }) {
  const row = (id) => rows.find((r) => r.id === id);
  const ci = 'On another machine: homie-studio standalone ci <game> writes a GitHub workflow that builds every target on GitHub\'s own Windows, Linux and macOS machines.';
  if (target === 'mac' && platform !== 'darwin') return { why: 'a macOS app is put together on a Mac (its bundle is symlinks and a signature)', row: null, instead: ci };
  if (target === 'ios') {
    if (platform !== 'darwin') return { why: 'an iOS app is built on a Mac with Xcode', row: row('standalone-xcode'), instead: ci };
    if (row('standalone-xcode').state !== 'ok') return { why: `Xcode is not ready for iOS (${row('standalone-xcode').detail})`, row: row('standalone-xcode'), instead: ci };
    if (release && !env.HOMIE_APPLE_TEAM) return { why: 'an iOS release is signed with your Apple team: HOMIE_APPLE_TEAM is not set', row: row('standalone-ios-signing') };
  }
  if (target === 'android') {
    if (row('standalone-android').state !== 'ok') return { why: `the Android SDK is not ready (${row('standalone-android').detail})`, row: row('standalone-android'), instead: ci };
    if (row('standalone-jdk').state !== 'ok') return { why: `no JDK that Android's build runs on (${row('standalone-jdk').detail})`, row: row('standalone-jdk'), instead: ci };
  }
  return null;
}

/* ------------------------------------------------------------------ the game, as the wrappers see it */

/** Where a copy looks for rooms: --site, else HOMIE_STANDALONE_SITE, else the studio's own live address. */
function siteOf(root, studio, { site = null, env = process.env } = {}) {
  const said = typeof site === 'string' && site ? [site, '--site'] : env.HOMIE_STANDALONE_SITE ? [env.HOMIE_STANDALONE_SITE, 'HOMIE_STANDALONE_SITE'] : [siteUrl(root, studio), 'the studio\'s live address'];
  if (!said[0]) return { url: '', from: null };
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(said[0]) ? said[0] : `https://${said[0]}`); } catch { return { url: '', from: said[1], problem: `${said[1]} is not an address` }; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { url: '', from: said[1], problem: `${said[1]} must be an https address (http only for this computer's own dev server)` };
  return { url: u.origin, from: said[1], local, workersDev: isWorkersDev(u.origin) };
}

function gameOf(root, id) {
  const games = listGames(root);
  const pick = id ?? (games.length === 1 ? games[0].id : null);
  if (!pick) return { why: `name the game: homie-studio standalone plan <id>${games.length ? ` (${games.map((g) => g.id).join(', ')})` : ' (this studio has no game yet)'}` };
  if (!GAME_ID.test(String(pick))) return { why: `"${String(pick).slice(0, 40)}" is not a game id` };
  const game = games.find((g) => g.id === pick);
  return game ? { game } : { why: `no game "${pick}" in games/${games.length ? ` (${games.map((g) => g.id).join(', ')})` : ''}` };
}

function targetsOf(said) {
  if (said === null || said === undefined) return { named: [], targets: [...TARGETS] };
  // `--for` with nothing after it is a sentence left unfinished, never "all five".
  if (said === true || !String(said).trim()) return { why: `--for needs what to build: ${TARGETS.join(', ')} (comma-separated). Leave --for out for every target this computer can make.` };
  const list = [...new Set(String(said).split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).map((t) => ({ macos: 'mac', darwin: 'mac', win: 'windows', win32: 'windows' })[t] ?? t))];
  const strange = list.filter((t) => !TARGETS.includes(t));
  return strange.length || !list.length ? { why: `--for takes ${TARGETS.join(', ')} (comma-separated); not ${strange.join(', ') || 'nothing'}` } : { named: list, targets: list };
}

/**
 * The studio's own pinned toolkit is from before standalone copies: its Worker, once deployed, does not answer one.
 * Compared with the version standalone arrived in, never with "older than this toolkit". Null when the studio is on
 * it or later, or names no exact version (a link to a checkout).
 */
export function toolkitNote(root) {
  let pkg = null;
  try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { return null; }
  const pinned = pinnedVersion(pkg?.devDependencies?.['@homie-rocks/studio'] ?? pkg?.dependencies?.['@homie-rocks/studio']);
  if (!pinned || compareVersions(pinned, STANDALONE_SINCE) >= 0) return null;
  return `This studio pins @homie-rocks/studio ${pinned}, from before standalone copies (${STANDALONE_SINCE}): its live site does not let a standalone copy read which room to join, so in a copy Quick play is OFFLINE until the studio is upgraded to ${STANDALONE_SINCE} or later AND deployed again. A room made or joined by its code still connects (seen against 0.31.0, not promised for every older version).`;
}

/** Everything a plan and a build both need to know, read once. */
async function survey(root, id, { for: said = null, release = false, site = null, build = null, platform = process.platform, env = process.env, exec = runTool, home = homedir() } = {}) {
  const g = gameOf(root, id);
  if (g.why) return { why: g.why };
  const t = targetsOf(said);
  if (t.why) return { why: t.why };
  const studio = readStudio(root);
  const game = g.game;
  const meta = standaloneMeta(studio, game, { build });
  const rows = await standaloneRows({ platform, exec, env, home });
  const where = siteOf(root, studio, { site, env });
  const icon = iconSource(root, game, meta);
  const warnings = [...meta.problems.map((p) => `games/${game.id}/game.json: ${p}`)];
  if (where.problem) warnings.push(`${where.problem}: the copy would play offline only.`);
  else if (!where.url) warnings.push('This studio has no live address on this computer yet (it has not been deployed from here), so the copy would play OFFLINE ONLY. Deploy first, or name the address: --site https://<your studio\'s address>.');
  else if (!where.local) warnings.push(`${where.url} is built into every copy and cannot be changed in a copy that has shipped: if the studio moves, shipped copies play offline until they are updated.${where.workersDev ? ' This is a workers.dev address, which belongs to the Cloudflare account and changes if the Worker is renamed: put the studio on its own domain (studio.json cloudflare.domain) before you ship.' : ''}`);
  if (!meta.netplayVersion) warnings.push(`games/${game.id}/game.json names no "netplay.version". A copy that ships without one can never be told from a later build of the game: add "netplay": { "version": "1" } before you ship, and raise it with every change an older copy cannot play with.`);
  if (meta.appIdFrom === 'derived') warnings.push(`The app's id is a made-up one for trying a build (${meta.appId}). A store never lets an id change, so a release asks for yours first.`);
  if (meta.file !== meta.name) warnings.push(`The game's name has characters a file's name cannot. The desktop app is the file "${meta.file}", and macOS shows that in its menu bar and Dock; the window's title and the phone apps show "${meta.name}".`);
  // The game's own page: a policy of its own that would stop the one script a copy adds to it.
  for (const page of [join(root, 'site', 'dist', 'games', game.id, 'index.html'), join(game.dir, 'index.html')]) {
    let html = null;
    try { html = readFileSync(page, 'utf8'); } catch { continue; }
    const csp = cspBlocksInline(html);
    if (csp) warnings.push(`The game's index.html has a Content-Security-Policy (${csp.slice(0, 80)}) that does not allow an inline script. A standalone copy adds one inline script to that page to hand the game its room; with this policy the game never hears it and plays OFFLINE ONLY. Allow 'unsafe-inline' for scripts in that policy, or take the policy out of the page.`);
    break;
  }
  const note = toolkitNote(root);
  const sdk = androidSdk({ env, platform, home });
  const host = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform] ?? null;
  return { root, game, studio, meta, rows, where, icon, warnings, note, named: t.named, targets: t.targets, release: release === true, kind: release === true ? 'release' : 'debug', platform, host, env, exec, home, sdk, dir: standaloneDir(root, game.id) };
}

const OUTPUT = {
  mac: (m, kind) => `out/mac/${kind}/${m.file}.app${kind === 'release' ? ' (signed, and notarized, only when the environment has the identity and the profile)' : ''}`,
  windows: (m, kind) => `out/windows/${kind}/${m.id}.exe and its files (unsigned)`,
  linux: (m, kind) => `out/linux/${kind}/${m.id} and its files`,
  ios: (m, kind) => (kind === 'release' ? 'out/ios/release/ (an .ipa, the file App Store Connect accepts for upload)' : `out/ios/debug/${m.file}.app (a simulator build)`),
  android: (m, kind) => (kind === 'release' ? `out/android/release/${m.id}-release.aab (the file Google Play accepts for upload)` : `out/android/debug/${m.id}-debug.apk`),
};
const TOOL = { mac: 'Electron', windows: 'Electron', linux: 'Electron', ios: 'Capacitor and Xcode', android: 'Capacitor and Gradle' };

/** What a release still needs said before anything is built: the id a store keeps for good. */
function releaseRefusal(s, command) {
  if (!s.release || s.meta.appIdFrom === 'game.json') return null;
  return {
    ok: false, command, game: s.game.id, needs: 'appId',
    why: `A release needs the app's own id, written down once: a store never lets it change, so it is not guessed. Add this to games/${s.game.id}/game.json (change the id to one under a domain you own, or keep it), then build again:`,
    instead: standaloneBlock(s.meta),
  };
}

/**
 * `standalone plan <game>`: what would be built, for which targets, with what, and what each still needs. Changes
 * nothing and installs nothing.
 */
export async function standalonePlan(root, id, opts = {}) {
  const s = await survey(root, id, opts);
  if (s.why) return { ok: false, command: 'standalone plan', why: s.why };
  const refused = releaseRefusal(s, 'standalone plan');
  const targets = s.targets.map((target) => {
    const g = gate(target, s);
    return { target, with: TOOL[target], state: g ? 'skipped' : 'ready', ...(g ? { why: g.why, row: g.row?.id ?? null, fix: g.row?.fix ?? null, instead: g.instead ?? null } : {}), output: OUTPUT[target](s.meta, s.kind) };
  });
  return {
    ok: !refused, command: 'standalone plan', game: s.game.id, name: s.meta.name, file: s.meta.file, publisher: s.meta.publisher,
    appId: s.meta.appId, appIdFrom: s.meta.appIdFrom, version: s.meta.version, build: s.meta.build, orientation: s.meta.orientation,
    netplayVersion: s.meta.netplayVersion, site: s.where.url || null, siteFrom: s.where.from, release: s.release,
    icon: { from: s.icon.from, note: s.icon.note }, steam: s.meta.steam,
    dir: relative(root, s.dir), targets, rows: s.rows, warnings: s.warnings, missing: MISSING, pins: STANDALONE_PINS,
    ...(s.note ? { toolkitNote: s.note } : {}),
    needs: `Quick play finds a room only when the live site runs @homie-rocks/studio ${STANDALONE_SINCE} or later (upgrade the studio, then deploy). A room made or joined by its code works with an older site too (seen against 0.31.0, not promised for every older version). This plan did not ask the site which version it runs.`,
    ...(refused ? { why: refused.why, instead: refused.instead, needsField: 'appId' } : {}),
  };
}

/* ------------------------------------------------------------------ the web folder */

const copyTree = (from, to) => { rmSync(to, { recursive: true, force: true }); cpSync(from, to, { recursive: true, dereference: true }); };

/**
 * web/: the shell's three files, config.js, and game/ (the built game). The game's files are copied as the site's
 * build made them; its index.html alone gains one script (withNetScript). Returns { files, bytes } of game/.
 */
export function webBundle(root, game, dir, { meta, target = 'web', site = '', studio = null } = {}) {
  const built = join(root, 'site', 'dist', 'games', game.id);
  if (!existsSync(join(built, 'index.html'))) throw new Error(`site/dist/games/${game.id}/ has no build of the game: run homie-studio build ${game.id} first`);
  const web = join(dir, 'web');
  rmSync(web, { recursive: true, force: true });
  mkdirSync(web, { recursive: true });
  for (const f of ['index.html', 'shell.js', 'shell.css']) copyFileSync(join(SHELL, f), join(web, f));
  const m = meta ?? standaloneMeta(studio ?? readStudio(root), game);
  writeFileSync(join(web, 'config.js'), configScript(m, { target, site, share: sharePlaces(game.screen?.share), colours: uiOf(game), movement: game.netplay?.movement ?? game.movement ?? null }));
  copyTree(built, join(web, 'game'));
  const index = join(web, 'game', 'index.html');
  writeFileSync(index, withNetScript(readFileSync(index, 'utf8')));
  let files = 0; let bytes = 0;
  const walk = (at) => { for (const e of readdirSync(at, { withFileTypes: true })) { const p = join(at, e.name); if (e.isDirectory()) walk(p); else { files += 1; bytes += statSync(p).size; } } };
  walk(join(web, 'game'));
  return { files, bytes };
}

const npmOf = (s) => (s.platform === 'win32' ? ['npm.cmd', { shell: true }] : ['npm', {}]);
/**
 * The standalone project's own package.json and its tools. Installed when the pins changed or when the last install
 * did not finish (npm writes node_modules/.package-lock.json as the last thing it does: without it, the install is
 * not one); `again` installs whatever is there. The tree is npm's to choose only once: lib/standalone-lock.json
 * names every package at its exact version with its checksum, and is copied in as the project's lockfile.
 */
export async function installTools(s, { say = () => {}, again = false } = {}) {
  const file = join(s.dir, 'package.json');
  let had = {};
  try { had = JSON.parse(readFileSync(file, 'utf8')).devDependencies ?? {}; } catch { had = {}; }
  // The tools of the targets asked for now, and of any asked for before: npm would otherwise take those out again.
  const groups = [...new Set([...s.targets, ...(Object.keys(had).some((k) => k in STANDALONE_PINS.desktop) ? ['mac'] : []), ...(Object.keys(had).some((k) => k in STANDALONE_PINS.mobile) ? ['ios'] : [])])];
  const pkg = projectPackage(s.meta, { targets: groups });
  const finished = existsSync(join(s.dir, 'node_modules', '.package-lock.json')) && Object.keys(pkg.devDependencies).every((k) => existsSync(join(s.dir, 'node_modules', ...k.split('/'), 'package.json')));
  const same = JSON.stringify(had) === JSON.stringify(pkg.devDependencies);
  mkdirSync(s.dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  if (same && finished && !again) return { ok: true, installed: false };
  say(again ? 'installing the wrapper tools again' : !same || !existsSync(join(s.dir, 'node_modules')) ? `installing the wrapper tools into .studio/standalone/${s.game.id}/ (${Object.entries(pkg.devDependencies).map(([k, v]) => `${k} ${v}`).join(', ')}); the first time downloads a few hundred MB` : 'the last install of the wrapper tools did not finish: installing them again');
  // The lockfile this toolkit ships, and npm made to look at what is really on the disk, not at its own note of it.
  try { copyFileSync(LOCK, join(s.dir, 'package-lock.json')); } catch { /* an install without it still pins the top-level tools */ }
  rmSync(join(s.dir, 'node_modules', '.package-lock.json'), { force: true });
  const [npm, how] = npmOf(s);
  const r = await s.exec(npm, ['install', '--no-audit', '--no-fund'], { cwd: s.dir, env: toolEnv(s.env), timeout: 20 * 60_000, ...how });
  return r.code === 0 ? { ok: true, installed: true } : { ok: false, why: `npm install of the wrapper tools failed: ${tail(r)}` };
}

const NOT_THERE = /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:module|package)/;
/**
 * Run a wrapper tool; when it stops because a file of the tools themselves is missing (an install that was
 * interrupted, a folder somebody tidied), install them again ONCE and run it again, and say so in plain words.
 */
async function repaired(s, run, { say }) {
  let r = await run();
  if (r.code === 0 || !NOT_THERE.test(`${r.stdout}\n${r.stderr}`)) return r;
  say('A file of the wrapper tools is missing (an install that did not finish, or a folder that was tidied): installing them again, once, and trying again.');
  const again = await installTools(s, { say, again: true });
  if (!again.ok) return { ...r, stderr: `${r.stderr}\n${again.why}` };
  r = await run();
  return { ...r, reinstalled: true };
}

/** A tool of the standalone project, run by this Node from its own file: no shell, no npx, the same on every OS. */
const BIN = { cap: ['@capacitor', 'cli', 'bin', 'capacitor'], assets: ['@capacitor', 'assets', 'bin', 'capacitor-assets'], electron: ['electron', 'cli.js'] };
const tool = (s, name, args, opts = {}) => s.exec(process.execPath, [join(s.dir, 'node_modules', ...BIN[name]), ...args], { cwd: s.dir, env: toolEnv(s.env), ...opts });

/* ------------------------------------------------------------------ the desktop builds */

function writeElectron(s) {
  const e = join(s.dir, 'electron');
  const steamApi = s.meta.steam.api && Boolean(s.meta.steam.app) && Boolean(s.env.HOMIE_STEAMWORKS_SDK);
  rmSync(join(e, 'web'), { recursive: true, force: true });
  mkdirSync(e, { recursive: true });
  writeFileSync(join(e, 'package.json'), `${JSON.stringify(electronPackage(s.meta, { steamApi }), null, 2)}\n`);
  writeFileSync(join(e, 'app.json'), `${JSON.stringify(electronApp(s.meta, { colours: uiOf(s.game), steamApi }), null, 2)}\n`);
  for (const f of ['main.cjs', 'files.cjs']) copyFileSync(join(ELECTRON, f), join(e, f));
  copyFileSync(join(ELECTRON, 'pack.mjs'), join(s.dir, 'pack.mjs'));
  // Used by pack.mjs only for a game Steam starts (and an ad hoc signature); otherwise the signer's defaults stand.
  writeFileSync(join(s.dir, 'entitlements.mac.plist'), entitlementsPlist());
  if (existsSync(join(s.dir, 'icons', 'icon.png'))) copyFileSync(join(s.dir, 'icons', 'icon.png'), join(e, 'icon.png'));
  return { steamApi };
}

/** Steam's own API, only when game.json asked and the SDK's folder is named: the binding, and Steam's libraries copied in. */
async function steamBinding(s, { say }) {
  const e = join(s.dir, 'electron');
  const sdk = s.env.HOMIE_STEAMWORKS_SDK;
  const redist = [join(sdk, 'redistributable_bin'), join(sdk, 'sdk', 'redistributable_bin')].find((d) => existsSync(d));
  if (!redist) return { ok: false, why: 'HOMIE_STEAMWORKS_SDK does not name a Steamworks SDK folder (it has no redistributable_bin)' };
  copyTree(redist, join(e, 'steamworks_sdk', 'redistributable_bin'));
  say(`installing ${Object.entries(STANDALONE_PINS.steam).map(([k, v]) => `${k} ${v}`).join(', ')} into the desktop app`);
  const [npm, how] = npmOf(s);
  const r = await s.exec(npm, ['install', '--no-audit', '--no-fund', '--omit=dev'], { cwd: e, env: toolEnv(s.env), timeout: 10 * 60_000, ...how });
  return r.code === 0 ? { ok: true } : { ok: false, why: `npm install of the Steam binding failed: ${tail(r)}` };
}

/**
 * Start the app that was just built, once, with the shell's own self-check: it loads the page, waits, and says in
 * one line whether the game's frame loaded. { ran, loaded, clean, origin, failed, errors } or { ran: false, why }.
 */
async function startOnce(s, exe) {
  const r = await s.exec(exe, ['--smoke=5000'], { cwd: dirname(exe), env: (() => { const e = toolEnv(s.env); delete e.ELECTRON_RUN_AS_NODE; return e; })(), timeout: 90_000 });
  const out = lastJson(r.stdout);
  if (!out || out.smoke !== 1) return { ran: false, why: r.code === 124 ? 'it did not answer in 90 s' : `it did not start (${tail(r, 3) || `code ${r.code}`})` };
  return { ran: true, loaded: out.loaded === true, clean: out.ok === true, origin: out.origin ?? null, failed: (out.failed ?? []).slice(0, 6), errors: (out.errors ?? []).slice(0, 6) };
}

const PACK = { mac: 'darwin', windows: 'win32', linux: 'linux' };
async function buildDesktop(s, target, { say }) {
  const arch = target === 'mac' ? (s.release ? 'universal' : process.arch === 'arm64' ? 'arm64' : 'x64') : 'x64';
  const notes = [];
  say(`packaging for ${target} ${arch}`);
  // The one child that signs: it alone is given the identity's name and the notary profile's.
  const r = await repaired(s, () => s.exec(process.execPath, [join(s.dir, 'pack.mjs'), PACK[target], arch, s.kind], { cwd: s.dir, env: toolEnv(s.env, target === 'mac' && s.release ? ['HOMIE_APPLE_IDENTITY', 'HOMIE_APPLE_NOTARY_PROFILE'] : []), timeout: 40 * 60_000 }), { say });
  const out = lastJson(r.stdout);
  if (r.code !== 0 || !out?.ok) return { state: 'failed', why: out?.why ?? `the packager did not finish: ${tail(r)}` };
  if (!out.app || !existsSync(out.app) || !existsSync(out.exe)) return { state: 'failed', why: 'the packager said it finished, and the app is not where it said' };
  if (r.reinstalled) notes.push('the wrapper tools were installed again first: a file of theirs was missing');
  let unsigned = false;
  if (target === 'mac') {
    if (!s.release) notes.push('not signed (a build to try on this Mac; a release signs it)');
    else if (!s.env.HOMIE_APPLE_IDENTITY) { unsigned = true; notes.push('UNSIGNED: HOMIE_APPLE_IDENTITY is not set, so this release was not signed and not notarized. macOS will not open it on another Mac, and Steam asks for a signed, notarized macOS app.'); }
    else if (!out.signed) { unsigned = true; notes.push(`UNSIGNED: the signer ran and codesign does not verify the app (${String(out.checks?.signatureSays ?? 'no reason given').slice(0, 200)}).`); }
    else if (out.adhoc) { unsigned = true; notes.push('signed AD HOC (HOMIE_APPLE_IDENTITY is -): only this Mac trusts it. Not a release: another Mac and Steam will not take it.'); }
    else if (!out.notarizeAsked) { unsigned = true; notes.push('signed (codesign verifies it), NOT NOTARIZED: HOMIE_APPLE_NOTARY_PROFILE is not set. macOS refuses to open it on another Mac, and Steam asks for it.'); }
    else if (!out.notarized) { unsigned = true; notes.push(`signed, and the notary was asked, but NOT CONFIRMED NOTARIZED: stapler does not validate the app (${String(out.checks?.stapledSays ?? 'no reason given').slice(0, 200)}).`); }
    else notes.push('signed and notarized: codesign verifies the signature and stapler validates the ticket (opening it on another Mac was not tried)');
  }
  if (target === 'windows') notes.push('unsigned: opened outside Steam, Windows shows its unknown-publisher warning');
  if (target === 'linux') notes.push('a plain folder with no installer: on Ubuntu 24.04 and later, a program in such a folder may refuse to start outside Steam until its chrome-sandbox file is owned by root with mode 4755, or it is started with --no-sandbox');
  if (target !== 'linux' && !existsSync(join(s.dir, 'icons', target === 'mac' ? 'icon.icns' : 'icon.ico'))) notes.push('it has Electron\'s own icon: the game\'s icon could not be written');
  // The one build this computer can run: started once, and what happened is said.
  let started = null;
  if (target === s.host && s.smoke !== false) {
    say(`starting the ${target} build once to see that the game loads`);
    started = await startOnce(s, out.exe);
    notes.push(started.ran ? `started here and loaded the game: ${started.loaded ? `yes${started.clean ? '' : ` (with ${started.failed.length} file(s) that did not load and ${started.errors.length} error(s) in its console)`}` : 'NO'}` : `could not be started here: ${started.why}`);
  } else notes.push('built, not started on this computer');
  return { state: 'built', kind: s.kind, path: relative(s.dir, out.app), program: relative(s.dir, out.exe), arch, electron: out.electron, started, ...(target === 'mac' ? { signed: Boolean(out.signed), notarized: Boolean(out.notarized) } : {}), ...(unsigned ? { unsigned: true } : {}), notes };
}

/* ------------------------------------------------------------------ the phone builds */

/** What Capacitor's own commands and Gradle are given: the SDK and the JDK that were chosen, for every call. */
async function phoneEnv(s, keep = []) {
  const env = toolEnv(s.env, keep);
  if (s.sdk) { env.ANDROID_HOME = s.sdk.dir; env.ANDROID_SDK_ROOT = s.sdk.dir; }
  s.jdk ??= await findJdk({ env: s.env, platform: s.platform, exec: s.exec });
  if (s.jdk.home) env.JAVA_HOME = s.jdk.home;
  return env;
}

const marker = (s) => join(s.dir, 'capacitor.app.json');
/**
 * The native project (ios/ or android/), made by `cap add` and kept between builds. Capacitor writes the app's id
 * and its name into it when it makes it, so it is made again when either changed.
 */
async function capProject(s, platform, { say }) {
  writeFileSync(join(s.dir, 'capacitor.config.json'), `${JSON.stringify(capacitorConfig(s.meta, { colours: uiOf(s.game) }), null, 2)}\n`);
  let was = {};
  try { was = JSON.parse(readFileSync(marker(s), 'utf8')); } catch { was = {}; }
  const now = { appId: s.meta.appId, name: s.meta.name };
  const notes = [];
  if (existsSync(join(s.dir, platform)) && (was[platform]?.appId !== now.appId || was[platform]?.name !== now.name)) {
    rmSync(join(s.dir, platform), { recursive: true, force: true });
    notes.push(`its native project was made again: the app's ${was[platform]?.appId !== now.appId ? 'id' : 'name'} changed`);
  }
  const env = await phoneEnv(s);
  if (!existsSync(join(s.dir, platform))) {
    say(`making the ${platform === 'ios' ? 'iOS' : 'Android'} project (cap add ${platform})`);
    const r = await repaired(s, () => tool(s, 'cap', ['add', platform], { env, timeout: 15 * 60_000 }), { say });
    if (r.code !== 0) return { ok: false, why: `cap add ${platform} failed: ${tail(r)}` };
  }
  writeFileSync(marker(s), `${JSON.stringify({ ...was, [platform]: now }, null, 2)}\n`);
  // Icons and splash screens: @capacitor/assets, from the pictures in assets/.
  const a = await repaired(s, () => tool(s, 'assets', ['generate', `--${platform}`], { env, timeout: 10 * 60_000 }), { say });
  if (a.code !== 0) notes.push(`its icon and splash screen are Capacitor's own: @capacitor/assets did not finish (${tail(a, 3)})`);
  return { ok: true, notes, env };
}
const patch = (file, fn) => { if (!existsSync(file)) return false; const before = readFileSync(file, 'utf8'); const after = fn(before); if (after !== before) writeFileSync(file, after); return true; };
const freshOut = (s, target) => { const out = join(s.dir, 'out', target, s.kind); rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true }); return out; };

/** The iOS project with this build's web folder in it, ready for xcodebuild: { ok, notes, project } or { ok: false, why }. */
async function iosProject(s, { say }) {
  const p = await capProject(s, 'ios', { say });
  if (!p.ok) return { ok: false, why: p.why };
  const notes = [...p.notes];
  if (!patch(join(s.dir, 'ios', 'App', 'App', 'Info.plist'), (t) => patchInfoPlist(t, s.meta.orientation))) notes.push('Info.plist was not where Capacitor puts it: the way the game is held was not set');
  const sync = await tool(s, 'cap', ['sync', 'ios'], { env: p.env, timeout: 15 * 60_000 });
  if (sync.code !== 0) return { ok: false, why: `cap sync ios failed: ${tail(sync)}` };
  const app = join(s.dir, 'ios', 'App');
  return { ok: true, notes, project: existsSync(join(app, 'App.xcworkspace')) ? ['-workspace', join(app, 'App.xcworkspace')] : ['-project', join(app, 'App.xcodeproj')] };
}

async function buildIos(s, { say }) {
  const p = await iosProject(s, { say });
  if (!p.ok) return { state: 'failed', why: p.why };
  const { notes, project } = p;
  const derived = join(s.dir, 'ios', 'build');
  const version = [`MARKETING_VERSION=${s.meta.version}`, `CURRENT_PROJECT_VERSION=${s.meta.build}`];
  const env = toolEnv(s.env);
  if (!s.release) {
    say('xcodebuild: a Debug build for the simulator (the first one fetches Capacitor\'s iOS package)');
    const r = await s.exec('xcodebuild', [...project, '-scheme', 'App', '-configuration', 'Debug', '-sdk', 'iphonesimulator', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derived, ...version, 'CODE_SIGNING_ALLOWED=NO', 'build'], { cwd: s.dir, env, timeout: 40 * 60_000 });
    const made = join(derived, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
    if (r.code !== 0 || !existsSync(made)) return { state: 'failed', why: `xcodebuild did not finish: ${tail(r, 12)}` };
    const out = freshOut(s, 'ios');
    cpSync(made, join(out, `${s.meta.file}.app`), { recursive: true });
    notes.push('a simulator build, unsigned: it runs in the iOS Simulator, not on a phone and not in the store', 'built, not started on this computer');
    return { state: 'built', kind: s.kind, path: join('out', 'ios', s.kind, `${s.meta.file}.app`), started: null, notes };
  }
  const team = String(s.env.HOMIE_APPLE_TEAM).replace(/[^A-Za-z0-9]/g, '');
  const archive = join(s.dir, 'ios', 'build', `${s.meta.id}.xcarchive`);
  rmSync(archive, { recursive: true, force: true });
  say('xcodebuild: archiving a Release build signed by your team (Xcode must be signed in to an Apple account of that team)');
  const a = await s.exec('xcodebuild', [...project, '-scheme', 'App', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-derivedDataPath', derived, '-archivePath', archive, ...version, `DEVELOPMENT_TEAM=${team}`, '-allowProvisioningUpdates', 'archive'], { cwd: s.dir, env, timeout: 60 * 60_000 });
  if (a.code !== 0 || !existsSync(archive)) return { state: 'failed', why: `xcodebuild archive did not finish (it needs Xcode signed in to an Apple account of team ${team}: Xcode, Settings, Accounts): ${tail(a, 12)}` };
  const options = join(s.dir, 'ios', 'build', 'exportOptions.plist');
  writeFileSync(options, exportOptionsPlist(team));
  const out = freshOut(s, 'ios');
  const x = await s.exec('xcodebuild', ['-exportArchive', '-archivePath', archive, '-exportPath', out, '-exportOptionsPlist', options, '-allowProvisioningUpdates'], { cwd: s.dir, env, timeout: 30 * 60_000 });
  const ipa = readdirSync(out).find((f) => f.endsWith('.ipa'));
  if (x.code !== 0 || !ipa) return { state: 'failed', why: `the archive was made but not exported to an .ipa: ${tail(x, 12)}` };
  notes.push('signed by Xcode for your team; built, not started on this computer, and App Store Connect has not looked at it');
  return { state: 'built', kind: s.kind, path: join('out', 'ios', s.kind, ipa), started: null, notes };
}

/**
 * Android's upload key, from the environment only. It reaches Gradle as environment variables too
 * (ORG_GRADLE_PROJECT_…, which Gradle reads as the project properties the Android plugin signs with), so neither
 * password is ever in a command line, where any program on the computer could read it, or in a file.
 */
export function androidSigning(env = process.env) {
  const have = ['HOMIE_ANDROID_KEYSTORE', 'HOMIE_ANDROID_KEYSTORE_PASSWORD', 'HOMIE_ANDROID_KEY_ALIAS', 'HOMIE_ANDROID_KEY_PASSWORD'].filter((k) => env[k]);
  if (have.length < 4) return { ok: false, set: have.length };
  return {
    ok: true,
    env: {
      'ORG_GRADLE_PROJECT_android.injected.signing.store.file': env.HOMIE_ANDROID_KEYSTORE,
      'ORG_GRADLE_PROJECT_android.injected.signing.store.password': env.HOMIE_ANDROID_KEYSTORE_PASSWORD,
      'ORG_GRADLE_PROJECT_android.injected.signing.key.alias': env.HOMIE_ANDROID_KEY_ALIAS,
      'ORG_GRADLE_PROJECT_android.injected.signing.key.password': env.HOMIE_ANDROID_KEY_PASSWORD,
    },
  };
}

async function buildAndroid(s, { say }) {
  const p = await capProject(s, 'android', { say });
  if (!p.ok) return { state: 'failed', why: p.why };
  const notes = [...p.notes];
  const a = join(s.dir, 'android');
  patch(join(a, 'app', 'src', 'main', 'AndroidManifest.xml'), (t) => patchAndroidManifest(t, s.meta.orientation));
  if (!patch(join(a, 'app', 'build.gradle'), (t) => patchGradle(t, s.meta))) notes.push('app/build.gradle was not where Capacitor puts it: the version was not set');
  const sync = await tool(s, 'cap', ['sync', 'android'], { env: p.env, timeout: 15 * 60_000 });
  if (sync.code !== 0) return { state: 'failed', why: `cap sync android failed: ${tail(sync)}` };
  const sign = s.release ? androidSigning(s.env) : { ok: false };
  // Gradle is the one child that signs: it alone is given the key, as its own project properties.
  const env = { ...p.env, ...(sign.ok ? sign.env : {}) };
  const win = s.platform === 'win32';
  const task = s.release ? 'bundleRelease' : 'assembleDebug';
  // Nothing of Gradle's stays running afterwards: its background process is told to stop once the build ends.
  say(`gradle ${task} (the first one downloads Gradle and Android's build tools)`);
  const r = await s.exec(win ? 'gradlew.bat' : join(a, 'gradlew'), [task, '--console=plain', '-q'], { cwd: a, env, timeout: 60 * 60_000, ...(win ? { shell: true } : {}) });
  await s.exec(win ? 'gradlew.bat' : join(a, 'gradlew'), ['--stop'], { cwd: a, env: p.env, timeout: 60_000, ...(win ? { shell: true } : {}) });
  const made = s.release ? join(a, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab') : join(a, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (r.code !== 0 || !existsSync(made)) return { state: 'failed', why: `gradle ${task} did not finish: ${tail(r, 12)}` };
  const out = freshOut(s, 'android');
  const name = s.release ? `${s.meta.id}-release.aab` : `${s.meta.id}-debug.apk`;
  copyFileSync(made, join(out, name));
  // Whether the bundle is signed is read back from the bundle itself (the JDK's own keytool), never taken from
  // "Gradle was given a key and did not complain".
  let unsigned = false;
  if (s.release && !sign.ok) { unsigned = true; notes.push(`UNSIGNED: ${sign.set} of the four HOMIE_ANDROID_* values are set. Google Play accepts only a bundle signed with your upload key.`); }
  else if (s.release) {
    const k = await s.exec(s.jdk?.home ? join(s.jdk.home, 'bin', win ? 'keytool.exe' : 'keytool') : 'keytool', ['-printcert', '-jarfile', join(out, name)], { env: toolEnv(s.env), timeout: 60_000 });
    if (k.code === 0 && /Signer #1/.test(k.stdout)) notes.push('signed with your upload key: the bundle carries a signer\'s certificate (Google Play has not looked at it)');
    else { unsigned = true; notes.push(k.code === 0 ? 'UNSIGNED: Gradle was given your upload key and finished, and the bundle carries no signature.' : 'NOT CONFIRMED SIGNED: Gradle was given your upload key and finished, and the bundle could not be read back to see its signature (keytool did not run).'); }
  } else notes.push('a debug build, signed with Android\'s debug key: it installs on a phone or an emulator, not in the store');
  notes.push('built, not started on this computer');
  return { state: 'built', kind: s.kind, path: join('out', 'android', s.kind, name), started: null, ...(unsigned ? { unsigned: true } : {}), notes };
}

/* ------------------------------------------------------------------ build */

/** What to do with what was built: the exact steps, for the person. Nothing here is run. */
function uploadSteps(s, results) {
  const steps = [];
  const of = (t) => results.find((r) => r.target === t && r.state === 'built');
  if (DESKTOP.some(of)) {
    steps.push(s.meta.steam.app
      ? `Steam (release builds only): npx --no-install homie-studio standalone steam ${s.game.id} writes the build file; then, in your own terminal, signed in as yourself: steamcmd +login <your Steam account> +run_app_build "${join(s.dir, 'steam', 'app_build.vdf')}" +quit`
      : `Steam: when you have an app in Steamworks, put its numbers in games/${s.game.id}/game.json ("standalone": { "steam": { "app": …, "depots": { "windows": …, "mac": …, "linux": … } } }); npx --no-install homie-studio standalone steam ${s.game.id} says exactly what to make there.`);
  }
  if (of('ios')) steps.push(s.release ? `App Store Connect: open Transporter (free on the Mac App Store), sign in as yourself, drop in ${join(s.dir, of('ios').path)} and press Deliver. The app's record (${s.meta.appId}) must exist in App Store Connect first; Apple then reviews it.` : `iOS: this is a simulator build. For the store: set HOMIE_APPLE_TEAM, then npx --no-install homie-studio standalone build ${s.game.id} --for ios --release.`);
  if (of('android')) steps.push(s.release ? `Google Play: in the Play Console, your app, Testing, Create new release, upload ${join(s.dir, of('android').path)}. Google then reviews it.` : `Android: this is a debug build. For the store: npx --no-install homie-studio standalone build ${s.game.id} --for android --release, with your upload key in the four HOMIE_ANDROID_* environment variables.`);
  return steps;
}

/** built.json: what each target's debug and release copy was built from, one entry each, never one merged under another's numbers. */
function readBuilt(dir) {
  try { const b = JSON.parse(readFileSync(join(dir, 'built.json'), 'utf8')); return b && b.v === 2 && b.targets && typeof b.targets === 'object' ? b : null; } catch { return null; }
}

/**
 * `standalone build <game> [--for mac,windows,linux,ios,android] [--release] [--site <address>] [--build <n>]`.
 * Builds the game for the web first (the same build the site serves), then each target that this computer can make.
 * { ok, targets: [{ target, state: built | skipped | failed, … }], missing, next }. `ok` is true only when something
 * was built AND nothing failed AND no release came out unsigned AND every target named in --for was built.
 */
export async function standaloneBuild(root, id, opts = {}) {
  const say = opts.log ?? (() => {});
  const s = await survey(root, id, opts);
  if (s.why) return { ok: false, command: 'standalone build', why: s.why };
  s.smoke = opts.smoke;
  const refused = releaseRefusal(s, 'standalone build');
  if (refused) return refused;
  const results = [];
  const able = [];
  for (const target of s.targets) {
    const g = gate(target, s);
    if (g) results.push({ target, state: 'skipped', why: g.why, row: g.row?.id ?? null, fix: g.row?.fix ?? null, instead: g.instead ?? null });
    else able.push(target);
  }
  const done = (extra = {}) => {
    const built = results.filter((r) => r.state === 'built').map((r) => r.target);
    const failed = results.filter((r) => r.state === 'failed').map((r) => r.target);
    const unsigned = results.filter((r) => r.unsigned).map((r) => r.target);
    const unbuilt = s.named.filter((t) => !built.includes(t));
    const order = (a, b) => TARGETS.indexOf(a.target) - TARGETS.indexOf(b.target);
    const ok = built.length > 0 && !failed.length && !unsigned.length && !unbuilt.length;
    const why = extra.why ?? [failed.length ? `failed: ${failed.join(', ')}` : '', unbuilt.filter((t) => !failed.includes(t)).length ? `not built: ${unbuilt.filter((t) => !failed.includes(t)).join(', ')}` : '', unsigned.length ? `built UNSIGNED, which no store takes: ${unsigned.join(', ')}` : '', !built.length && !failed.length && !unbuilt.length ? 'nothing was built: every target was skipped' : ''].filter(Boolean).join('; ');
    return {
      ok, command: 'standalone build', game: s.game.id, name: s.meta.name, file: s.meta.file, appId: s.meta.appId, appIdFrom: s.meta.appIdFrom, version: s.meta.version, build: s.meta.build,
      release: s.release, site: s.where.url || null, netplayVersion: s.meta.netplayVersion, icon: { from: s.icon.from, note: s.icon.note }, dir: relative(root, s.dir),
      targets: results.sort(order), built, failed, unsigned, warnings: s.warnings, missing: MISSING, next: uploadSteps(s, results),
      ...(s.note ? { toolkitNote: s.note } : {}), ...extra, ...(ok ? {} : { why }),
    };
  };
  if (!able.length) return done();
  // The game, built as the site builds it: a copy is that build and nothing else.
  if (opts.buildSite !== false) {
    say(`building ${s.game.id} for the web (the same build the site serves)`);
    try { await (opts.buildSite ?? buildSite)(root, { only: s.game.id, log: say }); } catch (error) { for (const target of able) results.push({ target, state: 'failed', why: 'the game did not build for the web' }); return done({ why: `the game did not build: ${String(error?.message ?? error)}` }); }
  }
  const tools = await installTools({ ...s, targets: able }, { say });
  if (!tools.ok) { for (const target of able) results.push({ target, state: 'failed', why: tools.why }); return done({ why: tools.why }); }
  const icons = await writeIcons(s.dir, s.icon, { name: s.meta.name, colours: uiOf(s.game) });
  if (!icons.ok) s.warnings.push(`The icon was not made: ${icons.why}.`);
  mkdirSync(join(s.dir, 'out'), { recursive: true });
  let files = null;
  for (const target of able) {
    say(`${target}: ${TOOL[target]}`);
    let r;
    try {
      files = webBundle(root, s.game, s.dir, { meta: s.meta, target, site: s.where.url });
      if (DESKTOP.includes(target)) {
        const e = writeElectron(s);
        cpSync(join(s.dir, 'web'), join(s.dir, 'electron', 'web'), { recursive: true });
        const steam = e.steamApi ? await steamBinding(s, { say }) : null;
        r = await buildDesktop(s, target, { say });
        if (r.state === 'built' && s.meta.steam.api && !e.steamApi) r.notes.push('game.json asks for Steam\'s API ("standalone.steam.api"), which needs "steam.app" and HOMIE_STEAMWORKS_SDK (the folder of the Steamworks SDK you downloaded): built without it');
        if (r.state === 'built' && steam && !steam.ok) r.notes.push(`built without Steam's API: ${steam.why}`);
        if (r.state === 'built' && steam?.ok) r.notes.push('Steam\'s API binding is in the app; it has never been run, and says in the app\'s log whether it started');
      } else r = target === 'ios' ? await buildIos(s, { say }) : await buildAndroid(s, { say });
    } catch (error) { r = { state: 'failed', why: String(error?.message ?? error).split('\n')[0] }; }
    // What is reported is there: a path that is not is a failure, whatever the tool said.
    if (r.state === 'built' && !existsSync(join(s.dir, r.path))) r = { state: 'failed', why: `the build finished and ${r.path} is not there` };
    results.push({ target, ...r });
    say(`${target}: ${r.state}${r.unsigned ? ' (UNSIGNED)' : ''}${r.why ? ` (${r.why.slice(0, 200)})` : ''}`);
  }
  // What the copies out there are: the deploy that changes the game's revision reads this and says what it means.
  const before = readBuilt(s.dir) ?? { v: 2, game: s.game.id, targets: {} };
  for (const r of results.filter((x) => x.state === 'built')) {
    before.targets[r.target] = { ...(before.targets[r.target] ?? {}), [s.kind]: { version: s.meta.version, build: s.meta.build, netplayVersion: s.meta.netplayVersion, at: new Date().toISOString(), toolkit: STUDIO_VERSION, path: r.path, ...(r.unsigned ? { unsigned: true } : {}) } };
  }
  if (results.some((x) => x.state === 'built')) writeFileSync(join(s.dir, 'built.json'), `${JSON.stringify({ ...before, v: 2, game: s.game.id, name: s.meta.name }, null, 2)}\n`);
  return done({ ...(files ? { game_files: files } : {}) });
}

/* ------------------------------------------------------------------ run, steam, ci, deploy */

/** `standalone run <game> [--for mac|windows|linux|ios|android]`: the copy that was built, started here. */
export async function standaloneRun(root, id, opts = {}) {
  const { for: said = null, platform = process.platform, env = process.env, exec = runTool, home = homedir(), device = false } = opts;
  const g = gameOf(root, id);
  if (g.why) return { ok: false, command: 'standalone run', why: g.why };
  // --device: onto the one phone that is plugged in (runOnPhone). It is the person's yes to what that changes.
  if (device) {
    const asked = targetsOf(said ?? 'ios');
    if (asked.why || asked.targets.length !== 1) return { ok: false, command: 'standalone run', why: asked.why ?? '--device takes one target: --for ios' };
    if (asked.targets[0] === 'android') return { ok: false, command: 'standalone run', why: '--device is for an iPhone or iPad in this version. For an Android phone, leave --device out: `standalone run <game> --for android` hands over to Capacitor, which lists the phones and emulators it finds over adb and asks which one. That has been run on an emulator, never on a real Android phone.' };
    if (asked.targets[0] !== 'ios') return { ok: false, command: 'standalone run', why: `--device puts the game on a phone: --for ios. A ${asked.targets[0]} build runs on a computer (leave --device out).` };
    return runOnPhone(root, id, opts);
  }
  const dir = standaloneDir(root, g.game.id);
  const host = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform] ?? 'linux';
  const t = targetsOf(said ?? host);
  if (t.why || t.targets.length !== 1) return { ok: false, command: 'standalone run', why: t.why ?? 'run one target at a time: --for ios, --for android, or none for this computer' };
  const target = t.targets[0];
  const build = `npx --no-install homie-studio standalone build ${g.game.id} --for ${target}`;
  if (DESKTOP.includes(target)) {
    if (target !== host) return { ok: false, command: 'standalone run', why: `a ${target} build runs on ${target === 'mac' ? 'a Mac' : target === 'windows' ? 'Windows' : 'Linux'}; this computer runs the ${host} one` };
    if (!existsSync(join(dir, 'electron', 'main.cjs')) || !existsSync(join(dir, 'node_modules', 'electron'))) return { ok: false, command: 'standalone run', why: `there is no desktop build of ${g.game.id} here yet`, instead: build };
    const meta = standaloneMeta(readStudio(root), g.game);
    // Steam's own file for a game started outside Steam, beside the dev app only: never in out/, which is what ships.
    if (meta.steam.app) writeFileSync(join(dir, 'steam_appid.txt'), `${meta.steam.app}\n`);
    const r = await exec(process.execPath, [join(dir, 'node_modules', ...BIN.electron), join(dir, 'electron')], { cwd: dir, env: toolEnv(env), timeout: 24 * 60 * 60_000, stdio: 'inherit' });
    return { ok: r.code === 0, command: 'standalone run', game: g.game.id, target, ...(r.code === 0 ? {} : { why: `the app ended with code ${r.code}` }) };
  }
  if (!existsSync(join(dir, target))) return { ok: false, command: 'standalone run', why: `there is no ${target} project of ${g.game.id} here yet`, instead: build };
  const s = { env, platform, exec, sdk: androidSdk({ env, platform, home }) };
  const r = await exec(process.execPath, [join(dir, 'node_modules', ...BIN.cap), 'run', target], { cwd: dir, env: await phoneEnv(s), timeout: 60 * 60_000, stdio: 'inherit' });
  return { ok: r.code === 0, command: 'standalone run', game: g.game.id, target, ...(r.code === 0 ? {} : { why: `cap run ${target} ended with code ${r.code}` }) };
}

/** `standalone steam <game>`: the build file steamcmd reads, from game.json's numbers; or what to make in Steamworks. */
export function standaloneSteam(root, id) {
  const g = gameOf(root, id);
  if (g.why) return { ok: false, command: 'standalone steam', why: g.why };
  const meta = standaloneMeta(readStudio(root), g.game);
  const dir = standaloneDir(root, g.game.id);
  const depots = DESKTOP.filter((os) => meta.steam.depots[os]);
  const launch = steamLaunch(meta);
  const setup = [
    `  Installation, General, launch options, one for each operating system: ${launch.windows} (Windows), ${launch.mac} (macOS), ${launch.linux} (Linux).`,
    '  For the Linux one, put --no-sandbox in its Arguments: inside Steam\'s Linux runtime the browser engine\'s own sandbox cannot start, and the app does not turn it off by itself.',
    '  Steam asks for macOS builds to be signed and notarized (--release with HOMIE_APPLE_IDENTITY and HOMIE_APPLE_NOTARY_PROFILE).',
  ];
  if (!meta.steam.app || !depots.length) {
    return {
      ok: false, command: 'standalone steam', game: g.game.id, needs: 'steam',
      why: `games/${g.game.id}/game.json has no Steam ${meta.steam.app ? 'depots' : 'app'} yet, so no build file was written.`,
      instead: [
        'In Steamworks (partner.steamgames.com), signed in as yourself, after Steam Direct\'s fee for the app:',
        '  Create the app: it gets an App ID.',
        '  SteamPipe, Depots: one depot for each of Windows, macOS and Linux (each gets a Depot ID), each set to its operating system.',
        ...setup,
        `Then add the numbers to games/${g.game.id}/game.json and run this again:`,
        '  "standalone": { "steam": { "app": <App ID>, "depots": { "windows": <Depot ID>, "mac": <Depot ID>, "linux": <Depot ID> } } }',
      ].join('\n'),
    };
  }
  const steam = join(dir, 'steam');
  mkdirSync(steam, { recursive: true });
  for (const old of DESKTOP) rmSync(join(steam, `depot_build_${old}.vdf`), { force: true });
  writeFileSync(join(steam, 'app_build.vdf'), steamAppBuild(meta));
  const unbuilt = depots.filter((os) => !existsSync(join(dir, 'out', os, 'release')));
  return {
    ok: true, command: 'standalone steam', game: g.game.id, app: meta.steam.app, depots: Object.fromEntries(depots.map((os) => [os, meta.steam.depots[os]])),
    dir: relative(root, steam), wrote: ['app_build.vdf'], unbuilt, launch, setup,
    upload: `steamcmd +login <your Steam account> +run_app_build "${join(steam, 'app_build.vdf')}" +quit`,
    note: 'Nothing was uploaded, and this file has never been run through steamcmd by the people who wrote the command that makes it: read what steamcmd prints. Run the command in your own terminal, signed in as yourself (Steam Guard asks you for a code). The build then appears in Steamworks, where you set it live on a branch.',
  };
}

/** `standalone ci <game>`: .github/workflows/standalone.yml, the one file of all this that is committed. */
export function standaloneCi(root, id) {
  const g = gameOf(root, id);
  if (g.why) return { ok: false, command: 'standalone ci', why: g.why };
  const meta = standaloneMeta(readStudio(root), g.game);
  const file = join(root, '.github', 'workflows', 'standalone.yml');
  const text = workflowYaml(meta);
  let before = null;
  try { before = readFileSync(file, 'utf8'); } catch { before = null; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return {
    ok: true, command: 'standalone ci', game: g.game.id, file: relative(root, file), changed: before !== text,
    next: [
      'Commit .github/workflows/standalone.yml and push it.',
      'On GitHub, in the repository\'s Settings, Secrets and variables, Actions, Variables: add HOMIE_SITE with the studio\'s live address (https://…). Without it the copies play offline only.',
      'Start it by hand: the repository\'s Actions tab, "Standalone builds", Run workflow. Each target\'s build is kept with the run as a .tgz.',
      'It signs nothing but an Android release (with the four HOMIE_ANDROID_* secrets), never makes a macOS or iOS release, and uploads to no store.',
      'This workflow has not been run by the people who wrote the command that makes it: read the first run\'s log.',
    ],
  };
}

/**
 * What a deploy means for the standalone copies already made (their built.json): when the game's revision
 * (game.json `netplay.version`) is no longer the one they were built on, they stop meeting players on the site.
 * One sentence for each revision the copies are on, for `deploy` and `deploy --plan`; none when nothing changed or
 * nothing was ever built.
 */
export function standaloneDeployNotes(root) {
  const notes = [];
  for (const game of listGames(root)) {
    const built = readBuilt(standaloneDir(root, game.id));
    if (!built) continue;
    const now = standaloneMeta({}, game).netplayVersion;
    const said = (v) => (v ? `"${v}"` : 'none');
    // The newest copy on each revision that is not the game's own now.
    const by = new Map();
    for (const kinds of Object.values(built.targets)) for (const e of Object.values(kinds ?? {})) {
      if (!e || (e.netplayVersion ?? null) === now) continue;
      const key = e.netplayVersion ?? '';
      if (!by.has(key) || String(e.at) > String(by.get(key).at)) by.set(key, e);
    }
    for (const e of by.values()) notes.push(`Standalone copies of ${game.name ?? game.id} (${e.version} build ${e.build}) were made on netplay version ${said(e.netplayVersion)}; this deploy makes ${said(now)} live. Copies already out keep playing offline and with each other, never with players on the new version, until you ship an update: homie-studio standalone build ${game.id}.`);
  }
  return notes;
}

/* ------------------------------------------------------------------ a real iPhone or iPad */

/** What `--device` changes outside this computer, said before it happens, in the result, in the tool and in the skill. */
export const DEVICE_ADDS = 'This adds the phone to your Apple team\'s list of development devices (a team may register a limited number a year, and a device stays on the list until the membership year renews) and lets Xcode make a development profile for this app. Apple signs the app for that phone only: it is a build to try, never one for the store.';

/** A devicectl command whose answer is a JSON file: { r, json } (json null when it wrote none). */
async function jsonOf(s, args, { timeout = 60_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'standalone-device-'));
  const file = join(dir, 'out.json');
  const r = await s.exec('xcrun', ['devicectl', ...args, '--json-output', file], { env: toolEnv(s.env), timeout });
  let json = null;
  try { json = JSON.parse(readFileSync(file, 'utf8')); } catch { json = null; }
  rmSync(dir, { recursive: true, force: true });
  return { r, json };
}

/**
 * The iPhones and iPads this Mac knows, as Xcode's own devicectl lists them: { ok, phones: [{ id, udid, model,
 * trusted, here, developerMode }] } or { ok: false, why }. `here`: plugged in or on the network now. An id never
 * leaves this module in a result or a line: a person is told a phone by its model.
 */
export async function phones({ exec = runTool, env = process.env } = {}) {
  const { r, json } = await jsonOf({ exec, env }, ['list', 'devices']);
  const list = json?.result?.devices;
  if (r.code !== 0 || !Array.isArray(list)) return { ok: false, why: r.code === 127 ? 'xcrun is not here (Xcode is not installed)' : `Xcode's device list did not answer (${tail(r, 2) || `code ${r.code}`})` };
  return {
    ok: true,
    phones: list.filter((d) => d?.hardwareProperties?.reality === 'physical' && ['iPhone', 'iPad'].includes(d?.hardwareProperties?.deviceType)).map((d) => ({
      id: String(d.identifier ?? ''), udid: String(d.hardwareProperties.udid ?? ''), model: String(d.hardwareProperties.marketingName ?? d.hardwareProperties.deviceType),
      trusted: d.connectionProperties?.pairingState === 'paired', here: ['connected', 'disconnected'].includes(d.connectionProperties?.tunnelState),
      developerMode: d.deviceProperties?.developerModeStatus === 'enabled' ? true : d.deviceProperties?.developerModeStatus === 'disabled' ? false : null,
    })),
  };
}

const TEAM_ID = /^[A-Z0-9]{10}$/;
/**
 * The Apple team a build to try is signed for: HOMIE_APPLE_TEAM, else the ONE team among the keychain's development
 * identities. An identity's name carries a person's id, not the team's: the team is in its certificate (the OU of
 * its subject), which is read here and nothing else of it is kept. { team, from } or { team: null, why, teams }.
 */
export async function appleTeam({ env = process.env, exec = runTool } = {}) {
  const said = String(env.HOMIE_APPLE_TEAM ?? '').trim();
  if (said) return TEAM_ID.test(said) ? { team: said, from: 'HOMIE_APPLE_TEAM' } : { team: null, teams: 0, why: 'HOMIE_APPLE_TEAM is set and is not a team id (ten capital letters and digits, on your Apple Developer account\'s Membership page)' };
  const ids = await exec('security', ['find-identity', '-v', '-p', 'codesigning'], { timeout: 10_000 });
  if (ids.code !== 0) return { team: null, teams: 0, why: 'could not check the keychain for a development identity (the security tool did not answer)' };
  const hashes = new Set(ids.stdout.split('\n').filter((l) => /"(Apple Development|iPhone Developer): /.test(l)).map((l) => /\b([0-9A-F]{40})\b/.exec(l)?.[1]).filter(Boolean));
  if (!hashes.size) return { team: null, teams: 0, why: 'the keychain has no Apple Development identity: sign in to your Apple account in Xcode (Settings, Accounts), which makes one' };
  const certs = await exec('security', ['find-certificate', '-a', '-p'], { timeout: 20_000 });
  const teams = new Set();
  for (const pem of certs.stdout.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []) {
    try {
      const c = new X509Certificate(pem);
      if (!hashes.has(c.fingerprint.replace(/:/g, ''))) continue;
      const ou = /^OU=([A-Z0-9]{10})$/m.exec(c.subject)?.[1];
      if (ou) teams.add(ou);
    } catch { /* not a certificate this reads */ }
  }
  if (teams.size === 1) return { team: [...teams][0], from: 'the one Apple team among the keychain\'s development identities' };
  return { team: null, teams: teams.size, why: teams.size ? `the keychain has development identities of ${teams.size} Apple teams, and which one is yours to say` : 'the team of the keychain\'s development identity could not be read' };
}

/**
 * What stopped xcodebuild, devicectl or the phone, in the words a person can act on: { stage, why, fix } or null
 * when the text is none of the things met so far (the caller then says the tool's own last lines).
 */
export function deviceTrouble(text) {
  const t = String(text ?? '');
  if (/Developer Mode disabled|enable Developer Mode|developer mode is (?:not enabled|disabled)/i.test(t)) return { stage: 'developer-mode', why: 'Developer Mode is off on the phone, so it takes no build to try', fix: 'On the phone: Settings, Privacy & Security, Developer Mode, turn it on. The phone restarts, then asks once more to turn it on: say yes, unlock it, and run this again. (The switch appears only after the phone has been plugged in to a Mac with Xcode.)' };
  if (/No Accounts?:|No Account for Team|Add a new account in Accounts settings|not signed in|requires? (?:a|an) (?:development team|Apple ID)/i.test(t)) return { stage: 'no-account', why: 'Xcode is not signed in to an Apple account of that team, so nothing can sign the app', fix: 'Open Xcode, Settings, Accounts, add your Apple account (a free one can put a game on your own phone for a week; a Developer membership for longer), then run this again.' };
  if (/has no devices from which to generate a provisioning profile|No profiles for '[^']*' were found/i.test(t)) return { stage: 'no-devices', why: 'your Apple team has no registered phone to make a development profile for, and Apple did not register this one', fix: 'Unlock the phone, keep it plugged in and run this again: it registers the phone. If it says the same, open the project once in Xcode (ios/App/App.xcodeproj in the standalone folder), pick the phone and press Run: Xcode registers it and says what stands in the way.' };
  if (/device (?:is|was) (?:passcode )?locked|is locked|Unlock .* to Continue|could not be unlocked|because the device was not, or could not be, unlocked/i.test(t)) return { stage: 'locked', why: 'the phone is locked', fix: 'Unlock the phone, keep it awake and run this again.' };
  if (/not paired|is not trusted|Trust This Computer|pairing/i.test(t)) return { stage: 'not-trusted', why: 'the phone does not trust this Mac yet', fix: 'Unlock the phone, plug it in and tap Trust when it asks about this computer (it asks for the passcode), then run this again.' };
  if (/Timed out waiting for all destinations|Unable to find a (?:destination|device) matching/i.test(t)) return { stage: 'not-ready', why: 'Xcode waited for the phone and it never became ready', fix: 'Unlock the phone, keep it plugged in and awake, and run this again. If Xcode has never seen this phone, open Xcode once with it plugged in (Window, Devices and Simulators) and let it finish preparing the phone.' };
  return null;
}

/**
 * `standalone run <game> --for ios --device`: the game built for the ONE iPhone or iPad that is plugged in, signed
 * for the person's own Apple team, installed over the cable and started, and then LOOKED FOR among the phone's
 * running programs: "started" is said only when it is there. Every way it can stop is an answer with what to do.
 * Nothing of the phone or the team is in the result but the phone's model and where the team's id was found.
 */
async function runOnPhone(root, id, opts = {}) {
  const say = opts.log ?? (() => {});
  const command = 'standalone run';
  const stop = (stage, why, extra = {}) => ({ ok: false, command, target: 'ios', device: true, stage, why, ...extra });
  if ((opts.platform ?? process.platform) !== 'darwin') return stop('not-a-mac', 'a game goes onto an iPhone from a Mac with Xcode');
  const s = await survey(root, id, { ...opts, for: 'ios', release: false });
  if (s.why) return stop('game', s.why);
  const g = gate('ios', s);
  if (g) return stop('xcode', g.why, { game: s.game.id, row: g.row?.id ?? null, fix: g.row?.fix?.say ?? null });
  const base = { game: s.game.id, name: s.meta.name, appId: s.meta.appId, appIdFrom: s.meta.appIdFrom, site: s.where.url || null, warnings: s.warnings, adds: DEVICE_ADDS };
  // The phone: exactly one, trusted, here, with Developer Mode on.
  const found = await phones(s);
  if (!found.ok) return stop('could-not-check', `could not look for a phone: ${found.why}`, base);
  const here = found.phones.filter((p) => p.here);
  if (!here.length) {
    const known = found.phones.length;
    return stop('no-phone', known ? `no iPhone or iPad is connected now (this Mac knows ${known}: ${found.phones.map((p) => p.model).join(', ')})` : 'no iPhone or iPad is connected to this Mac', { ...base, fix: 'Plug the phone in with a cable, unlock it, and tap Trust if it asks about this computer. Then run this again.' });
  }
  if (here.length > 1) return stop('several', `${here.length} phones are connected (${here.map((p) => p.model).join(', ')}), and this puts the game on one`, { ...base, phones: here.map((p) => ({ model: p.model })), fix: 'Unplug all but the one to try the game on (and turn Wi-Fi off on the others, or they stay connected over the network), then run this again.' });
  const phone = here[0];
  const device = { model: phone.model };
  if (!phone.trusted) return stop('not-trusted', `the ${phone.model} does not trust this Mac yet`, { ...base, phone: device, fix: deviceTrouble('not paired').fix });
  if (phone.developerMode === false) { const t = deviceTrouble('Developer Mode disabled'); return stop(t.stage, `Developer Mode is off on the ${phone.model}, so it takes no build to try`, { ...base, phone: device, fix: t.fix }); }
  // The team: said, or the keychain's only one. Where it came from is said; the id is not.
  const signer = await appleTeam(s);
  if (!signer.team) return stop('no-team', `no Apple team to sign for: ${signer.why}`, { ...base, phone: device, fix: `Put your team id in HOMIE_APPLE_TEAM (ten capital letters and digits, on your Apple Developer account's Membership page). ${ENV_HOW}` });
  say(`for the ${phone.model}, signed for ${signer.from === 'HOMIE_APPLE_TEAM' ? 'the team HOMIE_APPLE_TEAM names' : signer.from}`);
  say(DEVICE_ADDS);
  const on = { ...base, phone: device, team: { from: signer.from } };
  // The game, built as the site builds it, in the same project a simulator build uses.
  if (opts.buildSite !== false) {
    say(`building ${s.game.id} for the web (the same build the site serves)`);
    try { await (opts.buildSite ?? buildSite)(root, { only: s.game.id, log: say }); } catch (error) { return stop('build-failed', `the game did not build: ${String(error?.message ?? error)}`, on); }
  }
  const tools = await installTools(s, { say });
  if (!tools.ok) return stop('build-failed', tools.why, on);
  await writeIcons(s.dir, s.icon, { name: s.meta.name, colours: uiOf(s.game) });
  try { webBundle(root, s.game, s.dir, { meta: s.meta, target: 'ios', site: s.where.url }); } catch (error) { return stop('build-failed', String(error?.message ?? error).split('\n')[0], on); }
  const p = await iosProject(s, { say });
  if (!p.ok) return stop('build-failed', p.why, on);
  const derived = join(s.dir, 'ios', 'build-device');
  say('xcodebuild: a Debug build for the phone, signed by Xcode for your team (the first one registers the phone and makes its profile)');
  const b = await s.exec('xcodebuild', [...p.project, '-scheme', 'App', '-configuration', 'Debug', '-destination', `id=${phone.udid}`, '-derivedDataPath', derived, `MARKETING_VERSION=${s.meta.version}`, `CURRENT_PROJECT_VERSION=${s.meta.build}`, `DEVELOPMENT_TEAM=${signer.team}`, 'CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', 'build'], { cwd: s.dir, env: toolEnv(s.env), timeout: 40 * 60_000 });
  const app = join(derived, 'Build', 'Products', 'Debug-iphoneos', 'App.app');
  // What a tool printed may name the phone or the team: only its meaning, or its last lines with both taken out, is said.
  const hush = (text) => String(text).split(phone.udid).join('<the phone>').split(phone.id).join('<the phone>').split(signer.team).join('<your team>');
  if (b.code !== 0 || !existsSync(app)) {
    const t = deviceTrouble(`${b.stdout}\n${b.stderr}`);
    return t ? stop(t.stage, t.why, { ...on, fix: t.fix }) : stop('build-failed', `xcodebuild did not finish: ${hush(tail(b, 12))}`, on);
  }
  say(`installing it on the ${phone.model}`);
  const i = await jsonOf(s, ['device', 'install', 'app', '--device', phone.id, app], { timeout: 10 * 60_000 });
  if (i.r.code !== 0) {
    const t = deviceTrouble(`${i.r.stdout}\n${i.r.stderr}`);
    return t ? stop(t.stage, t.why, { ...on, built: true, fix: t.fix }) : stop('install-failed', `the app was built and the phone did not take it: ${hush(tail(i.r, 6))}`, { ...on, built: true });
  }
  // Where the phone put it, from the phone's own list of apps: every Capacitor app's program has the same name, so
  // a running one is told from another game's by where it is installed.
  const apps = await jsonOf(s, ['device', 'info', 'apps', '--device', phone.id], { timeout: 60_000 });
  const listed = (apps.json?.result?.apps ?? []).find((x) => x?.bundleIdentifier === s.meta.appId);
  if (apps.r.code === 0 && Array.isArray(apps.json?.result?.apps) && !listed) return stop('install-failed', 'the phone said it took the app, and the app is not in the phone\'s list of apps', { ...on, built: true });
  const where = String(listed?.url ?? i.json?.result?.installedApplications?.[0]?.installationURL ?? '');
  // A locked phone starts nothing. It is asked for now, and waited for a minute, rather than failing at the last step.
  const wait = opts.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const locked = async () => (await jsonOf(s, ['device', 'info', 'lockState', '--device', phone.id], { timeout: 30_000 })).json?.result?.passcodeRequired === true;
  if (await locked()) {
    say(`The ${phone.model} is locked: unlock it now (waiting up to a minute).`);
    for (let t = 0; t < (opts.unlockMs ?? 60_000); t += 3000) { await wait(3000); if (!(await locked())) break; }
  }
  say('starting it');
  const l = await jsonOf(s, ['device', 'process', 'launch', '--device', phone.id, '--terminate-existing', s.meta.appId], { timeout: 2 * 60_000 });
  if (l.r.code !== 0) {
    const t = deviceTrouble(`${l.r.stdout}\n${l.r.stderr}`);
    return stop(t?.stage === 'locked' ? 'locked' : 'not-started', t?.stage === 'locked' ? 'the game is on the phone, and the phone is locked, so it was not started' : `the game is on the phone and did not start: ${hush(tail(l.r, 6))}`, { ...on, built: true, installed: true, fix: `Unlock the phone and tap ${s.meta.name} on its home screen.` });
  }
  const pid = Number(l.json?.result?.process?.processIdentifier);
  // Read back: the game is among the phone's running programs a few seconds later, or it is not said to be running.
  await wait(4000);
  const ps = await jsonOf(s, ['device', 'info', 'processes', '--device', phone.id], { timeout: 60_000 });
  const list = ps.json?.result?.runningProcesses;
  if (ps.r.code !== 0 || !Array.isArray(list)) return stop('not-confirmed', 'the game was installed and asked to start, and the phone\'s running programs could not be read to see it', { ...on, built: true, installed: true, fix: `Look at the phone: ${s.meta.name} should be on its screen.` });
  const running = list.some((x) => (Number.isFinite(pid) && Number(x?.processIdentifier) === pid) || (where && String(x?.executable ?? '').startsWith(where)));
  if (!running) return stop('not-running', 'the game was installed and started, and four seconds later it was not among the phone\'s running programs: it closed, or crashed, as it opened', { ...on, built: true, installed: true, fix: `Tap ${s.meta.name} on the phone; if it closes again, open Xcode, Window, Devices and Simulators, the phone, and read its crash log.` });
  return {
    ok: true, command, target: 'ios', device: true, stage: 'started', ...on, built: true, installed: true, running: true,
    notes: [
      'a development build signed for this phone only: it stops opening when its profile ends (a week with a free Apple account, a year with a Developer membership), and it is not a build for the store',
      s.where.url ? `Quick play finds a room only when ${s.where.url} runs @homie-rocks/studio ${STANDALONE_SINCE} or later; a room made or joined by its code works with an older site too` : 'this copy has no address built in: it plays offline with its bots',
    ],
  };
}

export { MISSING, TARGETS };
