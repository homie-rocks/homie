// Nobody walks in this game: a solver stays at its desk.
import { defineMove } from '@homie-rocks/studio/rules';

export const move = defineMove({
  solver(body, input, ctx) {
    body.vel = ctx.math.vec(0, 0, 0);
  },
});
