# PR #161 — round 2 proof

2026-10-16. All images capture only the isolated local preview pages. No desktop or existing
browser session was read. One owned headless Chrome is launched and closed in `finally`.
System load was checked before browser work and each measurement; observed load stayed below 7.

## Result

Checklist: pending → confirming → done (actual consequence) → undone (restored state).
The booking becomes available again with a fresh server-issued pending proposal; undo without
one leaves an “Undone” button disabled. Irreversible proposals are labelled before confirming.
Existing role/origin adapter, uncertain-outcome lock and duplicate-tap protection remain.

Map: 192-segment smooth terrain, original 512×512 heightmap, sun/hemisphere lighting,
vertex cavity shading, sky dome/haze, animated depth-coloured water/foam, glowing draped tube
with instanced moving highlights, leader labels with collision avoidance, interruptible intro.
Lite selection uses sustained measured slow frame intervals; reduced motion stops animation.

## Measurement

Chrome 155 / macOS arm64 / ANGLE Metal Apple M4. **4× CPU throttle in all three runs**, DPR 1,
120 frames rotating the real map. Phone viewport 390×844; TV viewport 1920×1080.
These are CPU-emulated phone measurements on a desktop GPU, not physical-phone results.
Frame intervals include scheduling; renderer CPU duration is not GPU duration.

| View | Canvas pixels | Frame median / p95 ms | Render CPU p95 ms | Triangles | Draw calls |
| --- | --- | --- | --- | --- | --- |
| Phone | 350×549 | 16.7 / 16.8 | 1.6 | 85,818 | 8 |
| TV | 1800×756 | 16.7 / 16.8 | 1.1 | 85,850 | 9 |
| Lite phone | 350×549 | 16.7 / 16.8 | 0.9 | 30,554 | 9 |

Nine geometries and two renderer textures in each view. No shadow maps or postprocessing
render targets. Lite reuses terrain buffers with a coarser index and caps DPR at 1.
The fallback integration check injects slow RAF timestamps without burning CPU, then restores
native RAF **before** measuring lite performance. Pure logic tests cover the threshold too.
Reduced-motion rendering produces zero recurring idle frames. Offscreen/hidden views pause.

## Evidence and reproduction

- [Phone checklist](checklist-phone.png), [desktop checklist](checklist-desktop.png), [confirming state](checklist-confirming.png).
- [Phone terrain](terrain-phone.png), [TV terrain](terrain-tv.png), [lite phone terrain](terrain-lite-phone.png).
- [Raw measurement](receipt.json), [browser checks](browser-check.txt), [logic tests](logic-tests.txt), [build](build.txt).

`node scripts/generate-part-heightmap.mjs` regenerates original example elevation data.
`node scripts/build-shared-parts.mjs` bundles and rehashes through canonical parts tooling.
`node --test packages/studio/test/shared-parts.test.mjs` runs six fast logic/packing/security tests.
`node scripts/check-shared-parts.mjs` runs one browser and writes evidence here. It exercises
keyboard confirmation, progress status, undo with/without restored proposal, irreversible
refund, duplicate/uncertain locks, escaping, phone overflow, camera buttons/keys, real CDP
pinch, TV canvas, automatic lite transition, reduced motion, cleanup and browser errors.

The older round-1 receipt and screenshots are retained under `baseline/` for comparison.
