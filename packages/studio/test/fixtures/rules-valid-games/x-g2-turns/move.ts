// Guests can stroll around the table while they wait for their turn.
import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  guest(body, input, ctx) {
    const M = ctx.math;
    body.vel = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), ctx.tune.stroll);
    if (M.len(body.vel) > 0.5) body.heading = M.norm(body.vel);
    ctx.map.sweep(body, M.scale(body.vel, ctx.dt));
  },
});
