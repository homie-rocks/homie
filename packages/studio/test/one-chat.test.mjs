/**
 * One chat (2026-10-01): a new studio goes live with its own home page and no starter game, "see a working game"
 * is a live demo elsewhere, and a hand-off from the Claude app is one line (HANDOFF.md says what it means).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEMO_FALLBACK, demoGames, formatDemo } from '../lib/demo.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-new-studio-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => JSON.parse(r.stdout);

function studio(name, extra = []) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Paper Comets', '--homie', 'https://homie.test', '--no-install', ...extra], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return { dir, made: out(r) };
}

async function siteOf(dir) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f) || !/\.[a-z0-9]+$/i.test(p)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8' } });
    },
  };
  const LOBBY = { idFromName: (n) => n, get: () => ({ fetch: async () => new Response(JSON.stringify({ rooms: [], players: 0 })) }) };
  return (path) => worker.fetch(new Request(`https://comets.example${path}`, { headers: { 'user-agent': 'homie-house-qa test' } }), { ASSETS, LOBBY, STUDIO_NAME: 'Paper Comets' }, { waitUntil() {} });
}

test('a new studio has no starter game, and says how to see a working one', () => {
  for (const [name, extra] of [['plain', []], ['template', ['--template']]]) {
    const { dir, made } = studio(name, extra);
    assert.ok(!existsSync(join(dir, 'games', 'gem-rush')), `${name}: no game is copied in`);
    assert.deepEqual(made.wrote.filter((f) => f.startsWith('games/')), ['games/README.md'], `${name}: games/ holds only its README`);
    assert.ok(made.next.some((n) => n.includes('homie-studio demo')), 'the next steps name the live demo');
    assert.ok(made.next.some((n) => /only when the person asks/.test(n) && /game new <id> --from gem-rush/.test(n)), 'a starter only when asked');
    assert.match(readFileSync(join(dir, 'HANDOFF.md'), 'utf8'), /Continue building <Studio>: build hb_/);
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(agents, /## Continuing a build from the Claude app/);
    assert.match(agents, /A new studio starts with no\s+game/);
  }
});

test('the home of a studio with nothing published says "First game coming soon", with what is on the way', async () => {
  const { dir } = studio('soon');
  writeFileSync(join(dir, 'posts', '2026-10-01-we-are-making-a-game.md'), '---\ntitle: We are making a game\nsummary: The first one is on its way.\n---\n\nSoon.\n');
  const b = run(['build'], dir);
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.deepEqual(out(b).games, []);
  const site = await siteOf(dir);
  const home = await (await site('/')).text();
  assert.match(home, /<h1[^>]*id="hero-title"[^>]*>Paper Comets<\/h1>/, 'the studio\'s name');
  assert.match(home, /First game coming soon\./);
  assert.match(home, /Coming to Paper Comets/);
  assert.equal((home.match(/data-soon/g) ?? []).length, 3, 'games, posts, music and videos on the way');
  assert.match(home, /We are making a game/, 'a post shows on the coming-soon home at once');
  assert.doesNotMatch(home, /data-play/, 'no Play button: there is no game');
  assert.equal((await site('/games/')).status, 404, 'no Games section until there is a game');
  // A studio with only songs (a music studio's shape) keeps its own home: the coming-soon state is only for an empty studio.
  const { homePage } = await import('../worker/site.mjs');
  const music = await homePage({ studio: { name: 'Night Radio' }, games: [], songs: [{ slug: 'theme', title: 'Theme', files: [] }], videos: [], posts: [] }).text();
  assert.doesNotMatch(music, /coming soon/i);
  assert.match(music, /Listen/);
});

test('deploy --plan and the build are fine with no game yet', () => {
  const { dir } = studio('plan');
  const p = run(['deploy', '--plan'], dir);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.equal(out(p).command, 'deploy plan');
});

test('demo: a live game on the arcade from its own manifest, people playing first, and a fallback', async () => {
  const site = 'https://arcade.test';
  const manifest = { name: 'Homie Arcade', games: [
    { id: 'octree-arena', name: 'Octree Arena', blurb: 'Balls', play: `${site}/octree-arena/play`, page: `${site}/octree-arena/` },
    { id: 'asteroids-arena', name: 'Asteroids Arena', blurb: 'Ships', play: `${site}/asteroids-arena/play`, page: `${site}/asteroids-arena/` },
    { id: 'evil', name: 'Elsewhere', play: 'https://evil.example/x' },
  ] };
  const fetchFn = async (url) => {
    if (String(url).endsWith('/.well-known/homie-studio.json')) return new Response(JSON.stringify(manifest));
    if (String(url).endsWith('/api/rooms')) return new Response(JSON.stringify({ rooms: [{ game: 'octree-arena', players: 3 }] }));
    return new Response('no', { status: 404 });
  };
  const r = await demoGames({ fetchFn, studio: site });
  assert.equal(r.pick.id, 'octree-arena', 'a game people are playing right now goes first');
  assert.equal(r.pick.playingNow, 3);
  assert.deepEqual(r.games.map((g) => g.id), ['octree-arena', 'asteroids-arena'], 'a Play link off the arcade\'s own site is left out');
  assert.match(formatDemo(r), /two browser tabs/);
  assert.match(r.copy, /only when you ask/i);
  const down = await demoGames({ fetchFn: async () => { throw new Error('offline'); }, studio: site });
  assert.equal(down.pick.play, DEMO_FALLBACK.play);
  assert.match(down.note, /did not answer/);
});

test('handoff: one line in, the brief fetched by the build id, a setup checked in, the build taken, the steps out', async () => {
  const { handoff, formatHandoff } = await import('../lib/handoff.mjs');
  const { dir } = studio('handoff');
  const build = `hb_${'a'.repeat(32)}`;
  const setup = `hs_${'b'.repeat(32)}`;
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ ok: true, build, kind: 'setup', what: 'game', title: 'Paper Comets: first steps', studio: 'Paper Comets', brief: 'Cut paper, like a pop-up book in space.\nTwo crews.', setup }), { headers: { 'content-type': 'application/json' } });
  };
  const calls = [];
  const r = await handoff(dir, build, {
    fetchFn,
    checkIn: async (root, id) => { calls.push(['setup', id]); return { ok: true, message: 'This repository is Paper Comets.', renamed: [] }; },
    attach: async (root, o) => { calls.push(['attach', o.attach]); return { ok: true, build: 'local-1', shared: { build } }; },
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(asked, [`https://homie.test/api/studio/progress/${build}/brief`], 'the brief comes from the studio\'s own directory, by the build id');
  assert.deepEqual(calls, [['setup', setup], ['attach', build]], 'a new studio checks in, then the build is taken');
  const text = formatHandoff(r);
  assert.match(text, /^Continue building Paper Comets: Paper Comets: first steps/);
  assert.match(text, /pop-up book in space/);
  assert.match(text, /homie-studio demo/);
  assert.match(text, /Never merge the pull request/);
  const blocked = await handoff(dir, build, { fetchFn: async () => new Response('denied', { status: 403, headers: { 'x-deny-reason': 'host_not_allowed' } }), attach: async () => assert.fail('no attach without the brief') });
  assert.equal(blocked.needs, 'network');
  assert.match(blocked.instead, /build_progress/);
  assert.equal((await handoff(dir, 'hb_nope')).ok, false);
});

test('handoff: a setup line checks in; a build for another repository is refused before anything is taken', async () => {
  const { handoff, formatHandoff } = await import('../lib/handoff.mjs');
  const { dir } = studio('handoff-2');
  const setup = `hs_${'c'.repeat(32)}`;
  const s = await handoff(dir, setup, { checkIn: async () => ({ ok: true, name: 'Paper Comets', message: 'This repository is Paper Comets.', renamed: ['studio.json'] }), fetchFn: async () => assert.fail('a setup needs no brief') });
  assert.equal(s.ok, true);
  assert.equal(s.kind, 'setup');
  assert.match(formatHandoff(s), /new-studio checklist/);
  assert.match(formatHandoff(s), /changed: studio\.json/);
  const build = `hb_${'d'.repeat(32)}`;
  const r = await handoff(dir, build, {
    fetchFn: async () => new Response(JSON.stringify({ ok: true, kind: 'make', title: 'Crown Thief', studio: 'Paper Comets', repo: 'octo/paper-comets', id: 'crown-thief' })),
    repoOf: () => 'homie-rocks/homie',
    attach: async () => assert.fail('nothing is taken in the wrong repository'),
  });
  assert.equal(r.ok, false);
  assert.match(r.why, /for octo\/paper-comets, but this session is in homie-rocks\/homie/);
});
