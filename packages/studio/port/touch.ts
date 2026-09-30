/*
 * Phone controls that stay out of the way and work on a real iPhone.
 *
 * What it draws: NOTHING at rest. A stick appears where the thumb lands in the
 * stick zone (the lower-left by default) and follows that thumb; a few small,
 * see-through buttons sit at the right edge, shown only while their action is
 * available. Computers get no touch UI at all. Coverage stays far under the
 * 12%-of-the-screen bar, and nothing opaque ever sits in the middle third.
 *
 * What it gets right (every line below is a bug a real phone found):
 *   - Fingers are followed by Touch.identifier with `null` meaning "no finger".
 *     iOS Safari's ids are random 32-bit numbers, NEGATIVE in about half of its
 *     processes: a `-1` sentinel and an `id >= 0` test made a stick that drew
 *     fine and never moved anything. Emulators number fingers 0,1,2 and pass.
 *   - Window listeners, capture phase, passive:false, preventDefault on every
 *     game touch, and Safari's gesture* events cancelled: otherwise a two-finger
 *     stick+button press pinches the page and the browser cancels the touch.
 *   - pointercancel is ignored while the finger is still down; a window blur
 *     (the play page focusing the frame) never drops a finger.
 *   - The stick belongs to the finger that started in the stick zone, never to
 *     whichever finger landed last (a resting palm must not steal it).
 *   - A thumb past the rim drags the base along, so reversing is instant.
 *   - Past the dead zone the push starts at 35%, so a small push moves you.
 *   - Touches on the game's own DOM buttons (a, button, [data-touch-pass]) pass
 *     through untouched, so its menus still click.
 *   - Touch Events where 'ontouchstart' exists (WebKit's iPhone profile reports
 *     maxTouchPoints 0), Pointer Events (pen/touch only) elsewhere.
 * `?touchdebug=1` (the studio's play page forwards it) draws every finger and
 * the stick vector, so a person's report says what really happened.
 *
 * Old keyboard games: give the stick `keys` and buttons `key`, and the kit
 * presses real-looking keys, so the game's own input code stays the only one.
 */
import { holdKey, releaseAllSynthKeys, tapKey, type Dir } from './keys';

export interface TouchButton {
  id: string;
  /** One or two characters or a short word; drawn small. */
  label?: string;
  /** A KeyboardEvent.code to hold while pressed ('Space', 'KeyZ'), for games that read keys. */
  key?: string;
  /** Position from the right/bottom edges in CSS px (default: stacked up the right edge). */
  right?: number;
  bottom?: number;
  /** Diameter in CSS px (default 68; never under 56). */
  size?: number;
  /** Shown (and pressable) only while this returns true. */
  when?: () => boolean;
}

export interface TouchOptions {
  /** The stick: a zone as fractions of the screen [x0, y0, x1, y1] (default [0, 0.3, 0.55, 1]). `false`: no stick. */
  stick?: false | {
    zone?: [number, number, number, number];
    radius?: number;
    dead?: number;
    /** Hold these keys while the stick points that way (8-way, threshold 0.45). */
    keys?: Partial<Record<Dir, string>> | false;
    /** Only the four main directions (a grid game): the larger axis wins. */
    fourWay?: boolean;
  };
  /** Drag-to-look (first person): a zone as fractions; deltas are read with look(). */
  look?: false | { zone?: [number, number, number, number]; key?: never };
  /** Swipes anywhere outside the stick/look zones and buttons (board and puzzle games). */
  swipe?: false | { min?: number; keys?: Partial<Record<Dir, string>> };
  /** A quick tap outside everything else presses this key (e.g. 'Space' to flap or jump). */
  tapKey?: string;
  buttons?: TouchButton[];
  /** Show the controls even on a device without touch (tests). */
  force?: boolean;
  /** Draw fingers and the stick vector (default: ?touchdebug=1). */
  debug?: boolean;
  /** Element touches must start on to be the game's (default: anything but the game's own DOM buttons). */
  passThrough?: (target: EventTarget | null) => boolean;
}

export interface TouchControls {
  /** True on a touch device (or with force). */
  readonly enabled: boolean;
  /** Screen-space stick: x right, y DOWN, length 0..1. */
  stick(): { x: number; y: number; active: boolean };
  held(id: string): boolean;
  /** True once per press of a button (consumed). */
  pressed(id: string): boolean;
  /** Look-drag deltas in CSS px since the last call. */
  look(): { dx: number; dy: number };
  /** Swipes since the last call. */
  swipes(): Dir[];
  /** Fingers down right now (for a harness or a debug line). */
  fingers(): number;
  destroy(): void;
}

type Role = 'stick' | 'look' | 'button' | 'swipe' | 'pass';
interface Finger { id: number; role: Role; button?: string; x0: number; y0: number; x: number; y: number; t0: number; ox: number; oy: number }

const CSS = `
.hp-touch{position:fixed;pointer-events:none;z-index:2147483000;touch-action:none;-webkit-user-select:none;user-select:none}
.hp-base{border-radius:50%;border:2px solid rgba(255,255,255,.34);background:rgba(255,255,255,.05);transform:translate(-50%,-50%)}
.hp-knob{border-radius:50%;background:rgba(255,255,255,.42);transform:translate(-50%,-50%)}
.hp-btn{border-radius:50%;background:rgba(255,255,255,.14);border:2px solid rgba(255,255,255,.34);color:rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center;font:700 14px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;text-shadow:0 1px 2px rgba(0,0,0,.6)}
.hp-btn.on{background:rgba(255,255,255,.34)}
.hp-dbg{position:fixed;inset:0;pointer-events:none;z-index:2147483001}
`;

const DEFAULT_PASS = (t: EventTarget | null): boolean => {
  const el = t as Element | null;
  return Boolean(el && typeof el.closest === 'function' && el.closest('a,button,input,select,textarea,label,[role=button],[data-touch-pass]'));
};

function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0);
}

export function createTouchControls(opts: TouchOptions = {}): TouchControls {
  const enabled = Boolean(opts.force) || isTouchDevice();
  type StickCfg = { zone: [number, number, number, number]; radius: number; dead: number; keys: Partial<Record<Dir, string>> | false; fourWay: boolean };
  const stickOpt: StickCfg | null = opts.stick === false ? null : { zone: [0, 0.3, 0.55, 1], radius: 56, dead: 7, keys: false, fourWay: false, ...(opts.stick ?? {}) } as StickCfg;
  const lookOpt = opts.look ? { zone: [0.45, 0, 1, 1] as [number, number, number, number], ...opts.look } : null;
  const swipeOpt = opts.swipe ? { min: 28, ...opts.swipe } : null;
  const buttons = (opts.buttons ?? []).map((b, i) => ({ size: Math.max(56, b.size ?? 68), right: b.right ?? 18, bottom: b.bottom ?? 24 + i * 84, ...b }));
  const passThrough = opts.passThrough ?? DEFAULT_PASS;
  let debug = opts.debug ?? false;
  try { if (opts.debug === undefined) debug = new URLSearchParams(location.search).get('touchdebug') === '1'; } catch { /* opaque */ }

  const fingers = new Map<number, Finger>();
  let stickId: number | null = null; // NEVER a negative sentinel: iOS ids are negative half the time
  const heldButtons = new Set<string>();
  const edges = new Set<string>();
  let lookDx = 0; let lookDy = 0;
  const swipeQueue: Dir[] = [];
  let heldDirKeys = new Set<string>();

  const api: TouchControls = {
    enabled,
    stick: () => readStick(),
    held: (id) => heldButtons.has(id),
    pressed(id) { const had = edges.has(id); edges.delete(id); return had; },
    look() { const out = { dx: lookDx, dy: lookDy }; lookDx = 0; lookDy = 0; return out; },
    swipes() { return swipeQueue.splice(0, swipeQueue.length); },
    fingers: () => fingers.size,
    destroy,
  };
  if (!enabled || typeof document === 'undefined') return api;

  // ------------------------------------------------------------------ DOM
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const base = document.createElement('div');
  const knob = document.createElement('div');
  base.className = 'hp-touch hp-base';
  knob.className = 'hp-touch hp-knob';
  const r = stickOpt?.radius ?? 56;
  Object.assign(base.style, { width: `${r * 2}px`, height: `${r * 2}px`, display: 'none' });
  Object.assign(knob.style, { width: `${Math.round(r * 0.8)}px`, height: `${Math.round(r * 0.8)}px`, display: 'none' });
  const btnEls = new Map<string, HTMLDivElement>();
  for (const b of buttons) {
    const el = document.createElement('div');
    el.className = 'hp-touch hp-btn';
    el.textContent = b.label ?? b.id;
    Object.assign(el.style, { width: `${b.size}px`, height: `${b.size}px`, right: `calc(${b.right}px + env(safe-area-inset-right))`, bottom: `calc(${b.bottom}px + env(safe-area-inset-bottom))` });
    btnEls.set(b.id, el);
  }
  const mount = (): void => { document.body.append(base, knob, ...btnEls.values()); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });

  let dbg: HTMLCanvasElement | null = null;
  if (debug) {
    dbg = document.createElement('canvas');
    dbg.className = 'hp-dbg';
    const put = (): void => { document.body.append(dbg as HTMLCanvasElement); };
    if (document.body) put(); else document.addEventListener('DOMContentLoaded', put, { once: true });
  }

  // ------------------------------------------------------------ geometry
  const inZone = (z: [number, number, number, number] | undefined, x: number, y: number): boolean => {
    if (!z) return false;
    const W = innerWidth; const H = innerHeight;
    return x >= z[0] * W && x <= z[2] * W && y >= z[1] * H && y <= z[3] * H;
  };
  const visible = (b: (typeof buttons)[number]): boolean => { try { return b.when ? Boolean(b.when()) : true; } catch { return true; } };
  function buttonAt(x: number, y: number): string | null {
    for (const b of buttons) {
      if (!visible(b)) continue;
      const cx = innerWidth - b.right - b.size / 2;
      const cy = innerHeight - b.bottom - b.size / 2;
      // A little forgiving: thumbs land off-centre.
      if (Math.hypot(x - cx, y - cy) <= b.size * 0.62) return b.id;
    }
    return null;
  }

  function readStick(): { x: number; y: number; active: boolean } {
    if (stickId === null || !stickOpt) return { x: 0, y: 0, active: false };
    const f = fingers.get(stickId);
    if (!f) return { x: 0, y: 0, active: false };
    let dx = f.x - f.ox; let dy = f.y - f.oy;
    const len = Math.hypot(dx, dy);
    if (len <= stickOpt.dead) return { x: 0, y: 0, active: true };
    const m = Math.min(1, 0.35 + 0.65 * ((len - stickOpt.dead) / Math.max(1, stickOpt.radius - stickOpt.dead)));
    dx /= len; dy /= len;
    if (stickOpt.fourWay) { if (Math.abs(dx) >= Math.abs(dy)) { dx = Math.sign(dx); dy = 0; } else { dy = Math.sign(dy); dx = 0; } }
    return { x: dx * m, y: dy * m, active: true };
  }

  function syncStickKeys(): void {
    const keys = stickOpt?.keys;
    if (!keys) return;
    const s = readStick();
    const want = new Set<string>();
    const T = 0.45;
    if (s.x < -T && keys.left) want.add(keys.left);
    if (s.x > T && keys.right) want.add(keys.right);
    if (s.y < -T && keys.up) want.add(keys.up);
    if (s.y > T && keys.down) want.add(keys.down);
    for (const k of heldDirKeys) if (!want.has(k)) holdKey(k, false);
    for (const k of want) if (!heldDirKeys.has(k)) holdKey(k, true);
    heldDirKeys = want;
  }

  // ------------------------------------------------------------- fingers
  function start(id: number, x: number, y: number, target: EventTarget | null): boolean {
    if (passThrough(target)) { fingers.set(id, { id, role: 'pass', x0: x, y0: y, x, y, t0: performance.now(), ox: x, oy: y }); return false; }
    const btn = buttonAt(x, y);
    let role: Role;
    if (btn) role = 'button';
    else if (stickOpt && stickId === null && inZone(stickOpt.zone, x, y)) role = 'stick';
    else if (lookOpt && inZone(lookOpt.zone, x, y)) role = 'look';
    else role = 'swipe';
    const f: Finger = { id, role, x0: x, y0: y, x, y, t0: performance.now(), ox: x, oy: y, ...(btn ? { button: btn } : {}) };
    fingers.set(id, f);
    if (role === 'stick') stickId = id;
    if (role === 'button' && btn) {
      heldButtons.add(btn); edges.add(btn);
      const def = buttons.find((b) => b.id === btn);
      if (def?.key) holdKey(def.key, true);
    }
    paint();
    return true;
  }
  function move(id: number, x: number, y: number): boolean {
    const f = fingers.get(id);
    if (!f) return false;
    if (f.role === 'pass') return false;
    if (f.role === 'look') { lookDx += x - f.x; lookDy += y - f.y; }
    f.x = x; f.y = y;
    if (f.role === 'stick' && stickOpt) {
      // Past the rim, the base trails the thumb: reversing never has to cross a long dead distance.
      const dx = f.x - f.ox; const dy = f.y - f.oy; const len = Math.hypot(dx, dy); const max = stickOpt.radius * 1.35;
      if (len > max) { f.ox = f.x - (dx / len) * max; f.oy = f.y - (dy / len) * max; }
      syncStickKeys();
    }
    paint();
    return true;
  }
  function end(id: number): boolean {
    const f = fingers.get(id);
    if (!f) return false;
    fingers.delete(id);
    if (f.role === 'pass') return false;
    if (f.role === 'stick') { stickId = null; syncStickKeys(); }
    if (f.role === 'button' && f.button) {
      heldButtons.delete(f.button);
      const def = buttons.find((b) => b.id === f.button);
      if (def?.key) holdKey(def.key, false);
    }
    if (f.role === 'swipe') {
      const dx = f.x - f.x0; const dy = f.y - f.y0; const dt = performance.now() - f.t0;
      const min = swipeOpt?.min ?? 28;
      if (swipeOpt && Math.hypot(dx, dy) >= min && dt < 900) {
        const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
        swipeQueue.push(dir);
        const k = swipeOpt.keys?.[dir];
        if (k) tapKey(k);
      } else if (opts.tapKey && Math.hypot(dx, dy) < 14 && dt < 400) tapKey(opts.tapKey);
    }
    paint();
    return true;
  }

  // ------------------------------------------------------------ listeners
  const L = { capture: true, passive: false } as AddEventListenerOptions;
  const useTouch = 'ontouchstart' in window;
  const onTouchStart = (e: TouchEvent): void => {
    let mine = false;
    for (const t of Array.from(e.changedTouches)) if (start(t.identifier, t.clientX, t.clientY, e.target)) mine = true;
    if (mine && e.cancelable) e.preventDefault();
  };
  const onTouchMove = (e: TouchEvent): void => {
    let mine = false;
    for (const t of Array.from(e.changedTouches)) if (move(t.identifier, t.clientX, t.clientY)) mine = true;
    if (mine && e.cancelable) e.preventDefault();
  };
  const onTouchEnd = (e: TouchEvent): void => {
    let mine = false;
    // WebKit's e.touches holds only this event's fingers: never prune by it, end exactly what changed.
    for (const t of Array.from(e.changedTouches)) if (end(t.identifier)) mine = true;
    if (mine && e.cancelable) e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent): void => { if (e.pointerType === 'mouse') return; if (start(e.pointerId, e.clientX, e.clientY, e.target) && e.cancelable) e.preventDefault(); };
  const onPointerMove = (e: PointerEvent): void => { if (e.pointerType === 'mouse') return; move(e.pointerId, e.clientX, e.clientY); };
  const onPointerUp = (e: PointerEvent): void => { if (e.pointerType === 'mouse') return; end(e.pointerId); };
  const cancelGesture = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
  const onHidden = (): void => { if (document.visibilityState === 'hidden') { for (const id of [...fingers.keys()]) end(id); releaseAllSynthKeys(); } };

  if (useTouch) {
    window.addEventListener('touchstart', onTouchStart, L);
    window.addEventListener('touchmove', onTouchMove, L);
    window.addEventListener('touchend', onTouchEnd, L);
    window.addEventListener('touchcancel', onTouchEnd, L);
  } else {
    window.addEventListener('pointerdown', onPointerDown, L);
    window.addEventListener('pointermove', onPointerMove, L);
    window.addEventListener('pointerup', onPointerUp, L);
    // pointercancel is deliberately NOT an end: the browser cancels a pointer it wants for a gesture while the
    // finger is still on the screen. The finger's own pointerup (or a hidden page) ends it.
  }
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) window.addEventListener(g, cancelGesture, L);
  document.addEventListener('visibilitychange', onHidden);
  // Keep the page itself from scrolling or zooming under a thumb.
  try { document.documentElement.style.touchAction = 'none'; document.documentElement.style.overscrollBehavior = 'none'; } catch { /* ignore */ }

  // --------------------------------------------------------------- paint
  let raf = 0;
  function paint(): void {
    const f = stickId !== null ? fingers.get(stickId) : undefined;
    if (f) {
      base.style.display = 'block'; knob.style.display = 'block';
      base.style.left = `${f.ox}px`; base.style.top = `${f.oy}px`;
      const dx = f.x - f.ox; const dy = f.y - f.oy; const len = Math.hypot(dx, dy); const m = len > r ? r / len : 1;
      knob.style.left = `${f.ox + dx * m}px`; knob.style.top = `${f.oy + dy * m}px`;
    } else { base.style.display = 'none'; knob.style.display = 'none'; }
    for (const b of buttons) {
      const el = btnEls.get(b.id) as HTMLDivElement;
      const show = visible(b);
      el.style.display = show ? 'flex' : 'none';
      el.classList.toggle('on', heldButtons.has(b.id));
    }
    if (dbg) drawDebug();
  }
  function drawDebug(): void {
    const c = dbg as HTMLCanvasElement;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(innerWidth * dpr)) { c.width = Math.round(innerWidth * dpr); c.height = Math.round(innerHeight * dpr); c.style.width = '100%'; c.style.height = '100%'; }
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.font = '12px ui-monospace, Menlo, monospace';
    for (const f of fingers.values()) {
      g.strokeStyle = f.role === 'stick' ? '#7df0ff' : f.role === 'button' ? '#ffd166' : '#ff8fab';
      g.lineWidth = 2; g.beginPath(); g.arc(f.x, f.y, 26, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#fff'; g.fillText(`${f.role} id ${f.id}`, f.x + 30, f.y - 8);
    }
    const s = readStick();
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(8, 8, 250, 34);
    g.fillStyle = '#fff'; g.fillText(`fingers ${fingers.size} stick ${s.active ? `${s.x.toFixed(2)},${s.y.toFixed(2)}` : 'none'}`, 14, 22);
    g.fillText(`held ${[...heldButtons].join(',') || '-'} keys ${[...heldDirKeys].join(',') || '-'}`, 14, 36);
  }
  // Buttons appear and disappear with their action; poll a few times a second.
  const tick = (): void => { paint(); raf = window.setTimeout(tick, 150) as unknown as number; };
  tick();

  function destroy(): void {
    clearTimeout(raf);
    if (useTouch) {
      window.removeEventListener('touchstart', onTouchStart, L); window.removeEventListener('touchmove', onTouchMove, L);
      window.removeEventListener('touchend', onTouchEnd, L); window.removeEventListener('touchcancel', onTouchEnd, L);
    } else {
      window.removeEventListener('pointerdown', onPointerDown, L); window.removeEventListener('pointermove', onPointerMove, L); window.removeEventListener('pointerup', onPointerUp, L);
    }
    for (const g of ['gesturestart', 'gesturechange', 'gestureend']) window.removeEventListener(g, cancelGesture, L);
    document.removeEventListener('visibilitychange', onHidden);
    releaseAllSynthKeys();
    base.remove(); knob.remove(); for (const el of btnEls.values()) el.remove(); dbg?.remove(); style.remove();
  }
  return api;
}
