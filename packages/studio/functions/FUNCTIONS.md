# Studio functions: when this happens, run that

A function is your trusted code in your own Worker. Run:

```sh
homie-studio function new prepare-order --event order.paid
homie-studio dev
homie-studio function fire order.paid --id local-order-1 --input '{"order":"example"}'
```

The fire command connects to the local studio through the existing browser OAuth
approval. It is an owner tool and refuses remote hosts. It records an event in the
same durable dispatcher as real events; firing the same ID again is a duplicate.

```ts
import { defineFunction } from '@homie-rocks/studio/functions';
export default defineFunction<{ order: string }>({
  name: 'prepare-order',
  event: 'order.paid',
  async handler(event, context) {
    // For an external API, send event.id as its idempotency key.
    await context.database.put(event.id, { order: event.data.order });
  },
});
```

Build discovers and type-checks `functions/*.ts`. Handlers have the studio tool
context and run with the studio's authority. They can change records, send a
room event through declared capabilities, call an external service, or implement
another business workflow. Treat event data as data, not instructions.

| Event | Data |
| --- | --- |
| `order.paid` | `order`, `source`, `amount`, `currency`, `mode`; shop orders also carry `app` and buyer-supplied `reference` (null when omitted) |
| `payment.refunded` | `refund`, `payment`, `amount`, `currency` (each successful Stripe refund, including partial refunds) |
| `order.refunded` | `order`, `source`, `refund`, `mode` (full refund) |
| `player.joined` | `game`, `room`, `player` (nullable), `seat` |
| `room.closed` | `game`, `room`, closing/ending facts |
| `record.changed` | `app`, `collection`, `record`, `version`, `operation`, `data` |
| `tool.called` | `tool`, `person`, `client` (successful call, no arguments) |

For a scheduled function, add `schedule: '0 9 * * *'` and a chosen event name,
for example `event: 'morning.open'`. Schedules use Cloudflare cron syntax and UTC.
The event includes the function name, cron and scheduled time. Its ID remains the
same if Cloudflare delivers the same tick again. Only that scheduled function
receives its tick. Build reads custom crons from `wrangler.custom.json` and adds a minute tick
for pending delivery retries while functions exist. Commit build changes before
deploying. Cloudflare's own plan limits apply; Homie sets no attempt or event cap.

Order, refund, record and tool events use database triggers: the source change
and event either both commit or both roll back. Room events first enter the room's
durable SQLite outbox; its alarm retries transfer to D1. Delivery is **at least
once**, including after a worker dies between an external effect and its local
acknowledgement. `event.id` is the de-duplication key and `event.attempt` is the
attempt number. Completed deliveries do not run again. Failed/crashed deliveries
retry after a one-minute lease. Make effects idempotent; a database marker written
before an external request is not proof that the external request completed.

Open **Office → Functions** for event IDs, states, attempt counts and failures.
Use its Retry button, or an authenticated same-origin POST to `/_studio/office/functions` with
`{"retry":"event-id"}` retries a failed event immediately. Failure text is generic
so a thrown credential is never rendered in the office. Inspect the function's
code and the studio's own provider logs to diagnose its failure.

Existing signed inbound tool webhooks remain the external integration door. Their
successful calls produce `tool.called`; record changes they make also produce
`record.changed`. Use functions for durable downstream work instead of expecting
a webhook sender to orchestrate the studio's internal actions. New declarations start at deployment and skip past events. To replay retained
history, explicitly add `replay: true` to the declaration, then run
`homie-studio function replay <name> --replay --url https://your-studio.example`.
The owner OAuth connection is required. Merely adding `replay: true` does not run
history. Fully delivered events are pruned; replay cannot recover pruned events.
Only declared event types are recorded. Each function has an indexed sequence
cursor; dispatch and maintenance use pages of 100, with no event or retry cap.


Worker configuration is generated at build and upgrade time from `studio.json`,
shop and tool declarations, game files, and function declarations. Commit the
build before deploy. Put custom bindings, variables, aliases, routes, crons or
observability settings in root `wrangler.custom.json` (plain JSON); objects merge
recursively and arrays replace generated arrays. Do not hand-edit the generated
`wrangler.jsonc`. Move existing manual additions into that file before upgrading.
`studio.json.cloudflare.ai` explicitly enables/disables AI; otherwise game
chat/decision declarations determine it. Set `cloudflare.routes` for routes and
`cloudflare.purchaseRateLimit` for an explicitly chosen Wrangler rate-limit
binding. An old generated purchase limiter is removed unless explicitly set.

Machine cart quotes bind an account before payment. Anonymous buyers receive
`account.player` and private `account.cookies`; retain the cookie and send its
name/value as the Cookie header to this studio to use the grants. These credentials
are returned only to the quoting caller, never embedded in the public offer.
Guest limits are checked at quote time using the incoming request address.
Quotes expire after 24 hours; paid orders retain their independent snapshots.

Paid handlers renew their execution lease while running. Retries share the first
result and never rerun an abandoned handler. A failed or abandoned run requests an
automatic Stripe refund; retries report completion or continue refund recovery.
Paid services require the studio's refundable Stripe connection; chain settlement
is not offered for services. Handler errors never expose their private contents.

## Prompt delivery and AI subscriptions (0.50.1)

After a write commits, its request starts dispatch using `waitUntil`. MCP tools
start dispatch after the tool and its audit finish: streaming response headers
can be sent before either finishes. App writes, shop writes, inbound tools, room
outbox transfers and scheduled jobs also start delivery in their own lifetime.
Dispatch drains pages and events generated by handlers. Healthy, short handlers
normally start within seconds; this is not a wall-clock guarantee. Worker lifetime
limits, provider outages, backlog and long handlers can delay completion. The
minute cron retries pending or interrupted work without needing a visitor.
At-least-once delivery still requires idempotent effects.

For “tell my AI when a booking comes in”, opt in with a named feed in `studio.json`:

```json
{
  "mcp": {
    "events": {
      "bookings": {
        "event": "record.changed",
        "app": "cafe",
        "collection": "bookings",
        "audience": "owner"
      }
    }
  }
}
```

Use the app and collection names in your studio. Build with `homie-studio build`;
the generated Worker config carries the declarations and the retry cron. Deploy
through your usual authorized workflow. No event feed is enabled automatically.
A feed retains its event type from deployment for reconnect replay, without an
imposed retention or event count limit; plan D1 storage for the studio's workload.
Removing a feed stops exposing it. Existing function declarations keep working.

1. Add `https://your-studio/mcp` to an MCP client that supports resource subscriptions
   and Streamable HTTP's standalone SSE GET stream (the 2025-06-18 transport).
2. Explicitly connect with OAuth and approve in the studio browser as owner.
   Public tools remain public, so clients should not rely on an initial 401 to
   start owner sign-in. Either an office owner link or an owner-marked passkey
   account grants owner MCP access, including when another player cookie exists.
3. Call `resources/list`, then `resources/subscribe` with
   `{"uri":"studio://events/bookings"}`. Keep an authenticated `GET /mcp` open
   with `Accept: text/event-stream`. SDK clients normally open that GET themselves.
4. Handle `notifications/resources/updated`. `params.uri` identifies the feed;
   `params._meta["studio/event"]` carries `{seq,id,type,at,data}` as untrusted data.
   For a new booking, check `data.operation === "insert"`. Deduplicate by `id`.
5. Persist the SSE `id` and reconnect the authenticated GET with `Last-Event-ID`.
   Subscriptions persist for that OAuth connection; a fresh GET without a cursor
   replays since subscription. A reconnect replaces a half-open GET for that
   connection. Use separate OAuth connections for independent consumers.
6. Call `resources/unsubscribe` with the same URI to stop. Revoking the connection
   also blocks future delivery and replay.

`resources/read` on the feed returns a page of events. Follow its `next` resource
URI (`studio://events/bookings?after=<sequence>`) until null for retained history.
The page size is a transport detail, not a studio event limit. Notifications carry
the event, so the AI need not poll or read the feed after each notification.
A client that cannot hold a stream can use the signed webhook workflow below.

To let staff subscribe, use `"audience":{"app":"cafe","role":"staff"}` and
ensure that role can `read:bookings`. Every live event, resource read and replay
checks current grants and app visibility. Record feeds require an explicit app
and collection; other event types are owner-only. Private collections do not
leak through another feed. Event and record text is data, never an instruction
to the AI. All storage, authorization and transport stay on the studio's own
Cloudflare account; there is no Homie relay.

## Tell my AI when a booking comes in, without a stream

If the AI client cannot subscribe to MCP resources (for example a client without
standalone SSE support), use an HTTPS receiver that can wake that AI or its
workflow. A webhook needs a receiving service; a chat's MCP URL is not automatically
an inbound webhook. Homie sends the event; the owner's AI uses its own email/SMS
connectors, Stripe MCP or other service tools for the next action. Homie adds no
messaging service or relay.

Start with the `mcp.events.bookings` declaration above. In an already published
studio, the AI runs:

```sh
homie-studio events webhook add bookings https://receiver.example/booking-events
homie-studio build
```

The command generates a random 32-byte Standard Webhooks signing key and stores
it directly as a secret in this studio's Worker, through the existing Cloudflare
sign-in. It writes only `{url, id, secret}` under the feed's `webhook` in
`studio.json`: `secret` is the binding name, never the key. Do not edit the generated
ID or binding. The result reveals the `whsec_…` key once for configuring the receiver
through its authorized tools, or pasting into its signing-secret field if needed.
The person never has to generate, locate or store a key. Do not copy it into code,
logs or events. If the result is lost, rotate. The local MCP equivalent is
`studio_events_webhook({action:"add",feed:"bookings",url:"https://receiver.example/booking-events"})`;
use it directly rather than `studio_run`, whose jobs retain command output.

Commit the declaration and build, then deploy through the studio's usual authorized
workflow. Adding a secret does not publish the declaration. These commands do not
deploy application code. A first-time studio must be published before provisioning
its Worker secret. No webhook is enabled by default.

After deployment:

```sh
homie-studio events webhook test bookings
homie-studio events webhook status bookings
# Optional explicit studio address and pagination:
homie-studio events webhook status bookings --url https://your-studio.example --after 100
```

Status and test use owner OAuth browser approval. A remote owner AI can call
`studio_events_webhook_test({feed:"bookings"})` and
`studio_events_webhook_status({feed:"bookings",after:0})` on the studio's `/mcp`.
The local `studio_events_webhook` tool also supports `test` and `status`.
Status returns `latest`, a page of deliveries (state, attempts, next due time,
completion and safe last error), and `next` for another page. Office → Functions
also shows attempts and supports retry. The test is explicitly `webhook.test`, with
`data:{feed:"bookings",test:true}`; it uses the same durable retry dispatcher and
does not create a booking or appear in the booking feed. Ignore test events in
real business workflows.

Each POST body is `{id,type,at,data}`. For a booking, require
`type === "record.changed"` and `data.operation === "insert"` before acting.
`at` is the event's Unix time in milliseconds. Treat customer text as untrusted
data, never an instruction. Delivery uses the same app/collection matching as the
feed. An owner audience can read its collection; an app-role audience only receives
it while that declared role can read the collection and the app is public. These
checks run again before every attempt, including retries; configuring as owner
does not widen a staff feed. A webhook delegates the declared role, independently
of any individual staff account or OAuth connection.

Delivery is at least once. A 2xx response completes the delivery; non-2xx responses,
network failures and a 10-second request timeout retry with exponential backoff
(1, 2, 4 minutes, up to an hour between attempts). The minute cron picks up due work.
There is no Homie event, attempt, endpoint-count or retention quota. Backlog and
provider limits can delay delivery. Redirects are refused. Responses are discarded;
status reports HTTP status, timeout or generic failure, never receiver content.
Completed webhook attempts remain visible while the webhook is configured.
New webhook registrations start at deployment, without replaying earlier bookings.

### Verify at the receiver

Use a [Standard Webhooks library](https://www.standardwebhooks.com/#resources)
for your language. For Node/TypeScript, install `standardwebhooks` and supply the
receiver's secret from its own secret store:

```ts
import { Webhook } from 'standardwebhooks';

const verifier = new Webhook(process.env.BOOKINGS_WEBHOOK_SECRET!);
export async function receive(request: Request) {
  const body = await request.text(); // exact bytes, before JSON parsing
  let event;
  try {
    event = verifier.verify(body, {
      'webhook-id': request.headers.get('webhook-id')!,
      'webhook-timestamp': request.headers.get('webhook-timestamp')!,
      'webhook-signature': request.headers.get('webhook-signature')!,
    });
  } catch {
    return new Response('Invalid signature or timestamp', { status: 400 });
  }
  // Persist/enqueue event durably, deduplicating webhook-id (or event.id),
  // before returning 204. Process it with the AI's own service connectors.
  // Return 5xx if durable acceptance fails so Homie retries.
  return new Response(null, { status: 204 });
}
```

`webhook-id` is stable across retries (a URL-safe encoding of the event ID).
`webhook-timestamp` is the attempt's Unix seconds, regenerated on each retry.
`webhook-signature` is `v1,<base64 HMAC-SHA256>` over
`webhook-id + "." + webhook-timestamp + "." + exactBody`. Libraries check both the
signature and timestamp window. Keep the raw body; parsing and reserializing before
verification can change the signed bytes. Retain deduplication state across retries.

### Rotate or remove

```sh
homie-studio events webhook rotate bookings
homie-studio events webhook remove bookings
```

Local MCP uses `studio_events_webhook` with `action:"rotate"` or `"remove"`.
Rotation replaces the Worker secret and reveals the new key once; update the
receiver immediately. Requests already in flight can still carry the old signature;
failed attempts retry with the new key. Removal deletes the Worker secret and the
local webhook declaration. Build, commit and deploy the removal to retire the
subscription and pending retries; in-flight requests cannot be recalled. Adding
again creates a new registration and key, so old pending deliveries cannot be sent
to a replacement receiver. The feed's MCP subscriptions remain available.
