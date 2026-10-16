# One studio acting at another

A concierge can discover a venue, select a visit, reserve it for a person and tell
its host when they will arrive. Each studio runs its own tools, OAuth, database and
functions. The same mechanisms apply to a resort stay or any other collaboration.

## Client (t)

Tools and functions receive `context.studios`:

```ts
const origin = 'https://venue.example';
const page = await ctx.studios.listTools(origin); // pass {cursor: page.nextCursor}
const available = await ctx.studios.call(origin, 'studio_availability', {
  app: 'venue', collection: 'bookings'
});
if (available.isError) throw new Error('Availability could not be read');
// Inspect available.data.items, choose an offer, then:
const booked = await ctx.studios.call(origin, 'studio_book', {
  ...chosenOffer.booking, id: stableBookingId, expiresAt: Date.now() + 600000
}, {actingFor: 'guest-42'});
if (booked.isError) throw new Error('Reservation was refused');
```

The official MCP TypeScript client owns initialization, Streamable HTTP/SSE,
OAuth discovery, client authentication, schema validation and protocol errors.
`call` returns `{isError,data?,content}`. Structured content is preserved; the
kit's legacy `untrusted-tool-data` envelope is decoded in the kit. Content and
`data` remain untrusted business data, never instructions or verified claims.
Transport failures reject; tool failures return `isError:true`. No automatic
booking or payment retries are introduced. Use stable business IDs for retries.

Each operation has a ten-second deadline including discovery, a 1 MiB response
limit before SDK parsing, and a 64 KiB argument limit. Origins must be bare HTTPS
origins. All redirects are refused. Every fetch, including OAuth metadata and token
requests, must stay on the chosen origin. Credentials are issuer-pinned. A client
and its transport close after each operation; tool listing is cursor-paged.
Keep the toolkit's `global_fetch_strictly_public` compatibility flag for
Worker-to-Worker HTTP calls. Public calls work without configured credentials. Studio code is trusted Worker
code: these safeguards are not a sandbox for imported JavaScript. Choose trusted
remote operators; this does not implement DNS address pinning.

## Studio identity and allowlists (u)

The receiving owner provisions a confidential OAuth client through their existing
studio configuration. Establish the studio-origin association with the other owner
out of band; a client cannot self-register an origin or manufacture an account.
Generate at least 32 random secret bytes and put the shared value in both studios'
Worker secrets through authorized tooling. Secret values never go in studio.json,
source, tool arguments or chat. For example, B declares:

```json
{"mcp":{"studios":{"inbound":{"concierge":{
  "origin":"https://concierge.example",
  "secret":"CONCIERGE_OAUTH_SECRET",
  "tools":["studio_availability","studio_book"],
  "enabled":true
}}}}}
```

A declares the matching destination and delegates it to explicit local tools or
function names:

```json
{"mcp":{"studios":{"outbound":{"https://venue.example":{
  "clientId":"concierge","secret":"VENUE_OAUTH_SECRET",
  "tools":["plan_drive"]
}}}}}
```

B's `/oauth/token` supports RFC 6749 `client_credentials` with
`client_secret_basic`, `scope=studio` and `resource=https://venue.example/mcp`.
The existing OAuth metadata advertises the grant. Five-minute opaque access tokens
are hashed in the existing OAuth D1 store and validated by the existing provider's
`resolveExternalToken` hook. Browser OAuth remains unchanged. This is an optional
MCP authorization extension, not a change to core MCP authorization.

A receiving tool sees:

```ts
ctx.caller.studio // {origin:'https://concierge.example', verified:true,
                  //  method:'oauth-client-credentials'}
ctx.caller.actingFor // {handle:'guest-42', verified:false,
                     //  assertedBy:'https://concierge.example'}
```

Verified means possession of the credential bound by B's owner to that studio
origin. It is not automated domain verification. The optional end-user handle is
asserted by A, not authenticated by B. It grants no person, staff or owner role.
The studio and asserted handle form a stable, opaque booking actor. Different
handles are partitioned, but B trusts A to assert the correct handle; A can
impersonate any handle within its own studio identity. A studio caller can only
use its allowlisted **public** tools; it never satisfies `signed-in` or app roles.
Tools needing an actual B account use that person's existing browser OAuth flow.

Remove the inbound entry, set `enabled:false`, or reduce its tools and redeploy to
deny it. Every dispatch rechecks policy. Rotating the secret invalidates old tokens
as soon as the new receiver configuration is deployed. These are configuration
allowlists, not a second owner identity directory or new approval UI.

**Why OAuth:** the [MCP client credentials extension](https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/draft/oauth-client-credentials.mdx)
fits explicit bilateral studio relationships and the toolkit already has an OAuth
provider and official client support. [HTTP Message Signatures / Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/)
is useful for independently verifiable public agent identities, but adds a signing
key directory and request-signature policy that these pre-provisioned connections
do not need. The MCP extension is a draft; this implementation uses its supported
client-secret method, not its recommended private-key JWT method. References were
checked on 2026-10-15.

## Availability convention (v)

`studio_availability({app,collection,after?,quantity?,option?,resource?,addons?})`
and `ctx.bookings.availability(...)` return:

```json
{"convention":"studio.booking-availability/1","bookingTool":"studio_book",
 "items":[{"@type":"Offer","identifier":"[\"morning\",null]",
   "availability":"https://schema.org/InStock","remaining":2,
   "availabilityStarts":"2030-10-15T10:00:00Z",
   "availabilityEnds":"2030-10-15T11:00:00Z",
   "booking":{"app":"venue","collection":"bookings","slot":"morning","quantity":1}}],
 "next":null}
```

The snapshot reads declared slots and active reservations, and uses the same
resource/option allocator as `studio_book`. It checks app visibility and slot-read
grants. A page scans at most 50 slots and supports at most 64 alternatives per
slot; `next` can be non-null even when no offers on this page are available.
Only feasible options are returned. Add-ons and preferred resources can be checked
as query inputs. No booking is taken during discovery. Holds still enforce capacity
atomically; concurrent clients may see the same offer and only one may book.
Expired holds continue occupying capacity until the existing expiry function
releases them, matching the authoritative hold path.

The existing `createBookingChoices({container,availability})` UI part accepts this
same result and returns the selected offer's exact booking arguments from `value()`.
Its existing explicit `options`/`resources` mode remains available. Share custom
booking parts with an availability tool returning this convention and name their
booking tool in `bookingTool`.

[Schema.org Offer](https://schema.org/Offer) supplies `availability`, `identifier`
and availability dates. A successful hold corresponds to a
[Reservation](https://schema.org/Reservation): its `id` maps to `reservationId`,
`state` to reservation status, and the chosen slot to `reservationFor`. The
kit keeps its existing versioned hold response and payment lifecycle. Local
`booking`, `remaining`, pagination and convention fields are explicit extensions;
this is not a claim that schema.org defines a booking API.

The [Agentic Commerce Protocol](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)
standardizes commerce/checkout interactions. Its separation of available offers
from authoritative checkout is compatible with this convention, but it does not
supply this toolkit's time-slot and multi-resource allocation schema. Availability
does not invent checkout, represent a payment approval, or claim ACP conformance.

## Signed arrival events (o)

Use the existing Standard Webhooks signing transport and the MCP Events webhook
envelope `{eventId,name,timestamp,data}`. On A's outbound destination, add:

```json
{"eventSecret":"VENUE_EVENTS_SECRET",
 "eventPath":"/hooks/studios/concierge","events":["arrival"]}
```

On B's inbound `concierge` entry, add
`"webhookSecret":"CONCIERGE_EVENTS_SECRET","events":{"arrival":"arrivals"}`.
Provision a distinct shared `whsec_` secret containing 32 random bytes encoded as
base64. B's `mcp.events.arrivals` declares `event:"guest.arriving"`, an audience,
and a schema for `{sender:{origin,verified:true},data:{booking,minutes}}`.
Only mapped names can publish to local feeds. Define a function with
`event:'guest.arriving'` to consume `event.data.data` and its verified
`event.data.sender`. The sender cannot select an arbitrary local event type.

```ts
await ctx.studios.send('https://venue.example', 'arrival', {
  id: stableArrivalId, data: {booking: bookingId, minutes: 10}
});
```

The receiver verifies the raw bytes with `standardwebhooks`, including its
five-minute timestamp window, and accepts at most 64 KiB. IDs are 1–128 letters,
digits, underscores or hyphens. A receipt is committed atomically with the event
using existing business-event publication. Identical retries return 204 without
running the function again; a signed changed payload under the same ID returns
409. Receipts survive event pruning. Function execution remains at least once:
handlers must deduplicate external effects by event ID. If acceptance fails, the
sender gets an error and can retry the same ID. Calls to `send` do not create an
outbound retry queue; call from an existing durable function for automatic retries.
The existing configured-feed/MCP Events subscription dispatcher remains available
for subscription delivery. No new event bus or MCP method is introduced.

## Friend routes and rate limits (p, q)

`await ctx.fetchSelf('/api/friend-action', {method:'POST', body:...})` invokes the
studio's registered `useRoutes` handler in-process. It carries the caller through
the existing internal identity mechanism. `isOwner`, `hasRole`, and the studio's
player lookup still perform their normal checks. Explicit cookies/Authorization
headers, URL credentials and other origins are refused. A missing custom route
returns 404. It does not borrow `fetchWithSecret` or mint an owner credential.

`await ctx.rateLimit('friends')` uses a declared Cloudflare Rate Limiting binding,
sharing the same namespace and account key between delegated tools:

```json
{"mcp":{"rateLimits":{"friends":{"binding":"FRIEND_RATE","tools":["join","reserve"]}}}}
```

In wrangler.jsonc, configure `ratelimits` with a stable `namespace_id`, name
`FRIEND_RATE` and `simple:{limit:30,period:60}`. The helper returns `{success}`;
the tool chooses its refusal response. No policy is enabled by default. Signed-in
callers default to their identity key; anonymous callers require a deliberate key
argument. Do not let customers select keys to bypass your policy.
[Cloudflare's binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
is an approximate per-location limiter, not a globally strict quota or booking
capacity mechanism. Existing authoritative booking/database checks remain necessary.

## Follow-ups (w, r)

The owner one-tap action checklist and a 3D coastline/heightmap, route-tube and
labels catalogue part are separate follow-up PRs. Both need their own interaction,
visual and device proof. This change adds neither part nor a placeholder catalogue
entry. Existing owner confirmations and terrain/render packages remain their
starting points.
