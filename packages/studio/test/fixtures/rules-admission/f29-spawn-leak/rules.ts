// ARENA: run for orbs, zap the others. The base every planted fault is cut from.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: { take: { by: f.ref() }, score: { points: f.u8() }, hit: { by: f.ref(), damage: f.u8() }, tally: { points: f.u8() }, respawn: {} },
    commands: { cheer: {} },
    effects: { ding: {}, zap: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), hp: f.u8({ init: 3 }), zapAt: f.tick(), cheers: f.u16() },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8(), fire: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        world.spawn('spark', self.pos, { born: world.tick });
        for (const orb of world.near(self.pos, 1, 'orb')) world.send(orb.id, 'take', { by: self.id });
        if (self.input.fire && world.tick >= self.zapAt) {
          self.zapAt = world.tick + world.ticks(1);
          const target = world.near(self.pos, 3, 'runner').find((r) => r.id !== self.id);
          if (target) {
            world.send(target.id, 'hit', { by: self.id, damage: 1 });
            world.emit('zap', self.pos, {});
          }
        }
      },
      think(world, self) {
        const orb = world.near(self.pos, 64, 'orb')[0];
        if (!orb) return { ax: 0, ay: 0, fire: false };
        const d = world.math.norm(world.math.sub(orb.pos, self.pos));
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127), fire: world.random() < 0.2 };
      },
      commands: {
        cheer(world, self) { self.cheers += 1; },
      },
      on: {
        score(world, self, e) {
          self.score += e.points;
          world.sendRoom('tally', { points: e.points });
        },
        hit(world, self, e) {
          if (self.hp > e.damage) { self.hp -= e.damage; return; }
          self.hp = 3;
          world.send(e.by, 'score', { points: 2 });
          const spots = world.map.spots('start');
          world.place(self, spots[self.seat % spots.length]);
          self.motion.frozenUntil = world.tick + world.ticks(1);
        },
        arrive(world, self) {
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.hp = 3;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
    spark: { fields: { born: f.tick() } },
    orb: {
      on: {
        take(world, self, e) {
          world.send(e.by, 'score', { points: 1 });
          world.emit('ding', self.pos, {});
          world.despawn(self);
        },
      },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
  },
  shared: { total: f.u32() },
  room: {
    rounds: { seconds: 5, breakSeconds: 2 },
    bots: { keep: 3 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) {
        world.shared.total = 0;
        for (const spot of world.map.spots('coins')) world.spawn('orb', spot, {});
      },
      tally(world, e) { world.shared.total += e.points; },
    },
  },
  map: './map',
});
