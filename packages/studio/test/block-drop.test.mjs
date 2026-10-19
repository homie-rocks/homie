import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PKG, loadGame, fakeClock } from './rules-kit.mjs';
const scratch = mkdtempSync(join(tmpdir(), 'homie-block-drop-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
let loaded;
async function setup() {
  const dir = join(PKG, 'starters/block-drop');
  const L = loaded ??= await loadGame(scratch, dir, 'block-drop');
  const c = L.R.compileRules(L.def, { map: L.R.compileMap(JSON.parse(readFileSync(join(dir, 'map/main.json')))), settings: L.R.roomSettings({}).settings, seats: 4 });
  const core = L.C.createCore(c, { seed: 42 });
  core.seatJoin({ seat: 0, driver: 'person', owner: 'a' }); core.seatJoin({ seat: 1, driver: 'person', owner: 'b' });
  core.step(); core.step();
  return { L, c, core };
}
test('block-drop input changes only the person’s well; hard drop locks four cells', async () => {
  const { core } = await setup();
  const a = core.character(0).fields, b = core.character(1).fields;
  core.step(new Map([[0, { values: { dx: -1 } }]]));
  assert.equal(core.character(0).fields.x, a.x - 1);
  assert.equal(core.character(1).fields.x, b.x);
  core.step(new Map([[0, { values: { rotate: true } }]]));
  assert.equal(core.character(0).fields.rotation, 1);
  assert.equal(core.character(1).fields.rotation, 0);
  core.step(new Map([[0, { values: { drop: true } }]]));
  assert.equal(core.character(0).fields.grid.filter(Boolean).length, 4);
  assert.equal(core.character(1).fields.grid.filter(Boolean).length, 0);
  assert.ok(core.character(0).fields.score > 0);
  assert.equal(core.character(1).fields.score, 0);
  assert.equal(core.stats.errors, 0, core.stats.lastError);
});
test('block-drop completes a row, scores it, and restores the same next tick', async () => {
  const { L, c, core } = await setup();
  const saved = core.save(), names = c.kinds[0].fields.map(([name]) => name);
  const row = saved.ents.find(e => e[17] && e[17].length === names.length);
  assert.ok(row);
  const grid = Array(200).fill(0); for (let x = 0; x < 10; x++) if (x < 3 || x > 6) grid[190 + x] = 2;
  for (const [key, value] of Object.entries({ grid, piece: 1, x: 3, y: 18, rotation: 0, dead: 0, lines: 0, score: 0 })) row[17][names.indexOf(key)] = value;
  const a = L.C.createCore(c, { restore: saved }), b = L.C.createCore(c, { restore: L.P.fromBytes(L.P.toBytes(saved)) });
  const input = new Map([[0, { values: { drop: true } }]]); a.step(input); b.step(input);
  assert.equal(a.character(0).fields.lines, 1);
  assert.equal(a.character(0).fields.score, 100);
  assert.equal(a.character(0).fields.grid.filter(Boolean).length, 0);
  assert.deepEqual(a.save(), b.save());
  assert.equal(a.stats.errors, 0, a.stats.lastError);
});
test('a person taking a bot seat receives a fresh playable well', async () => {
  const { L, c } = await setup(); const core = L.C.createCore(c, { seed: 9 });
  core.seatJoin({ seat: 0, driver: 'person', owner: 'waiting' }); core.step(); core.step();
  core.seatLeave(0); for (let i = 0; i < 120; i++) core.step();
  assert.ok(core.character(0).fields.grid.some(Boolean));
  core.seatJoin({ seat: 0, driver: 'person', owner: 'newcomer' }); core.step(); core.step();
  assert.equal(core.character(0).fields.grid.filter(Boolean).length, 0);
  assert.equal(core.character(0).fields.dead, false);
  assert.equal(core.character(0).fields.score, 0);
  assert.equal(core.stats.errors, 0, core.stats.lastError);
});

test('watching a falling piece keeps the round running, but leaving pauses the empty room', async () => {
  const { L } = await setup(), dir = join(PKG, 'starters/block-drop');
  const game = JSON.parse(readFileSync(join(dir, 'game.json')));
  const compiled = L.R.compileRules(L.def, { map: L.R.compileMap(JSON.parse(readFileSync(join(dir, 'map/main.json')))), settings: L.R.roomSettings(game.room).settings, seats: 4 });
  const clock = fakeClock(), sent = [];
  const host = L.H.createHost({ game: 'block-drop', compiled, clock, random: () => 0.4, onRest: () => {}, send: m => sent.push(m) });
  try {
    host.frame({ t: 'join', peer: { id: 'watching-person', seat: 0, occ: 1, rest: true }, rest: true });
    clock.advance(70000);
    assert.equal(host.resting, false, 'a connected player can watch without freezing gravity');
    clock.advance(55000);
    assert.ok(sent.some(m => m.t === 'round' && m.round?.phase === 'over'), 'the round finishes without further input');
    host.frame({ t: 'leave', seat: 0 });
    assert.equal(host.people, 0);
    assert.equal(host.paused, true, 'empty rooms still stop');
  } finally { host.stop(); }
});
