# Idle rooms sleep

Before this change every server-hosted room ran its tick (a timer chain at the game's tick rate) and its relay beat
(every 250 ms) for as long as anybody was connected, whether or not they were playing. A Durable Object with a
pending timer cannot hibernate, so the room was charged for every second a page stayed open. Only the short break
between rounds slept.

Now a room whose people have all stopped playing rests: after `room.restSeconds` (60) with nothing held, pressed or
commanded, or ten seconds with every page in the background, the host saves the room, tells the browsers
(`{ t: 'rest', on: true }`) and clears every timer. The browsers ping the edge (`homie-ping`, answered without waking
the object) and send nothing else until a control changes. The object hibernates. The first input, command, page
brought back or new arrival wakes it on the tick it stopped at; a phone that reconnects with its token keeps its seat.

## The rooms

The Gem Rush starter (60 s rounds, 7 s breaks, three bots), built with `homie-studio build`, run by the real `Table`
from `@homie-rocks/studio/worker`, and played by scripted phones that say on the wire what the toolkit's client says
(`rig.mjs`): one phone with its page open and nobody touching it, four such phones, one phone whose page is in the
background, and one phone playing the whole time. After the idle stretch each room is woken: one phone drops its
socket and comes back with its token, then everybody plays for twenty seconds.

## Cloudflare (`cloudflare.mjs`, `cloudflare.json`)

Two throwaway Workers (main and this change) side by side, 15 minutes idle, figures from Cloudflare's own analytics
(`durableObjectsPeriodicGroups`) for the 14 whole minutes inside the idle stretch (840 s). Both Workers were deleted
afterwards; the script lookup answers 404 and no Durable Object namespace of theirs is left.

| Room | Active time before | after | GB-s before | after | CPU ms before | after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 phone, page open, idle | 751 s (89%) | 1.5 s (0.2%) | 96.2 | 0.19 | 8,818 | 259 |
| 4 phones, pages open, idle | 753 s (90%) | 3.8 s (0.5%) | 96.4 | 0.49 | 12,103 | 479 |
| 1 phone, page in background | 752 s (89%) | 1.2 s (0.1%) | 96.2 | 0.15 | 4,621 | 118 |
| 1 phone playing | 752 s (89%) | 752 s (89%) | 96.2 | 96.2 | 5,546 | 7,739 |

The remaining 11% before is the round breaks, which already slept. A resting room still wakes for a moment about
once a minute (its liveness sweep, an alarm), which is the 0.1 to 0.5% left. The playing room is unchanged: it ticks
the whole time. Every woken room gave the returning phone its own seat and snapshots resumed at the tick rate.

The minute in which the phones joined is not in the table: a room plays on for `restSeconds` before it rests, by
design, and Cloudflare reports that first minute under the joining minute. A 3-minute check run showed it at about
60 s of active time for every room in both versions, then 0.3 s a minute for a resting room.

## Local workerd (`measure.mjs`, `local.json`)

The same rooms in workerd (one process per room), 10 minutes idle, counting how long any timer was pending (a
pending timer is what keeps an object in memory) and how often the object was built again from storage (workerd
puts away an object that can hibernate about ten seconds after its last event).

| Room | Timer pending before | after | Rebuilt from storage before | after |
| --- | ---: | ---: | ---: | ---: |
| 1 phone, page open, idle | 89.6% | 9.2% | 0 | 8 |
| 4 phones, pages open, idle | 89.6% | 9.2% | 0 | 8 |
| 1 phone, page in background | 89.6% | 1.2% | 0 | 10 |
| 1 phone playing | 89.6% | 89.6% | 0 | 0 |

Here the window starts five seconds after joining, so the first minute of play before resting (9.2%) is included.

## Reproduce

```sh
node proof/idle-rooms/measure.mjs <built studio with games/gem-rush> <toolkit checkout> 10 local.json
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
  node proof/idle-rooms/cloudflare.mjs <built studio> <toolkit before> <toolkit after> 15 cloudflare.json <worker name prefix>
```
