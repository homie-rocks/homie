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
}, {assertedHandle: 'guest-42'});
if (booked.isError) throw new Error('Reservation was refused');
```

The official MCP TypeScript client owns initialization, Streamable HTTP/SSE,
OAuth discovery, client authentication, schema validation and protocol errors.
`call` returns `{source:{origin,authenticated},untrusted:true,isError,data?,content}`. Structured content is preserved; the
kit's legacy `untrusted-tool-data` envelope is decoded while retaining the untrusted marker and provenance. `listTools` and each description are also labelled untrusted. Before any `ctx.ai` call, wrap remote data and descriptions as untrusted input, preserving `source` and `untrusted`; never concatenate them into system instructions. Content and
`data` remain untrusted business data, never instructions or verified claims.
Transport failures reject; tool failures return `isError:true`. No automatic
booking or payment retries are introduced. Use stable business IDs for retries.

Each operation has a ten-second deadline including discovery, a 1 MiB response
limit before SDK parsing, and a 64 KiB argument limit. Origins must be bare HTTPS
origins on port 443 with public DNS names. IP literals (including IPv6, mapped and integer forms), localhost, .localhost, .local and .internal are refused unless that exact outbound entry explicitly sets `allowPrivate:true`. Config keys are normalized; duplicate normalized keys or mismatched `origin` fields fail. Never take an origin from model or user input without checking it against a list of permitted origins. All redirects are refused. Every fetch, including OAuth metadata and token
requests, must stay on the chosen origin. Credentials are issuer-pinned. A client
and its transport close after each operation; discovery and tokens are cached per origin within the request; tool listing is cursor-paged.
Keep the toolkit's `global_fetch_strictly_public` compatibility flag for
Worker-to-Worker HTTP calls. Every destination must be configured and delegated to the calling tool. Public anonymous calls require `anonymous:true` on that exact outbound entry. An unknown origin never falls back to anonymous. Studio code is trusted Worker
code: these safeguards are not a sandbox for imported JavaScript. Choose trusted
remote operators; this does not implement DNS address pinning.

## Studio identity and allowlists (u)

Each studio deploy generates its own Ed25519 key into the `STUDIO_SIGNING_KEY`
Worker secret via stdin. Private keys never appear in model output, source or
studio.json. Existing keys survive redeploys. Owners exchange nothing.
The caller publishes only public keys at `https://<origin>/.well-known/jwks.json`.
The receiver fetches that exact origin with bounded responses and no redirects.

B declares permitted capabilities:

```json
{"mcp":{"studios":{"inbound":{"concierge":{
  "origin":"https://concierge.example",
  "tools":["studio_availability","studio_book"]
}}}}}
```

A delegates the outbound destination:

```json
{"mcp":{"studios":{"outbound":{"https://venue.example":{
  "tools":["plan_drive"]
}}}}}
```

B's owner opens **Office → AI connections** and clicks **Allow** for the
configured calling origin. All start denied. Allow/Deny is stored in D1 and takes
effect on every dispatch without redeploying, including existing tokens. Tool and
event capability declarations remain in configuration. Audit entries show the
calling origin and the asserted handle, not a misleading local account name.

`/oauth/token` accepts `client_credentials` with RFC 7523 `private_key_jwt`,
`scope=studio`, and the receiver's `/mcp` resource. The client ID, issuer and subject
are the caller's canonical origin; audience is the exact receiver token endpoint.
Assertions have short expiry, `kid`, and a one-use `jti` checked atomically in D1.
The receiver accepts Ed25519/EdDSA keys. Five-minute opaque access tokens are hashed
in D1. Browser OAuth continues using the existing provider.

JWKS cache lifetime is five minutes. Failed fetches are cached for 60 seconds;
unknown `kid` refreshes are limited to once per origin per 60 seconds, including
concurrent requests. Token and studio-hook requests share a mandatory limit of
60 requests per IP per minute before key discovery. Throttled requests return
429 with `Retry-After: 60`. Authentication failures return the same generic 401;
only the owner-visible audit log records the failed stage.

### Manual key rotation

Rotation is manual today. From the studio's `site/` directory (the directory with
its deployed `wrangler.jsonc`), run the following with the deployed origin in
`STUDIO_ORIGIN`. These commands fetch only public keys; the new private key stays
in the Node process and Wrangler stdin. Do not enable shell tracing or print the
bulk input. Use the same Wrangler environment/account as the existing deployment.

```sh
export STUDIO_ORIGIN=https://your-studio.example
node --input-type=module <<'NODE' | npx wrangler secret bulk
import {generateKeyPairSync, randomUUID} from 'node:crypto';
const response = await fetch(new URL('/.well-known/jwks.json', process.env.STUDIO_ORIGIN), {redirect:'error'});
if (!response.ok) throw new Error('Cannot read existing public keys; rotation aborted');
const jwks = await response.json();
if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length > 7 ||
    jwks.keys.some(k => !k || k.d || k.kty !== 'OKP' || k.crv !== 'Ed25519' || !k.x || !k.kid))
  throw new Error('Invalid or too many retained public keys; rotation aborted');
const previous = jwks.keys.map(({kty,crv,x,kid}) => ({kty,crv,x,kid,alg:'EdDSA',use:'sig'}));
const {privateKey} = generateKeyPairSync('ed25519');
const next = {...privateKey.export({format:'jwk'}), kid:randomUUID()};
process.stdout.write(JSON.stringify({
  STUDIO_PREVIOUS_PUBLIC_KEYS: JSON.stringify(previous),
  STUDIO_SIGNING_KEY: JSON.stringify(next)
}));
NODE
```

1. Confirm Wrangler reports that **both** secrets were updated. If the command
   fails, inspect the public JWKS and Wrangler deployment status before retrying.
2. Check `curl --fail "$STUDIO_ORIGIN/.well-known/jwks.json"`: it must publish the
   new `kid` and the previous public keys, with no `d` field. Peer caches may take
   up to 60 seconds to refresh for the new `kid`; retry failed operations with
   their original stable business/event IDs.
3. Retain the old public keys for at least ten minutes after successful rotation.
   Then, provided no other rotation is still in its overlap period, remove them:
   `printf '%s' '[]' | npx wrangler secret put STUDIO_PREVIOUS_PUBLIC_KEYS`.
4. Check the public JWKS again: only the new public key should remain. Existing
   signing keys survive future normal deploys. Deny the origin immediately if a
   key is compromised; rotation overlap is not emergency revocation.

```ts
ctx.caller.studio // {origin:'https://concierge.example', verified:true,
                  //  method:'private_key_jwt'}
ctx.caller.actingFor // {assertedHandle:'guest-42', verified:false,
                     //  assertedBy:'https://concierge.example'}
```

Verified means the caller proved possession of a key published by that HTTPS
origin. It does not verify any person. `assertedHandle` permits only
`[A-Za-z0-9._@-]`, 1–128 characters. Never match it to a local account or grant
roles from it. It only separates bookings within the calling studio. A studio can
assert any handle within its own origin; all handles share origin-level rate
limits. Studio callers use only allowlisted public tools, never signed-in roles.

References: [RFC 7523](https://www.rfc-editor.org/rfc/rfc7523) and the
[MCP client credentials extension](https://github.com/modelcontextprotocol/ext-auth/blob/main/specification/draft/oauth-client-credentials.mdx).

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

The snapshot loads a page of slots, resource records and active allocations in three queries regardless of slot × option count (plus access-policy checks), and uses the same
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

Use Standard Webhooks asymmetric `v1a` Ed25519 signatures with the same studio key and the envelope `{eventId,name,timestamp,source,data}`. On A's outbound destination, add:

```json
{"eventPath":"/hooks/studios/concierge","events":["arrival"]}
```

On B's inbound `concierge` entry, add
`"events":{"arrival":"arrivals"}`. No shared event secret is needed. B's `mcp.events.arrivals` declares `event:"guest.arriving"`, an audience,
and a schema for `{sender:{origin,verified:true},data:{booking,minutes}}`.
Only mapped names can publish to local feeds. Define a function with
`event:'guest.arriving'` to consume `event.data.data` and its verified
`event.data.sender`. The sender cannot select an arbitrary local event type.

```ts
await ctx.studios.send('https://venue.example', 'arrival', {
  id: stableArrivalId, data: {booking: bookingId, minutes: 10}
});
```

The JavaScript `standardwebhooks` package currently supports HMAC `v1` only, so
studio `v1a` uses Web Crypto directly, with fixed cryptographic and spec-framing
regression vectors. The receiver verifies Standard Webhooks `id.timestamp.body` signatures with Web Crypto Ed25519, including a five-minute timestamp window. Both studio event envelopes and business-feed data are limited to **8,192 UTF-8 bytes**; oversized events return a clear 413 error. `webhook-key-id` selects the origin JWKS key; `webhook-origin` must match the configured sender and signed body. IDs are 1–128 letters,
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
returns 404. `fetchSelf` sets `Origin` to the local studio origin, so a custom route’s same-origin/CSRF check will pass; that check is not authorization. Routes must still check the propagated identity and roles. It does not borrow `fetchWithSecret` or mint an owner credential.

`await ctx.rateLimit('friends')` uses a declared Cloudflare Rate Limiting binding,
sharing the same namespace and account key between delegated tools:

```json
{"mcp":{"rateLimits":{"friends":{"binding":"FRIEND_RATE","tools":["join","reserve"]}}}}
```

In wrangler.jsonc, configure `ratelimits` with a stable `namespace_id`, name
`FRIEND_RATE` and `simple:{limit:30,period:60}`. The helper returns `{success}`;
the tool chooses its refusal response. No policy is enabled by default. Signed-in
callers default to their identity key; studio callers default to `studio:<origin>` regardless of asserted handle. Public MCP callers expose `ctx.caller.clientAddressKey` and use that address-based key by default. Do not let customers select keys to bypass your policy.
[Cloudflare's binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
is an approximate per-location limiter, not a globally strict quota or booking
capacity mechanism. Existing authoritative booking/database checks remain necessary.

