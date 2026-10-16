# Owner runner fairness and phone follow-up — 15 October 2026

**NOT READY: the fixed six-catch target, zero unexplained observer pass-throughs, and phone parity remain unmet.** This round starts at PR #116 head `27d431c9` and studio `71c6923`, comparing concurrently with detached live `75b280cfb7f4d03d8d5f695f38b42b3c29cc5385`. Retained local studio commit: `a18931bc8305a39b9da9f173759be7f23e3fa76a` (Ryan Campbell, signed off; not pushed). No version bump, merge, deployment or production write. The prior report, including the resolved eight-player ten-minute Cloudflare run, is [preserved](history-through-27d431c9.md).

## Final fairness result

Five paired trials of the final retained build, 300 ms delay + 5% loss, about 310 seconds per build:

| Metric | Branch | Detached live |
| --- | ---: | ---: |
| Victim-screen no-monster heuristic | **9** | **25** |
| Observer no-nearby-monster heuristic (the original 21/6 metric) | **8** | **12** |
| Detected own catches | 17 | 35 |
| Deep observer pass-through flags | **4** | **6** |
| Deep own side pass-through flags | 1 | 8 |
| Pickup taken back flags | 1 | 0 |
| Stomp taken back flags | 2 | 0 |
| Unexplained own jumps / browser errors | 0 / 0 | 0 / 0 |

Branch is below this concurrent control on phantom counts, but eight still exceeds the fixed target of six. [Death-ID audit](fairness-round/verified-pass-audit.json) explains three of the four branch observer pass flags: catches 66.7 and 149.9 ms later with short respawn jumps, and one during invulnerability. **One visual pass remains unresolved.** Its sampled runner report tick was 609, scene tick 611.88 and monster drawing clock 613.36: the remote body and monster still occupy different presentation times. Do not call the observer gate passed or silently replace the historical heuristic.

The final 400/500 ms lag-switch pair recorded **1/1** deep observer flags and **4/4** deep own side flags. The branch observer flag is a confirmed catch at tick 82, 134 ms after the apparent pass, which the distance-based respawn detector missed. The original executable delayed-path/lag-switch guards pass unchanged. This establishes no missed observer contact in that branch lag-switch trace; it does not erase the unresolved high-loss visual pass or certify every own-side flag.

All final fairness pairs started at load **11.728–14.402**, maximum recorded **15.951**. The lag-switch pair started at **13.608**, maximum **17.989**. Detailed trial rows and every final observer phantom flag are retained in [the evidence](fairness-round/final-summary.json) and [flag audit](fairness-round/verified-phantoms.json). Temporary server-contact payloads are available for the earlier instrumented batch; the final build has no diagnostic effects.

## Final phone result

The final build, including birth-aware scheduled respawns, measured **5/3 frames >33 ms** and **2/1 >50 ms** over **10,833/10,838 frames** in 180 seconds at 4× CPU, branch/live. Both had zero unexplained own jumps, correction slides, stalls, solid penetration or gliding respawns, and one socket. Frame p99: **20.6/19.3 ms**. Sampled GC: **748.337/296.280 ms**, or **0.06908/0.02734 ms per frame**. A separate allocation sample estimated **65,398/9,203 bytes per frame**, including collected objects. These are instrumented estimates, not retained heap. The frame target still fails; no performance optimization was retained without supporting paired results.

Final zero-delay jump feedback p90 was **20.6/40.5 ms**, 12 accepted jumps each; run-key p90 **30.5/30.3 ms**, 24/23 accepted presses. This batch started at load **13.827** but reached **53.556**, so it is not presented as a calm-machine latency guarantee. Earlier calmer measurements are recorded below. The final phone pair stayed at recorded load **12.852–16.697**; the separate heap pair stayed **12.100–12.840**.

## What caused the catches

Monsters already use the owner's predicted tick and deterministic patrol, rather than the delayed remote interpolation clock. The principal mismatch is at the server: an accepted movement report older than 150 ms is checked against the **current** monster, including a stationary last-known endpoint when reports stop. TCP loss queues can make reports 250–900 ms old even with arrival-time stamping. That pairs the victim's old position with a monster several tiles from the one the victim saw. In the instrumented five-pair batch, all 12 confirmed own-screen catches lacking any canvas overlap in the preceding 1,150 ms took this fallback; seven other confirmed catches used report-time history. Two report-time contacts also lacked the monster at the matching instant: its new birth tick was already ahead of the sampled lifecycle, which still showed the preceding corpse. Earlier baseline traces separately exposed unconfirmed speculative stomps hiding live hazards. A further observer-only mismatch came from showing placement revisions before the interpolated scene reached that snapshot. Contact geometry also differed: live applies a six-pixel inset to networked human side catches, while branch used the full 31-pixel box.

Example: branch trial 1, server tick 142, movement report 131. The server chose tick 142 and caught the runner at `(31.983, 41)` against monster 3 at `(31.249, 41)`. On the owner's matching frame (tick 130.352, sampled remote tick 126.9), the runner was `(31.834, 41)` and that monster was drawn at `(34.544, 41)`. The report was 550 ms old, beyond the 150 ms window. Extrapolating monsters to the runner's clock was already happening and cannot repair that later server time substitution.

## Instrumented fairness results

Five concurrent pairs, 300 ms injected delay + 5% TCP loss, about 310 seconds per build. Every pair started at load ≤25. Original pt6 analysis is retained alongside the new diagnostic evidence.

| Metric | Branch | Live |
| --- | ---: | ---: |
| Original observer no-nearby-monster heuristic | **13** | **6** |
| Original victim-screen no-monster heuristic | **10** | **20** |
| Victim catches detected by original harness | 19 | 27 |
| Deep observer pass-through heuristic | **2** | 7 |
| Deep own side pass-through heuristic | 1 | 9 |
| Pickup taken back heuristic | 1 | 0 |
| Unexplained own jumps | 0 | 0 |
| Browser errors | 0 | 0 |

The cited prior **21/6** was the observer metric; its own-screen count was **25/27**. This clarification does not erase the failed target: 13 still exceeds six, and the high-loss observer batch is not zero. The separate 400/500 ms lag-switch pair recorded **0/1** deep observer pass-throughs and **1/2** deep own side pass-throughs. Its observer no-nearby-monster heuristic was 7/3. These are individual finite trials, not statistical guarantees.

The original heuristic infers a death from a long jump near a spawn. Every original 21 observer flag is recorded in [the audit](fairness-round/original-21-phantoms.json): five have no matching owner-death receipt within the audit’s −150 to +1,600 ms window, and two flags repeat an already matched death. A missing receipt in that window does not prove there was no death. Those old captures have no server-contact event, so their exact judged substep cannot be reconstructed. The new temporary `catchTrace` effect records the report tick, chosen monster tick, substep, stationary flag, collision positions and actor/death identity. [All 19 confirmed instrumented victim deaths](fairness-round/margin2-traces.json) include the corresponding owner clock, visible probe position and canvas monster rectangles. Canvas capture matters: live's old monster probe reads its newest snapshot, while the renderer interpolates older positions. The canvas audit supplements rather than silently replaces the historical metric. Diagnostics were removed before phone measurements and final builds.

A later five-pair batch after reverting both allocation experiments, but before the scheduled-respawn correction, recorded **12/8** observer phantom flags, **13/26** victim phantom flags, and **5/8** deep observer pass-through flags (18/35 heuristic own catches). This does not meet the requested gates either; its receipts are retained separately.

## Retained behavior and rejected experiments

- Stamp a fresh validated-owner baseline for expected server arrival without simulating skipped travel. Use actual downstream age plus the low end of recent transit observations, bounded below the existing one-second report window. Early baselines spend the same elapsed simulation allowance; invalid movement still causes a placement revision.
- Sample observer placement revisions at the scene's time, without blending a respawn across the map.
- Check an accepted slightly early path against its matching deterministic monster time, bounded by the existing 150 ms window; avoid rechecking its endpoint against an earlier monster while that bounded lead remains.
- Match live's six-pixel inset only for networked human side catches. Full-box stomps, trusted/offline/bot contacts and the existing event-timing tests remain intact.
- Use a known scheduled monster respawn on the same clock as its patrol and the owner runner, in both drawing and local contact prediction. In the trace, monster 3 was born at tick 670 while the owner sampled tick 664; monster 4 was born at 1234 while the owner sampled 1227.12. Waiting for sampled `dead=false` made both hazards invisible despite an already-known return time. The new behavior is tested against exact patrol physics and later confirmation.
- Restore a provisionally hidden monster when the sampled server view reaches the stomp tick and still says it is alive. Gold retains its earlier confirmation/timeout behavior.

A full-RTT arrival estimate overreacted to TCP recovery; it was replaced by the bounded low-transit estimate. A 600 ms contact-history experiment failed the original delayed-path contact guard and was reverted, with the test unchanged. Extending gold prediction expiry produced 18 pickup-back flags and was reverted. The 600 ms experiment has two completed exploratory pairs; it is not a passing result. An initial final-margin pair failed during local server startup before branch measurement; live completed, but no paired comparison is inferred. The harness now waits for both local URLs to be ready.

## Phone performance

The conditional-spread/Object.assign rewrite failed both 180-second paired 4× CPU trials: **9/3 and 11/4** frames >33 ms. Sampled GC cost was **0.073/0.027 and 0.084/0.034 ms per rendered frame**. The planned repeat batch was stopped after two completed pairs to investigate allocation; neither result was discarded. A separate 60-second sampling-heap run, including objects subsequently collected, estimated **69,121/9,740 bytes allocated per rendered frame**. This is a sampling estimate with profiler overhead, not retained heap or an unbiased frame-time run. Branch allocation leaders included report batching (~23 MB), `Object.assign` (~17 MB), guarded property descriptors (~16 MB), prediction (~14 MB), probe metadata (~13 MB), map visits (~13 MB) and guarded movement (~10 MB) over the capture. The wrapper rewrite was reverted.

A narrower frozen-motion cache then failed all three 180-second paired trials: **6/1, 9/2, 8/3** frames >33 ms. Sampled GC remained **0.072/0.028, 0.078/0.033, 0.072/0.031 ms/frame**. It too was reverted. Neither experiment is retained merely because an isolated branch count was lower than the historical 15-frame result. Before the scheduled-respawn correction, the retained clock/contact build (both allocation experiments removed) measured **5/3 frames >33 ms**, **2/1 >50 ms**, over **10,826/10,831 frames** in 180 seconds at 4× CPU. Neither side had an unexplained own jump, correction slide, stall, solid penetration, or gliding respawn; each used one socket. Frame p99 was **19.5/19.3 ms**. Sampled GC totaled **666.816/347.786 ms**, or **0.06159/0.03211 ms per frame**. A separate 60-second heap capture estimated **69,385/10,272 allocated bytes per frame**, including collected objects. Report batching, guarded property access, map queries and prediction remain allocation leaders. The smaller absolute long-frame count than the historical 15/11 is **not** evidence of a statistically established improvement; the concurrent live control also improved, and the requested ≤live gate still fails. Start load was **8.793**, recorded maximum **15.687**.

The first scheduled-respawn prototype then measured **36/22** frames >33 ms and **18/14** >50 ms. It started below load 25 but recorded a later peak above 29. This prototype also exposed an interaction where an old corpse confirmation could clear a new predicted stomp; that bookkeeping was corrected before the final batch. Its phone and heap captures remain intermediate results, not retained-build proof.

## Input latency before the scheduled-respawn correction

Zero-delay jump feedback p90: **29.6/31.3 ms** (12 accepted jumps each). At 150 ms injected delay: **30.5/31.8 ms** (12 each). Zero-delay run-key p90 was worse in this pair, **34.3/28.8 ms** (24 each); at 150 ms it was **20.9/32.9 ms** (23/24, with one branch trial finding no ground). No browser errors. These finite pairs preserve responsive jump feedback but do not prove every input metric is faster. The initial historical 32.7/40.7 ms jump pair is retained in the prior report rather than presented as this build's result.

## Verification and limits

Toolkit and strict Tiny Platformer builds pass. The canonical two-browser check completes a full round with both connections uninterrupted; computer and phone draw at 61 fps. All **305 view tests** pass in two disjoint positive-name groups (**111 + 194**), as do **17 owner validator tests** and **44 studio tests**. The original accepted-path/lag-switch checks remain unchanged. New bounded-contact tests cover early endpoints, the maximum grace, network side-contact margins, and unchanged trusted contacts.

Two broad view-test attempts exhausted the default Node heap; the first passed 268 checks including the separate validator file, the second passed 251 view checks. An attempted negative filter selected the whole file again. The final positive filters select disjoint groups and complete successfully. Aborted attempts are not counted as passes; their temporary fixtures are cleaned separately from unrelated work.

The earlier synchronized Cloudflare comparison remains **eight players × ten minutes, zero observed overruns on either build**. Host scheduling code was not changed in this round. That historical result is not represented as a deployment or a Cloudflare test of this round's gameplay binary. Detailed receipts and caveats remain in the prior report.

Raw frames and profiles stay under `/tmp/owner-fairness` (56 MB after lossless gzip compression; originals were SHA-256 checked before removal); compact traces, test receipts and load logs are in [fairness-round](fairness-round/). The original pt6 browser, comparison and phone harnesses are unchanged. Temporary contact effects are preserved as an opt-in diagnostic patch, not shipped runtime code. Both task-owned local Wrangler process groups were stopped after command-line verification. Three aborted-test fixtures, identified by their creation times against this task’s logs, were removed (190,696,560 bytes); unrelated processes and files were left alone.
