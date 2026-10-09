# @homie-rocks/nav

Tiled navigation meshes, fixed-step crowds with exact save/restore, and grid
paths for game rules in Node, browsers and Cloudflare Workers. Bake triangle
geometry or a heightfield, stream tiles, carve obstacles, and control doors and
links. Queries and simulation have no renderer, clock or unseeded randomness.
The optional three.js module imports geometry and draws diagnostics.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/nav@0.1.0
# Only for Three.js helpers:
npm install --save-exact three@0.185.1
```

There is no barrel file: import the module you need. The JavaScript navigation
backend is navcat 0.4.1; JPS uses PathFinding.js 0.4.18. Neither needs WASM.

## Use

Bake assets outside the game tick; load them into a shared mesh. Coordinates and
agent dimensions are metres, time is seconds. Points accept arrays or typed
arrays containing exactly three finite coordinates.

```ts
import { bakeHeightfield, type BakeConfig } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';

const config: BakeConfig = {
  origin: [0, 0, 0], minY: -2, maxY: 8,
  cellSize: 0.25, cellHeight: 0.1, tileCells: 80,
  radius: 0.3, height: 1.8, stepHeight: 0.3, slopeDegrees: 45,
  retainSpans: true,
};
const assets = bakeHeightfield(
  { heightAt: (x: number, _z: number) => x * 0.02 }, config,
  { min: [0, 0], max: [40, 40] },
);
const mesh = new Mesh(config, [1, 2, 1]);
for (const asset of assets) {
  const { warnings } = mesh.loadTile(asset.bytes);
  if (warnings.length) console.warn(warnings);
}
const crowd = new Crowd(mesh, 0.05, 0.3, { searchIterations: 200 });
const id = crowd.add([2, 0.1, 2], {
  radius: 0.3, height: 1.8, speed: 3, acceleration: 8,
  neighbours: 2, separation: 2,
});
if (!crowd.target(id, [38, 0.8, 38])) throw new Error('Target is disconnected');
for (let tick = 0; tick < 400; tick++) crowd.step();
const position = crowd.agent(id)!.position;

// Persist both blobs, along with the original immutable tile assets.
const meshBytes = mesh.save();
const crowdBytes = crowd.save();
const restoredMesh = Mesh.restore(meshBytes, assets.map(a => a.bytes));
const restoredCrowd = Crowd.restore(crowdBytes, restoredMesh);
restoredCrowd.step();
```

For a room wake you **must persist `mesh.save()`** as well as `crowd.save()`.
The mesh blob contains polygon allocations and tile salts. Rebuilding from the
same assets and edits is not a substitute. Store a new mesh blob after topology
changes and pair it atomically with the crowd snapshot and loaded asset list.
Keep immutable assets in the game build, rather than copying them into each
crowd snapshot. `chunks()` and `joinChunks()` split/reassemble blobs for storage.

A grid needs no bake. It uses eight neighbours with octile cost and forbids
cutting blocked corners. Searches return the nearest partial path if necessary.

```ts
import { Grid } from '@homie-rocks/nav/Grid.js';
import { Random } from '@homie-rocks/nav/Random.js';

const grid = new Grid(100, 100, 0.5, [0, 0, 0]);
grid.setBlocked(50, 50, true);
const path = grid.path([1, 0, 1], [48, 0, 48], { search: 'jps', smooth: true });
const random = new Random(42);
const destination = grid.random([1, 0, 1], random.next);
const restored = Grid.restore(grid.save());
// Persist random.state with the game's other state to continue the sequence.
```

## Modules

| Module / member | Purpose |
|---|---|
| `Bake.js` — `checkConfig(config)` | Validate dimensions, budgets and compatible slope/voxel settings. |
| `checkObstacle(box)` | Validate a positive-volume world-space box. |
| `bakeTile(triangles, config, x, z)` | Produce one tile's bytes; input must cover its erosion halo. |
| `bakeLevel(triangles, config)` | Bucket geometry with halos and return sorted `{x,z,bytes}` assets. |
| `heightfieldTriangles(field, minX, minZ, nx, nz, step, up?)` | Sample an explicit lattice with upward winding. |
| `bakeHeightfield(field, config, rectangle, sampleStep?)` | Sample and bake a rectangle one tile plus halo at a time. |
| `Mesh.js` — `new Mesh(config, queryHalfExtents, options?)` | Create an empty mesh; extents are positive world-axis search distances. |
| `mesh.config`, `mesh.up`, `mesh.revision` | Read a copied config, axis convention and topology revision. |
| `mesh.loadTile(bytes)` | Load/replace an asset and return `{warnings}` for missing shared borders. |
| `mesh.unloadTile(x, z)` | Remove a tile; return false if absent. |
| `mesh.addObstacle(box)` | Carve an axis-aligned box; return its id. |
| `mesh.addObstacles(boxes)` | Validate a batch and rebuild each affected tile once. |
| `mesh.removeObstacle(id)` | Remove a carve and rebuild affected tiles. |
| `mesh.removeObstacles(ids)` | Remove a batch atomically; an unknown id rejects it. |
| `mesh.addCylinder(baseCenter, radius, height)` | Carve a cylinder extending upward from its base centre. |
| `mesh.addDoor(box, enabled?)` | Control a matching baked `doorRegions` portal; enabled means passable. |
| `mesh.setDoorEnabled(id, enabled)` | Change polygon flags without rebuilding geometry. |
| `mesh.removeDoor(id)` | Remove the door's flag override. |
| `mesh.addLink(from, to, radius, bidirectional)` | Connect floor endpoints; return a public link id. |
| `mesh.setLinkEnabled(id, enabled)` | Enable/disable an existing link. |
| `mesh.removeLink(id)` | Remove a link. |
| `mesh.nearest(point, from?)` | Project onto a floor, optionally restricted to the start's reachable set. |
| `mesh.path(from, to)` | Return `{complete, points, links}`; zero link entries mean walking. |
| `mesh.random(from, random)` | Pick a reachable point using a caller-supplied random function. |
| `mesh.raycast(from, to)` | Return `{clear, fraction, point}` for walking straight along the floor. |
| `mesh.debug()` | Return triangle positions, public links and seam diagnostics. |
| `mesh.identity()` | Return bytes identifying assets, edits and polygon references. |
| `mesh.save()` | Save dynamic topology; immutable asset bytes are excluded. |
| `Mesh.restore(bytes, assets)` | Restore topology with every saved tile's original bytes, in any order. |
| `Crowd.js` — `new Crowd(mesh, dt, maxRadius, options?)` | Create a fixed-step crowd; `searchIterations` bounds sliced search work. |
| `crowd.detach()` | Release the mesh association permanently; further use throws a navigation error. |
| `crowd.tick`, `crowd.mesh` | Read tick count and shared mesh. |
| `crowd.add(at, tune)` | Add an agent using baked clearance; return its id. |
| `crowd.remove(id)` | Remove an agent. |
| `crowd.ids()` | Return live ids in simulation order. |
| `crowd.target(id, to)` | Check cached reachability and enqueue a path request; false means no route/floor/id; stranded or mid-link agents remember the request. |
| `crowd.stop(id)` | Clear the requested destination. |
| `crowd.setSpeed(id, speed)` | Change a live agent's maximum speed. |
| `crowd.place(id, at)` | Move to a valid floor, retaining identity, tuning and destination. |
| `crowd.agent(id)` | Return position, velocity, status, link and partial-path state, or null. |
| `crowd.arrived(id, tolerance)` | Test a complete walking route's destination tolerance. |
| `crowd.completeLink(id)` | Finish a link traversal paused by `manualLinks: true`. |
| `crowd.step()` | Advance exactly one configured tick. |
| `crowd.save()` | Save continuation state, including pending searches and steering corners. |
| `Crowd.restore(bytes, mesh)` | Restore onto the matching live or restored mesh. |
| `Grid.js` — `new Grid(width, depth, cell, origin, blocked?, options?)` | Create a grid with optional mask, `up`, `search` and `smooth` options. |
| `grid.up` | Read the selected axis convention. |
| `grid.setBlocked(x, z, blocked)` | Edit a cell and invalidate cached components. |
| `grid.nearest(point, from?)` | Find the nearest free cell, optionally in the start's component. |
| `grid.path(from, to, options?)` | Return a path and unsmoothed octile `cost` in metres. |
| `grid.random(from, random)` | Pick a free cell in the start's component. |
| `grid.raycast(from, to)` | Traverse exact cells; touching a blocked corner counts as a hit. |
| `grid.save()` | Save dimensions, mask, origin and options. |
| `Grid.restore(bytes)` | Restore a grid; search buffers/components rebuild lazily. |
| `Random.js` — `new Random(seed)` | Create an integer generator from a uint32 seed. |
| `random.next()` | Return a number in `[0,1)`; `state` holds the writable uint32 continuation. |
| `State.js` — `chunks(bytes, limit?)` | Split into zero-copy views, default 1 MiB each. |
| `joinChunks(parts)` | Copy ordered chunks into a single blob. |
| `Query.js` — types only | `Point`, `Vector`, `Up`, `Path`, `Ray`, `NavigationQuery`. |
| `Three.js` — `trianglesFromObject3D(root, options?)` | Apply world transforms, instancing, draw ranges and mirrored winding. |
| `debugMesh(mesh, crowd?)` | Build a disposable three.js diagnostic group. |
| `disposeDebugMesh(group)` | Dispose its geometry/materials and clear the group. |

For paths over a heightfield without runtime topology edits or crowd avoidance,
`@homie-rocks/heightfield/Route.js` provides the existing waypoint router. Use nav
for tiled polygon meshes, streamed floors, runtime carving, links and crowds.

## Limits

- `up: 'z'` is a rotation: world `(x,y,z)` maps to internal `(x,z,-y)`.
  Positive tile/grid depth follows internal +z, hence world −y in z-up.
  Heightfield rectangles and sample coordinates use this internal horizontal
  frame. For example, `bakeHeightfield(field, { ...config, up: 'z' },
  { min: [0, 0], max: [20, 20] })` covers world x = 0…20, y = −20…0;
  world `(x, y, z)` samples `field.heightAt(x, -y)` for z. A z-up grid at
  `[0, 0, 0]` likewise grows toward negative world y.
  Three.js helpers use the same rotation. Box bounds must remain ordered.
- Slope is checked from triangle normals. The ledge filter accounts for slope
  voxel variation; adjacent compact spans still obey `stepHeight`. Incompatible
  cell size/height, climb and slope configurations throw. Reduce cell size or
  increase step height; the error reports the maximum supported slope and required
  minimum step height. Coarse sampling can also miss terrain features. Recast's
  voxel surface is approximate: on steep ramps returned `nearest` and agent
  positions can differ from the source surface by about two horizontal cells
  (observed 0.40 m at 40°/0.25 m cells and 0.72 m at 55°/0.4 m cells).
  Sample the original terrain separately when render/contact height must match.
- Tile width is `tileCells * cellSize`. Independent tile input needs a halo of
  `(ceil(radius / cellSize) + 3) * cellSize`. A whole level with no walkable output
  throws a winding/slope/clearance diagnostic. A border warning can also describe
  an intentional gap. Shared origin and bake parameters are required.
- Carving needs `retainSpans: true`. Retained cells/spans stay packed until a
  rebuild. `MeshOptions.maxRetainedCells` and `maxRetainedSpans` each default to
  1,000,000 and are saved with the mesh. Raise them explicitly for larger worlds;
  edits allocate temporary expanded spans. Prefer small tiles and batched edits.
- Doors disable whole portal polygons; author `doorRegions` during baking.
  Links are graph connections, not physical jump animations. Manual traversal
  requires the game to call `completeLink`.
- Crowd avoidance is local, not a collision solver or a traffic scheduler.
  Dense opposing traffic can overlap or jam; one standing agent can hold another
  indefinitely. Unloaded floors report `stranded`;
  reloading or `place` can recover them. Targets submitted while stranded or on
  a link are remembered even when `target` returns false. Edits invalidate only
  searches and corridors containing replaced tile/polygon generations or disabled
  nodes. An invalidated request restarts at retained corridor progress; unrelated
  searches keep their queue priority and budget. Corridors through replaced data
  recover from the current position. Active traversals retain endpoint coordinates
  and public link IDs even if the link disappears.
- Calling `target()` with the same destination leaves its request untouched.
  A point moving within the goal polygon updates the endpoint. A goal crossing a
  polygon boundary is coalesced while a search finishes, then the retained corridor
  is extended toward the newest goal. This avoids restarting a multi-tick search
  on every chase update. Search work is budgeted at the backend defaults (20 quick
  expansions, 200 per agent and 600 per tick); nearby retargets keep usable progress.
- Constructing or restoring a crowd attaches it to its mesh. `detach()` releases
  that association permanently; subsequent calls throw `nav: crowd is detached`.
  The mesh never retains crowds or callbacks. No weak references or finalisers
  are used. Mutating calls and `save()` synchronize pending mesh revisions;
  read-only agent observations project floor validity without advancing requests.
  Neighbours use a sparse hash with at most nine cell probes per agent, independent
  of the distance between loaded tiles. Fixed `dt` must be at most 0.1 seconds.
  Apply inputs in a stable order and save random state separately.
- Grid capacity is 4,000,000 cells, not a per-tick performance guarantee. Large
  obstructed searches and initial component labelling belong outside a 20 Hz
  tick. JPS uses A* on very sparse or dense masks where jump scanning costs more;
  an unobstructed octile route bypasses either search. Components cache until an edit.
- Snapshots are data graphs with explicit little-endian typed sections and an
  exact backend-version check. After checking the checksum, restores validate
  graph structure, cross references, compact-span connections and coordinate bounds.
  Malformed input throws a `nav:` error. Walking agents need a floor within query
  extents; stranded and link states retain their positions for later recovery.
  Coordinates are bounded to ±10,000,000 units and query half extents to eight tiles.
  Persist all chunks atomically;
  one large blob may exceed a storage system's per-value limit.

## Tests

`npm ci` runs this package's prepare script to generate its pinned private backend;
then root `npm run build` can compile it. `npm run build -w @homie-rocks/nav` also
regenerates that backend explicitly.

`npm test` uses a fixed small sample of both up axes and restore orders. It has no
wall-clock assertions. Run the larger checks separately from the repository root:

```sh
npm run test:arrival -w @homie-rocks/nav
npm run test:memory -w @homie-rocks/nav
npm run test:sweep -w @homie-rocks/nav
```

The arrival matrix runs 2,400 ticks for eight edit/target modes, both up axes and
1, 60, 300 and 1,000 agents (64 rows). Agents leave after entering the goal's 6 m
arrival region, avoiding a stationary queue at the destination. Unrelated link
and obstacle edits and unchanged targets must match every baseline arrival tick
exactly (zero-tick tolerance); relevant edits and moving goals must all arrive.
Moving-goal rows cross a tile/polygon boundary every tick, alternating endpoints
0.4 m apart, including while the initial search is still pending.
The memory soak creates, restores and discards 200,000 crowds and meshes without
yielding, checking retained heap after GC (4 MiB maximum growth after warmup).
The three fixed continuation cases used 14.4 CPU seconds on the machine below
(88.6 seconds elapsed under shared load). The full sweep runs 600 randomised
axis/seed cases plus the wider topology cases; it is deliberately outside `npm test`.

## Measurements

Apple M4 (10 cores), Node 22.22.2 and local workerd 1.20261007.1, macOS arm64.
All timings below are **user + system CPU milliseconds**, not elapsed latency.
Node uses `process.cpuUsage()`; workerd uses its own process CPU counter, excluding
the client's HTTP work. Worker counters have 10 ms resolution, so samples batch
20 ticks (10 for moving goals and edits, five for wakes); tables report each batch's
per-operation cost. Worker p95 values describe batch averages, not individual ticks.
The shared machine's one-minute load averages were 50 for the scene/grid run,
47 for edits and 47 when the wake report finished. CPU time excludes scheduler
waits but still reflects contention and processor speed; these are not latency guarantees.

Reproduce with `node packages/nav/test/measure.mjs`, `measure-wake.mjs` and
`measure-edits.mjs` in the same folder. Raw results are `test/measurements.json`,
`test/wake-measurements.json` and `test/edit-measurements.json`.
Scenes use 20 m tiles, 0.25 m cells, 0.1 m height cells and 0.3 m agents.
Pillars are 1.2 m square, 3 m high geometry on 5 m spacing.
Bake/load is one observation; save/restore medians use seven samples.

| Scene | Tiles | Static assets total / largest | Retained assets total / largest | Mesh save |
|---|---:|---:|---:|---:|
| Flat 20 × 20 m | 1 | 1,126 / 1,126 B | 169,582 / 169,582 B | 1,068 B |
| Pillars 20 × 20 m | 1 | 8,755 / 8,755 B | 176,599 / 176,599 B | 5,322 B |
| Pillars 80 × 80 m | 16 | 174,075 / 11,782 B | 3,180,879 / 206,758 B | 103,048 B |
| Pillars 160 × 160 m | 64 | 726,059 / 11,868 B | 12,977,471 / 206,844 B | 428,827 B |

| Static scene | Bake + load CPU ms | Mesh save / restore CPU ms | Across-map path median CPU ms | 300-agent save bytes | Crowd save / restore CPU ms |
|---|---:|---:|---:|---:|---:|
| Flat 20 × 20 m | 123.47 | 0.20 / 0.45 | 0.03 | 131,033 | 11.55 / 11.10 |
| Pillars 20 × 20 m | 116.99 | 0.17 / 0.42 | 0.11 | 217,989 | 12.73 / 9.67 |
| Pillars 80 × 80 m | 391.11 | 4.91 / 12.06 | 0.37 | 295,207 | 13.13 / 21.35 |
| Pillars 160 × 160 m | 602.18 | 23.97 / 47.70 | 2.43 | 488,183 | 24.72 / 25.65 |

Wakes include topology validation and 300 agents; a full wake restores both mesh
and crowd. Editable worlds retain spans and reapply saved obstacles on restore.

| World | Tiles | Live obstacles | Node mesh save / restore CPU ms | Node full wake CPU ms |
|---|---:|---:|---:|---:|
| Static 80 m | 16 | 0 | 5.92 / 9.35 | 26.39 |
| Editable 80 m | 16 | 0 | 9.04 / 46.54 | 65.48 |
| Editable 80 m | 16 | 20 | 7.92 / 156.17 | 172.63 |
| Static 160 m | 64 | 0 | 25.19 / 35.36 | 58.71 |
| Editable 160 m | 64 | 0 | 21.98 / 185.78 | 209.92 |
| Editable 160 m | 64 | 20 | 25.45 / 371.27 | 400.55 |

| Editable world, 20 live obstacles | workerd mesh restore CPU ms | workerd full wake CPU ms |
|---|---:|---:|
| 80 m | 114.00 | 126.00 |
| 160 m | 244.00 | 272.00 |

Every agent re-requests its fixed goal each tick on the 80 m pillar scene: 30 warmup
ticks, then 100 Node samples or seven workerd batches. Identical goals preserve
search progress; target-loop cost still includes cached reachability checks.

| Agents | Node target loop median CPU ms | Node whole tick median / p95 CPU ms | workerd target loop median CPU ms | workerd whole tick median / p95 CPU ms |
|---|---:|---:|---:|---:|
| 100 | 0.90 | 5.28 / 7.33 | 1.00 | 6.50 / 9.00 |
| 400 | 3.51 | 19.00 / 24.19 | 3.00 | 17.00 / 20.50 |
| 1,000 | 8.36 | 41.82 / 55.74 | 7.00 | 36.00 / 43.50 |

Moving goals oscillate 0.2 m from their initial point. The edit workload also removes
and adds a 0.6 m crate every tick with the crowd attached. Both include all target
calls, invalidation and stepping; 30 warmup ticks precede 100 Node samples or seven
workerd batches. Edits rebuild reachability components before target checks.

| Agents | Node moving goals median / p95 CPU ms | Node plus crate median / p95 CPU ms | workerd moving goals median CPU ms | workerd plus crate median CPU ms |
|---|---:|---:|---:|---:|
| 100 | 5.07 / 14.93 | 13.97 / 22.98 | 4.00 | 20.00 |
| 400 | 14.84 / 19.80 | 30.32 / 36.34 | 16.00 | 28.00 |
| 1,000 | 35.80 / 44.47 | 66.01 / 77.72 | 26.00 | 47.00 |

At 1,000 agents, moving a crate every tick can exceed a 50 ms tick's CPU budget. Persistence, rendering, other room work and scheduling delays cost more.
Capacity depends on geometry, crowd density and edits.

For 2,000 × 2,000 obstructed grids, median CPU milliseconds over three runs:

| Mask | A* | JPS option |
|---|---:|---:|
| One blocked centre cell | 47.16 | 23.10 |
| 10% seeded random obstacles | 561.78 | 597.32 |
| Alternating long walls | 2263.11 | 370.34 |
| Unreachable across a full wall | 2202.88 | 2361.07 |

Initial component labelling used 113.15–215.18 CPU ms; repeated nearby nearest
queries used at most 0.01 CPU ms median. A 4,000,113-byte grid restored in
23.58–33.57 CPU ms. Large obstructed grids need a separate scheduling budget.

Grid alone bundles to 20,749 bytes minified (8,229 gzip) with esbuild,
neutral platform and ESM output. It imports neither navcat nor three.js.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Bundled third-party
licenses accompany the generated backend.
