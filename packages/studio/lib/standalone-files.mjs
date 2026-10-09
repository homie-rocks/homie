/**
 * STANDALONE BUILDS, THE TEXT (standalone/STANDALONE.md): every file `homie-studio standalone` writes that is not a
 * copy of something, as a function of the studio and the game. Nothing here touches the disk, starts a program or
 * reads the environment, so a test can hold each one to what it says. lib/standalone.mjs writes them into
 * .studio/standalone/<id>/, which is made again on every build and never edited by hand.
 */
import { readFileSync } from 'node:fs';

/** The wrapper tools a standalone project installs, each at one exact version (lib/standalone-pins.json). */
export const STANDALONE_PINS = JSON.parse(readFileSync(new URL('./standalone-pins.json', import.meta.url), 'utf8'));

export const TARGETS = ['mac', 'windows', 'linux', 'ios', 'android'];
export const DESKTOP = ['mac', 'windows', 'linux'];
export const MOBILE = ['ios', 'android'];
export const ORIENTATIONS = ['any', 'landscape', 'portrait'];

/**
 * WHAT A STANDALONE COPY DOES NOT HAVE (v1). Said by `standalone plan` and `standalone build`, by the chat tool, by
 * the skill and by the changelog, in these words: a person who ships to a store must hear it before they do.
 */
export const MISSING = [
  { what: 'Player accounts and sign-in', why: 'the app has no sign-in and no name entry: a player is a guest with a two-word handle, and an account made on the studio\'s site is not known to the app' },
  { what: 'Cloud saves', why: 'saves and settings are kept on the device only (the saves helper\'s local mode). They do not follow a player to the site or to another device, and they are LOST when the app is uninstalled' },
  { what: 'The shop', why: 'nothing is sold in the app: no Stripe page, no purchases, no supporter badge. The app stores have their own rules for selling, and none of that is built' },
  { what: 'Room chat', why: 'chat is off in the app: it has no report or mute controls yet, and a chat without them is not shipped' },
  { what: 'Watching, the big screen and the owner\'s controls', why: 'no watch page, no television view, no office overlay: the app only plays' },
  { what: 'Servers and private doors', why: 'the app plays on the public server through an open door. A game that is private or invite-only, or a server behind an account or an invite, plays offline in the app' },
  { what: 'Automatic updates', why: 'the app is the build it was made from. A newer version reaches players only when you build again and ship the update through Steam or the store' },
  { what: 'Steam\'s overlay, achievements and friends', why: 'none of it has been run. The desktop app passes the switch the overlay needs when Steam starts it, but Electron apps often do not show Steam\'s overlay, and achievements, rich presence and friend invites are not wired' },
  { what: 'Uploading to a store, and a store\'s yes', why: 'builds are made on this computer and the upload steps are printed; nothing is sent to Steam, App Store Connect or Google Play for you. Each build is the kind of file a store accepts for upload: its review, its fees and its rules are the store\'s, and nothing here makes an app pass' },
  { what: 'A signed Windows build', why: 'the Windows build is unsigned in v1: opened outside Steam, Windows shows its unknown-publisher warning' },
];

/**
 * A name as a file's name on every system: none of < > : " / \\ | ? * or a control character, no run of dashes, no
 * dot or space at its end, 80 characters at most. The packager, the iOS copy, Steam's launch options and every path
 * this toolkit reports use this one, so what is said is where the file is.
 */
export function fileName(name, fallback = 'Game') {
  const t = String(name ?? '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/-{2,}/g, '-').replace(/^[-\s.]+|[-\s.]+$/g, '').slice(0, 80).replace(/[-\s.]+$/, '');
  return t || fallback;
}

const SEGMENT = (s) => { const t = String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); return t ? (/^[0-9]/.test(t) ? `g${t}` : t) : ''; };
/** A bundle id both stores allow: two to six segments of letters and digits, each starting with a letter. */
export const APP_ID = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*){1,5}$/;

/**
 * The app's id when game.json names none: the studio's own domain reversed (studio.json `cloudflare.domain`), else
 * `rocks.homie.<studio slug>`, then the game's id with its hyphens taken out (a `g` in front when it starts with a
 * digit). Good for a build to try; never for a store, where an id can never be changed: `--release` asks for one.
 */
export function appIdOf(studio, game) {
  let host = null;
  try { const d = String(studio?.cloudflare?.domain ?? '').trim(); if (d) host = new URL(/^[a-z]+:\/\//i.test(d) ? d : `https://${d}`).hostname; } catch { host = null; }
  const base = host && host.includes('.') ? host.split('.').reverse().map(SEGMENT).filter(Boolean) : ['rocks', 'homie', SEGMENT(studio?.slug ?? studio?.name) || 'studio'];
  return [...base, SEGMENT(game?.id) || 'game'].join('.');
}

/**
 * What the wrappers are told about one game: its name and id, the app's id and version, how it is held, and Steam's
 * numbers. `problems` are the values of game.json `standalone` that could not be used, each with what was used instead.
 */
export function standaloneMeta(studio, game, { build = null } = {}) {
  const s = game?.standalone && typeof game.standalone === 'object' && !Array.isArray(game.standalone) ? game.standalone : {};
  const problems = [];
  const said = typeof s.appId === 'string' && s.appId.trim() ? s.appId.trim() : null;
  if (said && !APP_ID.test(said)) problems.push(`"standalone.appId" ${JSON.stringify(said.slice(0, 60))} is not an app id both stores allow (letters and digits in two to six dotted parts, each starting with a letter, like com.example.gemrush)`);
  const appId = said && APP_ID.test(said) ? said : appIdOf(studio, game);
  let version = '1.0.0';
  if (s.version !== undefined) { if (/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(String(s.version))) version = String(s.version); else problems.push(`"standalone.version" ${JSON.stringify(String(s.version).slice(0, 24))} is not three numbers like 1.0.0; 1.0.0 is used`); }
  const whole = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 2_000_000_000 ? Number(v) : null);
  let buildNo = 1;
  if (s.build !== undefined) { if (whole(s.build)) buildNo = whole(s.build); else problems.push('"standalone.build" is a whole number from 1; 1 is used'); }
  if (build !== null && build !== undefined && build !== true) { if (whole(build)) buildNo = whole(build); else problems.push(`--build ${String(build).slice(0, 16)} is not a whole number from 1; ${buildNo} is used`); }
  let orientation = 'any';
  if (s.orientation !== undefined) { if (ORIENTATIONS.includes(s.orientation)) orientation = s.orientation; else problems.push(`"standalone.orientation" is one of ${ORIENTATIONS.join(', ')}; any is used`); }
  const st = s.steam && typeof s.steam === 'object' ? s.steam : {};
  const depots = Object.fromEntries(DESKTOP.map((os) => [os, whole(st.depots?.[os])]));
  const ver = typeof game?.netplay?.version === 'number' && Number.isFinite(game.netplay.version) ? String(game.netplay.version) : typeof game?.netplay?.version === 'string' ? game.netplay.version.trim() : '';
  return {
    id: String(game?.id ?? ''), name: String(game?.name ?? game?.id ?? 'Game'), publisher: String(studio?.name ?? ''),
    // The app's name as a file's name (fileName): "Gem: Rush / 2" is the file "Gem- Rush - 2".
    file: fileName(game?.name ?? game?.id, String(game?.id ?? 'Game')),
    appId, appIdFrom: said && APP_ID.test(said) ? 'game.json' : 'derived', version, build: buildNo, orientation,
    icon: typeof s.icon === 'string' && s.icon ? s.icon : null,
    steam: { app: whole(st.app), depots, api: st.api === true },
    netplayVersion: /^[A-Za-z0-9._-]{1,32}$/.test(ver) ? ver : null,
    problems,
  };
}

/** The exact lines to add to games/<id>/game.json before a release: the id is the one thing a store never lets change. */
export function standaloneBlock(meta) {
  return JSON.stringify({ standalone: { appId: meta.appId, version: meta.version, build: meta.build, orientation: meta.orientation } }, null, 2).split('\n').slice(1, -1).join('\n');
}

/** The wrapper project's package.json: only the tools the targets asked for, each pinned exactly. Never committed. */
export function projectPackage(meta, { targets = TARGETS } = {}) {
  const deps = {
    ...(targets.some((t) => DESKTOP.includes(t)) ? STANDALONE_PINS.desktop : {}),
    ...(targets.some((t) => MOBILE.includes(t)) ? STANDALONE_PINS.mobile : {}),
  };
  return { name: `${meta.id}-standalone`, private: true, version: meta.version, description: `Standalone builds of ${meta.name}. Made by homie-studio standalone; made again on every build.`, type: 'module', devDependencies: Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))) };
}

/** web/config.js: everything the shell knows about the game it frames. `site` '' is a copy that only plays offline. */
export function configScript(meta, { target, site = '', share, colours = null, movement = null, params = {}, room = null, kind = null }) {
  const cfg = { ...(kind === 'app' ? { kind: 'app' } : {}), v: 1, game: meta.id, name: meta.name, site: String(site ?? '').replace(/\/+$/, ''), ver: meta.netplayVersion ?? '', ...(movement ? { movement } : {}), params, share, colours, ...(room ? { room } : {}), version: meta.version, target };
  return `window.__HOMIE_APP = ${JSON.stringify(cfg, null, 2).replace(/</g, '\\u003c')};\n`;
}

/**
 * THE ONE CHANGE TO THE GAME'S OWN FILES: a script first in the head of its index.html that hands the helper the
 * shell's word (window.HOMIE_NET), as the site's Worker does when it serves the page. A copy, so the game never holds
 * the shell's own object. Every other file of the game is the web build's, byte for byte.
 */
export const NET_SCRIPT = '<script>try{var n=parent!==window&&parent.__HOMIE_APP_NET;if(n)window.HOMIE_NET=JSON.parse(JSON.stringify(n))}catch(e){}</script>';
const HEAD = /<head(\s[^>]*)?>/i;
export function withNetScript(html) {
  return HEAD.test(html) ? html.replace(HEAD, (tag) => `${tag}${NET_SCRIPT}`) : NET_SCRIPT + html;
}

/**
 * Whether a page's own Content-Security-Policy (a meta tag) would stop that script: a script-src (or, with none, a
 * default-src) that does not allow 'unsafe-inline'. The game then never hears the shell and plays offline, so a plan
 * says it. Null when the page has no such policy.
 */
export function cspBlocksInline(html) {
  for (const [tag] of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    if (!/http-equiv\s*=\s*["']?content-security-policy/i.test(tag)) continue;
    const policy = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const text = policy ? policy[1] ?? policy[2] ?? '' : '';
    const of = (name) => text.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0]?.toLowerCase() === name);
    const src = of('script-src-elem') ?? of('script-src') ?? of('default-src');
    if (src && (!src.includes("'unsafe-inline'") || src.some((v) => /^'(nonce|sha\d+)-/.test(v)))) return src.join(' ');
  }
  return null;
}

/* ------------------------------------------------------------------ desktop: Electron */

/** electron/package.json: what Electron and the packager read. The binding is there only when Steam's API was asked for. */
export function electronPackage(meta, { steamApi = false } = {}) {
  return { name: meta.id, productName: meta.name, fileName: meta.file, version: meta.version, description: meta.name, author: meta.publisher || undefined, main: 'main.cjs', private: true, ...(steamApi ? { dependencies: STANDALONE_PINS.steam } : {}) };
}

/** electron/app.json: the few facts main.cjs reads. main.cjs itself is the same file for every game. */
export function electronApp(meta, { colours = null, steamApi = false } = {}) {
  return { v: 1, id: meta.id, name: meta.name, appId: meta.appId, build: meta.build, width: 1280, height: 720, background: /^#[0-9a-f]{6}$/i.test(colours?.paper ?? '') ? colours.paper : '#04060c', ...(meta.steam.app ? { steam: { app: meta.steam.app, api: Boolean(steamApi) } } : {}) };
}

/**
 * macOS entitlements for a build that Steam starts, used INSTEAD of the signer's own defaults for every part of the
 * app (@electron/osx-sign replaces, never merges, when it is given a file). So it carries what Electron itself needs
 * under the hardened runtime, first of all the JIT that V8 runs on, and then the two that let the Steam client load
 * its overlay library into the app. A game with no Steam app gets no file at all: the signer's own defaults, which
 * differ for the app and each of its helpers, are the right ones. No App Sandbox: this is not a Mac App Store build.
 */
export function entitlementsPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
</dict>
</plist>
`;
}

/* ------------------------------------------------------------------ phones: Capacitor */

/** capacitor.config.json: the web folder, bundled. Never `server.url`: the app must not load its page from a site. */
export function capacitorConfig(meta, { colours = null } = {}) {
  return { appId: meta.appId, appName: meta.name, webDir: 'web', ...(/^#[0-9a-f]{6}$/i.test(colours?.paper ?? '') ? { backgroundColor: colours.paper } : {}), server: { androidScheme: 'https' } };
}

const IOS_ORIENT = {
  any: ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
  landscape: ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
  portrait: ['UIInterfaceOrientationPortrait'],
};
/** Info.plist with the ways the game may be held (an iPad's list too). Text in, text out; anything else is left as it is. */
export function patchInfoPlist(text, orientation) {
  const list = IOS_ORIENT[orientation] ?? IOS_ORIENT.any;
  const pad = orientation === 'portrait' ? [...list, 'UIInterfaceOrientationPortraitUpsideDown'] : orientation === 'any' ? ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'] : list;
  const arr = (items, indent) => `<array>\n${items.map((i) => `${indent}\t<string>${i}</string>`).join('\n')}\n${indent}</array>`;
  return String(text)
    .replace(/(<key>UISupportedInterfaceOrientations<\/key>\s*)<array>[\s\S]*?<\/array>/, (m, k) => `${k}${arr(list, '\t')}`)
    .replace(/(<key>UISupportedInterfaceOrientations~ipad<\/key>\s*)<array>[\s\S]*?<\/array>/, (m, k) => `${k}${arr(pad, '\t')}`);
}

const ANDROID_ORIENT = { any: null, landscape: 'sensorLandscape', portrait: 'sensorPortrait' };
/** AndroidManifest.xml with the main activity held one way, or free again. */
export function patchAndroidManifest(text, orientation) {
  const want = ANDROID_ORIENT[orientation] ?? null;
  const bare = String(text).replace(/\s+android:screenOrientation="[^"]*"/g, '');
  return want ? bare.replace(/<activity\b/, `<activity android:screenOrientation="${want}"`) : bare;
}

/** android/app/build.gradle with the app's version: the store's build number and the words a player sees. */
export function patchGradle(text, meta) {
  return String(text).replace(/\bversionCode\s+\d+/, `versionCode ${meta.build}`).replace(/\bversionName\s+"[^"]*"/, `versionName "${meta.version}"`);
}

/** How `xcodebuild -exportArchive` makes the .ipa for App Store Connect: on disk, never uploaded from here. */
export function exportOptionsPlist(team) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${String(team ?? '').replace(/[^A-Za-z0-9]/g, '')}</string>
</dict>
</plist>
`;
}

/* ------------------------------------------------------------------ Steam */

const vdf = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/**
 * steam/app_build.vdf: one build of the app, with each depot written INSIDE it. Steam documents the app script's
 * ContentRoot as relative to the script, and a depot's LocalPath as relative to that root; a depot script's own
 * relative ContentRoot is not documented the same way, so none is used. Each depot is the release build's folder,
 * out/<os>/release/. Written from Steam's documented format; it has never been run through steamcmd here.
 */
export function steamAppBuild(meta, { depots = meta.steam.depots } = {}) {
  const rows = DESKTOP.filter((os) => depots[os]).map((os) => `\t\t${vdf(depots[os])}\n\t\t{\n\t\t\t"FileMapping"\n\t\t\t{\n\t\t\t\t"LocalPath" ${vdf(`${os}/release/*`)}\n\t\t\t\t"DepotPath" "."\n\t\t\t\t"recursive" "1"\n\t\t\t}\n\t\t}`);
  return `"AppBuild"\n{\n\t"AppID" ${vdf(meta.steam.app)}\n\t"Desc" ${vdf(`${meta.name} ${meta.version} build ${meta.build}`)}\n\t"ContentRoot" "../out/"\n\t"BuildOutput" "output/"\n\t"Depots"\n\t{\n${rows.join('\n')}\n\t}\n}\n`;
}
/** What Steam starts on each operating system (Steamworks, Installation, General, launch options), from the names the build uses. */
export function steamLaunch(meta) {
  return { windows: `${meta.id}.exe`, mac: `${meta.file}.app`, linux: meta.id };
}

/* ------------------------------------------------------------------ GitHub Actions */

/** The actions the workflow uses, each pinned to the commit its release tag names. */
export const CI_ACTIONS = {
  checkout: 'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5',
  node: 'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5',
  java: 'actions/setup-java@de7274f081f381c8f8158605e0321c36c376e2e6 # v6',
  upload: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7',
};

/**
 * .github/workflows/standalone.yml: the five builds on GitHub's own Windows, Linux and macOS machines, started by
 * hand (never by a push), each kept as an artifact of the run. It is how a studio whose computer cannot make a
 * target (Windows from a Mac, iOS from Windows) gets that build. It uploads to no store.
 */
export function workflowYaml(meta) {
  const when = 'contains(inputs.targets, matrix.target)';
  const build = (cond, release, android) => `      - name: Build${android ? ' (Android, with its upload key when the secrets are set)' : ''}
        if: ${cond}
        shell: bash
        env:
          GAME: \${{ inputs.game }}
          TARGET: \${{ matrix.target }}
          RELEASE: \${{ ${release ? "inputs.release && '--release' || ''" : "''"} }}
          HOMIE_STANDALONE_SITE: \${{ vars.HOMIE_SITE }}
${android ? `          HOMIE_ANDROID_KEYSTORE_BASE64: \${{ secrets.HOMIE_ANDROID_KEYSTORE_BASE64 }}
          HOMIE_ANDROID_KEYSTORE_PASSWORD: \${{ secrets.HOMIE_ANDROID_KEYSTORE_PASSWORD }}
          HOMIE_ANDROID_KEY_ALIAS: \${{ secrets.HOMIE_ANDROID_KEY_ALIAS }}
          HOMIE_ANDROID_KEY_PASSWORD: \${{ secrets.HOMIE_ANDROID_KEY_PASSWORD }}
` : ''}        run: |
${android ? `          if [ -n "$HOMIE_ANDROID_KEYSTORE_BASE64" ]; then
            printf '%s' "$HOMIE_ANDROID_KEYSTORE_BASE64" | base64 --decode > "$RUNNER_TEMP/upload.keystore"
            export HOMIE_ANDROID_KEYSTORE="$RUNNER_TEMP/upload.keystore"
          fi
` : ''}          npx --no-install homie-studio standalone build "$GAME" --for "$TARGET" --build "$GITHUB_RUN_NUMBER" $RELEASE
          tar -C ".studio/standalone/$GAME/out" -czf "$GAME-$TARGET.tgz" "$TARGET"
`;
  const job = (name, runner, targets, { java = false, release = true } = {}) => `  ${name}:
    name: \${{ matrix.target }}
    runs-on: ${runner}
    strategy:
      fail-fast: false
      matrix:
        target: [${targets.join(', ')}]
    steps:
      - uses: ${CI_ACTIONS.checkout}
        if: ${when}
      - uses: ${CI_ACTIONS.node}
        if: ${when}
        with:
          node-version: 22
${java ? `      - uses: ${CI_ACTIONS.java}
        if: matrix.target == 'android' && contains(inputs.targets, 'android')
        with:
          distribution: temurin
          java-version: 21
` : ''}      - name: Install (npm ci with a lockfile, npm install without one)
        if: ${when}
        shell: bash
        run: if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi
${targets.includes('android') ? `${build(`${when} && matrix.target != 'android'`, release, false)}${build(`${when} && matrix.target == 'android'`, release, true)}` : build(when, release, false)}      - uses: ${CI_ACTIONS.upload}
        if: ${when}
        with:
          name: \${{ inputs.game }}-\${{ matrix.target }}-\${{ github.run_number }}
          path: \${{ inputs.game }}-\${{ matrix.target }}.tgz
          if-no-files-found: error
`;
  return `# Standalone builds of this studio's games (homie-studio standalone ci wrote this file; write it again with the
# same command, do not edit it by hand). Started by hand from the Actions tab, never by a push. Each target is built
# on GitHub's own machine for it and kept with the run as a .tgz (a tar keeps the files' permissions): windows on
# Windows, linux and android on Linux, mac and ios on macOS. Nothing is uploaded to Steam or to a store.
#
# The repository variable HOMIE_SITE is the studio's live address (https://…): the app is built to find its rooms
# there, and a shipped copy keeps that address for good, so use the studio's own domain when it has one. Without it
# the copies play offline only.
#
# "release" here means: Windows and Linux release builds (unsigned, as every Windows and Linux build of this version
# is), and an Android bundle signed with your upload key when the four HOMIE_ANDROID_* secrets are set (the keystore
# as base64; without them the job says the bundle is unsigned and fails). The macOS and iOS jobs never make a
# release, whatever the box says: this workflow has no Apple certificate, so the macOS app is an unsigned build to
# try and the iOS one is a simulator build. Sign, notarize and archive those on a Mac:
# homie-studio standalone build <id> --for mac,ios --release. A secret is only ever named in the env: block of the
# one step that needs it.
#
# This file has not been run by the people who wrote the command that makes it: read the first run's log.
name: Standalone builds

on:
  workflow_dispatch:
    inputs:
      game:
        description: The game's id (its folder in games/)
        required: true
        default: ${meta.id}
      targets:
        description: Which to build, of windows, linux, mac, ios, android
        required: true
        default: windows,linux,mac,ios,android
      release:
        description: Release builds for Windows, Linux and Android (game.json needs its standalone.appId)
        type: boolean
        default: false

permissions:
  contents: read

jobs:
${job('windows', 'windows-latest', ['windows'])}
${job('linux', 'ubuntu-latest', ['linux', 'android'], { java: true })}
${job('macos', 'macos-latest', ['mac', 'ios'], { release: false })}`;
}
