# Two cloud trials of big rooms, and the shape that followed (0.46.2)

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

In real `workerd` (`gates-workerd.test.mjs`): 40 players in a 300-seat room are placed on
one Gate by the room, each receives the world, sent as numbers, with their own body in
it; nine in ten on the crowd path; and the diagnostics object reports every one without
the room being asked.

Not proven: Cloudflare at 1,000 players. Load runs on the computer this was written on
are not evidence either way; it was running other heavy work.

## What the next trial needs

Each step twice: from the trial computer (what a player at home sees) and from the
in-Cloudflare probe (what the servers can do). The probe has never run on Cloudflare: it
is tested whole against a Gate and the rules host on virtual time, with the Worker
runtime's `fetch` stood in for. Its first run is also its own trial.
