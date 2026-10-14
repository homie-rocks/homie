/** Local media preparation and completed-output import tests. No provider clients or credentials. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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







test('models: a completed connector job is imported with budget, receipts and provenance', async () => {
  // No key and no network: every address a call could reach is a closed port, so a request would fail the test.
  const env = { ...process.env, HOME: scratch, FAL_QUEUE_URL: 'http://127.0.0.1:9', FAL_API_URL: 'http://127.0.0.1:9', FAL_STORAGE_URL: 'http://127.0.0.1:9', HOMIE_STUDIO_CLI: CLI };
  delete env.FAL_KEY; delete env.HOMIE_SPEND_LEDGER;
  const models = (args, cwd) => new Promise((ok) => {
    const p = spawn(process.execPath, [MODELS, ...args, '--json'], { cwd, env });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ ok: false, why: `no JSON: ${out} ${err}` }); } });
  });
  const dir = studio('connector');
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
