# Navigation release verification

Studio 0.38.1 / plugin 0.39.1, navigation 0.1.0. Rebased directly onto main
`91be345` after #77 released studio 0.38.0. The diff adds navigation only;
paid parts is inherited from main rather than stacked branch commits.
Released changelog sections are byte-identical to main.

This is now the next free version after main 0.38.0. If main advances, rebase and run
`node scripts/renumber-release.mjs`. It chooses the next studio and plugin patch
versions from fetched origin/main. Explicit slots are also supported:
`node scripts/renumber-release.mjs 0.38.1 0.39.1`.
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

The latest full Chrome-enabled local run completed 2,386 tests: 2,374 passed,
nine environment skips, and three failures representing two scenarios (one
prediction subtest and its parent, and an input-receipt timestamp comparison).
The input-receipt check passed an unchanged focused rerun. The prediction action
case still exceeded its median response limit while an unrelated CPU/browser
stress job was active. Its movement assertions passed. These timing failures
remain under investigation; this run is not recorded as a passing gate.

Earlier complete runs before main 0.38.0 passed on the independent branch and on
main 0.37.2. Historical extended navigation stress measurements remain in the
package README; they are not claimed as newly rerun here.
