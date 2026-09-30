/*
 * Bot scaffolds. A port's bots fill every empty seat from the first frame, so
 * a lone stranger is never alone, and each arriving person takes a bot's body.
 * What made bots good in real rooms:
 *
 *   - They play the SAME rules through the same inputs a person has (a stick
 *     vector and button presses), never a shortcut the person cannot take.
 *   - They commit to a target for a while (seconds, not frames) and give up a
 *     target they cannot reach; a stuck detector (little progress in ~3 s)
 *     picks the most open direction instead of pushing a wall forever.
 *   - They are beatable: a reaction delay (~250 ms), a little aim error, and a
 *     skill that eases off when they lead the people.
 *   - They are kind to newcomers: no bot targets a person in their first
 *     ~15 s, and a person's first minute is never a pile-on.
 *   - A body a person left keeps playing as a bot, where it stands.
 */

export interface V2 { x: number; y: number }

/** Unit vector from `from` toward `to` (a stick push), or zero when there. */
export function seek(from: V2, to: V2, arrive = 0): V2 {
  const dx = to.x - from.x; const dy = to.y - from.y; const d = Math.hypot(dx, dy);
  if (d <= Math.max(1e-6, arrive)) return { x: 0, y: 0 };
  const m = arrive > 0 ? Math.min(1, d / (arrive * 3)) : 1;
  return { x: (dx / d) * m, y: (dy / d) * m };
}

/** Away from a point (flee), unit length. */
export function flee(from: V2, danger: V2): V2 { const s = seek(danger, from); return s; }

/** A slowly wandering direction that does not jitter frame to frame. */
export function wanderer(seed = Math.random() * 1000): (dt: number) => V2 {
  let a = seed;
  return (dt) => { a += (Math.random() - 0.5) * 2.4 * dt; return { x: Math.cos(a), y: Math.sin(a) }; };
}

/** The nearest item by straight distance, skipping ones other bots already claimed. */
export function nearest<T extends V2>(from: V2, items: Iterable<T>, taken?: Set<T>): T | null {
  let best: T | null = null; let bd = Infinity;
  for (const it of items) {
    if (taken?.has(it)) continue;
    const d = Math.hypot(it.x - from.x, it.y - from.y);
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

/**
 * A bot's intent with a person's limits: it sees the world `reactionMs` late, commits to a target for `commitMs`,
 * and notices when it is stuck. Call `think(now, pos, choose)` every frame; it returns the stick to push.
 */
export class BotBrain<T extends V2 = V2> {
  target: T | null = null;
  private chosenAt = 0;
  private lastCheck: { at: number; x: number; y: number } | null = null;
  private unstickUntil = 0;
  private unstick: V2 = { x: 0, y: 0 };
  private queue: { at: number; v: V2 }[] = [];
  constructor(readonly opts: { reactionMs?: number; commitMs?: number; stuckMs?: number; stuckDist?: number; aimError?: number } = {}) {}

  think(now: number, pos: V2, choose: () => T | null, arrive = 0): V2 {
    const { reactionMs = 250, commitMs = 2500, stuckMs = 3000, stuckDist = 24, aimError = 0.12 } = this.opts;
    if (!this.target || now - this.chosenAt > commitMs) { this.target = choose(); this.chosenAt = now; }
    if (!this.lastCheck || now - this.lastCheck.at > stuckMs) {
      if (this.lastCheck && Math.hypot(pos.x - this.lastCheck.x, pos.y - this.lastCheck.y) < stuckDist && this.target) {
        const a = Math.random() * Math.PI * 2;
        this.unstick = { x: Math.cos(a), y: Math.sin(a) };
        this.unstickUntil = now + 700;
        this.target = null;
      }
      this.lastCheck = { at: now, x: pos.x, y: pos.y };
    }
    let v: V2 = now < this.unstickUntil ? this.unstick : this.target ? seek(pos, this.target, arrive) : { x: 0, y: 0 };
    if (aimError > 0 && (v.x || v.y)) {
      const a = Math.atan2(v.y, v.x) + (Math.random() - 0.5) * aimError; const m = Math.hypot(v.x, v.y);
      v = { x: Math.cos(a) * m, y: Math.sin(a) * m };
    }
    // Reaction delay: the push decided now is acted on reactionMs later.
    this.queue.push({ at: now + reactionMs, v });
    while (this.queue.length && (this.queue[0] as { at: number }).at <= now) this.current = (this.queue.shift() as { v: V2 }).v;
    return this.current;
  }
  private current: V2 = { x: 0, y: 0 };

  /** Forget the target (the round restarted, the bot respawned). */
  reset(): void { this.target = null; this.queue.length = 0; this.current = { x: 0, y: 0 }; this.lastCheck = null; }
}

/** Ease bots off when they lead the people: 1 = full skill, down to `floor` when the best bot is far ahead. */
export function rubberBand(bestBot: number, bestPerson: number, floor = 0.6): number {
  if (bestBot <= bestPerson) return 1;
  const lead = (bestBot - bestPerson) / Math.max(1, bestPerson + 3);
  return Math.max(floor, 1 - lead * 0.5);
}

/** A person is protected from bots for their first `ms` (default 15 s) in a round. */
export function protectedNewcomer(joinedAt: number, now: number, ms = 15_000): boolean { return now - joinedAt < ms; }
