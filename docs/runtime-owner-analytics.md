# Analytics and owner visibility

Part 5 is independent and branches from main. Page metrics use Analytics Engine; hourly D1 rollups apply deltas and watermarks atomically, preserving historical totals and making replay safe. Game, payment and budget counters stay durable. Owner statistics explain ingestion delay, hourly updates and sampling. Wrappers without analytics bindings keep D1 counting.

Migration `0037_owner_analytics.sql` owns the rollup watermark table. Its number is reserved across the runtime split; SQLite does not require consecutive migration numbers. No queue or room migration is required. No version bump.

The [combined-branch evidence](https://github.com/homie-rocks/homie/blob/c4fc93ba480549996869b4d6ca59d0c4a7a293ec/packages/studio/test/evidence/runtime-best-practice-round2.json) recorded 21 live test points. Fourteen preceded fixture rendering failures; only the final seven page requests all returned 200. Immediate ingestion saw six points, later all 21. Owner totals progressed from 16 (10 historical + 6) to 31 and remained 31 after replay. This demonstrates ingestion lag, preserved history and replay idempotency, not high-volume sampling accuracy. It is prior combined-branch evidence, not a fresh deployment of this PR.

Cleanup: the producer was deleted in the earlier run. The 21 points in `hm_rbp_proof_visits` were **not deleted**. Rechecking the Cloudflare OpenAPI on 2026-10-15 found only GET/POST `/accounts/{account_id}/analytics_engine/sql`, no dataset or point deletion endpoint. The [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) documents queries; [retention is three months](https://developers.cloudflare.com/analytics/analytics-engine/limits/). No successful deletion is claimed.

Validation: 17 focused owner analytics, configuration and customer regression checks pass. Rollup tests retain historical totals, account for delayed ingestion and replay without double counting.
