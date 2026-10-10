// This same guarded step runs on the server and immediately for the local player.
// Only pose/motion, input, ctx map/public tune/math/clocks: no scores, queries or random.
import { defineMove, type Vec3 } from '@homie-rocks/studio/rules';

import type { MoveBody, MoveContext } from '@homie-rocks/studio/rules/types';

function slide<M>(body: MoveBody<M>, delta: Vec3, ctx: MoveContext<unknown, M>) {
  const before = body.pos, hit = ctx.map.sweep(body, delta);
  if (!hit) return;
  const M = ctx.math, remaining = M.sub(delta, M.sub(body.pos, before));
  const into = M.dot(remaining, hit.normal);
  if (into < 0) ctx.map.sweep(body, M.sub(remaining, M.scale(hit.normal, into)));
}

export const move = defineMove({
  runner(body, input, ctx) {
    const M = ctx.math, m = body.motion, T = ctx.tune;
    if (m.knockAt > 0) {
      const last = ctx.tick + 1 >= m.knockUntil;
      const u = M.clamp((ctx.tick - m.knockAt) / (m.knockUntil - m.knockAt), 0, 1);
      const ease = last ? 1 : 1 - M.pow(1 - u, T.knockEase);
      // A wall consumes blocked travel. Chasing the absolute endpoint stores up
      // that travel and releases it as a burst when the body slides clear.
      const previous = M.clamp((ctx.tick - 1 - m.knockAt) / (m.knockUntil - m.knockAt), 0, 1);
      const before = 1 - M.pow(1 - previous, T.knockEase);
      const travel = M.scale(m.knockDir, T.knockDistance * (ease - before));
      const delta = travel;
      slide(body, delta, ctx);
      body.vel = last ? { x: 0, y: 0, z: 0 } : M.scale(delta, 1 / ctx.dt);
      if (last) m.knockAt = 0;
      return;
    }
    const want = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), m.speed);
    const keep = M.pow(1 - m.accel / 60, ctx.dt * 60);
    body.vel = M.add(want, M.scale(M.sub(body.vel, want), keep));
    if (M.len(body.vel) > 0.6) body.heading = M.norm(body.vel);
    slide(body, M.scale(body.vel, ctx.dt), ctx);
  },
});
