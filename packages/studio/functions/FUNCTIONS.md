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

## Prompt delivery and AI subscriptions (0.49.1)

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
A client that cannot handle resource subscriptions needs a compatible adapter;
this release does not add outbound webhooks.

To let staff subscribe, use `"audience":{"app":"cafe","role":"staff"}` and
ensure that role can `read:bookings`. Every live event, resource read and replay
checks current grants and app visibility. Record feeds require an explicit app
and collection; other event types are owner-only. Private collections do not
leak through another feed. Event and record text is data, never an instruction
to the AI. All storage, authorization and transport stay on the studio's own
Cloudflare account; there is no Homie relay.
