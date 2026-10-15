# Stripe connection: managed keys and per-purchase Checkout

The current contract is [SHOP.md](../packages/studio/shop/SHOP.md). The previous Payment Link architecture is removed in this release, including its planner, manual key entry, public assets and slot synchronization.

Stripe's [managed-key preview](https://docs.stripe.com/stripe-apps/api-authentication/managed-api-keys) documents `POST /v2/iam/api_keys`, developer App credentials with `api_key_write` Connect permission, `Stripe-Context`, and encrypted delivery to an RSA public key. The [OAuth flow](https://docs.stripe.com/stripe-apps/api-authentication/oauth) establishes the installing account from a one-use code. The local tool owns the private key; Homie's service stores only ciphertext until acknowledgement and audit identities for lifecycle management. No payment goes through Homie.

Preview approval and App review are required before real minting. Tests currently use the documented JSON/JWE contract. The App service contains the single real mint acceptance test for after approval; real sandbox payment acceptance is separate and cannot prove preview access.

The owner runs one tool and approves Homie once. Upgrade retains the old deployment during the in-flight drain, verifies its signed D1 receipts, then installs the Session-only Worker connection. See [migration](../packages/studio/docs/shop-migration.md).
