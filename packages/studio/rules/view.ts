/*
 * view.ts — what a rules game's view imports: the room, as a browser sees it.
 * =============================================================================
 *
 *   import { openRoom } from '@homie-rocks/studio/rules/view';
 *   import type rules from './rules';
 *   const room = openRoom<typeof rules>();
 *
 * A game is rules plus view. The rules run on the server; the view draws what it is told and sends what the player
 * presses. `openRoom` starts the netplay helper (netplay/netplay.ts), joins the room the play page names and returns
 * at once: `room.status` moves from `connecting` to `playing`. The rules are imported for their types only, so none
 * of their code is in the view's bundle; the build hands this library their declarations as data (`setGame`), and it
 * unpacks every frame from them. A view never packs or unpacks state.
 *
 *   room.me                 the player's own body
 *   room.each(kind, fn)     every entity of a kind, interpolated to render time
 *   room.on(name, fn)       an effect by its name, or 'enter', 'leave', 'placed', 'round', 'status', 'say'
 *   room.input(sample)      what the player holds and presses, as the kind's declared input fields
 *   room.command(name, data)  a reliable one-shot request to the player's own body
 *   room.round, room.roster, room.shared, room.seat, room.status
 *
 * THE OWN BODY. In this release a player's body moves as it does today: this browser runs the game's `move` code
 * (the same guarded module the server runs) on its own copy of the room's clock and says where its body is; the
 * server holds each claim to the body's top speed (`body: { move: 'owner' }` in the rules). The stick therefore answers
 * on the next drawn frame. Everything the rules decide (score, pickups, rounds, where a body is placed) comes from the
 * server and cannot be changed from here. A later release has the server move every body and this library predict.
 *
 * THE CLOCK AND THE INPUT (rooms-milestone-1-design.md, sections 4.4 and 6.1). Input is one step a tick, stamped with
 * its tick. This browser steps a little ahead of the server so an entry arrives before its tick runs, and holds that
 * lead from the `lead` figure in each snapshot. A step whose sample or claim changed makes an entry; a period with no
 * entry sends nothing; after 250 ms of nothing the held values are sent again; a hidden tab sends one neutral entry
 * and stops stepping.
 *
 * Chat, votes, the arrival screen, owner controls and the page around the game stay with the helper (`room.net`) and
 * the shell, as today.
 * =============================================================================
 */
import type { useAgents, Vocabulary, AskButton } from '../agents/agents.ts';
let agentFactory: typeof useAgents | null = null;
export function setAgentFactory(factory: typeof useAgents): void { agentFactory = factory; }
import { createNetplay } from '../netplay/netplay.ts';
import type { Netplay, NetplayOptions, RoundInfo, Snapshot, StepEntry } from '../netplay/netplay.ts';
import { exposePort } from '../port/probe.ts';
import { BudgetError, G, brand } from './guard.ts';
import { math, sweepMap } from './math.ts';
import { coerce, coerceFields, dir, num, thawFields, unpackEntity, unpackFields, unpackVec, vec3 } from './pack.ts';
import type { Unpacked } from './pack.ts';
import type { FieldList, MoveFn, Schema, Vec3 } from './rules.ts';

/** What the build hands the view library for one game: its declarations, its public tunables and its map. No code. */
export interface GameData { vocab?: Vocabulary; id: string; schema: Schema; tune: Record<string, unknown>; map: { name?: string; bounds: { min: unknown; max: unknown }; boxes?: unknown[]; circles?: unknown[]; spots?: Record<string, unknown[]> } }
let current: { game: GameData; move: Record<string, MoveFn> } | null = null;
/** Called by the build's own two lines at the top of a view's bundle, before the view's code runs. */
export function setGame(game: GameData, move: Record<string, MoveFn> = {}): void { current = { game, move }; }

/** An entity as a view reads it: the built-in fields, the kind's declared fields by name, and its `motion`. */
export interface Entity {
  readonly id: string; readonly kind: string; readonly pos: Vec3; readonly vel: Vec3; readonly heading: Vec3; readonly grounded: boolean;
  readonly seat?: number; readonly owner?: string; readonly driver?: string; readonly away?: boolean; readonly goal?: unknown;
  /** This is the player's own body. */
  readonly mine?: boolean;
  readonly motion: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}
export type RoomStatus = 'connecting' | 'playing' | 'offline' | 'closed';
export interface RoomRound { n: number; phase: 'live' | 'over'; endsAt: number; secondsLeft: number; results?: RoundInfo['results'] }
export interface RosterRow { seat: number; name: string; driver: 'person' | 'bot' | 'ai'; score: number; me: boolean }
export interface OpenRoomOptions { game?: GameData; move?: Record<string, MoveFn>; net?: NetplayOptions; /** Tests: a clock in ms and a way to run without timers. */ now?: () => number; timers?: boolean }
export interface Room<R = unknown> {
  readonly status: RoomStatus;
  readonly seat: number | null;
  readonly me: Entity | null;
  each(kind: string, fn: (e: Entity) => void): void;
  get(id: string): Entity | null;
  on(name: string, fn: (e: any) => void): () => void;
  readonly shared: Readonly<Record<string, unknown>>;
  input(sample: Record<string, number | boolean>): void;
  command(name: string, data?: Record<string, unknown>): void;
  readonly round: RoomRound | null;
  readonly roster: RosterRow[];
  /** A watcher: follow one entity's seat (or null for the whole room). */
  follow(id: string | null): void;
  /** Extra values for the testing tools' receipts (`window.__homiePort`). */
  probe(extra: Record<string, () => unknown>): void;
  /** A guide's ask buttons and a person's ask (today's relay frames; guides are driven by the server in a later release). */
  ask(id: string, askId: string, args?: Record<string, unknown>): void;
  askButtons(id: string, offer?: Record<string, unknown>): AskButton[];
  readonly tune: Readonly<Record<string, unknown>>;
  /** The game's static map: its edges, its solid shapes and its named spots, in metres. */
  readonly map: { readonly bounds: { min: Vec3; max: Vec3 }; readonly boxes: readonly { min: Vec3; max: Vec3 }[]; readonly circles: readonly { at: Vec3; r: number }[]; readonly spots: Readonly<Record<string, readonly Vec3[]>> };
  readonly net: Netplay;
  /** Run the room's clock up to now (called by itself on a timer and whenever the view reads the room). */
  pump(): void;
  close(): void;
  /** Present only for the types: the rules this room runs. */
  readonly __rules?: R;
}

interface Frame { k: number; e: number; at: number; round: [number, number, number]; ents: Map<string, Unpacked>; rows: number[][] }
const frames = new WeakMap<object, Frame | null>();
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function openRoom<R = unknown>(opts: OpenRoomOptions = {}): Room<R> {
  const game = opts.game ?? current?.game;
  const moves = opts.move ?? current?.move ?? {};
  if (!game) throw new Error('openRoom() found no game: a rules game\'s view is built by `homie-studio build`, which hands it the game\'s declarations');
  const schema = game.schema;
  const dims = schema.dims;
  const tickHz = schema.settings.tickHz;
  const period = 1000 / tickHz;
  const sendEvery = Math.ceil(tickHz / Math.max(1, schema.settings.inputHz));
  const clock = opts.now ?? ((): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const net = createNetplay<unknown, unknown, unknown>({ game: game.id, maxPlayers: schema.seats, snapshotHz: tickHz, ...opts.net, rules: true });
  const agents = game.vocab && agentFactory ? agentFactory(net, game.vocab, { roles: ['guide', 'party'], view: () => ({}), manual: true }) : null;
  const kindOf = new Map(schema.kinds.map((k) => [k.name, k]));
  const listeners = new Map<string, Set<(e: any) => void>>();
  const emit = (name: string, e: unknown): void => { for (const fn of listeners.get(name) ?? []) { try { fn(e); } catch (err) { console.warn(`[room] on('${name}')`, err); } } };
  const vecOf = (a: unknown): Vec3 => { const p = Array.isArray(a) ? { x: a[0], y: a[1], z: a[2] ?? 0 } : a; return vec3(p, dims); };
  const map = { bounds: { min: vecOf(game.map.bounds.min), max: vecOf(game.map.bounds.max) }, boxes: (game.map.boxes ?? []).map((b: any) => ({ min: vecOf(b.min), max: vecOf(b.max) })), circles: (game.map.circles ?? []).map((c: any) => ({ at: vecOf(c.at), r: Number(c.r) })) };
  const spots: Record<string, readonly Vec3[]> = {};
  for (const [key, list] of Object.entries(game.map.spots ?? {})) spots[key] = Object.freeze(list.map(vecOf));
  const tune = Object.freeze({ ...game.tune });

  let status: RoomStatus = 'connecting';
  let latest: Frame | null = null;
  let epoch = 0;
  let round: RoomRound | null = null;
  let results: RoundInfo['results'] | undefined;
  let closed = false;
  const fxQueue: { tick: number; name: string; at: unknown; data: Record<string, unknown> }[] = [];
  const setStatus = (s: RoomStatus): void => { if (s !== status) { status = s; emit('status', s); } };

  /* ---------------------------------------------------------------- frames in */

  function frameOf(s: Snapshot<unknown> | null): Frame | null {
    if (!s || typeof s !== 'object') return null;
    if (frames.has(s)) return frames.get(s) ?? null;
    let f: Frame | null = null;
    const d = s.d as [unknown, unknown] | null;
    if (Array.isArray(d) && Array.isArray(d[0]) && Array.isArray(d[1])) {
      const ents = new Map<string, Unpacked>();
      for (const w of d[1] as unknown[]) { const e = unpackEntity(schema.kinds, w, dims); if (e) ents.set(e.id, e); }
      f = { k: s.k, e: Number(s.e) >>> 0, at: clock(), round: [Number(d[0][0]) || 0, Number(d[0][1]) || 0, Number(d[0][2]) || 0], ents, rows: (Array.isArray(s.c) ? s.c : []) as unknown as number[][] };
    }
    frames.set(s, f);
    return f;
  }
  const entityOf = (u: Unpacked, mine = false): Entity => Object.freeze({ id: u.id, kind: u.kind, pos: u.pos, vel: u.vel, heading: u.heading, grounded: u.grounded, ...(u.seat !== undefined ? { seat: u.seat, owner: u.owner, driver: u.driver, away: u.away, goal: u.goal } : {}), ...(mine ? { mine: true } : {}), ...u.fields, motion: Object.freeze({ ...u.motion }) }) as Entity;

  /* ---------------------------------------------------------------- the own body, on this browser's copy of the clock */

  interface Mine { id: string; kind: string; r: number; pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; motion: Record<string, unknown> }
  let mine: Mine | null = null;
  /** The clock: the room tick this browser is on at `at` (ms), and the newest step it has run. */
  let base: { tick: number; at: number } | null = null;
  let stepped = 0;
  const leads: number[] = [];
  /** What the player holds, the presses since the last step, what the server was last told, and the entries of this send period. */
  let sample: Record<string, unknown> = {};
  let pressed = new Set<string>();
  let lastSent = '';
  let lastSendAt = 0;
  let entries: { t: number; row: number[] }[] = [];
  let hiddenSent = false;
  const TARGET_LEAD = 1;
  const myKind = (): (typeof schema.kinds)[number] | null => (mine ? kindOf.get(mine.kind) ?? null : null);
  const tickAt = (now: number): number => (base ? base.tick + (now - base.at) / period : 0);
  /** The tick `move` is being run for: the step just taken, or the one after it while the own body is drawn between ticks. */
  let moveTick = 0;
  const moveCtx = brand(Object.freeze({
    get tick() { return moveTick; }, dt: 1 / tickHz, tune, math,
    // As the server's `ctx.ticks` reads it: a plain number, or nothing.
    ticks: (seconds: unknown): number => { const s = num(seconds); const n = Math.round(s * tickHz); return s > 0 && Number.isFinite(n) ? Math.max(1, n) : 0; },
    map: brand(Object.freeze({ name: game.map.name ?? 'main', spot: (name: string) => spots[name]?.[0], spots: (name: string) => spots[name] ?? Object.freeze([]), sweep: (body: any, delta: unknown) => sweepMap(map, body, delta, myKind()?.radius ?? 0, dims) })),
  }));
  function rebase(k: number): void {
    const rtt = net.stats().rtt ?? 100;
    base = { tick: k + Math.ceil(rtt / period + TARGET_LEAD) + sendEvery - 1, at: clock() };
    stepped = Math.floor(base.tick) - 1;
    entries = []; lastSent = ''; leads.length = 0; pressed = new Set();
  }
  /** `motion` as this browser's own `move` may change it in place: what a snapshot carries is frozen, so every list, map and struct in it is copied. */
  const motionOf = (kindName: string, motion: Record<string, unknown>): Record<string, unknown> => thawFields(kindOf.get(kindName)?.motion ?? [], motion);
  function adopt(u: Unpacked): void {
    mine = { id: u.id, kind: u.kind, r: u.r, pos: u.pos, vel: u.vel, heading: u.heading, grounded: u.grounded, motion: motionOf(u.kind, u.motion) };
    lastSent = '';
  }
  /** The game's guarded `move` for one tick, counted as the server counts it, with the result rounded as the server rounds it. */
  function runMove(kindName: string, body: { pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; motion: Record<string, unknown> }, input: Readonly<Record<string, unknown>>, t: number): typeof body {
    const fn = moves[kindName];
    if (!fn) return body;
    moveTick = t;
    G.left = Math.max(1, Math.floor(schema.settings.budget.tick / 4));
    try { fn(body, input, moveCtx); } catch (err) { if (!(err instanceof BudgetError)) console.warn('[room] move', err); }
    G.left = Infinity;
    // Rounded to 32-bit floats and held to the declared shapes, as the server does it: both hold the same numbers.
    const list = kindOf.get(kindName)?.motion ?? [];
    return { pos: vec3(body.pos, dims), vel: vec3(body.vel, dims), heading: dir(body.heading, dims), grounded: body.grounded === true, motion: thawFields(list, coerceFields(list, body.motion, dims)) };
  }
  /** The input values the last step held (a press is never held). */
  let held: Readonly<Record<string, unknown>> = Object.freeze({});
  /** One step of the own body on tick `t`: the input step, `move`, and an entry when the sample or the claim changed. */
  function step(t: number): void {
    const kind = myKind();
    if (!mine || !kind) return;
    const values: number[] = [];
    const input: Record<string, unknown> = {};
    let press = false;
    for (const [name, fd] of kind.input) {
      if (fd.t === 'press') { const on = pressed.has(name); input[name] = on; values.push(on ? 1 : 0); if (on) press = true; } else { const v = coerce(fd, sample[name] ?? fd.init, dims); input[name] = v; values.push(v === true ? 1 : v === false ? 0 : v as number); }
    }
    pressed = new Set();
    held = Object.freeze({ ...input });
    if (kind.owner) {
      const body = runMove(kind.name, { pos: mine.pos, vel: mine.vel, heading: mine.heading, grounded: mine.grounded, motion: mine.motion }, held, t);
      mine.pos = body.pos; mine.vel = body.vel; mine.heading = body.heading; mine.grounded = body.grounded; mine.motion = body.motion;
    }
    const claim = kind.owner ? [mine.pos.x, mine.pos.y, mine.pos.z, mine.vel.x, mine.vel.y, mine.vel.z, mine.heading.x, mine.heading.y, mine.heading.z] : [];
    const sig = JSON.stringify([values, claim]);
    if (sig !== lastSent || press) { entries.push({ t, row: [...values, ...claim] }); lastSent = sig; }
  }
  /**
   * The end of a send period (`sendEvery` ticks, counted from tick 0): one frame with the entries made in it, `k` the
   * period's first tick. A period with no entry sends nothing; after 250 ms without a frame the held values are sent
   * again as an ordinary entry on the current tick.
   */
  function flush(now: number, t: number): void {
    if (!mine) { entries = []; return; }
    if (!entries.length && now - lastSendAt >= 250) keepalive(t);
    if (!entries.length) return;
    const k = Math.min(entries[0].t, t - (t % sendEvery));
    const rows: StepEntry[] = entries.map((e) => [e.t - k, ...e.row]);
    entries = [];
    if (net.steps(epoch, k, rows, mine.r)) lastSendAt = now;
  }
  /** The held values as an entry on tick `t`, without stepping the body again. */
  function keepalive(t: number): void {
    const kind = myKind();
    if (!mine || !kind) return;
    const values = kind.input.map(([name, fd]) => (fd.t === 'press' ? 0 : Number(coerce(fd, sample[name] ?? fd.init, dims))));
    const claim = kind.owner ? [mine.pos.x, mine.pos.y, mine.pos.z, mine.vel.x, mine.vel.y, mine.vel.z, mine.heading.x, mine.heading.y, mine.heading.z] : [];
    entries = [{ t, row: [...values, ...claim] }]; lastSent = JSON.stringify([values, claim]);
  }
  function pump(): void {
    if (closed) return;
    if (net.offline) setStatus(net.closedWhy ? 'closed' : 'offline');
    const now = clock();
    const hidden = typeof document !== 'undefined' && document.hidden === true;
    // Effects play for everyone who draws the room: a watcher has no body and still sees them.
    fire();
    if (!mine || !base || net.seat === null || !net.connected) return;
    if (hidden) {
      // A hidden tab's timers are too slow to keep input alive, and a body must not run on without its player:
      // one neutral entry at once (every field at its init, no press), then no more steps until the tab shows again.
      if (!hiddenSent) { hiddenSent = true; sample = {}; pressed = new Set(); const t = Math.floor(tickAt(now)) + 1; keepalive(t); lastSendAt = 0; flush(now, t); }
      base = null;
      return;
    }
    hiddenSent = false;
    let t = Math.floor(tickAt(now));
    // A frame longer than a quarter of a second: set the clock again from the newest snapshot and carry on from there.
    if (t - stepped > Math.ceil(tickHz / 4) && latest) { rebase(latest.k); t = Math.floor(tickAt(now)); }
    while (stepped < t) {
      stepped += 1;
      step(stepped);
      if (stepped % sendEvery === sendEvery - 1) flush(now, stepped);
    }
  }

  function onSnapshot(s: Snapshot<unknown>): void {
    const f = frameOf(s);
    if (!f) return;
    const before = latest;
    latest = f;
    const changedEpoch = f.e !== epoch;
    epoch = f.e;
    const seat = net.seat;
    let me: Unpacked | null = null;
    if (seat !== null) for (const u of f.ents.values()) if (u.seat === seat && u.driver !== 'bot') { me = u; break; }
    if (me) {
      // The server placed the body (a spawn, a round reset, a seat taken over), or the room began again: jump there.
      const placed = !mine || mine.id !== me.id || mine.r !== me.r || changedEpoch;
      if (placed) { adopt(me); emit('placed', entityOf(me, true)); }
      else if (mine) { mine.motion = motionOf(me.kind, me.motion); if (!kindOf.get(me.kind)?.owner) { mine.pos = me.pos; mine.vel = me.vel; mine.heading = me.heading; mine.grounded = me.grounded; } }
      if (!base || changedEpoch) rebase(f.k);
      const row = f.rows.find((x) => x[0] === seat);
      if (row && row[3] !== -128 && base) {
        // Hold the lead: the median of the last 8, nudged by at most a twentieth of a tick a snapshot; far off, set the clock again.
        leads.push(row[3] / 16); if (leads.length > 8) leads.shift();
        const med = [...leads].sort((a, b) => a - b)[Math.floor(leads.length / 2)];
        if (Math.abs(med - TARGET_LEAD) > 4) rebase(f.k); else base.tick += Math.max(-0.05, Math.min(0.05, (TARGET_LEAD - med) * 0.1));
      }
    } else mine = null;
    if (before) {
      for (const [id, u] of f.ents) { const old = before.ents.get(id); if (!old) emit('enter', entityOf(u)); else if (old.r !== u.r && id !== mine?.id) emit('placed', entityOf(u)); }
      for (const [id, u] of before.ents) if (!f.ents.has(id)) emit('leave', entityOf(u));
    } else for (const u of f.ents.values()) emit('enter', entityOf(u));
    const phase = f.round[1] === 1 ? 'live' : 'over';
    if (!round || round.n !== f.round[0] || round.phase !== phase) {
      if (phase === 'live') results = undefined;
      round = { n: f.round[0], phase, endsAt: f.round[2], secondsLeft: 0, ...(results ? { results } : {}) };
      emit('round', roundNow());
    } else round.endsAt = f.round[2];
    setStatus(seat === null || me ? 'playing' : status);
  }
  function roundNow(): RoomRound | null {
    if (!round || !latest) return null;
    // The room's clock now, from the newest snapshot: a view never turns a tick into time itself.
    const serverTick = latest.k + (net.connected ? (clock() - latest.at) / period : 0);
    return { ...round, secondsLeft: round.endsAt ? Math.max(0, (round.endsAt - serverTick) / tickHz) : Infinity, ...(results ? { results } : {}) };
  }
  /** Effects wait for the tick they were emitted on to be drawn (an effect on the player's own body plays at once). */
  function fire(): void {
    if (!fxQueue.length) return;
    const s = net.sample();
    const drawn = s ? lerp(s.a.k, s.b.k, s.alpha) : latest ? latest.k : 0;
    while (fxQueue.length && (fxQueue[0].tick <= drawn || fxQueue[0].at === mine?.id || fxQueue.length > 128)) {
      const x = fxQueue.shift() as (typeof fxQueue)[number];
      const id = typeof x.at === 'string' ? x.at : null;
      const where = id ? get(id)?.pos ?? null : unpackVec(x.at, dims);
      emit(x.name, Object.freeze({ ...x.data, at: where, ...(id ? { id } : {}), tick: x.tick }));
    }
  }

  net.on('snapshot', onSnapshot);
  net.on('role', (e) => { if (e.snap) onSnapshot(e.snap); if (net.offline) setStatus(net.closedWhy ? 'closed' : 'offline'); });
  net.on('link', (e) => {
    if (e.state === 'online') { base = null; if (status !== 'playing') setStatus('connecting'); } else if (e.state === 'closed') setStatus('closed'); else if (e.state === 'alone' || e.state === 'offline') setStatus('offline');
  });
  net.on('round', (r) => { if (r.results) { results = r.results; if (round) { round = { ...round, results }; emit('round', roundNow()); } } });
  net.on('event', (e) => {
    if (e.k === 'fx' && Array.isArray(e.d)) {
      const [tick, list] = e.d as [number, [number, unknown, unknown][]];
      for (const [i, at, data] of Array.isArray(list) ? list : []) { const name = schema.effectNames[i]; if (name) fxQueue.push({ tick: Number(tick) || 0, name, at, data: unpackFields(schema.effects[name] as FieldList, data, dims) }); }
      return;
    }
    // A player's speech and emotes, and a guide's lines and goals, as the relay carries them today.
    if (/^(?:say|chat|emote)/i.test(e.k) && !(agents && (e.d as { ai?: boolean })?.ai)) emit('say', { kind: e.k, seat: e.from, ...(e.d && typeof e.d === 'object' ? e.d as object : { text: e.d }) });
    else if (e.k === 'agent:goal' && e.from === net.host?.seat) emit('goal', e.d);
    else if (e.k === 'agent:ask' && e.from === net.host?.seat) emit('ask', e.d);
    else if (/^ask:/.test(e.k)) emit('ask', { ask: e.k.slice(4), ...(e.d && typeof e.d === 'object' ? e.d as object : {}) });
  });

  agents?.on('say', (e) => emit('say', e));

  /* ---------------------------------------------------------------- what the view reads */

  /**
   * The own body between ticks (section 6.3 of the design): the body as of the last whole step, and `move` run once
   * more on a copy for the whole next tick with the input as it is right now. What is drawn is the point between
   * the two, by how much of the tick has passed, and the copy is thrown away. So the stick answers on the next
   * drawn frame, not on the next tick.
   */
  function meNow(): Entity | null {
    if (!mine || !latest) return null;
    const server = latest.ents.get(mine.id);
    if (!server) return null;
    const kind = kindOf.get(mine.kind);
    let pos = mine.pos;
    let heading = mine.heading;
    if (kind?.owner && base) {
      const a = Math.max(0, Math.min(1, tickAt(clock()) - stepped));
      const now: Record<string, unknown> = {};
      for (const [name, fd] of kind.input) now[name] = fd.t === 'press' ? pressed.has(name) : coerce(fd, sample[name] ?? fd.init, dims);
      const next = runMove(kind.name, { pos: mine.pos, vel: mine.vel, heading: mine.heading, grounded: mine.grounded, motion: motionOf(mine.kind, mine.motion) }, Object.freeze(now), stepped + 1);
      pos = vec3({ x: lerp(mine.pos.x, next.pos.x, a), y: lerp(mine.pos.y, next.pos.y, a), z: lerp(mine.pos.z, next.pos.z, a) }, dims);
      heading = next.heading;
    }
    return entityOf({ ...server, pos, vel: mine.vel, heading, grounded: mine.grounded, motion: mine.motion }, true);
  }
  function drawn(id: string): Entity | null {
    if (mine && id === mine.id) return meNow();
    const s = net.sample();
    const a = s ? frameOf(s.a) : latest;
    const b = s ? frameOf(s.b) : latest;
    const ea = a?.ents.get(id); const eb = b?.ents.get(id);
    if (!ea || !eb) return ea ? entityOf(ea) : eb && s && s.alpha >= 1 ? entityOf(eb) : eb && !a?.ents.size ? entityOf(eb) : null;
    // A placed body jumps: nobody's view glides across a placement.
    if (ea.r !== eb.r || !s) return entityOf(eb);
    const t = s.alpha;
    const h = dir({ x: lerp(ea.heading.x, eb.heading.x, t), y: lerp(ea.heading.y, eb.heading.y, t), z: lerp(ea.heading.z, eb.heading.z, t) }, dims);
    return entityOf({ ...eb, pos: vec3({ x: lerp(ea.pos.x, eb.pos.x, t), y: lerp(ea.pos.y, eb.pos.y, t), z: lerp(ea.pos.z, eb.pos.z, t) }, dims), vel: eb.vel, heading: h });
  }
  function get(id: string): Entity | null { return drawn(id); }
  function each(kind: string, fn: (e: Entity) => void): void {
    pump();
    const s = net.sample();
    const a = s ? frameOf(s.a) : latest;
    const b = s ? frameOf(s.b) : latest;
    const ids = new Set<string>();
    // Until the newer snapshot is reached, what the older one holds is still drawn; what only the newer one holds waits for it.
    for (const f of [a, s && s.alpha >= 1 ? b : null, a ? null : b]) if (f) for (const u of f.ents.values()) if (u.kind === kind) ids.add(u.id);
    if (mine && mine.kind === kind) ids.add(mine.id);
    for (const id of ids) { const e = drawn(id); if (e) fn(e); }
  }
  function roster(): RosterRow[] {
    const scores = new Map<number, number>();
    if (latest) for (const u of latest.ents.values()) { const k = kindOf.get(u.kind); if (u.seat !== undefined && k?.score) scores.set(u.seat, Number(u.fields[k.score]) || 0); }
    return (net.slots ?? []).map((sl) => ({ seat: sl.slot, name: sl.name, driver: sl.agent ? 'ai' as const : sl.bot ? 'bot' as const : 'person' as const, score: scores.get(sl.slot) ?? 0, me: sl.seat !== null && sl.seat === net.seat }));
  }
  let extra: Record<string, () => unknown> = {};
  const myScore = (): number | null => { const k = myKind(); const u = mine && latest ? latest.ents.get(mine.id) : null; return k?.score && u ? Number(u.fields[k.score]) || 0 : null; };
  const busy = (): boolean => status !== 'playing' || !mine || latest?.ents.get(mine.id)?.away === true;
  // The probes the testing tools read (`check`, `shoot`, `perf`, the playtest judge): the same two objects a game written the old way publishes.
  net.expose({
    self: () => { const m = meNow(); return m ? { x: m.pos.x, y: m.pos.y, z: m.pos.z } : null; },
    peer: (seat: number) => { if (!latest) return null; for (const u of latest.ents.values()) if (u.seat === seat) return { x: u.pos.x, y: u.pos.y, z: u.pos.z }; return null; },
    scores: () => roster().map((r) => ({ seat: r.seat, score: r.score })),
    score: myScore, tick: () => latest?.k ?? 0, epoch: () => epoch, hosted: () => 'server', status: () => status,
  });
  if (typeof window !== 'undefined') {
    exposePort(net as Netplay<unknown, unknown, unknown>, {
      view: 'top', size: schema.kinds.find((k) => k.player)?.radius ?? 0.5,
      self: () => { const m = meNow(); return m ? { x: m.pos.x, y: -m.pos.y } : null; },
      score: myScore, busy: () => (typeof extra.busy === 'function' ? Boolean(extra.busy()) : busy()),
      extra: new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? extra[key] : undefined), ownKeys: () => Object.keys(extra), getOwnPropertyDescriptor: (_t, key) => (typeof key === 'string' && extra[key] ? { enumerable: true, configurable: true, value: extra[key] } : undefined) }) as Record<string, () => unknown>,
    });
  }
  const timer = opts.timers === false ? null : setInterval(pump, Math.max(8, period / 2));
  const onShow = (): void => { if (typeof document !== 'undefined' && !document.hidden) { base = null; if (latest) rebase(latest.k); } };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);

  return {
    get status() { return status; },
    get seat() { return net.seat; },
    get me() { pump(); return meNow(); },
    each, get,
    on(name, fn) { let set = listeners.get(name); if (!set) { set = new Set(); listeners.set(name, set); } set.add(fn); return () => { set?.delete(fn); }; },
    get shared() { return Object.freeze(unpackFields(schema.shared, net.stateOf('shared'), dims)); },
    input(s) {
      const kind = myKind() ?? schema.kinds.find((k) => k.player) ?? null;
      const next: Record<string, unknown> = {};
      for (const [name, fd] of kind?.input ?? []) { if (fd.t === 'press') { if (s[name] === true || s[name] === 1) pressed.add(name); } else if (s[name] !== undefined) next[name] = s[name]; }
      sample = next;
    },
    command(name, data = {}) { if (schema.commands[name]) net.send('cmd', [name, data]); else console.warn(`[room] no command "${name}" is declared in shapes.commands`); },
    get round() { return roundNow(); },
    get roster() { return roster(); },
    follow(id) { const e = id ? latest?.ents.get(id) : null; net.follow(e && e.seat !== undefined ? e.seat : null); },
    probe(x) { extra = { ...extra, ...x }; },
    ask(id, askId, args = {}) { const e = latest?.ents.get(id); if (e && e.seat !== undefined) agents?.ask(e.seat, askId, args); },
    askButtons(id, offer = {}) { const e = latest?.ents.get(id); return e && e.seat !== undefined ? agents?.askButtons(e.seat, offer) ?? [] : []; },
    tune, map: Object.freeze({ ...map, spots: Object.freeze(spots) }), net: net as Netplay,
    pump,
    close() { closed = true; if (timer) clearInterval(timer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow); agents?.stop(); net.close(); setStatus('closed'); },
  };
}
