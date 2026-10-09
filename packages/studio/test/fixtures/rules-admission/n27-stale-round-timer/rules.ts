// HIDE AND SEEK: one seeker counts to five while the others hide. A hider the seeker can see within three metres is
// found and sits out. Hiders still free at the end get three points; the seeker gets one for each hider found.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const COUNT_SECONDS = 5;
const SEE = 3;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: { seek: {}, found: { by: f.ref() }, point: { n: f.u8() }, choose: {}, tally: {}, payout: { round: f.u32() } },
    commands: {},
    effects: { spotted: {}, ready: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), seeker: f.bit(), found: f.bit(), lookAt: f.tick() },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live' || !self.seeker) return;
        if (world.tick < self.motion.frozenUntil || world.tick < self.lookAt) return;
        self.lookAt = world.tick + world.ticks(0.25);
        for (const other of world.near(self.pos, SEE, 'runner')) {
          if (other.id === self.id || other.found) continue;
          const to = world.math.sub(other.pos, self.pos);
          const dist = world.math.len(to);
          // A wall between us hides them.
          const hit = dist > 0.01 ? world.ray(self.pos, world.math.norm(to), dist) : undefined;
          if (hit && hit.entity !== other.id) continue;
          world.send(other.id, 'found', { by: self.id });
        }
      },
      think(world, self) {
        if (self.found) return { ax: 0, ay: 0 };
        const others = world.near(self.pos, 64, 'runner').filter((r) => r.id !== self.id);
        if (self.seeker) {
          const prey = others.find((r) => !r.found);
          if (!prey) return { ax: 0, ay: 0 };
          const d = world.math.norm(world.math.sub(prey.pos, self.pos));
          return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127) };
        }
        const hunter = others.find((r) => r.seeker);
        if (!hunter) return { ax: 0, ay: 0 };
        const away = world.math.norm(world.math.sub(self.pos, hunter.pos));
        return { ax: Math.round(away.x * 127), ay: Math.round(away.y * 127) };
      },
      on: {
        seek(world, self) {
          self.seeker = true;
          self.found = false;
          self.motion.frozenUntil = world.tick + world.ticks(COUNT_SECONDS);
          world.emit('ready', self.pos, {});
        },
        found(world, self, e) {
          if (self.found || self.seeker) return;
          self.found = true;
          self.motion.frozenUntil = world.round.endsAt > world.tick ? world.round.endsAt : world.tick + world.ticks(600);
          world.emit('spotted', self.pos, {});
          world.send(e.by, 'point', { n: 1 });
          world.sendRoom('tally', {});
        },
        point(world, self, e) { self.score += e.n; },
        arrive(world, self) {
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.seeker = false;
          self.found = false;
          self.lookAt = 0;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        payout(world, self) { if (!self.seeker && !self.found) self.score += 3; },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
  },
  shared: { seeker: f.ref(), hiding: f.u8() },
  room: {
    rounds: { seconds: 0, breakSeconds: 5 },
    bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world, e) {
        world.shared.seeker = '';
        world.shared.hiding = 0;
        world.after(2, 'choose', {});
        world.after(world.ticks(45), 'payout', { round: e.n });
      },
      choose(world) {
        if (world.round.phase !== 'live' || world.shared.seeker !== '') return;
        const all = world.inBox({ min: { x: -60, y: -60 }, max: { x: 60, y: 60 } }, 'runner');
        if (all.length < 2) { world.after(world.ticks(1), 'choose', {}); return; }
        const pick = all[Math.floor(world.random() * all.length)];
        world.shared.seeker = pick.id;
        world.shared.hiding = all.length - 1;
        world.send(pick.id, 'seek', {});
      },
      tally(world) {
        if (world.round.phase !== 'live') return;
        const all = world.inBox({ min: { x: -60, y: -60 }, max: { x: 60, y: 60 } }, 'runner');
        const hiding = all.filter((r) => !r.seeker && !r.found).length;
        world.shared.hiding = hiding;
        if (hiding === 0) world.round.end();
      },
      payout(world, e) {
        // The timer of an earlier round that ended early pays nobody.
        if (world.round.phase !== 'live') return;
        world.announce('payout', { round: e.round });
        world.round.end();
      },
    },
  },
});
