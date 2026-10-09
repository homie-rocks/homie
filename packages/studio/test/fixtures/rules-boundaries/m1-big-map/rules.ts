import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
// A big shared map (1,000 cells), read whole by every player every tick and written by the room every tick.
const CELLS = 1000;
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shared: { cells: f.map(f.u16(), 1024), sum: f.u32(), first: f.text(8) },
  shapes: { events: { paint: { cell: f.u16() } }, commands: {}, effects: {} },
  entities: {
    drummer: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), seen: f.u32() },
      input: { ax: f.i8(), ay: f.i8(), hit: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 3, move: 'owner' },
      think() { return { ax: 60, ay: -60, hit: false }; },
      tick(world, self) {
        let total = 0; let count = 0;
        for (const v of Object.values(world.shared.cells)) { total += v; count += 1; }
        self.seen = total;
        const mine = 'c' + ((self.seat * 97 + world.tick) % CELLS);
        if (mine in world.shared.cells && (world.shared.cells[mine] ?? 0) % 7 === self.seat % 7) self.score = Math.min(65535, self.score + 1);
        if (count > 0 && world.tick % 4 === self.seat % 4) world.sendRoom('paint', { cell: (self.seat * 131 + world.tick * 7) % CELLS });
      },
      onRoom: { roundStart(world, self) { self.score = 0; } },
    },
  },
  room: {
    rounds: { seconds: 30, breakSeconds: 3 }, bots: { keep: 6 },
    join(ctx, player) { const spots = ctx.map.spots('start'); return { kind: 'drummer', at: spots[player.seat % spots.length] }; },
    start(world) { const cells: Record<string, number> = {}; for (let i = 0; i < CELLS; i += 1) cells['c' + i] = i % 50; world.shared.cells = cells; },
    on: {
      paint(world, e) {
        const key = 'c' + e.cell;
        world.shared.cells[key] = ((key in world.shared.cells ? world.shared.cells[key] ?? 0 : 0) + 1) % 1000;
        world.shared.first = Object.keys(world.shared.cells)[0] ?? '';
      },
    },
  },
});
