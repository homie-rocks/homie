// Separate wells: people and bots can only change their own falling piece.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
import { cells, fits } from './pieces';

type Well = {
  grid: readonly number[]; bag: readonly number[]; piece: number; next: number;
  x: number; y: number; rotation: number; score: number; lines: number;
  dead: boolean; fallAt: number; repeatAt: number; botAt: number; target: number;
};
function take(s: Well, random: number): number {
  const bag = s.bag.length ? s.bag.slice() : [1,2,3,4,5,6,7];
  const at = Math.min(bag.length - 1, Math.floor(random * bag.length));
  const kind = bag[at]; bag.splice(at, 1); s.bag = bag; return kind;
}
function spawn(s: Well, random: number): void {
  s.piece = s.next; s.next = take(s, random); s.x = 3; s.y = -1; s.rotation = 0;
  s.dead = !fits(s.grid, s.piece, s.rotation, s.x, s.y);
  // A modest bot: aim for a low column; it uses the same input and lock path.
  let best = 21, target = 3;
  for (let x = 0; x < 10; x++) {
    let height = 0;
    for (let y = 0; y < 20; y++) if (s.grid[y * 10 + x]) { height = 20 - y; break; }
    if (height < best) { best = height; target = Math.max(0, Math.min(6, x - 1)); }
  }
  s.target = target;
}
function reset(s: Well, a: number, b: number): void {
  const grid: number[] = []; for (let i = 0; i < 200; i++) grid.push(0);
  s.grid = grid; s.bag = []; s.score = 0; s.lines = 0; s.dead = false;
  s.fallAt = 0; s.repeatAt = 0; s.botAt = 0; s.next = take(s, a); spawn(s, b);
}
function lock(s: Well): number {
  const grid = s.grid.slice();
  for (const cell of cells(s.piece, s.rotation)) {
    const x = s.x + cell % 4, y = s.y + Math.floor(cell / 4);
    if (y < 0) { s.dead = true; return 0; }
    grid[y * 10 + x] = s.piece;
  }
  const kept: number[] = []; let cleared = 0;
  for (let y = 0; y < 20; y++) {
    let full = true; for (let x = 0; x < 10; x++) if (!grid[y * 10 + x]) full = false;
    if (full) cleared++; else for (let x = 0; x < 10; x++) kept.push(grid[y * 10 + x]);
  }
  const next: number[] = []; for (let i = 0; i < cleared * 10; i++) next.push(0);
  s.grid = next.concat(kept); s.lines += cleared;
  s.score += [0,100,300,500,800][cleared] * (1 + Math.floor(s.lines / 10));
  return cleared;
}
export default defineRules({
  contract: 2, space: { dims: 2 }, move, map: './map', shared: {},
  shapes: { events: { topped: {} }, effects: { placed: { rows: f.u8() }, moved: {}, turned: {} } },
  entities: {
    board: {
      player: { away: 'think', leave: 'bot' },
      body: { shape: 'circle', radius: 0.1, maxSpeed: 0 },
      input: { dx: f.i8(), soft: f.bit(), rotate: f.press(), drop: f.press() },
      fields: {
        grid: f.list(f.u8(), 200), bag: f.list(f.u8(), 7), piece: f.u8(), next: f.u8(),
        x: f.i8(), y: f.i8(), rotation: f.u8(), score: f.u32({ score: true }), lines: f.u16(),
        dead: f.bit(), fallAt: f.tick(), repeatAt: f.tick(), botAt: f.tick(), target: f.i8(),
      },
      tick(world, self) {
        if (world.round.phase !== 'live' || self.dead || !self.grid.length) return;
        const dx = Math.sign(self.input.dx);
        if (dx && world.tick >= self.repeatAt) {
          if (fits(self.grid, self.piece, self.rotation, self.x + dx, self.y)) { self.x += dx; world.emit('moved', self.id, {}); }
          self.repeatAt = world.tick + world.ticks(0.12);
        } else if (!dx) self.repeatAt = 0;
        if (self.input.rotate) {
          const rotation = (self.rotation + 1) % 4;
          for (const kick of [0,-1,1,-2,2]) if (fits(self.grid, self.piece, rotation, self.x + kick, self.y)) {
            self.x += kick; self.rotation = rotation; world.emit('turned', self.id, {}); break;
          }
        }
        let landed = false;
        if (self.input.drop) {
          for (let i = 0; i < 22; i++) { if (!fits(self.grid, self.piece, self.rotation, self.x, self.y + 1)) break; self.y++; self.score += 2; }
          landed = true; self.botAt = world.tick + world.ticks(1.5);
        } else if (world.tick >= self.fallAt || self.input.soft) {
          if (fits(self.grid, self.piece, self.rotation, self.x, self.y + 1)) { self.y++; if (self.input.soft) self.score++; }
          else landed = true;
          self.fallAt = world.tick + world.ticks(Math.max(0.12, 0.7 - Math.floor(self.lines / 10) * 0.05));
        }
        if (landed) {
          const rows = lock(self); world.emit('placed', self.id, { rows });
          if (!self.dead) spawn(self, world.random());
          self.fallAt = world.tick + world.ticks(0.7);
          if (self.dead) world.sendRoom('topped', {});
        }
      },
      think(world, self) {
        return { dx: Math.sign(self.target - self.x), soft: false, rotate: false,
          drop: !self.dead && self.x === self.target && world.tick >= self.botAt };
      },
      on: {
        arrive(world, self) { reset(self, world.random(), world.random()); },
        takeover(world, self) { if (self.driver === 'person') reset(self, world.random(), world.random()); },
      },
      onRoom: { roundStart(world, self) { reset(self, world.random(), world.random()); } },
    },
  },
  room: {
    rounds: { seconds: 120, breakSeconds: 6 }, bots: { keep: 2 },
    join(_ctx, player) { return { kind: 'board', at: { x: player.seat, y: 0 } }; },
    on: {
      topped(world) {
        // Only room handlers can end rounds. No invented room.tick callback.
        const boards = world.near({ x: 0, y: 0, z: 0 }, 32, 'board');
        if (boards.length && boards.every(b => b.dead)) world.round.end();
      },
    },
  },
});
