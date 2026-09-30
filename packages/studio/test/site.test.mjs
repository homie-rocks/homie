/**
 * @homie-rocks/studio 0.7.0: a studio site has the hub's shape, and every game gets a landing.
 *
 *   - the sections (Home, Games, Music, Videos, Rooms, Posts), each only when the studio has something in it:
 *     an empty one has no tab and its page answers 404;
 *   - every game's landing from its own files (footage or its cover, the pitch, Play, phone / computer / TV with
 *     the join code, live rooms, how to play, credits, "Make a game like this");
 *   - posts from posts/*.md (safe markdown), with Atom and JSON feeds and a record for atproto later;
 *   - what a studio puts in site/ wins: a whole page, a partial, its tokens and CSS, its files;
 *   - every HTML answer is no-transform and never framed by another site; "Made with Homie" is on every page.
 * Run: node --test packages/studio/test/site.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, safeUrl } from '../lib/markdown.mjs';
import { PALETTES, frontmatter, isoDate, paletteFor, readTheme } from '../lib/site.mjs';
import { STUDIO_VERSION_TAG } from '../worker/version.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-pages-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

/** The studio Worker over a built site folder, with a Lobby that reports the given rooms per game. */
async function siteOf(dir, rooms = {}) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f) || !/\.[a-z0-9]+$/i.test(p)) return new Response('not found', { status: 404 });
      const type = p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
      return new Response(readFileSync(f), { headers: { 'content-type': type } });
    },
  };
  const LOBBY = {
    idFromName: (n) => n,
    get: (n) => ({ fetch: async (u) => {
      const path = new URL(u).pathname;
      if (path === '/rooms') return new Response(JSON.stringify({ rooms: rooms[n] ?? [] }));
      if (path === '/now') return new Response(JSON.stringify({ players: 0, rooms: 0, peak: { players: 0, room: 0 } }));
      return new Response(JSON.stringify({ room: 'pub-9', players: 0, max: 8 }));
    } }),
  };
  return (path, init = {}) => worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': 'homie-house-qa test', ...(init.headers ?? {}) } }), { ASSETS, LOBBY, STUDIO_NAME: 'Night Owls' }, { waitUntil() {} });
}

test('markdown: a post can never run a script or link to javascript:, and emphasis never breaks an address', () => {
  const { html, text } = renderMarkdown('# Live\nHello <script>alert(1)</script> **bold** [a_b_c](https://x.example/a_b_c?q=1&r=2) [bad](javascript:alert) ![x](http://plain.example/x.png) ![y](/games/g/cover.jpg)\n\n- one\n- two\n\n> said\n\n```\n<b>code</b>\n```');
  assert.match(html, /<h2>Live<\/h2>/, '# is h2: the page\'s title is the one h1');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|javascript:|http:\/\/plain/);
  assert.match(html, /<a href="https:\/\/x\.example\/a_b_c\?q=1&amp;r=2" rel="noopener">a_b_c<\/a>/);
  assert.match(html, /<img src="\/games\/g\/cover\.jpg" alt="y"/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<blockquote><p>said<\/p><\/blockquote>/);
  assert.match(html, /<pre><code>&lt;b&gt;code&lt;\/b&gt;<\/code><\/pre>/);
  assert.match(text, /^Live Hello <script>alert\(1\)<\/script> bold a_b_c/);
  assert.equal(safeUrl('/posts/x/'), '/posts/x/');
  assert.equal(safeUrl('//evil.example/x'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.deepEqual(frontmatter('---\ntitle: "Hi: there"\ndraft: true\n---\nbody')[0], { title: 'Hi: there', draft: true });
  assert.equal(isoDate('2026-09-30'), '2026-09-30T00:00:00.000Z');
  assert.equal(isoDate('2026-09-30T10:15'), '2026-09-30T10:15:00.000Z');
  assert.equal(isoDate('yesterday'), null);
});

test('theme: a new studio gets a palette of its own in site/theme.json; unsafe values never reach the stylesheet', () => {
  const dir = studio('themes');
  const theme = JSON.parse(readFileSync(join(dir, 'site/theme.json'), 'utf8'));
  assert.equal(theme.palette, paletteFor('night-owls'));
  assert.deepEqual({ bg: theme.bg, fg: theme.fg, accent: theme.accent, glow: theme.glow }, PALETTES[theme.palette]);
  assert.ok(existsSync(join(dir, 'site/README.md')), 'site/README.md says what site/ overrides');
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /## The site/);
  assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((s) => paletteFor(`studio-${s}`))).size >= 4, 'new studios do not all look the same');
  writeFileSync(join(dir, 'site/theme.json'), JSON.stringify({ bg: '#fff}body{x', accent: '#ffcf5a', display: '"Anton"; }', fonts: [{ family: 'Anton', src: '/fonts/anton.woff2', weight: '400' }, { family: 'Bad', src: 'javascript:x' }], radius: 99 }));
  const warnings = [];
  const t = readTheme(dir, { log: (l) => warnings.push(l) });
  assert.equal(t.bg, PALETTES.gold.bg, 'a colour that is not a colour falls back');
  assert.equal(t.accent, '#ffcf5a');
  assert.equal(t.accentInk, '#0b0b10', 'dark words on a light accent');
  assert.equal(t.display, undefined);
  assert.deepEqual(t.fonts, [{ family: 'Anton', src: '/fonts/anton.woff2', weight: '400', style: 'normal' }]);
  assert.equal(t.radius, undefined);
  assert.ok(warnings.length >= 4, warnings.join('\n'));
});

function arcadeLike(name) {
  const dir = studio(name);
  assert.equal(out(run(['game', 'new', 'crown-thief', '--from', 'gem-rush', '--name', 'Crown Thief'], dir)).ok, true);
  // A ported static game with its cover, credits.json, a licence file and its own hero footage.
  write(dir, 'games/rock-race/game.json', JSON.stringify({
    id: 'rock-race', name: 'Rock <Race>', blurb: 'Six ships, one rock field.', players: { min: 1, max: 6 }, roundSeconds: 120,
    build: { mode: 'static' }, netplay: { v: 1, public: true, movement: 'owner' }, cover: 'cover.jpg',
    landing: { pitch: 'Blast rocks, not friends.', about: 'A score race on one wrap-around field.', howToPlay: ['Steer with the stick', 'Fire at the edge'], hero: { alt: 'Ships trade fire' }, players: { one: 'pilot', many: 'pilots' }, credits: [{ role: 'Port', name: 'Night Owls' }] },
  }));
  write(dir, 'games/rock-race/index.html', '<!doctype html><html><head><script src="./homie-port.js"></script><title>Rock Race</title></head><body><canvas></canvas></body></html>');
  write(dir, 'games/rock-race/cover.jpg', 'jpeg-bytes');
  write(dir, 'games/rock-race/hero/wide.mp4', 'wide-footage');
  write(dir, 'games/rock-race/hero/tall.mp4', 'tall-footage');
  write(dir, 'games/rock-race/hero/wide.jpg', 'still');
  write(dir, 'games/rock-race/LICENSE', 'MIT License\n\nCopyright (c) the original authors');
  write(dir, 'games/rock-race/credits.json', JSON.stringify({
    v: 1, id: 'rock-race', controls: { computer: 'Arrows and Space', phone: 'Stick left, FIRE right' },
    original: { title: 'Rocks', author: 'An Author', year: '2010', url: 'https://example.com/rocks', licence: 'MIT', licenceFile: 'LICENSE' },
    parts: [{ what: 'laser.wav', author: 'Someone', url: 'https://example.com/laser', licence: 'CC BY 3.0', licenceUrl: 'https://creativecommons.org/licenses/by/3.0/' }],
  }));
  write(dir, 'posts/2026-09-29-we-are-live.md', '---\ntitle: We are <live>\nsummary: Two games, public rooms.\ngame: rock-race\nimage: /games/rock-race/cover.jpg\n---\n\nPress **Play**. [Rooms](/rooms/)\n\n<script>alert(1)</script>\n');
  write(dir, 'posts/2026-09-30-crown-thief.md', '---\ntitle: Crown Thief is out\ndate: 2026-09-30T12:00\ngame: crown-thief\nsong: nope\n---\nSteal the crown.\n');
  write(dir, 'posts/2026-09-28-draft.md', '---\ntitle: Soon\ndraft: true\n---\nnot yet');
  write(dir, 'posts/undated.md', '---\ntitle: No date\n---\nbody');
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  s.tagline = 'Games for night owls';
  s.site = { featured: 'rock-race', frameAncestors: ['https://hub.example', 'http://insecure.example'] };
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(s, null, 2));
  return dir;
}

test('build: the landing facts come from each game\'s own files; posts are dated, drafts and undated ones are left out', () => {
  const dir = arcadeLike('build');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual(b.posts, ['crown-thief', 'we-are-live'], 'newest first');
  assert.deepEqual(b.postsSkipped.map((p) => p.post).sort(), ['2026-09-28-draft.md', 'undated.md']);
  assert.deepEqual(b.landings.find((l) => l.id === 'rock-race'), { id: 'rock-race', hero: 'footage', credits: true, source: true });
  assert.equal(b.landings.find((l) => l.id === 'crown-thief').hero, 'colours', 'a starter with no art gets the studio\'s colours');
  const cat = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  const rock = cat.games.find((g) => g.id === 'rock-race');
  assert.equal(rock.landing.hero.wide, '/games/rock-race/hero/wide.mp4', 'a static game\'s own copy is served, not a second one');
  assert.equal(rock.landing.hero.tall, '/games/rock-race/hero/tall.mp4');
  assert.equal(rock.landing.hero.wideImage, '/games/rock-race/hero/wide.jpg');
  assert.equal(existsSync(join(dir, 'site/dist/games/rock-race/_landing/wide.mp4')), false);
  assert.equal(rock.landing.cover, '/games/rock-race/cover.jpg');
  assert.deepEqual(rock.landing.controls, { phone: 'Stick left, FIRE right', computer: 'Arrows and Space' });
  assert.equal(rock.landing.credits.original.author, 'An Author');
  assert.ok(existsSync(join(dir, 'site/dist/games/rock-race/_landing/credits.json')));
  assert.equal(cat.studio.tagline, 'Games for night owls');
  assert.deepEqual(cat.studio.site, { featured: 'rock-race', frameAncestors: ['https://hub.example'] }, 'only https origins may frame the play page');
  assert.equal(cat.posts[0].html, undefined, 'the catalogue carries summaries; the HTML is in _site/posts.json');
  // A bundled game's cover in its public/ (where the art skill writes it) is the cover the site shows.
  write(dir, 'games/crown-thief/public/cover.jpg', 'jpeg');
  const g = JSON.parse(readFileSync(join(dir, 'games/crown-thief/game.json'), 'utf8'));
  writeFileSync(join(dir, 'games/crown-thief/game.json'), JSON.stringify({ ...g, cover: 'cover.jpg' }));
  // A bundled game's build has no hero/ of its own: the landing's copy goes under _landing/.
  write(dir, 'games/crown-thief/hero/wide.jpg', 'still');
  assert.equal(out(run(['build'], dir)).ok, true);
  const again = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  assert.equal(again.games.find((g) => g.id === 'crown-thief').landing.hero.wideImage, '/games/crown-thief/_landing/wide.jpg');
  assert.equal(again.games.find((g) => g.id === 'crown-thief').landing.cover, '/games/crown-thief/cover.jpg', 'the cover from public/');
  assert.ok(existsSync(join(dir, 'site/dist/games/crown-thief/_landing/wide.jpg')));
  const posts = JSON.parse(readFileSync(join(dir, 'site/dist/_site/posts.json'), 'utf8')).posts;
  const live = posts.find((p) => p.slug === 'we-are-live');
  assert.equal(live.date, '2026-09-29T00:00:00.000Z', 'dated by the file name');
  assert.deepEqual(live.links, { game: 'rock-race' });
  assert.deepEqual(posts.find((p) => p.slug === 'crown-thief').links, { game: 'crown-thief' }, 'a link to a song the studio does not have is left out');
  assert.deepEqual(live.record, { $type: 'rocks.homie.studio.post', title: 'We are <live>', text: 'Press **Play**. [Rooms](/rooms/)\n\n<script>alert(1)</script>', createdAt: '2026-09-29T00:00:00.000Z', summary: 'Two games, public rooms.', links: [{ kind: 'game', id: 'rock-race' }] });
});

test('the sections: Home, Games, Rooms and Posts are there; Music and Videos are not (no tab, and 404)', async () => {
  const dir = arcadeLike('sections');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir, { 'rock-race': [{ name: 'pub-2', players: 3, at: 1 }, { name: 'pub-4', players: 0, at: 1 }] });
  const home = await site('/');
  assert.equal(home.status, 200);
  const html = await home.text();
  const nav = /<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)[1];
  assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ['/games/', '/rooms/', '/posts/']);
  assert.match(html, /<h1 class="title[^"]*" id="hero-title">Rock &lt;Race&gt;<\/h1>/, 'the featured game, escaped');
  assert.match(html, /Games for night owls/);
  assert.match(html, /href="\/rock-race\/play\?room=pub-2" data-play>Join<\/a>/, 'a live room, joinable');
  assert.doesNotMatch(html, /pub-4/, 'an empty room is not listed');
  assert.match(html, /href="\/posts\/crown-thief\/"/, 'latest posts');
  assert.match(html, /<a class="made" href="https:\/\/homie\.rocks\/studio\/" data-made-with-homie>/);
  assert.match(html, /<link rel="alternate" type="application\/atom\+xml" href="\/posts\/feed\.xml"/);
  assert.match(html, new RegExp(`<script src="/_homie/site\\.js\\?v=${STUDIO_VERSION_TAG.replace(/\./g, '\\.')}" defer></script>`));
  assert.doesNotMatch(html, /<script>(?!\{)/, 'no inline script on a generated page (its CSP allows only this site\'s)');
  assert.equal(home.headers.get('cache-control'), 'no-store, no-transform');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(home.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', 'an origin crosses to other studios, never a path');
  for (const p of ['/music/', '/videos/', '/music/theme/']) {
    const r = await site(p);
    assert.equal(r.status, 404, `${p} answers 404 when the studio has none`);
    assert.doesNotMatch(await r.text(), /href="\/music\/"|href="\/videos\/"/);
  }
  const games = await (await site('/games/')).text();
  assert.match(games, /aria-current="page"><svg[^>]*>[\s\S]*?<span>Games<\/span>/);
  assert.match(games, /href="\/crown-thief\/play" data-play>/);
  assert.equal((await site('/games')).status, 301);
  const rooms = await (await site('/rooms/')).text();
  assert.match(rooms, /Rock &lt;Race&gt; · Room 2/);
  assert.match(rooms, /data-src="\/api\/rooms"/);
  const api = await (await site('/api/rooms')).json();
  assert.deepEqual(api.rooms.map((r) => [r.game, r.room, r.players, r.max, r.play]), [['rock-race', 'pub-2', 3, 6, '/rock-race/play?room=pub-2']]);
  assert.equal(api.playing, 3);
  const js = await site('/_homie/site.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.match(await js.text(), /IntersectionObserver/);
  const missing = await site('/nothing-here');
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /data-made-with-homie/, 'the 404 page is the studio\'s too');
  const wk = await (await site('/.well-known/homie-studio.json')).json();
  assert.deepEqual(wk.posts.map((p) => p.page), ['https://owls.example/posts/crown-thief/', 'https://owls.example/posts/we-are-live/']);
  assert.equal(wk.tagline, 'Games for night owls');
});

test('a game\'s landing: its footage, the pitch, Play into a public room, phone / computer / TV, live rooms, how to play, credits, and "Make a game like this"', async () => {
  const dir = arcadeLike('landing');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir, { 'rock-race': [{ name: 'pub-2', players: 2, at: 1 }] });
  const res = await site('/rock-race/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store, no-transform');
  const html = await res.text();
  assert.match(html, /<video autoplay muted loop playsinline preload="metadata"[^>]*aria-label="Ships trade fire">/, 'the game\'s own footage is the hero');
  assert.match(html, /<source media="\(min-aspect-ratio: 3\/4\)" src="\/games\/rock-race\/hero\/wide\.mp4" type="video\/mp4"><source src="\/games\/rock-race\/hero\/tall\.mp4" type="video\/mp4">/);
  assert.match(html, /<h1 class="title[^"]*" id="game-title">Rock &lt;Race&gt;<\/h1>/);
  assert.match(html, /<p class="line">Blast rocks, not friends\.<\/p>/);
  assert.match(html, /<a class="play" href="\/rock-race\/play" data-play>/);
  assert.match(html, /data-live="\/rock-race\/live" data-n="2" data-one="pilot" data-many="pilots"/);
  assert.match(html, /2 pilots playing right now/);
  assert.match(html, /<span class="qr" role="img"[^>]*><svg/, 'a code a phone scans to play');
  assert.match(html, /owls\.example\/rock-race\/tv/, 'the TV address');
  assert.match(html, /Stick left, FIRE right/);
  assert.match(html, /Arrows and Space/);
  assert.match(html, /<li>Steer with the stick<\/li>/);
  assert.match(html, /Up to 6 players, 2\u2011minute rounds\./);
  assert.match(html, /href="\/rock-race\/play\?room=pub-2" data-play>Join/);
  assert.match(html, /<strong>Rocks<\/strong> by <strong>An Author<\/strong> \(2010\), MIT licence/);
  assert.match(html, /laser\.wav: Someone/);
  assert.match(html, /Port: <strong>Night Owls<\/strong>/);
  assert.match(html, /href="\/rock-race\/credits">Licences and full credits/);
  assert.match(html, /<h2 id="make-title">Make a game like this<\/h2>/);
  assert.match(html, /href="https:\/\/homie\.rocks\/studio\/\?remix=https%3A%2F%2Fowls\.example%2Fgames%2Frock-race%2Fsource\.json"/);
  assert.match(html, /data-copy="\/plugin marketplace add homie-rocks\/homie"/);
  assert.match(html, /data-copy="Remix Rock &lt;Race&gt; from https:\/\/owls\.example\/games\/rock-race\/source\.json into a game of my own in my Homie studio"/);
  assert.match(html, /<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"VideoGame","name":"Rock \\u003cRace>"/);
  assert.match(html, /data-made-with-homie/);
  // A game with no art of its own: the studio's colours and its name, drawn big.
  const bare = await (await site('/crown-thief/')).text();
  assert.match(bare, /<div class="hero-media bare" data-hero-media>/);
  // A closed game: no source link, the "make your own" road.
  const cat = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  const { gameLanding } = await import('../worker/site.mjs');
  const closed = await gameLanding(cat, { ...cat.games[1], landing: { ...cat.games[1].landing, source: false } }, { origin: 'https://owls.example' }).text();
  assert.doesNotMatch(closed, /source\.json/);
  assert.match(closed, /Make a multiplayer game like Rock &lt;Race&gt; in my Homie studio/);
  const live = await (await site('/rock-race/live')).json();
  assert.deepEqual([live.ok, live.counted, live.playing, live.max, live.rooms.length, live.road.room], [true, true, 2, 6, 1, 'public']);
  const credits = await site('/rock-race/credits');
  assert.equal(credits.status, 200);
  assert.match(await credits.text(), /MIT License\n\nCopyright \(c\) the original authors/);
  assert.equal((await site('/crown-thief/credits')).status, 404);
  const footage = await site('/games/rock-race/hero/wide.mp4', { headers: { range: 'bytes=0-3' } });
  assert.equal(footage.status, 206, 'hero footage answers byte ranges (Safari needs them to play a video)');
  assert.equal(await footage.text(), 'wide');
});

test('posts: the index, a post (its HTML safe, its links as cards), Atom and JSON feeds with absolute links and the post record', async () => {
  const dir = arcadeLike('posts');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir);
  const index = await (await site('/posts/')).text();
  assert.match(index, /We are &lt;live&gt;/);
  assert.match(index, /href="\/posts\/feed\.xml"/);
  const post = await site('/posts/we-are-live/');
  assert.equal(post.status, 200);
  const html = await post.text();
  assert.match(html, /<h1>We are &lt;live&gt;<\/h1>/);
  assert.match(html, /<p>Press <strong>Play<\/strong>\. <a href="\/rooms\/">Rooms<\/a><\/p>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<div class="linked cards"><article class="gcard reveal">[\s\S]*?href="\/rock-race\/play" data-play>/, 'the linked game, with Play');
  assert.match(html, /<meta property="article:published_time" content="2026-09-29T00:00:00.000Z">/);
  assert.equal((await site('/posts/nope/')).status, 404);
  assert.equal((await site('/posts/draft/')).status, 404, 'a draft has no page');
  const atom = await site('/posts/feed.xml');
  assert.match(atom.headers.get('content-type'), /application\/atom\+xml/);
  const xml = await atom.text();
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.equal((xml.match(/<entry>/g) ?? []).length, 2);
  assert.match(xml, /<title>We are &lt;live&gt;<\/title>/);
  assert.match(xml, /&lt;a href=&quot;https:\/\/owls\.example\/rooms\/&quot;&gt;/, 'links in a feed are absolute');
  assert.match(xml, /<updated>2026-09-30T12:00:00\.000Z<\/updated>/);
  const feed = await (await site('/posts/feed.json')).json();
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.deepEqual(feed.items.map((i) => i.id), ['https://owls.example/posts/crown-thief/', 'https://owls.example/posts/we-are-live/']);
  assert.equal(feed.items[1].image, 'https://owls.example/games/rock-race/cover.jpg');
  assert.deepEqual(feed.items[1]._homie.links, { game: { id: 'rock-race', url: 'https://owls.example/rock-race/' } });
  assert.equal(feed.items[1]._homie.record.$type, 'rocks.homie.studio.post');
  // A studio with no posts has no Posts: no tab, no feed.
  const none = studio('no-posts');
  out(run(['game', 'new', 'crown-thief'], none));
  assert.equal(out(run(['build'], none)).ok, true);
  const bare = await siteOf(none);
  assert.equal((await bare('/posts/')).status, 404);
  assert.equal((await bare('/posts/feed.xml')).status, 404);
  assert.doesNotMatch(await (await bare('/')).text(), /href="\/posts\/"/);
});

test('site/ wins: a whole page, a landing of the studio\'s own, partials, tokens, CSS and files; reserved places are refused', async () => {
  const dir = arcadeLike('overrides');
  write(dir, 'site/pages/about/index.html', '<!doctype html><html><head><!-- homie:style --></head><body><!-- homie:header --><h1>About us</h1><script>window.mine = 1</script><!-- homie:footer --><!-- homie:script --></body></html>');
  write(dir, 'site/pages/crown-thief/index.html', '<!doctype html><title>Our own landing</title><h1>Hand-made</h1>');
  write(dir, 'site/pages/rock-race/play/index.html', '<h1>not allowed</h1>');
  write(dir, 'site/partials/footer.html', '<footer class="foot">Owls since {{year}} · <a href="https://homie.rocks/studio/">Made with Homie</a> · {{studio.name}}</footer>');
  write(dir, 'site/partials/game-rock-race.html', '<p class="lead">The {{game.name}} radio: <a href="{{game.play}}">tune in</a></p>');
  write(dir, 'site/partials/game.html', '<section class="band" id="own">Our own band</section>');
  write(dir, 'site/partials/sidebar.html', '<p>unknown</p>');
  write(dir, 'site/theme.css', '.made{border-radius:4px}</style><script>x</script>');
  write(dir, 'site/public/fonts/owl.woff2', 'font');
  write(dir, 'site/public/games/evil.js', 'nope');
  write(dir, 'site/theme.json', JSON.stringify({ palette: 'neon', fonts: [{ family: 'Owl', src: '/fonts/owl.woff2', weight: '400 800' }], display: '"Owl", sans-serif', mark: '/brand/mark.svg' }));
  write(dir, 'site/public/brand/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const b = out(run(['build'], dir));
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual(b.pages, ['/about/', '/crown-thief/']);
  assert.deepEqual(b.partials.sort(), ['footer', 'game', 'game-rock-race']);
  assert.ok(b.siteSkipped.some((s) => /site\/pages\/rock-race\/play/.test(s.what)), 'a page cannot take a play address');
  assert.ok(b.siteSkipped.some((s) => /sidebar/.test(s.what)), 'an unknown partial is named');
  assert.ok(b.siteSkipped.some((s) => /site\/public\/games\/evil\.js/.test(s.what)), 'site/public cannot write into the games');
  const site = await siteOf(dir);
  const about = await site('/about/');
  assert.equal(about.status, 200);
  assert.equal(about.headers.get('x-frame-options'), 'DENY');
  assert.equal(about.headers.get('content-security-policy'), "frame-ancestors 'none'", 'the studio\'s own page may run its own scripts');
  assert.equal(about.headers.get('cache-control'), 'no-store, no-transform');
  const aboutHtml = await about.text();
  assert.match(aboutHtml, /<h1>About us<\/h1><script>window\.mine = 1<\/script>/);
  assert.match(aboutHtml, /<style>@font-face\{font-family:"Owl";src:url\("\/fonts\/owl\.woff2"\);font-weight:400 800/);
  assert.match(aboutHtml, /<header class="top" data-top><a class="mark" href="\/"><img src="\/brand\/mark\.svg" alt="Night Owls"><\/a>/);
  assert.match(aboutHtml, /Owls since \d{4} · <a href="https:\/\/homie\.rocks\/studio\/">Made with Homie<\/a> · Night Owls/);
  assert.match(aboutHtml, /<script src="\/_homie\/site\.js\?v=/);
  assert.equal((await site('/about')).status, 301);
  const own = await (await site('/crown-thief/')).text();
  assert.equal(own, '<!doctype html><title>Our own landing</title><h1>Hand-made</h1>', 'a landing of the studio\'s own is served as it is');
  const rock = await (await site('/rock-race/')).text();
  assert.match(rock, /<section class="band tight"><div class="band-in"><p class="lead">The Rock &lt;Race&gt; radio: <a href="\/rock-race\/play">tune in<\/a><\/p><\/div><\/section>/, 'a piece of a band sits in one');
  assert.match(rock, /<\/section><section class="band" id="own">Our own band<\/section>/, 'a partial that is its own section stands alone');
  assert.match(rock, /\.made\{border-radius:4px\}<\\\/style><script>x<\/script>/, 'theme.css cannot close the stylesheet');
  assert.doesNotMatch(rock, /<\/style><script>x/);
  assert.match(rock, /--hot:#ff3bd4/, 'the neon palette');
  assert.equal((await site('/fonts/owl.woff2')).status, 200);
  const play = await site('/rock-race/play');
  assert.equal(play.status, 200, 'the play page is never a studio page');
});

test('the play page: it is framed only by the site and the origins studio.json names, and every HTML answer is no-transform', async () => {
  const dir = arcadeLike('frames');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir);
  const play = await site('/rock-race/play');
  assert.equal(play.headers.get('cache-control'), 'no-store, no-transform');
  assert.equal(play.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(play.headers.get('content-security-policy'), "frame-ancestors 'self' https://hub.example");
  const doc = await site('/rock-race/__game/?room=pub-2');
  assert.equal(doc.status, 200);
  assert.equal(doc.headers.get('cache-control'), 'no-store, no-transform');
  assert.match(doc.headers.get('content-security-policy'), /^sandbox allow-scripts[^;]*; frame-ancestors 'self' https:\/\/hub\.example$/);
  assert.equal(doc.headers.get('x-frame-options'), null, 'the game\'s own page is framed by its play page');
  const tv = await site('/rock-race/tv');
  assert.equal(tv.status, 200);
  assert.equal(tv.headers.get('x-frame-options'), 'SAMEORIGIN');
});

test('the Worker says the version it is (the site script is cached per version)', () => {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
  assert.equal(STUDIO_VERSION_TAG, pkg.version);
  assert.ok(pkg.files.includes('site/'), 'site/SITE.md ships in the package');
});
