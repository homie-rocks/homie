/**
 * Small, allocation-conscious helpers shared by the HUD, minimap and menus.
 * Everything that writes to the DOM goes through the cached setters below —
 * the HUD touches a dozen elements every frame and un-cached writes would
 * force a style recalc on each one even when the value has not moved.
 */

/* -----------------------------------------------------------------------------
 * THIS FILE ARRIVED HERE VERBATIM, AND ONE EXPORT DELIBERATELY DID NOT COME.
 *
 * Two games carried this file byte-identical (measured 2026-08-19). Its first
 * half is that file, comment for comment, except this header, the dropped
 * `TIER_COLORS` line, and ONE added `!` inside `p2()` — which `strict: true,
 * noUncheckedIndexedAccess: true` demands here and no game demands, because
 * all of them run `strict: false`. Parameter properties were left alone:
 * `Spring`'s survives verbatim and the emit assigns the same two fields, so
 * there was nothing to pay for changing it.
 *
 * `TIER_COLORS` STAYED IN THE GAMES, and it is the reason to read this note
 * before adding anything that looks like a constant. Both racers export a
 * four-entry `TIER_COLORS` from this exact filename and the hexes are
 * completely different — `['#a8b6cc','#4fc3ff','#ff9d2e','#c05cff']` in one
 * against `['#4b7d94','#37d6ff','#8a5cff','#f2fbff']` in the other — and the
 * second game's own comment says *"These are the SAME hexes the skirt and the
 * deck decal use"*. So the array is not a palette, it is a CONTRACT WITH THAT
 * GAME'S WORLD RENDERER wearing a shared name. Hoisting one of the two would
 * have silently repainted the other game's drift ladder and nothing would have
 * gone red. Anything that looks like a palette in these files is a contract
 * with something else in that game. Do not hoist a single hex.
 *
 * WHAT IS STILL ONE FILE AND SHOULD NOT BE. It splits naturally into
 * `dom.ts` / `motion.ts` / `num.ts` / `colour.ts` — "what is this file" needs
 * an "and" three times over. It stays one file for now because splitting means
 * every comment moves, with a chance to lose one on the way.
 * -------------------------------------------------------------------------- */

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Frame-rate independent exponential approach, parameterised by a RATE.
 *
 * `approach()` below is the same curve parameterised by a TIME CONSTANT, plus a
 * settle snap. They are NOT merged and this is the reason, stated with the line
 * count so it is a refusal and not a shrug: `damp` is 3 lines, `approach` is 6,
 * and every way of making them one costs more than nine lines are worth.
 * Folding `approach`'s snap into `damp` changes the easing of two shipped
 * racers from a package that does not own them; rewriting `damp`'s call sites
 * from `lambda` to `1/lambda` is the same edit with more of it. `lambda` reads
 * naturally where a designer thinks "how fast", `tau` where they think "how
 * long", and both spellings are in this file on purpose.
 */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/**
 * The same curve as `damp`, given a TIME CONSTANT, and it SETTLES.
 *
 * From the base-building game's HUD, whose own note is the argument for
 * having it: *"a fixed alpha — `cur + (t - cur) * 0.1` per frame — is a
 * different curve at 30 fps than at 120, which is exactly the class of bug that
 * makes a HUD feel 'floaty on my machine'. Nothing in the UI moves linearly."*
 *
 * THE SNAP IS THE PART THAT IS NOT IN `damp`. An exponential never arrives, so
 * a bar driven by one spends the rest of the page's life asymptotically not
 * getting there and the browser repaints every frame for a difference nobody
 * can see. `1e-4` is below one part in a thousand of any normalised readout and
 * below a tenth of a millimetre of any world quantity, so the snap is invisible
 * and the repaints stop.
 *
 * `tau <= 0` (and NaN, via the negated comparison) returns the target rather
 * than dividing by it. That is not a tolerant default hiding a bug: a zero time
 * constant means "arrive immediately" and the limit of the expression IS the
 * target, so the branch is the arithmetic rather than a rescue from it.
 */
export function approach(cur: number, target: number, tau: number, dt: number): number {
  if (!(tau > 0)) return target;
  const a = 1 - Math.exp(-dt / tau);
  const next = cur + (target - cur) * a;
  return Math.abs(target - next) < 1e-4 ? target : next;
}

/**
 * Make an element.
 *
 * ── THE TWO SIGNATURES, AND WHY THE THIRD ARGUMENT IS A UNION ───────────────
 * `el()` existed twice with INCOMPATIBLE third parameters: the racers'
 * `el(tag, cls, parent, text)` appends as it builds, and the base-building
 * game's `el(tag, cls, text)` never appends because that file's callers hold
 * their own parents. 133 call sites in that game pass three arguments and
 * every racer call site that passes three passes an Element.
 *
 * The union is the resolution rather than a fudge, for one specific reason:
 * **the two types are disjoint at runtime and disjoint in the overloads**, so
 * there is no argument any caller can write that is legal under both readings.
 * A `string` is text; an `Element` is a parent; nothing is both. That is not a
 * per-game mode branch, because no caller states which reading it wants — the
 * value states it, the way `document.createElement`'s own wrappers have always
 * done.
 *
 * Rewriting 133 call sites to `el(tag, cls, undefined, text)` was the
 * alternative and it makes every one of them worse to read.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, parent?: Element, text?: string,
): HTMLElementTagNameMap[K];
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls: string | undefined, text: string,
): HTMLElementTagNameMap[K];
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parentOrText?: Element | string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  const t = typeof parentOrText === 'string' ? parentOrText : text;
  if (t !== undefined) e.textContent = t;
  if (typeof parentOrText === 'object' && parentOrText !== null) parentOrText.appendChild(e);
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * An SVG element with attributes. Values are numbers or strings; nothing else.
 *
 * From the base-building game's HUD, and the reason it is a function rather
 * than a template literal is a known trap: a backtick inside a template
 * literal ends the string, and the module then fails to parse 100–200 lines
 * later in a way that looks like a slow load. Every SVG node in that file is
 * built with `createElementNS` precisely so the trap has nowhere to happen,
 * and publishing the helper is what lets the next game inherit the discipline
 * rather than the trap.
 *
 * The return is `SVGElement` and not a per-tag type on purpose: the tag is a
 * string here because callers build `circle`/`path`/`text` from data, and
 * narrowing it would push a cast to every one of them.
 */
export function sg(tag: string, attrs?: Record<string, string | number>): SVGElement {
  const n = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  return n;
}

/** Ordinal suffix only — "st" / "nd" / "rd" / "th". */
export function ordinalSuffix(n: number) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

const PAD2 = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09'];
// `PAD2[n]!` — the guard is the `n < 10` on the same line, but
// `noUncheckedIndexedAccess` (on here, off in every game) types the read as
// `string | undefined`. Without the assertion `p2` returns `string | undefined`
// and a `${undefined}` lands in a clock people are reading. Runtime is identical.
function p2(n: number) { return n < 10 ? PAD2[n]! : String(n); }

/** The three fields of a clock, already padded. `f` carries no leading dot. */
export interface ClockFields { m: string; s: string; f: string; }

/**
 * A clock DECOMPOSED rather than formatted, because a race timer that must not
 * jitter cannot be a string.
 *
 * Both racers split the running clock into three spans of reserved width —
 * minutes, seconds, hundredths — so that no advance-width difference, subpixel
 * rounding or font fallback can move a digit; the kart racer measured 5 px of
 * horizontal jump before it did. Each therefore carried its own copy of the
 * four lines below AND its own copy of `PAD2`/`p2`, which made THREE copies of
 * the same zero-pad table counting the one here.
 *
 * Worse than the duplication: the split clock and `formatClock` were separate
 * derivations of the same instant, so the timer plate and the lap split could
 * disagree in the last place with nothing comparing them. There is one
 * derivation now and `formatClock` composes its string from it.
 *
 * `out` is filled in place. The running timer writes this every frame and both
 * racers state "no per-frame object is allocated once the tree is built" as an
 * invariant, so a fresh record per call would be a regression against something
 * a game promised rather than a tidy return value.
 */
const _clock: ClockFields = { m: '', s: '', f: '' };
export function clockParts(seconds: number, frac = 2, out: ClockFields = _clock): ClockFields {
  const s = seconds < 0 ? 0 : seconds;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s - m * 60);
  const f = Math.floor((s - m * 60 - sec) * (frac === 3 ? 1000 : 100));
  out.m = String(m);
  out.s = p2(sec);
  out.f = frac === 3 ? (f < 10 ? '00' + f : f < 100 ? '0' + f : String(f)) : p2(f);
  return out;
}

/** `m:ss.hh` by default; `frac = 3` for lap times. */
export function formatClock(seconds: number, frac = 2) {
  const p = clockParts(seconds, frac, _clock);
  return `${p.m}:${p.s}.${p.f}`;
}

/** Signed delta, e.g. "-0.42" / "+1.08". */
export function formatDelta(seconds: number) {
  const sign = seconds < 0 ? '-' : '+';
  const a = Math.abs(seconds);
  return a >= 60 ? `${sign}${formatClock(a)}` : `${sign}${a.toFixed(2)}`;
}

/**
 * ONE magnitude policy for every quantity in a TABULAR SERIES, stock and delta
 * alike.
 *
 * From the base-building game's HUD, and the argument travels intact because
 * it is about eyes and columns rather than about a colony: *"the rail is a
 * tabular scan — eleven stocks in a row with their deltas directly underneath.
 * That only pays off when the things being lined up are formatted ALIKE, and
 * they were not. A stock printed `0` while its neighbour printed `0.011` and a
 * third printed `5.43`, so the decimal points did not line up column to column
 * and the eye could not read the row as one series."*
 *
 * So decimals are a function of MAGNITUDE ONLY, applied identically to every
 * number in the series, and zero formats like any other small value (`0.00`,
 * never a bare `0`). Four glyphs of mantissa maximum, which is what fits a
 * readout tile at any sane width.
 *
 * This is NOT `formatClock`/`formatDelta` above wearing a different name: those
 * two format TIME, in minutes and seconds, and both of them break a series
 * rather than keep one. The three coexist deliberately.
 */
export function formatSeries(v: number): string {
  const a = Math.abs(v);
  if (a >= 100000) return (v / 1000).toFixed(0) + 'k';
  if (a >= 1000) return (v / 1000).toFixed(1) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

type Cached = Element & { __ut?: string; __us?: Record<string, string> };

/**
 * Write text only when it actually changed.
 *
 * THE CACHE IS ON THE NODE, NOT A READ OF THE NODE, and the difference matters
 * to one caller. The base-building game's HUD shipped the other spelling —
 * `if (n.textContent !== s)` — which is correct under every condition and
 * costs a DOM read. This one costs a property lookup and is stale if anything
 * writes `textContent` behind its back. Both sites in that game that do write
 * at CONSTRUCTION, before any `setText` on that node, so the cache is
 * populated after them and never behind them. Adding a node whose text is
 * written both ways, in that order, is the one way to make this lie.
 */
export function setText(e: Element, v: string) {
  const c = e as Cached;
  if (c.__ut === v) return;
  c.__ut = v;
  e.textContent = v;
}

/**
 * Attribute write, guarded, and it is the SVG half of the story — an SVG
 * node's geometry is attributes rather than style, so a gauge built with `sg()`
 * pushes its whole frame through here.
 *
 * IT READS THE DOM AND DOES NOT CACHE ON THE NODE, WHICH IS THE OPPOSITE OF
 * `setText` ABOVE, AND THAT IS DELIBERATE. This is the base-building game's
 * implementation promoted unchanged rather than rewritten to match its
 * neighbour, because the caching version is only correct while nothing writes
 * the attribute behind it — and attributes, unlike text, are written behind it
 * constantly. Twenty-eight sites across that game's UI call `setAttribute`
 * directly (`data-on`, `data-act`, `data-why`, `data-state`, …), several of
 * them from live code paths rather than from construction, and a node cache
 * would make the next `setAttr` of a value the cache already holds a silent
 * no-op against a DOM that had moved on. That is the tolerant-lookup shape: it
 * would render perfectly and be wrong. A `getAttribute` costs a read and
 * cannot be stale.
 */
export function setAttr(e: Element, k: string, v: string) {
  if (e.getAttribute(k) !== v) e.setAttribute(k, v);
}

/** Cached inline-style write (also used for custom properties). */
export function setStyle(e: HTMLElement, prop: string, v: string) {
  const c = e as unknown as Cached;
  const s = c.__us || (c.__us = {});
  if (s[prop] === v) return;
  s[prop] = v;
  if (prop.charCodeAt(0) === 45) e.style.setProperty(prop, v);
  else (e.style as any)[prop] = v;
}

/** Cached numeric style write, quantised so sub-perceptual jitter is free. */
export function setNum(e: HTMLElement, prop: string, v: number, q = 0.005, unit = '') {
  const r = Math.round(v / q) * q;
  setStyle(e, prop, (Math.abs(r) < 1e-6 ? 0 : +r.toFixed(4)) + unit);
}

/** Restart a CSS animation on an element that may already be running one. */
export function retrigger(e: HTMLElement, cls: string) {
  e.classList.remove(cls);
  void e.offsetWidth; // force reflow so the removal is committed
  e.classList.add(cls);
}

/** A light second-order spring — used for the needle so it overshoots. */
export class Spring {
  value = 0;
  vel = 0;
  target = 0;
  constructor(public stiffness = 220, public damping = 18) {}

  step(dt: number) {
    // two substeps keeps a stiff spring stable at a 50 ms clamped frame
    const h = dt * 0.5;
    for (let i = 0; i < 2; i++) {
      const a = -this.stiffness * (this.value - this.target) - this.damping * this.vel;
      this.vel += a * h;
      this.value += this.vel * h;
    }
  }

  snap(v: number) { this.value = v; this.target = v; this.vel = 0; }
}

/** #rrggbb for a three.js colour without importing three at runtime. */
export function cssColor(c: { getHexString(): string }) {
  return '#' + c.getHexString();
}

/* -----------------------------------------------------------------------------
 * FOUR MORE FROM THE SPACE RACER'S OWN `uiUtil.ts`, WHICH HAD KEPT THEM BACK
 * WITH A STATED REASON.
 *
 * That file's own header said `clamp01`, `wrapDelta`, `formatSecs`, `mixHex`
 * and `temperColor` are generic-looking and stayed because they had exactly
 * ONE consumer, and a shared package is where code goes when two things need
 * it.
 *
 * The first half of that is a duplication count and the second half is a real
 * principle, and they are not the same test. The test used here is: can the
 * function be described without naming anything in the game's fiction? Clamp
 * to the unit interval; signed shortest distance on a circle; one decimal with
 * a fixed field width; an sRGB blend of two hex strings. Not one of those
 * names a ship. `temperColor` stayed behind and is the control that shows the
 * test has teeth — its three legs and six breakpoints ARE the heat economy.
 * -------------------------------------------------------------------------- */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Signed shortest distance from `a` to `b` on the unit circle, in (-0.5, 0.5]. */
export function wrapDelta(a: number, b: number) {
  let d = b - a;
  d -= Math.floor(d);
  return d > 0.5 ? d - 1 : d;
}

/**
 * A bare `s.s`, for a countdown that must not change WIDTH.
 *
 * One decimal, never a leading zero minute, and it caps at 99.9 rather than
 * growing a field: a readout whose width changes is a readout that jitters,
 * and the number only matters in its last few seconds anyway. The caller
 * reserves the slot in `ch`; this guarantees the slot is enough.
 */
export function formatSecs(seconds: number) {
  const s = seconds < 0 ? 0 : seconds > 99.9 ? 99.9 : seconds;
  return s.toFixed(1);
}

const HEX = new Map<string, [number, number, number]>();
function parseHex(h: string): [number, number, number] {
  let v = HEX.get(h);
  if (!v) {
    const n = parseInt(h.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    HEX.set(h, v);
  }
  return v;
}

/**
 * Linear blend of two `#rrggbb` strings, RETURNING `#rrggbb`.
 *
 * sRGB rather than linear-light on purpose: this is UI ink drawn straight into
 * the composited page, downstream of a renderer's tone map and of nothing. A
 * linear-light mix would be correct for a material and wrong here — it makes a
 * straw-to-red temper ramp go bright orange through the middle, which reads as
 * a third state the thing being measured does not have.
 *
 * THE RETURN TYPE IS LOAD-BEARING AND THE GAME THAT WROTE THIS PAID FOR IT: an
 * `rgb(255, 157, 42)` argument silently becomes `NaN` under `parseInt`, and
 * every downstream bit operation collapses to zero — a black fill, with no
 * error reported anywhere. Feed this only what it returns. `./colour.ts`'s
 * `oklabRamp` is the answer when the blend has to be perceptual; this one is
 * the answer when it has to be cheap and exactly what the two ends are.
 */
export function mixHex(a: string, b: string, t: number) {
  const k = clamp01(t);
  const A = parseHex(a);
  const B = parseHex(b);
  const r = (A[0]! + (B[0]! - A[0]!) * k) | 0;
  const g = (A[1]! + (B[1]! - A[1]!) * k) | 0;
  const bl = (A[2]! + (B[2]! - A[2]!) * k) | 0;
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/**
 * A small integer as a Roman numeral, for a tier, an act or a chapter.
 *
 * A TABLE AND NOT AN ALGORITHM, because the only callers that exist count to
 * four and a subtractive-notation converter would be thirty lines nobody can
 * check by eye against a use that never leaves single digits. Anything outside
 * the table comes back as its own decimal — visible, and therefore fixable —
 * rather than silently pinned to the last entry, which is what one of the three
 * hand-written copies of this did and is how a fifth tier prints as the fourth
 * for a while before anybody notices.
 *
 * Written three times in ONE game's `ui/` directory: twice byte-identical and
 * once with a different out-of-range answer, which is exactly the shape a
 * duplication counter scores as clean.
 */
export function roman(n: number): string {
  return ['0', 'I', 'II', 'III', 'IV'][n] || String(n);
}
