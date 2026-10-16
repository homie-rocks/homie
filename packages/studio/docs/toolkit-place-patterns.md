# Building places: layout, authority and recovery

Start with [the six-build place recipe](../guides/app/PLACES.md) and
[the app contracts](../apps/APPS.md) for screen-to-tool calls, live records,
shared booking holds, named events, IANA time and adversarial needs. The small
CAS example below teaches authority; paid inventory uses `context.bookings` so
checkout and app capacity remain one system.

## TV join safe area

On `/<id>/tv`, the shell sets `body.homie-join-visible` while the join card is present. It publishes CSS pixel values on the document root in both the shell and the sandboxed app: `--homie-join-x`, `--homie-join-y`, `--homie-join-width`, `--homie-join-height`, and `--homie-join-inset-top/right/bottom/left`. The insets include the card's distance from its configured screen edge. Inactive edges are zero; no card means all values are zero and the body class is absent. Measurements update on resize and iframe navigation. The card is at most 480 × 280 CSS pixels; its address wraps within that box.

Reserve an entire strip on either occupied axis, with a gap:

```css
.status { position: fixed; right: 20px;
  bottom: calc(var(--homie-join-inset-bottom, 0px) + 20px); }
.tee-sheet { position: fixed; left: 20px; bottom: 20px;
  right: calc(var(--homie-join-inset-right, 0px) + 20px); }
```

For top/left join corners, use the corresponding top/left insets. Never position critical controls underneath the card merely because it ignores pointer events. Regression coverage measures actual rectangles at 1920×1080, 1280×720 and 3840×2160.

## Authoritative capacity

Bookings and inventory belong to server-side `defineTool` mutations, with strict schemas (`additionalProperties: false`) and atomic versioned writes. A client-writable generic ledger is not an inventory authority: six browsers can all read one remaining place and overwrite one another. Clients may display availability and request a reservation; they cannot supply remaining capacity, identity or a new inventory total.

The executable [reservation example](../guides/app/examples/reserve.mjs) accepts only a slot ID. An owner-only action seeds `ctx.database.put('tee-0900', {remaining: 1, bookings: []}, {version: 0})`. `reserve` reads that row, derives the booking identity from `ctx.caller`, and writes with `{version: row.version}`. One SQLite statement checks the version and updates the entire row; a conflict is a failed reservation, never a success. Six simultaneous requests produce one winner and five conflicts. Do not expose this namespace through a generic client record mutation. Read availability through a separate read-only action. For retryable purchases add a server-owned idempotency key and settlement handling before charging.

## Text first, graphics optional

Bind navigation and text controls before creating a renderer. A failed WebGL context must not prevent those handlers from being installed:

```ts
renderTextControls();
bindNavigation();
try {
  const renderer = new THREE.WebGLRenderer({canvas});
  startScene(renderer);
} catch {
  canvas.hidden = true;
  fallback.hidden = false; // a normal-flow status inside the scene section
}
```

Keep the fallback inside the scene section, outside navigation; never use a fullscreen or fixed overlay. The shell's automatic fallback is a normal-flow status beside the canvas and does not intercept input. Author a Codex need that clicks navigation and asserts the resulting text; then run `homie-studio check <id> --webgl-failure --shots .checks/no-webgl`. This disables WebGL context creation before scripts run in every app frame and executes the same UI needs. A passing rendering check alone does not establish usable text controls.

## Action diagnostics and types

`check` tests whether the action target is covered before dispatch. An obstruction reports the surface, target selector and covering element immediately; remove the overlay or repair its layout before retrying. Navigation/detachment handling does not replay an ambiguous dispatched action.

`build --types` checks imported toolkit sources too. Collision/terrain closure narrowing and tile-coordinate narrowing are fixed in the toolkit; fresh studios need no local suppressions or edits to `node_modules`.

## Connect another studio without another approval page

Use the new studio's directory and the owner's existing Wrangler login (the same Cloudflare account must have D1 access). One command writes a connector config, never its bearer to stdout:

```sh
homie-studio connector --tools studio_stats --out /private/path/studio-connector.json
```

Load that file directly into the AI client's connector configuration using its local configuration/import mechanism. Do not paste, print or include the file in chat or commit it. The file is created exclusively with mode 0600; existing files are never overwritten. Only the file path, token ID, scopes and expiry are reported. The config targets this studio's `/mcp/auth` endpoint. No browser approval is needed when Wrangler is already authenticated; this command does not deploy anything.

Tokens are bound to this origin, limited to the exact named tools, expire after 30 days by default (`--days 1` through `--days 90`), and cannot read MCP resources or subscriptions. D1 stores only the token hash and its scope metadata. Revoke with `homie-studio connector --revoke <id>` from the same studio. Every dispatch rechecks expiry and revocation. A login to a different studio alone does not grant authority over this database.

## Deployment

Cloudflare's official MCP request interface cannot authorize new static-asset uploads with an upload JWT; deploy with Wrangler, Cloudflare's own CLI using browser OAuth.

## Weekly calendar exceptions

`calendarSlots` (also exposed by `ctx.bookings.calendar`) accepts `exceptions`,
keyed by local `YYYY-MM-DD`. Use `null` to omit a holiday or an object containing
`time`, `capacity` and/or `durationMinutes` to override that occurrence. Dates
must belong to the declared range and weekdays. The occurrence ID remains based
on the original series time when an exception changes its start time. DST gaps
and ambiguous times refuse rather than silently changing the booking. Publishing
new calendar data does not itself move existing reservations or change payments.

A `durationMinutes` exception replaces the series `days` duration for that date.
Explicit `undefined` override values are invalid. Removing a published slot with
active reservations is refused by the database (`slot has active bookings`).
Release or cancel those reservations through the payment-aware booking flow before
deleting the slot; omitting a generated date alone does not delete a published row.
