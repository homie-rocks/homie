/** Size caps for up to 16 seats: UTF-8 bytes in rules rooms, JSON string length in legacy rooms. */
export const LIMITS = Object.freeze({
  hello: 2048, snap: 16384, in: 2048, ev: 4096, ckpt: 65536, state: 8192, round: 8192, roster: 4096, ping: 256, other: 512,
  // Room chat (revision 8): a typed line (280 characters, emoji count double), a reaction.
  say: 1536, react: 256,
  // A game's own decision (section 20): a few typed questions about its state.
  decide: 6144,
});
/**
 * What grows with the seats (every body, every result, every slot): the checkpoint, round and roster caps double
 * for a room of 17 to 32 (revision 3). Measured: a 32-seat courier game's checkpoint reached 56 KB of the 64 KB
 * a 16-seat room allows. The snapshot cap does not grow: 32 bodies are about 1.5 KB.
 */
export const GROWS = Object.freeze(['ckpt', 'round', 'roster']);
export const capOf = (t, seats) => (LIMITS[t] ?? LIMITS.other) * (GROWS.includes(t) && seats > 16 ? 2 : 1);

export const RATES = Object.freeze({ snap: 30, in: 60, ev: 30, ckpt: 4, state: 64, round: 4, roster: 8, ping: 8, other: 8, say: 4, react: 10, decide: 2 });
/** `ev` per second by the sender's role: a screen is a spectator, and the host is somebody's phone. */
export const EV_RATES = Object.freeze({ host: 30, replica: 10, screen: 2 });
/** The keyed state channel: at most this many keys and bytes per room. */
export const STATE_CAPS = Object.freeze({ keys: 64, bytes: 65536 });
/** Runtime output only. Player allowances above remain unchanged. */
export const RULES_FRAMES = Object.freeze(['snap', 'ckpt', 'state', 'ev', 'round', 'roster', 'decide', 'caps', 'rules-end']);
export const rulesRates = (tickHz = 20, seats = 8) => ({
  // A snapshot a tick, as the server sends, and a quarter over for the ticks a late timer runs together.
  snap: Math.max(30, Math.ceil(tickHz * 1.25)), ckpt: 4, state: tickHz + 64,
  ev: Math.ceil((tickHz + seats * EV_RATES.replica + 32) / 0.8), round: 8,
  // A decision a tick is what one declared ask can make (the next waits for the answer), as on a server host.
  roster: seats * 2 + 8, decide: Math.ceil((tickHz + seats * 5 + 8) / 0.8), caps: 4, 'rules-end': 4,
});
export const rulesCaps = seats => Object.fromEntries(RULES_FRAMES.map(t => [t, capOf(t, seats)]));
/** Two seconds of headroom absorb timer stalls and transport batching. */
export function takeRulesToken(buckets, kind, rate, now, burst = rate * 2) {
  let b = buckets.get(kind);
  if (!b) { b = { tokens: burst, at: now }; buckets.set(kind, b); }
  b.tokens = Math.min(burst, b.tokens + Math.max(0, now - b.at) * rate / 1000);
  b.at = now;
  if (b.tokens + 1e-9 < 1) return Math.ceil((1 - b.tokens) * 1000 / rate);
  b.tokens = Math.max(0, b.tokens - 1);
  return 0;
}
