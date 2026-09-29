/**
 * ===========================================================================
 *  @homie-rocks/render/caps.ts — what the driver DOES, not what it SAYS.
 * ===========================================================================
 *
 * MOVED HERE, NOT REWRITTEN. This block was lines 45-575 of the settings module
 * in a first-person shooter, a kart racer and a space racer. The two racers
 * were BYTE-IDENTICAL over the whole file and the shooter differed from them by
 * FOUR lines, none of them in this block and none of them structural. So three
 * copies of 531 lines existed to hold four lines of difference, and those four
 * lines are a feature the shooter has that the other two lack: the saved
 * quality preference, below.
 *
 * A base-building game became the FOURTH CONSUMER on 2026-08-20, and this
 * paragraph used to say it never would. The old text — "its Settings.ts
 * diverges by 66 structural lines (22%) and it has no `Settings` interface in
 * its types at all" — was TRUE and was about the wrong unit. Both facts are
 * still facts about that FILE, which also holds `GameSettings`, `PRESETS`,
 * `DYNAMIC_LIGHTS`, `Prefs` and `createSettings()`; every one of those stayed
 * in the game, exactly as they did for the other three. Measured on its own,
 * the capability block diverged by TWENTY structural lines, and nineteen of
 * them were one missing field, a query string read two ways, and brace style.
 * The exclusion held for three months for a reason other than the one written
 * down, which is why the number that was measured is quoted here beside the
 * unit it was measured over.
 *
 * That game brought `maxAnisotropy` with it — see the field's own note — and
 * took a STRICTER trial program than it had: this package's TRIAL_VERT/TRIAL_FRAG
 * declare a `vShadowCoord` varying its own did not, which is a better question
 * to ask on behalf of a game with 199 shadow references in its source.
 * (Measured: all three original games carried the varying and the
 * base-building game never did.)
 *
 * The settings module was split in two: the device half (`profileDevice`,
 * `DeviceProfile`) is `@homie-rocks/device`, and this is the other half.
 * The arrow that must not exist is `@homie-rocks/device` → `@homie-rocks/render`: the
 * device profile has consumers in input, ui and audio that must never depend on
 * the renderer, which is why it is the zero-dependency package and this is not.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS CHANGED ON THE WAY OUT, AND BOTH ARE HERE RATHER THAN HIDDEN.
 * ---------------------------------------------------------------------------
 *
 * 1. `Quality` IS NO LONGER A `const enum`, AND IT CANNOT BE.
 *
 *    In the games it was `export const enum Quality { Low = 0 … Ultra = 3 }`,
 *    which the compiler INLINES at every use site. Inlining does not happen
 *    across a module boundary under `isolatedModules` + `verbatimModuleSyntax`,
 *    both of which this repo sets in tsconfig.base.json. A package exporting a
 *    const enum therefore hands its consumers a name that type-checks and is
 *    `undefined` at runtime — and `undefined >= 3` is `false`, silently, with
 *    no error anywhere. Measured surface: 175 `Quality.<member>` uses across
 *    the three games, of which 26 are ORDERED comparisons (`q >= Quality.High`
 *    and friends), so the integer ordering 0<1<2<3 is load-bearing.
 *
 *    The frozen-object form below is the usual cure for exactly this. Every one
 *    of the 175 call sites reads identically — `Quality.Ultra` is still `3` —
 *    and the value now exists at runtime. A fault-injection check that erases
 *    the enum (`const-enum-erased`) exists to keep it that way.
 *
 * 2. THE DIAGNOSTIC LOG IS INJECTED, AND IT BUFFERS UNTIL IT IS WIRED.
 *
 *    `glCapabilities()` calls `logPipeline()` six times and every one is on a
 *    FAILURE path: "EXT_color_buffer_half_float is advertised but an RGBA16F
 *    attachment is incomplete" is what a uniformly black canvas looks like from
 *    the outside, and these lines are the only external evidence it produces.
 *
 *    `logPipeline` USED TO LIVE in each game's diagnostics module, and the
 *    reason written here was that a package may not import a game. **That
 *    reason expired on 2026-08-20** — `@homie-rocks/diagnostics` landed, and
 *    `logPipeline` is now `@homie-rocks/diagnostics/PipelineLog.js`, which this
 *    package could import.
 *
 *    IT IS STILL INJECTED, AND THE SEAM DID NOT MOVE. The dependency arrow is
 *    `diagnostics → render`: the diagnostics package reads a rung name and a
 *    frame sample off the pipeline. `@homie-rocks/render` importing
 *    `@homie-rocks/diagnostics` would be that arrow backwards and a cycle
 *    between two BUILT packages, which is a class of failure that presents as a
 *    blank page with no error. One function stays injected so that cannot
 *    happen. Correcting the reason rather than deleting the paragraph is
 *    deliberate: a comment that has become false is how a guard gets removed
 *    for being unnecessary.
 *
 *    The obvious version of the injection has a hazard worth stating:
 *    the games call `createSettings()` at MODULE SCOPE in `main.ts`, so the
 *    capability probe runs during import, and a logger wired even one tick later
 *    would drop every line with no error at all. The struct would be identical,
 *    every tier would be identical, and the page would simply lose the one thing
 *    that can explain a black screen.
 *
 *    So the default sink BUFFERS rather than discarding, and `setPipelineLog()`
 *    flushes what it missed before taking over. Late wiring costs ordering
 *    against other log sources, never content. This is a deliberate improvement
 *    on the original — three copies of which could not have this bug, because
 *    the import was direct — and it is the mitigation for a hazard the move
 *    itself introduces.
 */
import { device, type DeviceProfile } from '@homie-rocks/device/Device.js';
import { Quality } from './quality.js';

// Compatibility surface: existing consumers import Quality from caps.ts.
// The definition itself is dependency-free so foundational `types.ts` files
// do not have to evaluate this module's capability and logger state.
export { Quality };

/**
 * ---------------------------------------------------------------------------
 * THE SAVED QUALITY PREFERENCE, AND WHY IT IS HERE RATHER THAN IN THREE GAMES.
 * ---------------------------------------------------------------------------
 * The shooter resolved the tier like this:
 *
 *     const prefQ  = loadPrefs().quality;
 *     const forced = params.get('quality') || (prefQ !== 'auto' ? prefQ : null);
 *
 * The two racers resolved it like this:
 *
 *     const forced = params.get('quality');
 *
 * Those four lines were the ENTIRE difference between three otherwise
 * byte-identical files, and they are not drift — they are a feature one game
 * has and two do not. In the racers a guest who turns the quality down, because
 * the machine is warm or their phone is weak, has that forgotten on the next
 * launch and every launch after it, silently and with no message. Four
 * implementations means for every capability one is best and three are not; on
 * this one the shooter is best, and this function is it, shared.
 *
 * THE PRECEDENCE IS THE WHOLE CONTENT AND IT IS DELIBERATE:
 *   1. `?quality=` — a harness or a diagnostic asking for a specific tier. It
 *      wins over everything so a capture stays deterministic no matter what is
 *      in this browser's storage.
 *   2. the stored preference, unless it is 'auto' — a person's own choice.
 *   3. `detectQuality(dev)` — what the machine can take.
 *
 * An unrecognised `?quality=` string falls to High rather than throwing, which
 * is the shooter's behaviour preserved exactly. It is a diagnostic parameter,
 * and a typo in one should not stop a game booting in front of its players.
 */
export const QUALITY_PREFS = ['auto', 'low', 'medium', 'high', 'ultra'] as const;
export type QualityPref = (typeof QUALITY_PREFS)[number];

export function resolveQuality(
  urlParam: string | null,
  stored: QualityPref,
  dev: DeviceProfile,
): Quality {
  const forced = urlParam || (stored !== 'auto' ? stored : null);
  if (!forced) return detectQuality(dev);
  const byName: Record<string, Quality> = {
    low: Quality.Low, medium: Quality.Medium, high: Quality.High, ultra: Quality.Ultra,
  };
  return byName[forced] ?? Quality.High;
}

/**
 * The quality tier is defined in dependency-free `quality.ts` and re-exported
 * here. It remains a frozen object plus a union type, NOT a `const enum` — see
 * (1) in the file header; this is the single most breakable thing here.
 */
/**
 * What one quality tier turns on.
 *
 * DELIBERATELY STRUCTURAL, and not the games' `Settings` type. A game's
 * `Settings` is that game's; three of them agree today and a fourth does not
 * even have one. This package owns the TABLE keyed by tier, never the shape of
 * a game's settings object, so nothing from a game's own types crosses the
 * seam — not even as `import type`, because a package must never depend on a
 * game.
 */
export interface TierSettings {
  maxPixelRatio: number;
  shadows: boolean;
  ssao: boolean;
  bloom: boolean;
  motionBlur: boolean;
  dof: boolean;
  renderScale: number;
  volumetrics: boolean;
  reflections: boolean;
  particleDensity: number;
  foliageDensity: number;
}

/**
 * The diagnostic sink. See (2) in the file header for why it buffers.
 *
 * `pending` is bounded at the same 60 lines the games' own ring buffer holds,
 * so a consumer that never wires a logger cannot grow this without limit — an
 * unbounded buffer waiting for a call that never comes is a leak wearing a
 * mitigation's clothes.
 */
type PipelineLog = (step: string, detail?: string) => void;
const pending: Array<[string, string]> = [];
let sink: PipelineLog | null = null;

export function setPipelineLog(fn: PipelineLog): void {
  sink = fn;
  // Flush what arrived before the game got here. Ordering against other log
  // sources is lost; content is not.
  while (pending.length) {
    const entry = pending.shift();
    if (entry) fn(entry[0], entry[1]);
  }
}

/**
 * Exported for `settings.ts`, which is the same package and must reach the same
 * sink. It is deliberately NOT how a game logs — a game has its own
 * `logPipeline` and injects it above; this is the buffer's own end of it.
 */
export function logPipeline(step: string, detail = ''): void {
  if (sink) { sink(step, detail); return; }
  if (pending.length < 60) pending.push([step, detail]);
}

export interface GLCapabilities {
  /** a WebGL2 context could be created at all — false means the game cannot run */
  webgl2: boolean;
  /** the extension string claims a renderable float colour buffer */
  halfFloatExtension: boolean;
  /** an RGBA16F colour attachment was built, reported COMPLETE and cleared */
  halfFloatRenderable: boolean;
  /** the same, for the 8-bit fallback the composer drops to */
  byteRenderable: boolean;
  /** float textures can be sampled with linear filtering (PMREM, AO) */
  floatLinear: boolean;
  /** a representative GLSL ES 3.00 program compiled and linked */
  trialProgram: boolean;
  /** whatever the driver said about it — empty on success */
  trialLog: string;
  maxTextureSize: number;
  maxRenderbufferSize: number;
  maxSamples: number;
  /**
   * The driver's anisotropic-filtering ceiling, or 1 where
   * `EXT_texture_filter_anisotropic` is absent — NEVER 0, so a caller may divide
   * by it or pass it straight to `Math.min` without a guard.
   *
   * ADDED FOR THE BASE-BUILDING GAME, AND IT IS THE ONE FIELD THIS PACKAGE
   * GAINED TO TAKE A FOURTH CONSUMER. Purely additive: the other three games
   * read fields by name and none of them reads this one, so their struct grew
   * and nothing they do with it changed. That is measured, not asserted — a
   * fault-injection check that deletes the field (`aniso-dropped`) reddens THE
   * BASE-BUILDING GAME ALONE, because the capability check walks the keys of a
   * baseline captured before any of this moved.
   *
   * WHAT ACTUALLY READS IT, said plainly rather than overclaimed. All four
   * games' art direction asks for `anisotropy = min(8, maxAnisotropy)` on every
   * ground surface, and the base-building game once shipped textbook moire on a
   * pad decal. But the code that acts on that number reads three.js's own
   * `renderer.capabilities.getMaxAnisotropy()` in that game's renderer, not
   * this field. This field's live consumer is the DIAGNOSTIC DUMP, which
   * serialises the WHOLE struct as `capabilities: glCapabilities()` — which is
   * why grepping the dump for `maxAnisotropy` finds nothing and the field is
   * live anyway. (The dump's EXTENSION-NAME list, a few lines away, reports
   * whether EXT_texture_filter_anisotropic exists — a different fact — and a
   * reader who checked that would conclude the field was dead and delete it.) A
   * console paste from a stranger whose ground textures shimmer is exactly the
   * report where "the driver's ceiling was 1" is the answer. It is not dead,
   * and it is not the thing that sets filtering; both halves of that are true
   * and only saying the first would make the next person delete it or trust it.
   */
  maxAnisotropy: number;
  vendor: string;
  renderer: string;
  /** SwiftShader / llvmpipe / ANGLE-on-CPU, i.e. a headless capture or CI */
  software: boolean;
}

/**
 * Forced failures, for the fallback tests. `?glfail=halffloat,composer,...`
 *
 * Only two of the five failure conditions this code has to survive can be
 * forced from outside the app (`getContext` and `getExtension` are patchable
 * from the page); the rest are internal, and a fallback that has never been
 * executed is decoration. Parsed once, empty in normal play, and every consumer
 * of it is a single `has()` on a Set that is empty on every real device.
 */
/**
 * THE WHOLE VOCABULARY, IN ONE PLACE, BECAUSE A FAULT SWITCH THAT ACCEPTS
 * ANYTHING ACCEPTS A TYPO.
 *
 * `?glfail=halfloat` — one letter short of `halffloat` — used to produce a
 * completely healthy boot with zero errors and nothing said, which is a fault
 * test reporting PASS while testing nothing. Measured on a game before this
 * changed: `__gameReady` true, 0 page errors, 0 console errors, and a ring
 * buffer with no mention of the parameter at all. This repository's own rule is
 * that a fault whose anchor is missing must fail LOUDLY; the switch that fires
 * the faults was the one place not obeying it.
 *
 * TWO OF THESE FIVE ARE CONSUMED BY THE GAMES, NOT BY THIS FILE. `composer` and
 * `trial` are read in each game's renderer. Listing them here is a deliberate
 * choice over a `registerFailureName()` call the games would make, and the
 * reason is ORDERING: this set is parsed at module scope, and a game's renderer
 * is imported long after its settings, so any registration API would
 * validate the string BEFORE the names were registered and reject two valid
 * ones on every run. Both words are WebGL-pipeline vocabulary — a
 * post-processing composer, a trial program — so neither crosses the platform
 * boundary. If a game adds a sixth, it is added here, and forgetting to is the
 * failure this list makes loud rather than silent.
 */
export const GL_FAILURE_NAMES: readonly string[] = [
  'webgl2',    // getContext('webgl2') returns null
  'halffloat', // the float colour-buffer extension is refused
  'material',  // the trial program is reported as failing to compile
  'composer',  // a game's renderer: the post-processing composer throws
  'trial',     // a game's renderer: the material trial reports failure
  // The adaptive resolution ladder loses its authority over buffer size above
  // the pixel backstop — the defect `effectivePixelRatio`'s long comment
  // records, restored on purpose so a parity probe can be seen red. It is a
  // SIXTH name added by a consumer, which is the case the paragraph above says
  // must be added here rather than registered, and it is consumed by the
  // render pipeline (this package's pipeline.ts; the games' renderers before
  // it moved here).
  'ladder',
  // The shadow pass stops being counted separately, so its draws are reported
  // as the scene's — a real earlier defect, restored on purpose. Consumed by
  // this package's pipeline.ts.
  'shadowcount',
];

/**
 * Forced failures, for the fallback tests.
 * `?glfail=webgl2,halffloat,material,composer,trial`
 *
 * Only two of the five failure conditions this code has to survive can be
 * forced from outside the app (`getContext` and `getExtension` are patchable
 * from the page); the rest are internal, and a fallback that has never been
 * executed is decoration. Parsed once, empty in normal play, and every consumer
 * of it is a single `has()` on a Set that is empty on every real device.
 */
const REQUESTED_FAILURES: readonly string[] = (typeof location !== 'undefined'
  ? (new URLSearchParams(location.search).get('glfail') || '')
  : '').split(',').map((s) => s.trim()).filter(Boolean);

const FORCED_FAILURES: ReadonlySet<string> = new Set(
  REQUESTED_FAILURES.filter((n) => GL_FAILURE_NAMES.includes(n)),
);

{
  // Said at module scope, so it is said before anything can act on the set.
  // logPipeline() buffers until a consumer wires its sink, so this line still
  // reaches the game's own ring buffer — and console.error carries it to the
  // person who typed the URL, who is the only audience a ?glfail= has.
  const unknown = REQUESTED_FAILURES.filter((n) => !GL_FAILURE_NAMES.includes(n));
  if (unknown.length > 0) {
    const msg = `?glfail= does not know ${unknown.join(', ')} — NOTHING WAS FORCED and this run is a normal one. Known names: ${GL_FAILURE_NAMES.join(', ')}`;
    logPipeline('glfail', msg);
    console.error('[gl:glfail] ' + msg);
  }
}

const askedUnknown = new Set<string>();

/**
 * Names that a `forcedFailure()` call actually RETURNED TRUE for, i.e. switches
 * that fired rather than switches that were merely typed into a URL.
 *
 * The list above makes an unknown name loud, and `askedUnknown` makes a rotted
 * call site loud. Neither answers the third question, which is the one a
 * harness needs: **did the code path carrying the fault run at all?** A fault
 * aimed at a branch that boot never reaches leaves the URL correct, the name
 * known, the call site present — and injects nothing, which reads as a clean
 * green pass. That is the rotted-anchor shape one rung further in, and it is
 * how `window.__probeFault` once sat unread while three faults aimed through it
 * all reported green.
 *
 * So a probe asserts against this rather than against its own URL: a run that
 * asked for a fault and finds the name absent here is BLOCKED, not passing.
 */
const consumed = new Set<string>();

/** The forced-failure names that have actually fired in this page. */
export function consumedFailures(): string[] {
  return [...consumed];
}

export function forcedFailure(name: string): boolean {
  // The same defect from the other side: a call site asking for a name the
  // vocabulary does not hold is a fault switch that can never fire, which is
  // the rotted-anchor shape — five of those validated nothing for a whole
  // project while reporting green. Said once per name, never per call, because
  // this runs on paths that execute more than once.
  if (!GL_FAILURE_NAMES.includes(name) && !askedUnknown.has(name)) {
    askedUnknown.add(name);
    const msg = `forcedFailure(${JSON.stringify(name)}) is not in GL_FAILURE_NAMES — this switch can never fire`;
    logPipeline('glfail', msg);
    console.error('[gl:glfail] ' + msg);
  }
  const forced = FORCED_FAILURES.has(name);
  if (forced) consumed.add(name);
  return forced;
}

/**
 * Empties the GL error queue so the next check reads its OWN result.
 *
 * BOUNDED, and that bound is load-bearing rather than defensive: `getError`
 * normally clears the flag it returns, so the obvious `while` terminates — but
 * a context in the LOST state returns `CONTEXT_LOST_WEBGL` on every call
 * forever, and a lost context is exactly the situation this code exists to
 * survive. An unbounded drain there hangs the tab, which is a worse failure
 * than the one being diagnosed.
 */
export function drainErrors(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
  for (let i = 0; i < 16; i++) {
    if (gl.getError() === gl.NO_ERROR) return;
  }
}

/**
 * Builds a colour attachment of the given format and asks the driver whether
 * it would actually render into it. Returns false on anything short of
 * FRAMEBUFFER_COMPLETE with a clean error queue after a real clear.
 */
function attachmentWorks(
  gl: WebGL2RenderingContext, internalFormat: number, format: number, type: number,
): boolean {
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  const prevTex = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  let ok = false;
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 8, 8, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    ok = status === gl.FRAMEBUFFER_COMPLETE;
    if (ok) {
      // Completeness is necessary and not sufficient — clear it and make sure
      // the driver did not raise on the way.
      drainErrors(gl);
      gl.viewport(0, 0, 8, 8);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      ok = gl.getError() === gl.NO_ERROR;
    }
  } catch {
    ok = false;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
  gl.bindTexture(gl.TEXTURE_2D, prevTex);
  gl.deleteFramebuffer(fb);
  gl.deleteTexture(tex);
  return ok;
}

/**
 * A trial program shaped like the materials this game actually ships: a
 * struct-array light loop, derivatives, textureLod, a tangent frame and a full
 * varying set. If a driver is going to reject the PBR family — the leading
 * theory for the empty-world reports — it rejects this too, and it says why.
 */
const TRIAL_VERT = `#version 300 es
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec3 vNormal;
out vec3 vView;
out vec2 vUv;
out vec4 vShadowCoord;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  vShadowCoord = mv;
  gl_Position = projectionMatrix * mv;
}`;

const TRIAL_FRAG = `#version 300 es
precision highp float;
precision highp int;
struct TrialLight { vec3 direction; vec3 color; };
uniform TrialLight trialLights[4];
uniform sampler2D trialMap;
uniform sampler2D trialNormalMap;
uniform float trialRoughness;
in vec3 vNormal;
in vec3 vView;
in vec2 vUv;
in vec4 vShadowCoord;
out vec4 fragColor;
vec3 trialTangentNormal(vec3 n) {
  vec3 q0 = dFdx(vView), q1 = dFdy(vView);
  vec2 st0 = dFdx(vUv), st1 = dFdy(vUv);
  vec3 t = normalize(q0 * st1.t - q1 * st0.t);
  vec3 b = normalize(cross(n, t));
  vec3 m = texture(trialNormalMap, vUv).xyz * 2.0 - 1.0;
  return normalize(mat3(t, b, n) * m);
}
void main() {
  vec3 n = trialTangentNormal(normalize(vNormal));
  vec3 v = normalize(vView);
  vec3 base = textureLod(trialMap, vUv, 1.0).rgb;
  float rough = clamp(trialRoughness + fwidth(vUv.x), 0.04, 1.0);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 4; ++i) {
    vec3 l = normalize(trialLights[i].direction);
    vec3 h = normalize(l + v);
    float a = rough * rough;
    float d = max(dot(n, h), 0.0);
    float ggx = a * a / max(3.14159 * pow(d * d * (a * a - 1.0) + 1.0, 2.0), 1e-4);
    sum += trialLights[i].color * (max(dot(n, l), 0.0) * base + ggx);
  }
  sum += base * 0.02 * vShadowCoord.w;
  fragColor = vec4(sum, 1.0);
}`;

function trialCompile(gl: WebGL2RenderingContext): { ok: boolean; log: string } {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  const prog = gl.createProgram();
  const logs: string[] = [];
  let ok = false;
  try {
    if (vs === null || fs === null || prog === null) return { ok: false, log: 'could not create shader objects' };
    gl.shaderSource(vs, TRIAL_VERT);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) logs.push('vertex: ' + (gl.getShaderInfoLog(vs) || 'failed'));
    gl.shaderSource(fs, TRIAL_FRAG);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) logs.push('fragment: ' + (gl.getShaderInfoLog(fs) || 'failed'));
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    ok = gl.getProgramParameter(prog, gl.LINK_STATUS) === true && logs.length === 0;
    if (!ok) logs.push('link: ' + (gl.getProgramInfoLog(prog) || 'failed'));
  } catch (err) {
    logs.push('threw: ' + String(err));
    ok = false;
  }
  if (vs !== null) gl.deleteShader(vs);
  if (fs !== null) gl.deleteShader(fs);
  if (prog !== null) gl.deleteProgram(prog);
  return { ok, log: ok ? '' : logs.join('\n').slice(0, 900) };
}

const NO_GL: GLCapabilities = {
  webgl2: false, halfFloatExtension: false, halfFloatRenderable: false, byteRenderable: false,
  floatLinear: false, trialProgram: false, trialLog: 'no WebGL2 context',
  maxTextureSize: 0, maxRenderbufferSize: 0, maxSamples: 0,
  // 0 here, not 1, and it disagrees with the live probe's floor DELIBERATELY.
  // Every other ceiling in this record is 0 in the no-context case because the
  // honest answer is "nothing"; `min(8, 0)` is 0, which is not a legal
  // anisotropy, and that is fine because there is no GL to hand it to. The 1
  // floor below is for a REAL context that merely lacks the extension, where a
  // caller will pass the number to three.js. The base-building game's own copy
  // wrote it the same way and this is the reasoning, which was not written
  // down there.
  maxAnisotropy: 0,
  vendor: 'unknown', renderer: 'unknown', software: false,
};

let caps: GLCapabilities | null = null;

/** The one capability record. Probed on first call, then memoised. */
export function glCapabilities(): GLCapabilities {
  if (caps !== null) return caps;
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    gl = forcedFailure('webgl2')
      ? null
      : canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null;
  } catch {
    gl = null;
  }
  if (gl === null) {
    caps = { ...NO_GL };
    logPipeline('probe', 'no WebGL2 context — the game cannot render');
    return caps;
  }

  // The extension has to be REQUESTED before RGBA16F is colour-renderable, so
  // this call is part of the experiment and not merely a question.
  const halfExt = forcedFailure('halffloat')
    ? false
    : gl.getExtension('EXT_color_buffer_half_float') !== null ||
      gl.getExtension('EXT_color_buffer_float') !== null;

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg !== null ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const vendor = dbg !== null ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) : '';
  // Requested here rather than beside the getParameter below, because
  // getExtension is what ENABLES the enum that reads the ceiling: asking for
  // MAX_TEXTURE_MAX_ANISOTROPY_EXT without holding the extension object is an
  // INVALID_ENUM that returns null and leaves an error in the queue for the
  // next check to read as its own. drainErrors() exists because a sibling
  // already did that once.
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');

  const halfRenderable = halfExt &&
    !forcedFailure('halffloat') &&
    attachmentWorks(gl, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
  const byteRenderable = attachmentWorks(gl, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const trial = forcedFailure('material')
    ? { ok: false, log: 'forced by ?glfail=material' }
    : trialCompile(gl);

  caps = {
    webgl2: true,
    halfFloatExtension: halfExt,
    halfFloatRenderable: halfRenderable,
    byteRenderable,
    floatLinear: gl.getExtension('OES_texture_float_linear') !== null,
    trialProgram: trial.ok,
    trialLog: trial.log,
    maxTextureSize: (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 0,
    maxRenderbufferSize: (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 0,
    maxSamples: (gl.getParameter(gl.MAX_SAMPLES) as number) || 0,
    // 1, not 0, when the extension is absent: 1 IS the isotropic ceiling every
    // GL implementation supports, so `min(8, maxAnisotropy)` stays legal on a
    // driver that has no anisotropic filtering at all. Reporting 0 here would
    // hand three.js a value it rejects on exactly the weak devices this whole
    // file exists to survive.
    maxAnisotropy: aniso !== null
      ? (gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) || 1 : 1,
    vendor,
    renderer,
    software: /SwiftShader|llvmpipe|Software|Microsoft Basic|Mesa OffScreen|ANGLE \(Software/i.test(renderer),
  };

  // Everything that is not the happy path is written down, because the next
  // person to see it will be reading a console paste from a stranger.
  if (halfExt && !halfRenderable) {
    logPipeline('probe', 'EXT_color_buffer_half_float is advertised but an RGBA16F ' +
      'attachment is NOT complete — falling back to an 8-bit composer buffer');
  } else if (!halfExt) {
    // THE SECOND CLAUSE CAME FROM THE BASE-BUILDING GAME AND IT IS THE HALF
    // THAT IS USEFUL.
    // Three of the four games printed the first clause only, which tells the
    // reader a format changed and not what they are about to be looking at.
    // The consequence is the report: an 8-bit buffer clamps at 1.0 BEFORE
    // bloom, so every threshold authored against HDR values selects the empty
    // set and the picture arrives correct-but-flat, with no error anywhere.
    // "Bloom stopped working on my laptop" is the bug that gets filed, and
    // this line is the answer to it.
    logPipeline('probe', 'no renderable float colour buffer — 8-bit composer buffer. ' +
      'An 8-bit buffer clamps at 1.0 BEFORE bloom, so every HDR-authored bloom ' +
      'threshold selects the empty set');
  }
  if (!byteRenderable) logPipeline('probe', 'even an RGBA8 attachment is incomplete — off-screen targets are unusable');
  if (!trial.ok) logPipeline('probe', 'a representative material FAILED to compile/link: ' + trial.log);

  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return caps;
}

export function detectQuality(dev: DeviceProfile): Quality {
  const gl = glCapabilities();
  if (!gl.webgl2) return Quality.Low;

  // A phone gets Low, and that is a deliberate change from the Medium this used
  // to hand out. Medium leaves shadows, motion blur and full-resolution render
  // targets on, and measured at 220 MB of texture memory against a budget of
  // 80 — the reported "crashes after ten seconds" on a real device. A 390 CSS-px
  // panel does not need any of it.
  if (dev.handheld) return Quality.Low;
  if (dev.touchPrimary) {
    // Tablet. More thermal and memory headroom than a phone, nowhere near a
    // discrete GPU. Weak ones (<= 4 cores, <= 4 GB) drop to Low with the phones.
    const weak = (dev.cores > 0 && dev.cores <= 4) || (dev.memoryGB > 0 && dev.memoryGB <= 4);
    return weak ? Quality.Low : Quality.Medium;
  }

  const name = gl.renderer;
  // Software rasterisers (SwiftShader / llvmpipe / ANGLE-on-CPU) show up in CI
  // and headless captures; they cannot take the full pipeline at speed but we
  // still want the full *look*, so they get High rather than Low.
  if (gl.software) return Quality.High;
  if (/Apple M[0-9]|RTX|Radeon RX|Arc A/i.test(name)) return Quality.Ultra;
  return Quality.High;
}

/**
 * Maximum texture edge length per tier, in texels.
 *
 * High and Ultra are set at or above the largest texture the game authors
 * (2048, the sign atlas), so the desktop look is bit-for-bit what it was. The
 * cap only ever bites on the two tiers a touch device can reach.
 *
 * The art direction's "minimum 1024² for anything the camera gets within 5 m of"
 * is a desktop standard and is met on the desktop tiers. THE MOBILE CLAUSE:
 * on a handheld, 1024² over a 3.5 m tile is 290 texels per metre against a
 * panel that is 390 CSS px tall — the texel density is an order of magnitude
 * past the pixel density, so every one of those texels is resolved by a mip
 * the hardware builds and then never samples the top of. 256² is the honest
 * number there, and it is the difference between a game and a crash.
 *
 * RE-DERIVED FOR THE SHARPER HANDHELD BUFFER. The Low tier now renders at
 * 1.51x CSS instead of 0.70x, so the pixel density it has to keep up with went
 * up 2.2x in each axis and the argument above has to be re-run rather than
 * assumed. It survives: 256² over a 3.5 m tile is 73 texels/m, and a 589-px-
 * wide buffer looking down a road ~8 m wide resolves ~74 px/m at the kart and
 * far fewer beyond it, so the top mip is now roughly AT the sampling rate
 * instead of ten times past it. That is the right place to be, and there is no
 * room to go further anyway. Measured with `?texcap=` on the 390x844 profile:
 *
 *     256 -> 36.0 MB     384 -> 37.6 MB     512 -> 83.5 MB
 *
 * against the mobile soak's 80 MB budget, so 512 is out. 384 looks nearly free
 * and is a trap: `setTextureBudget` SLICES a hand-built mip chain rather than
 * resampling it (see Textures.ts, which is why the foliage alpha coverage and
 * the kart lacquer roughness chain survive the cap at all), and a slice can
 * only ever halve. A non-power-of-two cap is therefore honoured by the
 * resampling path and rounded down to 256 by the slicing path — which is why
 * it buys 1.6 MB instead of the ~2.25x it looks like it should. Half a cap is
 * worse than either whole one.
 */
export const TEXTURE_CAP: Record<Quality, number> = {
  [Quality.Low]: 256,
  [Quality.Medium]: 512,
  [Quality.High]: 2048,
  [Quality.Ultra]: Infinity,
};

export const PRESETS: Record<Quality, TierSettings> = {
  [Quality.Low]: {
    // ---------------------------------------------------------------------
    //  THE PHONE TIER USED TO CUT RESOLUTION TWICE, AND THE SECOND CUT WENT
    //  BELOW THE PANEL'S OWN RESOLUTION.
    // ---------------------------------------------------------------------
    //  This shipped `maxPixelRatio: 1, renderScale: 0.7`. Those are two
    //  independent knobs on the same quantity and they MULTIPLY: measured on a
    //  390x844 panel at devicePixelRatio 3 the drawing buffer came out
    //  273x590 — 0.16 Mpx, which is 0.70x the page's own CSS resolution in
    //  each axis. Below 1.0 the compositor is UPSCALING on present, so every
    //  edge in the frame is resampled and every glyph in the HUD is soft. That
    //  is the "visibly soft on a real phone" report this change removes, and
    //  it was never a measured trade — it was two guesses stacked.
    //
    //  Worse, a third ceiling was already sitting underneath both of them and
    //  never firing: PIXEL_BUDGET_MPX[Low] is 1.2 Mpx, and a phone at ratio 1
    //  draws 0.33. The tier had three resolution policies, two of them binding
    //  and the honest one inert. That is the "one global constant applied
    //  uniformly to things that are not uniform" trap, twice.
    //
    //  So resolution on this tier is now ONE policy: the pixel budget, which
    //  is expressed in the unit the cost actually scales with. `renderScale`
    //  goes back to 1 and is reserved for `?scale=` (a harness knob that
    //  rebuilds the whole effect chain, which is right for a pinned sweep and
    //  wrong for a shipping tier), and `maxPixelRatio` goes to 2 so the budget
    //  — not an arbitrary cap — is what decides.
    //
    //  Measured on the 390x844/dpr-3 profile: 273x590 = 0.16 Mpx at 0.70x CSS
    //  becomes 589x1275 = 0.75 Mpx at 1.51x CSS. 4.6x the pixels, and the
    //  buffer is now ABOVE the panel's own resolution instead of below it, so
    //  nothing is upscaled at all. The game's adaptive ladder may still walk it
    //  down under load, but its floor on a handheld is 1.0x CSS — the softness
    //  is now the bottom of a measured range instead of the starting point.
    //
    //  Everything else here is unchanged. Shadows in particular stay OFF: the
    //  cascade sizes live in the game's sky module and are 2048+2048 = 8.4 Mpx
    //  below Quality.High, which against a 0.75 Mpx screen is eleven times the
    //  frame's own pixel count. A phone tier with shadows needs the cascades
    //  sized to the tier first; that is a render-side change, not a settings
    //  one, and it is the largest remaining quality gap on this tier.
    maxPixelRatio: 2, shadows: false, ssao: false, bloom: true, motionBlur: false,
    dof: false, renderScale: 1, volumetrics: false, reflections: false,
    particleDensity: 0.35, foliageDensity: 0.3,
  },
  [Quality.Medium]: {
    maxPixelRatio: 1.5, shadows: true, ssao: false, bloom: true, motionBlur: true,
    dof: false, renderScale: 1, volumetrics: false, reflections: false,
    particleDensity: 0.6, foliageDensity: 0.6,
  },
  [Quality.High]: {
    maxPixelRatio: 2, shadows: true, ssao: true, bloom: true, motionBlur: true,
    dof: true, renderScale: 1, volumetrics: true, reflections: true,
    particleDensity: 1, foliageDensity: 1,
  },
  [Quality.Ultra]: {
    maxPixelRatio: 2, shadows: true, ssao: true, bloom: true, motionBlur: true,
    dof: true, renderScale: 1, volumetrics: true, reflections: true,
    particleDensity: 1.4, foliageDensity: 1.35,
  },
};

/**
 * ===========================================================================
 *  A PIXEL RATIO IS NOT A BUDGET. A PIXEL COUNT IS.
 * ===========================================================================
 *  `maxPixelRatio: 2` says "up to two drawing-buffer pixels per CSS pixel per
 *  axis" and says nothing whatsoever about how many pixels that is. The two
 *  desktop tiers ship it, and every per-sample cost in the frame — the whole
 *  post chain, which measures at roughly half of it — scales with the product,
 *  not the ratio. So the same setting means:
 *
 *      1920x1080 monitor, dpr 1   ->  2.07 Mpx   (measured 45.6 fps)
 *      1512x982 retina Mac, dpr 2 ->  5.94 Mpx   (measured ~15 fps at 8.29)
 *
 *  Four times the work for the same nominal quality setting, on the machine
 *  this game is developed on. That is not a tuning miss, it is the unit being
 *  wrong.
 *
 *  The game's adaptive ladder cannot rescue it either: `setDynamicScale`
 *  clamps at 0.5, which is a quarter of the pixels, so from 5.94 Mpx the
 *  bottom rung is 1.49 Mpx and 60 fps is simply not reachable from that start.
 *  The ceiling is what puts the ladder within reach of its own target.
 *
 *  Expressed as drawing-buffer megapixels and FLOORED AT RATIO 1, which is the
 *  important half of the rule:
 *
 *   - On a dpr-1 display it is inert. A 1080p monitor and a 4K monitor both
 *     keep ratio 1 and every pixel of the panel, exactly as before; a 4K
 *     monitor that cannot afford 8.29 Mpx is the LADDER's problem, because that
 *     is a reversible, measured decision and this one is a guess made at boot.
 *   - On a dpr-2 panel it trades supersampling, and only supersampling. At the
 *     Ultra ceiling a 1512x982 retina window renders at ratio 1.42 — still
 *     above the panel's CSS resolution, so nothing is being upscaled — instead
 *     of 2.0. Half the fill cost for a difference that needs a loupe, against
 *     an alternative of 15 fps.
 *
 *  THIS IS THE ONLY RESOLUTION POLICY IN THE PROGRAM, AND THAT IS DELIBERATE.
 *  There are two other pixel ceilings in the tree and both must stay inert:
 *
 *    - `Renderer.effectivePixelRatio()` carries a 4.0 Mpx BACKSTOP. Every
 *      budget below is far under it, so on any path this function controls the
 *      backstop can never bind — it exists for a `?scale=` sweep or a settings
 *      object that never came through here. Two live ceilings on one quantity
 *      is the trap; one live ceiling and one documented backstop is
 *      not. `assertBackstopClearance()` below fails loudly if that ordering is
 *      ever broken by a future edit to either file.
 *    - A tier's `renderScale`. It is now 1 on every tier and reserved for
 *      `?scale=`, because it is part of `pipelineSignature` (changing it tears
 *      down and rebuilds the whole effect chain) and because multiplying it by
 *      the ladder's rungs compounds two independent budgets — which is exactly
 *      what produced the phone's 0.70x-CSS buffer.
 *
 *  The numbers were "deliberately generous rather than fitted" and that was the
 *  right call while nothing had been measured on a quiet machine. It has been
 *  now, twice and independently, and both fits agree:
 *
 *      frame_ms = 6.25 + 5.30 * Mpx      (7 points, a frame-time sweep)
 *      frame_ms = 9.51 + 3.91 * Mpx      (4 points, a fill-rate probe)
 *
 *  Both put 16.7 ms at 1.8-2.0 Mpx on this build at Ultra, and both validate
 *  against the 1080p point held out of the fit (2.07 Mpx, measured 16.67-17.20
 *  ms). A 3.0 Mpx Ultra budget was therefore asking a retina window for ~50%
 *  more pixels than the frame has ever been able to afford, which is not
 *  generosity, it is a guaranteed miss.
 *
 *  The budgets below sit ABOVE the fitted number rather than on it — the post
 *  chain and the shadow cascades are being worked on in parallel and a budget
 *  fitted to today's cost would over-cut the moment they get cheaper — but no
 *  longer 50% above it. Every one is a strict reduction except Low, which goes
 *  the other way on purpose. See the Low preset.
 *
 *  Measured deltas at the four profiles the tier probe covers:
 *
 *    1920x1080 dpr 1  Ultra   1920x1080 2.07 Mpx  ->  unchanged (inert at dpr 1)
 *    1512x982  dpr 2  Ultra   2149x1395 3.00 Mpx  ->  1922x1248 2.40 Mpx
 *    1024x1366 dpr 2  Medium  1224x1633 2.00 Mpx  ->  1060x1414 1.50 Mpx
 *    390x844   dpr 3  Low      273x590  0.16 Mpx  ->   589x1275 0.75 Mpx
 *
 *  The two desktop/tablet rows are a QUALITY TRADE and should be read as one:
 *  the retina window goes from 1.42x to 1.27x CSS resolution and the tablet
 *  from 1.20x to 1.04x. Both are still above 1.0, so nothing is upscaled and
 *  no detail is lost — what is given up is supersampling, which is the least
 *  visible pixel in the frame and the only kind of pixel a battery-powered
 *  panel should ever be asked to give up first.
 * ===========================================================================
 */
export const PIXEL_BUDGET_MPX: Record<Quality, number> = {
  // A handheld is the one tier where the budget goes UP. 0.75 Mpx is 1.51x CSS
  // on a 390x844 panel and 1.14x on a 600x960 one, so the tier is sharp on
  // every handheld this classifier can reach rather than soft on all of them.
  [Quality.Low]: 0.75,
  // Tablet. 1.5 Mpx puts a 1024x1366 iPad at 1.04x its own CSS resolution —
  // sharp, not supersampled. It used to be handed 2.00 Mpx, which is within 4%
  // of the pixel count of the 1080p DESKTOP frame that this build measures at
  // 58 fps on an M5, on a fanless device with shadows on.
  [Quality.Medium]: 1.5,
  [Quality.High]: 2.2,
  [Quality.Ultra]: 2.4,
};

/**
 * The invariant that keeps `Renderer`'s 4.0 Mpx backstop from becoming a second
 * live ceiling. Cheap, runs once at boot, and says which file to look in.
 *
 * It is a log rather than a throw on purpose: a mis-ordered ceiling makes the
 * game render at the wrong resolution, which is a bug worth shouting about and
 * not worth refusing to boot over.
 */
export const RENDERER_BACKSTOP_MPX = 4.0;

export function assertBackstopClearance(): void {
  for (const [q, mpx] of Object.entries(PIXEL_BUDGET_MPX)) {
    if (mpx >= RENDERER_BACKSTOP_MPX) {
      logPipeline('settings',
        `PIXEL_BUDGET_MPX[${q}] = ${mpx} is at or above Renderer's ${RENDERER_BACKSTOP_MPX} Mpx ` +
        `backstop — there are now TWO live pixel ceilings and they disagree. ` +
        `Lower the budget here or make the backstop the policy there, not both.`);
    }
  }
}

/**
 * Lowest ratio the ceiling may impose. Below 1 the buffer is smaller than the
 * page's own CSS layout and the compositor is upscaling — a real, visible loss
 * that must be measured and reversible, i.e. the adaptive ladder's job, not a
 * boot-time guess made before a single frame has been timed.
 */
export const MIN_CEILING_RATIO = 1;
