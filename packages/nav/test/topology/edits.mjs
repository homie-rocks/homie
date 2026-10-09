import assert from 'node:assert/strict';
// Tile replacements during sliced searches must preserve valid crowd state.
import { Bake, Mesh, Crowd, floor, box } from './lib.mjs';
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
floor(tri, 0, 0, 40, 40);
for (let x = 2.5; x < 40; x += 5)
  for (let z = 2.5; z < 40; z += 5) box(tri, x - 0.6, -0.2, z - 0.6, x + 0.6, 3, z + 0.6);
const assets = Bake.bakeLevel({ positions: tri }, config); // 16 tiles of 10 m
const at = (x, z) => assets.find((a) => a.x === x && a.z === z).bytes;
const tune = {
  radius: 0.3,
  height: 1.8,
  speed: 3,
  acceleration: 8,
  neighbours: 2,
  separation: 2,
};
const edits = {
  'reload one tile': (m) => m.loadTile(at(2, 1)),
  'reload two tiles': (m) => {
    m.loadTile(at(2, 1));
    m.loadTile(at(1, 2));
  },
  'reload two tiles, other order': (m) => {
    m.loadTile(at(1, 2));
    m.loadTile(at(2, 1));
  },
  'box on a four-tile corner': (m) =>
    m.addObstacle({ min: [19.2, -1, 19.2], max: [20.8, 3, 20.8] }),
  'box inside one tile': (m) => m.addObstacle({ min: [24, -1, 14], max: [26, 3, 16] }),
  'unload one, load it back': (m) => {
    m.unloadTile(2, 1);
    m.loadTile(at(2, 1));
  },
  'unload two, load back swapped': (m) => {
    m.unloadTile(2, 1);
    m.unloadTile(1, 2);
    m.loadTile(at(1, 2));
    m.loadTile(at(2, 1));
  },
  'remove obstacle': (m) => {
    const id = m.addObstacle({ min: [24, -1, 14], max: [26, 3, 16] });
    m.removeObstacle(id);
  },
  'unload one tile': (m) => m.unloadTile(2, 1),
};
export async function checkEdits() {
  const filter = undefined;
  for (const [agents, iters] of [
    [1, 1],
    [1, 3],
    [40, 8],
    [300, undefined],
  ])
    for (const [name, edit] of Object.entries(edits)) {
      if (filter && !name.includes(filter)) continue;
      let crashes = 0,
        trials = 0,
        first = '';
      for (let after = 1; after <= (process.env.NAV_FULL ? 40 : 1); after++) {
        trials++;
        const mesh = new Mesh(config, [1, 2, 1]);
        for (const a of assets) mesh.loadTile(a.bytes);
        // one jump link and one door-like link, as any level with links has
        mesh.addLink([24, 0, 14], [14, 0, 24], 1, true);
        mesh.addLink([6, 0, 6], [26, 0, 16], 1, false);
        const crowd = new Crowd(mesh, 0.05, 0.3, iters ? { searchIterations: iters } : {});
        for (let i = 0; i < agents; i++)
          crowd.add([1 + (i % 40) * 0.9, 0, 1 + Math.floor(i / 40) * 0.9], tune);
        for (const id of crowd.ids()) crowd.target(id, [39 - (id % 7), 0, 39 - (id % 5)]);
        try {
          for (let t = 0; t < after; t++) crowd.step();
          edit(mesh);
          for (let t = 0; t < 60; t++) crowd.step();
        } catch (e) {
          crashes++;
          first ||= `first: edit after ${after} tick(s): ${e.constructor.name}: ${e.message}`;
        }
      }
      assert.equal(
        crashes,
        0,
        `${String(agents).padStart(4)} agents, searchIterations ${String(iters ?? 'default').padEnd(7)} ` +
          `${name.padEnd(30)}: step() threw in ${crashes}/${trials} ` +
          `trials  ${first}`,
      );
    }
}
