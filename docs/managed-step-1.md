# Managed step 1 — round 2

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
   The enqueue producer still iterates the test registry; a production registry
   needs paginated/sharded scheduling, not one unbounded list in a cron invocation.
5. **Trust boundary.** No decorative header stripping. Public `/__managed/*`
   requests are rejected; only dispatcher-supplied `ctx.props.managedTick` invokes
   scheduled work. Tests send spoofed headers and query parameters and verify they
   cannot select a script or grant tick access.
6. **JSONC.** Use pinned `jsonc-parser` 3.2.0 (also used by Wrangler). Inline/block
   comments and trailing commas work; malformed documents fail with parse errors.
7. **Arbitrary code and operating controls.** See the explicit boundaries below.
8. **Honest UI readiness.** The room cover no longer lifts on a seat, missing-helper
   timer, 15-second cap or 30-second timeout. A playable signal is required. A
   stalled connection keeps the cover with a reload diagnostic. Tests prove both
   no false readiness and eventual release on the signal. Old 0.53.0 screenshots
   and timeout-based room results are historical only, not acceptance evidence.

## Code, egress and operational boundaries

Owners may supply arbitrary Worker and Durable Object JavaScript. There is no
rules-only restriction. Preparation accepts extra self-bound DO classes and
adds migration tags for newly introduced classes; existing identities survive
redeployment. Destructive class removal is rejected pending an explicit migration.
The namespace is explicitly configured `trusted_workers:false`; source production
bindings, routes, platform secrets, dispatch and control databases are excluded.
[Cloudflare isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/)
is the runtime boundary, not a JavaScript rules compiler.

The managed adapter removes the source `global_fetch_strictly_public` compatibility flag: live testing showed that retaining it bypassed the WFP outbound hook. Only the trusted outbound Worker enables it for public forwarding. A regression test protects that distinction.

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
