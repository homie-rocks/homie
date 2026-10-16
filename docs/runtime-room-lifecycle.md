# Room lifecycle

Tables stop simulation timers between settled rounds and retain the next-round deadline in their alarm. Public player and watch sockets use WebSocket hibernation. Restoring a socket restores its authenticated context and rate state; a refused restore closes the transport so the client can reconnect.

Gates multiplex live traffic over a WebSocket. At an idle boundary the Table detaches that internal connection without closing player sockets. Ordered HTTP input and a temporary output stream cross the boundary; live rounds reconnect the multiplex socket. Client edge heartbeats preserve transport liveness, while unanswered room clock pings detect a dead room.

Session storage uses an explicit field allowlist and individual relay-client rows with URL differences relative to their Gate. Simulation snapshots remain in the existing host save. Chat state is written only when changed and statistics flush at most once a minute. Watcher addresses are digested for admission limits, user agents are reduced to the QA classification, and orphan request records are removed on restoration.

Matchmaking uses 16 deterministic shards per game. Public room numbers identify their shard; named-server pools keep their room cap in one shard. A short-lived player reservation makes concurrent retries idempotent. Reads aggregate shard counts, and queued room summaries paginate in game-key order.

The [throwaway lifecycle fixture](../packages/studio/test/fixtures/room-lifecycle/README.md) exercises real Worker routing, Tables, Gates, and external WebSockets. Deployment measurements and cleanup results belong in the pull request description, not in the toolkit source tree.
