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
 *   createBubbles()       speech bubbles over characters (room chat, NETPLAY.md section 19): what a player said, over
 *                         their body for a few seconds, the player's own placed first, never covering another bubble;
 *                         `paintBubbles` draws them on a canvas, and their boxes keep the name labels off them.
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

/* ------------------------------------------------------------------ speech bubbles (room chat, NETPLAY.md section 19) */

export interface BubbleOptions {
  /** A line's width as drawn, CSS px: `(t) => ctx.measureText(t).width` with the bubble's font set (paintBubbles uses BUBBLE_FONT). */
  measure: (text: string) => number;
  /** A text line's height, CSS px (default 17). */
  lineHeight?: number;
  /** The widest a bubble's text gets before it wraps, CSS px (default 190). */
  maxWidth?: number;
  /** Lines at most; the rest is cut with "…" (default 3). */
  maxLines?: number;
  /** How long a message stays, ms: default 4 s and 50 ms a character (at most 9 s); an emoji 2.6 s. */
  ms?: (b: { text: string; kind: 'text' | 'line' | 'react' }) => number;
  /** Space inside the bubble, CSS px (default x 8, y 5). */
  pad?: { x: number; y: number };
  /** The tail under the bubble, CSS px (default 7). */
  tail?: number;
  /** CSS px kept clear between two bubbles (default 4). */
  gap?: number;
  /** The screen, so a bubble is never pushed off it (default the window). */
  screen?: () => { w: number; h: number };
  /** Milliseconds now (default performance.now()). */
  now?: () => number;
  /** Boxes bubbles keep clear of, CSS px (a game's own speech bubbles, a panel): a bubble moves up past them. */
  avoid?: () => LabelBox[];
}

export interface BubbleIn {
  /** Whose bubble: the key `say(key, …)` was given (a seat, a slot). */
  key: string | number;
  /** Where the tail points, CSS px: just over the body's name label (its box's top middle) or its head. */
  x: number;
  y: number;
  /** The player's own (or the player a watcher follows): placed first. */
  self?: boolean;
}

export interface BubbleOut extends LabelBox {
  key: string | number;
  id: string;
  kind: 'text' | 'line' | 'react';
  /** The text, wrapped: one string per line (one line with the glyph for an emoji). */
  lines: string[];
  /** An emoji-only bubble (a reaction): draw it bigger, no words. */
  emoji: boolean;
  lineHeight: number;
  pad: { x: number; y: number };
  /** Where the tail points (the anchor), and the bubble's middle. */
  tip: { x: number; y: number };
  cx: number;
  cy: number;
  /** 0..1: fading in and out. `scale` pops in from 0.86. */
  alpha: number;
  scale: number;
}

export interface Bubbles {
  /** A message over `key`'s character: it replaces what that key was saying. `id` lets `remove(id)` take it down. */
  say(key: string | number, text: string, o?: { id?: string; kind?: 'text' | 'line' | 'react' }): void;
  /** The studio took a message down (net.on('unchat')): its bubble goes at once. */
  remove(id: string): void;
  /** Every bubble, or one key's, goes. */
  clear(key?: string | number): void;
  /** Each frame: where every speaking key's anchor is now. Keys not in the list are not drawn (off screen). */
  place(anchors: BubbleIn[], dt?: number): BubbleOut[];
  /** The boxes placed last frame: give them to createLabels' `avoid` so names keep off the bubbles. */
  boxes(): LabelBox[];
  /** How many keys are speaking now. */
  readonly size: number;
}

/** The bubble's font (paintBubbles draws with it; measure with it too). */
export const BUBBLE_FONT = '600 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** Words to lines no wider than `max` (a word wider than a line is broken), at most `n` lines (the last cut with …). */
export function wrapText(text: string, max: number, measure: (t: string) => number, n = 3): string[] {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  const push = (s: string): void => { lines.push(s); };
  for (const w0 of words) {
    let w = w0;
    // A word wider than a line: broken by characters.
    while (measure(w) > max) {
      let cut = [...w].length - 1;
      const chars = [...w];
      while (cut > 1 && measure(chars.slice(0, cut).join('')) > max) cut -= 1;
      if (cur) { push(cur); cur = ''; }
      push(chars.slice(0, cut).join(''));
      w = chars.slice(cut).join('');
    }
    const next = cur ? `${cur} ${w}` : w;
    if (measure(next) <= max) cur = next; else { if (cur) push(cur); cur = w; }
  }
  if (cur) push(cur);
  if (lines.length <= n) return lines;
  const kept = lines.slice(0, n);
  let last = `${kept[n - 1]}…`;
  while (measure(last) > max && last.length > 2) last = `${[...last].slice(0, -2).join('')}…`;
  kept[n - 1] = last;
  return kept;
}

/**
 * Speech bubbles over characters: what a player said in the room's chat, over their body, for a few seconds. Feed it
 * from the netplay helper (`net.on('say', (s) => bubbles.say(s.seat, s.text, { id: s.id, kind: s.kind }))` and
 * `net.on('unchat', (e) => e.ids.forEach((id) => bubbles.remove(id)))`), place it each frame with every speaking
 * body's anchor (over its name label), and draw what comes back (`paintBubbles` on a canvas, or your own). Bubbles
 * never cover each other: a bubble that would sits above the one in its way; the player's own is placed first.
 */
export function createBubbles(opts: BubbleOptions): Bubbles {
  const lh = opts.lineHeight ?? 17;
  const maxW = opts.maxWidth ?? 190;
  const maxLines = opts.maxLines ?? 3;
  const pad = opts.pad ?? { x: 8, y: 5 };
  const tail = opts.tail ?? 7;
  const gap = opts.gap ?? 4;
  const clock = opts.now ?? ((): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const screen = opts.screen ?? ((): { w: number; h: number } => ({ w: typeof innerWidth === 'number' ? innerWidth : 1e9, h: typeof innerHeight === 'number' ? innerHeight : 1e9 }));
  const life = opts.ms ?? ((b: { text: string; kind: string }): number => (b.kind === 'react' ? 2600 : Math.min(9000, 4000 + 50 * [...b.text].length)));
  type Live = { id: string; key: string | number; kind: 'text' | 'line' | 'react'; text: string; lines: string[]; w: number; h: number; at: number; until: number };
  const live = new Map<string | number, Live>();
  let last: LabelBox[] = [];
  let seq = 0;
  return {
    say(key, text, o = {}) {
      const kind = o.kind ?? 'text';
      const t = String(text ?? '').trim();
      if (!t) return;
      const emoji = kind === 'react';
      const lines = emoji ? [t] : wrapText(t, maxW, opts.measure, maxLines);
      const w = emoji ? lh * 1.6 : Math.max(...lines.map((l) => opts.measure(l)));
      const h = emoji ? lh * 1.6 : lines.length * lh;
      const at = clock();
      seq += 1;
      live.set(key, { id: o.id ?? `b${seq}`, key, kind, text: t, lines, w, h, at, until: at + life({ text: t, kind }) });
    },
    remove(id) { for (const [k, b] of live) if (b.id === id) live.delete(k); },
    clear(key) { if (key === undefined) live.clear(); else live.delete(key); },
    get size() { return live.size; },
    boxes() { return last; },
    place(anchors) {
      const t = clock();
      for (const [k, b] of live) if (t >= b.until) live.delete(k);
      const { w: sw, h: sh } = screen();
      const keep = opts.avoid?.() ?? [];
      const placed: LabelBox[] = [];
      const out: BubbleOut[] = [];
      // The player's own first, then the newest: a new message keeps its spot and an older one moves up.
      const order = anchors.filter((a) => live.has(a.key)).sort((a, b) => Number(Boolean(b.self)) - Number(Boolean(a.self)) || (live.get(b.key)!.at - live.get(a.key)!.at));
      for (const a of order) {
        const b = live.get(a.key)!;
        const bw = b.w + pad.x * 2;
        const bh = b.h + pad.y * 2;
        const left = Math.max(2, Math.min(sw - bw - 2, a.x - bw / 2));
        let bottom = a.y - tail;
        let box = { left, top: bottom - bh, right: left + bw, bottom };
        const hits = (x: LabelBox): boolean => box.left < x.right + gap && x.left < box.right + gap && box.top < x.bottom + gap && x.top < box.bottom + gap;
        for (let i = 0; i < 6; i += 1) {
          const other = placed.find(hits) ?? keep.find(hits);
          if (!other) break;
          bottom = other.top - gap;
          box = { left, top: bottom - bh, right: left + bw, bottom };
        }
        if (box.top < 0 || box.left > sw || box.right < 0 || a.y > sh + bh) continue;
        placed.push(box);
        const age = t - b.at;
        const leftMs = b.until - t;
        const alpha = Math.max(0, Math.min(1, age / 120, leftMs / 400));
        const scale = 0.86 + 0.14 * Math.min(1, age / 160);
        out.push({ ...box, key: b.key, id: b.id, kind: b.kind, lines: b.lines, emoji: b.kind === 'react', lineHeight: lh, pad, tip: { x: Math.max(box.left + 8, Math.min(box.right - 8, a.x)), y: a.y }, cx: (box.left + box.right) / 2, cy: (box.top + box.bottom) / 2, alpha: Math.round(alpha * 100) / 100, scale: Math.round(scale * 1000) / 1000 });
      }
      last = placed;
      return out;
    },
  };
}

export interface BubbleStyle {
  font?: string;
  /** The bubble's paper and ink (default white paper, near-black ink), its edge, and the player's own bubble's edge. */
  paper?: string;
  ink?: string;
  edge?: string;
  selfEdge?: string;
  /** Corner radius, CSS px (default 10). */
  radius?: number;
}

/** Draw placed bubbles on a 2D canvas (CSS px, the context's transform already set for the device pixel ratio). */
export function paintBubbles(ctx: CanvasRenderingContext2D, list: BubbleOut[], style: BubbleStyle = {}): void {
  const font = style.font ?? BUBBLE_FONT;
  const paper = style.paper ?? '#ffffff';
  const ink = style.ink ?? '#15171f';
  const edge = style.edge ?? 'rgba(0,0,0,0.18)';
  const r = style.radius ?? 10;
  for (const b of list) {
    if (b.alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = b.alpha;
    const cx = b.cx;
    const cy = b.bottom;
    ctx.translate(cx, cy);
    ctx.scale(b.scale, b.scale);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = paper;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(b.left, b.top, b.right - b.left, b.bottom - b.top, Math.min(r, (b.bottom - b.top) / 2));
    ctx.fill();
    ctx.stroke();
    // The tail: a small triangle from the bubble's bottom to where it points.
    const tx = b.tip.x;
    ctx.beginPath();
    ctx.moveTo(tx - 6, b.bottom - 1);
    ctx.lineTo(tx, Math.min(b.tip.y, b.bottom + 7));
    ctx.lineTo(tx + 6, b.bottom - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (b.emoji) {
      ctx.font = font.replace(/\d+(?:\.\d+)?px/, `${Math.round(b.lineHeight * 1.35)}px`);
      ctx.fillText(b.lines[0] ?? '', b.cx, b.cy + 1);
    } else {
      ctx.font = font;
      b.lines.forEach((line, i) => ctx.fillText(line, b.cx, b.top + b.pad.y + b.lineHeight * (i + 0.5) + 0.5));
    }
    ctx.restore();
  }
}
