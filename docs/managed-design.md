# Homie Managed: first-slice design

Status: ready for implementation, subject to the business decisions at the end. Research checked 2026-10-14 against this branch's `@homie-rocks/studio` 0.51.8 and the official documentation linked below. This is a design, not evidence of a deployed service or a recruited pilot. Build sequence: [managed-first-slice.md](managed-first-slice.md).

## Contract and first customer

**Settled:** Managed means Homie operates the studio end to end. The owner signs up, completes Stripe's own onboarding, and talks to Homie's AI. Homie owns hosting, credentials, deployment, monitoring, backups, and support. Self-hosted remains independent: no Homie account, revenue share, payment intermediary, or runtime dependency. Managed is a separate operating mode, not a change to the free toolkit's commercial terms.

**Pilot assumption A1:** one real small venue running a weekly, fixed-price event with bookable seats, one currency, one legal seller, and ordinary contact information. Its identity has not been supplied; do not invent a customer or treat a demo as validation. Recruit the actual operator before tailoring the app. Proposed operating example: weekly workshop, 12 seats, one seat per purchase. The real venue supplies price, timezone, cancellation terms, accessibility information, tax treatment, and capacity. Recurring event means repeated dated slots, not a subscription in this slice.

The owner journey is: sign in → describe the event → connect Stripe → receive a working public URL → ask “move Sam to next Thursday” or “change the arrival instructions.” A customer chooses a date, pays on Stripe, and receives a confirmed booking and receipt. The operator sees a roster and the next event. A money problem or “please get a person” reaches a human in the same conversation. No install, CLI, keys, GitHub, Cloudflare account, or per-studio infrastructure consent appears in that journey.

“Zero friction” cannot remove Stripe's identity checks, later verification requests, business consent, or domain ownership. Homie handles the machinery and explains the remaining business action in one sentence. The first URL is on a Homie-owned domain; custom domains are optional and do not block launch.

**Engineering decisions D1–D8:** WFP isolation; Artifacts source with a managed CI pipeline; Accounts v2 direct charges; fixed-price Payment Links; a platform-operated Agent per studio; deterministic money operations; durable operational evidence; an exercised self-hosted exit. These decisions are specified below, not left for the owner to choose.

## Architecture and hosting decision (D1)

```text
Owner browser ---- Homie identity + control API ---- control D1
       |                   |                         tenant/resource registry
       |                   +---- operator console -- incidents + audit
       |                   +---- provision/deploy Workflows
       |                   |           |
       |                   |     Artifacts repo per studio
       |                   |           | push -> isolated CI -> release gate
       |                   |           v
       +---- studio Agent DO      managed deploy service
                  | scoped MCP          |
                  v                     v
Guests -> hostname router / WFP dispatch -> studio user Worker
                                             |-- dedicated D1 (records/orders/events)
                                             |-- own Table/Lobby DO namespaces (rooms)
                                             |-- own assets / optional R2 bucket
                                             +-- functions, shop, MCP, office

Guests -------------------------> Stripe-hosted Payment Link
Homie payment service ----------> connected merchant account
Stripe signed events -----------> durable payment inbox -> tenant delivery -> studio
Cloudflare Workers Issues ------> MCP Events receiver -> incident / agent / operator
Scheduled probes + reconciliation + backup jobs --------> incident / operator
```

**Choose Workers for Platforms (WFP)** on Homie's Cloudflare account, with separate `managed-preview` and `managed-production` dispatch namespaces and one stable user Worker per studio per environment. Dedicated D1 and tenant-specific room DO namespaces accompany each Worker. Homie control, payments, deploy, and agent services are separate trusted Workers. A studio has one Agent DO instance in the trusted agent service, keyed by immutable tenant ID; it is not code the studio can replace.

[WFP's architecture](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/) supplies dynamic dispatch and untrusted user Workers. [Bindings](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/) support D1, Durable Objects, R2, and platform capabilities. These are Cloudflare capabilities; wiring the toolkit to them is new Homie work and must pass the first integration spike.

| Alternative | Assessment |
| --- | --- |
| One shared Worker and shared database with tenant columns | Cheapest initially, but every generated customization and missing filter can affect everyone. Reject for customer-specific code. |
| Ordinary Worker and D1 per venue on Homie's account | Feasible for one pilot; simpler standard Builds integration. Loses WFP's dispatch, untrusted-code controls, and platform scaling model. Keep only as a documented contingency if the spike exposes an actual blocker; do not silently change isolation. |
| Owner's Cloudflare account | Existing self-hosted path; violates managed onboarding and operational ownership. Keep as the export destination. |
| Separate Cloudflare account per venue | Stronger account boundary, but account lifecycle and credentials add complexity without pilot value. Revisit for enterprise contractual isolation. |
| WFP, separate resources per venue | Chosen. Small fixed platform cost buys the right boundary before customer-specific code grows. |

Hostname routing resolves an exact verified hostname to a tenant, environment, and stable script name; it never accepts a script name or tenant header from the browser. Unknown hosts fail closed. Private routes require identity even if the host is public. Use untrusted mode, dispatch CPU/subrequest limits, and an outbound Worker with an allowlist; deny arbitrary network destinations, redirects, and metadata endpoints. Test service bindings separately: they are capabilities, not protected merely by outbound filtering. No tenant receives the dispatch binding, platform database, Artifacts namespace binding, Stripe platform key, or deployment credentials.

A dedicated database prevents SQL bugs crossing tenants; a dedicated room namespace prevents a guessed room ID doing so. Shared account administration remains a cross-tenant risk. Tenant DO identity and room state must survive releases: keep production script/class names stable; never deploy a new room namespace for each commit. Preview uses disposable resources and synthetic data, never production bindings. The studio has no production secrets capable of operating another tenant.

Later custom domains use [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/) with a Worker fallback origin, verified hostname registry, and active TLS certificate before routing. Homie coordinates DNS delegation/CNAME and renewal; it cannot change an external registrar without the domain owner's authority. Reserve a separate login/control origin and host-only cookies so tenant content cannot inherit platform sessions.

## Identity, signup, and provisioning

**Decision:** verified email magic-link signup, with optional passkey registration and step-up authentication for ownership, payout-related access, exports, and destructive actions. Reuse studio passkey/account machinery where appropriate, but introduce a platform identity service and a short-lived, audience-bound exchange into a studio session. Do not copy an office key into a browser. Staff invitation creates a scoped membership; guests remain separate from operators. Membership revocation invalidates sessions and agent delegation.

Control D1 holds `tenants`, `memberships`, `resource_allocations`, `payment_connections`, versioned `plans`, `releases`, `operations`, `incidents`, and append-only `audit_entries`. Registry identifiers are server-generated. Payment account mapping is unique on `(mode, account_id)` for the pilot: one connected account belongs to one studio. No account ID supplied by a model determines routing.

Provisioning is an idempotent Workflow:

`requested -> resources_ready -> preview_ready -> stripe_pending -> verified -> live`

Each step records provider IDs before advancing, uses a stable operation key, and resumes after failure. Allocate repo, D1, DO namespaces, assets, default domain, agent identity and least-privilege studio principal. A failed attempt leaves a visible resumable status; cleanup only removes resources recorded as unused, never a database holding customer data. Free preview works before Stripe is ready. Production activation requires verified live payment capabilities, tax configuration, event delivery, backup/restore proof, and a staffed support route. Acceptance of the managed service authorizes ordinary provisioning and operations; no repeated infrastructure approvals.

## Payments (D3–D4)

### Account choice and onboarding

**Choose Accounts v2 Merchant configuration**, `dashboard: full`, `defaults.responsibilities.fees_collector: stripe`, and `losses_collector: stripe`. Request card payments and the payout capabilities required by the selected country. This is the modern equivalent of the Standard-style independent merchant relationship; do not build a new integration around legacy `type=standard`. Stripe recommends v2 for new platforms and documents these responsibilities and their immutability. Full Dashboard gives owners direct access to their money and an exit route. Express or no-dashboard accounts add support and platform responsibility without making Homie's normal chat experience simpler. [Account configurations](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration), [v2 SaaS model](https://docs.stripe.com/connect/accounts-v2/saas-platform-payments-billing).

Create the merchant server-side and send the authenticated owner to a short-lived Stripe-hosted onboarding link. Return/refresh routes re-check ownership and retrieve authoritative capabilities and requirements; returning from Stripe is not readiness. Request necessary onboarding information up front to reduce later interruptions. Subscribe to account requirement/capability changes and show a resumable Stripe action when required. Existing Stripe users can reuse business information through networked onboarding; do not promise this attaches their existing account or moves its subscriptions. An existing-account OAuth import is outside the pilot. [Hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding), [Accounts v2 API and compatibility](https://docs.stripe.com/connect/accounts-v2).

**Assumption A2 / launch gate:** Homie's legal platform entity, country, and pilot merchant are eligible for this configuration and fee collection. Engineering must demonstrate live-mode eligibility before accepting sales. Pin the tested API version and explicitly handle v2 account notifications separately from v1 payment events; the current v2 documentation includes preview-version examples. A provider incompatibility blocks payment launch rather than switching liability silently.

### Charge and fee contract

Use direct charges: Products, Prices, and Payment Links belong to the connected account, created by Homie's payment service with account-scoped Stripe requests. The venue is the intended seller; Homie receives only its application fee into its platform balance. Do not use destination charges or pooled balances for this slice. The public Worker receives verified public link configuration, not a Stripe API key. Homie Managed is distinct from Stripe Managed Payments: do not enable Stripe's merchant-of-record product in this integration.

**Critical provider limit:** one-time Payment Links accept `application_fee_amount`, not a percentage. Recurring links accept `application_fee_percent`. Compute a one-time fixed fee at publication for a fixed-price, quantity-one slot; disable optional items, adjustable quantities, discounts, and customer-entered amounts on fee-bearing links. This preserves percentage economics without claiming unsupported Stripe behavior. [Connect Payment Links](https://docs.stripe.com/connect/payment-links).

Plan fields: `sales_fee_bps`, `registered_charity_donation_fee_bps` (default and enforced value **0**), `monthly_price`, currency, sponsor, effective time, and version. Only an explicitly changed business policy can introduce a charity donation fee; ordinary plan changes cannot override that guard. A non-profit is not automatically a registered charity. Record verification and distinguish donations from ticket sales; never infer charity status from the organization's name. Until status is resolved, hold donation fees at zero.

**Proposed business basis B2:** percentage of the fixed service subtotal excluding separately added tax, with no Homie fee on tips or charitable donations. Integer minor-unit calculation: `round_half_up(subtotal * bps / 10000)`, bounded below the charged amount; omit a zero fee. Example hypothesis: CAD 25.00 seat at 3% gives CAD 0.75. Freeze plan/version, basis, currency, expected fee, link, and price in the release manifest and order ledger. Verify the actual ApplicationFee against it. New rates affect future published slots; existing sold slots retain their terms. A rate change requires safe link migration, not overwriting a sold capacity counter. Variable-price commerce waits for a separately designed Checkout path or zero fee; never quietly take the wrong percentage.

### Booking, refunds, payouts, disputes, and tax

Reuse the toolkit's paid-slot contract: one fixed service/seat per Payment Link, completed-session capacity limits, D1 booking triggers, and signed fulfillment. A pending booking is not an exclusive hold. Display “Pay to secure your seat.” Price changes create new slots. Refunds do not reset Stripe's lifetime completion count. [Current shop contract](../packages/studio/shop/SHOP.md).

A managed `move_booking` operation persists steps: lock both slots → pause their links → expire open sessions and reconcile terminal payment states → apply version-checked record move → read fresh counts → resync both limits → reopen. Do not reopen after an ambiguous Stripe timeout. Another request for the same move returns its operation status. The existing target-slot guard is necessary but not the whole distributed transaction. A failed or racing payment becomes a support incident with a clear customer outcome, not an invented confirmation.

Refund questions are read-only agent work. Refund execution is a deterministic service with operator authorization for the pilot: verify order/account, remaining refundable amount, dispute state, reason and unique operation ID; submit once; reconcile pending/succeeded/failed status. Propose returning Homie's fee proportionally, including full fee on a full refund; keep a fee-refund ledger to reconcile Dashboard refunds too. Stripe does not automatically return an application fee with every direct-charge refund. Do not double-refund when a webhook and an operator act together. [Direct-charge refunds](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted#issue-refunds).

Stripe pays out from the merchant's balance to its bank on its configured schedule. Homie does not promise instant availability or change bank details through the AI. Stripe handles connected-account negative-balance responsibility under the chosen configuration; Homie still bears its own balance liabilities and mistakes. Refunds/disputes debit the merchant, and dispute fees follow fee responsibility. Notify operators of payout failures and dispute deadlines; the operator prepares evidence with the venue and records submission. [Fee and dispute behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior).

**Assumption A3:** the venue is liable for tax on its sales, subject to the actual country and marketplace rules. Before live activation, record the determination, registrations, product tax codes and inclusive/exclusive prices. Enable Stripe Tax where applicable; calculation is not registration or remittance. Homie separately accounts for tax on its service fees. Do not advertise charitable tax receipts without the venue's validated receipting process. [Tax with Connect](https://docs.stripe.com/tax/connect), [US reporting responsibilities](https://docs.stripe.com/connect/tax-reporting). Country-specific validation is a launch prerequisite, not an AI tax judgment.

### Webhooks and reconciliation

Homie creates and holds platform and connected-account event destinations and their secrets through its private payment service. No owner CLI/plugin consent is involved. Test and live have separate endpoints, credentials, and registries. Verify raw-body signatures and timestamps before persisting an inbox entry; acknowledge only after durable acceptance. Resolve tenant from the verified account/context and environment, then validate link/product/order ownership. Unknown accounts are quarantined. [Connect webhooks](https://docs.stripe.com/connect/webhooks).

Persist at least these payment facts: connected account/mode, event ID, received time, provider object ID, delivery state/attempts, tenant operation ID, and last reconciled provider status. Use separate unique constraints for inbox events and order/payment identities. The payment API accepts tenant-local order/slot identifiers, expected versions and an operation ID; it derives Stripe account, amount and permitted action server-side. It never offers a model-supplied API path or account override.

New adapter: the payment service delivers a canonical verified event through a tenant-bound private capability to the studio's existing fulfillment logic. Do not expose a public “already verified” bypass or forward a platform secret into every tenant. Deduplicate by environment/account/event and make effects idempotent by payment/order identity. Handle duplicates, out-of-order refunds, delayed payments, and v2 thin notifications by retrieving authoritative state privately. Persist delivery attempts and a dead-letter queue with replay; a 2xx receipt is not proof of fulfillment.

Reconcile unsettled payments every five minutes and the daily order/fee/refund totals against Stripe. Persist cursors, overlap retrieval windows, and compare amounts and statuses rather than trusting webhook arrival order. A browser success return never grants a seat. Disable new checkout on a known fulfillment outage while preserving reads and Stripe inbox intake.

## Source, builds, and releases (D2)

Each studio's source and history live in its own Cloudflare Artifacts repo. Open beta began 2026-10-01; it supports Git, REST, Workers bindings and repository tokens. The platform alone holds the namespace binding. CI gets temporary repo read access; the editing service gets repo-scoped write access. Sharing a build with Homie's team mints a revocable **read** token for that repo, delivered privately with an expiry enforced by scheduled revocation if needed. It grants no records, secrets, deployment, or payment access. Read scope includes repository history, so secrets and customer data must never enter Git. [Beta announcement](https://developers.cloudflare.com/changelog/post/2026-10-01-artifacts-open-beta/), [authentication](https://developers.cloudflare.com/artifacts/guides/authentication/).

**Choose Artifacts events → Cloudflare Workflow + isolated CI runners → WFP deployment service.** Cloudflare documents this custom path specifically for WFP deployments. Standard [Workers Builds Artifacts integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/) supports production `main` and branch previews for ordinary Workers; it is a valid alternative, not proof that its default preview/deploy commands target dispatch namespaces. Do not run both pipelines. [Artifacts CI guide](https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/).

1. Agent writes a task branch via the source service, recording owner request and base commit. Build runs on an immutable commit with pinned toolkit, lockfile, runtime and compatibility date. Repo write access alone never authorizes production.
2. Homie-owned CI definition installs dependencies in isolation and executes the toolkit's full build (not `--quick`), app checks, secret scan and managed configuration validation. User-controlled package scripts get no production bindings or deploy credentials. Extract a content-addressed bundle and checksum.
3. A trusted deployment step constructs its own binding manifest from the registry, never from arbitrary repository IDs. Deploy to the tenant's preview resources, test the booking/MCP flows with synthetic data, and record results. An operator sees a diff and preview for changes outside the low-risk policy.
4. The release gate accepts safe content edits automatically under the owner's standing managed authorization. Payments, permissions, schemas, dependencies, functions, and executable code changes require Homie operator review in the pilot. This is Homie's operational responsibility, not another owner infrastructure approval.
5. Serialize promotion per tenant, compare expected production commit, take a D1 bookmark/export, apply only compatible additive migrations, deploy the tested bundle to the stable production script, and run probes. Persist commit, artifact digest, schema version, binding manifest, plan version, actor and health result.
6. On failure, redeploy the prior known-good bundle/config to the same Worker and namespaces. Never equate code rollback with database rollback. Destructive migrations are excluded from autonomous releases; data recovery follows the runbook below. Failed deploys leave the prior site serving where possible and create an incident.

**Provider verification gate V1:** prove generated static assets, Table/Lobby exports, D1 migrations, scheduled function wakes, MCP streaming, and outbound restrictions in real WFP. If user-Worker scheduling differs, the trusted scheduler invokes a narrowly authenticated tick capability. The toolkit's normal deploy command is not assumed compatible unchanged. Store the result and exact API/tool versions as implementation evidence.

## Agent and tools (D5–D6)

Use the [Cloudflare Agents runtime](https://developers.cloudflare.com/agents/): one durable Agent identity per studio, local SQL conversation/task state, scheduled work, and MCP client connections. The agent wakes on chat, scheduled tasks, or durable events; “around the clock” does not mean continuous inference. Use a Homie-funded model through a server-side provider adapter, initially an Anthropic adapter using the SDK already present in `worker/brain.mjs`, with a pinned model selected by the booking/tool evaluation suite. The existing game-brain integration is not itself the operations-agent loop. Provider/model replacement requires the same task-evaluation suite. No owner model key is needed.

| Capability | Pilot authority |
| --- | --- |
| Read schedule, records, orders, function runs and booking status | Studio-scoped role through MCP; minimal personal data. |
| Move a booking | Narrow deterministic workflow above, after an authenticated owner's request; never raw SQL or invented Stripe status. |
| Change arrival text, opening hours, event copy | Versioned record update or constrained source edit; report the deployed result and undo action. |
| Refund question | Explain current order status and venue policy, prepare an incident; no autonomous money movement. |
| Refund, dispute, payout problem | Human support takes responsibility; deterministic service executes authorized action. |
| Deploy executable code, change permissions, bulk delete, export, change fees | Agent can prepare; dedicated operator/owner authority and step-up as appropriate. |
| Change bank account, read secrets, arbitrary Stripe API, arbitrary production shell | Never exposed as agent tools. |

Reuse `app_schema`, role/version-aware `app_records`, `studio_shop`, `studio_function_runs`, and declared studio tools. Existing scoped connector tokens are tools-only; they do not grant MCP Events access. Add a service-principal authorization path with explicit audience, tenant, tool and event-feed scopes; do not pretend an office token supplies those semantics. Owners bringing another AI use the existing studio `/mcp/auth` OAuth approval and revocation. That optional external-client consent is not required for Homie's built-in agent. All callers face the same server-side policy.

Bound a turn to 12 tool calls and two recovery attempts, serialize mutations per resource, and persist intent before side effects. These are initial engineering limits, configurable after measurements. Exhaustion produces a durable hand-off, not a silent abandoned job. Authorize with authenticated identity and stored policy; a record, webhook, retrieved webpage or tool response cannot grant authority. Keep tenant memory separate and treat all such content as untrusted input. Evaluate prompt-injection, cross-tenant IDs, retries after restart, stale versions, and claims of success without tool evidence.

The repo's official-plugin workflow remains valuable: Stripe's official plugin for self-hosted catalog management and operator investigation; Cloudflare's official tools for infrastructure investigation and Workers Issues. They are not managed runtime credentials. A desktop OAuth grant cannot be extracted and reused by a hosted Agent. Managed operations use Homie's service credentials behind narrow tools; the owner installs nothing. [Existing Stripe workflow](stripe-connect-research.md), [plugin manifest](../plugins/homie/mcp.json).

## Reliability and human hand-off (D7)

The toolkit already has D1 event records, function leases, delivery attempts, room outboxes, and office diagnostics. Extend these rather than introducing a second business event system. Events are at-least-once; they are not a financial ledger or an infinite archive. The current MCP Events wire format is experimental, subscriptions expire, and webhook delivery eventually abandons. Persist renewal deadlines and cursors, alert on renewal failure, and reconcile authoritative records after a gap. [Repo MCP Events contract](../packages/studio/docs/mcp-events.md).

Subscribe Homie's trusted event receiver to Cloudflare's `cloudflare.alert.workers_observability_real_time_issue` through `https://mcp.cloudflare.com/mcp`, with Issues enabled and Notifications Write / Workers Observability Write. Verify signed notifications, deduplicate, map to a registered resource, and create an incident. [Cloudflare's 2026-10-13 announcement](https://developers.cloudflare.com/changelog/post/2026-10-13-cloudflare-mcp-events/). **Verification gate V2:** establish actual dispatch-user-Worker coverage; if unsupported, use account-level ingestion plus WFP logs/tail monitoring and probes. Issues alone cannot detect a successful HTTP response that failed to send a reminder or grant a booking.

Run one-minute availability checks; a synthetic booking journey against the isolated test studio every five minutes; and production invariant checks for paid-but-unfulfilled orders, capacity mismatches, overdue jobs, failed notifications, webhook lag, payout failures and stale backups. Notifications use an outbox with stable message IDs, bounded retries and delivery status. The app remains usable when the model is unavailable. AI spending caps stop inference, never payment reconciliation or incident paging.

| Trigger | Action and accountable response |
| --- | --- |
| Paid order not fulfilled within two minutes, suspected duplicate payment, cross-tenant access, checkout outage | P1 incident; suspend affected writes/checkout when safe, page duty operator immediately; proposed acknowledgement target 15 minutes. |
| Payout failed, dispute opened, repeated workflow failures | P1 if imminent money/deadline risk, otherwise P2 with next-business-day acknowledgement; show actual deadline. |
| Owner asks for a human, expresses distress, or agent cannot safely resolve | Same-thread takeover; stop agent mutations immediately, send acknowledgement and actual support availability. Never require a model distress score to access help. |
| Low-risk content issue | Agent attempts bounded repair; operator ticket if unresolved. |

Incident states: `open -> acknowledged -> investigating -> resolved -> owner_notified`. A console provides tenant/status, timeline, redacted conversation, affected orders and Stripe links, failed runs, last deploy, backup age, and safe actions: pause checkout, retry/reconcile, rollback, start restore, draft/execute refund. Each incident has an assigned operator and next update time. Escalate unacknowledged P1 to a backup operator; no founder-only path. Agents resume mutations only after takeover is released. Operators use MFA, time-limited tenant access and a reason; no shared admin login or routine production shell.

The audit log records request ID, actor/delegation, tenant, tool and validated arguments (redacted), before/after version, policy decision, operation/idempotency key, provider IDs, release, outcome and hand-off. Financial audit records live outside the mutable tenant app, with append-only daily export to a restricted backup account. Do not describe D1 alone as tamper-proof. Owners can see their own action history and export it.

**Proposed internal targets, not an advertised SLA:** 99.9% monthly public availability; 95% of paid confirmations within 60 seconds; P1 acknowledgement within 15 minutes; routine restore within two hours. Measure synthetic availability separately from payment correctness and provider outages. **Assumption A4:** a duty and backup operator can cover promised hours. A 24-hour AI is not a substitute for staffing; business decision B4 gates the public promise.

### Backup and tested restore

Use paid D1 Time Travel (30-day window) for operator-controlled recovery; daily logical D1 exports, source Git bundles, assets and manifests to an isolated backup Cloudflare account with separate deletion authority. Hourly export critical booking/operation data and Agent task checkpoints; journal accepted payment events independently of tenant D1. Retain 30 daily snapshots initially. [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/) explicitly says Time Travel cannot clone/fork into a new database: rehearsal uses logical export/import, not an imaginary clone API.

Room presence is ephemeral; re-create it. Durable bookings, records and schedules live in D1. Export Agent tasks/conversations and declarative schedules; rebuild alarms from task records, not raw opaque DO storage. Any additional persistent room state needs an explicit export adapter before the pilot uses it.

Recovery runbook: freeze tenant mutations and agent tasks; pause links and settle/reconcile open checkouts; keep the independent payment inbox accepting; snapshot damaged state; restore the selected logical export into a fresh D1 and apply the latest compatible hourly operational checkpoint; bind an isolated recovery Worker and run invariants; replay the retained payment journal and compare Stripe authoritative totals; cancel already-completed external side effects in the restored task queue; verify counts and roster; switch binding during maintenance; reopen only after checks. An in-place Time Travel restore is an alternative controlled procedure with the same reconciliation gates. Other studios stay online.

**Targets:** at most one hour of non-payment operational-data loss with hourly exports, two-hour recovery; daily full media/source snapshot as fallback, with source additionally captured on release. Acknowledged payments must be recoverable from the durable inbox and Stripe, not merely the hourly snapshot. These are measured objectives, not guarantees against a Cloudflare-wide outage. Before live sales, a second operator performs a timed restore and a duplicate-event replay without founder help; repeat monthly and after storage changes. Backup success without a restore receipt is not readiness.

## Security, privacy, and leaving (D8)

Host-only secure sessions, CSRF protection, short-lived magic links, passkeys, rate limits, verified tenant routing and least-privilege capabilities are mandatory. Separate production/test credentials and billing modes. Rotate provider/webhook secrets, retain overlap for in-flight delivery, redact logs and never emit secrets through MCP. The payment service and deployment service are high-value shared boundaries: narrow API schemas, resource registry checks, audit, operator MFA, and two-person review for platform credential changes. No model can edit those policies.

**Privacy assumption A5:** basic adult contact/booking data only; no medical records or child profiles. Store minimal booking contact information, restrict staff roles, and avoid PII in Git, URLs, telemetry or prompts unless needed. Publish subprocessors (Cloudflare, Stripe, selected AI and notification providers) and retention terms. Select an Artifacts region deliberately, but do not claim that this creates end-to-end regional residency across D1, model inference and Stripe. Proposed defaults: raw operational logs 30 days, chat 90 days, backups 30 days; financial retention follows launch-jurisdiction requirements. Erasure tombstones must survive restoration so deleted personal data is not accidentally republished. Business approval of retention/jurisdiction is B5.

“Leave anytime” includes an authenticated export without negotiating with support: Git bundle plus history, lockfile and toolkit version; assets/checksums; D1 SQL and CSV/JSON records; schema versions; orders, refunds and provider IDs; declarative functions/tools/schedules; owner-visible audit; and a self-hosted deployment manifest. Exclude Homie credentials, other tenants, sessions, connector grants and provider secrets. Encrypt the export and expire download links. Prototype import into a fresh owner-equivalent Cloudflare account before launch.

For departure, Homie prepares the package and helps an owner or their chosen operator deploy the free toolkit. Self-hosting necessarily needs someone to own the destination infrastructure, but export does not require a GitHub account or Homie subscription. Provision fresh secrets and identity, recreate room/agent state as supported, and restore records. The managed Agent service itself is not required to run the exported studio; the owner may use any AI through MCP.

Payment exit is a workflow, not a switch: pause new sales, settle open sessions, reconcile, create fee-free replacement links and a new owner-held webhook in the same merchant account where supported, verify fulfillment, move the domain, then revoke Homie's access. Full Dashboard access preserves the owner's Stripe history. Existing application fees do not vanish by exporting code; stop future Homie fees explicitly. For future subscriptions, migrate/remove application fees before disconnecting; they are excluded from the pilot. Keep a bounded reconciliation overlap and documented residual dispute responsibility, then delete managed resources after the agreed grace/retention period. Never promise cross-account export of card data or automatic migration to another Stripe account.

## Reuse versus new work

| Existing implementation | Reuse / managed addition |
| --- | --- |
| [`worker/index.mjs`](../packages/studio/worker/index.mjs), [`lib/build.mjs`](../packages/studio/lib/build.mjs), [`lib/worker-build.mjs`](../packages/studio/lib/worker-build.mjs) | Studio site, apps, Worker and full build; add trusted WFP provisioning/deploy adapter and release gates. |
| [`app-records.mjs`](../packages/studio/worker/app-records.mjs), [`booking-store.mjs`](../packages/studio/worker/booking-store.mjs) | Role/versioned records, booking constraints; add resumable managed move orchestration. |
| [`room.mjs`](../packages/studio/worker/room.mjs), [`room-store.mjs`](../packages/studio/worker/room-store.mjs) | Existing room behavior and durable outbox; bind separate tenant namespaces, preserve identities. |
| [`functions.mjs`](../packages/studio/worker/functions.mjs), [`functions/FUNCTIONS.md`](../packages/studio/functions/FUNCTIONS.md) | Event/schedule functions, leases, retries and diagnostics; add watchdogs and managed wake integration. |
| [`mcp.mjs`](../packages/studio/worker/mcp.mjs), [`mcp-tools.mjs`](../packages/studio/worker/mcp-tools.mjs), [`docs/mcp-events.md`](../packages/studio/docs/mcp-events.md) | OAuth tools, role checks and event transports; add platform service principals, hosted MCP client and subscription renewal. |
| [`lib/shop-mcp.mjs`](../packages/studio/lib/shop-mcp.mjs), [`lib/shop-links.mjs`](../packages/studio/lib/shop-links.mjs), [`worker/stripe.mjs`](../packages/studio/worker/stripe.mjs) | Catalog plan/verify and fulfillment semantics; add Connect account context, fee fields, private event adapter and reconciliation. Existing owner CLI webhook setup is not the managed path. |
| [`worker/office.mjs`](../packages/studio/worker/office.mjs), [`worker/webauthn.mjs`](../packages/studio/worker/webauthn.mjs) | Studio office/passkey primitives; add platform identity, operator console, incidents and audit. |
| Toolkit `agents` dependency and existing game agents | Reuse SDK familiarity only. A venue's persistent operations Agent is a new service, not the game's bot brain. |
| Official plugins and Homie guides | Keep self-hosted browser approvals; use official tools for Homie operator work, with managed server credentials isolated from chat. |

New components should form a small managed control package and narrowly scoped toolkit adapters. No fork of the shop or records engine. The existing toolkit continues to build and sell without calling Homie. These two documents introduce no implementation changes.

## Pricing hypotheses, costs, and proof

**Settled:** managed sales percentage through Connect; no cut of registered-charity donations. Rate is plan data. Monthly pricing is a comparison/possible later plan, not a replacement decision smuggled into engineering.

**Hypotheses, not prices offered:** 3% with no monthly minimum reduces adoption friction; a $29/month + 1% plan improves predictability for busier venues; a $49 flat plan tests willingness to pay for operations independent of sales. At $2,000 monthly eligible sales these yield $60, $49 and $49; at $10,000, $300, $129 and $49. Use one currency for a real offer; these are arithmetic examples. Percentage-only fails for valuable free services. A sponsored non-profit plan can set both monthly and donation fees to zero and charge an identified sponsor a disclosed monthly amount. Charity donation revenue is never the subsidy. Verify sponsor funding and service limits before enrolling.

Current published Cloudflare WFP base is **US$25/month**, including 20 million requests, 60 million CPU-ms and 1,000 scripts; overages are $0.30/million requests, $0.02/million CPU-ms and $0.02/script. Dispatch/user/outbound count as one request chain. [WFP pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/). Artifacts billing starts today, 2026-10-14: first 10,000 operations and 1 GB included; then $0.15/1,000 operations and $0.50/GB-month. [Artifacts pricing](https://developers.cloudflare.com/artifacts/platform/pricing/). Budget the Workers Paid base separately until Homie's actual invoice confirms bundle treatment; do not count beta storage as permanently free.

**Cost model assumptions A6:** at 20 venues, 100,000 public requests each/month and 10ms CPU/request gives 2 million requests and 20 million CPU-ms, inside those WFP allowances. Budget $5–15/venue/month for D1/DO, agent compute, queues/workflows, backups, assets, isolated CI and notification delivery; $5–20 for model inference; 30 minutes support at $40/hour adds $20. These are planning allowances, not provider quotes or measured usage. At one pilot Homie bears the whole base; at 20 the WFP allocation is $1.25 each. Estimated 20-venue operating cost is roughly $31–56/venue/month before acquisition, engineering, taxes, incident spikes and additional fixed services. At 3%, this requires roughly $1,042–1,875 eligible monthly sales merely to cover those costs. Low-volume venues need sponsorship or another plan.

Meter D1 rows/storage, DO requests/duration/storage, AI tokens, CI runner minutes, exports, email and operator time per tenant. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Stripe's chosen direct-fee collection configuration has no additional Connect account/payout fees; merchant processing, Tax and other product fees remain. Do not apply the alternative platform-priced $2/account plus payout tariff to this design, or quote one country's card rate universally. [Stripe fee behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior), [Connect pricing](https://stripe.com/connect/pricing).

The first venue passes after four real weekly cycles: paid booking, correct roster, a requested move, a content change, payment reconciliation, a human hand-off, timed restore and self-hosted export/import. Track baseline owner admin time, minutes saved, successful bookings, booking errors, agent success and support minutes. A sandbox refund proves mechanics; do not manufacture a live customer dispute for evidence.

The product proof remains **20 real organizations using it weekly, receiving measurable value, paying willingly, manageable support, and no founder rescue**. Proposed evaluation window: four consecutive weeks per organization; a weekly completed useful workflow, owner-verified time saved (target at least one hour/week), retained paying or explicitly funded sponsored plans, no unresolved money discrepancies, and median support at most 30 minutes/organization/month with tail incidents reported separately. Report paying customers and sponsored organizations separately; sponsorship alone is not evidence of owner willingness to pay. A second operator must run incidents/restores from the console. Do not scale recruitment while founder-only recovery or recurring payment inconsistencies persist.

## Risks and implementation gates

| Risk | Required mitigation / evidence |
| --- | --- |
| Artifacts and current API surfaces are new | Pin versions, keep Git bundles and known-good release artifacts; test export without Artifacts access. |
| WFP runtime assumptions differ from local toolkit | V1 deployment proof with assets, DOs, timers and streaming before building onboarding around it. |
| Connect configuration/country or preview API unavailable | Validate A2 in sandbox and platform settings, pin schema and test live eligibility; stop before sales. |
| A percentage cannot be represented by a variable one-time Payment Link | Enforce the fixed-price publication schema; reject unsupported catalog changes. |
| Payment/link/D1 race during booking moves | Durable operation locks, provider reconciliation and fault injection at every step; paused sale is preferable to overselling. |
| Agent mistakes or injected instructions | Narrow tools, authenticated intent, policy outside model, bounded retries, operator escalation. |
| Shared service credential compromise | No secrets in tenant/build/model contexts; tenant registry checks, least privilege and independent backup authority. |
| Missed MCP Events or silent business failures | Renew and deduplicate subscriptions; independent probes/reconciliation; prove V2 coverage. |
| Restore replays refunds/messages | Operation ledger and external-state reconciliation before reopening; second-operator drill. |
| Unprofitable support / false 24-hour promise | Measure operator time and tail incidents, fund duty coverage, gate growth on repeatable recovery. |

V1/V2 and A2 are verification tasks with decided engineering responses, not architecture questions delegated to the owner. A1–A6 are explicitly unverified inputs/estimates. No pilot use, cost measurement, deployment, or legal approval is asserted by this design.

## Business decisions left for Homie's owner

1. **B1 — Pilot and market:** name the real venue/operator, launch jurisdiction, legal Homie entity, currency, and starting event. Confirm the venue agrees to the bounded pilot and its cancellation policy.
2. **B2 — Offer:** choose sales percentage, fee basis, whether to trial a monthly alternative, and approve proportional application-fee refunds. Recommended pilot hypothesis: 3% of pre-tax fixed service subtotal, no monthly minimum. Charity donations stay zero regardless.
3. **B3 — Sponsorship:** define registered-charity verification, other non-profit eligibility, sponsor budget and number of funded places. Never fund them through a charity donation cut.
4. **B4 — Support promise and funding:** name duty and backup operators, hours and escalation coverage; decide the owner-facing response promise and who absorbs service-error compensation. Do not advertise continuous human coverage without funding it.
5. **B5 — Commercial/privacy terms:** approve counsel/accountant review for the chosen jurisdiction, retention/deletion and exit grace period (proposed 30 days), subprocessors, tax responsibilities and service terms. Engineering implements those approved values; it does not choose the legal obligations.
