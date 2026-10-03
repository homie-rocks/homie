/**
 * `homie-studio build` — every game in games/ bundled into site/dist, plus the
 * catalogue the Worker serves (games.json).
 *
 *   site/dist/games/<id>/index.html        the game's page (the Worker adds HOMIE_NET)
 *   site/dist/games/<id>/assets/main.js    its bundle (esbuild; @homie-rocks/studio/netplay inlined)
 *   site/dist/games/<id>/...               everything in games/<id>/public/
 *   site/dist/games/<id>/assets.json       its assets' licences and, for those a remix may carry, their address and SHA-256
 *                                          (games/<id>/assets/manifest.json; lib/asset-manifest.mjs servedAssets)
 *   site/dist/games/<id>/agents.json       the AI guides' vocabulary (games/<id>/agents.json, checked; NETPLAY.md
 *                                          section 18): the only goals and lines an AI in its rooms has
 *   site/dist/games.json                   { studio, games[], songs[], videos[], posts[], site, shop } from studio.json,
 *                                          game.json files, the music/ and videos/ manifests (media/MEDIA.md),
 *                                          posts/*.md, the studio's site/ folder (site/SITE.md) and shop.json (checked
 *                                          against the kit's rules: a shop that breaks them stops the build)
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
 * game.json "build" picks how a game becomes files (a ported game keeps its own shape):
 *   (absent) / { "mode": "bundle" }   src/main.ts (or "entry") bundled by esbuild — new games and ES-module ports
 *   { "mode": "static" }              the folder copied as it is (plain <script> games), plus homie-port.js,
 *                                     the port toolkit as one classic script (window.HomiePort); an "entry"
 *                                     is bundled to assets/main.js as well
 *   { "mode": "command", "command": "npm run build", "out": "dist" }
 *                                     the game's own build (Vite, webpack…), then its output copied; base must be './'
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { buildCodexPages } from './codex.mjs';
import { servedAssets } from './asset-manifest.mjs';
import { buildMedia } from './media.mjs';
import { buildSiteFiles, landingOf, readPosts, readTheme } from './site.mjs';
import { PACKAGE_ROOT, listGames, readStudio } from './studio.mjs';
import { SEAT_MAX } from '../worker/seats.mjs';
import { STUDIO_VERSION } from './version.mjs';
import { licenseOf, remixRow } from '../worker/license.mjs';
import { SERVER_LIMITS, serverOf } from '../worker/servers.mjs';
import { chatProblems } from '../worker/chat.mjs';
import { vocabularyOf } from '../worker/brain.mjs';
import { shopForBuild } from './shop.mjs';
import { audienceOf } from '../worker/shop-rules.mjs';

const SOURCE_SKIP = new Set(['node_modules', 'dist', '.git', '.wrangler', '.port']);
/** Never copied into a static game's served folder. */
const STATIC_SKIP = new Set(['node_modules', '.git', '.wrangler', '.port', '.DS_Store', 'game.json', 'PORT.md', 'CODEX.md', 'lab.json', 'codex']);
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
const TEXT = /\.(ts|tsx|js|mjs|jsx|json|html|css|md|txt|svg|glsl|wgsl|frag|vert)$/i;
/**
 * Text files of a game folder, capped (2 MB total, 512 KB each): what `homie-studio game remix` takes; with who made
 * it (`credit`: the studio and the game; the live site adds the page, worker/index.mjs) and its licence (game.json
 * "license", worker/license.mjs).
 */
/** From games/<id>/style.json: the light colour as paper, the dark as text, and the accent; null without one. */
function uiOf(g) {
  let pal = null;
  try { pal = JSON.parse(readFileSync(join(g.dir, 'style.json'), 'utf8'))?.palette ?? null; } catch { pal = null; }
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v).toLowerCase() : null);
  const ink = hex(pal?.ink); const bg = hex(pal?.bg);
  if (!ink || !bg) return null;
  const lum = (h) => (0.2126 * parseInt(h.slice(1, 3), 16) + 0.7152 * parseInt(h.slice(3, 5), 16) + 0.0722 * parseInt(h.slice(5, 7), 16)) / 255;
  const light = lum(ink) >= lum(bg);
  return { paper: light ? ink : bg, text: light ? bg : ink, ...(hex(pal?.accent) ? { hot: hex(pal.accent) } : {}) };
}

export function sourceOf(dir, id, { studio = null, game = null, license } = {}) {
  const files = {};
  let total = 0;
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      // The codex (CODEX.md, and codex/: the art-direction decisions and the style board) is the owner's, never shared.
      if (entry.name.startsWith('.') || SOURCE_SKIP.has(entry.name) || (!rel && (entry.name === 'CODEX.md' || entry.name === 'codex'))) continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (TEXT.test(entry.name)) {
        const text = readFileSync(join(dir, path), 'utf8');
        if (text.length > 512 * 1024 || total + text.length > 2 * 1024 * 1024) continue;
        files[path] = text;
        total += text.length;
      }
    }
  };
  walk('');
  return { v: 1, kind: 'homie-game-source', id, credit: { studio, game: game ?? id }, license: licenseOf(license), files };
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
  const asked = named ?? 8;
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
function keepMap(root, id, out, metafile) {
  const dir = join(root, '.studio', 'maps', id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const map = join(out, 'assets', 'main.js.map');
  if (existsSync(map)) { cpSync(map, join(dir, 'main.js.map')); rmSync(map, { force: true }); }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(metafile ?? {}));
  writeFileSync(join(dir, 'main.js.sha256'), `${createHash('sha256').update(readFileSync(join(out, 'assets', 'main.js'))).digest('hex')}\n`);
}

/** esbuild, as the studio has it installed (the version its package.json pins). */
export async function studioEsbuild(root) {
  const require = createRequire(join(root, 'package.json'));
  try { return require('esbuild'); } catch { return import('esbuild'); }
}

/**
 * One game's own files into `out` (emptied first): its bundle, static copy or own build's output, its index.html and
 * its public/ folder. What `build` serves at /games/<id>/, and what the Game Lab (lib/lab.mjs) builds New and Today
 * with. `sourcemap` is esbuild's (the lab keeps a linked map beside its builds); `maps` keeps the site build's map in
 * .studio/maps/<id>/. Returns { mode, warnings, metafile } (metafile: the bundle's inputs, null for other modes).
 */
export async function buildGameFiles(esbuild, root, g, out, { maps = false, sourcemap = null, cache = {}, log = () => {} } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  const mode = g.build?.mode ?? 'bundle';
  let warnings = 0;
  let metafile = null;
  const bundle = async (entryRel) => {
    const entry = join(g.dir, entryRel);
    if (!existsSync(entry)) throw new Error(`games/${g.id}: entry ${entryRel} not found`);
    const result = await esbuild.build({
      entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: sourcemap ?? (maps ? 'external' : false),
      outfile: join(out, 'assets', 'main.js'), absWorkingDir: root, logLevel: 'silent', metafile: true,
      loader: LOADERS, assetNames: '[name]-[hash]',
    }).catch((error) => {
      const first = error.errors?.[0];
      throw new Error(`games/${g.id} did not build: ${first ? `${first.text}${first.location ? ` (${first.location.file}:${first.location.line})` : ''}` : error.message}`);
    });
    warnings += result.warnings.length;
    metafile = result.metafile;
    if (maps) keepMap(root, g.id, out, result.metafile);
  };
  if (mode === 'static') {
    copyStatic(g.dir, out);
    writeFileSync(join(out, 'homie-port.js'), await portScript(esbuild, root, cache));
    if (g.entry) await bundle(g.entry);
    const html = readFileSync(join(out, 'index.html'), 'utf8');
    if (!/homie-port\.js/.test(html)) log(`warning: games/${g.id}/index.html does not load ./homie-port.js (the port toolkit); add <script src="./homie-port.js"></script> first in <head>`);
  } else if (mode === 'command') {
    const command = String(g.build.command ?? 'npm run build');
    const res = spawnSync(command, { cwd: g.dir, shell: true, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(`games/${g.id}: \`${command}\` failed: ${`${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-6).join(' ')}`);
    const built = join(g.dir, String(g.build.out ?? 'dist'));
    if (!existsSync(join(built, 'index.html'))) throw new Error(`games/${g.id}: \`${command}\` left no index.html in ${relative(g.dir, built) || '.'}`);
    cpSync(built, out, { recursive: true });
    writeFileSync(join(out, 'homie-port.js'), await portScript(esbuild, root, cache));
  } else {
    await bundle(g.entry ?? 'src/main.ts');
    const html = join(g.dir, 'index.html');
    if (!existsSync(html)) throw new Error(`games/${g.id}/index.html is missing`);
    writeFileSync(join(out, 'index.html'), readFileSync(html, 'utf8'));
  }
  if (mode !== 'static' && existsSync(join(g.dir, 'public'))) cpSync(join(g.dir, 'public'), out, { recursive: true });
  if (!existsSync(join(out, 'index.html'))) throw new Error(`games/${g.id}/index.html is missing`);
  return { mode, warnings, metafile };
}

export async function build(root, { only = null, log = () => {}, deploy = process.env.WORKERS_CI === '1', maps = false } = {}) {
  const esbuild = await studioEsbuild(root);
  const studio = readStudio(root);
  // The shop first (shop/SHOP.md): a shop.json that breaks the kit's rules stops the build before anything is built.
  const shop = shopForBuild(root, { log });
  const dist = join(root, 'site', 'dist');
  const games = listGames(root).filter((g) => !only || g.id === only);
  if (only && !games.length) throw new Error(`no game "${only}" in games/`);
  if (!only) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const built = [];
  const cache = {};
  for (const g of games) {
    const out = join(dist, 'games', g.id);
    const started = Date.now();
    const { mode, warnings } = await buildGameFiles(esbuild, root, g, out, { maps, cache, log });
    // The guides' vocabulary (NETPLAY.md section 18): checked here, so a room never meets a line it cannot say.
    vocabFor(g, out);
    // Room chat (NETPLAY.md section 19): game.json "chat", checked here (its quick lines pass the chat floor too).
    const chatBad = chatProblems(g.chat);
    if (chatBad.length) throw new Error(`games/${g.id}/game.json: ${chatBad.join('; ')}`);
    // The game's own source, for other studios to remix (game.json "share": { "source": false } keeps it private).
    if (g.share?.source !== false) writeFileSync(join(out, 'source.json'), `${JSON.stringify(sourceOf(g.dir, g.id, { studio: studio.name ?? null, game: g.name ?? g.id, license: g.license }))}\n`);
    // Its assets' licences, and the address and SHA-256 of each one a remix may carry (`game remix` fetches them).
    if (g.share?.source !== false && existsSync(join(g.dir, 'assets', 'manifest.json'))) writeFileSync(join(out, 'assets.json'), `${JSON.stringify(servedAssets(root, g.id, out))}\n`);
    else rmSync(join(out, 'assets.json'), { force: true });
    const main = join(out, 'assets', 'main.js');
    const bytes = existsSync(main) ? statSync(main).size : dirBytes(out);
    const seats = seatsFor(g, netplayOf(g, out));
    if (seats.asked > SEAT_MAX) log(`warning: games/${g.id} asks for ${seats.asked} players; a room holds at most ${SEAT_MAX}, so its rooms have ${SEAT_MAX} seats`);
    built.push({ id: g.id, name: g.name, mode, bytes, ms: Date.now() - started, warnings, seats: seats.max });
    log(`built ${g.id} (${mode}, ${Math.round(bytes / 1024)} KB)`);
  }
  const all = listGames(root);
  // Songs and videos (music/ and videos/ manifests): rebuilt with every full build; a one-game build keeps them.
  const r2 = Boolean(studio.cloudflare?.r2 && (studio.cloudflare?.created ?? []).includes(`r2:${studio.cloudflare.r2}`));
  let media = null;
  if (!only) media = buildMedia(root, dist, { r2, deploy, log });
  else {
    try { const prev = JSON.parse(readFileSync(join(dist, 'games.json'), 'utf8')); media = { songs: prev.songs ?? [], videos: prev.videos ?? [], skipped: [], notes: [] }; } catch { media = { songs: [], videos: [], skipped: [], notes: [] }; }
  }
  // The site around the games (site/SITE.md): the look, each game's landing, posts, and what site/ overrides.
  const theme = readTheme(root, { log });
  const shown = all.filter((g) => existsSync(join(dist, 'games', g.id, 'index.html')));
  const rows = shown.map((g) => {
    // The seats come from the game's netplay manifest (NETPLAY.md §3): what the Worker gives every room of it.
    const net = netplayOf(g, join(dist, 'games', g.id));
    const { min, max } = seatsFor(g, net);
    const seeds = serverSeeds(g, log);
    // The game's own palette (style.json, its art direction): the play page's buttons wear its paper and ink, so the
    // page's pills and the game's own HUD are one UI.
    const ui = uiOf(g);
    return {
      id: g.id, name: g.name ?? g.id, blurb: g.blurb ?? '', players: { min, max },
      ...(ui ? { ui } : {}),
      roundSeconds: g.roundSeconds ?? net.roundSeconds ?? null, movement: net.movement ?? null, cover: g.cover ?? null,
      ...(g.screen ? { screen: g.screen } : {}),
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
      // Servers (0.16.0): the seeds game.json ships, the netplay revision its build speaks (the office warns when it
      // predates servers), and game.json "agents": { "vote": "game" | false } (the game draws its own vote card, or none).
      ...(seeds.length ? { servers: seeds } : {}),
      netplayRev: netplayRevOf(join(dist, 'games', g.id)),
      // 0.17.0: the game has a vocabulary for its AI guides (agents.json), so they can talk once the owner says so.
      ...(existsSync(join(dist, 'games', g.id, 'agents.json')) ? { vocab: true } : {}),
      ...(g.agents && typeof g.agents === 'object' && (g.agents.vote === 'game' || g.agents.vote === false) ? { agents: { vote: g.agents.vote } } : {}),
      // Its source licence (worker/license.mjs), and, for a remix, what it is a remix of (shown on its landing).
      license: licenseOf(g.license),
      ...(remixRow(g.remixOf) ? { remixOf: remixRow(g.remixOf) } : {}),
      landing: landingOf(g, join(dist, 'games', g.id), { videos: media.videos, songs: media.songs, log }),
    };
  });
  const { posts, skipped: postsSkipped } = readPosts(root, { games: rows, songs: media.songs, videos: media.videos, log });
  const site = buildSiteFiles(root, dist, { gameIds: rows.map((g) => g.id), log });
  // Each game's Game Codex (games/<id>/CODEX.md), as the owner's private page at /_studio/codex/<id>/ (never listed).
  const codexes = buildCodexPages(root, dist, games.map((g) => g.id), { log });
  mkdirSync(join(dist, '_site'), { recursive: true });
  writeFileSync(join(dist, '_site', 'posts.json'), `${JSON.stringify({ v: 1, posts })}\n`);
  const s = studio.site && typeof studio.site === 'object' ? studio.site : {};
  const catalogue = {
    studio: {
      name: studio.name, slug: studio.slug, version: STUDIO_VERSION,
      ...(typeof studio.tagline === 'string' && studio.tagline.trim() ? { tagline: studio.tagline.trim().slice(0, 140) } : {}),
      theme,
      site: {
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
      // studio.json "audience": "kids" (a studio made for children: no shop at all) or "teens"; and "referrals": false
      // (this studio takes no referral statements as a referrer).
      ...(audienceOf(studio) !== 'general' ? { audience: audienceOf(studio) } : {}),
      ...(studio.referrals === false ? { referrals: false } : {}),
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
  writeFileSync(join(dist, 'games.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
  return {
    ok: true, command: 'build', dist, games: built, catalogue: catalogue.games.map((g) => g.id),
    songs: catalogue.songs.map((e) => e.slug), videos: catalogue.videos.map((e) => e.slug), mediaSkipped: media.skipped, mediaNotes: media.notes ?? [],
    posts: posts.map((p) => p.slug), postsSkipped, codexes, pages: site.pages, partials: Object.keys(site.partials), public: site.public.length, siteSkipped: site.skipped,
    landings: rows.map((g) => ({ id: g.id, hero: g.landing.hero.wide || g.landing.hero.tall ? 'footage' : g.landing.hero.wideImage ? 'art' : 'colours', credits: Boolean(g.landing.credits.original || g.landing.credits.people.length), source: g.landing.source })),
  };
}
