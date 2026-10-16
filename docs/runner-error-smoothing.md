# Validated owner movement (replacement for correction steering)

PR #116 now adds `body.move: 'validated-owner'`. The owning browser integrates
and draws its own input using the game's guarded movement function. It reports
every input tick with position, velocity, heading and the snapshot baseline tick.
The server orders reports, runs that same movement from its last accepted state,
and accepts only numerically equivalent poses (0.002 per axis). The canonical
result remains the validation baseline, so tolerance cannot accumulate into extra
speed. Rules still own scores, catches, respawns, round changes and knockback.
Impossible reports and server movement events increment the body's revision;
the owner cuts to the authoritative state. Ordinary snapshots never replace its
position, velocity or movement state. Other players buffer accepted owner ticks, adapt the playback delay to arrival jitter, and bound catch-up distance per frame. Explicit placements still cut.

This replaces the abandoned correction-steering implementation, including its
changes to shared `rayBox`, save rows and non-opted-in drawing. Default games keep
the existing movement path. The outage policy is also opt-in: owner games continue
local movement while keeping authoritative score and retrying the server.
When two valid local substeps straddle a platform corner, the opted-in box
renderer shows the actual landing step rather than blending inside the tile.
No package version changes are included.

## Protocol and limits

- Reports contain the normal declared input fields, nine pose numbers, the
  baseline tick, and the existing sequenced-input metadata. They use the existing
  redundant input transport and byte limits.
- Missing reports wait for delivery. Up to 256 input ticks survive a transient
  absence; the server keeps the accepted body instead of handing it to a bot. Duplicate ticks cannot add movement. A
  bounded queue processes at most eight reports per server tick, and no more
  movement ticks than elapsed server wall time permits. A delayed simulation callback
  does not invalidate the owner's continued physics-valid reports. Stale revisions are ignored.
- An explicit fresh snapshot baseline can restart the input clock after a pause,
  but grants only one validated move from the accepted body, never skipped travel.
- Malformed or impossible reports, or an unrecoverable gap, trigger a revision
  and cut. Validation never clips or steers a forged report into a valid pose.
- The optional owner-tick trailer on player snapshot rows identifies the last accepted
  movement tick; older readers ignore it. `room.confirmedTick` reads that tick from
  the sampled authoritative scene, so provisional contacts do not expire just
  because the room clock caught up.
- Validation queues are transient; existing durable entity rows are unchanged.
  Restores establish a new epoch and ownership baseline.
- The initial opt-in supports sampled/held movement inputs and static geometry.
  Use commands for discrete server actions. Press/pulse inputs and live colliders
  are refused by the compiler rather than silently losing events.
- The trusted direct `core.step` API can still simulate raw input for offline
  game tests. Network hosts always enable validation for opted-in human bodies.

## Tiny Platformer integration

Only its runner opts in. Its original three 1/60-second physics steps remain.
The move records the input tick in motion; monster contact checks use that tick,
not packet arrival time. `patrols.ts` is an exact generated table of each original
monster's repeating path. A behavioral test compares all three substeps against
the original physics for 4,800 ticks per monster. It adds no room history or save
format. The existing 34 studio tests remain unchanged.

## Evidence

The [round 7 follow-up](receipts/validated-owner/round7/README.md) records the current
changes, passing checks, valid paired measurements and unresolved gates. **Not ready:**
the full final-head matrix and slow-phone proof remain incomplete. The current control
is detached live main `038fdb0`, toolkit 0.53.0; the studio pins published 0.53.0
with a reproducible PR overlay. Earlier receipts remain historical evidence.
No merge or deployment is performed.
