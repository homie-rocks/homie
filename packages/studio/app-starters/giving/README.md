# Together we can

This starter opens real Checkout for one-time or monthly gifts from your studio's
shop. Run `shop init --giving --currency CAD`, then connect the organisation's
Stripe. The default gift options include $20 monthly. Existing studios and apps
are unchanged; generate this starter to opt in.

The phone reads the actual shop's donation options and availability. Without
Stripe, the options are a disabled preview. A chosen-amount item (`price: 'choose'`)
shows an amount field using the item's minimum and maximum. See `shop/SHOP.md`
for the runtime connection requirement and “give $20 monthly” example.

Checkout opening never increments a total or creates an intention record. Stripe's
verified payment supplies `order.paid` and `subscription.started`; subsequent
invoices supply `subscription.renewed` or `subscription.failed`. Connect these
events to your own public progress display if desired. The starter deliberately
shows no collected total until you implement that verified projection.

The Manage my gifts link opens the studio shop, where the giver can open their
own Stripe customer portal. Configure the portal in the owner's Stripe account.
Set `giving.receiptText` in shop.json for your organisation's receipt wording.
Edit app.json name, blurb and colour for your cause. Phone: /<id>/open; wall:
/<id>/tv. Capture and check both surfaces before sharing.
