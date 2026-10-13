# Physics bridge calibration, 0.48.0

Measured on macOS arm64, Node v22.23.3, 2026-10-13. Reproduce with
`node scripts/calibrate-rules-physics.mjs /tmp/physics-calibration.json`.
Nine CPU-time batches of 10,000 calls follow 2,000 warmup calls. The reported
median establishes charges against the kernel's existing roughly 12 ns/unit
scale; maximum batch values remain in the JSON receipt to show scheduling/GC
variation. These timings are not CI thresholds or Cloudflare capacity claims.

Physics uses Octree Arena's real 1,754-triangle level. Kernel equivalents use
one box: the kernel does **not** represent an arbitrary GLB triangle mesh, and
there is no kernel solver step. These columns compare operation cost, not equal
collision geometry.

| Operation | Physics median µs | Kernel median µs | Kernel units | Physics units |
| --- | ---: | ---: | ---: | ---: |
| Capsule sweep/cast | 8.442 | 1.151 | 92 | 768 per cast |
| Ray | 2.204 | 1.705 | 152 | 640 |
| Overlap | 3.425 | 0.248 | 32 | 640 |
| Static-world solver step, 1/300 s | 6.078 | — | — | 2,400 + 8/call |

A rules capsule sweep pays 64 additional units for copying its pose and velocity,
and invokes at most four metered casts. A larger mesh multiplies engine charges
by `ceil(triangles/1754)`. There is no new default limit. Existing nonphysics
movement and query charges are unchanged.

Raw receipt: [physics-048-calibration.json](receipts/physics-048-calibration.json).
The cross-runtime release test is `packages/studio/test/physics-rules.test.mjs`:
220 seeded virtual ticks, eight capsules integrated at 300 Hz, complete room
hashes compared in Node, Chrome and workerd, with a mid-fall checkpoint and 216
identical continuation ticks. Peak usage was 48,136 handler units and 261,363
tick units out of 500,000, without errors, budget stops or cut ticks.
Prediction/loss coverage is in
`packages/studio/test/physics-prediction.test.mjs`.

The reproducible real two-player trial is `scripts/prove-physics-arena.mjs`.
It copies the source game to `/tmp`, builds guarded server rules and a real-level
Three.js view, drives two actual Chrome keyboards, records frame samples and
screenshots, and records handler/tick units, corrections and input latency.
Its source studio is never written. The trial is evidence for this collision
world and movement; it is not a complete port of the arena's weapons or scoring.

## Two real Chrome players

Receipt: [physics-048-chrome.json](receipts/physics-048-chrome.json).
Both isolated Chrome contexts rendered the GLB, walked with keyboard input, and
jumped. After a 12-second connection/clock warmup, the measured interval was
5.9 seconds of walking, jumping and settling. No loss or jitter was added to
these two trials; the release test separately uses seeded loss and jitter.
Latency measures keyboard input to the first predicted horizontal motion for a
walk, or positive vertical motion for a jump from the ground; each player has
two walk samples and one jump sample.

| One-way delay | Peak handler / tick units | Player 1 corrections / maximum | Player 2 corrections / maximum | Input-to-motion samples, both players |
| --- | ---: | ---: | ---: | --- |
| 0 ms | 48,136 / 111,653 | 0 / 0 m | 0 / 0 m | 9.1–14.0 ms |
| 150 ms | 48,136 / 109,349 | 0 / 0 m | 0 / 0 m | 4.9–16.1 ms |

No handler errors, budget stops, cut ticks or snaps occurred. Screenshots and all
frame samples remain in `/tmp/homie-physics-arena-0BQfxe`. The script takes a fresh
source copy and produces its own persistent `/tmp` receipt when rerun.
