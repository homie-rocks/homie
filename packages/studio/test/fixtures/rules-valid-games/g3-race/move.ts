// A kart: gas builds speed, the stick turns the nose, and it only goes where the nose points.
import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  kart(body, input, ctx) {
    const M = ctx.math;
    const frozen = ctx.tick < body.motion.frozenUntil;
    const top = ctx.tune.topSpeed * (ctx.tick < body.motion.boostUntil ? 1.3 : 1);
    let speed = body.motion.speed;
    if (frozen) speed = 0;
    else if (input.gas) speed = Math.min(top, speed + ctx.tune.accel * ctx.dt);
    else speed = Math.max(0, speed - (input.brake ? 3 : 1) * ctx.tune.accel * ctx.dt);
    if (speed > top) speed = top;
    const turn = (input.steer / 127) * ctx.tune.turnRate * ctx.dt * (speed > 0.5 ? 1 : 0);
    const angle = M.angle(body.heading) + turn;
    body.heading = M.dir(angle);
    body.vel = M.scale(body.heading, speed);
    const hit = ctx.map.sweep(body, M.scale(body.vel, ctx.dt));
    if (hit) speed = speed * 0.5;      // a wall costs you half your speed
    body.motion.speed = speed;
  },
});
