// LAST ONE STANDING: the safe zone shrinks every two seconds. Outside it you lose a heart a second. Dash into the
// others to knock them back. The last fighter in wins; everybody scores the number of fighters they outlasted.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const HEARTS = 3;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      shrink: { round: f.u32() }, fell: { id: f.ref() }, bump: { from: f.vec3() },
      outlasted: {}, recount: {}, welcome: { id: f.ref() },
    },
    commands: { taunt: { emoji: f.u8() } },
    effects: { hurt: {}, out: {}, taunt: { emoji: f.u8() } },
  },
  entities: {
    fighter: {
      player: { away: 'think', leave: 'despawn' },
      fields: { score: f.u16({ score: true }), hearts: f.u8({ init: HEARTS }), hurtAt: f.tick(), dashAt: f.tick() },
      motion: { out: f.bit(), frozenUntil: f.tick(), dashUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8(), dash: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 9, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live' || self.motion.out) return;
        if (self.input.dash && world.tick >= self.dashAt) {
          self.dashAt = world.tick + world.ticks(1.5);
          self.motion.dashUntil = world.tick + world.ticks(0.3);
        }
        if (world.tick < self.motion.dashUntil) {
          for (const other of world.near(self.pos, 1.2, 'fighter')) {
            if (other.id !== self.id && !other.motion.out) world.send(other.id, 'bump', { from: self.pos });
          }
        }
        const fromCentre = world.math.len(self.pos);
        if (fromCentre > world.shared.radius && world.tick >= self.hurtAt) {
          self.hurtAt = world.tick + world.ticks(1);
          self.hearts = Math.max(0, self.hearts - 1);
          world.emit('hurt', self.pos, {});
          if (self.hearts === 0) {
            self.motion.out = true;
            world.emit('out', self.pos, {});
            world.sendRoom('fell', { id: self.id });
          }
        }
      },
      think(world, self) {
        if (self.motion.out) return { ax: 0, ay: 0, dash: false };
        const fromCentre = world.math.len(self.pos);
        const rival = world.near(self.pos, 3, 'fighter').find((r) => r.id !== self.id && !r.motion.out);
        // Head for the middle when near the edge, otherwise charge whoever is close.
        let to = world.math.scale(self.pos, -1);
        if (rival && fromCentre < world.shared.radius - 2) to = world.math.sub(rival.pos, self.pos);
        if (world.math.len(to) < 0.3) return { ax: 0, ay: 0, dash: false };
        const d = world.math.norm(to);
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127), dash: rival !== undefined && world.random() < 0.1 };
      },
      commands: {
        taunt(world, self, e) { world.emit('taunt', self.id, { emoji: Math.min(5, e.emoji) }); },
      },
      on: {
        bump(world, self, e) {
          if (self.motion.out) return;
          const away = world.math.sub(self.pos, e.from);
          if (world.math.len(away) < 0.01) return;
          world.sweep(self, world.math.scale(world.math.norm(away), 2));
          self.motion.frozenUntil = world.tick + world.ticks(0.2);
        },
        arrive(world, self) {
          // Joined while a round is being fought: watch this one.
          if (world.round.phase === 'live' && world.shared.fighting) self.motion.out = true;
        },
        leave(world, self) { if (!self.motion.out) world.sendRoom('recount', {}); },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.hearts = HEARTS;
          self.hurtAt = 0;
          self.dashAt = 0;
          self.motion.out = false;
          self.motion.frozenUntil = 0;
          self.motion.dashUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        outlasted(world, self) { if (!self.motion.out) self.score += 1; },
      },
    },
  },
  shared: { radius: f.fix(), fighting: f.bit(), left: f.u8() },
  room: {
    rounds: { seconds: 0, breakSeconds: 4 },
    bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'fighter', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world, e) {
        world.shared.radius = world.tune.startRadius;
        world.shared.fighting = false;
        world.after(world.ticks(world.tune.shrinkEvery), 'shrink', { round: e.n });
      },
      shrink(world, e) {
        if (e.round !== world.round.n || world.round.phase !== 'live') return;
        world.shared.fighting = true;
        world.shared.radius = Math.max(0, world.shared.radius - 1);
        world.after(world.ticks(world.tune.shrinkEvery), 'shrink', { round: e.round });
      },
      fell(world) {
        world.announce('outlasted', {});
        world.after(1, 'recount', {});
      },
      seatLeft(world) { world.after(1, 'recount', {}); },
      seatJoined(world, e) { world.after(world.ticks(0.5), 'welcome', { id: e.id }); },
      welcome(world, e) {
        const all = world.inBox({ min: { x: -60, y: -60 }, max: { x: 60, y: 60 } }, 'fighter');
        const who = all.filter((r) => r.id === e.id);
        world.emit('hurt', who[0].pos, {});
      },
      recount(world) {
        if (world.round.phase !== 'live') return;
        const all = world.inBox({ min: { x: -60, y: -60 }, max: { x: 60, y: 60 } }, 'fighter');
        const standing = all.filter((r) => !r.motion.out).length;
        world.shared.left = standing;
        if (world.shared.fighting && standing <= 1) world.round.end();
      },
    },
  },
});
