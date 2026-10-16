Opted-in `validated-owner` runners integrate their own guarded movement while the server validates ordered reports against canonical physics. Authority continues to own scores, catches, placements and round results; ordinary snapshots do not rewind the owner.

Rebased onto main 0.57.0, retaining hibernatable room lifecycle, relay epochs, Lobby shards and early-join retries. Round 9 adds bounded report retention through server stalls, relay-resume grace, placement timestamp fencing, and bounded observer catch-up along newly revealed movement paths. The studio uses npm-published 0.57.0 plus a reproducible packed PR overlay.

**Round 9 proof is in progress; readiness is not yet established.** Fresh paired headless tests compare the current runtime against detached Arcade main `c75980a`, rejecting every pair whose load exceeds 25. Earlier diagnostic campaigns are retained separately. The complete network, crowd, stall, lag-switch, clock, phone, contact and input-latency matrix must finish before acceptance.

[Implementation, regression tests and proof receipts](https://github.com/homie-rocks/homie/blob/runner-error-smoothing/docs/receipts/validated-owner/round9/README.md). No version bump, merge or deployment.
