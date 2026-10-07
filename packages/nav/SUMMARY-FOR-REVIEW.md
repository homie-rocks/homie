# Navigation 0.1.0 review

Implemented `@homie-rocks/nav` in `packages/nav`. Outside this package, only the
root workspace list, TypeScript reference list and dependency lockfile changed.
Other package versions and CHANGELOG.md were not changed. Work is committed on
the current branch with sign-offs; nothing was pushed and no pull request opened.

## Decisions

- Wrap MIT-licensed navcat 0.4.1, with its exact mathcat 0.0.12 dependency, for
  Recast/Detour-style baking, polygon queries and crowds. Compatible with this
  Apache-2.0 package. TypeScript permits synchronous loading and complete
  inspectable snapshots in all three runtimes. Recast WASM was considered but
  not installed or runtime-tested; its loader and opaque simulation state add
  complexity that this implementation avoids.
- Use world metres and Y up, matching heightfield/walk. Triangles support stacked
  floors; a heightfield adapter samples its actual height function with no skirts.
- Bake independent XZ tiles with a clearance halo and shared configuration.
  Store finished polygons and pristine compact spans as versioned bytes. Static
  loading decodes polygons; obstacle edits rebuild affected tiles from spans.
- Keep all state in plain numeric records/arrays. A graph codec retains aliases
  in search heaps, special IEEE values and typed arrays. Complete crowd snapshots
  include mesh, links, obstacles, queued searches and off-mesh traversal progress.
- Caller owns fixed ticks and seeded random choices. No DOM, renderer, native
  addon or I/O in core. Temporarily disable upstream rasterizer profiling hooks
  synchronously to prevent clock access, restoring in finally. This workaround
  and the byte format are pinned to the backend version.
- Flat games get deterministic four-neighbour A* with uniform costs and exact
  shortest grid routes. Optional JPS is omitted to avoid another unneeded search
  implementation. Mesh routes use polygon A* and funnel straightening, with the
  usual corridor approximation rather than a global continuous-geodesic proof.
- Runtime obstacles are boxes; directed/bidirectional links represent jumps and
  doors. Local avoidance uses the upstream sampled velocity solver. Navigation
  does not replace collision, jump physics or gameplay permissions.

The README explains the reasons, tuning, tile halo contract, loading in Node,
browsers and Workers, snapshot semantics and limits in detail. It includes
executable heightfield/walker and fifty-agent doorway examples; both ran to
completion on this machine.

## API

- `Bake.js`: `BakeConfig`, `Triangles`, `Obstacle`, `heightfieldTriangles`, `bakeTile`.
- `Mesh.js`: tile load/unload; path, nearest reachable, seeded random reachable and
  nav ray queries; obstacle add/remove; link add/remove/enable; save/restore.
- `Crowd.js`: fixed-step crowd; add/remove, target/stop, agent position/velocity,
  arrival check, step, save/restore including the associated mesh.
- `Grid.js`: same query interface, mutable blocked cells and save/restore.
- `Query.js`: `NavigationQuery`, `Point`, `Path`, `Ray`.
- `Random.js`: integer seeded generator with a one-word typed-array state.
- `State.js`: internal versioned graph codec, normally used through class methods.

## Verification and output

Commands ran from the repository root. npm used a writable temporary cache
because the default cache is outside the sandbox's writable locations.

```text
npm ci
added 101 packages, and audited 126 packages in 9s
found 0 vulnerabilities

npm run build
> build
> tsc --build
(exit 0)

node --test packages/nav/test/*.test.mjs
# tests 28
# pass 27
# fail 0
# skipped 1

node --test [all engine packages' test/*.test.mjs]
# tests 174
# pass 173
# fail 0
# skipped 1

npm pack --workspace=@homie-rocks/nav --dry-run --json
name: @homie-rocks/nav, version: 0.1.0
39 files, 146738 unpacked bytes

npm run leaks
LEAK AUDIT — CLEAN
```

The skipped test is automated Chrome, opt-in through CHROME_PATH. The portable
fixture also ran in the existing Safari browser via `test/browser-check.mjs`:

```text
PASS: browser matches Node, 1565773 characters including baked bytes and restored crowd state
workerd: exact state match
README examples: PASS
```

The same workload bakes, carves, queries, samples from a seed, steps eight agents
and saves/restores while Math.random, Date.now and performance.now throw. Local
workerd runs without Node compatibility. Safari and Node produced the same full
serialized output. This proves the tested fixture, not every engine/version.

Behaviour tests cover dimensions, radius clearance, step and slope limits,
headroom, stacked floors, tile stitching/unloading/reloading, links reconnecting
on tile reload, directed and disabled links, overlapping obstacles and removal,
reachable components, floor-aware rays, grid A* against a BFS oracle, walking to
a target, fifty agents crossing a doorway with separation, exact repeated seeded
runs, and restore during sliced searches, off-mesh traversal and replanning.

**The full repository `npm test` is not green in this environment.** It was run
and reached the existing studio browser tests, where Chrome cannot launch from
the sandbox. Its browser harness leaves an open handle, so the aggregate run
stops reporting results and was interrupted. A focused reproduction reported:

```text
node --test --test-timeout=30000 packages/studio/test/art-mcp.test.mjs
ok 1 - art tools: listed with their cards; ...
not ok 2 - the style board card in a browser: ...
error: Failed to launch the browser process: Code: null
code: ERR_TEST_FAILURE
```

Repeating the aggregate run with timeout/force-exit flags did not close that
existing harness. No other package was edited to change its tests or skip logic.
The separate complete engine-package run above is green. A host able to launch
Chrome is still needed for the full repository suite.

## Performance

Apple M4, Node v22.22.2, 2026-10-07; standalone
`node --test packages/nav/test/performance.test.mjs`:

| measurement | result |
|---|---:|
| 61,952-triangle full tile bake median | 137.03 ms |
| path query median / p95 | 0.0129 / 0.0357 ms |
| 300 moving agents, step median / p95 | 2.876 / 3.405 ms |
| baked tile size | 4,604,150 bytes |

The README gives warm-up/sample counts. These measurements include real work and
have no hardware-dependent pass threshold. They do not promise production
Worker CPU budgets or mobile frame rates.

## Not done and known limits

No cloud deployment, rooms-rule adapter, Z-up conversion, three.js importer or
debug renderer, asynchronous scheduler, asset compression, custom area costs,
cylinder obstacles, grid crowd steering, JPS, moving platforms or custom link
callbacks. Application code must load destination tiles, schedule fixed ticks,
manage assets and animate/validate link traversal.

Box carving is synchronous and relatively expensive. Avoid inserting boxes on
standing agents; there is no physical push-out guarantee. Crowd avoidance is
local and may overlap or congest, especially in opposing flows. Paths depend on
voxel resolution, contour simplification and snapping. Snapshots contain trusted
build/server data and are large; there is no untrusted-input schema or migration
promise across backend versions. Exposed state should be treated as read-only.

Backend floating-point/trigonometric operations mean cross-engine lockstep is
not universally guaranteed despite matching the tested Node, Safari and workerd
fixture. Keep server authority and client reconciliation. No production Worker
CPU/memory soak, mobile throughput study or broad browser-version matrix was run.
