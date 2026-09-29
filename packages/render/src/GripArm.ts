/**
 * ============================================================================
 *  GripArm — the one-bone skin that keeps a driver's hands on the wheel.
 * ============================================================================
 *  This stood BYTE-IDENTICAL — the 29-line explanation below included — in
 *  the livery modules of a kart racer and of a space racer, all 69 lines of it,
 *  and the two games' driver code calls it identically. It is one thing.
 *
 *  WHAT THE GAME STILL SUPPLIES, AND WHY THAT IS NOT A FLAG. Two VALUES: the
 *  character material to clone, and the environment intensity to key it to.
 *  Nothing here branches on which game called it and there is no parameter that
 *  changes what it does — the shader it injects is one shader. A racer keeps a
 *  three-line `gripArmMaterial()` of its own that reads those two values out of
 *  its own material library, so the driver code in both games is untouched.
 *
 *  THE LIST IS HERE BECAUSE THE MATERIALS ARE. `syncGripArmEnv` re-keys every
 *  arm material this module has issued. It lived in each game's `syncKartEnv`
 *  as a loop over a module-level array, and an array of materials this module
 *  creates cannot be owned by a module that does not create them. One module
 *  instance per bundle, so a game's list holds exactly that game's arms.
 *
 *  `three` is a peerDependency here, as everywhere in this package.
 * ============================================================================
 */
import * as THREE from 'three';

// --- driver arm grip skin ----------------------------------------------------
//
// THE HANDS MUST BE ON THE RIM AT EVERY STEERING ANGLE, AND THEY WERE NOT.
//
// The driver model derives the whole glove from RIM_R — palm outboard of the
// rim, finger roll inboard, thumb along the tangent — so at REST the grip is
// exact and built by construction. Then the rig turned the wheel by -steer *
// 0.85 and the arms (one rigid mesh) by -steer * 0.22, both about the column
// axis. At full lock that is 0.63 rad of relative rotation on a 155 mm rim: the
// hands slide 98 mm around the wheel and end up beside it. Every review shot
// with any steering in it therefore shows two pale blocks floating next to a
// rim, which is exactly what a close-up review reported — and no amount of
// modelling the hand better can fix a rig that moves it off the thing it is
// holding.
//
// The arm cannot simply ride the wheel node instead: the shoulder is 0.35 m off
// the column axis, so 0.85 rad there would tear the deltoid out of the torso.
// What is wanted is a two-bone limb — shoulder fixed, wrist on the rim, elbow
// solved between them — and the cheapest honest version of that on a mesh this
// small is a one-bone linear blend skin. Each vertex carries `aGrip` (0 at the
// deltoid, 1 at the glove, ramped across the forearm) and the vertex shader
// rotates it about the column axis by `uGrip * aGrip`. `uGrip` is set to the
// wheel node's own rotation, so aGrip == 1 IS the rim's frame: the grip is
// attached by construction again, and stays attached through full lock.
//
// Cost: one extra mat2 and a sin/cos on ~900 vertices per kart. No extra draw
// call — the arms were always their own mesh — but the uniform has to be per
// driver, so each rig gets a clone of the shared character material. Clones
// share one program (same cache key), so this is eight uniform blocks, not
// eight shader compiles.
const _gripArms: THREE.MeshStandardMaterial[] = [];

export interface GripArmMaterial {
  material: THREE.MeshStandardMaterial;
  /** Set to the steering wheel node's `rotation.y` every frame. */
  angle: { value: number };
}

/**
 * One driver's arm material.
 *
 * `base` is the game's shared character material — it is CLONED, never mutated,
 * because the uniform has to be per driver. `envMapIntensity` is the value the
 * game's own env bookkeeping has arrived at for characters; pass the same value
 * to `syncGripArmEnv` when it changes.
 */
export function gripArmMaterial(base: THREE.MeshStandardMaterial, envMapIntensity: number): GripArmMaterial {
  const m = base.clone();
  const angle = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrip = angle;
    shader.vertexShader = `uniform float uGrip;\nattribute float aGrip;\n${shader.vertexShader}`
      // The rotation is about the mesh's local +Y, which is the steering column
      // axis: the driver model bakes the arms into the column frame for exactly
      // this. mat2(c,s,-s,c) is column-major, so this is the same (x,z) map
      // three applies for Object3D.rotation.y — the two cannot drift apart.
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float gA = uGrip * aGrip;
        float gC = cos( gA ), gS = sin( gA );
        mat2 gRot = mat2( gC, - gS, gS, gC );
        objectNormal.xz = gRot * objectNormal.xz;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.xz = gRot * transformed.xz;`,
      );
  };
  // THE COMMENT THAT TRAVELLED WITH THIS LINE FROM BOTH GAMES WAS WRONG, AND
  // THE LINE IS STILL RIGHT. It read: "without this every clone would hash to
  // the stock MeshStandardMaterial key and three would hand them a program
  // compiled from the UNPATCHED source." Measured against three 0.185,
  // `Material.customProgramCacheKey` is not an own property and its
  // prototype default returns `this.onBeforeCompile.toString()` — so a clone
  // that declares nothing already keys on the patched closure's SOURCE TEXT,
  // already differs from stock, and already unifies the eight drivers (their
  // closures have identical source; what differs is the captured `angle`, which
  // is a uniform three uploads per material, not per program).
  //
  // What the explicit key actually buys is that the key is a NAME rather than a
  // function body: it does not depend on `Function.prototype.toString`, which a
  // minifier rewrites and which is not guaranteed to return source at all. A
  // cache key that changes when a build tool reformats a closure is a key that
  // silently recompiles — or silently collides. A `grip-hashes-to-stock` fault
  // in this package's harness reds a check on exactly that: it removes the line
  // and the key becomes the closure's own text.
  m.customProgramCacheKey = () => 'kartGripArm';
  m.envMapIntensity = envMapIntensity;
  _gripArms.push(m);
  return { material: m, angle };
}

/**
 * Re-key every arm material this module has issued to a new env intensity.
 *
 * This was `for (const m of _gripArms) m.envMapIntensity = envFor('character');`
 * inside each game's `syncKartEnv`, which is the same line twice over a list
 * neither game could see from anywhere else.
 */
export function syncGripArmEnv(envMapIntensity: number) {
  for (const m of _gripArms) m.envMapIntensity = envMapIntensity;
}
