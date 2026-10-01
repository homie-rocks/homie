/**
 * Remix credit and licence (0.14.4): a game's source.json says who made it (studio, game, page) and the licence its
 * owner picked; the site's manifest and landing follow the licence; `game remix` writes "Remix of <game> by
 * <studio>" with a link back into the new game's game.json, the remix's landing and credits show it, and a source
 * whose licence says no remix is refused before anything is written.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LICENSE, licenseLabel, licenseOf, pageOfSource, remixAllowed, remixCredit, remixRow } from '../worker/license.mjs';
import { OFFICE_MIGRATION_FILE } from '../worker/office.mjs';
import { STATS_MIGRATION_FILE } from '../worker/stats.mjs';
import { remixGame } from '../lib/studio.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-remix-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const editGame = (dir, id, patch) => { const p = join(dir, 'games', id, 'game.json'); writeFileSync(p, `${JSON.stringify({ ...readJson(p), ...patch }, null, 2)}\n`); };

test('the licence: three kinds and an optional SPDX id; anything else is the default', () => {
  assert.equal(DEFAULT_LICENSE, 'remix-with-credit');
  assert.deepEqual(licenseOf(undefined), { kind: 'remix-with-credit', spdx: null });
  assert.deepEqual(licenseOf('no-remix'), { kind: 'no-remix', spdx: null });
  assert.deepEqual(licenseOf('MIT'), { kind: 'remix-with-credit', spdx: 'MIT' }, 'a bare SPDX id is the default kind');
  assert.deepEqual(licenseOf({ kind: 'remix-freely', spdx: ' CC-BY-4.0 ' }), { kind: 'remix-freely', spdx: 'CC-BY-4.0' });
  assert.deepEqual(licenseOf({ kind: 'anything', spdx: 'not an id!' }), { kind: 'remix-with-credit', spdx: null });
  assert.equal(licenseLabel({ kind: 'remix-freely', spdx: 'MIT' }), 'Remix freely (MIT)');
  assert.equal(licenseLabel('no-remix'), 'Not for remixing');
  assert.equal(remixAllowed('no-remix'), false);
  assert.equal(remixAllowed(undefined), true);
  // Lineage: plain text, an https page only; a remix made before 0.14.4 has its page from its source address.
  assert.deepEqual(remixRow({ name: 'Gem\nRush', studio: 'Night Owls', page: 'javascript:alert(1)' }), { name: 'Gem Rush', studio: 'Night Owls', page: null });
  assert.equal(remixRow({ source: 'https://owls.example/games/gem-rush/source.json' }), null, 'no name, no row');
  assert.equal(remixRow({ name: 'Gem Rush', source: 'https://owls.example/games/gem-rush/source.json' }).page, 'https://owls.example/gem-rush/');
  assert.equal(pageOfSource('http://owls.example/games/gem-rush/source.json'), null);
  assert.equal(remixCredit({ name: 'Gem Rush', studio: 'Night Owls' }), 'Remix of Gem Rush by Night Owls');
  assert.equal(remixCredit({ name: 'Gem Rush' }), 'Remix of Gem Rush');
});

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Office Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

function fakeD1(dir) {
  const sql = new DatabaseSync(':memory:');
  for (const f of ['0001_studio.sql', STATS_MIGRATION_FILE, '0004_players.sql', OFFICE_MIGRATION_FILE]) sql.exec(readFileSync(join(dir, 'site', 'migrations', f), 'utf8'));
  const stmt = (query, args = []) => ({
    bind: (...a) => stmt(query, a),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args) }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: r.changes } }; },
  });
  return { sql, prepare: (q) => stmt(q), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}

function assetsOf(dir) {
  const dist = join(dir, 'site', 'dist');
  return {
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      const f = join(dist, p);
      if (!f.startsWith(dist) || !existsSync(f)) return new Response('not found', { status: 404 });
      return new Response(readFileSync(f), { headers: { 'content-type': p.endsWith('.json') ? 'application/json' : p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' } });
    },
  };
}

function namespace(Klass, envRef, waits) {
  const objs = new Map();
  return {
    idFromName: (n) => n,
    get(id) {
      if (!objs.has(id)) {
        const store = new Map();
        const ctx = { storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } }, blockConcurrencyWhile: async (fn) => fn(), waitUntil: (p) => waits.push(p) };
        objs.set(id, new Klass(ctx, envRef.env));
      }
      const o = objs.get(id);
      return { fetch: (req, init) => o.fetch(req instanceof Request ? req : new Request(req, init)) };
    },
  };
}

/** A studio with three games: one remixable under MIT, one its owner keeps from remixing, one a remix itself. */
let built = null;
async function site() {
  if (!built) {
    const dir = studio('owls');
    for (const [id, name] of [['sky-tag', 'Sky Tag'], ['vault-keep', 'Vault Keep'], ['owl-twist', 'Owl Twist']]) {
      assert.equal(run(['game', 'new', id, '--from', 'gem-rush', '--name', name], dir).status, 0);
    }
    editGame(dir, 'sky-tag', { license: { kind: 'remix-freely', spdx: 'MIT' } });
    editGame(dir, 'vault-keep', { license: 'no-remix' });
    editGame(dir, 'owl-twist', { remixOf: { credit: 'Remix of Ember Run by Lantern Works', name: 'Ember Run', studio: 'Lantern <Works>', page: 'https://lanterns.example/ember-run/', source: 'https://lanterns.example/games/ember-run/source.json', id: 'ember-run', license: licenseOf() } });
    const b = run(['build'], dir);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    built = dir;
  }
  const dir = built;
  const { default: worker, Table, Lobby } = await import('../worker/index.mjs');
  const waits = [];
  const ref = {};
  const env = { ASSETS: assetsOf(dir), DB: fakeD1(dir) };
  ref.env = env;
  env.TABLE = namespace(Table, ref, waits);
  env.LOBBY = namespace(Lobby, ref, waits);
  const ctx = { waitUntil: (p) => waits.push(p) };
  const fetchSite = async (path, init = {}) => {
    const r = await worker.fetch(new Request(`https://owls.example${path}`, { ...init, headers: { 'user-agent': BROWSER, ...(init.headers ?? {}) } }), env, ctx);
    await Promise.all(waits.splice(0));
    return r;
  };
  return { dir, fetchSite };
}

test('a game\'s source says who made it and its licence; the manifest and the landings follow the licence and show a remix\'s original', async () => {
  const { dir, fetchSite } = await site();
  // The build: credit (studio, game) and licence in source.json, the licence and lineage in the catalogue.
  const built = readJson(join(dir, 'site', 'dist', 'games', 'sky-tag', 'source.json'));
  assert.deepEqual(built.credit, { studio: 'Office Owls', game: 'Sky Tag' });
  assert.deepEqual(built.license, { kind: 'remix-freely', spdx: 'MIT' });
  const cat = readJson(join(dir, 'site', 'dist', 'games.json'));
  const row = (id) => cat.games.find((g) => g.id === id);
  assert.deepEqual(row('vault-keep').license, { kind: 'no-remix', spdx: null });
  assert.deepEqual(row('owl-twist').remixOf, { name: 'Ember Run', studio: 'Lantern <Works>', page: 'https://lanterns.example/ember-run/' });
  assert.equal(row('sky-tag').remixOf, undefined);

  // The live source adds the page here.
  const src = await fetchSite('/games/sky-tag/source.json');
  assert.equal(src.status, 200);
  const body = await src.json();
  assert.equal(body.kind, 'homie-game-source');
  assert.deepEqual(body.credit, { studio: 'Office Owls', game: 'Sky Tag', page: 'https://owls.example/sky-tag/' });
  assert.deepEqual(body.license, { kind: 'remix-freely', spdx: 'MIT' });
  assert.ok(body.files['game.json']);
  assert.equal((await (await fetchSite('/games/vault-keep/source.json')).json()).license.kind, 'no-remix', 'a no-remix source can be read; it says so');

  // The directory manifest: no remix and no source for the game whose owner said no.
  const m = await (await fetchSite('/.well-known/homie-studio.json')).json();
  const g = (id) => m.games.find((x) => x.id === id);
  assert.equal(g('sky-tag').remix, true);
  assert.equal(g('sky-tag').source, 'https://owls.example/games/sky-tag/source.json');
  assert.deepEqual(g('sky-tag').license, { kind: 'remix-freely', spdx: 'MIT' });
  assert.equal(g('vault-keep').remix, false);
  assert.equal(g('vault-keep').source, undefined);
  assert.deepEqual(g('owl-twist').remixOf, { name: 'Ember Run', studio: 'Lantern <Works>', page: 'https://lanterns.example/ember-run/' });

  // The landings.
  const twist = await (await fetchSite('/owl-twist/')).text();
  const line = 'Remix of <a href="https://lanterns.example/ember-run/" rel="noopener">Ember Run</a> by Lantern &lt;Works&gt;';
  assert.match(twist, new RegExp(`<p class="remix-of">${line.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}</p>`), 'under its name');
  assert.match(twist, /<h3>Remix of<\/h3><p><a href="https:\/\/lanterns\.example\/ember-run\/" rel="noopener">Ember Run<\/a> by Lantern &lt;Works&gt;\.<\/p>/, 'and in its credits');
  assert.doesNotMatch(twist, /Lantern <Works>/, 'escaped');
  const keep = await (await fetchSite('/vault-keep/')).text();
  assert.doesNotMatch(keep, /Open to remix|See the source|\?remix=/);
  assert.match(keep, /Its source: Not for remixing\./);
  assert.doesNotMatch(keep, /class="remix-of"/);
  const sky = await (await fetchSite('/sky-tag/')).text();
  assert.match(sky, /Open to remix/);
  assert.match(sky, /Its source: Remix freely \(MIT\)\./);
});

test('game remix credits the original in the new game.json, keeps a remix\'s own original, and refuses a no-remix source', async () => {
  const { fetchSite } = await site();
  // The studio's site, served on this computer (remixGame takes http only from 127.0.0.1 and localhost).
  const legacy = { v: 1, kind: 'homie-game-source', id: 'old-one', files: { 'game.json': JSON.stringify({ id: 'old-one', name: 'Old One' }) } };
  const server = createServer(async (req, res) => {
    if (req.url === '/games/old-one/source.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(legacy)); return; }
    const r = await fetchSite(req.url);
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const at = `http://127.0.0.1:${server.address().port}`;
  try {
    const mine = studio('mine');
    const r = await remixGame(mine, `${at}/games/sky-tag/source.json`, 'sky-tag-2', { name: 'Sky Tag Two' });
    assert.equal(r.credit, 'Remix of Sky Tag by Office Owls');
    assert.equal(r.page, 'https://owls.example/sky-tag/');
    const meta = readJson(join(mine, 'games', 'sky-tag-2', 'game.json'));
    assert.equal(meta.id, 'sky-tag-2');
    assert.equal(meta.name, 'Sky Tag Two');
    assert.deepEqual(meta.remixOf, {
      credit: 'Remix of Sky Tag by Office Owls', name: 'Sky Tag', studio: 'Office Owls', page: 'https://owls.example/sky-tag/',
      source: `${at}/games/sky-tag/source.json`, id: 'sky-tag', license: { kind: 'remix-freely', spdx: 'MIT' },
    });
    // A remix of a remix keeps what the original was a remix of.
    const again = await remixGame(mine, `${at}/games/owl-twist/source.json`, 'owl-twist-2');
    assert.equal(again.credit, 'Remix of Owl Twist by Office Owls');
    assert.deepEqual(readJson(join(mine, 'games', 'owl-twist-2', 'game.json')).remixOf.of, { name: 'Ember Run', studio: 'Lantern <Works>', page: 'https://lanterns.example/ember-run/' });
    // A source from before 0.14.4 (no credit, no licence): the default licence, the name from its game.json.
    const old = await remixGame(mine, `${at}/games/old-one/source.json`, 'old-two');
    assert.equal(old.credit, 'Remix of Old One');
    assert.deepEqual(readJson(join(mine, 'games', 'old-two', 'game.json')).remixOf.license, { kind: 'remix-with-credit', spdx: null });
    // No remix: refused, and nothing written.
    await assert.rejects(remixGame(mine, `${at}/games/vault-keep/source.json`, 'vault-keep-2'), /Vault Keep by Office Owls is not open to remixing: its owner's licence says no remix/);
    assert.equal(existsSync(join(mine, 'games', 'vault-keep-2')), false);
    // And the remix's own landing shows its original, once built.
    const b = run(['build', 'sky-tag-2'], mine);
    assert.equal(JSON.parse(b.stdout).ok, true, b.stdout + b.stderr);
    assert.deepEqual(readJson(join(mine, 'site', 'dist', 'games.json')).games.find((x) => x.id === 'sky-tag-2').remixOf, { name: 'Sky Tag', studio: 'Office Owls', page: 'https://owls.example/sky-tag/' });
  } finally {
    server.close();
  }
});
