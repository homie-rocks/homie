/**
 * ============================================================================
 *  Instrument — a scene pass that reports what it drew.
 * ============================================================================
 *
 *  `renderer.info.render` is cumulative over everything drawn since the last
 *  `reset()`, so a HUD that reads it after `composer.render()` is reading the
 *  scene pass plus every fullscreen quad in the chain — six or seven extra
 *  calls and a couple of triangles each, which is exactly enough to make a draw
 *  budget's own readout wrong in the direction that hides the problem. Reading
 *  it in the frame the SCENE pass finishes is the only place the number means
 *  "what the world cost".
 *
 *  It had ONE COPY, in one game's post-processing module. Nothing in it is
 *  about that game: it is `super.render(...)` and two integers. The criterion
 *  is to ask whether it belongs in a game, never whether there is a twin — and
 *  it does not.
 *
 *  NOT WIRED INTO `PostFXChain.buildScene` BY DEFAULT, deliberately. Six
 *  consumers build a plain `RenderPass` there and none of them asks for the
 *  numbers; swapping the class under all six to serve one is a behaviour change
 *  for five games that did not request it. A consumer that wants the reading
 *  overrides `buildScene` and adds this instead, which is one line and is
 *  visible in the game's own file.
 */
import * as THREE from 'three';
import { RenderPass } from 'postprocessing';

export class InstrumentedRenderPass extends RenderPass {
  private readonly report: (calls: number, triangles: number) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    report: (calls: number, triangles: number) => void,
  ) {
    super(scene, camera);
    this.report = report;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
    deltaTime?: number,
    stencilTest?: boolean,
  ): void {
    super.render(renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    const info = renderer.info.render;
    this.report(info.calls, info.triangles);
  }
}
