# Rooms, slice 7

Slice 7 moves the remaining starters to server-run rules and adds the third
dimension to the shared movement runtime. The milestone design is the authority;
the game skill belongs to slice 8 and is not changed here.

## 0.40.0 release-gate repair

Initially rebased onto main's #81 (`39f2cd9`), retaining its prediction history-boundary,
clock-recalibration and carried-offset fixes and virtual-time test matrix.
Studio and all plugin manifests name 0.40.0. PR #78 merged while the local gate
was running, so the branch was then rebased onto `9e3ac4d` as well. Its 0.39.0
changelog and template history are preserved below the new 0.40.0 entries.
The MCP completion assertion and predecessor-tag selection retain main's fixes.
The earlier measurements below describe earlier commits, not this final gate.
The root test command is restored to main's normal parallel runner; the old
serial/heap-cap workaround for real-time matrices is no longer needed. The
in-progress serial validation was stopped to test this actual release command.

The shipped starter matrix now runs 54 deterministic cases: three starters,
50/150/300 ms RTT, 2%/10% loss, and seeds 417/1/2026. Each opens two fresh
views and a real host/relay implementation on virtual time, with independent
packet streams per connection, direction and message kind. Drawing intervals
cycle through 16/16/33/5 ms. It checks initial response, continuous position,
unit facing, remote poses, jump/landing, stable clocks and no correction snaps.
Per-case pose digests make repeated runs comparable. Later direction changes
can legitimately hit a wall or a knockback hit-stop; initial response is checked
in clear space, and continued movement is checked across the whole path.

Three Chrome release smokes (one per starter at 90 ms without loss) retain real
WebSockets, rAF response, actual canvas pixel checks, remote poses and Hero's
jump/landing. Exact numerical correction and clock invariants belong to the
virtual matrix. The original eighteen wall-clock delay/loss cases remain in
`npm run test:rules:extended`, now using the same independent seeded shaper.
The existing Chrome/Node 2,400-tick replay comparisons retain their virtual
clocks in the gate: they check agreement across JavaScript runtimes.

The previous [Node 24 CI failure](https://github.com/homie-rocks/homie/actions/runs/38003994918/job/114068469637)
was Hero at 50 ms/10%: one correction snap versus the asserted zero, while its
maximum drawn step was 0.154 m, all recorded inputs responded on the first frame,
and there were no rebases. That count invariant is now tested on virtual time.
The same job also hit the touch-receipt race already fixed by main's #81;
that fix is retained. The new deterministic faults below are separate findings,
not a claim to have reconstructed the old wall-clock packet ordering.

The matrix found two real faults:

- Gem Rush 3D and Hero Rush 3D chased an absolute knock endpoint after collision.
  Blocked travel accumulated, then burst around the obstacle. Each tick now
  spends only its incremental eased travel. The focused obstacle regressions
  fail on the old moves (Gem tick 248: 0.489 m versus 0.446 m available; Hero
  tick 249: 0.826 m versus 0.220 m available) and pass with the fix.
- A fresh jump/turn replaced the fractional preview using time already elapsed
  in that tick. Hero seed 1 at 150 ms/2% moved 0.318 m in a 5 ms drawing frame.
  Input now preserves the pose at the instant of change through the bounded
  blend, then advances with elapsed time. Four tick-phase regressions require
  no instantaneous displacement and response within the next 5 ms. Carried
  blends are coalesced so changing analogue input cannot grow a queue per frame.

Local repeat verification: **3 × 54 = 162 deterministic cases passed**, with
identical pose digests and complete probe receipts across all three runs.
They took 134.1, 72.2 and 95.4 seconds under varying concurrent machine load.
A further Node 24.21.0 pass also passed all 54 cases with identical receipts
to Node 22.23.3. The [matrix receipt](rooms-slice-7-release-matrix.json) records
all 54 digests.
The final three Chrome canvas smokes passed in 80.0 seconds. The existing
182-case view suite and all four new tick-phase regressions passed; the nine
focused crossing/score/obstacle/input checks and TypeScript build passed too.

Pre-#78 root `npm test` with main's parallel command: **2,318 passed, 12 skipped,
0 failed**, 2,330 tests, in **975.7 seconds (16.3 minutes)**. The skips require
optional local Wrangler, stripe-mock or the Miniflare environment setting; CI
starts stripe-mock. In that loaded full run the three starter Chrome smokes took
92.1 seconds and main's four shared prediction smokes took 121.8 seconds.
Changelog validation against `origin/main` and `git diff --check` also passed.

Post-#78 root `npm test`: **2,337 passed, 12 skipped, 0 failed**, 2,349 total,
in **816.6 seconds (13.6 minutes)**. The first CI attempt passed all six checks.
Its confirmation rerun exposed a phone-check measurement fault: an eight-event
touch ramp can reach the arena wall before its final-point receipt starts timing
on software Chrome. Measured presses now establish direction with one real touch
move; holds retain their ramp. The bounded-arena browser regression injects
350 ms per touch event and fails on the old ramp (zero measured movement), then
passes both horizontal directions with the fix. The 600 ms limit is unchanged.
CI must pass twice consecutively after this fix; the earlier pass does not count.

Further validation reproduced two Gem Rush issues inherited from the 2D rules
migration. A held phone stick with a small sideways wobble could stop tangential
travel at the arena wall, unlike the original per-axis clamping. Three virtual
wall-contact cases (0/20/100 ms, seed 417, uneven frames) fail before restoring
sliding and pass afterward; the real packed-studio phone holds and alternating
presses then pass too. Existing crossing/knock timing and twenty-round scoring
checks still pass. The three new cases were repeated three times independently.

The next Linux CI attempt also caught a negative Canvas arc radius during perf:
an effect delivered by `updateView` could be newer than the rAF timestamp passed
to paint. The shipped view now paints with the current monotonic time. Its
virtual paint regression delivers an effect 500 ms after the supplied rAF time;
it fails with radius -278 on the old code, then checks the initial and expanding
ring with the fix. These faults are fixed in code, without relaxing gate limits.

## Earlier verification (before the release-gate repair)

Rebased onto merged Slice 6, `origin/main` at `91be345`; final fetch confirmed
that base was still current. Studio 0.39.0 / plugin 0.40.0 are the next releases.
The game skill has no diff against main. All five shipped starters use rules;
Ember Vale retains its 2D renderer and play.

- Clean `npm ci` and `npm run build`: passed.
- Final `npm test`: **2,263 passed, 3 skipped, 0 failed; 2,266 total**, in
  4,226.355 seconds (70.44 minutes). Includes all nine migrated-starter
  determinism checks, all eighteen 3D network cases, all 37 shared prediction
  cases, 3D collision, save/restore, build checks and full-room budgets.
- `npm run test:plugin`: **120 passed, 1 skipped, 0 failed; 121 total**.
- `npm run validate`, desktop, changelog and publish checks: passed. Desktop
  served 68 tools and five cards; changelog checked 62 versions and 57 tags;
  publish found one new package version and 22 already on npm. Nothing published.
- An isolated clone with this release's own tag passed all **3/3** predecessor
  upgrade tests. No release tag was added to the shared repository.

The three package skips require an optional local Wrangler installation (apps,
starter player addresses and 130 local updates). Separate packed-studio trials
passed all five starter room checks and the 130-update continuity proof in
22.8 minutes. The plugin skip requires `HOMIE_PLAYTEST_URL`. The eight copied
real-studio builds and room checks passed, as did Codex's 377 tests and Moonbase's
eight. The original official studio's missing Halocline helper and two placeholder
failing test scripts remain unchanged and are not passes.

Final receipts are `gates/npm-test-clean-final.log`, `feel-reviewed-final.json`,
`budget-node.json`, the three `*-reviewed-final` capture folders, and the
`*-reviewed` copied-studio logs. Earlier runs below are a chronological record,
not replacements for the final clean gate. Temporary studio copies and capacity
folders were deleted; the local mock was stopped and evidence retained. No
remaining temporary test directories link to this checkout. Production Cloudflare
T1 capacity and billing remain unmeasured because this task forbids deployment.

## Initial inspection

- Coin Dash and Gem Rush already use rules plus view. Gem Rush 3D, Hero Rush 3D
  and Ember Vale still host their simulation in a player's browser. The design
  leaves no shipped starter on that path; existing ported games keep it.
- Ember Vale uses Canvas 2D deliberately. Its migration must retain its cloud
  hero saves, hardcore memorials, guide goals, director and bot behavior.
- The two 3D arenas have flat playable ground. Their procedural rolling terrain
  is decoration outside the arena. Hero Rush's jump, facing, swing windup,
  airborne dodge and knockback need deterministic motion in three dimensions.
- The runtime already packs three-axis poses, but rejects `dims: 3` in the core.
  Map sweeps, entity collision and spatial queries still use two dimensions.
- PR #77 was open when inspected. Release numbering and the final rebase wait
  for its merge and the newest main.

## Verification record

- `npm ci`: completed, 135 packages installed, 159 audited.
- First focused 3D collision suite: 4 tests passed, 0 failed. It exercises fast
  impacts, movement above scenery, platform landing/walk-off, takeoff, ceilings,
  three moving shapes and two static round shapes, and invalid map declarations.
- Repository `npm run build`: passed after the initial runtime and Gem Rush 3D split.
  This does not typecheck a starter's generated rules/view faces; that separate
  check is in progress.
- All three converted starters pass 2,400 ticks in Node, workerd and Chrome,
  with repeated restores/host handovers every 137 ticks: 9 tests passed. Inputs
  follow snapshot spawn revisions; assertions require movement and Hero jumps.
- Hero's first real-timer 150 ms RTT trials (2% and 10% application-frame loss)
  passed: first-frame response, zero snaps/rebases, 13 landings each, 59.88 fps.
  These use actual rules/move with a simple measurement canvas, not the final renderer.
- Fresh packed-studio builds exposed a missing `@types/three` dependency. Both
  3D starters now declare it alongside `three`, so strict view checks work in a
  newly scaffolded studio. The first fresh build passed after adding it.
- Full-room 36,000-tick exploratory runs reported no errors or budget stops.
  They omitted snapshot accounting and shared CPU with build checks; their timings
  are not the final budget measurements. A corrected run includes snapshots.

## Decisions in progress

3D body positions refer to the feet. Capsules are upright; a box's radius is its
horizontal half-width. Circles in a 3D map remain vertical columns (the existing
arenas' obstacles block a jumping hero too). Spheres use a centre and radius;
static capsules use a foot position, radius and full height. Static map data is
compiled with the game and included in its compatibility hash, not duplicated in
each save. The existing 2D collision path is retained.

The first Gem Rush 3D migration preserves the complete meadow renderer and model
loading, with the authoritative arena obstacles and spawns in `map/main.json`.
The movement uses the collision normal for a second, tangential sweep so that a
body slides around scenery. This still requires visual and timing validation.

The requested no-deploy constraint prevents the design's real Cloudflare T1
capacity trial. Local workerd results cannot establish that production capacity.

## Runtime and migration details

- Static geometry uses the same decoder in host and view. Existing 2D map hashes
  retain their old shape; adding empty 3D lists must not end existing 2D matches.
- Headings interpolate on a unit-vector arc instead of passing through zero on a
  half turn. Own heading corrections ease over the prediction blend interval.
- Grounded animation changes on takeoff as soon as the pose rises, and only at
  contact on landing. Rendering never runs another gravity loop.
- Ember's guide reads the server's own skill level, while bots use the party dial.
  Kids mode and whether a party set its dial are available to deterministic rules.
- Original pre-migration simulation fixtures are kept for score/crossing comparisons.
  They use the original 60 fps functions; networking and drawing callbacks are inert.
  Legacy build coverage also retains a complete old Ember Vale fixture.

## Measured parity and prediction

Five sets of twenty bot rounds, compared with the retained original simulations:
Gem Rush 3D averaged 4,206.2 versus 4,310.4 points (−2.42%); Hero Rush 3D averaged
3,695.6 versus 3,695.4 (+0.01%); Ember Vale averaged 12,434.4 versus 11,869.2
(+4.76%). Each crossing time is within 2%. Hero's jump reaches the 1.05 m setting
within 2%. The twelve focused movement, collision and parity tests pass.

The real-timer prediction matrix completed all eighteen scenarios (three starters,
50/150/300 ms delay, 2%/10% input/snapshot loss): nineteen tests including the
parent, all passed. Each reports a one-frame p95 response with zero snaps or clock
rebases. Full-renderer recordings are a separate trial below.

Ember retains private solo play while an online room is full: an isolated offline
rules instance runs after four active seconds without a body, while the original
socket waits for a vacancy. It closes on placement and never sends its private
match state to the online room. The test fills eight seats, earns private progress,
then vacates a seat and checks that joining does not import the private match score.
Ember's separate persistent hero still earns experience in solo play and sends its
level through the usual hero command, preserving the existing save behavior.

## Copied studios (ongoing)

Both originals are untouched. Copies exclude node_modules, git and local runtime
state and install the packed toolkit. Codex studio builds all four games, retaining
the existing two external-package type diagnostics in Stormbreak; its 377 tests
pass. The official studio builds all four games. Moonbase's eight rules tests pass;
Halocline's movement and gun-feel assertions pass but its line-of-sight script
imports `tools/lib/puppeteer.mjs`, absent in the original as well as the copy.
Kart Royale and Span Nine have placeholder failing test scripts, not test suites.

The first full-renderer recordings ran two visible Chrome windows per game through
75 ms of delay in each socket direction. All six windows averaged 60.00 fps
(p95 frame interval 17.5–17.6 ms); no browser errors, correction snaps or clock
rebases during the recorded interval. One Gem Rush 3D window eased a knock
correction; both Hero windows showed JUMP, FALL, LAND, RUN, WALK, HIT and ATTACK.
Inspecting the recordings caught a HUD regression in Ember: the new round clock
reports fractional seconds, which the old label printed verbatim. The view now
rounds the displayed countdown up to whole seconds. The corrected capture is
recorded separately, not silently substituted for the first trial.

| Converted starter | Prediction scenarios | p95 input response across scenarios | Largest reconciled error | Recorded renderer fps (two windows) |
| --- | ---: | ---: | ---: | ---: |
| Gem Rush 3D | 6 | 5.2–16.8 ms, one frame | 0.949 m, eased | 60.00 / 60.00 |
| Hero Rush 3D | 6 | 6.4–10.5 ms, one frame | 1.021 m, eased | 60.00 / 60.00 |
| Ember Vale | 6 | 7.7–13.6 ms, one frame | 0.516 m, eased | 60.00 / 60.00 |

The Hero matrix recorded 80 landings and a maximum drawn height of 1.061 m.
The exact move test separately checks the 1.05 m jump setting. All nine final
2,400-tick Node/workerd/Chrome comparisons passed, including restore/handover.
All four Codex studio two-browser checks passed without reconnects. The tests
measure a 60 Hz computer display; the phone is Chrome's emulation, not a device.

Generic site/deploy/chat/old-host test setups previously copied Ember Vale precisely
because it was still browser-hosted. They now copy the retained pre-slice-7
fixture explicitly. Their feature assertions stay in place; the Lab and embedded
browser tests continue to exercise the shipped, converted Ember Vale. This keeps
old-game regression coverage after the last shipped old-style starter is gone.

## Budget measurements

The local measurement machine is an Apple M4 with 24 GiB of memory, running
Node 22.22.2 on macOS arm64.

Each row ran 36,000 actual rules ticks and one snapshot per tick. There were no
handler errors, skipped handlers or budget stops. Time includes snapshot encoding;
these local wall-clock measurements shared this Mac with the other trials, so the
p95 figures are reported alongside deterministic budget units, not as Cloudflare
processor-time claims. The configured per-tick ceiling is 500,000 units.

| Starter | Seats | p95 / p99 ms | Busiest tick, units | Ending save, bytes |
| --- | ---: | ---: | ---: | ---: |
| Gem Rush 3D | 8 | 0.124 / 0.432 | 23,898 | 5,523 |
| Gem Rush 3D | 32 | 0.969 / 1.693 | 123,419 | 14,926 |
| Hero Rush 3D | 8 | 0.458 / 0.692 | 26,735 | 5,879 |
| Hero Rush 3D | 32 | 2.859 / 3.900 | 179,363 | 17,374 |
| Ember Vale | 8 | 0.458 / 0.793 | 14,704 | 4,063 |
| Ember Vale | 32 | 2.362 / 3.223 | 73,174 | 12,184 |

The packed build's generated play additionally checked 18,000 ticks/813 restores
for Gem Rush 3D, 17,026 ticks/780 restores for Hero Rush 3D, and 20,400 ticks/980
restores for Ember (including its companion run). Largest saves were 7,921, 8,199
and 7,808 bytes respectively. Those are generated-run maxima; the table's save
sizes are the final saves of the longer, fuller runs.

The 32-client, 30-minute local 20 Hz trial completed 35,959 ticks (99.79% of the
36,034 ticks due over the measured 1,801.71 seconds) with zero host faults, core errors, budget stops or timer
slips. Every client's received tick sequence was complete; the worst client p99
snapshot gap was 66.2 ms and at least 99.44% of gaps were below 75 ms. This passes
the local steadiness thresholds despite concurrent builds/browser tests. The
30 Hz twenty-minute trial follows. This is a Node host plus real WebSockets,
not a Cloudflare Table capacity or billing result.

Cinder Circuit passed the old-game port check: keyboard and phone movement,
audio, sandbox, UI cover, common round, host departure, late join, TV and errors.
Its first run skipped WebKit because that dependency was absent in the copied
Codex studio; a separate WebKit row is being run with the installed dependency.
The official games do not expose the port probe in their original source, so
Halocline's extra port check failed those probe-dependent rows. Their standard
two-browser checks are the applicable checks and are running separately.

The follow-up Cinder Circuit WebKit movement row passed with no errors or skips.
Together with the first port run, every applicable row passed. Halocline's
standard two-browser check also passed, with the original browser-hosted runtime.

All five starters passed the standard two-browser check through the 150 ms proxy
with server hosting, and all five passed again after the temporary studio's
manifests selected browser hosting. Browser-host runs seated a host and a replica;
server-host runs seated replicas. The shipped manifests all select server hosting.
The temporary copies' source/test integrity check compared 234 Codex studio files
and 296 official studio files with their originals: zero differences.

The corrected Ember capture confirms the whole-second HUD and a saved hero after
reload. It is **not** a clean feel pass: local workerd ended the room through its
existing overrun guard at tick 661 while the full suites ran concurrently, then
both clients rejoined a fresh match. The trace records three/four clock rebases,
zero correction snaps and 60 fps. The failed capture is retained separately as
`ember-vale-corrected`; a quiet repeat is required before closing the visual trial.
No host watchdog was weakened to make this measurement pass.

## Continuation after the outage

The continuation inspected the uncommitted diff and retained the partial work and
receipts. The interrupted full suite was not counted as a pass. Review found two
prediction gaps: the browser and generated movement replay omitted the server's
vertical bounds, and catch-up drew historical position with current velocity,
grounded and motion. Both now use the same bounded body and historical pose. A
regression exercises floor/ceiling clamping and airborne catch-up animation.

The quiet Ember repeat (`ember-vale-quiet`) ran two server replicas at 150 ms added
RTT: 60.00 fps each, p95 frame interval 17.6 ms, no browser errors or correction
snaps, whole-second countdown, and the saved hero present after reload. The second
hero fell and respawned once (the expected placement rebase); the room continued
through ticks 335–654 without a host restart. This is distinct from the interrupted
earlier capture.

The 30 Hz capacity follow-up was interrupted by the outage at eleven minutes. Its
partial observations are retained, but are not a completed twenty-minute result.
The completed thirty-minute 20 Hz result above stands. Neither run establishes
Cloudflare capacity or billing; no deployment is authorized.

The continuation's `npm ci` installed 135 packages and audited 159; the build passed.
The full package gate runs with serial test files, the real Chrome path, workerd,
local Wrangler and a separate Stripe mock on port 12121. The npm script's test
selection is unchanged. Its result is pending.

Final repeated server captures of both meadow games used the resumed packed runtime.
Gem Rush 3D measured 59.99/60.00 fps, p95 frame interval 18.1 ms; its own victim
eased a 2.396 m knock through catch-up, with zero correction snaps or steady-play
rebases. Hero Rush measured 60.00/60.00 fps, p95 18.2/18.3 ms, with zero corrections
or steady-play rebases. Startup clock calibration is excluded from those deltas
and remains in the traces. Contact sheets at 15 frames/s across the knock and jump
show the hit hold, slide and landing, and jump/fall/landing poses without a visible
snap. Both windows have hundreds of distinct movement positions; Hero's animation
probe reports the airborne and attack states on both views. The earlier exploratory
Hero repeat used browser hosting; it is retained separately, not used for the final
server result.

All four official studio standard two-browser checks completed successfully. Its
missing Halocline test helper and two placeholder test scripts remain as described
above; these are not converted into claimed test passes.

Review also caught a bot-preset regression in the partial migrations: kids-server
aggression was capped at 0.5 rather than the old helper's 0.3. All three starters
now keep the 0.3 cap and the level-three reaction preset, including Ember guides.
Three focused regressions passed: ordinary Fair bots take a precisely chosen
action, while the kids preset holds it and keeps the slower reaction time even
when handed a higher server level. The full suite will include these cases.

The final companion review also caught a distinction hidden by the ordinary three-level trial: Ember's old `skillOf(slot)` uses the server level only for guides, not every AI body. The host now exposes a frozen `world.guideSeats` list derived from admitted peer roles and reserved guide slots. Its nonempty value is saved and checked; empty lists leave older policy save bytes alone. Ember uses that list to choose the server or party dial. Regression cases cover reserved and admitted guides, host restore, different party/server levels, and both bot and guide kids limits.

The first resumed full gate caught a host fault introduced during the companion
review: its policy lookup used the data-property reader on a world getter. The
130-update continuity test exposed the fault and stopped the room. The lookup now
reads the trusted getter directly. Six focused role, save/restore and kids-preset
checks pass. That already-failed suite was stopped; its log is retained, and the
complete gate is restarted against stable code.

The final budget repeat ran another 216,000 ticks after the guide-role fix. All six
runs finished with zero errors, skipped handlers or budget stops; the table above
now records that repeat. The guide-seat lookup adds 32/128 units to Ember at 8/32
seats. Earlier receipts are retained separately. The full package gate started
after this run completed.

## Second continuation

The fresh clean install and build passed; the uninterrupted full gate is running
serially. The retained final capture contact sheets were inspected again, including
the Gem knockback and Hero jump/landing sequences.

Review found that seat six's meadow spawn overlapped the camp. The old `bound`
function pushed it out on the first frame; a continuous sweep deliberately permits
an already overlapping body to escape, so an idle player could stay inside. Both
meadow maps now declare the old resolved spawn with a 1 mm clearance. A regression
checks every declared seat against the solid scenery. The full-room budget will
be repeated with this map correction; the shared movement code used by the recorded
trials is unchanged.

The 3D owner-movement escape hatch also performed its terrain support cast outside
a handler quota. That cast now runs under the movement budget, with a regression
that measures its charged map work. The shipped starters use server movement, so
this correction does not alter their movement or feel measurements.

The dependency PR's CI exposed a stale assertion in `scripts/studio-check.mjs`:
its performance trial still demanded a browser host after Gem Rush switched to
server hosting. The check now derives the expected pair from the generated game
manifest and reports the measured replica honestly. The packed-studio check will
exercise this path before completion.

The build report now identifies the highest completed capacity reference trial (32
Hero Rush players, 30 Hz, 20 minutes in Node on macOS arm64), and explicitly says that
Cloudflare capacity and billing are unmeasured. It distinguishes this reference
workload from a game's generated correctness check and flags rates above that
completed trial. The structured rules check and each rules game's JSON build result
include the same reference facts; legacy games make no rules capacity claim.

The ordinary regression suite also runs each converted starter with 32 bots for
2,400 ticks, including snapshot accounting, and requires no errors, skipped
handlers, cut ticks or budget stops. The longer 36,000-tick timing trial remains a
separate measurement rather than a machine-speed assertion in a build.

The uninterrupted package gate exposed an MCP test that assumed the rules build
finished inside the tool's 20-second initial response. The tool correctly returned
a running job. The test now follows that job to completion before asserting the
build result and progress feed, with a bounded wait and explicit failure checks.
This changes the test's use of the existing asynchronous API, not the build's
budgets or its verdict. The failed run is retained and is not a clean gate pass.

Before restarting that gate, the real Chrome continuity check completed all 130
updates successfully in 1,368.4 seconds (22.8 minutes), with play and watch pages
keeping their room. The already-failed run was then stopped. The final clean-install
gate will use the installed dependency set; the separate continuity receipt above
includes the optional local Wrangler executable used for that live proof.

The focused continuation regression run passed all 25 tests with zero skips:
MCP integration, 3D collision and charged owner support, all clear spawns,
32-seat quotas, old/new crossing and score parity, and kids/guide behavior.

The post-spawn budget repeat completed all 216,000 ticks with zero errors, skipped
handlers, cut ticks or budget stops. The table now contains that final receipt;
`budget-before-spawn.json` retains the previous run. Local timing improved with
less contention, while the deterministic quotas remain the portability check.

The 30 Hz repeat completed twenty minutes: 36,006 ticks in 1,200.764 seconds,
99.95% of the ticks due. All 32 clients received complete tick sequences. The
worst client p99 gap was 38.4 ms and at least 99.95% of each client's gaps were
under 50 ms. No client errors or closed sockets, host faults, timer slips, core
errors, skipped handlers, cut ticks or budget stops occurred. The local reference
reported by builds is therefore 32 players at 30 Hz. Both this and the separate
30-minute 20 Hz result are Node/WebSocket trials, not Cloudflare Table or billing
measurements. Raw receipts and final recordings remain in
`~/.homie/rooms-slice-7-evidence/`, indexed by its `README.md`.

At release preparation, #77 was still open with conflicts and failed CI. The branch
was rebased onto current `origin/main` (`1dadfa6`) while retaining the Slice 6 base
as `a961539`; no rules, netplay or starter code changed in that rebase. Main's new
setup behavior and metadata were retained. Studio 0.39.0 / plugin 0.40.0 follow
Slice 6's reserved 0.38.0 / 0.39.0, with both changelogs, manifests, Worker tag,
lockfile, template and template history updated. Dropping the carried Slice 6 base
still depends on #77 landing; this is not claimed as a post-merge rebase.

The packed 0.39.0 `scripts/studio-check.mjs --perf` passed from a fresh temporary
studio. Two real Chrome clients finished a round as server replicas in 62 seconds,
reporting 60/61 fps. Both performance runs passed the corrected role assertion;
the computer replica was playable at 280 ms, reported 64.5 fps in that separate
sample, 0.852 ms main-thread work per frame and 5.2 outgoing messages per second.
The check removed its temporary studio on completion.

`npm test` now runs test files serially with a 1,536 MiB heap cap, matching the
local verification conditions without a PATH wrapper. The real-timer Chrome
matrices and live update proof must not compete with every other package file in
CI. Assertions, rates, delays, loss and tick budgets are unchanged. The final clean
install added 135 packages and audited 159; npm reported two high advisories in
the existing dependency set, which were not changed by this slice.

The shared Git repository also contained an unpushed release-shaped tag on an
unmerged sibling branch, whose engine dependencies this checkout does not have.
Rolling-upgrade tests now select only older-version tags reachable from HEAD;
the release's own tag is still excluded by version. The publish job explicitly
fetches full history and tags, so the tagged-commit gate exercises the actual
predecessor releases rather than skipping for a shallow checkout. No sibling tag
or branch was changed.

The first release-version gate caught the carried 0.38.0 changelog section's
missing #77 link (it was previously the newest section, for which the link is
optional). Both changelogs now include the link. All 11 changelog regressions
passed; the full release gate restarted before its long browser matrices.

The restarted real-timer matrix caught a rarer Gem Rush 3D case at 300 ms / 10%
loss: a 5.42 m reconciliation error was eased, but one drawn frame traveled
0.868 m. A deterministic regression losing the knock's starting snapshots
reproduced 0.864 m in 16 ms. Offset fading was paced by actual path distance, so
a fast knock could also erase its correction and almost double its drawn speed.
Fading is now bounded by normal movement speed as well as path progress, including
the residual fade after stopping (with a 1 m/s floor for zero-speed bodies).
The physical knock and catch-up rate are unchanged. Large residual corrections can
take longer than the nominal blend interval. No continuity assertion was relaxed.
That failed gate was stopped; the complete view suite, real-timer matrix and final
renderer trials will be repeated before the final gate restart.

All 95 view/protocol tests passed after the fade fix, including handover, offline
recovery, clock calibration, late presses, 3D animation and the new regression.
That regression's largest 16 ms step fell from 0.864 m to 0.557 m, with zero snaps
and convergence to the authoritative ending position.

The repeated 18-case Chrome matrix passed after the knock fade fix: first-frame
response in every case, zero snaps and steady clock rebases. The receipt is
`feel-knock-fixed.json`; all earlier receipts remain available for comparison.

Main advanced to `8ea9dbd` (paid parts, Studio 0.37.2 / plugin 0.38.2) during
verification. The branch was rebased again, retaining its new dependencies,
payment code and migrations. Rules, netplay and all starters are byte-identical
across that rebase. The carried Slice 6 base is now `ce467ce`. Versions remain
Studio 0.39.0 / plugin 0.40.0. Template/history were regenerated with both new
migrations (35 template files). The clean install and all release gates restart.

The post-fix, post-rebase packed studio built all five games. The three migrated
starters ran Gem 18,000 ticks / 813 restores / 8,150-byte largest save, Hero
17,054 / 781 / 8,281 bytes, and Ember 20,400 / 980 / 7,825 bytes (including
2,400 companion ticks). Both visible Chrome windows for each held 59.88 fps
(median interval), with frame p95 at 17.5–17.6 ms and no browser errors. There
were no correction snaps or steady clock rebases; Ember's second player had
one intentional respawn placement. Saved hero reload passed. The final MP4s,
contact sheets, consecutive motion frames and measurements are in the three
`*-release-final` evidence folders. I inspected those frames: Hero's airborne
pose descends into landing, Gem's waves and turns remain coherent, and Ember's
combat and labels remain stable. No visible sliding or animation glitch was
found in these short captures.

The final 18-case matrix's first-response p95 ranges were Gem 2.8–10.0 ms,
Hero 2.8–11.4 ms and Ember 5.4–11.3 ms; every case responded within one drawing
frame. Hero recorded 78 landings. All 19 tests passed in 461.17 seconds.

All five standard two-browser checks passed again on the final package with
150 ms added round-trip delay, with zero reconnects through the results. Their
receipts are `release-final-server-*-check.json`. Trial servers were then stopped
before the full serial package gate.

The rebased full gate found an outdated exhaustive author-surface fixture: its
`Record<keyof GameWorld, true>` and guide context inventory omitted `guideLevel`,
`guideSeats`, `kids` and `levelSet`. The fixture now lists and type-checks natural
reads of all four in both contexts. The current run is allowed to finish to
collect any further failures; its result is not a passing release gate.

The complete rebased package run finished with 2,217 passes, one fixture failure
and three explicit optional-Wrangler skips (2,221 tests, 3,918.09 seconds). The
corrected contract suite then passed all 12 tests. Plugin checks passed 118 with
one skip. These are retained receipts, not the final clean package gate.

While gates ran, #77 was updated to reviewed head `45dcf326`, with green CI.
Slice 7 was rebased onto that reviewed Slice 6 head pending its main merge,
replacing the older carried base. Its camera-axis tooling, corrected catch-up
preview, preservation of drawn history and additional uneven-frame regressions
were retained. The preview now carries Slice 7's full 3D velocity, grounded and
motion data. Slice 7 retains its stricter correction fade cap and zero-speed
floor. As in the revised Slice 6 matrix, the 3D speed assertion measures elapsed
time on the pose's actual sampling clock; rAF timestamps still measure frame
pacing. View checks and final rendered trials repeat before the clean gate.

The combined reviewed-base view suite passed all 131 tests (88.50 seconds),
including 36 upstream uneven-frame cases and the Slice 7 knock and 3D pose
regressions. The packed toolkit was rebuilt and its installed view compared
byte-for-byte with the checkout. All six repeated visible windows held 59.88 fps,
frame p95 18.1–18.2 ms, zero browser errors and correction snaps. No clock rebases
occurred during play except one intentional Ember respawn placement. Saved hero
reload passed again. I inspected the new recordings' contact and consecutive
motion frames; no animation or sliding issue was visible. Final evidence now
uses the three `*-reviewed-final` folders; earlier captures are retained.

#77 merged at 21:38 UTC as `91be345`. Its tree exactly matched the reviewed
`45dcf326` base. Slice 7 was rebased onto actual `origin/main`, dropping the
carried dependency; the entire checkout tree was unchanged by that rebase.
Studio 0.39.0 / plugin 0.40.0 follow main's released 0.38.0 / 0.39.0. The game
skill has no Slice 7 diff against main. All five reviewed-base starter room
checks passed with zero reconnects. The refreshed Codex studio copy also built
all four games, passed all four room checks and passed all 377 tests.

The reviewed-toolkit real-studio repeat is complete: eight builds and eight
standard two-browser checks passed. Codex tests passed 377/377; Moonbase passed
8/8. Halocline again passed movement and gun feel before the same missing
`tools/lib/puppeteer.mjs` import; Kart Royale and Span Nine again exited from
their original placeholder test scripts. No game/test source was changed. The
second source comparison covered 520 files (234 Codex, 286 official, excluding
vendor directories) with no differences. Both temporary dev servers were stopped.
Raw results are `codex-*-reviewed.log`, `official-*-reviewed.log`,
`reviewed-{codex,official}-*-check.json` and `copy-integrity-reviewed.json`.

The first reviewed Moonbase room check finished successfully but recorded one
startup reconnect. A repeat with the same unchanged source and packed toolkit
passed in 157.568 seconds with zero reconnects and uninterrupted seats through
results (`reviewed-official-moonbase-repeat.json`); both receipts are retained.

Final ancillary gates passed: plugin 120 passed / one optional live-studio skip;
marketplace and plugin validation; desktop manifest and packed-server proof
(68 tools, five cards); changelog (62 versions); publish check (one new Studio
version, 22 unchanged packages already on npm). In an isolated clone only, adding
the release's own 0.39.0 tag still ran and passed all three rolling upgrades from
0.38.0, 0.33.0 and 0.32.1. The shared repository received no new tag. The complete
clean package gate repeats after these checks on the post-merge branch.

After #77's final changelog arrived, Slice 7's release notes stopped repeating
its shared knock-speed and performance-tool fixes. Slice 7's fixed notes name
its own 3D floor/ceiling and animation behavior.
This is a release-note correction only; the measured code is unchanged.

The clean post-merge gate's final 3D matrix passed all 18 cases. First-response
p95 across the six network cases was Gem 3.6–16.8 ms, Hero 3.2–11.1 ms and Ember
3.8–16.6 ms. Every measured response used one drawing frame; all cases had zero
snaps and steady clock rebases. Largest corrections were 2.859 / 1.021 / 0.568 m
respectively, eased rather than placed. Hero recorded 78 landings. The final
receipt is `feel-reviewed-final.json`; previous receipts remain separate.
