# Coldsmoke Tuning — local acceptance

Built only from supplied tarball, SHA256 `c8be77dd2718ef52964903b2ba9c73565ebfa5667e4dd73474593d3bce7269b9`. Studio retained at `../studio/`. No deploy, push, remote plugin install or generated-media spend.

| Need | Status | Observed evidence |
|---|---|---|
| Customer books from phone | Met locally | 390×844 Chrome touch emulation, actual booking button creates real Checkout hold; phone-before-payment.png, phone-held.png |
| Last seat stays held | Met locally | One-seat slot; second independent customer gets HTTP 409 capacity refusal while first awaits payment (acceptance.json) |
| Customer pays, booking confirms | Met in real Stripe sandbox | Published Stripe fixture API approach returns complete/paid; GET session confirms livemode:false; verified webhook changes wall to Confirmed · paid; phone-after-stripe.png, wall-after-stripe.png |
| Expiry releases capacity | Met in real Stripe sandbox | Second genuine Checkout session expired through Stripe CLI; wall shows Released, slot returns to 1 available; finish-acceptance.json, wall-expired.png |
| Workshop wall shows bookings | Met locally | Persistent booking IDs render as skis on slot rails; held, paid, moved and released captures |
| Staff move bookings | Met locally | Authenticated local test staff moves paid booking 09:00 → 10:00 via UI; wall and saved link follow; staff-moved.png, wall-moved.png |
| Role and version safeguards | Met for tested paths | Anonymous write with role=staff refused (404 private role link required); stale staff version refused (409) |
| Return to booking | Met for saved link | Reopened in fresh browser after original browser closed; confirmed booking and moved slot persist; phone-confirmed-final.png |
| Physical phone / LAN use | Partly | Phone viewport and touch emulated in Chrome. No physical device test. Loopback QR explicitly says local computer only. |
| Production payment authorization | Not met / not attempted | Pack documents unresolved one-approval runtime Checkout integration. Desktop sandbox adapter is test-only. |
| Real prices, schedule and shop layout | Partly | CAD $65, edge + wax service, two 16 Oct demo slots and illustrated workshop are explicit review assumptions. |

## Verification and limitations

`build` passes the toolkit strict type checks and rules guard/smoke run. Generic `homie-studio check` ran twice and exited non-green: phone and wall selectors passed, payment and move have no executable generic assertions. These are separately proved through custom browser/provider acceptance, not relabelled as generic passes. Full output and needs JSON retained. No generic check timeout was omitted.

Initial custom payment attempts timed out before any buy request. Diagnosis: records-only page includes the records bridge but omits the shop bridge although HOMIE_NET.shop is true. App repaired through public APIs by restoring the starter's server room shell with stationary participant anchors; business truth stays in D1 records. No toolkit source modified. Diagnostic script/log retained.

Initial expiry setup click made no request because selected-slot changes did not immediately update button disabled state. Fixed onchange handling. Successful second run in finish-acceptance.json proves real expiry/release. That run later hit a detached frame after viewport rotation while testing unknown-reference UI; final-ui.mjs reacquires the frame and reruns those UI checks. Failures remain in logs rather than being erased.

Public records contain slot, quantity and payment state only. Local test role cookie exercised actual staff authorization checks; real passkey onboarding and production staff grants were not tested. Full-target staff move rejection, refund behavior, long outage recovery and simultaneous race stress were not tested. Released bookings remain visibly grey on the rail. No gear/customer contact intake, arbitrary schedule editor, fulfillment stages or messaging was requested or implemented. Room shell still includes game-oriented Room/Quick play chrome. This is a working local prototype, not production sign-off.

Provider proof used only existing CLI profile `Homie sandbox`; no offline simulation was used. All payment actions are test-mode. Provider session IDs and booking IDs are in acceptance.json for parent review. Do not treat the desktop adapter as a production connection.

## Sources and reproduction

App sources: `../studio/apps/tune/{app.json,index.html,src/view.ts,src/rules.ts,src/move.ts,CODEX.md}`; service catalogue: `../studio/shop.json`; provenance: package.json/package-lock.json and source-sha256.txt. Browser tests and sandbox runner remain in studio root. Run `node sandbox-runner.mjs` from studio to reproduce with authorized sandbox login; then open `/tune/open` and `/tune/tv` at its printed local address. Requires desktop Stripe CLI and Chrome. The studio's local D1 retains the paid demo and released demo records. The generic checker uses isolated empty records.

Final UI retry passed: unknown reference displays not found, reload restores the correct tracking link, portrait and landscape have no horizontal overflow (final-ui.json). Final build passed, with nonfatal Codex picture warnings because evidence is deliberately outside the studio directory. Screenshots are available directly under evidence/.

Cleanup: dev server, Stripe listener/adapter and test browsers stopped; temporary .dev.vars and .wrangler/.dev.vars deleted; local test credential removed. PID records and cleanup verification are retained. Studio and its local booking database remain for parent review/deletion.
