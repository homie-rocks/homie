# @homie-rocks/scatter

Placement policy for procedural worlds: where a thing may go, not what it looks
like. A disc register that refuses a spot already taken, a capsule keep-out
along a polyline, a lowest-point ground snap, arc-length stepping, weighted
quotas, crowd formations and deterministic seeded layouts. It knows metres,
radii and chords; it does not know a boulder, a mast or a crater, and it
imports nothing, not even three, so it runs in Node with no scene graph.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/scatter@0.1.0
```

No dependencies.

## Use

```ts
import { KeepOut } from '@homie-rocks/scatter/keepout.js';
import { Corridor } from '@homie-rocks/scatter/corridor.js';

const taken = new KeepOut();
// A road as a polyline in XZ, with an 8 m keep-out either side.
const road = new Corridor([0, 100, 200], [0, 40, 0], 8);

for (let i = 0; i < 500; i++) {
  const x = Math.random() * 400 - 200;
  const z = Math.random() * 400 - 200;
  if (taken.blocked(x, z, 2) || road.blocked(x, z, 2)) continue;
  taken.claim(x, z, 6);
  // place a 6 m rock at (x, z)
}
```

Every function takes the caller's own RNG or seed where it draws, and each file
documents its draw order, so a seeded world rebuilds identically.

## Modules

| module | what it does |
|---|---|
| `keepout.js` | `KeepOut`: a register of claimed discs; `blocked`, `clear`, `coveredAhead` |
| `corridor.js` | `Corridor`: a keep-out measured to a polyline's segments, not its points |
| `discindex.js` | `DiscIndex`: a uniform-grid broadphase over items with a reach |
| `ground.js` | `footprintLow`: found an object on the lowest ground under its footprint |
| `stride.js` | `strideSegments`, `firstCrossing`: equal-chord stepping along a span |
| `polyline.js` | `segmentAt`, `polylinePoint`, `polylineDelta`: sample a route at t |
| `ring.js` | `ladderFit`, `ringSlots`, `majorityRing`, `LoopMask`: rings of backdrop slots |
| `azimuth.js` | `AzimuthMask`: which bearings from a centre may be built on |
| `quota.js` | `zoneTickets`, `quotaFirst`, `takeWeighted`: which candidates get built |
| `banks.js` | `BankRun`: lines that run in banks and gaps rather than a coin flip per step |
| `formation.js` | `fileAlong`, `arcFacing`, `queueFrom`, `fileBetween`: groups of bodies |
| `relax.js` | `relaxOverlap`: one symmetric pass pushing overlapping bodies apart |
| `bayload.js` | `bayLoad`: fill a rectangular bay from one end from a single seed |

and 3 more in `src/` (`chain.js`, `pairs.js`, `rota.js`).

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
