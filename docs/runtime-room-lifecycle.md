# Room lifecycle (draft)

Part 4 depends on part 3's queue consumer for ordered room-summary snapshots and on the extracted runtime. It imports legacy Lobby snapshots into incremental SQLite room rows, separates matchmaking from subscription objects, and persists direct player/watch sessions and moderation state for hibernation. Migration `0036_lobby_summaries.sql` owns the queued summary table. Durable Object session/chat tables initialize within their owning objects.

This remains draft. Gate still has an outbound socket and public sockets use standard acceptance; Table excludes relayed and server-rule rooms from sleep. The open work requires a durable detach/resume handshake, restored logical sessions without new welcomes, and a between-round contract that preserves the two scoring-settlement ticks before pausing. Merely accepting inbound sockets through the hibernation API cannot make this topology hibernate.

The retained `runtime-best-practice-round2.md` is a historical report at c4fc93ba, not a completion claim for this split. Evidence under `packages/studio/test/evidence/runtime-best-practice*` remains unchanged for provenance. Five deployed admission batches observed 240/240 admissions; they did not test a rendered round or long-lived sockets. Cold PDX seat median 432 to 493 ms used only 1/5 samples and is insufficient for a non-regression claim.

Required before ready: real Gate and server-room idle eviction/restoration, round continuation, active-round-only ticking under an explicit settlement contract, and a sufficiently sized matched-colo/version cold-seat comparison. No fresh deployed proof is claimed. The current task prohibits deployment; clarification about an isolated temporary fixture is pending.
