# Managed step 1 test harness

Private operator experiment. **Not ready for arbitrary tenant Durable Objects.**
See [the current report](../../docs/managed-step-1.md) for live failures as well as
passing results. Only `homie-managed-test` and `hm-test-*` resource mutations are
permitted; owner identities inside trusted egress capabilities need no test prefix.

```sh
export WRANGLER=/absolute/path/to/wrangler
export CLOUDFLARE_ACCOUNT_ID=<signed-in-account>
node packages/managed/control.mjs init ~/.homie/orchestration/managed/run
node packages/managed/control.mjs deploy ~/.homie/orchestration/managed/run /path/to/sealed-test-artifact hm-test-one hm-test-dispatch.SUBDOMAIN.workers.dev
node packages/managed/control.mjs deploy ~/.homie/orchestration/managed/run /path/to/another-test-artifact hm-test-two hm-test-dispatch.SUBDOMAIN.workers.dev /two
node packages/managed/control.mjs kill ~/.homie/orchestration/managed/run hm-test-one
node packages/managed/control.mjs cleanup ~/.homie/orchestration/managed/run
node --test packages/managed/test.mjs
```

Run control commands serially. After a crash, inventory provider resources and
reconcile the intent ledger before removing a stale lock. Recovery tools and
fixtures are in `tools/`; keep generated files in persistent storage, not `/tmp`.
`inventory.mjs` is read-only; `recover-crash.mjs` is specifically scoped to the
recorded round-3 crash resources, not a general account cleanup tool.

Preparation accepts a prebuilt artifact without importing owner code. It checks
paths/symlinks, strips production capabilities, uses a compatibility allowlist,
and always enables `global_fetch_strictly_public`. It binds only declared self DO
classes, a tenant D1 and assets. Migration tags come from provider metadata,
not local output. Additive class migrations retain existing namespace identities;
destructive changes need a separately reviewed storage migration. The namespace
is explicitly untrusted. Remote customer builds remain an unimplemented,
fail-closed step-2 boundary in `build.mjs`.

The Registry DO owns exact-host/longest-prefix routes and a transactional version.
Isolates cache snapshots for two seconds, refreshing during traffic without
extending stale authority. Kill disables routing and notifies registered objects.
`prepare()` generates a supervisor for every declared DO class; stop removes and
flushes alarms, closes sockets and invokes storage-preserving abort. See the report
for measured timings and the remaining arbitrary-code/runtime boundaries.

Only studios with scheduled/function work get ticks. Durable claims serialize
attempts, reject stale ticks and fail closed after an interrupted delivery. A
stranded claim requires operator reconciliation. The DLQ consumer persists an
alert and logs a structured error before acknowledging. This is durable alert
capture, not integration with an external paging service. A single registry is
an experiment; production needs sharding and paginated scheduling.

Workers and DOs may reach the internet. The deployed `outbound.mjs` is a Tail
collector, not a fetch firewall. `outbound-spike.mjs`, `egress-entry.mjs` and facet
tools preserve the earlier experiments but are not the managed runtime. Operator
HTTP endpoints require a bearer credential; stop RPC uses tenant-scoped deployment
props. Headers do not grant authority. Native analytics map scripts and DO namespace
IDs to tenants. `tools/monitor.mjs` implements the operator abuse-monitor hook;
its coverage gaps, thresholds and manual deployment status are documented.

Facets remain deferred because alarms and hibernation failed round-3 tests. The
new supervisor passes the live fixture, but this is still a private experiment:
see [the design](../../docs/managed-design.md) for push, scaling and isolation limits.

Latency tools retain rays, colos, first-isolate markers and failures. Use only
same-colo, same-warmth pairs. `HM_TEST_EDGE_IP` optionally pins DNS resolution for
both test hosts while preserving their hostname/SNI. This does not pin backend
DO or D1 placement. `probe.mjs` counts Worker-side binding calls only.
