# Rooms, slice 1: notes from building it

Status: built and run on a local Cloudflare runtime, 2026-10-07, and revised the same day after an
independent review found three faults in one place (section 8). Not run on Cloudflare itself.
Slice 1 is "A game with its rules on the server" in [rooms-plan.md](rooms-plan.md) and section 14 of
[rooms-milestone-1-design.md](rooms-milestone-1-design.md). File paths are relative to
`packages/studio/` unless they start with `plugins/`, `template/` or `docs/`.

This file records three things: where the design met the code and a decision had to be made, the
evidence that what is built works, and what is not done or not proven. Section 8 is the review's
findings, how each was closed, everything that was gone through afterwards and what that found.

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
| Hostile and careless rules against the wall, and what a budget unit costs in time (a measurement, run by hand) | `test/rules-hostile.test.mjs`, `test/rules-cost.mjs` |
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
| 23 | No stated cap on entities, effects or pending commands | Something must bound them | 2,048 entities a room, 256 effects a tick, 16 pending commands a body. A spawn past the cap throws in the handler that asked. Section 8.6 adds the bounds the review's follow-up needed: events and timers waiting, area events a tick, what a field holds when full |
| 24 | The budget: a handler stops at a quarter of `budget.tick`; a tick that has used it all ends early | Which calls are never skipped, and what each is given | A handler that runs is given a whole quarter, so a tick's last handler may take it one quarter over. `move`, `think`, `room.join` and `room.start` always run: with a quarter while the tick has budget left, and with a small share once it is gone (`budget.tick` divided by four times the most entities a room holds), so a room full of bodies cannot take a quarter each. Handlers and events are skipped once the tick's budget is gone; unrun events, commands and an entity's `arrive` wait, in order, for a later tick. (First built as "what is left of the tick when that is less", which cut a handler short for running late in a busy tick, and gave every `move` a quarter whatever was left: section 8.6) |

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
| 34 | The overrun check: a late tick "blames the tick that ran just before it"; "a room blamed on every tick for 5 s ends" | Two rooms in one isolate: after a slow room's tick, the other room's quick tick is the one "just before" the slow room's next late start, and would be blamed. And "5 s" was first counted as five seconds' worth of ticks | The module memory keeps the last eight tick starts. A late tick blames the newest of them that took more than a period. A slow room is then blamed by its neighbours and by itself, and a quick neighbour is not. The five seconds are seconds of the clock, from the start of the first tick blamed (section 8.4). A tick only a little longer than a period is not blamed every time, so a run of slow ticks goes on while at least half the ticks in it were blamed. Open point 2 of section 16 still decides whether the check can work on Cloudflare at all |
| 35 | A snapshot has `st` | Ticks run in a burst to catch up would share a time | `st` is the moment the tick was due, never later than now, always rising |
| 36 | "For a rules game the build hash takes the place of `netplay.version`" | The change table gives the hashes to slice 2 | Not done here. `netplay.version` is still read for a rules game, and the build prints no line about it. The build does stamp a digest of the rules module and its data (`room.build` in the catalogue) for the log |
| 37 | `host: browser` is a setting | Browser-hosted rules are slice 3 | A rules game that asks for it fails the build with "arrives in a later release" |

### 2.4 The build, the studio and the tools

| | The design said | The code required | Chosen, and why |
|---|---|---|---|
| 38 | The rules go "under `site/src/`", and `site/src/worker.mjs` imports them | A shape | `site/src/rules/<id>.mjs` (the module), `<id>.data.mjs` (tunables, map, settings, seats), `index.mjs` (the table). `worker.mjs` calls `hostRules(rules)`. They are build output that is committed with the studio, like `wrangler.jsonc`: the Worker cannot be bundled without them. A new studio starts with an empty table |
| 39 | The build check is slice 4 | A rules module that throws on its first tick should not reach a room | The build loads the rules in Node, compiles them, and runs three seconds with bots and one seated player. A handler that throws or runs out its budget stops the build with its name, and so does a tick that takes longer on the build's own clock than a tick lasts (three ticks of the run over the period, or one over four periods). This is less than slice 4's check and is not meant to replace it |
| 40 | The view's bundle holds `view.ts` and `move.ts` | `openRoom()` takes no argument, and the view must unpack frames without the rules | The build puts two imports ahead of the view: the game's declarations as data and its guarded `move`, handed to the library with `setGame`. `rules.ts` is replaced by an empty module in the view's bundle, so a stray import of it cannot carry a handler into a browser |
| 41 | `lib/` code runs from an installed package | Node will not load a `.ts` file from `node_modules` | `lib/rules-guard.mjs` has its own copy of the allowlists, and a test holds each equal to the runtime's. The build loads the runtime through esbuild |
| 42 | `coin-dash` is "offered once slices 2 and 4 are both released" | `starters()` lists every folder | `game.json` says `"example": true`. `homie-studio game new <id> --from coin-dash` works; the chat's `game_make` does not name it |
| 43 | `check`, `shoot` and the judge change | They read `window.__shell` and the two probes, and none of them requires a host role | No change was needed. `check` was run on `coin-dash` and passes. `perf` did require a host, and keyed its numbers by role: it now accepts a server-hosted room, names the second browser `replica-2`, and records the room's tick figures from the watch feed |
| 44 | The own body's lead control is section 6.1, slice 6 | An input entry needs a stamp near the server's tick now | A small version: a target lead of one tick, the median of the last 8 `lead` values, a nudge of at most a twentieth of a tick a snapshot, and the clock set again when the median is four ticks off or a frame took longer than a quarter of a second. Slice 6 replaces it with section 6.1 in full. The own body is drawn between ticks as section 6.3 says: `move` run ahead on a copy |
| 45 | A version bump needs a changelog section that links its pull request | When the section was written this slice had no pull request, and a test requires the link | The 0.33.0 section links this slice's own pull request, #57 |

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

## 8. After the first review

An independent review of this slice found no fault in the build's wall, in the server's authority
on the wire or in the life of a room, and three faults in one place: work the runtime did on values
that came from the rules, after the try that catches a handler and after its budget was closed
(`rules/core.ts`, `rules/host.ts`, `rules/pack.ts`). This section says how each was closed, what
was then gone through looking for their relatives, and what that found.

### 8.1 The three findings, and how each was closed

| | What the review found | How it is closed | Where |
|---|---|---|---|
| M1 | A value that cannot become a number (an object pushed into a declared list, or returned from `think`) threw `Cannot convert object to primitive value` after the handler's try. The throw left `wake()`, the timer was never armed again, and the room stood still for good with its players connected and its object billed | Three things, any one of which would have been enough. (1) Reading a value from the rules cannot throw: a number is taken from a number, a text from a text, and anything else is the zero of the declared type (8.2). (2) Everything that reads what the rules hand back happens inside `run()`: inside the try, inside the budget. (3) Whatever is thrown anywhere in a tick, the runtime's own code included, is caught where the tick began, logged, counted, and the timer is armed again (8.3) | `rules/pack.ts` `coerce`, `own`, `num`; `rules/core.ts` `run`, `settle`, `errorText`; `rules/host.ts` `tick`, `wake`, `keepTime` |
| M2 | A `valueOf` on an object returned from `think` was called by the runtime's own `Number(v)`, after the counter had been set back to Infinity: thirty million loop turns in a tick against a quota of 500,000, and no stop | The runtime never calls anything of the rules' to read a value: no `Number(x)` or `String(x)` on an object anywhere a value from the rules can reach, and every property read by its descriptor, so a getter reads as absent (8.2). The build also refuses a function under `valueOf`, `toString` or `toJSON` with its line, and the guard refuses one as the property is made where the build cannot see it. Nothing of the rules' is touched after `run()` returns | `rules/pack.ts`; `rules/guard.ts` `own`, `nh`, `HOOK_NAMES`; `lib/rules-guard.mjs` |
| M3 | `world.near` charged 2 units an entity and then made a frozen copy of every field of everything it found: with 400 entities each holding a list of 1,024 numbers a tick took about a second and the budget never noticed. And the overrun check counted `5 * tickHz` ticks, so that room would have held its isolate for about a hundred seconds | Stored state is frozen plain data, so a query hands it out as it is: `world.near` now copies nothing, and is charged for each entity it scans and each it hands out, before it does either (8.2, 8.5). The overrun check is five seconds of the clock, and so is the rule that ends a room whose every tick fails (8.4). The build's own run stops on a tick that takes longer than a tick lasts. Every charge was measured, and the default budget set from the measurement (8.5) | `rules/core.ts` `viewOf`, `typed`, `settle`, `VIEW`, `COPY`; `rules/host.ts` `FAIL_MS`, `OVERRUN_MS`; `lib/rules-build.mjs` `smokeRun`; `test/rules-cost.mjs` |

The review's own cases, run from its files against this code:

```
$ node slice-1-tests/frozen-room.mjs
{"secondsRun":20,"tick":400,"snapshotsSent":400,"running":true,"paused":false,"pendingTimers":1,"uncaughtFromTimer":0,"onEnd":[],"errorsCounted":0}
$ node slice-1-tests/runtime-holes.mjs
CONTAINED        A_settle_throws
   errors=0 budgetStops=0 last=-  tick=5  2 ms for 5 ticks
CONTAINED        B_think_result_throws
   errors=0 budgetStops=0 last=-  tick=5  2 ms for 5 ticks
REFUSED          C_valueOf_runs_unbudgeted
   C_valueOf_runs_unbudgeted/src/rules.ts:8 a function named "valueOf" is refused in rules: JavaScript would call it by itself whenever the object is used as a number or a text, outside any handler
CONTAINED        D_near_cost_under_budget
   errors=0 budgetStops=0 last=-  tick=6  41 ms for 6 ticks
$ node slice-1-tests/wall-attack.mjs
total=38 refused=25 runtime-stopped=12 ran-clean=1 got-through=0
$ node slice-1-tests/room-attack.mjs
=== room-attack: 10 pass, 0 fail ===
```

Before: the first stopped at tick 100 with no timer pending, A and B escaped the tick, C ran its
thirty million turns uncounted, and D took 6,155 ms for six ticks. The same cases are in the
repository's own tests (`test/rules-hostile.test.mjs`). The build refuses C, so the test that
proves the runtime itself never calls a hook hands it a rules module that never went through the
build, with a hook planted on every value it hands over, and counts the hooks run: none.

### 8.2 The boundary

One place now stands between the rules and the runtime, and nothing the rules hand over is used
as it stands. It is `rules/pack.ts` (its header says "THE BOUNDARY"), with the two readers under
it in `rules/guard.ts` (`own`, `put`). What comes through it:

- what a handler returns (`think`, `room.join`, a game's own answer to `world.ask`);
- every argument of every `world` and `ctx` call;
- everything written to a field, a list, a map, a struct, `motion`, `vel`, `heading`, `shared`;
- the data of every event, command and effect, and what `move` leaves in the body it was handed;
- what a handler throws, when it is turned into a line for the log;
- a module's declarations, when the contract is read (`init`, sizes, `rounds`, `bots`, a body).

It holds three promises. **No code of the rules runs**: a value is read by `typeof`,
`Array.isArray` and its own data properties; nothing is converted by calling it, a getter reads as
absent, a setter is never written through, nothing is iterated. **Nothing throws**: what is not a
plain number, text, true, false, list or object of the declared shape becomes the zero of that
shape. **The work is bounded and paid for first**: a list is read to its declared size and no
further, and `est` says in a few steps how much reading a value will take, so the handler is
charged before the reading is done.

What comes out is frozen plain data. Three things follow. A query result, an event and `shared`
outside room scope are the stored values themselves, never copies. A handler that changes a list,
a map or a struct in place is handed a copy of its own when it first reads the field, charged by
what the stored value holds; when the handler ends the copy is held to its declaration and stored,
charged by what it now holds, inside the handler's budget; a copy the handler cannot pay for is
dropped and the field keeps what it held. And a browser's own `move` is handed `motion` the same
way (`rules/view.ts`).

One thing the boundary cannot promise by itself: a `Proxy` would run its traps when it is read.
Rules cannot make one. The build refuses the name, `globalThis`, `Reflect` and every way to a
constructor, and nothing the runtime hands the rules is one.

### 8.3 The tick loop cannot break

One rule holds whenever `rules/host.ts` hands control back to its caller: **a room that is
running has exactly one timer pending, and a room that is paused or ended has none.** Every way in
(`wake`, `frame`, `start`, `resume`, `tickNow`) is wrapped. Whatever is thrown inside, by the core,
by the caller's `send` or `log`, by a callback, by the clock, is caught there, written to the log
as `host-fault` with the game, the build, the tick and the part of the tick (at most one line a
second) and counted; and on the way out `keepTime()` arms the timer, or, when the clock will not
give one, ends the room cleanly (`why: 'clock'`). A tick that faults is a failed tick like one the
budget cut short: every tick failing for two seconds ends the room (`why: 'fault'`), and one fault
alone does not.

The test for it (`test/rules-hostile.test.mjs`, "the tick loop cannot break") runs forty rooms on
seeded dice. In each, the sender, the log, the three callbacks, the clock's `now`, `setTimer` and
`clearTimer` and the core's own `step` throw at random, while joins, leaves, input, garbage frames,
pauses and time arrive in a random order. After every one of 16,000 steps it checks that the room
is running if and only if exactly one timer is pending, that the runtime's own count agrees, that
nothing escaped a timer, and that nothing was thrown to the caller.

### 8.4 Seconds are seconds

| Rule | Was | Is |
|---|---|---|
| The budget tripping on every tick ends the room | After `2 * tickHz` ticks, counted in the core, which has no clock | After 2,000 ms of the clock in which every tick failed (`FAIL_MS`). The core's own count stays beside it; on a room that keeps its beat the two agree |
| Ticks that run slow end the room | After `5 * tickHz` ticks blamed in a row | After 5,000 ms of the clock, from the start of the first tick blamed (`OVERRUN_MS`) |
| A lone slow room | Never ended, on a clock that moves while code runs: after four ticks in one wake the clock slipped, the next tick started on time by the new clock, and the count started again. A room alone with ticks of a second each ran 300 s of the clock and was still going | The tick that ran last before a slip is judged before the slip hides it. The same room ends on its fifth tick |
| A tick a little longer than a period (70 ms at 50) | Blamed only once lateness had piled up past a period, and the count started again at each slip | A run of slow ticks goes on while at least half the ticks in it were blamed, and is dropped as a hitch when fewer were. Such a room ends after five seconds |
| The build's own run | Timed nothing | Three ticks of its sixty over the period, or one over four periods, stop the build with the handler that used the most |

### 8.5 The budget, measured

`test/rules-cost.mjs` plants forty handlers, each burning its share of the tick one way, runs each
through the real build and the real runtime, and prints the time a unit took: the wall time of the
quickest of a dozen ticks, divided by the units that tick used. On the computer this was built on
(an Apple M4, Node 22.22.2), dearest first:

| Planted handler | ns a unit | | Planted handler | ns a unit |
|---|---|---|---|---|
| The keys of an object of 1,000 | 11.6 | | A list of 1,024 read from a field | 7.2 |
| A number written to a field | 11.2 | | `world.random` | 7.0 |
| A `Map`: set and get | 10.3 | | `world.near`: 400 found, each with a list of 1,024 | 5.8 |
| `world.math` | 9.7 | | An object of 20,000 keys written to a map field | 5.7 |
| `world.near`: 2,000 found of 2,000 | 9.6 | | `world.inBox`: 2,000 found | 5.1 |
| A list of 64 vectors written to a field | 9.4 | | A list of 4,096: a sort with no comparison | 3.9 |
| A vector written to `vel` | 8.6 | | A list: push | 3.5 |
| `world.send` with a list of 64 vectors | 8.2 | | `world.sweep`, `world.ray` past 2,000 | 2.8, 2.0 |
| `world.send` | 8.0 | | An empty loop | 1.1 |
| Arithmetic on fields | 7.9 | | Two long texts compared | 1.5 |
| An object read and written by a computed key | 7.9 | | A function of the game's called | 0.8 |
| A list of 1,024 written to a field | 7.3 | | The rest (a spread, `includes`, a text joined) | under 0.5 |

Before the weights were set, the same table had `self.vel = { … }` at 228 ns a unit, a number
written to a field at 48, a `Map`'s set and get at 31, a computed key at 31 and `world.math` at 27.
So the weights of section 10's table are not all the design's any more:

| What runs | Units, and the design's when it differs |
|---|---|
| A loop turn. A call of a function in rules | 1 |
| A guarded method call, before what the method itself costs (`CALL`) | 3 (the design: 0) |
| A computed read or write | 1 (the design: 0) |
| A `world.math` or `ctx.math` call | 4 (the design: 2) |
| `world.send`, `sendRoom`, `announce`, `after` (`SEND`) | 16, and what holding the data to its shape costs (the design: 10) |
| `world.emit`, `spawn` | 10, and the data the same way |
| `world.place` | 82 |
| `world.near`, `world.inBox` | 20, 2 for each entity scanned, and for each one found 16 and 1 for each field its kind declares (`VIEW`) |
| `world.sendArea` | 20, and 2 for each entity in the room and each one spawned and not yet in |
| `world.ray`, `world.sweep` | 20, and 4 for each shape of the map and each entity in the room, charged before the cast |
| `ctx.map.sweep` | 20, and 4 for each shape of the map |
| A value read while a value is held to its declared shape, or copied for a handler to change in place (`COPY`) | 6 |
| A number, bit, ref or text written to a field (`SET`); a vector written (a field, `vel`, `heading`) | 3; 24 |
| A key of an object handed to a map field, or of a module's constant gone through | 16 |
| A long text compared, searched for or turned into a number | 1 for every 64 characters; a search for one text in another, a sixteenth of the two lengths multiplied |
| An allowed method call, a spread, `Object.keys`, `values` or `entries` | 1 for each element or character read or made, as the design has it; `sort` 16 times that. Charged before the call runs |
| A value in the tick's snapshot (`SNAP`) | 4, taken from the tick before any handler runs |
| An announcement delivered | 1 for each entity in the room, taken from the tick |

**The default budget.** The dearest unit costs about 12 ns here. The default `budget.tick` is now
1,000,000 units at 20 ticks a second or fewer (it was 2,000,000 at any rate), and 20,000,000
divided by the tick rate above that. A tick that uses all of it on the dearest work takes about
12 ms on this computer; at the very worst, its last handler a quarter over and a full room's
`move` and `think` each taking its small share, about 20 ms. That is under half a 50 ms period,
with as much again to spare for a server half as fast. This is open point 1 of section 16,
answered on one computer under Node: Cloudflare's own answer is still T1's to give, and the tool
is what T1 should plant.

**`coin-dash` inside it.** The example's busiest tick, in two and a half minutes of play:

```
coin-dash, 1 of 8 seats taken (4 bodies): its busiest tick used 1421 of 1000000 units (0.14%), its busiest handler 166 (runner.think); a tick took 0.016 ms on average
coin-dash, 8 of 8 seats taken (8 bodies): its busiest tick used 1568 of 1000000 units (0.16%), its busiest handler 96 (runner.onRoom.roundStart)
coin-dash, 32 of 32 seats taken (32 bodies): its busiest tick used 7544 of 1000000 units (0.75%), its busiest handler 100 (runner.tick)
```

A full room of 32 uses less than a hundredth of the budget. (The build's own three-second run,
on the starter's own map, prints 2,573 units for its busiest tick.)

### 8.6 What was gone through, and what it found

Every place the runtime touches a value from the rules or calls back into them, and what every
call a module can make costs. "Found" is a fault of the same kind as the review's three; each has
a planted case in `test/rules-hostile.test.mjs` unless the row says otherwise.

**Where the runtime reads a value from the rules.**

| Place | Found | Changed |
|---|---|---|
| A field written whole (`self.n = v`, `self.bag = v`), `vel`, `heading`, `shared` | `Number(v)` and `String(v)` on whatever was written | Read through the boundary. A write is charged: 3 for a number or a text, 24 for a vector, by its size for a list |
| A list, map or struct changed in place | Held to its shape after the try and after the budget, for every such field of the entity, after every handler, whether or not the handler touched it: uncharged work in proportion to the declared sizes | A copy when the field is first read, charged; held to its shape before the budget closes, charged; nothing done for a field the handler never read |
| What `think` returns | M1 and M2 | Read inside the handler's try and budget |
| What `room.join` returns (`kind`, `at`, `fields`, `motion`, `heading`) | Property reads on the returned value | Own data properties only; its fields charged before they are held to their shapes |
| What `move` leaves in the body | Read after the try; `Number()` inside `ctx.map.sweep` | Read by own data properties; the sweep reads plain numbers and writes back only to a plain property |
| What a handler throws | **A second way to freeze a room**: `String(error.message)` in the catch block itself threw for a thrown map field (an object with no prototype) or an object whose `message` is one, out of `run()` and out of the tick | `errorText`: a text is itself, an `Error`'s own message is its message, anything else is "a value that is not an Error" |
| The arguments of `world.send`, `sendRoom`, `announce`, `after`, `sendArea`, `emit`, `spawn`, `place`, `near`, `inBox`, `ray`, `sweep`, `ask`, `ticks`, `map.spot`, `map.spots` | `Number()`, `String()` and plain property reads on every one. All inside the handler, so none could freeze a room, but each ran code of the rules from inside the runtime | Each read through the boundary; a name that is not a text is no name |
| `world.sweep`'s `ignore` | The list handed in was searched once for every entity in the room, uncharged: 60,000 ids and 1,500 entities made a tick of 2.8 s | The first 16 ids, read once into a set |
| A game's own answer to `world.ask` | `JSON.parse(JSON.stringify(answer))`: `toJSON` and getters run, and a size nobody bounded | Copied as plain data, 256 values and four levels at most, charged before it is read |
| `world.math` | Arithmetic on whatever it was handed: a text made the vector's parts texts, which doubled on every call; a list was turned into a text | Numbers and vectors of numbers only; each part of a vector read once |
| A module's declarations (`init`, sizes, `rounds`, `bots`, a body's `radius`) | Read with no handler running and so no budget: `Number()` on what was declared, `init` kept as handed over and passed on to the view as JSON, and a declaration that holds another twice, forty levels deep, walked to the end | A declared field is made again as the runtime's own record, its `init` copied as plain data of a bounded size; a field's size is counted once however often it is used inside itself, and one too large is refused first; a number in a declaration is a number or the declaration is refused |
| What a player sends (`in`, `ev`, `join`) | `String()` on a kind, a command's name and a name | A text, or nothing. A frame that throws is dropped and counted (8.3) |

**What a call costs.**

| Call | Found | Changed |
|---|---|---|
| `world.near`, `world.inBox` | M3 | 8.5 |
| `move`, `think`, `room.join`, `room.start` | **Each was given a quarter of the budget whatever was left**: 2,000 bodies whose `move` burns its share could take 500 budgets in a tick | A quarter while the tick has budget, a small share once it is gone: the worst tick is a budget and three quarters |
| Any handler | Given "what is left of the tick" when that was less than a quarter, and abandoned when it ran out: the last handler of a busy tick lost its work, and an event it was delivering was lost with it | A whole quarter, as the design says |
| An entity's `arrive`, a command | Marked done before it ran, so one skipped for want of budget never ran | It waits; an entity that has not arrived does nothing else until it has |
| `world.after`, `world.send` | **State that was not declared**: timers set far off stayed in the queue for ever, at 10 units each, and every tick sorted through all of them | 16,384 events and timers waiting, at most; a send past it throws in the handler |
| `world.sendArea` | Charged by the entities in the room when it was sent, settled against those there at the end of the tick | 64 a tick; charged for those spawned and not yet in as well |
| `world.announce` | Went round every entity for each announcement, heard or not, uncharged | A unit an entity from the tick; one that no kind hears goes round nobody |
| The snapshot | The whole state packed and sent every tick, charged to nobody | 4 units a value from the tick, before any handler; a room that holds more than a tick's whole budget can send ends at once |
| `world.ray`, `world.sweep`, `ctx.map.sweep`, the list methods, `flat`, `new Map(list)` | Charged after the work, so a handler on its last unit did the work once for nothing, and every body's `move` could, once the budget was gone | Every call charges first |
| `Object.keys`, `values`, `entries`, a spread, `for…in`, a map field written whole | The same, and an object's key count is not known without counting | Charged first when the count is known: a list, a text, and a module's constant, counted when it is frozen at load. A value whose count is not known was made by the running handler, which paid a unit and more for every key |
| A `Map`'s `keys`, `values`, `entries` | Handed back an iterator, which a spread then read out for one unit | Handed back as a list, charged by its length. No iterator reaches rules |
| `join`, a `sort` with no comparison, a comparison that returns a list | Turned every entry into a text, to any depth | Texts and numbers only; the comparison returns a number |
| `flat`, `flatMap` | Made the list, then counted it: 400 lists of 60,000 was 24 million entries before the size cap looked | Counted and capped before anything is made |
| `x.s += text` through a computed step (`o[0].s += o[0].s`) | Left as written, so the text doubled uncharged and uncapped | Refused with its line: take the object into a const first |
| `unshift` | Charged for what it added, not for what it moved | Charged for the whole list |

**What the language does by itself.** This is not the runtime touching a value, but it is the same
fault, and it was found by planting lists where numbers belong.

| | Found | Changed |
|---|---|---|
| An operator on a list | JavaScript turns a list into a text whenever an operator wants a number or a text (`list - 1`, `list < 1`, `list == 1`, a template, `String(list)`, `Math.max(list)`, `key in`), walking every entry of it and of every list inside it. No counter sees that walk: 300 comparisons of a list of 60,000 made a tick of 1.5 s, and a list that holds another twice, 24 levels deep, one of 6 s from 25 units | The operand of every such operator, unless the pass can see it is always a number, goes through the guard's `p`, which refuses a list, an object or a function. `==` and `!=` are refused except against `null`. The linked module is refused when it holds such an operator unchecked |
| A whole number of any size | `10n` is a literal, not a global, so it was not refused; squared in a loop it has no limit | Refused with its line |
| Two long texts | Compared character by character by `===`, `<`, a `switch`, a list's `includes`, a `Map`'s key and a search: two texts of 32,768 characters compared in a loop made a tick of 190 ms inside its budget | A unit for every 64 characters |
| A function held as a value | **State outside any field, and a way out of the room**: `const h = self.hasOwnProperty; h.count = 1` kept a count on a built-in function, shared by every room in the isolate and by the studio's own Worker; `h.call = …` would have changed what the Worker's own code calls | A write to a property is checked not to land on a function (`w`). A host method is read as a value no more than a list's is, and the host's functions cannot be taken out with `Object.values` or a spread |
| A list, an object or a text written out past the size cap | A constant is free to make | Refused by the build |

### 8.7 Where the design and the code now differ

Section 2's table goes on here. Each is a decision the review's follow-up made.

| | The design said | The code required | Chosen, and why |
|---|---|---|---|
| 46 | "Rules cannot outrun the budget" | The runtime read the rules' values after the budget | One boundary, with nothing of the rules' touched outside `run()` (8.2) |
| 47 | Query results and event data are "frozen objects"; in production "read-only views" | A frozen copy of every field for every result is the cost M3 found | Stored state is frozen itself, so the stored value is the view. A handler is handed a copy of a list only when it reads the field to change it |
| 48 | The refused names are `constructor`, `prototype`, `__proto__`, `stack`, `localeCompare` | The review asked for `valueOf`, `toString` and `toJSON` too; its own first case builds `{ toString: 1 }` | A function may not sit under those three names; a plain value may. A plain value there is harmless, because nothing calls it, and an AI may well name a field `toString` by mistake and be told nothing useful by a refusal |
| 49 | "A method may be called, never read as a value. So no built-in function object reaches rules" | A built-in method that is on no list (`hasOwnProperty`) can still be read; only calling it is refused | A write never lands on a function, so nothing can be hung on one or changed on one. Reading one is left: it can be called only with no `this`, which every one of them refuses |
| 50 | The budget table of section 10 | Measured, several entries cost ten to two hundred times an empty loop turn for the same unit | The weights of 8.5 |
| 51 | `budget.tick` is 2,000,000 | Measured, that is 23 ms of the dearest work on a fast computer, and 40 at the worst | 1,000,000 at 20 ticks a second or fewer, less above (8.5) |
| 52 | `move` "has run for every body, because it runs first" | It was given a quarter whatever was left | It always runs, with a small share once the budget is gone |
| 53 | "A room blamed on every tick for 5 s ends" | A tick a little over the period is not blamed every time, and a lone room's slips hid its last tick | 8.4: on at least half its ticks, for five seconds of the clock |
| 54 | Nothing about a fault in the runtime itself | M1 was one | It is a failed tick; two seconds of them end the room (8.3) |
| 55 | "All state is declared with sizes" | The queue of timers was not, and a declared size had no ceiling | 16,384 events and timers waiting; a field holds 16,384 values when it is full and a kind's fields 65,536 together; the tick pays for the state it sends, and a room that holds more than a tick's budget can send ends |
| 56 | A `Map`'s `keys`, `values` and `entries` are allowed methods | They hand back iterators | They hand back lists |
| 57 | `==` is not on the refused list | It is the one comparison that turns a list into a text | Refused, except against `null` and `undefined` |

### 8.8 What is not closed

- **A `Proxy`.** The boundary reads by descriptor, and a `Proxy` would run its traps there. Rules
  cannot make one (8.2). If a later release hands rules an object that is one, the boundary must
  be told.
- **Cloudflare's own clock and speed.** Every figure in 8.5 is one computer under Node. Whether
  1,000,000 units fit half a period on Cloudflare (open point 1), and whether a timer's clock
  there includes the time the tick before it took (open point 2, which both wall-time rules lean
  on), are still T1's to measure. If open point 2 fails, the overrun check sees nothing and the
  weighted budget is all that bounds a tick: that is why the weights were measured.
- **Work a tick does that no handler pays for.** It is bounded by the caps, not charged: going
  through every entity three times a tick, reading what each `move` left (about 0.3 microseconds
  a body), sorting the events that are due (16,384 at the very most, about 2 ms), settling 64
  areas against 2,048 entities. In a room at every cap at once that is a few milliseconds.
- **An announcement, a seat event and `on.leave` under a spent budget.** An announcement that the
  budget cuts short has reached the entities it reached and not the rest. `seatJoined`, `seatAway`,
  `seatLeft`, `on.leave` and `on.takeover` are skipped when the tick's budget is already gone, as
  the design's "handlers not yet run are skipped" has it. They run first in a tick, so this takes
  a room whose state alone has used the budget, which ends at once now.
- **A built-in method that is on no list can be read as a value** (row 49). Nothing can be done
  with it that was found, and nothing proves nothing can.
- **The wall is still a wall.** Section 10 of the design says what it is: language restrictions
  and a counted budget in the studio's own isolate, against a careless module written by the
  studio's own AI. This round made it hold against every hostile case that was thought of, about
  seventy planted lines and forty seeded rooms. It is not an isolation boundary, and milestone 3's
  is still the one that is.

### 8.9 Evidence

Run on 2026-10-07 on the same computer, after the last change. `npm ci` was not run again: the
installed packages were the lockfile's.

```
$ npm run build
> tsc --build

$ npm test
# tests 743
# pass 741
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

The seventeen new tests are `test/rules-hostile.test.mjs`. The skipped ones were skipped before.
The leak audit ran without the maintainers' private terms, as in section 3.7.

A fresh scratch studio, linked to this checkout, with `coin-dash` and `gem-rush` copied in:

```
$ homie-studio build
built coin-dash (bundle, 77 KB)
  coin-dash: its rules run on the server (checked and guarded, 5 KB, build 2a1bfd81420e6bd6; three seconds with bots: the busiest tick used 2573 of 1000000 budget units, 346 of them in one handler)
built gems (bundle, 89 KB)
hosted by a player's browser, as before (no src/rules.ts; nothing to do): gems

$ homie-studio dev --port 18791
[wrangler:info] Ready on http://127.0.0.1:18791

$ node packages/studio/test/rules-exit.mjs --url http://127.0.0.1:18791 --game coin-dash --bots 0
PASS two-browsers-one-room: seats 0 and 1 in room exit-muyx3tc1
PASS no-browser-hosts: roles replica, replica; host {"id":"server","seat":null}
PASS own-body-answers-input: holding right for 1 s moved the computer's body 6.20 m (the runner's speed is 6 m/s) while the room went from tick 15 to 35
PASS forged-frames-change-nothing: 160 forged frames; the forger's score stayed 3, its body moved 9.87 m (held to 6 m/s), the browsers' round is still live with no forged score, name or result
PASS closing-a-tab-interrupts-nobody: after the phone's tab closed the computer saw 81 ticks in 4 s and is playing
PASS round-finished-with-the-servers-results: round 1: Dash 9 (bot), Turbo Mantis 3, Mallory 3, Bold Rocket 1; the same list reached the browser and the socket

$ node packages/studio/test/rules-exit.mjs --url http://127.0.0.1:18791 --game coin-dash --minutes 2 --bots 8
PASS the-room-keeps-its-beat: 8 players for 2 min: each received at least 100.00% of the ticks due (the line is 99.5%), and at least 100.00% of snapshot gaps were under 75 ms (the line is 99%); the worst 99th percentile gap was 54 ms

$ homie-studio check coin-dash --url http://127.0.0.1:18791
PASS: two fresh browsers in room pub-1 finished round 1 (2 humans, 2 bots) in 62 s.
```

The room's own log for those runs, with the two figures the log line gained (`maxTickUnits`, and
`faults` when there are any, which there were not):

```
{"ev":"ticks","game":"coin-dash","build":"2a1bfd81420e6bd6","tick":1004,"ticks":200,"late":0,"slips":0,"ins":224,"lateEntries":0,"dropped":0,"errors":0,"budgetStops":0,"cut":0,"maxUnits":346,"worst":"runner.think","maxTickUnits":2573,"room":"pub-1"}
```

Nothing was deployed and no credentials were used. This is still a local runtime on one quiet
computer, and section 4 still says what that does not prove.
