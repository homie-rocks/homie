import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({
  drummer(body, input, ctx) {
    const M = ctx.math;
    const stick = M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1);
    body.vel = M.scale(stick, 3);
    ctx.map.sweep(body, M.scale(body.vel, ctx.dt));
  },
});
