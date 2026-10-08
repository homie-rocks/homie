import assert from 'node:assert/strict';
// Canonical crowd bytes remain identical after adding agents to restored twins.
import { Bake, Mesh, Crowd, State, floor } from './lib.mjs';
const config = {
  origin: [0, 0, 0],
  minY: -2,
  maxY: 8,
  cellSize: 0.25,
  cellHeight: 0.1,
  tileCells: 80,
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  slopeDegrees: 45,
};
const tri = [];
floor(tri, 0, 0, 20, 20);
const mesh = new Mesh(config, [1, 2, 1]);
for (const a of Bake.bakeLevel({ positions: tri }, config)) mesh.loadTile(a.bytes);
const tune = {
  radius: 0.3,
  height: 1.8,
  speed: 3,
  acceleration: 8,
  neighbours: 2,
  separation: 2,
};
const live = new Crowd(mesh, 0.05, 0.3);
live.add([2, 0, 2], tune);
const woke = Crowd.restore(live.save(), mesh);
console.log('after restore: bytes equal', State.hash(live.save()) === State.hash(woke.save()));
live.add([5, 0, 5], tune);
woke.add([5, 0, 5], tune);
console.log(
  'after adding one agent to both: bytes equal',
  State.hash(live.save()) === State.hash(woke.save()),
  `(${live.save().length} vs ${woke.save().length} bytes)`,
  '; decoded content equal',
  JSON.stringify(State.unpack('crowd', live.save())) ===
    JSON.stringify(State.unpack('crowd', woke.save())),
);
for (let i = 0; i < 50; i++) {
  live.step();
  woke.step();
}
console.log(
  'after 50 steps: positions equal',
  JSON.stringify(live.ids().map((i) => live.agent(i).position)) ===
    JSON.stringify(woke.ids().map((i) => woke.agent(i).position)),
);

assert.deepEqual(live.save(), woke.save());
