/**
 * @homie-rocks/studio 0.9.0: what the house studios found moving to 0.7.0, and what the hub asked for.
 *
 *   - the arcade knock (/__homie/call) is answered at the site's root, as it is under a game: `not-a-homie`;
 *   - the Games cards, the room rows and the directory's manifest show the landing's hero still, not an old cover;
 *   - a light game gets a light landing (game.json landing.scheme), so a white arena is not greyed by a dark tint;
 *   - the manifest: each game's own "played this week" when the studio shares, no `rooms` when it keeps them off
 *     the hub, a cover for every song that can have one; /api/rooms may be cached for 15 s.
 * Run: node --test packages/studio/test/hub-and-landing.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-hub-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

/** A studio with a static game (cover.jpg AND a landing still), a light one, and two songs. */
function studio(name, { share = false, rooms = true } = {}) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  const game = (id, extra = {}) => {
    write(dir, `games/${id}/game.json`, JSON.stringify({ id, name: id.replace(/-/g, ' '), blurb: `${id}.`, players: { min: 1, max: 6 }, roundSeconds: 120, build: { mode: 'static' }, cover: 'cover.jpg', ...extra }));
    write(dir, `games/${id}/index.html`, '<!doctype html><html><head><script src="./homie-port.js"></script></head><body></body></html>');
    write(dir, `games/${id}/cover.jpg`, 'an old cover');
    write(dir, `games/${id}/hero/wide.jpg`, 'the landing still');
  };
  game('rock-race', { landing: { pitch: 'Blast rocks.' } });
  game('white-field', { landing: { pitch: 'Tiles on white.', scheme: 'light', hero: { tint: 20 } } });
  write(dir, 'music/theme/theme.mp3', 'mp3');
  write(dir, 'music/night.jpg', 'album cover');
  write(dir, 'music/manifest.json', JSON.stringify({
    v: 1, cover: 'music/night.jpg',
    items: [
      { slug: 'theme', kind: 'song', title: 'Theme', published: true, files: [{ role: 'audio', path: 'music/theme/theme.mp3' }] },
      { slug: 'race-score', kind: 'score', title: 'Race score', published: true, for: { game: 'rock-race' }, files: [{ role: 'audio', path: 'music/theme/theme.mp3' }] },
    ],
  }));
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  if (share) s.stats = { share: true };
  if (!rooms) s.rooms = { share: false };
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(s, null, 2));
  return dir;
}

/** The studio Worker over the built site, with a Lobby of the given rooms and, when given, a D1 that answers the week's counts. */
async function siteOf(dir, { rooms = {}, week = null } = {}) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f) || !/\.[a-z0-9]+$/i.test(p)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    },
  };
  const LOBBY = { idFromName: (n) => n, get: (n) => ({ fetch: async (u) => new Response(JSON.stringify(new URL(u).pathname === '/rooms' ? { rooms: rooms[n] ?? [] } : { players: 0, rooms: 0, peak: { players: 0, room: 0 } })) }) };
  const DB = week && {
    prepare: (sql) => ({
      bind: () => ({
        first: async () => (/SELECT value FROM meta/.test(sql) ? null : { plays: week.total.plays, rounds: week.total.rounds }),
        all: async () => ({ results: Object.entries(week.games).map(([subject, v]) => ({ subject, ...v })) }),
        run: async () => ({}),
      }),
    }),
    batch: async () => [],
  };
  const env = { ASSETS, LOBBY, STUDIO_NAME: 'Night Owls', ...(DB ? { DB } : {}) };
  return (path, init = {}) => worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': 'homie-house-qa test', ...(init.headers ?? {}) } }), env, { waitUntil() {} });
}

test('the arcade knock is answered at the site\'s root (and under a game): not-a-homie, open to the game\'s opaque origin', async () => {
  const dir = studio('knock');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir);
  for (const path of ['/__homie/call', '/__homie/session', '/rock-race/__homie/call']) {
    const get = await site(path);
    assert.equal(get.status, 200, `${path}: a 200, so no browser logs a failed load`);
    assert.match(get.headers.get('content-type'), /^application\/json/, 'the arcade bridge reads a JSON refusal only');
    assert.equal(get.headers.get('access-control-allow-origin'), '*', 'the game frame is an opaque origin');
    assert.equal(get.headers.get('cache-control'), 'no-store');
    const body = await get.json();
    assert.equal(body.error, 'not-a-homie', 'the one answer that makes the bridge stop knocking');
    assert.equal(body.ok, false, 'a score call gets a refusal in words, never a success');
    const post = await site(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"t":"call","id":1,"name":"scores.submit","args":{}}' });
    assert.equal((await post.json()).error, 'not-a-homie');
    const pre = await site(path, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(pre.status, 204, 'a POST\'s preflight is answered');
    assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  }
  assert.equal((await site('/__homies')).status, 404, 'only /__homie and under it');
});

test('cards, room rows and the directory show the landing\'s hero still, never the old game.json cover', async () => {
  const dir = studio('stills');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir, { rooms: { 'rock-race': [{ name: 'pub-3', players: 2, at: 1 }] } });
  const games = await (await site('/games/')).text();
  assert.match(games, /<a class="art" href="\/rock-race\/"[^>]*><img src="\/games\/rock-race\/hero\/wide\.jpg"/);
  assert.doesNotMatch(games, /cover\.jpg/, 'no card shows the old cover');
  const home = await (await site('/')).text();
  assert.match(home, /<span class="thumb"><img src="\/games\/rock-race\/hero\/wide\.jpg"/, 'the live room\'s row too');
  const rooms = await (await site('/api/rooms')).json();
  assert.equal(rooms.rooms[0].cover, '/games/rock-race/hero/wide.jpg');
  const wk = await (await site('/.well-known/homie-studio.json')).json();
  assert.deepEqual(wk.games.map((g) => g.cover), ['https://owls.example/games/rock-race/hero/wide.jpg', 'https://owls.example/games/white-field/hero/wide.jpg']);
  // A game with no still of its own: its cover still shows.
  rmSync(join(dir, 'games/rock-race/hero'), { recursive: true });
  assert.equal(out(run(['build'], dir)).ok, true);
  const again = await (await (await siteOf(dir))('/.well-known/homie-studio.json')).json();
  assert.equal(again.games[0].cover, 'https://owls.example/games/rock-race/cover.jpg');
});

test('a light landing: a white or cream game is drawn light (its tint, its shade, its words), the rest of the studio stays dark', async () => {
  const dir = studio('light');
  assert.equal(out(run(['build'], dir)).ok, true);
  const cat = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  assert.equal(cat.games.find((g) => g.id === 'white-field').landing.scheme, 'light');
  assert.equal(cat.games.find((g) => g.id === 'rock-race').landing.scheme, undefined);
  const site = await siteOf(dir);
  const light = await (await site('/white-field/')).text();
  assert.match(light, /:root\{--bg:#f7f6f1;--fg:#15161d;/, 'a light background and dark words');
  assert.match(light, /color-scheme:light/);
  assert.match(light, /--glow-ink:color-mix\(in srgb,var\(--glow\) 45%,var\(--fg\)\)/, 'small coloured words stay readable on white');
  assert.match(light, /<body class="has-hero" data-page="landing" data-scheme="light">/);
  assert.match(light, /<meta name="theme-color" content="#f7f6f1">/);
  assert.match(light, /class="hero-media" data-hero-media style="--tint:20%"|class="hero-media drift" data-hero-media style="--tint:20%"/, 'its tint is the light background\'s');
  const dark = await (await site('/rock-race/')).text();
  assert.match(dark, /color-scheme:dark/);
  assert.match(dark, /--glow-ink:var\(--glow\);/);
  assert.match(dark, /data-scheme="dark"/);
  const home = await (await site('/')).text();
  assert.match(home, /color-scheme:dark/, 'the studio keeps its own look');
  // A landing's own colours still win over the scheme's, and its own accent gets ink worked out for it.
  const w = JSON.parse(readFileSync(join(dir, 'games/white-field/game.json'), 'utf8'));
  writeFileSync(join(dir, 'games/white-field/game.json'), JSON.stringify({ ...w, landing: { ...w.landing, theme: { bg: '#faf8ef', accent: '#8f7a66' } } }));
  assert.equal(out(run(['build'], dir)).ok, true);
  const own = await (await (await siteOf(dir))('/white-field/')).text();
  assert.match(own, /--bg:#faf8ef;--fg:#15161d;--hot:#8f7a66;/);
  assert.match(own, /--hot-ink:#ffffff/, 'light words on a dark accent');
  // A bad scheme is left out, with a warning.
  const j = JSON.parse(readFileSync(join(dir, 'games/rock-race/game.json'), 'utf8'));
  writeFileSync(join(dir, 'games/rock-race/game.json'), JSON.stringify({ ...j, landing: { ...j.landing, scheme: 'sepia' } }));
  const b = spawnSync(process.execPath, [CLI, 'build'], { cwd: dir, encoding: 'utf8' });
  assert.match(b.stderr, /landing\.scheme is "light" or "dark"; left out/);
});

test('the manifest: each game\'s own week when the studio shares, no rooms when it keeps them off the hub, and /api/rooms is cacheable', async () => {
  const quiet = studio('manifest-quiet');
  assert.equal(out(run(['build'], quiet)).ok, true);
  const a = await (await (await siteOf(quiet))('/.well-known/homie-studio.json')).json();
  assert.equal(a.rooms, 'https://owls.example/api/rooms', 'rooms are shared by default');
  assert.equal(a.played, undefined);
  assert.ok(a.games.every((g) => g.played === undefined), 'a studio that does not share says nothing of its week');
  const rooms = await (await siteOf(quiet))('/api/rooms');
  assert.equal(rooms.headers.get('cache-control'), 'public, max-age=15', 'a short-lived, cacheable answer for the hub');
  assert.equal(rooms.headers.get('access-control-allow-origin'), '*');

  const shared = studio('manifest-shared', { share: true, rooms: false });
  assert.equal(out(run(['build'], shared)).ok, true);
  const site = await siteOf(shared, { week: { total: { plays: 12, rounds: 5 }, games: { 'rock-race': { plays: 9, rounds: 4 }, 'retired-game': { plays: 3, rounds: 1 } } } });
  const b = await (await site('/.well-known/homie-studio.json')).json();
  assert.equal('rooms' in b, false, 'studio.json rooms.share false: the manifest names no rooms, so the hub shows none');
  assert.deepEqual(b.played, { days: 7, plays: 12, rounds: 5, to: b.played.to });
  assert.deepEqual(b.games.map((g) => [g.id, g.played]), [['rock-race', { days: 7, plays: 9, rounds: 4 }], ['white-field', { days: 7, plays: 0, rounds: 0 }]], 'every game, in the shape the hub reads; nobody played is 0');
  assert.equal((await site('/api/rooms')).status, 200, 'the studio\'s own pages still read its rooms');
});

test('song covers: a song\'s own, else the music manifest\'s, else its game\'s still, on its page, its card and in the manifest', async () => {
  const dir = studio('covers');
  assert.equal(out(run(['build'], dir)).ok, true);
  const cat = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  assert.deepEqual(cat.songs.map((e) => e.files.find((f) => f.role === 'cover')?.url), ['/music/night.jpg', '/music/night.jpg'], 'the manifest\'s cover for every song without one');
  assert.ok(existsSync(join(dir, 'site/dist/music/night.jpg')), 'copied into the site like any file');
  const site = await siteOf(dir);
  const page = await (await site('/music/theme/')).text();
  assert.match(page, /<section class="songhead has-cover">/);
  assert.match(page, /<img class="cover" src="\/music\/night\.jpg" alt="">/);
  assert.match(page, /<meta property="og:image" content="https:\/\/owls\.example\/music\/night\.jpg">/);
  const index = await (await site('/music/')).text();
  assert.match(index, /<span class="art"><img src="\/music\/night\.jpg"/);
  // No manifest cover: a song made for a game shows that game's still; one that is not stays without.
  const m = JSON.parse(readFileSync(join(dir, 'music/manifest.json'), 'utf8'));
  delete m.cover;
  writeFileSync(join(dir, 'music/manifest.json'), JSON.stringify(m));
  assert.equal(out(run(['build'], dir)).ok, true);
  const wk = await (await (await siteOf(dir))('/.well-known/homie-studio.json')).json();
  assert.deepEqual(wk.songs.map((e) => [e.slug, e.cover]), [['theme', null], ['race-score', 'https://owls.example/games/rock-race/hero/wide.jpg']]);
  const score = await (await (await siteOf(dir))('/music/race-score/')).text();
  assert.match(score, /<img class="cover" src="\/games\/rock-race\/hero\/wide\.jpg" alt="">/);
});
