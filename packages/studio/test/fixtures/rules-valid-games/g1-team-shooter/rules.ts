// PAINT CLASH: two teams, bullets you can dodge, first team to ten splats takes the round.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const MAX_HP = 100;
const BULLET_SPEED = 18;
const TARGET = 10;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      shot: { by: f.ref(), team: f.u8(), damage: f.u8() },
      score: { points: f.u8() },
      splat: { team: f.u8() },
    },
    commands: { taunt: {} },
    effects: { bang: {}, splat: { team: f.u8() } },
  },
  entities: {
    soldier: {
      player: { away: 'think', leave: 'bot' },
      fields: {
        score: f.u16({ score: true }),
        team: f.u8(),
        hp: f.u8({ init: MAX_HP }),
        fireAt: f.tick(),
        downUntil: f.tick(),
        taunts: f.u16(),
      },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8(), aimx: f.i8(), aimy: f.i8(), fire: f.bit() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        if (self.downUntil > 0) {
          if (world.tick < self.downUntil) return;
          // Back on your feet at your team's end of the field.
          const spots = world.map.spots('start');
          self.downUntil = 0;
          self.hp = MAX_HP;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
          return;
        }
        if (!self.input.fire || world.tick < self.fireAt) return;
        const aim = world.math.norm({ x: self.input.aimx, y: self.input.aimy, z: 0 });
        if (world.math.len(aim) === 0) return;
        self.fireAt = world.tick + world.ticks(0.35);
        self.heading = aim;
        world.spawn('bullet', world.math.add(self.pos, world.math.scale(aim, 0.8)), {
          by: self.id, team: self.team, dir: aim, diesAt: world.tick + world.ticks(1.5),
        });
        world.emit('bang', self.pos, {});
      },
      think(world, self) {
        const foe = world.near(self.pos, 20, 'soldier').find((s) => s.team !== self.team && s.downUntil === 0);
        if (!foe) return { ax: 0, ay: 0, aimx: 0, aimy: 0, fire: false };
        const to = world.math.norm(world.math.sub(foe.pos, self.pos));
        const far = world.math.dist(foe.pos, self.pos) > 6;
        return {
          ax: far ? Math.round(to.x * 127) : 0,
          ay: far ? Math.round(to.y * 127) : 0,
          aimx: Math.round(to.x * 127),
          aimy: Math.round(to.y * 127),
          fire: world.random() < 0.5,
        };
      },
      commands: {
        taunt(world, self) { self.taunts += 1; },
      },
      on: {
        shot(world, self, e) {
          if (e.team === self.team || self.downUntil > 0) return;
          if (self.hp > e.damage) { self.hp -= e.damage; return; }
          self.hp = 0;
          self.downUntil = world.tick + world.ticks(2);
          self.motion.frozenUntil = self.downUntil;
          world.send(e.by, 'score', { points: 1 });
          world.sendRoom('splat', { team: e.team });
          world.emit('splat', self.pos, { team: self.team });
        },
        score(world, self, e) { self.score += e.points; },
        arrive(world, self) {
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.hp = MAX_HP;
          self.downUntil = 0;
          self.fireAt = 0;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
    bullet: {
      fields: { by: f.ref(), team: f.u8(), dir: f.dir(), diesAt: f.tick() },
      body: { shape: 'circle', radius: 0.15, maxSpeed: BULLET_SPEED },
      tick(world, self) {
        if (world.tick >= self.diesAt) { world.despawn(self); return; }
        const hit = world.sweep(self, world.math.scale(self.dir, BULLET_SPEED * world.dt), { ignore: [self.by] });
        if (!hit) return;
        if (hit.entity) world.send(hit.entity, 'shot', { by: self.by, team: self.team, damage: 34 });
        world.despawn(self);
      },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
  },
  shared: { red: f.u16(), blue: f.u16() },
  room: {
    rounds: { seconds: 8, breakSeconds: 2 },
    bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'soldier', at: spots[player.seat % spots.length], fields: { team: player.seat % 2 } };
    },
    on: {
      roundStart(world) { world.shared.red = 0; world.shared.blue = 0; },
      splat(world, e) {
        if (world.round.phase !== 'live') return;
        if (e.team === 0) world.shared.red += 1; else world.shared.blue += 1;
        if (world.shared.red >= TARGET || world.shared.blue >= TARGET) world.round.end();
      },
    },
  },
  map: './map',
});
