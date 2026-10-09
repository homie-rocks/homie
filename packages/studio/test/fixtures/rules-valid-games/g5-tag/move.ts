// Whoever is "it" runs a little faster, so the chase always ends.
import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  runner(body, input, ctx) {
    const M = ctx.math;
    const top = body.motion.fast ? ctx.tune.itSpeed : ctx.tune.speed;
    const speed = ctx.tick < body.motion.frozenUntil ? 0 : top;
    body.vel = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), speed);
    if (speed > 0 && M.len(body.vel) > 0.5) body.heading = M.norm(body.vel);
    const step = M.scale(body.vel, ctx.dt);
    const wall = ctx.map.sweep(body, step);
    if (wall) ctx.map.sweep(body, M.scale(M.sub(step, M.scale(wall.normal, M.dot(step, wall.normal))), 0.5));
  },
});
