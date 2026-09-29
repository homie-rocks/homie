# @homie-rocks/fx

Pooled effects for three.js games: particle pools with closed-form drag and
ballistic motion, camera-facing trails, shockwave rings, flame plumes, heat
shimmer, ground decals, weather and mote fields, haze, light shafts and a fixed
pool of claimable point lights. Most families are one instanced draw over a
preallocated ring buffer. It knows a position, a width, a normal, a colour and
a time; it never knows what is leaving the trail, what exploded or what is
burning, and the art direction stays in the game.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/fx@0.1.0 three@0.185.1
```

npm installs its one dependency, `@homie-rocks/noise`, with it.

## Use

```ts
import * as THREE from 'three';
import { Rings } from '@homie-rocks/fx/Rings.js';
import { flightRange } from '@homie-rocks/fx/trajectory.js';

const scene = new THREE.Scene();
const rings = new Rings(32);            // 32 live shockwaves, one draw call
scene.add(rings.mesh);

const now = performance.now() / 1000;
// centre, ground normal, radius 0.5 -> 6 m over 0.6 s, 0.4 m thick, colour, intensity, time
rings.spawn(new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, 1, 0), 0.5, 6, 0.6, 0.4,
  new THREE.Color(0xffb060), 2.5, now);

rings.update(performance.now() / 1000); // every frame

// how far a grain thrown at 40 m/s and 5 degrees travels under lunar gravity
const metres = flightRange(40, (5 * Math.PI) / 180, 1.62);
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `ParticlePool.js` | `ParticlePool`: abstract two-layer (additive + lit) particle system with spawn ceilings, density control and census counters |
| `DragParticles.js` | `DragParticles`, `DragParticleRing`: particles under gravity and linear drag, solved in closed form on the GPU |
| `ParticleRing.js` | `ParticleRing`: the instanced ring buffer under a particle layer, with tight upload ranges across the wrap |
| `ParticleTiles.js` | `coreTiles()`: eight procedural sprite tiles; `ParticleAtlas.js` packs tiles into a mipmapped atlas |
| `Ballistic.js` | `BallisticSet`: a GPU-integrated particle ring for airless worlds, with no drag term |
| `Trails.js` | `Trails`: camera-facing ribbon trails; the CPU writes only the spine |
| `Rings.js` | `Rings`: instanced shockwave rings simulated in the vertex shader, with optional depth-soft edges |
| `Plumes.js` | `Plumes`: camera-facing two-ribbon exhaust flames; the game supplies the flame shader |
| `Decals.js` | `Decals`: ground-projected multiply quads (skids, scorch, smudge) that fade by age |
| `GroundMarks.js` | `GroundMarks`: terrain-aligned multiply decals such as footprints and tracks |
| `CameraField.js` | `CameraField`: billboards wrapped around the camera for snow and weather, with wind and deterministic reseed |
| `Haze.js` | `HazeSheet`: a drifting noise sheet for mist and ground haze, with distance and edge fades |
| `Shafts.js` | `ShaftVolume`: light shafts in dirty air, one instanced additive draw |
| `EffectLights.js` | `EffectLights`: a fixed pool of point lights that effects claim each frame by importance |

And 30 more in `src/`, among them `Shimmer.js` (a heat veil), `RacerSystem.js`
(a base class that wires these pools into a racing game's frame) and
`trajectory.js` (vacuum ballistics).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
