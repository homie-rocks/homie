import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

// Hot potato: one runner holds the bomb and can pass it to a runner close by. When the fuse runs out the holder is
// out; everybody still in gets a point. The last one in wins the round.
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shapes: {
    events: {
      deal: {}, boom: {}, settle: {}, explode: {},
      take: { from: f.ref() }, passed: { to: f.ref() }, lost: { id: f.ref() },
    },
    commands: { emote: { kind: f.u8() } },
    effects: { bang: {}, emote: { kind: f.u8() } },
  },
  shared: {
    holder: f.ref(), fuseEnds: f.tick(), lostAt: f.tick(),
    out: f.list(f.ref(), 32), passes: f.map(f.u16(), 32),
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), hasBomb: f.bit(), canPassAt: f.tick() },
      motion: { out: f.bit() },
      input: { ax: f.i8(), ay: f.i8(), pass: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 5, move: 'owner' },
      think(world, self) {
        if (self.motion.out) return { ax: 0, ay: 0, pass: false };
        let best = null;
        let bestDist = 1000;
        for (const other of world.near(self.pos, 40, 'runner')) {
          if (other.id === self.id || other.motion.out) continue;
          if (!self.hasBomb && !other.hasBomb) continue;
          const d = world.math.dist(self.pos, other.pos);
          if (d < bestDist) { bestDist = d; best = other; }
        }
        if (!best) return { ax: 0, ay: 0, pass: false };
        const toward = world.math.norm(world.math.sub(best.pos, self.pos));
        const sign = self.hasBomb ? 1 : -1;
        return { ax: Math.round(toward.x * 127 * sign), ay: Math.round(toward.y * 127 * sign), pass: self.hasBomb && bestDist < 2 };
      },
      tick(world, self) {
        if (!self.hasBomb || !self.input.pass || world.tick < self.canPassAt) return;
        let best = '';
        let bestDist = 2.5;
        for (const other of world.near(self.pos, 2.5, 'runner')) {
          if (other.id === self.id || other.motion.out) continue;
          const d = world.math.dist(self.pos, other.pos);
          if (d < bestDist) { bestDist = d; best = other.id; }
        }
        if (best === '') return;
        self.hasBomb = false;
        world.send(best, 'take', { from: self.id });
        world.sendRoom('passed', { to: best });
      },
      commands: {
        emote(world, self, e) { world.emit('emote', self.id, { kind: e.kind % 4 }); },
      },
      on: {
        take(world, self) {
          self.hasBomb = true;
          self.canPassAt = world.tick + world.ticks(0.5);
        },
        undeliverable(world, self, e) {
          // The runner the bomb was thrown to has gone: keep it.
          if (e.event === 'take') self.hasBomb = true;
        },
      },
      onRoom: {
        roundStart(world, self) { self.score = 0; self.hasBomb = false; self.motion.out = false; self.canPassAt = 0; },
        explode(world, self) {
          if (self.motion.out) return;
          if (self.hasBomb) {
            self.hasBomb = false;
            self.motion.out = true;
            world.emit('bang', self.pos, {});
            world.sendRoom('lost', { id: self.id });
          } else {
            self.score += 1;
          }
        },
      },
    },
  },
  room: {
    rounds: { seconds: 0, breakSeconds: 3 }, bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) {
        world.shared.holder = '';
        world.shared.out = [];
        world.shared.passes = {};
        world.after(world.ticks(1), 'deal', {});
      },
      deal(world) {
        if (world.round.phase !== 'live') return;
        const all = world.inBox({ min: { x: -60, y: -60 }, max: { x: 60, y: 60 } }, 'runner');
        const inPlay = all.filter((r) => !r.motion.out);
        if (inPlay.length <= 1) { world.round.end(); return; }
        const pick = inPlay[Math.floor(world.random() * inPlay.length)];
        world.send(pick.id, 'take', { from: '' });
        world.shared.holder = pick.id;
        world.shared.fuseEnds = world.tick + world.ticks(6);
        world.after(world.ticks(6), 'boom', {});
      },
      passed(world, e) {
        world.shared.holder = e.to;
        const passes = { ...world.shared.passes };
        passes[e.to] = (e.to in passes ? passes[e.to] : 0) + 1;
        world.shared.passes = passes;
      },
      boom(world) {
        if (world.round.phase !== 'live') return;
        world.announce('explode', {});
        world.after(4, 'settle', {});
      },
      lost(world, e) {
        world.shared.lostAt = world.tick;
        if (world.shared.out.length < 32) world.shared.out = [...world.shared.out, e.id];
      },
      settle(world) {
        if (world.round.phase !== 'live') return;
        world.shared.holder = '';
        world.after(world.ticks(1), 'deal', {});
      },
    },
  },
});
