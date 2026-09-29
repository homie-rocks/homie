/**
 * ============================================================================
 *  `lights_fragment_begin` — three's unrolled light loops, found and edited.
 * ============================================================================
 *
 * Two things live here, and what they have in common is that neither of them is
 * a look, a rule or a number: they are both HARD-CODED COPIES OF THREE'S OWN
 * SOURCE TEXT, used as anchors to edit a chunk three gives no other handle on.
 *
 * ## Why a version seam is worth a package of its own
 *
 * The strings below were transcribed out of three's `lights_fragment_begin`,
 * tab for tab. They are correct for exactly one shape of that chunk. The day
 * three reformats it, every rig that anchors on them loses its edit — and loses
 * it THE QUIET WAY: the guard warns to a console nobody is reading and returns
 * the chunk unmodified, so the frame renders, the shadow maps are all allocated
 * and paid for, and the cascade is simply never selected.
 *
 * Three copies of a version seam is three places to re-check against every
 * three upgrade and two places somebody will forget. A kart racer, a space
 * racer and a base-building game each carried the same four strings; this
 * package's test harness now runs `findDirLightLoop` against the
 * three that is actually installed, so a version that moved the loop is a RED
 * CHECK rather than a warning in a log.
 *
 * ## What is NOT here
 *
 * The rewrite. Every rig edits the loop body for its own reasons and they share
 * nothing past the anchor: the kart racer adds a rim, a warm/cool key coupling
 * and three fills; the space racer cuts a shadowless planet fill out of a
 * pressure hull; the base-building game drops N-1 shadow-only cascades out of
 * the loop entirely and hoists an earthshine fill's visibility for a later
 * chunk to read. Those are three different rigs, not one with a flag.
 * `findDirLightLoop` hands back the body and a way to put a new one back, and
 * stops.
 */

/** three's loop, located: the pieces a caller needs to rewrite the body. */
export interface DirLightLoopSite {
  /**
   * three's own loop body, verbatim — everything between the `for` header and
   * the `#pragma unroll_loop_end` tail, exclusive of both.
   */
  body: string;
  /**
   * The two-line shadow statement inside `body`, exactly as three emits it.
   * A caller replaces this to take over the shadow decision; it is handed back
   * rather than re-derived so the caller's `String.replace` cannot silently miss
   * (`body.includes(shadowLine)` has already been asserted true here).
   */
  shadowLine: string;
  /**
   * three's `RE_Direct` call, exactly as it emits it. Rigs anchor their own
   * injections on it. NOT asserted present — a rig that needs it checks, so a
   * miss warns in that rig's own words rather than blocking every other one.
   */
  reLine: string;
  /** Put a rewritten body back where three's was, returning the whole chunk. */
  splice(rewritten: string): string;
}

/**
 * Find three's unrolled directional-light loop in `lights_fragment_begin`.
 *
 * Returns null — SILENTLY — when the loop is not where it should be. The
 * silence is deliberate: every caller has a different, better sentence to say
 * about what its own frame will look like without the edit ("the sun now has a
 * single 20 m shadow", "only the near cascade casts"), and a generic warning
 * from in here would either duplicate or drown it. A null is never ignorable —
 * the callers all return the unmodified chunk and warn.
 *
 * `UNROLLED_LOOP_INDEX` and `NUM_DIR_LIGHT_SHADOWS` are both textually
 * substituted by three BEFORE the preprocessor runs, which is what lets a `#if`
 * in a rewritten body select different code per unrolled iteration. three's own
 * code in this chunk relies on exactly that, so it is not a trick we invented.
 *
 * AND THE TRAP THAT COMES WITH IT: three's unroll concatenates N copies of the
 * body into ONE scope with no braces around each copy (`WebGLProgram`'s
 * loopReplacer). A `float x = ...;` in a rewritten body is therefore a
 * redefinition error the moment two unrolled indices reach it, and a `continue`
 * is a compile error because there is no enclosing loop in the generated
 * source. Both are the kind of thing that only shows up on the second light.
 */
export function findDirLightLoop(original: string): DirLightLoopSite | null {
  const head = '\tfor ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {\n';
  const tail = '\n\t}\n\t#pragma unroll_loop_end';
  const shadowLine = `		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;`;

  const h = original.indexOf(head);
  const t = h < 0 ? -1 : original.indexOf(tail, h);
  if (h < 0 || t < 0 || !original.slice(h, t).includes(shadowLine)) return null;

  const reLine = '		RE_Direct( directLight, geometryPosition, geometryNormal, ' +
    'geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

  return {
    body: original.slice(h + head.length, t),
    shadowLine,
    reLine,
    splice: (rewritten: string) => original.slice(0, h + head.length) + rewritten + original.slice(t),
  };
}

/**
 * Skip the BRDF for point lights that are contributing nothing.
 *
 * A fixed-size light pool — see `lightpool.ts` for why the size has to be fixed
 * — means that on a frame where only four fixtures are near the camera, the
 * other twenty-two PointLights are still in the scene at intensity 0, and every
 * one of them runs a full specular+diffuse evaluation on every fragment of every
 * material. three already computes `directLight.visible` as "is this light's
 * attenuated colour non-zero", so the gate is free to write and IDENTICAL IN
 * OUTPUT — it is a pure saving, not a quality trade, and there is no knob on it
 * for that reason.
 *
 * IT MUST BE AN `if` BLOCK AND NOT A `continue`. three's `#pragma unroll_loop`
 * emits N copies of the body with no enclosing loop, so a `continue` in the
 * generated source is a compile error (`WebGLProgram`'s loopReplacer). Same
 * family of trap as the one `findDirLightLoop` documents above.
 *
 * IT REFUSES RATHER THAN GUESSES, and it warns only on the first anchor. If
 * `getPointLightInfo` has moved, the whole loop has been reshaped and saying so
 * is useful. If it is present but `RE_Direct` is not, the caller is looking at a
 * chunk another patch has already rewritten past this point, and a second
 * warning about the same fact is noise; the chunk comes back untouched either
 * way, which costs a BRDF and changes no pixel.
 */
export function darkPointLightGateChunk(original: string): string {
  const anchor = `		getPointLightInfo( pointLight, geometryPosition, directLight );`;
  const reLine = `		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );`;
  const i = original.indexOf(anchor);
  if (i < 0) {
    console.warn('[render] getPointLightInfo moved; the dark-pool point-light gate was not '
      + 'installed. Correct, but the unallocated half of the light pool now costs a full BRDF.');
    return original;
  }
  const j = original.indexOf(reLine, i);
  if (j < 0) return original;
  return original.slice(0, j)
    + `		if ( directLight.visible ) {\n	${reLine}\n		}`
    + original.slice(j + reLine.length);
}
