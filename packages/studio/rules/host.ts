/*
 * host.ts — the host runtime: a rules module playing the host's part on the wire.
 * =============================================================================
 *
 * The server normally hosts the room: rules, clock and state. Browser hosting uses the same runtime
 * for offline play, local development or private friends games. It takes a compiled rules module (rules.ts) and three things from its
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
import { AGENT_RULES, useAgents, type Agents, type AgentsSaved, type Vocabulary } from '../agents/agents.ts';
import { DEFAULT_POLICY, type Netplay, type Peer, type Policy, type Slot } from '../netplay/netplay.ts';
import { createCore } from './core.ts';
import type { Core, CoreOut, Driver, SavedCore, StepInput } from './core.ts';
import { coerce, coerceFields, num, own, fromBytes, initFields, toBytes, unpackVec, unpackFields } from './pack.ts';
import type { Compiled, KindTable, Vec3 } from './rules.ts';

export interface HostClock {
  /** Milliseconds. Inside a Worker this stands still while code runs. */
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}
export interface HostOptions {
  game: string;
  record?(owner:string,key:string,value:Record<string,unknown>):void;
  /** The build check compares a movement step before any tick handler can change it. */
  moved?: NonNullable<Parameters<typeof createCore>[1]>['moved'];
  /** Told of every handler as it ends, and what it threw if it threw (core.ts `observe`): the build check listens. */
  observe?(kind: string, handler: string, error?: string): void;
  /** Told of a written value the runtime changed to make it fit (core.ts `noted`): the build check listens. */
  noted?(kind: string, handler: string, what: string, at: string, written: string): void;
  /** The game's build, for the log. */
  build?: string;
  compiled: Compiled;
  /** The deterministic build check answers asks with their floors on the next tick. */
  check?: boolean;
  /** One outgoing frame, for the relay to fan out. `text` is the frame already encoded, when the runtime encoded it. */
  send(frame: Record<string, unknown>, text?: string): void;
  clock: HostClock;
  /** Synchronous save: the caller's storage output gate holds this tick's outgoing frames until confirmed. */
  store?: { save(bytes: Uint8Array): void };
  /** Table recovery reserves this epoch in storage before starting this host. Ordinary deterministic restores omit it. */
  restoreEpoch?: number;
  startDelayMs?: number;
  onTick?(): void;
  /** Only the shared server isolate can attribute timer lateness to another tick. */
  enforceOverrun?: boolean;
  log?(line: Record<string, unknown>): void;
  /** A number in [0, 1) for a fresh epoch and seed. */
  random?(): number;
  /** A room saved by `save()`, to carry on from. */
  restore?: Uint8Array | null;
  /** A browser promotion starts immediately; server recovery starts paused by default. */
  startPaused?: boolean;
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
  readonly viewRadiusM: number | null;
  readonly privateDelivery: boolean;
  projectSnapshot(snap: any, seat: number | null): any;
  readonly viewSettings: Compiled['settings']['view'];
  frame(m: Record<string, unknown>): void;
  /** Start the tick loop (the first person has joined). */
  start(): void;
  pause(): void;
  resume(): void;
  /** Publish the round, the roster, the shared state and the capabilities again (a browser host's relay restarted). */
  announce(): void;
  /** Stop for good: the room has ended. */
  stop(): void;
  /** Run the next tick now, whatever the clock says (tests, and the build check's runs). Like the timer's own tick, it never throws. */
  tickNow(): void;
  /** The whole room as bytes. */
  save(): Uint8Array;
  facts(): Record<string, unknown>;
  readonly core: Core;
}

interface Entry { at: number; values: Record<string, unknown>; presses: (string | [string, number])[]; claim: StepInput['claim'] }
interface SeatIn {
  pulses?: [string,number][];
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
  const saved = o.restore ? fromBytes(o.restore) as { v: number; core: SavedCore; names: [number, string][]; agents?: AgentsSaved; guideViews?: [number, { id: string; at: number; value: Record<string, unknown> }][]; queues: [number, Record<string, unknown>, StepInput['claim'], number, number][]; inputs?: [number, SeatIn][] } : null;
  if (o.restore && (!saved || typeof saved !== 'object' || Array.isArray(saved))) throw new Error('saved host is not an object');
  if (saved) {
    const check = (ok: unknown): void => { if (!ok) throw new Error('saved host inputs are invalid'); };
    const uint = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) >= 0;
    check(Object.keys(saved).every(k => ['v', 'core', 'names', 'agents', 'guideViews', 'queues', 'inputs'].includes(k)));
    check(saved.core && Array.isArray(saved.names) && Array.isArray(saved.queues));
    if (saved.agents !== undefined) {
      const tables = ['goals', 'asks', 'avoid', 'sayAt', 'viewAt', 'floorAt', 'askAt'];
      check(saved.agents && Object.keys(saved.agents).every(k => tables.includes(k)));
      const data = (v: unknown): boolean => Boolean(v && typeof v === 'object' && !Array.isArray(v));
      const stamp = (v: unknown, future = 0): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= saved.core.tick * period + future;
      for (const key of tables) {
        const rows = own(saved.agents, key) as any;
        check(Array.isArray(rows) && rows.length <= c.seats);
        const seats = new Set();
        for (const row of rows) {
          check(Array.isArray(row) && row.length === 2 && uint(row[0]) && row[0] < c.seats && !seats.has(row[0])); seats.add(row[0]);
          const v = row[1];
          if (key === 'goals') check(data(v) && Object.keys(v).every(k => ['goal', 'args', 'from', 'at', 'state', 'asked'].includes(k)) && typeof v.goal === 'string' && data(v.args) && ['brain', 'floor'].includes(v.from) && ['active', 'done', 'failed'].includes(v.state) && stamp(v.at) && (v.asked === undefined || typeof v.asked === 'boolean'));
          else if (key === 'asks') {
            check(Array.isArray(v) && v.length <= 3);
            for (const a of v) check(data(a) && Object.keys(a).every(k => ['k', 'args', 'from', 'at'].includes(k)) && typeof a.k === 'string' && data(a.args) && uint(a.from) && a.from < c.seats && stamp(a.at));
          } else if (key === 'avoid') {
            check(Array.isArray(v) && v.length <= c.seats && new Set(v.map(a => a?.[0])).size === v.length);
            for (const a of v) check(Array.isArray(a) && a.length === 2 && uint(a[0]) && a[0] < c.seats && stamp(a[1], AGENT_RULES.leaveMs));
          } else check(stamp(v));
        }
      }
    }
    if (saved.guideViews !== undefined) {
      check(Array.isArray(saved.guideViews) && saved.guideViews.length <= c.seats && new Set(saved.guideViews.map(row => row?.[0])).size === saved.guideViews.length);
      for (const row of saved.guideViews) {
        check(Array.isArray(row) && row.length === 2);
        const [seat, v] = row;
        check(uint(seat) && seat < c.seats && v && Object.keys(v).every(k => ['id', 'at', 'value'].includes(k)) && typeof v.id === 'string' && uint(v.at) && v.at <= saved.core.tick);
        check(JSON.stringify(v.value) === JSON.stringify(coerceFields(c.view, v.value, c.dims)));
      }
    }
    check(saved.names.length <= c.seats && saved.queues.length <= c.seats);
    for (const rows of [saved.names, saved.queues, ...(saved.inputs === undefined ? [] : [saved.inputs])]) {
      check(Array.isArray(rows) && rows.every((row) => Array.isArray(row)));
      check(new Set(rows.map((row) => row[0])).size === rows.length);
    }
    for (const [seat, name] of saved.names) check(uint(seat) && seat < c.seats && typeof name === 'string' && name.length <= 40 && !saved.core.seats?.some(s => s[0] === seat && s[2] === 'reserved'));
    const claimOk = (claim: StepInput['claim']): boolean => claim === null || Boolean(claim && uint(claim.r) && ['pos', 'vel', 'heading'].every((key) => {
      const v = own(claim, key); return v && ['x', 'y', 'z'].every((axis) => typeof own(v, axis) === 'number' && Number.isFinite(own(v, axis)));
    }));
    const valuesOk = (seat: number, values: unknown): boolean => {
      const ent = saved.core.ents.find((w) => w[11] === seat);
      const kind = ent && c.kinds[ent[2] as number];
      return Boolean(kind && JSON.stringify(values) === JSON.stringify(coerceFields(kind.input, values, c.dims)));
    };
    for (const [seat, held, claim, newest, ack] of saved.queues) check(uint(seat) && seat < c.seats && valuesOk(seat, held) && claimOk(claim) && uint(newest) && uint(ack));
    if (saved.inputs !== undefined) {
      check(Array.isArray(saved.inputs) && saved.inputs.length <= c.seats);
      for (const [seat, q] of saved.inputs) {
        check(uint(seat) && seat < c.seats && q && valuesOk(seat, q.held) && claimOk(q.claim) && uint(q.newest) && uint(q.ack) && uint(q.lastFrameTick) && Number.isInteger(q.lead) && q.lead >= -127 && q.lead <= 127);
        check(Array.isArray(q.stamps) && q.stamps.length <= 256 && q.stamps.every(uint) && Array.isArray(q.entries) && q.entries.length <= c.settings.tickHz + 1);
        if(q.pulses!==undefined)check(Array.isArray(q.pulses)&&q.pulses.length<=16&&q.pulses.every(p=>Array.isArray(p)&&p.length===2&&c.kinds.some(k=>k.input.some(([n,f])=>n===p[0]&&f.t==='pulse'))&&Number.isInteger(p[1])&&p[1]>0&&p[1]<=255));
        for (const e of q.entries) check(uint(e.at) && valuesOk(seat, e.values) && claimOk(e.claim) && Array.isArray(e.presses) && e.presses.every((p) => c.kinds.some((k) => k.input.some(([name, fd]) => (typeof p === 'string' ? name === p && fd.t === 'press' : Array.isArray(p) && p.length === 2 && name === p[0] && fd.t === 'pulse' && Number.isInteger(p[1]) && p[1] > 0 && p[1] <= 255)))));
      }
    }
  }
  if (saved && saved.v !== 1) throw new Error('this save was written by another version of the runtime');
  const measuredRtt = new Map<number, number>();
  const core = createCore(c, { rewindTicks: seat => Math.ceil(((measuredRtt.get(seat) ?? 0) + 150 + period) / period), label: (seat,driver)=>nameOf(seat,driver), moved: o.moved, observe: o.observe, noted: o.noted, seed: Math.floor(random() * 4294967296) >>> 0, epoch: saved ? undefined : (Math.floor(random() * 4294967295) >>> 0) + 1, restore: saved?.core ?? null, restoreEpoch: o.restoreEpoch, stage: o.stage, decisions: !o.check });
  let epoch = core.epoch;
  if (saved && (o.startPaused ?? o.restoreEpoch !== undefined)) for (const body of core.bodies()) if (body.driver !== 'bot' && body.owner !== 'reserved') core.seatAway(body.seat, true);
  let lastSaveAt = o.clock.now();
  let saveTick = core.tick;
  let forceSave = false;
  let saveFailures = 0;
  let retrySaveAt = 0;
  let roundPhase = saved?.core.round[1] ?? 1;
  let firstTick = true;
  const names = new Map<number, string>(saved?.names ?? []);
  /** Seats whose holder is here now, by seat, with whether it is a person (an AI never keeps the world ticking). */
  const present = new Map<number, boolean>();
  const queues = new Map<number, SeatIn>();
  const peers = new Map<string, Peer>();
  let policy: Policy = DEFAULT_POLICY;
  let agents: Agents | null = null;
  let savedAgents = saved?.agents;
  const guideOwners = new Map(core.bodies().map((b) => [b.seat, `${b.id}/${b.owner}/${b.driver}`]));
  const guideViews = new Map<number, { id: string; at: number; value: Record<string, unknown> }>();
  for (const [seat, v] of saved?.guideViews ?? []) if (core.bodyOf(seat)?.id === v.id) guideViews.set(seat, v);
  const agentEvents = new Set<(m: any) => void>();
  let agentInbox: Record<string, unknown>[] = [];
  function agentSlots(brainsOnly = false): Slot[] {
    if (policy.kind === 'humans-only') return [];
    return core.bodies().filter((b) => { const k = c.kindOf[b.kind]; return b.driver === 'ai' && (!brainsOnly || Boolean(k.guide && k.think)); }).map((b) => {
      const peer = [...peers.values()].find((p) => p.seat === b.seat && p.agent);
      return { slot: b.seat, seat: peer ? b.seat : null, name: nameOf(b.seat, b.driver), bot: !peer,
        agent: { seat: peer ? b.seat : null, role: peer?.agent?.role ?? (b.seat >= c.seats - policy.guides ? 'guide' : 'party'), hands: peer?.agent?.hands ?? 'host' } };
    });
  }
  function agentView(seat: number): Record<string, unknown> {
    const body = core.bodyOf(seat);
    const old = guideViews.get(seat);
    if (body && old?.id === body.id && core.tick - old.at < 2 * tickHz) return old.value;
    const value = core.guide(seat) ?? {};
    if (body) {
      guideViews.set(seat, { id: body.id, at: core.tick, value });
      o.send({ t: 'ev', k: 'agent:offer', d: { slot: seat, view: value } });
    }
    return value;
  }
  function setAgents(vocab: Vocabulary | null): void {
    core.vocabulary(vocab);
    agents?.stop();
    agents = null;
    if (!vocab) return;
    const net = {
      isHost: true, offline: false, hushed: false, get policy() { return policy; }, peers,
      get slots() { return agentSlots(true); },
      isAgent: (seat: number) => present.get(seat) === false,
      on: (_kind: string, fn: (m: any) => void) => { agentEvents.add(fn); return () => agentEvents.delete(fn); },
      send: (k: string, d: unknown, to?: number) => o.send({ t: 'ev', k, d, ...(to !== undefined ? { to } : {}) }),
    } as unknown as Netplay;
    agents = useAgents(net, vocab, { roles: ['guide', 'party'], manual: true, carryFloor: true, now: () => core.tick * period, restore: savedAgents,
      view: agentView, decide: (v, ctx) => core.guide(ctx.slot, { ...v, goal: ctx.goal ? { ...ctx.goal, at: Math.round(ctx.goal.at / period) } : null }),
    });
    savedAgents = undefined;
    agents.on('goal', (d) => o.send({ t: 'ev', k: 'agent:goal', d }));
    agents.on('ask', (d) => o.send({ t: 'ev', k: 'agent:ask', d }));
  }
  function guideBeat(): void {
    // Roles come from admitted peers and reserved server seats, never player input.
    const guideSeats = agentSlots().filter(slot => slot.agent?.role === 'guide').map(slot => slot.slot).sort((a, b) => a - b);
    const previous = (core.world as { guideSeats: readonly number[] }).guideSeats;
    if (guideSeats.length !== previous.length || guideSeats.some((seat, i) => seat !== previous[i])) core.setPolicy({ guideSeats });
    if (!agents) return;
    const bodies = core.bodies();
    for (const b of bodies) {
      const key = `${b.id}/${b.owner}/${b.driver}`;
      if (guideOwners.has(b.seat) && guideOwners.get(b.seat) !== key) { agents.forget(b.seat); guideViews.delete(b.seat); }
      guideOwners.set(b.seat, key);
    }
    for (const seat of guideOwners.keys()) if (!bodies.some((b) => b.seat === seat)) { agents.forget(seat); guideOwners.delete(seat); guideViews.delete(seat); }
    for (const slot of agentSlots(true)) {
      agentView(slot.slot);
      const g = agents.goalOf(slot.slot);
      // A saved or stale helper goal must pass the same boundary before it can delay the floor. Only the goal goes:
      // the quiet rule, the open asks and a player's "leave me alone" belong to the companion, not to this goal.
      if (g?.state === 'active' && !core.goal(slot.slot, { ...g, at: Math.round(g.at / period) })) agents.dropGoal(slot.slot);
    }
    const inbox = agentInbox; agentInbox = [];
    for (const m of inbox) for (const fn of agentEvents) fn(m);
    agents.tick();
    for (const b of core.bodies()) {
      const g = agents.goalOf(b.seat);
      core.goal(b.seat, g?.state === 'active' ? { goal: g.goal, args: g.args, from: g.from, at: Math.round(g.at / period), asked: g.asked === true } : null);
    }
  }
  let running = false;
  let paused = Boolean(saved && (o.startPaused ?? o.restoreEpoch !== undefined));
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
  let roundRebaseAt = -Infinity;
  let roundRebasePending = false;
  function publishRebase(now: number): void {
    roundRebasePending = true;
    if (now - roundRebaseAt < 250) return;
    roundRebaseAt = now; roundRebasePending = false;
    const { results, ...round } = core.round(); handle([round], now, true);
  }
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
  for (const [seat, q] of saved?.inputs ?? []) queues.set(seat, q);
  const neutral = (kind: KindTable): Record<string, unknown> => { const v = initFields(kind.input, c.dims); for (const [name, fd] of kind.input) if (fd.t === 'press' || fd.t === 'pulse') v[name] = fd.t === 'press' ? false : 0; return v; };
  function queueOf(seat: number, kind: KindTable): SeatIn {
    let q = queues.get(seat);
    if (!q) { q = { held: neutral(kind), claim: null, entries: [], newest: 0, stamps: [], ack: 0, lead: 127, lastFrameTick: core.tick }; queues.set(seat, q); }
    return q;
  }
  const people = (): number => { let n = 0; for (const person of present.values()) if (person) n += 1; return n; };

  /* ---------------------------------------------------------------- frames in */

  function onIn(m: Record<string, unknown>): void {
    const seat = m.from;
    if (!Number.isInteger(seat) || m.e !== epoch || !Array.isArray(m.s)) { stats.dropped += 1; return; }
    const body = core.bodyOf(seat as number);
    if (!body || !hasHands(seat as number, body.driver)) return;
    const kind = body.kind;
    const q = queueOf(seat as number, kind);
    const K = core.tick;
    const k = num(m.k) >>> 0;
    stats.ins += 1;
    q.lastFrameTick = K;
    // Lead: from this frame's arrival to the moment its first tick was due, in sixteenths of a tick. Negative is late.
    const lead = Math.max(-127, Math.min(126, Math.round(((base.ms + (k - base.tick) * period - o.clock.now()) / period) * 16)));
    if (lead < q.lead) q.lead = lead;
    const r = num(m.r) & 0xffff;
    let before = -1;
    for (const raw of (m.s as unknown[]).slice(0, 64)) {
      if (!Array.isArray(raw)) break;
      const off = num(raw[0]);
      if (!Number.isInteger(off) || off <= before || off > 4096) break;
      before = off;
      const j = (k + off) >>> 0;
      // A duplicate: not above the newest stamp this seat has sent. It still counted as the player being there.
      if (j <= q.newest) continue;
      // Too early: more than a second ahead. This entry and the rest of the frame are dropped.
      if (j > K + tickHz) { stats.dropped += 1; break; }
      q.newest = j;
      const values: Record<string, unknown> = {};
      const presses: (string | [string, number])[] = [];
      let i = 1;
      for (const [name, fd] of kind.input) {
        // Input values are held to their declared types, whatever was sent.
        if (fd.t === 'press') { values[name] = false; if (raw[i] === 1) presses.push(name); } else if (fd.t === 'pulse') { values[name] = 0;  } else values[name] = coerce(fd, raw[i], c.dims);
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
  function cleanSpeech(data: unknown): unknown {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data ?? null;
    const { ai, slot, seat, ...rest } = data as Record<string, unknown>;
    return rest;
  }
  function onFrame(m: Record<string, unknown>): void {
    switch (m.t) {
      case 'latency': if(Number.isInteger(m.seat) && typeof m.ms==='number' && Number.isFinite(m.ms) && m.ms>=0) measuredRtt.set(m.seat as number,Math.min(m.ms,2000)); return;
      case 'vocabulary': setAgents((m.vocab ?? null) as Vocabulary | null); return;
      case 'decided': core.answer(String(m.n ?? ''), m); return;
      case 'in': return onIn(m);
      case 'join': {
        const p = m.peer as { seat?: unknown; name?: unknown; agent?: unknown; occ?: unknown; id?: unknown } | null;
        if (!p || !Number.isInteger(p.seat)) return;
        const seat = p.seat as number;
        for (const [id, old] of peers) if (old.seat === seat) peers.delete(id);
        peers.set(String(p.id), p as Peer);
        const driver: Driver = p.agent ? 'ai' : 'person';
        names.set(seat, typeof p.name === 'string' ? p.name.slice(0, 40) : '');
        present.set(seat, driver === 'person');
        // The relay numbers every stay in a seat (`occ`): the same number is the same holder, back.
        const owner = `p${Number.isInteger(p.occ) ? p.occ : typeof p.id === 'string' ? p.id.slice(0, 40) : seat}`;
        const previous = core.bodies().find((s) => s.seat === seat);
        core.seatJoin({ seat, driver, owner });
        core.seatAway(seat, false);
        if (!previous || previous.driver !== driver || previous.owner !== owner) queues.delete(seat);
        rosterText = '';
        if (people() > 0) { if (!running && !paused) start(); else if (paused) resume(); }
        return;
      }
      case 'leave': {
        if (!Number.isInteger(m.seat) || !present.has(m.seat as number)) return;
        for (const [id, p] of peers) if (p.seat === m.seat) peers.delete(id);
        present.delete(m.seat as number);
        queues.delete(m.seat as number);
        core.seatAway(m.seat as number, true);
        if (running && people() === 0) pause();
        return;
      }
      case 'free': {
        if (!Number.isInteger(m.seat)) return;
        names.delete(m.seat as number);
        for (const [id, p] of peers) if (p.seat === m.seat) peers.delete(id);
        present.delete(m.seat as number);
        queues.delete(m.seat as number);
        core.seatLeave(m.seat as number);
        rosterText = '';
        return;
      }
      case 'ev': {
        // What a player sends is read as what it is: a kind or a command's name that is not a text is no kind and no command.
        const kind = typeof m.k === 'string' ? m.k : '';
        if (!Number.isInteger(m.from)) {
          if (m.from === null && SPEECH.test(kind)) o.send({ t: 'ev', from: null, k: kind, d: cleanSpeech(m.d) });
          return;
        }
        if (agents && (kind === 'agent:do' || /^ask:/.test(kind) || (SPEECH.test(kind) && present.get(m.from as number) === false))) { if (agentInbox.length < 128) agentInbox.push(m); return; }
        if(kind === 'pulse') {
          const data=m.d,body=core.bodyOf(m.from as number);
          if(!body || !hasHands(m.from as number,body.driver) || !Array.isArray(data) || data.length!==3 || data[0]!==epoch || typeof data[1]!=='string' || !body.kind.input.some(([name,fd])=>name===data[1]&&fd.t==='pulse'))return;
          const value=coerce({t:'pulse'},data[2],c.dims) as number,q=queueOf(m.from as number,body.kind);q.pulses??=[];
          if(value && q.pulses.length<16)q.pulses.push([data[1],value]);return;
        }
        if (kind === 'cmd') { const d = m.d as unknown[]; if (Array.isArray(d) && typeof d[0] === 'string') core.command(m.from as number, d[0], d[1]); return; }
        // Speech keeps its payload, except the identity fields only the host may attach.
        if (SPEECH.test(kind)) o.send({ t: 'ev', from: m.from, k: kind, d: cleanSpeech(m.d) });
        return;
      }
      case 'policy': {
        const p = m.policy as { bots?: unknown; level?: unknown; levelMax?: unknown; skill?: { level?: unknown } } | null;
        if (p) {
          const raw = m.policy as Partial<Policy>;
          const previous = policy;
          const count = (v: unknown): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(c.seats - 1, Math.floor(v))) : 0;
          const kind = raw.kind === 'hybrid' || raw.kind === 'beginner' || raw.kind === 'humans-only' ? raw.kind : 'open';
          policy = { ...DEFAULT_POLICY, kind, bots: raw.bots === 'off' ? 'off' : 'fill',
            aiSeats: kind === 'hybrid' || kind === 'beginner' ? count(raw.aiSeats) : 0, guides: kind === 'beginner' ? count(raw.guides) : 0,
            brain: typeof raw.brain === 'string' && ['script', 'off', 'workers-ai', 'owner-key'].includes(raw.brain) ? raw.brain : 'script',
            speech: raw.speech === 'off' || raw.speech === 'lines' ? raw.speech : 'game' };
          if (previous.kind !== policy.kind || previous.aiSeats !== policy.aiSeats || previous.guides !== policy.guides) rosterText = '';
        }
        if (p) core.setPolicy({ kids: own(p, 'kids') === true, ...(own(p, 'level') !== undefined ? { guideLevel: num(own(p, 'level')) } : {}), levelSet: Boolean(own(p, 'by')), bots: p.bots === 'off' ? 'off' : 'fill', level: num(own(own(p, 'skill'), 'level') ?? own(p, 'level')), levelMax: num(own(p, 'levelMax')), reserved: policy.kind === 'hybrid' || policy.kind === 'beginner' ? policy.aiSeats + policy.guides : 0 });
        return;
      }
      default: return;
    }
  }

  /* ---------------------------------------------------------------- frames out */

  const hasHands = (seat: number, driver: Driver): boolean => driver === 'person' || (driver === 'ai' && [...peers.values()].some((p) => p.seat === seat && p.agent?.hands === 'self'));
  const nameOf = (seat: number, driver: Driver): string => (driver === 'bot' || (driver === 'ai' && (core.bodies().find((b) => b.seat === seat)?.owner === 'reserved' || !names.has(seat))) ? BOT_NAMES[seat % BOT_NAMES.length] : names.get(seat) || `Player ${seat + 1}`);
  function sendRoster(): void {
    const guides = new Map(agentSlots().map((s) => [s.slot, s.agent]));
    const slots = core.bodies().sort((a, b) => a.seat - b.seat).map((b) => ({ slot: b.seat, seat: b.driver === 'bot' ? null : b.seat, name: nameOf(b.seat, b.driver), bot: b.driver === 'bot', ...(guides.has(b.seat) ? { agent: guides.get(b.seat) } : {}) }));
    const text = JSON.stringify(slots);
    if (text === rosterText) return;
    rosterText = text;
    o.send({ t: 'roster', slots });
  }
  function handle(out: CoreOut[], now: number, retime = false): void {
    let roster = false;
    for (const x of out) {
      if (x.t === 'round') {
        if (x.phase === 'over') forceSave = true;
        if(!retime && x.results && c.records && o.record){
          const declaration=c.records, shared=unpackFields(c.shared,core.shared(),c.dims), snapshot=core.snapshot();
          for(const result of x.results){if(result.driver!=='person')continue;const row=(snapshot[1] as any[]).find(e=>e[0]===result.id);if(!row)continue;const kind=c.kinds[row[1]],fields=unpackFields(kind.fields,row[7],c.dims);if(declaration.eligible&&!fields[declaration.eligible])continue;
            const value:Record<string,unknown>={id:String(shared[declaration.identity]),endedAt:Math.round(now),place:result.place,won:result.place===1&&x.results.filter(r=>r.place===1).length===1};
            for(const [name,source] of Object.entries(declaration.fields))value[name]=Math.round(Number(fields[source]));
            o.record(String(row[12]),declaration.key,value);
          }
        }
        const ms = (t: number): number => Math.round(now + (t - core.tick) * period);
        const drivers = new Map(core.bodies().map((b) => [b.seat, b.driver]));
        o.send({ t: 'round', ...(retime ? { retime: true } : {}), round: {
          n: x.n, phase: x.phase, startedAt: ms(x.startedAt), endsAt: x.endsAt ? ms(x.endsAt) : ms(core.tick + 86_400 * tickHz),
          ...(!retime && x.results ? { results: x.results.map((r) => ({ slot: r.seat, seat: r.driver === 'bot' ? null : r.seat, name: nameOf(r.seat, drivers.get(r.seat) ?? r.driver), score: r.score, bot: r.driver === 'bot', ...(r.driver === 'ai' ? { agent: true } : {}), place: r.place })) } : {}),
        } });
      } else if (x.t === 'ask') o.send({ t: 'decide', n: x.n, state: x.state, questions: x.questions });
      else if (x.t === 'goalDone') agents?.done(x.seat, x.ok);
      else if (x.t === 'fx') o.send({ t: 'ev', from: null, k: 'fx', d: [x.tick, x.list] });
      else if (x.t === 'seats') roster = true;
      else if (x.t === 'shared') o.send({ t: 'state', k: 'shared', d: core.shared() });
      else if (x.t === 'epoch') { forceSave = true; epoch = x.epoch; queues.clear(); roster = true; } else if (x.t === 'fail') end('budget', { kind: x.kind, handler: x.handler });
    }
    if (roster || !rosterText) sendRoster();
  }

  /* ---------------------------------------------------------------- the tick */

  function tickOnce(): void {
    if (firstTick) firstTick = false;
    o.onTick?.();
    phase = 'inputs';
    const now = o.clock.now();
    const t = (core.tick + 1) >>> 0;
    const inputs = new Map<number, StepInput>();
    for (const [seat, q] of queues) {
      const body = core.bodyOf(seat);
      if (!body) continue;
      const presses: (string | [string, number])[] = [];
      while (q.entries.length && q.entries[0].at <= t) {
        const e = q.entries.shift() as Entry;
        q.held = e.values; q.claim = e.claim;
        if (e.at === t) for (const p of e.presses) presses.push(p);
      }
      // Silence: no frame for a second. Its input is neutral until the next entry.
      if (t - q.lastFrameTick > tickHz && !q.entries.length) { q.held = neutral(body.kind); q.claim = null; }
      while (q.stamps.length && q.stamps[0] <= t) q.ack = q.stamps.shift() as number;
      const values = { ...q.held };
      for (const p of presses) { if (typeof p === 'string') values[p] = true; else values[p[0]] = p[1]; }
      const pulse=q.pulses?.shift();if(pulse)values[pulse[0]]=pulse[1];
      inputs.set(seat, { values, claim: q.claim });
    }
    if (roundRebasePending) publishRebase(now);
    phase = 'step';
    core.step(inputs, guideBeat);
    phase = 'frames';
    const out = core.drain();
    handle(out, now);
    if (ended) return;
    phase = 'snapshot';
    const data = core.snapshot();
    const nextPhase = (data[0] as number[])[1];
    if (roundPhase === 1 && nextPhase === 0) forceSave = true;
    roundPhase = nextPhase;
    checkpoint(forceSave);
    // The control table: one row a seat, [seat, r, ack, lead].
    const rows: number[][] = [];
    for (const b of core.bodies()) {
      if (!hasHands(b.seat, b.driver)) continue;
      const q = queues.get(b.seat);
      rows.push([b.seat, b.r, q ? q.ack : 0, q && q.lead !== 127 ? q.lead : -128]);
      if (q) q.lead = 127;
    }
    // A snapshot is stamped with the moment its tick was due, so ticks run in a burst to catch up are still a tick
    // apart to whoever interpolates between them. The stamp always rises: a replica drops one that does not.
    lastSt = Math.max(lastSt + 1, Math.round(Math.min(now, dueOf(core.tick))));
    const snap = { t: 'snap', from: null, e: epoch, k: core.tick, st: lastSt, d: data, c: rows };
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
        if (now - due > period) {
          stats.late += 1;
          if (o.enforceOverrun) blameLate(now, period);
          // A browser cannot say whose fault a late timer is. Up to a tenth of a second late (two periods, if that
          // is longer) it catches up as the server does: a 20-tick room on a timer every 70 ms, or a 60-tick room on
          // one every 37 ms, runs at its rate. Later than that its clock runs slow, and a slow host yields.
          else if (now - due > Math.max(2 * period, 100)) { base = { ms: now - period, tick: core.tick }; publishRebase(now); }
        }
        // Blamed since its last tick began: a run of slow ticks begins (when the tick blamed did), or goes on.
        if (blamed) { if (overSince === null) { overSince = lastStart; overTicks = 0; overBlamed = 0; } overBlamed += 1; }
        blamed = false;
        if (overSince !== null) {
          overTicks += 1;
          if (2 * overBlamed < overTicks) overSince = null;
          // A room whose ticks have run slow for five seconds of the clock ends, and the log names the handler that used the most units.
          else if (now - overSince >= OVERRUN_MS) { end('overrun', { worst: core.stats.worst, maxUnits: core.stats.maxUnits, seconds: Math.round((now - overSince) / 100) / 10 }); return; }
        }
        if (o.enforceOverrun) recent.push({ who: self, at: now });
        if (recent.length > 8) recent.shift();
        lastStart = now;
        tick(now);
        n += 1;
      }
      // Far behind (the isolate was busy, or the machine slept): the clock runs slow. It never jumps to catch up.
      // The tick after a slip starts on time by the new clock, so the tick that ran last is judged here, before the slip hides it.
      if (running && o.clock.now() - dueOf(core.tick + 1) > 4 * period) { const now = o.clock.now(); if (o.enforceOverrun) blameLate(now, period); base = { ms: now, tick: core.tick }; stats.slips += 1; publishRebase(now); }
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
      base = { ms: o.clock.now() + (firstTick ? o.startDelayMs ?? 0 : 0), tick: core.tick };
      overSince = null; blamed = false; failingSince = null; lastStart = base.ms;
      const caps = c.kinds.some((k) => k.think) ? ['skill'] : [];
      if (c.kinds.some((k) => k.guide && k.think)) caps.push('agents');
      if (caps.length) o.send({ t: 'caps', caps });
      if (saved) { handle([core.round()], base.ms); }
      log({ ev: 'host-start', game: o.game, tick: core.tick, epoch, tickHz });
    } catch (error) { fault('start', error); } finally { keepTime(); }
  }
  function pause(): void {
    if (!running) return;
    running = false; paused = true;
    // A pending timer would keep the object in memory and billed: the pause clears it.
    disarm();
    log({ ev: 'host-pause', game: o.game, tick: core.tick });
    try { checkpoint(true); o.onPause?.(); } catch (error) { fault('onPause', error); }
  }
  function resume(): void {
    if (running || ended || !paused) return;
    running = true; paused = false;
    try {
      // The room resumes at the tick it paused on: no tick is skipped and no timer fires for the gap.
      base = { ms: o.clock.now() + (firstTick ? o.startDelayMs ?? 0 : 0), tick: core.tick };
      overSince = null; blamed = false; failingSince = null; lastStart = base.ms;
      handle([core.round()], base.ms);
      for (const q of queues.values()) q.lastFrameTick = core.tick;
      log({ ev: 'host-resume', game: o.game, tick: core.tick });
      o.onResume?.();
    } catch (error) { fault('resume', error); } finally { keepTime(); }
  }
  /** What a relay keeps for whoever joins next, said again: the round with its results, the roster, the shared state, the capabilities. */
  function announce(): void {
    if (ended) return;
    try {
      const caps = c.kinds.some((k) => k.think) ? ['skill'] : [];
      if (c.kinds.some((k) => k.guide && k.think)) caps.push('agents');
      if (caps.length) o.send({ t: 'caps', caps });
      rosterText = '';
      handle([core.round()], o.clock.now());
      o.send({ t: 'state', k: 'shared', d: core.shared() });
    } catch (error) { fault('announce', error); }
  }
  function stop(): void {
    running = false; paused = false; ended = true;
    disarm();
    agents?.stop();
    for (let i = recent.length - 1; i >= 0; i -= 1) if (recent[i].who === self) recent.splice(i, 1);
  }
  function end(why: string, facts: Record<string, unknown>): void {
    if (ended) return;
    // Stopped first: whatever the log or the caller's `onEnd` do, the room is over and holds no timer.
    stop();
    log({ ev: 'host-ended', game: o.game, ...(o.build ? { build: o.build } : {}), why, tick: core.tick, ...facts });
    try { o.onEnd?.(why, facts); } catch (error) { fault('onEnd', error); }
  }

  function save(): Uint8Array {
    return toBytes({ v: 1, core: core.save(), guideViews: [...guideViews], ...(agents ? { agents: agents.save() } : savedAgents ? { agents: savedAgents } : {}), names: [...names].filter(([seat]) => !core.bodies().some(b => b.seat === seat && b.owner === 'reserved')), queues: [...queues].map(([seat, q]) => [seat, q.held, q.claim, q.newest, q.ack]), inputs: [...queues] });
  }
  function checkpoint(force = false): void {
    const seconds = c.settings.durability.movementSeconds;
    // Catch-up ticks can cover a second of play in less than a second of wall time. Bound both clocks.
    if (!o.store || !force && (core.tick === saveTick || o.clock.now() - lastSaveAt < seconds * 1000 && core.tick - saveTick < seconds * tickHz)) return;
    if (o.clock.now() < retrySaveAt) return;
    try { o.store.save(save()); }
    catch (error) {
      saveFailures += 1;
      retrySaveAt = o.clock.now() + Math.min(60_000, 1000 * 2 ** Math.min(saveFailures - 1, 6));
      log({ ev: 'persist-failed', game: o.game, build: o.build, error: thrown(error), retryAt: retrySaveAt });
      return;
    }
    saveFailures = 0; retrySaveAt = 0;
    saveTick = core.tick; lastSaveAt = o.clock.now(); forceSave = false;
  }

  return {
    get privateDelivery() { return c.kinds.some(k => k.collider || k.fields.some(([,f]) => f.visibility)); },
    projectSnapshot(snap, seat) {
      return {...snap,d:[snap.d[0],snap.d[1].map((row: any[]) => {
        const k=c.kinds[row[1]], own=seat!==null && row[9]===seat && row[10]!==1;
        if(!k.fields.some(([,f])=>f.visibility))return row;
        const fields=row[7].map((v: unknown,i: number)=>{const visibility=k.fields[i][1].visibility;return !visibility || visibility==='owner'&&own || visibility==='results'&&snap.d[0][1]===0 ? v : null;});
        return [...row.slice(0,7),fields,...row.slice(8)];
      }),...snap.d.slice(2)]};
    },
    get viewSettings() { return c.settings.view; },
    get viewRadiusM() { return c.settings.view?.radiusM ?? null; },
    get tick() { return core.tick; },
    get epoch() { return epoch; },
    get running() { return running; },
    get paused() { return paused; },
    get people() { return people(); },
    frame, start, pause, resume, stop, announce,
    tickNow: () => {
      if (ended) return;
      let now = lastStart;
      try { now = o.clock.now(); tick(now); } catch (error) { fault('tickNow', error); } finally { keepTime(); }
    },
    save,
    facts: () => ({ tick: core.tick, epoch, running, paused, ended, armed, people: people(), tickHz, ...stats, core: { ...core.stats } }),
    core,
  };
}

/** An owner-moved body's claim as an `in` entry carries it, after the input fields: nine numbers (for callers that build frames by hand: the bot client, the tests). */
export const claimOf = (p: Vec3, v: Vec3, h: Vec3): number[] => [p.x, p.y, p.z, v.x, v.y, v.z, h.x, h.y, h.z];
