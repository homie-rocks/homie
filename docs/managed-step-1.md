# Managed step 1 — round 3

**NOT READY for arbitrary tenant Durable Objects.** The crash recovery and round-3
experiment are complete. The registry, deployment preparation and measurement
fixes are implemented; the live isolation and hard-kill acceptance gates fail.
Customer onboarding must remain disabled. This is draft PR #139, not a release.

## Changes and evidence by review item

1. **Strict public fetch restored.** `prepare.mjs` always includes
   `global_fetch_strictly_public`, with an explicit compatibility date/flag
   allowlist. The old claim that removing it was an acceptable outbound-hook fix
   is withdrawn. [Deployed binding policy](proof/managed-step-1-round3/binding-policy.json)
   records the flag and the outbound dispatch binding. The current WFP deployment
   still failed the control-host/stamping probe; this is an observation of this
   configuration, **not** a demonstrated causal explanation about the flag.
2. **Supervisor/facet spike and hard-kill measurements.** See the facet and kill
   tables below. Actual toolkit classes and a custom tenant class ran, including
   a two-client round. Alarms fail explicitly; hibernation continuity failed in
   the idle test. A storage-preserving script swap failed to stop the custom DO
   within a 74.76-second observation. The interim design below is a proposal, not
   an implemented safe arbitrary-code fallback.
3. **Persistent route registry.** An uncached Registry DO replaces dispatch vars.
   Each studio writes its own record; shared dispatch/outbound deployment is no
   longer part of each studio deploy. Exact host and longest path-boundary prefix
   win; duplicate ownership is rejected transactionally. `kill` is one durable
   record write. The live write took **343 ms**, followed by 404 for the stopped
   studio and 200 for `/other/probe/echo`.
   [Registry proof](proof/managed-step-1-round3/registry.json),
   [kill proof](proof/managed-step-1-round3/kill.json).
   A DO was chosen over KV because this switch needs strong consistency rather
   than [KV's potentially stale reads](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
   One registry object is a bounded experiment; production needs sharding and
   paginated scheduling, with the same per-tenant authority.
4. **Deployment authority and exports.** Read bindings from deployed settings and
   the migration tag from script metadata (settings alone omits it). Ordinary
   Workers use service metadata, matching Wrangler's implementation. A live
   redeploy after deleting local `user.json` advanced **v1 → v1-next**, added
   `ExtraRoom`, and retained all five original namespace IDs. The second studio
   declared no DOs and acquired none. No implicit toolkit quartet is added.
   Wrangler validates the configured class exports. Source dates/flags outside
   the allowlist fail preparation. [Redeploy evidence](proof/managed-step-1-round3/redeploy.json)
   includes the injected `stale-r3` subscription before deployment and its absence
   afterward; `keep` retained cursor 17 and start time 123.
5. **Ticks and DLQ.** Only studios with declared scheduled/function work are
   enrolled. Durable claims serialize a tenant's attempts across schedule
   boundaries. An old retry cannot overlap the next tick; late completed/stale
   ticks are skipped. [Live claim sequence](proof/managed-step-1-round3/tick-claims.json):
   `run, busy, run, busy, run, skip`. This exercises the real registry remotely;
   it is not a load test of long-running customer functions. Claims never expire
   automatically: a crashed delivery fails closed and requires operator
   reconciliation, rather than guessing that its work has stopped. A deliberate
   missing-script tick reached the DLQ, whose consumer persisted an alert and
   acknowledges after persistence. [The alert](proof/managed-step-1-round3/registry.json)
   appeared 25.08 seconds after its scheduled timestamp. Structured error logging
   is wired; no external paging service is claimed.
6. **Tenant identity.** The WFP handler accepts any nonempty bounded tenant name
   from its trusted dispatch parameter (`env.tenant`, the documented WFP API).
   Dynamic Workers use `Egress` with supervisor-supplied `ctx.props.tenant`.
   The live facet replaced `victim` with **ordinary-studio**, blocked the disposable
   control host and loopback fetch, and intercepted TCP. The reusable Dynamic
   Worker egress entrypoint denies all raw TCP. This does not repair the failed
   WFP observation in item 1 or establish a DNS-rebinding firewall.
7. **Proof honesty.** All successful latency samples retain cf-ray and colo;
   network failures retain an error and null ray/colo. Only matching-colo,
   matching warm/cold pairs are compared. The flaky local wall-clock assertion
   was removed. Spoof probes send tenant/tick, forwarded-host, original-URL,
   CF-Worker and authorization headers; public tick/operator paths remain 404,
   `ctx.props` remains empty and `request.cf` is absent. Their unsuccessful egress
   results remain in [security.json](proof/managed-step-1-round3/security.json).
   Round-2 speed numbers without colos are historical and cannot support a speed
   comparison. This round's raw failed attempts are retained too.
8. **Scope restored.** Arrival runtime, arrival tests and generated toolkit build
   identity match the base branch. No cold-start/runtime optimization was made.
   The fixture bundles the existing runtime using code splitting and minification;
   only the test adapter/probes change. The live fixture embedded a build-ID label
   copied from newer `main` during recovery; CI caught that metadata mismatch. The
   label is restored to this branch's base and the identity check passes. The
   recorded live label is not asserted to be a digest of the executed fixture.

## Facet verdict

The [Cloudflare facet API](https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/)
provides isolated storage, abort and delete. The
[globalOutbound API](https://developers.cloudflare.com/dynamic-workers/usage/egress-control/)
provides both fetch and connect interception. Those capabilities alone do not
establish room compatibility.

| Live probe | Measured result |
| --- | --- |
| Fetch to test control host / loopback | Both 403, 736 / 83 ms |
| Fetch to separate test echo | 200; spoof replaced by `ordinary-studio`, 460 ms |
| Raw TCP to loopback | Intercepted; diagnostic returned tenant and requested address, no upstream socket opened |
| Ordinary WebSocket | Echo before and after 16-second idle; abort closed it in **357 ms** |
| Hibernatable WebSocket | Initial echo, then unexpected 1006 close **8,549 ms** after opening, before abort; continuity not proved |
| Facet alarm | 500, `Facets currently cannot set alarms.`, **302 ms** |
| In-flight delayed fetch | Aborted response **236 ms** after abort started |
| Abort storage | Counter **2** and pending marker retained after resume |
| Delete storage | Counter **0**, pending false afterward |

[Final probe](proof/managed-step-1-round3/facets-final.json) is the controlling
result. Earlier internal errors and the alarm-poisoned attempt are retained in
[facets.json](proof/managed-step-1-round3/facets.json) and
[facets-alarm-poison.json](proof/managed-step-1-round3/facets-alarm-poison.json).
The synthetic delayed fetch is held inside the platform egress entrypoint; the
abort result proves the tenant's response was interrupted, not cancellation of
work already accepted by a third-party server.

The real toolkit Table carried live/over round frames, snapshots and score state
between two socket clients [inside a facet](proof/managed-step-1-round3/facet-room.json)
and [as a regular WFP DO](proof/managed-step-1-round3/room.json). Lobby returned a
seat; Gate and Concentrator returned their actual diagnostics. These are a
browser-hosted protocol round and diagnostic checks, not a server-hosted rules
simulation or a full Gate multiplex load test. The facet wrappers delegate to the
unchanged toolkit classes. Passing D1 directly in loader `env` failed with
`DataCloneError: This ServiceStub cannot be serialized.`
[Initial D1 attempt](proof/managed-step-1-round3/toolkit-facets-d1-error.json),
[without D1](proof/managed-step-1-round3/toolkit-facets.json).
The later Table WebSocket test resolves the earlier non-upgrade HTTP error; it
does not resolve alarms, hibernation or D1 capability transport.

## Kill verdict and interim design

A registry write stops **new dispatch and queued ticks**, not autonomous objects.
Both owner and Table sockets remained open immediately after the route kill.
The emergency replacement retained DO bindings/migration tag and installed inert
classes that clear alarms and close accepted sockets when loaded.

| Script-swap observation | Result |
| --- | --- |
| Wrangler replacement command | **3,812 ms** |
| Table socket close from swap start | **4,343 ms** |
| Owner hibernatable socket | Still open through the observation; probe cleanup terminated it |
| Owner alarms after swap | Still increasing at **74,759 ms** (442 → 447 in the last two samples) |
| Owner stored counter | Retained at **2**, but this does not establish a successful stop |

[Full timeline](proof/managed-step-1-round3/kill.json),
[first shorter observation](proof/managed-step-1-round3/kill-first-window.json).
The new top-level Worker returned 410 while the existing owner DO still executed
old code. Deployment completion is therefore not a hard-kill acknowledgment.
Cloudflare also documents that [new Workers can call older DO versions during updates](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).
No storage-preserving, seconds-bounded arbitrary-DO kill is established here.

The interim must be **platform-owned executable DO classes**, not an owner subclass
that can override the guard. Every fetch, RPC, alarm, socket message/close/error,
and timer callback must check a strongly consistent tenant stop generation before
entering tenant work. Fail closed when the registry is unavailable. Keep an active
object registry and a bounded stop poll for idle sockets; a stop closes them,
cancels timers/alarms, and aborts cancellable requests without deleting storage.
Recheck after awaited work before scheduling anything else. Guarded classes must
be shipped before accepting tenants; a script swap alone cannot retrofit that
contract promptly onto already-running arbitrary code.

Owner logic would need to execute behind a separate constrained Worker capability,
with owned socket/alarm/storage operations mediated by the platform. Arbitrary
owner DO classes cannot be admitted under this interim. The full facet design
needs supported alarms, demonstrated hibernation restart, mediated D1 bindings,
and a persistent stop check in every facet startup callback. This proposal remains
unimplemented and requires a separate security/runtime review. Public signup is
blocked, rather than silently weakening the arbitrary-code promise.

## Same-colo speed comparison

Milliseconds, medians of paired sequential requests from the Vancouver client;
all retained pairs reached **SEA**. Both HTTPS hostnames were resolved to the same
Cloudflare IPv4 address, retaining their actual hostname/SNI. The unrestricted
60-sample run reached different colos and yielded **zero comparable pairs**; it is
retained but not used below. cf-ray is the edge colo, not proof of identical
backend DO/D1 placement. This is a small fixture run, not a capacity benchmark.

| Endpoint | Warm managed | Warm plain | Pairs |
| --- | ---: | ---: | ---: |
| App page | 104 | 92 | 5 |
| Asset | 172.5 | 75.5 | 6 |
| Records | 134.5 | 55 | 6 |
| MCP tools/list | 129 | 113 | 6 |
| Lobby seat | 324.5 | 217.5 | 6 |

The one same-colo isolate-first page pair was **729 ms managed / 383 ms plain**.
There were no matched cold pairs for the other endpoints. `x-hm-first` means the
first invocation seen by that isolate's probe, not measured process startup time.
No general speed advantage is claimed. [Samples](proof/managed-step-1-round3/speed-sea.json),
[pairs and exclusions](proof/managed-step-1-round3/speed-sea-summary.json),
[unmatched run](proof/managed-step-1-round3/speed-final.json).

## Recovery, reproducibility and cleanup

Recovery first listed the signed-in Wrangler account's test resources. The crash
left `homie-managed-test` empty, `hm-test-facets-r3`, its Supervisor namespace and
two queues, with no matching D1 databases. Deployed spike source was recovered
privately, then those resources were deleted and absence verified before rebuilding.
[Crash inventory](proof/managed-step-1-round3/crash-inventory.json),
[cleanup receipts](proof/managed-step-1-round3/crash-cleanup.json),
[empty inventory](proof/managed-step-1-round3/after-crash-cleanup.json).

Tools live in `packages/managed/tools/`; generated artifacts, credentials and logs
live under `~/.homie/orchestration/managed/`. The fixture is authored in this repo;
no example studio or customer build script was used. Room tokens are redacted.
Only test namespace/resource names were mutated. No production resources,
homie.rocks requests, payments or external messages were part of this round.

[Before cleanup](proof/managed-step-1-round3/before-cleanup.json),
[per-resource receipts](proof/managed-step-1-round3/resources.json), and
[final independent inventory](proof/managed-step-1-round3/final-inventory.json)
account for the run. Namespace deletion also removes registry records and their
alerts. Worker deletion may cascade DO namespace deletion; receipts distinguish
that from explicit deletion. No claim about immediate physical CDN blob erasure
is made.

Local validation: **32 tests pass** across managed, arrival and request-budget
checks. CI status is reported against the final PR head, not an earlier commit.
