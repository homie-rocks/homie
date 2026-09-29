/**
 * ============================================================================
 *  The chase rig's scratch, declared once — and the reason it HAD to move.
 * ============================================================================
 *
 *  Fifteen module-scope vectors so a frame allocates nothing. Both racers
 *  declared the same fifteen, in the same order, with the same names, in two
 *  files; `rigstate.ts` already made that argument about the rig's *fields* and
 *  it is the same argument. What is different here, and what makes this file
 *  load-bearing rather than tidy, is that the duplication was ALSO the thing
 *  blocking `wiring.ts`.
 *
 *  **A SHARED METHOD THAT WRITES ITS OWN `_eye` IS A METHOD THAT WRITES
 *  NOTHING.** `poseIntro`, `poseFinish` and `poseOrbit` compose into `_eye` and
 *  `_aim`; `lateUpdate` then copies `_eye` onto the camera. Move those three
 *  into a package that declares its own `_eye` and every one of them lands in
 *  a vector the game never reads — the countdown, the finish and the results
 *  orbit all stop moving the camera, the last chase pose stays on screen, and
 *  **nothing throws, nothing logs and every frame renders**. That is the
 *  classic seam failure exactly: two halves each behaving as written, a seam
 *  nobody asserted across, and a screen showing a stale frame that looks
 *  completely fine.
 *
 *  So the scratch is the seam, and a seam gets ONE copy. Both racers import
 *  these bindings and so does `wiring.ts`; there is exactly one `_eye` in a
 *  built game, and a deliberate fault in the package's tests gives `wiring.ts`
 *  its own private pair and watches the checks go red.
 *
 *  **THE NAMES KEEP THEIR UNDERSCORES ON PURPOSE.** It is the codebase's spelling
 *  for "module scratch, clobbered by anyone, live only between two adjacent
 *  statements", it is what both games already called them, and it meant the
 *  move changed no call site in either game — which is the only reason a
 *  400-line file could be re-pointed at a package without a reader having to
 *  check 200 lines by eye.
 *
 *  **WHAT IS NOT HERE.** `WORLD_UP` is not: it is a value, every package
 *  function that needs it takes it as an argument, and a mutable `Vector3`
 *  exported from a package is a global one careless `.set()` away from tilting
 *  every game at once. Neither are the six vectors only the space racer has
 *  (`_tmp2`, `_fwd`, `_fwdPrev`, `_camF`, `_camR`, `_camU`) — a scratch one
 *  game never touches is a scratch the other game's reader has to be told to
 *  ignore, which is `rigstate.ts`'s rule for fields and holds here for the same
 *  reason. And `scene.ts` keeps its OWN `_tmp`/`_tmp2`/`_m`/`_m2`/`_box`: its
 *  header records that the walks deliberately stopped clobbering the games'
 *  scratch, and importing these would put that back.
 *
 *  **NOT REENTRANT, AND THAT IS UNCHANGED.** Two rigs in one bundle share these
 *  fifteen vectors — exactly as two rigs in one game's module already did.
 *  A second camera is a second module instance in a second bundle, or it is a
 *  bug that was already there.
 * ============================================================================
 */
import * as THREE from 'three';

/** The pose being solved this frame, and where it looks. Written by the chase
 *  pose, by every cinematic, and by both harness plates; read by `lateUpdate`
 *  on its way to `camera.position` and the `lookAt`. */
export const _eye = /* @__PURE__ */ new THREE.Vector3();
export const _aim = /* @__PURE__ */ new THREE.Vector3();

/** The live chase framing, kept so the countdown can hand back to gameplay
 *  without a seam. `poseIntro` lerps into these two over its last beat. */
export const _chaseEye = /* @__PURE__ */ new THREE.Vector3();
export const _chaseAim = /* @__PURE__ */ new THREE.Vector3();

/** The chase arm's own three: where it pivots, which way it points, and the
 *  camera-right it is composed against. */
export const _pivot = /* @__PURE__ */ new THREE.Vector3();
export const _dir = /* @__PURE__ */ new THREE.Vector3();
export const _right = /* @__PURE__ */ new THREE.Vector3();

/** The ground frame under construction, before it is rate-limited onto
 *  `this.up`, and the axis it is rotated about. */
export const _up = /* @__PURE__ */ new THREE.Vector3();
export const _axis = /* @__PURE__ */ new THREE.Vector3();

/** General-purpose, live only between two adjacent statements. `_tmp` is the
 *  arm sweep's station, `_face` the chassis heading flattened for the close
 *  plate, `_pt` the subject point the composition solves against. */
export const _tmp = /* @__PURE__ */ new THREE.Vector3();
export const _face = /* @__PURE__ */ new THREE.Vector3();
export const _pt = /* @__PURE__ */ new THREE.Vector3();

/** `_q` is a rotation being applied; `_qt` is the orientation this frame is
 *  going to be rendered with, before the comfort ceiling has had its say. */
export const _q = /* @__PURE__ */ new THREE.Quaternion();
export const _qt = /* @__PURE__ */ new THREE.Quaternion();

/** The `lookAt` basis `_qt` is read out of. */
export const _m = /* @__PURE__ */ new THREE.Matrix4();
