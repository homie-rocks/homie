import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  hero(body, input, ctx) {
    const M = ctx.math, m = body.motion;
    if (ctx.tick < m.downUntil) { body.vel = { x: 0, y: 0, z: 0 }; return; }
    const v = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), m.speed);
    if (M.len(v) > 0.3) body.heading = M.norm(v);
    if (input.strike && ctx.tick >= m.ready && m.live) {
      m.attackTick = ctx.tick; m.ready = ctx.tick + ctx.ticks(ctx.tune.strikeMs / 1000);
      m.lungeDir = body.heading; m.lungeDone = m.lunges ? 0 : 1;
    }
    let delta = M.scale(v, ctx.dt);
    if (m.lungeDone < 1) {
      const u = M.clamp((ctx.tick - m.attackTick + 1) * ctx.dt / 0.09, 0, 1), ease = 1 - (1 - u) * (1 - u);
      delta = M.add(delta, M.scale(m.lungeDir, (ease - m.lungeDone) * ctx.tune.lunge)); m.lungeDone = ease;
    }
    ctx.map.sweep(body, delta); body.vel = v;
  },
  slime(body, input, ctx) {
    const M = ctx.math, m = body.motion;
    if (m.pushAt > 0) {
      const u = M.clamp((ctx.tick - m.pushAt) * ctx.dt / (ctx.tune.pushMs / 1000), 0, 1);
      const target = M.add(m.pushFrom, M.scale(m.pushDir, ctx.tune.slimePush * (1 - M.pow(1 - u, 3))));
      ctx.map.sweep(body, M.sub(target, body.pos));
      if (u >= 1) m.pushAt = 0;
      body.vel = { x: 0, y: 0, z: 0 }; return;
    }
    body.vel = m.velocity; ctx.map.sweep(body, M.scale(body.vel, ctx.dt));
  },
});
