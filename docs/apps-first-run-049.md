> Historical release evidence. Current Stripe setup and payment behavior are documented in [Studio Checkout](../packages/studio/shop/SHOP.md); the former Payment Link mode is removed.

# Apps first run, 0.49.0

Business and cause scaffolds proceed from the owner's request through build and checks. Use `studio_scaffold` with `kind: "business"` or `kind: "cause"`, then `app new live --from quiz|gathering|giving|jobs`. The queue remains `--from welcome`. These are opt-in starters; existing authored studios and games are unchanged.

The giving wall records clearly labelled intentions, not verified payments. `shop init --giving --currency cad` supplies separate one-time and monthly gift choices. `shop connect` uses the organisation's own Stripe Payment Links; payment never depends on homie.rocks. Set `giving.receiptText` in shop.json to the organisation's own receipt/tax wording. Homie supplies none. A service request is not a confirmed reservation.

Next app capability: booking calendars with availability and seat capacity, including staff confirmation and cancellation. This release's jobs starter collects requests only.

Dependency audit on 2026-10-13: `npm audit --json` reports zero vulnerabilities. Agents/MCP and Wrangler were updated; the root lockfile pins Miniflare's sharp to 0.35.5. No reported advisories remain. Fresh customer installs are checked separately in the proof logs.

Reproduce the customer trials from the repository:

```sh
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" HOMIE_FIRST_RUN_SHOTS="$PWD/proof/apps-first-run" node packages/studio/test/apps-first-run-proof.mjs
```

The harness packs this checkout, calls the MCP scaffold, creates each app, substitutes only the unpublished toolkit tarball, installs, builds with strict types, starts dev with 8787 occupied, and runs the text-mode wall/two-phone/reconnect check. Each temporary studio is removed before the next. Exact per-studio commands and real Chrome wall/phone captures are under `proof/apps-first-run/{cafe,volunteer,food-bank,bike-shop}/`. Phone captures use Chrome touch emulation, not physical phones. No deploy or real payment is performed.

| Brief | Regression evidence |
| --- | --- |
| A | `apps-first-run.test.mjs`: dependency declaration; `apps-first-run-proof.mjs`: four packed installs and strict builds, also a dedicated CI job |
| B | Four real text checks; wall/two-phone action and reconnect; `.studio/checks/latest.json`; screenshots wait for computed cover visibility |
| C | `codex-hooks.test.mjs`: actual hook stdin with exec transcript; `grok-hooks.test.mjs`: requested deploy and quoted documentation; shared Claude hook module covered by plugin suite |
| D | Business scaffold assertions, `authoring-guides.test.mjs`, and fresh build output assertions for app hero paths |
| E | `apps-browser.test.mjs`: renamed wall title, blurb and waiting label are rendered in Chrome |
| F | Scaffold/page-directory and header-link assertions; build reports landing takeover; starter site README documents `/open` |
| G | Shop renderer regression; bike-shop Chrome preview shows three CAD services without Stripe |
| H | Currency/preset, recurring Stripe request shape, and organisation receipt-wording tests; food-bank monthly interaction and six gift choices in Chrome |
| I | Four starter schema checks and fresh end-to-end trials |
| J | `dev-deploy.test.mjs`: occupied foreign port remains untouched; four trials start with 8787 occupied |
| K | `apps-browser.test.mjs`: real Chrome with `--disable-webgl` displays useful fallback and live controls |
| L | Grok client identity regression and setup wording; remote homie.rocks feedback ingestion is outside this repository |
| M | Root and fresh-install npm audit logs; root audit has zero vulnerabilities |

Capture directories contain `wall.jpg`, `phone.jpg`, `phone-two.jpg`, `commands.txt`, and install/build/dev/check logs. Giving and services also include `shop.png`; giving includes `monthly-phone.png`.
