import { defineMove } from '@homie-rocks/studio/rules';
export const move = defineMove({
  skater(body, input, ctx) {
    const d = ctx.math.clampLen({
      x: input.ax / 127,
      y: input.ay / 127,
      z: 0
    }, 1);
    body.vel = ctx.math.scale(d, 6);
    ctx.map.sweep(body, ctx.math.scale(body.vel, ctx.dt));
  }
});
