import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move: defineMove({
    walker(body, input, ctx) {
      const stick = ctx.math.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1);
      body.vel = ctx.math.scale(stick, 2);
      body.pos = ctx.math.add(body.pos, ctx.math.scale(body.vel, ctx.dt));
    },
  }),
  shapes: { view: { places: f.list(f.text(12), 2) } },
  shared: { tactic: f.text(8), pace: f.u8(), advance: f.bit() },
  asks: {
    plan: {
      state: { round: f.u16() },
      questions: {
        tactic: { type: 'choice', instructions: 'Choose a tactic.', criteria: ['hold', 'rush'] },
        pace: { type: 'score', instructions: 'Choose a pace.', criteria: ['calm', 'brisk', 'wild'] },
        advance: { type: 'noul', instructions: 'Should the party advance?' },
      },
      floor(state) {
        return { tactic: 'hold', pace: 1, advance: state.round > 1 };
      },
    },
  },
  entities: {
    walker: {
      player: { away: 'think', leave: 'bot' },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.3, maxSpeed: 2 },
      guide: {
        view() { return { places: ['camp'] }; },
        floor(world, self, view) {
          const ask = view.asks[0];
          if (ask) return { goal: ask.k, args: ask.args, say: 'ready' };
          return { goal: 'guard' };
        },
      },
      think(world, self) {
        const goal = self.goal;
        if (!goal || goal.goal === 'guard') return { ax: 0, ay: 0 };
        const target = goal.goal === 'follow'
          ? world.near(self.pos, 64, 'walker').find(p => p.seat === goal.args.seat)?.pos
          : world.map.spot(goal.args.place);
        if (!target) { world.goalDone(false); return { ax: 0, ay: 0 }; }
        if (world.math.dist(self.pos, target) < 0.5) {
          world.goalDone(true);
          return { ax: 0, ay: 0 };
        }
        const step = world.math.clampLen(world.math.sub(target, self.pos), 1);
        return { ax: Math.round(step.x * 127), ay: Math.round(step.y * 127) };
      },
    },
  },
  room: {
    rounds: { seconds: 30, breakSeconds: 5 },
    join(ctx) { return { kind: 'walker', at: ctx.map.spots('start')[0] }; },
    on: {
      roundStart(world) { world.ask('plan', { round: world.round.n }); },
      answer(world, e) {
        if (e.ask === 'plan') {
          world.shared.tactic = e.picks.tactic;
          world.shared.pace = e.picks.pace;
          world.shared.advance = e.picks.advance;
        }
      },
    },
  },
});
