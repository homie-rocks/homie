# Maya (Coldsmoke Tuning) on the keyless default, 0.51.0

Maya's ask: "Customers book a tune from their phone and pay; the slot is held for
them. I want a workshop wall showing bookings and staff able to move them."

## How the trial ran

- A fresh customer AI (`codex exec`) started in an empty temp folder
  (`/private/tmp/homie-maya-keyless-c9FGca`) and installed the toolkit only from a
  packed build (`npm pack` of `packages/studio`, installed as
  `devDependencies.@homie-rocks/studio = file:<tgz>`). It read the packaged guides,
  not this repository. Its first brief is `prompt.txt`; its log is `trial.log`.
- After review fixes landed in the toolkit, the same AI re-installed the final
  immutable pack (`evidence/SHA256.txt`; 490 installed files matched the archive,
  `evidence/toolkit-integrity.json`) and re-ran its app and acceptance against it.
  That continuation brief (`final-pack-prompt.txt`) was written by the engineer
  directing the work and spelled out the pause/move/resync sequence, so the second
  pass is a guided verification, not an unprompted discovery. Log: `final-pack-trial.log`.
- Stripe: only the CLI profile `Homie sandbox`. The Worker ran with
  `STRIPE_CHECKOUT_MODE=links`, Payment Link config and the listener's signing
  secret only; no API key, no API base. Payments were completed through Stripe's
  API with the published `tok_visa` fixture after a real Payment Link page opened
  in Chrome; no card was typed into any page. `helper.close()` deactivated the links.

## Needs

| Need | Verdict | Evidence |
|---|---|---|
| Customer books a tune from the phone and pays | Met | `phone-stripe-payment-link.png` (real buy.stripe.com sandbox page), `phone-paid.png`; Checkout matched by `client_reference_id`, signed webhook confirmed the booking (`acceptance.json`) |
| The slot is held for them | Met, as "paid secures the seat" | Stripe's `restrictions.completed_sessions.limit` = capacity is the hard limit; a full slot refused another booking (409) and Stripe refused payment on an already-open second session. Opening the link shows "Pending payment, seat not reserved" (`phone-pending.png`); an unpaid guest does not block others. Exclusive unpaid holds exist only on the optional keyed path. |
| Workshop wall shows bookings | Met | `wall-pending.png`, `wall-paid.png`, `wall-moved.png` |
| Staff can move bookings | Met, with an AI step | Move into an active paid slot is refused (`staff-move-refused.png`); after the owner's AI pauses both slots (links deactivated, open sessions expired) the versioned move succeeds and a stale version is refused; resync reopens the freed seat and keeps the target full (`staff-moved.png`). The pause/resync is an owner-AI operation, not automatic on the staff click. |
| Public cannot write staff records | Met | public slot write returned 403 (`acceptance.log`) |

The generic `homie-studio check tune --no-isolate` also passed on the retained
sandbox-paid records (`evidence/generic-check.json`, `evidence/generic-shots/`);
it checks what screens show, while `acceptance.json` is the money evidence.

Limits Maya should know: price ($60 CAD), service and the Oct 17 windows are
placeholders; staff sign-in used local test auth; the phone is a Chrome viewport,
not a handset; QR is loopback-only because the trial stayed offline. Full detail in
`evidence/NEEDS.md` and `evidence/COMMANDS.md`. App sources: `source/`.
