/**
 * ============================================================================
 *  shadowsplit — the wrap around `WebGLShadowMap.render` that separates the
 *  cascades' draw calls from the picture's, and drives the draw budget's
 *  per-cascade seam.
 * ============================================================================
 *
 *  ── WHY IT IS HERE AND NOT IN A GAME ───────────────────────────────────────
 *
 *  `@homie-rocks/render/drawbudget.ts` declares `beginShadowPass`,
 *  `endShadowPass`, `perCascade`, `beginCascade` and `shadowHookArmed` — five
 *  entry points whose ONLY caller lived inside a base-building game's renderer.
 *  A package API whose caller is in a game is the built-but-never-driven rig
 *  failure read backwards: the mechanism is in the package and the thing that
 *  makes it run is not, so a second consumer of the budget gets the fields, the
 *  stats and the documentation, and silently gets no shadow attribution at all.
 *
 *  Nothing in it is lunar. It is three's shadow map, three's `info.render`, and
 *  the budget's own vocabulary.
 *
 *  ── WHAT THE SPLIT BUYS ────────────────────────────────────────────────────
 *
 *  `renderer.info` has no such split — it is one running total — and without
 *  one the headline draw-call number is uninterpretable, because the cascades
 *  refresh on staggered intervals and the same picture reads as 1280 calls on
 *  one frame and 2716 on the next. Wrapping `WebGLShadowMap.render` is the only
 *  seam: three calls it exactly once per `render()`, before the colour pass, so
 *  the counter delta across it is the cascades' share and nobody else's.
 *
 *  ── AND WHAT THE PER-CASCADE LOOP BUYS ─────────────────────────────────────
 *
 *  three's cascades are NESTED — nested half-extents about the same focus — and
 *  `WebGLShadowMap.render` tests every caster against every box, so anything
 *  near the camera is rasterised into all of them. It cannot know better: the
 *  shader's cascade choice is per receiver fragment and three has never seen
 *  it. `DrawBudget` has. Measured on a base-building game's `mature` scenario:
 *  397 shadow draws for 137 visible casters.
 *
 *  Splitting the call is safe because three's shadow render is already a loop
 *  over exactly this array, and everything it touches per light — the map, the
 *  matrix, the viewport, the material cache — hangs off that light's own
 *  `shadow`. What it costs is one render-target save and restore per light,
 *  which is why `perCascade` only says yes when there is a real assignment to
 *  make.
 *
 *  ── GUARDED RATHER THAN ASSUMED ────────────────────────────────────────────
 *
 *  If a future three version restructures the shadow map, the split degrades to
 *  "all of it is colour" and SAYS SO, rather than reporting a confidently wrong
 *  attribution — which is worse than no instrument at all. The
 *  return value is that answer as a value, so a probe can assert the hook armed
 *  rather than assume it.
 *
 *  THIS FILE IMPORTS NOTHING. `three` and the budget arrive structurally, which
 *  is what lets a Node test drive the whole wrap with two stubs.
 * ============================================================================
 */

/** The `renderer.info.render.calls` counter, and nothing else off `info`. */
export interface DrawCounter {
  render: { calls: number };
}

/** The half of three's `WebGLRenderer` this file touches. */
export interface ShadowSplitRenderer {
  info: DrawCounter;
  shadowMap: { render?: (lights: unknown[], scene: unknown, camera: unknown) => void };
}

/** The half of `DrawBudget` this file drives. See drawbudget.ts for each. */
export interface ShadowSplitBudget {
  shadowHookArmed: boolean;
  beginShadowPass(): void;
  endShadowPass(): void;
  perCascade(lights: unknown[]): boolean;
  beginCascade(light: unknown): void;
}

/** What `installShadowSplit` did, as a value a probe can read. */
export interface ShadowSplitResult {
  /** True when the wrap is in place and the budget's hook is armed. */
  armed: boolean;
  /** Why not, when it is not. Empty when armed. */
  reason: string;
}

/**
 * Wraps the renderer's shadow map so the cascades' draws are attributed to the
 * cascades, and so the budget gets its per-cascade window.
 *
 * `onShadowCalls` is called with the DELTA for each shadow pass, accumulated
 * rather than assigned by the caller: three renders the shadow maps once per
 * `render()` and a composer's AO pass issues its own `render()` later, so the
 * value has to survive being written more than once between resets.
 */
export function installShadowSplit(
  renderer: ShadowSplitRenderer,
  budget: ShadowSplitBudget,
  onShadowCalls: (delta: number) => void,
): ShadowSplitResult {
  const sm = renderer.shadowMap;
  if (typeof sm.render !== 'function') {
    return {
      armed: false,
      reason: 'WebGLShadowMap.render not found; shadow draw calls will read as 0 and '
        + 'DrawBudget shadow proxies will fall back to a visible colorWrite-off material',
    };
  }
  const inner = sm.render.bind(sm);
  const info = renderer.info;
  sm.render = (lights: unknown[], scene: unknown, camera: unknown) => {
    const before = info.render.calls;
    // THE SHADOW-PASS WINDOW. See DrawBudget.beginShadowPass: this seam is the
    // only instant in three's frame at which "draw this into the cascades but
    // not into the picture" is expressible, because `projectObject` has already
    // built the colour render list and both paths gate on `material.visible`.
    // The `finally` is load-bearing — a throw between the two calls would leave
    // the proxies visible, which costs a draw call and paints nothing, and that
    // is the side the failure is arranged to fall on.
    budget.beginShadowPass();
    try {
      if (budget.perCascade(lights)) {
        // ONE LIGHT AT A TIME, so that "which cascades can see this shadow" can
        // be answered per cascade. See the header.
        for (let i = 0; i < lights.length; i++) {
          budget.beginCascade(lights[i]);
          inner([lights[i]], scene, camera);
        }
      } else {
        inner(lights, scene, camera);
      }
    } finally {
      budget.endShadowPass();
    }
    onShadowCalls(info.render.calls - before);
  };
  // Only now, after the wrap is in place. DrawBudget reads this to decide
  // whether a proxy can be hidden from the colour pass at all.
  budget.shadowHookArmed = true;
  return { armed: true, reason: '' };
}
