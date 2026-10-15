# Selling setup proof

Based on main 0.51.6 (`3600632d`), preserving the released baskets and needs checks. No version change, deployment or merge.

## Traffic

Run `node packages/studio/test/selling-cost.mjs`. This uses the released 0.51.5 planner (`b44eb52e`) and the new planner against the same offline Stripe fixture: eight fixed-price items and one menu, initially empty account. Bytes count UTF-8 JSON arguments and responses, excluding MCP protocol envelopes. No live Stripe calls occur in this benchmark.

| Measurement | Before | After |
|---|---:|---:|
| Stripe operations | 264 | 19 |
| Stripe request/response bytes | 298,099 | 25,956 |
| Homie planner calls | 265 | 5 |
| Homie planner argument/result bytes | 1,782,371 | 84,873 |
| Combined MCP calls | 529 | 24 |
| Combined bytes | 2,080,470 | 110,829 |
| Writes | 33 | 17 |

An account containing other shops makes the old full-list flow more expensive. The new planner requests only metadata-scoped Product/Price Search and known studio link/portal IDs. Stripe has no Payment Link metadata search; the compact verified configuration preserves those IDs. Read and write responses remain observations throughout one setup, with real returned IDs resolving each dependency batch.

## Real Stripe sandbox

Run manually, only when authorized: `node packages/studio/test/selling-sandbox-acceptance.mjs --run`.

The sole CLI profile is **Homie sandbox**, standing in for official MCP API calls. The run created eight Products with default Prices and nine Payment Links, verified their expanded real fields, and saved 5,617 bytes of public configuration. It made 19 catalog operations carrying 56,933 bytes and used five planner calls. Verification is an additional local call and makes no Stripe request. Account identity and private webhook installation are excluded from catalog traffic.

The generated deploy bindings installed all links: the real readiness code reported only `webhook-secret`. The private installer created a real sandbox endpoint, captured its signing secret inside the process, and passed it exclusively to the Wrangler stdin interface. After installing that private payload in-process, readiness reported ready. Its public result contained no secret. The endpoint was deleted and the links deactivated afterward.

**Scope:** the Wrangler adapter captured stdin in-process; no remote Wrangler secret was changed, no Worker was deployed, and no payment or card entry was performed. Actual Cloudflare secret transport is covered by the existing installer contract tests. This proves the real Stripe creation response and private transport boundary, not a new production deployment or a completed payment.

## Webhook research, 2026-10-14

Read with Stripe's official CLI documentation commands:

- [MCP](https://docs.stripe.com/mcp): official OAuth/plugin API access, without a documented credential export or private secret handoff to Wrangler.
- [Create event destination](https://docs.stripe.com/api/v2/core/event-destinations/create): the create response must explicitly include `webhook_endpoint.signing_secret`; public API clients cannot retrieve it later.
- [Webhooks](https://docs.stripe.com/webhooks): snapshot and thin destinations still require signature verification; thin event details require authenticated retrieval.
- [Create product](https://docs.stripe.com/api/products/create): `default_price_data` supports fixed, recurring and custom amounts, metadata and expansion.
- [List Payment Links](https://docs.stripe.com/api/payment_links/list): no metadata or product filter/search.

No documented option meets the secret-free MCP-to-Worker handoff requirements. The guided flow therefore starts Homie's `stripe_webhook`, requires one separate Stripe CLI browser approval when no matching profile is connected, and completes privately. The owner never supplies an API key, and Homie is never in the payment path.

## Behavioral regressions

- The initial batch test failed with one Product operation instead of three. It now batches independent writes, retains partial successful batches, folds in default Prices, checks baskets, rejects drift, scopes discovery, and keeps persisted configuration small.
- The deploy-binding test failed with no installed links. Generated Worker configuration now carries verified links; changing shop.json invalidates it. The public checkout test failed with no next step and now reports exactly the missing webhook step.
- Existing webhook tests already proved secret-only Wrangler stdin and account mismatch rejection. The real sandbox proof exercises that path against Stripe; no unsupported keyless secret handoff was invented.
- The staff-run test failed authorization before the change. Studio-wide staff now read run history and lose access on revocation; per-app staff remain isolated. The OAuth/workerd integration reads a failed run and next due over `/mcp/auth`.
- The deploy test failed with no listing state. A claimed studio with no listing receipt returns `claimed, not listed`.
- The record test failed with no selected role. Create and read now use staff by default and report it, while an explicit customer role retains its limited permissions.
- The screenshot test failed with an outside absolute path. Saved needs evidence now copies it into the studio and keeps a relative path.

Targeted validation: shop planner, shop runtime, function runtime/CLI, studio MCP unit and OAuth/workerd integration, needs operations/evidence, and the deploy route fixture. All new automated tests use fixtures; the sandbox script is deliberately outside `*.test.mjs` discovery.
