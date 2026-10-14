# 2D runner reconciliation — second local proof

Status: local proof complete. The explicit second-run span-count, freeze, latency, solid, snap and outage gates pass. Longer displacement duration and worse individual connection profiles remain documented below. Toolkit PR [#116](https://github.com/homie-rocks/homie/pull/116). No release or deployment.

## Design and recovery policy

The 2D simulation adopts the acknowledged server state and replays pending inputs immediately. Only the difference between the previous drawing and the new prediction becomes a visual offset; exponential decay removes about 99% over `room.predict.blendMs` (default 100 ms). Held direction never gates correction. A collision sweep shortens the offset, and blocked corrections follow collision-free presentation routes. These positions never feed simulation, hits, or score. Outages retain local prediction and server scores; reconnects reconcile the same living body. Server placement metadata preserves the exact spawn origin through delayed/lost snapshots and save/restore.

Large living-body errors use a fast blend bounded by `room.predict.maxFrameM` (default 2.8 body radii; Tiny Platformer uses 1.4 tiles). Only an actual server respawn cuts. There is no error threshold that silently classifies a correction as a respawn. This prioritizes continuity and solid exclusion: a 43-tile recovery necessarily needs at least 31 frames at 1.4 tiles/frame, and terrain can lengthen the route. A universal 300 ms bound for arbitrarily large errors is incompatible with that no-snap requirement. The second-run acceptance compares displacement spans with live under matched load.

Optional `room.predict.renderAheadMs` anticipates a small display interval along the collision-checked predicted path; the default is zero and the maximum is one simulation tick. Tiny Platformer uses 16 ms. Its decay is tuned to 40 ms after the 100 ms short matrix retained 68 displacement spans versus live’s 59, despite eliminating freezes. It crosses a tick boundary by forecasting the next substeps, without advancing simulation or input timestamps. All presentation readers share one browser frame; fresh input invalidates any earlier read.

## What changed after the first run

The first 20-pair matrix failed: 2 held-key freezes / 533 ms versus live's zero, 85 connected displacement spans versus 64, and run-input p90 36–39 ms versus 31–32 ms. It already had zero solid frames, zero oversized non-respawn moves (live 13), and no outage freezes or score resets. [First-run receipts](receipts/runner-error-smoothing/matrix.json) remain unchanged.

Reproduced causes were fixed:

- A moving destination repeatedly discarded an unfinished route search. A wide-platform regression froze for 1,920 ms. Searches now finish against their original goal, with a bounded 128-node budget per frame, and clear waypoints can be skipped rather than consuming a whole frame per grid edge.
- Input could reuse a presentation read before input sampling. Invalidating that cache was necessary but insufficient: actual canvas-paint timing confirmed the remaining latency. A substep fixture reproducing Tiny Platformer's acceleration/integration order showed 8–17 ms before the first visible movement; the optional display forecast reduces it to 1–5 ms. A separate test verifies identical authoritative state and input timing, and a boundary test prevents alternating fast/held frames.
- An intermediate 300 ms / 5% trial froze for 300 ms below a platform despite moving simulation. Its reduced regression froze for 1,392 ms: the route's 0.002-metre endpoint tolerance admitted a grid point 0.0001 m inside the platform's collision margin, then planned the next edge from inside. Rejecting every hit then exposed valid simulation destinations that exactly touch terrain; a second regression froze for 960 ms. Route nodes now store the sweep’s actual safe endpoint, rather than a nominal grid coordinate. This preserves collision margins while reaching valid touching poses. The regression checks continuity, solid exclusion, convergence and no >200 ms stall.

- A five-minute 40 ms trial exposed a 4.68-tile cut after authority was silent for about 17 seconds. The same living body returned after the three-second reconnect classifier had expired. A regression reproduces an 8.63-tile cut; reconnect context now lasts until the first usable authoritative snapshot. A separate new-round regression verifies that a new authoritative round still draws the server-selected spawn, even when a game callback sees the prior round. A shared-global fixture race in the decay comparison was also removed by building its two variants sequentially.

- The next completed reconnect trace revealed a separate 251 ms freeze at (26, 36). The reduced view regression froze for 880 ms. A box leaving an exact corner was falsely reported as a zero-time hit, and float rounding left the drawing two millionths of a tile before a route turn that the proximity rule skipped. Outgoing zero-overlap contacts are now ignored, and waypoint advancement/shortcuts require a clear sweep from the actual drawing. Four corner orientations, inward movement and end-of-step landings are covered.

- A reconnect with an unseen catch first drew 3.47 tiles from spawn: the ownership-return revision invalidated otherwise valid physical placement metadata. A core regression shows the origin disappearing from the returned snapshot. Returning the same ownership now carries that origin into its new revision; a takeover by a different holder remains distinct.

The first rejected intermediate matrix had 12 completed pairs: one freeze versus zero, 37 displacement spans versus 57, zero solid frames, and zero oversized moves versus four. It is retained separately and is not counted as final acceptance. The strict no-hit follow-up also failed on touching destinations. The swept-endpoint / 100 ms campaign then eliminated freezes but retained 68 displacement spans versus 59 in its 12 short pairs (75 versus 70 after one five-minute pair); it was stopped before completion and the game decay shortened to 40 ms. That next 40 ms campaign reached 15 pairs at 66 displacement spans versus 78 but still failed with the one late-return cut and the one corner freeze; those failures prompted the final runtime fixes. [Failure trace, red test and intermediate totals](receipts/runner-error-smoothing/second-run/) document the failure rather than hiding it in an aggregate.

## Reproducibility and measurement

Toolkit runtime tested as `bca8ebf1`, rebased to `e7fc5568` with all eight patched source hashes unchanged; proof studio: `arcade-server-rules`, starting at `ef64911`, pinned to toolkit 0.51.1. Only local node_modules runtime files are patched for proof. The studio change adds `renderAheadMs: 16` and regenerates its local rules artifact; game physics are unchanged. Source hashes in the final manifest establish exact equality between toolkit source and all eight patched runtime files.

The detached live control is Arcade `main` at `a81acbd`, toolkit 0.51.3, created with `git worktree add --detach`. The first run's control was `1cc44a3` / 0.51.2, so historical counts are not presented as the same control build. Both current builds run concurrently under identical shaping, one pair at a time on the shared machine. The supplied pt4 harness drives both games; local copies add simulation/presentation diagnostics and robust owned-browser cleanup without changing steering. Scratch: `/tmp/runner-error-second`; only `rebased-*` traces belong to the final runtime. Incomplete instrument attempts are retained and excluded from completed paired totals.

The supplied solid classifier tolerates 0.1 tile penetration; zero detected frames is not a mathematical zero-overlap proof. Held freezes are >200 ms outside injected outages. Observer displacement is >1.5 tiles for >300 ms, using the supplied best-shift alignment per three-second window and ±1.5 s respawn exclusions. It compares the other browser's rendered authoritative runner, not omniscient instantaneous truth. Corrections are never relabelled as respawns to improve the count. Round-metadata-only spawn flags are separated from confirmed physical placement frames, as in the first run.

Main advanced during validation. Rebasing resolved only the generated runtime fingerprint conflict and incorporated main’s post-simulation-step presentation cache invalidation. Since that changes the runtime, the `origin-*` partial campaign is intermediate evidence; the complete acceptance matrix was restarted as `rebased-*`. That exposed a cache interaction: unconditional invalidation let a second reader in the same browser frame spend another correction step. The failing frame-coherence regression is retained. The cache is now invalidated only if this pump created it; the effect-read regression uses actual browser-frame callbacks. All 42 selected regressions pass. CI then started successfully on the rebased source. A later main release (0.51.5) required another changelog/fingerprint rebase; none of the eight tested rules/netplay files changed, as verified in the manifest.

## Final results

20 completed matched pairs / 40 runs, 1,517.8 candidate seconds / 91,066 candidate frames. Six jitter-only pairs (150 ± 100 ms), six at 300 ms / 5%, two 305-second sessions (100 ms / 2% / 40 ms jitter), two reconnects with 2/6-second outages, two crowds (5/8 players), and two CPU×4 pairs. Four incomplete eight-player attempts were retained and repeated on both sides; three lost the candidate frame and one never obtained a seat. The successful attempt ran after load settled. No completed failure was discarded. Failure-only shell/browser logging was added during diagnosis; steering and measurement were unchanged.

| Measure | First run candidate / live | Second run candidate / live |
|---|---:|---:|
| Held-key freezes >200 ms outside outages | 2 / 0 (533 / 0 ms) | **0 / 0** |
| Connected observer displacement spans >1.5 tiles for >300 ms | 85 / 64 | **80 / 82** |
| Connected displacement duration | not compared here | **52.624 / 43.743 seconds** |
| Detected solid frames | 0 / 0 | **0 / 0** |
| Non-respawn one-frame moves >1.5 tiles | 0 / 13 | **0 / 12** |
| Outage freezes / score resets | 0 / 0 each | **0 / 0 each** |
| Confirmed physical respawn lead | — | **0 / 0.02 tiles** |

Six injected outages per build began with positive scores. Both crowd receipts confirm five and eight runners, with no crowd errors. The raw spawn-flag maximum is 8.39 tiles on candidate, but those flags are round-metadata-only transitions without physical movement or a changed drawn death counter; all confirmed physical placements have zero lead. The receipt separates these instead of relabelling corrections.

| Profile | Pairs | Candidate spans | Live spans |
|---|---:|---:|---:|
| Jitter only | 6 | 10 | 4 |
| 300 ms / 5% | 6 | 36 | 63 |
| Five-minute sessions | 2 | 16 | 6 |
| Reconnects | 2 | 4 | 1 |
| Five/eight players | 2 | 12 | 6 |
| CPU×4 | 2 | 2 | 2 |

The revised aggregate span-count gate passes, **but connected displacement duration and several individual profiles remain worse than live**. This does not establish universal convergence within 300 ms or uniform improvement on every connection.

Phantom catches are 22 of 53 catches versus live's 50 of 75. CPU×4 frame p99 is 19.8–20.4 ms versus 18.6–18.9 ms; >33 ms frames are 4 versus 2. Median per-run gold-HUD p90 is 167.1 ms versus 683.45 ms. Gold-HUD per-run p90 ranges from 83.4 to 1,533.4 ms versus 484–1,782.4 ms: one candidate jitter run has the 1,533.4 ms outlier, so the historical 100–170 ms range is not preserved across every run.

[Full matrix, profiles and trace hashes](receipts/runner-error-smoothing/second-run/matrix.json).

## Preservation and checks

The repeated input trials pass the revised latency gate at both tested delays. Canvas stroke timing corroborates the probe timing.

| Input p90 (ms) | Candidate | Live |
|---|---:|---:|
| Run, zero lag | 17.3 | 31.2 |
| Run canvas paint, zero lag | 17.3 | 31.1 |
| Run, 150 ms | 14.6 | 33.0 |
| Run canvas paint, 150 ms | 14.5 | 33.0 |
| Jump, zero lag | 15.6 | 29.7 |
| Jump, 150 ms | 14.8 | 32.2 |

There are 24 valid zero-lag run trials and 22 valid 150 ms candidate run-feedback trials versus 24 live; every jump set has 12. Candidate jump heights are 5.104–5.108 tiles versus live's 5.108; median observed airtime is 0.82 s at zero lag and 0.83 s at 150 ms, versus live's 0.82 s. The simulation is unchanged; presentation sampling can differ by one frame. Median 150 ms run distance remains 0.450 tiles. The 30/80/120 ms tap distributions and excluded/no-ground attempts are retained in the receipts.

Desktop keys, touch steering, button/right-side jump, and TV spectator mode have no browser errors. TV has four runners and no player seat. Desktop, portrait and TV screenshots were inspected locally. Both candidate reloads preserve score and resume play in 167–205 ms; the control resumes but loses score on both tested reloads.

Three complete rounds pass on both builds: zero scores at start, both players in spawn areas, eight monsters/eight gold restored, matching results on both screens and results matching HUD scores. No reconnects or browser errors. Results screenshots were inspected. Audio was not audibly assessed by this muted-browser harness.

Portrait (60 s) and landscape (30 s) touch runs pass at CPU×4 with 60 ms / 1% / 20 ms jitter: both builds continue moving/jumping and scoring, with zero reconnects or browser errors. Both candidate captures were inspected.

Both canonical `homie-studio check` runs pass (`ok: true`), with uninterrupted computer/phone connections through results, zero reconnects, and 60–61 FPS. Final PR-head checks are visible on PR #116.

42 selected view regressions, 23 rules/collision tests, 16 setting tests, TypeScript build, and all 34 studio tests pass. Tested runtime commit `bca8ebf1` has 44 green GitHub checks; release-rebased `e7fc5568` preserves every patched source hash. Failing and passing regression receipts are included beside the matrix.

The first final five-minute trace was also inspected against the added simulation diagnostic: its eight observer-displacement spans had much smaller drawn-to-local-simulation offsets. These values include the display forecast and are not a direct measure of interpolation error. They indicate that the remaining observer disagreement is not solely a slow visual blend; delayed observer state and prediction disagreement still contribute. [Per-span diagnostics](receipts/runner-error-smoothing/second-run/long-displacement-diagnostics.json) retain the measurements.

## Compatibility and remaining limits

Placement metadata is optional on the wire and old view decoders ignore it. New code reads old 21-field saves and new 22-field placement rows; older toolkit code cannot read those extended saved rows on rollback. Delta reconstruction replaces an entity row when its length changes. The existing 3D correction policy is unchanged.

No version bump, merge, or deployment. Changelog entries stay under Unreleased for release-time numbering.
