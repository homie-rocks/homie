# @homie-rocks/props

Procedural scenery generators for three.js: a village house and its fittings, a
lofted boat hull and a quayside, trackside furniture and a crowd, ridgelines and
islands, angular rocks, palms and ferns and grass, and on the industrial side a
truss bay, ladders, handrails, a gantry crane, a pressure bay and work lights.
Every generator takes numbers (and an RNG where it needs one) and returns
`THREE.BufferGeometry`. It owns no materials, no textures, no placement and no
scene: where a prop goes and what it is made of are the caller's decisions.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/props@0.1.0 three@0.185.1 simplex-noise@4.0.3
```

npm installs its dependencies, `@homie-rocks/geom`, `@homie-rocks/noise` and
`@homie-rocks/render`, with it.

## Use

```ts
import * as THREE from 'three';
import { ridgeGeo } from '@homie-rocks/props/Landform.js';
import { angularRock } from '@homie-rocks/props/Rock.js';
import { mulberry32, hash2 } from '@homie-rocks/noise/Noise.js';

// A 1.2 km ridgeline, 400 m deep and 300 m high, with baked vertex colours.
const ridge = ridgeGeo({ length: 1200, depth: 400, height: 300, seed: 7 });
scene.add(new THREE.Mesh(ridge, new THREE.MeshStandardMaterial({ vertexColors: true })));

// A faceted boulder, radius about 1: the RNG and the hash are both yours.
const rng = mulberry32(42);
const rock = angularRock(2, rng, (x, y) => hash2(x, y, 42), 0.5);
```

Generators draw from the RNG in a fixed order, so the same seed rebuilds the
same world. There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Village.js` | `buildHouse` into shared accumulators, plus `shutterGeo`, `doorGeo`, `balconyGeo`, `flowerBoxGeo`, `awningGeo`, `lampGeo` |
| `Harbour.js` | `hullGeo` (lofted cross-sections), `boatGeo`, and quayside clutter: `bollardGeo`, `crateGeo`, `barrelGeo`, `netGeo`, `ropeGeo`, `tyreGeo` |
| `Trackside.js` | parasols, grandstand, bell tower, stalls, tents, start lights, signage, bunting, and `spectatorGeo` |
| `Landmark.js` | `gullGeo`, `lighthouseGeo`, `windmillGeo` (separable rotor), `landmassGeo`, `debrisGeo` |
| `Landform.js` | `ridgeGeo` and `islandGeo` with the surface handed back, `ridgeContour`, `ribbonStrip`, `flankTerraces`, `flankSwitchback` |
| `Rock.js` | `angularRock`: a flat-faceted displaced icosahedron that stays closed along shared edges |
| `Vegetation.js` | palm trunk and fronds, fern and heliconia leaves, buttressed trunk, sapling, fallen log, pine, cypress, grass `clumpGeo` / `tuftGeo` |
| `Cloth.js` | `hangingSheet`: a static banner or tarp hung from one edge, with crease and sag callbacks |
| `Truss.js` | `trussBayGeo`, `trussShellGeo`, `ladderGeo`, `handrailGeo`, `footingGeo`, `portalGeo`, `conduitRunGeo`, `gantryCraneGeo`, lattice mast sections |
| `Pressure.js` | `pressureBayGeo` (optionally swept along a path), `bayInnerR` / `bayOuterR`, `derelictRibGeo` |
| `Spine.js` | `spineShellGeo` and `cutEdgeGeo`: a long segmented hull and a torn edge where it ends |
| `Fixtures.js` | work floods, flood mast and bracket, hazard beacon, radiator fin, docking clamp, deck lamp, batten, thermal panel, service cabinet, cable drum |
| `Kit.js` | the `RNG` type, `pick`, and the `smoothstep` these generators were authored against |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
