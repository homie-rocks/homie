import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

// Independent shuttle runs: constant work per runner; no all-pairs collision or queries.
export default defineRules({
  contract: 2, space: { dims: 2 }, move, map: './map',
  shapes: { events: {}, commands: {}, effects: {} }, shared: {},
  entities: {
    runner: {
      player: { away: 'think', leave: 'despawn' },
      fields: { score: f.u16({ score: true }), east: f.bit({ init: true }) },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.35, maxSpeed: 6 },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        if ((self.east && self.pos.x >= 8) || (!self.east && self.pos.x <= -8)) {
          self.score += 1; self.east = !self.east;
        }
      },
      think(world, self) { return { ax: self.east ? 127 : -127, ay: 0 }; },
      on: {
        arrive(world, self) {
          self.score = 0; self.east = true;
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          self.score = 0; self.east = true; self.motion.frozenUntil = 0;
          const spots = world.map.spots('start');
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
  },
  room: {
    rounds: { seconds: 60, breakSeconds: 5 }, bots: { keep: 2 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
  },
});
