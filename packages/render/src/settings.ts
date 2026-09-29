import { setTextureBudget } from './Textures.ts';
// THE DEVICE PROFILE LIVES IN @homie-rocks/device. `mql`, `NavExtras`,
// `DeviceProfile`, `profileDevice()` and `device()` were byte-identical in all
// four games, so this is a move, not a rewrite.
import { device } from '@homie-rocks/device/Device.js';
import {
  Quality,
  glCapabilities,
  resolveQuality,
  logPipeline,
  TEXTURE_CAP,
  PRESETS,
  PIXEL_BUDGET_MPX,
  assertBackstopClearance,
  MIN_CEILING_RATIO,
  type TierSettings,
  type QualityPref,
} from './caps.ts';

/**
 * ============================================================================
 *  What a quality tier MEANS, once the probe has answered.
 * ============================================================================
 *  This was the whole of `Settings.ts` in a kart racer, a space racer and a
 *  first-person shooter. Measured before the move: `createSettings()` was 108,
 *  108 and 106 raw lines and the three bodies were CODE-IDENTICAL — the only
 *  textual differences were a comment block of a different length in the
 *  shooter and the single line that reads the stored quality. Three copies of
 *  the pixel-count ceiling, three copies of the three capability degrades and
 *  three copies of the texture-cap clamp, each of which is a measured decision
 *  about a real phone.
 *
 *  Every earlier extraction already carved a piece off this file — the device
 *  profile to @homie-rocks/device, the 531-line GPU probe to `caps.ts`, the
 *  tier presets to `PRESETS` — and each time the file's own comments said the
 *  remainder was "what a quality tier means for THIS game". It was not. It was
 *  the same hundred lines three times.
 *
 *  WHAT IS GENUINELY THE GAME'S, AND SO IS STILL THERE:
 *
 *  · **Where a stored quality choice comes from.** The two racers read
 *    `ControlPrefs`, the shooter reads `Prefs`. That is a storage
 *    key and a module path, not a policy — the PRECEDENCE (`?quality=` beats a
 *    stored choice beats `detectQuality`) is `resolveQuality` in caps.ts and
 *    always resolves the same way. So the value arrives as an argument.
 *
 *  · **Wiring the diagnostic sink.** Each game still calls `setPipelineLog()`
 *    in its own module body, and that call's POSITION is load-bearing: main.ts
 *    evaluates `createSettings()` at module scope, so the probe runs during
 *    import, and a module's body runs before any importer's. This module logs
 *    through caps.ts's sink, which is the same function the game injected —
 *    and `setPipelineLog` flushes what buffered before it, so nothing is lost
 *    even if the ordering ever did slip.
 *
 *  THE ARROW STILL POINTS ONE WAY. This does NOT import @homie-rocks/diagnostics.
 *  The package graph has `diagnostics -> render`, and an import the other way
 *  is a cycle between two built packages — which is why the sink was injected
 *  in the first place. The reason the games' files gave for the injection
 *  changed on 2026-08-20 and the injection did not; this is that same line, one
 *  level down.
 * ============================================================================
 */

/** `TierSettings` is what a preset holds; these two are what a game adds. */
export interface RenderSettings extends TierSettings {
  quality: Quality;
  masterVolume: number;
}

/**
 * @param savedQuality what this guest last chose, or `'auto'` if they never
 *   have — a `QualityPref`, not a resolved `Quality`, because "no preference"
 *   has to survive the trip. Read by the game from its own preference store;
 *   the precedence against `?quality=` and the auto-detect is
 *   `resolveQuality`'s and is the same for all three consumers.
 */
export function createSettings(savedQuality: QualityPref): RenderSettings {
  // `device()` memoises on first call, and this IS the first call: main.ts
  // evaluates createSettings() at module scope, before any system that reads
  // the profile exists. It read `deviceProfile = profileDevice()` — an
  // unconditional re-probe of a memo that is null at this point in every
  // game, so the same record reaches the same call sites.
  const dev = device();
  const params = new URLSearchParams(location.search);
  // THE PRECEDENCE — `?quality=` beats a stored choice beats `detectQuality` —
  // is `resolveQuality`'s, in caps.ts. It used to be five lines written out
  // here in the shooter and ABSENT from both racers, which meant a guest who
  // turned the quality down on a warm machine had it forgotten on the next
  // launch and every launch after, silently, in two of the three games. All
  // three resolve it the same way now, and the only thing a game still supplies
  // is where it keeps the answer.
  const q: Quality = resolveQuality(params.get('quality'), savedQuality, dev);
  const s: RenderSettings = { quality: q, masterVolume: 0.8, ...PRESETS[q] };
  // ?scale=0.75 etc. lets a screenshot run trade resolution for time
  const scale = parseFloat(params.get('scale') || '');
  if (Number.isFinite(scale) && scale > 0) s.renderScale = scale;

  // ---- pixel-count ceiling ------------------------------------------------
  // See PIXEL_BUDGET_MPX. Applied against the ratio the renderer will actually
  // allocate at, which is `min(dpr, maxPixelRatio) * renderScale` — so the
  // budget has to be divided through by renderScale here or a tier that already
  // renders small would be charged twice for it.
  //
  // `innerWidth`/`innerHeight` rather than `screen`: the canvas fills `#app`,
  // which is the window, not the panel. On a phone the visual viewport wobbles
  // with the URL bar, which does not matter — the floor makes this inert at
  // dpr 1 and a handheld is nowhere near the Low budget in any case.
  assertBackstopClearance();
  const cssPx = (globalThis.innerWidth || 0) * (globalThis.innerHeight || 0);
  const budgetMpx = parseFloat(params.get('mpx') || '');
  const budget = (Number.isFinite(budgetMpx) && budgetMpx > 0 ? budgetMpx : PIXEL_BUDGET_MPX[q]) * 1e6;
  if (cssPx > 0) {
    const ceiling = Math.sqrt(budget / (cssPx * s.renderScale * s.renderScale));
    const capped = Math.max(MIN_CEILING_RATIO, Math.min(s.maxPixelRatio, ceiling));
    if (capped < s.maxPixelRatio - 1e-3) {
      logPipeline('settings',
        `pixel ceiling: maxPixelRatio ${s.maxPixelRatio} -> ${capped.toFixed(2)} to keep the ` +
        `drawing buffer near ${(budget / 1e6).toFixed(1)} Mpx ` +
        `(${globalThis.innerWidth}x${globalThis.innerHeight} CSS at dpr ${dev.dpr})`);
      s.maxPixelRatio = capped;
    }
  }

  // ---- capability-driven degrade, before the first frame ------------------
  // Nothing below fires on hardware that passes the probe, so the desktop path
  // is untouched; every branch is a driver that has already told us it cannot
  // do the thing, and the alternative to acting on that is a black screen.
  const gl = glCapabilities();
  if (gl.webgl2 && !gl.halfFloatRenderable) {
    // N8AO allocates half-float depth/normal/AO targets of its own, and the
    // pipeline cannot see inside them. On a device that cannot render to a
    // float attachment those targets are incomplete, the pass composites over
    // undefined contents, and the result is the dark frame this whole change is
    // about. Measured with the float extensions withheld: the composed frame
    // came back 91% below display luma 12, against 9% on the same machine with
    // them present. Dropping the pass costs contact shadowing; keeping it costs
    // the picture.
    if (s.ssao) {
      s.ssao = false;
      logPipeline('settings', 'ambient occlusion off: this GPU cannot render to a float buffer');
    }
    // The bloom mip chain is 8-bit here too, so a high threshold has less to
    // work with; that is a look change, not a failure, and it stays.
  }
  // A rasteriser that cannot even complete an RGBA8 attachment has no
  // off-screen rendering at all: no composer, no AO, no shadow maps.
  if (gl.webgl2 && !gl.byteRenderable) {
    s.ssao = false;
    s.bloom = false;
    s.dof = false;
    s.motionBlur = false;
    s.shadows = false;
    logPipeline('settings', 'no usable off-screen targets: post-processing and shadows disabled');
  }
  if (gl.webgl2 && !gl.trialProgram) {
    // The representative material did not compile. Everything the world is made
    // of is that family, so the safest thing we can still do at THIS layer is
    // stop asking for the most shader-heavy tier; RenderPipeline takes it from
    // here with a simpler material variant.
    s.shadows = false;
    s.ssao = false;
    logPipeline('settings', 'trial material did not compile: shadows and AO disabled');
  }

  // Install the process-wide texture cap before any system exists, let alone
  // builds a texture. `createSettings()` is evaluated at module scope in
  // main.ts, which is the earliest point in the program that knows the tier.
  //
  // The belt-and-braces `handheld` clamp is deliberate: a phone that somehow
  // reaches Medium — a forced `?quality=medium`, a future tweak to the tier
  // rules, a device this classifier has not met — still gets the 256 cap.
  // Guessing high on a phone is the failure that kills the tab, so the cap is
  // pinned to the hardware and not only to the preset.
  let cap = TEXTURE_CAP[q];
  if (dev.handheld) cap = Math.min(cap, TEXTURE_CAP[Quality.Low]);
  else if (dev.touchPrimary) cap = Math.min(cap, TEXTURE_CAP[Quality.Medium]);
  // `?texcap=512`, or `?texcap=0` for uncapped. A diagnostic only — it is how
  // the before/after of this budget is measured on one tree — and it sits
  // alongside `?quality=` and `?scale=` as test-only overrides.
  const forcedCap = parseFloat(params.get('texcap') || '');
  if (Number.isFinite(forcedCap)) cap = forcedCap > 0 ? forcedCap : Infinity;
  setTextureBudget(cap);

  return s;
}
