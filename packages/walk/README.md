# @homie-rocks/walk

On-foot movement for three.js games. `Walker` is a character controller for a
body on two legs: one ground contact with hysteresis, a coyote window, a jump
buffer, a slope limit that turns into a slide, a step-up rate, a soft boundary,
and a facing that may disagree with the velocity. Around it are a distance-driven
gait clock, foot planting and a thirteen-bone biped posed in the vertex shader
for instanced crowds. The world answers one query, `GroundField.sample`; the
game states every tuning number, and none has a default. It does not read
input devices, move a camera or know what the ground is made of.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/walk@0.1.0 three@0.185.1
```

npm installs its one dependency, `@homie-rocks/camera`, with it.

## Use

```ts
import { Walker, type WalkTune } from '@homie-rocks/walk/Walk.js';
import type { GroundField } from '@homie-rocks/walk/Ground.js';

const flat: GroundField = {
  halfSpan: 100,
  sample(x, z, out) { out.y = 0; out.normal.set(0, 1, 0); out.slope = 1; out.walkable = true; return out; },
};

const tune: WalkTune = {
  speed: 5.4, hushScale: 0.34, accel: 26, brake: 34, airAccel: 6.5, gravity: 24,
  jumpSpeed: 6.8, coyote: 0.12, buffer: 0.14, snapDown: 0.42, stepUp: 9, turnRate: 11,
  slideAccel: 15, slideControl: 0.25, gaitTau: 0.09, aimHeight: 1.34, wallSoft: 3,
  wallPush: 6, walkableCos: Math.cos((46 * Math.PI) / 180), landMinSpeed: 3.5, landFullSpeed: 14,
};

const walker = new Walker(tune);
walker.spawn(flat, 0, 0, 0);
const signals = { jump() {}, land(impact: number) {} };

// every frame: intent is already in world space
walker.step(1 / 60, { moveX: 0, moveZ: -1, jumpPressed: false, hush: false }, flat, signals);
console.log(walker.position, walker.stance, walker.gait);
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Walk.js` | `Walker`: the controller, with `WalkTune`, `WalkIntent`, `WalkSignals` and `Stance` |
| `Ground.js` | `GroundField` and `GroundSample`: the one query a walk asks the world |
| `Gait.js` | `GaitClock`: walk-cycle phase and idle/walk/air/slide blend weights; `SpeedTracker` for figures with no published speed |
| `footplant.js` | `footPlant`, the CPU mirror of the shader's foot position, and `bipedContacts` for contact patches |
| `gpubiped.js` | `bipedPoseGLSL`, `patchBipedVertex`: a biped posed in the vertex shader |
| `gpubipedmat.js` | `bipedDepthMaterial`: the matching depth material, so shadows are posed too |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
