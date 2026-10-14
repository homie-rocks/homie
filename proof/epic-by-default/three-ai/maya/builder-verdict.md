# Coldsmoke Tuning — local trial verdict

Local builder review, not an independent review. Tested in real Google Chrome at a 1920×1080 wall viewport, 390×844 phone, 844×390 landscape phone and 1024×768 staff tablet. Screenshots are actual rendered app captures.

| Maya's need | Verdict | Evidence |
| --- | --- | --- |
| A wall of recognizable boards and skis moving through wax, edge and base repair | Met | `wall-edge.png`, `wall-wax.png`, final `wall.png`; authenticated staff UI moved a full-tune ski record from intake to edge, wax and ready. A repair board and basic-wax board were separately booked and advanced. `wall-poses.json` confirms final record-driven positions. |
| Customers book a tune on a phone | Met as booking requests | `phone-booking-top.png`, `phone-booking-controls.png`, `phone-receipt.png`; actual durable creation. Service, gear type, nickname and requested drop-off date. Staff confirm at intake. No capacity calendar or guaranteed appointment reservation is claimed. |
| Customers watch their own gear | Met | `phone-edge.png`, `phone.png`, `phone-tracking-actions.png`; stable tracking URL on a second isolated browser; reload restores the exact reference. A fresh browser after all flow-test browsers closed and a dev-server restart still showed the same ready skis. |
| Basic wax $25, full tune $65, base repair from $40 | Met | Visible on wall, booking choices, own receipt and `/shop/`; CAD assumed. Repair has quote-after-inspection wording. `shop.png` shows disabled checkout. |
| Decide and keep going | Met | Chosen visual direction, workflow, service routes and CAD assumption are recorded in `apps/workshop/CODEX.md`. No paid provider used. |
| Do not put it online; show it locally | Met | Local server remains at http://127.0.0.1:8893. LAN phone address is http://192.168.1.250:8893/workshop/open?room=shop. Nothing deployed; no external messages. |

## Verification

- Homie 0.50.0 packed toolkit pinned to `file:/tmp/homie-050-pack/homie-rocks-studio-0.50.0.tgz`.
- Strict type build and rules validation passed. Durable records live in local D1, not transient room memory.
- Built-in wall/two-phone shared-action and reconnect check passed. Its executable booking, own-gear reload and price needs passed (`.checks-result.json`).
- The built-in aggregate still returns `ok:false` because the staff-motion need intentionally has no public-only action assertion: its checker cannot operate an authenticated staff surface. That need was verified separately through the real authenticated staff UI in `flows.mjs`, with before/after screenshots. No generated check result was rewritten to imply that the built-in checker tested staff.
- Public stage update: HTTP 403. Forged creation at ready: HTTP 400. Stale authorized version: HTTP 409. Staff permission was not weakened.
- Unknown reference gives a clear message. Blocked real create request reports “Request was not saved”; no false success.
- Reduced motion yields a zero-second gear transition. Native controls have visible focus and at least 46 px control height.
- Empty workshop observed before sample bookings (`wall-before.png`); final three records carry “Demo” labels and contain no personal contact information.
- The long flow script's final return navigation coincided with a dev rebuild and failed with connection refused. `final-captures.mjs` then independently verified the return in a fresh browser after the server was ready. That interruption is retained in `flows.log`, rather than hidden.

## Visual judgement and limits

Original layered SVG scene: distinct skis and boards, tool benches, wax shine, base-repair mark, lights and collection rack. Staff changes interpolate gear between physical stations. The final wall fits 1080p with its booking QR visible; phone tracking emphasizes the customer's own gear. Staff controls are a scroll below the same scene.

The illustration is conceptual, not a measured shop floor plan. Gear labels can crowd at high job density; this local trial verifies a small workshop load, not a full seasonal queue. A real phone on Wi-Fi was not physically available; Chrome phone emulation was used. CAD is an assumption. Payments are not connected, booking is not a capacity reservation, and repair prices remain estimates until agreed in shop.

## Built from

Homie's records, room notifications, QR and preference bridge. Service menu from Switchback Cycle Works' workshop, MIT, imported with verified file hashes and retained credit. Original Coldsmoke SVG scenery and gear. No generated paid media, purchases, deployment or example-source edits.
