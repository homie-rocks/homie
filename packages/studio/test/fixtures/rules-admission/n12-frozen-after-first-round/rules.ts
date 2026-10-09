// CAPTURE THE FLAG: two teams. Touch the other team's flag to pick it up, carry it to your own base to score.
// An enemy who touches you while you carry makes you drop it; it goes home. First team to three wins the round.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const WIN = 3;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      grab: { by: f.ref() }, gotFlag: { flag: f.ref() }, release: {}, tagged: {},
      capture: { team: f.u8() },
    },
    commands: {},
    effects: { cheer: { team: f.u8() }, drop: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), team: f.u8(), carrying: f.ref() },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        const bases = world.map.spots('start');
        const home = bases[self.team % bases.length];
        if (self.carrying !== '') {
          if (world.math.dist(self.pos, home) < 1.5) {
            world.send(self.carrying, 'release', {});
            self.carrying = '';
            self.score += 1;
            world.sendRoom('capture', { team: self.team });
            world.emit('cheer', self.pos, { team: self.team });
          }
          return;
        }
        for (const flag of world.near(self.pos, 1.2, 'flag')) {
          if (flag.team !== self.team && flag.holder === '') world.send(flag.id, 'grab', { by: self.id });
        }
        for (const other of world.near(self.pos, 1.2, 'runner')) {
          if (other.team !== self.team && other.carrying !== '') world.send(other.id, 'tagged', {});
        }
      },
      think(world, self) {
        const bases = world.map.spots('start');
        let target = bases[self.team % bases.length];
        if (self.carrying === '') {
          const flag = world.near(self.pos, 64, 'flag').find((x) => x.team !== self.team);
          if (flag) target = flag.pos;
        }
        const d = world.math.norm(world.math.sub(target, self.pos));
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127) };
      },
      on: {
        gotFlag(world, self, e) {
          if (self.carrying !== '') { world.send(e.flag, 'release', {}); return; }
          self.carrying = e.flag;
        },
        tagged(world, self) {
          if (self.carrying === '') return;
          world.send(self.carrying, 'release', {});
          world.emit('drop', self.pos, {});
          self.carrying = '';
          self.motion.frozenUntil = world.tick + world.ticks(1);
        },
        arrive(world, self) {
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const bases = world.map.spots('start');
          self.score = 0;
          self.carrying = '';
          world.place(self, bases[self.seat % bases.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.tick + world.ticks(100000); },
      },
    },
    flag: {
      fields: { team: f.u8(), holder: f.ref(), home: f.vec3(), heldAt: f.tick() },
      tick(world, self) {
        if (self.holder === '') return;
        const carrier = world.near(self.pos, 64, 'runner').find((r) => r.id === self.holder);
        const settled = world.tick > self.heldAt + 5;
        if (!carrier || (settled && carrier.carrying !== self.id)) {
          // The carrier left, or never took it: the flag goes home.
          self.holder = '';
          world.place(self, self.home);
          return;
        }
        world.place(self, carrier.pos);
      },
      on: {
        grab(world, self, e) {
          if (self.holder !== '') return;
          self.holder = e.by;
          self.heldAt = world.tick;
          world.send(e.by, 'gotFlag', { flag: self.id });
        },
        release(world, self) {
          self.holder = '';
          world.place(self, self.home);
        },
      },
      onRoom: {
        roundStart(world, self) { self.holder = ''; world.place(self, self.home); },
      },
    },
  },
  shared: { red: f.u8(), blue: f.u8() },
  room: {
    rounds: { seconds: 120, breakSeconds: 5 },
    bots: { keep: 4 },
    start(world) {
      const bases = world.map.spots('start');
      world.spawn('flag', bases[0], { team: 0, home: bases[0] });
      world.spawn('flag', bases[1], { team: 1, home: bases[1] });
    },
    join(ctx, player) {
      const bases = ctx.map.spots('start');
      return { kind: 'runner', at: bases[player.seat % bases.length], fields: { team: player.seat % 2 } };
    },
    on: {
      roundStart(world) { world.shared.red = 0; world.shared.blue = 0; },
      capture(world, e) {
        if (world.round.phase !== 'live') return;
        if (e.team === 0) world.shared.red += 1; else world.shared.blue += 1;
        if (world.shared.red >= WIN || world.shared.blue >= WIN) world.round.end();
      },
    },
  },
});
