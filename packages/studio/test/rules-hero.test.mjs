import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PKG, loadGame } from './rules-kit.mjs';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-hero-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
let loaded;
async function kit(hz = 20) {
  const dir = join(PKG, 'starters/hero-rush-3d'); loaded ??= await loadGame(scratch, dir, 'hero');
  const L = loaded, json = p => JSON.parse(readFileSync(join(dir, p), 'utf8'));
  const c = L.R.compileRules(L.def, { tune: json('tunables.json'), map: L.R.compileMap(json('map/main.json')), seats: 8 });
  const k = c.kinds[0]; let tick = 0;
  const ctx = L.M.moveContext({ tick: () => tick, tickHz: hz, tune: c.publicTune, map: c.map, name: 'main', spots: c.map.spots, radius: () => .44, dims: 3, shape: () => k.body });
  let body = { pos: { x: .44, y: 8, z: 0 }, vel: { x: 0, y: 0, z: 0 }, heading: { x: 1, y: 0, z: 0 }, grounded: true, motion: L.P.initFields(k.motion, 3) };
  return { L, c, get body() { return body; }, get tick() { return tick; }, step(input = {}) { tick++; body = L.P.stepMove(k.move, body, { ax: 0, ay: 0, jump: false, swing: false, ...input }, ctx, 125000, k.motion, 3, e => { throw e; }); return body; } };
}
test('Hero Rush crosses the clearing within 2% of the old 4.12 seconds', async () => {
  const r = await kit(); while (r.body.pos.x < 25.56 - .002 && r.tick < 200) r.step({ ax: 127 });
  assert.ok(Math.abs(r.tick / 20 - 4.12) / 4.12 < .02, `${r.tick} ticks`);
});
test('Hero Rush jumps to its setting, clears a swing on its first tick, and lands on tick eleven', async () => {
  const r = await kit(), heights = [];
  for (let i = 0; i < 11; i++) heights.push(r.step({ jump: i === 0 }).pos.z);
  const expected = [.32, .58, .79, .93, 1.02, 1.05];
  expected.forEach((height, i) => assert.ok(Math.abs(heights[i] - height) < .01, `tick ${i + 1}: ${heights[i]}`));
  assert.ok(heights[10] <= .002, 'lands within the 1 mm collision skin'); assert.equal(r.body.grounded, true); assert.equal(r.body.vel.z, 0);
});
test('a midair knock preserves vertical motion through the landing', async () => {
  const r = await kit(), control = await kit();
  r.step({ jump: true }); control.step({ jump: true });
  Object.assign(r.body.motion, { knockAt: 2.4, knockUntil: 10.8, knockFrom: r.body.pos, knockDir: { x: 1, y: 0, z: 0 } });
  for (let n = 0; n < 10; n++) assert.equal(r.step().pos.z, control.step().pos.z, `air step ${n}`);
  assert.ok(r.body.pos.x > control.body.pos.x + 3); assert.equal(r.body.grounded, true);
});
