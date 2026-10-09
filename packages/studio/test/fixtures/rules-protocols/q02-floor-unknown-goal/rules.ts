import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

// LAMPLIGHT: keepers light named lamps. A companion takes goals; the room asks which bonus a round pays.
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shared: { bonus: f.u8(), lit: f.u32(), pace: f.u8() },
  shapes: {
    events: { lit: { by: f.ref() }, glow: { value: f.u8() }, relight: {}, reset: {} },
    commands: { cheer: {} },
    effects: { flare: { value: f.u8() } },
    view: { dark: f.list(f.text(8), 5), score: f.u16() },
  },
  asks: {
    bonus: {
      state: { round: f.u16(), lit: f.u32() },
      questions: {
        kind: { type: 'choice', instructions: 'Pick double when lamps should pay two points this round.', criteria: ['double', 'plain'] },
        pace: { type: 'score', instructions: 'How fast should the round feel?', criteria: ['calm', 'brisk', 'wild'] },
      },
      floor(state) { return { kind: state.round % 2 === 0 ? 'double' : 'plain', pace: state.lit > 20 ? 2 : 1 }; },
    },
  },
  entities: {
    keeper: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), cheers: f.u8(), done: f.u16() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      think(world, self) {
        const lamps = world.near(self.pos, 40, 'lamp');
        let target = self.pos;
        const goal = self.goal;
        if (goal && goal.goal === 'rest') return { ax: 0, ay: 0 };
        if (goal && goal.goal === 'follow') {
          const leader = world.near(self.pos, 40, 'keeper').find((k) => k.seat === goal.args.seat);
          if (leader && world.math.dist(leader.pos, self.pos) > 1.5) target = leader.pos;
        } else if (goal && goal.goal === 'light') {
          const lamp = lamps.find((l) => l.name === goal.args.lamp);
          if (lamp) target = lamp.pos;
        } else {
          for (const lamp of lamps) if (!lamp.on) { target = lamp.pos; break; }
        }
        const step = world.math.clampLen(world.math.sub(target, self.pos), 1);
        return { ax: Math.round(step.x * 127), ay: Math.round(step.y * 127) };
      },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        const goal = self.goal;
        if (goal && goal.goal === 'light') {
          const lamp = world.near(self.pos, 40, 'lamp').find((l) => l.name === goal.args.lamp);
          if (!lamp || lamp.on) { self.done = Math.min(65535, self.done + 1); world.goalDone(true); }
        }
        for (const lamp of world.near(self.pos, 1.2, 'lamp')) if (!lamp.on) { world.send(lamp.id, 'lit', { by: self.id }); break; }
      },
      on: {
        glow(world, self, e) {
          self.score = Math.min(65535, self.score + e.value);
          world.emit('flare', self.pos, { value: e.value });
        },
        undeliverable(world, self) { self.cheers = 0; },
      },
      commands: { cheer(world, self) { self.cheers = Math.min(255, self.cheers + 1); } },
      onRoom: { roundStart(world, self) { self.score = 0; } },
      guide: {
        view(world, self) {
          const dark: string[] = [];
          for (const lamp of world.near(self.pos, 40, 'lamp')) if (!lamp.on && dark.length < 5) dark.push(lamp.name);
          return { dark, score: self.score };
        },
        floor(world, self, view) {
          const ask = view.asks[0];
          if (ask && ask.k === 'follow') return { goal: 'follow', args: ask.args };
          if (ask && ask.k === 'light') return { goal: 'light', args: ask.args, say: 'onit' };
          const first = view.dark[0];
          if (first !== undefined) return { goal: 'relight', args: { lamp: first }, say: 'onit' };
          return { goal: 'rest' };
        },
      },
    },
    lamp: {
      fields: { on: f.bit(), value: f.u8({ init: 1 }), name: f.text(8) },
      on: {
        lit(world, self, e) {
          if (self.on) return;
          self.on = true;
          world.send(e.by, 'glow', { value: world.shared.bonus === 1 ? self.value * 2 : self.value });
          world.sendRoom('relight', {});
        },
      },
      onRoom: { reset(world, self) { self.on = false; } },
    },
  },
  room: {
    rounds: { seconds: 20, breakSeconds: 2 }, bots: { keep: 3 },
    start(world) {
      const names = ['north', 'east', 'south', 'west', 'middle'];
      const spots = world.map.spots('lamps');
      for (let i = 0; i < spots.length && i < names.length; i += 1) world.spawn('lamp', spots[i], { value: 1, name: names[i] });
    },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'keeper', at: spots[player.seat % spots.length] };
    },
    on: {
      relight(world) { world.shared.lit += 1; },
      roundStart(world, e) {
        world.announce('reset', {});
        world.ask('bonus', { round: e.n, lit: world.shared.lit });
      },
      answer(world, e) {
        if (e.ask !== 'bonus') return;
        world.shared.bonus = e.picks.kind === 'double' ? 1 : 0;
        const pace = e.picks.pace;
        world.shared.pace = typeof pace === 'number' && pace >= 0 && pace <= 2 ? pace : 1;
      },
    },
  },
});
