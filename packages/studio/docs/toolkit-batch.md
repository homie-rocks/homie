# App references, private frames and checks

`shop.book(item, {collection, slot}, quantity, {reference})` accepts your app's booking reference. `studio_checkout` over MCP accepts `reference` alongside `lines`, `game` and optional `booking: {collection,slot}`. The saved order and `order.paid` event retain this value. It identifies your record; it is not proof of payment. Confirm the signed payment before fulfilling it.

HTTP record creation puts the ID in `/<app>/api/app/records/<collection>/<id>` and fields in `{data:{...}}`. The `app_records` MCP tool and `ctx.records` put `id` at the top level of their arguments, alongside `app` and `collection`. A missing HTTP ID now returns the exact URL format. IDs use 1–64 letters, digits, underscores or hyphens.

Private apps authorize the owner page first, then give its sandboxed frame a signed asset path valid for five minutes. Relative modules and chunks retain that path, without the owner's cookie. Asset capabilities cannot read records, call tools or authorize room sockets. Reload the owner page for a new path after expiry. Responses are private and uncached; unsigned private modules and records stay closed.

`check` gives the baseline action and every Codex need separate browser contexts and fresh rooms. Isolated record namespaces follow those rooms. `check --url https://studio.example` uses the saved owner MCP connection to mint 15-minute app-role sessions. These sessions cannot grant global owner access or access another app, and their record writes stay in the test namespace. Test slots never emit production payment-link work. With `--no-isolate`, records are explicitly shared. A need's `role` applies to its primary surface (`surface`, the first action’s surface, or the phone/matching role in observation-only needs); other surfaces retain their declared roles. Use an individual step's `role` for an explicit override. `--shots <directory>` captures passing and failing UI needs.

`dev` ignores changes to the authoring `CODEX.md` when detecting runtime edits, so saving needs evidence does not interrupt an active check. It reports when its requested port is busy and gives the actual URL. `check` without `--url` follows the running studio's registered dev URL. MCP connections retry a brief Cloudflare 1042 startup response up to three times and report each retry. Other errors return normally. Records-only apps do not inherit game-player cost estimates.

For turn-based games, a `player:true` entity can omit `body` and movement code. Declare its hidden role with `f.text(32, {visibility:'owner'})`; use `visibility:'server'` for secrets no client should receive. Keep hidden roles out of public shared fields and effects. The server projects snapshots for the receiving seat, including spectators. Use `room.start` and `room.on` with `world.after(ticks, event, data)` for phase deadlines; timers belong to the room and require no physics body. The normal server host remains required for secrecy.

Set one studio flag, `"concept":true`, and build for a concept preview. The site returns no directory manifest, disallows indexing and displays a fixed TEST / CONCEPT banner on HTML surfaces. Remove the flag and rebuild to leave concept mode. This labels a test site; it does not sandbox payment credentials or data.

A public records-only app can opt into a direct install surface:

```json
{"web":{"manifest":{"name":"Guest app","short_name":"Guest","icons":[]},"serviceWorker":"sw.js"}}
```

Place the service worker in the app's public files. `/app-id/install` serves the compiled app directly, with a manifest and optional service-worker registration. Records and app-tool helpers use the direct bridge. Add suitable icons and implement the offline behaviour in your service worker. The installed surface runs as same-origin studio code; signed-in/private app shells retain their sandbox. The manifest scope is the app's address, and installation support depends on the browser.

Fork editable example source in one command:

```sh
homie-studio fork /path/to/example /path/to/new-place --name 'New Place' --slug new-place
```

The command renames the studio, app/game IDs, record/slot IDs declared in JSON or JavaScript/TypeScript objects and matching source references. Use `--ids '{"old-id":"new-id"}'` for explicit overrides or long names. It excludes local state, credentials, dependencies, generated output and deployment identities, then generates a fresh Worker configuration. It refuses an existing destination and leaves the example unchanged. Install dependencies and run the returned check before publishing.

Supporter and deposit Payment Links have quantity fixed at one. For a variable deposit, declare `kind:"deposit", price:"choose"`, then call `shop.buy(id, 1, amount, {reference})`. Amounts use currency minor units. The link prefills the saved amount and carries the order ID, which maps back to the app reference. A signed payment with a different subtotal does not fulfill the order. Compute and validate the amount in the app's trusted booking operation and compare the payment event to its saved booking amount before confirmation; a buyer-supplied reference alone grants no authority.

Declare a function or AI event feed for `booking.slots_need_payment_links`. For example, in `studio.json`:

```json
{"mcp":{"events":{"slot-links":{"event":"booking.slots_need_payment_links","audience":"owner"}}}}
```

 Creating or updating a booking's slot record without a matching capacity link inserts the event in the same database transaction. Its `slots` array contains `app`, booking `collection`, slot collection `slots`, `slot`, `item` and `capacity`. The owner's AI reads the full published slot inventory, calls `stripe_shop_plan`, performs its operations through Stripe's official plugin, records responses, verifies, then builds the updated public configuration. Never create webhooks through model-visible plugin calls. Unsubscribed events are not retained. Free items require no payment link.

Resource-aware bookings declare `booking: {slots:"slots", item:"ticket", resources:"resources"}`. Resource records hold `capacity`, optional `skills` arrays and `attributes` objects. Slots hold ISO `start`/`end`, candidate `resources`, and optional required `skills`/`attributes`. `ctx.bookings.hold` accepts `resource` (preferred resource), `option` and `addons`. An option can contain `components`, each naming candidate `resources`, optional `skills`/`attributes`, `units`, `offsetMinutes` and `durationMinutes`. Every component consumes capacity; overlapping allocations are checked atomically by the database. Release frees them. Editing an allocated resource or moving an allocated booking is refused: release and allocate the replacement deliberately. Resource checkout requires the allocated hold ID, so a raw checkout cannot bypass capacity. Paid exclusive holds still require session checkout; keyless inventory cannot share an exclusive unpaid hold.

Set the app's IANA `timeZone`, then use `ctx.bookings.calendar({app,startDate,endDate,time,days,capacity})` for an inclusive season of multi-day slots. `durationMinutes` handles shorter slots; `weekdays` uses Sunday=0 through Saturday=6. Persist the returned records through `ctx.records`. DST gaps and ambiguous wall times are refused; supply an explicit offset timestamp for such exceptional slots.

The public `studio_book` MCP tool uses the same hold operation. It accepts `time` as `slot`, `preferredResource`/`preferred_resource` as `resource`, and `addons`, `addOns` or `add-ons` as either an array of IDs or an object of quantities. Conflicting aliases are refused. Supply a stable request `id`, `expiresAt` within 15 minutes (or the booking declaration’s `holdMinutes`, up to one day), and a private random hex `token` for anonymous bookings. Keep that token private for later management.

The phone helper `createBookingChoices({container,options,resources})` from `@homie-rocks/studio/apps` renders accessible native selects. Submit its `value()` (`{option,resource}`) to the app's trusted booking tool. The phone and customer AI therefore use the same option/resource IDs and capacity rules. Call `dispose()` when the surface closes.
