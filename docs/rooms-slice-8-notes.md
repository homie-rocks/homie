# Rooms, slice 8

Implementation, fresh authoring proof and local release gates are complete. No deployment.
The required post-#79 rebase remains pending because #79 is still open. The candidate
versions are studio 0.40.0 / plugin 0.41.0, to be confirmed against main after that merge.
This file records observed results, not planned passes; the milestone design is the authority.

## Teaching changes before the trials

- Before: the game skill recommended a browser host and owner movement, while the
  five starters already used rules. After: read RULES.md first; server rules own
  truth, shared move predicts locally, view draws and sends intent. Engineering
  defaults are the AI's decision. Existing browser games keep working untouched.
- Before: the scaffold's AGENTS.md said one browser hosts every game. After: the
  scaffold teaches declared state/events, deterministic clocks/math/RNG, movement,
  maps and z-up 3D, companions/asks, persistence, diagnostics and the 32-seat limit.
- Before: the MCP guide only found files under references/, making RULES.md and
  REWRITE.md unavailable through its file argument. After: it also serves sibling
  Markdown references safely by basename, and lists them.
- Before: port taught a new createRoom browser host. After: manual extraction into
  rules, preserving art, renderer and measured feel, with baseline comparison and
  unrelated-game/test preservation. No automatic converter is offered.
- Apps: stationary participants still require a body and no-op move in this
  contract. The welcome starter now separates a server-rules shared revision and
  refresh effects from authorized, lasting queue records. No required bots/scores.
- Recording: a virtual view clock does not step server rules. Rules trailers now
  use real-time capture; scripted server footage uses record then edl/cut. A wall
  alone does not keep an empty room alive. No hosting switch for online footage.
- The traffic and 2D/3D prediction Chrome matrices are explicit real-time soaks:
  `npm run test:rules:realtime`. They are retained, outside `npm test`; deterministic
  runtime, prediction, wire and save tests remain release gates.

## Fresh authoring trials

Method: toolkit packed from this checkout, extracted CLI scaffolds an empty studio,
its dependency pinned to that tarball, npm install. An isolated CODEX_HOME contains
only CLI authentication and this checkout's installed Homie plugin, no old session
or memory. Each `codex exec --ephemeral` starts a new thread with only the person's
sentence. Transcripts and receipts were collected in /tmp/homie-s8-trials;
completed temporary studios were removed after verification. No result is counted from
hand-editing an agent's game. The CLI also exposes installed machine-wide skills;
no earlier conversation or task briefing is supplied. Initial --ephemeral trials
shared an isolated plugin-install home, with no saved stage-one memories observed;
subsequent trials copy only authentication, plugin config and plugin files into a
separate fresh home per request. No transcript is fed into another trial.

1. "make me a tag game for four where the tagger glows" — exploratory run finished.
   The agent chose Coin Dash, four total runners, tag-back protection and survival
   scoring. It read the skill and RULES reference and kept server hosting.
   Stumbles observed:
   - `build --types` ran the legacy compiler before generated rules types and
     reported implicit-any callbacks in valid query results. Fix: rules use their
     mandatory generated strict compiler only; --types still checks legacy games.
   - `Property 'bot' does not exist on type 'RosterRow'` and `e.at is possibly
     undefined`. Before: reference mentioned roster and flat effects without the
     exact alternatives. After: roster driver person/bot/ai, optional at/id and
     resolution by room.get; type diagnostics now include those repairs.
   - The agent repaired its code itself and finished with a passing shared-round
     check and a real contact-transfer proof. My own review used two visible,
     separate Chrome processes through a socket proxy delaying each direction
     75 ms: reported RTT 152–174 ms, first visible movement 11.3 ms at RTT 158 ms,
     no snap corrections, both replicas online, zero browser errors. I steered
     both runners, transferred the glow, hit the boundary (x held at 9.499 for a
     radius-0.5 runner inside [-10,10]), saw seven tags and matching results,
     then the next round. The short chase is readable and playable for a minute;
     bots are easy to recognize. This exploratory run prompted a fresh rerun
     after the teaching fixes. Receipts: tag-1-review/receipt.json and screenshots.
   - Its final local server stopped with the fresh exec session even though the
     final answer said running locally. I restarted the same untouched game for
     my review; a dead link is not counted as a working preview.
2. "a co-op game where we herd sheep into a pen" — exploratory run finished.
   It exposed an incorrect existing instruction: RULES.md said HTML should load
   /src/view.ts and claimed the build rewrote it. The builder actually rewrites
   ./assets/main.js. The agent corrected it after an empty browser page.
   Fix: teach source entry versus built HTML explicitly in all three game guides;
   fail the build early with the exact script tag and relative-path explanation.
   A regression test exercises that failure before any browser is launched.
3. "a 3D platformer race up a tower" — exploratory run finished.
   Independently hit the same HTML source-URL failure. After its repair, two
   browsers finished a race with uninterrupted connections. Its own playtest found
   bots too fast, a missed phone stick and an obscuring tower spine; it repaired
   those game-specific issues itself. My own two-visible-window review used 150 ms
   socket delay: a jump/move appeared after 8.6 ms at reported RTT 155 ms.
   Directional key inputs climbed through checkpoint 18, both players responded,
   a race ended and the next began. No snaps; one browser error was my own probe
   typo (`net.probe.climb` instead of `port.info().extra.climb`), not game code.
   The numbered route and checkpoints are readable; the chase is playable.
   This request prompted a fresh run after the common HTML/type fixes.
4. "a quiz game for my pub with a big screen and phones" — exploratory run
   stopped before publication; not a clean completion. Its game built, two-browser
   round check passed with no reconnects, answers locked and scored correctly,
   TV joined without a seat and a phone reloaded successfully. The older game
   skill unconditionally ended with deploy/publish. Before: "Then ... npm run
   deploy and studio_publish". After: a working local result; publish only in the
   owner's requested release scope, no release/setup question for a build-only
   request. The agent ran deploy --plan only (read-only); no deployment occurred.
   It was rerun fresh after the scope fix.
5. "a top-down tank battle with power-ups" — exploratory run finished. Iron
   Bloom uses server rules, predicted tanks, ricocheting shells and three pickups.
   The agent fixed overlapping audio clipping and sideways phone framing, and
   reran a check interrupted by its own dev rebuild. It hit the VERDICT ordering
   stumble described below, so a fresh rerun remains. My delayed two-window
   review measured 1.3 ms movement response at RTT 153 ms, actual driving and
   firing, a pickup while crossing the arena, hits/respawns and the next round.
   Both replicas stayed online, with no browser errors or snap corrections.
   The compact arena is readable; bots make the opening immediately busy.
6. "a turn-based word game for two" — exploratory run finished. Word Duel is
   a two-seat, eight-turn word puzzle with a disclosed fixed rack and dictionary.
   It built and finished a clean two-browser check. Its actual-word test rejected
   invalid/repeated words, retained the turn on reload and ended 19–18. Its test
   initially tried a word outside the dictionary; it corrected the input, not the
   scoring rule. A guessed sound preset and unavailable python alias were repaired
   from the concrete error messages. No engineering question or hosting fallback.
   My delayed visible browsers played another full match, agreed on 18–19 and
   began the next; local draft feedback took 1.9–9.9 ms. The generic movement
   instrument incorrectly failed this stationary game, prompting the fix below
   and a required fresh rerun.
7. "a rhythm tapping game" — exploratory run finished. Pulse Arcade implements
   four timed lanes with immediate feedback, server-validated taps and shared
   scoring. The author repaired an occupied preview port, a rebuild-interrupted
   check, phone layout and an inherited bot score on late arrival. The errors
   named concrete remedies. No engineering question, guard bypass or old host.
   The fresh rerun used the stationary-control instrumentation and capture fixes.
8. "a hide-and-seek game where the hider is disguised as a prop" — first run
   finished. Odd Objects has rotating seekers, an eight-second hiding period,
   three prop shapes, inspection cooldown, bots and shared catches. The author
   fixed portrait/landscape framing and wall sliding, then completed the stable
   two-browser check with no reconnects. It honestly recorded the frozen-phase
   generic control failure and supplemented it with eight active edge holds.
   My two visible delayed browsers changed stool to crate, chased via keys,
   caught the hider, agreed on the result and swapped roles next round. Sampled
   movement response: 25.2 ms at 180 ms RTT; no browser errors or snaps.
   The fresh rerun tested the frozen-phase and cover-capture guidance.

## Rewrite baseline

A clone of codex-studio excludes node_modules and leaves the original untouched.
The original 377 tests pass. Two visible Chrome windows with 150 ms socket delay
played Signal Bloom before rewriting: matching perfect-hit scores, streaks, gold
bonuses, shared blooms, 45-second rounds and the next round, no browser errors.
The original art and pulse probes were captured outside the temp studio. A fresh
agent received only the requested rewrite sentence, not these measurements.

The first rewrite completed with server rules, preserved renderer/assets, 377
original test cases passing under an added narrow TypeScript loader, and its own
delayed-input/reconnect tests. Two teaching gaps were found:
- The old custom Worker lacked hostRules(registry). The agent found this after
  the first browser inspection and added the hookup while keeping the existing
  Stormbreak routes. REWRITE.md now explicitly checks the installed Worker
  template and requires two actual server replicas.
- A special loader invocation passed the tests, but the untouched npm test script
  still fails with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING. REWRITE.md now
  requires preserving helper exports/assertions and keeping the normal test
  command working, with a narrow loader if needed. This is not counted as a
  clean first-time rewrite; a fresh original copy was tried next.

My independent delayed Chrome review found the same composition, local tap
feedback, perfect windows, matching scores/streaks, shared gold and next-round
reset. At measured RTT 163 ms both players scored perfect hits 8–12 ms before
center. Bot outcomes differ because the new server uses seeded scheduling, a
limit the agent documented; no timing/scoring constants or art assets changed.

The second rewrite read the game skill and RULES, but skipped the linked rewrite
page. It moved pure helpers to mechanics.ts and changed an original test's import
path, making the normal 377-test command pass. That violates preservation and is
not accepted as a clean rewrite. Independent hashes confirm exactly one of the
408 protected files changed: tests/signal-rules.test.ts; other games were intact. Before: the rewrite link was late in the rules
section. After: a mandatory read-before-edit branch at the skill entrance, explicit
byte-for-byte test preservation (including imports), old helper re-exports and
before/after hashes. Let this author finish, then retry from another original copy.

## Additional teaching and integration findings

- Before: start a background dev task and stop it when done, with no instruction
  tying the final preview claim to server lifetime. Two agents offered stopped
  previews. After: verify the link and persistent lifetime, otherwise give the
  start command and say built instead of running.
- The app browser proof exposed macOS /tmp versus /private/tmp file identity in
  the guard bundler. Its linked verification correctly refused uncounted source.
  Canonical paths now match exactly the already-guarded files; the alias regression
  passes without bypassing linked verification. Real Chrome app proof now passes
  (104.7 s): LAN QR, wall, two phones, staff passkey/grant, queue writes, revoked
  access and durable reconnect.

- Two fresh authors called `reviewed --kind local` before creating VERDICT.json.
  The message was actionable, but the skill listed recording before explaining
  the verdict. It now explicitly orders brief, pictures, JSON verdict, then the
  recording command, and removes the contradictory ban on any local builder
  review. A local verdict is always labelled not independent.
- The integration suite caught lost MCP batching guidance. Restored the useful
  one-read / one-file_edit-with-edits-list instruction for each source file;
  rules/view explanations no longer displace it.

- The word trial exposed movement-only FAIL rows for declared maxSpeed-0 player
  anchors. The runtime now derives stationary/spatial from the compiled player
  kinds; first-move is N/A, owner movement is not applicable, and a static image
  is not itself a movement warning. No fake poses or exemption flags are authored.
  Actual taps/choices/turns still require a directed two-browser test. A regression
  checks stationary enforcement and keeps moving rules spatial.
- codex new still said "fill it from the plan interview" and "once the plan is
  agreed". Its next step now says request plus sensible defaults, interview only
  when asked; no engineering or approval detour is implied.

## Successful fresh reruns

A first-time authoring result means a fresh author completes the whole task
without corrective instructions from the evaluator. It includes the author's
normal compile/fix/playtest loop; it does not mean its first compiler invocation
had no errors. Tool/teaching failures above prompted separate fresh trials.

- Sheep second run: Flock Together finished unattended with server rules, strict
  build and uninterrupted two-browser round. It fixed its own rotated phone
  controls and framing. Independent delayed play responded in 8.3 ms at 152 ms
  RTT. Actual arrow handlers guided successive identified sheep through the gate;
  the shared count rose to five, both windows agreed, and rounds restarted. Steering
  directly into the fence initially stopped the sheep: aiming through the opening
  was necessary, as the game instructs. No wall bypass, snaps or browser errors.
- Tower second run: Skyspire completed strict build, shared race, phone layouts
  and audio checks. Its own delayed climb caught a checkpoint-recovery bug, repaired
  it, then climbed six ledges and proved recovery. Independent two-window review at 150 ms delay climbed all 18 ledges,
  won the race with matching results, and started the next round. An active,
  grounded jump appeared in 7.9 ms at 158 ms RTT. The earlier latency sample
  landed during the intentional results freeze and is discarded, not called lag.
  No browser errors or snaps; checkpoints and ledge labels are visible.

- Tank second run: Iron Bloom finished unattended and included a working restart
  command in its handoff. Strict build and final shared round passed. Independent
  delayed play drove, aimed and fired using the actual keyboard/pointer handlers;
  the player's score reached 12, rapid-fire pickup activated, deaths respawned,
  and three rounds ran. Movement response was 13.2 ms at 154 ms RTT. No browser
  errors or snaps; shots, shields and pickups are readable in the compact arena.

## Continued independent checks

- Rhythm first build: two visible Chrome processes, 75 ms each way. The first
  player hit over 100 chart notes via the actual D/F/J/K handler; the untouched
  second player remained at zero. After joining in, both scored together across
  the next round. Local feedback was 4.7–10.2 ms in sampled frames at 152–163 ms
  measured RTT. Clear four-lane chart, combo and music; no browser errors.
- Recorder: a real 3-second play-seat capture succeeded at 60.3 source fps, with
  no held frames. A TV-only empty-room capture refused with "TV is not a
  participant" and the real-player/--view-play remedy. Art defaulted to play
  and returned two usable frames, inspected visually. No virtual-clock claim.
- Tag second build completed unattended, server rules, strict build, desktop and
  phone checks. It self-corrected readonly math-vector component assignments;
  RULES now gives the exact replacement expression. Its final live link stopped
  when the headless process exited: the handoff now always includes the start
  command. The fresh tag trial exercised both clarifications.
- Tag second build independent play: movement changed in 5.1 ms at 160 ms RTT.
  The reviewer initially steered with screen-down coordinates against this
  y-up game; that was corrected in the review controller, not in the game.

- Prop first build's generic hold landed entirely inside the intended hiding
  freeze. Before: "body was busy ... for 303 frames" with no next action. After:
  the message and playtest guide say repeat controls in an active phase and keep
  the freeze; the blocked sample is not a pass. The author independently diagnosed
  it and performed directed active-play tests. The fresh rerun used the guidance.
- Port's remaining unconditional publishing paragraph now follows the same
  requested-release scope as game. MCP server instructions also say "only when
  going live was requested".

- PR #79's Node 24 failure independently exposed a touch-receipt race: CDP
  returned before the final ramp event, so a=2322 later became 2438.5. The checker
  now waits for the intended endpoint, timestamps it once and ignores later
  wobble events. The regression sends a later matching touch event and requires
  the receipt to remain fixed. The 600 ms response threshold is unchanged. The
  focused Node 24 run passed all three input tests, including the real touch case
  in 4.56 seconds. The same PR job also failed a real-time Hero Rush prediction
  measurement (one snap rather than zero); separating that soak from the release
  gate does not turn the measurement into a pass. The explicit soak commands
  retain those assertions, alongside the deterministic prediction release tests.

### Independent prop rerun review

`prop-2` completed from the revised installed skill. Its author repaired phone
framing, passed strict build and the shared-round check, and honestly retained a
quiet-audio warning. The final handoff includes the restart command. My two
visible Chrome windows used the 75 ms each-way socket proxy for over four minutes:
crate/stool/plant changes, close-range captures, four rotating rounds and matching
scores were visible. Actual keyboard movement responded in 14.1 ms at 164 ms RTT;
no page errors or prediction snaps occurred. Screens show a readable furnished
curiosity shop, clear roles and inspect/disguise controls. The earlier blocked
countdown hold is now explained as blocked evidence, with active-phase controls
required; no mechanic or probe was removed to pass it.

### Quiz rerun and review-score message

`quiz-2` finished with no publication attempt or engineering question. It made
Last Orders Quiz: 18 questions in six-question rounds, 32 phone/table seats,
names, locked answers and a seatless TV. It repaired its own stale-answer/reload
handling and an inline landing script blocked by CSP (an external script fixed
it; CSP stayed intact). Strict build and the uninterrupted two-browser round
passed. My delayed visible windows answered real buttons across three rounds:
correct answers scored, wrong answers stayed at zero, and pending feedback took
2.3–7.3 ms at roughly 152 ms RTT. Both agreed on questions and scores. The author
restarted dev during the first review, so those 13 reconnects are not an
uninterrupted-run claim; its final check and my separate LAN TV trial stayed
connected. The LAN TV had no seat, disabled answer controls and a real QR for the
same room. Loopback correctly hides unreachable QR codes. Screens were readable.

`rhythm-2` finished Pulse with strict build, two-browser round and actual timed
keyboard/touch play; it fixed a quiet synth mix to -21.4 LUFS. However its local
review used `--score 7` for a seven-out-of-ten assessment, producing `7/100`.
Before: the result said `--score <n>` and the skill left the two scales to the
linked rubric. After: both the skill and result say parts 0–10, overall 0–100,
with the explicit example `70`, not `7`. `rhythm-3` is a fresh trial of that fix.

### Accepted Signal Bloom rewrite trial

`rewrite-3`, still given only the owner's original sentence, read REWRITE.md first,
hashed original tests before editing and kept their imports byte-for-byte. It
retained tested helper exports from rules.ts, registered hostRules in the custom
Worker without removing routes, and made the ordinary `npm test` command use a
narrow TypeScript loader. Its ordinary run passed 380 tests (377 original plus
three server regressions). Strict whole-studio build and an uninterrupted shared
round passed. A directed test initially waited on the wrong round observation;
the author investigated it and completed delayed keyboard/touch, duplicate,
late-practice, reload, actual reconnect, results, next-round and departure checks.
It did not weaken a test or the game to make that wait pass.

My independent SHA-256 check found all 408 protected other-game and original-test
files unchanged in both the copy and original. In two visible Chrome windows with
75 ms each-way delay, the original flower artwork, controls, 2-second pulses,
1.5-second finale, 65/155 ms windows, four-hit streak bonus, shared gold and next
round were retained. Both players scored 92 at pulse 17 with matching 18-hit
streaks, and later tied at 120 with places 1, 1, 3 in both result views. An observational canvas-stroke hook measured the original local tap
ripple at 4.8–17.7 ms around 155 ms RTT, well before authoritative scoring; no page
errors or reconnects. The baseline and rewritten frames show the same garden.
The author honestly records one cadence difference: bot decisions now occur on
20 Hz / 50 ms server ticks rather than browser frames; human grading keeps its
submitted sub-tick timestamp. No deployment and no original-studio edits. The independent normal `npm test`
run also passed all 380 tests in 16.6 seconds. A full content-hash comparison of
9,767 original-studio files found no changes.

### Accepted rhythm retry

`rhythm-3` completed PULSE: 96 authored notes at 120 BPM, four lanes, synth audio,
combos and server-validated timed commands. It independently repaired phone HUD
clearance, tested the actual keys after a generic sound check pressed the wrong
key, raised a measured quiet mix and completed an uninterrupted shared round.
It gave a restart command, asked no engineering question and kept the toolkit
untouched. It did not repeat the incorrect 7/100 claim; its handoff describes
checks, not an independent review (the instrument folders still disclose no
recorded local verdict). My independent review supplies the play evidence.

My first review script called a custom probe through the wrong object and threw;
that was my instrumentation, not the game. I closed those windows and repeated
in fresh windows using port.info().extra. With the 150 ms socket delay, 84 timed
keys scored 113,750 while an idle player stayed at zero; next round both played
and finished 131,750–106,250. The only translucent canvas fill is the immediate
lane flash; observing it gave 0.1–17.4 ms feedback around 156 ms RTT. Both results
matched, sound ran, and the clean review had no page errors or reconnects. The
neon lanes, strike line, judgments and combo are readable for a full match.

### Accepted final tag retry

`tag-3` built Glow Tag, passed strict build and an uninterrupted shared round,
tested four-player tag transfers and included the port-specific restart command.
My two visible delayed windows moved both players around the shared obstacles,
passed the gold tagger repeatedly (19 transfers in one observed round), scored
safe seconds and continued into round 3. Local movement took 9.2 ms at 155 ms RTT;
no page errors, reconnects or prediction snaps. The gold ring, names, countdown,
safe-time scores and controls are readable. The initial type/HTML/readonly/handoff
stumbles did not recur in this fresh run.

The final recorder command on rhythm-3 captured a live server room at 58.4 source
fps, 57 distinct output frames, zero held frames and no page errors. It correctly
reported audio=null because it never pressed a sound-enabling control. The first
attempt stopped for disk space; removing completed owned trial studios let the
same command finish without lowering its disk guard.

### Word rerun: real touch matters

`word-2` made Letter Duel, with six racks, a disclosed curated dictionary, 20-second
turns and three turns each. Strict build, shared results and reconnect passed.
Its real touchscreen check found that selecting every action button in
`guardGestures({touch:'[data-action]'})` prevented synthesized touch clicks. The
author repaired touch-pointer handling and reran the actual touch check. My
150 ms delayed windows played five full matches, agreed on 17–18 and subsequent
rounds, and showed draft letters in 0.1–16.3 ms. `NETSIL` was refused with “Not in
this rack’s word list. Try another word.” while the turn remained available. No
page errors or reconnects; readable type, letter tiles and scorebook.

Before: the game guide said to provide touch controls but did not explain how a
gesture-guard selector changes native button activation. After: RULES.md and the
game skill say to keep native buttons outside the drag selector, or handle touch
pointers explicitly without duplicate activation, and test actual touchscreen
taps instead of element.click(). `word-3` is a fresh run of the original request.

### Integration-run repairs

The final gate's app proof also exposed a cold-start assumption: Wrangler had
built successfully but was not ready within 90 seconds on the shared machine.
The fixture now builds once (dev already runs the strict rules compiler), waits
up to five minutes for readiness, bounds each fetch, and stops waiting on a child
exit or signal. Its outer deadline accommodates both server starts. Gameplay,
passkey, revocation, reconnect and input-response assertions are unchanged. The
isolated real app proof then passed in 92.1 seconds; the full gate was restarted.


The first complete integration run found five failures during development:
scaffold/batching assertions required the retained optional-demo and one-call
wording; the planted-Date MCP fixture needed valid bundle HTML to reach its
intended guard; and the new stationary fixture accidentally retained a moving
handler. The fixture now uses the same no-op move taught to app/quiz authors.
A declared maxSpeed is not a substitute for writing that move correctly. These
and the missing release template-history entry are recorded separately from the
final, clean release run below.

## Early integration checks

- npm ci: passed (322 packages installed, 346 audited).
- npm run build: passed before subsequent app/tool changes; the final gates are
  recorded separately.
- Focused app integration: 5/5 passed. MCP integration: 7/7 passed, including root
  RULES.md and REWRITE.md retrieval. Video virtual-clock refusal regression passed.
- App integration trial exposed required map bounds and explicit breakSeconds for
  manual rounds. Both are now in the starter and app guidance.

## Release status

Fresh authorship and delayed reviews are complete for eleven requests, including
two untuned first-run holdouts. The Signal Bloom rewrite, preservation checks and
all requested local gates are complete. At the final check, main is 91be345
(studio 0.38.0), and PR #79 is still open at 766851f (studio 0.39.0).
The Slice 8 PR is therefore prepared as a draft against main, dependent on #79.
The requested post-merge rebase and final version confirmation remain outstanding;
no merge or deployment has been made.

## Final release gates

- `npm ci`: passed, 322 installed / 346 audited.
- `npm run build`: passed.
- `npm test` with real Chrome, local Wrangler/workerd and stripe-mock enabled:
  2,190 passed, zero failed, zero skipped, 2,966.08 seconds. This includes the real
  app/LAN proof, all five embedded starters, touch receipt, three acknowledged
  updates, play/watch frame recovery, strict rules, whole-build repeatability under
  load and clock jumps, prediction, persistence and the existing studio checks.
- `npm run test:plugin`: 123 passed, zero failed, one optional live-URL fixture
  skipped, 164.79 seconds. The fresh game reviews above supply actual live play
  evidence; the optional fixture is not counted as a pass.
- `npm run validate`: marketplace and plugin validation passed.
- `node scripts/desktop.mjs --check`: passed; the packed 0.40.0 server answered
  with 68 tools and five cards, guides and empty-studio setup.
- `node scripts/changelog.mjs --check`: passed; both copies match, 63 releases.
  It printed informational missing-tag-link notes for older release sections.
- `node scripts/publish.mjs --check`: passed; studio 0.40.0 is the one new version,
  and 22 packages match their published versions. Nothing was published.

These gates ran one suite at a time. The release suite contains no real-time
soak by default. All temporary authoring/rewrite studios and 26 isolated CLI
homes were deleted; the final gate-only dependency studio, its temporary Wrangler
links and the local stripe-mock server were removed or stopped after the gates.

## What the skill teaches, in twenty lines

1. New games separate rules, movement and view, with a server host.
2. Choose engineering defaults; do not interview the owner about them.
3. Declare all lasting entity, motion and shared fields and bounded payloads.
4. Entity handlers change self; room handlers change shared state.
5. Affect other entities through declared, later-tick events.
6. Validate intent, turns, distance and cooldowns on the server.
7. Use the supplied clock, random source and deterministic math.
8. Keep handler work bounded and repair measured budget failures.
9. One guarded move runs on the server and predicts the local body.
10. Sweep against shared map geometry and declare the actual maximum speed.
11. Keep rendering, audio, input feedback and camera in the view.
12. Scores, damage and pickups wait for authoritative decisions.
13. Share level data; 3D rules use metres, z up and feet positions.
14. Initialize arrivals and new rounds; bots use the same legal actions.
15. Companions use vocabulary, guide view/floor, goals and visible AI labels.
16. Declared asks have deterministic fallback decisions and bounded answers.
17. Automatic room saves differ from character saves and authorized app records.
18. Browser hosting serves offline, local and private play; it is no error escape.
19. Read diagnostics and prove the actual mechanic in two delayed browsers.
20. Requested rewrites preserve view, feel and tests; rooms stop at 32 seats.

## Milestone-wide evidence still missing

The prior slices explicitly leave production measurements open, and this slice's
no-deploy instruction does not permit filling them in:

- Design T1 / open points 1–2: Cloudflare 8- and 32-seat 20/30 Hz tick/gap
  measurements, weighted-budget calibration, callback-clock behavior, actual
  requests/GB-seconds/rows and billing after the last player leaves. Local Node,
  workerd and Chrome receipts are not those measurements.
- Design T2 / open point 3: hour-long 4 KB/64 KB/1 MB saves at 8/32 sockets,
  production output-gate p99, billed rows, quota exhaustion/reset and deployed
  update propagation. Slice 2 supplies the remote harness, not a passing receipt.
- Open point 4: a physical phone on mobile data. Emulated phone sizes and delayed
  local sockets exercise controls and prediction but do not settle that question.
- Slice 5's actual Workers AI/provider and billing proof remains unrun. Scripted
  fallbacks and local companion/ask protocols are covered; remote service behavior
  is not claimed here.

Larger rooms, per-seat private state and stronger isolate boundaries are later
milestones, not missing promises added by slice 8. Earlier deferred build hashes,
strict types, prediction and the five starter conversions were delivered by the
later slices. The fresh authorship and rewrite evidence is recorded here; release
gate results are recorded separately.

### Untuned holdout: Keylight & Pip

Request: “make a co-op maze where a little robot helps us find colored keys and open the exit”. The first fresh author completed a server rules game, strict build and two-browser check. It repaired a narrow-phone HUD during its own review; it asked no engineering question and changed no toolkit guard. The independent review used two visible Chrome windows and a 75 ms delay in each socket direction. Local movement responded in 12.4 ms at about 154 ms RTT. Two keyboard-controlled people collected different keys; both replicas saw masks 0, 2, 3 and 7, then the same successful escape and next round. Seven successful rounds were observed over roughly six minutes, with zero page errors, reconnects or prediction snaps. Pip is a scripted robot in the rules, waiting for nearby people and guiding them toward missing keys, rather than a billed model call. The screenshot shows all three colored keys checked, the open exit, two explorers and Pip in the shared maze. No skill fix was needed for this holdout.

The first final release run also caught previous-release bookkeeping: after adding 0.40.0, the 0.39.0 Plugin line must link PR #79. Both changelogs now do.

### Curling holdout: a real touch failure

The first author made Button & Stone: two stationary player anchors, server-owned stone physics/collisions, alternating turns, four stones each and end scoring, rendered in Three.js. Strict build and its two-browser end passed. Independent real Chrome touch input found the same native-click suppression already discovered in word-2: `guardGestures({touch:'canvas, [data-action]'})` included the `onclick` shoot button. A CDP touch on the enabled button left the shared stone list empty, still empty 600 ms later, before the timeout shot. Mouse-only tests had missed it. This run is not accepted. `curling-2` starts fresh with the existing native-button guidance from word-2; no steering message or patch is sent to the author. An additional unseen star-catching request ensures two holdouts must succeed without a retry.

The final cross-reference audit also corrected port reference files: PORT.md now plans server truth and a predicted view, CHECKS.md explains server continuity, stationary controls, active-phase retries and spectator pauses, and the old RECIPE.md explicitly applies only to maintaining unchanged browser-hosted ports. LESSONS.md separates historical claim/handoff remedies from shared movement and qualifies its measured timings. This closes a contradiction reachable from the updated port skill, without changing old games.

Integrity follow-up: all 337 files in the packed toolkit were byte-compared with the installed copies in maze-1, curling-1 and word-3; none changed. Their manifests name src/view.ts and room.host server, with src/rules.ts present. Their user-facing transcript messages contain no engineering question (the curling question marks are URL query strings). This is a check of trial integrity, not a leak audit.

The fresh word-3 author also exercised the review-scale clarification: it wrote VERDICT.json before recording the local review and supplied overall score 77/100 with 0–10 part scores. The tool returned “Overall 77/100” and retained the explicit local/not-independent qualification. Its own directed two-seat match ended 82–91; invalid and duplicate words were rejected, reload preserved the table, real phone taps submitted words, and a sideways-phone wrapping problem was repaired. The independent final review is recorded below.

Independent word-3 review passed in two visible Chrome processes with 75 ms delay each way. A real CDP touchscreen tap selected S, visible on the next frame in 11.6 ms at about 155 ms RTT. ONILERATS was rejected with “Not in this rack’s pocket dictionary. Try another.” and the turn stayed with the same player. Actual tile and submit controls then produced matching 57–73 and 84–104 results, with matching word trails and a new round. Local draft updates sampled 11.8–14.9 ms; the review lasted over a minute with no browser errors, reconnects or snaps. The readable cream/green board makes both scores, whose turn it is, the letter rack and accepted words explicit. This final fresh run needed no skill correction or evaluator message. The game deliberately uses three curated racks and its visible pocket dictionary, rather than claiming a complete English dictionary.

### Second untuned holdout: Starcatch

Request: “make a cooperative game where two players catch falling stars in a shared basket”. The first fresh author completed Starcatch with server rules, shared movement and a view of the same basket midpoint. Strict generated play covered 18,000 ticks, 16 rounds and 813 restore comparisons; its final public-room check finished an uninterrupted two-human round in 63 seconds. Its normal iteration fixed title/portrait spacing and overlapping handles; it kept a development-reload refusal separate from the final clean check. It explicitly did not treat Chrome network emulation as proof of WebSocket delay. No engineering question, evaluator correction or skill change was needed.

Independent review used two visible Chrome processes behind the 75 ms-each-way socket proxy. An active movement press changed the local pose in 4.9 ms at 154 ms RTT. Actual keyboard presses moved the handles in opposite directions and the basket followed their midpoint; coordinating the two through the real key handlers then caught falling stars. Both saw 23 shared catches and 23–23 results, then the next shower and matching ongoing catches. The review lasted over 90 seconds with zero browser errors, reconnects or snaps. The night scene, gold stars, named handles and woven basket are readable; quiet gaps between catches are intentional, not a claimed music bed. All 337 packed toolkit files remained unchanged in this trial and in curling-2. Maze and Starcatch are the two untuned first-run successes; curling is retained as an additional request, with its failed touch trial disclosed.

### Final curling retry and independent review

The fresh retry made Quiet Ice and kept native controls outside the gesture-capture selector. It completed a strict build, eight alternating mouse/touch deliveries with independently checked scoring, and an uninterrupted two-human public-room end in 145 seconds. It reported quiet intervals between throws honestly. Its handoff included the restart command.

Independent review used two visible Chrome processes and the same 75 ms-each-way proxy. A real touch on the enabled release button increased shots from five to six and sent the stone sliding. A touch selecting curl appeared in 16.4 ms; local aim/curl controls respond immediately while the server owns stone movement, collisions and scores. Repeated deliberate shots used different weight, aim and spin through the actual controls. Existing stones were displaced by later deliveries. Both windows agreed on end scores 0–1 and 3–0, then started another end. An independent distance-to-button calculation from the final stone positions reproduced both scores. The review lasted about three minutes with zero errors or reconnects; it did not claim a stationary anchor was predicted stone physics. No further guidance fix was needed.

## Completed request matrix

All accepted runs below are separate fresh executions that received only the original sentence, without evaluator steering or hand-edited game repairs. Normal author compile/fix/playtest iteration is included. “Initial” records the earlier teaching failure honestly; “accepted” identifies the clean fresh completion after the fixes. Every accepted game uses rules plus view with server hosting, passed its build and two-browser check, and received the independent delayed two-window play described above.

| Person's request | Initial result / teaching fix | Accepted fresh run |
| --- | --- | --- |
| make me a tag game for four where the tagger glows | Wrong legacy type check; roster/effect/readonly-vector guidance; preview handoff. Fixed compiler selection, messages, examples and restart instructions. | tag-3, Glow Tag |
| a co-op game where we herd sheep into a pen | Wrong HTML bundle URL. Fixed reference and early build diagnostic. | sheep-2, Flock Together |
| a 3D platformer race up a tower | Same HTML/type guidance. Fresh author repaired its own checkpoint and phone layout. | tower-2, Skyspire |
| a quiz game for my pub with a big screen and phones | Unrequested publishing path. Fixed scope; final quiz also proved LAN TV/QR and phone answers. | quiz-2, Last Orders Quiz |
| a top-down tank battle with power-ups | Local review instructions ran before VERDICT.json. Fixed order and handoff. | tank-2, Iron Bloom |
| a turn-based word game for two | False movement requirements, then touch buttons swallowed by gesture capture. Added stationary N/A and actual-action proof; corrected native-button guidance. | word-3, Wordcraft |
| a rhythm tapping game | Stationary/recorder messages, then ambiguous review score scale. Fixed actual-action checks, live rules capture and 0–100 overall example. | rhythm-3, PULSE |
| a hide-and-seek game where the hider is disguised as a prop | Generic control hold landed during the intentional hiding freeze. Message now says retry active play and keep the mechanic. | prop-2, Odd One Out |
| make a co-op maze where a little robot helps us find colored keys and open the exit | Untuned first fresh success; no guidance change. | maze-1, Keylight & Pip |
| make a 3D curling game for two where we take turns sliding stones toward a target | First trial's native touch button failed. Reran with the already-fixed word-game guidance. | curling-2, Quiet Ice |
| make a cooperative game where two players catch falling stars in a shared basket | Additional untuned first fresh success; no guidance change. | stars-1, Starcatch |

The two untuned holdouts that passed without a request-specific retry are maze-1 and stars-1. Curling remains an eleventh request, not a hidden discarded failure. No accepted author asked an engineering question, evaded the guard or switched to old-style hosting. The independent observations establish these small games' behavior, not universal game quality, latency or room capacity.

Cleanup: all 26 isolated CLI homes (including copied authentication) and all trial studios were removed. The word-1 dependency installation was retained only while the release gates ran, then removed along with its temporary Wrangler links. The local stripe-mock server was stopped. Receipts, screenshots and transcript logs remain outside the deleted studios; their key moments and fixes are recorded here.

The final gate enabled the optional live-page integration and exposed another paced matrix in npm test: ten sequences of ten updates at ten-second spacing, plus thirty at five-second spacing. The release suite now checks three updates, waiting for both play/watch pages to acknowledge each actual build before the next edit. It still asserts room URL, seat identity, build adoption, epoch continuity and bounded save replay; it makes no wall-clock performance assertion. The original 130-update matrix remains available with `npm run test:rooms:updates`. The ongoing run had already recorded the corrected changelog failure; it was stopped during this long matrix and replaced by a clean full run.

Final compatibility review aligned art/video hosting detection with the toolkit's rules opt-in: an old game can have a helper named src/rules.ts without opting into a rules room. It keeps its previous capture path. An opted-in rules room with omitted host uses the server default consistently for both covers and trailers. A focused regression covers those cases.

Focused verification after splitting the update soak: 8/8 passed, no skips. Three acknowledged updates in real Chrome took 77.7 seconds; the six silent/HTTP-error/reset play/watch cases took 194.7 seconds. These are readiness/recovery checks, not throughput measurements. The clean full npm test gate was restarted after this result.

The same recorder review found that trailer did not forward the remedy `--view play` to live capture. Server-rules trailers now default to a participating, idle camera and honor an explicit `--view tv`; the latter still requires another participant. The video guide no longer promises that every empty room immediately supplies bot action. Actual action must be inspected.

The scaffold cross-reference audit changed its introductory file table from src/main.ts to rules/move/view and map data, and describes the departure check as a browser leaving rather than a killed host. Its upgrade fingerprints were regenerated.

The recorder CLI summary had also described all footage as frame-by-frame with rebuilt sound. Capture now records its live mode, trailer results retain it, and the human-readable summary distinguishes live audio, silence and rebuilt sound. A regression checks those three reports; held frames remain reported.
