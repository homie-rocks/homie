/**
 * ============================================================================
 *  Contact — screen-space contact shadows and contact-scale occlusion.
 * ============================================================================
 *
 *  TWO TERMS IN ONE PASS BECAUSE THEY SHARE THEIR EXPENSIVE HALF: the view
 *  position reconstruction and the depth-derived normal are computed once and
 *  both terms read them, so the second cue costs its taps and nothing else.
 *  Both are scene-linear light REMOVALS, so the pass belongs after ambient
 *  occlusion and before bloom — while the buffer still holds scene-linear light
 *  and before the bloom pass decides which of it is hot enough to spread.
 *
 *  ── WHERE IT CAME FROM, AND WHY IT IS PLATFORM ──────────────────────────────
 *
 *  One game's post-processing module. It had exactly ONE COPY and was
 *  therefore invisible to every duplication signal — the same category as
 *  `./Resolve.ts` and `./Bloom.ts`, which were extracted from a space racer
 *  for the same reason. The criterion applied here: **ask whether it belongs
 *  in a game, never whether there is a twin.** A ray march along a light
 *  direction through a depth buffer, and a disc of depth taps asked "is
 *  something STANDING on this surface", are facts about a depth buffer.
 *  Nothing in the code below is about that game's world: a vocabulary scan
 *  over the moved region found none of its words in any line of code, and
 *  that is what settles it rather than this paragraph.
 *
 *  ── WHAT DID NOT MOVE, AND THE RULE IS STRUCTURAL ───────────────────────────
 *
 *  **Every number.** `ContactLook` has TWENTY-TWO required fields, no
 *  optionals, and this package reaches for no default anywhere. That is the
 *  same rule `ChainLook`, `LensLook` and `ResolveLook` follow, and it exists
 *  because a default here is one game silently inheriting another game's art
 *  direction while looking completely fine.
 *
 *  Two of those fields are worth naming because they were LITERALS in the
 *  shader and a literal in a platform file is a default that cannot even be
 *  overridden:
 *
 *    · `facingLo` / `facingHi` — the gate that stops a surface already turned
 *      away from the key taking a second darkening on top of the lambert term.
 *      The original game ships 0.015 / 0.14 because its art direction makes a
 *      key at 4-18 degrees the hero look, and an earlier 0.30 upper edge was
 *      deleting 70-76% of the cue on exactly those two lighting states. A game
 *      lit from overhead wants a completely different pair, and would have got
 *      this one.
 *
 *    · `biasFloor` / `biasSlope` — the depth-proportional march bias, whose
 *      slope is a function of the game's FOV and line count (what a
 *      screen-space march can resolve is bounded by the world size of a PIXEL).
 *      The original game's 0.0014 is 1.5 pixel-widths at 55 degrees over 1080
 *      lines. It is also the REJECTION floor, i.e. the smallest occluder the
 *      term can see at all, so a game that inherited it would silently lose
 *      every occluder shorter than somebody else's boot.
 *
 *  ── THE SHADER TEXT IS THE SHIPPED BYTES ────────────────────────────────────
 *
 *  The GLSL below is the original game's contact fragment, unmodified except
 *  that the art-direction literals named above became `MB_CS_*`-style defines.
 *  A probe checks that and does not take the claim on trust: it expands every
 *  define on BOTH sides and compares the preprocessed programs, so a promoted
 *  literal is provably a no-op rather than a promise that it was.
 *
 *  ── ABLATABLE BY CONSTRUCTION, EACH TERM SEPARATELY ─────────────────────────
 *
 *  A coefficient is not evidence and an ablation is:
 *
 *    effect.strength = 0     the march
 *    effect.aoStrength = 0   the contact occlusion
 *
 *  With both at zero the shader takes its early-out on the first line, so the
 *  identical frozen frame renders with and without and subtracts.
 *
 *  WHAT IT COSTS: one fullscreen pass, `aoSteps` + `steps` depth taps plus 2
 *  for the normal.
 * ============================================================================
 */
import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * EVERY NUMBER THE TWO TERMS ARE MADE OF. No optionals, no defaults, and this
 * package supplies none of them.
 *
 * Grouped by which term reads it, because that is the only way a reader can
 * tell which of the twenty-two they are looking for.
 */
export interface ContactLook {
  // ── the key-light march ──────────────────────────────────────────────────
  /** March length in world metres. */
  length: number;
  /**
   * Floor on that length expressed in SCREEN PIXELS, and the reason the cue
   * survives to the back of the frame. Below this many pixels the ray is
   * lengthened until it reaches them.
   */
  minPixels: number;
  /**
   * Ceiling on that lengthening, in metres. Without it the pixel floor
   * manufactures a forty-metre "contact" shadow on the horizon, which is a
   * different bug wearing the same fix.
   */
  maxLength: number;
  /**
   * Assumed occluder thickness, metres. A depth sample in front of the ray is
   * only treated as an occluder if it is in front by less than this — otherwise
   * the sky-facing side of a distant hill occludes everything in front of it.
   */
  thickness: number;
  /** How much light a full contact occlusion removes. */
  strength: number;
  /**
   * The multiplier a FULLY occluded pixel keeps. Deliberately not black: a
   * shadow that reaches #000 is claiming nothing at all is lighting it, and
   * something always is.
   */
  residue: THREE.Color;
  /** Number of march steps. Floored at 2 by the constructor. */
  steps: number;
  /**
   * The key-facing gate, and it is ART DIRECTION rather than a tolerance.
   *
   * `smoothstep(facingLo, facingHi, dot(N, light))`. The upper edge is "how
   * steeply lit does a surface have to be before the march is at full
   * strength", which is a statement about the game's key elevation and nothing
   * else. The lower edge stays non-zero on purpose: the normal comes from two
   * depth differences and a silhouette pixel produces a wrong one, so the soft
   * rejection is what keeps those from punching holes.
   */
  facingLo: number;
  facingHi: number;
  /**
   * The depth-proportional march bias, `max(biasFloor, biasSlope * -viewZ)`.
   *
   * A constant bias peter-pans in the foreground and does nothing at 400 m.
   * `biasSlope` is a function of the game's vertical FOV and line count —
   * `2 * tan(fov/2) / lines` is one pixel-width per metre of depth — and it is
   * ALSO the rejection floor, i.e. the shortest occluder the march can see.
   */
  biasFloor: number;
  biasSlope: number;

  // ── the contact-scale occlusion ──────────────────────────────────────────
  /** Disc radius in world metres. */
  aoRadius: number;
  /** Floor on that radius in screen pixels — what keeps the term alive at range. */
  aoMinPixels: number;
  /** Ceiling on it, so it does not become a broad AO in the foreground. */
  aoMaxPixels: number;
  /** Ceiling in METRES on the pixel-floor lengthening. Same guard as maxLength. */
  aoMaxRadius: number;
  /** How much ambient a full occlusion removes. */
  aoStrength: number;
  /** The multiplier a fully occluded pixel keeps. See `residue`. */
  aoResidue: THREE.Color;
  /** Number of disc taps. Floored at 1 by the constructor. */
  aoSteps: number;
  /** Vogel spiral turn count. Deliberately not a whole number, or the taps spoke. */
  aoTurns: number;
  /** Overall gain on the accumulated occlusion, before the clamp to 0..1. */
  aoGain: number;
  /**
   * The receiver-plane gate. A sample must stand at least this many metres out
   * of the receiver's OWN surface plane to count. The floor rejects the
   * receiver's own surface and its depth quantisation; without it a flat plain
   * accumulates a fraction of a tap from round-off alone, which is a global
   * dimmer assembled out of noise.
   */
  aoMinHeight: number;
  /** A thing standing this many metres proud occludes fully. */
  aoFullHeight: number;
  /**
   * The steepness discriminator, height over lateral run. This is what
   * separates a surface's own texture from an object standing on it, and the
   * two edges are measured against the GAME'S terrain: the ramp must start
   * above every figure the ground itself produces and be saturated by
   * everything that stands on it.
   */
  aoSteepLo: number;
  aoSteepHi: number;
  /**
   * The receiver's own ground-likeness gate, `smoothstep(groundLo, groundHi,
   * dot(N, worldUp))`. A ramp rather than a cut, so a chamfer or a dune flank
   * does not end abruptly halfway across itself.
   */
  groundLo: number;
  groundHi: number;
  /**
   * Inner edge of the lateral falloff, as a FRACTION of the disc radius:
   * `1 - smoothstep(aoRadius * aoFalloffInner, aoRadius, lateral)`.
   */
  aoFalloffInner: number;
  /** Floor on the lateral run before dividing into it. Guards a vertical face. */
  aoLatFloor: number;
  /**
   * The name a WebGL frame capture shows for this pass.
   *
   * REQUIRED, and it is not cosmetic: two games' contact passes both calling
   * themselves `ContactShadow` are two rows in a capture nobody can tell apart.
   * `./Resolve.ts` requires the same field for the same reason.
   */
  materialName: string;
}

/**
 * Render a number as a GLSL float literal.
 *
 * `String(7)` is `7`, which is an INT in GLSL and a compile error where a float
 * is wanted; `.toFixed(n)` picks a precision that may not round-trip. This
 * emits the shortest text that parses back to the same double, which is what
 * lets a probe compare two preprocessed programs by VALUE with `Object.is`
 * rather than by a string that happens to match.
 */
function glslFloat(v: number): string {
  if (!Number.isFinite(v)) {
    throw new RangeError(`Contact: ${v} is not a finite number and cannot be a shader constant.`);
  }
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/*
 * ===========================================================================
 *  NO BACKTICKS BELOW THIS LINE (until the end of the template literal).
 *
 *  A backtick inside a GLSL template literal ends the string, and the rest of
 *  the file then parses as TypeScript and fails 100-200 lines later. Under
 *  Vite that 500s the module and nothing imports it, which looks exactly like a
 *  slow load. One runtime module shipped this exact defect in three games at
 *  once. Do not write identifiers in backticks in any
 *  comment below.
 * ===========================================================================
 */
const CONTACT_FRAGMENT = /* glsl */ `
uniform mat4 csProj;      // the camera's projection matrix, THIS frame
uniform mat4 csProjInv;   // and its inverse
uniform vec3 csLight;     // unit vector toward the key light, in VIEW space
uniform vec4 csParams;    // x world length m, y min length px, z thickness m, w strength
uniform vec3 csResidue;   // multiplier a fully occluded pixel keeps
uniform vec4 csAo;        // x radius m, y min px, z max px, w strength
uniform vec3 csAoResidue; // multiplier a fully occluded pixel keeps, contact AO
uniform vec3 csUp;        // WORLD up, in view space, THIS frame

// NEAR AND FAR ARE DELIBERATELY NOT USED, and that is a bug fix rather than a
// style choice. postprocessing copies cameraNear/cameraFar into the effect
// material ONCE, when the pass adopts its camera — EffectMaterial.
// copyCameraSettings also raises needsUpdate, so it cannot be called per frame
// without recompiling the program every frame. A game that moves camera.near
// and camera.far on an altitude ladder would therefore have the built-in
// getViewZ silently read a stale range the moment the player zoomed, and every
// contact shadow in the frame would move with it. The projection matrix below
// is pushed fresh every frame from syncCamera, costs nothing, and carries the
// same information exactly.
float mbCsViewZ(const in float d) {
  // Perspective: ndcZ = (P22*vz + P32) / (P23*vz), P23 = -1. Solve for vz.
  float ndcZ = d * 2.0 - 1.0;
  return -csProj[3][2] / (ndcZ + csProj[2][2]);
}

vec3 mbCsViewPos(const in vec2 uv, const in float d) {
  float vz = mbCsViewZ(d);
  vec4 clip = vec4(vec3(uv, d) * 2.0 - 1.0, 1.0);
  clip *= csProj[2][3] * vz + csProj[3][3];
  return (csProjInv * clip).xyz;
}

float mbCsHash(const in vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// ── GROUND-CONTACT OCCLUSION ─────────────────────────────────────────────────
// "How much geometry STANDS ON this piece of ground within half a metre of it."
// Not a general small-radius SSAO — that was tried first and the picture said no
// (the measurement is beside the game's own aoRadius, where it belongs).
//
// The difference is the whole point. A horizon obscurance asks "how much of my
// hemisphere is closed off", which a figure's own elbow, knee and panel seams
// answer far more loudly than the dust under its boot does: measured at
// a close character pose, that formulation darkened the TORSO 1.55 counts and
// the ground at the feet 0.02, and speckled every raked slope in the frame,
// because the depth-derived normal wobbles at grazing incidence and a cosine
// test on a wobbly normal is noise. This one asks a question only a contact can
// answer, in terms of WORLD UP rather than of the surface normal:
//
//   * is the receiver ground-LIKE at all — does its normal point up?
//   * is the sample above the receiver's OWN SURFACE PLANE, and by how much?
//   * does it rise STEEPLY out of that plane, and is it within the disc radius
//     laterally, i.e. is something standing next to me rather than the ground
//     merely being tilted or lumpy?
//
// Open ground answers no to the third at every tap, at any inclination and
// however cratered, because a slope's neighbours lie IN its plane. A hull at
// mid-height answers no to the first: a barrel flank has no up. Under a boot
// every tap that lands on the figure answers yes to all three. The
// concentration is STRUCTURAL rather than tuned, which is the property the
// hemisphere formulation did not have and could not be tuned into having.
//
// Written against the view position and depth-derived normal that mainImage
// below already pays for on behalf of the march, so the marginal cost of this
// term is MB_CS_AO_STEPS depth taps: no extra pass, no extra render target, no
// half-res upsample, and no second normal reconstruction.
float mbCsAo(const in vec3 P, const in vec3 N, const in vec2 uv, const in float jitter) {
  if (csAo.w <= 0.0) return 0.0;

  // Only ground-like receivers. csUp is world up in VIEW space, pushed per frame
  // — it cannot be a constant here because the whole term is expressed in it and
  // the camera pitches. The ramp rather than a cut keeps a pad's chamfer and a
  // dune's flank from ending abruptly halfway across themselves. Both edges are
  // the game's; see ContactLook.groundLo.
  float ground = smoothstep(MB_CS_AO_GROUND_LO, MB_CS_AO_GROUND_HI, dot(N, csUp));
  if (ground <= 0.0) return 0.0;

  // World radius -> screen pixels. csProj[0][0] is 1/(aspect*tan(fov/2)), so a
  // view-space offset r at depth -P.z spans r * csProj[0][0] / -P.z in NDC.
  float rWorld = csAo.x;
  float px = rWorld * csProj[0][0] * 0.5 * resolution.x / max(1e-4, -P.z);
  // The floor is what keeps the term alive at range; the ceiling is what stops
  // it becoming a broad AO in the foreground. See ContactLook.aoMinPixels.
  if (px < csAo.y) {
    // Lengthening the radius in PIXELS means lengthening it in METRES too, and
    // the world cap is the guard against manufacturing a 20 m occlusion on the
    // horizon — the same trap maxLength closes for the march.
    rWorld = min(rWorld * (csAo.y / px), MB_CS_AO_MAX_RADIUS);
    px = csAo.y;
  }
  px = min(px, csAo.z);

  float occ = 0.0;
  for (int i = 0; i < MB_CS_AO_STEPS; i++) {
    float fi = (float(i) + 0.5) / float(MB_CS_AO_STEPS);
    // Vogel-ish: sqrt for equal-area coverage of the disc, a turn count that is
    // not a whole number of revolutions so the taps do not line up into spokes,
    // and the march's own hash as the per-pixel rotation.
    float ang = (fi * MB_CS_AO_TURNS + jitter) * 6.2831853;
    vec2 o = vec2(cos(ang), sin(ang)) * (sqrt(fi) * px) * texelSize;
    vec2 suv = uv + o;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sd = readDepth(suv);
    // The sky is not an occluder. Without this the silhouette of every object
    // against the black sky grows a dark halo, which is the single most
    // recognisable bad-SSAO artefact there is.
    if (sd >= 0.9999999) continue;
    vec3 v = mbCsViewPos(suv, sd) - P;
    // HOW MUCH HIGHER, measured against the RECEIVER'S OWN SURFACE and not
    // against world up. This is the line that decides whether the term is a
    // contact cue or a second global dimmer, so it is worth being explicit: a
    // uniform slope — a dune face, a crater wall, a graded ramp — has every
    // neighbour exactly IN its own plane, so this is zero across all of it, at
    // any inclination. Against world up the same slope returns half a disc of
    // "higher" neighbours and paints itself, which is what the first shipped
    // draft of this term did to every lit slope in the frame.
    //
    // The floor rejects the receiver's own surface and its depth quantisation;
    // without it a flat plain accumulates a fraction of a tap from round-off
    // alone, which is a global dimmer assembled out of noise.
    float h = dot(v, N);
    if (h < MB_CS_AO_MIN_HEIGHT) continue;
    // HOW FAR AWAY, in that same plane. Lateral is the right measure for a
    // contact: a wall 3 m tall standing 0.2 m away IS a contact, and its 3 m of
    // height must not push it out of range the way a 3D distance would.
    float lat = length(v - h * N);
    float fall = 1.0 - smoothstep(rWorld * MB_CS_AO_FALLOFF_INNER, rWorld, lat);
    if (fall <= 0.0) continue;
    // AND IT HAS TO RISE STEEPLY. Height over lateral run is the discriminator
    // between the ground's own texture and an object standing on it. The two
    // edges are the game's, measured against the terrain it generates; see
    // ContactLook.aoSteepLo.
    float steep = smoothstep(MB_CS_AO_STEEP_LO, MB_CS_AO_STEEP_HI, h / max(lat, MB_CS_AO_LAT_FLOOR));
    if (steep <= 0.0) continue;
    // A thing standing MB_CS_AO_FULL_HEIGHT proud occludes fully.
    occ += fall * steep * clamp(h * (1.0 / MB_CS_AO_FULL_HEIGHT), 0.0, 1.0);
  }
  return clamp(occ * (MB_CS_AO_GAIN / float(MB_CS_AO_STEPS)) * ground, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  // The sky is at the far plane and owns roughly a fifth of a hero frame. It
  // has no surface to stand on and marching from it is pure cost.
  if (depth >= 0.9999999 || (csParams.w <= 0.0 && csAo.w <= 0.0)) return;

  vec3 P = mbCsViewPos(uv, depth);

  // ── surface normal from depth, and why it is worth two extra taps ──────────
  // Without it every surface already turned AWAY from the key gets a second
  // darkening on top of the one the lambert term already applied, which reads
  // as grime rather than as contact. Forward differences, because dFdx would
  // need an extension on the WebGL1 path and this shader has no other reason to
  // ask for one. Silhouettes give a wrong normal here; the gate below is a
  // smoothstep rather than a cut precisely so a wrong normal costs a soft
  // attenuation rather than a hard hole.
  vec3 Px = mbCsViewPos(uv + vec2(texelSize.x, 0.0), readDepth(uv + vec2(texelSize.x, 0.0)));
  vec3 Py = mbCsViewPos(uv + vec2(0.0, texelSize.y), readDepth(uv + vec2(0.0, texelSize.y)));
  vec3 N = cross(Px - P, Py - P);
  float nl2 = dot(N, N);
  if (nl2 < 1e-12) return;
  N *= inversesqrt(nl2);
  if (N.z < 0.0) N = -N;

  // Interleaved start offset, shared by both terms below so neither of them
  // bands and the two do not share a pattern. The frame carries grain and an
  // SMAA resolve on top of this, which is enough to break what is left; a
  // Poisson set would cost taps neither term needs.
  float jitter = mbCsHash(uv * resolution) * 0.999 + 0.001;

  // ── the contact-scale occlusion, computed BEFORE the key gate ──────────────
  // It is an OCCLUSION and not a shadow: it does not care where the key is, and
  // gating it on the key-facing term would delete it on exactly the raked ground
  // an intimate pose is made of.
  float ao = mbCsAo(P, N, uv, jitter);

  float ndl = dot(N, csLight);
  // The key-facing gate. BOTH EDGES ARE THE GAME'S — see ContactLook.facingLo
  // for why an upper edge of 0.30 is not "facing away from the key" but "lit at
  // more than 17 degrees", and what that costs a game whose art direction puts
  // the key below it.
  float facing = smoothstep(MB_CS_FACE_LO, MB_CS_FACE_HI, ndl);
  // NOT A RETURN. The contact-scale occlusion above does not depend on the key
  // and has to survive a fragment the key has turned away from — which under a
  // low sun is most of the ground beside a figure's own cast shadow, i.e.
  // precisely the pixels a viewer reads the contact off.
  float occ = 0.0;
  if (facing > 0.0 && csParams.w > 0.0) {

  // ── ray length: world first, then a floor in pixels ───────────────────────
  float len = csParams.x;
  vec4 e0 = csProj * vec4(P, 1.0);
  vec4 e1 = csProj * vec4(P + csLight * len, 1.0);
  if (e0.w > 1e-5 && e1.w > 1e-5) {
    vec2 s0 = e0.xy / e0.w;
    vec2 s1 = e1.xy / e1.w;
    float px = length((s1 - s0) * 0.5 * resolution);
    if (px > 1e-4 && px < csParams.y) {
      len = min(len * (csParams.y / px), MB_CS_MAX_LENGTH);
    }
  }

  // Depth-proportional bias. A constant one peter-pans in the foreground and
  // does nothing at all at 400 m. Both terms are the game's: see
  // ContactLook.biasSlope, which is ALSO the rejection floor and therefore the
  // shortest occluder this march can see at each distance.
  float bias = max(MB_CS_BIAS_FLOOR, MB_CS_BIAS_SLOPE * (-P.z));
  vec3 O = P + N * bias;

  for (int i = 0; i < MB_CS_STEPS; i++) {
    float t = (float(i) + jitter) / float(MB_CS_STEPS);
    vec3 S = O + csLight * (len * t);
    vec4 cp = csProj * vec4(S, 1.0);
    if (cp.w <= 1e-5) break;
    vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float sd = readDepth(suv);
    if (sd >= 0.9999999) continue;
    // View z is negative and grows toward the camera, so a scene surface in
    // FRONT of the ray sample has the larger value.
    float diff = mbCsViewZ(sd) - S.z;
    if (diff > bias && diff < csParams.z + bias) {
      // Nearest contact wins, and it wins hardest: the darkening has to be
      // strongest where the foot meets the ground and gone within a metre, or
      // it reads as dirt under the object rather than as an occlusion.
      occ = max(occ, 1.0 - t);
    }
  }

  }

  // TWO MULTIPLIES AND NOT ONE SUM. They are different occlusions of different
  // things — the march removes the KEY where an occluder blocks it, the disc
  // removes the AMBIENT hemisphere the geometry has closed off — and each keeps
  // its own residue, so a pixel that is both fully shadowed and fully occluded
  // still lands on the game's authored shadow floor rather than on black.
  float k = csParams.w * occ * facing;
  outputColor.rgb = inputColor.rgb
    * mix(vec3(1.0), csResidue, k)
    * mix(vec3(1.0), csAoResidue, ao * csAo.w);
}
`;

/** The shader source, unexpanded. Exported so a probe can preprocess it. */
export { CONTACT_FRAGMENT };

/**
 * The defines this look compiles to, as the effect would build them.
 *
 * EXPORTED SO A HARNESS CAN PREPROCESS THE PROGRAM WITHOUT A GL CONTEXT. That
 * is not a convenience: the probe's whole claim is that promoting a literal to
 * a define changed no program, and it can only make that claim by expanding
 * both sides. A harness that had to guess the mapping would be asserting its
 * own guess.
 */
export function contactDefines(look: ContactLook): Map<string, string> {
  return new Map([
    ['MB_CS_STEPS', String(Math.max(2, Math.round(look.steps)))],
    ['MB_CS_MAX_LENGTH', glslFloat(look.maxLength)],
    ['MB_CS_FACE_LO', glslFloat(look.facingLo)],
    ['MB_CS_FACE_HI', glslFloat(look.facingHi)],
    ['MB_CS_BIAS_FLOOR', glslFloat(look.biasFloor)],
    ['MB_CS_BIAS_SLOPE', glslFloat(look.biasSlope)],
    // The occlusion's constants are DEFINES rather than uniforms because none
    // of them is a live knob: the two a harness ever wants to move are the
    // radius and the strength, and those are in csAo. A define also lets the
    // compiler fold the loop bound, which on a 12-tap spiral is worth having.
    ['MB_CS_AO_STEPS', String(Math.max(1, Math.round(look.aoSteps)))],
    ['MB_CS_AO_TURNS', glslFloat(look.aoTurns)],
    ['MB_CS_AO_GAIN', glslFloat(look.aoGain)],
    ['MB_CS_AO_MIN_HEIGHT', glslFloat(look.aoMinHeight)],
    ['MB_CS_AO_FULL_HEIGHT', glslFloat(look.aoFullHeight)],
    ['MB_CS_AO_STEEP_LO', glslFloat(look.aoSteepLo)],
    ['MB_CS_AO_STEEP_HI', glslFloat(look.aoSteepHi)],
    ['MB_CS_AO_MAX_RADIUS', glslFloat(look.aoMaxRadius)],
    ['MB_CS_AO_GROUND_LO', glslFloat(look.groundLo)],
    ['MB_CS_AO_GROUND_HI', glslFloat(look.groundHi)],
    ['MB_CS_AO_FALLOFF_INNER', glslFloat(look.aoFalloffInner)],
    ['MB_CS_AO_LAT_FLOOR', glslFloat(look.aoLatFloor)],
  ]);
}

/** Scratch. Nothing below allocates once the effect is built. */
const _csQuat = new THREE.Quaternion();

/**
 * The contact pass — a key-light march AND a contact-scale occlusion.
 *
 * `steps` and `aoSteps` are read off the look rather than passed separately,
 * because a tier that wants fewer taps is picking a different LOOK: the two
 * counts and the strengths move together (a march with zero steps must also
 * carry zero strength, or MB_CS_STEPS's floor of 2 would march anyway).
 */
export class ContactShadowEffect extends Effect {
  constructor(look: ContactLook) {
    super(look.materialName, CONTACT_FRAGMENT, {
      // DEPTH, not CONVOLUTION: this effect samples the DEPTH buffer at offsets,
      // never the colour input, so it can legally share a pass — it just has no
      // one to share with, sitting alone between AO and bloom.
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      defines: contactDefines(look),
      uniforms: new Map<string, THREE.Uniform>([
        ['csProj', new THREE.Uniform(new THREE.Matrix4())],
        ['csProjInv', new THREE.Uniform(new THREE.Matrix4())],
        // Straight up until the first sync, which is a direction that produces
        // no contact anywhere rather than a wrong one somewhere.
        ['csLight', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        // Strength zero when this tier asked for no march: the pass may exist
        // for the occlusion term alone, and MB_CS_STEPS is floored at 2 so a
        // zero step count would otherwise still march twice.
        ['csParams', new THREE.Uniform(new THREE.Vector4(
          look.length, look.minPixels, look.thickness, look.steps > 0 ? look.strength : 0))],
        ['csResidue', new THREE.Uniform(look.residue.clone())],
        ['csAo', new THREE.Uniform(new THREE.Vector4(
          look.aoRadius, look.aoMinPixels, look.aoMaxPixels,
          look.aoSteps > 0 ? look.aoStrength : 0))],
        ['csAoResidue', new THREE.Uniform(look.aoResidue.clone())],
        // Pushed every frame by syncCamera. Starts at view-space up for an
        // unrotated camera, which is a direction that produces no wrong contact
        // anywhere rather than a right one somewhere.
        ['csUp', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
      ]),
    });
  }

  get params(): THREE.Vector4 { return this.uniforms.get('csParams')!.value as THREE.Vector4; }
  get ao(): THREE.Vector4 { return this.uniforms.get('csAo')!.value as THREE.Vector4; }
  get lightView(): THREE.Vector3 { return this.uniforms.get('csLight')!.value as THREE.Vector3; }
  get strength(): number { return this.params.w; }
  set strength(v: number) { this.params.w = v; }
  /** Contact-occlusion strength — the second ablation handle. See the header. */
  get aoStrength(): number { return this.ao.w; }
  set aoStrength(v: number) { this.ao.w = v; }
  /** Contact-occlusion world radius in metres, so a sweep runs on one page load. */
  get aoRadius(): number { return this.ao.x; }
  set aoRadius(v: number) { this.ao.x = v; }

  /** Pushed every frame; see the note in the shader about stale near/far. */
  syncCamera(camera: THREE.PerspectiveCamera): void {
    (this.uniforms.get('csProj')!.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (this.uniforms.get('csProjInv')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    // World up, rotated into view space. Taken off the camera's own quaternion
    // rather than off matrixWorldInverse for the same reason the light direction
    // is: three does not refresh that matrix until it is inside render(), i.e.
    // after this runs, so reading it here would push last frame's basis and the
    // ground-contact term would lag every camera move.
    (this.uniforms.get('csUp')!.value as THREE.Vector3)
      .set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(_csQuat).invert());
  }
}
