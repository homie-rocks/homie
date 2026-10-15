# Managed step 1 (operator-only experiment)

Separate from `homie-studio deploy`; no toolkit defaults or published package change.
Uses an already-built studio, Wrangler 4.x and the operator's Cloudflare sign-in.
This harness accepts only `hm-test-*` names and `homie-managed-test`. It is not a
customer onboarding service or a production deployment pipeline.

```sh
export CLOUDFLARE_ACCOUNT_ID=<test-account-id>
export WRANGLER=/absolute/path/to/node_modules/.bin/wrangler
node packages/managed/control.mjs init /tmp/managed-state
node packages/managed/control.mjs deploy /tmp/managed-state /tmp/studio-copy hm-test-inlet hm-test-dispatch.YOUR-SUBDOMAIN.workers.dev
node packages/managed/control.mjs cleanup /tmp/managed-state
```

Copy the studio to a temporary directory first, excluding `.git`, `.studio`,
`.wrangler`, credentials and local environment files. Build with the current
studio toolkit. Never call the example's deploy command. Build code executes
locally: only reviewed studios belong in this experiment. Run migrations before
exposing the dispatcher. `resources.json` records allocations and deletions; keep
it until cleanup has been verified. DO namespace IDs are recorded explicitly:
deleting a dispatch namespace alone left those namespaces behind in the live test.
The small API fallback obtains the current token using `wrangler auth token --json`,
keeps it only in process memory, and uses it for binding inventory, tags and cleanup. A failed/ambiguous provider create needs
operator reconciliation against the recorded intent and Wrangler output before
retrying. This is deliberately not step 2's durable release pipeline.

`prepare.mjs` is the pure configuration/artifact adapter. It copies the current
immutable Worker generation and assets, resets the catalogue canonical origin
and sharing metadata, adds a managed tick entry, and selects D1, ASSETS,
and Table/Lobby/Gate/Concentrator bindings. All source production IDs, routes,
secrets and additional capabilities are omitted. Extra integrations require an
explicit reviewed mapping; this proof does not support R2 or paid operations.
Keep the script and class names stable on redeploy to retain DO identities.

`dispatch.mjs` uses exact, operator-supplied hostname/prefix routes, never a user
header or guessed script name. List specific prefixes before `/`. Prefix routing
is suitable for API probes; complete studios use a hostname at `/` because their
HTML, cookies and WebSocket paths are rooted at `/`. Multiple customer studios
must have separate origins. The one-tenant CLI replaces the dispatcher registry;
for this spike the second isolated preview route was added to the generated
config explicitly. Do not use the CLI to manage a multi-tenant production registry.

The trusted dispatcher cron forwards ticks using dispatch props. It denies all
public `/__managed/*` requests. The wrapper checks that trusted capability before
calling the original toolkit `scheduled` handler. No shared secret, test token,
public tick endpoint or platform binding is given to a studio. Every-minute
wakeups let the existing function schedule matcher decide what is due.

`outbound.mjs` denies Internet fetches from dispatched user Workers. It **does not
intercept fetches inside Durable Objects**. Room egress is constrained by the
existing rules compiler's allowlist: no fetch/globalThis/dynamic imports, and no
arbitrary room modules. Only the reviewed toolkit exports may implement DOs;
review the studio entry and dependency graph before upload. The adapter accepts
built JavaScript and cannot attest that a caller used that compiler. Thus it is
not an arbitrary-JavaScript sandbox or a safe unreviewed-code upload API. A future
release gate must verify trusted runtime/compiler provenance and prevent custom
DO/entry replacements. DO service bindings and any AI capability require separate
review; an outbound allowlist cannot secure them. No AI, mTLS, VPC, socket,
platform database or dispatch capability is provisioned to these studios.

Run `node --test packages/managed/test.mjs` for the narrow routing tests. Live
proof and resource deletion evidence are in `docs/managed-step-1.md`.
