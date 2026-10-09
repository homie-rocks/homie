# Physics release verification

Studio **0.37.4**, plugin **0.38.4**, physics **0.1.0**. Merge after #75, which follows #74 and #70. The code is rebased onto navigation’s verified `742390a`; main is `51227fc`.

Physics is optional for games and apps; it requires no game manifest or multiplayer room. Apps, the keyless visible Shop, first-run improvements, paid parts and navigation remain available. The packed scene trial supports `--app` and runs the full studio build. Earlier template fingerprints and released changelog sections are preserved.

## Gates

All eight commands ran sequentially and passed: npm ci, build, full npm test, plugin tests, validation, desktop, changelog and publish checks. The full suite used real Chrome and Stripe mock v0.206.0: **3,851 tests, 3,850 passed, one optional rules/workerd configuration skip, zero failures**, 3,169.6 seconds. Plugin tests: **119 tests, 118 passed, one optional skip, zero failures**. Desktop answered **68 tools and five cards**. Publish check reports **one version to publish, 22 already on npm, two deferred until bootstrap**.

Physics installs a local Wrangler, so the full suite also runs the room-update Chrome integration proof. That proof intentionally schedules 130 updates over roughly 19 minutes. The package’s existing serial test command is retained. Extended physics stress sweeps and CPU tables in the package README are historical measurements, not newly rerun sweeps claimed by this refit.

## Trials

A fresh temporary app-only studio installed the packed toolkit, physics and heightfield. Its full studio build produced the physics app with its owned WebAssembly engine. Real Chrome measured **60.003 fps over 599 sampled frames**, 16.7 ms p95 frame time and **0.6 ms p95 physics time**, with a grounded character, falling props and zero page errors. The browser/server closed and the copy was deleted.

The packed 0.37.4 toolkit built a separate temporary copy of `/Users/ryan/Studios/homie-arcade` without node_modules. All five games passed the same real-Chrome checks as main: 2048 Race (121.4 s), Asteroids Arena (121.5 s), Bone Burglar (152.0 s), Octree Arena (121.5 s), Tiny Platformer (121.6 s), at 60–61 fps. Its server stopped and the copy was deleted; the original was untouched.

## Publication and history

Both navigation and physics are new npm packages. A maintainer must publish each once after merge and register its trusted publisher, following `scripts/first-publish.sh`. The release check reports the missing bootstrap and defers new packages and their dependents; the independent studio release can proceed. No npm publication was attempted.

The old physics PR had a failing DCO check for 32 commits using invalid automation email addresses. Physics-only changes are consolidated into a signed-off commit under the repository’s configured identity, retaining the preceding release commits. The original branch is retained locally as `backup/physics-before-release-refit`.

All temporary studio copies are deleted after their trials. The original arcade is untouched. Nothing was deployed or merged.
