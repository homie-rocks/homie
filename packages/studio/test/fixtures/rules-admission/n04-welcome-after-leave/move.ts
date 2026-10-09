import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  fighter(body, input, ctx) {
    const M = ctx.math;
    if (body.motion.out || ctx.tick < body.motion.frozenUntil) {
      body.vel = { x: 0, y: 0, z: 0 };
      return;
    }
    const dashing = ctx.tick < body.motion.dashUntil;
    const speed = dashing ? ctx.tune.dashSpeed : ctx.tune.speed;
    body.vel = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), speed);
    if (M.len(body.vel) > 0.5) body.heading = M.norm(body.vel);
    ctx.map.sweep(body, M.scale(body.vel, ctx.dt));
  },
});
