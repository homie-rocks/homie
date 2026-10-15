import { fixtureRun } from './studio-fixture.mjs';
import { legacyGame } from './legacy-game.mjs';
import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * @homie-rocks/studio: what `homie-studio build` promises a studio.
 *
 *   - a game that does not build fails the command (a non-zero exit) and leaves site/dist exactly as it was, never a
 *     site without that game for the next deploy to ship;
 *   - a finished build is put in place without removing site/dist or its folders: a file that did not change is not
 *     touched, and what the new build no longer has goes;
 *   - a game's bundle is named by its content, its built page names it, `await import()` becomes a chunk that the
 *     game's frame is served, and the address tools knew (assets/main.js) still loads the game;
 *   - every game's line says changed or unchanged and a build hash; site/dist/_site/build.json keeps it and the live
 *     site's manifest says the same hash;
 *   - `build --types` fails on a type error in a game's own files, with the studio's own TypeScript, and says how to
 *     get one when the studio has none (the toolkit does not depend on it);
 *   - remix was retired: a game.json that still carries its settings builds, with one note for the whole build; no
 *     game's source is built or served (410 at its old address); a game that was a remix keeps its credit;
 *   - studio.json `site.order` is the order of every list; a Home of the studio's own takes the generated hero;
 *   - the build says which hero files a landing wants, and what shape;
 *   - a game sets its own model budgets in game.json;
 *   - `preview <id>` serves one built game's files, across a rebuild.
 * Run: node --test packages/studio/test/build.test.mjs
 */
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleOf, gameDigest, modelBudgetsOf, orderGames } from '../lib/build.mjs';
import { placeholderGlb } from '../lib/optimise.mjs';
import { previewServer } from '../lib/preview.mjs';
import { findChrome } from '../lib/chrome.mjs';
import { openStage, swapIn } from '../lib/stage.mjs';
import { basedOnCredit, basedOnRow, licenseLabel, licenseOf, retiredKeys } from '../worker/license.mjs';
import { creditsPage } from '../worker/site.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-build-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (args, cwd) => fixtureRun(CLI, args, cwd);
const plain = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const edit = (file, fn) => writeFileSync(file, fn(readFileSync(file, 'utf8')));
const editJson = (file, fn) => { const v = json(file); fn(v); writeFileSync(file, `${JSON.stringify(v, null, 2)}\n`); };

/** A studio whose node_modules point at this package and the repo's esbuild, with the games named (the rules-based Coin Dash starter each). */
function studio(name, games = ['alpha', 'beta'], { typescript = false } = {}) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  if (typescript) symlinkSync(join(REPO_NM, 'typescript'), join(dir, 'node_modules', 'typescript'));
  for (const id of games) browserRulesGame(dir, id, `Game ${id}`);
  return dir;
}

/** The studio Worker over a built site folder (no rooms playing). */
async function siteOf(dir) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f) || !/\.[a-z0-9]+$/i.test(p)) return new Response('not found', { status: 404 });
      const type = p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
      return new Response(readFileSync(f), { headers: { 'content-type': type } });
    },
  };
  const LOBBY = {
    idFromName: (n) => n,
    get: () => ({ fetch: async (u) => {
      const path = new URL(u).pathname;
      if (path === '/rooms') return new Response(JSON.stringify({ rooms: [] }));
      if (path === '/now') return new Response(JSON.stringify({ players: 0, rooms: 0, peak: { players: 0, room: 0 } }));
      return new Response(JSON.stringify({ room: 'pub-9', players: 0, max: 8 }));
    } }),
  };
  return (path, init = {}) => worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': 'homie-house-qa test', ...(init.headers ?? {}) } }), { ASSETS, LOBBY, STUDIO_NAME: 'Night Owls' }, { waitUntil() {} });
}

/** Every file under a folder with its bytes, so "exactly as it was" is a comparison. */
function snapshot(dir, rel = '', acc = {}) {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) snapshot(dir, r, acc); else acc[r] = readFileSync(join(dir, r)).toString('base64');
  }
  return acc;
}


export { PKG, CLI, REPO_NM, scratch, run, plain, out, json, write, edit, editJson, studio, siteOf, snapshot };
