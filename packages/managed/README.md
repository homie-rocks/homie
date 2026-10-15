# Managed step 1 test harness

Private operator experiment. **Not ready for arbitrary tenant Durable Objects.**
See [the round-3 report](../../docs/managed-step-1.md) for live failures as well as
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

The Registry DO owns exact-host/longest-prefix routes. Deploying a studio changes
only its registry record; shared infrastructure updates are a separate operation.
`kill` writes a disabled record and stops new HTTP/tick dispatch. **It does not
stop existing sockets or autonomous DO alarms.** The measured emergency script
swap also failed to stop an arbitrary owner DO promptly; never present deployment
completion as proof that all tenant work stopped.

Only studios with scheduled/function work get ticks. Durable claims serialize
attempts, reject stale ticks and fail closed after an interrupted delivery. A
stranded claim requires operator reconciliation. The DLQ consumer persists an
alert and logs a structured error before acknowledging. This is durable alert
capture, not integration with an external paging service. A single registry is
an experiment; production needs sharding and paginated scheduling.

WFP outbound parameters arrive through `env.tenant`; Dynamic Worker egress uses
supervisor-owned `ctx.props.tenant`. Headers never grant authority. The Dynamic
Worker entrypoint blocks configured control/internal literals, stamps fetches
and denies TCP. WFP DO calls have no outbound hook, and the current WFP live
fetch probe failed control-host filtering and attribution too. DNS rebinding is
not proven blocked. Control APIs must authenticate independently.

Facets support the demonstrated ordinary socket round, storage, abort and delete,
but the live alarm API explicitly refused alarms and the hibernatable socket
failed during idle. The report describes the unimplemented platform-owned-class
interim; no arbitrary owner subclass may be treated as enforcing its own guard.
Customer onboarding stays disabled pending those acceptance gates.

Latency tools retain rays, colos, first-isolate markers and failures. Use only
same-colo, same-warmth pairs. `HM_TEST_EDGE_IP` optionally pins DNS resolution for
both test hosts while preserving their hostname/SNI. This does not pin backend
DO or D1 placement. `probe.mjs` counts Worker-side binding calls only.
