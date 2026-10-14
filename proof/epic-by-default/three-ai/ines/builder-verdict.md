# Highline Bouldering — local trial verdict

Local review by the builder, not an independent review. 2026-10-13. Homie toolkit 0.50.0, installed from the provided packed build. No deployment, paid media, payment connection or external messages.

Open the [wall](http://127.0.0.1:8833/climb/tv?room=highline), [phone](http://127.0.0.1:8833/climb/open?room=highline), or [shop](http://127.0.0.1:8833/shop/). Same-Wi-Fi phone address: http://192.168.1.250:8833/climb/open?room=highline . The wall QR uses that address.

| Need | Verdict | Evidence and remaining work |
|---|---|---|
| A screen of Highline's actual walls | Partly: editable prototype; actual mapping not met | `wall.png` shows an original spatial climbing-wall scene, prominently labelled provisional. No actual photo or floor plan was supplied. `apps/climb/layout.json` defines editable wall faces; staff can position routes. Actual walls and hold coordinates still need reference material. Sample routes are explicitly labelled. |
| This week's new routes light up as setters finish | Met locally with sample routes | `wall-before-setter.png`, `wall-after-setter.png`, `staff.png`, `browser-checks.json`: authenticated staff opened a route; this week's count increased and dim holds lit. Versioned records persist. Real gym inventory is still needed. |
| Climbers log a send by phone and see it on the wall | Met locally | `phone.png`, `phone-receipt.png`, `wall-send.png`: a real browser button wrote a durable send, the wall displayed the test name and route, and its holds traced. Homie's wall + two-phone check changed the count 2 → 3 and passed reconnect. A second phone followed the saved link to the same receipt. |
| Day pass $22 and “name a route” $15 | Met as price previews | `shop.png`, both app surfaces and `shop.json`. CAD is explicitly assumed. No booking capacity, admission redemption, or paid naming fulfillment is claimed. |
| Actual payments | Not met; intentionally disabled locally | The built-in shop shows PREVIEW and disabled checkout. No Stripe connection or real charge was attempted. This remains an explicit future capability, not a failed local sale. |
| Running locally, not online | Met | Local server at port 8833, two Chrome phone viewports and a 1920×1080 wall. No deploy command was run. |

## Checks

- `build --types` passed; full output in `build.log`. Strict view/rules types and deterministic room checks passed.
- `homie-check.json`: shared send action and reconnect passed; setter scene, logging, prices and local UI assertions met. Overall `ok: false` is intentional because actual walls and payments remain unmet. Those needs were not removed or weakened.
- `browser-checks.json`: staff completion, send, same receipt on a second phone, reload, all screens closed and reopened, and unknown-reference handling passed. Browser page errors: none.
- Public route creation was refused with 403. A staff link without an authenticated account was refused with 401. Staff testing used an explicitly provisioned local-only account/session; production permissions were not weakened. The local test session expires after 24 hours.
- `final-review.json`: simulated 503 submission failure produced an actionable error and no false receipt; retry succeeded. Portrait horizontal overflow is zero (390/390). Reduced-motion mode was checked. QR bottom is 998px within a 1080px wall viewport.
- Reviewed actual Chrome captures: 1920×1080 wall, 390×844 portrait and 844×390 landscape. Portrait focuses on the selected route and scrolls to receipt/offers. Landscape retains the scene and uses vertical scrolling for lower controls. Copy button and native form controls remain reachable by scrolling. This is viewport emulation, not a test on a physical handset.
- The wall's provisional caption no longer overlaps face captions; the whole QR is visible. Phone share control no longer covers the live status.

## Files and limits

Original walls/holds/volumes and SVG rendering; no copied example artwork or paid assets. Catalogue search found no climbing part. Source examples were read only. General engine packages were inspected; Homie's records, links and server room are used.

App collections use the toolkit's small operational records store (up to 1,000 records per collection). A production send history will need archival/pagination and real route validation/hold coordinates. Public sends contain only the chosen public display name and route; they are self-reported climbs, not verified athletic results. Staff workflow uses normal version conflicts; reload and retry is required on conflict.

The wall and phone are left running locally. `scripts/show-local.mjs` opens wall, phone and an authenticated local test setter view. Private test-session material lives under ignored `.studio/private/`, never in public site assets.
