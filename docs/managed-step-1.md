# Managed step 1: studios on Workers for Platforms

Tested 2026-10-15 on Homie's account, from `managed-step-1` at toolkit 0.53.0.
Design reviewed from `origin/managed-design` (`managed-design.md` and
`managed-first-slice.md`, draft #134). This is the hosting spike only: no signup,
payments, Artifacts pipeline, operations agent, production migration or version bump.

## Implementation

`packages/managed` is a private, separate operator package. It prepares a current
studio build for `wrangler deploy --dispatch-namespace`, creates a dedicated D1,
applies the studio migrations, deploys an outbound deny Worker and exact-registry
dispatcher, and records resource cleanup. It never calls the self-hosted deploy
command. No self-hosted source or behavior changed.

The copied Little Inlet source came from `/Users/ryan/Studios/examples/little-inlet`
(read-only). Work happened in `/tmp/hm-test-wcHKn8/studio`. Excluded local state,
credentials and deployment state; replaced Cloudflare resource declarations in
the copy, built against this checkout's 0.53.0 toolkit, and added the existing
Coin Dash starter. The only functional example change was changing the existing
`rolling-slots` schedule from daily to every minute in the copy to observe a tick.
No live records, Stripe credentials or payments were copied or exercised.

Versions: Node 22.22.0, Wrangler 4.145.0, studio 0.53.0. Preserved the generated
studio compatibility date 2026-06-01; new control Workers use 2026-10-01.
Wrangler upload: 5309.51 KiB raw / 1430.87 KiB gzip, initial startup 4 ms,
181 assets. All 27 SQL migration files applied to each dedicated database
(including the example's two differently named `0015` files).

## Evidence

- Real hostname dispatch: `hm-test-dispatch.ryan-d2f.workers.dev`, root mapped
  explicitly to `hm-test-inlet`. `/__preview` mapped to `hm-test-preview` for API
  isolation probes. URLs are intentionally retired after the test.
- Home and app shell returned 200. Little Inlet rendered its canvas and full UI,
  left the loading cover and reported “Together, live” without page errors.
  [Screenshot](proof/managed-step-1/app.png), [browser facts](proof/managed-step-1/app.json).
  MCP initialize, tools/list and studio_info
  tools/call returned valid SSE JSON-RPC responses identifying Little Inlet.
- Little Inlet's real records endpoint rejected an unknown field with 400,
  then created `intentions/hm-test-record` with `{name:"Managed test",x:1,z:2}`.
  A subsequent GET returned version 1; the preview Worker returned no record
  for that same ID. Dedicated binding inventories have different D1 and all
  four DO IDs. No dispatch or cross-studio binding was attached.
- The existing two-browser Coin Dash check passed: room `pub-1`, seats 0 and 1,
  both server replicas; round 1 results contained both humans and two bots;
  no reconnects during the round. [Raw room result](proof/managed-step-1/room.json).
- [HTTP/MCP and binding evidence](proof/managed-step-1/http.json) includes original
  and redeployed inlet DO identities: stable script/class names retained them.
- With final outbound policy restored, a deliberate socket close reconnected
  to the same `hm-reconnect` room and seat 0. [Reconnect facts](proof/managed-step-1/reconnect.json).
- The existing rolling-slots function consumed a synthetic `slots.refresh` event
  with its required function selector and recorded `complete`, creating dated
  October 17 shoreline/planting slots. Three natural minute cron ticks also completed through the trusted adapter.
  [Function-run receipts](proof/managed-step-1/functions.json).
- Narrow managed tests cover registry routing, spoofed headers, public tick
  rejection, trusted tick dispatch and removal of production capabilities.
  Engine TypeScript build passed. No toolkit test matrix or performance suite ran.

The first room proof ran while outbound was temporarily detached for diagnosis;
it must not be read as proof of that policy's behavior. Final configuration
restored the outbound binding and removed temporary diagnostic instrumentation.
Initial requests timed out at 15–20 seconds; later examples returned in roughly
6–12 seconds. Both browser seat times were around 60 seconds. The room check's
loading covers lifted by timeout, not an explicit game-ready signal. These are
functional results with a substantial startup limitation, not production latency
or capacity acceptance. One run on a shared machine cannot isolate the cause;
removing outbound was not a controlled performance experiment.

## Assumptions and smallest adaptations

| Toolkit assumption | Managed adaptation / finding |
| --- | --- |
| Ordinary Worker, direct workers.dev URL and source production resource IDs | Separate allowlisted config; WFP upload flag; exact trusted hostname registry. No change to toolkit deploy. |
| Table/Lobby plus newer Gate/Concentrator exports | All four SQLite classes and self-bindings uploaded unchanged. Each tenant has separate namespace IDs; stable names preserve them on redeploy. |
| D1 migrations and records | Run existing migrations against a newly allocated tenant D1. Schema validation, role checks and records runtime unchanged. |
| Built assets and dynamic module graph | Preserve the current immutable Worker generation, ESModule rules and ASSETS binding with run_worker_first. Copy assets and reset catalogue canonical origin and directory-sharing metadata; no extra hosting service. |
| Studio cron triggers installed by normal deploy | Wrangler's WFP branch returns before trigger installation. Omit user crons; one trusted dispatch cron calls the toolkit scheduled handler through a wrapper with dispatch props. Public requests cannot invoke the reserved path. |
| URL-rooted links, cookies and sockets | Use one hostname per real studio. Path prefixes work for direct API probes, not a transparent complete-site mount. |
| All studio configuration may be copied | Source IDs, routes, secrets, custom bindings, AI and R2 are excluded. Additional capabilities require explicit mapping. |
| Ordinary preview flag can represent managed preview | Allocate a separate user Worker/D1/DO set. Do not set HOMIE_PREVIEW: toolkit preview behavior bypasses some production settings; test isolation should not bypass them. |
| Arbitrary studio code can be secured by outbound filtering | False for DO code. Restrict room customization to the existing guarded rules language and reviewed runtime; require provenance/review before deployment. |

Untrusted WFP hides `request.cf` and disables `caches.default`. No direct use of
those APIs was found in the toolkit Worker source inspected here; no workaround
or trusted namespace was needed. [Isolation documentation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/).

### Room egress boundary

Cloudflare explicitly says [outbound Workers do not intercept DO fetches](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/).
This package does not claim otherwise. The current rules compiler rejects
`fetch`, `globalThis`, dynamic imports and other non-allowlisted globals and
methods. Coin Dash used that compiler unchanged. The reviewed toolkit owns the
Table/Lobby/Gate/Concentrator implementations. No AI, mTLS, VPC, external service
or platform credentials were attached. Browser-hosted app code is not a source
of server privileges.

This is an **operator-only reviewed-build harness**, not an untrusted upload
service. A modified Worker entry, dependency or DO class can bypass a JavaScript
compiler policy. The managed release gate must attest the compiler/runtime and
review executable changes; general unreviewed JS in tenant DOs requires a stronger
isolation design. Outbound limits are no substitute for that gate. Even approved
bindings are explicit capabilities, outside a blanket Internet-fetch policy.

## Provider limits and cost notes

- [Bindings](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/): ASSETS, one D1, four DO bindings and four text variables worked. Only explicitly attached resources are available. No binding-count limit was hit.
- [WFP limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/limits/): current docs state no WFP DO namespace count limit; four per user Worker worked here. That is not a measured maximum or an ordinary-Worker account quota. WFP also removes the ordinary Worker script-count cap. Gradual deployments are unavailable; updates replace 100% of user traffic.
- [Assets](https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/): 100,000 files/version for paid/WFP, 25 MiB/file, Wrangler >=4.34.0. This build's 181 files stayed below limits. R2 was not needed or tested.
- [D1](https://developers.cloudflare.com/d1/platform/limits/): paid accounts support 50,000 databases, 10 GB/database and 1 TB/account. Dedicated databases fit this model; each DB is single-threaded. No quota boundary was stress-tested.
- [Custom limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/custom-limits/): dispatcher uses 100 CPU-ms/50 subrequests for HTTP, 1000 CPU-ms/100 subrequests for ticks. These are spike settings, not calibrated production budgets, and must not be treated as DO alarm/room CPU caps.
- [Tags](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/tags/): tags were written through the script tags API (`hm-test`, `step-1`, studio/preview). Eight tags/script maximum. Tags are management metadata, never authorization.
- Cron: WFP Wrangler deploy does not install them; the ordinary dispatcher owns one cron. Cloudflare documents [up to 15 minutes for cron changes to propagate](https://developers.cloudflare.com/workers/configuration/cron-triggers/). No claim that a generic Workers pricing reference proves per-user cron support.
- [WFP pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/): US$25/month includes 20 million requests, 60 million CPU-ms and 1,000 scripts; additional usage is $0.30/million requests, $0.02/million CPU-ms and $0.02/script. Dispatch/user/outbound count as one request chain. This account's subscription was already enabled; it was not changed.
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) is rows/storage, not a per-database rental. [DO compute and storage](https://developers.cloudflare.com/durable-objects/platform/pricing/) remain separate cost dimensions; active real-time rooms and alarms matter. A minutely wake is about 43,200 invocations/studio/30-day month before retries. No invoice-derived cost, per-venue capacity or margin is claimed.

## Resource lifecycle

All test resources were deleted; verified at 2026-10-15 15:25:45 UTC.
[Recorded resources](proof/managed-step-1/resources.json) and
[15 individual not-found checks](proof/managed-step-1/cleanup.json).
Wrangler dispatch-namespace list returned `[]` again.

| Created resource | Identity | Deleted |
| --- | --- | --- |
| Dispatch namespace `homie-managed-test` | `854b5b6f-dbdc-4b91-b5e1-2ef9b1cad9bb` | Yes |
| Ordinary Workers | `hm-test-dispatch`, `hm-test-outbound` | Both |
| User Workers and asset deployments | `hm-test-inlet`, `hm-test-preview`, 181 assets each | Both scripts removed with namespace; no asset-serving deployment remains |
| D1 `hm-test-inlet-db` | `e6e9f37b-1b79-4b35-aac0-025c42af93a5` | Yes |
| D1 `hm-test-preview-db` | `329881a8-179b-4fbb-8a3a-0098eabcbb4f` | Yes |

| DO `hm-test-inlet_Concentrator` | `73d35544e14547998561763c901dd7ae` | Yes |
| DO `hm-test-inlet_Gate` | `a4a2660f53604ee684a012d7af01ca87` | Yes |
| DO `hm-test-inlet_Lobby` | `77f95b9943b3411398a29ac2f2f24f89` | Yes |
| DO `hm-test-inlet_Table` | `264dbd0574754c58933a431f993c3749` | Yes |
| DO `hm-test-preview_Concentrator` | `33c57a77f8b349c0ba4253a1ae718ba0` | Yes |
| DO `hm-test-preview_Gate` | `0a6efdc2ca754a3089098b2f75c88583` | Yes |
| DO `hm-test-preview_Lobby` | `666d54daa1bd45e8b8890c74cfbcf071` | Yes |
| DO `hm-test-preview_Table` | `9e9e6fc871e24615b778c6e5c414a591` | Yes |

**Cleanup finding:** deleting a dispatch namespace removed its user scripts but
left their DO namespaces addressable by ID. Each was then explicitly deleted
through the DO namespace API and re-read as 404. The package now records the DO
IDs during deployment/before cleanup, removes user scripts with `force=true`,
and explicitly deletes/verifies any recorded DO namespaces before deleting the
dispatch namespace. Do not assume parent deletion destroys tenant room storage.
The forced-user-delete cascade itself was not separately measured here; the
explicit DO deletion and not-found checks were exercised on all eight IDs.

[Dispatcher cron traces](proof/managed-step-1/cron.json) show actual scheduled
invocations with `outcome: ok`; these were not an HTTP tick simulation. First
recorded natural schedule was the 15:18 UTC minute, after the 15:00 initial
trigger and intervening dispatcher deployments (last at about 15:10). Deleting
the dispatcher removed that cron. The temporary tail connection was closed by
terminating only PID 37629, which this task started; browser harnesses closed
their own processes in `finally` blocks. No other agent's process was touched.

No production Worker, homie.rocks deployment, original example source or live
example data was changed. Test-only module instrumentation was removed before
the final deployment. No service subscription was enabled or cancelled. Deleted
asset deployments are not a claim of immediate physical CDN blob erasure.
