# Navigation release verification

Studio **0.37.3**, plugin **0.38.3**, navigation **0.1.0**. Merge after #70, which follows #74. The branch is rebased onto #70’s verified `a9492bf`; main is `51227fc`.

Navigation is optional for games and apps. It requires no game manifest, room or renderer. Main’s apps, app cards, visible keyless Shop, simpler first run and paid parts remain available. Generated template and lockfile are refreshed. Earlier template fingerprints and released changelog sections are unchanged.

## Gates

All commands ran sequentially. `npm ci`, `npm run build`, `npm run validate`, desktop, changelog and publish checks passed. The ordinary suite used real Chrome and Stripe mock v0.206.0: **2,271 tests, 2,267 passed, four optional environment-dependent skips, zero failures**, 688.2 seconds. Plugin suite: **119 tests, 118 passed, one optional skip, zero failures**. Desktop answered **68 tools and five cards**.

The first local run found stale incremental TypeScript output older than a rebase-touched source. A forced navigation rebuild preceded the final full run. No assertion or time threshold changed.

Publish check reports **one version to publish, 22 already on npm, one deferred until bootstrap**. It explicitly names navigation’s required first publication by a maintainer. Follow `scripts/first-publish.sh` after merge to publish the package once and register its trusted publisher. The workflow defers new packages and their dependents while releasing independent packages. Four tests cover that selection, including the release command against a fake npm executable. Nothing was published in this verification.

## Packed navigation in an app

A new temporary studio installed both packed packages. Its navigation scene lived in `apps/navigation/app.json` and built as an app. In Chrome 155, 30 agents found the path around a wall with repeated goals; all arrived and remained active. Restoring the mesh and crowd preserved the crowd’s saved bytes exactly. A ten-second animation-frame sample recorded **600 frames, 60.002 fps, 16.7 ms median and 16.7 ms p95**, with zero page errors. The browser and server closed and the temporary studio was deleted.

## Existing arcade studio

The packed 0.37.3 toolkit built a temporary copy of `/Users/ryan/Studios/homie-arcade`, copied without node_modules. All five games passed the same checks as main: 2048 Race (121.2 s), Asteroids Arena (121.6 s), Bone Burglar (152.3 s), Octree Arena (121.7 s), and Tiny Platformer (121.3 s), at 60–61 fps. Its server stopped and the temporary copy was deleted.

The original arcade was untouched. Nothing was deployed or merged. Historical stress and CPU measurements in the package README describe their original measurements; they are not claimed as newly rerun extended sweeps here.
