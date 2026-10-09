# Rooms, slice 7 — work in progress

Slice 7 moves the remaining starters to server-run rules and adds the third
dimension to the shared movement runtime. The milestone design is the authority;
the game skill belongs to slice 8 and is not changed here.

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
