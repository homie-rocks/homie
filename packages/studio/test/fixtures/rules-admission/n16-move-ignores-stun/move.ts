import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  runner(body, input, ctx) {
    const M = ctx.math;
    const speed = 6;
    body.vel = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), speed);
    if (M.len(body.vel) > 0.5) body.heading = M.norm(body.vel);
    ctx.map.sweep(body, M.scale(body.vel, ctx.dt));
  },
});
