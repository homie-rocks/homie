// KING OF THE HILL: stand on the hill alone to score a point every half second. Two on the hill and nobody scores.
// The hill moves to a new place every ten seconds. First to 40 ends the round.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const HILL_RADIUS = 2;
const TARGET = 40;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: { hold: {}, relocate: {}, lead: { score: f.u16(), id: f.ref() }, shove: { from: f.vec3() } },
    commands: { shout: {} },
    effects: { crown: {}, moved: {}, shout: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), shoveAt: f.tick() },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8(), shove: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        if (self.input.shove && world.tick >= self.shoveAt) {
          self.shoveAt = world.tick + world.ticks(2);
          world.sendArea({ sphere: { at: self.pos, r: 1.5 } }, 'shove', { from: self.pos });
        }
      },
      think(world, self) {
        const hill = world.near(self.pos, 64, 'hill')[0];
        if (!hill) return { ax: 0, ay: 0, shove: false };
        const to = world.math.sub(hill.pos, self.pos);
        const crowded = world.near(self.pos, 1.5, 'runner').length > 1;
        if (world.math.len(to) < 0.5) return { ax: 0, ay: 0, shove: crowded };
        const d = world.math.norm(to);
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127), shove: crowded };
      },
      commands: {
        shout(world, self) { world.emit('shout', self.pos, {}); },
      },
      on: {
        hold(world, self) {
          self.score += 1;
          world.sendRoom('lead', { score: self.score, id: self.id });
        },
        shove(world, self, e) {
          const away = world.math.sub(self.pos, e.from);
          if (world.math.len(away) < 0.01) return;        // my own shove
          world.sweep(self, world.math.scale(world.math.norm(away), 1.5));
          self.motion.frozenUntil = world.tick + world.ticks(0.3);
        },
        arrive(world, self) {
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.shoveAt = 0;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
    hill: {
      fields: { payAt: f.tick(), king: f.ref() },
      tick(world, self) {
        if (world.round.phase !== 'live' || world.tick < self.payAt) return;
        self.payAt = world.tick + world.ticks(0.5);
        const on = world.near(self.pos, HILL_RADIUS, 'runner');
        if (on.length === 1) {
          if (self.king !== on[0].id) world.emit('crown', self.pos, {});
          self.king = on[0].id;
          world.send(on[0].id, 'hold', {});
        } else {
          self.king = '';
        }
      },
      on: {
        relocate(world, self) {
          const spots = world.map.spots('coins');
          world.place(self, spots[Math.floor(world.random() * spots.length)]);
          world.emit('moved', self.pos, {});
          self.king = '';
          world.after(world.ticks(10), 'relocate', {});
        },
      },
      onRoom: {
        roundStart(world, self) { self.payAt = 0; self.king = ''; },
      },
    },
  },
  shared: { best: f.u16(), leader: f.ref() },
  room: {
    rounds: { seconds: 90, breakSeconds: 5 },
    bots: { keep: 3 },
    start(world) {
      const id = world.spawn('hill', { x: 0, y: 3 }, {});
      world.send(id, 'relocate', {});
    },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) { world.shared.best = 0; world.shared.leader = ''; },
      lead(world, e) {
        if (world.round.phase !== 'live') return;
        if (e.score > world.shared.best) { world.shared.best = e.score; world.shared.leader = e.id; }
        if (e.score >= TARGET) world.round.end();
      },
    },
  },
});
