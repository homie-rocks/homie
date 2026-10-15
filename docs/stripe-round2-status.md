# Stripe round 2 — superseded by RAK design

Provider retrieval before fulfilment, legacy order reconciliation, 401-only
reconnect, free-only readiness and cutover drain checks are retained. The
managed-key/loopback service design is removed. See [the RAK owner guide](stripe-rak-owner-guide.md)
for current proof and release gates; earlier synthetic tests do not prove RAK
permissions, uninstall behavior or developer-key isolation.
