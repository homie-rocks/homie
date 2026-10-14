# Commands and provenance
Tarball SHA256: c8be77dd2718ef52964903b2ba9c73565ebfa5667e4dd73474593d3bce7269b9
Scaffold: node pack/package/bin/homie-studio.mjs new studio --kind business --name 'Coldsmoke Tuning'
Scaffold auto-install failed (unavailable registry version); fixed: npm install --save-dev /tmp/homie-rocks-studio-0.51.0.tgz
Then: codex new tune --kind app; app new tune --from jobs; npm install; style init tune; parts find 'workshop booking scene' (no matching part); build.
Only packed toolkit inspected. No source repository or earlier trial inspected. CSS illustration original, no generated media.

Acceptance commands (from studio/):
- node sandbox-runner.mjs (startStripeSandbox with origin http://127.0.0.1:8787, profile Homie sandbox; private temporary binding files only)
- node acceptance.mjs (Chrome phone/wall/staff, actual Checkout payment)
- node finish-acceptance.mjs (second hold, actual Stripe expiry, persistence, version conflict)
- node final-ui.mjs (unknown reference, reload, portrait/landscape)
- node node_modules/@homie-rocks/studio/bin/homie-studio.mjs check tune --url http://127.0.0.1:8787 --shots ../evidence/generic-final
- node node_modules/@homie-rocks/studio/bin/homie-studio.mjs build

Stripe commands are reproduced in acceptance.mjs / finish-acceptance.mjs. Every invocation specifies --project-name 'Homie sandbox'. Used GET /v1/payment_pages/:session, POST /v1/payment_methods with card[token]=tok_visa and published fixture billing details, POST /v1/payment_pages/:session/confirm with expected_amount=6500. No card-number form entry, no credential inspection, no live payment, no offline fixture.
Published fixture: https://raw.githubusercontent.com/stripe/stripe-cli/master/pkg/fixtures/triggers/checkout.session.completed.json
- homie-studio codex tune; homie-studio build (final build)
- homie-studio dev --stop; SIGTERM to recorded sandbox runner; cleanup verifies recorded descendants and browsers gone and deletes private variable files.
