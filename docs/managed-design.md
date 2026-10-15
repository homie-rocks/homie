# Homie Managed — step 1 design

Status: private test implementation in draft PR #139. Step 2's isolated build and
deploy pipeline is not implemented. See [measured results](managed-step-1.md),
including failed acceptance gates. This file did not exist on the round-3 branch;
round 4 establishes the egress and kill design here.

## Egress: hosted arbitrary code, authenticated control plane

Tenant Workers **and Durable Objects may reach the public internet**. Homie does
not promise to intercept, stamp, allowlist or block their outbound connections.
The dispatch binding no longer configures the experimental WFP outbound hook.
`global_fetch_strictly_public` stays enabled, but network position is never an
operator credential. The old `outbound.mjs` fetch handler and Dynamic Worker
`egress-entry.mjs` are retained only for reproducing the historical spikes; only
the former's **Tail consumer** is used by this design.

This policy follows the hosted-code model: [Vercel's function quickstart](https://vercel.com/docs/functions/quickstart)
fetches an external API; [Netlify's Edge API](https://docs.netlify.com/build/edge-functions/api/)
explicitly directs external-site requests through `fetch`; [Oxygen's runtime](https://shopify.dev/docs/storefronts/hydrogen/deploy/oxygen/runtime)
supports network Fetch on workerd. These sources establish internet access, not
identical private-network rules, universal destination attribution, or identical
kill guarantees across providers. Homie chooses accountability and authenticated
control APIs rather than a DO egress firewall.

All `/__operator/*` methods authenticate a deployment-owned bearer token before
routing, parsing bodies or touching registry state, including unknown operator
paths. Comparison uses `timingSafeEqual`. Public `__managed` tick and notify paths
require trusted dispatch props. The read-only `StopControl` RPC entrypoint checks
its deployment-owned `ctx.props.tenant`; the caller cannot select another tenant
in a header or method argument. Its service binding is a scoped capability, not
network trust. The registry namespace and operator token never enter tenant env.
Every new control endpoint must join one of these authenticated boundaries.

## Attribution, limits and abuse response

One immutable deployment identity maps tenant → WFP script → DO namespace IDs.
`analytics.mjs` queries provider-owned Worker requests/errors/subrequests, DO
subrequests/CPU, and DO outbound request-body bytes. Bytes are **not** all egress
bytes (no promise of TCP bytes, response bytes, destination inventory or billing
accuracy). Adaptive analytics are sampled and delayed, not a synchronous budget.
Provider script/namespace metadata is authority; tenant HTTP headers and console
payloads are untrusted. Worker and DO invocation logs are enabled. The Tail
consumer retains the provider script name, outcome and counts, and does not copy
request headers, bodies, URLs or arbitrary owner console payloads.

An authenticated route record sets custom WFP HTTP CPU/subrequest limits (default
100 ms / 32, allowed range 1–1000 ms / 1–128). Tick dispatch uses 1000 ms / 128.
The generated tenant configuration sets a provider CPU limit of 1000 ms. WFP
HTTP custom limits must not be represented as a tenant-wide quota or as an
independent hard subrequest budget for autonomous DO alarms. The provider still
enforces its DO runtime limits. Future billing/cost ceilings need separate
metering and enforcement.

`tools/monitor.mjs STATE hm-test-TENANT REPORT [--enforce]` is an operator cron
hook. It queries a 15-minute window and records alerts for >10,000 Worker+DO
subrequests, >10 MiB DO outbound request bodies, or ≥100 Worker errors with an
error ratio >20%. With `--enforce`, it invokes the authenticated tenant kill. The
current experiment runs it manually; no always-on scheduler or paging integration
is claimed. Empty datasets must be treated as unavailable/lagging evidence, not
proof of zero traffic. Before onboarding, an operator must schedule monitoring,
connect alerts and own acknowledgment. During this test Ryan is the operator;
no unstaffed future on-call coverage is implied.

Operator response: inspect provider identity and recent logs, verify the alert
against the tenant's plan and baseline, and kill for confirmed spam/scanning,
credential abuse, runaway spend or provider abuse notices. High-confidence active
abuse warrants immediate kill; preserve data and an incident record. Resume only
after investigation. Full deletion is a separate explicit lifecycle operation.

## Routes and stop propagation

The registry owns routes and a monotonically increasing version, updated in the
same transaction. Dispatcher isolates read a snapshot, retain it for at most
2 seconds from **read start**, and refresh in the background during traffic after
half that lease. Expired reads block on a fresh snapshot or fail closed with 503;
a failed refresh never extends stale authority. No KV eventual-consistency claim
is used. An operator mutation invalidates the local isolate immediately; other
isolates expire independently. A stopped more-specific prefix cannot fall through
into another tenant's root route. First/idle requests still pay the registry RPC;
cache-hit requests do not. This is not a claim that global isolate startup is free.

Step 2 calls `prepare()` only after a sealed artifact is built. Homie generates
the entry module and exported DO classes from the actual self-DO bindings; it
never accepts a tenant-authored replacement supervisor. The generated classes
compose the owner's implementation rather than inheriting overridable handlers.
They cover fetch, alarm, hibernation message/close/error and register object IDs
before constructing owner code. A tenant-scoped stop capability supplies short
leases. Active callbacks and ordinary sockets poll; idle hibernatable objects are
reached through the registry's durable object-ID list and trusted dispatch notify.
Kill first persists route disable, then notifies registered objects.

Stop closes hibernatable sockets, removes the alarm, flushes storage and invokes
[DurableObjectState.abort](https://developers.cloudflare.com/durable-objects/api/state/#abort)
with `retryAlarm:false`. This resets ordinary sockets, timers and in-flight owner
callbacks while retaining application storage. The wrapper also refuses new
callbacks while stopped. It cannot undo an HTTP request already accepted by an
external server. Restoring a route is an explicit resume; deletion is not involved.

The roughly five-second target is an operational target to prove on the supported
fixture, **not a universal SLA**. Important implementation limits: the current
registry has one shard and a 1,000-object notify list, notify is best effort, and
there is not yet durable retry/acknowledgment for failed push delivery. Idle
hibernation objects depend on that path. Custom RPC methods are not exported by
the wrapper. Owner code shares the JavaScript isolate: generated composition is
not a sandbox against malicious global/prototype tampering or a proof that every
possible arbitrary-code bypass is eliminated. Platform CPU limits bound blocking
work, but event-loop polling alone cannot preempt synchronous JavaScript. These
limits must be resolved/reviewed before a general arbitrary-code kill guarantee.

## Facets remain a future path

Keep the [round-3 evidence](managed-step-1-round3.md): facet abort closed a socket
in 357 ms and interrupted a response in 236 ms, retaining storage. Facet alarms
failed explicitly, and an idle hibernatable socket disconnected after 8.5 seconds.
Those experiments are not shipped in the generated runtime. Revisit facets once
Cloudflare supports alarms and hibernation reliably; repeat actual toolkit rounds,
D1 capability transport and stop propagation tests before changing the design.
