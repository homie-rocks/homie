/*
 * The skill dial for a port's own bot code (NETPLAY.md section 17). A level is { reactionMs, aimNoise, aggression,
 * positioning }; `room.skillOf(body)` (or `net.skillOf(slot)`) says which one a bot plays at now. BotBrain reads
 * reaction, aim and commitment by itself; these three are for the rest of a bot's decisions:
 *
 *   jitter(s, maxPx)        how far off its aim lands (aimNoise of maxPx, either way)
 *   engages(s, dt)          whether it starts a fight this frame (aggression, about once a second at most)
 *   standoff(s, near, far)  how close to the action it stands: far at positioning 0, near at 1
 *
 * Level 1 (Rookie) stays at the back and misses a lot; 5 (Maxed) is a front-line tank that rarely misses.
 */
import type { Skill } from '../netplay/netplay';

/** An aim offset: up to `maxPx x aimNoise` either way (0 at a perfect aim). */
export function jitter(s: Skill, maxPx: number): number {
  return (Math.random() - 0.5) * 2 * maxPx * Math.max(0, Math.min(1, s.aimNoise));
}

/** Whether a bot starts a fight (or a wave, a shot, a tackle) this frame: about `aggression` times a second. */
export function engages(s: Skill, dt: number): boolean {
  return Math.random() < Math.max(0, Math.min(1, s.aggression)) * Math.max(0, dt);
}

/** How far from the action to stand: `far` at positioning 0 (behind the party), `near` at 1 (the front line). */
export function standoff(s: Skill, near: number, far: number): number {
  const t = Math.max(0, Math.min(1, s.positioning));
  return far + (near - far) * t;
}
