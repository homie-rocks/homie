# @homie-rocks/postfx

Post-processing for three.js games, built on `postprocessing`: a reorderable
chain (scene, ambient occlusion, depth of field and bloom, a merged grade,
SMAA), the passes that go into it, and a capture protocol that makes two
screenshots of one held frame the same bytes. It owns no look: every
threshold, exposure, tint and clock frequency is an argument with no default,
and it never reads `window` (is the world frozen? arrives as a callback).

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/postfx@0.1.0 three@0.185.1 postprocessing@6.39.3 "n8ao@^2.0.0"
```

npm also installs `@homie-rocks/render`, the source of the chain's `Quality` tiers.

## Use

```ts
import * as THREE from 'three';
import { EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import { TintedBloomEffect } from '@homie-rocks/postfx/Bloom.js';
import { createFrameClock } from '@homie-rocks/postfx/Clock.js';

const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
composer.addPass(new RenderPass(scene, camera));
const bloom = new TintedBloomEffect({ // every field required
  threshold: 1.5, smoothing: 0.3, intensity: 0.9, radius: 0.7, levels: 6,
  tint: new THREE.Color(1, 0.95, 0.9), finiteBound: 65504, stretchAt: null,
});
composer.addPass(new EffectPass(camera, bloom));

// A grain clock that stands still while the world is held.
const clock = createFrameClock({ hz: 0.37, stride: 977, stillSeconds: 0, wrapSeconds: 600 });
function frame(dt: number, held: boolean) {
  const grainPhase = clock.advance(dt, held); // push into your grain shader
  composer.render(dt);
}
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Chain.js` | `PostFXChain`: builds the chain as ordered stages a subclass can reorder, and syncs its uniforms each frame |
| `Grade.js` | `GradeEffect`, one shader for motion blur, aberration, highlight shoulder, ACES, split tone, speed lines, vignette and grain; `ScaledDepthOfFieldEffect` |
| `Lens.js` | `LensFollower`, `RACER_LENS`, `STILL_LENS`, `CameraMotionFollower`: how the lens responds to a world, as values |
| `Clock.js` | `createFrameClock`, `wrapAudit`, `holdPassClocks`: a grain clock pinned while the world is held |
| `Capture.js` | `renderFrame`: the held-frame protocol that converges once and then presents the same image every draw |
| `Resolve.js` | `TemporalResolvePass` and `ResolveDriver`: an accumulating temporal resolve with addressable jitter |
| `Halton.js` | `halton`, `jitterAt`, `jitterIndex`: the jitter sequence as a pure function of its index |
| `Bloom.js` | `installBloomHooks`, `stretchMipChain`, `tintBloom`, `TintedBloomEffect`: anamorphic stretch, firefly guard, tint and NaN scrub |
| `Contact.js` | `ContactShadowEffect`: screen-space contact shadows and contact-scale occlusion in one pass |
| `Aberration.js` | `AberrationEffect` and `CA_SNIPPET`: lateral chromatic aberration as a pass or as shader text |
| `Film.js` | `FilmLayer`: the vignette and grain printed over the DOM as well as the canvas |
| `HeldLatch.js` | `HeldLatch`: keeps a held frame's motion blur without breaking determinism |
| `Curve.js` | `auditTransfer`, `fitShoulderExponent`, `lerpFields`: check a tone curve for folds and collapsed highlights |
| `Bisect.js` | `installChainBisect`: a `?shot=1` handle for switching individual passes off |
| `Instrument.js` | `InstrumentedRenderPass`: a scene pass that reports its own draw calls and triangles |

And one more in `src/`: `ViewHistory.js`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
