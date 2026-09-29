# @homie-rocks/noise

Procedural noise and scalar fields on the CPU, for baking textures and
scattering things. The field builders write seamlessly tiling values into flat
`Float32Array`s of `size * size` (row-major, top-left origin): fbm, ridged and
turbulence noise with domain warp, voronoi cells, brick and board layouts,
strata, patches, panel splits and wear masks from a height field. Beside them
sit seeded hashes and a `mulberry32` PRNG, noise that wraps on a sphere or a
torus, and a table of surface micro-detail families stated in millimetres of
world. It knows octaves, lacunarity, a seed and a surface family; it knows
nothing that has a position in a world, and it does not touch the GPU.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/noise@0.1.0 simplex-noise@4.0.3
```

## Use

```ts
import { fbmField, microSurface, microRough, mulberry32 } from '@homie-rocks/noise/Noise.js';
import { fbmTorus } from '@homie-rocks/noise/Periodic.js';

const size = 256;
const height = fbmField(size, { freq: 4, octaves: 5, mode: 'ridged', seed: 7 }); // tiles, 0..1

// Roughness for a 2 m concrete tile: the family's own grain, around a base of 0.8.
const micro = microSurface(size, 2, 'concrete', 1);
const rough = new Float32Array(size * size);
for (let i = 0; i < rough.length; i++) rough[i] = microRough(micro, i, 0.8);

const rand = mulberry32(42);            // seeded, repeatable
const v = fbmTorus(0.25, 0.75, 8, 4, 3); // one sample of noise that wraps in u and v
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Noise.js` | tiling field builders (`fbmField`, `voronoiField`, `brickField`, `strataField`, `patchField`, `bspPanelField`, `macroField`), wear masks (`curvatureField`, `cavityField`, `exposureField`, `placementFields`), the `MICRO` surface table with `microSurface` / `microRough` / `microDetail`, and `mulberry32`, `hash2`, `simplex2` / `simplex3` |
| `Periodic.js` | value noise that wraps in x for equirectangular spheres (`valueNoise2`, `fbm2`, `ridged2`), in both axes (`valueNoiseTorus`, `fbmTorus`, `gradFbmTorus`, `bandField`), and named hash streams |
| `Field.js` | octave stacking over a basis you supply (`fbmOctaves`, `ridgedOctaves`), `azimuthalNoise` that closes at 2π, `powerLawDraw` for size-frequency scatter |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
