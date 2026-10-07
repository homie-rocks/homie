# @homie-rocks/nav

Navigation for computer-controlled characters: tiled meshes baked from triangles
or a heightfield, paths and reachable points, fixed-step crowds with local
avoidance, runtime obstacles, jump and door links, and a flat grid pathfinder.
The same core runs in a browser, Node and a Cloudflare Worker. It uses numbers,
arrays and typed arrays, with no DOM, renderer, wall clock or unseeded randomness.
Bakes and complete simulation snapshots are `Uint8Array` bytes.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/nav@0.1.0
```

There is no barrel file: import the module you need. Coordinates are world
metres, **Y up**, with XZ as the ground plane, matching heightfield and walk.
Triangle winding must face upward on walkable surfaces; apply model transforms
before baking. A heightfield represents one surface; use triangles for bridges,
rooms, ceilings and stacked floors. Sampling a field does not add skirts.

## Use

Bake a heightfield and walk a character across it:

```ts
import { CentredGrid } from '@homie-rocks/heightfield/Field.js';
import { bakeTile, heightfieldTriangles } from '@homie-rocks/nav/Bake.js';
import type { BakeConfig } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';

const posts = new CentredGrid(97, 0.25, 2);
const heights = new Float32Array(posts.n * posts.n); // flat; fill for hills
const field = { heightAt: (x: number, z: number) => posts.sample(heights, x, z) };
const config: BakeConfig = {
  origin: [0, 0, 0], minY: -2, maxY: 10,
  cellSize: 0.25, cellHeight: 0.1, tileCells: 80,
  radius: 0.3, height: 1.8, stepHeight: 0.3, slopeDegrees: 45,
};
// Tile (0,0) covers [0,20] on X and Z. Supply geometry beyond its borders.
const triangles = heightfieldTriangles(field, -2, -2, 97, 97, 0.25);
const bytes = bakeTile(triangles, config, 0, 0); // save beside the level
const mesh = new Mesh(config, [2, 2, 2]); // query snap half-extents in metres
mesh.loadTile(bytes);                    // also works with downloaded bytes
const crowd = new Crowd(mesh, 1 / 30, 0.3);
const tune = { radius: 0.3, height: 1.8, speed: 3, acceleration: 8,
  neighbours: 2, separation: 2 };
const id = crowd.add([2, 0, 2], tune);
if (!crowd.target(id, [18, 0, 18])) throw new Error('No target floor');
for (let tick = 0; tick < 400; tick++) crowd.step();
const feet = crowd.agent(id)!.position; // Float64Array [x,y,z]; copy to rendering
const arrived = crowd.arrived(id, 0.25);
const restored = Crowd.restore(crowd.save());
restored.step(); // identical to crowd.step() from the same saved tick
```

In a game, call `step()` once per simulation tick. The caller owns scheduling,
network inputs and interpolation. Do not feed elapsed frame time into this API.
`Crowd.save()` includes its mesh, obstacles, links, pending searches and traversal
progress. The restored crowd owns a new mesh, available as `restored.mesh`.

Fifty agents crossing a doorway, continuing with the flat `mesh` and `tune` above:

```ts
// A wall across the level, with a four-metre opening at Z=8..12.
mesh.addObstacle({ min: [9.5, -1, 0], max: [10.5, 4, 8] });
mesh.addObstacle({ min: [9.5, -1, 12], max: [10.5, 4, 20] });
const crossing = new Crowd(mesh, 1 / 30, 0.3);
const agents: string[] = [];
for (let i = 0; i < 50; i++) {
  const z = 2 + Math.floor(i / 5) * 1.6;
  const id = crossing.add([1 + i % 5, 0, z], tune);
  crossing.target(id, [15 + i % 5, 0, z]);
  agents.push(id);
}
for (let tick = 0; tick < 700; tick++) crossing.step();
const crossed = agents.every(id => crossing.agent(id)!.position[0] > 10.5);
```

## Modules

| module | what it does |
|---|---|
| `Bake.js` | `bakeTile({ positions, indices? }, config, tileX, tileZ)`; `heightfieldTriangles(field, minX, minZ, postsX, postsZ, step)`; `BakeConfig`, `Triangles`, `Obstacle` types |
| `Mesh.js` | `Mesh(config, queryHalfExtents)`, `loadTile`, `unloadTile`, queries, obstacle and link editing, `save` / static `restore` |
| `Crowd.js` | `Crowd(mesh, fixedDt, maxRadius)`, `add`, `remove`, `target`, `stop`, `agent`, `arrived`, `step`, `save` / static `restore` |
| `Grid.js` | `Grid(width, depth, cellSize, origin, blocked?)`, common queries, `setBlocked(x,z,value)`, `save` / static `restore` |
| `Query.js` | shared `Point`, `Path`, `Ray` and `NavigationQuery` types |
| `Random.js` | `Random(seed)`, `next()` in [0,1), writable one-word `Uint32Array` `state` for saving the generator |
| `State.js` | versioned internal graph codec; applications normally use the class save/restore methods |

`Mesh` and `Grid` implement the same `NavigationQuery`:

```ts
import { Random } from '@homie-rocks/nav/Random.js';
const rng = new Random(123);
const route = mesh.path([2, 0, 2], [18, 0, 18]);
if (route.complete) { /* follow route.points */ }
const snapped = mesh.nearest([3, 0, 3]);
const reachable = mesh.nearest([18, 0, 18], [2, 0, 2]);
const destination = mesh.random([2, 0, 2], rng.next);
const ray = mesh.raycast([2, 0.1, 2], [8, 0.1, 2]);
```

`nearest(point)` snaps within mesh query half-extents (grid: globally nearest
free cell centre). `nearest(point, from)` finds the closest point on the directed
reachable component, including enabled links. This component query scans loaded
polygons; it is not constant time. `random(from, rng)` samples that component
(mesh: area-weighted polygons; grid: uniform free cell centres), or returns null.
Save the caller's generator state separately. A random callback must return a
finite number in [0,1); the package never substitutes `Math.random`.

Paths snap both endpoints. `complete` means the snapped destination is reached;
false may still return a useful partial route. `links` parallels `points`: zero
for walking, otherwise a backend off-mesh node reference, **not** the edit ID
returned by `addLink`. A nav ray tests walkability, not visibility or physics;
it does not traverse off-mesh links. `fraction` is the XZ obstruction fraction,
and `point` lies on the reached floor. A wrong destination height can make
`clear` false even with fraction 1. Mesh height tolerance is two vertical cells;
grid rays must stay on their plane and cannot cut blocked corners.

## Tiles, obstacles and links

Build each tile independently with the same configuration and enough input
geometry for its halo: `(ceil(radius / cellSize) + 3) * cellSize` beyond every
XZ edge. Tile coordinates are signed integers relative to `origin`. Vertical
bounds are absolute world heights; origin Y is metadata, not an extra offset.
Tiles connect automatically when both sides are loaded. Unloaded areas are
unreachable; load the destination areas before requesting a route. All floors
within the vertical bounds live in the same XZ tile. No separate floor-layer
streaming is required.

```ts
mesh.loadTile(bakeTile(triangles, config, 1, 0)); // triangles must cover this tile
mesh.unloadTile(1, 0);
const crate = mesh.addObstacle({ min: [5, 0, 5], max: [7, 2, 7] });
mesh.removeObstacle(crate);
const jump = mesh.addLink([3, 0.1, 3], [8, 0.1, 3], 0.5, false); // one way
const door = mesh.addLink([3, 0.1, 4], [8, 0.1, 4], 0.5, true);  // both ways
mesh.setLinkEnabled(door, false);
mesh.removeLink(jump);
```

Links need endpoints near actual floor polygons. A door link should span an
otherwise disconnected opening; disabling a link cannot block a normal floor
route through the same opening. Use an obstacle for that case. Crowds traverse
links automatically with the backend's interpolation; animation, jump physics
and gameplay permissions belong to the game.

Obstacles are axis-aligned solid boxes, carved before radius erosion, including
headroom. Edits synchronously rebuild affected loaded tiles from retained
compact spans; unloaded tiles see current obstacles when loaded. Overlapping
obstacles survive removal of just one. Call edits between ticks; crowds notice
mesh revisions and reacquire targets. Adding an obstacle under a standing agent
is not a physical push-out solution: move that agent to a free position first.
Frequent moving obstacles should usually be crowd agents; carving is intended
for doors, crates and occasional level edits.

## Flat games

```ts
import { Grid } from '@homie-rocks/nav/Grid.js';
const grid = new Grid(32, 32, 1, [0, 0, 0]);
grid.setBlocked(10, 10, true);
const route = grid.path([0.5, 0, 0.5], [25.5, 0, 25.5]);
```

The grid uses four neighbours, uniform costs, a Manhattan heuristic and stable
index tie-breaking. This makes A* return an exact shortest grid route without
diagonal corner-cutting. Jump-point search is deliberately omitted: it is
optional and adds another search implementation without evidence that these
small flat maps need it. Grid following is the caller's waypoint movement;
`Crowd` operates on meshes. All queries return fresh result arrays.

## Engineering decisions and loading

The backend is **navcat 0.4.1**, an MIT-licensed TypeScript implementation of the
Recast/Detour algorithms, with its MIT mathcat dependency locked to 0.0.12.
These licences are compatible with this package's Apache-2.0 licence. Upstream
notices remain in the installed dependency packages. We wrap its voxel bake,
polygon queries, corridor following and sampled velocity avoidance instead of
inventing another navigation system. See [navcat's documentation](https://navcat.dev/docs/).

Recast/Detour WASM via `@recast-navigation/core` was considered, but not selected
or runtime-tested. Its WASM initialization and opaque crowd/search state make
complete mid-search snapshots harder. Workers support [precompiled WebAssembly
modules](https://developers.cloudflare.com/workers/runtime-apis/webassembly/javascript/),
which need a different loading arrangement from fetching WASM bytes in a browser.
TypeScript gives all three targets one synchronous ESM implementation and makes
all simulation state inspectable. This choice trades mature native performance
and compact binary assets for portable loading and complete snapshots.

- **Node:** import the modules after installation; read a tile with your own file
  I/O and pass its bytes to `loadTile`. No initialization promise or native addon.
- **Browser:** bundle normal ESM imports with the game's bundler; fetch a baked
  asset and use `new Uint8Array(await response.arrayBuffer())`. Baking also works
  in a browser worker. Bare imports need a bundler or import map.
- **Cloudflare Worker / Durable Object:** bundle the same ESM imports. No WASM,
  DOM, Node compatibility flag, network fetch or clock is used by the core.
  The application owns asset/storage access and fixed-tick scheduling. Bake
  offline for large levels to keep expensive rasterization outside request CPU
  budgets. Static loads decode already-built polygons; obstacle edits rebuild.

`navcat` declares an optional three.js peer, but neither its core nor this
package's core imports it. No debug drawer or scene importer is included; a game
can pass transformed triangle arrays and render the returned positions. Any
future three.js helper must live in a separate module.

Rasterization's upstream profiling hooks are the only clock-reading code on
our bake path. The synchronous wrapper temporarily replaces `BuildContext.start`
and `end` with no-ops and restores them in `finally`. Caller arrays are copied
before that scope, and no caller callbacks run inside it. This scoped module
mutation is pinned-version-specific and must be rechecked on backend upgrades;
it also suppresses profiling for that synchronous bake in a shared realm.

Cells quantize clearance conservatively: height and radius round up, step height
rounds down. All agent/configuration dimensions are explicit, so a level cannot
silently bake with another game's body size. Tile cells are limited to 4..1024,
vertical voxels to 65535, and total cells including halo to 2048 per side to bound
accidental allocations. Six-vertex polygons, watershed regions, 1.3-cell contour
simplification, 12-metre contour edges and detail samples six cells apart use the
backend's conventional pipeline; zero minimum region size keeps small islands.

Snapshots are versioned UTF-8 graph records in bytes, preserving IEEE numbers,
negative zero, typed arrays and shared references in sliced searches. The query
filter is a fixed singleton token, not a serialized callback. Keeping compact
spans alongside baked polygons allows obstacle removal without source geometry,
but makes assets large; transport compression is the caller's choice. Snapshots
are trusted build/server data, not an untrusted network-input format. They are
pinned to this format and backend version, with no migration promise. Treat
exposed `state` records as read-only; use class operations and restore methods.

Stable insertion order, a caller-owned seeded generator, and a fixed tick
(dt at most 0.1 seconds) make repeated runs and save/restore continuation exact.
The fixture matches byte-for-byte in Node, local workerd and Safari on this
machine. This is evidence for those tested runtimes, not a guarantee across every
JavaScript engine/version: the backend uses floating-point and trigonometry.
For authoritative rooms, keep the server authoritative, record operation order,
and reconcile clients. The rooms-plan branch's Z-up coordinate and rules-state
validation need explicit adapters; this package does not modify that system.

## Tests and measurements

From the repository root:

```sh
npm ci
npm run build
npm test
node --test packages/nav/test/performance.test.mjs
# Optional automated Chrome check on a host that can launch it:
CHROME_PATH=/path/to/chrome node --test packages/nav/test/runtime.test.mjs
# Or use an existing browser and open the local URL printed here:
node packages/nav/test/browser-check.mjs
```

Tests cover slope, step, headroom and radius clearance; tile seams and unloading;
obstacle overlap/removal; disconnected components and seeded sampling; directional
and disabled links; floor-aware rays; A* against an independent BFS oracle;
walking to a target; fifty agents crossing a doorway; exact seeded runs and
restore during sliced searches, obstacle replanning and off-mesh traversal.
The runtime fixture forbids `Math.random`, `Date.now` and `performance.now` while
baking, querying, editing, stepping and restoring. Browser bundling is tested
without a renderer import. Local workerd tests run without Node compatibility.
Automated Chrome is skipped unless `CHROME_PATH` is provided; this sandbox could
not launch Chrome, so the browser fixture was also run successfully in Safari.
No cloud deployment or remote Worker account is required by the tests.

Measured on **Apple M4, Node v22.22.2, 2026-10-07**, standalone performance test:

| workload | measurement |
|---|---:|
| full 40×40 m tile bake, 61,952 input triangles, 0.25 m cells | 137.03 ms median |
| path query around a box obstacle | 0.0129 ms median / 0.0357 ms p95 |
| one 1/30 s crowd step, 300 moving agents | 2.876 ms median / 3.405 ms p95 |
| uncompressed baked tile, including compact spans | 4,604,150 bytes |

Bake: one warm-up then three samples. Queries: 100 warm-ups then 1,000 samples.
Crowd: 30 warm-ups then 120 steps. The test reports timings on every run and
checks real movement and successful paths; it does not enforce machine-specific
thresholds. These are one machine's measurements, not Worker CPU guarantees.

## Limits

Mesh paths use Detour-style A* over polygons followed by funnel straightening.
They are short walkable corridor routes, not a proof of the globally shortest
continuous geodesic across every possible polygon corridor. Voxel resolution and
contour simplification affect small features; collision still belongs to the
game's character controller. Crowd avoidance is a local velocity sampler, not
hard collision or a guarantee against overlap or congestion. The doorway test
checks completion, wall clearance and separation, not every opposing-flow case.

No custom area costs, cylinder obstacles, per-link gameplay callbacks, moving
platforms, grid crowd steering, JPS, asynchronous bake scheduler, asset compression,
three.js adapters or rooms integration are included. Large streaming worlds need
application-level tile selection and destination loading. Tests do not establish
cross-version byte stability, all-engine lockstep, mobile throughput or production
Cloudflare CPU/memory limits.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
