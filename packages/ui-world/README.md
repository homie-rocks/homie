# @homie-rocks/ui-world

The arithmetic between a 3D world and a 2D panel: fitting a closed path to a
panel along its principal axis, an oblique depth-sorted ribbon projection,
world-to-screen projection that refuses points behind the camera, marker
relaxation and paint order, a few canvas marks, and a canvas that bakes its
static half once and blits it. It does not draw a minimap and chooses no
colour, size or weight: every one of those is an argument.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/ui-world@0.1.0 three@0.185.1
```

Only `screenpoint.js` imports three; the other modules are plain arithmetic
and Canvas 2D.

## Use

```ts
import { principalAxisFit, planScale, planProject } from '@homie-rocks/ui-world/planfit.js';
import { BakedPlate } from '@homie-rocks/ui-world/plate.js';

declare const path: { x: number; z: number }[]; // a closed centreline
// The last argument is the world direction that should run left-to-right.
const fit = principalAxisFit(path.length, (i) => path[i]!.x, (i) => path[i]!.z, { x: 1, z: 0 });

const plate = new BakedPlate(document.body);
if (plate.measure(320, 180, 180, 0.5, 2)) {
  const s = planScale(fit, plate.w, plate.h, 0.08);
  const p = { x: 0, y: 0 };
  const g = plate.beginBake();
  g.beginPath();
  path.forEach((q, i) => {
    planProject(fit, q.x, q.z, s, plate.w / 2, plate.h / 2, p);
    if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y);
  });
  g.closePath();
  g.stroke();
}

// Every frame: blit the baked half, then draw only the moving marks.
const g = plate.blit();
```

## Modules

| module | what it does |
|---|---|
| `planfit.js` | `principalAxisFit`, `planProject`, `planRotate`, `planScale`: lay a path flat on a panel |
| `obliqueRibbon.js` | `projectRibbon`, `obliqueProject`, `obliquePlace`, `unwrappedRoll`: a banked path as a depth-sorted ribbon |
| `ribbon.js` | `casedRibbon`, `tracePath`, `crossBar`, `strokeGapped`: a path drawn as a cased road |
| `markers.js` | `spreadMarkers`, `paintOrder`: pull overlapping marks apart along an axis, draw the leader last |
| `glyphs.js` | `discMarker`, `headingMarker`, `caretMarker`, `pinMarker`: the marks themselves |
| `screenpoint.js` | `projectToScreen`, `screenRadius`: world point to client pixels, rejecting points behind the eye |
| `plate.js` | `BakedPlate`: two same-sized canvases, a DPR cap and a layout guard |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
