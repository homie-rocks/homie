#!/usr/bin/env node
/**
 * Package the desktop app with @electron/packager (standalone/STANDALONE.md):
 * `node pack.mjs <platform> <arch> <debug|release>`, run in the standalone project by `homie-studio standalone
 * build`. It is the same file for every game: what it packs is electron/ (main.cjs, app.json, the web folder),
 * unpacked beside the Electron binary (no asar: Steam patches a build file by file, and the game's files stay the
 * files the web build made). The result is out/<os>/<debug|release>/: that folder IS the app's folder.
 *
 * macOS signing comes from the environment only, never from a file or an argument:
 *   HOMIE_APPLE_IDENTITY         the signing identity's name ("Developer ID Application: …", or - for an ad hoc
 *                                signature that only this Mac trusts); with it the app is signed with the hardened
 *                                runtime. The signer's own entitlements are used, which differ for the app and each
 *                                helper; a game with a Steam app gets entitlements.mac.plist instead (see the
 *                                generator), because the signer replaces, never merges. So does an ad hoc
 *                                signature: with no team in it, the hardened runtime would refuse the app's own
 *                                frameworks unless library validation is off
 *   HOMIE_APPLE_NOTARY_PROFILE   a notarytool keychain profile (xcrun notarytool store-credentials, made by the
 *                                person in their own terminal); with it the signed app is sent to Apple's notary
 * "notarized" is said only when `xcrun stapler validate` agrees afterwards; otherwise the result says what was asked
 * for and that it was not confirmed.
 * It prints ONE line of JSON: { ok, platform, arch, path, app, exe, signed, notarized, checks } or { ok: false, why }.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const here = dirname(fileURLToPath(import.meta.url));
const [platform, arch, kind = 'debug'] = process.argv.slice(2);
const FOLDER = { darwin: 'mac', win32: 'windows', linux: 'linux' };
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

try {
  if (!FOLDER[platform] || !arch || !['debug', 'release'].includes(kind)) throw new Error('usage: node pack.mjs darwin|win32|linux <arch> debug|release');
  const meta = JSON.parse(readFileSync(join(here, 'electron', 'package.json'), 'utf8'));
  const app = JSON.parse(readFileSync(join(here, 'electron', 'app.json'), 'utf8'));
  const electron = JSON.parse(readFileSync(join(here, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const identity = process.env.HOMIE_APPLE_IDENTITY || '';
  const profile = process.env.HOMIE_APPLE_NOTARY_PROFILE || '';
  const sign = platform === 'darwin' && Boolean(identity);
  const adhoc = identity === '-';
  const notarize = sign && !adhoc && Boolean(profile);
  const icon = { darwin: join(here, 'icons', 'icon.icns'), win32: join(here, 'icons', 'icon.ico') }[platform];
  const entitlements = join(here, 'entitlements.mac.plist');
  const staging = join(here, 'out', `.pack-${FOLDER[platform]}-${kind}`);
  rmSync(staging, { recursive: true, force: true });
  const [made] = await packager({
    // The file's name is the game's name made safe for every file system (the toolkit's fileName). macOS shows that
    // name in the menu bar and the Dock too (the packager writes it over any other); the window's title is the game's own.
    dir: join(here, 'electron'), out: staging, name: meta.fileName, executableName: platform === 'darwin' ? undefined : meta.name,
    platform, arch, electronVersion: electron, overwrite: true, asar: false, prune: true, quiet: true,
    appBundleId: app.appId, appVersion: meta.version, buildVersion: String(app.build ?? 1), appCopyright: meta.author ? `© ${meta.author}` : undefined,
    appCategoryType: 'public.app-category.games',
    // Where Electron's own download is kept between builds: its usual cache, or the folder Electron's installer is told.
    ...(process.env.electron_config_cache ? { download: { cacheRoot: process.env.electron_config_cache } } : {}),
    ...(icon && existsSync(icon) ? { icon } : {}),
    ...(platform === 'win32' ? { win32metadata: { CompanyName: meta.author ?? '', ProductName: meta.productName, FileDescription: meta.productName } } : {}),
    ...(sign ? { osxSign: { identity, ...(adhoc ? { identityValidation: false } : {}), optionsForFile: () => ({ hardenedRuntime: true, ...((app.steam || adhoc) && existsSync(entitlements) ? { entitlements } : {}) }) } } : {}),
    ...(notarize ? { osxNotarize: { keychainProfile: profile } } : {}),
  });
  if (!made) throw new Error('the packager made nothing');
  const out = join(here, 'out', FOLDER[platform], kind);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(dirname(out), { recursive: true });
  renameSync(made, out);
  rmSync(staging, { recursive: true, force: true });
  // What is really there, by looking: never a name worked out from the game's.
  const names = readdirSync(out);
  const bundle = platform === 'darwin' ? names.find((n) => n.endsWith('.app')) : null;
  const exe = platform === 'darwin' ? (bundle ? join(out, bundle, 'Contents', 'MacOS', readdirSync(join(out, bundle, 'Contents', 'MacOS'))[0]) : null) : join(out, platform === 'win32' ? `${meta.name}.exe` : meta.name);
  if (!exe || !existsSync(exe)) throw new Error(`the packager finished, and the app's program is not where it should be in ${out}`);
  // What was asked of the signer and the notary is one thing; what the finished app answers is what gets said.
  const checks = {};
  const ask = (name, cmd, args) => { try { execFileSync(cmd, args, { stdio: 'pipe', timeout: 60_000 }); checks[name] = true; } catch (error) { checks[name] = false; checks[`${name}Says`] = String(error?.stderr ?? error?.message ?? '').trim().split('\n').slice(-2).join(' ').slice(0, 300); } };
  if (sign && bundle) ask('signature', 'codesign', ['--verify', '--deep', '--strict', join(out, bundle)]);
  if (notarize && bundle) ask('stapled', 'xcrun', ['stapler', 'validate', join(out, bundle)]);
  say({ ok: true, platform, arch, kind, path: out, app: bundle ? join(out, bundle) : out, exe, electron, signed: sign && checks.signature === true, adhoc, notarizeAsked: notarize, notarized: notarize && checks.stapled === true, checks });
} catch (error) {
  say({ ok: false, why: String(error?.message ?? error).split('\n').slice(0, 6).join(' ').slice(0, 800) });
  process.exitCode = 1;
}
