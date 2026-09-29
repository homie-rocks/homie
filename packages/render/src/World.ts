import * as THREE from 'three';
import type { RenderSettings } from './settings.ts';

/**
 * ============================================================================
 *  The engine half of a game's `Ctx`, and the one call that builds it.
 * ============================================================================
 *
 *  WHAT THIS IS. Every 3D game built on this engine declares one mutable `Ctx`
 *  that every subsystem receives. Sixteen of its fields are the ENGINE — the
 *  renderer, the scene, the camera, the frame clock, the viewport, the
 *  settings, the bus, the environment probe, the key light and the three
 *  camera cues — and those sixteen were written out by hand in the `types.ts`
 *  of a first-person shooter, a kart racer and a space racer, and then
 *  CONSTRUCTED by hand a second time in each game's `main.ts`.
 *
 *  MEASURED with a pairwise duplication scan: the two racers' `types.ts` share
 *  a LOOSE run of 62 lines, the longest run anywhere in the four games, and
 *  their `main.ts` files share 34 lines verbatim in runs to 13. The
 *  `const ctx: Ctx = { … }` literal is 22 of those lines and it is
 *  byte-identical between the two racers apart from the subsystem names at
 *  the bottom.
 *
 *  ---------------------------------------------------------------------------
 *  WHY IT IS IN @homie-rocks/render AND NOT @homie-rocks/loop
 *
 *  @homie-rocks/loop refuses to import `three` — see its package.json, and Host.ts's
 *  header for the reason (two copies of three.js is two `instanceof` universes
 *  and the symptom is an object that renders as nothing with no error at all).
 *  `EngineCtx` names `WebGLRenderer`, `Scene`, `PerspectiveCamera`, `Texture`,
 *  `DirectionalLight` and `Vector3`, so it cannot live there without breaking
 *  that. It lives here, where `three` is already a peerDependency and where
 *  `RenderSettings` — the type the games' `Settings` interface was a
 *  field-for-field copy of — already is.
 *
 *  The LIFECYCLE half of the same contract (`System`, `Bus`) has no three.js in
 *  it and is `@homie-rocks/loop/Contracts.ts`. The split is along the three.js line
 *  and nothing else.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT A GAME STILL SUPPLIES, and every one of them is a VALUE
 *
 *    `view`          the viewport at boot. `initialViewport(parent)` from
 *                    @homie-rocks/loop is what all three pass; this package does not
 *                    take a DOM element because it must not import the loop.
 *    `fov/near/far`  62 / 0.2 / 3000 in the racers, 78 / 0.08 / 400 in the
 *                    shooter. Three numbers, three games, no policy.
 *    `settings`      the object `createSettings()` returned. **A PARAMETER,
 *                    NOT A MODULE SINGLETON** — see the note below.
 *    `bus`           the game's own `Bus<GameEvent>`.
 *    `sunDirection`  where the key light is, normalised by the game.
 *    `shake`         where an additive screen shake goes. The two racers
 *                    forward to their chase rig; the shooter has no
 *                    shake and passes a function that does nothing, which
 *                    SAYS SO rather than leaving a field out.
 *
 *  THERE IS NO OPTIONAL FIELD IN `EngineCtxSpec` AND THAT IS DELIBERATE, for
 *  the reason `BootSpec` gives: a game that forgets one should fail to
 *  compile, and a game that silently gets a default gets another game's art
 *  direction — a default `far` of 3000 in a 40-metre station is a depth buffer
 *  spent on nothing, and it would look completely fine.
 *
 *  ---------------------------------------------------------------------------
 *  SETTINGS IS NOW AN ARGUMENT. A split-screen study named
 *  `settings: createSettings(),` in a game's `main.ts` as the real obstacle to
 *  ever rendering two views — ONE `Settings` object per process, built at
 *  module scope, read 21 times in the kart racer and 18 times inside this
 *  package. It is still one object today. What changed is that the only way
 *  to build a second `Ctx` used to be copying a 22-line literal out of
 *  `main.ts`, and it is now one call that TAKES the settings object. A
 *  television view at Ultra and a phone view at Low are two `engineCtx()`
 *  calls with two settings objects and one scene; they were not expressible
 *  before, and no behaviour has moved to make them so.
 * ============================================================================
 */

/**
 * The engine half of a game's context.
 *
 * Generic over the bus rather than over the event union, so a game whose
 * `IBus` adds a member keeps it: `interface Ctx extends EngineCtx<IBus>`.
 *
 * The loop WRITES `time`, `dt`, `frame`, `width` and `height` — they are the
 * frame's own clock and every system reads them off the same object — which is
 * why they are not readonly. `@homie-rocks/loop/Host.ts`'s `LoopWorld` lists exactly
 * the seven of these the loop touches, and this satisfies it structurally.
 */
export interface EngineCtx<B> {
  /**
   * Null until the pipeline's own `init` has run, and typed non-null anyway.
   * All three games wrote `renderer: null as any` / `null as unknown as
   * THREE.WebGLRenderer` into the literal and declared the field non-null,
   * because every one of the ~200 reads happens after `init`. Widening it to
   * `| null` here would put a `!` on every one of them and buy nothing.
   */
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** seconds since boot */
  time: number;
  /** clamped frame delta, seconds */
  dt: number;
  frame: number;
  width: number;
  height: number;
  settings: RenderSettings;
  bus: B;

  /** environment map produced by the sky system, for PBR */
  envMap: THREE.Texture | null;
  /** the key light, so systems can align shadow cascades / flares */
  sun: THREE.DirectionalLight | null;
  /** normalised direction TOWARD the sun */
  sunDirection: THREE.Vector3;

  // --- effect requests, honoured by render/camera ---
  /** additive screen shake, decays automatically */
  shake(amount: number, seconds?: number): void;
  /** 0..1, drives speed lines, FOV punch and radial blur */
  speedIntensity: number;
  /** extra FOV in degrees added by boost, smoothed by the camera */
  fovPunch: number;
}

/** What a game hands `engineCtx`. No optionals; see the header. */
export interface EngineCtxSpec<B> {
  /** `initialViewport(parent)` — the CSS size of the canvas host at boot. */
  view: { w: number; h: number };
  fov: number;
  near: number;
  far: number;
  settings: RenderSettings;
  bus: B;
  sunDirection: THREE.Vector3;
  shake: (amount: number, seconds?: number) => void;
}

/**
 * Build the engine half. A game spreads it into its own literal:
 *
 * ```ts
 * const ctx: Ctx = { ...engineCtx({ … }), input, track, race, items };
 * ```
 *
 * THE SIXTEEN ENGINE KEYS COME OUT IN THE ORDER THE HAND-WRITTEN LITERAL HAD
 * THEM, and a probe checked that against the pre-move source. The game's OWN
 * fields move: a spread can only prepend, so `input`, `track`, `race`, `items`
 * — which sat in the middle of the literal — now land at the tail. That is a
 * real change and it is checked rather than assumed: nothing in the games
 * enumerated `Object.keys(ctx)` (grepped, zero hits), every read is by name,
 * and the probe asserts the full key SET is unchanged so a field cannot go
 * missing behind the reordering.
 *
 * `sunDirection` and `shake` are STORED, not copied — the games passed a
 * freshly normalised `Vector3` and a closure over their camera rig, and a
 * defensive clone here would give the game back a vector its own code no
 * longer holds a reference to.
 */
export function engineCtx<B>(spec: EngineCtxSpec<B>): EngineCtx<B> {
  return {
    renderer: null as unknown as THREE.WebGLRenderer,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(spec.fov, spec.view.w / spec.view.h, spec.near, spec.far),
    time: 0,
    dt: 0,
    frame: 0,
    width: spec.view.w,
    height: spec.view.h,
    settings: spec.settings,
    bus: spec.bus,
    envMap: null,
    sun: null,
    sunDirection: spec.sunDirection,
    shake: spec.shake,
    speedIntensity: 0,
    fovPunch: 0,
  };
}
