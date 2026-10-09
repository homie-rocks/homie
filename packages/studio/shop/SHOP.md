# Your shop, your choices

You sell through your own Stripe account on your own Cloudflare account. Homie takes no cut.
The studio is the seller and is responsible for the law where it sells and for Stripe's terms.

A minimal `shop.json`:

```json
{
  "items": [
    { "id": "badge", "name": "Studio badge", "price": 500, "gives": ["badge:studio"] },
    { "id": "gift", "kind": "tip", "name": "A gift", "price": "choose" }
  ]
}
```

The default is an open shop: guests can buy, repeatedly, from any page, without an age question.
Guest purchases belong to their browser session; signing in keeps them. Clearing the guest cookie loses
access, so adding a passkey is useful. Item kinds and wording are yours; nothing scans them.
A kind is a label, not a recurring-billing, wallet, random-reward or fulfillment implementation.

## Settings you can choose

- `till`: `stripe` (default), `stripe-managed`, or `off`; `currency`: `usd` by default.
  `automaticTax: true` enables Stripe Tax. Managed Payments uses Stripe's eligibility and tax settings.
- Items: unique `id`, `name`, `price`, optional `kind` (default `item`), `blurb`, `gives`, `badge`,
  `game` (catalog placement), `advantage`, `taxCode`, `starts`, `ends`, and `days`.
  Any item can use `price: "choose"`; a `tip` uses it when price is omitted, or can have a fixed price.
  Variable amounts have optional `min` (zero if omitted) and `max` (unbounded if omitted).
  Dates and durations apply only when written.
- `capPerPlayerMonth`: optional spending cap. A cart reserves its whole pre-tax total atomically.
- `refundDays`: optional self-service refund window for items, including used items by default.
  A tip is never refunded by the player. The studio can refund any order or line from its office.
- `referrals`: optional `rate`, `windowDays`, `capPerPlayer`, `holdDays`, `minimumInvoice`,
  `billingEmail` and `accept`. `rate` defaults to zero until written;
  omitted limits do not apply. `referralNewPlayersOnly: true` limits attribution to new players.
- `catalog`: modes (`test`, `live`) populated by `homie-studio shop catalog` for named Stripe Products.
  Prices always come from your file, even when a Stripe Product exists.
- Flood protection: `purchaseAttemptsPerMinute` (6 per buyer),
  `purchaseAttemptsPerAddressPerMinute` (600), `guestBuyersPerAddressPerHour` (600).
  These are configurable positive integers, per Worker instance. `PLAYER_LIMIT_DAILY` also applies.
  Referral delivery uses `REFERRAL_STATEMENTS_PER_MINUTE`, `REFERRAL_STATEMENTS_GLOBAL_PER_MINUTE`
  (both 30), and `REFERRAL_STATEMENT_BYTES` (65536). `requestBytes` overrides the catalog-sized shop request
  allowance; `SHOP_WEBHOOK_BYTES` (524288) controls the webhook byte allowance.

No toolkit ceiling applies to prices, quantities, tips, durations, refund windows, caps or referral terms.
Money is integer Stripe currency units, with checked safe arithmetic. Stripe's currency rules and
[Checkout's maximum of 100 lines](https://docs.stripe.com/api/checkout/sessions/create#line_items) apply.
Free and paid lines can share a cart. Product text limits and currency-unit requirements come from Stripe;
[Stripe decides settlement minimums and payment-method limits](https://docs.stripe.com/currencies).

## Optional policy bundles

An omitted `policy` or omitted `preset` uses the open settings (`custom`).
Write `"policy": { "preset": "protective" }` to choose the earlier account and age behavior.
Existing files with no preset now use the open default. Explicit settings remain in effect.
Each field can be overridden independently.

| Policy | Open / custom | protective | adults-only |
|---|---|---|---|
| `requireAccount`, `ageQuestion` | false | true | true |
| `children` | allow | deny | deny |
| `teens` | allow | parent | deny |
| `kidsStudio`, `kidsServer` | true | false | false |
| `kidsAdvantages`, `beginnerAdvantages` | true | false | false |
| `repeatPurchases`, `refundUsedItems`, `televisionCheckout` | true | false | false |
| `withdrawalAcknowledgement` | false | true | true |
| `childAge`, `adultAge` | 13, 18 (inactive without age policy) | 13, 18 | 13, 18 |

Age-band choices are `allow`, `deny`, or `parent`. The question retains a band, not a birth year.
Parent links expire after a week for security. The TV option can show a phone code instead of checkout.
Content scans do not exist in any preset.

## Game API and carts

```ts
import { createShop } from '@homie-rocks/studio/shop';
const shop = createShop();
await shop.ready;
shop.has('badge:studio');
shop.on('change', () => redraw());
shop.open();                       // show the shop
shop.add('badge', 2);               // quantity
shop.add('gift', 1, 500);           // chosen tip amount in currency units
await shop.checkout();             // one Stripe Checkout Session
await shop.buy('badge');            // direct purchase stays one call
shop.cart(); shop.clear();
shop.used('badge:studio');          // used-item policy applies only if chosen
```

The studio chooses where to place or open its shop. The shell verifies game messages and the Worker verifies
sessions, ownership, origins and payments. `GET /api/player/owns` includes quantity in each detail row.
The shop page has quantities, Add to cart, Remove and Checkout cart. The game API navigates to Stripe.

`POST /api/shop/buy` accepts `{ "lines": [{ "item": "badge", "quantity": 2 }] }` or
`{ "item": "badge" }`. Tip lines also take `amount`. Client-supplied fixed prices are ignored.
One order stores every line and its item snapshot. `/api/shop/mine` lists the lines;
`POST /api/shop/refund` takes `order` and optionally `line`. The office offers both.

## Connecting and operating

`homie-studio shop init --supporter` writes an example item and `SELLING.md`, without a policy, cap or refund
window. `shop check` validates settings; the build uses the same validation.
`shop connect` opens a local page for the studio's Stripe key and webhook secret; `--live` selects live mode.
A restricted key is useful: Checkout Sessions Write, Charges Write, PaymentIntents Read, Disputes Read;
Webhook Endpoints Write lets the connect page create the webhook. Credentials stay in Worker secrets.
Stripe's agent tools can populate Products with `shop catalog` and read sales; secret-returning endpoint
creation belongs on the connect page. Stripe approval links are handled by the owner.

`shop`, `shop orders`, and `/_studio/office/shop` show readiness and sales. Office refunds are owner actions;
`shop refund <order>` asks the owner to confirm. Stripe controls pending or held refunds.
The office links Stripe's disputes and provides CSV exports. A dispute does not lock a player's account;
a lost dispute revokes the order's entitlements. Referral statements record what the studio owes;
the studio pays referrers directly and marks payment in its office.

## Payment guarantees and schema

The schema step `0012_shop_lines.sql` follows the reservation and statement steps. Deploy applies it through
the existing migration mechanism. A missing step closes checkout and readiness names it.

A verified payment atomically grants all line snapshots and records the referral share on the order total.
Duplicate events, reconciliation and late payments grant exactly once, including after a missing mark,
owner release, expiry or failure. Refunds revoke only their own lines, retain other purchases of the same key,
and adjust the referral share with exact integer allocation. Stripe tax is read per line when applicable.
Snapshots preserve delivery after catalog edits; the schema step represents older orders as one line.
An unpaid older order has no historical item snapshot and needs its catalog definition to complete delivery.

Sessions reserve the optional cap until Stripe confirms an outcome. A sessionless reservation has a
Stripe-default 24-hour creation window and one-minute margin. Session reads use bounded reconciliation with backoff;
GET catalog reads make no Stripe calls. The thanks page can verify a payment directly with the studio's key.
Webhook events require Stripe's signature. Test and live books stay separate. Owner release attempts to
expire an open session, records who released it and when, and never prevents a later verified payment grant.

Test mode uses Stripe's test cards. Test a cart, its grants and individual refunds before choosing live mode.
