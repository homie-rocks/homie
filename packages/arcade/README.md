# @homie-rocks/arcade

Seats and phone controllers for a game on a shared screen. A game writes one
`TableSpec` (the jobs at the table and what each job's phone holds) and gets a
job per seat, a controller page for every phone, per-seat input read like a
keyboard, late arrivals dealt in, and a keyboard or headset fallback when no
host is present. It does not decide what a seat is or who holds one (those come
from the host's seat service), and it does not know what a button means.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/arcade@0.1.0
```

## Use

```js
import { defineTable } from '@homie-rocks/arcade/Roles.js';
import { Table } from '@homie-rocks/arcade/Table.js';
import { liveFeed } from '@homie-rocks/arcade/Live.js';
import { keyboardSeats, withKeyboardFallback } from '@homie-rocks/arcade/Local.js';

const spec = defineTable({
  roles: [{
    id: 'pilot', label: 'Pilot', capacity: 2,
    controls: [
      { kind: 'stick', id: 'steer', label: 'Steer' },
      { kind: 'button', id: 'boost', label: 'Boost' },
    ],
  }],
  spectatorLabel: 'Next up',
});

// Plays from the keyboard standalone; yields to phones the moment a host seats someone.
const keys = keyboardSeats(spec, [
  { name: 'Keyboard', role: 'pilot', keys: { steer: ['KeyA', 'KeyD', 'KeyW', 'KeyS'], boost: 'Space' } },
]);
keys.listen(window);
const table = new Table(spec, withKeyboardFallback(liveFeed(), keys));

function frame() {
  keys.poll();
  const pad = table.pad('pilot', 0);   // never null: an empty chair reads centred
  const { x, y } = pad.stick('steer');
  if (pad.hit('boost')) { /* one frame, rising edge */ }
  table.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

## Modules

| module | what it does |
|---|---|
| `Roles.js` | `defineTable`, `RoleTable`: which job each seat holds, fill order, promotion from the spectator queue |
| `Table.js` | `Table`: the one object a game holds; players, pads, `attention()`, `endFrame()` |
| `Pad.js` | `Pad`: one seat's sticks, buttons and sliders, with a latched rising edge |
| `Live.js` | `liveFeed`: the seat feed over a Homie host's `/__homie/session` and `/__homie/call` routes; quiet when there is no host |
| `Local.js` | `drivenFeed`, `keyboardSeats`, `withKeyboardFallback`, `withLocalSeats`: local seats for tests and keyboards |
| `XR.js` | `xrSeats`, `XR_BUTTON`: WebXR controllers as a seat (unverified on hardware) |
| `Surface.js` | `controllerPage`: the self-contained HTML controller a phone is shown |
| `Session.js` | `asymmetric`: mission assignment, control sequences, votes and cues for asymmetric games |
| `Mission.js` | `assignMissions`: keep every authored task when some roles are empty |
| `Sequence.js` | `createControlSequence`: ordered multi-control gestures with a neutral re-arm |
| `Decision.js` | `openDecision`: quorum, revised votes, ties and revotes |
| `Cue.js` | `dispatchRoomCue`: one incident sent to lights, audio and phone haptics |
| `faults.js` | `arcadeFaultActive`: named deliberate faults for test runs |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
