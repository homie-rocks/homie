# 2D runner reconciliation — local proof

Status: **acceptance failed** on held-key freezes and observer displacement. This is a local candidate and draft PR, not a release or deployment.

## Design

The 2D simulation adopts each authoritative snapshot and replays pending input immediately. Presentation retains the difference from the prior drawing as a visual offset, exponentially removing about 99% in `room.predict.blendMs` (default 100 ms). Held controls do not gate that decay. Collision sweeps shorten the offset; an incremental collision-safe route and `room.predict.maxFrameM` (default 2.8 body radii) bound large blends. These presentation positions never feed simulation, hits or score. A browser frame shares one presentation across renderer and probes. Server outages keep local prediction and the last authoritative score, without switching to solo hosting. Optional placement metadata preserves the server's exact spawn origin through delayed snapshots and save/restore. Real respawns cut to that origin; a living body's authority handoff retains its visual offset.

## Baselines and reproduction

- Toolkit worktree: branch `runner-error-smoothing`, initially based on `f01f0c8a` (0.51.3), rebased onto `434584a2` (0.51.4). Only changelog conflicts required resolution; runtime code is unchanged by that rebase.
- Proof studio: `/Users/ryan/Studios/homie-arcade-rules`, `arcade-server-rules`, originally `dd4a42f`, pinned to 0.51.1. Only local `node_modules/@homie-rocks/studio` runtime files are patched; no package version changes.
- Control: detached worktree of current Arcade `main`, `1cc44a3`, toolkit 0.51.2. This differs from the older live control in the supplied pt4 report.
- Browser trials use the supplied pt4 `cmp4.mjs` harness and its seeded keyboard autopilot. Each branch trial runs concurrently with its control under identical shaping; only one pair runs at a time. Extra crowd seats are explicitly requested in the crowd cases.
- Scratch: `/tmp/runner-error-proof`. Raw frame traces are gzip-compressed. Earlier `first`, `capped`, `frame`, `final`, and `verified` tags are intermediate builds, not final acceptance evidence. Final candidate tags are `candidate-*`.

The supplied jitter trace (`b-jit150-2-lag150-loss0-jitter100-frames.json.gz`) reproduces a 2,632 ms held-key freeze at 2.17 s. The supplied pt4 baseline reported 12 freezes / 11.6 s outside outages, 13 displacement spans / 36.9 s at its looser >3 tiles for >1 s threshold, 17 outage freezes / 31 s, and respawn lead up to 10.7 tiles. Those aggregate counts are supplied evidence, not newly repeated measurements.

Failing tests were recorded before changing the corresponding behavior:

- Two held corrections stayed 12 and 12.39 metres from authority after 384 ms. The final assertions tighten convergence to 288 ms.
- Disconnected local motion stopped (minimum frame travel zero).
- A respawn at x=100 first drew at x=102.60 under lag; dropping the initial placement snapshots also lost the true origin.
- Adding/removing optional placement metadata broke delta reconstruction; row-length changes now send a full replacement row.
- A restored authority epoch cut a living body from x=-3 to x=-7; the game can now identify that handoff as the same life.

## Measurement contract

Solid penetration and one-frame displacement use the supplied `ana4.mjs` geometry and respawn classification. Its solid tolerance is 0.1 tile, so “zero in solid” means zero detected frames at that tolerance, not a mathematical zero-overlap proof. Held freezes are filtered to >200 ms and exclude injected outage intervals.

Observer displacement uses the supplied `div.mjs` time alignment (best shift per three-second window), tightened to >1.5 tiles for >300 ms. It excludes ±1.5 s around respawns on either screen; an own correction is not reclassified as a respawn simply because it is large. The comparison is to the other browser's rendered authoritative runner, not an omniscient zero-latency trajectory. Incomplete harness runs are excluded from completed-run totals and retained as failures to rerun.

A strict 1.5-tile frame cap and a universal 300 ms convergence bound cannot both hold for arbitrarily large errors: even a straight 43-tile correction needs at least 29 frames, about 483 ms at 60 Hz. Terrain detours can take longer. No recovery correction is relabelled as a real respawn to bypass the bound.

## Validation and limits

The initial full view-test process reached 258 passing cases before a Node heap exhaustion. The final source passes all 300 cases in four fresh-process partitions (90 + 90 + 77 + 43), plus 39 core/transport/3D cases and the studio's 34 tests. The original diagonal assertion incorrectly compared a continuously moving predicted vertical axis with an older server state; the replacement checks Euclidean frame travel and convergence on the stopped horizontal axis. Counter-dash tests now assert immediate reconciliation rather than entry into the deliberately removed 2D historical catch-up mode. The existing ledge test exposed an actual rounded-corner sweep bug, fixed with a direct collision regression as well.

The candidate browser artifact predates two changes that do not alter Tiny Platformer's exercised path: validation now rejects zero/nonfinite `maxFrameM`, and circle sweeps test a previously missed rounded corner. Tiny Platformer explicitly uses a positive 1.4 cap and box runners. The exact tested source hashes are retained in the build manifest; the final local package is patched with the complete source after the matrix.

New code reads old 21-field saved entity rows and new optional 22-field placement rows. Older toolkit code cannot read the extended rows on rollback. Snapshot deltas send a full entity replacement when row length changes; older view decoders ignore the added optional placement position. The 3D catch-up policy remains in place. CI initially rejected the stale runtime fingerprint and a Chrome assertion that expected microtask-level cache invalidation. The fingerprint is regenerated without changing package versions; the browser assertion now requires identical presentation within a frame and a new presentation on the next animation frame. The initial local rerun then reached old time-speed bounds: large pushes now use the requested fast blend rather than a 21 m/s limit, and shared frame presentation must account for late paint callbacks. The updated smoke retains steady-motion/reversal checks when no reconciliation occurred and asserts the default 1.4-metre frame cap for ordinary corrections and pushes. Its old unconditional no-reversal assertion was incompatible with ungated correction: the browser-host case measured a 0.13-metre backward correction and now checks that correction against the frame cap. All three server smoke profiles pass, and the targeted browser-hosted rerun passes after that policy change. The four identity/crowd-driver tests also pass. Final receipts retain the intermediate failures.

## Results

The completed matrix contains **20 matched pairs / 40 runs total**, with approximately 25.3 minutes per build. It covers six jitter-only pairs (150 ± 100 ms), six 300 ms / 5% loss pairs, two five-minute 100 ms / 2% / 40 ms jitter pairs, two reconnect pairs (three 2-second and three 6-second cuts), five- and eight-player pairs, and two 4× CPU-throttled pairs. Two incomplete jitter attempts lost a Puppeteer frame reference; both pairs were repeated. The detach cause remains unresolved. Their incomplete attempts are retained but excluded from paired totals.

| Metric | Candidate | Detached control |
| --- | ---: | ---: |
| Complete matched runs | 20 | 20 |
| Recorded frames | 91,154 | 91,120 |
| Detected solid frames (>0.1 tile penetration) | 0 | 0 |
| Non-respawn moves >1.5 tiles/frame | 0 | 13 |
| Held-key freezes >200 ms outside injected outages | 2 / 533 ms total | 0 |
| Observer-displacement spans >1.5 tiles for >300 ms | 88 / 65.290 s | 64 / 36.218 s |
| Same displacement metric outside injected outages | 85 spans | 64 spans |
| Detected held-key freezes inside injected outages | 0 | 0 |
| Score resets during positive-score outages | 0 of 6 | 0 of 6 |
| Distance to nearest spawn on confirmed placement frames | 0 tiles | 0 tiles |

[Full per-run receipts and trace hashes](receipts/runner-error-smoothing/matrix.json) retain all raw and adjusted figures. The raw phase-based respawn classifier reports up to 12.12 tiles on the candidate: the probe can expose a new round number one frame before its saved drawing changes. These round-metadata-only flags are retained separately. Confirmed placement frames (`moved` or a changed drawn `diedAt`) are all exactly at a declared spawn; delayed-snapshot unit tests separately verify the server-chosen origin. For example, at 125.428 s in `b-candidate-long-0` the probe reports round 2 with the old round-1 drawing; at 125.445 s the marked placement is exactly (30, 41).

The [retained failing trace](receipts/runner-error-smoothing/loss300-freeze-frames.json.gz) is `b-candidate-loss-5`; its remaining freezes are at 19.75 s (233 ms, drawn at 47.32, 9) and 22.91 s (300 ms, 42.84, 12). This is still a failure of the requested zero-freeze bar. The worst connected displacement span lasts 1.917 s with a 9.7-tile peak (`b-candidate-loss-4`, 10.6 s). A six-second reconnect has a 1.566 s post-network-restoration span with a 24.5-tile peak (`b-candidate-rc-1`, 81 s). The candidate has more strict displacement spans than the control; the design change is not sufficient evidence of convergence.

Both reconnect profiles retain motion and displayed scores through the injected cuts. In the six-second branch case the three before/after scores are 4→4, 5→5 and 6→7, and reconnection takes 545–1,244 ms after network restoration. The only browser console errors in the matrix are the harness's deliberately rejected offline WebSocket connections.

Per-run gold-HUD p90 values range from 17.3–349.9 ms on the candidate versus 483.1–2,100.1 ms on control. These are ranges of per-run quantiles, not a pooled p90; the supplied 100–170 ms band is not preserved in every run. Phantom-catch observations are 27 of 59 catches versus 76 of 114; the autopilot paths differ, so this is observational rather than a controlled catch-rate experiment. The 4× CPU desktop cases have frame p99 18.4–18.8 ms versus 18.1–19.0 ms, with no >33 ms frames in either build.

The supplied legacy displacement classifier reports 14 spans / 27.769 s on the candidate and 5 / 6.202 s on this control. The supplied earlier campaign reported 13 / 36.9 s and 0 respectively, across different run counts and profiles. This legacy classifier uses >1.5-tile spans with peak >3 tiles and duration ≥1 s; it is not the stricter acceptance metric above.

## Preservation checks

Paired controls, feel, reload and three-round checks completed. Both builds reset rounds with eight monsters/eight gold, matching results and scores on both screens, and both players on spawn points. The candidate preserves scores across both reloads (3→3, 4→4); this control resets 3→0.

Candidate run-input p90 is 36 ms without lag and 38.8 ms at 150 ms, versus 31 and 32 ms on control. Candidate measured jumps remain 5.105–5.108 tiles / 0.82–0.83 s. Three lagged branch feel attempts could not find clear ground; control’s Space-key control trial likewise found no clear ground. These are retained, not counted as successful trials.

The dedicated phone harness initially failed on both builds because its generated room names exceeded the 32-character limit; retries use shorter room names.

The final complete-package `check` passes on both builds, but its first candidate run reports one reconnect per browser (control zero). The repeated matched check passes with zero reconnects on both builds; both receipts are retained. The first run is not an uninterrupted-connection pass.

Dedicated touch-phone retries complete with no reconnects or browser errors on either build. At 4× CPU and 60 ms / 1% loss / 20 ms jitter, frame p99 is 20.1 ms portrait and 19.2 ms landscape on the candidate, versus 18.3 and 19.0 ms on control. Neither build has detected solid overlap or oversized non-respawn moves; candidate has no >33 ms frames, control has one (59 ms). Portrait runs last 60 s, landscape 30 s. These touch traces do not establish keyboard-freeze behavior. [Preservation receipts](receipts/runner-error-smoothing/preservation.json) retain the details.

The computer, portrait phone and TV captures have been inspected locally, not independently: runner edges sit outside the terrain, scores and round labels remain readable, and the phone jump control is visible. Keyboard directions, A/D, Space/Up/W, touch movement/jump and a spectator TV seat all respond. Initial jump measurements remain 5.107 tiles and 0.82–0.83 s.

## What remains

Do not mark this ready to merge: eliminate the two measured correction freezes and the connected displacement failures, then repeat the matched acceptance matrix. Investigate the input/application timeline as well as visual-route convergence; these receipts do not establish that the remaining discrepancy is only a drawing offset. Large recovery errors also need a consistent policy: a mandatory 1.5-tile frame cap, collision-safe detours and a universal 300 ms convergence bound are not simultaneously satisfiable for arbitrary errors. No recovery cut has been disguised as a real respawn.

No version was bumped. Changelog entries remain at the top under Unreleased for release-time numbering. No merge or deployment was performed. Only the proof server process trees started for this task were stopped; ports 8793/8794 are closed and the detached control worktree was removed.
