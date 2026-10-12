# Six cloud trials of big rooms, and the shape that followed (0.46.2 to 0.46.6)

## What one room carries

Measured on Cloudflare with the crowd-circuit game (every player in one dense arena, each
seeing about 180 others, 20 ticks a second), over the last three trials:

- **300 players with margin**: clean in all seven runs, from home and from inside
  Cloudflare, at any hour.
- **600 is the edge**: clean in four runs of six.
- **800 to 1,000 is luck**: clean in five runs of twenty-five from inside Cloudflare. The
  same step gave 10 frames a second or 20, minutes apart.
- It depends on what the game's rules cost: a heavier game carries fewer. Measure your own
  (`lib/crowd-probe/README.md`).
- Past that, a world has to be more than one room object: the roadmap's worlds of many
  areas (`docs/rooms-plan.md`, milestone 4). 1,000 players in one object is not promised.

The numbers, the cost of a tick and the ways past one object are in
`docs/rooms-capacity-findings.md`. The rest of this note is how it got here: six trials,
and what each one showed. The table below is the fourth trial's, as it was written then.

## What was proven on Cloudflare by the fourth trial, and what was not

Measured on 11 October 2026 with the released code, the crowd-circuit game (every player
in one dense arena, each seeing about 180 others), 150 seconds a step:

| Players | From a home connection | From inside Cloudflare |
| --- | --- | --- |
| 50 | 20 Hz; ack 155 / 206 ms (p50 / p95) | 20 Hz; ack 99 / 150 |
| 150 | 20 Hz; ack 178 / 242 | 20 Hz; ack 131 / 197 |
| 300 | 20 Hz; ack 182 / 242; no drops | 20 Hz; ack 139 / 360 |
| 600 | 19.4 Hz; ack 292 / 819; marginal | 20 Hz; ack 167 / 310; 599 of 600 held |
| 1,000 | 10 Hz: not there | 785 got in and held 20 Hz; 215 did not get in |

- **Proven: 300 players at 20 frames a second from a home connection**, 2.5 to 4.8 KB a
  second a player on the wire, compressed on every socket.
- **Proven: 600 at 20 frames a second measured from inside Cloudflare.** From one home
  connection carrying all 600 players it was marginal.
- **Not proven: 1,000.** Everyone is admitted and the room keeps its ticks, but delivery
  from a home connection fell to half rate, and the in-Cloudflare probe seated 785.
- "From inside Cloudflare" is a Worker playing the players (`lib/crowd-probe/`): what the
  servers can do, with no home connection in the measurement and none of a player's last hop.
- A game where players see fewer of each other costs less than this one; one with heavier
  rules costs more. These are one game's numbers.

Rooms of 64 seats or fewer, and every room a player's browser hosts, do not use any of
this: they are their Table alone, as before. How that is known is at the end.

The rest of this note is how it got here: four trials, and what each one showed.

The trial ran 0.45.3 on real Cloudflare on 11 October 2026 (UTC), at 50, 150, 300, 600 and
1,000 players, from one computer. Its data is in the trial studio under
`reports/crowd-circuit/phase-d/20261011T001053Z/`. This is what that data says, what it
cannot say, and what changed. The first set of changes was tried on Cloudflare as a build
numbered 0.45.4, which was never released; the second section is that trial. Nothing here
is a capacity claim: no trial of 0.46.2 itself has run on Cloudflare yet.

Below, "the first changes" are the ones the second trial ran.

## What the trial's own data can and cannot show

`wrangler tail` went into sampling at once ("Tail is currently in sampling mode", 12
times) and lost its connection three times: it kept 2,170 of the run's events. A WebSocket
is one invocation however many messages it carries, so the tail holds no per-message
timing; a per-message timeline cannot be built from it. What it does hold: a wall and CPU
time for each sampled connection, every `ticks` line the room logged, and the outcome of
each sampled request. The rest of the timeline is from the room's own counters, captured
once a second (`diagnostics.jsonl`), and the driver's reports.

## One tick at 150 players, hop by hop

| Hop | Measured |
| --- | --- |
| Player to Gate (this computer to Cloudflare) | ping round trip 20 ms at best, 41 to 55 ms on average, 140 to 173 ms at worst, on a satellite link |
| Gate to Concentrator (input) | receipt round trip 2 ms median, 244 ms worst |
| Concentrator to room (input) | receipt 1 to 2 ms median, 313 ms worst |
| The room's tick | exactly 200 ticks in every ten-second log line (16 of 16 at 150, 8 of 8 at 300, 4 of 4 at 1,000); late 0, slips 0 |
| Room to Concentrator (state) | two frames a tick of 12.4 KB; receipt 1 to 3 ms median, 149 ms worst; queue 0; nothing replaced |
| Concentrator to Gate (state) | receipt 7 to 9 ms median, 1,021 ms worst; every Gate was sent all 24 KB a tick for its 5 to 20 players; 3% of views replaced before sending |
| Gate to player | every frame written; players received 20.06 a second on average, in bursts: a median player's worst gap was 1.9 s, one in ten went over 7.6 s |

Inside Cloudflare a tick's round trip was about 15 to 25 ms at 150 players. The seconds
were on the last hop.

## The questions

**Is the room object's thread saturated by inbound events, so its tick starves?** Not at
150 or 300: 200 ticks in every ten seconds, and receipts of 1 to 3 ms. It was getting
close above that. The CPU Cloudflare recorded against the room while a facts request was
open was 13% of the wall time at 150, 35% at 300, 45% at 600 and 47% (median) to 80% (worst)
at 1,000, during the ramp. (That reading assumes Cloudflare bills a Durable Object's work
to its open request; a facts answer by itself costs 1.4 ms for 1,000 players on a laptop.)
At 1,000 the room's receipts from its Concentrators took 50 to 800 ms and up to 1,696 rows
waited. So the room was heading for saturation at a full 1,000, and its per-player work
each tick (one queued view per player, one promise chain per input) is what 0.46.2 removes.

**How many Gates, and how were players spread?** Sixteen at every step, behind two
Concentrators. Players per Gate: 1 to 7 at 50; 5 to 20 at 150; 12 to 27 at 300; 25 to 47
at 600; 35 to 58 at 742 of the 1,000. A Gate's own cost is small (a laptop core spends
5.7 ms a tick on 62 players of a 1,000-player world, 11% of it), so a Gate was not serving
too many sockets. There were too many hops: each Concentrator read 1.7 MB a second from
the room at 1,000 and wrote it again to eight Gates, 8 MB a second.

**Are snapshots replaced before sending, starving a slow player for good?** No. At 150
the room replaced none and the Concentrators 3%; at 1,000 about 22 views a tick per link.
A replaced view is replaced by a newer one that is sent when the link frees (0.85 s at
the worst), and a player's own body is in every view. The five-second absences were not
replacement. They were the opposite: a Gate wrote every tick to a player whose connection
could not carry them, with nothing to tell it so, and every frame arrived, late.

**What produces 1013 "Service overloaded; retry later."?** Cloudflare. The text is in the
Workers runtime itself and nowhere in the toolkit. It appeared four times, all at 600,
all during the join ramp, when the tail shows four of the Worker's requests to a Gate
ending in an exception within 64 to 369 ms. That is the platform refusing work for a Gate
it judged overloaded while sockets were queueing behind its admissions.

**Where does 150 ms at 50 players come from?** From the measurement. The driver, like the
toolkit's client, stamps an input for three ticks ahead of the newest it holds and stops
the clock when a snapshot acknowledges that tick: 150 ms when everything is on time. The
p95 of 332 ms is that plus this link's jitter.

**"rate: in over 60/s was dropped".** `RATES.in` (60 a second), a default on every room,
counted against a Gate's stamp of when the input arrived. A player whose connection
stalled and then delivered ten seconds of honest input at once was over it. Every default
on this path, all in `worker/limits.mjs`: `RATES` (`in` 60, `ev` 30, `ping` 8, `other` 8,
`say` 4, `react` 10, `decide` 2, and the host-only kinds), `EV_RATES` (host 30, replica
10, screen 2) and `rulesRates` (a browser host's output). 0.46.2 applies none of them to
what a player sends a server-hosted game, except what players say to each other; a studio
names its own in `room.rates`. A room hosted by a player's browser keeps all of them.

## The structural cause

Two, and the larger one is not in Cloudflare.

**The trial measured this computer's internet connection from 150 players up.** Bytes
delivered a second: 1.33 MB at 50, 6.10 MB at 150, then 8.24, 8.41 and 7.62 MB at 300, 600
and 1,000. Players doubled and doubled again and the total did not move: frames per player
fell from 20 to 16.4, 8.5 and 5.2 a second. Measured afterwards, twelve parallel downloads
from Cloudflare to this computer carried 3.4 to 6.0 MB a second. The driver had turned
WebSocket compression off, which no browser does, so each simulated player asked for 27 to
41 KB a second of plain JSON, and all of them shared one satellite link. A player behind
a full link is seconds behind, sends inputs stamped for ticks that have passed (65% of
inputs were late at 150, 95% at 300) and waits seconds for an acknowledgement. The same
link carried the diagnostics collector's 0.2 to 0.4 MB answer each second, which is why it
timed out; Cloudflare answered that request in 111 ms (median) at 1,000.

**The room did a player's worth of work for every player, through a relay.** That did
not cause the seconds at 150, and it would have set the ceiling soon after: see the room's
CPU share and the Concentrators above.

A third thing made the first worse. A Gate cannot see how full a player's connection is
(the Workers runtime has no `bufferedAmount`), so it wrote all 20 frames a second to a
player who could take six.

## The first changes (tried as 0.45.4)

- **The room runs the rules and visits Gates, not players.** One world a Gate a tick. The
  Gate selects each player's view, encodes it and writes it.
- **One channel from each Gate to the room.** No Concentrator.
- **One frame of input from each Gate a tick**, timed by the round trip the Gate measures
  on its channel so that it reaches the room just before the next tick.
  Sixteen messages a tick reach the room at 1,000 players, where 0.45.3 sent it up to a
  thousand a second on each of two links.
- **A slow player is sent fewer, fresher frames.** The client says which tick it holds;
  a Gate that finds it more than a second behind halves that player's rate, to one a
  second at the least, and restores it. Every frame carries the player's own body.
- **Diagnostics are served by another object**, from a copy the room and Gates post each
  second, a few kilobytes, with its age.
- **No default pace on input** (above).
- **The probe behaves like a browser**: it offers compression, and reports the bytes its
  sockets read.

## The second trial (the first changes, on Cloudflare)

Run on 11 October 2026 (UTC) from the same computer; data under
`reports/crowd-circuit/phase-e/20261011T041939Z/`.

| Players | joined / end | ack p50 / p95 ms | frames a player a second | wire MB/s (link) | Gate frames a second, median | Gate round trip to room, median / p90 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | 50 / 50 | 142 / 292 | 20 | 0.25 (7.1) | 20 | 5 to 26 |
| 150 | 150 / 150 | 152 / 342 | 20.03 | 1.44 (5.2) | 20 | 37 / 69 |
| 300 | 300 / 300 | 188 / 413 | 19.76 | 3.52 (6.3) | 19.8 | 38 to 50 / 85 |
| 600 | 600 / 598 | 461 / 1,041 | 17.4 | 5.46 (6.9) | 17.1 | 51 to 99 / 356 |
| 1,000 | 994 / 993 | 847 / 2,853 | 4.0 | 3.71 (6.9) | 3.1 | 554 to 589 / 2,320 |

What held: the room ran its rules at exactly 20 ticks a second at every size, 994 of 998
were admitted, nothing restarted, the diagnostics collector did not miss a poll, and
nothing was dropped for a rate.

**Compression is real.** Cloudflare agreed to permessage-deflate on every socket that
offered it (50 of 50, 150 of 150, 300 of 300, 600 of 600, 996 of 996) and it saved 5.5 to
5.8 times. A browser gets the same.

**What collapsed between 600 and 1,000 was the Gates, on output.** The connection was not
full at 1,000 (3.7 of 6.9 MB/s) and the room was on time. A Gate's own numbers:

- A Gate wrote about 2 to 2.5 MB a second of frames when it kept up (30 players at 300:
  up to 3.45 MB/s, 20 Hz), and no more when it did not: at 1,000, with 52 to 72 players
  each, Gates wrote 0.3 to 4.4 MB a second and 3 frames a second per player, where 20
  frames to that many players would have been 6 to 7 MB a second.
- A Gate's round trip to the room, on its own clock, was 5 to 26 ms at 50 players, 38 to 50
  at 300, 51 to 99 at 600 and 554 to 589 at 1,000 (2.3 s at the 90th percentile; one Gate
  waited 9.4 s for a receipt). The room measured the same links at 10 to 20 ms at 300 and
  525 to 875 ms at 1,000: a Gate was that long getting to the next thing in its queue.
- The room replaced 9 worlds a second per link at 1,000 because eight were already
  unacknowledged; a Gate received 13 a second instead of 20.
- Every player was then "paced": a Gate that reads a player's report seconds late thinks
  the player is seconds behind. The pacing did not cause the collapse; it followed it.

Calibrating a laptop against the first trial (a Gate there used 108 ms of CPU a second for
at most 20 players of 150) puts Cloudflare at five to eight times slower than the laptop
these were measured on. On the laptop, a 0.45.4 Gate of 62 players in a room of 1,000
needs 10.7 ms a tick for selecting and encoding alone, before compression: 50 to 85 ms of
a 50 ms tick on Cloudflare.

**Per-player bytes were too high.** 11.7 KB a second on the wire per player at 300, after
compression. In this game a player near the middle sees about 180 bodies, 71 of them
changed in any frame, and a third of each row was a heading printed to 16 digits.

**"Late inputs" measured the probe, and then a mistake of mine.** The column is the share
of inputs that reached the rules after the tick they were stamped for (they apply on the
next). The probe stamped every input three ticks ahead and never adjusted; the toolkit's
client moves its clock by the lead the room reports in every snapshot. On this connection
(41 to 55 ms round trip, to 173) a fixed three ticks misses about a quarter of the time,
as it did in the first trial (28%). The rise with size (0.27, 0.33, 0.54, 0.99) was the
Gate's timing: it sent its input frame a fixed interval after a world ARRIVED, and a
world arrives after the room's tick has run. The longer the tick ran, the later the frame,
until it missed every tick by a little. "Input transit" and "world age" compare two
computers' clocks and are only good for seconds.

### What the second set of changes added (tried as the first 0.46.2 build)

- **Twenty players a Gate**, from the room's size alone: 50 Gates at 1,000. (Wrong: see the third trial.)
- **The world crosses as numbers.** One block for every Gate (24 bytes a body, exact,
  carried in the frame as base64) and what else changed: 33 KB a tick at 1,000. The room
  sends 34 MB a second to 50 Gates where the JSON would be 179 (and was 48 to sixteen),
  and a Gate rebuilds it in 0.26 ms where parsing took 0.93. Building it for all 50 Gates
  takes the room 0.8 ms a tick.
- **Bodies coast.** A Gate sends a body when a client coasting it on its last velocity
  would be off by more than the game's precision (near) or half a far interval's travel
  (far). 71 rows a frame become 20; 14.8 KB a second per player becomes 6.3; far bodies
  are drawn 3 cm from the truth on average where holding them still between refreshes
  gave 35 cm. `view.precisionM` is now the dial: at 0.05 it is 5.3 KB a second.
- **Once a world, not once a player**, for everything that does not depend on the player:
  46 microseconds a player-frame where it was 156.
- Together, on the laptop, a Gate's tick at 1,000 players is 1.4 ms where it was 10.7.
- **A Gate finds the room's tick** from how long the room says its frame waited. (It did not: see the third trial.)
- **The probe follows the room's reported lead**, as the client does.

Measured with `node packages/studio/test/crowd-gate-cost.mjs` (the fixture game's real
rules, 1,000 seeded players). A laptop, one core, nothing else measured.

## The third trial (the second set of changes, on Cloudflare)

Run on 11 October 2026 (UTC); data under `reports/crowd-circuit/phase-f/20261011T063259Z/`.
The computer it ran from had a load average of 10 to 12 throughout.

| Players | joined / end | ack p50 / p95 ms | lead (late) | frames a player a second | KB/s a player | Gates | Gate round trip med / p95 ms | driver's worst timer lag ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | 50 / 50 | 277 / 413 | 6 (0.017) | 20.0 | 2.46 | 26 | 14 / 43 | 26 |
| 150 | 150 / 150 | 289 / 458 | 6 (0.031) | 20.1 | 3.80 | 49 | 19 / 53 | 38 |
| 300 | 300 / 300 | 341 / 531 | 7 (0.04) | 20.1 | 4.54 | 49 | 35 / 78 | 144 |
| 600 | 600 / 600 | 672 / 1,239 | 12 (0.33) | 15.5 | 3.74 | 50 | 36 / 276 | 637 |
| 1,000 | 976 / 977 | not measured | 12 | not measured | | 50 | 805 / 3,621 | 101 |

**What held.** Compression on every socket (4.7 times). A player costs 2.5 to 4.5 KB a
second on the wire, down from 11.7. 20 frames a second to 300. Nothing dropped to 600.

**The room was spent on messages.** Players were spread over every Gate by a hash: 26
Gates for 50 players, 49 for 150. Each channel carried 26 to 32 frames a second from the
room and about as many back, so at 50 Gates the room handled some 2,600 to 3,000 messages
a second, where the second trial's sixteen channels made about 800 and were fine to 600.
At 600 the room replaced 0.65 worlds a second per channel and a Gate's round trip reached
276 ms at p95 and 1.9 s at p99; at 1,000 the room waited 600 to 850 ms for receipts with
eight worlds unacknowledged on every channel, and a Gate's round trip was 0.8 s at the
median. A Gate itself was nearly idle (0.2 MB a second of frames at 600). Twenty players
a Gate was the wrong answer to the second trial: it cured the Gates and overloaded the
room, by the message.

**The room cannot see itself run late.** "Server tick 20 / 20" on every row, the collapsed
ones too, is the room's count by its own clock, and a Worker's clock does not move while
its code runs. At 600 every Gate alike put the world 0.86 to 1.46 s behind its stamp while
its round trip was 36 ms: the room was that far behind its schedule, or its clock is
that far from the Gates'. This data cannot say which, nor how much of the 150 to 490 ms at
50 to 300 is which. The next build measures both from the Gates (below).

**The 600 step's client numbers are partly the driver's.** Its timers ran up to 637 ms
late and it held 1 GB. The room-side numbers above are not the driver's.

**Ack of 277 ms in a room of 50 was two mistakes of mine.** The lead of six ticks is what
the probe settled on to keep late inputs under one in twenty, and an input's path had two
waits in it that should be one: the Gate's search for the room's tick did not converge
(its frame left 0 to 23 ms after a world at the median, the worst moment), so an input
waited up to a tick at the Gate and up to another at the room. The search reads how long
the room held a frame, and that reading moves by more than the window it aims for.

**The 1,000 step was not measured** because the driver stopped when a Chrome player lost
its link during the ramp, before the measurement began.

### What 0.46.2 is now

- **Fifty players a Gate, and Gates fill in order.** The room tells the door which Gate
  has room: 50 players are one Gate, 300 are six, 1,000 are twenty. A channel is one frame
  each way a tick: 800 messages a second at the room at 1,000 players.
- **A Gate sends what players sent at once when its channel is quiet, and never more
  than one frame in 50 ms.** No search for the room's tick.
- **Each Gate measures the room**: the room's clock against its own (stamps exchanged on
  the channel, as NTP does), the room's ticks a second by the Gate's clock, and the
  longest it went without a world. World age is corrected by the measured offset.
- **An input's loop is reported**: from the tick a player held when it stamped an input
  to the tick it reached the rules, whatever lead the player keeps.
- **A Chrome player's trouble no longer ends a step**, and a step that measured nothing
  still reports what it saw.
- **The in-Cloudflare probe** (`lib/crowd-probe/`): a Worker of its own that plays five
  players a request against a studio from inside Cloudflare, and a runner that adds the
  requests up into the same report. It shows what the servers can do with no home
  connection and no busy laptop in the measurement; it says nothing of a player's last hop.

## The fourth trial (0.46.2 as released)

Data under `reports/crowd-circuit/phase-g/20261011T080713Z/`; the table is at the top of
this note. Each step ran from the trial computer and from the in-Cloudflare probe.

- The room opened only the Gates its players filled (2 at 50, 7 at 300, 13 at 600, 20 at
  1,000) and each channel carried one frame a tick each way.
- An input's loop (the tick a player held, to the tick its input reached the rules) was
  100 to 119 ms at the median from home at 50 to 300, and 63 to 75 ms from inside
  Cloudflare. Players settled on a lead of three or four ticks; under 1.3% of inputs late.
- World age, corrected by each Gate's measurement of the room's clock, was 0 to 3 ms at
  the median. The quarter-second ages of the third trial were the two clocks.
- 600 from home: every player was paced at some point and 12 to 16% of inputs were late,
  where the same room from inside Cloudflare was clean. Unexplained yet.
- 1,000 from home: Gates delivered 9.6 frames a second, a Gate's round trip to the room
  was 0.6 s at the median, the room's ticks by the Gates' clocks fell to 18.9 a second.
  The connection had room (3.45 of 19.7 MB a second) and the driver was not late.
- 1,000 from inside Cloudflare: 785 seated, 20 frames a second for those. Whether the
  215 are the probe's limit or admission is not known yet.

## The fifth trial (the first build of 0.46.6, numbered 0.46.4 when it ran), and what the room costs

Data under `reports/crowd-circuit/phase-h/20261011T115304Z/`: 600, 800, 900 and 1,000 players, each from home and
from inside Cloudflare, with compression and without. One run of each.

**What held.** 1,000 of 1,000 admitted. With compression, from inside Cloudflare: 20 frames a second at 1,000, ack
168 / 340 ms. Compression helps at every size.

**What did not.** From inside Cloudflare without compression the room was clean at 800 and fell to 14 frames a
second at 900 and 1,000; with compression it wobbled at 900 and was clean at 1,000; from home it fell at 800.
When it fell, every Gate fell alike: in one second all twenty Gates measured a round trip to the room of 0.94 to
1.10 s, and the room measured 0.99 to 1.13 s to each of them, with eight worlds unacknowledged on every channel.
Worlds still arrived smoothly (the longest wait for one was 0.16 to 0.29 s), so this was a steady queue in front
of one busy object and not a pause: the room. Compression is a Gate's work and the room cannot see it, so the
two columns differing at 900 and 1,000 is one run differing from another, not compression.

**The room's second, measured where a clock moves.** `test/crowd-room-cost.mjs` runs the room's own objects in
Node with 1,000 seeded players sending what the probe sends (about 11,000 rows a second). On the laptop this was
written on, a second of a 1,000-player room took about 125 to 145 ms of one core:

| Part | ms a tick | share |
| --- | --- | --- |
| The rules (1,000 bodies stepped) | 3.6 to 4.0 | 55% |
| Players' messages read (a Gate's frame of them, 500 a tick) | 1.3 to 1.7 | 23% |
| Each Gate's world built and written (20 of 29 KB) | 0.5 | 8% |
| The snapshot, the control rows, the checkpoint once a second, the rest | 0.5 | 8% |
| The whole snapshot as text, which a room behind Gates sends to nobody (removed in this release) | 0.84 | was 12% |

It grows with players in a straight line (77 ms a second at 600, 97 at 800, 126 at 1,000). The second trial put
Cloudflare at five to eight times slower than this laptop; if that holds, a 1,000-player room spends 0.6 to 1.0
of every second of its one thread, which is where it fell. That figure is an inference from a Gate's cost in the
first trial. This release measures it instead (below).

**A second cause, at every size.** Cloudflare holds whatever an object sends after a storage write until the write
is confirmed. The room wrote its whole checkpoint once a second, so every second, at 50 players as at 1,000, one
or two worlds reached every Gate a tick or more late (a Gate's longest wait for a world was 0.10 s at 50 players
and 0.13 to 0.14 s at 1,000 in the healthy runs, where 0.05 is due). "World age p95" in these tables is the worst
world of a Gate's second, so it was 0.23 to 0.32 s in runs that were otherwise clean.

**No object can see itself run late.** Three findings, one cause. The room's own clock read behind its Gates' by
more as the room grew: about 0 at 300 players, 0.45 s at 600, 0.8 s at 1,000 in a clean run and 1.4 s in a fallen
one, checked against two other clocks (the diagnostics object's and the collector's). The room's count of its own
late ticks was 0 throughout. And the probe's own gauge of its timers' lateness read exactly 0 in every one of 520
requests, each some 15,000 timer turns with frames to decode between them, where any real clock shows a
millisecond now and then. On Cloudflare a Worker's clock stands still while its code runs, and when a timer fires
it reads the time the timer was due, not the time it ran. So "Gate late 0 / 0" in this trial's table, a Gate's
20 ms timer measured by the Gate's own clock, says nothing either way, and the room's clock is its timers'
schedule, behind the world by however late they have run. (Local `workerd` does not do this: its clock moves.)
What an object's lateness looks like from outside is all there is: a Gate's round trip to the room, the players'
loop, and Cloudflare's own count of processor time.

**From one home connection.** With compression the connection was not full (3.1 to 3.5 of about 20 MB a second),
and the Gates' columns show the same fall as from inside Cloudflare, at 800 and not 900: the home driver's players
send 10.5 inputs a second each where the probe's send 8 to 9, a fifth more work for the room. Without compression
the same players ask for 12 MB a second of one satellite connection, and every player is behind and is sent fewer
frames, as they should be. A thousand players on one connection is not a population of players; from home, the
honest sizes are the ones a connection carries with room to spare (600 here), and the question it answers is what
a player's last hop adds.

**Pacing.** A player is sent fewer frames when behind and not catching up, by their own reports alone. An
exemption for a Gate whose players are mostly behind at once was written and removed before release: that case is
a connection they share being full, which sending each of them less is the only cure for. In the fallen runs
delivery fell because worlds did not reach the Gates (a Gate wrote as many frames a player as it received
worlds), not because players were paced. Each Gate now also counts the players more than a second behind,
whether or not it is pacing them.

### What 0.46.6 changes

- **The room's checkpoint holds none of its frames.** A match room behind Gates writes its once-a-second
  checkpoint to the object's key-value storage with `allowUnconfirmed`, Cloudflare's own way to say that nothing
  need wait for it. A save an admission asks for is still confirmed before the welcome that names the seat
  leaves, and removes the unconfirmed one in the same transaction, so an older checkpoint can never be restored
  over a newer save. A lasting world's writes are confirmed, as before.
- **Less of the room's second**: no whole snapshot as text for nobody (0.84 ms a tick); a message's size is not
  measured by encoding it when it is ASCII; the round trip the rules are told for lag compensation is read, for a
  player behind a Gate, from its ten-second window four times a second, not once an input.
- **A Gate nobody is on gives its channel back after ten seconds.** An open channel kept the room and the Gate in
  memory, and billed, with nothing to carry; in earlier trials none ever ended. The next player opens another.
  (Reading the room's processor time off those channels' requests in a tail was tried in the sixth trial and
  does not work: the work is not counted there.) A room cannot divide a tick between the rules and its sends, or
  time anything else about itself (above); `crowd-room-cost.mjs` gives the division.
- **How fast Cloudflare is, measured from outside**: the probe runs one fixed piece of work ten times in a request
  and the computer running the trial holds the stopwatch (that request less one that does no work), then times
  the same work itself (`crowd-cloud.mjs --calibrate`). An instrument that timed the room's thread from inside
  with an idle timer was written and removed: on a clock that reads a timer's due time it could measure nothing,
  and a timer chain that falls behind could drag the clock the tick is scheduled by.
- **A world's age as a share**, not only the worst of a second: of every world every Gate wrote, how many were
  over 100, 200 and 400 ms old, and how many came more than 75, 150 and 300 ms after the one before.
- **Slow players in both drivers**, every Kth so every Gate holds some: the probe's take six frames a second; the
  home driver's sockets stop reading for four seconds in five. The report gives the healthy players' figures apart.

What this release does not do is make the rules cheaper, and they are over half of the room.

## The sixth trial (the second build, numbered 0.46.4 when it ran; 0.46.6 is that build less the measurements that could not measure)

Data under `reports/crowd-circuit/phase-i/20261011T205700Z/`, run at 14:00 Pacific where the fifth ran at 05:00:
300 and 600 from home, 300 with slow sockets, and 800, 900 and 1,000 from inside Cloudflare three times each with
compression and three without.

- **It was not better than the fifth, and 1,000 is not dependable.** 800 was clean in one run of six where the
  fifth had it clean in two of two; 900 in one of six; 1,000 in none, the best delivering 18.5 frames a second.
  The same step gave 10 frames a second and 20 an hour apart.
- **The build is not what got worse.** On one computer, back to back, this build's room costs 113 to 116 ms of a
  core a second at 1,000 players where the fifth trial's costs 121, and 119 against 123 with every input late.
  The checkpoint change helps wherever the room is not out of time: at 300 the gap every Gate saw once a second
  is gone (103 ms in every second before; 63 ms now, over 75 ms in 22% of seconds) and a Gate's round trip to the
  room fell from 40 ms to 18. What differed was the hour, or nothing but chance: this note cannot say which.
- **Cloudflare ran a fixed piece of work 2.6 to 4.1 times slower than the laptop**, by a stopwatch outside it,
  varying by half again between requests. By the bench that is 0.30 to 0.47 of the room's thread at 1,000 for
  the work the bench sees, which does not by itself explain a room falling at 800: about as much again is the
  runtime's own work on the same thread and the machine's other tenants, and it was not measured.
- **The room's processor time could not be read.** The channels' requests reported 0.1% to 0.9% of the thread in
  runs where the room was out of time, and the tail's filters were not applied. The column is gone.
- **A late probe's clock runs slow**: rows of 25 to 32 "ticks a second" from a 20-tick room. The cloud report
  now counts frames for each tick the room advanced.
- **Slow sockets, 30 of 300 from home**: the other 270 got 19.95 frames a second (the worst 19.57). In steady
  play only slow players were paced (18 to 28 of the 30). Once, as measurement began, every Gate's players fell
  behind together for three seconds (the home connection) and 41 healthy players were paced with them, then
  restored. The acknowledgement tail of 3.9 s in that row is the slow players' own; the drivers now keep their
  figures apart.

The conclusion is at the top of this note, and what to do about it in `docs/rooms-capacity-findings.md`.

## What is proven, and where

Deterministic, on virtual time with seeded players, in the release gate
(`packages/studio/test/rules-crowd-shape.test.mjs`):

- 50 players on a Gate, two inputs each a tick for 100 ticks: never two frames to the room
  within 50 ms, the first at once when the channel is quiet, every input once and in its
  player's order, none waiting more than 50 ms; and the Gate measures the room's clock
  (7 ms ahead in the test) and the room's ticks a second by its own.
- A thousand players arriving in a storm fill twenty Gates in order: fifty players are one
  Gate, three hundred are six.
- The in-Cloudflare probe, run whole against a Gate and the real rules host: fifteen
  players, 20 frames a second each, an input's loop under 100 ms at the median and 150 at
  p95, a lead of three ticks or fewer.
- A player whose link carries six frames a second, for thirty seconds: never more than 40
  ticks behind, own body in every frame, every delta decodes; a player on a good link
  beside them gets all 600 frames. The same link without the client's word: more than 300
  ticks behind and still falling.
- 120 seeded players behind four Gates and the real rules host with every runner running,
  five seconds, the room 3 ms and then 10 ms away: 100 frames each, own body in every one,
  no input late, 100 frames from each Gate to the room, and a coasting client sent under
  six tenths of the bytes of an older one beside it.
- The world wire: 120 ticks of a real 200-player crowd, with a body leaving and one
  joining, arrive at a Gate exactly as the room held them, for a link that takes every
  world, one that has two in three replaced, and one that opens half way; in under a
  quarter of the JSON's bytes. Numbers that are not 32-bit exact cross in 64 bits.
- The crowd path: 200 ticks of a real 300-player crowd, six players (one paced, one a
  screen): exactly the bodies in range every tick; a player's own body exact; a near body
  never more than 2.5 hundredths of a metre from the truth and a far one never further
  than holding it still did; under half the bytes.
- The room sends one world a Gate a tick and writes nothing per player.
- A game with owner-only fields is never handed to a Gate whole.
- Rates, `room.rates`, and the diagnostics object answering without asking the room.
- Fifteen probe players on one Gate, three of them slow (six frames a second): the twelve others get 20 frames a
  second each and never wait 110 ms for one, under one in twenty of their inputs is late, only slow players are
  paced, and the Gate's round trip to the room stays under 20 ms.
- A match room's unconfirmed checkpoint: written with `allowUnconfirmed`, the newest save when it exists, read
  back by an object that wakes, replaced by any confirmed save, ignored when its pieces do not fit its record,
  never written by a lasting world. In real `workerd` a room behind a Gate writes them and restores.
- A Gate's channel stays while a player is on the Gate or comes back within ten seconds, closes ten seconds after
  the last leaves, and the next player opens another.
- Fifty players on a Gate, five of them on sockets that stop reading for four seconds in five, for a minute: the
  forty-five others get every frame and are never paced; only slow players are; every frame a slow player is sent
  decodes and has their own body in it.

In real `workerd` (`gates-workerd.test.mjs`): 40 players in a 300-seat room are placed on
one Gate by the room, each receives the world, sent as numbers, with their own body in
it; nine in ten on the crowd path; and the diagnostics object reports every one without
the room being asked.

Not proven, and not promised: 1,000 players in one room object on Cloudflare (the top of this note). Load runs on
the computer this was written on are not evidence either way; it was running other heavy work.

## Small rooms and browser-hosted games

A room of 64 seats or fewer never meets a Gate: the door hands its sockets to the Table
(`gateFor`, unchanged for `gates === 1`), and none of the world wire, coasting, pacing or
the diagnostics object is on its path. Three things do reach it:

- A server-hosted game is no longer paced on what a player sends (inputs, events, pings).
  Speech and chat keep their pace. A browser-hosted room keeps every cap it had.
- A healthy room is not ended as an overrun for timers that arrive late and catch up.
- The view library says `coast: 1` in its hello and names the tick it holds on inputs and
  pings. A Table ignores both.

How it is known: the suites that play those rooms pass unchanged, among them
`rules-0452-compat` (games built with 0.45.2 against this relay), the browser-hosted
rules suites, the legacy release gate in CI (starters released with 0.32.1, two real
browsers finishing a round) and the two-browser studio check. The old view path
(`scheduledView` with the plain encoder) gives byte-for-byte what it gave; the tests that
pin its output were not changed.

## The local reproduction, by hand

```sh
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:crowd
```

Eight local `workerd` processes (the Worker, the room, the Gates), two Chrome players and
the load driver on one computer, at 300 players and then 1,000 (`CROWD_TOTAL=302` for the
first alone). It is not a check: it needs most of a computer to itself, and a four-core CI
runner gives 10 frames a second at 300 where Cloudflare gives 20 at 600. On an idle
eight-core laptop the 300 case passes (20 frames a second, ack p95 170 ms). Use it to see
a change work end to end with the real driver before a cloud trial; do not read capacity
from it.

## Measuring your own game

`lib/crowd-load.mjs` plays a crowd from your computer and `lib/crowd-probe/` from inside
Cloudflare, on your own account; `lib/crowd-probe/README.md` has the commands, what each
proves, and how to delete the probe afterwards. Both play the crowd-circuit game's input.
