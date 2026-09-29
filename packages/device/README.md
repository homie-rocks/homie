# @homie-rocks/device

What the hardware is, and how to keep a person's settings without ever crashing
on them. It classifies the device from pointer, touch and screen signals (so an
iPad in desktop mode is still a tablet), validates stored preferences field by
field, and holds the measured maths and state machine for an on-screen thumb
stick. It never knows what a preference means: it supplies no field names, no
defaults and no storage keys, and it does not decide what a stick steers.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/device@0.1.0
```

## Use

```ts
import { device } from '@homie-rocks/device/Device.js';
import { num, oneOf, parseRecord, readStored, writeStored } from '@homie-rocks/device/Prefs.js';
import { DEADZONE_PX, thumbCurve } from '@homie-rocks/device/Thumb.js';

const d = device(); // probed once, then memoised
const quality = d.handheld ? 'low' : 'high';

// Absent, corrupt or half-written storage falls to your defaults, per field.
const stored: Record<string, unknown> = parseRecord(readStored('my-game.controls.v1')) ?? {};
const prefs = {
  sensitivity: num(stored.sensitivity, 0.1, 3, 1),
  hand: oneOf(stored.hand, ['left', 'right'] as const, 'right'),
};
writeStored('my-game.controls.v1', prefs); // never throws

// A drag of 40 CSS px on a 96 px stick, as a -1..1 steering command.
const steer = thumbCurve(40, 96, DEADZONE_PX);
```

Every storage function is synchronous and never throws: Safari private mode, a
sandboxed iframe and a `file://` page all get a working game with defaults.

## Modules

| module | what it does |
|---|---|
| `Device.js` | `profileDevice()` and the memoised `device()`: touch-primary, handheld, memory, cores, shortest edge, DPR |
| `Prefs.js` | Per-field validators (`num`, `bool`, `oneOf`, `strings`, `mapOf`) and guarded `readStored` / `writeStored` / `removeStored` / `parseRecord` |
| `Thumb.js` | Measured thumb-stick constants, `thumbCurve` and its exact inverse `thumbTravel`, spawn and grab rules, safe-area insets, tilt permission and screen-space roll |
| `ThumbPad.js` | `ThumbPad`, an abstract on-screen pad: stick ownership, thumb-roll handover, release ramp, button hit resolution, tilt, and three-beat onboarding |

The touch code has been checked with synthetic touch events only, which bypass
the browser's gesture handling. Treat how it feels under a real thumb as
unverified until you have held it.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
