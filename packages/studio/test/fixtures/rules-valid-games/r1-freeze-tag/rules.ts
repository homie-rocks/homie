import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

// Freeze tag: one runner is "it". Touching a runner freezes them; a free runner touching a frozen one thaws them.
// The round ends early when everyone else is frozen.
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shapes: {
    events: { tagged: { by: f.ref() }, thawed: {}, point: {}, makeIt: {}, count: {} },
    commands: {},
    effects: { freeze: {}, thaw: {} },
  },
  shared: { it: f.ref(), frozen: f.u8(), free: f.u8() },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), it: f.bit() },
      motion: { frozen: f.bit() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      think(world, self) {
        if (self.motion.frozen) return { ax: 0, ay: 0 };
        let best = null;
        let bestDist = 1000;
        for (const other of world.near(self.pos, 40, 'runner')) {
          if (other.id === self.id) continue;
          const wanted = self.it ? !other.motion.frozen : other.motion.frozen;
          if (!wanted) continue;
          const d = world.math.dist(self.pos, other.pos);
          if (d < bestDist) { bestDist = d; best = other; }
        }
        if (!best) return { ax: 0, ay: 0 };
        const dir = world.math.norm(world.math.sub(best.pos, self.pos));
        return { ax: Math.round(dir.x * 127), ay: Math.round(dir.y * 127) };
      },
      tick(world, self) {
        if (world.round.phase !== 'live' || self.motion.frozen) return;
        for (const other of world.near(self.pos, 1.2, 'runner')) {
          if (other.id === self.id) continue;
          if (self.it && !other.motion.frozen && !other.it) world.send(other.id, 'tagged', { by: self.id });
          if (!self.it && other.motion.frozen) world.send(other.id, 'thawed', {});
        }
      },
      on: {
        tagged(world, self, e) {
          if (self.motion.frozen || self.it) return;
          self.motion.frozen = true;
          world.emit('freeze', self.pos, {});
          world.send(e.by, 'point', {});
          world.sendRoom('count', {});
        },
        thawed(world, self) {
          if (!self.motion.frozen) return;
          self.motion.frozen = false;
          world.emit('thaw', self.pos, {});
          world.sendRoom('count', {});
        },
        point(world, self) { self.score += 1; },
        makeIt(world, self) { self.it = true; self.motion.frozen = false; },
      },
      onRoom: {
        roundStart(world, self) { self.score = 0; self.it = false; self.motion.frozen = false; },
      },
    },
  },
  room: {
    rounds: { seconds: 60, breakSeconds: 3 }, bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) {
        world.shared.it = '';
        world.shared.frozen = 0;
        world.after(2, 'count', {});
      },
      seatLeft(world) { world.after(1, 'count', {}); },
      count(world) {
        if (world.round.phase !== 'live') return;
        const all = world.inBox({ min: { x: -60, y: -60, z: 0 }, max: { x: 60, y: 60, z: 0 } }, 'runner');
        let it = '';
        let frozen = 0;
        for (const r of all) {
          if (r.it) it = r.id;
          if (r.motion.frozen) frozen += 1;
        }
        if (it === '' && all.length > 0) {
          const pick = all[Math.floor(world.random() * all.length)];
          world.send(pick.id, 'makeIt', {});
          world.shared.it = pick.id;
          return;
        }
        world.shared.it = it;
        world.shared.frozen = frozen;
        world.shared.free = Math.max(0, all.length - frozen - 1);
        if (all.length > 1 && frozen >= all.length - 1) world.round.end();
      },
    },
  },
});
