/**
 * ============================================================================
 *  colour.ts — author a colour as the value it must DISPLAY, not as a number
 *  you hand the shader and hope about.
 * ============================================================================
 *
 * ## The method, in one paragraph
 *
 * A sky colour, a fog tint, a light's chromaticity: every one of them is chosen
 * by a person looking at a screen, so what is authored is a DISPLAY value. What
 * a shader wants is the linear radiance that comes out the other side of the
 * tone mapper looking like that. Those are not the same number, and the gap is
 * a factor of two to seven depending on where on the curve the colour sits.
 *
 * So: `hexToLinear` takes the authored hex to linear-sRGB, and `inverseAces`
 * inverts three's ACES operator to find the radiance that maps onto it. Both
 * racers' atmosphere modules carried the same note above the same call — *"That
 * mistake is worth a factor of two to seven, and it is invisible until someone
 * measures."*
 *
 * `acesToneMap` mirrors `tonemapping_pars_fragment.glsl` bit-for-bit, INCLUDING
 * the `/0.6` "brighter viewing environment" fudge. That is what makes the
 * calibration a calibration rather than a guess: the CPU and the GPU are
 * evaluating the same operator, so a value solved here lands where it was
 * authored to land.
 *
 * ## Why this file has no dependencies
 *
 * It is arithmetic on `Float64Array`s and plain numbers. No `three`, no
 * renderer, no scene — which is what lets a bake step, a probe and a game all
 * call it, and what keeps it out of the peerDependency question entirely.
 * `THREE.Color` never appears; a caller reads the three components out itself,
 * which is what both racers already did.
 *
 * ## What was BYTE-IDENTICAL, and the one thing that was not
 *
 * The atmosphere modules of a kart racer and of a space racer carried all of
 * this, character for character, apart from TWO NUMBERS — the two floors in
 * `inverseAces`. The kart racer clamps at 1e-4 / 1e-6, the space racer at
 * 1e-5 / 1e-7, and that is the whole divergence: a vacuum sky is authored
 * darker, so the solver has to be allowed further down before it stops.
 *
 * They are PARAMETERS, with no defaults. Not because a default would be hard to
 * pick, but because picking one silently re-tunes whichever game did not get
 * it, and the symptom would be a sky that is subtly wrong in a build nobody
 * changed. A caller states its own floors, at the call site, next to the
 * exposure it is solving against.
 */

// ---------------------------------------------------------------------------
// ACES, forward and inverted
// ---------------------------------------------------------------------------

const ACES_IN = [0.59719, 0.35458, 0.04823, 0.0760, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];

function mat3Apply(m: number[], v: Float64Array, out: Float64Array): void {
  const x = v[0]!, y = v[1]!, z = v[2]!;
  out[0] = m[0]! * x + m[1]! * y + m[2]! * z;
  out[1] = m[3]! * x + m[4]! * y + m[5]! * z;
  out[2] = m[6]! * x + m[7]! * y + m[8]! * z;
}

/**
 * Module scratch, and it is SAFE HERE for a reason worth stating: the only
 * writer is `acesToneMap`, the only reader is the same call, and nothing
 * escapes. `inverseAces` calls into it and keeps its own `_invProbe`. A caller
 * never sees either, so moving this arithmetic into a package could not strand
 * a value someone was holding across the call — which is the failure mode that
 * makes module scratch dangerous to relocate in general.
 */
const _acesTmp = new Float64Array(3);

/** three's `ACESFilmicToneMapping`, on the CPU. `v` is linear-sRGB, in place. */
export function acesToneMap(v: Float64Array, exposure: number): void {
  const k = exposure / 0.6;
  _acesTmp[0] = v[0]! * k; _acesTmp[1] = v[1]! * k; _acesTmp[2] = v[2]! * k;
  mat3Apply(ACES_IN, _acesTmp, v);
  for (let i = 0; i < 3; i++) {
    const a = v[i]!;
    v[i] = (a * (a + 0.0245786) - 0.000090537) / (a * (0.983729 * a + 0.432951) + 0.238081);
  }
  _acesTmp[0] = v[0]!; _acesTmp[1] = v[1]!; _acesTmp[2] = v[2]!;
  mat3Apply(ACES_OUT, _acesTmp, v);
  for (let i = 0; i < 3; i++) v[i] = Math.min(Math.max(v[i]!, 0), 1);
}

const _invProbe = new Float64Array(3);

/**
 * Find the linear radiance that ACES maps to `target` (a linear-sRGB DISPLAY
 * value — run the authored hex through `hexToLinear` first). Fixed point with a
 * damped exponent; ACES is monotone per channel so this converges in well under
 * 200 iterations even for near-clipped targets.
 *
 * `floor` is the smallest radiance the search may start from, and `probeFloor`
 * the smallest denominator it will divide by. THE TWO RACERS DISAGREE ON BOTH
 * and that disagreement is the reason they are arguments — see the header.
 * There is no default: a game states its own, beside its own exposure.
 */
export function inverseAces(
  target: Float64Array,
  exposure: number,
  out: Float64Array,
  floor: number,
  probeFloor: number,
): void {
  out[0] = Math.max(target[0]!, floor);
  out[1] = Math.max(target[1]!, floor);
  out[2] = Math.max(target[2]!, floor);
  for (let it = 0; it < 200; it++) {
    _invProbe.set(out);
    acesToneMap(_invProbe, exposure);
    for (let c = 0; c < 3; c++) {
      // Pure white is unreachable — ACES only approaches 1 asymptotically —
      // so clamp the target just short of the ceiling.
      const t = Math.min(target[c]!, 0.9975);
      out[c] = out[c]! * Math.pow(t / Math.max(_invProbe[c]!, probeFloor), 0.5);
    }
  }
}

/**
 * The sRGB EOTF: one 0..1 display-referred channel to linear.
 *
 * The exact inverse of `encodeSrgb` below, and it is one function rather than
 * an inlined ternary at each of the four sites that had it, because the two
 * halves of the piecewise curve have to agree on the breakpoint. `<=` and not
 * `<` at 0.04045: the two branches meet to about 1e-8 there, so either is
 * defensible on its own and having BOTH in a repository means two bakers of the
 * same texture disagree in the last bit at exactly one input.
 */
export function decodeSrgb(x: number): number {
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** An authored `0xRRGGBB` to linear-sRGB, which is what `inverseAces` takes. */
export function hexToLinear(hex: number, out: Float64Array): void {
  for (let i = 0; i < 3; i++) {
    out[i] = decodeSrgb(((hex >> (16 - i * 8)) & 255) / 255);
  }
}

// ---------------------------------------------------------------------------
// The numeric half of the method
// ---------------------------------------------------------------------------

/**
 * Solve `M x = b` for several right-hand sides at once. `M` is the (small,
 * symmetric, positive-definite) normal-equations matrix of a least-squares fit,
 * so plain Gaussian elimination with partial pivoting is both sufficient and
 * far less code than a Cholesky. Row-major, n×n, destroyed in place.
 *
 * LIVE IN the kart racer, which fits its haze gains with it, and DEAD in the
 * space racer — which kept and exported its copy on purpose, saying so: *"it
 * is the numeric half of the author-the-target-colour method, and the moment
 * anyone fits a probe gain or a band ramp to a set of authored hexes they will
 * want it rather than a second copy of it."* That decision is honoured better
 * here than it was there: the affordance survives, and the second copy is gone.
 */
export function solveMulti(M: number[], rhs: number[][], n: number): number[][] {
  const a = M.slice();
  const x = rhs.map((r) => r.slice());
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r * n + col]!) > Math.abs(a[piv * n + col]!)) piv = r;
    }
    if (piv !== col) {
      for (let k = 0; k < n; k++) {
        const t = a[col * n + k]!; a[col * n + k] = a[piv * n + k]!; a[piv * n + k] = t;
      }
      for (const v of x) { const t = v[col]!; v[col] = v[piv]!; v[piv] = t; }
    }
    const d = a[col * n + col]!;
    if (Math.abs(d) < 1e-18) continue;
    for (let r = col + 1; r < n; r++) {
      const f = a[r * n + col]! / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) a[r * n + k] = a[r * n + k]! - f * a[col * n + k]!;
      for (const v of x) v[r] = v[r]! - f * v[col]!;
    }
  }
  for (let col = n - 1; col >= 0; col--) {
    const d = a[col * n + col]!;
    for (const v of x) {
      let s = v[col]!;
      for (let k = col + 1; k < n; k++) s -= a[col * n + k]! * v[k]!;
      v[col] = Math.abs(d) < 1e-18 ? 0 : s / d;
    }
  }
  return x;
}

/**
 * Linear → sRGB, encoded to one 8-bit code, for writing a texture the GPU will
 * decode again.
 *
 * The piecewise curve, not `pow(x, 1/2.2)`. The two differ by up to four code
 * values in the bottom decile, which is invisible in a bright texture and is
 * exactly where a night-side albedo or a shadowed ground bounce lives.
 */
export function encodeSrgb(x: number): number {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/**
 * Index of the nearest entry of `palette` to `rgb`, matched by CHROMATICITY.
 *
 * Both sides are normalised by the sum of their channels before the squared
 * distance, which is what makes this a hue-and-saturation match rather than a
 * brightness one. **A plain RGB distance is the trap**: a dim cyan and a bright
 * cyan are the same light, and under an unnormalised metric every dim sample
 * matches whichever palette entry happens to be darkest — so a scene's dimmest
 * fixtures all come out the same wrong colour, consistently, which reads as an
 * art decision rather than a bug.
 *
 * `palette` is a flat `[r,g,b, r,g,b, …]` in the same space as `rgb`, so this
 * file still imports nothing. Ties go to the LOWEST index (strict `<`), which
 * makes the answer stable when a palette carries two entries of one hue at
 * different levels. An empty palette returns -1; the caller decides what a
 * sample with nothing to match means, because a silent fallback to entry 0 is
 * how every arrival in another project announced itself in red.
 */
export function nearestByChromaticity(
  r: number, g: number, b: number, palette: ArrayLike<number>,
): number {
  const n = Math.floor(palette.length / 3);
  if (n === 0) return -1;
  const s = Math.max(1e-4, r + g + b);
  const cr = r / s, cg = g / s, cb = b / s;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const pr = palette[i * 3] as number;
    const pg = palette[i * 3 + 1] as number;
    const pb = palette[i * 3 + 2] as number;
    const ps = Math.max(1e-4, pr + pg + pb);
    const d = (pr / ps - cr) ** 2 + (pg / ps - cg) ** 2 + (pb / ps - cb) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * The same curve, tabulated, for a caller writing whole textures.
 *
 * `encodeSrgb` above is the honest per-call answer and it costs a `Math.pow`.
 * A procedural albedo pass is eight bodies x 262,144 texels x 3 channels =
 * 6.3 M evaluations at boot, which is the one place that matters — so this is a
 * 4,097-entry table read with a truncating index. It is EXACT at 8-bit output:
 * 4,096 steps of input map to 256 output codes, so no two inputs that would
 * round to different bytes share a slot.
 *
 * `Uint8ClampedArray` does the clamp and the round-half-to-even on the way in,
 * which is the same rule the canvas and every texture upload apply, so a value
 * from here and a value that went through an ImageData agree to the code.
 */
const _srgbLut = (() => {
  const n = 4096;
  const t = new Uint8ClampedArray(n + 1);
  for (let i = 0; i <= n; i++) {
    const v = i / n;
    t[i] = (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
  }
  return t;
})();

/** Linear working-space 0..1 to an sRGB-encoded byte, through the table. */
export function srgbByte(v: number): number {
  return _srgbLut[((v < 0 ? 0 : v > 1 ? 1 : v) * 4096) | 0]!;
}


/**
 * The multiplier that takes a colour to a TARGET REFLECTANCE without moving its
 * hue, clamped so no channel can leave the unit range.
 *
 * WHY A FAMILY OF HUES NEEDS THIS TO READ AS ONE MATERIAL. A metal's albedo is
 * not a diffuse colour at all — it is the reflection TINT — and a pale one
 * tints toward white, which reflects an already-dark environment as a flat dim
 * nothing. A metal reads as metal because of the DARK part of its range: drop
 * the value and the environment has somewhere to go.
 *
 * The value must be set by LUMINANCE and never by HSL lightness, and that is
 * the whole reason this is a function rather than a clamp at the call site.
 * These are LINEAR values, and at a fixed L a saturated cyan carries roughly
 * three times the luminance of a saturated blue — so clamping L leaves one hue
 * near-white and another near-black while the numbers look identical. Against
 * a reflectance target every hue in the set comes out as the same metal,
 * anodised eight different colours.
 *
 * The second term is not belt and braces: a very dark saturated input needs a
 * multiplier above 1 to reach the target, and without the peak-channel clamp
 * that pushes a channel past 1 and the hue shifts on the way through the
 * renderer's own clamp.
 */
export function reflectanceScale(r: number, g: number, b: number, target: number): number {
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.min(target / Math.max(1e-3, luma), 1 / Math.max(1e-3, r, g, b));
}

/** Anything with three mutable linear channels. `THREE.Color` satisfies it. */
export interface MutRGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Clamp a vertex-colour MULTIPLIER, in place, so it can neither crush its map
 * to black nor ask it for light it does not have.
 *
 * ── WHY A MULTIPLIER NEEDS A FLOOR AS WELL AS A CEILING ────────────────────
 *
 * A vertex colour multiplies the albedo map, and the two failures are not
 * symmetric. Above the ceiling the product clips flat and every distinguishing
 * mark in the map at that spot is gone — one white shape where there was
 * lettering, a kerb stripe, an aggregate. Below the floor the product crushes
 * to black, and a black that is outside the scene's darkest ambient reads as a
 * HOLE punched in the frame rather than as shade, which is the note both
 * racers' art direction states in the same words.
 *
 * The bounds are the CALLER'S and there is no default. What counts as "asking
 * for light the map has not got" depends on how bright that map was authored
 * and how hard the key is, and a shared default is how one world's exposure
 * quietly arrives in another. The kart racer alone uses three different pairs.
 *
 * Structural `MutRGB` rather than `THREE.Color`, so this file keeps the
 * property its header states at length: no `three`, no renderer, no scene, so
 * a bake step and a probe can call it too.
 */
export function clampMul(c: MutRGB, lo: number, hi: number): void {
  c.r = c.r < lo ? lo : c.r > hi ? hi : c.r;
  c.g = c.g < lo ? lo : c.g > hi ? hi : c.g;
  c.b = c.b < lo ? lo : c.b > hi ? hi : c.b;
}

/**
 * ---------------------------------------------------------------------------
 *  THE LUMINANCE ANCHOR — a radiance ladder read by things that measure light
 * ---------------------------------------------------------------------------
 *  An emissive "tier" ladder is a set of scalar multipliers on an authored
 *  colour, and every consumer downstream of it responds to LUMINANCE instead:
 *  a bloom pass gates on luminance, a glow census counts luminance, and so does
 *  the eye. So the same rung means a different amount of glow for every hue in
 *  a palette, and the darkest accent in any palette — a saturated red, almost
 *  always — sits below the bloom threshold at the rung labelled "blooms hard"
 *  and has never bloomed in any frame since the ladder was written. That is not
 *  a tuning miss; it is a units mismatch between the ladder and its readers,
 *  and no amount of nudging the rungs fixes it because the rungs are shared.
 *
 *  The correction is one number per hue: the ratio of an ANCHOR hue's relative
 *  luminance to this hue's, so a colour authored at rung N carries the same
 *  luminance as the anchor at rung N. The anchor is exactly 1.000 and does not
 *  move by a bit, which is what makes this safe to land beside a grade change —
 *  every measurement taken on the anchor hue stays comparable.
 *
 *  THE LOWER CLAMP IS THE POINT, NOT A GUARD. Un-clamped this DIMS every hue
 *  brighter than the anchor, and those are usually the near-whites a flood or a
 *  headlamp was tuned on. A correction that can only ever RAISE a hue the
 *  luminance response was under-serving cannot regress work it was not asked to
 *  touch. The upper clamp stops a future near-black accent asking for rung 40.
 *
 *  A hue with no luminance at all returns 1 — the identity — rather than the
 *  lower bound: it cannot be anchored to anything, and silently scaling it is
 *  worse than leaving it where the author put it.
 *
 *  MEMOISED PER ANCHOR, because a palette has a dozen entries and a build loop
 *  asks for them a few thousand times. The cache lives in the closure, so two
 *  anchors cannot pollute each other's answers.
 *
 *  Which hue is the anchor, and what the bounds are, are the CALLER'S. Anchor
 *  to a game's signature colour — the one no change is allowed to perturb.
 */

const _lumaScratch = new Float64Array(3);

/** Rec.709 relative luminance of an authored `0xRRGGBB`, in linear light. */
export function hexLuma(hex: number): number {
  hexToLinear(hex, _lumaScratch);
  return 0.2126 * _lumaScratch[0]! + 0.7152 * _lumaScratch[1]! + 0.0722 * _lumaScratch[2]!;
}

/**
 * Build a memoised anchor function for one anchor hue.
 *
 * @param anchorHex the hue every other one is matched to. Returns exactly 1.
 * @param lo        floor. 1 means the correction can only ever brighten.
 * @param hi        ceiling, so a near-black accent cannot ask for the moon.
 */
export function lumaAnchor(anchorHex: number, lo = 1, hi = 3): (hex: number) => number {
  const cache = new Map<number, number>();
  const anchorLum = hexLuma(anchorHex);
  return (hex: number): number => {
    const hit = cache.get(hex);
    if (hit !== undefined) return hit;
    const own = hexLuma(hex);
    const v = own < 1e-4 ? 1 : Math.min(hi, Math.max(lo, anchorLum / own));
    cache.set(hex, v);
    return v;
  };
}

// ---------------------------------------------------------------------------
//  Sequencing a palette, so no two neighbours read the same
// ---------------------------------------------------------------------------

/**
 * A shuffled bag over `n` entries: every entry comes out exactly once before
 * any comes out twice.
 *
 * ── WHY `pick(rng, palette)` IS NOT ENOUGH ──────────────────────────────────
 *
 * With an independent draw per instance, the same entry lands next to itself
 * about `1/n` of the time — one facade in five in a five-colour palette — and
 * a repeated neighbour is exactly what makes a run of buildings, a rank of
 * seats or a row of parked vehicles read as random rather than as authored.
 * "Usually not the same" is not the same property as "never within n".
 *
 * The bag is the property, stated: draw without replacement, reshuffle when
 * empty. `drawn` counts the draws so a caller can ALTERNATE something on its
 * parity — which is the other half of the same problem, because under a warm
 * key several pastels converge in HUE and the only channel left that separates
 * two neighbours is VALUE. What that alternation multiplies by is the caller's
 * and this file never sees it.
 *
 * ── THE RNG DRAW ORDER IS PART OF THE CONTRACT ─────────────────────────────
 *
 * A refill draws `n - 1` numbers, in a Fisher-Yates walking DOWN from `n - 1`,
 * before `next` returns. A caller adopting this from its own inline bag gets
 * the same world only if that matches; it is invisible to review and obvious
 * in a capture.
 *
 * No colour in, an index out, no `three`.
 */
export class ShuffledBag {
  #bag: number[] = [];
  #drawn = 0;

  constructor(private readonly n: number, private readonly rng: () => number) {}

  /** How many entries have been handed out, over the bag's whole life. */
  get drawn(): number { return this.#drawn; }

  /** The next index. Refills and reshuffles when the bag runs out. */
  next(): number {
    if (!this.#bag.length) {
      this.#bag = [];
      for (let i = 0; i < this.n; i++) this.#bag.push(i);
      for (let i = this.n - 1; i > 0; i--) {
        const j = (this.rng() * (i + 1)) | 0;
        const tmp = this.#bag[i]!;
        this.#bag[i] = this.#bag[j]!;
        this.#bag[j] = tmp;
      }
    }
    this.#drawn++;
    return this.#bag.pop()!;
  }
}
