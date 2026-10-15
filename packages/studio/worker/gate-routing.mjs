/** Admission routing without loading transport encoding or crowd simulation. */
/** Players a Gate holds in a room too big for its Table to hold directly.
 *
 * Two trials on Cloudflare set it. A Gate of 60 dense players that selected and encoded each one's view from
 * scratch (0.45.4) could not keep 20 frames a second; the same work now costs a third as much. But twenty to a
 * Gate (the first 0.46.2 build) made a room of 600 fifty channels, and the room spent its time on messages, not
 * rules: what the room's one thread can bear is counted in messages, and a channel is two a tick. So a Gate is
 * as full as it can serve, and a room opens only the Gates its players fill.
 * A studio chooses its room's size and nothing else. */
export const GATE_PLAYERS = 50;
/** `per`: players a Gate, for a trial that is finding the right number (`HOMIE_GATE_PLAYERS` on the Worker). A studio never sets it. */
export const gatePlayers = (env) => { const n = Number(env?.HOMIE_GATE_PLAYERS); return Number.isInteger(n) && n >= 4 && n <= 200 ? n : GATE_PLAYERS; };
export function roomLayout(seats, per = GATE_PLAYERS) {
  // A room of up to 64 is its Table alone, as it has been since 0.45.0.
  const gates = seats <= 64 ? 1 : Math.ceil(seats / per);
  return { gates, concentrators: 0 };
}
/** The Gate a key lands on when the room cannot be asked: spread evenly, as 0.45.0 did. */
function hashedGate(key, gates) {
  let hash = 2166136261;
  for (const c of key || crypto.randomUUID()) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash % gates;
}
/**
 * Which Gate takes the next player: the lowest one with room. A room of 50 players in a 1,000-seat game is one
 * Gate, not twenty with two or three players each, every one of them costing the room a channel. `held` is each
 * Gate's players now and `promised` those sent to it who have not arrived yet.
 */
export function nextGate(gates, held, promised = new Map(), per = GATE_PLAYERS) {
  let least = 0, fewest = Infinity;
  for (let i = 0; i < gates; i++) {
    const n = (held.get(i) ?? 0) + (promised.get(i) ?? 0);
    if (n < per) return i;
    if (n < fewest) { fewest = n; least = i; }
  }
  return least;
}
export function gateFor(env, game, room, seats, key) {
  const layout = roomLayout(seats, gatePlayers(env));
  // One logical Gate is embedded in the Table for a small room. Same relay,
  // admission and delivery protocol; no extra Durable Object or seat clamp.
  const table = () => env.TABLE.get(env.TABLE.idFromName(`${game}/${room}`));
  if (layout.gates === 1) return table();
  return { async fetch(request) {
    const url = new URL(request.url);
    // The room says which Gate has room (one short question a join; a join is the room's work anyway). If it
    // cannot be asked in time the key's hash chooses, as before.
    let index = null;
    try {
      const asked = await Promise.race([table().fetch(`https://table/__gate?game=${encodeURIComponent(game)}&room=${encodeURIComponent(room)}&max=${seats}&gates=${layout.gates}`), new Promise(done => setTimeout(() => done(null), 2000))]);
      const said = asked?.ok ? await asked.json() : null;
      if (Number.isInteger(said?.gate) && said.gate >= 0 && said.gate < layout.gates) index = said.gate;
    } catch { /* the hash chooses */ }
    index ??= hashedGate(key, layout.gates);
    url.searchParams.set('gate', String(index));
    url.searchParams.set('gates', String(layout.gates));
    return env.GATE.get(env.GATE.idFromName(`${game}/${room}/${index}`)).fetch(new Request(url, request));
  } };
}

export function diagnosticsOf(env, game, room) { return env.GATE.get(env.GATE.idFromName(`${game}/${room}/diagnostics`)); }
