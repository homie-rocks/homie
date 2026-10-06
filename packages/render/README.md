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
| `tiers.js` | `GAME_TIERS`, `extendTiers`, `tierName`, `tierPixelRatio`, `tierPropCount`: High, Medium and Low as a table of what each spends, for a game to extend |
| `dynres.js` | `DynamicResolution`, `drawAtScale`, `bufferSize`: dynamic resolution as a state machine over frame times, with a floor, a hold, fast recovery and a revert |
| `lodprops.js` | `LodProps`, `sortLod`, `LOD_BANDS`, `decimateGeometry`, `autoLo`: one prop as a full and a low instanced mesh, re-sorted by camera distance, tinted per instance |

And 88 more in `src/`.

## Quality tiers and dynamic resolution

`tiers.js` is a table: what High, Medium and Low each spend on pixel ratio,
MSAA, bloom, lights, prop density and draw distance. Add your own columns with
`extendTiers` (all three tiers or it does not compile). `dynres.js` moves the
resolution under that cap: it drops only after two seconds of slow frames,
gives sharpness back quickly, takes a drop back when it bought no time (the
frame was not bound by pixels), and backs off instead of swinging. It reads no
clock, only the frame times it is fed, so it is tested with a scripted series.

```ts
import { GAME_TIERS, extendTiers, tierName, tierPixelRatio } from '@homie-rocks/render/tiers.js';
import { DynamicResolution, bufferSize, drawAtScale } from '@homie-rocks/render/dynres.js';

const TIERS = extendTiers({ high: { grass: 40000 }, medium: { grass: 15000 }, low: { grass: 0 } });
const tier = TIERS[tierName(settings.quality)];
const dynres = new DynamicResolution({ // every number is yours
  floor: 0.6, ceiling: 1, step: 0.85, slowMs: 20, fastMs: 17.5, smoothMs: 150, hitchMs: 250,
  holdMs: 2000, recoverMs: 500, settleMs: 200, trialMs: 1000, helpedMs: 1.5, lockoutMs: 10000,
  regretMs: 4000, backoffMax: 8,
});
const size = { width: 0, height: 0 };

function frame(dtMs: number): void {
  dynres.frame(dtMs);
  // The resize runs immediately before the draw, so a cleared buffer is never shown.
  drawAtScale(dynres, (scale) => {
    bufferSize(innerWidth, innerHeight, tierPixelRatio(tier, devicePixelRatio, 1), scale, size);
    renderer.setSize(size.width, size.height, false);
  }, () => renderer.render(scene, camera));
}
```

## Props at two levels of detail

`lodprops.js` draws one kind of prop as two instanced meshes, the full model
near and a low one far, in two draw calls for the whole set. `update` re-buckets
by camera distance and writes each bucket nearest first. The bands (where the
low model takes over, where drawing stops, what share of the set is kept) are
data per tier, and each instance carries its own tint.

```ts
import { LOD_BANDS, LodProps, autoLo } from '@homie-rocks/render/lodprops.js';

// The low model: a decimated file from your asset pipeline (`homie-studio assets add … --lo 0.2` writes
// <asset>_lo.glb beside the model, the same height on the same pivot), or made here at load.
const rocks = new LodProps(rockGeo, autoLo(rockGeo, 0.2), rockMaterial, 2000, { spread: 600 });
scene.add(rocks.group);
for (const r of placements) rocks.add(r.matrix, zoneColour[r.zone]);

function frame(): void {
  rocks.update(camera.position.x, camera.position.y, camera.position.z, LOD_BANDS[tierName(settings.quality)]);
}
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
