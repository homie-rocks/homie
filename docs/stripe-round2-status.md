# Stripe review round 2 — NOT READY

No merge, deploy, live-mode use or real managed-key mint was performed.
The named CLI sandbox account was checked against its expected suffix. A real
`payment_intent.succeeded` trigger reached a loopback listener and passed signature
and test-mode checks. This is not Worker-key Checkout acceptance.

| Review item | Changes and proof | Still required |
| --- | --- | --- |
| 1 | Remote callback exchanges identity but does not mint. Loopback account display and local POST precede `/confirm`, which requires collect capability plus a one-use confirm value. State/URL removed from events. Origin proof authenticates `/start`; persistent replay and per-origin rate limits added. Tests failed before fixes. | End-to-end real App browser approval. |
| 2 | Checkout, invoice, subscription and PaymentIntent notifications cause provider reads; `paid()` retrieves Checkout independently. Forged signed paid notification leaves the real order unpaid with no entitlement. Worker creates/stores its webhook secret; service no longer handles it. Dedicated App Worker and dedicated setup DB configuration; default App manifest is mint-only with explicit mirrored permission variant. | Stripe must confirm minted permission ceiling and `webhook_write`. Provision dedicated DB ID later; nothing deployed. |
| 3 | `purchase-links-v1` accepts only persisted payment/subscription ownership, including derived order IDs. SQLite regression rejects an unrelated order. Pending purchase link sessions retain a provider-verified compatibility path. | Regression uses a constructed SQLite fixture, NOT the requested real 0.53 database export. Full renewal acceptance remains open. |
| 4 | Checkout key/deploy/bootstrap precede cutover. Open link sessions expire; asynchronous complete/unpaid sessions no longer count as open. Drain is scoped by deactivation time, uses a cursor and >=30-second polling/cache. New hook excluded from retirement. | Full shop link-era async compatibility, real migration fixture, deployment bootstrap for old Workers lacking the origin-proof route, crash/retry and long-running OAuth refresh coverage. Not an atomic-cutover release claim. |
| 5 | `payment_intent_write` and `plan_read` added. Only 401 or `api_key_expired` marks reconnect; 403 does not close the shop. Tests failed before fixes. | Exhaustive Worker-call/permission contract, including optional Business Profiles and crypto capability probes. |
| 6 | `--renew` invalidates local pending approval. Existing lifecycle notification recording remains. | Superseded/failure/disconnect/acceptance-key expiry and actual rotation handling are NOT implemented. Release blocker. |
| 7 | OAuth developer secret is separate from restricted IAM credential. v1 migration uses OAuth token and Stripe-Context. Test plaintext tokens are encrypted locally by service before delivery; live still requires Stripe ciphertext. Both documented RSA-OAEP variants accepted. | Real code exchange, protected-header recording, shared recorded fixtures, verified expire/rotate schemas and full acceptance-script cleanup. Do not run the old managed-key acceptance script yet. |
| 8 | Origin-proof bypass removed; free-only readiness fixed; `/drained` failure saves failed; decrypted private key removed from disk; stale pending/temp files cleaned. Tests cover proof/readiness/drain failure. | Retry after key decryption now needs fresh approval; safe abandoned-key expiry depends on item 6. |
| 9 | Named dead no-key subscription/payment paths, obsolete webhook wrappers, LINKS_STRIPE_VERSION, payment_link exclusion and needs-keyed-recovery removed. Changelog no longer claims proven full migration preservation. | Wider compatibility review remains necessary. |
| 10 | Authorized profile pinned in acceptance and adapter. CLI sandbox signature smoke passed. Hidden-input owner wrapper prepared, not run. | Owner-run Worker-key acceptance and preview managed-key acceptance. |

Targeted tests: stripe-round2, stripe-app-connect, shop-subscriptions; selected
shop tests covering signed fulfilment, refunds, tax, free lines, references,
deposits, late payments and forged notifications. Box: stripe-app-service.
Synthetic fixtures are not labelled recorded Stripe responses.

## Exact questions for Stripe

1. For an App whose manifest and developer Connect credential grant only
   `api_key_write`, can `POST /v2/iam/api_keys` mint a key with
   `checkout_session_write`, `payment_intent_write`, `charge_write`,
   `dispute_read`, `subscription_write`, `invoice_read`,
   `customer_portal_write`, `product_read`, `plan_read`, and `webhook_write`
   that the App itself does not hold? If not, what is the exact permission ceiling?
2. Can a minted secret/restricted key create its own v1 webhook endpoint with
   `webhook_write`? Are there App-specific restrictions or a supported endpoint
   response that encrypts its signing secret directly to the owner's RSA key?
3. Please provide the enabled preview OpenAPI schemas and examples for API-key
   expire and rotate (paths, request fields, idempotency, immediate-expiry
   semantics, rotated-key delivery and lifecycle event payloads). The public
   linked reference and available MCP search did not expose these schemas.
4. Is the encrypted secret JWE `alg` RSA-OAEP or RSA-OAEP-256? The guide's prose
   and Node sample differ. What is the exact sandbox plaintext-token response
   schema, and can sandbox encryption be explicitly requested?
5. What managed-key permission names cover v2 Network Business Profiles and
   Crypto Deposit Addresses, and which permission covers invoice payment reads?

References checked 2026-10-15:
- https://docs.stripe.com/stripe-apps/api-authentication/managed-api-keys
- https://docs.stripe.com/keys/managed-api-keys
- https://docs.stripe.com/stripe-apps/api-authentication/oauth
- https://docs.stripe.com/stripe-apps/reference/permissions
- https://docs.stripe.com/checkout/fulfillment

## Owner's sandbox command

From this worktree:

```sh
python3 packages/studio/test/run-checkout-sandbox.py
```

Paste a **sandbox restricted key** at the hidden prompt. It travels to the test
through an anonymous stdin pipe; the wrapper discards raw errors/output and
prints only fixed-format PASS lines and the final result. No key file or shell
argument is used. This command has NOT been run.

Use the standard Worker permissions: Checkout Sessions **Write**, PaymentIntents
**Write**, Charges and Refunds **Write**, Disputes **Read**, Subscriptions **Write**,
Invoices **Read**, Customer Portal **Write**, Products **Read**, Prices **Read**,
Webhooks **Write**. The CLI supplies the forwarding secret for this local test;
Webhooks Write is needed for the deployed Worker bootstrap. No API Keys,
Payment Links, transfers, payouts or balance permissions.
