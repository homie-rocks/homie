/**
 * ============================================================================
 *  IconAtlas — an off-screen cache of rasterised marks, keyed by what they are
 *  and rebuilt only when the pixel size actually moves.
 * ============================================================================
 *
 * A widget that draws the same vector mark every frame — a roulette reel, a
 * pickup slot, an inventory row — re-runs every path, every stroke and every
 * join sixty times a second for a picture that has not changed. This rasterises
 * each mark ONCE at the size it is wanted and blits the canvas after that.
 *
 * Before this, no package had held a line of it, while a live implementation
 * sat in TWO games — `ItemIconAtlas` in both racers' item-icon modules.
 *
 * ── WHAT IS PLATFORM HERE AND WHAT IS EMPHATICALLY NOT ──────────────────────
 *
 * The two copies were the same twenty lines and the whole difference between
 * them was THREE NUMBERS: the smallest size the kart racer will rasterise (96
 * against the space racer's 64) and the size each falls back to if something asks for a
 * mark before `ensure` has been called (256 against 192). Those are options.
 *
 * The 1,266 lines AROUND them are not, and they stay in their games: the marks
 * themselves. `drawBanana` and `drawIonMine` are two games' art, drawn on two
 * different optical grids with two different halo treatments, and a package
 * that knew what a banana was would be a package that knows what a kart item
 * is. This class never draws anything — the caller hands it a `draw` and the
 * class is the CACHE POLICY, which is the general part and all of it.
 *
 * ── WHY THE QUANTISATION IS NOT A ROUNDING CONVENIENCE ──────────────────────
 *
 * `ensure()` snaps the requested pixel size to a step and only clears when the
 * SNAPPED size moves. Without that, a layout that resizes continuously — a
 * reel that grows as it lands, an element sized off a viewport percentage
 * during an orientation change — invalidates the whole cache on every frame it
 * moves by one pixel, and the cache costs more than it saves while looking
 * exactly like a cache that is working.
 */

/** What the caller draws into a `size` x `size` canvas for one key. */
export type DrawIcon = (g: CanvasRenderingContext2D, key: number, size: number) => void;

export interface IconAtlasOptions {
  /** Draws one mark. The context is already sized; the atlas does no transform. */
  draw: DrawIcon;
  /** Smallest size that will ever be rasterised. Default 64. */
  min?: number;
  /** Largest. Default 512 — past this a blit is not cheaper than the paths. */
  max?: number;
  /** Sizes are snapped to a multiple of this. Default 32. See the header. */
  step?: number;
  /**
   * The size used if `get()` is called before `ensure()`.
   *
   * Deliberately NOT the same as `min`: the two games this came from used 256
   * and 192 against minimums of 96 and 64, because the fallback is "the size
   * this widget usually is" and the minimum is "the smallest that is still
   * legible". Collapsing them would have halved one game's first-frame icons.
   * Default 256.
   */
  fallback?: number;
}

export class IconAtlas {
  #cache = new Map<number, HTMLCanvasElement>();
  #size = 0;
  #draw: DrawIcon;
  #min: number;
  #max: number;
  #step: number;
  #fallback: number;

  constructor(opts: IconAtlasOptions) {
    this.#draw = opts.draw;
    this.#min = opts.min ?? 64;
    this.#max = opts.max ?? 512;
    this.#step = opts.step ?? 32;
    this.#fallback = opts.fallback ?? 256;
  }

  /** Rebuilds only when the required pixel size actually moves. */
  ensure(px: number): void {
    const s = Math.max(this.#min, Math.min(this.#max, Math.round(px / this.#step) * this.#step));
    if (s === this.#size) return;
    this.#size = s;
    this.#cache.clear();
  }

  /** The rasterised mark for `key`, drawn on first ask at the current size. */
  get(key: number): HTMLCanvasElement {
    let c = this.#cache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = this.#size || this.#fallback;
      const g = c.getContext('2d')!;
      this.#draw(g, key, c.width);
      this.#cache.set(key, c);
    }
    return c;
  }

  /** The size marks are currently rasterised at, or 0 before the first `ensure`. */
  get size(): number { return this.#size; }
}
