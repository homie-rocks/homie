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
