# Managed step 1 test harness

Private operator package, separate from self-hosted deploy. It accepts only
`homie-managed-test` and `hm-test-*` resources. No production routes or secrets.

```sh
npm ci --prefix packages/managed --ignore-scripts
export WRANGLER=/absolute/path/to/wrangler
export CLOUDFLARE_ACCOUNT_ID=<Homie-account>
node packages/managed/control.mjs init ~/.homie/orchestration/managed/run
node packages/managed/control.mjs deploy ~/.homie/orchestration/managed/run ~/.homie/orchestration/managed/fixture hm-test-inlet hm-test-dispatch.YOUR-SUBDOMAIN.workers.dev
node packages/managed/control.mjs deploy-plain ~/.homie/orchestration/managed/run ~/.homie/orchestration/managed/fixture hm-test-plain hm-test-plain.YOUR-SUBDOMAIN.workers.dev
node packages/managed/control.mjs kill ~/.homie/orchestration/managed/run hm-test-inlet
node packages/managed/control.mjs cleanup ~/.homie/orchestration/managed/run
```

Run commands serially; an exclusive state lock rejects concurrent control commands.
After an interrupted process reconcile the intent ledger/provider inventory before
removing its stale lock. Never blindly adopt pre-existing test resources.

Input is a prebuilt artifact, never an owner build command. `build.mjs` is the
fail-closed step-2 boundary for a **remote Cloudflare Sandbox** runner. Step 2 must
create a disposable container per immutable tenant snapshot, without operator
credentials or host mounts; bound CPU, memory, wall time, network and output;
seal the output digest and destroy the sandbox. The runner is not implemented
here and there is no local fallback. Do not run owner npm scripts locally.

Preparation uses jsonc-parser, copies assets and compiled modules without importing
them, strips production capabilities and assigns only the tenant D1/ASSETS/self DO
bindings. Arbitrary Worker and DO JavaScript is supported. Custom self DO classes
are included; additive migrations retain old namespace identities on redeploy.
Destructive class changes require a separate explicit storage migration. The
managed namespace is explicitly set to untrusted before uploads.

D1 gets bounded readiness probes (`SELECT 1`), then migrations and the same
`functionDeploymentSQL` reconciliation used by toolkit deploy. The latter runs
on every deploy, preserving unchanged subscription cursors and removing stale
subscriptions. Readiness retries only provisioning failures, not arbitrary SQL.

Dispatch uses the exact operator hostname registry. Headers confer no privileges.
The reserved tick path accepts only dispatch `ctx.props.managedTick`. Cron queues
one message per active script with declared scheduled work; bounded enqueue batches and one-message consumers
avoid all-tenant dispatch fan-out. Each tick retries independently (three retries,
5-second delay) then reaches `hm-test-ticks-dlq`. Delivery rechecks the registry.
Duplicate ticks are possible; toolkit schedule/delivery idempotency still matters.

`kill` writes the tenant stop state in the strongly consistent Registry DO; it does not redeploy dispatch. It stops new requests
and queued ticks. It does **not** terminate already-open sockets or autonomous DO
alarms. For an active abuse incident, remove the user script (`force=true`) and
verify termination; that is destructive and separate from reversible route removal.

Outbound stamps `x-homie-tenant` from dispatch parameters, overwriting caller
values. The operator supplies `controlHosts` to preparation (the test dispatcher
host is the default); source studio configuration cannot set it. It permits
public HTTP(S), blocks configured control hosts and internal
literal/name destinations, and returns redirects without following them. The
header is attribution, not a credential. Cloudflare's outbound hook does not
intercept DO fetches. DNS aliases/rebinding are not a proven IP policy here;
control endpoints must authenticate all requests and tenant DOs receive no
platform keys, network bindings, platform DB or dispatch capability.

Workers Logs are enabled per script/DO. `analytics.mjs` constructs tenant-filtered
GraphQL Worker request/error/subrequest/CPU and DO namespace CPU queries. Never
interpret absent/delayed analytics as zero usage. Operator credentials stay outside
tenant code. Dispatch limits do not cap autonomous DO work.

Use a separate tenant parent domain from the control/login origin. Before public
signup, register that parent in the Public Suffix List PRIVATE section and verify
browser cookie rejection across siblings; use host-only `__Host-` session cookies.
No domain or PSL changes are made by this spike.

`probe.mjs` is opt-in test instrumentation only. It preserves binding identity and
counts Worker-side D1/ASSETS/DO calls; it does not count calls inside DOs. See
[the measured report](../../docs/managed-step-1.md) for scope and limitations.

```sh
node --test packages/managed/test.mjs
```

Round 3 restores `global_fetch_strictly_public` on every tenant, uses deployed
migration tags, and allowlists compatibility settings. Registry route lookups are
uncached. Durable tick claims serialize attempts across minute boundaries; a
crashed attempt leaves a fail-closed claim requiring operator reconciliation.
The DLQ consumer persists an alert and emits a structured error before ack.
