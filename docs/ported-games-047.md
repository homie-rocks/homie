# Ported-game capabilities in 0.47.0

This release takes the explicitly allowed first slice: wrapped worlds and generated
collision maps. It does not claim to finish the three game ports. Source studios
were read only; the integration scaffolds live beside their original files in
`/tmp` copies.

## Choice: a room map, with live entities for independently moving objects

A maze of hundreds or thousands of cells is one immutable indexed map revision.
Representing each wall as an entity would consume entity slots, handler/state and
collision-delivery work for objects that never move independently. Horizontal
solid runs compile into the existing BVH and collision kernel. A replacement
publishes at the next tick and contains compact data, not the compiled index.
Both the current and a pending map survive saves and late joins. Each browser
compiles a revision once and chooses it by the movement tick during replay.

Distance and next-step tables come from `packages/nav/src/Flow.ts`, shipped into the
standalone toolkit by `scripts/studio-nav.mjs`. The existing nav grid provides
8-neighbour A*/JPS; this dependency-free cardinal multi-source baker adds the
four-neighbour, periodic distance/flow operation needed by tile games. The release
gate checks the vendored source is identical and tests it against an independent
shortest-path oracle. There is no second rules-only pathfinding algorithm.

Flow goals are part of the map data. A moving target can require a new field;
publishing changed goals is a charged bake, not a free search. Games should share
fields between hunters chasing the same goals and rebake only when goals change.

## API

```ts
// map/main.json: periods come from the map's bounds.
{ bounds: {min:[0,0,0], max:[25,25,10]}, wrap: {x:true} }

// Room handlers only. Validates/bakes before publication; active next tick.
world.map.replace({ bounds, wrap, tiles: {
  width:25, height:25, size:1, data:cells, flows:{home:[487]}
}, spots });

// Available to rules and shared movement. Coordinates are integer cells.
ctx.map.tile(x,y);                 // 0 open, nonzero solid
ctx.map.distance('home',x,y);      // cardinal hops, -1 unreachable
ctx.map.flow('home',x,y);          // direction, zero at goal, undefined unreachable
room.map.tiles;                   // readonly drawing data
room.map.wrap;                    // optional per-axis [min,max] periods
```

Wrapping is per axis. Bone Burglar's only open border is its tunnel row, so the
remaining solid border cells prevent crossing elsewhere. Sweeps/rays follow the
supplied displacement through periodic images; proximity, interpolation and
spatial delivery use minimum-image distances. Static maps without new declarations
retain their existing budget charges. No studio budget is silently raised.

## Measured proofs

`node scripts/prove-ported-maps.mjs /path/to/arcade-studio` copies Asteroids Arena
and Bone Burglar into a new `/tmp/homie-ported-maps-*` directory, builds guarded
proof scaffolds against this checkout, and runs two independent Chrome contexts
against a real local WebSocket relay and authoritative rules host. It saves JSON
receipts and screenshots there. It never edits the source studio or deploys.

Local run on macOS, 20 Hz:

| Proof | Result | Peak handler / tick units |
|---|---|---|
| Asteroids' original 1200×840 field, 30 ms movement unit, 266.667 px/s speed cap, original ship/rock outlines and four moving rocks | Both players see each other across x=0; seam crossing in 67 drawn frames, largest minimum-image step 7.672 px | 167 / 1,108 |
| Bone Burglar's actual 625-cell maze algorithm, using the rules' seeded random source | Wall stop x=9.201; 125 cells change during the same round; both views receive the replacement | 59,935 / 66,185 |
| Actual Bone generator on virtual time, normal and 300 ms delay + 12% loss, seed 4725 | First wall at cell 8, regenerated wall at cell 6; correct stops, flow lookup and exact restore | 59,941 / 66,286 |
| Synthetic 64×48 maze, eight players, repeated replacement | 3,072 cells; no errors, budget stops or cut ticks | 170,323 / 199,440 |

The 3,072-cell test explicitly declares a 1,000,000-unit tick budget (250,000 per
handler); it does **not** fit the default 125,000-unit handler allowance. The actual
Bone map fits the default 500,000-unit tick budget. Units are deterministic work
charges, not CPU milliseconds or a Cloudflare capacity claim.

The Asteroids scaffold proves the world blocker, not combat or a full gameplay
rewrite. The Bone scaffold preserves the maze algorithm, not the old PRNG's exact
seed-to-maze mapping, hunt AI or scoring. Its proof reads the old source only from
the copy. The source studios and their saves remain unchanged.

Release tests include:

- `rules-view.test.mjs`: seeded two-view 2D/3D seam, interest, prediction and restore
  cases; generated collision and mid-round replacement, with delay/loss.
- `rules-maps.test.mjs`: casts, overlaps, multi-period travel, atomic rejection,
  pending/current restore, 3,072 cells/eight players, and typed room-only replacement.
- 240 seeded ticks with eight players, repeated generation and restore, comparing
  every save and snapshot byte-for-byte in Node, Chrome and workerd.
- `rules-interest.test.mjs`: canonical wrapped coasting and nonintegral
  period-to-cell-size spatial queries.
- Nav flow oracle, metering and source-parity tests.

## Explicit follow-up work

1. **Triangle meshes and substeps:** bake Octree Arena's actual 1,754 triangles;
   implement capsule/sphere sweep, overlap, support and rays; add a public,
   metered substep facility and correct within-tick drawing/input semantics;
   measure eight players at the original 300 substeps/s. The Rapier-versus-kernel
   decision is **not settled** by this release. These changes reuse the existing
   rules kernel for boxes/round shapes/terrain only; no third collision engine was
   introduced. A synchronous budgeted Rapier bridge versus a kernel mesh primitive
   still needs a measured comparison before choosing.
2. **Assisted rewrite:** the non-destructive `homie-studio` command, port/netplay
   source analysis, pulse/held input scaffold, entity/round declarations, drawing
   adapter, save import with cutoff, seeded tests and decision checklist. Prove it
   on one unmoved game from each studio. No rewrite command or save migration is
   claimed here.
3. **Remaining gap-report requests:** timed pulse payloads and late-input context;
   clock/round coherence; deterministic remote-entity prediction; ordered commands;
   baseline comparison tooling; prediction-effect typing/matching; result
   eligibility/tie policy; bot slots/trimming; body-free players; leave-to-bot without
   a redundant thinker; a toolkit TS loader; incremental single-game site builds;
   save import/export/migration APIs; 2D vector-loss diagnostics; and further
   terrain/query performance work. This slice adds tile access, dispatch coverage
   and the named re-export/spawn-initialization guidance, not those other changes.
