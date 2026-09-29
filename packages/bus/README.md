# @homie-rocks/bus

A small synchronous event bus for games, in two dispatch shapes. `Bus<E>` keeps
one handler set and hands every event to every subscriber; `KeyedBus<M>` keeps
one set per event type, so an event with no listeners costs one `Map` lookup.
Neither knows an event name: the game declares its own union or map and passes
it as the type parameter. A handler that throws is logged and the others still
run. There is no queue, no async delivery and no priority.

Part of Homie's open game engine: the packages the Homie games are built on.

## Install

```sh
npm install --save-exact @homie-rocks/bus@0.1.0
```

## Use

```ts
import { Bus } from '@homie-rocks/bus/Bus.js';
import { KeyedBus } from '@homie-rocks/bus/KeyedBus.js';

type GameEvent = { type: 'lap'; n: number } | { type: 'crash'; speed: number };
const bus = new Bus<GameEvent>();
const off = bus.on((e) => { if (e.type === 'lap') console.log('lap', e.n); });
bus.emit({ type: 'lap', n: 2 });
off();

type Events = { step: { dt: number }; reset: { seed: number } };
const keyed = new KeyedBus<Events>();
keyed.on('step', ({ dt }) => { /* runs 60 times a second */ });
keyed.once('reset', ({ seed }) => console.log('reset', seed));
keyed.emit('reset', { seed: 7 });
```

There is no barrel file: import the module you need.

## Modules

| module | what it does |
|---|---|
| `Bus.js` | `Bus<E>`: one handler set; `on` returns an `Unsubscribe`, `emit` dispatches in subscription order |
| `KeyedBus.js` | `KeyedBus<M>`: handlers per event type, with `on`, `once`, `emit` and `clear` |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
