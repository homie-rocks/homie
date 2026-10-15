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

## Wrapped circle correction limit

The browser comparison at 150 ms one-way delay, 5% retransmission and ±40 ms jitter exposed 39 frames whose displacement exceeded ordinary ship travel plus three pixels. The existing presentation limit applied only to boxes. A wrapped-circle regression injects a two-metre reconciliation offset while moving at 4 m/s: before the fix its worst 16 ms frame travelled 0.144 m, failing the 0.1 m bound. Wrapped circle presentation now limits extra correction speed to radius/blend time, in the shortest periodic direction, while allowing real movement velocity. Placements bypass it. This is presentation only; server physics and the prediction clock are unchanged.

## Synchronous presentation across a tick boundary

CI's real-Chrome 60 Hz browser-hosted case exposed a synchronous-reader failure. The public getter pumped before consulting its presentation cache, so a slow callback crossing a tick could invalidate the pose between two reads. A deterministic test advances only the view clock by 60 ms within one callback; both object identity and ownTick checks failed before their fixes. Pumping now preserves an already published presentation until its microtask ends; explicit changed input forces its catch-up as before. The published fractional tick is cached with the pose. The existing effect-before-step test remains intact.

Validation: 53 targeted view tests pass, including the release matrix, ownTick, host-pause recovery, wrapped circle bounds, effect reads and the new callback-boundary case. All five real-Chrome smoke tests pass (127.7 seconds), including 300 ms / 10% loss / 60 Hz browser hosting. The exhaustive author API fixture also reads ownTick as number-or-null; its missing-key CI failure was fixed without relaxing exhaustiveness.

## Repeated small host clock slips

The simultaneous studio matrix exposed a further zero-delay backlog: 203 px p90 drawn/received distance at four players and 258 px at eight clients. A deterministic test pauses the host for 150 ms every second. Before the fix its own-clock lead grew to 24.70 ticks; after it stays at one tick. The view compares snapshot stamps against their tick delta, so a host clock shift is handled by the existing pose-preserving rebase instead of inflating the input-jitter reserve. Arrival delay is not used to detect the shift. The same test also runs at 300 ms each way. Final packed-build matrix acceptance will use this fix; prior c695f762 measurements remain exploratory.

Validation after this fix: all 55 targeted view tests and all five real-Chrome smoke tests pass. Repeated-stall lead is one tick at zero delay and seven ticks at 300 ms each way.

## Overrun attribution on advancing clocks

The final packed comparison exposed local rooms ending as overruns while their individual rules ticks were inexpensive. The old attribution included time waiting for the next callback, so unrelated work could be blamed on the last tick. A failing regression gives every tick 1 ms of synchronous work and delays callback delivery by 300 ms: the old host ends after 5.2 seconds. With an advancing host or performance clock, attribution now uses the measured synchronous interval. Once that clock has demonstrated advancement, a zero-duration interval is below its resolution; with fully frozen clocks the existing scheduling-interval fallback remains. Preemption inside a synchronous tick can still count as elapsed execution time; this is not a CPU-time claim.

All 36 host and hostile-rules tests pass, including slow 70 ms/120 ms/one-second ticks, budget failures, the new external-wait regression, and an explicit frozen-clock safeguard test. No period, five-second deadline, throughput threshold, or execution budget was relaxed. Studio packed-build validation must be repeated for the affected local-host cases.
