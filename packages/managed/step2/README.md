# Managed step 2

Work in progress: isolated source/build/release modules, independent of step 1's
operator harness. No customer onboarding is enabled by this experiment.

Provider references checked 2026-10-15:

- https://developers.cloudflare.com/artifacts/api/rest-api/
- https://developers.cloudflare.com/artifacts/api/workers-binding/
- https://developers.cloudflare.com/artifacts/guides/event-subscriptions/
- https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/
- https://developers.cloudflare.com/containers/api/durable-object-container/
- https://developers.cloudflare.com/containers/guides/image-management/
- https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/

The custom pipeline follows Artifacts' documented event-driven WFP alternative
to Workers Builds. Repository build commands must never run with Cloudflare
deployment credentials. A fresh remote container per build receives only its
source snapshot; a trusted service assembles binding metadata from its registry.

Rollback changes code, never restores database contents. Compatible additive
migrations remain applied. Destructive migrations and DO class lifecycle changes
must fail the automatic rollback gate.

## People and authority

The owner describes a change to Homie's agent. The agent receives a short-lived
write capability for that studio's repository, never a Cloudflare API token.
Pushing a commit starts the platform-owned pipeline. A Team member can receive a
read-only repo token (at most one hour here), clone locally for inspection, and
have that capability revoked. Tokens are excluded from remotes and logs.

The Homie operator owns the tenant registry and reviews executable changes,
dependency pins, schemas, and promotion. The test operator endpoint uses a random
bearer capability; production identity and step-up authentication belong to step 3.
A model or repository cannot supply a binding ID, an account override, or a
production target to the deployment API.

## Stages and credentials

| Stage | Runs where | Authority |
| --- | --- | --- |
| Import/author | Trusted Git client; copied files only | One repo's expiring write token |
| Push delivery | Artifacts → dedicated Queue → trusted Worker | Verified provider envelope and registered namespace/repo |
| Orchestration | Platform-owned Cloudflare Workflow | Tenant registry, release ledger, private artifact bucket, builder service |
| Build | Fresh Cloudflare Container VM | One repo's read token; no platform token, host mounts or production bindings |
| Preview upload | Trusted Workflow | Cloudflare deploy token; bindings constructed from registry |
| Studio checks | Fresh remote VM, toolkit local dev/check pair | Synthetic local D1 and local test-session credential |
| Preview probes | Trusted Workflow | Only the isolated preview URL and preview D1; free booking, MCP schema |
| Promotion/rollback | Trusted release Durable Object | Operator authorization, expected production commit, sealed artifacts, registry |

The VM pins Node 24.20.0, toolkit 0.51.8 (the copied example's version), lockfile
SHA-256 and immutable Git commit. The platform pins Worker compatibility date
2026-10-01. Cloudflare documents `cloudflare/debian-trixie` as a managed image
based on digest-pinned Node 24.20.0; the runner additionally checks the exact Node
version. Each job has a ten-minute container-destruction alarm, bounded command
logs and artifact size, and a fresh filesystem. Every exit destroys the VM.
There is no local-build fallback. Network access is needed for Git/npm; no
credential-bearing proxy is exposed to repository processes.

Artifacts' documented custom CI path is used instead of a repository-controlled
Workers Builds deploy command. Owner code can control build output, so passing
owner tests alone never grants promotion: the independent live probe and operator
release gate remain mandatory. Cached build sandboxes are intentionally not reused.

## Release and migration policy

Release records contain source commit, toolkit/runtime/lock pins, artifact digest,
compatibility date, migration filenames and digests, preview checks, actual
provider bindings, actor, previous release and provider deployment ID. Sealed
artifacts live in a private R2 bucket. The ledger serializes mutations and checks
expected production again under its mutation lock. An ambiguous deploy leaves a
visible incident and a lock requiring operator reconciliation; it is not silently
retried as a successful release.

The initial empty test databases receive the reviewed migration set. Subsequent
builds must match those approved hashes exactly. This slice does not automatically
apply new schemas. Additive migrations require an explicit registry review and
schema compatibility decision; destructive changes and DO lifecycle changes are
excluded. Rollback never runs down migrations or restores D1 contents. Existing
migrations and all customer data remain, with the same D1 and DO identities.

The WFP upload API returns `deployment_id`; it does not provide the standard
Workers versions/deployments API. Therefore `workerVersionId` is explicitly null.
Rollback re-uploads the sealed prior bundle to the stable script, records both old
and new deployment IDs, and verifies binding identities. It **does not reactivate
an old Worker version ID**. Gradual traffic splitting is not implemented for WFP;
standard Workers gradual deployments cannot simply be assumed to apply here.
This provider gap remains against the literal step 2 acceptance criterion.

Little Inlet's authenticated staff checks reject a remote origin because they
require the toolkit's local dev session. They run in an isolated VM's local
preview without adding a public test-auth bypass. The deployed WFP preview is
separately tested through MCP and a synthetic free booking. This distinction is
also retained in the check receipt.

## Running the disposable proof

All tools and transient working files are under this directory. `.local/` is
ignored and contains secrets; never commit it. Use the pinned Wrangler installed
by `npm ci --ignore-scripts` here. `operator.mjs` fixes the Homie test account and
records creation intent before mutations. The scripts accept only `hm-s2-*` and
`homie-managed-s2` resources; they must refuse to adopt existing resources.

`source.mjs import` copies Git-tracked ordinary files from the example without
executing it, imports them into Artifacts and revokes the initial write token.
`source.mjs share-proof` proves clone, push denial and revocation. The provider
runtime, preview, Workflow and teardown scripts are test harnesses, not a customer
onboarding command. Cleanup detaches triggers/consumers, stops owned jobs, empties
the artifact bucket, deletes only the recorded resources and verifies absence.

Run `node --test packages/managed/test/step2.test.mjs` from the repository root.
The wrapper includes these tests in the existing CI shard inventory without
changing step 1's modules or the toolkit version.
