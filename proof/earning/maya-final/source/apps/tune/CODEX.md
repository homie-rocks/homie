# Coldsmoke Tuning

## Their words
“Customers book a tune from their phone and pay; the slot is held for them. I want a workshop wall showing bookings and staff able to move them.”

## Scene and people
Skis hang on a timber rail beneath mountain silhouettes. Each drop-off time has a bay; held skis are muted, paid skis solid, released skis grey. Provisional illustration, not a real floor plan. Public wall sees safe references; phone sees its receipt and booking controls; authenticated staff move bookings. Records, keyed by booking ID, reconstruct the scene after reload.

## Offers
Review assumption: full tune (edge sharpening and hot wax), CAD $65 once. Demo Friday 16 October 2026 09:00 / 10:00 slots, one seat each. Maya must approve price, dates and service before real use.

## Built from
Only supplied @homie-rocks/studio 0.51.0 tarball; jobs starter replaced with custom rail scene; server room shell retained for checkout bridge. Public apps, shop and links APIs. Starter engine dependencies installed; CSS geometry chosen for the rail. Parts search found no matching piece among 34. Original CSS artwork, system font, no paid media. Teal workshop, timber gold, cream panel override style init's generic meadow defaults.

## Needs
```needs
[
{"id":"phone","statement":"Customers choose a tune slot on a phone","assertions":[{"surface":"phone","selector":"#book","text":"Hold slot"}]},
{"id":"payment","statement":"Customers pay and the slot is held and confirmed by Stripe","assertions":[]},
{"id":"wall","statement":"Workshop wall shows bookings","assertions":[{"surface":"wall","selector":"#rail"}]},
{"id":"move","statement":"Authenticated staff move bookings","role":"staff","assertions":[]}
]
```
Payment and move passed custom real sandbox acceptance; generic check remains non-green because those provider workflows have no generic assertions. See ../../../../evidence/REPORT.md for observed results and production gap.

## Latest
2026-10-14: Actual sandbox paid confirmation, last-seat refusal, staff move, expiry/release and stale version refusal proved. Records-only shell lacked shop bridge; restored packaged room shell through public API. All price/schedule/layout assumptions remain provisional.
