/**
 * ============================================================================
 *  atlasbake — N x M views of one thing, rendered into one texture, once.
 * ============================================================================
 *  `impostor.ts` in this package is the OTHER far-LOD trick: reduce a machine
 *  to a single opaque vertex-coloured buffer and keep drawing geometry. This is
 *  the one that stops drawing geometry at all — render the thing into a grid of
 *  tiles and billboard the right tile after that.
 *
 *  It is the answer for a CROWD rather than for a machine. At fourteen screen
 *  pixels a figure does not need a skeleton, and a hundred and fifty of them
 *  each running a vertex rig is a hundred and fifty times a cost that buys
 *  nothing. Two axes is what makes it work for something that MOVES: one for
 *  view angle, one for animation phase, so a distant crowd still walks.
 *
 * ----------------------------------------------------------------------------
 *  WHAT IS ACTUALLY HERE, BECAUSE IT LOOKS SMALLER THAN IT IS
 * ----------------------------------------------------------------------------
 *  A scissored viewport loop and a state save/restore. The loop is four lines.
 *  The save/restore is the reason this is a shared function.
 *
 *  A bake runs INSIDE somebody else's frame loop, against a renderer that is
 *  mid-composition, and it stamps on six pieces of global state: the render
 *  target, `autoClear`, the clear colour, the clear alpha, the viewport and the
 *  scissor test. Miss one on the way out and the failure is not in the bake —
 *  it is in the NEXT frame, somewhere else entirely, and it looks like whatever
 *  that frame does with a wrong clear colour or a scissor rectangle 128 pixels
 *  wide. That is a bug that gets attributed to the post chain for a week.
 *
 *  `autoClear` is switched off DURING the loop and that is not an optimisation:
 *  with it on, every tile clears the whole target and the atlas ends up holding
 *  one tile.
 *
 * ----------------------------------------------------------------------------
 *  THE LIGHTS, THE CAMERA AND THE POSE ARE ALL THE CALLER'S
 * ----------------------------------------------------------------------------
 *  This function never constructs a light. A key light is art direction — its
 *  colour, its elevation and its intensity are a decision about what world this
 *  is — and a package that carried one would hand the next game this game's sun
 *  in its distant crowd, where nobody would look for it. The caller builds the
 *  scene, builds the camera that frames its subject, and gets a callback per
 *  tile in which to set whatever makes that tile different.
 *
 *  The FRAMING has to match whatever the billboard quad is, exactly, or every
 *  instance in the far field floats or sinks by the difference — and that is a
 *  fact about the caller's quad, so the caller states it.
 *
 * ----------------------------------------------------------------------------
 *  IT DOES NOT CATCH
 * ----------------------------------------------------------------------------
 *  A bake failure is often survivable — keep the previous LOD out to the cull
 *  and pay a little GPU. But whether it is survivable is the CALLER's question,
 *  and a package that swallowed the error and returned null would report "no
 *  atlas" for a driver problem, a lost context and a programming mistake
 *  alike. A crash gets fixed; a plausible default gets quoted. The caller keeps
 *  its own try/catch and its own reason for continuing.
 * ============================================================================
 */
import * as THREE from 'three';

const _col = new THREE.Color();
const _vp = new THREE.Vector4();

export interface AtlasBakeSpec {
  /** Tiles across and down. Their meaning is entirely the caller's. */
  cols: number;
  rows: number;
  /** One tile, in pixels. */
  tileW: number;
  tileH: number;
  /**
   * Everything to be drawn, lights included. Built by the caller, disposed by
   * the caller: this function adds nothing to it and removes nothing from it.
   */
  scene: THREE.Scene;
  /** Framing. Must agree with whatever quad will stand in for the result. */
  camera: THREE.Camera;
  /**
   * Called before each tile with its column and row. Set the rotation, the
   * animation uniforms, the variant — whatever makes this tile a different
   * view of the subject.
   */
  pose: (col: number, row: number) => void;
  /**
   * Render-target options, merged over the defaults. The default is
   * HalfFloat/NoColorSpace with a depth buffer and linear filtering, because
   * 8-bit bands the dark side of anything and clips everything above 1.0
   * before a bloom pass can ever see it.
   */
  target?: THREE.RenderTargetOptions;
}

/**
 * Render `cols x rows` views into one texture and hand it back.
 *
 * The render target is NOT disposed — its texture is the return value and it
 * outlives this call. The caller owns it, and owns disposing the scene,
 * geometry and materials it built to feed this.
 */
export function bakeAtlas(renderer: THREE.WebGLRenderer, s: AtlasBakeSpec): THREE.Texture {
  const rt = new THREE.WebGLRenderTarget(s.tileW * s.cols, s.tileH * s.rows, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: true,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    ...s.target,
  });

  // Save every piece of renderer state this is about to stamp on. See header.
  const prevRT = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevAlpha = renderer.getClearAlpha();
  renderer.getClearColor(_col);
  renderer.getViewport(_vp);
  const prevScissorTest = renderer.getScissorTest();

  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, false);
  // OFF for the loop: with it on, every tile clears the whole target and the
  // atlas ends up holding exactly one tile.
  renderer.autoClear = false;
  renderer.setScissorTest(true);

  for (let r = 0; r < s.rows; r++) {
    for (let c = 0; c < s.cols; c++) {
      s.pose(c, r);
      const x = c * s.tileW, y = r * s.tileH;
      renderer.setViewport(x, y, s.tileW, s.tileH);
      renderer.setScissor(x, y, s.tileW, s.tileH);
      renderer.render(s.scene, s.camera);
    }
  }

  renderer.setScissorTest(prevScissorTest);
  renderer.autoClear = prevAutoClear;
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(_col, prevAlpha);
  renderer.setViewport(_vp.x, _vp.y, _vp.z, _vp.w);

  return rt.texture;
}

/**
 * The two lines of UV arithmetic that read one tile out of the result, as GLSL.
 *
 * They live here because they are the OTHER HALF OF THE SAME CONTRACT: an atlas
 * baked at one tile count and sampled at another is a crowd wearing each
 * other's frames, and a caller that writes the divisor itself will eventually
 * write it twice and change one. `atlasUv` emits the scale, `atlasPick` the
 * offset for a chosen tile.
 */
export function atlasUvGLSL(cols: number, rows: number): string {
  return `vec2(${(1 / cols).toFixed(5)}, ${(1 / rows).toFixed(5)})`;
}
