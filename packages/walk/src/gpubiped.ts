/**
 * ============================================================================
 *  gpubiped — A THIRTEEN-BONE BIPED POSED IN THE VERTEX SHADER.
 * ============================================================================
 *
 *  `Gait.ts` in this package is a CLOCK: it owns a phase, advances it by
 *  distance travelled, and says when a foot lands. It runs on the CPU, once
 *  per figure, and that is the right cost for the one figure a player is.
 *
 *  This is the other half, and it exists because a CROWD cannot pay that.
 *  `GaitClock` is CPU-only, and a hundred and fifty walking figures at one JS
 *  pose solve each is a hundred and fifty times a cost that was sized for one.
 *  So the whole skeleton is solved in GLSL from three vec4s of per-instance
 *  state, every figure in one draw call, and the CPU uploads a phase rather
 *  than a pose.
 *
 * ----------------------------------------------------------------------------
 *  WHAT IS HERE, AND WHY EVERY LINE OF IT IS MECHANISM
 * ----------------------------------------------------------------------------
 *  · `rotX/rotY/rotZ` — a rotation about an axis through a pivot, with `w`
 *    gating the translation. w = 1 for a position, 0 for a direction. Folding
 *    both into one function is what makes the normal path provably the same
 *    chain as the position path; two functions is two chances to diverge, and
 *    the symptom is lighting that swims a frame behind the silhouette.
 *  · `bodyArc` — the pelvis's vertical travel over one step. Stance
 *    compresses; flight is the exact parabola of a body launched to hang for
 *    t_flight seconds under the surface gravity the CALLER states. Nothing
 *    here knows which world it is on.
 *  · `legIK` — closed-form two-bone IK in the sagittal plane, with the contact
 *    foot's body-local Z sliding at exactly walk speed across the stance
 *    window. That is what makes foot skate structurally impossible rather than
 *    merely tuned away, and it is the single most valuable line in the file.
 *  · `torso` / `skin` — the bone hierarchy. Thirteen bones, indexed off a
 *    single `aBone` vertex attribute: pelvis, torso, head, two arms of two
 *    bones, two legs of three.
 *  · the attribute and uniform plumbing, so one shader poses a single figure
 *    from uniforms and a crowd from instance attributes without a second path.
 *
 * ----------------------------------------------------------------------------
 *  WHAT IS NOT HERE, AND THIS IS THE WHOLE OF THE SEAM
 * ----------------------------------------------------------------------------
 *  `solve()`. The function that decides WHAT POSE this figure is in — walking,
 *  carrying, welding, inspecting, hauling, idling — is the caller's, arrives
 *  as a GLSL string, and is spliced in exactly where it was. A task list is
 *  fiction: which four jobs a crowd does, how far a welder crouches, and where
 *  a pair of hands has to land to be under the crate they are holding are
 *  answers to one game's questions. This file has no opinion about any of them
 *  and cannot acquire one, because it never names a job.
 *
 *  The PROPORTIONS are the caller's too, and they are why this is a parameter
 *  list rather than a copied file: hip height, hip half-width, ankle height,
 *  thigh and shin length, waist, neck, shoulder, elbow, the standing crouch,
 *  the stance duty and the surface gravity all arrive as numbers and are baked
 *  into the shader as `const float`. A different skeleton is a different set
 *  of thirteen numbers, not a fork.
 *
 * ----------------------------------------------------------------------------
 *  THE PREFIX IS A REAL PARAMETER
 * ----------------------------------------------------------------------------
 *  Every identifier this emits is prefixed, defaulting to `bp`. Two rigs can
 *  therefore live in one shader without colliding, and — the reason it is
 *  spelled as a parameter and not a constant — a test can prove the emitted
 *  text actually varies with it. An extracted option that was quietly welded
 *  shut passes a parity check perfectly, so the parity test changes the
 *  prefix, the gravity and one proportion and requires three different
 *  strings out.
 *
 *  The caller's `solve` must of course use the same prefix it asked for. That
 *  is the one coupling, it is stated here, and `bipedPoseGLSL` throws if the
 *  spliced body does not define `<prefix>Solve` — a silently missing solve
 *  links to nothing and leaves every joint at its default zero, i.e. a whole
 *  crowd frozen in rest pose, which reads as art that was never finished
 *  rather than as plumbing that was never connected.
 * ============================================================================
 */

/** The eleven measurements that make one skeleton, in metres. */
export interface BipedProportions {
  /** hip joint height above the sole, at rest */
  hipY: number;
  /** hip joint half-separation, i.e. half the stance width */
  hipX: number;
  /** ankle joint height above the sole */
  ankleY: number;
  /** thigh length, hip to knee */
  l1: number;
  /** shin length, knee to ankle */
  l2: number;
  /** waist pivot height — where the spine bends */
  waistY: number;
  /** neck pivot height */
  neckY: number;
  /** shoulder half-separation */
  shX: number;
  /** shoulder height */
  shY: number;
  /** elbow height at rest */
  elbY: number;
  /** how far the pelvis sits below `hipY` when standing, i.e. the knee bend */
  crouch: number;
}

export interface BipedPoseSpec extends BipedProportions {
  /**
   * Surface gravity, m/s^2. The float height between footfalls is DERIVED
   * from it, which is what makes a low-gravity lope a lope rather than a walk
   * played slowly. State it; nothing here assumes a planet.
   */
  gravity: number;
  /** Fraction of one cycle each foot spends planted. Half of it is a step. */
  duty: number;
  /** Identifier prefix for every symbol emitted. Default `bp`. */
  prefix?: string;
  /**
   * The caller's `void <prefix>Solve()`, verbatim. It reads the three vec4s
   * this file declares and writes the joint state this file declares, and
   * everything in it about WHAT the figure is doing belongs to the game.
   */
  solve: string;
}

/**
 * Five decimals, because that is the resolution at which a millimetre on a
 * two-metre figure survives the trip into a shader as text.
 */
const F = (n: number) => n.toFixed(5);

/**
 * The GLSL. Splice it into a vertex shader after `#include <common>` — or let
 * `patchBipedVertex` below do all four replacements.
 */
export function bipedPoseGLSL(s: BipedPoseSpec): string {
  const p = s.prefix ?? 'bp';
  const P = p.toUpperCase();
  if (!s.solve.includes(p + 'Solve')) {
    throw new Error(`bipedPoseGLSL: solve body does not define ${p}Solve()`);
  }
  return '\n' + head(s, p, P) + '\n\n' + s.solve + '\n\n' + tail(p, P) + '\n';
}

/**
 * The four `#include` replacements that hang the rig on three's own
 * MeshStandardMaterial vertex shader.
 *
 * `extraVertex` is appended after `transformed` is assigned, and is where a
 * caller passes whatever varyings its fragment stage wants off the
 * per-instance state. It is a string and not a set of flags on purpose: what a
 * game wants out of `aVar` is a game's question.
 *
 * `normal` DEFAULTS TRUE AND MUST BE FALSE ON A DEPTH PASS. three's depth
 * vertex shader carries `#include <beginnormal_vertex>` for the displacement
 * map it might have; replacing it there declares an `objectNormal` the depth
 * chunks then re-declare, and the shader fails to compile — or worse, on a
 * driver that tolerates it, the shadow silhouette is skinned by a second,
 * different chain from the colour pass.
 */
export function patchBipedVertex(
  src: string,
  common: string,
  opts: { prefix?: string; extraVertex?: string; normal?: boolean } = {},
): string {
  const p = opts.prefix ?? 'bp';
  let out = src
    .replace('#include <common>', '#include <common>\n' + common)
    .replace('#include <uv_vertex>',
      '\n  #include <uv_vertex>\n  ' + p + 'Solve();\n');
  if (opts.normal !== false) {
    out = out.replace('#include <beginnormal_vertex>',
      `vec3 objectNormal = normalize(${p}Skin(normal, 0.0));`);
  }
  return out.replace('#include <begin_vertex>',
    `vec3 transformed = ${p}Skin(position, 1.0);` + (opts.extraVertex ?? ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// The declarations, the constants and the three solvers. Everything up to the
// caller's solve().
// ─────────────────────────────────────────────────────────────────────────────
function head(s: BipedPoseSpec, p: string, P: string): string {
  return /* glsl */ `attribute float aBone;
#ifdef USE_INSTANCING
  attribute vec4 aAnim;   // x gait phase 0..1, y speed m/s, z cycle period s, w unused
  attribute vec4 aPoseW;  // four task blend weights, caller's meaning
  attribute vec4 aVar;    // x seed, y wear 0..1 (0 = factory fresh), z task time s, w unused
#endif
uniform vec4 uAnim;
uniform vec4 uPoseW;
uniform vec4 uVar;

// Surface gravity, m/s^2. The float height between footfalls is DERIVED from
// this constant — see ${p}BodyArc. The gait a body walks is a function of the
// world it is standing on, so the caller states it and nothing here assumes.
const float ${P}_G = ${F(s.gravity)};
const float ${P}_DUTY = ${F(s.duty)};
const float ${P}_PI = 3.14159265;

const float ${P}_HIPY = ${F(s.hipY)};
const float ${P}_HIPX = ${F(s.hipX)};
const float ${P}_ANKY = ${F(s.ankleY)};
const float ${P}_L1 = ${F(s.l1)};
const float ${P}_L2 = ${F(s.l2)};
const float ${P}_WAISTY = ${F(s.waistY)};
const float ${P}_NECKY = ${F(s.neckY)};
const float ${P}_SHX = ${F(s.shX)};
const float ${P}_SHY = ${F(s.shY)};
const float ${P}_ELBY = ${F(s.elbY)};
const float ${P}_CROUCH = ${F(s.crouch)};

// joint state, filled by ${p}Solve()
float ${p}HipL, ${p}HipR, ${p}KneeL, ${p}KneeR, ${p}AnkL, ${p}AnkR;
float ${p}ShXL, ${p}ShXR, ${p}ShZL, ${p}ShZR, ${p}ElbL, ${p}ElbR;
float ${p}Lean, ${p}Twist, ${p}HeadP, ${p}HeadY, ${p}BodyY, ${p}Roll, ${p}YawP;
vec4 ${p}Anim, ${p}PoseW, ${p}Var;

// A rotation about an axis through pivot. w = 1 for positions, 0 for
// directions — a normal must be rotated but never translated, and folding that
// into the same function is what keeps the normal path provably identical to
// the position path.
vec3 ${p}RotX(vec3 p, vec3 pivot, float w, float a) {
  vec3 q = p - pivot * w;
  float s = sin(a), c = cos(a);
  return vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c) + pivot * w;
}
vec3 ${p}RotY(vec3 p, vec3 pivot, float w, float a) {
  vec3 q = p - pivot * w;
  float s = sin(a), c = cos(a);
  return vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c) + pivot * w;
}
vec3 ${p}RotZ(vec3 p, vec3 pivot, float w, float a) {
  vec3 q = p - pivot * w;
  float s = sin(a), c = cos(a);
  return vec3(q.x * c - q.y * s, q.x * s + q.y * c, q.z) + pivot * w;
}

/**
 * Vertical travel of the pelvis over one step, in metres.
 *
 * Stance: the leg compresses a little. Flight: the body is a projectile, so
 * the arc is the exact parabola of a body launched to be airborne for
 * t_flight seconds under ${P}_G, whose apex is g * t^2 / 8. With a 2.0 s cycle
 * and a 0.26 duty that is a 0.48 s hang and about 47 mm of rise, and the
 * parabola is FLAT ON TOP for most of it. That flat top is the lope.
 */
float ${p}BodyArc(float p, float T, float gw) {
  float ph = fract(p * 2.0);            // one step
  float sf = 2.0 * ${P}_DUTY;             // stance occupies this much of a step
  float y;
  if (ph < sf) {
    y = -0.030 * sin(${P}_PI * ph / sf);
  } else {
    float s = (ph - sf) / (1.0 - sf);
    float tf = (0.5 - ${P}_DUTY) * T;     // seconds airborne
    y = (${P}_G * tf * tf * 0.125) * 4.0 * s * (1.0 - s);
  }
  return y * gw;
}

/**
 * Closed-form two-bone IK for one leg, in the sagittal plane.
 *
 * During the contact window the foot's body-local Z slides from +e/2 to -e/2
 * at exactly the walk speed, where e = v * duty * T is the ground distance
 * covered while that foot is planted. That is what makes foot skate
 * structurally impossible rather than merely tuned away.
 *
 * Sign convention: a positive rotation about +X swings a limb toward -Z, i.e.
 * BACKWARD. Forward swing is therefore negative.
 */
void ${p}LegIK(float q, float v, float T, float bodyY, float gw,
             out float hipA, out float kneeA, out float ankA) {
  float e = v * ${P}_DUTY * T;
  float fz, fy, toe;
  if (q < ${P}_DUTY) {
    float s = q / ${P}_DUTY;
    fz = e * (0.5 - s);
    fy = 0.0;
    toe = 0.34 * smoothstep(0.62, 1.0, s) * gw;          // toe-off push
  } else {
    float s = (q - ${P}_DUTY) / (1.0 - ${P}_DUTY);
    float k = s * s * (3.0 - 2.0 * s);
    fz = mix(-0.5 * e, 0.5 * e, k);
    // slow, high, floaty swing — the foot hangs rather than snapping through
    fy = (0.045 + 0.135 * min(v, 1.8)) * gw * sin(${P}_PI * pow(s, 0.78));
    toe = mix(-0.22, 0.02, k) * gw;                       // dorsiflex, then level
  }
  // The pelvis translation is applied LAST in the chain, so the leg has to
  // reach that much further down to leave the foot on the ground.
  float dz = fz;
  float dy = (${P}_ANKY + fy - bodyY) - ${P}_HIPY;
  float d = clamp(sqrt(dz * dz + dy * dy), 0.12, ${P}_L1 + ${P}_L2 - 0.006);
  float a = atan(dz, -dy);
  float ca = acos(clamp((${P}_L1 * ${P}_L1 + d * d - ${P}_L2 * ${P}_L2) / (2.0 * ${P}_L1 * d), -1.0, 1.0));
  float cb = acos(clamp((${P}_L1 * ${P}_L1 + ${P}_L2 * ${P}_L2 - d * d) / (2.0 * ${P}_L1 * ${P}_L2), -1.0, 1.0));
  hipA = -(a + ca);
  kneeA = ${P}_PI - cb;                    // knees only bend backward
  ankA = -(hipA + kneeA) + toe;          // sole parallel to the ground
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The bone hierarchy. Everything after the caller's solve(), because it reads
// the joint state that solve() writes.
// ─────────────────────────────────────────────────────────────────────────────
function tail(p: string, P: string): string {
  return /* glsl */ `/** Torso chain, shared by the torso, the head and both arms. */
vec3 ${p}Torso(vec3 p, float w) {
  vec3 waist = vec3(0.0, ${P}_WAISTY, 0.0);
  p = ${p}RotY(p, waist, w, ${p}Twist);
  p = ${p}RotX(p, waist, w, ${p}Lean);
  return p;
}

/** Rest pose -> posed model space. w = 1 for a position, 0 for a direction. */
vec3 ${p}Skin(vec3 p, float w) {
  float b = aBone;
  if (b > 6.5) {
    // ── legs ──
    bool right = b > 9.5;
    float sx = right ? ${P}_HIPX : -${P}_HIPX;
    float hipA = right ? ${p}HipR : ${p}HipL;
    float kneeA = right ? ${p}KneeR : ${p}KneeL;
    float ankA = right ? ${p}AnkR : ${p}AnkL;
    float lb = right ? b - 10.0 : b - 7.0;      // 0 thigh, 1 shin, 2 foot
    vec3 H = vec3(sx, ${P}_HIPY, 0.0);
    vec3 K = vec3(sx, ${P}_HIPY - ${P}_L1, 0.010);
    vec3 A = vec3(sx, ${P}_ANKY, 0.0);
    if (lb > 1.5) p = ${p}RotX(p, A, w, ankA);
    if (lb > 0.5) p = ${p}RotX(p, K, w, kneeA);
    p = ${p}RotX(p, H, w, hipA);
  } else if (b > 2.5) {
    // ── arms ──
    bool right = b > 4.5;
    float sx = right ? ${P}_SHX : -${P}_SHX;
    vec3 S = vec3(sx, ${P}_SHY, 0.0);
    vec3 E = vec3(sx, ${P}_ELBY, 0.006);
    bool lower = (b > 3.5 && b < 4.5) || b > 5.5;
    if (lower) p = ${p}RotX(p, E, w, right ? ${p}ElbR : ${p}ElbL);
    p = ${p}RotZ(p, S, w, right ? ${p}ShZR : ${p}ShZL);
    p = ${p}RotX(p, S, w, right ? ${p}ShXR : ${p}ShXL);
    p = ${p}Torso(p, w);
  } else if (b > 1.5) {
    // ── head ──
    vec3 N = vec3(0.0, ${P}_NECKY, 0.0);
    p = ${p}RotY(p, N, w, ${p}HeadY);
    p = ${p}RotX(p, N, w, ${p}HeadP);
    p = ${p}Torso(p, w);
  } else if (b > 0.5) {
    p = ${p}Torso(p, w);
  }
  // root: pelvis roll/yaw, then the vertical travel. Translation applies to
  // positions only, which is why w gates it.
  vec3 R = vec3(0.0, ${P}_HIPY, 0.0);
  p = ${p}RotZ(p, R, w, ${p}Roll);
  p = ${p}RotY(p, R, w, ${p}YawP);
  p.y += ${p}BodyY * w;
  return p;
}`;
}
