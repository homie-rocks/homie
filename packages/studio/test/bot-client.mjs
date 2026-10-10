/**
 * bot-client.mjs — a headless player of a server-hosted room (not a test file itself).
 *
 * One WebSocket that speaks the netplay wire as a rules game's view does (NETPLAY.md section 29): hello, the welcome,
 * a snapshot a tick, and input as steps stamped with the room's tick. No browser, no game code and no declarations:
 * it reads a snapshot's entities by position (`[id, kind, r, pos, vel, heading, grounded, fields, motion]`, and for a
 * player's body `seat, driver, away, owner` after), which is all a bot needs to steer and to measure.
 *
 * The exit tests and the real-Cloudflare measurement (T1) use it: it counts the tick numbers it receives and times
 * the gaps between snapshots, from outside the room, where a clock can be trusted. It can also lie: `forge(frame)`
 * sends any frame at all, which is how a test shows that a changed client cannot change a score.
 *
 *   const url = await socketUrl('http://127.0.0.1:8787', 'coin-dash', 'pub-1');
 *   const bot = botClient({ url, name: 'Bot 1', steer: chase });
 *   await bot.ready;  …  bot.report();  bot.close();
 */

/** The room socket a game's page hands its game (`window.HOMIE_NET.url`), read from the page as a browser would. */
export async function socketUrl(origin, game, room, { fetchFn = globalThis.fetch } = {}) {
  const res = await fetchFn(`${origin}/${game}/__game/?room=${encodeURIComponent(room)}`);
  if (!res.ok) throw new Error(`${origin}/${game}/__game/ answered ${res.status}`);
  const m = /window\.HOMIE_NET=(\{.*?\})<\/script>/s.exec(await res.text());
  const url = m ? JSON.parse(m[1]).url : null;
  if (!url) throw new Error('the game page hands its game no room socket');
  return url;
}

/** A player's body out of a packed entity, or null for anything else. */
export function bodyOf(w) {
  if (!Array.isArray(w) || w.length < 13) return null;
  return { id: w[0], kind: w[1], r: w[2], pos: { x: w[3][0], y: w[3][1], z: w[3][2] ?? 0 }, vel: { x: w[4][0], y: w[4][1], z: w[4][2] ?? 0 }, fields: w[7], motion: w[8], seat: w[9], driver: ['person', 'bot', 'ai'][w[10]], away: w[11] === 1, owner: w[12] };
}
/** Every entity of a snapshot that is not a player's body, as { id, kind, pos }. */
export const thingsOf = (snap) => (snap?.d?.[1] ?? []).filter((w) => Array.isArray(w) && w.length < 13).map((w) => ({ id: w[0], kind: w[1], pos: { x: w[3][0], y: w[3][1] } }));

/**
 * `steer(me, snap, bot)` returns this tick's step: `{ input: [numbers in the kind's declared order], pos?, vel?,
 * heading? }`. With `pos` the entry carries a claim (an owner-moved body). Called once a snapshot.
 *   lead      how many ticks ahead of the newest snapshot an entry is stamped (2: on time on a local connection)
 *   tickHz    the room's tick rate, for the report's gap line
 */
export function botClient({ url, name = 'Bot', steer = null, lead = 2, tickHz = 20, WebSocketImpl = globalThis.WebSocket, hello = {} }) {
  const ws = new WebSocketImpl(url);
  const bot = {
    name, seat: null, id: null, token: null, epoch: 0, welcome: null, snap: null, round: null, rounds: [], roster: null, errors: [], events: [], closed: false,
    ticks: { first: null, last: null, got: 0, repeats: 0 }, gaps: [], sent: 0, leads: [],
    me() { for (const w of bot.snap?.d?.[1] ?? []) { const b = bodyOf(w); if (b && b.seat === bot.seat && b.driver !== 'bot') return b; } return null; },
    bodies() { return (bot.snap?.d?.[1] ?? []).map(bodyOf).filter(Boolean); },
    /** Any frame at all, as text: what a changed client might send. */
    forge(frame) { ws.send(JSON.stringify(frame)); },
    /** One input frame: entries `[o, ...fields]` from tick `k`. */
    steps(k, entries, r = bot.me()?.r ?? 0, e = bot.epoch) { bot.sent += 1; ws.send(JSON.stringify({ t: 'in', e, k, s: entries, r })); },
    close() { bot.closed = true; try { ws.close(); } catch { /* gone */ } },
    /** What this client saw of the room's beat: the share of ticks received, and the gaps between snapshots. */
    report() {
      const due = bot.ticks.first === null ? 0 : bot.ticks.last - bot.ticks.first + 1;
      const sorted = [...bot.gaps].sort((a, b) => a - b);
      const pct = (p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10 : null);
      const limit = 1.5 * (1000 / tickHz);
      return { name, seat: bot.seat, ticksDue: due, ticksGot: bot.ticks.got, share: due ? Math.round((bot.ticks.got / due) * 10000) / 10000 : null, gapMs: { p50: pct(0.5), p99: pct(0.99), max: pct(1) }, gapsUnder: sorted.length ? Math.round((sorted.filter((g) => g < limit).length / sorted.length) * 10000) / 10000 : null, limitMs: limit, sent: bot.sent, leadP50: bot.leads.length ? [...bot.leads].sort((a, b) => a - b)[Math.floor(bot.leads.length / 2)] / 16 : null };
    },
  };
  let lastAt = 0;
  let lastSendAt = 0;
  let pings = null;
  bot.ready = new Promise((resolve, reject) => {
    ws.onerror = (e) => { if (!bot.welcome) reject(new Error(`socket error: ${e?.message ?? 'could not connect'}`)); };
    ws.onclose = () => { bot.closed = true; clearInterval(pings); if (!bot.welcome) reject(new Error(`the room closed the socket before a welcome${bot.errors.length ? `: ${bot.errors.map((x) => x.code).join(', ')}` : ''}`)); };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', v: 1, rev: 10, name, device: 'desk', want: 'play', canHost: false, ...hello }));
      pings = setInterval(() => { try { ws.send(JSON.stringify({ t: 'ping', c: Date.now(), hid: false })); } catch { /* closed */ } }, 2000);
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.t === 'welcome') { bot.welcome = m; bot.seat = m.seat; bot.id = m.id; bot.token = m.token; bot.round = m.round; bot.roster = m.roster; if (m.snap) { bot.snap = m.snap; bot.epoch = m.snap.e ?? 0; } resolve(m); return; }
      if (m.t === 'seat') { bot.seat = m.seat; return; }
      if (m.t === 'error') { bot.errors.push(m); return; }
      if (m.t === 'round') { bot.round = m.round; bot.rounds.push(m.round); return; }
      if (m.t === 'roster') { if (m.patch) { const rows = new Map((bot.roster ?? []).map(r => [r.slot,r])); for (const slot of m.removed ?? []) rows.delete(slot); for (const row of m.slots ?? []) rows.set(row.slot,row); bot.roster = [...rows.values()].sort((a,b)=>a.slot-b.slot); } else bot.roster = m.slots; return; }
      if (m.t === 'ev') { if (bot.events.length < 2000) bot.events.push(m); return; }
      if (m.t !== 'snap') return;
      const now = performance.now();
      if (lastAt) bot.gaps.push(now - lastAt);
      lastAt = now;
      if (bot.ticks.first === null) bot.ticks.first = m.k;
      if (bot.ticks.last !== null && m.k <= bot.ticks.last) bot.ticks.repeats += 1; else bot.ticks.got += 1;
      bot.ticks.last = Math.max(bot.ticks.last ?? 0, m.k);
      bot.snap = m;
      bot.epoch = m.e ?? bot.epoch;
      const row = (m.c ?? []).find((x) => x[0] === bot.seat);
      if (row && row[3] !== -128) bot.leads.push(row[3]);
      const me = bot.me();
      if (!steer || !me) return;
      // At most one input frame a tick of this client's own time, as a view sends: a client that was held up and
      // finds a backlog of snapshots answers the newest, never each of them at once.
      if (now - lastSendAt < 0.8 * (1000 / tickHz)) return;
      lastSendAt = now;
      const s = steer(me, m, bot);
      if (!s) return;
      const claim = s.pos ? [s.pos.x, s.pos.y, 0, s.vel?.x ?? 0, s.vel?.y ?? 0, 0, s.heading?.x ?? 1, s.heading?.y ?? 0, 0] : [];
      bot.steps(m.k + lead, [[0, ...s.input, ...claim]], me.r, m.e);
    };
  });
  return bot;
}

/**
 * A steer for coin-dash: run at the nearest coin (entities of the kind that is not a player's), claiming a position
 * no faster than `speed` metres a second. The claim is the bot's own: it remembers where it says it is.
 */
export function chaseCoins({ speed = 6, tickHz = 20 } = {}) {
  let at = null;
  let r = -1;
  return (me, snap) => {
    // The server placed the body (a round reset, a seat taken): start from where it says.
    if (!at || me.r !== r) { at = { ...me.pos }; r = me.r; }
    const frozen = (me.motion?.[0] ?? 0) > snap.k;
    let best = null;
    for (const c of thingsOf(snap)) { const d = Math.hypot(c.pos.x - at.x, c.pos.y - at.y); if (!best || d < best.d) best = { d, c }; }
    if (!best || frozen) return { input: [0, 0], pos: at, vel: { x: 0, y: 0 }, heading: { x: 1, y: 0 } };
    const dx = (best.c.pos.x - at.x) / (best.d || 1); const dy = (best.c.pos.y - at.y) / (best.d || 1);
    const step = Math.min(best.d, speed / tickHz);
    at = { x: at.x + dx * step, y: at.y + dy * step };
    return { input: [Math.round(dx * 127), Math.round(dy * 127)], pos: at, vel: { x: dx * speed, y: dy * speed }, heading: { x: dx, y: dy } };
  };
}
