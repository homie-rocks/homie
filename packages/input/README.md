# @homie-rocks/input

Input for browser games: a physical controller, a keyboard, a finger on a
touchscreen, and the screen where a player changes how the game is driven. It
knows what a stick reads and never what a button means: every dead zone, slop,
rate and label is the caller's, and nothing here names a verb like "jump" or
"fire". It is not a gesture library, and nothing touch-related in it has been
verified by an automated harness, because CDP touch events bypass the
browser's gesture arbitration.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/input@0.1.0
```

npm also installs `@homie-rocks/ui`, which the controls screen uses.

## Use

```ts
import { GlassPad } from '@homie-rocks/input/GlassPad.js';

const pad = new GlassPad({
  split: 0.5,                          // left half moves, right half aims
  stick: { radius: 60, deadzone: 8 },  // CSS px
  look: { tapSlop: 12 },
  buttons: [{ id: 'jump', label: 'JUMP', mode: 'press', cls: 'my-jump-button' }],
  accept: (e) => e.pointerType === 'touch',
  rings: true,
});
pad.mount();
pad.setVisible(true);

// once per frame
const { x, y } = pad.stick;            // -1..1 each, y positive is down
const { dx, dy } = pad.look.consume(); // CSS px since the last frame
if (pad.pressed('jump')) { /* ... */ }
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `GlassPad.js` | an on-screen twin-stick pad with a button cluster, drawn over the game |
| `Stick2.js` | a floating two-axis stick whose base trails the thumb |
| `DragLook.js` | a look drag that accumulates a delta and recognises a tap |
| `PinchPan.js` | one-finger drag, two-finger pan and pinch, as raw pixel deltas |
| `Keys.js` | held state and one-frame latching for a physical keyboard |
| `PadReader.js` | finds a gamepad, reads sticks and triggers, drives rumble |
| `Pulse.js` | a phone's vibration motor behind a gap and duty-cycle budget |
| `TouchPresence.js` | decides whether a finger is driving, and blocks page pinch-zoom |
| `DeviceRig.js` | base class that brings keyboard, gamepad, haptics and touch up and down together |
| `Axis.js` | frame-rate-independent key-to-axis ramps and an assist fold that never crosses centre |
| `Rebind.js` | `Bindings`: an action table with player overrides and `labelForCode` |
| `RebindPanel.js` | the modal where a player rebinds keys |
| `ControlsSheet.js` | a controls screen where a player tries each scheme without leaving it |
| `ControlsScreen.js` | wires a thumb pad's preferences into `ControlsSheet` |
| `KeyHint.js` | a key-hint strip derived from the live bindings |

And five more in `src/`: `Hold.js`, `PressBuffer.js`, `TapOrDrag.js`,
`Recorder.js` and `faults.js`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
