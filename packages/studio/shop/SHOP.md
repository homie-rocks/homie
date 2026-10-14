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
- `catalog`: modes (`test`, `live`) populated by `homie-studio shop catalog` for named Stripe Products.
  Prices always come from your file, even when a Stripe Product exists.
- Optional flood protection: `purchaseAttemptsPerMinute`,
  `purchaseAttemptsPerAddressPerMinute`, `guestBuyersPerAddressPerHour`.
  Omitted or null means no limit. Explicit positive integers apply per Worker instance.
  An explicitly set `PLAYER_LIMIT_DAILY` also applies to new shop buyers.
  `requestBytes` overrides the catalog-sized shop request
  allowance; `SHOP_WEBHOOK_BYTES` (524288) controls the webhook byte allowance.

No toolkit ceiling applies to prices, quantities, tips, durations, refund windows or caps.
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
Payment Link for each paid item, adjustable-quantity menus, and one capacity-limited link per published booking slot. Tip Prices use custom amounts; free orders stay local. It creates
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
| Several different items in one payment | A synced menu opens several fixed-price lines; guests choose quantities on Stripe, including zero. Stripe limits Payment Links to 20 lines; larger catalogues use separate menus. Custom amounts and subscriptions keep separate links. |
| Reserve an optional spending allowance | Requires keyed Checkout; a reusable public link cannot atomically reserve this studio's local cap. No silent weakening of a configured cap. |
| Expire an abandoned session | Stripe controls the lifetime; deactivating a link prevents new sessions, not existing sessions. Custom expiry/cancellation requires the keyed path. |
| Refund in one tap / player self-refund | Owner uses Stripe Dashboard or asks their Stripe-connected AI. Signed events update books. Office shows guidance instead of a paid-order refund button. Free refunds remain local. |
| Lost webhook | Remains pending. Stripe retries; the AI can use `stripe events resend <event> --webhook-endpoint <endpoint>` (within Stripe's resend window). No grant from a browser return. Automatic provider-read reconciliation needs a key. |
| Free orders | Local, including free carts; no Stripe account, API key or webhook secret required. |
| Exact local eligibility/sale/repeat enforcement | Local checks run before redirect, but a public link can be reused. Sync deactivates removed links; strict pre-payment enforcement of previously issued links requires keyed sessions. |
| Managed Payments | Payment Links support managed_payments.enabled; connect uses it when the studio selects Stripe as seller, subject to Stripe eligibility and terms. |
| Currency display | Payment Links always enable Stripe Adaptive Pricing. Bookkeeping uses integration currency; presentment details describe what the customer saw. |

A key alone never selects the fuller path. It requires explicit `STRIPE_CHECKOUT_MODE=sessions` as well as a Worker key. Only if requested, explain: “The optional session connection adds exact app-built carts, spending reservations, expiring holds and runtime refunds.”
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

The schema step `0012_shop_lines.sql` follows the reservation step. Deploy applies it through
the existing migration mechanism. It adds tables and columns without changing any existing primary key or
column meaning. Released code keeps working after the step, including through rollback. The new Worker
without the step still reads owned items and refunds from the office; new sales wait for the named step.

`0022_remove_referrals.sql` removes the old referral tables, keys and sales-attribution columns; orders and entitlements remain intact. Old referral settings are ignored with a build note.

A verified payment atomically records the payment and grants all line snapshots.
Duplicate events, reconciliation and late payments grant exactly once, including after a missing mark,
owner release, expiry or failure. Refunds revoke only their own lines, and retain other purchases of the same key. Stripe tax is read per line when applicable.
Snapshots preserve delivery after catalog edits; the schema step represents older orders as one line.
An unpaid older order has no historical item snapshot and needs its catalog definition to complete delivery.
A missing definition gives a named retryable response and office note; the office can refund the verified
payment. Older paid orders missing a grant are repaired once. An unknown older item is refunded by the office,
since its original kind cannot be recovered safely for player self-service.
A whole-order refund uses one Stripe refund for the remaining charge. Dashboard partial refunds reduce cap
usage by their pre-tax portion, without assigning money to an unnamed line.
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
to an hour; an optional Worker cron invokes the same reconciliation across buyers. Shop/paid-part studios install a five-minute maintenance trigger. Declared functions install their own required scheduling/retry trigger. Put additional studio crons in root `wrangler.custom.json`; build and deploy merge and preserve them.
With an API key, every recorded payment checks Stripe’s refunds and dispute state, including payments recovered by an early refund or dispute event. The thanks page can verify a payment directly with the studio's key. Webhook events require Stripe's signature.
Test and live books stay separate. Owner release attempts to expire an open session, records who released it
and when, and never prevents a later verified payment grant.

Test mode uses Stripe's test cards. Test a cart, its grants and individual refunds before choosing live mode.

Game and TV checkout use the same tab if a new tab is unavailable, then return to the page the buyer left.
During rollback, the released Worker grants only a cart’s first item until the new Worker repairs it; it
allows whole-cart player refunds even when a tip is included, and counts partially refunded carts at
the full amount toward a cap. The additive schema preserves its original rows and entitlement keys.

## Shop button on the screen

An open shop with items for this game or app shows **Shop** above its play/open screen. The shell reserves 52 pixels plus the safe area above the content, so the button never covers its controls. In `game.json` or `app.json`, set `"screen": { "shop": false }` to disable the experience’s shop (merge with any existing screen settings). Keep it true or omitted when your app uses its own `createShop` buttons; false also refuses their checkout bridge requests. Closed shops, kids policies and an empty selection show no button.

```ts
import { createShop } from '@homie-rocks/studio/shop';
const shop = createShop();
shopButton.onclick = () => shop.open();
itemButton.onclick = () => shop.open('supporter');
```

These calls open the same shop in games and apps. Inside a player card, purchases leave for the studio's shop; ordinary play/open pages start Stripe checkout. The studio's TV and kids policies still apply.

## App payment references

Create the booking/ticket/gift intention first. `shop.buy('full-tune', 1, undefined, { reference: booking.id })` or `shop.checkout({ reference: booking.id })` sends the app's own reference through checkout. Existing boolean returns are unchanged: checkout opened is not paid. The verified durable `order.paid` event carries `data.order`, `data.reference` (null if omitted) and `data.app`. Reopened Payment Links retain the reference. A reference is buyer-supplied correlation, not authorization: verify the record, app, amount and currency, deduplicate by event/order ID, then fulfil it. Keep personal data out of references. Before Stripe is connected, local prices and unpaid requests can be demonstrated; actual payment and recurring collection remain unverified. Test events must be labelled simulations.

For referrals, use Stripe Connect to split payments or a Stripe-based affiliate service; Homie builds none.

## Keyless menus, paid seats and monthly giving (0.51.0)

Use `shop connect` by default. All objects belong to the owner's Stripe account and
are created through its approved CLI session. Homie has no platform key, OAuth
backend, payment intermediary or cut. A desktop is needed to sync, not to take money.

**A round to table 7:** declare fixed-price drinks in shop.json and run connect.

```ts
shop.add('negroni', 2);
shop.add('spritz', 1);
await shop.checkout({ reference: 'table-7' });
```

The default opens the synced Stripe menu containing those items. The guest chooses
final quantities **on Stripe**, starting at one for each menu line; the local cart's
quantities are not prefilled. Adjustable quantity minimum is zero (Stripe prevents
removing the last item). Payment Links support at most 20 lines. Keyless sync splits catalogues into menus of ten to fit signed invoice snapshots without authenticated pagination. Split larger menus;
if selected items span menus, the app receives `menu` and should offer separate
checkouts. Custom amounts cannot be mixed into this menu; offer a separate tip link.
Stripe invoice creation is enabled for menus (Stripe's invoice pricing applies).
Only signed paid invoice lines supply `order.paid.data.lines`, including actual
item, quantity and amount; no quantity is guessed from the total. Incomplete invoice
snapshots remain pending for recovery rather than granting a guessed order.

The opaque local order ID is `client_reference_id`; its durable reference maps back
to `table-7` in `order.paid.data.reference` and the buyer's order response. No personal
data goes in that reference. A return URL is never proof of payment.

**Book a tune; the seat is held only when paid:** declare a staff-written `slots`
collection with integer `capacity` and a server-managed `bookings` collection with
`"booking":{"slots":"slots","item":"full-tune"}`. Publish slot records, then have
the owner's AI write the complete manifest to `.studio/booking-slots.json` and run
`shop connect`, or call local MCP `stripe_bookings_sync` with the same `slots` array:

```json
[{"app":"tune","collection":"bookings","slots":"slots","slot":"sat-0900","item":"full-tune","capacity":1}]
```

Sync after publishing or changing slots. Removed or inactive slots deactivate their
links. Each link has `restrictions.completed_sessions.limit = capacity`, with one
fixed service and one seat per checkout. Re-sync preserves Stripe's lifetime completed
count. Free slots stay local and use separate slot records from paid links. Never increment capacity just to hide a full-link error.
Refunds do not decrement Stripe's completed-session counter; the owner's AI must
review availability and resync explicitly. A changed price should use a new slot;
do not replace a sold link and accidentally reset its capacity counter.

```ts
const result = await shop.book('full-tune', {collection:'bookings',slot:'sat-0900'});
// result.booking is the tracking record ID.
```

Opening the link creates local `pending` state, best effort. It does **not** block
other guests. Confirmed payment creates `confirmed`; expiry/failure/refund releases
the local record. The app must say “Pay to secure your seat,” not promise an exclusive
unpaid hold. Slot reads expose `record.booking.full`, `available` and `synced` for the
UI; Stripe's full-link update and verified confirmations make the app show Full.
Events include `booking.pending`, `.confirmed`, `.released`, `.moved`; free and
explicit keyed bookings also use `.held`. Before staff moves, the owner's AI syncs **both affected slots** with `active:false`;
sync deactivates their links and expires open sessions. Wait for signed payment events,
then staff makes the versioned `{slot:...}` update. Moving into an unpaused paid target
is refused. Read fresh confirmed booking counts and sync each affected slot with
`confirmed:<count>` and `active:true`. Sync adjusts the lifetime completion budget to
`Stripe completed + capacity - confirmed` (initial publication uses capacity exactly).
This also reopens refunded availability after an explicit review. Never use a stale
confirmed count or skip pausing: local staff movement cannot mutate Stripe by itself.
An explicit keyed session connection retains exclusive expiring unpaid holds.

**Give $20 monthly:** `shop init --giving --currency CAD` includes fixed suggested
monthly gifts. Declare a recurring item, then run connect:

```json
{"id":"monthly-gift","kind":"donation","name":"Give $20 monthly","price":2000,"interval":"month","gives":[]}
```

`shop.buy('monthly-gift',1,undefined,{reference:'gift-20'})` opens a recurring Price
on a Payment Link (subscription mode). The giver chooses among the preset options.
Arbitrary custom monthly amounts require the explicitly selected keyed connection;
never silently request it or ask the person to find/paste a key. One-time custom
amounts remain keyless. `giving.receiptText` is the owner's receipt wording.

Signed `subscription.started`, `.renewed`, `.failed`, `.cancelled` events drive
membership and giving. Membership access ends at the paid invoice line's period end;
failed invoices cannot extend it and cancellation ends access. Unknown Prices grant
nothing. Keyless portal configuration supports cancellation, payment-method updates
and invoice history. `shop connect` enables `login_page.enabled` through the CLI API
and stores Stripe's no-code login URL; **no Dashboard toggle is required**. Givers
verify their email with Stripe to manage/cancel. The buyer-owned `/api/shop/portal`
returns this URL. Plan changes require deliberate portal configuration and fulfilment
mapping; the optional keyed path retains current-provider reconciliation for upgrades.

For offline development, import `startStripeFixture` from the installed toolkit's
`lib/dev-stripe-fixture.mjs`, start it with `{origin:'http://127.0.0.1:8787'}`, and
write its `bindings` as local Wrangler `.dev.vars` in a disposable studio. Keep it
running alongside `homie-studio dev`. The checkout page explicitly says simulation;
it takes no card and no money. Call `close()` and delete the disposable studio when
finished. This tests signed webhook plumbing, not Stripe account permissions.

The giving starter now reads the actual shop donation options with `shop.catalog()`.
`shop init --giving --currency CAD` includes $20 monthly; `app new giving --from giving`
opens Checkout for the selected amount and frequency. A disconnected shop displays
a disabled preview. No intention record or unverified collected total is created.
Use the Manage my gifts link for the buyer-owned Stripe portal in the shop.

For real sandbox acceptance without copying any API key, import `startKeylessStripeSandbox`
from `lib/dev-stripe-sandbox.mjs` and pass `{origin, profile, shop, bookingSlots}` with an explicit
sandbox CLI profile and loopback studio origin. It drives only that profile's
Stripe CLI, starts `stripe listen --forward-to` with the required events, and
returns local dev `bindings` and `close()`. Keep bindings private: the webhook
signing secret is real even in test mode. The keyless helper encodes link configuration for safe .dev.vars transport; do not decode or rewrite that binding. Use the helper’s `links` property for native link IDs when testing. `await helper.sync(manifest)` updates its `links` and `bindings`; save the new bindings and restart dev after a slot sync. `close()` deactivates its sandbox links and stops forwarding. Supply them to the local dev harness
only, never source control or logs. The local webhook forwarding listener needs the desktop; production uses the signed public webhook directly. No API adapter or key is installed in the keyless Worker. It never exports CLI credentials.
Use Stripe's published CLI test fixtures/tokens to complete Checkout via API;
never type card details into a form. Stop on an expired profile and ask the owner
to approve `stripe login --project-name <profile>` once. Stop the adapter and remove
dev bindings and disposable studios when finished.

## Local Stripe test payments

See `apps/APPS.md`, “Real Stripe test checkout on this computer”, for the supported
`shop connect --local` and Stripe CLI forwarding recipe. Every paid monthly cycle
creates a paid order and `order.paid` with the subscription’s original app reference.
