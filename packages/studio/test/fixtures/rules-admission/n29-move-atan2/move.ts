import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  runner(body, input, ctx) {
    const M = ctx.math;
    const speed = ctx.tick < body.motion.frozenUntil ? 0 : 6;
    body.vel = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), speed);
    const angle = Math.atan2(body.vel.y, body.vel.x);
    if (M.len(body.vel) > 0.5) body.heading = { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
    ctx.map.sweep(body, M.scale(body.vel, ctx.dt));
  },
});
