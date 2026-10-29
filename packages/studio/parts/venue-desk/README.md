# Venue desk

One generic, opt-in set of studio tools for any venue (surf school, restaurant, studio class, court, room). It sits on top of the toolkit's own booking holds (`studio_availability`, `studio_book`, `studio_checkout`) and adds what an agent such as Ask/Enjoy needs to finish a booking for a person:

| Tool | Who | What |
| --- | --- | --- |
| `venue_info` | public | schema.org `LocalBusiness` with opening hours, holiday exceptions and time zone, a `FAQPage`, policies, contact and which app/collection to book |
| `venue_booking_details` | public (hold token) | attach name, email or phone, party size and notes to a hold |
| `venue_booking_confirm` | public (hold token) | turn a held slot into a confirmed booking; if the venue takes payment in advance it points to `studio_checkout` instead |
| `venue_booking_status` | public (hold token) | schema.org `Reservation` for a hold |
| `venue_booking_cancel` | public (hold token) | release a hold or booking |
| `venue_waitlist_join` | public (own token) | join a waitlist for a full slot, or a wanted time |
| `venue_waitlist_status` | public (own token) | position and offer; `leave: true` leaves |
| `venue_info_set` | owner | edit hours, exceptions, policies, FAQ, contact, booking settings from chat |
| `venue_desk` | owner | bookings with contacts, waitlist, the unsent outbox and the recent log |
| `venue_waitlist_offer` | owner | offer a freed slot to a waitlist entry; writes an outbox item. **Homie never sends anything** — the owner or their agent sends it and marks it `sent` |

Anonymous callers prove ownership with a private token they generate (32–128 characters, the same pattern as `studio_book`). Waitlist tokens are stored only as SHA-256 hashes. Nothing here charges money; payment, when the venue wants it, stays in `studio_checkout`.

## Agent flow

1. `venue_info` → read hours, policies and `booking.app` / `booking.collection`.
2. `studio_availability {app, collection, from, to}` → pick a slot.
3. `studio_book {app, collection, slot, hold, token, expiresAt}` → a hold.
4. `venue_booking_details {hold, token, name, email|phone, partySize, notes}`.
5. `venue_booking_confirm {hold, token}` → `ReservationConfirmed`, or `next: "studio_checkout"` when `booking.paymentInAdvance` is set and the person approves payment.
6. Full? `venue_waitlist_join {id, token, slot|wanted, name, email|phone, partySize}`.

## Install

1. `part_add "<sharing studio host>/venue-desk"` (or copy this folder to `parts/venue-desk`).
2. Copy the files in this part's `tools/` folder into the studio's `tools/` folder. Each is one line, e.g.
   `export { venueInfo as default } from "@parts/<host>/venue-desk";` (use `@parts/venue-desk` when the part sits in `parts/venue-desk`). Leave out any tool you do not want.
3. Deploy. Then, as owner, call `venue_info_set` with the venue's name, time zone, hours and the booking app and collection.
