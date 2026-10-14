# Earning acceptance work

Target: 0.51.0, one owner-owned Stripe checkout for carts, capacity bookings,
and monthly giving. Existing studios opt in. No Homie payment intermediary.

Implementation checks:
- Preserve immutable order lines and app references through verified payment.
- Reserve capacity atomically before creating Checkout; never release on a local
  clock alone when Stripe might have completed payment.
- Keep subscription identity private; portal sessions require the owning buyer.
- Reuse durable studio events for booking and subscription changes.
- Exercise HTTP/provider fixtures and real SQL transactions, including races.
- Pack the final toolkit and run an isolated Maya customer trial before release.

Authorization research (2026-10-14): the current CLI approval installs local CLI
credentials and Payment Links. It does not document provisioning a production
Worker credential. Stripe Apps OAuth requires a published app and developer
credential for code exchange; managed API keys require preview access. Whether
Homie already has either integration is pending. Do not relabel CLI credentials
as production credentials, request pasted keys, or claim one-approval acceptance
until that path is established.

Sources:
- https://docs.stripe.com/cli/login
- https://docs.stripe.com/stripe-apps/api-authentication/oauth
- https://docs.stripe.com/keys/managed-api-keys
- https://docs.stripe.com/payments/checkout/managing-limited-inventory
- https://docs.stripe.com/billing/subscriptions/webhooks
