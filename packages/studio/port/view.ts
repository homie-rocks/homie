/*
 * A flat world on every screen: a phone held upright, the same phone on its side, a computer and a television.
 * Two pieces for a top-down canvas game (both starters use them):
 *
 *   fitView(o)            where the camera looks and how close. The whole world where it fits at a size that reads
 *                         (a computer, a TV); elsewhere (most of all a phone held upright, where "fit" drew a strip
 *                         a quarter of the screen tall) the world FILLS the screen and follows the player, never
 *                         past the world's edge, except as far as it takes to keep the player clear of the HUD.
 *   createLabels()        name labels that never pile up. Each label wants its spot above its body; when that spot
 *                         is taken it tries a row higher, then under the body, else it fades out. The player's own
 *                         label is placed first and nothing covers it; a moved label keeps its new spot while it is
 *                         free (no flicker), and labels fade in and out rather than pop.
 *
 * Everything is in CSS pixels (screen) and world units; the game draws. See the starters (gem-rush, ember-vale).
 */

export interface FitOptions {
  /** The world's size, in world units. */
  world: { w: number; h: number };
  /** The screen (the canvas's CSS size). */
  screen: { w: number; h: number };
  /** CSS px per world unit below which the whole world is too small to play (bodies too small to see, names too small
   *  to read): under it the camera follows `focus`. 0: never show the whole world unless `whole`. */
  readable: number;
  /** How close a following camera is, in CSS px per world unit (default `readable`). It is never less than what
   *  fills the screen, so a following camera never shows an empty band beside the world. */
  zoom?: number;
  /** Where a following camera looks, in world units (the player's body, or the player a watcher follows). null: the
   *  world's middle. */
  focus?: { x: number; y: number } | null;
  /** Show the whole world whatever its size (an overview: a watcher following nobody). */
  whole?: boolean;
  /** CSS px of HUD along each edge: a following camera slides past the world's edge (up to this much) only when the
   *  player would otherwise be under the HUD, at the very edge of the world. */
  inset?: { top?: number; right?: number; bottom?: number; left?: number };
}

export interface Fit {
  /** CSS px per world unit. */
  scale: number;
  /** The world point at the screen's centre. */
  x: number;
  y: number;
  /** True when the camera follows (the whole world is not on screen). */
  follow: boolean;
}

/** Where the camera should look this frame (ease towards it: a cut only at a round start or a respawn). */
export function fitView(o: FitOptions): Fit {
  const W = o.world.w; const H = o.world.h;
  const sw = Math.max(1, o.screen.w); const sh = Math.max(1, o.screen.h);
  const contain = Math.min(sw / W, sh / H);
  if (o.whole || (o.readable > 0 && contain >= o.readable)) return { scale: contain, x: W / 2, y: H / 2, follow: false };
  const cover = Math.max(sw / W, sh / H);
  const scale = Math.max(cover, o.zoom ?? o.readable);
  const f = o.focus ?? { x: W / 2, y: H / 2 };
  const i = { top: 0, right: 0, bottom: 0, left: 0, ...(o.inset ?? {}) };
  const hw = sw / 2 / scale; const hh = sh / 2 / scale;
  const within = (v: number, lo: number, hi: number): number => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  // Centred on the focus, kept inside the world; then moved just enough that the focus is clear of the HUD's margins.
  const clear = (c: number, focus: number, half: number, lo: number, hi: number): number => {
    const at = (half + focus - c) * scale; // the focus on screen, from the near edge
    const span = 2 * half * scale;
    if (at < lo) return c - (lo - at) / scale;
    if (at > span - hi) return c + (at - (span - hi)) / scale;
    return c;
  };
  return {
    scale,
    x: clear(within(f.x, hw, W - hw), f.x, hw, i.left, i.right),
    y: clear(within(f.y, hh, H - hh), f.y, hh, i.top, i.bottom),
    follow: true,
  };
}

/** A world point on screen (CSS px) under a camera. */
export function toScreen(fit: Fit, screen: { w: number; h: number }, x: number, y: number): { x: number; y: number } {
  return { x: screen.w / 2 + (x - fit.x) * fit.scale, y: screen.h / 2 + (y - fit.y) * fit.scale };
}

/** Ease a camera towards where it should be (frame-rate independent; `rate` about 8 to 12 a second). */
export function easeView(cam: Fit | null, want: Fit, dt: number, rate = 10): Fit {
  if (!cam) return { ...want };
  const k = 1 - Math.exp(-Math.max(0, dt) * rate);
  return { scale: cam.scale + (want.scale - cam.scale) * k, x: cam.x + (want.x - cam.x) * k, y: cam.y + (want.y - cam.y) * k, follow: want.follow };
}

export interface LabelBox { left: number; top: number; right: number; bottom: number }

export interface LabelIn {
  /** Stable per body (its slot): a label keeps its spot and its fade from frame to frame. */
  key: string | number;
  text: string;
  /** The label's centre x and its BOTTOM edge where it wants to sit (above its body), CSS px. */
  x: number;
  y: number;
  /** Its size as drawn, CSS px (measureText's width; the font's line height). */
  w: number;
  h: number;
  /** Where its bottom edge goes if it sits under its body instead (CSS px); omitted: never under. */
  below?: number;
  /** Its body on screen (with its bars): other labels keep off it when they can. */
  body?: LabelBox;
  /** The player's own label (or the player a watcher follows): placed first, never covered, never faded. */
  self?: boolean;
  /** Lower first: who keeps their spot when two want it (people before AI before bots, near before far). */
  rank?: number;
}

export interface LabelOut extends LabelIn, LabelBox {
  /** The text's centre (draw with textAlign center, textBaseline middle). */
  cx: number;
  cy: number;
  /** 0..1: 1 shown, 0 gone (no room for it). */
  alpha: number;
  /** Not in its own spot above its body (draw a thin line to the body, so whose it is stays plain). */
  moved: boolean;
}

export interface LabelOptions {
  /** CSS px kept clear between two labels (default 3). */
  gap?: number;
  /** CSS px kept clear round the player's own label, for a chip drawn behind it (default 4). */
  selfPad?: number;
  /** How fast a label fades in (default 8 a second). One with no room left goes at once if it would touch another. */
  fade?: number;
  /** The screen, so a label is never pushed off it (default the window). */
  screen?: () => { w: number; h: number };
  /** Boxes labels must keep clear of (the game's own speech bubbles, a panel), CSS px. */
  avoid?: () => LabelBox[];
}

/**
 * Name labels that never pile up. Call `place(labels, dt)` each frame with every label that wants drawing; draw what
 * comes back (skip alpha 0). The order of the input does not matter: `self` first, then `rank`.
 *
 * Each label tries, in order: its own spot above its body, a row higher, under its body, two rows higher; first
 * clear of every placed label and of other bodies, then clear of labels only. A label that moved keeps its new spot
 * until its own is clear by a margin, so labels do not flicker between two spots as bodies jostle.
 */
export function createLabels(opts: LabelOptions = {}): { place(labels: LabelIn[], dt: number): LabelOut[]; reset(): void } {
  const gap = opts.gap ?? 3;
  const selfPad = opts.selfPad ?? 4;
  const fadeRate = opts.fade ?? 8;
  const state = new Map<string | number, { spot: number; alpha: number }>();
  const screen = opts.screen ?? ((): { w: number; h: number } => ({ w: typeof innerWidth === 'number' ? innerWidth : 1e9, h: typeof innerHeight === 'number' ? innerHeight : 1e9 }));
  const hits = (a: LabelBox, b: LabelBox, m = gap): boolean => a.left < b.right + m && b.left < a.right + m && a.top < b.bottom + m && b.top < a.bottom + m;
  return {
    reset() { state.clear(); },
    place(labels, dt) {
      const { w: sw, h: sh } = screen();
      const order = [...labels].sort((a, b) => Number(Boolean(b.self)) - Number(Boolean(a.self)) || (a.rank ?? 0) - (b.rank ?? 0));
      const taken: LabelBox[] = [...(opts.avoid?.() ?? [])];
      const bodies = labels.filter((l) => l.body).map((l) => ({ key: l.key, box: l.body as LabelBox }));
      const out: LabelOut[] = [];
      const seen = new Set<string | number>();
      const k = 1 - Math.exp(-Math.max(0, dt) * fadeRate);
      for (const l of order) {
        seen.add(l.key);
        // Spots: 0 its own (above the body), 1 a row higher, 2 under the body, 3 two rows higher.
        const bottoms = [l.y, l.y - l.h - gap, l.below, l.y - 2 * (l.h + gap)];
        const boxAt = (spot: number): LabelBox | null => {
          const b = bottoms[spot];
          if (b === undefined) return null;
          const half = l.w / 2;
          // Kept on screen sideways; a spot off the top or the bottom is not a spot.
          const cx = Math.max(half + 2, Math.min(sw - half - 2, l.x));
          const box = { left: cx - half, top: b - l.h, right: cx + half, bottom: b };
          return box.top < 0 || box.bottom > sh ? null : box;
        };
        const clear = (b: LabelBox, strict: boolean, m = gap): boolean => !taken.some((t) => hits(b, t, m)) && (!strict || !bodies.some((o) => o.key !== l.key && hits(b, o.box, 0)));
        const st = state.get(l.key) ?? { spot: 0, alpha: l.self ? 1 : 0 };
        let spot = -1; let box: LabelBox | null = null;
        if (l.self) {
          spot = boxAt(0) ? 0 : boxAt(2) ? 2 : 0;
          box = boxAt(spot) ?? { left: l.x - l.w / 2, top: l.y - l.h, right: l.x + l.w / 2, bottom: l.y };
        } else {
          // Home first (back home only with room to spare, once moved), then last frame's spot, then the rest.
          const home = boxAt(0);
          const tries = [st.spot, 1, 2, 3].filter((x, i, all) => x !== 0 && all.indexOf(x) === i);
          for (const strict of [true, false]) {
            if (home && clear(home, strict, st.spot === 0 ? gap : gap + 8)) { spot = 0; box = home; break; }
            for (const x of tries) { const b = boxAt(x); if (b && clear(b, strict)) { spot = x; box = b; break; } }
            if (box) break;
          }
        }
        if (box) {
          st.spot = spot;
          st.alpha = l.self ? 1 : st.alpha + (1 - st.alpha) * k;
          taken.push(l.self ? { left: box.left - selfPad, top: box.top - selfPad, right: box.right + selfPad, bottom: box.bottom + selfPad } : box);
        } else {
          // No room: it fades where it was, or goes at once if it would touch a label that has room.
          const was = boxAt(st.spot);
          st.alpha = !was || taken.some((t) => hits(was, t, 0)) ? 0 : st.alpha * (1 - k);
          if (st.alpha < 0.05) st.alpha = 0;
        }
        state.set(l.key, st);
        const shown = box ?? boxAt(st.spot) ?? boxAt(0) ?? { left: l.x - l.w / 2, top: l.y - l.h, right: l.x + l.w / 2, bottom: l.y };
        out.push({ ...l, ...shown, cx: (shown.left + shown.right) / 2, cy: (shown.top + shown.bottom) / 2, alpha: Math.round(st.alpha * 100) / 100, moved: st.spot !== 0, ...(box ? {} : { fading: true }) });
      }
      // A name fading out never touches a name that has its place, nor another one fading (whatever their order).
      const kept: LabelBox[] = [...taken];
      for (const o of out as (LabelOut & { fading?: boolean })[]) {
        if (!o.fading) continue;
        delete o.fading;
        if (o.alpha > 0 && kept.some((t) => hits(o, t, 0))) { o.alpha = 0; (state.get(o.key) as { alpha: number }).alpha = 0; }
        if (o.alpha > 0) kept.push(o);
      }
      for (const key of [...state.keys()]) if (!seen.has(key)) state.delete(key);
      return out;
    },
  };
}
