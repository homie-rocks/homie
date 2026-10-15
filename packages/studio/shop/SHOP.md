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
## Default: Stripe's official plugin

Use Stripe's official plugin, authenticated with its browser OAuth approval, for Products,
Prices, Payment Links, menu links, per-slot booking links, monthly giving and the customer
portal. Install with `stripe agent setup` if needed; the MCP URL is
`https://mcp.stripe.com`. Current tools are `stripe_api_search`, `stripe_api_details`,
`stripe_api_read` and `stripe_api_write`. Discover the operation and its schema before
calling it; tool argument shapes can change. See https://docs.stripe.com/mcp.

1. Create/check `shop.json`. Read the app's published slot records and supply the complete
   slot manifest described below. Select the owner's account and sandbox in Stripe's plugin;
   read `/v1/account` to record its account ID. Live mode only after the owner requests it.
2. Call Homie's `stripe_shop_plan` with `account`, `mode: "test"`, `slots` and
   `observations: []`. CLI equivalent: `homie-studio shop plan --have plan-input.json`.
   That JSON file contains the same fields. `operations` contains every independent
   operation currently ready, with method, path, parameters and create idempotency key.
   Execute the batch through Stripe's official plugin, then replan for dependent work.
   `next` remains the first operation for older clients.
3. Append `{ "method": "POST", "path": "…", "params": {…}, "body": <Stripe response> }`
   for **writes as well as reads**. Keep this setup's observations across batches.
   Product creation includes its default Price; link creation expands line items.
   Product and Price Search use studio/origin metadata. Payment Links use paginated
   list reads with `expand[]=data.line_items`, then filter studio/origin metadata locally;
   Stripe has no Payment Link metadata search. There is no per-link read loop.
   The planner saves public observations in `.studio/stripe-mcp-observations.json` and
   reuses them on the next call; send only new responses. Keep that file and
   `.studio/stripe-mcp.json` when moving computers. Changed shop/slot settings refresh
   mutable links while retaining product/price discovery. Account, mode and origin
   changes start separate reads. Pass `refresh: true` for Dashboard changes or a fresh
   verification before webhook installation (CLI: include it in `--have` input).
   Follow search `next_page` and list `starting_after` cursors. On an uncertain write,
   retry its exact idempotency key; never discard successful responses or invent IDs.
4. Call `stripe_shop_plan` with `verify: true` using those observations (CLI
   `homie-studio shop verify --have plan-input.json`). Verification checks real fields,
   line items, menus, slot limits and portal settings. It saves compact public Worker
   configuration and provenance to `.studio/stripe-mcp.json`, never API response history.
   Build writes public links to `site/dist/_site/stripe-shop-links.json`; deploy ships
   that asset, with only its path in Wrangler vars. Large catalogues never use a text
   binding. Deploy after verifying, including when setup began on an already-live site. Checkout then reports only `webhook-secret` missing;
   it cannot open until signed payment events can confirm orders. Changing shop.json,
   the slot manifest or origin requires verification again. Local test configuration
   goes to `.dev.vars`.
5. For a deployed HTTPS studio, run `stripe_webhook` (CLI `homie-studio shop webhook`).
   Follow `studio_job`. This uses Stripe CLI only for private webhook installation,
   checks the same account as the MCP, and installs only the signing secret through
   Wrangler stdin. If Stripe CLI is missing, the tool installs the official
   `@stripe/cli@latest` npm package automatically, checks the executable, then continues.
   An installation failure reports npm permissions/PATH and a retry command. The CLI
   needs one separate browser approval if its
   studio profile is not already connected. MCP approval cannot be reused or exported.
   Cloudflare authorization and an existing deployment are prerequisites.
6. After installation, perform the returned `retire` operations through Stripe MCP to
   archive replaced catalog objects. Use fresh scoped reads for later drift checks. Test a sandbox
   purchase and its signed event, order grant, booking capacity or recurring invoice;
   a browser return is never proof. Stripe CLI `trigger` can send a test event, and
   `events resend <event> --webhook-endpoint <endpoint>` retries a delivery. Check the
   endpoint's delivery result and the app's verified records. Do not type a card into
   a page for an automated proof; use Stripe's documented test PaymentMethods/fixtures.

Upgrades accept 0.51.6 verifications without a source fingerprint only when their
saved content fingerprint still matches the current shop, slots, site and mode.
Actual changes name the affected settings and require verification. An unfinished
setup still builds and deploys with checkout closed and one next step: finish
`stripe_shop_plan` with `verify: true`. Missing/unreadable assets also close checkout;
old link secrets cannot reopen it. Cached observations never renew the verification
time; use fresh reads if the private webhook tool requests them.

Never create a webhook through model-visible Stripe MCP: its response exposes the signing secret.

**Why the separate approval (checked 2026-10-14).** Stripe's
[event destination API](https://docs.stripe.com/api/v2/core/event-destinations/create)
also returns its signing secret only in the private create response when explicitly
included. Thin events still require signature verification and authenticated retrieval
of event details; they do not supply a secret handoff to Wrangler. The
[official MCP](https://docs.stripe.com/mcp) documents no credential or secret transfer
to a studio Worker. Therefore the AI starts `stripe_webhook`, the owner clicks
Approve once in Stripe's CLI browser page if needed, and the tool completes endpoint
creation and Wrangler secret installation privately. MCP approval and CLI approval
are separate. No API key is requested, no secret enters chat, and Homie is never in
the money path. A connected studio CLI profile needs no further approval.


The owner never handles an API key or signing secret. No Homie backend handles payments.
The Worker needs only public link configuration and the signing secret; buyers pay
Stripe directly even when the AI and the owner's computer are offline. The old
`stripe_login` / `shop connect` flow remains an alternative that syncs everything
through Stripe CLI browser approval. `--renew` renews that approval; `--live` requires
the owner's go-live request. Never read CLI config or print login-completion output.

For local checkout, pass `url: "http://localhost:8787"` (or the private Wi-Fi address)
and `mode: "test"` to the same plan/verify flow; the official plugin makes the links.
Run `homie-studio shop listen --profile <sandbox-profile>` in a background terminal.
Stripe CLI is required for forwarding; one browser approval is enough if needed.
The command captures and saves the listener secret privately. Start/restart
`homie-studio dev --lan` once it reports ready and keep the listener running.
Never copy the listener's raw output into the conversation.

For a faster local iteration, `homie-studio build --quick` skips generated rules play
and the snapshot smoke-run, while retaining compilation, guards and type checks.
Run a full build before release; quick output is not evidence that play checks passed.

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

`shop`, `shop orders`, and `/_studio/office/shop` show readiness and sales. Use Stripe's official MCP for owner-requested refunds and analytics; honor its approval links.

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

Use the official MCP plan/verify flow by default. All objects belong to the owner's Stripe account and
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
removing the last item); maximum is the item’s `maxQuantity` from shop.json, default 99 (a positive integer up to 999999). Payment Links support at most 20 lines. Keyless sync splits catalogues into menus of ten to fit signed invoice snapshots without authenticated pagination. Split larger menus;
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
`stripe_shop_plan` with the same `slots` array (the CLI alternative is `stripe_bookings_sync`):

```json
[{"app":"tune","collection":"bookings","slots":"slots","slot":"sat-0900","item":"full-tune","capacity":1}]
```

Sync after publishing or changing slots. Removed or inactive slots deactivate their
links. Each link has `restrictions.completed_sessions.limit = capacity`, with one
fixed service and an adjustable group quantity up to the published remaining seats. Stripe counts completed sessions, not seats: supply the reviewed `confirmed` seat total when resyncing. The database confirms the paid quantity atomically; a capacity race becomes a visible review order rather than an overbooking. Re-sync preserves Stripe's lifetime completed count. Free slots stay local and use separate slot records from paid links. Never increment capacity just to hide a full-link error.
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
and invoice history. The official MCP plan enables `login_page.enabled` through Stripe’s API
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

## Preserve a local basket with keyless checkout

For a venue that wants the phone's exact items and quantities, opt into a saved
basket in `shop.json` before syncing Payment Links:

```json
"basket": {
  "name": "Round for your table",
  "description": "Enter the total shown on your pub basket. Any shortfall is settled at the bar."
}
```

Use Stripe (`till: "stripe"`) and tax-inclusive menu prices (`automaticTax: false`).
Sync creates one custom-amount Price and Payment Link per app, with one line and
quantity one. `shop.checkout({reference: "table-7"})` saves the validated basket
lines, quantities, total and reference in the studio's D1 before opening Stripe.
Even a basket containing only one item keeps its exact quantity. The opaque order
ID travels as `client_reference_id`; no Stripe API key or Homie payment relay is
used by the Worker. Existing menus without `basket` retain their behavior.

The link prefills the saved total using Stripe's documented
[`prefilled_amount`](https://docs.stripe.com/payment-links/customize#customize-checkout-with-url-parameters)
in minor currency units. The guest can edit it, so a preset is never payment proof.
[`custom_unit_amount.preset`](https://docs.stripe.com/api/prices/create?query=custom_unit_amount)
is the Price-level fallback, not a per-buyer setting. Never mutate that shared Price
at checkout: concurrent baskets would race. Both the Price fallback and the URL
override were verified in the Homie sandbox. Invalid overrides fall back to the
stored preset or an empty amount; keep the expected total visible on the phone.

After a signed paid session matches the frozen link, revision, mode, currency and
order reference, `order.paid` contains the **saved basket lines**, `amount` (actual
payment), `basketTotal` (expected total), and `settlement` (`paid` or `short`).
Line `amount` is the saved extended amount (unit price × quantity); line `total`
is its proportionally allocated share of the actual aggregate payment for refunds.
A short payment emits the event so staff can resolve it, but grants no automatic
entitlements. Apps must compare the actual payment with `basketTotal`, show a
shortfall explicitly, and deduplicate by order ID. More than the total is paid.
Reopening and paying the link creates another order for the same frozen basket;
repeated delivery of the same session never creates another round.

The Stripe heading is the connected Stripe account's business name. A sandbox
account named “Homie sandbox” shows that name; a real pub's account shows the pub's
name. The basket's product name and description use the pub's own wording.

### Payments requiring review

A signed paid deposit or basket that cannot match its saved order is retained as a `review` order, with the payment ID and actual total, a customer notice and a durable `payment.review` event. Staff reconcile fulfillment or refund in Stripe. Group payments that exceed remaining capacity follow the same path without granting seats. Repeated events do not duplicate the review order.

Full connect saves `.studio/stripe-mcp.json` and public purchase configuration for the build’s JSON asset, just like plugin verification. Rebuild/deploy before retiring old links. `STRIPE_CHECKOUT_MODE` stays in public Wrangler vars; only the webhook signing secret and private purchase signing keys use secrets.
