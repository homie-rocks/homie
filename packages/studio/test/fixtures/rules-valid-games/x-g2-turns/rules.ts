// LUCKY SEVENS: take turns rolling the die. First to twenty wins. A turn you sleep through is skipped.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const GOAL = 20;
const TURN_SECONDS = 2;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      rolled: { seat: f.u8() },
      gain: { points: f.u8() },
      timeout: { turnNo: f.u32() },
      close: { round: f.u32() },
    },
    commands: { roll: {} },
    effects: { dice: { face: f.u8(), seat: f.u8() } },
  },
  entities: {
    guest: {
      player: { away: 'think', leave: 'despawn' },
      fields: { score: f.u16({ score: true }), rolls: f.u16(), botRollAt: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 4, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        const order = world.shared.order;
        if (order.length === 0 || order[world.shared.turn % order.length] !== self.seat) { self.botRollAt = 0; return; }
        // A bot (or somebody who walked away) rolls after a short think, so a table of bots still plays.
        if (self.driver === 'person' && !self.away) return;
        if (self.botRollAt === 0) { self.botRollAt = world.tick + world.ticks(0.5); return; }
        if (world.tick >= self.botRollAt) { self.botRollAt = 0; world.sendRoom('rolled', { seat: self.seat }); }
      },
      think() { return { ax: 0, ay: 0 }; },
      commands: {
        roll(world, self) {
          if (world.round.phase !== 'live') return;
          world.sendRoom('rolled', { seat: self.seat });
        },
      },
      on: {
        gain(world, self, e) { self.score += e.points; self.rolls += 1; },
      },
      onRoom: {
        roundStart(world, self) { self.score = 0; self.rolls = 0; self.botRollAt = 0; },
      },
    },
  },
  shared: {
    order: f.list(f.u8(), 32),
    ids: f.map(f.ref(), 32),
    totals: f.map(f.u16(), 32),
    turn: f.u8(),
    turnNo: f.u32(),
    lastFace: f.u8(),
    banner: f.text(48),
  },
  room: {
    rounds: { seconds: 0, breakSeconds: 3 },
    bots: { keep: 3 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'guest', at: spots[player.seat % spots.length] };
    },
    on: {
      seatJoined(world, e) {
        if (!world.shared.order.includes(e.seat)) world.shared.order = [...world.shared.order, e.seat];
        world.shared.ids = { ...world.shared.ids, [String(e.seat)]: e.id };
      },
      seatLeft(world, e) {
        const order = world.shared.order.filter((s) => s !== e.seat);
        world.shared.order = order;
        if (order.length > 0) world.shared.turn = world.shared.turn % order.length;
      },
      roundStart(world) {
        world.shared.turn = 0;
        world.shared.totals = {};
        world.shared.banner = 'Roll!';
        world.shared.turnNo += 1;
        world.after(world.ticks(TURN_SECONDS), 'timeout', { turnNo: world.shared.turnNo });
      },
      rolled(world, e) {
        const order = world.shared.order;
        if (world.round.phase !== 'live' || order.length === 0) return;
        if (order[world.shared.turn % order.length] !== e.seat) return;      // not your turn
        const face = 1 + Math.floor(world.random() * 6);
        const key = String(e.seat);
        const total = (key in world.shared.totals ? world.shared.totals[key] : 0) + face;
        world.shared.totals = { ...world.shared.totals, [key]: total };
        world.shared.lastFace = face;
        world.shared.banner = 'Seat ' + key + ' rolled ' + String(face);
        if (key in world.shared.ids) world.send(world.shared.ids[key], 'gain', { points: face });
        world.emit('dice', { x: 0, y: 0, z: 0 }, { face, seat: e.seat });
        if (total >= GOAL) {
          world.shared.banner = 'Seat ' + key + ' wins';
          // Two ticks for the last points to land on the winner before the results are read.
          world.after(2, 'close', { round: world.round.n });
          return;
        }
        world.shared.turn = (world.shared.turn + 1) % order.length;
        world.shared.turnNo += 1;
        world.after(world.ticks(TURN_SECONDS), 'timeout', { turnNo: world.shared.turnNo });
      },
      timeout(world, e) {
        // An old timer: somebody rolled in time and the turn has moved on.
        if (e.turnNo !== world.shared.turnNo || world.round.phase !== 'live') return;
        const order = world.shared.order;
        if (order.length > 0) world.shared.turn = (world.shared.turn + 1) % order.length;
        world.shared.turnNo += 1;
        world.after(world.ticks(TURN_SECONDS), 'timeout', { turnNo: world.shared.turnNo });
      },
      close(world, e) { if (e.round === world.round.n && world.round.phase === 'live') world.round.end(); },
    },
  },
  map: './map',
});
