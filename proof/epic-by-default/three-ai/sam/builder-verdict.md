# Second Street Pantry — local trial verdict

Built with the packed Homie Studio 0.50.0. Nothing deployed; no external messages or payments. Reviewed locally in real Google Chrome, not an independent review.

| Sam's need | Verdict | Evidence and remaining work |
|---|---|---|
| Hall screen with the week's meal table filling as neighbours give | Partly met | Original table fills outlined pledge plates as durable phone actions arrive. `.checks/wall.png`, automated hall captures. Funded meals remain zero: verified payment-to-meal integration is not implemented. |
| Give once from a phone | Partly met | CAD $10/$25/$50 intentions save and return links work. Shop preview has once items. Actual charging is not met: Stripe is not connected. |
| Give monthly from a phone | Partly met | Monthly intentions and interval=month shop items are configured; UI explicitly says this is not a subscription. Actual recurring collection is not met. |
| Volunteers sign up for shifts | Met for local preview | Choose one of three labelled sample shifts, save a durable record, reopen its reference on a second phone. `.checks/phone-receipt.png`, `.checks/flow.json`. Real shift schedule remains provisional; there is no capacity reservation, cancellation or staff management UI. |
| Show it running locally; do not put online | Met | Local server left at http://127.0.0.1:8896; Wi-Fi address http://192.168.1.250:8896. Wall QR in final capture uses LAN address. |

## Checks
- Strict TypeScript and toolkit build passed.
- Shared action changed wall and two phones; reconnect retained the records. Toolkit check correctly reports overall incomplete because real payment needs are unmet.
- Custom Chrome flow exercised once pledge, monthly pledge and shift signup, with no browser page errors; second phone followed the same saved record.
- Screens captured at 1600×900 (wall), 390×844 (phone), and 844×390 (landscape). Hall typography was reduced after initial visual review to fit a 900px-tall display.
- Durable records, references and public write denial results are in `.checks/final.json`. No real privileged staff transition is claimed tested or implemented.
- Local generated test records remain visible as unpaid pledges and sample sign-ups. No amount is presented as received money.

## Assumptions and limits
CAD, 200-meal weekly goal, CAD $5 per meal and shift schedule are provisional. Week resets visually on Monday while records remain stored. Public records contain only gift amounts/frequency, shift choice, week and opaque references; no donor/volunteer names or contact details. Pledge totals are unverified public intentions, never a financial ledger. No payment webhook or order-to-table fulfilment is implemented. Stripe approval, test payments and verified fulfilment would be needed before real donations; deployment was intentionally not performed.

## Sources and provenance
Read https://homie.rocks/nonprofits.md and Little Inlet's make-your-own page. Used version-matched app, plan, parts, playtest, apps, site and shop guidance from the installed 0.50.0 pack. Reused Little Inlet / A Tide of Good live-goal 1.0.0 under MIT, credit Little Inlet · Ryan Campbell. Original SVG table and UI. No paid or generated media.

Final verification: persisted saved shift after closing test browsers = true; unauthorized record update = HTTP 403. The toolkit's shop preview is restricted to localhost: the Wi-Fi /shop/ page asks to connect Stripe rather than showing preview items. In-app pledge amounts/frequencies remain visible on Wi-Fi. This is a toolkit local-preview limitation, not a working checkout. The final hall uses Homie's shell QR so it does not duplicate or cover the app's own information.
