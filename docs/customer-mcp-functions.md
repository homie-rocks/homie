# Customer MCP and Studio functions (provisional 0.42.0)

A studio's `/mcp` exposes public discovery and customer purchases alongside its
existing OAuth owner/staff tools. Cart and service offers are resource adapters
for the existing paid-parts purchase engine: MPP, x402, the MCP payment binding,
checkout, claims, reconciliation and refunds share the same lifecycle. A cart's
purchase ID is also its native shop order ID, with native line grants and refunds.
No payment request depends on homie.rocks.

Tool audiences are checked both when listing and when dispatching. Built-ins can
be delegated through `studio.json` `mcp.audiences`. A priced service freezes its
arguments and terms, caches its completed result by order, and gives the handler
`context.purchase.id` for external idempotency. A crash can repeat the handler;
it cannot require another payment for that claim. Signed inbound webhooks direct
priced tools to MCP instead of bypassing payment.

Studio functions are typed `functions/*.ts` files. D1 triggers atomically record
order, refund, record and tool events; rooms keep a SQLite outbox until D1 accepts
it. Functions claim durable leases and retain the same event ID on retry. The
minute cron recovers crashes and failures without an attempt cap. Office →
Functions exposes failures and manual retry. See the toolkit's
[function guide](../packages/studio/functions/FUNCTIONS.md) and
[tool guide](../packages/studio/tools/TOOLS.md).

## Local acceptance trial

Run `node packages/studio/test/customer-trial.mjs`. It packs this toolkit,
scaffolds a new studio under `/tmp`, installs the packed toolkit with local
workspace dependencies, builds its actual split Worker modules, and serves them
through local workerd with real D1 and R2. An outside MCP SDK client connects to
the HTTP endpoint anonymously. Only the payment provider is a stateful local
Stripe stand-in; the test uses the existing test-order approval gate and standard
MPP shared-payment-token exchange. There is no live charge or deployment.

Observed in `/tmp/homie-customers-trial-DaGHxe/trial.json`:

- Toolkit 0.42.0; anonymous listing included catalogue, cart, purchase and the
  priced `translate` service, and excluded owner office tools.
- Bought two Coffee units for USD 8.00. Order `ord_6t00kMYDgxisDid5kXBf` was paid
  in the native shop, with a quantity-two `coffee` grant.
- Paid USD 2.50 for `translate`; order `ord_1cwtLzcOKwcQUj0ypfG0` returned `HELLO`.
  Repeating that call returned the same completed result. Total provider charges: two.
- The declared `order-ready` function received the cart order's stable event and
  stored its payload in the studio database.
- Two full builds left `wrangler.jsonc` byte-for-byte unchanged.

The release-gate workerd tests additionally exercise human Stripe checkout and
resuming the same priced service, webhook refund revocation, and no Homie payment
host. Virtual-time unit tests cover crash leases, concurrent claimers, duplicate
refund snapshots, atomic record rollback, scheduled ticks, and opt-in rate policy.
Typed function generation and stable config writes are tested as well.
