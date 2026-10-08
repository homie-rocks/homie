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
| `crowd.tick`, `crowd.mesh` | Read tick count and shared mesh. |
| `crowd.add(at, tune)` | Add an agent using baked clearance; return its id. |
| `crowd.remove(id)` | Remove an agent. |
| `crowd.ids()` | Return live ids in simulation order. |
| `crowd.target(id, to)` | Check cached reachability and enqueue a path request; false means no route/floor/id. |
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
| `hash(bytes)` | Compute a deterministic 32-bit checksum, not a security hash. |
| `pack(kind, value)` | Encode a data graph with aliases and typed sections; advanced use. |
| `unpack(kind, bytes)` | Check schema/backend version, kind, length and checksum, then decode. |
| `Query.js` — `point(p)` | Validate three finite coordinates. |
| `vector(p)` | Copy a point into a three-number tuple. |
| `axes(p, up?)` | Rotate world coordinates into the internal y-up frame. |
| `fromAxes(p, up?)` | Apply the inverse rotation. |
| `axisExtents(p, up?)` | Convert positive extent magnitudes. |
| `axisBounds(min, max, up?, inverse?)` | Rotate a box and reorder its extrema. |
| `positive(n, name)` | Validate a positive finite scalar. |
| `distance(a, b)` | Calculate Euclidean distance. |
| `draw(random)` | Validate a random draw in `[0,1)`. |
| `Three.js` — `trianglesFromObject3D(root, options?)` | Apply world transforms, instancing, draw ranges and mirrored winding. |
| `debugMesh(mesh, crowd?)` | Build a disposable three.js diagnostic group. |
| `disposeDebugMesh(group)` | Dispose its geometry/materials and clear the group. |

## Limits

- `up: 'z'` is a rotation: world `(x,y,z)` maps to internal `(x,z,-y)`.
  Positive tile/grid depth follows internal +z, hence world −y in z-up.
  Heightfield rectangles and sample coordinates use this internal horizontal
  frame. Three.js helpers use the same rotation. Box bounds must remain ordered.
- Slope is checked from triangle normals. The ledge filter accounts for slope
  voxel variation; adjacent compact spans still obey `stepHeight`. Incompatible
  cell size/height, climb and slope configurations throw. Reduce cell size or
  increase step height; coarse sampling can also miss terrain features.
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
  Dense opposing traffic can overlap or jam. Unloaded floors report `stranded`;
  reloading or `place` can recover them. Fixed `dt` must be at most 0.1 seconds.
  Apply inputs in a stable order and save random state separately.
- Grid capacity is 4,000,000 cells, not a per-tick performance guarantee. Large
  obstructed searches and initial component labelling belong outside a 20 Hz
  tick. JPS uses A* on very sparse or dense masks where jump scanning costs more;
  an unobstructed octile route bypasses either search. Components cache until an edit.
- Snapshots are data graphs with explicit little-endian typed sections and an
  exact backend-version check. They are trusted assets/saves, not player input.
  Format 3 is incompatible with earlier formats. Persist all chunks atomically;
  one large blob may exceed a storage system's per-value limit.

## Measurements

Apple M4, Node 22.22.2, local workerd 1.20261007.1. From the repository root, reproduce with
`node packages/nav/test/measure.mjs`; raw results are in `test/measurements.json`.
The scenes use 20 m tiles, 0.25 m cells, 0.1 m height cells and 0.3 m agents.
Pillars are actual 1.2 m square, 3 m high geometry on 5 m spacing.
Bake/load is a single observation; save/restore medians use seven runs.

| Scene | Tiles | Static assets total / largest | Retained assets total / largest | Mesh save |
|---|---:|---:|---:|---:|
| Flat 20 × 20 m | 1 | 1,126 / 1,126 B | 169,582 / 169,582 B | 1,068 B |
| Pillars 20 × 20 m | 1 | 8,755 / 8,755 B | 176,599 / 176,599 B | 5,322 B |
| Pillars 80 × 80 m | 16 | 174,075 / 11,782 B | 3,180,879 / 206,758 B | 103,048 B |
| Pillars 160 × 160 m | 64 | 726,059 / 11,868 B | 12,977,471 / 206,844 B | 428,827 B |

| Scene | Bake + load ms | Mesh save / restore ms | Across-map path median ms | 300-agent save bytes | Crowd save / restore ms |
|---|---:|---:|---:|---:|---:|
| Flat 20 m | 38.5 | 0.07 / 0.16 | 0.021 | 111,767 | 4.66 / 2.37 |
| Pillars 20 m | 21.0 | 0.14 / 0.21 | 0.027 | 200,296 | 5.53 / 2.75 |
| Pillars 80 m | 92.9 | 3.55 / 3.97 | 0.110 | 258,626 | 6.58 / 4.18 |
| Pillars 160 m | 284.3 | 13.45 / 15.99 | 0.470 | 282,814 | 7.29 / 3.51 |

Every agent retargets every tick on the 80 m pillar scene. Timings are milliseconds,
100 samples after 30 warm-up ticks; topology and reachability caches are warm.
Worker measurements include one local HTTP round trip per operation.

| Agents | Node target loop median | Node whole tick median / p95 | Worker target loop median | Worker whole tick median / p95 |
|---|---:|---:|---:|---:|
| 100 | 0.28 | 2.12 / 2.87 | 0.61 | 3.01 / 3.58 |
| 400 | 1.16 | 8.95 / 9.95 | 1.56 | 10.06 / 10.77 |
| 1,000 | 2.82 | 24.99 / 36.97 | 3.32 | 26.11 / 30.12 |

At 400 agents this leaves room inside a 50 ms tick. At 1,000 the observed Node
maximum was 40.00 ms: capacity depends on geometry, density and other room work.
These timings exclude persistence. Reachability components rebuild after topology
changes; ordinary target requests then use cached set membership and queued searches.

For 2,000 × 2,000 obstructed grids, median query milliseconds over three runs:

| Mask | A* | JPS option |
|---|---:|---:|
| One blocked centre cell | 23.3 | 13.3 |
| 10% seeded random obstacles | 287.7 | 263.4 |
| Alternating long walls | 1,325.1 | 237.7 |
| Unreachable across a full wall | 900.4 | 891.3 |

Initial component labelling took 75–120 ms; repeated nearby blocked-cell nearest
queries took about 0.002 ms. A 4,000,113-byte grid restored in 21–23 ms. Large
obstructed grids therefore need a different scheduling budget from crowds.

Grid alone bundles to 20,524 bytes minified (8,099 gzip) with esbuild, neutral
platform and ESM output. It imports neither navcat nor three.js.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Bundled third-party
licenses accompany the generated backend.
