import { prewarm, type PrewarmStage } from './Prewarm.ts';

/**
 * ============================================================================
 *  What a game does after the GL context comes back.
 * ============================================================================
 *
 *  `GameLoop`'s `restore()` is documented as "what a context loss destroys and
 *  three cannot re-derive", and it is genuinely each game's — the shooter
 *  re-bakes and re-warms in two lines. But the two racers' were
 *  BYTE-IDENTICAL, fourteen lines of body and twenty-eight of comment, in two
 *  `main.ts` files that each said the workaround below "stays in the GAME
 *  rather than moving into the package because it is a workaround for THIS
 *  game's Sky.ts."
 *
 *  BOTH COPIES SAID THAT AND BOTH WERE THE SAME COPY. The space racer is a fork
 *  of the kart racer; the two `Sky.ts` files carry the same latent bug from the
 *  same lineage, and the sentence was true of one file duplicated rather than
 *  of two games disagreeing. Two comments claiming independence about one
 *  mechanism is exactly how forked copies drift, so the mechanism lives once
 *  and this is the comment that travels with it.
 *
 *  THE SHOOTER IS NOT A CONSUMER, and that is measured rather than tidy. Its
 *  restore is `sky.refreshEnvironment(ctx)` and `await prewarm(ctx)` with no
 *  `envRT` clear and two shorter console lines — `'[restore] env'` and
 *  `'[restore] prewarm'`. Adopting this would rewrite two strings a player
 *  pastes into a report and add a poke to a field its Sky.ts does not have.
 *  Three behaviour changes to save four lines is a bad trade.
 *
 *  ---------------------------------------------------------------------------
 *  WHY THE ENVIRONMENT IS RE-BAKED AT ALL. The probe's contents were rendered
 *  once, so a restored context comes back with the texture reallocated and
 *  EMPTY, and every metal and clearcoat in the game reflects black. It costs a
 *  six-face render plus a PMREM chain — the same price it pays at boot, and
 *  for the same reason.
 *
 *  WHY `envRT` IS CLEARED FIRST. This is a workaround for a latent bug in the
 *  racers' `Sky.ts`, which the restore path is the first thing ever to call
 *  `refreshEnvironment()` on and which therefore threw the first time it was
 *  asked to:
 *
 *    `PMREMGenerator._fromTexture` reads
 *      `const cubeUVRenderTarget = renderTarget || this._allocateTargets();`
 *    and `_allocateTargets()` is what creates `_lodMeshes`, `_blurMaterial`,
 *    `_ggxMaterial` and the ping-pong target. `Sky.buildEnvironment` builds a
 *    FRESH `PMREMGenerator` on every call and hands it the target from last
 *    time, so on the second call the allocation is skipped and
 *    `_textureToCubeUV` runs `this._lodMeshes[0].material = material` against
 *    an empty array — "Cannot set properties of undefined (setting
 *    'material')", which is exactly what the restore path logged.
 *
 *  Dropping the cached target makes the generator allocate, which is the right
 *  thing on this path anyway: the old target's GPU allocation died with the
 *  context. The proper fix is in `Sky.ts` (reuse the generator, or stop
 *  reusing the target) and belongs to whoever owns that file.
 *
 *  ---------------------------------------------------------------------------
 *  BOTH HALVES ARE CAUGHT SEPARATELY AND NEITHER RETHROWS, and that is the
 *  load-bearing part of the shape. A restore that throws leaves the loop with
 *  a live context and a game that never repaints, which is worse than a game
 *  with black reflections. So the environment failing must not stop the
 *  pre-warm, and the pre-warm failing must not stop the frame — the player
 *  gets compile hitches and a console line, and keeps playing.
 * ============================================================================
 */

/**
 * The sky, through the one member this path calls on it.
 *
 * `envRT` is deliberately NOT a member: it is `private` on both games' `Sky`
 * classes, so a public declaration here would stop the class satisfying the
 * interface. The poke is a cast for the same reason it was a cast in the
 * games, and the cast is what makes it visible as a workaround rather than an
 * API.
 */
export interface RestoreSky<W> {
  refreshEnvironment(ctx: W): void;
}

/**
 * Re-bake the environment probe and re-warm the shader cache after a context
 * restore. Never throws.
 *
 * The three console lines are reproduced exactly. They are the only external
 * evidence this path ever produces and a player is asked to paste them.
 */
export async function restoreEnvironment<W extends PrewarmStage>(
  sky: RestoreSky<W>,
  ctx: W,
): Promise<void> {
  try {
    (sky as unknown as { envRT: unknown }).envRT = null;
    sky.refreshEnvironment(ctx);
  } catch (err) {
    console.error('[restore] environment re-bake failed', err);
  }
  try {
    const warm = await prewarm(ctx);
    console.info(`[restore] re-warmed ${warm.programsBefore} -> ${warm.programsAfter} programs in ${warm.ms}ms`);
  } catch (err) {
    console.error('[restore] pre-warm failed; expect compile hitches', err);
  }
}
