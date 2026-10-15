# Together we can

This starter opens real Checkout for one-time or monthly gifts from your studio's
shop. Run `shop init --giving --currency CAD`, then connect the organisation's
Stripe. The default gift options include $20 monthly. Existing studios and apps
are unchanged; generate this starter to opt in.

The phone reads the actual shop's donation options and availability. Without
Stripe, the options are a disabled preview (`screen.shopPreview: true`). A chosen-amount item (`price: 'choose'`)
shows an amount field using the item's minimum and maximum. See `shop/SHOP.md`
for the Homie Stripe App setup and “give $20 monthly” example.

Checkout opening never increments a total or creates an intention record. Stripe's
verified payment supplies `order.paid` and `subscription.started`; subsequent
invoices supply `subscription.renewed` or `subscription.failed`. Connect these
events to your own public progress display if desired. The starter deliberately
shows no collected total until you implement that verified projection.

The Manage my gifts link opens the studio shop, where the giver can open their
own Stripe customer portal. Connect creates the no-code portal login through Stripe's API; no Dashboard toggle is needed.
Set `giving.receiptText` in shop.json for your organisation's receipt wording.
Edit app.json name, blurb and colour for your cause. Phone: /<id>/open; wall:
/<id>/tv. Capture and check both surfaces before sharing.

Add the cause’s actual needs to its CODEX.md before running `check`. This starter
has no pretend shared-record action for the checker to click. For a disconnected
preview, assert `[data-action]:disabled` on the phone; verify paid flows with the
Checkout harness and signed events once the Checkout connection is available.
