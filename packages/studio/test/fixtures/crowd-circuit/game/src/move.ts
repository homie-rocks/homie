// This same guarded step runs on the server and immediately for the local player.
// Only pose/motion, input, ctx map/public tune/math/clocks: no scores, queries or random.
/*
 * COIN DASH — how a runner moves. Its own file, because two places run it: the server, for every body it moves, and
 * each player's browser, for that player's own body. So it reads only what both have: the body's own position,
 * velocity, heading and `motion`, this step's input, the static map and the public tunables (`ctx.tune`). It sees no
 * other entity, no score and no dice.
 */
import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  runner(body, input, ctx) {
    const M = ctx.math;
    // A runner stands still through the break between rounds (the rules set `frozenUntil`).
    const speed = ctx.tick < body.motion.frozenUntil ? 0 : ctx.tune.speed;
    // A diagonal is no faster: the stick is held to length 1.
    body.vel = M.scale(M.clampLen({ x: input.ax / 127, y: input.ay / 127, z: 0 }, 1), speed);
    if (speed > 0 && M.len(body.vel) > 0.5) body.heading = M.norm(body.vel);
    const step = M.scale(body.vel, ctx.dt);
    const from = body.pos;
    const wall = ctx.map.sweep(body, step);   // moves body.pos, and stops at the first wall
    if (wall) {
      // Slide: what is left of the step, along the wall.
      const whole = M.len(step);
      const left = whole > 0 ? 1 - M.len(M.sub(body.pos, from)) / whole : 0;
      ctx.map.sweep(body, M.scale(M.sub(step, M.scale(wall.normal, M.dot(step, wall.normal))), left));
    }
  },
});
