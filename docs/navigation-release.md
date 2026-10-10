# Navigation release verification

Studio 0.42.1 / plugin 0.42.1, navigation 0.1.0. Rebased directly onto main
`f42cc82` after #82 released studio 0.42.0. Navigation is the only new feature; release checks inherit main’s fixes;
paid parts is inherited from main rather than stacked branch commits.
Released changelog sections are byte-identical to main.

This is now the next free version after main 0.42.0. If main advances, rebase and run
`node scripts/renumber-release.mjs`. It chooses the next studio and plugin patch
versions from fetched origin/main. Explicit slots are also supported:
`node scripts/renumber-release.mjs 0.42.1 0.42.1`.
It updates packages/studio/package.json, packages/studio/worker/version.mjs,
.claude-plugin/marketplace.json, plugins/homie/plugin.json and its .claude-plugin,
.codex-plugin and .grok-plugin copies, CHANGELOG.md, packages/studio/CHANGELOG.md,
packages/studio/lib/template-history.json, template/package.json,
template/studio.json and package-lock.json using the repository generators.

## First publication

Navigation is private; scripts/publish.mjs skips private workspaces. No public
workspace depends on navigation, including studio. The publisher itself is unchanged.
A regression test invokes the real CI publish command with a fake npm registry and
proves that studio publishes without even looking up the private package.

After merge, from clean main with npm login completed, run:

```sh
node scripts/first-publish-private.mjs nav
```

This installs and builds, packs the package, removes private only in a temporary
copy, dry-runs and publishes that copy, then registers trusted publishing for
homie-rocks/homie / publish.yml / environment npm. The checkout stays private.
If trust registration fails after publication, finish that registration on npm;
do not republish the existing version. Only after it succeeds, remove private
from packages/nav/package.json, change the private assertion in
packages/nav/test/contract.mjs to expect undefined, regenerate package-lock.json,
and check `node scripts/publish.mjs --check --strict` before merging activation.
No npm publication, deployment or merge is performed by this PR refresh.

## Validation

On main `91be345` (studio 0.38.0), npm ci, npm run build, plugin tests
(120 passed, one optional skip), validation, desktop packaging and changelog
checks passed. Publish check passed: studio 0.38.1 is the only new version,
22 packages are already on npm, and private navigation is excluded. Released changelog bytes remain identical to main. The changelog
test preserves the already-released 0.38.0 section, which shipped without a PR
link, rather than rewriting that history.

The MCP integration test now follows a running build job to its result. The full
package suite schedules one test file at a time so browser timing tests do not
compete with other test files in the same run. All assertions remain unchanged.

A full Chrome-enabled local run during the refresh completed 2,386 tests: 2,374 passed,
nine environment skips, and three failures representing two scenarios (one
prediction subtest and its parent, and an input-receipt timestamp comparison).
Both scenarios passed unchanged focused reruns. The action case measured
161 ms median and 174 ms at the 95th percentile, within its 170/220 ms limits.
A separate CPU/browser stress job was active during the failures. The failed
run is retained as evidence, not recorded as a passing gate. Final full-suite
and CI results are maintained in [PR #75](https://github.com/homie-rocks/homie/pull/75).

Earlier complete runs before main 0.38.0 passed on the independent branch and on
main 0.37.2. Historical extended navigation stress measurements remain in the
package README; they are not claimed as newly rerun here.

Both Node 22 and Node 24 CI reproduced the input-receipt race. The playability
checker now waits for the final drag position to be delivered, then freezes its
receipt before measuring the game response. A regression delays that final event
by 250 ms after acknowledging the command: it fails with the original checker and
passes with the fix. The 600 ms response limit and negative controls are unchanged.
A subsequent local matrix passed the earlier failed scenarios but found one
1.24 cm backward step in the 300 ms / 10% loss / 60 Hz browser case (limit 1 cm).
This intermittent prediction result is retained in the PR's gate evidence.


Rebased again onto main 39f2cd9 after the prediction release-gate fix (#81), retaining studio 0.38.1/plugin 0.39.1. Main now owns the asynchronous MCP-build check. The touch regression retains both main’s delivered-event assertion and the delayed-final-delivery check. Fresh gate evidence is recorded in /tmp/homie-refresh-75-main81/ and the PR description.


Latest refresh: main 9e3ac4d (studio 0.39.0). Main now contains the touch-delivery, MCP and changelog fixes, so this branch inherits them without additional changes. The 39f2cd9 run had no assertion failures before being stopped when main advanced. Fresh full gates are recorded in /tmp/homie-refresh-75-main39/ and the PR description.

Latest full validation on 9e3ac4d: npm ci, clean build, npm test (2,424 tests: 2,415 passed, nine environment skips, zero failures), plugin tests (120 passed, one optional skip), validate, desktop, changelog and publish checks all passed. Publish plans studio 0.39.1 only, with 22 packages already on npm and navigation excluded. CI results are recorded in the PR description.


Current base is main eb907d3 (studio/plugin 0.40.0), with navigation reserving studio/plugin 0.40.1. Released changelog sections are preserved exactly. The renumber helper now handles equal old studio/plugin versions and distinct new versions independently; regression tests fail against its old implementation. Fresh gate evidence is in /tmp/homie-refresh-75-main40/ and the PR description.

All eight requested gates passed on main eb907d3: full suite 2,529 total, 2,517 passed, 12 environment skips, zero failures; plugin 120 passed/one optional skip. Publish planned only studio 0.40.1 with navigation private. Main advanced to 0.42.0 before this refresh was pushed, requiring another rebase.

Current refresh: independently based on main f42cc82 (studio/plugin 0.42.0), reserving studio/plugin 0.42.1. Main’s customer MCP/functions changes are inherited. Fresh gate logs are in /tmp/homie-refresh-75-main42/; final results belong in the PR description.

All eight requested gates passed on main f42cc82: full suite 2,554 total, 2,542 passed, 12 environment skips, zero failures; plugin 120 passed/one optional skip. Publish plans studio 0.42.1 only, with 22 existing packages and navigation excluded. Final CI and tagged-head evidence are maintained in the PR description.
