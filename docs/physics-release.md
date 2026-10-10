# Physics release verification

Studio 0.45.2 / plugin 0.45.2, physics 0.1.0. Rebased directly onto main
`5a175afb` (studio 0.45.1), inheriting the externally merged paid-parts
and navigation releases from main. The diff contains physics
and its release support only. Released changelog sections and released template
history are preserved from main.

Both #70 and #75 have merged externally. This version is the next patch after #75.
If main advances again, rebase on main and run `node scripts/renumber-release.mjs` to choose the next studio/plugin patch.
Explicit slots are supported: `node scripts/renumber-release.mjs 0.45.2 0.45.2`.
The command updates packages/studio/package.json, packages/studio/worker/version.mjs,
.claude-plugin/marketplace.json, plugins/homie/plugin.json and its .claude-plugin,
.codex-plugin and .grok-plugin copies, CHANGELOG.md, packages/studio/CHANGELOG.md,
packages/studio/lib/template-history.json, template/package.json,
template/studio.json and package-lock.json with repository generators.

## First publication

Physics has private: true. The unchanged publisher skips it, and no public package
(including studio) depends on it. A regression test runs the real CI publisher with
a fake npm registry and proves studio publishes without looking up the private package.

An npm-authenticated maintainer runs this from clean merged main:

```sh
node scripts/first-publish-private.mjs physics
```

The script installs/builds, packs physics, removes private only from a temporary copy,
dry-runs and publishes it, then registers trusted publishing for homie-rocks/homie,
publish.yml, environment npm. Afterwards remove private from packages/physics/package.json
and privateUntilPublished: true from packages/physics/test/package.test.mjs, regenerate
package-lock.json, and run `node scripts/publish.mjs --check --strict` before merging
activation. If publication succeeds but registration fails, finish registration on npm;
do not republish 0.1.0. No npm publication is performed during this refresh.

## Validation

The requested gates run sequentially on this independent branch. Physics retains its
serial test command with Node’s normal heap sizing for the expanded studio suite.
The physics-only stress command retains its own memory limit. Its Wrangler dependency enables the
real room-page browser checks; main now keeps the longer update soak opt-in. Extended physics sweeps and CPU measurements in the
package README remain historical measurements, not newly rerun claims.
Nothing is deployed or merged.

Current gate and CI results are recorded in [PR #76](https://github.com/homie-rocks/homie/pull/76).

All eight requested local gates passed on main 0.45.1. The full Chrome-enabled suite
passed 4,152 tests with 10 environment/opt-in skips and zero failures (4,252.0 seconds).
Plugin tests passed 123 with one optional skip. The publish plan contains only
studio 0.45.2, with 22 existing packages and both private workspaces excluded.
The rolling-upgrade fixture prepares archived workspace sources before building;
its 0.45.1, 0.33.0 and 0.32.1 baselines pass.
