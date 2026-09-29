# @homie-rocks/render

The rendering layer of a three.js game, as separate modules: what the GPU can
really do and which quality tier follows, the texture budget and shader pre-warm
that must be right before the first frame, the pipeline that owns
`renderer.render()`, and the shader patches, lighting terms, shadow machinery
and texture bakers three.js does not ship. It never knows what a game draws, and
it ships no look: every colour, distance and tuning number is the game's.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/render@0.1.0 three@0.185.1 postprocessing@6.39.3 simplex-noise@4.0.3
```

`@homie-rocks/device` and `@homie-rocks/noise` are dependencies; npm installs
them. `three` is a peer dependency on purpose: two copies of three.js are two
`ShaderChunk` tables, and a patch applied to one is invisible to the other.

## Use

There is no barrel file. Import the module you need as
`@homie-rocks/render/<Module>.js`.

```js
import { createSettings } from '@homie-rocks/render/settings.js';
import { glCapabilities } from '@homie-rocks/render/caps.js';
import { hexToLinear, inverseAces } from '@homie-rocks/render/colour.js';

// The tier this device can take ('auto' = no saved choice; `?quality=` wins),
// and what it turns on: settings.shadows, settings.bloom, settings.maxPixelRatio...
const settings = createSettings('auto');
const caps = glCapabilities(); // what the driver really does, probed once
if (!caps.halfFloatRenderable) console.warn('no float colour buffer: 8-bit post chain');

// Author a colour as the value it must DISPLAY, then solve for the linear
// radiance that ACES maps onto it at exposure 1.
const target = new Float64Array(3);
const radiance = new Float64Array(3);
hexToLinear(0x8fa3b8, target);
inverseAces(target, 1.0, radiance, 1e-4, 1e-6);
```

## Modules

| module | what it does |
|---|---|
| `caps.js` | probes what the WebGL2 driver really supports, picks a quality tier, and holds each tier's presets and pixel budget |
| `settings.js` | resolves the tier and the render settings for this device and window |
| `Textures.js` | the process-wide texture budget, canvas and field staging, Sobel normals, ORM packing and upload rules |
| `Prewarm.js` | compiles every program, the shadow-depth pass and the vertex uploads before the first frame, so nothing compiles mid-play |
| `pipeline.js` | `RenderPipeline`: owns the `WebGLRenderer` and the post-processing composer, resolution and presentation |
| `drawbudget.js` | static batching, group LOD and shadow-caster relevance, to keep a frame inside its draw-call budget |
| `cascade.js` | cascaded shadow maps for a fixed key light: per-cascade PCF with a receiver-plane bias, and texel snapping |
| `cascadederiv.js` | the same for a key light that moves, with the bias measured from screen-space derivatives |
| `lightpool.js` | a fixed pool of real point lights handed out by importance, so the light count never changes and nothing recompiles |
| `LineLight.js` | analytic strip lights: a closed-form diffuse term plus a stretched specular highlight |
| `GeoWear.js` | oxide, worn edges, frost and age read off the geometry, even on a material with no maps and no UVs |
| `colour.js` | ACES forward and inverse, sRGB encode and decode, and colour helpers that import nothing |
| `heightfog.js` | aerial perspective through an exponential atmosphere, as replacements for three's fog chunks |
| `impostor.js` | bakes a built vehicle into one vertex-coloured far-LOD mesh that is also its only shadow caster |
| `canvastex.js` | the 2D-canvas texture kit: value noise, alpha cut-out sheets with coverage-preserving mips, surface maps |

And 88 more in `src/`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
