---
name: Coldsmoke Tuning
tagline: A sharper edge. A reserved place on the rail.
palette:
  bg: '#102d2d'
  ink: '#f5efdf'
  accent: '#ebae77'
---
# Coldsmoke Tuning

## Their words
“Customers book a tune from their phone and pay; the slot is held for them. I want a workshop wall showing bookings and staff able to move them.”

## Scene
An original illustrated workshop: pairs of skis hang from a copper rail under reserved times, above an edge/wax bench. This is a conceptual illustration, not Maya's actual floor plan. Dark pine, warm ivory and copper; serif headlines and native legible controls. Confirmed records place the skis. Held skis are translucent. Polling restores durable truth every two seconds.

## People and surfaces
Guests choose a slot on a phone and keep a public-safe receipt link. The wall displays time, reference and simulation state without personal information. Signed-in staff move bookings with version checks. Owner authorization uses the existing local office sign-in.

## Offers
Assumption: full ski tune, edge sharpen and hot wax, CAD 85 per pair. Four one-hour appointments on 15 October 2026, one booking per slot. Editable demonstration schedule and price. All money flows use the packaged offline fixture. No real Stripe account supplied; Homie takes no cut and Stripe belongs to Maya.

## Needs
```needs
[
 {"id":"phone-book","statement":"Customers book a tune from their phone.","steps":[],"assertions":[{"surface":"phone","selector":"#book","text":"Hold slot"},{"surface":"wall","selector":"#rail"}]},
 {"id":"pay","statement":"Customers pay through Maya's Stripe account.","steps":[],"assertions":[]},
 {"id":"hold","statement":"Their chosen slot is held before Checkout and confirmed only by verified payment.","steps":[],"assertions":[{"surface":"phone","selector":"#receipt"},{"surface":"wall","selector":"[data-booking]"}]},
 {"id":"wall","statement":"The workshop wall shows saved bookings.","steps":[],"assertions":[{"surface":"wall","selector":"[data-booking]"},{"surface":"phone","selector":"#receipt"}]},
 {"id":"move","statement":"Authenticated staff can move bookings and the phone and wall update.","steps":[],"assertions":[]}
]
```
Full flows and staff proof live in ../evidence, outside the studio. Payment is simulation only; real charging is not met. Staff assertions require the authenticated browser test rather than the public-only needs checker.

## Built from
Only toolkit from /tmp/homie-rocks-studio-0.50.6.tgz. Jobs scaffold replaced with original HTML/CSS ski illustration, records, shop.book and versioned moves. Toolkit rules room carries refresh notices; D1 is authoritative. Inspected camera and geom package exports; scene needs no 3D engine. Parts catalogue search “workshop booking rail” returned no matches among 34 parts. No purchased/generated media or third-party art.

## Milestones
- [x] Build phone, wall and staff surfaces
- [x] Build using strict type checks
- [x] Prove simulated Checkout and durable hold
- [x] Prove authenticated staff move and denied customer writes

## Open questions
Real payment authorization and supported one-approval runtime Checkout integration remain unavailable. No key requested. Actual price and ongoing schedule need Maya's business choices before any future release.

## Local acceptance · 14 October 2026
Phone booking, wall and staff move: met locally. Hold: met under fixture, partly for production. Real payments: not met; no account and unresolved runtime connection. See ../../../../evidence/REPORT.md and captures. Public checker timed out; dedicated Chrome flow proved hold/confirmation, staff movement, 403 and 409 denials. Fresh browser proved persistence, expiry release and unknown-reference handling. No real Stripe test-mode verification. No music or sound needed.
