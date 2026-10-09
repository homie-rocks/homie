# A studio's own MCP server

Design written before implementation, 9 October 2026.

The studio owns the endpoint, identity, records, room authority and credentials. No
request goes through Homie. `/mcp` is a first-class surface beside the site's pages.
Giving a client that address starts OAuth discovery; the person signs in with the
studio account they already use and approves the named client. Public callers can
only use explicitly public capabilities. OAuth never turns a public tool into an
owner tool, and a connection never freezes a staff grant forever.

## Protocol and dependencies

Use Cloudflare's maintained Workers OAuth Provider for authorization codes, S256
PKCE, dynamic client registration, refresh rotation, revocation and resource-bound
tokens. Use the official MCP SDK v2 and Cloudflare's stateless `createMcpHandler`
for Streamable HTTP, including older clients supported by that library. Do not
implement a JSON-RPC or OAuth protocol in Homie. Publish protected-resource
metadata for `/mcp` and authorization-server metadata on the same origin.

Sources checked for this design:

- [MCP transport](https://modelcontextprotocol.io/specification/latest/basic/transports)
- [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [Cloudflare handler APIs](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)
- [Cloudflare authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

The single-Worker provider is supported upstream and matches the studio's existing
ownership boundary. Investigate its storage interface before selecting KV or an
adapter over the existing D1. No storage operations, timers or persistent MCP
sessions should run for ordinary page traffic. Import the protocol implementation
only on MCP, authorization and connection-management routes. Measure bundled size
and startup against main; a dynamic import alone is not proof of lazy loading.

## Identity and authorization

Consent uses the existing player/passkey account and office owner check. Bind the
grant to that account and client. Resolve owner status and app role grants afresh
at each call. Support the existing owner's browser session without exposing its
cookie or an office key. Browser consent requires same-origin POST and a short-lived
single-use CSRF challenge. Show the client and the permissions being delegated.
Never let a redirect or client description inject markup into that page.

The office exposes connections and revocation plus a bounded, paginated call audit.
Log person, client, tool, time and outcome, not access tokens, secrets or arbitrary
record contents. Revocation must take effect before the next call, including rooms.

Office operations reuse the office API implementation with a trusted internal
identity, never forged HTTP identity headers. An owner's AI has the existing
`office` authority, not `session`: refunds and destructive controls still create
the office's confirmation request. App record operations reuse app validation,
capabilities and optimistic versions; the internal caller bypasses only private
URL possession, never the signed-in grant. Public listing and reads respect launch
states and public app roles.

## Studio code

Discover `tools/*.ts` and `apps/<id>/tools/*.ts` at build time. Each definition has
a name, description, JSON input schema, explicit audience and handler. Names must
be unique and built-in names reserved. Build checks TypeScript and schemas before
writing a generated registry. `tool new` creates a useful, safe example; `tool call`
uses the same endpoint and browser OAuth flow. `dev` runs the same Worker code.

The handler context exposes caller identity, checked records and room operations,
shop services, studio-scoped database operations, outbound fetch and optional
Workers AI. Secrets are named capabilities used for outbound requests, never a
getter returning a value. No raw environment binding is handed to tools. Studio
code is trusted Worker code, not a security sandbox: a malicious dependency in the
Worker can bypass a JavaScript wrapper. Document that boundary explicitly and do
not claim otherwise. Sharing a tool as a part requires reviewing its code.

Resources represent authorized record collections; prompts are studio-authored
templates. Their visibility and argument checks use the same audience machinery.
Returned records are labeled untrusted data, separated from instructions.

## Rooms and inbound events

Remote sit/look/act/speak/stand use the existing marked guide vocabulary, capacity,
server AI policy and chat controls. Keep the seat inside the room's Durable Object
so calls from separate MCP requests reach the same seat. Bind it to the OAuth
connection; never return an agent pass to the model. Validate every action again
at the room boundary. Humans-only servers remain humans-only.

A definition may opt into a webhook. Verify a timestamped HMAC over the raw body,
bound replay window and unique delivery id before dispatching through the same
schema, rate limit and audit path. The webhook delegates only its declared tool;
it is not an owner credential. Room events must be declared on the tool and handled by the experience,
and record changes use the normal record service.

## Proof and release

Test permission matrices, grant removal, cross-account seat access, invalid input,
revocation, rate limits, audit privacy, replay/CSRF and destructive confirmation.
Use the official SDK client against local Wrangler and real Chrome consent, then
exercise an owner tool, a custom tool, public refusal and a remote room action.
Use a temporary copy of Brass and Tide with the packed toolkit for two real tools;
record friction here and delete the copy. Never deploy or edit the source example.

Run the requested release gates sequentially. Check current provider instructions
before describing Claude, ChatGPT or Grok connection steps; browser approval and
the client's own connector setup are distinct steps. Record measured results and
remaining limitations below rather than claiming unrun tests passed.

## Implementation and proof log

Implemented; protocol, browser and release evidence follows.

### Decisions made during implementation

The provider's KV interface uses the existing D1 through `mcp-store.mjs`. OAuth
code, PKCE, token cryptography, metadata and consent remain upstream code. D1 also
holds revocation state checked independently at every request, so a cached token
cannot preserve a revoked connection. An office-session connection remains valid
only while that originating owner session remains valid; passkey connections check
the account's current owner flag and current app grants.

The tool context exposes a namespaced database rather than unrestricted SQL over
OAuth and secret tables. Tools sharing a declared namespace can share small values.
Business records should use the app record service. Outbound secret capabilities
are explicit origin/header declarations. As designed, trusted Worker code is not
sandboxed; this feature does not make third-party executable code safe to install.

Wrangler's normal bundle folds dynamic imports into one script. The build now emits
ES modules with esbuild splitting and tells Wrangler to upload them without
rebundling. The main module graph does not import the MCP protocol module eagerly.
There are no new bindings, scheduled jobs or storage operations on normal page
requests. Deployed bytes necessarily increase because every studio has an endpoint;
claiming byte-for-byte equality with main would be false. Measurements belong below.

### Current client setup (official documentation checked 9 October 2026)

These counts separate the client's setup from the studio's **one Allow connection
approval**, assuming the person is already signed in to their studio. A signed-out
person also signs in with their existing passkey. No flow asks for an office key.

- **Claude:** the documented individual setup has nine numbered UI steps: open
  Customize → Connectors; Add custom connector; name it; enter `/mcp` and Continue;
  review detected auth and Continue; choose sign-in behavior; choose Claude's
  published identity or automatic registration; leave fixed-credential headers
  empty; Add. Approve once at the studio, then enable the connector in the chat.
  Team/Enterprise provisioning is an owner/admin step before each member connects.
  [Claude's instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- **ChatGPT:** the current developer page has seven setup steps: open Plugins;
  plus → Add custom MCP server; name and description; public endpoint `/mcp`;
  authentication and acknowledgement; Create as a plugin; review discovered tools.
  Approve once at the studio, install/select the resulting plugin in a conversation.
  Account and workspace policies apply. The current page replaces the older
  developer-mode-only instructions; it supports Streamable HTTP and auth discovery.
  [OpenAI's instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- **Grok:** three documented steps: open grok.com/connectors; New Connector →
  Custom; enter `/mcp` and authenticate (the studio's one approval is in this last
  step). Business/Enterprise admins provision it first. The official page, updated
  6 October, confirms custom tools and schemas but does not establish support for
  every MCP resource/prompt feature. Do not promise that parity.
  [Grok's instructions](https://docs.x.ai/grok/connectors)

These are documentation-based compatibility statements, not claims that a live
connection was installed in all three hosted products. No deployment was authorized.
The protocol/browser proofs use the official SDK and local Workers runtime.

### Brass & Tide trial

Copied the example without node_modules, git history, credentials, local state or
built output; installed the checkout's packed toolkit in the copy. Added
`set_tonights_special` (taproom staff) and `whats_pouring` (public). Local Wrangler
served the complete site. The official SDK connected through real Chrome consent,
listed 24 tools (22 built-ins and the two studio tools), called `studio_office` and the custom write as owner, read the
cellar anonymously, and refused both anonymous writes and the anonymous office
call. The existing wall displayed the changed special.

What was awkward: the collection schema validates field types but cannot tell a
tool author which record the existing screen reads. The first tool used a new
record id; the existing screen reads `current`. Its `taps` string is JSON-encoded
availability, not a beer name. Reading the app's record usage and preserving the
existing record shape resolved it. This belongs in tool authoring guidance, not
an extra question for the studio owner. The trial also caught missing tool-source
watching in dev; dev now rebuilds when tool definitions change.

### Integration with current main

Rebased on main's 0.37.2 paid-parts release. MCP's migration is now
`0017_studio_mcp.sql`, after both purchase migrations. The split Worker builder
preserves the selling entry alias, including a studio's first paid release.
Cloudflare Agents 0.28.0 pins SDK v2 2.0.0 and an optional v1 1.30.0 peer. The
existing purchases endpoint keeps its newer 1.32.1 SDK through an npm alias;
no forced peer resolution and no downgrade of that endpoint. The studio endpoint
uses the official v2 SDK through Cloudflare's handler.

### Worker size

Against main `8ea9dbd`, the same esbuild minification/target was used for empty
ordinary studio entries. Main's ordinary bundle is one module; the new build uses
real split ES modules:

| Build | Total bytes | Gzip bytes (sum of modules) | Eager module graph |
| --- | ---: | ---: | ---: |
| Main 0.37.2 | 1,366,599 | 418,654 | 1,366,599 |
| Studio MCP | 1,923,957 | 575,788 | 1,141,195 |

This is +157,134 gzip bytes, with 225,404 fewer bytes in the startup graph. The
metafile traversal follows static imports and confirms zero MCP SDK, Cloudflare
Agents or OAuth-provider inputs in that graph. Normal pages perform no new MCP
D1 operations. This establishes lazy loading and unchanged storage work, not a
claim of identical deployed bytes or a guarantee of identical billed CPU.

The tool CLI uses the patched official SDK client 2.3.1 under `mcp-studio-client`.
Cloudflare Agents pins older client peers with an OAuth-client advisory; its
server-handler import uses only the server SDK and async context. Those older
clients are not used by this endpoint or the CLI. The purchase SDK remains 1.32.1.


Wrangler's `check startup` (local workerd, dry-run builds only) was run three
alternating times for each bundle. Sampled active startup time was 26.4, 6.0,
6.9 ms on main and 7.2, 5.2, 0.0 ms with MCP (medians 6.9 and 5.2 ms). These
samples include profiler noise and GC; they do not establish exact Cloudflare
billing or a universal latency improvement. They show no measured startup
regression in this local comparison. No Worker was uploaded.

The [SDK OAuth advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h)
applies to HTTP OAuth clients, not MCP servers. The CLI preserves the patched
SDK's issuer stamps and discards unstamped saved credentials before reconnecting.
The npm dependency audit still reports Cloudflare's unused pinned client peers
and the existing Miniflare/sharp advisory; this is not a claim of a clean audit.


### Final local proofs

The packed toolkit was installed into the temporary example through its existing
`devDependencies` pin. A duplicate entry under `dependencies` had initially left
the old toolkit installed; the final run removed that ambiguity and verified the
installed package and patched client dependency. This is another useful lesson
for an upgrade: replace the pin that exists, rather than adding a second one.

Real Chrome approved OAuth through the studio using an existing-owner-session
fixture. The SDK discovered metadata, registered a client, completed PKCE and
listed the tools. Owner office access and `set_tonights_special` passed. Anonymous
`whats_pouring` returned the four available beers and the special; the owner write
and office read were refused anonymously. The wall showed the changed special.
The actual `tool call` command succeeded for the public read and exited 1 for the
refused public write. The original example was never modified; the temporary
copy and its dev server were removed after the final proof.

In the same local Wrangler runtime, a human host opened a room. The remote AI sat
as a marked AI, read a host-supplied view, delivered the vocabulary's `guard` goal
to that host and stood. An invented goal and an unsigned seat were refused. The
script-only server's speech policy refused `agent_speak`, as it should. A retry
using a fresh room avoided an old room's host handover; the test must wait for the
human to be the host before expecting that human's view to reach the AI.

The committed workerd test separately drives the office's Revoke button in Chrome,
then proves both that the old refresh token returns `invalid_grant` and that the
client cannot call again. It also exercises app record resources, custom prompts,
invalid schemas and anonymous refusal with the official patched SDK client.

### Built-in surface and boundaries

There are 22 built-ins: `studio_info`, `studio_office`, `studio_shop`,
`studio_players`, `studio_stats`, `studio_posts`, `studio_parts`, `app_schema`,
`app_records`, `room_announce`, `room_kick`, `room_mute`, `room_close`,
`studio_game`, `shop_refund`, `studio_office_read`, `studio_office_action`,
`agent_sit`, `agent_look`, `agent_act`, `agent_speak`, `agent_stand`.
The generic office tools cover its existing filtered views and controls through
the same implementation. They do not mint or return legacy office/agent keys.
`app_schema` exposes usable roles and field definitions before a record change.

No hosted Claude, ChatGPT or Grok installation was attempted: this task forbids
deploying, and those hosted clients need a public endpoint. Their current setup
instructions above are documentation-based. There is no portable one-click
connector-install link across the three products. The studio approval itself is
one click once signed in. Because the endpoint also serves public tools, clients
that infer OAuth solely from an initial 401 may need their explicit OAuth option.

Studio code is trusted code in the same Worker. The context hides raw bindings
and credentials and confines database access, but this is not a sandbox against
a malicious installed dependency. Invitation cookies for invite-only rooms are
not delegated to an AI; named open/account servers use the existing server door
checks. The AI cannot start a room without people or override humans-only rules.

### Verification details

The safety tests cover changing role grants and revocation, forged identity
headers, input schemas, per-caller limits, audit privacy, separate studio/tool
storage, webhook signature/timestamp/replay checks, declared room events,
cross-connection seat access, humans-only servers, secret origin and echo checks,
and the office's existing destructive-action confirmation. Type/build tests cover
invalid definitions, duplicate and reserved names, and tools imported from parts.

The real-browser test uses a seeded existing owner session, not a newly enrolled
hardware passkey. It exercises the actual consent page, SDK authorization flow,
Worker and office revocation UI. Staff grant changes are exercised in integration
tests. This does not claim browser coverage of every account enrollment method.

The first complete gate run found three failures in the Node settlement crash
harness, whose test bundle eagerly followed the new Cloudflare-only MCP module.
The harness now preserves that lazy import boundary; all three crash tests passed
on rerun. The production MCP implementation continues to run in the real Workers
runtime tests, without a mock of Cloudflare's OAuth provider.

A subsequent full run passed those crash tests but selected another worktree's
temporary `release-2099-12-31-studio-0.37.4` tag as an upgrade baseline. Git tags
are shared between worktrees. The upgrade fixture now considers only release tags
reachable from this checkout's HEAD, so unrelated branch tags cannot change its
baseline. The other worktree's tag was left intact.

### Release gates

Run sequentially in this checkout, with the requested Chrome path for `npm test`.

| Gate | Result |
| --- | --- |
| `npm ci` | Passed; five high dependency-audit findings discussed above |
| `npm run build` | Passed |
| `npm test` | Passed: 2,101 passed, zero failed, eight optional cases skipped |
| `npm run test:plugin` | Passed: 118 passed, one optional live-studio test skipped |
| `npm run validate` | Passed for marketplace and plugin |
| `node scripts/desktop.mjs --check` | Passed: packed extension and first-run server checks |
| `node scripts/changelog.mjs --check` | Passed; existing older release-link notes remain advisory |
| `node scripts/publish.mjs --check` | Passed: studio 0.38.0 is the one new npm version |

The standard full-suite configuration skips eight optional cases: external
stripe-mock, separately configured Wrangler browser suites, and an opt-in
Miniflare comparison. The dedicated remote-MCP workerd/Chrome test runs in the
full suite; the separate Brass & Tide proof used actual local Wrangler.
The plugin's skipped case requires `HOMIE_PLAYTEST_URL`, a live deployed studio.

## PR #78 CI repair and slice 6 integration

Rebased onto `91be345` (PR #77), retaining main's prediction implementation and released changelog sections unchanged. This feature is now studio **0.39.0** / plugin **0.40.0**. The public template and template fingerprints were regenerated with `scripts/template.mjs` and `scripts/studio-template-history.mjs`.

The original CI run was `37992524039`, Node 24 job `114030096628`. Its failed log says:

- `2026-10-09T21:36:49.7463775Z`: `MCP uses the protocol binding for challenges and receipts` failed: `-32603 !== -32042` (`machine-payments.test.mjs:110`).
- `2026-10-09T21:36:49.7470255Z`: `MCP error -32603: Missing optional dependency "@modelcontextprotocol/sdk". Install it to use mppx MCP SDK transports.`
- `2026-10-09T21:36:49.7507343Z`: `node_modules/mppx/dist/server/Mppx.js:1836:46: ERROR: Could not resolve "@modelcontextprotocol/sdk/types.js"` in the selling bundle test. The workerd purchase tests and interrupted-deploy assertions failed downstream of the same missing module.

A clean install with Node 24.14.1 / npm 11.11.0 passed the focused reproduction. Matching CI's **Node 24.21.0 / npm 11.19.0** reproduced both the protocol error and the bundle failure. The payment server's aliased SDK did not satisfy mppx's canonical optional peer; npm 11.19 omitted the root optional SDK while installing agents' exact legacy peer in the studio workspace. The fix declares `@modelcontextprotocol/sdk@1.30.0` explicitly in studio (matching agents 0.28.0's exact peer and mppx's >=1.25.0 peer), and in the root development dependencies so hoisted mppx resolves it in workspace tests too. The existing purchase server stays on its aliased SDK 1.32.1. The lockfile now has a required canonical SDK, with no optional orphan or nested conflicting copy. No payment or room assertion was weakened.

Node 22 eventually passed the original run in 21m16s; Node 24 failed normally in 19m26s. Neither original job remained hung. The new MCP OAuth test and the existing purchase-client tests did, however, leave client cleanup on the success path (one purchase client was never closed). They now close clients in `finally`, including assertion/connect failures, before disposing their servers. The Cloudflare stateless MCP handler already closes its product and transport. Test commands set a hard 30-minute limit per test file (including handles left alive after tests finish); a deliberately unclosed interval was verified to exit nonzero under this limit. File concurrency is two to bound concurrent Chrome/workerd load.

The new room-tool regression runs signed remote calls through the actual relay and, for prediction, the actual rules host with slice 6 shared movement. It checks sit/look/act/speak/stand, validated goals and rate limits, prediction acknowledgements, app role loss and connection revocation. Legacy browser-hosted games and app rooms exercise the same path. The real-Chrome OAuth approval, SDK discovery/calls and revocation test also passes on Node 24.21.0.

The first full Node 24 gate also caught an incorrect changelog-test assumption: every section older than the package version had to have a PR link. Main's merged 0.38.0 section has none. The test now treats absent PR links as advisory and validates any links that are present, consistent with the release checker's treatment of absent tag links. This preserves main's released sections byte for byte rather than adding metadata retrospectively.

That first full run completed normally (2,222 passed, two failed, five optional skips). Its other failure was `mcp.test.mjs:160`: the expected `/comet-crews/` completion message was instead the valid `The build is still running ... 20 s so far` response. Slice 6's rules build can outlive the first MCP response window, especially during the browser suite. The workflow test now follows `studio_job` to completion with a two-minute deadline, still requiring a successful result naming the game and a completed build progress stage. It does not extend the production response window or weaken the completion assertions.

The desktop packaging gate exposed a separate confirmed handle leak: its stdio client left every successful request's 60-second timer alive, delaying exit after the success report. The extracted checker helper now clears timers on replies, rejects and clears pending requests on close/error, and bounds child shutdown. The packaging check closes every client in `finally`. Two process-level regressions require natural exit after a reply and after an early server exit, within five seconds (no force-exit/unref). Both passed under Node 24, and the desktop gate was rerun after this fix. This was a delayed checker exit, not the cause of the original Packages job failure.

### Final local repair gates

Every requested gate passed sequentially on both Node 22.23.3 / npm 10.9.9 and Node 24.21.0 / npm 11.19.0: clean `npm ci`, build, package tests with real Chrome and stripe-mock, plugin tests, validate, desktop check, changelog check and publish dry run. Nothing was deployed or published.

| Runtime | Package tests | Plugin tests | Other six gates |
| --- | --- | --- | --- |
| Node 22.23.3 | 2,226 passed, zero failed, five optional skips | 120 passed, zero failed, one optional skip | Passed |
| Node 24.21.0 | 2,224 passed, zero failed, five optional skips; two later desktop cleanup regressions also passed | 120 passed, zero failed, one optional skip | Passed |

The Node 24 full suite preceded extraction of the desktop checker helper; its two process-exit regressions and the desktop gate were rerun afterward. Node 22's full suite includes those regressions. Both full suites passed all 37 real-Chrome prediction matrix cases and the new MCP room-tool cases for rules prediction, legacy games and apps. The publish checks identify only studio 0.39.0 as new, with 22 package versions already on npm. CI on the pushed revision is the remaining gate.
