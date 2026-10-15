# Tiny Platformer: validated owner movement

Latest: [round 7 follow-up](round7/README.md), **NOT READY**. The measurements below are historical and do not replace the missing current-head proof.

The owning browser runs and draws the original runner physics. It sends each input tick with its pose and velocity; the server runs the same guarded move from the last accepted state and accepts numerical equivalence within 0.002 per axis. Canonical state prevents tolerance accumulation. Ordinary snapshots update game fields without moving the owner. Impossible reports and authoritative respawns, round starts and knockback cut to the server pose. Other players retain interpolation. Transient absence keeps ownership and bounded report history. Shared collision and save-row code match the toolkit base; there is no version bump, merge or deployment.

Toolkit PR: https://github.com/homie-rocks/homie/pull/116. Studio branch: arcade-server-rules. The studio uses the locally patched toolkit; its package pin is unchanged.

The supplied pt5 tools drove 21 matched branch/live pairs under the same load, with GPU Chrome, on this shared machine. Control was detached live main 4b7d42069b61cf51a42180eea801fab36693a49a, toolkit 0.51.4. Network conditions include 0–300 ms delay, jitter, up to 5% loss, 2/6-second outages, backgrounding, CPU ×4, eight players and a five-minute run. No more than two matched pairs ran concurrently. Game build: f31f521c131e0acfb673f9fd21503a4d; client asset: assets/main-FTCQMV3V.js.

| Measurement | Validated owner | Detached live |
| --- | ---: | ---: |
| Captured matrix frames | 78453 | 78442 |
| Captured seconds | 1314 | 1313 |
| Painted one-frame flicks ≥1 tile / minute | 0 | 0 |
| In-solid frames | 0 | 0 |
| Correction slides | 0 | 3 |
| Multi-tile slides within 1.5 s after placement | 0 | 0 |
| Raw frames against held key | 1 | 0 |
| Against held key, excluding authoritative placements | 0 | 0 |
| Turn bounces / eligible turns | 0/296 | 0/320 |
| Held-key stalls | 0 | 0 |
| Correction snaps (runtime probe) | 0 | 0 |
| Phantom catches / catches | 6/37 | 41/78 |

Latency is the median of three matched batch p90s at each delay, with every batch retained in results.json, including the first slower branch batch. Zero-delay run/jump: 27.5/24.4 ms vs live 30.7/31.5 ms. At 150 ms: 31.6/26 ms vs 31.3/30.8 ms. These repeated measurements capture scheduling variation; they do not establish a universal latency bound. The 150 ms run comparison misses the literal ≤live gate by 0.3 ms (31.6 versus 31.3); the first zero-delay batch was also slightly slower. No passing batch is substituted for these results.

All keyboard bindings, touch stick, jump button, tap-to-jump and TV were exercised. Jumps remain 5.105–5.108 tiles and about 0.82–0.83 seconds. Short taps, three complete rounds, eight late-joined seats, reload, ten-second page pauses, network outages, the CPU-throttled phone run, the standard check and controlled server restart are recorded in results.json. The phone run has zero in-solid frames, slides or unexplained jumps on both builds. Both reloads retain the branch score; live resets it. A real stop/restart of the owned test server retained the branch round, player score 3 and room total 10, with no page reload; both pages rejoined within 863 ms after the server became available. The live restart entered a new round and reset scores. Startup durations differ because the frozen branch starts Wrangler directly whereas the control runs its normal build/dev command; they are not used as a latency comparison. Forged speed, teleport, gravity, wall crossing, duplicate/reordered reports, time bursts and tolerance accumulation are covered by executable tests.

There are 331 distinct toolkit view/core/collision/validation tests and 35 studio tests (the original 34 plus exact monster-patrol verification). The large view suite exhausted heap in one process and was completed in batches: 254 completed tests, 42 remaining tests, plus the new corner test; 34 core/collision/validation tests also pass. The strict build played 18,000 ticks and compared 813 restores, with a maximum 17,959/500,000 tick units. No save-row expansion was needed.

Audit interpretation is explicit: the raw against-key counter includes required respawn cuts. The literal raw against-key comparison therefore misses the requested ≤live gate, 1 versus 0. There are no ordinary against-key movement frames on either build. The branch's observed case cuts from (17.954,31) to the exact spawn (20,31), with diedAt changing; it is retained in the raw count. ana4 also counts one 1.64-tile normal run across a 110 ms frame gap as a large step; the runtime and supplied unexplained-jump detector record no snap. Its respawnsNotCut flag can also fire when round metadata arrives before the placement frame; the actual multi-tile post-placement slide count is reported separately above. The game's older prediction.corrections diagnostic compares server wall ticks with local input ticks and is not a count of owner corrections in this mode; painted-frame audits and the runtime probe are the evidence here.

An earlier preflight found two embedded interpolation frames at local tile-corner landings. The opt-in renderer now shows the valid local landing step when a blend would enter a tile, with a behavioral regression test. A later six-second pair and reload pair were invalidated by two automatic dev-server reloads before the planned outage; both were rerun against frozen runtime/assets. The dedicated stop/turn tool needed only the live position-reader adapter already used by cmp5/phone. Its driving sequence and thresholds were unchanged. Across those dedicated 0/150/300 ms trials, branch/live had 0/0 backslides and 0/0 bounces (70/69 stops and 35/34 eligible turns). The first standard check was invalidated by a shared-machine load spike: its room ended on a server-overrun guard and the harness completed in a replacement room. Both sides were rerun in isolation; that clean uninterrupted check is the one retained as the final result. Forced offline-port console messages are retained and counted separately from unexpected errors.

Reproduction: build the studio with this toolkit patched into node_modules; create the control with git worktree add --detach /tmp/arcade-control main. Run the supplied pt5 jobs1/2/3, cmp5, spike, spikep, stops and ana4 tools in paired branch/control trials. Preserve the paint frames and analyze them before accepting a change. The ≥1-tile audit uses spikep's same algorithm with the requested threshold changed from 0.5 to 1. Detailed results and selected compressed traces live in docs/receipts/validated-owner in the toolkit repository; local full traces are /tmp/owner-proof. The temporary control and only the processes started for this task are removed/stopped after proof.
