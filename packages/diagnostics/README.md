# @homie-rocks/diagnostics

Whether the frame a person is looking at has a picture in it, and what to do when it
does not. It holds the pure blank/flat/tear predicates, the pipeline log a bug report is
made of, a watchdog that walks the renderer down its fallback ladder, and the probe fault
hooks that make a green test run mean something. It knows a luma mean, a spread, a lit
fraction and a rung name; it never knows why a frame is dark, and it imports nothing, not
even three.js.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

    npm install --save-exact @homie-rocks/diagnostics@0.1.0

## Use

```ts
import { Diagnostics } from '@homie-rocks/diagnostics/Watchdog.js';
import { classifyFrame } from '@homie-rocks/diagnostics/FrameHealth.js';

const thresholds = { blankSd: 4, blankLit: 0.02, flatSd: 4, flatMean: 235 };
const watchdog = new Diagnostics({
  label: 'racer',
  thresholds,
  schedule: { blankStreak: 2, blankHoldS: 0, deadCalls: 4 },
});
watchdog.init(ctx);                          // ctx: { frame, time, renderer, settings? }
// every frame, right after the present:
watchdog.afterPresent(ctx, sceneDrawCalls);

// or use the predicate on its own:
classifyFrame({ ok: true, mean: 3, sd: 0.4, lit: 0 }, thresholds).blank; // true
```

Every threshold is the game's: there are no defaults, because a default would be one
game's world deciding another game's degrade policy. The renderer is taken as a structure
(`DiagRenderer` in `Host.js`), so a real `THREE.WebGLRenderer` fits with no cast and a
test can pass a fake one.

## Modules

| module | what it does |
|---|---|
| `FrameHealth.js` | `classifyFrame` (blank / flat) and `classifyRow` (tear), pure, with their threshold types |
| `Watchdog.js` | `Diagnostics`: shader, image and draw-call detectors that degrade the pipeline, plus the `__gl()` report |
| `FrameWatch.js` | `?debug=frames`: samples one row of the drawing buffer and records partial-black presents |
| `PipelineLog.js` | `logPipeline`, shader-error capture and the `console.error` interception |
| `Host.js` | the structural seam: `FrameHost`, `DiagRenderer`, `FrameSample`, and `pipeline()` |
| `StripRead.js` | `sampleStrips`: an on-demand read of the presented frame that refuses rather than guesses |
| `HalfFloat.js` | `classifyHalf` / `scanTarget`: NaN and Inf forensics on a half-float render target |
| `Fault.js` | `faultActive` / `faultApplied`: the probe fault handshake |
| `ProbeHooks.js` | `probeHooks` / `readFault`: the freeze and fault protocol for any subsystem |
| `LiveTuning.js` | `installLiveTuning`: a console handle onto a record of numbers tuned by feel |
| `Handle.js` | `interceptHandle`: wrap a `window` harness handle before it is installed |
| `TabFilm.js` | `TabFilm`: record this tab (canvas, DOM and audio) to a webm blob |
| `FilmClock.js` | `homieFilmClock`: validate a page's `window.__homieFilm` clock for frame-exact capture |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
