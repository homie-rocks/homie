# Rooms: milestone 1 design

Status: design, 2026-10-07. Nothing is built.
Read at `origin/main` of `homie-rocks/homie` (studio 0.32.0). File paths are relative to
`packages/studio/` unless they start with `plugins/` or `template/`.

This document holds what is needed to build milestone 1 and nothing else.

- The plan, the milestone table and the slices of milestone 1 are in
  [rooms-plan.md](rooms-plan.md).
- Everything about later milestones is in [rooms-roadmap-design.md](rooms-roadmap-design.md).
  Section numbers quoted as "roadmap section N" point there.

## 1. What milestone 1 is

A game is written as rules plus view. Its rules run in one Durable Object on the studio's
Cloudflare, for a normal room of one area and up to 32 seats.

| Property | Milestone 1 form |
|---|---|
| Authority | The server. Inputs in, state out |
| Own body | Predicted in the browser with the game's `move` code |
| Durability | The whole room state saved once a second by default. Survives a restart or a deploy |
| Browser-hosted mode | The same rules, hosted by a player's browser: offline, local development, friends games |
| Local development | `homie-studio dev`, as today |
| The build | Checks every rules module and fails with the line named |
| Authoring | The `game` skill writes rules plus view |
| Starters | `gem-rush`, `gem-rush-3d`, `hero-rush-3d`, `ember-vale`, and the new example `coin-dash` |

**The idea that keeps it thin.** `worker/room.mjs` is a relay with no transport in it. It
already handles seats, tokens, chat, votes, watchers, owner controls, AI seats and stats, and
it treats the host as one more peer. Milestone 1 adds a host that runs inside the `Table`.
Nothing else in the relay is rebuilt.

**Words.**

| Word | Meaning |
|---|---|
| Room | The one thing a player joins |
| Table | The Durable Object class that holds one room today (`worker/index.mjs:1190`) |
| Host runtime | New code that takes a rules module and plays the host's part on the wire |
| Step, tick | One fixed advance of the room's clock |
| Save | The stored copy of a room's whole state |
| State hash | A hash of everything the meaning of a save depends on (section 5). It changes when a save would no longer fit the rules |
| Build hash | A hash of one game's built rules, view, tunables and map. A room and its players share one |
| Epoch | A number the room changes each time it starts fresh or restores. Input stamped with another epoch is dropped. A browser only compares it |
| Lead | How early a seat's input reaches the server, in ticks |
| Feel check | A test that a converted game still moves and scores as it did |

## 2. What exists today (checked against the code)

- `netplay/netplay.ts` (3,286 lines) is the client helper. `worker/room.mjs` (2,173 lines)
  is the relay. `netplay/NETPLAY.md` is the contract, version 1 revision 9.
- One player's browser is the host. It runs rules, bots and clock. The relay runs no game
  code. The host sends one whole snapshot to everybody at 20 Hz.
- A room holds at most 32 seats (`SEAT_MAX`, `worker/seats.mjs`). A game names its seats
  with `players.max` in `game.json` (`seatsOf`).
- The site, accounts, shop and rooms are one Worker with two Durable Object classes, `Table`
  and `Lobby`, both SQLite-backed, one D1 database and static assets
  (`template/wrangler.jsonc`).
  A studio's `site/src/worker.mjs` re-exports them from `@homie-rocks/studio/worker`.
- The `Table` runs the relay on a 250 ms timer (`worker/index.mjs:1622`) and stops it when
  no client and no watcher is connected (`:1637`). It stores the seat map and the host's
  latest checkpoint at most every 30 s under the key `net`, and the owner's bans, holds and
  closed door under `office`. It has one alarm, shared by house guides and the day's
  counters (`:1342`, `:1423`, `:1484`).
- An empty room forgets everything after 60 s (`forgetMs`, `worker/room.mjs:1483`). An AI
  never keeps a room alive. A restored save older than two minutes is ignored (`:1741`).
- The relay elects a host, replaces one that stalls, and hands the new host the last
  checkpoint (`NETPLAY.md` sections 2 and 9).
- The helper sends inputs at 20 Hz with a sequence number, re-sends an unchanged input at
  most every 250 ms, and keeps the ones the host has not answered (`pending()`). Movement is
  either the owner's claim, bounded by the host with `capMove`, or the host's. A host drives
  a knocked body with `net.take` (`NETPLAY.md` sections 8 and 11).
- Each starter is one file of 1,087 to 2,627 lines (7,102 in all) with module-level state.
  Rules step on render time, read the wall clock and use unseeded `Math.random`.
- `ember-vale` is built on the port toolkit's `createRoom` and on cloud saves.
- A browser that cannot reach a room plays on as an offline host with its own bots
  (`netplay.ts:156`). A standalone app does the same (`standalone/STANDALONE.md`).
- The build is esbuild with content-hashed bundles (`lib/build.mjs`). It type-checks only
  with `--types` and only if the studio has TypeScript (`lib/typecheck.mjs`).
- `homie-studio dev` runs the Worker under local Wrangler (`lib/dev.mjs`).
- `homie-studio check`, `shoot`, `perf` and the playtest judge read two probes in the page:
  `window.__homieNet` from the helper and `window.__homiePort` from the game's own
  `exposePort` call (`port/probe.ts`). `perf` needs one browser to be the host
  (`lib/perf.mjs:495`).
- Measured today: 242 to 330 ms between two non-host players (`NETPLAY.md` section 14).

## 3. The rules contract, milestone 1 form

Today's netplay contract is version 1. The rules contract is version 2 (`contract: 2`). This
section is the part of it that milestone 1 builds. Roadmap section 7 holds the whole contract
as it grows.

### 3.1 The model

- Every entity owns its own state.
- A rule may write only the entity it runs for (`self`). Everything else it reads is
  read-only.
- To affect another entity it sends an event. The event arrives on a later tick.
- That is true in one area and in many, so a game cannot work in one and break in the other.

### 3.2 Shape of a rules module

| Part | Rule |
|---|---|
| `contract` | `2` |
| `space` | `{ dims: 2 }` or `{ dims: 3 }` |
| `move` | Imported from the game's `move.ts`. Sections 3.5 and 6 |
| `shapes` | Every event, command and effect is declared here as a map of its data fields. So is a guide's view (section 3.10). A send with undeclared or wrong data fails the type check |
| `entities.<kind>` | `player`, `fields`, `motion`, `input`, `body`, `guide` (section 3.10), and handlers: `tick(world, self)`, `on.<event>(world, self, e)`, `commands.<command>(world, self, c)`, `onRoom.<event>(world, self, e)`, `think(world, self)` |
| `fields` | The entity's state. Its own handlers read and write it. `move` cannot see it |
| `motion` | The part of the entity's state that `move` reads and writes: a jump's cooldown, a knock, a stun, a speed boost. Its own handlers read and write it too. It is the only state besides the built-in fields that the browser replays |
| `body` | `shape`, `radius` (and `height` for a capsule), `maxSpeed`, and optionally `sweep` and `move: 'owner'` (section 3.5). `maxSpeed` is the top speed of steered movement on the ground plane, in metres a second. The runtime does not clamp to it, so a knock or a dash may pass it. It caps an owner's claims and sizes the view's corrections (section 6). The check fails a `move` that passes it from rest with every `motion` field at its `init` |
| Built-in fields | Every entity has `id`, `kind`, `pos`, `vel`, `heading`, `grounded`. A player's body also has `input`, `seat`, `owner`, `driver`, `away` and `goal` (section 3.10) |
| `heading`, `grounded` | `heading` is an `f.dir`: a unit vector on the ground plane, the way the body faces. `grounded` is true when the body rests on a surface (section 3.5) |
| Who writes the built-ins | `move` writes `pos`, `vel`, `heading` and `grounded`. A handler may write its own `vel` and `heading`. A handler changes its own `pos` only with `world.place` or `world.sweep`. The rest are read-only |
| `owner`, `driver` | `owner` is an opaque ref for the person holding the seat, empty for a bot. Rules compare it and store it in `f.ref` fields, nothing else. `driver` is `'person'`, `'bot'` or `'ai'` |
| Field types | Integers (`f.u8` to `f.u32`, `f.i8` to `f.i32`), `f.bit`, `f.fix` (fixed-point), `f.vec3`, `f.dir` (a unit vector; `z` is 0 when `dims` is 2), `f.tick` and `f.ticks` (a moment and a length on the room's clock), `f.ref` (the id of an entity or a player), `f.text(max)`, `f.list`, `f.map`, `f.struct`. In `input` only: `f.press` (a button that fires once). Lists and maps declare a maximum size |
| Field options | `init`. On one integer field of a player's body, `score: true` (section 3.6) |
| `shared` | Fields for the whole room. Written only in room scope. Read-only everywhere else |
| `room` | Room-scope handlers `start(world)`, `join(ctx, player)`, `on.<event>(world, e)`, and the declarations `rounds` and `bots` (section 3.6) |
| `asks` | A game's own AI decisions, declared by name (section 3.10) |
| `map` | The folder of the game's map data |
| Ownership | A handler writes `self` only, or `world.shared` in room scope. Query results and event data are frozen |
| State | All state is in declared fields. A rules module has no module-level variables |

### 3.3 Time and chance

| Part | Rule |
|---|---|
| The room's clock | The runtime calls `tick` at `tickHz`. `world.tick` is the room's clock. `world.dt` is one tick in seconds. `world.ticks(seconds)` converts to whole ticks, rounded to the nearest, and at least 1 for a length above 0. The clock may run slow under load. It stops while a room is paused or restarting and never jumps (section 4.5) |
| Lengths of time | A length held in `f.tick` or `f.ticks` is whole ticks. At 20 Hz it moves in steps of 50 ms: 240 ms becomes 250, and a Game Lab slider with a 10 ms step changes nothing until it crosses a tick. A length that must keep its fraction is plain arithmetic, `seconds / world.dt`, kept in an `f.fix` field (section 15.1 does this for a 70 ms hit-stop). Timers and events land on whole ticks either way |
| Timers | `world.after(ticks, event, data)` delivers an event later: to `self` from an entity handler, to the room from room scope |
| Dice | `world.random()` only. The seed is room state |
| Maths | `+ - * /`, `%`, and `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `sign`, `imul`, `fround`: each has one correct result. Everything else, including `sin`, `cos`, `atan2`, `pow`, `exp`, `log`, `hypot` and the `**` operator, is refused. `world.math` supplies them, and vector helpers, in plain arithmetic so that server, browser and build check agree |
| Tunables | `world.tune` (`tunables.json`, with a `public` part that `move` may read). Read-only |
| The Game Lab | `world.stage` is the Lab's stage name. It is empty in a live room |
| Promises | `async`, `await`, `Promise`, generators and `queueMicrotask` are refused. A handler finishes inside its tick |

### 3.4 Events and messages

| Part | Rule |
|---|---|
| Events | `world.send(targetId, event, data)`. An event sent in tick n is run in tick n+1 or later. Events run in order per sender and target, exactly once |
| Undeliverable | If the target no longer exists, the sender receives the built-in event `undeliverable` with the original event and data, if it declares a handler `on.undeliverable`. Otherwise the event is dropped |
| Same tick | Events for one entity in one tick run in a fixed order (sender id, then sequence). `world.despawn(self)` takes effect at once: later events for that entity in the same tick are not run and are undeliverable. So exactly one of two takers gets the coin |
| Area events | `world.sendArea(shape, event, data)` delivers to every entity whose position is inside a sphere, box or cone, the sender included. Who is inside is decided at the end of the tick it is sent in. Delivery is on the next tick. A shape reaches 64 m at most, like a query |
| Room events | `world.sendRoom(event, data)` runs a `room.on` handler. `world.announce(event, data)` from room scope reaches every entity whose kind declares that event under `onRoom` |
| Effects | `world.emit(effect, at, data)` is sent to the players' views. `at` is a position or an entity id. An effect on an entity plays when that entity is drawn at the effect's tick, so a flash and the body it lands on stay together (section 6). Rules never read it back |
| Commands | A reliable one-shot request from a player's view (`room.command`). It runs the `commands.<command>` handler of that player's body, in phase 2 of a tick, before that body's `tick` |
| Asking outside | `world.ask(name, state)` for an AI decision. The answer arrives later as the event `answer` (section 3.10) |

### 3.5 Bodies and space

| Part | Rule |
|---|---|
| Spawning | `world.spawn(kind, at, fields)` returns the new id. The entity exists from the next tick. `world.despawn(self)` removes the running entity |
| Placing | `world.place(self, at, { vel?, heading? })` puts the running entity somewhere at once: a spawn point, a respawn, a teleport. It raises the body's placement counter, so every view jumps to the new spot and does not glide to it |
| Queries | `world.near(pos, r, kind)` (nearest first), `world.inBox(box, kind)`, `world.ray(from, dir, max)`. A query has a reach, 64 m at most (the default of the later `cell.marginM`). Results are frozen views, each with an `id`. `world.ray` returns nothing, or `{ entity?, at, normal, dist }`. There is no list of all entities |
| Sweep | `world.sweep(self, delta, { ignore })` moves `self` along `delta` and stops at the first thing in the way. It returns nothing, or `{ entity?, at, normal }`, where `entity` is an id |
| Movement | `move[kind](body, input, ctx)` runs once per body per tick. It reads and writes `body.pos`, `vel`, `heading`, `grounded` and `body.motion`. It reads the step's `input`, and `ctx.tick`, `ctx.dt`, `ctx.ticks(seconds)`, `ctx.tune` (public tunables), `ctx.math` and `ctx.map` (the static map: `sweep(body, delta)`, `spot`, `spots`). It sees nothing else: no other entity, no `fields`, no `shared`, no dice. The server runs it. The browser runs the same code to predict |
| `grounded` | `ctx.map.sweep` and `world.sweep` set it on every call: true when the body ends the move resting on a surface below it, false otherwise. So it clears on the tick a jump leaves the ground, and when a body walks off an edge. With `dims: 2` it is always true |
| Precision | After `move` the runtime rounds `pos`, `vel` and `heading` to 32-bit floats, on the server and in the browser, and the snapshot carries them whole. `motion` fields have declared types. So the browser replays from exactly the numbers the server stepped from |
| Rules that steer movement | A handler writes its own `motion`, sets its own `vel`, or calls `world.place`. `move` reads the result on the next tick. That is how a knock, a stun, a slow, a boost, a dash cooldown, a round reset and a respawn are written (section 15) |
| A fact `move` needs from the room | The room announces it and each body copies it into its own `motion`. A body that arrives later copies it in `on.arrive`. A break between rounds is `onRoom.roundOver` setting `self.motion.frozenUntil`, and `on.arrive` doing the same for a body that joins during the break (section 3.7) |
| Owner movement | `body: { move: 'owner' }` is a per-kind choice for casual games. The browser runs `move` and says where its body is. The server holds the claim to `body.maxSpeed`, as `capMove` does today, and ignores claims made before the last `world.place`. It does not stop a modified browser walking through a wall. Bots of such a kind are moved by the server, and so is a body whose player is away. When the player returns, or a person takes over a bot's body, the runtime raises the placement counter, so the browser starts from the server's position |
| Fast bodies | `body.sweep: true` tests the whole path of a tick, so nothing tunnels |
| Dimensions | Positions are `x`, `y`, `z` in metres, `z` up. `space.dims: 2` fixes `z` at 0 and uses circles. `dims: 3` uses spheres, capsules and boxes, and a map with height |
| Static world | `map` is data in `games/<id>/map/`, one file per map: boxes, circles or spheres, capsules, height tiles and named spots. `world.map.spot(name)`, `world.map.spots(name)` |
| Per-tick order | Four phases. 0: seat changes take effect, room scope hears of them, and each new entity runs `on.arrive` (section 3.6). 1: one input step and `move` for every body. `think` supplies the step for a body no person is driving. 2: for every entity, its commands and then its `tick`. 3: the events and timers that are due, then spawns. The snapshot is taken after phase 3. Phase 2 starts from a different entity each tick |
| Ids | Opaque. Rules store them in `f.ref` fields and compare them for equality. Never reused in a room |

### 3.6 Seats, bots, rounds and results

| Part | Rule |
|---|---|
| Joining | `room.join(ctx, player)` is pure: it reads the static map and a read-only copy of `shared`. `player` is `{ seat, driver, owner }`. It returns `{ kind, at, heading?, fields?, motion? }`: where the body starts, and any starting values for its declared fields. The runtime calls it for a person, an AI seat and a bot alike, at any moment a seat is taken: before the first round, mid-round, and in a break |
| Arrival | Every entity runs the built-in event `arrive` once, as its first handler, in phase 0 of its first tick: `on.arrive(world, self, e)`, with `e.why` `'join'` or `'spawn'`. Its fields hold what `join` or `spawn` gave, and `init` otherwise. It reads `world.shared` and `world.round`, so a body that joins late sets itself up from them. An announcement made before it existed never reaches it |
| Who is in the room | Room scope hears three built-in events in phase 0. `seatJoined` `{ seat, id, driver, owner, took }`: a body has a holder. `took` is true when a person or an AI takes over a bot's body. `seatAway` `{ seat, id, away }`: a player's socket closed, or the player is back. `seatLeft` `{ seat, id }`: a seat was given up. Bots count as seats. A game that needs the list (whose turn, which team) keeps it in a `shared` list of at most 32 entries, and bodies read it there |
| `player` on a kind | `true`, or `{ away, leave }` |
| A body while its player is away | The socket closed and the seat is still held (60 s, the relay's `holdMs`). The body stays. `self.away` is true. Its input is neutral, or comes from `think` when `away: 'think'` |
| A body whose seat is given up | `leave: 'despawn'` (the default) removes it after its `on.leave` handler, if any. `leave: 'bot'` keeps it as a bot, as today's roster does |
| A player who returns | Same seat token, same body, `away` false. The body kept playing by the rules above. Nothing is rewound |
| Bots | A bot is a body whose input comes from its kind's `think(world, self)`, which returns one input step. Same input path as a player |
| Filling seats | `room.bots: { keep: n }` asks the runtime to keep at least `n` bodies in the room with bots, when the server's policy allows it (`policy.bots: 'fill'`, `worker/room.mjs:100`). A person who joins a full room takes over a bot's body (`on.takeover`, if declared, lets the rules reset it) |
| AI seats and guides | The relay decides who sits, as today. The runtime sets the body's `goal`, and `think` turns it into input (section 3.10). Slice 5 |
| The level dial | `world.level` and `world.levelMax`: the party's dial (`NETPLAY.md` section 17). Readable anywhere. `think` uses it |
| Rounds | `room.rounds: { seconds, breakSeconds }`. The runtime starts a round, ends it when its time is up, waits the break, and starts the next, for as long as the room lives. `seconds: 0` means a round ends only when room scope calls `world.round.end()`, which is also how a round ends early. A body asks for it with `world.sendRoom` |
| Reading the round | `world.round` is `{ n, phase: 'live' or 'over', endsAt }`, readable anywhere. `endsAt` is the tick the current phase ends |
| Round events | The built-in events `roundStart` and `roundOver` reach `room.on` and every kind that declares them under `onRoom`. When a round's time is up, `world.round.phase` turns `'over'` on that tick. `roundOver` and the results follow two ticks later, so a score already on its way (two event hops) is counted. A handler that starts something checks the phase first |
| Results | Two ticks after a round's time is up, the runtime reads the `score: true` field of every player's body, ranks them (ties share a place, `NETPLAY.md` section 26), and sends today's `round` frame with `results`. `roundOver` carries the same list, frozen. So the relay's round stats, launch re-gating and AI seats leaving after a round keep working (`worker/index.mjs:1693`) |
| The scoreboard | The view reads `room.roster`: every seat with its name, driver and score. Rules need no list of entities for it |
| Other room totals | A body reports to room scope with `world.sendRoom`, and room scope keeps a `shared` map of at most 32 entries |
| Ending a match | `world.finish()` in room scope ends the match: results are sent, every entity is removed, `shared` returns to its initial values, the epoch rises and `room.start` runs again after the break. Seats stay. A game whose rounds never stop does not call it |

### 3.7 An example module

This module is a test fixture and the starter `coin-dash`. The build check must pass on it.

```ts
// games/coin-dash/src/move.ts  (its own file: section 7 says which bundles hold it)
import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({
  runner(body, input, ctx) {              // own body, own motion, this step's input, static map, public tunables
    const M = ctx.math;
    const speed = ctx.tick < body.motion.frozenUntil ? 0 : ctx.tune.speed;        // 6, the body's maxSpeed
    body.vel = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), speed);   // a diagonal is no faster
    if (speed > 0 && M.len(body.vel) > 0.5) body.heading = M.norm(body.vel);
    ctx.map.sweep(body, M.scale(body.vel, ctx.dt));   // moves body.pos, stops at walls
  },
});

// games/coin-dash/src/rules.ts
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events:   { take: { by: f.ref() }, score: {} },
    commands: {},
    effects:  { ding: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }) },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6 },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        // A second `take` sent before the coin is gone is dropped: the coin no longer exists.
        for (const coin of world.near(self.pos, 1, 'coin')) world.send(coin.id, 'take', { by: self.id });
      },
      think(world, self) {                 // a bot, and a player who is away
        const coin = world.near(self.pos, 64, 'coin')[0];
        if (!coin) return { ax: 0, ay: 0 };
        const d = world.math.norm(world.math.sub(coin.pos, self.pos));
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127) };
      },
      on: {
        score(world, self) { self.score += 1; },
        arrive(world, self) {              // joined during a break: stand still with the others
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },   // stand still through the break
      },
    },
    coin: {
      on: { take(world, self, e) {          // first taker wins; see "Same tick" in 3.4
        world.send(e.by, 'score', {});
        world.emit('ding', self.pos, {});
        world.despawn(self);
      } },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
  },
  shared: {},
  room: {
    rounds: { seconds: 60, breakSeconds: 8 },
    bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) { for (const spot of world.map.spots('coins')) world.spawn('coin', spot, {}); },
    },
  },
  map: './map',
});
```

- In slice 1 the `runner` body declares `move: 'owner'`: the server moves the bots with
  `move.ts` and holds each person's claim to `maxSpeed`. Slice 6 removes that line.
- `tunables.json` holds `speed: 6` in its `public` part, equal to `maxSpeed`.
- A player who joins in a break gets a body at once, frozen by `on.arrive`, and is placed
  with everyone else by the next `roundStart`.

### 3.8 The view's side (`@homie-rocks/studio/rules/view`)

- **How a view gets its room.** `const room = openRoom<typeof rules>()`. The rules are
  imported for their types only, so none of their code enters the bundle. `openRoom` starts
  the helper, joins the room the play page names, and returns at once. `room.status` moves
  from `connecting` to `playing`.
- `room.me`: the player's own predicted body, drawn by the rules of section 6.
- `room.each(kind, fn)`: entities, interpolated to render time.
- Each entity gives its built-in fields, its declared `fields` and its `motion`. Milestone
  1 hides none of them.
- `room.on(effect | 'enter' | 'leave' | 'placed' | 'round', fn)`, `room.shared`,
  `room.input(sample)`, `room.command(command, data)`.
- `room.round` is `world.round` plus `secondsLeft`, which the library works out from the
  room's clock. A view never turns a tick into time itself.
- For guides (section 3.10): `room.on('say' | 'goal' | 'ask', fn)`,
  `room.ask(id, askId, args)` and `room.askButtons(id)`.
- `room.seat`, `room.roster`, `room.status`, `room.follow(id)` for watchers.
- The view never packs or unpacks state. The runtime does it from the declared fields.
- **Probes.** The library publishes `window.__homieNet` (through the helper) and
  `window.__homiePort` (through `exposePort`): own position, score, round, and `busy` while
  `room.me` is away or its `motion` says it cannot steer. A view adds `extra` values with
  `room.probe({ ... })`. So `check`, `shoot`, `perf` and the playtest judge read a rules game
  as they read today's.
- **The Game Lab.** Phases, tracks and poses are reported from the view, from declared state
  and effects (`lab.phase`, `lab.track`, `lab.pose`). A knock's phases come from
  `room.me.motion`. The Lab's sliders replace `tunables.json` in the host runtime it starts.
- Chat, votes, the arrival screen, owner controls and the page around the game stay with the
  helper and the shell, as today.

### 3.9 Seats and identity

Unchanged. A seat is a number kept by the room, with a token (`NETPLAY.md` section 3). A
player who reconnects with their token gets their seat and their body back (section 3.6).

### 3.10 AI seats, guides and a game's own decisions

Today these are game code in the host: `view`, `decide` and the steering around `useAgents`
(`agents/agents.ts`, `NETPLAY.md` sections 18 and 20). The vocabulary file `agents.json`, the
relay's checks, the pacing, the allowance and the brains stay as they are. The rules format
gives the game's own parts a place.

| Part | In the rules | Today |
|---|---|---|
| The goal in force | `self.goal`, a built-in read-only field of a player's body: nothing, or `{ goal, args, from, at, asked }`. `from` is `'brain'` or `'floor'`, `at` is a tick. The runtime sets it and saves it | `agents.goalOf(slot)` |
| Goals become input | `think(world, self)` reads `self.goal` and returns one input step. The same handler steers a bot (no goal), a body whose player is away, an AI seat and a guide. It may write `self` | The game's `steerTo` |
| Done | `world.goalDone(ok)` from that body's `think` or `tick`. The goal is cleared. A brain thinks again; a guide no AI holds runs the floor on its next tick | `agents.done(slot, ok)` |
| The view | `guide.view(world, self)` returns what an AI sees of the game. Its keys are declared in `shapes.view` with types and sizes, 2 KB at most. It writes nothing. The runtime adds `goal` and `asks`, and calls it at most every 2 s for each AI | `view(slot)` |
| The scripted floor | `guide.floor(world, self, v)` gets that view and returns `{ goal, args, say?, sayArgs? }`, or nothing to keep the goal. It runs once a second for a guide no AI holds, when the AI allowance is spent, and between an AI's decisions. It may write `self` | `decide(v)` |
| Asks and lines | A person's ask and a guide's line are the relay's frames, unchanged. The view calls `room.ask` and hears `room.on('say')` | `agents.ask`, `agents.on('say')` |
| How long a goal holds | A brain's goal holds 45 s or until done. A goal that answered a person's ask is carried through until done, or 60 s | The same (`holdMs`) |

- A kind that declares `guide` and `think` may be driven by an AI. The room then sends the
  `agents` capability.
- A vocabulary argument typed `view.<key>` reads the declared key, as today.
- The format accepts and checks all of this from slice 1. The runtime calls it from slice 5.

**A game's own decisions** (`NETPLAY.md` section 20; `"decide": true` in `game.json`, as today).

| Part | Rule |
|---|---|
| Declaring | `asks.<name>: { state, questions, floor(state) }`. `state` is declared fields, 2 KB at most. `questions` are today's three kinds: `choice`, `noul` (yes or no) and `score`. `floor` is the game's own answer. It is pure |
| Asking | `world.ask(name, state)` from any handler. One ask per name is open at a time. A second returns false |
| The answer | The event `answer` reaches whoever asked (`on.answer`, or `room.on.answer`): `{ ask, by, picks, why? }`. `by` is `'ai'`, `'local'` or `'floor'`. `picks` has one value per question: an option id, true or false, or a number |
| No AI | When the relay answers `ok: false` (off, no AI, allowance spent, paced, slow), or nothing comes within 5 s, the runtime calls `floor` and delivers its picks with `by: 'floor'` and the reason in `why`. Rules get exactly one answer to every ask |
| In the check | The floor answers on the next tick, so two runs agree |

**Checked against `ember-vale`** (`starters/ember-vale/src/main.ts:234-262`, `405-515`).

- Its view (`me`, `zone`, `danger`, `party`, `quests`, `slimes`, `round`) is built from the
  guide's own body, bodies within 18 m, and state that becomes `shared`. All of it is
  inside a query's reach.
- Its floor reads the newest ask, the party and the goal in force, and remembers whom it has
  greeted. That memory becomes a declared list on the body.
- Its hands (`stepGuide`) switch on `follow`, `quest`, `lead`, `guard` and `back`. They walk
  to a spot, or to a hero found by seat, and report done on arrival, on the King's death (a
  tick in `shared` compared with `self.goal.at`), or after 20 s. That is one `think`.
- Its director asks three questions every 6 s and keeps the tactic, the pressure and a wave
  count. That is a room timer, `world.ask('director', state)`, and `room.on.answer` writing
  `shared`.

## 4. The server-hosted room

### 4.1 Who does what

| Job | Today | Milestone 1, `host: server` | Milestone 1, `host: browser` |
|---|---|---|---|
| Runs the rules and the clock | The elected browser, with code inside the game | The host runtime, inside the `Table` | The host runtime, inside the elected browser |
| Seats, tokens, names, badges | Relay | Relay, unchanged | Relay, unchanged |
| Chat, reactions, review | Relay | Relay, unchanged | Relay, unchanged |
| Votes, prefs, arrival, seat or solo | Relay and shell | Unchanged | Unchanged |
| Watchers and the big screen | Relay | Unchanged | Unchanged |
| Owner's signed controls | Relay | Unchanged | Unchanged |
| Roster and round results | The host sends them; the relay marks AIs | The host runtime sends them, from slice 1 | Same, from slice 3 |
| Round and peak stats, launch gating | `Table`, from the host's `round` frames | Unchanged, because the frames are the same | Unchanged |
| AI seats and house guides | Relay decides; the host moves bodies | Relay decides; the host runtime sets the body's `goal` and `think` steers it (section 3.10). Slice 5 | Same |
| A game's own AI decisions | The host asks through the relay | `world.ask`, asked by the host runtime. Slice 5 | Same |
| Matching | `Lobby` | Unchanged | Unchanged |
| Host election, yield, relay checkpoint | Relay | Not used | Unchanged |

### 4.2 The host runtime

- One module, `rules/host.ts`. It takes a rules module and three things from its caller: a
  way to send a frame, a clock and a store. It has no transport in it and no Cloudflare in
  it, in the style of `worker/room.mjs`.
- It plays the host's part on today's wire. It reads `in` frames and commands, steps the
  core, and sends `snap`, `ev`, `round`, `roster`, `state` and `caps` frames.
- **Everything a host does today, it does.**

| Host duty today | In the host runtime | Slice |
|---|---|---|
| `snap` at the tick rate, with the control table | Section 4.3 | 1 |
| `round` and `roster` | Built from `room.rounds` and the seats (section 3.6) | 1 |
| The keyed `state` channel | Carries `shared`, sent when it changes | 1 |
| Relaying speech and emote `ev` frames from a seat to everyone | Passed on unchanged | 1 |
| `caps` | `skill` when a kind has `think`; `agents` when the player kind may be driven by an AI | 1 and 5 |
| `agent:view`, `agent:do`, an AI's lines (`NETPLAY.md` section 18) | `guide.view`, `self.goal`, `guide.floor` and `think` (section 3.10) | 5 |
| `decide` | `world.ask` and the `answer` event (section 3.10) | 5 |

- The same module runs in three places: inside the `Table`, inside a browser that is host,
  and inside Node for the build check.

### 4.3 Inside the Table

- When a game's settings say `host: server`, the `Table` creates the host runtime when the
  room opens and gives it the room's host role.
- **The server host is not a client.** It is not in `room.clients` and has no loopback
  socket. The relay calls it directly with parsed frames, and it hands the relay each
  outgoing frame once, already encoded, to fan out. So the emptiness tests of today
  (`clients.size === 0`) stay true for an empty room, and nothing is encoded twice.
- `worker/room.mjs` gains one kind of host: the server. It is never elected away. Stall
  detection and yield do not apply to it. The rate and size caps written for a host that is
  somebody's phone (`LIMITS`, `RATES`) do not apply to its frames.
- A browser never becomes host in such a room. If the host runtime cannot start, the room
  refuses joins and says why. It does not fall back to a browser by itself.
- The rules reach the `Table` in the Worker's own bundle (section 8). They run in the
  `Table`'s isolate (section 10 says what protects it).
- **How the room ticks.** A timer chain inside the object, each tick timed against the
  moment it is due, so lateness does not add up. Each tick runs the phases of section 3.5
  and sends one snapshot.
- **The snapshot.** The whole public state of the room, packed from the declared fields, to
  every player, at `tickHz`. This is today's model. Sending each player only what is near is
  milestone 2.
- **A handler that throws.** The exception is caught. That handler's run is abandoned, the
  error is counted in the log with game, build, kind and handler, and the tick continues.
- **A handler that runs too long** is stopped by the budget (section 10).
- **Size.** Up to 32 seats, today's `SEAT_MAX`. The exit test of slice 7 measures 32 bots and
  the tools state the largest size tested.
- **The log.** Tick figures are added to the relay's log as one line every 10 s, never a
  line per tick.

### 4.4 The wire, and the input protocol

- The frames are today's (`NETPLAY.md` section 5). The contract moves to revision 10 in
  slice 1. Revision 10 adds the server as a host and fixes the frames below for rules games.
  Nothing later in milestone 1 changes them.
- A room and its players share one build hash. A browser whose build differs from the
  room's is refused with `stale` and loads the game again (section 5).

| Frame or field | In revision 10, for a rules game |
|---|---|
| `in` (a seat to the host) | `e`, `k`, `s`, `r` |
| `e` | The room epoch the sender has adopted. 32 bits |
| `k` | The first room tick the frame covers. 32 bits, which a match never fills |
| `s` | One or more entries `[o, ...fields]`. `o` is a tick offset from `k`, rising, and the entry is stamped `k + o`. The fields are the kind's declared `input` fields in order, each in its declared type. For an owner-moved body an entry also carries the claimed `pos`, `vel` and `heading` |
| `r` | The placement counter the sender has adopted. 16 bits |
| `snap` (the host to everyone) | `e`, `k` (the tick just run), `st`, `d` (the packed state, each body with its placement counter), and `c`: one row per seat, `[seat, r, ack, lead]` |
| `ack` | The stamp of the newest entry from that seat that the server had when it ran tick `k`, among entries stamped `k` or earlier |
| `lead` | How early that seat's frames arrived, in sixteenths of a tick, signed, 8 bits. For one frame it is the time from its arrival to the moment tick `k` of that frame was due. The row carries the smallest value among the frames that arrived since the last snapshot. Negative is late. -128 means no frame arrived |

There is no separate sequence number. An entry is named by its tick.

**One step per tick, on both sides.**

- A seat's input is a value that holds from one entry to the next.
- The step for tick `t` is the values of the newest entry stamped `t` or earlier, plus the
  presses of an entry stamped exactly `t`. An `f.press` field is true in one step only.
- So every tick has exactly one step, whether or not anything was sent for it. A tick with
  no entry repeats the held values with every press cleared.
- Server and browser both build their steps by this rule. A `tick` handler reads the step
  as `self.input`.

**What the browser sends.**

- It steps on its own copy of the room's clock (section 6). Each step samples input once.
  A sample that differs from the held values, or holds a press, makes an entry stamped with
  that tick.
- When one drawn frame has to run several steps, the fresh sample goes on the newest. The
  earlier ones hold. A slow device therefore sends no late entries.
- A send period is `n = ceil(tickHz / inputHz)` ticks. At the end of each, the browser sends
  one frame with the entries made in it. `k` is the period's first tick. With `inputHz`
  equal to `tickHz`, the default, `n` is 1 and a frame is one entry.
- A period with no entry sends nothing. After 250 ms without a frame the browser sends the
  held values as an entry on its current tick. That keepalive is an ordinary entry.
- When the tab is hidden the browser sends one neutral entry at once (every field at its
  `init`, no press) and stops stepping. Timers in a hidden tab are too slow to keep input
  alive, and a body must not run on without its player. When the tab shows again the
  browser re-bases (section 6).

**What the server does with an entry** stamped `j`, when the last tick it ran is `K`.

| Case | Test | What happens |
|---|---|---|
| Other epoch | The frame's `e` is not the room's | The frame is dropped |
| Duplicate | `j` is not above the newest stamp it has from that seat | Ignored. It still counts as the player being there |
| On time, or early | `K < j`, and `j` is at most one second ahead | Kept, and applied on tick `j` |
| Too early | `j` is more than one second ahead | This entry and the rest of the frame are dropped |
| Late | `j <= K` | Its values hold from tick `K + 1`. Its presses fire on tick `K + 1` if that is at most a quarter of a second after `j` (`ceil(tickHz / 4)` ticks). Otherwise they are dropped. Nothing is applied in the past |
| Missing | No entry for a tick | The held step, as above |
| Silence | No frame from the seat for one second | Its input is neutral until the next entry. When the socket closes the body is away (section 3.6) |

- **The speed-cheat bound.** The server runs `move` once per body per tick, whatever
  arrives. More frames, or frames stamped ahead, buy no extra step. Input values are clamped
  to their declared types.
- A socket delivers in order, so entries from one seat arrive with rising stamps. A late
  entry never finds a newer one already applied.

### 4.5 The life of a server-hosted room

| Moment | What happens |
|---|---|
| The first person joins | The `Table` creates the relay room, as today, and the host runtime. The epoch is a fresh random number. `room.start` runs and the tick loop starts. The `Table`'s alarm is armed 10 minutes ahead and re-armed every 5 minutes of play |
| People are playing | The tick loop runs. The object is awake because sockets are open and a timer is pending, and Cloudflare bills its duration |
| A player's socket closes | Section 3.6: the body is away, the seat is held 60 s |
| The last person's socket closes | **The room pauses.** The tick loop stops, the clock stops, a save is written (from slice 2), and house guides are sent out (`agents-alone`, as today). The alarm is re-armed for 60 s ahead |
| Only watchers, or only AI seats, remain | Paused, as above. A watcher or an AI never keeps the world ticking, which is today's rule. Watchers see the paused state. A watcher's open socket keeps the object in memory and billed, as it does today (`worker/index.mjs:1535`) |
| A person returns within 60 s | The room resumes at the tick it paused on. No tick is skipped and no timer fires for the gap |
| Nobody returns within 60 s | **The room ends.** The save and the relay's `net` key are deleted and the relay forgets the room, as today's forget does |
| No socket is left | The `Table`'s 250 ms timer stops, as today. Nothing keeps the object in memory, and Cloudflare stops billing duration once it is idle |
| `world.finish()` | Section 3.6. The save is replaced by the fresh match's |
| A restart or a deploy | Section 5. The clock continues from the saved tick. A round is not shortened by the outage |
| A restart, and nobody comes back | The room restores paused, so the rule above applies: it ends 60 s after the pause. Cloudflare stores the alarm, so it fires after a restart too |
| A restart or a deploy before slice 2 is released | No save exists. The room starts a fresh match under a new epoch. Players reconnect into it, and the round in progress is lost. A paused room that Cloudflare has dropped from memory also starts fresh. Section 14 says what this means for releasing slice 1 |
| The rules fail again and again | Section 10: the room ends and the log names the game and build |

- **Deleted when a room ends:** the `save` rows, the `boots` counter and `net`.
- **Kept:** `office` (the owner's bans, holds, banner and closed door) and `recorded`. They
  outlive an empty room today and still do.
- **Never `deleteAll()`.** It would remove `office`, and with the template's compatibility
  date it would remove the alarm too.
- **What keeps the object awake** is only open sockets and the tick timer. Cloudflare bills
  duration while an object is in memory and cannot hibernate; a pending timer prevents
  hibernation. So the pause must clear the timer, and slice 1's exit test measures that an
  emptied room stops being billed.
- **Reconnection.** A client reconnects with its seat token through revision 9's link
  handling. The `welcome` carries the epoch. A client whose epoch differs re-bases: it drops
  its pending entries and takes the state as sent (section 6).

## 5. Durability for one room

**The rule.** A server-hosted room can be restarted at any moment and carries on from a save
that is at most `durability.movementSeconds` old.

- **What is saved.** The whole room state, packed: every entity's fields and motion,
  `shared`, the round, the seats' bodies, pending events and timers, the dice state, the
  clock, the epoch, the last input step applied per seat, the state hash and the build hash.
- **When.** Every `durability.movementSeconds` (1 by default) if anything changed, at the end
  of a round, when the room pauses, and when `world.finish()` runs.
- **Where.** The `Table`'s own SQLite storage, written synchronously in one transaction. A
  save that would pass 2 MB is written as several rows in the same transaction.
- **Recovery.** On waking, the `Table` loads the save and checks the state hash against the
  rules it has. The clock continues from the saved tick: the ticks in between are not
  re-run and not skipped over.
- **The epoch on a restore** is one more than the larger of the saved epoch and the epoch
  in the `boots` row (section 10). It is written to that row before the first tick. So two
  restores from one save never share an epoch.
- **Players.** A restart closes sockets. Clients reconnect with their seat token after a
  random delay of up to 2 s. Until a player is back, their body is away (section 3.6).
- **What a restart can undo.** Up to `movementSeconds` of play: movement, score, pickups.
  A command applied inside that window is undone with it, and the player sees the earlier
  state. Milestone 1 has no items, currency or purchases inside a room, so nothing of value
  exists that needs a write of its own. That arrives with them in milestone 3.
- **Why this is enough for a match.** A restart pauses a room for one to three seconds
  whatever is written. Putting everything back by up to one more second inside that pause is
  hard to tell apart from putting it back by a twentieth of a second.
- **Cloudflare holds a send until the write before it is confirmed** (its output gate). So on
  a tick that saves, that tick's snapshot waits for the confirmation. Test T2 measures the
  wait.

**The state hash** covers everything the save's meaning depends on.

| In the hash | Why |
|---|---|
| Every kind's name, `fields`, `motion` and `input`, and `shared` | The packed state |
| `shapes`: every event, command and effect with its data | Pending events and timers are in the save |
| The names of each kind's handlers for events | A pending event must still have somewhere to go |
| Every kind's `body` and `player` settings, field options (`init`, `score`), `guide`, `room.bots` and `asks` | A body restored with another radius can be inside a wall. A kind switched between owner and server movement would restore in the middle of a claim |
| The map's content hash | Positions and spot names in the save refer to it |
| `space`, `tickHz`, `room.rounds`, `contract` | Ticks and round state in the save are counted in them |

A change to what a handler does, to a tunable or to the view leaves the hash alone.

**What a deploy does to connected players.** Milestone 1 has one Worker, so every deploy
restarts every room object and closes every socket. That is Cloudflare's behaviour and
milestone 3, part A removes it.

| The deploy | The room | The players |
|---|---|---|
| Did not change this game's build hash (a blog post, another game) | Restores and resumes | Reconnect. A pause of one to three seconds. Nothing reloads |
| Changed this game, state hash the same | Restores under the new rules and resumes when the first player is back | Each page reconnects, is told its build is old, loads the game again by itself and takes its seat back. Score and positions are kept, at most one second old. Target: 95% playing again within 5 s |
| Changed the state hash | The save no longer fits. The room ends and its save is deleted | Each page loads the game again and is matched into a fresh room. The match in progress is lost. Target: 95% in a new room within 5 s |

- A page on an old build is never let into the room, so an old `move` never predicts against
  new rules. This replaces today's reload "at the round's break": with one Worker there is
  no old rules build to finish the round on.
- For a rules game the build hash takes the place of `netplay.version` (section 8).
- The build hash covers the game's built rules, view, tunables and map, and nothing else.
  The commit and the time that `lib/build.mjs` stamps (`buildInfo`) are not in it. Slice 2
  tests that two builds of an unchanged game give one hash, so a blog post reloads nobody.
- Changing the state of a running room in place (`migrate`), and letting a match finish on
  the build it started on, are milestone 3.

Browser-hosted rooms keep today's behaviour: the host's checkpoint is stored by the relay at
most every 30 s and handed to the next host, and a new build waits for the room to empty.

## 6. Prediction

The model is the one action games use: inputs stamped with their tick, one server step per
tick, an acknowledgement in every snapshot, replay of what the snapshot does not yet hold,
and corrections that are shown, not teleported. Section 4.4 gives the frames and the
server's side.

### 6.1 The browser's clock

- The browser keeps its own copy of the room's clock and runs a fixed-step loop on it at
  `tickHz`. Each step builds its input step (section 4.4), runs `move` at once, and keeps
  the result, tick by tick, for the last second.
- **It runs ahead**, so that an entry reaches the server before its tick runs. The target
  lead is half a tick plus the jitter it has measured: the gap between the median and the
  5th percentile of its last 40 `lead` values. On a steady connection that is about 0.7
  tick.
- **Holding the target.** The browser takes the median of its last 8 `lead` values. It runs
  its loop faster or slower by 5% for each tick of error, 5% at most. One late frame does
  not move the median.
- **`lead` is measured on a frame's first tick.** With `n` above 1 the oldest entry in a
  frame is up to `n - 1` ticks old when it is sent. Measuring on `k` makes the browser run
  that much further ahead, so the oldest entry is on time and the newer ones are early.
- **The first tick.** When the first snapshot arrives, for tick `k0`, the next step is tick
  `k0 + ceil(rtt / period + target) + n - 1`. `rtt` is the helper's measured round trip
  (`NETPLAY.md` section 7), 100 ms until it has one.
- **Re-basing.** The browser sets its clock again by that rule, drops its pending entries,
  takes its body as the newest snapshot has it, and draws it there with no blend. It does so
  when the epoch changes, when it reconnects, when the tab shows again, after a drawn frame
  longer than a quarter of a second, and when the median `lead` is more than 4 ticks from
  the target.
- **Time ahead.** `ahead` is how far the browser's clock is past the newest snapshot: the
  round trip, plus the lead, plus `n - 1` ticks. At a 90 ms round trip and 20 Hz it is about
  125 ms, 2.5 ticks.

### 6.2 Reconciling

On a snapshot for tick `k` with `ack` for its own seat, the browser does this.

1. It takes its body as the server has it at tick `k`: `pos`, `vel`, `heading`, `grounded`
   and `motion`, exact (section 3.5).
2. It forgets its own steps for tick `k` and earlier, whatever `ack` says. It keeps the
   newest entry stamped `k` or earlier, because its values still hold.
3. **It mirrors late presses.** An entry of its own stamped after `ack` and at or before `k`
   was late. Its presses did not fire. If tick `k + 1` is within the quarter second, the
   browser puts them on tick `k + 1` of the replay, where the server will fire them.
   Otherwise it drops them.
4. It replays ticks `k + 1` to its newest step through `move`, with the steps of section 4.4.
5. It compares the result with what it showed, and corrects the picture (section 6.3).

- When nothing was late and no handler touched the body, the replay lands exactly where the
  prediction was. Server and browser applied the same steps to the same numbers.
- A late press is predicted once, one tick later for each snapshot that still shows it
  late. It is not taken back and predicted again.
- **Not predicted:** everything `tick` handlers and events decide, such as a score or the
  start of a knock, and collisions between entities. The view may play its own press
  animation at once.
- **Same result on both sides.** `move` may call only `ctx.math` and the exact `Math`
  functions of section 3.3, and reads only what the snapshot carries for the body. The build
  check proves it (section 10).
- **Bots and AI seats** are not predicted by anyone. A kind with `move: 'owner'` is not
  predicted either: the browser is the source of its position.

### 6.3 Drawing the own body

- **Between ticks.** On every drawn frame the browser takes its body as of the last whole
  step and runs `move` once more on a copy, for the whole next tick, with the input as it is
  right now. It draws the point between the two, by how much of the tick has passed, and
  throws the copy away. So the stick answers on the next drawn frame, as it does today
  (11.7 ms measured, `NETPLAY.md` section 8), not on the next tick.
- **Corrections.** What the view does with the difference a snapshot makes:

| The snapshot shows | The view |
|---|---|
| The placement counter or the epoch changed, or the browser re-based | Jumps. Other players' views do not interpolate across a placement either |
| The replay lands within `predict.catchM` of what was predicted | Keeps the difference as a visual offset and fades it out over `predict.blendMs` |
| The replay lands farther off: a handler moved the body (a knock, a stun, a pull) | **Catches up.** It draws the body on its corrected path starting at tick `k`, not at the present, and plays that path forward at `predict.catchUp` times normal speed until it reaches the present. The gap between what was drawn and the body at tick `k` goes into the offset |
| The offset would pass `predict.snapM` | Drops the excess: a jump of that much |

- **Why catching up.** The browser learns of a knock `ahead` after it happened. Blending to
  the present would skip the start of it: the hit-stop would never be seen and the body
  would cross metres in a tenth of a second. Playing the path from tick `k` shows the hold
  and the slide whole, a little fast. Today's version does the same thing another way: the
  victim's body is drawn from snapshots for the whole bump (`NETPLAY.md` section 8).
- An effect emitted on the body plays when the body is drawn at the effect's tick, so the
  flash lands on the hold (section 3.4).

| Setting | Default | Why that size |
|---|---|---|
| `predict.catchM` | The distance `body.maxSpeed` covers in 3 ticks | Late input moves the result by at most two ticks of travel per snapshot. More than three is something a handler did |
| `predict.catchUp` | 1.25 | 2.5 ticks behind are made up in half a second, about the length of a knock |
| `predict.blendMs` | 100 | |
| `predict.snapM` | `body.maxSpeed` times (twice `ahead` plus 0.1 s) | The gap at the start of a catch-up is what the body steered while it ran ahead: at most `maxSpeed` times `ahead`. The default is over twice that, so an honest correction never jumps |

At `maxSpeed` 6.8 m/s, 20 Hz and a 90 ms round trip: `catchM` 1.02 m, `snapM` 2.4 m, and
the largest honest gap 0.85 m.

- **Other entities** are drawn in the past, interpolated between snapshots, with today's
  measured, adaptive delay (`NETPLAY.md` section 7). `predict.interpMs` is a floor under it.

### 6.4 The protocol walked through

All four at a 45 ms trip each way and a target lead of 0.7 tick. "Browser at" is the newest
tick it has stepped when that snapshot arrives.

**Steady state**, 20 Hz. The player holds right from tick 100 and presses jump on 103.

| Server tick | Entry it has | Step applied | `ack`, `lead` | Browser at | Replays | Difference |
|---|---|---|---|---|---|---|
| 100 | 100: right, 0.7 tick early | right | 100, +0.7 | 102 | 101, 102 | None |
| 101 | None | right, held | 100, none | 103 | 102, 103 with jump | None |
| 102 | None | right, held | 100, none | 104 | 103 with jump, 104 | None |
| 103 | 103: right and jump | right and jump | 103, +0.7 | 105 | 104, 105 | None |
| 104 | None | right, press cleared | 103, none | 106 | 105, 106 | None |

The next frame is the keepalive on tick 108.

**A 300 ms spike on the way up**, 20 Hz. The last entry before it is 200: right. The player
turns up on 201, presses jump on 203 and turns left on 205. All three frames arrive
together, 15 ms after tick 206 ran.

| Server tick | Entry it has | Step applied | `ack` | The browser, on that snapshot |
|---|---|---|---|---|
| 201 | Newest is 200 | right | 200 | Its entry 201 was late. Replays 202 and 203 on the server's body, which went right for a tick where it had gone up: 0.48 m at 6.8 m/s, into the offset |
| 202 | The same | right | 200 | One more tick of the same difference |
| 203 | The same | right | 200 | Its entry 203 holds a press. 204 is within the quarter second, so the press goes on 204 in the replay |
| 204, 205, 206 | The same | right | 200 | The press goes on 205, then 206, then 207 |
| Arrival | 201, 203, 205, all late | | | The server holds left, from 205, and keeps the press: 207 is 4 ticks after 203, inside 5 |
| 207 | None for 207 | left and jump | 205 | Nothing of its own is after 205. The replay already had left, and the jump on 207. No difference |

- The body went right for six ticks that the player steered otherwise. Each snapshot showed
  one tick of it, and each was blended. That is the cost of the spike, in any action game.
- The predicted jump was pushed back a tick on each snapshot. The drawn body hung near the
  start of its jump and then went. It did not jump, land and jump again.
- The snapshot for 207 carries a `lead` of about -5. The median of 8 ignores it.

**A slow device**, 10 drawn frames a second, 20 Hz. The player pushes left before the second
frame and presses wave before the third.

| Drawn frame | Steps it runs | Entry sent | Server |
|---|---|---|---|
| Clock at 301 | 300 held. 301: sample unchanged | None | 300 and 301 held |
| Clock at 303 | 302 held. 303: left | 303: left, on time | 302 held. 303 left |
| Clock at 305 | 304 held, left. 305: left and wave | 305: left and wave, on time | 304 left. 305 left and wave |

Both sides run the same step on every tick. The device adds no late entries and needs no
extra lead. Two snapshots arrive per drawn frame, and it reconciles with the newer.

**`tickHz` 60 with `inputHz` 20.** `n` is 3 and a period is ticks 600 to 602. The player
turns right on 600 and presses jump on 602.

| Tick | Browser | Wire | Server |
|---|---|---|---|
| 600 | Steps right. Entry at offset 0 | | Runs right |
| 601 | Steps, held | | Runs right, held |
| 602 | Steps right and jump. Entry at offset 2. The period ends | One frame: `k` 600, entries at 0 and 2. It arrives 0.7 tick before tick 600 is due, so `lead` is +0.7 | Runs right and jump. `ack` 602 |
| 603 to 605 | Steps, held | Nothing | Held |

- The entry for 602 arrived 2 ticks earlier than it had to. The browser runs 2 ticks (33 ms) further ahead than
  it would with `n` at 1, and the server's answer to an action is later by up to that much.
- `ahead` is 90 + 12 + 33 = 135 ms, so each snapshot replays 8 steps.

### 6.5 Targets

| Target | Value | Basis | Checked by |
|---|---|---|---|
| Own body answers the stick | Median within 8 ms of today's recorded figure | Section 6.3 | Slice 6 feel check |
| Server answer to own action | Median under 170 ms and 95% under 220 ms, at a 90 ms round trip, 20 Hz | Wait for the next step 0 to 50, 45 up, lead 35 and jitter, 45 down, one drawn frame | Slice 6 exit |
| Another player's action seen | Median under 280 ms and 95% under 350 ms | The same, plus the interpolation delay of about 100 ms | Slice 6 exit |
| The room keeps its beat | 99.5% of the ticks due are run, and 99% of snapshot gaps at a bot in the same region are under 1.5 tick periods | A timer chain in the object | T1, slice 1 and slice 7 exits |
| Play replayed by a restart | At most `durability.movementSeconds` | Section 5 | Slice 2 exit |
| Back in play after a restart | 3 s for 95% of players | Recovery plus reconnect with jitter | Slice 2 exit |

## 7. Browser-hosted mode, offline play and games written before

- The same rules bundle runs on the host's main thread with a fixed-step loop.
- Same wire, same helper. `netplay.ts` calls the host runtime when the relay makes this
  browser the host. The relay, the election and yield-when-hidden stay.
- For offline play, local development and private friends games.
- One area, 32 seats, the host's checkpoint as today.
- The build check runs once per mode.

**Offline play of a server-hosted game.** Today a game with no connection plays on with its
bots. That stays, and it needs the rules in the browser.

| `room.offline` | What the build does | With no connection |
|---|---|---|
| `true` (the default) | The rules are built as a file of their own beside the view. The page fetches it in the background once the game is playable. A standalone app includes it | The helper starts the host runtime in the page, with bots, exactly as browser-hosted mode does for a room of one |
| `false` | The rules and the private tunables never leave the server | The game says it needs a connection |

- The build says which it is in one line: "this game's rules and tunables are sent to
  players' devices so it can be played offline".
- Milestone 1 hides nothing from a browser anyway: every snapshot holds the whole room.
  `false` is for a studio that wants its rules or private tunables kept on its server.
- Nothing played offline is reported to the server.
- With `host: browser` the rules are always in the bundle, because any browser may be host.
- **Standalone apps.** An app is one build for good. Offline it plays from the rules it was
  built with. A server-hosted room runs only the live build, so an app on an older build is
  told to update before it can play online, and plays offline until then. With
  `host: browser`, apps of one older build still meet each other, as today. Keeping every
  build's rules on the server is milestone 3, part A.

**A game written before milestone 1** (`src/main.ts` on today's helper, no `rules.ts`).

- It builds and runs exactly as today, hosted by a player's browser. The build says so in
  one line. Nothing has to be done to it.
- It cannot be server-hosted. `"host": "server"` on such a game fails the build with the
  reason.
- The default `host: server` applies to games that have a `rules.ts`.
- There is one helper, not two. Its host calls (`createNetplay`'s host callbacks, `Roster`,
  `capMove`) stay through milestone 1 because the port toolkit runs on them.
- They are removed in the release of milestone 2 that moves ports onto the host runtime.
  From then a `main.ts` game with host code of its own fails the build, and the message says
  to ask for it to be rewritten as rules plus view. The `game` skill does that as ordinary
  work. There is no migration tool.
- Homie's own starters are converted in slices 6 and 7.

**Ports.** A ported game is someone else's browser code. It keeps running on the helper's
transport layer through the port toolkit's `createRoom` (`port/room.ts`), in a player's
browser, unchanged. The build refuses `host: server` for a ported game and says why.

## 8. Build and deploy

- A rules game is `games/<id>/src/rules.ts`, `move.ts` and `view.ts`, with `game.json`
  (`"entry": "src/view.ts"`), `tunables.json` and `map/`.
- `lib/build.mjs` bundles the view for the browser, as it bundles `main.ts` today.

| Bundle | Holds |
|---|---|
| The view, `host: server` | `view.ts` and `move.ts` |
| The offline rules file, when `room.offline` is true | `rules.ts`, the host runtime, all tunables |
| The view, `host: browser` | Everything |
| The Worker | `rules.ts` and `move.ts` of every server-hosted game |

- For each game with `host: server` the build bundles the rules to one JavaScript module,
  types removed and guards added (section 10), under `site/src/`. The studio's
  `site/src/worker.mjs` imports it. The `Table` looks a game's rules up by game id.
- **The checked file is the deployed file.** The build check reads and runs that generated
  module, not the sources. Wrangler wraps it into the Worker without rewriting it.
- The build stamps each game with its state hash and its build hash. The build hash becomes
  the game's revision in the catalogue.
- A build fails when the rules check fails (section 10).
- **Deploy** is today's `wrangler deploy` of the one Worker. It restarts every object.
  Section 5 is what makes that safe for a running room.
- Existing studios get the new `worker.mjs`, the compatibility flag of section 10 and the
  settings through `lib/upgrade.mjs`.
- **The deploy plan.** `studio_deploy` with `plan: true` adds one line per server-hosted
  game: that its rules run on Cloudflare, and what an hour of play uses of each of the free
  plan's daily allowances (section 11).
- When the studio has built apps of a server-hosted game and the deploy changes that game's
  build hash, the plan also says that installed copies cannot play online until they are
  updated through their store, and play offline until then. `homie-studio deploy` already
  says this for revisions today.
- Loading rules from file storage without a Worker deploy, keeping every build, and splitting
  the site from the rooms are milestone 3, part A.

**`game.json`: what is new and what stays.**

| Setting | For a rules game |
|---|---|
| `players.max` | Still the room's seats, read by `seatsOf` as today. There is no second seats setting |
| `"room"` | New. Only the settings of section 11 |
| `netplay.v`, `netplay.public`, `netplay.params` | Unchanged |
| `netplay.movement` | Not read. Movement is a per-kind choice in the rules |
| `netplay.version` | Not read. The build hash is the revision. The build says so in one line if the field is present |
| `netplay.stallMs` | Read in browser-hosted mode only |
| `roundSeconds` | Not read. `room.rounds` in the rules is the round |

## 9. Local development

- `homie-studio dev` builds and runs the Worker under local Wrangler, as today. A
  server-hosted room runs in the local `Table`.
- Saving a rules file rebuilds and restarts the local Worker. Local rooms restore from their
  save, from slice 2. A save that changes the state hash resets local rooms and says so in one line.
- The Game Lab runs two variants side by side in browser-hosted mode on one seed. Its
  sliders are the tunables, its stage is `world.stage`, and its phases come from the view
  (section 3.8).
- The build check runs the rules in Node with no Cloudflare at all.

## 10. Enforcing AI-written rules

The author is an AI and the person asking is not a programmer. The checks must not depend on
tests the same AI wrote, and a failure must be explained in the game's own words.

**What the wall is in milestone 1, and what it is not.**

- The rules of a studio's own games run in the same isolate as the studio's Worker. That
  isolate holds the site, the accounts and shop database, Workers AI and the secret that
  verifies the owner's controls (`worker/index.mjs:1190`).
- There is no sandbox yet. The wall is made of language restrictions, checked and rewritten
  at build, plus the fact that rules are handed a `world` object and nothing else.
- It is built against a careless module written by the studio's own AI. It is not a
  security boundary against code written to attack. No rules from outside the studio run on
  its server: parts stay client code, as today.
- A player cannot get code into the rules. Inputs are typed numbers and bits, nothing is
  evaluated, and no text a player sends becomes a property name.

**Where isolation belongs.** Milestone 3, part A. The `Table` itself uses the database,
Workers AI and the control secret for every room, so a rooms Worker with none of them means
proxying all three, which is the site and rooms split of milestone 3. The locked box also
needs the paid plan.

**What a mistake in the rules can and cannot do until then.**

- It cannot read or write accounts, purchases, or another room's state. Rules hold a
  `world` object and nothing else.
- It can stop its own room.
- It can cost the studio's other rooms time, or a restart. Cloudflare may run many objects
  of one class in one isolate, where they share 128 MB and one thread (its pricing page,
  footnote 5, and its metrics page). Every room of every game of a studio is a `Table`.
- The measures below bound that. The last table of this section says what is left.

**In the build, with the line named.** A parser pass over the bundled rules, with source
maps. It is scope-aware: it tells a global from a field of the same name. It ships in slice
1, because a server-hosted room is never released without it.

- **Globals are an allowlist of named functions.** Rules may name only these.

| Global | What rules may use |
|---|---|
| `Math` | The exact functions of section 3.3 |
| `Number` | `isFinite`, `isInteger`, `isNaN`, `MAX_SAFE_INTEGER`, `EPSILON`, and the call `Number(x)` |
| `Object` | `keys`, `values`, `entries` |
| `Array` | `isArray`, and array literals with their methods |
| `String`, `Boolean` | The calls `String(x)` and `Boolean(x)` |
| `Map`, `Set` | Inside a handler only |
| `Error` | To throw |
| `Infinity`, `NaN`, `undefined` | |

- Every other global is refused by name: `JSON`, `BigInt`, the typed arrays, `Symbol`,
  `Date`, `Intl`, `RegExp`, `WeakRef`, `FinalizationRegistry`, `WebAssembly`,
  `SharedArrayBuffer`, `Atomics`, `Proxy`, `Reflect`, `globalThis`, `eval`, `Function`,
  `fetch`, timers, `performance`, `crypto` and whatever a future engine adds. So
  `Object.getPrototypeOf`, `defineProperty`, `setPrototypeOf` and `assign` are not there.
- **Methods are an allowlist too.** On an array: `push`, `pop`, `shift`, `unshift`, `slice`,
  `splice`, `concat`, `indexOf`, `lastIndexOf`, `includes`, `find`, `findIndex`, `some`,
  `every`, `map`, `filter`, `reduce`, `forEach`, `flat`, `flatMap`, `sort`, `reverse`,
  `join`, `at`. On a string: `slice`, `indexOf`, `includes`, `startsWith`, `endsWith`,
  `split`, `trim`, `toUpperCase`, `toLowerCase`, `charCodeAt`, `at`. On a `Map` or `Set`:
  `get`, `set`, `has`, `add`, `delete`, `clear`, `forEach`, `keys`, `values`, `entries`.
  Any other method name is refused.
- **A method may be called, never read as a value.** So no built-in function object reaches
  rules, and none can have state hung on it.
- **Refused syntax:** imports other than Homie's and the game's own files; `import()` and
  `import.meta`; `async`, `await`, generators; `class`; `this`; `try`, `catch` and `finally`;
  regular expressions; the `**` operator; `with`; `delete`; getters and setters.
- **Refused names:** the property names `constructor`, `prototype`, `__proto__`, `stack`,
  `localeCompare` and anything beginning `toLocale`; any identifier beginning `__homie`.
- **Every place a property is named is covered.** The refused names are refused in `a.b`,
  in `a?.b`, as a key in a destructuring pattern (`const { constructor: c } = x`), as a key
  in an object literal (`{ __proto__: y }`), as a shorthand and as a string-literal key.
- **Refused writes:** module-level `let` or `var`; assignment to anything module-level or to
  any member of a global.
- **Nothing of the game's runs at load.** The top level of a rules file may hold imports,
  constants made of literals, function definitions, and calls to Homie's `defineRules`,
  `defineMove` and `f`. It may not call a function of its own. So no closure exists that
  could hide state, whether in a variable or in a property of a captured object.
- Module-level constants are deep-frozen at load.
- **Computed access is guarded.** The build rewrites every computed key in rules: `a[b]`,
  `a?.[b]`, a call through either, `const { [k]: v } = x` and `{ [k]: 1 }`. A read is allowed
  when the key is a number, or a string naming an own property that is not a function. A
  write is allowed when the key is a number, or a string other than the refused names.
  Anything else throws, naming the line. So a string built at run time cannot reach a
  prototype, a constructor or a method.
- **A budget is injected.** The build adds a counter to every loop and every function in
  rules, and wraps the call sites in the table below. The host runtime sets the counter
  before each handler. When one handler has used a quarter of `budget.tick`, the counter
  throws and the runtime abandons that handler, as for any throw. Rules cannot catch it,
  because rules cannot contain `try`.

| What runs | Units charged |
|---|---|
| A loop turn. A call of a function in rules | 1 |
| A `world.math` or `ctx.math` call | 2 |
| `world.send`, `emit`, `spawn`, `after`, `place` | 10 |
| `world.near`, `world.inBox`, `world.sendArea` | 20, and 2 for each entity examined |
| `world.ray`, `world.sweep`, `ctx.map.sweep` | 20, and 4 for each shape tested |
| An allowed method call, a spread, `Object.keys`, `values` or `entries` | 1, and 1 for each element or character read or made. `sort` is charged 16 times that |
| A string made by `+` or by a template | 1 for each character |

- **A size cap.** No array, string, `Map` or `Set` in rules may pass 65,536 entries. The
  wrapper refuses the call that would make one. So `a = a.concat(a)` stops on its 17th turn,
  and one handler can hold a few megabytes at most.
- **When a tick has used `budget.tick`**, it ends early. `move` has run for every body,
  because it runs first. Handlers not yet run are skipped. Events not yet run stay queued,
  in order, for the next tick, so none is lost. Phase 2 starts from a different entity each
  tick, so the same ones are not starved.
- **The browser runs the same file.** The `move` in a view's bundle is the guarded, counted
  module the server runs, not the source.
- **Evaluation is off.** The template sets the compatibility flag
  `disallow_eval_during_startup`, so no code is made from a string while a module loads.
  Cloudflare never allows it later.
- **`world` has no way out.** `world`, `ctx` and everything reachable from them are plain
  frozen data and functions made by the host runtime. A test walks every property and
  prototype reachable from them and fails if it finds the `Table`, its storage, `env` or the
  relay.
- Type checking of rules is part of the build from slice 4, always, with a compiler Homie
  ships. `self` is the only writable parameter type. `shapes` types every send. `move`'s
  types expose only what section 3.5 lets it read.
- Query radii against the reach. Declared sizes against the save's row size.

**What protects the studio's other rooms.**

| Failure | What bounds it |
|---|---|
| A loop or recursion that never ends | The budget: the handler stops after a quarter of `budget.tick` |
| A handler that is slow without looping: thousands of queries, sweeps or sorts | The weighted charges |
| Memory taken inside one handler | The size cap and the charges |
| Memory kept from tick to tick | Not possible. All state is declared with sizes, and the build states each game's largest state |
| The budget tripping on every tick for two seconds | The room ends, and the log names game, build, kind and handler |
| A tick slower than its period, again and again, without tripping the budget | The overrun check below |
| Anything else that makes Cloudflare reset the isolate | The boot counter below. Cloudflare's own limit is 30 s of processor time between messages (its limits page) |

- **The overrun check.** Time inside a Worker stands still while code runs, so a tick cannot
  time itself. Each tick, as it starts, reads the clock and notes in the Worker's own module
  memory which room it is and when it started. A tick that starts more than a period late
  blames the tick that ran just before it in that isolate, which may be another room's. A
  room blamed on every tick for 5 s ends, and the log names its game, its build and the
  handler that used the most units. The other rooms in the isolate ran slow for those
  seconds.
- **The boot counter** is the last line, for a reset that nothing above explains. A restored
  room adds one to `boots` in storage when it starts ticking, and clears it after 10 s of
  ticking.
  - At 2 the room waits before it ticks, for a time taken from its id, up to 30 s. Rooms
    that share an isolate then stop failing in step, and a room that is not the cause
    usually gets its 10 clean seconds.
  - At 3 it does not restore. It ends, its save is deleted, and its players are matched into
    a fresh room.
  - The log line says "restore loop" with that room's game and build. It also says that the
    room shares its isolate and may not be the cause. A budget or overrun line, if there is
    one, names the cause.
- **What is left.** A room that shares an isolate with a failing one can be slowed for a few
  seconds, restarted, and in the worst case ended by the boot counter. That lasts until
  rules leave the isolate in milestone 3, part A.

**At run time, in the check and in development.** Query results and event data are frozen
objects. A write throws with a stack, whatever the types said. In production the same objects
are read-only views.

**Generated tests** (slice 4). For every game the check runs seeded bots (wander, chase,
mash) in a Node worker thread, with:

- two runs compared tick by tick; a difference is reported as the first field that differs
  and the handler that wrote it;
- **two copies side by side on every tick: one kept running, one rebuilt from its saved state
  before each tick**, compared by a digest of the packed state. Any state that is not in a declared field shows
  up on the first tick that uses it. This is the proof that section 5 loses nothing it should
  keep;
- a kill and restore at random ticks, compared with an unbroken run;
- **`move` replayed** (from slice 6): a second copy of every player's body is stepped from each snapshot
  through `move` alone, as a browser would, and must land where the server's did when no
  handler touched the body;
- **every `move` from rest**, with every `motion` field at its `init` and each extreme of
  each input field, for two seconds: a ground speed above `body.maxSpeed` fails;
- a time limit and a memory limit on the thread, which is ended from outside when either is
  passed, so the build fails with the handler's name.

**The planted-fault file** of slice 4's exit test holds fifteen faults, each of which must
be named with its line: a global `Date`; `Math.sin`; the `**` operator; a module-level `let`;
a function of the game's called at load; a write to a query result; an `await`; an event sent
without being declared; a built string used to reach `constructor` through `a[k]`; the same
through `a?.[k]`; `const { constructor: c } = x`; an object literal with a `__proto__` key; a
loop that never ends; an array doubled with `concat` in a short loop; a loop of `world.near`
calls that passes the budget.

**Built-in invariants**, every tick of every run: no NaN, positions inside the world,
declared sizes respected.

**Messages** are written for the chat: what broke, in the game's words, the line, and the
usual fix.

**The skill.** Section 14 says what the `game` skill writes at each slice.

## 11. Settings, plan and cost

Settings live in `game.json` under `"room"`. Each has a default. Seats stay `players.max`
(8 by default, 1 to 32; milestone 2 goes past 32).

| Setting | Default | Limit | Why the limit exists | Growing past it |
|---|---|---|---|---|
| `host` | `server` | `server`, `browser` | | |
| `offline` | `true` | `true`, `false` | | |
| `tickHz` | 20 | 1 to 60 | T1 tests 20 and 30. The tools state the highest rate tested | Roadmap section 6.1 |
| `inputHz` | `tickHz` | 1 to `tickHz` | Each frame is a billed message. Below `tickHz`, the server's answer to an action is later by up to one send period (section 6.4) | |
| `durability.movementSeconds` | 1 | 1 to 60 | The most play a restart may replay. A save on every tick would hold every snapshot behind a write; it arrives with the per-value writes of milestone 3 | |
| `budget.tick` | 2,000,000 units | Any | A tick must finish inside its period (section 10) | Raise it |
| `predict.catchM`, `predict.catchUp`, `predict.snapM` | Section 6.3 | Any | | |
| `predict.blendMs` | 100 | Any | | |
| `predict.interpMs` | One send period | Any | A floor under the measured delay | |

**Cloudflare plan.** Milestone 1 uses Workers, Durable Objects with SQLite, D1 and static
assets. All are on the free plan (roadmap section 4). Durable Objects have three daily
allowances there, and no allowance on processor time (the pricing page).

| Free allowance, per day | What uses it | About |
|---|---|---|
| 100,000 requests | Incoming socket messages, billed 20 to 1. At most 20 inputs a second is 3,600 a player-hour, and pings add 90. A player standing still sends 4 a second | 27 player-hours: about three and a half hours of a full 8-player room |
| 13,000 GB-s of duration | An awake object is billed as 128 MB: 460.8 GB-s a room-hour | 28 room-hours |
| 100,000 rows written | 3,600 saves a room-hour at the default, and 12 alarm settings | 27 room-hours |

- Browser-hosted rooms use the first two the same way today, because every message already
  passes through the `Table`. The third is new with server hosting.
- When an allowance runs out, Cloudflare fails further operations of that kind until
  00:00 UTC. Out of requests, that is every room of every game and the `Lobby`, not only
  the busy room.
- The processor limit is per message, 30 s, on both plans. It is not a daily allowance.
- Nothing is refused because of a plan. The studio is told, and chooses.
- `world.ask` runs on today's `decide` path, which still applies Homie's daily AI allowance
  (`worker/index.mjs:1211`). That allowance becomes the studio's own setting in milestone 6.

**Cost of one 8-player match for an hour**, from the list prices in roadmap section 4.

| Part | Arithmetic | Cost |
|---|---|---|
| One object awake | 0.128 GB × 3,600 s = 460.8 GB-s × $12.50 per million | $0.0058 |
| Input | 8 × 3,600 = 28,800 requests × $0.15 per million | $0.0043 |
| Saves | 3,600 rows × $1.00 per million | $0.0036 |
| **Total** | | **$0.014**, or $0.0017 per player-hour |

A 32-player match is $0.027 an hour by the same lines. This informs. Homie limits nothing
because of it.

## 12. Tests on real Cloudflare

Local numbers do not transfer: local objects share one process and local clocks behave
differently. Each test has a pass line and a fallback.

| | Runs in | Question | Pass | If it fails |
|---|---|---|---|---|
| T1 | Slice 1 with 8 bots, slice 7 with 32 | **One ticking room.** A `Table` running the host runtime at 20 Hz for 20 minutes in one region, then at 30 Hz. Measured from outside: bots count the tick numbers they receive and time the gaps between snapshots. Measured from Cloudflare's analytics for that object: processor time, requests, GB-s and rows written | At 20 Hz with 8 bots: 99.5% of the ticks due are run, and 99% of snapshot gaps are under 75 ms. Requests and GB-s per room-hour are within 10% of section 11. An emptied room stops being billed. Processor time, rows written (12 an hour before slice 2), 30 Hz and 32 bots are findings. T1 also settles open points 1 and 2 of section 16 | The tools state the largest size and rate that pass. A game that asks for more is told the tested figure. Past it, milestone 2 |
| T2 | Slice 2 | **Saving.** Rows written per room-hour, against section 11. One save of 4 KB, 64 KB and 1 MB a second at 20 Hz with sends to 8 and 32 sockets, for an hour. How long a snapshot is held on a tick that saves, timed by the bots. 200 restarts forced through a Preview-only route that calls `ctx.abort()`: what is lost | A hold of one tick period or less at the 99th percentile for 64 KB. Nothing older than `movementSeconds` lost. Rows within 10% of section 11 | A longer hold: the save is written through the key-value `put()` with `allowUnconfirmed`, which the SQLite-backed storage page lists, and snapshots are not held. A confirmed save lost would contradict Cloudflare's documentation; server hosting does not ship until Cloudflare resolves it |

- Time inside a Worker does not advance while code runs, so neither test times a tick from
  inside the object.
- 60 Hz and other regions are measured in milestone 2 (spike S6).
- The other real-Cloudflare measurements of milestone 1 are the exit tests of its slices
  ([rooms-plan.md](rooms-plan.md)).

## 13. What was challenged, and where it went

A match room is deleted when it ends. So milestone 1 stores nothing that a later Homie must
read, and leaving something out cannot force a rewrite of stored data. The test for each item
is therefore: would a game's rules have to be rewritten, or would milestone 1 be unsafe or
broken for a studio shipping a public game?

**Kept, each in its smallest form.**

| Kept | Smallest form | What it prevents |
|---|---|---|
| A handler writes only `self`; anything else is an event on a later tick | The rule, and an event queue | Every game rewritten when a room has many areas |
| Queries have a reach; no list of all entities | A radius argument | Same |
| All state in declared, typed, bounded fields; no module state | The `f` types and the check | Every game rewritten when state is journalled or handed between areas. Also needed now, for the save |
| `shapes` declares events, commands and effects | The declaration | Every game rewritten when the wire carries its own description |
| `shared` written only in room scope; `room.join` pure | The rule | Every game rewritten when the room's centre and its areas are different objects |
| Rounds, results, seats and bots are declared, and the runtime runs them | `room.rounds`, `room.bots`, `score: true` | Every game rewritten when results come from many areas. Also keeps today's round stats |
| Metres, with `x`, `y`, `z` | The convention | Every game's numbers, when areas and view distances are sized |
| The strict allowlist and maths list | The check, and `world.math` | Loosening later is free. Tightening later breaks games |
| `move` in its own file, reading only the body, its `motion`, its input, the map, public tunables and the tick | One file and one field group | Every game rewritten when the browser must not receive the rules, or when a body is handed between areas |
| One input step per tick, stamped with its tick and acknowledged | The `in` and `snap` frames of revision 10 | A second wire revision, and every view's prediction |
| `contract: 2` | One field | Lets later tools recognise and update a module |
| Ids are opaque | `f.ref` | Every game that did arithmetic on ids, when ids gain a block number |
| The state hash and build hash in the save | Two fields | Not a rewrite. Needed now, to end a room whose save no longer fits |
| The allowlist pass, the guarded access and the budget | One module in slice 1 | Not a rewrite. Without them a server-hosted room is unsafe to ship |

**Moved. None forces a rewrite of a game or of stored data.**

| Item | Why it can wait | Milestone |
|---|---|---|
| The sandbox: rules as a Durable Object Facet or Dynamic Worker; spike S1 | Where rules run is invisible to rules. Until then rules come only from the studio's own build, behind section 10 | 3, part A |
| Rules bundles in R2, the Builds object, rules deploys with no Worker deploy, rolling back a rules-only change, a match finishing on its own build, old app builds playing online | A deploy restarts rooms and section 5 carries them through | 3, part A |
| Two Workers (site and rooms) | Same. Cloudflare can transfer a class between Workers, and no match room outlives the move | 3, part A |
| The rest of the guard: Cloudflare's hard stop per call, quarantine of one entity, restoring a thrown handler's fields, `try` allowed in rules, the emptied global scope | All are properties of the sandbox. The step counter itself is in milestone 1 | 3, part A |
| The plan check and the paid-plan wording | Milestone 1 uses nothing sold only on the paid plan | 3, part A |
| A journal row per commitment, the ring, pages, the outbox; spike S2 in full | There is no value and no second object yet. The save covers plain fields | 3, part B (the outbox between areas in 4) |
| The platform simulator | It proves protocols between objects. Milestone 1 has one object. The build check's rebuild-every-tick run and T2 cover it | 3, part B |
| `profile` | A module that names none is a `match` module | 3, part B |
| Calendar time (`world.now`, `f.time`, `world.at`) and `tickHz: 0` | Additions. A paused room's clock simply stops | 3, part B |
| A save on every tick (`durability.movementSeconds: 0`) | Milestone 1 holds nothing of value, and one second is its smallest setting | 3, part B |
| The wire carrying its own schema | A room and its players share one build | 3, part B |
| Spike S10 in full, and coverage reporting | Slices 4 and 8 run small authoring tests | 3, part B |
| `homie-studio measure` | It reruns spikes that have moved | 3, part B |
| Field visibility (`see`) and `tell` | Additions. Each player's snapshot is encoded separately in milestone 2 | 2 |
| `uses` and the capabilities `attach` and `solid` | Additions | 2 |
| Room passes and resume tokens | Today's seat tokens serve one object | 2 |
| The Table's jobs as separate roles | A change to runtime code, not to games | 2 and 4 |
| Spike S6, the soft tick budget, 60 Hz and other regions | Milestone 1 measures only its own sizes (T1) | 2 |
| Seats above 32, `guests.perAddress` | Today's figures stay | 2 |
| Game files in R2, files over 25 MiB | Unrelated to where rules run | 2 |
| Map zones, triangle meshes, the navigation mesh | Additions to the map | 2 |
| `move` compared across browser engines | Prediction error is corrected by the smoothing | 2 |
| The kit of rule pieces | The starters are the examples the skill copies | 2 |
| `homie-studio swarm` | The exit tests use a bot client in the repository | 2 |
| The port toolkit on the host runtime, the `port` skill's second grade, and the removal of the helper's old host calls | Ports and older games run unchanged in a player's browser | 2 |
| Tallies | `world.sendRoom` counts in one object | 4 |
| Class copies, the copy number in ids, spike S3 | A match room's id does not outlive the match | 5 (the field arrives with the first long-lived objects in 3) |
| The two AI budgets as studio settings | Unrelated to where rules run | 6 |
| Gradual rollouts of the Worker, spike S7 | A deploy restarts every room once; section 5 carries them through | 7 (the site-deploy question of S7 in 3, part A) |
| Metrics, `perf` calibration, `replay`, flags | The relay's log gains aggregated tick figures | 7 |

## 14. Slices, changes and sizing

The slices and their exit tests are in [rooms-plan.md](rooms-plan.md).

**Order.**

| Slice | Needs | Why |
|---|---|---|
| 1 | Nothing | |
| 2, 3, 4, 5 | 1 | Each can be built at the same time as the others. Where two change one file (`host.ts`, `netplay.ts`, `build.mjs`) they change different parts of it |
| 6 | 2, 3, 4 and 5 | It turns a starter that studios already use into a server-hosted game, so the save must be there |
| 7 | 6 | |
| 8 | 7 | |

- **Why 3 and 4 need only 1.** Packing the whole state into bytes and building a room back
  from them is in slice 1 (`rules/pack.ts`, `rules/host.ts`), with no storage. Slice 3's
  hand-over to a new browser host and slice 4's rebuilt-every-tick run use exactly that.
  Slice 2 adds the storage, the state hash, the deploy path and T2.
- **What slice 1 does on a restart.** It has no save. A restart or a deploy starts a fresh
  match in every server-hosted room (section 4.5). Today's browser-hosted room survives a
  deploy, so that would be a step back for a studio's game.
- **So slice 1 is released with no studio game on it.** `coin-dash` is in the package and
  the test studio runs it. `game_make` offers it once slices 2 and 4 are both released, and
  no starter is server-hosted before slice 6.

**What each slice changes in today's code.**

| Slice | New | Changed |
|---|---|---|
| 1 | `rules/` (`rules.ts`, `core.ts`, `math.ts`, `pack.ts`, `host.ts`, `view.ts`), `lib/rules-guard.mjs` (the parser pass and the rewrites), `starters/coin-dash/`, `test/rules-view.test.mjs`, `test/bot-client.mjs` (the headless socket client that T1 and the exit tests use), `lib/cf-usage.mjs` (reads Cloudflare's analytics for one object) | `worker/index.mjs` (the `Table` starts the host runtime; pause, end and alarm of section 4.5). `worker/room.mjs` (the server host). `netplay/netplay.ts` (the revision 10 `in` and `snap` frames). `netplay/NETPLAY.md` (revision 10). `port/probe.ts` (probes from the view library). `lib/build.mjs` (rules built into the Worker; `entry`). `lib/check.mjs`, `lib/shoot.mjs`, `lib/perf.mjs` and the playtest judge (`plugins/homie/skills/playtest/scripts/lib/judge.mjs`): a room with no browser host is valid, and tick figures come from the room's watch feed. `template/wrangler.jsonc` (the flag), `template/site/src/worker.mjs`, `lib/scaffold.mjs`, `lib/upgrade.mjs`, `lib/studio.mjs` (the `"room"` settings). `lib/mcp-tools.mjs` (the deploy plan's line). `plugins/homie/skills/game/SKILL.md` (one paragraph on a game that has a `rules.ts`) |
| 2 | | `rules/host.ts` (when to save, restore on waking, the state hash). `worker/index.mjs` (the save in SQLite storage, the boot counter, the Preview-only restart route; the `Lobby` matches on the build hash and rematches players when a room ends). `lib/build.mjs` (stamps the two hashes into the catalogue). `worker/room.mjs` (`stale` at once for a rules game; the 30-second checkpoint stays for browser-hosted rooms only). `netplay/netplay.ts` and the play page (reload on a new build hash) |
| 3 | | `netplay/netplay.ts` (the host path and the offline path call the host runtime). `lib/build.mjs` (the offline rules file). `lib/standalone.mjs`, `lib/standalone-files.mjs` (apps include it). `lab/lab.ts`, `lib/lab.mjs`, `lib/lab-check.mjs` (tunables into the host runtime, `world.stage`). The `lab` and `standalone` skills |
| 4 | `lib/rules-check.mjs` (generated runs, invariants, messages) and its worker-thread runner, `test/authoring.mjs` (runs fixed requests through the skill with nobody attending; slice 8 uses it too), `plugins/homie/skills/game/RULES.md` (the reference page) | `lib/typecheck.mjs` (always on for rules; `entry`), `lib/build.mjs`, `lib/mcp-tools.mjs` (`check` runs it; `game_make` offers `coin-dash` once slice 2 is also released). `plugins/homie/skills/game/SKILL.md` (a section on editing a rules game) |
| 5 | | `rules/host.ts` with `agents/agents.ts`, `worker/agents.mjs` and `worker/brain.mjs` (AI seats, guides, `world.ask`). `test/agents.test.mjs`, `test/watch.test.mjs`, `test/rooms-and-stats.test.mjs`, `test/servers.test.mjs` |
| 6 | The feel check in `test/` | `rules/core.ts`, `rules/host.ts` (the server runs `move` for every body). `netplay/netplay.ts`, `rules/view.ts` (the step loop, lead, replay, smoothing). `starters/gem-rush/src/main.ts` becomes `rules.ts`, `move.ts`, `view.ts`. `starters/coin-dash` drops `move: 'owner'`. `lib/rules-check.mjs` (the `move` replay run) |
| 7 | | The three starters' `src/main.ts`. `rules/core.ts`, `rules/math.ts` (3D). `netplay/NETPLAY.md` gains the rules format; its version 1 text stays until milestone 2 removes the helper's host calls. `test/netplay.test.mjs`, `test/starter-3d.test.mjs`. The `animate` skill |
| 8 | | `plugins/homie/skills/game/SKILL.md` rewritten. `lib/mcp-tools.mjs` (`game_make`, `game_plan`). One-line fixes in the `parallel`, `perf`, `playtest`, `port`, `servers` and `video` skills |

**What the `game` skill writes at each release.** It never writes less than it does today.

| After slice | A new game | A change to an existing game |
|---|---|---|
| 1 to 3 | Today's format, as today | A `main.ts` game as today |
| 4 to 7 | Today's format, as today. Once slice 2 is also out, `game_make` can copy `coin-dash` | A rules game is edited as rules plus view, from the reference page and under the check. A `main.ts` game as today. Converted starters are rules games |
| 8 | Rules plus view | A rules game as rules plus view. A `main.ts` game as today, or rewritten as rules plus view when asked |

**The scale** is in [rooms-plan.md](rooms-plan.md). In short: XS is a change inside one
module; S is one new module or a tenth of `netplay.ts` or `room.mjs`; M is two to four
modules, a quarter of either file, or one starter; L is five to ten modules or a wire
revision or a new kind of object, across helper, relay, build and skill; XL is more than ten
modules and several kinds of object.

| Slice | Size | What gets built | Why that size |
|---|---|---|---|
| 1 | L | The six `rules/` modules, with the whole state packed and unpacked; the guard pass; the `Table` as host with its life cycle; the server host in `room.mjs`; the revision 10 frames; build wiring and template; the tools reading a room with no browser host; `coin-dash` with rounds and bots; the bot client; T1 | Seven new modules, a wire revision, changes in the helper, the relay, the build and the template. The largest slice |
| 2 | M | The save in storage and the restore from it; the state hash; the deploy sequence; the boot counter; T2 | No new module, so the scale alone says S. Two real-Cloudflare tests and the reload path make it M |
| 3 | M | The host and offline paths of `netplay.ts` on the host runtime; the offline rules file; standalone; the Lab | About a quarter of `netplay.ts` reworked |
| 4 | M | `lib/rules-check.mjs` and its runner; always-on type check; the reference page | Three new modules |
| 5 | M | The runtime side of section 3.10: goals, views, floors, asks and `world.ask`; a test for every room feature with the server as host | No new module. About a quarter of `host.ts` and of the agents code. The format itself is slice 1's. Judged M |
| 6 | L | `move` on the server for players; the browser's clock, replay, catch-up and drawing of section 6; `gem-rush` converted; the feel check | A starter, plus the replica path of `netplay.ts`, plus a new test harness |
| 7 | L | Three starters (6,015 lines); 3D in the core; the rules format in `NETPLAY.md`; tests | Three starters is three times M |
| 8 | M | The `game` skill rewritten (366 lines); `game_make`; six skills corrected; the authoring test | No new module. Judged M: every new game depends on it |

The scale counts modules. For slices 2, 5 and 8 it gives a smaller letter than the work
deserves, and the letter given is a judgement.

**Engineer effort, as secondary information.** The figures are person-weeks for experienced
engineers. Homie is built by AI agents in parallel, so they do not give a calendar date. They
are derived from the slices, item by item.

| Slice | Items | Total |
|---|---|---|
| 1 | Format and field types 1; core with rounds, seats, bots and away 3; maths 1; packing, with the whole state in and out, 1.5; host runtime with the input queue and the host's relay duties 2; the `Table`, its life cycle and the relay's server host 2; view library and probes 2; guard pass and its rewrites 2.5; build, template and upgrade 1; `check`, `shoot`, `perf` and the judge 0.5; `coin-dash` and its map 1.5; T1 and the exit test 1 | 19 |
| 2 | The save in storage, restore and the state hash 1; pause, end and epoch on restore 1; reconnect, the reload on deploy, stale and the boot counter 1.5; T2 and the restart tests 1.5 | 5 |
| 3 | Host path in the helper 1.5; offline, the rules file and standalone 1.5; the Lab 1; exit test 0.5 | 4.5 |
| 4 | Type check 0.5; generated runs and invariants 2.5; messages 0.5; reference page and the skill's section 1; the planted-fault and edit tests 0.5 | 5 |
| 5 | AI seats and guides 1.5; `world.ask` 0.5; the level dial, watchers' follow and speech 1; a test per feature 1.5 | 4.5 |
| 6 | Prediction 3; `move` on the server and the 2D map sweep 1; `gem-rush` 2.5; the feel check 1 | 7.5 |
| 7 | 3D bodies and height map 2; three starters at 2.5 each 7.5; contract text, tests and exit tests 2 | 11.5 |
| 8 | The skill and `game_make` 1.5; six skills 0.5; the authoring test 1 | 3 |
| **All** | | **60.5, stated as 55 to 66** |

- A starter is put at 2.5 because each is a file of 1,087 to 2,627 lines to split in three
  and hold to its feel.
- Slice 1 is 19. The first release a studio's own game runs on is slices 1, 2 and 4: 29.
- No figure includes a reserve. If T1 or T2 fails, its fallback adds work.

## 15. The contract against the starters' hardest movement

Two cases, written against sections 3 and 6 and worked out from the starters' own code and
constants. Both are test fixtures for slices 6 and 7. They are excerpts: each shows the
movement file whole and the parts of the rules that touch movement. Gems, the hot zone and
the bots' `think` are left out.

Lengths in `gem-rush` are pixels today. The converted game uses metres at 50 pixels a metre,
which gives the numbers `gem-rush-3d` already has: speed 340 px/s is 6.8 m/s, radius 22 px is
0.44 m, `knockDistance` 185 px is 3.7 m, `knockRange` 110 px is 2.2 m.

### 15.1 `gem-rush`: the knock

Today the host takes the body with `net.take`, holds it for the hit-stop, then slides it a
fixed distance on an eased curve and lands it exactly (`starters/gem-rush/src/main.ts:403-428`).

```ts
// games/gem-rush/src/move.ts
import { defineMove } from '@homie-rocks/studio/rules';
const SPEED = 6.8;                                       // today's 340 px/s
function flatStep(body, input, ctx) {                    // this tick's move on the ground plane
  const m = body.motion, T = ctx.tune, M = ctx.math;
  if (m.knockAt > 0) {                                   // knocked: the stick is ignored
    const last = ctx.tick + 1 >= m.knockUntil;           // the step that ends the slide lands it exactly
    const u = M.clamp((ctx.tick - m.knockAt) / (m.knockUntil - m.knockAt), 0, 1);   // 0 through the hit-stop
    const e = last ? 1 : 1 - M.pow(1 - u, T.knockEase);  // fast at first, easing into the stop
    const to = M.add(m.knockFrom, M.scale(m.knockDir, T.knockDistance * e));
    if (last) m.knockAt = 0;                             // the stick is back on the next tick
    return { x: to.x - body.pos.x, y: to.y - body.pos.y, z: 0 };
  }
  const flat = { x: body.vel.x, y: body.vel.y, z: 0 };
  const want = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), SPEED);
  const keep = M.pow(1 - 14 / 60, ctx.dt * 60);          // today's smoothing, the same curve at any tick rate
  const v = M.add(want, M.scale(M.sub(flat, want), keep));
  if (M.len(v) > 0.6) body.heading = M.norm(v);          // faces where it goes; a knocked body keeps its facing
  return M.scale(v, ctx.dt);
}
export const move = defineMove({
  runner(body, input, ctx) {
    const d = flatStep(body, input, ctx);
    body.vel = ctx.math.scale(d, 1 / ctx.dt);
    ctx.map.sweep(body, d);                              // walls still stop it
  },
});

// games/gem-rush/src/rules.ts, the parts that touch movement
shapes: {
  events:  { hit: { from: f.vec3(), by: f.ref() } },
  effects: { wave: {}, knock: { dir: f.dir() } },
},
runner: {
  player: { away: 'think', leave: 'bot' },
  fields: { score: f.u16({ score: true }) },
  motion: { knockDir: f.dir(), knockFrom: f.vec3(), knockAt: f.fix(), knockUntil: f.fix() },
  input: { ax: f.i8(), ay: f.i8(), wave: f.press() },
  body: { shape: 'circle', radius: 0.44, maxSpeed: 6.8 },
  tick(world, self) {
    if (!self.input.wave) return;                        // a knocked body may wave, as today
    world.emit('wave', self.id, {});
    world.sendArea({ sphere: { at: self.pos, r: world.tune.knockRange } }, 'hit', { from: self.pos, by: self.id });
  },
  on: {
    hit(world, self, e) {                                // runs for the victim, so it may write the victim
      if (e.by === self.id) return;
      const M = world.math, m = self.motion, d = M.sub(self.pos, e.from);
      m.knockDir = M.len(d) < 0.02 ? M.dir(world.random() * M.TAU) : M.norm(d);
      m.knockFrom = self.pos;
      m.knockAt = world.tick + world.tune.hitStopMs / 1000 / world.dt;     // 1.4 ticks: the fraction is kept
      m.knockUntil = m.knockAt + world.tune.knockMs / 1000 / world.dt;     // 8.4 ticks more
      world.emit('knock', self.id, { dir: m.knockDir });
    },
  },
  onRoom: {
    roundStart(world, self) {                            // every body back on its spawn
      const spots = world.map.spots('spawn');
      self.score = 0;
      self.motion.knockAt = 0;
      self.motion.knockUntil = 0;
      world.place(self, spots[self.seat % spots.length]);
    },
  },
},
```

`knockDistance` and `knockEase` are in the `public` part of `tunables.json`, because `move`
reads them. A handler tests "knocked" as `world.tick < self.motion.knockUntil`.

**One knock, tick by tick**, at 20 Hz. The `hit` runs on tick `h`. `knockAt` is `h + 1.4` and
`knockUntil` is `h + 9.8`.

| Tick | `move` | Distance along the knock |
|---|---|---|
| `h` | Ran before the hit, steering | 0 |
| `h + 1` | Before `knockAt`: `u` is 0 | 0. The hold |
| `h + 2` | `u` 0.071 | 0.95 m |
| `h + 3` | `u` 0.19 | 2.11 m |
| `h + 4` to `h + 8` | The curve eases | 2.86, 3.31, 3.55, 3.65, 3.69 m |
| `h + 9` | The next tick is past `knockUntil`: the landing step | 3.70 m exactly. `knockAt` cleared |
| `h + 10` | Steering again, from rest | |

| Figure | In the starter | The contract version at 20 Hz | Test |
|---|---|---|---|
| Run speed | 340 px/s | 6.8 m/s, the same | |
| Time to 90% of speed | 144 ms (`dt * 14` a frame at 60 frames a second) | 150 ms: the same curve, read every tick | |
| Crossing the arena from rest, 31.12 m | 4.63 s | 4.65 s (tick 93) | Within 2%. It is 0.4% |
| Hit-stop | 70 ms | The body is still for 50 ms after the tick of the hit, drawn between ticks | Half a tick, 25 ms |
| From the hit to steering again | 490 ms | 500 ms | Half a tick |
| Knock distance | 185 px, landed exactly | 3.70 m, landed exactly | 1 cm |
| From the wave to the hit | The same host frame | The next tick, 50 ms: one event hop | One tick. Accepted |
| Waving while knocked | Allowed. No cool-down | The same | |

**How the victim sees it** (section 6.3), at a 90 ms round trip.

| Moment | Server | Victim's browser |
|---|---|---|
| Tick `h` | `on.hit` writes the victim's `motion`. The snapshot for `h` carries it, and the `knock` effect | Steering, 2 or 3 ticks ahead |
| The snapshot for `h` arrives | About to run `h + 1` | Takes the body with its knock and replays its pending steps: a hold, then one or two steps of slide. The result is 0.95 to 2.11 m along the knock, plus up to 0.85 m it had steered. That is over `catchM` (1.02 m), so the view catches up |
| The next 500 ms | Slides, then lands | The body is drawn at the server's spot for tick `h`. The up to 0.85 m it had run on is blended away in 100 ms while the flash plays. Then the hold and the whole slide play at 1.25 times speed. The picture reaches the present a tenth of a second after the knock ends |
| `h + 10` | `move` steers from the step for that tick | The same step, already predicted. The picture is half a tick behind it and closing. No pop |

- Without catching up the same snapshot would move the picture 1 to 3 m in a tenth of a
  second and the hold would never show.
- A victim standing still when hit has no gap to blend. It sees a 40 ms hold and the slide.
- The victim cannot ignore the hit. Its inputs are still applied, and `move` ignores the
  stick while knocked.
- The round reset uses `world.place`, so every view jumps to the spawn.

### 15.2 `hero-rush-3d`: a jump that a swing passes under, and a knock in mid-air

Today a hero's height is its owner's claim, the host lands a swing after a wind-up, and a
hero in the air is missed (`starters/hero-rush-3d/src/main.ts:126-136, 517-560, 600-628`).

```ts
// games/hero-rush-3d/src/move.ts. `flatStep` is 15.1's, with SPEED 6.2: today's constant.
// (`runSpeed`, 4.6, is the speed the run clip's feet move at. Only the view reads it.)
export const move = defineMove({
  hero(body, input, ctx) {
    const T = ctx.tune, dt = ctx.dt;
    const g0 = (2 * T.jumpHeight) / (T.jumpRise * T.jumpRise);
    const knocked = body.motion.knockAt > 0;
    let vz = body.vel.z, dz = 0;
    if (input.jump && body.grounded && !knocked) vz = g0 * T.jumpRise;      // the press, on its own tick
    if (vz > 0 || !body.grounded) {
      const g = g0 * (vz < 0 ? T.fallFaster : 1);                           // down harder than up
      dz = vz * dt - (g * dt * dt) / 2;                                     // the exact step: the top is jumpHeight at any tick rate
      vz -= g * dt;
    }
    const d = flatStep(body, input, ctx);
    ctx.map.sweep(body, { x: d.x, y: d.y, z: dz });                         // sets body.grounded (section 3.5)
    body.vel = { x: d.x / dt, y: d.y / dt, z: body.grounded ? 0 : vz };
  },
});

// games/hero-rush-3d/src/rules.ts, the hero kind (the parts that differ from 15.1)
const CLEAR_M = 0.3;                                    // today's constant: this high, a swing passes under
const R = 0.44;                                         // the body's radius
// shapes: hit gains `dir: f.dir()`; effects swing { dir: f.dir() } and dodge {}; event land {}
input: { ax: f.i8(), ay: f.i8(), jump: f.press(), swing: f.press() },
fields: { score: f.u16({ score: true }), swingReady: f.tick() },
body: { shape: 'capsule', radius: R, height: 1.7, maxSpeed: 6.2 },
tick(world, self) {
  if (!self.input.swing || world.tick < self.swingReady || world.tick < self.motion.knockUntil) return;
  const T = world.tune, wind = world.ticks(T.windupMs / 1000);              // 240 ms is 5 ticks
  self.swingReady = world.tick + world.ticks((T.windupMs + T.swingRestMs) / 1000);
  world.emit('swing', self.id, { dir: self.heading });                      // every screen plays it now
  world.after(Math.max(1, wind - 1), 'land', {});                           // a tick early: the `hit` takes one more to arrive
},
on: {
  land(world, self) {
    if (world.tick < self.motion.knockUntil) return;                        // hit during the wind-up: no swing
    const T = world.tune;
    world.sendArea({ sphere: { at: self.pos, r: T.knockRange + T.jumpHeight } }, 'hit',
      { from: self.pos, dir: self.heading, by: self.id });
  },
  hit(world, self, e) {
    if (e.by === self.id) return;
    const M = world.math, T = world.tune;
    const flat = { x: self.pos.x - e.from.x, y: self.pos.y - e.from.y, z: 0 }, far = M.len(flat);
    if (far > T.knockRange) return;                                         // reach is measured on the ground
    if (far > R * 1.5 && M.dot(M.norm(flat), e.dir) < M.cos(M.rad(T.swingArc / 2))) return;   // outside the arc, and not close
    if (self.pos.z >= CLEAR_M) { world.emit('dodge', self.id, {}); return; }                   // jumped it
    // then the same motion writes as 15.1, with `flat` in place of `d`
  },
},
```

**The jump, tick by tick**, with `jumpHeight` 1.05 and `jumpRise` 0.3: `g0` is 23.33 and the
take-off speed 7.0 m/s. At 20 Hz the heights after each step are 0.32, 0.58, 0.79, 0.93, 1.02
and 1.05 m. `vz` is then 0. The fall uses 2.1 times the gravity and the hero lands on the 11th
step. The first step is already above `CLEAR_M`.

| Figure | In the starter | The contract version at 20 Hz | Test |
|---|---|---|---|
| Run speed | `SPEED` 6.2 | 6.2 | |
| Crossing the clearing from rest, 25.12 m | 4.12 s | 4.10 s (tick 82) | Within 2%. It is 0.4% |
| Top of the jump | 0.99 m at 60 frames a second, 1.02 at 120. Its step loses a little each frame. The setting says 1.05 | 1.05 m at any tick rate | Within 2% of the `jumpHeight` setting. Today's figure changes with the frame rate, so it is not the reference |
| Time to the top | 0.30 s | 0.30 s (6 ticks) | Half a tick |
| Time in the air | 0.50 s | 0.55 s (lands on a tick) | One tick |
| From the swing to the hit | 240 ms | 250 ms: `land` after 4 ticks, `hit` on the next | Half a tick |
| Until the next swing | 500 ms | 500 ms | |
| Facing | From velocity above 0.6 m/s. Kept while knocked | The same, in `flatStep` | |
| A close hit | Within 1.5 radii, whatever the arc | The same, tested by the victim | |
| Clear height | 0.3 m | 0.3 m | |

- **The jump is predicted.** The press is one step of input. The browser runs it at once and
  the server runs the same step for the same tick, so the arc is identical on both.
- **Whether the swing hits is decided on the server**, from the victim's real height on the
  tick the `hit` runs. A modified browser cannot claim to be in the air.
- **A knock in mid-air** changes only the ground-plane part. The fall carries on from the
  same `vel.z`, so the hero lands where the server says, and the browser reaches the same
  place by replaying.
- **A late jump press** fires on the tick after it arrives (section 4.4). The browser moves
  its predicted jump to that tick (section 6.2), and the difference is blended.

## 16. Open points to settle while building

Each needs a measurement. None changes the frames or the rules format.

| | Question | Settled in | If the answer is bad |
|---|---|---|---|
| 1 | Do 2,000,000 budget units, at the weights of section 10, finish inside half a tick period on Cloudflare? | Slice 1, T1, with planted heavy handlers | The default `budget.tick` is lowered until they do, and the tools state it |
| 2 | Does the clock read at the start of a timer callback include the time the callback before it spent running? The overrun check depends on it | Slice 1, T1, with a planted two-second tick | The check is dropped. Slow ticks are then bounded by the weighted budget alone, and seen in the tick gaps the watch feed and the bots report |
| 3 | How long is a snapshot held behind a save? | Slice 2, T2 | T2's fallback: an unconfirmed write |
| 4 | Do the lead constants hold on real connections, a phone on mobile data among them: half a tick plus jitter, a median of 8, a re-base at 4 ticks? | Slice 6 exit | The floor is raised to one tick. The latency lines of section 6.5 rise by 25 ms |
| 5 | Do `catchUp` 1.25 and `catchM` of 3 ticks make a knock read as today's? | Slice 6 feel check | Both are tuned between 1.1 and 1.5 and between 2 and 4 ticks. If the hold still does not show, the first held tick plays at normal speed |
| 6 | How much does today's `gem-rush` vary from run to run? Its bots use unseeded chance, so a 15% score test proves nothing if the spread is near 15% | Slice 6, before the conversion | The baseline is the mean of as many 20-round sets as bring its spread under 5%. The pass line stays 15% |
