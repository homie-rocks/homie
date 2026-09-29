/**
 * ============================================================================
 *  Film — the vignette and the grain, printed over the DOM as well as the canvas.
 * ============================================================================
 *
 *  ── WHY A DOM LAYER AND NOT JUST THE GRADE ──────────────────────────────────
 *
 *  The grade shader's vignette and grain are inside the composer, so they only
 *  ever reach the CANVAS. Every game this was built for puts a DOM interface ON
 *  TOP of that canvas — a HUD, a menu, a title — and those elements are outside
 *  the composer entirely. A frame therefore has a lens over three quarters of
 *  it and no lens at all over the readouts, which is the one place a viewer's
 *  eye is already resting. This layer prints the same two terms over the whole
 *  document, so the picture is one photograph rather than a rendering with an
 *  overlay stapled to it.
 *
 *  ── WHERE IT CAME FROM, AND WHY IT IS HERE NOW ──────────────────────────────
 *
 *  One game's renderer. Nothing in it was specific to that game: it is two
 *  fixed `<div>`s, a radial-gradient string, a seeded noise tile as a data URI,
 *  and a freeze contract. The game supplied five numbers and got 73
 *  substantive lines of DOM plumbing back. What is left in a game folder
 *  should be only what makes that game unique, and "a vignette is a radial
 *  gradient" is not that.
 *
 *  IT IS ONE COPY AND IT IS STILL PLATFORM. The criterion is to ask whether it
 *  belongs in a game, never whether there is a twin.
 *
 *  ── THE THREE THINGS THAT ARE NOT OBVIOUS ───────────────────────────────────
 *
 *  1. THE GAMMA. The grade multiplies by `(1 - V*s)` BEFORE the sRGB encode; a
 *     CSS layer multiplies AFTER it. A multiply of k in linear is a multiply of
 *     k^g in encoded, and g is the encode's local log-slope — 0.905 at linear
 *     0.005, 0.55 at 0.027, 0.45 at 0.45. No single alpha reproduces the shader
 *     everywhere, so `gamma` is which error the game chooses to take, and it is
 *     REQUIRED rather than defaulted: a default would hand the next game
 *     somebody else's fit. The original game's measurement is in its own spec.
 *
 *  2. `display: block !important`. A harness that hides the interface with a
 *     rule in the game's stylesheet would otherwise take the vignette with it,
 *     and then every judged capture is a frame the game never renders. An
 *     important declaration in a style ATTRIBUTE beats an important declaration
 *     in a style RULE (CSS Cascading 4, cascade sorting order), which is what
 *     `setProperty(..., 'important')` buys.
 *
 *  3. THE FREEZE. The capture harness gates a capture on two zero-advance
 *     screenshots being bit-identical. The tile therefore walks only while the
 *     world is running and is PINNED to (0,0) whenever it is frozen — pinned
 *     and not merely stopped, because a stopped clock still holds a different
 *     value in every run and two capture sets that cannot be subtracted are the
 *     failure the contract exists to prevent. Same rule, same reason, as
 *     `Clock.ts`'s `stillSeconds`.
 *
 *  THIS FILE IMPORTS NOTHING — not three, not `@homie-rocks/noise`. The PRNG arrives
 *  as `rand`, because a package that bakes in a generator has decided a game's
 *  determinism for it, and the original game's tile has to come out of the
 *  same stream its own PRNG probe already watches.
 * ============================================================================
 */

/**
 * Everything the layer cannot know. No field has a default and that is
 * `@homie-rocks/loop`'s `BootSpec` rule: a game that forgets one should fail to
 * compile rather than inherit another game's art direction.
 */
export interface FilmSpec {
  /** Vignette strength at the extreme corner, 0..1, in the grade's own units. */
  vignette: number;
  /** Normalised radius at which the vignette starts. The shader's inner edge. */
  vignetteInner: number;
  /** Normalised radius at which it is complete. The shader's smoothstep upper edge. */
  vignetteOuter: number;
  /** Linear -> encoded exponent. See note 1 in the header; fit it, do not guess. */
  gamma: number;
  /** Piecewise-linear stops used to approximate the shader's smoothstep. */
  stops: number;
  /** Peak additive grain excursion, 0..1, in the grade's own units. */
  grain: number;
  /** Tile edge in DEVICE pixels. A power of two, so the wrap is exact. */
  tile: number;
  /** Cycles per second the tile walks on x. Match the grade's grain frequency. */
  hz: number;
  /** The y frequency as a fraction of `hz`. Irrational-ish, or the pattern cycles. */
  hzRatio: number;
  /** Stacking order for the two elements. Above the interface, below the boot plate. */
  zVignette: number;
  zGrain: number;
  /** Element id prefix — `<prefix>-vignette` and `<prefix>-grain`. */
  id: string;
  /**
   * The grain source, already seeded. Called `tile * tile * 2` times at mount
   * and never again; the layer does not hold it.
   */
  rand: () => number;
}

/**
 * The two fixed elements, their clock, and the freeze contract.
 *
 * Construct once and `mount()` before the chain is built — whether the mount
 * SUCCEEDED is what decides whether the grade prints its own vignette, and a
 * frame vignetted twice is visibly wrong.
 */
export class FilmLayer {
  private readonly spec: FilmSpec;
  private vignette: HTMLDivElement | null = null;
  private grain: HTMLDivElement | null = null;
  private clock = 0;
  private appliedX = -1;
  private appliedY = -1;
  private appliedDpr = -1;

  /**
   * True once BOTH elements are in the document. A chain only gives up its own
   * vignette when this is true, so a failure here costs the interface its film
   * and costs the world nothing.
   */
  active = false;
  /** True when the grain tile was generated. Separate: it can fail on its own. */
  grainActive = false;

  constructor(spec: FilmSpec) {
    this.spec = spec;
  }

  mount(): boolean {
    if (this.active) return true;
    if (typeof document === 'undefined' || document.body === null) return false;
    const s = this.spec;
    try {
      const vig = document.createElement('div');
      vig.id = s.id + '-vignette';
      vig.setAttribute('aria-hidden', 'true');
      vig.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;'
        + 'pointer-events:none;z-index:' + s.zVignette + ';'
        + 'background-image:' + vignetteGradient(s) + ';';
      // See note 2 in the header: this beats a stylesheet's harness hide.
      vig.style.setProperty('display', 'block', 'important');
      document.body.appendChild(vig);
      this.vignette = vig;

      const tile = this.grainTile();
      if (tile !== null) {
        const g = document.createElement('div');
        g.id = s.id + '-grain';
        g.setAttribute('aria-hidden', 'true');
        // Inset well beyond the viewport so the walk below never uncovers an
        // edge. A game's index.html puts overflow:hidden on html and body, so
        // an oversized fixed element cannot produce a scrollbar.
        g.style.cssText = 'position:fixed;left:-256px;top:-256px;right:-256px;bottom:-256px;'
          + 'pointer-events:none;z-index:' + s.zGrain + ';'
          + 'background-repeat:repeat;mix-blend-mode:hard-light;'
          + 'will-change:transform;background-image:url(' + tile + ');';
        g.style.setProperty('display', 'block', 'important');
        document.body.appendChild(g);
        this.grain = g;
        this.grainActive = true;
      }
      this.active = true;
      this.setPixelRatio(globalThis.devicePixelRatio || 1);
      return true;
    } catch (err) {
      console.warn('[postfx] film layer could not be created; the grade keeps the '
        + 'vignette and the interface goes without one', err);
      this.dispose();
      return false;
    }
  }

  /**
   * The grain tile, as a data URI. Generated, never loaded — ZERO ART ASSETS.
   *
   * The amplitude is derived from the blend rather than eyeballed. `hard-light`
   * with a source above 0.5 is `screen(b, 2s-1)`, which at black is exactly
   * `2s-1`; so a tile of 127.5 * (1 + grain * n) delivers `grain` as its peak
   * additive excursion, which is the unit a grade authors it in.
   *
   * Triangular PDF (the sum of two uniforms), for the same reason a grade shader
   * uses one: a uniform dither leaves a residual noise-modulation artefact that
   * is visible on exactly the kind of very slow gradient these frames are made
   * of.
   */
  private grainTile(): string | null {
    const s = this.spec;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = s.tile;
      canvas.height = s.tile;
      const ctx = canvas.getContext('2d');
      if (ctx === null) return null;
      const img = ctx.createImageData(s.tile, s.tile);
      const amp = 127.5 * s.grain;
      for (let i = 0; i < s.tile * s.tile; i++) {
        const n = s.rand() + s.rand() - 1;
        const v = Math.max(0, Math.min(255, Math.round(127.5 + n * amp)));
        const o = i * 4;
        img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (err) {
      console.warn('[postfx] film grain tile could not be baked; the film layer '
        + 'keeps the vignette only', err);
      return null;
    }
  }

  /**
   * Sizes the tile so one tile texel is one DEVICE pixel.
   *
   * `devicePixelRatio` and NOT the renderer's effective ratio: this is a grain
   * on the finished image, so its unit is the screen's pixel, not the drawing
   * buffer's texel. On a dpr-2 display a 128 px tile is drawn into 64 CSS px,
   * which is 128 device pixels — 1:1, and no resampling to soften it.
   */
  setPixelRatio(dpr: number): void {
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    if (d === this.appliedDpr || this.grain === null) return;
    this.appliedDpr = d;
    const css = this.spec.tile / d;
    this.grain.style.backgroundSize = css + 'px ' + css + 'px';
    // Force the transform to be rewritten in the new units.
    this.appliedX = -1;
    this.appliedY = -1;
  }

  /**
   * Walks the tile, or pins it. See note 3 in the header.
   *
   * The offset is quantised to whole tile texels, so the walk is a pure shift of
   * the pattern and never a resample of it — a fractional translate would put a
   * bilinear filter on the grain and halve its amplitude.
   */
  update(dt: number, frozen: boolean): void {
    const g = this.grain;
    if (g === null) return;
    const s = this.spec;
    let ox = 0;
    let oy = 0;
    if (frozen) {
      this.clock = 0;
    } else {
      this.clock += Math.max(0, dt);
      ox = Math.floor(((this.clock * s.hz) % 1) * s.tile);
      oy = Math.floor(((this.clock * s.hz * s.hzRatio) % 1) * s.tile);
    }
    if (ox === this.appliedX && oy === this.appliedY) return;
    this.appliedX = ox;
    this.appliedY = oy;
    const d = this.appliedDpr > 0 ? this.appliedDpr : 1;
    g.style.transform = 'translate3d(' + (ox / d) + 'px,' + (oy / d) + 'px,0)';
  }

  dispose(): void {
    for (const el of [this.vignette, this.grain]) {
      if (el?.parentNode != null) el.parentNode.removeChild(el);
    }
    this.vignette = null;
    this.grain = null;
    this.active = false;
    this.grainActive = false;
    this.appliedDpr = -1;
    this.appliedX = -1;
    this.appliedY = -1;
    this.clock = 0;
  }
}

/**
 * The shader's vignette, as a CSS gradient. Exported because it is pure, and a
 * harness can compare it against the shader's own arithmetic with no DOM.
 *
 * `circle farthest-corner` from the centre has a radius of exactly half the box
 * diagonal, and a grade's radius is
 *     length((uv-0.5) * vec2(aspect,1)) / (0.5*length(vec2(aspect,1)))
 * which reduces — substitute uv, multiply through by the height — to
 * length(p) / (0.5*length(W,H)), i.e. the SAME normalisation. So a stop at `r%`
 * here is the shader's `rad = r/100` exactly, at any aspect ratio.
 */
export function vignetteGradient(s: {
  vignette: number; vignetteInner: number; vignetteOuter: number;
  gamma: number; stops: number;
}): string {
  const inner = s.vignetteInner;
  const outer = s.vignetteOuter;
  const stops: string[] = [];
  for (let i = 0; i <= s.stops; i++) {
    const rad = inner + (outer - inner) * (i / s.stops);
    const t = (rad - inner) / (outer - inner);
    const sm = t * t * (3 - 2 * t);
    const a = 1 - Math.pow(1 - s.vignette * sm, s.gamma);
    stops.push('rgba(0,0,0,' + a.toFixed(5) + ') ' + (rad * 100).toFixed(3) + '%');
  }
  return 'radial-gradient(circle farthest-corner at 50% 50%,' + stops.join(',') + ')';
}
