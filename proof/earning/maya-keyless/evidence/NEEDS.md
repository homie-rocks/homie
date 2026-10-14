# Final pack — Coldsmoke Tuning

Studio: `/private/tmp/homie-maya-keyless-c9FGca/coldsmoke`.
Pack: `/tmp/homie-keyless-final-0.51.0.tgz`.
SHA256: `eff2ef9b3ef2e7858ede2a780dae4055b332caf538b751230ec9a32f7a2857b3`.
Installed toolkit: 490 files compared to immutable archive, zero differences. Original trial evidence, old app snapshot and database are preserved separately in `../evidence-original-trial/`.

| Need | Custom provider/UI acceptance | Generic displayed-outcome scope |
|---|---|---|
| Staff publishes, owner AI syncs | Fresh timestamped slots published in staff UI; complete manifest creates one-seat links. Base64 binding written verbatim. | Staff sees retained published, synced slots. |
| Phone opens real payment; payment secures seat | Actual buy.stripe.com page, local order matched to Checkout client_reference_id, tok_visa API payment succeeded, signed webhook confirmed booking. | Shows the same retained paid receipt. It does not charge Stripe. |
| Pending does not exclude another guest | A separate guest opened the same source slot before payment; target also had an actual open Checkout. | Provider transition remains scoped to custom acceptance. |
| Wall updates from pending to paid | Real pending and paid captures; one clean confirmed ski ticket after signed expiry removes unpaid proof requests. | Shows the retained confirmed booking on the wall. |
| Full capacity refused | Source refused after initial payment; moved-full target refused after resync (409). | Displays target Full and source Book & pay. |
| Active target move refused | Staff UI PUT returned 409 and preserved v2/source. | Refusal itself is custom acceptance. |
| Pause both affected slots | Complete manifest active:false; provider links inactive, open target session expired, signed events released both unpaid bookings. | Provider transition remains scoped to custom acceptance. |
| Versioned staff move | Paused move succeeded v2→v3; stale v2 update returned 409. | Staff sees target time and v3 on that same record. |
| Reviewed capacity after move | Fresh confirmed counts: source 0, target 1. Source completed 1/limit 2, active; target inactive, zero available. Source actually accepted a fresh checkout, then expired without payment. | Confirms visible source-open/target-full outcome. |
| Public cannot write staff records | Public slot write returned 403. | Custom authorization proof. |

Machine results and exact object IDs: `acceptance.json`. Generic final verdict: `generic-check.json`. Both are separate; displayed labels are never the evidence that money was charged.

## Captures
- `phone-stripe-payment-link.png`: actual Stripe sandbox UI; card fields untouched.
- `phone-pending.png`, `wall-pending.png`: unpaid state.
- `phone-paid-before-pause.png`: clean customer paid receipt at source, source Full.
- `wall-paid.png`: clean source-paid rail after unpaid requests were released.
- `staff-move-refused.png`: active-target refusal.
- `phone-moved.png`, `wall-moved.png`, `staff-moved.png`: paid target and version after review.
- `generic-shots/`: checker captures of retained real paid fixtures.

## Capacity interpretation
Initial native limit = capacity = 1. After move, fresh counts produce source logical budget `1 completed + 1 capacity - 0 confirmed = 2`; target logical budget `0 + 1 - 1 = 0`. Stripe's native minimum limit is 1, so the target stores native limit 1 but is inactive; the helper configuration's logical limit is 0 and Worker availability is 0. No extra seat is sold. The source's remaining availability is exactly 1.

## Honest limits
This is one real sandbox payment and local Chrome automation, using phone/tablet/wall viewport sizes, not a physical handset test. No live charge, card entry, keyed Worker adapter, production deploy, push or media spend. Only the explicit Homie sandbox CLI profile was used. Menus, recurring payments and broader lifecycle/refund flows are left to the parent's independent verification.

Price (CAD 60), service scope and Oct 17 sample windows remain provisional. Maya must confirm operating details before real use. Staff uses packaged local-test authentication; production passkey sign-in is not tested. Pausing, waiting for signed events, fresh counting and resync are owner-AI operations, not automatic effects of the staff move. Unpaid requests never hold exclusive seats. QR is loopback-only. The bare URL may lose selection in the sandboxed frame; explicit tracking links are the verified return route.

The wall is an original illustrative workshop, not Maya's floor plan. Local visual review is by the builder, not independent. No claim about untested scale/offline behavior. After verification, helper.close deactivates proof links; private env files are removed and only harness-owned processes stopped. Retained database fixtures remain available for parent review, but payment controls require a fresh authorized helper connection to run again.
