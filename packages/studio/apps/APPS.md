# One screen, roles, parts

`homie-studio app new welcome` writes `apps/welcome/app.json` and the welcome scene. Games and apps share one ID namespace, bundle/room/TV/watch pipeline, parts, shop and standalone builds. Source apps build into the compatibility asset namespace `site/dist/games/<id>`; `games.json` uses `kind: "app"`. Public manifests expose `apps[]` with `open` and `wall` addresses separately from `games[]`.

Open `/<id>/open`, its landing `/<id>/`, or its wall `/<id>/tv`. `?surface=kiosk` and `?role=customer` choose a declared public presentation. The phone surface must be public for standalone customer builds. Every app remains one view that transforms; roles choose what is visible and permitted, not a menu of pages.

## Lasting records

The studio's existing D1 stores app records independently of room checkpoints. Deploy/dev apply `0014_studio_apps.sql`; old studios gain it through the normal migration helper. Previews without D1 return a clear unavailable response, never pretend to persist. Room saves still expire according to the room contract.

```ts
import { createAppRecords } from '@homie-rocks/studio/apps';
const queue = createAppRecords<{ label: string; status: string }>({ collection: 'queue' });
const rows = await queue.list();
await queue.create({ label: 'A17', status: 'waiting' });
await queue.update(rows[0], { ...rows[0].data, status: 'called' });
await queue.remove(rows[0]);
queue.dispose();
```

The shell handles requests only from its own frame and uses its own role, link and account, never authority claimed by the message. The Worker checks every request. Roles declare `signIn: boolean` and `can: ["read:queue", "create:queue", "update:queue", "delete:queue"]`. Collections declare fields with `type` (string/number/boolean), optional `required`, `maxLength`, `enum`, and `initial` (the only value allowed on create). Unknown fields are refused. Records are at most 8 KB and request bodies at most 12 KB. Homie imposes no collection count limit; the studio’s database capacity applies.

Generate a fresh ID for every new record; never reuse a deleted ID. Updates and deletes compare `version` atomically. Conflicts return 409; reload and resolve them. A successful write is committed before acknowledgement. Records are scoped by app and collection, not by room. Deleting a room does not delete records. With `records.persist: false`, use netplay keyed state for transient data instead. Database failures are visible and never replaced with fabricated local success.

Use existing netplay events for refresh notices and shared animation. A missed or malicious notice cannot change authoritative records: reload them on reconnect and at a bounded fallback interval. The starter polls every two seconds and accelerates on room notices. Browser hosts remain untrusted for business data. Public collection reads reveal the whole public collection; ticket IDs and UI filtering are not access control. Use separate protected collections for private data.

## Staff

`homie-studio app role welcome staff --url <origin>` returns an unpredictable role address for the owner. Add `--player <account-id>` to grant an existing non-guest account, or `--revoke` with that player to remove it. The command reuses the office's short-lived owner key. Accounts/passkeys and the office owner's existing session are reused. An anonymous browser with the link goes to `/account/` to sign in; a signed-in account without a grant receives 403. Every record call rechecks the grant, so revocation applies to open tablets too.

The private address hides the staff entrance; it is not a bearer permission. It is never in public metadata. Passkeys require HTTPS or localhost. `dev --lan` exposes the local site to the same Wi-Fi, but does not weaken staff authentication. On local HTTP, provision test sessions explicitly in tests or use a secure local origin for real sign-in.

## Links and plain HTTP

```ts
import { appLink, qrSvg, randomId } from '@homie-rocks/studio/links';
const ticket = randomId(); // 128 cryptographic bits through getRandomValues
const url = appLink('/welcome/open', { ticket, room: 'main' }, 'https://studio.example');
const svg = qrSvg(url, { title: 'Your ticket' });
```

The QR encoder is the existing wall encoder, publicly exported with types. Links allow HTTP(S), preserve parameters and encode values. Do not copy `access` or any other private parameter into a public ticket. The helper works on LAN HTTP, where `crypto.randomUUID` may not exist.

## Parts, check and stores

Parts import exactly as games do (`@parts/<id>` or `@parts/<host>/<id>`), with the same provenance and credit checks. `check.action` and `check.observe` name real UI selectors: the checker clicks on a phone, waits for changed text on wall and both phones, then reloads the actor and checks again. `check.params` optionally supplies public URL parameters (for example `{ "ticket": "404" }`) to all three surfaces so the action can address an existing sample record. The checker always chooses its own room. No round hooks are required. `check` uses fresh isolated records by default; run dev and check its localhost URL. `--no-isolate` explicitly uses existing records. A Codex-only needs plan can omit this baseline action.

`homie-studio standalone plan/build <app-id>` reuses Electron/Capacitor and the same built bundle. Public customer record calls use the existing standalone origin allowlist; credentials are never shared across origins. Native staff sign-in, private collections, offline record writes, native billing and automatic store upload are not implemented. Existing game standalone behavior is unchanged. A store build still needs its normal local SDK, signing and store review.

## Shop button on the screen

An open shop with items for this game or app shows **Shop** above its play/open screen. The shell reserves 52 pixels plus the safe area above the content, so the button never covers its controls. In `game.json` or `app.json`, set `"screen": { "shop": false }` to disable the experience’s shop (merge with any existing screen settings). Keep it true or omitted when your app uses its own `createShop` buttons; false also refuses their checkout bridge requests. Closed shops, kids policies and an empty selection show no button.

```ts
import { createShop } from '@homie-rocks/studio/shop';
const shop = createShop();
shopButton.onclick = () => shop.open();
itemButton.onclick = () => shop.open('supporter');
```

These calls open the same shop in games and apps. Inside a player card, purchases leave for the studio's shop; ordinary play/open pages start Stripe checkout. The studio's TV and kids policies still apply.



`check` uses fresh isolated records by default and prints that choice. Run `dev`,
then check its **localhost** URL with the studio root available. All screens in a
run share its isolated records; later runs start empty. `--no-isolate` explicitly
uses existing records (including when checking a live URL). Do not assume existing
bookings are fixtures: create the needed records through the flow. The baseline
`app.json check` action is optional when the Codex contains executable needs.

`dev` creates a private local test credential. The checker signs each screen into
the role the need names without a passkey ceremony, and still enforces that role’s
record capabilities. This credential only works on loopback with the dev-only
Worker binding; production account sign-in is unchanged. Use `app role <id> staff
--player <account> --studio` for a studio-wide grant; omit `--studio` for one app.
Staff links printed locally use localhost. A grant can be revoked at either scope.

Example: `{"id":"fit","statement":"My crew fits boards from a tablet","role":"staff",
"steps":[{"surface":"tablet","selector":"[data-fit]","click":true}],
"assertions":[{"surface":"tablet","selector":"[data-state]","text":"Fitted"},
{"surface":"tablet","effect":"sound","name":"audio"}]}`.

Nonvisual assertions observe actual platform calls: `sound` (`audio` for Web Audio
source starts, including the audio package, or `media` for media play), `haptic`
(`vibrate`), and `notification` (the notification title). Omit `name` to accept any
request of that type. An app-specific adapter may emit `homie-effect` with
`{effect,name}` at its real trigger. These prove requests, not that an OS delivered
a notification or a person heard audio. Observations reset before each need.

After reloads and rebuilt frames, check waits for online state, completed arrival,
a hidden loading cover and two frames before assertions/captures. Timeout evidence
names the surface and selector/effect it awaited. Dialogs are automatically accepted
and reported. Read retries recover detached frames; dispatched actions are not
silently repeated. `dev` rebuilds root HTML, CSS and JS as well as source and map
changes. Unavailable sandbox Web Storage uses frame-local memory; use app records
or `net.prefs` for persistence across reloads.

Record fields start with a lowercase letter and use lowercase letters, digits and
underscore. Record IDs use 1–64 letters, digits, underscores or hyphens. `app_schema`
and the `app_records` tool schema explain the contract; validation errors name it.

Live and local unconnected shop/giving pages display the declared items and amounts
with disabled payment controls. They say they are not taking payments yet. A fresh
`/shop/` has an empty preview; an authored shop page still takes precedence.

## Booking capacity

See `shop/SHOP.md` for “book a tune and hold the slot”. A collection opts in with
`booking: {slots: 'slots', item: 'full-tune'}`. Slots are ordinary staff-managed
records with integer `capacity`. Bookings are server-managed records created by
`shop.book`; their public data is only slot, quantity and state. Keep personal
information in a separate private collection. Public roles must not have write
capabilities for slots or bookings. Staff movement is a versioned record update
containing only `slot`; confirmation and release follow verified Checkout state.
The default keyless connection uses one Payment Link per published slot. Call
`stripe_bookings_sync` after publishing/changing slots. Pending checkout does not
block others; payment secures the seat. Use record.booking.full/available/synced
for slot display. Read SHOP.md for the complete manifest and limitations.

The giving starter now reads the actual shop donation options with `shop.catalog()`.
`shop init --giving --currency CAD` includes $20 monthly; `app new giving --from giving`
opens Checkout for the selected amount and frequency. A disconnected shop displays
a disabled preview. No intention record or unverified collected total is created.
Use the Manage my gifts link for the buyer-owned Stripe portal in the shop.

Records-only apps support the same shop bridge as room apps. In the sandboxed
view, use `createShop({target: parent})` to send checkout and booking requests to
the authenticated outer shell; a room simulation is not required for payments.

## Real Stripe test checkout on this computer

Use the installed toolkit's app guide and this reference for its exact version.
The local toolkit MCP exposes `parts_find`; the hosted directory connector may not.
With a shell, `homie-studio parts find "giving"` is the supported equivalent. Read a
part's contract: a pledge-only example is not payment fulfilment. The giving starter
uses the shop bridge; `shop.catalog()` is available in this version. Field names
start with a lowercase letter and continue with lowercase letters, digits or `_`.

No public HTTPS address or Cloudflare account is needed for local Stripe test
payments. Use the owner's existing Stripe CLI sandbox profile; log in only when
that profile is unavailable or expired. Never create an imitation checkout.

1. Create the app and `shop init --giving --currency CAD` (choose the actual currency).
2. Choose the computer's Wi-Fi address and a fixed dev port. Run
   `homie-studio shop connect --local --profile <sandbox-profile> --url http://192.168.1.8:8787`.
   This syncs real test Products, Prices and Payment Links through Stripe CLI and
   saves local bindings in the project's `.dev.vars`; it does not deploy or create
   a public webhook. Local products use a separate identity from deployed products.
3. Run `stripe --project-name <sandbox-profile> listen --all-snapshot --forward-to http://localhost:8787/api/shop/hook`.
   Put its signing secret in root `.dev.vars` as `STRIPE_WEBHOOK_SECRET=whsec_…`.
   Keep that listener running. Never commit the secrets file or print its contents.
4. Run `homie-studio dev --lan --port 8787`. Dev loads root `.dev.vars` beside its
   generated Wrangler configuration. Restart after changing bindings. If dev reports
   another port, update the listener and repeat local shop connection with that port.
5. Open **the same Wi-Fi address** on desktop and phones. Checkout returns there,
   so its guest cookie and thank-you page work on both. Localhost is only suitable
   when every browser is on this computer. Use Stripe's test card; verify the signed
   webhook, paid order and app record before reporting success.

The first Checkout emits `order.paid`. Later paid subscription-cycle invoices each
create a distinct paid order and emit `order.paid` with the original app and reference.
Invoice retries do not count again; the initial invoice does not duplicate Checkout.
Keep fulfilment idempotent by order/event ID. Subscription lifecycle events remain
available separately. Failed invoices never create paid gifts.

`check` uses isolated records on localhost by default; `--no-isolate` opts into the
existing records. Stripe webhooks use the ordinary local database, so for a real
payment acceptance run use a disposable studio and `check --no-isolate`. Test money
must not be mistaken for live giving. Named staff/tablet/kiosk surfaces and roles
are supported; only the surfaces named by each need are asserted.

For a Give button opening a new tab, name its popup in the click step:

```json
{"surface":"phone","selector":"[data-give]","click":true,"popup":"checkout"}
```

Later steps and assertions can use `"surface":"checkout"` for the provider page.
The phone remains its own surface; assert its confirmed gift after checkout. The
checker brings each page forward before reading or capturing it. Use the real
provider's controls, never a test-only app action. App sharing defaults to the top
right, clear of bottom tabs; `screen.share` remains an author-controlled override.
