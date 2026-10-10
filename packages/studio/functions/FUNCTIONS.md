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
| `order.paid` | `order`, `source`, `amount`, `currency`, `mode` |
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
