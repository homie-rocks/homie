# Navigation release verification

Studio 0.44.2 / plugin 0.44.2, navigation 0.1.0. Rebased directly onto main
`ed77f97d` after #84 released studio 0.44.1. Navigation is the only new feature; release checks inherit main’s fixes;
paid parts is inherited from main rather than stacked branch commits.
Released changelog sections are byte-identical to main.

This is now the next free version after main 0.44.1. If main advances, rebase and run
`node scripts/renumber-release.mjs`. It chooses the next studio and plugin patch
versions from fetched origin/main. Explicit slots are also supported:
`node scripts/renumber-release.mjs 0.44.2 0.44.2`.
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

All eight requested gates passed on main ed77f97d: npm ci, clean npm run build,
CHROME_PATH-enabled npm test (2,559 total, 2,546 passed, 13 environment/opt-in
skips, zero failures), npm run test:plugin (123 passed, one optional skip),
npm run validate, node scripts/desktop.mjs --check,
node scripts/changelog.mjs --check, and node scripts/publish.mjs --check.
Publish plans studio 0.44.2 only, with 22 existing packages and navigation
excluded. Logs are in /tmp/homie-refresh-75-main441/. Final tagged-head and CI
results are maintained in [PR #75](https://github.com/homie-rocks/homie/pull/75).

The renumber helper preserves base-version references in upgrade notes while
updating the release heading and plugin version. Its regressions fail against
the previous implementation and pass with the fix. It also handles different
studio/plugin versions independently. Browser suites run one file at a time.
