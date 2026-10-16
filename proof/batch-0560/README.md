# Toolkit batch proof

## Secret capability self origin

`node --test packages/studio/test/secret-self.test.mjs` failed before the change
with `ERR_INVALID_URL` for the relative API path. After the change, that test and
`packages/studio/test/studio-mcp.test.mjs` pass (20 tests). Coverage includes the
runtime origin, relative and absolute URLs, delegated tools, rejected origins,
HTTP, URL credentials, redirect rejection and credential echo suppression.

## Private scaffold

The MCP scaffold regression failed first: an MCP directory connection wrote
`https://homie.rocks` instead of `null`. Removing that implicit choice makes the
new studio's deploy plan unlisted. `private-scaffold.test.mjs` passes (2 tests),
including preservation of an existing explicit directory. The first-run suite
also passes (10 tests). Existing studio configuration is not migrated.

## First local notice

0.55.0 already registers functions before starting dev, but ignored migration
failure. Dev now gates startup on successful migrations and registration. The
fresh SQLite test applies the real migrations and declaration SQL, emits the
first notice, and verifies its handler runs once. Removing startup registration
makes that assertion fail (zero deliveries); restoring it passes. The startup
and customer-review suites pass (15 tests), including migration and registration
failure paths and preservation of subscription cursors.

The two selected local-dev integration tests also pass; see `dev-tests.log`.

## Custom routes and authorization

`custom-routes.test.mjs` failed first because `useRoutes` and `isOwner` were not
public exports. It now checks custom JSON/HTML routes, built-in discovery
precedence, static 404 fallthrough, HTML security headers, valid/non-owner/
expired/revoked sessions, bearer-key kind rejection, declared public roles and
private/unknown-role refusal. See `docs/custom-routes.md` in the package.

## Concurrent sign-in

`wrangler-login.test.mjs` failed before implementation. It checks recovery after
both a refresh error and a transient signed-out reply, increasing bounded waits,
authentication versus busy/network diagnostics, and three independent studio
processes recovering concurrently from simulated Wrangler refresh failures.
This is a deterministic process-level reproduction, not a live credential expiry
experiment. No credentials are read or copied by these tests.

## Wall indicator

A screen client receives welcome and tells its outer shell it is online. Mounting
the app's link listener afterward previously left its initial text unchanged.
The regression reproduced “Connecting to Homie” with `net.connected === true`.
Link listeners now receive current state immediately. The test repeats the wall
reload and verifies unsubscribe; all 40 netplay tests pass. This changes no socket,
heartbeat, room persistence or lifecycle behavior from #151.

## Branch and verification

PR targets main independently. #151's head `ef801b74` predates final 0.55.0
release fixes; rebasing these four original batch commits directly onto it would
omit those fixes. Shared runtime entry and deploy files match main; the indicator
change is separate from #151's heartbeat edits. Changelogs and generated build
identity will need normal reconciliation after #151 merges.

No version bump, deployment or merge was performed. Test logs in this directory
record local verification; CI is attached to the PR head.

Final local verification: 47 deploy/batch regressions, 40 netplay tests, 10 app
tests, 13 startup/customer-review tests, seven focused route/login tests and one
real workerd+D1 route test passed. The workerd test verifies live owner session
expiry/deletion and private role-link authorization through the public exports.
The TypeScript build and runtime identity check also passed. Sign-in subprocesses
have a 25-second timeout per attempt; unrelated Wrangler commands retain their
existing timeout.
