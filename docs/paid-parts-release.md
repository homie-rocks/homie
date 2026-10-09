# Paid parts release check — 2026-10-09

Studio 0.36.0 / plugin 0.37.0, [PR #70](https://github.com/homie-rocks/homie/pull/70).
Based on main `50877e83213b0287e3b984e65321bec436285b48` (studio 0.35.1).
The original 15 commits are saved locally on `paid-parts-history-before-main-20261008`.
They were squashed before rebasing; main's shop, cart, rule-game detection and keyless setup remain in place. Main advanced during verification, so its 0.35.1 tip setup and masked Stripe error fixes were incorporated before the final suite.

## What the owner and buyer do

For a deployed studio with a Stripe account, the normal owner workflow has **two human actions**:

1. Tell the AI what to sell, its price and its licence, including any venue or other use rights.
2. Approve Stripe's official CLI connection in the browser if needed. An existing authorization removes this action.

The AI packages and publishes immutable files, configures private storage, creates the Product, Price, Payment Link and webhook in the owner's account, and privately installs the signing secrets. New-account onboarding, provider verification and Cloudflare authorization can add provider-controlled prompts. There is no fixed promise about their count.

The buyer's AI:

1. Finds the part's public catalogue, follows `/.well-known/api-catalog` and its OpenAPI/MCP links, and reads the price and full licence.
2. Gets the buyer's approval for that quote or uses the buyer's existing wallet authority. It creates a private purchase claim.
3. Pays using MPP Stripe tokens, x402 Base or MPP over MCP. The wallet can require its own approval; no seller checkout page is needed by these exchanges.
4. Verifies the signed proof and file hashes, installs the files and keeps the receipt and recovery claim. A lost response retries that same claim; another purchase uses a new claim.
5. Uses the hosted fallback when a protocol cannot cover the offer. The person accepts the licence and pays on Stripe; the AI retrieves the files after the signed webhook.

homie.rocks is a discovery directory, never a payment intermediary. The seller's own account receives the money; the buyer can purchase directly while the directory is unavailable.

## Credentials and supported boundaries

| Path | Stripe API credential in Worker | Why |
| --- | --- | --- |
| Payment Link hosted fallback, including recurring offers | No | Setup uses the owner's official CLI authorization; signed checkout, invoice-payment and refund events supply facts. |
| MPP with Stripe shared payment tokens | Yes | Stripe's PaymentIntent charge API is authenticated. |
| MPP over MCP | Yes | Same authenticated Stripe method, with MCP's challenge/receipt binding. |
| x402 Base recorded into Stripe | Yes | Facilitator settlement is followed by Stripe's authenticated transaction-verification PaymentIntent. Live CDP credentials are also needed. |
| Dynamic Checkout Sessions, direct Worker refunds, provider-read recovery | Yes | These operations call authenticated Stripe APIs. |

Sources: [Stripe MPP](https://docs.stripe.com/payments/machine/mpp), [Stripe x402](https://docs.stripe.com/payments/machine/x402), [signed webhooks](https://docs.stripe.com/webhooks), [invoice payments](https://docs.stripe.com/api/invoice-payment/object), [Stripe keys](https://docs.stripe.com/keys), and the [CLI setup research](stripe-connect-research.md).

The x402 standard itself does not require a Stripe key; the supported Stripe-booked path does. Tempo remains disabled. Machine charges cover one-time USD offers whose final amount is known. Other currencies, recurring offers, final tax calculation and Managed Payments use hosted checkout. The seller can configure any positive quantities in `parts/offers.json` and sync matching Payment Links; the default is one unit. An unconfigured quantity needs a sync or the fuller connection. Keyless refunds happen in Stripe or through the owner's connected AI; missing events need Stripe redelivery.

For the fuller connection, the AI operates the provider's key-creation page and privately transfers its Copy result using `shop connect --from-clipboard`; nobody needs to paste the key. It verifies the credential, installs the webhook and writes secrets on Wrangler stdin, then clears the clipboard. Human sign-in and verification prompts remain the provider's. This was tested with stand-ins, not a real account. No supported public API for minting a persistent Worker credential from the CLI OAuth approval was established.

## Small parts extension and shared shop code

Kinds are lowercase labels chosen by the studio; app, music and video are suggestions. Existing `from.game` works unchanged, and non-game provenance can use `{kind,id,studio}`. The existing file/manifest/licence mechanism carries quiz, menu-board, waitlist, music and video assets. Game extraction remains a game-specific convenience; this does not add an app or media build framework.

Removed restrictions include the kind whitelist, fixed licence-scope list, seat-only quantities, whole-day refund windows, integer renewal grace, Stripe Session bounds on local approval intents, the refund-policy text ceiling and mandatory Turnstile. Stripe's supported recurring intervals include day and week. Safe arithmetic, provider constraints, proof/file validation and configurable flood protection remain.

The selling entry adds resource adapters to main's shop. Webhook verification, event handling, Stripe transport, refund creation, the paginated refund-list reader, keyless money snapshots and the owner office are shared. Immutable resource offers and purchase claims still have their own purchase tables; player cart orders retain main's tables and grant logic. There is no copied selling version of the shop or office. Purchase migrations are 0013 and 0014, after main's 0010–0012.

## Ordinary Worker measurement

Same esbuild, browser platform, ESM bundle, no source maps; main is an archive of the commit above. No selling modules or payment SDKs occur in the ordinary bundle. No extra ordinary compatibility flag or selling cron is added.

| Bundle | Main bytes | Paid-parts bytes | Difference |
| --- | ---: | ---: | ---: |
| Unminified | 2,224,759 | 2,226,461 | +1,702 |
| Unminified gzip | 535,369 | 536,335 | +966 |
| Minified | 1,335,959 | 1,339,347 | +3,388 (3.31 KiB) |
| Minified gzip | 407,776 | 409,132 | +1,356 (1.32 KiB) |

Wrangler 4.145.0 `check startup`, on those minified bundles, seven alternating local runs: median profile window **26.1 ms main / 24.8 ms branch**, median sampled active CPU **5.1 ms / 5.1 ms**. Active ranges were 0–18.9 ms and 0–8.0 ms: this is noisy local sampling, not evidence of a speedup or Cloudflare production timing. There was no observed median startup regression. The selling runtime loads on first use of the selling entry; ordinary studios never import it.

## Verification

The five real-workerd paid-parts end-to-end scenarios passed:

- MPP discovers the seller through API-catalog/OpenAPI documents, pays, downloads and actually installs the part; the same buyer purchases twice. A lost response retries without a second charge, a forged claim fails, and a refund revokes access.
- The official MCP client discovers the purchase tool, pays through the Stripe method and installs the files in another buyer studio.
- The official x402 client signs the Base payment against stand-in chain/facilitator boundaries, the seller records it in Stripe, and the buyer installs it. Replay settles only one transfer.
- Keyless Payment Links cover configured quantity two, repeat purchases, duplicate and reordered events, recurring invoice/payment ordering, and concurrent reused public sessions. Two partial refunds complete a refund; failure of the second restores access. The Worker makes no Stripe API requests.
- Real Chrome at 390 × 844 follows the hosted licence form to a Stripe stand-in checkout, pays, receives the signed webhook and retrieves delivery.

These run against Miniflare/workerd with D1, R2 and the generated selling compatibility flags. Separate setup tests validate official Stripe request shapes, private credential transfer, signing-key installation, retries and keyless retirement.

All requested commands were run sequentially. The ordinary suite uses `CHROME_PATH` and `--test-concurrency=1`; test assertions and coverage are unchanged. The default-concurrency run earlier encountered a slow-tick assertion under host contention, then the isolated test passed. A subsequent two-worker run passed 1,796 tests but hit the unchanged room-update browser assertion about epoch continuity; that same scenario passed in the preceding full run. The final run serializes test files to reduce shared-machine contention. No assertion was loosened.

| Gate | Result |
| --- | --- |
| `npm ci` | Pass; 318 packages added, 342 audited, zero vulnerabilities |
| `npm run build` | Pass |
| `npm test -- --test-concurrency=1` | 1,797 tests: 1,797 pass, zero fail, zero skip; 572.9 seconds |
| `npm run test:plugin` | 117 tests: 116 pass, zero fail, one optional live-playtest skip (`HOMIE_PLAYTEST_URL` unset) |
| `npm run validate` | Marketplace and plugin both pass |
| `node scripts/desktop.mjs --check` | Pass; 2,608 KB package, 61 manifest tools, 65 answering server tools and five cards; nonblocking 512-pixel icon recommendation |
| `node scripts/changelog.mjs --check` | Pass; 57 versions, studio 0.36.0 / plugin 0.37.0, matching package copy |
| `node scripts/publish.mjs --check` | Pass; one version to publish, 22 already on npm |

The first post-rebase ordinary suite passed 1,796 of 1,797 tests: its changelog check ran before the new 0.35.1 release link was added. All five focused changelog tests passed after that correction. The final serial suite passed all 1,797 tests, including that room-update scenario. A local-only 0.36.0 release tag points at the final tested code commit `0642d49` to exercise the publish job's own-version-tag case with older tags fetched; it is removed afterwards and never pushed.

A temporary copy of `/Users/ryan/Studios/homie-arcade`, created without `node_modules` or `.git`, installed the branch's packed toolkit. All five games built with the exact same hashes as a subsequent main 0.35.1 packed-toolkit build. Its `npm run check -- --url http://127.0.0.1:56061` passed against its local Worker: two fresh Chrome browsers, two bots, round one completed in 122 seconds, 60 fps on both browsers, no reconnects. Seating took 0.7 and 0.3 seconds. The local server was stopped and the temporary copy deleted; the original studio was not modified.

The copied studio's existing Wrangler dependency reports three high audit findings through Wrangler/Miniflare/sharp. Installing packed main 0.35.1 gives byte-identical vulnerability records; this branch does not introduce them. The clean repository install has no audit findings.

 All payment-provider boundaries are stand-ins; nothing was deployed, no real payment account was signed into, and no live settlement was attempted. Production eligibility, actual provider permissions, taxes and account settlement remain account-specific checks.
