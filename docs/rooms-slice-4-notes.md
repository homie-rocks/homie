# Rooms slice 4: the build check

Slice 4 of milestone 1 (`rooms-milestone-1-design.md`, sections 8 and 10): every build of a rules
game checks its types against its own declarations, then plays its rules with generated players
before anything is written. This file says what is built and why. It describes the tree as it is;
nothing here is a record of an earlier round.

## What is built

- **Types, always.** `lib/typecheck.mjs` `typecheckRules` runs the toolkit's pinned compiler over
  `rules.ts`, `move.ts` and `view.ts` against declaration files generated from the game
  (`lib/rules-types.mjs`, `rules/types.ts`). Fields, events, commands, effects, asks and answers,
  companion goals, the view's `room.ask` and what a guide's `floor` returns are all read against the
  game's own declarations and its `agents.json`.
- **The generated play.** `lib/rules-check.mjs` starts a worker thread (`lib/rules-check-worker.mjs`)
  that links the guarded module with the real runtime (`rules/host.ts` and what it imports) and plays
  a room: people join, steer at random, hold every control at one end and then the other, send every
  declared command with values its shape allows, and send nothing at all (seat 1 never presses
  anything). People go away and return, give up seats and take them again, bots are switched off and
  on, the room is full for one round and small for the next, and every 40 seconds the room restarts
  as a deploy restarts it (a new epoch, everybody away until they are back). A game with guides or a
  vocabulary is then played a second, short time with AI companions seated and people asking them
  for what the vocabulary offers.
- **The reference.** `plugins/homie/skills/game/RULES.md`, which the `game` skill reads before it
  changes a rules game.

## The rule the check follows

1. **A correct game is never refused.**
2. **Only a proven fault fails a build**, and each is proven by the runtime, not by the check:

   | Proven | How the runtime says it |
   |---|---|
   | A handler threw | `core.ts` `observe`, told of every handler as it ends. The line is the guard's own (`G.file`, `G.line`) |
   | A tick ran out of budget | `stats.ticksCut` |
   | The server held a body back | `stats.held`: an owner-moved body's claim, made by the game's own `move`, came further than the server lets it go |
   | A save does not hold | The room is rebuilt from `host.save()` by `createHost({ restore })`, saved again, and played one tick beside the room that kept running. The three saves must be the same bytes |
   | A handler wrote a value the room had to change and lose | `core.ts` `noted`: at the one place the runtime holds a written value to its type (`pack.ts` `coerce`), it tells a listener what it did, with the field's name. Only the check passes a listener. The line is the guard's, at the write |

   Everything else is an `info:` line. There are three kinds: one line that says how much was
   played, one line for each declared handler that never ran, and one line for each field that had
   a whole number held to its range, with the runtime's own count.
3. **The verdict and every printed line are a function of the source alone.** The play is bounded
   by its allowance (below) in ticks, budget units and bytes of save. No clock is read anywhere in
   the worker, `core.ts`, `host.ts` or `pack.ts` under the check (the host's clock is the check's
   own tick counter).
4. **The check has no model of the game of its own.** It has no table of legal values, no walk of a
   game's state, no copy of a value and no restore of its own. It plays the relay's part and the
   browsers' part with frames, and listens.

## The allowance

`lib/rules-check.mjs` `ALLOWANCE`:

| | Default | `--long-check` |
|---|---|---|
| Ticks of the first room | 18,000 (to the end of one round if a round is longer, up to 36,000) | 144,000 |
| Budget units of the first room | 280,000,000 | 2,240,000,000 |
| Rebuilt from its save before every tick for the first | 200 ticks | 200 ticks |
| and then before every | 29th tick | 29th tick |
| Bytes of save rebuilt | 8,000,000 | 64,000,000 |
| Ticks of the second room, with companions | 2,400 | 19,200 |
| Its units and bytes | an eighth of the first room's | an eighth |

- A light game ends on its ticks: fifteen minutes of a 20 Hz room. A heavy game ends on its units,
  after fewer seconds of play, and the information line says how many.
- **The first room has the whole allowance.** A fault that every match reaches in its first minutes
  is found there, and a second room that played the same match again found nothing the first had
  not. The second room is short: long enough for every request the vocabulary offers to be asked
  several times.
- **Units count everything the play runs of the game's**: every handler of both rooms, and the
  game's `move` as each person's browser runs it for its own body. So the units bound what a check
  costs, whatever the game puts in `move` and however many seats it has.
- `homie-studio build <id> --long-check` multiplies ticks, units and bytes by eight. It is the same
  play, further.
- The worker has a memory limit (512 MB) and a supervisor that ends it after 3,600 counted beats.
  The type compiler's thread has the same supervisor (`lib/rules-compiler.mjs`). Both say that the
  check itself stopped and that the game is not at fault; neither reads a clock.

## What it costs

Processor seconds for the generated play alone, every thread counted, on an Apple M4 that was
running other work at the time (`node packages/studio/test/rules-check-cost.mjs`; a quiet computer
is faster, and efficiency cores take about twice as long). The type check before the play takes
1.1 to 1.3 s for any of these games.

| Game | Play | What it covered |
|---|---|---|
| `coin-dash`, the stock example | 1.4 s | 18,000 ticks, 13 rounds, 813 rebuilds |
| A companion game (`o5-council`: four asks, four goals) | 1.7 s | 18,000 ticks, and 2,400 with companions |
| 700 entities made and removed every tick (`o3-swarm`) | 2.5 s | 18,000 ticks, 20 rounds |
| A costly `move`, 8 seats (`p3-heavy-move`, `p4-heavier-move`: 5% and 50% of a handler's budget) | 3.0 s, 3.7 s | 14,994 and 1,209 ticks; stopped by units |
| A 1,000-cell map read by every player (`m1-big-map`) | 3.6 s | 3,721 ticks; stopped by units |
| A map of up to 600 structs, churned (`o1-map-churn`) | 3.8 s | 859 ticks; stopped by units |
| 2,000 pellets (`g9`) | 4.5 s | 9,752 ticks; stopped by units |
| A 1,000-cell board read whole by 26 or 40 sentries each tick (`m4`, `m5`) | 5.2 s, 5.3 s | 1,270 and 811 ticks; stopped by units |
| 900 entities, each with a tick handler (`l2-swarm-900`) | 6.4 s | 5,607 ticks; stopped by units |

A game that ends on its units costs what 280,000,000 units cost: three to six and a half seconds
here, by how much of the runtime's own work each unit carries (an entity that is packed and sent
every tick costs more than the units its handler is charged). That is about twice the earlier
default, and it is what finding a fault nine minutes into a heavy match costs: `t8-heavy-540s-fault`
needs 269,000,000 units in one room.

Ten whole builds of each of six games (three quiet, four beside fourteen busy threads, one on
efficiency cores, two with a clock that jumps by days) were byte-identical within each game.

## What the runtime changed

A live room behaves as it did before this slice for every value a handler writes: nothing throws
that did not throw, and a handler costs the same units. What changed:

| | Before | Now |
|---|---|---|
| `-0`, written or received | Stored, and lost in the save | Stored as `0` |
| The keys of a map | Sorted in the save and on the wire | In the order they were added (JavaScript's own) |
| A round or a match asked to end on the tick of a save | Lost by the save | Carried (`intent`) |
| The saved revision | 1 | 2 (`rules/rules.ts` `SAVE_REVISION`), part of the state hash: a room saved by revision 1 starts a fresh match, by the path a changed shape already takes |
| A restored answer whose picks do not fit its questions | Accepted | The save is refused (`validateSave`) |
| A companion's goal in a snapshot | `goal`, `args`, `from`, `at`, `asked` | The same and `state` (`"active"`), 17 bytes a companion a snapshot, so the view reads one shape for a goal |
| A person's request to a companion | Checked against the view the companion last sent | Checked against the current view and the people present (`agents/agents.ts` `request`): a request naming somebody who has left is dropped |
| An ask's `floor` whose answer does not fit its questions | Throws, with a short message | Throws, and the message says what each question received and allows |
| The payload of an event, an area or a queued command in a restored save | Taken as saved | Held to its declared shape again, so a restored one is the frozen value a live one is |
| The core's policy | Keys in the order they arrived | Keys in one order, so a rebuilt room saves the same bytes |

What a live room still does with a value that does not fit, as before, and what the build now does
about it:

| A handler writes | A live room | The build |
|---|---|---|
| `NaN` in a number or a vector; an infinite number in a `fix` or a vector | Stores 0 | Refused at the write |
| An infinite number in a whole-number field; a whole number out of range | Holds it to the end of the range | One information line a field, with the count |
| A list, a map or a text longer than declared | Cuts it | Refused at the write |
| The same, changed in place (`list.push`, `map[key] =`) | Cuts it when the handler ends; everything else the handler changed is stored | Refused, naming the handler and saying the field was changed in place |
| A map key over 32 characters, or a name every object has | Drops the entry | Refused |
| A `Map`, a `Set`, a text or a number where a list, a map or a struct belongs | Stores it empty | Refused |
| The 257th effect of a tick | Drops it | Refused |
| A `think` that returns a key that is not its input; a guide `floor` outside the vocabulary | Ignores the key; discards the decision | Refused |
| `undefined`, an undeclared struct property, a fraction in a whole number | Zero of the type, dropped, rounded | Builds, in silence |

- **How the build sees a write without a validator of its own.** `rules/guard.ts` `G.note` is null
  in a room. `core.ts` `run` sets it for the length of a handler when the room was made with
  `noted`, and `pack.ts` `coerce` calls it at each place it already changes a value, with the path
  of the field (`trail`, built only while there is a listener). With no listener every such place
  is one test of `G.note` and the old code: `test/rules-save.test.mjs` holds a watched room and an
  unwatched one to the same bytes and the same units.
- **A browser** runs `move` for its own body and holds what it leaves by the same `coerce`, in
  silence. The check plays that step with the same function (`pack.ts` `stepMove`, used by
  `rules/view.ts`) and the same context (`math.ts` `moveContext`), and listens.
- **One zero.** The save and every frame are JSON, which writes `-0` as `0`. A room that kept `-0`
  divided one way before a restart and the other way after; a browser never saw it at all. Encoding
  `-0` in the save would have fixed the restart and left the browser's prediction on a different
  number, so the runtime holds one zero instead.

## Decisions

1. **The checked file is the deployed file.** The guarded module carries its source lines
   (`t(file, line)`, `l(file, line)`), and that module is both played and written. There is no
   second, untraced build.
2. **One rebuilt room, not four runs.** A room rebuilt from the running room's save before a tick
   and played one tick beside it proves both that two rooms given the same input agree and that a
   save loses nothing. Both rooms share one loaded module, as two rooms in one isolate do, so state
   kept outside the declared fields shows on the first tick that uses it.
3. **A rebuilt room has nobody connected.** The save does not hold connections. So before the
   compared tick everybody who is present reconnects, to both rooms: an ordinary thing for a room
   to be sent, after which both hold the same connections.
4. **The first difference is for the message only.** The verdict is the bytes. The message names
   the first field that differs, using the runtime's own `unpackFields` for the names.
5. **Speed is what the server enforces.** The check plays each owner-moved body's browser for one
   tick at a time: the game's `move` from where the last snapshot has the body, and the claim of
   where that leaves it. If the server cuts that claim short, a step of the move is longer than
   `body.maxSpeed` allows (the server gives 2% of slack), and a player would be pulled back. A body
   the server moves itself has no such check, because nothing holds it. Nor has a speed that would
   only build up in `motion`: a browser's `motion` is the server's, from every snapshot, so that
   never happens in a room (`f14-speed-ramp` among the review games, which now builds).
6. **Main's `smokeRun` is kept, with its test, and the build does not call it.** It times ticks on
   the computer's clock, and a build's verdict may not depend on that. It stays because main's
   hostile test, which this slice leaves as main has it, exercises it.
7. **What fails and what is only said.** A write fails the build when the room had to drop or
   replace what the handler wrote: `NaN`, an infinite fraction, entries past a size, a key that
   cannot be one. A whole number held to its range does not, because a game may mean it
   (`Infinity` for "never", a score that stops at its top); the runtime counts those by field and
   the build prints the count. Among the review games that is `e9-infinity`, `f05-score-nan`
   (which writes `Infinity`, not `NaN`) and `x2-max-of-empty`: they build, with that line.
8. **Changed in place is named by its handler.** A list or a map changed in place is held to its
   type when its handler ends, so there is no write to name. The message names the handler's first
   line and says the field was changed in place and what it held at the end.
9. **Lines that were removed.** Growth rates by kind, "nobody moved" and bot input ranges each
   needed the check to walk or judge a game's state. The one play line gives the entity and
   waiting-event counts and the save's size at the end, which is where a leak shows.
10. **What the default play does not reach is not refused.** A fault an hour into a match builds by
    default and is refused by `--long-check`. The faults the earlier default missed inside the
    first quarter of an hour (`l3-heavy-map-of-13`, `t8-heavy-540s-fault`, `x7-minute-thirteen`)
    are refused by default now, and the tests hold them there.
11. **A type gap that stays.** `think` returning a key its kind does not declare compiles when the
    object is not a fresh literal checked against an annotated type: a structural type cannot
    forbid extra properties without also refusing a correct program that returns part of its
    input from a variable. The play refuses it on the first tick a bot thinks.

## Tests

| File | What it holds |
|---|---|
| `test/rules-check.test.mjs` | The fifteen planted faults, each at its own line; each proven fault and its message, a changed value at the line of its write and a change in place by its handler; the range line; the play line; bounds and repeatability in units, the browser's `move` counted; the long check; the supervisor |
| `test/rules-save.test.mjs` | The save by property: random values of every declared type pack and unpack to themselves; a room handed anything rebuilds to the same bytes and plays the next 200 ticks the same; what does not fit is stored as before, with no error, and told by name to a listener, for the same bytes and units; one zero; the revision |
| `test/rules-repeatability.test.mjs` | A whole build's output, quiet against loaded with a clock that jumps by days, byte for byte |
| `test/rules-corpus.test.mjs` and its fixtures | 74 faulty games and 15 correct ones from the reviews, each with where it must be stopped or what must be said of it |
| `test/rules-boundaries.test.mjs`, `test/rules-protocol-corpus.test.mjs` | Whole builds of the heavy games and the companion games, among them the three faults a match reaches in its first quarter of an hour |
| `test/rules-hostile.test.mjs` | Main's hostile cases as main has them, but for the order of a map's keys |
| `npm run test:rules:extended` | The whole corpus and the heavy games |
| `test/rules-check-cost.mjs` | Not a test: the processor seconds of each part of a build, to read on a quiet computer |

## Limits

- The generated play is finite testing. It proves a fault it reaches and says nothing about play it
  does not reach; the play line says how far it went.
- A site Worker deployed with this runtime and a rules table written by an older build would start
  a fresh match without telling the returning player why. `homie-studio deploy` builds everything
  first, so no supported path makes one.
- People are played by three simple ways of pressing. A handler only a skilful player reaches is
  likely to be reported as never run.
- Browser-hosted rules are still refused at build (a later slice).
