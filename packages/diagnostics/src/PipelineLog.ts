/**
 * ===========================================================================
 *  @homie-rocks/diagnostics/PipelineLog.ts — the record every layer writes to.
 * ===========================================================================
 *
 * Nobody is going to send a dump. That is the premise the whole file is built
 * on: the log has to be complete enough that a SCREENSHOT OF THE CONSOLE is a
 * bug report, because that is the artifact a real player actually produces.
 *
 * MODULE SCOPE ON PURPOSE. The capability probe runs at `createSettings()`
 * time, which is module scope in `main.ts` and long before any instance of
 * anything exists, and its findings are the most valuable lines in the whole
 * report. A static array is the only place they can go.
 *
 * WHY THIS IS ITS OWN MODULE, AND NOT PART OF `Watchdog.ts`
 * ---------------------------------------------------------------------------
 * `logPipeline` had 63 call sites outside its own file when this package was
 * cut (measured 2026-08-20) and only two of them are in a watchdog: the rest are
 * in `core/Settings.ts` and `render/Renderer.ts` in every game, plus six inside
 * `@homie-rocks/render/caps.ts`. Those files must not pull in a class, a banner and a
 * `document` reference to write one line.
 *
 * IT STILL DOES NOT CROSS INTO `@homie-rocks/render`, AND THAT IS DELIBERATE.
 * ---------------------------------------------------------------------------
 * `packages/render/src/caps.ts` receives its logger by INJECTION —
 * `setPipelineLog()`, with a buffering default sink — because when it was
 * written `logPipeline` lived in each game's `src/core/Diagnostics.ts`, which
 * a package may not import.
 *
 * That reason is now gone, and the injection is KEPT ANYWAY. The arrow in the
 * engine's dependency graph is `diagnostics → render`; `@homie-rocks/render`
 * importing this module is the same arrow backwards, and a cycle between two
 * built packages is a class of failure nobody wants to debug from a black
 * screen. The injection is one function and it already handles the harder half
 * of the problem — the games call `createSettings()` at module scope, so the
 * probe runs during import and a logger wired one tick later would drop every
 * line with no error at all, which is why that sink buffers rather than
 * discards. Changing it would be its own commit.
 */

/** Every capability decision and every degrade, in order. Capped; see below. */
const pipelineLog: string[] = [];

/**
 * Record one capability decision or one degrade step.
 *
 * Everything that changes what the pipeline does must come through here.
 *
 * The cap is 60 lines because this is read by a person scrolling a phone
 * console, and an unbounded log of a repeating failure buries the four lines
 * that explain it under ten thousand copies of the symptom.
 */
export function logPipeline(step: string, detail = ''): void {
  const line = detail === '' ? `[gl:${step}]` : `[gl:${step}] ${detail}`;
  if (pipelineLog.length < 60) pipelineLog.push(line);
  console.info('%c' + line, 'color:#8ab4ff');
}

export function readPipelineLog(): readonly string[] {
  return pipelineLog;
}

/* ========================================================================== */
/* Shader failures                                                            */
/* ========================================================================== */

const shaderErrors: string[] = [];
/** Names of the material families that failed, deduplicated. */
const failedMaterials = new Set<string>();

/**
 * three's own type names, for the one path that only ever sees text: the
 * `console.error` interception below, which catches shader failures raised
 * before the renderer's hook exists (postprocessing's own materials, and
 * anything compiled during a context restore).
 *
 * It is deliberately NOT how the main path classifies a failure. Every world
 * material in these games carries a custom name, so a test for three's type
 * names matches none of them; the renderer sniffs the fragment source for the
 * lighting chunks instead and tells us the answer. See `describeProgram` in the
 * games' `render/Renderer.ts`.
 */
const WORLD_MATERIAL = /Mesh(Standard|Physical|Lambert|Phong|Toon)Material/;

/**
 * Called by the renderer's own `debug.onShaderError` hook, which fires with the
 * driver's real info log. Setting that hook SUPPRESSES three's default
 * `console.error`, so this is now the only place the text exists — it must
 * record and re-emit both.
 *
 * `isWorldMaterial` is the renderer's verdict on whether the failing program
 * was one of the lit families the visible world is built from. A rejected
 * post-processing effect costs a look; a rejected lit material costs the world.
 */
export function recordShaderError(text: string, label: string, isWorldMaterial: boolean): void {
  if (shaderErrors.length < 40) shaderErrors.push(text.slice(0, 900));
  if (isWorldMaterial) failedMaterials.add(label);
}

export function worldMaterialsFailed(): number {
  return failedMaterials.size;
}

/** Live array, by reference, exactly as the GL report has always carried it. */
export function readShaderErrors(): string[] {
  return shaderErrors;
}

export function failedMaterialNames(): string[] {
  return Array.from(failedMaterials);
}

/**
 * Capture shader diagnostics that do NOT come through the renderer hook —
 * postprocessing compiles its own materials, and anything three logs before
 * `debug.onShaderError` is installed lands here.
 *
 * It wraps `console.error` and re-emits every call: swallowing one would make
 * this file the reason a real error went missing.
 */
export function interceptConsoleShaderErrors(): void {
  const realError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
    if (/shader|glsl|program|compile|link/i.test(text) && shaderErrors.length < 40) {
      shaderErrors.push(text.slice(0, 900));
      const m = text.match(/Material Type:\s*(\S+)/);
      if (m !== null && m[1] !== undefined && WORLD_MATERIAL.test(m[1])) failedMaterials.add(m[1]);
    }
    realError(...args);
  };
}
