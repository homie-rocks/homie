---
name: shop
description: Sell goods, bookings, deposits, donations and subscriptions from a studio's own Stripe account and Worker.
compatibility: Official Homie Stripe App, the existing stripe_login tool, and Wrangler.
---

# The studio's shop

The studio's Worker creates a Stripe Checkout Session for each purchase. Stripe
sends signed webhooks directly to that Worker. Only verified payment events grant
paid goods, confirm paid bookings or extend paid subscriptions. A success URL,
API read, intention or opened checkout is not payment.

Homie takes no fee and is not in the money path. Once connected, buying, proof,
delivery, the customer portal and refunds work with homie.rocks unreachable.

## Connect once

1. Check `shop.json` with `homie-studio shop check` and ensure the studio has its own
   deployed HTTPS Worker and Cloudflare authorization.
2. Call the existing `stripe_login` tool (`homie-studio shop connect`). Follow
   `studio_job`. First **approve the Stripe CLI link** for the studio account, if this computer is not already connected. The tool creates the endpoint and installs its signing secret privately via Wrangler stdin. It then opens the official **Homie** Stripe App page.
3. The owner installs Homie, then chooses **View API keys → Generate new key**
   (**Reveal key** in a sandbox) **→ Copy**. The local tool watches for a new
   restricted key in the expected mode, checks it against Stripe, installs it via
   Wrangler stdin and clears the clipboard. Never request a key in chat, tool
   arguments, logs or files. Tool success says only `connected to <account name>`.

Test mode is the default. Select live only on the owner's explicit instruction.
Until review passes, configure the uploaded App's External test link in
`HOMIE_STRIPE_INSTALL_URL`. External testing is limited to 25 testers and is not
production distribution. No Homie service participates in setup or payments.
If clipboard capture fails, the tool offers `npx wrangler secret put STRIPE_KEY`
in the owner's own terminal, followed by `homie-studio shop connect --finish`.
Both steps resume; a working webhook and approved CLI login are reused.
The signing secret is a normal Worker secret, never encrypted D1 storage. There
is no Events API polling. `--renew` opens the same App page; the owner chooses **Roll key → Copy**.

`stripe_shop_plan`, `stripe_webhook`, slot-link synchronization, Payment Links,
basket links and their public JSON configuration have been removed. There is no
second checkout mode. Catalogue edits take effect with the studio deployment;
there is no per-item Stripe link provisioning.

## Purchases

Read the installed `shop/SHOP.md`. Keep callers unchanged:

- `shop.buy(item, quantity?, amount?, { reference })` opens one checkout.
- `shop.add(item, quantity, amount?)` and `shop.checkout({ reference })` send the
  exact basket and quantities. Each item's limits are checked by the Worker.
- `shop.book(...)` uses declared booking collections. Dated slots and resources
  use atomic holds. Checkout claims the hold before creating the Session; expiry
  releases capacity. Say “Pay to secure your booking.”
- Deposits use the exact saved amount. The app's reference travels in
  `client_reference_id`, Session metadata and the durable paid event. A reference
  is correlation, never authorization.
- Giver-chosen one-time and monthly gifts are amounts in Checkout line items.
  Configure the organisation's currency and supplied receipt wording. Do not
  invent charity status or tax treatment.
- Subscribers manage their own subscription in Stripe's customer portal.

The `studio_checkout` MCP tool and `shop.book` interface remain unchanged. An
opened checkout is not a successful purchase. Fulfilment verifies identity,
mode, currency, amounts and line quantities and is idempotent. Test events and
local fakes must be identified as simulations.

## Existing studios

Run `homie-studio upgrade`, then `stripe_login`. The owner installs and copies
once after approving the Stripe link if needed. The tool reuses the existing
webhook secret, installs the RAK and deploys Checkout before retiring links. Deactivating old links needs the owner's existing local
Stripe CLI authorization, matched to the RAK account: the Worker deliberately
has no Payment Links permission. Missing CLI authorization stops retirement.
Open link sessions expire; cursor-based receipt checks run at least 30 seconds
apart before old webhooks/configuration are removed. Pending asynchronous
payments retain the old configuration. Retry with `shop connect --finish`.
Never delete financial rows to make an upgrade pass.

Only an authentication failure (401) requires reconnect; 403 is a permission
failure. Disconnect removes the webhook before the Worker key. Tell the owner
to roll/expire the key on Stripe's App settings page; do not assume uninstall
revokes it. Endpoint deletion uses the CLI login even if the app key is revoked.

## Verification

Run the small shop, migration, permissions and connection tests. Use only the
explicitly authorized sandbox CLI profile for real tests. The owner-generated
RAK, uninstall behavior and cross-account developer-key isolation require a
real App installation. Do not label CLI-authenticated tests as RAK proof.
See [owner and release guide](../../../../docs/stripe-rak-owner-guide.md).
