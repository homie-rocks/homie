# Apps proof

A fresh studio scaffolded from this checkout, with `app new welcome`, a typed build, and `dev --lan`. The proof drives real Chrome at the machine's Wi-Fi address: a wall, two touch phones and a staff tablet. It exercises the welcome queue rather than QA-only controls. The temporary studio, browser profiles and local servers are removed in `finally`.

- [Wall](wall.jpg), [customer whose turn it is](phone.jpg), [waiting customer](phone-two.jpg), [staff tablet](staff-tablet.jpg).
- [Machine-readable receipt](receipt.json): shared action, reconnect, watch, private role checks, revocation, HTTP-safe IDs and persistence across a server restart. No browser page errors.
- `packages/studio/test/apps-proof.mjs` is the reproducible harness; `apps-browser.test.mjs` runs it in the normal suite when Chrome and Wrangler are available. `HOMIE_APPS_WRANGLER` names an existing Wrangler entry point; `HOMIE_APPS_SHOTS` optionally saves compressed JPEGs.

The QR target was opened in Chrome. A physical phone camera was not used. Staff registration used Chrome's virtual WebAuthn authenticator at localhost; the test harness copied that real account session to the LAN hostname. Plain HTTP LAN cannot run passkeys. No production authentication bypass was introduced.

The same app bundle was prepared through the existing standalone web packaging path. Signed native store binaries, store submission and deployment were not performed. Native staff accounts/billing, offline writes and unbounded record storage remain outside this small addition; the public customer role is supported. Records are limited to 1,000 per collection and 8 KB each; app authors define deletion and retention using the records helper.

The build compatibility test compares an existing game's bundle bytes and digest before and after adding an app. The public catalogue distinguishes apps, while the room, assets, shop, parts, build and standalone implementation stays shared.

## Gate results

Run sequentially on this checkout with `CHROME_PATH` set to the installed Google Chrome:

| Gate | Result |
| --- | --- |
| `npm ci` | Passed |
| `npm run build` | Passed |
| `npm test` | 1,100 passed, 0 failed; 2 Stripe-mock tests skipped because `STRIPE_MOCK_URL` was absent |
| `npm run test:plugin` | 116 passed, 0 failed; optional live-site playtest skipped because `HOMIE_PLAYTEST_URL` was absent |
| `npm run validate` | Marketplace and plugin passed |
| `node scripts/desktop.mjs --check` | Packed server passed; 66 tools and five cards answered |
| `node scripts/changelog.mjs --sync` | Both changelogs match |
| Final app/site/parts wording checks | 33 passed |
| Final fresh-studio Chrome proof | Passed; screenshots and receipt alongside this file |

The cached pinned Wrangler was linked locally for the optional game browser tests. Both the ten-update and thirty-update play/watch proofs passed, preserving rooms and seats. Earlier attempts exposed a timing-guard rejection that dev remembered without retrying: dev now resamples only that wall-clock rejection, at ten-second intervals, at most three times, keeping the last good build. The guard itself is unchanged. A payment timing assertion passed on isolated retry and in the final full suite.

Recording, sound and performance plugin tests passed on this run. Free disk space increased during the task and never crossed the requested 3 GB stop threshold. The desktop package/staging tree, diagnostic copy, temporary studios, local servers and temporary Wrangler links were removed. No version number or released changelog section changed. No push, pull request or deployment.
