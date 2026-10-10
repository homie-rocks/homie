import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  runner(body, input, ctx) {
    const M = ctx.math, m = body.motion, T = ctx.tune;
    if (m.knockAt > 0) {
      const last = ctx.tick + 1 >= m.knockUntil;
      const u = M.clamp((ctx.tick - m.knockAt) / (m.knockUntil - m.knockAt), 0, 1);
      const ease = last ? 1 : 1 - M.pow(1 - u, T.knockEase);
      const to = M.add(m.knockFrom, M.scale(m.knockDir, T.knockDistance * ease));
      const delta = M.sub(to, body.pos);
      ctx.map.sweep(body, delta);
      body.vel = last ? { x: 0, y: 0, z: 0 } : M.scale(delta, 1 / ctx.dt);
      if (last) m.knockAt = 0;
      return;
    }
    const want = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), m.speed);
    const keep = M.pow(1 - m.accel / 60, ctx.dt * 60);
    body.vel = M.add(want, M.scale(M.sub(body.vel, want), keep));
    if (M.len(body.vel) > 0.6) body.heading = M.norm(body.vel);
    // Keep the tangential travel when a thumb points slightly into an arena wall.
    // The original canvas starter clamped each axis independently.
    const delta = M.scale(body.vel, ctx.dt), before = body.pos;
    const hit = ctx.map.sweep(body, delta);
    if (hit) {
      const remaining = M.sub(delta, M.sub(body.pos, before));
      const into = M.dot(remaining, hit.normal);
      if (into < 0) ctx.map.sweep(body, M.sub(remaining, M.scale(hit.normal, into)));
    }
  },
});
