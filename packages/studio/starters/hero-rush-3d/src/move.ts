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
    const dt = ctx.dt, knocked = m.knockAt > 0;
    const g0 = 2 * T.jumpHeight / (T.jumpRise * T.jumpRise);
    let vz = body.vel.z, dz = 0;
    if (input.jump && body.grounded && !knocked) { vz = g0 * T.jumpRise; m.jumpAt = ctx.tick; }
    if (vz > 0 || !body.grounded) {
      const gravity = g0 * (vz < 0 ? T.fallFaster : 1);
      dz = vz * dt - gravity * dt * dt / 2;
      vz -= gravity * dt;
      if (Math.abs(vz) < 0.001) vz = 0;
    }
    let delta;
    if (knocked) {
      const last = ctx.tick + 1 >= m.knockUntil;
      const u = M.clamp((ctx.tick - m.knockAt) / (m.knockUntil - m.knockAt), 0, 1);
      const ease = last ? 1 : 1 - M.pow(1 - u, T.knockEase);
      const to = M.add(m.knockFrom, M.scale(m.knockDir, T.knockDistance * ease));
      delta = { x: to.x - body.pos.x, y: to.y - body.pos.y, z: dz };
      if (last) m.knockAt = 0;
    } else {
      const want = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), m.speed);
      const keep = M.pow(1 - m.accel / 60, dt * 60);
      const velocity = M.add(want, M.scale(M.sub({ x: body.vel.x, y: body.vel.y, z: 0 }, want), keep));
      if (M.len(velocity) > 0.6 && !input.swing) body.heading = M.norm(velocity);
      delta = { x: velocity.x * dt, y: velocity.y * dt, z: dz };
    }
    slide(body, delta, ctx);
    body.vel = { x: knocked && m.knockAt === 0 ? 0 : delta.x / dt, y: knocked && m.knockAt === 0 ? 0 : delta.y / dt, z: body.grounded ? 0 : vz };

  },
});
