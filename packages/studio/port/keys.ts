/*
 * Keys on computers, and keys synthesized from touch on phones.
 *
 * Most single-player web games read the keyboard. A port keeps that code and
 * lets the touch kit press the same keys (a stick held left presses ArrowLeft,
 * a button presses Space), so the game's own input code stays the one truth.
 * The synthetic events carry the legacy keyCode/which/charCode too, because
 * older games (and jQuery) read those rather than `key` or `code`.
 */

export type Dir = 'left' | 'right' | 'up' | 'down';

const CODES: Record<string, [key: string, keyCode: number]> = {
  ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
  Space: [' ', 32], Enter: ['Enter', 13], Escape: ['Escape', 27], Tab: ['Tab', 9], Backspace: ['Backspace', 8],
  ShiftLeft: ['Shift', 16], ShiftRight: ['Shift', 16], ControlLeft: ['Control', 17], AltLeft: ['Alt', 18],
};

/** `key`, `keyCode` for a KeyboardEvent.code ('KeyW', 'Digit1', 'ArrowLeft', 'Space', …). */
export function keyInfo(code: string): { key: string; keyCode: number } {
  const known = CODES[code];
  if (known) return { key: known[0], keyCode: known[1] };
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return { key: (letter[1] as string).toLowerCase(), keyCode: (letter[1] as string).charCodeAt(0) };
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return { key: digit[1] as string, keyCode: 48 + Number(digit[1]) };
  return { key: code, keyCode: 0 };
}

/** Where synthetic keys go: the focused element (it bubbles to document and window), else the body. */
function keyTarget(): EventTarget {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  return a && a !== document.documentElement ? a : (document.body ?? document);
}

const synthDown = new Set<string>();

/** Dispatch one synthetic key event that old and new games both understand. */
export function synthKey(type: 'keydown' | 'keyup', code: string, target: EventTarget = keyTarget()): void {
  const { key, keyCode } = keyInfo(code);
  const ev = new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true, composed: true, repeat: false });
  for (const [prop, value] of [['keyCode', keyCode], ['which', keyCode], ['charCode', type === 'keydown' ? 0 : 0]] as const) {
    try { Object.defineProperty(ev, prop, { get: () => value }); } catch { /* read-only on this engine */ }
  }
  if (type === 'keydown') synthDown.add(code); else synthDown.delete(code);
  target.dispatchEvent(ev);
}

/** Hold `code` down (once) or let it go; no repeats, like a real key held still. */
export function holdKey(code: string, down: boolean): void {
  if (down && !synthDown.has(code)) synthKey('keydown', code);
  else if (!down && synthDown.has(code)) synthKey('keyup', code);
}

/** A quick press and release (a swipe on a board game, a tap). */
export function tapKey(code: string, holdMs = 40): void {
  synthKey('keydown', code);
  setTimeout(() => synthKey('keyup', code), holdMs);
}

export function releaseAllSynthKeys(): void { for (const c of [...synthDown]) synthKey('keyup', c); }

/** The keyboard, read directly: WASD and arrows as a move vector, and edges for buttons. */
export interface Keys {
  /** Screen-space move: x right, y DOWN, length ≤ 1. */
  move(): { x: number; y: number };
  down(code: string): boolean;
  /** True once per press (consumed). */
  pressed(code: string): boolean;
  destroy(): void;
}

export function createKeys(target: Window | HTMLElement = window): Keys {
  const held = new Set<string>();
  const edges = new Set<string>();
  const kd = (e: Event): void => {
    const k = e as KeyboardEvent;
    // A key typed into the game's own text box (a hero's name, a chat line) is a word, never a move.
    const el = k.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''))) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k.code)) k.preventDefault();
    if (!held.has(k.code)) edges.add(k.code);
    held.add(k.code);
  };
  const ku = (e: Event): void => { held.delete((e as KeyboardEvent).code); };
  // A lost focus releases keys (a key-up we never saw would hold a direction forever). It never touches fingers.
  const blur = (): void => { held.clear(); };
  target.addEventListener('keydown', kd);
  target.addEventListener('keyup', ku);
  window.addEventListener('blur', blur);
  return {
    move() {
      let x = 0; let y = 0;
      if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1;
      if (held.has('KeyD') || held.has('ArrowRight')) x += 1;
      if (held.has('KeyW') || held.has('ArrowUp')) y -= 1;
      if (held.has('KeyS') || held.has('ArrowDown')) y += 1;
      const len = Math.hypot(x, y);
      return len > 1 ? { x: x / len, y: y / len } : { x, y };
    },
    down: (code) => held.has(code),
    pressed(code) { const had = edges.has(code); edges.delete(code); return had; },
    destroy() { target.removeEventListener('keydown', kd); target.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); },
  };
}
