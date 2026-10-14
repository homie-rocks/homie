---
name: Coldsmoke Tuning
kind: app
tagline: Next run, better.
palette:
  bg: '#102c38'
  ink: '#f7f2e5'
  accent: '#ff915c'
---
# Coldsmoke Tuning
## Their words
“Customers book a tune from their phone and pay; the seat is held only when paid. I want a workshop wall showing bookings and staff able to move them.”
## Scene
Original two-dimensional workshop: plywood wall, metal rail, paired skis with public-safe booking tags, edge/wax bench. Paid tags green, pending tags orange with muted skis. Provisional illustration, not Maya's actual floor plan.
## People and surfaces
Customers without accounts choose a slot and pay on Stripe; their tracking link returns to one booking. Wall shows no customer names or contact data. Staff publish slots and move paid bookings with optimistic versions. Owner AI syncs complete manifests after publication and reviews affected links after moves.
## Offers
Assumption for this local sandbox only: full tune (edges and hot wax), CAD $60, one seat per booking, Oct 17 2026 9 AM and 10 AM. Maya must confirm price, scope, tax, actual dates, timezone, cancellation/refund policy and operating capacity before launch.
## Built from
Only /tmp/homie-rocks-studio-0.51.0.tgz; package jobs scaffold replaced with records-only app. Public records bridge and shop.book, keyless Payment Links helper. Original HTML/CSS illustration; no external parts, extra engine packages or paid media. Online parts discovery omitted to honor package-only instruction. Toolkit untouched.
## Style
Front-on workshop, midnight blue, warm plywood, safety orange, frost-white text; native large controls; state driven by durable records. Typography system Arial; no font downloads. Ski tickets group by booking; slot labels show movement without fictional workflow stages.
## Needs
```needs
[
  {
    "id": "publish",
    "statement": "Staff-published slots remain visible after owner AI sync (publication separately proved by custom acceptance).",
    "role": "staff",
    "assertions": [
      {
        "surface": "staff",
        "selector": "#staff-slots",
        "text": "Sat Oct 17 · 9:00 AM"
      },
      {
        "surface": "staff",
        "selector": "#staff-slots",
        "text": "Synced"
      }
    ]
  },
  {
    "id": "pay",
    "statement": "Display the retained real sandbox-paid receipt; custom acceptance proves actual Checkout and signed payment.",
    "assertions": [
      {
        "surface": "phone",
        "selector": "#my-ticket",
        "text": "Paid — seat secured"
      },
      {
        "surface": "phone",
        "selector": "#my-ticket",
        "text": "10:00"
      }
    ]
  },
  {
    "id": "wall",
    "statement": "Wall displays the same provider-confirmed booking after movement; custom captures prove pending-to-paid transition.",
    "assertions": [
      {
        "surface": "wall",
        "selector": "[data-booking=\"ord_tufNXmI98bBZS3bfaeO0\"]",
        "text": "PAID / SECURED"
      },
      {
        "surface": "wall",
        "selector": "[data-booking=\"ord_tufNXmI98bBZS3bfaeO0\"]",
        "text": "10:00"
      }
    ]
  },
  {
    "id": "capacity",
    "statement": "Show moved target Full and freed source available; custom acceptance proves pending coexistence and refusal.",
    "assertions": [
      {
        "surface": "phone",
        "selector": "[data-slot=\"proof-1791982620375-1000\"]",
        "text": "Full"
      },
      {
        "surface": "phone",
        "selector": "[data-slot=\"proof-1791982620375-0900\"]",
        "text": "Book & pay"
      }
    ]
  },
  {
    "id": "move",
    "statement": "Staff sees moved confirmed record at incremented version; custom acceptance proves pause gate and stale-write refusal.",
    "role": "staff",
    "assertions": [
      {
        "surface": "staff",
        "selector": "[data-move=\"ord_tufNXmI98bBZS3bfaeO0\"]",
        "text": "v3"
      },
      {
        "surface": "staff",
        "selector": "[data-move=\"ord_tufNXmI98bBZS3bfaeO0\"]",
        "text": "10:00"
      }
    ]
  }
]
```
Payment-dependent needs are exercised by custom real sandbox acceptance; the generic isolated check deliberately does not claim them from static text.
## Milestones
- [x] Local scaffold and original app sources
- [x] Generic check run (two needs met, provider rows unasserted) and custom real sandbox acceptance passed
## Limitations
No unpaid exclusive holds. Stripe lifetime completed-session limits do not decrease for refunds or staff moves. Owner AI must review and resync links; do not increase capacity to hide full errors. Local staff test session is not a production passkey proof. No deployment.

## Local acceptance result — 2026-10-14
The custom real Stripe sandbox run passed: actual Payment Link opened from phone, another guest remained able to open the pending slot, one CAD 60 test payment succeeded via token API, signed webhook confirmed and wall updated, full purchase returned 409, public slot write returned 403, staff move advanced v2→v3 and stale v2 returned 409. Explicit tracking survived fresh browser contexts. See `evidence/acceptance.json` and `evidence/NEEDS.md` for exact scope and gaps. Generic check retains unasserted payment needs because it is isolated and cannot replace provider acceptance. Screenshots were reviewed locally, not independently.

The initial sandbox pending request and duplicate slot labels from diagnostic runs remain as test residue. No live customer records. Native Payment Links use completed-session capacity; no unpaid exclusive hold is claimed. No post-move resync was performed; further sales require owner review. Local browser-emulated phone, not physical hardware. Explicit receipt link works; shell auto-persistence expects hex IDs whereas shop booking IDs are `ord_…`, so bare URL reload recovery is not guaranteed.
