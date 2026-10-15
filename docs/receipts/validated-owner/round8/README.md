# Round 8 checkpoint — acceptance incomplete

Continuation from toolkit `7f0713ef` and studio `924076a`. **Do not treat this receipt as a completed side-by-side proof.** The code and profiles are checkpointed; the required full matrix and 180-second phone acceptance remain unfinished because qualifying load windows have not held. Benchmark processes and both task-owned dev servers were stopped at this checkpoint. No unrelated processes were stopped.

## Code under test

Validated toolkit code: `b24b05b986c1f98004a1c49b313d227c7cf31cef` (runtime changes through `fad5a2df`). Studio: `476bc4f`, published 0.53.0 plus its checked-in overlay. Frozen runtime: `56c84785233d06a5aaacf28c`. No new release version or deployment.

- Remote validated runners and patrols use one buffered simulation timeline, based on accepted report ticks. Placement history survives until the displayed scene reaches its revision boundary. Local input remains immediate; speculative contact confirmation follows the displayed scene and matching revision.
- Packet packing selects reports within the unchanged byte budget before allocating final rows, preserving priority for missing receipts and metadata.
- Large stall backlogs drain faster while actual sampled travel remains bounded. This avoids replaying a long stationary tail after the server resumes.
- Confirmed stationary sources no longer constrain the shared clock. A delayed idle participant previously froze unrelated fresh movement. The regression reproduced only 0.24 tiles of movement in 2.88 seconds; the fix checks continued movement, patrol alignment, bounded drawing and the idle source returning to motion.
- Compatibility fixes retain extra scene history only for validated-owner rooms, virtualize the document animation timeline in Lab, and cover the typed movement/confirmation public surface.

## Completed checks

[CI 38783038496](https://github.com/homie-rocks/homie/actions/runs/38783038496) passes on `b24b05b9`: 26 successful jobs, one skipped. Main's CI/test-fixture maintenance was merged without changing the measured runtime. Earlier full CI on `49791727` passed all 43 jobs before that CI restructuring.

All eight focused timeline, placement and recovery tests pass, including the idle-source regression; the returning idle player's drawing is separately checked. The strict studio build passed 18,000 ticks and 813 save/restore comparisons. All 12 patched installed source files match the toolkit (`overlay-check-latest.json`). Earlier full local checks passed 313 view tests, 19 owner tests and 44 studio tests; subsequent CI includes the updated view suite.

## Profiling evidence — not phone acceptance

CPU×4 Chrome traces and sampled allocations identified avoidable packet-packing churn. Sampled `flush` allocations fell from 21,943,308 bytes (`p3`) to 1,606,256 bytes (`p41`), about 93%. The old `p41` exporter kept sampling during trace export, extending that nominal 60-second capture to about 67 seconds; these totals are not equal-duration allocation rates. The current harness captures the measurement record before exporting.

The paired `p41` diagnostic had candidate/live frames >33 ms **15/15**, >50 ms **6/5**, p99 **24.7/22.6 ms**, at peak load 23.416. This does not replace the requested unprofiled 180-second proof. No qualifying 180-second phone result was obtained. Before/after CPU traces, allocation profiles and mapped summaries are included.

## Load-qualified browser diagnostics before the idle-source fix

These four pairs use runtime code `49791727`. They establish findings and failures, **not acceptance of `fad5a2df`/`b24b05b9`**. Candidate/live order throughout. Overlap counts include shallow and deep passes; contact opportunities are shown because the paths differ. Original analyzers and their raw outputs are preserved.

| Case | Seconds | Peak load | Observer >3-tile non-spawn jumps | Observer overlap passes / opportunities | Deep passes | Stomp reappearances / eligible disappearances |
|---|---:|---:|---:|---|---:|---|
| `vn150h`: host, 150 ms, 3% loss, 50 ms jitter | 180.9 | 11.6748 | 0 / 0 | 2/2 vs 0/0 | 2 / 0 | 0/2 vs 0/1 |
| `vs4r2`: non-host, 80 ms, 1% loss, three 3-second worker pauses | 100.8 | 16.4204 | 0 / 2 | 3/5 vs 1/1 | 1 / 0 | 0/1 vs 0/0 |
| `vn0nr1`: non-host, zero added latency/loss | 180.7 | 14.6973 | 1 / 11 | 2/3 vs 3/4 | 0 / 1 | 0/2 vs 0/4 |
| `vn80hr1`: host, 80 ms, 1% loss, 30 ms jitter | 180.9 | 15.3198 | 1 / 0 | 6/11 vs 4/4 | 4 / 0 | 0/3 vs 0/1 |

`vs4r2` recovery after each deliberate pause: first motion **60/191, 61/557, 140/254 ms**; post-resume moving-owner freezes **0/0**; owner non-placement snap-backs **0/0**. Whole-run freezes during the intentional pauses remain in the raw report. The earlier `s4` diagnostic on `0a378b49` had a 1,190 ms post-resume freeze; its targeted reproduction was 1,136 ms before the backlog fix.

`vn0nr1` exposed the next defect: the scene stayed at tick 1193 for about six seconds while fresh owner motion continued. This led to the idle-source regression and fix. The whole-run freeze detector can also include intervals when the owner was standing still before moving again; its unchanged output is retained rather than silently reclassified. The host overlap results do not establish an improvement and require fresh testing.

Stomp samples total only eight eligible candidate disappearances and six live disappearances across these four diagnostics. Zero reappearances with that small exposure is insufficient acceptance.

## Latest-revision attempts and remaining work

The current-runtime `zn0n` and `zs4` attempts crossed load 25 and were excluded in full. `zf8` and `zft` were deferred without launching; `zn0h` was still waiting when the checkpoint stopped the queue. **There is no qualifying browser pair on the latest runtime.** Earlier rejected attempts are retained in `batch.log` and diagnostics. No run above 25 contributes to acceptance.

Still required: rerun the corrected host/non-host overlap and >3-tile-jump comparisons; accumulate sufficient stomp/contact opportunities; repeat deliberate 3-, 6- and 15-second authority stalls; lag switch; all 0/80/150/300 ms loss/jitter cases; 2–8 players; 1% fast clock; repeated 180-second CPU×4 phone pairs and a 180-second trace. `campaign3-plan.json` records the pending matrix. The latest stricter launch gates are 15 normally, 12 for crowds, and 8 for phone; every pair is rejected if load exceeds 25 at any point from launch through completion.

## Measurement and artifacts

Candidate and detached live control run concurrently in real GPU Chrome (ANGLE Metal, Apple M4), with a shared measurement-start barrier and frozen runtime/assets. Live control remains detached studio `038fdb0`, published 0.53.0. Loss models TCP retransmission delay with FIFO delivery; jitter and delay are per direction. Server stalls use explicit SIGSTOP/SIGCONT on verified task-owned workers; authority comparisons freeze the live browser host separately.

The supplied pt7 tools are retained with necessary measurement corrections: live replicas' monster coordinates now use the actual `room.net.sample()` interpolation instead of newest `room.fast()` state; observer records include scene-clock readings; and fast-clock recordings use real elapsed time independently of the intentionally accelerated game clock (frames, painted positions, keys and event times). Old round-7 monster-read counts must not be silently pooled with the corrected comparison.

`qualified/` contains the four pre-idle-fix load-qualified pairs, manifests, frame data and analyzer output. `harness/` contains the exact SHA-256-matched harness versions referenced by those manifests. Root scripts are the latest resumable harness. They contain task-local paths and owned server-parent PIDs; recreate/verify the owned frozen dev servers and update those PIDs before resuming. Never reuse a PID without checking its command and ancestry. Profiling summaries were mapped against their original bundles, not a later rebuild.
