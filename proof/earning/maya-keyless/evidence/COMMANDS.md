# Final immutable-pack verification command record
Workspace: `/private/tmp/homie-maya-keyless-c9FGca/coldsmoke`.
Original trial preserved in sibling `evidence-original-trial/`, including original screenshots/receipts, app-at-handoff, acceptance script and archived local D1 state. Existing app retained; fresh local state and timestamped slot IDs avoid prior residue.

```
shasum -a 256 /tmp/homie-keyless-final-0.51.0.tgz
mv evidence evidence-original-trial
mkdir evidence
cp /tmp/homie-keyless-final-0.51.0.tgz evidence/
npm install --prefix coldsmoke --no-audit --no-fund
node scripts/final-acceptance.mjs
```
Before install, `devDependencies.@homie-rocks/studio` was set to `file:/tmp/homie-keyless-final-0.51.0.tgz`. Tar-member comparison confirms all 490 installed toolkit files match. Only app sources/test harness were edited; no toolkit changes or source-repository inspection.

The exact executable record is `scripts/final-acceptance.mjs` (also saved under evidence/sources). It uses:
- `startKeylessStripeSandbox`, explicit profile `Homie sandbox`, unique `maya-keyless-<timestamp>` name.
- `helper.links` for IDs; base64-prefixed link binding written verbatim to private mode-0600 `.dev.vars` and `.wrangler/.dev.vars`. No JSON parsing or rewriting of this binding; no runtime key or API base.
- Installed puppeteer-core and `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- Staff UI publishing; public `shop.book` flow through actual Chrome clicks; local records bridge for display/moves.
- Checkout session lookup by Payment Link ID and client_reference_id equal to local order; payment_pages GET, payment_methods POST with `card[token]=tok_visa` and published fixture identity, payment_pages confirm. No card form input.
- Complete manifest pause through `helper.sync(...active:false)`, refreshed bindings and dev restart; signed expiry verification; versioned staff UI move; fresh confirmed-count read; reviewed sync with active true and dev restart.
- `homie-studio check tune --url http://127.0.0.1:8917 --no-isolate --shots ../evidence/generic-shots --json` on retained real sandbox-paid fixtures. Generic assertions test displayed outcomes; provider transitions remain proven by custom acceptance.
- `helper.close()` to deactivate proof links and stop forwarding; only this harness's dev processes stopped; private env/test credential files removed.

The dev command is `node <installed toolkit>/bin/homie-studio.mjs dev --port 8917 --no-local-ai`. It builds and applies local migrations. One initial harness invocation used the wrong working-directory redirect and did not run; corrected immediately. No deploy, push, other Stripe profile, live money or media spending.
