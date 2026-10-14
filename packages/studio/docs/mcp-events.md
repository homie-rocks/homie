# Experimental MCP Events

Studio MCP implements the [Triggers & Events working group's design sketch](https://github.com/modelcontextprotocol/experimental-ext-triggers-events/blob/13e0a59749cde947374aaa8e3a65f0b424468d5a/docs/design-sketch-proposal.md) as inspected on 2026-10-14. This is an experimental draft, not an adopted MCP standard. Method names, envelopes, schemas, metadata keys and provisional error codes live in `worker/mcp-events-wire.mjs` so draft changes have one wire-format boundary. The studio's existing `resources/subscribe`, event resources and cursor-read tool continue to work.

Declare feeds in `studio.json` under `mcp.events`. Each map key is the extension's event `name`. For example:

```json
{
  "mcp": {
    "events": {
      "bookings": {
        "event": "record.changed",
        "app": "cafe",
        "collection": "bookings",
        "audience": { "app": "cafe", "role": "staff" },
        "receivers": ["https://your-ai-receiver.example/hooks/studio"]
      }
    }
  }
}
```

`receivers` is an owner-controlled list of exact HTTPS callback URLs, without credentials or fragments. Include only endpoints whose operators have agreed to receive events. A feed's existing configured `webhook.url` is also accepted. Rebuild and deploy the declaration through the studio's usual authorized workflow. Poll and push need no receiver declaration. `maxSubscriptions`, when explicitly declared on a feed, limits its active extension webhooks; otherwise there is no subscription quota. Event arguments are currently `{}`: the declared feed already supplies the app, collection and audience filter.

## An owner's AI connects and subscribes

1. Use an MCP Events-capable client and connect to `<studio-site>/mcp/auth`. Approve with the person's existing studio account in the browser. Staff approve their own account. Do not request an office key. Initialization advertises `capabilities.events.listChanged: true`.
2. Call `events/list`. It returns only feeds the current account can read, with `delivery: ["poll", "push", "webhook"]`, input and payload schemas. Re-list when the general MCP GET channel receives `notifications/events/list_changed`.
3. Choose a delivery mode. These are protocol requests made by the client/SDK, not model-visible tool calls:
   - **Poll:** call `events/poll` with `{ "name": "bookings", "arguments": {}, "cursor": null }`. The first call returns no history and a cursor at now. Persist each returned cursor and pass it on the next poll. Drain `hasMore: true` immediately; otherwise wait `nextPollMs`. Optional `maxEvents` caps a page (server maximum 100); `maxAgeMs` bounds replay.
   - **Push:** POST `events/stream` with a JSON-RPC request ID and `{ "name": "bookings", "arguments": {}, "cursor": null }`. Keep its SSE response open. Expect `notifications/events/active`, then `event` and `heartbeat` notifications. Route by `_meta["io.modelcontextprotocol/subscriptionId"]`, which equals the request ID. Persist cursors and reconnect using the last cursor. Each subscription has its own stream; abort it to unsubscribe. Heartbeats run at 15 seconds when the receiver is reading.
   - **Webhook:** first arrange the receiver and have the owner declare its exact URL in `receivers`. The receiver/client generates `whsec_` plus base64 of 24–64 cryptographically random bytes, and keeps that secret out of prompts and logs. Call `events/subscribe` with the request below. Persist the returned `id`, `cursor` and `refreshBefore`.

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "events/subscribe",
  "params": {
    "name": "bookings",
    "arguments": {},
    "delivery": {
      "mode": "webhook",
      "url": "https://your-ai-receiver.example/hooks/studio",
      "secret": "whsec_<client-generated-base64-secret>"
    },
    "cursor": null,
    "ttlMs": 3600000
  }
}
```

4. For webhooks, use `X-MCP-Subscription-Id` to select the secret and verify the **raw body** using a Standard Webhooks library, including its timestamp freshness check. Durably accept the event before returning 2xx. Deduplicate on `eventId` (also `webhook-id`). Each occurrence has `eventId`, `name`, ISO `timestamp`, `data`, and a safe cursor watermark; it can lag the event's position while deliveries await acknowledgement. Payloads are untrusted data and grant no authority to perform actions.
5. Refresh by repeating `events/subscribe` with the same name, arguments and URL, the current secret and the last persisted cursor **before** `refreshBefore`. Inspect `deliveryStatus.lastError`. TTL defaults to one hour and is capped at one day; `ttlMs: null` receives a finite grant. A live refresh does not rewind pending delivery. To rotate, send a new client-generated secret on refresh; deliveries have both signatures for five minutes. Unsubscribe with `events/unsubscribe` and `{ "name": "bookings", "arguments": {}, "delivery": { "url": "https://your-ai-receiver.example/hooks/studio" } }`.

A gap sets `truncated: true`; persist the new cursor and fetch authoritative state through tools if needed. Revoked access ends push with `notifications/events/terminated` and webhooks with a signed `terminated` control envelope where the callback remains allowed. Stop after termination and re-establish authorization before subscribing again.

## Delivery and owner diagnostics

The 0.50.4 configured studio webhook and extension webhooks share Standard Webhooks signing and the durable `function_deliveries` dispatcher. Extension deliveries retry with exponential backoff, at most five attempts over fifteen minutes from the first attempt. HTTP 410 and 413 abandon that delivery immediately. Abandoned deliveries remain visible to the owner; retained history can be replayed from a prior cursor after unsubscribing and subscribing again. Retries regenerate timestamps and signatures. Failed delivery details are fixed categories, never endpoint bodies or headers. See Functions in the office or the owner's function-runs tool for subscription IDs, attempts and last errors; refresh also reports the latest delivery error. Subscription secrets are stored only in the studio's private D1 subscription state, never in events or run logs. A removed subscription or expired TTL deletes that state. Completed deliveries can be duplicated after a crash, so receivers must deduplicate.

## Draft limits

This implements the studio's **Streamable HTTP** MCP transport; the local toolkit's stdio MCP is a different server. The draft's endpoint-consent mechanism is the explicit server-configured allowlist, not a challenge handshake. Arbitrary client-supplied callback URLs are refused with `CallbackEndpointError / challenge_failed`. Workers `fetch` does not provide DNS address pinning with original Host/TLS SNI, so this implementation cannot follow that draft MUST literally. Exact owner-approved URLs, rechecked at every attempt, and disabled redirects constrain the destination; this is not a claim of draft-complete DNS-rebinding protection. Only approve trusted receiver operators. No no-expiry grants or asymmetric server signatures are offered. Durable queue positions survive Worker restarts, extending the sketch's ephemeral in-flight bookkeeping while preserving client-owned replay cursors. A webhook's conservative safe watermark may lag the event being delivered by one event.

## Production failures from Cloudflare

An owner's AI can also subscribe through the person's **existing Cloudflare connection** to Cloudflare's own API MCP at `https://mcp.cloudflare.com/mcp`: discover `cloudflare.alert.workers_observability_real_time_issue` with `events/list`, then use `events/subscribe` with that descriptor's arguments scoped to the studio's Worker and the client's webhook. Enable Workers Issues on that Worker and grant **Notifications Write** and **Workers Observability Write**. Cloudflare posts signed events for new or recurring production issues, so reliability problems reach the AI without polling. Homie hosts nothing for this connection. See [Cloudflare's 2026-10-13 announcement](https://developers.cloudflare.com/changelog/post/2026-10-13-cloudflare-mcp-events/).
