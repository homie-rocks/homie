# @homie-rocks/heightfield

A regular grid of heights and the questions a game asks of one: clamped
bilinear and nearest fetch, a central-difference normal and slope angle,
band-limiting before a coarser sample, a horizon bake for sky view and
never-lit cells, and the skirted index of a chunked-LOD tile. It is pure
arithmetic over typed arrays and imports nothing, not even `three`, so a Node
script can ask what is under a point without a scene graph. It does not
generate terrain, and it does not know what a crater, a lake or a material is:
every number that describes a particular world is an argument.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/heightfield@0.1.0
```

## Use

```ts
import { CentredGrid, centralNormal } from '@homie-rocks/heightfield/Field.js';

// 257 posts, 2 m apart, post 0 at -256 m on both axes.
const grid = new CentredGrid(257, 2, 256);
const heights = new Float32Array(grid.n * grid.n); // fill from your generator

const ground = { heightAt: (x: number, z: number) => grid.sample(heights, x, z) };

const y = ground.heightAt(10, -40);
const normal = centralNormal(ground, 10, -40, grid.step, { x: 0, y: 0, z: 0 });
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Field.js` | `HeightField`, clamped `bilinear` / `bilinearRect` / `nearestIndex` fetch, `CentredGrid`, `centralNormal`, `slopeAngle`, `footprintFloor` |
| `Filter.js` | `binomial5` band-limiting, `boxBlur2D`, `smooth3x3` and `smoothMasked3x3` mask smoothing |
| `Horizon.js` | `horizonBake`: sky-view factor and never-lit mask by a geometric horizon march |
| `Mesh.js` | `skirtedGridIndex` with alternating diagonals and outward-wound skirts, `skirtVertex` addressing |
| `Chunk.js` | `fillChunkGrid` / `fillStaticGrid` positions and normals, `copyChunkSkirt` / `copyStaticGridSkirt` |
| `Ring.js` | `ringFrame`: a log-spaced square annulus for the far field |
| `Sight.js` | `sightBlocked`, `escapeFraction` and `groundUnderRay` by marching the field |
| `Grade.js` | `gradeSite` (level a pad with a batter), `ringPlaneFit`, `smoothDisc` |
| `Distance.js` | `dilateMax` and a `chamferSweep` distance transform that carries an attribute |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
