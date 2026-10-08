import assert from 'node:assert/strict';
// Caller asset order cannot change rebuild allocations, even after streaming.
import { Bake, Mesh, Crowd, State, floor, box } from './lib.mjs';
const config = {
  origin: [0, 0, 0],
  retainSpans: true,
  minY: -2,
  maxY: 8,
  cellSize: 0.25,
  cellHeight: 0.1,
  tileCells: 40,
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  slopeDegrees: 45,
};
const tri = [];
floor(tri, 0, 0, 20, 20);
for (let i = 0; i < 5; i++)
  box(tri, 2 + i * 3.5, -0.2, 3 + (i % 3) * 5, 3.2 + i * 3.5, 3, 4.5 + (i % 3) * 5);
const assets = Bake.bakeLevel({ positions: tri }, config); // 4 tiles
const bytes = assets.map((a) => a.bytes);
const tune = {
  radius: 0.3,
  height: 1.8,
  speed: 3,
  acceleration: 8,
  neighbours: 2,
  separation: 2,
};
function trial(label, loadOrder, restoreOrder, streamed) {
  const live = new Mesh(config, [1, 2, 1]);
  for (const i of loadOrder) live.loadTile(bytes[i]);
  if (streamed) {
    live.unloadTile(assets[0].x, assets[0].z);
    live.loadTile(bytes[0]);
  } // ordinary streaming
  const crowd = new Crowd(live, 0.05, 0.3, { searchIterations: 4 });
  for (let i = 0; i < 40; i++) crowd.add([1 + (i % 8) * 2.2, 0, 1 + Math.floor(i / 8) * 4.1], tune);
  for (const id of crowd.ids()) crowd.target(id, [19 - ((id * 7) % 18), 0, 19 - ((id * 5) % 18)]);
  for (let t = 0; t < 10; t++) crowd.step();
  const woke = Mesh.restore(
    live.save(),
    restoreOrder.map((i) => bytes[i]),
  );
  const wcrowd = Crowd.restore(crowd.save(), woke);
  const same0 = State.hash(live.save()) === State.hash(woke.save());
  // an ordinary edit that touches the four-tile corner
  const ob = { min: [9, -1, 9], max: [11, 3, 11] };
  live.addObstacle(ob);
  woke.addObstacle(ob);
  const same1 = State.hash(live.save()) === State.hash(woke.save());
  let first = -1,
    max = 0,
    bytesFirst = -1;
  for (let t = 0; t < 300; t++) {
    if (t % 40 === 0)
      for (const id of crowd.ids()) {
        const to = [1 + ((id * 13 + t) % 18), 0, 1 + ((id * 3 + t) % 18)];
        crowd.target(id, to);
        wcrowd.target(id, to);
      }
    crowd.step();
    wcrowd.step();
    if (bytesFirst < 0 && State.hash(crowd.save()) !== State.hash(wcrowd.save())) bytesFirst = t;
    for (const id of crowd.ids()) {
      const a = crowd.agent(id).position,
        b = wcrowd.agent(id).position;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d > 0 && first < 0) first = t;
      max = Math.max(max, d);
    }
  }
  assert.ok(same0 && same1, label);
  assert.equal(bytesFirst, -1, label);
  assert.equal(first, -1, label);
  assert.equal(max, 0, label);
}
trial('loaded 0123, restored 0123              ', [0, 1, 2, 3], [0, 1, 2, 3], false);
trial('loaded 0123, restored 3210              ', [0, 1, 2, 3], [3, 2, 1, 0], false);
trial('loaded 2031, restored 0123 (bake order) ', [2, 0, 3, 1], [0, 1, 2, 3], false);
trial('loaded 0123, tile 0 unloaded+reloaded, restored 0123', [0, 1, 2, 3], [0, 1, 2, 3], true);
