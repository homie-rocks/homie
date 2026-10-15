# Homie Stripe App — restricted API keys

Status: draft, not uploaded, deployed or approved by Stripe. The public App source
is in `apps/stripe-homie`. Connection and payments never contact homie.rocks.

## Owner: connect

With the Homie connection tool running on your computer:

1. Opened Stripe page: select your account and **Install Homie**.
2. App settings: **View API keys → Generate new key** (sandbox: **Reveal key**).
3. **Copy**.

The tool installs the key directly into your Worker and clears the clipboard.
Its success output is `connected to <account display name>`. Do not paste keys
into chat. `shop connect --renew` uses **Roll key → Copy** on the same page.

If clipboard access is unavailable or times out, open your own terminal in the
studio's `site` directory and run `npx wrangler secret put STRIPE_KEY`. Paste only
into Wrangler's hidden prompt, then run `homie-studio shop connect --finish` from
the studio root (add `--live` only for an explicitly requested live connection).
The tool cannot detect a paste into an unrelated application; copied keys should
be treated as secrets even after the clipboard is cleared.

Disconnect with `homie-studio shop disconnect` **before** expiring the key. It
removes the webhook endpoint, then deletes the Worker key and webhook wrapping
secret. In Stripe App settings → View API keys, roll/expire the old key as well.
If uninstall already revoked it, the tool removes the Worker credential and asks
you to delete the endpoint in Workbench. If uninstall leaves it valid, normal
endpoint deletion works and explicit expiry is still required.

## Permissions

| App permission | Worker use |
| --- | --- |
| `checkout_session_write` | Create, retrieve and expire Checkout Sessions; verify fulfilment |
| `payment_intent_write` | Create/retrieve payments and verify their state |
| `charge_write` | Charges and owner-authorized refunds |
| `subscription_write` | Subscription lifecycle and cancellation |
| `customer_portal_write` | Portal configuration and buyer-owned portal sessions |
| `webhook_write` | Create, inspect and delete the studio webhook |
| `dispute_read` | Reconcile disputes |
| `invoice_read` | Invoice payment verification and legacy invoice lines |
| `product_read` | Existing catalog products |
| `plan_read` | Prices (Stripe's documented permission name) |

`customer_write` is omitted: runtime code does not call Customers APIs; Checkout
creates any required customer and the portal uses the persisted customer ID.
Whether those flows require a dependent Customer permission must still be
verified using the **App-generated RAK**, including subscription Checkout and
portal creation. CLI credentials cannot establish this. Add it only if that
sandbox test demonstrates a requirement, then update the manifest contract test.

Harmless reads validate account identity, mode and resource read access. They
cannot prove write permissions or that a copied arbitrary RAK has no extra
permissions. The installed App's manifest determines the generated key's scope;
actual writes fail closed. No `api_key_write`, Payment Links, payouts or transfers
permission is granted to the Worker.

## Developer: upload and External test (owner-run only)

The documented template command was attempted with the authorized sandbox
profile but stopped because the Stripe Apps Agreement is unaccepted. It did not
scaffold. Current source is a complete settings view and manifest based on the
canonical documentation, **not a successfully generated template**. Before
uploading, accept the agreement yourself and compare the generated template:

```sh
stripe -p homie-636e9d423df0184d0af88019 apps create Homie /tmp/homie-rak-template --template restricted-api-key-app --non-interactive --id rocks.homie.checkout --name Homie --accept-tos
```

Do not run that acceptance flag unless you agree to the Stripe Apps Agreement.
To upload, separately authorize login to the live **Homie Apps** developer account:

```sh
stripe login --project-name homie-apps
cd apps/stripe-homie
npm ci
npm run build
npm test
stripe --project-name homie-apps apps set distribution public
stripe --project-name homie-apps apps upload --live --wait
```

The live flag above uploads the App definition to its developer account; no
payment is created. These commands have **not** been run here. In Dashboard →
Developers → Apps → Homie → **External test → Get Started**, select this version
and the tester access policy, then copy the invite link. The installed CLI has
**no External test creation command**; this is a Dashboard step. External tests
allow at most 25 testers and are not production distribution. Set the copied
link as `HOMIE_STRIPE_INSTALL_URL` in the environment that launches the local
Homie tool. No guessed install ID or homie.rocks redirect is used.

## Required sandbox checks before release

The only CLI profile authorized for this work was
`homie-636e9d423df0184d0af88019`. No App upload was authorized. Consequently there
is no installed RAK App or owner-generated RAK available for these tests.

1. After owner-approved upload, install the External test into a **second,
   unrelated sandbox**. Use the install link with the sandbox selected.
2. Reveal and Copy its App-generated RAK through the local tool. Confirm exact
   permissions in View API keys. Run the owner-only hidden-input acceptance:
   `python3 packages/studio/test/run-checkout-sandbox.py`. Test one-time,
   subscription, chosen-amount, basket, expiry, refund, portal and webhook flows.
   That harness is pinned to the authorized sandbox, so install there or obtain
   explicit authorization before changing its profile. Never export CLI keys.
3. With the **App developer's sandbox secret** retained privately by its CLI
   profile, run the following in that developer profile, replacing only the
   second sandbox account ID (never paste a key):

   ```sh
   stripe --project-name homie-636e9d423df0184d0af88019 get /v1/payment_intents --stripe-account acct_SECOND_SANDBOX -d limit=1
   stripe --project-name homie-636e9d423df0184d0af88019 post /v1/payment_intents --stripe-account acct_SECOND_SANDBOX -d amount=100 -d currency=usd -d 'metadata[homie_security_probe]=true'
   ```

   The developer profile must actually own the uploaded App's sandbox installation
   relationship. If the live developer upload creates a separate managed sandbox,
   authorize a CLI login to that sandbox first; the currently authorized profile
   cannot substitute for it. Confirm the same requests succeeded under the
   owner's RAK privately, so a missing object cannot masquerade as access denial.
   Expected developer result: access denied for both reads and writes. A successful
   request disproves isolation; stop release and do not claim Homie lacks account
   authority. Cancel any test PaymentIntent created during the probe. No live mode.
4. Before uninstall, privately verify that the owner RAK can list one Checkout
   Session. Uninstall Homie in the owner sandbox and repeat exactly that read.
   Record HTTP status only: 401 means revoked; 200 means retained and requires
   explicit roll/expiry. 403 is inconclusive for revocation. Run disconnect in
   both conditions and check the endpoint is removed or the cleanup instruction
   appears. Do not assume uninstall revokes a RAK.

**Security result: unverified, blocked on the second sandbox installation.**
Generic install-link docs describe developer-key access with `Stripe-Account`;
RAK docs do not explicitly settle whether that authority exists for RAK apps.
The implementation never uses such a developer credential, but that is different
from proving Stripe would refuse one.

## Webhook secret storage

The Worker creates its endpoint with the RAK. Its signing secret is encrypted
with AES-GCM in the studio's D1, using an independent 256-bit wrapping key stored
as `STRIPE_WEBHOOK_WRAP_KEY` via Wrangler stdin. It never returns the signing
secret to the local tool or any Homie service. This is encrypted Worker-owned
storage, **not** a `STRIPE_WEBHOOK_SECRET` binding written by the Worker: Workers
cannot mutate their own secret bindings without Cloudflare management authority.
The wrapping key remains stable across RAK rotation. Disconnect removes it.

## Migration

Install/Copy remains the owner's connection action. The local tool also needs
the existing link-era Stripe CLI login to deactivate Payment Links; the RAK has
no Payment Links permission. It verifies that CLI account against the RAK account
before any mutation. If unavailable, migration stops with old configuration intact.
Checkout deployment and the new endpoint precede cutover. Open link sessions are
expired; all completion pages are checked against committed paid receipts, with
a second pass after 30 seconds. Pending asynchronous payments retain the old
webhook. Only then are old hooks and link bindings retired. Retry `--finish`.
The old webhook signing binding is retained for already queued deliveries until
disconnect. Full migration against a real 0.53 database remains an acceptance gate.

## Sources read with `stripe docs` on 2026-10-15

- [RAK authentication](https://docs.stripe.com/stripe-apps/api-authentication/rak)
- [Install links](https://docs.stripe.com/stripe-apps/install-links)
- [External testing](https://docs.stripe.com/stripe-apps/test-app)
- [Distribution](https://docs.stripe.com/stripe-apps/distribution-options)
- [Permissions](https://docs.stripe.com/stripe-apps/reference/permissions)
- [App settings](https://docs.stripe.com/stripe-apps/app-settings)
- [App manifest](https://docs.stripe.com/stripe-apps/reference/app-manifest)

## Evidence from this change

- Local connection, migration ordering, permissions, provider-verification and
  changelog contract tests: 25 passed. App TypeScript build passed.
- Existing shop/subscription/upgrade/MCP/Workerd regressions: obsolete notification
  fixtures updated to provide independently retrievable Stripe objects; the four
  initially failing cases passed on rerun. No new browser tests.
- Authorized sandbox CLI end-to-end (using a local CLI transport, **not a RAK**):
  paid last-seat booking, exact deposit, chosen donation, mixed basket/reference,
  expiry releasing capacity, refund releasing booking, monthly subscription and
  ownership-checked portal all passed. Genuine events used `stripe listen`.
- Real `stripe trigger payment_intent.succeeded` forwarded into local Workerd and
  passed signature and test-mode checks. The listener process was stopped.
- App template command stopped at the agreement gate. Nothing was uploaded.
- No real RAK uninstall, scope or cross-account isolation proof is claimed.
- Broader CI review found an overly broad round-3 local API denylist; it was
  removed. Stripe remains the scope enforcement boundary, and the static test
  classifies optional machine-payment capability probes without granting them.
  Machine-payment/Workerd regressions passed after correction. Legacy recurring
  readiness now checks subscription/invoice read access instead of assuming that
  any existing key satisfies the App contract; schema-less legacy shops ignore
  unrelated lifecycle notifications without granting anything.
