import { defineRules, f, type GameWorld } from '@homie-rocks/studio/rules';
import { move } from './move';

function flatDist(world: Pick<GameWorld, 'math'>, a: { x: number; y: number; z?: number }, b: { x: number; y: number; z?: number }) {
  return world.math.len({ x: a.x - b.x, y: a.y - b.y, z: 0 });
}

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
    events: { hit: { from: f.vec3(), by: f.ref(), dir: f.dir() }, land: {}, notice: { by: f.ref() }, take: { by: f.ref(), at: f.vec3() }, score: { value: f.u8() }, zone: {} },
    effects: { swing: { dir: f.dir() }, jump: {}, dodge: {}, knock: { dir: f.dir(), by: f.ref() } },
  },
  shared: { gemSeq: f.u32(), zone: f.vec3(), zoneN: f.u32(), zoneUntil: f.tick() },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), pickups: f.u16(), target: f.vec3(), noticed: f.fix(), arrived: f.bit(), swingReady: f.tick(), dodgeAt: f.tick(), firstRound: f.u32(), soft: f.fix(), dial: f.u8({ init: 3 }), targetGem: f.ref() },
      motion: { jumpAt: f.tick(), speed: f.fix({ init: 6.2 }), accel: f.fix({ init: 14 }), knockDir: f.dir(), knockFrom: f.vec3(), knockAt: f.fix(), knockUntil: f.fix() },
      input: { ax: f.i8(), ay: f.i8(), jump: f.press(), swing: f.press() },
      body: { shape: 'capsule', radius: 0.44, height: 1.7, maxSpeed: 6.2 },
      tick(world, self) {
        if (self.driver === 'person' && !self.away) { self.motion.speed = 6.2; self.motion.accel = 14; }
        if (self.motion.jumpAt === world.tick) world.emit('jump', self.id, {});
        if (self.input.swing && world.tick >= self.swingReady && self.motion.knockAt === 0) {
          self.swingReady = world.tick + world.ticks((world.tune.windupMs + world.tune.swingRestMs) / 1000);
          world.emit('swing', self.id, { dir: self.heading });
          world.after(Math.max(1, world.ticks(world.tune.windupMs / 1000) - 1), 'land', {});
          world.sendArea({ sphere: { at: self.pos, r: world.tune.knockRange + 0.6 } }, 'notice', { by: self.id });
        }
        if (world.round.phase === 'live') for (const gem of world.near(self.pos, 4, 'gem'))
          if (flatDist(world, self.pos, gem.pos) < 0.74) world.send(gem.id, 'take', { by: self.id, at: self.pos });
      },
      think(world, self) {
        const M = world.math, knocked = self.motion.knockAt > 0;
        const jump = self.dodgeAt > 0 && world.tick >= self.dodgeAt && self.grounded && !knocked;
        if (self.dodgeAt > 0 && world.tick >= self.dodgeAt) self.dodgeAt = 0;
        self.motion.accel = 5;
        if ((world.stage === 'dummy' || world.stage === 'jump') || knocked) { self.motion.speed = 0; return { ax: 0, ay: 0 }; }
        const folk = world.near(self.pos, 64, 'runner').filter(p => p.driver === 'person');
        const easy = folk.some(p => p.firstRound >= world.round.n);
        const level = Math.max(1, (world.kids ? Math.min(3, world.level) : world.level) - (easy && !world.levelSet ? 1 : 0));
        self.dial = level;
        const reactions = [650, 420, 250, 170, 110], noise = [0.55, 0.3, 0.15, 0.07, 0.02];
        const positioning = [0.1, 0.35, 0.5, 0.75, 0.95], aggression = [0.1, 0.3, 0.5, 0.7, 0.9];
        const ix = level - 1;
        let best = -1, near = folk[0], nearDist = 10000;
        for (const person of folk) {
          best = Math.max(best, person.score);
          const distance = flatDist(world, person.pos, self.pos);
          if (distance < nearDist) { near = person; nearDist = distance; }
        }
        const soft = level === 5 || best < 0 ? 0 : M.clamp((self.score - best - [-1, 1, 2, 5, 0][ix]) / 2, 0, 1);
        self.soft = soft;
        const gems = world.near(self.pos, 64, 'gem');
        if (self.noticed === 0 || world.tick - self.noticed >= reactions[ix] / 1000 / world.dt * (soft >= 1 ? 1 : 1 + 2.5 * soft)) {
          let target = self.target;
          self.targetGem = '';
          if (near && soft >= 1) {
            for (let i = 0; i < 6; i++) {
              const a = M.clamp(M.atan2(Math.min(self.pos.y - near.pos.y, -0.6), self.pos.x - near.pos.x) + (world.random() - 0.5) * (1.2 + i * 0.5), -M.PI + 0.7, -0.7);
              const distance = 2.2 + world.random() * 0.8;
              target = { x: M.clamp(near.pos.x + M.cos(a) * distance, 0.44, 25.56), y: M.clamp(near.pos.y + M.sin(a) * distance, 0.44, 15.56), z: 0 };
              const dx = target.x - self.pos.x, dy = target.y - self.pos.y, len2 = dx * dx + dy * dy || 1;
              let clear = true;
              for (const gem of gems) {
                const u = M.clamp(((gem.pos.x - self.pos.x) * dx + (gem.pos.y - self.pos.y) * dy) / len2, 0, 1);
                if (flatDist(world, { x: self.pos.x + dx * u, y: self.pos.y + dy * u, z: 0 }, gem.pos) < 0.89) clear = false;
              }
              if (clear) break;
            }
          } else {
            let distance = 10000;
            const rivals = world.near(self.pos, 64, 'runner');
            for (const gem of gems) {
              if (rivals.some(p => p.id !== self.id && p.noticed === world.tick && p.targetGem === gem.id)) continue;
              const hot = flatDist(world, gem.pos, world.shared.zone) < 3;
              const d = flatDist(world, gem.pos, self.pos) * (hot ? 1.5 - positioning[ix] : 1) + (near ? 2 * soft * flatDist(world, gem.pos, near.pos) : 0);
              if (d < distance) { distance = d; target = gem.pos; self.targetGem = gem.id; }
            }
            if (self.targetGem) target = { x: target.x + (world.random() - 0.5) * 4 * noise[ix], y: target.y + (world.random() - 0.5) * 4 * noise[ix], z: 0 };
          }
          self.target = target; self.noticed = world.tick; self.arrived = false;
        }
        let v = M.sub(self.target, { x: self.pos.x, y: self.pos.y, z: 0 });
        const distance = M.len(v);
        if (distance < 0.12 && !self.arrived) { self.arrived = true; self.noticed = world.tick; }
        self.motion.speed = distance < 0.12 ? 0 : 4.2 * (soft >= 1 && nearDist > 3.5 ? 1 : 1 - 0.5 * soft);
        v = distance < 0.12 ? { x: 0, y: 0, z: 0 } : M.norm(v);
        if (soft >= 1 && near) {
          const look = Math.max(0.25, self.motion.speed * world.dt * 4);
          let chosen = false;
          for (const angle of [0, 1.05, -1.05, 2.1, -2.1]) {
            const step = { x: v.x * M.cos(angle) - v.y * M.sin(angle), y: v.x * M.sin(angle) + v.y * M.cos(angle), z: 0 };
            const p = M.add(self.pos, M.scale(step, look));
            if (!gems.some(g => flatDist(world, p, g.pos) < 0.8 && flatDist(world, p, g.pos) < flatDist(world, self.pos, g.pos))) { v = step; chosen = true; break; }
          }
          if (!chosen) { v = { x: 0, y: 0, z: 0 }; self.vel = { x: 0, y: 0, z: self.vel.z }; }
        }
        let rival = null, rivalDist = world.tune.knockRange * 0.9;
        for (const p of world.near(self.pos, 4, 'runner')) {
          const d = flatDist(world, self.pos, p.pos);
          if (p.id !== self.id && d < rivalDist) { rival = p; rivalDist = d; }
        }
        const attack = rival !== null && world.round.phase === 'live' && world.random() < (world.kids ? Math.min(0.3, aggression[ix]) : aggression[ix]) * (1 - 0.75 * soft) * 0.8 * world.dt;
        if (attack && rival) self.heading = M.norm({ x: rival.pos.x - self.pos.x, y: rival.pos.y - self.pos.y, z: 0 });
        return { ax: Math.round(v.x * 127), ay: Math.round(v.y * 127), jump, swing: attack };
      },
      on: {
        land(world, self) {
          if (self.motion.knockAt > 0) return;
          world.sendArea({ box: { min: { x: self.pos.x - world.tune.knockRange, y: self.pos.y - world.tune.knockRange, z: 0 }, max: { x: self.pos.x + world.tune.knockRange, y: self.pos.y + world.tune.knockRange, z: 8 } } }, 'hit', { from: self.pos, by: self.id, dir: self.heading });
        },
        notice(world, self, e) {
          if (e.by === self.id || self.driver !== 'bot' || (world.stage === 'dummy' || world.stage === 'jump')) return;
          const ix = self.dial - 1, noise = [0.55, 0.3, 0.15, 0.07, 0.02], reaction = [650, 420, 250, 170, 110];
          if (world.random() < (0.15 + 0.6 * (1 - noise[ix])) * (1 - 0.5 * self.soft)) self.dodgeAt = world.tick + world.ticks(Math.max(40, reaction[ix] * 0.5 - 60) / 1000);
        },
        score(world, self, e) { self.score += e.value; self.pickups += 1; },
        takeover(world, self) { self.firstRound = world.round.n + (world.round.endsAt - world.tick < world.ticks(30) ? 1 : 0); self.motion.speed = 6.2; self.motion.accel = 14; self.motion.knockAt = 0; self.motion.knockUntil = 0; self.vel = { x: 0, y: 0, z: 0 }; },
        arrive(world, self) {
          self.firstRound = world.round.n + (world.round.endsAt - world.tick < world.ticks(30) ? 1 : 0);
          if ((world.stage === 'dummy' || world.stage === 'jump')) {
            let index = 0;
            for (const p of world.near(self.pos, 64, 'runner')) if (p.driver === 'bot' && p.seat < self.seat) index++;
            world.place(self, self.driver === 'person' ? { x: world.stage === 'jump' ? 13 : 9.8, y: 8, z: 0 } : index === 0 && world.stage !== 'jump' ? { x: 11.3, y: 8, z: 0 } : { x: 22.4, y: 3 + index * 5, z: 0 }, { heading: { x: self.driver === 'person' ? 1 : -1, y: 0, z: 0 } });
          }
        },
        hit(world, self, e) {
          if (e.by === self.id) return;
          const M = world.math, m = self.motion, delta = { x: self.pos.x - e.from.x, y: self.pos.y - e.from.y, z: 0 };
          const distance = M.len(delta);
          if (distance > world.tune.knockRange || distance > 0.66 && M.dot(M.norm(delta), e.dir) < M.cos(world.tune.swingArc * M.PI / 360)) return;
          if (self.pos.z >= 0.3) { world.emit('dodge', self.id, {}); return; }
          m.knockDir = M.len(delta) < 0.02 ? M.dir(world.random() * M.TAU) : M.norm(delta);
          m.knockFrom = self.pos;
          m.knockAt = world.tick + world.tune.hitStopMs / 1000 / world.dt;
          m.knockUntil = m.knockAt + world.tune.knockMs / 1000 / world.dt;
          world.emit('knock', self.id, { dir: m.knockDir, by: e.by });
        },
      },
      onRoom: {
        roundStart(world, self) {
          self.score = 0; self.pickups = 0; self.noticed = 0; self.swingReady = 0; self.dodgeAt = 0;
          self.motion.knockAt = 0; self.motion.knockUntil = 0;
          const spots = world.map.spots('start');
          if (world.stage !== 'dummy' && world.stage !== 'jump') world.place(self, spots[self.seat % spots.length]);
          else {
            let index = 0;
            for (const p of world.near(self.pos, 64, 'runner')) if (p.driver === 'bot' && p.seat < self.seat) index++;
            world.place(self, self.driver === 'person' ? { x: world.stage === 'jump' ? 13 : 9.8, y: 8, z: 0 } : index === 0 && world.stage !== 'jump' ? { x: 11.3, y: 8, z: 0 } : { x: 22.4, y: 3 + index * 5, z: 0 }, { heading: { x: self.driver === 'person' ? 1 : -1, y: 0, z: 0 } });
          }
        },
      },
    },
    gem: {
      fields: { takenAt: f.tick(), serial: f.u32() },
      on: {
        take(world, self, e) {
          if (self.takenAt === world.tick || flatDist(world, e.at, self.pos) >= 0.74) return;
          self.takenAt = world.tick;
          world.send(e.by, 'score', { value: flatDist(world, self.pos, world.shared.zone) < 3 ? 2 : 1 });
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
