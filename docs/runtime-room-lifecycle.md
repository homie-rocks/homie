# Room lifecycle

Part 4 depends on part 3's queue consumer for ordered room summaries and on the extracted runtime. Lobby imports legacy snapshots into incremental SQLite room rows. Migration `0036_lobby_summaries.sql` owns queued summaries; object-local session/chat schemas remain with their consumers.

Public player and watch sockets use `acceptWebSocket`, attachment-backed identities, and edge-answered `homie-ping`/`homie-pong` heartbeats. The generated lazy Gate entry forwards all three WebSocket callbacks. Restoring a socket rebuilds its authenticated transport and logical client; it does not repeat admission or send a welcome.

Gates send ordered input batches over Durable Object bindings. Worlds and reliable responses share a bounded output stream while a room is active. At idle, Table flushes and closes that stream without removing logical players. With no outbound WebSocket, pending stream, or simulation timer, both objects can hibernate. The next player message or the round alarm opens a fresh stream. Object-generation headers reset flow-control counters and request a complete world header, so a restored Gate never decodes a delta against missing state. The old multiplex WebSocket endpoint remains for internal compatibility.

A stream is deliberate: sending each world through a binding callback creates a recursive chain through the input acknowledgements and can hit the platform's subrequest-depth limit. An output stream carries frames without making a new nested call per frame. Input queues and output streams are bounded; a broken active transport still closes affected connections, whose existing seat tokens support reconnection. An orderly idle detach is not a broken transport.

The rules host has an explicit opt-in round-idle contract. It runs both scoring-settlement ticks and the `roundOver` handlers before checkpointing the next-round wall-clock deadline. Simulation time, movement, and queued event deadlines freeze for the rest of the break. An alarm begins the next round without replaying idle ticks. Browser hosts that do not opt into this callback and legacy adapters without the native hibernation API retain their existing clock behavior. Legacy snapshot-only games remain active while occupied because they do not declare round boundaries.

Idle alarms inspect edge heartbeat timestamps, expire disconnected seats, preserve moderation deadlines, and wake the next round. Session snapshots retain relay routing and logical identities separately from transport objects. Empty rooms close their remaining streams and retain only finite cleanup work.

Focused checks cover scoring in flight, execution of `roundOver`, persisted deadlines, no idle timers, ordered stream detach/resume, stale stream cancellation, bounded pending input bytes, and real-workerd seat recovery through Gate and Table failures. The final runtime passed 205 existing durability/Gate tests, the companion-pacing integration test, and 35 focused lifecycle/workerd tests.

[Deployed observations](../packages/studio/test/evidence/room-lifecycle-deployed.json) measure runtime `022121f8` with the [throwaway fixture and external probe](../packages/studio/test/fixtures/room-lifecycle/README.md). Two real external player WebSockets in each of the direct and gated rooms stayed connected through a 45-second break. After 26 seconds without object polling, constructor IDs changed for both Tables and the Gate. The tick remained **22**, with no timer. Round 2 continued at ticks **25 / 28**; all four connections received exactly one welcome, zero closes, zero error frames, and zero undecodable snapshots. Each received 23 edge pongs and its own body in decoded snapshots (25/19 direct, 29/24 gated). No abort, reconnect, or redeploy occurred during observation. This proves orderly idle restoration; active transport failures retain their separate reconnect contract.

Historical evidence under `packages/studio/test/evidence/runtime-best-practice*` remains unchanged. Its 240/240 short admissions did not establish long-lived round continuation; its PDX cold-seat medians of 432 and 493 ms used only 1/5 samples and do not establish non-regression.


[Cold-seat summary](../packages/studio/test/evidence/room-lifecycle-cold.json) and [all 79 requests](../packages/studio/test/evidence/room-lifecycle-cold-samples.jsonl) retain deployment markers, isolate IDs, cf-rays, status, timing, and inclusion flags. The final runtime and published 0.54.0 each have **15 first-isolate requests in YVR**. Baseline/head deployment order alternates. Both use the same D1 database and identical minimal catalogue, with separate Worker/DO namespaces. Each sample requires a new deployment marker and the isolate's first-request flag; 49 rollout polls are excluded.

| Cold-isolate room-seat timing (ms) | 0.54.0, n=15 | Final runtime, n=15 |
| --- | ---: | ---: |
| TTFB median | 306.80 | 298.68 |
| TTFB p25–p75 | 295.80–354.22 | 245.42–321.26 |
| TTFB min–max | 228.13–470.26 | 216.50–378.73 |
| Worker elapsed median | 136 | 86 |

The observed median difference is **−8.12 ms (−2.65%)**. A paired bootstrap interval for that difference is −70.70 to +20.17 ms (95%, 10,000 resamples). This comparison shows no observed cold-seat regression; it does not establish that every deployment or colo improves. TCP/TLS connections were reused to hold the edge colo fixed. The Worker isolate is cold, while D1 and room state can be warm. These timings do not directly reproduce the historical fresh-TLS PDX measurements, whose small sample remains inconclusive.

[Cleanup evidence](../packages/studio/test/evidence/room-lifecycle-cleanup.json) records HTTP 404 for all four throwaway Workers and the one D1 database, plus zero matching Durable Object namespaces in a complete account inventory. No proof deployment remains.
