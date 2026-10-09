import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shared: { stage: f.u8(), n: f.u32() },
  shapes: { events: { mark: { seat: f.u8() } }, commands: {  }, effects: {  } },
  entities: {
    
    runner: {
      player: { away: 'think', leave: 'bot' }, input: { ax: f.i8(), ay: f.i8() }, body: { shape: 'circle', radius: 0.4, maxSpeed: 5, move: 'owner' },
      fields: { score: f.u16({ score: true }), gear: f.list(f.u8(), 4) },
      think(world, self) { return { ax: world.tick % 40 < 20 ? 127 : -127, ay: 0 }; },
      tick(world, self) {
        if (world.tick % 30 === self.seat) { self.score = Math.min(65535, self.score + 1); world.sendRoom('mark', { seat: self.seat }); }
        if (world.shared.stage >= 5) { const g = self.gear[0]; self.gear = [g + 1]; const spot = world.map.spot('boss'); world.place(self, spot!); }
      },
      
    },
  },
  room: {
    rounds: { seconds: 20, breakSeconds: 2 }, bots: { keep: 3 },
    join(ctx, player) { const spots = ctx.map.spots('start'); return { kind: 'runner', at: spots[player.seat % spots.length] }; },
    
    on: {
      mark(world, e) { world.shared.n = world.shared.n + 1; if (world.tick >= 15000) world.shared.stage = 5; },
    },
  },
});
