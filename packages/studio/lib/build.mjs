/**
 * `homie-studio build` — every game in games/ bundled into site/dist, plus the
 * catalogue the Worker serves (games.json).
 *
 *   site/dist/games/<id>/index.html        the game's page (the Worker adds HOMIE_NET)
 *   site/dist/games/<id>/assets/main.js    its bundle (esbuild; @homie-rocks/studio/netplay inlined)
 *   site/dist/games/<id>/...               everything in games/<id>/public/
 *   site/dist/games.json                   { studio, games[], songs[], videos[], posts[], site } from studio.json,
 *                                          game.json files, the music/ and videos/ manifests (media/MEDIA.md),
 *                                          posts/*.md and the studio's site/ folder (site/SITE.md)
 *   site/dist/games/<id>/_landing/...      what the game's landing shows (hero footage, its cover, licence texts)
 *   site/dist/_site/                       posts.json (the posts' HTML), the studio's own pages (site/pages)
 *   site/dist/<file>                       site/public, as it is (fonts, a logo, hero footage)
 *   site/dist/music/..., site/dist/videos/...   media files the site serves itself (R2 keys are served from R2)
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
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { buildMedia } from './media.mjs';
import { buildSiteFiles, landingOf, readPosts, readTheme } from './site.mjs';
import { PACKAGE_ROOT, listGames, readStudio } from './studio.mjs';
import { SEAT_MAX } from '../worker/seats.mjs';
import { STUDIO_VERSION } from './version.mjs';

const SOURCE_SKIP = new Set(['node_modules', 'dist', '.git', '.wrangler', '.port']);
/** Never copied into a static game's served folder. */
const STATIC_SKIP = new Set(['node_modules', '.git', '.wrangler', '.port', '.DS_Store', 'game.json', 'PORT.md']);
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
/** Text files of a game folder, capped (2 MB total, 512 KB each): what `homie-studio game remix` takes. */
export function sourceOf(dir, id) {
  const files = {};
  let total = 0;
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SOURCE_SKIP.has(entry.name)) continue;
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
  return { v: 1, kind: 'homie-game-source', id, files };
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * A game's netplay manifest: game.json's `netplay` block, over a `netplay.json` beside game.json or in the game's
 * built output (a ported Vite game ships public/netplay.json), over nothing.
 */
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

export async function build(root, { only = null, log = () => {} } = {}) {
  const require = createRequire(join(root, 'package.json'));
  let esbuild;
  try { esbuild = require('esbuild'); } catch { esbuild = await import('esbuild'); }
  const studio = readStudio(root);
  const dist = join(root, 'site', 'dist');
  const games = listGames(root).filter((g) => !only || g.id === only);
  if (only && !games.length) throw new Error(`no game "${only}" in games/`);
  if (!only) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const built = [];
  const cache = {};
  for (const g of games) {
    const out = join(dist, 'games', g.id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'assets'), { recursive: true });
    const mode = g.build?.mode ?? 'bundle';
    const started = Date.now();
    let warnings = 0;
    const bundle = async (entryRel) => {
      const entry = join(g.dir, entryRel);
      if (!existsSync(entry)) throw new Error(`games/${g.id}: entry ${entryRel} not found`);
      const result = await esbuild.build({
        entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: false,
        outfile: join(out, 'assets', 'main.js'), absWorkingDir: root, logLevel: 'silent', metafile: true,
        loader: LOADERS, assetNames: '[name]-[hash]',
      }).catch((error) => {
        const first = error.errors?.[0];
        throw new Error(`games/${g.id} did not build: ${first ? `${first.text}${first.location ? ` (${first.location.file}:${first.location.line})` : ''}` : error.message}`);
      });
      warnings += result.warnings.length;
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
    // The game's own source, for other studios to remix (game.json "share": { "source": false } keeps it private).
    if (g.share?.source !== false) writeFileSync(join(out, 'source.json'), `${JSON.stringify(sourceOf(g.dir, g.id))}\n`);
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
  if (!only) media = buildMedia(root, dist, { r2, log });
  else {
    try { const prev = JSON.parse(readFileSync(join(dist, 'games.json'), 'utf8')); media = { songs: prev.songs ?? [], videos: prev.videos ?? [], skipped: [] }; } catch { media = { songs: [], videos: [], skipped: [] }; }
  }
  // The site around the games (site/SITE.md): the look, each game's landing, posts, and what site/ overrides.
  const theme = readTheme(root, { log });
  const shown = all.filter((g) => existsSync(join(dist, 'games', g.id, 'index.html')));
  const rows = shown.map((g) => {
    // The seats come from the game's netplay manifest (NETPLAY.md §3): what the Worker gives every room of it.
    const net = netplayOf(g, join(dist, 'games', g.id));
    const { min, max } = seatsFor(g, net);
    return {
      id: g.id, name: g.name ?? g.id, blurb: g.blurb ?? '', players: { min, max },
      roundSeconds: g.roundSeconds ?? net.roundSeconds ?? null, movement: net.movement ?? null, cover: g.cover ?? null,
      ...(g.screen ? { screen: g.screen } : {}),
      landing: landingOf(g, join(dist, 'games', g.id), { videos: media.videos, songs: media.songs, log }),
    };
  });
  const { posts, skipped: postsSkipped } = readPosts(root, { games: rows, songs: media.songs, videos: media.videos, log });
  const site = buildSiteFiles(root, dist, { gameIds: rows.map((g) => g.id), log });
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
      ...(studio.stats?.share === true ? { stats: { share: true }, directory: studio.homie?.directory ?? 'https://homie.rocks' } : {}),
    },
    games: rows,
    songs: media.songs,
    videos: media.videos,
    // Summaries only; each post's HTML is in _site/posts.json.
    posts: posts.map(({ html, record, ...p }) => p),
    site: { pages: site.pages, partials: site.partials, ...(site.css ? { css: site.css } : {}) },
  };
  writeFileSync(join(dist, 'games.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
  return {
    ok: true, command: 'build', dist, games: built, catalogue: catalogue.games.map((g) => g.id),
    songs: catalogue.songs.map((e) => e.slug), videos: catalogue.videos.map((e) => e.slug), mediaSkipped: media.skipped,
    posts: posts.map((p) => p.slug), postsSkipped, pages: site.pages, partials: Object.keys(site.partials), public: site.public.length, siteSkipped: site.skipped,
    landings: rows.map((g) => ({ id: g.id, hero: g.landing.hero.wide || g.landing.hero.tall ? 'footage' : g.landing.hero.wideImage ? 'art' : 'colours', credits: Boolean(g.landing.credits.original || g.landing.credits.people.length), source: g.landing.source })),
  };
}
