# @homie-rocks/loop

The frame loop a browser 3D game boots into: a clamped timestep with a freeze
switch for screenshots, an adaptive resolution ladder, a render-failure
fallback, coalesced resize with a guard against zero-sized surfaces, and WebGL
context-loss recovery. It also carries the boot sequence and a live tuning
console. It does not import three.js and knows nothing about any game: the game
passes values (is this frame live? what to rebuild after a context restore?)
rather than switches.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/loop@0.1.0
```

npm installs its one dependency, `@homie-rocks/device`, with it.

## Use

```ts
import { GameLoop, initialViewport } from '@homie-rocks/loop/Loop.js';

const parent = document.getElementById('app')!;
const size = initialViewport(parent);           // before anything is laid out

// ctx is your world: { renderer, camera, width, height, time, dt, frame, ... }
// systems are objects with optional update / lateUpdate / resize.
// pipeline is a LoopPipeline, e.g. RenderPipeline from @homie-rocks/render.
const loop = new GameLoop({
  parent, ctx, systems, pipeline,
  live: () => race.running,                     // may the ladder reason about this frame?
  restore: async () => rebuildEnvironment(),    // what a context restore cannot re-derive
});

loop.installResizeListeners();
loop.installContextRecovery();
loop.resize(true);
loop.start();                                   // applies ?scaler= then starts rAF
console.log(loop.health());
```

Append `?scaler=off` (or `?scaler=0.72`) to the page URL to pin the resolution
ladder, so a frame-time measurement is not moved by the ladder itself.

## Modules

| module | what it does |
|---|---|
| `Loop.js` | `GameLoop`: the rAF loop, freeze gate, render-failure fallback, resize coalescing, context-loss recovery, `driveWith()` for a WebXR frame source; `viewportSize`, `initialViewport`, `dismissBootCurtain` |
| `Ladder.js` | `ResolutionLadder` and the measured thresholds it runs on (`SCALE_RUNGS`, `FRAME_SLOW_MS`, `CPU_BOUND_MS`, ...) |
| `Boot.js` | `bootGame`: progress bar, ordered `init` walk, watchdog wiring, shader pre-warm, failure page, `window.__bootTrace` |
| `Tuning.js` | `installTuning`: a live `window.__<name>` console for feel numbers, with `set`, `punchy`, `reset` and `show` |
| `Host.js` | the structural types the loop reads (`LoopWorld`, `LoopPipeline`, `LoopSystem`, `LoopFrameSource`, ...) |
| `Contracts.js` | the `System` and `Bus` shapes a game's own types build on |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
