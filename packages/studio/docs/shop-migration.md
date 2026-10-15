# Checkout migration

Run `homie-studio upgrade`, then `homie-studio shop connect`. The owner approves the official Homie Stripe App once. Do not manually deploy over the old payment handler during the drain.

The App matches existing links and webhook endpoints to this studio origin in the installing account, stops new link sessions, and waits for in-flight payments. The local tool reads D1 to confirm every completed Session already has a receipt committed by the old signed webhook. It never grants from an API read.

After the drain, the tool deploys the upgraded Worker, installs the encrypted managed key and webhook secret privately, disables old endpoints, and removes retired bindings and public link configuration. Orders, bookings and subscription ownership stay in the existing database.

Only Checkout Sessions remain. Missing, revoked or expired credentials ask for reconnection; there is no manual-key or Payment Link fallback. Managed-key preview access and App review are prerequisites for real minting.
