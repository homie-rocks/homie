/*
 * Sound that starts on the first touch, with no "tap for sound" screen.
 *
 * Browsers start every AudioContext suspended and refuse media.play() until a
 * person has touched the page. A single-player game usually handled that with
 * a title screen; a multiplayer port drops the player straight into a live
 * round, so the unlock has to ride the first real input instead:
 *
 *   - every AudioContext the game makes is remembered (the constructor is
 *     wrapped, so install this BEFORE the game's code runs);
 *   - on pointerdown / pointerup / touchstart / touchend / keydown / click
 *     (capture phase, so a game that stops propagation still unlocks), every
 *     suspended context is resumed inside the gesture and plays one silent
 *     sample (iOS needs a sound started inside the gesture);
 *   - a media element whose play() was refused is played again on that gesture;
 *   - iOS's silent switch mutes Web Audio unless the audio session says
 *     "playback".
 * A held stick only counts as a gesture when the finger lifts (browsers grant
 * activation on touchend), so the first tap or the first release is when sound
 * begins. Say so nowhere: it just works.
 */

type Ctx = AudioContext;
const contexts = new Set<Ctx>();
const refused = new Set<HTMLMediaElement>();
let installed = false;
let unlockedAt = 0;
let gestures = 0;

function silentTick(ctx: Ctx): void {
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  } catch { /* a closed context */ }
}

function onGesture(): void {
  gestures += 1;
  for (const ctx of contexts) {
    if (ctx.state === 'closed') { contexts.delete(ctx); continue; }
    if (ctx.state !== 'running') { void ctx.resume().catch(() => {}); silentTick(ctx); }
  }
  for (const el of [...refused]) {
    refused.delete(el);
    const p = realPlay?.call(el);
    if (p && typeof p.catch === 'function') p.catch(() => { refused.add(el); });
  }
  if (!unlockedAt && [...contexts].some((c) => c.state === 'running')) unlockedAt = performance.now();
}

let realPlay: (() => Promise<void>) | null = null;

/** Wrap AudioContext and media play() so the first gesture unlocks everything. Idempotent. */
export function installAudioUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const w = window as unknown as Record<string, unknown>;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Real = w[name] as (new (...a: unknown[]) => Ctx) | undefined;
    if (typeof Real !== 'function') continue;
    // A subclass keeps instanceof, static members and every method; it only remembers the instance.
    const Tracked = class extends (Real as new (...a: unknown[]) => Ctx) {
      constructor(...args: unknown[]) { super(...args); contexts.add(this as unknown as Ctx); }
    };
    try { Object.defineProperty(window, name, { value: Tracked, configurable: true, writable: true }); } catch { /* keep the real one */ }
  }
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch { /* not iOS */ }
  if (typeof HTMLMediaElement !== 'undefined') {
    realPlay = HTMLMediaElement.prototype.play;
    const play = realPlay;
    HTMLMediaElement.prototype.play = function patchedPlay(this: HTMLMediaElement): Promise<void> {
      const p = play.call(this);
      if (!p || typeof p.catch !== 'function') return p;
      // Refused for want of a gesture: it plays on the first one. Any other failure is the game's to see.
      return p.catch((e: unknown) => {
        if (e && (e as { name?: string }).name === 'NotAllowedError') { refused.add(this); return undefined; }
        throw e;
      }) as Promise<void>;
    };
  }
  for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'keydown', 'click']) {
    window.addEventListener(ev, onGesture, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') for (const c of contexts) if (c.state === 'suspended' && gestures) void c.resume().catch(() => {}); });
}

/** What the check harness reads: each context's state, and when the first one started running. */
export function audioReport(): { contexts: string[]; refusedMedia: number; gestures: number; unlockedAtMs: number | null } {
  return { contexts: [...contexts].map((c) => c.state), refusedMedia: refused.size, gestures, unlockedAtMs: unlockedAt || null };
}
