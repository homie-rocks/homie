# Queue delivery and payment recovery

Part 3 depends on part 2's request/database and runtime boundaries. Durable mutation notifications and verified Stripe webhook intake move to Queues with retries and a dead-letter queue. Intake persists before acknowledging; reconciliation keeps its lease, and redelivery waits for that lease to expire. PaymentIntent identifiers are saved before follow-up calls. Recovery uses the original idempotency key and retains uncertainty for review.

Migration `0035_payment_delivery.sql` creates Stripe intake and its completion index, plus the shop-event retention index. It does not contain room-summary or analytics tables. The original migration 0034 remains the request-performance index only. No version bump.

The tests exercise deduplicated intake, reconciliation acknowledgment, crashed-consumer lease delays, payment deadlines, persisted observations and recovery. They use local fixtures, not real payments. The original round-2 latency observations cover the combined branch and are not evidence of this isolated PR's queue latency. No new latency claim or deployment is made here.
