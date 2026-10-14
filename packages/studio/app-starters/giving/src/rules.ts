// Transient scene truth lives in the room; authorized queue records live in AppRecords.
// A phone has a logical stationary seat anchor. The wall watches without a seat.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shared: { revision: f.u32() },
  shapes: { events: { refresh: {} }, commands: { refresh: {} }, effects: { refresh: {} } },
  entities: {
    participant: {
      player: true,
      body: { shape: 'circle', radius: 0.1, maxSpeed: 0 },
      commands: { refresh(world, self) { world.sendRoom('refresh', {}); } },
    },
  },
  room: {
    rounds: { seconds: 0, breakSeconds: 0 }, bots: { keep: 0 },
    join() { return { kind: 'participant', at: { x: 0, y: 0 } }; },
    on: { refresh(world) { world.shared.revision += 1; world.emit('refresh', { x: 0, y: 0 }, {}); } },
  },
});
