/**
 * @homie-rocks/studio 0.12.0: player accounts (passkeys), guests, cloud saves, lifetime stats and memorials.
 *
 *   - a passkey made on one device signs in on another (the same credential) and finds the same saves;
 *   - a guest is made by the first save, keeps it, and upgrades to an account without losing anything; a guest who
 *     signs in to an account they already have brings over only what the account lacks;
 *   - saves are versioned: a write from a stale copy is a conflict, never a silent overwrite; sizes are capped,
 *     and a large save goes to R2 (never served by /media/);
 *   - stats only add up (or keep the highest / lowest) and survive a wipe; a hardcore death writes a memorial and
 *     wipes the game's saves in one step;
 *   - export has everything, delete leaves nothing; names follow the handle rules; the owner sees counts and names,
 *     never a passkey or an email;
 *   - every ceremony checks its challenge (spent once), origin, rp id, presence and signature counter.
 * The D1 is node:sqlite with the studio's own migrations; the authenticator is WebCrypto P-256.
 * Run: node --test packages/studio/test/players.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import worker, { players, cleanName } from '../worker/index.mjs';
import { PLAYERS_MIGRATION, PLAYERS_MIGRATION_FILE, resetLimits } from '../worker/players.mjs';
import { SAVE_LIMITS } from '../worker/saves.mjs';
import { STATS_MIGRATION } from '../worker/stats.mjs';
import { cborDecode, derToRaw, parseAuthData } from '../worker/webauthn.mjs';
import { ensurePlayersMigration, studioFiles } from '../lib/scaffold.mjs';
import { build as esbuild } from 'esbuild';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://owls.example';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const enc = new TextEncoder();
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
/** An address for the tests, built from parts. */
const addr = (user, domain) => [user, domain].join('@');
const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof b === 'string' ? enc.encode(b) : b));

/* ------------------------------------------------------------------ a D1 on node:sqlite */

function fakeD1() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(studioFiles({ name: 'Owls', slug: 'owls', homie: 'https://homie.test' })['site/migrations/0001_studio.sql']);
  sql.exec(STATS_MIGRATION);
  sql.exec(PLAYERS_MIGRATION);
  const norm = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));
  const stmt = (query, args = []) => ({
    query, args,
    bind: (...a) => stmt(query, norm(a)),
    first: async () => sql.prepare(query).get(...args) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...args), success: true }),
    run: async () => { const r = sql.prepare(query).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
  });
  return {
    sql,
    prepare: (q) => stmt(q),
    batch: async (list) => {
      sql.exec('BEGIN');
      try {
        const out = list.map((s) => ({ results: sql.prepare(s.query).all(...s.args), success: true }));
        sql.exec('COMMIT');
        return out;
      } catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    put: async (k, v) => { objects.set(k, String(v)); },
    get: async (k) => (objects.has(k) ? { text: async () => objects.get(k), size: objects.get(k).length, writeHttpMetadata() {}, httpEtag: '"x"', body: objects.get(k) } : null),
    head: async (k) => (objects.has(k) ? { size: objects.get(k).length } : null),
    delete: async (k) => { for (const x of [].concat(k)) objects.delete(x); },
  };
}

const CATALOGUE = {
  studio: { name: 'Night Owls', slug: 'owls', theme: {} },
  games: [
    { id: 'ember', name: 'Ember Vale', blurb: 'A persistent hero.', players: { min: 1, max: 8 }, saves: true, landing: { hero: {}, credits: { people: [] } } },
    { id: 'gems', name: 'Gem Rush', blurb: 'Grab gems.', players: { min: 1, max: 8 }, landing: { hero: {}, credits: { people: [] } } },
  ],
  songs: [], videos: [], posts: [], site: { pages: [], partials: {} },
};
const ASSETS = {
  async fetch(req) {
    const p = new URL(req.url).pathname;
    if (p === '/games.json') return new Response(JSON.stringify(CATALOGUE), { headers: { 'content-type': 'application/json' } });
    if (p.endsWith('/index.html')) return new Response('<!doctype html><html><head><title>g</title></head><body></body></html>', { headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404 });
  },
};

function site({ r2 = false, mail = null, preview = false } = {}) {
  const DB = fakeD1();
  const env = { DB, ASSETS, STUDIO_NAME: 'Night Owls', ...(r2 ? { MEDIA: fakeR2() } : {}), ...(mail ? { PLAYER_MAIL: mail, PLAYER_MAIL_FROM: addr('players', 'owls.example') } : {}), ...(preview ? { HOMIE_PREVIEW: '1' } : {}) };
  return env;
}

/** A browser: its own cookie jar, its own address. */
function browser(env, { ip = '198.51.100.7', origin = ORIGIN } = {}) {
  const jar = new Map();
  const call = async (method, path, body, extra = {}) => {
    const headers = { 'user-agent': UA, 'cf-connecting-ip': ip, ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...extra };
    if (method !== 'GET') { headers.origin = headers.origin ?? origin; if (body !== undefined) headers['content-type'] = headers['content-type'] ?? 'application/json'; }
    const res = await worker.fetch(new Request(`${origin}${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env, { waitUntil() {} });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Max-Age=0/.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, res, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { jar, call, get: (p, h) => call('GET', p, undefined, h), post: (p, b, h) => call('POST', p, b ?? {}, h) };
}

/* ------------------------------------------------------------------ a passkey authenticator in software */

function cbor(v) {
  const head = (major, n) => (n < 24 ? [major << 5 | n] : n < 256 ? [major << 5 | 24, n] : n < 65536 ? [major << 5 | 25, n >> 8, n & 255] : [major << 5 | 26, n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  if (typeof v === 'number') return Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v));
  if (typeof v === 'string') { const b = enc.encode(v); return Uint8Array.from([...head(3, b.length), ...b]); }
  if (v instanceof Uint8Array) return Uint8Array.from([...head(2, v.length), ...v]);
  if (v instanceof Map) { const parts = [Uint8Array.from(head(5, v.size))]; for (const [k, x] of v) parts.push(cbor(k), cbor(x)); return Uint8Array.from(parts.flatMap((p) => [...p])); }
  throw new Error('cbor');
}

function rawToDer(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = [...b.slice(i)]; if (v[0] & 0x80) v = [0, ...v]; return [0x02, v.length, ...v]; };
  const body = [...int(raw.slice(0, 32)), ...int(raw.slice(32))];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/** One passkey: what a phone's keychain keeps. `sync` copies it to another device (same key, same id). */
async function authenticator({ rpId = 'owls.example', counter = false } = {}) {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const id = crypto.getRandomValues(new Uint8Array(16));
  let count = 0;
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const self = {
    id: b64u(id),
    async create(options, { origin = ORIGIN, type = 'webauthn.create', up = true, rp = rpId } = {}) {
      const client = enc.encode(JSON.stringify({ type, challenge: options.challenge, origin, crossOrigin: false }));
      const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]);
      const authData = Uint8Array.from([...await sha(rp), (up ? 0x01 : 0) | 0x04 | 0x08 | 0x10 | 0x40, 0, 0, 0, 0, ...new Uint8Array(16), 0, id.length, ...id, ...cbor(cose)]);
      const att = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', response: { clientDataJSON: b64u(client), attestationObject: b64u(att), transports: ['internal'] } };
    },
    async get(options, { origin = ORIGIN, rp = rpId, nextCount = null } = {}) {
      if (counter) count = nextCount ?? count + 1;
      const client = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const authData = Uint8Array.from([...await sha(rp), 0x01 | 0x04 | 0x08 | 0x10, (count >>> 24) & 255, (count >> 16) & 255, (count >> 8) & 255, count & 255]);
      const signed = Uint8Array.from([...authData, ...await sha(client)]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed));
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', response: { clientDataJSON: b64u(client), authenticatorData: b64u(authData), signature: b64u(rawToDer(raw)), userHandle: null } };
    },
  };
  return self;
}

async function signUp(b, key, name) {
  const o = await b.post('/api/player/signup/options', {});
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return b.post('/api/player/signup', { credential: await key.create(o.body.options), ...(name ? { name } : {}) });
}
async function signIn(b, key, opts) {
  const o = await b.post('/api/player/signin/options', {});
  assert.equal(o.status, 200, JSON.stringify(o.body));
  return b.post('/api/player/signin', { credential: await key.get(o.body.options, opts) });
}

test.beforeEach(() => resetLimits());

/** The SDK as a game gets it: bundled by esbuild (as `homie-studio build` does), then imported. */
let createSaves;
let sdkDir = null;
test.after(() => { if (sdkDir) rmSync(sdkDir, { recursive: true, force: true }); });
test.before(async () => {
  sdkDir = realpathSync(mkdtempSync(join(tmpdir(), 'homie-saves-sdk-')));
  const file = join(sdkDir, 'saves.mjs');
  await esbuild({ entryPoints: [join(PKG, 'saves', 'saves.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent' });
  ({ createSaves } = await import(file));
});

/* ------------------------------------------------------------------ the tests */

test('a passkey account: made on a phone, signed in on a laptop with the same (synced) passkey, the same saves', async () => {
  const env = site();
  const phone = browser(env);
  const key = await authenticator();
  const made = await signUp(phone, key, 'Aria the Bold');
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.made, 'account');
  assert.equal(made.body.player.name, 'Aria the Bold');
  assert.equal(made.body.player.guest, false);
  assert.match(made.body.player.id, /^pl_[A-Za-z0-9_-]{22}$/);
  const cookie = made.res.headers.getSetCookie().find((c) => c.startsWith('studio_player='));
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/); assert.match(cookie, /Path=\//);

  const save = await phone.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { name: 'Aria', level: 7, gold: 120 }, base: 0 }] });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.deepEqual(save.body.results, [{ key: 'hero', ok: true, version: 1 }]);

  const laptop = browser(env, { ip: '203.0.113.20' });
  assert.equal((await laptop.get('/api/player/me')).body.player, null, 'a new device knows nobody');
  const inn = await signIn(laptop, key);
  assert.equal(inn.status, 200, JSON.stringify(inn.body));
  assert.equal(inn.body.player.id, made.body.player.id);
  const got = await laptop.get('/api/player/saves/ember/hero');
  assert.deepEqual(got.body.value, { name: 'Aria', level: 7, gold: 120 });
  assert.equal(got.body.version, 1);
  const list = await laptop.get('/api/player/saves/ember?values=1');
  assert.equal(list.body.keys.length, 1);
  assert.equal(list.body.player.name, 'Aria the Bold');

  // The database keeps the public key and hashes, never a session or a challenge in the clear.
  const row = env.DB.sql.prepare('SELECT public_key FROM player_passkeys').get();
  assert.deepEqual(Object.keys(JSON.parse(row.public_key)).sort(), ['crv', 'kty', 'x', 'y']);
  for (const s of env.DB.sql.prepare('SELECT hash FROM player_sessions').all()) assert.match(s.hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(env.DB.sql.prepare('SELECT * FROM player_sessions').all()).includes(phone.jar.get('studio_player')));
});

test('a guest: the first save makes one (no Play gate), it upgrades to an account and keeps everything', async () => {
  const env = site();
  const b = browser(env);
  assert.equal((await b.get('/api/player/saves/ember?values=1')).body.player, null, 'reading makes nobody');
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM players').get().n, 0);
  const first = await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { level: 2 } }] });
  assert.equal(first.status, 200);
  assert.equal(first.body.player.guest, true);
  assert.equal(first.body.player.fresh, true);
  assert.match(first.body.player.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/, 'a guest has a two-word handle');
  const guestId = first.body.player.id;
  await b.post('/api/player/stats/ember', { add: { kills: 3 } });
  const up = await signUp(b, await authenticator(), 'Brann');
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.made, 'upgraded');
  assert.equal(up.body.player.id, guestId, 'the same player: nothing moves');
  assert.equal(up.body.player.guest, false);
  assert.equal(up.body.player.name, 'Brann');
  assert.deepEqual((await b.get('/api/player/saves/ember/hero')).body.value, { level: 2 });
  assert.deepEqual((await b.get('/api/player/stats/ember')).body.stats, { kills: 3 });
  assert.match(up.res.headers.getSetCookie().join(), /Max-Age=10368000/, 'the session now lives as an account\'s (120 days)');
});

test('a guest signs in to the account they already have: the account keeps its saves; what only the guest had moves over', async () => {
  const env = site();
  const key = await authenticator();
  const home = browser(env);
  await signUp(home, key, 'Cass');
  await home.post('/api/player/saves/ember', { set: [{ key: 'hero', value: 'account hero' }] });
  await home.post('/api/player/stats/ember', { add: { kills: 10 } });

  const cafe = browser(env, { ip: '192.0.2.44' });
  await cafe.post('/api/player/saves/ember', { set: [{ key: 'hero', value: 'guest hero' }, { key: 'pet', value: 'owl' }] });
  await cafe.post('/api/player/stats/ember', { add: { kills: 2, fished: 4 } });
  const guest = (await cafe.get('/api/player/me')).body.player.id;
  const inn = await signIn(cafe, key);
  assert.equal(inn.body.adoptedGuest, true);
  const saves = (await cafe.get('/api/player/saves/ember?values=1')).body.keys;
  assert.deepEqual(Object.fromEntries(saves.map((k) => [k.key, k.value])), { hero: 'account hero', pet: 'owl' });
  assert.deepEqual((await cafe.get('/api/player/stats/ember')).body.stats, { fished: 4, kills: 10 });
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM players WHERE id = ?').get(guest).n, 0, 'the guest is gone');
  assert.equal(env.DB.sql.prepare('SELECT COUNT(*) AS n FROM saves WHERE player = ?').get(guest).n, 0);
});

test('saves are versioned: a stale copy is a conflict with the current value, never a silent overwrite', async () => {
  const env = site();
  const b = browser(env);
  await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { level: 1 }, base: 0 }] });
  const v2 = await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { level: 2 }, base: 1 }] });
  assert.equal(v2.body.results[0].version, 2);
  const stale = await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { level: 1, offline: true }, base: 1 }] });
  assert.equal(stale.body.results[0].ok, false);
  assert.equal(stale.body.results[0].error, 'conflict');
  assert.deepEqual(stale.body.results[0].current, { value: { level: 2 }, version: 2 });
  const again = await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: 'x', base: 0 }] });
  assert.equal(again.body.results[0].error, 'conflict', 'base 0 means "new key": it exists');
  const forced = await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { level: 9 } }] });
  assert.equal(forced.body.results[0].version, 3, 'no base: unconditional');
  const del = await b.post('/api/player/saves/ember', { del: [{ key: 'hero', base: 3 }] });
  assert.deepEqual(del.body.results, [{ key: 'hero', ok: true, version: 0 }]);
  assert.equal((await b.get('/api/player/saves/ember/hero')).body.value, null);
});

test('save limits: key names, value size, keys per game, a batch; a large save goes to R2 and is never served by /media/', async () => {
  const env = site();
  const b = browser(env);
  const r = await b.post('/api/player/saves/ember', { set: [{ key: 'bad key!', value: 1 }, { key: 'big', value: 'x'.repeat(SAVE_LIMITS.valueBytes + 10) }, { key: 'nothing' }] });
  assert.deepEqual(r.body.results.map((x) => x.error), ['key', 'too-large', 'value']);
  const many = Array.from({ length: SAVE_LIMITS.keys }, (_, i) => ({ key: `k${i}`, value: i }));
  for (let i = 0; i < many.length; i += 32) assert.ok((await b.post('/api/player/saves/ember', { set: many.slice(i, i + 32) })).body.results.every((x) => x.ok));
  assert.equal((await b.post('/api/player/saves/ember', { set: [{ key: 'one-more', value: 1 }] })).body.results[0].error, 'too-many-keys');
  assert.equal((await b.post('/api/player/saves/ember', { set: Array.from({ length: 33 }, (_, i) => ({ key: `b${i}`, value: 1 })) })).status, 400);
  assert.equal((await b.post('/api/player/saves/nope', { set: [{ key: 'a', value: 1 }] })).status, 404, 'only this studio\'s games');

  const big = site({ r2: true });
  const c = browser(big);
  const value = { map: 'y'.repeat(200_000) };
  const w = await c.post('/api/player/saves/ember', { set: [{ key: 'world', value }] });
  assert.equal(w.body.results[0].ok, true, JSON.stringify(w.body));
  const row = big.DB.sql.prepare("SELECT value, blob, bytes FROM saves WHERE key = 'world'").get();
  assert.equal(row.blob, 1);
  assert.match(row.value, /^r2:players\/[A-Za-z0-9_-]{32}$/);
  assert.deepEqual((await c.get('/api/player/saves/ember/world')).body.value, value);
  const objectKey = row.value.slice(3);
  assert.equal((await c.get(`/media/${objectKey}`)).status, 404, 'a player\'s save is not public media');
  await c.post('/api/player/saves/ember', { set: [{ key: 'world', value: { small: true } }] });
  assert.equal(big.MEDIA.objects.has(objectKey), false, 'the old object goes when the save is replaced');
});

test('lifetime stats add up and survive a wipe; a hardcore death is a memorial and a wipe in one step', async () => {
  const env = site();
  const b = browser(env);
  await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { name: 'Dax', level: 14 } }, { key: 'settings', value: { music: 0.4 } }] });
  await b.post('/api/player/stats/ember', { add: { kills: 5, seconds: 600, gold: 300 }, max: { level: 14 }, min: { bestLap: 90 } });
  const s = await b.post('/api/player/stats/ember', { add: { kills: 2 }, max: { level: 3 }, min: { bestLap: 75 } });
  assert.deepEqual(s.body.stats, { bestLap: 75, gold: 300, kills: 7, level: 14, seconds: 600 });
  assert.equal((await b.post('/api/player/stats/ember', { add: { 'bad name': 1 } })).status, 400);
  assert.equal((await b.post('/api/player/stats/ember', { add: { kills: 'lots' } })).status, 400);

  const died = await b.post('/api/player/fallen/ember', { character: 'Dax\u202e the\u200b Brave', summary: { level: 14, cause: 'the Slime King' }, wipe: true, keep: ['settings'] });
  assert.equal(died.status, 200, JSON.stringify(died.body));
  assert.equal(died.body.memorial.character, 'Dax the Brave', 'invisible and bidi characters never reach a memorial');
  assert.deepEqual(died.body.wiped, ['hero']);
  const left = (await b.get('/api/player/saves/ember?values=1')).body.keys.map((k) => k.key);
  assert.deepEqual(left, ['settings'], 'kept what the game asked to keep');
  assert.equal((await b.get('/api/player/stats/ember')).body.stats.kills, 7, 'stats survive the wipe');
  const hall = await browser(env, { ip: '192.0.2.99' }).get('/api/player/fallen/ember');
  assert.equal(hall.body.fallen.length, 1);
  assert.deepEqual(Object.keys(hall.body.fallen[0]).sort(), ['at', 'character', 'player', 'summary'], 'the hall shows no player id');
  assert.equal(hall.body.fallen[0].summary.cause, 'the Slime King');
  for (let i = 1; i < SAVE_LIMITS.memorialsPerDay; i++) await b.post('/api/player/fallen/ember', { character: `Hero ${i}` });
  assert.equal((await b.post('/api/player/fallen/ember', { character: 'One too many' })).status, 429);
});

test('export has everything of the player; delete leaves nothing; a deleted passkey no longer signs in', async () => {
  const env = site({ r2: true });
  const b = browser(env);
  const key = await authenticator();
  const made = await signUp(b, key, 'Eve');
  await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { level: 3 } }, { key: 'atlas', value: 'z'.repeat(100_000) }] });
  await b.post('/api/player/stats/ember', { add: { kills: 1 } });
  await b.post('/api/player/fallen/ember', { character: 'Old Eve', summary: { level: 1 } });
  const ex = await b.get('/api/player/export');
  assert.match(ex.res.headers.get('content-disposition'), /attachment/);
  assert.equal(ex.body.kind, 'homie-studio-player');
  assert.equal(ex.body.player.name, 'Eve');
  assert.deepEqual(ex.body.games.ember.saves.hero.value, { level: 3 });
  assert.equal(ex.body.games.ember.saves.atlas.value.length, 100_000, 'large saves come from R2 into the export');
  assert.equal(ex.body.games.ember.stats.kills, 1);
  assert.equal(ex.body.games.ember.memorials[0].character, 'Old Eve');
  assert.equal(ex.body.passkeys.length, 1);
  assert.ok(!JSON.stringify(ex.body).includes(key.id), 'the export names no credential id');

  assert.equal((await b.post('/api/player/delete', {})).status, 400, 'delete asks for a confirmation');
  const del = await b.post('/api/player/delete', { confirm: 'delete' });
  assert.equal(del.body.ok, true);
  for (const t of ['players', 'player_passkeys', 'player_sessions', 'saves', 'player_stats', 'memorials', 'player_emails']) {
    assert.equal(env.DB.sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, `${t} is empty`);
  }
  assert.equal(env.MEDIA.objects.size, 0, 'the large save\'s object is gone too');
  assert.equal(b.jar.has('studio_player'), false, 'the cookie is cleared');
  const back = await signIn(browser(env), key);
  assert.equal(back.status, 401);
  assert.equal(back.body.error, 'unknown');
  assert.ok(made.body.player.id);
});

test('names follow the handle rules: one line, 24 characters, no invisible tricks, never a role or the studio\'s name', async () => {
  assert.deepEqual(cleanName('  Neon \n\t Otter  '), { ok: true, name: 'Neon Otter', cut: false });
  assert.equal(cleanName('A\u200bd\u202emin').ok, false, 'zero-width and bidi are stripped first, so "Admin" is caught');
  assert.equal(cleanName('Moderator Bob').ok, false);
  assert.equal(cleanName('the owner').ok, false);
  assert.equal(cleanName('Night Owls', { studio: 'Night Owls' }).ok, false);
  assert.equal(cleanName('Night Owls', { studio: 'Night Owls', owner: true }).ok, true, 'the owner may');
  assert.equal(cleanName('!!!').ok, false);
  assert.equal(cleanName('x'.repeat(40)).name.length, 24);
  assert.equal(cleanName('\uff26\uff55\uff4c\uff4c\uff57\uff49\uff44\uff54\uff48').name, 'Fullwidth', 'NFKC: lookalike forms become plain letters');
  const env = site();
  const b = browser(env);
  await signUp(b, await authenticator());
  const r = await b.post('/api/player/name', { name: 'Admin' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'name-taken');
  assert.equal((await b.post('/api/player/name', { name: '<b>Kit</b>' })).body.player.name, '<b>Kit</b>', 'kept as text; every page escapes it');
});

test('ceremonies refuse a replayed challenge, another origin, another site\'s passkey, no presence, a counter going back', async () => {
  const env = site();
  const b = browser(env);
  const key = await authenticator({ counter: true });
  await signUp(b, key);
  const o = await b.post('/api/player/signin/options', {});
  const cred = await key.get(o.body.options);
  assert.equal((await browser(env).post('/api/player/signin', { credential: cred })).status, 200);
  assert.equal((await browser(env).post('/api/player/signin', { credential: cred })).body.error, 'challenge', 'a challenge is spent once');
  const o2 = await b.post('/api/player/signin/options', {});
  assert.equal((await browser(env).post('/api/player/signin', { credential: await key.get(o2.body.options, { origin: 'https://evil.example' }) })).status, 401);
  const o3 = await b.post('/api/player/signin/options', {});
  assert.equal((await browser(env).post('/api/player/signin', { credential: await key.get(o3.body.options, { rp: 'evil.example' }) })).status, 401);
  const o4 = await b.post('/api/player/signin/options', {});
  const back = await browser(env).post('/api/player/signin', { credential: await key.get(o4.body.options, { nextCount: 1 }) });
  assert.equal(back.body.error, 'counter', 'a counter that went back is a copied authenticator');
  const fresh = browser(env);
  const up = await fresh.post('/api/player/signup/options', {});
  const r = await fresh.post('/api/player/signup', { credential: await (await authenticator()).create(up.body.options, { up: false }) });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /presence/);
  const up2 = await fresh.post('/api/player/signup/options', {});
  assert.equal((await fresh.post('/api/player/signup', { credential: await key.create(up2.body.options) })).body.error, 'known', 'one passkey, one account');
});

test('requests: same origin and JSON only; rate limits per address; a Preview has no accounts; before the migration it says so', async () => {
  const env = site();
  const b = browser(env);
  assert.equal((await b.post('/api/player/saves/ember', { set: [] }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await b.call('POST', '/api/player/saves/ember', 'set=1', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
  let last = 0;
  for (let i = 0; i < 61; i++) last = (await b.post('/api/player/signin/options', {})).status;
  assert.equal(last, 429, 'sixty ceremonies per address per ten minutes');
  assert.equal((await browser(site({ preview: true })).get('/api/player/me')).status, 503);
  const old = site();
  old.DB.sql.exec('DROP TABLE players');
  const r = await browser(old).post('/api/player/saves/ember', { set: [{ key: 'hero', value: 1 }] });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'not-migrated');
});

test('the back office: counts, a list and one player, never a passkey, a session or an email; the owner is recognised', async () => {
  const sent = [];
  const env = site({ mail: { send: async (m) => { sent.push(m); return { messageId: 'm1' }; } } });
  const owner = browser(env);
  const ownerKey = await authenticator();
  const made = await signUp(owner, ownerKey, 'Studio Boss');
  await owner.post('/api/player/email', { email: addr('Boss', 'Owls.Example') });
  const guest = browser(env, { ip: '192.0.2.5' });
  await guest.post('/api/player/saves/ember', { set: [{ key: 'hero', value: 1 }] });
  assert.equal(await players.isOwner(new Request(`${ORIGIN}/`, { headers: { cookie: `studio_player=${owner.jar.get('studio_player')}` } }), env), false);

  // `homie-studio players owner` puts a one-time key's hash in stats_keys; the owner presses the button once.
  const k = `hsk_${'ab'.repeat(24)}`;
  env.DB.sql.prepare("INSERT INTO stats_keys (hash, kind, expires_at) VALUES (?, 'player-owner', ?)").run(Buffer.from(await sha(k)).toString('hex'), Date.now() + 60_000);
  assert.equal((await guest.post('/api/player/owner', { k })).status, 403, 'a guest cannot be the owner');
  const claimed = await owner.post('/api/player/owner', { k });
  assert.equal(claimed.body.player.owner, true);
  assert.equal((await owner.post('/api/player/owner', { k })).status, 403, 'the link works once');
  assert.equal(await players.isOwner(new Request(`${ORIGIN}/ember/play`, { headers: { cookie: `studio_player=${owner.jar.get('studio_player')}` } }), env), true);
  assert.equal(await players.isOwner(new Request(`${ORIGIN}/`), env), false);

  assert.deepEqual(await players.count(env), { accounts: 1, guests: 1, owners: 1, new7d: 1, active1d: 2, active7d: 2 });
  const list = await players.list(env);
  assert.equal(list.players.length, 1, 'guests are left out unless asked');
  assert.equal((await players.list(env, { guests: true })).players.length, 2);
  assert.equal((await players.list(env, { q: 'boss' })).players[0].name, 'Studio Boss');
  const one = await players.get(env, made.body.player.id);
  assert.equal(one.passkeys, 1);
  assert.deepEqual(await players.get(made.body.player.id, env), one, 'the back office seam passes (id, env)');
  const shown = JSON.stringify([list, one]);
  assert.ok(!shown.includes(ownerKey.id) && !/public_key|boss@owls/i.test(shown), 'no credential, key or email');
  const pass = await players.passFor(env, made.body.player.id, { game: 'ember' });
  assert.deepEqual(await players.readPass(env, pass), { id: made.body.player.id, name: 'Studio Boss', guest: false, owner: true, game: 'ember' });
  assert.equal(await players.readPass(env, 'pp_nope'), null);
  const viaHttp = await owner.post('/api/player/pass', { game: 'ember' });
  assert.match(viaHttp.body.pass, /^pp_/);
  assert.equal((await players.rename(env, made.body.player.id, 'Moderator')).ok, true, 'the owner may rename anyone, even to a role');
  assert.deepEqual(await players.remove(env, one.id), { ok: true });
  assert.equal((await players.count(env)).accounts, 0);
});

test('a recovery email (only with a mail sender): confirm it, lose every passkey, come back with a new one', async () => {
  const sent = [];
  const env = site({ mail: { send: async (m) => { sent.push(m); return { messageId: String(sent.length) }; } } });
  const b = browser(env);
  const old = await authenticator();
  const made = await signUp(b, old, 'Fen');
  await b.post('/api/player/saves/ember', { set: [{ key: 'hero', value: { level: 30 } }] });
  const add = await b.post('/api/player/email', { email: addr('fen', 'example.com') });
  assert.equal(add.body.sent, true);
  assert.equal(sent[0].to, addr('fen', 'example.com'));
  assert.equal(sent[0].from, addr('players', 'owls.example'));
  const verifyK = /k=([A-Za-z0-9_-]{43})/.exec(sent[0].text)[1];
  const elsewhere = browser(env, { ip: '192.0.2.200' });
  assert.equal((await elsewhere.post('/api/player/email/verify', { k: verifyK })).body.verified, true);
  assert.equal((await b.get('/api/player/me')).body.player.email.verified, true);

  const lost = browser(env, { ip: '192.0.2.201' });
  const nobody = await lost.post('/api/player/recover', { email: addr('nobody', 'example.com') });
  const fen = await lost.post('/api/player/recover', { email: addr('FEN', 'example.com') });
  assert.equal(nobody.body.message, fen.body.message, 'the same answer whether or not an address has an account');
  assert.equal(sent.length, 2, 'only the real account gets a mail');
  const recoverK = /k=([A-Za-z0-9_-]{43})/.exec(sent[1].text)[1];
  const opts = await lost.post('/api/player/recover/options', { k: recoverK });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  const fresh = await authenticator();
  const back = await lost.post('/api/player/signup', { credential: await fresh.create(opts.body.options) });
  assert.equal(back.body.made, 'recovered');
  assert.equal(back.body.player.id, made.body.player.id);
  assert.deepEqual((await lost.get('/api/player/saves/ember/hero')).body.value, { level: 30 });
  assert.equal((await b.get('/api/player/me')).body.player, null, 'the old sessions ended');
  assert.equal((await lost.post('/api/player/recover/options', { k: recoverK })).status, 400, 'the link works once');
  assert.equal((await browser(site()).post('/api/player/recover', { email: addr('a', 'b.co') })).status, 404, 'no mail sender, no recovery email');
});

test('the play page: a game with saves gets the saves bridge and a who-is-playing row; a game without does not', async () => {
  const env = site();
  const b = browser(env);
  const play = await b.get('/ember/play');
  assert.match(play.body, /homie-save/);
  assert.match(play.body, /data-who/);
  assert.match(play.body, /homiePasskey/);
  const plain = await b.get('/gems/play');
  assert.doesNotMatch(plain.body, /homie-save/);
  const tv = await b.get('/ember/tv');
  assert.doesNotMatch(tv.body, /homie-save/, 'the big screen saves nothing');
  const frame = await b.get('/ember/__game/?room=pub-1');
  assert.match(frame.body, /"saves":true/);
  assert.doesNotMatch((await b.get('/gems/__game/?room=pub-1')).body, /"saves"/);
  const account = await b.get('/account/?next=/ember/play');
  assert.equal(account.status, 200);
  assert.match(account.body, /Your player account/);
  assert.match(account.body, /src="\/_homie\/account\.js"/);
  assert.match(account.res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.doesNotMatch(account.body, /<script>(?!<\/)/, 'no inline script on a page with a strict CSP');
  assert.match((await b.get('/_homie/account.js')).body, /homiePasskey/);
  assert.match((await b.get('/account/?next=//evil.example')).body, /"next":"\/account\/"/, 'next stays on this site');
});

test('webauthn pieces: CBOR, authenticator data, DER signatures', async () => {
  const [m] = cborDecode(cbor(new Map([[1, 2], [-1, 1], ['s', 'x'], [3, new Uint8Array([1, 2])]])));
  assert.equal(m.get(1), 2); assert.equal(m.get(-1), 1); assert.equal(m.get('s'), 'x'); assert.deepEqual([...m.get(3)], [1, 2]);
  assert.throws(() => cborDecode(Uint8Array.from([0x9f])), /cbor/);
  const raw = crypto.getRandomValues(new Uint8Array(64));
  raw[0] = 0; raw[32] = 0x80;
  assert.deepEqual([...derToRaw(rawToDer(raw))], [...raw]);
  assert.throws(() => parseAuthData(new Uint8Array(10)), /short/);
});

test('scaffold: a new studio has the players migration; an older one gets it once; it is idempotent', () => {
  const files = studioFiles({ name: 'Owls', slug: 'owls', homie: 'https://homie.test' });
  assert.equal(files[`site/migrations/${PLAYERS_MIGRATION_FILE}`], PLAYERS_MIGRATION);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'homie-players-')));
  try {
    assert.equal(ensurePlayersMigration(dir), `site/migrations/${PLAYERS_MIGRATION_FILE}`);
    assert.equal(ensurePlayersMigration(dir), null);
    assert.ok(existsSync(join(dir, 'site', 'migrations', PLAYERS_MIGRATION_FILE)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const sql = new DatabaseSync(':memory:');
  sql.exec(PLAYERS_MIGRATION); sql.exec(PLAYERS_MIGRATION);
  assert.ok(!/ip|address|password/i.test(PLAYERS_MIGRATION.replace(/--.*$/gm, '')), 'no column for an address or a password');
  assert.ok(readFileSync(join(PKG, 'saves', 'SAVES.md'), 'utf8').includes('What is stored'));
});

test('the game SDK without a shell keeps everything in the page (local mode), with the same calls', async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const saves = createSaves({ game: 'ember', local: true, storage });
  const p = await saves.ready;
  assert.equal(p.local, true);
  assert.equal(saves.mode, 'local');
  assert.deepEqual(await saves.set('hero', { level: 1 }), { ok: true, synced: true, version: 1 });
  assert.equal((await saves.set('hero', { level: 2 })).version, 2);
  assert.deepEqual(saves.peek('hero'), { level: 2 });
  assert.equal((await saves.set('bad key', 1)).error, 'key');
  await saves.stats.add({ kills: 2 }); await saves.stats.add({ kills: 3 }); await saves.stats.max({ level: 4 }); await saves.stats.max({ level: 2 });
  assert.deepEqual(await saves.stats.get(), { kills: 5, level: 4 });
  const f = await saves.fall({ character: 'Gil', summary: { level: 2 }, wipe: true });
  assert.equal(f.memorial.character, 'Gil');
  assert.equal(await saves.get('hero'), null);
  assert.equal((await saves.fallen())[0].character, 'Gil');
  assert.deepEqual(await saves.stats.get(), { kills: 5, level: 4 }, 'stats survive the death');
  const again = createSaves({ game: 'ember', local: true, storage });
  await again.ready;
  assert.equal((await again.fallen()).length, 1, 'kept across page loads');
});

test('the game SDK in a studio shell: every call is a message to the shell, answered by number; events reach the game', async () => {
  const listeners = [];
  const prev = globalThis.addEventListener;
  globalThis.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  const sent = [];
  const shell = { postMessage: (m) => {
    sent.push(m);
    const answer = (body) => queueMicrotask(() => listeners.forEach((fn) => fn({ data: { t: 'homie-save', q: m.q, ...body }, source: shell })));
    if (m.op === 'hello') answer({ ok: true, player: { id: 'pl_aaaaaaaaaaaaaaaaaaaaaa', name: 'Hal', guest: false }, cache: { hero: { level: 5 } }, status: { mode: 'cloud', online: true, pending: 0, lastSyncAt: 1, lastError: null } });
    if (m.op === 'set') answer({ ok: true, synced: true, version: 6 });
    if (m.op === 'resolve') sent.resolved = m;
  } };
  try {
    const saves = createSaves({ game: 'ember', local: false, target: shell, onConflict: (c) => ({ ...c.theirs, merged: true }) });
    const p = await saves.ready;
    assert.equal(p.name, 'Hal');
    assert.equal(p.signedIn, true);
    assert.deepEqual(saves.peek('hero'), { level: 5 }, 'the shell\'s copy arrives with hello');
    const r = await saves.set('hero', { level: 6 });
    assert.deepEqual(r, { ok: true, synced: true, version: 6 });
    assert.equal(sent.find((m) => m.op === 'set').value.level, 6);
    assert.ok(sent.every((m) => m.t === 'homie-save' && !('game' in m)), 'the game never names a game: the shell knows which one it is');
    let who = null;
    saves.on('player', (x) => { who = x; });
    listeners.forEach((fn) => fn({ data: { t: 'homie-save', ev: 'player', player: { id: 'pl_bbbbbbbbbbbbbbbbbbbbbb', name: 'Ivy', guest: false }, cache: {} }, source: shell }));
    assert.equal(who.name, 'Ivy');
    assert.equal(saves.peek('hero'), null);
    listeners.forEach((fn) => fn({ data: { t: 'homie-save', ev: 'conflict', key: 'hero', mine: { level: 1 }, theirs: { level: 9 }, theirsVersion: 9, ask: 3 }, source: shell }));
    await new Promise((r2) => setTimeout(r2, 5));
    assert.deepEqual(sent.resolved, { t: 'homie-save', op: 'resolve', ask: 3, keep: 'value', value: { level: 9, merged: true } });
    listeners.forEach((fn) => fn({ data: { t: 'homie-save', q: 999, ok: true }, source: { other: true } }));
  } finally { globalThis.addEventListener = prev; }
});
