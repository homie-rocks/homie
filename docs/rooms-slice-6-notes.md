# Rooms slice 6: movement that answers immediately

Implemented on main `51227fc`, released in this branch as studio 0.38.0 / plugin 0.39.0. No deployment was made. The game skill is unchanged. The final gate and packed-studio results are recorded below; earlier failed runs are retained as the implementation log.

## Implementation decisions

- Follow design section 6: fixed tick prediction, fractional render preview, authoritative replay,
  visual offsets for small corrections, and a corrected path played from its start for large ones.
- Keep server authority unchanged: server-moved bodies accept typed inputs, never predicted positions.
- Keep the existing adaptive interpolation for other bodies and add the configured floor.
- Compare the original Gem Rush before removing its implementation. Its visual code and controls
  are retained while authoritative game state moves to declared rules and movement.

## Evidence

Measurements below distinguish the final passing runs from the failures that led to the clock and smoothing fixes.

## Baseline and implementation decisions

The old Gem Rush simulation, copied into `test/fixtures/gem-rush-before.ts`, ran five sets of twenty 60-second rounds with three Fair bots: total scores 3410, 3351, 3329, 3297, 3324 (mean 3342.2, range/mean 3.38%). Crossing from rest took 4.6333 seconds at 60 frames/s. These are baseline numbers, not results for the converted game.

The canvas continues to draw in pixels (50 pixels per metre). Rules and motion use metres. Visual tunables retain their pixel units; reach and knock distance are converted to metres in public tunables.

Prediction keeps authoritative fields separate from the local body. The replay never runs handlers or awards scores. Effects on the own body wait for the matching snapshot, because a host sends its effects before its snapshot; otherwise a flash could play before reconciliation starts the hold.

Browser motion now uses field accessors with the server's scalar-write coercion and collection copy/settle accounting. The previous browser path coerced only after the call, which could let subsequent reads inside `move` differ. The build check captures movement before phase-two handlers, replays it through the browser path, and compares its whole body including motion.

PR #73 merged on 2026-10-09. Rebased this checkout onto origin/main (8d58fa9) before release work.

Initial `npm ci` completed (135 added, 159 audited; npm reported two high advisories). Initial `npm run build` passed. The initial view suite passed 60/63: three 60-Hz handoff checks reported input-rate drops. Investigation found that adopting every snapshot reset input deduplication; that reset is now limited to rebases. These results predate the final prediction tests and are not final gates.

The converted rules' three Fair bots ran five seeded sets of twenty rounds: totals 3151, 3168, 3262, 3188, 3250; mean 3203.8, 4.14% below the old baseline; range/mean 3.46%. All runs reported zero handler errors. This is inside the design's 15% score and 5% variation tolerances. Movement crossing and knock timing still need their own checks.

The virtual-time feel matrix allows five seconds for the connection's initial 100 ms RTT guess and eight lead samples to settle before measuring steady movement. A first pass after only two seconds showed the design-required clock rebase in the 300 ms / 30 Hz and 60 Hz cases. Startup rebases must be reported separately from steady-play corrections.

First real-Chrome matrix: 36 shaped network cases (37 test counts including the parent), all assertions passed. Input-to-drawing-frame latency was 6.4–15.6 ms on approximately 16.7 ms frames, with zero offset-cap teleports. The receipts nevertheless showed occasional backwards frames; this is a finding to fix, not a passing no-rubber-band claim.

Two details emerged. Float rounding can put exactly three ticks of travel a few millionths of a metre above the catch threshold, so the threshold now has a 10-micrometre comparison tolerance. Also, a browser host adds a second network leg behind the relay: the helper's ping measures the relay, not that host. For a browser-hosted room, the initial/rebased clock uses the greater of that ping and twice the median snapshot age on the helper's synchronized clock. An online hosting browser still sends its inputs through the relay, so it retains the helper RTT; only offline input uses zero. This fills in the browser-host case of section 6.1 without another wire message. Server-hosted clock initialization is unchanged.

Clock rebases discard lead samples still in flight for two measured round trips plus one tick. Otherwise samples stamped by the previous clock can immediately rebase the new clock again. The browser-host path uses median snapshot age; its 5th percentile underestimated the full path under jitter. The matrix now rejects backwards frames and steady-play rebases, rather than only reporting them.

The ten virtual-time prediction cases passed, including a late press preserved exactly once. Gem Rush crossed in 4.65 seconds (0.36% from the old 4.6333), held for its first knock tick, landed within 1 cm at 3.70 m and resumed steering from rest. Gem Rush determinism passed all three comparisons: server/browser saves at all 2,400 ticks with/without handovers, workerd versus Node, and Chrome versus Node.

## Packed studio trials (local only)

A fresh studio was scaffolded from this checkout's packed 0.37.0 toolkit in `/tmp/rooms-slice-6-trials/fresh`, with Gem Rush and Coin Dash, and run through `homie-studio dev`. Both starters passed the toolkit's two-browser round check. A copy of `/Users/ryan/Studios Test/codex-studio`, made without its node_modules, built its four old-style games and passed each two-browser round check: Cinder Circuit (64,361 ms), Lantern Ferry (78,851 ms), Signal Bloom (104,792 ms), Stormbreak (161,741 ms). The original studio was not modified. Its unchanged test suite passed 377/377, with no failures or skips. The temporary copy was then deleted.

The first capture helper stalled before controls, so that attempt is not feel evidence. Direct Chrome frame capture worked, but synchronous picture writes in the same process as the delay proxy interfered with its timers: snapshot ages reached 326 ms instead of the intended 75 ms. That recording exposed repeated clock rebases and a visible jump. The final capture isolates the proxy from recording and holds pictures in memory until capture ends. It does not change the game runtime. The long-running Chrome matrix also now measures twelve seconds of steady movement per case (rather than 2.8) and asserts that input changes the picture on the very first drawing frame.

In the final two-window 150 ms added-RTT recording, actual RTT was 156/158 ms median and 157/162 ms p95. During the recorded controls neither window rebased or hit the offset cap. Window 1 received a real knock: its 2.542 m reconciliation error entered catch-up once; the other window needed no correction. The recordings and frame traces are kept outside the repository in `/Users/ryan/.homie/rooms-slice-6-evidence`. Visual inspection and the final release gates will be recorded below.

I inspected both recordings as contact sheets, including 20 frames/s across the first knock. The victim flashes, holds, then follows the slide into its landing; the other window shows the same event through interpolation. There was no placement jump or clock rebase during either final recording (16.57 and 16.70 seconds). Frame traces confirm one 2.542 m correction on the victim, handled as catch-up with no offset-cap teleport. The ordinary movement capture before arranging the knock also had no correction or rebase in either window. These are local Chrome/workerd trials, not measurements of a deployed Cloudflare room or a physical mobile network.

The first full suite was stopped after 208 reported passes: inspection found generic build fixtures editing Gem Rush `src/main.ts`, which no longer exists. Tests of the old wire, generic asset/build operations and fake deploy plumbing now explicitly scaffold Ember Vale instead of inheriting the changed default. The starter-scaffold test still uses Gem Rush and checks its view entry and server host; its rules build, cross-runtime determinism and real two-browser trials remain separate coverage. This is a fixture migration, not removal of legacy behavior tests.

The steady 90 ms / 20 Hz server action check sent 30 presses: own authoritative response median 160 ms, p95 179 ms; another player's view 247/262 ms. These pass section 6.5's 170/220 and 280/350 ms limits. A prior version that also added ±25% per-leg jitter measured 175/201 and 259/287 ms: the own median missed the steady-network target, so it is retained as a stress observation, not called a pass. The full bad-network matrix keeps jitter and loss; the special 90 ms reference row uses a steady connection.

The migrated generic build fixtures passed 12/12, with no skips. A fresh full `npm test` run follows. Test files run sequentially through a temporary Node launcher (`--test-concurrency=1`, 1.5 GiB heap limit); the actual npm script and its test selection are unchanged. `CHROME_PATH` is set and `HOMIE_TEST_MINIFLARE` points at the installed module so the workerd checks run. The interrupted first full run is not a release gate pass.

The twelve-second matrix found failures missed by the earlier 2.8-second sampling: backwards frames at 300 ms / 10% loss (20 Hz server and browser) and 150 ms / 10% loss (30 Hz browser). These are not accepted passing feel results. The rest of the matrix is being collected before the focused trace analysis.

The long-run trace isolated the large backwards frames to clock rebases, not movement replay. In the 60 Hz / 150 ms server case, movement had zero corrections while the target grew past ten ticks; then a rebase moved the picture back 3.627 m. Raw lead values from different clock rates were being counted as network jitter. The view now retains its short clock-rate history, removes the sending clock's phase from each lead observation, and projects the control median onto the current phase. The authority RTT estimates when the observed input was sent. This makes the design's median/jitter calculation compare one clock, rather than treating intentional steering as jitter. The half-tick floor, 40/8 windows, ±5% steering limit, four-tick rebase threshold and visual correction defaults are unchanged. Four 25-second virtual-clock regressions cover this at 20/60 Hz and 150/300 ms.

The four 25-second clock regressions passed in the second full run, as did the existing virtual prediction/reconciliation cases. All 27 real-Chrome handoff trials (three trials each of hide, close and yield at 20/30/60 Hz) had zero tick rewind and zero duplicated effects. The real delayed-network matrix in that run had already bundled the runtime before the phase correction, so its seven failures remain the before-fix evidence; a fresh Chrome run is still required.

Second full `npm test`: 1,435 tests, 1,417 pass, 14 fail, four skip, no cancellation (3,091.31 s). Seven failing network cases plus their parent used the pre-phase-fix bundle. Six other failures were migrated-starter fixture assumptions (three Lab, one performance map listing, one explicit owner-movement build check, one view source path); those are fixed pending rerun. The skips were two missing-Wrangler browser proofs and two optional Stripe mock checks. This is not a passing release gate.

After clock-phase normalization, the focused real-Chrome checks passed at 20 Hz / browser host / 300 ms with 2% and 10% loss, and at 60 Hz / server host / 150 ms with both loss rates. All four responded on the first drawn frame (11.0–13.9 ms), with no steady rebase, backwards step beyond 1 cm, ordinary catch-up or offset-cap jump. The 20 Hz / 10% case had two corrections, at most 0.600 m; the other three had none. Each unseen push was reconciled through catch-up. The fixture recheck passed 61/62; its remaining performance assertion assumed netplay was in the entry rather than a shared chunk. Checking the actual built chunk inputs fixed it, and the targeted map test passed.

## Measurement method

The Chrome matrix uses a minimal 6 m/s rules fixture, real timers, real WebSockets and the view runtime's real drawing loop; the packed-studio trials below separately exercise both actual starters. Its network shaper uses a fixed random seed, dropping 2% or 10% of input/snapshot messages and varying each leg's delay by ±25%. The table's delay is the added client-to-relay round trip. A server host sits at that relay; a browser host has another shaped leg, so the complete authority round trip is approximately twice the listed delay. This tests dropped application frames rather than TCP retransmission behavior. Other protocol messages are delayed but not dropped.

Each case warms for twelve seconds, measures twelve seconds of continuous movement, then applies an authoritative push unknown to the predicting client. `inputFrames` counts drawing callbacks until the changed position is first painted onto the canvas; milliseconds measure input to that callback. This is input-to-draw evidence, not a physical display photodiode measurement. Corrections are replay position disagreements, in metres. Startup rebases are reported separately. Smoothness reports the other player's p95 and maximum per-frame distance, backwards frames, and percentage of held frames; a held frame is not necessarily a hitch (for example, the other body has not started yet through interpolation). The 90 ms, 20 Hz server action reference has no jitter or loss and sends thirty presses, measuring authoritative effects on the own and other view.

The matrix rejects an own-body backwards step larger than 1 cm during continuous steering, any rebase after calibration, any excess-offset teleport, any response after the first drawing frame, and failure to adopt the unseen authoritative push. Small float/timer noise remains visible in the recorded minimum step rather than being rounded away.

The next full run enabled the optional Wrangler browser proofs. Every starter passed the real play-page/embedded-post proof. The 130-update continuity proof completed two ten-update rooms, then its dev process disappeared during the third room's rebuild; the browser proof had no dev-exit supervision and waited forever against a refused port. Its retained dev log ended after the strict type-check message, with no exit reason. I terminated only that proof's own process group to let the rest of the suite continue. This is a failure, not a skipped or passing continuity result. The test now races the proof against dev exit (reporting code/signal and its log) and has a thirty-minute outer limit; its 130 updates and assertions are unchanged. A rerun must establish the actual dev-exit cause or pass before this work is ready.

The phase-normalized full matrix had zero steady rebases in all 37 cases. Two 20 Hz browser-host cases (150/300 ms, 10% loss) still reversed briefly as small corrections overlapped; all 30/60 Hz cases passed. I stopped that already-failed full run after collecting its complete matrix, rather than call it a gate pass. Receipts are `feel-before-overlap-fix.json` outside the repository.

The design specifies each small correction's 100 ms fade but leaves their overlap unspecified. Restarting one fade for the entire accumulated offset can erase several ticks of travel within 100 ms. Small corrections now queue their individual configured fades instead: an existing fade finishes before the next starts. A large correction still starts catch-up immediately, replacing the small-correction queue with its own offset; placement/rebase clears it. A deterministic 600 ms round-trip test drops two input frames and jitters snapshots: before the change, eleven corrections of at most 0.300 m produced four backward frames; after it, no backward frames and exact convergence to server position after stopping. All fifteen focused virtual prediction tests passed. No smoothing default or catch threshold changed.

Main advanced to 51227fc (apps, PR #72) while the supervised continuity rerun was still running. I stopped that now-superseded rerun with its own studio's `dev --stop`, rebased onto the new main, retained main's apps changes and template fingerprints, and took the next free studio/plugin versions: 0.38.0 / 0.39.0. The release gates and final packed trials must now use that base. The game skill has no diff from this new base.

The first run on the apps base exposed its new mixed app/game fixture. It used macOS's noncanonical `/var` temporary path, so the linked rules guard could not match canonical source paths. The fixture now uses `realpathSync`, like the rules fixtures. Its generic `build --types` then caught five Gem Rush source typing issues not reported by the declaration-derived build: callback parameters without contextual types and generic entity seats being optional. Equivalent loops and explicit seat fallbacks fix those without changing valid game behavior. The mixed apps suite passed 5/5. I stopped that failed full run early, before its long browser proofs, to validate the repair first.

The next full run reached the expanded embedded-player proof and found a fallback-room timing assumption: the movement helper captured its baseline once a seat was assigned, although a server rules body arrives in the next snapshot. A null baseline can never satisfy the movement comparison. The helper now waits for its actual body before measuring; room identity and movement assertions remain intact. The failed run was stopped before the long continuity proof to recheck this directly.

On the apps base, the supervised continuity proof passed: 1/1, no skips, 1,325.63 seconds total. It completed all ten rooms with ten updates at ten-second intervals, then the thirty-update room at five-second intervals. The prior dev exit did not recur; its original cause was not established, so the earlier run remains recorded as a failure. The embedded-player proof also passed 1/1 after waiting for the authoritative body before measuring movement (97.64 seconds including cleanup).

The next full gate passed the long 130-update continuity proof (1,201.15 seconds), apps and embedded-player proofs, then failed two of 37 Chrome matrix cases: 60 Hz/server/300 ms/2% loss rebased once, and 60 Hz/browser/150 ms/10% loss caught a 0.500 m disagreement with seven backward frames. The suite was stopped after collecting its complete matrix; it is not a gate pass.

Both failures now have deterministic regressions. A sixty-seed virtual-time sweep reproduced the clock problem with seed 60: lost feedback left the last -5% steering command active for over a second, carrying the clock past its target. Steering now updates every frame against the phase-adjusted median, even between feedback rows. The four-tick rebase threshold and half-tick lead floor stay unchanged.

Seed 42 reproduced the large correction: a 0.400 m late-input disagreement at 60 Hz crosses the three-tick catch threshold. Thus the design's assumption that a larger disagreement necessarily comes from a handler does not hold under frame loss. Catch-up still begins at the snapshot and plays at 1.25x, but its offset fade is bounded by 80% of distance travelled along the corrected path. This extends the nominal 100 ms fade when removing the offset faster would pull ordinary movement backwards. It preserves a stationary hold and the full authoritative slide; once the corrected path stops after catch-up, the remaining offset finishes over the configured blend time. This is an explicit refinement of section 6.3's offset rule, required by the bad-network no-rubber-banding requirement; it changes no server state or movement. Twenty-one focused virtual prediction tests passed after both repairs.

The first complete-matrix rerun with continuous steering found another boundary in the blend rule: 20 Hz/browser/300 ms/10% loss had eight corrections, one as large as 0.900 m (still within three ticks), and six backward frames, at most 0.050 m per frame. Queuing each correction fixes overlapping fades, but a single 0.900 m correction erased in 100 ms still moves the offset at 9 m/s against a 6 m/s player. The progress bound therefore also needs to cover small corrections, not only catch-up offsets. The failed trace is retained; this run is not a passing matrix.

A sixty-seed virtual-time sweep reproduced that small-correction failure with seed 43, at the same 0.900 m maximum and eight corrections. Both classes of offset now use the progress bound. A queue advances only one fade per draw, including the frame on which that fade finishes, so two adjacent fades cannot spend the same frame's travel twice. A stationary predicted body releases the remaining offset over the configured blend time after catch-up, so smoothing cannot retain a permanent disagreement. All 28 focused prediction tests passed, including seeds 42 (large correction), 43 (small correction) and 60 (stale steering), and exact server convergence after stopping. The next Chrome matrix additionally bounds actual frame-to-frame displacement during the unseen push, rather than relying only on the runtime's excess-offset counter.

The complete Chrome matrix with progress-bounded fades passed: 38/38 tests (37 scenarios and their parent), no skips, 997.48 seconds. Every scenario changed the first drawn frame in 8.6–15.6 ms. There were no steady rebases, backwards own-body frames beyond 1 cm, or excess-offset jumps. Ordinary corrections ranged from zero to fifteen per twelve seconds, at most 0.600 m. All authoritative unseen pushes won and met the actual per-frame displacement bound; their largest measured step was 0.397 m. Other-player p95 steps were at most 0.120 m, but the harshest loss cases still had occasional holds and catch-up through the existing adaptive interpolation (maximum step 0.771 m; held frames up to 10.57%, including initial interpolation lag). The reference thirty presses at 90 ms had own-effect p50/p95 158/173 ms and other-effect 232/247 ms.

### Full-gate Chrome measurements

The same 37 scenarios also passed inside the complete `npm test` gate: every first drawing frame changed in 10.4–15.1 ms; zero steady rebases, backward own-body frames beyond 1 cm, or excess-offset jumps. There were at most fifteen ordinary corrections per twelve seconds and the largest was 0.800 m. All unseen pushes won and passed the frame-to-frame displacement bound (largest drawn step 0.396 m). The other player's largest p95 step was 0.120 m, maximum step 0.732 m, and held-frame share 10.01%. The table below is this full-gate run; the earlier standalone receipt remains `feel-standalone-final.json` alongside `feel-gate.json`.

| Delay ms | Loss % | Hz | Host | First draw ms / frames | Corrections / 12 s | Largest m | Other step p95 / max m | Other held % |
|---:|---:|---:|---|---:|---:|---:|---:|---:|
| 50 | 2 | 20 | server | 12.5 / 1 | 0 | 0.000 | 0.108 / 0.118 | 1.3 |
| 50 | 10 | 20 | server | 11.5 / 1 | 5 | 0.600 | 0.112 / 0.126 | 1.8 |
| 150 | 2 | 20 | server | 12.8 / 1 | 0 | 0.000 | 0.108 / 0.114 | 2.1 |
| 150 | 10 | 20 | server | 12.1 / 1 | 0 | 0.000 | 0.107 / 0.120 | 4.6 |
| 300 | 2 | 20 | server | 12.8 / 1 | 0 | 0.000 | 0.110 / 0.120 | 3.9 |
| 300 | 10 | 20 | server | 13.4 / 1 | 0 | 0.000 | 0.114 / 0.128 | 4.0 |
| 50 | 2 | 20 | browser | 10.4 / 1 | 0 | 0.000 | 0.108 / 0.126 | 1.9 |
| 50 | 10 | 20 | browser | 14.4 / 1 | 0 | 0.000 | 0.114 / 0.120 | 3.3 |
| 150 | 2 | 20 | browser | 12.5 / 1 | 0 | 0.000 | 0.107 / 0.120 | 3.3 |
| 150 | 10 | 20 | browser | 12.0 / 1 | 0 | 0.000 | 0.120 / 0.126 | 4.2 |
| 300 | 2 | 20 | browser | 11.9 / 1 | 0 | 0.000 | 0.108 / 0.198 | 6.5 |
| 300 | 10 | 20 | browser | 10.8 / 1 | 0 | 0.000 | 0.102 / 0.732 | 10.0 |
| 50 | 2 | 30 | server | 13.5 / 1 | 0 | 0.000 | 0.108 / 0.121 | 0.8 |
| 50 | 10 | 30 | server | 11.9 / 1 | 0 | 0.000 | 0.110 / 0.121 | 1.3 |
| 150 | 2 | 30 | server | 14.4 / 1 | 0 | 0.000 | 0.105 / 0.121 | 1.9 |
| 150 | 10 | 30 | server | 14.2 / 1 | 0 | 0.000 | 0.108 / 0.121 | 1.9 |
| 300 | 2 | 30 | server | 12.6 / 1 | 0 | 0.000 | 0.112 / 0.126 | 5.6 |
| 300 | 10 | 30 | server | 13.2 / 1 | 0 | 0.000 | 0.113 / 0.133 | 3.6 |
| 50 | 2 | 30 | browser | 13.2 / 1 | 0 | 0.000 | 0.109 / 0.127 | 1.3 |
| 50 | 10 | 30 | browser | 13.7 / 1 | 0 | 0.000 | 0.119 / 0.127 | 2.8 |
| 150 | 2 | 30 | browser | 12.0 / 1 | 0 | 0.000 | 0.109 / 0.124 | 3.5 |
| 150 | 10 | 30 | browser | 13.8 / 1 | 0 | 0.000 | 0.114 / 0.122 | 3.8 |
| 300 | 2 | 30 | browser | 15.1 / 1 | 0 | 0.000 | 0.108 / 0.121 | 5.7 |
| 300 | 10 | 30 | browser | 14.0 / 1 | 8 | 0.800 | 0.114 / 0.282 | 6.4 |
| 50 | 2 | 60 | server | 12.1 / 1 | 0 | 0.000 | 0.106 / 0.114 | 0.7 |
| 50 | 10 | 60 | server | 14.3 / 1 | 15 | 0.200 | 0.111 / 0.123 | 0.7 |
| 150 | 2 | 60 | server | 13.0 / 1 | 0 | 0.000 | 0.112 / 0.133 | 1.7 |
| 150 | 10 | 60 | server | 11.0 / 1 | 0 | 0.000 | 0.115 / 0.125 | 1.8 |
| 300 | 2 | 60 | server | 13.6 / 1 | 0 | 0.000 | 0.116 / 0.124 | 3.1 |
| 300 | 10 | 60 | server | 12.5 / 1 | 0 | 0.000 | 0.116 / 0.136 | 3.3 |
| 50 | 2 | 60 | browser | 14.1 / 1 | 0 | 0.000 | 0.107 / 0.138 | 1.1 |
| 50 | 10 | 60 | browser | 12.5 / 1 | 0 | 0.000 | 0.113 / 0.132 | 1.4 |
| 150 | 2 | 60 | browser | 13.8 / 1 | 0 | 0.000 | 0.113 / 0.137 | 3.2 |
| 150 | 10 | 60 | browser | 14.2 / 1 | 0 | 0.000 | 0.114 / 0.130 | 7.2 |
| 300 | 2 | 60 | browser | 13.6 / 1 | 0 | 0.000 | 0.119 / 0.133 | 6.0 |
| 300 | 10 | 60 | browser | 10.4 / 1 | 5 | 0.600 | 0.118 / 0.173 | 6.4 |

### Final packed 0.38.0 fresh-studio trial

A newly scaffolded studio from the packed checkout (`fresh-final`) built both rules starters with strict types and 18,000-tick checks each. Gem Rush covered 17 rounds and 813 save/restores; its busiest tick used 6,958/500,000 units and its largest save was 7,762 bytes. The standard real two-browser checks passed for Gem Rush (61,104 ms) and Coin Dash (61,214 ms), with both people on server replicas and a shared completed round.

Two visible Chrome windows then played the fresh Gem Rush through a separate 75 ms-per-direction WebSocket proxy. Their 16.57/16.60 second recordings contain 498/499 captured frames; the drawing traces contain 1,008/1,017 frames. Median/p95 measured RTT was 153/154 ms and 154/155 ms. There were no browser errors, new rebases, or excess-offset jumps. The victim had one 1.444 m authoritative disagreement handled by catch-up; the other player had none. The largest drawn steps were 0.381/0.208 m, and both windows' longest frame gap was 18.7 ms. I inspected full-recording contact sheets and 20 fps sequences across the knock: flash and hold, slide, then landing, with no visible snap. The recordings and frame traces are retained outside the repository in `/Users/ryan/.homie/rooms-slice-6-evidence` (`gem-rush-window-1.webm` and `gem-rush-window-2.webm`).

### Final packed 0.38.0 legacy-studio trial

A fresh temporary copy of `/Users/ryan/Studios Test/codex-studio`, without its node_modules, built Cinder Circuit, Lantern Ferry, Signal Bloom and Stormbreak against the packed toolkit. All 89 copied test files were verified byte-identical to the originals. Its unchanged suite passed 377/377, no skips (3.07 seconds). Each standard two-browser check passed: Cinder Circuit 61,990 ms, Lantern Ferry 76,932 ms, Signal Bloom 47,108 ms, Stormbreak 64,126 ms. Each still had one browser host and one replica. As before, Stormbreak's build reported two type errors in imported package source outside the game's own files; all four games' own strict type checks passed. No source in the original studio was written. Both trial dev servers were stopped after the checks.

### Limits

The matrix's first-frame metric is input-to-draw, not a photodiode measurement of a physical display. Network loss is deliberate loss of application input/snapshot messages; real WebSocket/TCP packet loss retransmits instead. All measured hosts were local Node/workerd or real Chrome, not deployed Cloudflare rooms (deployment was forbidden). The design's physical-phone-on-mobile-data question remains unmeasured: Xcode lists a paired iPhone, but no controlled mobile-data browser session or externally reachable test route was established. The standard two-browser checks include Chrome at phone size; that is not claimed as a physical mobile-network test. The nominal 100 ms offset fade is extended when necessary to avoid reversing ordinary movement, as documented above; the half-tick lead floor, median-of-eight feedback, four-tick rebase threshold, three-tick catch threshold and 1.25 catch-up speed remain as designed.

## Final release gates

Each requested suite was run to completion. The full test suite used `CHROME_PATH`, local workerd, Wrangler 4.145.0 for the optional real-browser proofs, and CI's pinned Stripe mock 0.206.0 (its macOS arm64 download verified by SHA-256). A temporary Node launcher added `--test-concurrency=1`; test selection was unchanged. No runtime source changed after these passing tests.

| Gate | Result |
|---|---|
| `npm ci` | Passed; 135 packages added, 159 audited |
| `npm run build` | Passed |
| `npm test` | 1,460 passed, zero failed/cancelled/skipped; 3,849.11 s |
| `npm run test:plugin` | 116 passed, zero failed, one skipped; 92.84 s |
| `npm run validate` | Marketplace and plugin validation passed |
| `node scripts/desktop.mjs --check` | Passed; packed 0.38.0 server answers 66 tools and five cards |
| `node scripts/changelog.mjs --check` | Passed; 59 versions, matching package copy, all 54 fetched release tags linked |
| `node scripts/publish.mjs --check` | Passed; 23 packages checked, studio 0.38.0 is the only new version, 22 already on npm; nothing published |

The plugin skip is its optional live-studio playtest, gated by `HOMIE_PLAYTEST_URL`, which was unset. The requested fresh and existing studio checks ran separately and passed. The full gate includes the 130-update room-continuity proof (1,196.56 s), all 37 prediction scenarios, all twelve thirty-second traffic scenarios, and all 27 host hide/close/yield trials at 20/30/60 Hz (zero rewinds, duplicated effects or missing effects). Gem Rush's 2,400-tick Node/workerd/Chrome comparisons, with and without handovers, passed. Release tags were fetched; the existing rolling-upgrade checks select releases strictly older than the current package version, so the publish job's own tag is not treated as an older release.

Cleanup completed: temporary trial studios, packed tarballs, Stripe mock, test launcher and temporary root Wrangler links were removed. Measurement receipts, recordings and gate logs remain outside git in `/Users/ryan/.homie/rooms-slice-6-evidence`.
