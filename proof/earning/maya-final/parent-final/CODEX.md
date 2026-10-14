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
  {
    "id": "phone",
    "statement": "Customers retrieve their paid booking on a phone",
    "steps": [
      {
        "surface": "phone",
        "selector": "#reference",
        "fill": "ord_j4Q16xACm759AHVLjnG0"
      },
      {
        "surface": "phone",
        "selector": "#track",
        "click": true
      }
    ],
    "assertions": [
      {
        "surface": "phone",
        "selector": "#receipt",
        "text": "Confirmed \u00b7 paid"
      }
    ]
  },
  {
    "id": "payment",
    "statement": "A real Stripe-paid booking is confirmed on the wall",
    "assertions": [
      {
        "surface": "wall",
        "selector": "#rail .confirmed",
        "text": "Confirmed \u00b7 paid"
      }
    ]
  },
  {
    "id": "wall",
    "statement": "Workshop wall shows bookings",
    "assertions": [
      {
        "surface": "wall",
        "selector": "#rail",
        "text": "Fri 16 Oct"
      }
    ]
  },
  {
    "id": "move",
    "statement": "Authenticated staff move the paid booking",
    "role": "staff",
    "steps": [
      {
        "surface": "staff",
        "selector": "#moves select",
        "select": "pm"
      },
      {
        "surface": "staff",
        "selector": "[data-move=\"ord_j4Q16xACm759AHVLjnG0\"]",
        "click": true
      }
    ],
    "assertions": [
      {
        "surface": "staff",
        "selector": "#status",
        "text": "Booking moved"
      },
      {
        "surface": "staff",
        "selector": "#rail .bay:nth-child(2) .confirmed",
        "text": "Confirmed \u00b7 paid"
      }
    ]
  }
]
```
Payment and move passed custom real sandbox acceptance; generic check remains non-green because those provider workflows have no generic assertions. See ../../../../evidence/REPORT.md for observed results and production gap.

## Latest
2026-10-14: Actual sandbox paid confirmation, last-seat refusal, staff move, expiry/release and stale version refusal proved. Records-only shell lacked shop bridge; restored packaged room shell through public API. All price/schedule/layout assumptions remain provisional.

Parent final-pack verification: run check with --no-isolate against the real sandbox-paid fixture retained by the customer trial. These assertions verify displayed paid state and a real staff move; Stripe charging itself is proved by the separately retained CLI/API evidence.
