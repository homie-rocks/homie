/**
 * ============================================================================
 *  skyrig.ts — the parts of a sky that are a RIG, not a look.
 * ============================================================================
 *
 * The `Sky.ts` of a kart racer and the `Sky.ts` of a space racer are forks of
 * each other, and `cascade.ts` already carries the shadow filter they shared
 * byte-for-byte. This file is the second, smaller seam the two still had open
 * after that move: the PLUMBING either sky has to build around those cascades
 * before any of its own art can be seen.
 *
 * Five things, and each of them was the same code in both files with a
 * different NUMBER or a different COLOUR in it:
 *
 *   · `addCascade`        — make the light, fit its shadow camera, park it in
 *                           the scene, and record it in the cascade list.
 *   · `followCascades`    — once a frame, quantise each cascade's centre onto
 *                           the point the camera is looking at.
 *   · `installSkyChunks`  — write three's `ShaderChunk` table, in the one order
 *                           the patches can be composed in.
 *   · `indirectFloorChunk`— occlude the indirect terms inside a sealed volume
 *                           and put back the floor the direct rig cannot reach.
 *   · `ensureSkyCube`     — the cube render target the env bake writes into.
 *
 * ## What deliberately did NOT come here
 *
 * The sky. Every colour, every cloud layer, every sun or star disc, the horizon
 * ramp, the eclipse, the fog model and the shape of an interior volume stay in
 * the games, because those are two people's art direction and merging them
 * would be merging two people's taste. `installSkyChunks` takes the game's own
 * chunk builders as functions and does nothing but call them in order; it never
 * knows what GLSL they produced.
 *
 * `cascadeSpecs` did not come either, for the same reason it did not come to
 * `cascade.ts`: the extents, the map sizes and the tap counts are how far each
 * game can see.
 *
 * ## Nothing here takes a `Ctx`
 *
 * Same line `cascade.ts` draws. A `Ctx` carries race / track / items / match,
 * and a package that can see one is a package that knows what a lap is. Every
 * function below takes a `THREE.Scene`, a camera, a vector or a plain struct —
 * which both games already had in hand at the call site, so no call site had to
 * learn anything new.
 *
 * ## `three` is a peerDependency and that is load-bearing
 *
 * Two copies of three.js is two `ShaderChunk` tables, and the game would patch
 * one and render with the other, in silence. See the package.json note.
 */
import * as THREE from 'three';
import {
  type Cascade, type CascadeSpec, type LightBasis,
  envDiffuseChunk, fitCascadeCamera, glslFloat, projectKeyToScreen, keyScreenFalloff,
  shadowBorderChunk, snapCascade, stockChunks,
} from './cascade.ts';

// ---------------------------------------------------------------------------
// Building the cascade lights
// ---------------------------------------------------------------------------

/** What a game decides about one cascade light that is not in its `CascadeSpec`. */
export interface CascadeLightOpts {
  /** The key's colour. This is the one number in here that is a LOOK. */
  color: THREE.ColorRepresentation;
  /** Unit vector toward the key. The light is parked at `direction * spec.distance`. */
  direction: THREE.Vector3;
  /** Whether this cascade rasterises a depth map at all. */
  shadows: boolean;
  /**
   * Whether this cascade's map is driven by hand rather than by three.
   *
   * A VALUE, NOT A MODE, and the two games disagree about it for a reason each
   * can state. The kart racer drives only the AMORTISED cascades by hand
   * (`spec.interval > 1`) and lets three re-rasterise the every-frame one. The
   * space racer drives all of them, because 27% of its lap has no key light at
   * all and skipping four depth maps for a light at intensity zero is the
   * largest free saving in its frame — and the obvious way to take that saving,
   * flipping `castShadow` off, is a trap: `NUM_DIR_LIGHT_SHADOWS` is a program
   * define, so toggling it recompiles every material in the game on the frame
   * the ship crosses the terminator, which is the one frame that must not
   * hitch. Driving `needsUpdate` leaves the program parameters untouched and
   * simply skips the render.
   *
   * `followCascades` reads this back off `light.shadow.autoUpdate` rather than
   * being told again, so the two halves of the decision cannot drift apart.
   */
  manual: boolean;
}

/**
 * Create one cascade's DirectionalLight, add it to the scene, and append it to
 * `cascades`.
 *
 * `fitCascadeCamera` is the half that had to move first: the map size, the two
 * biases, the ortho box and the `far` plane the receiver-plane bias is quoted
 * against all have to stay in lockstep with `shadowDepthRange`. This is the
 * other half, and it was the same fourteen lines in both games.
 *
 * The TARGET is added to the scene as well as the light. three's
 * DirectionalLight aims at `light.target`, whose world matrix is only updated
 * if it is in the graph; a target left out of the scene silently keeps the
 * identity matrix and the light points at the world origin from wherever it is.
 */
export function addCascade(
  scene: THREE.Scene,
  cascades: Cascade[],
  spec: CascadeSpec,
  o: CascadeLightOpts,
): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(o.color, spec.intensity);
  light.position.copy(o.direction).multiplyScalar(spec.distance);
  light.castShadow = o.shadows;

  if (o.shadows) {
    fitCascadeCamera(light, spec);
    if (o.manual) light.shadow.autoUpdate = false;
  }

  scene.add(light);
  scene.add(light.target);
  cascades.push({
    light, extent: spec.extent, distance: spec.distance,
    mapSize: spec.mapSize, interval: spec.interval,
  });
  return light;
}

// ---------------------------------------------------------------------------
// Driving them, once a frame
// ---------------------------------------------------------------------------

/**
 * Scratch. Module-level and reused, because this runs once per cascade per
 * frame and a Vector3 allocated there is a Vector3 the collector sees.
 *
 * IT IS THIS MODULE'S, NOT THE GAME'S, AND THAT IS THE ONE THING TO CHECK WHEN
 * READING THIS FILE AGAINST THE CODE IT CAME FROM. Both games held a `_center`
 * and a `_fwd` at module scope and both used them ONLY inside the loop below —
 * grepped, in both files, before the move — so nothing downstream was reading a
 * value this loop happened to leave behind. That is the aliasing question a
 * moved function has to answer and it is answered here rather than remembered.
 */
const _center = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _camDir = new THREE.Vector3();

/** What `followCascades` needs and cannot work out for itself. */
export interface FollowOpts {
  /** The camera whose heading aims the frusta. */
  camera: THREE.Camera;
  /** What the cascades centre on — the player when there is one, else the camera. */
  focus: THREE.Vector3 | null;
  /** The light basis the CPU snap and the GLSL bias must agree on. */
  axes: LightBasis;
  /** Unit vector toward the key. */
  keyDir: THREE.Vector3;
  /** Monotonic frame counter; the amortisation gate is `frame % interval`. */
  frame: number;
  /**
   * How far ahead of the focus each cascade is biased, as a fraction of its own
   * extent. Both games run 0.45: half of a cascade spent behind the player is
   * half a cascade wasted, and at 165 m/s a contact cascade with no lead is
   * behind the ship by the time it is sampled.
   */
  lead?: number;
  /**
   * False when the key is out and there is nothing to shadow. Defaults true, so
   * a game whose sun never sets passes nothing. The space racer passes
   * `solar > 0.015`, which is the whole of what its eclipse costs this loop.
   */
  active?: boolean;
}

/**
 * Follow the action with every cascade, once a frame.
 *
 * The amortisation gate reads `light.shadow.autoUpdate` rather than taking a
 * flag: a cascade three is still driving must NOT be skipped on the frames its
 * interval would gate, because skipping it skips the texel snap too and the
 * edges boil. `addCascade` is the only thing that writes that field, so the
 * decision is made in one place and read in the other.
 */
export function followCascades(cascades: Cascade[], o: FollowOpts): void {
  if (o.active === false) return;
  const lead = o.lead ?? 0.45;

  // World-space camera heading, flattened. `-Z` of the camera's own rotation is
  // forward; dropping Y is what keeps a cascade from sliding out from under the
  // player when the camera tips down into a corner.
  _camDir.set(0, 0, -1).applyQuaternion(o.camera.quaternion);
  _fwd.set(_camDir.x, 0, _camDir.z);
  if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, -1); else _fwd.normalize();

  for (const c of cascades) {
    if (!c.light.castShadow) continue;
    if (c.light.shadow.autoUpdate === false) {
      if (o.frame % c.interval !== 0) continue;
      c.light.shadow.needsUpdate = true;
    }
    if (o.focus) _center.copy(o.focus); else _center.copy(o.camera.position);
    _center.addScaledVector(_fwd, c.extent * lead);
    snapCascade(c, _center, o.axes, o.keyDir);
  }
}

/**
 * Every DirectionalLight in the scene, in three's own traversal order.
 *
 * That order is the whole point. The cascade resolver reads
 * `directionalShadowMap[i]` as cascade i, and three fills that array by
 * traversing the graph with shadow casters sorted first — so a sky's cascades
 * are only at the indices its GLSL assumes for as long as nothing else in the
 * game creates a DirectionalLight. That is an invariant, not a guarantee, and
 * both games check it once on frame 1. WHAT they assert about the list differs
 * (one names its two lights, the other compares the whole prefix), so only the
 * collection moved; the assertions stayed where the assumption is.
 */
export function directionalLightsInOrder(scene: THREE.Scene): THREE.DirectionalLight[] {
  const lights: THREE.DirectionalLight[] = [];
  scene.traverse((o) => {
    const l = o as THREE.DirectionalLight;
    if (l.isDirectionalLight) lights.push(l);
  });
  return lights;
}

/** Where the key is on screen, and how much of it the post stack should use. */
export interface KeyScreenState {
  visible: boolean;
  intensity: number;
}

/**
 * Project the key onto the screen and grade the result, for whatever the post
 * stack tints off it — light shafts in one game, an anamorphic streak in the
 * other.
 *
 * `gain` and `floor` are how the eclipse fits in without a branch. A game whose
 * key is always up passes neither and gets `1` and `0`, which is the same
 * arithmetic it had. The space racer passes its `solar` and `0.015`: below the
 * floor the disc is not visible at all, above it the falloff is scaled by the
 * same number, so nothing can pop on and off at the terminator.
 */
export function keyScreenState(
  camera: THREE.PerspectiveCamera,
  keyDir: THREE.Vector3,
  out: THREE.Vector2,
  o: { gain?: number; floor?: number } = {},
): KeyScreenState {
  const gain = o.gain ?? 1;
  const visible = projectKeyToScreen(camera, keyDir, out) && gain > (o.floor ?? 0);
  if (!visible) return { visible: false, intensity: 0 };
  return { visible: true, intensity: keyScreenFalloff(camera, keyDir, out) * gain };
}

// ---------------------------------------------------------------------------
// Writing three's ShaderChunk table
// ---------------------------------------------------------------------------

/**
 * The six chunk edits a sky in these games makes, as the game's own functions.
 *
 * EVERY MEMBER TAKES THE STOCK TEXT AND RETURNS THE PATCHED TEXT. That is not
 * decoration: `stockChunks()` memoises three's originals on the FIRST call, and
 * both games install twice — once at boot against an empty interior, once on
 * the first frame against the real one. Handing each builder `stock.x` rather
 * than `chunks.x` is what makes the second install replace the first instead of
 * patching a patch.
 */
export interface SkyChunkPlan {
  /** Chunks to write wholesale, keyed by name. Built from `fog_pars_fragment`. */
  fog(stockFogPars: string): Record<string, string>;
  /** `<common>` — the one chunk every fragment shader in three includes. */
  common(stockCommon: string): string;
  /** The four numbers `envDiffuseChunk` needs. All four are the game's own. */
  envDiffuse: { intensity: number; rough: { scale: number; start: number; end: number } };
  /** The cascade resolver. Handed the text with the border fade already in it. */
  shadow(borderedShadowPars: string): string;
  /** `lights_fragment_begin`, however many patches the game composes onto it. */
  lights(stockLightsFragmentBegin: string): string;
  /** `lights_fragment_maps` — the indirect terms. See `indirectFloorChunk`. */
  indirect(stockLightsFragmentMaps: string): string;
}

/**
 * Install the ShaderChunk overrides. Idempotent, and `stockChunks()` snapshots
 * three's originals the first time so `restoreChunks()` can put them back.
 *
 * THE ORDER IS THE CONTENT. `lights_pars_begin` is written back to stock before
 * `lights_fragment_begin` is patched, because a game that once declared uniforms
 * there and no longer does would otherwise leave the old declarations standing.
 * `shadowBorderChunk` runs BEFORE the game's resolver rather than after, because
 * the resolver splices itself in at the last column-zero `#endif` and the border
 * fade edits the `getShadow` bodies above it — the other way round the fade
 * would be editing text the resolver has already copied.
 */
export function installSkyChunks(plan: SkyChunkPlan): void {
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  const stock = stockChunks();

  const fog = plan.fog(stock.fog_pars_fragment as string);
  for (const name of Object.keys(fog)) chunks[name] = fog[name] as string;

  chunks.common = plan.common(stock.common as string);
  chunks.envmap_physical_pars_fragment = envDiffuseChunk(
    stock.envmap_physical_pars_fragment as string,
    plan.envDiffuse.intensity, plan.envDiffuse.rough);
  chunks.shadowmap_pars_fragment =
    plan.shadow(shadowBorderChunk(stock.shadowmap_pars_fragment as string));
  chunks.lights_pars_begin = stock.lights_pars_begin as string;
  chunks.lights_fragment_begin = plan.lights(stock.lights_fragment_begin as string);
  chunks.lights_fragment_maps = plan.indirect(stock.lights_fragment_maps as string);
}

/**
 * An authored colour as a GLSL `vec3` literal, scaled.
 *
 * `new THREE.Color(hex)` already lands in the working (linear-sRGB) space —
 * three's ColorManagement decodes the hex on the way in. Converting again is
 * the classic double-decode and it cost one of these two skies' indirect floors
 * a factor of seven once already, which is why this exists once instead of
 * being re-derived beside each literal.
 */
export function glslColor(c: THREE.ColorRepresentation, scale = 1): string {
  const col = new THREE.Color(c);
  return `vec3( ${glslFloat(col.r * scale)}, ${glslFloat(col.g * scale)}, `
    + `${glslFloat(col.b * scale)} )`;
}

/** One end of the indirect floor: a colour and the irradiance it arrives at. */
export interface IndirectFloor {
  color: THREE.ColorRepresentation;
  irradiance: number;
}

/** What `indirectFloorChunk` needs. Every number here is the game's own. */
export interface IndirectFloorOpts {
  /** How much of the diffuse indirect a sealed volume removes, 0..1. */
  irradianceCut: number;
  /** The same for the specular indirect. */
  radianceCut: number;
  /** The floor outside — open sky in one game, the void in the other. */
  outside: IndirectFloor;
  /** The floor inside a sealed volume, mixed in by `krInterior`. */
  interior: IndirectFloor;
  /**
   * GLSL appended inside the `RE_IndirectDiffuse` block, after the floor.
   *
   * A STRING BECAUSE IT IS ONE GAME'S EXTRA TERM AND NOT A MODE. The kart racer
   * lays a lick of the key's own warm on the half-shadow line with
   * `krPenumbra`, which the space racer has no term for and would be actively
   * wrong under a 0.18° source whose penumbra is 31 cm at 100 m. Handing the
   * text in keeps that decision in the file that can justify it; a boolean here
   * would have put it in the file that cannot.
   */
  extraDiffuse?: string;
}

/**
 * Occlude the indirect terms inside a pressurised volume and put back the floor
 * the direct rig cannot reach.
 *
 * Appended to `lights_fragment_maps`, which runs after `lights_fragment_begin`
 * and before `RE_IndirectDiffuse`, so `irradiance` here is the complete
 * non-directional budget for the fragment.
 *
 * `new THREE.Color(hex)` already lands in the working (linear-sRGB) space —
 * three's ColorManagement decodes the hex on the way in. Converting again is
 * the classic double-decode and it cost one of these two floors a factor of
 * seven once already, which is why the conversion is here rather than at either
 * call site.
 */
export function indirectFloorChunk(original: string, o: IndirectFloorOpts): string {
  const F = glslFloat;
  const v = glslColor;
  return `${original}
#if defined( RE_IndirectDiffuse )
	irradiance *= 1.0 - krInterior * ${F(o.irradianceCut)};
	iblIrradiance *= 1.0 - krInterior * ${F(o.irradianceCut)};
	irradiance += mix( ${v(o.outside.color, o.outside.irradiance)},
		${v(o.interior.color, o.interior.irradiance)}, krInterior );
${o.extraDiffuse ?? ''}#endif
#if defined( RE_IndirectSpecular )
	radiance *= 1.0 - krInterior * ${F(o.radianceCut)};
	clearcoatRadiance *= 1.0 - krInterior * ${F(o.radianceCut)};
#endif
`;
}

// ---------------------------------------------------------------------------
// The vertex stage every sky dome in these games shares
// ---------------------------------------------------------------------------

/**
 * Classic infinite-skybox vertex: strip the translation from the model-view so
 * the box is always centred on the eye, then force z = w so it lands exactly on
 * the far plane and passes the default LEQUAL depth test against a cleared
 * buffer. No near/far tuning, no scale to keep in sync with the camera.
 *
 * ── MOVED HERE FROM `nishita.ts`, WHICH RE-EXPORTS IT ───────────────────────
 *
 * It sat in the scattering model because that is the file the racers' sky came
 * out of, and it meant a VACUUM sky — the base-building game's, the space
 * racer's, the shooter's — could only reach the shared spelling by importing a
 * Rayleigh/Mie integrator it does not use and must never be seen to use. This
 * file is "the parts of a sky that are a RIG, not a look", and eight lines that
 * do not know whether there is air are exactly that. `nishita.ts` re-exports
 * the name so the kart racer's `Atmosphere.ts` re-export chain did not have to
 * be rewritten; a change that repoints every call site is a change whose misses
 * cannot be grepped for.
 *
 * ── THREE SPELLINGS WERE FOUND. THEY ARE ONE LINEAR MAP AND THAT IS MEASURED ─
 *
 * A sky-rig probe evaluates all three against the same 4x4s with
 * `Object.is` and no epsilon, over the real dome matrices the games build:
 *
 *   this one                `vec4( mat3( modelViewMatrix ) * position, 1.0 )`
 *   another game's          `mat4( mat3( modelViewMatrix ) ) * vec4( p, 1.0 )`
 *   the shooter's           viewMatrix with column 3 zeroed, times `vec4(p,1)`
 *
 * The first two are the same expression written twice. The third is equal only
 * when the dome's MODEL matrix is the identity — `modelViewMatrix` is
 * `viewMatrix * modelMatrix`, so a rotated or scaled dome makes them different
 * maps — which is why the probe reads `matrixWorld` off the mesh each game
 * actually builds rather than taking anybody's word for it. Adding `m[i][3] *
 * 1.0` where that entry is `-0` or `+0` is exact in IEEE 754 for every finite
 * accumulator, so the equality is bit-exact and not "close enough".
 *
 * WHAT THIS DOES NOT TOUCH, and it is the thing an earlier review refused over:
 * the DEPTH CONTRACT. The shooter runs its dome at `depthTest: false,
 * renderOrder: -1000` and the racers rely on z = w landing on the far plane
 * against a cleared buffer. Those are properties of the MATERIAL and the draw
 * order, not of this string, and no game's changed here. The refusal's stated
 * blocker — "whether the two depth contracts are interchangeable is a question
 * for a GPU" — was about a swap nobody needs to make.
 */
export const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = position;
  vec4 clip = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
}
`;

// ---------------------------------------------------------------------------
// The dome, and the second copy of it the env bake renders
// ---------------------------------------------------------------------------

/** What `mountSkyDome` built. Each game holds all three and disposes them. */
export interface SkyDome {
  /** The dome in the world, drawn last among opaques. */
  dome: THREE.Mesh;
  /** A scene containing nothing but a second instance of the same material. */
  envScene: THREE.Scene;
  /** That second instance. Shares the geometry AND the material with `dome`. */
  envMesh: THREE.Mesh;
}

/**
 * Put the sky dome in the world and stand up the one-mesh scene the cube camera
 * bakes the environment map from.
 *
 * `renderOrder = 1000` — DRAWN LAST AMONG OPAQUES, NOT FIRST. The dome sits on
 * the far plane and writes no depth, so with the world already in the depth
 * buffer only the pixels that are actually sky ever run the scattering shader.
 * Drawing it first shades every pixel in the frame and then throws most of them
 * away.
 *
 * The env mesh SHARES the material rather than cloning it. That is what
 * guarantees the probe and the visible sky agree: a probe baked from a copy is
 * the classic way to get chrome reflecting a sky nobody can see. It also means
 * a game that pushes a different state into the uniforms for the bake — an
 * eclipse, a foundry — gets it on both, which is the point.
 */
export function mountSkyDome(
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name = 'Sky',
): SkyDome {
  const dome = new THREE.Mesh(geometry, material);
  dome.name = name;
  dome.frustumCulled = false;
  dome.matrixAutoUpdate = false;
  dome.renderOrder = 1000;
  dome.castShadow = false;
  dome.receiveShadow = false;
  scene.add(dome);

  const envScene = new THREE.Scene();
  const envMesh = new THREE.Mesh(geometry, material);
  envMesh.frustumCulled = false;
  envMesh.matrixAutoUpdate = false;
  envScene.add(envMesh);

  return { dome, envScene, envMesh };
}

// ---------------------------------------------------------------------------
// The capsule chain an interior volume is expressed as
// ---------------------------------------------------------------------------

/**
 * One capsule of an interior chain, in world space, with the arc distance from
 * the volume's start at each end.
 *
 * A CAPSULE CHAIN RATHER THAN A BOX because these follow a curved centreline —
 * a tunnel bore, a pressurised bay — and the fragment test has to be cheap
 * enough to run on every fragment in the frame. `s0`/`s1` are what let the
 * chunk fade the volume in from each mouth without knowing where the mouths are.
 */
export interface CapsuleSegment {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  /** arc distance from the volume's start at A and at B */
  s0: number; s1: number;
}

/** A fitted chain and the bounding sphere that rejects most fragments. */
export interface CapsuleChain {
  segments: CapsuleSegment[];
  /** bounding sphere, for the one-test early-out every other fragment takes */
  cx: number; cy: number; cz: number; radius: number;
}

/**
 * Fit `pts.length - 1` capsules to a sampled centreline and measure the sphere
 * that contains them.
 *
 * `arc[i]` is the running distance along the centreline at `pts[i]`; the caller
 * accumulates it while sampling, because only the caller knows whether it is
 * sampling a track, a bore or a bay.
 *
 * THE SPHERE IS A REJECT TEST, so a tight fit buys nothing and a wrong one is a
 * volume that vanishes at its own edge. It is the exact bounding sphere of the
 * sampled points here; each game widens it by its own radial extent before
 * baking it into GLSL, because that number is a property of the tunnel and not
 * of the samples.
 */
export function capsuleChain(pts: THREE.Vector3[], arc: number[]): CapsuleChain {
  const segments: CapsuleSegment[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as THREE.Vector3, b = pts[i + 1] as THREE.Vector3;
    segments.push({
      ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z,
      s0: arc[i] as number, s1: arc[i + 1] as number,
    });
  }

  const box = new THREE.Box3();
  for (const p of pts) box.expandByPoint(p);
  const c = box.getCenter(new THREE.Vector3());
  let radius = 0;
  for (const p of pts) radius = Math.max(radius, p.distanceTo(c));

  return { segments, cx: c.x, cy: c.y, cz: c.z, radius };
}

// ---------------------------------------------------------------------------
// The environment bake's cube target
// ---------------------------------------------------------------------------

/**
 * The cube render target a sky bakes its environment map through, allocated
 * once and resized only when the quality tier actually changes it.
 *
 * `generateMipmaps` is OFF and both filters are `LinearFilter` on purpose: the
 * only consumer is `PMREMGenerator`, which builds its own filtered chain from
 * the base level, so a mip chain here is memory and bandwidth spent on texels
 * nothing samples.
 *
 * Hand it whatever the sky is currently holding — including `null` — and assign
 * the result back. The old target is disposed before the new one is created, so
 * a quality switch does not leak the previous faces.
 */
export function ensureSkyCube(
  existing: THREE.WebGLCubeRenderTarget | null,
  size: number,
): THREE.WebGLCubeRenderTarget {
  if (existing && existing.width === size) return existing;
  existing?.dispose();
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  rt.texture.name = 'SkyCube';
  return rt;
}

// ---------------------------------------------------------------------------
// The environment bake itself
// ---------------------------------------------------------------------------

/**
 * ===========================================================================
 *  THE PROBE BAKE, WHICH SEVEN GAMES WROTE AND NO PACKAGE OWNED.
 * ===========================================================================
 *
 * `ensureSkyCube` above is HALF of a bake and it shipped alone for a while.
 * The other half — cube camera, PMREM, and the dispose ordering — was written
 * out by hand in six games, and two of those copies carry the SAME
 * hard-won comment about the ordering in different words. Nothing in any of
 * them is about a hollow, a valley or a racetrack.
 *
 * THREE RULES, AND NO SINGLE COPY IN THE TREE HAD ALL THREE. That is the
 * argument for this function existing, stated as evidence rather than as
 * tidiness:
 *
 *   1. DISPOSE THE PREVIOUS PROBE, AFTER the new one exists and is assigned.
 *      Freeing the texture the scene is currently sampling and then failing to
 *      build a replacement leaves `scene.environment` pointing at a dead
 *      handle: every PBR surface renders black with no error anywhere.
 *      Two of the six had this.
 *
 *   2. KEEP THE RENDER TARGET, NOT ITS TEXTURE. `PMREMGenerator.fromCubemap`
 *      allocates a target per call, and `target.texture.dispose()` frees the
 *      texture and LEAKS THE FRAMEBUFFER. One game measured it: one bake every
 *      ninety frames is 720 leaked targets an hour on a piece whose whole
 *      remit is to run all evening without degrading. Another held the
 *      texture and was leaking one target per bake. Only one copy knew.
 *
 *   3. A LOST CONTEXT IS NOT A REPLACEMENT. Nothing may be disposed when the
 *      context that owned it is gone. One game knew; another game's restore
 *      path called its bake and disposed a dead texture. See
 *      `dropSkyProbe`.
 *
 * Each game was the only witness to one of these, which is precisely the
 * argument for ONE COPY: four implementations means one is best at each rule
 * and none is best at all of them.
 */
export interface SkyProbe {
  /** the cube target, owned by the caller and passed back in on every bake */
  cube: THREE.WebGLCubeRenderTarget;
  /** the camera that renders the six faces; rebuilt when the cube is resized */
  camera: THREE.CubeCamera;
  /**
   * The filtered probe, as a RENDER TARGET. Rule 2 above is why this is not a
   * `Texture`: hand `target.texture` to the scene and keep the target here, or
   * the framebuffer leaks on every bake.
   */
  baked: THREE.WebGLRenderTarget;
  /** the generator, kept because building one per bake reallocates its chain */
  pmrem: THREE.PMREMGenerator;
}

/**
 * Bake the environment probe from an env scene, and hand back the state.
 *
 * Pass `null` on the first call and keep whatever comes back. `near`/`far` are
 * the cube camera's clip planes and are REQUIRED: a hollow bakes from half a
 * metre to ten, a valley from one metre to four kilometres, and a package
 * shipping either pair would put the other game's world outside its own probe.
 *
 * The env scene should be `mountSkyDome`'s `envScene`, which SHARES the
 * material with the visible dome — the classic version of this bug is chrome
 * reflecting a sky nobody can see.
 */
export function bakeSkyProbe(
  previous: SkyProbe | null,
  renderer: THREE.WebGLRenderer,
  envScene: THREE.Scene,
  size: number,
  near: number,
  far: number,
): SkyProbe {
  const cube = ensureSkyCube(previous?.cube ?? null, size);
  // Rebuilt whenever the cube changed identity — a `CubeCamera` holds its
  // target, so one pointed at a disposed cube renders into freed faces.
  const camera = previous && previous.cube === cube
    ? previous.camera
    : new THREE.CubeCamera(near, far, cube);
  const pmrem = previous?.pmrem ?? new THREE.PMREMGenerator(renderer);

  camera.update(renderer, envScene);
  const next = pmrem.fromCubemap(cube.texture);
  // AFTER, never before, and the TARGET rather than its texture. Rules 1 and 2
  // in the header; this is the whole reason this function exists rather than
  // six copies of it, two of which each knew only one of the two.
  previous?.baked.dispose();
  return { cube, camera, baked: next, pmrem };
}

/**
 * Throw the probe away because the GL CONTEXT IS GONE, which is not the same
 * act as replacing it.
 *
 * NOTHING IS DISPOSED HERE and that is the point. The context that owned these
 * objects no longer exists, so `dispose()` would queue deletes against a
 * context three has already torn down. Dropping the references is the whole of
 * the cleanup a lost context needs, and the next `bakeSkyProbe(null, …)`
 * allocates fresh ones against the new context.
 *
 * One game did not have this path — its restore handler called its bake,
 * which disposed a texture belonging to a dead context. It is the exact
 * defect another game's copy had a comment about and that one did not, and
 * it is why one implementation beats two correct-in-different-halves ones.
 */
export function dropSkyProbe(_probe: SkyProbe | null): null {
  return null;
}
