# Room lifecycle

Part 4 depends on part 3's queue consumer for ordered room summaries and on the extracted runtime. Lobby imports legacy snapshots into incremental SQLite room rows. Migration `0036_lobby_summaries.sql` owns queued summaries; object-local session/chat schemas remain with their consumers.

Public player and watch sockets use `acceptWebSocket`, attachment-backed identities, and edge-answered `homie-ping`/`homie-pong` heartbeats. The generated lazy Gate entry forwards all three WebSocket callbacks. Restoring a socket rebuilds its authenticated transport and logical client; it does not repeat admission or send a welcome.

Gates send ordered input batches over Durable Object bindings. Worlds and reliable responses share a bounded output stream while a room is active. At idle, Table flushes and closes that stream without removing logical players. With no outbound WebSocket, pending stream, or simulation timer, both objects can hibernate. The next player message or the round alarm opens a fresh stream. Object-generation headers reset flow-control counters and request a complete world header, so a restored Gate never decodes a delta against missing state. The old multiplex WebSocket endpoint remains for internal compatibility.

A stream is deliberate: sending each world through a binding callback creates a recursive chain through the input acknowledgements and can hit the platform's subrequest-depth limit. An output stream carries frames without making a new nested call per frame. Input queues and output streams are bounded; a broken active transport still closes affected connections, whose existing seat tokens support reconnection. An orderly idle detach is not a broken transport.

The rules host has an explicit opt-in round-idle contract. It runs both scoring-settlement ticks and the `roundOver` handlers before checkpointing the next-round wall-clock deadline. Simulation time, movement, and queued event deadlines freeze for the rest of the break. An alarm begins the next round without replaying idle ticks. Browser hosts that do not opt into this callback retain their existing clock behavior. Legacy snapshot-only games remain active while occupied because they do not declare round boundaries.

Idle alarms inspect edge heartbeat timestamps, expire disconnected seats, preserve moderation deadlines, and wake the next round. Session snapshots retain relay routing and logical identities separately from transport objects. Empty rooms close their remaining streams and retain only finite cleanup work.

Focused checks cover scoring in flight, execution of `roundOver`, persisted deadlines, no idle timers, ordered stream detach/resume, stale stream cancellation, and real-workerd seat recovery through Gate and Table failures. Deployed proof and the cold-seat comparison are being collected before this draft is marked ready.

Historical evidence under `packages/studio/test/evidence/runtime-best-practice*` remains unchanged. Its 240/240 short admissions did not establish long-lived round continuation; its PDX cold-seat medians of 432 and 493 ms used only 1/5 samples and do not establish non-regression.
