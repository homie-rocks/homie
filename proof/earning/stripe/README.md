# Real Stripe sandbox acceptance

Profile: `Homie sandbox`. The local CLI authenticated without renewal. API keys
and CLI OAuth credentials were never read/exported, printed or committed; the
adapter captures the listener signing secret privately in memory. No card entry.

Run explicitly, outside normal CI:

```
HOMIE_STRIPE_SANDBOX_PROFILE='Homie sandbox' node --test packages/studio/test/earning-sandbox-acceptance.mjs
```

The script uses the real shop HTTP handlers and SQL migrations, the CLI API
adapter and `stripe listen --forward-to` to deliver actual signed sandbox events.
Checkout completion follows Stripe's published fixture with `tok_visa`, not an
invented success webhook. It proves paid holds, competing last-seat buyers,
mixed-cart reference, expiry, refund, subscription Checkout and buyer portal.

For lifecycle time travel it creates a separate test-clock customer/subscription,
seeds a local owned order fixture and invokes the same binding function; real
signed renewal/failure/deletion events then exercise the webhook handler. This
fixture setup is distinct from the separately tested subscription Checkout flow.
It advances to the billing boundary, waits for the clock to be ready, then advances
through invoice finalization. Renewal extends the paid period; payment failure
preserves its old end; cancellation ends access. The test-clock objects are
removed on cleanup. The latest passing output is retained here.

This is sandbox evidence, not proof of production one-approval authorization.
