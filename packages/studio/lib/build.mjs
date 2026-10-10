import { appProblems } from '../worker/app-format.mjs';
/**
 * `homie-studio build` — every game in games/ bundled into site/dist, plus the
 * catalogue the Worker serves (games.json).
 *
 *   site/dist/games/<id>/index.html        the game's page (the Worker adds HOMIE_NET)
 *   site/dist/games/<id>/assets/main-<HASH>.js   its bundle (esbuild; @homie-rocks/studio/netplay inlined), named by
 *                                          its content, so a browser or an edge that kept the last build's bundle is
 *                                          never asked for this one under the same name; the built index.html names it
 *   site/dist/games/<id>/assets/chunk-<HASH>.js  whatever the game loads later with `await import('./x')`: one file
 *                                          each, fetched when asked for, from beside the bundle
 *   site/dist/games/<id>/assets/main.js    the address tools knew before bundles had hashes: one line that imports
 *                                          the hashed bundle (bundleOf() says the real file)
 *   site/dist/_site/build.json             what this build made: per game its content hash, its bundle and chunks,
 *                                          and whether it changed since the build before (what a deploy reads)
 *   site/dist/games/<id>/...               everything in games/<id>/public/
 *   site/dist/games/<id>/agents.json       the AI guides' vocabulary (games/<id>/agents.json, checked; NETPLAY.md
 *                                          section 18): the only goals and lines an AI in its rooms has
 *   site/dist/games.json                   { studio, games[], songs[], videos[], posts[], site, shop } from studio.json,
 *                                          game.json files, the music/ and videos/ manifests (media/MEDIA.md),
 *                                          posts/*.md, the studio's site/ folder (site/SITE.md) and shop.json (checked
 *                                          against studio settings, Stripe constraints and arithmetic correctness)
 *   site/dist/games/<id>/_landing/...      what the game's landing shows (hero footage, its cover, licence texts)
 *   site/dist/_site/                       posts.json (the posts' HTML), the studio's own pages (site/pages)
 *   site/dist/_studio/codex/<id>/          each game's Game Codex (games/<id>/CODEX.md, lib/codex.mjs): served only to
 *                                          the studio's owner (worker/stats-page.mjs), never listed or indexed
 *   site/dist/<file>                       site/public, as it is (fonts, a logo, hero footage)
 *   site/dist/music/..., site/dist/videos/...   media files the site serves itself. A file the studio's R2 has (media
 *                                          move: the same bytes, by SHA-256) is left out of a deploy's build and
 *                                          served from R2 at the same address; a local build still copies it when it
 *                                          fits, for `dev` (whose R2 is empty). Workers Builds (WORKERS_CI=1) builds
 *                                          as a deploy.
 *
 *   site/src/rules/<id>.mjs, index.mjs     for a game written as rules plus view (games/<id>/src/rules.ts): its rules as
 *                                          one checked, guarded module for the Worker (lib/rules-build.mjs,
 *                                          lib/rules-guard.mjs). The Table runs them: the server is the room's host.
 *
 * game.json "build" picks how a game becomes files (a ported game keeps its own shape):
 *   (absent) / { "mode": "bundle" }   src/main.ts (or "entry") bundled by esbuild — new games and ES-module ports
 *   { "mode": "static" }              the folder copied as it is (plain <script> games), plus homie-port.js,
 *                                     the port toolkit as one classic script (window.HomiePort); an "entry"
 *                                     is bundled to assets/main.js as well
 *   { "mode": "command", "command": "npm run build", "out": "dist" }
 *                                     the game's own build (Vite, webpack…), then its output copied; base must be './'
 */
import { playerImage } from './player-image.mjs';
import { playerOrigins } from '../worker/embed.mjs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative } from 'node:path';
import { buildCodexPages } from './codex.mjs';
import { BUDGET_FIELDS, BUDGET_TIERS, loaderBudget } from './asset-check.mjs';
import { buildMedia } from './media.mjs';
import { buildSiteFiles, isoDate, landingOf, readPosts, readTheme } from './site.mjs';
import { checkJsonLd } from './schema-check.mjs';
import { SCHEMA_REFUSED } from '../worker/schema.mjs';
import { PACKAGE_ROOT, isRulesGame, listExperiences as listGames, readStudio } from './studio.mjs';

// The rules build brings a JavaScript parser with it. It is loaded when a build first needs it, never when this
// module is: Homie for Claude Desktop starts the toolkit with no node_modules beside it (scripts/desktop.mjs).
let rulesBuildModule = null;
const rulesBuild = () => (rulesBuildModule ??= import('./rules-build.mjs'));
import { SEAT_MAX, netplayRow } from '../worker/seats.mjs';
import { STUDIO_VERSION } from './version.mjs';
import { basedOnRow, licenseOf, retiredKeys } from '../worker/license.mjs';
import { openStage, swapIn } from './stage.mjs';
import { typecheck } from './typecheck.mjs';
import { SERVER_LIMITS, serverOf } from '../worker/servers.mjs';
import { chatProblems } from '../worker/chat.mjs';
import { screenChatProblems } from '../worker/chat-page.mjs';
import { vocabularyOf } from '../worker/brain.mjs';
import { shopForBuild } from './shop.mjs';
import { audienceOf } from '../worker/shop-rules.mjs';
import { loungeConfig, loungeProblems } from '../worker/lounge-store.mjs';
// GAME PARTS (parts/PARTS.md): the three call-outs below are all the build knows of them.
import { buildParts, partsPlugin } from './parts-build.mjs';
// RULES ON THE SERVER (NETPLAY.md section 29): a game declaring a room object and src/rules.ts builds as a view bundle plus a rules module.

/** Never copied into a static game's served folder. */
const STATIC_SKIP = new Set(['node_modules', '.git', '.wrangler', '.port', '.DS_Store', 'game.json', 'app.json', 'PORT.md', 'CODEX.md', 'lab.json', 'codex']);
const LOADERS = { '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.gif': 'file', '.webp': 'file', '.mp3': 'file', '.ogg': 'file', '.wav': 'file', '.m4a': 'file', '.glb': 'file', '.gltf': 'file', '.bin': 'file', '.hdr': 'file', '.svg': 'file', '.json': 'json', '.woff2': 'file', '.ttf': 'file' };

/** The port toolkit as one classic script (window.HomiePort), for static games. Built once per build. */
async function portScript(esbuild, root, cache) {
  if (cache.text) return cache.text;
  const entry = join(PACKAGE_ROOT, 'port', 'global.ts');
  const res = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, absWorkingDir: root, logLevel: 'silent' });
  cache.text = `/* homie-port.js — @homie-rocks/studio port toolkit (window.HomiePort). Load it first in <head>. */\n${res.outputFiles[0].text}`;
  return cache.text;
}

function copyStatic(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (STATIC_SKIP.has(entry.name)) continue;
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) { mkdirSync(dest, { recursive: true }); copyStatic(src, dest); }
    else if (entry.isFile()) cpSync(src, dest);
  }
}

function dirBytes(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? dirBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}
/** From games/<id>/style.json: the light colour as paper, the dark as text, and the accent; null without one. */
export function uiOf(g) {
  let pal = null;
  try { pal = JSON.parse(readFileSync(join(g.dir, 'style.json'), 'utf8'))?.palette ?? null; } catch { pal = null; }
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v).toLowerCase() : null);
  const ink = hex(pal?.ink); const bg = hex(pal?.bg);
  if (!ink || !bg) return null;
  const lum = (h) => (0.2126 * parseInt(h.slice(1, 3), 16) + 0.7152 * parseInt(h.slice(3, 5), 16) + 0.0722 * parseInt(h.slice(5, 7), 16)) / 255;
  const light = lum(ink) >= lum(bg);
  return { paper: light ? ink : bg, text: light ? bg : ink, ...(hex(pal?.accent) ? { hot: hex(pal.accent) } : {}) };
}

/*
 * WHAT THIS BUILD IS, for the site's manifest: the commit and branch (Cloudflare's Workers Builds names them in
 * WORKERS_CI_COMMIT_SHA and WORKERS_CI_BRANCH; elsewhere git is asked), when it was built, and the marks of the
 * newest changes in changes/ (lib/progress.mjs recordChange), so the Claude app's card can tell when a merged pull
 * request is live. Nothing here names a person or an account.
 */
export function buildInfo(root) {
  const git = (args) => { try { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? r.stdout.trim() : null; } catch { return null; } };
  const commit = /^[a-f0-9]{40}$/.test(process.env.WORKERS_CI_COMMIT_SHA ?? '') ? process.env.WORKERS_CI_COMMIT_SHA : git(['rev-parse', 'HEAD']);
  const branch = String(process.env.WORKERS_CI_BRANCH || git(['rev-parse', '--abbrev-ref', 'HEAD']) || '').slice(0, 100) || null;
  const marks = [];
  const dir = join(root, 'changes');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const c = readJson(join(dir, name));
      if (c && /^[a-f0-9]{16}$/.test(String(c.change)) && !Number.isNaN(Date.parse(c.at))) marks.push({ mark: c.change, at: c.at });
    }
  }
  marks.sort((a, b) => b.at.localeCompare(a.at));
  return {
    commit: /^[a-f0-9]{40}$/.test(String(commit)) ? commit : null,
    branch: branch && /^[A-Za-z0-9._/-]+$/.test(branch) && branch !== 'HEAD' ? branch : null,
    at: new Date().toISOString(),
    ci: process.env.WORKERS_CI === '1' ? 'workers-builds' : null,
    changes: [...new Set(marks.map((m) => m.mark))].slice(0, 50),
  };
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * When a game came and last changed (its landing's datePublished and dateModified, and the sitemap's lastmod):
 * game.json `"released"` (a day) when the owner says so, else the commit that added its game.json; and the last
 * commit that touched its folder. Nothing from a shallow clone (its first commit would claim every file was made that
 * day) or a folder git does not track.
 */
export function gameDates(root, g, log = () => {}) {
  const git = (args) => { try { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? r.stdout.trim() : null; } catch { return null; } };
  const released = isoDate(g.released);
  if (g.released !== undefined && !released) log(`warning: games/${g.id}/game.json "released" is a day (2026-09-30); left out`);
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow !== 'false') return released ? { published: released } : null;
  const rel = relative(root, g.dir).split('\\').join('/');
  const added = git(['log', '--diff-filter=A', '--format=%cI', '--', `${rel}/game.json`])?.split('\n').filter(Boolean).pop() ?? null;
  const last = git(['log', '-1', '--format=%cI', '--', rel]) || null;
  const iso = (v) => (v && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
  const out = { published: released ?? iso(added), modified: iso(last) };
  if (out.published && out.modified && Date.parse(out.modified) < Date.parse(out.published)) out.modified = out.published;
  return out.published || out.modified ? Object.fromEntries(Object.entries(out).filter(([, v]) => v)) : null;
}

/**
 * The owner's own structured data (game.json "schema", studio.json "site": { "schema" }): a plain object of schema.org
 * properties put on the game's VideoGame (the studio's Organization), under Homie's own. Ratings, reviews and offers
 * are refused (Homie shows no ratings on the page; prices are shop.json's), and so is anything that is not JSON-LD a
 * page can carry; a property schema.org does not have, or does not put on that type, is warned about.
 */
export function schemaExtras(value, { where, types, log = () => {} }) {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) { log(`warning: ${where} "schema" is an object of schema.org properties; left out`); return null; }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SCHEMA_REFUSED.includes(k)) { log(`warning: ${where} schema.${k} is left out: Homie publishes no ${k === 'offers' ? 'prices but the shop\'s (shop.json)' : 'ratings or reviews the page does not show'}`); continue; }
    if (!/^[a-z][A-Za-z0-9]{0,63}$/.test(k)) { log(`warning: ${where} schema "${k.slice(0, 40)}" is not a property name (Homie sets @type and @id); left out`); continue; }
    out[k] = v;
  }
  const json = JSON.stringify(out);
  if (json.length > 8192) { log(`warning: ${where} "schema" is over 8 KB; left out`); return null; }
  const { errors } = checkJsonLd({ '@context': 'https://schema.org', '@type': types, ...out });
  for (const e of errors) log(`warning: ${where} schema: ${e.replace(/^\$: /, '')}`);
  return Object.keys(out).length ? out : null;
}

/** game.json "genre": a word or up to three ("Arcade", ["Racing", "Party"]); its landing and VideoGame say it. */
export function genreOf(g, log = () => {}) {
  if (g.genre === undefined) return null;
  const list = (Array.isArray(g.genre) ? g.genre : [g.genre]).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 40)).slice(0, 3);
  if (!list.length) log(`warning: games/${g.id}/game.json "genre" is a word or a list of up to three; left out`);
  return list.length ? list : null;
}

/**
 * A game's netplay manifest: game.json's `netplay` block, over a `netplay.json` beside game.json or in the game's
 * built output (a ported Vite game ships public/netplay.json), over nothing.
 */
/**
 * Which netplay revision a game's build speaks (0.16.0): the helper writes `homie-netplay-rev:<n>` into every
 * bundle (netplay/netplay.ts NETPLAY_MARK). A build without it is revision 5 or older: it plays on every server, but
 * reserved AI seats stay empty and its bots do not read the dial, and the office says so. Null when nothing says.
 */
export function netplayRevOf(out) {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const f = join(dir, name);
      let st;
      try { st = statSync(f); } catch { continue; }
      if (st.isDirectory()) { if (!['node_modules', '_landing'].includes(name)) walk(f, depth + 1); } else if (/\.m?js$/.test(name) && st.size < 16 * 1024 * 1024) files.push(f);
    }
  };
  walk(out, 0);
  let rev = null;
  for (const f of files.slice(0, 200)) {
    const m = /homie-netplay-rev:(\d{1,3})/.exec(readFileSync(f, 'utf8'));
    if (m) rev = Math.max(rev ?? 0, Number(m[1]));
  }
  return rev;
}

/**
 * games/<id>/agents.json, checked (worker/brain.mjs vocabularyOf: argument types, text over 120 characters, a goal
 * against a player, an ask naming a goal or line that is not there) and served beside the game, where the room's Table
 * reads it. A game with none has guides that play but never talk. Returns whether it has one.
 */
export function vocabFor(g, out) {
  const file = join(g.dir, 'agents.json');
  if (!existsSync(file)) { rmSync(join(out, 'agents.json'), { force: true }); return false; }
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new Error(`games/${g.id}/agents.json is not JSON: ${error.message}`); }
  const v = vocabularyOf(raw);
  if (!v.ok) throw new Error(`games/${g.id}/agents.json: ${v.problems.slice(0, 6).join('; ')}`);
  writeFileSync(join(out, 'agents.json'), `${JSON.stringify(raw)}\n`);
  return true;
}

/** game.json "servers": the seeds a game ships with (worker/servers.mjs; a D1 row of the same id wins). */
function serverSeeds(g, log) {
  if (!Array.isArray(g.servers)) return [];
  const out = [];
  for (const raw of g.servers.slice(0, SERVER_LIMITS.perGame)) {
    const s = serverOf({ ...raw, id: raw?.id ?? String(raw?.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) }, { from: 'game.json' });
    if (!s || (s.id === 'public' && raw?.policy === undefined)) { log(`warning: games/${g.id}/game.json: a server needs an id (or a name) and a policy; skipped`); continue; }
    const { from, createdAt, updatedAt, ...seed } = s;
    out.push(seed);
  }
  return out;
}

export function netplayOf(g, out = null) {
  const file = readJson(join(g.dir, 'netplay.json')) ?? (out ? readJson(join(out, 'netplay.json')) : null) ?? {};
  return { ...(file && typeof file === 'object' ? file : {}), ...(g.netplay && typeof g.netplay === 'object' ? g.netplay : {}) };
}

/**
 * How many seats a room of this game has: the netplay manifest's `maxPlayers` (or `players.max`), else game.json's
 * `players.max`, else 8; at most SEAT_MAX (32). `asked` is what the game named, so a build can say it was capped.
 */
export function seatsFor(g, net = netplayOf(g)) {
  const named = [net.maxPlayers, net.players?.max, g.players?.max].map((n) => Math.floor(Number(n))).find((n) => Number.isFinite(n) && n >= 1);
  const asked = named ?? (g.kind === 'app' ? 32 : 8);
  const max = Math.min(SEAT_MAX, asked);
  const minNamed = [net.minPlayers, net.players?.min, g.players?.min].map((n) => Math.floor(Number(n))).find((n) => Number.isFinite(n) && n >= 1);
  return { min: Math.min(max, minNamed ?? 1), max, asked };
}

/**
 * `build --maps` (what `homie-studio perf` reads a CPU profile through): the bundle's source map and esbuild's metafile
 * go to .studio/maps/<id>/ (git-ignored, this computer's own), never into site/dist, so a deploy never ships them. The
 * bundle itself is byte for byte the one a plain build makes (an external map adds no comment to it); main.js.sha256
 * says which bundle the map belongs to, so a map left over from an older build is never used.
 */
function keepMap(root, id, out, metafile, bundle, maps) {
  const dir = join(root, '.studio', 'maps', id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // The bundle's map keeps the name the perf tools know (main.js.map) whatever hash the bundle has.
  for (const m of maps) writeFileSync(join(dir, m.entry ? 'main.js.map' : m.name), m.text);
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(metafile ?? {}));
  writeFileSync(join(dir, 'main.js.sha256'), `${createHash('sha256').update(readFileSync(join(out, bundle))).digest('hex')}\n`);
}

/**
 * A built game's real bundle, as a path in its folder (`assets/main-K3J2H1AB.js`): what its index.html loads. The
 * build writes it to bundle.json beside the page; a game built before bundles had hashes (or by its own build) has
 * assets/main.js itself. Null when the folder has neither.
 */
export function bundleOf(dir) {
  const named = readJson(join(dir, 'bundle.json'))?.bundle;
  if (typeof named === 'string' && /^assets\/[A-Za-z0-9._-]+\.js$/.test(named) && existsSync(join(dir, named))) return named;
  return existsSync(join(dir, 'assets', 'main.js')) ? 'assets/main.js' : null;
}

/**
 * One digest of a built game's files (everything in its folder but _landing/, the landing page's own pictures): the
 * same sixteen characters `homie-studio perf` names a build by. Two builds with the same digest serve the same game.
 */
export function gameDigest(dir) {
  if (!existsSync(dir)) return null;
  const files = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (r !== '_landing') walk(r); } else files.push(r);
    }
  };
  walk('');
  const h = createHash('sha256');
  for (const f of files.sort()) h.update(`${f}\0${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}\n`);
  return h.digest('hex').slice(0, 16);
}

/**
 * game.json `"assets": { "budgets": { "triangles": 8000, "bytes": 1500000 } }`: what ONE model may cost before
 * `createModels()` says so in the console during development (assets/assets.ts; the defaults, 1,500 triangles and
 * 300 KB, are a small prop's, and a 3D game's hero or its level is neither). `texturePx` and `materials` are taken
 * the same way. Null when the game sets none; a field that is not a positive number is left out, with a warning.
 *
 * The key has ONE reader (lib/asset-check.mjs gameBudgets, which `assets check` and `assets add` hold a model to):
 * this is that reading, as the loader can use it. The loader knows no tiers, so a game that sets a budget a tier
 * ({ "hero": { "triangles": 12000 } }) gets the loosest one, and a number past a hard cap is held to the cap here
 * as it is there, said in the build's log. What the loader warns about is then never something the check passes.
 */
export function modelBudgetsOf(g, log = () => {}) {
  const raw = g.assets && typeof g.assets === 'object' ? g.assets.budgets : undefined;
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { log(`warning: games/${g.id}/game.json assets.budgets is an object ({ "triangles": 8000, "bytes": 1500000 }); left out`); return null; }
  const whole = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? n : null; };
  const said = (where, o) => { for (const k of [...BUDGET_FIELDS, 'materials']) if (o[k] !== undefined && whole(o[k]) === null) log(`warning: games/${g.id}/game.json assets.budgets.${where}${k} is a whole number above zero; left out`); };
  said('', raw);
  for (const k of Object.keys(raw)) {
    if (BUDGET_FIELDS.includes(k) || k === 'materials') continue;
    // A budget for one tier (hero, npc, prop, signature, kit), as `assets check` reads it.
    if (BUDGET_TIERS.includes(k) && raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) said(`${k}.`, raw[k]);
    else log(`warning: games/${g.id}/game.json assets.budgets.${k} is not one of triangles, bytes, texturePx, materials${BUDGET_TIERS.includes(k) ? ' (a tier is an object: { "triangles": … })' : `, or a tier (${BUDGET_TIERS.join(', ')})`}; left out`);
  }
  const read = loaderBudget(g);
  for (const c of read?.capped ?? []) log(`warning: games/${g.id}/game.json assets.budgets asks ${c.asked} ${c.field} for a model; ${c.cap} is the most any model may have (assets check holds the same), so ${c.cap} it is`);
  const out = { ...(read?.budget ?? {}) };
  if (whole(raw.materials) !== null) out.materials = whole(raw.materials);
  return Object.keys(out).length ? out : null;
}

/** esbuild, as the studio has it installed (the version its package.json pins). */
export async function studioEsbuild(root) {
  const require = createRequire(join(root, 'package.json'));
  try { return require('esbuild'); } catch { return import('esbuild'); }
}

/** In a built page, the bundle's old address (./assets/main.js, in a src or an href) becomes its hashed one. */
function pointAtBundle(html, bundle) {
  return html.replace(/((?:src|href)\s*=\s*)(["'])((?:\.\/|\/)?)assets\/main\.js((?:[?#][^"']*)?)\2/gi, (m, attr, q, lead, tail) => `${attr}${q}${lead}${bundle}${tail}${q}`);
}

/**
 * One game's own files into `out` (emptied first): its bundle, static copy or own build's output, its index.html and
 * its public/ folder. What `build` serves at /games/<id>/, and what the Game Lab (lib/lab.mjs) builds New and Today
 * with. `sourcemap` is esbuild's (the lab keeps a linked map beside its builds); `maps` keeps the site build's map in
 * .studio/maps/<id>/. Returns { mode, warnings, metafile, bundle, chunks } (metafile: the bundle's inputs, null for
 * other modes; bundle: its path in `out`, null when the game has none; chunks: what it loads later; rules: for a game
 * written as rules plus view, what lib/rules-build.mjs made of its rules, else null).
 *
 * The bundle is ES modules with code splitting: every `await import('./later')` in the game becomes a chunk of its
 * own (assets/chunk-<HASH>.js) that the browser fetches when the game asks, from beside the bundle, wherever the
 * game is served (/games/<id>/ on the site, /<id>/__game/ in its frame, the lab). A game with no dynamic import is
 * one file, as before. `hashed` (the site's build) names the bundle by its content too: see the top of this file.
 */
export async function buildGameFiles(esbuild, root, g, out, { maps = false, sourcemap = null, cache = {}, log = () => {}, hashed = false, lab = false, longCheck = false } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  const mode = g.build?.mode ?? 'bundle';
  const label = `${g.kind === 'app' ? 'apps' : 'games'}/${g.id}`;
  const manifest = g.kind === 'app' ? 'app.json' : 'game.json';
  let warnings = 0;
  let metafile = null;
  let bundled = null;
  let chunks = [];
  const budgets = modelBudgetsOf(g, log);
  // RULES PLUS VIEW (rooms on the server). A game with "room" in game.json and a src/rules.ts has its rules checked, guarded and loaded first:
  // a rule the wall refuses stops the build here, with the line named. A game without one is hosted by a player's
  // browser exactly as before, and cannot ask for the server.
  const ruled = isRulesGame(g);
  if (!ruled && g.room?.host === 'server') {
    throw new Error(`${label}/${manifest} asks for "room": { "host": "server" }, but ${mode === 'bundle' ? 'this game has no src/rules.ts: its rules are inside its own code and run in a player\'s browser. Ask for it to be rewritten as rules plus view' : 'a ported game is someone else\'s browser code, which the server cannot run. It stays hosted by a player\'s browser'}.`);
  }
  if (ruled && mode !== 'bundle') throw new Error(`${label} has a src/rules.ts and ${manifest} "build": { "mode": "${mode}" }. A game written as rules plus view is built by Homie itself: take the "build" setting out.`);
  if (ruled) {
    const file = join(g.dir, 'index.html');
    const html = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    if (!scripts.some((tag) => /\btype\s*=\s*["']module["']/i.test(tag) && /\bsrc\s*=\s*(["'])(?:\.\/)?assets\/main\.js(?:[?#][^"']*)?\1/i.test(tag))) {
      throw new Error(`${g.kind === 'app' ? 'apps' : 'games'}/${g.id}/index.html: load the built view with <script type="module" src="./assets/main.js"></script>. The manifest entry names src/view.ts; HTML loads the bundle, not /src/view.ts. Keep the path relative so it works inside the game frame.`);
    }
  }
  const { prepareRules, viewPlugin } = ruled ? await rulesBuild() : {};
  const rules = ruled ? await prepareRules(esbuild, root, g, { log, longCheck }) : null;
  const bundle = async (entryRel) => {
    const entry = join(g.dir, entryRel);
    if (!existsSync(entry)) throw new Error(`${label}: entry ${entryRel} not found`);
    const options = {
      entryPoints: [rules ? 'homie:view' : entry], bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: sourcemap ?? false,
      outdir: join(out, 'assets'), splitting: true, entryNames: hashed ? 'main-[hash]' : 'main', chunkNames: 'chunk-[hash]',
      absWorkingDir: root, logLevel: 'silent', metafile: true,
      loader: LOADERS, assetNames: '[name]-[hash]',
      // game.json assets.budgets, read by createModels() (assets/assets.ts): a constant in the bundle, never a fetch.
      define: { __HOMIE_MODEL_BUDGETS__: JSON.stringify(budgets ?? {}) },
      // GAME PARTS: `@parts/<host>/<id>` and `@parts/<id>` resolve to the part's entry, and the game is credited.
      plugins: [partsPlugin(root, g.id), ...(rules ? [viewPlugin(g, rules, entry, { lab })] : [])],
    };
    const failed = (error) => {
      const first = error.errors?.[0];
      throw new Error(`${label} did not build: ${first ? `${first.text}${first.location ? ` (${first.location.file}:${first.location.line})` : ''}` : error.message}`);
    };
    const result = await esbuild.build(options).catch(failed);
    warnings += result.warnings.length;
    metafile = result.metafile;
    const outputs = Object.entries(result.metafile.outputs).filter(([k]) => k.endsWith('.js'));
    const main = outputs.find(([, v]) => rules ? v.entryPoint === 'homie-view:homie:view' : Boolean(v.entryPoint))?.[0];
    if (!main) throw new Error(`${label} did not build: esbuild wrote no bundle for ${entryRel}`);
    bundled = `assets/${basename(main)}`;
    chunks = outputs.filter(([k]) => k !== main).map(([k]) => `assets/${basename(k)}`).sort();
    if (maps) {
      // The map comes from a second pass that writes nothing. esbuild's name hash covers a file's map as well as its
      // code, so a build made WITH maps would name the bundle (and its chunks) differently from a plain build of the
      // same source, and `build --maps` would no longer be the build a deploy ships. The second pass's code differs
      // from the first's only in those names, which are all the same length, so its map fits the shipped bundle
      // position for position.
      const mapped = await esbuild.build({ ...options, sourcemap: 'external', write: false, metafile: true }).catch(failed);
      const entryOut = Object.entries(mapped.metafile.outputs).find(([k, v]) => k.endsWith('.js') && v.entryPoint)?.[0];
      keepMap(root, g.id, out, result.metafile, bundled, mapped.outputFiles.filter((f) => f.path.endsWith('.js.map')).map((f) => ({ name: basename(f.path), text: f.text, entry: Boolean(entryOut) && basename(f.path) === `${basename(entryOut)}.map` })));
    }
    if (hashed) {
      // The address tools and older pages knew: it imports the real bundle, so both are one module, run once.
      writeFileSync(join(out, 'assets', 'main.js'), `import"./${basename(main)}";\n`);
      writeFileSync(join(out, 'bundle.json'), `${JSON.stringify({ v: 1, bundle: bundled, chunks })}\n`);
    }
  };
  if (mode === 'static') {
    copyStatic(g.dir, out);
    writeFileSync(join(out, 'homie-port.js'), await portScript(esbuild, root, cache));
    if (g.entry) await bundle(g.entry);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    if (!/homie-port\.js/.test(html)) log(`warning: ${label}/index.html does not load ./homie-port.js (the port toolkit); add <script src="./homie-port.js"></script> first in <head>`);
    if (hashed && bundled) writeFileSync(join(out, 'index.html'), pointAtBundle(html, bundled));
  } else if (mode === 'command') {
    const command = String(g.build.command ?? 'npm run build');
    const res = spawnSync(command, { cwd: g.dir, shell: true, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`${label}: \`${command}\` failed: ${`${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-6).join(' ')}`);
    const built = join(g.dir, String(g.build.out ?? 'dist'));
    if (!existsSync(join(built, 'index.html'))) throw new Error(`${label}: \`${command}\` left no index.html in ${relative(g.dir, built) || '.'}`);
    cpSync(built, out, { recursive: true });
    writeFileSync(join(out, 'homie-port.js'), await portScript(esbuild, root, cache));
  } else {
    await bundle(g.entry ?? (rules ? 'src/view.ts' : 'src/main.ts'));
    const html = join(g.dir, 'index.html');
    if (!existsSync(html)) throw new Error(`${label}/index.html is missing`);
    const text = readFileSync(html, 'utf8');
    writeFileSync(join(out, 'index.html'), hashed ? pointAtBundle(text, bundled) : text);
  }
  if (mode !== 'static' && existsSync(join(g.dir, 'public'))) cpSync(join(g.dir, 'public'), out, { recursive: true });
  if (!existsSync(join(out, 'index.html'))) throw new Error(`${label}/index.html is missing`);
  if (rules) {
    // Only this game's executable view and rules data: buildInfo, the site and other games cannot reload its players.
    const digest = createHash('sha256').update(rules.build);
    for (const file of [bundled, ...chunks].filter(Boolean)) digest.update(readFileSync(join(out, file)));
    digest.update(readFileSync(join(out, 'index.html')));
    rules.build = digest.digest('hex').slice(0, 32);
    writeFileSync(join(out, 'rules.json'), `${JSON.stringify({ v: 1, host: rules.settings.host, offline: rules.settings.offline, build: rules.build, files: [bundled, ...chunks] })}\n`);
    if (g.netplay?.version !== undefined) log(`  ${g.id}: rules games use their build hash as the revision; netplay.version is not read`);
  }
  return { mode, warnings, metafile, bundle: bundled, chunks, rules };
}

/**
 * studio.json `"site": { "order": ["<id>", …] }`: the order every list of games is in (Home, the Games page, the
 * cards, the feeds for crawlers and /.well-known/homie-studio.json, which all read the catalogue's order). The games
 * it names come first, as it names them; every other game follows by id, as all of them did before.
 */
export function orderGames(games, order, log = () => {}) {
  if (order === undefined) return games;
  if (!Array.isArray(order) || order.some((x) => typeof x !== 'string')) { log('warning: studio.json site.order is a list of game ids (["newest-game", "older-game"]); left out'); return games; }
  const ids = new Set(games.map((g) => g.id));
  const want = [...new Set(order)];
  for (const id of want) if (!ids.has(id)) log(`warning: studio.json site.order names "${String(id).slice(0, 40)}", which is not one of this studio's games; skipped`);
  const at = new Map(want.filter((id) => ids.has(id)).map((id, i) => [id, i]));
  return [...games].sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity) || a.id.localeCompare(b.id));
}

export async function build(root, { only = null, log = () => {}, deploy = process.env.WORKERS_CI === '1', maps = false, types = false, beforePublish = async () => {}, longCheck = false } = {}) {
  const esbuild = await studioEsbuild(root);
  const studio = readStudio(root);
  await (await import('./tools-build.mjs')).buildTools(root, esbuild);
  await (await import('./functions-build.mjs')).buildFunctions(root, esbuild);
  // The shop first (shop/SHOP.md): invalid shop settings stop the build before anything is built.
  const shop = shopForBuild(root, { log });
  const live = join(root, 'site', 'dist');
  const games = listGames(root).filter((g) => !only || g.id === only);
  if (only && !games.length) throw new Error(`no game "${only}" in games/`);
  for (const g of games) if (g.kind === 'app') { const bad = appProblems(g); if (bad.length) throw new Error(`apps/${g.id}/app.json: ${bad.join('; ')}`); }
  // `--types`: the games' TypeScript is checked first (esbuild only strips types, it never reads them), and a type
  // error stops the build before anything is built.
  // Rules always use their generated capability types, including the view. The legacy
  // compiler sees broad source types and can falsely reject valid rules callbacks.
  const legacy = games.filter((g) => !isRulesGame(g));
  const typed = types && legacy.length ? typecheck(root, legacy, { log }) : null;
  // What the build before this one made, to say which games changed.
  const before = readJson(join(live, '_site', 'build.json'))?.games ?? {};
  // Everything is built in a folder of its own and put in place only when all of it is there (lib/stage.mjs): a
  // game that does not build leaves site/dist as it was, never a site without that game. A one-game build starts
  // from the site as it is.
  const dist = openStage(root, { from: only ? live : null });
  try {
    return await buildInto(dist, { esbuild, studio, shop, live, games, before, typed, root, only, log, deploy, maps, beforePublish, longCheck });
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
}

async function buildInto(dist, { esbuild, studio, shop, live, games, before, typed, root, only, log, deploy, maps, beforePublish, longCheck }) {
  const built = [];
  const retired = [];
  const cache = {};
  const ruled = [];
  const browserHosted = [];
  for (const g of games) {
    const out = join(dist, 'games', g.id);
    const started = Date.now();
    const { mode, warnings, bundle, chunks, rules } = await buildGameFiles(esbuild, root, g, out, { maps, cache, log, hashed: true, longCheck });
    if (rules) ruled.push({ id: g.id, ...rules }); else browserHosted.push(g.id);
    // The guides' vocabulary (NETPLAY.md section 18): checked here, so a room never meets a line it cannot say.
    vocabFor(g, out);
    // Room chat (NETPLAY.md section 19): game.json "chat", checked here (its quick lines pass the chat floor too).
    const chatBad = chatProblems(g.chat);
    if (chatBad.length) throw new Error(`games/${g.id}/game.json: ${chatBad.join('; ')}`);
    // A game's own decisions (NETPLAY.md section 20): game.json "decide" is true or false (the Worker answers net.decide only then).
    if (g.decide !== undefined && typeof g.decide !== 'boolean') throw new Error(`games/${g.id}/game.json: "decide" is true (the host may ask the studio's decision model, within the AI brains' day) or false`);
    // Where chat sits on the screen (game.json "screen": { "chat" }, 0.24.5): a wrong field is the default on the page.
    for (const p of screenChatProblems(g.screen?.chat)) log(`warning: games/${g.id}/game.json: ${p}; the play page uses the default there`);
    // A game.json written for an older toolkit may still carry the retired settings. They are ignored, never an
    // error (a studio that upgrades must still build); what they were is said once, after the games (below).
    const old = retiredKeys(g);
    if (old.length) retired.push(`games/${g.id}/game.json ${old.join(', ')}`);
    const bytes = bundle ? statSync(join(out, bundle)).size : dirBytes(out);
    const later = chunks.reduce((n, c) => n + statSync(join(out, c)).size, 0);
    const seats = seatsFor(g, netplayOf(g, out));
    if (seats.asked > SEAT_MAX) log(`warning: games/${g.id} asks for ${seats.asked} players; a room holds at most ${SEAT_MAX}, so its rooms have ${SEAT_MAX} seats`);
    built.push({
      id: g.id, name: g.name, mode, bytes, ms: Date.now() - started, warnings, seats: seats.max,
      ...(rules ? { capacityTrial: rules.check.capacityTrial } : {}),
      ...(bundle ? { bundle } : {}), ...(chunks.length ? { chunks: chunks.length, chunkBytes: later } : {}),
    });
    log(`built ${g.id} (${mode}, ${Math.round(bytes / 1024)} KB${chunks.length ? ` + ${chunks.length} additional ${chunks.length === 1 ? 'chunk' : 'chunks'}, ${Math.max(1, Math.round(later / 1024))} KB` : ''})`);
    if (rules && (rules.settings.offline || rules.settings.host === 'browser')) log(`${g.id}: this game's rules and tunables are sent to players' devices so it can be played offline`);
    if (rules) log(`  ${g.id}: its rules run ${rules.settings.host === 'browser' ? "in a player's browser" : 'on the server'} (checked and guarded, ${Math.max(1, Math.round(rules.code.length / 1024))} KB, build ${rules.build}; ${rules.check.ticks} ticks played, the room rebuilt from its save ${rules.check.restores} times: the busiest tick used ${rules.tickUnits} of ${rules.settings.budget.tick} budget units, ${rules.units} of them in one handler; the largest save was ${rules.check.largestSaveBytes} bytes)`);
    if (rules && rules.settings.host === 'server' && (rules.snapshotBytes > rules.snapshotCap || rules.checkpointBytes > rules.checkpointCap)) log(`  ${g.id}: this state fits server and offline play but exceeds browser hosting limits.`);
    if (rules) log(`  ${g.id}: smoke-run largest snapshot ${rules.snapshotBytes} B / ${rules.snapshotCap} B browser cap; checkpoint ${rules.checkpointBytes} B / ${rules.checkpointCap} B browser cap (measured, not an upper bound)`);
  }
  // A game written before rules (its own code is the host) builds and runs exactly as it did. Said in one line.
  if (browserHosted.length) log(`hosted by a player's browser, as before (no room object; nothing to do): ${browserHosted.join(', ')}`);
  const all = listGames(root);
  // No game is handed over whole any more (remix was retired; worker/license.mjs). A one-game build starts from the
  // site as it is, which an older toolkit may have built: what that wrote for remixers (a game's whole source, and
  // its assets' addresses) is taken out of every game's folder here. Only those two files as that toolkit wrote them,
  // told by their own `kind`: a game's own public/assets.json is the game's, and stays.
  for (const g of all) {
    for (const [f, kind] of [['source.json', 'homie-game-source'], ['assets.json', 'homie-game-assets']]) {
      const file = join(dist, 'games', g.id, f);
      if (existsSync(file) && statSync(file).size <= 8 * 1024 * 1024 && readJson(file)?.kind === kind) rmSync(file, { force: true });
    }
  }
  // Songs and videos (music/ and videos/ manifests): rebuilt with every full build; a one-game build keeps them.
  const r2 = Boolean(studio.cloudflare?.r2 && (studio.cloudflare?.created ?? []).includes(`r2:${studio.cloudflare.r2}`));
  let media = null;
  if (!only) media = buildMedia(root, dist, { r2, deploy, log });
  else {
    try { const prev = JSON.parse(readFileSync(join(dist, 'games.json'), 'utf8')); media = { songs: prev.songs ?? [], videos: prev.videos ?? [], skipped: [], notes: [] }; } catch { media = { songs: [], videos: [], skipped: [], notes: [] }; }
  }
  // The site around the games (site/SITE.md): the look, each game's landing, posts, and what site/ overrides.
  const theme = readTheme(root, { log });
  const s = studio.site && typeof studio.site === 'object' ? studio.site : {};
  // studio.json site.order: the catalogue's order is every listing's order.
  const shown = orderGames(all.filter((g) => existsSync(join(dist, 'games', g.id, 'index.html'))), s.order, log);
  // Server-hosted games: what this build made, and for a one-game build what the catalogue before it said of the others.
  const rulesOf = new Map(ruled.map((r) => [r.id, { host: r.settings.host, offline: r.settings.offline, tickHz: r.settings.tickHz, inputHz: r.settings.inputHz, contract: r.schema.contract, build: r.build, stateHash: r.stateHash, rounds: r.rounds }]));
  if (only) for (const row of readJson(join(dist, 'games.json'))?.games ?? []) if (row?.room?.contract && row.id !== only && !rulesOf.has(row.id)) rulesOf.set(row.id, row.room);
  // What each game's build is (its landing's own pictures are not part of it): the digest the manifest names.
  const builds = {};
  const rows = shown.map((g) => {
    // The seats come from the game's netplay manifest (NETPLAY.md §3): what the Worker gives every room of it.
    const net = netplayOf(g, join(dist, 'games', g.id));
    const { min, max } = seatsFor(g, net);
    const netRow = netplayRow(net);
    if (rulesOf.has(g.id)) netRow.row = { ...netRow.row, version: rulesOf.get(g.id).build };
    for (const p of netRow.problems) log(`warning: games/${g.id}/game.json: ${p}`);
    const seeds = serverSeeds(g, log);
    // The game's own palette (style.json, its art direction): the play page's buttons wear its paper and ink, so the
    // page's pills and the game's own HUD are one UI.
    const ui = uiOf(g);
    // Search engines and agents (0.27.0, worker/schema.mjs): its genre, when it came and last changed, and the owner's
    // own schema.org properties.
    const genre = genreOf(g, log);
    const dates = gameDates(root, g, log);
    const extras = schemaExtras(g.schema, { where: `games/${g.id}/game.json`, types: ['VideoGame', 'WebApplication'], log });
    // The landing first: it may put the game's cover into the build, which is part of what the digest names.
    const landing = landingOf(g, join(dist, 'games', g.id), { videos: media.videos, songs: media.songs, log });
    const dir = join(dist, 'games', g.id);
    const bundle = bundleOf(dir);
    builds[g.id] = { hash: gameDigest(dir), ...(bundle ? { bundle } : {}) };
    return {
      ...(g.kind === 'app' ? { kind: 'app', roles: g.roles, surfaces: g.surfaces, words: g.words, records: g.records, parts: g.parts ?? [], check: g.check } : {}),
      id: g.id, name: g.name ?? g.id, blurb: g.blurb ?? '', players: { min, max },
      ...(ui ? { ui } : {}),
      // A rules game's round is its rules' own (`room.rounds`), and its movement a per-kind choice there: game.json's
      // `roundSeconds` and `netplay.movement` are not read for it. `room` says where its rules run, to the Worker.
      roundSeconds: rulesOf.has(g.id) ? rulesOf.get(g.id).rounds?.seconds ?? null : g.roundSeconds ?? net.roundSeconds ?? null, movement: rulesOf.has(g.id) ? null : net.movement ?? null, cover: g.cover ?? null,
      ...(rulesOf.has(g.id) ? { room: rulesOf.get(g.id) } : {}),
      // game.json "netplay": { "version", "stallMs", "params" } (NETPLAY.md sections 22 to 24): the game's revision (a
      // room runs one build at a time), its own host stall time, and the address's switches its frame is handed.
      ...(netRow.row ? { netplay: netRow.row } : {}),
      ...(g.screen ? { screen: g.screen } : {}),
      ...(g.playerCard === false ? { playerCard: false } : {}),
      // game.json "saves": true — player accounts and cloud saves (saves/SAVES.md): the play shell answers the game's
      // saves calls, and the site's nav and the game's landing offer a player account.
      ...(g.saves === true || (g.saves && typeof g.saves === 'object') ? { saves: true } : {}),
      // game.json `"launch": "private" | "invite"`: the game's launch state until its owner sets one live (the office).
      ...(g.launch === 'private' || g.launch === 'invite' ? { launch: g.launch } : {}),
      // game.json `"watch"` (NETPLAY.md section 16): watchers see any player's view (the default), only the whole room
      // ("overview": hidden hands or roles), or nothing (false: no watch door).
      ...(g.watch === 'overview' ? { watch: 'overview' } : g.watch === false || g.watch === 'off' ? { watch: 'off' } : {}),
      // game.json `"chat"` (0.23.0, NETPLAY.md section 19): the room chat's defaults for this game (the owner's office
      // overrides them), or false for none.
      ...(g.chat === false ? { chat: false } : g.chat && typeof g.chat === 'object' ? { chat: g.chat } : {}),
      ...(g.decide === true ? { decide: true } : {}),
      // Servers (0.16.0): the seeds game.json ships, the netplay revision its build speaks (the office warns when it
      // predates servers), and game.json "agents": { "vote": "game" | false } (the game draws its own vote card, or none).
      ...(seeds.length ? { servers: seeds } : {}),
      netplayRev: netplayRevOf(join(dist, 'games', g.id)),
      // 0.17.0: the game has a vocabulary for its AI guides (agents.json), so they can talk once the owner says so.
      ...(existsSync(join(dist, 'games', g.id, 'agents.json')) ? { vocab: true } : {}),
      ...(g.agents && typeof g.agents === 'object' && (g.agents.vote === 'game' || g.agents.vote === false) ? { agents: { vote: g.agents.vote } } : {}),
      // The licence the game names for itself (an SPDX id, worker/license.mjs), when it names one; and, for a game
      // that was made from another studio's while that was possible (game.json `remixOf`), the credit it owes the
      // original, which its landing and credits keep showing.
      ...(licenseOf(g.license) ? { license: licenseOf(g.license) } : {}),
      ...(basedOnRow(g.remixOf) ? { basedOn: basedOnRow(g.remixOf) } : {}),
      ...(genre ? { genre } : {}),
      ...(dates ? { dates } : {}),
      ...(extras ? { schema: extras } : {}),
      landing,
      // What is built: its digest (the same one `perf` names a build by) and the bundle its page loads. The live
      // site says them in /.well-known/homie-studio.json, so "is the live game this build?" is one comparison.
      built: builds[g.id],
    };
  });
  const { posts, skipped: postsSkipped } = readPosts(root, { games: rows, songs: media.songs, videos: media.videos, log });
  const site = buildSiteFiles(root, dist, { gameIds: rows.map((g) => g.id), log });
  // Each game's Game Codex (games/<id>/CODEX.md), as the owner's private page at /_studio/codex/<id>/ (never listed).
  const codexes = buildCodexPages(root, dist, games.map((g) => g.id), { log });
  // GAME PARTS: every packed version of every SHARED part into dist/parts/, and its index; a private part is never copied.
  const partsBuilt = buildParts(root, dist, { studio, log });
  mkdirSync(join(dist, '_site'), { recursive: true });
  writeFileSync(join(dist, '_site', 'posts.json'), `${JSON.stringify({ v: 1, posts })}\n`);
  const studioExtras = schemaExtras(s.schema, { where: 'studio.json site', types: 'Organization', log });
  // The Lounge (0.29.0): studio.json "lounge", checked; off when a game already has /lounge/.
  for (const p of loungeProblems(studio, rows, chatProblems)) log(`warning: studio.json: ${p}`);
  const lounge = loungeConfig(studio, rows, { audience: audienceOf(studio) });
  const catalogue = {
    studio: {
      name: studio.name, slug: studio.slug, version: STUDIO_VERSION,
      ...(typeof studio.tagline === 'string' && studio.tagline.trim() ? { tagline: studio.tagline.trim().slice(0, 140) } : {}),
      theme,
      // studio.json "site": { "schema": { … } }: the owner's own schema.org properties on the studio (sameAs, …).
      ...(studioExtras ? { schema: studioExtras } : {}),
      site: {
        ...(/^@[A-Za-z0-9_]{1,15}$/.test(s.twitterSite || '') ? { twitterSite: s.twitterSite } : {}),
        ...(s.playerCard === false ? { playerCard: false } : {}),
        ...(Array.isArray(s.playerCardOrigins) ? { playerCardOrigins: playerOrigins(s.playerCardOrigins) } : {}),
        ...(rows.some((g) => g.id === s.featured) ? { featured: s.featured } : {}),
        ...(Array.isArray(s.frameAncestors) ? { frameAncestors: s.frameAncestors.filter((o) => /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(String(o))).slice(0, 8) } : {}),
      },
      // studio.json `stats.share`: the site tells the directory two numbers for the hub (played this week).
      ...(studio.stats?.share === true ? { stats: { share: true } } : {}),
      // studio.json `"rooms": { "share": false }`: the manifest names no rooms, so the hub shows none of this studio's.
      ...(studio.rooms?.share === false ? { rooms: { share: false } } : {}),
      // The directory the live site claims itself in (0.10.0); studio.json `homie.directory: false` keeps it out.
      // HOMIE_DIRECTORY (a build variable) points one build at another directory, such as a staging one.
      directory: /^https:\/\/[a-z0-9.-]+$/i.test(process.env.HOMIE_DIRECTORY ?? '') ? process.env.HOMIE_DIRECTORY
        : studio.homie?.directory === false || studio.homie?.directory === null ? null : String(studio.homie?.directory ?? 'https://homie.rocks'),
      // A copy of the public template that nobody has named yet shows the name typed in Cloudflare's form.
      ...(studio.template === true ? { template: true } : {}),
      // studio.json "audience": "kids" (a studio audience label; shop policies are optional) or "teens"; and "referrals": false
      // (this studio takes no referral statements as a referrer).
      ...(audienceOf(studio) !== 'general' ? { audience: audienceOf(studio) } : {}),
      ...(studio.referrals === false ? { referrals: false } : {}),
      ...(lounge ? { lounge } : {}),
      ...(studio.mcp ? { mcp: studio.mcp } : {}),
      build: buildInfo(root),
    },
    games: rows,
    songs: media.songs,
    videos: media.videos,
    // Summaries only; each post's HTML is in _site/posts.json.
    posts: posts.map(({ html, record, ...p }) => p),
    site: { pages: site.pages, partials: site.partials, ...(site.css ? { css: site.css } : {}) },
    // shop.json, checked (nothing secret is ever in it): the Worker sells from this and checks it again.
    ...(shop ? { shop } : {}),
  };
  for (const game of rows) {
    const image = await playerImage(catalogue, game, dist, log);
    if (image) game.playerImage = image;
  }
  writeFileSync(join(dist, 'games.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
  // What this build made, for whatever runs next (a deploy says which games it changes; a script checks the live
  // site against it): per game its digest, its bundle and chunks, and whether it differs from the build before.
  const changedOf = (id) => (!before[id]?.hash ? 'new' : before[id].hash === builds[id].hash ? 'unchanged' : 'changed');
  const report = {};
  for (const g of rows) {
    const dir = join(dist, 'games', g.id);
    const named = readJson(join(dir, 'bundle.json'));
    report[g.id] = { ...builds[g.id], ...(Array.isArray(named?.chunks) && named.chunks.length ? { chunks: named.chunks } : {}), changed: changedOf(g.id) };
  }
  writeFileSync(join(dist, '_site', 'build.json'), `${JSON.stringify({ v: 1, at: catalogue.studio.build.at, commit: catalogue.studio.build.commit, games: report }, null, 2)}\n`);
  for (const b of built) Object.assign(b, { hash: builds[b.id]?.hash ?? null, changed: report[b.id]?.changed ?? 'new' });
  // A deploy builds first and prints its own result, not the build's: so the build a deploy is about to ship says
  // here which games it changes and which build each is (`homie-studio build` prints the same from its result).
  if (deploy) for (const b of built) log(`  ${b.id}: ${b.changed}${b.changed === 'new' ? '' : ' since the last build here'}, build ${b.hash}`);
  // The rules of the server-hosted games, where the studio's Worker imports them (site/src/rules/). Written with the
  // site, never before: a game that did not build has left both as they were.
  await beforePublish();
  const hosted = (await rulesBuild()).writeRules(root, ruled, all.filter((g) => rulesOf.get(g.id)?.host === 'server').map((g) => g.id));
  await (await import('./worker-build.mjs')).buildWorker(root, esbuild);
  // All of it is there: now, and only now, it becomes site/dist (lib/stage.mjs).
  const swapped = swapIn(dist, live);
  return {
    ok: true, command: 'build', dist: live, games: built, catalogue: catalogue.games.map((g) => g.id),
    builds: report, swapped, ...(typed ? { types: typed } : {}), ...(hosted.length ? { hosted } : {}),
    // One plain note for the whole build, however many games and keys it is about (never one a key).
    ...(retired.length ? { retired: `Remix was retired, and games now build on each other through parts (pieces a studio shares; ask for a part, or see parts/PARTS.md). These settings no longer do anything and can be deleted: ${retired.join('; ')}. No game's source is served whole; a game made from another keeps its credit.` } : {}),
    songs: catalogue.songs.map((e) => e.slug), videos: catalogue.videos.map((e) => e.slug), mediaSkipped: media.skipped, mediaNotes: media.notes ?? [],
    posts: posts.map((p) => p.slug), postsSkipped, codexes, parts: partsBuilt, pages: site.pages, partials: Object.keys(site.partials), public: site.public.length, siteSkipped: site.skipped,
    landings: rows.map((g) => ({ id: g.id, hero: g.landing.hero.wide || g.landing.hero.tall ? 'footage' : g.landing.hero.wideImage ? 'art' : 'colours', credits: Boolean(g.landing.credits.original || g.landing.credits.people.length) })),
  };
}
