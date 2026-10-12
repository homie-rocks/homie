# What one room carries, and the ways past it

Input to the design of the next rooms milestone. It states what was measured in six trials on
Cloudflare on 10 and 11 October 2026 and on one computer, what was not, and what each way
past one room object would buy. The trials themselves are in `crowd-transport-0462.md`.

The game in every measurement is the crowd-circuit fixture: every player in one dense arena,
each seeing about 180 others, a light move handler and no player-to-player collision, 20
ticks a second, ten inputs a second a player. A game with heavier rules carries fewer; one
whose players see fewer of each other costs its Gates less and its room the same.

## The answer

- **One room object carries 300 players of this game with margin.** All seven runs at 300
  or under in the last three trials, at any hour, from home and from inside Cloudflare,
  held 20 frames a second with about one input in a hundred late.
- **600 is the edge.** Four runs of six were clean: all three from inside Cloudflare (every
  one of them before 06:00 Pacific) and one of three from home, where players send a fifth
  more input. The afternoon run from home delivered 20 frames a second with one input in
  five late and a fifth of all worlds over 200 ms old.
- **800 to 1,000 is luck.** Of 25 runs from inside Cloudflare at 800, 900 and 1,000, five
  were clean. The same step, minutes apart, gave 10 frames a second or 20.
- **1,000 players in one object is not something this release, or tuning of its shape,
  delivers.** Past the edge a world has to be more than one rules object.

## The capacity curve

Every run of the last three trials (0.46.2 and the two builds of this release, numbered 0.46.4 when they ran and released as 0.46.6; the fourth, fifth and
sixth trials), each 150 seconds of steady play. "Clean" is everybody seated, 19 or more
frames a second written by the median Gate, a Gate's round trip to the room under 250 ms at
the 95th percentile, and under one input in ten late.

| Players | From | Runs | Clean | Frames a second a Gate wrote, lowest to highest | Gate round trip p95 ms, lowest to highest |
| --- | --- | --- | --- | --- | --- |
| 50 to 300 | inside Cloudflare | 3 | 3 | 20.0 | 53 to 89 |
| 50 to 300 | home | 4 | 4 | 20.0 to 20.1 | 43 to 83 |
| 600 | inside Cloudflare | 3 | 3 | 20.0 to 20.1 | 121 to 186 |
| 600 | home | 3 | 1 | 18.9 to 20.0 | 105 to 311 |
| 800 | inside Cloudflare | 8 | 3 | 10.5 to 20.0 | 137 to 1,096 |
| 900 | inside Cloudflare | 8 | 1 | 9.6 to 19.7 (one run has no figures from the room) | 168 to 1,200 |
| 1,000 | inside Cloudflare | 9 | 1 | 5.9 to 19.9 | 173 to 2,372 |
| 800 to 1,000 | home | 4 | 0 | 9.6 to 17.1 | 531 to 1,074 |

Home is one home connection with compression, as a browser has. Home players in these
trials send 10.5 inputs a second each where the probe's send 8 to 9, so 600 from home is the
room's load at about 750 from the probe. Without compression the same connection is full
from 600 up and those runs measure the connection; they are not in the table.

The frames are the Gates' own count of what they wrote, not the players' report: a probe
that runs late reports rates that read high (see "What cannot be measured from inside").

**The fifth trial against the sixth.** The fifth (05:00 Pacific) had 800 clean in two runs of
two; the sixth (14:00 Pacific, the build after it) had it clean in one of six. On one
computer, back to back, the sixth trial's room costs slightly less a tick than the fifth's
(next section), and the one change that could act between them, the unconfirmed checkpoint,
measurably helps wherever the room is not out of time (below). So the difference is not
attributed to the code. It is the hour, or it is the same variance sampled three times: a
room at its edge is clean or not by what else its machine is doing. This document cannot
say which, and the conclusion does not depend on it.

## What a tick costs

`packages/studio/test/crowd-room-cost.mjs` runs the room's own objects (the rules host, the
relay, one channel a Gate) in Node, where a clock moves, with seeded players sending what the
probe sends. On the laptop this was written on, milliseconds a tick:

| Players | Rules | Players' messages read | Worlds built and written | Snapshot, control rows, rest | A tick | A second of the room | Megabytes a second to Gates |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0.24 | 0.12 | 0.03 | 0.14 | 0.53 | 11 ms | 0.2 |
| 300 | 0.78 | 0.31 | 0.09 | 0.38 | 1.56 | 31 ms | 1.3 |
| 600 | 1.76 | 0.66 | 0.21 | 0.45 | 3.08 | 62 ms | 4.9 |
| 800 | 2.55 | 0.94 | 0.34 | 0.74 | 4.57 | 91 ms | 8.6 |
| 1,000 | 3.23 | 1.19 | 0.43 | 0.86 | 5.71 | 114 ms | 13.3 |

- It is a straight line in players: 0.114 ms of a laptop core a second for each player,
  of which the rules are 57%, reading input 21%, worlds out 8%.
- The bytes the room sends are not a straight line. Every Gate is sent the whole world,
  and Gates grow with players: 13.3 MB a second at 1,000, ten times what 300 costs.
- The checkpoint is 1.5 ms once a second at 1,000 (676 KB), 0.2 ms at 100.

Three builds on that computer, 1,000 players, a second of the room:

| Build | Inputs on time | Every input late and the clock moving between frames |
| --- | --- | --- |
| The fifth trial's (0.46.2 with this release's first changes) | 121 ms | 123 ms |
| 0.46.3 as released | 142 ms | 160 to 166 ms |
| This release | 113 to 116 ms | 119 ms |

0.46.3 made a big room a sixth to a third dearer (a round-trip window sorted on every
input). This release takes that back and removes the whole snapshot as text that a room
behind Gates built for nobody (0.7 ms a tick).

## Cloudflare against the laptop

The probe ran one fixed piece of work (`lib/crowd-probe/reference-work.mjs`) ten times in a
request, timed by a stopwatch outside Cloudflare, twelve times over the sixth trial. A round
took 52 ms on the laptop and 136 to 214 ms inside Cloudflare: **2.6 to 4.1 times slower,
median about 3**, varying by half again from one request to the next.

By that factor a 1,000-player room spends 0.30 to 0.47 of each second of its one thread on
the work the bench sees, 0.16 to 0.25 at 600 and 0.08 to 0.13 at 300.

That is not the whole of the room's second, and the difference matters:

- **The model says a room at 800 has half its thread free, and the trials say it falls
  there five times in eight.** Either the room's real code runs slower against the laptop
  than the reference work does, or about as much again goes on what the bench does not run:
  the runtime writing 9 to 13 MB a second to twenty channels and reading 800 frames a second
  on the same thread, collection of a real heap, and the machine's other tenants.
- Which, is not known. Cloudflare's own count of the room's processor time could not be
  read (below).
- So the capacity figures above are what was observed, and the cost model is for comparing
  options and games with each other, not for predicting a room's ceiling.

## What cannot be measured from inside

- **A Worker's clock.** It stands still while code runs, and at a timer it reads the time
  the timer was due. The probe's own gauge of its timers' lateness read exactly 0 in every
  one of the 520 requests checked in the fifth trial; in the sixth the same Worker's clock said ten
  rounds of the reference work, 1.4 to 1.9 s by the stopwatch, took 1 ms. The room's count of
  its own late ticks was 0 in every fallen run. "Gate late 0 / 0" in the fifth trial's table
  established nothing.
- **Rates timed by a late Worker.** A probe that runs late has a slow clock, so the ticks a
  second it reports read high: rows of 25 to 32 "ticks a second" from a 20-tick room in the
  sixth trial. The cloud report now gives frames for each tick the room advanced, which
  needs no clock.
- **The room's processor time.** A tail of the Worker reports processor time for each
  request when it ends, and a Gate's channel is a request on the room open for the whole
  step. Summed over a step they read 0.1% to 0.9% of the room's thread, in runs where the
  room was out of time. The work is not counted on those requests. The filters asked of the
  tail (`--header`, `--search`) were not applied either: three tails with three filters
  wrote the same 278 events. Cloudflare's GraphQL analytics has the figure by object
  (`durableObjectsPeriodicGroups`); it needs an API token that may read account analytics,
  which a studio's `wrangler` login does not carry. `lib/cf-usage.mjs` is written for it and
  has not been run against Cloudflare.

What can be trusted, because each is counted or timed by something else: a Gate's round
trip to the room (the Gate is lightly loaded and its clock keeps to its timers), the share
of worlds over 200 ms old, frames for each tick, inputs the rules called late, and the
room's tick number against the collector's clock.

## What this release changed, and whether it helped

| Change | Evidence |
| --- | --- |
| The room's once-a-second checkpoint no longer holds its frames (`allowUnconfirmed`) | At 300 players the worst gap between worlds in a Gate's second went from 103 ms in every second (fourth trial) to 63 ms, over 75 ms in 22% of seconds; a Gate's round trip to the room from 40 ms to 18 at the median. In clean runs at 800 and 900: 136 ms to 91 to 98, and 67 to 75 ms to 44 to 50. No effect is visible in a room that is out of time. In local `workerd` the write costs the same as the SQL write it replaces (1 ms for 660 KB) |
| No whole snapshot as text for nobody | 0.7 ms a tick at 1,000 on the laptop, an eighth of the room |
| A message's size not measured by encoding it; the round-trip window read once a second for a player behind a Gate | 1.9 ms a tick to 1.2 at 1,000 against 0.46.3; 2.7 to 1.3 with late inputs |
| A Gate nobody is on closes its channel after ten seconds | 274 channel requests ended between the sixth trial's steps; in earlier trials none ever ended, so a big room and its Gates stayed in memory after everybody left. It acts only on a Gate with no players |
| Slow players among healthy ones (`--slow-every`) | 300 from home with 30 sockets that stop reading for four seconds in five: the 270 others got 19.95 frames a second (the worst 19.57) against 20.03 without; in steady play 18 to 28 players were paced, never more than the 30 slow. For three seconds as measurement began every Gate's players fell half a second to a second behind together (the one home connection) and 41 healthy players were paced with them, then restored. A Gate holding paused sockets had a round trip to the room over 200 ms in 23 seconds of 134 against 4, on one Gate at a time; the cause was not found |
| An exemption from pacing when most of a Gate is behind | Written before the fifth trial's analysis, never deployed, removed: most of a Gate behind at once is a connection they share, which pacing is the cure for |
| A timer-based gauge of the room's free time; a tail of the room's processor time | Written, found unable to measure anything on Cloudflare (above), removed |

## Ways past one object

Ranked by what they buy against what they cost. Gains are of the room's second at 1,000
players on the laptop (114 ms); the factor to Cloudflare applies to all alike.

### 1. Split a dense room across several rules objects, by area (the roadmap's cells)

- **Gain.** The only one that changes the shape of the curve. Four cells of 250 are each
  inside the measured margin, and the room's megabytes to Gates stop growing with the
  square of the crowd if a Gate belongs to a cell. A thousand in one view becomes a question
  of how many cells border each other, not of one thread.
- **Cost.** The largest: the roadmap's milestone 4 (borders, mirrors of a neighbour's band,
  handoff of a body and its input queue between cells, a directory of where an entity is,
  shared counters merged from cells, the round and its results from many objects, a Door
  that places a player on the right cell's Gate).
- **Risk.** High, and known in kind: handoff under load, a fight on a border, a crowd that
  gathers in one cell anyway (the roadmap's layers answer the last). The rules contract
  already forbids what would make it impossible (a rule changes only its own entity,
  shared state is written only by room rules).
- **What these trials add to its design.** A cell should be sized by cost, not by metres:
  about 30 ms of a laptop core a second by the bench is comfortable on Cloudflare today, 60
  is the edge. And every cell's Gates should be sent that cell and its border, not the world.

### 2. Make the rules step cheaper

- **Where the 57% is.** A profile of the step at 1,000 players, by the function the time
  is in:

  | Share of the step | What |
  | --- | --- |
  | 27% | The guard on every call and property the game's code makes (`c`, `own`, `put`, `p`, `l` in `rules/guard.ts`): a property read is `Object.getOwnPropertyDescriptor` and `Object.hasOwn` each time |
  | 22% | Vectors: every one is a new frozen object entered in a `WeakSet` (`mk`, `vec3`, `dir` in `rules/pack.ts`), which is also most of the collector's 11% of the whole room |
  | 18% | The game's own handlers (its move function and its tick) |
  | 13% | Sweeping a body against the map |
  | 12% | The step's own loop, holding fields to their types, the rest |

- **Gain.** Half the step is the cost of running a studio's code safely, not the game.
  A guard that recognises objects the runtime made itself without asking for a descriptor,
  and vectors branded without a `WeakSet` and a freeze each, plausibly take the step from
  3.2 ms to about 2 (1.5 to 2 times, not 2 to 3): the room's second from 114 ms to about 85.
  It moves the edge from about 600 players to about 800.
- **Cost.** Moderate: two files, and every rules test is its proof. The work is in
  measuring each change against the rules corpus.
- **Risk.** It is the boundary between a studio's code and the runtime. A fast path that is
  wrong is a hole, not a slowdown. It needs the hostile-rules suites to grow with it.
- It helps every room of every size, and every cell of option 1.

### 3. Read players' input on the Gates

- **Now.** A Gate forwards each player's message as text inside its frame; the room parses
  the frame, then each message, checks it and queues it: 1.2 ms a tick at 1,000, 2.1
  microseconds a row.
- **Gain.** A Gate that parses and validates, and sends the room one frame of numbers a
  tick, leaves the room a loop over rows into the rules' queues: about 1.2 ms to about 0.4.
  The room's second from 114 ms to about 98. Sent as a binary frame, the room's 13 MB a
  second out could shrink the same way (the world block is base64 in JSON today: a third of
  it is encoding).
- **Cost.** Moderate. The room's checks on a message (its pace, its size, who may send it,
  the round-trip sample) move to a Gate or are done on numbers; a Gate becomes trusted for
  more than it is.
- **Risk.** Low to moderate: two validators that must agree. It does not change the curve's
  shape; it buys about a hundred players.

### 4. Run the rules at a lower rate in big rooms

- **Gain.** Linear and immediate: at 10 ticks a second the room's second halves, input read
  and worlds out with it (114 ms to about 57), which puts 1,000 where 500 is now, at the
  edge and not inside the margin.
- **Cost.** Small in the toolkit: `tickHz` is already a game's setting, and clients already
  draw between snapshots. It is a studio's choice today and needs only saying.
- **Risk.** It is a different game. An input waits up to 100 ms for its tick, not 50; a
  fast action game feels it and a crowd scene does not. It should stay a per-game setting a
  studio chooses with the numbers in front of it, never something Homie applies by size.

### Together

Options 2 and 3 are worth doing whatever else is done: they make every room and every cell
cheaper, and together take the edge from about 600 to about 900 of this game. Neither makes
1,000 dependable in one object, because the last tenth of a thread is not the room's to
plan on. Option 1 is the milestone. Option 4 is a sentence in the documentation.

## Measuring a game

A studio measures its own game on its own account:
`packages/studio/lib/crowd-probe/README.md`. The method that these trials arrived at:

1. Run the size wanted and twice the size wanted, from inside Cloudflare, three times each,
   at a busy hour.
2. Read a Gate's round trip to the room and the share of worlds over 200 ms old, not the
   room's own word about itself.
3. A size is carried when every run is clean and twice the size is not falling apart.
