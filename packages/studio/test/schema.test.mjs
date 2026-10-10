import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * @homie-rocks/studio 0.27.0: search engines and AI agents read a studio site correctly.
 *
 *   - every generated page carries schema.org JSON-LD, and every block on every built page is valid JSON with
 *     schema.org's own types and properties (lib/schema-vocab.json) and meets what Google documents as required for
 *     its type (lib/schema-check.mjs): Organization and WebSite on Home, a full VideoGame on each landing, MusicRecording,
 *     VideoObject, BlogPosting, Blog, ItemList and BreadcrumbList;
 *   - nothing invented: no rating or review (an owner's is refused too), no price but the shop's while it sells,
 *     no live counts in the Rooms page's data;
 *   - the owner's own properties (game.json "schema", studio.json site.schema) add to Homie's and never replace them,
 *     and a page of the studio's own takes <!-- homie:schema -->;
 *   - /robots.txt, /sitemap.xml, /llms.txt and /llms-full.txt from the public catalogue: a private game is in none of
 *     them, no game is offered to be taken whole (remix was retired), and a file of the studio's own wins.
 * Run: node --test packages/studio/test/schema.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkHtml, checkJsonLd, jsonLdBlocks, typesOnPage } from '../lib/schema-check.mjs';
import { isoDuration } from '../worker/schema.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-schema-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const ORIGIN = 'https://owls.example';

/** A studio with everything a page can say: games (one made from another studio's, a port, a private one, one with the old licence word), music, videos, posts, a page of its own. */
function fullStudio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Night Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  const game = (id, extra = {}) => {
    browserRulesGame(dir, id);
    write(dir, `games/${id}/game.json`, JSON.stringify({ id, name: id.replace(/-/g, ' ').replace(/\b./g, (c) => c.toUpperCase()), blurb: `${id} for everyone.`, players: { min: 1, max: 6 }, roundSeconds: 120, entry: 'src/main.ts', room: { host: 'browser' }, cover: 'cover.jpg', ...extra }));
    write(dir, `games/${id}/index.html`, '<!doctype html><html><head><script type="module" src="./assets/main.js"></script></head><body></body></html>');
    write(dir, `games/${id}/public/cover.jpg`, 'cover');
    write(dir, `games/${id}/hero/wide.jpg`, 'the landing still');
  };
  game('rock-race', {
    name: 'Rock <Race>', genre: ['Arcade', 'Shooter'], released: '2026-09-10', license: { kind: 'remix-with-credit', spdx: 'MIT' },
    landing: { pitch: 'Blast rocks, not friends.', about: 'A score race on one wrap-around field.', howToPlay: ['Steer with the stick', 'Fire at the edge'], controls: { phone: 'Stick left, FIRE right', computer: 'Arrows and Space' } },
    schema: { gameEdition: 'First light', name: 'Not the name', aggregateRating: { '@type': 'AggregateRating', ratingValue: 5, ratingCount: 900 }, offers: { '@type': 'Offer', price: 99 } },
  });
  write(dir, 'games/rock-race/screenshots/1.jpg', 'shot one');
  write(dir, 'games/rock-race/screenshots/2.png', 'shot two');
  write(dir, 'games/rock-race/LICENSE', 'MIT License');
  write(dir, 'games/rock-race/credits.json', JSON.stringify({ v: 1, original: { title: 'Rocks', author: 'An Author', year: '2010', url: 'https://example.com/rocks', licence: 'MIT', licenceFile: 'LICENSE' } }));
  game('gem-thief', { players: { min: 2, max: 2 }, remixOf: { name: 'Gem Rush', studio: 'Other Studio', page: 'https://other.example/gem-rush/' }, license: 'remix-freely' });
  game('closed-door', { license: 'no-remix', watch: false });
  game('secret-plan', { launch: 'private' });
  write(dir, 'music/theme/theme.mp3', 'mp3');
  write(dir, 'music/night.jpg', 'album cover');
  write(dir, 'music/manifest.json', JSON.stringify({
    v: 1, cover: 'music/night.jpg', album: 'Night Route',
    items: [
      { slug: 'theme', kind: 'song', title: 'Theme', blurb: 'The studio theme.', published: true, duration: 95, key: 'A minor', bpm: 120, made: { provider: 'elevenlabs', at: '2026-09-21T02:00:00Z' }, credits: 'Music made with Eleven Music.', files: [{ role: 'audio', path: 'music/theme/theme.mp3', type: 'audio/mpeg' }] },
      { slug: 'race-score', kind: 'score', title: 'Race score', published: true, date: '2026-09-22', for: { game: 'rock-race' }, files: [{ role: 'audio', path: 'music/theme/theme.mp3' }] },
    ],
  }));
  write(dir, 'videos/trailer/trailer.mp4', 'mp4');
  write(dir, 'videos/trailer/poster.jpg', 'poster');
  write(dir, 'videos/manifest.json', JSON.stringify({
    v: 1,
    items: [{ slug: 'trailer', kind: 'trailer', title: 'Rock Race trailer', blurb: 'Six ships, one rock field.', published: true, duration: 65, date: '2026-09-23T10:00:00Z', for: { game: 'rock-race' }, files: [{ role: 'video', path: 'videos/trailer/trailer.mp4', type: 'video/mp4' }, { role: 'poster', path: 'videos/trailer/poster.jpg' }] }],
  }));
  write(dir, 'posts/2026-09-24-we-are-live.md', '---\ntitle: We are <live>\nsummary: Two games, public rooms.\ngame: rock-race\nimage: /games/rock-race/cover.jpg\nauthor: Ada Night\nupdated: 2026-09-25\n---\n\nPress **Play**.\n');
  write(dir, 'posts/2026-09-26-patch.md', '---\ntitle: Patch notes\nauthor: Night Owls\n---\nFaster rocks.\n');
  write(dir, 'site/pages/about/index.html', '<!doctype html><html><head><title>About</title><!-- homie:schema --></head><body>About us</body></html>');
  // The owner's own landing for one game: it keeps working, and takes the landing's structured data by the marker.
  write(dir, 'site/pages/gem-thief/index.html', '<!doctype html><html><head><title>Gem Thief, our way</title>\n<!-- homie:schema -->\n</head><body><!-- homie:header --><h1>Our own landing</h1></body></html>');
  write(dir, 'site/pages/changelog/index.html', '<!doctype html><html><head><title>Changelog</title></head><body>What changed</body></html>');
  const s = JSON.parse(readFileSync(join(dir, 'studio.json'), 'utf8'));
  s.tagline = 'Games for night owls';
  s.site = { featured: 'rock-race', schema: { sameAs: ['https://github.com/night-owls', 'https://www.youtube.com/@nightowls'], foundingDate: '2026', review: { '@type': 'Review' } } };
  writeFileSync(join(dir, 'studio.json'), JSON.stringify(s, null, 2));
  const theme = JSON.parse(readFileSync(join(dir, 'site/theme.json'), 'utf8'));
  writeFileSync(join(dir, 'site/theme.json'), JSON.stringify({ ...theme, mark: '/logo.png', social: '/social.jpg' }));
  write(dir, 'site/public/logo.png', 'png');
  write(dir, 'site/public/social.jpg', 'jpg');
  // Real commits, on known days: the landings' dates and the sitemap's lastmod come from them.
  const git = (args, date) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Owls', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: 'Owls', GIT_COMMITTER_EMAIL: '', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  git(['init', '-q'], '2026-09-19T00:00:00Z');
  git(['add', '-A'], '2026-09-19T00:00:00Z');
  assert.equal(git(['commit', '-qm', 'first'], '2026-09-19T08:00:00Z').status, 0);
  write(dir, 'games/gem-thief/cover.jpg', 'a new cover');
  git(['add', '-A'], '2026-09-27T00:00:00Z');
  assert.equal(git(['commit', '-qm', 'new cover'], '2026-09-27T09:30:00Z').status, 0);
  return dir;
}

async function siteOf(dir, env = {}) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f) || !/\.[a-z0-9]+$/i.test(p)) return new Response('not found', { status: 404 });
      const type = p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.txt') ? 'text/plain' : 'application/octet-stream';
      return new Response(readFileSync(f), { headers: { 'content-type': type } });
    },
  };
  const LOBBY = { idFromName: (n) => n, get: () => ({ fetch: async (u) => new Response(JSON.stringify(new URL(u).pathname === '/rooms' ? { rooms: [{ name: 'pub-1', players: 3, at: 1 }] } : { players: 0, rooms: 0, peak: { players: 0, room: 0 } })) }) };
  return (path, init = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers: { 'user-agent': 'homie-house-qa test', ...(init.headers ?? {}) } }), { ASSETS, LOBBY, STUDIO_NAME: 'Night Owls', ...env }, { waitUntil() {} });
}

const graphOf = (html) => jsonLdBlocks(html).flatMap((b) => b.value['@graph'] ?? [b.value]);
const nodeOf = (html, type) => graphOf(html).find((n) => [].concat(n['@type']).includes(type));

const PAGES = {
  '/': ['Organization', 'WebSite'],
  '/games/': ['BreadcrumbList', 'ItemList'],
  '/rooms/': ['BreadcrumbList', 'ItemList'],
  '/rock-race/': ['BreadcrumbList', 'VideoGame', 'WebApplication'],
  '/gem-thief/': ['BreadcrumbList', 'VideoGame', 'WebApplication'],
  '/closed-door/': ['BreadcrumbList', 'VideoGame', 'WebApplication'],
  '/rock-race/credits': ['BreadcrumbList'],
  '/music/': ['BreadcrumbList', 'MusicAlbum'],
  '/music/theme/': ['BreadcrumbList', 'MusicRecording'],
  '/music/race-score/': ['BreadcrumbList', 'MusicRecording'],
  '/videos/': ['BreadcrumbList', 'ItemList'],
  '/videos/trailer/': ['BreadcrumbList', 'VideoObject'],
  '/posts/': ['BreadcrumbList', 'Blog'],
  '/posts/we-are-live/': ['BreadcrumbList', 'BlogPosting'],
  '/posts/patch/': ['BreadcrumbList', 'BlogPosting'],
  '/about/': ['Organization'],
};

test('every built page: its JSON-LD is valid schema.org and meets what Google documents for its type', async () => {
  const dir = fullStudio('every-page');
  // The owner's refused properties are said at build time, never published.
  const b = spawnSync(process.execPath, [CLI, 'build'], { cwd: dir, encoding: 'utf8' });
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.match(b.stderr + b.stdout, /games\/rock-race\/game\.json schema\.aggregateRating is left out/);
  assert.match(b.stderr + b.stdout, /games\/rock-race\/game\.json schema\.offers is left out/);
  assert.match(b.stderr + b.stdout, /studio\.json site schema\.review is left out/);
  const site = await siteOf(dir);
  for (const [path, types] of Object.entries(PAGES)) {
    const res = await site(path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    const r = checkHtml(html);
    assert.equal(r.blocks.length, 1, `${path}: one block`);
    assert.deepEqual(r.errors, [], `${path}: ${r.errors.join('\n')}`);
    assert.deepEqual(r.google, [], `${path}: ${r.google.join('\n')}`);
    assert.deepEqual(typesOnPage(html), types, path);
    assert.doesNotMatch(html, /aggregateRating|"review"/, `${path}: no ratings`);
  }
  // The pages that say nothing: a 404, a private game (its gate is a 404 to a stranger).
  assert.equal(jsonLdBlocks(await (await site('/no-such-thing/')).text()).length, 0);
  assert.equal(jsonLdBlocks(await (await site('/secret-plan/')).text()).length, 0);
  // A page of the studio's own without the marker is left exactly as it was.
  assert.equal(jsonLdBlocks(await (await site('/changelog/')).text()).length, 0);
});

test('a landing\'s VideoGame: everything the game\'s files say, the owner\'s extras under Homie\'s own, and no price but the free one', async () => {
  const dir = fullStudio('landing');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir);
  const html = await (await site('/rock-race/')).text();
  const g = nodeOf(html, 'VideoGame');
  assert.deepEqual(g['@type'], ['VideoGame', 'WebApplication'], 'co-typed: Google shows no app result for a bare VideoGame');
  assert.equal(g.name, 'Rock <Race>', 'the game\'s own name: the owner\'s "name" extra does not replace it');
  assert.equal(g.url, `${ORIGIN}/rock-race/`);
  assert.equal(g.description, 'rock-race for everyone.');
  assert.equal(g.abstract, 'Blast rocks, not friends.');
  assert.deepEqual(g.genre, ['Arcade', 'Shooter']);
  assert.deepEqual(g.numberOfPlayers, { '@type': 'QuantitativeValue', minValue: 1, maxValue: 6 });
  assert.deepEqual(g.playMode, ['https://schema.org/SinglePlayer', 'https://schema.org/MultiPlayer']);
  assert.deepEqual(g.gamePlatform, ['Web browser', 'Phone', 'Computer', 'TV']);
  assert.deepEqual(g.image, [`${ORIGIN}/games/rock-race/_landing/wide.jpg`, `${ORIGIN}/games/rock-race/cover.jpg`]);
  assert.deepEqual(g.screenshot, [`${ORIGIN}/games/rock-race/_landing/1.jpg`, `${ORIGIN}/games/rock-race/_landing/2.png`]);
  assert.match(html, /<div class="shots reveal"><a href="\/games\/rock-race\/_landing\/1\.jpg"><img src="\/games\/rock-race\/_landing\/1\.jpg" alt="Rock &lt;Race&gt;: screenshot 1"/, 'the screenshots are on the page too');
  assert.match(html, /<li>Arcade<\/li><li>Shooter<\/li>/, 'and its genre');
  assert.deepEqual(g.author, { '@type': 'Organization', '@id': `${ORIGIN}/#studio`, name: 'Night Owls', url: `${ORIGIN}/` }, 'the studio, by name: a page is read on its own');
  assert.deepEqual(g.publisher, g.author);
  assert.deepEqual(g.license, { '@type': 'CreativeWork', name: 'MIT', url: 'https://spdx.org/licenses/MIT.html' }, 'the licence the game names, and none of the old remix word beside it');
  assert.deepEqual(g.isBasedOn, { '@type': 'VideoGame', name: 'Rocks', url: 'https://example.com/rocks', creditText: 'Rocks by An Author (2010), MIT licence' }, 'a port names its original');
  assert.equal(g.trailer['@type'], 'VideoObject');
  assert.equal(g.trailer.contentUrl, `${ORIGIN}/videos/trailer/trailer.mp4`);
  assert.deepEqual(g.trailer.thumbnailUrl, [`${ORIGIN}/videos/trailer/poster.jpg`]);
  assert.equal(g.trailer.uploadDate, '2026-09-23T10:00:00.000Z');
  assert.equal(g.trailer.duration, 'PT1M5S');
  assert.equal(g.datePublished, '2026-09-10T00:00:00.000Z', 'game.json "released"');
  assert.equal(Date.parse(g.dateModified), Date.parse('2026-09-19T08:00:00Z'), 'the last commit that touched the game');
  assert.equal(g.gameEdition, 'First light', 'the owner\'s own property');
  assert.equal(g.aggregateRating, undefined);
  assert.deepEqual(g.offers, { '@type': 'Offer', price: 0, priceCurrency: 'USD', availability: 'https://schema.org/OnlineOnly', url: `${ORIGIN}/rock-race/play` }, 'free to play; the shop is not selling, so no add-ons');
  assert.equal(g.isAccessibleForFree, true);
  assert.deepEqual(g.potentialAction, { '@type': 'PlayAction', target: `${ORIGIN}/rock-race/play` });
  const crumbs = nodeOf(html, 'BreadcrumbList').itemListElement.map((li) => [li.position, li.name, li.item]);
  assert.deepEqual(crumbs, [[1, 'Home', `${ORIGIN}/`], [2, 'Games', `${ORIGIN}/games/`], [3, 'Rock <Race>', `${ORIGIN}/rock-race/`]]);
  // A game that was made from another studio's (its landing the owner's own page, with the marker): the credit is on
  // its page, not in its structured data, and the old licence word is no licence; a two-player game is not single
  // player; dates from git alone.
  const own = await (await site('/gem-thief/')).text();
  assert.match(own, /<h1>Our own landing<\/h1>/, 'the owner\'s landing is served as it is');
  const thief = nodeOf(own, 'VideoGame');
  assert.equal(thief.isBasedOn, undefined);
  assert.deepEqual(thief.playMode, ['https://schema.org/MultiPlayer']);
  assert.equal(thief.license, undefined);
  assert.equal(Date.parse(thief.datePublished), Date.parse('2026-09-19T08:00:00Z'), 'the commit that added its game.json');
  assert.equal(Date.parse(thief.dateModified), Date.parse('2026-09-27T09:30:00Z'));
  // A game nobody may watch has no watch door, but its VideoGame is the same shape.
  assert.equal(nodeOf(await (await site('/closed-door/')).text(), 'VideoGame').license, undefined, 'the old word "no-remix" is not a licence');

  // The shop's items, only while it sells: the free offer's add-ons, in real money, this game's and the studio's own.
  const cat = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  const { gameLanding } = await import('../worker/site.mjs');
  const rock = cat.games.find((x) => x.id === 'rock-race');
  const shop = { currency: 'usd', items: [
    { id: 'ember', kind: 'cosmetic', game: 'rock-race', name: 'Ember hull', price: 300 },
    { id: 'supporter', kind: 'supporter', name: 'Supporter', price: 500, days: 365 },
    { id: 'other', kind: 'cosmetic', game: 'gem-thief', name: 'Not here', price: 300 },
    { id: 'tip', kind: 'tip', name: 'A coffee', price: 'choose', min: 200, max: 5000 },
    { id: 'gone', kind: 'pass', name: 'Season 0', price: 800, ends: '2020-01-31' },
  ] };
  const selling = await gameLanding(cat, rock, { origin: ORIGIN, shop }).text();
  const offer = nodeOf(selling, 'VideoGame').offers;
  assert.equal(offer.price, 0);
  assert.equal(offer.priceCurrency, 'USD');
  assert.deepEqual(offer.addOn.map((o) => [o.name, o.price, o.priceCurrency, o.category, o.url]), [
    ['Ember hull', 3, 'USD', 'cosmetic', `${ORIGIN}/shop/?game=rock-race&item=ember`],
    ['Supporter', 5, 'USD', 'supporter', `${ORIGIN}/shop/?game=rock-race&item=supporter`],
  ], 'no tip (no price), no other game\'s item, nothing that has ended');
  assert.deepEqual(checkHtml(selling).errors, []);
  // A game that is not public yet: its owner sees its landing, never indexed, and it offers nothing.
  const priv = await gameLanding(cat, rock, { origin: ORIGIN, shop, listed: false });
  assert.equal(priv.headers.get('x-robots-tag'), 'noindex');
  assert.equal(nodeOf(await priv.text(), 'VideoGame').offers, undefined);
});

test('Home, music, videos, posts and lists: the studio, its recordings, its trailer, its posts, and no live counts', async () => {
  const dir = fullStudio('pages');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir);
  const home = await (await site('/')).text();
  const org = nodeOf(home, 'Organization');
  assert.deepEqual(org, {
    '@type': 'Organization', '@id': `${ORIGIN}/#studio`, name: 'Night Owls', url: `${ORIGIN}/`, logo: `${ORIGIN}/logo.png`, image: `${ORIGIN}/social.jpg`,
    description: 'Games for night owls', sameAs: ['https://github.com/night-owls', 'https://www.youtube.com/@nightowls'], foundingDate: '2026',
  }, 'the owner\'s sameAs and foundingDate; their review is refused');
  assert.deepEqual(nodeOf(home, 'WebSite'), { '@type': 'WebSite', '@id': `${ORIGIN}/#website`, name: 'Night Owls', url: `${ORIGIN}/`, inLanguage: 'en', publisher: { '@id': `${ORIGIN}/#studio` } });
  const games = nodeOf(await (await site('/games/')).text(), 'ItemList');
  assert.deepEqual(games.itemListElement.map((li) => [li.position, li.url]), [[1, `${ORIGIN}/closed-door/`], [2, `${ORIGIN}/gem-thief/`], [3, `${ORIGIN}/rock-race/`]], 'the public games only');
  const rooms = await (await site('/rooms/')).text();
  assert.match(rooms, /\d+ people playing in \d+ public rooms right now/, 'the page shows who is playing now');
  assert.doesNotMatch(jsonLdBlocks(rooms)[0].text, /playing|players|"3"/, 'its structured data never does');
  const song = nodeOf(await (await site('/music/theme/')).text(), 'MusicRecording');
  assert.deepEqual(song.byArtist, { '@type': 'MusicGroup', name: 'Night Owls', url: `${ORIGIN}/` });
  assert.equal(song.duration, 'PT1M35S');
  assert.deepEqual(song.audio, { '@type': 'AudioObject', contentUrl: `${ORIGIN}/music/theme/theme.mp3`, encodingFormat: 'audio/mpeg', duration: 'PT1M35S' });
  assert.equal(song.datePublished, '2026-09-21T02:00:00.000Z', 'when it was made');
  assert.deepEqual(song.inAlbum, { '@type': 'MusicAlbum', name: 'Night Route', byArtist: song.byArtist });
  assert.deepEqual(song.recordingOf, { '@type': 'MusicComposition', name: 'Theme', musicalKey: 'A minor' });
  assert.equal(song.image, `${ORIGIN}/music/night.jpg`);
  const album = nodeOf(await (await site('/music/')).text(), 'MusicAlbum');
  assert.deepEqual([album.name, album.numTracks, album.track.map((t) => t.url)], ['Night Route', 2, [`${ORIGIN}/music/theme/`, `${ORIGIN}/music/race-score/`]]);
  const video = nodeOf(await (await site('/videos/trailer/')).text(), 'VideoObject');
  assert.deepEqual([video.name, video.description, video.uploadDate, video.duration, video.contentUrl], ['Rock Race trailer', 'Six ships, one rock field.', '2026-09-23T10:00:00.000Z', 'PT1M5S', `${ORIGIN}/videos/trailer/trailer.mp4`]);
  assert.deepEqual(video.about, { '@type': 'VideoGame', '@id': `${ORIGIN}/rock-race/#game`, name: 'Rock <Race>', url: `${ORIGIN}/rock-race/` });
  const post = nodeOf(await (await site('/posts/we-are-live/')).text(), 'BlogPosting');
  assert.deepEqual([post.headline, post.datePublished, post.dateModified, post.author, post.image], ['We are <live>', '2026-09-24T00:00:00.000Z', '2026-09-25T00:00:00.000Z', { '@type': 'Person', name: 'Ada Night' }, [`${ORIGIN}/games/rock-race/cover.jpg`]]);
  assert.equal(post.about.url, `${ORIGIN}/rock-race/`);
  assert.equal(nodeOf(await (await site('/posts/patch/')).text(), 'BlogPosting').author['@id'], `${ORIGIN}/#studio`, 'a post by the studio itself');
  const blog = nodeOf(await (await site('/posts/')).text(), 'Blog');
  assert.deepEqual(blog.blogPost.map((p) => p.url), [`${ORIGIN}/posts/patch/`, `${ORIGIN}/posts/we-are-live/`]);
  // A page of the studio's own with the marker: the studio itself (an About page).
  const about = await (await site('/about/')).text();
  assert.match(about, /<title>About<\/title><script type="application\/ld\+json">/);
  assert.equal(nodeOf(about, 'Organization').name, 'Night Owls');
});

test('robots.txt, sitemap.xml, llms.txt and llms-full.txt: every public page, real dates, a private game in none of them', async () => {
  const dir = fullStudio('discover');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir);
  const robotsRes = await site('/robots.txt');
  assert.equal(robotsRes.status, 200);
  assert.match(robotsRes.headers.get('content-type'), /^text\/plain/);
  const robots = await robotsRes.text();
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  for (const p of ['/_studio/', '/api/', '/account/', '/rock-race/play', '/rock-race/tv', '/rock-race/watch', '/rock-race/__', '/rock-race/api/', '/gem-thief/s/*/play']) assert.ok(robots.includes(`\nDisallow: ${p}\n`), p);
  assert.match(robots, /^Sitemap: https:\/\/owls\.example\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /secret-plan/, 'a private game is never named');
  assert.doesNotMatch(robots, /Disallow: \/posts|Disallow: \/rock-race\/$/m, 'posts and landings are open');

  const mapRes = await site('/sitemap.xml');
  assert.match(mapRes.headers.get('content-type'), /^application\/xml/);
  const map = await mapRes.text();
  assert.match(map, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const urls = [...map.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map((m) => [m[1].replace(ORIGIN, ''), m[2] ?? null]);
  assert.equal(urls.length, (map.match(/<url>/g) ?? []).length, 'every entry well formed');
  const paths = urls.map(([p]) => p);
  assert.deepEqual(paths, ['/', '/games/', '/closed-door/', '/gem-thief/', '/rock-race/', '/rock-race/credits', '/rooms/', '/music/', '/music/theme/', '/music/race-score/', '/videos/', '/videos/trailer/', '/posts/', '/posts/patch/', '/posts/we-are-live/', '/about/', '/changelog/']);
  const lastmod = Object.fromEntries(urls);
  assert.equal(lastmod['/rock-race/'], '2026-09-19T08:00:00Z', 'the last commit that touched it');
  assert.equal(lastmod['/gem-thief/'], '2026-09-27T09:30:00Z');
  assert.equal(lastmod['/games/'], '2026-09-27T09:30:00Z');
  assert.equal(lastmod['/posts/we-are-live/'], '2026-09-25T00:00:00Z', 'updated, else its date');
  assert.equal(lastmod['/videos/trailer/'], '2026-09-23T10:00:00Z');
  assert.equal(lastmod['/'], '2026-09-27T09:30:00Z', 'Home: the newest of everything');
  assert.equal(lastmod['/rooms/'], null, 'live: no date to give');
  assert.equal(lastmod['/about/'], null, 'a page of the studio\'s own has no date to give');
  // Every address in it answers 200.
  for (const p of paths) assert.equal((await site(p)).status, 200, p);

  const llms = await (await site('/llms.txt')).text();
  const lines = llms.split('\n');
  assert.equal(lines[0], '# Night Owls', 'an H1 first');
  assert.match(lines[2], /^> Night Owls is a studio made with Homie \(Games for night owls\)\. It makes free multiplayer games/, 'then the > summary');
  assert.deepEqual(lines.filter((l) => l.startsWith('## ')), ['## Games', '## Music', '## Videos', '## Posts', '## Pages', '## Optional']);
  assert.match(llms, /^- \[Rock <Race>\]\(https:\/\/owls\.example\/rock-race\/\): Blast rocks, not friends\. 1–6 players, 1-minute rounds, Arcade, Shooter\. Play: https:\/\/owls\.example\/rock-race\/play\. Watch a live room: https:\/\/owls\.example\/rock-race\/watch\. On a TV: https:\/\/owls\.example\/rock-race\/tv\. Licence: MIT\.$/m);
  assert.match(llms, /^- \[Gem Thief\]\(https:\/\/owls\.example\/gem-thief\/\): gem-thief for everyone\. 2 players, 1-minute rounds\. Based on Gem Rush by Other Studio\. Play: https:\/\/owls\.example\/gem-thief\/play\./m, 'the credit it owes, as a fact');
  assert.match(llms, /^- \[Closed Door\]\(https:\/\/owls\.example\/closed-door\/\): .* Play: https:\/\/owls\.example\/closed-door\/play\. On a TV: https:\/\/owls\.example\/closed-door\/tv\.$/m, 'no watch door, and no word about its licence: it names none');
  assert.doesNotMatch(llms, /remix|source\.json/i, 'no Remix section, no source address, no offer');
  assert.doesNotMatch(llms, /secret-plan|Secret Plan/, 'a private game is never named');
  assert.match(llms, /^- \[Theme\]\(https:\/\/owls\.example\/music\/theme\/\): Song, 1:35, 120 BPM, A minor, from Night Route\. The studio theme\.$/m);
  assert.match(llms, /^- \[Rock Race trailer\]\(https:\/\/owls\.example\/videos\/trailer\/\): Trailer, 1:05\. Six ships, one rock field\.$/m);
  assert.match(llms, /^- \[Atom feed\]\(https:\/\/owls\.example\/posts\/feed\.xml\)/m);
  assert.match(llms, /^- \[JSON Feed\]\(https:\/\/owls\.example\/posts\/feed\.json\)/m);
  assert.match(llms, /^- \[We are <live>\]\(https:\/\/owls\.example\/posts\/we-are-live\/\): 2026-09-24\. Two games, public rooms\.$/m);
  assert.match(llms, /^- \[Changelog\]\(https:\/\/owls\.example\/changelog\/\)$/m, 'the studio\'s own pages, its changelog among them');
  assert.match(llms, /^- \[Homie\]\(https:\/\/homie\.test\/llms\.txt\): what Homie is/m, 'homie.rocks\'s llms.txt (the directory this studio is listed in)');
  assert.match(llms, /^- \[Everything, in full\]\(https:\/\/owls\.example\/llms-full\.txt\)/m);
  for (const [, url] of llms.matchAll(/\]\((https:\/\/owls\.example[^)]*)\)/g)) assert.ok([200].includes((await site(url.replace(ORIGIN, ''))).status), url);

  const full = await (await site('/llms-full.txt')).text();
  assert.equal(full.split('\n')[0], '# Night Owls');
  assert.match(full, /^ {2}A score race on one wrap-around field\.$/m);
  assert.match(full, /^ {2}How to play: Steer with the stick Fire at the edge$/m);
  assert.match(full, /^ {2}Controls\. phone: Stick left, FIRE right\. computer: Arrows and Space\.$/m);
  assert.match(full, /Based on Rocks by An Author \(2010\), MIT licence \(https:\/\/example\.com\/rocks\)/);
  assert.match(full, /^### Patch notes \(2026-09-26\)$/m);
  assert.match(full, /^Faster rocks\.$/m, 'every post\'s text');
  assert.doesNotMatch(full, /secret-plan/);

  const { llmsTxt } = await import('../worker/discover.mjs');
  const cat = JSON.parse(readFileSync(join(dir, 'site/dist/games.json'), 'utf8'));
  // A studio says what it has, never what it might: a music studio makes no game, and a new one says its first is coming.
  assert.match(llmsTxt({ ...cat, games: [], posts: [] }, ORIGIN).split('\n')[2], /\. It publishes songs and videos\. Its site is/);
  assert.match(llmsTxt({ studio: { name: 'Fresh' }, games: [], songs: [], videos: [], posts: [] }, ORIGIN), /^> Fresh is a studio made with Homie\. Its first game is coming soon\. Its site is https:\/\/owls\.example\/\.$/m);
});

test('a studio\'s own robots.txt, sitemap.xml and llms.txt win; a Preview asks not to be crawled', async () => {
  const dir = fullStudio('own-files');
  write(dir, 'site/public/robots.txt', 'User-agent: *\nDisallow: /secret/\n');
  write(dir, 'site/public/llms.txt', '# Our own\n');
  assert.equal(out(run(['build'], dir)).ok, true);
  const site = await siteOf(dir);
  assert.equal(await (await site('/robots.txt')).text(), 'User-agent: *\nDisallow: /secret/\n');
  assert.equal(await (await site('/llms.txt')).text(), '# Our own\n');
  assert.match(await (await site('/sitemap.xml')).text(), /<urlset/, 'the one it did not replace is still made');
  const preview = await siteOf(join(scratch, 'discover'), { HOMIE_PREVIEW: '1' });
  assert.match(await (await preview('/robots.txt')).text(), /^User-agent: \*\nDisallow: \/\n$/m);
  const head = await site('/sitemap.xml', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('the check itself: it catches what a search engine would refuse', () => {
  const bad = (graph) => checkJsonLd({ '@context': 'https://schema.org', '@graph': [graph] });
  assert.deepEqual(bad({ '@type': 'VideoGame', name: 'x' }).google.length > 0, true, 'a bare VideoGame with no offer');
  assert.match(bad({ '@type': 'Movie', name: 'x', playMode: 'https://schema.org/MultiPlayer' }).errors.join(), /"playMode" is not a property of Movie/);
  assert.match(bad({ '@type': 'VideoGame', playMode: 'https://schema.org/InStock' }).errors.join(), /is not one of GamePlayMode/);
  assert.match(bad({ '@type': 'VideoObject', name: 'x', duration: '65 s' }).errors.join(), /not an ISO 8601 duration/);
  assert.match(bad({ '@type': 'VideoObject', name: 'x' }).google.join(), /thumbnailUrl[\s\S]*uploadDate/);
  assert.match(bad({ '@type': 'MusicRecording', name: 'x', byArtist: { '@type': 'Place', name: 'y' } }).errors.join(), /byArtist takes MusicGroup or Person, not a Place/);
  assert.match(bad({ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 2, name: 'a' }, { '@type': 'ListItem', position: 3, name: 'b' }] }).google.join(), /position is 1[\s\S]*has an item/);
  assert.match(bad({ '@type': 'Gizmo', name: 'x' }).errors.join(), /"Gizmo" is not a schema.org type/);
  assert.match(bad({ '@type': 'BlogPosting', headline: 'x', datePublished: 'yesterday', author: { '@type': 'Person' } }).errors.join(), /not an ISO 8601 date/);
  assert.match(bad({ '@type': 'TechArticle', headline: 'x' }).google.join(), /an article has datePublished[\s\S]*author has a name/, 'every kind of article');
  assert.match(checkHtml('<script type="application/ld+json">{nope}</script>').errors.join(), /not valid JSON/);
  assert.match(checkJsonLd({ '@type': 'Thing', name: 'x' }).errors.join(), /@context/);
  assert.equal(isoDuration(3725), 'PT1H2M5S');
  assert.equal(isoDuration(0), null);
});
