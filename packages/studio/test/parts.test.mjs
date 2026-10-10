import { declareRoom } from './browser-rules-game.mjs';
/**
 * Game parts (parts/PARTS.md): games build on each other by sharing pieces of a game.
 *
 * The loop this file proves end to end, with no network and no registry: studio A lifts a piece out of one of its
 * games (the game still builds and plays the same) and shares it; A's site lists and serves it, and a private part
 * is never reachable; studio B adds it from A's site through a fixture fetch, one exact version with its integrity
 * checked; B's game imports it in one line, builds, and credits A. Around that: the format's plain-words checker,
 * rights per file, npm doing the packages (a stub runner), a newer version that keeps tuning and never overwrites an
 * edit unasked, licences that cannot be combined, the catalogue search that says when the hub is unreachable, and
 * the four chat tools.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from '../lib/build.mjs';
import { PART_KINDS, checkPart, previewAspect, fileRights, hashDir, licenceIssues, licenseOfPart, newPart, packPart, parseRef, readOrigins, readPart, requiredParts, shareProblems, sharedPartsOf, verifyFiles, writeHashes, writePart } from '../lib/parts.mjs';
import { addPart, checkParts, ensurePackages, findParts, sharePart } from '../lib/parts-store.mjs';
import { partsPlanLines, partsPublishReport } from '../lib/parts-build.mjs';
import { PARTS_ADD_USAGE, partsCommand, partsLines } from '../lib/parts-cli.mjs';
import { partsForListing, publish } from '../lib/directory.mjs';
import { PARTS_FIRST } from '../lib/parts-tools.mjs';
import { INSTRUCTIONS } from '../lib/mcp.mjs';
import { StudioContext, toolDefs } from '../lib/mcp-tools.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const REPO_NM = join(PKG, '..', '..', 'node_modules');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-parts-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
const quiet = { log() {} };

function studio(folder, name) {
  const dir = join(scratch, folder);
  const r = run(['new', dir, '--name', name, '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}
/** A small bundled game: main.ts puts what it computed on globalThis, so a built bundle can be run and read here. */
function game(dir, id, main, extra = {}, files = {}) {
  write(dir, `games/${id}/game.json`, `${JSON.stringify({ id, name: id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), blurb: `${id}.`, players: { min: 1, max: 4 }, entry: 'src/main.ts', room: { host: 'browser' }, ...extra }, null, 2)}\n`);
  write(dir, `games/${id}/index.html`, '<!doctype html><html><head></head><body><script type="module" src="./assets/main.js"></script></body></html>');
  write(dir, `games/${id}/src/main.ts`, main);
  declareRoom(join(dir, 'games', id));
  for (const [rel, text] of Object.entries(files)) write(dir, `games/${id}/${rel}`, text);
}
let runs = 0;
async function runBundle(dir, id) {
  delete globalThis.__out;
  await import(`${pathToFileURL(join(dir, 'site', 'dist', 'games', id, 'assets', 'main.js')).href}?r=${++runs}`);
  return globalThis.__out;
}
/** The studio Worker over a built site, at a host: what another studio's `parts add` and a browser both reach. */
async function siteOf(dir, host, name) {
  const { default: worker } = await import('../worker/index.mjs');
  const dist = join(dir, 'site', 'dist');
  const ASSETS = { async fetch(req) { const p = decodeURIComponent(new URL(req.url).pathname); const f = join(dist, p); return f.startsWith(dist) && existsSync(f) && statSync(f).isFile() ? new Response(readFileSync(f)) : new Response('not found', { status: 404 }); } };
  const LOBBY = { idFromName: (n) => n, get: () => ({ fetch: async (u) => new Response(JSON.stringify(new URL(u).pathname === '/rooms' ? { rooms: [] } : { players: 0, rooms: 0, peak: { players: 0, room: 0 } })) }) };
  const env = { ASSETS, LOBBY, STUDIO_NAME: name };
  return (path, init = {}) => worker.fetch(new Request(`https://${host}${path}`, { ...init, headers: { 'user-agent': 'homie-house-qa test', ...(init.headers ?? {}) } }), env, { waitUntil() {} });
}
/** The one fetch `parts add` uses, pointed at fixture sites by host; every address asked for is kept. */
function fetchOf(sites, seen = []) {
  return async (url) => {
    const u = new URL(String(url));
    seen.push(u.href);
    const site = sites[u.host];
    if (!site) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    return site(`${u.pathname}${u.search}`);
  };
}
/** npm, stubbed: `have` is what `npm ls` finds; every call is kept; an install succeeds unless `fail`. */
function npmOf(have = {}, { fail = null } = {}) {
  const calls = [];
  const npm = (args) => {
    calls.push(args);
    if (args[0] === 'ls') return { status: have[args[1]] ? 0 : 1, stdout: have[args[1]] ? `└── ${args[1]}\n` : '└── (empty)\n', stderr: '' };
    if (args[0] === 'install') return fail ? { status: 1, stdout: '', stderr: fail } : { status: 0, stdout: 'added 1 package', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { npm, calls, installs: () => calls.filter((c) => c[0] === 'install') };
}

/* ------------------------------------------------------------------ the format */

const GOOD = { id: 'chase-camera', name: 'Chase camera', kind: 'mechanic', version: '1.0.0', summary: 'Follows a target.', contract: { inputs: {}, state: {}, netplay: 'local' } };

test('part.json is checked in plain words: each problem names its field and says what to write instead', () => {
  assert.deepEqual(checkPart(GOOD), { ok: true, problems: [] });
  assert.equal(checkPart(GOOD).ok && GOOD.share, undefined, 'share is absent, which is private');
  const bad = checkPart({ id: 'Chase Camera', name: '', kind: 'Invalid Kind', version: '1.0', summary: 'x', license: 'cc0', share: 'yes', tags: ['Bad Tag'], requires: { packages: { '@homie-rocks/camera': ['^0.2.0'] }, parts: ['not a ref'] }, physical: { units: 'feet', pivot: 'head' }, contract: { netplay: 'p2p' } });
  assert.equal(bad.ok, false);
  const by = Object.fromEntries(bad.problems.map((p) => [p.field, p]));
  for (const field of ['id', 'name', 'kind', 'version', 'license', 'share', 'tags', 'requires.packages', 'requires.parts', 'physical.units', 'physical.pivot', 'contract.netplay']) assert.ok(by[field], `${field} is reported`);
  assert.match(by.license.fix, /write "CC0-1\.0"/, 'a near miss is corrected, not just refused');
  assert.match(by.kind.fix, /lowercase/, 'kind labels have a portable syntax');
  assert.match(by.share.fix, /false keeps the part private \(the default\)/);
  assert.match(by['physical.units'].problem, /metres/);
  assert.ok(bad.problems.every((p) => !/undefined|\[object/.test(`${p.problem}${p.fix}`)), 'no problem leaks a raw value');
  assert.match(checkPart({ ...GOOD, license: 'proprietary' }).problems[0].fix, /tells a stranger nothing they can rely on/);
  assert.match(checkPart({ ...GOOD, license: 'mit' }).problems[0].fix, /case-sensitive: write "MIT"/);
  // Unknown fields are kept and ignored, so a newer toolkit's part still reads.
  assert.equal(checkPart({ ...GOOD, somethingNew: { a: 1 } }).ok, true);
  // A part is a piece of a game, never the whole game: there is no kind for one. And form is not restricted.
  assert.ok(!PART_KINDS.includes('game'));
  assert.equal(checkPart({ ...GOOD, kind: 'app' }).ok, true);
  assert.equal(checkPart({ ...GOOD, kind: 'music' }).ok, true);
  assert.equal(checkPart({ ...GOOD, kind: 'video' }).ok, true);
  assert.equal(checkPart({ ...GOOD, kind: 'venue-loop' }).ok, true);
  assert.equal(checkPart({ ...GOOD, kind: 'level-generator', entry: undefined, files: [{ path: 'levels/one.json', sha256: 'a'.repeat(64), bytes: 10 }, { path: 'art/rock.glb', sha256: 'b'.repeat(64), bytes: 10 }, { path: 'notes.md', sha256: 'c'.repeat(64), bytes: 10 }] }).ok, true, 'data, assets and text with no code at all');
});

test('licences are SPDX identifiers; a reference names one exact version; other parts are named, never solved', () => {
  assert.deepEqual([licenseOfPart('CC0-1.0').credit, licenseOfPart('CC-BY-4.0').credit, licenseOfPart('GPL-3.0-only').class, licenseOfPart('CC-BY-NC-4.0').class], [false, true, 'share-alike', 'non-commercial']);
  assert.equal(licenseOfPart('LicenseRef-studio-terms').class, 'unrecognised', 'accepted, and never passed off as compatible');
  assert.equal(licenseOfPart('proprietary'), null);
  assert.deepEqual(parseRef('owls.example/pickup-field@1.2.0'), { host: 'owls.example', id: 'pickup-field', version: '1.2.0', ref: 'owls.example/pickup-field' });
  assert.equal(parseRef('https://owls.example/pickup-field').ref, 'owls.example/pickup-field');
  assert.equal(parseRef('owls.example/pickup-field@^1.0.0'), null, 'one exact version: there are no ranges');
  assert.equal(parseRef('pickup-field'), null);
  assert.deepEqual(requiredParts({ requires: { parts: ['owls.example/rig', 'owls.example/clips'] } }).parts.map((p) => p.ref), ['owls.example/rig', 'owls.example/clips']);
});

/* ------------------------------------------------------------------ one studio: hashes, rights, sharing */

test('hashes are written by the tool; a part is private by default and shared only with a licence and known rights', () => {
  const dir = studio('rights', 'Night Owls');
  const made = newPart(dir, 'glow-shader', { kind: 'shader', name: 'Glow shader' });
  assert.equal(made.ok, true, made.why);
  const pdir = join(dir, 'parts', 'glow-shader');
  let part = readPart(pdir);
  assert.equal(part.share, false, 'a new part is private');
  assert.ok(part.files.length >= 3 && part.files.every((f) => /^[a-f0-9]{64}$/.test(f.sha256) && Number.isInteger(f.bytes)), 'the tool wrote every hash');
  assert.ok(!part.files.some((f) => f.path === 'part.json'));
  assert.equal(part.cost.bytes, part.files.reduce((n, f) => n + f.bytes, 0));

  // A changed file is noticed; --write rewrites the list.
  write(pdir, 'src/index.ts', 'export const glow = 1;\n');
  assert.deepEqual(verifyFiles(pdir, readPart(pdir)).changed, ['src/index.ts']);
  assert.equal(checkParts(dir, 'glow-shader').ok, false);
  assert.match(partsLines(checkParts(dir, 'glow-shader')).join('\n'), /the files differ from the hashes \(src\/index\.ts changed\)/);
  assert.equal(checkParts(dir, 'glow-shader', { write: true }).ok, true);

  // No licence: refused, in words.
  part = readPart(pdir); part.summary = 'A glow.'; writePart(pdir, part);
  let r = sharePart(dir, 'glow-shader');
  assert.equal(r.ok, false);
  assert.match(r.why, /it has no licence: a stranger cannot tell what they may do with it/);
  assert.equal(readPart(pdir).share, false, 'a refused share leaves it private');
  // A licence that asks for credit, and nobody to credit.
  part = readPart(pdir); part.license = 'CC-BY-4.0'; writePart(pdir, part);
  assert.match(sharePart(dir, 'glow-shader').why, /CC-BY-4\.0 asks for credit, and the part names nobody to credit/);
  part = readPart(pdir); part.attribution = 'Night Owls'; writePart(pdir, part);

  // A file whose rights are unknown: marked so by hand…
  write(pdir, 'tex/noise.png', 'PNG-ish bytes');
  part = writeHashes(pdir);
  part.files.find((f) => f.path === 'tex/noise.png').rights = 'unknown';
  writePart(pdir, part);
  r = sharePart(dir, 'glow-shader');
  assert.equal(r.ok, false);
  assert.match(r.why, /tex\/noise\.png: its rights are marked unknown/);
  assert.equal(writeHashes(pdir).files.find((f) => f.path === 'tex/noise.png').rights, 'unknown', 'rewriting hashes keeps a file\'s rights record');
  // …or the same bytes as a game's asset under a licence that does not let the file be handed on (assets/manifest.json, what RIGHTS.md is written from).
  part = readPart(pdir); delete part.files.find((f) => f.path === 'tex/noise.png').rights; writePart(pdir, part);
  const sha = part.files.find((f) => f.path === 'tex/noise.png').sha256;
  write(dir, 'games/cave/assets/manifest.json', JSON.stringify({ v: 1, assets: [{ id: 'noise', kind: 'texture', route: 'premium', license: { kind: 'eula:some-store' }, files: [{ role: 'texture', path: 'public/noise.png', sha256: sha }] }] }));
  r = sharePart(dir, 'glow-shader');
  assert.match(r.why, /tex\/noise\.png: it is noise of games\/cave, recorded as "eula:some-store": that licence does not let the file be handed on/);
  // An asset record with no licence is unknown too; a CC0 one is known.
  assert.equal(fileRights(part, { path: 'x', sha256: 'a'.repeat(64) }, new Map([['a'.repeat(64), { game: 'g', asset: 'a', kind: null }]])).known, false);
  assert.equal(fileRights(part, { path: 'x', sha256: 'a'.repeat(64) }, new Map([['a'.repeat(64), { game: 'g', asset: 'a', kind: 'cc0' }]])).known, true);
  // No provenance at all is unknown; imported needs to say from where.
  assert.match(shareProblems({ ...part, provenance: undefined }).map((p) => p.problem).join(' | '), /does not say where it came from/);
  assert.equal(fileRights({ ...part, provenance: { source: 'imported' } }, { path: 'x', sha256: 'b'.repeat(64) }).known, false);
  assert.equal(fileRights({ ...part, provenance: { source: 'imported', origin: 'a public-domain archive' } }, { path: 'x', sha256: 'b'.repeat(64) }).known, true);

  // With the file's rights settled it is shared, packed, and says when that takes effect.
  rmSync(join(dir, 'games', 'cave'), { recursive: true });
  r = sharePart(dir, 'glow-shader');
  assert.equal(r.ok, true, r.why);
  assert.match(r.effect, /live after the studio's next deploy, not before: nothing was uploaded now/);
  assert.equal(readPart(pdir).share, true);
  assert.deepEqual(readdirSync(join(dir, 'parts', '_packed', 'glow-shader')), [readPart(pdir).version]);

  // A packed version never changes: an edit needs a new version.
  write(pdir, 'src/index.ts', 'export const glow = 2;\n');
  const again = packPart(dir, 'glow-shader');
  assert.equal(again.ok, false);
  assert.match(again.why, /already packed with different files, and a shared version never changes/);
  assert.equal(packPart(dir, 'glow-shader', { bump: 'minor' }).version, '0.2.0');

  // Unsharing says it too.
  const off = sharePart(dir, 'glow-shader', false);
  assert.match(off.effect, /stays public until the studio's next deploy/);
  assert.equal(readPart(pdir).share, false);
});

/* ------------------------------------------------------------------ lifting a part out of a game */

test('a part is lifted out of a game and the game builds and behaves the same', async () => {
  const dir = studio('lift', 'Night Owls');
  game(dir, 'cave-run', 'import { score, LABEL } from \'./scoring/score\';\nimport grow from \'./scoring/grow.ts\';\nimport { helper } from \'./util\';\n(globalThis as any).__out = [LABEL, score(3), grow(2), helper()].join(\'|\');\n', {}, {
    'src/scoring/score.ts': 'import { RATE } from \'./rate\';\nexport const LABEL = \'pts\';\nexport function score(n: number) { return n * RATE; }\n',
    'src/scoring/rate.ts': 'export const RATE = 7;\n',
    'src/scoring/grow.ts': 'import { RATE } from \'./rate\';\nexport default function grow(n: number) { return n + RATE; }\n',
    'src/util.ts': 'export const helper = () => \'u\';\n',
    'src/needy.ts': 'import { helper } from \'./util\';\nexport const needy = () => helper();\n',
  });
  await build(dir, quiet);
  const before = await runBundle(dir, 'cave-run');
  assert.equal(before, 'pts|21|9|u');

  // A file that still reaches into the rest of the game is refused by name, and nothing moves.
  const no = newPart(dir, 'needy', { from: 'cave-run', paths: ['src/needy.ts'] });
  assert.equal(no.ok, false);
  assert.match(no.why, /src\/needy\.ts imports \.\/util.*Nothing was moved/s);
  assert.ok(!existsSync(join(dir, 'parts', 'needy')));
  // The game's own entry is the game: a part is a piece of it, never the whole.
  assert.match(newPart(dir, 'everything', { from: 'cave-run', paths: ['src'] }).why, /src\/main\.ts is the game itself\. A part is a piece of a game, never the whole game/);
  assert.ok(!existsSync(join(dir, 'parts', 'everything')));
  assert.match(readFileSync(join(dir, 'games/cave-run/src/needy.ts'), 'utf8'), /helper\(\)/);

  const made = newPart(dir, 'scoring', { from: 'cave-run', paths: ['src/scoring'], name: 'Scoring' });
  assert.equal(made.ok, true, made.why);
  assert.deepEqual(made.lifted.moved.sort(), ['src/scoring/grow.ts', 'src/scoring/rate.ts', 'src/scoring/score.ts']);
  const part = readPart(join(dir, 'parts', 'scoring'));
  assert.deepEqual(part.from, { game: 'cave-run', studio: 'Night Owls' }, 'a part records the game it came from');
  assert.equal(part.share, false);
  assert.ok(existsSync(join(dir, 'parts/scoring/src/score.ts')));
  assert.match(readFileSync(join(dir, 'games/cave-run/src/scoring/score.ts'), 'utf8'), /^\/\/ This is now the "scoring" part.*\nexport \* from '.*parts\/scoring\/src\/score\.ts';\n$/s);
  assert.match(readFileSync(join(dir, 'games/cave-run/src/scoring/grow.ts'), 'utf8'), /export \{ default \} from/);
  await build(dir, quiet);
  assert.equal(await runBundle(dir, 'cave-run'), before, 'the game behaves the same with the part lifted out');

  // Another game of the studio imports the part by name.
  game(dir, 'second', 'import { score } from \'@parts/scoring/src/score.ts\';\n(globalThis as any).__out = score(2);\n');
  await build(dir, quiet);
  assert.equal(await runBundle(dir, 'second'), 14);
  // A part nobody has is said plainly by the build.
  game(dir, 'third', 'import { x } from \'@parts/owls.example/nothing\';\n(globalThis as any).__out = x;\n');
  await assert.rejects(build(dir, { ...quiet, only: 'third' }), /names a part this studio does not have/);
});

/* ------------------------------------------------------------------ studio A shares, studio B mashes it in */

const FIELD = `import tuning from '../tuning.json';
/** PICKUP-FIELD-MARK: the host decides who collected what; everyone else is shown the snapshot. */
export function createPickupField(spots: { x: number; z: number }[], options: Partial<typeof tuning> = {}) {
  const t = { ...tuning, ...options };
  const live = spots.map(() => true);
  return {
    tuning: t,
    collect(player: { x: number; z: number }) { let n = 0; spots.forEach((s, i) => { if (live[i] && Math.hypot(s.x - player.x, s.z - player.z) <= t.radius) { live[i] = false; n += t.value; } }); return n; },
    snapshot: () => live.map((v) => (v ? 1 : 0)),
    apply(snap: number[]) { snap.forEach((v, i) => { live[i] = v === 1; }); },
  };
}
`;

/** Studio A: a game with a pickup mechanic lifted out of it and shared, and a private part beside it. */
async function studioA(folder = 'owls', preview = {}) {
  const dir = studio(folder, 'Night Owls');
  game(dir, 'gem-cave', 'import { createPickupField } from \'./pickups/index\';\nconst f = createPickupField([{ x: 0, z: 0 }, { x: 9, z: 9 }]);\n(globalThis as any).__out = f.collect({ x: 0.5, z: 0 });\n', {}, {
    'src/pickups/index.ts': FIELD.replace('../tuning.json', './tuning.json'),
    'src/pickups/tuning.json': '{ "radius": 1, "value": 5 }\n',
  });
  game(dir, 'open-game', '(globalThis as any).__out = \'PRIVATE-GAME-CODE\';\n');
  const made = newPart(dir, 'pickup-field', { from: 'gem-cave', paths: ['src/pickups'], name: 'Pickup field' });
  assert.equal(made.ok, true, made.why);
  const pdir = join(dir, 'parts', 'pickup-field');
  // The part's own tuning.json is the one at its root (what an update never overwrites).
  writeFileSync(join(pdir, 'tuning.json'), '{ "radius": 1, "value": 5 }\n');
  rmSync(join(pdir, 'src', 'tuning.json'));
  writeFileSync(join(pdir, 'src', 'index.ts'), FIELD);
  write(pdir, 'preview/index.html', '<!doctype html><title>Pickup field</title><p>walk over the gems</p>');
  const part = readPart(pdir);
  Object.assign(part, { summary: 'Host-authoritative pickups on spawn spots.', license: 'CC-BY-4.0', attribution: 'Night Owls', tags: ['pickups', 'netplay'], version: '1.0.0', contract: { inputs: { player: 'a position in metres' }, state: { live: 'which spots still hold a pickup' }, netplay: 'host-authoritative' }, requires: { packages: { '@homie-rocks/studio': '>=0.1.0' } }, _note: 'INTERNAL-NOTE-MARK' });
  Object.assign(part.preview, preview);
  writePart(pdir, part);
  // The game keeps importing its own tuning for nothing now; its shim re-exports the part.
  rmSync(join(dir, 'games/gem-cave/src/pickups/tuning.json'));
  // A private part beside it: it must never be reachable.
  const priv = newPart(dir, 'secret-brain', { kind: 'bot-brain', name: 'Secret brain' });
  assert.equal(priv.ok, true);
  writeFileSync(join(dir, 'parts/secret-brain/src/index.ts'), 'export const brain = \'PRIVATE-PART-MARK\';\n');
  const sp = readPart(join(dir, 'parts/secret-brain')); Object.assign(sp, { summary: 'Ours.', license: 'MIT', attribution: 'Night Owls' }); writePart(join(dir, 'parts/secret-brain'), sp);
  writeHashes(join(dir, 'parts/secret-brain'));
  const shared = sharePart(dir, 'pickup-field');
  assert.equal(shared.ok, true, shared.why);
  const built = await build(dir, quiet);
  return { dir, built, site: await siteOf(dir, 'owls.example', 'Night Owls') };
}
const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])) : []);

test('the site lists and serves shared parts only: a private part is never reachable', async () => {
  const { dir, built, site } = await studioA();
  assert.deepEqual(built.parts, { shared: [{ id: 'pickup-field', versions: ['1.0.0'] }], kept: 1 });
  const dist = join(dir, 'site', 'dist');
  // What the studio shares has one answer, and the build wrote exactly that.
  assert.deepEqual(sharedPartsOf(dir).map((x) => [x.id, x.versions, x.part.share]), [['pickup-field', ['1.0.0'], true]]);
  assert.ok(existsSync(join(dist, 'parts', 'pickup-field', '1.0.0', 'src', 'index.ts')));
  assert.ok(!existsSync(join(dist, 'parts', 'secret-brain')));
  for (const f of walk(join(dist, 'parts'))) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!text.includes('PRIVATE-PART-MARK'), `${f} holds no private part`);
    assert.ok(!text.includes('INTERNAL-NOTE-MARK'), `${f} holds no private field`);
  }

  const idx = await site('/.well-known/homie-parts.json');
  assert.equal(idx.status, 200);
  assert.equal(idx.headers.get('access-control-allow-origin'), '*');
  const body = await idx.json();
  assert.equal(body.v, 1);
  assert.deepEqual(body.studio, { name: 'Night Owls', url: 'https://owls.example' });
  assert.deepEqual(body.parts.map((p) => p.id), ['pickup-field'], 'only the shared part is listed');
  const entry = body.parts[0];
  assert.equal(entry.url, '/parts/pickup-field/1.0.0/');
  assert.equal(entry.add, 'owls.example/pickup-field');
  assert.deepEqual(entry.versions, ['1.0.0']);
  assert.deepEqual(entry.from, { game: 'gem-cave', name: 'Gem cave', studio: 'Night Owls', page: 'https://owls.example/gem-cave/', play: 'https://owls.example/gem-cave/play' }, 'the hub can group parts by the game they came from');
  assert.equal(entry._note, undefined);
  assert.equal(entry.license, 'CC-BY-4.0');
  assert.equal(entry.contract.netplay, 'host-authoritative');

  // The files, exactly as hashed: immutable, CORS open, GET only.
  for (const f of entry.files) {
    const res = await site(`/parts/pickup-field/1.0.0/${f.path}`);
    assert.equal(res.status, 200, f.path);
    assert.match(res.headers.get('cache-control'), /public, max-age=31536000, immutable/);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.length, f.bytes);
    assert.equal(hashDir(join(dist, 'parts', 'pickup-field', '1.0.0')).find((h) => h.path === f.path).sha256, f.sha256);
  }
  assert.equal((await site('/parts/pickup-field/1.0.0/part.json')).status, 200);
  assert.equal((await site('/parts/pickup-field/1.0.0/src/index.ts', { method: 'POST' })).status, 405);
  // The preview page: sandboxed (no cookies or storage of the site's), and not refused a frame.
  const pv = await site('/parts/pickup-field/1.0.0/preview/index.html');
  assert.equal(pv.headers.get('content-security-policy'), 'sandbox allow-scripts allow-pointer-lock');
  assert.equal(pv.headers.get('x-frame-options'), null);

  // The private part: not in the index, no file, no page, at any address; and not even if its files reached the assets.
  for (const path of ['/parts/secret-brain/', '/parts/secret-brain/0.1.0/part.json', '/parts/secret-brain/0.1.0/src/index.ts', '/parts/pickup-field/9.9.9/src/index.ts', '/parts/pickup-field/1.0.0/../../secret-brain/part.json']) {
    const res = await site(path);
    assert.equal(res.status, 404, `${path} is not there`);
    assert.ok(!(await res.text()).includes('PRIVATE-PART-MARK'));
  }
  write(dist, 'parts/secret-brain/0.1.0/src/index.ts', 'export const brain = \'PRIVATE-PART-MARK\';\n');
  assert.equal((await site('/parts/secret-brain/0.1.0/src/index.ts')).status, 404, 'the Worker answers only what the built index names');
  rmSync(join(dist, 'parts', 'secret-brain'), { recursive: true });

  // The studio's own pages, in its own look, with what to SAY (never a command to type).
  const list = await site('/parts/');
  assert.equal(list.status, 200);
  const listHtml = await list.text();
  assert.match(listHtml, /Pickup field/);
  assert.match(listHtml, /From Gem cave/);
  assert.ok(!listHtml.includes('Secret brain'));
  const page = await site('/parts/pickup-field/');
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /<iframe class="pframe"[^>]+src="\/parts\/pickup-field\/1\.0\.0\/preview\/index\.html"[^>]+sandbox="allow-scripts allow-pointer-lock"/, 'the interactive preview');
  // Nothing declared: 16:9, a narrow frame never under 320 px (70% of a short screen), and a plain link out of the frame.
  assert.match(html, /<div class="pview" style="--pv:16\/9"><iframe class="pframe" title="Pickup field: try it"/, 'the default shape, and the frame keeps its title');
  assert.match(html, /@container \(max-width:599\.98px\)\{\.pview \.pframe\{min-height:min\(320px,70vh\);min-height:min\(320px,70svh\)\}/, 'the narrow-screen minimum');
  assert.match(html, /<a class="popen" href="\/parts\/pickup-field\/1\.0\.0\/preview\/index\.html" target="_blank" rel="noopener noreferrer">.*Open the preview/, 'a link, so no script and a keyboard reaches it');
  assert.match(html, /\.popen:focus-visible\{outline:/, 'with a focus state that shows');
  assert.equal(entry.preview.aspect, undefined, 'nothing is invented for a part that declared no shape');
  assert.match(html, /CC-BY-4\.0/);
  assert.match(html, /<dt>Credit<\/dt><dd>Night Owls<\/dd>/);
  assert.match(html, /@homie-rocks\/studio &gt;=0\.1\.0 \(a package, from npm\)/, 'requirements');
  assert.match(html, /KB to download/, 'costs');
  assert.match(html, /the host decides/);
  assert.match(html, /data-copy="Add the &quot;Pickup field&quot; part from owls\.example\/pickup-field to my studio"/);
  assert.ok(!/homie-studio parts|npx /.test(html), 'a page never tells a person to type a command');
  assert.equal((await site('/parts/pickup-field')).status, 301);

  // The game's landing: "Parts from this game"; a game with none has no band.
  const landing = await (await site('/gem-cave/')).text();
  assert.match(landing, /<h2 id="parts-title">Parts from this game<\/h2>/);
  assert.match(landing, /href="\/parts\/pickup-field\/"/);
  const bandHtml = landing.slice(landing.indexOf('data-parts-band'), landing.indexOf('</main>'));
  assert.ok(!/class="(make|say|band|band-in)\b/.test(bandHtml), 'the band stands on its own: none of another band\'s markup');
  assert.match(bandHtml, /data-copy="Add the &quot;Pickup field&quot; part from owls\.example\/pickup-field to my studio"/, 'what to ask for, with the part\'s name and reference');
  assert.ok(!(await (await site('/open-game/')).text()).includes('parts-title'));

  // Unshared, and the next build takes it down: the index is empty and the file is gone.
  sharePart(dir, 'pickup-field', false);
  await build(dir, quiet);
  assert.deepEqual((await (await site('/.well-known/homie-parts.json')).json()).parts, []);
  assert.equal((await site('/parts/pickup-field/1.0.0/src/index.ts')).status, 404);
  assert.equal((await site('/parts/')).status, 404);
});

test('a part declares the shape of its preview frame; nothing but two checked numbers ever reaches the page', async () => {
  const withShape = (preview) => checkPart({ ...GOOD, preview });
  // The bounds: whole numbers 1 to 32, no flatter than 3:1, no taller than 1:2.
  for (const ok of ['16:9', '4:3', '1:1', '3:4', '3:1', '1:2', '32:32', '32:11', '9:16']) {
    assert.equal(withShape({ aspect: ok, phoneAspect: ok }).ok, true, `${ok} is a shape`);
    const [w, h] = ok.split(':').map(Number);
    assert.deepEqual(previewAspect(ok), { w, h });
  }
  const HOSTILE = ['16:9;background:url(x)', '0:0', '999:1', '4:1', '1:3', '33:32', '16:0', '016:9', '16 : 9', '16/9', ' 4:3', '4:3\n', '4.5:3', '-4:3', '4:3"><script>', '', 169, null, ['4:3'], { w: 4, h: 3 }];
  const { aspectOf } = await import('../worker/parts.mjs');
  for (const bad of HOSTILE) {
    for (const k of ['aspect', 'phoneAspect']) {
      const r = withShape({ [k]: bad });
      assert.equal(r.ok, false, `${k} ${JSON.stringify(bad)} is refused`);
      assert.deepEqual(r.problems.map((p) => p.field), [`preview.${k}`]);
      assert.ok(!/undefined|\[object|url\(|script/.test(`${r.problems[0].problem}${r.problems[0].fix}`), 'said in plain words, without repeating the value');
    }
    assert.equal(previewAspect(bad), null);
  }
  assert.match(withShape({ aspect: '0:0' }).problems[0].problem, /two whole numbers from 1 to 32/);
  assert.match(withShape({ aspect: '4:1' }).problems[0].problem, /flatter than 3:1/);
  assert.match(withShape({ phoneAspect: '1:3' }).problems[0].problem, /taller than 1:2/);
  // The site's own reading of a shape is the checker's, value for value (a Worker cannot import the checker).
  for (const v of [...HOSTILE, '16:9', '4:3', '3:1', '1:2', '32:32', '32:10', '10:21', '3:4']) assert.deepEqual(aspectOf(v), previewAspect(v), JSON.stringify(v));

  // A part that declares both: a hand-set hostile shape cannot even be shared.
  const { dir, site } = await studioA('shapes', { aspect: '4:3', phoneAspect: '3:4' });
  const entry = (await (await site('/.well-known/homie-parts.json')).json()).parts[0];
  assert.deepEqual(entry.preview, { page: 'preview/index.html', aspect: '4:3', phoneAspect: '3:4' }, 'the well-known file carries both, unchanged');
  const indexFile = join(dir, 'site', 'dist', 'parts', 'index.json');
  assert.deepEqual(readJson(indexFile).parts[0].preview, { page: 'preview/index.html', aspect: '4:3', phoneAspect: '3:4' }, 'and so does the built index');
  const framesOf = (html) => [...html.matchAll(/<div class="(pview[^"]*)" style="([^"]*)">/g)].map((m) => [m[1], m[2]]);
  const html = await (await site('/parts/pickup-field/')).text();
  assert.deepEqual(framesOf(html), [['pview pview-own', '--pv:4/3;--pvn:3/4']], 'those numbers and only those');
  assert.match(html, /\.pview\.pview-own \.pframe\{aspect-ratio:var\(--pvn,var\(--pv,16\/9\)\);min-height:0\}/, 'a declared phone shape wins over the minimum');
  assert.match(html, /<iframe class="pframe" title="Pickup field: try it"[^>]+sandbox="allow-scripts allow-pointer-lock"/, 'the same sandbox as before');
  const pdir = join(dir, 'parts', 'pickup-field');
  writePart(pdir, { ...readPart(pdir), version: '1.0.1', preview: { page: 'preview/index.html', aspect: '16:9;background:url(x)' } });
  assert.equal(sharePart(dir, 'pickup-field').ok, false, 'the checker stands between a hostile shape and a shared part');

  // And if one reached the built index some other way, the page still writes only numbers: the default.
  const built = readJson(indexFile);
  for (const [aspect, phoneAspect] of [['16:9;background:url(x)', '3:4}body{display:none'], ['0:0', '999:1'], ['4:3"><script>alert(1)</script>', 7]]) {
    built.parts[0].preview = { page: 'preview/index.html', aspect, phoneAspect };
    writeFileSync(indexFile, JSON.stringify(built));
    const page = await (await site('/parts/pickup-field/')).text();
    assert.deepEqual(framesOf(page), [['pview', '--pv:16/9']], `${aspect} never reaches the page`);
    assert.ok(!/url\(x\)|\}body\{|alert\(1\)|999:1/.test(page));
  }
});

test('a part set shared by hand past the checks stops the build instead of publishing it', async () => {
  const dir = studio('byhand', 'Night Owls');
  newPart(dir, 'loose', { kind: 'effect' });
  const pdir = join(dir, 'parts', 'loose');
  const part = readPart(pdir); part.share = true; part.summary = 'x'; writePart(pdir, part);
  await assert.rejects(build(dir, quiet), /parts\/loose is marked shared but cannot be: license: it has no licence/);
});

test('studio B adds studio A\'s part: fetched, every hash checked, copied in, importable, credited, npm asked', async () => {
  const a = await studioA('owls2');
  const b = studio('foxes', 'Fox Works');
  game(b, 'fox-dash', 'import { createPickupField } from \'@parts/owls.example/pickup-field\';\nconst f = createPickupField([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 40, z: 0 }]);\n(globalThis as any).__out = [f.collect({ x: 0, z: 0 }), f.snapshot().join(\'\'), f.tuning.value].join(\'|\');\n');
  const seen = [];
  const fetch = fetchOf({ 'owls.example': a.site }, seen);

  // A private part is not there to add, and saying so names what is.
  const priv = await addPart(b, 'owls.example/secret-brain', { fetch, npm: npmOf().npm });
  assert.equal(priv.ok, false);
  assert.match(priv.why, /owls\.example does not share a part "secret-brain" \(it shares: pickup-field\)/);
  // A studio that cannot be reached is said plainly.
  assert.match((await addPart(b, 'nowhere.example/x', { fetch, npm: npmOf().npm })).why, /nowhere\.example shares no parts that can be read: nowhere\.example could not be reached/);

  // A tampered file: refused, and not one byte written.
  const tampered = async (url) => {
    const res = await fetch(url);
    return String(url).endsWith('/src/index.ts') ? new Response((await res.text()).replace('n += t.value', 'n += 999')) : res;
  };
  const bad = await addPart(b, 'owls.example/pickup-field', { fetch: tampered, npm: npmOf().npm, game: 'fox-dash' });
  assert.equal(bad.ok, false);
  assert.match(bad.why, /src\/index\.ts is not the file its part\.json describes.*Nothing was written/);
  assert.ok(!existsSync(join(b, 'parts', '_vendor')));
  assert.ok(!existsSync(join(b, 'parts', 'origins.json')));

  // The real thing. npm says the package it builds on is already there: nothing is installed.
  const have = npmOf({ '@homie-rocks/studio@>=0.1.0': true });
  const r = await addPart(b, 'owls.example/pickup-field', { fetch, npm: have.npm, game: 'fox-dash' });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.version, '1.0.0');
  assert.equal(r.verified, true);
  assert.equal(r.import, '@parts/owls.example/pickup-field');
  assert.deepEqual(r.from, { game: 'gem-cave', name: 'Gem cave', studio: 'Night Owls', page: 'https://owls.example/gem-cave/' });
  assert.deepEqual(have.installs(), [], 'a satisfied package causes no install');
  assert.deepEqual(r.packages.map((p) => p.state), ['ok']);
  assert.equal(r.ready, true);
  assert.ok(seen.includes('https://owls.example/parts/catalog.json') && seen.includes('https://owls.example/parts/pickup-field/1.0.0/part.json'));
  const vdir = join(b, 'parts', '_vendor', 'owls.example', 'pickup-field');
  const lock = readOrigins(b).parts['owls.example/pickup-field'];
  assert.equal(lock.version, '1.0.0');
  assert.equal(lock.url, 'https://owls.example/parts/pickup-field/1.0.0/');
  assert.equal(lock.license, 'CC-BY-4.0');
  assert.equal(lock.attribution, 'Night Owls');
  assert.deepEqual(lock.games, ['fox-dash']);
  assert.ok(!existsSync(join(b, 'parts', 'parts.lock.json')), 'where it came from is a record, not a lockfile');
  assert.deepEqual(lock.files, hashDir(vdir), 'every file on disk is the file A hashed');
  assert.deepEqual(lock.files, readPart(join(a.dir, 'parts/_packed/pickup-field/1.0.0')).files);
  // Credited through the game's existing credits file, with licence, attribution and the game it came from.
  const credit = readJson(join(b, 'games/fox-dash/credits.json')).parts.find((p) => p.part === 'owls.example/pickup-field');
  assert.deepEqual({ ...credit }, { what: 'Pickup field (mechanic)', author: 'Night Owls', url: 'https://owls.example/parts/pickup-field/', licence: 'CC-BY-4.0', licenceUrl: 'https://spdx.org/licenses/CC-BY-4.0.html', note: 'A part of Gem cave, from owls.example', part: 'owls.example/pickup-field' });
  assert.match(partsLines(r).join('\n'), /every one checked against its SHA-256[\s\S]*It came out of Gem cave by Night Owls[\s\S]*import … from '@parts\/owls\.example\/pickup-field'/);

  // One import line, and it runs: the build bundles the part into the game.
  await build(b, quiet);
  assert.equal(await runBundle(b, 'fox-dash'), '10|001|5');
  // The bundle is named by its content (bundle.json says which file); assets/main.js only imports it.
  assert.match(readFileSync(join(b, 'site/dist/games/fox-dash', readJson(join(b, 'site/dist/games/fox-dash/bundle.json')).bundle), 'utf8'), /live|Math\.hypot/);
  // The landing's credits page carries the line (the existing credits path).
  assert.match(JSON.stringify(readJson(join(b, 'site/dist/games.json')).games.find((g) => g.id === 'fox-dash').landing.credits), /Pickup field|"people"|true/);

  // Tuning is the studio's: change it and the game follows.
  writeFileSync(join(vdir, 'tuning.json'), '{ "radius": 50, "value": 2 }\n');
  await build(b, quiet);
  assert.equal(await runBundle(b, 'fox-dash'), '6|000|2');

  // A part added WITHOUT naming a game is credited by the build of the game that imports it.
  game(b, 'fox-two', 'import { createPickupField } from \'@parts/owls.example/pickup-field\';\n(globalThis as any).__out = createPickupField([]).tuning.radius;\n');
  await build(b, quiet);
  assert.deepEqual(readOrigins(b).parts['owls.example/pickup-field'].games, ['fox-dash', 'fox-two']);
  assert.ok(readJson(join(b, 'games/fox-two/credits.json')).parts.some((p) => p.part === 'owls.example/pickup-field'));

  // Before going online: each part's licence and attribution, and what does not fit.
  const report = partsPublishReport(b);
  assert.equal(report.ok, true);
  const lines = partsPlanLines(report).join('\n');
  assert.match(lines, /Parts in fox-dash from other studios/);
  assert.match(lines, /Pickup field 1\.0\.0 \(owls\.example\/pickup-field\), from Gem cave: CC-BY-4\.0; asks credit; credit: Night Owls/);
  const plan = JSON.parse(run(['deploy', '--plan'], b).stdout);
  assert.equal(plan.parts.games.length, 2, 'the deploy plan carries it');
  assert.match(spawnSync(process.execPath, [CLI, 'deploy', '--plan'], { cwd: b, encoding: 'utf8' }).stdout, /Parts in fox-dash from other studios/);

  // ACROSS THE SEAM: listing the studio says the same thing, before anything is sent. `publish` (lib/directory.mjs)
  // and the deploy plan read one report and print one set of lines.
  const order = [];
  const directoryStub = async (url, init = {}) => { order.push(`${init.method ?? 'GET'} ${url}`); return new Response(JSON.stringify({ ok: true, studioPage: 'https://homie.test/studios/fox-works', games: [], remaining: 4, limit: 5 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  const listed = await publish(b, { homie: 'https://homie.test', site: 'https://foxes.example', fetchFn: directoryStub, log: (l) => order.push(`say ${l}`) });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  const creditLine = lines.split('\n').find((l) => l.includes('Pickup field 1.0.0'));
  assert.ok(order.includes(`say ${creditLine}`), 'the very line the deploy plan gave: the part, its game, its licence, what it asks, who to credit');
  assert.ok(order.findIndex((l) => l === `say ${creditLine}`) < order.findIndex((l) => l.startsWith('POST ')), 'said BEFORE the studio is listed');
  assert.deepEqual(listed.parts.games.map((g) => g.game), report.games.map((g) => g.game));
  assert.deepEqual(partsPlanLines(listed.parts).filter((l) => !l.startsWith('Parts this studio shares')), partsPlanLines(report).filter((l) => !l.startsWith('Parts this studio shares')));
  const shown = spawnSync(process.execPath, [CLI, 'publish', '--homie', 'http://127.0.0.1:9', '--site', 'https://foxes.example'], { cwd: b, encoding: 'utf8' });
  assert.ok(shown.stderr.includes(creditLine), 'and in the terminal, before the directory is asked (which here does not answer)');
  // A game that is not listed (private) is not this moment's question.
  const gj = join(b, 'games', 'fox-two', 'game.json');
  const was = readFileSync(gj, 'utf8');
  writeFileSync(gj, `${JSON.stringify({ ...JSON.parse(was), launch: 'private' }, null, 2)}\n`);
  assert.deepEqual(partsForListing(b).games.map((g) => g.game), ['fox-dash']);
  writeFileSync(gj, was);

  // ---- a newer version: the same ask again -------------------------------------------------------------------------------------------
  const apart = join(a.dir, 'parts', 'pickup-field');
  writeFileSync(join(apart, 'src', 'index.ts'), FIELD.replace('n += t.value', 'n += t.value * t.bonus'));
  writeFileSync(join(apart, 'tuning.json'), '{ "radius": 1, "value": 5, "bonus": 2 }\n');
  write(apart, 'src/extra.ts', 'export const extra = 1;\n');
  assert.equal(packPart(a.dir, 'pickup-field', { bump: 'minor' }).version, '1.1.0');
  await build(a.dir, quiet);
  assert.deepEqual((await (await a.site('/.well-known/homie-parts.json')).json()).parts[0].versions, ['1.0.0', '1.1.0'], 'the old version is still served');
  assert.equal((await a.site('/parts/pickup-field/1.0.0/src/index.ts')).status, 200);

  // B edited a source file: the update stops, names it, and changes nothing.
  writeFileSync(join(vdir, 'src', 'index.ts'), `${readFileSync(join(vdir, 'src', 'index.ts'), 'utf8')}// our tweak\n`);
  assert.deepEqual(checkParts(b).brought[0].edited, ['src/index.ts']);
  const stop = await addPart(b, 'owls.example/pickup-field', { fetch, npm: have.npm });
  assert.equal(stop.ok, false);
  assert.match(stop.why, /has files this studio edited: src\/index\.ts\. Version 1\.1\.0 would replace them, so nothing was changed/);
  assert.match(readFileSync(join(vdir, 'src', 'index.ts'), 'utf8'), /our tweak/);
  assert.equal(readOrigins(b).parts['owls.example/pickup-field'].version, '1.0.0');
  assert.ok(!existsSync(join(vdir, 'src', 'extra.ts')));

  // Told to replace it: what changed is shown, tuning.json is kept, the new defaults sit beside it.
  const up = await addPart(b, 'owls.example/pickup-field', { fetch, npm: have.npm, overwrite: true });
  assert.equal(up.ok, true, up.why);
  const u = up;
  assert.deepEqual([u.was, u.version, u.same], ['1.0.0', '1.1.0', false]);
  assert.deepEqual(u.changes, { added: ['src/extra.ts'], removed: [], changed: ['src/index.ts', 'tuning.json'] });
  assert.deepEqual(u.replaced, ['src/index.ts']);
  assert.equal(readFileSync(join(vdir, 'tuning.json'), 'utf8'), '{ "radius": 50, "value": 2 }\n', 'local tuning survives an update');
  assert.equal(readFileSync(join(vdir, 'tuning.upstream.json'), 'utf8'), '{ "radius": 1, "value": 5, "bonus": 2 }\n');
  assert.ok(!/our tweak/.test(readFileSync(join(vdir, 'src', 'index.ts'), 'utf8')));
  assert.deepEqual(readOrigins(b).parts['owls.example/pickup-field'].games, ['fox-dash', 'fox-two'], 'the games that use it are kept');
  assert.match(partsLines(up).join('\n'), /1\.0\.0 → 1\.1\.0\. changed: src\/index\.ts, tuning\.json; new: src\/extra\.ts\. Your tuning\.json was kept; REPLACED your edited src\/index\.ts as asked/);
  assert.equal(checkParts(b).ok, true);
  // One exact older version can be asked for by name.
  assert.equal((await addPart(b, 'owls.example/pickup-field@1.0.0', { fetch, npm: have.npm })).version, '1.0.0');
  assert.match((await addPart(b, 'owls.example/pickup-field@3.0.0', { fetch, npm: have.npm })).why, /has no version 3\.0\.0; it has 1\.0\.0, 1\.1\.0/);

  // ACROSS THE SEAM: `--no-install` does what its help says. The flag goes through the real command to the real
  // add, in a studio that lacks the package the part builds on.
  /** A studio whose package.json does not name the package the part builds on (a pin of its own is another case, above). */
  const lacking = (name, title) => {
    const dir = studio(name, title);
    const pj = readJson(join(dir, 'package.json'));
    for (const k of ['dependencies', 'devDependencies']) if (pj[k]) delete pj[k]['@homie-rocks/studio'];
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pj, null, 2)}\n`);
    return dir;
  };
  const c = lacking('foxes-dry', 'Fox Dry');
  const pkgBefore = readFileSync(join(c, 'package.json'), 'utf8');
  const lockBefore = existsSync(join(c, 'package-lock.json')) ? readFileSync(join(c, 'package-lock.json'), 'utf8') : null;
  const dry = npmOf();
  const kept = await partsCommand(c, 'add', ['parts', 'add', 'owls.example/pickup-field'], new Map([['no-install', true]]), { fetch, npm: dry.npm });
  assert.equal(kept.ok, true, JSON.stringify(kept.why));
  assert.ok(existsSync(join(c, 'parts/_vendor/owls.example/pickup-field/part.json')), 'the part is brought in');
  assert.deepEqual(dry.calls.map((x) => x[0]), ['ls'], 'npm is only asked what the studio has');
  assert.equal(readFileSync(join(c, 'package.json'), 'utf8'), pkgBefore, 'package.json is as it was');
  assert.equal(existsSync(join(c, 'package-lock.json')) ? readFileSync(join(c, 'package-lock.json'), 'utf8') : null, lockBefore);
  assert.deepEqual(kept.packages.map((x) => [x.name, x.state, x.command]), [['@homie-rocks/studio', 'missing', 'npm install --ignore-scripts --save-exact @homie-rocks/studio@>=0.1.0']]);
  assert.match(partsLines(kept).join('\n'), /NOT INSTALLED @homie-rocks\/studio@>=0\.1\.0: .* npm installs it with: npm install --ignore-scripts --save-exact @homie-rocks\/studio@>=0\.1\.0/);
  // And the help says exactly that, with the same words for the state.
  assert.match(PARTS_ADD_USAGE, /--no-install: install nothing and leave package\.json as it is; .* named NOT INSTALLED with the npm command that installs it/);
  assert.match((await partsCommand(c, 'add', ['parts', 'add'], new Map(), { fetch })).why, /--no-install: install nothing and leave package\.json as it is/);
  // Without the flag the same command lets npm install it (and npm, not Homie, writes package.json).
  const wet = npmOf();
  await partsCommand(lacking('foxes-wet', 'Fox Wet'), 'add', ['parts', 'add', 'owls.example/pickup-field'], new Map(), { fetch, npm: wet.npm });
  assert.deepEqual(wet.installs(), [['install', '--ignore-scripts', '--save-exact', '@homie-rocks/studio@>=0.1.0']]);

});

/* ------------------------------------------------------------------ packages are npm's */

test('packages: npm says what is there and npm installs what is missing; a studio\'s own pin is never moved', () => {
  const dir = studio('npm', 'Fox Works');
  const wants = [{ name: '@homie-rocks/camera', range: '^0.2.0', by: 'owls.example/chase-camera' }];
  // Missing: one plain line first, then npm installs it, pinned exactly.
  const said = [];
  const miss = npmOf();
  let rows = ensurePackages(dir, wants, { npm: miss.npm, install: true, say: (l) => said.push(l) });
  assert.deepEqual(said, ['Installing @homie-rocks/camera@^0.2.0 from npm: owls.example/chase-camera is built on it.']);
  assert.deepEqual(miss.calls, [['ls', '@homie-rocks/camera@^0.2.0', '--depth=0'], ['install', '--ignore-scripts', '--save-exact', '@homie-rocks/camera@^0.2.0']]);
  assert.equal(rows[0].state, 'installed');
  assert.equal(rows[0].said, 'added 1 package', 'npm\'s own words');
  // Satisfied: npm is asked, nothing is installed, nothing is said.
  const ok = npmOf({ '@homie-rocks/camera@^0.2.0': true });
  rows = ensurePackages(dir, wants, { npm: ok.npm, install: true, say: () => assert.fail('nothing to say') });
  assert.deepEqual([rows[0].state, ok.installs().length], ['ok', 0]);
  // --no-install: nothing runs but the question; the command is given.
  const dry = npmOf();
  rows = ensurePackages(dir, wants, { npm: dry.npm, install: false });
  assert.deepEqual([rows[0].state, rows[0].command, dry.installs().length], ['missing', 'npm install --ignore-scripts --save-exact @homie-rocks/camera@^0.2.0', 0]);
  // npm fails: its error, as it printed it.
  rows = ensurePackages(dir, wants, { npm: npmOf({}, { fail: 'npm error code E404\nnpm error 404 Not Found' }).npm, install: true });
  assert.equal(rows[0].state, 'failed');
  assert.match(rows[0].why, /npm said:\nnpm error code E404\nnpm error 404 Not Found/);
  // The studio already pins it at a version npm says does not fit: explained, and nothing changed.
  const pkg = readJson(join(dir, 'package.json'));
  pkg.dependencies = { ...pkg.dependencies, '@homie-rocks/camera': '0.1.0' };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  const before = readFileSync(join(dir, 'package.json'), 'utf8');
  const pin = npmOf();
  rows = ensurePackages(dir, wants, { npm: pin.npm, install: true, say: () => assert.fail('nothing is installed') });
  assert.equal(rows[0].state, 'pinned');
  assert.match(rows[0].why, /owls\.example\/chase-camera is built on @homie-rocks\/camera \^0\.2\.0; this studio's package\.json has @homie-rocks\/camera at 0\.1\.0, which npm says does not fit\. Nothing was changed/);
  assert.equal(pin.installs().length, 0);
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before);
});

/* ------------------------------------------------------------------ licences */

test('licences that cannot be combined are said plainly', () => {
  const p = (ref, part, extra = {}) => ({ ref, part: { id: ref.split('/').pop(), name: ref, version: '1.0.0', summary: 's', ...part }, vendored: true, ...extra });
  const sa = p('a.example/cave', { kind: 'level-generator', license: 'CC-BY-SA-4.0' });
  const gpl = p('b.example/brain', { kind: 'bot-brain', license: 'GPL-3.0-only' });
  const nc = p('c.example/songs', { kind: 'audio-pack', license: 'CC-BY-NC-4.0' });
  const nd = p('d.example/tree', { kind: 'set-piece', license: 'CC-BY-ND-4.0' }, { changed: ['src/tree.ts'] });
  const odd = p('e.example/odd', { kind: 'effect', license: 'LicenseRef-studio-terms' });
  const none = p('f.example/none', { kind: 'effect' });
  const all = [sa, gpl, nc, nd, odd, none];
  const game = { id: 'mash', sells: true, credits: all.map((x) => ({ part: x.ref })) };
  const text = licenceIssues(all, { game }).map((i) => `${i.level} ${i.parts.join('+')}: ${i.problem}`).join('\n');
  assert.match(text, /conflict a\.example\/cave\+b\.example\/brain: CC-BY-SA-4\.0 and GPL-3\.0-only each ask that the whole game be under their own terms; one game cannot be under both/);
  assert.match(text, /conflict c\.example\/songs: CC-BY-NC-4\.0 does not allow commercial use, and this studio has a shop/);
  assert.match(text, /conflict d\.example\/tree: CC-BY-ND-4\.0 asks that it be used unchanged, and src\/tree\.ts was changed here/);
  assert.match(text, /conflict f\.example\/none: it names no licence/);
  assert.match(text, /warn a\.example\/cave: CC-BY-SA-4\.0 asks that a game built with it be offered under the same terms/);
  assert.match(text, /warn e\.example\/odd: LicenseRef-studio-terms is not a licence the toolkit can reason about/);
  // Credit owed and not in the game's credits.
  const by = p('a.example/by', { kind: 'effect', license: 'CC-BY-4.0' });
  assert.match(licenceIssues([by], { game: { id: 'g', sells: false, credits: [] } })[0].problem, /asks for credit, and games\/g\/credits\.json has no line for it/);
  // Permissive and public-domain parts, credited: nothing to say.
  assert.deepEqual(licenceIssues([by, p('b.example/free', { kind: 'effect', license: 'CC0-1.0' }), p('c.example/mit', { kind: 'ui', license: 'MIT' })], { game: { id: 'g', sells: true, credits: [{ part: 'a.example/by' }, { part: 'c.example/mit' }] } }), []);
});

/* ------------------------------------------------------------------ find */

test('parts find searches the hub and this studio; an unreachable hub is said plainly, never an empty list', async () => {
  const dir = studio('find', 'Fox Works');
  newPart(dir, 'dash-trail', { kind: 'effect', name: 'Dash trail' });
  const hub = { v: 1, parts: [
    { id: 'chase-camera', name: 'Third-person chase camera', kind: 'mechanic', version: '1.2.0', summary: 'Follows a target and stays out of rock.', license: 'MIT', tags: ['camera', '3d'], host: 'owls.example', add: 'owls.example/chase-camera', studio: { name: 'Night Owls' }, page: 'https://owls.example/parts/chase-camera/', from: { game: 'cave-run', name: 'Cave Run', studio: 'Night Owls', play: 'https://owls.example/cave-run/play' }, cost: { bytes: 4096 }, requires: { packages: { '@homie-rocks/camera': '^0.2.0' } }, contract: { netplay: 'local' } },
    { id: 'wolf', name: 'Wolf', kind: 'character', version: '1.0.0', summary: 'A wolf.', license: 'CC0-1.0', tags: ['creature'], host: 'den.example', skeleton: { rig: 'quadruped-v1', clips: ['trot'] }, cost: { triangles: 1800, bytes: 90000 } },
    { name: 'no id: skipped' },
  ] };
  const asked = [];
  const fetch = async (url) => { asked.push(String(url)); return new Response(JSON.stringify(hub)); };
  let r = await findParts(dir, 'camera', { fetch });
  assert.deepEqual(asked, ['https://homie.test/parts/index.json'], 'the studio\'s own directory is the hub it asks');
  assert.equal(r.hub.ok, true);
  assert.deepEqual(r.results.map((p) => [p.where, p.add ?? p.id]), [['hub', 'owls.example/chase-camera']]);
  const c = r.results[0];
  assert.deepEqual([c.name, c.kind, c.license, c.cost.bytes, c.requires.packages['@homie-rocks/camera'], c.from.name], ['Third-person chase camera', 'mechanic', 'MIT', 4096, '^0.2.0', 'Cave Run']);
  assert.match(c.say, /part_add \{ "part": "owls\.example\/chase-camera" \}/);
  const lines = partsLines(r).join('\n');
  assert.match(lines, /Third-person chase camera \(mechanic\) 1\.2\.0 · MIT · Free · owls\.example\/chase-camera/);
  assert.match(lines, /from Cave Run by Night Owls/);
  assert.match(lines, /costs 4 KB · builds on @homie-rocks\/camera · in a room: local/);
  // Filters; and packages are never results.
  assert.deepEqual((await findParts(dir, '', { fetch, builds: 'quadruped-v1' })).results.map((p) => p.id), ['wolf']);
  assert.deepEqual((await findParts(dir, '', { fetch, builds: '@homie-rocks/camera' })).results.map((p) => p.id), ['chase-camera'], 'what a part builds on');
  assert.deepEqual((await findParts(dir, '', { fetch, kind: 'effect' })).results.map((p) => [p.where, p.id]), [['own', 'dash-trail']]);
  assert.deepEqual((await findParts(dir, '', { fetch, license: 'cc0-1.0' })).results.map((p) => p.id), ['wolf']);
  assert.deepEqual((await findParts(dir, 'homie-rocks camera package', { fetch })).results, [], 'a package is not a part');
  assert.equal((await findParts(dir, '', { fetch })).results.length, 3);
  // Nothing matches while the hub answered: that IS "nothing like it is shared".
  assert.match(partsLines(await findParts(dir, 'submarine', { fetch })).join('\n'), /No shared part matches "submarine" \(2 in the catalogue, 1 in this studio\)/);
  // The hub cannot be reached: said, and the studio's own parts still come back.
  r = await findParts(dir, 'trail', { fetch: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } });
  assert.equal(r.ok, true);
  assert.equal(r.hub.ok, false);
  assert.match(r.hub.why, /could not be read just now.*This is NOT "no parts exist": only this studio's own parts were searched/);
  assert.deepEqual(r.results.map((p) => p.id), ['dash-trail']);
  assert.match(partsLines(r)[0], /could not be read just now/);
  r = await findParts(dir, 'submarine', { fetch: async () => new Response('nope', { status: 502 }) });
  assert.equal(r.hub.ok, false);
  assert.match(partsLines(r).join('\n'), /NOT "no parts exist"[\s\S]*Nothing in this studio matches/);
});

/* ------------------------------------------------------------------ the chat tools */

test('the chat tools: parts_find, part_add, part_new and part_share, named like the asset tools and worded for chat', async () => {
  const a = await studioA('owls4');
  const b = studio('foxes4', 'Fox Works');
  game(b, 'fox-dash', 'import { helper } from \'./helper\';\n(globalThis as any).__out = helper();\n', {}, { 'src/helper.ts': 'export const helper = () => 4;\n' });
  const ctx = new StudioContext({ studiosDir: scratch, cwd: b, install: false, directory: 'https://hub.example' });
  const hub = { v: 1, parts: [{ ...(await (await a.site('/.well-known/homie-parts.json')).json()).parts[0], host: 'owls.example', studio: { name: 'Night Owls' }, page: 'https://owls.example/parts/pickup-field/' }] };
  const sites = fetchOf({ 'owls.example': a.site });
  const stub = npmOf({ '@homie-rocks/studio@>=0.1.0': true });
  ctx.partsNet = { fetch: async (url) => (String(url) === 'https://hub.example/parts/index.json' ? new Response(JSON.stringify(hub)) : sites(url)), npm: stub.npm };
  const tools = toolDefs(ctx);
  const names = tools.map((t) => t.name);
  for (const n of ['parts_find', 'part_add', 'part_new', 'part_share']) assert.ok(names.includes(n), `${n} is in the registry`);
  assert.ok(names.includes('assets_find') && names.includes('asset_add'), 'beside the asset tools they are named after');
  assert.deepEqual(names.filter((n) => /part|mash/.test(n)).sort(), ['part_add', 'part_new', 'part_share', 'parts_find'], 'four tools are the whole surface, and none of them is a mash-up tool');
  const tool = (n) => tools.find((t) => t.name === n);
  for (const n of ['parts_find', 'part_add', 'part_new', 'part_share']) {
    const t = tool(n);
    assert.ok(t.title && t.description.length > 80 && t.inputSchema.type === 'object' && t.annotations && typeof t.run === 'function', `${n} is shaped like the others`);
    assert.ok(!/homie-studio |npx |terminal/.test(t.description), `${n} tells nobody to type a command`);
  }
  assert.match(tool('part_share').description, /live after the studio's next deploy \(studio_deploy\), not before/);
  for (const t of tools.filter((x) => /^parts?_/.test(x.name))) assert.ok(!/remix/i.test(`${t.title} ${t.description} ${JSON.stringify(t.inputSchema)}`), `${t.name} is about parts and nothing else`);
  assert.equal(tool('parts_find').annotations.readOnlyHint, true);

  const text = (r) => r.content[0].text;
  let r = await tool('parts_find').run({ query: 'pickup', studio: 'foxes4' });
  assert.match(text(r), /Pickup field \(mechanic\) 1\.0\.0 · CC-BY-4\.0 · Free · owls\.example\/pickup-field/);
  assert.match(text(r), /from Gem cave by Night Owls/);
  assert.match(text(r), /part_add \{ "part": "owls\.example\/pickup-field" \}/);
  assert.equal(r.structuredContent.results[0].add, 'owls.example/pickup-field');
  r = await tool('part_add').run({ part: 'owls.example/pickup-field', game: 'fox-dash' });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /import … from '@parts\/owls\.example\/pickup-field', then build/);
  assert.match(text(r), /Write in the project notes or CODEX that it uses this part and which work and studio it came from/);
  assert.ok(existsSync(join(b, 'parts/_vendor/owls.example/pickup-field/src/index.ts')));
  r = await tool('part_add').run({ part: 'owls.example/secret-brain' });
  assert.equal(r.isError, true);
  // A part of our own, lifted out of the game; then checked, then shared with the licence the person picked.
  r = await tool('part_new').run({ id: 'helper', from: 'fox-dash', files: ['src/helper.ts'], kind: 'mechanic' });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /Lifted out of games\/fox-dash: 1 module\(s\) moved/);
  assert.match(text(r), /It stays private until the person asks to share it \(part_share\)/);
  r = await tool('part_share').run({ id: 'helper' });
  assert.match(text(r), /Before it can be shared:[\s\S]*license: it has no licence/);
  assert.equal(readPart(join(b, 'parts/helper')).share, false, 'checking shares nothing');
  r = await tool('part_share').run({ id: 'helper', share: true });
  assert.equal(r.isError, true);
  assert.ok(!/homie-studio /.test(text(r)), 'a refusal in chat names tools, not commands');
  const hp = readPart(join(b, 'parts/helper')); hp.summary = 'Returns four.'; writePart(join(b, 'parts/helper'), hp);
  r = await tool('part_share').run({ id: 'helper', share: true, license: 'CC-BY-4.0', attribution: 'Fox Works' });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /is shared under CC-BY-4\.0[\s\S]*live after the studio's next deploy/);
  assert.equal(readPart(join(b, 'parts/helper')).share, true);
  r = await tool('part_share').run({ id: 'helper', share: false });
  assert.match(text(r), /parts\/helper is private/);
});

test('looking for parts is the first move: the planning tool, the game tool and the server say `parts find`', async () => {
  assert.match(PARTS_FIRST, /`parts find`/);
  assert.match(PARTS_FIRST, /@homie-rocks\/\* packages on npm/, 'packages and parts are two different things');
  const dir = studio('plan', 'Fox Works');
  const ctx = new StudioContext({ studiosDir: scratch, cwd: dir, install: false });
  const tools = toolDefs(ctx);
  const plan = tools.find((t) => t.name === 'game_plan');
  assert.match(plan.description, /`parts find`/, 'the planning tool\'s description names parts find');
  const r = await plan.run({ id: 'new-game', name: 'New Game' });
  assert.match(r.content[0].text, /`parts find`/, 'and so does what it tells the agent to do next');
  assert.match(r.content[0].text, /which parts and the work and studio each came from/);
  assert.match(tools.find((t) => t.name === 'game_make').description, /parts_find/);
  assert.match(INSTRUCTIONS, /parts_find/);
  assert.match(readFileSync(join(dir, 'games/new-game/CODEX.md'), 'utf8'), /parts find/i, 'the codex template has a place for it');
});

test('the plumbing behind the tools prints plain lines: find, new, add, share, unshare, check', () => {
  const dir = studio('cli', 'Fox Works');
  const plain = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  assert.match(plain(['parts', 'new', 'dash-trail', '--kind', 'effect']).stdout, /parts\/dash-trail is a new effect part \(private\)/);
  const check = plain(['parts', 'check']);
  assert.match(check.stdout, /dash-trail 0\.1\.0: reads fine, private[\s\S]*look summary: it has no summary[\s\S]*Before it can be shared:[\s\S]*license: it has no licence/);
  assert.equal(check.status, 0, 'a private part that reads is not a failure');
  const share = plain(['parts', 'share', 'dash-trail']);
  assert.equal(share.status, 1);
  assert.match(share.stdout, /cannot be shared yet:[\s\S]*license: it has no licence/);
  assert.match(plain(['parts', 'unshare', 'dash-trail']).stdout, /parts\/dash-trail is private/);
  assert.match(plain(['parts', 'bogus']).stdout, /"bogus" is not a parts command: find, new, add, share, unshare, check/);
  for (const gone of ['mash', 'compat', 'remove', 'update', 'pack', 'list']) assert.match(plain(['parts', gone]).stdout, /is not a parts command/, `${gone} is not a command`);
  assert.match(plain(['parts', 'add', 'nope']).stdout, /does not name a part: "<studio site>\/<part id>"/);
  assert.equal(plain(['mash', 'x']).status, 1, 'there is no mash command');

});
