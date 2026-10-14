# Keyless acceptance, 0.51.0

Only CLI profile `Homie sandbox` was used. No approval renewal was needed. No API
credential was read/exported or supplied to the Worker; no card was entered into a
form. Actual Payment Links were opened in Chrome; payments used Stripe's published
`tok_visa` fixture through the CLI/API. No live payments, deployment or Homie service.

Run:

```
HOMIE_STRIPE_SANDBOX_PROFILE='Homie sandbox' node --test packages/studio/test/keyless-sandbox-acceptance.mjs
```

`acceptance.log` and `sandbox.json` record the real results. The Worker received only
links and a private webhook signing secret. The desktop CLI forwarded signed events.

- A mixed menu paid once; the signed invoice supplied its actual lines and quantities.
  `order.paid` retained `table-7`. The invoice and Checkout event arrived separately.
- Two guests opened the same capacity-one slot link. Both were pending. The first
  paid and confirmed; Stripe deactivated the full link and refused payment from the
  second already-open session. The app rejected further booking attempts.
- A recurring Payment Link collected $20, granted the paid membership period and
  supplied the no-code portal login. Cancellation arrived through the signed hook.
- A separate clock-backed provider fixture tested paid renewal, failed renewal
  without extension, and cancellation. Stripe cannot attach clocks retroactively to
  Checkout-created customers; the fixture's owned order is explicitly seeded.

Earlier exploratory native objects verified `adjustable_quantity.minimum=0` and
`restrictions.completed_sessions.limit=1`. Stripe prevents an empty last line.
`login_page.enabled=true` returned a real portal login URL via API, so no Dashboard
toggle is required. Native links created by acceptance are deactivated afterward.

Sources checked October 14, 2026:

- [Payment Links API](https://docs.stripe.com/api/payment-link/create): multiple
  fixed-price lines, adjustable quantities, invoice creation and completed-session limit.
- [Payment Link object](https://docs.stripe.com/api/payment-link/object): active state
  and completed-session count/limit.
- [Portal configuration](https://docs.stripe.com/api/customer_portal/configurations/object):
  hosted login-page configuration and URL.
- [Checkout line items](https://docs.stripe.com/api/checkout/sessions/line_items):
  expandable/paginated data; quantities are not present in a normal Checkout event.
- [Stripe CLI fixture](https://github.com/stripe/stripe-cli/blob/master/pkg/fixtures/triggers/checkout.session.completed.json):
  API-only test Checkout confirmation.

Limits are explicit in SHOP.md: menu quantities are chosen on Stripe, keyless menus
are grouped to fit signed invoice snapshots, custom amounts use their own links,
pending is not an unpaid reservation, refunded sessions do not reduce Stripe's
lifetime completion count, and staff moves need schedule/link review and sync.
Keyed session checkout is available only when explicitly selected with an existing key.
