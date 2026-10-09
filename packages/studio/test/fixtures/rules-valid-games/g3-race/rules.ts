// LOOP DASH: three laps round the checkpoints. Drive over a boost pad for a second of extra speed.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const LAPS = 3;
const GATE_RADIUS = 3;

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      finished: { id: f.ref(), seat: f.u8(), time: f.ticks() },
      medal: { place: f.u8() },
      close: { round: f.u32() },
    },
    commands: { honk: {} },
    effects: { gate: { lap: f.u8() }, honk: {}, finish: { place: f.u8() } },
  },
  entities: {
    kart: {
      player: { away: 'think', leave: 'bot' },
      fields: {
        score: f.u16({ score: true }),
        lap: f.u8(),
        gate: f.u8(),
        lapStart: f.tick(),
        lapTimes: f.list(f.ticks(), 8),
        best: f.ticks(),
        done: f.bit(),
      },
      motion: { speed: f.fix(), boostUntil: f.tick(), frozenUntil: f.tick() },
      input: { steer: f.i8(), gas: f.bit(), brake: f.bit() },
      body: { shape: 'circle', radius: 0.6, maxSpeed: 10, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live' || self.done) return;
        for (const pad of world.map.spots('boost')) {
          if (world.math.dist(pad, self.pos) < 1.5) self.motion.boostUntil = world.tick + world.ticks(1);
        }
        const gates = world.map.spots('gates');
        if (gates.length === 0) return;
        if (world.math.dist(gates[self.gate % gates.length], self.pos) > GATE_RADIUS) return;
        self.gate += 1;
        if (self.gate % gates.length !== 0) return;
        // Back at the first gate: a lap is done.
        const time = world.tick - self.lapStart;
        self.lap += 1;
        self.lapStart = world.tick;
        self.lapTimes = [...self.lapTimes, time].slice(-8);
        if (self.best === 0 || time < self.best) self.best = time;
        world.emit('gate', self.pos, { lap: self.lap });
        if (self.lap >= LAPS) {
          self.done = true;
          self.motion.frozenUntil = world.round.endsAt;
          world.sendRoom('finished', { id: self.id, seat: self.seat, time: world.tick });
        }
      },
      think(world, self) {
        const gates = world.map.spots('gates');
        if (gates.length === 0 || self.done) return { steer: 0, gas: false, brake: true };
        const to = world.math.sub(gates[self.gate % gates.length], self.pos);
        const turn = world.math.cross(self.heading, world.math.norm(to)).z;      // left is positive
        return { steer: Math.round(world.math.clamp(turn * 3, -1, 1) * 127), gas: true, brake: false };
      },
      commands: { honk(world, self) { world.emit('honk', self.id, {}); } },
      on: {
        medal(world, self, e) { self.score += Math.max(1, 6 - e.place); },
        arrive(world, self) {
          self.lapStart = world.tick;
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const grid = world.map.spots('start');
          self.lap = 0; self.gate = 0; self.done = false; self.best = 0; self.lapTimes = [];
          self.lapStart = world.tick;
          self.motion.speed = 0; self.motion.boostUntil = 0; self.motion.frozenUntil = 0;
          world.place(self, grid[self.seat % grid.length], { heading: { x: 1, y: 0, z: 0 } });
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; self.motion.speed = 0; },
      },
    },
  },
  shared: { podium: f.list(f.struct({ seat: f.u8(), time: f.ticks() }), 32), closing: f.bit() },
  room: {
    rounds: { seconds: 20, breakSeconds: 3 },
    bots: { keep: 3 },
    join(ctx, player) {
      const grid = ctx.map.spots('start');
      return { kind: 'kart', at: grid[player.seat % grid.length], heading: { x: 1, y: 0, z: 0 } };
    },
    on: {
      roundStart(world) { world.shared.podium = []; world.shared.closing = false; },
      finished(world, e) {
        if (world.round.phase !== 'live') return;
        if (world.shared.podium.some((p) => p.seat === e.seat)) return;
        world.shared.podium = [...world.shared.podium, { seat: e.seat, time: e.time }];
        world.send(e.id, 'medal', { place: world.shared.podium.length });
        world.emit('finish', e.id, { place: world.shared.podium.length });
        // Everyone else gets five more seconds once the winner is home.
        if (!world.shared.closing) { world.shared.closing = true; world.after(world.ticks(5), 'close', { round: world.round.n }); }
      },
      close(world, e) { if (e.round === world.round.n && world.round.phase === 'live') world.round.end(); },
    },
  },
  map: './map',
});
