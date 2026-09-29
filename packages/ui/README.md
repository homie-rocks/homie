# @homie-rocks/ui

Screen-space UI primitives for games, with no renderer dependency: cached DOM
writes that skip a style recalc when nothing moved, clock and number
formatting, menus and screen routing, coalescing alerts, canvas instruments
(gauges, panel marks, attitude symbols, reticles), Oklab colour with contrast
audits, and a TrueType writer for a font drawn in code. It knows that a
readout has a width and a value; it never knows what the value counts, and it
ships no palette, no copy and no tuned proportion — those are the game's.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/ui@0.1.0
```

## Use

```ts
import { el, setText, setNum, approach, formatClock } from '@homie-rocks/ui/uiUtil.js';
import { ToastStack } from '@homie-rocks/ui/toastStack.js';

const hud = el('div', 'hud', document.body);
const timer = el('span', 'timer', hud);
const fuel = el('div', 'fuel', hud);
const alerts = el('div', 'alerts', hud);
let shown = 0;

// Lines that differ only in ids and figures merge into one card with a count.
const toasts = new ToastStack<HTMLElement>({ cap: 4, ttl: 6 });
function alert(line: string): void {
  const r = toasts.push(line, 0, (text) => el('div', 'toast', alerts, text));
  if (r.merged) {
    setText(r.entry.card, `${r.joined ?? r.entry.text} ×${r.entry.count}`);
    alerts.appendChild(r.entry.card); // a repeat is news again: move it to the bottom
  }
  for (const gone of r.retired) gone.card.remove();
}

// Once a frame. Nothing reaches the DOM unless the value actually moved.
function frame(raceTime: number, fuelFrac: number, dt: number): void {
  setText(timer, formatClock(raceTime));          // "1:04.37"
  shown = approach(shown, fuelFrac, 0.2, dt);     // eased on a time constant, then settles
  setNum(fuel, 'width', shown * 100, 0.1, '%');
  for (const gone of toasts.age(dt)) gone.card.remove();
}
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `uiUtil.js` | `setText`, `setAttr`, `setStyle`, `setNum` (cached writes), `el`, `sg`, `formatClock`, `formatDelta`, `formatSeries`, `damp`, `approach`, `Spring`, `mixHex` |
| `colour.js` | sRGB and Oklab conversions, WCAG `contrast`, straight-alpha `overRGB`, `oklabRamp` lookups, `desaturate` |
| `legibility.js` | `auditRamp`, `auditChannel`, `auditHousing`: contrast audits that return sentences, not a boolean |
| `screens.js` | `createScreens`: one current screen, a validated `?ui=` review route, focus and confirm |
| `MenuShell.js` | `MenuShell`: a title / select / pause / results menu machine for a racing game; every word is the game's |
| `rowMenu.js` | `rowMenu`: a column of keyword rows driven by arrows and pointer alike, with caller-owned class names |
| `toastStack.js` | `ToastStack`: alert cards that coalesce on the message template and name every id they merged |
| `cardDeck.js`, `hintReveal.js` | timed cards over live play, and an explanation that retires on the first input |
| `arcGauge.js` | `drawArcGauge`: a round canvas instrument with a value fill, warning band, inner ring and needle |
| `panelMarks.js` | `recess`, `tickRun`, `hatch`, `pointer`, `rule`, `dashRule`, `segmentLadder`: flat-instrument marks on a 2D canvas |
| `avionics.js`, `reticle.js` | `bankScale`, `horizonWings`, `waterline`, `flightPath`; `dashedRing`, `gappedRing`, `axisTicks` |
| `housing.js` | `drawHousing`: an instrument plate painted as a bolted fixture, with a replayable contrast stack |
| `truetype.js`, `face.js` | `buildFont`: a stroking pen and TrueType writer; `installHouseFaces`: a code-drawn grotesque and mono in two weights |
| `strokeface.js` | `strokeText`: canvas type from caller-owned polylines |
| `screenAnchor.js` | `readKeepOut`, `blocked`, `stackDown`, `placeTag`, `pickSide`: labels pinned to moving points that dodge panels and each other |

and 11 more in src/: `RateTracker.js`, `Roulette.js`, `RivalRow.js`, `stepChain.js`, `controlStrip.js`, `measuredBox.js`, `phosphor.js`, `iconAtlas.js`, `viewPanes.js`, `capture.js`, `touchSkin.js`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
