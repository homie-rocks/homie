# Your shop, your choices

You sell with your own Stripe account. Money goes directly to you; Homie takes no cut.
The studio is the seller and is responsible for the law where it sells and for Stripe's terms.

Your `shop.json` chooses items, wording, prices, currency, tax integration, sale dates, entitlements,
referral terms, optional spending caps and optional refund windows. Nothing requires an account or age
question by default. Guests can buy repeatedly and keep their purchases when signing in later.

You can choose `policy.preset: "protective"` or `"adults-only"`, or set individual options.
Without a preset the shop is open. SHOP.md describes each setting and the game cart API.

A cart is one payment with several lines and quantities. Your office can refund a whole order or a line.
A player can refund items within a window you set; a tip stays given unless you refund it.
Stripe handles payments, receipts, payment limits, held refunds and disputes. Stripe Tax is optional;
Managed Payments is another selectable integration. Your office links Stripe's own pages.

`homie-studio shop connect` provides a local page for the key and webhook signing secret; both are part of payment setup, credentials stay in Worker secrets.
The scaffold has no policy, cap or refund window. Test mode is available before choosing live mode.
