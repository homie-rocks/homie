# Owner runner performance round — 14 October 2026

**NOT READY: validation blocked by the quiet-machine requirement.** Toolkit base / PR #116 head is `28a561ac`; studio base is `1d62525`. Changes remain uncommitted in both worktrees. No version bump, merge, real-studio deployment, or publication occurred.

The final browser batch waited from approximately 20:44 to 21:04 America/Vancouver. Every recorded check exceeded load 8; the gate exited after 20 minutes, at load 60.04. Preparation temporarily paused the gate during tests/builds so it could not start a measurement alongside them. The wait limit was not reset. The request to pause other jobs received no reply. Only this task's processes were stopped.

## Completed evidence

Detached live control: studio `75b280c`, built independently in `/tmp/owner-perf-live`. Isolated branch and control bundles, scripts, profiles, gate logs and raw results are in `/tmp/owner-perf-round`. The original pt6 harness was not changed. Profiles used real GPU Chrome, CDP CPU profiling and 4× CPU throttling, with actual touch controls. The cloud harness copy adds an autopilot for the otherwise idle first player and per-player connection/traffic receipts.

| Item | Branch | Control | Interpretation |
| --- | ---: | ---: | --- |
| Initial 45-second phone profile, before this round's changes | 6 / 2,729 frames >33 ms | 0 / 2,734 | Baseline only; not a final phone result |
| Same profiles: garbage collection | 183.56 ms | 60.523 ms | Profile evidence for reducing allocation |
| Final 64-report burst, median process CPU | 0.706 ms | 0.816 ms | Current all-path rules versus older `9240a05` contact rules on the same core |
| Same burst: p95 process CPU | 4.603 ms | 5.516 ms | 20 warmups, 100 measured samples per variant |
| Same burst: peak metered tick units | 46,872 | 39,317 | All accepted paths remain checked |
| Rejected honest reports / rule errors | 0 / 0 | 0 / 0 | Both CPU fixtures |

The CPU comparison is **not** a server-versus-live-browser-host CPU comparison. It follows the prior report's focused contact fixture. It started at load 7.95, without a concurrent build. Results are one sequential comparison, not six alternating pairs or a statistical performance guarantee. An earlier spatial-query timing run overlapped a build and is explicitly excluded (`host-cost-spatial.INVALID`). The earlier no-broad-phase experiment measured 0.972 versus 0.729 ms median CPU.

The original phone attempt failed before gameplay because its generated room name exceeded the limit. That failure is retained. Both successful baseline profiles started below load 8; load rose during them. Their source maps identify presentation, entity wrapping, prediction and report flushing as substantial additional work.

## Changes awaiting final performance validation

- Server callbacks retain backlog and process at most four ticks per slice, yielding after 8 ms on advancing clocks. Ephemeral rooms coalesce intermediate snapshots; events remain ordered and persistent rooms retain per-tick commits.
- Scheduler gaps no longer count as execution overrun. Sustained execution requires multiple slow observations; a single suspension inside a tick cannot end the room. Budget and fault guards remain. Deployed Workers freeze clocks within a turn, so instruction metering/fault guards bound runaway work there; this is not a claim of measured Cloudflare CPU time. See [Cloudflare timing](https://developers.cloudflare.com/workers/runtime-apis/performance/).
- Contact queries use conservative spatial bounds covering all eight accepted reports plus monster history. This narrows candidate runners before exact substep checks; it does not introduce a new general-purpose spatial index. Patrol selection moves outside the three-substep loop and redundant pose allocations are removed.
- With no newly accepted movement, contacts use the runner's stationary endpoint against current monsters. Old intermediate substeps are not replayed as new contacts. The 150 ms cap remains for accepted paths.
- Validated owners avoid reconciliation-history copies, replay-cache JSON keys and redundant report signatures. Redundant reports cache their encoded payload sizes. Remote entity presentation is shared within an animation frame and invalidated by new snapshots.
- Substep presentation avoids constructing whole-tick interpolation that it immediately overwrites, repeated forecast wrappers, and unused zero-offset vectors. Contact prediction reuses each monster's deterministic trail across previews and the committed step.

## Checks

- Toolkit TypeScript build passed before the final small overrun-condition change; that change was compiled and exercised by the six final host checks.
- Host / production-adapter suites: **52/52**. Subsequently added in-tick suspension test and focused overrun selection: **6/6**. These overlap and are not summed.
- Final studio suite after spatial-query changes: **40/40**; strict game build passed.
- Final owner/substep/presentation selection after removing redundant interpolation: **14/14**. Earlier presentation/owner selection passed **23/23**, plus remote frame-cache checks; these overlap.
- Tests preserve intermediate gold crossings and side catches, and prove that a silent owner's old substeps do not create new contacts. Patrol-cache tests cover repeated previews, backward reads and rebirths.

## Remaining gates

1. **Phone:** no completed post-change 180-second pair. The previous report's 22 versus 10 frames over 33 ms is not superseded by a passing result.
2. **Cloudflare:** temporary Workers `homie-arcade-runner-1014-perf-test` and `homie-arcade-live-1014-perf-test` were deployed with isolated Durable Objects, no production routes, and no real-studio database or AI binding. The eight-player, ten-minute trials did **not** start. There is no result about whether the guard fires on Cloudflare. Both Workers are deleted during cleanup; receipts are in the scratch folder.
3. **Zero-delay jump:** not remeasured; the previous 30.7 versus 24.8 ms p90 regression remains unresolved quantitatively. Reduced input/presentation work is not proof of a latency fix.
4. **Catches without a nearby monster:** the stale-substep defect is covered by a behavioral test, but no new five-trial comparison completed. The previous 17 versus 12 result is not superseded.

Resume with a sustained quiet window, synchronize the final toolkit host/view sources into the isolated build, rebuild, and run one matched pair at a time. The last in-tick suspension guard change is newer than the deleted temporary deployment. Recreate test Workers only for the load test and delete them afterward. Do not publish or deploy the real studio. Commit/push only after reviewing the remaining gates; this report does not declare the branch ready.
