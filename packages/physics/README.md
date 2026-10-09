# @homie-rocks/physics

Deterministic 3D rigid bodies, upright characters, spatial queries and complete
simulation saves for browsers, Node and Cloudflare Workers. The package owns
Rapier 0.21.0 and exposes plain vectors, quaternions and stable integer handles.
Rendering, input devices and networking stay with the game or app. The core requires no game manifest or room; apps can import the same modules.

Part of Homie's optional engine packages; existing studios gain no dependency. Distances are metres, time is seconds, mass is
kilograms. Worlds are right-handed and support Y-up or Z-up.

## Install

The first npm publication requires a maintainer. After merge, follow the repository’s `scripts/first-publish.sh` procedure to publish 0.1.0 once and register its trusted publisher. The release workflow reports and defers new packages without blocking independent packages. Until then, build and pack `packages/physics` and install that tarball locally. After bootstrap:

```sh
npm install --save-exact @homie-rocks/physics@0.1.0
```

The optional `Three.js` module needs `three@0.185.1`. The core does not import it.

## Use

```ts
import { initPhysics } from "@homie-rocks/physics/Engine.js";
import { createWorld, seeded } from "@homie-rocks/physics/World.js";

await initPhysics();
const world = createWorld({ up: "y", random: seeded(42), killPlane: -100 });
const floor = world.createBody({
  type: "static",
  position: { x: 0, y: -0.5, z: 0 },
  colliders: [
    { shape: { kind: "box", halfExtents: { x: 20, y: 0.5, z: 20 } } },
  ],
});
const ball = world.createBody({
  type: "dynamic",
  mass: 2,
  position: { x: 0, y: 3, z: 0 },
  ccd: true,
  colliders: [{ shape: { kind: "sphere", radius: 0.3 } }],
});

world.impulse(ball, { x: 2, y: 3, z: 0 }); // Momentum in kg·m/s.
const events = world.step(1 / 20); // Three fixed 1/60-second solver steps.
const pose = world.bodyState(ball);
const save = world.snapshot();
world.restore(save);
world.dispose();
```

`step(dt)` retains fractional time. The default fixed step is 1/60 second and
`maxSubsteps` is eight. Excessive catch-up is rejected before changing the world.
Kinematic targets interpolate by elapsed time, including outer rates such as
24, 50 and 120 Hz. Keep commands and entity creation order identical for replay.

`seeded(n)` copies a uint32 seed into the world; `world.random()` advances its
saved generator. Simulation steps do not use a wall clock or platform-dependent
transcendental functions. Bitwise replay requires the same package, engine,
fixed timestep and commands. Tests compare Node, workerd and JavaScriptCore
snapshots and exercise a studio-built browser. Game commands must also avoid platform-dependent `Math` transcendental results; their last bits can differ between runtimes.

## Loading

Browser bundles and Node can call `initPhysics()` without an argument. It loads
an embedded base64 copy of the pinned WASM. Alternatively pass a compiled
`WebAssembly.Module`, bytes, a `Response`, URL or string URL. `wasmURL()` resolves
the separate asset for explicit Node/file or browser loading. Response loading
currently buffers the bytes before compilation; it does not stream compilation.

Workers must use the separate entry, which cannot reach the embedded copy:

```ts
import wasm from "@homie-rocks/physics/vendor/rapier.wasm";
import { initPhysics, createWorld } from "@homie-rocks/physics/Worker.js";
await initPhysics(wasm);
const world = createWorld({ up: "z" });
```

Add this to the Worker's Wrangler configuration:

```json
{
  "rules": [
    { "type": "CompiledWasm", "globs": ["**/*.wasm"], "fallthrough": true }
  ]
}
```

For Durable Objects, initialize the module once per isolate and own one world
per room. Store `snapshotChunks()` under a new generation, then atomically
publish the generation and chunk count. Read that generation's ordered chunks
and call `restoreChunks()` when the object resumes.

Measured minified esbuild shipping sizes, including the adapter:

| Asset                               |     Bytes | gzip bytes |
| ----------------------------------- | --------: | ---------: |
| Separate WASM                       | 3,105,893 |  1,180,561 |
| Embedded base64 JS asset            | 4,141,211 |  1,611,101 |
| Browser JS, including embedded WASM | 4,454,309 |  1,679,034 |
| Worker JS, excluding separate WASM  |   312,713 |     67,360 |

The package tarball is about 3.02 MB, unpacked 8.58 MB (decimal units).
The separate WASM is 855,167 bytes with Brotli; the embedded asset is 1,169,204. Its base64 text is already
encoded binary; JS minification cannot substantially reduce it. Size scanners
may flag that chunk as unminified. Explicit asset loading trades the convenience
of embedded bytes for smaller transfer size. Run `node packages/physics/scripts/sizes.mjs`
to reproduce these figures.

## Modules

| Module           | Purpose                                            |
| ---------------- | -------------------------------------------------- |
| `Engine.js`      | Browser and Node initialization and asset URL      |
| `Worker.js`      | Worker initialization with an imported WASM module |
| `World.js`       | Simulation, queries, character controls and saves  |
| `Types.js`       | Public geometry, tuning, state and event types     |
| `Heightfield.js` | Terrain adapters                                   |
| `Three.js`       | Optional render geometry and debug helpers         |

## Bodies and colliders

`createBody` accepts `static`, `dynamic` or position-based `kinematic` bodies.
`createCollider(body, options)` adds compound pieces. Explicit `mass` is the
body's total mass, shared across attached colliders, including later additions.
A dynamic body needs a solid collider with positive density or explicit mass;
explicit-mass bodies may be created empty while their geometry is assembled.
A sensor-only dynamic shape set is rejected at creation. Use static or kinematic sensors.

Shapes are boxes, spheres, upright capsules, convex hulls, static triangle meshes
and static heightfields. Mesh vertices use body-local axes. Collider `position`
and `rotation` are body-local in the world's axes, including terrain offsets.
Capsules and heightfield geometry follow the world's chosen up axis.

Materials expose `friction`, `restitution`, `density`, `sensor`, `layers` and
`impactThreshold`. Layers are two 16-bit masks, `membership` and `filter`; both
membership/filter intersections must be nonzero. `updateCollider` changes
friction, restitution, sensor status and masks. Unchanged masks or sensor flags
preserve existing overlaps; actual changes reconcile eligible contact pairs.

| Operation                                             | Purpose                                    |
| ----------------------------------------------------- | ------------------------------------------ |
| `bodyState`, `colliders`, `hasBody`, `hasCollider`    | Read poses and handle liveness             |
| `setVelocity(body, linear, angular?)`                 | Set dynamic velocity                       |
| `force(body, force, point?)`, `torque`, `clearForces` | Persistent dynamic forces                  |
| `impulse(body, impulse, point?)`                      | One-time momentum change                   |
| `updateBody`                                          | Gravity scale, damping, CCD and axis locks |
| `teleport(body, position, rotation?)`                 | Immediate pose edit without a sweep        |
| `moveKinematic(body, position, rotation?)`            | Target for the next outer tick             |
| `removeBody`, `removeCollider`                        | Remove geometry and close begun pairs      |
| `createJoint`, `removeJoint`, `hasJoint`              | Fixed, ball, hinge and slider constraints  |

Joint anchors and axes are local to their bodies. Hinge/slider limits are optional;
connected bodies do not collide unless `contacts: true` is supplied. Handles are
world-owned integers, shared across body, collider, character and joint kinds.
Check the matching `has…` method before using handles from delayed events.

`sleep(body)` and `wake(body)` control dynamic-body activation. `fixedDt` exposes
the world's solver interval. Build a continuous floor with one collider: abutting
box seams can snag fast rigid bodies and generate impacts. A pair's effective
`impactThreshold` is the lower of its two collider values.

## Characters

```ts
const player = world.createCharacter({
  position: { x: 0, y: 1, z: 0 },
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.35,
  stepMinWidth: 0.05,
  slopeLimit: 0.7,
  snapDistance: 0.35,
  offset: 0.01,
  gravity: 20,
  jumpSpeed: 5,
  acceleration: 30,
  braking: 40,
  airAcceleration: 12,
  pushMass: 80,
});
world.controlCharacter(player, { x: 2, z: 0, jump: false });
world.step(1 / 20);
const state = world.characterState(player);
const position = world.bodyState(state.body).position;
```

Input is desired horizontal velocity in world axes: X/Z for Y-up, X/Y for Z-up.
Jump is a buffered request. `slopeLimit` is in radians. Character centres cannot
spawn inside solid geometry. Character dimensions include both capsule caps.

The controller lives in `src/internal/Character.ts`. One movement path handles
boxes, meshes and heightfields in either up axis. Each fixed substep sweeps the
capsule and slides against contact normals, with an eight-iteration cap. A
walkable normal projects horizontal input onto the surface while retaining its
horizontal speed. Steep surfaces cannot replenish jumping. Ground detection
uses a downward cast of the capsule's lower hemisphere; only a previously
supported character snaps across the configured distance. Casts start outside
the skin and apply that distance to the result, avoiding ambiguous casts from
inside the skin. Landing requires contact, rather than a distant downward ray.

A blocked grounded move tries cast-up, cast-forward, then cast-down. The forward
move is the requested substep displacement. Separate tread probes measure
`stepMinWidth` as tread depth, without adding the capsule radius. `stepHeight`
measures sole-to-tread rise, excluding skin. Headroom and the landing surface
must both be valid. Opposing steep faces can support a character in a valley.

Platform displacement comes only from the supporting body, including rotation
at the character's sole. Kinematic targets are interpolated across fixed
substeps. Side contacts transfer only normal displacement, so a wall sliding
along its face cannot drag its passenger. Four contact passes recover genuine penetration after edits or dynamic contact.
Contact correction resolves moving obstacle targets, and a bounded separation
pass prevents character overlap.
Rapier's built-in character controller is not used. Residual sweeps shorter than
0.1 mm are treated as no movement, and controller query inputs are validated
before reaching the engine. Box queries use nearby geometry so the floor's total
size does not set the query tolerance; meshes and heightfields retain the engine's
acceleration structures.

A moving body that pins a character against another solid for more than one fixed substep sets `crushed`. Character separation never sets it; static geometry limits the correction. Respond with damage, respawn or another game rule. If a press keeps
moving through a pinned character, the impossible vertical overlap is ignored
until separation; it does not turn the press into new ground. Ignoring `crushed`
can therefore let the character fall through that moving body.

`pushMass` is the heaviest dynamic body the character may push, in kilograms;
zero disables pushing. Heavier props remain obstacles. Characters are kinematic
and exert no resting weight on a seesaw. Several small props may slow a character
more than one heavier prop because each adds a separate obstacle. A sill narrower
than `stepMinWidth` remains an obstacle; use a small tread width when door sills
must be crossed. `hasCharacter(id)` tests
liveness and `removeCharacter(id)` removes the controller, body and collider.

The physics API retains its descriptive tuning names, radian `slopeLimit`,
string stances and optional defaults. These are its public contract; games
integrating `@homie-rocks/walk` must explicitly translate their tuning and stance
values rather than treating the two controllers as interchangeable APIs.

Optional tuning:

| Option                     |      Default | Meaning                                                   |
| -------------------------- | -----------: | --------------------------------------------------------- |
| `terminalSpeed`            |           60 | Maximum downward m/s                                      |
| `pushMass`                 |           80 | Maximum pushable body mass in kg                          |
| `coyoteTime`, `jumpBuffer` |     0.1 each | Jump timing windows in seconds                            |
| `acceleration`             |         1000 | Ground acceleration in m/s²                               |
| `braking`                  | acceleration | Ground stopping/reversal acceleration                     |
| `airAcceleration`          |           12 | Air control in m/s²                                       |
| `slideControl`             |          0.2 | Input authority on steep slopes                           |
| `facingResponse`           |           12 | Facing response per second                                |
| `groundGrace`              |          0.1 | Ground continuity across step edges and seams, in seconds |

Air acceleration applies as soon as a jump starts, including a simultaneous
movement and jump request from rest.

`softBoundary: { halfExtent, margin, strength }` adds an optional inward spring
near an origin-centred horizontal boundary. All three values are positive;
margin cannot exceed halfExtent.

`characterState` returns `body`, `collider`, `grounded`, `platform`,
`verticalVelocity`, unit-vector `facing` and `stance` (`planted`, `rising`,
`falling`, `sliding`). `hits`, `crushed`, `jumped`, `landed` and maximum
`landingSpeed` accumulate across the entire outer tick. Jump integration uses
average vertical velocity, preserving the expected ballistic apex at fixed-step
resolution. These controls, timers, signals and inherited momentum are saved.

## Queries and terrain

`raycast(origin, unitDirection, metres, filter?)` returns the nearest boundary or
null. `raycastAll` returns all boundaries sorted by distance and collider handle.
Rays starting inside a solid return its exit with an outward normal.
`castShape(shape, position, displacement, rotation?, filter?)` sweeps a convex
shape and returns a displacement fraction, witness point and obstacle normal.
`overlaps(shape, position, rotation?, filter?)` returns sorted collider handles.
Filters accept layers, excluded body/collider handles and `sensors: true`.

Queries combine the engine index with a spatial hash of pending inserts and
teleports. Only changed entries are refreshed. Material edits do not rebuild
geometry. A simulation step folds pending edits into the engine index. Large
colliders and queries spanning more than 4,096 hash cells use a conservative
fallback scan, so worst-case work still depends on pending geometry.
Terrain rays that miss shared triangle boundaries retry adjacent cells with
0.1 mm local offsets; returned terrain heights at those boundaries have that
sampling tolerance.

`heightfieldGrid`, `centredHeightfield` and `sampleHeightfield` adapt the sibling
heightfield package. Helpers return collider descriptions; their optional final
`up` argument may be omitted: insertion uses the world's axis. An explicit
argument preserves a world-space offset for that axis:

```ts
import { heightfieldGrid } from "@homie-rocks/physics/Heightfield.js";
const terrain = heightfieldGrid(
  {
    nx: 65,
    nz: 65,
    cell: 1,
    x0: -32,
    z0: -32,
    heights: new Float32Array(65 * 65),
  },
  "x-fast",
  "z",
);
const zWorld = createWorld({ up: "z" });
zWorld.createBody({ type: "static", colliders: [terrain] });
const walker = zWorld.createCharacter({
  position: { x: 0, y: 0, z: 1 },
  radius: 0.3,
  height: 1.8,
  stepHeight: 0.35,
  stepMinWidth: 0.05,
  slopeLimit: 0.7,
  snapDistance: 0.35,
  offset: 0.01,
  gravity: 20,
  jumpSpeed: 5,
});
zWorld.controlCharacter(walker, { x: 2, y: 0 });
zWorld.step(1 / 60);
```

Grid samples are X-fast by default; native Z-fast samples avoid a transpose.
The heightfield shape itself uses canonical X/height/second-horizontal-axis
scale. A generic collider's offset always uses the world's axes.

## Events

`step` returns sorted contact/trigger transitions and impacts. Contact pairs
alternate begin/end; removal queues one exit for every open pair. Character
contacts use contact distance with a motion-aware hysteresis band to avoid
flapping while pushing a moving prop. Sensor/filter edits preserve pairs that
remain eligible and reconcile changed pair types.

An `impact` reports the first above-threshold solved force of a new contact
episode as an impulse in kg·m/s. Persistent resting or sliding contact does not
repeat impacts. Use `contactForce(colliderA, colliderB)` to explicitly read the
latest sustained normal force in newtons. No sustained-force events are generated.

Pair events include body/collider handles and a fixed-step `tick`. Contacts and
impacts provide a point, normal and impulse where available; triggers do not.
Impact is not a pair begin/end. `limit` events report body clamping or removal,
with `reason` equal to `velocity-clamped`, `outside-bounds` or
`position-precision`; both body fields identify the affected body.

Event traffic is bounded by eligible pairs and `maxSubsteps`: each pair can have
multiple begin/end transitions in a substep, in the engine's order within that
pair, and one impact per contact episode. Trigger membership is reconciled
against final overlap geometry after each substep. A body's identical limit report is coalesced within the
outer tick. There is no event-count cap that silently discards events.

## Bounds and failures

Default world bounds are ±10,000 metres on every axis. `bounds: { min, max }`
changes them; `bounds: null` disables game bounds. `killPlane` optionally removes
bodies below a height along up. Removal is reported through `limit` events and
closes open pairs. A character removed this way is named by `limit.character`;
subsequent `controlCharacter` calls reject its stale handle. Use `hasCharacter`
before applying input after processing removal. One escaped body does not end the world. Sleeping bodies skip
the active-state safety scan.

Inputs reject unknown keys and non-finite values. General vector components are
limited to ±1,000,000; initial/set linear velocity to ±10,000 m/s and angular
velocity to ±1,000 rad/s. Gravity components are ±1,000 m/s² and gravity scale is
[-100, 100]. Positive scalar geometry starts at 1e-6 metres; mass is
[1e-6, 1e6] kg. Runtime velocities exceeding the velocity limits are clamped and
reported. Large valid forces do not mark a world failed.

Geometry also needs sufficient float32 precision at its world position. For
boxes, spheres and capsules the maximum coordinate is no greater than 131,072
times the smallest half extent or radius, capped at 1,000,000 metres. Meshes and hulls use the smallest nonzero bounding
half extent; heightfields use half a cell width. Creation
and teleport reject shapes outside that envelope; moving bodies that leave it
are removed and reported. Prefer metre-scale geometry near a room's origin.

Each world owns an independent WASM instance of the compiled module. An engine
trap (`WebAssembly.RuntimeError`) marks only that world failed and drops its trapped instance. `dispose()`
remains valid; `restore(lastSave)` creates a fresh instance. Failed memory becomes
eligible for garbage collection, rather than accumulating in a shared solver
heap. Reclamation timing belongs to the host GC. The failure test repeatedly
grows memory, invokes an invalid raw solver handle to trigger a genuine Rapier
WASM trap, and verifies collection
and restoration. This is failure injection, not a guarantee that engine bugs
cannot occur.

Other exceptions propagate while leaving the world usable. A failed call is
not transactional: completed substeps remain applied. Event arrays are appended
iteratively, including dense bursts of coincident bodies.

## Saves

`snapshot()` returns one binary envelope. Version 4 contains checksummed solver
bytes plus compact MessagePack metadata with a shared key dictionary and lossless
negative-zero encoding. It saves handles, solver caches, sleeping bodies, joints,
characters, random state, pending query handles and their dirty flag, pending
commands, bounds, time remainder and open pairs. Previous envelope versions are
rejected before replacement.
There is one envelope version; the metadata records the engine version as a string.

The engine omits pending joint-island connectivity events from serialized bytes.
Body removals and joint changes therefore take effect in the solver at the next
fixed substep. Public handles and queries reflect removals immediately. A save
includes pending structural commands alongside the solver bytes; restoration
applies them at the same substep. Edits do not take snapshots or serialize the
world. Only a requested save pays serialization cost.

**Saves do not cross engine versions.** Loading a 0.17.3 save into this package
refuses with an explicit engine-version error before passing bytes to Rapier.
There is no solver-state migration or undocumented legacy reader. Keep the exact
package available for rooms that must continue an existing engine timeline.

`snapshotChunks(maxBytes = 1900000)` creates ordered views into one saved buffer.
`restoreChunks(chunks)` validates and assembles them. Corruption, missing chunks,
incompatible versions and invalid records are rejected before replacing a healthy
world. Saves are trusted server data; the checksum detects damage and is not
client authentication. Maximum accepted save size is 64 MiB.

## Three.js

`geometryShape` converts a BufferGeometry to mesh or convex collision geometry.
`PhysicsDebug` owns disposable
line buffers from `world.debugLines()`. Import these helpers from
`@homie-rocks/physics/Three.js`; import core types from `Types.js`.

## Measured cost

Apple M4, Node 22.22.2, measured on 2026-10-09. Other sessions kept the
one-minute load average between 10.3 and 12.6. Each result uses process CPU time
(`process.cpuUsage`), excluding time waiting for the scheduler. Suites and
measurements ran one at a time with a 1,536 MiB JavaScript heap limit.

Each tick is `step(0.05)`: a 20 Hz game has 50 ms for physics, rules and networking
together. Tables show median / 95th-percentile CPU milliseconds from 100 ticks
after 150 warm ticks (500 for sleeping scenes). Awake bodies cannot sleep.
The pit starts with five-by-five columns of boxes inside four walls.

| Scene               | Bodies | CPU ms, median / p95 |
| ------------------- | -----: | -------------------: |
| Flat boxes          |    100 |          1.35 / 3.17 |
| Flat boxes          |    500 |          3.37 / 4.91 |
| Flat boxes          |  2,000 |        16.11 / 19.41 |
| Rolling heightfield |    100 |          0.95 / 1.43 |
| Rolling heightfield |    500 |          5.78 / 8.81 |
| Rolling heightfield |  2,000 |        18.48 / 22.96 |
| Pile in a pit       |    100 |          0.70 / 1.08 |
| Pile in a pit       |    500 |          4.17 / 5.50 |
| Pile in a pit       |  2,000 |        35.81 / 69.78 |
| Sleeping boxes      |    100 |          0.05 / 0.06 |
| Sleeping boxes      |    500 |          0.20 / 0.34 |
| Sleeping boxes      |  2,000 |          0.81 / 1.09 |

Characters walk at 2 m/s. Mesh and heightfield cells are one metre across;
increasing their dimensions increases the total collider size. Queries keep the
engine's spatial acceleration structures and inspect nearby geometry. All
characters remained grounded at the end of these measurements.

| Scene                                        | Characters | CPU ms, median / p95 |
| -------------------------------------------- | ---------: | -------------------: |
| Mesh, 20,000 triangles                       |          1 |          0.19 / 0.77 |
| Mesh, 20,000 triangles                       |          4 |          0.52 / 3.30 |
| Mesh, 100,352 triangles                      |          1 |          0.13 / 0.59 |
| Mesh, 100,352 triangles                      |          4 |          0.47 / 0.98 |
| Heightfield, 64 × 64 cells                   |          1 |          0.19 / 0.63 |
| Heightfield, 224 × 224 cells                 |          1 |          0.18 / 0.43 |
| Heightfield, 1,000 × 1,000 cells             |          1 |          0.19 / 0.47 |
| Heightfield, 64 × 64 cells + 500 awake boxes |        100 |        20.08 / 24.88 |
| Box floor                                    |        100 |         7.71 / 12.69 |
| Packed against a wall in a 3.2 m corridor    |         50 |        20.08 / 32.23 |

The 100-character terrain scene with 500 awake bodies used 20.08 ms median and
24.88 ms p95, leaving about half the tick for the rest of the game at p95.
Start with tens of characters and hundreds of awake props, then measure the
complete game on its target hardware. Dense piles can still exceed a tick;
the 2,000-body pit above is unsuitable for a 50 ms budget at p95.

A paired 500-body comparison alternated which world created and removed one
extra body each tick. Over 200 measured ticks per case, the baseline was
3.40 / 4.11 ms and the edit case 3.50 / 4.26 ms: 3.1% extra median CPU time.
Body, character and joint edits do not serialize the world. Their pending solver
commands are saved only when the game requests a snapshot.

Single save/restore samples for 2,000 awake bodies:

| Scene               | Save size | Save CPU ms | Restore CPU ms |
| ------------------- | --------: | ----------: | -------------: |
| Flat boxes          |   3.73 MB |      172.72 |         102.53 |
| Rolling heightfield |   5.39 MB |       84.21 |          77.55 |

Choose save cadence separately from simulation ticks. Pending geometry uses a
spatial hash: queries inspect intersected buckets plus oversized colliders and
fall back to all pending entries when a query spans more than 4,096 buckets.
Dense clusters and very large queries can still cost linear time in pending edits.

From the repository root:

```sh
npm ci
npm run build
CHROME_PATH=/path/to/chrome npm test
npm audit
node --max-old-space-size=1536 packages/physics/scripts/cpu-profile.mjs
CHROME_PATH=/path/to/chrome node --max-old-space-size=1536 packages/physics/scripts/studio-trial.mjs
# The same packed scene through the app manifest and full studio build:
CHROME_PATH=/path/to/chrome node --max-old-space-size=1536 packages/physics/scripts/studio-trial.mjs --app
```

`PHYSICS_SCENES=mesh,terrain,crowd,edits` selects CPU measurement subsets.
The studio trial packs this checkout's toolkit and physics package, scaffolds a
temporary studio, builds a scene and measures real Chrome frames; it deletes the
studio and stops its server and browser afterwards.
The measured scene had a 2,000 m floor, stairs, one character and 20 dynamic
props: Chrome produced 60.00 fps over 599 measured frame intervals, 16.70 ms p95
frame time and 0.60 ms p95 physics wall time, with no page errors (load 9.0).
The runtime tests exercise workerd, a studio-built Chrome game and JavaScriptCore
(on macOS, or via `JSC_PATH`), including a sample of the independent restore attack.
Performance scripts report measurements; CPU tables are not timing assertions.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for the engine attribution.

### Extended verification

`npm test` runs fixed small samples of the scenario and restore sweeps. Run
`npm run test:physics:full` for every axis/rate scenario, 300 restore seeds per
axis, the independent 220-seed attack in both axes, the 1,000-body coincident burst,
and at least one million moving-wall controller queries. Run
`node --max-old-space-size=1536 packages/physics/scripts/cpu-profile.mjs` alone
for CPU tick measurements; it records the machine load with each result.
