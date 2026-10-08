# Slice 2: the room survives

This implements sections 5 and 8 of the milestone 1 design, plus the assigned pause, end,
alarm and restore-loop work. Package versions are unchanged. The changelog is untouched in this correction round; proposed wording appears below. Nothing was deployed, no credentials were used, and nothing was
pushed.

## What is built

- The server host saves its complete core and input queues on the configured interval,
  round end, match finish and pause. Both elapsed wall time and ticks bound the interval.
  A late timer followed by catch-up ticks cannot stretch the rollback window.
- The Table saves that host state and the relay's seat tokens, occupants, absent-seat hold
  times, policy, round and shared state together in synchronous SQLite. Up to 1 MB is one
  row; larger saves use ordered pieces in one transaction. Failed replacements roll back.
  There is no secondary index and no parallel legacy checkpoint for server-hosted games.
- Recovery reserves `max(saved epoch, boots epoch) + 1` before ticking, restores paused at
  the saved tick, marks unreconnected bodies away when ticking resumes, and retimes the
  public round deadline so the outage does not consume the round. Seat tokens still work.
- The boot counter increments when a restored run first ticks, clears after ten seconds
  of ticks, delays the second restored run by a repeatable room-specific duration of up
  to thirty seconds, and ends the third. Its log says `restore loop` and identifies the
  game and build, including the warning about a different room sharing the isolate.
- Paused rooms expire after sixty seconds even with watchers. The persisted alarm also
  cleans up a cold object. End deletes only the save, boots and net data; office and
  recorded data survive. The Lobby removes the ended room, and the next visitor can reuse the same name for a fresh match.
- State hashes cover ordered declarations, handler presence/names, shapes, field options,
  body/player settings, shared state, bots, asks, map, dimensions, rounds, tick rate,
  contract and seat count. Handler implementations, tunables and view changes keep the
  state hash. Per-game build hashes include guarded rules/data and built view/HTML, and
  exclude timestamps, commit, site posts and other games. Rules games use that build hash
  as their netplay version.
- The three deploy cases work through the existing reconnect path: unchanged game means
  reconnect without reload; changed build with the same shape refuses old code and
  reloads the frame with its seat token; changed shape ends and rematches in a fresh
  room. Play, TV and watch pages handle the new notices. Old standalone apps must update
  before entering a rules game's current room. Browser-hosted games keep their existing
  checkpoints and build behaviour.
- Preview has a POST-only `/<game>/__restart?room=<room>` route, enabled only with
  `HOMIE_PREVIEW=1`, that calls `ctx.abort()` without a last-chance save.

## Decisions where the design met the code

1. The change table expected no new production module. The SQLite adapter is a small
   `worker/room-store.mjs` instead of more SQL inside the shared Table file. This keeps
   atomicity independently testable and reduces merge overlap; it is not a second runtime.
2. State hashing lives in the existing lazily imported `lib/rules-build.mjs`, not in the
   host runtime. The build already owns the compiled declarations and Node's SHA-256;
   the Worker receives the result as build data. `lib/build.mjs` still imports this module
   dynamically. The desktop package check confirms the toolkit can start without adjacent
   node_modules.
3. Declaration order is significant because saves pack fields and kind indices by order.
   Function presence is hashed, never function text. The state hash conservatively also
   includes seat count and tick/think/command handler presence; changes that could reassign
   bodies or remove a handler cause a fresh room. The compiled map's content is hashed,
   rather than its source file's whitespace. No game format change or rewrite is required.
4. The save envelope includes the relay metadata in the same transaction as the core.
   A separate net write could otherwise associate a token with the wrong saved body.
   The host save retains its earlier `queues` representation and adds complete `inputs`
   (pending entries, held input, stamps and acknowledgement), so deterministic in-memory
   save callers remain compatible. On an epoch change the returning client's input stream
   starts afresh; saved game events and timers still execute at their original ticks.
5. Normal end cleanup leaves no permanent end marker. A temporary retirement flag in the boot row (or existing net key if SQL writes fail) prevents a failed deletion from reviving the match. Existing sockets
   get the end response; the relay instance is retired, all its sockets close, and a new
   visitor gets a new relay and host under the same code. Office bans and recorded round
   counters survive. The earlier permanent marker was a defect, not a design exception.
6. Slice 1 kept a paused room while a watcher remained. This slice follows the design's
   sixty-second expiry instead. Already absent seat holds keep their original time across
   a restart; present seats become absent at recovery. A current policy is applied after
   restoring, so the saved policy cannot overwrite a newer one from the Worker.
7. A final round result is published two ticks after the round closes so in-flight scores
   count. The host detects the phase transition and saves immediately, then also saves
   the final results. `world.finish()` saves its cleared match and later fresh match.
8. Local stress exposed a catch-up edge: using wall time alone once lost 22 ticks at
   20 Hz. Bounding both clocks fixed it without changing the configured interval.
9. The local restart proof uses 200 distinct rooms, eight socket players in each, four
   rooms concurrently. Repeated short runs in one room intentionally trip the restore-loop
   breaker. The revised local deploy proof keeps the same room through every replacement.
   A separate deterministic test performs twenty replacements of the same room, allowing
   ten seconds of ticks between replacements, and checks the complete state each time.

## Integration with the current main

The branch was collapsed to one signed commit and rebased onto main before the fixes.
The four conflicts were resolved together: both watcher/epoch tests remain; host saves
include input queues plus companion state and cached guide views; the core retains
pending decisions, typed goal validation, reserved policy, and untruncated recovery epochs;
the relay keeps server capacity and the restored occupant map. Main's directory and
registry removals remain intact.

The save policy now explicitly allows `reserved` alongside `bots`, `level`, and
`levelMax`. Dropping that field as the older review suggested would lose main's reserved
AI seats. All other policy keys are refused. This extends the validator to the existing
game format without requiring games to change. Structurally damaged saves are rejected;
optional companion data still passes main's declared coercion and goal/line checks.
A main test that previously expected a malformed core policy to be normalized now first
proves that the save is refused, then separately checks the companion sanitization with
a valid policy. Client frames still cannot provide policy, identity or decision answers.

## Third review corrections

| Item | Resolution and repository evidence |
|---|---|
| M1 | Superseded by the fourth correction below: a load event alone cannot establish that a frame loaded the game. Any welcome finishes an update regardless of build ID. |
| Minor 1 | Alarm work has its own failure counter and never marks cleanup pending. Only failed cleanup requests deletion. Tests fail writes once and for thirty seconds at a cold alarm and retain the match and seat. A sibling regression also proves that a failed alarm read during construction preserves recovery: unknown alarm state is not treated as a confirmed missing alarm. |
| Minor 2 | The prior 32-row arithmetic test was misleading and has been removed. Forty-eight cases now drive real Tables, people, watcher sockets, server-authenticated AI sockets, restores and actual due alarms for three simulated hours. They check the end deadline, bounded alarm count, saved rows and absence of a remaining alarm. `roomEndAt` is shared by visitor recovery and warm/cold alarm decisions. |
| Minor 3 | Restoring a save in play writes its first absence time. A failed pause write enters the normal save retry path. Further watcher reconnects/restores keep the original deadline. |
| Minor 4 | A restored active save with no stored alarm expires from its last successful save time. A save with an alarm still receives the normal cold-wake grace, so a slow write or repeated update does not itself end active play. If every medium refuses an end record but an old alarm remains, no code can reconstruct the exact departure; this is still a storage-loss limit, explicitly retained here. |
| Minor 5 | The single core validator checks unique seat/body ownership, matching drivers/owners, map bounds, an explicit policy key set, and pending joins against existing holders. Command/event/area declarations use own-key checks. Damage tests first failed on the reviewed implementation and now reject before rules run. |
| Minor 6 | Removed the changes to lab-check, card-host, video and sound tests. The fourth correction also removes the process-inspection change and its test. |
| Minor 7 | The fourth correction makes the real update proof conditional on an actual local Wrangler executable and a launchable Chrome. |
| Minor 8 | Removed the claim that unused watcher/AI/restored arguments proved behavior, and the description of endless reloads as intended behavior. This file records current behavior rather than superseded claims. |
| Minor 9 | Accepted the measured save overhead, a stopped validation host on cold alarms, and the 16 MB cap. These bound restore memory; none removes game state. |
| Minor 10 | The earlier mixed commit identities were collapsed as requested. New commits use only the project identity and signed-off trailers. |
| Minor 11 | Rebased onto current main. Companion tests cover guide views, pending decisions, goals, reserved bodies/names and pacing, including repeated save/restore. A seat whose holder never reconnects is freed through the restored occupant map; its saved name is removed. |

The reviewer scripts were located in the temporary archive after the initial repository
search. Their imports were redirected in a disposable copy to this checkout; the original
scripts and logs were left untouched. Regressions live in the normal test files, not in
an external-only proof. The summary file is absent.

## Storage and recovery limits

SQLite saves use ordered pieces of at most 1,000,000 bytes in one synchronous transaction.
A failed replacement retains the complete earlier save. The envelope is capped at 16 MB
before allocating the joined bytes. Save failures keep ticks/snapshots running and retry
with bounded backoff; the office reports degraded durability. Cleanup preserves office
and recorded-round data. Epoch reservation failures refuse the old match rather than
reuse an epoch. At most the configured save interval is replayed after a healthy save;
while storage refuses writes the last successful save can be older.

The normal output gate is unchanged. No new dependency or version change was needed.
Cloudflare's current alarm and Workers guidance was consulted. The real remote T2 gate
remains unmeasured: output-gate p99, billed rows for hour-long 4 KB/64 KB/1 MB runs at
8/32 sockets, real quota failure/reset behavior and deployed update propagation.
Nothing was deployed and no cloud credentials were used.

`rooms-saving.mjs` and `fixtures/rooms-saving.mjs` implement the remote measurement:
export `MeasuredTable as Table` from a disposable Preview, then run the saving script
with origin, game, target bytes, seat count and 3600 seconds. The 4 KB case needs a
minimal game; the fixture refuses if real state already exceeds the target instead of
trimming it. `--analytics` uses the existing analytics reader and explicitly distinguishes
measured billing from socket observations. `rooms-restarts.mjs` retains the 200-restart
proof and `rooms-deploys.mjs` the socket update proof. These are all checked in.

## Fourth review corrections

Main remains at the reviewed base; fetching found no new commits to integrate. The review
scripts and logs were read from the temporary review archive. Their cases now live in
`play.test.mjs`, `rooms-durability.test.mjs`, and `rooms-pages.test.mjs`.

| Item | Resolution |
|---|---|
| M1 | The update test checks the real local executable before starting anything and links `.bin/wrangler` into its disposable studio. Missing Wrangler or an unavailable Chrome is an explicit skip. No dependencies or versions changed. The runner starts its own server, waits for readiness without a machine-speed deadline, and stops its process group directly. It checks snapshots, the epoch chain, seat identity, and room identity, allowing one saved second per observed replacement plus two ticks of observation margin. It no longer infers tick progress from elapsed wall time. Each edit must produce a distinct build before the next edit; schedules retain their minimum gaps under load. |
| M2 | After a completed document load, the helper must report attached/ready or a welcome within five seconds. Silence, including browser error documents, schedules the same bounded 2/5/15-second retries as an explicit failure. An attached helper may continue waiting for its welcome without another document load. A document still loading is not discarded. Both scripts have silent, HTTP-status and reset regressions; a separate real-browser test serves those actual failures without requiring Wrangler. |
| Minor 1 | Restored the original two-reload assertion and the manual-reload message for older games. The rolling minute guard survives big-screen notices and successful acknowledgements. Repeated non-final notices cannot reset the count. |
| Minor 2 | Loading, pending retry delay, room wait, success, and exhausted retries each have truthful status text. Six unsuccessful rules-game loads end with “Reload the page”; there is no retry promise after the timer is cancelled. |
| Minor 3 | Restore-created pauses are marked separately from real departures. An expired provisional pause cannot expire the save while its stored alarm still awaits execution, even when SQL could not record the person's return. Both immediate recovery and five seconds of restored writes after a seventy-second outage preserve the last good tick on another restart. Alarm writes are serialized so a rapid return/departure cannot reorder the deadlines; an earlier alarm belonging to other work is preserved. The fallback after a refused first pause write runs after the relay is marked server-hosted, keeping its saved seats valid. Watcher-only recovery retains its original deadline. |
| Minor 4 | Failed retirement remains pending in the object. Cleanup now retries on an in-memory timer as well as an alarm; all-write failure cannot prevent that retry from being scheduled. Fault and owner-close tests refuse SQL, key-value and alarm writes, restore storage, and verify a fresh match after eviction. Cleanup generations discard late failures from an older end; key-marker deletion retries independently and cannot clear a newer SQL save. See the unavoidable total-storage-loss limit below. |
| Minor 5 | The real-Table matrix now also requires at least fifty seconds for a newly started absence. Its twice-restored already-absent rows retain their earlier deadline. |
| Minor 6 | Removed the unrelated process-inspection fallback and its regression file. |
| Minor 7 | Owners are bounded to 128 characters in live seat input, bodies, saved seats, and pending joins. Reserved AI seats cannot carry saved holder names. Host saves omit such names if a policy transition reserved a formerly held seat. |
| Minor 8 | Removed the obsolete validation counts and descriptions of iframe error handling. Results below distinguish optional skips, actual failures, and unmeasured remote behavior. |
| Minor 9 | No changelog file was changed. Proposed release wording: “Rooms keep their match and seats through compatible updates. Failed frame loads retry automatically with a clear recovery message. Slow-loading games have up to a minute to return.” |
| Minor 10 | Accepted the measured save overhead, validation host, size cap and equivalent object/text envelope representations. No game format was reduced. |

The full storage-loss limit cannot be eliminated by an in-memory marker: if SQL, key-value
and alarm writes all fail until the object itself is destroyed, the persisted bytes are
identical whether it ended or kept playing. A new object cannot distinguish those histories.
This applies to faults and owner closure as well as departures. The correction retains and
reasserts the end for the original object's entire life; it does not claim durability for
an end that no storage medium accepted before eviction. Existing alarm/save-age limits
still bound that case. No process-global room cache is used as pretend durable storage.

The design's section 12.2 assignments remain present, including `rooms-restarts.mjs`,
`rooms-deploys.mjs`, `rooms-saving.mjs` and the measured Table fixture. The remote T2
measurement remains unperformed; local tests cannot establish Cloudflare billing,
output-gate latency, quota-reset behavior, or rollout propagation.

## Validation for the fourth correction

New regressions were run against the reviewed implementation before the fixes: six silent
frame cases, two stale-pause cases, two failed-retirement cases and the oversized owner
case failed. The reserved-name case also failed before its validator correction. The
original legacy guard assertion has been restored. All test runs use a 1,536 MB heap and
one test file at a time. No real local Wrangler was started.

- `npm ci`: passed, zero reported vulnerabilities.
- `npm run build`: passed after the final code changes.
- Focused page, durability, host and companion checks: 255 tests, 253 passed, two explicit optional skips, zero failures.
- `npm test`: 1,007 tests, 999 passed, four optional skips, and the four baseline sandbox failures named below; exit 1. A serial runner wrapper excludes the nine browser cases listed below after Chrome launch proved unavailable. This is not described as an unmodified all-green default run.
- Four process-inspection tests fail both here and in a clean archive of current main, rerun alone on each. `/bin/ps` is denied by this sandbox. They are real validation limitations, not browser exceptions: “local dev with a custom-domain route in wrangler.jsonc: the route never reaches the local runtime, and rooms are local, port included”; “stale dev state heals itself: a record whose server was stopped another way, a leftover runtime on the port, and somebody else's port”; “a game added while dev runs: named while it is not built, and picked up once it is, without a hand restart”; “dev --stop stops exactly this studio's dev server (Wrangler with it), and nothing else”. Their implementation is back to main; this correction does not reintroduce the unrelated fallback just to satisfy the restricted environment.
- `npm run test:plugin`: the unfiltered attempt reached five browser-launch failures; the sound test then retained its HTTP listener after launch failed. The run excluding the ten browser-dependent cases below passed 106 tests, with one optional live-site skip and zero failures.
- `npm run leaks`: passed after the production changes.
- `node scripts/desktop.mjs --check`: passed, 64 tools and five cards. Its first attempt could not write the default npm cache; a writable temporary npm cache resolved that environment restriction. The rules build remains lazily imported.

The new ordinary-suite tests report their prerequisites explicitly:
“real Chrome play and watch pages retain their room through ten and thirty updates” skips
because the local Wrangler executable is absent; “real Chrome retries silent, HTTP error
and reset frame documents on play and watch pages” attempted Chrome and skips because it
cannot launch. No real-browser success is claimed for this correction.

Repository browser-dependent cases excluded from the restricted-environment rerun:

- `the style board card in a browser: Lock is the person's, recorded, and the model is told` (launch failure observed in the unfiltered attempt)
- `the lineup is three pictures: the inventory, the cast and the environment, with an unused asset in the inventory only`
- `shoot --preview: frames of the built game from the light preview server, no site running, named by the build's own hash and bundle`
- `a second clip library on one skeleton: refused at registration, never shadows the first, and a declared supplemental one joins coverage and previews; removing the starter models keeps the clips' credit`
- `the deploy plan's card shows the plan, and no card stays on "Loading" once its tool answered`
- `the Tell Homie card in a browser: Send sends the shown note once; Edit rewords it; Don't send sends nothing`
- `in Chrome: the lab's clock, timers, dice and presses replay a take frame for frame, at 60 and at 30 fps`
- `in Chrome: a game that rolls crypto dice is caught replaying differently, and both starters replay the same`
- `shoot against a stub site: two clients seated in one private room, then frames one clock step apart`

Plugin browser-dependent cases excluded from that rerun (launch failures were observed
for the first five; the remaining five were not rerun after the failed launch):

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
