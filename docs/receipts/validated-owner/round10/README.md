# Round 10 — in progress

No readiness claim. No version bump, merge or deployment.

Starting points: toolkit `c92e5bec`, studio `7bfdf12`. Control remains round 9's detached Arcade main `c75980a` on published 0.56.0, locally at port 8792. Candidate uses published 0.57.0 plus the checked-in overlay, locally at port 8791.

Changes under test:

- Capture `room.input()` call time before pumping queued work. The deterministic four-millisecond fixture fails before the fix and passes afterward. Tiny Platformer also passes keyboard `event.timeStamp`.
- Add immutable `room.get(id, {latest:true})` for explicitly ticked lifecycle fields. It does not advance the buffered scene, predict a remote body, or change ordinary `get`/`each`.
- Studio records a stomp's accepted contact tick and applies the confirmed death at that tick in the existing shared scene, rather than waiting until the judging server tick is drawn. New births still use their own lifecycle. All six round-9 non-host deep overlaps were followed by a disappearance plus score increase; that observation motivates this change but does not erase those raw flags.
- Studio waits for a moving owner's next path while its last endpoint remains within the existing 150 ms plus measured-latency allowance, capped at 600 ms. It no longer sweeps newer patrols through that fresh, moving endpoint. Out-of-window reports, stationary endpoints, and silence after expiry still meet current monsters. The new bounded-silence fixture fails before the change and passes after it; original stale-report tests remain unchanged.

`i10-feel150n` is diagnostic, not final-runtime acceptance. Its manifest identifies the round-9 toolkit (`67b0e412…`), because `npm install` reused a same-path tarball cache. It therefore measures only the explicit game keyboard timestamp: run p90 31.0/32.4 ms (47/48), jump 30.0/32.9 ms (40/40), candidate/live. Peak load 7.979; no errors. The newer toolkit was then installed by passing the tarball explicitly. The round-10 pair harness now compares every installed overlay file and the runtime identity to the toolkit before starting, and hashes generated server rules as well as browser bundles throughout each pair.

Local verification: 40 focused view cases, 16 contract/guide cases, 50 studio tests, strict studio build and generated play pass. Full remote CI and the fresh paired matrix are pending. Raw comparisons and the frozen harnesses remain in the studio's `reviews/server-rules/round10/` and `scripts/round10/`.
