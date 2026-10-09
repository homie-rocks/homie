// RELAY RACE: two teams. The runner with the baton touches the four posts in order, then hands the baton to a
// team-mate by touching them. Every hand-over is a lap. First team to five laps wins the round.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const LAPS = 5;
const POSTS = 4;

export default defineRules({
  contract: 2,

  space: { dims: 2 },
  move,
  shapes: {
    events: {
      baton: { from: f.ref() }, handed: {}, lap: { team: f.u8(), by: f.ref() }, deal: {},
    },
    commands: {},
    effects: { post: { n: f.u8() }, pass: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), team: f.u8(), baton: f.bit(), next: f.u8(), offered: f.ref(), offerAt: f.tick() },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live' || !self.baton) return;
        const posts = world.map.spots('coins');
        if (self.next < POSTS) {
          if (world.math.dist(self.pos, posts[self.next]) < 1) {
            world.emit('post', self.pos, { n: self.next });
            self.next += 1;
          }
          return;
        }
        // All four posts touched: hand over to a team-mate, or run on alone if the team is one runner.
        if (self.offered !== '' && world.tick < self.offerAt + 10) return;
        const mates = world.near(self.pos, 64, 'runner').filter((r) => r.team === self.team && r.id !== self.id);
        if (mates.length === 0) {
          self.next = 0;
          self.score += 1;
          world.sendRoom('lap', { team: self.team, by: self.id });
          return;
        }
        const mate = mates[0];
        if (world.math.dist(self.pos, mate.pos) < 1.3) {
          self.offered = mate.id;
          self.offerAt = world.tick;
          world.send(mate.id, 'baton', { from: self.id });
        }
      },
      think(world, self) {
        const posts = world.map.spots('coins');
        let target = posts[0];
        if (self.baton && self.next < POSTS) target = posts[self.next];
        else if (self.baton) {
          const mate = world.near(self.pos, 64, 'runner').find((r) => r.team === self.team && r.id !== self.id);
          if (mate) target = mate.pos;
        } else {
          const carrier = world.near(self.pos, 64, 'runner').find((r) => r.team === self.team && r.baton);
          if (carrier) target = carrier.pos;
        }
        const to = world.math.sub(target, self.pos);
        if (world.math.len(to) < 0.4) return { ax: 0, ay: 0 };
        const d = world.math.norm(to);
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127) };
      },
      on: {
        baton(world, self, e) {
          self.baton = true;
          self.next = 0;
          if (e.from !== '') world.send(e.from, 'handed', {});
        },
        handed(world, self) {
          if (!self.baton) return;
          self.baton = false;
          self.offered = '';
          self.score += 1;
          world.emit('pass', self.pos, {});
          world.sendRoom('lap', { team: self.team, by: self.id });
        },
        undeliverable(world, self, e) {
          // The team-mate left as the baton was offered: keep it and look for another.
          if (e.event === 'baton') self.offered = '';
        },
        arrive(world, self) {
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
          else world.sendRoom('deal', {});
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.baton = false;
          self.next = 0;
          self.offered = '';
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
  },
  shared: { laps: f.list(f.u8(), 2), last: f.struct({ team: f.u8(), by: f.ref(), at: f.tick() }) },
  room: {
    rounds: { seconds: 180, breakSeconds: 6 },
    bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length], fields: { team: player.seat % 2 } };
    },
    on: {
      roundStart(world) {
        world.shared.laps = [0, 0];
        world.after(2, 'deal', {});
      },
      deal(world) {
        // Every team with runners and no baton gets one, in the hands of its lowest seat.
        if (world.round.phase !== 'live') return;
        const all = world.inBox({ min: { x: -60, y: -60 }, max: { x: 60, y: 60 } }, 'runner');
        for (const team of [0, 1]) {
          const mates = all.filter((r) => r.team === team);
          if (mates.length === 0 || mates.some((r) => r.baton)) continue;
          let first = mates[0];
          for (const r of mates) if (r.seat < first.seat) first = r;
          world.send(first.id, 'baton', { from: '' });
        }
      },
      lap(world, e) {
        if (world.round.phase !== 'live') return;
        const laps = [...world.shared.laps];
        laps[e.team] += 1;
        world.shared.laps = laps;
        world.shared.last = { team: e.team, by: e.by, at: world.tick };
        if (laps[e.team] >= LAPS) world.round.end();
      },
    },
  },
});
