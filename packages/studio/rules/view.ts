import { snapshotDecoder } from './interest.mjs';
import { collisionMap, revisionAt, type CollisionRevision } from './live.ts';
import { rulesOutput } from '../netplay/rules-output.mjs';
import { rulesCaps, rulesRates } from '../worker/limits.mjs';
/*
 * view.ts — what a rules game's view imports: the room, as a browser sees it.
 * =============================================================================
 *
 *   import { openRoom } from '@homie-rocks/studio/rules/view';
 *   import type rules from './rules';
 *   const room = openRoom<typeof rules>();
 *
 * A game is rules plus view. The rules run in one host runtime; the view draws what it is told and sends what the player
 * presses. `openRoom` starts the netplay helper (netplay/netplay.ts), joins the room the play page names and returns
 * at once: `room.status` moves from `connecting` to `playing`. The rules are imported for their types only, so none
 * of their code is imported by the game's view; the build supplies declarations and an optional local host loader, and it
 * unpacks every frame from them. A view never packs or unpacks state.
 *
 *   room.me                 the player's own body
 *   room.each(kind, fn)     every entity of a kind, interpolated to render time
 *   room.on(name, fn)       an effect by its name, or 'enter', 'leave', 'placed', 'round', 'status', 'say'
 *   room.input(sample)      what the player holds and presses, as the kind's declared input fields
 *   room.command(name, data)  a reliable one-shot request to the player's own body
 *   room.round, room.roster, room.shared, room.seat, room.status
 *
 * THE OWN BODY. This browser predicts its own movement with the server's guarded `move` module. Snapshots are
 * authoritative: the view replays pending inputs from each snapshot and eases the visual correction. Large
 * disagreements draw the corrected path at catch-up speed. Scores, pickups and effects come only from the host.
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
import type { Netplay, NetplayOptions, RulesHostFactory, RoundInfo, Snapshot, StepEntry } from '../netplay/netplay.ts';
import { lab } from '../lab/lab.ts';
import { exposePort, type PortProbeOptions } from '../port/probe.ts';
import { BudgetError } from './guard.ts';
import { moveContext } from './math.ts';
import { coerce, dir, stepMove, thawFields, unpackEntity, unpackFields, unpackVec, vec3 } from './pack.ts';
import type { Unpacked } from './pack.ts';
import { compileMap } from './rules.ts';
import type { FieldList, MoveFn, Schema, Vec3 } from './rules.ts';

/** Unit headings take the shortest arc, including an exact half turn. Linear
 * interpolation passes through zero at a half turn and visibly flips a character. */
export function blendHeading(a: Vec3, b: Vec3, t: number, dims: 2 | 3): Vec3 {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  if (dot > 0.9995) return dir({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }, dims);
  if (dot < -0.9995) {
    const side = Math.abs(a.z) < 0.9 ? dir({ x: -a.y, y: a.x, z: 0 }, 3) : dir({ x: a.z, y: 0, z: -a.x }, 3);
    const c = Math.cos(Math.PI * t), s = Math.sin(Math.PI * t);
    return dir({ x: a.x * c + side.x * s, y: a.y * c + side.y * s, z: a.z * c + side.z * s }, dims);
  }
  const angle = Math.acos(dot), scale = Math.sin(angle);
  const from = Math.sin((1 - t) * angle) / scale, to = Math.sin(t * angle) / scale;
  return dir({ x: a.x * from + b.x * to, y: a.y * from + b.y * to, z: a.z * from + b.z * to }, dims);
}

/** What the build hands the view library for one game: its declarations, its public tunables and its map. No code. */
export interface GameData { vocab?: Vocabulary; id: string; schema: Schema; tune: Record<string, unknown>; map: { name?: string; bounds: { min: unknown; max: unknown }; boxes?: unknown[]; circles?: unknown[]; spheres?: unknown[]; capsules?: unknown[]; heightTiles?: unknown[]; spots?: Record<string, unknown[]> } }
let current: { game: GameData; move: Record<string, MoveFn>; load?: () => Promise<RulesHostFactory> } | null = null;
/** Called by the build's own two lines at the top of a view's bundle, before the view's code runs. */
export function setGame(game: GameData, move: Record<string, MoveFn> = {}, load?: () => Promise<RulesHostFactory>): void { current = { game, move, load }; }

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
export interface OpenRoomOptions {
  /** Play a private rules round while an online room has no body for this player. */
  fallback?: 'solo';
  game?: GameData;
  move?: Record<string, MoveFn>;
  net?: NetplayOptions;
  /** Camera axes on the rules' x/y plane for the testing tools. Default: x right, y up. */
  screenBasis?: PortProbeOptions['basis'];
  /** Tests: a clock in ms and a way to run without timers. */
  now?: () => number;
  timers?: boolean;
}
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
  /** A guide's ask buttons and a person's ask, handled by the room's rules host. */
  ask(id: string, askId: string, args?: Record<string, unknown>): void;
  askButtons(id: string, offer?: Record<string, unknown>): AskButton[];
  readonly tune: Readonly<Record<string, unknown>>;
  /** The game's static map: its edges, its solid shapes and its named spots, in metres. */
  readonly map: { readonly bounds: { min: Vec3; max: Vec3 }; readonly boxes: readonly { min: Vec3; max: Vec3 }[]; readonly circles: readonly { at: Vec3; r: number }[]; readonly heightTiles: readonly import('./rules.ts').MapHeightTile[]; readonly spheres: readonly { at: Vec3; r: number }[]; readonly capsules: readonly { at: Vec3; r: number; height: number }[]; readonly spots: Readonly<Record<string, readonly Vec3[]>> };
  readonly net: Netplay;
  /** Run the room's clock up to now (called by itself on a timer and whenever the view reads the room). */
  pump(): void;
  close(): void;
  /** Present only for the types: the rules this room runs. */
  readonly __rules?: R;
}

interface Frame { k: number; e: number; at: number; round: [number, number, number]; ents: Map<string, Unpacked>; rows: number[][]; collision?: CollisionRevision }
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
  const net = createNetplay<unknown, unknown, unknown>({ game: game.id, maxPlayers: schema.seats, snapshotHz: tickHz, interpFloorMs: schema.settings.predict.interpMs ?? period * sendEvery, heartbeatMs: 0, rulesHost: { mode: schema.settings.host, offline: schema.settings.offline, load: current?.load }, ...opts.net, rules: true, rulesLimits: { output: rulesOutput, bytes: rulesCaps(schema.seats), rates: rulesRates(tickHz, schema.seats) } });
  const agents = game.vocab && agentFactory ? agentFactory(net, game.vocab, { roles: ['guide', 'party'], view: () => ({}), manual: true, viewOnly: true }) : null;
  const kindOf = new Map(schema.kinds.map((k) => [k.name, k]));
  const listeners = new Map<string, Set<(e: any) => void>>();
  let solo: Room<R> | null = null, noBodyMs = 0, checkedAt = clock();
  const soloListeners = new Map<string, () => void>();
  const emit = (name: string, e: unknown, local = false): void => { if (Boolean(solo) !== local) return; for (const fn of listeners.get(name) ?? []) { try { fn(e); } catch (err) { console.warn(`[room] on('${name}')`, err); } } };
  const map = compileMap(game.map, game.map.name ?? 'main');
  const spots = map.spots;
  const tune = Object.freeze({ ...(lab.rulesTune({ public: game.tune }).public as Record<string, unknown>) });

  let status: RoomStatus = 'connecting';
  let latest: Frame | null = null;
  let epoch = 0;
  let round: RoomRound | null = null;
  let results: RoundInfo['results'] | undefined;
  let closed = false;
  const fxQueue: { tick: number; name: string; at: unknown; data: Record<string, unknown> }[] = [];
  const setStatus = (s: RoomStatus): void => { if (s !== status) { status = s; emit('status', s); } };

  /* ---------------------------------------------------------------- frames in */

  const delivery = snapshotDecoder();
  function frameOf(s: Snapshot<unknown> | null): Frame | null {
    if (!s || typeof s !== 'object') return null;
    if (frames.has(s)) return frames.get(s) ?? null;
    let f: Frame | null = null;
    const d = delivery.decode(s)?.d as [unknown, unknown, CollisionRevision?] | null;
    if (Array.isArray(d) && Array.isArray(d[0]) && Array.isArray(d[1])) {
      const ents = new Map<string, Unpacked>();
      for (const w of d[1] as unknown[]) { const e = unpackEntity(schema.kinds, w, dims); if (e) ents.set(e.id, e); }
      f = { collision: d[2], k: s.k, e: Number(s.e) || 0, at: clock(), round: [Number(d[0][0]) || 0, Number(d[0][1]) || 0, Number(d[0][2]) || 0], ents, rows: (Array.isArray(s.c) ? s.c : []) as unknown as number[][] };
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
  // Lead observations use one clock phase: steering our clock is not network jitter.
  const leads: number[] = [];
  const phases: { tick: number; at: number; rate: number }[] = [];
  const hostAges: number[] = [];
  /** What the player holds, the presses since the last step, what the server was last told, and the entries of this send period. */
  let sample: Record<string, unknown> = {};
  let pressed = new Set<string>();
  let lastSent = '';
  let lastSendAt = 0;
  let entries: { t: number; row: number[] }[] = [];
  let hiddenSent = false;
  const history = new Map<number, Mine>();
  let pending: { t: number; input: Readonly<Record<string, unknown>> }[] = [];
  let replayHeld: Readonly<Record<string, unknown>> = Object.freeze({});
  let speed = 1;
  let leadAfter = 0;
  let observedLeadAt = 0;
  let catchTick: number | null = null;
  let catchAt = 0;
  let headingBlend: { from: Vec3; at: number } | null = null;
  let offsets: { delta: Vec3; at: number; path: Vec3; fade: number; last: number }[] = [];
  const predict = schema.settings.predict;
  const quantile = (list: number[], q: number): number => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) * q)] ?? 0;
  const targetLead = (): number => 0.5 + Math.max(0, quantile(leads, 0.5) - quantile(leads, 0.05));
  const copyMine = (m: Mine): Mine => ({ ...m, motion: motionOf(m.kind, m.motion) });
  const distance = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const correction = { count: 0, max: 0, last: 0, catches: 0, snaps: 0, rebases: 0, rebaseReason: '', rebaseError: 0 };
  function visualOffset(now: number, path?: Vec3, settled = false): Vec3 {
    if (predict.blendMs <= 0) { offsets = []; return { x: 0, y: 0, z: 0 }; }
    offsets = offsets.filter(o => o.fade > 0);
    const sum = { x: 0, y: 0, z: 0 };
    let waiting = false;
    for (const o of offsets) {
      if (path) {
        // Loss can make even a small correction longer than the distance travelled in
        // 100 ms. Bound its fade by actual progress, or it pulls steady movement backwards.
        // A forced knock can travel much faster than running. It must not also
        // erase a large offset at that speed and almost double the drawn impulse.
        // Only one queued fade advances at a time. A stopped body finishes its correction.
        if (waiting) o.at = now;
        else {
          const length = Math.hypot(o.delta.x, o.delta.y, o.delta.z);
          const elapsed = Math.max(0, now - o.last);
          // A knock may travel faster than normal movement, and catch-up already accelerates it.
          // Fading the offset must not add another fraction of that accelerated speed.
          const allowance = length ? (myKind()?.maxSpeed ?? 0) * elapsed / 1000 / length : 1;
          const release = settled && catchTick === null ? Math.min(allowance, elapsed / predict.blendMs) : 0;
          const progress = length ? Math.min(allowance, distance(path, o.path) * 0.8 / length) : 1;
          const nominal = Math.max(0, Math.min(1, 1 - (now - o.at) / predict.blendMs));
          o.fade = Math.max(nominal, o.fade - Math.max(release, progress));
        }
        o.path = path; o.last = now;
      }
      waiting = true;
      sum.x += o.delta.x * o.fade; sum.y += o.delta.y * o.fade; sum.z += o.delta.z * o.fade;
    }
    return sum;
  }

  const myKind = (): (typeof schema.kinds)[number] | null => (mine ? kindOf.get(mine.kind) ?? null : null);
  const tickAt = (now: number): number => (base ? base.tick + (now - base.at) / period * speed : 0);
  /** The tick `move` is being run for: the step just taken, or the one after it while the own body is drawn between ticks. */
  let moveTick = 0;
  let collisionHistory: CollisionRevision[] = [];
  let cachedCollision: CollisionRevision | undefined;
  let geometry = map as import('./math.ts').MapShapes;
  const geometryAt = () => {
    const revision = revisionAt(collisionHistory, moveTick);
    if (revision !== cachedCollision) { geometry = collisionMap(map, revision?.[2] ?? []); cachedCollision = revision; }
    return geometry;
  };
  const moveCtx = moveContext({ tick: () => moveTick, tickHz, tune, map, geometry: geometryAt, name: game.map.name ?? 'main', spots, radius: () => myKind()?.radius ?? 0, shape: () => ({ shape: myKind()?.shape ?? 'sphere', radius: myKind()?.radius ?? 0, height: myKind()?.height ?? 0 }), dims });
  function authorityRtt(): number {
    // The helper's ping ends at the relay. A browser host adds another network leg in both directions.
    // Snapshot stamps use the relay clock, so their observed age measures the complete downstream path.
    const relayRtt = net.stats().rtt ?? 100;
    return net.offline ? 0 : schema.settings.host === 'browser' ? Math.max(relayRtt, 2 * quantile(hostAges, 0.5)) : relayRtt;
  }
  function phaseAt(at: number): number {
    let p = phases[0];
    for (let i = phases.length - 1; i >= 0; i--) if (phases[i].at <= at) { p = phases[i]; break; }
    return p ? p.tick + (at - p.at) / period * p.rate - at / period : 0;
  }
  const medianLead = (): number => leads.length ? quantile(leads.slice(-8), 0.5) + phaseAt(clock()) : 0;
  function steer(now: number): void {
    if (!base || !leads.length) return;
    base = { tick: tickAt(now), at: now };
    speed = 1 + Math.max(-0.05, Math.min(0.05, (targetLead() - medianLead()) * 0.05));
    if (phases[phases.length - 1]?.rate !== speed) phases.push({ ...base, rate: speed });
    while (phases.length > 2 && phases[1].at < now - Math.max(1000, 2 * authorityRtt() + period)) phases.shift();
  }
  function rebase(k: number, reason = 'placement'): void {
    // Recalibrating an input clock is not a placement. Keep the drawn pose while
    // the new prediction catches up, just as for a snapshot reconciliation.
    const shown = reason === 'lead' ? meNow()?.pos : null;
    correction.rebaseReason = reason; correction.rebaseError = medianLead() - targetLead();
    const rtt = authorityRtt();
    // Lead samples refer to the clock which stamped them. Do not mix its offset with this clock's jitter.
    const target = targetLead();
    leads.length = 0;
    leadAfter = clock() + 2 * rtt + period;
    base = { tick: k + Math.ceil(rtt / period + target) + sendEvery - 1, at: clock() };
    stepped = Math.floor(base.tick) - 1;
    entries = []; pending = []; history.clear(); replayHeld = {}; held = {}; lastSent = ''; leads.length = 0; pressed = new Set();
    speed = 1; phases.length = 0; phases.push({ ...base, rate: 1 }); catchTick = null; offsets = []; headingBlend = null; correction.rebases += 1;
    const u = mine && latest?.ents.get(mine.id); if (u) adopt(u);
    if (mine) {
      history.set(stepped, copyMine(mine));
      if (shown) offsets = [{ delta: { x: shown.x - mine.pos.x, y: shown.y - mine.pos.y, z: shown.z - mine.pos.z }, at: clock(), path: mine.pos, fade: 1, last: clock() }];
    }
  }
  /** `motion` as this browser's own `move` may change it in place: what a snapshot carries is frozen, so every list, map and struct in it is copied. */
  const motionOf = (kindName: string, motion: Record<string, unknown>): Record<string, unknown> => thawFields(kindOf.get(kindName)?.motion ?? [], motion);
  function adopt(u: Unpacked): void {
    mine = { id: u.id, kind: u.kind, r: u.r, pos: u.pos, vel: u.vel, heading: u.heading, grounded: u.grounded, motion: motionOf(u.kind, u.motion) };
  }
  /** The game's guarded `move` for one tick, counted as the server counts it, with the result rounded as the server rounds it. */
  function runMove(kindName: string, body: { pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; motion: Record<string, unknown> }, input: Readonly<Record<string, unknown>>, t: number): typeof body {
    const fn = moves[kindName];
    if (!fn) return body;
    moveTick = t;
    // Like snapshot unpacking, prepare the bounded geometry outside the handler
    // quota. Authority debits projection once per tick, not once per mover.
    geometryAt();
    const out = stepMove(fn, body, input, moveCtx, Math.max(1, Math.floor(schema.settings.budget.tick / 4)), kindOf.get(kindName)?.motion ?? [], dims, (err) => { if (!(err instanceof BudgetError)) console.warn('[room] move', err); });
    const kind = kindOf.get(kindName), r = kind?.radius ?? 0;
    const height = kind?.height || 2 * r;
    out.pos = vec3({ x: Math.max(map.bounds.min.x + r, Math.min(map.bounds.max.x - r, out.pos.x)), y: Math.max(map.bounds.min.y + r, Math.min(map.bounds.max.y - r, out.pos.y)), z: dims === 3 ? Math.max(map.bounds.min.z, Math.min(map.bounds.max.z - height, out.pos.z)) : 0 }, dims);
    return out;
  }
  /** The input values the last step held (a press is never held). */
  let held: Readonly<Record<string, unknown>> = Object.freeze({});
  /** One step of the own body on tick `t`: the input step, `move`, and an entry when the sample or the claim changed. */
  function step(t: number, fresh = true): void {
    const kind = myKind();
    if (!mine || !kind) return;
    const values: number[] = [];
    const input: Record<string, unknown> = {};
    let press = false;
    for (const [name, fd] of kind.input) {
      if (fd.t === 'press') { const on = fresh && pressed.has(name); input[name] = on; values.push(on ? 1 : 0); if (on) press = true; } else { const v = coerce(fd, (fresh ? sample[name] : held[name]) ?? fd.init, dims); input[name] = v; values.push(v === true ? 1 : v === false ? 0 : v as number); }
    }
    if (fresh) pressed = new Set();
    held = Object.freeze({ ...input });
    {
      const body = runMove(kind.name, { pos: mine.pos, vel: mine.vel, heading: mine.heading, grounded: mine.grounded, motion: mine.motion }, held, t);
      mine.pos = body.pos; mine.vel = body.vel; mine.heading = body.heading; mine.grounded = body.grounded; mine.motion = body.motion;
    }
    const claim = kind.owner ? [mine.pos.x, mine.pos.y, mine.pos.z, mine.vel.x, mine.vel.y, mine.vel.z, mine.heading.x, mine.heading.y, mine.heading.z] : [];
    const sig = JSON.stringify([values, claim]);
    if (sig !== lastSent || press) { entries.push({ t, row: [...values, ...claim] }); pending.push({ t, input: held }); lastSent = sig; }
    history.set(t, copyMine(mine));
    for (const k of history.keys()) if (k < t - tickHz && (catchTick === null || k < Math.floor(catchTick))) history.delete(k);
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
    entries = [{ t, row: [...values, ...claim] }]; pending.push({ t, input: Object.fromEntries(kind.input.map(([name, fd], i) => [name, fd.t === 'press' ? false : values[i]])) }); lastSent = JSON.stringify([values, claim]);
  }
  function pump(): void {
    if (closed) return;
    if (net.offline && !net.rulesHosting) setStatus(net.closedWhy ? 'closed' : 'offline');
    const now = clock();
    checkSolo(now);
    const hidden = typeof document !== 'undefined' && document.hidden === true;
    // Effects play for everyone who draws the room: a watcher has no body and still sees them.
    fire();
    if (!mine || !base || net.seat === null || (!net.connected && !net.rulesHosting)) return;
    if (hidden) {
      // A hidden tab's timers are too slow to keep input alive, and a body must not run on without its player:
      // one neutral entry at once (every field at its init, no press), then no more steps until the tab shows again.
      if (!hiddenSent) { hiddenSent = true; sample = {}; pressed = new Set(); const t = Math.floor(tickAt(now)) + 1; keepalive(t); lastSendAt = 0; flush(now, t); }
      base = null;
      return;
    }
    hiddenSent = false;
    // Feedback can be sparse (idle keepalives or dropped snapshots). Re-evaluate the
    // steering every frame so a stale +/-5% command cannot drive past its target.
    steer(now);
    let t = Math.floor(tickAt(now));
    // A frame longer than a quarter of a second: set the clock again from the newest snapshot and carry on from there.
    if (t - stepped > Math.ceil(tickHz / 4) && latest) { rebase(latest.k, 'frame'); t = Math.floor(tickAt(now)); }
    while (stepped < t) {
      stepped += 1;
      step(stepped, stepped === t);
      if (stepped % sendEvery === sendEvery - 1) flush(now, stepped);
    }
  }

  function onSnapshot(s: Snapshot<unknown>): void {
    const f = frameOf(s);
    if (!f) return;
    const before = latest;
    if (before && before.e === f.e && f.k <= before.k) return;
    latest = f;
    if (!before || before.e !== f.e) collisionHistory = [];
    const collision = f.collision;
    if (collision) {
      collisionHistory.push(collision);
      if (collisionHistory.length > 128) collisionHistory.shift();
    }
    if (before && before.e !== f.e) hostAges.length = 0;
    hostAges.push(Math.max(0, net.now() - s.st)); if (hostAges.length > 40) hostAges.shift();
    if (before && before.e !== f.e) fxQueue.length = 0;
    const changedEpoch = f.e !== epoch;
    epoch = f.e;
    const seat = net.seat;
    let me: Unpacked | null = null;
    if (seat !== null) for (const u of f.ents.values()) if (u.seat === seat && u.driver === 'person') { me = u; break; }
    if (me) {
      const placed = !mine || mine.id !== me.id || mine.r !== me.r || changedEpoch;
      const row = f.rows.find((x) => x[0] === seat);
      if (placed || !base) {
        adopt(me); rebase(f.k);
        if (placed) emit('placed', entityOf(me, true));
      } else if (kindOf.get(me.kind)?.owner) {
        mine!.motion = motionOf(me.kind, me.motion);
      } else {
        const previous = mine!.pos;
        const shownBody = meNow();
        const shown = shownBody?.pos ?? previous;
        const oldHeading = mine!.heading;
        const oldOffset = visualOffset(clock()), oldOffsets = offsets;
        adopt(me);
        history.set(f.k, copyMine(mine!));
        const ack = row?.[2] ?? 0;
        const late = new Set<string>();
        for (const entry of pending) if (entry.t <= f.k) {
          replayHeld = entry.input;
          if (entry.t > ack && f.k + 1 - entry.t <= Math.ceil(tickHz / 4))
            for (const [name, fd] of myKind()!.input) if (fd.t === 'press' && entry.input[name]) late.add(name);
        }
        let input = replayHeld;
        for (let t = f.k + 1; t <= stepped; t++) {
          const presses = new Set(t === f.k + 1 ? late : []);
          for (const entry of pending) if (entry.t === t) {
            input = entry.input;
            for (const [name, fd] of myKind()!.input) if (fd.t === 'press' && entry.input[name]) presses.add(name);
          }
          const stepInput = { ...input };
          for (const [name, fd] of myKind()!.input) if (fd.t === 'press') stepInput[name] = presses.has(name);
          Object.assign(mine!, runMove(me.kind, mine!, Object.freeze(stepInput), t));
          history.set(t, copyMine(mine!));
        }
        pending = pending.filter(e => e.t > f.k || e.t > ack && f.k + 1 - e.t <= Math.ceil(tickHz / 4));
        if (shownBody && distance(oldHeading, mine!.heading) > 0.0001) headingBlend = { from: shownBody.heading, at: clock() };
        const error = distance(previous, mine!.pos);
        correction.last = error;
        if (error > 0.00001) { correction.count++; correction.max = Math.max(correction.max, error); }
        // A snapshot can replace the historical segment being drawn even when replay reaches
        // the same current position. Preserve that drawn pose on every catch-up reconciliation.
        if (error > 0.00001 || catchTick !== null) {
          if (catchTick === null && error > (predict.catchM ?? myKind()!.maxSpeed * 3 / tickHz) + 0.00001) {
            catchTick = f.k; catchAt = clock(); correction.catches++;
          }
          // Older history belongs to the previous reconciliation. Crossing from it into
          // the newly adopted snapshot can draw a backwards segment even though both
          // paths move forward. Start on the new path and preserve the shown pose below.
          if (catchTick !== null && catchTick < f.k) {
            catchTick = f.k; catchAt = clock();
          }
          offsets = [];
          const corrected = meNow()?.pos ?? mine!.pos;
          // Limit the new reconciliation, not an offset already being blended (which
          // can include a clock recalibration). Clipping that carried offset would
          // turn a small new error into a visible snap.
          const change = { x: shown.x - corrected.x - oldOffset.x, y: shown.y - corrected.y - oldOffset.y, z: shown.z - corrected.z - oldOffset.z };
          const gap = Math.hypot(change.x, change.y, change.z);
          const ahead = Math.max(0, tickAt(clock()) - f.k) / tickHz;
          const cap = predict.snapM ?? myKind()!.maxSpeed * (2 * ahead + 0.1);
          const scale = gap > cap && gap > 0 ? cap / gap : 1;
          if (scale < 1) correction.snaps++;
          const delta = { x: oldOffset.x + change.x * scale, y: oldOffset.y + change.y * scale, z: oldOffset.z + change.z * scale };
          if (catchTick !== null || scale < 1) offsets = [{ delta, at: clock(), path: corrected, fade: 1, last: clock() }];
          else {
            // Each small correction gets its own blend. Restarting one fade for their accumulated
            // offset can erase several ticks of travel in 100 ms and send a steadily moving body backwards.
            offsets = oldOffsets;
            for (const o of offsets) { o.path = corrected; o.last = clock(); }
            offsets.push({ delta: { x: delta.x - oldOffset.x, y: delta.y - oldOffset.y, z: delta.z - oldOffset.z }, at: clock(), path: corrected, fade: 1, last: clock() });
          }
        }
      }
      if (row && row[3] !== -128 && base && clock() >= leadAfter) {
        const now = clock(), rtt = authorityRtt();
        // A reported lead describes an input sent roughly one authority round trip ago. Remove that
        // clock's phase before measuring jitter; project the control median onto today's phase. Otherwise
        // our own +/-5% steering inflates the 40-sample jitter window and winds the clock ever further ahead.
        observedLeadAt = now;
        leads.push(row[3] / 16 - phaseAt(now - rtt)); if (leads.length > 40) leads.shift();
        const med = medianLead(), target = targetLead();
        if (leads.length >= 8 && Math.abs(med - target) > 4) rebase(f.k, 'lead');
        else {
          steer(now);
        }
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
    if (solo) return solo.round;
    if (!round || !latest) return null;
    // The room's clock now, from the newest snapshot: a view never turns a tick into time itself.
    const serverTick = latest.k + ((net.connected || net.rulesHosting) ? (clock() - latest.at) / period : 0);
    return { ...round, secondsLeft: round.endsAt ? Math.max(0, (round.endsAt - serverTick) / tickHz) : Infinity, ...(results ? { results } : {}) };
  }
  /** Effects wait for their authoritative snapshot and the body's drawn tick, including its catch-up path. */
  function fire(): void {
    if (!fxQueue.length) return;
    const s = net.sample();
    const drawn = s ? lerp(s.a.k, s.b.k, s.alpha) : latest ? latest.k : 0;
    for (let i = 0; i < fxQueue.length;) {
      const x = fxQueue[i];
      const ownTick = catchTick === null ? tickAt(clock()) : catchTick + Math.max(0, clock() - catchAt) / period * predict.catchUp;
      if (x.tick > (x.at === mine?.id ? Math.min(latest?.k ?? 0, ownTick) : drawn)) { i++; continue; }
      fxQueue.splice(i, 1);
      const id = typeof x.at === 'string' ? x.at : null;
      const where = id ? get(id)?.pos ?? null : unpackVec(x.at, dims);
      emit(x.name, Object.freeze({ ...x.data, at: where, ...(id ? { id } : {}), tick: x.tick }));
    }
  }

  net.on('snapshot', onSnapshot);
  net.on('role', (e) => { if (e.snap) onSnapshot(e.snap); if (net.offline && !net.rulesHosting) setStatus(net.closedWhy ? 'closed' : 'offline'); });
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
    if (/^(?:say|chat|emote)/i.test(e.k) && !(agents && (e.d as { ai?: boolean })?.ai)) {
      const data = e.d && typeof e.d === 'object' ? e.d as Record<string, unknown> : { text: e.d };
      emit('say', { ...data, kind: e.k, seat: e.from, slot: -1, line: typeof data.line === 'string' ? data.line : undefined, text: typeof data.text === 'string' ? data.text : '', args: {} });
    }
    else if (e.k === 'agent:goal' && e.from === null) {
      const data = e.d as import('../agents/agents.ts').GoalEvent;
      const goal = (g: import('../agents/agents.ts').Goal) => ({ ...g, asked: g.asked === true });
      emit('goal', { ...data, goal: goal(data.goal), prev: data.prev ? goal(data.prev) : null });
    }
    else if (e.k === 'agent:ask' && e.from === null) emit('ask', e.d);
    else if (/^ask:/.test(e.k)) {
      const data = e.d && typeof e.d === 'object' ? e.d as Record<string, unknown> : {};
      emit('ask', { ...data, ask: e.k.slice(4), k: e.k.slice(4), slot: typeof data.slot === 'number' ? data.slot : -1, from: e.from, at: clock(), args: data.args && typeof data.args === 'object' ? data.args : {} });
    }
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
    if (solo) return solo.me;
    if (!mine || !latest) return null;
    const server = latest.ents.get(mine.id);
    if (!server) return null;
    const kind = kindOf.get(mine.kind);
    let pos = mine.pos;
    let heading = mine.heading;
    let velocity = mine.vel, grounded = mine.grounded, motion = mine.motion;
    let settled = true;
    let preview: ReturnType<typeof runMove> | null = null;
    if (kind && base) {
      const a = Math.max(0, Math.min(1, tickAt(clock()) - stepped));
      const now: Record<string, unknown> = {};
      for (const [name, fd] of kind.input) now[name] = fd.t === 'press' ? pressed.has(name) : coerce(fd, sample[name] ?? fd.init, dims);
      const next = runMove(kind.name, { pos: mine.pos, vel: mine.vel, heading: mine.heading, grounded: mine.grounded, motion: motionOf(mine.kind, mine.motion) }, Object.freeze(now), stepped + 1);
      pos = vec3({ x: lerp(mine.pos.x, next.pos.x, a), y: lerp(mine.pos.y, next.pos.y, a), z: lerp(mine.pos.z, next.pos.z, a) }, dims);
      heading = blendHeading(mine.heading, next.heading, a, dims);
      velocity = vec3({ x: lerp(mine.vel.x, next.vel.x, a), y: lerp(mine.vel.y, next.vel.y, a), z: lerp(mine.vel.z, next.vel.z, a) }, dims);
      // A takeoff is airborne as soon as it rises; a landing waits for its contact.
      grounded = mine.grounded && (a === 0 || next.grounded);
      preview = next;
      settled = distance(next.pos, mine.pos) < 0.00001;
    }
    if (catchTick !== null && base) {
      const now = clock();
      catchTick += Math.max(0, now - catchAt) / period * predict.catchUp; catchAt = now;
      if (catchTick >= tickAt(now)) catchTick = null;
      else {
        // Catch-up can reach the fractional current tick before its next whole step exists.
        // Use the normal drawing preview, including its 3D pose, instead of holding then jumping.
        const t = Math.floor(catchTick), a = history.get(t), b = history.get(t + 1) ?? (t === stepped ? preview : null);
        if (a && b) { const f = catchTick - t; pos = { x: lerp(a.pos.x, b.pos.x, f), y: lerp(a.pos.y, b.pos.y, f), z: lerp(a.pos.z, b.pos.z, f) }; heading = blendHeading(a.heading, b.heading, f, dims);
          velocity = vec3({ x: lerp(a.vel.x, b.vel.x, f), y: lerp(a.vel.y, b.vel.y, f), z: lerp(a.vel.z, b.vel.z, f) }, dims);
          grounded = a.grounded && (f === 0 || b.grounded); motion = a.motion;
        } else if (a) { pos = a.pos; heading = a.heading; velocity = a.vel; grounded = a.grounded; motion = a.motion; }
      }
    }
    const offset = visualOffset(clock(), pos, settled);
    pos = { x: pos.x + offset.x, y: pos.y + offset.y, z: pos.z + offset.z };
    if (headingBlend) {
      const t = predict.blendMs > 0 ? Math.min(1, (clock() - headingBlend.at) / predict.blendMs) : 1;
      heading = blendHeading(headingBlend.from, heading, t, dims);
      if (t >= 1) headingBlend = null;
    }
    return entityOf({ ...server, pos, vel: velocity, heading, grounded, motion }, true);
  }
  function drawn(id: string): Entity | null {
    if (solo) return solo.get(id);
    if (mine && id === mine.id) return meNow();
    const s = net.sample();
    const a = s ? frameOf(s.a) : latest;
    const b = s ? frameOf(s.b) : latest;
    const ea = a?.ents.get(id); const eb = b?.ents.get(id);
    if (!ea || !eb) return ea ? entityOf(ea) : eb && s && s.alpha >= 1 ? entityOf(eb) : eb && !a?.ents.size ? entityOf(eb) : null;
    // A placed body jumps: nobody's view glides across a placement.
    if (ea.r !== eb.r || a?.e !== b?.e || !s) return entityOf(eb);
    const t = s.alpha;
    const h = blendHeading(ea.heading, eb.heading, t, dims);
    return entityOf({ ...(t < 1 ? ea : eb), grounded: t >= 1 ? eb.grounded : ea.grounded && (t === 0 || eb.grounded), pos: vec3({ x: lerp(ea.pos.x, eb.pos.x, t), y: lerp(ea.pos.y, eb.pos.y, t), z: lerp(ea.pos.z, eb.pos.z, t) }, dims), vel: vec3({ x: lerp(ea.vel.x, eb.vel.x, t), y: lerp(ea.vel.y, eb.vel.y, t), z: lerp(ea.vel.z, eb.vel.z, t) }, dims), heading: h });
  }
  function get(id: string): Entity | null { return drawn(id); }
  function each(kind: string, fn: (e: Entity) => void): void {
    pump();
    if (solo) { solo.each(kind, fn); return; }
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
    if (solo) return solo.roster;
    const scores = new Map<number, number>();
    if (latest) for (const u of latest.ents.values()) { const k = kindOf.get(u.kind); if (u.seat !== undefined && k?.score) scores.set(u.seat, Number(u.fields[k.score]) || 0); }
    return (net.slots ?? []).map((sl) => ({ seat: sl.slot, name: sl.name, driver: sl.agent ? 'ai' as const : sl.bot ? 'bot' as const : 'person' as const, score: scores.get(sl.slot) ?? 0, me: sl.seat !== null && sl.seat === net.seat }));
  }
  function forwardSolo(name: string): void {
    if (solo && !soloListeners.has(name)) soloListeners.set(name, solo.on(name, e => emit(name, e, true)));
  }
  function stopSolo(): void {
    for (const off of soloListeners.values()) off(); soloListeners.clear();
    const old = solo; solo = null; old?.close();
  }
  function checkSolo(now: number): void {
    if (opts.fallback !== 'solo') return;
    const elapsed = Math.min(300, Math.max(0, now - checkedAt)); checkedAt = now;
    if (net.offline || net.watching) { noBodyMs = 0; stopSolo(); return; }
    if (net.link !== 'online') { noBodyMs = 0; return; }
    if (mine && net.seat !== null && latest?.ents.has(mine.id)) {
      noBodyMs = 0;
      if (solo) { stopSolo(); net.line(null); emit('status', status); emit('placed', { id: mine.id }); }
      return;
    }
    if (solo || net.seat === null && !net.full) return;
    noBodyMs += elapsed;
    if (noBodyMs < 4000 || !(schema.settings.offline || schema.settings.host === 'browser')) return;
    // Keep the online socket and its seat queue. The separate offline room emits no wire
    // traffic, writes no room save to the server, and closes as soon as a body arrives.
    const g = globalThis as unknown as Record<string, unknown>;
    const probes = [g.__homieNet, g.__homiePort];
    solo = openRoom<R>({ game, move: moves, now: opts.now, timers: opts.timers, net: { config: null, post: null, linkOverlay: false } });
    [g.__homieNet, g.__homiePort] = probes;
    for (const name of listeners.keys()) forwardSolo(name);
    net.line(net.full ? 'This room is full · playing on your own until a seat is free' : 'Playing on your own until the next round');
    emit('status', 'offline', true);
  }
  let extra: Record<string, () => unknown> = {};
  const myScore = (): number | null => { if (solo) { const k = schema.kinds.find(k => k.player); return k?.score && solo.me ? Number(solo.me[k.score]) || 0 : null; } const k = myKind(); const u = mine && latest ? latest.ents.get(mine.id) : null; return k?.score && u ? Number(u.fields[k.score]) || 0 : null; };
  const busy = (): boolean => solo ? !solo.me : status !== 'playing' || !mine || latest?.ents.get(mine.id)?.away === true;
  // The probes the testing tools read (`check`, `shoot`, `perf`, the playtest judge): the same two objects a game written the old way publishes.
  net.expose({
    self: () => { const m = meNow(); return m ? { x: m.pos.x, y: m.pos.y, z: m.pos.z } : null; },
    peer: (seat: number) => { if (!latest) return null; for (const u of latest.ents.values()) if (u.seat === seat) return { x: u.pos.x, y: u.pos.y, z: u.pos.z }; return null; },
    movement: () => { const kinds = schema.kinds.filter(k => k.player); return kinds.length && kinds.every(k => k.maxSpeed === 0) ? 'stationary' : 'spatial'; },
    prediction: () => ({ ...correction, observedLeadAt, lastSendAt, now: clock(), serverTick: latest?.k, tick: stepped, catchTick, lead: targetLead(), medianLead: medianLead(), rate: speed, rtt: authorityRtt(), hostAge: quantile(hostAges, 0.5), pending: pending.length }),
    scores: () => roster().map((r) => ({ seat: r.seat, score: r.score })),
    score: myScore, tick: () => latest?.k ?? 0, epoch: () => epoch, hosted: () => net.rulesHosting ? 'browser' : schema.settings.host, status: () => solo ? 'offline' : status,
  });
  if (typeof window !== 'undefined') {
    exposePort(net as Netplay<unknown, unknown, unknown>, {
      view: 'top', size: schema.kinds.find((k) => k.player)?.radius ?? 0.5,
      self: () => { const m = meNow(); return m ? { x: m.pos.x, y: m.pos.y } : null; },
      basis: opts.screenBasis ?? (() => ({ right: [1, 0], up: [0, 1] })),
      score: myScore, busy: () => (typeof extra.busy === 'function' ? Boolean(extra.busy()) : busy()),
      extra: new Proxy({}, { get: (_t, key) => (typeof key === 'string' ? extra[key] : undefined), ownKeys: () => Object.keys(extra), getOwnPropertyDescriptor: (_t, key) => (typeof key === 'string' && extra[key] ? { enumerable: true, configurable: true, value: extra[key] } : undefined) }) as Record<string, () => unknown>,
    });
  }
  const timer = opts.timers === false ? null : setInterval(pump, Math.max(8, period / 2));
  const onShow = (): void => { if (typeof document !== 'undefined' && !document.hidden) { base = null; if (latest) rebase(latest.k); } };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);

  return {
    get status() { return solo ? 'offline' : status; },
    get seat() { return solo ? solo.seat : net.seat; },
    get me() { pump(); return meNow(); },
    each, get,
    on(name, fn) { let set = listeners.get(name); if (!set) { set = new Set(); listeners.set(name, set); } set.add(fn); forwardSolo(name); return () => { set?.delete(fn); }; },
    get shared() { if (solo) return solo.shared; return Object.freeze(unpackFields(schema.shared, net.stateOf('shared'), dims)); },
    input(s) {
      if (solo) { solo.input(s); return; }
      const kind = myKind() ?? schema.kinds.find((k) => k.player) ?? null;
      const next: Record<string, unknown> = {};
      let changed = false;
      for (const [name, fd] of kind?.input ?? []) {
        if (fd.t === 'press') { if ((s[name] === true || s[name] === 1) && !pressed.has(name)) changed = true; }
        else { if (s[name] !== undefined) next[name] = s[name]; if ((next[name] ?? fd.init) !== (sample[name] ?? fd.init)) changed = true; }
      }
      // A fresh control can replace a preview partway through a tick (especially
      // a jump). Keep the pose at the instant of the press; only subsequent time
      // may advance the new path, rather than drawing elapsed time with new input.
      if (changed) pump();
      const shown = changed ? meNow()?.pos : null;
      for (const [name, fd] of kind?.input ?? []) if (fd.t === 'press' && (s[name] === true || s[name] === 1)) pressed.add(name);
      sample = next;
      if (shown) {
        const now = clock(), nextShown = meNow()?.pos;
        if (nextShown && distance(shown, nextShown) > 0.00001) {
          const carried = visualOffset(now);
          // Coalesce the carried blend: analogue controls may change every frame.
          offsets = [{ delta: { x: carried.x + shown.x - nextShown.x, y: carried.y + shown.y - nextShown.y, z: carried.z + shown.z - nextShown.z },
            at: now, last: now, fade: 1, path: { x: nextShown.x - carried.x, y: nextShown.y - carried.y, z: nextShown.z - carried.z } }];
        }
      }
    },
    command(name, data = {}) { if (solo) { solo.command(name, data); return; } if (schema.commands[name]) net.send('cmd', [name, data]); else console.warn(`[room] no command "${name}" is declared in shapes.commands`); },
    get round() { return roundNow(); },
    get roster() { return roster(); },
    follow(id) { const e = id ? latest?.ents.get(id) : null; net.follow(e && e.seat !== undefined ? e.seat : null); },
    probe(x) { extra = { ...extra, ...x }; },
    ask(id, askId, args = {}) { if (solo) return; const e = latest?.ents.get(id); if (e && e.seat !== undefined) agents?.ask(e.seat, askId, args); },
    askButtons(id, offer = {}) { if (solo) return []; const e = latest?.ents.get(id); return e && e.seat !== undefined ? agents?.askButtons(e.seat, offer) ?? [] : []; },
    tune, map: Object.freeze({ ...map, spots: Object.freeze(spots) }), net: net as Netplay,
    pump,
    close() { stopSolo(); closed = true; if (timer) clearInterval(timer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow); agents?.stop(); net.close(); setStatus('closed'); },
  };
}
