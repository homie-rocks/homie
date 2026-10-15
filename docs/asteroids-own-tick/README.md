# Fractional own tick for Asteroids presentation

Asteroids Arena's server migration exposed the existing gap described in the studio's TOOLKIT-GAPS.md §7: `viewTick` is the remote interpolation clock. Drifting rocks drawn on that clock lag behind an immediately predicted ship. A predictor callback is not a clock: it runs during previews and reconciliation as well as ordinary ticks.

`room.ownTick` exposes the fractional tick underlying the own predicted pose, including a historical catch-up segment, before residual positional blending. It is null without an own body, follows offline practice, and reports the last authoritative tick while a control gate disables prediction. It is a read-only presentation API. It neither accepts position claims nor rewinds hits, scores, or projectiles.

The game uses known birth positions, velocities and ticks to render deterministic rock and projectile trajectories on this clock. This does not make delayed knowledge of a split, impact or respawn immediate. Visual corrections can still displace a ship from its underlying trajectory; callers must not use this clock as proof of contact.

## Red/green evidence

Before implementation, `node --test --test-name-pattern='ownTick exposes' packages/studio/test/rules-view.test.mjs` failed both 0 and 300 ms cases: expected `number`, received `undefined`. After implementation both pass. The strengthened tests compare constant-speed wrapped displacement against the clock's fractional advance and run with 5% loss. The four existing 2D/3D wrapped-world tests also pass (including 300 ms/loss and saved restore).

The studio verifies the actual npm-packed package, with its runtime content identity, rather than editing node_modules. Its comparison receipt lives in `reviews/server-rules/asteroids-arena.md` on Homie Arcade's `asteroids-server-rules` branch. The initial game trial found one apparent phantom crash at 150 ms; that was a prompt to investigate, not a standalone proof that this API eliminates every collision discrepancy.

No version bump, merge or deployment.

## Host pause recovery

A paired Chrome run at zero artificial delay exposed hundreds of rejected future inputs after two host scheduling slips. The view only slewed its clock by 0.5%, and the host discarded input beyond its one-second bound before recording its lead. That combination could leave fresh direction changes unaccepted for minutes.

Two additional tests pause the host for 1.6 seconds while its view continues, then reverse input. Both failed before the fix: the view stayed outside the one-second admission window after six seconds. The host now reports the lead even for a rejected future input; the view uses its existing pose-preserving rebase when median lead exceeds its jitter target by six ticks. Ordinary jitter still uses replay and gentle slewing. The admission bound, duplicate handling, score authority and budget checks remain unchanged.

The complete rules-view suite ran 259 passing subtests before Node's default heap limit aborted the process. No assertion failed in that attempt; it is not reported as a full-suite pass. Targeted clock, wrapped-world and release-matrix tests run separately to avoid that accumulated fixture heap.
