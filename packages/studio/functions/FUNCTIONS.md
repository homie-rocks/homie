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
receives its tick. Build preserves existing studio crons and adds a minute tick
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
a webhook sender to orchestrate the studio's internal actions. New declarations
also see retained matching events, so use event IDs and deploy handlers prepared
to process that history.
