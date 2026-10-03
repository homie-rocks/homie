# Homie netplay contract, v1 (revision 8)

Status: **v1, revision 8** (2026-10-03, `@homie-rocks/studio` 0.23.0). The wire version is
`v: 1`. Everything revisions 2 to 8 added is either an optional field, a new message type,
a new refusal, or a change of pace inside the old caps, and both sides ignore types they do
not know. A change to the contract bumps `v` and keeps v1 working.

**What revision 8 added** (a game that knows none of it has room chat anyway: the play page's
panel, the float and the big screen's corner need no game code):
- **Room chat** (section 19): anyone in a room (a player, a watcher, the big screen's page, a
  homie.rocks room page) says a line (`say`) or sends a reaction (`react`), on the game's socket
  or the shell's watch socket. The relay checks the room's chat rules (`policy.chat`), runs the
  floor on typed text, waits for the studio's own review (Cloudflare's Clef decision model on its
  Workers AI) and fans the line out to every socket and every watching shell, in homie.rocks's
  room-chat shapes (`line`, `react`). It keeps the last few minutes in memory and nothing else.
- New frames `say` and `react` (client → relay), `line`, `react`, `lines`, `unline` and `held`
  (relay → client; `slow` as homie.rocks says it); `policy.chat`; the owner's `unsay` control, and
  `line` and `purge` on `mute` and `kick`.
- The helper: `net.on('chat' | 'say' | 'unchat' | 'held')`, `net.say(text)`, `net.sayLine(id)`,
  `net.react(kind)`, `net.chatRules`, `net.chatShown`; `NETPLAY_REVISION` 8 and the build mark
  `homie-netplay-rev:8`. The port kit: `createBubbles` and `paintBubbles` (speech bubbles over
  characters, beside `createLabels`).

**What revision 7 added** (a game that knows none of it plays on every server; its AI guide
seats are the game's own bots, silent):
- **Agent hands and brains** (section 18): an AI with no game client of its own (hands
  `host`) sees the game through `agent:view` events its host sends that seat (at most one
  every 2 s, under 2 KB) and moves through `agent:do` goals (at most one every 3 s). It
  speaks only `say:<lineId>` lines of the game's own vocabulary (`agents.json`), with typed
  arguments, and only on a server whose AI may talk (the owner's `agents_brain`). The relay
  checks every one of those again and drops anything else an AI says.
- **The lite feed** carries the party's `say:`/`emote:` lines (free `chat` only on a
  `speech: game` server) and an `ask:<id>` a person made of that AI.
- **House guides**: on a beginner server whose AI may talk, the room's own Table seats the
  server's guides as loopback peers, with brains that run on Durable Object alarms (Workers
  AI or the owner's own key), and the scripted floor when there is no AI.
- `@homie-rocks/studio/agents` (`useAgents`): the host's side (views, the floor, goals for
  the hands, lines rendered from `agents.json`) and every browser's asks and lines.
- `NETPLAY_REVISION` 7 and the build mark `homie-netplay-rev:7`; Quiet AI also hides a line a
  host relays for an AI (`d.ai`).

**What revision 6 added** (a v1 game that knows none of it plays on every server; its AI
is labelled by name, its people are capped, and its play page shows no vote):
- **Servers and agent seats** (section 17): a server is a named, lasting pool of rooms with
  a policy (`open`, `humans-only`, `hybrid`, `beginner`). The Worker hands every room its
  policy; a hybrid server keeps its top seats for AI. An **agent** is an AI that sits with
  a pass the Worker verified: always named `<label> · AI`, marked `peer.agent`, never on a
  humans-only server, never alone in a room, and the relay labels the host's roster and
  results so they cannot hide one.
- **The skill dial**: five levels (`SKILLS`: Rookie, Steady, Fair, Strong, Maxed), each
  `{ reactionMs, aimNoise, aggression, positioning }`. The party votes the room's level; a
  game's bots read it with `net.skillOf(slot)`.
- New optional fields `hello.rev`, `hello.caps`, `hello.agent`, `welcome.policy`,
  `welcome.vote`, `welcome.agent`, `peer.agent`, `slot.agent`, `result.agent`; new frames
  `caps` and `vote` (client → relay) and `policy` and `vote` (relay → client); final
  refusals `agent-pass`, `agents-off` and `agents-unsupported`, and the reported
  `agents-alone`; speech modes (`lines`, `off`); the owner's `policy` and `level` controls.
- The helper: `net.policy`, `net.skill`, `net.skillOf(slot)`, `net.vote(n)`,
  `net.openVote()`, `on('policy')`, `on('vote')`, `net.agents()`, `net.isAgent(seat)`,
  `net.hushed` (the play page's Quiet AI), `createNetplay({ caps })`, `SKILLS`,
  `skillPreset`, `aiName`, `stripAi`; the `Roster`'s AI seats; `NETPLAY_REVISION` and the
  build mark `homie-netplay-rev:6`.

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
| `agents/agents.ts` | `useAgents`, the AI guides' host side and every browser's asks and lines (section 18), imported as `@homie-rocks/studio/agents`. |
| `worker/brain.mjs` | The vocabulary, prompts, `parseDecision`, the scripted floor and the providers (section 18). |
| `starters/ember-vale/` | Ember Vale: saves (a hero that lasts), and the AI guides' reference (`agents.json`, section 18). |
| `worker/chat.mjs` | Room chat's rules, the floor every typed message passes, and the studio's review on Clef (section 19). |
| `worker/chat-page.mjs` | The chat panel, the float and the big screen's corner: one component for the play, watch and TV pages. |
| `chat/CHAT.md`, `chat/OWNERS.md` | Room chat for game makers, and a plain note for studio owners on chat and children's data. |

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
| `hello` | everyone, once | `v: 1`, `token?`, `name?`, `device`, `want: 'play'\|'screen'`, `canHost`, `game?`, `max?`, `watch?` (revision 5), `rev?: 6`, `caps?: ('skill'\|'agents')[]`, `agent?: { hands, role }` (revision 6) | Seats the client (or queues it), picks a role, replies `welcome`, and sends `join` to the others. Refuses with `version`, `room-full`, `too-many` or `watch-off`. A `watch: true` hello is a watcher (section 16). An agent's (section 17) is seated in a seat kept for AI and named `<label> · AI`, or refused with `agent-pass`, `agents-off`, `agents-unsupported` or `agents-alone`. |
| `snap` | host | `k`, `st`, `d`, `c?` (control table) | Clamps `st` to [now − 2 s, now + 250 ms] (a snapshot stamped in the future would freeze replicas). Stores the snapshot and fans it out with `from`. Skips a socket with more than 256 KB buffered. |
| `in` | seated non-host | `q`, `a`, `h`, `p?`, `r` (the reset epoch the sender has adopted) | Forwards to the host only, stamped `from: <seat>`. Presses are clamped to integers 0–8, at most 16 keys. |
| `ev` | anyone | `k`, `d`, `to?` | **Speech** (section 17): with the room's speech `lines`, every `chat…` is dropped (anyone's, a host relaying one too); with `off`, every speech kind; from an agent, one line every 4 s and 8 a minute. **From a muted player** (section 15): a speech kind (`say…`, `chat…`, `emote…`) is dropped. **From the host:** to everyone else, to one seat (`to`: number) or to one peer (`to`: id string, such as a screen). **From anyone else:** to the host, with `from` and the sender's `id`. **Best-effort:** a drop over a cap is reported with `error rate`. |
| `state` | host | `k` (≤ 64 characters), `d` (`null` deletes) | Stores the key in memory, forwards it to all others, and includes the whole map in every `welcome` and in `role` to a new host. |
| `ckpt` | host | `k`, `st`, `d`, `c?` | Stores it in memory. It is saved to storage at most every 30 s. Not forwarded. |
| `round` | host | `round` | Labels its `results` (section 17), stores it, forwards it, and tells the shell's watchers. |
| `roster` | host | `slots` | Labels it (section 17: a host cannot hide an AI), stores it, forwards it, and tells the shell's watchers. |
| `caps` | host (revision 6) | `caps: ('skill'\|'agents')[]` | What the host's game does with servers: its bots read the dial, and it moves AI bodies. Stored as the room's (the play page offers the vote; a lite agent may sit) and in the watch feed. |
| `vote` | a seated person, or the host (revision 6) | `of: 'skill'`, `n?: 1..levelMax`, `open?: true`, `reason?` | `open` starts the party's vote on the dial (a player may open one every 2 minutes); `n` casts or changes this seat's vote. Agents and watchers never vote. The shell's watch socket may send it too, counted as the seat of the client with the same browser key. |
| `decide` | host (0.24.4) | `n`, `state`, `questions` | A game's own decision (section 20): checked, paced (one every 3 s and 20 a minute per room), handed to the Table's decision model; answered with `decided` to that socket only. |
| `ping` | everyone | `c`, `hid` | Replies `pong`. A host whose `hid` turns true yields. |
| `yield` / `bye` | host / anyone | — | `yield` elects another host if one is available. `bye` is a close. |

### Relay → client

| `t` | To | Fields |
|---|---|---|
| `welcome` | the new client | `v`, `rev`, `id`, `room`, `seat`, `token`, `name`, `colour`, `role`, `why: 'first'\|'resumed'\|'joined'\|'host-stalled'\|'host-hidden'\|'host-person'`, `host`, `peers`, `st`, `max`, `round`, `roster`, `snap`, **`state`**, `ckpt` (host only), `full?`, `watch?: { follow, why? }` (a watcher only), `policy` (with `skill`), `vote?`, `agent?` (an agent's own; a hands-`host` agent's carries no `snap` or `ckpt`, and an empty `state`) |
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
| `decided` | the host that asked (0.24.4) | `n`, `ok`, and `by`, `picks`, `p`, `ms`; or `why` (`off`, `no-ai`, `budget`, `pace` and `retryMs`, `busy`, `bad`, `slow`, `error`, `not-host`) |
| `announce` | everyone (and in `welcome.announce`) | `id`, `text` (`null`: taken down), `at`, `until`, `from: 'studio'` (section 15) |
| `mute` | everyone | `id`, `seat`, `until` (`0`: unmuted) (section 15) |
| `watch` | one watcher | `follow`, `why?` (`overview`, `seated-here`): whether it may follow one player now (section 16) |
| `policy` | everyone (revision 6) | `policy` (with `skill`, and `by: 'vote'\|'owner'` once the dial was set): on any change, a vote's result, the owner's control, a newer server policy |
| `vote` | everyone and the shell's watch sockets (revision 6) | `of`, `id`, `open`, `until`, `options` (1..levelMax), `counts`, `voters`, `of_total`, `result?: { level, name, votes, why }`, `reason?` |

**Error codes.**
- Final (the helper stops reconnecting): `version`, `replaced`, `room-full`,
  `too-many`, `kicked`, `room-closed` (the last two with `until`, server ms; section 15),
  `watch-off` (a watcher of a game that cannot be watched; section 16), `agent-pass`,
  `agents-off` and `agents-unsupported` (section 17).
  The helper before revision 4 does not know `kicked` and `room-closed` and keeps knocking;
  every knock is refused at `hello`, and the shell stops the frame (section 15).
- Reported only: `too-large`, `rate`, `state-full`, `vote`. (`flood` closes the socket; the helper
  comes back slowly. `agents-alone` closes an agent's socket; it knocks again after 30 s.)

A socket that is kicked for silence is closed with code 4000, and the helper reconnects.

Record types:

```ts
Peer        = { id, seat: number|null, name, colour, device, want, role, muted?: true, watch?: true, agent?: AgentFacts, badge?: string }
              (badge: a word the studio's Worker verified from what the player's account owns, such as a supporter's
              "Supporter"; a hello can never set it; never on a kids server, never for an AI. @homie-rocks/studio 0.24.0)
RoundInfo   = { n, phase: 'live'|'over', startedAt, endsAt, results?: RoundResult[] }   // server ms
RoundResult = { slot, seat: number|null, name, score, bot, place, agent?: true }
Slot        = { slot, seat: number|null, name, bot, agent?: { seat: number|null, role, hands } }
AgentFacts  = { pass, role: 'party'|'guide'|'player', hands: 'self'|'host', by: 'studio'|'guest'|'service' }
ControlWire = [seat, rs, own (1|0), ack]    // one per present seat, in snap.c and ckpt.c
```

**The shell's watch socket** (`/<game>/__watch?room=&b=`) gets
`{ t:'net', rev, room, host, clients, round, roster, snapHz, openedAt, announce, closedUntil?, counts: {players, agents, screens, waiting, watchers, humans, bots, ai, maxPlayers, humanSeats}, policy, vote?, caps, memory: {snapBytes, ckptBytes, ckptAgeMs, stateKeys, stateBytes}, stats }`
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
The helper takes it only from its own parent window, and only as a watcher. Revision 6 adds
`{ t: 'homie-hush', on }` (the play page's Quiet AI) and the frame's `policy` and `vote`.

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
| `decide` | < 2 KB | 6 KB (state 2 KB) | per beat (section 20) | 2; and per room one every 3 s, 20 a minute |

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
tools). The room's relay enforces these controls:

| `op` | Arguments | What the relay does |
|---|---|---|
| `kick` | `id` or `seat`, `minutes` (1–1440, default 10), `address?`, `message?` | Sends that player `error kicked { until, message }` and closes the socket (and the same browser's or account's other sockets in the room); everyone else gets `leave { why: 'kicked' }`, so the host turns the body back into a bot. The seat is freed at once. Until `until`, a `hello` from that seat token, that browser's room key, that player account, or (only with `address: true`) that network address is refused with `kicked`. |
| `mute` | `id` or `seat`, `minutes`, `off?` | Everyone gets `mute { id, seat, until }` (`until: 0` with `off`), and the peer carries `muted: true`. Until then the relay drops that player's `ev` whose `k` starts with `say`, `chat` or `emote` (the speech kinds). A muted host's own speech is not dropped, because the host also relays everyone's; a game hides it with `net.isMuted(seat)`. The mute follows the seat token through a reload. |
| `announce` | `text` (one line, at most 280 characters; empty takes it down), `seconds` (5–3600, default 30) | Everyone and every watching shell gets `announce { id, text, at, until, from: 'studio' }`; a joiner gets it in `welcome.announce` until it ends. |
| `close` | `minutes`, or `seconds` (10 s up to a day), `message?`, or `reopen: true` | Every socket gets `error room-closed { until, message }` and is closed; the room forgets its play as an empty room does (section 4); watchers get `closed`. Until `until` every `hello` is refused with `room-closed`, and the Lobby sends nobody there. `reopen` opens it at once. |
| `seats` | `max` | The room's seats while it runs (the owner's "players per room"). Players already seated above it keep their seat; nobody new is seated there. Never above the room's own cap (the game's manifest). |
| `policy` | `pol` (revision 6) | The server changed (section 17): the room takes its new policy at once. When agents are no longer allowed (humans-only), the current round finishes first, by the same rules as `regate`, and then every agent gets `error agents-off { message: 'This server is humans-only now.' }`. |
| `level` | `level` (1–5; revision 6) | The owner sets this room's dial now (`room_level`), as a vote's result does. |
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

## 17. Servers, policies and agent seats (revision 6)

A **server** is a named, lasting pool of rooms for one game, with its own policy, door and
Lobby pool. Strangers are matched only inside one server, never across. Every game's
`pub-N` rooms are its implicit server `public` (Quick play), so every old link and room keeps
working; a server's rooms are `s-<id>-<n>`; a named `?room=` takes the public server's rules.
Servers, their members and agent passes live in the studio's own D1 (migration
`0006_studio_servers.sql`); a game.json `"servers": [{ id, name, policy, … }]` seeds them (a
D1 row of the same id wins). The site's pages are `site/SITE.md`'s; this section is the room's.

**Policies.**

| `kind` | People | AI |
|---|---|---|
| `open` | anyone (the server's door decides) | an AI with a pass may sit, always marked AI |
| `humans-only` | anyone | none: every agent is refused (the Worker's 403, and the relay's `agents-off`). The game's filler bots are off (`bots: 'off'`) unless the owner turns practice bots on. |
| `hybrid` | the seats below the reserve | `aiSeats` seats in every room are AI companions: the top seats, `[max − N, max)` |
| `beginner` | new accounts (the door) | `guides` (and any `aiSeats`) seats are AI guides; speech is quick lines only; `kids` adds handles only, the dial at most 3, aggression at most 0.3 |

**The policy reaches the room from the Worker.** For every socket the Worker composes
`pol = { v, at, server, kind, aiSeats, guides, bots, level, levelMax, speech, kids, brain }`
from the server, the game and the office (AI seats and guides together are at most the seats
less one), and passes it to the room's Table, which applies it when `at` is newer than the
room's own. The owner's change reaches live rooms as a signed `policy` control (section 15).
Every client hears `welcome.policy` and `policy` frames, with `skill`: the room's dial now.

**Seats.** `seatFor(token, kind)`: a person takes a seat in `[0, max − reserve)`, an agent in
`[max − reserve, max)` (with no reserve, any seat, from the top). A token's own seat is kept
whatever the range (a person seated above a new cap keeps it). A seventh person in a hybrid
room of 8 with 2 AI seats waits as a spectator and is seated when a person's seat frees.

**Agents.** An AI sits like a phone: the same socket, with a ticket whose holder is
`a-<pass>`. The Worker verifies the pass (not revoked, not ended, for this game and server, a
server that lets AI in; a game that is not public opens only to the owner's own passes) and
hands the room the agent's facts; only that makes a socket an agent (a hello that says
`agent` with none is refused `agent-pass`). An agent:
- is named `<label> · AI` (the exact mark ` · AI`), and its peer carries `agent: { pass, role,
  hands, by }`. A person's typed name never ends in an AI or bot mark (the relay strips it;
  account names refuse it);
- **hands `self`**: runs the game itself (its frame is the game, booted with `HOMIE_NET.agent`)
  and plays its seat like a person. It hosts only a room no person can host, and a person who
  can host takes the rules back at their hello (`why: 'host-person'`);
- **hands `host`**: has no game client. The host's own bot code moves its body (a `Roster`
  slot that stays a bot, `agent.seat` naming it). It never hosts, and it gets the **lite
  feed**: `join`/`leave`, `roster`, `round`, `policy`, `vote` and `ev` addressed to its seat,
  never `snap`, `ckpt` or `state`. It sits only where the host's game declared
  `caps: ['agents']`, else `agents-unsupported`;
- **never keeps a room alive**: with no person seated for 60 s, every agent gets
  `agents-alone` and is closed, and none may come in until a person is seated (the helper
  waits 30 s before it knocks again). Agents are never players for the Lobby or for a room's
  forgetting: `counts.players` is people, `counts.agents` and `counts.ai` are apart;
- says at most one line every 4 s and 8 a minute (`stats.agentDrops` counts the rest).

**Labels.** The relay rewrites the host's `roster` and every round's `results` before anyone
sees them: a slot or row whose seat an agent holds gets `agent` and the agent's name; a slot
with no seat is a bot; a slot naming a seat nobody holds is a bot; a person's slot never
carries `agent` or an AI mark. A modified host cannot present an AI as a person.

**Speech** (`policy.speech`): `game` (as the game does it), `lines` (every `chat…` is dropped,
from people too: quick lines `say:…` and emotes pass), `off` (every speech kind). The play
page's **Quiet AI** hides AI speech on that browser only: the helper drops `ev` speech from an
agent's seat when `net.hushed`.

**The skill dial.** One shape for every game: `{ level 1..5, name, reactionMs, aimNoise 0..1,
aggression 0..1, positioning 0 back..1 front }`.

| level | name | reactionMs | aimNoise | aggression | positioning | |
|---|---|---|---|---|---|---|
| 1 | Rookie | 650 | 0.55 | 0.10 | 0.10 | stays at the back, misses a lot |
| 2 | Steady | 420 | 0.30 | 0.30 | 0.35 | helps, never steals the show |
| 3 | Fair | 250 | 0.15 | 0.50 | 0.50 | plays like a regular |
| 4 | Strong | 170 | 0.07 | 0.70 | 0.75 | keeps up with good players |
| 5 | Maxed | 110 | 0.02 | 0.90 | 0.95 | front-line tank, rarely misses |

Fair is what the port kit's bots always were (250 ms, an aim error of 0.12 rad = 0.15 × 0.8).
Kids caps the level at 3 and aggression at 0.3. The room's dial is the party's vote (or the
owner's `level`), else the server's `level`; a guide plays at the server's level.

**The party's vote.** Opened by itself at a party's first live round when the room has AI seats
and its game reads the dial (once per room per 30 minutes), by any seated person from the play
page's chip (once per 2 minutes), or by the game (`net.openVote('skill', 'dungeon')`). It is
open 15 s, or until every seated person voted (a lone player's tap decides at once). The result
is the **median of the seated people's votes, rounded down** (a tie is settled kindly), capped
at the server's `levelMax`, and it applies at once (`policy`, and the vote's `result`). The
shell draws the card; a game that draws its own says game.json `"agents": { "vote": "game" }`
(`false`: no vote).

**What the game does (the helper).**

```ts
import { createNetplay, type Skill } from '@homie-rocks/studio/netplay';
// 'skill': this game's bots read the dial; 'agents': its host moves an AI's body (its Roster passes p.agent).
const net = createNetplay({ game: 'gem-rush', maxPlayers: 8, caps: ['skill', 'agents'], checkpoint });
const roster = new Roster({ min: 3, max: 8, botName, policy: () => net.policy }); // keeps the AI seats
net.on('join', (p) => { if (p.seat !== null) roster.claim(p.seat, p.name, p.agent ? { role: p.agent.role, hands: p.agent.hands } : null); });

/** What each bot last noticed: it re-reads the world only every skill.reactionMs. */
const sight = new Map<number, { at: number; tx: number; ty: number }>();
function stepBots(dt: number): void {
  const taken = new Set<number>();
  for (const b of bodies.values()) {
    if (!b.bot) continue;
    const s: Skill = net.skillOf(b.slot);                    // Fair when nobody set a dial
    let eye = sight.get(b.slot);
    if (!eye || net.now() - eye.at >= s.reactionMs) {        // REACTION TIME (a miss costs it again)
      const g = pickGem(b, taken, s);                        // POSITIONING: 0 leaves the hot zone, 1 fights for it
      const miss = 200 * s.aimNoise;                         // AIM NOISE: up to 200 px off at 1
      eye = { at: net.now(), tx: g ? g.x + (Math.random() - 0.5) * miss : b.tx, ty: g ? g.y + (Math.random() - 0.5) * miss : b.ty };
      sight.set(b.slot, eye);
      if (g) taken.add(g.id);
    }
    const rival = nearestBody(b, KNOCK_RANGE);                // AGGRESSION: bumps a rival in reach
    if (rival && Math.random() < s.aggression * 0.8 * dt) hostWave(b);
    steer(b, eye.tx, eye.ty, BOT_SPEED, dt);
  }
}
```

| Call | Meaning |
|---|---|
| `net.policy` | The room's policy (`DEFAULT_POLICY` before the relay says one: open, Fair). |
| `net.skill`, `net.skillOf(slot)` | The room's dial; the dial a bot in that slot plays at. Reading either declares `caps: ['skill']` (the host tells the room once), so the play page offers the vote. |
| `net.on('policy', p)`, `net.on('vote', v)` | The policy or dial changed; the vote opened, moved or closed (`net.voteState`). |
| `net.vote(n)`, `net.openVote('skill', reason?)` | A seated person's vote; open one. |
| `net.agents()`, `net.isAgent(seat)` | The AI in the room. |
| `net.hushed` | Quiet AI on this browser (the play page sets it). |
| `aiName(label)`, `stripAi(name)`, `AI_MARK`, `SKILLS`, `skillPreset(n, kids?)` | Names and the dial. |
| `Roster({ …, policy })` | Keeps `aiSeats + guides` slots marked `agent` (a person never takes one); `claim(seat, name, agent?)` (hands `host`: the slot stays a bot, `agent.seat` set; hands `self`: claimed like a person's); `release(seat)` gives an agent's slot back as a seat kept for AI; `bots: 'off'` adds no filler. |

`createRoom` (the port kit) does all of it: its roster keeps the AI seats, its join passes
`p.agent`, it declares `caps: ['agents']`, and `room.skillOf(body)` is the dial. `BotBrain`
takes `skill: () => room.skillOf(body)` and maps it: `reactionMs`, an aim error of
`aimNoise × 0.8` rad, and a commitment of `2500 × (1.3 − 0.6 × aggression)` ms; `port/skill.ts`
adds `jitter(s, maxPx)`, `engages(s, dt)` and `standoff(s, near, far)`. A ported game built on
`BotBrain` gets the dial with a rebuild.

**Old games and old relays.**
- A game built with a helper before revision 6 plays on every server: doors, the human seat
  cap, speech modes and AI labels in names and in the shell work; it keeps no AI seats and its
  bots do not read the dial, a hands-`host` agent is refused (`agents-unsupported`), a
  hands-`self` agent is labelled by its name. Its play page shows no vote. `homie-studio
  build` writes the revision a build speaks into the catalogue (the helper's mark
  `homie-netplay-rev:<n>`), and the office says "This build predates servers" until it is
  rebuilt.
- A revision-6 helper on an older relay has `DEFAULT_POLICY` (open, Fair) and no AI seats.

**Kids and safety.** The AI never types: in this revision an agent is a seat and a body, and
its speech is rate-limited and filtered like anyone's (quick lines only on a beginner server).
Every AI is marked AI by the relay, not trusted to the host. The owner's controls work on AI:
mute (its speech is dropped), kick (held out by its pass; its seat goes back to a seat kept for
AI), announce. Nothing about a person beyond a player id the studio already has is stored; no
age is ever asked.

**Cost.** An agent is one more socket, like a phone. Agents never keep a room alive (60 s
alone at most). A lite agent gets no snapshots, so it costs a few frames a minute.

**Revision 7** (section 18) adds an AI's brain: hands in the host (`agent:view`, `agent:do`),
lines only from the game's own `agents.json` vocabulary (`say:<lineId>`, checked by the relay),
and guides that answer the party. Nothing in revision 6 changed for it.

---

## 18. Agent hands and brains (revision 7)

An AI guide has two layers. Its **hands** are the game's own bot code, in the host, every
frame, at the dial the party agreed: they walk to the goal and do what it says. Its **brain**
picks a goal every few seconds and, when the server lets its AI talk, one line to say. The
brain never runs in the frame loop, and it can only choose: goals and lines are ids from the
game's own vocabulary, never free text.

**Where a brain runs.** In the room's own Table, on the studio owner's Worker (a *house
guide*): Workers AI through the `AI` binding (model var `HOMIE_BRAIN_MODEL`, default since
0.24.4 `@cf/cloudflare/clef-flash`, Cloudflare's **Clef** decision model; `@cf/cloudflare/clef`,
the 27B, or a chat model such as `@cf/meta/llama-3.1-8b-instruct-fp8-fast` also work), or the
owner's own key (Worker secret `HOMIE_BRAIN_KEY`, `claude-haiku-4-5` through the official
`@anthropic-ai/sdk`). Under `homie-studio dev` with no binding: Clef on the person's own computer
(Ollama with `clef-flash`, which dev finds; free). Or in the owner's own AI through the local MCP
(`agent_sit`, about 30 s a decision), or a seat that thinks with Clef on the owner's computer
(`agent_sit { brain: "local" }`). With none of them, over the day's budget, or between decisions:
the game's scripted floor (`decide`). homie.rocks runs nothing and stores nothing.

**Clef asks the decision as the questions it is.** A decision model never writes text: it takes a
state and typed questions and returns a probability for every allowed answer, in one pass. A guide's
decision is a Choice of goal (only goals whose every argument has a value to take), a Choice per set
of argument values (one question for a goal's quest and a line's quest, so what the guide does and
says agree; a seat that said "no thanks" and the guide's own seat are never options), a Choice of
line or none (only when the guide may speak), and, with no ask open, a yes/no "anything to say at
all?" that a line also needs. The newest ask is in the goal question itself, with the answer
agents.json gives it. The state is the sanitized view, the open asks, who said no thanks, the
guide's own last lines and who is new to it. The answers are composed back into one decision, which
parseDecision and every fixed rule still check. Measured 2026-10-03 on 64 recorded Ember Vale
moments (`homie-studio agents try`, a throwaway studio): Clef answered 36 of 40 open asks itself
(Llama 3.1 8B: 0 of 40), blind judges preferred its decisions in 51 of 64 (Llama in none), model time
p50 259 ms, p90 433 ms (Llama 303 / 364 ms).

### The vocabulary: `games/<id>/agents.json`

The only words an AI in the game's rooms has. `homie-studio build` checks it (an unknown
argument type, a text over 120 characters, a `{placeholder}` that is not an argument, a goal
aimed at a player, an ask naming a goal or line that is not there: the build stops) and serves
it at `/games/<id>/agents.json`, where the Table reads it once.

```json
{ "v": 1,
  "persona": "A patient guide for new heroes in Ember Vale. Short, kind, never sarcastic.",
  "names": ["Wren", "Ash", "Moss"],
  "labels": { "king-slime": "King Slime", "camp": "camp", "king": "the King's hill" },
  "goals": {
    "follow": { "about": "stay with a player", "args": { "seat": "player" } },
    "quest":  { "about": "do a quest with the party", "args": { "quest": "view.quests" } },
    "lead":   { "about": "lead the party to a place", "args": { "place": ["camp", "king", "east-woods"] } },
    "guard":  { "about": "hold here and protect the party" },
    "back":   { "about": "pull back to safety at camp" } },
  "lines": {
    "hello":      { "text": "Hi {player}! I'm {me}, an AI guide. Tap me if you want help.", "args": { "player": "player" } },
    "quest_help": { "text": "Let's take on {quest} together.", "args": { "quest": "view.quests" } },
    "bye":        { "text": "Okay! I'll give you some space." } },
  "asks": {
    "ask_help":  { "text": "Help me with {quest}", "args": { "quest": "view.quests" }, "goal": "quest", "say": "quest_help" },
    "no_thanks": { "text": "No thanks", "goal": "back", "say": "bye", "leave": true } } }
```

| Field | Meaning |
|---|---|
| `persona` | Up to 400 characters: who the guide is, in the game's own voice. The system prompt starts with it. |
| `names` | Up to 8 names (16 characters each); a guide plays as `<name> · AI`. |
| `labels` | How a value reads aloud (`king-slime` → "King Slime"); else its dashes become spaces. |
| `goals` | Up to 16: `about` (what it is, 80 characters) and `args`. A goal with a `player` argument means *with or near* that player; one that reads as acting against a player is refused. |
| `lines` | Up to 32: `text` (120 characters; `{arg}` and `{me}` placeholders) and `args`. |
| `asks` | Up to 8 buttons a game draws for a person: `text`, `args`, and how the scripted floor answers (`goal`, `say`: arguments carry over by name, a `player` argument is the asker). `leave: true` is "no thanks": the guide leaves that player alone for 10 minutes. |
| argument types | `"player"` (a seat in the room, drawn with the room's name for it), a list of values, or `"view.<key>"` (a value present in the AI's latest `agent:view`). |

### Frames (all `ev`, with the relay's checks)

| `k` | From → to | `d` | The relay |
|---|---|---|---|
| `agent:view` | host → one AI's seat (`to: seat`) | the game's view of that guide (below) | Only the host, only to an AI's seat, under 2 KB, at most one every 2 s per AI; kept as that AI's latest view. |
| `agent:do` | AI → host | `{ goal, args }` | A goal of the vocabulary whose arguments fit the AI's latest view and the seats people hold; at most one every 3 s. |
| `say:<lineId>` | AI → host | `{ args }` | A line of the vocabulary with fitting arguments, on a server whose AI may talk (`policy.brain` is `workers-ai` or `owner-key`), at most one every 4 s and 8 a minute. The host renders it and relays it to everyone as `say:<lineId>` `{ slot, seat, args, ai: true }`, which the relay checks again (a line of the vocabulary; a view argument from the speaking AI's latest view, or only an id for a guide no AI holds): a host cannot put its own words in an AI's line. |
| `ask:<askId>` | a person → host | `{ slot, seat, args }` | Copied to the AI in `seat` (an ask id of the vocabulary). |
| anything else from an AI with no game client, `chat`, `emote`, `agent:view` | | | Dropped and counted (`stats.agentDrops`). An AI never types. |

The lite feed (hands `host`) carries `join`/`leave`, `roster`, `round`, `policy`, `vote`, events
addressed to its seat, the party's `say:`/`emote:` lines (`chat` only on a `speech: game`
server), and the asks made of it; never `snap`, `ckpt` or `state`.

### The host's side: `@homie-rocks/studio/agents`

```ts
import vocab from '../agents.json';
import { useAgents, type Vocabulary } from '@homie-rocks/studio/agents';

const agents = useAgents(room.net, vocab as unknown as Vocabulary, {
  // Host: what a guide sees (<= 1 per 2 s, < 2 KB). Game state only: never an account, an address or typed text.
  view: (slot) => ({ me: bodyView(slot), zone: zoneOf(slot), danger: dangerNear(slot), party: partyNear(slot), quests: openQuests() }),
  // The scripted floor: runs with no AI, over budget, and between AI decisions. Synchronous; never waits.
  decide: (v) => v.asks?.[0]?.k === 'ask_help' ? { goal: 'quest', args: { quest: v.asks[0].args.quest }, say: 'quest_help', sayArgs: { quest: v.asks[0].args.quest } }
             : { goal: 'follow', args: { seat: v.party[0]?.seat } },
});
// Hands, every host frame: the goal in force at the party's dial. Never awaits a brain.
for (const b of room.bodies.values()) { const g = b.agent?.role === 'guide' ? agents.goalOf(b.slot) : null; if (g) steerTo(b, g, room.skillOf(b), dt); }
agents.done(slot, true);                                   // that goal finished: the brain thinks again
agents.on('say', ({ slot, text }) => bubble(slot, text));  // a guide's line, from agents.json
agents.ask(slot, 'ask_help', { quest: 'king-slime' });     // a person's button (agents.askButtons(slot, offer))
```

| Call | Meaning |
|---|---|
| `useAgents(net, vocab, { view, decide, roles?, holdMs?, askWaitMs? })` | Every browser. On the host: sends each AI-held guide its view every 2 s, runs the floor for the rest (once a second), takes `agent:do` and AI lines, answers asks. |
| `goalOf(slot)` | `{ goal, args, from: 'brain' \| 'floor', at, state, asked? }` or null (the game's own bot code drives). An AI's decision holds for `holdMs` (45 s) or until it is done; a goal that answered a person's ask (`asked`) is carried through until done (or 60 s), whatever a brain says. A brain's decision that does not answer an open ask leaves it open, and the floor answers it after `askWaitMs`. |
| `done(slot, ok?)` | The goal finished (or failed): the next view says so (a brain thinks again); a guide no AI holds decides at once. |
| `ask(slot, k, args)`, `askButtons(slot, offer)`, `asksFor(slot)` | A person's ask (a button); the buttons to draw (one per value its argument may take); the asks made of a guide in the last 30 s. An ask of a held guide waits `askWaitMs` (4 s) for its brain, then the floor answers it. |
| `on('say' \| 'goal' \| 'ask', fn)` | A guide's line (text from the vocabulary; never on a browser with Quiet AI on), a goal change (with `askAt`, the ask that led to it), an ask. |
| `talking`, `render(id, args, slot)`, `stats()`, `stop()` | Whether the server's AI may talk; a line's text; counters. |

A view adds `goal` (`{ goal, args, state }`) and `asks` itself. The brain also thinks again when
the view's `zone` or `danger` changes.

### House guides and their brains

On a beginner server whose AI may talk, with a vocabulary, a person seated and a host whose game
moves AI bodies (`caps: ['agents']`), the Table seats `guides` house guides: loopback peers with
hands `host`, role `guide`, named from `names`. They are agents like any other: never players,
never hosts, closed 60 s after the last person, held out by a kick, silent when muted. An AI
with a pass (the owner's own Claude) takes a guide's seat from a house guide (`agent-yield`).

| Rule | Value |
|---|---|
| A decision | 0.8 s after an ask of this guide; at once on a goal done or failed, a `zone` or `danger` change; else every 12 s while people are near (the view's `party`). |
| Pace | At least 3 s between AI calls per guide, at most 10 a minute; one alarm per room at a time, at most one every 3 s. Never `setInterval`. |
| Prompt | System: the persona, the goals, the lines, the asks (about 400 tokens, stable). User: the view (sanitized: no key that names a person, an account, a ticket, an address or an age; nothing that looks like a secret; seats, never names), the asks, and the last three party lines as ids and arguments (free text only on a `speech: game` server: quoted, 120 characters, labelled as data). |
| Output | One JSON object `{ goal, args, say, sayArgs }` (a JSON schema where the provider takes one). Anything else (prose, a code fence, an unknown id, a wrong or extra argument, a player who said no thanks) is no decision: the scripted floor answers instead. |
| Fixed rules | A person's ask is answered the way agents.json says (its `goal`, with the values the person asked for): a model's other goal, or the asked goal with another value, is overruled, and the asked-for goal is carried through until it is done (or 60 s) with no model call meanwhile but for a new ask. A line at most every 8 s. "No thanks" holds the guide off that player for 10 minutes. No goal aims at a player. |
| Budget | A day, for the whole studio (meta `brain_budget`): 8,000 Workers AI neurons (the free allocation is 10,000 an account), $1 of the owner's key. Counted in `stats_daily` (`brain-calls`, `brain-neurons`, `brain-microdollars`), written at most once a minute. Over it: the scripted floor until 00:00 UTC. |
| Log | The last 50 decisions per room (seat, goal, line, provider, time, why; the model, Clef's probability for the goal and line, and the brain's own pick when a rule overruled it), in memory, in the office. |
| Try | `homie-studio agents try <game> --view <file> [--ask …] [--model …]` (office API `/_studio/api/agents/try`): the same brain and rules on one moment, no seat taken, spent from the same day. |

**Cost.** A house guide costs no request of its own beyond the alarm: one per room per due
decision, at most one every 3 s. A Clef decision is about 9 Workers AI neurons (clef-flash: about
1,000 tokens in at $0.09 a million, nothing for output), so the default day of 8,000 is about 900
decisions; a Llama decision is about 4.1 (700 tokens in, 40 out); the owner's key about $0.0009.
Under dev, Clef on the person's own computer costs nothing.

**Kids and safety.** The AI never types: it picks ids, the game renders the creator's text.
A beginner server's chat is quick lines only; on a kids server names are handles and no free
text ever reaches a brain. The owner's controls work on AI, and "AI talk off" (agents_brain
`script`) silences every AI at once. Quiet AI hides every AI line on a player's own screen.


---

## 19. Room chat (revision 8)

Every room has a chat: reactions that float up every screen in it, the game's quick lines,
and typed messages where the room's rules allow them. It is the Homie app's live-room chat and
homie.rocks's room chat, in a studio's own game: the same five reactions in the same order
(fire 🔥, clap 👏, laugh 😂, heart ❤️, wow 🤯), the same frames (`line` and `react`), the same
slow word ("One line at a time."), the same float on the big screen.

**Where it runs.** In the room's own Table on the studio's Worker. A line goes up on the game's
socket (`net.say`) or on the shell's watch socket (the play page's panel, the watch page, the big
screen's page, a homie.rocks room page); the relay checks it, the floor reads typed text, the
studio's review reads what the floor let through, and the relay fans it out to every socket and
every watching shell. homie.rocks runs nothing: its room page opens the room's own watch socket.

### The rules: `policy.chat`

| Field | Values (default) | |
|---|---|---|
| `mode` | `off`, `emoji`, `lines`, `text` (`text`) | What may be sent: each mode allows what the one before it does. |
| `who` | `anyone`, `signed-in`, `members` (`signed-in`) | Who may type. Signed in: a player account with a passkey (saves/SAVES.md), never a guest. Members: players who belong to the room's server (on Quick play: any signed-in player). |
| `react` | the same (`anyone`) | Who may send a reaction or a quick line. |
| `slow` | 0–120 s (2) | Slow mode: between one person's lines (reactions have their own bucket). |
| `max` | 20–280 characters (140) | A typed line. |
| `links` | `block`, `allow` (`block`) | A link is never clickable either way. |
| `swears` | `block`, `allow` (`block`) | Slurs, sexual words, threats and contact details are held whatever this says. |
| `ai` | `true`, `false` (`true`) | The studio's review of typed text. |
| `bubbles`, `watchers`, `hub` | `true` | A line may show over its sender's character; watchers may send (not only read); homie.rocks's page for the room may show it. |
| `emoji` | the five, then up to 3 of the game's own | `{ k, e }`: a kind and its glyph. |
| `lines` | 8 default lines, or up to 12 of the game's own | `{ id, text }`: the game's words; each passes the floor at build. |
| `capped` | `kids`, `server-lines`, `server-off` | Why the mode is lower than the game asks. |

The rules come in layers: game.json `"chat"` (the game's defaults, or `false` for none), then
the owner's for the game, then the owner's for a server (worker/chat-store.mjs, D1 `chat_rules`),
then the server's own caps: **a kids server, or a server whose speech is quick lines (every
beginner server), keeps chat to emoji and quick lines; speech `off` turns it off.** The Worker
composes them for every socket and the room applies the newest; an owner's change reaches every
live room at once (a signed `policy` control). The studio's own word list (`block`, `allow`)
stays in the room; clients get the rest in `welcome.policy.chat` and every `policy` frame.

```json
"chat": {
  "mode": "text", "who": "signed-in", "react": "anyone", "slow": 2, "max": 140,
  "emoji": { "gem": "💎" },
  "lines": { "gg": "Good game!", "gem": "Grab that gem!", "help": "Help me!" }
}
```

### Frames

| `t` | Direction | Fields | |
|---|---|---|---|
| `say` | up | `text` or `say` (a quick line's id), `n?`, `bubble?: false` | A typed line or a quick line. `n`: the sender's own id for it (1–16 of `A-Za-z0-9_-`), back on its own copy only. `bubble: false`: not over my character. |
| `react` | up | `kind`, `n?`, `bubble?: false` | One of the room's reactions. |
| `line` | down, everyone | `id`, `at`, `name`, `seat`, `colour`, `by`, `text`, `say?`, `bubble?`, `acct?`, `owner?`, `n?` | `by`: `player`, `watcher`, `hub` (a page of another site), `studio` (an announcement, which is a line too). |
| `react` | down, everyone | `id`, `at`, `name`, `seat`, `colour`, `by`, `react`, `glyph`, `bubble?`, `n?` | |
| `lines` | down, a watching shell as it opens | `lines` | The window: the last 50 lines of the last 15 minutes. Never to a page the room holds out. |
| `unline` | down, everyone | `ids` | The owner took them down: hide them, and their bubbles. |
| `held` / `slow` | down, the sender | `why`, `message`, `n?`, `until?` | Not sent. `why`: `off`, `emoji`, `lines`, `sign-in`, `sign-in-react`, `members`, `members-react`, `watchers`, `hub`, `muted`, `slow`, `repeat`, `words`, `harm`, `contact`, `link`, `swears`, `ai`, `busy`, `unknown`, `empty`, `ai_seat`. |

A line's sender is the socket's own client, or for a watch socket the client of the same browser
(its room key) or account in the room: its seat, name and colour. A page with no client in the
room (homie.rocks, a watch page before its game connects) is a watcher with a handle. **An AI never
types in room chat** (section 18: it says only its game's lines, as `ev`). The relay's caps: a
`say` frame at most 1.5 KB and 4 a second, a `react` 256 B and 10 a second; token buckets per
sender (lines: 4 at once, then one every 2 s, as homie.rocks; reactions: 6, then one every
0.4 s), 30 at once per address (then one every 0.15 s), and at most 40 reactions a second fanned
out per room (the float draws six a second anyway); the same words from one person within 30 s
are a `repeat`.

### The floor and the review

**The floor** (worker/chat.mjs `floor`) always runs, needs nothing, and costs nothing: a short
built-in English list (slurs, sexual words, telling someone to hurt themselves, moving a player to
another app or asking for pictures; worker/chat-words.mjs, `homie-studio chat words` prints it),
emails and phone numbers, links, swears, and the studio's own words (`block`, `word*` inside words;
`allow` lets one through). It reads through spacing ("f u c k"), repeats, leet and look-alike
letters, and never across two words ("this hit").

**The review** (`reviewChat`) reads what the floor let through, on the studio's own Workers AI:
Cloudflare's **Clef** decision model (`@cf/cloudflare/clef-flash`, launched 2026-10-01; var
`HOMIE_CHAT_MODEL` changes it to `@cf/cloudflare/clef` or `@cf/meta/llama-guard-3-8b`). One
typed question: is this message `ok`, an `insult`, `hate`, `sexual`, `grooming` (asks a player's
age, where they live, for photos or to move apps), `harm` or `spam`? Clef answers with a
probability for each; the message is held when `ok` is under 0.5, and the likeliest other answer
is kept as why (in the office's counts, never shown to anyone as a label). The message waits for
the answer (Clef-flash: about 40 ms median by Cloudflare's numbers, plus the round trip) and goes
out only after it. **Emoji and quick lines are never reviewed** (they are the studio's own words)
and reach every screen at once.

| Review | |
|---|---|
| Budget | A day, for the whole studio (meta `chat_budget`): 2,000 neurons by default. With the AI guides' 8,000 that is the 10,000 Workers AI gives an account free a day. A short message measured about 2.3 neurons (clef-flash: $0.09 per million input tokens, no output charge; the question and its answers are most of the input), so about 850 reviewed messages a day. Counted in `stats_daily` (`chat-reviews`, `chat-neurons`). |
| No review | No `AI` binding (`homie-studio dev` without `--remote-ai`, unless Clef is on the person's own computer: then it reviews there, free), the day's budget used, the model failing or slower than 1.5 s, more than 8 messages waiting: the floor alone decides, the message goes out, and the office counts it. |
| The owner | The studio's owner is never reviewed or held by slow mode (their lines are marked `owner`). |

### The owner's tools

`unsay { id | ids | all }` takes lines down on every screen. `mute` and `kick` take `line` (a
chat line's id) instead of a seat: the room holds that line's sender by token, browser and
account, a watcher with no seat too; `purge: true` takes their lines down with it. The office
(`/_studio/office`, `/_studio/api/chat…`) shows each live room's last minutes with Remove, Mute
and Kick, each game's rules (and each server's) with what set them, the reports, and the review's
day; the owner in their own game has Remove, Mute and Kick on every line in the chat sheet. An
office key (the owner's AI) changes rules that tighten chat at once and only ASKS for a change
that opens it up (a wider mode or audience, less slow, links or swears allowed, the review off,
new lines or emoji).

**Reports.** A player taps a line, then Report, and picks a reason (mean, hate, sexual, unsafe,
spam, other). The Worker files **the room's own copy** of that one line (its words, its sender's
room name and account id if signed in, the room, when) for 30 days or until the owner dismisses
it, once per line; never who reported it, never an address. 8 reports per browser per 10 minutes.

### What the game does (the helper)

```ts
import { createBubbles, paintBubbles, BUBBLE_FONT } from '@homie-rocks/studio/port';
const bubbles = createBubbles({ measure: (t) => { ctx.font = BUBBLE_FONT; return ctx.measureText(t).width; } });
net.on('say', (s) => bubbles.say(s.seat, s.text, { id: s.id, kind: s.kind }));     // over the speaker's character
net.on('unchat', (e) => e.ids.forEach((id) => bubbles.remove(id)));                // the studio took it down
// each frame, after the names: anchors just over each speaking body's name label
paintBubbles(ctx, bubbles.place(seats.map((s) => ({ key: s.seat, x: s.labelX, y: s.labelTop, self: s.mine }))));
```

| Call | Meaning |
|---|---|
| `net.on('chat', m)` | Every line and reaction: `{ id, at, kind: 'text'\|'line'\|'react'\|'studio', name, seat, colour, by, text?, say?, react?, glyph?, bubble?, acct?, owner?, mine? }`. A game with its own chat log draws these. |
| `net.on('say', s)` | One to draw over a character: `{ id, seat, name, text, glyph?, kind }`. Only when its sender wants it there (`bubble`), the room's `bubbles` rule allows it, the sender holds a seat, and this browser shows chat. |
| `net.on('unchat', { ids })`, `net.on('held', h)` | Lines taken down; a line of mine not sent (`why`, `message`). |
| `net.say(text)`, `net.sayLine(id)`, `net.react(kind)` | The game's own chat UI (a keyboard key, a wheel of quick lines): checked by the relay like the panel's. False when not sent. |
| `net.chatRules`, `net.chatShown` | The room's rules; whether this browser shows chat. |
| `createBubbles({ measure, lineHeight?, maxWidth?, maxLines?, ms?, avoid?, screen? })` | `say(key, text, { id, kind })`, `remove(id)`, `clear(key?)`, `place(anchors, dt)` → `BubbleOut[]` (the player's own first, none covering another, wrapped to 3 lines, popping in and fading out), `boxes()` (for `createLabels`' `avoid`), `size`. |
| `paintBubbles(ctx, list, { font, paper, ink, edge, radius })` | Draws them on a 2D canvas; a reaction alone is a bigger glyph. |

Gem Rush, Ember Vale and Gem Rush 3D draw bubbles over the speaker's name; Ember Vale keeps them
clear of its guides' own bubbles. A game that draws none still has the panel, the float and the
ticker.

### What the page does (worker/chat-page.mjs)

- **Play:** a Chat pill in the room button's band (game.json `screen.share` already keeps that
  corner clear of the game's HUD), with a count of unread lines; its sheet: the room's last
  minutes, a row of reactions (2.5 rem circles that pop), the quick lines, typing where the rules
  allow it (and why not where they do not: "Sign in to type here. Emoji are open to everyone."),
  Report on a line, and two switches kept in this browser: **Show my messages over my character**
  and **Show chat on this screen** (off: no ticker, no float, no bubbles in this game). New lines
  show for a moment where the status chip sits (game.json `"screen": { "chat": "bottom-right" }`
  moves them; `false` keeps only the pill's count).
- **Float:** every reaction rises up every screen in the room, as on the television: at most six
  a second and eighteen at once, 2.4 s each with a little sway. The sender's own floats at once.
- **TV** (`/<game>/tv`): the room's lines in the corner the QR card does not use, no typing.
- **Watch:** a Chat button in the band; its panel over the stage (a bottom sheet on a phone).

**Privacy.** Nothing a person says is stored: the room keeps the last 50 lines of the last 15
minutes in its memory (never in Durable Object storage), and an empty room forgets them with
everything else a minute after its last person leaves. The counts (lines, reactions, held by why,
reviews and neurons) are daily numbers in the studio's own D1, never a message or a sender. A
report keeps one message for 30 days. The review sends the message's words (and nothing about who
said it) to the studio's own Workers AI; Cloudflare says it does not keep or train on them.

**Cost.** A line or a reaction is one incoming message on the room's object (billed 20:1); the
fan-out is outgoing (free). A homie.rocks page or a watcher is one more socket. The review is
about 2.3 neurons a typed line, inside the free allocation by default.

**Old games and old relays.** A game built before revision 8 has the panel, the float, the ticker
and the TV corner; it draws no bubbles and its own UI cannot send. A revision-8 helper on an older
relay never hears a `line` and has `chatRules` null.

---

## 20. A game's own decisions (0.24.4)

Clef answers in about a tenth of a second and never writes text, so a game can ask it what to do
next about its own state: a tactic for its opponents, an NPC's reaction from a fixed set, a
director's call (a wave now? push harder?), a turn-based move. The host asks; the room's own
Durable Object asks the studio's Workers AI (or Clef on the person's own computer under `dev`);
the answer comes back as option ids, yes or no, and numbers. Nothing a player reads comes from a
model.

```ts
const d = await net.decide(
  { heroes: [{ hp: 40 }, { hp: 90 }], slimes: { count: 9 } },           // the game's state (sanitized; seats, never names)
  {
    tactic: { type: 'choice', instructions: 'How should the slimes hunt?', criteria: { chase: 'Rush the nearest hero', surround: 'Close in from every side' } },
    wave: { type: 'noul', instructions: 'Should a wave come now?' },
    pressure: { type: 'score', instructions: 'How hard should the vale push?', criteria: ['A breather', 'Steady', 'Fierce'] },
  },
  { floor: () => ({ tactic: 'chase', wave: false, pressure: 1 }) },  // the game's own answer, synchronous
);
// d.by: 'ai' | 'local' | 'floor'; d.picks: { tactic: 'surround', wave: false, pressure: 1.4 }; d.p: probabilities
```

| | |
|---|---|
| Opt-in | game.json `"decide": true` (the build carries it into games.json; deploy binds Workers AI for it). Without it the room answers `off` and the floor plays. |
| Questions | 1 to 8: Choice (2 to 26 option ids), yes/no (`noul`), Score (2 to 10 levels, lowest first; the pick is the probability-weighted level). Instructions and descriptions at most 160 characters. The state at most 2 KB after the same sanitizing as a guide's view. |
| Frames | Host to relay `{ t: 'decide', n, state, questions }`; relay to that host only `{ t: 'decided', n, ok, by, picks, p, ms }` or `{ t: 'decided', n, ok: false, why }` (`off`, `no-ai`, `budget`, `pace` with `retryMs`, `busy`, `bad`, `slow`, `error`, `not-host`). |
| Pace | One ask every 3 s and 20 a minute per room, two at a time; the helper waits 2.5 s (at most 5) and then answers from the floor. After `off`, `no-ai` or `budget` it asks again only after a minute. |
| Budget | The AI brains' day (meta `brain_budget`, 8,000 neurons by default): decisions and guides share it, counted as `brain-calls` source `decide`. About 4 neurons for three short questions. |
| Office | Each room's decisions: how many, who answered, the model's median time, the neurons. Never a state. |

**What rate is real.** Measured 2026-10-03 on a throwaway studio (Ember Vale's slimes' director,
three questions every 6 s): the host's round trip p50 160 to 253 ms, p90 347 to 497 ms; the model's
time in the room p50 115 ms; about 4.1 neurons a decision. So never per frame; per second is fast
enough but one room asking every second would spend about 15,000 neurons an hour, more than the free
allocation's whole day; **per beat (every 5 to 10 s), per turn, or on an event** is the rate that fits
the free plan (a room asking every 6 s: about 2,500 neurons an hour). Clef on the person's own
computer costs nothing; its time depends on the computer.

**Kids and the dial.** A decision moves the game's own world (its opponents, its director), never a
person, and never the party's skill dial: the bots' level stays the room's. On a kids server the game
keeps its decisions gentle (Ember Vale's slimes never gang up on the most hurt hero there, and the vale
never pushes past steady). The state follows a view's rules: game state and seats, never a name, an
account or typed text.

**Ember Vale** (the starter, opt-in: its game.json ships `"decide": false`): every 6 s of a live night
the host asks how the slimes hunt (chase, surround, gang up on the most hurt, regroup at the King),
whether a wave comes, and how hard to push; every screen shows what the slimes are up to when a model
chose it. The floor is the vale as it always played.
