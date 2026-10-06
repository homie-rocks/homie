/**
 * The models skill's script against a stand-in fal (fixtures/fake-fal.mjs): a generated prop is priced live (a
 * credit-billed endpoint through the registry's credit table), refused with no budget and past the cap, asked for
 * without --yes; the concept first (from the game's derived style prompt), then the mesh, each receipted the moment
 * it is accepted; then made phone-sized and recorded with every step, receipt and licence; a rerun never pays twice;
 * the registry re-reads its prices for free. No account, no money.
 * Run: node --test plugins/homie/test/models.test.mjs
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startFakeFal } from './fixtures/fake-fal.mjs';
import { priceOf, unitsFor } from '../skills/video/scripts/lib/fal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '..', 'skills', 'models', 'scripts', 'models.mjs');
const STUDIO_PKG = join(HERE, '..', '..', '..', 'packages', 'studio');
const CLI = join(STUDIO_PKG, 'bin', 'homie-studio.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-models-test-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function studio(name) {
  const dir = join(scratch, name);
  assert.equal(spawnSync(process.execPath, [CLI, 'new', dir, '--name', 'Fox Den', '--homie', 'https://homie.test', '--no-install', '--json'], { encoding: 'utf8' }).status, 0);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(STUDIO_PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  const run = (...a) => spawnSync(process.execPath, [CLI, ...a, '--json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(run('game', 'new', 'grove', '--from', 'gem-rush', '--name', 'Grove').status, 0);
  assert.equal(run('style', 'init', 'grove', '--prompt', 'a cozy low-poly forest where foxes gather berries by lantern light').status, 0);
  return dir;
}

test('fal pricing: per generation, per credit with add-ons from the registry, and refusing what it cannot count', () => {
  assert.deepEqual(unitsFor('x', {}, 'generations'), { units: 1, basis: '1 generation' });
  const credits = { base: 40, texture: 10, defaults: { texture: true } };
  assert.equal(unitsFor('tripo3d/p1/image-to-3d', { texture: true }, 'credits', { credits }).units, 50);
  assert.equal(unitsFor('tripo3d/p1/image-to-3d', { texture: false }, 'credits', { credits }).units, 40);
  assert.equal(unitsFor('tripo3d/p1/image-to-3d', {}, 'credits', { credits }).units, 50, 'texture is on by default');
  assert.throws(() => unitsFor('tripo3d/p1/image-to-3d', {}, 'credits'), /credit table/);
});

test('models: a prop priced, capped, the concept first, then the mesh; receipts; recorded with its licence; never paid twice', async () => {
  const fal = await startFakeFal();
  const env = { ...process.env, FAL_KEY: 'test-key', FAL_QUEUE_URL: fal.base, FAL_API_URL: fal.base, FAL_STORAGE_URL: fal.base, HOMIE_STUDIO_CLI: CLI };
  delete env.HOMIE_SPEND_LEDGER;
  const models = (args, cwd) => new Promise((ok) => {
    const p = spawn(process.execPath, [MODELS, ...args, '--json'], { cwd, env });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ ok: false, why: `no JSON: ${out} ${err}` }); } });
  });
  try {
    const dir = studio('prop');
    assert.match((await models(['check'], dir)).fal, /works/);
    const reg = await models(['registry'], dir);
    assert.equal(reg.ok, false, 'the fake fal does not know the fallbacks: flagged, not hidden');
    assert.equal(reg.rows.find((r) => r.at === 'mesh.prop').usd, 0.5);
    const q = await models(['quote', 'grove', '--count', '3'], dir);
    assert.equal(q.perProp, 0.535);
    assert.equal(q.total, 1.605);
    const what = ['--card', 'Items/Ember Lantern', '--what', 'an iron lantern with a warm ember inside', '--height', '0.6'];
    const dry = await models(['prop', 'grove', 'lantern', ...what, '--dry-run'], dir);
    assert.equal(dry.price.usd, 0.035);
    assert.equal(dry.total, 0.535);
    assert.match((await models(['prop', 'grove', 'lantern', ...what, '--yes'], dir)).why, /no budget/);
    assert.equal((await models(['budget', 'grove', '--cap', '0.5'], dir)).cap, 0.5);
    const ask = await models(['prop', 'grove', 'lantern', ...what], dir);
    assert.equal(ask.needs, 'approval');
    assert.equal(fal.stats.submits, 0, 'nothing is sent before the go-ahead');
    const concept = await models(['prop', 'grove', 'lantern', ...what, '--yes'], dir);
    assert.equal(concept.ok, true, JSON.stringify(concept));
    assert.equal(concept.step, 'concept');
    assert.match(fal.stats.lastInput.prompt, /^an iron lantern with a warm ember inside\. A single game prop.*Flat low-poly 3D game asset/s, 'the concept starts from the derived style prompt');
    const look = await models(['prop', 'grove', 'lantern'], dir);
    assert.equal(look.step, 'look', 'a concept is looked at before the mesh: no mesh without --mesh');
    const over = await models(['prop', 'grove', 'lantern', '--mesh', '--yes'], dir);
    assert.match(over.why, /REFUSED.*cap/, 'US$0.035 + US$0.50 passes a US$0.50 cap');
    await models(['budget', 'grove', '--cap', '3'], dir);
    const mesh = await models(['prop', 'grove', 'lantern', '--mesh', '--yes'], dir);
    assert.equal(mesh.ok, true, JSON.stringify(mesh));
    assert.equal(fal.stats.lastInput.face_limit, 1500);
    assert.equal(fal.stats.lastInput.texture, true);
    assert.equal(mesh.after.heightM, 0.6);
    assert.equal(fal.stats.submits, 2);
    const manifest = JSON.parse(readFileSync(join(dir, 'games', 'grove', 'assets', 'manifest.json'), 'utf8'));
    const a = manifest.assets.find((x) => x.id === 'lantern');
    assert.equal(a.route, 'generated');
    assert.equal(a.license.kind, 'generated');
    assert.deepEqual(a.made.steps.map((s) => s.what), ['concept', 'mesh', 'optimise']);
    assert.equal(a.made.steps[1].endpoint, 'tripo3d/p1/image-to-3d');
    assert.equal(a.made.steps[0].usd + a.made.steps[1].usd, 0.535);
    assert.ok(a.made.under['derived.prompt'] >= 1, 'made under the derived prompt\'s revision');
    assert.ok(existsSync(join(dir, 'games', 'grove', 'public', 'models', 'lantern.glb')));
    assert.ok(existsSync(join(dir, 'art', 'lantern', 'raw', 'mesh.glb')), 'the raw output stays beside its job');
    const receipts = readFileSync(join(dir, 'art', 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(receipts.map((r) => r.model), ['fal-ai/bytedance/seedream/v5/lite/text-to-image', 'tripo3d/p1/image-to-3d']);
    assert.ok(receipts.every((r) => r.game === 'grove'));
    assert.equal(JSON.parse(readFileSync(join(dir, 'art', 'grove-models', 'budget.json'), 'utf8')).spent, 0.535);
    const again = await models(['prop', 'grove', 'lantern', '--mesh', '--yes'], dir);
    assert.equal(again.ok, true);
    assert.equal(fal.stats.submits, 2, 'a rerun never pays twice');
    assert.match(readFileSync(join(dir, 'games', 'grove', 'assets', 'RIGHTS.md'), 'utf8'), /### lantern[\s\S]*tripo3d\/p1\/image-to-3d[\s\S]*Generated on the studio's own account/);
    assert.equal((await models(['receipts', 'grove'], dir)).usd, 0.535);
  } finally { await fal.close(); }
});

test('models: a generated character: the A-pose concept, then Meshy with its auto-rig priced with its add-ons, then the library\'s clips retargeted onto it', async () => {
  const fal = await startFakeFal();
  const { humanoidGlb, writeLibrary } = await import('../../../packages/studio/test/rig-fixtures.mjs');
  const lib = writeLibrary(join(scratch, 'library'), [{ id: 'kaykit-adventurers/knight', kind: 'character', bytes: Buffer.from(await humanoidGlb({ scheme: 'kaykit' })), rigged: true, clips: ['Idle', 'Running_A', 'Jump_Start', '1H_Melee_Attack_Chop'] }]);
  const env = { ...process.env, FAL_KEY: 'test-key', FAL_QUEUE_URL: fal.base, FAL_API_URL: fal.base, FAL_STORAGE_URL: fal.base, HOMIE_STUDIO_CLI: CLI, HOMIE_LIBRARY: lib };
  delete env.HOMIE_SPEND_LEDGER;
  const models = (args, cwd) => new Promise((ok) => {
    const p = spawn(process.execPath, [MODELS, ...args, '--json'], { cwd, env });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ ok: false, why: `no JSON: ${out} ${err}` }); } });
  });
  try {
    process.env.FAL_KEY = 'test-key'; process.env.FAL_API_URL = fal.base;
    const p = await priceOf('meshy/v7.1/image-to-3d', { should_texture: true, enable_rigging: true }, { addons: { base: 0.8, should_texture: 0.4, enable_rigging: 0.2, enable_animation: 0.12 } });
    assert.equal(p.usd, 1.4, 'the base and the add-ons that are on');
    assert.match(p.basis, /enable_rigging \+US\$0\.20/);
    delete process.env.FAL_KEY; delete process.env.FAL_API_URL;
    const dir = studio('character');
    const what = ['--card', 'Players/Ranger', '--what', 'a forest ranger in a green hooded cloak', '--height', '1.45'];
    const dry = await models(['character', 'grove', 'ranger', ...what, '--dry-run'], dir);
    assert.equal(dry.price.usd, 0.035);
    assert.equal(dry.then.usd, 1.4);
    assert.equal(dry.total, 1.435);
    await models(['budget', 'grove', '--cap', '2'], dir);
    const concept = await models(['character', 'grove', 'ranger', ...what, '--yes'], dir);
    assert.equal(concept.ok, true, JSON.stringify(concept));
    assert.match(fal.stats.lastInput.prompt, /A-pose/);
    assert.match(fal.stats.lastInput.prompt, /full body/);
    assert.doesNotMatch(fal.stats.lastInput.prompt, /3\/4 view, centred, whole object/, 'a character concept, not a prop\'s framing');
    const mesh = await models(['character', 'grove', 'ranger', '--mesh', '--yes'], dir);
    assert.equal(mesh.ok, true, JSON.stringify(mesh));
    assert.equal(fal.stats.lastInput.enable_rigging, true);
    assert.equal(fal.stats.lastInput.pose_mode, 'a-pose');
    assert.equal(fal.stats.lastInput.rigging_height_meters, 1.45);
    assert.match(mesh.skeleton, /^humanoid-/);
    assert.ok(mesh.verbs.includes('idle'), 'clips from the library, retargeted onto it');
    assert.ok(Math.abs(mesh.after.heightM - 1.45) < 0.03, `a centimetre rig measured true: ${mesh.after.heightM}`);
    const manifest = JSON.parse(readFileSync(join(dir, 'games', 'grove', 'assets', 'manifest.json'), 'utf8'));
    const a = manifest.assets.find((x) => x.id === 'ranger');
    assert.equal(a.kind, 'character');
    assert.equal(a.route, 'generated');
    assert.equal(a.license.kind, 'generated');
    assert.deepEqual(a.made.steps.map((s) => s.what), ['concept', 'mesh and rig', 'rig', 'clips', 'optimise']);
    assert.equal(a.made.steps[1].endpoint, 'meshy/v7.1/image-to-3d');
    assert.equal(+(a.made.steps[0].usd + a.made.steps[1].usd).toFixed(3), 1.435);
    const receipts = readFileSync(join(dir, 'art', 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(receipts.at(-1).model, 'meshy/v7.1/image-to-3d');
    assert.equal(receipts.at(-1).cost, 1.4);
    assert.ok(existsSync(join(dir, 'art', 'ranger', 'raw', 'rigged.glb')), 'the raw rigged file stays beside its job');
    const again = await models(['character', 'grove', 'ranger', '--mesh', '--yes'], dir);
    assert.equal(again.ok, true);
    assert.equal(fal.stats.submits, 2, 'a rerun never pays twice');
  } finally { await fal.close(); }
});

test('models: no local key is said apart from a connector\'s sign-in, and a connector job is imported under the same budget, receipts and provenance', async () => {
  // No key and no network: every address a call could reach is a closed port, so a request would fail the test.
  const env = { ...process.env, FAL_QUEUE_URL: 'http://127.0.0.1:9', FAL_API_URL: 'http://127.0.0.1:9', FAL_STORAGE_URL: 'http://127.0.0.1:9', HOMIE_STUDIO_CLI: CLI };
  delete env.FAL_KEY; delete env.HOMIE_SPEND_LEDGER;
  const models = (args, cwd) => new Promise((ok) => {
    const p = spawn(process.execPath, [MODELS, ...args, '--json'], { cwd, env });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ ok: false, why: `no JSON: ${out} ${err}` }); } });
  });
  const dir = studio('connector');
  const check = await models(['check'], dir);
  assert.match(check.fal, /no local FAL_KEY/);
  assert.match(check.fal, /says nothing about a fal connector/, 'a missing local key is not reported as fal being signed out');
  assert.match(check.fal, /models\.mjs import/, 'and the way on is named');
  assert.equal(check.auth.localKey, 'not set');
  assert.match(check.auth.connector, /not checked here/);

  // What a connector leaves behind: the finished file and a receipt saved when the job was accepted.
  const { placeholderGlb } = await import('../../../packages/studio/lib/optimise.mjs');
  const job = join(scratch, 'connector-job');
  mkdirSync(job, { recursive: true });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(job, 'beacon.glb'), Buffer.from(await placeholderGlb([1, 2, 1])));
  writeFileSync(join(job, 'mesh-job.json'), JSON.stringify({ request_id: 'req-mesh-0001', endpoint: 'tripo3d/p1/image-to-3d', status: 'COMPLETED', estimate: { usd: 0.5 }, at: '2026-10-05T10:00:00.000Z' }));
  writeFileSync(join(job, 'concept.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(join(job, 'concept-job.json'), JSON.stringify({ requestId: 'req-concept-0001', model: 'fal-ai/bytedance/seedream/v5/lite/text-to-image', cost: 0.035 }));
  writeFileSync(join(job, 'running.json'), JSON.stringify({ request_id: 'req-x', endpoint: 'tripo3d/p1/image-to-3d', status: 'IN_PROGRESS', cost: 0.5 }));
  writeFileSync(join(job, 'unpriced.json'), JSON.stringify({ request_id: 'req-y', endpoint: 'someone/unknown-model' }));
  const args = ['import', 'grove', 'beacon', '--file', join(job, 'beacon.glb'), '--receipt', join(job, 'mesh-job.json'), '--concept', join(job, 'concept.png'), '--concept-receipt', join(job, 'concept-job.json'), '--height', '1.2'];

  assert.match((await models(['import', 'grove', 'beacon', '--file', join(job, 'beacon.glb'), '--receipt', join(job, 'running.json')], dir)).why, /not finished/);
  assert.match((await models(['import', 'grove', 'beacon', '--file', join(job, 'beacon.glb'), '--receipt', join(job, 'unpriced.json')], dir)).why, /names no cost.*--usd/s, 'an unknown cost is never recorded as nothing');
  const dry = await models([...args, '--dry-run'], dir);
  assert.equal(dry.usd, 0.535);
  assert.match((await models(args, dir)).why, /no budget/, 'the same budget rule as a call made here');
  await models(['budget', 'grove', '--cap', '0.4'], dir);
  const over = await models(args, dir);
  assert.match(over.why, /REFUSED.*cap/);
  assert.match(over.why, /already ran on the fal connector/);
  assert.ok(!existsSync(join(dir, 'art', 'receipts.jsonl')), 'a refused import leaves no receipt');
  await models(['budget', 'grove', '--cap', '3'], dir);
  const done = await models(args, dir);
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.via, 'connector');
  assert.equal(done.usd, 0.535);
  assert.equal(done.after.heightM, 1.2);
  const a = JSON.parse(readFileSync(join(dir, 'games', 'grove', 'assets', 'manifest.json'), 'utf8')).assets.find((x) => x.id === 'beacon');
  assert.equal(a.route, 'generated');
  assert.equal(a.license.kind, 'generated');
  assert.deepEqual(a.made.steps.map((s) => [s.what, s.via ?? null, s.requestId ?? null]), [['concept', 'connector', 'req-concept-0001'], ['mesh', 'connector', 'req-mesh-0001'], ['optimise', null, null]]);
  assert.ok(existsSync(join(dir, 'art', 'beacon', 'raw', 'mesh.glb')), 'the raw file stays beside its job');
  const receipts = readFileSync(join(dir, 'art', 'receipts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(receipts.map((r) => [r.requestId, r.via, r.cost, r.game]), [['req-concept-0001', 'connector', 0.035, 'grove'], ['req-mesh-0001', 'connector', 0.5, 'grove']]);
  assert.equal(JSON.parse(readFileSync(join(dir, 'art', 'grove-models', 'budget.json'), 'utf8')).spent, 0.535);
  // The same receipts again: recorded once, never counted twice.
  const again = await models(args, dir);
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.usd, 0);
  assert.deepEqual(again.alreadyCounted, ['req-concept-0001', 'req-mesh-0001']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'art', 'grove-models', 'budget.json'), 'utf8')).spent, 0.535);
  assert.equal((await models(['receipts', 'grove'], dir)).usd, 0.535);
});
