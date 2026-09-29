/**
 * ============================================================================
 *  controlStrip — a row of labelled sliders and latching buttons, with a live
 *  readout beside each label.
 * ============================================================================
 *
 *  The anatomy a tuning bar has every time somebody writes one: a group, a
 *  caption that is a word on the left and a VALUE on the right, and then either
 *  a range input or a button that remembers whether it is on. A photo panel, a
 *  live-tuning strip and a debug bar are all this, and every one of them writes
 *  the same twenty lines and then diverges only in what the words say.
 *
 *  ── THE VALUE IS A SEPARATE NODE FROM THE LABEL, ON PURPOSE ────────────────
 *
 *  A readout written into the caption's own text node means rewriting the label
 *  every frame, which is a layout-affecting mutation sixty times a second for a
 *  string that never changes. Two nodes, and only the second one is touched.
 *
 *  ── THE BUTTON OWNS ITS STATE AND PUBLISHES IT AS AN ATTRIBUTE ─────────────
 *
 *  `data-on` rather than a class, because a stylesheet can then key both states
 *  off one selector and a harness can READ the state without knowing the class
 *  vocabulary. `set()` exists because the thing behind the button can be turned
 *  off by something that is not the button — leaving a lit toggle over a
 *  feature that is already off is the kind of lie a still cannot see.
 *
 *  ── NO WORDS AND NO NUMBERS ARE HERE ───────────────────────────────────────
 *
 *  Every label, every range and every class name comes in. The class names in
 *  particular: a package that hard-coded `grp` would silently require every
 *  game's stylesheet to spell it that way, which is the CSS-custom-property
 *  failure in a different alphabet — a selector a package uses and no
 *  stylesheet defines renders as nothing at all with every probe green.
 */
import { el, setAttr, setText } from './uiUtil.ts';

/** Class names the strip writes. All of them are the caller's. */
export interface StripSkin {
  /** Wrapper around one control. */
  group: string;
  /** The caption row inside a group. */
  caption: string;
  /** Latching button. */
  button: string;
  /** The track a meter's fill sits in. Only `stripMeter` reads it. */
  bar?: string;
}

/** A caption with a live value node. */
export interface StripGroup {
  root: HTMLElement;
  /** The right-hand node. Write a readout into this, never into the caption. */
  val: HTMLElement;
}

/** A caption with a range input under it. */
export interface StripSlider extends StripGroup {
  input: HTMLInputElement;
}

/** A latching button that can be told what it is. */
export interface StripToggle {
  root: HTMLElement;
  btn: HTMLElement;
  /** Set the state WITHOUT firing the callback. */
  set(next: boolean): void;
}

/** A labelled group with an empty value node, appended to `host`. */
export function stripGroup(host: HTMLElement, skin: StripSkin, label: string): StripGroup {
  const g = el('div', skin.group);
  const cap = el('div', skin.caption);
  cap.append(el('span', '', label), el('b', '', ''));
  g.append(cap);
  host.append(g);
  return { root: g, val: cap.lastElementChild as HTMLElement };
}

/**
 * A labelled range. `onInput` receives the numeric value on every input event,
 * which is what makes a slider feel connected — a change-only handler updates
 * on release and reads as broken.
 */
export function stripSlider(
  host: HTMLElement, skin: StripSkin, label: string,
  min: number, max: number, step: number, value: number,
  onInput: (v: number) => void,
): StripSlider {
  const g = stripGroup(host, skin, label);
  const s = el('input');
  s.type = 'range';
  s.min = String(min); s.max = String(max); s.step = String(step);
  s.value = String(value);
  s.addEventListener('input', () => onInput(Number(s.value)));
  g.root.append(s);
  return { ...g, input: s };
}

/** A latching button. `onClick` receives the state it has just moved to. */
export function stripToggle(
  host: HTMLElement, skin: StripSkin, label: string, on: boolean,
  onClick: (v: boolean) => void,
): StripToggle {
  const g = el('div', skin.group);
  const b = el('button', skin.button, label);
  setAttr(b, 'data-on', on ? '1' : '0');
  let v = on;
  b.addEventListener('click', () => {
    v = !v;
    setAttr(b, 'data-on', v ? '1' : '0');
    onClick(v);
  });
  g.append(b);
  host.append(g);
  return { root: g, btn: b, set(next: boolean) { v = next; setAttr(b, 'data-on', v ? '1' : '0'); } };
}

/** A caption with a fraction bar under it. */
export interface StripMeter extends StripGroup {
  /** The track. */
  bar: HTMLElement;
  /** The fill inside the track; its width is the reading. */
  fill: HTMLElement;
}

/**
 * A labelled fraction bar. Same caption anatomy as `stripGroup`, plus a track
 * with a fill in it, appended to `host`.
 */
export function stripMeter(host: HTMLElement, skin: StripSkin, label: string): StripMeter {
  const g = stripGroup(host, skin, label);
  const bar = el('div', skin.bar ?? '');
  const fill = el('i');
  bar.append(fill);
  g.root.append(bar);
  return { ...g, bar, fill };
}

/**
 * THE LADDER, AND WHY ITS SIGN IS THE WHOLE TRICK.
 *
 * Most readings are "higher is better" — efficiency, condition, charge — and
 * some are "higher is worse": dust, wear, load, temperature. Those are the same
 * bar with the comparison the other way round, and writing them as two
 * functions means every future reading has to pick one and half of them pick
 * wrong. So a NEGATIVE threshold means higher-is-worse, the magnitudes are the
 * same numbers either way, and there is exactly one meter implementation.
 *
 * `warn` and `crit` have no defaults, because where a reading becomes worrying
 * is a statement about what the reading MEANS.
 */
export interface MeterLadder {
  /** Fraction at which the state becomes `warn`. Negative: higher is worse. */
  warn: number;
  /** ...and `crit`. Same sign as `warn`. */
  crit: number;
}

/**
 * Write a reading, 0..1. Clamped, because a fill wider than its track escapes
 * the panel and a negative one inverts on some engines rather than vanishing.
 *
 * The state lands on the meter's ROOT as `data-s` — `ok` / `warn` / `crit` — so
 * a stylesheet colours the track, the fill, the caption and the value from one
 * selector, and a harness can read the verdict without knowing the palette.
 */
export function setMeter(m: StripMeter, v: number, ladder: MeterLadder): void {
  const pct = v > 1 ? 1 : v > 0 ? v : 0;      // NaN falls to 0 through both tests
  m.fill.style.width = (pct * 100).toFixed(1) + '%';
  setText(m.val, (pct * 100).toFixed(0) + '%');
  const inv = ladder.warn < 0;
  const w = Math.abs(ladder.warn), c = Math.abs(ladder.crit);
  setAttr(m.root, 'data-s', inv
    ? (pct > c ? 'crit' : pct > w ? 'warn' : 'ok')
    : (pct < c ? 'crit' : pct < w ? 'warn' : 'ok'));
}
