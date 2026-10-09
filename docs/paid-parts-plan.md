# Paid purchases on the studio's own service

A buyer's agent asks the selling studio for a resource, pays with the buyer's own wallet,
and receives the files, a payment receipt and signed purchase evidence in the exchange.
The studio receives the money in its own Stripe balance. Homie is not a payment intermediary.
A part is the first resource type. Offers and order state are independent of game metadata.

## Release refit, 2026-10-08

The current setup and credential table are in [PARTS.md](../packages/studio/parts/PARTS.md). Main's one-approval keyless shop is the default: Payment Links, signed snapshots and no Stripe API key in the Worker. The older keyed machine-payment research below describes the optional fuller connection. Parts now accept arbitrary kind labels, with app/music/video suggestions; `from.game` is unchanged and `{kind,id,studio}` describes other source work. This deliberately does not generalize the studio's build framework.

The local approval intent no longer borrows Stripe's Session lifetime bounds, refund windows may be fractional, scope is seller text, recurring day/week intervals are supported, and Turnstile is optional. Provider constraints and file/proof safety checks remain. Main's released changelog sections stay unchanged.

## Payment decisions

| Case | Built route | Reason and source |
| --- | --- | --- |
| One-time USD price known before payment | MPP with Stripe shared payment tokens | Stripe's [MPP guide](https://docs.stripe.com/payments/machine/mpp) documents the charge exchange. The pinned mppx library creates and verifies the standard challenges and receipts. |
| Studio enabled stablecoins | x402 exact on Base (Tempo disabled) | [Stripe's x402 guide](https://docs.stripe.com/payments/machine/x402) documents its deposit address and transaction-verification PaymentIntent. Connect reads an existing account deposit address; live Base needs the studio’s CDP credentials. |
| MCP buyer | MPP JSON-RPC transport | The [Cloudflare guide](https://developers.cloudflare.com/agents/tools/payments/mpp/accept-payments/) and mppx transport specify payment challenges and receipt metadata. The endpoint uses the official MCP SDK and Transport.mcpSdk(). |
| No compatible agent wallet, recurring purchase, non-USD offer or final tax calculation required | Stripe Checkout Session | Stripe documents charge, not a dependable recurring integration, in its MPP guide. The adapter only offers currencies its Stripe method supports. Checkout calculates tax and presents its final total. |
| Seller selects Managed Payments | Checkout only | Stripe's [setup](https://docs.stripe.com/payments/managed-payments/set-up) supports Checkout and Payment Links, not the PaymentIntent integration used for machine payments. Machine payments explicitly use the studio as seller. |

`PURCHASE_MACHINE_PAYMENTS` contains separate `test` and `live` settings: `profile`, optional
`base` deposit addresses. Addresses are provisioned in the
studio's Stripe account, fetched by shop connect. `CDP_API_KEY_ID` and
`CDP_API_KEY_SECRET` authenticate the studio's facilitator. Stripe gates stablecoin access;
configuration does not assert account eligibility. No Connect account or project service is involved.

The current SDK needs Node compatibility; Wrangler 4.145.0’s local dry run bundles the
Worker successfully.

The pinned mppx version requires a shared atomic store for Stripe-backed stablecoins. Its
store uses D1 compare-and-swap, with mode-prefixed keys and unique revisions, not isolate
memory or eventually consistent KV. Challenges bind the order and quote. A recorded payment
is reused on retry. The same claim cannot silently acquire a different resource or price.
The Stripe library owns preview API headers rather than duplicating its protocol implementation.

The buyer chooses an installed `link-cli` or `purl` with `HOMIE_PARTS_WALLET` or the `wallet` argument on `part_add`.
The toolkit invokes that open client without a shell. It does not store cards, create wallet
keys, transfer balances itself or replace wallet limits. [Link's own client](https://github.com/stripe/link-cli)
currently requires approval for each card spend in the person's wallet. That is a wallet
approval, not a seller checkout page. A funded crypto wallet can spend within its existing
authority. The adapter also passes the approved price to the wallet’s own request ceiling:
[purl max-amount](https://github.com/stripe/purl/blob/main/cli/src/cli.rs) in USDC atomic units,
restricted to Base. Link requires an exact challenge amount match. The exact quote and licence are presented before requesting either kind of spend.

## Offers, orders, entitlements and receipts

A resource descriptor has a kind, identity, release and manifest digest. An offer combines
that descriptor with all sale terms. Its version is the SHA-256 digest of canonical JSON.
Any changed price or term creates a different offer version. Accepted versions are stored
immutably in the seller database. Orders identify their buyer and exact offer version.
Entitlements copy that offer's resource and terms; they never read today's sale settings.

For a part, `part.json.sale` supplies release terms. `parts/offers.json` contains only an
optional `price` override and availability/extra-upgrade choices. `parts offer --amount`
changes the persistent price override. All other terms change through a new part release.
This explicitly chooses a price-only seller override, avoiding two competing term records.
A build reads source and emits versioned offers; it never writes the source configuration.
A packed manifest's sale is its historical default, while the listing's `offer` is what is
currently sold. Quotes hash the manifest, full offer, quantity and game together.

`purchase_orders` is the only persisted purchase lifecycle record. Player purchases remain
in `shop_orders`; the office combines both at read time. Offer version, accepted terms,
transport, payment, subscription and fulfillment time belong to the purchase row. Immutable
resource snapshots, grants, invoice facts, settlement intents and retry jobs have separate
purpose-specific tables; none duplicates order state. `purchase-core.mjs` is the sole order
state writer, applying provider facts through the transition graph. Replay storage holds
protocol data, never a second order. Tests enumerate all 81 state pairs.

| From | Allowed next states | Evidence |
| --- | --- | --- |
| started | paid, refunded, expired, failed, lapsed | Provider payment, prior refund, expiry or failed attempt |
| paid | fulfilled, refunded, disputed, lapsed, lost | Issued entitlement, refund, dispute or access expiry |
| fulfilled | refunded, disputed, lapsed, lost | Provider refund, dispute or access expiry |
| disputed | paid, fulfilled, refunded, lapsed, lost | Provider resolution; warning_closed restores paid rights |
| lapsed | paid, refunded, disputed | Later paid subscription period or delayed provider resolution |
| expired, failed, lost | paid, refunded | Verified delayed provider outcome |
| refunded | paid only for a different paid subscription invoice | A new provider-confirmed billing period; otherwise terminal |

Identical-state retries are idempotent. Expiry cannot revoke an accepted payment; repeated
payment facts preserve fulfillment and disputes. The first PaymentIntent is retained, and
additional successful charges are recorded and automatically refunded.

`resource-kinds.mjs` composes resource adapters with eight methods: list offers, get a release,
quote, read terms, validate a release, return its terms URL, read a file, and decide update
coverage. `parts-resource.mjs` implements these for parts. Generic purchase routes, state,
reconciliation, delivery, token types and provider metadata contain no resource-specific names.
A guide adapter test uses the same discovery, official MPP client, receipt, grant and refund
flow with no part storage. The public parts catalogue, protected-file route and installation
client remain resource-specific consumers of this core.

The unshipped migrations are `0013_purchases.sql` and `0014_purchase_facts.sql`; no legacy
purchase tables or compatibility routes remain. Purchase endpoints live under `/api/purchases`,
with payable URLs `/api/purchases/resource/<kind>/<id>/<version>/<claimHash>`, hosted pages at
`/purchases/<order>`, and signing keys at `/purchases/keys.json`. Tokens use
`homie-purchase-grant+jwt` and `homie-purchase-proof+jwt` with `kind` and `resource` claims;
Stripe metadata identifies `purchase-v1`. Machine configuration and signing secrets use
`PURCHASE_*` names. These names require a fresh deployment of the unshipped migration set.

Completion checks the provider's order, buyer, amount, currency and mode against the purchase.
It never rereads the current offer to decide whether an already completed payment deserves
fulfilment. Withdrawal expires open Checkout Sessions. If payment wins that race, the order
is honored. Retirement cancels future subscription billing while keeping the paid period.
Asset read errors are retryable, never permanent invalidation markers.

Only the selling Worker enables Node compatibility for the protocol library’s standard utility imports;
non-selling studios make no new network calls or storage reads.

One-time access refreshes the PaymentIntent and latest charge on grant; subscriptions refresh
the paid invoice and its payments. Refund/dispute webhooks ask the same reconciliation code
for current facts. Webhook ordering is not a source of truth. A grant carries that decision
for five minutes, avoiding three Stripe reads per protected file. Database revocations and
claim reissue still invalidate a credential immediately. Provider changes with no webhook
are observed at the next grant, at most five minutes after an already issued grant.

Checkout uses Stripe's default session expiry rather than sending a timestamp at its
30-minute minimum. `intentMinutes` (any positive finite duration) controls the pre-Checkout approval intent.
The create call keeps a stable order idempotency key and stable parameters through retries.
Refunds use identical payment-only parameters across buyer and owner paths; the provider is
checked before retry. A full-payment refund uses a stable key per PaymentIntent. A successful
refund precedes cancellation, and a pending or failed refund never cancels billing.
Portal sessions have no idempotency key because each request needs a fresh URL.

## Description and evidence decisions

- Discovery starts at the registered `/.well-known/api-catalog`, using the Linkset media
  type and profile from [RFC 9727](https://www.rfc-editor.org/rfc/rfc9727.html). It links the
  catalogue, purchase endpoints and seller key set. No new well-known name is claimed.
  Old catalogue aliases remain for existing free-part clients.
- Public pages and catalogue entries carry schema.org Product and Offer objects, with
  price, ISO currency, availability and the public page URL. These describe the actual
  current offer. A preview image is included when present; no rating or image is invented
  to claim search eligibility. [Offer vocabulary](https://schema.org/Offer).
- Licences remain SPDX expressions. Custom texts are shipped under
  `LICENSES/LicenseRef-*.txt` and REUSE annotations accompany the files, following
  [REUSE 3.3](https://reuse.software/spec-3.3/). Structured terms do not replace licence text.
- New proofs use JWS with `alg: Ed25519`, explicit proof/download `typ`, issuer, audience,
  subject and purchase identity. Keys use RFC 7638 thumbprint identifiers. The public key
  set is at `/purchases/keys.json`. [RFC 9864](https://www.rfc-editor.org/rfc/rfc9864.html)
  supplies the fully specified algorithm; [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html)
  supplies explicit typing. Selective disclosure and VC presentation flows add no benefit
  to this seller-bound proof, so no credential ecosystem is required.
- Long-lived purchase evidence cannot download. Download credentials expire in five minutes.
  Errors use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html).

## Storage, abuse and upgrades

Paid files remain private, addressed by their content digest in the studio's R2 bucket.
Only explicit previews and licence text are public. Uploads are read back and verified
before an offer can deploy. The machine exchange checks files before requesting money.
The buyer verifies every file and the seller's proof before installing anything.

Cloudflare rate limiting protects purchase routes. Human fallback acceptance also requires
Turnstile with the expected hostname and action. Machine routes use signed payment
credentials instead of making agents solve a human challenge. Binding configuration is
added only for studios with paid releases. Limits are technical abuse defaults, not spending
policy; the studio owns its Worker configuration.

`shop connect` records verified subscription/invoice reads and required webhook events,
bound to the installed key digest and mode. Without that record recurring intents refuse
before taking money and the office reports the missing setup. Older player shops still work.
Test and live are separate worlds; a public test payment cannot fetch real protected files
without owner approval of that exact claim. One Worker has one Stripe key/mode at a time.
Never reconnect a test key on a live shop; use a second studio for tests.

Managed Payments can initiate refunds and accept disputes; its data-deletion flow cancels
subscriptions. The provider’s [published behavior](https://docs.stripe.com/payments/managed-payments/how-it-works)
is why reconciliation observes provider facts, not only actions initiated by this toolkit.

The operational settings, recovery procedure and licence rules have one home in
[the parts guide](../packages/studio/parts/PARTS.md). There is no project-run service on
purchase, delivery, verification, update, refund or recovery paths. The optional catalogue
can disappear without blocking a direct seller reference. Seller loss still prevents first
or future downloads; an already verified private backup restores offline under its terms.

## Verification boundary

The local scripted agent uses the upstream MPP client with a local wallet-token double.
With all hosts except seller and payment provider blocked, it discovers, pays, receives
files and verified proof, updates, recovers its claim and receives a refund. The buyer uses
the files in that exchange instead of downloading them again.

Tests use the pinned protocol libraries, genuine locally signed wallet payloads, a local
facilitator and Stripe doubles. The reviewer suites are repository tests. Live account
eligibility, card authorization, stablecoin settlement, fee sponsorship, Managed Payments
acceptance and actual restricted-key permissions require an enabled Stripe account.
The installed CLI refused anonymous sandbox creation without an email address; no real
credentials were used or requested. These local tests do not claim to prove real settlement.


## Recovery decisions

Recovery reads existing Stripe objects before acting. An object id uses a direct GET; otherwise
it pages the PaymentIntent list by creation time and matches immutable order metadata. A failed
read is unknown, never evidence that a charge failed. Orders with provider jobs are retained.

| State | What was read from the provider | Action |
| --- | --- | --- |
| Any previously delivered order | Paid or no new fact | Preserve delivery; finish its recording |
| Refunded, disputed, lapsed, lost | Any | Preserve the entitlement policy |
| Unresolved card order | Succeeded, matching mode, amount and currency | Record payment; make files deliverable |
| Paid order | Succeeded; storage missing or unreadable | Retain payment; retry storage; owner can refund |
| Submitted card order | Canceled or requires_payment_method | End the attempt and release the claim; retain the order |
| Submitted card order, younger than 23 hours | Complete list contains no object | Replay only the same idempotent request |
| Submitted card order, at least 23 hours | Complete list contains no object | Release the claim; retain the order for webhooks |
| Submitted card order | Read failed, including authentication or permissions | Retain lock, error and identifiers; retry next scheduled run and on owner/buyer request |
| Processing | Existing object still processing | Keep reading; never create a new charge |
| Chain settled | Stripe recording unavailable | Chain evidence remains payment; preserve delivery and expose manual refund evidence |
| Duplicate payment | Existing extra succeeded object | Refund only the duplicate, with its own idempotent key |

A card_error response proves that card attempt failed; authentication, permission and idempotency
errors prove nothing about the original charge. After 23 hours no charge request is replayed.
Manual review remains pending and readable, never terminal. Recovery uses the same job policies
for scheduling, buyer locks and office visibility. A buyer decline cannot disable an account rail.

## Refunds when Stripe cannot record a transfer

Base is off until the seller explicitly accepts manual refund responsibility on the
connect page. Live mode also needs both CDP credentials. Stripe deposit addresses
are provider-controlled; this toolkit has no private key that can reverse their transfers.
A settled but unrecorded purchase is shown with the exact payer, network, token, atomic
amount and transaction. Missing files keep the payment intact and tell the buyer to
request restoration or a manual refund. A completed sale remains completed.

The owner sends the refund from their own Base wallet to the original payer, using the
reported token and amount, then runs `shop refund <order> --manual-transaction <hash>`.
The owner confirms the office action. The server verifies the successful receipt and
exact transfer, rejects the original payment as refund evidence, and stores the refund
transaction uniquely before marking the order refunded. A transaction cannot clear two
orders. This path spends no funds through the toolkit.

## Setup and request path

Only a studio with paid releases gets extra permission instructions. Connect reads configuration and writes the profile, capability record, addresses and
secrets. Turnstile keys (`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET`) and CDP keys
(`CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`) have paired inputs on that page. Blank fields
preserve existing secrets. Local public configuration preserves both modes and custom
RPC/fee-payer settings across reconnects. Tempo remains disabled.

Challenges and public discovery use local capability records. They do not create,
cancel or list Stripe objects. Office readiness reads local facts and a dry challenge.
Scheduled checks read provider configuration at most four successful checks per day and
retry failures with backoff. Real account refusals invalidate readiness for a fresh read;
a card decline never disables an account rail. Sandbox checks are read-only too: no synthetic
sale is created, so there is no test sale or refund in the owner's totals. Machine and hosted
readiness are independent. The hosted
route and its report share checks for the database, limiter, valid signing and Stripe
keys, webhook, selected till, Turnstile and recurring permissions.

Offers, receipts and test approvals are dedicated migrated records. Resource adapters
validate quantity and scope. HTTP and MCP both stream file bytes, including repeat
purchases. Dry exchanges remove unused snapshots and offers. A wallet refusal retains
the buyer's original machine claim: retry the corrected wallet, or explicitly choose
hosted Checkout by omitting the wallet. Unsupported offers publish the fallback URL
and accept the same public offerVersion.

## Validation and deployment limits

Studio 0.33.0 / plugin 0.34.0 remain unreleased. Both entries use one implementation
of the shop, office, pages, parts and room runtime. The selling entry installs only payment
adapters and its scheduled handler. The ordinary bundle has no payment SDK, Node compatibility
flag, scheduled handler or purchase rate limiter. The shared privacy checks and shop corrections
change its bytes; exact equality with main is not claimed.

Wrangler 4.145.0 `deploy --dry-run`, unminified as actually uploaded:

| Entry | Upload KiB | Gzip KiB | Local Node startup CPU ms, three runs |
| --- | ---: | ---: | --- |
| Latest main | 2182.48 | 519.13 | 26.2, 34.6, 29.6 |
| Ordinary entry | 2201.22 | 524.05 | 27.4, 22.0, 20.9 |
| Selling entry | 8648.89 | 1643.10 | 101.1, 120.9, 128.4 |

These are local upload and Node measurements, not Workers CPU measurements. Real purchase
and cron CPU, D1 concurrency, Turnstile, restricted-key permissions and funded settlement
still require a provider account and an authorized test deployment. No project-run host is
part of discovery, purchase, delivery, proof, refund or recovery.

Provider references checked for this implementation:

- [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests): parameter equality and retention window.
- [Stripe error handling](https://docs.stripe.com/error-handling?lang=node) and installed Stripe 23.0.0 error types: statusCode.
- [Stripe MPP](https://docs.stripe.com/payments/machine/mpp): sandbox detection and deposit calls outside the core request path.
- [Stripe x402](https://docs.stripe.com/payments/machine/x402): Base live 8453, Base Sepolia test 84532 and the sandbox facilitator.
- [Stripe sandbox SPTs](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens?agent-seller=seller): granted-token helper.
- [Wrangler module aliases](https://developers.cloudflare.com/workers/wrangler/configuration/#module-aliasing): select the selling entry at build time.

Base token identifiers come from [Circle's USDC contract table](https://developers.circle.com/stablecoins/usdc-contract-addresses):
mainnet 8453 uses `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; Sepolia 84532 uses
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`. The official x402 client route tests
exercise each mode with its corresponding identifier; these addresses are never mixed.
