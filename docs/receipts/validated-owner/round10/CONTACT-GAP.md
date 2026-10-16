# Remaining owner-contact discrepancy

The current candidate does not satisfy the owner-contact requirement. Four 180-second, 300 ms host-profile pairs in campaign `g10-` flag 38/44 candidate geometric respawns versus 2/13 live. The original two-repeat subset is 19/22 versus 2/8. These flags mean no drawn monster was within 1.2 tiles during the preceding 600 ms; they are not individually proven invalid authoritative collisions.

Two different clocks still matter. The owner is drawn on its locally predicted movement path; monsters and remote runners use the buffered `room.viewTick`. In these four runs, the median owner-minus-monster clock gaps at explicit catches were 0.981, 0.993, 0.635 and 0.818 seconds. An explicit `diedAt` audit found 47 catches, of which 39 had no nearby drawn monster in 600 ms and 24 had none in five seconds. The geometric detector and explicit audit intentionally have different event definitions and denominators.

There is also a reproducible authoritative contact-time mismatch, independent of the drawing buffer. `scripts/round10/stale-contact-repro.mjs` in the studio runs the actual guarded rules, validates eight physically correct movement reports, and compares their substeps with the actual deterministic patrol at their input ticks. Its first retained witness has:

- Accepted input ticks 51–58, judged at server tick 69.
- Minimum runner/monster separation of 2.596 tiles at those input substeps.
- Zero held/rejected movement reports and zero rule errors.
- A catch against the newer monster after the older reports fall outside the contact-history allowance.

The current rule uses report time only within 150 ms plus measured latency, capped at 600 ms. An older accepted path falls back to the current monster. A separate bounded grace prevents a fresh moving endpoint from being swept again before its next path arrives, but it does not repair that fallback. Merely limiting an expired batch to its final endpoint still produces a mismatch in the isolated experiment: ticks 51–58 judged at 73, with at least 2.295 tiles of historical separation. The diagnostic exits 1 when it finds the discrepancy; it is not a passing acceptance test.

Moving all drawing to the owner's clock was also falsified by the browser trial. Forecasting remote runners from their last held controls produced 11 observer passes, 10 deep, versus live's zero, and still flagged 4/5 owner catches versus 0/7. That implementation was reverted. A constant-input unit case was insufficient evidence for changing-control multiplayer play.

The retained lifecycle change addresses a different issue: confirmed stomps carry their accepted contact tick, so the shared buffered scene can hide a monster at that contact rather than at the later judging snapshot. It leaves positions on the common scene clock. It cannot establish that the owner's predicted body and every authoritative catch share the same visible hazard timeline.

No detector threshold, raw flag, original studio test or stale-report bound was changed to obtain a passing result. Both the owner presentation clock and expired-report policy remain acceptance blockers; this proof does not approve replacing live.
