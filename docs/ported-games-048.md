# Historical 0.48.0 handoff at e58e644e

This is the pre-bridge handoff. The subsequent physics implementation, calibration
and real two-player evidence are in [physics-048-calibration.md](physics-048-calibration.md).
Navigation documentation and the assisted rewrite command remain separate jobs.

Branch `ported-games-2` was cut from `origin/main` after fetching and confirming
studio 0.47.0. PR #93 was **open** at the start; its publication/version changes
were not duplicated. No studio source folder was written. No merge or deployment
was performed.

## Implemented and tested locally

### Existing provider credentials (F)

Doctor/setup status, media availability and plugin media scripts share a lookup:

1. `FAL_KEY` / `ELEVENLABS_API_KEY`.
2. `~/.homie/keys/fal-key` / `~/.homie/keys/elevenlabs-key`.
3. Legacy `~/.homie/workspace/fal-key` / `~/.homie/workspace/elevenlabs-key`.

Files contain one plain key, optionally followed by a newline. The resolver does
not mutate the environment or copy the key into a studio. Diagnostics expose the
source, never the value. ElevenLabs retains CLI sign-in and Stripe Projects
support. This machine's existing fal file was found at the legacy path without
printing its contents.

Passed: 11 onboarding tests, the new provider-discovery test (including status
redaction and precedence), and 17 art/video/music/models/Stripe plugin tests.

### First-class movement substeps (B, pending full acceptance)

```ts
ctx.substeps(body, 300, step => {
  // step: {dt, index, count, first, fraction}
  if (step.first && input.jump) { /* one impulse this tick */ }
  ctx.map.sweep(body, ctx.math.scale(body.vel, step.dt));
});
```

The rate is an integer multiple of the room rate. All callbacks share the
existing movement-handler budget. Charge: 8 plus 64 per recorded pose (initial
pose plus each substep), then normal guarded callback/query work. No new default
rate cap or quota. Existing games do not opt in automatically.

The view uses the substep poses instead of a straight line between tick endpoints.
The temporary trace adds no wire/save fields. Final body state and declared
motion remain the saved state. Inputs retain tick-mean held semantics; `first`
allows a pulse to be consumed once. This does not reconstruct input timestamps.
Stormbreak was not edited.

Local tests:

- Eight players, 300 Hz inside 20 Hz, 100 seeded ticks and restored continuation:
  peak tick **20,152** units, peak handler **2,479**, no budget stops/errors.
  This uses existing primitive collision, **not the Octree mesh**.
- The existing 240-test rules-view suite passed.
- An additional seeded virtual-time two-view test passed with 150 ms each way:
  an out-and-back trajectory with identical tick endpoints is drawn within the
  tick. This is **not** the requested two-real-Chrome-player mesh trial.
- Invalid rates and pre-allocation budget rejection passed. The existing ten map
  tests passed. Guides were regenerated and their parity check passed.

## Preliminary physics evidence (A is not delivered)

`scripts/measure-ported-physics.mjs <octree-game-folder>` and
`scripts/probe-ported-physics-runtimes.mjs <octree-game-folder>` copy the game into
`/tmp`, bake its GLB with the new build-time helper, and use the actual physics
package. The helper applies node hierarchy transforms, reflected winding and the
Y-up to Z-up rotation; its synthetic GLB transform/rejection test passes.
It is **not yet connected to homie-studio build**.

The cross-runtime probe completed on the real **1,754-triangle** mesh:

- **8 capsules, 300 substeps/s, 20 outer ticks/s, 200 ticks**.
- **200 full-snapshot SHA-256 hashes agree across Node, Chrome and workerd**.
- Checkpoint after tick 4 while all capsules are falling; each runtime's restored
  world agrees byte-for-byte for the next **196 ticks**.
- Final snapshot: **216,056 bytes**. Full receipt is
  `ported-games-048-physics.json`; original local output is
  `/tmp/homie-048-runtimes-Fp7UmK/receipt.json`.

These are physics-package probes, not guarded rules games. The controller is the
package's controller, not a demonstrated reproduction of the original Octree
depenetration movement. No physics bridge, query/step budget calibration or real
multiplayer prediction result is claimed.

Early timings varied materially on this shared machine. The first 200-tick wall
clock sample averaged 6.14 ms (p95 8.10 ms); a later CPU sample with restoration
running alongside averaged 8.46 ms (p95 27.07 ms). A preliminary fixed-position
query loop measured roughly 3–4 microseconds/query. None is a calibrated
physics-versus-kernel comparison or evidence that rules' default budget fits.
No kernel fallback was implemented. The owner's choice to use the physics
package remains the requirement.

## Work still required before the requested release

1. A: integrate async initialization, synchronous metered queries/steps, room
   saves/restores and prediction with the actual physics package. Connect the
   GLB bake. Measure against kernel work; fix package performance if necessary.
   Add deterministic gate coverage and the real two-player Chrome trial with
   150 ms each way. The standalone cross-runtime probe is only supporting evidence.
2. Complete B acceptance on that real mesh and check input/drawing semantics with
   the original game. Do not edit Stormbreak.
3. C/D: the rules navigation/crowd API and example, Stormbreak migration analysis,
   and substantive nav/physics authoring sections. Only the new substep guide
   section and credential instructions have been written.
4. E: assisted rewrite command/skill and both required source-copy proofs.
5. Version 0.48.0, changelog, all required generation, the full root `npm test`
   once in the background, push, PR and six green checks.

No version bump, full root test, push or pull request has been performed. This is
not the allowed A+B+F release slice yet; A is still missing.
