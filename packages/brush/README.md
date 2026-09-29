# @homie-rocks/brush

A world made of axis-aligned boxes and a few sloped ramps, for games with
interiors. `CollisionWorld` is the broadphase: a uniform XZ hash, a swept
capsule with a step height, a ground query and a raycast. `BrushKit` is the
builder that feeds it, so one `box` call gives a collider and merged geometry.
Around those sit a nav graph, per-frame queries, a strut between two points and
parametric industrial fittings. It does not know what a room, a material or a
footstep is: surfaces are the game's own numeric enum, every threshold is the
game's number, and texture tiling is a callback. It is not a heightfield; for
open ground see `@homie-rocks/walk`.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/brush@0.1.0 three@0.185.1
```

## Use

```ts
import * as THREE from 'three';
import { CollisionWorld } from '@homie-rocks/brush/Collide.js';
import { BrushKit } from '@homie-rocks/brush/Brush.js';
import { BrushQueries } from '@homie-rocks/brush/Queries.js';

enum Surface { Concrete, Metal }
const scene = new THREE.Scene();
const col = new CollisionWorld<Surface>(Surface.Concrete, { cell: 4, stepHeight: 0.38 });
const kit = new BrushKit<Surface, 'floor' | 'wall'>({
  col,
  material: (m) => new THREE.MeshStandardMaterial({ color: m === 'floor' ? 0x777777 : 0x999999 }),
  tile: () => 2,
  wallSurface: Surface.Concrete,
  stairSurface: Surface.Metal,
});
kit.box(-10, -0.2, -10, 10, 0, 10, 'floor', Surface.Concrete);
kit.wall(-10, 0, -10, 10, 3, -9.8, 'wall');
kit.merge();
scene.add(kit.group);

const q = new BrushQueries(col, { voidY: -50, voidSurface: Surface.Concrete, probeLift: 0.5, sightMargin: 0.05 });
const pos = new THREE.Vector3(0, 1, 0), vel = new THREE.Vector3(1, 0, 0);
const hit = q.collideCapsule(pos, vel, 0.35, 1.8, 1 / 60); // pos, vel advanced in place
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Collide.js` | `CollisionWorld`: boxes and ramps in an XZ hash; `groundAt`, `raycast`, swept-capsule `collide`; `rayAabb`, `aabbNormal` |
| `Brush.js` | `BrushKit`: `box`, `deco`, `mesh`, `slab`, `wall`, `doorWall`, `stairs`, `merge` to one mesh per material; `mergeBuffers` |
| `Queries.js` | `BrushQueries`: a ground `probe` that never returns null, a reused capsule step, `los`, `raycast` |
| `Nav.js` | `nearestNode`, `bfsPath` (fewest hops), `linkByVisibility`, `pickSpawn`, `nearestPlace`, `roomAt` |
| `Strut.js` | `strutBetween`: a bar of square section from one point to another, baked for merging |
| `Greeble.js` | fittings written into the kit: `pipeRun`, `cableTray`, `boltedPlate`, `hoopedDrum`, `lockerBank`, `guyedMast`, `valveWheel`, `conduit`, `junctionBox` |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
