import { bakeTile } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Grid } from '@homie-rocks/nav/Grid.js';
import { config, field, tune } from '../fixtures.mjs';
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const timed = (fn) => {
  const t = performance.now();
  const value = fn();
  return { ms: performance.now() - t, value };
};
for (const cells of [40, 80, 160]) {
  const cfg = { ...config, tileCells: cells },
    input = field(() => 0, -2, -2, cells + 17, cells + 17);
  const staticTile = bakeTile(input, { ...cfg, retainSpans: false }, 0, 0),
    editable = bakeTile(input, cfg, 0, 0),
    m = new Mesh(cfg, [2, 2, 2]);
  const loads = [];
  for (let i = 0; i < 5; i++) loads.push(timed(() => m.loadTile(editable)).ms);
  const adds = [],
    removes = [];
  for (let i = 0; i < 5; i++) {
    const a = timed(() => m.addObstacle({ min: [4, -1, 4], max: [5, 3, 5] }));
    adds.push(a.ms);
    removes.push(timed(() => m.removeObstacle(a.value)).ms);
  }
  console.log(
    JSON.stringify({
      cells,
      staticTileBytes: staticTile.length,
      editableTileBytes: editable.length,
      emptyBytes: bakeTile({ positions: [] }, { ...cfg, retainSpans: false }, 0, 0).length,
      loadMedianMs: median(loads),
      addMedianMs: median(adds),
      removeMedianMs: median(removes),
      meshStateBytes: m.save().length,
    }),
  );
}
const box = { min: [19, -1, -1], max: [21, 3, 41] },
  cfg = { ...config, tileCells: 160, doorRegions: [box] },
  m = new Mesh(cfg, [2, 2, 2]);
m.loadTile(
  bakeTile(
    field(() => 0, -2, -2, 177, 177),
    cfg,
    0,
    0,
  ),
);
const door = m.addDoor(box);
const edits = [];
for (let i = 0; i < 200; i++) edits.push(timed(() => m.setDoorEnabled(door, !(i % 2))).ms);
console.log(
  JSON.stringify({
    doorMedianMs: median(edits),
    doorMaxMs: Math.max(...edits),
  }),
);
const grid = new Grid(2000, 2000, 1, [0, 0, 0]);
console.log(
  JSON.stringify({
    gridPath: timed(() => grid.path([0.5, 0, 0.5], [1999.5, 0, 1999.5], { search: 'jps' })).ms,
    gridNearest: timed(() => grid.nearest([1500, 0, 1500])).ms,
    gridRandom: timed(() => grid.random([0.5, 0, 0.5], () => 0.5)).ms,
  }),
);
const c = new Crowd(m, 0.05, 0.3);
m.setDoorEnabled(door, true);
for (let i = 0; i < 300; i++) {
  const id = c.add([1 + (i % 15), 0.1, 1 + Math.floor(i / 15) * 1.8], tune);
  c.target(id, [39 - (i % 15), 0.1, 1 + Math.floor(i / 15) * 1.8]);
}
for (let i = 0; i < 30; i++) c.step();
const saves = [],
  restores = [];
let bytes;
for (let i = 0; i < 10; i++) {
  const a = timed(() => c.save());
  bytes = a.value;
  saves.push(a.ms);
  restores.push(timed(() => Crowd.restore(bytes, m)).ms);
}
console.log(
  JSON.stringify({
    agents: 300,
    crowdBytes: bytes.length,
    bytesPerAgent: bytes.length / 300,
    saveMedianMs: median(saves),
    saveMaxMs: Math.max(...saves),
    restoreMedianMs: median(restores),
    restoreMaxMs: Math.max(...restores),
  }),
);

const batchMesh = new Mesh(config, [2, 2, 2]);
batchMesh.loadTile(bakeTile(field(), config, 0, 0));
const boxes = Array.from({ length: 200 }, (_, i) => ({
  min: [1 + (i % 20) * 0.35, -1, 1 + Math.floor(i / 20) * 0.7],
  max: [1.1 + (i % 20) * 0.35, 3, 1.1 + Math.floor(i / 20) * 0.7],
}));
const batch = timed(() => batchMesh.addObstacles(boxes));
console.log(
  JSON.stringify({
    batchAdd200Ms: batch.ms,
    batchRemove200Ms: timed(() => batchMesh.removeObstacles(batch.value)).ms,
  }),
);
