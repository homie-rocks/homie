/*
 * host.ts — the host runtime: a rules module playing the host's part on the wire.
 * =============================================================================
 *
 * Today one player's browser is a room's host: it runs the rules and the clock and sends everybody the state. The host
 * runtime is that host with no browser in it. It takes a compiled rules module (rules.ts) and three things from its
 * caller: a way to send a frame, a clock and a store. It has no transport in it and no Cloudflare in it, in the style of
 * worker/room.mjs. Inside the `Table` (worker/index.mjs) the relay hands it parsed frames and fans out what it sends;
 * in Node the tests and the build check drive it with a clock of their own.
 *
 * WHAT IT READS (`frame(m)`, today's wire shapes, NETPLAY.md section 5 and section 29):
 *   join, leave   a seat's holder came, or its socket closed (the seat is held; the body is away)
 *   free          a held seat was given up (the relay's hold ran out, or the owner removed the player)
 *   in            a seat's input: `{ from, e, k, s, r }`, revision 10
 *   ev            a command (`cmd`), or a player's speech, which is passed on unchanged
 *   policy        the server's policy: whether bots fill, and the party's level dial
 *
 * WHAT IT SENDS: `snap` once a tick, with the control table; `round` and `roster` when they change; the keyed `state`
 * channel carrying `shared`; `ev` frames for effects (`fx`) and relayed speech; `caps` once.
 *
 * THE INPUT PROTOCOL (rooms-milestone-1-design.md, section 4.4). A seat's input is a value that holds from one entry
 * to the next, and every tick has exactly one step. An entry stamped ahead of the clock is kept for its tick; one more
 * than a second ahead is dropped with the rest of its frame; a late one holds from the next tick, and its presses still
 * fire there when that is within a quarter of a second of its stamp; nothing is applied in the past. A seat silent for
 * a second is neutral until its next entry. More frames buy no extra step: the server runs one a tick whatever arrives.
 *
 * THE LIFE OF A ROOM (section 4.5). The tick loop is a timer chain, each tick timed against the moment it is due, so
 * lateness does not add up. When the last person's socket closes the room pauses: the timer is cleared (a pending
 * timer would keep the `Table` in memory and billed), the clock stops, and a person who returns finds the tick it
 * paused on. Watchers and AI seats never keep the world ticking.
 *
 * THE CHAIN CANNOT BREAK. One rule holds whenever this module hands control back to its caller: A ROOM THAT IS RUNNING
 * HAS EXACTLY ONE TIMER PENDING, AND A ROOM THAT IS PAUSED OR ENDED HAS NONE. A running room with no timer would stand
 * still for good with its players connected and its object billed. So every way in (`wake`, `frame`, `start`,
 * `resume`, `tickNow`) is wrapped: whatever is thrown inside it, by the core, by the caller's `send` or `log`, by the
 * clock, is caught there, written to the log with the game and the build, and counted as a fault; and on the way out
 * the timer is armed again, or, if the clock will not give one, the room is ended cleanly. A tick that faults is a
 * failed tick, like one the budget cut short: a room whose every tick fails for two seconds ends
 * (rooms-milestone-1-design.md, section 10), and the log says why.
 *
 * SECONDS ARE SECONDS. Both rules that end a failing room are measured on the clock, not in ticks: every tick failing
 * for `FAIL_MS`, and every tick blamed for running slow for `OVERRUN_MS`. A room whose ticks take a second each ends
 * after five of them, not after five seconds' worth of ticks at its rate.
 * =============================================================================
 */
import { createCore } from './core.ts';
import type { Core, CoreOut, Driver, SavedCore, StepInput } from './core.ts';
import { coerce, fromBytes, initFields, toBytes, unpackVec } from './pack.ts';
import type { Compiled, KindTable, Vec3 } from './rules.ts';

export interface HostClock {
  /** Milliseconds. Inside a Worker this stands still while code runs. */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}
export interface HostOptions {
  game: string;
  /** The game's build, for the log. */
  build?: string;
  compiled: Compiled;
  /** One outgoing frame, for the relay to fan out. `text` is the frame already encoded, when the runtime encoded it. */
  send(frame: Record<string, unknown>, text?: string): void;
  clock: HostClock;
  /** Where a room is saved. Nothing is written in this release: the save in storage arrives with the next. */
  store?: unknown;
  log?(line: Record<string, unknown>): void;
  /** A number in [0, 1) for a fresh epoch and seed. */
  random?(): number;
  /** A room saved by `save()`, to carry on from. */
  restore?: Uint8Array | null;
  stage?: string;
  onPause?(): void;
  onResume?(): void;
  /** The rules failed again and again (the budget on every tick for two seconds, or slow ticks for five): the room ends. */
  onEnd?(why: string, facts: Record<string, unknown>): void;
}
export interface Host {
  readonly tick: number;
  readonly epoch: number;
  readonly running: boolean;
  readonly paused: boolean;
  readonly people: number;
  frame(m: Record<string, unknown>): void;
  /** Start the tick loop (the first person has joined). */
  start(): void;
  pause(): void;
  resume(): void;
  /** Stop for good: the room has ended. */
  stop(): void;
  /** Run the next tick now, whatever the clock says (tests, and the build check's runs). Like the timer's own tick, it never throws. */
  tickNow(): void;
  /** The whole room as bytes. */
  save(): Uint8Array;
  facts(): Record<string, unknown>;
  readonly core: Core;
}

interface Entry { at: number; values: Record<string, unknown>; presses: string[]; claim: StepInput['claim'] }
interface SeatIn {
  held: Record<string, unknown>; claim: StepInput['claim']; entries: Entry[];
  /** The newest stamp this seat has sent, the stamps not yet acknowledged, and the newest acknowledged. */
  newest: number; stamps: number[]; ack: number;
  /** The smallest lead since the last snapshot, in sixteenths of a tick; 127 while no frame has arrived. */
  lead: number; lastFrameTick: number;
}

/** Every tick failing (cut short by the budget, or faulted) for this long ends the room. */
export const FAIL_MS = 2000;
/** Every tick blamed for running longer than a period for this long ends the room. */
export const OVERRUN_MS = 5000;

/** Something thrown, as a line for the log, with nothing of the thrown value run to make it. */
function thrown(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, 200);
  if (!(error instanceof Error)) return 'a value that is not an Error';
  const d = Object.getOwnPropertyDescriptor(error, 'message');
  return d && typeof d.value === 'string' ? d.value.slice(0, 200) : 'an Error with no message';
}

/** What a bot is called on the scoreboard, by its seat. */
export const BOT_NAMES = Object.freeze(['Pip', 'Juno', 'Moss', 'Rook', 'Fern', 'Dash', 'Echo', 'Wren', 'Zed', 'Nova', 'Bix', 'Tam', 'Lark', 'Odo', 'Kit', 'Sol']);
const SPEECH = /^(?:say|chat|emote)/i;
/**
 * The overrun check's memory: the last few ticks that started in this isolate, whichever rooms' they were, each with
 * when it started. Time inside a Worker stands still while code runs, so a tick cannot time itself; but the start of
 * the next tick, in any room, shows how long it took. A tick that starts more than a period late blames the newest
 * tick here that took more than a period: the one just before it, or, when that one was quick and was itself held up,
 * the one before that.
 */
const recent: { who: { blame(): void }; at: number }[] = [];
function blameLate(now: number, period: number): void {
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const ended = i + 1 < recent.length ? recent[i + 1].at : now;
    if (ended - recent[i].at > period) { recent[i].who.blame(); return; }
  }
}

export function createHost(o: HostOptions): Host {
  const c = o.compiled;
  const period = 1000 / c.settings.tickHz;
  const tickHz = c.settings.tickHz;
  const lateTicks = Math.ceil(tickHz / 4);
  // A log that throws takes nothing down with it.
  const log = (line: Record<string, unknown>): void => { try { o.log?.(line); } catch { /* nothing to say it with */ } };
  const random = o.random ?? Math.random;
  const saved = o.restore ? fromBytes(o.restore) as { v: number; core: SavedCore; names: [number, string][]; queues: [number, Record<string, unknown>, StepInput['claim'], number, number][] } : null;
  if (saved && saved.v !== 1) throw new Error('this save was written by another version of the runtime');
  const core = createCore(c, { seed: Math.floor(random() * 4294967296) >>> 0, epoch: (Math.floor(random() * 4294967295) >>> 0) + 1, restore: saved?.core ?? null, stage: o.stage });
  let epoch = core.epoch;
  const names = new Map<number, string>(saved?.names ?? []);
  /** Seats whose holder is here now, by seat, with whether it is a person (an AI never keeps the world ticking). */
  const present = new Map<number, boolean>();
  const queues = new Map<number, SeatIn>();
  let running = false;
  let paused = false;
  let ended = false;
  /** The pending timer, and whether there is one. `armed` is the truth: a clock may hand back any value as its handle. */
  let timer: unknown = null;
  let armed = false;
  let base = { ms: 0, tick: 0 };
  let lastSt = 0;
  let rosterText = '';
  let blamed = false;
  /**
   * The run of slow ticks this room is in: when it began (the start of the first tick blamed), and how many of the
   * ticks since were blamed. A tick that takes a little longer than a period is not blamed every time: lateness has
   * to pile up past a period first, and the clock's own slips take it away again. So a run goes on for as long as at
   * least half the ticks in it were blamed, and is dropped as a passing hitch when fewer were.
   */
  let overSince: number | null = null;
  let overTicks = 0;
  let overBlamed = 0;
  let lastStart = 0;
  /** When the run of failed ticks this room is in began, or null. */
  let failingSince: number | null = null;
  /** Where in a tick the runtime is, for the log line of a fault. */
  let phase = '';
  let faultLoggedAt = -Infinity;
  const stats = { ticks: 0, late: 0, slips: 0, since: 0, ins: 0, dropped: 0, lateEntries: 0, loggedAt: 0, faults: 0, lastFault: '' };
  /** Something was thrown in the runtime itself: it is counted, and said in the log at most once a second. */
  function fault(where: string, error: unknown): void {
    stats.faults += 1;
    stats.lastFault = `${where}: ${thrown(error)}`;
    let now = 0;
    try { now = o.clock.now(); } catch { now = faultLoggedAt + 1000; }
    if (now - faultLoggedAt < 1000) return;
    faultLoggedAt = now;
    log({ ev: 'host-fault', game: o.game, ...(o.build ? { build: o.build } : {}), tick: core.tick, where, error: thrown(error), faults: stats.faults });
  }

  // A restored room keeps each seat's held input, its newest stamp and its acknowledgement.
  for (const [seat, held, claim, newest, ack] of saved?.queues ?? []) queues.set(seat, { held, claim, entries: [], newest, stamps: [], ack, lead: 127, lastFrameTick: core.tick });
  const neutral = (kind: KindTable): Record<string, unknown> => { const v = initFields(kind.input, c.dims); for (const [name, fd] of kind.input) if (fd.t === 'press') v[name] = false; return v; };
  function queueOf(seat: number, kind: KindTable): SeatIn {
    let q = queues.get(seat);
    if (!q) { q = { held: neutral(kind), claim: null, entries: [], newest: 0, stamps: [], ack: 0, lead: 127, lastFrameTick: core.tick }; queues.set(seat, q); }
    return q;
  }
  const people = (): number => { let n = 0; for (const person of present.values()) if (person) n += 1; return n; };

  /* ---------------------------------------------------------------- frames in */

  function onIn(m: Record<string, unknown>): void {
    const seat = m.from;
    if (!Number.isInteger(seat) || (Number(m.e) >>> 0) !== epoch || !Array.isArray(m.s)) { stats.dropped += 1; return; }
    const body = core.bodyOf(seat as number);
    if (!body || body.driver !== 'person') return;
    const kind = body.kind;
    const q = queueOf(seat as number, kind);
    const K = core.tick;
    const k = Number(m.k) >>> 0;
    stats.ins += 1;
    q.lastFrameTick = K;
    // Lead: from this frame's arrival to the moment its first tick was due, in sixteenths of a tick. Negative is late.
    const lead = Math.max(-127, Math.min(126, Math.round(((base.ms + (k - base.tick) * period - o.clock.now()) / period) * 16)));
    if (lead < q.lead) q.lead = lead;
    const r = Number(m.r) & 0xffff;
    let before = -1;
    for (const raw of (m.s as unknown[]).slice(0, 64)) {
      if (!Array.isArray(raw)) break;
      const off = Number(raw[0]);
      if (!Number.isInteger(off) || off <= before || off > 4096) break;
      before = off;
      const j = (k + off) >>> 0;
      // A duplicate: not above the newest stamp this seat has sent. It still counted as the player being there.
      if (j <= q.newest) continue;
      // Too early: more than a second ahead. This entry and the rest of the frame are dropped.
      if (j > K + tickHz) { stats.dropped += 1; break; }
      q.newest = j;
      const values: Record<string, unknown> = {};
      const presses: string[] = [];
      let i = 1;
      for (const [name, fd] of kind.input) {
        // Input values are held to their declared types, whatever was sent.
        if (fd.t === 'press') { values[name] = false; if (raw[i] === 1) presses.push(name); } else values[name] = coerce(fd, raw[i], c.dims);
        i += 1;
      }
      const claim = kind.body?.owner && raw.length >= i + 9 ? { pos: unpackVec([raw[i], raw[i + 1], raw[i + 2]], c.dims), vel: unpackVec([raw[i + 3], raw[i + 4], raw[i + 5]], c.dims), heading: unpackVec([raw[i + 6], raw[i + 7], raw[i + 8]], c.dims), r } : null;
      q.stamps.push(j);
      if (j > K) { q.entries.push({ at: j, values, presses, claim }); continue; }
      // Late: its values hold from the next tick, and its presses fire there if that is within a quarter of a second of its stamp.
      stats.lateEntries += 1;
      const at = (K + 1) >>> 0;
      const keep = at - j <= lateTicks ? presses : [];
      const same = q.entries.find((x) => x.at === at);
      if (same) { same.values = values; same.claim = claim; for (const p of keep) if (!same.presses.includes(p)) same.presses.push(p); } else { q.entries.push({ at, values, presses: keep, claim }); q.entries.sort((a, b) => a.at - b.at); }
    }
    if (q.stamps.length > 256) q.stamps.splice(0, q.stamps.length - 256);
  }

  function frame(m: Record<string, unknown>): void {
    if (ended || !m || typeof m.t !== 'string') return;
    // A frame that throws is dropped and counted; the room goes on, and its timer is as it should be on the way out.
    try { onFrame(m); } catch (error) { fault(`frame ${m.t}`, error); } finally { keepTime(); }
  }
  function onFrame(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'in': return onIn(m);
      case 'join': {
        const p = m.peer as { seat?: unknown; name?: unknown; agent?: unknown; occ?: unknown; id?: unknown } | null;
        if (!p || !Number.isInteger(p.seat)) return;
        const seat = p.seat as number;
        const driver: Driver = p.agent ? 'ai' : 'person';
        names.set(seat, typeof p.name === 'string' ? p.name.slice(0, 40) : '');
        present.set(seat, driver === 'person');
        // The relay numbers every stay in a seat (`occ`): the same number is the same holder, back.
        core.seatJoin({ seat, driver, owner: `p${Number.isInteger(p.occ) ? p.occ : typeof p.id === 'string' ? p.id.slice(0, 40) : seat}` });
        core.seatAway(seat, false);
        queues.delete(seat);
        rosterText = '';
        if (people() > 0) { if (!running && !paused) start(); else if (paused) resume(); }
        return;
      }
      case 'leave': {
        if (!Number.isInteger(m.seat) || !present.has(m.seat as number)) return;
        present.delete(m.seat as number);
        queues.delete(m.seat as number);
        core.seatAway(m.seat as number, true);
        if (running && people() === 0) pause();
        return;
      }
      case 'free': {
        if (!Number.isInteger(m.seat)) return;
        present.delete(m.seat as number);
        queues.delete(m.seat as number);
        core.seatLeave(m.seat as number);
        rosterText = '';
        return;
      }
      case 'ev': {
        // What a player sends is read as what it is: a kind or a command's name that is not a text is no kind and no command.
        const kind = typeof m.k === 'string' ? m.k : '';
        if (!Number.isInteger(m.from)) return;
        if (kind === 'cmd') { const d = m.d as unknown[]; if (Array.isArray(d) && typeof d[0] === 'string') core.command(m.from as number, d[0], d[1]); return; }
        // A seat's speech and emotes reach everyone unchanged, as a browser host relays them today.
        if (SPEECH.test(kind)) o.send({ t: 'ev', from: m.from, k: kind, d: m.d ?? null });
        return;
      }
      case 'policy': {
        const p = m.policy as { bots?: unknown; level?: unknown; levelMax?: unknown; skill?: { level?: unknown } } | null;
        if (p) core.setPolicy({ bots: p.bots === 'off' ? 'off' : 'fill', level: Number(p.skill?.level ?? p.level), levelMax: Number(p.levelMax) });
        return;
      }
      default: return;
    }
  }

  /* ---------------------------------------------------------------- frames out */

  const nameOf = (seat: number, driver: Driver): string => (driver === 'bot' ? BOT_NAMES[seat % BOT_NAMES.length] : names.get(seat) || `Player ${seat + 1}`);
  function sendRoster(): void {
    const slots = core.bodies().sort((a, b) => a.seat - b.seat).map((b) => ({ slot: b.seat, seat: b.driver === 'bot' ? null : b.seat, name: nameOf(b.seat, b.driver), bot: b.driver === 'bot' }));
    const text = JSON.stringify(slots);
    if (text === rosterText) return;
    rosterText = text;
    o.send({ t: 'roster', slots });
  }
  function handle(out: CoreOut[], now: number): void {
    let roster = false;
    for (const x of out) {
      if (x.t === 'round') {
        const ms = (t: number): number => Math.round(now + (t - core.tick) * period);
        const drivers = new Map(core.bodies().map((b) => [b.seat, b.driver]));
        o.send({ t: 'round', round: {
          n: x.n, phase: x.phase, startedAt: ms(x.startedAt), endsAt: x.endsAt ? ms(x.endsAt) : ms(core.tick + 86_400 * tickHz),
          ...(x.results ? { results: x.results.map((r) => ({ slot: r.seat, seat: r.driver === 'bot' ? null : r.seat, name: nameOf(r.seat, drivers.get(r.seat) ?? r.driver), score: r.score, bot: r.driver === 'bot', place: r.place })) } : {}),
        } });
      } else if (x.t === 'fx') o.send({ t: 'ev', from: null, k: 'fx', d: [x.tick, x.list] });
      else if (x.t === 'seats') roster = true;
      else if (x.t === 'shared') o.send({ t: 'state', k: 'shared', d: core.shared() });
      else if (x.t === 'epoch') { epoch = x.epoch; queues.clear(); roster = true; } else if (x.t === 'fail') end('budget', { kind: x.kind, handler: x.handler });
    }
    if (roster || !rosterText) sendRoster();
  }

  /* ---------------------------------------------------------------- the tick */

  function tickOnce(): void {
    phase = 'inputs';
    const now = o.clock.now();
    const t = (core.tick + 1) >>> 0;
    const inputs = new Map<number, StepInput>();
    for (const [seat, q] of queues) {
      const body = core.bodyOf(seat);
      if (!body) continue;
      const presses: string[] = [];
      while (q.entries.length && q.entries[0].at <= t) {
        const e = q.entries.shift() as Entry;
        q.held = e.values; q.claim = e.claim;
        if (e.at === t) for (const p of e.presses) presses.push(p);
      }
      // Silence: no frame for a second. Its input is neutral until the next entry.
      if (t - q.lastFrameTick > tickHz && !q.entries.length) { q.held = neutral(body.kind); q.claim = null; }
      while (q.stamps.length && q.stamps[0] <= t) q.ack = q.stamps.shift() as number;
      const values = { ...q.held };
      for (const p of presses) values[p] = true;
      inputs.set(seat, { values, claim: q.claim });
    }
    phase = 'step';
    core.step(inputs);
    phase = 'frames';
    handle(core.drain(), now);
    if (ended) return;
    phase = 'snapshot';
    // The control table: one row a seat, [seat, r, ack, lead].
    const rows: number[][] = [];
    for (const b of core.bodies()) {
      if (b.driver !== 'person') continue;
      const q = queues.get(b.seat);
      rows.push([b.seat, b.r, q ? q.ack : 0, q && q.lead !== 127 ? q.lead : -128]);
      if (q) q.lead = 127;
    }
    // A snapshot is stamped with the moment its tick was due, so ticks run in a burst to catch up are still a tick
    // apart to whoever interpolates between them. The stamp always rises: a replica drops one that does not.
    lastSt = Math.max(lastSt + 1, Math.round(Math.min(now, dueOf(core.tick))));
    const snap = { t: 'snap', from: null, e: epoch, k: core.tick, st: lastSt, d: core.snapshot(), c: rows };
    o.send(snap, JSON.stringify(snap));
    stats.ticks += 1;
    stats.since += 1;
    if (now - stats.loggedAt >= 10_000) {
      // Tick figures, one line every ten seconds, never a line a tick.
      const s = core.stats;
      log({ ev: 'ticks', game: o.game, ...(o.build ? { build: o.build } : {}), tick: core.tick, ticks: stats.since, late: stats.late, slips: stats.slips, ins: stats.ins, lateEntries: stats.lateEntries, dropped: stats.dropped, errors: s.errors, budgetStops: s.budgetStops, cut: s.ticksCut, maxUnits: s.maxUnits, worst: s.worst, maxTickUnits: s.maxTickUnits, ...(s.lost ? { lost: s.lost } : {}), ...(stats.faults ? { faults: stats.faults, lastFault: stats.lastFault } : {}), ...(s.lastError ? { lastError: s.lastError } : {}) });
      stats.loggedAt = now; stats.since = 0; stats.late = 0; stats.ins = 0; stats.lateEntries = 0;
    }
  }
  /**
   * One tick, whatever happens in it. Anything thrown is caught here, so a tick never takes the timer chain down with
   * it. A tick that faulted, or that the budget cut short, is a failed tick; when every tick has failed for `FAIL_MS`
   * of the clock the room ends, and the log names the handler (or the fault).
   */
  function tick(now: number): void {
    const cut = core.stats.ticksCut;
    let faulted = false;
    try { tickOnce(); } catch (error) { faulted = true; fault(`tick ${core.tick} (${phase})`, error); }
    if (ended) return;
    if (!faulted && core.stats.ticksCut === cut) { failingSince = null; return; }
    if (failingSince === null) failingSince = now;
    if (now - failingSince < FAIL_MS) return;
    if (faulted) end('fault', { error: stats.lastFault, faults: stats.faults });
    else { const f = core.stats.failing; const dot = f.indexOf('.'); end('budget', { kind: dot < 0 ? f : f.slice(0, dot), handler: dot < 0 ? '' : f.slice(dot + 1) }); }
  }
  const dueOf = (t: number): number => base.ms + (t - base.tick) * period;
  function arm(): void {
    if (!running || armed) return;
    timer = o.clock.setTimer(wake, Math.max(0, dueOf(core.tick + 1) - o.clock.now()));
    armed = true;
  }
  function disarm(): void {
    if (!armed) return;
    armed = false;
    try { o.clock.clearTimer(timer); } catch (error) { fault('clearTimer', error); }
    timer = null;
  }
  /**
   * The rule of this module, put right on every way out: a running room has a timer pending, a room that is not
   * running has none. A clock that will not give a timer cannot keep a room: the room ends, cleanly, and says so.
   */
  function keepTime(): void {
    if (!running) { disarm(); return; }
    if (armed) return;
    try { arm(); } catch (error) { fault('setTimer', error); end('clock', { error: stats.lastFault }); }
  }
  function wake(): void {
    armed = false;
    timer = null;
    if (!running) return;
    try {
      let n = 0;
      while (running && n < 4) {
        const now = o.clock.now();
        const due = dueOf(core.tick + 1);
        if (now + 0.5 < due) break;
        // The overrun check: a tick that starts more than a period late blames the tick that held it up.
        if (now - due > period) { stats.late += 1; blameLate(now, period); }
        // Blamed since its last tick began: a run of slow ticks begins (when the tick blamed did), or goes on.
        if (blamed) { if (overSince === null) { overSince = lastStart; overTicks = 0; overBlamed = 0; } overBlamed += 1; }
        blamed = false;
        if (overSince !== null) {
          overTicks += 1;
          if (2 * overBlamed < overTicks) overSince = null;
          // A room whose ticks have run slow for five seconds of the clock ends, and the log names the handler that used the most units.
          else if (now - overSince >= OVERRUN_MS) { end('overrun', { worst: core.stats.worst, maxUnits: core.stats.maxUnits, seconds: Math.round((now - overSince) / 100) / 10 }); return; }
        }
        recent.push({ who: self, at: now });
        if (recent.length > 8) recent.shift();
        lastStart = now;
        tick(now);
        n += 1;
      }
      // Far behind (the isolate was busy, or the machine slept): the clock runs slow. It never jumps to catch up.
      // The tick after a slip starts on time by the new clock, so the tick that ran last is judged here, before the slip hides it.
      if (running && o.clock.now() - dueOf(core.tick + 1) > 4 * period) { const now = o.clock.now(); blameLate(now, period); base = { ms: now, tick: core.tick }; stats.slips += 1; }
    } catch (error) {
      // Thrown outside any tick (the clock, the blame): a failed turn of the loop, counted like a failed tick.
      fault('wake', error);
      if (failingSince === null) failingSince = lastStart;
      let now = lastStart + FAIL_MS;
      try { now = o.clock.now(); } catch { /* a clock that cannot be read: the room has failed for as long as the rule needs */ }
      if (now - failingSince >= FAIL_MS) end('fault', { error: stats.lastFault, faults: stats.faults });
    } finally { keepTime(); }
  }
  const self = { blame: (): void => { blamed = true; } };

  function start(): void {
    if (running || ended) return;
    running = true; paused = false;
    try {
      base = { ms: o.clock.now(), tick: core.tick };
      overSince = null; blamed = false; failingSince = null; lastStart = base.ms;
      const caps = c.kinds.some((k) => k.think) ? ['skill'] : [];
      if (caps.length) o.send({ t: 'caps', caps });
      log({ ev: 'host-start', game: o.game, tick: core.tick, epoch, tickHz });
    } catch (error) { fault('start', error); } finally { keepTime(); }
  }
  function pause(): void {
    if (!running) return;
    running = false; paused = true;
    // A pending timer would keep the object in memory and billed: the pause clears it.
    disarm();
    log({ ev: 'host-pause', game: o.game, tick: core.tick });
    try { o.onPause?.(); } catch (error) { fault('onPause', error); }
  }
  function resume(): void {
    if (running || ended || !paused) return;
    running = true; paused = false;
    try {
      // The room resumes at the tick it paused on: no tick is skipped and no timer fires for the gap.
      base = { ms: o.clock.now(), tick: core.tick };
      overSince = null; blamed = false; failingSince = null; lastStart = base.ms;
      for (const q of queues.values()) q.lastFrameTick = core.tick;
      log({ ev: 'host-resume', game: o.game, tick: core.tick });
      o.onResume?.();
    } catch (error) { fault('resume', error); } finally { keepTime(); }
  }
  function stop(): void {
    running = false; paused = false; ended = true;
    disarm();
    for (let i = recent.length - 1; i >= 0; i -= 1) if (recent[i].who === self) recent.splice(i, 1);
  }
  function end(why: string, facts: Record<string, unknown>): void {
    if (ended) return;
    // Stopped first: whatever the log or the caller's `onEnd` do, the room is over and holds no timer.
    stop();
    log({ ev: 'host-ended', game: o.game, ...(o.build ? { build: o.build } : {}), why, tick: core.tick, ...facts });
    try { o.onEnd?.(why, facts); } catch (error) { fault('onEnd', error); }
  }

  return {
    get tick() { return core.tick; },
    get epoch() { return epoch; },
    get running() { return running; },
    get paused() { return paused; },
    get people() { return people(); },
    frame, start, pause, resume, stop,
    tickNow: () => {
      if (ended) return;
      let now = lastStart;
      try { now = o.clock.now(); tick(now); } catch (error) { fault('tickNow', error); } finally { keepTime(); }
    },
    save: () => toBytes({ v: 1, core: core.save(), names: [...names], queues: [...queues].map(([seat, q]) => [seat, q.held, q.claim, q.newest, q.ack]) }),
    facts: () => ({ tick: core.tick, epoch, running, paused, ended, armed, people: people(), tickHz, ...stats, core: { ...core.stats } }),
    core,
  };
}

/** An owner-moved body's claim as an `in` entry carries it, after the input fields: nine numbers (for callers that build frames by hand: the bot client, the tests). */
export const claimOf = (p: Vec3, v: Vec3, h: Vec3): number[] => [p.x, p.y, p.z, v.x, v.y, v.z, h.x, h.y, h.z];
