// HOLD THE WELL: everybody on one side. Slimes come in waves for the well in the middle; keep it alive.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const WELL_HP = 30;
const SLIME_SPEED = 2.5;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      hurt: { by: f.ref(), damage: f.u8() },
      slain: { by: f.ref() },
      score: { points: f.u8() },
      bite: { damage: f.u8() },
      wellHit: { damage: f.u8() },
      wave: { round: f.u32() },
    },
    commands: {},
    effects: { zap: { to: f.vec3() }, pop: {}, crack: {} },
  },
  entities: {
    hero: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), fireAt: f.tick() },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live' || world.tick < self.fireAt) return;
        const slime = world.near(self.pos, 5, 'slime')[0];      // nearest first
        if (!slime) return;
        self.fireAt = world.tick + world.ticks(0.4);
        world.send(slime.id, 'hurt', { by: self.id, damage: 1 });
        world.emit('zap', self.pos, { to: slime.pos });
      },
      think(world, self) {
        const slime = world.near(self.pos, 64, 'slime')[0];
        if (!slime) return { ax: 0, ay: 0 };
        if (world.math.dist(slime.pos, self.pos) < 4) return { ax: 0, ay: 0 };
        const d = world.math.norm(world.math.sub(slime.pos, self.pos));
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127) };
      },
      on: {
        score(world, self, e) { self.score += e.points; },
        arrive(world, self) { if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt; },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0; self.fireAt = 0; self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
    slime: {
      fields: { hp: f.u8({ init: 2 }), well: f.ref(), target: f.vec3() },
      body: { shape: 'circle', radius: 0.4, maxSpeed: SLIME_SPEED },
      tick(world, self) {
        const to = world.math.sub(self.target, self.pos);
        if (world.math.len(to) < 1.6) {
          world.send(self.well, 'bite', { damage: 1 });
          world.emit('pop', self.pos, {});
          world.despawn(self);
          return;
        }
        const step = world.math.scale(world.math.norm(to), SLIME_SPEED * world.dt);
        self.vel = world.math.scale(world.math.norm(to), SLIME_SPEED);
        world.sweep(self, step, { ignore: [self.well] });
      },
      on: {
        hurt(world, self, e) {
          if (self.hp > e.damage) { self.hp -= e.damage; return; }
          world.send(e.by, 'score', { points: 1 });
          world.sendRoom('slain', { by: e.by });
          world.emit('pop', self.pos, {});
          world.despawn(self);
        },
      },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
    well: {
      body: { shape: 'circle', radius: 1, maxSpeed: 0 },
      on: { bite(world, self, e) { world.sendRoom('wellHit', { damage: e.damage }); world.emit('crack', self.pos, {}); } },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
  },
  shared: { wave: f.u16(), wellHp: f.u16(), slain: f.u32(), well: f.ref() },
  room: {
    rounds: { seconds: 10, breakSeconds: 3 },
    bots: { keep: 3 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'hero', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) {
        world.shared.wave = 0;
        world.shared.slain = 0;
        world.shared.wellHp = WELL_HP;
        world.shared.well = world.spawn('well', { x: 0, y: 3, z: 0 }, {});
        world.after(world.ticks(1), 'wave', { round: world.round.n });
      },
      wave(world, e) {
        // A timer from a round that is over starts nothing.
        if (e.round !== world.round.n || world.round.phase !== 'live') return;
        world.shared.wave += 1;
        const gates = world.map.spots('coins');
        const count = Math.min(gates.length, 2 + world.shared.wave);
        for (let i = 0; i < count; i += 1) {
          const gate = gates[Math.floor(world.random() * gates.length)];
          world.spawn('slime', gate, { hp: 1 + Math.floor(world.shared.wave / 3), well: world.shared.well, target: { x: 0, y: 3, z: 0 } });
        }
        world.after(world.ticks(2.5), 'wave', { round: world.round.n });
      },
      slain(world) { world.shared.slain += 1; },
      wellHit(world, e) {
        if (world.round.phase !== 'live') return;
        world.shared.wellHp = Math.max(0, world.shared.wellHp - e.damage);
        if (world.shared.wellHp === 0) world.round.end();
      },
    },
  },
  map: './map',
});
