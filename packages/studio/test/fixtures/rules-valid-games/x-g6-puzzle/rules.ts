// TILE SPRINT: everybody gets the same scrambled row of nine tiles. Swap neighbours until it reads 1 to 9. First home wins.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const TILES = 9;

function isSorted(board: readonly number[]): boolean {
  for (let i = 0; i < board.length; i += 1) if (board[i] !== i + 1) return false;
  return board.length === TILES;
}
/** The first place where the left tile is bigger than the right one, or -1. */
function firstInversion(board: readonly number[]): number {
  for (let i = 0; i + 1 < board.length; i += 1) if (board[i] > board[i + 1]) return i;
  return -1;
}
function swapped(board: readonly number[], at: number): number[] {
  const next = board.slice();
  const left = next[at];
  next[at] = next[at + 1];
  next[at + 1] = left;
  return next;
}

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      deal: { tiles: f.list(f.u8(), TILES) },
      solved: { id: f.ref(), seat: f.u8(), moves: f.u16() },
      award: { points: f.u8() },
      close: { round: f.u32() },
    },
    commands: { swap: { at: f.u8() } },
    effects: { click: { at: f.u8() }, fanfare: { seat: f.u8() } },
  },
  entities: {
    solver: {
      player: { away: 'think', leave: 'despawn' },
      fields: {
        score: f.u16({ score: true }),
        board: f.list(f.u8(), TILES),
        moves: f.u16(),
        solved: f.bit(),
        last: f.struct({ at: f.u8(), tick: f.tick() }),
        botMoveAt: f.tick(),
      },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 0, move: 'owner' },
      tick(world, self) {
        // Bots, and anyone away, solve it slowly: one right swap every three quarters of a second.
        if (world.round.phase !== 'live' || self.solved || self.board.length !== TILES) return;
        if (self.driver === 'person' && !self.away) return;
        if (world.tick < self.botMoveAt) return;
        self.botMoveAt = world.tick + world.ticks(0.75);
        const at = firstInversion(self.board);
        if (at < 0) return;
        self.board = swapped(self.board, at);
        self.moves += 1;
        self.last = { at, tick: world.tick };
        if (isSorted(self.board)) { self.solved = true; world.sendRoom('solved', { id: self.id, seat: self.seat, moves: self.moves }); }
      },
      think() { return { ax: 0, ay: 0 }; },
      commands: {
        swap(world, self, c) {
          if (world.round.phase !== 'live' || self.solved || self.board.length !== TILES) return;
          if (c.at >= TILES - 1) return;      // there is no tile to the right of the last one
          self.board = swapped(self.board, c.at);
          self.moves += 1;
          self.last = { at: c.at, tick: world.tick };
          world.emit('click', self.id, { at: c.at });
          if (isSorted(self.board)) { self.solved = true; world.sendRoom('solved', { id: self.id, seat: self.seat, moves: self.moves }); }
        },
      },
      on: {
        award(world, self, e) { self.score += e.points; },
        arrive(world, self) {
          // Joined after the deal: take the round's row from the room.
          if (world.round.phase === 'live' && self.board.length === 0) self.board = world.shared.puzzle;
        },
      },
      onRoom: {
        deal(world, self, e) {
          self.board = e.tiles;
          self.moves = 0;
          self.solved = false;
          self.botMoveAt = world.tick + world.ticks(1);
        },
        roundStart(world, self) { self.score = 0; },
        roundOver(world, self) { self.solved = true; },
      },
    },
  },
  shared: { puzzle: f.list(f.u8(), TILES), home: f.list(f.u8(), 32), names: f.map(f.text(16), 32), closing: f.bit() },
  room: {
    rounds: { seconds: 12, breakSeconds: 3 },
    bots: { keep: 2 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'solver', at: spots[player.seat % spots.length] };
    },
    on: {
      seatJoined(world, e) { world.shared.names = { ...world.shared.names, [String(e.seat)]: e.driver === 'person' ? 'Player ' + String(e.seat + 1) : 'Bot ' + String(e.seat + 1) }; },
      roundStart(world) {
        // Fisher–Yates with the room's own dice, so every player and every replay gets the same row.
        const tiles: number[] = [];
        for (let i = 1; i <= TILES; i += 1) tiles.push(i);
        for (let i = TILES - 1; i > 0; i -= 1) {
          const j = Math.floor(world.random() * (i + 1));
          const held = tiles[i]; tiles[i] = tiles[j]; tiles[j] = held;
        }
        if (isSorted(tiles)) { tiles[0] = 2; tiles[1] = 1; }      // never deal a solved row
        world.shared.puzzle = tiles;
        world.shared.home = [];
        world.shared.closing = false;
        world.announce('deal', { tiles });
      },
      solved(world, e) {
        if (world.round.phase !== 'live' || world.shared.home.includes(e.seat)) return;
        world.shared.home = [...world.shared.home, e.seat];
        world.send(e.id, 'award', { points: Math.max(1, 4 - world.shared.home.length) });
        world.emit('fanfare', e.id, { seat: e.seat });
        if (!world.shared.closing) { world.shared.closing = true; world.after(world.ticks(4), 'close', { round: world.round.n }); }
      },
      close(world, e) { if (e.round === world.round.n && world.round.phase === 'live') world.round.end(); },
    },
  },
  map: './map',
});
