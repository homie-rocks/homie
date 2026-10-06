# @homie-rocks/heightfield

A regular grid of heights and the questions a game asks of one: clamped
bilinear and nearest fetch, a central-difference normal and slope angle,
band-limiting before a coarser sample, a horizon bake for sky view and
never-lit cells, and the skirted index of a chunked-LOD tile. It is pure
arithmetic over typed arrays and imports nothing, not even `three`, so a Node
script can ask what is under a point without a scene graph. It does not
generate terrain, and it does not know what a crater, a lake or a material is:
every number that describes a particular world is an argument.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/heightfield@0.1.0
```

## Use

```ts
import { CentredGrid, centralNormal } from '@homie-rocks/heightfield/Field.js';

// 257 posts, 2 m apart, post 0 at -256 m on both axes.
const grid = new CentredGrid(257, 2, 256);
const heights = new Float32Array(grid.n * grid.n); // fill from your generator

const ground = { heightAt: (x: number, z: number) => grid.sample(heights, x, z) };

const y = ground.heightAt(10, -40);
const normal = centralNormal(ground, 10, -40, grid.step, { x: 0, y: 0, z: 0 });
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Field.js` | `HeightField`, clamped `bilinear` / `bilinearRect` / `nearestIndex` fetch, `CentredGrid`, `centralNormal`, `slopeAngle`, `footprintFloor` |
| `Filter.js` | `binomial5` band-limiting, `boxBlur2D`, `smooth3x3` and `smoothMasked3x3` mask smoothing |
| `Horizon.js` | `horizonBake`: sky-view factor and never-lit mask by a geometric horizon march |
| `Mesh.js` | `skirtedGridIndex` with alternating diagonals and outward-wound skirts, `skirtVertex` addressing |
| `Chunk.js` | `fillChunkGrid` / `fillStaticGrid` positions and normals, `copyChunkSkirt` / `copyStaticGridSkirt` |
| `Ring.js` | `ringFrame`: a log-spaced square annulus for the far field |
| `Sight.js` | `sightBlocked`, `escapeFraction` and `groundUnderRay` by marching the field |
| `Grade.js` | `gradeSite` (level a pad with a batter), `ringPlaneFit`, `smoothDisc` |
| `Distance.js` | `dilateMax` and a `chamferSweep` distance transform that carries an attribute |
| `MeshBake.js` | `bakeMesh`: a height grid sampled off a triangle mesh (top or underside) with a `meshChecksum` of the mesh it read; `bakeStale`, `bakeField`, `packBake` / `unpackBake`, and `bakeWire` for a true-scale overlay |
| `Proxy.js` | authored colliders (box, cylinder, ramp): `proxyTop`, `proxiesHit`, `proxiesRay`, `checkProxies` |
| `Levels.js` | the `Structure` contract for buildings with more than one floor (floors, walls, openings, connectors), `checkStructure`, and `createWorld`: every surface over a point with its ceiling, movement and rays through openings |
| `Route.js` | waypoints with a height: `nearestNode` by level, `findRoute`, `checkRoute` / `checkNav` (legs and the corners a bot really cuts with its arrival radius), and `traverse`, a body that walks it |
| `Markers.js` | `markerSpots` and `ringStrips`: a zone mark on every level with room over it, and `markerSeenFrom` to prove a person under a roof sees it |
| `Pose.js` | `groundPose`, `poseProblem`, `placePose`, `sightProblem`: a staged position grounded and checked before a capture or a spawn uses it |

## A collider for an imported model

A model that draws is not a model a figure can stand on. `bakeMesh` samples its outside surface on a grid at the cell
size you choose, and records a checksum of the exact triangles it read:

```ts
import { bakeMesh, bakeField, bakeStale, packBake, unpackBake } from '@homie-rocks/heightfield/MeshBake.js';

const bake = bakeMesh({ positions, indices }, { cell: 0.25 });   // metres, y up, node transforms applied
const file = JSON.stringify(packBake(bake));                     // keep it beside the model

const loaded = unpackBake(JSON.parse(file));
const why = bakeStale(loaded, { positions, indices });           // null, or "the mesh changed since the bake…"
const ground = bakeField(loaded);                                // { heightAt(x, z), covered(x, z) }
```

A grid holds one height a post, so a room inside the model is not in it: that is `Levels.js`. What a figure walks
around (a crate, a pillar, a cover wall) is cheaper authored than sampled: `Proxy.js`. `@homie-rocks/studio` has a
command that does the bake from a `.glb` and walks a sample bot over the result (`homie-studio collision`).

## More than one floor

```ts
import { createWorld, checkStructure } from '@homie-rocks/heightfield/Levels.js';
import { checkRoute, traverse, nearestNode } from '@homie-rocks/heightfield/Route.js';

const world = createWorld({ ground, proxies, structures: [{ structure: building, at: { x: 40, y: 0, z: -12, yaw: 0 } }] });
world.surfacesAt(x, z);            // every standable surface over the point, lowest first, each with its ceiling
world.standOn(x, feetY, z, step);  // the one a body with its feet at feetY is on: the room, not the roof above it
world.ray(ox, oy, oz, dx, dy, dz); // stops at walls and slabs, passes through door openings

const bot = { radius: 0.35, height: 1.8, step: 0.3, maxDrop: 0.5, arrival: 1.2, speed: 4 };
checkRoute(world, path, bot);      // [] or what is wrong: a waypoint, a leg, or a cut corner
traverse(world, path, bot);        // a body walks it: { ok, why: 'arrived' | 'fell' | 'blocked' | … }
```

`checkRoute` uses the mover's real arrival radius. A bot turns for the next waypoint when it is within that radius of
this one, so the line it walks cuts every corner; at the inside corner of a roof that chord can cross air while every
waypoint and every leg is on the roof. The check tests the chords, and `traverse` walks them. Nodes are identified by
id and may share an (x, z): `nearestNode` picks by the height asked from. `Markers.js` puts a zone mark on every level
with headroom (not only the highest surface), and `Pose.js` grounds and checks an authored position (with the game's
own rule as a function) before a capture script or a spawn uses it. Connectors are stairs, ramps and doors; ladders
and deliberate drops are not modelled.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
