# Homie Stripe App connection

Homie (`rocks.homie.checkout`) version 0.0.1 is uploaded to the live Homie Apps
developer account. This round changes source only: no upload, deployment or live
payment. The next uploaded App version should omit `event_read`; the Worker
retrieves payment objects, never the Events API. Stripe Apps refused
`webhook_write`, so webhook installation uses the owner's Stripe CLI approval.

## Owner's exact steps

Run `homie-studio shop connect` (or the existing `stripe_login` tool), with the
studio already deployed at its HTTPS address and Cloudflare authorized:

1. **Approve the Stripe link** in your browser for the studio's account/sandbox.
   An existing approved CLI profile for that account skips this browser step.
   The tool creates the studio's webhook endpoint with exactly its handled events
   and installs `STRIPE_WEBHOOK_SECRET` through `wrangler secret put` over stdin.
2. **Install Homie → View API keys → Generate new key → Copy** (Stripe may show
   **Reveal key** in a sandbox). The tool opens the configured External test link,
   checks that the copied key belongs to the same account and mode, installs
   `STRIPE_KEY` over stdin, and clears the clipboard. Never paste a key into chat.

Both steps resume through `shop connect`. After private key installation,
`shop connect --finish` completes verification and any migration. `--renew`
uses **Roll key → Copy**; it retains the working webhook and existing CLI login.
A resumed key installation does not ask for another copy. Success says
`connected to <account display name>`.

If clipboard access fails, run `npx wrangler secret put STRIPE_KEY` in your own
terminal in the studio's `site` directory. Paste into its private prompt, then
run `homie-studio shop connect --finish` from the studio root. Do not copy raw CLI
output into chat. Test mode is default; live requires an explicit owner request.

Configure the uploaded App's External test invite as `HOMIE_STRIPE_INSTALL_URL`.
No guessed install link or Homie-hosted credential service is used. External
testing and marketplace release remain separate from this toolkit PR.

## Permissions and secrets

The App key creates Checkout Sessions and retrieves payment truth. Its manifest
covers Checkout, PaymentIntents, charges/refunds, subscriptions, invoices,
disputes, the customer portal, products and prices. It has no `webhook_write`,
`event_read`, Payment Links, API-key creation, payouts or transfers grant.
The permissions coverage test checks every Worker Stripe path against that
manifest. Read probes establish identity and read access, not write coverage.

The signing secret is a normal Worker secret. No plaintext or encrypted signing
secret is stored in D1, and the Worker cannot create its own endpoint. Only the
private local CLI subprocess sees endpoint-creation output. Receipts contain
account, mode, endpoint, URL and retry IDs, never credentials. Retrying a failed
secret installation reuses the endpoint creation idempotency key. The CLI's
credentials remain on the owner's computer; they are never exported.

Stripe sends real signed webhooks directly to the studio. There is no Events API
polling. Provider retrieval precedes fulfilment; repeat deliveries are deduped
before side effects. Holds precede Session creation. Only 401 marks a revoked or
expired connection; a 403 permission failure does not request new authorization.

`shop disconnect` uses the same CLI account to delete the endpoint before
removing Worker secrets. Then roll/expire the old key in App settings. Endpoint
cleanup does not require a functioning app key. Do not assume uninstall revokes
an independently generated key.

## Migration

The existing endpoint and signing binding are reused when available, including
link-era receipts. The account is checked before mutations. The tool installs
the app key and Checkout handler before draining old links. It deactivates links,
expires open Sessions, follows all completed-session pages and checks committed
paid receipts twice, 30 seconds apart. Pending asynchronous payments keep the old
configuration. Old endpoints and link bindings retire only after the drain.
Retry `--finish`; never delete financial rows to make migration pass.

## Sandbox evidence and remaining release gates

Use only CLI profile `homie-636e9d423df0184d0af88019`. The manual acceptance script
uses real Stripe payments and `stripe listen --forward-to`; its `--cli-transport`
option keeps CLI credentials private but **does not prove app-key permissions**.
`stripe-cli-sandbox-proof.mjs` separately runs `stripe trigger` into local Workerd.

The App-generated key still needs sandbox write-coverage testing, including
subscription Checkout/customer dependencies and portal creation. Use the existing
private-input wrapper `test/run-checkout-sandbox.py`; never export a CLI key.
Uninstall revocation and cross-account developer-key isolation require an actual
App installation in the appropriate second sandbox. No such security proof is
implied by CLI-authenticated payment tests. Full link-era migration against a
populated deployed studio remains a release gate.

Round 5 sandbox proofs passed for last-seat booking, exact deposits and donations,
baskets, expiry releasing the hold, refunds, monthly Checkout/portal, a paid
renewal invoice, delayed SEPA payment, and a dispute closed lost. The CLI trigger
also passed signature verification in local Workerd. These were CLI transport
proofs, not app-key scope proofs.

`stripe-webhook-sandbox-proof.mjs` created a real endpoint with the exact event
list, verified the private stdin boundary and deleted its temporary endpoint.
Actual `wrangler secret put` into Cloudflare remains unverified: a designated
existing test Worker is needed without deploying a new one. The test's injected
Wrangler runner is explicitly not a claim of remote secret installation.

Stripe Apps feedback was accepted as `fbk_VRnCqeHbRElc7O`, requesting app-scoped
event destinations to installers' own endpoints without a second approval.

Sources: [Stripe App events](https://docs.stripe.com/stripe-apps/events),
[RAK authentication](https://docs.stripe.com/stripe-apps/api-authentication/rak),
[manifest](https://docs.stripe.com/stripe-apps/reference/app-manifest).
