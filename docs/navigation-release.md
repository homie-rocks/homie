# Navigation release verification

Studio 0.37.3 / plugin 0.38.3, navigation 0.1.0. Rebased directly onto main
`1dadfa6` after #74 was squash-merged. The branch contains navigation only;
paid-parts code, changelog section and template fingerprints were dropped.
Released changelog sections are byte-identical to main.

The version reserves the slot after #70. After #70 merges, rebase on main and run
`node scripts/renumber-release.mjs`. It chooses the next studio and plugin patch
versions from fetched origin/main. Explicit slots are also supported:
`node scripts/renumber-release.mjs 0.37.3 0.38.3`.
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

The requested gates ran sequentially on this independent branch. Install, build,
the full Chrome-enabled suite (1,566 passed, six environment-dependent skips,
zero failures, 864.3 seconds), plugin tests (118 passed, one optional skip),
validation, desktop packaging and changelog checks passed. The local skips require
Wrangler, Stripe mock or an explicit Miniflare path. Publish check also passed:
one studio version to publish, 22 already on npm, navigation excluded.
Historical navigation stress and CPU measurements remain in the package README;
those extended sweeps are not claimed as newly rerun here.
