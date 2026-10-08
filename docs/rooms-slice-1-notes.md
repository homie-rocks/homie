# Rooms, slice 1: notes from building it

Status: built and run on a local Cloudflare runtime, 2026-10-07. Not run on Cloudflare itself.
Slice 1 is "A game with its rules on the server" in [rooms-plan.md](rooms-plan.md) and section 14 of
[rooms-milestone-1-design.md](rooms-milestone-1-design.md). File paths are relative to
`packages/studio/` unless they start with `plugins/`, `template/` or `docs/`.

This file records three things: where the design met the code and a decision had to be made, the
evidence that what is built works, and what is not done or not proven.

## 1. What is built

| Part | Where |
|---|---|
| The rules contract, version 2: `defineRules`, `defineMove`, `f`, every field type, `compileRules` (names any declaration that does not fit), the `"room"` settings, the map format | `rules/rules.ts` |
| The maths rules may use, in plain arithmetic, and the ground-plane sweep the server and a browser share | `rules/math.ts` |
| Declared state held to its type, packed and unpacked; an entity on the wire; the whole room to bytes and back | `rules/pack.ts` |
| The core: four phases a tick, `self` and `world`, events and timers, areas, spawns, seats, bots, rounds, results, `world.finish()`, the budget, the save | `rules/core.ts` |
| The host runtime: frames in and out, the input protocol, the tick loop, pause and resume, the overrun check, the ten-second log line | `rules/host.ts` |
| The wall's run-time half: the budget counter, guarded keys and calls, the size cap | `rules/guard.ts` |
| The library a view uses: `openRoom`, the own body, interpolation, effects, round, roster, probes | `rules/view.ts` |
| The wall at build: the allowlist pass and the rewrites | `lib/rules-guard.mjs` |
| The build of a rules game, and the files the Worker imports | `lib/rules-build.mjs`, `lib/build.mjs` |
| The relay's server host, revision 10 | `worker/room.mjs` |
| The `Table` as host, with pause, end and alarm | `worker/index.mjs`, `worker/hosted.mjs` |
| Revision 10 in the helper (`net.steps`, `snapshot.e`, `rules: true`) | `netplay/netplay.ts` |
| The contract's text, section 29 | `netplay/NETPLAY.md` |
| The example starter | `starters/coin-dash/` |
| Local development: a saved rules file is built again and the local Worker restarts | `lib/dev.mjs` |
| The template, scaffold and upgrade: `site/src/worker.mjs`, `site/src/rules/index.mjs`, the `disallow_eval_during_startup` flag | `lib/scaffold.mjs`, `lib/upgrade.mjs`, `lib/studio.mjs`, `template/` |
| The deploy plan's line for each server-hosted game | `lib/cloudflare.mjs` |
| `perf` accepts a room with no browser host | `lib/perf.mjs` |
| The headless bot client, and the exit run | `test/bot-client.mjs`, `test/rules-exit.mjs` |
| Cloudflare's own figures for a room (not yet run against Cloudflare) | `lib/cf-usage.mjs` |
| One paragraph in the `game` skill | `plugins/homie/skills/game/SKILL.md` |
| Tests | `test/rules.test.mjs`, `test/rules-guard.test.mjs`, `test/rules-build.test.mjs`, `test/rules-view.test.mjs`, `test/rules-usage.test.mjs`, `test/rules-kit.mjs` |

## 2. Where the design met the code

Each row: what the design said, what the code required, what was chosen and why. Where there was a
choice, the option that does not force a rewrite of games later was taken.

### 2.1 The wall

| | The design said | The code required | Chosen, and why |
|---|---|---|---|
| 1 | The pass reads "the bundled rules", and "the checked file is the deployed file" | esbuild's bundler turns every top-level `const` into `var`. In the bundled module a module-level variable the author declared cannot be told from a constant, so "module-level `let` or `var` is refused" cannot be checked there | The pass reads each file after its types are removed and before linking, and rewrites it. The rewritten files are linked, and the linked module is read once more and held to the same rules, plus two of its own: no computed key the guard did not rewrite, and no loop or function it did not count. So the deployed file is still checked, and the module-level rule is checked where it can be |
| 2 | Six modules in `rules/` | The rewritten code needs something to call at run time, in the Worker, in a browser and in Node | A seventh small module, `rules/guard.ts`: the counter, the guarded accesses, the size cap. `lib/rules-guard.mjs` is the build half |
| 3 | A computed read is allowed for a number, or a string naming an own property that is not a function. "Anything else throws" | A lookup of a key that is absent is ordinary JavaScript (`table[k]` is `undefined`) | Throws, as the design says, with a message that says to test with `key in value` first. Loosening it later breaks no game; tightening it later would |
| 4 | "A method may be called, never read as a value" | A field may share a method's name: `hit.at`, `e.keys`. A static pass cannot tell `hit.at` from `list.at` | A static read of a name that is also a method name goes through a run-time check (`rd`): the value is returned unless it is a function |
| 5 | A refused name is refused as a key in a destructuring pattern | A pattern can also take a method out of a value: `const { push } = list` | In a plain `const { … } = value` declaration the guard checks each such binding once it is bound (`nf`). Anywhere else (a parameter, a loop head, an assignment) a pattern that names a method name or a computed key is refused with the line, and the message says to use a plain declaration or a dot |
| 6 | Computed access is rewritten, `a?.[b]` included | An optional chain that goes on after a computed step or a method name (`a?.[k].b()`) cannot be rewritten without changing where it stops | Refused with the line: "take the first step into a const". The short forms (`a?.[k]`, `a?.name`, `a?.method()`) are rewritten |
| 7 | "A string made by `+` or by a template" is charged a unit a character | Wrapping every `+` in a call slows all arithmetic | `+` is wrapped unless one side is a number whatever runs (a literal, `-`, `*`, a `Math` call). `x += v` the same. A text can then grow by a few characters a loop turn uncharged, and the loop turn is charged; doubling (`s + s`) is always wrapped |
| 8 | "Module-level constants are deep-frozen at load" | | A module-level list or object literal is wrapped in `deepFreeze`. `defineRules` and `defineMove` freeze what they are given |
| 9 | The top level holds "imports, constants made of literals, function definitions, and calls to `defineRules`, `defineMove` and `f`" | Removing types turns `export default <expression>` into a `var` that is exported as the default | That one `var` is accepted, and only when it is the module's default export. Nothing may assign to anything module-level either way |
| 10 | `Map` and `Set` "inside a handler only" | | `new Map()` and `new Set()` become guard calls that charge and cap them; outside a function they are refused |
| 11 | Type checking of rules is slice 4 | | `World` and `Self` are deliberately loose types in this slice. The run-time checks do not depend on them |

### 2.2 The contract and the core

| | The design said | The code required | Chosen, and why |
|---|---|---|---|
| 12 | Ids are opaque | A concrete form | Strings: `e1`, `e2`… for entities, `p<n>` for the person in a seat (from the relay's own number for a stay in a seat, `peer.occ`). A string cannot be used in arithmetic |
| 13 | `f.fix` is "fixed-point" | A step and a range. Section 15 keeps `world.tick + 1.4` in one | Steps of 1/4096, to plus or minus 2^31. A tick count with a fraction fits for the life of any room |
| 14 | "Bots count as seats"; a body has a `seat` | The relay numbers people's seats from 0 and AI seats from the top. A bot needs a number that does not collide | A body's `seat` is its slot in the room. Bots take the highest free numbers. A person who takes over a bot's body gives the body the person's seat number. The bot taken over is the one already in that seat, else the one in the highest seat |
| 15 | Phase 0: "seat changes take effect", then bots fill | Order | Rounds turn, then seat changes, then bots fill, then arrivals. So people who are there on the first tick get bodies of their own and bots fill what is left |
| 16 | "An entity exists from the next tick" after `world.spawn` | The snapshot is taken after phase 3, where spawns join | A spawned entity is in the snapshot of the tick it was spawned on, and runs `arrive` on the next. This is what section 3.5 says read closely; a test first assumed otherwise |
| 17 | A map is "one file per map" in `map/` | Which one a room uses | `map/main.json`, else the first by name. A map has `bounds`, `boxes`, `circles` and named `spots`. Height tiles, spheres and capsules arrive with 3D |
| 18 | `ctx.map.sweep` "stops at the first thing in the way" | Stopping dead at a wall feels wrong when pushing along it | The sweep stops and returns `{ at, normal }`. `coin-dash`'s `move.ts` uses the normal to slide for what is left of the step: six lines more than the listing in section 3.7. The rules file is the listing, with `move: 'owner'` |
| 19 | The server "holds the claim to `body.maxSpeed`, as `capMove` does today" | Claims arrive unevenly. A cap per frame would punish a late frame | An allowance: each tick adds one tick of `maxSpeed` (plus 2%), a quarter of a second is banked at most, and a claim moves the body by what the allowance covers. Over any stretch the body's speed is `maxSpeed` |
| 20 | `motion` is replayed by the browser | With owner movement the server does not run `move` for a person's body | The browser takes its body's `motion` from every snapshot. What a browser's own `move` writes to `motion` does not reach the server until the server moves every body (slice 6) |
| 21 | `world.ask` runs in slice 5; "the format accepts and checks all of this from slice 1" | What `world.ask` does until then | The game's own `floor` answers on the next tick, with `by: 'floor'`, which is section 3.10's "in the check" rule. `guide` and `asks` are checked and otherwise unused. `self.goal` is always empty |
| 22 | Space is `dims: 2` or `dims: 3` | 3D bodies are slice 7 | The format accepts `dims: 3`. The core refuses to start such a game and says why, so its room refuses joins with that reason |
| 23 | No stated cap on entities, effects or pending commands | Something must bound them | 2,048 entities a room, 256 effects a tick, 16 pending commands a body. A spawn past the cap throws in the handler that asked |
| 24 | The budget: a handler stops at a quarter of `budget.tick`; a tick that has used it all ends early | Which calls are never skipped | `move`, `think`, `room.join` and `room.start` always run with a quarter each. Handlers and events are skipped once the tick's budget is gone, and unrun events stay queued in order |

### 2.3 The wire and the room

| | The design said | The code required | Chosen, and why |
|---|---|---|---|
| 25 | "The frames are today's"; state is "packed from the declared fields" | Today's frames are JSON text | The packed form is positional JSON: no field names, a vector as `[x, y]`. The whole-room save is the same JSON as UTF-8 bytes. No binary encoding library was added, because nothing binary is on the wire |
| 26 | An owner-moved body's entry "also carries the claimed `pos`, `vel` and `heading`" | 2D now, 3D in slice 7, and "nothing later in milestone 1 changes" the frames | Nine numbers always: `x y z` for each. `z` is 0 when `dims` is 2 |
| 27 | Effects are "sent to the players' views" | A congested socket skips snapshots, and an effect must not be lost | Effects ride reliable `ev` frames of kind `fx`, one a tick: `[tick, [[effect, at, data]…]]`. A view plays each when it draws that tick. Commands are `ev` frames of kind `cmd` |
| 28 | The keyed `state` channel "carries `shared`" | | One key, `shared`, sent when it changes. A joiner has it in the welcome |
| 29 | "The welcome carries the epoch" | The relay does not know the epoch | The welcome's `snap` has it (`snap.e`), as every snapshot does |
| 30 | The relay calls the host "with parsed frames" | A browser host learns that a held seat was given up from its own timers. The server host cannot see the relay's hold | One frame beside today's: `{ t: 'free', seat }`, sent when a seat the runtime was told of is no longer held (the hold ran out, or the owner removed the player). The relay compares the seats on its 250 ms beat, so every path that frees a seat is covered |
| 31 | "The last person's socket closes: the room pauses… Nobody returns within 60 s: the room ends" and "watchers see the paused state" | Whether a room ends with a watcher still connected | It does not. A watcher's socket keeps the paused room, as it keeps a browser-hosted room from being forgotten today. It ends a minute after the last one has gone |
| 32 | One alarm, shared with the house guides and the day's counters | A guide's `setAlarm` would push the room's alarm back | The room's alarm time is kept, and a guide's alarm is never set later than it |
| 33 | "A paused room that Cloudflare has dropped from memory also starts fresh" | After the drop there is no room in memory when the alarm fires | The alarm then deletes the stored seats (`net`) of a room that was server-hosted. Seen in the local run: the object was dropped about ten seconds after its last socket closed, and the alarm ended the room at sixty |
| 34 | The overrun check: a late tick "blames the tick that ran just before it" | Two rooms in one isolate: after a slow room's tick, the other room's quick tick is the one "just before" the slow room's next late start, and would be blamed | The module memory keeps the last eight tick starts. A late tick blames the newest of them that took more than a period. A slow room is then blamed by its neighbours and by itself, and a quick neighbour is not. Open point 2 of section 16 still decides whether the check can work on Cloudflare at all |
| 35 | A snapshot has `st` | Ticks run in a burst to catch up would share a time | `st` is the moment the tick was due, never later than now, always rising |
| 36 | "For a rules game the build hash takes the place of `netplay.version`" | The change table gives the hashes to slice 2 | Not done here. `netplay.version` is still read for a rules game, and the build prints no line about it. The build does stamp a digest of the rules module and its data (`room.build` in the catalogue) for the log |
| 37 | `host: browser` is a setting | Browser-hosted rules are slice 3 | A rules game that asks for it fails the build with "arrives in a later release" |

### 2.4 The build, the studio and the tools

| | The design said | The code required | Chosen, and why |
|---|---|---|---|
| 38 | The rules go "under `site/src/`", and `site/src/worker.mjs` imports them | A shape | `site/src/rules/<id>.mjs` (the module), `<id>.data.mjs` (tunables, map, settings, seats), `index.mjs` (the table). `worker.mjs` calls `hostRules(rules)`. They are build output that is committed with the studio, like `wrangler.jsonc`: the Worker cannot be bundled without them. A new studio starts with an empty table |
| 39 | The build check is slice 4 | A rules module that throws on its first tick should not reach a room | The build loads the rules in Node, compiles them, and runs three seconds with bots and one seated player. A handler that throws or runs out its budget stops the build with its name. This is less than slice 4's check and is not meant to replace it |
| 40 | The view's bundle holds `view.ts` and `move.ts` | `openRoom()` takes no argument, and the view must unpack frames without the rules | The build puts two imports ahead of the view: the game's declarations as data and its guarded `move`, handed to the library with `setGame`. `rules.ts` is replaced by an empty module in the view's bundle, so a stray import of it cannot carry a handler into a browser |
| 41 | `lib/` code runs from an installed package | Node will not load a `.ts` file from `node_modules` | `lib/rules-guard.mjs` has its own copy of the allowlists, and a test holds each equal to the runtime's. The build loads the runtime through esbuild |
| 42 | `coin-dash` is "offered once slices 2 and 4 are both released" | `starters()` lists every folder | `game.json` says `"example": true`. `homie-studio game new <id> --from coin-dash` works; the chat's `game_make` does not name it |
| 43 | `check`, `shoot` and the judge change | They read `window.__shell` and the two probes, and none of them requires a host role | No change was needed. `check` was run on `coin-dash` and passes. `perf` did require a host, and keyed its numbers by role: it now accepts a server-hosted room, names the second browser `replica-2`, and records the room's tick figures from the watch feed |
| 44 | The own body's lead control is section 6.1, slice 6 | An input entry needs a stamp near the server's tick now | A small version: a target lead of one tick, the median of the last 8 `lead` values, a nudge of at most a twentieth of a tick a snapshot, and the clock set again when the median is four ticks off or a frame took longer than a quarter of a second. Slice 6 replaces it with section 6.1 in full. The own body is drawn between ticks as section 6.3 says: `move` run ahead on a copy |
| 45 | A version bump needs a changelog section that links its pull request | This slice has no pull request yet, and a test requires the link | The 0.33.0 section links the plan's pull request, #56. Change it to this slice's own when it has one |

## 3. Evidence

All of this was run on one computer on 2026-10-07, against the studio's Worker under local Wrangler
(4.145.0). Paths under the scratch studio are shown relative to it.

### 3.1 The scratch studio and its build

```
$ homie-studio new <scratch>/studio1 --name "Slice One" --no-install
$ cd <scratch>/studio1      # node_modules/@homie-rocks/studio links to this checkout's packages/studio
$ homie-studio game new coin-dash --from coin-dash
$ homie-studio game new gems --from gem-rush
$ homie-studio build
built coin-dash (bundle, 71 KB)
  coin-dash: its rules run on the server (checked and guarded, 5 KB, build e2c960293e2b7706; three seconds with bots used at most 177 of 2000000 budget units in one handler)
built gems (bundle, 89 KB)
hosted by a player's browser, as before (no src/rules.ts; nothing to do): gems
Built coin-dash (71 KB), gems (89 KB) into site/dist
$ ls site/src/rules
coin-dash.data.mjs  coin-dash.mjs  index.mjs
```

### 3.2 Local dev, and the repository's own two-browser check

```
$ homie-studio dev --port 8791
[wrangler:info] Ready on http://127.0.0.1:8791
Rooms here are local: games open their room sockets at ws://127.0.0.1:8791.

$ homie-studio check coin-dash --url http://127.0.0.1:8791
computer opened http://127.0.0.1:8791/coin-dash/play
phone opened http://127.0.0.1:8791/coin-dash/play
seated: computer room pub-1 seat 0 replica; phone room pub-1 seat 1 replica
drawing: computer 60 fps, phone 61 fps (ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version))
PASS: two fresh browsers in room pub-1 finished round 1 (2 humans, 2 bots) in 62 s.
  computer: seat 0 (replica), seated in 0.9 s
  phone: seat 1 (replica), seated in 0.3 s
  computer ready: the loading cover lifted at 0.2 s (by the auto)
  phone ready: the loading cover lifted at 0.1 s (by the auto)
  Connection: uninterrupted (no reconnects: both connections held from the seat to the results)
```

Both browsers are replicas. No browser hosted anything. The room's log for that run starts with the
host runtime, before the first hello:

```
{"ev":"host-start","game":"coin-dash","tick":0,"epoch":3110187005,"tickHz":20,"room":"try1"}
{"ev":"hello","room":"try1","seat":0,"role":"replica","why":"joined","clients":1,"game":"coin-dash"}
```

### 3.3 The exit run: two browsers, a changed client, a closed tab, a full round

`test/rules-exit.mjs` drives two headless Chrome browsers through the play page and one raw socket
("Mallory") that sends what only a host may say.

```
$ node packages/studio/test/rules-exit.mjs --url http://127.0.0.1:8791 --game coin-dash --bots 0
PASS two-browsers-one-room: seats 0 and 1 in room exit-muysq49v
PASS no-browser-hosts: roles replica, replica; host {"id":"server","seat":null}
PASS own-body-answers-input: holding right for 1 s moved the computer's body 6.14 m (the runner's speed is 6 m/s) while the room went from tick 16 to 36
PASS forged-frames-change-nothing: 160 forged frames; the forger's score stayed 3, its body moved 9.86 m (held to 6 m/s), the browsers' round is still live with no forged score, name or result
PASS closing-a-tab-interrupts-nobody: after the phone's tab closed the computer saw 80 ticks in 4 s and is playing
PASS round-finished-with-the-servers-results: round 1: Dash 9 (bot), Static Lynx 3, Mallory 3, Mellow Moth 1; the same list reached the browser and the socket
```

- The forged frames were twenty rounds of: a `snap` far in the future, a `round` that is over with a
  score of 999, `state` under two keys, a `roster` with another name, a `ckpt`, an `fx` event, and an
  `in` frame that claims a place 40 m away and carries extra numbers and a `score` field.
- Mallory's score of 3 is the score of the bot whose body it took over when it joined. It did not
  change while it forged.
- 9.86 m in the 1.5 s of forging is the speed cap: 6 m/s for 1.5 s, plus the quarter of a second the
  allowance may bank.

### 3.4 The round is in the studio's stats

```
$ wrangler d1 execute DB --local --command "SELECT game, room, n, humans, bots, substr(results,1,160) FROM rounds ORDER BY at DESC LIMIT 4"
"game": "coin-dash", "room": "exit-muyse4xk", "n": 1, "humans": 3, "bots": 1,
"results": "[{\"slot\":5,\"seat\":null,\"name\":\"Dash\",\"score\":9,\"bot\":true,\"place\":1},{\"slot\":2,\"seat\":2,\"name\":\"Mallory\",\"score\":5,\"bot\":false,\"place\":2},…"
"game": "coin-dash", "room": "pub-1", "n": 1, "humans": 2, "bots": 2, …
```

The `Table`'s round recording was not changed: the host runtime sends today's `round` frame.

### 3.5 The life of a room, from the local log

```
{"ev":"ticks","game":"coin-dash","build":"e2c960293e2b7706","tick":1203,"ticks":200,"late":0,"slips":0,"ins":169,"lateEntries":0,"dropped":0,"errors":0,"budgetStops":0,"cut":0,"maxUnits":177,"worst":"room.on.roundStart","room":"exit-muyse4xk"}
{"at":"…T00:18:01.517Z","ev":"host-pause","game":"coin-dash","tick":1214,"room":"exit-muyse4xk"}
{"at":"…T00:19:01.533Z","ev":"host-over","why":"nobody-returned"}
```

The room paused the moment its last person left and ended sixty seconds later, on the alarm. The
`host-over` line with that reason comes from a `Table` that was no longer in memory when the alarm
fired: the local runtime had dropped the object once it had no socket and no timer. Whether
Cloudflare stops billing such an object is the part that needs Cloudflare's own figures.

### 3.6 The room's beat, measured locally by eight headless players

```
$ node packages/studio/test/rules-exit.mjs --url http://127.0.0.1:8791 --game coin-dash --minutes 8 --bots 8
8 headless players in room beat-muysxw0x for 8 min…
PASS the-room-keeps-its-beat: 8 players for 8 min: each received at least 100.00% of the ticks due (the line is 99.5%), and at least 99.98% of snapshot gaps were under 75 ms (the line is 99%); the worst 99th percentile gap was 53.5 ms
```

| Player | Ticks due | Ticks received | Gap, median | Gap, 99th percentile | Longest gap | Gaps under 75 ms | Lead, median |
|---|---|---|---|---|---|---|---|
| Each of the 8 | 9,600 or 9,601 | all of them | 50 ms | 53.4 to 53.5 ms | 106 ms | 99.98% | 1.94 ticks |

The room's own log for those eight minutes: 48 lines, each of 200 or 201 ticks in ten seconds, no
late tick, no slip, no late input entry, no handler error.

**This says how a local runtime on one quiet computer keeps a beat. It says nothing about
Cloudflare.** Local objects share one process and local clocks behave differently (section 12 of the
design). It is eight minutes, not T1's twenty. An earlier one-minute run gave 99.67% of gaps under
75 ms, and a run made while tests and audits were using the same computer was spoiled (section 7).

### 3.7 Tests and audits

```
$ npm ci
found 0 vulnerabilities

$ npm run build
> tsc --build

$ npm test
# tests 726
# pass 724
# fail 0
# skipped 2

$ npm run test:plugin
# tests 117
# pass 116
# fail 0
# skipped 1

$ npm run leaks
[PASS] Files: no symlinks, submodules, binaries or secret-bearing files
[PASS] Home, machine and private paths; package folders this repository does not have; private commit ids
[PASS] Email addresses (project contacts @homie.rocks; in a commit message, a person's trailer)
[PASS] Tokens, keys, account ids, UUIDs, workers.dev hosts
[PASS] npm scope: @homie-rocks/ only, never @homie/
[PASS] Words of a private build process
[PASS] (the row for unfinished markers left in a file; its own title is left out here, because the audit reads this file too)
[PASS] The maintainers' private terms (number and kind only)
```

The skipped tests were skipped before this change too. The leak audit was run without the
maintainers' private terms, which are not on this computer: that row passes with nothing to compare.

Also seen in the local run: `homie-studio dev` built `coin-dash` again when its `rules.ts` was saved
and Wrangler restarted the local Worker with it; a saved rule that used `Date.now()` was refused with
its line (`games/coin-dash/src/rules.ts:47 Date is not available in rules…`) and the local site kept
running what it had.

## 4. What is built and not proven

- **Anything on Cloudflare itself.** Nothing was deployed and no credentials were used. Section 5.
- `lib/cf-usage.mjs`: run only against a stand-in for Cloudflare's analytics API. Its dataset and
  field names are from Cloudflare's published schema as remembered, and its first real run must
  confirm them.
- `homie-studio perf` on a server-hosted game: the change has its unit tests and was not run against
  `coin-dash`. `shoot` and the playtest judge were read, not run, against it.
- The view library's hidden-tab path (one neutral entry, then no stepping), its reconnect path, a
  watcher's `room.follow`, `room.ask` and `room.askButtons`, and `inputHz` below `tickHz` (more than
  one entry a frame) are written and have no test.
- `homie-studio upgrade` on a studio made before this version: the template's history and the
  upgrade tests pass, and no older studio was upgraded for real.
- A deploy plan's figures (29.5% of the free plan's requests for an hour of a full 8-player room, and
  so on) are section 11's arithmetic. They are not measurements.
- The overrun check and the two-second budget rule end a room in tests with a clock the test moves.
  Whether a timer callback's clock on Cloudflare includes the time the callback before it took (open
  point 2) is not known, and the check depends on it.

## 5. What in slice 1 is not done

| Not done | Why |
|---|---|
| The exit test on real Cloudflare: T1 (8 players for 20 minutes at 20 Hz, then 30 Hz, with requests and GB-seconds read from Cloudflare's analytics), "a room everyone has left stops being billed, checked on Cloudflare's own figures", and open points 1 and 2 of section 16 | The instruction for this work was to deploy nothing and use no credentials. `test/rules-exit.mjs` with a deployed site's address is the measurement, and `lib/cf-usage.mjs` reads the figures |
| The build hash as the game's revision, and the line the build prints when `netplay.version` is present | Row 36: the change table gives the hashes to slice 2 |
| Precise types for `world`, `self` and `shapes` | Slice 4 ships the compiler and the type check |
| `shoot` and the playtest judge run against a rules game | Row 43: nothing in them needed changing; they were not run |

## 6. Libraries added

| Library | Version | Licence | Why this one |
|---|---|---|---|
| `@babel/parser` | 8.0.7 | MIT | The wall needs a parser that keeps up with the language. Babel's is what most JavaScript tooling is built on |
| `@babel/traverse` | 8.0.7 | MIT | Scope analysis: the pass must tell a global from a local or a field of the same name |
| `@babel/generator` | 8.0.6 | MIT | Prints the rewritten tree |
| `@babel/types` | 8.0.6 | MIT | Builds and tests tree nodes |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | Reads the type-removal's source map, so a problem names the line the author wrote |

All are pinned exactly in `packages/studio/package.json`, as the package's other dependencies are,
and all are compatible with Apache-2.0. esbuild (already a dependency) removes the types and links
the module. `puppeteer-core` (already a dependency) and Node's own WebSocket drive the exit run.
`node:test` runs the tests. No library was added for encoding (row 25) or for schema validation:
`compileRules` checks a rules module against a contract that is this project's own.

## 7. For the next slices

- **Slice 2 (the save).** `core.save()` and `createCore(compiled, { restore })` exist and are tested
  to carry a room on tick for tick; `host.save()` adds the names and each seat's held input. Nothing
  calls them from the `Table`. `HostOptions.store` is accepted and unused. The state hash is not
  written: `rules/rules.ts` `schemaOf` has most of what it covers. `room.build` in the catalogue is
  a digest of the rules module and its data, not the build hash of section 5 (it leaves the view
  out). The relay's `saved()` marks a server-hosted room (`hosted: 'server'`), and `restore()` then
  keeps seats and drops the old match's round, roster and state. The `Table`'s alarm already ends a
  room nobody came back to, and deletes `net`; add the save rows and `boots` there.
- **Slice 3 (browser-hosted rules, offline).** `createHost` has no Cloudflare and no transport in
  it, and a test runs the view library against it in Node. The build refuses `host: browser` for a
  rules game in one place (`lib/rules-build.mjs` `prepareRules`). The helper's offline fallback still
  makes a rules game's page an offline "host" with nothing to run: `openRoom` shows status `offline`.
- **Slice 4 (the build check).** `lib/rules-build.mjs` `loadRules` loads a guarded module with the
  runtime as one instance, and `smokeRun` is where the generated runs belong. The fifteen planted
  faults of section 10 are each covered one at a time in `test/rules-guard.test.mjs` and
  `test/rules.test.mjs`, not yet as one file. `World` and `Self` in `rules/rules.ts` are the types
  to make precise.
- **Slice 5 (AI seats, guides, `world.ask`).** An AI seat joins as a body with `driver: 'ai'`, and
  `think` steers it with no goal. A hands-`host` agent is refused (`agents-unsupported`), because
  the server host declares only the `skill` capability. `world.ask` answers from the floor.
- **Slice 6 (prediction).** `rules/view.ts` holds a small lead control and draws the own body
  between ticks; replay, catch-up and the smoothing of section 6.3 are not there. `coin-dash`
  declares `move: 'owner'`; removing that line makes the server move every body today, and the view
  then draws the own body from snapshots, late.
- **The wall is strict where the design is strict.** A computed read of a key the value does not
  hold throws (row 3). If that proves too sharp for AI-written rules, loosening it breaks nothing.
- **Do not measure on a busy computer.** A first long local run was spoiled by other work
  on the same machine: ticks ran late, the room's clock ran slow as designed, and the bot client of
  that moment answered every queued snapshot at once and was removed by the relay for flooding. The
  bot client now sends at most one frame a tick of its own time, as a view does.
