# The shop: selling in a studio's games with the studio's own Stripe

`@homie-rocks/studio` 0.24.0, set up with Stripe's own agent tools since 0.24.3. A studio sells items for its games
through **its own Stripe account**. The studio
is the seller; homie.rocks never holds, routes or settles its money, is not a Stripe Connect platform, and takes
no cut. There is no shared currency between studios. `SELLING.md` beside this file is the owner's plain-words
note on what selling means for them (refunds, disputes, tax, kids; not legal advice).

## shop.json

At the studio's root, reviewed in git. Nothing secret is ever in it.

```json
{
  "till": "stripe",
  "currency": "usd",
  "policy": { "preset": "protective" },
  "items": [
    { "id": "supporter", "kind": "supporter", "name": "Supporter", "price": 500, "days": 365,
      "gives": ["badge:supporter", "credits-name"], "badge": "Supporter" },
    { "id": "ember-skin", "kind": "cosmetic", "game": "orbit", "name": "Ember hull", "price": 300, "gives": ["skin:ember"] },
    { "id": "season-1", "kind": "pass", "name": "Season 1", "price": 800, "ends": "2027-01-31", "gives": ["track:season-1"] },
    { "id": "tip", "kind": "tip", "name": "Buy the studio a coffee", "price": "choose", "min": 200, "max": 5000 }
  ],
  "referrals": { "rate": 0.10, "windowDays": 30, "capPerPlayer": 1000, "holdDays": 30, "minimumInvoice": 2500 }
}
```

| Field | Meaning |
|---|---|
| `till` | `stripe`: the studio is the seller, Stripe Tax on (`automatic_tax`). `stripe-managed`: Stripe Managed Payments, Stripe's Link, LLC is the seller of record and files the tax (3.5% more; turn it on in Stripe first). `off`. |
| `currency` | one Stripe presentment currency, including zero-decimal currencies such as `jpy`. |
| `refundDays` | Optional days for self-service refunds of unused items. No default or ceiling; omitted or null means ask the studio. |
| `capPerPlayerMonth` | Optional amount one player may spend per calendar month, in Stripe currency units. No default or ceiling; omit or null for no cap. |
| `items[].kind` | Any nonempty label chosen by the studio. `tip` uses a buyer-chosen amount, with an optional studio `max`. Other kinds use a fixed price; a label does not add recurring billing or fulfillment. |
| `items[].price` | whole Stripe currency units. No Homie maximum. Stripe minimums and currency rules apply. |
| `items[].gives` | the entitlement keys the game reads: `skin:ember`, `badge:supporter`. A `badge:` key shows beside the player's name in rooms and on their account page. |
| `items[].days` / `starts` / `ends` | Optional duration or sale dates, without a Homie duration ceiling. Fractional days are allowed; end times are rounded to whole milliseconds and must fit safe arithmetic and the JavaScript timestamp range. |
| `items[].game` | only in that game's shop (left out: every game's). |
| `items[].advantage` | `true` when it changes how the game plays. The studio policy decides whether it is offered or counted on beginner and kids servers. |
| `items[].taxCode` | a Stripe product tax code. Managed Payments needs one: by default `txcd_10201000` (video games, downloaded, permanent) or `txcd_10201001` (limited time). |
| `referrals` | what this studio pays a referrer for a new player's purchase (left out: nothing). |
| `catalog` | where the items are Products in Stripe: `["test"]`, `["test", "live"]`. `homie-studio shop catalog` writes it once Stripe's catalog matches; the Worker's checkouts then name each item's Product (0.24.3). |

## The studio decides

There is no Homie ceiling on item prices, tips, catalog size, entitlement count, text lengths, durations,
refund days, monthly spending or referral terms. The existing amount fields keep their meaning: a cap or
refund window already written in shop.json stays in effect until the studio edits or removes it.
No migration or rewrite is needed. `shop init` writes an explicit protective policy and no spending cap,
refund window or referral agreement. Settings are public, readable and editable in shop.json.

The studio is responsible for applicable law and its payment provider's terms wherever it sells. These settings
are choices, not a statement that a sale is legal or permitted by Stripe. This is information, not legal advice.

### Policy presets

`policy.preset` selects `protective`, `adults-only` or `custom`. An absent policy uses `protective`, preserving
the existing protections. Override any row directly in `policy`; `shop init` writes all rows so they are easy
to read and edit. Explicit overrides take precedence when you change presets; remove an override to inherit
the preset value. Invalid values fail validation rather than silently relaxing a rule.

| Setting | protective (new shop default) | adults-only | custom |
|---|---|---|---|
| `withdrawalAcknowledgement` | true | true | true |
| `childAge`, `adultAge` | 13, 18 | 13, 18 | 13, 18 |
| `requireAccount` | true | true | false |
| `ageQuestion` | true | true | false |
| `children` (under 13) | deny | deny | allow |
| `teens` (13–17) | parent | deny | allow |
| `kidsStudio`, `kidsServer` | false | false | true |
| `kidsAdvantages`, `beginnerAdvantages` | false | false | true |
| `paidRandomRewards`, `countdownOffers`, `virtualCurrency` | false | false | true |
| `supporterAdvantages`, `repeatPurchases`, `refundUsedItems`, `televisionCheckout` | false | false | true |

`children` and `teens` each accept `deny`, `parent`, or `allow`. The neutral age question stores only a band,
never the birth year. `childAge` and `adultAge` set the band thresholds (13 and 18); the neutral picker spans 120 years. A parent's link lasts a week as a security expiry. Account-free purchases use a guest
session in this browser; clearing its cookie loses access, so buyers can add a passkey to keep their purchases.
The protective preset hides the shop on kids servers and kids studios, blocks purchases under 13, requires
parent checkout for teens, hides game advantages on beginner and kids servers, refuses paid randomness and
countdowns, and sends TV shoppers to a phone. Nothing relaxes those protections without a studio setting.

For example, `{ "policy": { "preset": "protective", "repeatPurchases": true } }` changes only repeat purchases.
The custom preset deliberately enables all policies; choose it only as a considered studio decision.
`kind` is descriptive, not a whitelist: services and subscription labels still use the existing one-time checkout.
Virtual-currency keys and random-reward metadata do not implement a wallet or random-reward fulfillment engine.

### Currency and abuse protection

Amounts use Stripe's API units: `500` USD is $5; `500` JPY is ¥500. ISK and UGX retain Stripe's two-decimal API
representation but require multiples of 100. BHD, JOD, KWD, OMR and TND use scale 1000. Stripe's current currency documentation does not state a divisible-by-ten charge rule; the toolkit does not refuse those amounts and shows Stripe's error if Stripe refuses a checkout. The check warns about the documented settlement-currency minimum where
known; Stripe decides the actual minimum after conversion and any payment-method maximum at checkout.
Errors name Stripe as the source. See [Stripe currencies](https://docs.stripe.com/currencies).
Zero-price Checkout orders are supported and can be revoked without a Stripe refund. Every amount setting accepts only nonnegative whole minor units (numbers or decimal numeric strings); a fractional amount stops the build, names the setting and says what to write. No amount is rounded. All amounts must fit JavaScript safe integer arithmetic. Homie does not impose its own price ceiling or fee floor.

`purchaseAttemptsPerMinute` defaults to 6 per account and `purchaseAttemptsPerAddressPerMinute` to 600 per
address. Both accept positive whole numbers (including decimal numeric strings). The larger address rate
allows households, schools and venues to share a connection; rotating addresses still hits the account rate.
`guestBuyersPerAddressPerHour` defaults to 600 new guest buyers per address per hour, allowing a venue or school to arrive together. It must be a positive whole number; 0 cannot disable it accidentally. The existing `PLAYER_LIMIT_DAILY` also applies.
Checkout, parent links and parent payments have separate counts, per Worker instance. Referral statements use
`REFERRAL_STATEMENTS_PER_MINUTE` (30 per address), `REFERRAL_STATEMENTS_GLOBAL_PER_MINUTE` (30 globally), and
`REFERRAL_STATEMENT_BYTES` (65536). Written values must be positive whole decimal numbers; invalid values produce a named settings error. Security
checks for origins, sessions, signed webhooks and request sizes remain. They protect the studio's money.

## In a game

```ts
import { createShop } from '@homie-rocks/studio/shop';
const shop = createShop();
await shop.ready;                        // { open, kids, screen }
if (shop.has('skin:ember')) useEmber();  // synchronous: fine in a render loop
shop.on('change', (owns) => redraw());   // a purchase landed, or a refund took one back
buyButton.onclick = () => shop.open('ember-skin');   // the store sheet (a code to scan on a TV)
shop.used('skin:ember');                 // marks it used; the studio refund policy applies
```

The protective preset recommends opening the shop only from a button the player pressed, never from the play, start or wake
button, never on a timer; show prices in real money; never draw a countdown; never sell randomness; do nothing
differently for a supporter on a beginner server.

The play shell around the game answers these calls (the game never sees a card, an email, an order or a
session). The room button's sheet has a **Shop** button too. A purchase opens Stripe's page in a new tab, the game
keeps running, and the shell looks again when the tab comes back: `change` fires once it is paid.

**Badges in rooms.** A player whose account owns a `badge:` key carries it on their seat: `net.players()` gives
`peer.badge` ("Supporter"), set by the studio's Worker from what the account owns when the player connects (a
hello can never claim one). Kids-server badges follow `policy.kidsServer`; AI seats have no purchases.

## The money path

```
phone (signed in) ─ POST /api/shop/buy ─► studio Worker ─ Checkout Session (the studio's restricted key) ─► Stripe
      ◄──────────────── Stripe's hosted page (new tab): the player pays ─────────────────────────────────┘
Stripe ─ signed webhook ─► POST /api/shop/hook: order paid → entitlements → referral line (held)
homie.rocks: not involved at any step.
```

- The order row atomically reserves against the studio monthly cap before Stripe is called. Reservations are
  released on confirmed expiry, failure, missing session or refund, or an explicit owner release, never merely because a webhook is late; the Checkout Session carries the order, the player and the
  item in its metadata; the hook checks the session matches the order (player, price) before it grants anything.
- A sessionless reservation stops counting after its 31-minute creation window plus a one-minute margin.
  A session with no final result, including a bank payment still processing, keeps counting even past expiry.
  Shop GETs never call Stripe. With a cap configured, only a purchase refused by the atomic cap check waits
  for reconciliation: up to three rows in parallel, each with a two-second timeout. Successful purchases continue
  reconciliation in `waitUntil` (the shop has no scheduled handler). Rows are atomically claimed before reading
  [Stripe's session and expanded payment](https://docs.stripe.com/api/checkout/sessions/retrieve).
  Successful reads set a per-row interval of one minute (five minutes for processing bank payments),
  growing with age to one hour. Failed reads retry after a short backoff of about one minute and log the order and reason. With more than three lost rows, a refusal may need another purchase attempt.
  Paid counts in the month of [the Stripe charge's creation time](https://docs.stripe.com/api/charges/object#charge_object-created);
  missing payment time, pending or unreachable keeps counting. Confirmed expiry or failure releases it.
  Stripe's [404 resource_missing](https://docs.stripe.com/error-codes#resource-missing) means this key's account
  has no such session, not that no payment can follow: the row stops reserving the cap and is shown as `missing` in the office.
  The office lists unresolved orders first, with Next orders for more. Release reservation records the confirming
  owner's account (or a fingerprint of the owner's office sign-in session) and time in the office-only note, and asks Stripe to
  [expire an open Checkout Session](https://docs.stripe.com/api/checkout/sessions/expire). It does not refund a payment.
  A verified payment still grants the item and counts toward spending, including after a missing mark or release,
  and can be refunded from the office. Duplicate events change nothing. Players see their previous unfinished
  order state, never the internal mark or note.
  An owner release or missing mark can free space for another purchase before a late payment counts again;
  new reservations still obey the configured cap. Test orders never count toward a live
  cap. Free orders remain available if an owner lowers a cap below prior spending. Partial refunds keep the whole
  price counted; full refunds and lost disputes release it. No spending SUM runs when the cap is absent.
  Deploy applies `0010_shop_reservations.sql` and `0011_shop_statements.sql`; readiness names these migrations
  if the required schema is absent.
- The webhook's `Stripe-Signature` is checked (HMAC-SHA256 of `<t>.<payload>` with the endpoint's `whsec_`
  secret, within five minutes); each event id is handled once; a test event never touches a live shop.
- Paid: the entitlements are granted. Refunded: that one order's entitlements are revoked. A dispute: nothing
  changes until it is decided; lost: that one item goes, as a refund would; won: it stays. **The account is never
  locked or deleted over a dispute.**
- Receipts come from Stripe by email (the buyer types it on Stripe's page, never on the studio's). The account
  page lists the player's orders and badges; `/api/player/export` includes them; deleting an account asks first
  when it owns things, and keeps the order rows without the player.
- Each Checkout Session says beside the pay button that the item is delivered at once (the EU and UK withdrawal
  acknowledgement) and the studio's configured refund terms. `policy.withdrawalAcknowledgement` is true in every preset, restoring the existing wording, and is editable. Stripe caps product names at 5000 characters, descriptions at 40000 and submit wording at 1200; the build reports these provider constraints without truncation.

## Setting it up (the AI does the commands; the owner only uses Stripe's pages and one page here)

The AI works with **Stripe's own agent tools** (0.24.3): Stripe's agent plugin (`npm install -g @stripe/cli@latest &&
stripe agent setup`: Stripe's MCP server at `https://mcp.stripe.com` and Stripe's skills, for Claude Code and Codex) or
Stripe's connector in the Claude app. The owner signs it in once on Stripe's consent page and gives it **a sandbox
first**. An agent that cannot do OAuth uses an **Agent key** (a restricted key Stripe tags "Agent") from its
environment; from **2026-10-31** Stripe's MCP refuses full secret keys and restricted keys without that tag. The shop's
own key, in the Worker, is a plain restricted key and is not affected.

What only the owner does: make the Stripe account and (for live) activate it: business details, bank, identity, and,
for Managed Payments, its terms and Stripe's eligibility review; approve Stripe's sign-in page; make **one restricted
key** in Stripe's Dashboard (Stripe has no API that makes API keys) and paste it on the connect page; approve any
write Stripe sends to them for confirmation (a refund through Stripe's MCP, for one).

1. `npx --no-install homie-studio shop init --supporter` (shop.json and SELLING.md), then `shop check`, commit,
   `npm run deploy` (it applies migration `0008_studio_shop.sql`; the shop stays closed).
2. **The catalog**, through Stripe's MCP: `homie-studio shop catalog` names the one read to make
   (`stripe_api_read GET /v1/products`, expanding each default price); `homie-studio shop catalog --have <the saved
   answer>` lists exactly the `stripe_api_write` calls still needed: each item a Product with the id
   `homie_<studio slug>_<item id>` (the same in a sandbox and live), its name, blurb, a tax code (video games,
   downloaded: `txcd_10201000`, or `txcd_10201001` for an item that lasts days or ends on a date; eligible for
   Managed Payments) and metadata naming the studio and the item, with a default Price of shop.json's amount (a tip:
   the Product only). A changed price is a new Price made the default; an item gone from shop.json is archived, never
   deleted; a product the studio did not make is never named. When Stripe matches, it says so and writes
   `"catalog": ["test"]` into shop.json (commit, deploy). shop.json's checked price is always what is charged; the
   checkout names the Product so Stripe's Dashboard, reports and MCP see sales by product, and a Product missing in
   this mode falls back to the item described inline.
3. **Tax**, read through Stripe's MCP: `GET /v1/tax/settings` (with the studio as the seller, Stripe Tax needs
   `status: active`, the business address, or checkouts fail) and `GET /v1/tax/registrations` (none: Stripe Tax
   collects nothing anywhere until the owner registers somewhere). Reading only; the owner and their accountant decide.
4. `npx --no-install homie-studio shop connect`: a page on the owner's computer (127.0.0.1, one use, ten minutes). The
   owner makes one restricted key with **Checkout Sessions: Write, Charges: Write (refunds), PaymentIntents: Read,
   Disputes: Read, Webhook Endpoints: Write**, not an Agent key, and pastes it. With it the page reads once (a typo is
   caught here), **makes the webhook** at `https://<site>/api/shop/hook` for `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `charge.refunded`, `refund.created`, `refund.updated`, `charge.dispute.created`, `charge.dispute.closed` (API version
   `2025-03-31.basil`, metadata `homie: shop-v1`), and puts the key and the webhook's signing secret, which Stripe hands
   back once, straight into the Worker secrets `STRIPE_KEY` and `STRIPE_WEBHOOK_SECRET` on Wrangler's standard input.
   An older endpoint the kit made for the same address is turned off, never deleted. The page offers the seller
   choice (the studio, or Stripe Managed Payments, with what each costs and does) and, in test mode with Managed
   Payments, tries one test checkout with it (expired at once) and says whether Stripe took it. Afterwards the owner
   may set the key's Webhook Endpoints back to None (recommended; the shop never needs it again). A key without
   Webhook Endpoints: the page takes a webhook signing secret the owner made and revealed in Stripe instead. Test keys
   only, unless `--live`.
5. `homie-studio shop` says whether anything is still missing. Buy your own item with a Stripe test card, and
   refund it from `/_studio/office/shop`. Through Stripe's MCP, `GET /v1/webhook_endpoints` shows the endpoint the
   page made (its `we_…` id): if it is not there, the MCP is signed in to another account or sandbox than the key.
6. **Live**, only when the owner says so: they activate the account, give Stripe's MCP access to the live account,
   `shop catalog --mode live` makes the live catalog the same way, and `shop connect --live` takes a live key.

Never ask for a key in a chat, never put one in a file, an argument, a log or a commit. **Never make a webhook endpoint
or event destination through Stripe's MCP**: its answer carries the signing secret into the conversation (in Claude
Code the Homie mod refuses the call). Never use a Stripe CLI login or a key found on the computer.

## The office

`/_studio/office/shop` (the owner's browser) and `/_studio/api/shop` (an office key): open or what is missing,
the last 30 days, every order with its Stripe page, Refund (one tap), disputes, payouts, balance and tax as links
to the studio's own Stripe Dashboard, a CSV for the accountant, and the referral books. From an office key a
refund (`POST /_studio/api/shop/refund`, `homie-studio shop refund <order>`) is always an ASK the owner confirms
with one tap; so is marking a referrer paid.

A refund made anywhere else (in Stripe's Dashboard, or through Stripe's MCP after the owner approved Stripe's own
confirmation link) reaches the shop as `refund.created` / `charge.refunded`, and the item leaves the player's account
the same way. If the Worker's key is an Agent key, Stripe holds the Worker's refunds for a person's approval
(`approval_required`): the office answers 202 "held", nothing changes until someone approves it in Stripe (Settings,
Approvals), and the webhook finishes it. Reconnect with a plain restricted key to get the one tap back.

"How are sales?": `homie-studio shop` and `shop orders` (the studio's own books, no names), and through Stripe's MCP,
read-only, `stripe_analytics` or `stripe_api_read` on the balance, payouts and checkout sessions.

## Referral pages

`/api/shop?cursor=...` serves 100 items per page and returns `nextCursor`. The shop page and in-game sheet offer the next page.
The office's `/_studio/api/shop?cursor=...` pages by referrer, with exact SQL totals and sale counts shown once per referrer and currency.
`/_studio/api/shop/lines?via=...&currency=...&cursor=...` pages the sales inside that book without repeating its totals.
Statement pages use `/_studio/api/shop/statements?period=YYYY-MM&cursor=...`; `shop statements --cursor ...` reads the next page.
One signed statement per referrer and currency has its totals on the first page only; continuation pages carry lines. A new first page replaces all previously received pages for that period and currency.
Read-only statement views read the current lines without making stored editions.
`shop statements --send` and the office's Send statements button save their progress and immutable lines in D1.
Keep the command or tab open to continue; close midway and start again to resume safely, without doubles or skipped
pages. After completion, starting again sends a fresh edition safely. Failed pages retry three times with exponential
backoff (at least a minute for rate refusals). Persistent failures name the referrer, stop its remaining pages and
continue the rest; starting a fresh run retries those referrers. The CLI reuses one office key, renewing its expiry
near ten minutes. Mark paid applies only to the selected currency and cannot change the edition being sent.
Received signed pages are available at `/_studio/api/shop/received?seller=...&period=...&cursor=...`. No row is hidden by a row cap.



## Referrals

The studio sets `rate` (a nonnegative share, including values over 100%), `windowDays`, `capPerPlayer`,
`holdDays`, `minimumInvoice` and accepted invoice methods. No ceilings or forced relation between hold and
refund days. Omitted window and per-player cap impose neither; omitted hold means no hold and omitted minimum
invoice imposes no minimum. `rate` keeps the existing 10% suggestion when referrals are explicitly enabled.
An absent `referrals` pays nothing. Published invoice terms are settled by the studio, outside Homie.


- A link with `?via=<host>` (another studio, homie.rocks, anywhere) opened by a person whose browser has never
  been to this studio leaves a signed cookie with the host and the time (only on a studio that pays referrals;
  never a prefetch, a crawler, this site, or a server's page or room).
- A paid order by an account made after that arrival, within `windowDays`, writes a referral line in THIS
  studio's D1, if the referrer's own `/.well-known/homie-studio.json` says it takes statements. Held for
  `holdDays`; a refund or a lost dispute inside the hold voids it, after it a clawback nets off the next statement.
- `homie-studio shop statements [--send]` signs each referrer's statement with the studio's Ed25519 key (the
  public half is in the manifest's `referrals.key`) and POSTs it to the referrer's `/api/referrals/statement`,
  which checks the signature against the seller's own manifest. No player, name or email is in a statement.
- Paying stays outside Homie: the referrer invoices the seller from its own Stripe; the seller pays and marks it
  paid in the office.

## Testing without money

The kit's tests run the Worker against `stripe-mock` (Stripe's open-source API mock, which checks every parameter
against Stripe's own API description) and sign webhooks with a test secret. stripe-mock also takes every write
`shop catalog` lists, a checkout that names its Product, and the webhook the connect page makes. Stripe's MCP is
never called by the tests: `shop catalog --have` reads an answer in the shapes Stripe's API documents. `STRIPE_API_BASE` (a loopback address
only) points a Worker at such a mock; it is never honoured for anything but 127.0.0.1 or localhost.
