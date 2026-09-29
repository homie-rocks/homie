/**
 * ============================================================================
 *  interiorvolume — "am I inside something?", as GLSL, and the scene-wide
 *  lighting state every other chunk in this package reads.
 * ============================================================================
 *
 *  A bore, a cave, a hangar, a covered market: whenever a renderer puts a
 *  fragment inside a solid, every indirect term it has is wrong. `environment`
 *  is a full sky probe sampled with no notion of what is between the fragment
 *  and the sky, the SH ambient likewise, a shadowless fill light passes through
 *  rock by construction, and aerial perspective lays haze over air that has no
 *  sky above it. The symptom is an inversion — the inside of the tunnel is
 *  brighter than the daylight outside it, and no amount of retuning the lamps
 *  fixes it, because nothing is occluding anything.
 *
 *  The answer is a real occlusion volume: a capsule chain fitted to the
 *  interior's own centreline, tapered in from each mouth, baked into `<common>`
 *  as literals, written once per fragment by the patched
 *  `<lights_fragment_begin>`, and read by the indirect terms
 *  (`skyrig.indirectFloorChunk`), by the shadowless fill lights and by the fog
 *  (`heightfog.heightFogChunks`).
 *
 *  ## What is here and what is not
 *
 *  HERE: the shape of the test — a bounding-sphere reject, a segment-relative
 *  closest-point solve per capsule, a radial falloff and a taper at each end —
 *  and the five scene-wide GLSL declarations the rest of this package's chunks
 *  already read by name. None of it names a place.
 *
 *  NOT HERE: the radii, the mouth taper, where the centreline is and how many
 *  segments it is worth. Those arrive on `InteriorFit`, and there is no default
 *  for any of them, because "how thick is the rock" is a level.
 *
 *  ## The kr prefix is the package's vocabulary, not a game's initials
 *
 *  `krInterior`, `krWorldNormal`, `krKeyShadow`, `krKeyLit` and `krPenumbra`
 *  are written here and read in `cascade.ts` and `skyrig.ts`. They are one
 *  namespace shared across chunks that are spliced into three.js's own shader
 *  by three different modules, and the prefix exists so that a name collision
 *  with three (or with a game's hand-rolled ShaderMaterial) is impossible.
 *  Renaming them is a change to all three files at once, which is exactly why
 *  they are declared in ONE place now instead of in each game's Sky.
 *
 *  `krInterior` reads 0 for anything that never runs the lighting path, which
 *  is right: an unlit material has no indirect term to occlude. That is only
 *  true because these declarations go in `<common>` — the one chunk every
 *  fragment shader in three includes, lit, unlit, and hand-rolled alike.
 */
import type { CapsuleChain } from './skyrig.ts';
import { glslFloat } from './cascade.ts';

/** A fitted chain plus the centreline's own total arc length. */
export interface InteriorVolume extends CapsuleChain {
  total: number;
}

/** Everything about the shape of the falloff. The caller owns all four. */
export interface InteriorFit {
  /** fully inside at this radius from the centreline, in world units */
  rIn: number;
  /** fully outside at this radius. Between them, a smoothstep on squared distance. */
  rOut: number;
  /**
   * How far in from each mouth the volume tapers to nothing, in arc length.
   * Without it the occlusion switches on at the mouth plane and the entrance
   * reads as a painted rectangle.
   */
  mouth: number;
}

/**
 * Append the scene-wide lighting state and `krInteriorAt()` to `<common>`.
 *
 * `extra` is appended verbatim after the function — a game's own scene-wide
 * GLSL (a rim term, a grade helper) belongs to the game and is not composed
 * here, because a package that concatenated a game's shader would be a package
 * that decides what order two games' helpers are declared in.
 *
 * With no volume the function still exists and returns 0. That is deliberate:
 * every chunk downstream reads `krInterior` unconditionally, and a build with
 * no tunnel in it must compile the same program shape as one with a tunnel.
 */
export function interiorStateChunk(
  original: string,
  volume: InteriorVolume | null,
  fit: InteriorFit,
  extra = '',
): string {
  const F = glslFloat;
  let body = '\treturn 0.0;';

  if (volume !== null && volume.segments.length > 0) {
    const lines: string[] = [
      `\tvec3 krD = p - vec3( ${F(volume.cx)}, ${F(volume.cy)}, ${F(volume.cz)} );`,
      `\tif ( dot( krD, krD ) > ${F(volume.radius * volume.radius)} ) return 0.0;`,
      '\tfloat m = 0.0;',
      '\tvec3 ap, q; float t, s;',
    ];
    // Every segment is expressed RELATIVE to the volume centre, and the test
    // runs on `krD` rather than on `p`. A level can sit a few hundred metres
    // from the origin and this is squaring distances; keeping the operands
    // under a hundred metres costs nothing and keeps the whole test comfortably
    // inside float precision even where a driver decides mediump is good enough.
    for (const seg of volume.segments) {
      const dx = seg.bx - seg.ax, dy = seg.by - seg.ay, dz = seg.bz - seg.az;
      const inv = 1 / Math.max(dx * dx + dy * dy + dz * dz, 1e-6);
      lines.push(
        `\tap = krD - vec3( ${F(seg.ax - volume.cx)}, ${F(seg.ay - volume.cy)}, ` +
          `${F(seg.az - volume.cz)} );`,
        `\tt = clamp( dot( ap, vec3( ${F(dx)}, ${F(dy)}, ${F(dz)} ) ) * ${F(inv)}, 0.0, 1.0 );`,
        `\tq = ap - vec3( ${F(dx)}, ${F(dy)}, ${F(dz)} ) * t;`,
        `\ts = ${F(seg.s0)} + ${F(seg.s1 - seg.s0)} * t;`,
        `\tm = max( m, ( 1.0 - smoothstep( ${F(fit.rIn * fit.rIn)}, ` +
          `${F(fit.rOut * fit.rOut)}, dot( q, q ) ) )` +
          ` * smoothstep( 0.0, ${F(fit.mouth)}, s )` +
          ` * smoothstep( 0.0, ${F(fit.mouth)}, ${F(volume.total)} - s ) );`,
      );
    }
    lines.push('\treturn m;');
    body = lines.join('\n');
  }

  return `${original}

// --- @homie-rocks/render: scene-wide lighting state -------------------------------
// 1 deep inside an enclosed volume, 0 in the open. Written once per fragment by
// the patched <lights_fragment_begin>; read by the indirect terms, by the
// shadowless fill lights and by aerial perspective.
float krInterior = 0.0;

/** World-space shading normal. Written alongside krInterior; the shadow filter
 *  needs it for its receiver-plane bias and the fills need it for nothing at
 *  all, but recovering it twice from the view matrix would be silly. */
vec3 krWorldNormal = vec3( 0.0, 1.0, 0.0 );

/** The key's own shadow test, 0 = fully occluded .. 1 = fully lit. Written by
 *  the directional loop at cascade 0 and read by the fill coupling and by the
 *  warm terminator band. 1 when there is no shadow map at all, which is right:
 *  with nothing to occlude the key, nothing is in its shadow. */
float krKeyShadow = 1.0;

/** How much of the KEY this fragment is actually receiving, shaped — shadow
 *  test times a saturating N·L. This, not the shadow test alone, is what a cool
 *  fill is coupled against: a surface turned away from the sun is in shade
 *  whatever the shadow map says. */
float krKeyLit = 0.0;

/** Peaks at the half-shadow line, zero at both ends. The penumbra band. */
float krPenumbra = 0.0;

float krInteriorAt( vec3 p ) {
${body}
}
${extra}`;
}

/**
 * Set `krInterior` and `krWorldNormal` before anything reads them.
 *
 * The world position is reconstructed the way three itself does it for its
 * light-probe grid, so a fragment cannot be in two places at once depending on
 * which chunk asked.
 *
 * AN ANCHOR THAT MOVED IS A PATCH THAT SILENTLY DOES NOTHING — three renames
 * chunk internals between minor versions and `String.replace` reports success
 * either way. A miss returns the original and hands the caller `false`, so the
 * caller can warn or refuse rather than shipping a scene whose interior is
 * permanently zero and looks merely a bit bright.
 */
export function interiorWriteChunk(original: string): { glsl: string; landed: boolean } {
  const anchor = 'vec3 geometryClearcoatNormal = vec3( 0.0 );';
  if (!original.includes(anchor)) return { glsl: original, landed: false };
  return {
    landed: true,
    glsl: original.replace(anchor, `${anchor}

	krInterior = krInteriorAt( ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz );
	// three's own inverseTransformDirection: the view rotation is orthonormal, so
	// right-multiplying by it is the inverse. The shadow filter's receiver-plane
	// bias is expressed in the light's WORLD basis and needs this.
	krWorldNormal = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );
`),
  };
}

/**
 * ============================================================================
 *  N VOLUMES, EACH WITH ITS OWN FALLOFF AND ITS OWN DENSITY — AND THE ARC FIX
 *  THAT `interiorStateChunk` ABOVE DOES NOT HAVE.
 * ============================================================================
 *  Lifted out of a space racer's sky module, which had grown a
 *  second, independent copy of the test above. Three things differ and each is
 *  a capability rather than a taste:
 *
 *  1. MANY VOLUMES. A world with a smelting bay AND a service bore has two
 *     interiors that are nowhere near each other and are not the same shape.
 *     The single-volume form cannot express that at all.
 *  2. EACH CARRIES ITS OWN FIT. Radii, mouth taper and DENSITY are per volume,
 *     because "how thick is the wall" and "how much particulate is in the air"
 *     are properties of the room, not of the game.
 *  3. IT RETURNS vec2 — the occlusion mask and that volume's Beer density per
 *     metre — so a fog term has a density that is exactly zero everywhere
 *     outside a fitted volume, by construction, with no global to set by
 *     accident. `krInteriorFog` is that second component.
 *
 *  AND THE ONE THAT IS A BUG FIX RATHER THAN A CAPABILITY, which is why the
 *  single-volume form above should adopt it: THE ARC COORDINATE IS UNCLAMPED
 *  AND THE RADIAL ONE IS NOT. `interiorStateChunk` computes the mouth taper
 *  from the CLAMPED parameter, so every segment's start cap gets a hemisphere
 *  of FULL-STRENGTH interior pointing back up the tube — measured in the space
 *  racer at 19 m, with the second segment's cap sticking that hemisphere 9 m
 *  OUTSIDE the mouth, i.e. fog in vacuum. Clamping the radial distance is right
 *  (a capsule is a capsule); clamping the arc is what puts the taper in the
 *  wrong place. The asymmetry is the fix.
 *
 *  `decls` is spliced between the scene-wide declarations and `krInteriorAt`,
 *  `helpers` after it, so a game's own globals can be declared on either side
 *  of the function without this deciding the order for it.
 */
export interface InteriorVolumeFit extends InteriorVolume, InteriorFit {
  /** Beer density per metre inside this volume. The vec2's y component. */
  density: number;
}

export function interiorStateChunkMulti(
  original: string,
  volumes: readonly InteriorVolumeFit[],
  decls = '',
  helpers = '',
): string {
  const F = glslFloat;
  let body = '\treturn vec2( 0.0 );';

  if (volumes.length > 0) {
    const lines: string[] = ['\tvec2 acc = vec2( 0.0 );', '\tvec3 krD, ap, q; float t, tRaw, s, m;'];
    for (const volume of volumes) {
      if (volume.segments.length === 0) continue;
      lines.push(
        `\tkrD = p - vec3( ${F(volume.cx)}, ${F(volume.cy)}, ${F(volume.cz)} );`,
        `\tif ( dot( krD, krD ) < ${F(volume.radius * volume.radius)} ) {`,
        '\t\tm = 0.0;',
      );
      // Every segment is expressed RELATIVE to the volume centre, and the test
      // runs on `krD` rather than on `p`. A level can sit hundreds of metres
      // from the origin and this is squaring distances; keeping the operands
      // small costs nothing and keeps the test inside float precision even
      // where a driver decides mediump is good enough.
      for (const seg of volume.segments) {
        const dx = seg.bx - seg.ax, dy = seg.by - seg.ay, dz = seg.bz - seg.az;
        const inv = 1 / Math.max(dx * dx + dy * dy + dz * dz, 1e-6);
        lines.push(
          `\t\tap = krD - vec3( ${F(seg.ax - volume.cx)}, ${F(seg.ay - volume.cy)}, ` +
            `${F(seg.az - volume.cz)} );`,
          `\t\ttRaw = dot( ap, vec3( ${F(dx)}, ${F(dy)}, ${F(dz)} ) ) * ${F(inv)};`,
          `\t\tt = clamp( tRaw, 0.0, 1.0 );`,
          `\t\tq = ap - vec3( ${F(dx)}, ${F(dy)}, ${F(dz)} ) * t;`,
          // UNCLAMPED, and the header says what clamping it costs.
          `\t\ts = ${F(seg.s0)} + ${F(seg.s1 - seg.s0)} * tRaw;`,
          `\t\tm = max( m, ( 1.0 - smoothstep( ${F(volume.rIn * volume.rIn)}, ` +
            `${F(volume.rOut * volume.rOut)}, dot( q, q ) ) )` +
            ` * smoothstep( 0.0, ${F(volume.mouth)}, s )` +
            ` * smoothstep( 0.0, ${F(volume.mouth)}, ${F(volume.total)} - s ) );`,
        );
      }
      lines.push(
        `\t\tacc = max( acc, vec2( m, m * ${F(volume.density)} ) );`,
        '\t}',
      );
    }
    lines.push('\treturn acc;');
    body = lines.join('\n');
  }

  return `${original}

// --- @homie-rocks/render: scene-wide lighting state -------------------------------
// x: 1 deep inside an enclosed volume, 0 in the open. Read by the indirect
// terms and by any shadowless fill.
// y: that volume's Beer density per metre. Read by aerial perspective, which is
// the ONLY thing that can switch fog on — there is no global term to add to it.
float krInterior = 0.0;
float krInteriorFog = 0.0;

/** World-space shading normal. Written alongside krInterior; the shadow filter
 *  needs it for its receiver-plane bias. */
vec3 krWorldNormal = vec3( 0.0, 1.0, 0.0 );

/** The key's own shadow test, 0 = fully occluded .. 1 = fully lit. Written by
 *  the directional loop at cascade 0. 1 when there is no shadow map at all,
 *  which is right: with nothing to occlude the key, nothing is in its shadow. */
float krKeyShadow = 1.0;
${decls}
vec2 krInteriorAt( vec3 p ) {
${body}
}
${helpers}`;
}

/**
 * The name of the GEOMETRIC shading normal in this build of three, or null.
 *
 * THE SHADOW RECEIVER'S NORMAL IS GEOMETRIC, NOT SHADED, AND THE DIFFERENCE IS
 * NOT COSMETIC. `geometryNormal` is three's SHADING normal —
 * `normal_fragment_maps` has already run by the time `lights_fragment_begin`
 * does, so it carries the normal map. The receiver-plane gradient a cascade
 * filter quotes it against is not a shading quantity: it answers "how much does
 * stored depth change per texel of lateral travel ALONG THE SURFACE THE SHADOW
 * MAP RASTERISED", and the shadow map was rasterised from vertex geometry with
 * no normal map on it. Quoting it against a perturbed normal asks the wrong
 * surface.
 *
 * The gradient carries a 1/nz where nz = N·(toward the key), so the error grows
 * without bound as the key grazes: a fragment whose facet tips away from the
 * key clamps on the floor and is UNDER-biased, which is acne, and one that tips
 * toward it is over-biased, which is a leak. PCF and a temporal resolve then
 * average that into a shadow term with no structure in it. The consumer with
 * the low key and the strong plate relief carries the measurement.
 *
 * `nonPerturbedNormal` is declared by `normal_fragment_begin`, which every lit
 * material includes and includes BEFORE this chunk, so it is in scope. A future
 * three that renames it returns null here rather than failing to compile or
 * regressing in silence, and the caller decides whether to warn or refuse.
 */
export function receiverNormalName(shaderChunk: { normal_fragment_begin?: string }): string | null {
  return shaderChunk.normal_fragment_begin?.includes('nonPerturbedNormal')
    ? 'nonPerturbedNormal' : null;
}

/**
 * `interiorWriteChunk`'s partner for the vec2 form.
 *
 * Same anchor, same world-position reconstruction, and the same refusal to
 * report success on a miss — three renames chunk internals between minor
 * versions and `String.replace` reports success either way, so a miss returns
 * the original and hands back `landed: false`.
 *
 * TWO THINGS IT DOES THAT `interiorWriteChunk` DOES NOT, and the second is the
 * one to notice. It splits the vec2 into `krInterior` and `krInteriorFog`,
 * which is what `interiorStateChunkMulti` returns; and it takes the receiver
 * normal BY NAME instead of hard-coding `geometryNormal`. See
 * `receiverNormalName` above for why the hard-coded one is the wrong surface —
 * that is a defect `interiorWriteChunk` still has, left alone here because
 * changing it changes a picture in a game that could not be re-photographed
 * when this moved.
 *
 * `extraWrites` is spliced between the interior split and the normal, because a
 * game that needs the world position this has just reconstructed should not
 * have to reconstruct it again.
 */
export function interiorWriteChunkMulti(
  original: string,
  receiverNormal: string,
  extraWrites = '',
): { glsl: string; landed: boolean } {
  const anchor = 'vec3 geometryClearcoatNormal = vec3( 0.0 );';
  if (!original.includes(anchor)) return { glsl: original, landed: false };
  return {
    landed: true,
    glsl: original.replace(anchor, `${anchor}

	vec3 krWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	vec2 krVol = krInteriorAt( krWorldPos );
	krInterior = krVol.x;
	krInteriorFog = krVol.y;
${extraWrites}
	// three's own inverseTransformDirection: the view rotation is orthonormal, so
	// right-multiplying by it is the inverse. The shadow filter's receiver-plane
	// bias is expressed in the light's WORLD basis and needs this.
	krWorldNormal = normalize( ( vec4( ${receiverNormal}, 0.0 ) * viewMatrix ).xyz );
`),
  };
}
