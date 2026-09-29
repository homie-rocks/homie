# @homie-rocks/geom

Procedural geometry for three.js games: chamfered boxes, lathes and plates, a
wall with real cut openings, lofts and sweeps, accumulators that merge many
parts into one buffer or one InstancedMesh, and the corridor maths under a
racing line (stations, frames, cross-sections, a minimum-curvature offset). It
knows triangles, matrices, instances and cells. It ships no prop generator and
no art direction, and it does not know what a lap, a checkpoint or a building
is: every number that describes a particular world is an argument.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/geom@0.1.0 three@0.185.1
```

npm installs its one dependency, `@homie-rocks/heightfield`, with it.

## Use

```ts
import * as THREE from 'three';
import { bevelBox } from '@homie-rocks/geom/prim.js';
import { GeoAccum } from '@homie-rocks/geom/accum.js';
import { trs } from '@homie-rocks/geom/trs.js';

// Ten chamfered 2 x 1 x 1 m blocks, merged into one draw call.
const block = bevelBox(2, 1, 1);
const acc = new GeoAccum();
for (let i = 0; i < 10; i++) acc.add(block, trs(i * 2.5, 0.5, 0, 0), new THREE.Color(0xb8b0a4));

const geo = acc.build(); // one indexed BufferGeometry with vertex colours, or null if empty
if (geo) scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true })));
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `prim.js` | `bevelBox`, `plainBox`, `card`, `groundStrip`, `wobbleDisc`, `chamferCap`, `flipFaces` |
| `chamfer.js` | metre-UV primitives: `chamferBox`, `latheGeo`, `chamferCyl`, `torusGeo`, `plateGeo`, `domeMeridian` |
| `wall.js` | `wallWithOpenings`: a facade panel with recessed window and door reveals |
| `loft.js` | `loft`: a closed cross-section swept along a path, with a radius callback |
| `mesher.js` | `MesherBase`: one growing triangle soup with rounded-rectangle lofts, revolves, tubes and atlas UV remapping |
| `accum.js` | `GeoAccum`: many transformed geometries into one indexed buffer with tint and baked AO |
| `inst.js` | `InstSet`: many transforms into one InstancedMesh with per-instance tint, UV, wind, LOD and bob channels |
| `merge.js` | `mergeStaticSets`: static instance sets baked into one mesh per material per grid cell |
| `weld.js` | `weldGeos` over a declared attribute schema, `weldParts`, `constAttr`, `bakeXform` |
| `sweep.js` | `sweepAlongZ`: bend a geometry built straight along +Z onto a curved path |
| `route.js` | `sampleRoute` over a height field, then `sweepGeo`, `ribbonGeo`, `dashedRibbon` and slicing along the frames |
| `station.js` | `StationLine`: a closed corridor cut into stations, the minimum-curvature offset and wrap-safe lookups |
| `ribbon.js` | the frame along a station table, cross-section profiles, and a grid-accelerated `findStation` |
| `navgraph.js` | `NavGraph`: an XZ road graph with an injected RNG for crowds and traffic |
| `laneride.js` | `LaneRider`: a body travelling a `NavGraph` offset from the centre line, easing into junctions |

and 24 more in `src/`: `xform`, `trs`, `tube`, `hexring`, `revolve`, `bell`,
`coneshell`, `finplate`, `extrude`, `bonekit`, `stencil`, `leanhull`, `floor`,
`graph`, `planar`, `network` and others.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
