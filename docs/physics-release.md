# Physics release verification

Studio 0.38.2 / plugin 0.39.2, physics 0.1.0. Rebased directly onto main
`91be345` (studio 0.38.0), dropping the navigation stack and inheriting paid parts
from main. The diff contains physics
and its release support only. Released changelog sections and released template
history are preserved from main.

This version reserves the slot after #75; #70 has already merged externally. After #75 merges, rebase on main
and run `node scripts/renumber-release.mjs` to choose the next studio/plugin patch.
Explicit slots are supported: `node scripts/renumber-release.mjs 0.38.2 0.39.2`.
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
existing serial test command and memory limit. Its Wrangler dependency enables the
long room-update browser proof. Extended physics sweeps and CPU measurements in the
package README remain historical measurements, not newly rerun claims.
Nothing is deployed or merged.

The first run on main 0.37.1 passed 2,975 tests with three environment skips but
reported a single emote subtest failure (and its parent): one relay drop. The test
now waits for each emote batch to arrive before spacing the next batch, rather
than relying on interval deadlines. The 210-emote and zero-drop assertions are
unchanged, as is the production relay. All 13 traffic-group tests passed after
that pacing fix. The full suite subsequently passed on main 0.37.2: 3,672 passed, five environment skips, zero failures (3,426.4 seconds). That run included the real 130-update browser proof and a temporary tag at the branch's own studio version; the rolling-upgrade test selected an older version correctly. The temporary tag was removed and never pushed.

After main advanced to 0.38.0, physics was rebased directly on it and renumbered.
The released changelog stays byte-identical to main, including 0.38.0's missing
PR link; its test preserves that released exception. The MCP test follows a
running build job to its result. The playability checker waits for actual delivery
of the final touch-drag event before measuring the response; its regression
reproduces delayed delivery without changing the 600 ms bound. These shared
release-check fixes are the ones verified on navigation; navigation itself is
not included. Final gate and CI results are maintained in
[PR #76](https://github.com/homie-rocks/homie/pull/76).

The full Chrome-enabled suite on main 0.38.0 passed: 3,788 passed, six environment
skips, zero failures (5,692.9 seconds). This includes all 37 prediction cases,
the actual delayed-touch regression, the zero-drop emote proof, and 130 real
room updates with players and a watcher (1,490.1 seconds). Install and a clean
build also passed. Final remaining-gate and CI results are recorded in the PR.

The remaining local gates passed: plugin tests (120 passed, one optional skip),
validation, desktop packaging, changelog and publish checks. Publish plans only
studio 0.38.2; 22 packages are already on npm and private physics is excluded.
