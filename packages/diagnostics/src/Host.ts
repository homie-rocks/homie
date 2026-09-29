/**
 * ===========================================================================
 *  @homie-rocks/diagnostics/Host.ts — the four fields, instead of the context.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT `import type { Ctx }`.
 * ---------------------------------------------------------------------------
 * Both watchdogs in this package were `src/core/Diagnostics.ts` and
 * `src/core/FrameWatch.ts` inside the games, and both took the game's `Ctx`.
 * Measured on one first-person shooter, that interface carries `match`,
 * `combat`, `player`, `map`, `scene`, `camera`, `bus`, `envMap`, `sun`,
 * `shake()`, `speedIntensity`, `fovPunch` and `hurt`; the four games' versions
 * add `race`, `track`, `items`, `terrain`, `colony`, `story` and `networks`.
 *
 * The engine's boundary rule: a package may know THAT a person has durable
 * facts; it may not know what a point is, what a round is, or what winning
 * looks like. **One `import type { Ctx }` puts every one of those nouns inside
 * the engine packages** — a type-only import costs nothing at runtime and
 * costs the whole boundary at review time, which is why the rule names it
 * explicitly.
 *
 * So the seam is a STRUCTURE, declared here, listing exactly what the two
 * watchdogs read and nothing else:
 *
 *     Diagnostics  →  frame, renderer, settings.quality      (3 fields)
 *     FrameWatch   →  frame, time, renderer                  (3 fields)
 *
 * It is structural on purpose. A game still writes `diagnostics.afterPresent(ctx,
 * calls)` with its own `ctx` and no cast, because TypeScript checks the shape
 * rather than the name — the call sites did not change, and the genre nouns
 * stayed in the game. If a future field is wanted here, adding it to this file
 * is the moment somebody has to justify it, and that is the point.
 *
 * `renderer` IS NOT A `THREE.WebGLRenderer` EITHER, AND THAT IS DELIBERATE.
 * ---------------------------------------------------------------------------
 * This package imports nothing — not even three. Everything it does with a
 * renderer is: read `domElement`, call `getContext()`, `setRenderTarget(null)`,
 * `getPixelRatio()`, and read `info.render.calls` / `info.programs.length`.
 * Declaring that shape rather than importing the class means:
 *
 *   · no `three` peerDependency, so this package cannot be the second copy of
 *     three.js — two copies is two `instanceof` universes and the symptom is an
 *     object that renders as nothing with no error at all. Nothing here uses
 *     `instanceof`, so nothing here needs to be in either universe;
 *   · a harness can drive the real shipped watchdogs with a fake renderer and a
 *     fake `readPixels`, which is what this package's test harness does. That is not a
 *     convenience — it is the only way this package's detectors can be SEEN
 *     going red without a GPU, and a detector never seen red is not evidence.
 */

/**
 * The subset of a `THREE.WebGLRenderer` these detectors touch.
 *
 * Every member is written at the looseness three declares it with, so a real
 * renderer is assignable with no cast at the call site: `getContext()` really
 * does return the union, and the games' own code narrows it the same way
 * (`as WebGL2RenderingContext | undefined`) rather than assuming WebGL2.
 */
export interface DiagRenderer {
  readonly domElement: HTMLCanvasElement;
  getContext(): WebGLRenderingContext | WebGL2RenderingContext;
  /** Only ever called with `null`: bind the default framebuffer before a read. */
  setRenderTarget(target: null): void;
  getPixelRatio(): number;
  readonly info: {
    readonly render: { readonly calls: number };
    readonly programs: readonly unknown[] | null;
  };
}

/**
 * What a game hands the detectors each frame.
 *
 * `settings` is optional and narrowed to one number because that is all the GL
 * report reads off it — the quality RUNG, which the engine's boundary rule
 * lists among the things this package is allowed to know. It is not the game's
 * `Settings`; it is the one field of it that appears in a bug report.
 */
export interface FrameHost {
  /** frames presented since boot — the clock both detectors schedule against */
  readonly frame: number;
  /** seconds since boot, wall-clock, for the tear record's timestamp */
  readonly time: number;
  readonly renderer: DiagRenderer;
  readonly settings?: { readonly quality?: number } | undefined;
}

/**
 * The pipeline this package ACTS on, discovered at `globalThis.__render`
 * rather than imported.
 *
 * Duck-typed on purpose, and the direction matters: the engine's dependency
 * graph has the arrow as `diagnostics → render`, so an import the other way
 * would be a cycle. It is also what lets the watchdog exist on a page whose renderer
 * never came up at all — `pipeline()` returns null and the detectors fall back
 * to the banner instead of throwing inside a frame callback.
 */
export interface DegradablePipeline {
  degrade(reason: string): boolean;
  degradeToSafeMaterials(reason: string): boolean;
  rungName(): string;
  sampleFrame(): FrameSample | null;
  capabilities(): unknown;
}

/**
 * Luma statistics of one presented frame, read back off the canvas by the
 * renderer's own `sampleFrame()`.
 *
 * This lived in each game's `Diagnostics.ts` and is imported by their
 * `render/Renderer.ts` (2 sites per game), so it is part of the seam rather
 * than an implementation detail of the classifier.
 */
export interface FrameSample {
  /** fraction of sampled pixels above display luma 12 */
  lit: number;
  mean: number;
  /** luma standard deviation — structure, not brightness */
  sd: number;
  /** false when the read could not be performed at all */
  ok: boolean;
}

/** The live pipeline, or null when nothing has published one. */
export function pipeline(): DegradablePipeline | null {
  const p = (globalThis as unknown as { __render?: Partial<DegradablePipeline> }).__render;
  return p !== undefined && typeof p.degrade === 'function' ? (p as DegradablePipeline) : null;
}
