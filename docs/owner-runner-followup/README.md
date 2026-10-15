# Owner runner follow-up — 14 October 2026

Follow-up to the independent pt6 review of PR #116 / 00299316 and studio 9240a05. No version bump, merge or deployment. **Status: NOT READY.** Clock recovery, contact coverage and confirmed-score changes are proven in the completed trials. The phone gate is not met, and sustained shared-machine load still ends branch rooms.

## Changes

1. **Room clock and acknowledgement.** Every ordinary authoritative snapshot carries its room tick even when no report was accepted. Validated owners now use that tick and half the measured RTT to steer their clock by up to ±2%, without steering their position. Reports outside the validation window reach the validator and cause an explicit revision/resync instead of disappearing in the host's old future-input filter. Queue overflow also explicitly resyncs. A sufficiently far-behind owner with no unacknowledged movement rebases. A revision after a server suspension hard-rebases the clock and pose.
2. **Contact history.** Tiny Platformer uses at most 150 ms of historical monster positions. Older or future report stamps use current room-time monsters. The setting is a game constant, not a global netplay rule.
3. **All accepted paths.** `world.movement(id, kind)` exposes immutable, revision-fenced movement states accepted in the current server tick. The game checks all three physics substeps of every accepted report, including intermediate gold crossings. A catch invalidates the old revision. Duplicate reports cannot award twice. Transient paths add no durable save columns.
4. **Confirmed HUD score.** Predicted gold/stomp visuals still respond immediately; the predictor no longer increments the displayed score. Points wait for authority, including while disconnected.
5. **Recovered remote movement.** An owner snapshot whose displacement exceeds plausible travel during that server-snapshot interval is drawn as a cut. It is not interpolated at the backlog delivery rate. Several separately delivered batches can still produce several cuts.
6. **Drawing cost.** Landing checks use nearby indexed boxes rather than all 121 map boxes. Validated-owner readers share presentation within a document animation frame, with input/simulation invalidation. Predictor field cleanup uses a precomputed name set. The studio caches the monster's three drawing substeps for the tick instead of repeating tile physics each display frame. A behavioral test compares 27,216 positions, including backward reads and rebirths, exactly with uncached physics.
7. **Overrun.** An isolated scheduler suspension starts the observation window when callbacks resume; it no longer counts the whole suspension as already sustained bad throughput. The existing sustained-overrun protection remains enabled, including in the production Worker adapter. Sustained machine contention still ends branch rooms; those failures are retained.

## Method and evidence

Detached live control: studio **75b280c** (the pt6 live 0.51.5 control), `/tmp/owner-live-control`, port 8792. Branch: isolated built copy in `/tmp/owner-branch-proof`, port 8791, with the local toolkit patch. The original playtester's tools are unchanged; hashes are in `tools.json`. GPU Chrome uses the same drivers on both sides. Most trials run one matched pair at a time. An early two-pair batch overloaded the shared machine and is retained as failed evidence. The machine also runs unrelated workloads; load averages are observations, not injected or controlled load.

Raw captures, scripts, original logs and profiles: `/tmp/owner-followup` (`runs/*-frames.json.gz`, phone captures, `batch.jsonl`). The compact audits are checked in beside this report. `b-` is branch; `c-` is detached live. Do not infer a passing five-run comparison by discarding failed branch runs.

Commands use the supplied `pt6/tp/cmp6.mjs` with `--only shape --skip-presses --obs3`, matching both bases:

- Stalls: `--seconds 60 --delay 80 --loss .01 --stall-every 20 --stall-ms 3000` or `15000`, with only the test-owned workerd PIDs suspended.
- Clocks: `--seconds 105 --delay 80 --loss .01 --drift .99` or `1.01`.
- Third-player fairness: `--seconds 60 --delay 300 --loss .05`.
- Lag switch: `--seconds 60 --delay 80 --loss .01 --ls-hold 400 --ls-every 500 --kami`.
- Reconnect: `--seconds 60 --delay 80 --loss .01 --rc-every 20 --rc-ms 6000`.
- Phone: original `phone.mjs --seconds 180 --cpu 4 --delay 60 --loss .01 --jitter 20`, actual touch controls and about 10,800 frames per side.

## Observations

Two 3-second freezes: branch ends with owner/server lead **0 ticks**, score **7/7** on owner/observer versus live **8/8**. Two 15-second freezes: lead **1 tick**, score **3/3** versus live **1/1**. Neither branch room ended during these isolated-stall trials. The last five seconds contain **246/300** moving observer frames versus live **130/301** after 3-second stalls; **231/300** versus **82/300** after 15-second stalls (movement threshold .01 tile). This demonstrates resumed remote movement, not a claim that intentional freezes have no visible interruption.

At 0.99× clock for 105 seconds, branch ends at **1 tick** lead and **14/14** points versus live **13/13**. At 1.01× for 108 seconds under load, lead is **16 ticks**, points **17/17** versus **15/15**. There is no permanent report-discard freeze in these completed trials. Virtual-time ±1% tests run for 100 seconds with **zero rejected reports and <4 ticks lead**. The loaded browser fast-clock result is materially worse than the isolated test and is retained.

The 400/500 ms lag-switch trial records deep own-screen missed side contacts **2/9 touches** versus live **4/11**. Third-player deep pass-throughs are **0/0**. Observer catches without a nearby drawn monster are **11** versus **3**: checking all paths and limiting history does not eliminate every visual fairness mismatch. Behavioral game tests independently prove that an intermediate gold crossing counts once and an old intermediate side touch is checked against the current monster even when the final report is past it.

Two 6-second reconnect outages hold branch HUD points at **3 throughout** and **6 throughout**, returning at the same values. Final score is **9/9** versus live **1/1**. The branch's large remote steps in the four-second recovery windows have maximum consecutive run length **1 frame**; they are isolated cuts, including multiple separate batch cuts, rather than a multi-frame fast-forward. Live has no >1.5-tile steps in those same recovery windows, but its score did not persist through the second reconnect. This audit includes respawn cuts and does not label every large step a defect.

Across the six completed paired stall/drift/switch/reconnect scenarios, the playtester's painted-pose pop detector finds **0 branch one-frame pops versus 1 live**. Hard resyncs after genuine clock loss can cut; this is not a claim of zero large own steps during server suspension.

Five completed matched one-minute third-player trials at 300 ms + 5% loss (`fair2,7,8,9,12`, 312/311 seconds branch/live) record **0 versus 5 deep pass-throughs**, and **2 versus 12** pass-throughs at the looser threshold. Observer catches with no nearby drawn monster are **17 versus 12**, so the improvement is not universal. The first four precede the final monster-drawing cache; the last uses it. The exact-drawing test covers that cache's positional equivalence. Failed load trials `fair4,5,6,10,11` remain failures; `fair3` completed capture while its room clock stopped progressing under contention (leadEnd 398) and is not counted as a healthy fairness trial. `fair1` tested an earlier clock formula with excessive resets and was corrected before the final stall/drift trials.

| 4× CPU phone pair, ~10.8k frames each | Branch >33 ms | Live >33 ms | Outcome |
| --- | ---: | ---: | --- |
| Indexed landing checks (`phone`) | 13 | 3 | Gate failed |
| Frame cache and predictor cleanup (`phone2`) | 22 | 10 | Gate failed |
| Monster-path cache (`phone3`) | No complete capture | Live completed | Branch room overran; failed pair |
| Same final code, retry (`phone4`) | No complete capture | Live completed | Branch room overran at tick 3077; failed pair |

Both complete phone pairs had zero in-solid frames, unexplained jumps, skips, slides and held-key stalls on both builds. The final two branch failures prevent any claim that the monster cache brings frame times to live. `phone3` began near machine load 81; `phone4` began near 19 and ended near 29. Retrying under lower starting load did not establish readiness. No failed trial is replaced with an assumed passing result.

The final built client is `assets/main-2GZETR2X.js`; game rules build `0ead4650b9b964623a710515a0c30977`, runtime `b19d7ae930a3d138ce11ef83`. Earlier completed stall/drift trials use the same host/contact behavior before the drawing-only optimizations.

## Server cost and production limits

A focused core comparison replays eight honest reports for each of eight owners in one tick, against original 9240a05 contact rules and the follow-up contact rules, using the same current core. After 20 warmups, 100 measured samples:

| 64-report tick | Previous contact rules | All accepted paths |
| --- | ---: | ---: |
| Median process CPU ms | 1.825 | 2.545 |
| p95 process CPU ms | 7.277 | 9.702 |
| Median wall ms | 2.550 | 3.824 |
| p95 wall ms | 9.871 | 11.234 |
| Peak metered tick units | 39,317 | 105,584 / 500,000 |
| Rejected honest reports / errors | 0 / 0 | 0 / 0 |

This measures added all-path contact work, **not the entire owner design against live's browser host**, and is sequential on a shared machine. It shows measurable extra cost but substantial headroom against the 50 ms tick period in this fixture. It does not prove identical overrun probability under contention. The first wall-only run had long scheduler tails on both versions; raw logs are retained, rather than attributing those pauses to game CPU.

Production Cloudflare can hit the enabled overrun guard: it observes sustained callback throughput and attributes late callbacks to recent room work, not solely game CPU. Local machine load averages cannot be translated into a Cloudflare failure probability. [Cloudflare's runtime timing documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/) also specifies that deployed timing advances with I/O, unlike local wall-clock profiling; [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) supply additional platform CPU limits. No production deployment or production load experiment was performed. The isolated-suspension fix is proven; sustained contention remains an observed limitation.

## Verification

Toolkit build passes. Focused core/guard/validation checks pass (39 earlier checks, then 16 owner-validation checks including queue overflow). Presentation/reconnect/cache selection passes 66 tests, plus the explicit cross-microtask frame-cache test. Production-adapter and hostile/sustained-overrun selection passes 29 tests. Final clock/outage/presentation selection passes 13 tests. These selections overlap; they are not added into a misleading unique-test total.

Studio suite passes **37/37**, plus the subsequently added exact monster-drawing test (**1/1**). Strict game build passes and exercises 17,731 ticks and 804 restores; busiest tick **26,406/500,000** units. Generated Tiny Platformer rules are included; unrelated generated 2048 changes are excluded. Preservation browser results are recorded below after the paired run finishes.

The paired preservation run exercised all keyboard bindings, touch stick, jump button, tap-to-jump and TV with no runtime errors. Both branch reloads retained score; the live control reset score. The real-client forged-report run sent 342 modified branch messages across teleport, wall, speed, tolerance, velocity-only, future and past modes and stayed connected. The live wire uses a different protocol, so this forge hook modified zero live messages: it is **not** a matched security comparison. Core tests assert rejection/canonical-state behavior directly.

| Input p90 (ms) | Branch | Live |
| --- | ---: | ---: |

| 0 ms delay, run | 30.7 | 31.3 |
| 0 ms delay, jump | 30.7 | 24.8 |
| 150 ms delay, run | 29.8 | 32.1 |
| 150 ms delay, jump | 27.6 | 31.9 |

These are single paired batches, not universal latency guarantees. The zero-delay branch jump is slower than live; this receipt does not claim every original advantage has been preserved under every load.
