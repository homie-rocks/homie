# Homie netplay contract, v1 (revision 5)

Status: **v1, revision 5** (2026-10-01, `@homie-rocks/studio` 0.15.0). The wire version is
`v: 1`. Everything revisions 2 to 5 added is either an optional field, a new message type,
a new refusal, or a change of pace inside the old caps, and both sides ignore types they do
not know. A change to the contract bumps `v` and keeps v1 working.

**What revision 5 added** (a v1 game that knows none of it is watched as its overview):
- **Watching** (section 16): a watcher is a screen that came to watch a live room from any
  player's view. It never takes a seat, hosts only a room no player can, and the game draws
  the followed player's camera and HUD from `net.viewSeat`. Auto follows the action
  (`net.spotlight(seat)`, else the leader of the `scores` probe).
- New optional fields `hello.watch`, `welcome.watch` and `peer.watch`, a relay → client
  `watch` frame, the final refusal `watch-off`, and `counts.watchers` in the watch feed.
- game.json `"watch"`: `"overview"` (hidden hands or roles: the whole room only) or `false`.
- `PALETTE`: the contract's 12 player colours, which a peer's `colour` indexes.

**What revision 4 added** (a v1 game that knows none of it keeps playing; its shell shows
the notices and the banner):
- **The owner's controls** (section 15): the studio's owner kicks a player out of a room
  for some minutes, mutes one, announces a line to everyone, closes a room, or changes its
  seats. Each is a control signed by the studio's Worker that the room verifies before it
  acts; no client can send one.
- New relay → client frames `announce` and `mute`, a `welcome.announce`, `peer.muted`, and
  two final refusals: `kicked` and `room-closed` (with `until`).
- The watch socket's `kicked`, `muted`, `announce` and `closed` frames, for the shell.

**What revision 3 added** (nothing on the wire changed; every v1 game plays on it):
- **Rooms of up to 32 seats**, sized by the game's netplay manifest (section 3).
- **One address may hold every seat plus four sockets** (section 6), so a party on one
  Wi-Fi fills a 32-seat room with a TV beside it.
- **The checkpoint, round and roster caps double for 17–32 seats** (section 6): a
  32-seat courier game's checkpoint measured 56 KB against the 64 KB cap.
- **Idle input keepalive** in the helper: an unchanged input frame goes out at most four
  times a second (section 11).
- Measured cost and free-plan headroom of a 32-seat room (section 11).

**What revision 2 added:**
- Interpolation measures transit time.
- A body-control table: reset, take, give, ack, and a host-movement mode with
  prediction.
- A keyed state channel for slow world state.
- Seats cannot be locked by visitors who left, and spectators get the next free seat.
- The relay clamps `st`, presses and event rates, and caps sockets per room and per
  address.
- A frozen host or replica is detected and replaced.
- A deploy keeps seats, host and round.
- Events can be addressed to one peer.

| File in `@homie-rocks/studio` | What it is |
|---|---|
| `netplay/NETPLAY.md` | This document. |
| `netplay/netplay.ts` | The game-side helper, imported as `@homie-rocks/studio/netplay`. One file, no dependencies. |
| `worker/room.mjs` | The relay's rules, with no transport. It needs no Node built-ins. |
| `worker/index.mjs` | The studio's site Worker: `room.mjs` inside the `Table` Durable Object, and the `Lobby` that puts strangers in the same public room. `homie-studio dev` runs the same code under `wrangler dev`. |
| `starters/gem-rush/` | Gem Rush, the reference game (canvas, about 700 lines). It has both movement modes. |

---

## 1. The shape

Every browser, phone or computer, loads the full game and renders it with its own
camera and HUD. The relay is the room's Table Durable Object (under `wrangler dev`
locally). It is a post office that remembers the last few letters, and it runs no game
code.

```
           snap 20 Hz (fast state + control table)        fan-out
  HOST  ────────────────────────────────────────▶ RELAY ─────────────▶ REPLICA / SCREEN
  rules, bots,  ◀── in 20 Hz (avatar or intent) ─ (memory; ◀─ in ────  own body: moved locally,
  clock         ─── state k=v (slow, on change) ▶  storage   ─ state ─▶  or predicted; others
                ─── ckpt 1 Hz ──────────────────▶  only for             interpolated from
                                                   seats and            snapshots
                                                   a 30 s ckpt)
```

- **One browser is the host.** It runs the rules: pickups, scoring, the clock, hits,
  bots and round end.
- **Every seated body has a control entry**, kept by the host and carried in every
  snapshot (section 8):
  - `rs`: a reset epoch;
  - `own`: who moves the body right now;
  - `ack`: the last input the host had.

  In **owner movement** the seat's own browser moves its body instantly, and the host
  bounds it. In **host movement** the host's rules move the body from the seat's
  intents, and the seat predicts its own body. The host can **take** any body, for a
  knockback, a carry or a stun, and **give** it back.
- **Three channels by change rate:**
  - **Snapshots** (20 Hz) carry fast state: live bodies and projectiles.
  - **Keyed state** carries slow state: claims, doors, a scoreboard, zones. It is sent
    only when it changes, kept by the relay, and handed to every joiner in its welcome.
  - **Checkpoints** (1 Hz, relay memory) carry everything a new host needs.
- **The host migrates.** If the host leaves, stalls or freezes, the relay promotes
  another browser. That browser gets the checkpoint, the newest snapshot, the state,
  the round and the roster, and continues the same round.

## 2. Roles

| Role | Who | Runs rules | Has a body | Sends | Receives |
|---|---|---|---|---|---|
| `host` | One browser per room | yes | if seated (a seatless host is possible) | `snap`, `state`, `ckpt`, `round`, `roster`, `ev` | `in`, `ev`, `join`, `leave` |
| `replica` | Every other seated browser | no | yes | `in`, `ev` | `snap`, `state`, `ev`, `round`, `roster`, `join`, `leave`, `seat` |
| `screen` | A spectator (a TV or laptop with `?screen=1`, a watcher from the game's watch door, or a visitor waiting for a seat) | no | no | `ev` (2/s, 512 B) | the same as a replica |

- **Role and seat are separate facts.**
  - `net.isHost` answers: do I run the rules?
  - `net.seat !== null` answers: do I have a body?
  - A screen can be elected host when nobody else can host.
- **A watcher** (section 16) is a screen that never takes a seat: not at its hello, and not when
  one frees up. A visitor who wanted to play and found the room full is the other kind of screen:
  it takes the next free seat.
- **Offline is not a fourth role.** With no shell (a plain file, a Vite dev server),
  the helper reports `role: 'host'`, `seat: null` and `offline: true`, and every send
  is a no-op.
- **Roles change at any time.** A game must handle all three cases:
  - its first role;
  - promotion (a replica becomes host);
  - demotion (a stalled, hidden or frozen host becomes a replica).

## 3. Seats

| Fact | What it is | Notes |
|---|---|---|
| `seat` | An integer from 0 to `maxPlayers - 1`, stable per browser per room | The player identity. `null` for screens. |
| `token` | The capability that resumes a seat | Returned in `welcome` and never shown to others. The shell keeps it in `sessionStorage`. |
| `id` | One socket | Used for routing, event addressing and the host reference. It changes on every reconnect. |
| `name` | Display name | Typed by the guest, so untrusted: render it with `textContent` only. |
| `colour` | `seat % 12` | An index into the contract's 12 colours, `PALETTE` (the watch page's strip draws them; a game that colours its players by seat matches it). |

- **Every visitor gets a seat at once**, phone or desktop. There is no gathering.
- **Room size.** `maxPlayers` comes from the game's netplay manifest: game.json's
  `netplay.maxPlayers`, or a `netplay.json` beside game.json or in the game's build
  (`maxPlayers` or `players.max`), else game.json's `players.max`, else 8. **A room holds
  at most 32** (`SEAT_MAX`). `homie-studio build` writes the number into the catalogue and
  the site's Table takes it from there; the first visitor of an empty room may lower it
  (`hello.max`), never raise it.
- **A dropped seat is held 60 s** for its token, which covers a reload or a network blip.
  **A visitor who is present beats one who left:** when no seat is free, the relay
  reclaims the seat that has been absent longest. Visitors who leave can never lock a
  room.
- **A full room** admits the visitor as a waiting spectator (`full: true`). When a seat
  frees up, the relay seats them:
  - the new player gets `seat { seat, token, name, colour, role }`;
  - everyone else gets `join` with the new peer.

  The helper turns this into a role event with `why: 'seated'`.
- **The same seat opened twice** (two tabs, or a reload racing its own close): the newer
  socket wins, and the older one gets `error replaced` and stops reconnecting.
- **A reload lands in the same body.** `Roster.claim()` gives a returning seat the slot
  it last held, if that slot is still a bot. During the second or so of a reload, a bot
  keeps the body moving.

## 4. Lifecycle

**Instant start.** The first browser is elected host in its `welcome` and starts round 1
at once, with bots filling the slots (Gem Rush: 1 human + 2 bots).

**Bots yield to humans.** The host's `Roster` keeps the slots.
- A human who arrives (`join`) takes a bot's body where it stands; the host calls
  `net.reset(seat)` so that browser adopts it.
- A human who leaves turns back into a bot in the same body.
- `trim()` removes surplus bots between rounds.
- After every change the host calls `net.roster(slots)`.

**Join in progress.**
1. The `welcome` carries the last snapshot, round, roster and **all keyed state**. The
   joiner draws the running world on its first frame.
2. The host claims a slot and resets the body.
3. The joiner's first snapshot carries its control entry, so it adopts its body.

A solo host sends one snapshot a second, so even a joiner's first welcome has a world in
it.

**Continuous rounds.**
- The host announces each phase with `net.round({ n, phase, startedAt, endsAt, results? })`.
  All times are server milliseconds.
- `live` runs until `endsAt`. Then `over` (with `results`) runs until the intermission
  ends, and then round `n + 1` starts.
- Round numbers only increase, including across host changes.

**Host election.**

| Event | What the relay does |
|---|---|
| No host | The first `canHost` hello becomes host. |
| The host closes or says `bye` | Sends `leave`, then elects a replacement. |
| **Stall:** the host has sent no snapshot for **1.5 s** while others are present | Demotes it (`role replica, why host-stalled`) and elects another. |
| **Frozen host at a newcomer's hello:** the host is hidden, or has sent nothing for 2.5 s | Makes the newcomer host at once. The old host gets `role replica`. |
| **Hidden tab** | The helper sends a checkpoint, then `yield`. `ping {hid: true}` has the same effect. |
| **Silent socket:** nothing received for **10 s** | Closes it (a slept phone, a half-open link). The seat's body turns into a bot. The helper pings every 2 s. |

- **Ranking candidates:**
  1. visible before hidden;
  2. responsive before silent;
  3. longer tenure first, in 30 s steps, so a newcomer cannot jump the queue by
     calling itself a desktop;
  4. `desk` > `tv` > `phone`, as a tie-break;
  5. whoever arrived first.
- **The new host** gets
  `role { role: 'host', why, ckpt, snap, round, roster, state, peers }`. Everyone else
  gets `host`.
- **No voluntary migration back.** A former host that wakes up or reconnects comes back
  as a replica.

**The helper's side of liveness.**
- A socket that has delivered nothing for 6 s (pongs come every 2 s) is dropped and
  reopened with the token.
- A hidden tab reconnects when it becomes visible again.

**Empty rooms and deploys.**
- An empty room forgets everything after 60 s, and clears its storage.
- If the relay restarts with sockets connected, as a Worker deploy does, every browser
  reconnects with its token and gets the **same seat**. The seat that was host gets 3 s
  to reclaim the role.
- A host that reconnects as host re-sends its round, roster, state and a checkpoint.
- If the old host does not return, the relay elects someone else. That browser restores
  from the stored checkpoint (at most 30 s old) and from its own newest snapshot.

**What a room is not.** A room forgets everything 60 s after its last player leaves (`forgetMs`). Progress that
must last (a character, unlocks, days of play) is the player's, not the room's: it goes in cloud saves
(`@homie-rocks/studio/saves`, `../saves/SAVES.md`). The host decides what happened and tells that player's own
browser (an `ev` to its seat); only that browser changes and saves the player's progress.

## 5. Wire protocol v1

- **Transport:** one WebSocket per game document, carrying JSON text frames
  `{ "t": <type>, ... }`. The first client frame must be `hello`. Unknown types are
  ignored in both directions.
- **Addresses:**
  - a studio site: `wss://<host>/<game>/__net?room=<room>`;
  - `homie-studio dev`: `ws://127.0.0.1:8787/<game>/__net?room=<room>`.

  The shell puts the address in `window.HOMIE_NET.url`, so the game never builds it.

### Client → relay

| `t` | Sent by | Fields | What the relay does |
|---|---|---|---|
| `hello` | everyone, once | `v: 1`, `token?`, `name?`, `device`, `want: 'play'\|'screen'`, `canHost`, `game?`, `max?`, `watch?` (revision 5) | Seats the client (or queues it), picks a role, replies `welcome`, and sends `join` to the others. Refuses with `version`, `room-full`, `too-many` or `watch-off`. A `watch: true` hello is a watcher (section 16). |
| `snap` | host | `k`, `st`, `d`, `c?` (control table) | Clamps `st` to [now − 2 s, now + 250 ms] (a snapshot stamped in the future would freeze replicas). Stores the snapshot and fans it out with `from`. Skips a socket with more than 256 KB buffered. |
| `in` | seated non-host | `q`, `a`, `h`, `p?`, `r` (the reset epoch the sender has adopted) | Forwards to the host only, stamped `from: <seat>`. Presses are clamped to integers 0–8, at most 16 keys. |
| `ev` | anyone | `k`, `d`, `to?` | **From a muted player** (section 15): a speech kind (`say…`, `chat…`, `emote…`) is dropped. **From the host:** to everyone else, to one seat (`to`: number) or to one peer (`to`: id string, such as a screen). **From anyone else:** to the host, with `from` and the sender's `id`. **Best-effort:** a drop over a cap is reported with `error rate`. |
| `state` | host | `k` (≤ 64 characters), `d` (`null` deletes) | Stores the key in memory, forwards it to all others, and includes the whole map in every `welcome` and in `role` to a new host. |
| `ckpt` | host | `k`, `st`, `d`, `c?` | Stores it in memory. It is saved to storage at most every 30 s. Not forwarded. |
| `round` | host | `round` | Stores it, forwards it, and tells the shell's watchers. |
| `roster` | host | `slots` | Stores it, forwards it, and tells the shell's watchers. |
| `ping` | everyone | `c`, `hid` | Replies `pong`. A host whose `hid` turns true yields. |
| `yield` / `bye` | host / anyone | — | `yield` elects another host if one is available. `bye` is a close. |

### Relay → client

| `t` | To | Fields |
|---|---|---|
| `welcome` | the new client | `v`, `id`, `room`, `seat`, `token`, `name`, `colour`, `role`, `why: 'first'\|'resumed'\|'joined'\|'host-stalled'\|'host-hidden'`, `host`, `peers`, `st`, `max`, `round`, `roster`, `snap`, **`state`**, `ckpt` (host only), `full?`, `watch?: { follow, why? }` (a watcher only) |
| `role` | a client whose role changed | `role`, `why`, `host`, `peers`. For a new host, also `ckpt`, `snap`, `round`, `roster`, `state`. |
| `seat` | a waiting spectator that just got a seat | `seat`, `token`, `name`, `colour`, `role` |
| `host` | everyone else, on a change | `host`, `why` |
| `join` / `leave` | everyone else | `peer` / `id`, `seat`, `why: 'closed'\|'bye'\|'replaced'\|'silent'\|'flood'` |
| `snap` | everyone but the host | `from`, `k`, `st`, `d`, `c?` |
| `in` | the host | `from`, `q`, `a`, `h`, `p?`, `r?` |
| `ev` | as routed | `from`, `k`, `d`, and `id` on events to the host |
| `state` | everyone but the host | `k`, `d` |
| `round` / `roster` | everyone but the host | `round` / `slots` |
| `pong` | the pinger | `c`, `st` |
| `error` | the offender | `code`, `message`, `of?`, `until?` |
| `announce` | everyone (and in `welcome.announce`) | `id`, `text` (`null`: taken down), `at`, `until`, `from: 'studio'` (section 15) |
| `mute` | everyone | `id`, `seat`, `until` (`0`: unmuted) (section 15) |
| `watch` | one watcher | `follow`, `why?` (`overview`, `seated-here`): whether it may follow one player now (section 16) |

**Error codes.**
- Final (the helper stops reconnecting): `version`, `replaced`, `room-full`,
  `too-many`, `kicked`, `room-closed` (the last two with `until`, server ms; section 15),
  `watch-off` (a watcher of a game that cannot be watched; section 16).
  The helper before revision 4 does not know `kicked` and `room-closed` and keeps knocking;
  every knock is refused at `hello`, and the shell stops the frame (section 15).
- Reported only: `too-large`, `rate`, `state-full`. (`flood` closes the socket; the helper
  comes back slowly.)

A socket that is kicked for silence is closed with code 4000, and the helper reconnects.

Record types:

```ts
Peer        = { id, seat: number|null, name, colour, device, want, role, muted?: true, watch?: true }
RoundInfo   = { n, phase: 'live'|'over', startedAt, endsAt, results?: RoundResult[] }   // server ms
RoundResult = { slot, seat: number|null, name, score, bot, place }
Slot        = { slot, seat: number|null, name, bot }
ControlWire = [seat, rs, own (1|0), ack]    // one per present seat, in snap.c and ckpt.c
```

**The shell's watch socket** (`/<game>/__watch?room=&b=`) gets
`{ t:'net', room, host, clients, round, roster, snapHz, openedAt, announce, closedUntil?, counts: {players, screens, waiting, watchers, humans, bots, maxPlayers}, memory: {snapBytes, ckptBytes, ckptAgeMs, stateKeys, stateBytes}, stats }`
about once a second and on every change, and the owner's controls as they happen
(section 15): `announce` (the same frame the game gets), `closed { until, message }`, and,
only for the browser they are about (its room key `b`), `kicked { until, message }` and
`muted { until }`. A watch socket that opens on a closed room, or from a browser that is
held out of it, hears so at once.

**Game frame → parent page** (`postMessage { t: 'homie-net', what, ... }`). The values of
`what` are:
- `attached`, `token`, `role`, `stats` (2 Hz), `round`, `roster`;
- `closed` (with `why`: `replaced`, `version`, `room-full`, `too-many`, `kicked` or
  `room-closed`, and `until` and `message` for the last two);
- `pick` (with `seat`): the game's `net.pickPlayer(seat)`, a player clicked. Only the studio
  owner's page does anything with it (section 15).
- `view` (a watcher; section 16): `seat`, `following`, `follows` (the game draws the followed
  player), `canFollow`, `whyNot`; and `scores` (`[{ seat, score }]`, once a second, from the
  game's `scores` probe).

**Parent page → game frame** (revision 5): `postMessage { t: 'homie-watch', follow: seat | 'auto' | null }`.
The helper takes it only from its own parent window, and only as a watcher.

The shell must check `ev.source === frame.contentWindow`. The frame is an opaque origin,
so `ev.origin` is `"null"`.

## 6. Size and rate budgets

| Frame | Target | Relay hard cap | Rate | Relay cap per client per second |
|---|---|---|---|---|
| `snap` | **< 2 KB, < 8 KB always** | 16 KB → `too-large` | 20 Hz (1 Hz while the host is alone) | 30 |
| `in` | < 256 B | 2 KB | 20 Hz, plus an immediate flush (≤ 60 Hz) on a press edge | 60 |
| `ev` | < 1 KB | 4 KB (512 B from a screen) | as needed | host 30, replica 10, screen 2 |
| `state` | < 2 KB per key | 8 KB per key; **64 keys and 64 KB per room** → `state-full` | only on change | 64 |
| `ckpt` | < 32 KB | 64 KB (128 KB for 17–32 seats) | 1 Hz | 4 |
| `round` / `roster` | < 2 KB / < 1 KB | 8 KB / 4 KB (16 / 8 KB for 17–32 seats) | on change | 4 / 8 |
| `ping` | — | 256 B | every 2 s | 8 |

**Sockets.**
- At most `maxPlayers + 16` per room, and per client address per room **12, or every seat
  plus four when that is more** (`perAddress`: 12 for 8 seats, 20 for 16, 36 for 32). The
  Worker passes `CF-Connecting-IP` as `conn.ip`. Measured before revision 3: 32 visitors on
  one address got 12 seats and 20 `too-many` refusals.
- A client dropping more than 100 messages over the caps within 5 s is closed (`flood`).

**Keep it small.**
- Arrays per entity, and quantised floats (`q(x, 1)`).
- Never send idle slots.
- Slow state goes in `net.state()`, never in the snapshot.
- Host-only bookkeeping goes only in the checkpoint.

**Measured size.** Gem Rush snapshots are 364–427 B at 20 Hz.

## 7. Clock sync and interpolation

- **Clock.**
  - Pings measure `rtt = recv - c` and `offset = st + rtt/2 - recv`.
  - The helper keeps the minimum-RTT sample of the last 8.
  - It slews small corrections by ±5 ms per sample and jumps corrections over 100 ms.
  - `net.now()` is the relay's clock, and every time on the wire is server
    milliseconds.
- **Interpolation delay is measured, not assumed.** For every snapshot that comes off
  the wire, the helper records its **arrival age**, `now() − st`. That age is transit
  from host to relay to replica, plus any error in the clock offset. The delay is:

  `delay = clamp(p90(age over the last 40 snapshots) + 1.2 × snapshot interval + 4 ms, 50, 400)`

  - It rises by up to 6 ms per snapshot.
  - **On an underrun** (a `sample()` past the newest snapshot) it grows at once by
    exactly the overrun, up to 30 ms a frame. The picture was holding on the newest
    snapshot anyway, so nothing jumps back, and the next snapshots continue smoothly
    instead of catching up.
  - It falls by 6% of the excess per snapshot, and at least 3 ms. So boot-time jank
    clears in about a second, and nobody sees the time-warp.
  - A snapshot processed in the same burst as the one before it is skipped as an age
    sample. It waited behind the page's own stall, not on the network.
  - Clock error cancels out, because render time uses the same `now()`.
- **Measured.**

  | Link | Starved frames | Delay | Age p90 |
  |---|---|---|---|
  | 30–50 ms one way (end-to-end run, both replicas) | 0 of 241 | 148–157 ms | 84–93 ms |
  | Same link, an independent reviewer's script | 5 of 241, worst 2 ms | 167 ms | — |
  | Revision 1's formula, the same script | 102 of 241 (42%), worst 79 ms | 108 ms | — |
  | Loopback | 0 | 65 ms (the floor is 50) | 1 ms |

  On an overloaded machine (load average 14–18 on 10 cores), one run starved on 10–13%
  of frames: arrival ages reached a p90 of 326 ms, and one page went 369 ms without
  processing anything.

  "Starved" means the render time ran past the newest snapshot.
- **Safety.**
  - A snapshot stamped more than 1 s ahead of `now()` is rejected, and the relay clamps
    `st` too.
  - On a host change, the buffer rebases onto the new host's timeline, so a clock a
    little behind the old host's is not dropped.
- `net.sample()` returns `{ a, b, alpha, renderT, starved }`. Interpolate per entity
  with `lerp` / `lerpAngle`. `stats().starvedPct` reports how often it held.
- **Your own body is never interpolated.** It is moved locally in owner movement, or
  predicted in host movement.

## 8. Moving bodies: the control table

The host keeps one entry per seat and puts it in every snapshot and checkpoint as
`c: [[seat, rs, own, ack], ...]`. The helper maintains it; the game calls these:

| Host call | Meaning |
|---|---|
| `net.reset(seat)` | "I moved this body myself" (spawn, respawn, takeover of a bot, anti-cheat). It bumps `rs`, and the seat adopts the host's position. |
| `net.take(seat, ms?)` | "I drive this body now" (knockback, carry, grab, stun). The seat's avatar is ignored. With `ms`, the body is given back automatically. |
| `net.give(seat)` | Returns the body to the room's movement mode where it now is. It bumps `rs`. |
| `net.avatar(seat)` | The owner's avatar. It is `null` while the body is taken, in host movement, or when the frame predates the last reset. |
| `net.inputOf(seat)` | The latest raw frame: intents, buttons, and the raw avatar. |
| `net.control(seat)` | `{ rs, own, taken, ack }` |

| Replica side | Meaning |
|---|---|
| `on('control', e)` | Fires when my entry changes. `e.reset`: stand where `e.snap` has my body, and drop prediction. |
| `net.owned` | `true` while my browser moves my body. |
| `net.input(a, held)` | Called every frame. It is stamped with my `rs` automatically. |
| `net.pending()` | My input frames the host had not acknowledged in the newest snapshot, as `[{ q, a, h, at, dt }]`. |

**Two movement modes.** `createNetplay({ movement })` sets the default for every seat.

- **`owner`** (the default; Gem Rush).
  - The seat's browser simulates its own body and sends it every frame.
  - The host bounds it with `capMove(from, claim, maxSpeed × dt × 1.3 + slack)` every
    host frame. A legitimate avatar catches up within a frame; a teleport crawls.
  - When a claim is more than half a second of running away from the host's copy, the
    host calls `reset()`. A cheater then either adopts the host's position or is
    ignored. Measured end to end: a raw-socket cheater that follows the protocol but
    claims gem positions scores **0–2 points in 3 s**, with 14 resets (revision 1:
    61 points).
- **`host`** (any game whose rules own movement).
  - The seat sends **intents**. The host's rules move the body.
  - The seat's browser **predicts**:
    1. it moves the body locally from its live stick, using the same rule as the host;
    2. when a snapshot lands, it takes the host's position, replays `pending()` on top,
       and pulls 30% of the way toward that (or jumps if the error is over 150 units).
  - Positions in `in` are never read, so there is nothing to teleport.
  - Measured end to end at 30–50 ms one way:
    - own response 11.7 ms (touch 16.8 ms);
    - the host sees the move in 127 ms;
    - the replica's own view converges to the host's view within 0.02 units;
    - a raw-socket cheater scores 0.

**Knockback, hitstun, carries, grabs.** The host calls `take(seat, ms)` and simulates the effect itself. The owner
draws its body as the host has it; with prediction it stays smooth, and its input is
ignored. When the effect ends, the host gives the body back and the owner resumes from
the host's final position. The victim cannot ignore a hit, because the host holds the
pen. An impulse is simply a `take` whose effect the host simulates.

Measured, with Gem Rush's bump (owner movement, 30–50 ms one way):
- taken 110 ms after the hit;
- held 415 ms;
- displacement 168 units;
- after the give, the owner and the host agree within 0 units (host movement: 1 unit);
- the owner moves again locally in 16.6 ms.

## 9. Checkpoints and promotion

- **`createNetplay({ checkpoint: () => fullState })`.** The helper sends it every
  `checkpointMs`, before `yield`, and on `pagehide`, wrapped with the control table.
- **The checkpoint holds everything the rules need:**
  - round and roster;
  - every body (position, score, bot brain), plus host-only bookkeeping;
  - world state;
  - the tick.

  It does not need what is already in the keyed state.
- **On promotion, `role` carries** `ckpt` (up to 1 s old, complete), `snap` (up to 50 ms
  old, newer), `round`, `roster` and `state`. If the relay has no snapshot (for example,
  just after a restart), the helper hands over its own newest one, if it is under 5 s
  old.
- **Restore in this order:**
  1. Take the checkpoint.
  2. Overlay the snapshot.
  3. Read keyed state with `net.stateOf()`.
  4. Take `round` if it is newer.
  5. Call `roster.reconcile(peers)`, then `reset()` every claimed seat.
  6. Set your own body to your local one.
  7. Call `net.roster()` and continue.

  The helper rebuilds the control table itself, and a body taken mid-knockback is given
  back.
- **What can be lost:** whatever changed after the newest snapshot (about 50 ms of
  pickups or events). Rounds, clocks, scores, roster and state survive.

## 10. What the shell does, and what the game does

### The shell (the site's play page and Table: `worker/` in this package)

1. **Seat every visitor at once**, phone and desktop, with no `gather`.
2. **Boot the game frame immediately.** Use the sandboxed, opaque-origin frame, and
   inject `window.HOMIE_NET = { v: 1, url, room, token?, name?, device, want }` ahead of
   every module.
3. **Serve the game's own files** beside the shell (`/<game>/__game/`), with `HOMIE_NET`
   in its `index.html`.
4. **Answer the arcade knock.** A game made with Homie's arcade controls asks
   `GET …/__homie/call` for a Homie host; answer `{"error":"not-a-homie"}` so it stops.
5. **Pass the remembered token in** (`?k=`), and save the token from `homie-net token`
   per room.
6. **Relay exactly as `worker/room.mjs` does.** The Table:
   - keeps `lastSnap`, `lastCkpt`, `lastRound`, `lastRoster` and `state` as fields;
   - **saves** the seat map and host seat whenever a seat is allocated or the host
     changes, and the checkpoint, round, roster and state at most every 30 s (`store.save`,
     one write each time);
   - **restores** in `blockConcurrencyWhile`;
   - **never** writes a netplay frame to storage.

   `worker/index.mjs` is the working shape. Worth adding for a busy site:
   - use hibernatable sockets (`ctx.acceptWebSocket`, with `serializeAttachment` for id,
     seat, token, device, want, joinedAt);
   - call `tick()` from an alarm;
   - pass `CF-Connecting-IP` as `conn.ip`;
   - take `maxPlayers` from the manifest;
   - use separate storage keys, or a SQLite-backed object, if a save can pass 128 KiB.
7. **Choose the device** with the short-edge rule (≤ 540 px is a phone; `?hand=`
   overrides). `?screen=1` makes a spectator that shows a QR code to the game URL.
   `/<game>/watch?room=` makes a watcher, with a strip of the players (section 16).
8. **Show room facts** from the watch feed or the frame's messages: the lobby line,
   results, and with `?debug=1` the debug strip.
9. **One matcher:** every Play door for a game lands in the same rooms (the `Lobby`).

### The game (a vendored `netplay.ts`)

1. **Call `createNetplay({ game, maxPlayers, movement, checkpoint })` once** and render
   from the first frame. Never wait for `ready`.
2. **Handle `role` at any time.**
   - Promoted: restore (section 9).
   - Host but not promoted: start a fresh round.
   - Demoted: stop the rules.
3. **As host, every frame:**
   - run the rules and bots;
   - move bodies from `avatar()` with `capMove`, or from intents;
   - `if (net.snapshotDue()) net.snapshot(fast, tick)`;
   - `net.state(k, v)` when slow state changes (it dedupes);
   - `round()` and `roster()` on changes;
   - `Roster` on `join` and `leave`, with `reset()` on each claim.
4. **When seated:** call `net.input([...avatar, ...intent], held)` every frame. Adopt
   your body on `control` with `reset`. While `!net.owned`, predict (section 8).
5. **Render others** from `net.sample()` and your own body locally. A spectator gets an
   overview camera. **Draw from `net.viewSeat`** (section 16): your own seat when you play,
   the followed player's body, camera and HUD when you watch, the overview when it is `null`;
   call `net.spotlight(seat)` on a hit or a goal, and expose `scores` for Auto and the strip.
6. **Draw your own HUD**: clock (`round.endsAt − net.now()`), scores, results.
7. **Touch controls on phones:** a drag in the lower-left moves you. On desktop,
   WASD and the arrow keys.
8. **Expose probes** for end-to-end tests:
   `net.expose({ self, peer, frames, scores?, zone?, owned?, debugKnock? })`.
9. **Never gate the first frame on a tap.**

## 11. Cost (Cloudflare Durable Objects)

- **The Table does three things:** fan-out, memory and elections.
- **No storage write per snapshot, input, event or state change.**
- **Storage writes are made:**
  - per seat allocation or host change (rare);
  - at most one checkpoint save per 30 s (≈120 writes/h, ≈ $0.0001/h at $1/M).
- **One busy room** (1 host + 3 replicas at 20 Hz): about 83 incoming messages/s, which
  is ≈ 15 k requests/h at 20:1, or **≈ $0.002/h**. Duration (128 MB × 3600 s) is
  **≈ $0.006/h**. **Total ≈ $0.008 per active room-hour.** Outgoing messages and egress
  are not billed. There is no TURN server and no media relay.
- **Idle cost.** A socket that sends anything every few seconds keeps the object awake.
  - A room with one idle visible tab costs the same ≈ $0.006/h, about $4 a month if
    left open for good.
  - The port should use hibernatable sockets.
  - Games should close the helper (`net.close()`) after about 5 minutes with no local
    input and show "tap to rejoin".
  - The relay already closes sockets that go silent for 10 s.
- **The one mistake that would change this:** writing each snapshot to storage (72 k
  writes/h ≈ $0.07/h, 9× everything else), or rewriting a whole log per event.
- Re-check Cloudflare's published prices before quoting.

**A 32-seat room (measured 2026-09-30, `@homie-rocks/studio` 0.6.0).** Every incoming
socket message is a Durable Object request (billed 20:1; outgoing messages are free), and
in a full room the replicas' inputs are nearly all of them:

| 32 seats, one host | Incoming msgs/s at the relay | Requests/hour (20:1) | Free plan (100,000 a day) |
|---|---|---|---|
| every replica moving, input 20 Hz | ≈ 630 | ≈ 114 k | ≈ 53 room-minutes a day |
| a game's own vendored helper, input 30 Hz | ≈ 860 | ≈ 155 k | ≈ 39 room-minutes a day |
| half the replicas standing still, 0.6.0 helper | ≈ 415 | ≈ 75 k | ≈ 80 room-minutes a day |

  - Put another way, the free plan carries roughly **28 player-hours a day** at 20 Hz input
    (each seated player costs about one request a second). A studio that plays more than
    that a day needs Workers Paid ($5 a month), where a full 32-seat room-hour costs about
    $0.02 in requests plus $0.006 in duration.
  - **Idle keepalive (helper, 0.6.0):** an input frame identical to the last one sent (same
    avatar or intent, same held keys, no press, same reset epoch) is re-sent at most every
    250 ms. The host already holds that frame, so nothing it reads changes. A player standing
    still costs 4 messages a second instead of 20. A game that vendors its own copy of the
    helper gets this by updating that copy.
  - Keep `inputHz` at 20 unless the game needs more: 30 Hz costs 1.5× the requests.
  - Snapshots of a real 32-seat courier game (32 bodies plus the control table) were 1.1–1.7 KB at
    20 Hz: about 32 KB/s down per replica, 2 KB/s up. No snapshot delta or compression was
    needed; the 2 KB target and 16 KB cap hold at 32 seats. Duration (13,000 GB-s a day free)
    covers one busy room all day.

## 12. Trust and safety

- **The host is a visitor's browser.** A modified host could fake scores. That is
  accepted for casual rooms. Leaderboard writes that matter should be recomputed
  server-side later.
- **The relay stamps `from` from the socket.** A replica cannot send `snap`, `ckpt`,
  `state`, `round` or `roster`.
- **The relay clamps** `st`, presses (0–8), key names (32 characters), event sizes and
  rates, and sockets per room and per address. It closes floods.
- **Hosts bound client state:**
  - `capMove` for owner movement;
  - an intent is at most full stick in host movement;
  - frames with a stale `rs` are ignored by `avatar()`.
- **Election ranks tenure above self-reported device**, so a raw socket calling itself
  `desk` cannot jump the queue.
- **Names and guest text are data.** Render them with `textContent`, never as markup,
  and never read them as instructions.
- **Only the studio's owner moderates a room** (section 15): a kick, a mute, an
  announcement or a closed room is a control the studio's Worker signs and the room
  verifies; no visitor's socket can send one.

## 13. Using it

```ts
import { createNetplay, Roster, capMove, q, lerp } from '@homie-rocks/studio/netplay';

const net = createNetplay<Snap, Input, Ckpt>({ game: 'my-game', maxPlayers: 8, movement: 'owner', checkpoint: () => fullState() });
let roster = new Roster({ min: 3, max: 8, botName: (i) => `Bot ${i + 1}` });

net.on('role', (e) => {
  hosting = e.role === 'host';
  if (!hosting) return;
  if (e.promoted) restore(e.ckpt, e.snap, e.round, e.roster, net.stateOf('world'));   // section 9
  else freshRound((e.round?.n ?? 0) + 1);
  for (const s of roster.reconcile([...net.peers.values()]).claimed) if (s.seat !== null) net.reset(s.seat);
  net.roster(roster.toJSON());
});
net.on('join',  (p) => { if (hosting && p.seat !== null && roster.claim(p.seat, p.name)) { net.reset(p.seat); net.roster(roster.toJSON()); } });
net.on('leave', (p) => { if (hosting && p.seat !== null) { roster.release(p.seat); net.roster(roster.toJSON()); } });
net.on('control', (e) => { if (e.reset) standWhere(e.snap, net.seat); });          // adopt the host's position

function frame(dt) {
  if (net.owned) stepMyBody(dt); else predictMyBody(dt, net.latest(), net.pending());   // section 8
  if (hosting) {
    for (const b of seatedBodies()) {
      if (net.control(b.seat).taken) { stepKnockback(b, dt); continue; }
      const a = net.avatar(b.seat);                                                    // owner movement
      if (a) { const m = capMove(b, a, SPEED * dt * 1.3 + 6); if (m.over > SPEED * 0.5) net.reset(b.seat); else Object.assign(b, m); }
    }
    stepRules(dt);                                                                     // hits: net.take(victim, ms)
    if (net.snapshotDue()) net.snapshot(fastState(), tick);
    net.state('world', slowWorld());                                                   // sent only when it changed
  } else net.input([q(me.x), q(me.y), q(me.vx), q(me.vy), stick.x, stick.y], heldButtons());
  render(hosting ? authoritative : net.sample(), net.viewSeat);                         // camera + HUD: whose view (section 16)
}
net.expose({ self: () => me, peer: (seat) => positionOf(seat), frames: () => frameCount, scores: () => scoresBySeat() });
```

```sh
npx --no-install homie-studio game new my-game --from gem-rush --name "My Game"
npm run dev                                  # the studio's site at http://127.0.0.1:8787 (wrangler dev)
#   open http://127.0.0.1:8787/my-game/play in two browsers: they land in the same room
npx --no-install homie-studio check my-game --url http://127.0.0.1:8787
#   two fresh browsers (a computer and a phone) must share a room and finish a round
```

## 14. Known limits of v1

- **Replica-to-replica visibility goes through the host.**
  - Measured at 242–330 ms at an RTT of 70–110 ms. Host to replica is 196–217 ms.
  - The path: the input hop to the host, the host's snapshot interval, the transit to
    the other replica, and that replica's interpolation delay, which is sized so it
    does not starve.
  - Forwarding each replica's avatar straight to the other replicas would save about
    100 ms. It would cost a second stream per peer and a second trust rule. It is a
    candidate for v2, not in v1.
- **No lag compensation for hits.** A game can rewind a victim by the attacker's
  `rtt/2 + delay` itself.
- **No snapshot deltas.** They are not needed at the measured sizes (Gem Rush: 364–427 B;
  a 32-body courier game's snapshot: 1.1–1.7 KB).
- **A reload shows a bot in the player's body for about 1–2 s**, and then the player
  takes the same body back.
- **The host is a visitor's browser** (section 12).

## 15. The owner's controls (revision 4)

The studio's owner runs their live rooms from the studio's back office (`/_studio/office`,
the owner's overlay in their own game, `homie-studio office`, and the Homie MCP's owner
tools). The room's relay enforces five controls:

| `op` | Arguments | What the relay does |
|---|---|---|
| `kick` | `id` or `seat`, `minutes` (1–1440, default 10), `address?`, `message?` | Sends that player `error kicked { until, message }` and closes the socket (and the same browser's or account's other sockets in the room); everyone else gets `leave { why: 'kicked' }`, so the host turns the body back into a bot. The seat is freed at once. Until `until`, a `hello` from that seat token, that browser's room key, that player account, or (only with `address: true`) that network address is refused with `kicked`. |
| `mute` | `id` or `seat`, `minutes`, `off?` | Everyone gets `mute { id, seat, until }` (`until: 0` with `off`), and the peer carries `muted: true`. Until then the relay drops that player's `ev` whose `k` starts with `say`, `chat` or `emote` (the speech kinds). A muted host's own speech is not dropped, because the host also relays everyone's; a game hides it with `net.isMuted(seat)`. The mute follows the seat token through a reload. |
| `announce` | `text` (one line, at most 280 characters; empty takes it down), `seconds` (5–3600, default 30) | Everyone and every watching shell gets `announce { id, text, at, until, from: 'studio' }`; a joiner gets it in `welcome.announce` until it ends. |
| `close` | `minutes`, or `seconds` (10 s up to a day), `message?`, or `reopen: true` | Every socket gets `error room-closed { until, message }` and is closed; the room forgets its play as an empty room does (section 4); watchers get `closed`. Until `until` every `hello` is refused with `room-closed`, and the Lobby sends nobody there. `reopen` opens it at once. |
| `seats` | `max` | The room's seats while it runs (the owner's "players per room"). Players already seated above it keep their seat; nobody new is seated there. Never above the room's own cap (the game's manifest). |
| `regate` | `allow` (holder kinds: `o` the owner, `i` an invite, `p` a player account), `notice?`, `message?`; no `allow` calls a waiting one off | A game's launch state narrowed (private, or an invite-only beta). The current round finishes first: the `notice` goes up as an announcement, and 5 s after the host's `round` with `phase: 'over'` (at the latest 20 s after its `endsAt`, or 30 s when no round is running; never later than 15 minutes) every socket whose ticket names no allowed holder gets `error room-closed { message }` (no `until`: they come back through the game's door if they have access) and is closed; its seat is freed and the others play on. A room with nobody to send out does nothing. The studio's Worker sends it to every live room the game's Lobby knows; a room that opens in the same moment reads its game's launch state once on its first heartbeat and re-gates itself the same way. |

**Signed by the studio, checked by the room.** A control reaches the relay only from the
studio's own Worker, as
`{ t: 'ctl', v: 1, op, game, room, args, at, exp, n, sig }`, where `sig` is an HMAC-SHA256
with the studio's office secret (random, in the studio's own D1) over every other field
(keys sorted). The room's Table refuses a control that is for another game or room, is past
`exp` (a minute after `at`), repeats an `n` it has seen, or does not verify; then
`room.mjs`'s `control(op, args)` applies it. The Worker signs only for the owner: their
signed-in browser (an HttpOnly session no page or game can read), or an office key from the
studio's own Cloudflare login, with which the owner's AI may announce at once but only asks
for a kick, a mute, a close or a launch change, which the owner confirms with one tap. No
client socket can send a control: a `ctl` frame on a game's socket is ignored.

**Who a socket is.** The Worker passes each socket's verified ticket holders to the room (`o`, `i-<invite>`,
`p-<player>`, or an invite and an account together, `i-…~p-…`): what `regate` keeps, and the account a kick holds.

**Who a kick holds out.** A seat token resumes a seat; a browser's **room key** (`b`) is a
random value the play page keeps in the site's own storage and passes in the frame's and
the watch socket's addresses, so a new tab of the same browser is held too. It says nothing
about who the player is, and the relay forgets it with the hold. Player accounts, where a
studio has them, add the account. A network address is held only when the owner asks
(a household or a carrier can share one).

**Holds outlive the room.** Kicks, mutes, the announcement and a closed door are kept apart
from the room's play (the Table's `office` storage key): an empty room forgetting its play
(section 4), a deploy and an eviction keep them until they end.

**Speech, for game makers.** Send chat, quick lines and emotes as `ev` whose kind starts with `say`, `chat` or
`emote` (`chat`, `say:gg`, `emote:wave`): a muted player's are then dropped by the relay with nothing more to do. Any
other way a game lets players talk (a typed sign, a name tag) should check `net.isMuted(seat)`.

**The game's side** (the helper, 0.13.0): `on('announce', a)` and `net.announcement` (draw
it your own way, or leave it to the shell's banner); `on('mute', m)`, `peer.muted` and
`net.isMuted(seat)` (hide a muted player's chat); `kicked` and `room-closed` are final, and
`closedWhy` says which; `net.pickPlayer(seat)` when a player's body or name is clicked
(the owner's page opens that player's card with Mute and Kick).

**The shell's side.** On `kicked` or `closed` (from its watch socket, or the frame's
`closed`) the play page stops the game frame (so a helper from before revision 4 stops
knocking), says what happened and when the player can come back, and offers another room
(the Lobby's `/api/lobby?not=<room>` never answers that room). It shows `announce` as one
line across the top until it ends, and tells a muted player so.

**Launch states** are the site's, not the relay's: a game that is private or an invite-only
beta gives each browser it lets in a signed ticket (`t`) for its frame and sockets, and the
Worker refuses a socket without one before it reaches the room.

## 16. Watching (revision 5)

A **watcher** watches a live room from any player's view. Nothing is streamed: the watcher's
own browser loads the game and receives what a replica receives (snapshots, keyed state, events
sent to everyone), and draws it with the followed player's camera and HUD. Every existing game
is watchable on day one as its spectator overview; a game that draws `net.viewSeat` lets the
watcher switch between the players.

**Who a watcher is (the relay).**
- The shell's watch door (`/<game>/watch?room=<room>&follow=<seat>|auto|overview`) boots the
  game with `HOMIE_NET = { …, want: 'screen', watch: true, follow, watchPolicy }`, and the
  socket's address carries `w=1`. A revision-5 helper also says `watch: true` in its `hello`.
  Either one makes the socket a watcher:
  - it **never takes a seat**, at its hello or later, whatever its hello asks for;
  - it **hosts only a room no player can host**: election ranks every visible, responsive
    player above it, and a watcher never deposes a frozen host at its hello;
  - its peer record carries `watch: true`, and the watch feed counts it (`counts.watchers`);
  - for every cap it is a screen: `ev` at 2/s and 512 B, one of the room's `+16` sockets.
- `welcome.watch = { follow, why? }` says whether it may follow one player's view, and a
  `watch { follow, why }` frame says so when that changes. `why` is `overview` (the game shows
  watchers the whole room only) or `seated-here` (this browser holds a seat in this room).
- A game whose game.json says `"watch": false` has no watch door: the Worker answers it with a
  page that says so and refuses a `w=1` socket (403), and the relay refuses a watching hello
  with `error watch-off` (final). The Worker passes the game's rule to the room with every
  socket (`wp=follow|overview|off`).

**What the game does (the helper).**

| Call | Meaning |
|---|---|
| `net.watching` | This browser watches. |
| `net.viewSeat` | Whose camera and HUD to draw: a player's own seat; the seat a watcher follows; `null` for the overview camera. Reading it (or listening for `view`) tells the watch page that this game draws the followed player. A game that never does is shown as its overview, and the page says so. |
| `net.on('view', ({ seat, following, prev, why }) => …)` | Whose view changed. `why`: `start`, `seat`, `asked`, `auto`, `left` (the followed player left; Auto takes over, and returns to them if they are back within 30 s), `back`, `policy`. |
| `net.follow(seat \| 'auto' \| null)` | Follow a seat, the action, or the whole room. The watch page's strip and keys call it through the frame; a game's own spectator UI may too. False when not allowed. |
| `net.spotlight(seat)` | Something happened to this player (a hit, a kill, a goal). A no-op except on a watcher in Auto. |
| `net.players()` | The seated players in seat order (key 1 is the first). |
| `net.following`, `net.canFollow` | What was asked; whether this watcher may choose. |
| `net.watchedSeat` | `viewSeat` without claiming the camera follows: for an overlay that only marks the followed player (the port's HUD). |

- **Auto** shows a player for at least 3.5 s, then cuts to the newest spotlight. With no action,
  every 12 s it looks at the leader of the game's `scores` probe
  (`net.expose({ scores: () => [{ seat, score }] })`; a tie keeps who is shown), else the next
  player in seat order. Nobody seated: the overview.
- **Keys** inside the frame, for a watcher who clicked into the game: 1–9 the n-th player in
  seat order, A Auto, O or 0 the whole room, ← → the previous or next player
  (`createNetplay({ watchKeys: false })` turns them off). The watch page answers the same keys.
- The helper tells its page `view` and `scores` (section 5) and takes `homie-watch` from its
  own parent window only.
- **Draw the followed player as that player's own browser frames them**: their body under the
  camera, their score or health in the HUD, their row marked as "you" is (with their name, never
  "You"). Their own body is interpolated like every other one; nothing of yours moves.

**Hidden information.** A watcher receives what any replica receives. What is private goes to
one seat (`net.send(kind, data, seat)`), so a watcher following that seat never has it. A game
whose shared state itself shows a hand or a role (cards, a traitor game) says game.json
`"watch": "overview"`: its watchers draw the whole room only and the strip only names the
players. `"watch": false` removes the watch door. Neither is a wall a modified browser cannot
climb, and neither needs to be: anyone may take a seat in a public room and receive the same
stream as a player. The rule decides what is offered and drawn.

**A second tab is not a peek.** A browser that holds a seat in a room watches that room in the
overview only (`seated-here`), for as long as its seat is there: the relay compares the
browser's room key (`b`, section 15), so a second tab cannot look over an opponent's shoulder
with a click. Another device is another watcher, as it would be another player.

**Launch states and the owner's controls.** The watch door is the play door: a private game or
an invite-only beta is watched only by whoever may play it, and their ticket rides in the
frame's and the sockets' addresses as it does for Play. A kick holds that browser out of
watching the room too (the same room key), and a closed room closes for watchers.

**Old games and old relays.**
- A game with a helper from before revision 5 is booted as a screen: it draws its overview, the
  Worker's `w=1` makes the relay treat it as a watcher, and the page lists the players without
  letting the watcher choose.
- A revision-5 helper on an older relay is a plain screen (no relay ever seated a screen); with
  no `welcome.watch`, following is the page's to allow.

**Cost.** A watcher is one more socket on the fan-out (outgoing messages are not billed) and one
ping every 2 s (a request, billed 20:1). Like a big screen, a watcher alone keeps a room's object
awake; the room's host of last resort is the watcher's browser, running the bots.

