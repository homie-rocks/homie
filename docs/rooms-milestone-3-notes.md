# Milestone 3: lasting worlds, slice 1 (0.46.0 provisional)

This PR is the first slice, not the whole milestone. It adds an opt-in lasting
single-area world and a character per game on an existing player account.
Gate, concentrator and transport implementations are unchanged.

## Studio contract

Set game.json `room: { host: "server", lifetime: "persistent", characters: true }`.
The world alone needs only `lifetime`; accounts are separately optional.
Lasting worlds default to `offline: false`. A studio can explicitly enable local
practice with `offline: true`; its progress is not authoritative or saved.
Keep inventory in the player kind's declared fields, and return
`player.character ?? { kind: "runner", at: spawn }` from `room.join`.
A character record contains kind, position, heading, fields and motion. Only rules
change it. `world.finish()` resets the world but carries the latest character
into the next join, including a crash or disconnect during the empty break; it
cannot replay the inventory that the account had before a spend. Use the existing account page/passkeys to sign in; character games
redirect a player without a signed-in account there. Browser-written saves remain
available with their existing contract, cost and behavior. They are not imported
into an authoritative inventory. Shop orders/grants and app records are unchanged.

The public world has the stable room name pub-1 (s-<server>-1 in a community).
Explicit room links choose other independent worlds. A full world waits for seats;
this slice does not silently create another copy of its contents. World lists and
capacity-driven copies are later work. Studio-chosen seats still apply.

Declare value with field options, for example
`coins: f.u32({ durable: true, visibility: 'owner' })` and
`collected: f.list(f.u8(), 64, { durable: true, visibility: 'owner' })`.
Mark every fact that prevents a repeated reward durable, including collectible
IDs, progress, currency and value-protecting cooldowns. Public world changes use
`durable: true` without private visibility. Undeclared fields and movement can
rewind. Durability does not grant visibility: main's recipient projection still
sends private inventory only to its owner, including reconnect/welcome/watch.

## Durable state: a journal and a checkpoint

The first cut of this slice saved the whole room, atomically, on every tick. That
was correct and unaffordable: 72,000 writes an hour per room whether or not anything
changed, each the size of the room. It is replaced here, not in a later slice.

A lasting world now keeps two things in its Table's SQLite:

- **The journal** (`world_journal`). The moment a tick changes anything the game
  declared `durable`, that tick writes one small record before any of its output is
  published: the changed cells as absolute assignments, with whatever must be atomic
  with them in the same transaction: entity creation and removal, queued events and
  commands, input acknowledgements and unspent pulses, seats, character leases and
  returns, and the logical clock, id counter and random state. Absolute assignments
  replay to the same result, so a record that committed just as the isolate died is
  neither lost nor counted twice. A record larger than one million bytes spans
  several rows of one transaction.
- **The checkpoint** (`save`). Everything else (positions, motion, pose history,
  undeclared fields, undeclared non-player entities) is written whole every
  `room.durability.movementSeconds` (1 to 60; a lasting world's default is 30, a match
  room's stays 1), and on pause, round end and an orderly stop. A checkpoint is taken
  only if the room differs from the last one.

Restore is the last checkpoint and then every journal record after it, in order.
Value is exactly what was committed; positions may be up to one interval old.

The journal is a ring, and that is a departure from the obvious design. Cloudflare
bills a delete as a row written, so a checkpoint that deleted the records it had
folded would pay for every record twice. Instead row 0 holds a floor (the last
sequence number the checkpoint contains), written in the checkpoint's own
transaction; a record's row id is its sequence less the floor, so the records after
a checkpoint overwrite the ones before it. A read takes only rows above the floor
and refuses a gap. A checkpoint costs its own pieces plus one row. There are no
secondary indexes.

An idle room writes nothing: no journal record, no checkpoint (it equals the last
one), no alarm to make one. Startup and account admission are one-off lifecycle
writes. The storage output gate holds a tick's frames until its record commits. A
failed write stops the host and nothing checkpoints that memory over the committed
world afterwards; an orderly `stop()` on a healthy world does checkpoint.

What decides a write is found by comparing the durable part of this tick's room with
the last one. That keeps the journal independent of the rules core (anything the
store is not told to leave out is treated as durable, which is the safe default),
but it means a tick's CPU still grows with the room even when its writes do not:
see the figures below, and remaining slice 1.

### What it writes, measured

`node scripts/measure-world-writes.mjs` (and `--world`) drives both designs through
the real store on SQLite with the trial game's schema (a count and a 64-entry
collected list per player, both durable and owner-only) for a virtual minute at 20
ticks a second, counting rows changed and bytes bound. Three games: **trial**,
everybody walks constantly and picks something up every 30 seconds, each on their
own tick; **busy**, the worst case, every player's count and whole inventory change
on every tick; **idle**, people seated and nothing moving. Price is Cloudflare's
published rate for SQLite-backed Durable Objects, $1.00 a million rows written
(deletes count; bytes are not billed per write, stored data is $0.20 a GB-month).

Per player-hour, rooms of 8 (busy: 32):

| game  | before: rows | before: bytes | after: rows | after: bytes | 1,000 player-hours before | after |
| ----- | -----------: | ------------: | ----------: | -----------: | ------------------------: | ----: |
| trial |        9,000 |       26.3 MB |       142.5 |      71.2 KB |                     $9.00 | $0.14 |
| busy  |        2,250 |       41.7 MB |     2,253.8 |      25.3 MB |                     $2.25 | $2.25 |
| idle  |        9,000 |       25.8 MB |           0 |            0 |                     $9.00 | $0.00 |

One world of 1,000 players, per world-hour:

| game  | before: rows | before: bytes | after: rows | after: bytes | world-hour before |   after |
| ----- | -----------: | ------------: | ----------: | -----------: | ----------------: | ------: |
| trial |       72,000 |       23.0 GB |      72,120 |      61.7 MB |            $0.072 |  $0.072 |
| busy  |       72,000 |       41.7 GB |      72,120 |      25.1 GB |            $0.072 |  $0.072 |
| idle  |       72,000 |       22.4 GB |           0 |            0 |            $0.072 |  $0.000 |

Read honestly: the journal writes at most one row for a tick that changed value, plus
120 checkpoints an hour. In small rooms that is what makes the difference (64 times
fewer rows for the trial game, 370 times fewer bytes). In a single 1,000-player world
somebody gains something on nearly every tick, so the row count meets the old one
and the price per world-hour is the same seven cents; what changes is that each row
is a few hundred bytes instead of the 320 KB room, and that the world costs nothing
while nobody gains anything. The busy game is the bound, not a target: a game that
really changes every player's whole inventory twenty times a second writes that
much, and no more than before.

The comparison itself costs CPU on every tick: 0.03 ms for the 8-player room, 3.5 ms
for the 1,000-player world (19 ms in the busy worst case, most of it serialising
320 KB of changed inventory). The scratch-studio trial's real world, read from its
local storage afterwards: 24 journal records for the whole session, 11 rows in the
ring averaging 465 bytes, one 2.3 KB checkpoint row.

The prior whole-save format remains readable and upgrades on the next checkpoint.
Match save frequency, expiration and retry behavior are unchanged. Lasting worlds
sleep without people and do not expire. Incompatible schemas stop with their data
retained. Checkpoints are chunked, without the match path's 16 MB envelope cap;
Cloudflare object storage, isolate memory and existing simulation limits still
apply. This is not an unbounded-world or million-player capacity claim.

## Character ownership and recovery

The home record is in one object per existing account, keyed `__player/<id>` in
the existing Table namespace, with one record per game. There is no new account
system, database, ID setup, or binding to provision. Deploy already provisions
Table. The internal character endpoint is reachable through the binding only;
the public Worker does not forward arbitrary internal paths or caller identity.
A player cannot choose their account through hello or replay another account's
seat token. The Worker supplies verified identity.

Acquisition records a monotonically increasing lease before the room records its
reservation. Repeating acquisition by that holder returns the same lease.
The room's save is authoritative while the lease is out. Account copies are
never used to overwrite a live room. On departure/recall the room removes the
body and stores the final character plus a return outbox in the same transaction.
The return detaches from the seat before that seat can be reused, so a later
occupant cannot overwrite an unacknowledged inventory. Only then does it send
the return. The account commits before acknowledging;
a repeated or older return cannot overwrite a newer lease. A second room recalls
the first and acquires only after the return. There is no expiry-based takeover.
A reservation interrupted before join can also be recalled. An unavailable or
incompatible old room blocks transfer instead of handing out an older inventory.

Rules still define game semantics. A queued event is not a transaction between
entities: handle `undeliverable` when a target leaves. Use idempotent commands
(e.g. a collectible ID plus a saved collected set). This slice guarantees durable
committed results; the existing command wire does not give an unacknowledged
command an exactly-once retry ID. A command lost before commitment has not happened.
It does not add trading, purchase consumption or cross-entity atomic transfers.

## Departures from sections 11–13

- Value uses a journal and a periodic checkpoint in this slice (above), and the
  journal is a ring rather than append-and-delete. Multi-area paging and operator
  restore points remain later work.
- Reuse Table's provisioned SQLite namespace for account character homes. The
  object is per account, not a global database hot spot. The later account move
  can introduce a Player class when it moves the rest of account operations.
- No shadow copies or timed leases. Durable room state plus a return outbox is
  enough for this slice. Operator recovery remains unimplemented.
- Reuse sign-in, session validation, saves, orders, grants, and app records. The
  browser trial found an existing refund-trigger bug blocking the plain-text
  signing key: migration 0020 guards JSON parsing and preserves refund events.
- Compatible rules deployments still restart the Worker and reload old views as
  in milestone 1, preserving the world. Live isolate swaps and old-client wire
  compatibility are explicitly later slices, not claimed by this PR.

## Proof and local trial

The release gate includes seeded virtual-time host recovery, interruption at
SQL piece boundaries, acquire/return failures, duplicate returns after a newer
lease, and real workerd Table/SQLite recovery and two-room ownership contention.
Long repetitions belong in `test:rules:extended`.

### Trial on the journal design

Rebased onto main 0.45.3, keeping 0.46.0 and main's filtered rays, pose rewind,
valued pulses, recipient-specific fields, measured-latency rewind bounds, opt-in
exact terrain, navigation and physics. No deploy or merge.

Reused the scratch studio below (Tomorrow Garden: `pearls` and the collected-id
list both `durable` and owner-only), rebuilt on this code, in a fresh named world
`ring-trial`. Two real Chrome profiles signed up through the normal passkey account
flow. Moss collected 2 pearls, Fern 1. SIGKILL of the studio's workerd while Moss
was walking through a pickup, then a normal `dev` restart and reload: Moss had 2.
A changed pickup-radius rule, a normal build and a dev restart: 2. A third, fresh
Chrome profile signing in with Moss's passkey: 2. The world's storage afterwards held 24 journal records in total
and one checkpoint row. Precise crash-boundary claims come from the deterministic
tests, not from the timing of a SIGKILL.

The deterministic gates (seeded input, virtual time, `lasting-worlds.test.mjs`)
kill before and after every physical write and on both sides of the commit, for a
journal record, a multi-row record and every piece of a checkpoint including its
floor row; kill between a committed journal record and the checkpoint that would
fold it; restore from a checkpoint several records old; replay a spent pulse and a
credit that spans ticks; run 48 seeded sessions (2,048 in `test:rules:extended`) of
random play with a crash at a random write, asserting that every reward that was
published is still there and none is paid twice; and assert the write counts above
(an idle room writes no row at all). The real Table/workerd test covers the same
path on workerd's SQLite: pickup, abrupt object death, the host epoch changing, and
another room receiving the committed character.

### Previous whole-save trial (historical)

On 2026-10-10, scaffolded `/tmp/rooms-m3-trial` with the checkout's normal
`homie-studio new`, installed this local toolkit, and used the game skill's
rules/view workflow to make Tomorrow Garden: walk with arrows/WASD, collect
pearls, keep a collected-ID list and count in character fields. The ordinary
strict build passed 18,000 simulation ticks and 813 restore comparisons.
No special database setup or account bypass was used. `dev` provisioned its
local storage and automatically applied migration 0020.

Two independent real Chrome processes/profiles signed up through the account
page using passkeys (Chrome's virtual authenticator supplied the hardware).
The view explicitly reported `playing`; offline fallback was disabled. Moss
collected 2 pearls; Fern collected 1. While Moss continued moving through the
pickup path, SIGKILL terminated this scratch studio's workerd process. Restarting
normal `dev` against the same local storage and reloading restored Moss's 2
pearls. Nothing was duplicated. The precise SQL write boundaries are exercised
by deterministic failure tests, not inferred from the timing of this manual kill.

Changed the pickup-radius rule, built normally, and restarted local dev to model
a compatible deployment (no Cloudflare deployment). The game build changed from
`57881ff7a185884b` to `5412131a997229c0`; the rules build changed too. The existing
profile reloaded with 2 pearls. A third, fresh Chrome profile signed in through
the account page with the original passkey and found the same character and 2
pearls. “Tomorrow” here means a new profile, plus the release-gate test advancing
the saved absence by a day; it is not a claim of a 24-hour browser soak.

A repeat after the seat-token retention fix observed Moss with 1 pearl before
the kill and 2 after restart: the pickup in progress committed once. Both the
changed-build reload and fresh-profile sign-in again showed 2. The first run's
receipts are `/tmp/rooms-m3-trial-receipts-first.json`; the repeat's receipts
and screenshots are at `/tmp/rooms-m3-trial-receipts.json`,
`/tmp/rooms-m3-before.png`, and `/tmp/rooms-m3-tomorrow.png` on the trial machine.
The account ticket bug was found because the first attempt silently played
offline; that attempt is excluded from these results. A build watcher attempt
also needed an explicit dev restart; the successful compatible-build result
uses that restart and a client reload, not an uninterrupted hot swap.
No deployment or merge is authorized or performed.

## Remaining releasable slices

1. Explicit durable command IDs/retry and per-field conservation semantics, with
   a simulator covering delayed/repeated links. With it, durable changes tracked
   where the core makes them, so a tick's CPU follows what changed and not the size
   of the room (today the store serialises and compares: 3.5 ms a tick at 1,000
   players). The journal and checkpoint themselves are delivered in this slice.
2. Atomic value transfers, safe trades, purchase-grant consumption through the
   existing shop ledger, mailbox/bank and departure settlement for queued value.
3. Private rules bundles, isolated rule execution and live compatible rule swaps;
   versioned build publication and client compatibility without a Worker restart.
4. State migration chains, switch restore points and reversible schema changes.
5. Calendar time, durable schedules and sleeping turn-based worlds.
6. Scope-consistent backups/restore, fenced restoration and operator character
   recovery. A restore must never duplicate value across rooms and accounts.
