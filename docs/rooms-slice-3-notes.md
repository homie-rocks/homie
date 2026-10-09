# Rooms, slice 3: the same rules in browsers and offline

Updated 2026-10-08.

## Scope and integration

This branch includes main's server saving implementation and slice 3's browser/offline
adapter. Both hosts use the same rules runtime, save envelope, restore, input handling,
guide helper and decision path. Browser identity comes from the relay's current and held
seats, never the preceding host's checkpoint. Offline play uses local bots and never
uploads offline progress. Online rooms support guides and decisions. Private server games
with offline disabled ship no rules entry. Lab and packaged apps use the same adapter.

The rules-output sender marks runtime frames explicitly. Every unmarked frame from the
hosting socket is a player frame, with the same limits and outcomes as a replica. The
sender coalesces snapshots and preserves every other frame in one FIFO; each reliable
frame leaves when its own kind has a token and never waits for a snapshot's. Build, view
and relay share the size/rate table, parameterized by tick rate and seats. The snapshot
allowance is the tick rate plus a quarter (30 at least), and the sender spends all of it,
so a browser host sends a snapshot a tick at 20, 30 and 60 ticks as the server does.
Sender headroom and relay token buckets tolerate ordinary bursts and late timers. Excess
snapshots drop; excess reliable output triggers handover, and that socket is not elected
again (the same page on a new socket is a newcomer, ranked behind every other candidate).
Only the absence of another candidate ends such a room. Size violations retain their
measured terminal error. A browser host offers no protection against a modified host.

Giving the role up is one ordered act. A yield (hidden tab, slow host, `handOff()`) goes
through the sender behind its checkpoint, and output made after it is held until the relay
answers: discarded when the role moves, released when the relay keeps the host
(`host` with `why: 'host-kept'`, or two seconds of silence). A closing page sends what
its allowances permit, then its last checkpoint regardless, then `bye`. A planned handover
therefore goes back zero ticks and repeats no effect; a crash still goes back to the last
checkpoint, as any browser host does.

The decision allowance covers one decision a tick, which is all one declared ask can make
(the next waits for the answer), so a game that asks as fast as the runtime lets it gets
as many decisions from a browser host as from the server. The relay takes any tick rate a
game may declare (1 to 60) for its allowances, not only 20, 30 and 60.

A browser host's timer that fires up to a tenth of a second late (two tick periods, if
longer) is caught up as the server catches up, so a 20-tick room on a 70 ms timer or a
60-tick room on a 37 ms timer runs at its rate. Later than that the clock runs slow and
the existing slow-host yield hands the room to a faster page.

Everything the rules say takes the runtime's output path. A host that reconnects and is
still the host has its runtime announce the round, roster, shared state and capabilities
again, marked, followed by a checkpoint; a promoted host says its shared state with its
round. The helper sends no host frame of its own in a rules game. A page that announces
rules with a revision below 11 is never elected.

Old-style games keep their original character-based size checks and original rate values,
and are sent nothing new: no `free`, no snapshot epoch and no `held` occupants, and the
relay counts its outgoing characters for them as before.
Rules frames use UTF-8 bytes. Protocol revision 11 describes the optional browser fields;
wire version and all package versions stay unchanged. Unreleased changelog bullets and
the package copy describe these limits.

Local development stops Wrangler at the successful build's publication boundary, then
starts it once after both rules and assets are published. This avoids independent asset
and code watchers restarting a room twice, including once on the obsolete code. A failed
build never stops the current runtime. Local persisted room state stays in the same place.

## Saving integration

`createCore` owns the single core validator, save and restore. `createHost` validates its
own envelope and input/helper tables. Invalid saved fields, vectors, asks, goals and table
shapes are rejected, while live commands and inputs still coerce through declarations.
Unknown envelope/core keys are rejected. Browser reconciliation replaces seat authority
before these checks; it is not another saved-value validator.

`restoreEpoch` is the single option replacing an epoch. `startPaused` independently
controls startup; server recovery defaults to paused and browser promotion selects false.
The browser marks absent holders away when synchronizing the relay's occupants. The host
publishes one round on restore/resume; the Table's duplicate retiming implementation is
removed. Clock-only retimings carry no results and do not re-emit the round event.

A decision already in flight replies to the current browser host. The saved pending ask
then consumes it exactly once. Companion entries are shape checked before loading;
vocabulary authorization and expiration still discard obsolete goals/asks and expired
avoidance. Rejected carried-goal tests prove an invalid goal cannot suppress the floor.

## Verification

Regression coverage includes the 9,054-character accented old-style snapshot, every
hosting-player frame allowance, reliable FIFO delivery under delayed timers, snapshot
coalescing, faulty-host election, pending decisions across handover, and rejected saves.
The existing 2,400-tick comparisons cover server/browser saves and handovers.

`rules-traffic-chrome.test.mjs` runs real sockets and real-time Chrome sessions beside
server-hosted equivalents for at least thirty seconds per case: 20/30/60 Hz effects,
20/60/120 ms timer delays alone and with a replica, five asks, twelve joins in a second,
and seven players' emotes, each page in a window of its own. Its second test hides,
closes and hands over the hosting page at 20, 30 and 60 ticks and requires, at a third
page, no snapshot tick at or below an earlier one and each tick's effects exactly once. `rooms-pages.mjs` checks ten runs of ten updates plus the
existing thirty-update run. These require a working Chrome; the update proof also needs
local Wrangler. A launch failure is reported as a skip, never claimed as a browser pass.

Validation runs use a 1,536 MB Node heap and sequential test files, with at most one browser
and one local Wrangler. Logs and independent review harness copies stay outside the repo.
The untracked `.studio` directory is excluded from commits. No push, pull request,
deployment, credentials, package version changes or committed review reports are involved.
