# Stripe connection research — 2026-10-15

See [round 2 status](stripe-round2-status.md). This implementation is not ready for
release: key lifecycle expiry/rotation and real preview contracts are unfinished.

Stripe's [managed-key guide](https://docs.stripe.com/stripe-apps/api-authentication/managed-api-keys)
documents App `api_key_write`, developer credentials with Connect permission,
`Stripe-Context`, and RSA-encrypted live delivery. Its prose names RSA-OAEP, while
its Node example imports RSA-OAEP-256; local decryption accepts those two algorithms
with A256GCM. Only test-mode plaintext tokens are re-encrypted before delivery;
there is no live plaintext fallback. Synthetic tests are not recorded responses.

The [OAuth guide](https://docs.stripe.com/stripe-apps/api-authentication/oauth)
uses the App developer secret for code exchange. The service separates that from
the restricted IAM credential, and uses the OAuth access token for v1 migration
calls. The service is configured as its own Worker with its own setup DB. OAuth
access tokens remain in that temporary setup state; no studio webhook signing
secret passes through it.

Webhook setup uses the studio Worker key and stores the endpoint secret in the
studio DB. The [permission reference](https://docs.stripe.com/stripe-apps/reference/permissions)
describes object permissions, but does not resolve whether the managed-key preview
allows an App to mint permissions beyond its own grant. Both mint-only and mirrored
App manifests are available behind `--permission-model`; Stripe must resolve the
ceiling before either configuration is released.

The remote callback cannot mint. A one-use confirmation redirects to the local
127.0.0.1 listener; the owner sees the account, and a same-origin local POST sends
both confirmation and collect capability. The install URL is opened privately.
Provider objects, retrieved using the studio key, are required before fulfilment;
a signed event body alone is insufficient.
