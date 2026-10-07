# Rooms: roadmap design (milestones 2 to 10)

Status: design direction, 2026-10-07. Nothing is built.
Applies to the public repository `homie-rocks/homie` (`@homie-rocks/studio`, the plugin and
its skills, the engine packages), read at `origin/main` (studio 0.32.0).

**This is design direction for later milestones.** It has been reviewed four times. Each
milestone gets its own detailed design pass when it starts, and its size is restated then.

- The plan, the milestone table and milestone 1 in full are in [rooms-plan.md](rooms-plan.md).
- The design of milestone 1 is in [rooms-milestone-1-design.md](rooms-milestone-1-design.md).
- This document holds everything else: the whole rules contract as it grows, the Cloudflare
  products and their page references, every limit in today's code and what it becomes, the
  cost arithmetic, the later tests on real Cloudflare, and milestones 2 to 10.

**How milestone 1 relates to this document.** Milestone 1 builds a room of one object. Its
rules run in the `Table`'s own isolate, its whole state is saved once a second, and it keeps
today's single Worker. The sections below describe where that room goes next: rules in a
sandbox (the Sim), a journal row for each thing of value, two Workers, Gates, cells. Where a
section says what a one-object room does, it describes the design from milestone 3 on unless
it names milestone 1.

## In plain words: two things later milestones add

These two summaries are written for studios. Sections 11 and 12 hold the design.

### Updates without kicking everyone out

Arrives with milestone 3, part A. Homie updates a few rooms at a time arrive with milestone
7, and app updates with milestone 9.

- Changing your site, a blog post, your shop or your theme never touches a running game.
- Changing a game's rules or look does not restart the servers. A match under way finishes
  on its version. A lasting world switches in place: each area pauses for a fraction of a
  second, or the whole world pauses for about two seconds when the saved state changes
  shape.
- A rules change can be undone. If the new rules came with a way back, the world steps back
  with nothing lost. If not, Homie made a restore point just before the change and offers
  it, telling you how many minutes of play would be lost. You decide.
- Updating Homie itself, or Cloudflare updating its machines, restarts server objects a few
  at a time. Each comes back after a pause of one to three seconds.
- An installed app (Steam, phone) fetches the newest view when it starts, so a game change
  does not need a store update. The stores have their own rules about this; Homie tells you
  what they are.

### What is saved, and how safely

Arrives with milestone 3, part B.

- **Things of value are written down the moment they change**: items, currency, trades,
  purchases. If a server stops, it restarts with none of that lost or copied.
- **Movement is written down once a second** by default. After a restart, players may be
  put back to where they were up to a second ago. You can set this to "every step" for a
  game where even that matters.
- **Restore points.** Every 15 minutes by default, Homie marks a moment the whole game can
  be put back to. Cloudflare keeps the data for these for **30 days, and no longer**.
- **Archives.** For anything older, Homie copies a restore point into your file storage
  once a week by default and keeps it for a year. You choose how often and how long.
- **What a restore covers.** Putting a world back also puts back every character and bank
  that belongs to it, so nothing ends up in two places. If your players move characters
  freely between world copies, those copies are restored together. Purchases are never
  undone by a restore: what a player paid for is offered to them again.
- One player can be put right without touching anyone else: a game-master tool shows what
  changed and applies the parts you choose.

Every number in sections 20 and 21 is a target or an estimate from published prices. None is
a measurement. Each names the spike (section 22) or exit test (section 23) that checks it.

**Words used here.**

| Word | Meaning |
|---|---|
| Room | The one thing a player joins: a match, or a lasting world |
| Cell | One area of a room, run by one server object |
| Table, Sim, Gate, Door, Directory, Channel, Player, Lobby, Worlds, Market, Vault, Guild, Party, Bulletin, Builds, Ops | The kinds of server object. Section 5 says what each does |
| Class copy | One of several identical classes of the same kind (`Cell_00`, `Cell_01`, ...), used to spread objects over more threads. Section 8.4 |
| World copy | A whole second room of a lasting game, with its own map state |
| Layer | A second set of cells for one busy area inside one room. Section 9.6 |
| Journal row | The durable record a cell writes for a tick. Section 12.1 |
| Outbox | Messages a cell has decided to send and keeps until the receiver confirms them |
| Mirror | A read-only copy of a neighbouring cell's entity near the border |
| Band | The strip of a neighbouring cell that a cell passes on to its Gates so players can see across the border |
| Forwarder | A cell that has been split or merged away and now only passes old messages on. Section 9.4 |
| Concentrator | A Gate in a second role that merges several Gates' frames into one for a busy cell. Section 10.1 |
| Milestone | One separately adopted piece of the roadmap. Section 23 |
| Relay tree | Objects passing one message on to many, a few at a time, so no object sends to all |
| Lease | The record that says which room holds a character right now. Section 13.2 |
| Scope | The set of rooms and account data that share characters and items, and are restored together. Section 12.4 |
| Epoch | A numbered restore point. Incarnation: a number that rises each time a scope is restored |
| Tally | A shared counter that cells add to locally and the Table merges. Section 7.4 |
| Zone | A named area of the map. A zone may carry a region hint |
| Profile, capability | The slice of the rules contract a game has opted into. Section 7 |
| Build | One uploaded version of a game's rules, view and map |
| Probe bundle | A second build of the rules with a counter in every loop, used to find a handler that does not finish |
| Feel check | A test that a game still moves and scores as it did before a rewrite |

## 1. Why

An outside developer building a live MMO on Homie removed the rooms and netcode and kept the
skills and plugin. Their example need: one place holding 1,000 characters over a huge map,
with servers that share the world and pass players between them.

The current netplay cannot grow into that. It is also weaker than it looks for ordinary
public games: a player's browser runs the rules, so scores can be faked and nothing can be
hidden.

The bar for this plan: a studio can build a game on Homie that grows to a million players
and earns money, without Homie being the ceiling and without leaving Homie. Many different
studios will use it, so nothing is sized to one game. Where games differ, the answer is a
per-game setting (section 6).

Three rules shape every choice below:

- **The studio decides.** Homie gives capability and information. Calls about a studio's
  game, money and players are the studio's.
- **No ceiling from Homie.** A limit exists only where the technology has one. Each is set
  as high as the technology allows, and the plan says how a game grows past it.
- **No waste.** Each Cloudflare product is used for the job it is built for, following
  Cloudflare's published guidance. A write, a call or a log line must buy something a player
  or a studio can perceive. Cost is reported, never enforced.

## 2. What exists today (checked against the code)

- `packages/studio/netplay/netplay.ts` (3,286 lines) is the client helper.
  `packages/studio/worker/room.mjs` (2,173 lines) is the relay. `NETPLAY.md` is the
  contract, version 1 revision 9.
- One player's browser is the host. It runs rules, bots and clock. The relay runs no game
  code. The host sends one whole snapshot to everybody at 20 Hz.
- A room holds at most 32 seats (`SEAT_MAX`, `worker/seats.mjs:11`). One address may hold
  `max(12, seats + 4)` sockets (`seats.mjs:24`).
- The site, accounts, shop and rooms are **one Worker** with two Durable Object classes,
  `Table` and `Lobby`, one D1 database (`DB`) and static assets (the generated
  `wrangler.jsonc`, `lib/scaffold.mjs:98`). One `wrangler deploy` ships everything, and
  restarts every object.
- The Lobby is **one object per game** (`worker/index.mjs:269`, `class Lobby` at `:1727`).
  It keeps every room of the game in one stored value, capped at 512 rooms (`:1725`).
- D1 holds everything: accounts, sessions, shop, saves, chat history, stats, servers
  (`worker/players.mjs`, `shop-store.mjs`, `chat-store.mjs`, `stats.mjs`, `saves.mjs`,
  `schema.mjs`). Every signed-in request reads the session from D1 (`players.mjs:216`).
- Limits written into the code: section 6.2 lists every one found, with file and line.
- The deploy tool, the scaffold and the skills say that going online is free and needs no
  payment method (`lib/cloudflare.mjs:174-184`, `lib/scaffold.mjs:750,917`,
  `lib/mcp-tools.mjs:1088`).
- The game runs in a frame sandboxed without `allow-same-origin` (`worker/pages.mjs:205`).
  Parts are client code in that frame.
- The shop sells through the studio's own Stripe, with a signature-checked webhook as the
  only writer of paid, refunded and disputed (`worker/shop.mjs:10`, `stripe.mjs`).
- Standalone apps are Electron (Steam) and Capacitor (iOS, Android) shells around the same
  web build. They have no accounts, no cloud saves and no shop (`standalone/STANDALONE.md`,
  "What the standalone game does not have").
- No file over 25 MiB can be served, because game files are Worker assets
  (`lib/media.mjs:25`, `lib/parts.mjs:40`).
- The build is esbuild with content-hashed bundles (`lib/build.mjs`). It type-checks only
  with `--types` and only if the studio has TypeScript (`lib/typecheck.mjs:46`).
- Each starter is one file of 1,087 to 2,627 lines (7,102 in all) with module-level state.
  Rules step on render time, read the wall clock and use unseeded `Math.random`.
- The port toolkit (`packages/studio/port/`) runs an outside game's own code in the host's
  browser through the version 1 helper (`port/room.ts`).
- Measured today: 242 to 330 ms between two non-host players (contract section 14).

## 3. Decisions

The owner's decisions are in [rooms-plan.md](rooms-plan.md), under "Decisions". They are not
repeated here. Section 11 covers what "no migration tooling" leaves in place: a game's own
saved state changing shape between its own builds.

## 4. What Cloudflare provides (developers.cloudflare.com, read 2026-10-07)

Page paths are relative to developers.cloudflare.com.

| Fact | Page |
|---|---|
| Durable Objects: $0.15 per million requests, $12.50 per million GB-s, billed at 128 MB while awake. SQLite storage: $1.00 per million rows written, $0.001 per million rows read, $0.20 per GB-month. Incoming socket messages bill at 20 to 1. "Every RPC method call on a Durable Objects stub is ... a single billed request." An alarm is one request and one row written. "Deletes are counted as rows written." A hibernated object bills no duration. Available on the free plan with three daily allowances (100,000 requests, 13,000 GB-s of duration, 100,000 rows written); past one, "further operations of that type will fail with an error" until 00:00 UTC | /durable-objects/platform/pricing/ |
| 10 GB per object, unlimited objects, 2 MB per row. "An individual Object has a soft limit of 1,000 requests per second." CPU 30 s per request, configurable to 5 minutes; each incoming request or socket message resets it, and past it "there is a heightened chance that the individual Durable Object is evicted and reset". There is no daily CPU allowance. 500 classes per account on the paid plan, 100 on the free plan. Received socket message up to 32 MiB. Higher limits by Cloudflare's Limit Increase Request Form | /durable-objects/platform/limits/ |
| "Model around your atom of coordination": one object per room, per user, per document. No global singleton. One object handles 500 to 1,000 simple requests a second, 200 to 500 complex ones. Shard by `total ÷ capacity`. Parent and child objects for hierarchies. Batch 10 to 100 logical messages per socket frame. Writes with no `await` between them are one atomic transaction. Output gates hold outgoing messages until writes are confirmed. No shutdown hook: "write state incrementally" | /durable-objects/best-practices/rules-of-durable-objects/, /durable-objects/best-practices/websockets/ |
| `transactionSync`, synchronous `sql.exec`, `storage.sync()`. `allowUnconfirmed` is an option of the key-value `put()`, `delete()` and `deleteAll()` only, listed on the SQLite-backed page; `sql.exec` has no such option. Point-in-time recovery of one object's database "to any point in time in the past 30 days": `getCurrentBookmark`, `getBookmarkForTime`, `onNextSessionRestoreBookmark`. Every index row updated counts as a row written. `deleteAll()` removes an object's whole database, and its alarm from compatibility date 2026-02-24 | /durable-objects/api/sqlite-storage-api/ |
| A deploy or a runtime update restarts an object. A hibernatable object sleeps after 10 s with no request or event. It cannot hibernate while a `setTimeout` or `setInterval` is pending or an outbound connection is open; it is then removed after 70 to 140 s idle, and bills duration while in memory. "An open outbound WebSocket connection prevents eviction" | /durable-objects/concepts/durable-object-lifecycle/, /durable-objects/best-practices/websockets/ |
| "A single isolate can host multiple Durable Objects of the same class ... and they all share that isolate's memory." `cpuTime` and `memoryUsageBytes` are in `durableObjectsPeriodicGroups` | /durable-objects/observability/metrics-and-analytics/ |
| 12 location hints. Jurisdictions `eu`, `us`, `fedramp`. Hints are best effort. Objects do not move after creation | /durable-objects/reference/data-location/ |
| A Worker may bind a Durable Object class that another Worker defines, with `script_name` | /workers/wrangler/configuration/ (Durable Objects) |
| Gradual deployments: each object is assigned a version by the deployment's percentages, and "each Durable Object will only be reset once". Versions that change a class's lifecycle cannot be rolled out gradually. Versions must be forwards and backwards compatible. There is no region selector | /workers/versions-and-deployments/gradual-deployments/with-durable-objects/ |
| "Each Worker invocation can have up to six connections simultaneously waiting for response headers." Outbound WebSocket connections are in the list of what counts. 128 MB per isolate. 500 Workers per account | /workers/platform/limits/ |
| Dynamic Workers (Worker Loader): `env.LOADER.get(id, callback)` loads code at run time. "When the runtime sees the same `id` again, it can reuse the existing Worker ... if it hasn't been evicted yet." The loaded code receives only the bindings it is handed. `globalOutbound: null` blocks the network. `limits: { cpuMs }` per invocation: over the limit "it will immediately throw an exception". Tail Workers attach to it | /dynamic-workers/getting-started/, /dynamic-workers/usage/bindings/, /dynamic-workers/usage/limits/, /dynamic-workers/usage/observability/ |
| Durable Object Facets: a supervisor object runs a class from a Dynamic Worker as a child with its own SQLite database. `ctx.facets.get`, `.abort` (storage kept), `.delete`. The page says nothing about isolates, threads, memory, alarms, sockets, CPU limits, billing or local development | /dynamic-workers/usage/durable-object-facets/ |
| A Durable Object may have 10 distinct Dynamic Workers with requests in flight | /dynamic-workers/platform/limits/ |
| Dynamic Workers "are currently only available on the Workers Paid plan". $0.002 per unique Dynamic Worker per day past 1,000 a month; "uniquely identified by its Worker ID and code", and the count resets daily. $0.30 per million requests, $0.02 per million CPU-ms | /dynamic-workers/pricing/ |
| Containers: Workers Paid only. Up to 4 vCPU, 12 GiB, 20 GB disk per instance. 1,500 vCPU, 6 TiB memory and 30 TB disk at once per account, raised by "contact your account team, file a support ticket, or fill out this form". An image may come from Cloudflare's registry, Docker Hub, Amazon ECR or Google Artifact Registry; Docker on the computer "is not necessary if you are using a pre-built image". $0.000020 per vCPU-second used, $0.0000025 per GiB-second, $0.00000007 per GB-second of disk | /containers/platform-details/limits/, /containers/platform-details/image-management/, /containers/platform/pricing/ |
| Workers: paid plan from $5 a month. $0.30 per million requests, $0.02 per million CPU-ms. A socket through a Worker bills the upgrade request only. Static assets: 25 MiB a file. Calls over a service binding add no request charge | /workers/platform/pricing/, /workers/platform/limits/ |
| D1: 10 GB per database, 50,000 databases per account, "inherently single-threaded", about 1,000 queries a second at 1 ms a query. Read replication with the Sessions API adds no charge; the page states no beta or general-availability status. $1.00 per million rows written, $0.001 per million read, $0.75 per GB-month | /d1/platform/limits/, /d1/platform/pricing/, /d1/best-practices/read-replication/ |
| Hyperdrive: connection pooling and query caching to Postgres or MySQL. About 100 origin connections per configuration on paid. No per-query charge | /hyperdrive/, /hyperdrive/platform/limits/ |
| Queues: available on the free plan (10,000 operations a day). 5,000 messages a second per queue, 10,000 queues, 250 concurrent consumers, $0.40 per million operations, three operations per delivered message | /queues/platform/limits/, /queues/platform/pricing/ |
| Workflows: 50,000 running instances, 300 created a second, steps retried and durable | /workflows/reference/limits/, /workflows/reference/pricing/ |
| Workers AI: $0.011 per 1,000 neurons. 10,000 neurons a day at no charge. On the free plan use stops at that allowance | /workers-ai/platform/pricing/ |
| Analytics Engine: $0.25 per million data points and $1.00 per million queries once billing starts. Not billed today | /analytics/analytics-engine/pricing/ |
| Workers Logs: 7 days kept, $0.60 per million events past 20 million a month. `head_sampling_rate` defaults to 1. `invocation_logs = false` turns off the automatic log line per invocation. Export by OpenTelemetry, Logpush or Tail Workers | /workers/observability/logs/workers-logs/ |
| R2: $0.015 per GB-month, $4.50 per million writes (Class A), $0.36 per million reads (Class B), no egress charge | /r2/pricing/ |
| KV: $0.50 per million reads, $5.00 per million writes | /kv/platform/pricing/ |
| Cache API: "Workers deployed to custom domains have access to functional cache operations"; cache contents stay in the data centre that stored them | /workers/runtime-apis/cache/ |
| Rate limiting binding: counts per key per Cloudflare location, periods of 10 or 60 s, "permissive, eventually consistent". Keys should be user or tenant ids, not addresses, since "many users may share a single IP" | /workers/runtime-apis/bindings/rate-limit/ |
| Realtime SFU and TURN: $0.05 per GB sent to clients, first 1,000 GB a month free, publishing free | /realtime/sfu/pricing/ |
| Pipelines: Workers Paid. 20 streams, 20 sinks and 20 pipelines per account, raised by request form. Ingest free. Delivery to R2 as Iceberg or Parquet $0.06 per GB past 50 GB a month | /pipelines/platform/limits/, /pipelines/platform/pricing/ |

**Not stated on the pages read.** Each is a question in a spike (section 22) with a pass
line and a fallback that is already designed.

| Unknown | Spike |
|---|---|
| Whether a facet or a Dynamic Worker runs on its own thread, apart from its supervisor | S1 |
| Whether two objects that load the same Dynamic Worker id share one isolate | S1 |
| The memory ceiling of a Dynamic Worker or facet | S1 |
| Whether `limits.cpuMs` applies to a call into a facet, and the facet's state after it throws | S1 |
| Whether a facet's in-memory state lasts as long as its supervisor stays awake | S1 |
| How facet calls and facet awake time are billed | S1 |
| Whether Dynamic Workers and facets run under local Wrangler | S1 |
| How long output gates hold a send after a SQL write | S2 |
| How many objects share an isolate in practice, whether timers in co-hosted objects delay each other, and whether two class copies ever share an isolate | S3 |
| Whether sockets and calls between Durable Objects count toward the six connections | S4 |
| Latency between two objects under one hint | S4 |
| Latency between an object and its Container, and whether a Container class deploys from a public image with no Docker installed | S5 |
| Whether a deploy of one Worker disturbs sockets held by objects of another | S7 |
| Whether Cloudflare offers any unreliable (datagram) path into a Durable Object. None was found in the documentation | S11 |

## 5. The pieces

Milestone 1 builds none of this section: it keeps today's one Worker and the `Table`. The two
Workers arrive in milestone 3, part A. Each other piece arrives with the milestone that
section 23 names for it.

**Two Workers, not one.**

- The **site Worker** serves the studio's pages, the shop, sign-in and the join request. It
  changes whenever the studio changes a post, a theme or the catalogue.
- The **rooms Worker** defines every Durable Object class and holds the Worker Loader
  binding. It changes only when Homie's runtime changes. Player sockets connect to it
  directly, on its own hostname.
- The site Worker reaches the objects through bindings with `script_name`. Deploying the
  site Worker therefore restarts no object and closes no socket, and site changes carry no
  compatibility burden toward objects.
- A third, small **Tail Worker** receives errors and, on request, CPU figures (section 8.3).
- Why not one Worker as today: one Worker means a blog post restarts rooms. Cloudflare's
  own structure avoids it at no cost: service-binding calls add no request charge.

**Classes are declared per milestone, in copies.** A release that adds a class cannot roll
out gradually (section 4), so classes are added in as few releases as possible: the classes
a milestone needs are declared together in that milestone's first release, as one direct
deploy. Running rooms pause for 1 to 3 s, once. Every other release rolls out gradually.
Classes that tick are declared in numbered copies (section 8.4). A copy's number is part of
each object's id, fixed when the object is created, so more copies can be added later
without moving any object.

| Piece | Product | Why this product | Guidance followed |
|---|---|---|---|
| **Table**: a room's centre. The room's clock, shared state, room-scope rules, the map of cells, owner controls. Class copies | Durable Object, SQLite | One room is one atom of coordination with its own durable state | Rules of Durable Objects, "atom of coordination" |
| **Cell**: one area of a room. Owns the entities in it, the journal and the links to its neighbours. Class copies | Durable Object, SQLite | Single-threaded ownership of state, transactional storage beside the compute, wakes on a message | Same, parent and child objects |
| **Sim**: the game's rules and the simulation core for one cell | Durable Object Facet (a Dynamic Worker) under the Cell. A Container for heavy cells | A real sandbox with no bindings and no network, a platform CPU limit, code swapped without a deploy | Dynamic Workers bindings and limits pages |
| **Gate**: holds player sockets for one cell, batches input, filters and encodes state per player, runs voice selection. Class copies | Durable Object, created beside its cell | Spreads socket and encoding work across objects under the per-object request guidance | "Required DOs = total ÷ capacity"; batch messages per frame |
| **Door**: admits players to a room of many cells. Seats, room passes, the arrival queue. Shards per room | Durable Object with hibernating sockets | Joins are coordination, and must not pass through the Table | "Avoid global singletons" |
| **Directory**: which cell each player and room-scope entity is in. Shards per room | Durable Object, SQLite | A small strongly consistent map, off the Table | Shard by key |
| **Channel**: one chat channel (room, world, party, guild) | Durable Object, relay tree for large ones | Ordered fan-out with review | Atom of coordination |
| **Player**: one account. Identity, purchases, bank, mailbox, characters, friends, the lease that says where a character is. Class copies | Durable Object, SQLite, one per account | Per-user data is the textbook object. Strong consistency for money and items. No shared database in the hot path | "One Durable Object per user's data" |
| **Lobby**: a matchmaker shard | Durable Object, many per game | Matching is coordination. Sharded so no single object takes every join | "Avoid global singletons" |
| **Party**, **Guild**: a group that queues, travels or talks together | Durable Object per group | Small coordinated group | Atom of coordination |
| **Vault**: storage several players share (a guild bank, a house chest) | Durable Object per owner | Items held transactionally for a group | Atom of coordination |
| **Market**: listings with items held in escrow | Durable Object shards per scope and category | Items must be held transactionally. Search is served from a database index | Atom of coordination |
| **Worlds**: the registry of world copies for one game in one region. Never on the join path | Durable Object per game and region; its list is published to KV | Small strongly consistent registry | Parent and child objects |
| **Bulletin**: the ordered log of game-wide events for one game | Durable Object per game | One writer, many late readers | Parent and child objects |
| **Builds**: the list of a game's builds and which one is current | Durable Object per game | One strongly consistent pointer | Atom of coordination |
| **Ops**: alert rules, schedules, maintenance and rollout state for one studio | Durable Object, alarms | Scheduled per-entity work | Alarms guidance |
| Rules bundles, view bundles, map chunks, large assets, input recordings, archives | R2: one private bucket, one public | No size limit that matters, no egress charge, changed without a Worker deploy | /r2/ |
| Sign-in lookups, catalogue, servers, site content, search and ranking indexes | D1 with read replication, one database per concern and per game | Relational reads, replicated near players. Never the truth for live play | D1 limits and read replication pages |
| Cross-player search, market search, rankings, analytics joins past D1's size or rate | Postgres through Hyperdrive, as a per-studio choice | A single D1 database is single-threaded and 10 GB | /hyperdrive/ |
| Purchases, account indexing, chat review, audit export | Queues | Buffered, retried, at-least-once work off the request path | /queues/ |
| Refunds, chargebacks, world merges, restores, staged rollouts | Workflows | Multi-step jobs that must finish and can wait for days | /workflows/ |
| Metrics | Analytics Engine | High-cardinality time series written from Workers with no request path cost | /analytics/analytics-engine/ |
| Logs | Workers Logs, with OpenTelemetry or Logpush export | Platform logging | Workers Logs page |
| Audit history | Pipelines to R2 as Iceberg tables, queried with R2 SQL | Append-only, queryable, cheap to keep for years | /pipelines/ |
| Bots and floods | Turnstile, the rate limiting binding, WAF rules on a custom domain | Purpose-built, keyed by account not address | Rate limit binding page |
| Voice | Realtime SFU and TURN | Media routing is not a job for a Worker | /realtime/ |
| Flags, the world list, shard counts | Workers KV, written by Ops and Worlds, cached in each isolate for 30 s | Read-mostly, global, eventually consistent is fine | /kv/ |

Small rooms do not pay for pieces they do not need. In a room that fits one object (section
10.1), the Table carries the Cell, Gate, Door and Directory roles itself. Roles are the same
code either way. A room's layout is chosen when the room is created, from its settings. It
grows by adding objects, never by moving roles while players are connected.

**What stays off the Table in a room of many cells**, so that no test size in this plan puts
one object over Cloudflare's guidance:

| Job | Where | Rate that reaches the Table |
|---|---|---|
| Joins, seats, passes, the arrival queue | Door shards | A seat-block refill, a few a second at most |
| Where an entity is | Directory shards, written by cells | None |
| Chat review and fan-out | Channels and Gates | None |
| Voice | Each Gate calls the Realtime API for its own players | None |
| Stats | Cells and Gates write Analytics Engine directly | None |
| Counting (damage, scores, votes) | Tallies merged from cells once a second | One merged frame per cell per second |
| Room-scope rules, `shared`, the clock, the tree, timers | Table | Design figure: 200 room-scope handler runs a second |

### 5.1 Where today's room features go

The middle column is the design for a one-object room. Milestone 1 reaches it by leaving
these jobs in today's relay and making the `Table` the host. The storage and Queue changes in
the chat row, and stats in Analytics Engine, arrive in milestone 7. Milestone 4 delivers the
right-hand column.

| Feature today | In a one-object room (milestone 1) | In a room of many cells (milestone 4) |
|---|---|---|
| Seats, tokens, names, badges | Table. Seat map as rows | Doors |
| Chat, reactions, kept history, review by Workers AI | Table. History in the room's storage, review through a Queue | Gates collect lines. `near` chat travels with cell frames. Other scopes go through a Channel |
| Votes, prefs, arrival, seat-or-solo | Table | Table for votes; Door for arrival |
| Watchers and the big screen | Table as its own Gate | Gates |
| Owner's signed controls | Table verifies | Table verifies and tells cells and Doors |
| Agent seats and house guides | Table decides; inputs go into the Sim | Table decides; the owning cell applies |
| `decide` | `world.ask`, answered by the Table | Same |
| Launch gating, round and peak stats | Table, to Analytics Engine and the index | Cells and Gates report directly |
| Matching | Today's Lobby, unchanged, until milestone 5 replaces it with Lobby shards | Worlds list and Doors |
| Host election, yield, relay checkpoint, whole snapshots | Browser-hosted mode only | Not used |

## 6. Settings and limits

### 6.1 Per-game settings

Settings live in `game.json` under `"room"`. Each has a default. Every limit has a technical
reason and a way past it. `studio_deploy` with `plan: true` prints what the settings create,
which Cloudflare plan they need, and an estimate of what Cloudflare will charge. The estimate
is information. Nothing is blocked, held or slowed because of it.

Milestone 1 ships `host`, `offline`, `tickHz` (1 to 60), `inputHz`,
`durability.movementSeconds`, `budget.tick` and the `predict` settings
([rooms-milestone-1-design.md](rooms-milestone-1-design.md), section 11). Seats stay
`players.max` in `game.json`, up to 32; the `seats` row below is that setting. Each other
setting arrives with the milestone that builds what it controls.

| Setting | Default | Limit | Why the limit exists | Growing past it |
|---|---|---|---|---|
| `host` | `server` | `server`, `browser` | | |
| `lifetime` | `match` | `match`, `persistent` | | |
| `seats` | 8 | No upper limit. The deploy plan states the largest size tested on this Homie version | Each object takes 500 to 1,000 messages a second (Cloudflare guidance) | Gates and cells are added automatically. Past the tested size: world copies |
| `tickHz` | 20 | 0, or 1 to 120. 0 means event-driven: the room runs only when something happens and hibernates between | At 120 Hz a tick has 8 ms. Displays and input devices do not go faster | Not needed |
| `inputHz` | equal to `tickHz` | 1 to `tickHz` | The server never lowers it | More Gates |
| `send.nearHz`, `send.farHz` | `tickHz`, 5 | 1 to `tickHz` | | |
| `view.radiusM`, `view.nearM` | 96, 32 | `view.radiusM` up to the smallest cell size | A cell passes on one neighbour's band, not two (section 10.1) | Larger cells (`cell.minM`); the overview feed, which has no radius (section 10.2) |
| `durability.movementSeconds` | 1 | 0 (every tick) to 60; 1 to 60 in milestone 1 | The most movement a restart may replay. Value changes and anything that leaves the cell are always written in their own tick (section 12.1) | |
| `checkpointSeconds` | 10 | 1 to 300 | Bounds recovery time and journal size | |
| `whenEmpty` | `end` for match, `run` for persistent | `end`, `run`, `sleep` | `run`: the room's clock and timers keep going with nobody in. `sleep`: timers wait until someone joins | |
| `cell.whenIdle` | `sleep` | `sleep`, `run` | `sleep`: a cell with nobody near stops; its `wake` handler brings it up to date. `run`: it simulates always | |
| `cell.catchUpTicks` | 0 | 0 to 60 × `tickHz` | Ticks a waking cell replays before `wake` runs, for rules that prefer stepping to arithmetic | |
| `region` | `auto` (near the first players) | `auto`, one of 12 hints, a jurisdiction, a list for copies, or hints on map zones | Objects do not move after creation | World move tool; copies; zones |
| `world.partition` | `auto` | `auto`, or declared in the map | | |
| `cell.minM` | 128 | At least `cell.marginM` and at least `view.radiusM` | A cell mirrors and passes on only cells that touch it | Section 9 |
| `cell.marginM` | 64 | Up to `cell.minM` | Same | `world.sendArea`, projectiles |
| `cell.hysteresisM` | 8 | 1 to half the margin | | |
| `gate.rehomeM` | 16 | 1 up to `cell.minM` minus `view.radiusM` | How far into the next cell a player goes before their socket moves (section 10.1) | |
| `entity.maxBytes` | 65,536 | Up to 1,000,000 | An entity must fit one 2 MB row with headroom | Items in the account bank or a Vault; attached entities, which hand off as a group in several messages |
| `cell.stateMB` | 48 | Up to half the measured memory ceiling of a Sim (spike S1); up to the instance memory on a Container | An isolate has 128 MB (Workers limits). The ceiling for a Sim is not documented | Cells split by state size as well as load; `sim.host: container` |
| `sim.host` | `auto` | `auto`, `isolate`, `container` | `auto` picks from the measured tick cost in the build check | |
| `sim.instance` | `standard-2` | Cloudflare's instance types, to 4 vCPU and 12 GiB | Cloudflare's largest instance; 1,500 vCPU at once per account | Cells split; world copies; Cloudflare's limit-increase request |
| `sim.isolation` | `auto` | `auto`, `shared`, `cell` | `cell`: every cell's Sim has an isolate id of its own. `shared`: Sims of one build share a set of ids sized from spike S3. `auto` is `cell` for persistent rooms and `shared` for match rooms (section 8.1) | |
| `sim.hardMs` | 4 tick periods (200 ms at 20 Hz) | 50 to 300,000 | Cloudflare's CPU limit. Only a runaway reaches it | |
| `query.maxResults` | 256 | Up to 4,096 | Tick time | |
| `crowd.cap` | The measured ceiling for the host kind (spike S6) | Any. Above the ceiling the room slows time and says so | CPU of one simulation thread | Container host; `crowd.whenFull: layer` |
| `crowd.whenFull` | `layer` in a room of many cells, `queue` in one cell | `layer`, `queue`, `hold` | A design choice: a second layer of the area, a queue at the door, or arrivals stopped at the border | |
| `watchers` | On, no limit | On, off, or a number | Watchers sit on Gates and add no load to a Cell | More Gates |
| `chat.scope` | `near` in many cells, `room` in one | `near`, `room`, `party`, `guild`, `world` | | |
| `voice` | `off` | `off`, `proximity`, `party` | | |
| `voice.radiusM`, `voice.maxHeard` | 20, 8 | Any; up to the number a client can mix (spike S9) | Client decoding and mixing | |
| `predict.snapM` | `body.maxSpeed` times (twice the time the client runs ahead, plus 0.1 s) | Any | | |
| `predict.interpMs` | One send period | Any | A floor under the measured delay | |
| `characters.shadowSeconds` | 300 | 10 to 3,600 | How often a live character is copied to its account as a shadow. The cell's journal is the truth; the shadow serves game-master tools (section 13.2) | |
| `economy.scope` | `game` | `game`, `world` | `game`: characters and banks move freely between world copies, and those copies restore together. `world`: each copy has its own characters and bank and restores alone (section 12.4) | |
| `backup.everyMinutes` | 15 | 1 to 1,440 | An epoch costs one bookmark per object touched | |
| `backup.archive` | Every 7 days, kept 365 days | Off, or any interval and retention | Cloudflare keeps recovery history for 30 days only | The archive in R2 |
| `guests.perAddress` | 64 | Any, or off | Flood control for players with no account. Accounts are limited per account, not per address | Turnstile |
| `record.inputs` | `off` | `off`, `on` | Stores every input in R2 for replay and cheat review | |
| `logs.invocations` | `off` | `off`, `on`, or a sampling rate | Cloudflare's automatic log line per message carries nothing Homie's own structured events do not. Homie's events are always logged in full | |
| `worlds.autoOpen`, `worlds.openAt` | `true`, 0.8 | Any | Opens another copy when existing ones are this full. No maximum | |
| `match.modes`, `match.size`, `match.backfill` | One mode, `seats`, `true` | Any | | |
| `data.backend` | `d1` | `d1`, `postgres` | A D1 database is 10 GB and single-threaded | Section 13.3 |
| `rollout.steps` | 10, 50, 100 percent | Any | For releases of the rooms Worker and for builds | |
| `rollout.autoRollback` | `true` when the build has a way back | `true`, `false` | Section 11.2 | |
| `ai.budget` | None | Any daily amount, in neurons or dollars, per studio or per game | Optional. The studio's own choice (section 6.3) | |
| `spend.alerts` | None | Any list of monthly amounts, per studio or per game | Optional. Sends a notice; changes nothing | |
| `spend.limit`, `spend.atLimit` | None. Off unless the studio sets both | Any monthly amount; `notify`, `queue` (new arrivals wait), `noNewRooms` (no new rooms or world copies), `pause` (rooms stop after saving) | Optional. Homie never supplies a value or a behaviour. Players already in are never cut off except by `pause`, which the studio must name | |

### 6.2 Every limit in today's code, and what it becomes

The rule: a limit stays only if the technology needs it, and then it carries its reason and
the way past it. Everything else becomes the studio's own setting with no ceiling from
Homie. Protections for players become **policies**: named, visible sets of settings that a
studio picks and can edit. Homie ships presets (`general`, `teens`, `kids`, `beginner`).
Legal and store obligations are shown as information beside the setting they concern. They
are not legal advice, and Homie does not enforce them.

**The shop** (`worker/shop-rules.mjs`, `worker/shop.mjs`, `shop/SHOP.md`). Milestone 6. These changes need nothing but milestone 1 and can be built at any time after it.

| Today | Where | Kind | After |
|---|---|---|---|
| A player may spend at most US$50 a month. "A studio may lower it, never remove it" | `shop-rules.mjs:35,118` | Homie's choice | `policy.spendCapPerPlayerMonth`: any amount, or none. No default outside the presets. One cap is counted on the Player object across every till (web, Steam, Apple, Google) |
| No item over US$500 | `shop-rules.mjs:41` | Homie's choice | Removed. The payment provider's own maximum applies and is stated |
| No item under 50 cents | `shop-rules.mjs:147` | Technical | Kept as the provider's minimum charge for the currency, read from the provider, with the reason shown. The warning under US$3 (fees) stays a warning |
| At most 60 items | `shop-rules.mjs:42` | Homie's choice | Removed. The catalogue is rows in the game's index database |
| Five kinds: cosmetic, supporter, pass, unlock, tip | `shop-rules.mjs:26` | Homie's choice | Adds `consumable` (used up in play), `currency` (a pack of a game's own conserved currency), `bundle`, `subscription` and `service`. A studio may add kinds of its own |
| No currency of the studio's own | `shop-rules.mjs:27-33,57` | Homie's choice | Allowed. A pack grants a `conserved` item through the purchase path of section 14.2. Information shown: consumer rules on in-game currencies, and that prices must also be shown in real money where the law asks |
| No subscriptions | `shop-rules.mjs:31` | Homie's choice | Allowed through Stripe Billing and the stores' subscription products. Information shown: terms before billing, clear consent, easy cancelling |
| No paid services | `shop-rules.mjs:32` | Homie's choice | Allowed |
| Anything random is refused (words and fields) | `shop-rules.mjs:52-54,103-106` | Homie's choice | `policy.randomItems`: `off` or `on`. With `on`, the build requires the odds to be declared, and the shop shows them. Off in every preset. Information shown: where paid random items are restricted or need odds shown, and the stores' rules |
| Countdown and "hurry" fields are refused | `shop-rules.mjs:56,107` | Homie's choice | `policy.countdowns`: `off` or `on`. Off in every preset. Information shown: rules on pressure selling |
| Refund window 14 to 60 days | `shop-rules.mjs:36-37,116` | Homie's choice | `policy.refundDays`: any. Information shown: withdrawal rights in the EU and UK |
| A tip is 100 cents to US$500 | `shop-rules.mjs:144` | Homie's choice | Any range above the provider's minimum |
| At most 8 entitlement keys an item | `shop-rules.mjs:154` | Homie's choice | Removed |
| An item lasts at most 3,650 days | `shop-rules.mjs:162` | Homie's choice | Any |
| One currency a shop; currencies without cents refused | `shop-rules.mjs:49,114` | A gap, not a need | Prices per currency on each item. Currencies without minor units supported |
| Tills: Stripe, Stripe Managed Payments, off | `shop-rules.mjs:24` | Scope | Adds Steam, Apple and Google in milestone 9, and another merchant of record as a link-out till |
| 6 purchases a minute per player, counted in memory | `shop.mjs:53` | Flood control | The rate limiting binding keyed by account, at `policy.buysPerMinute` (default 30, any value) |
| A guest cannot buy | `shop-rules.mjs:274` | Technical | Kept. A purchase must attach to an account, or it is lost with a cookie |
| The age question; under 13 never buys; 13 to 17 buy through a parent's own checkout | `shop-rules.mjs:244-279` | Homie's choice | `policy.minors`: the `general` and `teens` presets keep today's behaviour. A studio can read and change it. Information shown: child-protection law where the studio sells, and the payment provider's terms on who may pay |
| A studio marked for kids sells nothing | `shop-rules.mjs:216-217` | Homie's choice | The `kids` preset. A preset, not a lock |
| A kids server shows no shop; an item with a play advantage is not offered on beginner or kids servers; a supporter pack may not carry an advantage | `shop-rules.mjs:175,269-270` | Homie's choice | Per-server policy, on in the `kids` and `beginner` presets |
| Referrals: rate at most 50%, window at most 90 days, at most US$100 per referred player (default US$10), hold at most 120 days, invoice floor at most US$1,000 | `shop-rules.mjs:192-201` | Homie's choice | Each is the studio's number with no ceiling. A hold shorter than the refund window becomes a warning, with the reason |

**AI, chat and communities** (`worker/agents.mjs`, `chat.mjs`, `brain.mjs`, `servers.mjs`,
`lounge-store.mjs`). Milestone 5 for the server and room caps; milestone 6 for the rest. The two AI budgets need no other milestone and can change at any time.

| Today | Where | Kind | After |
|---|---|---|---|
| AI guides and decisions: 8,000 neurons and US$1 a day by default, then scripted | `agents.mjs:270` | A cost cap from Homie | No default budget. `ai.budget` is off until the studio sets it. The tools say that on Cloudflare's free plan Cloudflare itself stops at 10,000 neurons a day |
| Chat review: 2,000 neurons a day, then the word list alone | `chat.mjs:380`, `index.mjs:1357` | A cost cap from Homie | No default budget. `chat.whenUnreviewed` (`hold`, `wordlist`, `allow`) says what happens when a review cannot run; the default is `wordlist`, as today |
| How often an AI seat thinks or speaks; 8 questions and 2 in flight for `decide` | `agents.mjs:268`, `brain.mjs:651`, `room.mjs:102` | Technical defaults | Per-game settings. The reason is the Table's request budget, and the figures become measured ones |
| Prompt vocabulary sizes | `brain.mjs:29` | Technical | Settings, bounded by the model's context size |
| 12 servers a game, 16 rooms a server | `servers.mjs:88` | The old Lobby's memory | Removed. Servers are rows in the index database; each server's pool is a Lobby shard |
| AI seats and guides: 0 to 31 | `servers.mjs:144-145` | Tied to 32 seats | Up to the room's seats less one |
| Kids server: bot level at most 3, aggression at most 0.3, quick lines only, no kept chat | `agents.mjs:30`, `servers.mjs:138,216-222`, `chat.mjs:149,163` | Homie's choice | The `kids` policy preset, visible and editable |
| Chat: 280 characters, history at most 90 days, slow mode at most 120 s, fixed rate buckets | `chat.mjs:57-80` | Homie's choice | Settings. History of any length goes to R2. Information shown: data-retention duties |
| Lounge: 24 nights, 50 moderators | `lounge-store.mjs:57` | Homie's choice | Removed; rows |
| 200 bans and 200 mutes a room | `room.mjs:172` | One stored value | Removed; rows |

**Rooms, accounts and files.**

| Today | Where | Kind | After | Milestone |
|---|---|---|---|---|
| 32 seats a room | `worker/seats.mjs:11` | One relay object forwards every message | Server-hosted rooms have no seat cap. Browser-hosted rooms keep 32 for that reason; the way past is `host: server`. Milestone 1 keeps 32 for both | 2 |
| Message sizes and rates of the relay | `room.mjs:144-163` | Same | Browser-hosted mode only | 1 |
| `max(12, seats + 4)` sockets per address | `seats.mjs:24` | Flood control | `guests.perAddress` for players with no account. Accounts are limited per account | 2 |
| 512 rooms a game; 8 app builds with rooms at once | `index.mjs:1723-1725` | The list is one stored value | Removed. Rooms are rows, and pools are not split by build (section 15.1) | 5 |
| One Lobby object per game | `index.mjs:269` | | Lobby shards | 5 |
| 5,000 new players a day | `players.mjs:124,255` | Flood control | Removed, after Turnstile and the rate limiting binding are in place, in the same milestone | 6 |
| 60 new players an hour per address, 60 sign-in ceremonies per ten minutes, 6 mails an hour | `players.mjs:126` | Flood control by address | The rate limiting binding keyed by account or pass, at rates the studio can set | 6 |
| 120 writes and 240 reads a minute per player | `players.mjs:128` | Flood control | Same binding, same setting | 6 |
| 10 passkeys an account | `players.mjs:124` | Homie's choice | A setting, default 50 | 6 |
| A database read on every signed-in request | `players.mjs:216` | | Signed session tokens | 6 |
| Saves: 64 KiB a value, 64 keys and 256 KiB a game; with storage 1 MiB a value and 4 MiB a game | `saves.mjs:19` | D1 row and database size | Saves live in the Player object. A value up to 1.9 MB is a row; larger values go to R2. `saves.maxBytes` per player per game defaults to 16 MB as a guard against a hostile client filling storage, and takes any value. Technical limit: 10 GB per Player object; past it, R2 | 6 |
| One D1 database for everything | scaffold `wrangler.jsonc` | | Section 13.1 | 6 |
| No file over 25 MiB; a part is at most 100 MiB and 400 files | `lib/media.mjs:25`, `lib/parts.mjs:40` | Worker asset limit | Game files in R2. The part limits go with it | 2 |
| One upload of at most 300 MiB | `lib/media.mjs:32` | Wrangler's single upload | Multipart upload from the tool. R2's own object limit applies | 2 |
| Standalone apps have no accounts, saves, shop, chat or updates | `standalone/STANDALONE.md` | Not built | Section 18.1 | 9 |
| "Free: everything above is on Cloudflare's Workers Free plan, which needs no payment method" and the same claim in the scaffold, three tool descriptions and the skills | `lib/cloudflare.mjs:174-184,271`, `lib/scaffold.mjs:98,181,750,917`, `lib/mcp-tools.mjs:775,1088,1107`, `lib/doctor.mjs:321-325`, skills `studio-setup` and `publish` | Wording | Section 6.4 | 3 |

### 6.3 Cost and Homie

- Homie never sets, defaults or imposes a spending limit, a budget, a cost-based cap or a
  cost-based hold. That includes the two AI budgets above.
- Defaults are chosen on what a player or a studio can perceive. Where a default avoids a
  cost, the section that sets it says what the cost would have bought.
- A studio may create its own controls (`ai.budget`, `spend.alerts`, `spend.limit`). None
  exists unless the studio creates it (section 16.5).

### 6.4 Which Cloudflare plan a game needs, and how the tools say it

This section takes effect in milestone 3, part A, the first milestone that uses a product
sold only on the paid plan. Until then everything Homie creates has a free allowance, and
the deploy plan says what a server-hosted room uses of it.

| What the studio uses | Plan | Why |
|---|---|---|
| Site, accounts, shop, browser-hosted rooms | Workers Free works | Workers, Durable Objects (SQLite), D1, KV and Queues have free allowances |
| `host: server` with rules in the object's own isolate, as milestone 1 builds it | Workers Free works | Durable Objects with SQLite have free allowances |
| `host: server` with rules in the sandbox | Workers Paid | Dynamic Workers "are currently only available on the Workers Paid plan" (/dynamic-workers/pricing/) |
| Game files over 25 MiB, any server-hosted game's bundles | R2, which needs a payment method on the account | Bundles and maps live in R2 |
| `sim.host: container`, the audit trail in Pipelines, Logpush export | Workers Paid | Product availability |

- `host: server` stays the default (decision 4). A server-hosted game uses the sandbox when
  the account has Workers Paid. On Workers Free it runs in the object's own isolate, as
  milestone 1 builds it, and the tools say what the sandbox would add.
- **Before deploy.** `studio_deploy` with `plan: true` reads the account's plan through
  Cloudflare's API. Its output has one line per game: what it needs and whether the account
  has it. It replaces the fixed "free, no payment method" text everywhere that text appears
  today.
- **When a game asks for something the plan does not have.** The tool stops before creating
  anything and says, in these words or close to them: "This game uses (the feature, in plain
  words). That needs Cloudflare's Workers Paid plan: at least US$5 a month, plus usage. Your
  account is on the free plan. You can turn the paid plan on here (link) and I will carry
  on, or I can leave that off for now (and what that means for the game)." The studio
  answers. The tool never changes a setting by itself and never adds a payment method.
- **Errors.** Every Cloudflare error the deploy can meet has a plain-words translation, as
  `lib/cloudflare.mjs` does today for unverified email and database limits. An error with no
  translation is shown with a sentence saying it is Cloudflare's own message and what was
  being done.
- **Skills.** `studio-setup`, `publish` and the Homie Studio checklist state what the free
  plan covers and what the paid plan adds, at the step where the studio first chooses to go
  online.
- Nothing is refused because of a plan. The studio is told, and chooses.

## 7. The rules contract

Today's netplay contract is version 1. The rules contract below is version 2 (`contract: 2`).
The parts milestone 1 builds are fixed by it. The rest is a draft until milestones 4 and 6
are both done. It is frozen then, after every case in
section 7.3 has run on real cells on Cloudflare and AI authoring has been measured for all
three profiles (spike S10). Until then a change to the draft is applied to a studio's games by the
studio's AI when Homie is updated, from a written change note, and proved by the check.
After the freeze the contract only gains things.

Milestone 1 builds the part of the `match` profile given in
[rooms-milestone-1-design.md](rooms-milestone-1-design.md), section 3. It fixes the rules of
the model that could not change later without rewriting games: section 13 of that document
lists them.

**The model.** Every entity owns its own state. A rule may write only the entity it runs
for (`self`). Everything else it reads is read-only. To affect another entity it sends an
event, which arrives on a later tick. That is true in one cell and in many, so a game cannot
work in one and break in the other.

### 7.1 Profiles: a small game sees a small contract

A game declares a `profile`. The check refuses any call outside it, the types Homie ships
expose only that profile, and the AI's skill loads only that profile's reference page. A
capability outside the profile is opted into by name with `uses`.

`uses` arrives in milestone 2 and `profile` in milestone 3. A module that names no profile
is a `match` module, so a milestone 1 game needs no change when they arrive.

| Profile | For | What it contains | Size of the reference |
|---|---|---|---|
| `match` | A match in one cell | Entities, fields, `motion`, input, `move`, `tick`, events, area events, effects, `tell`, `shared` and tallies, room scope, rounds, seats and bots, timers, calendar time, dice, maths, commands, `world.ask` | About 30 members of `world`, 16 field types |
| `world` | A lasting world | Everything in `match`, plus saved characters, items and bags, conserved value, trade, mail, the bank, cells (`cell` scope, margins, room-scope entities), `migrate` | 40 members, 17 field types |
| `mmo` | Many worlds and a shared economy | Everything in `world`, plus game scope, the market, vaults, guild fields | 48 members, 17 field types |

| Capability (`uses`) | Adds | Smallest profile |
|---|---|---|
| `attach` | Vehicles and mounts: `world.attach`, `detach`, `control`, `seats` | `match` |
| `layers` | `self.layer`, `layer:` on kinds, the `layerEnd` handler | `world` |
| `solid` | Bodies that push each other apart | `match` |

Kit pieces (section 19) come first and handlers second: the skill is told to compose the
kit and to write a handler only for what the kit lacks.

### 7.2 An example for each profile

Each example is written against the tables of section 7.4 and is a test fixture: the
build check must pass on the `match` one in milestone 1, the `world` one in milestone 3 and
the `mmo` one in milestone 4.

**`match`: collect coins in 60-second rounds.** The module is `coin-dash`, in
[rooms-milestone-1-design.md](rooms-milestone-1-design.md), section 3.6. From milestone 3 it
may also say `profile: 'match'`, and from milestone 2 its `shapes` may declare `tells`.

**`world`: a garden that keeps growing while you are away.** `move.ts` is the same as `coin-dash`'s
with `farmer` in place of `runner`.

```ts
// games/garden/src/rules.ts
import { defineRules, defineItems, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const items = defineItems({
  seed:   { stack: true },
  carrot: { stack: true, conserved: true },
});

export default defineRules({
  contract: 2, profile: 'world',
  space: { dims: 2 },
  items, move,
  shapes: {
    events:   { harvest: { by: f.ref() } },
    commands: { plant: {}, harvest: {} },
    effects:  {},
    tells:    { notRipe: { ready: f.time() } },
  },
  entities: {
    farmer: {
      player: true,                         // saved to the account in this profile
      fields: { bag: f.bag(items, { slots: 40 }) },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.4, maxSpeed: 4 },
      commands: {
        plant(world, self) {
          if (world.items.take(self, 'seed', 1))
            world.spawn('plant', self.pos, { ripeAt: world.now + 4 * 3_600_000 });
        },
        harvest(world, self) {
          for (const p of world.near(self.pos, 1, 'plant')) world.send(p.id, 'harvest', { by: self.id });
        },
      },
    },
    plant: {
      fields: { ripeAt: f.time() },         // calendar time: still right after the room slept
      on: { harvest(world, self, e) {
        if (world.now < self.ripeAt) { world.tell(e.by, 'notRipe', { ready: self.ripeAt }); return; }
        world.items.grant(e.by, 'carrot', 3);
        world.despawn(self);
      } },
    },
  },
  room: {
    join(ctx, player) {
      return player.saved
        ? { kind: 'farmer', at: player.saved.pos, from: player.saved }
        : { kind: 'farmer', at: ctx.map.spot('gate'), give: [{ item: 'seed', n: 5 }] };
    },
  },
  map: './map',
});
```

**`mmo`: emberfall.** The sample that the hard cases of section 7.3 are tested on.

```ts
// games/emberfall/src/move.ts
import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({
  hero(body, input, ctx) {
    let vz = body.vel.z - ctx.tune.gravity * ctx.dt;
    if (input.jump && body.grounded) vz = ctx.tune.jump;
    body.vel = { x: (input.ax / 127) * ctx.tune.speed, y: (input.ay / 127) * ctx.tune.speed, z: vz };
    ctx.map.sweep(body, ctx.math.scale(body.vel, ctx.dt));   // also sets body.grounded
  },
});

// games/emberfall/src/rules.ts
import { defineRules, defineItems, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const items = defineItems({
  gold:   { stack: true, conserved: true },
  potion: { stack: true, max: 99 },
  sword:  { fields: { power: f.u8(), wear: f.u16() } },   // unique: an id and state of its own
});

export default defineRules({
  contract: 2, profile: 'mmo',
  space: { dims: 3 },
  items, move,
  shapes: {
    events: {
      blast: { from: f.ref(), dmg: f.u16() },
      hit:   { from: f.ref(), dmg: f.u16() },
      take:  { by: f.ref() },
      bossDown: {}, respawn: {},
      festival: { on: f.bit() },
    },
    commands: {
      trade:  { to: f.ref(), slot: f.u16(), gold: f.u32() },
      answer: { trade: f.ref(), yes: f.bit() },
      drink:  {},
    },
    effects: { pickup: { worth: f.u8() }, bossDown: f.must({}) },
    tells:   { tradeOffer: { trade: f.ref(), from: f.ref(), item: f.text(24), gold: f.u32() } },
  },
  entities: {
    hero: {
      player: true,                                  // reachable from anywhere; saved to the account
      fields: {
        hp: f.u16({ init: 100 }),
        castAt: f.tick(), fireAt: f.tick(),
        bag: f.bag(items, { slots: 400 }),           // a bag is seen by its owner only
        party: f.ref({ see: 'owner' }),
      },
      input: { ax: f.i8(), ay: f.i8(), jump: f.press(), aim: f.dir(), cast: f.press(), fire: f.bit() },
      body: { shape: 'capsule', radius: 0.4, height: 1.8, maxSpeed: 9 },
      tick(world, self) {
        if (self.input.cast && world.tick >= self.castAt) {
          self.castAt = world.tick + world.ticks(1.5);
          world.sendArea({ sphere: [self.pos, 6] }, 'blast', { from: self.id, dmg: 20 });
        }
        if (self.input.fire && world.tick >= self.fireAt) {
          self.fireAt = world.tick + world.ticks(0.5);
          world.spawn('arrow', self.pos, { vel: world.math.scale(self.input.aim, 60), from: self.id });
        }
        for (const gem of world.near(self.pos, 1, 'gem')) world.send(gem.id, 'take', { by: self.id });
      },
      on: {
        blast(world, self, e) { if (e.from !== self.id) self.hp -= Math.min(self.hp, e.dmg); },
        hit(world, self, e)   { self.hp -= Math.min(self.hp, e.dmg); },
      },
      commands: {                                    // reliable one-shot requests from the player
        trade(world, self, c) {
          const it = self.bag.at(c.slot);
          if (!it) return;
          const trade = world.trade.offer(self, c.to, {
            give: [{ slot: c.slot }], want: [{ item: 'gold', n: c.gold }], ttl: world.ticks(30),
          });
          world.tell(c.to, 'tradeOffer', { trade, from: self.id, item: it.item, gold: c.gold });
        },
        answer(world, self, c) {
          if (c.yes) world.trade.accept(self, c.trade); else world.trade.refuse(self, c.trade);
        },
        drink(world, self) { if (world.items.take(self, 'potion', 1)) self.hp = 100; },
      },
    },
    gem: {
      fields: { worth: f.u8({ init: 1 }) },
      on: { take(world, self, e) {
        world.items.grant(e.by, 'gold', self.worth);
        world.emit('pickup', self.pos, { worth: self.worth });
        world.despawn(self);
      } },
    },
    arrow: {
      fields: { vel: f.vec3(), from: f.ref(), life: f.u8({ init: 40 }) },
      body: { shape: 'sphere', radius: 0.1, sweep: true, maxSpeed: 60 },
      tick(world, self) {
        // moves self; tests the map, entities and mirrors; never hits the shooter
        const hit = world.sweep(self, world.math.scale(self.vel, world.dt), { ignore: self.from });
        if (hit?.entity) { world.send(hit.entity, 'hit', { from: self.from, dmg: 12 }); world.despawn(self); }
        else if (hit || --self.life === 0) world.despawn(self);
      },
    },
    boss: {
      scope: 'room',                                 // seen and reachable from every cell and layer
      fields: { hp: f.u32({ init: 500000 }) },
      body: { shape: 'capsule', radius: 3, height: 8, maxSpeed: 4 },
      on: { hit(world, self, e) {
        const dmg = Math.min(self.hp, e.dmg);
        self.hp -= dmg;
        world.tally.damage.add(e.from, dmg);         // counted here, merged on the Table once a second
        if (self.hp === 0) {
          world.emit('bossDown', self.pos, {});
          world.sendRoom('bossDown', {});            // ordered after this cell's tally adds
          world.despawn(self);
        }
      } },
    },
  },
  shared: {
    bossAlive: f.bit(), festival: f.bit(),
    damage: f.tally(f.ref(), f.u32(), { max: 5000 }),
  },
  room: {                                            // runs once per room, on the Table
    start(world) { world.shared.bossAlive = 1; world.spawn('boss', world.map.spot('lair'), {}); },
    join(ctx, player) {
      return { kind: 'hero', at: player.saved?.pos ?? ctx.map.spot('town'), from: player.saved };
    },
    on: {
      bossDown(world) {
        world.shared.bossAlive = 0;
        for (const [who, dmg] of world.shared.damage) world.items.grant(who, 'gold', Math.ceil(dmg / 100));
        world.shared.damage.clear();
        world.after(world.ticks(3600), 'respawn', {});
      },
      respawn(world) { world.shared.bossAlive = 1; world.spawn('boss', world.map.spot('lair'), {}); },
    },
  },
  cell: {                                            // runs once per cell, the first time it wakes
    start(world, area) { for (const s of world.map.spots('gems', area)) world.spawn('gem', s, { worth: 1 }); },
  },
  game: {                                            // events published to every room of the game
    on: { festival(world, e) { world.shared.festival = e.on; } },
  },
  map: './map',
});
```

### 7.3 Hard cases, and how each is written

Each row has an acceptance scenario on emberfall or a small fixture game, run on real
Cloudflare in the milestone named.

| Case | How it is expressed | What the runtime does | Milestone |
|---|---|---|---|
| A trade between players in different cells | `world.trade.offer(self, otherId, { give, want, ttl })`, then `accept` on the other side | Escrow in the offerer's cell, one commit in the accepter's cell, settlement back. Section 14.1 | 4 |
| An area attack at a border | `world.sendArea({ sphere: [pos, 6] }, 'blast', ...)` | Delivered by each cell the sphere touches to the entities it owns. No mirror needed, any radius | 4 |
| A projectile crossing a border | An `arrow` entity with `sweep: true` | In the margin it is tested against mirrors and sends `hit` to the owner cell. If it crosses, it is handed over with its tick and the new cell advances it to the present (section 9.3) | 4 |
| A boss with room-wide state | `scope: 'room'` on the entity, a tally for damage, `sendRoom` when it dies | The boss lives in one cell. Its public fields reach every cell. Hits are counted in its cell and merged on the Table. The room handler runs once | 4 |
| 2,000 players in view of one boss | The same rules, with `crowd.whenFull: layer` | Layers around the boss (section 9.6). One boss, hit from every layer | 4 |
| A pickup two players reach in the same tick | Both send `take`; the gem's handler grants and despawns | The gem has one owner cell. The "same tick" rule gives it to exactly one | 1 |
| An inventory of hundreds of items | `f.bag(items, { slots: 400 })` | Stored inside the hero. One row, one handoff. Larger collections live in the bank or a vault | 3 |
| Fast-moving bodies | `body.maxSpeed`, `sweep: true` | Swept collision, speed checked against margin at build, handoff with catch-up | 4 |
| A 3D world with height | `space: { dims: 3 }`, capsules, `ctx.map.sweep` | 3D index and map. Cells are columns by default; `world.partition` may also cut by height | 1 |
| A vehicle with a driver and three passengers crossing a border | `seats` on the vehicle kind, `world.attach`, `world.control` | One group handoff. The driver predicts the vehicle. Passengers ride with no lag | 2 in one cell, 4 across borders |
| A message for one player | `world.tell(id, 'tradeOffer', ...)` | Routed to that player's Gate only | 2 |
| A buff that ends in 24 hours, online or not; a daily reset; an auction that ends at 18:00 | `f.time` fields compared with `world.now`; `world.at`; the market's auction mode | Calendar time is part of each tick's results. `world.at` is a durable alarm. Auctions end on the Market's own alarm | 3, 6 |
| A turn timer with no ticking | `tickHz: 0` and `world.at` | The room hibernates between moves and is woken by the alarm | 3 |
| A guild bank for 500 players in many worlds | A `vaults` entry owned by `guild` | A Vault object per guild, in the game's economy scope | 6 |
| A player market with the studio's fee | The `market` block | Market shards hold listings in escrow and apply the declared fee | 6 |
| A room-wide event | `world.announce('storm', {})` | Fanned out by the Table through the relay tree (section 9.5) | 4 |
| A game-wide event | A `game.on.festival` handler, published by the studio or a schedule | The Bulletin delivers it to every room (section 15.7) | 5 |
| A crop that grew while the area slept | `f.time` on the plant, or `cell.wake` | `wake` runs once on waking with the time asleep | 3 |

### 7.4 The rules

**Shape of a rules module.**

| Part | Rule |
|---|---|
| `shapes` | Every event, command, effect and tell is declared here with its data fields. The build hashes them, the wire sends their types at connect, and a send with undeclared or wrong data fails the type check |
| `entities.<kind>` | `player` (a player's body), `scope` (`'cell'` by default, or `'room'`), `fields`, `input`, `body`, and handlers: `tick(world, self)`, `on.<event>(world, self, e)`, `commands.<command>(world, self, c)`, `onRoom.<event>(world, self, e)`, `think(world, self)` |
| Built-in fields | Every entity has `id`, `kind`, `pos`, `vel`, `heading`, `grounded`. A player's body also has `input`, `seat`, `owner`, `driver` and `away`. `owner` is an opaque ref: the seat's holder in milestone 1, the account from milestone 3. `move` writes `pos`, `vel`, `heading` and `grounded`; a handler may write its own `vel` and `heading`, and changes its own `pos` with `world.place` or `world.sweep` |
| `motion` | The part of an entity's state that `move` reads and writes, and its own handlers too: a knock, a stun, a boost, a cooldown. It is what the client replays besides the built-in fields |
| Field types | Integers (`f.u8` to `f.u32`, `f.i8` to `f.i32`), `f.bit`, `f.fix` (fixed-point), `f.vec3`, `f.dir`, `f.tick` and `f.ticks` (a moment and a length on the room's clock), `f.time` and `f.span` (calendar time, in milliseconds), `f.ref` (the id of an entity, a player or a trade), `f.text(max)`, `f.list`, `f.map`, `f.struct`, `f.bag`, in `input` only `f.press` (a button that fires once), and in `shared` only `f.tally`. Lists, maps, bags and tallies declare a maximum size |
| Field options | `init`, and `see`: `'public'` (the default), `'owner'` (only the player who owns the entity) or `'server'` (never sent). A bag is `'owner'` unless it says otherwise. Watchers see `'public'` only |
| Scopes | Entity handlers run in the cell that owns the entity. `room` handlers run once per room, on the Table. `cell.start` and `cell.wake` run in a cell. `game.on` handlers run in room scope in every room |
| Ownership | A handler writes `self` only, or `world.shared` in room scope. Query results, mirrors and event data are frozen |
| Shape changes | The build derives a state hash from everything a save's meaning depends on (milestone 1 design, section 5). `migrate.up` maps the previous build's state to this one, and the optional `migrate.down` maps it back (section 11.2) |

**Time and chance.**

| Part | Rule |
|---|---|
| The room's clock | The runtime calls `tick` at `tickHz`. `world.tick` is the room's clock, the same number in every cell (section 9.5). `world.ticks(seconds)` converts. `world.dt` is one tick in seconds. The clock stops while a room sleeps and may run slow under load |
| Calendar time | `world.now` is the real time in milliseconds, supplied by the server once per tick and recorded with the tick's results. It never goes backwards in a room. Use `f.time` for anything that must stay right when the room sleeps, the character leaves, or the world is another copy |
| Saved moments | When a character is saved, its `f.tick` fields are stored as ticks remaining and rebased when it joins a room, so a cooldown resumes. `f.time` fields are stored as they are |
| Timers | `world.after(ticks, event, data)` delivers an event later: to `self` from an entity handler, to the room from room scope. `world.at(time, event, data)` in room scope fires at a calendar time. It is durable, survives a sleeping room, and wakes the room |
| No tick | With `tickHz: 0` there is no `tick` handler and no `world.tick`, `f.tick`, `world.ticks` or `world.after`; the check refuses them. Events, commands, `world.now` and `world.at` remain. A turn timer is `world.at(world.now + 30_000, 'turnOver', {})` |
| Dice | `world.random()` only. The seed is cell state |
| Maths | `+ - * /`, `%`, and `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `sign`, `imul`, `fround`: each has one correct result. Everything else, including `sin`, `cos`, `atan2`, `pow`, `exp`, `log`, `hypot` and the `**` operator, is refused; `world.math` supplies them in plain arithmetic so that server, browser and build check agree |
| Flags and tunables | `world.flags` (set by the studio, live) and `world.tune` (`tunables.json`, with a `public` part that `move` may read). Both read-only |
| Promises | `async`, `await`, `Promise`, generators and `queueMicrotask` are refused. A handler finishes inside its tick |

**Events and messages.**

| Part | Rule |
|---|---|
| Events | `world.send(targetId, event, data)`. Delivered on a later tick, in order per sender and target, exactly once. The target may be anywhere in the room if it is a player's body or `scope: 'room'`; otherwise it must be in the cell or a mirror |
| Undeliverable | If the target no longer exists, the sender receives the built-in event `undeliverable` with the original event and data, if it declares a handler `on.undeliverable` |
| Same tick | Events for one entity in one tick run in a fixed order (sender id, then sequence). `world.despawn(self)` takes effect at once: later events for that entity in the same tick are not run and are undeliverable. So exactly one of two takers gets the coin |
| Area events | `world.sendArea(shape, event, data)` delivers to every entity inside a sphere, box or cone of any size, in every cell the shape touches |
| Room events | `world.sendRoom(event, data)` runs a `room.on` handler on the Table. `world.announce(event, data)` from room scope reaches every entity whose kind declares that event under `onRoom`, in every awake cell |
| Tallies | `world.tally.<name>.add(key, n)` adds to a `shared` tally from any scope. Each cell merges its adds and sends them to the Table once a second, and always before a `sendRoom` of its own. In room scope the tally is read by iteration and emptied with `clear()`. Adds for new keys past `max` are refused and reported |
| Effects | `world.emit(effect, at, data)` is seen by players near `at`. Effects declared with `f.must` are never dropped. Others may be dropped for far players |
| Tell | `world.tell(playerBodyId, tell, data)` reaches that one player's view and nobody else, reliably, wherever in the room the player is |
| Mail | `world.mail(account, tell, data)` is stored on the player's account and delivered as a tell at their next join in any room of the game. `world` profile |
| Game events | A `game.on` handler runs when the studio, a schedule or `world.publish(event, data)` from room scope publishes that event (section 15.7). `mmo` profile |
| Asking outside | `world.ask(name, state)` for an AI decision (milestone 1; its section 3.10) or a studio webhook (milestone 5). The answer arrives later as an event |
| Operators | A mute, freeze or studio-defined tag set by an operator appears as read-only `self.marks` on the player's body. A frozen player's input is dropped by the runtime, so rules need do nothing |

**Bodies and space.**

| Part | Rule |
|---|---|
| Spawning | `world.spawn(kind, at, fields)` returns the new id. The entity exists from the next tick, in whichever cell owns `at`. `world.despawn(self)` removes the running entity |
| Joining | `room.join(ctx, player)` is pure: it reads the static map, a read-only copy of `shared`, and `player.saved`. It returns `{ kind, at, heading?, fields?, motion?, from?, give? }`. `give` lists starting items, minted through the ledger. It runs on a Door, so a join never touches the Table |
| Seats, bots, rounds, results | As in milestone 1 design, section 3.6: `room.rounds`, `room.bots`, `player: { away, leave }`, `score: true`, `world.round`, `world.level` |
| Placing | `world.place(self, at)` puts the running entity somewhere at once and raises its placement counter, so views jump and do not glide |
| Ending | `world.finish()` in room scope ends the match and starts the room fresh. Seats stay |
| Queries | `world.near(pos, r, kind)`, `world.inBox(box, kind)`, `world.ray(from, dir, max)`. Reach is `cell.marginM` at most. Results are frozen views, each with an `id`, and include mirrors from neighbouring cells. No list of all entities |
| Sweep | `world.sweep(self, delta, { ignore })` moves `self` along `delta` and stops at the first thing in the way. It returns nothing, or `{ entity?, at, normal }`, where `entity` is an id |
| Movement | `move[kind](body, input, ctx)` runs once per body per tick. It reads and writes the body's built-in fields and its `motion`, and reads the step's input, the static map, public tunables and the tick: `ctx.tick`, `ctx.dt`, `ctx.tune`, `ctx.math`, `ctx.map.sweep(body, delta)`. Nothing else. The server runs it; the client runs the same code to predict. Rules steer it by writing `motion`, setting `vel` or calling `world.place` |
| Fast bodies | `body.sweep: true` tests the whole path of a tick, so nothing tunnels. The build reports a `body.maxSpeed` that could cross the margin in the measured handoff time |
| Solid bodies | Bodies overlap freely unless both declare `solid: true` (capability `solid`). After the movement phase the core pushes overlapping solid bodies apart, in id order, in two passes. Clients do not predict it; they blend to the server's result |
| Dimensions | Positions are `x`, `y`, `z` in metres. `space.dims: 2` fixes `z` at 0 and uses a flat index and circles. `dims: 3` uses a 3D index, spheres, capsules and boxes, and a map with several levels |
| Static world | `map` is data in `games/<id>/map/`: height tiles, colliders (boxes, spheres, capsules, triangle meshes compiled to a tree), zones, named spots, a navigation mesh. `world.map.spot(name)`, `spots(name, area?)`, `zoneAt(pos)`. The build compiles the map to hashed chunks in R2. A cell loads the chunks it covers. The client streams the same files |
| Attachment | `world.attach(self, parentId, seat)` asks to ride a parent whose kind declares `seats`. The parent's cell grants seats in event order and answers with the built-in event `attached` or `attachRefused`. An attached entity takes its position from the parent, crosses a border with it in one group, and is drawn with no lag. `world.control(self, parentId)` from a seat marked `drives` sends that player's input to the parent's `move`, and the driver's client predicts the vehicle. `world.detach(self)` leaves. Capability `attach` |
| Bots | A bot is a body whose input is the step its kind's `think` handler returns. Same input path as a player |
| Per-tick order | Each tick runs in phases: inputs and `move` for every body; `tick` handlers for every entity; then queued events and spawns. The first two phases always run for every entity. Only the third may be carried into the next tick when the time budget is used up (section 8.3). A kind may declare `every: n` to run its `tick` handler every n ticks |
| Ids | 64 bits: a block number handed out by the Table and a counter. Never reused |
| Authority | Each entity has exactly one authoritative cell at a time (section 9.3) |

**Value** (`world` profile and up).

| Part | Rule |
|---|---|
| Items | Declared with `defineItems`. A `stack` item is a count; any other item is a record with an id and fields. A `conserved` item or field changes only through the calls in this table, and every change is in the ledger |
| Inventory | `f.bag(items, { slots })` holds stacks and unique item records inside the entity. `bag.at(slot)` returns a frozen `{ item, n, fields }` or nothing. A bag of 400 slots is about 4 KB. A bag moves with its holder |
| Changing a bag | `world.items.take(self, item, n)` removes from `self`'s bag and reports whether it could (a conserved item is recorded as burned). `world.items.mint(self, item, n)` and `burn` in any scope. `world.items.count(self, item)`. `world.items.move(self, slot, toSlot)` |
| Granting | `world.items.grant(playerBodyId, item, n)` mints and credits wherever the player is. If the player has left the room, the Directory still knows which account the body belonged to, and the goods go to the character's mailbox on that account (section 13.2). Nothing is refunded and nothing is lost |
| Ground | `world.drop(self, slot, at)` turns a record into an entity on the ground. `world.pick(self, groundId)` sends the request; the ground entity's owner cell gives it to the first asker |
| Trade | `world.trade.offer(self, otherId, { give, want, ttl })` returns the trade's id. `give` names `self`'s slots; `want` names items and counts. `accept(self, tradeId)`, `refuse`, `cancel`. Both sides' goods move or neither does (section 14.1) |
| Bank | `world.bank.deposit(self, slot)` and `withdraw(self, bankSlot)`: an exchange between the cell and the Player object, by the trade protocol |
| Market | `world.market.list(self, { slot, price, ttl })`, `buy(self, listingId)`, `bid(self, listingId, amount)`, `cancel(self, listingId)`. The studio's `market` block declares the currency, the mode (fixed price or auction), fees, taxes and limits as data, and may add pure functions `fee(listing, tune)` and `mayList(seller, item)` (section 14.4). `mmo` profile |
| Vaults | `world.vault(name, ownerId).deposit(self, slot)`, `withdraw(self, vaultSlot)` and `list(self)`, which answers with a tell. The `vaults` block declares each vault's size, its owner kind (guild, party, a placed object) and who may do what (section 14.5). `mmo` profile |
| Guilds | A player's body carries read-only `guild` and `guildRank`. `mmo` profile |

**Rooms of many cells** (`world` profile and up).

| Part | Rule |
|---|---|
| Shared state | `world.shared`, at most 1 MB. Written only in room scope. In a cell it is read-only and at most two ticks old (the figure is replaced by spike S4's measurement) |
| Room-scope entities | A `scope: 'room'` entity lives in one cell. Its public fields reach every cell and layer, and any entity may send it events |
| Sleeping cells | A cell with nobody near stops. When it wakes, `cell.wake(world, area, asleep)` runs once, with `asleep.ticks` and `asleep.ms`, so rules can bring it up to date by arithmetic (regrow, respawn). Ticks are not replayed unless `cell.catchUpTicks` asks for some. `room.wake(world, asleep)` is the same for a room that slept |
| Layers | See section 9.6. A kind may declare `layer: 'each'` (the default: one per layer) or `'all'` (one, seen in every layer). Capability `layers` exposes `self.layer` and the `cell.layerEnd(world, area)` handler |
| Per-tick volume | No hard cap on spawns or events. Events and spawns past the tick's time budget are carried to the next tick in order, and the backlog is reported (section 8.3). Nothing is thrown away |

### 7.5 The view's side (`@homie-rocks/studio/rules/view`)

- `openRoom<typeof rules>()` gives a view its room.
- `room.me`: the player's own predicted body. `room.me.controls` is the vehicle it drives,
  if any.
- `room.each(kind, fn)`: entities in view, interpolated to render time.
- `room.on(effect | tell | 'enter' | 'leave', fn)`, `room.shared`, `room.input(sample)`,
  `room.command(command, data)`.
- `room.seat`, `room.roster`, `room.status`, `room.now` (the server's calendar time),
  `room.follow(id)` for watchers, `room.voice` (section 17).
- The view never packs or unpacks state. The runtime does it from the schema the server
  sends at connect (section 11.3).

### 7.6 Seats, identity and watchers

- A seat is a number kept by the room, with a token, as today. The seat map is rows.
- At join the site Worker checks the ticket and the account once and the Door signs a
  **room pass**: seat, account, marks, expiry in 60 s, renewed over the socket. Gates verify
  a pass with a key and read no database.
- A Gate also issues a **resume token** over the socket, valid for 10 minutes and tied to
  the room's revocation counter. A client that reconnects within that time needs nothing
  else. After it, the client asks the site Worker for a new pass.
- A ban or kick raises the room's revocation counter. The Table pushes it to every Gate and
  Door, so it takes effect within one tick, not when a pass expires.
- A watcher is a client with no body. It follows an entity, or looks at a region given as a
  box in world metres. It receives `public` fields only.

## 8. Where rules run

### 8.1 The choice

| Option | For | Against | Verdict |
|---|---|---|---|
| In the Durable Object's own isolate | No call overhead. Works everywhere | No wall between a game's code and `env` (accounts, Stripe, keys). CPU guard has to be injected. A runaway or a memory blow-up takes down every object in the isolate. New rules need a Worker deploy, which restarts every object | Milestone 1. After it: accounts on Workers Free, local dev, browser-hosted mode and the last fallback |
| **A Durable Object Facet (Dynamic Worker) per cell** | A real sandbox: no bindings, no network. Cloudflare's own CPU limit per call. Rules load from R2 by hash, so a rules change is not a Worker deploy | A call per tick crosses an isolate boundary. Thread, memory and lifetime behaviour are not documented | **Default for server-hosted rooms from milestone 3, part A**, on accounts with Workers Paid, subject to spike S1 |
| A Container per cell | Up to 4 real vCPU and 12 GiB. Real threads. No shared isolate | 1 to 3 s cold start. May be placed away from its object. Priced for sustained compute | **Heavy cells**, subject to spike S5 |

**What the design relies on from a facet, and nothing more.** Each is tested in S1.

- An addressable child that keeps its memory between calls while its Cell stays awake.
- `abort`, to throw a Sim away.
- The Dynamic Worker sandbox: no bindings, no network, `limits.cpuMs`.
- It does **not** rely on the facet's own database. All durable state is in the Cell, so one
  transaction covers the journal row and the outbox. The Sim is a cache of the Cell's state.

**Loading and reloading a Sim.**

- The Cell streams entity pages to a new Sim in chunks of 1 MB, then the journal rows since
  the last checkpoint. A Sim is rebuilt after a rules swap, a killed tick, a Cell restart
  and a wake from sleep.
- Target: 250 ms or less for 16 MB of state, 1 s or less for 48 MB (S1 measures 4, 16 and
  48 MB). A cell is paused for that long, and its neighbours and Gates carry on.
- A `tickHz: 0` room rebuilds its Sim on every wake. Its state is small. S1 measures the
  cold start.

**Which isolate a Sim lands in.** `env.LOADER.get(id, ...)` may reuse a warm Worker for the
same id (section 4). So the id decides who shares memory and a thread, and it is also the
unit Cloudflare bills ($0.002 per id and code per day).

| `sim.isolation` | Id | Shares with | Fee |
|---|---|---|---|
| `cell` | rules hash + the cell's name | Nobody | $0.002 per cell per day |
| `shared` | rules hash + a slot number, the cell's name hashed into N slots | Other Sims of the same build in the same slot on the same machine | $0.002 × N per build per day |
| `auto` | `cell` for persistent rooms, `shared` for match rooms | | |

- N is set from S3's density figure so that tick punctuality holds, not from the fee.
- Why `shared` for matches: a match is short and identical to its neighbours. Sharing costs
  a player nothing that S3 can measure, and a fault in one build's rules can only disturb
  other matches of that same build, each of which recovers from its journal. A studio that
  wants every match alone sets `cell`; the cost model shows the fee (section 21).
- If S1 finds that the same id never shares an isolate, `shared` is dropped and every Sim
  uses the rules hash as its id.

**Parts and the core.**

- Parts that carry rules are bundled into the game's rules and run inside that game's Sim.
  A hostile part can spoil the simulation of the game that installed it. It cannot reach
  accounts, purchases, keys, the database, the network or any other game. Purchases and
  account items are held by Player objects outside the sandbox, and a Sim can only receive
  them.
- The simulation core (entity store, index, event queue, serialiser) ships inside the Sim,
  next to the rules. The Cell stays small and trusted: sockets and links, the journal, and
  calls into the Sim.
- The Cell calls `sim.tick(inputs, inbox, now)` once per tick. The Sim returns the tick's
  changes: changed fields, outgoing messages, effects, tells, account effects. The Cell
  journals them (section 12) and forwards them.

### 8.2 The Container host

- `sim.host: container` runs the same rules bundle and core in a Container, under Node, with
  the Cell as its only client over one socket.
- The Container class is declared when milestone 10 ships. Its image is one
  generic Homie image published to a public registry, so a studio needs no Docker (section
  4, image management). If S5 finds that a public image cannot be used, `homie-studio`
  pushes the image to the studio's own Cloudflare registry over the registry's HTTP
  interface, still without Docker.
- `auto` selects it when the build check's measured tick cost at the declared size is over
  the isolate budget, or when `cell.stateMB` is over the isolate limit.
- A world may mix hosts: most cells on isolates, the capital city on a Container.
- With more than one vCPU the core runs the tick in parallel phases: movement and queries
  across worker threads, then event handlers in the fixed order on one thread. Results are
  identical to a one-thread run.
- A Container rollout sends SIGTERM with up to 15 minutes' notice. The Cell uses it to
  finish the tick and stop cleanly. Nothing depends on that: recovery is the same as for any
  restart.
- Cloudflare allows 1,500 vCPU at once per account. That is 375 four-vCPU cells. The way
  past it is Cloudflare's limit-increase request, and the deploy plan says so when a game's
  settings come within reach of it.

### 8.3 Time and memory guard

- **Hard stop.** Each `sim.tick` call carries `limits.cpuMs` equal to `sim.hardMs`: four
  tick periods by default, so a runaway stalls a cell for 200 ms at 20 Hz, not a second.
  Cloudflare stops a call that passes it. Rules cannot catch that.
- **Soft budget.** A tick should use at most 60% of its period. Movement and `tick`
  handlers always run for every entity. The core then runs queued events and spawns until
  the budget is used, and carries the rest to the next tick in order. If movement and `tick`
  handlers alone pass the budget, the cell is late and says so; the remedies are the ones
  under "sustained load" below.
- **A handler that throws.** Fields are copied on first write, per field. On a throw the
  core restores those fields and discards that handler's outgoing events. One entity misses
  one handler. The cell is not rolled back. The error goes to the Cell in the tick's result
  and is logged with game, build, kind and handler.
- **A killed tick** (hard stop or out of memory). The Cell discards the Sim, reloads it from
  pages and journal (section 12), and reruns the tick with the **probe bundle**. The probe
  finds the handler that does not finish. That entity is **quarantined**: frozen, flagged in
  the game-master tools, and its handler skipped. The cell continues. Three quarantines of
  one kind in ten minutes disable that kind's handler in the room and alert the studio.
- **A kill the probe cannot explain** (out of memory with no runaway handler). The Cell
  quarantines the kind whose stored size grew most since the last checkpoint. If the next
  tick is killed again, the cell stops, alerts the studio and stays stopped until an
  operator acts. No other cell is touched.
- The counter and its transform are built in milestone 1, where it is always on and rules
  may not contain `try` (milestone 1 design, section 10). Milestone 3, part A adds the
  rewrite of every `catch` to rethrow the counter's error, which lets rules use `try`.
- **Under sustained load**, in order: far-tier sends thin out; the cell splits (section
  9.4); a crowd is layered, queued or held (section 10.4); the cell reports lag and the room
  slows its clock for everyone (section 9.5). The deploy plan and the dashboards say when a
  cell would be better on a Container.
- **Measuring.** The Cell times every Sim call and reports the figures with its metrics.
  Cloudflare's own CPU figure per call comes through the Tail Worker, which `homie-studio
  perf` attaches to a chosen room for a session. The build check calibrates its local
  measurements against those numbers, not against a formula.

### 8.4 Threads and class copies

Cloudflare may host many objects of one class in one isolate, on one thread (section 4). A
hundred thousand players in 8-seat matches are 12,500 ticking objects of one class.

- **Class copies.** The rooms Worker declares each ticking class in numbered copies:
  `Table_00` to `Table_47`, `Cell_00` to `Cell_63`, `Gate_00` to `Gate_63`, and `Player_00`
  to `Player_15`. An object's copy is chosen by hash when it is created and written into its
  id. That is about 230 classes of the 500 an account may have on the paid plan.
- On the free plan (100 classes) the rooms Worker declares fewer copies: 8 Tables, 16
  Players and the classes that have no copies. Moving to the paid plan adds copies in one
  direct deploy. No existing object moves, because its copy is in its id.
- **A registry.** The Worker keeps a module-level registry, so objects that share an isolate
  know it, stagger their timer phases and report how many they share with.
- **How a cell ticks.** A timer inside the object, not an alarm: an alarm is a billed
  request and a billed row each time (section 4). One alarm every 30 s is the watchdog that
  restarts ticking if the object was evicted.
- **Spike S3** measures density at match scale: 2,000, 5,000 and 12,500 rooms ticking at
  20 Hz, and whether two class copies ever share an isolate. It runs in milestone 5,
  which sets the number of copies. Milestone 3 declares a first set and puts the copy number
  in the id of every long-lived object, so that adding copies later is one direct deploy
  that moves nothing. A match room needs no such number before then: its object does not
  outlive the match.
- **If class copies do share isolates**, the copies become separate Workers (`rooms-00`,
  `rooms-01`, ...), bound by `script_name`. Separate Workers never share an isolate, and an
  account may have 500.
- **If two busy cells still collide**, the busier one moves its Sim to a Container. That
  fallback lowers no rate. It is for busy cells, not for thousands of match rooms; those are
  spread by the copies above.

## 9. Cells, borders and the clock

### 9.1 The partition

- A room's space is a tree of boxes. Each leaf is a cell. A match room is one leaf.
- The tree starts from the map: `world.partition: auto` makes leaves of `cell.minM × 4`
  and makes smaller leaves, down to `cell.minM`, in regions the map marks as `dense` (a
  town).
- The tree is kept **balanced**: two leaves that touch differ by at most one level. So a
  cell touches at most 12 others (two on each side and four corners), and its message rate
  is bounded whatever the map looks like.
- The Table stores the tree with a version number. Every message between cells carries the
  version. A cell that receives an older version answers "moved" with the new tree.
- Cells are columns by default. A map may cut by height too, for towers or space.
- There is no cap on the number of cells.
- A cell with nobody within its margin, no player's band reaching it and no pending timer
  goes **idle** (unless `cell.whenIdle: run`): it stops its timer, closes the links it
  dialled and tells its neighbours to close theirs. It then holds no timer and no outbound
  connection, so Cloudflare can hibernate it. A neighbour that needs it sends one call,
  which wakes it; it re-opens its links.

### 9.2 Borders and links

- Two cells that touch share one socket, carrying one frame per tick each way. A neighbour's
  entity inside the margin is a read-only **mirror**.
- The same frame carries the neighbour's **band**: its entities within `view.radiusM +
  gate.rehomeM` of the border, already encoded for clients. A cell passes a band on to its
  own Gates without reading it. So a Gate talks to one cell only (section 10.1).
- Between two awake cells with nothing in either margin, the link carries one frame a
  second.
- **Who dials.** The Table assigns each link's dialling side so that no cell dials more
  than half of its neighbours: at most 6. Gates dial their cell. A cell reaches the Table,
  the Directory and Player objects by calls, at most 4 in flight.
- The Workers limits page allows six connections "simultaneously waiting for response
  headers" and lists outbound WebSockets among what counts. An established socket is no
  longer waiting for headers, so the design should fit, but the page does not say so for
  traffic between objects. Spike S4 settles it. If established sockets do count, the Table
  assigns sides so that no cell dials more than 4, which leaves 2 for calls, and a link that
  cannot be assigned under that rule runs as one call per frame.
- **If sockets between objects fail S4 altogether**, a link becomes one call per frame.
  That works the same and costs more (section 21 gives the figure).
- `scope: 'room'` entities are relayed to every awake cell through the relay tree, at
  `send.farHz`.

### 9.3 Handoff

- A body changes cell when it is `cell.hysteresisM` past the border. There is no time
  lockout; the distance alone stops flapping.
- The old cell removes the entity in a tick and puts it, with everything it holds and
  everything attached to it, in one reliable message stamped with that tick. A group too
  large for one 2 MB row is sent as numbered parts that the new cell applies together or not
  at all.
- The new cell adds it on receipt and advances it by the ticks that passed, running `move`
  or `sweep` for each. A projectile at 60 m/s does not skip.
- While the message is in flight the old cell shows a moving ghost, so players see no gap.
- The entity exists exactly once at every moment: in a cell's state, or in an outbox. That
  holds through any restart (section 12).
- The old cell tells the Directory, and keeps a forwarding note for the entity so that a
  long-range event sent to the old cell follows it.
- A player's socket follows a little later (section 10.1). Until it does, the old cell
  passes the player's input to the new one over the border link, one tick late.

### 9.4 Split and merge at run time

A fixed grid forces a choice between a large world and small cells. So the tree changes with
the crowd. The Table orders every change, one at a time per neighbourhood: it starts no
change that touches a cell which is part of, or next to, a change not yet committed.

**Names and links.** A cell's name carries its tree path and the tree version it was born
in. A link is named by its two cells and has its own sequence numbers. So a child or a
merged cell never shares a name, a link or a sequence with the cell it replaces.

**Split of cell P into C1 and C2.**

1. **Plan.** The Table journals the plan (P, C1, C2, the cut line, the next tree version)
   and sends it to P reliably.
2. **Close.** P stops simulating at a tick. In one transaction it writes its closing row,
   marks itself a **forwarder**, and puts one `adopt` message for each child in its outbox.
   An `adopt` carries that half's entities, pending trade escrows and offers (each goes with
   the entity it belongs to), timers, and a dice seed derived from P's.
3. **Adopt.** Each child journals what it received and acknowledges. It starts simulating
   at the present tick.
4. **Commit.** When P reports closed and both children report adopted, the Table commits
   the new tree version, journals it, and sends it to the cells, Doors and Directory. Until
   that commit the old tree is the truth and P owns the area: P is paused and stores what
   arrives. Players in the area see a pause of under a second.
5. **Relink.** After the commit P answers each neighbour and Gate with "moved" and the new
   tree. Each Gate is given the child that holds most of its players.

**What a forwarder does.** It never simulates again. It keeps two jobs until they are done.

- **Its own outbox.** P keeps resending the messages it had already decided to send (events,
  handoffs, trade settlements, effects on Player objects) on its old links, under their old
  sequence numbers, until each is acknowledged.
- **Its old inbound links.** P keeps the table of the highest sequence it applied from each
  sender. A message that arrives on an old link is checked against that table. A repeat is
  acknowledged and dropped. A new one is journalled, passed to the right child on the link
  P to child (which has its own sequence), and then acknowledged.
- **Order.** A neighbour X that learns the new tree first drains its outbox for P, then
  sends P a `closed` mark for the link. P passes the mark on to the children. A child holds
  messages that X sends it directly until the mark has arrived, so X's messages are applied
  in the order X sent them.
- **The case that would duplicate.** X hands entity E to P, P applies it, the acknowledgement
  is lost, P splits. X resends. P's table says it was applied, so P acknowledges and drops
  it. E is in the half that was adopted, once.

**Merge of siblings C1 and C2 into M.** The plan names a tick a second ahead; both stop at
it, which the shared clock makes the same moment.

1. Each sibling writes its closing row, becomes a forwarder, and puts one `adopt` for M in
   its outbox, with its state, its escrows and offers, its timers and its dice state.
2. M journals each `adopt` as it arrives and starts simulating when it has both. Its dice
   seed is derived from both.
3. The Table commits when both siblings are closed and M has adopted.

- Each sibling keeps its own outbox and its own applied table, as a forwarder. Nothing has
  to be merged.
- An event addressed to either sibling, from anywhere, arrives at that sibling's forwarder
  and is passed to M.
- An entity that was crossing from C1 to C2 is in C1's outbox. C2's forwarder accepts it
  and passes it to M. It was removed from C1's state before the closing row, so M has it
  once.
- A trade pending between an entity of C1 and one of C2 becomes a trade inside one cell:
  the escrow and the offer both arrive in M. A settlement already in flight drains through
  the forwarders.

**Failure.** Each closing row and its `adopt` messages are one transaction. Plans, adopts
and commits are reliable messages with ids, so a restart at any point continues the same
change. A Table restart re-sends the plan it had journalled.

**Thrash.** A cell splits when its tick time, entity count or state size stays over a
threshold for 30 s. Two siblings merge when their sum stays under 30% of it for 10 minutes.
A leaf lives at least 10 minutes.

**Fencing.** Whatever wakes a forwarder (a stale link, an old pass, an alarm) finds its
closing row first.

**Reclaiming forwarders.** A forwarder is done when its outbox is empty and every sender
has closed its link. It still has to exist while a restore point can refer to it.

- After the 30-day recovery window, a done forwarder hands its applied table to the Table
  and deletes its storage with `deleteAll()`.
- The Table keeps those rows only for links that some sender has not yet closed, and drops
  each when it closes. So nothing grows without bound: a town that splits every evening for
  a year holds at most 30 days of forwarders.
- An object that is woken with no storage and a name that is not in the current tree asks
  the Table, which answers for it from those rows.

**Limits and tools.** Leaves go down to `cell.minM` and no further. A crowd that is all in
one view (a tavern) is not helped by splitting space; that is the crowd case of section
10.4. `world.partition` can also be declared by hand, and `homie-studio partition` proposes
a starting tree from the population heat map in the metrics.

### 9.5 One clock, room-wide state

- The Table owns the room clock: a start time and a rate. Tick `n` is the same moment in
  every cell. Each cell derives its tick from Cloudflare's clock and never runs ahead. The
  clock needs no ticking object: an empty room's Table can hibernate and its clock still
  runs.
- A cell that falls more than half a second behind reports it. Splitting (9.4) and crowd
  handling (10.4) come first. As the last resort the Table lowers the clock rate for the
  whole room and says so to clients ("time is running at 80%"). Calendar time (`world.now`)
  is not slowed.
- `shared` lives on the Table. Room-scope handlers run there, in a Sim of the same rules
  bundle. The Table journals when something changes, not every tick. Changes go to cells as
  reliable messages through a **relay tree**: the Table calls 6 cells, each passes the
  message to up to 6 more. They apply at the next tick. A sleeping cell fetches the current
  `shared` when it wakes.
- **Tallies** go the other way: each cell sends its merged adds once a second, and the Table
  merges them without running a handler.
- **Room-scope load.** The design figure is 200 room-scope handler runs a second. The build
  check flags a `sendRoom` that its generated tests ran more often than that and names
  `tally` as the fix. Past the figure, room events queue and the backlog is reported.
- **Timers.** `world.after` in room scope and `world.at` are Durable Object alarms on the
  Table. They fire in an empty room, and wake a sleeping one when `whenEmpty` is `run`.
- **Reaching a far entity.** Directory shards hold, for each player's body and each
  `scope: 'room'` entity, the cell it is in. Cells write to them on handoff and cache what
  they read. A cell sends a long-range event straight to the owning cell. If the entity has
  moved, that cell forwards it. `undeliverable` means the entity truly no longer exists.
  Nothing expires on a timer.
- The Table is not in any cell's tick and not on the join path. A Table restart pauses
  room-scope rules for one to three seconds and nothing else.

### 9.6 Layers

A **layer** is a second set of cells for the same part of the map inside one room. It is the
answer to a crowd that splitting space cannot thin. A **world copy** is a whole other room.

| Question | Answer |
|---|---|
| When does a layer open | When a cell reaches `crowd.cap` with `crowd.whenFull: layer`, for that cell and the cells that touch it |
| What exists in each layer | Kinds with `layer: 'each'` (the default): monsters, pickups, projectiles. `cell.start` runs in the new layer's cells |
| What exists once | `scope: 'room'` entities, and kinds with `layer: 'all'` (a house, a market stall). They live in layer 0 and are mirrored read-only into the others. Events to them are delivered to layer 0 |
| Who a player sees | Their own layer, plus the once-only kinds. `crowd.showOtherLayers` adds the other layers' players as a thinned far-tier feed, or a count |
| Queries | `world.near` and the others return the player's own layer and the once-only kinds |
| Trades, tells, parties, chat | Work across layers: they go by id, not by position |
| Staying together | Arrivals go to the layer that holds their party or the friend they follow, if it has room. A player may change layer when the studio allows it; that is a handoff |
| The world boss | One boss in layer 0. Players in every layer see it and hit it. Hits are events to its cell; damage is a tally |
| Closing | When two layers together stay under 60% of the cap for 5 minutes, the higher one drains: its players hand off to the same positions in the lower one. Its `each` entities are despawned, after `cell.layerEnd` has run if the rules declare it. Conserved items on the ground move to the lower layer |
| Mechanics | A layer's cells are ordinary cells with a layer number in their name. Moving between layers is an ordinary handoff. Split and merge work inside a layer |

## 10. Players' connections

### 10.1 Gates

- A player's socket is held by a Gate. **A Gate belongs to one cell** and is created beside
  it, with the same location hint. A player's connection reaches Cloudflare at the nearest
  data centre whatever the Gate's location, so a Gate near the player would shorten nothing:
  the path to the cell is the same length.
- A Gate holds `floor(500 ÷ inputHz)` players: 25 at 20 Hz, 16 at 30, 8 at 60. The 500 is
  Cloudflare's guidance for an object doing light work per message. Spike S6 measures the
  real figure and the number is replaced.
- A Gate batches its players' inputs into one frame per tick to its cell, and receives one
  frame per tick from it: the cell's own changes, plus the bands of its neighbours. A player
  near a corner sees into four cells through one socket and one Gate.
- So a cell hears from its own Gates and its neighbours, and from nobody else.

| Inbound to one cell at 20 Hz | Frames a second |
|---|---|
| 12 neighbours at most | 240 |
| 13 Gates (325 players) | 260 |
| **Total** | **500, the design figure** |

- **Past 13 Gates on one cell**, Gates attach through a **concentrator**: a Gate in a
  second role that merges up to 16 Gates' frames into one. Two levels carry 208 Gates, or
  5,200 players, to one cell. That is beyond what one cell can simulate, so the concentrator
  is never the limit. It ships with Gates in milestone 2.
- **Outbound.** A cell sends one frame to each of its Gates. If S6 finds that this costs
  more than a tenth of a tick, a cell's Gates are filled by position and each is sent only
  the entities inside its box grown by the view radius.
- **When a player crosses a border**, the entity is handed off at once (section 9.3) and
  the socket follows:
  1. The player's Gate keeps serving them as a guest. It still sees everything around them,
     because the band reaches `view.radiusM + gate.rehomeM` into the next cell. Their input
     goes through the old cell over the border link, one tick late.
  2. When the player is `gate.rehomeM` into the new cell and has been there 2 s, the old
     Gate sends the client the address of a Gate of the new cell and a resume token.
  3. The client opens the second socket, resumes with its last acknowledged input and state
     tick, and closes the first when the new one is live. No input is lost and the gap in
     state is zero, because both sockets are open during the change.
- This is the same resume the client uses after any reconnect, and it is tested as one.
- A body that crosses cells faster than its socket can follow would outrun its Gate. The
  build check reports any kind whose `maxSpeed` crosses the smallest cell in under 3 s and
  names the fix: a larger `cell.minM`.
- A room that fits one object needs no separate Gate: up to `floor(500 ÷ inputHz)` seats and
  one cell. The Table does every job. Milestone 1 keeps today's 32 seats for such a room and
  measures it (T1). Milestone 2 replaces the figure with the S6 measurement.
- A Gate keeps no state that matters. If it restarts, its players reconnect with their
  resume tokens and resend the inputs and commands the cell has not acknowledged.

### 10.2 Interest and deltas

- Each client has a downstream budget in bytes a second. Each (client, entity) pair has a
  priority that grows with time unsent and falls with distance. Each send fills from the
  top.
- Entities inside `view.nearM` update at `send.nearHz`. The rest update at `send.farHz`.
- State is sent as deltas against the last state the client acknowledged, with short ids.
  Ids are per Gate. A Gate's players are all in or beside one cell, so the far tier is
  encoded once per Gate and shared by its players.
- **The overview feed.** A view wider than one cell (a strategy map, a watcher looking at a
  region, `crowd.showOtherLayers`) is served at `send.farHz` through the relay tree, with
  positions only. It has no radius limit.

### 10.3 Prediction

- The client steps its own body once per tick with `move`, stamps each input entry with
  its tick, and replays the steps after a snapshot's tick on the server's state when the
  snapshot arrives. A small error is blended. A large one, such as a knock, is shown from
  its start and caught up. After a `world.place` the view jumps (milestone 1 design,
  sections 4.4 and 6).
- A driver predicts the vehicle they control. Passengers are drawn on it.
- Collisions between entities are resolved on the server only (section 7.4, solid bodies).
- `body: { move: 'owner' }` stays as a per-kind choice for casual games. The server bounds
  the claim, as `capMove` does today.
- Determinism is required for prediction, the build check and replays. Recovery after a
  restart does not depend on it (section 12).

### 10.4 Crowds

- Hundreds in one view is a fan-out problem. Gates carry it: 300 players are 12 Gates, each
  filtering and encoding for 25.
- The simulation of one crowded cell is one thread on an isolate. Spike S6 measures how many
  bodies with rules running fit a tick. That number is `crowd.cap`'s default.
- Past it: `sim.host: container` gives the cell up to 4 vCPU. Past that, `crowd.whenFull`
  applies: `layer` (section 9.6), `queue` (arrivals wait at the Door with their place shown)
  or `hold` (arrivals stop at the cell's border).
- In the view: instancing, level of detail and animation culling for hundreds of characters.

## 11. Updates, versions and installed apps

### 11.1 Four kinds of change

| What changed | How it ships | What players notice |
|---|---|---|
| The studio's site: pages, posts, theme, catalogue | A deploy of the site Worker | Nothing. No object belongs to it |
| A game's rules, view, map or assets | `homie-studio deploy` uploads hashed bundles to R2 and publishes the build (section 11.5). **No Worker deploy.** No object restarts | A pause of a fraction of a second per area, or about 2 s for a state change in a lasting world |
| Homie's runtime | A new version of the rooms Worker, rolled out by percentage (`rollout.steps`), with a health check between steps | A pause of 1 to 3 s, once, for the objects in that step. Nothing of value lost |
| A new Durable Object class in a Homie release | A direct deploy. Cloudflare does not allow a lifecycle change in a gradual rollout | The same pause, for everyone at once. Rare: once for each milestone that adds classes (section 5) |

- Rules bundles live in the private R2 bucket. They are never served. Only `move`, public
  tunables, the view and the map are public.
- Every build's bundles are kept. There is no count to configure.

### 11.2 Rules changes in a live room, and the way back

The build stamps each game with a **state hash** (declared fields), a **shapes hash**
(events, commands, effects and tells) and a **rules hash** (the whole bundle).

| Changed | Match room | Persistent room |
|---|---|---|
| Rules only | Finishes on its build. New rooms use the new one | Each cell swaps its Sim at a tick boundary, one after another. Each pauses for the reload time of section 8.1 (target 250 ms) |
| State or shapes hash | Same | **Pause, switch, resume.** The Table orders every cell to stop. Each acknowledges with its tick. A restore point is taken (below). Each cell runs `migrate.up`, loads the new Sim and acknowledges. The Table resumes the clock. About 2 s. Sockets stay open |

- The orders are reliable messages and are journalled, so a cell that restarts during the
  switch finishes it on waking.
- A staged rollout can send a build to a share of rooms or world copies first (section
  16.2).
- **Migration chains.** Each build records its parent's state hash. A world, a sleeping
  cell, a stored character or an archive that is several builds behind is brought forward
  one `migrate.up` at a time, each run in the Sim of the build that defines it. Because
  every bundle is kept, no state is ever stranded.
- **Missing migration.** The build compares the state hash with the build list. If it
  differs for a persistent game and no `migrate.up` covers the step, the build fails. The
  check then runs the previous bundle for 600 ticks, migrates, loads the result and runs the
  invariants. A Preview compares with its own previous build.

**Going back.**

| The build that is being undone | How | What is lost |
|---|---|---|
| Changed rules only | Publish the previous build again. Cells swap back | Nothing |
| Changed state, and declares `migrate.down` | Pause, run `down` in every cell, load the previous Sim, resume. Characters saved under the newer build are stepped down when they next join | Nothing. Fields the old build does not have are dropped |
| Changed state, with no `migrate.down` | Restore the scope to the **switch point**: the restore point taken while everything was stopped, just before `migrate.up` ran (section 12.4) | Play since the switch. The tool states how many minutes and how many players, and the operator confirms |

- The check runs `up` then `down` on the previous build's state and requires the result to
  equal the original in every field both builds have. A `down` that fails the check is not
  accepted as a way back.
- A staged rollout that stops on an alert rolls back the rooms already switched by itself
  when `rollout.autoRollback` is on and the build has a `down`. Otherwise it stops, alerts,
  and waits for a person.
- The skill tells the AI to write `down` whenever it writes `up`, and says in the chat when
  a change has no way back.

### 11.3 Clients and installed apps

- **The wire carries its own schema.** At connect the server sends the table of kinds,
  fields, events, effects and tells with their types and ids. The client decodes by that
  table. A new field, kind, event or effect therefore breaks no client: an old view ignores
  what it does not know.
- **`move` changed.** A client whose `move` hash differs from the server's stops predicting
  and shows its own body from server state, like any other entity. It plays, a little less
  crisply, until it has the new view.
- **Web clients** load the view of the build their room runs, by hash, when they enter it.
  In a lasting world they load a new view at the next natural break, or at once if the
  studio marks the build `required`.
- **Installed apps** load the view bundle the same way at start, check its signature, and
  cache it for offline play. A wire or `move` change reaches them without a store update.
  The store build is only the shell.
- A match room and its players always share a build, as today.

**The signing key for installed apps.**

| Question | Answer |
|---|---|
| What is signed | Each build's view manifest: the list of files and their hashes |
| Where the key lives | An Ed25519 private key in the rooms Worker's secrets, created the first time the studio makes an app. It is written straight into Cloudflare, as the shop's keys are today, and never appears in a chat, a file or a log |
| Who signs | The Builds object, when a build is published |
| What the shell holds | The public key, and the public half of one spare key made at the same time. The spare's private half is shown to the owner once as a recovery code to keep offline |
| Rotation | A manifest may carry a statement, signed by a key the shell already trusts, that names a new key. The shell stores the chain. A studio rotates whenever it wants |
| A lost or leaked key | The owner uses the recovery code to sign the statement that names a new key. With no recovery code, shells keep running their cached view and say that an update is in the store; the studio ships a store build with the new key |
| A signature that does not verify | The shell does not run the new bundle. It runs its cached one and reports the failure |

### 11.4 Versions of the rooms Worker

- `homie-studio deploy` detects which Worker changed. Most deploys touch only the site
  Worker or only R2.
- For the rooms Worker it uploads a version and steps through `rollout.steps`. Between steps
  it reads error and reconnect rates from the metrics and stops on a regression. Cloudflare
  rolls out by percentage of objects; there is no region selector.
- Objects of different versions talk to each other during a rollout. The link protocol
  between objects carries a version and each release accepts the previous one. A test in CI
  runs every link between the release and its predecessor.
- **Reconnect storms.** Clients reconnect with a random delay of up to 2 s and resume with
  the token their Gate gave them. A resume touches a Gate and nothing else: no database, no
  Player object. A million sockets reconnecting are a million Worker requests spread over
  the rollout steps.
- A restart for any reason, including Cloudflare's own updates, loses nothing of value
  (section 12).

### 11.5 The build list, and how bundles are served

- **The store.** One **Builds** object per game holds the build list as rows: each build's
  hashes, its parent, its state and shapes hashes, whether it has a `down`, when it was
  published, and which build is current. It is the only truth about builds.
- **Publishing is two steps.** The tool uploads every content-hashed file to R2 and reads
  each back by hash. Then it makes one call to Builds, which records the build and moves
  the current pointer in one transaction. A half-finished upload is therefore invisible.
- **Reading.** A room is told its build by the object that creates it (a Lobby shard, the
  Worlds object, or the Table on a swap), in the same message. Cells load bundles from R2
  by hash; R2 reads are consistent. Nothing on a correctness path reads the build from KV.
  The site Worker reads the current build from KV only to choose which view to preload.
- **Public files** (views, `move`, public tunables, map chunks, large assets) are in the
  public bucket under hashed names, with `cache-control: immutable`.

| The studio has | How public files are served | Cost per first load |
|---|---|---|
| A custom domain | An R2 custom domain. Cloudflare's cache sits in front | Close to nothing after the first reader in each data centre |
| A `workers.dev` address only | Through a route on the site Worker that streams from R2. The browser caches the file for good; there is no shared cache, because the Cache API works on custom domains | One Worker request and one R2 read per file per browser |

R2's public development address (`r2.dev`) is not used.

## 12. Durable state

Milestone 1 saves a one-object room's whole state once a second
([rooms-milestone-1-design.md](rooms-milestone-1-design.md), section 5). The journal below
replaces that save in milestone 3, part B, when rooms first hold things of value.

A cell keeps a write-ahead journal of results. No two cells ever have to agree on a moment,
and no cell rolls back because another one failed. The design uses only documented storage
behaviour: synchronous SQL writes in one transaction, and Cloudflare's output gate, which
holds every outgoing message until the writes before it are confirmed (section 4).

### 12.1 What a cell writes, and when

**The rule.** Nothing that another object or a player may rely on leaves a cell before the
row that records it is durable.

**A journal row** holds everything that changed since the previous row: fields, entities
added and removed, messages added to the outbox, the highest sequence applied from each
sender, the commands applied per player, account effects queued, timers, the dice state and
the tick's calendar time. It records results, not inputs. So the state a row leaves behind
is always the state at the end of a real tick, and recovery runs no game code.

**When a row is written.** At the end of a tick, if either holds:

| Reason | Examples |
|---|---|
| The tick made a **commitment** | A conserved item or field changed (a pickup, a trade, a purchase consumed). A message was added to the outbox (an event to another cell, a handoff, a settlement, an effect on a Player object). A player's body was created or removed |
| `durability.movementSeconds` has passed since the last row and anything changed | Movement, health, cooldowns |

- With `durability.movementSeconds: 0` every tick writes a row.
- A row that would pass 2 MB is written as several rows in the same transaction.
- **Why movement is not written every tick by default.** A restart pauses a cell for one to
  three seconds whatever is written. Putting bodies back by up to one more second inside
  that pause is not something a player can tell apart from putting them back by a twentieth
  of a second. Writing every tick would buy only that difference. Value is different, so it
  is written at once. A game where the second matters sets 0.

**What waits for a row.**

- On a tick that writes a row, every outgoing message of that tick waits for Cloudflare's
  confirmation: the output gate does this, with no code of Homie's. Spike S2 measures the
  wait; the target is 10 ms or less.
- Outbox messages are only ever sent on such a tick, because adding one is a commitment.
- Acknowledgements wait too. A cell acknowledges a neighbour's message, or a player's
  command, only on a tick whose row records having applied it. So an acknowledgement may be
  up to `movementSeconds` late. Nothing is lost by that: the sender keeps the message until
  then.
- On a tick with no row, state packets to players go out at once. They carry movement that
  a restart may replay.
- There is one mode. No `allowUnconfirmed`, and no setting that releases packets early.

**The journal is a ring.** Rows live in a fixed set of slots that are updated in place, so
a row costs one row written and nothing is deleted. Every `checkpointSeconds` the Cell
folds the ring into the **pages** that hold entity state and records how far it has folded,
in one transaction. Storage does not grow.

**Recovery.** Load the pages. Apply the rows after the fold mark, in order. The cell is
where its last row left it. It resumes at the present tick: it does not re-run the ticks in
between, whose inputs are gone. Unacknowledged outbox messages are sent again. This takes
well under a second and involves no other cell.

**What a restart can and cannot undo.**

| | After a restart |
|---|---|
| Items, currency, trades, purchases, anything sent to another cell or to an account | Exactly as before. Never lost, never duplicated |
| A command a player sent | Applied once. If it was not yet acknowledged, the client's Gate sends it again and the cell recognises it |
| Movement, health and other plain fields | As of the last row: at most `movementSeconds` old. Players see a correction |
| Dice rolled since the last row | Rolled again. A roll that produced something of value forced a row, so it stands |
| What players in other cells see | The restarted cell's entities are corrected by the same amount. No entity owned by another cell changes |

**Why this and not the alternatives.**

| Design | Loss on restart | Needs | Verdict |
|---|---|---|---|
| Checkpoint on a beat, whole room rolled back together | Up to a beat, for everyone | Agreement between all cells | Rejected: loses play and couples every cell |
| Journal of inputs, replayed on restart | None | The same engine build to produce the same result twice. Restarts happen exactly when Cloudflare updates the engine | Rejected |
| **Journal of results** | Value: none. Movement: up to `movementSeconds` | One row per commitment | **Chosen** |

Cloudflare's guidance is the same: there is no shutdown hook, "write state incrementally"
(rules of Durable Objects).

### 12.2 Between cells

- Each directed link has a sequence. A message stays in the sender's outbox until the
  receiver reports it applied. The receiver journals the highest sequence it has applied in
  the same row as the effects of applying it.
- So a message is applied exactly once, whichever side restarts, whenever it restarts:

| Failure | What closes it |
|---|---|
| Crash after computing a tick, before its row | The tick did not happen. Nothing left the cell |
| Crash after the row, before the outbox is sent | The outbox is in the row. It is sent on recovery |
| Receiver crashes after receiving, before its row | Not acknowledged, so the sender sends again |
| Receiver's row is durable, acknowledgement lost | Sender sends again. Receiver sees the sequence and drops it |
| Entity in flight between cells when either crashes | It is in the sender's outbox or the receiver's state. The two rows above |
| The receiver was split or merged meanwhile | Its forwarder still holds the applied table (section 9.4) |
| A rollout restarts cells one by one | Each recovers alone to its own last row |
| A handler throws; a tick is killed | Section 8.3. Neither touches the journal |

- A cell that stops ticking keeps its storage. A message wakes it. Sleep changes nothing
  about correctness.

### 12.3 Outside the room

- **Effects on a Player object** (a character returned, an item to the bank, a purchase
  consumed, goods to a mailbox) are outbox messages like any other, on a link between the
  cell and the Player with its own sequence. Each carries the character's lease number. The
  Player applies each once and refuses a lease that is not the current one (section 13.2).
- **Purchases** are owned by the Player object. It offers a grant to the room until the
  room reports it consumed. Consuming is a commitment, so the report follows a durable row.
  A purchase that arrives while the room restarts is simply offered again.
- **Writes to D1, Queues, the audit stream and metrics** are derived data. They are sent
  after the row is durable, with an id, and applied idempotently.

### 12.4 Restore points and restore

**Scope.** Things that can exchange characters or items must be restored together, or a
restore puts an item in two places. A **scope** is that set:

| `economy.scope` | The scope is | Moving a character between world copies |
|---|---|---|
| `game` (default) | Every room of the game that holds characters, every Vault and Market shard, and the game's part of every Player object | Free: a logout and a join |
| `world` | One world copy, its Vaults and Market shards, and that world's part of every Player object. Each copy has its own characters and bank | An explicit transfer (section 15.3) |

- Purchases and entitlements are in no scope. A restore never undoes what a player paid
  for.
- A game with no saved characters (plain matches) has no scope, takes no restore points and
  keeps nothing.

**Epochs.** A restore point is an **epoch**: a number that rises every
`backup.everyMinutes`.

- Every object derives the current epoch from Cloudflare's clock. Every message between
  objects of a scope carries the sender's epoch.
- An object that reaches a new epoch, by its own clock or by seeing a higher number on a
  message, records its storage bookmark **before** it applies anything else. This is the
  standard marker method for a consistent snapshot. It needs no coordinator and no pause.
- Outbox entries are kept until the epoch after their acknowledgement, so messages in
  flight at an epoch are inside it.
- Each room object keeps its own small table of epoch and bookmark, for 30 days.
- A match room that held leased characters keeps its storage for 30 days after it ends, so
  that it can take part in a restore. Then it is deleted.

**Player objects take part without being walked.** A million accounts are mostly asleep.

- The first time a Player object is touched in a new epoch, it keeps the previous value of
  whatever then changes in its scoped state: character saves, lease records, bank, mailbox,
  and the marks that say a purchase was consumed. These "as of epoch" records are kept for
  30 days.
- So a Player object can put its own scoped state back to any epoch by itself, at the
  moment it is next touched.

**Restoring a scope to epoch E.**

1. An operator chooses E. The tool shows what will be undone and asks for confirmation.
2. The scope's **incarnation** number is raised, and the restore epoch recorded with it, in
   the game's Builds object, which belongs to no scope and is never restored. Every message
   in a scope carries the incarnation.
3. A Workflow tells every room object of the scope. Each sets
   `onNextSessionRestoreBookmark` to its bookmark for E and restarts. An object created
   after E deletes itself.
4. **Anything missed is caught lazily.** An object that receives a message with a higher
   incarnation restores itself to E before doing anything else. A message from an older
   incarnation is refused by every receiver, which tells the sender; the sender then
   restores itself. So an object that woke by itself and ran on the old timeline for a
   moment cannot leak anything into the new one.
5. Player objects do the same from their "as of" records the next time they are touched: a
   join, a mail, a purchase. Purchases consumed after E are marked unconsumed and are
   offered again.
6. Restored cells find player bodies with nobody connected. They log them out, which
   returns each character to its account in the new incarnation.

There is no manual repair list. Every object and every account of the scope is at E, and
everything outside the scope was never able to hold the scope's items.

**The recovery window.**

- Cloudflare's point-in-time recovery reaches back **30 days** (section 4). A restore from
  bookmarks cannot go further.
- `backup.archive` covers the rest. At an archive epoch each room object writes its pages
  to R2 as it records the bookmark, and each Player object marks its "as of" record for that
  epoch to be kept as long as the archive. Restoring from an archive loads those pages
  instead of a bookmark; the rest of the procedure is the same.
- A scope with `economy.scope: world` cannot be restored to a moment before its last
  outbound character transfer, because that character now belongs to another scope. The
  tool offers only later epochs and says why.

**One player.** A single player's state can be put right without touching the scope
(section 16.3).

### 12.5 The proof

- All object code is written against a small platform interface: storage, sockets, timers,
  calls. There are two implementations: Cloudflare, and a **simulator** that runs every
  object of a scope in one Node process under a seeded scheduler.
- The simulator can stop any object at any storage or network boundary, drop unconfirmed
  writes, delay and repeat messages, restart an object on another code version, discard a
  Sim, split or merge a cell at any moment, recall a lease at any moment, and restore a
  scope at any moment. A failing seed replays exactly.
- Checked after every step of every run:
  - every id exists once across cell states, outboxes, forwarders and Player objects;
  - every conserved item sums to its ledger of mint and burn, across cells, bags, escrows,
    messages in flight, banks, mailboxes, vaults, market escrows **and a character's copy at
    rest in its Player object**;
  - every effect id is applied at most once, and by the end exactly once;
  - every character has exactly one holder: its Player object, or one room;
  - no object acts on a message from an older incarnation;
  - with scripted inputs and `durability.movementSeconds: 0`, the final state hash equals
    that of an unbroken run.
- Exit tests state the number of seeds. A smaller version runs in every game's build check.
- The simulator proves the protocol. It cannot prove Cloudflare behaves as its documents
  say. Spike S2 and the real-Cloudflare restart tests in milestones 1, 3 and 4 cover that.

## 13. Accounts, characters and data

### 13.1 Where each kind of data lives

| Data | Home | Why |
|---|---|---|
| Live entities, bags, shared state | The Cell's and Table's own storage | Owned by one thread, written transactionally with the tick |
| Account: sign-in methods, purchases, bank, mailbox, character list, characters at rest, friends, bans, saves, lease records | One **Player** object per account | Strong consistency per player with no shared bottleneck. 10 GB each. A million players are a million small objects that sleep when unused |
| Sign-in lookups (credential or email to account id) | D1 `IDENTITY_<n>`, read replicas on. A list of databases from the start, chosen by a hash of the credential | Read-mostly. About 1 KB a player. One D1 database has one writer, good for some hundreds of sign-ups a second; more databases raise that |
| Sessions | A signed token valid for 15 minutes, checked by key with no database read, renewed by the Player object | Today every request reads D1 (`players.mjs:216`). A sign-out or ban takes effect at the next renewal, and at once in rooms (section 7.6) |
| Catalogue, servers, site content | D1 `DB`, as today | Small and relational |
| Search and rankings: player search, guild rosters, leaderboards, market listings, order history for the office | D1, one database per game (`GAME_<id>`), fed by Queues. Or Postgres through Hyperdrive | Derived data. Rebuildable from the objects of record |
| Chat history | The Channel's or room's own storage for recent lines; R2 for the archive | Keeps chat off the shared database |
| Metrics and counters | Analytics Engine | Written from anywhere at no request cost |
| Audit trail of value | Pipelines to R2 as Iceberg tables, queried with R2 SQL | Append-only, large, rarely read |
| Bundles, maps, assets, recordings, archives | R2 | Large files, no 25 MiB limit |
| Flags, the world list, shard counts | KV, written by Ops and Worlds | Read often, changed rarely |

- D1 is never in a tick, a join's hot path, or a purchase's correctness.
- **Order of arrival.** Milestone 3 creates the Player object, holding characters, bank and
  mailbox, keyed by today's account id. Sign-in, sessions, saves and the shop stay in D1 as
  they are today until milestone 6 moves them.
- Index tables are filled by Queue consumers in batches, each write keyed by an id so a
  repeat is harmless. The source object marks a change indexed only when the consumer
  acknowledges.

### 13.2 Characters: one holder at a time

**The rule.** A character is held either by its Player object or by exactly one room. The
holder is the only truth. Nobody else's copy is ever handed out.

- **Grant.** To play, a room asks the Player for the character. The Player records a
  **lease** (the room, and a number that only rises), marks the character as out, and hands
  it over, in one transaction. The room spawns it.
- **While it is out.** The room's journal is the truth. Every `characters.shadowSeconds`
  the cell sends the Player a **shadow**: a copy for game-master tools and nothing else. A
  shadow is never used to start a session.
- **Return.** At logout the cell removes the body and puts a `return` message with the
  final state in its outbox, in one row. The Player applies it once, marks the character at
  rest, and ends the lease.
- **Joining somewhere else.** If the account joins a second room while the character is
  out, the Player sends the first room a **recall**. It is a reliable message with no
  timer. The cell that holds the character handles it in its next tick: it cancels the
  character's open offers through the normal trade path, removes the body and sends the
  `return`. Only when the Player has applied that return does it grant the lease to the
  second room.
- **What the player sees.** "Finishing your last session", usually for well under a second.
  If the first room is behind, the wait is longer and the join says so. There is no timeout
  that hands out an older copy.
- **Why this cannot duplicate.** A room is made of durable objects that always recover
  (section 12). So a recall is always answered, and it is answered with the character as it
  really is, including every trade it made.
- **A character and its items are therefore in exactly one place.** Moving between world
  copies or regions is a logout and a join.

**If a room truly cannot answer.** That is a room that is down, and it is handled as one:
the rooms Worker is rolled back, or the scope is restored (section 12.4). Both return every
character correctly. For a studio that will not wait, there is one operator action:

- `homie-studio character recover` **condemns** the lease. The Player refuses anything that
  later arrives under it. The old cell, whenever it next runs, must apply the condemnation
  before anything else: it removes the character and burns what it held, through the ledger.
- The tool rebuilds the character from the shadow and the audit trail, shows the operator
  every difference it can see ("gave away a sword, received 40 gold since the shadow"), and
  says from which moment the trail is incomplete.
- What the operator then restores is granted as ledger entries in the operator's name. So
  the books still balance, and any risk taken is visible and is the studio's own decision.
- A player cannot trigger this. Only an operator can.

**Things that arrive for a character.**

- If the character is out, the Player forwards a purchase grant, a mail or a trade
  settlement to the room that holds it.
- If the character is at rest, goods go to its **mailbox**: a bag in the Player object. The
  character collects from it at the next join. The character's own saved state is not
  touched while at rest.
- The **bank** and account-wide items live in the Player. Moving an item between a
  character's bag and the bank is an exchange between the cell and the Player with the same
  protocol as a trade.

**Saves** (the saves helper used by games without characters) are rows in the Player
object. Section 6.2 gives their sizes.

### 13.3 When a studio needs Postgres

`data.backend: postgres` points the index tables at a Postgres database through Hyperdrive.
It is the right choice when any of these holds:

- An index would pass 10 GB, or needs more than about 1,000 queries a second.
- The game needs joins and searches across all players: an auction house with rich filters,
  rankings by many keys, "who owns this item".
- The studio wants its own analytics on live data.

How it works:

- Only derived tables move. Accounts, items and money stay in Player objects, so the switch
  is a re-index from the objects of record, with no cutover of truth.
- Hyperdrive is used as Cloudflare intends: pooled connections from Workers, cached reads.
  Its limit of about 100 origin connections per configuration is why writes go through Queue
  consumers in batches.
- The Postgres database itself is the studio's, with whichever provider it chooses, and is
  billed by that provider.
- A studio staying on D1 grows by more databases: one per game, then one per region, then by
  hashing the player id across several. The store layer takes a list of databases from the
  start.

## 14. Economy and purchases

### 14.1 Trades

`world.trade` is one protocol for hero to hero, bag to bank, bag to vault, and player to
market.

1. **Offer.** In A's cell, in one tick, the offered goods leave A's bag into an escrow
   record in the cell, and an offer goes to B, wherever B is.
2. **Decide.** B's cell is the only place the trade can commit. On `accept`, in one tick and
   one journal row, B's goods leave B's bag, A's goods enter it, and a settlement carrying
   B's goods is put in the outbox. On `refuse`, expiry, or B not existing, a refusal is put
   in the outbox.
3. **Settle.** A's cell receives the settlement or refusal exactly once. It puts B's goods,
   or A's own back, in A's bag and deletes the escrow. If A has moved, the message follows.
   If A has logged out, it goes to A's Player object, which puts the goods in the
   character's mailbox, or forwards them if the character is out in another room.

- A may `cancel` only by asking B's cell, which honours it if it has not committed.
- Offers waiting for B are rows in B's cell, not fields of B. They travel with B on a
  handoff. `trade.maxPending` (default 16, any value) bounds them; a further offer is
  refused to its sender, so an offer flood cannot bloat a character.
- At every moment each item is in exactly one of: a bag, an escrow, an outbox message, a
  mailbox. That is what the conservation check counts.
- In one cell all three steps happen inside a tick.

### 14.2 Purchases

- **The catalogue** is the studio's, under the policy it chose (section 6.2). Kinds:
  cosmetic, supporter, pass, unlock, tip, consumable, currency, bundle, subscription,
  service, and any the studio adds.
- **What a purchase grants.** An entitlement key the game reads (as today), or items placed
  in the game: a consumable or a pack of the game's own conserved currency. Items enter the
  game through the ledger as a mint with the order's id, in the buyer's room, or in the
  mailbox if the buyer is not in one.
- The provider's signed notification stays the only writer of paid, refunded and disputed:
  Stripe's webhook on the web, and from milestone 9 Steam's, Apple's and Google's.
- The site Worker checks the signature, puts the event on a Queue, and answers. Nothing else
  is done in the request, so a sale spike cannot time out a webhook.
- A consumer applies the event to the buyer's Player object, keyed by the provider's event
  id. The Player records the entitlement. That is the source of truth for what a player
  owns, across every till.
- If the player is in a room, the Player offers the grant to the room until the room reports
  it consumed (section 12.3). An item bought mid-match appears in the next tick or two.
- **The studio's spend cap, if it set one,** is counted on the Player object, so it holds
  across tills.
- **Refunds and chargebacks** run as a Workflow: refund at the provider, revoke on the
  Player, tell the room, record it. Each step is retried until done. An entitlement is
  revoked. Goods that were placed in the game and have since been spent or traded are
  followed through the audit trail; what the studio does about them (claw back, a negative
  balance, nothing) is `policy.refundOfSpentGoods`, with `nothing` as the default and the
  usual practice explained beside it.
- **Subscriptions** are Stripe Billing subscriptions, or the stores' own. The Player holds
  the entitlement with its renewal date; the provider's notifications extend or end it.
- The office's order list is an index fed by the same Queue.
- Checkout creation is a stateless Worker call with an idempotency key, as today.

### 14.3 The audit trail

- Every mint, burn, grant, move and trade is in a journal row. After it is durable, the cell
  publishes it to the audit stream: one Pipelines stream per studio, with the game as a
  column, so the 20-stream account limit is never in reach.
- Game-master tools query it with R2 SQL: where an item came from, every hand it passed
  through, what a player gained and lost in a period.
- A studio sees a running total of every conserved item in existence, per scope. A jump
  that the ledger does not explain raises an alert.

### 14.4 The market

- **Shape.** A Market shard holds listings for one scope and one category. Listed items sit
  in its escrow, placed there by a trade. Buying is a trade with the Market as the other
  side.
- **The studio's rules.** The `market` block of the rules is data: the currency, fixed
  price or auction, the fee and tax as percentages or flat amounts, the smallest and largest
  price, how many listings a player may hold, how long a listing lasts. For anything data
  cannot say, it may add two pure functions, `fee(listing, tune)` and `mayList(seller,
  item)`. The Market shard runs them in a Sim of the game's rules, under the same sandbox
  and checks as any rule.
- **Calls from rules.** `world.market.list`, `buy`, `bid` and `cancel` (section 7.4).
  Results come back as tells.
- **Auctions** end at a calendar time, on the Market shard's own alarm. The winner's goods
  and the seller's payment go to their rooms, or to their mailboxes if they are offline.
- **Fees** are burned or paid to an account the studio names, through the ledger.
- **Search** runs on the index (D1 or Postgres). The Market object is asked only to list,
  buy, bid and cancel.
- **Scale.** A shard takes about 200 operations a second. Categories and a hash of the item
  kind spread a busy market over more shards.

### 14.5 Vaults

- A **Vault** is storage that several players share: a guild bank, a party stash, a chest
  in a house. One object per owner (a guild, a party, a placed entity).
- The rules' `vaults` block declares each kind of vault: its size, what owns it, and who may
  deposit, withdraw and look, by guild rank or by a list the owner keeps. Daily withdrawal
  limits per member are data in the same block.
- Deposits and withdrawals are trades with the Vault as the other side, so they are
  conserved and audited like any other. The Vault checks the caller's rank with the Guild
  object, not with what the caller's cell believes.
- A Vault belongs to its game's scope and is restored with it.

## 15. A million players

### 15.1 Finding a match

- **Lobby shards.** A Lobby object serves one game, one region and one mode, and there are
  K of them. The site Worker picks one at random from 0 to K-1. K is read from KV.
- **A pool is not split by build.** A waiting player is matched first and told the room's
  build second; the client then loads that build's view by hash (section 11.3). A new room
  is created on the current build. An older room is backfilled with any waiting player, who
  loads its build's view. So deploying rules many times a day never splits a queue. The only
  split is by wire version, which changes with Homie releases, and old shells are told to
  update.
- Each shard aims at 100 joins a second, well inside the 200 to 500 a second guidance for
  an object doing real work. The Ops object watches each shard's rate and raises or lowers
  K. When K falls, the highest shards stop taking arrivals and pass their waiting players
  down.
- A shard keeps its rooms as rows. There is no cap on rooms.
- A waiting player holds a hibernating socket to the shard. There is no polling.
- The shard creates rooms by signing a room id. The rooms Worker refuses a room name that
  does not carry a valid signature, so a visitor cannot create objects by inventing names.
- A room tells its shard only when its open seats change. It sends no heartbeat.
- Sizing: a million players in 8-seat matches of 10 minutes is about 1,700 joins a second,
  so about 20 shards with headroom, spread over regions.
- Skill and rules for forming a match are a small declared policy in `game.json`
  (`match.modes`), run inside the shard.
- A Server (the community layer) has its own pool: a Lobby shard keyed by the server. There
  is no cap on servers or on a server's rooms.

### 15.2 Parties and guilds

- A **Party** object holds a group's sockets, invitations and ready state. A party queues as
  one entry in a Lobby shard, joins a world together (and the same layer where there is
  room), and can share chat and voice.
- Friends, invitations and whispers go from Player object to Player object. If the friend is
  in a room, their Player forwards to their Gate.
- A **Guild** object holds the roster, ranks and the guild's settings. A member's rank is
  copied onto their body as the read-only fields `guild` and `guildRank` at join, and
  updated by a message when it changes. Guild chat is a Channel. Guild storage is a Vault
  (section 14.5). The roster is also indexed for search.

### 15.3 Many worlds

- A persistent game has **world copies**. Each is a room. The **Worlds** object for a game
  and region is their registry: name, population, capacity, status, build.
- Each world reports every 10 s. A thousand worlds are 100 reports a second across the
  regional Worlds objects.
- **Worlds is not on the join path.** It publishes its list to KV every 5 s. The site
  Worker reads the list (cached in its isolate for 5 s), picks a world, and sends the
  player to one of that world's **Doors**.
- **Picking.** The fuller of two worlds drawn from those with room, so copies fill before
  new ones open and no single world takes a whole wave. A player who chooses a world or
  follows a friend goes there.
- **Doors.** A world has one Door shard per 2,000 seats of capacity, chosen by a hash of the
  account. A Door holds a block of seats that the Table refills 64 at a time. It checks the
  pass, asks the Player object for the character's lease, runs the pure `room.join` in a Sim
  of the rules, and sends the spawn to the owning cell. A Door admits up to 100 players a
  second. More arrivals than that, or than there are seats, wait on a hibernating socket and
  are told their place.
- So a launch of 2,000 joins a second lands on Lobby shards or on many Doors, and no object
  sees more than about 100 of them. The Table sees seat-block refills.
- `worlds.autoOpen` creates another copy from the game's template when the open ones pass
  `worlds.openAt`. There is no maximum.
- **Draining.** A studio can drain a world: no new arrivals, players are offered a move.
  With `economy.scope: game`, moving is a logout and a join.
- **`mergeWorld`.** World-bound state that belongs to a player (a house, placed objects) is
  carried by the optional rules handler `room.mergeWorld(world, incoming)`, which the target
  world runs for each batch the drained world sends. It runs as a Workflow, and each batch
  is a conserved transfer.
- **Transfers between scopes.** With `economy.scope: world`, moving a character to another
  copy is a transfer: the source world returns the character, the Player moves it and its
  bank share to the other scope, and the audit trail records it. It bounds how far back the
  source can be restored (section 12.4).
- Servers stay the community layer. A Server may be pinned to a world copy, a region or a
  private door, as today.

### 15.4 Regions

| Need | Mechanism |
|---|---|
| Players near the world | `region: auto` or a hint. Every object of a room, Gates included, is created under it |
| The same game in every region | A list of regions. Each has its own Lobby shards and world copies. Accounts are global |
| Data residency | A jurisdiction (`eu`, `us`) on every object of the room and on Player objects |
| One world spanning continents | A region hint on a map zone: the cells of that zone, and their Gates, are created there. Borders between such zones should be portals or seas, since mirrors across an ocean are 80 ms old |
| Moving a world | The move tool: drain, take a restore point, restore under a new hint, repoint the Worlds entry |

### 15.5 The size of one world

- Nothing caps a world's seats or cells.
- The Table handles the clock, the tree, shared state, room-scope rules and timers. Joins,
  the directory, chat, voice and stats are other objects from the start (section 5).
- At the milestone 4 test size (2,000 players, 32 or more cells) the busiest objects are:

| Object | Inbound at the test size | Design figure |
|---|---|---|
| A town cell holding 400 players | 16 Gates through 2 concentrators, 12 neighbours: 280 frames a second | 500 |
| The Table | 32 tally frames a second, seat refills, tree changes | 200 handler runs a second |
| A Door | Up to 100 joins a second | 100 |
| A Directory shard | About 35 handoff notes a second | 500 |

- Milestone 10 tests 10,000 players over at least 128 cells. The deploy plan prints the largest
  tested size for the installed Homie version.
- Past the tested size a game grows by world copies, layers and zones.

### 15.6 Load tests of the control plane

- `homie-studio swarm` runs bots in Containers, hundreds of sockets each, started in each
  region by a Workflow. Containers have no six-connection limit. For small runs it uses the
  local computer.
- Milestone 5 runs 100,000 rooms and 800,000 bot players through Lobby shards for 30
  minutes, and a rollout during it.

### 15.7 Game-wide events and schedules

- A **Bulletin** object per game holds an ordered log of game events. The studio's office,
  a schedule in the Ops object, or `world.publish` from a room's rules appends to it.
- **Awake rooms** hear at once. Each Lobby shard and each Worlds object subscribes to the
  Bulletin and passes a new entry to the Tables it knows, through a relay tree.
- **Sleeping rooms and rooms that missed it** keep a cursor. A Table reads the log from its
  cursor when it wakes and before it runs anything else.
- So nothing has to enumerate 100,000 rooms, and no room misses an event.
- **Schedules** are data in `game.json` or the office: a calendar time or a repeat, and the
  event to publish. The Ops object's alarms publish them.
- `world.ask` to a studio webhook goes out from the Table through a Queue, signed, and the
  answer returns as an event.

## 16. Running a live game

### 16.1 Seeing

- **Metrics.** Every Cell, Gate, Table, Door and Lobby writes to Analytics Engine every
  10 s: tick time and lateness, time per Sim call, players, entities, bytes out, journal
  rows and the wait for confirmation, backlog, handoffs, quarantines, joins, queue lengths,
  characters waiting on a recall, objects sharing an isolate.
- **Logs.** Homie's own structured events, with a session id, through Workers Logs, all of
  them. Cloudflare's automatic line per invocation is off by default (`logs.invocations`),
  because at 20 messages a second per player it would outweigh the game's whole bill and say
  nothing the events do not. Export by OpenTelemetry or Logpush for studios that keep more
  than 7 days.
- **Errors.** Rule errors are returned to the Cell in the tick's result and logged, grouped
  by game, build, kind and handler.
- **The office** gains a Live page: players by game, world and region; slowest cells; error
  groups; economy totals. It can open any room, cell or player.
- **Alerts.** The Ops object evaluates rules each minute against the metrics and posts to a
  webhook or email. Defaults ship: tick lateness, error rate after a deploy, reconnect rate,
  queue backlog, recalls waiting, an unexplained change in a conserved total.
- **Reading the metrics needs a key.** Analytics Engine and Cloudflare's usage figures are
  read over Cloudflare's HTTP interface, which needs an account token with read access to
  analytics. `homie-studio ops connect` opens a page on the owner's computer where they make
  that token in Cloudflare's dashboard and paste it; it goes straight into the Worker's
  secrets, as the shop's key does.
- **Costs.** The office shows usage by product, game and world from Cloudflare's analytics,
  with the estimate of section 21 beside it. By itself it triggers nothing.

### 16.2 Operating

- Maintenance mode, per game, world or region, with a message.
- Announcements to a room, a world, or every room of a game (section 15.7).
- Drain, restart, move, restore a world or a scope.
- **Staged rollout** of a build: a share of rooms or named worlds first, with automatic
  stop, and automatic rollback where the build allows it (section 11.2).
- **Flags**: `world.flags`, changed live, per game, world or percentage.
- **Marks** on one player (muted, frozen, or the studio's own), seen by rules as
  `self.marks`.
- Scheduled events (section 15.7).
- Every operator action is recorded with who did it.

### 16.3 Game-master tools

- Find a player. See their characters, items, purchases, sessions and reports.
- Trace an item or a sum through the audit trail.
- Grant, remove or restore an item. Each is a ledger entry with the operator's name.
- Restore one player to a moment: the tool shows the difference between then and now, from
  shadows and the audit trail, and applies the chosen parts as audited grants and removals.
  It does not rewind anyone else.
- Recover a character whose room cannot answer (section 13.2).
- Mute, kick, suspend, ban. Effective within a tick everywhere (section 7.6).
- Roles for studio staff, behind Cloudflare Access or the studio's own owner sign-in.

### 16.4 Abuse and cheating

- **Authority.** The server decides everything except what `move: 'owner'` kinds claim, and
  those are bounded.
- **Input.** Rate and range are checked at the Gate. A client cannot send faster than
  `inputHz`.
- **Bots at the door.** Turnstile on account creation and on guest joins. The rate limiting
  binding on join, create, chat and purchase routes, keyed by account or pass. WAF rate
  rules for studios on a custom domain. These arrive at the start of milestone 6, before the
  sign-up caps in today's code are removed.
- **In installed apps** the shell shows Turnstile in its web view. Where a store build
  cannot (checked in spike S12), a guest join is checked with the platform's own device
  attestation instead.
- **Room creation** only by signed ids (section 15.1).
- **Chat.** A token bucket per player at the Gate. Review through a Queue, so a flood cannot
  stall a room.
- **Signals.** Each Gate and Cell emits anomaly counts: corrections per player, impossible
  input patterns, value gained per hour against the game's own distribution. The office
  lists outliers. Homie does not ban automatically.
- **Replays.** With `record.inputs: on`, a room's inputs and each tick's state hash go to
  R2, and `homie-studio replay` reruns a session for review. A rerun whose hashes differ
  from the recording says so, since the engine may have changed in between.
- **Multiple accounts.** Signals only: shared payment fingerprints and devices are shown to
  the studio.

### 16.5 A studio's own cost controls

These are tools a studio may choose to use. No alert, limit or budget exists unless the
studio creates it, and Homie never decides for a studio.

- **Seeing.** The cost page of 16.1, with a forecast for the month from the trend.
- **Alerts.** `spend.alerts` is a list of monthly amounts the studio picks. Passing one
  sends a notice through the alert channels. Nothing else happens.
- **A limit.** `spend.limit` with `spend.atLimit`. Both must be set by the studio. The
  behaviours are `notify`, `queue`, `noNewRooms` and `pause`. Homie explains each in plain
  words when the studio asks for a limit, and applies exactly the one chosen.
- **An AI budget.** `ai.budget`, per day, for AI seats, guides, `world.ask` and chat review.
  When it is reached, AI seats fall back to the game's script and chat review follows
  `chat.whenUnreviewed`.
- **How it works.** The Ops object reads Cloudflare's usage analytics on a schedule and
  writes the current state to KV. Lobby shards, Doors and Tables read that flag when
  admitting. No room reports to a central meter, so the control adds no bottleneck.
- **What it cannot do.** Cloudflare's analytics lag by minutes, so a limit is approximate.
  The page says so. A limit never touches saved state: `pause` stops rooms only after their
  journal is durable.
- A studio can change or remove a control at any time, and the change applies within a
  minute.

## 17. Voice

- **Product.** Cloudflare Realtime SFU carries audio. Realtime TURN gets through strict
  networks. A Worker does not route media.
- **Shape.** Each player publishes one audio track. The room decides who hears whom and
  tells the SFU which tracks each player pulls. Clients never choose their own
  subscriptions, so muting, blocking and bans are enforced on the server.
- **Proximity.** A Gate already knows the positions its players can see. Twice a second it
  picks, for each of its players, the nearest `voice.maxHeard` speakers inside
  `voice.radiusM`, with hysteresis so the set does not churn. **The Gate calls the Realtime
  API itself** for its own players, at most 4 calls in flight. There is no central voice
  object: 25 players changing who they hear every few seconds are about ten calls a second
  per Gate.
- **Sound.** The client sets each voice's volume and direction from positions it already
  has, with Web Audio.
- **Party voice.** The same, with the party as the set.
- **Safety.** Mute and block per player. Reports carry the reporter's last 30 s only if
  the studio turns recording on. Voice is off in the `kids` policy preset.
- **Apps.** Electron and Capacitor web views support WebRTC. Microphone permission text is
  added to the shells.
- Spike S9 measures how fast subscriptions can change and how many voices a phone can mix.

## 18. Other ways a game runs

### 18.1 Standalone apps

- **Remote view.** The shell loads the game's view bundle, verifies its signature (section
  11.3), and caches it. Offline, it runs the cached view with the game's rules file and
  bots, as today. A game with `room.offline: false` keeps its rules on the server and says
  it needs a connection (milestone 1 design, section 7).
- **Accounts.** Sign in with a passkey through the system browser sheet, or by a link code
  typed on the site. The app receives a session token and keeps it in the platform's secure
  storage. Guests can upgrade without losing progress.
- **Cloud saves.** The saves helper writes to the Player object when signed in.
- **Purchases.** One entitlement record on the Player object, with several tills:
  - Web: Stripe, as today.
  - Steam: Steam's server-side purchase interface, confirmed by the Worker.
  - iOS and Android: the stores' in-app purchase systems, with their server notifications
    verified by the Worker and put on the same Queue as Stripe's.
- **One policy across tills.** The studio's shop policy (section 6.2) applies to every
  till. Where a store's own rules are stricter or different, the tool says so beside the
  setting, and the studio decides per till. A spend cap, if the studio set one, is counted
  once on the Player object.
- **Chat and voice** come to apps with the report and mute controls of section 16.
- **Servers and private doors** work once the app can sign in.
- **Store rules are the studio's obligation, and Homie states them.** Fees, review rules,
  what may be sold outside the store's own purchase system, and each store's position on
  apps that download code after review are listed for the studio at the point they matter.
  The store interfaces and rules have not been checked yet. Spike S12 checks them at
  the start of milestone 9, and the size of milestone 9 is restated then.

### 18.2 Browser-hosted mode

- The same rules bundle runs on the host's main thread with a fixed-step loop.
- Same wire, same helper. The host is the server for prediction. The relay, election and
  yield-when-hidden stay.
- For offline play, local development, private friends games, and any studio that chooses
  it.
- One cell, the relay's 32 seats, no hidden information, saves in the browser or the Player
  object.
- The build check runs once per mode.

### 18.3 Ports

- A ported game is someone else's browser code. It cannot run on a server.
- In milestone 1 a ported game keeps running through the port toolkit's `createRoom` on the
  helper's transport layer, in a player's browser, unchanged.
- Milestone 2 rebuilds `createRoom` on the host runtime. Homie supplies a generic rules
  module (bodies, seats, rounds, scores, an opaque state blob) marked `browserOnly`. The
  helper's old host calls are removed in the same release, and a game written before
  milestone 1 is rewritten as rules plus view from then (milestone 1 design, section 7).
- `browserOnly` rules are exempt from the purity and determinism checks, because their
  handlers call the ported game's own code. The build refuses `host: server` for them and
  says why.
- The `port` skill gains a second grade: moving a ported game's rules into a real rules
  module, which then runs on the server like any other.

### 18.4 Local development

- `homie-studio dev` watches each game's rules and rebuilds on save. It runs the site
  Worker and the rooms Worker together.
- Locally, rules load through the Worker Loader if local Wrangler supports it (spike S1),
  otherwise in the object's own isolate. The contract is identical.
- A save swaps the Sim in running local rooms. A save that changes the state hash resets
  local rooms and says so in one line, unless a `migrate.up` covers it.
- The Game Lab runs two variants side by side in browser-hosted mode on one seed.
- `homie-studio replay` reruns recorded inputs under workerd, the same engine as
  production.
- `homie-studio swarm` drives bots against the rules alone, local dev, a Preview or
  production, with added delay and loss.
- The simulator of section 12.5 is available to studios as `homie-studio chaos`.

## 19. Making AI-written rules safe

The author is an AI and the person asking is not a programmer. The checks must not depend on
tests the same AI wrote, and a failure must be explained in the game's own words.

Milestone 1 builds the parser pass, the allowlist, guarded computed access, the injected
step budget, type checking, the two-run and rebuilt-state comparisons, kill and restore, the
invariants and the messages
([rooms-milestone-1-design.md](rooms-milestone-1-design.md), section 10). Section 23 names
the milestone for each other part.

**A small surface.** Profiles and capabilities (section 7.1) keep what the AI can call to
what the game needs. A call outside the profile fails with the name of the profile or
capability that would allow it.

**In the build, with the line named.**

- A parser pass over the bundled output, with source maps, so a dependency or a part is
  named too. It is scope-aware: it tells a global from a field of the same name.
- **Globals are an allowlist of named functions**, with refused syntax, refused property
  names, guarded computed access and nothing of the game's run at module load. The lists are
  in milestone 1 design, section 10, and are not repeated here. Milestone 3, part A allows
  `try` in rules, once the sandbox can stop a handler from outside.
- Module-level constants are deep-frozen at load.
- **At load the Sim's own global scope is emptied to the same allowlist** before the rules
  run. A name the parser missed does not exist at run time.
- Type checking of rules is part of the build, always, with a compiler Homie ships. `self`
  is the only writable parameter type. `shapes` types every send.
- Query radii, `maxSpeed` against the margin and the cell size, declared sizes against
  `entity.maxBytes`.

**At run time, in the check and in development.**

- Query results, mirrors and event data are frozen objects. A write throws with a stack,
  whatever the types said.
- In production the same objects are read-only views, and the Sim has no bindings at all.

**Generated tests.** For every game the check runs seeded bots (wander, chase, mash, trade
with whoever is near, cross borders deliberately, ride and drive where the game has seats),
with:

- two runs compared tick by tick; a difference is reported as the first field that differs
  and the handler that wrote it;
- **two Sims side by side on every tick: one kept running, one rebuilt from stored state
  before each tick**, compared by state hash. Any state that is not in a declared field
  shows up on the first tick that uses it;
- a kill and restore at random ticks, compared with an unbroken run;
- **border fuzz**: the same run with the world cut into cells at random places, with splits
  and merges during it, so every interaction crosses a border in some run;
- the small simulator of section 12.5 with random stops;
- a run of `move` in the browser engines Homie supports, compared by hash. Only `move` runs
  on more than one engine: every other rule runs on the server, or on one host's browser
  that is then the only authority.

**Built-in invariants**, every tick of every run: the list in section 12.5, plus no NaN,
positions inside the world, declared sizes respected.

**Coverage.** The check reports handlers and branches that no run reached. It fails only
when a whole handler was never reached, and then it says which situation would reach it and
adds a bot behaviour for it where it can. It does not ask the AI to write the test.

**Cost.** Tick time at the declared size, measured locally and scaled by the calibration
from Cloudflare's own CPU figures (section 8.3). The result is reported, and chooses
`sim.host: auto`. It never fails a build.

**A library of rules.** `@homie-rocks/studio/rules/kit` ships tested pieces written on the
contract: health and damage, pickups, projectiles, area attacks, cooldowns, trading with a
confirmation step, loot tables, quests, rounds and scores, zones, vehicles, crops and other
things that grow in real time. An AI composing these has less to get wrong.

**Messages** are written for the chat: what broke, in the game's words, the line, and the
usual fix.

**Measuring it** is spike S10.

## 20. Targets (to validate)

Every row is a target until the spike or exit test in its last column has run.

| Target | Value | Basis | Checked by |
|---|---|---|---|
| Entity update on the wire | 10 bytes on average | 2 B short id + 1 B field mask + 6 B position delta at 1 cm in 3D + 1 B heading. 2 B more when a state field changes | Milestone 2 exit |
| Downlink, ordinary play | 8 KB/s or less | 32 entities × 10 B × 20 Hz = 6.4, + headers and events 0.7 | Milestone 2 exit |
| Downlink, crowd | 16 KB/s or less | 24 near × 12 B × 20 Hz = 5.8. 275 far × 8 B × 5 Hz = 11.0 before priority; the budget trims the far tier to fit | Milestone 2 exit |
| Another player's action seen, one-object room | About 240 ms at the least, at a 90 ms round trip, 20 Hz. Median under 280 ms | 45 up + lead + 45 down + about 100 interpolation, plus the wait for the next step and a drawn frame (milestone 1 design, section 6.5) | Milestone 1 exit |
| Same, through a Gate | About 265 ms | Two short hops and a mean half-tick batch wait | S4, milestone 2 exit |
| Same, for an entity seen through a neighbour's band | About 285 ms | One more hop under the same hint | S4, milestone 4 exit |
| Same, at 60 Hz | About 145 ms | 45 + 17 + 45 + 33, + Gate | Milestone 2 exit |
| Server answer to own action | About 140 ms at the least. Median under 170 ms | Round trip 90 + lead, plus the wait for the next step and a drawn frame. Own movement is predicted | Milestone 1 exit |
| Messages into one object | 500 a second by design | Cloudflare guidance 500 to 1,000 for light work | S6 |
| Tick punctuality | 99% of ticks start within 5 ms of due | Timers and staggering | S3 at scale. T1 in milestone 1 measures one room from outside: 99.5% of due ticks run, 99% of snapshot gaps under 1.5 periods |
| Wait for a row to be confirmed | 10 ms or less for 99% of rows of 64 KB | Section 12.1 | S2 |
| Movement replayed by a restart | At most `durability.movementSeconds` (1 s by default) | Section 12.1 | Milestone 1 exit |
| Value undone or duplicated by any failure | None | Section 12, proved by 12.5 | Simulator seeds in milestones 3 and 4 |
| Back in play after a restart | 3 s for 95% of players | Local recovery plus reconnect with jitter | Milestone 1 exit; S7 for gradual rollouts |
| Site deploy | No object restarted, no socket closed | Two Workers (section 5) | S7, milestone 3 exit |
| Rules update | No socket closed. A pause of 250 ms per cell, or about 2 s for a state change | Sections 8.1 and 11.2 | S1, milestone 3 exit |
| Recall of a character | Under 1 s for 99% of joins from a second place | Section 13.2 | Milestone 3 exit |
| Handoff | No input gap over 100 ms. A swept body never skips more than one tick of its path | 9.3 | Milestone 4 exit |
| A socket moving to the next cell's Gate | No input lost, no gap in state | 10.1 | Milestone 4 exit |
| Split or merge | Under 1 s pause for players in that cell | 9.4 | Milestone 4 exit |
| Join, at 100,000 rooms | 99% matched and connected within 2 s | 15.1 | Milestone 5 exit |
| World, milestone 4 | 2,000 players over 32 or more cells | 15.5 | Milestone 4 exit |
| World, milestone 10 | 10,000 players over 128 or more cells | 15.5 | Milestone 10 exit |
| One crowd in mutual view | The S6 figure on an isolate; 1,000 on a 4 vCPU Container | 10.4 | S6, milestone 10 exit |
| Voice | A change of who is heard within 500 ms | Section 17 | S9 |

## 21. Cost model

This section informs. Homie limits nothing because of these numbers. Only a control a studio
has set for itself (section 16.5) acts on spending.

All figures are estimates from the list prices in section 4, read 2026-10-07, at default
settings (20 Hz, `durability.movementSeconds: 1`). They are given to two figures; the inputs
are not better than that. Cloudflare's included monthly usage is ignored; it is small at
these sizes. Each assumption is named and has a check.

**Assumptions.**

| | Assumption | Checked by |
|---|---|---|
| A1 | A busy cell writes a journal row on a quarter of its ticks: 18,000 rows an hour. The floor is 3,600 (one a second). The ceiling is 72,000 (every tick) | Milestone 3 and 4 exit tests report the real share |
| A2 | A call into a facet bills as a Workers request ($0.30 per million) plus CPU time. If it bills as a Durable Object call it is half that | S1 reads the bill |
| A3 | A player types 6 chat lines an hour and a review reads 200 tokens on the default model (8,182 neurons per million tokens, `worker/chat.mjs:374`): 1.6 neurons, $0.000018 a line | The office's own counts |
| A4 | A Player object stays billable for 10 s after each touch, then hibernates (section 4) | S8 |
| A5 | Links between objects are sockets, billed at 20 messages to a request | S4 |

**Unit costs.**

| Unit | Arithmetic | Cost |
|---|---|---|
| One object awake for an hour | 0.128 GB × 3,600 s = 460.8 GB-s × $12.50 per million | $0.0058 |
| One player's input for an hour at 20 Hz | 72,000 messages ÷ 20 = 3,600 requests × $0.15 per million | $0.00054 |
| One cell's journal for an hour (A1) | 18,000 rows × $1.00 per million | $0.018 (from $0.0036 to $0.072) |
| One cell's checkpoints for an hour | 360 × about 5 rows = 1,800 rows | $0.0018 |
| One cell's Sim calls for an hour (A2) | 72,000 calls × $0.30 per million | $0.022 |
| Sim CPU | per millisecond of tick: 72,000 ms an hour × $0.02 per million | $0.0014 per ms of tick |
| One Sim isolate id for a day | Per id and code | $0.002 |
| One live character for an hour (A4) | 12 shadows × (1 request + 3 rows) = $0.00004. Player object awake 12 × 10 s = 15.4 GB-s = $0.00019 | $0.00023 |
| One reviewed chat line (A3) | 1.6 neurons × $0.011 per 1,000 | $0.000018 |
| One AI seat thinking every 12 s for an hour | 300 calls × about 600 tokens = 1,500 neurons | $0.016 |
| Ticking by alarm, which the design does not do | 72,000 alarms = 72,000 requests + 72,000 rows | $0.083 an hour, avoided (section 8.4) |
| Cloudflare's automatic log line per message, off by default | One 8-player match: about 650,000 events an hour × $0.60 per million | $0.39 an hour, seven times the match itself (section 16.1) |

**One 8-player match, for an hour.** One object. The table is the design from milestone 3
on. As milestone 1 builds it there are no Sim calls and no checkpoints, and one save a
second: $0.0058 + $0.0043 + $0.0036 = $0.014, or $0.0017 per player-hour.

| Part | Arithmetic | Cost |
|---|---|---|
| One object | | $0.0058 |
| Input | 8 × 3,600 = 28,800 requests | $0.0043 |
| Journal (A1) | 18,000 rows | $0.0180 |
| Checkpoints | 1,800 rows | $0.0018 |
| Sim calls (A2) | 72,000 | $0.0216 |
| Sim CPU at 2 ms a tick | 144,000 ms | $0.0029 |
| Homie's log events | About 200 | Under $0.0002 |
| **Total** | | **$0.054**, or $0.0068 per player-hour |
| Range from A1 | Journal $0.0036 to $0.072 | $0.040 to $0.108 |
| With `sim.isolation: cell` | 6 matches an hour × $0.002 | + $0.012 |
| With chat at A3 | 48 lines | + $0.0009 |

**A 1,000-player world, for an hour.** 16 cells in a 4 by 4 grid, 40 Gates of 25 players,
one Table, one Door, one Directory shard, one Channel: 60 objects.

| Part | Arithmetic | Cost |
|---|---|---|
| Objects awake | 60 × $0.00576 | $0.346 |
| Player input | 1,000 × 3,600 = 3.6 million requests | $0.540 |
| Gate links (A5) | 40 Gates × 1 cell × 20 Hz × 2 directions = 1,600 messages a second = 288,000 requests | $0.043 |
| Border links (A5) | 42 touching pairs × 2 × 20 Hz = 1,680 messages a second = 302,400 requests | $0.045 |
| Journal (A1) | 16 × 18,000 = 288,000 rows; the Table 3,600 | $0.292 |
| Checkpoints | 17 × 1,800 rows | $0.031 |
| Sim calls (A2) | 16 × 72,000 = 1.152 million; the Table about 3,600 | $0.347 |
| Sim CPU at 10 ms a tick | 16 × 72,000 × 10 = 11.5 million ms | $0.230 |
| Sim isolate ids | 17 × $0.002 a day | $0.001 |
| Characters (A4) | 1,000 × $0.00023 | $0.230 |
| Chat review (A3) | 6,000 lines | $0.108 |
| Homie's log events | 20 per player-hour = 20,000 | $0.012 |
| Index and audit Queues | 10 messages per player-hour × 3 operations = 30,000 | $0.012 |
| Audit stream | About 4 MB at $0.06 per GB | Under $0.001 |
| Metrics, when Analytics Engine bills | 60 objects × 360 points | $0.005 |
| **Total** | | **about $2.24**, or $0.0022 per player-hour |
| Range from A1 | Journal $0.058 to $1.152 | $2.01 to $3.10 |
| If links must be calls (A5 fails) | 5.76 million + 6.05 million requests in place of 590,400 | + $1.68 |

- Full around the clock for a month: $2.24 × 730 = about $1,600.
- A world that averages a third of its peak costs roughly a third: idle cells and unneeded
  Gates hibernate and bill nothing.
- An empty world with `whenEmpty: run` and `cell.whenIdle: sleep` has no object awake. Its
  clock needs no ticking and its timers are alarms. It costs its storage (16 cells × 16 MB
  × $0.20 per GB-month = $0.05 a month) and a request and a row per timer.
- With `cell.whenIdle: run`, every cell bills its object, Sim calls and a row a second
  around the clock: about $0.034 an hour, $25 a month, per cell.

**Large games.**

| Size | Worlds of 1,000 | Matches of 8 |
|---|---|---|
| 100,000 players online | 100 × $2.24 = about $220 an hour | 12,500 rooms × $0.054 = about $680 an hour |
| 1,000,000 players online | about $2,200 an hour | about $6,800 an hour |
| A million players a month at 20 hours each (20 million player-hours) | × $0.0022 = about $45,000 a month | × $0.0068 = about $140,000 a month |
| The same, range from A1 | $40,000 to $62,000 | $100,000 to $270,000 |
| The same with `sim.isolation: cell` | No change | 15 million matches × $0.002 = + $30,000 |

What sits around the rooms at a million players a month, per month:

| Part | Arithmetic | Cost |
|---|---|---|
| Player object storage | 1,000,000 × about 50 KB = 50 GB × $0.20 | $10 |
| Lobby shards | 20 awake × $4.20 | $84 |
| Worlds, Ops, Party, Guild, Vault, Market, Bulletin objects | Mostly hibernating | Under $100 |
| Joins and site requests | 200 million Worker requests × $0.30 per million, and 400 million CPU-ms | $68 |
| Identity lookups in D1 | 100 million rows read | Under $1 |
| KV reads | Cached per isolate for 30 s: a few million | Under $5 |
| Purchase and index Queues | 10 million messages × 3 operations × $0.40 per million | $12 |
| Assets in R2 | 100 GB × $0.015; no egress charge | $1.50 |
| Public files served through the Worker (no custom domain) | 50 files per player on first load = 50 million reads and requests | $33. Close to nothing with a custom domain |
| Homie's log events | 400 million × $0.60 per million | $230 |
| Chat review for matches (worlds already include it) | 120 million lines | $2,200 |
| Audit stream | 80 GB × $0.06 | $5 |
| Input recordings, only with `record.inputs: on` | About 430 KB per player-hour: 8.6 TB a month | $130 per month kept, plus writes |
| Postgres through Hyperdrive, if chosen | Hyperdrive has no per-query charge | The database is billed by its own provider |
| Turnstile and the rate limiting binding | No usage price was found on the pages read | Not verified |

The rooms are the bill. Three lines dominate it: player input, Sim calls and the journal.
The first follows from `inputHz`, the second is measured by S1, and the third follows from
the game and `durability.movementSeconds`.

**Heavy cells.** A Container at full use for an hour: `standard-2` (1 vCPU, 6 GiB) is
3,600 × $0.000020 + 6 × 3,600 × $0.0000025 + disk = about $0.13. `standard-4` (4 vCPU,
12 GiB) is about $0.40.

**Voice.** Opus at 32 kbit/s is 14.4 MB an hour per voice heard. A player who hears four
others speaking 30% of the time receives about 17 MB an hour: $0.0009 at $0.05 per GB, after
the first 1,000 GB a month.

## 22. Spikes

Local numbers do not transfer: local objects share one process and local clocks behave
differently. Each spike runs on real Cloudflare, has a pass line that can be decided, and
has a fallback that is already designed. Each runs in the milestone that first needs it.
`homie-studio measure` reruns S1 to S7 on any studio's account. Milestone 1 has two tests of
its own, T1 and T2, in section 12 of its design document.

| | Runs in | Question | Pass | If it fails |
|---|---|---|---|---|
| S1 | Milestone 3, part A | **Sim as a facet.** (a) Time added by one call carrying 64 KB each way at 20 and 60 Hz. (b) Does a busy Sim delay its Cell's timer? (c) Do two objects that load one id share an isolate? (d) The memory at which a Sim fails. (e) Does `cpuMs` stop a loop wrapped in `try/catch` in a facet call, and can the Cell abort and reload afterwards? (f) Is an out-of-memory Sim confined? (g) Evictions of an idle-free facet over 24 hours. (h) Reload time with 4, 16 and 48 MB of state. (i) Cold start for a `tickHz: 0` wake. (j) Does it run under local Wrangler? (k) What 24 hours bill | (a) 1 ms or less at the 99th percentile. (b) Timer lateness 2 ms or less. (d) 96 MB or more. (e) Stopped within twice the limit; reload works 100 times of 100. (f) Cell and other Sims survive. (g) At most one a day. (h) 250 ms at 16 MB, 1 s at 48 MB. (i) 50 ms. (c), (j) and (k) are findings, not passes | (c) decides `sim.isolation` (section 8.1). (d) or (h): `cell.stateMB` is lowered until the reload target holds, and cells split on state size. (e): the probe bundle's counters are always on and are the guard. (i): a `tickHz: 0` room keeps its Sim for a short linger time. (j): local dev runs the Sim in the object's isolate. (a), (b), (f), (g), in order: a plain Dynamic Worker instead of a facet, re-seeded when evicted; then the Sim in the Cell's own isolate on the probe bundle, with Containers for worlds of many cells. Under that last fallback a rules change is a rollout of the rooms Worker and pauses rooms for 1 to 3 s |
| S2 | Milestone 3, part B | **Journal.** One ring-slot update of 4 KB, 64 KB and 1 MB per tick at 20 and 60 Hz, with sends to 25 sockets, for 24 hours in 3 regions. How long the output gate holds a send. How a slot update bills. 1,000 forced restarts: what is lost | Hold of 10 ms or less at the 99th percentile for 64 KB. One row billed per update. No confirmed row lost | A longer hold: an `early` release is built for state packets only. The journal is written through the key-value `put()` with `allowUnconfirmed`, every reliable send and acknowledgement waits in Homie's code for `storage.sync()`, and no SQL write is made on the tick path. A confirmed row lost would contradict Cloudflare's documentation; there is no fallback for that inside Homie, server hosting does not ship until Cloudflare resolves it, and the plan says so here |
| S3 | Milestone 5 | **Threads, timers and density.** 1 to 256 busy cells. Then 2,000, 5,000 and 12,500 match rooms ticking at 20 Hz with 2 ms ticks, over 32 class copies. Which share an isolate (the registry). Tick lateness with staggered phases. Do two class copies ever share an isolate? 20 runs over 5 days in 3 regions | 99% of ticks within 5 ms of due at 12,500 rooms. Class copies never share | Copies share: copies become separate Workers (section 8.4). Still too dense: more copies, then more Workers. Two busy cells collide: the busier moves its Sim to a Container |
| S4 | Milestone 4 | **Links.** Latency and billing between two objects by socket and by call, under one hint and across hints, at 20 and 60 frames a second. One object holding 6, 12 and 64 dialled sockets to other objects for an hour, with 4 calls in flight | Same hint: 20 ms or less at the 99th percentile. All sockets stay open | Sockets count toward six: the Table assigns dialling sides so that no cell dials more than 4, and a link that cannot be assigned runs as calls. Sockets fail altogether: every link is one call per frame (section 21 has the cost). Slow links: the `shared` age, the handoff catch-up bound and the `maxSpeed` check take the measured value |
| S5 | Milestone 10 | **Container host.** Cold start. Distance from its object. Round trip over the socket. Tick jitter at 20 and 60 Hz on 1 and 4 vCPU. Behaviour during a rollout. Deploy from a computer with no Docker, from the public image. A 24-hour bill | Round trip 5 ms or less at the 99th percentile. Cold start 5 s or less. Same metro as the object in 95% of starts. Deploy succeeds with no Docker | No public image: the tool pushes the image to the studio's registry itself. Slow or distant: the Container host is offered where its measured latency suits the game, and stated. Heavy areas otherwise rely on finer splitting and layers |
| S6 | Milestone 2 | **Capacity.** Pickup, damage and projectile rules: 100 to 2,000 bodies in one cell. A Gate: messages a second taken before lateness, and encoding time for 25, 50 and 100 players. A cell: time to send one frame to 13 Gates | Numbers, not a pass. They become `crowd.cap`, the Gate size and the one-object room size | Sending to Gates over a tenth of a tick: Gates are filled by position (section 10.1) |
| S7 | Milestone 3, part A, for the site-deploy question; milestone 7 for gradual rollouts | **Rollouts.** 1,000 objects holding sockets through a gradual deployment of the rooms Worker. Is each reset once? How long is each away? A deploy of the site Worker during it. Is `invocation_logs = false` honoured for object events? | Each object reset once. 95% of sockets back within 3 s. The site deploy resets no object and closes no socket | Slow return: smaller rollout steps (1, 5, 25, 100 percent). A site deploy that disturbs sockets is not expected, since sockets do not pass through the site Worker |
| S8 | Milestone 6 | **Accounts at scale.** A million Player objects. 5,000 lease grants a second. 300 identity lookups a second through read replicas. 1,000 purchases a second through the Queue with failing consumers. Billable seconds per touch | Join 300 ms or less at the 99th percentile. Every purchase granted once | Identity lookups move to KV for reads with D1 as the writer. More Queues by hash of player id |
| S9 | Milestone 8 | **Voice.** How many subscription changes a second a session accepts. Time from change to sound. Voices a Pixel 6a and an iPhone SE (3rd generation) can mix | Change within 500 ms. 8 voices on both phones | Area channels: one shared mix per small area, with fewer individual changes |
| S10 | End of milestone 3 (`match` and `world`), and of whichever of milestones 4 and 6 finishes last (`mmo`) | **Authoring.** 20 one-sentence requests × 5 unattended runs, fixed in advance, for the profile under test. Each has an acceptance scenario written by Homie's engineers, hidden from the AI, and run on what exists at that milestone. Three named raters (two engineers and one studio owner who does not program) score "is this the game that was asked for" from 1 to 5 against a written rubric, without knowing which toolkit made it. The same requests on today's toolkit are the baseline | 85 of 100 pass the build check and their acceptance scenario (the uncertainty at that size is about 7 points). Median rating 4 or more, and not below the baseline. Median repair rounds 2 or fewer | Two improvement rounds of one week each (kit pieces, messages, profile pages). If it still fails, the failing categories become kit configuration, so the AI writes data and not handlers, and the spike is rerun. The contract is not frozen until the `mmo` run passes |
| S11 | Milestone 2 | **Faster transport.** Whether any unreliable path into a Durable Object exists. If one does: state packets over it against WebSocket, on a phone network with 2% loss | A path exists and gives a 30% lower 99th-percentile action-seen delay | WebSocket stays. It is the baseline everywhere else in this plan. If a path exists, it is built in milestone 10 |
| S12 | Start of milestone 9 | **Stores.** The current purchase interfaces and review rules of Steam, Apple and Google: what may be sold, server notifications, rules on code fetched after review, whether Turnstile runs in each shell | A written finding per store | Where a store forbids fetching the view, that store's app updates through the store. Where Turnstile cannot run, device attestation is used |

## 23. Milestones

**How to read the sizes.** The headline is a relative size. The scale is defined by what
changes in today's code.

| Size | What it means in this codebase |
|---|---|
| XS | A change inside one existing module, or one new module under about 300 lines. No change to the wire or to stored data |
| S | One new module of 300 to 1,000 lines, or a change to about a tenth of `netplay.ts` or `room.mjs` |
| M | Two to four new modules, or about a quarter of `netplay.ts` or `room.mjs` reworked, or one starter converted |
| L | Five to ten new modules, or a wire revision, or a new kind of server object, with changes across the helper, the relay, the build and a skill. Tested on real Cloudflare |
| XL | More than ten new modules and several new kinds of server object that talk to each other, proved in a simulator, with load tests on real Cloudflare |

Each milestone also carries an engineer-effort figure in person-weeks for experienced
engineers, as secondary information. This project is built largely with AI coding agents
working in parallel, so calendar time cannot be derived from it. No figure includes a
reserve; where a spike fails, its fallback adds work. A studio adopts a milestone only when
it needs what the milestone unlocks.

| | Milestone | Unlocks | Size | Effort, secondary | Depends on | Can run beside |
|---|---|---|---|---|---|---|
| 1 | **Rules on the server** | A normal room whose rules run on the studio's Cloudflare | Eight slices: L, M, M, M, M, L, L, M | 55 to 66 | Nothing | |
| 2 | Bigger rooms | Hundreds in one room, each sent only what is near; hidden information; vehicles; large game files | L | 31 to 37 | 1 | 3, 5, 6, 7 |
| 3 | Lasting worlds and characters | Part A: rule changes with no restart, and the sandbox. Part B: a lasting one-area world; characters and inventories; restore points | XL (part A is L, part B is L) | 57 to 70 | 1 | 2, 5, 7 |
| 4 | Worlds of many areas | One seamless world of thousands | XL | 52 to 64 | 2, 3 | 5, 6, 7 |
| 5 | Many rooms, worlds and regions | Any number of rooms and world copies; regions; game-wide events | L | 28 to 35 | 1 (world copies and staged rollouts of builds also need 3) | 2, 3, 4, 6, 7 |
| 6 | Accounts, economy and markets | The shop on the studio's own rules; accounts at a million; guilds, vaults, a market | XL | 44 to 54 | 3 (the shop and flood-control parts need only 1) | 2, 4, 5, 7 |
| 7 | Running a live game | Dashboards, alerts, game-master tools, the studio's own cost controls, gradual rollouts | L | 28 to 35 | 1 | Everything |
| 8 | Voice chat | Proximity and party voice | M | 10 to 13 | 2 | Everything after 2 |
| 9 | Apps that earn | Accounts, saves and selling in Steam, iPhone and Android apps | L | 25 to 32 | 6 | 4, 5, 7, 8, 10 |
| 10 | Heavy worlds | Crowds of a thousand in one view; worlds of ten thousand | L | 16 to 22 | 4 | 5 to 9 |

All ten milestones sum to about 345 to 430 person-weeks. That is the size of everything in
the three documents. It is not the size of getting rules onto the server. Milestone 1 is.

### Milestone 1. Rules on the server (eight slices: L, M, M, M, M, L, L, M)

- Its slices and exit tests are in [rooms-plan.md](rooms-plan.md).
- Its design, its file changes, its two tests on real Cloudflare (T1 and T2) and the
  derivation of its effort figure (55 to 66) are in
  [rooms-milestone-1-design.md](rooms-milestone-1-design.md).
- **Stays as it is today:** one Worker; the relay's seats, chat, votes, watchers and owner
  controls; accounts, saves and the shop in D1; one Lobby object per game.
- What it fixes now so that no later milestone rewrites a game, and what it leaves to each
  later milestone, are in section 13 of its design document. Each item left appears below
  under the milestone that builds it.

### Milestone 2. Bigger rooms (L)

- **Delivers.**
  - Gates as their own objects, one cell. The Table's socket and encoding jobs become roles
    that a Gate can carry (section 5). Concentrators.
  - Interest sets, deltas, tiers, priority, the overview feed. Watchers' feeds.
  - Field visibility (`see`) and `tell`, on the per-player encoding.
  - Room passes and resume tokens (section 7.6).
  - No seat cap for server-hosted rooms. `guests.perAddress`. `crowd.cap` with `queue` and
    `hold`. The soft tick budget (section 8.3).
  - Crowd rendering in the view.
  - The `uses` mechanism, with the `attach` and `solid` capabilities in one cell.
  - Game files in a public R2 bucket, served as in section 11.5, with files over 25 MiB and
    multipart upload. Map chunks streamed to the client, map zones, triangle-mesh colliders,
    the navigation mesh.
  - `move` run in the browser engines Homie supports and compared by hash, in the build
    check.
  - S6, including 60 Hz and regions other than the one T1 used. S11.
  - Needing only milestone 1, and buildable at any time after it: the kit's pieces for
    matches (section 19); `homie-studio swarm` on one computer; the port toolkit's
    `createRoom` on the host runtime, the `port` skill's second grade, and the removal of
    the helper's old host calls (section 18.3).
- **A studio can use.** Rooms of hundreds in one area; hidden information and messages for
  one player; vehicles and mounts.
- **Exit test.** 300 bots in one cell on real Cloudflare for 30 minutes:
  - 16 KB/s or less each; the nearest 24 at `send.nearHz`; action-seen about 240 ms;
  - 99% of cell ticks within 5 ms of due at the S6 `crowd.cap`, and a stated clock rate
    above it;
  - a Gate killed mid-run: its players back within 3 s, no input or command lost;
  - 20 Gates on one cell through concentrators, with light rules: the cell's inbound stays
    under 500 frames a second;
  - arrivals past the cap queued and held in two runs;
  - a vehicle with a driver and three passengers: the driver's prediction error stays under
    `predict.snapM`;
  - a modified client cannot read a `server` field or another player's `owner` field, and a
    `tell` reaches its one player only;
  - a Pixel 6a and an iPhone SE (3rd generation) draw 300 characters at 30 frames a second.
- **Risks.** Simulation, not fan-out, is the limit for one crowd. Milestone 10 raises it.
- **Engineer effort, secondary** (mid-point 34; stated as 31 to 37). Gates and input
  batching 2.5; interest, deltas and tiers 4; concentrators 1; resume after a Gate restart 1;
  watchers and overview 1; crowd cap 1.5; crowd rendering 4; attach and solid 1.5; map
  chunks, meshes and navigation 4; S6 and S11 1.5; field visibility and tells 1.25; room
  passes and resume tokens 1; roles split from the Table 1; public files in R2 1; zones,
  soft budget and `move` across engines 1; kit 2; swarm on one computer 1.5; ports on the
  host runtime 2; exit tests 1.5.

### Milestone 3. Lasting worlds and characters (XL)

The milestone has two parts. Part A needs only milestone 1 and can be released by itself.
Part B needs part A.

**Part A. Rule changes with no restart, and the sandbox (L).**

- **Delivers.**
  - Spike S1. The Sim as a Durable Object Facet, loaded from R2 by hash (section 8.1).
  - The site Worker and the rooms Worker (section 5). The site-deploy question of S7.
  - The Builds object, the private bucket for rules bundles, publishing in two steps
    (section 11.5).
  - Rules deploys with no Worker deploy. A match finishes on its build. Rolling back a
    rules-only change (section 11.2).
  - The rest of the guard: hard stop, the probe rerun, quarantine, a thrown handler's fields
    restored, `try` allowed in rules, the Sim's global scope emptied to the allowlist
    (sections 8.3 and 19). The step counter itself is in milestone 1.
  - Every build's rules kept, so an installed app on an older build plays online.
  - The plan check and the wording of section 6.4 in the tools and skills.
  - The copy number in the id of every long-lived object (section 8.4).
- **A studio can use.** Rule changes that reach running rooms without a restart, and rules
  that cannot reach anything outside their own game.
- **Exit test**, on a Preview on real Cloudflare:
  - S1 has a pass, or its fallback chosen in writing with the number that decided it.
  - 20 rules deploys and 20 site deploys during a match: no socket closes.
  - A handler with an endless loop inside `try/catch` is stopped at `sim.hardMs`, its entity
    is quarantined, the other players keep playing, and the studio is told which handler.
  - On an account on the free plan, a game keeps running in the object's own isolate, and
    the deploy says in plain words what the paid plan would add (section 6.4).
- **Risks.** If S1's last fallback is chosen, rules deploys pause rooms for 1 to 3 s and the
  "no socket closes" line becomes "every bot playing within 3 s".

**Part B. A lasting world in one area, and characters (L).**

- **Delivers.**
  - The journal: a row per commitment, the ring, pages and recovery (section 12.1). Spike
    S2. `homie-studio measure`.
  - The platform interface and the simulator, for a one-object room and then with Player
    objects, leases and restores (section 12.5). `homie-studio chaos`.
  - `profile`, with the `world` profile: saved characters, items, bags, conserved value,
    trade inside a cell, mail.
  - Calendar time: `world.now`, `f.time` and saved moments, `world.at` as a durable alarm,
    and `tickHz: 0` rooms that sleep between events.
  - The wire carrying its own schema (section 11.3).
  - The Player object as the holder of characters, bank and mailbox, keyed by today's
    account. Leases, recall, shadows, the operator's recover action.
  - Persistent rooms of one cell: `whenEmpty`, `room.wake`.
  - `migrate.up` and `down`, chains, the switch point and rollback.
  - Epochs, "as of" records, scope restore, archives. Restore of one player.
  - Coverage reporting in the build check. The `world` example as a fixture. S10 for
    `match` and `world`.
- **A studio can use.** A lasting one-area world with characters, inventories and trading,
  that can be put back to an earlier moment. Turn-based rooms that cost nothing between
  moves.
- **Exit test.**
  - S2 has a pass, or its fallback chosen in writing.
  - 200 forced restarts during play: no conserved value changes; movement replayed by at
    most `durability.movementSeconds`. The share of ticks that wrote a row is reported.
  - An inventory survives logout, an empty world, 50 restarts, and three chained state
    changes, one applied while the world slept and one while the character was offline.
  - The same account joining from two places while its character is mid-trade and its cell
    is made to lag by 5 s: 10,000 seeds in the simulator and 100 times on Cloudflare. One
    holder every time, conservation holds, and the second join waits.
  - A state-changing build is rolled back twice: once by `down` with nothing lost, once to
    the switch point.
  - A scope of three rooms and 200 accounts is restored to an epoch taken while characters
    were moving between rooms and trading: every conserved total equals its value at that
    epoch, with no repair step. A purchase consumed after the epoch is offered again.
  - A restore from an archive.
  - One player restored to 10 minutes earlier with nobody else changed.
  - A turn timer in a `tickHz: 0` room fires with the room asleep.
  - The simulator passes 50,000 seeds.
  - S10 passes for `match` and for `world`.
- **Risks.** A bad migration corrupts a live world; the check runs it on the previous
  build's state first, and the switch point is always there.

- **Engineer effort, secondary** (mid-point 63; stated as 57 to 70).
  - Part A, 16.5: S1 3; two Workers and deploy tooling 2.5; Builds, the private bucket and
    the Sim loader 4.5; guard, probe and quarantine 4.5; plan check and wording 1.5; the
    site-deploy question of S7 0.5.
  - Part B, 46.75: journal and recovery 2.5; S2 1.5; the measure command 1; simulator 6; profiles 1; Player
    object 2; leases, recall, mailbox and bank 5; items, bags and trade 3; persistent rooms,
    wake, calendar time and `tickHz: 0` 3.5; the schema-carrying wire 1; migrations and
    rollback 3.5; epochs, restore and archive 6; mail 1; one-player restore and recover 1.5;
    kit pieces 1; S10 for two profiles and coverage 4; copy number in ids 0.25; exit tests 3.

### Milestone 4. Worlds of many areas (XL)

- **Delivers.** S4. The balanced partition tree. Links, mirrors, bands. Handoff with
  catch-up and groups. Sockets that follow players between cells. Doors. Directory shards
  and long-range events. The room clock and its slow-down. Shared state, tallies and
  announcements across cells through the relay tree. Room-scope entities. Trades and area
  events across cells. Split and merge with forwarders and their reclaiming. Pause, switch,
  resume across cells. Epochs and restore across cells. Channels, controls and stats across
  cells. Border fuzz in the build check. Layers. Idle cells and `cell.wake`. The full simulator and swarm patterns.
  `homie-studio partition`. Every row of section 7.3 marked 4 as an acceptance
  scenario.
- **A studio can use.** Seamless worlds of thousands.
- **Exit test.**
  - The simulator passes 100,000 seeds with restarts, splits, merges, recalls, restores and
    mixed versions.
  - Real Cloudflare: 2,000 bots over 32 or more cells for 2 hours, in three patterns (even;
    three towns holding 60%; a group of 400 crossing the map and forcing splits), with 40 to
    200 ms of added delay. The targets of section 20 hold, with delay rows adjusted by the
    added delay. No object's inbound rate passes its design figure in section 15.5.
  - No input gap over 100 ms across a border, and none when a socket moves to the next
    cell's Gate. A 60 m/s arrow fired across borders 10,000 times never skips more than one
    tick of its path.
  - 50 objects killed at random: no conserved total changes, no entity owned by another
    cell changes, and viewers see the killed cell's entities corrected by at most
    `durability.movementSeconds`.
  - A neighbour's handoff whose acknowledgement is dropped just before a split: the entity
    exists once.
  - A town that splits and merges 200 times: forwarders are reclaimed after their window in
    a run with the window set to an hour.
  - 2,000 bots in view of one boss across layers: one boss, damage summed correctly, rewards
    granted once each.
  - 10 rules changes, 5 of them with a state change: no socket closes.
  - A world restored to an epoch.
  - The `mmo` example passes the check with border fuzz.
- **Risks.** Split and merge under load is the hardest protocol in the plan. The simulator
  exists before it is written. If S4 found links slow, margins and speed checks are stricter
  than hoped.
- **Engineer effort, secondary** (mid-point 58; stated as 52 to 64). S4 1.5; tree 2.5; links, mirrors and bands 4; handoff and groups
  3.5; sockets following players 3.5; Doors 2; Directory and long-range events 2.5; clock,
  shared state, tallies, announcements 3.5; cross-cell trade and area events 2.5; split,
  merge, forwarders, reclaiming 7; switch across cells 2.5; epochs and restore across cells
  3.5; channels, controls, stats 3; layers 3.5; idle cells and wake 1.5; simulator and swarm
  patterns 5; partition tool 1; acceptance scenarios 2; exit tests 3.5.

### Milestone 5. Many rooms, worlds and regions (L)

- **Delivers.** S3, and class copies in the number it gives. Lobby shards with rooms
  as rows and K that sets itself; the caps of today's Lobby and of servers removed. Signed
  room ids. Parties. The Worlds registry, the KV list, auto-open, queues at Doors, drain,
  `mergeWorld`, transfers between scopes. Regions, jurisdictions, region hints on zones, the
  move tool. The Bulletin, game events, schedules, `world.ask` to a webhook. Staged rollout
  of builds. The swarm in Containers.
- **A studio can use.** A game that takes any number of players without a change.
- **Exit test.**
  - 100,000 rooms and 800,000 bots for 30 minutes: 99% of joins within 2 s; no Lobby shard
    over 150 joins a second; K rises and falls with load; 99% of ticks within 5 ms of due.
  - 30 rules deploys during that run: no waiting pool is split.
  - A rollout of the rooms Worker during that run: every object reset once, 95% of bots back
    within 5 s, no conserved total changes.
  - 200 world copies opened by `autoOpen`; a wave of 2,000 joins a second: no Door over 100
    a second and nothing through the Table but seat refills. Two worlds drained and their
    characters moved.
  - A game event reaches 100,000 rooms, 10,000 of them asleep; each handles it exactly once.
  - A region list creates independent stacks. A room name without a signature is refused.
- **Engineer effort, secondary** (mid-point 31.5; stated as 28 to 35). S3 and class copies
  4.5; Lobby shards and scaling 3; parties 2.5;
  Worlds, list, auto-open, queues 3.5; drain, `mergeWorld`, transfers 3; regions, zones,
  move tool 3.5; Bulletin, schedules, webhooks 3; staged rollout 2.5; swarm in Containers
  2.5; exit tests 3.5.

### Milestone 6. Accounts, economy and markets (XL)

- **Delivers.**
  - Turnstile and the rate limiting binding. Only then, the sign-up caps removed.
  - Accounts in Player objects in full: sign-in methods, signed sessions, friends, saves.
    `IDENTITY` databases with read replicas. Per-game index databases and the Postgres
    backend.
  - Purchases through the Queue; refunds as a Workflow; subscriptions.
  - The shop of section 6.2: every limit a setting, the policy presets, the new kinds, the
    information shown beside each choice.
  - The two AI budgets become studio settings with no default (section 6.2). This needs no
    other milestone.
  - The audit stream and its queries.
  - The `mmo` profile's economy: guilds, vaults, the market and its rules block.
  - S8. S10 for `mmo`, if milestone 4 is done; the contract is frozen when both are.
- **A studio can use.** Selling on its own terms; accounts for a million players; guild
  storage and a player market.
- **Exit test.**
  - S8 passes.
  - A scripted sign-up flood without Turnstile is refused, with the caps gone.
  - 1,000 purchases a second for 5 minutes with consumers failing at random: each granted
    exactly once. A refund removes an entitlement from a live room. A currency pack arrives
    as a ledger mint with its order id.
  - A fresh studio has no spend cap, no price ceiling and no item limit, and each preset
    applies exactly what its page says. A studio's cap set to an amount holds across two
    tills.
  - 500 members use one guild vault from 20 cells with restarts: conservation holds, and a
    member below the rank is refused.
  - An auction ends at its time with the winner offline: goods and payment arrive once, and
    the studio's fee is taken.
  - The index tests pass on D1 and on Postgres.
- **Engineer effort, secondary** (mid-point 49; stated as 44 to 54). Flood control and cap
  removal 2; AI settings 0.5; accounts and sessions 4;
  identity databases 2.5; index databases and Postgres 4.5; purchases and refunds 4; shop
  policies, kinds, currency and subscriptions 6; saves 1.5; audit stream 2.5; guilds 3;
  vaults 3; market 7; S8 2.5; S10 and the contract text 3; exit tests 3.

### Milestone 7. Running a live game (L)

- **Delivers.**
  - Sections 16.1 to 16.5.
  - Rollouts of the Worker by percentage (section 11.4), with the gradual-rollout part of
    S7.
  - Metrics from the one-object room, and `perf` calibrated against Cloudflare's own CPU
    figures (section 8.3).
  - `homie-studio replay` (section 18.4).
  - Chat history in the room's storage, and chat review through a Queue (section 5.1).
- **A studio can use.** Dashboards, alerts, operator and game-master tools, abuse signals,
  and optional cost alerts and limits of its own.
- **Exit test.**
  - An injected slow handler raises an alert within 2 minutes, naming game, build and
    handler.
  - A staged rollout of a build with an injected error stops by itself, and rolls back when
    the build has a `down`.
  - An item is traced from its mint through five trades. A removed item is restored with an
    audit entry.
  - A ban takes effect in every cell within 1 s.
  - 10,000 chat lines a second into one room do not move tick lateness.
  - 1,000 rooms holding sockets through a gradual rollout of the Worker: each object is
    reset once, and 95% of sockets are back within 3 s.
  - A fresh studio has no spending alert, limit or AI budget, and nothing is held at any
    usage. A studio that sets a limit with `queue` sees new arrivals wait within 5 minutes
    of passing it, players already in keep playing, and removing the limit lets arrivals in
    within a minute.
- **Engineer effort, secondary** (mid-point 31.5; stated as 28 to 35). Gradual rollouts and
  S7 2; one-object metrics and `perf` calibration 1.5; replay 1; chat storage and review
  Queue 2; metrics and the Live page 4; alerts and the analytics key 2.5;
  logs and error groups 1.5; operator actions 2.5; flags and marks 1; game-master tools and
  roles 5; abuse signals and replay review 3.5; cost page and controls 3; exit tests 2.

### Milestone 8. Voice chat (M)

- **Delivers.** Section 17. Spike S9.
- **Exit test.** 50 headless browsers with test audio and two phones in one cell: each hears
  the nearest 8 within 20 m; a change is heard within 500 ms; a blocked player's track is
  never subscribed; the measured cost per player-hour is written into section 21.
- **Engineer effort, secondary** (mid-point 11; stated as 10 to 13). S9 1.5; SFU sessions from Gates 3; proximity selection 1.5;
  spatial sound 1.5; party voice 1; safety controls 1.5; exit test 1.

### Milestone 9. Apps that earn (L)

- **Delivers.** Section 18.1. Spike S12.
- **A studio can use.** Accounts, saves and selling in Steam, iOS and Android apps.
- **Exit test.** On a test build for each of Steam, iOS and Android: sign in; a save made in
  the app appears on the web; a sandbox purchase grants its item exactly once and a sandbox
  refund removes it; a wire change reaches the installed app with no new store build where
  the store allows it; a rotated signing key is accepted through the chain; the app plays
  offline from its cache.
- **Risks.** Store rules. S12 checks them first, and the size is restated then.
- **Engineer effort, secondary** (mid-point 28; stated as 25 to 32). S12 1; remote view, signing and rotation 2.5; accounts in shells
  3.5; cloud saves 1; Steam purchases 3.5; Apple purchases 4; Google purchases 3.5; one
  entitlement and policy across tills 2.5; chat, voice and attestation in shells 2; servers
  and private doors 1; exit tests in three store sandboxes 3.5.

### Milestone 10. Heavy worlds (L)

- **Delivers.** S5. The Container host. The parallel core. A faster transport, if S11 found
  one.
- **A studio can use.** Crowds of a thousand in one view and worlds of ten thousand.
- **Exit test.**
  - 1,000 bots in mutual view in one Container-hosted cell at 20 Hz: 99% of ticks on time.
  - The parallel core gives the same state hash as one thread over 10,000 seeds.
  - 10,000 bots over 128 or more cells for an hour, with the milestone 4 checks.
- **Risks.** If S5 fails, this milestone delivers finer splitting and layers only, and the
  crowd ceiling is the S6 figure. If S3 fails in milestone 5, the Container host is built
  then.
- **Engineer effort, secondary** (19.5 with a transport, 15.5 without; stated as 16 to 22). S5 and the Container host 5;
  parallel core 6; host selection and mixed worlds 1.5; transport 4; exit tests 3.

## 24. Parked

- **Art and design tooling.** Nothing is planned here.
