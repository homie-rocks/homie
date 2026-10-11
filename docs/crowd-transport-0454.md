# What the 0.45.3 cloud trial measured, and the shape that followed (0.45.4)

The trial ran 0.45.3 on real Cloudflare on 11 October 2026 (UTC), at 50, 150, 300, 600 and
1,000 players, from one computer. Its data is in the trial studio under
`reports/crowd-circuit/phase-d/20261011T001053Z/`. This is what that data says, what it
cannot say, and what 0.45.4 changes. Nothing here is a capacity claim: no trial of 0.45.4
has run on Cloudflare yet.

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
each tick (one queued view per player, one promise chain per input) is what 0.45.4 removes.

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
10, screen 2) and `rulesRates` (a browser host's output). 0.45.4 applies none of them to
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

## What 0.45.4 changes

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

## What is proven, and where

Deterministic, on virtual time with seeded players, in the release gate
(`packages/studio/test/rules-crowd-shape.test.mjs`):

- 64 players on a Gate, two inputs each a tick for 100 ticks: at most one frame a tick to
  the room, each sent 5 ms before the next world is due on a link with no delay, every
  input once and in its player's order, none waiting more than 50 ms.
- A player whose link carries six frames a second, for thirty seconds: never more than 40
  ticks behind, own body in every frame, every delta decodes; a player on a good link
  beside them gets all 600 frames. The same link without the client's word: more than 300
  ticks behind and still falling.
- 120 seeded players behind four Gates and the real rules host, five seconds, with the
  room 3 ms and then 10 ms away: 100 frames each, own body in every one, 0 of 9,202 inputs
  late, 100 frames from each Gate to the room.
- The room sends 16 worlds a tick for 1,000 players and writes nothing per player.
- A game with owner-only fields is never handed to a Gate whole.
- Rates, `room.rates`, and the diagnostics object answering without asking the room.

In real `workerd` (`gates-workerd.test.mjs`): 40 players behind five Gates each receive
the world with their own body in it, and the diagnostics object reports every one of them
without the room being asked.

Not proven: anything about Cloudflare at 300 or 1,000 players. Load runs on the computer
this was written on are not evidence either way; it was running other heavy work. Two
runs of the local reproduction at 300 players (`npm run test:rules:extended`), with the
computer's load average at 5 and then 16, admitted and kept all 300 at 20.0 ticks a
second, delivered 19.5 and 19.1 frames a second and acknowledged input in 209 and 252 ms
at p95, against a budget of 162: failures, on a computer whose own processes took 28 to
165 ms to answer each other. The probe's sockets read 194 MB for 1,113 MB of frames, so
compression is worth 5.7 times on this game.

## What the next trial needs

The connection it runs from decides what it can show. At 1,000 dense players this game
sends each one about 2.7 KB a frame before compression, 53 MB a second in all. The run
script measures the link before each step and marks a step whose delivered bytes reached
the link's capacity. For those steps the numbers to read are the server's own: the room's
ticks a second, the time an input took from a Gate to the rules, and the frames each Gate
wrote to each player.
