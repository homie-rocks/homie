# Studio Checkout

Each purchase, including a zero-price order, is a Stripe Checkout Session created by the studio's own
Worker. The restricted key and signing secret stay in that Worker. Stripe sends
payment events straight to `/api/shop/hook`; homie.rocks performs setup only.
There is no Homie fee, payment proxy or runtime dependency on homie.rocks.

## Setup

Create and check `shop.json`, deploy the studio, then run:

```
homie-studio shop connect
```

The existing `stripe_login` tool runs this command and opens the official Homie
Stripe App. Approve it once in the browser. Local RSA key generation, encrypted
credential collection, decryption and `wrangler secret put` over stdin are
automatic. No owner copies or pastes a key. Test is the default; `--live` is an
explicit owner choice. `--manual` and clipboard key entry are removed.

Managed API keys are a Stripe preview requiring `api_key_write` approval and
App review. The local fake exercises the documented JSON request and JWE
response until access is available. An unapproved endpoint is a setup failure,
not permission to fall back to a different payment architecture.

## Catalogue and checkout

Use `maxQuantity` for an item-specific upper bound; deposits always have quantity one. Repeated basket lines are checked together.

Amounts are integers in the currency's smallest unit. `quantity` is checked
against the item limits and the basket is frozen in `shop_order_lines`. The
Worker creates exact line items, preserving the configured tax behavior and
success/cancel URLs. It uses an order-specific idempotency key.

```ts
await shop.buy('full-tune', 1, undefined, { reference: booking.id });
shop.add('full-tune', 1);
shop.add('wax', 2);
await shop.checkout({ reference: booking.id });
```

Opening checkout never means paid. References are opaque correlation identifiers,
not permission to access a record. Verify the app, record and expected purchase
when handling the durable `order.paid` event. Keep personal data out of references.
The reference is present in Session `client_reference_id` and metadata as well
as the local durable event. Without a reference, the existing buyer correlation
continues to apply.

`studio_checkout` and `shop.book` callers keep their existing interface.
Payment Links, basket links, slot-link sync and the public link asset are removed.
Catalogue edits need no link synchronization.

## Bookings and deposits

Declare a booking collection with its `slots` collection and shop `item`.
`shop.book` validates the slot, item, quantity and any resource allocations. A
held booking is claimed atomically before the Session is created. Two concurrent
buyers cannot both take the last seat. Success confirms that same booking row;
expiry or failed payment releases it. An uncertain provider response retains the
hold until reconciliation can establish a terminal state. An expired browser
or a cancel URL alone is not evidence of a failed payment.

Resource bookings require the allocated hold. A raw slot cannot bypass resource
allocation. Moves are versioned and check capacity without losing the old seat.
Deposits charge the exact intended amount; fulfilment refuses underpayment and
overpayment. Booking references are saved before checkout.

## Giving and subscriptions

Use `homie-studio shop init --giving --currency <currency>` for giving presets.
A `price: "choose"` item accepts a giver-selected amount within its declared
limits; adding `interval: "month"` creates a recurring Checkout line. Suggested
fixed amounts use the same Session path. Use only receipt wording supplied by
the organisation.

Signed invoice events and verified paid invoice periods govern membership.
Failed renewals do not extend access. The customer portal checks ownership and
opens Stripe's portal for that customer's subscription. A new plan never creates
an unpaid entitlement period.

## Payment proof and refunds

The webhook verifies the raw body's Stripe signature and timestamp before doing
anything. It checks mode, Session/order identity, currency, exact subtotal and
line totals. Events and grants are idempotent, and database writes are atomic.
Forged, duplicate, mismatched and out-of-order events cannot invent a purchase.
Return pages and background reads cannot grant an unpaid order.

Refunds use the studio's restricted key and Stripe's own API. The studio retains
its order and booking records. Successful refunds and lost disputes remove the
corresponding access; failed or pending refunds do not count as money returned.
Owner approval for refunds remains the existing office behavior.

## Upgrade

`homie-studio upgrade` identifies existing link setup and gives the owner one
payment action: approve Homie through `shop connect`. Do not deploy over the old
payment handler before the connection job completes the drain. The App stops new
link sessions; the tool waits for open sessions and checks the old database for
receipts already committed by signed events. It then deploys the new Worker,
installs its credentials, disables old webhook endpoints and removes retired
configuration. No orders or bookings are deleted or granted by the drain check.

Revoked or expired credentials cause checkout to ask for reconnection. App
lifecycle notifications are setup records only. Buying and delivery do not call
Homie to check authorization.

## Testing

Local fake: the shop, booking, functions and MCP tests use provider doubles and
real Worker/D1 tests. App tests validate encrypted delivery, replay rejection,
wrong mode, missing ownership proof, expiry and migration ordering.

Real sandbox acceptance is `test/checkout-sandbox-acceptance.mjs`. It accepts a
Dashboard-made restricted **test** key only on stdin and uses only the CLI
profile `Homie sandbox` for payment test helpers and signed webhook forwarding.
No card digits, live keys, production deployment or global CLI profile are used.
A sandbox payment test does not prove managed-key preview access.

See the App service's managed-key acceptance script for the one real mint test
to run after Stripe grants preview access.
