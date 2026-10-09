# Your shop, your choices

You sell with your own Stripe account. Money goes directly to you; Homie takes no cut.
The studio is the seller and is responsible for the law where it sells and for Stripe's terms.

Your `shop.json` chooses items, wording, prices, currency, tax integration, sale dates, entitlements,
referral terms, optional spending caps and optional refund windows. Nothing requires an account or age
question by default. Guests can buy repeatedly and keep their purchases when signing in later.

You can choose `policy.preset: "protective"` or `"adults-only"`, or set individual options.
Without a preset the shop is open. SHOP.md describes each setting and the game cart API.

With the fuller checkout connection, a cart is one payment with several lines and quantities. Your office can refund a whole order or a line.
A player can refund items within a window you set; a tip stays given unless you refund it.
Stripe handles payments, receipts, payment limits, held refunds and disputes. Stripe Tax is optional;
Managed Payments is another selectable integration. Your office links Stripe's own pages.

`homie-studio shop connect` opens Stripe's approval page if needed, then your AI syncs your products, prices, payment links and webhook. You never handle a key. The shop sends buyers to Stripe, where they confirm quantity or choose a tip; your Worker holds only the webhook signing secret and link settings. Buy different items separately. Refund in Stripe or ask your connected AI; signed events update your shop. A missing payment stays pending until Stripe resends its event. Free orders need no Stripe.

The fuller connection adds combined carts, spending limits, custom checkout expiry, automatic recovery and refunds in the office. An existing Worker key selects it; your AI explains it only if you ask for those features. The optional manual setup remains available, but is not the default.
The scaffold has no policy, cap or refund window. Test mode is available before choosing live mode.
