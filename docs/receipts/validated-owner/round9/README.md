# Round 9 final proof

**Verdict: not ready to replace live.** The rebase, published 0.57.0 tarball upgrade and full paired proof are complete. The work fixes the observed large observer jumps and stall-recovery failures, but does not eliminate every regression: owner-screen contact discrepancies and repeated high-lag input latency remain worse than live.

PR #116 was rebased onto main `a8acb479` (0.57.0), retaining the round-1–8 work and main's hibernatable room lifecycle, relay epochs, Lobby shards and early-join retries. The measured toolkit runtime is `92843051`; subsequent toolkit commits only document receipts. Studio runtime tarball commit is `53cab25`, using npm-published 0.57.0 plus `scripts/validated-owner-0.57.0.patch`. The detached live control was Arcade main `c75980acf259d466d8d2283bff66317397609840`, on published 0.56.0. No version bump, merge or deployment occurred.

All 42 paired headless runs qualified: 8,928 one-minute-load readings, maximum 12.751, zero rejected pairs. Each side has one identical artifact set across all runs, verified unchanged within each pair. Earlier campaigns are diagnostics and are not pooled into these numbers. The matrix contains 16 network pairs, six crowd pairs, four authority-stall pairs, lag switch, 1% fast clock, three phone runs, eight input profiles plus two regression repeats, and two complete fresh rounds in one paired run.

Candidate/live order throughout. Full per-profile counts, raw counts, sample sizes, input attempts and coverage appear in [COMPARISON.md](COMPARISON.md); machine-readable counts are in `RESULTS.json`, `AGGREGATES.json` and `VERIFICATION.json`.

| Item | Candidate / live | Sample size and scope |
|---|---|---|
| Non-host onlooker >3-tile jumps, network matrix | 0 / 360; raw 0 / 434 | 173,840 / 173,781 observer frames, 16 pairs |
| Host onlooker >3-tile jumps | 0 / 0, including raw | 86,970 / 86,936 frames, eight non-host-runner pairs |
| Non-host onlooker raw overlap passes (deep) | 22 (6) / 13 (2) | 141 / 41 visible overlap episodes |
| Host onlooker raw overlap passes (deep) | 14 (4) / 47 (26) | 58 / 104 visible overlap episodes |
| Stomp reappearances | 0/61 / 0/54 | Eligible nearby monster disappearances, 28 movement pairs |
| Authority stalls: owner snaps / observer holds ≥700 ms | 0/0 / 0/0 | 12 resumes: three 3 s, three 6 s, six 15 s; ten-second recovery windows |
| Authority-stall recovery observer jumps | 0 / 6 raw | Same 12 resumes |
| Lag-switch recovery: owner snaps / observer holds / observer jumps | 0/0/0 / 0/2/13 | 11 complete ten-second release windows per side |
| 1% fast clock: owner jumps / slides / freezes | 0/0/0 / 1/1/0 | 180 s, 10,856 owner frames each; observer jumps 0/25 |
| 4× CPU phone: frames >33 / >50 ms | 0/0 / 2/0 | Three exact 180 s windows, 32,403 frames each side |
| 2–8 players | All human counts verified; observer jumps 0/0 in crowd pairs | Six 180 s crowd pairs plus three-player network pairs; 65,228 / 65,186 crowd observer frames |
| Fresh rounds | 2/2 passed on each side | Reset, spawn, monsters/gold, results agreement and score agreement; no reconnects/errors |
| 300 ms host-profile owner phantom candidates | 24/32 / 2/6 catches | Two 180 s pairs; unresolved presentation discrepancy |

The raw overlap counts above are not silently discounted. An instantaneous live-authority catch may have no overlapping drawn frame, so visible-overlap denominators differ. The supplemental audit finds possible delayed stomp resolutions only when the contacted monster disappears and the runner gains a point in the same drawn frame within one second of contact ending. Remaining network flags are 9/11 (deep 0/1) for non-host observers and 7/41 (deep 0/24) for host observers. This supports interpretation, not certainty about coincident gold pickups or another runner's stomp. Across all primary-observer movement traces, raw passes are 53/42 (deep 25/14), including deliberate outages; all >3-tile jumps are 0/436 (raw 0/545) over 304,229/304,106 frames.

Phone frame p99 values are 19.0/18.9, 19.2/18.1 and 18.6/19.2 ms. Raw captures retain the control-release/shutdown tail: full-capture >33 ms counts are 3/2 and >50 ms counts are 1/0. Those tail outliers are outside the requested 180-second windows and are not erased. Full-capture phone owner movement flags are 0/3 jumps and 0/3 slides. The network owner trace also retains one candidate 1.55-tile forward/downward step during a fall; it is not reported as a snap-back.

Network settings are per direction: 0 ms without loss/jitter; 80 ms with 1% simulated loss and 30 ms jitter; 150 ms with 3% and 50 ms; 300 ms with 5% and 60 ms. The harness models ordered WebSocket/TCP retransmission delay rather than dropping ordered game messages. Every network profile has two 180-second repeats with both live-runner roles. Candidate server-rules players have no browser authority role. The live host's stalled-page observer capture is shorter in the authority-stall profiles; complete non-host observer captures supply recovery measurements.

| Input profile | Pairs | Run p90 ms (valid n), candidate / live | Jump p90 ms (valid n), candidate / live |
|---|---:|---|---|
| 0 ms / host | 1 | 33.1 (48) / 32 (48) | 34.8 (40) / 33.1 (40) |
| 0 ms / non-host | 1 | 31.2 (48) / 32.3 (48) | 30.6 (39) / 32.1 (40) |
| 80 ms / host | 1 | 30.6 (47) / 32.2 (47) | 30.3 (40) / 32.4 (40) |
| 80 ms / non-host | 1 | 31.9 (48) / 32.4 (48) | 32.3 (40) / 32.5 (40) |
| 150 ms / host | 1 | 33.3 (48) / 32.3 (48) | 33.3 (40) / 32.4 (40) |
| 150 ms / non-host | 2 | 35.9 (95) / 31.8 (95) | 31.5 (76) / 31.3 (79) |
| 300 ms / host | 1 | 32.7 (48) / 31 (48) | 32.6 (40) / 31.6 (40) |
| 300 ms / non-host | 2 | 34.3 (96) / 32 (93) | 35.5 (80) / 31.6 (79) |

The 150 ms non-host run disadvantage persists across repeats: +4.1 ms pooled p90. At 300 ms non-host, pooled run and jump disadvantages are +2.3 and +3.9 ms. Individual attempts remain in the comparison; no role or network condition is mixed in pooling.

The phantom detector flags geometric respawns with no drawn monster within 1.2 tiles during the previous 600 ms, excluding round resets. These are not individually confirmed invalid server collisions. A separate candidate-only `diedAt` audit found 15 of 33 explicit catches in the 300 ms host-profile pairs with no sampled nearby monster even over five seconds. The owner-minus-monster-scene clock gap at those catches has medians 0.870 and 0.851 seconds. That supports a timing-mismatch hypothesis, not an isolated causal proof. The accepted-report contact clock and buffered presentation clock still need a design that preserves both immediate owner input and the shared monster/remote-runner scene. No change was made merely to hide these flags. `CONTACT-GAP.md` and `u9-phantom-context.json` retain the detailed private evidence.

The fixes in this round retain 512 unique unacknowledged owner ticks with bounded validation work, preserve transport through stalls, grant bounded relay-resume grace, fence placement timestamps, and bound observer catch-up along actual movement paths. The final placement-anchor regression reproduces the pre-fix jump and passes afterward. Full toolkit CI on `92843051` passes: https://github.com/homie-rocks/homie/actions/runs/38892528404. Attempt 1 passed runtime checks but an app browser job hit `SQLITE_BUSY_SNAPSHOT`; rerunning failed jobs passed. Both attempts are retained.

Final `npm ci --ignore-scripts`, all 47 studio tests, and the strict build pass. Tiny Platformer generated play covers 18,000 ticks and 813 save/restore comparisons. All 14 installed overlay files and the build identity match the toolkit checkout; rebuilt artifacts match the measured artifacts byte for byte. All six phone and eight round screenshots were reviewed locally; this is a builder review, not independent review. HUDs, phone JUMP controls and result cards render. Co-located runners can overlap their world labels.

The detached control worktree and both owned dev servers are removed/stopped after measurement. Only owned processes were stopped. Raw traces, frozen harnesses, load logs, screenshots and reproduction tools remain in the studio branch. The PR remains unmerged and the studio remains undeployed. The requirement to remove every regression is not yet met; replacement of live is not approved by this proof.

The chronological diagnostic campaigns and superseded interim statements are retained in [DIAGNOSTICS.md](DIAGNOSTICS.md). Only campaign `u9-` supplies the final-runtime measurements above.
