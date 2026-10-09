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
access, so adding a passkey is useful. Checkout checks browser cookies and explains how to enable them if blocked. Item kinds and wording are yours; nothing scans them.
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
- `checkoutMinutes`: optional session lifetime, 30 to 1440 minutes (values below 31 use 31 to leave a transport margin); Stripe defaults to 1440 (24 hours).
  Returning from checkout or starting another checkout asks Stripe to expire your open session.
  Its reservation releases only when Stripe confirms expiry or another terminal outcome.
- `refundDays`: optional self-service refund window for items, including used items by default.
  A tip is never refunded by the player. The studio can refund any paid order or line from its office; disputed charges wait for Stripe to resolve the dispute.
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
Free and paid lines can share a cart. An entirely free cart grants locally without a Stripe call. Product text limits and currency-unit requirements come from Stripe;
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
The shop page has quantities, Add to cart, Remove and Checkout cart. The game API opens checkout in another tab, keeping the game and room running. If another tab cannot open, checkout uses the current tab and returns to the game or TV page after payment or cancellation. The cart stays in memory and is lost when its game page closes.

`POST /api/shop/buy` accepts `{ "lines": [{ "item": "badge", "quantity": 2 }] }` or
`{ "item": "badge" }`. Tip lines also take `amount`. Client-supplied fixed prices are ignored.
One order stores every line and its item snapshot. `/api/shop/mine` lists the lines;
`POST /api/shop/refund` takes `order` and optionally `line`. The office offers both.

## Connecting and operating

`homie-studio shop init --supporter` writes an example item and `SELLING.md`, without a policy, cap or refund
window. `shop check` validates settings; the build uses the same validation.
`shop connect` (MCP `stripe_login`) starts Stripe's official browser approval, sandbox/test first.
If Stripe CLI is missing, the result gives `npm install -g @stripe/cli@latest` for the AI to run.
The person never supplies a key to the AI. A studio-specific CLI profile avoids borrowing another studio's login.
If the studio is not deployed yet, approval is retained: deploy with `studio_deploy` (and
`cloudflare_login` first if needed), then rerun connect. Webhooks require the deployed HTTPS address.

**The default is keyless.** Connect syncs one Product and Price for each shop.json item and one
Payment Link for each paid item. Tip Prices use custom amounts; free orders stay local. It creates
an account webhook at `<site>/api/shop/hook`, captures its signing secret without displaying it,
and installs `STRIPE_WEBHOOK_SECRET` and `STRIPE_SHOP_LINKS` through Wrangler stdin. No Stripe
API key goes into the Worker. Repeat connect after editing shop.json: changed prices get new
Price versions, changed links get new versions, and removed objects are archived. Old paid orders
keep their frozen item definitions. Receipts contain no credentials. Unchanged runs create nothing.

With an existing account and deployed studio, the person approves Stripe CLI once; an already
connected profile needs zero new approvals. An MCP-only grant is separate and is never extracted.
The AI installs tooling, creates/syncs objects and stores the secret. New account verification,
activation, administrator access settings and Cloudflare authorization are separate prerequisites.
`shop connect --live` requires the owner's go-live request. `--renew` retries browser authorization.
Never request a key from the person for the default flow.

At purchase time, the Worker saves an opaque order reference and sends it as the link's
`client_reference_id`. The buyer confirms quantity or tip amount on Stripe. A signed snapshot
session must match the frozen link, revision, currency and allowed amount before granting. Reusing
a link creates a distinct order for each Session. Returns without a webhook never grant goods.
Refunds and disputes use durable financial snapshots in the existing meta table, without buyer/card
data. They tolerate retries and arrivals before the payment event. Fully successful refunds revoke
items; failed refunds restore the financial booking. A lost dispute revokes goods, never the account.

| Need | Keyless behavior / fuller connection |
|---|---|
| Several different items in one payment | Buy separately. Stripe supports static multi-item links (up to 20 fixed-price lines), but they are not an arbitrary buyer cart. Dynamic carts use the keyed path. |
| Reserve an optional spending allowance | Requires keyed Checkout; a reusable public link cannot atomically reserve this studio's local cap. No silent weakening of a configured cap. |
| Expire an abandoned session | Stripe controls the lifetime; deactivating a link prevents new sessions, not existing sessions. Custom expiry/cancellation requires the keyed path. |
| Refund in one tap / player self-refund | Owner uses Stripe Dashboard or asks their Stripe-connected AI. Signed events update books. Office shows guidance instead of a paid-order refund button. Free refunds remain local. |
| Lost webhook | Remains pending. Stripe retries; the AI can use `stripe events resend <event> --webhook-endpoint <endpoint>` (within Stripe's resend window). No grant from a browser return. Automatic provider-read reconciliation needs a key. |
| Free orders | Local, including free carts; no Stripe account, API key or webhook secret required. |
| Exact local eligibility/sale/repeat enforcement | Local checks run before redirect, but a public link can be reused. Sync deactivates removed links; strict pre-payment enforcement of previously issued links requires keyed sessions. |
| Managed Payments | Payment Links support managed_payments.enabled; connect uses it when the studio selects Stripe as seller, subject to Stripe eligibility and terms. |
| Currency display | Payment Links always enable Stripe Adaptive Pricing. Bookkeeping uses integration currency; presentment details describe what the customer saw. |

An existing `STRIPE_KEY` selects the fuller path automatically. Only if requested, explain:
“The fuller connection adds combined carts, spending limits, automatic recovery and refunds here.”
The explicit `shop connect --manual` path remains available, including `--live`, but requires the
owner's existing Dashboard key step; it does not satisfy one approval. Never choose it automatically.
Running default connect again saves links, removes the API key, and keeps signed-event fulfillment.
When switching to spending restrictions, the AI must deactivate previously issued Payment Links through
the approved CLI and resolve in-flight checkouts before relying on those restrictions; switching credentials
does not cancel old Stripe sessions. The runtime OAuth finding and sources are in `docs/stripe-connect-research.md` in the source checkout.

`shop`, `shop orders`, and `/_studio/office/shop` show readiness and sales. Stripe's optional MCP
is useful for owner-requested refunds and analytics; honor its approval links. Do not create a
secret-returning webhook through a conversation tool: the private connect process owns that call.

## Payment guarantees and schema

The schema step `0012_shop_lines.sql` follows the reservation and statement steps. Deploy applies it through
the existing migration mechanism. It adds tables and columns without changing any existing primary key or
column meaning. Released code keeps working after the step, including through rollback. The new Worker
without the step still reads owned items and refunds from the office; new sales wait for the named step.

A verified payment atomically grants all line snapshots and records the referral share on the order total.
Duplicate events, reconciliation and late payments grant exactly once, including after a missing mark,
owner release, expiry or failure. Refunds revoke only their own lines, retain other purchases of the same key,
and adjust the referral share with exact integer allocation. Stripe tax is read per line when applicable.
Snapshots preserve delivery after catalog edits; the schema step represents older orders as one line.
An unpaid older order has no historical item snapshot and needs its catalog definition to complete delivery.
A missing definition gives a named retryable response and office note; the office can refund the verified
payment. Older paid orders missing a grant are repaired once. An unknown older item is refunded by the office,
since its original kind cannot be recovered safely for player self-service.
A whole-order refund uses one Stripe refund for the remaining charge. Dashboard partial refunds reduce cap
usage and referral shares by their pre-tax portion, without assigning money to an unnamed line.
Refunds are rebuilt from [Stripe’s refunds list](https://docs.stripe.com/api/refunds/list). Only
[succeeded refunds](https://docs.stripe.com/api/refunds/object#refund_object-status) revoke items;
pending refunds keep them and failed refunds restore them. A named line loses only its own items;
an untagged Dashboard refund revokes items only when the whole order is refunded.
Unneeded signed events are acknowledged without recording. A refund or dispute naming an unrecorded payment
of this database recovers its Checkout Session first, regardless of event age.

**With an API key**, sessions reserve the optional cap until Stripe confirms an outcome. With the default lifetime, a sessionless
reservation ages out after 24 hours plus a one-minute margin; your `checkoutMinutes` changes that window.
[Stripe session lifetime](https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-expires_at)
and [expiring open sessions](https://docs.stripe.com/api/checkout/sessions/expire) define these provider bounds.
Replacing an open checkout expires only reservations at least a minute old; a named cancellation can expire immediately.
Unresolved orders become eligible for reconciliation after one minute, even with no cap. A buyer's next shop
or owned-items request schedules up to three reads off the response path, with atomic claims and backoff up
to an hour; an optional Worker cron invokes the same reconciliation across buyers. No cron is installed for you. To run it every five minutes, add `"triggers": { "crons": ["*/5 * * * *"] }` to the studio’s root `wrangler.jsonc`; deploy preserves its triggers.
With an API key, every recorded payment checks Stripe’s refunds and dispute state, including payments recovered by an early refund or dispute event. The thanks page can verify a payment directly with the studio's key. Webhook events require Stripe's signature.
Test and live books stay separate. Owner release attempts to expire an open session, records who released it
and when, and never prevents a later verified payment grant.

Test mode uses Stripe's test cards. Test a cart, its grants and individual refunds before choosing live mode.

Game and TV checkout use the same tab if a new tab is unavailable, then return to the page the buyer left.
During rollback, the released Worker grants only a cart’s first item until the new Worker repairs it; it
allows whole-cart player refunds even when a tip is included, and counts partially refunded carts at
the full amount toward a cap. The additive schema preserves its original rows and entitlement keys.

## Shop button on the screen

An open shop with items for this game or app shows **Shop** above its play/open screen. The shell reserves 52 pixels plus the safe area above the content, so the button never covers its controls. In `game.json` or `app.json`, set `"screen": { "shop": false }` to hide this button (merge with any existing screen settings). The room panel and your own shop buttons still work. Closed shops, kids policies and an empty selection show no button.

```ts
import { createShop } from '@homie-rocks/studio/shop';
const shop = createShop();
shopButton.onclick = () => shop.open();
itemButton.onclick = () => shop.open('supporter');
```

These calls open the same shop in games and apps. Inside a player card, purchases leave for the studio's shop; ordinary play/open pages start Stripe checkout. The studio's TV and kids policies still apply.
