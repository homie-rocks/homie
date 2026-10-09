import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
// WATCHTOWERS: a board of 1,000 cells that players repaint. Forty sentries each read the whole board every tick
// to find how much of it is theirs. Well inside the tick budget, but busy on every tick of every round.
const CELLS = 1000;
const SENTRIES = 40;
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shared: { cells: f.map(f.u16(), 1024), first: f.text(8) },
  shapes: { events: { paint: { cell: f.u16(), by: f.u8() } }, commands: {}, effects: {} },
  entities: {
    drummer: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }) },
      input: { ax: f.i8(), ay: f.i8(), hit: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 3, move: 'owner' },
      think() { return { ax: 60, ay: -60, hit: false }; },
      tick(world, self) {
        if (world.tick % 4 === self.seat % 4) world.sendRoom('paint', { cell: (self.seat * 131 + world.tick * 7) % CELLS, by: self.seat });
        if (world.tick % 20 === 0) self.score = Math.min(65535, self.score + 1);
      },
      onRoom: { roundStart(world, self) { self.score = 0; } },
    },
    sentry: {
      fields: { post: f.u8(), mine: f.u16(), longest: f.u16() },
      tick(world, self) {
        let mine = 0; let longest = 0;
        for (const v of Object.values(world.shared.cells)) { if (v % 64 === self.post) mine += 1; }
        for (const k of Object.keys(world.shared.cells)) { if (k.length > longest) longest = k.length; }
        self.mine = mine; self.longest = longest;
      },
    },
  },
  room: {
    rounds: { seconds: 30, breakSeconds: 3 }, bots: { keep: 4 },
    join(ctx, player) { const spots = ctx.map.spots('start'); return { kind: 'drummer', at: spots[player.seat % spots.length] }; },
    start(world) {
      const cells: Record<string, number> = {}; for (let i = 0; i < CELLS; i += 1) cells['c' + i] = i % 50; world.shared.cells = cells;
      for (let i = 0; i < SENTRIES; i += 1) world.spawn('sentry', { x: -11 + (i % 20) * 1.1, y: i < 20 ? 6 : -6, z: 0 }, { post: i });
    },
    on: {
      paint(world, e) {
        const key = 'c' + e.cell;
        world.shared.cells[key] = ((key in world.shared.cells ? world.shared.cells[key] ?? 0 : 0) + 1 + e.by) % 1000;
        world.shared.first = Object.keys(world.shared.cells)[0] ?? '';
      },
    },
  },
});
