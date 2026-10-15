# PR #140 regression and performance evidence

Round two starts at `66665d18`. Package/plugin versions stay at 0.53.0;
`build-id.mjs` is regenerated from package.json and the runtime source hash.
No merge or production deployment. No new browser tests.

## Corrections and proof

Each regression was run failing before its fix. New coverage is in
`packages/studio/test/round-two.test.mjs`, with payment cases in
`keyless-earning.test.mjs` and `shop-mcp.test.mjs`.

| Review item | Change and evidence |
| --- | --- |
| 1 | Effective-launch invite pass tickets; cookie-free OAuth owner and scoped test identities. Pass revocation, private launch rejection, connection revocation, and private-page rendering tests. |
| 2 | Removed the stray catalogue-cache write from `pushEvents`; configured-feed subscription wake completes. Real workerd MCP resource notifications pass. |
| 3 | Single-item Stripe links and signed fulfillment enforce maxQuantity. Published link maxima are saved; legacy menu snapshots can exceed 99 up to their published maximum. Stripe-plan and signed-webhook tests. |
| 4 | Missing/unknown references and currency mismatches create durable payment-review rows and attention orders for owned links. No entitlement or order.paid event; review replay remains review. |
| 5 | Per-namespace tool revisions, recorded app dependencies, selective app wakes, and no authorization on idle wakes. Namespace-isolation unit test and real two-client live-stream test. |
| 6 | Stable D1 binding caches with a trigger-maintained metadata revision. One revision read per warm request; tables load independently. Cache-hit, invalidation, request-budget tests and populated deployed comparison below. |
| 7 | One SQL statement validates the session/pass/connection, grants and role-link fingerprint for an asset ticket; counted by the regression test. |
| 8 | Pending needs report ok:false, pending:true, exitCode:0. Actual unmet assertions retain exitCode:1. Guide placeholders stay unproved without failing unrelated build work. |
| 9 | Ordinary requests refresh the cached tool catalogue after deployment, without requiring a cron or office POST. First-GET test. |
| 10 | Asset payloads are encrypted and HMAC-authenticated; database session hashes are not exposed. Opaque-payload and existing revocation tests. |
| 11 | Big screen carries role only; a five-minute HttpOnly, Secure, SameSite=Strict cookie provides the handoff. Role binding, logout and asset/test-ticket purpose separation tests. |
| 12 | Nested and later-registered background work receives delivery; D1 withSession/getBookmark passthrough and raw-write mutation tracking. Unit and workerd delivery tests. |
| 13 | Removed 7,058 raw proof-JSON lines; Big screen test executes rendered page behavior, not source slices. Generated runtime identity check passes without a version bump. |

Targeted local runs: 94 app/payment/request tests, 66 check/play tests, four migration
cases, and 24 final background/request/regression cases passed. MCP event-resource,
MCP request-budget and two-client app-live workerd tests passed. The app-live test
initially exceeded its 30-second timeout on the busy machine and passed alone in
1.7 seconds. Seven payment cases passed again after the final replay guard; six
changelog tests, generated identity and migration/template equality checks passed.

## Populated deployed comparison

Two isolated Workers with D1 and SQLite Durable Objects, static catalogue, one app
and one browser-hosted game. Both databases held **500 office_games, 1,500 servers,
and 1,000 chat_rules rows**; `seed.sql` reproduces the synthetic data. No production
data, Stripe setup, R2 or KV. Baseline is round-one head `66665d18`.

25 samples per route/version after three warm-up rounds, alternating order, consuming
bodies, persistent connections pinned to one IP with hostname/TLS checks retained.
All 250 measured responses in the primary pass were HTTP 200 and reached **PDX**.
Medians (TTFB, milliseconds):

| Route | Before | After |
| --- | ---: | ---: |
| Page | 175.65 | 117.20 |
| Static asset | 56.27 | 58.94 |
| Records | 131.57 | 97.50 |
| MCP initialize | 59.30 | 65.20 |
| Room seat | 239.27 | 162.33 |

The primary after deployment was `1a36a884-f217-435a-b9bd-351bb64a08eb`, containing
the revised metadata cache. Subsequent authorization/handoff and late-background
fixes were locally tested. A repeat against final deployment
`e24a9508-3f42-4d72-a022-29e3504c6300` reached BOS for before and PDX for after, so
its latency comparison is excluded. Thus these numbers demonstrate the cache change,
not an uncontaminated latency measurement of the final commit. Network and shared
machine noise remain; static assets and MCP did not improve in the comparable pass.
Raw runs and logs remain outside the repository at `/tmp/hm-speed-0540-r2/`.
`measure.mjs` now writes raw data outside the repository by default.

Created and deleted on 2026-10-15:

- `hm-speed-0540-r2-before`; D1 `9dfbc8b5-cc87-4bfe-aa65-b131872e7d60`.
- `hm-speed-0540-r2-after`; D1 `7cb72563-d640-4333-b3ae-9c0b3d629f2d`.

Wrangler confirmed both Worker and both database deletions. Each Worker's Table,
Lobby, Gate and Concentrator namespaces belonged only to that throwaway Worker.
