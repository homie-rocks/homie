# Studio Checkout

Each purchase, including a zero-price order, is a Stripe Checkout Session created by the studio's own
Worker. The restricted key and signing secret stay in that Worker. Stripe sends
payment events straight to `/api/shop/hook`; setup runs on the owner’s computer.
There is no Homie fee, payment proxy or runtime dependency on homie.rocks.

## Setup

Create and check `shop.json`, deploy the studio, then run:

```
homie-studio shop connect
```

The existing `stripe_login` tool runs this command. First approve the Stripe CLI
link for your studio account (skipped for an existing approved login). The tool
creates the webhook and installs its signing secret privately through Wrangler
stdin. Then it opens the official Homie Stripe App. Install Homie, choose View API keys → Generate new key (sandbox:
Reveal key) → Copy. The local tool captures only a new restricted key in the
expected mode, validates read access and installs it through Wrangler stdin.
It clears the clipboard afterward; never paste keys into chat. `--renew` uses
Roll key and Copy. If capture fails, use the hidden Wrangler prompt in your own
terminal and resume with `shop connect --finish`.

The App has public distribution; use its External test link until Stripe review
passes. No Homie service handles setup or payments. Both steps resume; renewal
reuses the webhook and CLI login. `STRIPE_WEBHOOK_SECRET` is a normal Worker
secret. The app key cannot create webhooks, and no Events API polling is used.
See the repository's `docs/stripe-rak-owner-guide.md` for release gates.

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

`homie-studio upgrade` identifies existing link setup. Run `shop connect`: approve
the Stripe link if needed, then install Homie → Generate → Copy. The tool reuses
the old signing secret, installs the app key and Checkout handler, then deactivates
old links and expires open Sessions. It checks all completed-session pages against
committed paid receipts twice, 30 seconds apart. Pending asynchronous payments
retain old configuration. Only after draining do old hooks and link bindings
retire. Resume with `--finish`. No financial rows are deleted.

Revoked or expired credentials cause checkout to ask for reconnection. Uninstall behavior is tested separately; do not assume uninstall revokes a key. Buying and delivery do not call
Homie to check authorization.

## Testing

Local fake: the shop, booking, functions and MCP tests use provider doubles and
real Worker/D1 tests. App tests validate private clipboard capture, stale/wrong-mode rejection,
secret-free output, lifecycle cleanup and migration ordering.

Real sandbox acceptance is `test/checkout-sandbox-acceptance.mjs`. It accepts a
Dashboard-made restricted **test** key only on stdin and uses only the CLI
profile `homie-636e9d423df0184d0af88019` for payment test helpers and signed webhook forwarding.
No card digits, live keys, production deployment or global CLI profile are used.
A CLI-authenticated sandbox payment test does not prove App-generated RAK
permissions or developer-key isolation. Follow `docs/stripe-rak-owner-guide.md`
for the separately owner-authorized App installation and security checks.
