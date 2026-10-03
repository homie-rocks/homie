# The shop: selling in a studio's games with the studio's own Stripe

`@homie-rocks/studio` 0.24.0. A studio sells items for its games through **its own Stripe account**. The studio
is the seller; homie.rocks never holds, routes or settles its money, is not a Stripe Connect platform, and takes
no cut. There is no shared currency between studios. `SELLING.md` beside this file is the owner's plain-words
note on what selling means for them (refunds, disputes, tax, kids; not legal advice).

## shop.json

At the studio's root, reviewed in git. Nothing secret is ever in it.

```json
{
  "till": "stripe",
  "currency": "usd",
  "refundDays": 14,
  "capPerPlayerMonth": 5000,
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
| `currency` | one currency with cents (`usd`, `cad`, `eur`, `gbp`, `aud`…). |
| `refundDays` | 14 to 60: a player refunds an unused item themselves within it. |
| `capPerPlayerMonth` | cents one player may spend here in a month: 100 to 5000. Lower it, never remove it. |
| `items[].kind` | `cosmetic` (a look), `supporter` (a badge, thanks), `pass` (a season), `unlock` (a mode, a chapter, the full game), `tip` (pay what you want, `min` to `max`). |
| `items[].price` | whole cents, real money. Under 300 the check warns (fees eat it). |
| `items[].gives` | the entitlement keys the game reads: `skin:ember`, `badge:supporter`. A `badge:` key shows beside the player's name in rooms and on their account page. |
| `items[].days` / `starts` / `ends` | how long it lasts; a season's dates (shown as dates, never a countdown). |
| `items[].game` | only in that game's shop (left out: every game's). |
| `items[].advantage` | `true` when it changes how the game plays: never offered, and never counted as owned, on a beginner or kids server. |
| `items[].taxCode` | a Stripe product tax code. Managed Payments needs one: by default `txcd_10201000` (video games, downloaded, permanent) or `txcd_10201001` (limited time). |
| `referrals` | what this studio pays a referrer for a new player's purchase (left out: nothing). |

`homie-studio shop check`, and every `homie-studio build`, refuse: anything that names chance, odds, random, a
crate, a box, a mystery, loot, a gacha, a spin or a roll; fields for odds or drop pools; a countdown, timer or
"hurry" field; gems, coins, points or any currency of the studio's own; subscriptions and paid services (later
versions); a cap over 5000 or a refund window under 14 days. A studio whose studio.json says
`"audience": "kids"` sells nothing at all.

## Who may buy

The Worker decides, for every item and every player (`worker/shop-rules.mjs` `wayFor`):

| The player | What happens |
|---|---|
| on a kids server, or in a kids studio | no shop at all: nothing listed, `shop.open()` says nothing is sold here |
| a guest (no passkey) | "make an account first" (a purchase would be lost with a cookie) |
| an account that has not answered | the one neutral age question: the year they were born, no default, nothing hinting which answer opens anything; kept only as a band |
| an account that said under 13 | nothing, ever; the account is treated as a kids account from then on |
| 13 to 17 | "ask a grown-up": a one-time link (a week) the teen passes on; the parent opens it on their own device, sees what and for whom, ticks that they are the parent or guardian, and pays in their own name on Stripe's page; the item lands on the teen's account |
| an adult | Stripe's own hosted Checkout, one item at a time, with the real-money price and its own confirm |
| over the monthly cap | not until next month |

## In a game

```ts
import { createShop } from '@homie-rocks/studio/shop';
const shop = createShop();
await shop.ready;                        // { open, kids, screen }
if (shop.has('skin:ember')) useEmber();  // synchronous: fine in a render loop
shop.on('change', (owns) => redraw());   // a purchase landed, or a refund took one back
buyButton.onclick = () => shop.open('ember-skin');   // the store sheet (a code to scan on a TV)
shop.used('skin:ember');                 // equipped: it leaves the player's own refund window
```

Rules for the game: open the shop only from a button the player pressed, never from the play, start or wake
button, never on a timer; show prices in real money; never draw a countdown; never sell randomness; do nothing
differently for a supporter on a beginner server.

The play shell around the game answers these calls (the game never sees a card, an email, an order or a
session). The room button's sheet has a **Shop** button too. A purchase opens Stripe's page in a new tab, the game
keeps running, and the shell looks again when the tab comes back: `change` fires once it is paid.

**Badges in rooms.** A player whose account owns a `badge:` key carries it on their seat: `net.players()` gives
`peer.badge` ("Supporter"), set by the studio's Worker from what the account owns when the player connects (a
hello can never claim one). None on a kids server, none for an AI.

## The money path

```
phone (signed in) ─ POST /api/shop/buy ─► studio Worker ─ Checkout Session (the studio's restricted key) ─► Stripe
      ◄──────────────── Stripe's hosted page (new tab): the player pays ─────────────────────────────────┘
Stripe ─ signed webhook ─► POST /api/shop/hook: order paid → entitlements → referral line (held)
homie.rocks: not involved at any step.
```

- The order row is written before Stripe is called; the Checkout Session carries the order, the player and the
  item in its metadata; the hook checks the session matches the order (player, price) before it grants anything.
- The webhook's `Stripe-Signature` is checked (HMAC-SHA256 of `<t>.<payload>` with the endpoint's `whsec_`
  secret, within five minutes); each event id is handled once; a test event never touches a live shop.
- Paid: the entitlements are granted. Refunded: that one order's entitlements are revoked. A dispute: nothing
  changes until it is decided; lost: that one item goes, as a refund would; won: it stays. **The account is never
  locked or deleted over a dispute.**
- Receipts come from Stripe by email (the buyer types it on Stripe's page, never on the studio's). The account
  page lists the player's orders and badges; `/api/player/export` includes them; deleting an account asks first
  when it owns things, and keeps the order rows without the player.
- Each Checkout Session says beside the pay button that the item is delivered at once (the EU and UK withdrawal
  acknowledgement) and that an unused item can still be refunded.

## Setting it up (Claude does the commands; the owner only uses pages)

1. `npx --no-install homie-studio shop init --supporter` (shop.json and SELLING.md), then `shop check`, commit,
   `npm run deploy` (it applies migration `0008_studio_shop.sql`; the shop stays closed).
2. In Stripe (the owner): a restricted key with **Checkout Sessions: Write, Charges: Write (refunds),
   PaymentIntents: Read, Disputes: Read**, and a webhook endpoint at `https://<site>/api/shop/hook` for
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `charge.refunded`, `refund.created`, `refund.updated`, `charge.dispute.created`,
   `charge.dispute.closed`.
3. `npx --no-install homie-studio shop connect`: a page on the owner's computer (127.0.0.1, one use, ten minutes)
   with those steps, both fields and the seller choice (the studio, or Stripe Managed Payments, with what each
   costs and does). The key and the secret go straight to the Worker secrets `STRIPE_KEY` and
   `STRIPE_WEBHOOK_SECRET` on Wrangler's standard input. Test keys only, unless `--live`.
4. `homie-studio shop` says whether anything is still missing. Buy your own item with a Stripe test card, and
   refund it from `/_studio/office/shop`.

Never ask for a key in a chat, never put one in a file, an argument, a log or a commit.

## The office

`/_studio/office/shop` (the owner's browser) and `/_studio/api/shop` (an office key): open or what is missing,
the last 30 days, every order with its Stripe page, Refund (one tap), disputes, payouts, balance and tax as links
to the studio's own Stripe Dashboard, a CSV for the accountant, and the referral books. From an office key a
refund (`POST /_studio/api/shop/refund`, `homie-studio shop refund <order>`) is always an ASK the owner confirms
with one tap; so is marking a referrer paid.

## Referrals

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
against Stripe's own API description) and sign webhooks with a test secret. `STRIPE_API_BASE` (a loopback address
only) points a Worker at such a mock; it is never honoured for anything but 127.0.0.1 or localhost.
