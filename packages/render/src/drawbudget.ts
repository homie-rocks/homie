/**
 * ============================================================================
 *  drawbudget — keeps a frame inside its draw-call budget.
 * ============================================================================
 *  Three mechanisms, separable, each measurable as an ablation:
 *
 *   1. STATIC BATCHING. Long runs of same-material static geometry that no
 *      single subsystem can merge, because each subsystem builds one piece at
 *      a time. Merging is NOT deleting content: every triangle, material and
 *      vertex attribute survives byte-for-byte, the geometry is baked into
 *      world space and concatenated, and the shaders see the same world
 *      positions they saw before. Only the number of times the CPU asks the
 *      GPU to draw them changes.
 *
 *   2. LOD SWAP ONTO A MERGED BAKE, for registered groups — a vehicle, a
 *      building, a rig of parts that move together.
 *
 *   3. SHADOW RELEVANCE, and the part of it nobody writes: a caster is
 *      relevant if its shadow can reach the frame, which is its own bounds
 *      PADDED BY THE SHADOW'S RUN-OUT — cot(sun elevation) times the caster's
 *      height. Plus a per-cascade assignment, so a 1.7 m figure is rasterised
 *      into the 20 m cascade and not into all four.
 *
 *  ── WHY THIS IS A PACKAGE AND NOT A GAME'S FILE ─────────────────────────────
 *  It came from a base-building game, and before that was a fork of a kart
 *  racer's, and nothing in it has ever known what it was drawing. It knows what
 *  a mesh, a material key, a cascade and a bounding sphere are. The numbers in
 *  it are arithmetic about vertex counts and shadow geometry, not art direction
 *  — the two that ARE art direction, the LOD swap and keep distances, are
 *  required options instead, because a colony a kilometre across and a corridor
 *  twelve metres long do not collapse at the same range and a quality-tier
 *  branch in here would hand one game the other's scene scale.
 *
 *  THE MEASUREMENT LOG LIVES WITH THE GAME THAT TOOK IT. Every draw-call figure
 *  that shaped this file was measured on one colony at one resolution; the
 *  game's own draw-budget module keeps all of it, because a number fitted at
 *  one scale is not a number at another and a package repeating them would
 *  read as a promise.
 *
 *  ── TWO TRAPS THAT HAVE COST TIME AND ARE STILL LIVE ────────────────────────
 *  `visible = false` IS NOT A VALID ABLATION ON ANYTHING THIS FILE TOUCHES. It
 *  rewrites `.visible` on both the source meshes and its own merged copies
 *  every frame, so hiding every node of a ship still photographs a complete
 *  hull, drawn by that ship's group bake — and a containment mask built
 *  on that arm silently drops almost every row of the measurement. The valid
 *  handle is a 10 km TRANSLATION; nothing in the render loop rewrites position.
 *
 *  A CONTAINER THAT IS NOT PRUNED REBUILDS FOREVER. The mesh census has to skip
 *  this file's OWN meshes, or the bakes it just made read as scene growth, the
 *  rebuild guard fires, and the merged set is rebuilt every ~1.6 s until it
 *  hits MAX_REBUILDS and switches itself off for the session.
 * ============================================================================
 */
import * as THREE from 'three';
import { registerPrewarm } from './Prewarm.ts';

/** Answers "is probe fault NAME injected right now". See `DrawBudget.fault`. */
export type FaultHook = (name: string) => boolean;

/** Everything the budget needs at construction. One field, and it is required. */
export interface DrawBudgetSpec {
  fault: FaultHook;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Static batching — tunables, each with the arithmetic that produced it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Frames to wait after the scene first looks populated before baking.
 *
 * Two reasons. Construction is staged across several frames, so baking on the
 * first frame would batch half a colony and then immediately dissolve. And the
 * movement audit needs a before/after pair to tell a static pylon from a solar
 * tracker that happens to be at the top of its travel — measured on the mature
 * scenario, 79 of its 566 structure meshes DO move, and they are exactly the
 * ones that must not be baked.
 */
const SETTLE_FRAMES = 24;

/** Members below this and the merge is not worth the bookkeeping. */
const MIN_BATCH_MEMBERS = 3;

/**
 * Members we aim for per batch, and the spatial cell that follows from it.
 *
 * A batch is one draw call and one bounding sphere, so the two costs pull in
 * opposite directions: fewer, larger batches cost fewer calls and cull worse.
 * The cell size is derived per bucket from the members' own footprint —
 * `cell = sqrt(area / (n / TARGET))` — so a tight cluster of 40 pylons becomes
 * one batch and a bucket smeared across the whole map becomes several. The
 * clamp is what stops the derivation running away: never smaller than a
 * building (culling gains nothing below that) and never larger than the near
 * shadow cascade's extent, because a batch wider than a cascade is drawn into
 * every cascade every refresh and gives the whole saving straight back.
 */
const TARGET_BATCH_MEMBERS = 40;
const CELL_MIN = 55;
const CELL_MAX = 220;

/**
 * How often the guard re-checks that every batched mesh is still where it was
 * and still hidden, and how often we rescan for meshes that have appeared or
 * gone. Both in frames.
 *
 * The audit is a matrix compare per member — about 9,000 float compares for the
 * mature colony, i.e. free — but there is no reason to pay it every frame when
 * the failure it catches (a batch drawn at a stale transform) is corrected
 * within a fifth of a second either way. The rescan walks the scene graph,
 * which is the expensive one, so it runs at a quarter of that rate.
 */
const AUDIT_INTERVAL = 12;
const RESCAN_INTERVAL = 48;

/**
 * Rebuilds after which the batcher gives up for the session and says so.
 *
 * The quarantine is what makes the bake/guard/rebuild cycle converge, and on
 * every scenario measured it converges in two or three passes. This is the
 * backstop for the case it does not: a colony that never stops changing shape
 * would otherwise re-merge a few hundred thousand vertices every couple of
 * seconds forever, and a silent periodic hitch is a far worse bug than a frame
 * that is honestly over budget.
 */
const MAX_REBUILDS = 32;

/**
 * Vertex ceiling for one batch, and for the whole batching pass.
 *
 * Merging duplicates the source vertex data on the GPU (the originals stay
 * resident because a dissolve has to be able to put them back), so this is a
 * memory budget, not a speed one. 1.2 M vertices of a 40-byte layout is ~48 MB,
 * which is inside what a mature colony's own geometry already costs.
 */
const MAX_BATCH_VERTS = 300_000;
const MAX_TOTAL_VERTS = 1_200_000;

// ─────────────────────────────────────────────────────────────────────────────
//  LOD and shadow relevance — tunables
// ─────────────────────────────────────────────────────────────────────────────


/**
 * When a registered group's shadow stops being worth drawing, as the fraction of
 * FRAME HEIGHT its run-out subtends.
 *
 * ── THIS WAS A FLAT 420 m AND THAT WAS AN INVERSION ──────────────────────────
 *
 * The old constant said "past 420 m from the camera a group does not cast".
 * Applied to a distance and nothing else, it did the exact opposite of what a
 * relevance test is for, because the thing it culls hardest is the thing whose
 * shadow is largest: at the mature scenario's 13.4 deg sun a 50 m ship lays
 * 210 m of shadow and a 2 m mast lays 8.4 m, and BOTH of them were cut at the
 * same 420 m. So a ship at 430 m — whose shadow is a quarter of the width of
 * the frame — stopped casting, while a mast at 419 m, whose shadow is four
 * pixels, kept casting. That is precisely the signature a lighting review
 * described: "the 50 m ships, the hub dome, the transit tubes cast NO SHADOW AT
 * ALL, while the 2 m masts beside them cast crisp ones."
 *
 * MEASURED HONESTLY, AND THIS IS THE HALF THAT MATTERS: on the capture set of
 * the time that inversion was LATENT, not active. Ablated at the `reference`
 * pose with the grain and dither pinned (the game renderer's `setStill`),
 * turning this whole file off is a 0.000 mean absolute difference and a 0.0
 * block max — bit identical — and the same at `regional`. The groups sit
 * 180-220 m from the camera at both, well inside 420, so the cap never fired
 * and it was NOT what was missing from those frames. It is fixed here because
 * it is a trap primed to go off the first time a shot is composed from further
 * back, not because fixing it moved a pixel then.
 *
 * The derivation: a shadow is worth rasterising while it is big enough to see.
 * Its run-out is `height * cot(elevation)` — already derived per frame from the
 * sun, see SHADOW_RUNOUT_MAX — and the angle it subtends is that over the
 * distance to it. Comparing against `2 * tan(fov/2)` puts the threshold in
 * fractions of frame height, which is the only unit in which "too small to see"
 * means anything. 0.004 is four pixels at 1080p, which is under the width of the
 * contact decal that carries the grounding past this point (the third of the
 * three grounding cues).
 */
const SHADOW_MIN_FRAME_FRAC = 0.004;

/**
 * Absolute backstop on a group's shadow, metres, for the case the derivation
 * cannot answer: a sun on the horizon sends `cot` to infinity and would keep
 * every caster in the game alive forever.
 *
 * 1400, because the game's lighting rig's outermost cascade is a 900 m
 * half-extent centred on the camera focus, so a caster past ~1300 m from the
 * camera is outside every shadow map the rig owns and its `castShadow` is moot.
 * Wider than the old 420 by design: the job of this number is to bound the
 * derivation, not to be the policy.
 *
 * ── IT IS NOW A FLOOR ON A DERIVED NUMBER, NOT THE NUMBER ───────────────────
 *
 * The sentence above says out loud that 1400 is a restatement of the lighting
 * rig's 900, and a number with two owners has none: if that rig's outermost
 * cascade ever grows, this constant silently keeps culling casters the new
 * cascade could have used, and the failure is a shadow that is simply absent
 * with nothing anywhere to say so. The extents are already read off the lights
 * every frame by `updateCascades` here — for the per-cascade assignment — so
 * the derivation costs nothing. This survives as the value used when no cascade
 * has been found yet (Low quality runs two, and `CASCADE_MIN_COUNT` then leaves
 * the table empty).
 *
 * The lighting rig gained a `window.__lighting.setCascadeExtent(i, m)`
 * ablation handle precisely so the reach/density trade can be measured on one
 * frozen frame. A hard-coded bound here would have made that handle lie.
 */
const SHADOW_MAX_ABS = 1400;
/**
 * How far past the outermost cascade's own box a caster may still be worth
 * keeping, as a multiple of that half-extent.
 *
 * 1.45, which is what 1400 was against a 900 m cascade — kept because that
 * value was measured against this scene and the derivation is only meant to
 * make it follow the rig, not to re-tune it.
 */
const SHADOW_ABS_OVER_CASCADE = 1400 / 900;

/**
 * Ceiling on the shadow run-out used to pad the relevance test, metres.
 *
 * The run-out itself is DERIVED per frame from the sun, not typed in, because
 * on this world it varies by an order of magnitude across the day: a shadow's
 * length is `height / tan(elevation)`, and the art direction opens the game
 * at ~11 deg elevation, where a 20 m habitat throws 103 m of shadow and a 50 m
 * ship throws 257 m. The kart racer's equivalent constant was EIGHT metres —
 * that number is meaningless here and copying it across would have quietly
 * culled the shadow of everything just off the left of frame, which at this sun
 * angle is most of the shadows in the picture.
 *
 * The cap is what stops the derivation exploding as the sun approaches the
 * horizon (tan -> 0). At 4 deg, the lowest elevation the art direction calls
 * "lunar morning", a 20 m habitat throws 286 m; past that the shadow has faded
 * into the terminator anyway. Measured on the mature scenario the sun sits at
 * 13.3 deg, i.e. cot = 4.23, so a 12 m structure runs out at 51 m and the cap
 * never binds — it is there for the ends of the day cycle.
 */
const SHADOW_RUNOUT_MAX = 340;

/**
 * FLOOR on the run-out, metres, regardless of how short the caster is.
 *
 * `height * cot(elevation)` is the run-out onto FLAT ground level with the
 * caster's own base, and the ground here is neither flat nor level: a mast on a
 * crater rim lays its shadow down the slope, and it keeps going until it finds
 * something to land on. There is no cheap exact answer — the exact answer is a
 * terrain query per caster per frame — so the honest move is a floor big enough
 * to cover the local relief.
 *
 * MEASURED, and it took two harness runs to find. With no floor, the
 * `street` pose lost a mast's shadow where it crossed the road: block-diff
 * 13.3 against a 2.7 noise floor, clearly visible side by side, and invisible
 * in every draw-call statistic. 160 m at the mature scenario's 13.3 deg sun is
 * the shadow of a 38 m drop, which is more relief than this basin has inside a
 * shadow's length of anything.
 */
const SHADOW_RUNOUT_MIN = 160;

/**
 * Extra slack on every shadow relevance test, metres.
 *
 * A bounding sphere is a loose fit and the run-out is computed from a bounding
 * HEIGHT, so both are approximations of a silhouette. This is the margin that
 * makes the test conservative rather than tight, and the asymmetry is the whole
 * point: a caster wrongly kept costs one draw call, and a caster wrongly culled
 * costs a shadow that is simply absent from the frame with nothing to indicate
 * anything went wrong. Cheap mistakes on the expensive side.
 */
const SHADOW_TEST_SLACK = 14;

/**
 * Bounding radius above which a mesh is never shadow-culled, metres.
 *
 * A terrain chunk is a quarter of a kilometre across and its bounding sphere
 * touches the frustum from almost anywhere, so the test costs more than it
 * saves — and getting it wrong on the terrain removes the crater-rim shadows
 * that the art direction hangs the whole depth read on. Skip them outright
 * and let three's own per-cascade frustum cull do that job.
 */
const SHADOW_CULL_MAX_RADIUS = 90;

// ─────────────────────────────────────────────────────────────────────────────
//  Auto-discovered groups — tunables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fewest member meshes a discovered node must own before it is worth a bake.
 *
 * Three, not more, because the cascades multiply it: a caster is rasterised into
 * every cascade box it touches, measured at 2.9 of the four averaged over the
 * mature colony, so collapsing three casters into one removes about six draws
 * from a full-refresh frame and costs one merged geometry.
 */
const GROUP_MIN_MEMBERS = 3;

/**
 * Largest bounding radius a discovered node may have before we descend into its
 * children instead of baking it whole, metres.
 *
 * THIS IS THE ENTIRE DISCOVERY HEURISTIC and it is doing two jobs at once. A
 * merged mesh is one bounding sphere, so baking `structures` — which spans the
 * whole colony — would produce a batch that is inside every cascade from
 * everywhere and hand the saving straight back. Descending instead lands on the
 * nodes the scene graph already calls buildings: measured on `mature`, this
 * picks up a docked ship (13 meshes), a landing pad (12), a mast (6), a comms
 * tower (3) and the hub dome (2), and it walks straight past `terrain` (49
 * chunks, each its own child with one mesh) and `agents` (16 meshes hanging
 * directly off the node, one each) without a special case for either. 150 m is
 * a landing pad's diagonal with room, and under a fifth of the 900 m far
 * cascade.
 */
const GROUP_MAX_RADIUS = 150;

/** Vertex ceilings for the group bakes, mirroring the batcher's. Memory, not
 *  speed: the source geometry stays resident so a dissolve can restore it. */
const GROUP_MAX_VERTS = 400_000;
const GROUP_TOTAL_VERTS = 2_000_000;

// ─────────────────────────────────────────────────────────────────────────────
//  Per-cascade caster assignment — tunables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How far inside a cascade's box a shadow must fall before the cascades BEHIND
 * it can stop drawing its caster, as a fraction of the box half-extent.
 *
 * THIS IS THE ONE NUMBER IN THIS FILE THAT MUST NOT BE OPTIMISTIC, so it is
 * derived from the shader and then made smaller.
 *
 * The lighting rig resolves the cascades from the innermost outward and
 * returns on the first box that contains the fragment, so a receiver inside
 * cascade i never samples cascade i+1 — EXCEPT in the cross-fade band, which
 * that file opens at `CASCADE_BLEND = 0.84` of the half-extent. A caster whose
 * whole shadow lands inside 0.84 therefore cannot be seen from any map past
 * cascade i, and rasterising it into them is pure cost.
 *
 * 0.72, not 0.84, and the margin is the point. The cascade boxes are texel-
 * snapped and re-centred every frame, the swept shadow box below is an AABB of a
 * silhouette rather than the silhouette, and this file runs BEFORE the frame it
 * is deciding for. Every one of those is a small error and all of them are
 * cheap to absorb: a caster wrongly kept costs one draw call, and a caster
 * wrongly dropped costs a shadow that is simply not in the picture with nothing
 * anywhere to indicate that anything went wrong. The 0.12 of slack is roughly
 * 2.4 m at cascade 0 and 108 m at cascade 3.
 */
const CASCADE_CONTAIN = 0.72;

/**
 * Fewest sun cascades that must be found before per-cascade assignment runs.
 *
 * With one map there is nothing to assign to. This is also the switch that turns
 * the whole mechanism off by itself on Low, which runs two cascades, and on any
 * future rig that stops being cascaded — rather than leaving a rule fitted to
 * four boxes silently deciding a two-box frame.
 */
const CASCADE_MIN_COUNT = 3;

/**
 * How closely a directional light's direction must match the sun's to be
 * treated as one of its cascades. Cosine of the angle.
 *
 * The scene also holds the EARTHSHINE directional, which casts its own single
 * map from a completely different part of the sky. Sorting cascades by box size
 * alone would happily fold that map into the chain and cull casters out of the
 * one light that carries the entire night frame. Match on direction and it
 * cannot happen.
 */
const CASCADE_SUN_COS = 0.9995;

/**
 * Lateral pad on the swept shadow box for the CASCADE test only, metres.
 *
 * IT IS NOT `SHADOW_RUNOUT_MIN`, AND THAT DISTINCTION IS THE WHOLE MECHANISM.
 * The 160 m floor above exists because the relevance test asks "does this shadow
 * land anywhere the camera can see", and the answer depends on terrain the
 * shadow runs down, which we do not query. The cascade test asks a different
 * question — "which of these boxes is it inside" — and the boxes are in LIGHT
 * space with 1600 m of depth (the lighting rig's LIGHT_NEAR_ROOM), so relief
 * ALONG the light ray costs nothing at all. Only the sideways component of a
 * downhill run needs covering, and 30 m of it is a 30 m lateral offset, which is
 * more than this basin produces inside a shadow's length.
 *
 * MEASURED, and the first version of this test used the 160 m floor and was
 * worth almost nothing because of it: with a 160 m box nothing on the map fits
 * inside cascade 0 (40 m) or cascade 1 (140 m), so every caster came back
 * needing the 900 m map and the assignment had no work to do — 46 of 73 visible
 * casters at `maxCascade = 3`. A 1.73 m figure at this sun elevation throws
 * 7.3 m of shadow, which fits cascade 0 with room; the floor was hiding that
 * behind a number fitted for a different question. A number fitted at one
 * scale is not a number at another.
 */
const CASCADE_RELIEF_PAD = 30;

// ─────────────────────────────────────────────────────────────────────────────
//  Public shape of a registered group
// ─────────────────────────────────────────────────────────────────────────────

export interface DrawGroup {
  /** The node whose world position is the group's distance from the camera. */
  object: THREE.Object3D;
  /**
   * A merged bake of `detail`, if the owning subsystem already has one. When it
   * is absent this file builds its own — see `bakeGroup`. Either way it is the
   * group's ONLY shadow caster, near or far.
   */
  impostor?: THREE.Mesh;
  /** The meshes the impostor stands in for. */
  detail: THREE.Object3D[];
  /** Bounding radius in metres, for the shadow relevance test. */
  radius?: number;
  /** Approximate height in metres, for the shadow run-out. Defaults to radius. */
  height?: number;
}

interface Group {
  def: DrawGroup;
  /**
   * The group's single shadow caster: one merged, POSITIONS-ONLY geometry
   * parented to `def.object`, so it follows anything that moves the group whole.
   *
   * Positions only, and that is the point rather than a shortcut. A shadow map
   * rasterises depth; three derives the depth material from the source material
   * and for an opaque one it reads nothing but `position`. Dropping every other
   * attribute is what lets a group whose members wear five DIFFERENT materials
   * collapse to ONE caster — the constraint that kept the previous version of
   * this file from ever building an impostor for a ship.
   *
   * The eligibility rules in `isProxyable` are what make that legal: any member
   * whose shadow depends on more than its position (alpha-tested, transparent,
   * displacement-mapped, or drawn on a non-default side) is left casting for
   * itself.
   */
  proxy: THREE.Mesh | null;
  /** The proxy's material. Shared across every auto group — see `proxyMaterial`. */
  proxyMat: THREE.Material | null;
  /**
   * Per-material merges of the same members, drawn instead of them while the
   * group is beyond LOD_SWAP. Empty when the group is not worth collapsing.
   */
  bakes: THREE.Mesh[];
  /** The members merged into the proxy. */
  members: THREE.Mesh[];
  /**
   * The subset of `members` whose `visible` flag we own, i.e. the ones with no
   * THREE.LOD above them. Only these are hidden for the far-LOD colour bake, and
   * only these are checked for a second visibility owner by the audit — an LOD's
   * levels are shown and hidden by the LOD every frame, which is correct and not
   * evidence of anything.
   */
  visOwned: THREE.Mesh[];
  /** 16 floats per member: the member's matrix RELATIVE TO `def.object` at bake
   *  time. Relative, so the group as a whole is still free to move. */
  matrices: Float32Array;
  radius: number;
  height: number;
  near: boolean;
  casting: boolean;
  /** Members whose castShadow we took over, so it can be handed back. */
  castTaken: THREE.Mesh[];
  /** True when this file discovered the group, and so owns tearing it down. */
  auto: boolean;
  /** Set once a bake has been attempted, whether or not it produced anything. */
  tried: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Internal batch record
// ─────────────────────────────────────────────────────────────────────────────

interface Batch {
  mesh: THREE.Mesh;
  members: THREE.Mesh[];
  /** 16 floats per member: the world matrix at bake time. The guard's evidence. */
  matrices: Float32Array;
  parent: THREE.Object3D;
}

/**
 * One shadow caster the relevance test watches.
 *
 * `want` is the owning subsystem's intent and `applied` is what we last wrote.
 * Holding both is what makes this pass composable with everybody else: when the
 * two disagree, somebody outside this file has written `castShadow`, and their
 * value becomes the new intent. Without that, a habitat that powers down and
 * stops casting would be switched back on by us on the next frame it came into
 * view, and the bug would look like it belonged to the habitat.
 */
interface Caster {
  mesh: THREE.Object3D;
  /** World-space bounding radius, metres. */
  radius: number;
  /** World-space height above the mesh origin, metres — drives the run-out. */
  height: number;
  want: boolean;
  applied: boolean;
  /**
   * What the relevance test decided for this frame, before any cascade said
   * otherwise. `applied` tracks the value currently written on the mesh, which
   * during the shadow pass is per-cascade; this is what it goes back to.
   */
  base: boolean;
  /**
   * Highest cascade index that can still see this caster's shadow.
   *
   * The cascade boxes are NESTED — 20 / 70 / 240 / 900 m half-extents about the
   * same focus — so a caster near the camera is inside all four of them and
   * three, which tests each caster against each box and knows nothing about how
   * the shader chooses between them, draws it four times. Measured on the mature
   * colony: 397 shadow draws for 137 visible casters, i.e. 2.9 boxes each. This
   * is the field that fixes that.
   */
  maxCascade: number;
}

/**
 * One sun cascade, as read back off the light itself every frame.
 *
 * READ BACK, not shared with the game's lighting rig, and deliberately: the rig
 * owns the extents, the texel snapping and the refresh intervals, and a second
 * copy of any of those numbers here would be a second owner that goes stale
 * silently. What is reconstructed instead is the one thing three would compute
 * anyway — the shadow camera's world-to-clip — from the light's own transform,
 * which is current at lateUpdate time.
 */
interface Cascade {
  light: THREE.DirectionalLight;
  /** World -> this cascade's clip space. Its box is |x|,|y|,|z| <= 1. */
  viewProj: THREE.Matrix4;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Scratch. No allocation in the per-frame path.
// ─────────────────────────────────────────────────────────────────────────────
const _pos = new THREE.Vector3();
const _pos2 = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _viewProj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _mat = new THREE.Matrix4();
const _norm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _sunDir = new THREE.Vector3(0, 1, 0);
const _box = new THREE.Box3();
const _boxB = new THREE.Box3();
// Separate from `_mat`, which mergeStatic owns for the duration of a merge —
// the group bake holds a root inverse across a call into it.
const _mat2 = new THREE.Matrix4();
const _mat3 = new THREE.Matrix4();
const _v2 = new THREE.Vector3();

export interface DrawBudgetOptions {
  /**
   * Metres at which a registered group collapses to its merged bake, and the
   * metres at which it comes back. TWO numbers, not one, because a single
   * threshold makes a group at exactly that distance swap every frame.
   *
   * REQUIRED, and not derived from a quality tier in here. A quality branch in
   * this file would be one game's LOD distances silently applied to another's
   * scene scale — a colony a kilometre across and a corridor twelve metres
   * long do not collapse at the same range, and the frame would look
   * completely fine either way.
   */
  lodSwap: number;
  lodKeep: number;
  /** False while the renderer has shadows off; the relevance test is then moot. */
  shadows: boolean;
  /**
   * `ctx.frozen` — the capture hold, mirrored down here.
   *
   * Read for exactly one thing (`updateStatic`): a world that is HELD is done
   * moving by definition, so the settle window that exists to prove it held
   * still is proving something already known. See the note there.
   */
  frozen: boolean;
}

export interface DrawBudgetStats {
  enabled: boolean;
  /** Batches currently standing. */
  batches: number;
  /** Source meshes those batches are standing in for. */
  batched: number;
  /** Draw calls the batching pass removed from the opaque list, per submission. */
  saved: number;
  /** Registered groups, and how many are currently collapsed to their bake. */
  groups: number;
  groupsFar: number;
  /** Registered groups whose shadow cannot reach the frame, so are not casting. */
  groupsUncast: number;
  /** Groups standing on a merged shadow proxy, and the members it casts for. */
  proxies: number;
  proxied: number;
  /**
   * Shadow draw calls the proxies removed from ONE cascade refresh.
   *
   * `proxied - proxies`: the real saving on a frame is this times the number of
   * cascades each caster would have been rasterised into, measured at ~2.9 of
   * the four on the mature colony — so this number is a floor, not the total.
   */
  proxySaved: number;
  /** Colour draws the far-LOD merges removed, per submission of the opaque list. */
  bakeSaved: number;
  /** False when the renderer could not arm the shadow-pass hook; see beginShadowPass. */
  shadowHook: boolean;
  /** Scene-wide shadow casters under the relevance test, and how many it stood down. */
  casters: number;
  castersCulled: number;
  /** Sun cascades the per-cascade assignment recognised. 0 means it is not running. */
  cascades: number;
  /**
   * Caster-cascade pairs the assignment removed from a full-refresh frame.
   *
   * Read it as draw calls: this is exactly how many rasterisations of a caster
   * into a cascade the frame no longer does, on a frame where every cascade
   * refreshes. On the frames where only the inner two refresh it is less, which
   * is why the harness has to report a distribution and not a number.
   */
  cascadeSaved: number;
  /**
   * cot(sun elevation): metres of horizontal shadow per metre of caster height.
   * A ratio, NOT a distance — the distance is this times the caster's height,
   * which is why it is named for what it is.
   */
  shadowCot: number;
  vertices: number;
  /** Rebuilds performed. A number that keeps climbing means the guard is right
   *  and something in the scene is not as static as the bake assumed. */
  rebuilds: number;
  dissolves: number;
  /**
   * Times `forget()` has run, i.e. times the scene object under us was replaced.
   *
   * PUBLISHED BECAUSE TWO STATES COULD NOT BE TOLD APART WITHOUT IT. A hero
   * frame's shadow pass once submitted a hub dome's shadow proxy and friends
   * while this block reported `groups: 0, proxies: 0, dissolves: 0,
   * vertices: 0` — which is either (a) the groups were dissolved cleanly and
   * those proxies are somebody else's, or (b) `forget()` dropped the records
   * WITHOUT restoring, because a scene swap is the one path that does that on
   * purpose (the meshes behind the handles may already be disposed). Those two
   * readings want opposite responses and nothing in the statistics separated
   * them. This does: `forgets > 0` with proxies still in the graph is (b).
   */
  forgets: number;
}

// ─────────────────────────────────────────────────────────────────────────────
//  The system
// ─────────────────────────────────────────────────────────────────────────────

export class DrawBudget {
  /**
   * Probe-fault gate. REQUIRED at construction, no default.
   *
   * A default of "no faults" would let a game wire this file in and ship a
   * harness whose injected fault can never go red — a green suite validating
   * nothing, which is the exact failure five rotted anchors caused on
   * another project. A game with no fault system passes `() => false` and has
   * said so out loud.
   */
  readonly fault: FaultHook;

  constructor(spec: DrawBudgetSpec) {
    this.fault = spec.fault;
  }

  /** Debug switch. Turning it off dissolves every batch on the next frame. */
  enabled = true;
  /** Static batching specifically. Separable from the LOD/shadow half. */
  batching = true;
  /** Scene-wide shadow relevance culling. Separable for the same reason. */
  shadowCulling = true;
  /** Per-cascade caster assignment. Separable for the same reason. */
  cascadeCulling = true;
  /** Auto-discovery of groups, and the merged shadow proxy each one stands on. */
  grouping = true;
  /** The far-LOD colour merge specifically. Separable from the shadow proxy. */
  groupLod = true;

  /**
   * Raised by the renderer once it has wrapped `WebGLShadowMap.render`.
   *
   * Until it is, a shadow proxy cannot be hidden from the colour pass without
   * also being hidden from the shadow pass — three gates both on
   * `material.visible` — so the proxies run in their visible, colorWrite-off
   * form instead: one wasted colour draw each, and every shadow still drawn.
   * A worse number is an acceptable failure; a missing shadow is not.
   */
  shadowHookArmed = false;

  private scene: THREE.Scene | null = null;
  private container: THREE.Group | null = null;
  private batches: Batch[] = [];
  private groups: Group[] = [];
  private casters: Caster[] = [];
  /**
   * Every caster record we have ever made, by mesh.
   *
   * THIS EXISTS BECAUSE OF A LEAK THAT THE FIRST VERSION OF THIS FILE SHIPPED
   * AND THE FIRST VERSION OF ITS HARNESS COULD NOT SEE, which is the more
   * useful half of the story.
   *
   * The rescan collected casters by testing `o.castShadow` — a field this class
   * WRITES. So the moment a mesh was culled, the next rescan no longer
   * recognised it as a caster, dropped its record, and with the record went the
   * only memory that it was ever supposed to cast. Panning the camera therefore
   * removed shadows permanently, one rescan at a time: measured across seven
   * camera poses, the collected caster count fell 457 -> 432 -> 327 -> 182 ->
   * 182 -> 0 and never recovered.
   *
   * And the ablation harness reported "no pixel difference" throughout — because
   * the ablation restores from the same list, so BOTH arms were equally missing
   * the shadows and the diff was comparing two identically broken frames.
   * When an injected fault comes back uncaught, suspect the check's INPUTS.
   * The input was this list.
   *
   * The record is now the authority and `castShadow` is only ever an output.
   */
  private casterIndex = new WeakMap<THREE.Object3D, Caster>();
  /**
   * Meshes that have already broken a batch once, and are never batched again.
   *
   * The exclusion rules in `isBatchable` are a list of the ways a mesh is known
   * to be unbatchable; this is the list of the ways nobody has thought of yet.
   * Without it the guard is correct and useless: it dissolves the batch, the
   * rebuild bakes the identical set, the guard dissolves it again, and the
   * colony's draw count oscillates for the rest of the session. MEASURED — with
   * the guard alone the mature scenario's colour count swung between 232 and
   * 290 across a 30-frame sample, and `dissolves` climbed without bound.
   */
  private quarantine = new WeakSet<THREE.Object3D>();
  /**
   * Nodes discovery has already looked at and rejected, so it does not survey
   * the same subtree on every rescan. Separate from `quarantine`, which is about
   * meshes that broke a bake.
   */
  private groupSeen = new WeakSet<THREE.Object3D>();
  /**
   * A candidate mesh's world matrix as it was at the START of the settle window.
   *
   * THIS IS THE MOVEMENT CHECK THE SETTLE WAS ALWAYS SUPPOSED TO BE, and at
   * first it was not one: `SETTLE_FRAMES` compared MESH COUNTS between two
   * windows, which proves the colony stopped being built and proves nothing at
   * all about whether its pieces are still. Baking is only legal on a mesh that
   * does not move, and the only honest way to know that is to look twice.
   * A member whose matrix moved across the window is dropped from the bake and
   * quarantined, so a walking robot or a rotating solar tracker is never merged
   * in the first place rather than merged and dissolved a fifth of a second
   * later, forever.
   */
  private stillness = new WeakMap<THREE.Object3D, Float32Array>();
  /** The one material every auto proxy wears. Built lazily; see proxyMaterial. */
  private sharedProxyMat: THREE.Material | null = null;
  /** True only for the duration of the shadow pass. See beginShadowPass. */
  private inShadowPass = false;
  private groupVerts = 0;
  /** The sun cascades, innermost first, rebuilt every frame. */
  private cascades: Cascade[] = [];
  /** Records the table above reuses, so the rebuild allocates nothing. */
  private cascadePool: Cascade[] = [];
  /** True while a cascade's per-cascade `castShadow` values are written. */
  private cascadeWritten = false;

  private frame = 0;
  /** True once a bake has been attempted against the current scene contents. */
  private baked = false;
  private settleAt = -1;
  private lastMeshCount = -1;
  private totalVerts = 0;
  private rebuilds = 0;
  private dissolves = 0;
  private forgets = 0;
  private shadowCot = 0;
  /**
   * How far a caster may be from the camera and still be worth a shadow, metres.
   *
   * DERIVED from the outermost cascade the rig actually built — see
   * SHADOW_MAX_ABS for why this is no longer a constant. Falls back to that
   * constant on any frame where no cascade table was assembled.
   */
  private shadowMaxAbs = SHADOW_MAX_ABS;

  readonly stats: DrawBudgetStats = {
    enabled: true, batches: 0, batched: 0, saved: 0, groups: 0, groupsFar: 0,
    groupsUncast: 0, proxies: 0, proxied: 0, proxySaved: 0, bakeSaved: 0,
    shadowHook: false, casters: 0, castersCulled: 0, cascades: 0, cascadeSaved: 0,
    shadowCot: 0, vertices: 0, rebuilds: 0, dissolves: 0, forgets: 0,
  };

  // ── registration ───────────────────────────────────────────────────────────

  /**
   * Registers a group of meshes that share a merged bake.
   *
   * This is the half of the file other subsystems drive. A ship and a robot
   * crowd are the obvious customers — measured, two ships alone submit 34
   * colour and 40 shadow draws EACH, and a robot crowd is the same shape of
   * problem multiplied by its population.
   *
   * Registering the same `object` twice replaces the earlier entry rather than
   * stacking a second one, so a subsystem that rebuilds its models does not
   * have to remember to unregister first.
   */
  register(def: DrawGroup, auto = false): void {
    this.unregister(def.object);
    const radius = def.radius ?? boundingRadius(def.object);
    this.groups.push({
      def,
      proxy: def.impostor ?? null,
      proxyMat: null,
      bakes: [],
      members: [],
      visOwned: [],
      matrices: new Float32Array(0),
      radius,
      height: def.height ?? radius,
      near: true,
      casting: true,
      castTaken: [],
      auto,
      tried: def.impostor !== undefined,
    });
  }

  unregister(object: THREE.Object3D): void {
    const i = this.groups.findIndex((g) => g.def.object === object);
    if (i < 0) return;
    this.restoreGroup(this.groups[i]!);
    this.groups.splice(i, 1);
  }

  // ── the shadow pass window ─────────────────────────────────────────────────

  /**
   * Called by the renderer around `WebGLShadowMap.render`, and NOWHERE else.
   *
   * This is the whole mechanism that makes a merged shadow proxy free rather
   * than merely cheaper. three r185 builds the colour render list in
   * `projectObject` and skips anything whose `material.visible` is false; the
   * shadow map walks the scene graph itself, later in the same `render()`, and
   * gates on the same flag. So a material that is false for the first and true
   * for the second is drawn into every cascade and never into the picture.
   *
   * ONE MATERIAL, ONE BOOLEAN. Every auto proxy shares `sharedProxyMat`, so
   * this pair of calls is two writes per frame however many proxies exist —
   * which matters because it runs inside the render, not in the update.
   *
   * The renderer calls `end` from a `finally`. If it ever failed to, the flag
   * would be left TRUE, which draws a colorWrite-off mesh in the colour pass:
   * one wasted draw call and no visual change. The failure is deliberately
   * arranged to fall on that side rather than on the side that loses a shadow.
   */
  beginShadowPass(): void {
    const m = this.sharedProxyMat;
    if (m === null || this.inShadowPass) return;
    this.inShadowPass = true;
    m.visible = true;
  }

  endShadowPass(): void {
    this.endCascades();
    const m = this.sharedProxyMat;
    if (m === null || !this.inShadowPass) return;
    this.inShadowPass = false;
    m.visible = !this.shadowHookArmed;
  }

  // ── per-cascade caster assignment ─────────────────────────────────────────

  /**
   * Should the renderer render the cascades one light at a time?
   *
   * It is a real cost — a render-target save and restore per light — so it is
   * only worth paying when there is something to assign: at least
   * CASCADE_MIN_COUNT sun cascades, and a caster list to sort into them.
   * (It said "nested" until the cascades were re-fitted as depth bands. Nothing
   * here ever depended on the nesting — see `cascadeFor` — but the word was
   * load-bearing enough to be worth correcting rather than leaving as a claim
   * the next reader would try to rely on.)
   * When this is false the renderer submits all the lights in one call exactly as
   * three intended, and nothing below runs.
   */
  perCascade(lights: unknown[]): boolean {
    return this.enabled && this.cascadeCulling
      && this.cascades.length >= CASCADE_MIN_COUNT
      && this.casters.length > 0
      && lights.length > 1;
  }

  /**
   * Writes `castShadow` for exactly the cascade about to be rendered.
   *
   * A light we do not recognise as one of the sun's cascades — the earthshine
   * directional, which is the entire night key — gets every caster back. That is
   * not a fallback, it is the correct answer: that map is a single box with no
   * chain behind it, so there is no "further out" cascade for anything to be
   * excluded from.
   */
  beginCascade(light: unknown): void {
    const idx = this.cascadeIndex(light as THREE.DirectionalLight);
    this.cascadeWritten = true;
    for (const c of this.casters) {
      if (c.mesh.parent === null) continue;
      const v = idx < 0 ? c.base : (c.base && c.maxCascade >= idx);
      if (c.mesh.castShadow !== v) c.mesh.castShadow = v;
      c.applied = v;
    }
  }

  /**
   * Puts every caster back to what the relevance test decided for this frame.
   *
   * MUST run before anything outside the shadow pass reads `castShadow`, and
   * the renderer calls it from a `finally` for that reason: leaving the innermost
   * cascade's assignment standing would hand the next frame's `collectCasters`
   * a scene in which two thirds of the colony claims not to cast at all, and
   * that is precisely the leak the `casterIndex` note above is a post-mortem of.
   */
  endCascades(): void {
    if (!this.cascadeWritten) return;
    this.cascadeWritten = false;
    for (const c of this.casters) {
      if (c.mesh.parent === null) continue;
      if (c.mesh.castShadow !== c.base) c.mesh.castShadow = c.base;
      c.applied = c.base;
    }
  }

  /**
   * Is this object actually submitted, i.e. visible all the way up to the scene?
   *
   * Used only by the statistics, and it is there because the statistic without
   * it was actively misleading: the caster list is mostly POOLED objects sitting
   * hidden (measured, 489 of the 899 meshes in the mature scene), three's shadow
   * pass skips anything with `visible === false`, and counting them made the
   * per-cascade saving read as 158 draws on a frame whose measured shadow count
   * had not moved by one. A statistic can rise while the thing it claims to
   * measure does not.
   */
  private isDrawn(o: THREE.Object3D): boolean {
    for (let n: THREE.Object3D | null = o; n !== null; n = n.parent) {
      if (!n.visible) return false;
    }
    return true;
  }

  private cascadeIndex(light: THREE.DirectionalLight): number {
    for (let i = 0; i < this.cascades.length; i++) {
      if (this.cascades[i]!.light === light) return i;
    }
    return -1;
  }

  /**
   * Rebuilds the cascade table from the lights themselves.
   *
   * The world-to-clip matrix is reconstructed the way `LightShadow.updateMatrices`
   * will reconstruct it a few microseconds later, from the light's position and
   * its target's — because three OVERWRITES the shadow camera's transform from
   * those two on every render, so reading the shadow camera's own matrixWorld
   * here would read whatever last frame left on it. Only the ortho half-extents
   * and the depth range are taken off the camera, and those three sets.
   */
  private updateCascades(scene: THREE.Scene): void {
    this.cascades.length = 0;
    if (!this.cascadeCulling || this.shadowCot <= 0) return;
    for (const child of scene.children) {
      const l = child as THREE.DirectionalLight;
      if (!l.isDirectionalLight || !l.castShadow) continue;
      const shadow = l.shadow;
      if (shadow === undefined || shadow === null) continue;
      const cam = shadow.camera as THREE.OrthographicCamera;
      if (cam === undefined || cam === null || cam.isOrthographicCamera !== true) continue;
      // Only the SUN's cascades. See CASCADE_SUN_COS.
      _v.copy(l.position).sub(l.target.position);
      const len = _v.length();
      if (len < 1e-4) continue;
      _v.multiplyScalar(1 / len);
      if (_v.dot(_sunDir) < CASCADE_SUN_COS) continue;

      // Exactly what LightShadow.updateMatrices builds: a camera at the light,
      // looking at the target, with the camera's own `up`.
      _mat2.lookAt(l.position, l.target.position, cam.up);
      _mat2.setPosition(l.position);
      _mat3.copy(_mat2).invert();
      cam.updateProjectionMatrix();
      const n = this.cascades.length;
      // Reused rather than allocated: this runs every frame, and the per-frame
      // path allocates nothing.
      let rec = this.cascadePool[n]!;
      if (rec === undefined) {
        rec = { light: l, viewProj: new THREE.Matrix4() };
        this.cascadePool[n] = rec;
      }
      rec.light = l;
      rec.viewProj.multiplyMatrices(cam.projectionMatrix, _mat3);
      this.cascades.push(rec);
    }
    if (this.cascades.length < CASCADE_MIN_COUNT) { this.cascades.length = 0; return; }
    // Innermost first, which is the order the shader resolves them in. Sorted by
    // the box the light itself declares rather than by the order they were added
    // to the scene, so nothing here depends on how the game builds its rig.
    this.cascades.sort((a, b) => {
      const ca = a.light.shadow.camera as THREE.OrthographicCamera;
      const cb = b.light.shadow.camera as THREE.OrthographicCamera;
      return (ca.right - ca.left) - (cb.right - cb.left);
    });
  }

  /**
   * Smallest cascade whose box contains the whole of `_box`, or the last one.
   *
   * `_box` is the caster's swept shadow volume in world space. Everything the
   * shadow can land on is inside it, so if it fits inside cascade i's inner
   * region then every receiver it touches resolves on cascade i or nearer, and
   * the maps beyond i never sample it. See CASCADE_CONTAIN for the margin.
   *
   * ── AND THAT ARGUMENT DOES NOT ASSUME NESTED BOXES, WHICH MATTERS NOW ──────
   * The game's lighting rig later re-fitted its cascades from four boxes on one
   * focus point into four DEPTH BANDS chained along the view bearing, so they
   * overlap only at their seams and cascade i's box no longer sits inside
   * cascade i+1's. Re-derived against that, the rule above still holds and for
   * the same reason: it is stated about the SHADOW, not about the boxes. If the
   * whole swept volume is inside box i, then every fragment the shadow touches
   * is inside box i, and the shader — which resolves innermost outward and
   * returns on the first box containing the fragment — hands all of them to
   * cascade i. Nothing further out can be asked about it.
   *
   * What banding DOES change is the fallback. A caster whose shadow lands in
   * band 2 is inside neither box 0 nor box 1, so this returns `last` and
   * `beginCascade` draws it into all four maps; three's own per-cascade frustum
   * cull then throws it out of the two it cannot reach. That is a wasted
   * `projectObject` per caster per cascade, never a missing shadow — the
   * asymmetry CASCADE_CONTAIN's comment insists on, landing on the safe side.
   */
  private cascadeFor(box: THREE.Box3): number {
    const last = this.cascades.length - 1;
    for (let i = 0; i < last; i++) {
      const m = this.cascades[i]!.viewProj;
      let inside = true;
      for (let corner = 0; corner < 8 && inside; corner++) {
        _v2.set(
          (corner & 1) === 0 ? box.min.x : box.max.x,
          (corner & 2) === 0 ? box.min.y : box.max.y,
          (corner & 4) === 0 ? box.min.z : box.max.z,
        ).applyMatrix4(m);
        if (Math.abs(_v2.x) > CASCADE_CONTAIN
          || Math.abs(_v2.y) > CASCADE_CONTAIN
          || Math.abs(_v2.z) > CASCADE_CONTAIN) inside = false;
      }
      if (inside) return i;
    }
    return last;
  }

  // ── the frame ──────────────────────────────────────────────────────────────

  /**
   * Called from the renderer's render(), immediately before `composer.render()`.
   *
   * That is deliberately the LAST thing in the frame: every decision here is
   * measured from the camera, and the camera rig poses it in its own update.
   * Running this any earlier reads last frame's camera, which shows up as an
   * LOD popping one frame after the pan that caused it.
   */
  lateUpdate(scene: THREE.Scene, camera: THREE.PerspectiveCamera, opts: DrawBudgetOptions): void {
    this.frame++;
    if (this.scene !== scene) {
      // A different scene means every handle we hold is into a graph that is no
      // longer being drawn. Drop them without touching them — the old scene may
      // already be disposed.
      this.forget();
      this.scene = scene;
    }

    if (!this.enabled) {
      if (this.batches.length > 0 || this.casters.length > 0
        || this.groups.some((g) => g.auto || !g.near || !g.casting)) this.dissolveAll();
      this.publish();
      return;
    }

    this.updateSun(scene, camera);
    this.updateStatic(scene, opts);
    // One frustum for both consumers below, built here so it is built once.
    camera.updateMatrixWorld();
    _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_viewProj);
    this.updateGroups(camera, opts);
    this.updateShadowCulling(scene, opts);
    this.publish();
  }

  // ── shadow relevance, scene-wide ───────────────────────────────────────────

  /**
   * Stands down every shadow caster whose shadow cannot reach the frame.
   *
   * WHY THIS IS NOT ALREADY DONE FOR US. three culls shadow casters against the
   * SHADOW camera's frustum, which is the cascade's ortho box — and the boxes
   * are big on purpose (in the game this came from: 20 / 70 / 240 / 900 m
   * half-extents, centred on where the player is looking). Everything inside
   * the 900 m box is therefore rasterised into the far cascade every time it
   * refreshes, including the two thirds of it that are behind the camera. three
   * cannot know that, because the shadow camera has no idea where the VIEW
   * camera is pointing. This does.
   *
   * Measured on the mature scenario before this existed: a frame on which all
   * four cascades refreshed submitted 404 shadow draws against 290 colour ones,
   * i.e. the cascades were the larger half of the frame's draw calls.
   *
   * THE TEST. A caster contributes to the picture if the caster itself is in
   * frame, or if any part of its shadow is. The shadow lies along the direction
   * the light travels, so it is sampled at the object, at the shadow's midpoint
   * and at its tip, each as a sphere of the object's own radius plus slack. That
   * is deliberately generous — see SHADOW_TEST_SLACK for why the errors are
   * pushed to the expensive side.
   */
  private updateShadowCulling(scene: THREE.Scene, opts: DrawBudgetOptions): void {
    const wanted = this.shadowCulling || this.cascadeCulling;
    if (!wanted || !opts.shadows || this.shadowCot <= 0) {
      if (this.casters.length > 0) this.restoreCasters();
      this.cascades.length = 0;
      return;
    }
    if (this.casters.length === 0 || this.frame % RESCAN_INTERVAL === 0) this.collectCasters(scene);
    this.updateCascades(scene);

    const nCascades = this.cascades.length;
    let culled = 0;
    let cascadeSaved = 0;
    for (const c of this.casters) {
      if (c.mesh.parent === null) continue;
      // Somebody else wrote castShadow since we last touched it — that is their
      // intent, and it wins. See the Caster interface.
      if (c.mesh.castShadow !== c.applied) c.want = c.mesh.castShadow;
      if (!c.want) { c.base = false; c.maxCascade = 0; continue; }

      _pos.setFromMatrixPosition(c.mesh.matrixWorld);
      const r = c.radius + SHADOW_TEST_SLACK;
      _sphere.center.copy(_pos);
      _sphere.radius = r;

      // THE WHOLE SWEPT VOLUME, as one conservative box — not samples along it.
      //
      // This started life as two sphere samples at half and full run-out, and
      // it was WRONG in a way that only a picture caught: at the `street`
      // pose it dropped a caster whose long shadow crossed the near
      // foreground between the two samples, and the ablation's block diff
      // came back at blockMax 17.4 against a 3.0 noise floor. A shadow is a
      // swept solid, so the test has to be against the solid.
      //
      // `t` is the length ALONG THE LIGHT RAY needed to fall by the caster's
      // height; the horizontal component of that is what SHADOW_RUNOUT_MAX
      // caps. The AABB of the segment, grown by the caster's radius, contains
      // the shadow for any sun azimuth, and `Frustum.intersectsBox` is itself
      // conservative — so the two errors both point the safe way.
      //
      // It is now built for EVERY caster and not only for the ones that failed
      // the sphere test, because the per-cascade assignment below needs the same
      // solid: the question "which maps can see this shadow" is asked of the
      // shadow, not of the object.
      const runHoriz = THREE.MathUtils.clamp(
        c.height * this.shadowCot, SHADOW_RUNOUT_MIN, SHADOW_RUNOUT_MAX);
      const t = runHoriz > 0 ? runHoriz / Math.max(1e-3, Math.sqrt(1 - _sunDir.y * _sunDir.y)) : 0;
      _pos2.copy(_pos).addScaledVector(_sunDir, -t);
      _box.makeEmpty();
      _box.expandByPoint(_pos);
      _box.expandByPoint(_pos2);
      _box.expandByScalar(r);

      const relevant = !this.shadowCulling
        || _frustum.intersectsSphere(_sphere)
        || _frustum.intersectsBox(_box);

      c.base = relevant;
      if (nCascades > 0) {
        // A SECOND, TIGHTER swept box for the cascade question. See
        // CASCADE_RELIEF_PAD for why it is not the one above.
        const cascRun = Math.min(c.height * this.shadowCot, SHADOW_RUNOUT_MAX);
        const ct = cascRun > 0
          ? cascRun / Math.max(1e-3, Math.sqrt(1 - _sunDir.y * _sunDir.y)) : 0;
        _pos2.copy(_pos).addScaledVector(_sunDir, -ct);
        _boxB.makeEmpty();
        _boxB.expandByPoint(_pos);
        _boxB.expandByPoint(_pos2);
        _boxB.expandByScalar(c.radius + CASCADE_RELIEF_PAD);
        c.maxCascade = this.cascadeFor(_boxB);
        // Only the casters that are actually DRAWN can be saved, and only from
        // the cascades they would otherwise have been drawn into. Hidden meshes
        // are excluded because three skips them anyway — counting them was how
        // the first version of this statistic reported 158 draws saved on a
        // frame where the measured shadow count did not move at all.
        if (relevant && this.isDrawn(c.mesh)) cascadeSaved += nCascades - 1 - c.maxCascade;
      } else {
        c.maxCascade = 0;
      }

      if (!relevant) culled++;
      if (c.mesh.castShadow !== relevant) c.mesh.castShadow = relevant;
      c.applied = relevant;
    }
    this.stats.castersCulled = culled;
    this.stats.cascades = nCascades;
    this.stats.cascadeSaved = cascadeSaved;
  }

  /**
   * Rebuilds the caster list.
   *
   * Radius and height come from the geometry's own bounding box scaled by the
   * world matrix, not from `Box3.setFromObject`, because that walks children and
   * we are already walking. Height is measured from the mesh ORIGIN upward,
   * which is what a shadow's length actually depends on — a 30 m mast whose
   * origin is at its base throws 30 m worth of shadow, and one whose origin is
   * at its centre would read as 15 m if we used the radius instead.
   */
  private collectCasters(scene: THREE.Scene): void {
    this.casters.length = 0;
    scene.updateMatrixWorld(false);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && !(o as unknown as { isPoints?: boolean }).isPoints) return;

      // A record we already hold outranks whatever `castShadow` currently says,
      // because what it currently says may well be something WE wrote. See
      // casterIndex for the leak this replaced.
      const known = this.casterIndex.get(o);
      if (known !== undefined) { this.casters.push(known); return; }

      // Only now is `castShadow` evidence of anything: an object we have never
      // touched and that is not casting has been told not to by its owner.
      if (!o.castShadow) return;
      const g = mesh.geometry;
      if (g === undefined || g === null) return;
      if (g.boundingBox === null) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (bb === null) return;
      // Uniform-ish scale is the common case here; take the largest axis so the
      // sphere can only ever be too big, never too small.
      _v.setFromMatrixScale(mesh.matrixWorld);
      const scale = Math.max(_v.x, _v.y, _v.z);
      bb.getSize(_v);
      const radius = 0.5 * _v.length() * scale;
      if (radius > SHADOW_CULL_MAX_RADIUS) return;
      const inst = o as unknown as { isInstancedMesh?: boolean; boundingSphere?: THREE.Sphere | null };
      let rec: Caster;
      if (inst.isInstancedMesh === true) {
        // An InstancedMesh's instances are spread over the map, so the geometry
        // box is the wrong extent entirely. three keeps a real one; use it, and
        // skip the mesh if it is larger than the cull threshold.
        if (inst.boundingSphere === null || inst.boundingSphere === undefined) {
          (o as unknown as { computeBoundingSphere(): void }).computeBoundingSphere();
        }
        const bs = inst.boundingSphere;
        if (bs === null || bs === undefined || bs.radius > SHADOW_CULL_MAX_RADIUS) return;
        rec = { mesh: o, radius: bs.radius, height: bs.radius, want: true, applied: true,
          base: true, maxCascade: 0 };
      } else {
        rec = {
          mesh: o,
          // `bb.max.y` measures the geometry's top above the MESH ORIGIN, which
          // is what a shadow's length depends on — but a structure builder that
          // bakes piece transforms into the geometry leaves a slab whose origin
          // sits at its own top reads 0.5 m and would be padded by almost
          // nothing. Floored at the bounding radius, which is never an
          // underestimate of the extent and only ever keeps casters we might
          // otherwise have dropped.
          radius,
          height: Math.max(bb.max.y * scale, radius),
          want: true,
          applied: true,
          base: true,
          maxCascade: 0,
        };
      }
      this.casterIndex.set(o, rec);
      this.casters.push(rec);
    });
    this.stats.casters = this.casters.length;
  }

  private restoreCasters(): void {
    // A per-cascade assignment left standing would be restored as though it were
    // the owning subsystem's intent, which is how a caster stops casting
    // permanently. Undo it first.
    this.endCascades();
    for (const c of this.casters) {
      // Only put back what we took: if `castShadow` no longer matches what we
      // last wrote, somebody else owns it now and their value stands.
      if (c.mesh.castShadow === c.applied) c.mesh.castShadow = c.want;
      c.applied = c.want;
      c.base = c.want;
    }
    this.casters.length = 0;
    this.stats.casters = 0;
    this.stats.castersCulled = 0;
    this.stats.cascades = 0;
    this.stats.cascadeSaved = 0;
  }

  // ── static batching and group discovery ───────────────────────────────────

  /**
   * Owns the settle/audit/rescan cadence that BOTH merge mechanisms run on.
   *
   * They share it deliberately: both are baking world transforms into vertices,
   * both are only legal while their sources are still, and both therefore need
   * the same two things — a settle long enough for the colony to stop being
   * built, and a rolling audit that dissolves the moment a source moves.
   */
  private updateStatic(scene: THREE.Scene, opts: DrawBudgetOptions): void {
    if (!this.batching && this.batches.length > 0) this.dissolveBatches();
    if (!this.grouping && this.groups.some((g) => g.auto)) this.dissolveAutoGroups();
    if (!this.batching && !this.grouping) return;

    // Rolling guard. See the safety-model note in the header: this is what makes
    // baking world transforms into vertices a legal thing to do at all.
    if (this.frame % AUDIT_INTERVAL === 0) {
      if (this.batches.length > 0) this.audit();
      if (this.groups.length > 0) this.auditGroups();
    }

    // `baked` and not `batches.length`, and the distinction is a bug this file
    // once shipped: a rebuild that legitimately finds NOTHING to merge — which
    // is the right answer for a scene whose subsystems have already instanced
    // everything — leaves the batch list empty, and a "have we baked yet" test
    // written as `batches.length === 0` therefore says no, forever. It
    // re-merged the whole scene on every single frame and hit the MAX_REBUILDS
    // backstop within a couple of seconds.
    if (!this.baked) {
      if (this.settleAt < 0) {
        this.settleAt = this.frame + SETTLE_FRAMES;
        this.lastMeshCount = countMeshes(scene, this.container, this.fault);
        // The other half of the settle, and the half that was missing: record
        // where every mesh IS, so the bake can require it to still be there.
        this.snapshotStillness(scene);
        return;
      }
      // ── A HELD WORLD HAS ALREADY PROVED IT HOLDS STILL ────────────────────
      //
      // SETTLE_FRAMES exists to watch the colony for long enough to be sure
      // nothing is mid-construction before baking world transforms into shared
      // vertex buffers. Under `__freeze` the simulation is not advancing at all,
      // so the window is spent waiting for a world that cannot move — and the
      // wait is counted in FRAMES while every harness settles in MILLISECONDS,
      // which makes "has it finished settling when the shutter opens" a question
      // about how fast this machine happens to be rendering.
      //
      // MEASURED before this, on the held title screen at `?scaler=off&
      // quality=high`, headless ANGLE at ~30 fps: scene object count, matrix
      // hash and visible-mesh set were STILL CHANGING 3.7 s into the hold — the
      // bake landing, hiding its sources, which moved the lighting rig's
      // `:glow` discovery, which re-seated the real light pool. The standard
      // recipe's 3000 ms settle shuttered in the middle of that chain and the
      // first two frames of a three-frame capture differed by mean |delta|
      // 0.0014 / max 7. At 60 fps the same 3000 ms would have covered it, which
      // is the tell that it was a race and not a constant.
      //
      // The stillness snapshot taken one frame ago is not weakened by this: it
      // is compared against a world that has not been stepped since, so every
      // member is 'still' for a real reason rather than by assumption.
      // The `bake-settle-race` probe fault puts the frame-counted wait back
      // under the hold, which is the race described above.
      const held = opts.frozen === true && !this.fault('bake-settle-race');
      if (!held && this.frame < this.settleAt) return;
      // A colony that is still being built changes its mesh count between one
      // settle window and the next. Wait for two agreeing counts rather than
      // baking mid-construction and dissolving immediately.
      const n = countMeshes(scene, this.container, this.fault);
      if (n !== this.lastMeshCount) {
        this.lastMeshCount = n;
        this.settleAt = this.frame + SETTLE_FRAMES;
        this.snapshotStillness(scene);
        return;
      }
      this.rebuild(scene, opts);
      this.baked = true;
      this.settleAt = -1;
      return;
    }

    // Meshes appearing or disappearing (a habitat finished, a ship launched)
    // invalidates the buckets, not just one batch.
    if (this.frame % RESCAN_INTERVAL === 0) {
      const n = countMeshes(scene, this.container, this.fault);
      if (n !== this.lastMeshCount) {
        this.lastMeshCount = n;
        this.dissolveBatches();
        this.dissolveAutoGroups();
        this.baked = false;
      }
    }
  }

  /**
   * Remembers every mesh's world matrix at the start of a settle window.
   *
   * A WeakMap keyed on the mesh, so a mesh that goes away takes its record with
   * it and nothing here holds the scene alive. `Float32Array(16)` per candidate
   * mesh is ~11 KB for the mature colony, allocated once per settle and not per
   * frame.
   */
  private snapshotStillness(scene: THREE.Scene): void {
    scene.updateMatrixWorld(false);
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let rec = this.stillness.get(o);
      if (rec === undefined) { rec = new Float32Array(16); this.stillness.set(o, rec); }
      rec.set(mesh.matrixWorld.elements);
    });
  }

  /**
   * Did this mesh hold still across the settle window?
   *
   * THREE ANSWERS, NOT TWO, and the third is the one that matters. A mesh that
   * appeared after the snapshot was taken is UNKNOWN, not moving: it is left out
   * of this bake and offered again next time. Collapsing unknown into moving
   * would quarantine it permanently, and quarantine is for life — one reseed
   * whose mesh count happened to match the previous one would silently exclude
   * the entire colony from every bake for the rest of the session.
   */
  private stillnessOf(mesh: THREE.Object3D): 'still' | 'moved' | 'unknown' {
    const rec = this.stillness.get(mesh);
    if (rec === undefined) return 'unknown';
    const e = mesh.matrixWorld.elements;
    for (let k = 0; k < 16; k++) if (Math.abs(e[k]! - rec[k]!) > 1e-5) return 'moved';
    return 'still';
  }

  /**
   * Walks the scene, buckets every static mesh by what it would have to share
   * with its neighbours to be merged with them, and bakes each bucket.
   */
  private rebuild(scene: THREE.Scene, _opts: DrawBudgetOptions): void {
    // Before discovery, not after: the group bakes are parented into this
    // container too, because they are authored around a world position and
    // parenting them under a node with its own transform would apply it twice.
    this.ensureContainer(scene);
    if (this.grouping) this.discoverGroups(scene);
    if (!this.batching) return;
    this.dissolveBatches();
    this.rebuilds++;
    if (this.rebuilds > MAX_REBUILDS) {
      // Said once, loudly, and then never again. See MAX_REBUILDS.
      if (this.rebuilds === MAX_REBUILDS + 1) {
        console.warn('[drawbudget] static batching gave up after ' + MAX_REBUILDS
          + ' rebuilds — the scene keeps changing under the bake. Draw calls will be higher.');
      }
      this.batching = false;
      return;
    }

    const container = this.ensureContainer(scene);
    const buckets = new Map<string, THREE.Mesh[]>();

    scene.updateMatrixWorld(false);
    scene.traverseVisible((o) => {
      if (o === container) return;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (this.quarantine.has(mesh)) return;
      if (!isBatchable(mesh)) return;
      const key = bucketKey(mesh);
      if (key === null) return;
      const list = buckets.get(key);
      if (list === undefined) buckets.set(key, [mesh]);
      else list.push(mesh);
    });

    this.totalVerts = 0;
    for (const list of buckets.values()) {
      if (list.length < MIN_BATCH_MEMBERS) continue;
      for (const cell of spatialSplit(list)) {
        if (cell.length < MIN_BATCH_MEMBERS) continue;
        this.bakeBatch(container, cell);
        if (this.totalVerts >= MAX_TOTAL_VERTS) return;
      }
    }
  }

  /**
   * Bakes one set of same-material meshes into a single mesh.
   *
   * The merged geometry is authored relative to the members' shared centroid
   * rather than to the world origin, and the batch mesh is placed at that
   * centroid. Float32 has ~7 significant digits, so a vertex a kilometre from
   * the origin resolves to about 0.06 mm — fine on its own, but the normals and
   * the chamfers an art direction depends on ("every edge chamfered
   * 8-25 mm") are built out of differences between such numbers, and differences
   * are where the digits actually go missing.
   */
  private bakeBatch(container: THREE.Group, members: THREE.Mesh[]): void {
    const first = members[0]!;
    let verts = 0;
    let indices = 0;
    for (const m of members) {
      const g = m.geometry;
      verts += g.attributes.position!.count;
      indices += g.index !== null ? g.index.count : 0;
    }
    if (verts > MAX_BATCH_VERTS) {
      // Split rather than skip: one oversized bucket must not cost us the
      // saving on the rest of it.
      const half = Math.max(MIN_BATCH_MEMBERS, members.length >> 1);
      if (members.length > MIN_BATCH_MEMBERS * 2) {
        this.bakeBatch(container, members.slice(0, half));
        this.bakeBatch(container, members.slice(half));
      }
      return;
    }

    _box.makeEmpty();
    for (const m of members) _box.expandByPoint(_v.setFromMatrixPosition(m.matrixWorld));
    const origin = _box.getCenter(new THREE.Vector3());

    const geo = mergeStatic(members, origin, verts, indices);
    if (geo === null) return;

    const mesh = new THREE.Mesh(geo, first.material as THREE.Material);
    mesh.name = 'batch:' + (first.name || 'mesh') + ':' + members.length;
    mesh.position.copy(origin);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.updateMatrixWorld(true);
    // Selection and the build placer raycast the scene for the object under the
    // cursor. The source meshes stay raycastable — three's Raycaster does not
    // test `visible` — so hiding them costs nothing there, but a hit on this
    // merged stand-in would resolve to no building at all. Take it out of the
    // ray entirely rather than teaching every consumer about it.
    mesh.raycast = noRaycast;

    const matrices = new Float32Array(members.length * 16);
    for (let i = 0; i < members.length; i++) {
      matrices.set(members[i]!.matrixWorld.elements, i * 16);
      members[i]!.visible = false;
    }

    // Ours. See `countMeshes` — counting our own output as scene meshes is what
    // made the rescan dissolve and re-bake for ever.
    markOwned(mesh);
    container.add(mesh);
    this.batches.push({ mesh, members, matrices, parent: container });
    this.totalVerts += verts;
  }

  /**
   * Re-checks the assumption every batch is standing on.
   *
   * A member that moved, or that somebody made visible again, means the batch is
   * now drawing a stale copy of it and hiding the live one. Dissolve that batch
   * and let the next rebuild pick the survivors up again — self-healing rather
   * than a coordination protocol nobody would remember to follow.
   */
  private audit(): void {
    let anyStale = false;
    for (let b = this.batches.length - 1; b >= 0; b--) {
      const batch = this.batches[b]!;
      let stale = false;
      for (let i = 0; i < batch.members.length; i++) {
        const m = batch.members[i]!;
        let bad = m.visible || m.parent === null;
        if (!bad) {
          const e = m.matrixWorld.elements;
          const o = i * 16;
          for (let k = 0; k < 16; k++) {
            if (Math.abs(e[k]! - batch.matrices[o + k]!) > 1e-5) { bad = true; break; }
          }
        }
        // Note this does NOT break on the first offender: the whole point of
        // the sweep is to name every one of them for the quarantine, so the
        // rebuild after this one does not bake the same mistake again.
        if (bad) { stale = true; this.quarantine.add(m); }
      }
      if (stale) {
        this.dissolveBatch(b);
        this.dissolves++;
        anyStale = true;
      }
    }
    if (!anyStale) return;
    // Stand the WHOLE set down, not just the offending batch. Everything in a
    // bucket tends to move together (a farm of solar trackers, not one), and
    // leaving survivors standing would block the rebuild below — which only
    // runs from a clean slate — so the quarantine we just filled in would never
    // be applied and the same batch would be re-baked on the next rescan.
    this.dissolveBatches();
    this.baked = false;
    this.settleAt = -1;
  }

  // ── group discovery ───────────────────────────────────────────────────────

  /**
   * Finds the nodes in the scene graph that are already "one thing" and
   * registers each of them as a group.
   *
   * WHY THIS EXISTS AT ALL. The registration API below it has been complete
   * since the file was written and had ZERO call sites in the game — an export
   * nothing calls, and the test for that ("grep for the CALL SITE, not the
   * export") returns nothing for `registerDrawGroup`. Rather than wait for nine
   * parallel subsystems to each remember to call us, we read the graph they
   * already built.
   *
   * THE RULE IS ONE LINE: descend until a node is small enough to be worth one
   * bounding sphere, then take it. See GROUP_MAX_RADIUS for what that lands on
   * and, more importantly, for what it walks past — terrain chunks and agents
   * are excluded by the shape of the graph rather than by a name test, which is
   * what keeps this from being a list of magic strings that goes stale the first
   * time somebody renames a node.
   */
  private discoverGroups(scene: THREE.Scene): void {
    scene.updateMatrixWorld(false);
    const container = this.container;
    const consider = (o: THREE.Object3D, depth: number): void => {
      if (o === container) return;
      if (this.groupSeen.has(o)) return;
      // Anything under a THREE.LOD has its visibility rewritten every frame by
      // the LOD's own distance test; a bake underneath one fights it. Same
      // reasoning as isBatchable's clause, arrived at from the top down.
      if ((o as unknown as { isLOD?: boolean }).isLOD === true) return;
      // Already registered — by us on an earlier pass, or by a subsystem that
      // was explicit. Either way it is spoken for.
      if (this.groups.some((g) => g.def.object === o)) return;
      // A leaf mesh is not a group; nothing below it to merge.
      if ((o as THREE.Mesh).isMesh && o.children.length === 0) return;

      let members = 0;
      _box.makeEmpty();
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        if (this.isProxyable(m)) members++;
        const g = m.geometry;
        if (g === undefined || g === null) return;
        if (g.boundingBox === null) g.computeBoundingBox();
        if (g.boundingBox === null) return;
        _boxB.copy(g.boundingBox).applyMatrix4(m.matrixWorld);
        _box.union(_boxB);
      });
      if (members < GROUP_MIN_MEMBERS) {
        // Not enough here — but a CHILD may still be a group, which is how
        // `structures` gets walked through to its buildings. Descend anyway; the
        // radius test below is what stops us, not this one.
        if (depth < 6) for (const c of o.children) consider(c, depth + 1);
        return;
      }
      const radius = _box.isEmpty() ? Infinity : _box.getSize(_v).length() * 0.5;
      if (radius > GROUP_MAX_RADIUS) {
        if (depth < 6) for (const c of o.children) consider(c, depth + 1);
        return;
      }
      const height = _box.isEmpty() ? radius : Math.max(1, _box.max.y - _box.min.y);
      this.groupSeen.add(o);
      this.register({ object: o, detail: [], radius, height }, true);
    };
    for (const c of scene.children) consider(c, 0);
  }

  /**
   * Can this mesh's shadow be delegated to a merged, positions-only proxy?
   *
   * Every clause is a way in which the mesh's shadow depends on something other
   * than the positions of its triangles, and so a way in which merging would
   * change the picture rather than only the draw count:
   *
   *  - instanced / skinned / morphed: the transform is not in the matrix.
   *  - a material array: the shadow is drawn per geometry group, and the groups
   *    can have different alpha behaviour.
   *  - transparent, alpha-tested or alpha-mapped: three's depth material samples
   *    the alpha map and discards, so the shadow has holes in it that a bare
   *    position buffer cannot reproduce. A lattice dome is exactly this.
   *  - a displacement map: the depth material displaces along the normal, and we
   *    are dropping the normals.
   *  - `side` other than the default, or an explicit `shadowSide`: three picks
   *    which faces go into the shadow map from these, and getting it wrong
   *    moves the recorded depth by the object's own thickness — which on hard
   *    shadows with zero constant bias is acne or peter-panning, not a
   *    subtlety.
   *  - `frustumCulled === false`: the author has said "always draw this".
   *  - its own `onBeforeRender`: hidden meshes stop firing it.
   *
   * A THREE.LOD IS NOT AN EXCLUSION HERE, AND THAT IS WHERE MOST OF THE WIN IS.
   * The batcher excludes anything under an LOD because it would be fighting the
   * LOD for the `visible` flag — but a shadow proxy never touches `visible`, it
   * takes `castShadow`, which THREE.LOD does not write. So the proxy merges the
   * LOD's level-0 meshes and every level of that LOD stops casting: the shadow
   * is always full detail, one draw call, whichever level the LOD happens to be
   * showing. Measured on `mature`, 30 of the 137 visible casters — the landing
   * pad's 12, the spires' 8, the masts' 6, the hub dome and the comms tower —
   * live under an LOD and were unreachable by every earlier version of this
   * file. Only level 0 is merged; `lodRoleOf` is what tells them apart.
   */
  private isProxyable(mesh: THREE.Mesh): boolean {
    if (this.quarantine.has(mesh)) return false;
    if (!mesh.castShadow) return false;
    // `visible` is checked for a mesh nobody else owns; an LOD's levels are
    // hidden and shown by the LOD every frame, so their current state says
    // nothing about whether they are part of the object.
    if (lodRoleOf(mesh) === 'none' && !mesh.visible) return false;
    if (lodRoleOf(mesh) === 'other') return false;
    if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return false;
    if ((mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return false;
    if ((mesh as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false;
    if (Array.isArray(mesh.material)) return false;
    if (!mesh.frustumCulled) return false;
    if (Object.prototype.hasOwnProperty.call(mesh, 'onBeforeRender')) return false;
    const m = mesh.material as THREE.Material & {
      alphaMap?: unknown; displacementMap?: unknown; shadowSide?: number | null;
    };
    if (m === undefined || m === null || !m.visible) return false;
    if (m.transparent) return false;
    if (m.alphaTest > 0) return false;
    if (m.alphaMap !== undefined && m.alphaMap !== null) return false;
    if (m.displacementMap !== undefined && m.displacementMap !== null) return false;
    if (m.side !== THREE.FrontSide) return false;
    if (m.shadowSide !== undefined && m.shadowSide !== null) return false;
    const g = mesh.geometry;
    if (g === undefined || g === null) return false;
    if (g.attributes.position === undefined) return false;
    if (g.morphAttributes !== undefined && Object.keys(g.morphAttributes).length > 0) return false;
    if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
    return true;
  }

  // ── LOD and shadow relevance for registered groups ────────────────────────

  private updateGroups(camera: THREE.PerspectiveCamera, opts: DrawBudgetOptions): void {
    if (this.groups.length === 0) return;

    const swap = opts.lodSwap;
    const keep = opts.lodKeep;

    let far = 0;
    let uncast = 0;
    let proxies = 0;
    let proxied = 0;
    let bakeSaved = 0;
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i]!;
      if (g.def.object.parent === null) {
        // The group's node left the graph — a habitat demolished, a ship
        // launched, a scenario reseeded.
        //
        // RESTORE BEFORE DROPPING, and this was learned by measurement: the first
        // version spliced the record straight out, which left the far-LOD merges
        // parented in the batch container with nobody holding a handle to them.
        // They accumulated at four meshes per reseed — visible in the capture as
        // `draw-budget-batches` growing 4, 8, 12, 16, 20, 22 across a six-
        // scenario sweep — and every one of them was still being submitted.
        if (g.auto) { this.restoreGroup(g); this.groups.splice(i, 1); continue; }
        continue;
      }
      if (!g.tried) this.bakeGroup(g);
      const imp = g.proxy;
      if (imp === null) continue;
      proxies++;
      proxied += g.members.length;

      g.def.object.getWorldPosition(_pos);
      const d = _pos.distanceTo(camera.position);

      // --- level of detail ---------------------------------------------------
      // Hysteresis: a group sitting exactly on the threshold would otherwise
      // flip between N meshes and a handful on every frame the camera breathes.
      const near = g.bakes.length === 0 || !this.groupLod
        ? true
        : (g.near ? d < swap : d < keep);
      if (near !== g.near) {
        g.near = near;
        for (const n of g.visOwned) n.visible = near;
        for (const b of g.bakes) b.visible = !near;
      }
      if (!near) { far++; bakeSaved += g.visOwned.length - g.bakes.length; }

      // --- shadow relevance --------------------------------------------------
      // Runs on the proxy in both states: it is the group's only caster.
      //
      // The size test is DERIVED from the group's own run-out and the camera's
      // field of view rather than compared against a distance — see
      // SHADOW_MIN_FRAME_FRAC for the inversion that a flat distance produced.
      // `frameAtUnit` is the world height one metre in front of the camera
      // spans, so `runOut / d` over it is the fraction of frame height the
      // shadow covers.
      const runOut = Math.min(g.height * this.shadowCot, SHADOW_RUNOUT_MAX);
      const frameAtUnit = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
      let cast = opts.shadows && this.shadowCot > 0 && d < this.shadowMaxAbs
        && (d < 1e-3 || runOut / (d * frameAtUnit) > SHADOW_MIN_FRAME_FRAC);
      if (cast) {
        _sphere.center.copy(_pos);
        _sphere.radius = g.radius + SHADOW_TEST_SLACK;
        cast = _frustum.intersectsSphere(_sphere);
        if (!cast) {
          // Not visible itself — but its SHADOW may still be. `shadowCot` is a
          // ratio, so it only becomes a distance once multiplied by the group's
          // HEIGHT: at 11 deg of sun elevation a 20 m habitat lays 103 m of
          // shadow, so an object a hundred metres off the left of frame is
          // still painting the picture.
          const runHoriz = THREE.MathUtils.clamp(
            g.height * this.shadowCot, SHADOW_RUNOUT_MIN, SHADOW_RUNOUT_MAX);
          const t = runHoriz / Math.max(1e-3, Math.sqrt(1 - _sunDir.y * _sunDir.y));
          _pos2.copy(_pos).addScaledVector(_sunDir, -t);
          // Swept box, for the reason spelled out in updateShadowCulling: a
          // shadow is a solid and a point sample at its tip misses everything
          // that lands between the caster and there.
          _box.makeEmpty();
          _box.expandByPoint(_pos);
          _box.expandByPoint(_pos2);
          _box.expandByScalar(g.radius + SHADOW_TEST_SLACK);
          cast = _frustum.intersectsBox(_box);
        }
      }
      if (cast !== g.casting) {
        g.casting = cast;
        imp.castShadow = cast;
      }
      if (!cast) uncast++;
    }

    this.stats.groupsFar = far;
    this.stats.groupsUncast = uncast;
    this.stats.proxies = proxies;
    this.stats.proxied = proxied;
    this.stats.proxySaved = Math.max(0, proxied - proxies);
    this.stats.bakeSaved = bakeSaved;
  }

  /**
   * Builds a group's shadow proxy and its far-LOD colour merges.
   *
   * `tried` is set whatever the outcome, including "there was nothing here" —
   * the same distinction the batcher's `baked` flag exists for. Without it a
   * group that legitimately has nothing to merge is re-surveyed on every frame
   * forever.
   */
  private bakeGroup(g: Group): void {
    g.tried = true;
    const root = g.def.object;
    root.updateMatrixWorld(true);

    // Members: everything under the node whose shadow a merged positions buffer
    // can stand in for, and which held still across the settle window.
    const members: THREE.Mesh[] = [];
    if (g.def.detail.length > 0) {
      for (const n of g.def.detail) {
        const m = n as THREE.Mesh;
        if (m.isMesh && this.isProxyable(m)) members.push(m);
      }
    } else {
      root.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        if (m === g.proxy) return;
        if (!this.isProxyable(m)) return;
        members.push(m);
      });
    }
    // The stillness gate. A member that MOVED across the settle window is never
    // offered again; one we have never seen is simply not baked this time.
    for (let i = members.length - 1; i >= 0; i--) {
      const verdict = this.stillnessOf(members[i]!);
      if (verdict === 'still') continue;
      if (verdict === 'moved') this.quarantine.add(members[i]!);
      members.splice(i, 1);
    }
    if (members.length < GROUP_MIN_MEMBERS) return;
    if (this.groupVerts >= GROUP_TOTAL_VERTS) return;

    // --- the shadow proxy ----------------------------------------------------
    _mat2.copy(root.matrixWorld).invert();
    const proxyGeo = mergePositions(members, _mat2, GROUP_MAX_VERTS);
    if (proxyGeo === null) return;

    const mat = this.proxyMaterial();
    const proxy = new THREE.Mesh(proxyGeo, mat);
    proxy.name = 'shadow-proxy:' + (root.name || 'group');
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    // Last in whatever queue it lands in, on the frames it lands in one at all.
    proxy.renderOrder = 4;
    proxy.raycast = noRaycast;
    proxy.matrixAutoUpdate = false;
    proxy.updateMatrix();
    // Ours, and NOT in the container — see `markOwned`. This is the half a
    // parentage test would have missed.
    markOwned(proxy);
    root.add(proxy);
    proxy.updateMatrixWorld(true);

    g.proxy = proxy;
    g.proxyMat = mat;
    g.members = members;
    g.visOwned = members.filter((m) => lodRoleOf(m) === 'none');
    g.castTaken.length = 0;
    for (const m of members) { m.castShadow = false; g.castTaken.push(m); }
    // Every OTHER level of an LOD we took level 0 from has to stop casting too,
    // or the frame holds two shadows of the same object — the proxy's, and
    // whichever level the LOD is currently showing.
    const lods = new Set<THREE.Object3D>();
    for (const m of members) {
      const lod = lodAbove(m);
      if (lod !== null) lods.add(lod);
    }
    for (const lod of lods) {
      lod.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh || !m.castShadow) return;
        m.castShadow = false;
        g.castTaken.push(m);
      });
    }

    // Record each member's matrix RELATIVE to the root, which is the invariant
    // the bake actually rests on: the group is free to be moved as a whole.
    g.matrices = new Float32Array(members.length * 16);
    for (let i = 0; i < members.length; i++) {
      _mat3.multiplyMatrices(_mat2, members[i]!.matrixWorld);
      g.matrices.set(_mat3.elements, i * 16);
    }
    this.groupVerts += proxyGeo.attributes.position!.count;

    // --- the far-LOD colour merges ------------------------------------------
    // Same members, bucketed by the signature two meshes must share to be drawn
    // with one call, and merged per bucket. A bucket of one is not worth a mesh:
    // it would be the same draw call under a different name.
    // Built from `visOwned` and not `members`: an LOD's levels have their
    // visibility rewritten every frame by the LOD itself, so hiding one for a
    // colour bake is a fight we would lose within a frame.
    const buckets = new Map<string, THREE.Mesh[]>();
    if (g.visOwned.length < GROUP_MIN_MEMBERS) return;
    for (const m of g.visOwned) {
      if (!isBatchable(m)) continue;
      const key = bucketKey(m);
      if (key === null) continue;
      const list = buckets.get(key);
      if (list === undefined) buckets.set(key, [m]);
      else list.push(m);
    }
    let covered = 0;
    for (const list of buckets.values()) covered += list.length;
    // Only worth standing up if the merge is a real reduction AND it covers
    // every member — a partial cover would need the uncovered ones left visible,
    // which is a second visibility owner for the same group and the exact
    // "two systems own the same volume" bug.
    if (covered !== g.visOwned.length || buckets.size >= g.visOwned.length) return;

    let verts = 0;
    for (const m of g.visOwned) verts += m.geometry.attributes.position!.count;
    if (verts > GROUP_MAX_VERTS) return;

    const origin = new THREE.Vector3();
    root.getWorldPosition(origin);
    for (const list of buckets.values()) {
      let v = 0;
      let idx = 0;
      for (const m of list) {
        v += m.geometry.attributes.position!.count;
        idx += m.geometry.index !== null ? m.geometry.index.count : 0;
      }
      const geo = mergeStatic(list, origin, v, idx);
      if (geo === null) { this.dropBakes(g); return; }
      const mesh = new THREE.Mesh(geo, list[0]!.material as THREE.Material);
      mesh.name = 'group-bake:' + (root.name || 'group');
      // The merge is authored around the ROOT's world position, so the mesh has
      // to sit there in world space. Parenting it to the root and zeroing its
      // local transform only works while the root's own transform is identity,
      // which is not something we get to assume — so it goes in the batch
      // container at the world position instead. `modelMatrix * position` still
      // evaluates to exactly the world position the unmerged mesh produced,
      // which is what any merge has to preserve.
      mesh.position.copy(origin);
      mesh.castShadow = false;
      mesh.receiveShadow = list[0]!.receiveShadow;
      mesh.renderOrder = list[0]!.renderOrder;
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      mesh.raycast = noRaycast;
      mesh.visible = false;
      const parent = this.container ?? root;
      // Ours. Note the `?? root` above: these do not always land in the
      // container either, which is the second reason `countMeshes` marks rather
      // than tests parentage.
      markOwned(mesh);
      parent.add(mesh);
      g.bakes.push(mesh);
      this.groupVerts += v;
    }
  }

  /**
   * The one material every auto-discovered shadow proxy wears.
   *
   * SHARED ON PURPOSE, for three reasons that all point the same way: one
   * program in the cache however many proxies exist, one boolean write per
   * shadow pass rather than one per proxy, and one place for the fallback when
   * the renderer cannot arm the hook.
   *
   * `MeshBasicMaterial` and not a clone of anything: the shadow pass replaces it
   * with a depth material regardless, and a basic material's depth variant reads
   * `position` and nothing else — which is the whole reason the proxy geometry
   * can be positions-only. `colorWrite`/`depthWrite` off are the second line of
   * defence: if this material is ever visible in the colour pass, whether from
   * the fallback or from a leaked flag, it costs a draw call and paints nothing.
   */
  private proxyMaterial(): THREE.Material {
    if (this.sharedProxyMat !== null) return this.sharedProxyMat;
    const m = new THREE.MeshBasicMaterial();
    m.name = 'drawbudget:shadow-proxy';
    m.colorWrite = false;
    m.depthWrite = false;
    m.visible = !this.shadowHookArmed;
    registerPrewarm(m, { label: 'drawbudget-shadow-proxy' });
    this.sharedProxyMat = m;
    return m;
  }

  /**
   * Re-checks the assumption every group bake is standing on.
   *
   * Same contract as the batch audit: a member that moved relative to its root,
   * left the graph, or had its visibility written by somebody else means the
   * proxy is now casting a shape that is not there. Dissolve, quarantine the
   * offender so the next discovery does not bake it again, and let the group
   * come back without it.
   */
  private auditGroups(): void {
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i]!;
      if (!g.auto || g.proxy === null) continue;
      const root = g.def.object;
      if (root.parent === null) { this.restoreGroup(g); this.groups.splice(i, 1); continue; }
      _mat2.copy(root.matrixWorld).invert();
      let stale = false;
      for (let k = 0; k < g.members.length; k++) {
        const m = g.members[k]!;
        let bad = m.parent === null;
        // We own the visibility of the non-LOD members while a group is
        // standing, so a disagreement THERE means a second owner has appeared.
        // An LOD level disagreeing is just the LOD doing its job.
        if (!bad && lodRoleOf(m) === 'none' && m.visible !== g.near) bad = true;
        if (!bad && m.castShadow) bad = true;
        if (!bad) {
          _mat3.multiplyMatrices(_mat2, m.matrixWorld);
          const e = _mat3.elements;
          const o = k * 16;
          for (let j = 0; j < 16; j++) {
            if (Math.abs(e[j]! - g.matrices[o + j]!) > 1e-5) { bad = true; break; }
          }
        }
        // Does NOT break on the first offender: the sweep exists to name every
        // one of them for the quarantine.
        if (bad) { stale = true; this.quarantine.add(m); }
      }
      if (!stale) continue;
      this.restoreGroup(g);
      this.groups.splice(i, 1);
      this.groupSeen.delete(root);
      this.dissolves++;
    }
  }

  // ── teardown ───────────────────────────────────────────────────────────────

  private dropBakes(g: Group): void {
    for (const b of g.bakes) {
      b.removeFromParent();
      b.geometry.dispose();
    }
    g.bakes.length = 0;
  }

  private restoreGroup(g: Group): void {
    for (const n of g.def.detail) n.visible = true;
    // Only what we hid. An LOD level put back visible would be a second owner
    // writing the flag, and the LOD would be showing two levels at once until
    // its next update.
    for (const m of g.visOwned) m.visible = true;
    for (const m of g.castTaken) m.castShadow = true;
    g.castTaken.length = 0;
    g.members.length = 0;
    g.visOwned.length = 0;
    g.near = true;
    g.casting = true;
    this.dropBakes(g);
    // Only a proxy WE baked is ours to remove; one handed in by a subsystem
    // belongs to that subsystem. The material is shared and outlives the group.
    if (g.proxy !== null && g.def.impostor === undefined) {
      g.proxy.removeFromParent();
      g.proxy.geometry.dispose();
      g.proxy = null;
    } else if (g.proxy !== null) {
      g.proxy.castShadow = true;
      g.proxy.visible = true;
    }
    g.proxyMat = null;
    g.tried = g.def.impostor !== undefined;
  }

  private dissolveAutoGroups(): void {
    for (let i = this.groups.length - 1; i >= 0; i--) {
      const g = this.groups[i]!;
      if (!g.auto) continue;
      this.restoreGroup(g);
      this.groupSeen.delete(g.def.object);
      this.groups.splice(i, 1);
    }
    this.groupVerts = 0;
  }

  private dissolveBatch(i: number): void {
    const b = this.batches[i]!;
    for (const m of b.members) m.visible = true;
    b.mesh.removeFromParent();
    b.mesh.geometry.dispose();
    this.batches.splice(i, 1);
  }

  private dissolveBatches(): void {
    for (let i = this.batches.length - 1; i >= 0; i--) this.dissolveBatch(i);
    this.totalVerts = 0;
  }

  /** Full stand-down: everything goes back exactly as it was found. */
  dissolveAll(): void {
    this.dissolveBatches();
    this.restoreCasters();
    this.dissolveAutoGroups();
    for (const g of this.groups) this.restoreGroup(g);
    this.baked = false;
    this.settleAt = -1;
  }

  /**
   * Drops every handle WITHOUT touching the objects behind them.
   *
   * Used when the scene is replaced or the GL context is lost: the meshes may
   * already be disposed, and calling `geometry.dispose()` on a disposed
   * geometry against a dead context is how a teardown path takes the rest of the
   * frame down with it.
   */
  forget(): void {
    this.forgets++;
    this.batches.length = 0;
    this.casters.length = 0;
    this.casterIndex = new WeakMap();
    // Auto groups hold handles into the graph we are dropping. Their records go
    // WITHOUT being restored, for the same reason the batches do: the meshes
    // behind them may already be disposed.
    for (let i = this.groups.length - 1; i >= 0; i--) {
      if (this.groups[i]!.auto) this.groups.splice(i, 1);
    }
    this.groupSeen = new WeakSet();
    this.stillness = new WeakMap();
    this.groupVerts = 0;
    this.container = null;
    this.totalVerts = 0;
    this.baked = false;
    this.settleAt = -1;
    this.lastMeshCount = -1;
  }

  dispose(): void {
    this.dissolveAll();
    if (this.container !== null) this.container.removeFromParent();
    this.container = null;
    this.groups.length = 0;
    this.sharedProxyMat?.dispose();
    this.sharedProxyMat = null;
    this.scene = null;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private ensureContainer(scene: THREE.Scene): THREE.Group {
    if (this.container !== null && this.container.parent === scene) return this.container;
    const g = new THREE.Group();
    g.name = 'draw-budget-batches';
    scene.add(g);
    this.container = g;
    return g;
  }

  /**
   * Finds the key light and derives the shadow run-out from its elevation.
   *
   * DERIVED, NOT TYPED IN. The base-building game's art direction runs the sun
   * from 4 deg to 75 deg across its day cycle, and `height / tan(elevation)`
   * spans 14:1 across that range. A constant slack fitted at one elevation
   * culls correct shadows at every other one, and the failure is invisible in a
   * still — the shadow is simply not there, and nothing looks broken.
   */
  private updateSun(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    // THE BRIGHTEST SHADOW-CASTING DIRECTIONAL ABOVE THE HORIZON, not the first
    // one in the list.
    //
    // "First in scene.children" was an ordering dependency dressed up as a
    // lookup, and it stopped being safe once the lighting rig added an
    // EARTHSHINE directional with a shadow map of its own, from a completely
    // different part of the sky. Whichever of the two the loop reached first
    // decided the direction every shadow run-out below is measured along, and
    // getting that wrong culls correct shadows with nothing in any statistic to
    // say so. It happened to pick the sun — verified, the cascade table matched
    // four lights to this direction — and that was an accident of construction
    // order, not a fact anybody stated.
    //
    // Intensity is the right discriminator because it is what "key light"
    // means: 5.0 for the sun against 0.3 or so for the earthshine fill during
    // the day, and 0 for the sun once it sets, which is exactly when earthshine
    // becomes the key and its shadows become the only ones in the frame.
    let found: THREE.DirectionalLight | null = null;
    let bestScore = 0;
    for (const c of scene.children) {
      const l = c as THREE.DirectionalLight;
      if (!l.isDirectionalLight || !l.castShadow) continue;
      if (l.intensity <= 0) continue;
      _v.copy(l.position).sub(l.target.position);
      const len = _v.length();
      if (len < 1e-4) continue;
      // Below the horizon casts nothing, whatever its intensity says.
      if (_v.y / len <= 0.02) continue;
      if (l.intensity <= bestScore) continue;
      bestScore = l.intensity;
      found = l;
    }
    if (found === null) { this.shadowCot = 0; return; }
    _sunDir.copy(found.position).sub(found.target.position);
    const len = _sunDir.length();
    if (len < 1e-4) { this.shadowCot = 0; return; }
    _sunDir.multiplyScalar(1 / len);
    // sin(elevation) is the normalised direction's Y; cot follows from it.
    const sinEl = THREE.MathUtils.clamp(_sunDir.y, -1, 1);
    // Sun below the horizon: there is no sun shadow at all, and the shadow
    // relevance test must stand aside rather than cull on a meaningless
    // direction. The lighting rig already stops refreshing the cascades here,
    // so this is belt and braces on the same fact.
    if (sinEl <= 0.02) { this.shadowCot = 0; return; }
    const cosEl = Math.sqrt(Math.max(0, 1 - sinEl * sinEl));
    // A RATIO: metres of horizontal shadow per metre of caster height. Turning
    // it into a distance needs a height, and every caller supplies its own.
    this.shadowCot = cosEl / sinEl;

    // ── AND THE ABSOLUTE BACKSTOP, DERIVED FROM THE RIG RATHER THAN TYPED IN ──
    // See SHADOW_MAX_ABS. The widest ortho box among the lights that share the
    // sun's direction IS the rig's outermost cascade, read off the light
    // rather than copied from the rig's constant table. Matched on
    // direction for the same reason `updateCascades` is (CASCADE_SUN_COS): the
    // earthshine map is a box of its own from a different part of the sky and
    // folding it in would bound the sun's culling with the fill's reach.
    //
    // ── AND THE BOX IS NO LONGER CENTRED ON THE CAMERA ───────────────────────
    // The half-extent alone was a complete answer only while every cascade sat
    // on the camera's focus point, which is what SHADOW_MAX_ABS's own comment
    // assumes in as many words ("centred on the camera focus, so a caster past
    // ~1300 m from the camera is outside every shadow map the rig owns").
    // The lighting rig now lays the cascades out as DEPTH BANDS chained along
    // the view bearing, so the outermost box's centre is a few hundred metres
    // further out than the focus and its far face moves with it. Reading the
    // half-extent and stopping would cull casters that the far cascade is now
    // positioned to use, and the failure is a shadow that is simply absent.
    //
    // So take the real far face: distance from the camera to that light's own
    // target, plus its half-extent. FLOORED by the old derivation, never
    // replaced by this one — the reach can only ever grow, so a fit that puts
    // the outer band nearer than the focus cannot tighten the cull.
    let widest = 0;
    let reach = 0;
    for (const c of scene.children) {
      const l = c as THREE.DirectionalLight;
      if (!l.isDirectionalLight || !l.castShadow) continue;
      const cam = l.shadow?.camera as THREE.OrthographicCamera | undefined;
      if (cam === undefined || cam.isOrthographicCamera !== true) continue;
      _v.copy(l.position).sub(l.target.position);
      const d = _v.length();
      if (d < 1e-4) continue;
      _v.multiplyScalar(1 / d);
      if (_v.dot(_sunDir) < CASCADE_SUN_COS) continue;
      const half = (cam.right - cam.left) * 0.5;
      if (half <= widest) continue;
      widest = half;
      reach = l.target.position.distanceTo(camera.position) + half;
    }
    this.shadowMaxAbs = widest > 0
      ? Math.max(widest * SHADOW_ABS_OVER_CASCADE, reach)
      : SHADOW_MAX_ABS;
  }

  private publish(): void {
    const s = this.stats;
    s.enabled = this.enabled;
    s.batches = this.batches.length;
    let batched = 0;
    for (const b of this.batches) batched += b.members.length;
    s.batched = batched;
    s.saved = batched - this.batches.length;
    s.groups = this.groups.length;
    s.shadowHook = this.shadowHookArmed;
    if (this.groups.length === 0) {
      s.proxies = 0; s.proxied = 0; s.proxySaved = 0; s.bakeSaved = 0;
      s.groupsFar = 0; s.groupsUncast = 0;
    }
    s.shadowCot = this.shadowCot;
    s.vertices = this.totalVerts + this.groupVerts;
    s.rebuilds = this.rebuilds;
    s.dissolves = this.dissolves;
    s.forgets = this.forgets;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Free functions
// ─────────────────────────────────────────────────────────────────────────────

/** Assigned to a batch mesh so it never appears in a selection ray. */
function noRaycast(): void { /* merged stand-ins are not selectable */ }

/**
 * Where does this mesh sit relative to the nearest THREE.LOD above it?
 *
 *   'none'   — no LOD ancestor. Its visibility is nobody's but ours to take.
 *   'level0' — inside the LOD's HIGHEST-DETAIL level. This is the geometry a
 *              shadow proxy merges: it is the object's true silhouette, and a
 *              shadow map records depth, so paying full detail for it costs
 *              triangles (which are not the constraint) and saves draw calls
 *              (which are).
 *   'other'  — a coarser level. Never merged, and never drawn as a shadow
 *              either once its LOD's level 0 has been taken over — otherwise
 *              the frame would hold two shadows of the same object.
 *
 * The walk goes all the way up rather than checking the immediate parent: the
 * base-building game's structure builder puts a Group between the LOD and its
 * meshes, so a one-level check misses every one of them.
 */
function lodRoleOf(mesh: THREE.Object3D): 'none' | 'level0' | 'other' {
  let child: THREE.Object3D = mesh;
  for (let p = mesh.parent; p !== null; p = p.parent) {
    const lod = p as unknown as { isLOD?: boolean; levels?: { object: THREE.Object3D }[] };
    if (lod.isLOD === true) {
      const levels = lod.levels;
      if (levels === undefined || levels.length === 0) return 'other';
      return levels[0]!.object === child ? 'level0' : 'other';
    }
    if ((p as unknown as { isScene?: boolean }).isScene === true) break;
    child = p;
  }
  return 'none';
}

/** The nearest THREE.LOD above `mesh`, or null. */
function lodAbove(mesh: THREE.Object3D): THREE.Object3D | null {
  for (let p = mesh.parent; p !== null; p = p.parent) {
    if ((p as unknown as { isLOD?: boolean }).isLOD === true) return p;
    if ((p as unknown as { isScene?: boolean }).isScene === true) break;
  }
  return null;
}

function boundingRadius(o: THREE.Object3D): number {
  _box.setFromObject(o, true);
  if (_box.isEmpty()) return 1;
  return Math.max(1, _box.getSize(_v).length() * 0.5);
}

/**
 * Marks a mesh as one THIS FILE created, so `countMeshes` does not count our
 * own output as evidence that the scene changed.
 *
 * A flag and not a parentage test, because our meshes do not all live in one
 * place and never did: `bakeBatch` puts a batch in the container, `bakeGroup`
 * parents its shadow proxy to the GROUP'S OWN ROOT (it has to — the proxy is
 * authored in the root's space), and `group-bake:` falls back to `root` when
 * there is no container yet. Any rule based on where a mesh sits gets two of
 * those three wrong.
 */
function markOwned(mesh: THREE.Mesh): void {
  (mesh as unknown as { __drawBudgetOwned?: boolean }).__drawBudgetOwned = true;
}

function isOwned(o: THREE.Object3D): boolean {
  return (o as unknown as { __drawBudgetOwned?: boolean }).__drawBudgetOwned === true;
}

/**
 * How many meshes are in the scene that WE DID NOT PUT THERE.
 *
 * ── `return` INSIDE A `traverse` CALLBACK IS NOT A PRUNE, AND THAT IS THE BUG
 *    THAT MADE ONE GAME UNABLE TO PHOTOGRAPH A HELD FRAME ──
 *
 * `Object3D.traverse` ignores what the callback returns and descends into the
 * children regardless. So `if (o === skip) return;` dropped the container NODE
 * and counted every merged mesh underneath it — the exact opposite of what the
 * parameter is named for.
 *
 * `updateStatic`'s rescan reads this as "meshes appeared or disappeared, a
 * habitat finished or a ship launched", dissolves the whole bake and starts
 * over. But the count only changed because the bake itself landed: `settleAt`
 * records the count BEFORE `rebuild()`, and `rebuild()` then adds the merged
 * meshes. So the very next rescan always disagreed with itself, for ever, on a
 * world where nothing whatsoever had happened.
 *
 * MEASURED on the held title screen, `?scaler=off&quality=high`, one sample per
 * 800 ms with `__freeze` up — the count this function returned against the count
 * it MEANT:
 *
 *     container kids   returned   meant    rebuilds
 *              23        571       540         3
 *               0        540       540         3
 *              23        571       540         4
 *               0        540       540         4      ... and on for ever
 *
 * 571 - 540 = 31 = 23 merged meshes in the container + 8 group shadow proxies
 * parented to their own roots. `rebuilds` climbed by one every ~1.6 s and never
 * stopped; the 16 `group-bake:` meshes blinked in and out with it, which is what
 * moved the picture. It is not only a capture defect — `MAX_REBUILDS` is 32, so
 * the shipped game rebuilt its entire merged geometry set every 48 frames until
 * it hit that backstop and switched the optimisation off for the session.
 *
 * Both halves are fixed here: the container is pruned properly, AND every mesh
 * this file creates is skipped by its own mark, because the proxies never lived
 * in the container in the first place.
 */
function countMeshes(
  scene: THREE.Scene, skip: THREE.Object3D | null, fault: FaultHook,
): number {
  let n = 0;
  // The defect above, restorable on demand, so a picture probe can watch its
  // own gate go red (the `hold-leaks` fault).
  if (fault('hold-leaks')) {
    scene.traverse((o) => {
      if (o === skip) return;
      if ((o as THREE.Mesh).isMesh) n++;
    });
    return n;
  }
  const walk = (o: THREE.Object3D): void => {
    if (o === skip) return;
    if (isOwned(o)) return;
    if ((o as THREE.Mesh).isMesh) n++;
    const kids = o.children;
    for (let i = 0; i < kids.length; i++) walk(kids[i]!);
  };
  walk(scene);
  return n;
}

/**
 * Can this mesh legally be baked into a shared vertex buffer?
 *
 * Every clause is a way the merge would be WRONG rather than merely
 * unprofitable, so each is a hard exclusion:
 *
 *  - instanced / skinned / morphed: the transform lives somewhere the merge
 *    cannot reach (an instance matrix, a bone matrix, a morph target).
 *  - a material array: the mesh draws once per geometry group and the groups
 *    carry material indices the merge would have to reconcile.
 *  - an interleaved attribute: the merge writes plain typed arrays, and a
 *    silently de-interleaved copy is a different upload pattern than the author
 *    chose.
 *  - its OWN `onBeforeRender`: that hook stops firing the instant the mesh is
 *    hidden, and whatever it was keeping in sync stops being kept in sync. This
 *    is the exact "authored art bound to nothing" failure, arrived at from the
 *    other direction.
 *  - `frustumCulled === false`: the author has said this must be drawn whatever
 *    the culler thinks (a sky dome, a screen-space effect), and merging it into
 *    a batch that CAN be culled would silently take it away.
 *  - anything UNDER a `THREE.LOD`, at any depth: its visibility is already
 *    owned, per frame, by the LOD's own distance test. MEASURED — before this
 *    clause the mature scenario baked seven batches out of the mast, floodlight
 *    and spire LOD levels, the guard correctly noticed them being turned back
 *    on, and the whole set dissolved and re-baked in a loop that saved nothing.
 *    The guard was right; the bucket was wrong. Note the walk goes all the way
 *    up rather than checking the immediate parent: the base-building game's
 *    structure builder puts a Group between the LOD and its meshes, so a
 *    one-level check misses every one of them.
 */
function isBatchable(mesh: THREE.Mesh): boolean {
  if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return false;
  for (let p = mesh.parent; p !== null; p = p.parent) {
    if ((p as unknown as { isLOD?: boolean }).isLOD === true) return false;
    if ((p as unknown as { isScene?: boolean }).isScene === true) break;
  }
  if ((mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return false;
  if ((mesh as unknown as { isBatchedMesh?: boolean }).isBatchedMesh) return false;
  if (Array.isArray(mesh.material)) return false;
  if (!mesh.frustumCulled) return false;
  if (Object.prototype.hasOwnProperty.call(mesh, 'onBeforeRender')) return false;
  const g = mesh.geometry;
  if (g === undefined || g === null) return false;
  const pos = g.attributes.position as THREE.BufferAttribute | undefined;
  if (pos === undefined) return false;
  if (g.morphAttributes !== undefined && Object.keys(g.morphAttributes).length > 0) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    if ((a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return false;
    if (a.array === undefined) return false;
  }
  return true;
}

/**
 * The signature two meshes must share to be merged.
 *
 * Material IDENTITY, not equality: two materials that look the same are still
 * two programs, two uniform blocks and two binds, and merging under one of them
 * would change which one the other's geometry is drawn with. Everything else in
 * the key is a per-OBJECT property that survives into the draw call and would
 * otherwise be silently taken from whichever member happened to be first.
 */
function bucketKey(mesh: THREE.Mesh): string | null {
  const g = mesh.geometry;
  const m = mesh.material as THREE.Material;
  if (m === undefined || m === null) return null;
  const names = Object.keys(g.attributes).sort();
  let sig = '';
  for (const n of names) {
    const a = g.attributes[n] as THREE.BufferAttribute;
    sig += n + a.itemSize + (a.normalized ? 'n' : '') + a.array.constructor.name + '|';
  }
  return m.uuid + '#' + sig + '#' + (g.index !== null ? 'i' : 'n')
    + (mesh.castShadow ? 'C' : 'c') + (mesh.receiveShadow ? 'R' : 'r') + mesh.renderOrder;
}

/**
 * Splits a bucket into spatial cells so the merged batches still cull.
 *
 * See TARGET_BATCH_MEMBERS for why the cell size is derived from the bucket's
 * own footprint rather than fixed. Everything here allocates, and that is fine:
 * it runs on a rebuild, not on a frame.
 */
function spatialSplit(members: THREE.Mesh[]): THREE.Mesh[][] {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const m of members) {
    const e = m.matrixWorld.elements;
    if (e[12] < minX) minX = e[12];
    if (e[12] > maxX) maxX = e[12];
    if (e[14] < minZ) minZ = e[14];
    if (e[14] > maxZ) maxZ = e[14];
  }
  const area = Math.max(1, (maxX - minX) * (maxZ - minZ));
  const wanted = Math.max(1, members.length / TARGET_BATCH_MEMBERS);
  const cell = THREE.MathUtils.clamp(Math.sqrt(area / wanted), CELL_MIN, CELL_MAX);

  const cells = new Map<string, THREE.Mesh[]>();
  for (const m of members) {
    const e = m.matrixWorld.elements;
    const key = Math.floor((e[12] - minX) / cell) + ',' + Math.floor((e[14] - minZ) / cell);
    const list = cells.get(key);
    if (list === undefined) cells.set(key, [m]);
    else list.push(m);
  }
  return [...cells.values()];
}

/**
 * Concatenates any set of geometries into one POSITIONS-ONLY geometry, in the
 * space of `toLocal` (which is the group root's inverse world matrix).
 *
 * This is the merge that makes a single shadow caster out of meshes that share
 * nothing but a scene-graph parent. It drops normals, UVs, tangents, colours and
 * every custom attribute, and that is not a shortcut — a shadow map records
 * depth, three derives a depth material from the source material, and for the
 * materials `DrawBudget.isProxyable` admits that depth material reads `position`
 * and nothing else. Anything whose shadow needs more than position is excluded
 * there rather than approximated here.
 *
 * Everything is de-indexed on the way in. An index buffer would save memory and
 * cost a second pass to renumber across members of mixed indexed/non-indexed
 * geometry; a shadow proxy is built once and rasterised depth-only, so the
 * simpler, always-correct form wins. Returns null past the vertex ceiling.
 */
function mergePositions(
  members: THREE.Mesh[],
  toLocal: THREE.Matrix4,
  maxVerts: number,
): THREE.BufferGeometry | null {
  let total = 0;
  for (const m of members) {
    const g = m.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute | undefined;
    if (pos === undefined) return null;
    total += g.index !== null ? g.index.count : pos.count;
    if (total > maxVerts) return null;
  }
  if (total === 0) return null;

  const out = new Float32Array(total * 3);
  let w = 0;
  for (const m of members) {
    const g = m.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    _mat.multiplyMatrices(toLocal, m.matrixWorld);
    const index = g.index;
    const n = index !== null ? index.count : pos.count;
    for (let i = 0; i < n; i++) {
      const src = index !== null ? index.getX(i) : i;
      _v2.fromBufferAttribute(pos, src).applyMatrix4(_mat);
      out[w++] = _v2.x;
      out[w++] = _v2.y;
      out[w++] = _v2.z;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/**
 * Concatenates same-signature geometries into one, baked into the space of
 * `origin`.
 *
 * Positions are transformed by the member's world matrix (minus the origin
 * translation), normals and tangents by the corresponding normal matrix, and
 * every other attribute is copied verbatim — which is what keeps the look
 * identical, because in this project the interesting per-piece variation
 * (`aVar`, `color`, emissive tier, pulse phase) already lives in vertex
 * attributes rather than in per-object uniforms.
 *
 * WORLD POSITION SURVIVES THIS, and it has to: shader patches that derive a
 * world position from `modelMatrix * position` are the highest-risk trap in a
 * merge. A merged batch is placed at `origin` and its vertices are authored
 * relative to it, so `modelMatrix * vec4(position, 1)` still evaluates to
 * exactly the world position the unmerged mesh produced.
 */
function mergeStatic(
  members: THREE.Mesh[],
  origin: THREE.Vector3,
  totalVerts: number,
  totalIndices: number,
): THREE.BufferGeometry | null {
  const first = members[0]!.geometry;
  const names = Object.keys(first.attributes);
  const indexed = first.index !== null;
  if (indexed && totalIndices === 0) return null;

  const out = new THREE.BufferGeometry();
  const dst: Record<string, THREE.BufferAttribute> = {};
  for (const name of names) {
    const a = first.attributes[name] as THREE.BufferAttribute;
    const Ctor = a.array.constructor as unknown as { new(n: number): THREE.TypedArray };
    dst[name] = new THREE.BufferAttribute(new Ctor(totalVerts * a.itemSize), a.itemSize, a.normalized);
  }
  // Uint16 tops out at 65535, and a merged batch is routinely larger than that.
  const index = indexed
    ? new THREE.BufferAttribute(totalVerts > 65535 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices), 1)
    : null;

  let vBase = 0;
  let iBase = 0;
  for (const mesh of members) {
    const g = mesh.geometry;
    _mat.copy(mesh.matrixWorld);
    _mat.elements[12] -= origin.x;
    _mat.elements[13] -= origin.y;
    _mat.elements[14] -= origin.z;
    _norm.getNormalMatrix(_mat);
    const count = (g.attributes.position as THREE.BufferAttribute).count;

    for (const name of names) {
      const src = g.attributes[name] as THREE.BufferAttribute | undefined;
      const d = dst[name]!;
      if (src === undefined || src.itemSize !== d.itemSize) {
        // The bucket key guarantees this cannot happen; if it ever does, the
        // safe answer is to abandon the whole merge rather than emit a geometry
        // with one member's attribute missing, which draws as a black hole.
        out.dispose();
        return null;
      }
      const dArr = d.array as unknown as { set(a: ArrayLike<number>, o: number): void };
      if (name === 'position') {
        for (let i = 0; i < count; i++) {
          _v.fromBufferAttribute(src, i).applyMatrix4(_mat);
          d.setXYZ(vBase + i, _v.x, _v.y, _v.z);
        }
      } else if (name === 'normal') {
        for (let i = 0; i < count; i++) {
          _v.fromBufferAttribute(src, i).applyMatrix3(_norm).normalize();
          d.setXYZ(vBase + i, _v.x, _v.y, _v.z);
        }
      } else if (name === 'tangent' && src.itemSize === 4) {
        for (let i = 0; i < count; i++) {
          _v.set(src.getX(i), src.getY(i), src.getZ(i)).applyMatrix3(_norm).normalize();
          d.setXYZW(vBase + i, _v.x, _v.y, _v.z, src.getW(i));
        }
      } else {
        // `subarray`, not the whole array: a BufferAttribute may sit on a buffer
        // longer than `count * itemSize` (a pool, or a geometry that was built
        // with headroom), and copying the tail would overrun the next member's
        // span in the destination.
        const used = (src.array as unknown as { subarray(a: number, b: number): ArrayLike<number> })
          .subarray(0, count * d.itemSize);
        dArr.set(used, vBase * d.itemSize);
      }
    }

    if (index !== null && g.index !== null) {
      const si = g.index;
      for (let i = 0; i < si.count; i++) index.setX(iBase + i, si.getX(i) + vBase);
      iBase += si.count;
    }
    vBase += count;
  }

  for (const name of names) out.setAttribute(name, dst[name]!);
  if (index !== null) out.setIndex(index);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}


/**
 * ── EXPORTED FOR ONE REASON, AND IT IS NOT REUSE ─────────────────────────────
 *
 * These six are the pure part of the batcher: given the same meshes they emit
 * the same bytes, and nothing about them touches the class's state. They are
 * exported so a parity probe can run them BESIDE the pre-move copy and compare
 * with `Object.is`.
 *
 * That is a real property to hold. A merge is where "no triangle moved" is
 * either true or is a claim nobody checked, and the failure is silent: a lost
 * normal matrix, a dropped attribute or a wrong index base produces a scene
 * that renders, at the right place, subtly wrong. Making them reachable is the
 * difference between asserting that and asserting that the game still boots.
 *
 * A game importing these directly is not the intent and is not supported —
 * `DrawBudget` owns when they run and what they run on.
 */
export {
  mergeStatic, mergePositions, bucketKey, isBatchable, boundingRadius, spatialSplit,
};
