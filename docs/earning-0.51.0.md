> Historical release evidence. Current Stripe setup and payment behavior are documented in [Studio Checkout](../packages/studio/shop/SHOP.md); the former Payment Link mode is removed.

# Earning acceptance work

Target: 0.51.0, one owner-owned Stripe checkout for carts, capacity bookings,
and monthly giving. Existing studios opt in. No Homie payment intermediary.

**Settled (supersedes the authorization notes below):** the default is keyless.
The owner's AI creates Stripe-native objects through the one-approval Stripe CLI
session: a menu Payment Link with adjustable quantities for a round (table in
`client_reference_id`, paid lines from the signed invoice), one Payment Link per
published slot with `restrictions.completed_sessions.limit` as the hard capacity,
and recurring Prices on Payment Links plus the no-code customer portal login
(`login_page.enabled`, set through the API) for monthly giving and memberships.
The Worker holds only link config and the webhook signing secret. Homie has no
platform key, OAuth backend or place in the money path; the owner never pastes a
key. The keyed Checkout Session path stays optional, chosen only explicitly.
Real-sandbox proof: `proof/earning/keyless/`; Maya's trial: `proof/earning/maya-keyless/`.

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

Continuation evidence (2026-10-14):
- The explicit `Homie sandbox` CLI profile authenticated successfully. No login
  renewal was needed. Only that profile was used; no CLI credential was exported.
- The local adapter `lib/dev-stripe-sandbox.mjs` drives the CLI and forwards signed
  real sandbox events. It is a desktop acceptance tool, not runtime authorization.
- Actual sandbox Checkout confirmed a held last seat; a competing buyer was
  refused; mixed cart payment retained table-7; expiry and refund released seats;
  monthly Checkout and a buyer-owned customer portal session succeeded.
- Membership access now follows paid invoice periods and current provider status,
  with original order snapshots retained across recognised plan changes. Provider
  reads have generation guards against overlapping/out-of-order reconciliations.

Historical (before the keyless decision): the keyed path's blocker was **credential provisioning, not just a
missing Checkout scope**. Current CLI login/reauth grants remain CLI sessions.
No published Homie Stripe OAuth app/client or managed-key preview integration was
found in this repository. Stripe Apps OAuth requires a published public app plus
an app developer credential for exchange/refresh; managed API keys require preview
access. These are external prerequisites, not permissions that can be added to
`stripe login`. Do not extract the CLI's private session, switch to manual paste,
or describe the local sandbox adapter as production setup. No new app was
published, no external developer credential was created, and no live account was
used in this work.

A supported app integration must request Checkout Session writes, subscription /
invoice / product reads, customer portal session writes, and the existing webhook
setup and refund permissions, then privately provision and renew the studio's
runtime credentials. Its browser install remains one owner approval once Homie's
app integration exists. That prerequisite applies only to the optional keyed path; the keyless default does
not need it.

The completed sandbox script also passed actual subscription Checkout, the
customer portal, test-clock renewal/failure/cancellation, and Stripe's published
`checkout.session.completed` trigger fixture. See `proof/earning/stripe/` for the
passing log and the distinction between Checkout and clock-fixture ownership.
