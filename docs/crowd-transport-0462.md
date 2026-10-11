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

### What 0.46.2 adds to the first changes

- **Twenty players a Gate**, from the room's size alone: 50 Gates at 1,000.
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
- **A Gate finds the room's tick** from how long the room says its frame waited.
- **The probe follows the room's reported lead**, as the client does.

Measured with `node packages/studio/test/crowd-gate-cost.mjs` (the fixture game's real
rules, 1,000 seeded players). A laptop, one core, nothing else measured.

## What is proven, and where

Deterministic, on virtual time with seeded players, in the release gate
(`packages/studio/test/rules-crowd-shape.test.mjs`):

- 20 players on a Gate, two inputs each a tick for 240 ticks, against a room whose tick
  takes 2, 12 and 30 ms and is 1, 3 and 6 ms away: one frame a tick, every input once and
  in its player's order; after three seconds nine frames in ten are read 3 to 16 ms
  before the tick that takes them.
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

In real `workerd` (`gates-workerd.test.mjs`): 40 players behind fifteen Gates each
receive the world, sent as numbers, with their own body in it; nine in ten on the crowd
path; and the diagnostics object reports every one without the room being asked.

Not proven: Cloudflare at 1,000 players. Load runs on the computer this was written on
are not evidence either way; it was running other heavy work.

## What the next trial needs

At 6.3 KB a second a player, 1,000 players are 6.3 MB a second: the trial connection's
whole capacity (5.2 to 7.1 MB/s measured across the second trial). The 1,000 step will be
at or over the link, and pacing will hold players near a second behind rather than
further; its server columns are the ones to read. Setting the trial game's
`view.precisionM` to 0.05 brings it to 5.3 MB a second. A probe that opens its sockets
from inside Cloudflare would take the link out of the measurement, and would say nothing
about a player's own connection or the last hop, which is where the first trial's seconds
were; it is not built.
