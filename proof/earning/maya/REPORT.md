# Coldsmoke Tuning — local acceptance

Built from the supplied `homie-rocks-studio-0.50.6.tgz` (0.51 work-in-progress API). Studio retained at `../coldsmoke/`. No deployment, push, real Stripe sign-in, real keys, card entry, payment, or generated-media spending. Stripe belongs to Maya; Homie takes no cut.

| Maya's need | Verdict | Evidence and limits |
|---|---|---|
| Customers book a tune from their phone | **Met locally** | Actual Chrome phone viewport, 390×844, selected slot and clicked the app's booking button; supported `shop.book` created a durable booking. `phone-book-390x844.png`, `flows.jsonl`, `acceptance.jsonl`. Emulated phone, not a physical handset. |
| Customers pay | **Partly** | Supplied offline fixture Checkout and signed successful-payment webhook exercised; booking became confirmed. `checkout-simulation-390x844.png`, `wall-confirmed-1920x1080.png`. **Real charging is not met or verified**, including real Stripe test mode. |
| Their slot is held | **Met in simulation / partly overall** | Held before Checkout; second buyer refused with 409; fixture payment confirmed the booking. Expiry released capacity. `wall-held-1920x1080.png`, `phone-released-390x844.png`, `acceptance.jsonl`. Real provider integration remains unavailable. |
| Workshop wall shows bookings | **Met locally** | Separate 1920×1080 wall browser reflected held, confirmed and moved bookings. Original ski rail illustration, public-safe references only. `wall-empty-1920x1080.png`, `wall-moved-1920x1080.png`. |
| Staff can move bookings | **Met locally** | Existing local owner sign-in and private staff role; activated actual staff move control, 09:00 → 10:00. Phone and wall followed. `staff-move-1024x900.png`, `phone-moved-390x844.png`. Customer writes 403; full destination refused; stale version 409. Tested owner acting in staff role, not a separately enrolled employee/passkey. |

## What was implemented

Four staff-created capacity-one slots on 15 October 2026. Assumed service: full ski tune, edge sharpen + hot wax, CAD 85 per pair. Price and schedule are demo choices, not Maya-approved business terms. Toolkit D1 records and booking capacity triggers are authoritative; server rules carry refresh notices, with two-second record refresh. Public roles read only. Versioned staff moves, customer receipt/tracking link, saved receipt through the supported saves bridge, unknown-reference handling, responsive portrait/landscape views. No customer personal information collected or displayed.

Strict typed build passed (`build.log`). Fresh browser after prior screens closed retained the confirmed booking and moved slot; reload and tracking-link access passed. Portrait had no horizontal overflow; reduced-motion preference was exercised. Captures are actual browser viewports, not resized desktop images. Visual inspection was by the builder, not an independent reviewer.

## Authorization limits versus implementation gaps

- **Authorization:** No Stripe account was supplied; no external account or key was requested. Real payment verification could not be performed within the authorized local-only scope.
- **Toolkit integration gap:** Packed SHOP.md explicitly says capacity Checkout requires a runtime Checkout connection; the default one-approval Payment Links flow cannot provide paid holds. This is not solved by the fixture and is not merely waiting for Maya to paste a key.
- **Toolkit local config issue:** Homie generates `.wrangler/homie-dev.wrangler.json`; root `.dev.vars` alone was not loaded. `fixture.mjs` now writes the fixture bindings in both local locations. Both contain only the toolkit's fake credentials.
- **Toolkit return wording:** The generic `/shop/thanks` page says “Paid” and claims a Stripe email receipt, even with the offline fixture. `checkout-result-390x844.png` captures that unmodified toolkit page. Those claims are **not true for this simulation**; no email receipt or money transfer occurred. The app and fixture Checkout explicitly label simulation.
- **Toolkit ticket helper mismatch:** The shell's optional `homie-app-ticket` message only accepts 32 hex characters, while booking IDs start `ord_`. The app uses supported saves and explicit tracking links instead; returning by link was proven.
- **Checks with failures retained:** Generic `homie-studio check` connected wall and two phones, created a hold, then timed out (`shared-check.log`); no green generic-check claim. Dedicated Chrome flows prove the behaviors above. The in-place expiry UI assertion also timed out; backend release and a fresh phone showing Released passed. This leaves same-tab automatic expiry feedback incompletely verified.
- Staff movement was exercised via the real button's browser DOM activation after native off-screen automation stalled. A physical touchscreen staff usability test remains unperformed. Clipboard copying was not independently verified; opening the explicit tracking link was.
- Single-day schedule and local-only demonstration. No production deployment, ongoing schedule editor, real staff onboarding, or physical LAN/QR test was requested or performed. The loopback fixture deliberately stays on this machine.

## Inspect and rerun locally

Studio: `../coldsmoke/`. Source: `apps/tune/index.html`, `src/view.ts`, `app.json`, `CODEX.md`, and `shop.json`. Local D1 data retained under `.wrangler/state`. `provenance.json` records the tarball SHA-256 and installed dependency path.

From the studio, run `node fixture.mjs` in one terminal; wait for “Offline fixture ready”. Run `npm run dev -- --port 8787` in another. Use `http://127.0.0.1:8787/tune/open` for phone and `/tune/tv` for wall. If 8787 is occupied, stop and choose matching fixture/dev origins before testing; the fixture must target the actual server. Generate a fresh local owner sign-in with `homie-studio office link --url http://127.0.0.1:8787`, submit its sign-in button, and use `homie-studio app role tune staff --url http://127.0.0.1:8787` for the staff address. Keep private links private. Stop both terminals when done.

Evidence scripts `verify.mjs`, `verify-more.mjs`, and `verify-return.mjs` retain the exploratory test progression, including failures; they are not an idempotent all-green test suite. Successful assertions are in `acceptance.jsonl`; initial successful fixture payment is in `flows.jsonl`.

All processes started for this task are stopped before handover; see `pids.jsonl` and `process-cleanup.json`. Temporary studio intentionally retained for the parent to inspect and delete.
