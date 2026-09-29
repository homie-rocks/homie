# @homie-rocks/film

A film as data: a declarative timeline of scenes, shots, marks, cues and
spoken lines that answers "what is true at time t?" without playing what came
before. On top of it: a seek/reset contract, set volumes with continuity
checks, distance-driven locomotion, dialogue with captions and an FFmpeg mix
graph, story checks, and resumable capture plans. It imports no renderer and
never touches `three`, a GPU, FFmpeg or the network, so every check runs in
plain Node.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/film@0.1.0
```

npm installs `@homie-rocks/camera` with it. That package declares
`three@0.185.1` as a peer dependency; nothing in this package imports three.

## Use

```ts
import { compileFilm } from '@homie-rocks/film/Timeline.js';
import { lensAtTime } from '@homie-rocks/film/Camera.js';
import { checkProject, emptyProject } from '@homie-rocks/film/Project.js';

const film = compileFilm({ id: 'demo', fps: 30,
  scenes: [{ id: 'opening', location: 'stage', shots: [
    { id: 'push-in', seconds: 3, camera: { keys: [
      { p: 0, eye: [0, 1.6, -6], aim: [0, 1.2, 0], fov: 38 },
      { p: 1, eye: [0, 1.6, -3], aim: [0, 1.2, 0], fov: 32 },
    ] } },
  ] }],
});

const { shot, local } = film.at(1.5);    // which shot, and how far into it
const { lens } = lensAtTime(film, 1.5);  // eye, aim, fovDeg, rollDeg

// The one gate: errors, warnings, and notes naming every check that did not run.
const report = checkProject(emptyProject('my-film'));
console.log(report.errors.length, report.notes.map((n) => n.code));
```

## Modules

| module | what it does |
|---|---|
| `Timeline.js` | the manifest types, `validateFilm` and `compileFilm`; durations are authored, absolute times derived |
| `Camera.js` | `lensAt` / `lensAtTime`, `lensSpeed`, `lensIsLocked` over a shot's camera keys |
| `Stage.js` | `createStage`: the `prepare` / `resetAt` / `seek` / `settle` / `presented` contract |
| `Visibility.js` | `createVisibilityGate`, `auditTree`, `visibleAt`: the timeline and runtime culling can only ever hide |
| `Sets.js` | `buildSetIndex`, `inVolume`: set volumes, marks, portals and sockets |
| `Continuity.js` | `checkContinuity`: cast outside their set, mark collisions, teleports, crossing the 180° line |
| `Acting.js` | `poseAt`, `signalAt`, `validateLocomotion`, `validatePerformance`: gait phase from distance travelled |
| `Script.js` | `scheduleScript`, `captionsVTT` / `captionsSRT`, `transcriptQA`, `buildMixGraph` |
| `Blueprint.js` | `checkBlueprint`: every shot states its purpose, every payoff was set up earlier |
| `QA.js` | `detectFreezes`, `checkCoverage`, `checkSync`, `checkSafe`, `storyboardTimes` over caller-supplied measurements |
| `Capture.js` | `planCapture`, `remainingChunks`, `verifyChunks`: shot-aligned, resumable chunks |
| `Handle.js` | `installFilmHandle`, `gpuFence`: the `window.__homieFilm` seam a capture tool drives |
| `Delivery.js` | master, television and social presets, `buildDeliveryArgs`, `posterFrameArgs` |
| `Growth.js` | `sampleGrowth`, `growthWave`, `sproutRig`: plant growth as a pure function of time |
| `Project.js` | `FilmProject`, `checkProject`, `parseFilmProject`, `emptyProject` |

and `Progress.js` (a render progress line with a median-based ETA) in src/.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
