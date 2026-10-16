import { nearbyMap } from './map-index.ts';
import { correctionPath } from './correction-path.ts';
import { disposeMoveContext, sweepMap } from './math.ts';
import { boundPosition, periodicDelta, blendPosition, relativePoint, wrapPoint } from './topology.mjs';
import { rayQuery, raySnapshot, type QueryTarget } from './query.ts';
import { solidAt } from './collision.ts';
import type { RayQueries, RayOptions } from './types.ts';
import { snapshotDecoder } from './interest.mjs';
import { collisionMap, collisionTargets, revisionAt, type CollisionRevision } from './live.ts';
import { rulesOutput } from '../netplay/rules-output.mjs';
import { LIMITS, rulesCaps, rulesRates } from '../worker/limits.mjs';
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
import { BudgetError, brand } from './guard.ts';
import { math, moveContext } from './math.ts';
import { OWNER_REPORT_LIMIT, coerce, coerceFields, dir, initFields, stepMove, thawFields, unpackEntity, unpackFields, unpackVec, vec3 } from './pack.ts';
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
export interface GameData { vocab?: Vocabulary; id: string; schema: Schema; tune: Record<string, unknown>; map: { name?: string; bounds: { min: unknown; max: unknown }; boxes?: unknown[]; circles?: unknown[]; spheres?: unknown[]; capsules?: unknown[]; heightTiles?: unknown[]; wrap?: Partial<Record<'x'|'y'|'z',true>>; tiles?: unknown; spots?: Record<string, unknown[]> } }
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
  /**
   * Predict the player's OWN actions (0.46.3), by kind: `predict: { runner(me, input, ctx) { ... } }`. The room runs it
   * for the own body once a predicted tick, after `move`, with that tick's input, and again on a copy between ticks so
   * a press answers on the next drawn frame. `me` holds the body's declared fields and may be written: `room.me` then
   * reads the predicted values. Every snapshot puts the server's values back and the pending inputs are run again,
   * exactly as the own position is. `ctx.ghost` shows a provisional entity and `ctx.effect` a provisional effect until
   * the server confirms or the room retracts them (`room.on('retract', ...)`). The server stays the authority.
   */
  predict?: Record<string, Predictor>;
  /** Camera axes on the rules' x/y plane for the testing tools. Default: x right, y up. */
  screenBasis?: PortProbeOptions['basis'];
  /** Horizontal intent for box-bodied 2D visual corrections: -1 left, 0 neutral, +1 right. Does not affect simulation. */
  correctionDirection?: (input: Readonly<Record<string, unknown>>, velocity: Vec3) => number;
  /**
   * After this browser's connection comes back, the server hands the own body back where it has it (a new placement
   * revision). A box-bodied 2D runner is then drawn on from where it was shown, not cut across. Say here when that
   * revision is a real placement made while the player was away (a respawn, a new round): it is then drawn at once.
   */
  respawned?: (before: Entity, after: Entity) => boolean;
  /** Tests: a clock in ms and a way to run without timers. */
  now?: () => number;
  timers?: boolean;
}
/** What a predictor (`openRoom({ predict })`) is handed beside the body and the tick's input. */
export interface PredictContext extends RayQueries {
  readonly tick: number; readonly dt: number;
  /** Read the authoritative snapshot this prediction started from, without advancing time. */
  each(kind: string, fn: (e: Entity) => void): void;
  /** The same deterministic `math` a `move` is handed (0.46.5): a helper shared with the rules can be called with `ctx`. */
  readonly math: typeof math;
  /**
   * The tick the server will judge this player's ray against when the browser says it aimed at `aimTick` (0.46.5):
   * `aimTick`, held to how far back this seat may look right now (the server says so in every snapshot) and to this
   * tick. Pass it to `ctx.ray(..., { atTick })`: the other bodies are then posed as the server will pose them, from
   * the snapshots this browser holds (between two of them, or carried on from the newest along its velocity).
   */
  judgedTick(aimTick: number): number;
  /** The tick the other bodies are drawn at: what the player is looking at. */
  readonly viewTick: number;
  /** This run draws ahead of the tick; the tick's own run follows. What it shows is shown once. */
  readonly preview: boolean;
  /** A provisional entity, drawn by `room.each` with `provisional: true` until an entity of that kind which `match` accepts (default: within a metre of it) arrives, or the server has run the tick without one. Returns its id. */
  ghost(kind: string, at: { x: number; y: number; z?: number }, fields?: Record<string, unknown>, options?: { seconds?: number; match?: (e: Entity) => boolean; key?: string }): string;
  /**
   * A provisional effect: listeners hear it now with `predicted: true`. The server's own effect of that name which `match` accepts (default: the next one) then arrives with `confirms: true`; if the server ran the tick without one, listeners of `retract` hear it.
   * A tick's prediction runs more than once (a preview between ticks, again whenever the input changes, then the tick itself) and shows each thing once: things are told apart by their name and `key`, so give two effects of one name that mean different things (two sounds) a `key` each.
   */
  effect(name: string, at: { x: number; y: number; z?: number } | string, data?: Record<string, unknown>, options?: { match?: (e: any) => boolean; key?: string }): void;
}
export type Predictor = (me: any, input: any, ctx: PredictContext) => void;
export interface Room<R = unknown> extends RayQueries {
  /** Last owner input tick in the sampled authoritative scene. */
  readonly confirmedTick: number;
  readonly viewTick: number;
  /** Where a body was at a tick, from the snapshots this browser holds (0.46.5); `known: false` past the newest one. */
  poseAt(id: string, tick: number): { pos: Vec3; vel: Vec3; known: boolean } | null;
  readonly status: RoomStatus;
  readonly seat: number | null;
  readonly me: Entity | null;
  each(kind: string, fn: (e: Entity) => void): void;
  get(id: string): Entity | null;
  on(name: string, fn: (e: any) => void): () => void;
  readonly shared: Readonly<Record<string, unknown>>;
  input(sample: Record<string, number | boolean>, options?: { at?: number }): void;
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
  readonly map: import('./rules.ts').GameMap;
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
  const net = createNetplay<unknown, unknown, unknown>({ game: game.id, maxPlayers: schema.seats, snapshotHz: tickHz, interpFloorMs: schema.settings.predict.interpMs ?? period * sendEvery, heartbeatMs: 0, rulesHost: { retainAuthority: schema.kinds.some(k=>k.validatedOwner), mode: schema.settings.host, offline: schema.settings.offline, load: current?.load }, ...opts.net, rules: true, rulesLimits: { output: rulesOutput, bytes: rulesCaps(schema.seats), rates: rulesRates(tickHz, schema.seats) } });
  const agents = game.vocab && agentFactory ? agentFactory(net, game.vocab, { roles: ['guide', 'party'], view: () => ({}), manual: true, viewOnly: true }) : null;
  const kindOf = new Map(schema.kinds.map((k) => [k.name, k]));
  const listeners = new Map<string, Set<(e: any) => void>>();
  let solo: Room<R> | null = null, noBodyMs = 0, checkedAt = clock();
  const soloListeners = new Map<string, () => void>();
  const emit = (name: string, e: unknown, local = false): void => { if (Boolean(solo) !== local) return; for (const fn of listeners.get(name) ?? []) { try { fn(e); } catch (err) { console.warn(`[room] on('${name}')`, err); } } };
  const map = compileMap(game.map, game.map.name ?? 'main');
  const spots = map.spots;
  const compiledMaps = new Map<string, typeof map>();
  const mapOf = (data?: import('./map-state.ts').MapRevision | null) => {
    if (!data) return map;
    const key = `${epoch}:${data[0]}`;
    let value = compiledMaps.get(key);
    if (!value) {
      value = compileMap(data[1], map.name);
      compiledMaps.set(key, value);
      // Only replay history needs old compiled indexes; saves carry the compact data.
      if (compiledMaps.size > 64) compiledMaps.delete(compiledMaps.keys().next().value!);
    }
    return value;
  };
  const tune = Object.freeze({ ...(lab.rulesTune({ public: game.tune }).public as Record<string, unknown>) });

  let status: RoomStatus = 'connecting';
  let latest: Frame | null = null;
  /** The snapshots this browser holds, oldest first: two seconds of them (see poseAt). */
  const held2: Frame[] = [];
  let epoch = 0;
  let round: RoomRound | null = null;
  let results: RoundInfo['results'] | undefined;
  let closed = false;
  const fxQueue: { tick: number; name: string; at: unknown; data: Record<string, unknown>; confirms?: boolean }[] = [];
  const setStatus = (s: RoomStatus): void => { if (s !== status) { status = s; emit('status', s); } };

  /* ---------------------------------------------------------------- frames in */

  const delivery = snapshotDecoder();
  /** Until when a revision of the own body counts as the server handing it back after a reconnect. */
  let returningUntil = 0;
  let unpackedRows = new Map<string, {wire: unknown; value: Unpacked}>();
  const sameRow = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameRow(a[i], b[i])) return false;
    return true;
  };
  function frameOf(s: Snapshot<unknown> | null): Frame | null {
    if (!s || typeof s !== 'object') return null;
    if (frames.has(s)) return frames.get(s) ?? null;
    let f: Frame | null = null;
    const d = delivery.decode(s)?.d as [unknown, unknown, CollisionRevision?] | null;
    if (Array.isArray(d) && Array.isArray(d[0]) && Array.isArray(d[1])) {
      const ents = new Map<string, Unpacked>();
      // Delta rows and repeated keyframe rows often describe unchanged scenery.
      // Compare the immutable wire arrays before allocating typed vectors/fields.
      // Retain only this frame's rows, not a growing history of transient keys.
      const nextRows = new Map<string, {wire: unknown; value: Unpacked}>();
      for (const w of d[1] as unknown[]) {
        const id = Array.isArray(w) && typeof w[0] === 'string' ? w[0] : '';
        const prior = unpackedRows.get(id);
        const e = prior && sameRow(prior.wire, w) ? prior.value : unpackEntity(schema.kinds, w, dims);
        if (e) { nextRows.set(e.id, prior?.value === e ? prior : {wire:w,value:e}); ents.set(e.id, e); }
      }
      unpackedRows = nextRows;
      f = { collision: d[2], k: s.k, e: Number(s.e) || 0, at: clock(), round: [Number(d[0][0]) || 0, Number(d[0][1]) || 0, Number(d[0][2]) || 0], ents, rows: (Array.isArray(s.c) ? s.c : []) as unknown as number[][] };
    }
    frames.set(s, f);
    return f;
  }
  const entities = new WeakMap<Unpacked, Entity>();
  const entityOf = (u: Unpacked, mine = false, cache = !mine): Entity => {
    if (cache && entities.has(u)) return entities.get(u)!;
    const entity = Object.freeze({ id: u.id, kind: u.kind, pos: u.pos, vel: u.vel, heading: u.heading, grounded: u.grounded, ...(u.seat !== undefined ? { seat: u.seat, owner: u.owner, driver: u.driver, away: u.away, goal: u.goal } : {}), ...(mine ? { mine: true } : {}), ...u.fields, motion: Object.freeze({ ...u.motion }) }) as Entity;
    if (cache) entities.set(u, entity);
    return entity;
  };

  /* ---------------------------------------------------------------- the own body, on this browser's copy of the clock */

  interface Mine { id: string; kind: string; r: number; pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; motion: Record<string, unknown>; fields: Record<string, unknown> }
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
  let pressed = new Map<string, number | boolean>();
  let lastSent = '';
  let lastSendAt = 0;
  interface OutgoingEntry { t: number; row: number[]; compactBytes?: number; extraBytes?: number; expanded?: boolean }
  let entries: OutgoingEntry[] = [];
  let inputSequence = 0;
  let controlChanges: number[][] = [];
  let sentHistory: OutgoingEntry[] = [];
  let hiddenSent = false;
  const history = new Map<number, Mine>();
  let pending: { seq?: number; applied?: number; t: number; input: Readonly<Record<string, unknown>>; pulses?: Record<string, number>; pulseTicks?: Record<string, number> }[] = [];
  /** Valued pulses sent, numbered: the server's control row names the newest it has acted on (0.46.3). */
  let pulseCount = 0;
  const pulseQueue: {name:string; value:number; n:number; t:number}[] = [];
  let pulseNumber = new Map<string, number>();
  let replayHeld: Readonly<Record<string, unknown>> = Object.freeze({});
  /** `f.held()` values as the server last had them: those of the newest entry it has acknowledged. */
  let serverHeld: Record<string, number> = {};
  let speed = 1;
  let leadAfter = 0;
  let calibratedRtt = 0;
  let latencyCalibrated = false;
  const applications = new Map<number, number>();
  let observedLeadAt = 0;
  let catchTick: number | null = null;
  let catchAt = 0;
  let headingBlend: { from: Vec3; at: number } | null = null;
  let offsets: { delta: Vec3; at: number; path: Vec3; fade: number; last: number; end?: number }[] = [];
  const predict = schema.settings.predict;
  const quantile = (list: number[], q: number): number => [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) * q)] ?? 0;
  let leadTarget = .5, leadMedian = 0, hostMedian = 0;
  const targetLead = (): number => leadTarget;
  const copyMine = (m: Mine): Mine => ({ ...m, motion: motionOf(m.kind, m.motion) });
  const distance = (a: Vec3, b: Vec3): number => Math.hypot(periodicDelta(b.x,a.x,map.wrap?.x),periodicDelta(b.y,a.y,map.wrap?.y),periodicDelta(b.z,a.z,map.wrap?.z));
  const correction = { count: 0, max: 0, last: 0, catches: 0, snaps: 0, rebases: 0, rebaseReason: '', rebaseError: 0 };
  function visualOffset(now: number, path?: Vec3, settled = false): Vec3 {
    if (predict.blendMs <= 0) { offsets = []; return { x: 0, y: 0, z: 0 }; }
    offsets = offsets.filter(o => o.fade > 0);
    const sum = { x: 0, y: 0, z: 0 };
    let waiting = false;
    for (const o of offsets) {
      o.end ??= o.at + Math.max(1000, predict.blendMs);
      const deadlineFade = Math.max(0, Math.min(1, (o.end - now) / 250));
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
          let progress = length ? Math.min(allowance, distance(path, o.path) * 0.8 / length) : 1;
          // Travel on one axis cannot pay for a correction on another. In particular,
          // a jump must not erase a horizontal offset faster than running advances it.
          for (const axis of ['x', 'y', 'z'] as const) {
            const travelled = periodicDelta(o.path[axis], path[axis], map.wrap?.[axis]);
            if (o.delta[axis] * travelled > 0) progress = Math.min(progress, .8 * Math.abs(travelled / o.delta[axis]));
          }
          const nominal = now >= o.end ? 0 : Math.max(0, Math.min(1, 1 - (now - o.at) / predict.blendMs));
          o.fade = Math.max(nominal, o.fade - Math.max(release, progress));
        }
        o.path = path; o.last = now;
      }
      // Drain any remaining correction over the final quarter second, including
      // queued offsets. Expiring it in one frame would itself create a warp.
      o.fade = Math.min(o.fade, deadlineFade);
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
  const mapAt = (tick:number) => {
    if (!collisionHistory.at(-1)?.[3]?.map) return map;
    // Map activation and live collider projection have independent effective ticks.
    // A lost pending snapshot must not postpone a map already active in its successor.
    for (let i=collisionHistory.length-1;i>=0;i--) {
      const metadata=collisionHistory[i][3];
      if (metadata?.map && metadata.map[0]<=tick) return mapOf(metadata.map);
      if (metadata?.previousMap && metadata.previousMap[0]<=tick) return mapOf(metadata.previousMap);
    }
    return map;
  };
  const geometryAt = () => {
    const revision = revisionAt(collisionHistory, moveTick);
    const activeMap=mapAt(moveTick);
    if (revision !== cachedCollision || (geometry.staticMap??geometry)!==activeMap) { geometry = collisionMap(activeMap, revision?.[2] ?? []); cachedCollision = revision; }
    return geometry;
  };
  const moveCtx = moveContext({ tick: () => moveTick, tickHz, tune, map, geometry: geometryAt, self: () => mine?.id, name: game.map.name ?? 'main', spots, radius: () => myKind()?.radius ?? 0, shape: () => ({ terrain: myKind()?.terrain, shape: myKind()?.shape ?? 'sphere', radius: myKind()?.radius ?? 0, height: myKind()?.height ?? 0 }), dims });
  function authorityRtt(): number {
    // The helper's ping ends at the relay. A browser host adds another network leg in both directions.
    // Snapshot stamps use the relay clock, so their observed age measures the complete downstream path.
    const relayRtt = net.stats().rtt ?? 100;
    return net.offline ? 0 : Math.max(relayRtt, 2 * hostMedian);
  }
  function ownerArrivalLead(): number {
    // A queued snapshot's age is not the next packet's transit time. Use its
    // actual downstream age plus the low end of recent transit observations
    // for the upstream leg; TCP recovery must not inflate every future stamp.
    const age = hostAges.at(-1) ?? 0;
    const transit = hostAges.length ? quantile(hostAges, .05) : authorityRtt() / 2;
    return Math.max(0, Math.min(tickHz - 2, (age + transit) / period - 1));
  }
  function phaseAt(at: number): number {
    let p = phases[0];
    for (let i = phases.length - 1; i >= 0; i--) if (phases[i].at <= at) { p = phases[i]; break; }
    return p ? p.tick + (at - p.at) / period * p.rate - at / period : 0;
  }
  const medianLead = (): number => leads.length ? leadMedian + phaseAt(clock()) : 0;
  function steer(now: number): void {
    if (!base || !leads.length || myKind()?.validatedOwner) return;
    base = { tick: tickAt(now), at: now };
    // Input replay absorbs delivery jitter. Keep the physical tick cadence close to
    // wall time: aggressive steering makes fixed-step custom renderers bunch ticks.
    speed = 1 + Math.max(-0.005, Math.min(0.005, (targetLead() - medianLead()) * 0.005));
    if (phases[phases.length - 1]?.rate !== speed) phases.push({ ...base, rate: speed });
    while (phases.length > 2 && phases[1].at < now - Math.max(1000, 2 * authorityRtt() + period)) phases.shift();
  }
  let ownerBaseTick = 0;
  function rebase(k: number, reason = 'placement'): void {
    // Recalibrating an input clock is not a placement. Keep the drawn pose while
    // the new prediction catches up, just as for a snapshot reconciliation.
    const shown = reason === 'lead' ? meNow()?.pos : null;
    const continuousTick = reason === 'placement' && base && tickAt(clock()) >= k && tickAt(clock()) - k <= tickHz ? tickAt(clock()) : null;
    if(reason==='placement' || reason==='epoch')pulseQueue.length=0;
    correction.rebaseReason = reason; correction.rebaseError = medianLead() - targetLead();
    const validated = myKind()?.validatedOwner;
    const rtt = authorityRtt(); calibratedRtt = rtt;
    // Lead samples refer to the clock which stamped them. Do not mix its offset with this clock's jitter.
    const target = targetLead();
    leads.length = 0; leadTarget = .5; leadMedian = 0;
    leadAfter = clock() + 2 * rtt + period;
    base = { tick: continuousTick ?? k + Math.min(tickHz, Math.ceil(rtt / period + target) + sendEvery - 1), at: clock() };
    if (validated) {
      // A placement arrives one downstream trip after k; its next report takes
      // another upstream trip. Start the report clock at that arrival time,
      // without simulating any travel from the placement. The validator checks
      // one physical step from this fresh baseline, not the skipped clock gap.
      ownerBaseTick = k + Math.floor(ownerArrivalLead());
      base = {tick:ownerBaseTick,at:clock()};
    }
    stepped = validated ? ownerBaseTick : Math.max(k, Math.floor(base.tick) - (continuousTick === null ? 1 : 0));
    entries = []; sentHistory = []; controlChanges = []; pending = []; history.clear(); replayHeld = {}; serverHeld = {}; held = {}; lastSent = ''; leads.length = 0; leadTarget = .5; leadMedian = 0; pressed = new Map(); pulseNumber = new Map(); heldTrack.clear(); if (reason !== 'lead') dropPredictions();
    speed = 1; phases.length = 0; phases.push({ ...base, rate: 1 }); catchTick = null; offsets = []; headingBlend = null; correction.rebases += 1;
    const u = mine && latest?.ents.get(mine.id); if (u) adopt(u);
    if (mine) {
      // A snapshot is the body at k, not at the clock's future input tick.
      // Project the intervening movement instead of relabelling that old pose;
      // otherwise the next reconciliation suddenly adds a latency's worth of travel.
      const kind = myKind()!;
      const values: Record<string, unknown> = {};
      for (const [name, fd] of kind.input) values[name] = fd.t === 'press' ? false : fd.t === 'pulse' ? 0 : coerce(fd, sample[name] ?? fd.init, dims);
      held = replayHeld = Object.freeze(values);
      history.set(k, copyMine(mine));
      for (let t = k + 1; !kind.owner && t <= stepped; t++) {
        Object.assign(mine, runMove(kind.name, mine, held, t));
        runPredict(kind.name, mine, mine.fields, held, t, false, false);
        history.set(t, copyMine(mine));
      }
      history.set(stepped, copyMine(mine));
      if (!kind.owner && stepped > k) {
        // The projection used these controls from k+1. Stamp that first input too,
        // so authority can recover the identical post-placement path.
        const row = kind.input.map(([name]) => Number(held[name]));
        entries.push({ t: k + 1, row: [...row, -471, ++inputSequence, 0] });
        pending.push({ seq: inputSequence, t: k + 1, input: held });
      }
      if (shown) offsets = [{ delta: { x: periodicDelta(mine.pos.x,shown.x,map.wrap?.x), y: periodicDelta(mine.pos.y,shown.y,map.wrap?.y), z: periodicDelta(mine.pos.z,shown.z,map.wrap?.z) }, at: clock(), path: mine.pos, fade: 1, last: clock() }];
    }
  }
  /** `motion` as this browser's own `move` may change it in place: what a snapshot carries is frozen, so every list, map and struct in it is copied. */
  const motionOf = (kindName: string, motion: Record<string, unknown>): Record<string, unknown> => thawFields(kindOf.get(kindName)?.motion ?? [], motion);
  function adopt(u: Unpacked): void {
    presentedEntity = null;
    mine = { id: u.id, kind: u.kind, r: u.r, pos: u.pos, vel: u.vel, heading: u.heading, grounded: u.grounded, motion: motionOf(u.kind, u.motion), fields: predictors[u.kind] ? thawFields(kindOf.get(u.kind)?.fields ?? [], u.fields) : u.fields };
  }
  /** The game's guarded `move` for one tick, counted as the server counts it, with the result rounded as the server rounds it. */
  const substepKinds = new Set<string>();
  const movementCache = new Map<string, {scene: unknown; value: ReturnType<typeof stepMove>}>();
  function runMove(kindName: string, body: { pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; motion: Record<string, unknown> }, input: Readonly<Record<string, unknown>>, t: number): typeof body & {steps?: readonly import('./substeps.ts').StepPose[]} {
    const fn = moves[kindName];
    if (!fn || (kindOf.get(kindName)?.control && !body.motion[kindOf.get(kindName)!.control!])) return body;
    moveTick = t;
    // Like snapshot unpacking, prepare the bounded geometry outside the handler
    // quota. Authority debits projection once per tick, not once per mover.
    const scene = geometryAt();
    // Reconciliation often replays the exact same deterministic movement. Cache
    // its full arguments, including tick, self, motion and collision revision.
    // Stateful physics worlds must execute their operations and are excluded.
    const key = map.physics || kindOf.get(kindName)?.validatedOwner ? '' : JSON.stringify([mine?.id,kindName,t,body.pos,body.vel,body.heading,body.grounded,body.motion,input]);
    const cached = key ? movementCache.get(key) : undefined;
    if (cached?.scene === scene) return {...cached.value,motion:motionOf(kindName,cached.value.motion)};
    let failed = false;
    const out = stepMove(fn, body, input, moveCtx, Math.max(1, Math.floor(schema.settings.budget.tick / 4)), kindOf.get(kindName)?.motion ?? [], dims, (err) => { failed = true; if (!(err instanceof BudgetError)) console.warn('[room] move', err); });
    if (out.steps?.length) substepKinds.add(kindName);
    const kind = kindOf.get(kindName), r = kind?.radius ?? 0;
    const height = kind?.height || 2 * r;
    out.pos = vec3(boundPosition(out.pos,map,r,height,dims), dims);
    if (key && !failed) {
      movementCache.set(key,{scene,value:{...out,motion:motionOf(kindName,out.motion)}});
      if(movementCache.size>128)movementCache.delete(movementCache.keys().next().value!);
    }
    return out;
  }
  /* ---------------------------------------------------------------- the own actions, predicted (0.46.3) */

  const predictors = opts.predict ?? {};
  const predictionFieldNames = new Map(schema.kinds.map(k => [k.name, new Set(k.fields.map(([name]) => name))]));
  let predicting = false;
  let predictionFrame: Frame | null = null;
  function predictionEach(kind: string, fn: (e: Entity) => void): void {
    for (const u of (predictionFrame ?? latest)?.ents.values() ?? []) if (u.kind === kind) fn(entityOf(u, u.id === mine?.id));
  }
  interface Ghost { id: string; kind: string; tick: number; pos: Vec3; fields: Record<string, unknown>; until: number; match?: (e: Entity) => boolean; /** The server's entity that confirmed it: the ghost is drawn until that one is. */ real?: string }
  const ghosts = new Map<string, Ghost>();
  let ghostSeq = 0;
  let provisional: { name: string; tick: number; payload: Record<string, unknown>; match?: (e: any) => boolean }[] = [];
  /** What a tick's prediction has already shown, by tick and by the order it asked: a preview and the tick's own run show a thing once. */
  const shown = new Map<number, Set<string>>();
  let previewKey = '', previewFields: Record<string, unknown> | null = null;
  const ghostEntity = (g: Ghost): Entity => Object.freeze({ id: g.id, kind: g.kind, pos: g.pos, vel: ZERO3, heading: ZERO3, grounded: false, provisional: true, ...g.fields, motion: Object.freeze({}) }) as Entity;
  const ZERO3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
  function dropPredictions(): void {
    for (const g of ghosts.values()) if (!g.real) emit('retract', { ghost: g.id, kind: g.kind, at: g.pos, tick: g.tick });
    for (const x of provisional) emit('retract', { ...x.payload, effect: x.name, tick: x.tick });
    ghosts.clear(); provisional = []; shown.clear(); previewKey = ''; previewFields = null;
  }
  /**
   * The game's predictor for one tick of the own body. `live` is false while a snapshot's pending inputs are run again:
   * that run only brings the fields up to date, and shows nothing.
   */
  function runPredict(kindName: string, body: { pos: Vec3; vel: Vec3; heading: Vec3; grounded: boolean; motion: Record<string, unknown> }, fields: Record<string, unknown>, input: Readonly<Record<string, unknown>>, t: number, live: boolean, preview: boolean): void {
    const fn = predictors[kindName], kind = kindOf.get(kindName);
    if (!fn || !kind || !mine) return;
    const id = mine.id;
    // What a run asks to show is told apart by what it is (the name and the game's `key`), then by how many of that this
    // run has asked for: never by the order of everything asked, which changes when another action joins the tick.
    const asked = new Map<string, number>();
    const once = (what: string): boolean => { if (!live) return false; let set = shown.get(t); if (!set) { set = new Set(); shown.set(t, set); } const n = asked.get(what) ?? 0; asked.set(what, n + 1); const key = what + '#' + n; if (set.has(key)) return false; set.add(key); return true; };
    // Branded as a world is (0.46.5): a guarded helper of the rules may call its queries, so the server's own aiming
    // code can be run on it instead of being restated in the view.
    const ctx: PredictContext = brand({
      tick: t, dt: 1 / tickHz, preview, math, each: predictionEach,
      judgedTick: (aimTick) => Math.max(t - rewindAllowance(), Math.min(t, Number(aimTick) || 0)),
      get viewTick() { return viewTickNow(); },
      ray: (from, direction, max, options) => viewRay(from, direction, max, options)[0],
      rays: (options) => raySnapshot(mapAt(t), viewTargets(atTickOf(options)), dims, options, id),
      rayAll: (from, direction, max, options) => viewRay(from, direction, max, options, true),
      ghost(kindOfGhost, at, data = {}, options = {}) {
        const k = kindOf.get(kindOfGhost);
        if (!k) { console.warn(`[room] predict: no kind "${kindOfGhost}"`); return ''; }
        if (!once('g:' + kindOfGhost + ':' + (options.key ?? ''))) return '';
        const g: Ghost = { id: `~${++ghostSeq}`, kind: kindOfGhost, tick: t, pos: vec3(at, dims), fields: coerceFields(k.fields, { ...initFields(k.fields, dims), ...data }, dims), until: clock() + (options.seconds ?? 2) * 1000, match: options.match };
        ghosts.set(g.id, g);
        emit('enter', ghostEntity(g));
        return g.id;
      },
      effect(name, at, data = {}, options = {}) {
        if (!schema.effects[name]) { console.warn(`[room] predict: no effect "${name}" is declared in shapes.effects`); return; }
        if (!once('e:' + name + ':' + (options.key ?? ''))) return;
        const target = typeof at === 'string' ? at : null;
        const payload = { ...data, at: target ? get(target)?.pos ?? null : vec3(at as Vec3, dims), ...(target ? { id: target } : {}), tick: t };
        // The server's own effect may already be here, waiting for its tick to be drawn (it acted before this browser
        // stepped the tick, and its snapshot is still on the way): that one is this prediction's confirmation.
        const waiting = fxQueue.find((x) => x.name === name && !x.confirms && (!options.match || safe(() => options.match!({ ...x.data, ...(typeof x.at === 'string' ? { id: x.at } : { at: unpackVec(x.at, dims) }), tick: x.tick }))));
        if (waiting) waiting.confirms = true; else provisional.push({ name, tick: t, payload, match: options.match });
        emit(name, Object.freeze({ ...payload, predicted: true }));
      },
    });
    const me = Object.assign(fields, { id, kind: kindName }) as Record<string, unknown>;
    for (const [key, value] of Object.entries({ pos: body.pos, vel: body.vel, heading: body.heading, grounded: body.grounded, motion: body.motion })) Object.defineProperty(me, key, { value, enumerable: false, configurable: true, writable: true });
    const wasPredicting = predicting, previousFrame = predictionFrame;
    predicting = true; predictionFrame = latest;
    try { fn(me, input, ctx); } catch (err) { console.warn('[room] predict', err); }
    finally { predicting = wasPredicting; predictionFrame = previousFrame; }
    // What it wrote is held to the declared types, as the server holds its own writes.
    for (const [name, fd] of kind.fields) fields[name] = coerce(fd, fields[name], dims);
    for (const key of Object.keys(fields)) if (!predictionFieldNames.get(kindName)!.has(key)) delete fields[key];
  }
  /** After a snapshot: a ghost or a provisional effect whose tick the server has run without confirming it is taken back. */
  function settlePredictions(f: Frame, before: Frame | null, ack: number): void {
    if (ghosts.size) {
      for (const [id, u] of f.ents) {
        if (before?.ents.has(id)) continue;
        const e = entityOf(u);
        for (const g of ghosts.values()) if (!g.real && g.kind === u.kind && (g.match ? safe(() => g.match!(e)) : distance(u.pos, g.pos) <= 1)) { g.real = u.id; g.until = Infinity; emit('confirm', { ghost: g.id, id: u.id, kind: g.kind, tick: g.tick }); break; }
      }
      const now = clock();
      for (const g of [...ghosts.values()]) if (g.real ? !f.ents.has(g.real) : (ack >= g.tick && f.k >= g.tick) || now >= g.until) { ghosts.delete(g.id); if (!g.real) emit('retract', { ghost: g.id, kind: g.kind, at: g.pos, tick: g.tick }); emit('leave', ghostEntity(g)); }
    }
    if (provisional.length) {
      const gone = provisional.filter((x) => ack >= x.tick && f.k > x.tick);
      if (gone.length) { provisional = provisional.filter((x) => !gone.includes(x)); for (const x of gone) emit('retract', Object.freeze({ ...x.payload, effect: x.name })); }
    }
    for (const t of shown.keys()) if (t < f.k - tickHz) shown.delete(t);
  }
  const safe = (fn: () => boolean): boolean => { try { return fn() === true; } catch { return false; } };

  /** The input values the last step held (a press is never held). */
  let held: Readonly<Record<string, unknown>> = Object.freeze({});
  /*
   * `f.held()` inputs (0.46.3). A step takes one value a tick, read at the tick's edge: a key down for 60 ms of a 50 ms
   * tick then moves the body for one tick or for two, by where the edges fell. A held field is instead the MEAN of what
   * the control read over the tick's own span, so the body moves for the part of the tick the key was down, the same on
   * the server as here. Each field keeps its changes since the last edge it was read up to: [when (ms), value from then].
   */
  const heldTrack = new Map<string, { from: number; changes: [number, number][] }>();
  const heldNumber = (v: unknown, init: unknown): number => { const x = v === undefined ? init : v; return x === true ? 1 : typeof x === 'number' && Number.isFinite(x) ? x : 0; };
  /** When tick `t` begins on this browser's clock, in ms. */
  const edgeOf = (t: number): number => (base ? base.at + (t - base.tick) * period / speed : clock());
  /** The mean of a held field from its last edge to `end`. `advance` moves the edge there; without it the tick is not over, and what is left of it (to `fill`) counts at the value the control reads now. */
  function heldMean(name: string, init: unknown, end: number, advance: boolean, fill = end): number {
    const now = heldNumber(sample[name], init);
    let tr = heldTrack.get(name);
    if (!tr) { tr = { from: end, changes: [[end, now]] }; heldTrack.set(name, tr); }
    const span = fill - tr.from;
    let sum = 0, value = tr.changes[0][1];
    if (span > 0.001) {
      let at = tr.from;
      for (const [when, next] of tr.changes) { const w = Math.min(Math.max(when, tr.from), end); if (w > at) { sum += value * (w - at); at = w; } if (when <= end) value = next; }
      if (end > at) sum += value * (end - at);
      if (fill > end) sum += now * (fill - end);
    }
    const mean = span > 0.001 ? sum / span : now;
    if (advance) { tr.changes = [[end, value], ...tr.changes.filter((c) => c[0] > end)]; tr.from = end; }
    return mean;
  }
  /** One step of the own body on tick `t`: the input step, `move`, and an entry when the sample or the claim changed. */
  function step(t: number, fresh = true): void {
    const kind = myKind();
    if (!mine || !kind) return;
    if(fresh && pulseQueue.length && pulseQueue[0].t<=t){const p=pulseQueue.shift()!;pressed.set(p.name,p.value);pulseNumber.set(p.name,p.n);}
    const values: number[] = [];
    const input: Record<string, unknown> = {};
    let press = false;
    for (const [name, fd] of kind.input) {
      if (fd.t === 'press' || fd.t === 'pulse') { const on = fresh ? (pressed.get(name) ?? (fd.t === 'press' ? false : 0)) : (fd.t === 'press' ? false : 0); input[name] = on; values.push(fd.t === 'pulse' ? 0 : Number(on)); if (on) press = true; } else if (fd.t === 'held') { const v = coerce(fd, heldMean(name, fd.init, edgeOf(t), true), dims) as number; input[name] = v; values.push(v); } else { const v = coerce(fd, (fresh ? sample[name] : held[name]) ?? fd.init, dims); input[name] = v; values.push(v === true ? 1 : v === false ? 0 : v as number); }
    }
    const numbered = fresh && pulseNumber.size ? Object.fromEntries(pulseNumber) : undefined;
    if (fresh) { pressed = new Map(); pulseNumber = new Map(); }
    held = Object.freeze({ ...input });
    {
      moveTick = t;
      // A rendered full-tick forecast is already the guarded physics result.
      // Commit it only when every input and collision revision still agrees.
      const reuse = kind.validatedOwner && !map.physics && substepKinds.has(kind.name) && forecast && forecast.mine === mine && forecast.pos === mine.pos && forecast.motion === mine.motion && forecast.tick === t - 1 && forecast.key === JSON.stringify(held) && forecast.geometry === geometryAt();
      const body = reuse ? forecast!.next : runMove(kind.name, { pos: mine.pos, vel: mine.vel, heading: mine.heading, grounded: mine.grounded, motion: mine.motion }, held, t);
      forecast = null;
      mine.pos = body.pos; mine.vel = body.vel; mine.heading = body.heading; mine.grounded = body.grounded; mine.motion = body.motion;
      runPredict(kind.name, body, mine.fields, held, t, true, false);
      previewKey = '';
    }
    const claim = kind.owner ? [mine.pos.x, mine.pos.y, mine.pos.z, mine.vel.x, mine.vel.y, mine.vel.z, mine.heading.x, mine.heading.y, mine.heading.z, ...(kind.validatedOwner ? [ownerBaseTick] : [])] : [];
    const sig = kind.validatedOwner ? '' : JSON.stringify([values, claim]);
    if (kind.validatedOwner || sig !== lastSent || press || controlChanges.length) { entries.push({ t, row: [...values, ...claim, -471, ++inputSequence, controlChanges.length, ...controlChanges.flat()] }); pending.push({ seq: inputSequence, t, input: held, ...(numbered ? { pulses: numbered } : {}) }); lastSent = sig; }
    if (kind.validatedOwner && pending.length>OWNER_REPORT_LIMIT) pending.splice(0,pending.length-OWNER_REPORT_LIMIT);
    controlChanges = [];
    if (!kind.validatedOwner) {
      history.set(t, copyMine(mine));
      for (const k of history.keys()) if (k < t - tickHz && (catchTick === null || k < Math.floor(catchTick))) history.delete(k);
    }
  }
  /**
   * The end of a send period (`sendEvery` ticks, counted from tick 0): one frame with the entries made in it, `k` the
   * period's first tick. A period with no entry sends nothing; after 250 ms without a frame the held values are sent
   * again as an ordinary entry on the current tick.
   */
  function flush(now: number, t: number): void {
    if (!mine) { entries = []; return; }
    if (!myKind()?.validatedOwner && !entries.length && now - lastSendAt >= 250) keepalive(t);
    const marker = myKind()!.input.length + (myKind()!.validatedOwner ? 10 : myKind()!.owner ? 9 : 0);
    // A newer tick's acknowledgement cannot acknowledge a hole in the history.
    if (!entries.length && !sentHistory.some(e => !applications.has(e.row[marker + 1]))) return;
    const k = Math.min(entries[0]?.t ?? t, t - (t % sendEvery));
    for (const entry of entries) {
      const old = sentHistory.findIndex(e => e.t === entry.t);
      if (old >= 0) sentHistory[old] = entry; else sentHistory.push(entry);
    }
    // Cover an authority round trip and jitter. Missing application receipts measure
    // recovery delay (whether a dropped frame or a TCP stall): widen the history
    // until they return, without allowing an unbounded packet or retained history.
    const missing = sentHistory.find(e => (myKind()?.validatedOwner || e.t <= (latest?.k ?? 0)) && !applications.has(e.row[marker + 1]));
    const recoveryTicks = missing ? t - missing.t + 2 * sendEvery : 0;
    const historyCap = myKind()?.validatedOwner ? OWNER_REPORT_LIMIT : 64;
    const windowTicks = Math.min(historyCap, Math.max(4, recoveryTicks, Math.ceil((2 * authorityRtt() + 250) / period + targetLead())));
    let kept = 0;
    for (const e of sentHistory) if (e.t >= t - windowTicks) sentHistory[kept++] = e;
    sentHistory.length = kept;
    if (kept > historyCap) sentHistory.splice(0, kept - historyCap);
    const first = Math.min(k, sentHistory[0]?.t ?? k);
    // Repeated history must fit the relay's existing byte cap, including its
    // envelope and snapshot acknowledgement. Always carry the newest controls;
    // spend the remaining space on missing receipts before acknowledged history.
    // Sub-tick samples are optional metadata: the row already contains the held
    // duration integrated by heldMean. Never truncate its values or sequence.
    const budget = LIMITS.in - 128;
    const selected: OutgoingEntry[] = [];
    let bytes = 2;
    const newest = sentHistory.at(-1);
    const select = (e: OutgoingEntry): void => {
      // Do not allocate rows for reports the byte budget will discard. The
      // old path built both compact and expanded copies on every resend.
      if (e.compactBytes === undefined) {
        const prefixBytes = JSON.stringify(e.row.slice(0, marker + 2)).length;
        e.compactBytes = prefixBytes + 3;
        e.extraBytes = JSON.stringify(e.row).length - prefixBytes - 2;
      }
      const size = e.compactBytes + String(e.t - first).length + (selected.length ? 1 : 0);
      if (bytes + size > budget) return;
      e.expanded = false; selected.push(e); bytes += size;
    };
    if (newest) select(newest);
    for (const e of sentHistory) if (e !== newest && !applications.has(e.row[marker + 1])) select(e);
    for (let i = sentHistory.length - 1; i >= 0; i--) {
      const e = sentHistory[i];
      if (e !== newest && applications.has(e.row[marker + 1])) select(e);
    }
    // Preserve the same priority for optional sub-tick metadata.
    for (const e of selected) if (bytes + e.extraBytes! <= budget) { e.expanded = true; bytes += e.extraBytes!; }
    selected.sort((a, b) => a.t - b.t);
    const rows: StepEntry[] = selected.map(e => {
      const length = e.expanded ? e.row.length : marker + 3;
      const row: StepEntry = new Array(length + 1);
      row[0] = e.t - first;
      for (let i = 0; i < length; i++) row[i + 1] = !e.expanded && i === marker + 2 ? 0 : e.row[i];
      return row;
    });
    entries = [];
    if (net.steps(epoch, first, rows, mine.r)) lastSendAt = now;
  }
  /** The held values as an entry on tick `t`, without stepping the body again. */
  function keepalive(t: number): void {
    const kind = myKind();
    if (!mine || !kind) return;
    const values = kind.input.map(([name, fd]) => ((fd.t === 'press' || fd.t === 'pulse') ? 0 : fd.t === 'held' ? Number(coerce(fd, heldNumber(sample[name], fd.init), dims)) : Number(coerce(fd, sample[name] ?? fd.init, dims))));
    const claim = kind.owner ? [mine.pos.x, mine.pos.y, mine.pos.z, mine.vel.x, mine.vel.y, mine.vel.z, mine.heading.x, mine.heading.y, mine.heading.z, ...(kind.validatedOwner ? [ownerBaseTick] : [])] : [];
    entries = [{ t, row: [...values, ...claim, -471, ++inputSequence, controlChanges.length, ...controlChanges.flat()] }]; pending.push({ seq: inputSequence, t, input: Object.fromEntries(kind.input.map(([name, fd], i) => [name, fd.t === 'press' ? false : values[i]])) }); lastSent = JSON.stringify([values, claim]);
  }
  let pumping = false;
  function pump(): void {
    // A predictor's own queries read the room, and reading the room pumps: a step is never begun inside a step.
    if (closed || pumping || predicting) return;
    pumping = true;
    try { pumpOnce(); } finally { pumping = false; }
  }
  function pumpOnce(): void {
    if (net.offline && !net.rulesHosting) setStatus(net.closedWhy ? 'closed' : 'offline');
    const now = clock();
    checkSolo(now);
    const hidden = typeof document !== 'undefined' && document.hidden === true;
    // Effects play for everyone who draws the room: a watcher has no body and still sees them.
    fire();
    if (!mine || !base || net.seat === null || (net.link === 'closed' || !myKind()?.validatedOwner && !net.connected && !net.rulesHosting)) return;
    if (hidden) {
      // A hidden tab's timers are too slow to keep input alive, and a body must not run on without its player:
      // one neutral entry at once (every field at its init, no press), then no more steps until the tab shows again.
      if (!hiddenSent) { hiddenSent = true; sample = {}; pressed = new Map(); heldTrack.clear(); const t = Math.floor(tickAt(now)) + 1; if (!myKind()?.validatedOwner) keepalive(t); lastSendAt = 0; flush(now, t); }
      base = null;
      return;
    }
    hiddenSent = false;
    // Feedback can be sparse (idle keepalives or dropped snapshots). Re-evaluate the
    // steering every frame so a stale +/-5% command cannot drive past its target.
    steer(now);
    let t = Math.floor(tickAt(now));
    // A frame longer than a quarter of a second: set the clock again from the newest snapshot and carry on from there.
    if (t - stepped > Math.ceil(tickHz / 4) && latest) {
      if (myKind()?.validatedOwner) { base={tick:stepped,at:now}; heldTrack.clear(); t=stepped; }
      else { rebase(latest.k, 'frame'); t = Math.floor(tickAt(now)); }
    }
    while (stepped < t) {
      stepped += 1;
      step(stepped, stepped === t);
      // fire() can read/cache the own entity before this pump advances it.
      // A renderer later in the same callback must see the completed step,
      // not hold that effect's old pose until the next (possibly early) frame.
      presentedEntity = null;
      if (stepped % sendEvery === sendEvery - 1) flush(now, stepped);
    }
  }

  function onSnapshot(s: Snapshot<unknown>): void {
    const wasPumping = pumping;
    pumping = true;
    try { applySnapshot(s); } finally { pumping = wasPumping; }
  }
  function applySnapshot(s: Snapshot<unknown>): void {
    const f = frameOf(s);
    if (!f) return;
    const before = latest;
    if (before && before.e === f.e && f.k <= before.k) return;
    latest = f;
    // Ordinary rooms already use net.sample's bounded history; retain a second
    // history only when accepted owner reports need the shared scene clock.
    if (hasValidatedOwners) {
      if (before && before.e !== f.e) { sceneHistory.length = 0; sceneCursor = null; }
      for (const [id, q] of ownerHistory) if (q.epoch !== f.e || !f.ents.has(id)) ownerHistory.delete(id);
      for (const [id, u] of f.ents) {
        if (!kindOf.get(u.kind)?.validatedOwner || u.driver !== 'person' || u.ownerTick === undefined || u.ownerTick < 0) continue;
        let q = ownerHistory.get(id);
        if (!q || q.epoch !== f.e || q.r !== u.r) { q={epoch:f.e,r:u.r,placedAt:f.k,samples:[],...(q?.epoch===f.e?{previous:q}:{})};ownerHistory.set(id,q); }
        if (sceneCursor !== null && sceneCursor >= q.placedAt) q.previous = undefined;
        // Retain no more placement history than the bounded scene history can use.
        let oldestRevision = q;
        const oldestTick = sceneHistory[0]?.k ?? f.k;
        while (oldestRevision.previous && oldestRevision.placedAt > oldestTick) oldestRevision = oldestRevision.previous;
        oldestRevision.previous = undefined;
        if (!q.samples.length || u.ownerTick > q.samples.at(-1)!.t) q.samples.push({t:u.ownerTick,u});
        while (q.samples.length > 2 && sceneCursor !== null && q.samples[1].t < sceneCursor - 2) q.samples.shift();
        if (q.samples.length > 512) q.samples.shift();
      }
      sceneHistory.push(s);
      if (sceneHistory.length > 512) sceneHistory.shift();
      sceneCached = null;
    }
    if (before && before.e !== f.e) held2.length = 0;
    held2.push(f); if (held2.length > 2 * tickHz) held2.shift();
    if (!before || before.e !== f.e) collisionHistory = [];
    const collision = f.collision;
    if (collision) {
      collisionHistory.push(collision);
      if (collisionHistory.length > 128) collisionHistory.shift();
    }
    if (before && before.e !== f.e) hostAges.length = 0;
    hostAges.push(Math.max(0, net.now() - s.st)); if (hostAges.length > 40) hostAges.shift();
    hostMedian = quantile(hostAges, .5);
    if (before && before.e !== f.e) fxQueue.length = 0;
    const changedEpoch = f.e !== epoch;
    if (changedEpoch) { presented=null; routing=null; route=[]; }
    epoch = f.e;
    const seat = net.seat;
    let me: Unpacked | null = null;
    if (seat !== null) for (const u of f.ents.values()) if (u.seat === seat && u.driver === 'person') { me = u; break; }
    if (me) {
      const placed = !mine || mine.id !== me.id || mine.r !== me.r || changedEpoch;
      const row = f.rows.find((x) => x[0] === seat);
      if(changedEpoch)applications.clear();
      if(row?.[6]===471){for(let i=7;i+1<row.length;i+=2)applications.set(row[i],row[i+1]);while(applications.size>128)applications.delete(applications.keys().next().value!);}
      // A return hands the body back at the server's pose with a new revision. It is the same body, still on the
      // screen: keep drawing it from where it is shown unless the game says it was really placed meanwhile.
      const prior = held2.at(-2)?.ents.get(me.id) ?? null;
      if (!kindOf.get(me.kind)?.validatedOwner && placed && !changedEpoch && returningUntil > clock() && mine?.id === me.id && mine.r !== me.r && presented?.id === me.id && presented.r === mine.r) {
        let respawn = false;
        if (opts.respawned && prior) { try { respawn = Boolean(opts.respawned(entityOf(prior, true, false), entityOf(me, true, false))); } catch (err) { console.warn('[room] respawned', err); } }
        if (!respawn) { presented.r = me.r; presented.at = clock(); }
        returningUntil = 0;
      }
      if (placed || !base) {
        adopt(me); rebase(f.k, changedEpoch ? 'epoch' : 'placement');
        if (placed) emit('placed', entityOf(me, true));
      } else if (kindOf.get(me.kind)?.owner) {
        if (kindOf.get(me.kind)?.validatedOwner) {
          const accepted = me.ownerTick ?? -1;
          pending = pending.filter(e=>e.t>accepted && !applications.has(e.seq!));
          // A contiguous accepted tick or an explicit receipt retires its report.
          // Otherwise a long recovery can forget an old receipt and resend that
          // acknowledged prefix ahead of the missing path forever.
          const marker = kindOf.get(me.kind)!.input.length + 10;
          sentHistory = sentHistory.filter(e=>e.t>accepted && !applications.has(e.row[marker+1]));
          const now = clock();
          const error = tickAt(now) - (f.k + ownerArrivalLead());
          // Snapshots acknowledge the room clock even when no input was accepted.
          // Small drift changes cadence, never the pose. Ahead-of-room reports
          // outside the validation window cause an explicit placement revision.
          base = {tick:tickAt(now),at:now};
          speed = 1 - Math.max(-.02,Math.min(.02,error * .01));
          if (tickAt(now) < f.k - tickHz && pending.length === 0) rebase(f.k, 'clock');
        }
        if (!kindOf.get(me.kind)?.validatedOwner) mine!.motion = motionOf(me.kind, me.motion);
        if (predictors[me.kind]) mine!.fields = thawFields(kindOf.get(me.kind)?.fields ?? [], me.fields);
      } else if (!pending.some(entry => entry.seq !== undefined && entry.t <= f.k && f.k - entry.t < tickHz && (applications.get(entry.seq) ?? Infinity) > f.k)) {
        // This snapshot predates an input we already predicted. Within the rewind
        // window it is provisional movement truth: wait for its application receipt
        // rather than briefly adopting the path made with the missing control.
        const previous = mine!.pos;
        const shownBody = meNow();
        const shown = shownBody?.pos ?? previous;
        const oldHeading = mine!.heading;
        const oldOffset = visualOffset(clock()), oldOffsets = offsets;
        adopt(me);
        history.set(f.k, copyMine(mine!));
        const ack = row?.[2] ?? 0;
        const scheduled = row?.[6] === 471;
        if (scheduled) for(let i=7;i+1<row.length;i+=2){
          if(row[i]>0){const entry=pending.find(e=>e.seq===row[i]);if(entry)entry.applied=row[i+1];}
          else for(const entry of pending)for(const [name,n] of Object.entries(entry.pulses??{}))if(n===-row[i]){entry.pulseTicks??={};entry.pulseTicks[name]=row[i+1];}
        }
        const appliedAt = (entry: (typeof pending)[number]): number => entry.applied ?? entry.t;
        // A numbered pulse is still to come while the server's row has not reached its number (0.46.3): its own message
        // can be later than the input frame of its tick, so the input's acknowledgement says nothing about it.
        while(pulseQueue.length && pulseQueue[0].n <= (row?.[4] ?? 0))pulseQueue.shift();
        const taken = typeof row?.[4] === 'number' ? row[4] : null;
        const owed = (entry: (typeof pending)[number], name: string): boolean => { const n = entry.pulses?.[name]; return taken !== null && n !== undefined ? n > taken : entry.t > ack; };
        const fresh = (entry: (typeof pending)[number]): boolean => f.k + 1 - entry.t <= Math.ceil(tickHz / 4);
        const late = new Map<string, unknown>();
        // Held input the server had not received when it ran its tick (0.46.3): those ticks ran on the values before, and
        // the server settles the difference on its next ticks (host.ts). The replay owes the same, so the body is
        // predicted where the server will bring it and not where a late frame left it for a moment.
        const heldFields = myKind()!.input.filter(([, fd]) => fd.t === 'held').map(([name]) => name);
        const debt: Record<string, number> = {};
        if (heldFields.length && !scheduled) {
          for (const entry of pending) if (entry.t <= ack) for (const name of heldFields) serverHeld[name] = Number(entry.input[name]) || 0;
          const waiting = pending.filter((entry) => entry.t > ack && entry.t <= f.k && fresh(entry));
          if (waiting.length) for (let i = waiting[0].t; i <= f.k; i++) {
            let meant: Readonly<Record<string, unknown>> | null = null;
            for (const entry of waiting) if (entry.t <= i) meant = entry.input;
            if (meant) for (const name of heldFields) debt[name] = (debt[name] ?? 0) + (Number(meant[name]) || 0) - (serverHeld[name] ?? 0);
          }
        }
        for (const entry of pending) if (appliedAt(entry) <= f.k) {
          replayHeld = entry.input;
          if ((!scheduled || entry.applied === undefined) && fresh(entry))
            for (const [name, fd] of myKind()!.input) if ((fd.t === 'press' || fd.t === 'pulse') && entry.input[name] && (fd.t === 'pulse' ? owed(entry, name) : entry.t > ack)) late.set(name, entry.input[name]);
        }
        // After a reset nothing is held yet: the replay runs on every field's own zero, never on an input with no fields
        // (a `move` that reads `input.yaw` would be handed `undefined`).
        let input = replayHeld;
        if (!Object.keys(input).length) { const zero: Record<string, unknown> = {}; for (const [name, fd] of myKind()!.input) zero[name] = fd.t === 'press' ? false : fd.t === 'pulse' ? 0 : coerce(fd, fd.init, dims); input = Object.freeze(zero); }
        for (let t = f.k + 1; t <= stepped; t++) {
          const presses = new Map(t === f.k + 1 ? late : []);
          for (const entry of pending) {
            if(appliedAt(entry)===t)input = entry.input;
            for (const [name, fd] of myKind()!.input) if ((fd.t === 'press' || fd.t === 'pulse') && entry.input[name] && (fd.t==='pulse' ? (entry.pulseTicks?.[name]??entry.t)===t : appliedAt(entry)===t)) presses.set(name, entry.input[name]);
          }
          const stepInput = { ...input };
          for (const [name, fd] of myKind()!.input) if (fd.t === 'press' || fd.t === 'pulse') stepInput[name] = presses.get(name) ?? (fd.t === 'press' ? false : 0);
          for (const name of heldFields) if (debt[name]) { const level = Number(stepInput[name]) || 0, range = Math.max(1, Math.abs(level)), want = level + debt[name], paid = Math.max(-range, Math.min(range, want)); stepInput[name] = paid; debt[name] = want - paid; }
          Object.assign(mine!, runMove(me.kind, mine!, Object.freeze(stepInput), t));
          runPredict(me.kind, mine!, mine!.fields, stepInput, t, false, false);
          history.set(t, copyMine(mine!));
        }
        pending = pending.filter(e => appliedAt(e) > f.k || (scheduled && ((e.applied === undefined && f.k-e.t<tickHz) || Object.keys(e.pulses??{}).some(name=>owed(e,name)))) || !scheduled && fresh(e) && (e.t > ack || Object.keys(e.pulses ?? {}).some((name) => owed(e, name))));
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
          const change = { x: periodicDelta(corrected.x,shown.x,map.wrap?.x) - oldOffset.x, y: periodicDelta(corrected.y,shown.y,map.wrap?.y) - oldOffset.y, z: periodicDelta(corrected.z,shown.z,map.wrap?.z) - oldOffset.z };
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
      if (!myKind()?.validatedOwner && !latencyCalibrated && authorityRtt() > calibratedRtt + period && !Object.values(sample).some(Boolean) && !pending.some(e=>Object.values(e.input).some(Boolean))) { rebase(f.k, 'lead'); latencyCalibrated = true; }
      if (!myKind()?.validatedOwner && row && row[3] !== -128 && base && clock() >= leadAfter) {
        const now = clock(), rtt = authorityRtt();
        // A reported lead describes an input sent roughly one authority round trip ago. Remove that
        // clock's phase before measuring jitter; project the control median onto today's phase. Otherwise
        // our own +/-5% steering inflates the 40-sample jitter window and winds the clock ever further ahead.
        observedLeadAt = now;
        leads.push(row[3] / 16 - phaseAt(now - rtt)); if (leads.length > 40) leads.shift();
        leadTarget = .5 + Math.max(0, quantile(leads, .5) - quantile(leads, .05));
        leadMedian = quantile(leads.slice(-8), .5);
        const med = medianLead(), target = targetLead();
        // A changing jitter estimate must not discard already stamped input. Slew the
        // clock; late movement is settled by the server's retained history.
        steer(now);
      }
      previewKey = '';
      settlePredictions(f, before && before.e === f.e ? before : null, row?.[2] ?? 0);
    } else { if (mine) dropPredictions(); mine = null; }
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
    const s = sceneSample();
    const drawn = s ? lerp(s.a.k, s.b.k, s.alpha) : latest ? latest.k : 0;
    for (let i = 0; i < fxQueue.length;) {
      const x = fxQueue[i];
      const ownTick = catchTick === null ? tickAt(clock()) : catchTick + Math.max(0, clock() - catchAt) / period * predict.catchUp;
      if (!x.confirms && x.tick > (x.at === mine?.id ? Math.min(latest?.k ?? 0, ownTick) : drawn)) { i++; continue; }
      fxQueue.splice(i, 1);
      const id = typeof x.at === 'string' ? x.at : null;
      const where = id ? get(id)?.pos ?? null : unpackVec(x.at, dims);
      emit(x.name, Object.freeze({ ...x.data, at: where, ...(id ? { id } : {}), tick: x.tick, ...(x.confirms ? { confirms: true } : {}) }));
    }
  }

  net.on('snapshot', onSnapshot);
  net.on('role', (e) => { if (e.snap) onSnapshot(e.snap); if (net.offline && !net.rulesHosting) setStatus(net.closedWhy ? 'closed' : 'offline'); });
  net.on('link', (e) => {
    if (e.why === 'subscribe') return;
    if (e.state === 'online') { returningUntil = clock() + 3000; if (!myKind()?.validatedOwner) base = null; if (status !== 'playing') setStatus('connecting'); } else if (e.state === 'closed') setStatus('closed'); else if (e.state === 'alone' || e.state === 'offline') setStatus('offline');
  });
  net.on('round', (r) => { if (r.results) { results = r.results; if (round) { round = { ...round, results }; emit('round', roundNow()); } } });
  net.on('event', (e) => {
    if (e.k === 'fx' && Array.isArray(e.d)) {
      const [tick, list] = e.d as [number, [number, unknown, unknown][]];
      for (const [i, at, data] of Array.isArray(list) ? list : []) {
        const name = schema.effectNames[i];
        if (!name) continue;
        const item: (typeof fxQueue)[number] = { tick: Number(tick) || 0, name, at, data: unpackFields(schema.effects[name] as FieldList, data, dims) };
        // The server's word on something this browser already showed (a predictor's `ctx.effect`): it confirms it.
        if (provisional.length) {
          const probe = { ...item.data, ...(typeof at === 'string' ? { id: at } : { at: unpackVec(at, dims) }), tick: item.tick };
          const n = provisional.findIndex((x) => x.name === name && (!x.match || safe(() => x.match!(probe))));
          if (n >= 0) { provisional.splice(n, 1); item.confirms = true; }
        }
        fxQueue.push(item);
      }
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
  let routing: ReturnType<typeof correctionPath> | null = null;
  let route: Vec3[] = [];
  let routeDirection = 0;
  let presentedEntity: Entity | null = null;
  let ownDescription: {server:Unpacked; fields:Record<string,unknown>; motion:Record<string,unknown>; tick:number; entity:Entity} | null = null;
  let presentationQueued = false;
  let presentationFrame: number | null = null;
  let forecast: { mine: Mine; pos: Vec3; motion: Record<string, unknown>; tick: number; key: string; geometry: unknown; next: ReturnType<typeof runMove> } | null = null;
  let presented: { id: string; r: number; pos: Vec3; vel: Vec3; at: number } | null = null;
  function meNow(present = false): Entity | null {
    // The document timeline is shared by all rAF callbacks in this browser
    // frame, including callbacks separated by microtasks. Inputs, snapshots and
    // actual simulation steps still invalidate the cached presentation at once.
    const timeline = typeof document === 'undefined' ? null : document.timeline?.currentTime;
    const frame = myKind()?.validatedOwner && typeof timeline === 'number' ? timeline : null;
    if (present && presentedEntity && (frame === null || frame === presentationFrame)) return presentedEntity;
    if (predicting) { const u = mine && predictionFrame?.ents.get(mine.id); return u ? entityOf(u, true) : null; }
    if (solo) return solo.me;
    if (!mine || !latest) return null;
    const server = latest.ents.get(mine.id);
    if (!server) return null;
    const kind = kindOf.get(mine.kind);
    if (kind?.control && !server.motion[kind.control]) return entityOf(server, true);
    let pos = mine.pos;
    let safeOrigin = mine.pos;
    let heading = mine.heading;
    let velocity = mine.vel, grounded = mine.grounded, motion = mine.motion;
    let settled = true;
    let preview: ReturnType<typeof runMove> | null = null;
    if (kind && base) {
      const a = Math.max(0, Math.min(1, tickAt(clock()) - stepped));
      const now: Record<string, unknown> = {};
      // A held field previews as its mean over the part of the tick that has passed. The body is drawn that fraction of
      // the way to the preview, so it stands exactly where the control has carried it: it starts from rest at a press
      // and stops dead at a release, with nothing to blend away afterwards.
      // A recorded substep path needs the whole tick's forecast instead: include
      // the remaining duration of controls held now, then sample its actual steps.
      for (const [name, fd] of kind.input) now[name] = (fd.t === 'press' || fd.t === 'pulse') ? (pressed.get(name) ?? (fd.t === 'pulse' && pulseQueue[0]?.name===name ? pulseQueue[0].value : fd.t === 'press' ? false : 0)) : fd.t === 'held' ? coerce(fd, heldMean(name, fd.init, Math.min(clock(), edgeOf(stepped + 1)), false, substepKinds.has(kind.name) ? edgeOf(stepped + 1) : Math.min(clock(), edgeOf(stepped + 1))), dims) : coerce(fd, sample[name] ?? fd.init, dims);
      moveTick = stepped + 1;
      const forecastKey = JSON.stringify(now), scene = geometryAt();
      const reuse = !map.physics && substepKinds.has(kind.name) && forecast && forecast.mine === mine && forecast.pos === mine.pos && forecast.motion === mine.motion && forecast.tick === stepped && forecast.key === forecastKey && forecast.geometry === scene;
      const next = reuse ? forecast!.next : runMove(kind.name, { pos: mine.pos, vel: mine.vel, heading: mine.heading, grounded: mine.grounded, motion: mine.motion }, Object.freeze(now), stepped + 1);
      if (!reuse) forecast = {mine, pos:mine.pos, motion:mine.motion, tick:stepped, key:forecastKey, geometry:scene, next};
      if (!next.steps?.length) {
        // A landing does not take the whole tick (0.46.5): the body met the ground part way through it. How far through is
        // read from the fall it would have made at the speed it entered the tick with; it is drawn down to the ground by
        // then and standing from then, not sinking until the tick's end.
        let av = a, landed = false;
        if (dims === 3 && !mine.grounded && next.grounded && mine.vel.z < 0) {
          const free = -mine.vel.z / tickHz, contact = free > 1e-6 ? Math.max(0.05, Math.min(1, (mine.pos.z - next.pos.z) / free)) : 1;
          av = Math.min(1, a / contact); landed = a >= contact;
        }
        pos = vec3({...blendPosition(mine.pos,next.pos,a,map.wrap), z:wrapPoint({x:0,y:0,z:mine.pos.z+periodicDelta(mine.pos.z,next.pos.z,map.wrap?.z)*av},map.wrap).z}, dims);
        heading = blendHeading(mine.heading, next.heading, a, dims);
        velocity = vec3({ x: lerp(mine.vel.x, next.vel.x, a), y: lerp(mine.vel.y, next.vel.y, a), z: lerp(mine.vel.z, next.vel.z, a) }, dims);
        // A takeoff is airborne as soon as it rises; a landing waits for its contact.
        grounded = landed || mine.grounded && (a === 0 || next.grounded);
      }
      if (next.steps?.length) {
        const n = next.steps.length - 1, at = a * n, index = Math.min(n - 1, Math.floor(at)), f = at - index;
        const before = next.steps[index], after = next.steps[index + 1];
        safeOrigin = before.pos;
        pos = vec3(blendPosition(before.pos, after.pos, f, map.wrap), dims);
        // Some game steps land by lifting onto a tile corner. The straight line
        // between those valid poses crosses the tile. Opted-in owners show the
        // actual local physics step at that contact, never an embedded blend.
        if (kind.validatedOwner && dims === 2 && kind.shape === 'box') {
          const r = kind.radius;
          if (nearbyMap(mapAt(stepped),pos,{x:0,y:0,z:0},r,2*r,2).boxes.some(b => pos.x+r>b.min.x+1e-7 && pos.x-r<b.max.x-1e-7 && pos.y+r>b.min.y+1e-7 && pos.y-r<b.max.y-1e-7)) pos = after.pos;
        }
        heading = blendHeading(before.heading, after.heading, f, dims);
        velocity = vec3({x:lerp(before.vel.x,after.vel.x,f),y:lerp(before.vel.y,after.vel.y,f),z:lerp(before.vel.z,after.vel.z,f)},dims);
        grounded = f === 1 ? after.grounded : before.grounded && after.grounded;
      }
      preview = next;
      if (predictors[kind.name]) {
        // The own actions between ticks: the predictor on a copy of the fields, for the tick about to be stepped.
        const key = stepped + forecastKey;
        if (key !== previewKey) { previewKey = key; previewFields = thawFields(kind.fields, mine.fields); runPredict(kind.name, {...next, motion:motionOf(kind.name,next.motion)}, previewFields, Object.freeze(now), stepped + 1, true, true); }
      }
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
        if (a && b) { safeOrigin = a.pos; const f = catchTick - t; pos = blendPosition(a.pos, b.pos, f, map.wrap); heading = blendHeading(a.heading, b.heading, f, dims);
          velocity = vec3({ x: lerp(a.vel.x, b.vel.x, f), y: lerp(a.vel.y, b.vel.y, f), z: lerp(a.vel.z, b.vel.z, f) }, dims);
          grounded = a.grounded && (f === 0 || b.grounded); motion = a.motion;
        } else if (a) { safeOrigin = a.pos; pos = a.pos; heading = a.heading; velocity = a.vel; grounded = a.grounded; motion = a.motion; }
      }
    }
    // Two-dimensional presentation follows collision too: interpolation and reconciliation are not
    // permission to cross a floor. Sweep from a valid movement pose, never feed
    // the clipped drawing back into prediction or authority.
    const constrain = (from: Vec3, to: Vec3): Vec3 => {
      if (dims !== 2 || !kind || kind.owner || distance(from, to) < 1e-7) return to;
      const body = {pos: from};
      sweepMap(geometryAt(), body, {x:periodicDelta(from.x,to.x,map.wrap?.x),y:periodicDelta(from.y,to.y,map.wrap?.y),z:periodicDelta(from.z,to.z,map.wrap?.z)}, kind.radius, dims,
        {shape:kind.shape ?? 'circle',radius:kind.radius,height:kind.height || 2*kind.radius,terrain:kind.terrain});
      return body.pos;
    };
    // An established box cursor is swept below from the actual displayed side.
    // Sweeping its target from a second origin first duplicates the same query
    // and does not add safety. New placements and other body types keep it.
    const hasCursor = present && dims === 2 && kind?.shape === 'box' && !kind.owner && presented?.id === mine.id && presented.r === mine.r;
    if (!hasCursor) pos = constrain(safeOrigin, pos);
    if (!kind?.validatedOwner) {
      const offset = visualOffset(clock(), pos, settled);
      const offsetTarget = wrapPoint({ x: pos.x + offset.x, y: pos.y + offset.y, z: pos.z + offset.z },map.wrap);
      pos = hasCursor ? offsetTarget : constrain(pos, offsetTarget);
    }
    if (present && dims === 2 && kind?.shape === 'box' && !kind.owner) {
      const now = clock();
      if (presented && presented.id === mine.id && presented.r === mine.r) {
        const from = presented.pos;
        let forward = velocity.x * presented.vel.x >= 0 ? Math.sign(velocity.x) : 0;
        if (opts.correctionDirection) {
          try {
            const intent = opts.correctionDirection(sample, mine.vel);
            // An explicit intent must not be overridden by stale replay velocity.
            // A game can return neutral during genuine braking/reversal inertia.
            if (Number.isFinite(intent)) forward = Math.sign(intent);
          }
          catch (err) { console.warn('[room] correctionDirection', err); }
        }
        if ((routing || route.length) && forward !== routeDirection) { routing=null; route=[]; }
        routeDirection = forward;
        const routeGoal = routing?.goal ?? route.at(-1);
        if (routeGoal && distance(routeGoal, pos) > Math.max(2,kind.radius*4)) { routing=null; route=[]; }
        if (route[0] && forward * periodicDelta(from.x,route[0].x,map.wrap?.x) < -.001) { routing=null; route=[]; }
        if (route.length) {
          while(route.length && distance(from,route[0])<.01)route.shift();
        }
        const destination = route[0] ?? pos;
        const elapsed = Math.max(0, now - presented.at);
        // Bound presentation by time, including expiring offsets and changed catch-up paths.
        const length = distance(from, destination);
        // Falling cannot spend a horizontal correction. Corrections add only
        // blend speed to the actual movement, not a body's declared speed cap.
        const blendSpeed = kind.radius / Math.max(.1,predict.blendMs/1000);
        // Include the whole recorded tick's velocities: a takeoff/landing can
        // change velocity abruptly between samples without being a correction.
        let verticalSpeed = Math.max(Math.abs(velocity.y),Math.abs(presented.vel.y),Math.abs(mine.vel.y),Math.abs(preview?.vel.y ?? 0));
        const recorded = preview?.steps;
        if (recorded) for (let i=0;i<recorded.length;i++) verticalSpeed = Math.max(verticalSpeed,Math.abs(recorded[i].vel.y));
        // Leave headroom for a substep entered part-way through a render interval.
        verticalSpeed *= 1.5;
        const advance = (axis: 'x' | 'y') => {
          const delta = periodicDelta(from[axis],destination[axis],map.wrap?.[axis]);
          // A landing can set velocity to zero before the sampled pose reaches
          // contact. The adjacent movement velocities retain that real travel.
          const travel = axis === 'y' ? verticalSpeed : Math.max(Math.abs(velocity.x),Math.abs(presented!.vel.x));
          const allowance = (travel + blendSpeed) * elapsed / 1000;
          return from[axis]+Math.max(-allowance,Math.min(allowance,delta));
        };
        const target = {...wrapPoint({x:advance('x'),y:advance('y'),z:0},map.wrap)};
        // A route is a correction too: it cannot pull against continuing motion.
        if (forward * periodicDelta(from.x,target.x,map.wrap?.x) < 0) target.x = from.x;
        // A stalled frame cannot spend its whole elapsed-time allowance in one
        // visible jump. Keep backlog travel below 1.4 body widths per drawing;
        // authority/prediction keep their real clock and placements bypass this.
        const frameDistance = distance(from,target), frameLimit = Math.max(.1,kind.radius*2.8);
        if (frameDistance > frameLimit) {
          const fraction = frameLimit / frameDistance;
          target.x = from.x + periodicDelta(from.x,target.x,map.wrap?.x)*fraction;
          target.y = from.y + periodicDelta(from.y,target.y,map.wrap?.y)*fraction;
        }
        let next = constrain(from, target);
        // Slide the residual along the contact, starting on the side actually drawn.
        if (distance(next, target) > .002) {
          next = constrain(next, {x:target.x,y:next.y,z:0});
          next = constrain(next, {x:next.x,y:target.y,z:0});
        }
        if (!route.length && distance(next, target) > .01 && distance(from,next) < .01 && length > .1) {
          routing ??= correctionPath(from,pos,Math.max(.25,2*kind.radius));
          const found=routing.advance((a,b)=>forward * periodicDelta(a.x,b.x,map.wrap?.x) >= -.001 && distance(constrain(a,b),b)<.002);
          if(found) { route=[...found]; routing=null; }
        }
        pos = next;
      }
      if (!presented || presented.id !== mine.id || presented.r !== mine.r) { routing=null;route=[]; }
      presented = {id:mine.id,r:mine.r,pos,vel:velocity,at:now};
    }
    if (headingBlend) {
      const t = predict.blendMs > 0 ? Math.min(1, (clock() - headingBlend.at) / predict.blendMs) : 1;
      heading = blendHeading(headingBlend.from, heading, t, dims);
      if (t >= 1) headingBlend = null;
    }
    const fields = kind && predictors[kind.name] ? (base ? previewFields : null) ?? mine.fields : server.fields;
    // Field and motion descriptions change on simulation/input/snapshot edges,
    // while the interpolated pose changes each animation frame. Reuse the
    // immutable description without copying every declared field again.
    let result: Entity;
    if (kind?.validatedOwner) {
      if (!ownDescription || ownDescription.server !== server || ownDescription.fields !== fields || ownDescription.motion !== motion || ownDescription.tick !== stepped) ownDescription = {server,fields,motion,tick:stepped,entity:entityOf({...server,fields,motion},true)};
      result = Object.freeze({...ownDescription.entity,pos,vel:velocity,heading,grounded});
    } else result = entityOf({...server,fields,pos,vel:velocity,heading,grounded,motion},true);
    // Readers share one presentation in a browser frame. Without a document
    // timeline, retain the synchronous cache and clear at the microtask boundary.
    // Inputs, snapshots and simulation steps still invalidate immediately.
    if (present && typeof window !== 'undefined') {
      presentedEntity = result;
      presentationFrame = frame;
      if (frame === null && !presentationQueued) {
        presentationQueued = true;
        const clear = () => { presentedEntity = null; presentationQueued = false; };
        queueMicrotask(clear);
      }
    }
    return result;
  }
  // Accepted owner ticks and server ticks describe the same simulation clock.
  // Receipt time only decides how much history is available, never where one
  // body stands relative to another body's hazards.
  const hasValidatedOwners = schema.kinds.some(k => k.validatedOwner);
  const sceneHistory: Snapshot<unknown>[] = [];
  interface OwnerHistory { epoch:number; r:number; placedAt:number; samples:{t:number; u:Unpacked}[]; previous?:OwnerHistory }
  const ownerHistory = new Map<string, OwnerHistory>();
  let sceneCursor: number | null = null, sceneAt = 0, sceneFrame: number | null = null;
  let sceneCached: ReturnType<typeof net.sample> = null;
  function sceneSample(raw = net.sample()): ReturnType<typeof net.sample> {
    if (!raw || raw.renderT === undefined || !hasValidatedOwners) return raw;
    const now = clock();
    const frame = typeof document === 'undefined' ? now : Number(document.timeline?.currentTime ?? now);
    if (sceneCached && sceneFrame === frame) return sceneCached;
    sceneFrame = frame;
    let target = raw.a.k + (raw.b.k - raw.a.k) * raw.alpha;
    let newestOwner = Infinity;
    for (const [id, q] of ownerHistory) {
      const u = q.samples.at(-1)!.u;
      if (id === mine?.id || u.away || latest?.ents.get(id)?.driver !== 'person') continue;
      const previous = q.samples.at(-2)?.u;
      // A stationary path is still known after its last report. An idle tab's
      // delayed heartbeat must not stop every moving runner and patrol.
      if (previous && !u.vel.x && !u.vel.y && !u.vel.z &&
        u.pos.x === previous.pos.x && u.pos.y === previous.pos.y && u.pos.z === previous.pos.z) continue;
      // One source cannot supply an interpolated pose beyond its newest report.
      // Hold the scene there instead of advancing only the monsters.
      newestOwner = Math.min(newestOwner, q.samples.at(-1)!.t);
    }
    // The shared buffer supplies an age, while accepted input ticks supply the
    // simulation time. Server callbacks may pause without pausing owner input.
    if (Number.isFinite(newestOwner) && latest) target = newestOwner - Math.max(0, latest.k - target);
    if (sceneCursor === null || !sceneHistory.length || raw.b.e !== sceneHistory[0].e) sceneCursor = target;
    else {
      // A long pause may contain a stationary section before fresh movement.
      // Drain that backlog faster, bounding actual sampled travel rather than
      // charging every frame for the body's theoretical maximum fall speed.
      const rate = target - sceneCursor > tickHz * .25 ? 4 : 1.5;
      let ticks = Math.max(0, Math.min(.05, (now - sceneAt) / 1000)) * tickHz * rate;
      for (const [id, q] of ownerHistory) {
        const u=q.samples.at(-1)!.u;
        if (id===mine?.id || u.away || latest?.ents.get(id)?.driver!=='person') continue;
        const limit=kindOf.get(u.kind)!.radius*2.8;
        // Each revision has its own continuous path; placements still cut.
        for (let h:OwnerHistory|undefined=q;h;h=h.previous) {
          for (let i=1;i<h.samples.length;i++) {
            const a=h.samples[i-1],b=h.samples[i];
            if(b.t<=sceneCursor)continue;
            if(a.t>=sceneCursor+ticks)break;
            const speed=Math.hypot(b.u.pos.x-a.u.pos.x,b.u.pos.y-a.u.pos.y,b.u.pos.z-a.u.pos.z)/(b.t-a.t);
            if(speed>0)ticks=Math.min(ticks,limit/speed);
          }
        }
      }
      sceneCursor = Math.max(sceneCursor, Math.min(target, sceneCursor + ticks));
    }
    sceneAt = now;
    while (sceneHistory.length > 2 && sceneHistory[1].k <= sceneCursor) sceneHistory.shift();
    const a = sceneHistory[0] ?? raw.a, b = sceneHistory[1] ?? a;
    const alpha = b.k > a.k ? Math.max(0, Math.min(1, (sceneCursor - a.k) / (b.k - a.k))) : 1;
    return sceneCached = {...raw, a, b, alpha, renderT:a.st+(b.st-a.st)*alpha};
  }
  function sceneTick(s: ReturnType<typeof net.sample>): number {
    return s === sceneCached && sceneCursor !== null ? sceneCursor : s ? s.a.k + (s.b.k-s.a.k)*s.alpha : latest?.k ?? 0;
  }
  function ownerDrawn(u: Unpacked, epoch: number, tick: number): Entity {
    let q = ownerHistory.get(u.id);
    // A future placement must not discard the reports still being drawn from
    // the old revision. Switch histories at the scene boundary, not receipt.
    while (q && q.epoch === epoch && q.r !== u.r) q = q.previous;
    if (!q || q.epoch !== epoch || q.r !== u.r) return entityOf(u);
    // Read report time, not the server tick at which that report arrived.
    let a=q.samples[0], b=a;
    for (const sample of q.samples) { b=sample; if (sample.t>=tick) break; a=sample; }
    const alpha=b.t>a.t?Math.max(0,Math.min(1,(tick-a.t)/(b.t-a.t))):1;
    return Object.freeze({...entityOf(u),pos:vec3(blendPosition(a.u.pos,b.u.pos,alpha,map.wrap),dims),
      vel:alpha<1?a.u.vel:b.u.vel,heading:blendHeading(a.u.heading,b.u.heading,alpha,dims)});
  }
  const drawnFrame = new Map<string, Entity | null>();
  let drawnAt: number | null = null;
  let drawnA: unknown = null, drawnB: unknown = null;
  function drawn(id: string, s = sceneSample()): Entity | null {
    if (solo) return solo.get(id);
    if (mine && id === mine.id) return meNow(true);
    const at = typeof document === 'undefined' ? null : document.timeline?.currentTime;
    if (typeof at !== 'number') return drawnRemote(id, s);
    const a = s?.a ?? latest, b = s?.b ?? latest;
    if (at !== drawnAt || a !== drawnA || b !== drawnB) {
      drawnFrame.clear(); drawnAt = at; drawnA = a; drawnB = b;
    }
    if (drawnFrame.has(id)) return drawnFrame.get(id)!;
    const result = drawnRemote(id, s); drawnFrame.set(id, result); return result;
  }
  function drawnRemote(id: string, s: ReturnType<typeof net.sample>): Entity | null {
    const a = s ? frameOf(s.a) : latest;
    const b = s ? frameOf(s.b) : latest;
    const ea = a?.ents.get(id); const eb = b?.ents.get(id);
    if (!ea || !eb) return ea ? entityOf(ea) : eb && s && s.alpha >= 1 ? entityOf(eb) : eb && !a?.ents.size ? entityOf(eb) : null;
    const kind = kindOf.get(eb.kind);
    // A placed body jumps, never glides across the map. An observer's owner
    // body must reach that snapshot's time before showing its new revision;
    // otherwise the respawn precedes the encounter in the interpolated scene.
    if (ea.r !== eb.r || a?.e !== b?.e || !s) {
      if (kind?.validatedOwner && s && s.alpha < 1 && a && a.e === b?.e && ea.driver === 'person') return ownerDrawn(ea,a.e,sceneTick(s));
      return entityOf(eb);
    }
    const t = s.alpha;
    if (kind?.validatedOwner && eb.driver === 'person' && a && b) return ownerDrawn(t < 1 ? ea : eb, b.e, sceneTick(s));
    // Static pickups and scenery need no new vectors or wrappers for every HUD,
    // scene and probe traversal. Fields still follow the sampled snapshot.
    if (ea.grounded === eb.grounded && ['pos','vel','heading'].every(key => {
      const x=ea[key as 'pos'], y=eb[key as 'pos']; return x.x===y.x && x.y===y.y && x.z===y.z;
    })) return entityOf(t < 1 ? ea : eb);
    const h = blendHeading(ea.heading, eb.heading, t, dims);
    // This interpolated key exists for one read only; caching it retains useless weak entries.
    return Object.freeze({ ...entityOf(t < 1 ? ea : eb), grounded: t >= 1 ? eb.grounded : ea.grounded && (t === 0 || eb.grounded), pos: vec3(blendPosition(ea.pos, eb.pos, t, map.wrap), dims), vel: vec3({ x: lerp(ea.vel.x, eb.vel.x, t), y: lerp(ea.vel.y, eb.vel.y, t), z: lerp(ea.vel.z, eb.vel.z, t) }, dims), heading: h });
  }
  function get(id: string): Entity | null { const g = ghosts.get(id); return g ? ghostEntity(g) : drawn(id); }
  function each(kind: string, fn: (e: Entity) => void): void {
    pump();
    if (solo) { solo.each(kind, fn); return; }
    const s = sceneSample();
    const a = s ? frameOf(s.a) : latest;
    const b = s ? frameOf(s.b) : latest;
    const ids = new Set<string>();
    // Until the newer snapshot is reached, what the older one holds is still drawn; what only the newer one holds waits for it.
    for (const f of [a, s && s.alpha >= 1 ? b : null, a ? null : b]) if (f) for (const u of f.ents.values()) if (u.kind === kind) ids.add(u.id);
    if (mine && mine.kind === kind) ids.add(mine.id);
    for (const id of ids) { const e = drawn(id, s); if (e) fn(e); }
    // A confirmed ghost stands in until the server's own entity is drawn (it arrives a moment behind, interpolated).
    for (const g of [...ghosts.values()]) if (g.kind === kind) { if (g.real && ids.has(g.real)) { ghosts.delete(g.id); emit('leave', ghostEntity(g)); } else fn(ghostEntity(g)); }
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
    solo = openRoom<R>({ game, move: moves, predict: opts.predict, now: opts.now, timers: opts.timers, net: { config: null, post: null, linkOverlay: false } });
    [g.__homieNet, g.__homiePort] = probes;
    for (const name of listeners.keys()) forwardSolo(name);
    net.line(net.full ? 'This room is full · playing on your own until a seat is free' : 'Playing on your own until the next round');
    emit('status', 'offline', true);
  }
  const extra: Record<string, () => unknown> = {};
  const myScore = (): number | null => { if (solo) { const k = schema.kinds.find(k => k.player); return k?.score && solo.me ? Number(solo.me[k.score]) || 0 : null; } const k = myKind(); const u = mine && latest ? latest.ents.get(mine.id) : null; return k?.score && u ? Number(u.fields[k.score]) || 0 : null; };
  const busy = (): boolean => solo ? !solo.me : status !== 'playing' || !mine || latest?.ents.get(mine.id)?.away === true;
  // The probes the testing tools read (`check`, `shoot`, `perf`, the playtest judge): the same two objects a game written the old way publishes.
  net.expose({
    self: () => { const m = meNow(true); return m ? { x: m.pos.x, y: m.pos.y, z: m.pos.z } : null; },
    peer: (seat: number) => { if (!latest) return null; for (const u of latest.ents.values()) if (u.seat === seat) return { x: u.pos.x, y: u.pos.y, z: u.pos.z }; return null; },
    movement: () => { const kinds = schema.kinds.filter(k => k.player); return kinds.length && kinds.every(k => k.maxSpeed === 0) ? 'stationary' : 'spatial'; },
    prediction: () => ({ ...correction, observedLeadAt, lastSendAt, now: clock(), serverTick: latest?.k, tick: stepped, catchTick, lead: targetLead(), medianLead: medianLead(), rate: speed, rtt: authorityRtt(), hostAge: hostMedian, pending: pending.length, applications: [...applications] }),
    scores: () => roster().map((r) => ({ seat: r.seat, score: r.score })),
    score: myScore, tick: () => latest?.k ?? 0, epoch: () => epoch, hosted: () => net.rulesHosting ? 'browser' : schema.settings.host, status: () => solo ? 'offline' : status,
  });
  if (typeof window !== 'undefined') {
    exposePort(net as Netplay<unknown, unknown, unknown>, {
      view: 'top', size: schema.kinds.find((k) => k.player)?.radius ?? 0.5,
      self: () => { const m = meNow(true); return m ? { x: m.pos.x, y: m.pos.y } : null; },
      basis: opts.screenBasis ?? (() => ({ right: [1, 0], up: [0, 1] })),
      score: myScore, busy: () => (typeof extra.busy === 'function' ? Boolean(extra.busy()) : busy()),
      extra,
    });
  }
  const timer = opts.timers === false ? null : setInterval(pump, Math.max(8, period / 2));
  const onShow = (): void => { if (typeof document !== 'undefined' && !document.hidden) { if(myKind()?.validatedOwner) { base={tick:stepped,at:clock()}; heldTrack.clear(); } else { base = null; if (latest) rebase(latest.k); } } };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onShow);

  function viewTickNow(): number { return sceneTick(sceneSample()); }
  /*
   * WHERE A BODY WAS, OR WILL BE JUDGED TO BE (0.46.5). The server judges a rewound ray against poses it kept by
   * tick. A browser holds the snapshots it has received: a pose at a tick between two of them is the point between;
   * past the newest it is that snapshot's pose carried on along its velocity (`known: false`: a guess); before the
   * oldest it is the oldest. A placement between the two is not glided across.
   */
  function poseAt(id: string, at: number): { pos: Vec3; vel: Vec3; known: boolean } | null {
    let before: Frame | null = null, after: Frame | null = null;
    for (const f of held2) { if (!f.ents.has(id)) continue; if (f.k <= at) before = f; if (f.k >= at && !after) after = f; }
    const a = before?.ents.get(id), b = after?.ents.get(id);
    if (a && b) { if (before === after || a.r !== b.r) return { pos: b.pos, vel: b.vel, known: true }; const m = (at - before!.k) / (after!.k - before!.k); return { pos: vec3(blendPosition(a.pos, b.pos, m, map.wrap), dims), vel: b.vel, known: true }; }
    if (a) { const s = Math.min(tickHz, at - before!.k) / tickHz; return { pos: vec3(wrapPoint({ x: a.pos.x + a.vel.x * s, y: a.pos.y + a.vel.y * s, z: a.pos.z + a.vel.z * s },map.wrap), dims), vel: a.vel, known: false }; }
    return b ? { pos: b.pos, vel: b.vel, known: false } : null;
  }
  const atTickOf = (options: unknown): number | undefined => { const v = options !== null && typeof options === 'object' ? (options as { atTick?: unknown }).atTick : undefined; return typeof v === 'number' && Number.isFinite(v) ? v : undefined; };
  /** How many ticks back this seat's ray may look: the server's own figure from the newest snapshot, else the rule it follows with this browser's round trip. */
  function rewindAllowance(): number {
    const seat = net.seat, row = seat === null ? undefined : latest?.rows.find((x) => x[0] === seat);
    const history = Math.ceil((schema.rewind?.historySeconds ?? 0) * tickHz);
    if (typeof row?.[5] === 'number') return row[5];
    const cap = schema.rewind?.capSeconds !== undefined ? Math.ceil(schema.rewind.capSeconds * tickHz) : history;
    return Math.min(history, cap, Math.ceil((authorityRtt() + 150) / period) + 1);
  }
  const viewTargets = (atTick?: number) => {
    pump();
    const targets: QueryTarget[] = collisionTargets(collisionMap(mapAt(latest?.k??0), collisionHistory.at(-1)?.[2] ?? []));
    for(const k of schema.kinds) {
      if(k.collider || !k.radius)continue;
      each(k.name,e=>{
        // At a tick: where the server will have the body, with the fields as they are now (the server filters on current fields too).
        const at = atTick !== undefined && e.id !== mine?.id && !e.provisional ? poseAt(e.id, atTick)?.pos ?? e.pos : e.pos;
        targets.push({id:e.id,kind:k.name,query:k.query,fields:e as Record<string,unknown>,geometry:false,solid:solidAt(at,{shape:k.shape??'circle',radius:k.radius,height:k.height??0}),at});
      });
    }
    return targets;
  };
  const viewRay = (from: unknown, direction: unknown, max: number, options?: RayOptions, all=false) => rayQuery(mapAt(latest?.k??0),viewTargets(atTickOf(options)),dims,from,direction,max,options,mine?.id,all);
  return {
    get confirmedTick() {
      const raw=net.sample(), source=raw?frameOf(raw.alpha>=1?raw.b:raw.a):latest;
      const sourceOwn=mine&&source?.ents.get(mine.id);
      if (!sourceOwn || sourceOwn.r!==mine!.r || source?.e!==epoch) return -1;
      const s=sceneSample(raw), f=s?frameOf(s.alpha>=1?s.b:s.a):latest;
      const own = mine && f?.ents.get(mine.id);
      return own && own.r === mine!.r && f?.e === epoch ? own.ownerTick ?? -1 : -1;
    },
    get viewTick() { return solo ? solo.viewTick : viewTickNow(); },
    get status() { return solo ? 'offline' : status; },
    get seat() { return solo ? solo.seat : net.seat; },
    get me() { if (!presentedEntity) pump(); return meNow(true); },
    each, get,
    ray: (from,direction,max,options) => solo ? solo.ray(from,direction,max,options) : viewRay(from,direction,max,options)[0],
    rays: options => solo ? solo.rays(options) : raySnapshot(mapAt(latest?.k??0),viewTargets(atTickOf(options)),dims,options,mine?.id),
    poseAt: (id, tick) => solo ? solo.poseAt(id, tick) : poseAt(id, tick),
    rayAll: (from,direction,max,options) => solo ? solo.rayAll(from,direction,max,options) : viewRay(from,direction,max,options,true),
    on(name, fn) { let set = listeners.get(name); if (!set) { set = new Set(); listeners.set(name, set); } set.add(fn); forwardSolo(name); return () => { set?.delete(fn); }; },
    get shared() { if (solo) return solo.shared; return Object.freeze(unpackFields(schema.shared, net.stateOf('shared'), dims)); },
    input(s, options) {
      pump();
      if (solo) { solo.input(s, options); return; }
      const kind = myKind() ?? schema.kinds.find((k) => k.player) ?? null;
      const next: Record<string, unknown> = {};
      let changed = false;
      for (const [name, fd] of kind?.input ?? []) {
        if (fd.t === 'press' || fd.t === 'pulse') { if (coerce(fd,s[name],dims) && !pressed.has(name)) changed = true; }
        else { if (s[name] !== undefined) next[name] = s[name]; if ((next[name] ?? fd.init) !== (sample[name] ?? fd.init)) changed = true; }
      }
      // A fresh control can replace a preview partway through a tick (especially
      // a jump). Keep the pose at the instant of the press; only subsequent time
      // may advance the new path, rather than drawing elapsed time with new input.
      // A held control changed NOW, before anything else here takes time: the steps this call runs must already know it.
      const now = clock();
      const at = typeof options?.at === 'number' && Number.isFinite(options.at) ? Math.max(edgeOf(stepped), Math.min(now, options.at)) : now;
      for (const [index, [name, fd]] of (kind?.input ?? []).entries()) {
        const value = Number(coerce(fd, s[name] ?? fd.init, dims));
        if(value !== Number(coerce(fd, sample[name] ?? fd.init, dims)))controlChanges.push([index, ++inputSequence, Math.max(0,Math.min(1,tickAt(at)-stepped)), value]);
      }
      controlChanges=controlChanges.slice(-256);
      for (const [name, fd] of kind?.input ?? []) if (fd.t === 'held') {
        const v = heldNumber(next[name], fd.init), tr = heldTrack.get(name);
        if (!tr) heldTrack.set(name, { from: at, changes: [[at, v]] });
        else if (tr.changes[tr.changes.length - 1][1] !== v) { tr.changes.push([at, v]); if (tr.changes.length > 256) tr.changes.splice(1, tr.changes.length - 256); }
      }
      if (changed) pump();
      const shown = changed && !kind?.validatedOwner ? meNow()?.pos : null;
      for (const [name, fd] of kind?.input ?? []) if ((fd.t === 'press' || fd.t === 'pulse') && coerce(fd,s[name],dims)) { const value=coerce(fd,s[name],dims) as number | boolean; if(fd.t==='pulse'){pulseCount+=1;const target=Math.max(stepped+1,(pulseQueue.at(-1)?.t??stepped)+1);pulseQueue.push({name,value:Number(value),n:pulseCount,t:target});net.send('pulse',[epoch,name,value,target,pulseCount]);} else pressed.set(name,value); }
      if (changed) presentedEntity = null;
      sample = next;
      // A discrete action belongs to the present, even while an unseen impulse is
      // being drawn from history. Resume the live prediction and let the existing
      // input correction below carry the drawn origin across that change of path.
      if (shown && catchTick !== null && kind?.input.some(([name, fd]) =>
        (fd.t === 'press' || fd.t === 'pulse') && Boolean(coerce(fd, s[name], dims)))) catchTick = null;
      if (shown) {
        const now = clock(), nextShown = meNow()?.pos;
        if (nextShown && distance(shown, nextShown) > 0.00001) {
          const carried = visualOffset(now);
          // A new control must not restart the lifetime of an older correction.
          const path = { x: nextShown.x-carried.x, y: nextShown.y-carried.y, z: nextShown.z-carried.z };
          for(const offset of offsets){offset.path=path;offset.last=now;}
          const delta={x:periodicDelta(nextShown.x,shown.x,map.wrap?.x),y:periodicDelta(nextShown.y,shown.y,map.wrap?.y),z:periodicDelta(nextShown.z,shown.z,map.wrap?.z)};
          const last=offsets.at(-1);
          if(last?.at===now && last.fade===1){last.delta={x:last.delta.x+delta.x,y:last.delta.y+delta.y,z:last.delta.z+delta.z};}
          else offsets.push({delta,at:now,last:now,fade:1,path});
        }
      }
    },
    command(name, data = {}) { if (solo) { solo.command(name, data); return; } if (schema.commands[name]) net.send('cmd', [name, data]); else console.warn(`[room] no command "${name}" is declared in shapes.commands`); },
    get round() { return roundNow(); },
    get roster() { return roster(); },
    follow(id) { const e = id ? latest?.ents.get(id) : null; net.follow(e && e.seat !== undefined ? e.seat : null); },
    probe(x) { Object.assign(extra, x); },
    ask(id, askId, args = {}) { if (solo) return; const e = latest?.ents.get(id); if (e && e.seat !== undefined) agents?.ask(e.seat, askId, args); },
    askButtons(id, offer = {}) { if (solo) return []; const e = latest?.ents.get(id); return e && e.seat !== undefined ? agents?.askButtons(e.seat, offer) ?? [] : []; },
    tune, get map(){return solo ? solo.map : mapAt(latest?.k??0);}, net: net as Netplay,
    pump,
    close() { stopSolo(); disposeMoveContext(moveCtx as object); closed = true; if (timer) clearInterval(timer); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onShow); agents?.stop(); net.close(); setStatus('closed'); },
  };
}
