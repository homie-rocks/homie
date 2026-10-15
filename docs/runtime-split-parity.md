# Runtime split parity

The six review PRs replace #144: #147 (modules), #148 (request performance, depends on #147), #149 (queue/payment delivery, depends on #148), #151 (draft lifecycle, depends on #149), #150 (independent analytics from main), and #146 (independent CI evidence from main).

The original branch remains at `c4fc93ba480549996869b4d6ca59d0c4a7a293ec`, tree `3d866cdbde618b7470db25faafe0b0311092ed68`. A temporary local integration checkout combined the runtime stack with independent analytics and CI changes. No PR was merged into main and nothing was deployed.

Audited integration: `6e7fbd7c73735ab740d1bc902a25baad98fdc172`, tree `57321984ae525b74b167ddff3f8d419b82257909`. This is **not byte-for-byte tree equality**. Every difference is enumerated below; all other tracked files match the original exactly. The final SQLite schema matches exactly (146 schema objects), despite the migration split. The audit adds this report and its verification script as two further intentional files.

| Path | Intentional difference |
| --- | --- |
| `docs/runtime-ci-evidence.md` | Part-specific evidence and limitations |
| `docs/runtime-owner-analytics.md` | Part-specific evidence and cleanup limitation |
| `docs/runtime-payment-delivery.md` | Queue/payment review scope and validation |
| `docs/runtime-request-performance.md` | Request evidence and its attribution |
| `docs/runtime-room-lifecycle.md` | Draft lifecycle status and missing proof |
| `packages/studio/lib/scaffold.mjs` | Register separate feature migrations |
| `packages/studio/test/office.test.mjs` | Expect the separately owned migrations |
| `packages/studio/test/owner-analytics.test.mjs` | Move the two analytics regressions to the independent PR |
| `packages/studio/test/round-two.test.mjs` | Remove those two relocated regressions |
| `packages/studio/worker/analytics.mjs` | Export the analytics migration text and filename |
| `packages/studio/worker/build-id.mjs` | Recompute identity after migration exports change runtime bytes |
| `packages/studio/worker/operational-schema.mjs` | Separate payment and room-summary migration ownership |
| `template/site/migrations/0034_runtime_indexes.sql` | Retain only the MCP expiry index |
| `template/site/migrations/0035_payment_delivery.sql` | Stripe intake and shop-event retention indexes from original 0034 |
| `template/site/migrations/0036_lobby_summaries.sql` | Room summaries from original 0034 |
| `template/site/migrations/0037_owner_analytics.sql` | Analytics watermarks from original 0034 |
| `docs/runtime-split-parity.md` | This audit report |
| `scripts/verify-runtime-split.mjs` | Reproducible parity/schema audit |

Reproduce after fetching the original and audit branches:

```sh
git fetch origin runtime-best-practice runtime/split-parity
node scripts/verify-runtime-split.mjs c4fc93ba origin/runtime/split-parity
```

The local combination resolves overlapping changelog/configuration edits to include all six parts. It preserves the original combined runtime code and generated configuration, registers the independently owned migrations, relocates the two analytics tests, and regenerates the content-derived build identity. This demonstrates split parity, not completion of the draft lifecycle work. Gate/server-room hibernation, active-round-only ticking, real eviction/continuation proof and adequately sampled cold-seat measurements remain open. No such proof is inferred from parity or from the original admission samples.
