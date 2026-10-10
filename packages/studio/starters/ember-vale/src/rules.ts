import { defineRules, f, type GameWorld, type GameSelf } from '@homie-rocks/studio/rules';
import { move } from './move';

type Hero = GameSelf<'hero'>;
type ReadWorld = Pick<GameWorld, 'near' | 'math' | 'map' | 'tick' | 'dt' | 'shared'>;
function slimes(world: ReadWorld) { return world.near({ x: 16, y: 10, z: 0 }, 64, 'slime'); }
function people(world: ReadWorld) { return world.near({ x: 16, y: 10, z: 0 }, 64, 'hero').filter(p => p.driver === 'person' && p.hp > 0); }
function nearest(world: ReadWorld, at: { x: number; y: number; z: number }, list = slimes(world)) {
  let best = list[0], distance = 10000;
  for (const s of list) { const d = world.math.dist(at, s.pos); if (d < distance) { distance = d; best = s; } }
  return best;
}
function quests(world: ReadWorld) {
  const list = slimes(world);
  return ['slime-hunt', ...(list.some(s => s.size === 3) || (world.shared.kingAt - world.tick) * world.dt < 30 ? ['king-slime'] : []), ...(list.some(s => s.size === 2) ? ['big-slime'] : [])];
}
function skill(world: GameWorld, guide = false) {
  const n = (world.kids ? Math.min(3, guide ? world.guideLevel : world.level) : guide ? world.guideLevel : world.level) - 1;
  return { reaction: [650, 420, 250, 170, 110][n], noise: [0.55, 0.3, 0.15, 0.07, 0.02][n], positioning: [0.1, 0.35, 0.5, 0.75, 0.95][n], aggression: Math.min(world.kids ? 0.3 : 1, [0.1, 0.3, 0.5, 0.7, 0.9][n]) };
}
function reset(world: GameWorld, self: Hero) {
  self.hp = self.maxHp; self.motion.downUntil = 0; self.motion.ready = 0; self.motion.attackTick = 0; self.motion.lungeDone = 1;
  const spots = world.map.spots('start');
  if (world.stage === 'dummy') world.place(self, self.driver === 'person' ? { x: 14.6, y: 10, z: 0 } : { x: self.seat % 2 ? 4 : 28, y: 3.2 + Math.floor(self.seat / 2) * 4, z: 0 }, { heading: { x: 1, y: 0, z: 0 } });
  else world.place(self, spots[self.seat % spots.length]);
  self.target = self.pos;
}

export default defineRules({
  contract: 2, space: { dims: 2 }, move, map: './map',
  shapes: {
    events: { beat: {}, director: {}, kingSlain: {}, hit: { by: f.ref(), from: f.vec3(), damage: f.u16() }, reward: { xp: f.u16(), gold: f.u16() }, bite: { damage: f.u16(), size: f.u8() } },
    effects: { loot: { xp: f.u16(), gold: f.u16() }, down: { cause: f.text(24) }, king: {}, strike: {}, director: { tactic: f.text(12), pressure: f.u8(), by: f.text(8) } },
    commands: { hero: { level: f.u8(), name: f.text(20) } },
    view: {
      me: f.struct({ hp: f.u8(), down: f.bit() }), zone: f.text(20), danger: f.text(20),
      party: f.list(f.struct({ seat: f.u8(), dist: f.u16(), hp: f.u8(), down: f.bit() }), 6),
      quests: f.list(f.text(16), 3), slimes: f.struct({ near: f.u8(), king: f.bit() }), round: f.struct({ phase: f.text(8), left: f.u16() }),
    },
  },
  shared: { serial: f.u32(), spawnAt: f.tick(), kingAt: f.tick(), kingSlainAt: f.tick(), tactic: f.text(12, { init: 'chase' }), pressure: f.u8({ init: 2 }), waveLeft: f.u8(), directorBy: f.text(8, { init: 'floor' }), quests: f.list(f.text(16), 3) },
  asks: {
    director: {
      state: {
        heroes: f.list(f.struct({ hp: f.u8(), down: f.bit(), level: f.u8(), nearKing: f.u16() }), 32),
        slimes: f.struct({ count: f.u8(), big: f.u8(), king: f.u8() }),
        night: f.struct({ secondsLeft: f.u16() }), now: f.struct({ tactic: f.text(12), pressure: f.u8() }), kids: f.bit(),
      },
      questions: {
        tactic: { type: 'choice', instructions: 'How should the slimes hunt? Hurt heroes deserve a breather.', criteria: { chase: 'Rush the nearest hero', surround: 'Spread out and close in', weakest: 'Hunt the most hurt hero', regroup: 'Gather at the King' } },
        wave: { type: 'noul', instructions: 'Should three extra slimes come?', criteria: { true: 'Healthy heroes and quiet woods', false: 'Hurt, down or few heroes' } },
        pressure: { type: 'score', instructions: 'How hard should the vale push?', criteria: ['A breather', 'Easy', 'Steady', 'Hard', 'Fierce'] },
      },
      floor() { return { tactic: 'chase', wave: false, pressure: 2 }; },
    },
  },
  entities: {
    hero: {
      player: { away: 'think', leave: 'bot' }, body: { shape: 'circle', radius: 0.44, maxSpeed: 6 },
      fields: { striking: f.bit(), hp: f.u16({ init: 72 }), maxHp: f.u16({ init: 72 }), level: f.u8({ init: 1 }), name: f.text(20), score: f.u32({ score: true }), target: f.vec3(), aim: f.vec3(), hunting: f.bit(), noticed: f.tick(), greeted: f.list(f.u8(), 32), warned: f.tick(), huntFrom: f.u32(), huntGoal: f.tick(), arrivedAt: f.tick(), leadGoal: f.tick() },
      motion: { lunges: f.bit({ init: true }), speed: f.fix({ init: 6 }), downUntil: f.tick(), ready: f.tick(), attackTick: f.tick(), lungeDir: f.dir(), lungeDone: f.fix({ init: 1 }), live: f.bit({ init: true }) },
      input: { ax: f.i8(), ay: f.i8(), strike: f.press() },
      commands: {
        hero(world, self, e) { if (self.driver !== 'person') return; self.level = world.math.clamp(e.level, 1, 99); self.maxHp = 60 + self.level * 12; self.hp = Math.min(self.hp, self.maxHp); self.name = world.kids ? '' : e.name; },
      },
      tick(world, self) {
        self.motion.live = world.round.phase === 'live';
        self.striking = self.motion.attackTick > 0 && world.tick - self.motion.attackTick < world.tune.flashMs / 1000 / world.dt;
        if (world.kids && self.name) self.name = '';
        if (self.driver === 'person' && !self.away) { self.motion.speed = 6; self.motion.lunges = true; }
        if (self.hp === 0) {
          if (world.tick >= self.motion.downUntil) { self.hp = self.maxHp; world.place(self, { x: 16 + (world.random() - 0.5) * 6, y: 10 + (world.random() - 0.5) * 4, z: 0 }); }
          return;
        }
        if (self.motion.attackTick === world.tick && world.round.phase === 'live') {
          world.emit('strike', self.id, {});
          for (const s of world.near(self.pos, world.tune.strikeRange + 0.6, 'slime'))
            if (world.math.dist(self.pos, s.pos) <= world.tune.strikeRange + s.size * 0.2) world.send(s.id, 'hit', { by: self.id, from: self.pos, damage: 10 + self.level * 3 });
        }
      },
      think(world, self) {
        self.motion.lunges = false;
        const M = world.math, s = skill(world, world.guideSeats.includes(self.seat)), goal = self.goal, folk = people(world);
        if (self.hp === 0 || world.stage === 'dummy') { self.motion.speed = 0; return { ax: 0, ay: 0 }; }
        let target = self.target, hunt = undefined as ReturnType<typeof nearest> | undefined;
        if (goal) {
          const nearTo = (p: { x: number; y: number; z: number }, r: number) => { const n = nearest(world, p); return n && M.dist(n.pos, p) < r ? n : undefined; };
          if (goal.goal === 'follow') {
            const person = folk.find(p => p.seat === goal.args.seat);
            if (!person) world.goalDone(false);
            else {
              const back = (70 + (150 - 70) * (1 - s.positioning)) / 50;
              const side = (self.seat % 2 ? 1 : -1) * (0.5 + self.seat % 3 * 0.25), a = M.atan2(person.heading.y, person.heading.x) + side;
              target = { x: person.pos.x - M.cos(a) * back, y: person.pos.y - M.sin(a) * back, z: 0 }; hunt = nearTo(person.pos, 4);
            }
          } else if (goal.goal === 'quest') {
            if (goal.args.quest === 'king-slime') {
              if (world.shared.kingSlainAt > goal.at) world.goalDone();
              hunt = slimes(world).find(s => s.size === 3); target = { x: 16, y: 3.8, z: 0 };
            } else if (goal.args.quest === 'big-slime') { hunt = nearest(world, self.pos, slimes(world).filter(s => s.size === 2)); if (!hunt) world.goalDone(); }
            else {
              if (self.huntGoal !== goal.at || self.huntFrom > self.score) { self.huntGoal = goal.at; self.huntFrom = self.score; }
              if (self.score - self.huntFrom >= 18) world.goalDone();
              const centre = folk.length ? M.scale(folk.reduce((p, h) => M.add(p, h.pos), { x: 0, y: 0, z: 0 }), 1 / folk.length) : self.pos;
              hunt = nearTo(centre, 10.4) ?? nearest(world, self.pos);
            }
          } else if (goal.goal === 'lead') {
            target = world.map.spot(goal.args.place) ?? world.map.spot('camp')!;
            if (self.leadGoal !== goal.at) { self.leadGoal = goal.at; self.arrivedAt = 0; }
            if (M.dist(target, self.pos) < 1.2) {
              if (!self.arrivedAt) self.arrivedAt = world.tick;
              if (folk.some(p => M.dist(p.pos, target) < 5.6)) world.goalDone();
              else if (world.tick - self.arrivedAt > world.ticks(20)) world.goalDone(false);
            } else self.arrivedAt = 0;
            hunt = nearTo(self.pos, 2.2);
          } else if (goal.goal === 'guard') {
            const near = folk.filter(p => M.dist(p.pos, self.pos) < 14);
            const centre = near.length ? M.scale(near.reduce((p, h) => M.add(p, h.pos), { x: 0, y: 0, z: 0 }), 1 / near.length) : self.pos;
            target = M.add(centre, { x: 1, y: 0.8, z: 0 }); hunt = nearTo(centre, (260 + (160 - 260) * (1 - s.positioning)) / 50);
          } else if (goal.goal === 'back') { target = world.map.spot('camp')!; if (M.dist(target, self.pos) < 1) world.goalDone(); }
          if (!hunt && goal.goal !== 'follow') target = M.add(target, M.scale(M.dir(self.seat * 2.4), 0.92));
          if (hunt) {
            if (!self.noticed || world.tick - self.noticed >= s.reaction / 1000 / world.dt) { self.noticed = world.tick; self.aim = { x: hunt.pos.x + (world.random() - 0.5) * 1.6 * s.noise, y: hunt.pos.y + (world.random() - 0.5) * 1.6 * s.noise, z: 0 }; }
            target = self.aim;
          }
        } else {
          hunt = nearest(world, self.pos);
          if (!self.noticed || world.tick - self.noticed >= s.reaction / 1000 / world.dt) {
            self.noticed = world.tick; self.hunting = Boolean(hunt && M.dist(hunt.pos, self.pos) < (460 + (220 - 460) * (1 - s.positioning)) / 50);
            if (self.hunting && hunt) self.aim = { x: hunt.pos.x + (world.random() - 0.5) * 1.6 * s.noise, y: hunt.pos.y + (world.random() - 0.5) * 1.6 * s.noise, z: 0 };
          }
          target = self.hunting ? self.aim : self.target;
          if (!self.hunting && M.dist(self.target, self.pos) < 0.6) self.target = { x: 4 + world.random() * 24, y: 3 + world.random() * 14, z: 0 };
          if (!self.hunting) hunt = undefined;
        }
        const delta = M.sub(target, self.pos), distance = M.len(delta), stop = goal ? hunt ? 1 : 0.48 : 1.2;
        self.motion.speed = distance > stop ? Math.min(goal ? 5.1 : 4.5, distance / world.dt) : 0;
        const v = distance > stop ? M.norm(delta) : { x: 0, y: 0, z: 0 };
        const strike = Boolean(hunt && M.dist(goal ? hunt.pos : self.aim, self.pos) < world.tune.strikeRange + (goal ? hunt.size * 0.2 : 0) && world.tick - self.motion.attackTick > (1400 - 900 * s.aggression) / 1000 / world.dt);
        return { ax: Math.round(v.x * 127), ay: Math.round(v.y * 127), strike };
      },
      on: {
        arrive(world, self) { if (self.driver !== 'person') { self.level = 1 + self.seat % 4; self.maxHp = 60 + self.level * 12; } reset(world, self); },
        takeover(world, self) { self.score = 0; self.name = ''; self.level = 1; self.maxHp = 72; self.hp = 72; self.motion.downUntil = 0; self.motion.speed = 6; },
        reward(world, self, e) { self.score += e.xp; if (self.driver === 'person') world.emit('loot', self.id, { xp: e.xp, gold: e.gold }); },
        bite(world, self, e) {
          if (self.hp === 0) return; self.hp = Math.max(0, self.hp - e.damage);
          if (self.hp === 0) { self.motion.downUntil = world.tick + world.ticks(4); self.motion.lungeDone = 1; world.emit('down', self.id, { cause: e.size === 3 ? 'the King Slime' : e.size === 2 ? 'a big slime' : 'a slime' }); }
        },
      },
      onRoom: { roundStart(world, self) { self.score = 0; reset(world, self); } },
      guide: {
        view(world, self) {
          const list = slimes(world), king = list.find(s => s.size === 3), near = list.filter(s => world.math.dist(self.pos, s.pos) < 7).length;
          const party = world.near(self.pos, 18, 'hero').filter(p => p.driver === 'person').map(p => ({ seat: p.seat, dist: Math.round(world.math.dist(self.pos, p.pos) * 50), hp: Math.round(100 * p.hp / p.maxHp), down: p.hp === 0 })).sort((a, b) => a.dist - b.dist).slice(0, 6);
          let zone = 'vale', distance = 5.2;
          for (const name of ['camp', 'king', 'east-woods']) { const at = world.map.spot(name)!; const d = world.math.dist(self.pos, at); if (d < distance) { zone = name; distance = d; } }
          return { me: { hp: Math.round(100 * self.hp / self.maxHp), down: self.hp === 0 }, zone, danger: king && world.math.dist(king.pos, self.pos) < 9 ? 'the King Slime' : near >= 5 ? 'slimes' : '', party, quests: quests(world), slimes: { near, king: Boolean(king) }, round: { phase: world.round.phase, left: Math.max(0, Math.round((world.round.endsAt - world.tick) * world.dt)) } };
        },
        floor(world, self, v) {
          const live = world.near(self.pos, 64, 'hero').filter(p => p.driver === 'person');
          const party = v.party.filter(p => live.some(h => h.seat === p.seat));
          const ask = v.asks[0];
          if (ask?.k === 'ask_help') return { goal: 'quest', args: { quest: ask.args.quest }, say: 'quest_help', sayArgs: { quest: ask.args.quest } };
          if (ask?.k === 'lead_me') return { goal: 'lead', args: { place: ask.args.place }, say: 'follow_me', sayArgs: { place: ask.args.place } };
          if (ask?.k === 'no_thanks') return { goal: 'back', say: 'bye' };
          if (v.goal?.state === 'active' && ['quest', 'lead', 'back'].includes(v.goal.goal)) return {};
          const fresh = party.find(p => !self.greeted.includes(p.seat) && p.dist < 420);
          if (fresh) { self.greeted = [...self.greeted, fresh.seat].slice(-32); return { goal: 'follow', args: { seat: fresh.seat }, say: 'hello', sayArgs: { player: fresh.seat } }; }
          if (v.danger === 'the King Slime') {
            const warn = world.tick - self.warned > world.ticks(30); if (warn) self.warned = world.tick;
            return warn ? { goal: 'guard', say: 'careful', sayArgs: { thing: 'the King Slime' } } : { goal: 'guard' };
          }
          const hurt = party.find(p => !p.down && p.hp < 40), person = hurt ?? party[0];
          return person ? { goal: 'follow', args: { seat: person.seat } } : { goal: 'lead', args: { place: 'camp' } };
        },
      },
    },
    slime: {
      body: { shape: 'circle', radius: 0.4, maxSpeed: 1.7 },
      fields: { serial: f.u32(), hp: f.u16({ init: 18 }), maxHp: f.u16({ init: 18 }), size: f.u8({ init: 1 }), biteAt: f.tick() },
      motion: { velocity: f.vec3(), pushAt: f.fix(), pushFrom: f.vec3(), pushDir: f.dir() },
      tick(world, self) {
        if (world.stage === 'dummy' || world.round.phase !== 'live' || self.motion.pushAt > 0) { self.motion.velocity = { x: 0, y: 0, z: 0 }; return; }
        const M = world.math, all = world.near(self.pos, 64, 'hero').filter(p => p.hp > 0), folk = all.filter(p => p.driver === 'person'), prey = folk.length ? folk : all;
        let target = prey[0], distance = 10000;
        for (const p of prey) { const d = M.dist(p.pos, self.pos); if (d < distance) { distance = d; target = p; } }
        if (world.shared.tactic === 'weakest' && !world.kids) for (const p of prey) if (target && p.hp / p.maxHp < target.hp / target.maxHp) target = p;
        if (target) {
          let to = target.pos;
          const king = slimes(world).find(s => s.size === 3), speed = self.size === 3 ? 1.4 : (95 - self.size * 10) / 50;
          if (world.shared.tactic === 'surround' && distance > 1.8) to = M.add(to, M.scale(M.dir(self.serial * 2.39996), 1.6));
          if (world.shared.tactic === 'regroup' && king && king.id !== self.id && distance > 2.8) to = M.add(king.pos, M.scale(M.dir(self.serial), 1.4));
          const delta = M.sub(to, self.pos); self.motion.velocity = M.len(delta) > .08 ? M.scale(M.norm(delta), speed) : { x: 0, y: 0, z: 0 };
          if (M.dist(target.pos, self.pos) < .64 + self.size * .2 && world.tick - self.biteAt > world.ticks(.8)) { self.biteAt = world.tick; world.send(target.id, 'bite', { damage: 5 * self.size + (self.size === 3 ? 10 : 0), size: self.size }); }
        } else self.motion.velocity = { x: M.sin(world.tick * world.dt / .9 + self.serial) * .4, y: M.cos(world.tick * world.dt / 1.1 + self.serial) * .4, z: 0 };
      },
      on: {
        hit(world, self, e) {
          if (self.hp === 0 || world.math.dist(e.from, self.pos) > world.tune.strikeRange + self.size * .2) return;
          self.hp = Math.max(0, self.hp - e.damage);
          self.motion.pushFrom = self.pos; self.motion.pushDir = world.math.norm(world.math.sub(self.pos, e.from)); self.motion.pushAt = world.tick + world.tune.hitStopMs / 1000 / world.dt;
          if (self.hp === 0) {
            world.send(e.by, 'reward', { xp: self.size === 3 ? 60 : 6 * self.size, gold: self.size === 3 ? 50 : 2 + Math.floor(world.random() * 4) * self.size });
            if (self.size === 3) world.sendRoom('kingSlain', {}); world.despawn(self);
          }
        },
      },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
  },
  room: {
    rounds: { seconds: 90, breakSeconds: 8 }, bots: { keep: 3 },
    join(ctx, player) { const spots = ctx.map.spots('start'); return { kind: 'hero', at: spots[player.seat % spots.length] }; },
    start(world) { world.after(1, 'beat', {}); world.after(1, 'director', {}); },
    on: {
      roundStart(world) { world.shared.spawnAt = 0; world.shared.kingAt = world.tick + world.ticks(45); if (world.stage === 'dummy') { world.shared.serial += 1; world.spawn('slime', { x: 16.6, y: 10, z: 0 }, { hp: 36, maxHp: 36, size: 2, serial: world.shared.serial }); } },
      kingSlain(world) { world.shared.kingSlainAt = world.tick; },
      beat(world) {
        world.after(1, 'beat', {}); world.shared.quests = quests(world);
        if (world.stage === 'dummy' || world.round.phase !== 'live' || world.shared.kingAt === 0) return;
        const list = slimes(world), cap = Math.max(4, 6 + people(world).length * 2 + (world.shared.pressure - 2) * 2) + (world.shared.waveLeft > 0 ? 3 : 0);
        if ((world.tick >= world.shared.spawnAt || world.shared.waveLeft > 0) && list.length < cap) {
          world.shared.spawnAt = world.tick + world.ticks([1.9, 1.45, 1.1, .85, .7][world.shared.pressure]); if (world.shared.waveLeft > 0) world.shared.waveLeft -= 1;
          const edge = Math.floor(world.random() * 4), x = edge === 0 ? .6 : edge === 1 ? 31.4 : world.random() * 32, y = edge === 2 ? .6 : edge === 3 ? 19.4 : world.random() * 20, size = world.random() < .25 ? 2 : 1;
          world.shared.serial += 1; world.spawn('slime', { x, y, z: 0 }, { hp: 18 * size, maxHp: 18 * size, size, serial: world.shared.serial });
        }
        if (world.tick >= world.shared.kingAt && !list.some(s => s.size === 3)) { world.shared.kingAt = world.tick + world.ticks(60); world.shared.serial += 1; world.spawn('slime', { x: 16, y: .8, z: 0 }, { hp: 160, maxHp: 160, size: 3, serial: world.shared.serial }); world.emit('king', { x: 16, y: .8, z: 0 }, {}); }
      },
      director(world) {
        world.after(world.ticks(6), 'director', {}); if (world.round.phase !== 'live') return;
        const list = slimes(world), king = list.find(s => s.size === 3);
        world.ask('director', { heroes: world.near({ x: 16, y: 10, z: 0 }, 64, 'hero').filter(p => p.driver === 'person').map(p => ({ hp: Math.round(100 * p.hp / p.maxHp), down: p.hp === 0, level: p.level, nearKing: king ? Math.round(world.math.dist(p.pos, king.pos) * 50) : 0 })), slimes: { count: list.length, big: list.filter(s => s.size === 2).length, king: king ? Math.round(100 * king.hp / king.maxHp) : 0 }, night: { secondsLeft: Math.max(0, Math.round((world.round.endsAt - world.tick) * world.dt)) }, now: { tactic: world.shared.tactic, pressure: world.shared.pressure }, kids: world.kids });
      },
      answer(world, e) {
        if (e.ask !== 'director') return;
        world.shared.tactic = world.kids && e.picks.tactic === 'weakest' ? 'chase' : e.picks.tactic;
        world.shared.pressure = Math.min(world.kids ? 2 : 4, e.picks.pressure);
        if (e.picks.wave && world.shared.waveLeft === 0) world.shared.waveLeft = 3;
        world.shared.directorBy = e.by; world.emit('director', { x: 16, y: 10, z: 0 }, { tactic: world.shared.tactic, pressure: world.shared.pressure, by: e.by });
      },
    },
  },
});
