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
   `studio_job`. The tool opens the official **Homie** Stripe App approval page.
3. The owner approves Homie once. The tool generates its RSA keypair locally,
   receives encrypted credentials, decrypts locally, and installs the restricted
   Worker key and webhook secret through Wrangler stdin. Never ask for, display,
   copy, paste, or put a key in tool arguments, chat, logs or a public file.

Test mode is the default. Select live only on the owner's explicit instruction.
The managed-key API requires Stripe preview access and App review. Until granted,
use the fake integration for development and report real minting as unverified.
Do not replace App approval with manual key entry or CLI credentials exported to
the Worker.

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

Run `homie-studio upgrade`. The owner's payment setup action is one App approval
through `stripe_login`. Keep the old deployment until cutover completes. The
setup job stops new link sessions, waits for in-flight sessions and signed D1
receipts, deploys the upgraded Worker, installs credentials and retires the old
webhook and link configuration. Orders, bookings and subscription ownership stay
in the same database. Never delete financial rows to make an upgrade pass.

A revoked or expired Worker key closes checkout and asks for reconnection.
Uninstall may revoke managed keys; Stripe also permits the owner to keep them.
The App records lifecycle events without receiving purchase traffic.

## Verification

Run the shop, booking, functions and MCP tests. Use the faithful local fake for
App approval and managed-key minting until preview access arrives. For real
sandbox acceptance, use only the explicitly authorised CLI profile and inject
the test restricted key privately via stdin into the test harness. Use Stripe's
published CLI fixture/API test token; never type card numbers. A sandbox fixture
proves sandbox payments, not App preview access. Never use live credentials in
acceptance tests.
