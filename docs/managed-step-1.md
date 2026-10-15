# Managed step 1 — round 4

**Draft, not an onboarding release.** Public-internet egress is now the accepted
policy, and the generated supervisor passes the live socket/alarm/in-flight kill
fixture while retaining storage. Route lookups no longer require a registry RPC
on every request. Performance and telemetry acceptance are still qualified:
isolate-first requests remain slower, repeated warm runs vary, the per-script
Worker GraphQL query returned no rows, and the Workers Logs query was refused by
the available OAuth credential. Do not present those gaps as passed gates.

The [round-3 report](managed-step-1-round3.md) and its proof folder are preserved.
The current [egress/kill design](managed-design.md) supersedes its proposed egress
firewall and unimplemented interim. Facets remain a documented future path.

## What changed

- `route-cache.mjs` caches transactionally versioned route snapshots per isolate.
  Hard expiry is two seconds from read start, with background refresh halfway
  through the lease. An expired/failed refresh cannot extend route authority.
  An operator mutation invalidates the local cache; other isolates refresh or
  expire. Disabled specific routes cannot fall through into a neighboring tenant.
- `prepare.mjs` generates every declared DO export through `supervisor.mjs`, using
  composition instead of inheriting owner methods. This covers Table, Lobby,
  Gate, Concentrator and OwnerRoom without changing toolkit runtime source.
  Step 2 can call this hook after its isolated build. Plain comparison Workers
  keep their original classes; they are not given a fake managed stop cost.
- Registration precedes owner construction. Fetch, alarm and hibernation
  message/close/error handlers check the tenant stop lease. The 3.5-second lease
  uses a strongly consistent read, expires from read start, refreshes in the
  background and has a two-second read deadline. Active callbacks and ordinary
  sockets poll every second. A durable object-ID list supplies the push path to
  idle hibernation sockets. Native cleanup/abort functions are captured before
  handing state to owner code, and the stop RPC capability is captured privately.
- Stop closes accepted hibernation sockets, deletes and flushes the alarm, then
  calls `ctx.abort(..., {retryAlarm:false})`. That interrupts ordinary sockets,
  timers and in-flight callbacks. No application storage deletion occurs.
- Dispatch no longer binds the WFP outbound filter. Provider script/namespace
  identity, native analytics, Workers Logs/Tail, tenant custom limits and
  authenticated controls replace the filtering/stamping claim. Historical
  outbound/facet experiments remain reproducible but are not the deployed policy.

## Kill, storage and the neighboring tenant

The controlling final-code run is [kill-fresh.json](proof/managed-step-1-round4/kill-fresh.json),
using fresh `hm-test-kill` namespaces so older DO code from the deliberately broken
iterations could not contaminate the result. Setup readiness requests are recorded.
Times below are from the start of the authenticated kill request, including its
network/write time. This is modest-load evidence, not a worldwide p99 SLA.

| Work | Stop observation |
| --- | ---: |
| Owner hibernation socket | 632 ms |
| Separate owner socket after 16 seconds idle | 632 ms |
| Owner ordinary socket | 632 ms |
| Actual toolkit Table socket | 639 ms |
| Actual toolkit Gate socket and its Table uplink | 442 ms |
| Actual toolkit Concentrator socket and its Table uplink | 632 ms |
| In-flight 30-second owner callback | 631 ms; interrupted with 500, did not finish |
| Owner alarm | Cleared before abort; null after resume and 1.5 seconds later |
| Other tenant | HTTP 200 and live socket echo after kill |

The owner's stored counter remained **1**, `pending:true` survived, and
`finished:false` remained false. The alarm counter stayed **5**, and the alarm
stayed null across both post-resume reads. A new instance ID after resume confirms
reset; storage survives it. Full resource deletion was performed separately at
cleanup. Already accepted work on an external server cannot be undone by abort.

The real Lobby returned a seat, and Gate/Concentrator diagnostics returned 200.
Both legacy relay classes also carried live sockets in this run. The separate
[two-client Table round](proof/managed-step-1-round4/room.json) carried live/over
round frames and score state. Idle continuity was observed, but an unchanged
instance ID across the 16-second idle period does **not** prove actual eviction
and rehydration. No such claim is made.

Error-page HTML containing client IPs was omitted; statuses, timestamps and rays
remain, with private originals outside the repository. Earlier attempts are retained: the first kill stopped sockets but left a stored
alarm timestamp until `storage.sync()` and the rescheduling guard were added;
proxying native state broke owner classes extending DurableObject; capturing an
RPC method with `.bind()` was invalid; a Table without heartbeat closed before
kill; some cold socket setup attempts failed closed. The final native workerd
check exercises the real branded state and a real service RPC across events,
rather than a mock that would miss the RPC failure.

## Route propagation and speed

[Route probes](proof/managed-step-1-round4/routes.json) observed a version change
in **524 ms at YVR / 1,106 ms at SEA**, and route kill in **469 / 665 ms** respectively.
Both clients kept per-sample cf-ray, version, status and route-lookup time. The
registry remains a single experimental shard; production scale is not proved.

All comparisons alternate sequential managed/plain requests, retain cf-ray and
colo for every sample, and exclude nonmatching colos or first-isolate markers.
Both names resolve to the same observed IPv4 edge while retaining their real
hostname/SNI. Fresh comparison tenants were first accessed through SEA. All D1s
reported WNAM; that does not establish identical physical DO/D1 placement.
`x-hm-first` means first Worker invocation in that isolate, not measured startup
CPU, nor first DO invocation. First/idle cache misses still need a registry read.

Latest instrumented run, milliseconds; matched warm SEA pairs only.

| Endpoint | Managed median | Plain median | Pairs | Median paired Δ |
| --- | ---: | ---: | ---: | ---: |
| App page | 108.5 | 89.5 | 28 | +19 |
| Asset | 96 | 49 | 28 | +17.5 |
| Records | 81 | 78 | 27 | +4 |
| MCP tools/list | 70 | 57 | 27 | +11 |
| Lobby seat | 154.5 | 95.5 | 28 | +14 |

[Raw samples](proof/managed-step-1-round4/speed-timed.json),
[matched pairs and exclusions](proof/managed-step-1-round4/speed-timed-summary.json),
[handler timing breakdown](proof/managed-step-1-round4/timing-breakdown.json).
The routing median reports 0 ms on the runtime clock. The elapsed-duration
residual between dispatch and tenant handler is 5–12 ms by endpoint. Handler
medians were similar for page (16/15 ms), asset (0/0), records (17/15) and MCP
(0/0); seat was 41/30.5 ms, including its stop guard and DO work. The remaining
client-observed gap is outside those measured handler intervals. Edge rays do
not identify backend placement, and these coarse I/O-driven clocks are not a
provider trace: attributing the rest specifically to network, scheduling or
transfer behavior would be inference. The cache removes the demonstrated
registry bottleneck, but does not establish the requested end-to-end parity.

The [quiet 30-pair run](proof/managed-step-1-round4/speed-quiet-summary.json) was
81/72 ms for page, 50.5/48.5 for asset, 70.5/68 for records, 53/52.5 for MCP and
86.5/93.5 for seat (managed/plain). Its median paired page difference was 0 ms,
but asset was +8.5 ms; the bootstrap intervals and raw pairs are retained.
The [next repeat](proof/managed-step-1-round4/speed-head-summary.json) was slower,
including page 134/88 and seat 104.5/92. Neither a favorable run nor the fact that
all samples say SEA proves universal latency parity. The old blocking-refresh,
pre-lease-refresh and cold-object-placement runs are retained as development
measurements, not mixed into the final table.

[Six fresh-version page attempts](proof/managed-step-1-round4/speed-cold-summary.json)
yielded **five** matched isolate-first SEA pairs: median **526 ms managed / 428 ms
plain**, a 98 ms gap. One attempt was not first-isolate and was excluded. This
small sample does not establish cold-start tails. The stronger requirement that
all warm and isolate-first traffic be within a few milliseconds is **not proved**.

## Attribution, limits and control authentication

[Final Tail and authentication probes](proof/managed-step-1-round4/attribution-complete.json)
show provider `tenant:hm-test-inlet`, `dispatchNamespace:homie-managed-test`,
and a DO trace with `entrypoint:OwnerRoom` and a durable object ID. Both Worker
and DO egress signals are present. The fixture deliberately sent
`x-homie-tenant:victim`: that header remained untrusted and did not alter provider
attribution. Worker/DO public echo fetches both returned 200. The Tail consumer
copies identity, CPU/wall time and bounded metadata, not arbitrary owner logs,
headers, bodies or request URLs.

The actual HTTP methods were tested from both tenant Worker and DO code:
`GET /__operator/routes`, `GET /__operator/alerts`, `PUT /__operator/route` and
`POST /__operator/kill` all returned **404** without an operator credential.
Successful authenticated writes and reads prove the control host was reachable;
this is authentication, not network blocking. `StopControl` authenticates its
read-only tenant capability through deployment-owned props. Tick/notify paths
require trusted dispatch props. No operator token or registry binding enters the
tenant environment.

[Native analytics](proof/managed-step-1-round4/analytics-final.json) returned DO
subrequest/CPU records and outbound-body-byte rows, scoped to the namespace IDs
from the deployed tenant binding inventory. The provider returned `__unknown__`
for DO script-name dimensions, so the persisted namespace → tenant mapping is
necessary. The recorded values include **79 DO subrequests**, while outbound body
bytes are zero in that snapshot. This is not proof of complete byte accounting,
TCP coverage or destination attribution. Initial queries were empty; analytics
are delayed and sampled. Worker queries by the documented script-name and script
tag remained empty. Their implementation exists, but a live Worker subrequest
counter is not proved by these results.

[Workers Logs API query](proof/managed-step-1-round4/logs-query.json) returned
**403 Authentication error** with the available Wrangler OAuth credential.
Logging is enabled in [deployed settings](proof/managed-step-1-round4/binding-policy.json),
and live Tail works for both Worker and DO events. Indexed log retrieval needs an
appropriately scoped operator credential; do not conflate enabled logging with
successful API access.

[Custom-limit proof](proof/managed-step-1-round4/limits.json): a tenant set to one
subrequest failed a three-fetch Worker probe with 500; restoring 32 allowed the
same probe to return 200. The neighbor stayed 200. Route records contain validated
per-tenant CPU/subrequest limits; generated script settings include a 1000 ms CPU
limit. These are request/runtime limits, not a hard tenant-wide billing cap or
an independently verified custom subrequest limit on autonomous DO alarms.

`tools/monitor.mjs` records native usage/coverage and alerts for the thresholds in
[the abuse runbook](managed-design.md#attribution-limits-and-abuse-response).
`--enforce` calls authenticated kill for the owned test tenant. Monitoring was run
manually here; no scheduled monitor, staffed production rotation or external
paging integration is claimed. Empty coverage is reported, not treated as zero
activity. Ryan is the operator for this experiment.

## Remaining implementation boundaries

The five-second target passes the supported live fixture. The current push path
is best effort, has a 1,000-object list and no durable per-object retry/acknowledgment.
An unreachable idle hibernating object depends on later delivery/entry to stop;
polling cannot preempt synchronous JavaScript before provider CPU enforcement.
Generated classes capture trusted operations and do not inherit owner RPCs, but
sharing a JavaScript isolate is not a general sandbox against arbitrary global
or prototype tampering. Those boundaries need a runtime/security review before
advertising a universal arbitrary-code kill guarantee. Facets are deferred until
alarm and hibernation compatibility is demonstrated; the round-3 evidence remains.

## Resources, validation and cleanup

Created and deleted: **1 dispatch namespace, 4 ordinary Workers, 4 dispatched
tenant scripts, 31 DO namespaces, 6 D1 databases and 2 queues**.
[Deletion receipts](proof/managed-step-1-round4/resources.json) include per-resource
absence checks; DO namespaces were removed by script deletion and independently
checked absent. [The final inventory](proof/managed-step-1-round4/final-inventory.json)
at 2026-10-15 22:29:38 UTC is empty for every test resource category.
[Before cleanup](proof/managed-step-1-round4/before-cleanup.json) records what existed.

Local validation: **39 tests passed**, plus the native workerd/service-RPC check.
The latter is now part of the managed CI job. The toolkit runtime and arrival code
were not changed. Proof tools are in `packages/managed/tools/`; generated artifacts,
credentials and private logs stay under `~/.homie/orchestration/managed/round4/`.
Only owned `hm-test-*` resources and `homie-managed-test` were mutated. No production
resources, homie.rocks, example studios, payments or external messages were used.
No broad process killing was performed; probe-owned tails/sockets and local
workerd instances were closed by their own harnesses.
