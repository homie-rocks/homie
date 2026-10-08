# @homie-rocks/nav

Tiled navigation meshes, fixed-step crowds, editable obstacles and flat-grid paths.
Bake a level once, ship the bytes with the game, and load the nearby tiles on the
server. Core modules have no renderer, DOM, clock, unseeded random generator or
runtime WASM initialization. The optional `Three.js` module imports three.js.

```sh
npm install --save-exact @homie-rocks/nav@0.1.0
```

Import individual modules; there is no barrel. Positions are metres. Set
`up: 'y' | 'z'` in the mesh's bake configuration (default `'y'`). Y-up uses XZ
for the ground, matching three.js and the other engine packages. Z-up uses XY
for the ground, matching rules rooms. The crowd inherits this choice. Geometry,
heightfields, obstacles, links, query extents, returned points and velocities
all follow it. `minY` and `maxY` name the absolute **vertical** bounds in either
convention; origin height is not added to them. Tile coordinates `(x,z)` name
the two horizontal tile indices, including when the world is Z-up.

## Bake a heightfield and walk across it

```ts
import { CentredGrid } from '@homie-rocks/heightfield/Field.js';
import { bakeHeightfield, type BakeConfig } from '@homie-rocks/nav/Bake.js';
import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';

const posts = new CentredGrid(97, 0.25, 2);
const heights = new Float32Array(posts.n * posts.n);
const field = { heightAt: (x: number, z: number) => posts.sample(heights, x, z) };
const config: BakeConfig = {
  up: 'y', origin: [0, 0, 0], minY: -2, maxY: 10,
  cellSize: 0.25, cellHeight: 0.1, tileCells: 80,
  radius: 0.3, height: 1.8, stepHeight: 0.3, slopeDegrees: 45,
  retainSpans: true, // enable carving for these tiles; omit for static assets
};
const tiles = bakeHeightfield(field, config, { min: [0, 0], max: [20, 20] });
const mesh = new Mesh(config, [2, 2, 2]);
for (const tile of tiles) mesh.loadTile(tile.bytes);
const crowd = new Crowd(mesh, 1 / 20, 0.3);
const tune = { radius: 0.3, height: 1.8, speed: 3, acceleration: 8,
  neighbours: 2, separation: 2 };
const id = crowd.add([2, 0, 2], tune);
if (!crowd.target(id, [18, 0, 18])) throw new Error('No reachable target');
for (let tick = 0; tick < 400; tick++) crowd.step();
const feet = crowd.agent(id)!.position;
const arrived = crowd.arrived(id, 0.25);
const restored = Crowd.restore(crowd.save(), mesh);
restored.step(); // same next state as crowd.step(); both still share mesh
```

Heightfields sample their two horizontal arguments regardless of `up`.
`bakeHeightfield` handles orientation and winding. For arbitrary triangles use
`bakeLevel({positions, indices?}, config)`: it buckets triangles by tile with the
erosion halo included. Triangle winding must face upward. Stacked floors and
ceilings require triangle geometry; a heightfield supplies one surface.

`bakeTile(triangles, config, x, z)` is the low-level entry point. Its caller must
supply `(ceil(radius/cellSize)+3)*cellSize` of geometry outside every edge.
`loadTile` returns `{warnings}` for loaded neighbours without shared border
polygons. A genuine gap can produce the same diagnostic. `mesh.debug().seams`
returns these diagnostics later. Whole-level baking avoids this halo contract;
passing the entire level independently to every low-level bake still costs a
full input scan per tile. Rasterization belongs in the build for large scenes.

Navmesh positions sit on the voxel surface: a floor at zero can return 0.1 with
0.1 m cells. Project feet onto the game's ground/collision surface for rendering.
Radius and height round up; climb rounds down. Slope also requires a traversable
neighbour step at this resolution: an 80-degree slope setting does not override
`stepHeight/cellSize`. Region filtering defaults to 8 cells, merging to 20;
`minRegionCells` and `mergeRegionCells` control these thresholds.

## Fifty agents through a doorway

Continuing with the editable flat mesh and tune above:

```ts
mesh.addObstacle({ min: [9.5, -1, 0], max: [10.5, 4, 8] });
mesh.addObstacle({ min: [9.5, -1, 12], max: [10.5, 4, 20] });
const crossing = new Crowd(mesh, 1 / 20, 0.3);
const agents: number[] = [];
for (let i = 0; i < 50; i++) {
  const z = 2 + Math.floor(i / 5) * 1.6;
  const id = crossing.add([1 + i % 5, 0, z], tune);
  crossing.target(id, [15 + i % 5, 0, z]);
  agents.push(id);
}
for (let tick = 0; tick < 700; tick++) crossing.step();
const crossed = agents.every(id => crossing.agent(id)!.position[0] > 10.5);
```

The caller owns fixed scheduling, inputs and interpolation. `step()` advances
exactly one tick; maximum fixed dt is 0.1 seconds. All ids are positive numbers.
`ids()` lists agents, `setSpeed(id, metresPerSecond)` changes speed, and `stop(id)`
clears a target. Missing-id mutators return false; `agent(id)` returns null.
Malformed coordinates/dimensions throw an error beginning with `nav:`.

`agent(id)` returns fresh arrays and `status: 'walking' | 'link' | 'stranded'`,
`link` (public link id or null), `offMesh`, and `partial`. If the floor disappears,
the requested destination is kept. A mesh edit that restores nearby floor
re-places stranded agents automatically. `place(id, point)` explicitly relocates
one without changing its id or tune. Placement can fail when no floor is nearby.
New targets must be reachable; later edits may turn an existing route partial.
`arrived` never treats a partial route as arrival. Normal corridor validation
handles edits; distant edits do not restart every agent's search.

Crowd avoidance is soft local steering, not rigid-body collision. Dense
traffic can overlap substantially; a fresh 300-agent/1.5 m doorway run measured 0.077 m minimum centre
separation for 0.3 m radii, 658 samples below 0.3 m, and 223 of 300 across after
1,000 ticks. With 400 agents through 4 m, all crossed; minimum separation was
0.191 m. These limits are reproduced in `test/review/crowding.mjs`. The fifty-agent test
is an easier completion/clearance fixture, not a universal spacing guarantee.

## Obstacles, doors and links

`addObstacle({min,max})` carves a box; `addCylinder(base, radius, height)` carves
a vertical cylinder. Both return ids removed by `removeObstacle(id)`. Only tiles
baked with `retainSpans: true` can be carved. Decoded spans stay cached; an edit
rebuilds only overlapping tiles using only their overlapping obstacles. Removing
the last obstacle reuses the original polygons. These edits are synchronous;
use small editable tiles and edit between steps. Use crowd agents for frequent
moving obstacles. Box headroom accounts for the voxel surface offset.

For a frequently toggled door, add its box to `config.doorRegions` **before the
bake**. These regions create separate area polygons. Then:

```ts
const door = mesh.addDoor({ min: [9, -1, 8], max: [11, 3, 12] });
mesh.setDoorEnabled(door, false); // close: change flags, no rasterization/rebuild
mesh.setDoorEnabled(door, true);  // reopen
mesh.removeDoor(door);
```

Door boxes select entire intersecting door-region polygons. Author the region
around the passage, not the room. Multiple overlapping closed doors compose.
Flag filtering applies to paths, placement, random points and crowd corridors.
`addDoor` requires authored door regions; it does not silently carve a new hole.

`addLink(from, to, radius, bidirectional)` connects existing floors, rejects an
endpoint without floor, and returns a positive id. `setLinkEnabled` and
`removeLink` use that same id. `Path.links` contains zero for walking or this
public id, never a backend reference. Link endpoints should be near the intended
floors; each endpoint must find floor within the link radius on all axes. Disabling a link does
not block a parallel ordinary-floor route.

Automatic link traversal interpolates over 0.5 seconds. For game-controlled
jumps or permissions, add agents with `{...tune, manualLinks: true}`. Inspect
`agent(id).link` to select that link's game rule, animate using declared game
fields, then call `completeLink(id)`. Waiting traversal state survives saves;
no callback or closure is serialized. The game owns jump physics and animation.

## Queries and flat grids

Mesh and Grid implement `NavigationQuery`: `path(from,to)`, `nearest(point,from?)`,
`random(from,rng)`, and `raycast(from,to)`. Every point accepts `ArrayLike<number>`
with exactly three finite components, including ordinary arrays and typed arrays.
Results can be passed straight back into any query.

Mesh nearest snaps within query extents; with `from`, it finds the nearest point
in that directed reachable set. Mesh random samples polygons by area. Reachable
sets are revision-cached, bounded to 16 source polygons. Grid random samples free
cells uniformly. `new Random(uint32).next` supplies a reproducible 32-bit LCG;
seeds outside 0..4294967295 throw. This generator is only for gameplay sampling,
not security or statistical simulation. Save its one-word `state` separately.

A nav ray tests walkability, not visibility or physics, and never takes a link.
Wrong destination height can make `clear` false with `fraction === 1`. Mesh
height tolerance is two vertical cells; grid rays stay on their horizontal plane.
Mesh paths are polygon A* plus a funnel, not a global continuous-geodesic proof
across all possible polygon corridors.

```ts
import { Grid } from '@homie-rocks/nav/Grid.js';
const grid = new Grid(32, 32, 1, [0, 0, 0], undefined,
  { up: 'z', search: 'jps' });
grid.setBlocked(10, 10, true);
const route = grid.path([0.5, 0.5, 0], [25.5, 25.5, 0]);
```

The default search is eight-neighbour A* with octile costs and no corner cutting.
Optional JPS uses pinned PathFinding.js pruning with iterative scans to avoid
recursive stack overflow. Both match an independent Dijkstra cost oracle.
`path(...,{search:'astar'|'jps',smooth:false})` returns cell waypoints;
otherwise the grid's raycast string-pulls them. `cost` reports the unsmoothed
optimal grid cost in metres. Empty grids have an exact direct fast path. A*
reuses arrays across requests; component labels are cached until a cell edit.
Nearest uses direct cell indexing where possible, scanning only for blocked or
unreachable destinations. Grid crowd steering remains the game's responsibility.

## Binary state and rules rooms

Format 2 has a 16-byte little-endian header: magic, version, byte length, checksum.
It stores binary numbers, raw typed-array sections, shared shapes and graph
references in one buffer. There is no JSON, numeric text or recursive encoding
of byte arrays. The reference table preserves sliced-query heap aliases. This
format is pinned to the backend revision; there is no cross-version migration.
Truncated/corrupt data reports a `nav:` error. Saves are server/build data, not
an untrusted player-input protocol. The checksum is not authentication.

Separate the build's assets from room state:

- **Static assets:** baked tiles in the game build, addressed by tile key/content
  checksum. Ordinary static tiles omit compact spans. At 0.25 m cells, a flat
  10 m tile is 739 bytes; a retained tile is 60,135 bytes. An empty static tile is
  222 bytes. Retained cells cost 8 bytes each; spans cost 17 bytes each, plus the
  small tile/polygon header. Stacked geometry adds spans.
- **Mesh edits:** `mesh.save()` stores tile identities, obstacles, links, doors,
  allocation/salt tables and runtime topology. It excludes static geometry and
  spans. `Mesh.restore(bytes, originalTileBytes)` reconstructs the same topology;
  missing or changed assets fail. Typical measured one-tile topology saves were
  1.7–1.9 KB; size grows with polygons, links and edits, not baked span volume.
- **Crowd:** `crowd.save()` stores agents, corridors, active sliced searches,
  boundary state, tick, requested destinations, link progress and mesh identity.
  Finalized sliced-query pools are omitted; pending searches keep their aliases.
  It excludes mesh geometry and recomputable avoidance scratch. Restore with
  `Crowd.restore(bytes, sharedMesh)`; multiple crowds and game queries keep sharing
  it. A changed mesh identity fails rather than accepting stale polygon refs.

A rules object declares a navigation blob, mesh-edit blob when edits change,
and its RNG word alongside its other fields. The static build/asset cache stays
outside declared simulation state. In `think`, restore against that object's
mesh, apply ordered inputs, call `step()` once at 20 Hz, and assign `save()` to
the declared navigation field. Persist at tick boundaries. Prefer keeping the
live crowd between ticks; restore is for object wake/replay, not mandatory work
on every tick. Per-link animation progress belongs in the game's declared fields.
This is the integration contract; this package does not change the rules compiler.

Use `chunks(bytes)` for zero-copy 1 MiB views, and `joinChunks(parts)` to restore.
Store the chunk count/generation and all values in one SQLite transaction; each
value stays below 2 MB. Large-grid tests cover multi-value reassembly. Never
persist a half-written generation. No compression is required for the measured
300-agent rooms: 77–80 KB (roughly 258–266 bytes/agent, scene-dependent).
Active search frontiers and complex corridors add variable state; storage is
chunked rather than assuming a fixed maximum record per agent.

The measured 40×40 m, four-tile/300-agent process used 17.9 MB of live JS heap;
saving added 9.2–9.5 MB before GC, and sampled post-restore heap ranged from
24.4 to 37.2 MB. Its final save was 79,777 bytes, saved in 5.4–12.7 ms
and restored in 5.3–5.6 ms. The standalone
`node --expose-gc test/review/memory.mjs` check asserts heap plus array buffers
stays below 64 MiB at the sampled restore boundary. Node RSS includes its runtime and
is not a Durable Object heap measurement. Editable tile loading caps retained
cells at 250,000 and spans at 200,000 per mesh to bound the object expansion.
Unload distant editable tiles. Static tiles have no span expansion. The 4-million
cell grid is an upper API limit, not a recommendation to put a worst-case A*
frontier and a large crowd together in a 128 MB object.

## Determinism and the backend decision

navcat **0.4.1**, mathcat **0.0.12**, PathFinding.js **0.4.18** and its heap
**0.2.5** dependency use MIT licences, compatible with Apache-2.0. They are pinned
exactly. Generated backend code ships its MIT notices. The backend stays behind
private modules and fields; public declarations expose no navcat types.

The build checks the exact upstream crowd source hash, then replaces its four
velocity-sampling trig calls with a fixed arithmetic polynomial. No global Math
mutation occurs. Slope classification uses the same deterministic arithmetic.
Tests replace `sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, `log`, `hypot`, clocks
and unseeded random with throwing functions across bake/edit/query/step/restore.
Both up conventions produce identical bytes in Node, workerd and JavaScriptCore.
This proves the tested versions/fixtures; it does not promise backend-version
compatibility. Fixed tick, stable input order and identical assets remain required.

The bake's pinned upstream profiling hooks are suppressed synchronously and
restored in `finally`, after copying caller arrays. This module mutation is
version-specific; the clock-throwing test is the regression guard.

**Recast Navigation 0.43.1 was installed and run**, including identical repeated
scenes in Node, Safari and workerd. Its MIT wrapper and Recast/Detour zlib licence
are Apache-compatible. The default base64 WASM loader works in Node/browser;
workerd rejects its runtime byte compilation (covered by a negative test).
The successful Worker test imports the `.wasm` module and initializes the
`@recast-navigation/wasm/wasm` factory via `instantiateWasm`, then passes that
factory to `init`. This requires async setup and a bundler WASM rule. The complete
loader is in `test/review/compare.mjs`; no remote account is needed.

On the same flat 40×40 m scene, 61,952 triangles and 300 agents at 20 Hz:

| Runtime / engine | Bake range, ms | Query average, ms | Step median / p95, ms | Exported mesh bytes |
|---|---:|---:|---:|---:|
| Node / navcat | 32–55 | .0030 | 3.29 / 5.62 | 729 |
| Node / Recast WASM | 6–8 | .0082 | .98 / 1.62 | 424 |
| Safari / navcat | 21–39 | .001–.002 | 3 / 4–6 | 729 |
| Safari / Recast WASM | 5–10 | .002–.004 | 1 / 1 | 424 |
| workerd / navcat | 35–42 | .0038 | 2.62 / 3.47 | 729 |
| workerd / Recast WASM | 13–18 | .0066 | .99 / 1.45 | 424 |

Measured on Apple M4, Node 22.22.2, local workerd 1.20261007.1, 2026-10-07, with
normal desktop applications running. One warm-up bake then three samples;
queries 100 warm-ups/1,000 samples; crowds 30 warm-ups/120 fixed steps. Safari's
clock is coarse. Workerd figures are **host wall time including HTTP**, reported
as median/p95 of batch means, ten steps per HTTP request; they are not production Cloudflare CPU measurements.
Repeated runs varied: Node navcat bake 31–213 ms, step medians 2.27–3.59 ms in
this flat comparison. Both engines' bake and trajectory checksums matched
across tested runtimes and repeated browser runs.

Recast was faster for baking and crowd stepping. We retain navcat because its
ordinary state permits exact mid-search and mid-link saves; the tested Recast
API exports meshes/tile caches, not complete crowds. This is an explicit tradeoff
against Recast's longer history and mature TileCache. Source-hash checks, fixed
polygon/byte fixtures, independent geodesic/grid oracles and hidden backend types
are the upgrade safeguards. See the [Recast wrapper](https://github.com/isaac-mason/recast-navigation-js)
and [navcat API](https://navcat.dev/docs/) for upstream contracts.

## Three.js and verification

`Three.js` exports `trianglesFromObject3D(root, config?)`, `debugMesh(mesh,crowd?)` and
`disposeDebugMesh(group)`. Import applies indexed geometry, draw ranges, world
matrices, mirrored winding and instancing. Pass the same bake config for Z-up
triangle output. Debug drawing includes tiles, links
and agents, converting Z-up results to three.js Y-up. Dispose old groups when
replacing them. Core import-graph tests ensure no renderer reaches a server bundle.

From the repository root:

```sh
npm ci --cache /tmp/nav-npm-cache
npm run build
npm test
npm run leaks
node --expose-gc packages/nav/test/review/memory.mjs
node packages/nav/test/review/capacity.mjs
node packages/nav/test/review/performance.mjs
node packages/nav/test/review/compare.mjs
# Include automated Chrome measurements where process launch is permitted:
CHROME_PATH=/path/to/chrome node packages/nav/test/review/compare.mjs
# Or emit a self-contained page and open it in an existing browser:
node packages/nav/test/review/browser.mjs /tmp/nav-comparison.html
```

The obstacle-route workload measured a 300-agent 20 Hz step median of 9.97 ms,
p95 34.22 ms in a busy run; flat-world numbers above are not doorway numbers.
Editable 10/20/40 m tile loads measured .87/2.81/8.40 ms medians in the final
run (earlier busy run: 1.27/6.92/27.05). Adding a box measured 7.33/3.71/13.67 ms
(earlier: 16.43/12.61/37.83; warm-up/order matters); removing the final box
0.015–0.03 ms. Authored door toggle medians ranged .0010–.0023 ms (maximum 3.63 ms).
After excluding finalized query pools, a 300-agent door-region save measured
78,770 bytes. Across runs, save medians were 3.99–14.75 ms (maximum 37.47 ms);
restore medians were 1.51–5.09 ms (maximum 12.73 ms). Size and 50 ms room-save budgets are asserted in tests.
The 2,000² empty grid path fell from 548 ms/3,999 points to .65–9.31 ms/two points;
nearest .0096–.023 ms and random .036–.079 ms. First component labeling on an obstructed
grid is still linear; repeated queries reuse it.

Tests cover corruption, chunk boundaries, shared-mesh restoration, active sliced
searches, floor recovery, streaming, manual links, Z-up slopes/queries, headroom,
JPS cost, smoothing, strict TypeScript usage and renderer isolation. Normal nav
checks pass; the full repository command in this restricted session encounters
unrelated studio Chrome-launch failures. See `SUMMARY-FOR-REVIEW.md` for the exact
review disposition and verification results. No tests are disabled to conceal it.

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Batch `addObstacles(boxes)` and `removeObstacles(ids)` when changing many boxes: each affected tile is rebuilt once. Validation rejects the entire batch before changes, including any unknown removal id.
