Opted-in `validated-owner` runners integrate their own guarded movement while the server validates ordered reports against canonical physics. Authority retains scores, catches, placements and round results; ordinary snapshots do not rewind the owner. The rebase retains main 0.57.0's hibernatable room lifecycle, relay epochs, Lobby shards and early-join retries.

Round 9 fixes bounded report retention through stalls, relay-resume handling, placement timestamp fencing, and observer catch-up along actual movement paths. The studio uses published 0.57.0 plus the reproducible packed PR overlay.

**Not ready to replace live.** All 42 paired quiet-load proofs completed (maximum load 12.75). Primary-observer >3-tile jumps are 0/436 candidate/live over 304,229/304,106 frames; 12 authority resumes have no candidate snaps or recovery holds. However, 300 ms host-profile owner phantom candidates remain 24/32 versus 2/6, and repeated non-host run p90 at 150 ms is 35.9/31.8 ms (95 samples each); 300 ms jump p90 is 35.5/31.6 ms (80/79). These unresolved regressions block acceptance.

Full runtime CI passes on `92843051`; clean studio install, 47 tests and strict generated play (18,000 ticks / 813 restores) pass. Rebuilt artifacts match the measured artifacts. No version bump, merge or deployment; the detached control and owned dev servers were cleaned up.

[Final proof and complete per-profile comparison](https://github.com/homie-rocks/homie/blob/runner-error-smoothing/docs/receipts/validated-owner/round9/README.md).
