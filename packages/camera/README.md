# @homie-rocks/camera

Camera maths for three.js games: closed-form springs and oscillators, the lens
(field-of-view fitting, focal length, horizon placement), an exact frame solver
that puts a subject at a chosen point on screen, and the building blocks of a
chase rig and its cinematic shots. It does not know what is in the shot — no
lap, no race state, no game object — and it ships no tuned number: every
bound, time constant and length is an argument the game supplies.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/camera@0.2.1 three@0.185.1
```

## Use

```ts
import * as THREE from 'three';
import { fitFov, solveViewAxis } from '@homie-rocks/camera/lens.js';
import { damp1, type Vel } from '@homie-rocks/camera/spring.js';

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);
const bounds = { vMin: 30, vMax: 78, hMin: 62, hMax: 100 }; // yours: there is no default
const up = new THREE.Vector3(0, 1, 0);
const fovVel: Vel = { v: 0 };

// Once a frame, after the game has decided where the eye is.
function frame(eye: THREE.Vector3, subject: THREE.Vector3, wantFov: number, dt: number): void {
  // Ease toward the field this aspect can carry; exact at any frame rate.
  camera.fov = damp1(camera.fov, fitFov(wantFov, camera.aspect, bounds), fovVel, 0.25, dt);
  camera.updateProjectionMatrix();

  // One rotation, no feedback loop: the subject lands at NDC (-0.33, -0.2).
  camera.position.copy(eye);
  solveViewAxis(eye, subject, up, -0.33, -0.2, camera.fov, camera.aspect, camera.quaternion);
}
```

There is no barrel file: import the module you need. `spring.js` imports
nothing at all, so it also runs in Node or on a page with no renderer.

## Modules

| module | what it does |
|---|---|
| `spring.js` | `damp1`, `damp3`, `Osc`, `expApproach`, `approach`, `logApproach`, `Trauma`, `shakeNoise`: closed-form filters, exact at any `dt` |
| `lens.js` | `fitFov`, `solveViewAxis`, `slewLimit`, `focalFromFov`, `pitchForHorizon`, `horizonFraction`, `planeUnderNDC` and the other lens relations |
| `compose.js` | `frameBounds`, `hangFog`: solve the distance that keeps a ring of points inside the frame, and hang fog off it |
| `chase.js` | `poseChase`, `applyChaseFov`, `frameLateral`, `frameVertical`, `aimAtSubject`: the chase arm, lens and composition |
| `bearing.js` | `updateBearing`: the compass direction a chase lens sits behind, bounded in lag and in rate |
| `rig.js` | `updateDrive`, `trackTeleport`, `shakeOrientation`, `subjectOccluded`, `cutToMode`, `shotChanged`: a chase rig's bookkeeping and cuts |
| `rigstate.js`, `wiring.js` | `ChaseRigState`, `ChaseRigWiring`: the chase rig's shared fields and wiring, for a game's camera to extend |
| `cinematics.js` | `poseIntro`, `poseFinish`, `poseOrbit`: a countdown fly-in, a trackside finish cut and a results orbit |
| `constrain.js` | `limitEyeSpeed`, `pushMinRange`: the two hard constraints on where a lens may go |
| `blockers.js`, `scene.js` | `BoxField`, `BoreCeiling`, `PropBuilder`: what a lens may not be inside, and the scene walks that fill them |
| `keyframe.js` | `sampleKeys`, `easeRamp`: sample a hand-authored camera timeline without changing its duration |
| `freefly.js` | `flyState`, `adoptCamera`, `lookDelta`, `flyStep`: a photo-mode free camera that owns the whole transform |
| `shake.js` | `shakeOffset`, `shakeFalloff`: a jolt from a source that falls off with distance |
| `subject.js` | `localBounds`, `surveyTraffic`, `sightSkyBody`, `nearestKeylitIndex`: measuring the subject and what else is in frame |
| `sightline.js`, `nearband.js`, `staging.js` | lift a shot clear of terrain, find the foreground ground a lens can see, stand where a crowd does not merge |
| `follow.js` | `stepFollow`, `followState`, `cutFollow`, `fieldFromBlocked`: a third-person follow camera with a collision guard (swing, pull in, climb), numbers only |
| `heading.js` | `headingFrom`, `headingOfVector`, `vectorOfHeading`, `stepHeadingWatch`: the one heading the package means, the adapter from any other, and the check that catches a wrong one |

and 4 more in src/: `focuspick.js`, `pickscene.js`, `frame.js`, `scratch.js`.

## The heading: read this before you hand the camera an angle

**Yaw 0 faces +Z. Positive yaw turns toward +X. Radians.** Forward is
`(sin yaw, cos yaw)` in (x, z), so `yaw = Math.atan2(forward.x, forward.z)`.

```
 seen from above, +Y toward you

                  -Z   yaw = PI
                   |
 yaw = -PI/2  -X --+-- +X  yaw = +PI/2
                   |
                  +Z   yaw = 0
```

That is `object.rotation.y` for a model built facing +Z, and nothing else. It
is the yaw `follow.js` takes (`FollowTarget.yaw`) and the yaw the chase rig
hands back (`armYaw`, `faceYaw`). An angle is a bare number, so the wrong one
does not throw: the camera sits beside the subject, or in front of it looking
back. If your game measures its heading any other way, convert it with
`heading.js`. Say which axis your angle 0 faces and which axis it has reached
a quarter turn later:

```ts
import { headingFrom, headingOfVector } from '@homie-rocks/camera/heading.js';

// A three.js model that faces +Z: rotation.y already is the yaw. No adapter.
const yaw = hero.rotation.y;

// A three.js model (or camera) that faces -Z:
const toYaw = headingFrom({ zero: '-z', turn: 'ccw' }); // once, outside the loop
const yaw = toYaw(hero.rotation.y);

// A game whose heading 0 is +X: angle = Math.atan2(vz, vx)
const toYaw = headingFrom({ zero: '+x', toward: '+z' });
const yaw = toYaw(player.angle);

// No angle at all, only a forward or velocity vector:
const yaw = headingOfVector(forward.x, forward.z);
```

| your game's heading | the adapter |
|---|---|
| `rotation.y`, model faces +Z | none: it is the yaw |
| `rotation.y`, model faces -Z | `headingFrom({ zero: '-z', turn: 'ccw' })` |
| `Math.atan2(vz, vx)` (0 is +X) | `headingFrom({ zero: '+x', toward: '+z' })` |
| 0 is +X, counter-clockwise from above | `headingFrom({ zero: '+x', turn: 'ccw' })` |
| a compass in degrees, north is -Z | `headingFrom({ zero: '-z', turn: 'cw', degrees: true })` |
| a forward vector | `headingOfVector(fx, fz)` |

`turn` is as seen from above with +Y toward you: `'ccw'` turns the subject to
its own left, which is three.js's `rotation.y`. `toward` says the same thing
with an axis and cannot be misread; give either. A convention that makes no
sense throws when the adapter is made. `toYaw.back(yaw)` goes the other way,
for a game that reads a yaw back out of the camera.

**The follow camera checks this for you in development.** While the subject
moves, `stepFollow` compares the yaw it was given with the direction the
subject is travelling. A sixth of a turn apart for a whole second prints one
console warning that names the adapter. It reads only the numbers it was
already handed, retires after half a minute of agreement, and a production
bundle (`NODE_ENV` of `production`) never runs it. A subject that really does
move against its heading is the exception: mark those frames with
`reversing: true` on the target (a vehicle in reverse), or switch the check
off with `followState({ headingCheck: false })` (a character that strafes).

## A third-person follow camera

`follow.js` is a whole follow camera in one function, for a game that is not a
racer: a target pose and a collision question in, an eye and a look point out.
The yaw catches up faster the further behind it is, speed pulls the lens back,
and a guard keeps the lens out of geometry and out of the subject's head by
swinging around it, then pulling in, then climbing. It imports no three and
reads no clock, so the same inputs give the same camera on every machine.

```ts
import { followState, stepFollow, type FollowTuning } from '@homie-rocks/camera/follow.js';

const tuning: FollowTuning = { // every number is yours; none has a default
  dist: 6, distSpeed: 3, speedFull: 12, distTau: 0.4, height: 1.6, lookUp: 1.0,
  yawTau: 0.5, yawTauHard: 0.12, hardTurn: 1.2,
  lensRadius: 0.4, headRadius: 1.2, probeStep: 0.2,
  swingStep: Math.PI / 12, swingMax: Math.PI / 3, climbMax: 4, guardIn: 0.05, guardOut: 0.6,
};
const rig = followState();
// Clearance in metres at a ground point, negative inside solid: a signed distance
// field is this already; wrap a yes/no query with fieldFromBlocked().
const field = (x: number, z: number) => level.distanceToWall(x, z);

function lateUpdate(dt: number): void {
  // yaw: 0 faces +Z, positive turns toward +X, radians. Anything else goes through heading.js first.
  stepFollow(rig, tuning, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, speed: p.speed }, field, dt);
  camera.position.set(rig.eyeX, rig.eyeY, rig.eyeZ);
  camera.lookAt(rig.lookX, rig.lookY, rig.lookZ);
}
```

`rig.guard` says which of `clear`, `swing`, `pull` or `climb` it is using. Call
`cutFollow(rig)` on a respawn so the next frame snaps instead of easing across
the level. The guard holds as long as the subject itself has `lensRadius` of
room; with none at all the lens ends directly overhead.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
