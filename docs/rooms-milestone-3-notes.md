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

Every tick of an opted-in world writes its complete result and queued events,
input acknowledgements, character leases/returns and seat map in one SQLite
transaction before publishing any tick output. Multi-piece saves are atomic.
Cloudflare's storage output gate holds outgoing messages until confirmation.
A synchronous write failure stops the host and retains its last committed save;
it never continues from failed memory. Match rooms keep their existing save rate,
retry behavior and expiration. Lasting worlds sleep without people and do not
expire. Incompatible schemas stop with an explanation and keep the old data.
They are never turned into a fresh world by match cleanup or a restore-loop guard.

This is a write per simulation tick, including movement, not the roadmap's
incremental journal. It is deliberately opt-in and costs more than match saves.
The existing 16 MB whole-save envelope cap is not applied to lasting worlds;
Cloudflare storage, isolate memory and existing simulation constraints still apply.

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
Only then does it send the return. The account commits before acknowledging;
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

- Reuse whole-room save/restore for atomic results instead of introducing a ring,
  pages, folding and a second recovery format before multiple areas need them.
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

1. Incremental commitment journal and explicit durable command IDs/retry, with
   per-field conservation and a simulator covering delayed/repeated links.
2. Atomic value transfers, safe trades, purchase-grant consumption through the
   existing shop ledger, mailbox/bank and departure settlement for queued value.
3. Private rules bundles, isolated rule execution and live compatible rule swaps;
   versioned build publication and client compatibility without a Worker restart.
4. State migration chains, switch restore points and reversible schema changes.
5. Calendar time, durable schedules and sleeping turn-based worlds.
6. Scope-consistent backups/restore, fenced restoration and operator character
   recovery. A restore must never duplicate value across rooms and accounts.
