/**
 * ============================================================================
 *  cornershadow.ts — the four-lobe contact shadow a suspended body casts on
 *  the surface it is riding.
 * ============================================================================
 *
 * One quad, laid in the body's own contact plane, with four analytic lobes on
 * it and a soft plan ellipse joining them. It is the grounding cue that says
 * "this thing is resting on that surface rather than hovering a hand's width
 * above it", and it is the one cue a world-placed decal pool structurally
 * cannot draw: the pool is handed a single averaged gap, and a pure roll leaves
 * that average exactly at rest, so under lateral load this layer is the only
 * one that moves.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS KNOWS AND WHAT IT REFUSES TO KNOW
 * ---------------------------------------------------------------------------
 * It knows: a quad, four corners, two smoothstep radii, an edge guard, a
 * premultiplied blend and a per-corner uniform. It does NOT know how dark a
 * contact is, how wide a lobe is, what colour a shadow leans toward, or how far
 * a body may rise before it is not touching anything. Every one of those is a
 * REQUIRED field of `CornerShadowTune` rather than a default, for the reason
 * `groundblob.ts` states beside `BlobSpec`: a default here hands the next game
 * the last game's art direction while looking completely fine, and nothing in
 * any gate can see it. There is no `Partial`, no `??` and no fallback in this
 * file. If a game stops naming a number it stops compiling.
 *
 * The lessons baked into the quad came out of real use and none of them is
 * about any particular vehicle:
 *
 * 1. IT MUST RIDE PROUD OF THE SURFACE OR IT IS DEPTH-REJECTED. A flat quad
 *    four metres long over a crest buries its own ends. `lift` clears the
 *    curvature; the body's own quaternion lays the quad on the local tangent,
 *    so it is only CURVATURE that has to be cleared, never slope. The lift is
 *    along the quad's OWN +Y, which is the body's up — so on the underside of
 *    an inverted surface it lifts downward in world space, which is correct,
 *    and a world-space lift would push it through the plate.
 * 2. IT MUST BE DRIVEN PER CORNER. A loaded corner has a small hard dark patch
 *    and a drooping one has almost none. That per-corner difference is what
 *    makes a body visibly load its outside pair through a banked corner.
 * 3. IT IS EVALUATED IN THE FRAGMENT SHADER. A 128 px texture of the footprint
 *    spends almost all of its texels on dead margin and cannot move a lobe. Two
 *    triangles, one draw call, no upload.
 *
 * ON THE BLEND, WHICH IS NOT ART AND IS THEREFORE NOT A KNOB. The premultiplied
 * `CustomBlending` (`ONE, ONE_MINUS_SRC_ALPHA`) emitting `vec4(tint * occ, occ)`
 * is a pure multiply toward `tint` — `dst * (1 - occ) + tint * occ` — spelled
 * out rather than trusted to a mode. `MultiplyBlending` only gets a blend func
 * out of three when `premultipliedAlpha` is true; on the other path three logs
 * an error and sets no func at all, so the quad silently inherits whatever the
 * previous draw bound. This material has already shipped that exact bug once.
 * A straight `vec4(tint, occ)` under `NormalBlending` computes the identical
 * value, which is why one spelling serves every caller.
 *
 * ONE SOURCE, ONE PROGRAM. The corner layout is a UNIFORM, not a GLSL literal.
 * Inlining it gives every body its own source and therefore its own program —
 * eight compiles for one shader — and the bodies that carry a wider track then
 * cost a shader each.
 */
import * as THREE from 'three';

/** Where the four corners sit in the body's own frame, metres. */
export interface CornerLayout {
  /** half track; the lobes sit at ±this */
  trackX: number;
  frontZ: number;
  rearZ: number;
}

/**
 * The contact-depth term: how hard the body is pressing, read off ride height.
 *
 * `null` for a layer with no ride height to read — a body on springs whose
 * corners are the only thing that moves. Every field is the game's.
 */
export interface ContactDepth {
  /** the distance at which the contact is gone, metres */
  reach: number;
  /** ...and the compressed gap at which it is at full strength, metres */
  hard: number;
  /** what is left of the contact at maximum reach */
  floor: number;
}

/**
 * How far the darkening leans toward the light filling it, and `null` for a
 * layer lit by nothing in particular.
 *
 * A contact shadow under a coloured emitter is not neutral: what fills it is
 * bounce off that emitter, so the darkening target leans a few percent toward
 * its hue. Deliberately tiny in every game that uses it — an occlusion that is
 * not in the fill's colour family reads as a hole punched in the frame.
 */
export interface ContactBounce {
  cool: THREE.Color;
  warm: THREE.Color;
  amount: number;
}

/**
 * Every number this layer's look is made of. All required. See the header.
 */
export interface CornerShadowTune {
  /** clearance above the body's contact plane, metres */
  lift: number;
  /** contact lobe radius at rest, metres */
  lobeR: number;
  /** how far past the outermost corner the quad reaches, in lobe radii */
  margin: number;
  /** where the edge guard starts past the outermost corner, in lobe radii */
  guardAt: number;
  /** occlusion under the body away from any corner */
  body: number;
  /** the plan ellipse as a fraction of the corner box, and its floor in metres */
  bodyRatio: readonly [number, number];
  bodyFloor: readonly [number, number];
  /** the penumbra's and the core's share of one lobe; they sum to 1 */
  skirt: number;
  core: number;
  /** the core's radius as a fraction of the lobe's */
  coreR: number;
  /** peak occlusion directly under a fully loaded corner */
  lobeMax: number;
  /** droop past which a corner has no contact left, metres */
  droop: number;
  /** compression past rest at which the contact is at its tightest, metres */
  load: number;
  /** how much the lobe widens fully drooped, and narrows fully loaded */
  spread: number;
  squeeze: number;
  /** what the surface is darkened toward */
  tint: THREE.Color;
  depth: ContactDepth | null;
  bounce: ContactBounce | null;
  /**
   * The ride height the layer is left at until the first `setGlow`.
   *
   * A body that is built and then drawn before anything has driven it must not
   * appear with a full-strength contact under it, and it must not appear with
   * none either — it is sitting at rest. The game's own nominal rest gap.
   */
  restGap: number;
}

export interface CornerShadow {
  mesh: THREE.Mesh;
  /**
   * @param i       corner index, FL FR RL RR
   * @param offset  visual offset of the corner from its rest height, metres.
   *                Positive = compressed (the body has dropped onto it).
   */
  setWheel(i: number, offset: number): void;
  /**
   * The contact term, tightening and deepening as ride height drops.
   *
   * A no-op on a layer built with `depth: null` and `bounce: null`.
   *
   * @param gap       ride height, metres. Hand it the LOAD-WEIGHTED gap, never
   *                  the mean — the mean is exactly the statistic that cannot
   *                  see a body rolling onto one pair.
   * @param strength  0..1, the emitter's own authority
   * @param warm      0..1 along `bounce.cool` → `bounce.warm`
   */
  setGlow(gap: number, strength: number, warm: number): void;
}

/**
 * Quads are cached by their extents, not per body: a roster of eight vehicles
 * on three chassis widths builds three.
 */
const _shadowGeo = new Map<string, THREE.BufferGeometry>();

function shadowGeometry(halfW: number, halfD: number, lift: number): THREE.BufferGeometry {
  const key = `${halfW.toFixed(3)}x${halfD.toFixed(3)}x${lift.toFixed(4)}`;
  const hit = _shadowGeo.get(key);
  if (hit) return hit;
  const g = new THREE.PlaneGeometry(halfW * 2, halfD * 2);
  g.rotateX(-Math.PI / 2);
  g.translate(0, lift, 0);
  g.computeBoundingSphere();
  _shadowGeo.set(key, g);
  return g;
}

const SHADOW_VERT = /* glsl */`
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

/**
 * The fragment source, and the four weights spliced into it are the game's.
 *
 * They are literals rather than uniforms deliberately: they are properties of a
 * LOOK, they never change while the material exists, and a game that runs one
 * look pays one compile. `t.body`, `t.skirt`, `t.core` and `t.coreR` are the
 * only things in here that vary between callers, so two games sharing this file
 * compile two programs and eight bodies within a game compile one.
 */
function shadowFragment(t: CornerShadowTune): string {
  return /* glsl */`
uniform vec4 uK;      // per-corner strength, FL FR RL RR
uniform vec4 uR;      // per-corner lobe radius, metres
uniform vec3 uTint;   // what the surface is darkened toward
uniform float uDepth; // how hard the body is contacting
uniform vec2 uHalf;
uniform vec2 uGuard;  // metres at which the edge guard starts, per axis
uniform vec3 uLobe;   // half track, front corner Z, rear corner Z
uniform vec2 uBody;   // the plan ellipse, metres
varying vec2 vP;

float lobe( vec2 c, float r, float k ) {
  float d = length( vP - c );
  float t = clamp( d / max( r, 1e-3 ), 0.0, 1.0 );
  float skirt = 1.0 - t * t * ( 3.0 - 2.0 * t );
  // Two radii, not one. The skirt is the contact's own penumbra and it is what
  // keeps a lobe from being a coin with an edge; the core is the corner's
  // footprint pressed against the surface, and it is the part that has to
  // tighten under load. A single falloff wide enough to do the first job is far
  // too soft to do the second.
  float u = clamp( d / max( r * ${t.coreR.toFixed(3)}, 1e-3 ), 0.0, 1.0 );
  float core = 1.0 - u * u * ( 3.0 - 2.0 * u );
  return k * clamp( ${t.skirt.toFixed(3)} * skirt + ${t.core.toFixed(3)} * core, 0.0, 1.0 );
}

void main() {
  // The body-to-surface ambient occlusion joining the four contacts.
  float body = 1.0 - smoothstep( 0.0, 1.0, length( vP / uBody ) );
  body *= ${t.body.toFixed(3)};

  float l = lobe( vec2( -uLobe.x, uLobe.y ), uR.x, uK.x );
  l = max( l, lobe( vec2(  uLobe.x, uLobe.y ), uR.y, uK.y ) );
  l = max( l, lobe( vec2( -uLobe.x, uLobe.z ), uR.z, uK.z ) );
  l = max( l, lobe( vec2(  uLobe.x, uLobe.z ), uR.w, uK.w ) );

  // screen combine, so the body AO and a corner lobe can overlap without ever
  // stacking into a black bar
  float occ = ( body + l - body * l ) * uDepth;

  // Hard guarantee: zero at the mesh's own boundary, so the four straight edges
  // sit in dead field and can never draw a line on the surface. The guard is
  // placed in METRES, guardAt lobe radii past the outermost corner, so
  // (no backticks in here: this whole shader is one template literal, and a
  // backtick in a comment closes it and deletes the module)
  // shrinking the lobe cannot walk the fade band over the lobes.
  vec2 e = abs( vP );
  occ *= ( 1.0 - smoothstep( uGuard.x, uHalf.x * 0.99, e.x ) )
       * ( 1.0 - smoothstep( uGuard.y, uHalf.y * 0.99, e.y ) );

  // Blending alpha 0 is arithmetically identical to not blending at all, so
  // this changes no pixel; it only stops paying for the ones it cannot change.
  // Costs nothing in early-Z, which this material has already given up.
  if ( occ < 0.004 ) discard;

  // PREMULTIPLIED OUTPUT — a pure multiply toward uTint. See the header.
  gl_FragColor = vec4( uTint * occ, clamp( occ, 0.0, 1.0 ) );
}
`;
}

/**
 * One body's contact shadow.
 *
 * THE QUAD IS SIZED TO THE BODY. A fixed extent either clips the outer lobes
 * off a wide machine or spends most of its fragments on dead field under a
 * narrow one, and `margin`/`guardAt` are stated in LOBE RADII rather than in
 * fractions of the quad for the same reason: a fraction of a quantity that
 * scales with the track walks the fade band over the lobes the moment anybody
 * shrinks the lobe.
 */
export function cornerShadow(layout: CornerLayout, t: CornerShadowTune): CornerShadow {
  const reach = t.lobeR * t.margin;
  const outX = Math.abs(layout.trackX);
  const outZ = Math.max(Math.abs(layout.frontZ), Math.abs(layout.rearZ));
  const halfW = outX + reach;
  const halfD = outZ + reach;
  const uK = { value: new THREE.Vector4(1, 1, 1, 1) };
  const uR = { value: new THREE.Vector4(t.lobeR, t.lobeR, t.lobeR, t.lobeR) };
  const uDepth = { value: 1 };
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uK,
      uR,
      uTint: { value: t.tint.clone() },
      uDepth,
      uHalf: { value: new THREE.Vector2(halfW, halfD) },
      uGuard: {
        value: new THREE.Vector2(outX + t.lobeR * t.guardAt, outZ + t.lobeR * t.guardAt),
      },
      uLobe: { value: new THREE.Vector3(outX, layout.frontZ, layout.rearZ) },
      // Stated as a RATIO of the corner box rather than in metres, so a 9.8 m
      // body gets a 9.8 m plan term instead of a 2.8 m one.
      uBody: {
        value: new THREE.Vector2(
          Math.max(t.bodyFloor[0], outX * t.bodyRatio[0]),
          Math.max(t.bodyFloor[1], (Math.abs(layout.frontZ) + Math.abs(layout.rearZ)) * 0.5 * t.bodyRatio[1]),
        ),
      },
    },
    vertexShader: SHADOW_VERT,
    fragmentShader: shadowFragment(t),
    transparent: true,        // queues it after the opaque surface
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -16,
    // A ShaderMaterial gets no tone-mapping chunk, which is what is wanted: the
    // composer grades the buffer this has already been blended into.
    side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
  });
  const mesh = new THREE.Mesh(shadowGeometry(halfW, halfD, t.lift), mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // first in the transparent queue, so skid marks and dust decals composite on
  // top of it rather than under it
  mesh.renderOrder = -1;

  const kv = uK.value;
  const rv = uR.value;
  const setWheel = (i: number, offset: number) => {
    // Two independent terms, because a contact patch has two independent
    // behaviours and rest has to sit at full strength in both. `planted` fades
    // the lobe out as the corner droops away from the surface — that is what
    // stops a shadow staying nailed on under a corner that has lifted off.
    // `load` tightens it as the body presses down: a loaded corner has a small
    // hard patch, an unloaded one a wide soft one, and the same total darkness
    // concentrated into a smaller lobe is what reads as weight.
    const planted = Math.min(1, Math.max(0, (offset + t.droop) / t.droop));
    const load = Math.min(1, Math.max(0, offset / t.load));
    const k = t.lobeMax * planted;
    const r = t.lobeR * (1 + t.spread * (1 - planted) - t.squeeze * load);
    switch (i) {
      case 0: kv.x = k; rv.x = r; break;
      case 1: kv.y = k; rv.y = r; break;
      case 2: kv.z = k; rv.z = r; break;
      default: kv.w = k; rv.w = r; break;
    }
  };
  for (let i = 0; i < 4; i++) setWheel(i, 0);

  const depth = t.depth;
  const bounce = t.bounce;
  const tint = mat.uniforms.uTint!.value as THREE.Color;
  const tmp = new THREE.Color();
  const setGlow = (gap: number, strength: number, warm: number) => {
    if (depth) {
      /*
       * The contact term, over the game's own reach.
       *
       * This is the answer to "could you slide the body 20 cm and would
       * anything about the frame look wrong". Laterally the contact travels
       * with the body and the question is unanswerable; VERTICALLY it is
       * answerable and this is the answer.
       *
       * `s` is deliberately NOT a ride-height ramp normalised to the legal
       * band. That ramp saturates at both ends, which is right for an emissive
       * with a stated ceiling and floor; a contact has neither, and clamping it
       * at the top of the band is what lets a body over a crest keep a hard
       * black shadow under it.
       */
      const s = Math.min(1, Math.max(0, (depth.reach - gap) / (depth.reach - depth.hard)));
      // Squared: occlusion falls off faster than distance because the surface
      // sees progressively more of the sky around the body as the body rises.
      uDepth.value = (depth.floor + (1 - depth.floor) * s * s) * Math.min(1, Math.max(0, strength));
    }
    if (bounce) {
      tmp.copy(bounce.cool).lerp(bounce.warm, Math.min(1, Math.max(0, warm)));
      tint.copy(t.tint).lerp(tmp, bounce.amount);
    }
  };
  setGlow(t.restGap, 1, 0);

  return { mesh, setWheel, setGlow };
}
