// Game truth lives here: declared fields, legal inputs, next-tick events and the server clock.
// Read the game skill RULES.md before changing the mechanic; keep presentation in view.ts.
import { defineRules, f, type GameWorld } from '@homie-rocks/studio/rules';
import { move } from './move';

function gemPoint(world: Pick<GameWorld, 'random' | 'map' | 'math'>) {
  let p = { x: 1.2 + world.random() * 23.6, y: 1.2 + world.random() * 13.6, z: 0 };
  for (let i = 0; i < 12; i++) {
    let blocked = false;
    for (const o of world.map.spots('obstacles')) if (world.math.dist(p, { x: o.x, y: o.y, z: 0 }) < o.z + 0.7) blocked = true;
    if (!blocked) break;
    p = { x: 1.2 + world.random() * 23.6, y: 1.2 + world.random() * 13.6, z: 0 };
  }
  return p;
}

export default defineRules({
  contract: 2, space: { dims: 3 }, move,
  shapes: {
    events: { hit: { from: f.vec3(), by: f.ref() }, take: { by: f.ref(), at: f.vec3() }, score: { value: f.u8() }, zone: {} },
    effects: { wave: {}, knock: { dir: f.dir(), by: f.ref() } },
  },
  shared: { gemSeq: f.u32(), zone: f.vec3(), zoneN: f.u32(), zoneUntil: f.tick() },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), pickups: f.u16(), target: f.vec3(), noticed: f.fix(), arrived: f.bit(), targetGem: f.ref() },
      motion: { speed: f.fix({ init: 6.8 }), accel: f.fix({ init: 14 }), knockDir: f.dir(), knockFrom: f.vec3(), knockAt: f.fix(), knockUntil: f.fix() },
      input: { ax: f.i8(), ay: f.i8(), wave: f.press() },
      body: { shape: 'capsule', radius: 0.44, height: 1.2, maxSpeed: 6.8 },
      tick(world, self) {
        if (self.driver === 'person' && !self.away) { self.motion.speed = 6.8; self.motion.accel = 14; }
        if (self.input.wave) {
          world.emit('wave', self.id, {});
          world.sendArea({ sphere: { at: self.pos, r: world.tune.knockRange } }, 'hit', { from: self.pos, by: self.id });
        }
        if (world.round.phase === 'live') for (const gem of world.near(self.pos, 0.7, 'gem')) world.send(gem.id, 'take', { by: self.id, at: self.pos });
      },
      think(world, self) {
        const M = world.math;
        self.motion.speed = 5; self.motion.accel = 5;
        if (world.stage === 'dummy' || self.motion.knockAt > 0) return { ax: 0, ay: 0 };
        const level = (world.kids ? Math.min(3, world.level) : world.level) - 1;
        const reactions = [650, 420, 250, 170, 110];
        const noise = [0.55, 0.3, 0.15, 0.07, 0.02];
        const aggression = [0.1, 0.3, 0.5, 0.7, 0.9];
        const positioning = [0.1, 0.35, 0.5, 0.75, 0.95];
        if (self.noticed === 0 || world.tick - self.noticed >= reactions[level] / 1000 / world.dt) {
          let best = self.pos, nearest = 10000;
          self.targetGem = '';
          const rivals = world.near(self.pos, 64, 'runner');
          for (const gem of world.near(self.pos, 64, 'gem')) {
            if (rivals.some(p => p.id !== self.id && p.noticed === world.tick && p.targetGem === gem.id)) continue;
            const hot = M.dist(gem.pos, world.shared.zone) < 3;
            const distance = M.dist(gem.pos, self.pos) * (hot ? 1.5 - positioning[level] : 1);
            if (distance < nearest) { nearest = distance; best = gem.pos; self.targetGem = gem.id; }
          }
          self.target = { x: best.x + (world.random() - 0.5) * 4 * noise[level], y: best.y + (world.random() - 0.5) * 4 * noise[level], z: 0 };
          self.noticed = world.tick; self.arrived = false;
        }
        const d = M.sub(self.target, self.pos), distance = M.len(d);
        if (distance < 0.12 && !self.arrived) { self.arrived = true; self.noticed = world.tick; }
        const v = distance < 0.12 ? { x: 0, y: 0, z: 0 } : M.norm(d);
        let rival = false;
        for (const p of world.near(self.pos, world.tune.knockRange, 'runner')) if (p.id !== self.id) rival = true;
        return { ax: Math.round(v.x * 127), ay: Math.round(v.y * 127), wave: rival && world.round.phase === 'live' && world.random() < Math.min(world.kids ? 0.3 : 1, aggression[level]) * 0.8 * world.dt };
      },
      on: {
        score(world, self, e) { self.score += e.value; self.pickups += 1; },
        takeover(world, self) { self.motion.speed = 6.8; self.motion.accel = 14; self.motion.knockAt = 0; self.motion.knockUntil = 0; self.vel = { x: 0, y: 0, z: 0 }; },
        arrive(world, self) {
          if (world.stage === 'dummy') {
            let index = 0;
            for (const p of world.near(self.pos, 64, 'runner')) if (p.driver === 'bot' && p.seat < self.seat) index++;
            world.place(self, self.driver === 'person' ? { x: 9.8, y: 8, z: 0 } : index === 0 ? { x: 11.64, y: 8, z: 0 } : { x: 22.4, y: 3 + (index - 1) * 10, z: 0 });
          }
        },
        hit(world, self, e) {
          if (e.by === self.id) return;
          const M = world.math, m = self.motion, delta = M.sub(self.pos, e.from);
          m.knockDir = M.len(delta) < 0.02 ? M.dir(world.random() * M.TAU) : M.norm(delta);
          m.knockFrom = self.pos;
          m.knockAt = world.tick + world.tune.hitStopMs / 1000 / world.dt;
          m.knockUntil = m.knockAt + world.tune.knockMs / 1000 / world.dt;
          world.emit('knock', self.id, { dir: m.knockDir, by: e.by });
        },
      },
      onRoom: {
        roundStart(world, self) {
          self.score = 0; self.pickups = 0; self.noticed = 0;
          self.motion.knockAt = 0; self.motion.knockUntil = 0;
          const spots = world.map.spots('start');
          if (world.stage !== 'dummy') world.place(self, spots[self.seat % spots.length]);
          else {
            let index = 0;
            for (const p of world.near(self.pos, 64, 'runner')) if (p.driver === 'bot' && p.seat < self.seat) index++;
            world.place(self, self.driver === 'person' ? { x: 9.8, y: 8, z: 0 } : index === 0 ? { x: 11.64, y: 8, z: 0 } : { x: 22.4, y: 3 + (index - 1) * 10, z: 0 });
          }
        },
      },
    },
    gem: {
      fields: { takenAt: f.tick(), serial: f.u32() },
      on: {
        take(world, self, e) {
          if (self.takenAt === world.tick || world.math.dist(e.at, self.pos) >= 0.7) return;
          self.takenAt = world.tick;
          world.send(e.by, 'score', { value: world.math.dist(self.pos, world.shared.zone) < 3 ? 2 : 1 });
          world.place(self, gemPoint(world));
          self.serial += 14;
        },
      },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
  },
  room: {
    rounds: { seconds: 60, breakSeconds: 7 }, bots: { keep: 3 },
    join(ctx, player) { const spots = ctx.map.spots('start'); return { kind: 'runner', at: spots[player.seat % spots.length] }; },
    on: {
      roundStart(world) {
        for (let i = 0; i < 14; i++) { world.shared.gemSeq += 1; world.spawn('gem', gemPoint(world), { serial: world.shared.gemSeq }); }
        world.shared.zone = { x: 4.4 + world.random() * 17.2, y: 4 + world.random() * 8, z: 0 };
        world.shared.zoneN += 1; world.shared.zoneUntil = world.tick + world.ticks(12);
        world.after(world.ticks(12), 'zone', {});
      },
      zone(world) {
        if (world.round.phase !== 'live') return;
        world.shared.zone = { x: 4.4 + world.random() * 17.2, y: 4 + world.random() * 8, z: 0 };
        world.shared.zoneN += 1; world.shared.zoneUntil = world.tick + world.ticks(12);
        world.after(world.ticks(12), 'zone', {});
      },
    },
  },
  map: './map',
});
