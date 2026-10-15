# Keyless shop setup and migration

Use `stripe_shop_plan` with Stripe's official plugin to perform the returned operations. Supply each new response as `{method,path,params,body}` in `observations`; earlier responses are saved automatically. Product and price discovery uses metadata searches. Payment Links use Stripe's paginated list API with expanded line items, then match studio, origin and revision metadata locally (Stripe has no Payment Link search endpoint). No creation is planned before discovery completes.

For CLI workflows, pipe an array of these responses, or `{observations:[...]}`, into `homie-studio shop observe`. It saves the responses and returns the next dependency batch. `shop plan` resumes without `--have`. Never include credentials or webhook creation responses.

Old verifications without a billing portal ID discover and reuse the existing portal before planning creation. Old verifications without an account ID adopt the official CLI's signed-in account only after reading and matching their saved Payment Links. A known different account is still refused. Verification freshness and configuration checks still apply.

`stripe_webhook` returns a job. Read `studio_job`: while browser approval is pending, `events` contains `{type:"stripe.pairing",code,url}`. Show that code and URL to the owner. A saved valid Stripe login emits no pairing event and needs no new approval. Secrets never enter the event.
