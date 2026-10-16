# Round 10 final proof

**Verdict: not ready to replace live. The requirement to fix all three issues without regressions is not met.** Input latency and deep observer overlaps improve, while the large observer-jump and recovery improvements survive. Owner-screen phantom candidates remain substantially worse than live. Low-lag raw overlaps and several input p90 results also prevent an everywhere-better claim.

Starting heads were toolkit `c92e5bec` and studio `7bfdf12`. The measured toolkit runtime is `fb0ebdf6`, with runtime identity `179e96b851cb01beb3f6267164733169a3aa732992d7ee61426957863e8208ee`; later toolkit changes document evidence. The measured studio runtime is `d73070c`, using published 0.57.0 plus its checked-in 15-file overlay. The live control is the same detached Arcade commit as round 9, `c75980acf259d466d8d2283bff66317397609840`, on published 0.56.0. No version bump, merge or deployment occurred.

All **55 paired headless runs** qualified: the original 42-pair matrix, six additional network pairs, four additional focused non-host input pairs, and three additional 80 ms host-input pairs after its first result was worse. There were 12,249 qualified one-minute-load readings; maximum 24.701. One incomplete attempt, `g10-n80n1`, crossed 25.353 and was rejected, retained and replaced after waiting. No overloaded or interrupted trace is pooled into the comparison. Each side has one identical artifact set across all qualified runs, unchanged within every pair.

Only `g10-` supplies the final-runtime measurements. Earlier campaigns remain diagnostics. Candidate/live order is used below. The original 16 network pairs and 28 movement pairs are kept separate from the additional repeats so their totals remain comparable to round 9. [COMPARISON.md](COMPARISON.md) retains every profile, denominator and individual input attempt; `RESULTS.json`, `AGGREGATES.json` and `VERIFICATION.json` hold the machine-readable evidence.

| Focus | Round 9 candidate / live | Round 10 candidate / live | Scope |
|---|---|---|---|
| 300 ms host-profile owner phantom candidates | 24/32 vs 2/6 catches | 19/22 vs 2/8 catches | Original two-repeat subset |
| Same owner-contact focus, expanded proof | — | **38/44 vs 2/13 catches** | Four 180 s pairs; every candidate repeat is worse |
| Non-host observer passes (deep) | 22 (6) / 13 (2) | **12 (0) / 13 (3)** | Original 16 network pairs |
| 150 ms non-host run p90 | 35.9 / 31.8 ms | **31.3 / 30.8 ms** | Four pairs; 190/192 valid timings |
| 300 ms non-host run p90 | 34.3 / 32.0 ms | **31.3 / 31.8 ms** | Four pairs; 189/192 valid timings |
| 300 ms non-host jump p90 | 35.5 / 31.6 ms | **29.5 / 31.6 ms** | Four pairs; 160/156 valid timings |

The expanded observer proof limits the favorable original-matrix result: across twelve 0/80 ms pairs, raw passes are **11/9**, deep **0/1**, over 92/23 visible overlap opportunities and 130,347/130,271 observer frames. Across all 22 network pairs, passes are **16/13**, deep **1/3**, over 163/40 opportunities. Raw low-lag passes therefore remain higher than live. Counts are not silently discounted as stomps or normalized into a pass. In the original matrix, the supplemental disappearance-plus-score audit leaves all 12/13 flags unresolved, deep 0/3.

The removed input deferral is up to **4.17 ms**: a press arriving in the last quarter of a 60 Hz substep previously waited another step. Press and release now sample the step end, with half a 1/4096 input quantum of tolerance at exact boundaries. The toolkit also captures call time before pumping work, and the game supplies keyboard `event.timeStamp`. Original movement constants and all 47 original studio tests are unchanged; seven added tests cover these changes and contact timing.

For observer contacts, confirmed stomps now carry their accepted contact tick. An immutable `room.get(id, {latest:true})` read lets the view apply that confirmed death within the same monster lifecycle while keeping positions on the buffered scene clock. A recent moving endpoint also waits for its next path within the existing trusted-latency allowance; silence beyond the bound remains vulnerable. The original early/stale-report bounds remain intact.

The owner problem is **not fixed**. The owner is still predicted ahead of the drawn monster scene. An explicit `diedAt` audit found 47 catches in the four focused runs: 39 had no nearby drawn monster within 600 ms and 24 had none within five seconds. Median owner-minus-monster clock gaps were 0.981, 0.993, 0.635 and 0.818 seconds. A deterministic reproduction also accepts a physically valid path at ticks 51–58, at least 2.596 tiles from the contemporaneous patrol, then catches it against the newer monster when judged at tick 69 after its history allowance expires. This isolates a second timing mismatch; it does not establish how much of every browser flag it explains. A remote-forecast trial was reverted after producing ten deep observer passes versus live's zero. See [CONTACT-GAP.md](CONTACT-GAP.md) and [DIAGNOSTICS.md](DIAGNOSTICS.md).

## Regression matrix

| Measure | Candidate / live | Scope |
|---|---|---|
| Non-host observer >3-tile jumps | 0 / 382; raw 0 / 469 | Original network matrix; 173,928/173,841 observer frames |
| Host observer >3-tile jumps | 0 / 0, including raw | Eight pairs; 87,077/87,015 frames |
| Host observer passes (deep) | 7 (0) / 43 (17) | Original network matrix; round 9 was 14 (4) / 47 (26) |
| All original movement-trace observer jumps | 0 / 476; raw 0 / 595 | 28 pairs; 304,329/304,104 observer frames |
| Stomp reappearance | 0/54 vs 0/59 eligible events | Original 28 movement pairs |
| Authority recovery: owner snaps / long observer holds | 0/0 vs 0/0 | Twelve resumes: three 3 s, three 6 s, six 15 s |
| Authority recovery observer jumps | 0 / 2 | Same twelve ten-second recovery windows |
| Lag-switch recovery: snaps / holds / jumps | 0/0/0 vs 0/3/11 | Eleven complete release windows per side |
| 1% fast clock: owner jumps / slides / freezes | 0/0/0 vs 1/0/0 | Observer jumps 0/34 |
| 4× CPU phone frames >33 / >50 ms | 0/0 vs 0/0 | Three exact 180 s windows; 32,403 frames each |
| Phone owner jumps / slides | 0/0 vs 2/2 | Full captures |
| 2–8 players | All requested human counts confirmed | Six crowd pairs plus three-player network pairs; crowd observer jumps 0/10 |
| Fresh rounds | 2/2 passed on each side | Reset, spawn, monsters/gold, results and scores agree; no reconnects/errors |

Including all additional network repeats, observer jumps remain 0/643 (raw 0/772), over 369,549/369,291 frames. Stomp reappearance is 0/68 versus 0/83 eligible events across 34 movement pairs. Raw overlap passes across those movement traces, including deliberate outages, are 26/44 (deep 5/15); these do not replace the focused low-lag result. Across all 37 frame captures, candidate owner jump/slide/freeze flags are 0/0/0 versus 14/19/0.

Phone p99 values are 18.8/18.1, 19.0/18.5 and 19.5/19.1 ms: the candidate is slightly slower on that measure despite both meeting the frame budgets. Full captures retain shutdown-tail outliers: >33 ms totals are 3/3 and >50 ms totals 1/2. The requested 180-second windows are not extended to include those tails, and the tails are not erased.

The fast-clock raw audit retains one `respawnsNotCut` flag with 4.6-tile spawn distance. Its saved context shows round metadata changing 67.1 ms before the body cuts to its new spawn, with no correction slide or non-placement jump. This is an observed message/body ordering discrepancy, not a claim of perfectly synchronized round presentation. Sixteen live-console WebSocket warnings occur during the harness's deliberate page freezes; all are retained and classified separately. There are no other recorded runtime errors.

All six phone and eight round screenshots were reviewed locally. Game, HUD, JUMP controls and result cards render; co-located world labels can overlap. This is a builder review, not an independent review.

## Input results and uncertainty

| Profile | Pairs | Run p90 ms (n), candidate / live | Jump p90 ms (n), candidate / live |
|---|---:|---|---|
| 0 ms / host | 1 | 30.5 (46) / 31.8 (48) | 29.1 (40) / 31.8 (40) |
| 0 ms / non-host | 1 | 29.5 (48) / 37.8 (48) | 31.4 (40) / 32.0 (40) |
| 80 ms / host | 4 | 31.4 (192) / 31.1 (191) | 28.6 (160) / 32.3 (160) |
| 80 ms / non-host | 1 | 28.5 (48) / 30.7 (47) | 27.2 (40) / 31.8 (40) |
| 150 ms / host | 1 | 28.1 (48) / 31.0 (48) | 28.5 (40) / 31.4 (40) |
| 150 ms / non-host | 4 | 31.3 (190) / 30.8 (192) | 30.0 (160) / 31.3 (159) |
| 300 ms / host | 1 | 32.0 (47) / 30.8 (48) | 32.5 (40) / 32.0 (40) |
| 300 ms / non-host | 4 | 31.3 (189) / 31.8 (192) | 29.5 (160) / 31.6 (156) |

`g10-UNCERTAINTY.json` resamples matched runs, then trials within each side of each sampled run (4,000 replicates, seed 101016). It reports no interval with fewer than three independent runs. The 95% intervals for candidate-minus-live p90 are: 150 ms non-host run **−1.0 to +2.7 ms**; 300 ms non-host run **−1.9 to +1.7 ms**; 300 ms non-host jump **−5.4 to +0.6 ms**. The observed 2–4 ms disadvantages are substantially reduced, but these intervals do not prove superiority or rule out every small regression.

The first 80 ms host run was 34.4/31.0 ms. Three repeats produced 30.2/30.9, 31.7/31.8 and 32.9/31.6. Its pooled run difference is +0.3 ms, with interval −2.0 to +3.4 ms; the initial +3.4 ms difference is not consistent across runs. The 150 ms non-host and 300 ms host point estimates also remain worse on running, and the latter on jumping. No profile is hidden in a grand pooled percentile.

`INPUT-FIDELITY.json` preserves movement-distance summaries and suspicious trials. Focused median run and short-tap distances match live. Five candidate 300 ms non-host run trials have end distances outside [0,1] tile after a 150 ms press from rest; four have timings, one has null feedback. The stored aggregates cannot establish their cause. Omitting those four timings as a supplemental sensitivity check leaves run p90 unchanged at 31.3 ms (185 rather than 189 samples). The original unfiltered result remains the reported metric.

Network delays and jitter are per direction: 0 ms without loss/jitter; 80 ms with 1% simulated loss and 30 ms jitter; 150 ms with 3% and 50 ms; 300 ms with 5% and 60 ms. The harness models ordered WebSocket/TCP retransmission delay. “Host” describes the measured runner's role on live; server-rules players have no browser authority role.

## Verification

A final clean `npm ci --ignore-scripts`, all **54 studio tests**, and the full build completed successfully. The generated rules check played **18,000 ticks** and restored **813 saves**. Post-build verification found no rebuilt artifact or installed-overlay mismatches against the measured runs. Toolkit runtime CI [38915716803](https://github.com/homie-rocks/homie/actions/runs/38915716803) succeeded with **51 successful jobs and eight conditional skips**. The earlier focused toolkit checks passed 40 view tests and 16 guide/contract tests. Acceptance logs remain in the studio receipts.

## Reproduction and cleanup

The studio branch keeps raw traces, load logs, frozen per-pair harnesses, screenshots, the packed overlay, and all tools in `scripts/round10/`. From the studio root, saved-result analysis is reproducible with:

```sh
python3 scripts/round10/results.py g10-
python3 scripts/round10/aggregate.py
python3 scripts/round10/uncertainty.py g10-
python3 scripts/round10/input-fidelity.py
python3 scripts/round10/verify.py g10-
```

`sync-toolkit.py` repacks published 0.57.0 with the checked-in overlay and explicitly installs that tarball, avoiding same-path npm cache reuse. `pair.py` refuses mismatched installed sources, checks runtime hashes before and after each pair, waits for starting load ≤15, and rejects a sample if load exceeds 25. `campaign.py` retains all 55 planned pairs and retries only load failures. New captures require the candidate and detached control servers on the recorded ports; use a new prefix to avoid skipping completed receipts.

The two owned dev servers are stopped and the detached control worktree is removed. Only owned processes were stopped. The PR remains open and unmerged; the studio is undeployed. This round does not approve replacing live.
