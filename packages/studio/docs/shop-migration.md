# Checkout migration — unreleased

Do not use this branch for a production cutover yet. See
[round 2 status](../../../docs/stripe-round2-status.md) for remaining release gates.

The intended sequence implemented by connect is: origin proof and local account
confirmation; encrypted key delivery; private key installation; Checkout deployment;
Worker-owned webhook bootstrap; link deactivation and immediate expiry of open
link sessions; cursor-based receipt drain; old hook retirement and acknowledgement.
The new webhook is excluded from retirement. Polling is at least 30 seconds.
Completed asynchronous unpaid sessions do not hold up deployment.

Legacy `purchase-links-v1` orders retain their payment/subscription ownership
bindings. A compatibility path verifies pending purchase link sessions through
Stripe. The requested real 0.53 database fixture and complete shop-link async
migration acceptance have not been supplied/proven. In particular, older deployments
without the well-known proof route need a verified bootstrap rollout; there is no
origin-proof bypass. Crash recovery, OAuth refresh for long migrations and managed-key
expiry/rotation remain unfinished. Existing rows are retained, but that alone is
not evidence that every legacy purchase flow survives migration.
