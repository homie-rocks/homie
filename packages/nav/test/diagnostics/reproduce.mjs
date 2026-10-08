// Run against the original dist directory to exercise topology and storage boundaries.
import { pathToFileURL } from 'node:url';
const source = pathToFileURL(process.argv[2].replace(/\/$/, '') + '/');
const { bakeTile, heightfieldTriangles } = await import(new URL('Bake.js', source));
const { Mesh } = await import(new URL('Mesh.js', source));
const { Crowd } = await import(new URL('Crowd.js', source));
const { Grid } = await import(new URL('Grid.js', source));
const config = {
  origin: [0, 0, 0],
  minY: -2,
  maxY: 12,
  cellSize: 0.25,
  cellHeight: 0.1,
  tileCells: 40,
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.3,
  slopeDegrees: 45,
};
const tune = {
  radius: 0.3,
  height: 1.8,
  speed: 3,
  acceleration: 8,
  neighbours: 2,
  separation: 2,
};
const field = (f = () => 0, x = -2, z = -2, nx = 57, nz = 57) =>
  heightfieldTriangles({ heightAt: f }, x, z, nx, nz, 0.25);
const flat = () => {
  const m = new Mesh(config, [2, 2, 2]);
  m.loadTile(bakeTile(field(), config, 0, 0));
  return m;
};
const result = {};
const tile = bakeTile(field(), config, 0, 0),
  m = flat(),
  crowd = new Crowd(m, 0.05, 0.3),
  agent = crowd.add([5, 0.1, 5], tune);
crowd.target(agent, [9, 0.1, 9]);
result.B1 = {
  tileBytes: tile.length,
  emptyBytes: bakeTile({ positions: [] }, config, 0, 0).length,
  meshBytes: m.save().length,
  crowdBytes: crowd.save().length,
};
m.unloadTile(0, 0);
for (let i = 0; i < 40; i++) crowd.step();
m.loadTile(tile);
for (let i = 0; i < 600; i++) crowd.step();
result.M1 = {
  arrived: crowd.arrived(agent, 0.3),
  place: typeof crowd.place,
  status: crowd.agent(agent).status,
};
const big = { ...config, tileCells: 160 },
  large = new Mesh(big, [2, 2, 2]);
large.loadTile(
  bakeTile(
    field(() => 0, -2, -2, 177, 177),
    big,
    0,
    0,
  ),
);
let start = performance.now();
const obstacle = large.addObstacle({ min: [18, -1, 18], max: [19, 3, 19] });
const addMs = performance.now() - start;
start = performance.now();
large.removeObstacle(obstacle);
result.M2 = {
  addMs,
  removeMs: performance.now() - start,
  door: typeof large.addDoor,
};
const walking = new Crowd(flat(), 0.05, 0.3),
  id = walking.add([1, 0.1, 1], tune);
walking.target(id, [9, 0.1, 9]);
const original = {},
  calls = {};
for (const name of ['sin', 'cos', 'tan', 'atan2', 'pow', 'exp', 'log', 'hypot']) {
  original[name] = Math[name];
  Math[name] = (...args) => {
    calls[name] = (calls[name] || 0) + 1;
    return original[name](...args);
  };
}
walking.step();
Object.assign(Math, original);
result.M4 = calls;
const grid = new Grid(2000, 2000, 1, [0, 0, 0]);
start = performance.now();
const path = grid.path([0.5, 0, 0.5], [1999.5, 0, 1999.5]);
result.M5 = { pathMs: performance.now() - start, points: path.points.length };
start = performance.now();
grid.random([0.5, 0, 0.5], () => 0.5);
result.M5.randomMs = performance.now() - start;
start = performance.now();
grid.nearest([1500, 0, 1500]);
result.M5.nearestMs = performance.now() - start;
const broken = new Mesh(config, [2, 2, 2]);
broken.loadTile(
  bakeTile(
    field(() => 0, 0, 0, 41, 41),
    config,
    0,
    0,
  ),
);
broken.loadTile(
  bakeTile(
    field(() => 0, 10, 0, 41, 41),
    config,
    1,
    0,
  ),
);
result.M6 = {
  missingHaloComplete: broken.path([5, 0.1, 5], [15, 0.1, 5]).complete,
};
const linked = flat();
linked.addObstacle({ min: [4, -1, -1], max: [6, 3, 11] });
const link = linked.addLink([3, 0.1, 5], [7, 0.1, 5], 0.6, true);
result.M7 = {
  link,
  returnedLinks: linked.path([2, 0.1, 5], [8, 0.1, 5]).links,
  publicState: !!linked.state,
  publicLocate: typeof linked.locate,
};
const overhead = flat();
overhead.addObstacle({ min: [4, 1.95, 0], max: [6, 4, 10] });
result.minor5 = {
  overheadComplete: overhead.path([2, 0.1, 5], [8, 0.1, 5]).complete,
};
result.minor6 = { floor: flat().nearest([5, 0, 5]) };
const rampConfig = { ...config, maxY: 80, slopeDegrees: 80 },
  ramp = new Mesh(rampConfig, [2, 2, 2]);
ramp.loadTile(
  bakeTile(
    field((x) => x * 4.70463),
    rampConfig,
    0,
    0,
  ),
);
result.minor7 = { rampFloor: ramp.nearest([5, 23.5, 5]) };
try {
  flat().loadTile(new Uint8Array([1, 2, 3]));
} catch (error) {
  result.minor9 = error.message;
}
result.minor10 = {
  shared: Crowd.restore(walking.save()).mesh === walking.mesh,
};
console.log(JSON.stringify(result, null, 2));
