# Managed step 1 — round 3 (in progress)

Round 2 results below are historical. Its egress flag interpretation was incorrect,
and its latency comparisons were not colo matched; neither is acceptance evidence.
Round 3 evidence is in `proof/managed-step-1-round3/`.

Rebased onto toolkit **0.54.0**. This is a draft hosting experiment, not a
production-ready managed release. Design context is PR #134: operator
1243116 B.C. Ltd.; Homie's Stripe account is the Connect platform; managed
payments use server-created Checkout Sessions. No payment integration changed.

## Changes and regression proofs

1. **Request path and measurements.** Compare the same copied Little Inlet studio
   as a WFP user Worker and an ordinary Worker, with separate D1/DO resources.
   Sequential requests alternate which deployment goes first. Only test origins
   are queried. Binding counters preserve object identity so they cannot invalidate
   the toolkit catalogue cache. Counts are Worker-side calls, not DO-internal SQL
   or a billing meter. Measurements and sample sizes follow below.
2. **D1 readiness and deploy correctness.** A bounded `SELECT 1` retry handles
   provisioning error 7403 before migrations. Arbitrary SQL/auth failures fail
   immediately. Both fresh databases migrated without a manual rerun. Preparation
   includes missing current toolkit migrations alongside the studio's migrations:
   an older built studio's migration folder alone was insufficient for 0.54.0.
   Every deploy runs the toolkit's `functionDeploymentSQL` before exposing new code.
   Live reconciliation preserved existing subscriptions/cursors and removed an
   injected stale subscription. Tests cover transient/error/timeout paths.
3. **Truthful cleanup.** Read before delete, verify absence afterward, and report
   `deleted` or `already absent`. DO existence is captured before script deletion
   can cascade. A 404 is never called a successful explicit deletion. State is
   exclusively locked to prevent competing control commands losing resource IDs.
4. **Scheduling and limits.** Cron produces one Queue message per active studio,
   in batches of at most 100. Consumer batch size one, independent acknowledgments,
   three retries with 30-second delay and a separate DLQ. Delivery rechecks the
   route registry. A tenant failure cannot reject another tenant's delivery.
   This follows [Queues retry semantics](https://developers.cloudflare.com/queues/configuration/batching-retries/).
   Queues are preferable here to a DO scheduler per tenant because retry and DLQ
   handling are built in and each delivery already has a durable schedule key.
   Measured user-Worker calls peaked at five for the HTTP probes and 32 for a queued tick (30 D1, one asset, one DO). Dispatch subrequest budgets are 32 for HTTP and 128 for ticks: over six times and four times those observations. CPU budgets remain provisional at 100/1000 ms because provider CPU analytics were unavailable. These are not arbitrary-code or DO workload capacity guarantees.
   The enqueue producer still iterates the test registry; a production registry
   needs paginated/sharded scheduling, not one unbounded list in a cron invocation.
5. **Trust boundary.** No decorative header stripping. Public `/__managed/*`
   requests are rejected; only dispatcher-supplied `ctx.props.managedTick` invokes
   scheduled work. Tests send spoofed headers and query parameters and verify they
   cannot select a script or grant tick access.
6. **JSONC.** Use pinned `jsonc-parser` 3.2.0 (also used by Wrangler). Inline/block
   comments and trailing commas work; malformed documents fail with parse errors.
7. **Arbitrary code and operating controls.** See the explicit boundaries below.
8. **Toolkit scope.** Arrival runtime, its tests and generated build identity are restored to the base branch. Runtime improvements belong in separate toolkit PRs.

## Code, egress and operational boundaries

Owners may supply arbitrary Worker and Durable Object JavaScript. There is no
rules-only restriction. Preparation accepts extra self-bound DO classes and
adds migration tags for newly introduced classes; existing identities survive
redeployment. Destructive class removal is rejected pending an explicit migration.
The namespace is explicitly configured `trusted_workers:false`; source production
bindings, routes, platform secrets, dispatch and control databases are excluded.
[Cloudflare isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/)
is the runtime boundary, not a JavaScript rules compiler.

The managed adapter always enables `global_fetch_strictly_public`. The round-2 bypass claim was false: disabling this flag can let tenant DO fetches to the platform zone bypass Cloudflare security. WFP DO egress remains a separate limitation.

The outbound Worker permits public HTTP(S). It stamps `x-homie-tenant` from the
trusted dispatch parameter, replacing any owner-supplied value, logs tenant/host,
and blocks configured control-plane hosts plus internal IP literals/names.
Redirects are returned without automatically following an unchecked destination.
The stamp is attribution, never authentication. There is no blanket external
service allowlist. An initial failing block probe unexpectedly made one public GET to homie.rocks; no write occurred. The final block probe uses only the disposable dispatcher host.

**DO fetches bypass the outbound Worker.** This is a documented
[Cloudflare limitation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/),
not a promise to stamp every DO request. The filter also does not establish a
DNS-resolution/rebinding firewall. Control services must authenticate every call;
no tenant gets operator credentials or internal network bindings. Dispatch limits
bound user invocations, not autonomous DO alarms or already-open room sockets.

Workers Logs are enabled for user Workers, DO classes, dispatch and outbound. The outbound Worker also implements a Tail consumer, recording platform-provided script identity alongside tenant trace outcomes.
`analytics.mjs` scopes Worker request/error/subrequest/CPU queries to script name
and DO CPU queries to recorded tenant namespace IDs. See
[WFP observability](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/observability/)
and [DO analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/).
Empty/delayed provider results are not recorded as zero CPU. No cost or margin
acceptance is inferred from this small run.

`control.mjs kill STATE SCRIPT` removes that tenant's route and redeploys dispatch.
New requests fail closed and pending ticks are acknowledged without invoking it.
Other routes remain. Existing sockets and autonomous alarms require a separate
emergency script removal; the route switch is not represented as instantaneous
termination of all tenant compute.

`build.mjs` stubs a fail-closed **remote Cloudflare Sandbox** build boundary for
step 2: immutable source/toolkit snapshots, per-tenant ephemeral containers,
no operator credentials or host mounts, resource/time/output limits, sealed
artifact digest and cleanup. No local owner-code fallback exists in this API.
The actual remote runner is not implemented in step 1. This round's existing test
fixture was rebuilt in a local macOS process sandbox with network denied and
writes restricted to test directories. That is fixture evidence only; it does
**not** meet the requirement to run customer builds off the operator machine.
Customer onboarding must remain disabled until the remote runner is implemented.

Before public tenants share a parent domain, put that dedicated tenant parent in
the Public Suffix List PRIVATE section, keep control/login on a separate origin,
use host-only `__Host-` cookies, and test sibling Domain-cookie rejection in
supported browsers after PSL propagation. No domain/PSL submission occurred here.

## Measurement method and status

Node 22.23.3 and Wrangler 4.149.0; Vancouver client on a shared machine/network.
Both databases report **WNAM**, with direct query metadata **SEA**, primary reads
and replication disabled. The earlier degraded-region diagnosis is not inferred
from today's measurements. There is no region-matched control outside WNAM.

Cold samples require the probe's first-isolate-invocation marker after a code
redeploy; a request still served by an earlier warm version is excluded. This is
an observed isolate-first invocation, not a promise about physical host coldness.
Warm requests reuse the deployment; any unexpected first-isolate samples are
reported separately. These small samples do not establish tail latency or capacity.
The lobby endpoint measures seat discovery; browser-to-playable timings are a
separate proof and are not mislabeled as HTTP timings.

The first measurement attempt lacked toolkit migrations 0027–0033; scheduled work
failed on `app_tool_namespaces`. Those results are discarded. Another early probe
invalidated binding identity; those results are also discarded. Final measurements
must use the completed schema and identity-preserving probe.

## Validation and lifecycle

Fast managed, arrival and request-budget checks pass. The workerd MCP budget check
hit its 30-second timeout alongside other work, then passed alone in 3.2 seconds.
The existing artifact's function declarations were reconciled on both databases.

Only `homie-managed-test` and `hm-test-*` resources were created. Original example
studios, production Workers and homie.rocks were not changed. The per-resource
inventory, final measurement table, browser facts and verified deletion receipts
are recorded with the completion of this experiment below.

## Final deployed results

Milliseconds, **median [min–max], n**. Cold includes observed `first:true` invocations after redeploys and in the alternating sequence; warm uses rounds 1–5 with `first:false`. Excluded samples remain in the raw JSON.

| Probe | Managed cold | Plain cold | Managed warm | Plain warm |
| --- | --- | --- | --- | --- |
| page | 1479 [934–2024], n=2 | 1647 [1428–1866], n=2 | 88 [63–121], n=5 | 394 [278–479], n=5 |
| asset | 486 [467–529], n=3 | 464.5 [435–494], n=2 | 174 [46–222], n=5 | 223 [109–527], n=5 |
| records | 1054 [686–1422], n=2 | 2117.5 [1412–2823], n=2 | 110 [62–129], n=5 | 345 [317–633], n=5 |
| mcp | 617 [609–1313], n=3 | 1503 [1470–1536], n=2 | 111 [74–242], n=5 | 326 [245–1220], n=5 |
| seat | 1414 [1035–1793], n=2 | 2202.5 [1756–2649], n=2 | 201 [119–292], n=5 | 372 [285–849], n=5 |

The round-2 run cannot establish a WFP latency penalty or advantage: these samples lack cf-ray/colo and are not comparable pairs. D1 placement, edge/isolate placement and network variability
remain confounders. Both databases were WNAM/SEA. Steady managed counts were
one D1 round trip for page, records, MCP and lobby, zero for the asset. A cold
request included catalogue/metadata work (up to three D1 + one asset + one DO
for lobby). The fast local tests cover the 0–1 D1 budget separately.
[All alternating samples](proof/managed-step-1-round2/speed.json) and
[cold redeploy samples](proof/managed-step-1-round2/cold.json) retain unexpected
cold starts and warm-after-redeploy samples instead of concealing them.

- **Rendered data:** [browser facts](proof/managed-step-1-round2/app.json) show both October 17 volunteer
  shifts and the loaded giving panel; the [screenshot](proof/managed-step-1-round2/app.png)
  captures the giving panel above the fold. The probe waits for actual records/text,
  not a canvas or loading placeholder. No payment was attempted.
- **Room readiness:** [browser facts](proof/managed-step-1-round2/room-ready.json)
  show replica seat 0 and `arrival.by=auto` (the helper's playable signal) on both
  deployments: managed 4,657 ms, plain 5,598 ms. These are single browser samples,
  not distributions or explicit game-authored `net.playable()` evidence; neither
  cover lifted by timeout.
- **Isolation/egress:** [live probes](proof/managed-step-1-round2/security.json)
  show absent `request.cf`, only test tenant bindings, overwritten spoofed identity,
  internal/control destination 403s and public-tick 404. An arbitrary self-bound
  `ArbitraryRoom` DO wrote storage and fetched the test echo with no tenant stamp,
  demonstrating the documented DO exception rather than hiding it.
- **Scheduling:** [Queue traces](proof/managed-step-1-round2/queue-traces.json)
  show the schema failure and later independent successful tick (32 calls).
  [DLQ contents](proof/managed-step-1-round2/dlq.json) include failed deliveries;
  [function receipts](proof/managed-step-1-round2/functions.json) show completion
  after schema repair. A deliberate missing-script tick also exercised failure
  routing without creating a missing script. Queue messages are at-least-once.
- **Redeploy:** [before/after subscriptions](proof/managed-step-1-round2/redeploy.json)
  preserve existing cursors/start times and eliminate the injected stale entry.
- **Observability:** [egress logs](proof/managed-step-1-round2/tenant-traces.json)
  attribute requests to platform-supplied tenant IDs.
  [GraphQL results](proof/managed-step-1-round2/metrics-final.json) contain scoped
  DO CPU counters for Lobby and Table. Worker metrics returned an empty result;
  an earlier attempt hit the shared account query budget. No Worker CPU percentile
  or zero-usage claim is made. Tail-consumer wiring is deployed; the captured
  egress logs alone are not proof that every tenant trace was delivered.
- **Kill switch:** [live result](proof/managed-step-1-round2/kill.json) shows the
  disabled studio returning 404 while the second test route remains 200. Unit
  tests also prove pending ticks cannot invoke a removed route.

## Final resource accounting

[Live binding/resource inventory](proof/managed-step-1-round2/existed.json) and
[cleanup receipts](proof/managed-step-1-round2/resources.json) record IDs and
verified absence. Created and removed: namespace `homie-managed-test`; ordinary
Workers `hm-test-dispatch`, `hm-test-outbound`, `hm-test-plain`; user Workers
`hm-test-inlet`, `hm-test-egress-probe`; D1 `hm-test-inlet-db`, `hm-test-plain-db`;
Queues `hm-test-ticks`, `hm-test-ticks-dlq` and their consumer; nine DO namespaces
(four standard classes per studio plus `hm-test-inlet_ArbitraryRoom`). Associated
asset-serving deployments disappear with their scripts; no claim of immediate
physical CDN blob erasure is made. API tails closed and their sessions were deleted.

Cleanup initially failed because the dispatcher still consumed the Queue. The
harness now detaches and verifies the consumer before deleting Workers. Script
removal cascaded to the DO namespaces; subsequent DO checks truthfully reported
`already absent`. Plain-Worker DO checks on the resumed cleanup occurred after
that Worker had already been deleted; their earlier binding inventory proves the
allocation. No broad account cleanup or unrelated process termination was used.

Validation: 12 managed tests, eight arrival tests, nine request-budget tests, and
one real-workerd MCP budget test pass. The generated runtime identity was refreshed
without changing version 0.54.0. The remote customer-build runner and PSL work are
explicit step-2/public-launch work, not completed capabilities of this harness.
