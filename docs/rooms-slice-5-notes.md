# Slice 5: every room feature with the server in charge

This implements the runtime part of design sections 3.10 and 4. It does not change a package version or changelog, as requested for the concurrent slices. Nothing was deployed, no credentials were used, and no new library was added.

## What changed

The host uses the existing `useAgents` helper on its tick clock. The helper now optionally accepts a clock, an explicit beat and saved state; its ordinary browser timer remains the default. Goals, outstanding guide asks, avoidance and pacing survive a host save. Goals are copied into the body's read-only `self.goal` before `think`, with `at` expressed in ticks. `goalDone` clears the goal and lets an unheld guide run its floor on the following tick. A changed body or holder forgets the previous guide's goal.

Guide views and floors run through the core's existing guard and tick budget. Views receive a frozen body and cannot write shared state or consume the room's random state. Declared view fields are retained by compilation, coerced and bounded. Views are cached for two seconds; the floor runs at the existing one-second cadence and uses the current goal and asks. Asked-for goals carry through until done or sixty seconds; a different argument to the same goal does not evade that rule. Held AI views and lines pass the relay's existing validation and pacing. AI clients with their own hands still have authoritative inputs and acknowledgements.

`world.ask` now queues a named request and uses the relay's existing `decide` service. Only one request of each name is open across the room. Replies enter on a tick. Refusal, invalid picks or five seconds of ticking without an answer runs the pure floor. Late and duplicate replies do nothing. Pending requests and replies survive a save; a restored outstanding request is not charged a second time and can reach its floor deadline. A reply from an obsolete host cannot enter its replacement. A finished match drops its old requests, just as it drops events for its old entities. Faulty game floors are guarded and counted as game failures, rather than allowed to run outside the budget.

The build checks decision declarations with the existing `checkDecide` validator. Its smoke run uses next-tick floors and exercises guide callbacks when `agents.json` exists. The view bundle gets the vocabulary, renders AI lines with `useAgents`, offers ask buttons, and sends asks by entity ID. The rules build is still loaded lazily from `lib/build.mjs`.

The relay remains responsible for seats, tokens, chat/review, votes, watching, signed controls, server policies and AI admission. Watcher speech with `from: null` now passes through the host. Bots are removed through their normal leave path when a round starts under `bots: off`.

## Decisions where the design met the code

- The format already checked `shapes.view`, but threw its compiled fields away. `Compiled.view` retains them; no game format changes.
- `useAgents` previously owned a browser timer and wall-clock timestamps. Optional manual ticking and save/restore reuse that implementation in the host instead of introducing another agent runtime. Existing games keep the default behavior.
- The relay retained only a normalized vocabulary; the helper consumes the public `agents.json` form. The relay retains both and hands the original to the host through an internal `vocabulary` frame, before joins when installing a host.
- The design names `room.askButtons(id)` without requiring a game to calculate the guide's view again in its browser. An additive host event, `agent:offer`, shares the bounded declared view at its existing two-second cadence. Replicas accept it only from the current host. `agent:goal` and `agent:ask` events carry the helper's UI notifications. The AI's `agent:view` and `agent:do` protocol is unchanged. `askButtons` also accepts the helper's optional `offer` argument, and a `player` argument offers the asking player's seat.
- Slice 1's ask guard tests used dummy question declarations and synchronous floor execution. Their fixtures now use valid score questions and wait for the live decision deadline. They still test large, deep and hostile answer values without relaxing their bounds.
- Question validation stays in the lazily loaded build module. Importing the whole provider module into the browser-neutral rules compiler makes the bundler resolve a provider SDK's Node dependencies; the runtime therefore validates returned picks locally against the three declared question shapes.
- A held AI may have its own game client (`hands: self`). Its input uses the same queue and control table as a person's; when no input exists, `think` remains its fallback. This preserves the existing room protocol.
- The host originally required a numbered sender for all events. A watcher has no seat; speech is relayed for that case while commands still require a seat.

## Original implementation evidence

`test/rules-features.test.mjs` has fourteen outcome tests using guarded rules and the real host/relay: seats, tokens and waiting; saved guide goals, completion and carry; AI views/goals/lines and policy removal; AI self input; refusal/deadline/AI/local decisions; obsolete host replies; watchers and big screens; chat and reactions; votes and owner controls; entity answers; callback budgets and purity; new holders; saved requests and invalid picks; chat review/history; and the view's vocabulary, buttons, asks and Quiet AI. `test/rules-view.test.mjs` additionally proves follow, Auto on leave and follow on reconnect with the server as host.

The combined rules, agents, watching, servers and rooms/stats run passed 108 tests. The final feature file, including the additional floor-budget and duplicate-name case, passed 14. The brains/Clef/chat run passed 38. The hostile-rules file passed 18. These use Node and virtual time, including the actual view module; they are not headless-browser proof.

A temporary studio inside this checkout used Wrangler 4.145.0, the template's existing exact pin. Its registry, logs and config were directed into that studio. `dev --port 18795 --no-local-ai` reported that the game sockets were local. A rules fixture with `agents.json` and `decide: true` built and ran on workerd. Its real WebSocket proof reported:

```
PASS local Worker: server host, watcher without a seat, scripted guide floor and input, a vocabulary ask, an entity decision floor, and token reconnect to the same body.
```

Coin Dash's capacity was set to 32 in the temporary studio only. The existing `bot-client.mjs` clients chased coins for two minutes, using the measurement from `rules-exit.mjs`. While other tests ran, all clients received 100% of ticks, but only 93.15% of snapshot gaps were under 75 ms; worst p99 was 139.2 ms. This missed the runner's 99% gap target and is retained as evidence, not described as passing. A second, quieter two-minute run seated clients in all seats 0–31 and passed: 100% of ticks, at least 99.42% of gaps under 75 ms, worst p99 72.1 ms. Neither measurement establishes Cloudflare performance.

The independent second review ran both full suites on a fresh clone of the preceding revision: `npm test` finished with 798 passes, two skips and no failures; `npm run test:plugin` finished with 116 passes, one skip and no failures. Installation, build, leak audit and desktop checks also passed. This supersedes the earlier list of excluded tests and the claim that the full suites could not pass. Local browser-launch restrictions are environment evidence, not repository failures.

## For the next author

- Merge the small `host.ts`, `core.ts`, `room.mjs`, `view.ts` and `rules-build.mjs` additions alongside the other slices. Do not make `rules-build.mjs` an eager import in `build.mjs`.
- New save fields (`asks`, `agents` and `guideViews`) are optional when loading older saves. The helper stores milliseconds on the room's tick clock; `self.goal.at` is converted to ticks.
- The server sends `vocabulary` and receives `decided` internally; the transport adapter for browser-hosted rules must preserve those paths. Views accept `agent:offer` from the current host's seat, including the server's null seat.
- No provider, admission, allowance or signed-control implementation was replaced. Existing decision allowance and house-agent services remain in charge.
- Real Cloudflare/Workers AI and billing proof is intentionally not done.
- Proposed changelog: Server-hosted rules rooms now run AI seats and scripted guides, preserve goals and asks, render vocabulary-based guide controls, and answer game decisions through the existing decision service with guarded deterministic fallbacks. Room features have server-host tests and a local 32-client measurement.

## Review corrections

- B1: person and watcher speech loses the AI marker and claimed identity; replicas require the current host for guide lines and guide UI events.
- B2 and M6: the runtime fills the policy's reserved seats independently of practice bots, using AI drivers. People cannot take these bodies through ordinary seat allocation. Admitted AI roles come from relay facts; unheld reservations use the policy's guide/party role. Away people and ordinary bots run `think` without goals. AI results are marked as AI before the Table counts them.
- M1: the two forbidden words were removed, the false passing claim above was corrected, and the conflicting root summary was deleted. The audit passes on the repaired checkout and a fresh clone with the public remote.
- M2: an ask is removed before its one floor attempt. A throwing, empty or malformed floor yields one answer with `why: floor-error` and valid default picks, and records one failure. The default is false, zero, or the first declared choice. This preserves exactly one answer without requiring games to add a second failure protocol.
- M3: a floor attempt closes the guide ask, even when it refuses or fails. Ordinary browser helpers retain their one-second cadence and can replace a floor goal. The explicit `carryFloor` option lets the rules host opt into the design's 60-second carry through its floor. This distinction is documented in NETPLAY.md.
- M4: own-key vocabulary checks cover the helper, relay, provider parser and renderer. The core independently validates goal IDs and declared arguments. Restored helper context is validated before a rules floor reads it; restored asks are coerced to their state declaration. Saved goals are validated against the vocabulary and saved declared view before any callback reads them. Both view caches retain their timing across saves; restoring before every tick agrees with uninterrupted execution.
- M5: regression coverage now includes each test file named by the change table, plus Worker/Table tests using real SQLite migrations, socket admission, policies, signed controls, house guides, pause and recorded rounds.
- Minor corrections: bounded decision reasons; no effects from a guide view; goals in snapshot entities; buttons only for AI slots; documented guide events and internal frames; optional agent helper excluded from view bundles without a vocabulary; live-mode hostile answers restored. The root review summary was removed.
- The repeatable runner is `packages/studio/test/rules-measure.mjs`. Its `--prepare` option creates a Coin Dash studio with the requested seat count and a local dependency on this source revision; the built seat count also configures the per-address allowance. Its header gives the preparation, local start and measurement commands. Earlier measurements above remain historical local evidence, not a new performance claim.

The separate pass-reuse finding was also reproduced: a second socket with the same verified pass now resumes its existing seat and replaces its old socket.

The review probe directory was absent from this checkout. The described hostile cases were reconstructed as repository tests. Versions and the changelog remain untouched.


## Repair validation

The reconstructed regressions were run against the original code before the repair: 22 of 23 selected cases failed. The additional repeated-pass case and the restore-before-every-tick case also failed before their fixes. The required change-table files now include server-hosted cases: agents, watching, rooms/stats, and servers. The test named “humans-only removes it” also asserts that practice bots leave under `bots: off`.

The no-vocabulary view build excludes the agent helper; its regression checks the generated bundle. The host still includes the helper because server reservations, restored decisions and vocabulary installation are runtime responsibilities. No package versions or changelog entries changed.

## Second review corrections

- M1: creating or converting a reserved body now emits a seat change, as releasing one already did. Changes to policy kind, reserved count or guide count also invalidate the roster. Worker/Table regressions switch live open rooms to hybrid and beginner, exercise both converted and newly created companions, check the rendered view's ask buttons, submit working asks, change guide roles without changing the count, and release reservations. No intervening join is needed.
- M2: a reserved body's name always comes from the bot-name table, including helper slots and round results. Freeing a seat also deletes its previous holder's name. Worker/Table regressions cover a kicked person, an expired person's seat and a kicked pass AI.
- Pass reopens: the verified pass resumes one seat in browser-hosted games as well as server-hosted games. This is an intentional change to both modes. Reopens are limited on the stay, not the socket, to one per four seconds and eight per minute. A refused retry leaves the incumbent socket and body untouched. The Worker/Table test sends forty reopens, checks the single replacement and bounded join/leave traffic, then tests both recovery and the minute limit.
- Score answers: both external answers and floor answers must choose an integer index. Fractional values take the normal invalid-answer or floor-error path; tests observe the actual value delivered to rules.
- Damaged saves: asks and guide tables are shape-checked before iteration, pending ask metadata is validated and duplicate names are discarded. Cached views are coerced as before. Before helper carry can delay a floor, its active goal must pass the core's vocabulary and argument checks. An invalid restored goal is discarded and the floor can decide immediately. Tests cover strings, null rows and an unoffered place with `asked: true`.
- Capacity: a server-hosted room ignores `hello.max`, uses the build's capacity when installing its host or updating seat limits, and does not recover a client's smaller limit from an older server save. The Worker/Table test fills the human seats, observes waiting and seats a verified pass in the reserved range. A separate restore regression covers the older-save case.
- Browser helper semantics: NETPLAY section 18 now records argument matching, carry across argument changes, asks without a decide callback and a declining floor leaving the standing goal unmarked. Default browser cadence is unchanged.
- The isolated runtime crash under memory pressure and the pre-existing confusable typed-name behavior were not attributed to this slice by the review. No unrelated runtime or name-filter change was made.

The review's probe folder was unavailable here. Its cases were reconstructed in the repository tests and observed failing before fixes. The additional argument-table commit was retained. The change-table test files (`agents`, `watch`, `rooms-and-stats`, `servers`) remain present with server-hosted coverage. Package versions and the changelog are unchanged, and the root review summary is absent.

## Current validation

All test processes used `--max-old-space-size=1536`. The completed main and plugin commands used a temporary Node launcher to put `--test-concurrency=1`, `--test-force-exit` and a 120-second file timeout before the test paths. This kept files serial and prevented failed browser cleanup from hanging the entire run. No test assertions or repository test settings were changed.

| Command | Result on this revision |
| --- | --- |
| `npm ci` | Passed; zero audit vulnerabilities |
| `npm run build` | Passed |
| `npm test` | 800 passed, two skipped, eleven failed, one cancelled; the failures were seven browser launches and four process-ownership assertions; the cancellation was the lab file |
| `npm run test:plugin` | 104 passed, one skipped, nine failed, one cancelled; the failures were browser-dependent cases; the cancellation was the video file |
| `npm run leaks` | Passed, CLEAN, including the repair commits |
| `node scripts/desktop.mjs --check` | Passed; the packed server answered with 64 tools and five cards |

All sixteen added regressions passed in the main run. The earlier focused agents, features and servers run passed all 95 cases. The completed main run includes the subsequent expiry, minute-limit and restored-capacity checks. The extra argument-table commit remains an ancestor of these repairs. `lib/build.mjs` still imports the rules build dynamically.

The four non-browser failures were rerun alone and all four still failed. The dev implementation and these tests are identical to the starting revision. This sandbox rejects `ps` with “operation not permitted”, so the dev tool cannot establish process ownership. These are recorded failures, not browser exceptions, and the required full-suite checks are therefore **not green in this environment**. No ownership safeguard was weakened:

- `local dev with a custom-domain route in wrangler.jsonc: the route never reaches the local runtime, and rooms are local, port included`
- `stale dev state heals itself: a record whose server was stopped another way, a leftover runtime on the port, and somebody else's port`
- `a game added while dev runs: named while it is not built, and picked up once it is, without a hand restart`
- `dev --stop stops exactly this studio's dev server (Wrangler with it), and nothing else`

The lab was retried independently: five non-browser cases passed and both named Chrome cases printed a browser-launch rejection. The recorder, trailer and video files were also retried: four cases passed, and eight reached browser-launch failures. A temporary diagnostic hook captured the child errors; for the lab and film renderer it exited the already-failed child after its error was printed, so its leftover HTTP server could not hide that error behind a timeout. Assertions were unchanged, and no diagnostic hook is part of the repository. These results identify the cancelled cases; they do not turn them into passing browser tests. The named launch exceptions are:

Main suite:

- `the style board card in a browser: Lock is the person's, recorded, and the model is told`
- `the lineup is three pictures: the inventory, the cast and the environment, with an unused asset in the inventory only`
- `shoot --preview: frames of the built game from the light preview server, no site running, named by the build's own hash and bundle`
- `a second clip library on one skeleton: refused at registration, never shadows the first, and a declared supplemental one joins coverage and previews; removing the starter models keeps the clips' credit`
- `the deploy plan's card shows the plan, and no card stays on "Loading" once its tool answered`
- `the Tell Homie card in a browser: Send sends the shown note once; Edit rewords it; Don't send sends nothing`
- `shoot against a stub site: two clients seated in one private room, then frames one clock step apart`
- `in Chrome: the lab's clock, timers, dice and presses replay a take frame for frame, at 60 and at 30 fps`
- `in Chrome: a game that rolls crypto dice is caught replaying differently, and both starters replay the same`

Plugin suite:

- `art: a cover cropped into the game and named in game.json; tiling, fitting and a contact sheet`
- `record: a computer, scripted: typing, scrolling, Play, keys and a click reach the game; real time, honest frames, captions on the steps' seconds`
- `record: a phone is a 9:16 film with touch: a tap on Play, a tap and a held drag in the game`
- `record: a step that fails is named, the take is kept, and the result is not ok`
- `sound: wired into a game, listed in the manifest, and the player starts on the first touch in a real browser`
- `record-fixed: a page too slow for real time, filmed frame by frame; every clock in it moves 1/30 s a frame; the sound comes back from the log`
- `record-fixed: steps run on the film's clock, a step it does not have is refused by name, and a silent page says it is silent`
- `record-fixed: a game in a sandboxed frame is on the same clock, and keys and a click reach it`
- `trailer: one command films the game frame by frame, picks the shots from what it played, and delivers 16:9, 1:1 and 9:16`
- `video: priced, capped and receipted fal calls; a resume never pays twice; grid, lag, an edit on bars from gameplay, both cuts, sync, sheet, film, page`
