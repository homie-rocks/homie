import { legacyGame } from './legacy-game.mjs';
/**
 * @homie-rocks/studio 0.32.0: a game as an app of its own (standalone/STANDALONE.md).
 *
 *   - the text every build writes: the app's id, the wrapper project's pins, Capacitor's config (never server.url),
 *     Steam's build files, the GitHub workflow, the entitlements, and the desktop shell's own rules;
 *   - the web folder: the site's build of the game byte for byte, but for ONE script in its index.html;
 *   - the shell's page (standalone/shell/shell.js), run here against a stand-in page: the Lobby call says the copy's
 *     own revision, what it hands the helper, offline when the Lobby cannot be reached, the prefs it keeps (as the
 *     play page keeps them), a newer version said and never reloaded, a bad room code refused;
 *   - the Worker: the Lobby's answer is readable from the three app origins and from no other, never with
 *     credentials; an app's revision reaches the Lobby; everything that must come from the site's own pages still
 *     refuses an app;
 *   - the helper: in an app the lines about a newer version say "update the app" and a tap reloads nothing; a
 *     config with no socket is offline and still keeps its prefs with the page;
 *   - the command: a plan on a computer with nothing installed (every target said, none passed over), the release
 *     that will not guess an id, and what a deploy says to the copies already built.
 * No wrapper tool is installed or run here: the builds themselves are checked by hand on real machines.
 * Run: node --test packages/studio/test/standalone.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  APP_ID, CI_ACTIONS, MISSING, NET_SCRIPT, STANDALONE_PINS, TARGETS, appIdOf, capacitorConfig, configScript, electronApp, electronPackage, entitlementsPlist,
  cspBlocksInline, exportOptionsPlist, fileName, patchAndroidManifest, patchGradle, patchInfoPlist, projectPackage, standaloneBlock, standaloneMeta, steamAppBuild, steamLaunch, withNetScript, workflowYaml,
} from '../lib/standalone-files.mjs';
import { ANDROID_PLATFORM, DEVICE_ADDS, JDK_FITS, androidSigning, appleTeam, deviceTrouble, findJdk, installTools, phones, runTool, standaloneRun, standaloneBuild, standaloneCi, standaloneDeployNotes, standaloneDir, standalonePlan, standaloneRows, standaloneSteam, toolEnv, toolkitNote, webBundle } from '../lib/standalone.mjs';
import { SAY_MISSING, missingLines, standaloneCommand, standaloneLines } from '../lib/standalone-cli.mjs';
import { iconSource, letterTile } from '../lib/standalone-icons.mjs';
import { listGames, readStudio } from '../lib/studio.mjs';
import { playPage, sharePlaces } from '../worker/pages.mjs';
import { APP_ORIGINS, appCors, isAppOrigin } from '../worker/standalone.mjs';
import { LOBBY_APP_VERSIONS, LOBBY_ROOMS_MAX, Lobby } from '../worker/index.mjs';
import { createRequire } from 'node:module';
import { NetRoom } from '../worker/room.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-standalone-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const read = (...p) => readFileSync(join(PKG, ...p), 'utf8');

const studioJson = { name: 'Night Owls', slug: 'night-owls', cloudflare: { domain: null } };
const gem = { id: 'gem-rush', name: 'Gem Rush', netplay: { version: '7', movement: 'owner' } };

/* ------------------------------------------------------------------ the text */

test('the app\'s id: the studio\'s domain reversed, else rocks.homie.<studio>, then the game; game.json\'s own wins', () => {
  assert.equal(appIdOf(studioJson, gem), 'rocks.homie.nightowls.gemrush');
  assert.equal(appIdOf({ ...studioJson, cloudflare: { domain: 'play.nightowls.example' } }, gem), 'example.nightowls.play.gemrush');
  assert.equal(appIdOf({ ...studioJson, cloudflare: { domain: 'https://nightowls.example/' } }, gem), 'example.nightowls.gemrush');
  assert.equal(appIdOf(studioJson, { id: '2048-rush' }), 'rocks.homie.nightowls.g2048rush', 'a part never starts with a digit');
  for (const id of [appIdOf(studioJson, gem), appIdOf({}, {}), appIdOf({ slug: '9-lives' }, { id: 'a' })]) assert.match(id, APP_ID);
  const derived = standaloneMeta(studioJson, gem);
  assert.deepEqual([derived.appId, derived.appIdFrom, derived.version, derived.build, derived.orientation, derived.netplayVersion, derived.file], ['rocks.homie.nightowls.gemrush', 'derived', '1.0.0', 1, 'any', '7', 'Gem Rush']);
  // One name for a file, everywhere: nothing a file system refuses, no run of dashes, never empty.
  assert.deepEqual(['Gem: Rush / 2', 'A*?B.. ', '...', 'con<>fig|', ' Owl\\Run "II" '].map((n) => fileName(n)), ['Gem- Rush - 2', 'A-B', 'Game', 'con-fig', 'Owl-Run -II']);
  assert.equal(standaloneMeta(studioJson, { id: 'gem', name: 'Gem: Rush / 2' }).file, 'Gem- Rush - 2');
  assert.equal(fileName('x'.repeat(200)).length, 80);
  const own = standaloneMeta(studioJson, { ...gem, standalone: { appId: 'com.example.gemrush', version: '2.1.0', build: 12, orientation: 'landscape', steam: { app: 480, depots: { windows: 481, mac: 482 }, api: true } } }, { build: '40' });
  assert.deepEqual([own.appId, own.appIdFrom, own.version, own.build, own.orientation], ['com.example.gemrush', 'game.json', '2.1.0', 40, 'landscape']);
  assert.deepEqual(own.steam, { app: 480, depots: { mac: 482, windows: 481, linux: null }, api: true });
  // A value that cannot be used is said, and the safe one is used: never passed over.
  const bad = standaloneMeta(studioJson, { ...gem, standalone: { appId: 'com.example.gem-rush', version: 'one', build: 0, orientation: 'sideways' } });
  assert.equal(bad.appIdFrom, 'derived');
  assert.equal(bad.problems.length, 4);
  assert.match(standaloneBlock(derived), /^ {2}"standalone": \{\n {4}"appId": "rocks\.homie\.nightowls\.gemrush",/);
});

test('the wrapper project pins every tool exactly, and only the tools its targets need', () => {
  const meta = standaloneMeta(studioJson, gem);
  for (const group of Object.values(STANDALONE_PINS).filter((v) => typeof v === 'object')) for (const [name, v] of Object.entries(group)) assert.match(v, /^\d+\.\d+\.\d+$/, `${name} is an exact version`);
  const all = projectPackage(meta);
  assert.deepEqual(all.devDependencies, Object.fromEntries(Object.entries({ ...STANDALONE_PINS.desktop, ...STANDALONE_PINS.mobile }).sort(([a], [b]) => a.localeCompare(b))));
  assert.equal(all.private, true);
  assert.deepEqual(Object.keys(projectPackage(meta, { targets: ['windows'] }).devDependencies), Object.keys(STANDALONE_PINS.desktop).sort());
  assert.deepEqual(Object.keys(projectPackage(meta, { targets: ['android'] }).devDependencies), Object.keys(STANDALONE_PINS.mobile).sort());
  assert.equal('steamworks-ffi-node' in all.devDependencies, false, 'Steam\'s binding is never installed unless asked for');
  assert.deepEqual(electronPackage(meta, { steamApi: true }).dependencies, STANDALONE_PINS.steam);
  assert.equal(electronPackage(meta).dependencies, undefined);
  // @homie-rocks/studio itself gains no dependency: the tools live in the studio's own .studio/ folder.
  const pkg = JSON.parse(read('package.json'));
  for (const name of Object.keys({ ...STANDALONE_PINS.desktop, ...STANDALONE_PINS.mobile, ...STANDALONE_PINS.steam })) assert.equal(name in pkg.dependencies, false, `${name} is not a dependency of the toolkit`);
  assert.ok(pkg.files.includes('standalone/'), 'the shells ship in the package');
});

test('Capacitor bundles the web folder and never loads its page from a site; the native files are patched as text', () => {
  const meta = standaloneMeta(studioJson, { ...gem, standalone: { appId: 'com.example.gemrush', version: '1.4.0', build: 9, orientation: 'landscape' } });
  const cfg = capacitorConfig(meta);
  assert.deepEqual(cfg, { appId: 'com.example.gemrush', appName: 'Gem Rush', webDir: 'web', server: { androidScheme: 'https' } });
  assert.equal('url' in cfg.server, false, 'never server.url');
  const plist = '<dict>\n\t<key>UISupportedInterfaceOrientations</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t</array>\n\t<key>UISupportedInterfaceOrientations~ipad</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t</array>\n</dict>';
  const land = patchInfoPlist(plist, 'landscape');
  assert.doesNotMatch(land, /OrientationPortrait/);
  assert.equal(land.match(/UIInterfaceOrientationLandscapeLeft/g).length, 2, 'the phone\'s list and the iPad\'s');
  assert.match(patchInfoPlist(plist, 'portrait'), /UIInterfaceOrientationPortrait<\/string>\n\t<\/array>\n\t<key>UISupportedInterfaceOrientations~ipad/);
  const manifest = '<manifest><application><activity android:name=".MainActivity" android:exported="true"></activity></application></manifest>';
  assert.match(patchAndroidManifest(manifest, 'landscape'), /<activity android:screenOrientation="sensorLandscape" android:name/);
  assert.equal(patchAndroidManifest(patchAndroidManifest(manifest, 'portrait'), 'any'), manifest, 'free again, with nothing left behind');
  assert.equal(patchGradle('defaultConfig {\n  versionCode 1\n  versionName "1.0"\n}', meta), 'defaultConfig {\n  versionCode 9\n  versionName "1.4.0"\n}');
  assert.match(exportOptionsPlist('AB12CD34EF"><x'), /<string>AB12CD34EFx<\/string>/, 'a team id is letters and digits only');
  assert.match(exportOptionsPlist('T'), /<key>destination<\/key>\s*<string>export<\/string>/, 'to disk, never uploaded');
});

test('Steam\'s build file: one app, each depot inside it, each the release build of its operating system', () => {
  const meta = standaloneMeta(studioJson, { ...gem, standalone: { steam: { app: 480, depots: { windows: 481, linux: 483 } } } });
  const app = steamAppBuild(meta);
  assert.match(app, /^"AppBuild"\n\{\n\t"AppID" "480"\n\t"Desc" "Gem Rush 1\.0\.0 build 1"\n\t"ContentRoot" "\.\.\/out\/"\n/, 'the one root, relative to the script as Steam documents it');
  assert.match(app, /"481"\n\t\t\{\n\t\t\t"FileMapping"\n\t\t\t\{\n\t\t\t\t"LocalPath" "windows\/release\/\*"\n\t\t\t\t"DepotPath" "\."\n\t\t\t\t"recursive" "1"/);
  assert.match(app, /"483"[\s\S]*"LocalPath" "linux\/release\/\*"/);
  assert.doesNotMatch(app, /mac\/|depot_build_/, 'no depot without a number, and no depot script of its own');
  assert.deepEqual(steamLaunch(standaloneMeta(studioJson, { id: 'gem', name: 'Gem: Rush / 2' })), { windows: 'gem.exe', mac: 'Gem- Rush - 2.app', linux: 'gem' }, 'the launch options name the files the build makes');
});

test('the workflow: started by hand only, every action pinned by its commit, all five targets, a secret only in the one step that needs it', () => {
  const yml = workflowYaml(standaloneMeta(studioJson, gem));
  assert.match(yml, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(yml, /^ {2}(push|pull_request|schedule):/m, 'never by a push');
  const uses = [...yml.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length >= 9);
  for (const u of uses) assert.match(u, /^actions\/[a-z-]+@[0-9a-f]{40}$/, `${u} is pinned by commit`);
  assert.deepEqual([...new Set(uses)].sort(), Object.values(CI_ACTIONS).map((a) => a.split(' ')[0]).sort());
  for (const [runner, targets] of [['windows-latest', 'windows'], ['ubuntu-latest', 'linux, android'], ['macos-latest', 'mac, ios']]) assert.match(yml, new RegExp(`runs-on: ${runner}\\n {4}strategy:\\n {6}fail-fast: false\\n {6}matrix:\\n {8}target: \\[${targets}\\]`));
  assert.match(yml, /npx --no-install homie-studio standalone build "\$GAME" --for "\$TARGET" --build "\$GITHUB_RUN_NUMBER" \$RELEASE/);
  assert.match(yml, /HOMIE_STANDALONE_SITE: \$\{\{ vars\.HOMIE_SITE \}\}/);
  assert.match(yml, /java-version: 21/);
  assert.match(yml, /permissions:\n {2}contents: read/);
  // A studio with no lockfile still installs; nothing asks setup-node for a cache that needs one.
  assert.doesNotMatch(yml, /cache: npm/);
  assert.equal(yml.split('if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi').length, 4, 'in each of the three jobs');
  // A secret is named in the env: block of the Android step and nowhere else: the Linux desktop build never sees one.
  const steps = yml.split(/\n {6}- /);
  const withSecrets = steps.filter((st) => /secrets\./.test(st));
  assert.equal(withSecrets.length, 1);
  assert.match(withSecrets[0], /^name: Build \(Android[^\n]*\n {8}if: contains\(inputs\.targets, matrix\.target\) && matrix\.target == 'android'/);
  for (const line of yml.split('\n').filter((l) => /\$\{\{\s*secrets\./.test(l))) assert.match(line, /^ {10}HOMIE_ANDROID_[A-Z0-9_]+: \$\{\{ secrets\.HOMIE_ANDROID_[A-Z0-9_]+ \}\}$/);
  // An input never reaches the shell as text: every script reads the environment only.
  for (const st of steps.filter((x) => /\n {8}run: \|/.test(x))) assert.doesNotMatch(st.split('run: |')[1], /\$\{\{/);
  // The macOS and iOS job never makes a release, whatever the box says: it has no Apple certificate, and says so.
  const macos = yml.split('\n  macos:')[1];
  assert.match(macos, /RELEASE: \$\{\{ '' \}\}/);
  assert.doesNotMatch(macos, /inputs\.release/);
  assert.match(yml, /The macOS and iOS jobs never make a\n# release/);
  assert.match(yml, /has not been run by the people who wrote the command/);
});

test('the desktop shell: its own secure scheme, the page with no Node, no tools in a shipped copy, and Steam only when Steam started it', () => {
  const main = read('standalone', 'electron', 'main.cjs');
  assert.match(main, /registerSchemesAsPrivileged\(\[\{ scheme: 'app', privileges: \{ standard: true, secure: true, supportFetchAPI: true, stream: true \} \}\]\)/);
  assert.match(main, /webPreferences: \{ contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, devTools: !app\.isPackaged \}/);
  assert.doesNotMatch(main, /nodeIntegration: true|contextIsolation: false|sandbox: false|webSecurity|preload:|webviewTag|allowRunningInsecureContent/);
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{ if \(\/\^https:\\\/\\\/\/i\.test\(url\)\) shell\.openExternal\(url\); return \{ action: 'deny' \}; \}\)/);
  assert.match(main, /new Set\(\['pointerLock', 'fullscreen', 'clipboard-sanitized-write'\]\)/);
  assert.match(main, /requestSingleInstanceLock/);
  // Its own storage and lock, by the app's id; and nothing a page does raises Electron's own error dialog.
  assert.match(main, /app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), cfg\.appId\)\)/);
  assert.match(main, /process\.on\('uncaughtException'/);
  assert.match(main, /stream\.on\('error', \(\) => \{\}\)/);
  // Steam's switch only when Steam started the game, and the sandbox is never turned off from in here.
  assert.match(main, /const underSteam = Boolean\(process\.env\.SteamAppId \|\| process\.env\.SteamGameId/);
  assert.match(main, /if \(underSteam\) app\.commandLine\.appendSwitch\('in-process-gpu'\)/);
  assert.doesNotMatch(main, /appendSwitch\([^)]*no-sandbox|appendSwitch\([^)]*no-zygote/);
  assert.match(main, /const started = s\.init\(\{ appId: cfg\.steam\.app \}\);\n\s+if \(started\)/, 'what the binding answers is what is said');
  // macOS has a menu of its own: no Reload, no developer tools, no Help.
  assert.match(main, /Menu\.setApplicationMenu\(menu\(\)\)/);
  assert.doesNotMatch(main, /role: '(reload|forceReload|toggleDevTools|help)'/);
  assert.match(main, /role: 'paste'/);
  // Nothing in it is about one game: it reads app.json.
  assert.doesNotMatch(main, /gem|Gem Rush/);
  const pack = read('standalone', 'electron', 'pack.mjs');
  assert.match(pack, /asar: false/);
  assert.match(pack, /hardenedRuntime: true, \.\.\.\(\(app\.steam \|\| adhoc\) && existsSync\(entitlements\) \? \{ entitlements \} : \{\}\)/, 'the signer\'s own entitlements unless Steam starts the game');
  assert.match(pack, /osxNotarize: \{ keychainProfile: profile \}/);
  assert.match(pack, /notarized: notarize && checks\.stapled === true/, 'notarized is what stapler confirms, never "the packager did not throw"');
  assert.match(pack, /signed: sign && checks\.signature === true/);
  // The file that replaces the signer's defaults carries what Electron itself needs first: the JIT.
  const ent = entitlementsPlist();
  for (const k of ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory', 'com.apple.security.cs.disable-library-validation', 'com.apple.security.cs.allow-dyld-environment-variables']) assert.match(ent, new RegExp(`<key>${k.replace(/\./g, '\\.')}</key>\\s*<true/>`));
  assert.doesNotMatch(ent, /app-sandbox/);
  const meta = standaloneMeta(studioJson, { ...gem, standalone: { steam: { app: 480 } } });
  assert.deepEqual(electronApp(meta).steam, { app: 480, api: false });
  assert.equal(electronApp(standaloneMeta(studioJson, gem)).steam, undefined);
  assert.match(letterTile('gem <rush>'), />G<\/text>/);
});

test('which file a request names, and which bytes of it: the shell\'s own rules, run with hostile addresses', () => {
  const { fileFor, rangeOf, mayNavigate } = createRequire(import.meta.url)(join(PKG, 'standalone', 'electron', 'files.cjs'));
  const web = join(scratch, 'served', 'web');
  mkdirSync(join(web, 'game', 'assets'), { recursive: true });
  writeFileSync(join(web, 'index.html'), 'shell');
  writeFileSync(join(web, 'game', 'index.html'), 'game');
  writeFileSync(join(web, 'game', 'assets', 'a b.js'), 'js');
  writeFileSync(join(scratch, 'served', 'secret.txt'), 'secret');
  writeFileSync(join(scratch, 'served', 'web-secret.txt'), 'secret');
  symlinkSync(join(scratch, 'served', 'secret.txt'), join(web, 'link.txt'));
  assert.equal(fileFor(web, 'app://game/index.html'), join(web, 'index.html'));
  assert.equal(fileFor(web, 'app://game/'), join(web, 'index.html'));
  assert.equal(fileFor(web, 'app://game/game/'), join(web, 'game', 'index.html'));
  assert.equal(fileFor(web, 'app://game/game/index.html?start=3#x'), join(web, 'game', 'index.html'));
  assert.equal(fileFor(web, 'app://game/game/assets/a%20b.js'), join(web, 'game', 'assets', 'a b.js'));
  for (const hostile of [
    'app://game/../secret.txt', 'app://game/..%2Fsecret.txt', 'app://game/%2e%2e/secret.txt', 'app://game/game/../../secret.txt', 'app://game/..%5Csecret.txt', 'app://game/%2e%2e%2f%2e%2e%2fsecret.txt',
    'app://game/../web-secret.txt', 'app://game//etc/passwd', 'app://game/%00', 'app://game/%E0%A4%A', 'app://game/link.txt', 'app://game/nope.js',
    'app://other/index.html', 'app://game.evil/index.html', 'file:///etc/passwd', 'https://game/index.html', 'not an address', '',
  ]) assert.equal(fileFor(web, hostile), null, hostile);
  // The bytes a Range header asks for, inside the file or not at all.
  assert.deepEqual(rangeOf('bytes=0-', 10), { start: 0, end: 9 });
  assert.deepEqual(rangeOf('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(rangeOf('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(rangeOf('bytes=-30', 10), { start: 0, end: 9 });
  assert.deepEqual(rangeOf('bytes=5-99999999', 10), { start: 5, end: 9 });
  for (const whole of [null, undefined, '', 'bytes=-', 'items=0-1', 'bytes=0-1,3-4', 'bytes=a-b', 'bytes=1e3-', `bytes=${'9'.repeat(40)}-`]) assert.equal(rangeOf(whole, 10), 'whole', String(whole));
  for (const none of ['bytes=10-', 'bytes=11-12', 'bytes=5-2', 'bytes=-0']) assert.equal(rangeOf(none, 10), 'none', none);
  assert.equal(rangeOf('bytes=0-', 0), 'none');
  // Where a frame may go: the app's own files; a frame inside the game may also be a blob or a srcdoc of its own.
  assert.equal(mayNavigate('app://game/index.html'), true);
  for (const out of ['https://evil.example/', 'app://game.evil/', 'file:///etc/passwd', 'about:blank', 'blob:app://game/1', 'javascript:alert(1)']) assert.equal(mayNavigate(out, { main: true }), false, out);
  for (const own of ['about:srcdoc', 'about:blank', 'blob:app://game/1', 'app://game/game/x.html']) assert.equal(mayNavigate(own, { main: false }), true, own);
  for (const out of ['https://evil.example/', 'blob:https://evil.example/1', 'data:text/html,x']) assert.equal(mayNavigate(out, { main: false }), false, out);
});

test('what a standalone copy does not have is one list, said in the same words everywhere', () => {
  assert.ok(MISSING.length >= 8);
  const text = missingLines(MISSING).join('\n');
  assert.match(text, /^What the standalone game does not have \(v1\):/);
  for (const what of ['Player accounts and sign-in', 'Cloud saves', 'The shop', 'Room chat', 'Automatic updates', 'Uploading to a store, and a store\'s yes']) assert.match(text, new RegExp(`- ${what}: `));
  assert.match(text, /Cloud saves: [^\n]*LOST when the app is uninstalled/);
  assert.match(text, /Steam's overlay, achievements and friends: none of it has been run/);
  assert.match(text, /its review, its fees and its rules are the store's, and nothing here makes an app pass/);
  const guide = read('standalone', 'STANDALONE.md');
  assert.match(guide, /## What the standalone game does not have \(v1\)/);
  for (const word of ['Player accounts and sign-in', 'Cloud saves', 'The shop', 'Room chat', 'Automatic updates']) assert.match(guide, new RegExp(`\\*\\*${word}\\.\\*\\*`));
});

/* ------------------------------------------------------------------ a studio to build in */

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  legacyGame(dir, 'gem', 'Gem Rush');
  return dir;
}
let made = null;
function built() {
  if (!made) {
    made = studio('built');
    const b = run(['build'], made);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
  }
  return made;
}
const files = (dir) => { const out = []; const walk = (at) => { for (const e of readdirSync(at, { withFileTypes: true })) { const p = join(at, e.name); if (e.isDirectory()) walk(p); else out.push(relative(dir, p)); } }; walk(dir); return out.sort(); };

test('the web folder is the site\'s build of the game, byte for byte, but for one script in its index.html', () => {
  const root = built();
  const game = listGames(root).find((g) => g.id === 'gem');
  const dir = standaloneDir(root, 'gem');
  const meta = standaloneMeta(readStudio(root), game);
  const r = webBundle(root, game, dir, { meta, target: 'mac', site: 'https://owls.example/' });
  const site = join(root, 'site', 'dist', 'games', 'gem');
  const copy = join(dir, 'web', 'game');
  assert.deepEqual(files(copy), files(site), 'the same files, no more and no fewer');
  assert.equal(r.files, files(site).length);
  for (const f of files(site).filter((x) => x !== 'index.html')) assert.ok(readFileSync(join(copy, f)).equals(readFileSync(join(site, f))), `${f} is the site's, byte for byte`);
  const before = readFileSync(join(site, 'index.html'), 'utf8');
  const after = readFileSync(join(copy, 'index.html'), 'utf8');
  assert.equal(after.replace(NET_SCRIPT, ''), before, 'index.html differs by the one script and nothing else');
  assert.equal(after.split('<script>try{var n=parent!==window&&parent.__HOMIE_APP_NET').length, 2, 'exactly one');
  assert.match(after, /<head[^>]*><script>try\{var n=parent!==window&&parent\.__HOMIE_APP_NET;if\(n\)window\.HOMIE_NET=JSON\.parse\(JSON\.stringify\(n\)\)\}catch\(e\)\{\}<\/script>/, 'first in the head, before the game\'s modules');
  assert.equal(withNetScript('<p>no head</p>'), `${NET_SCRIPT}<p>no head</p>`);
  // The shell beside it: the three files as they ship, and config.js.
  for (const f of ['index.html', 'shell.js', 'shell.css']) assert.equal(readFileSync(join(dir, 'web', f), 'utf8'), read('standalone', 'shell', f));
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(join(dir, 'web', 'config.js'), 'utf8'), ctx);
  const app = JSON.parse(JSON.stringify(ctx.window.__HOMIE_APP));
  assert.deepEqual(app, { v: 1, game: 'gem', name: 'Gem Rush', site: 'https://owls.example', ver: '', movement: 'owner', params: {}, share: sharePlaces(undefined), colours: null, version: '1.0.0', target: 'mac' });
  // Everything it made is under .studio/, which every studio's .gitignore leaves out.
  assert.match(readFileSync(join(root, '.gitignore'), 'utf8'), /^\.studio\/$/m);
  assert.ok(relative(root, dir).startsWith(join('.studio', 'standalone')));
  // A game that was never built is said, not papered over.
  assert.throws(() => webBundle(root, { ...game, id: 'nope' }, join(scratch, 'x'), { meta }), /has no build of the game/);
  assert.equal(configScript(meta, { target: 'ios', site: '', share: null }).includes('</'), false);
});

/* ------------------------------------------------------------------ the shell's page */

const SHELL = read('standalone', 'shell', 'shell.js');
/** shell.js against a stand-in page. `lobby`: the room the Lobby answers with, or null for a Lobby that cannot be reached. */
async function shell({ app = {}, lobby = 'pub-3', storage = {}, width = 1280, height = 800, lobbyMs = 0 } = {}) {
  const els = new Map();
  const posted = [];
  const srcs = [];
  const heard = {};
  const el = (sel) => {
    if (!els.has(sel)) {
      const node = {
        sel, textContent: '', hidden: /sheet|toast|notice\]$/.test(sel), attrs: {}, listeners: {}, className: '', value: '', title: '', onclick: null,
        style: { props: {}, setProperty(k, v) { this.props[k] = String(v); } },
        classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
        setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
        addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }, querySelector: (s) => el(s), contains: () => false, focus() {},
        getBoundingClientRect: () => (sel === '[data-share-toggle]' ? { left: 1100, top: 8, width: 120, height: 34 } : { left: 0, top: 0, width: 0, height: 0 }),
        // The frame's window is one object through every load; its address is the page that is in it now.
        contentWindow: { focus() {}, postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))), location: { get search() { const u = srcs.at(-1) ?? ''; return page.old ? page.old : u.includes('?') ? u.slice(u.indexOf('?')) : ''; } } },
      };
      if (sel === 'iframe.game') Object.defineProperty(node, 'src', { get: () => srcs.at(-1) ?? '', set: (v) => srcs.push(v) });
      els.set(sel, node);
    }
    return els.get(sel);
  };
  const fetched = [];
  /** `page.old`: the frame still shows the page of an earlier start (a navigation not committed yet). */
  const page = { old: null };
  const store = (seed) => { const m = new Map(Object.entries(seed)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; };
  const ctx = {
    document: { querySelector: el, documentElement: el(':root'), title: '', addEventListener() {} },
    localStorage: store(storage), sessionStorage: store({}), navigator: {}, crypto: webcrypto, btoa,
    fetch: async (u, o) => { fetched.push([u, o?.method]); if (lobbyMs) await new Promise((r) => setTimeout(r, lobbyMs)); if (lobby === null) throw new TypeError('Failed to fetch'); return { json: async () => (typeof lobby === 'string' ? { room: lobby } : lobby) }; },
    setTimeout, clearTimeout, innerWidth: width, innerHeight: height, Uint8Array, Date, JSON, Math, Object, String, Number, Boolean, Promise, RegExp, encodeURIComponent, isFinite,
    addEventListener(type, fn) { (heard[type] ??= []).push(fn); },
    __HOMIE_APP: { v: 1, game: 'gem', name: 'Gem Rush', site: 'https://owls.example', ver: '7', movement: 'owner', params: {}, share: sharePlaces('top-left'), colours: { paper: '#101820', text: '#f2e9d8', hot: '#ffcf5a' }, version: '1.0.0', target: 'mac', ...app },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SHELL, ctx);
  await new Promise((r) => setTimeout(r, 10));
  const fromGame = (m) => { for (const fn of heard.message ?? []) fn({ source: el('iframe.game').contentWindow, data: { t: 'homie-net', ...m } }); };
  const net = () => JSON.parse(JSON.stringify(ctx.__HOMIE_APP_NET));
  const settle = () => new Promise((r) => setTimeout(r, 10));
  return { ctx, el, fetched, posted, srcs, heard, fromGame, net, settle, page, state: ctx.__shell };
}

test('the shell asks the Lobby for a room of its own revision, and hands the helper what the play page would', async () => {
  const s = await shell();
  assert.deepEqual(s.fetched, [['https://owls.example/gem/api/lobby?gv=7', 'POST']], 'one simple POST, with the copy\'s own revision');
  assert.deepEqual(s.srcs, ['game/index.html']);
  const net = s.net();
  assert.match(net.url, /^wss:\/\/owls\.example\/gem\/__net\?room=pub-3&b=[A-Za-z0-9_-]{16,43}&gv=7$/);
  const { url, ...rest } = net;
  assert.deepEqual(rest, { v: 1, params: {}, prefs: true, device: 'desk', want: 'play', debug: false, chatOff: true, bubbleOff: true, app: true, room: 'pub-3', ver: '7', movement: 'owner' });
  for (const never of ['saves', 'shop', 't', 'name', 'token', 'agent', 'watch']) assert.equal(never in net, false, `never ${never}`);
  assert.match(s.ctx.localStorage.getItem('homie-b'), /^[A-Za-z0-9_-]{16,43}$/, 'the same room key as the play page keeps');
  assert.equal(s.el('[data-room-code]').textContent, 'Room 3');
  assert.equal(s.el('[data-room-link]').textContent, 'owls.example/gem/play?room=pub-3');
  assert.equal(s.el('[data-room-ui]').className, 'room at-top-left', 'the button sits where the game\'s screen.share puts it');
  assert.equal(s.el(':root').style.props['--text'], '#f2e9d8');
  assert.equal(s.ctx.document.title, 'Gem Rush');
  // Invite is the room's address on the studio's site, so a friend in a browser joins the same room.
  const shared = [];
  s.ctx.navigator.share = async (d) => { shared.push(JSON.parse(JSON.stringify(d))); };
  s.el('[data-invite]').listeners.click[0]();
  assert.deepEqual(shared, [{ title: 'Gem Rush', text: 'Play Gem Rush with me: join my room.', url: 'https://owls.example/gem/play?room=pub-3' }]);
  // The seat's token is kept in the app's own storage, under its room: closing the app does not lose the seat.
  s.fromGame({ what: 'token', token: 'TOK', seat: 2, room: 'pub-3' });
  assert.equal(s.ctx.localStorage.getItem('homie-net.gem.pub-3.play'), 'TOK');
  assert.equal(s.ctx.sessionStorage.map.size, 0, 'nothing is kept for the visit only');
  const back = await shell({ storage: { 'homie-net.gem.pub-3.play': 'TOK' } });
  assert.equal(back.net().token, 'TOK', 'the app, opened again, comes back to its seat');
  // A token that names another room (a page on its way out) is never kept under this one.
  s.fromGame({ what: 'token', token: 'OTHER', seat: 1, room: 'pub-9' });
  s.fromGame({ what: 'token', token: 'NONE', seat: 1 });
  assert.equal(s.ctx.localStorage.getItem('homie-net.gem.pub-3.play'), 'TOK');
  assert.equal(s.ctx.localStorage.getItem('homie-net.gem.pub-9.play'), null);
  // The helper is told where the page's own button sits over the game.
  s.fromGame({ what: 'attached' });
  const rects = s.posted.filter((m) => m.t === 'homie-shell').at(-1);
  assert.deepEqual(rects.rects, [{ id: 'room', x: 1100, y: 8, w: 120, h: 34 }]);
  // A local dev server (http) is a ws socket; a phone is a phone.
  const dev = await shell({ app: { site: 'http://127.0.0.1:8787', ver: '' }, width: 390, height: 844 });
  assert.deepEqual(dev.fetched, [['http://127.0.0.1:8787/gem/api/lobby', 'POST']]);
  assert.match(dev.net().url, /^ws:\/\/127\.0\.0\.1:8787\/gem\/__net\?room=pub-3&b=[A-Za-z0-9_-]+$/);
  assert.equal(dev.net().device, 'phone');
  assert.equal('ver' in dev.net(), false);
});

test('a Lobby that cannot be reached, or answers with nothing usable, is offline: the game plays, and the page says so', async () => {
  for (const lobby of [null, { ok: false, error: 'not-found' }, { room: 'no good!' }, { room: 'x'.repeat(33) }]) {
    const s = await shell({ lobby });
    assert.equal(s.net().url, '', 'no socket: the helper plays offline with its bots');
    assert.equal('room' in s.net(), false);
    assert.equal(s.net().prefs, true);
    assert.deepEqual(s.srcs, ['game/index.html'], 'the game still starts');
    assert.equal(s.el('[data-room-code]').textContent, 'Playing offline · Try again');
    assert.equal(s.el('[data-invite]').hidden, true);
  }
  // A copy built with no address never asks anything.
  const none = await shell({ app: { site: '' } });
  assert.deepEqual(none.fetched, []);
  assert.equal(none.net().url, '');
  assert.equal(none.el('[data-room-state]').textContent, 'This copy has no online address');
  // A Lobby that is slow to answer never leaves a blank screen: the game starts offline after a second and a half,
  // and the room that arrives late is offered, never switched to under the player.
  const slow = await shell({ lobbyMs: 1900 });
  assert.deepEqual(slow.srcs, [], 'still asking');
  await new Promise((r) => setTimeout(r, 1600));
  assert.deepEqual(slow.srcs, ['game/index.html'], 'the game is on the screen');
  assert.equal(slow.net().url, '');
  slow.el('[data-quick]').listeners.click[0]();
  slow.state.quick(); slow.state.go();
  assert.equal(slow.fetched.length, 1, 'a second press while one search is out asks nothing again');
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(slow.el('[data-toast]').textContent, 'Back online · Join');
  assert.deepEqual(slow.srcs, ['game/index.html'], 'nothing was switched under the player');
  slow.el('[data-toast]').onclick();
  assert.equal(slow.net().room, 'pub-3');
  // "Try again" while playing offline: the round goes on while the Lobby is asked.
  const retry = await shell({ lobby: null });
  retry.el('[data-quick]').listeners.click[0]();
  await retry.settle();
  assert.deepEqual(retry.srcs, ['game/index.html'], 'the offline round was not restarted for a Lobby that did not answer');
  assert.equal(retry.el('[data-toast]').textContent, 'No room answered: still playing offline.');
  // The connection comes back: it is offered, never done for the player in the middle of a round.
  const s = await shell({ lobby: null });
  s.heard.online[0]();
  assert.equal(s.el('[data-toast]').textContent, 'Back online · Join');
  assert.deepEqual(s.srcs, ['game/index.html'], 'nothing reloaded by itself');
  // In a room that never answered (the helper says `alone`), the same words.
  const a = await shell();
  a.fromGame({ what: 'link', state: 'alone', why: 'relay-timeout' });
  assert.equal(a.el('[data-room-code]').textContent, 'Playing offline · Try again');
  a.fromGame({ what: 'link', state: 'reconnecting', why: 'lost' });
  assert.equal(a.el('[data-room-code]').textContent, 'Reconnecting…');
  a.fromGame({ what: 'link', state: 'online', why: 'welcome' });
  assert.equal(a.el('[data-room-code]').textContent, 'Room 3');
});

test('the shell keeps net.prefs exactly as the play page does: the same key, limits and refusals', async () => {
  // The play page's own three functions and this page's, as written: the same code.
  const page = await playPage({ studio: { name: 'Night Owls' }, games: [] }, { id: 'gem', name: 'Gem Rush', players: { max: 8 } }).text();
  const body = (src, name) => { const at = src.indexOf(`function ${name}(`); assert.ok(at > 0, name); return src.slice(at, src.indexOf('\n  }\n', at)).split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.trim()).join('\n'); };
  for (const fn of ['prefsRead', 'prefsWrite', 'answerPrefs']) assert.equal(body(SHELL, fn), body(page, fn), `${fn} is the play page's`);
  assert.match(SHELL, /var PREFS_KEY = 'homie-prefs\.' \+ game;/);
  assert.match(SHELL, /var PREFS = \{ bytes: 16384, keys: 32, key: 64 \};/);
  // And as it behaves.
  const s = await shell({ storage: { 'homie-prefs.gem': JSON.stringify({ quality: 'low' }) } });
  const ask = (m) => { s.fromGame({ what: 'prefs', ...m }); return s.posted.filter((x) => x.t === 'homie-prefs').at(-1); };
  assert.deepEqual(ask({ n: 1, op: 'all' }), { t: 'homie-prefs', n: 1, ok: true, all: { quality: 'low' } });
  assert.deepEqual(ask({ n: 2, op: 'set', k: 'volume', v: 0.4 }), { t: 'homie-prefs', n: 2, ok: true, kept: 'kept' });
  assert.deepEqual(JSON.parse(s.ctx.localStorage.getItem('homie-prefs.gem')), { quality: 'low', volume: 0.4 });
  assert.deepEqual(ask({ n: 3, op: 'set', k: 'volume', v: NaN }), { t: 'homie-prefs', n: 3, ok: false, why: 'value' });
  assert.deepEqual(ask({ n: 4, op: 'set', k: 'x'.repeat(65), v: 1 }), { t: 'homie-prefs', n: 4, ok: false, why: 'key' });
  assert.deepEqual(ask({ n: 5, op: 'set', k: '__proto__', v: 1 }), { t: 'homie-prefs', n: 5, ok: false, why: 'key' });
  assert.deepEqual(ask({ n: 6, op: 'set', k: 'big', v: 'x'.repeat(17000) }), { t: 'homie-prefs', n: 6, ok: false, why: 'too-large' });
  assert.deepEqual(ask({ n: 7, op: 'del', k: 'quality' }), { t: 'homie-prefs', n: 7, ok: true, kept: 'kept' });
  assert.deepEqual(ask({ n: 8, op: 'drop' }), { t: 'homie-prefs', n: 8, ok: false, why: 'key' });
  assert.deepEqual(ask({ n: 9, op: 'all' }).all, { volume: 0.4 });
  // A message that is not from the game's frame is nobody's.
  const before = s.posted.length;
  for (const fn of s.heard.message) fn({ source: {}, data: { t: 'homie-net', what: 'prefs', n: 10, op: 'all' } });
  assert.equal(s.posted.length, before);
});

test('a newer version is said, never loaded; a room this copy cannot stay in offers another, or the game by itself', async () => {
  const s = await shell();
  // Still playing in its own room while a newer build is live: one line, and the game goes on.
  s.fromGame({ what: 'stale', ver: '8', mine: '7', final: false });
  assert.equal(s.el('[data-toast]').textContent, 'Update Gem Rush to play online with everyone.');
  assert.equal(s.el('[data-notice]').hidden, true);
  // Kept out of a room for it: the notice. Nothing reloads, however many times it is said.
  for (let i = 0; i < 4; i += 1) { s.fromGame({ what: 'closed', why: 'stale' }); s.fromGame({ what: 'stale', ver: '8', mine: '7', final: true }); }
  assert.equal(s.el('[data-notice]').hidden, false);
  assert.equal(s.el('[data-notice-text]').textContent, 'Update Gem Rush to play online with everyone.');
  assert.deepEqual(s.srcs, ['game/index.html'], 'the frame was never loaded again');
  assert.deepEqual(s.fetched.length, 1);
  // Quick play from the notice: the Lobby again (its own revision's rooms), and the game starts again in that room.
  s.el('[data-notice-quick]').listeners.click[0]();
  await s.settle();
  assert.equal(s.fetched.length, 2);
  assert.deepEqual(s.srcs, ['game/index.html', 'game/index.html?start=2']);
  assert.equal(s.el('[data-notice]').hidden, true);
  // An out-of-date copy invites nobody: a friend's browser would land on the newer version, which it cannot join.
  assert.equal(s.el('[data-invite]').hidden, true);
  assert.equal(s.el('[data-room-link]').textContent, 'Update Gem Rush to play online with everyone.');
  const fresh = await shell();
  assert.equal(fresh.el('[data-invite]').hidden, false);
  // A word from the page of the start BEFORE this one (still on its way out) is not about this room.
  const two = await shell();
  two.state.join('owl-party');
  two.page.old = '?start=0';
  two.fromGame({ what: 'closed', why: 'kicked', room: 'pub-3' });
  two.fromGame({ what: 'token', token: 'OLD', seat: 0, room: 'owl-party' });
  assert.equal(two.el('[data-notice]').hidden, true, 'the old page\'s goodbye is not this room\'s');
  assert.equal(two.ctx.localStorage.getItem('homie-net.gem.owl-party.play'), null);
  two.page.old = null;
  two.fromGame({ what: 'closed', why: 'kicked', room: 'pub-3' });
  assert.equal(two.el('[data-notice]').hidden, true, 'and a closed that names another room is not this room\'s either');
  two.fromGame({ what: 'closed', why: 'room-full', room: 'owl-party' });
  assert.equal(two.el('[data-notice-title]').textContent, 'This room is full');
  // Removed from a room: the next Lobby call asks for any other room.
  s.fromGame({ what: 'closed', why: 'kicked' });
  assert.equal(s.el('[data-notice-title]').textContent, 'You were removed from this room');
  s.el('[data-notice-quick]').listeners.click[0]();
  await s.settle();
  assert.equal(s.fetched.at(-1)[0], 'https://owls.example/gem/api/lobby?gv=7&not=pub-3');
  // Play offline from the notice.
  s.fromGame({ what: 'closed', why: 'room-full' });
  s.el('[data-notice-offline]').listeners.click[0]();
  assert.equal(s.net().url, '');
});

test('a room code is 1 to 32 letters, digits, - or _: anything else is refused, and a chosen room is remembered', async () => {
  const s = await shell();
  for (const bad of ['', 'no good', 'a/b', 'x'.repeat(33), '../etc', 'room?x=1']) {
    assert.equal(s.state.join(bad), false, JSON.stringify(bad));
  }
  assert.deepEqual(s.srcs, ['game/index.html'], 'no game was started for a bad code');
  assert.equal(s.el('[data-toast]').textContent, 'A room code is 1 to 32 letters, digits, - or _.');
  assert.equal(s.ctx.localStorage.getItem('homie-app.gem.room'), null);
  // The form: a friend's code.
  s.el('[data-join-code]').value = ' owl-party ';
  s.el('[data-join-form]').listeners.submit[0]({ preventDefault() {} });
  assert.match(s.net().url, /__net\?room=owl-party&b=/);
  assert.equal(s.ctx.localStorage.getItem('homie-app.gem.room'), 'owl-party');
  assert.equal(s.fetched.length, 1, 'a named room asks the Lobby nothing');
  // The next visit comes back to it; Quick play forgets it.
  const again = await shell({ storage: { 'homie-app.gem.room': 'owl-party' } });
  assert.deepEqual(again.fetched, []);
  assert.equal(again.net().room, 'owl-party');
  again.state.quick();
  await again.settle();
  assert.equal(again.ctx.localStorage.getItem('homie-app.gem.room'), null);
  assert.equal(again.net().room, 'pub-3');
  // A private room of one's own: six characters nobody would guess by accident.
  s.el('[data-private]').listeners.click[0]();
  assert.match(s.net().room, /^[a-z2-9]{6}$/);
  // A remembered code that is no code is not used.
  const junk = await shell({ storage: { 'homie-app.gem.room': '<script>' } });
  assert.equal(junk.net().room, 'pub-3');
});

test('the page frames the game as its own origin, with no sandbox and nothing loaded from anywhere else', () => {
  const html = read('standalone', 'shell', 'index.html');
  assert.match(html, /<iframe class="game" title="Game" allow="fullscreen; autoplay; gamepad"><\/iframe>/);
  assert.doesNotMatch(html, /sandbox=/, 'the frame is this page\'s own origin: the game\'s local saves and storage work');
  assert.doesNotMatch(html, /https?:\/\//, 'no file of the page comes from a site');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)">/g)].map((m) => m[1]), ['config.js', 'shell.js']);
  assert.doesNotMatch(SHELL, /location\.reload|\.reload\(/, 'the shell never reloads itself');
  assert.doesNotMatch(SHELL, /cookie|credentials/);
});

/* ------------------------------------------------------------------ the Worker */

async function site({ version = '7', room = undefined } = {}) {
  const { default: worker } = await import('../worker/index.mjs');
  const cat = { studio: { name: 'Owls', slug: 'owls' }, games: [{ id: 'cave-run', name: 'Cave Run', players: { min: 1, max: 4 }, netplay: version ? { version } : {}, room, landing: {} }] };
  const pages = { '/games.json': JSON.stringify(cat), '/games/cave-run/index.html': '<!doctype html><html><head><title>x</title></head><body></body></html>' };
  const asked = [];
  const env = {
    ASSETS: { fetch: async (req) => { const f = pages[new URL(typeof req === 'string' ? req : req.url).pathname]; return f ? new Response(f, { headers: { 'content-type': 'text/html' } }) : new Response('nf', { status: 404 }); } },
    LOBBY: { idFromName: () => 'x', get: () => ({ fetch: async (u) => { asked.push(new URL(String(u.url ?? u))); return new Response(JSON.stringify({ room: 'pub-1', players: 0, max: 4 }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); } }) },
    TABLE: { idFromName: (n) => n, get: () => ({ fetch: async (req) => { asked.push(new URL(req.url)); return new Response('ok'); } }) },
  };
  const fetchSite = (path, init) => worker.fetch(new Request(`https://owls.example${path}`, init), env, { waitUntil() {} });
  return { fetchSite, asked, env };
}

test('the Lobby\'s answer is readable from the three app origins and no other, and never with credentials', async () => {
  const { fetchSite } = await site();
  assert.deepEqual(APP_ORIGINS, ['app://game', 'capacitor://localhost', 'https://localhost']);
  for (const origin of APP_ORIGINS) {
    const r = await fetchSite('/cave-run/api/lobby?gv=7', { method: 'POST', headers: { origin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), origin, 'that origin, by name');
    assert.match(r.headers.get('vary') ?? '', /origin/i);
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
    assert.equal((await r.json()).room, 'pub-1');
  }
  for (const headers of [{}, { origin: 'https://evil.example' }, { origin: 'app://other' }, { origin: 'null' }, { origin: 'https://localhost:8443' }, { origin: 'https://owls.example' }]) {
    const r = await fetchSite('/cave-run/api/lobby', { method: 'POST', headers });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), null, JSON.stringify(headers));
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  }
  // EVERY answer to an app's Lobby call carries it, so its page can read why it plays offline: a refusal inside the
  // branch, a game this site does not have (answered long before the branch), and a failure that was thrown.
  const refused = await fetchSite('/cave-run/api/lobby?server=night-shift', { method: 'POST', headers: { origin: 'app://game' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.headers.get('access-control-allow-origin'), 'app://game');
  assert.equal((await refused.json()).error, 'app-public', 'an app plays on the public server only');
  const nogame = await fetchSite('/no-such-game/api/lobby', { method: 'POST', headers: { origin: 'capacitor://localhost' } });
  assert.equal(nogame.status, 404);
  assert.equal(nogame.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  assert.equal((await fetchSite('/no-such-game/api/lobby', { method: 'POST', headers: { origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  const broken = await site();
  broken.env.LOBBY.get = () => { throw new TypeError('the lobby broke'); };
  const said = console.error; console.error = () => {};
  const thrown = await broken.fetchSite('/cave-run/api/lobby', { method: 'POST', headers: { origin: 'app://game' } });
  console.error = said;
  assert.equal(thrown.status, 500);
  assert.equal(thrown.headers.get('access-control-allow-origin'), 'app://game');
  await assert.rejects(() => broken.fetchSite('/cave-run/api/lobby', { method: 'POST' }), /the lobby broke/, 'any other caller: as before');
  // No other address of the site is opened to an app, whatever it answers.
  for (const path of ['/cave-run/', '/api/rooms', '/cave-run/api/watch', '/cave-run/api/lobbyx', '/cave-run/api/lobby/more']) assert.equal((await fetchSite(path, { headers: { origin: 'app://game' } })).headers.get('access-control-allow-origin') === 'app://game', false, path);
  // The helpers themselves.
  const req = (origin) => new Request('https://owls.example/x', { headers: origin ? { origin } : {} });
  assert.equal(isAppOrigin(req('capacitor://localhost')), true);
  assert.equal(isAppOrigin(req('capacitor://localhost.evil.example')), false);
  const same = new Response('x');
  assert.equal(appCors(req(null), same), same, 'any other request: the answer as it was');
  assert.equal(appCors(req('app://game'), new Response('x', { headers: { 'access-control-allow-origin': '*' } })).headers.get('access-control-allow-origin'), 'app://game', 'never a star');
});

test('an app\'s own revision reaches the Lobby; a page of the site is matched within the live one, whatever it says', async () => {
  const { fetchSite, asked } = await site({ version: '7' });
  const ver = async (path, origin) => { await fetchSite(path, { method: 'POST', headers: origin ? { origin } : {} }); return asked.at(-1).searchParams.get('ver'); };
  assert.equal(await ver('/cave-run/api/lobby?gv=6', 'app://game'), '6', 'an older copy is matched with copies of its own revision');
  assert.equal(await ver('/cave-run/api/lobby?gv=7', 'capacitor://localhost'), '7');
  assert.equal(await ver('/cave-run/api/lobby', 'https://localhost'), null, 'a copy built before the game named a revision: the pool of no revision, never the live one');
  assert.equal(await ver('/cave-run/api/lobby?gv=not%20a%20version', 'app://game'), null);
  assert.equal(await ver('/cave-run/api/lobby?gv=6', null), '7', 'the site\'s own page cannot choose');
  assert.equal(await ver('/cave-run/api/lobby?gv=6', 'https://evil.example'), '7');
  assert.equal(await ver('/cave-run/api/lobby?gv=6', 'https://owls.example'), '7');
});

test('everything that must come from the site\'s own pages still refuses an app, and the game\'s page hands an app nothing', async () => {
  const { fetchSite } = await site();
  for (const origin of APP_ORIGINS) {
    const r = await fetchSite('/cave-run/api/chat/report', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ room: 'pub-1', id: 'abc' }) });
    assert.equal(r.status, 403, `a chat report from ${origin}`);
    assert.equal((await r.json()).error, 'origin');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  }
  // The index and the worker's own source: one place opens anything to an app, and nothing allows credentials.
  const index = read('worker', 'index.mjs');
  assert.equal(index.split('appCors(').length, 3, 'CORS covers Lobby and public app records, including record preflight');
  assert.match(index, /const appLobby = isAppOrigin\(request\) && \/\^\\\/\[\^\/\]\+\\\/api\\\/lobby\\\/\?\$\/\.test\(url\.pathname\);/);
  assert.equal(index.split('isAppOrigin(').length, 4, 'Lobby and records entry points, and where the Lobby is told the caller is an app');
  for (const f of readdirSync(join(PKG, 'worker')).filter((n) => n.endsWith('.mjs'))) assert.doesNotMatch(readFileSync(join(PKG, 'worker', f), 'utf8'), /['"]access-control-allow-credentials['"]\s*:/i, `${f} never allows credentials across origins`);
  assert.doesNotMatch(read('worker', 'office.mjs').split('export function sameOrigin')[1].split('\n}')[0], /app|capacitor/, 'sameOrigin knows no app');
});

/** The real Lobby class, with a store that keeps what it is given and says how big it is. */
function realLobby() {
  const store = new Map();
  let puts = 0;
  const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { puts += 1; store.set(k, structuredClone(v)); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil() {} };
  const lobby = new Lobby(ctx, { DB: { batch: async () => [], prepare: () => ({ bind: () => ({}) }) } });
  const join = async (q) => { const r = await lobby.fetch(new Request(`https://lobby/join?${q}`, { method: 'POST' })); return { status: r.status, ...(await r.json()) }; };
  const report = (room, players, ver) => lobby.fetch(new Request('https://lobby/report?game=cave-run', { method: 'POST', body: JSON.stringify({ room, players, ...(ver !== undefined ? { ver } : {}) }) }));
  return { lobby, join, report, stored: () => JSON.stringify(store.get('lobby') ?? null).length, puts: () => puts };
}

test('the real Lobby: a caller that invents a version a request makes no room a request, and its stored list stays small', async () => {
  const { lobby, join, stored } = realLobby();
  // The live build's page first, then three thousand "apps", each claiming a build of its own.
  assert.equal((await join('max=8&server=public&rooms=16&ver=live')).room, 'pub-1');
  let rooms = 0; let refused = 0;
  for (let i = 0; i < 3000; i += 1) { const r = await join(`max=8&server=public&rooms=16&ver=fake${i}&app=1`); if (r.room) rooms += 1; else { refused += 1; assert.deepEqual([r.status, r.error, r.ok], [503, 'versions', false]); } }
  assert.equal(rooms, LOBBY_APP_VERSIONS, 'the live build and eight others have rooms: no more');
  assert.equal(refused, 3000 - LOBBY_APP_VERSIONS);
  assert.equal(lobby.rooms.size, LOBBY_APP_VERSIONS + 1);
  assert.ok(stored() < 4096, `the stored list is ${stored()} bytes`);
  // A build that already has a room is still matched (a real older copy, among the noise), and the live page always.
  assert.equal((await join('max=8&server=public&rooms=16&ver=fake3&app=1')).status, 200);
  assert.equal((await join('max=8&server=public&rooms=16&ver=live')).room, 'pub-1');
  assert.equal((await join('max=8&server=public&rooms=16&ver=newer')).status, 200, 'a page of the site is never held to the apps\' number');
  // One claimed build, asked for over and over: a room every eight seats, and never more than the Lobby keeps.
  const one = realLobby();
  for (let i = 0; i < 6000; i += 1) assert.equal((await one.join('max=8&server=public&rooms=16&ver=v1&app=1')).status, 200);
  assert.ok(one.lobby.rooms.size <= LOBBY_ROOMS_MAX, `${one.lobby.rooms.size} rooms kept`);
  assert.ok(one.stored() < 128 * 1024 / 2, `the stored list is ${one.stored()} bytes, under half of what one stored value may be`);
});

test('the real Lobby: a server\'s number of rooms holds whatever build each room runs, and the list never outgrows its bound', async () => {
  const { lobby, join, report } = realLobby();
  // A server of two rooms, both full of people on build A.
  const a1 = (await join('max=2&server=night-shift&rooms=2&ver=A')).room;
  await report(a1, 2, 'A');
  const a2 = (await join('max=2&server=night-shift&rooms=2&ver=A')).room;
  await report(a2, 2, 'A');
  assert.notEqual(a1, a2);
  // Build B goes live: its visitor is sent to a room the server has, never a third one.
  const b = await join('max=2&server=night-shift&rooms=2&ver=B');
  assert.deepEqual([b.status, b.full, [a1, a2].includes(b.room)], [200, true, true]);
  assert.equal([...lobby.rooms.values()].filter((r) => r.server === 'night-shift').length, 2, 'the server still has its two rooms');
  for (let i = 0; i < 40; i += 1) await join(`max=2&server=night-shift&rooms=2&ver=C${i}`);
  assert.equal([...lobby.rooms.values()].filter((r) => r.server === 'night-shift').length, 2);
  // Held out of both (kicked from one, the other closed to it): no room, said as such, and none made.
  const none = await join(`max=2&server=night-shift&rooms=2&ver=B&not=${a1},${a2}`);
  assert.deepEqual([none.status, none.room, none.error], [503, null, 'full']);
  // The whole list is bounded: with every room holding people, nobody is given a new one.
  const busy = realLobby();
  for (let i = 1; i <= LOBBY_ROOMS_MAX; i += 1) { const r = await busy.join('max=1&server=public&rooms=16&ver=live'); await busy.report(r.room, 1, 'live'); }
  assert.equal(busy.lobby.rooms.size, LOBBY_ROOMS_MAX);
  const waits = await busy.join('max=1&server=public&rooms=16&ver=live');
  assert.deepEqual([waits.status, waits.full, busy.lobby.rooms.size], [200, true, LOBBY_ROOMS_MAX]);
  const app = await busy.join('max=1&server=public&rooms=16&ver=old&app=1');
  assert.deepEqual([app.status, app.room, app.error], [503, null, 'busy']);
  // Rooms nobody is seated in make way first.
  const idle = realLobby();
  for (let i = 0; i < LOBBY_ROOMS_MAX + 40; i += 1) await idle.join('max=1&server=public&rooms=16&ver=live');
  assert.ok(idle.lobby.rooms.size <= LOBBY_ROOMS_MAX);
});

/* ------------------------------------------------------------------ the helper */

let kit = null;
async function netplayKit() {
  if (kit) return kit;
  const esbuild = (await import(join(REPO_NM, 'esbuild', 'lib', 'main.js'))).default;
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `export * from ${JSON.stringify(join(PKG, 'netplay', 'netplay.ts'))};\n`);
  const file = join(scratch, 'kit.mjs');
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  kit = await import(file);
  return kit;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('in an app, a newer version is "update the app", and a tap on the line reloads nothing', async (t) => {
  const { createNetplay, APP_STALE_LINE } = await netplayKit();
  assert.equal(APP_STALE_LINE, 'A new version is out. Update the app to play online.');
  const drawn = [];
  const node = (tag) => ({ tag, attrs: {}, textContent: '', hidden: false, listeners: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; }, addEventListener(type, fn) { this.listeners[type] = fn; } });
  let reloaded = 0;
  globalThis.document = { hidden: false, head: { appendChild: (el) => drawn.push(el) }, body: { appendChild: (el) => drawn.push(el) }, createElement: (tag) => node(tag), addEventListener() {} };
  globalThis.location = { search: '', reload() { reloaded += 1; } };
  t.after(() => { delete globalThis.document; delete globalThis.location; });
  const lines = () => drawn.filter((el) => el.tag === 'div' && !el.hidden).map((el) => [el.attrs['data-homie-link'], el.textContent]);
  // A room whose site runs revision 2, and a copy that is revision 1.
  const room = new NetRoom({ code: 'r', maxPlayers: 4, log() {} });
  room.setCurrent('2');
  const beat = setInterval(() => room.tick(), 250);
  const sockets = [];
  class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; sockets.push(this);
      this.h = room.attach({ ver: this.constructor.ver, send: (x) => setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: x }); }, 0), close: () => setTimeout(() => { this.readyState = 3; this.onclose?.({}); }, 0), buffered: () => 0 });
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }
    send(x) { this.h.onMessage(x); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.h.onClose(); }
  }
  const Old = class extends MemorySocket { static ver = '1'; };
  const New = class extends MemorySocket { static ver = '2'; };
  const posted = [];
  const cfg = (extra) => ({ v: 1, url: 'ws://relay/x/__net?room=r', room: 'r', device: 'desk', want: 'play', ...extra });
  const copy = createNetplay({ config: cfg({ ver: '1', app: true }), WebSocketImpl: Old, post: (m) => posted.push(m), game: 'x' });
  t.after(() => { clearInterval(beat); copy.close(); });
  await wait(60);
  assert.equal(copy.link, 'online', 'an older copy still plays in a room of its own revision');
  assert.deepEqual(lines(), [['stale', APP_STALE_LINE]]);
  assert.deepEqual(posted.find((m) => m.what === 'stale'), { what: 'stale', ver: '2', mine: '1', final: false });
  drawn.find((el) => el.tag === 'div').listeners.click();
  assert.equal(reloaded, 0, 'a tap reloads nothing: a reload cannot bring a newer build to an app');
  // The same room, a page of the site (no `app`): the words it always had, and a tap reloads.
  copy.close();
  await wait(30);
  drawn.length = 0;
  const tab = createNetplay({ config: cfg({ ver: '1' }), WebSocketImpl: Old, post: null, game: 'x' });
  await wait(60);
  assert.deepEqual(lines(), [['stale', 'A new version is ready. Tap to reload.']]);
  drawn.find((el) => el.tag === 'div').listeners.click();
  assert.equal(reloaded, 1);
  // Kept out of a room the live revision holds: final, and in an app it is said the same way.
  const holder = createNetplay({ config: cfg({ ver: '2' }), WebSocketImpl: New, post: null, game: 'x', linkOverlay: false });
  tab.close();
  await wait(80);
  drawn.length = 0;
  const late = createNetplay({ config: cfg({ ver: '1', app: true }), WebSocketImpl: Old, post: (m) => posted.push(m), game: 'x' });
  t.after(() => { holder.close(); late.close(); });
  await wait(80);
  assert.equal(late.closedWhy, 'stale');
  assert.deepEqual(lines(), [['stale', APP_STALE_LINE]]);
  assert.deepEqual(posted.filter((m) => m.what === 'stale').at(-1), { what: 'stale', ver: '2', mine: '1', final: true });
  drawn.find((el) => el.tag === 'div').listeners.click();
  assert.equal(reloaded, 1, 'still nothing reloaded by the app');
});

test('a config with no socket is offline with its bots, and its prefs are still the page\'s to keep', async () => {
  const { createNetplay } = await netplayKit();
  const posted = [];
  const net = createNetplay({ config: { v: 1, url: '', prefs: true, device: 'desk', want: 'play', debug: false, chatOff: true, bubbleOff: true, app: true, params: {} }, WebSocketImpl: class { constructor() { throw new Error('never opened'); } }, post: (m) => posted.push(m), game: 'gem' });
  await wait(10);
  assert.deepEqual([net.offline, net.link, net.role, net.connected], [true, 'offline', 'host', false]);
  assert.equal(net.prefs.where, 'page', 'the shell answers net.prefs even with no room');
  const got = net.prefs.get('quality', 'high');
  const ask = posted.find((m) => m.what === 'prefs');
  assert.deepEqual([ask.op, typeof ask.n], ['all', 'number']);
  assert.equal(posted.some((m) => m.what === 'attached'), false, 'an offline helper never says attached: the shell takes its first word instead');
  net.close();
  void got;
});

/* ------------------------------------------------------------------ the command */

/** A computer with nothing installed: every program is "not found". */
const nothing = async () => ({ code: 127, stdout: '', stderr: '' });
const bare = { platform: 'linux', env: {}, exec: nothing, home: join(scratch, 'nobody') };
const ROWS = ['standalone-xcode', 'standalone-android', 'standalone-jdk', 'standalone-apple-signing', 'standalone-notary', 'standalone-ios-signing', 'standalone-steamcmd'];
/** On a Mac there is one more: a phone to try a build on. */
const MAC_ROWS = [...ROWS.slice(0, 6), 'standalone-phone', 'standalone-steamcmd'];
/** What the real command lists on the computer this test runs on. */
const HERE_ROWS = process.platform === 'darwin' ? MAC_ROWS : ROWS;

test('a plan on a computer with nothing: every target said with what it needs, none passed over, nothing written', async () => {
  const root = studio('plan');
  const rows = await standaloneRows(bare);
  assert.deepEqual(rows.map((r) => r.id), ROWS);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r), ['id', 'label', 'need', 'state', 'detail', 'unlocks', 'fix'], 'the setup status\'s shape');
    assert.equal(r.state, 'optional');
    assert.ok(r.fix && typeof r.fix.say === 'string' && ['person', 'ai'].includes(r.fix.who));
  }
  const plan = await standalonePlan(root, 'gem', bare);
  assert.equal(plan.ok, true);
  assert.deepEqual([plan.command, plan.game, plan.appId, plan.appIdFrom, plan.version, plan.build, plan.site, plan.dir], ['standalone plan', 'gem', 'rocks.homie.nightowls.gem', 'derived', '1.0.0', 1, null, join('.studio', 'standalone', 'gem')]);
  assert.deepEqual(plan.targets.map((t) => [t.target, t.state]), [['mac', 'skipped'], ['windows', 'ready'], ['linux', 'ready'], ['ios', 'skipped'], ['android', 'skipped']]);
  for (const t of plan.targets.filter((x) => x.state === 'skipped')) { assert.ok(t.why, `${t.target} says why`); assert.match(t.instead ?? '', /standalone ci/); }
  assert.deepEqual(plan.targets.find((t) => t.target === 'android').row, 'standalone-android');
  assert.deepEqual(plan.missing, MISSING);
  assert.equal(plan.icon.from, 'letter');
  assert.match(plan.warnings.join('\n'), /OFFLINE ONLY/);
  assert.match(plan.warnings.join('\n'), /names no "netplay\.version"/);
  assert.match(plan.warnings.join('\n'), /made-up one for trying a build/);
  assert.match(plan.needs, /^Quick play finds a room only when the live site runs @homie-rocks\/studio 0\.32\.0 or later/, 'only Quick play needs the newer site');
  assert.match(plan.needs, /A room made or joined by its code works with an older site too \(seen against 0\.31\.0, not promised for every older version\)/);
  assert.match(plan.needs, /did not ask the site/, 'what was not checked is said as not checked');
  assert.equal(existsSync(join(root, '.studio', 'standalone')), false, 'a plan writes nothing and installs nothing');
  const text = standaloneLines(plan).join('\n');
  assert.match(text, /○ mac {6}SKIPPED here: a macOS app is put together on a Mac/);
  assert.match(text, /→ windows {2}Electron: out\/windows\/debug\/gem\.exe and its files \(unsigned\)/);
  assert.match(text, /What the standalone game does not have \(v1\):/);
  // An address: a custom domain is taken as it is; a workers.dev one is warned about; http is this computer's only.
  const live = await standalonePlan(root, 'gem', { ...bare, site: 'https://play.owls.example/x' });
  assert.equal(live.site, 'https://play.owls.example');
  assert.match(live.warnings.join('\n'), /built into every copy and cannot be changed/);
  assert.doesNotMatch(live.warnings.join('\n'), /workers\.dev/);
  const dev = await standalonePlan(root, 'gem', { ...bare, env: { HOMIE_STANDALONE_SITE: 'https://test-studio.acct.workers.dev' } });
  assert.deepEqual([dev.site, dev.siteFrom], ['https://test-studio.acct.workers.dev', 'HOMIE_STANDALONE_SITE']);
  assert.match(dev.warnings.join('\n'), /its own domain \(studio\.json cloudflare\.domain\) before you ship/);
  assert.equal((await standalonePlan(root, 'gem', { ...bare, site: 'http://owls.example' })).site, null);
  assert.equal((await standalonePlan(root, 'gem', { ...bare, site: 'http://127.0.0.1:8787' })).site, 'http://127.0.0.1:8787');
  // Words that are not a plan. `--for` with nothing after it is an unfinished sentence, never "all five".
  assert.match((await standalonePlan(root, 'nope', bare)).why, /no game "nope"/);
  assert.match((await standalonePlan(root, 'gem', { ...bare, for: 'mac,playstation' })).why, /not playstation/);
  assert.deepEqual((await standalonePlan(root, 'gem', { ...bare, for: 'win,macos' })).targets.map((t) => t.target), ['windows', 'mac']);
  for (const empty of [true, '', ' , ']) assert.match((await standalonePlan(root, 'gem', { ...bare, for: empty })).why, /--for (needs what to build|takes)/, JSON.stringify(empty));
  assert.match((await standaloneCommand(root, 'build', ['standalone', 'build', 'gem'], new Map([['for', true]]))).why, /--for needs what to build/);
  assert.equal(JSON.parse(run(['standalone', 'build', 'gem', '--for'], root).stdout).ok, false);
  assert.equal(existsSync(join(root, '.studio', 'standalone')), false);
  // A build on that computer: the named target that cannot be made is a failure of the command, said as skipped.
  const none = await standaloneBuild(root, 'gem', { ...bare, for: 'ios' });
  assert.deepEqual([none.ok, none.targets[0].state, none.targets[0].row], [false, 'skipped', 'standalone-xcode']);
  assert.match(none.why, /not built: ios/);
  assert.deepEqual(none.missing, MISSING);
  assert.match(standaloneLines(none).join('\n'), /NOT DONE: not built: ios/);
  // A page whose own policy would stop the one script a copy adds is said in the plan, not found out offline.
  const page = join(root, 'games', 'gem', 'index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace(/<head>/i, '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'">'));
  assert.match((await standalonePlan(root, 'gem', bare)).warnings.join('\n'), /Content-Security-Policy \(script-src 'self'\) that does not allow an inline script[\s\S]*OFFLINE ONLY/);
  assert.equal(cspBlocksInline('<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\'">'), null);
  assert.equal(cspBlocksInline('<meta http-equiv=content-security-policy content="img-src *">'), null);
  assert.equal(cspBlocksInline('<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\' \'nonce-abc\'">'), "script-src 'self' 'unsafe-inline' 'nonce-abc'", 'a nonce turns unsafe-inline off');
  assert.equal(withNetScript('<header>x</header><head lang="en"><title>t</title>'), `<header>x</header><head lang="en">${NET_SCRIPT}<title>t</title>`, 'the head, never a header');
  assert.equal(withNetScript('<header>only</header>'), `${NET_SCRIPT}<header>only</header>`);
});

test('a row says ok only for what was looked at: the right kind of identity, the platform the build needs, or "could not check"', async () => {
  const sdkHome = join(scratch, 'sdk-home');
  const exec = (over = {}) => async (cmd, args) => {
    const key = `${cmd} ${args[0] ?? ''}`.trim();
    if (key in over) return over[key];
    return { code: 127, stdout: '', stderr: '' };
  };
  const identities = (...names) => ({ code: 0, stdout: `${names.map((n, i) => `  ${i + 1}) ABCDEF${i} "${n}"`).join('\n')}\n     ${names.length} valid identities found\n`, stderr: '' });
  const mac = { platform: 'darwin', home: sdkHome };
  const row = (rows, id) => rows.find((r) => r.id === id);
  // An Apple Development certificate is not one that signs a release.
  let rows = await standaloneRows({ ...mac, env: { HOMIE_APPLE_IDENTITY: 'x', HOMIE_APPLE_TEAM: 'T' }, exec: exec({ 'security find-identity': identities('Apple Development: Somebody (AAAA)') }) });
  assert.equal(row(rows, 'standalone-apple-signing').state, 'optional');
  assert.match(row(rows, 'standalone-apple-signing').detail, /^0 Developer ID Application identities in the keychain \(and 1 of another kind, which cannot sign a release\)/);
  // The right kind, and the name in the environment: ok. Each without the other: not.
  rows = await standaloneRows({ ...mac, env: { HOMIE_APPLE_IDENTITY: 'x' }, exec: exec({ 'security find-identity': identities('Developer ID Application: Somebody (AAAA)', 'Apple Development: Somebody (AAAA)') }) });
  assert.equal(row(rows, 'standalone-apple-signing').state, 'ok');
  assert.equal(row(rows, 'standalone-ios-signing').state, 'optional', 'the macOS identity says nothing about iOS');
  assert.doesNotMatch(JSON.stringify(rows), /Somebody|ABCDEF|AAAA/, 'a count, never a name');
  rows = await standaloneRows({ ...mac, env: {}, exec: exec({ 'security find-identity': identities('Developer ID Application: Somebody (AAAA)') }) });
  assert.equal(row(rows, 'standalone-apple-signing').state, 'optional');
  // The keychain could not be read: said as that, never as "none" and never as fine.
  rows = await standaloneRows({ ...mac, env: { HOMIE_APPLE_IDENTITY: 'x', HOMIE_APPLE_TEAM: 'T', HOMIE_APPLE_NOTARY_PROFILE: 'p' }, exec: exec({ 'security find-identity': { code: 1, stdout: '', stderr: 'denied' } }) });
  assert.deepEqual([row(rows, 'standalone-apple-signing').state, row(rows, 'standalone-apple-signing').detail], ['unknown', 'could not check the keychain (the security tool did not answer)']);
  // A name in the environment is a name, not a check: said as "checked later".
  assert.equal(row(rows, 'standalone-ios-signing').state, 'later');
  assert.match(row(rows, 'standalone-ios-signing').detail, /is not checked until a release is archived/);
  assert.equal(row(rows, 'standalone-notary').state, 'later');
  // Xcode without its iOS platform is not ready for iOS.
  rows = await standaloneRows({ ...mac, env: {}, exec: exec({ 'xcodebuild -version': { code: 0, stdout: 'Xcode 26.3\nBuild version 17C529\n', stderr: '' }, 'xcodebuild -showsdks': { code: 0, stdout: 'macOS SDKs:\n\tmacOS 26.2 -sdk macosx26.2\n', stderr: '' } }) });
  assert.deepEqual([row(rows, 'standalone-xcode').state, row(rows, 'standalone-xcode').detail], ['optional', 'Xcode 26.3, without its iOS platform']);
  rows = await standaloneRows({ ...mac, env: {}, exec: exec({ 'xcodebuild -version': { code: 0, stdout: 'Xcode 26.3\n', stderr: '' }, 'xcodebuild -showsdks': { code: 0, stdout: '\tiOS 26.2 -sdk iphoneos26.2\n\tSimulator - iOS 26.2 -sdk iphonesimulator26.2\n', stderr: '' } }) });
  assert.equal(row(rows, 'standalone-xcode').state, 'ok');
  // An SDK without the platform the project compiles against is found, and not ready.
  mkdirSync(join(sdkHome, 'Library', 'Android', 'sdk', 'platforms', 'android-34'), { recursive: true });
  rows = await standaloneRows({ ...mac, env: {}, exec: exec() });
  assert.equal(row(rows, 'standalone-android').state, 'optional');
  assert.match(row(rows, 'standalone-android').detail, new RegExp(`without the android-${ANDROID_PLATFORM} platform the build compiles against \\(it has android-34\\)`));
  mkdirSync(join(sdkHome, 'Library', 'Android', 'sdk', 'platforms', `android-${ANDROID_PLATFORM}`), { recursive: true });
  rows = await standaloneRows({ ...mac, env: {}, exec: exec() });
  assert.equal(row(rows, 'standalone-android').state, 'ok');
  assert.match(row(rows, 'standalone-android').detail, /its build tools and licences were not checked/);
  // Where a fix is a value in the environment, it says how for somebody in a desktop app, and never asks for it in chat.
  for (const id of ['standalone-apple-signing', 'standalone-notary', 'standalone-ios-signing']) assert.match(row(rows, id).fix.say, /never in the chat[\s\S]*launchctl setenv[\s\S]*repository secret/, id);
});

/* ------------------------------------------------------------------ a build, with every tool a stand-in */

/**
 * The tools as stand-ins: npm "installs" (the folders and npm's own marker), pack.mjs "packages" (the folder and the
 * program it would make, and the one line of JSON), the built app "starts" (the self-check's line). `plan` says how
 * each behaves; `calls` is everything that was asked for, with the environment it was given.
 */
function standIns(plan = {}) {
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env ?? null, cwd: opts.cwd ?? null });
    const said = (o) => ({ code: o.ok === false ? 1 : 0, stdout: `${JSON.stringify(o)}\n`, stderr: '' });
    if (/npm(\.cmd)?$/.test(cmd) && args[0] === 'install') {
      if (plan.npm === 'fails') return { code: 1, stdout: '', stderr: 'npm error network' };
      const pkg = JSON.parse(readFileSync(join(opts.cwd, 'package.json'), 'utf8'));
      for (const name of Object.keys(pkg.devDependencies ?? {})) { mkdirSync(join(opts.cwd, 'node_modules', ...name.split('/')), { recursive: true }); writeFileSync(join(opts.cwd, 'node_modules', ...name.split('/'), 'package.json'), '{}'); }
      if (plan.npm !== 'interrupted') writeFileSync(join(opts.cwd, 'node_modules', '.package-lock.json'), '{}');
      return { code: 0, stdout: 'added', stderr: '' };
    }
    if (String(args[0]).endsWith('pack.mjs')) {
      const [, platform, arch, kind] = args;
      const os = { darwin: 'mac', win32: 'windows', linux: 'linux' }[platform];
      const how = plan[os] ?? 'ok';
      if (how === 'missing-module' && calls.filter((c) => String(c.args[0]).endsWith('pack.mjs') && c.args[1] === platform).length === 1) return { code: 1, stdout: '', stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'galactus' imported from packager.js" };
      if (how === 'fails') return said({ ok: false, why: 'the packager broke' });
      const out = join(opts.cwd, 'out', os, kind);
      rmSync(out, { recursive: true, force: true });
      const meta = JSON.parse(readFileSync(join(opts.cwd, 'electron', 'package.json'), 'utf8'));
      const app = os === 'mac' ? join(out, `${meta.fileName}.app`) : out;
      const exe = os === 'mac' ? join(app, 'Contents', 'MacOS', meta.fileName) : join(out, os === 'windows' ? `${meta.name}.exe` : meta.name);
      if (how !== 'lies') { mkdirSync(dirname(exe), { recursive: true }); writeFileSync(exe, 'program'); }
      const identity = opts.env?.HOMIE_APPLE_IDENTITY;
      return said({ ok: true, platform, arch, kind, path: out, app, exe, electron: '44.6.0', signed: Boolean(identity) && plan.signature !== 'bad', adhoc: identity === '-', notarizeAsked: Boolean(identity && identity !== '-' && opts.env?.HOMIE_APPLE_NOTARY_PROFILE), notarized: plan.stapled === true, checks: plan.signature === 'bad' ? { signature: false, signatureSays: 'code object is not signed at all' } : {} });
    }
    if (args[0] === '--smoke=5000') return plan.start === 'fails' ? { code: 1, stdout: '', stderr: 'cannot open display' } : said({ smoke: 1, ok: plan.start !== 'dirty', loaded: plan.start !== 'blank', origin: 'app://game', failed: plan.start === 'dirty' ? ['404 app://game/game/missing.png'] : [], errors: [] });
    return { code: 127, stdout: '', stderr: '' };
  };
  return { exec, calls, packs: () => calls.filter((c) => String(c.args[0]).endsWith('pack.mjs')), installs: () => calls.filter((c) => c.args[0] === 'install') };
}

test('a build says what is true of each target: built where its file is, started or not, skipped, failed, unsigned', async () => {
  const root = built();
  const base = { home: join(scratch, 'nobody'), buildSite: false };
  // A Linux computer: Windows and Linux are built, Linux (this computer's own) is started once, the Mac ones skipped.
  let t = standIns();
  let r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual(r.targets.map((x) => [x.target, x.state]), [['mac', 'skipped'], ['windows', 'built'], ['linux', 'built'], ['ios', 'skipped'], ['android', 'skipped']]);
  const dir = standaloneDir(root, 'gem');
  for (const x of r.targets.filter((y) => y.state === 'built')) assert.ok(existsSync(join(dir, x.path)), `${x.path} is there`);
  assert.deepEqual(r.targets.find((x) => x.target === 'linux').started, { ran: true, loaded: true, clean: true, origin: 'app://game', failed: [], errors: [] });
  assert.match(r.targets.find((x) => x.target === 'linux').notes.join('\n'), /started here and loaded the game: yes/);
  assert.equal(r.targets.find((x) => x.target === 'windows').started, null);
  assert.match(r.targets.find((x) => x.target === 'windows').notes.join('\n'), /built, not started on this computer/);
  assert.match(r.targets.find((x) => x.target === 'linux').notes.join('\n'), /chrome-sandbox file is owned by root with mode 4755, or it is started with --no-sandbox/);
  assert.equal(t.installs().length, 1);
  // The project carries this toolkit's lockfile: every package of the tools at one version, with its checksum.
  assert.equal(readFileSync(join(dir, 'package-lock.json'), 'utf8'), read('lib', 'standalone-lock.json'));
  // built.json: an entry for each target and kind, each with its own numbers.
  let record = JSON.parse(readFileSync(join(dir, 'built.json'), 'utf8'));
  assert.deepEqual([record.v, record.game, Object.keys(record.targets).sort()], [2, 'gem', ['linux', 'windows']]);
  assert.deepEqual(Object.keys(record.targets.linux.debug).sort(), ['at', 'build', 'netplayVersion', 'path', 'toolkit', 'version']);
  assert.deepEqual([record.targets.linux.debug.version, record.targets.linux.debug.build, record.targets.linux.debug.path], ['1.0.0', 1, join('out', 'linux', 'debug')]);
  // A second build installs nothing; a build that was started and loaded nothing says NO; one that cannot start says so.
  t = standIns({ start: 'blank' });
  r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec, for: 'linux' });
  assert.equal(t.installs().length, 0, 'the tools are there, and their install finished');
  assert.match(r.targets[0].notes.join('\n'), /started here and loaded the game: NO/);
  t = standIns({ start: 'fails' });
  r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec, for: 'linux' });
  assert.deepEqual(r.targets[0].started.ran, false);
  assert.match(r.targets[0].notes.join('\n'), /could not be started here: it did not start \(cannot open display\)/);
  assert.equal(r.ok, true, 'a build that could not be started here is still built, and says what was not seen');
  // ANY failed target makes the command not ok, named or not; the others are still built.
  t = standIns({ windows: 'fails' });
  r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec });
  assert.deepEqual([r.ok, r.failed, r.built], [false, ['windows'], ['linux']]);
  assert.match(r.why, /failed: windows/);
  assert.match(standaloneLines(r).join('\n'), /✗ windows {2}FAILED: the packager broke/);
  // A tool that says it finished and left nothing is a failure, whatever it said.
  t = standIns({ linux: 'lies' });
  r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec, for: 'linux' });
  assert.deepEqual([r.ok, r.targets[0].state], [false, 'failed']);
  assert.match(r.targets[0].why, /the app is not where it said/);
  // An install that did not finish (npm's own marker is not there) is done again, and said.
  rmSync(join(dir, 'node_modules', '.package-lock.json'));
  const said = [];
  t = standIns();
  r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec, for: 'linux', log: (l) => said.push(l) });
  assert.equal(t.installs().length, 1);
  assert.match(said.join('\n'), /the last install of the wrapper tools did not finish: installing them again/);
  // A file of the tools is missing though npm's marker is there: installed again ONCE, tried again, and said.
  t = standIns({ linux: 'missing-module' });
  said.length = 0;
  r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec, for: 'linux', log: (l) => said.push(l) });
  assert.equal(r.ok, true, r.why);
  assert.deepEqual([t.installs().length, t.packs().length], [1, 2]);
  assert.match(said.join('\n'), /A file of the wrapper tools is missing[^\n]*installing them again, once, and trying again\./);
  assert.match(r.targets[0].notes.join('\n'), /the wrapper tools were installed again first/);
  // An install that fails is every target's failure, in npm's words.
  rmSync(join(dir, 'node_modules'), { recursive: true });
  t = standIns({ npm: 'fails' });
  r = await standaloneBuild(root, 'gem', { ...base, platform: 'linux', env: {}, exec: t.exec, for: 'windows' });
  assert.deepEqual([r.ok, r.targets[0].state], [false, 'failed']);
  assert.match(r.why, /npm install of the wrapper tools failed: npm error network/);
  // installTools itself: nothing to do when the pins and the marker are there.
  const s = { dir, game: { id: 'gem' }, meta: standaloneMeta(readStudio(root), listGames(root)[0]), targets: ['linux'], platform: 'linux', env: {}, exec: standIns().exec };
  assert.deepEqual(await installTools(s), { ok: true, installed: true });
  assert.deepEqual(await installTools(s), { ok: true, installed: false });
  assert.deepEqual(await installTools(s, { again: true }), { ok: true, installed: true });
});

test('a release that could not be signed is said as UNSIGNED and is not ok; a debug build never takes a release\'s place', async () => {
  const root = studio('signing');
  const file = join(root, 'games', 'gem', 'game.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), name: 'Gem: Rush / 2', standalone: { appId: 'com.example.gem', version: '2.0.0', build: 5 } }, null, 2));
  assert.equal(JSON.parse(run(['build'], root).stdout).ok, true);
  const base = { home: join(scratch, 'nobody'), buildSite: false, platform: 'darwin', for: 'mac' };
  const dir = standaloneDir(root, 'gem');
  // A debug build first.
  let t = standIns();
  let r = await standaloneBuild(root, 'gem', { ...base, env: {}, exec: t.exec });
  assert.deepEqual([r.ok, r.targets[0].path], [true, join('out', 'mac', 'debug', 'Gem- Rush - 2.app')], 'the path is the file\'s real name, not the game\'s');
  assert.ok(existsSync(join(dir, r.targets[0].path)));
  assert.match(r.warnings.join('\n'), /The desktop app is the file "Gem- Rush - 2"/);
  // A release with no identity: built, UNSIGNED, not ok.
  t = standIns();
  r = await standaloneBuild(root, 'gem', { ...base, release: true, env: {}, exec: t.exec });
  assert.deepEqual([r.ok, r.targets[0].state, r.targets[0].unsigned, r.unsigned], [false, 'built', true, ['mac']]);
  assert.match(r.why, /built UNSIGNED, which no store takes: mac/);
  assert.match(standaloneLines(r).join('\n'), /! mac {6}BUILT, UNSIGNED \(no store takes it\): out\/mac\/release\/Gem- Rush - 2\.app/);
  assert.deepEqual(t.packs()[0].args.slice(1), ['darwin', 'universal', 'release']);
  // The debug copy is still there beside it, and built.json keeps each under its own numbers.
  assert.ok(existsSync(join(dir, 'out', 'mac', 'debug', 'Gem- Rush - 2.app')) && existsSync(join(dir, 'out', 'mac', 'release', 'Gem- Rush - 2.app')));
  let record = JSON.parse(readFileSync(join(dir, 'built.json'), 'utf8')).targets.mac;
  assert.deepEqual([record.debug.build, record.release.build, record.release.unsigned], [5, 5, true]);
  r = await standaloneBuild(root, 'gem', { ...base, build: 9, env: {}, exec: standIns().exec });
  record = JSON.parse(readFileSync(join(dir, 'built.json'), 'utf8')).targets.mac;
  assert.deepEqual([record.debug.build, record.release.build], [9, 5], 'a later debug build does not rewrite what the release was');
  assert.ok(existsSync(join(dir, 'out', 'mac', 'release', 'Gem- Rush - 2.app')), 'and does not delete it');
  // Signed but not notarized, the signature that does not verify, an ad hoc one: each said as what it is, none ok.
  for (const [env, plan, words] of [
    [{ HOMIE_APPLE_IDENTITY: 'Developer ID Application: X' }, {}, /signed \(codesign verifies it\), NOT NOTARIZED/],
    [{ HOMIE_APPLE_IDENTITY: 'Developer ID Application: X', HOMIE_APPLE_NOTARY_PROFILE: 'p' }, {}, /NOT CONFIRMED NOTARIZED: stapler does not validate/],
    [{ HOMIE_APPLE_IDENTITY: 'Developer ID Application: X' }, { signature: 'bad' }, /UNSIGNED: the signer ran and codesign does not verify the app \(code object is not signed at all\)/],
    [{ HOMIE_APPLE_IDENTITY: '-' }, {}, /signed AD HOC[^\n]*Not a release/],
  ]) {
    r = await standaloneBuild(root, 'gem', { ...base, release: true, env, exec: standIns(plan).exec });
    assert.deepEqual([r.ok, r.targets[0].unsigned], [false, true], String(words));
    assert.match(r.targets[0].notes.join('\n'), words);
  }
  // Signed, and stapler confirms the ticket: ok, in words that say what was and was not looked at.
  t = standIns({ stapled: true });
  r = await standaloneBuild(root, 'gem', { ...base, release: true, env: { HOMIE_APPLE_IDENTITY: 'Developer ID Application: X', HOMIE_APPLE_NOTARY_PROFILE: 'p', HOMIE_APPLE_TEAM: 'T', HOMIE_ANDROID_KEYSTORE_PASSWORD: 'never-here' }, exec: t.exec });
  assert.deepEqual([r.ok, r.unsigned], [true, []]);
  assert.match(r.targets[0].notes.join('\n'), /signed and notarized: codesign verifies the signature and stapler validates the ticket \(opening it on another Mac was not tried\)/);
  // The signing values reach the one child that signs, and no other: not npm, not the started app.
  const pack = t.packs()[0];
  assert.deepEqual([pack.env.HOMIE_APPLE_IDENTITY, pack.env.HOMIE_APPLE_NOTARY_PROFILE, pack.env.HOMIE_APPLE_TEAM, pack.env.HOMIE_ANDROID_KEYSTORE_PASSWORD], ['Developer ID Application: X', 'p', undefined, undefined]);
  for (const c of t.calls.filter((x) => x !== pack && x.env)) assert.deepEqual(Object.keys(c.env).filter((k) => /^HOMIE_(APPLE|ANDROID)_/.test(k)), [], `${c.cmd} ${String(c.args[0]).slice(-20)} is given no signing value`);
  assert.deepEqual(toolEnv({ PATH: '/bin', HOMIE_APPLE_TEAM: 'T', HOMIE_ANDROID_KEY_ALIAS: 'a', HOMIE_STANDALONE_SITE: 's' }, ['HOMIE_APPLE_TEAM']), { PATH: '/bin', HOMIE_APPLE_TEAM: 'T', HOMIE_STANDALONE_SITE: 's' });
  // A debug build is never given them at all.
  t = standIns();
  await standaloneBuild(root, 'gem', { ...base, env: { HOMIE_APPLE_IDENTITY: 'Developer ID Application: X' }, exec: t.exec });
  assert.equal(t.packs()[0].env.HOMIE_APPLE_IDENTITY, undefined);
  // What the command hands a chat tool that runs it as a job: the words for the person, inside the result itself.
  t = standIns();
  const told = await standaloneCommand(root, 'build', ['standalone', 'build', 'gem'], new Map([['for', 'mac,ios']]), { on: { home: base.home, buildSite: false, platform: 'darwin', env: {}, exec: t.exec } });
  assert.equal(told.ok, false);
  assert.deepEqual(told.say.slice(0, 2), ['Gem: Rush / 2 2.0.0 build 5, com.example.gem: in .studio/standalone/gem/', '  ✓ mac      out/mac/debug/Gem- Rush - 2.app']);
  assert.match(told.say.join('\n'), /○ ios {6}SKIPPED: Xcode is not ready for iOS/);
  assert.match(told.say.join('\n'), /What the standalone game does not have \(v1\):\n {2}- Player accounts and sign-in: /);
  assert.match(told.say.join('\n'), /NOT DONE: not built: ios/);
  assert.equal(told.say.at(-1), SAY_MISSING);
});

test('a tool that runs out of time is ended with everything it started, not left running behind the command', { skip: process.platform === 'win32' }, async () => {
  // A shell that starts a child of its own and waits for it, as Gradle and xcodebuild start theirs.
  const r = await runTool('sh', ['-c', 'sleep 60 & echo $!; wait'], { timeout: 400 });
  assert.equal(r.code, 124);
  const child = Number(r.stdout.trim());
  assert.ok(child > 1);
  await new Promise((res) => setTimeout(res, 200));
  assert.throws(() => process.kill(child, 0), /ESRCH/, 'the child of the tool is gone too');
  // A tool that is not installed, and one that ends by itself, are told apart from one that ran out of time.
  assert.equal((await runTool('no-such-program-anywhere', [])).code, 127);
  assert.deepEqual(await runTool(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)']), { code: 3, stdout: 'hi', stderr: '' });
});

/* ------------------------------------------------------------------ onto a real phone, with every tool a stand-in */

/**
 * A Mac with Xcode, a keychain and (maybe) a phone, as stand-ins. `world` says what is plugged in and how each tool
 * answers; `calls` is every command asked for. The ids are made up, and none may appear in anything a person is told.
 */
const UDID = 'MADE-UP-PHONE-NUMBER';
const CORE = 'MADE-UP-PHONE-HANDLE';
const TEAM = 'TEAMTEAM01';
const phoneOf = (o = {}) => ({ identifier: o.id ?? CORE, hardwareProperties: { udid: o.udid ?? UDID, marketingName: o.model ?? 'iPhone 14 Pro Max', deviceType: o.type ?? 'iPhone', platform: 'iOS', reality: o.reality ?? 'physical' }, connectionProperties: { pairingState: o.trusted === false ? 'unpaired' : 'paired', tunnelState: o.here === false ? 'unavailable' : 'disconnected' }, deviceProperties: { developerModeStatus: o.developerMode === false ? 'disabled' : 'enabled' } });
function macWith(world = {}) {
  const calls = [];
  const at = { unlockAsks: 0 };
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env ?? null });
    const out = (stdout = '', code = 0, stderr = '') => ({ code, stdout, stderr });
    const json = (o, code = 0, stderr = '') => { const f = args[args.indexOf('--json-output') + 1]; if (o) writeFileSync(f, JSON.stringify(o)); return out('', code, stderr); };
    if (cmd === 'xcodebuild' && args[0] === '-version') return out('Xcode 26.3\nBuild version 17C529\n');
    if (cmd === 'xcodebuild' && args[0] === '-showsdks') return out('\tiOS 26.2 -sdk iphoneos26.2\n\tSimulator - iOS 26.2 -sdk iphonesimulator26.2\n');
    if (cmd === 'security' && args[0] === 'find-identity') return world.identities === 'fails' ? out('', 1) : out(world.identities ?? '     0 valid identities found\n');
    if (cmd === 'security' && args[0] === 'find-certificate') return out(world.certificates ?? '');
    if (cmd === 'xcrun' && args[1] === 'list') return world.devices === 'fails' ? out('', 1, 'devicectl: no service') : json({ result: { devices: world.devices ?? [phoneOf()] } });
    if (/npm(\.cmd)?$/.test(cmd) && args[0] === 'install') {
      const pkg = JSON.parse(readFileSync(join(opts.cwd, 'package.json'), 'utf8'));
      for (const name of Object.keys(pkg.devDependencies ?? {})) { mkdirSync(join(opts.cwd, 'node_modules', ...name.split('/')), { recursive: true }); writeFileSync(join(opts.cwd, 'node_modules', ...name.split('/'), 'package.json'), '{}'); }
      writeFileSync(join(opts.cwd, 'node_modules', '.package-lock.json'), '{}');
      return out('added');
    }
    if (String(args[0]).endsWith('capacitor') && args[1] === 'add') { mkdirSync(join(opts.cwd, 'ios', 'App', 'App.xcodeproj'), { recursive: true }); mkdirSync(join(opts.cwd, 'ios', 'App', 'App'), { recursive: true }); writeFileSync(join(opts.cwd, 'ios', 'App', 'App', 'Info.plist'), '<dict></dict>'); return out('added'); }
    if (String(args[0]).endsWith('capacitor') || String(args[0]).endsWith('capacitor-assets')) return out('ok');
    if (cmd === 'xcodebuild' && args.includes('build')) {
      if (world.build) return out('', 70, world.build);
      const derived = args[args.indexOf('-derivedDataPath') + 1];
      mkdirSync(join(derived, 'Build', 'Products', 'Debug-iphoneos', 'App.app'), { recursive: true });
      return out('** BUILD SUCCEEDED **');
    }
    if (cmd === 'xcrun' && args[2] === 'install') return world.install ? json(null, 1, world.install) : json({ result: { installedApplications: [{ bundleID: 'com.example.gem', installationURL: 'file:///private/var/containers/Bundle/Application/1111/App.app/' }] } });
    if (cmd === 'xcrun' && args[2] === 'info' && args[3] === 'apps') return json({ result: { apps: world.listed === false ? [] : [{ bundleIdentifier: 'com.other.game', url: 'file:///private/var/containers/Bundle/Application/9999/App.app/' }, { bundleIdentifier: 'com.example.gem', url: 'file:///private/var/containers/Bundle/Application/1111/App.app/' }] } });
    if (cmd === 'xcrun' && args[3] === 'lockState') { at.unlockAsks += 1; return json({ result: { passcodeRequired: world.locked === true || (typeof world.locked === 'number' && at.unlockAsks <= world.locked) } }); }
    if (cmd === 'xcrun' && args[2] === 'process') return world.launch ? json(null, 1, world.launch) : json({ result: { process: { processIdentifier: 4242 } } });
    if (cmd === 'xcrun' && args[3] === 'processes') return world.processes === 'fails' ? out('', 1) : json({ result: { runningProcesses: world.processes ?? [{ processIdentifier: 77, executable: 'file:///private/var/containers/Bundle/Application/9999/App.app/App' }, { processIdentifier: 4242, executable: 'file:///private/var/containers/Bundle/Application/1111/App.app/App' }] } });
    return out('', 127);
  };
  return { exec, calls, did: (what) => calls.filter((c) => c.args.join(' ').includes(what)).length };
}

test('onto a real phone: built, signed for the team, installed, started, and LOOKED FOR among what the phone is running', async () => {
  const root = studio('phone');
  const file = join(root, 'games', 'gem', 'game.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), standalone: { appId: 'com.example.gem' } }, null, 2));
  assert.equal(JSON.parse(run(['build'], root).stdout).ok, true);
  const base = { home: join(scratch, 'nobody'), buildSite: false, platform: 'darwin', for: 'ios', device: true, wait: async () => {}, unlockMs: 9000 };
  const said = [];
  let mac = macWith();
  let r = await standaloneRun(root, 'gem', { ...base, env: { HOMIE_APPLE_TEAM: TEAM, HOMIE_ANDROID_KEYSTORE_PASSWORD: 'never-here' }, exec: mac.exec, log: (l) => said.push(l) });
  assert.deepEqual([r.ok, r.command, r.stage, r.device, r.built, r.installed, r.running], [true, 'standalone run', 'started', true, true, true, true]);
  assert.deepEqual([r.phone, r.team, r.adds], [{ model: 'iPhone 14 Pro Max' }, { from: 'HOMIE_APPLE_TEAM' }, DEVICE_ADDS]);
  // What it changes outside this computer is said BEFORE the build that does it, in the same words as the result.
  assert.ok(said.indexOf(DEVICE_ADDS) >= 0 && said.indexOf(DEVICE_ADDS) < said.findIndex((l) => /^xcodebuild: a Debug build for the phone/.test(l)));
  assert.match(DEVICE_ADDS, /^This adds the phone to your Apple team's list of development devices/);
  // The build is for that phone, signed by Xcode for that team, and may register the phone.
  const build = mac.calls.find((c) => c.cmd === 'xcodebuild' && c.args.includes('build')).args;
  for (const word of ['-destination', `id=${UDID}`, `DEVELOPMENT_TEAM=${TEAM}`, 'CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', '-configuration', 'Debug']) assert.ok(build.includes(word), word);
  // Installed and started on the phone by its id, and then read back: the process it started, where the phone put the app.
  assert.deepEqual([mac.did(`install app --device ${CORE}`), mac.did(`process launch --device ${CORE} --terminate-existing com.example.gem`), mac.did(`info processes --device ${CORE}`)], [1, 1, 1]);
  // Nothing a person is told carries the phone's id, the team's id, or anything of the signing environment.
  const told = JSON.stringify([r, said, standaloneLines(r)]);
  for (const secret of [UDID, CORE, TEAM, 'never-here']) assert.equal(told.includes(secret), false, secret);
  for (const c of mac.calls.filter((x) => x.env)) assert.deepEqual(Object.keys(c.env).filter((k) => /^HOMIE_(APPLE|ANDROID)_/.test(k)), [], 'no tool is given a signing value: the team goes to xcodebuild as its own setting');
  const lines = standaloneLines(r).join('\n');
  assert.match(lines, /^Gem Rush is on the iPhone 14 Pro Max and running: it was built, installed over the cable, started, and then found among the phone's running programs\./);
  assert.match(lines, /Signed for the team HOMIE_APPLE_TEAM names, as com\.example\.gem\./);
  assert.match(lines, /This adds the phone to your Apple team's list of development devices/);
  assert.match(lines, /it stops opening when its profile ends/);
  // Another game's program of the same name is running, and ours is not: never "running".
  mac = macWith({ processes: [{ processIdentifier: 77, executable: 'file:///private/var/containers/Bundle/Application/9999/App.app/App' }] });
  r = await standaloneRun(root, 'gem', { ...base, env: { HOMIE_APPLE_TEAM: TEAM }, exec: mac.exec });
  assert.deepEqual([r.ok, r.stage, r.installed], [false, 'not-running', true]);
  assert.match(standaloneLines(r).join('\n'), /NOT on the iPhone 14 Pro Max: the game was installed and started, and four seconds later it was not among the phone's running programs[\s\S]*The game IS installed on the iPhone 14 Pro Max; it was not seen running\./);
  mac = macWith({ processes: 'fails' });
  r = await standaloneRun(root, 'gem', { ...base, env: { HOMIE_APPLE_TEAM: TEAM }, exec: mac.exec });
  assert.deepEqual([r.ok, r.stage], [false, 'not-confirmed'], 'what could not be read back is never said as running');
  // A locked phone is waited for; unlocked in time, the game starts; still locked, it says so and that the game is installed.
  mac = macWith({ locked: 2 });
  said.length = 0;
  r = await standaloneRun(root, 'gem', { ...base, env: { HOMIE_APPLE_TEAM: TEAM }, exec: mac.exec, log: (l) => said.push(l) });
  assert.equal(r.ok, true);
  assert.match(said.join('\n'), /The iPhone 14 Pro Max is locked: unlock it now \(waiting up to a minute\)\./);
  mac = macWith({ locked: true, launch: 'Unable to launch com.example.gem because the device was not, or could not be, unlocked. BSErrorCodeDescription = Locked' });
  r = await standaloneRun(root, 'gem', { ...base, env: { HOMIE_APPLE_TEAM: TEAM }, exec: mac.exec });
  assert.deepEqual([r.ok, r.stage, r.installed, r.fix], [false, 'locked', true, 'Unlock the phone and tap Gem Rush on its home screen.']);
  // The phone says it took the app, and its own list of apps does not have it.
  r = await standaloneRun(root, 'gem', { ...base, env: { HOMIE_APPLE_TEAM: TEAM }, exec: macWith({ listed: false }).exec });
  assert.deepEqual([r.ok, r.stage], [false, 'install-failed']);
  r = await standaloneRun(root, 'gem', { ...base, env: { HOMIE_APPLE_TEAM: TEAM }, exec: macWith({ install: `ERROR: The device ${CORE} refused` }).exec });
  assert.deepEqual([r.ok, r.stage, r.built], [false, 'install-failed', true]);
  assert.equal(JSON.stringify(r).includes(CORE), false, 'a tool\'s own words are said with the phone\'s id taken out');
});

test('onto a real phone: every way it stops is an answer with what to do, and nothing is built for a phone that is not ready', async () => {
  const root = studio('phone-stops');
  assert.equal(JSON.parse(run(['build'], root).stdout).ok, true);
  const base = { home: join(scratch, 'nobody'), buildSite: false, platform: 'darwin', for: 'ios', device: true, wait: async () => {}, env: { HOMIE_APPLE_TEAM: TEAM } };
  const stops = async (world, extra = {}) => { const mac = macWith(world); const r = await standaloneRun(root, 'gem', { ...base, ...extra, exec: mac.exec }); return { r, mac, lines: standaloneLines(r).join('\n') }; };
  // No phone; a phone this Mac knows that is not here; several.
  let x = await stops({ devices: [] });
  assert.deepEqual([x.r.ok, x.r.command, x.r.stage, x.r.device], [false, 'standalone run', 'no-phone', true]);
  assert.match(x.lines, /^NOT on a phone: no iPhone or iPad is connected to this Mac\.\n {2}Plug the phone in with a cable, unlock it, and tap Trust/);
  assert.equal(x.mac.did('build'), 0, 'nothing was built');
  x = await stops({ devices: [phoneOf({ here: false }), phoneOf({ reality: 'simulated', id: 'SIM' }), phoneOf({ type: 'appleWatch', id: 'W' })] });
  assert.equal(x.r.stage, 'no-phone');
  assert.match(x.r.why, /no iPhone or iPad is connected now \(this Mac knows 1: iPhone 14 Pro Max\)/);
  x = await stops({ devices: [phoneOf(), phoneOf({ id: 'B', udid: 'U2', model: 'iPad Air', type: 'iPad' })] });
  assert.deepEqual([x.r.stage, x.r.phones], ['several', [{ model: 'iPhone 14 Pro Max' }, { model: 'iPad Air' }]]);
  assert.match(x.lines, /2 phones are connected \(iPhone 14 Pro Max, iPad Air\), and this puts the game on one\.\n {2}Unplug all but the one/);
  // Developer Mode off: the exact path in Settings, and that the phone restarts. Not trusted. Neither is built for.
  x = await stops({ devices: [phoneOf({ developerMode: false })] });
  assert.equal(x.r.stage, 'developer-mode');
  assert.match(x.lines, /Developer Mode is off on the iPhone 14 Pro Max[\s\S]*On the phone: Settings, Privacy & Security, Developer Mode, turn it on\. The phone restarts/);
  assert.equal(x.mac.did('build'), 0);
  x = await stops({ devices: [phoneOf({ trusted: false })] });
  assert.equal(x.r.stage, 'not-trusted');
  assert.match(x.lines, /does not trust this Mac yet\.\n {2}Unlock the phone, plug it in and tap Trust/);
  x = await stops({ devices: 'fails' });
  assert.deepEqual([x.r.stage, /could not look for a phone: Xcode's device list did not answer/.test(x.r.why)], ['could-not-check', true], 'a list that could not be read is not "no phone"');
  // The team: none, several, or not a team id. Refused before anything is built or registered.
  x = await stops({ identities: '     0 valid identities found\n' }, { env: {} });
  assert.equal(x.r.stage, 'no-team');
  assert.match(x.lines, /no Apple team to sign for: the keychain has no Apple Development identity[\s\S]*Put your team id in HOMIE_APPLE_TEAM[\s\S]*never in the chat/);
  assert.equal(x.mac.did('build'), 0);
  assert.equal((await stops({}, { env: { HOMIE_APPLE_TEAM: 'my team' } })).r.stage, 'no-team');
  assert.equal((await stops({ identities: 'fails' }, { env: {} })).r.why.includes('could not check the keychain'), true);
  // What xcodebuild and the phone said on the day, each as what it means: Developer Mode, no account, no devices, a timeout.
  for (const [text, stage, words] of [
    ['xcodebuild: error: Timed out waiting for all destinations matching the provided destination specifier to become available\n{ platform:iOS, error:Developer Mode disabled To use the phone for development, enable Developer Mode in Settings → Privacy & Security. }', 'developer-mode', /Settings, Privacy & Security, Developer Mode/],
    ['error: No Accounts: Add a new account in Accounts settings. (in target \'App\' from project \'App\')', 'no-account', /Xcode is not signed in to an Apple account of that team[\s\S]*Open Xcode, Settings, Accounts/],
    ['error: Communication with Apple failed: Your team has no devices from which to generate a provisioning profile.\nerror: No profiles for \'com.example.gem\' were found', 'no-devices', /your Apple team has no registered phone/],
    ['xcodebuild: error: Timed out waiting for all destinations matching the provided destination specifier to become available', 'not-ready', /Xcode waited for the phone and it never became ready[\s\S]*Unlock the phone/],
    ['error: The device is passcode locked. Unlock it to Continue', 'locked', /the phone is locked\.\n {2}Unlock the phone/],
    [`error: something new about ${UDID} and team ${TEAM}\n** BUILD FAILED **`, 'build-failed', /xcodebuild did not finish: error: something new about <the phone> and team <your team>/],
  ]) {
    x = await stops({ build: text });
    assert.deepEqual([x.r.ok, x.r.stage], [false, stage], text.slice(0, 40));
    assert.match(x.lines, words);
    assert.equal(JSON.stringify(x.r).includes(UDID) || JSON.stringify(x.r).includes(TEAM), false);
  }
  assert.equal(deviceTrouble('all is well'), null);
  // Not this command's to do: a Mac is needed; Android has no such run yet; a desktop target is not a phone.
  assert.match((await standaloneRun(root, 'gem', { ...base, platform: 'linux', exec: nothing })).why, /a game goes onto an iPhone from a Mac with Xcode/);
  assert.match((await standaloneRun(root, 'gem', { ...base, for: 'android', exec: nothing })).why, /--device is for an iPhone or iPad in this version[\s\S]*never on a real Android phone/);
  assert.match((await standaloneRun(root, 'gem', { ...base, for: 'mac', exec: nothing })).why, /A mac build runs on a computer/);
  // Through the command: --device is a word the command knows, and a flag it does not know stops it before anything.
  const refused = JSON.parse(run(['standalone', 'run', 'gem', '--for', 'ios', '--device', '--made-up'], root).stdout);
  assert.deepEqual([refused.ok, refused.command, refused.needs], [false, 'standalone run', 'flag']);
  assert.match(refused.why, /does not take --made-up, so it did not run/);
  const viaCommand = await standaloneCommand(root, 'run', ['standalone', 'run', 'gem'], new Map([['for', 'ios'], ['device', true]]), { on: { ...base, exec: macWith({ devices: [] }).exec } });
  assert.deepEqual([viaCommand.stage, viaCommand.say[0]], ['no-phone', 'NOT on a phone: no iPhone or iPad is connected to this Mac.'], 'the words for the person ride in the result');
});

test('the Apple team is the one HOMIE_APPLE_TEAM names, else the keychain\'s only one, read from the certificate and never from a name', async (t) => {
  assert.deepEqual(await appleTeam({ env: { HOMIE_APPLE_TEAM: TEAM }, exec: nothing }), { team: TEAM, from: 'HOMIE_APPLE_TEAM' });
  assert.equal((await appleTeam({ env: { HOMIE_APPLE_TEAM: 'lowercase1' }, exec: nothing })).team, null);
  // A certificate of our own making, as a development identity's is shaped: a person's id in its name, the team in its OU.
  const dir = join(scratch, 'certs');
  mkdirSync(dir, { recursive: true });
  const make = (name, ou) => { const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=Apple Development: Somebody (PERSONID01)/OU=${ou}/O=Somebody`, '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.pem`)], { encoding: 'utf8' }); return r.status === 0 ? readFileSync(join(dir, `${name}.pem`), 'utf8') : null; };
  const one = make('one', TEAM);
  if (!one) { t.diagnostic('openssl is not on this computer: the keychain reading was not run'); return; }
  const { X509Certificate } = await import('node:crypto');
  const hash = (pem) => new X509Certificate(pem).fingerprint.replace(/:/g, '');
  const keychain = (pems, listed = pems) => async (cmd, args) => (args[0] === 'find-identity' ? { code: 0, stdout: `${listed.map((p, i) => `  ${i + 1}) ${hash(p)} "Apple Development: Somebody (PERSONID01)"`).join('\n')}\n     ${listed.length} valid identities found\n`, stderr: '' } : { code: 0, stdout: pems.join('\n'), stderr: '' });
  const found = await appleTeam({ env: {}, exec: keychain([one]) });
  assert.deepEqual(found, { team: TEAM, from: 'the one Apple team among the keychain\'s development identities' }, 'the OU of the certificate, not the id in the identity\'s name');
  const two = make('two', 'OTHERTEAM2');
  const several = await appleTeam({ env: {}, exec: keychain([one, two]) });
  assert.deepEqual([several.team, several.teams], [null, 2]);
  assert.match(several.why, /development identities of 2 Apple teams, and which one is yours to say/);
  // A certificate in the keychain that is not one of the identities (no key of ours) is nobody's team.
  assert.equal((await appleTeam({ env: {}, exec: keychain([one, two], [one]) })).team, TEAM);
});

test('the phone row: what is connected by model and its Developer Mode, or "could not check"', async () => {
  const mac = (world) => standaloneRows({ platform: 'darwin', env: {}, home: join(scratch, 'nobody'), exec: macWith(world).exec });
  const row = (rows) => rows.find((r) => r.id === 'standalone-phone');
  assert.deepEqual((await mac({})).map((r) => r.id), MAC_ROWS);
  assert.deepEqual([row(await mac({})).state, row(await mac({})).detail, row(await mac({})).fix], ['ok', 'connected: iPhone 14 Pro Max, Developer Mode on', null]);
  assert.match(row(await mac({})).unlocks, /it adds the phone to your Apple team's device list/);
  let r = row(await mac({ devices: [phoneOf({ developerMode: false })] }));
  assert.deepEqual([r.state, r.detail], ['optional', 'connected: iPhone 14 Pro Max, Developer Mode OFF']);
  assert.match(r.fix.say, /Settings, Privacy & Security, Developer Mode/);
  r = row(await mac({ devices: [] }));
  assert.deepEqual([r.state, r.detail], ['optional', 'no iPhone or iPad is connected now']);
  r = row(await mac({ devices: 'fails' }));
  assert.equal(r.state, 'unknown');
  assert.match(r.detail, /^could not check \(Xcode's device list did not answer/);
  assert.equal(row(await mac({ devices: [phoneOf(), phoneOf({ id: 'B', model: 'iPad Air', type: 'iPad' })] })).state, 'optional', 'two phones are not one to run on');
  assert.equal(JSON.stringify(await mac({})).includes(UDID) || JSON.stringify(await mac({})).includes(CORE), false, 'by model, never by id');
  // Not a Mac: no such row. The list of phones itself: only real iPhones and iPads.
  assert.deepEqual((await standaloneRows(bare)).map((x) => x.id), ROWS);
  assert.deepEqual((await phones({ env: {}, exec: macWith({ devices: [phoneOf(), phoneOf({ reality: 'simulated' }), phoneOf({ type: 'appleTV' })] }).exec })).phones.length, 1);
});

test('the toolkit note compares the studio\'s pin with the version standalone arrived in, not with this toolkit', () => {
  const root = studio('pins');
  const pin = (v) => { const f = join(root, 'package.json'); const p = JSON.parse(readFileSync(f, 'utf8')); p.devDependencies['@homie-rocks/studio'] = v; writeFileSync(f, JSON.stringify(p, null, 2)); };
  pin('0.31.1');
  assert.match(toolkitNote(root), /pins @homie-rocks\/studio 0\.31\.1, from before standalone copies \(0\.32\.0\)[\s\S]*Quick play is OFFLINE until the studio is upgraded to 0\.32\.0 or later AND deployed again\. A room made or joined by its code still connects \(seen against 0\.31\.0, not promised for every older version\)/);
  // The guide says the same, and nowhere that a copy "needs 0.32.0 to find rooms".
  const guide = read('standalone', 'STANDALONE.md');
  assert.match(guide, /## Before Quick play can find a room/);
  assert.match(guide, /\*\*A room made or joined by its code does not need that\.\*\*[\s\S]*seen against a\nsite on 0\.31\.0; it is not promised for every older version/);
  assert.doesNotMatch(guide, /before a copy can find rooms/i);
  // What has been run on a real phone, with its day, and what still has not.
  assert.match(guide, /\*\*On a real iPhone \(2026-10-07\)\.\*\*/);
  assert.match(guide, /\*\*Online from that phone \(2026-10-07\)\.\*\*/);
  for (const never of ['Nothing has been started by Steam', 'A macOS app signed with a Developer ID, and notarization', 'The iOS archive and its `.ipa`', 'The GitHub workflow', 'The Windows and Linux builds have never been started', 'A real Android phone', 'Quick play online from a phone']) assert.ok(guide.includes(never), never);
  assert.match(guide, /\*\*`--device` is your yes to what this changes outside your computer:\*\* it adds the phone to your Apple team's\nlist of development devices/);
  pin('0.32.0');
  assert.equal(toolkitNote(root), null);
  // A studio on 0.32.0 is not "behind" for this, however new the toolkit that runs: only before-0.32.0 is.
  pin('0.32.5');
  assert.equal(toolkitNote(root), null);
  pin('file:../checkout');
  assert.equal(toolkitNote(root), null);
});

test('a release never guesses the app\'s id: it stops, with the exact lines to add to game.json', async () => {
  const root = studio('release');
  const refused = await standalonePlan(root, 'gem', { ...bare, release: true });
  assert.deepEqual([refused.ok, refused.needsField], [false, 'appId']);
  assert.match(refused.why, /a store never lets it change/);
  assert.match(refused.instead, /"appId": "rocks\.homie\.nightowls\.gem"/);
  const built = await standaloneBuild(root, 'gem', { ...bare, release: true });
  assert.deepEqual([built.ok, built.needs, built.command], [false, 'appId', 'standalone build']);
  assert.equal(existsSync(join(root, '.studio', 'standalone')), false, 'nothing was built or installed');
  // Through the command itself: exit 1, the same words.
  const cli = run(['standalone', 'build', 'gem', '--release'], root);
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stdout).needs, 'appId');
  // With the id written down, the plan is a release's.
  const file = join(root, 'games', 'gem', 'game.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), standalone: { appId: 'com.example.gem' } }, null, 2));
  const ok = JSON.parse(run(['standalone', 'plan', 'gem', '--release', '--for', 'windows,linux'], root).stdout);
  assert.deepEqual([ok.ok, ok.appId, ok.appIdFrom, ok.release], [true, 'com.example.gem', 'game.json', true]);
  assert.deepEqual(ok.targets.map((t) => t.target), ['windows', 'linux']);
  assert.ok(Array.isArray(ok.rows) && ok.rows.length === HERE_ROWS.length && ok.missing.length === MISSING.length);
  // The words for the person ride in the result, ending with what to do with the list.
  assert.match(ok.say.join('\n'), /What the standalone game does not have \(v1\):/);
  assert.equal(ok.say.at(-1), SAY_MISSING);
  // The plan in words, as a person reads it.
  const said = spawnSync(process.execPath, [CLI, 'standalone', 'plan', 'gem'], { cwd: root, encoding: 'utf8' });
  assert.match(said.stdout, /Gem Rush as a standalone game \(a build to try\): com\.example\.gem,/);
  assert.match(said.stdout, /What the standalone game does not have \(v1\):/);
  assert.equal(run(['standalone', 'fly', 'gem'], root).status, 1);
});

test('signing reads the environment only; a JDK that Gradle cannot run on is passed over, never tried', async () => {
  assert.deepEqual(androidSigning({}), { ok: false, set: 0 });
  assert.deepEqual(androidSigning({ HOMIE_ANDROID_KEYSTORE: '/k', HOMIE_ANDROID_KEY_ALIAS: 'a' }), { ok: false, set: 2 });
  const s = androidSigning({ HOMIE_ANDROID_KEYSTORE: '/k', HOMIE_ANDROID_KEYSTORE_PASSWORD: 'p1', HOMIE_ANDROID_KEY_ALIAS: 'a', HOMIE_ANDROID_KEY_PASSWORD: 'p2' });
  assert.deepEqual(Object.keys(s.env), ['ORG_GRADLE_PROJECT_android.injected.signing.store.file', 'ORG_GRADLE_PROJECT_android.injected.signing.store.password', 'ORG_GRADLE_PROJECT_android.injected.signing.key.alias', 'ORG_GRADLE_PROJECT_android.injected.signing.key.password']);
  // The build's source never puts a password in an argument, never says one, and never leaves Gradle running.
  const src = read('lib', 'standalone.mjs');
  assert.doesNotMatch(src, /-Pandroid\.injected/);
  assert.doesNotMatch(src, /say\([^)]*PASSWORD/);
  assert.match(src, /gradlew'\), \['--stop'\]/);
  assert.deepEqual([20, 21, 24, 25].map(JDK_FITS), [false, true, true, false]);
  const home = join(scratch, 'jdk');
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '');
  const java = (version) => async (cmd) => ({ code: 0, stdout: '', stderr: `openjdk version "${cmd === 'java' ? version.path : version.home}" 2026-01-20\n` });
  const picked = await findJdk({ env: { JAVA_HOME: home }, platform: 'linux', exec: java({ home: '25.0.2', path: '21.0.5' }) });
  assert.deepEqual([picked.home, picked.major, picked.from, picked.seen], [null, 21, 'java on the PATH', [{ from: 'JAVA_HOME', major: 25 }, { from: 'java on the PATH', major: 21 }]]);
  const none = await findJdk({ env: {}, platform: 'linux', exec: java({ home: '', path: '25.0.2' }) });
  assert.deepEqual([none.major, none.seen], [null, [{ from: 'java on the PATH', major: 25 }]]);
  const rows = await standaloneRows({ ...bare, exec: async (cmd) => (cmd === 'java' ? { code: 0, stdout: '', stderr: 'java version "25.0.2"' } : { code: 127, stdout: '', stderr: '' }) });
  assert.match(rows.find((r) => r.id === 'standalone-jdk').detail, /java on the PATH is 25: Android's build needs JDK 21/);
});

test('Steam\'s file and the workflow are written where they belong; an upload is only ever a line to run', async () => {
  const root = studio('steam');
  const before = standaloneSteam(root, 'gem');
  assert.deepEqual([before.ok, before.needs], [false, 'steam']);
  assert.match(before.instead, /Create the app: it gets an App ID/);
  assert.match(before.instead, /launch options, one for each operating system: gem\.exe \(Windows\), Gem Rush\.app \(macOS\), gem \(Linux\)/);
  assert.match(before.instead, /For the Linux one, put --no-sandbox in its Arguments/);
  assert.equal(existsSync(join(standaloneDir(root, 'gem'), 'steam')), false);
  const file = join(root, 'games', 'gem', 'game.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), name: 'Gem: Rush / 2', standalone: { steam: { app: 480, depots: { windows: 481, mac: 482, linux: 483 } } } }, null, 2));
  const r = standaloneSteam(root, 'gem');
  assert.equal(r.ok, true);
  assert.deepEqual(r.wrote, ['app_build.vdf']);
  assert.deepEqual(r.launch, { windows: 'gem.exe', mac: 'Gem- Rush - 2.app', linux: 'gem' }, 'the launch option is the file the build makes, not the game\'s name');
  assert.deepEqual(r.unbuilt, ['mac', 'windows', 'linux'], 'a depot of a release that was never built is said');
  assert.match(r.upload, /^steamcmd \+login <your Steam account> \+run_app_build ".*app_build\.vdf" \+quit$/);
  assert.match(r.note, /Nothing was uploaded, and this file has never been run through steamcmd/);
  assert.match(readFileSync(join(root, r.dir, 'app_build.vdf'), 'utf8'), /"LocalPath" "mac\/release\/\*"/);
  assert.match(standaloneLines(r).join('\n'), /NO RELEASE BUILD YET for mac, windows, linux[^\n]*--release/);
  const ci = standaloneCi(root, 'gem');
  assert.deepEqual([ci.ok, ci.file, ci.changed], [true, join('.github', 'workflows', 'standalone.yml'), true]);
  assert.equal(standaloneCi(root, 'gem').changed, false);
  assert.match(readFileSync(join(root, ci.file), 'utf8'), /default: gem\n/);
  assert.match(ci.next.join('\n'), /has not been run by the people who wrote the command/);
  // With a "standalone" block, the setup status carries the rows; without one it does not.
  const status = JSON.parse(run(['setup', 'status', '--connector', 'no'], root).stdout);
  assert.deepEqual(status.rows.filter((x) => String(x.id).startsWith('standalone-')).map((x) => x.id), HERE_ROWS);
  assert.equal(JSON.parse(run(['setup', 'status', '--connector', 'no'], studio('plain')).stdout).rows.some((x) => String(x.id).startsWith('standalone-')), false);
  assert.equal(statSync(join(root, '.github', 'workflows', 'standalone.yml')).isFile(), true);
});

test('a deploy says what it means for the copies already built: only when the game\'s revision is no longer theirs', async () => {
  const root = studio('deploy');
  assert.deepEqual(standaloneDeployNotes(root), [], 'nothing was ever built');
  const dir = standaloneDir(root, 'gem');
  mkdirSync(dir, { recursive: true });
  const entry = (o) => ({ version: '1.2.0', build: 4, netplayVersion: null, at: '2026-10-06T00:00:00.000Z', toolkit: '0.32.0', path: 'out/mac/release/Gem Rush.app', ...o });
  const built = (targets) => writeFileSync(join(dir, 'built.json'), JSON.stringify({ v: 2, game: 'gem', name: 'Gem Rush', targets }));
  const setVersion = (v) => { const f = join(root, 'games', 'gem', 'game.json'); const g = JSON.parse(readFileSync(f, 'utf8')); g.netplay = { ...g.netplay, version: v }; writeFileSync(f, JSON.stringify(g, null, 2)); };
  built({ mac: { release: entry({}) } });
  assert.deepEqual(standaloneDeployNotes(root), [], 'the game named no revision then and names none now');
  setVersion('B');
  built({ mac: { release: entry({ netplayVersion: 'A' }) }, windows: { release: entry({ netplayVersion: 'A' }) } });
  assert.deepEqual(standaloneDeployNotes(root), ['Standalone copies of Gem Rush (1.2.0 build 4) were made on netplay version "A"; this deploy makes "B" live. Copies already out keep playing offline and with each other, never with players on the new version, until you ship an update: homie-studio standalone build gem.']);
  built({ mac: { release: entry({ netplayVersion: 'B' }) } });
  assert.deepEqual(standaloneDeployNotes(root), []);
  built({});
  assert.deepEqual(standaloneDeployNotes(root), [], 'a build that made nothing shipped nothing');
  // Each copy under its own numbers: a debug copy on the new revision does not hide a release still on the old one.
  built({ mac: { debug: entry({ netplayVersion: 'B', build: 9, at: '2026-10-07T00:00:00.000Z' }), release: entry({ netplayVersion: 'A', build: 5 }) }, android: { release: entry({ netplayVersion: null, version: '1.0.0', build: 2 }) } });
  const notes = standaloneDeployNotes(root);
  assert.equal(notes.length, 2);
  assert.match(notes.join('\n'), /\(1\.2\.0 build 5\) were made on netplay version "A"; this deploy makes "B" live/);
  assert.match(notes.join('\n'), /\(1\.0\.0 build 2\) were made on netplay version none; this deploy makes "B" live/);
  // The deploy plan carries it, and prints it.
  built({ mac: { release: entry({ netplayVersion: 'A' }) } });
  const plan = JSON.parse(run(['deploy', '--plan'], root).stdout);
  assert.equal(plan.standalone.length, 1);
  assert.match(spawnSync(process.execPath, [CLI, 'deploy', '--plan'], { cwd: root, encoding: 'utf8' }).stdout, /Standalone copies of Gem Rush \(1\.2\.0 build 4\) were made on netplay version "A"; this deploy makes "B" live\./);
});

test('the lockfile this toolkit ships is the pinned tools\' own tree: every package at one version with its checksum', () => {
  const lock = JSON.parse(read('lib', 'standalone-lock.json'));
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[''].devDependencies, Object.fromEntries(Object.entries({ ...STANDALONE_PINS.desktop, ...STANDALONE_PINS.mobile }).sort(([a], [b]) => a.localeCompare(b))), 'made from the pins: run npm install --package-lock-only on them again when a pin moves');
  const packages = Object.entries(lock.packages).filter(([k]) => k);
  assert.ok(packages.length > 100);
  for (const [name, p] of packages) { assert.match(p.version, /^\d+\.\d+\.\d+/, name); assert.match(p.integrity ?? '', /^sha512-/, `${name} has its checksum`); assert.match(p.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, name); }
  for (const [name, v] of Object.entries({ ...STANDALONE_PINS.desktop, ...STANDALONE_PINS.mobile })) assert.equal(lock.packages[`node_modules/${name}`].version, v);
  // npm's notes about older packages (which carry their authors' addresses) are taken out: the tree is what is pinned.
  assert.equal(packages.some(([, p]) => 'deprecated' in p), false);
});

test('the icon: the game\'s own picture first, then its cover, then a letter; the plan says which', () => {
  const root = studio('icon');
  const game = () => listGames(root).find((g) => g.id === 'gem');
  const meta = () => standaloneMeta(readStudio(root), game());
  assert.equal(iconSource(root, game(), meta()).from, 'letter');
  assert.match(iconSource(root, game(), meta()).note, /A store wants a real icon: a square 1024×1024 PNG at games\/gem\/icon\.png/);
  const f = join(root, 'games', 'gem', 'game.json');
  const set = (patch) => writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), ...patch }, null, 2));
  mkdirSync(join(root, 'games', 'gem', 'public'), { recursive: true });
  writeFileSync(join(root, 'games', 'gem', 'public', 'cover.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"/>');
  set({ cover: 'cover.svg' });
  assert.equal(iconSource(root, game(), meta()).from, 'cover');
  writeFileSync(join(root, 'games', 'gem', 'icon.png'), '');
  assert.equal(iconSource(root, game(), meta()).from, 'icon.png');
  writeFileSync(join(root, 'games', 'gem', 'art.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>');
  set({ standalone: { icon: 'art.svg' } });
  assert.equal(iconSource(root, game(), meta()).from, 'standalone.icon');
  // A path that climbs out of the game's folder is not a picture of the game.
  set({ standalone: { icon: '../../studio.json' } });
  assert.equal(iconSource(root, game(), meta()).from, 'icon.png');
  assert.deepEqual(TARGETS, ['mac', 'windows', 'linux', 'ios', 'android']);
});


test('server rules refuse an older app before matching; browser rules retain matching by version', async () => {
  const server = await site({ room: { host: 'server', offline: true, contract: 2, build: '7' } });
  const old = await server.fetchSite('/cave-run/api/lobby?gv=6', { method: 'POST', headers: { origin: 'app://game' } });
  assert.equal(old.status, 409);
  assert.equal((await old.json()).error, 'stale');
  assert.equal(old.headers.get('access-control-allow-origin'), 'app://game');
  assert.equal(server.asked.length, 0, 'no old server room is allocated');
  assert.equal((await server.fetchSite('/cave-run/api/lobby?gv=7', { method: 'POST', headers: { origin: 'app://game' } })).status, 200);
  const browser = await site({ room: { host: 'browser', offline: true } });
  assert.equal((await browser.fetchSite('/cave-run/api/lobby?gv=6', { method: 'POST', headers: { origin: 'app://game' } })).status, 200);
  assert.equal(browser.asked.at(-1).searchParams.get('ver'), '6');
});

test('the app offers an update for old server rules and says when private rules need a connection', async () => {
  const old = await shell({ lobby: { ok: false, error: 'stale' }, app: { room: { host: 'server', offline: true } } });
  assert.equal(old.state.outdated, true);
  assert.equal(old.net().url, '');
  assert.match(old.el('[data-room-link]').textContent, /Update Gem Rush/);
  const privateGame = await shell({ lobby: null, app: { room: { host: 'server', offline: false } } });
  assert.equal(privateGame.el('[data-room-code]').textContent, 'Connection needed · Try again');
  assert.equal(privateGame.el('[data-offline]').hidden, true);
  assert.equal(privateGame.el('[data-notice-offline]').hidden, true);
  assert.equal(privateGame.el('[data-room-link]').textContent, 'This game needs a connection.');
});
