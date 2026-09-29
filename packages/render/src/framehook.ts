/**
 * ============================================================================
 *  framehook.ts — a subsystem that ticks whether or not anybody wired it.
 * ============================================================================
 *
 * A subsystem that owns per-frame state — a light pick, a tracker angle, a
 * pulse phase, a deferred batch flush — needs the frame. The usual answer is
 * that the game loop calls it, and the usual failure is that the game loop is
 * another file, owned by somebody else, with a fixed list of callees that does
 * not include this one. The term then sits in the tree fully implemented and
 * never executes, which is the most expensive shape of bug we have on record:
 * it compiles, it type-checks, it reviews clean, and the only symptom is that a
 * whole lighting term is missing from every frame.
 *
 * So the hook does not depend on anyone remembering. It is a mesh:
 *
 *   · ONE degenerate triangle, so it has a position attribute and three does
 *     not skip it as empty;
 *   · `colorWrite: false`, `depthWrite: false`, `depthTest: false`, so it
 *     cannot put a pixel anywhere or perturb the depth buffer;
 *   · `frustumCulled = false`, because a hook that stops firing when the camera
 *     looks away is worse than no hook at all;
 *   · `renderOrder = -1000`, so it runs BEFORE the things whose uniforms it
 *     writes, in the same frame rather than one late.
 *
 * Cost: one draw call that writes nothing.
 *
 * ── THE FRAME-ID GATE IS THE OTHER HALF, AND IT IS NOT AN OPTIMISATION ──────
 *
 * `onBeforeRender` fires once per PASS, not once per frame. A shadow pass and a
 * main pass share a frame id, and so does every extra render a post chain, a
 * cube probe or a reflection makes. Without the gate, a subsystem integrating
 * `dt` would advance two to six times per displayed frame, at a rate that
 * changes when someone adds a shadow cascade — which is a timing bug with no
 * stack trace attached to it.
 *
 * `run()` is the same gate, exposed. A game loop that DOES call the subsystem
 * gets a free no-op if the mesh already ran this frame, so wiring it up
 * properly later is safe and costs nothing. That is the point: the hook is the
 * floor, not the design.
 */
import * as THREE from 'three';

export interface FrameHook {
  /** Add this to the scene graph — anywhere; it draws nothing. */
  readonly mesh: THREE.Mesh;
  /**
   * Run the callback unless it already ran for this rendered frame.
   *
   * Exposed so an explicit call from the game loop is idempotent against the
   * mesh's own. Returns true if the callback ran.
   */
  run(dt: number): boolean;
  /** Drop the geometry and material. The mesh must already be detached. */
  dispose(): void;
}

/**
 * @param renderer the renderer whose `info.render.frame` counts frames. It must
 *                 be the one that will draw the mesh — two renderers have two
 *                 counters and the gate would let every other pass through.
 * @param fn       the tick. Called with the caller's `dt`; the mesh passes the
 *                 `dt` given here.
 * @param dt       what the MESH's own call uses. A fixed step, not a wall-clock
 *                 delta: a hook that measures the machine is a hook whose two
 *                 captures are not comparable.
 */
export function frameHook(
  renderer: THREE.WebGLRenderer, fn: (dt: number) => void, dt: number,
): FrameHook {
  let last = -1;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'frame-hook';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  function run(step: number): boolean {
    const f = renderer.info.render.frame;
    if (f === last) return false;
    last = f;
    fn(step);
    return true;
  }
  mesh.onBeforeRender = () => { run(dt); };

  return {
    mesh,
    run,
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
