/*
 * netplay.ts — Homie netplay contract v1, the game side.
 * =============================================================================
 *
 * Vendor this ONE file into a game (copy it to src/net/netplay.ts). It has no
 * imports and no dependencies, uses only erasable TypeScript (Node can import
 * it with type stripping), and compiles under `strict` and under the games'
 * `strict: false`. The wire protocol, the roles and the budgets it implements
 * are specified in NETPLAY.md beside it; this file is the reference client.
 *
 * WHAT IT DOES
 *   - Finds its shell: `window.HOMIE_NET` (injected by the web shell before the
 *     game's first module runs). No HOMIE_NET — a plain file, a Vite dev
 *     server — means OFFLINE: role `host`, seat `null`, every send a cheap
 *     no-op. The game then seats its local player itself (keys or touch).
 *   - Speaks the v1 wire protocol over one WebSocket: hello/welcome, snapshots
 *     (host -> all), inputs (replica -> host, press edges never lost), events,
 *     keyed slow state, ~1 Hz checkpoints, round and roster, ping/pong clock.
 *   - Keeps a snapshot interpolation buffer in server time (`sample()`), with a
 *     delay measured from how old snapshots really are when they arrive.
 *   - Keeps the body-control table: per seat a reset epoch `rs`, who drives the
 *     body (`own`), and the last input the host had (`ack`). The host resets,
 *     takes and gives bodies; the replica hears it as a `control` event.
 *   - Tells the game about role changes at ANY time: first role, promotion to
 *     host (with the relay's last checkpoint + snapshot + state), demotion.
 *   - Stays alive: yields the host role when its tab is hidden, drops a socket
 *     that went quiet, reconnects with its seat token.
 *   - Reports role/seat/rtt/snapshot rate to the parent shell by postMessage
 *     (for the debug strip) and on `window.__homieNet` (for e2e probes).
 *
 * WHAT IT DOES NOT DO: rendering, physics, input devices, bots. `Roster` below
 * is the bot-yield bookkeeping a host needs; the bots themselves are the game's.
 * =============================================================================
 */

export const NETPLAY_VERSION = 1;

export type Role = 'host' | 'replica' | 'screen';
export type Device = 'phone' | 'desk' | 'tv';
export type Want = 'play' | 'screen';
/** Who moves a seated body by default. `owner`: the seat's own browser (instant). `host`: the host's rules. */
export type Movement = 'owner' | 'host';

/** What the shell injects as `window.HOMIE_NET` before the game boots. */
export interface NetConfig {
  v: number;
  /** The relay socket: dev `ws://127.0.0.1:<port>/__net?room=main`, site `wss://<host>/api/table/<CODE>/ws?as=net&s=<nonce>`. */
  url: string;
  room?: string;
  /** Seat capability from an earlier welcome (or a lobby reservation). Resumes the same seat. */
  token?: string;
  name?: string;
  device?: Device;
  want?: Want;
  debug?: boolean;
}

export interface HostRef { id: string; seat: number | null }

export interface Peer {
  id: string;
  seat: number | null;
  name: string;
  colour: number;
  device: Device;
  want: Want;
  role: Role;
  /** Muted by the studio's owner (section 15): hide this player's chat and emotes. */
  muted?: boolean;
}

/** One seat's entry in the body-control table: [seat, rs, own (1|0), ack]. */
export type ControlWire = [seat: number, rs: number, own: number, ack: number];
export interface Snapshot<D = unknown> { k: number; st: number; d: D; from?: number | null; c?: ControlWire[] }
export interface Checkpoint<D = unknown> { k: number; st: number; d: D; c?: ControlWire[] }
export interface InputFrame<A = unknown> {
  /** Sequence number per sender. */
  q: number;
  /** Client-owned avatar state (owner movement), or intent (host movement). */
  a: A;
  /** Buttons held right now. */
  h: string[];
  /** Press edges since the previous frame, by button id (the relay clamps each to 0..8). */
  p: Record<string, number>;
  /** Sender seat, stamped by the relay (never trusted from the body). */
  from: number;
  /** The reset epoch the sender had adopted when it sent this frame. */
  r: number | null;
}
export interface NetEvent<D = unknown> {
  k: string;
  d: D;
  from: number | null;
  /** The sender's peer id (events to the host only), so the host can answer a screen with `send(k, d, id)`. */
  id?: string;
}

/**
 * The studio's announcement (NETPLAY.md section 15): one line from the studio's owner to everyone in the room, until
 * `until` (server ms). The shell shows it as a banner; a game may show it its own way. `text: null` takes it down.
 */
export interface Announcement { id: string; text: string | null; at?: number; until?: number; from?: string }
/** A player muted (or unmuted, `until: 0`) by the studio's owner: their chat and emotes (`ev` kinds say, chat, emote) reach nobody. */
export interface Mute { id: string; seat: number | null; until: number }

/** A seat's body control as the host keeps it. */
export interface Control {
  seat: number;
  /** Reset epoch: bumped whenever the host moved the body itself; the owner adopts the host's position. */
  rs: number;
  /** true: the seat's browser moves the body (owner movement). false: the host does (host movement, or taken). */
  own: boolean;
  /** Sequence number of the newest input frame the host had from this seat when it sent the snapshot. */
  ack: number;
}
export interface ControlChange<S = unknown> extends Control {
  /** rs changed: put your avatar where `snap` has your body, and drop any prediction. */
  reset: boolean;
  snap: Snapshot<S>;
}
export interface PendingInput<A = unknown> { q: number; a: A; h: string[]; at: number; dt: number }

export interface RoundResult { slot: number; seat: number | null; name: string; score: number; bot: boolean; place: number }
export interface RoundInfo {
  n: number;
  phase: 'live' | 'over';
  /** Server ms. */
  startedAt: number;
  /** Server ms: end of the live phase, or end of the intermission when phase is 'over'. */
  endsAt: number;
  results?: RoundResult[];
}
export interface Slot { slot: number; seat: number | null; name: string; bot: boolean }

export interface RoleChange<S = unknown, C = unknown> {
  role: Role;
  prev: Role | null;
  why: string;
  /** Became host while a round was already running somewhere: restore from ckpt/snap/state. */
  promoted: boolean;
  /** Was host, is not any more: stop running rules. */
  demoted: boolean;
  ckpt: Checkpoint<C> | null;
  snap: Snapshot<S> | null;
  round: RoundInfo | null;
  roster: Slot[] | null;
  /** Every connected peer including this one. */
  peers: Peer[];
}

export interface Sample<S = unknown> {
  a: Snapshot<S>;
  b: Snapshot<S>;
  /** 0..1 between a and b. */
  alpha: number;
  /** The server time being rendered. */
  renderT: number;
  /** ms the render time is past the newest snapshot (0 when interpolating). */
  starved: number;
}

export interface NetStats {
  role: Role;
  seat: number | null;
  host: HostRef | null;
  connected: boolean;
  offline: boolean;
  rtt: number | null;
  offset: number;
  snapHzIn: number;
  snapHzOut: number;
  inputHzIn: number;
  inputHzOut: number;
  /** Idle input frames not sent (identical to the last one, inside the keepalive interval). */
  idleInputsSkipped?: number;
  lastSnapBytes: number;
  maxSnapBytes: number;
  bytesInPerS: number;
  bytesOutPerS: number;
  interpDelay: number;
  /** 90th percentile of (arrival time - st) over the last 40 snapshots: transit plus clock error. */
  snapAgeP90: number;
  /** Share of sample() calls in the last 2 s window that ran past the newest snapshot. */
  starvedPct: number;
  rejectedSnaps: number;
  owned: boolean;
  pending: number;
  stateKeys: number;
  peers: number;
  reconnects: number;
  promotions: number;
  round: number | null;
}

export interface Vec { x: number; y: number; z?: number }
/** What a game can expose for harnesses (an end-to-end test reads these through `window.__homieNet.probe`). */
export interface Probes {
  self?: () => Vec | null;
  peer?: (seat: number) => Vec | null;
  frames?: () => number;
  [extra: string]: unknown;
}

export interface NetplayOptions<C = unknown> {
  /** Defaults to `window.HOMIE_NET`. `null` forces offline. */
  config?: NetConfig | null;
  want?: Want;
  /** May this browser be elected host? Default true. */
  canHost?: boolean;
  /** Game id, for the relay's logs. */
  game?: string;
  /** Seats in a room (the manifest's players.max). The relay takes it from the first visitor of an empty room. */
  maxPlayers?: number;
  /** Who moves a seated body by default. Default `owner`. */
  movement?: Movement;
  snapshotHz?: number;
  inputHz?: number;
  checkpointMs?: number;
  /** Fixed interpolation delay in ms. Default: adaptive (arrival age p90 + 1.2 intervals). */
  interpDelayMs?: number;
  /** Host: return the full rules state. Called every `checkpointMs`, before yielding, and on pagehide. */
  checkpoint?: () => C;
  /** ms to wait for a welcome before falling back to offline host. Default 4000. */
  connectTimeoutMs?: number;
  /** A socket that delivered nothing for this long is dropped and reopened (pongs come every 2 s). Default 6000. */
  staleMs?: number;
  /** Tests: a WebSocket constructor. */
  WebSocketImpl?: WebSocketCtor;
  /** Tests / custom shells: where parent notifications go. Default `parent.postMessage` when framed. */
  post?: ((msg: Record<string, unknown>) => void) | null;
}

type WebSocketCtor = new (url: string) => WebSocketLike;
interface WebSocketLike {
  readyState: number;
  bufferedAmount?: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface NetHandlers<S, A, C> {
  role: (e: RoleChange<S, C>) => void;
  join: (p: Peer) => void;
  leave: (p: { id: string; seat: number | null; why: string }) => void;
  input: (f: InputFrame<A>) => void;
  event: (e: NetEvent) => void;
  snapshot: (s: Snapshot<S>) => void;
  /** Seated, not host: my body's control changed (reset, taken, given back). */
  control: (e: ControlChange<S>) => void;
  /** A keyed state value changed (null: deleted). Fires for every key on welcome and promotion too. */
  state: (e: { k: string; d: unknown }) => void;
  round: (r: RoundInfo) => void;
  roster: (slots: Slot[]) => void;
  status: (connected: boolean) => void;
  /** The studio's owner announced something to this room (or took it down: `text: null`). */
  announce: (a: Announcement) => void;
  /** The studio's owner muted or unmuted a player in this room. */
  mute: (m: Mute) => void;
}

export interface Netplay<S = unknown, A = unknown, C = unknown> {
  readonly role: Role;
  readonly isHost: boolean;
  /** This browser's player seat, or null (a screen, a full room, or offline). */
  readonly seat: number | null;
  readonly spectator: boolean;
  readonly offline: boolean;
  readonly connected: boolean;
  /** Why the client stopped for good (a refusal reconnecting would repeat: 'replaced', 'room-full', ...), else null. */
  readonly closedWhy: string | null;
  /** How long the socket has been down while it reconnects (ms; 0 while connected). */
  readonly downMs: number;
  /**
   * Host: hand the room to another browser — a checkpoint, then the protocol's `yield` (the same road a hidden
   * tab takes). The relay elects the best other candidate, or keeps me host when nobody else can host.
   * Use it when a big screen or a struggling phone should give the room to a seated computer (never in a
   * host's first 30 s, at most once a minute); false when not sent.
   */
  handOff(): boolean;
  /** Seated replica: true while my browser moves my body; false while the host does (host movement, or taken). */
  readonly owned: boolean;
  readonly id: string | null;
  readonly name: string;
  readonly colour: number;
  readonly device: Device;
  readonly host: HostRef | null;
  readonly peers: ReadonlyMap<string, Peer>;
  readonly roundInfo: RoundInfo | null;
  readonly slots: Slot[] | null;
  /** The studio's announcement now showing in this room, or null. */
  readonly announcement: Announcement | null;
  /** Whether the studio's owner has muted this seat (its chat and emotes reach nobody; a game hides them too). */
  isMuted(seat: number | null): boolean;
  /**
   * A player was clicked (their body, their name): tell the shell. Only the studio's owner's page does anything with
   * it (opens that player's card with Mute and Kick); for everyone else it is nothing.
   */
  pickPlayer(seat: number | null): void;
  /** Resolves with the first role (welcome, or offline fallback). */
  readonly ready: Promise<RoleChange<S, C>>;
  on<K extends keyof NetHandlers<S, A, C>>(kind: K, fn: NetHandlers<S, A, C>[K]): () => void;
  /** Server time in ms (relay clock). Offline: Date.now(). */
  now(): number;
  /** Host: true when the next `snapshot()` would be sent. Build the state only then. */
  snapshotDue(): boolean;
  /** Host: broadcast fast state (live bodies, projectiles); throttled to snapshotHz (1 Hz while alone). */
  snapshot(d: S, tick?: number, force?: boolean): boolean;
  /** Host: send a checkpoint now (normally automatic via `options.checkpoint`). */
  checkpointNow(): void;
  /** Host: announce a round phase (start / end with results). Relay keeps the latest for joiners and the shell. */
  round(r: RoundInfo): void;
  /** Host: announce slots (humans + bots). Relay keeps the latest for joiners and the shell. */
  roster(slots: Slot[]): void;
  /** Host: set slow keyed state (claims, doors, scores board); `null` deletes. Sent only when it changed. */
  state(key: string, d: unknown): boolean;
  /** Everyone: the latest value of a keyed state entry. */
  stateOf<T = unknown>(key: string): T | undefined;
  stateKeys(): string[];
  /** Player (non-host): own avatar state (or intent) + held buttons, every frame. Batched; press edges sent at once. */
  input(a: A, held?: Iterable<string> | Record<string, boolean>): void;
  /** Player: an explicit press edge (for buttons you do not report as held). */
  press(id: string): void;
  /** Event. Host: to everyone, or to one seat (number) or one peer id (string, e.g. a screen). Others: to the host. */
  send(kind: string, data?: unknown, to?: number | string): void;
  /** Host: latest input frame from a seat (intents, buttons) whatever the body's control. */
  inputOf(seat: number): InputFrame<A> | null;
  /** Host: the owner's avatar state, or null when the body is not owner-driven or the frame predates the last reset. */
  avatar(seat: number): A | null;
  /** Host: press edges from a seat since the last call (cleared on read). */
  takePresses(seat: number): Record<string, number>;
  /** Host: a seat's control entry (`taken`: the host is driving it, whatever the movement mode). */
  control(seat: number): Control & { taken: boolean };
  /** Host: I moved this body myself (spawn, respawn, takeover, anti-cheat): the owner adopts my position. */
  reset(seat: number): number;
  /** Host: drive this body myself (knockback, carry, stun). With `ms`, it is given back by itself after that long. */
  take(seat: number, ms?: number): void;
  /** Host: hand a taken body back to the room's movement mode where it now is (bumps rs). */
  give(seat: number): void;
  /** Seated replica: my input frames the host had not acknowledged in the newest snapshot, oldest first. */
  pending(): PendingInput<A>[];
  /** Interpolation pair for rendering remote entities. */
  sample(delayMs?: number): Sample<S> | null;
  latest(): Snapshot<S> | null;
  stats(): NetStats;
  expose(probes: Probes): void;
  close(): void;
}

/* ------------------------------------------------------------------ helpers */

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
/** Round to `places` decimals — the cheapest snapshot compression there is. */
export const q = (v: number, places = 2): number => {
  const m = 10 ** places;
  return Math.round(v * m) / m;
};
/**
 * Host: bound a client-owned move. Returns the point at most `maxDist` from `from` toward `to`, and `over`: how far
 * the claim was beyond the bound (Infinity for a non-number). Call every host frame with
 * `maxDist = maxSpeed * dt * 1.3 + slack`; a legitimate avatar catches up within a frame or two, a teleport crawls.
 */
export function capMove(from: Vec, to: Vec, maxDist: number): { x: number; y: number; z?: number; over: number } {
  const hasZ = typeof from.z === 'number' && typeof to.z === 'number';
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y) || (hasZ && !Number.isFinite(to.z as number))) {
    return { x: from.x, y: from.y, ...(hasZ ? { z: from.z as number } : {}), over: Infinity };
  }
  const dx = to.x - from.x; const dy = to.y - from.y; const dz = hasZ ? (to.z as number) - (from.z as number) : 0;
  const d = Math.hypot(dx, dy, dz);
  if (d <= maxDist) return { x: to.x, y: to.y, ...(hasZ ? { z: to.z as number } : {}), over: 0 };
  const k = maxDist / d;
  return { x: from.x + dx * k, y: from.y + dy * k, ...(hasZ ? { z: (from.z as number) + dz * k } : {}), over: d - maxDist };
}

/** Short edge <= 540 CSS px is a phone (the web shell's own rule). */
export function guessDevice(): Device {
  try {
    const asked = new URLSearchParams(location.search).get('hand');
    if (asked === 'phone' || asked === 'desk') return asked;
    return Math.min(innerWidth, innerHeight) <= 540 ? 'phone' : 'desk';
  } catch { return 'desk'; }
}

/* ------------------------------------------------------------------- Roster */

export interface RosterOptions {
  /** Slots always filled (humans + bots). */
  min: number;
  /** Hard cap on slots. */
  max: number;
  botName?: (slot: number) => string;
}

/**
 * Host-side bookkeeping for bots that yield their slot to an arriving human.
 *
 * A round always has at least `min` bodies. A human who arrives takes back the
 * slot they held last if it is still a bot (a reload lands in the same body),
 * else the lowest bot slot, inheriting that body where it stands; only when no
 * bot is left is a new slot added (up to `max`). A human who leaves turns back
 * into a bot in the same slot, so the round never loses a body mid-play.
 * `trim()` drops surplus bots between rounds.
 */
export class Roster {
  slots: Slot[] = [];
  readonly min: number;
  readonly max: number;
  readonly botName: (slot: number) => string;
  /** seat → the slot it held when it last left */
  private readonly lastSlot = new Map<number, number>();

  constructor(opts: RosterOptions) {
    this.min = Math.max(0, opts.min | 0);
    this.max = Math.max(this.min, opts.max | 0);
    this.botName = opts.botName ?? ((slot: number) => `Bot ${slot + 1}`);
    this.fill();
  }

  static from(slots: readonly Slot[], opts: RosterOptions): Roster {
    const r = new Roster(opts);
    r.slots = slots.map((s) => ({ slot: s.slot, seat: s.seat, name: s.name, bot: s.bot }));
    r.fill();
    return r;
  }

  fill(): void {
    while (this.slots.length < this.min) {
      const slot = this.nextSlotId();
      this.slots.push({ slot, seat: null, name: this.botName(slot), bot: true });
    }
    this.slots.sort((a, b) => a.slot - b.slot);
  }

  private nextSlotId(): number {
    let id = 0;
    const used = new Set(this.slots.map((s) => s.slot));
    while (used.has(id)) id += 1;
    return id;
  }

  bySeat(seat: number): Slot | undefined { return this.slots.find((s) => s.seat === seat && !s.bot); }
  humans(): Slot[] { return this.slots.filter((s) => !s.bot); }
  bots(): Slot[] { return this.slots.filter((s) => s.bot); }

  /** A human takes a slot. Returns the slot, whether it yielded a bot, or null (full: spectate). */
  claim(seat: number, name: string): { slot: Slot; yielded: boolean; added: boolean } | null {
    const mine = this.bySeat(seat);
    if (mine) { mine.name = name || mine.name; return { slot: mine, yielded: false, added: false }; }
    const last = this.lastSlot.get(seat);
    const bot = (last !== undefined ? this.slots.find((s) => s.slot === last && s.bot) : undefined) ?? this.slots.find((s) => s.bot);
    if (bot) {
      bot.bot = false; bot.seat = seat; bot.name = name || `Player ${seat + 1}`;
      return { slot: bot, yielded: true, added: false };
    }
    if (this.slots.length >= this.max) return null;
    const slot = this.nextSlotId();
    const s: Slot = { slot, seat, name: name || `Player ${seat + 1}`, bot: false };
    this.slots.push(s);
    this.slots.sort((a, b) => a.slot - b.slot);
    return { slot: s, yielded: false, added: true };
  }

  /** A human leaves: their slot becomes a bot where it stands. */
  release(seat: number): Slot | null {
    const s = this.bySeat(seat);
    if (!s) return null;
    this.lastSlot.set(seat, s.slot);
    s.bot = true; s.seat = null; s.name = this.botName(s.slot);
    return s;
  }

  /** Between rounds: remove bots beyond `min` slots. Returns the removed slot ids. */
  trim(): number[] {
    const removed: number[] = [];
    for (let i = this.slots.length - 1; i >= 0 && this.slots.length > this.min; i -= 1) {
      const s = this.slots[i];
      if (s && s.bot) { removed.push(s.slot); this.slots.splice(i, 1); }
    }
    return removed;
  }

  /** After a promotion: make the roster agree with who is actually connected. */
  reconcile(peers: Iterable<{ seat: number | null; name: string }>): { claimed: Slot[]; released: Slot[] } {
    const here = new Map<number, string>();
    for (const p of peers) if (p.seat !== null && p.seat !== undefined) here.set(p.seat, p.name);
    const released: Slot[] = [];
    const claimed: Slot[] = [];
    for (const s of this.humans()) {
      if (s.seat !== null && !here.has(s.seat)) { const r = this.release(s.seat); if (r) released.push(r); }
    }
    for (const [seat, name] of here) {
      if (this.bySeat(seat)) continue;
      const c = this.claim(seat, name);
      if (c) claimed.push(c.slot);
    }
    this.fill();
    return { claimed, released };
  }

  toJSON(): Slot[] { return this.slots.map((s) => ({ ...s })); }
}

/* --------------------------------------------------------------- the client */

const LADDER = [250, 500, 1000, 2000, 4000];
/**
 * Relay errors after which reconnecting would only repeat the refusal. A 'flood' kick is NOT one: a replica's
 * inputs bunch up behind a stall it did not cause (a host migration, a relay or network hiccup that delivers a
 * second of frames at once), and a kick that ended the page's play for good left a phone frozen with no word.
 * After one it comes back (its seat token keeps its body), sending at the slow rate below.
 */
const FINAL_ERRORS = new Set(['replaced', 'version', 'room-full', 'too-many', 'kicked', 'room-closed']);
/**
 * Input pacing (NETPLAY.md §5): at most this many `in` frames in any rolling second from this browser, whatever
 * the frame rate or the press rate: two thirds of the relay's cap of 60, so frames that reach it bunched (a
 * stall anywhere between) still fit under the cap.
 */
const IN_CAP_PER_S = 32;
/** Longest a page with a live socket listens for the relay's welcome before it plays alone (ms of time it could listen). */
const CONNECT_OPEN_MAX_MS = 10_000;
/** After the relay reports dropped inputs (or kicked this browser for them): the cap for the next while. */
const IN_SLOW_CAP_PER_S = 15;
const IN_SLOW_MS = 8000;
/** A socket with this much still unsent does not queue another input frame (the newest one waits instead). */
const IN_BACKLOG_BYTES = 2048;
/**
 * An input frame identical to the last one sent (same avatar or intent, same held keys, no press, same reset epoch)
 * goes out at most this often: a player standing still says so four times a second, not twenty. The host already
 * holds that frame, so nothing it reads changes; every incoming socket message is a Durable Object request
 * (billed 20:1), and in a 32-seat room the replicas' inputs are nearly all of them (NETPLAY.md §11).
 */
const IDLE_INPUT_MS = 250;

function heldList(held: Iterable<string> | Record<string, boolean> | undefined): string[] {
  if (!held) return [];
  if (typeof (held as Iterable<string>)[Symbol.iterator] === 'function') return [...(held as Iterable<string>)];
  const out: string[] = [];
  for (const [k, v] of Object.entries(held as Record<string, boolean>)) if (v) out.push(k);
  return out;
}

/** A rolling per-second counter. */
function rate() {
  const stamps: number[] = [];
  return {
    hit(now: number) { stamps.push(now); while (stamps.length && (stamps[0] as number) < now - 1000) stamps.shift(); },
    hz(now: number) { while (stamps.length && (stamps[0] as number) < now - 1000) stamps.shift(); return stamps.length; },
  };
}

export function createNetplay<S = unknown, A = unknown, C = unknown>(opts: NetplayOptions<C> = {}): Netplay<S, A, C> {
  const g = globalThis as unknown as {
    HOMIE_NET?: NetConfig; WebSocket?: WebSocketCtor; document?: Document; addEventListener?: typeof addEventListener;
    parent?: Window; __homieNet?: unknown;
  };
  const cfg: NetConfig | null = opts.config === undefined ? (g.HOMIE_NET ?? null) : opts.config;
  const WS: WebSocketCtor | undefined = opts.WebSocketImpl ?? g.WebSocket;
  const snapshotMs = 1000 / Math.max(1, Math.min(30, opts.snapshotHz ?? 20));
  const inputMs = 1000 / Math.max(1, Math.min(30, opts.inputHz ?? 20));
  const checkpointMs = Math.max(250, opts.checkpointMs ?? 1000);
  const connectTimeoutMs = opts.connectTimeoutMs ?? 4000;
  const staleMs = Math.max(2500, opts.staleMs ?? 6000);
  const device: Device = cfg?.device ?? guessDevice();
  const want: Want = opts.want ?? cfg?.want ?? 'play';
  const canHost = opts.canHost ?? true;
  const defaultOwn = (opts.movement ?? 'owner') === 'owner';

  // Where parent notifications go: the shell page around a framed game.
  const post: ((m: Record<string, unknown>) => void) | null = opts.post !== undefined ? opts.post
    : (() => {
      try {
        if (g.parent && g.parent !== (globalThis as unknown)) {
          const p = g.parent;
          return (m: Record<string, unknown>) => { try { p.postMessage({ t: 'homie-net', ...m }, '*'); } catch { /* gone */ } };
        }
      } catch { /* cross-origin parent access is fine for postMessage; anything else: no parent */ }
      return null;
    })();

  const handlers: { [K in keyof NetHandlers<S, A, C>]: Set<NetHandlers<S, A, C>[K]> } = {
    role: new Set(), join: new Set(), leave: new Set(), input: new Set(), event: new Set(),
    snapshot: new Set(), control: new Set(), state: new Set(), round: new Set(), roster: new Set(), status: new Set(), announce: new Set(), mute: new Set(),
  };
  const emit = <K extends keyof NetHandlers<S, A, C>>(kind: K, arg: Parameters<NetHandlers<S, A, C>[K]>[0]): void => {
    for (const fn of [...handlers[kind]]) {
      try { (fn as (x: unknown) => void)(arg); } catch (err) { console.warn(`[netplay] ${String(kind)} handler`, err); }
    }
  };

  // ---------------------------------------------------------------- state
  let role: Role = 'replica';
  let roleKnown = false;
  let seat: number | null = null;
  let id: string | null = null;
  let token: string | undefined = cfg?.token;
  let name = cfg?.name ?? '';
  let colour = 0;
  let host: HostRef | null = null;
  let offline = !cfg || !cfg.url || !WS;
  let connected = false;
  let closed = false;
  let ws: WebSocketLike | null = null;
  let attempt = 0;
  let reconnects = 0;
  let promotions = 0;
  let lastMsgAt = 0;
  let waitingVisible = false;
  const peers = new Map<string, Peer>();
  let roundInfo: RoundInfo | null = null;
  let slots: Slot[] | null = null;
  let lastCkpt: Checkpoint<C> | null = null;

  // keyed slow state
  const stateMap = new Map<string, unknown>();
  const stateSent = new Map<string, string>();

  // body control: the host's table, and this replica's own entry
  const ctl = new Map<number, { rs: number; own: boolean; taken: boolean; ack: number; giveAt: number }>();
  let mine = { rs: 0, own: defaultOwn, ack: 0 };

  // clock
  let offset = 0;
  let rtt: number | null = null;
  const samples: { rtt: number; off: number }[] = [];
  const pingsOut = new Map<number, number>();

  // snapshots
  const buf: Snapshot<S>[] = [];
  let lastSnapSentAt = -Infinity;
  let tick = 0;
  let iv = snapshotMs;
  let lastArrival = 0;
  let lastArrivalSt = 0;
  const ages: number[] = [];
  let ageP90 = 0;
  let delaySmooth = 0;
  let rebase = false;
  let rejectedSnaps = 0;
  let sampleFrames = 0;
  let starvedFrames = 0;
  let starvedPct = 0;
  let starvedWindowAt = 0;
  let lastSnapBytes = 0;
  let maxSnapBytes = 0;
  let lastSnapInfo: { k: number; st: number; from: number | null; at: number } | null = null;
  const snapIn = rate();
  const snapOut = rate();
  const inputIn = rate();
  const inputOut = rate();
  const bytesIn: { at: number; n: number }[] = [];
  const bytesOut: { at: number; n: number }[] = [];

  // inputs
  let inSeq = 0;
  let lastInputSentAt = -Infinity;
  let pendingA: A | undefined;
  let pendingHeld: string[] = [];
  let prevHeld = new Set<string>();
  let pendingPresses: Record<string, number> = {};
  let inputTimer: ReturnType<typeof setTimeout> | null = null;
  /** The last input frame sent, as text (idle frames repeat it at most every IDLE_INPUT_MS). */
  let lastInputSig = '';
  /** Wall times of the input frames sent in the last second, and until when the slow cap holds. */
  const inSent: number[] = [];
  let inSlowUntil = 0;
  let idleSkipped = 0;
  /** Why this client stopped for good (a FINAL_ERRORS refusal), or null while it plays or reconnects. */
  let closedWhy: string | null = null;
  /** The studio's announcement now showing, and the seats the studio muted (until when, server ms). */
  let announcement: Announcement | null = null;
  const muted = new Map<number, number>();
  /** Wall time the socket went down (0 while connected): how long a reconnect has taken. */
  let downSince = 0;
  const sentHist: { q: number; a: A; h: string[]; at: number; r: number }[] = [];
  const inputs = new Map<number, InputFrame<A>>();
  const presses = new Map<number, Record<string, number>>();

  let probes: Probes = {};

  const wall = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const now = (): number => (offline ? Date.now() : Date.now() + offset);

  let resolveReady: (e: RoleChange<S, C>) => void = () => {};
  const ready = new Promise<RoleChange<S, C>>((res) => { resolveReady = res; });

  const countBytes = (list: { at: number; n: number }[], n: number): void => {
    const t = wall();
    list.push({ at: t, n });
    while (list.length && (list[0] as { at: number }).at < t - 1000) list.shift();
  };
  const perSecond = (list: { at: number; n: number }[]): number => {
    const t = wall();
    while (list.length && (list[0] as { at: number }).at < t - 1000) list.shift();
    return list.reduce((s, x) => s + x.n, 0);
  };

  function raw(msg: Record<string, unknown>): boolean {
    if (!ws || ws.readyState !== 1) return false;
    const text = JSON.stringify(msg);
    try { ws.send(text); } catch { return false; }
    countBytes(bytesOut, text.length);
    return true;
  }

  /* ------------------------------------------------------------ body control (host) */
  function ctlOf(s: number): { rs: number; own: boolean; taken: boolean; ack: number; giveAt: number } {
    let e = ctl.get(s);
    if (!e) { e = { rs: 1, own: defaultOwn, taken: false, ack: 0, giveAt: 0 }; ctl.set(s, e); }
    return e;
  }
  /** Give back: the body returns to the room's movement mode, and rs bumps so the owner restarts from here. */
  function giveBack(e: { rs: number; own: boolean; taken: boolean; giveAt: number }): void { e.taken = false; e.own = defaultOwn; e.giveAt = 0; e.rs += 1; }
  function sweepCtl(): void {
    const t = wall();
    for (const e of ctl.values()) if (e.taken && e.giveAt && t >= e.giveAt) giveBack(e);
  }
  function ctlWire(): ControlWire[] {
    sweepCtl();
    const here = new Set<number>();
    for (const p of peers.values()) if (p.seat !== null) here.add(p.seat);
    const out: ControlWire[] = [];
    for (const [s, e] of ctl) if (here.has(s)) out.push([s, e.rs, e.own ? 1 : 0, e.ack]);
    return out;
  }
  /** A new host rebuilds the table from the checkpoint, then the newer snapshot. A body taken mid-knockback is given back. */
  function adoptCtl(ckpt: Checkpoint<C> | null, snap: Snapshot<S> | null): void {
    ctl.clear();
    for (const src of [ckpt?.c, snap?.c]) {
      if (!Array.isArray(src)) continue;
      for (const [s, rs, own] of src) {
        // A body the old host had taken (mid-knockback) goes back to the room's mode, with a reset.
        const wasTaken = (own === 1) !== defaultOwn;
        ctl.set(s, { rs: wasTaken ? rs + 1 : rs, own: defaultOwn, taken: false, ack: 0, giveAt: 0 });
      }
    }
  }

  /* ------------------------------------------------------------ keyed state */
  function applyState(k: string, d: unknown): void {
    if (d === null || d === undefined) { if (!stateMap.has(k)) return; stateMap.delete(k); emit('state', { k, d: null }); return; }
    stateMap.set(k, d);
    emit('state', { k, d });
  }
  function replaceState(next: unknown): void {
    if (!next || typeof next !== 'object') return;
    const obj = next as Record<string, unknown>;
    for (const k of [...stateMap.keys()]) if (!(k in obj)) applyState(k, null);
    for (const [k, d] of Object.entries(obj)) if (JSON.stringify(stateMap.get(k)) !== JSON.stringify(d)) applyState(k, d);
  }
  function primeStateSent(): void {
    stateSent.clear();
    for (const [k, d] of stateMap) stateSent.set(k, JSON.stringify(d));
  }

  function setRole(next: Role, why: string, extra: Partial<RoleChange<S, C>> = {}): void {
    const prev = roleKnown ? role : null;
    const was = role;
    role = next;
    roleKnown = true;
    // Promoted = became host of a round that is already running somewhere: the relay handed over its
    // last checkpoint and/or snapshot, and the game must restore from them instead of starting fresh.
    const promoted = next === 'host' && (prev === null || was !== 'host') && Boolean(extra.ckpt || extra.snap);
    const demoted = prev === 'host' && next !== 'host';
    if (promoted) promotions += 1;
    const e: RoleChange<S, C> = {
      role: next, prev, why, promoted, demoted,
      ckpt: extra.ckpt ?? null, snap: extra.snap ?? null, round: extra.round ?? roundInfo, roster: extra.roster ?? slots,
      peers: [...peers.values()],
    };
    if (next === 'host') {
      inputs.clear(); presses.clear();
      if (was !== 'host' || prev === null) { adoptCtl(extra.ckpt ?? null, extra.snap ?? null); primeStateSent(); }
    } else {
      mine = { rs: 0, own: defaultOwn, ack: 0 };
      sentHist.length = 0;
    }
    post?.({ what: 'role', role: next, prev, why, seat });
    resolveReady(e);
    emit('role', e);
    notifyStats(true);
  }

  /** The newest snapshot this browser holds, if recent: a promoted host's restore when the relay has none. */
  function localSnap(): Snapshot<S> | null {
    const s = buf[buf.length - 1];
    return s && now() - s.st < 5000 ? s : null;
  }

  // ---------------------------------------------------------------- wire in
  function onMessage(data: unknown): void {
    lastMsgAt = wall();
    const text = typeof data === 'string' ? data : String(data);
    countBytes(bytesIn, text.length);
    let m: Record<string, unknown>;
    try { m = JSON.parse(text) as Record<string, unknown>; } catch { return; }
    if (!m || typeof m['t'] !== 'string') return;
    switch (m['t']) {
      case 'welcome': return onWelcome(m);
      case 'snap': return onSnap(m, text.length);
      case 'in': return onInput(m);
      case 'ev': emit('event', { k: String(m['k'] ?? ''), d: m['d'], from: typeof m['from'] === 'number' ? m['from'] : null, ...(typeof m['id'] === 'string' ? { id: m['id'] } : {}) }); return;
      case 'state': if (typeof m['k'] === 'string') applyState(m['k'], m['d']); return;
      case 'pong': return onPong(m);
      case 'announce': {
        if (typeof m['id'] !== 'string') return;
        const a: Announcement = { id: m['id'], text: typeof m['text'] === 'string' ? m['text'] : null, ...(typeof m['at'] === 'number' ? { at: m['at'] } : {}), ...(typeof m['until'] === 'number' ? { until: m['until'] } : {}), from: 'studio' };
        announcement = a.text ? a : null;
        emit('announce', a);
        return;
      }
      case 'mute': {
        const mute: Mute = { id: String(m['id'] ?? ''), seat: typeof m['seat'] === 'number' ? m['seat'] : null, until: Number(m['until']) || 0 };
        if (mute.seat !== null) { if (mute.until > now()) muted.set(mute.seat, mute.until); else muted.delete(mute.seat); }
        const p = peers.get(mute.id);
        if (p) peers.set(mute.id, { ...p, ...(mute.until > now() ? { muted: true } : { muted: undefined }) });
        emit('mute', mute);
        return;
      }
      case 'join': {
        const p = m['peer'] as Peer | undefined;
        if (p && typeof p.id === 'string') { peers.set(p.id, p); if (role === 'host' && p.seat !== null) ctlOf(p.seat); emit('join', p); }
        return;
      }
      case 'leave': {
        const pid = String(m['id'] ?? '');
        const p = peers.get(pid);
        peers.delete(pid);
        const s = typeof m['seat'] === 'number' ? m['seat'] : (p?.seat ?? null);
        if (s !== null) { inputs.delete(s); presses.delete(s); }
        emit('leave', { id: pid, seat: s, why: String(m['why'] ?? 'closed') });
        return;
      }
      case 'round': {
        roundInfo = m['round'] as RoundInfo;
        post?.({ what: 'round', round: roundInfo });
        emit('round', roundInfo);
        return;
      }
      case 'roster': {
        slots = (m['slots'] as Slot[]) ?? null;
        post?.({ what: 'roster', slots });
        if (slots) emit('roster', slots);
        return;
      }
      case 'host': {
        host = (m['host'] as HostRef | null) ?? null;
        rebase = true; // the next snapshot is on the new host's timeline
        for (const p of peers.values()) p.role = host && p.id === host.id ? 'host' : (p.seat === null ? 'screen' : 'replica');
        notifyStats(true);
        return;
      }
      case 'seat': {
        // A seat freed up and this spectator, who wanted to play, has it now.
        seat = typeof m['seat'] === 'number' ? m['seat'] : null;
        token = typeof m['token'] === 'string' ? m['token'] : token;
        name = typeof m['name'] === 'string' ? m['name'] : name;
        colour = typeof m['colour'] === 'number' ? m['colour'] : colour;
        if (id) { const p = peers.get(id); if (p) { p.seat = seat; p.name = name; p.colour = colour; } }
        post?.({ what: 'token', token, seat, room: cfg?.room ?? null });
        setRole(m['role'] === 'host' ? 'host' : 'replica', 'seated');
        return;
      }
      case 'role': {
        const next = m['role'] as Role;
        host = (m['host'] as HostRef | null) ?? host;
        rebase = true;
        if (Array.isArray(m['peers'])) { peers.clear(); for (const p of m['peers'] as Peer[]) peers.set(p.id, p); }
        if (m['round']) roundInfo = m['round'] as RoundInfo;
        if (m['roster']) slots = m['roster'] as Slot[];
        if (m['state']) replaceState(m['state']);
        const ckpt = (m['ckpt'] as Checkpoint<C> | null) ?? null;
        let snap = (m['snap'] as Snapshot<S> | null) ?? null;
        if (next === 'host' && !snap) snap = localSnap();
        if (ckpt) lastCkpt = ckpt;
        setRole(next, String(m['why'] ?? 'relay'), { ckpt, snap, round: roundInfo, roster: slots });
        if (next === 'host') { lastSnapSentAt = -Infinity; if (snap) tick = Math.max(tick, snap.k); }
        return;
      }
      case 'error': {
        const code = String(m['code'] ?? '');
        // Inputs over the relay's cap were dropped: send fewer for a while (the newest frame still goes out).
        if ((code === 'rate' && m['of'] === 'in') || code === 'flood') inSlowUntil = wall() + IN_SLOW_MS;
        if (code === 'rate' || code === 'state-full') { warnOnce(`${code}:${String(m['of'] ?? '')}`, m['message']); return; }
        console.warn('[netplay] relay refused:', code, m['message']);
        // The same seat opened in another tab, a full room, a version the relay does not speak: reconnecting
        // would repeat the refusal (or, for 'replaced', make the two tabs evict each other for ever).
        if (FINAL_ERRORS.has(code)) {
          closed = true;
          closedWhy = code;
          post?.({ what: 'closed', why: code, ...(typeof m['until'] === 'number' ? { until: m['until'] } : {}), ...(typeof m['message'] === 'string' ? { message: String(m['message']).slice(0, 200) } : {}) });
        }
        return;
      }
      default: return;
    }
  }
  const warned = new Map<string, number>();
  function warnOnce(key: string, msg: unknown): void {
    const t = wall();
    if (t - (warned.get(key) ?? -Infinity) < 10_000) return;
    warned.set(key, t);
    console.warn('[netplay]', msg);
  }

  function onWelcome(m: Record<string, unknown>): void {
    clearTimeout(connectTimer);
    const next = m['role'] as Role;
    const wasOffline = offline;
    // Reconnected (a network blip, or a relay restart) and still the host: my rules state is the live one.
    const continuing = roleKnown && role === 'host' && next === 'host' && !wasOffline;
    id = String(m['id']);
    seat = typeof m['seat'] === 'number' ? m['seat'] : null;
    token = typeof m['token'] === 'string' ? m['token'] : token;
    name = typeof m['name'] === 'string' ? m['name'] : name;
    colour = typeof m['colour'] === 'number' ? m['colour'] : colour;
    host = (m['host'] as HostRef | null) ?? null;
    peers.clear();
    if (Array.isArray(m['peers'])) for (const p of m['peers'] as Peer[]) peers.set(p.id, p);
    if (typeof m['st'] === 'number' && rtt === null) offset = (m['st'] as number) - Date.now();
    const ckpt = (m['ckpt'] as Checkpoint<C> | null) ?? null;
    let snap = (m['snap'] as Snapshot<S> | null) ?? null;
    const a = m['announce'] as Announcement | undefined;
    if (a && typeof a === 'object' && typeof a.id === 'string' && typeof a.text === 'string' && (!announcement || announcement.id !== a.id)) { announcement = { ...a, from: 'studio' }; queueMicrotask(() => emit('announce', announcement as Announcement)); }
    if (!continuing) {
      roundInfo = (m['round'] as RoundInfo | null) ?? roundInfo;
      slots = (m['roster'] as Slot[] | null) ?? slots;
      replaceState(m['state']);
    }
    rebase = true;
    if (snap && next !== 'host') acceptSnap(snap, JSON.stringify(snap).length, false);
    if (next === 'host' && !snap && !continuing) snap = localSnap();
    offline = false;
    connected = true;
    downSince = 0;
    attempt = 0;
    emit('status', true);
    post?.({ what: 'token', token, seat, room: cfg?.room ?? null });
    // First welcome, a reconnect, or coming back from an offline fallback: only a CHANGE is a role event,
    // except the very first, which always is (the game waits on it).
    if (!roleKnown || next !== role || wasOffline) {
      setRole(next, wasOffline && roleKnown ? 'reconnected' : String(m['why'] ?? 'welcome'), { ckpt, snap, round: roundInfo, roster: slots });
      if (next === 'host' && snap) tick = Math.max(tick, snap.k);
    }
    if (continuing) reannounce();
    ping(); setTimeout(ping, 120); setTimeout(ping, 260);
  }

  /** A host that reconnected (the relay may have restarted): hand the relay the round, roster, state and a checkpoint. */
  function reannounce(): void {
    if (roundInfo) raw({ t: 'round', round: roundInfo });
    if (slots) raw({ t: 'roster', slots });
    for (const [k, d] of stateMap) raw({ t: 'state', k, d });
    primeStateSent();
    sendCheckpoint();
  }

  /** Buffer a snapshot. `live`: it came off the wire just now (its age is a transit sample). */
  function acceptSnap(s: Snapshot<S>, bytes: number, live: boolean): boolean {
    const t = now();
    // A snapshot stamped far in the future would hold the buffer for good (the relay clamps st too).
    if (!Number.isFinite(s.st) || s.st > t + 1000) { rejectedSnaps += 1; return false; }
    if (rebase) {
      // New host, new timeline: its clock may sit a little behind the old one's. Keep older frames to hold on.
      while (buf.length && (buf[buf.length - 1] as Snapshot<S>).st >= s.st) buf.pop();
      rebase = false;
      lastArrival = 0;
    }
    const newest = buf[buf.length - 1];
    if (newest && s.st <= newest.st) return false;
    const arrival = wall();
    if (live) {
      const gap = lastArrival ? arrival - lastArrival : Infinity;
      if (lastArrival) {
        const stGap = s.st - lastArrivalSt;
        if (stGap > 0 && stGap < 1000) iv = iv * 0.9 + stGap * 0.1;
      }
      lastArrival = arrival;
      lastArrivalSt = s.st;
      // A snapshot handled in the same burst as the one before it waited behind this page's own stall (a GC, a
      // long frame), not on the network: its age says nothing about transit, and the page was not drawing anyway.
      if (gap >= iv * 0.25) {
        ages.push(t - s.st);
        if (ages.length > 40) ages.shift();
        const sorted = [...ages].sort((x, y) => x - y);
        ageP90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] as number;
        // The 95th percentile and 1.4 intervals, not the 90th and 1.2. A phone host's frame
        // quantisation (snapshots at 50/67 ms) plus 30-50 ms relay jitter held the picture on 5-8 % of a desktop
        // replica's frames in the contract e2e (interpolation-not-starved); this buys ~20 ms of delay for it.
        const ageP95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] as number;
        // Render far enough back that the next snapshot is normally here before we need it: its age, plus one
        // interval. Rise up to 6 ms a snapshot (a hold is visible); fall 6% of the excess a snapshot, at least 3 ms
        // (boot-time jank clears in about a second, as a brief time-warp nobody sees).
        const target = Math.max(50, Math.min(400, ageP95 + iv * 1.4 + 6));
        if (!delaySmooth || ages.length <= 3) delaySmooth = target;
        else if (target > delaySmooth) delaySmooth += Math.min(6, target - delaySmooth);
        else delaySmooth -= Math.min(delaySmooth - target, Math.max(3, (delaySmooth - target) * 0.06));
      }
    }
    lastSnapBytes = bytes;
    maxSnapBytes = Math.max(maxSnapBytes, bytes);
    buf.push(s);
    lastSnapInfo = { k: s.k, st: s.st, from: s.from ?? null, at: Date.now() };
    const cutoff = s.st - 1500;
    while (buf.length > 2 && (buf[0] as Snapshot<S>).st < cutoff) buf.shift();
    if (buf.length > 64) buf.splice(0, buf.length - 64);
    if (live) snapIn.hit(arrival);
    controlFrom(s);
    return true;
  }

  /** Seated replica: read my entry of the control table in the newest snapshot. */
  function controlFrom(s: Snapshot<S>): void {
    if (seat === null || role === 'host' || !Array.isArray(s.c)) return;
    const e = s.c.find((x) => x[0] === seat);
    if (!e) return;
    const [, rs, own, ack] = e;
    const reset = rs !== mine.rs;
    const ownB = own === 1;
    const changed = reset || ownB !== mine.own;
    mine = { rs, own: ownB, ack };
    if (reset) sentHist.length = 0;
    else while (sentHist.length && (sentHist[0] as { q: number }).q <= ack) sentHist.shift();
    if (changed) emit('control', { seat, rs, own: ownB, ack, reset, snap: s });
  }

  function onSnap(m: Record<string, unknown>, bytes: number): void {
    if (role === 'host') return; // a stale frame from a previous host
    const s: Snapshot<S> = { k: Number(m['k']) || 0, st: Number(m['st']), d: m['d'] as S, from: typeof m['from'] === 'number' ? m['from'] : null };
    if (Array.isArray(m['c'])) s.c = m['c'] as ControlWire[];
    if (acceptSnap(s, bytes, true)) emit('snapshot', s);
  }

  function onInput(m: Record<string, unknown>): void {
    if (role !== 'host') return;
    const from = m['from'];
    if (typeof from !== 'number') return;
    const p: Record<string, number> = {};
    if (m['p'] && typeof m['p'] === 'object') {
      for (const [k, v] of Object.entries(m['p'] as Record<string, unknown>)) p[k] = Math.max(0, Math.min(8, Math.floor(Number(v) || 0)));
    }
    const f: InputFrame<A> = {
      q: Number(m['q']) || 0, a: m['a'] as A,
      h: Array.isArray(m['h']) ? (m['h'] as unknown[]).map(String) : [],
      p, from, r: typeof m['r'] === 'number' ? m['r'] : null,
    };
    const prev = inputs.get(from);
    if (prev && f.q <= prev.q && f.q > 0) return; // out of order
    inputs.set(from, f);
    ctlOf(from).ack = f.q;
    const acc = presses.get(from) ?? {};
    for (const [k, v] of Object.entries(f.p)) acc[k] = Math.min(64, (acc[k] ?? 0) + v);
    presses.set(from, acc);
    inputIn.hit(wall());
    emit('input', f);
  }

  function onPong(m: Record<string, unknown>): void {
    const c = Number(m['c']);
    const st = Number(m['st']);
    const sent = pingsOut.get(c);
    if (sent === undefined || !Number.isFinite(st)) return;
    pingsOut.delete(c);
    const recv = Date.now();
    const r = recv - sent;
    const off = st + r / 2 - recv;
    samples.push({ rtt: r, off });
    if (samples.length > 8) samples.shift();
    const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    rtt = r;
    // Slew small corrections, jump big ones: a clock that jumps backwards makes interpolation stutter.
    const d = best.off - offset;
    offset = Math.abs(d) > 100 || samples.length <= 3 ? best.off : offset + Math.max(-5, Math.min(5, d));
    notifyStats(false);
  }

  // ---------------------------------------------------------------- wire out
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let ckptTimer: ReturnType<typeof setInterval> | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let lastStatsPost = 0;

  function hidden(): boolean { try { return Boolean(g.document?.hidden); } catch { return false; } }
  function ping(): void {
    if (!connected) return;
    // A socket that delivered nothing (not even a pong) for staleMs is half-open: drop it and reconnect.
    if (ws && lastMsgAt && wall() - lastMsgAt > staleMs) { lost(ws, 'stale'); return; }
    const c = Date.now();
    pingsOut.set(c, c);
    if (pingsOut.size > 16) { const first = pingsOut.keys().next().value; if (first !== undefined) pingsOut.delete(first); }
    raw({ t: 'ping', c, hid: hidden() });
  }

  function sendCheckpoint(): void {
    if (role !== 'host' || !opts.checkpoint || offline || !connected) return;
    let d: C;
    try { d = opts.checkpoint(); } catch (err) { console.warn('[netplay] checkpoint()', err); return; }
    const c: Checkpoint<C> = { k: tick, st: now(), d, c: ctlWire() };
    lastCkpt = c;
    raw({ t: 'ckpt', k: c.k, st: c.st, d: c.d, c: c.c });
  }

  /** How long until one more input frame fits the rolling-second cap (0: now). */
  function inputBudgetWait(): number {
    const t = wall();
    while (inSent.length && (inSent[0] as number) <= t - 1000) inSent.shift();
    const cap = t < inSlowUntil ? IN_SLOW_CAP_PER_S : IN_CAP_PER_S;
    if (inSent.length < cap) return 0;
    return Math.max(1, (inSent[inSent.length - cap] as number) + 1000 - t);
  }

  function flushInput(): void {
    inputTimer = null;
    if (role === 'host' || seat === null || offline || !connected || pendingA === undefined) return;
    // Never a burst: over the cap, or with the last frames still unsent on the socket, the newest frame waits
    // (it replaces whatever was pending, so nothing stale is ever flushed after a stall).
    const budget = inputBudgetWait();
    const backlog = (ws?.bufferedAmount ?? 0) > IN_BACKLOG_BYTES;
    if (budget > 0 || backlog) { inputTimer = setTimeout(flushInput, backlog ? Math.max(budget, 30) : budget); return; }
    // Standing still: the host has this exact frame already. Say it again only as a keepalive.
    const pressed = Object.keys(pendingPresses).length > 0;
    let sig = '';
    try { sig = JSON.stringify([pendingA, pendingHeld, mine.rs]); } catch { sig = ''; }
    if (!pressed && sig && sig === lastInputSig && wall() - lastInputSentAt < IDLE_INPUT_MS) { idleSkipped += 1; return; }
    inSent.push(wall());
    inSeq += 1;
    const msg: Record<string, unknown> = { t: 'in', q: inSeq, a: pendingA, h: pendingHeld, r: mine.rs };
    if (Object.keys(pendingPresses).length) msg['p'] = pendingPresses;
    if (raw(msg)) {
      inputOut.hit(wall()); pendingPresses = {}; lastInputSig = sig;
      sentHist.push({ q: inSeq, a: pendingA, h: pendingHeld, at: wall(), r: mine.rs });
      if (sentHist.length > 64) sentHist.shift();
    }
    lastInputSentAt = wall();
  }

  function scheduleInput(urgent: boolean): void {
    const since = wall() - lastInputSentAt;
    const wait = Math.max(inputBudgetWait(), urgent ? Math.max(0, 16 - since) : Math.max(0, inputMs - since));
    if (wait <= 0) { if (inputTimer) { clearTimeout(inputTimer); inputTimer = null; } flushInput(); return; }
    if (inputTimer) return;
    inputTimer = setTimeout(flushInput, wait);
  }

  function statsNow(): NetStats {
    const t = wall();
    return {
      role, seat, host, connected, offline, rtt, offset: Math.round(offset),
      snapHzIn: snapIn.hz(t), snapHzOut: snapOut.hz(t), inputHzIn: inputIn.hz(t), inputHzOut: inputOut.hz(t), idleInputsSkipped: idleSkipped,
      lastSnapBytes, maxSnapBytes, bytesInPerS: perSecond(bytesIn), bytesOutPerS: perSecond(bytesOut),
      interpDelay: Math.round(interpDelay()), snapAgeP90: Math.round(ageP90), starvedPct: +starvedPct.toFixed(3), rejectedSnaps,
      owned: api.owned, pending: sentHist.length, stateKeys: stateMap.size,
      peers: peers.size, reconnects, promotions, round: roundInfo ? roundInfo.n : null,
    };
  }
  function notifyStats(force: boolean): void {
    if (!post) return;
    const t = wall();
    if (!force && t - lastStatsPost < 450) return;
    lastStatsPost = t;
    post({ what: 'stats', stats: statsNow(), name, colour });
  }

  function interpDelay(): number {
    if (opts.interpDelayMs !== undefined) return opts.interpDelayMs;
    return delaySmooth || Math.max(50, iv * 1.6 + 8);
  }

  // ---------------------------------------------------------------- connect
  function goOfflineHost(why: string): void {
    offline = true;
    connected = false;
    seat = null;
    if (!roleKnown || role !== 'host') setRole('host', why);
  }

  function lost(sock: WebSocketLike, why: string): void {
    if (ws !== sock) return;
    ws = null;
    sock.onclose = null; sock.onmessage = null; sock.onerror = null; sock.onopen = null;
    if (why !== 'closed') { try { sock.close(4000, why); } catch { /* gone */ } }
    const was = connected;
    connected = false;
    if (was) downSince = wall();
    if (was) emit('status', false);
    notifyStats(true);
    retry();
  }

  function open(): void {
    if (closed || !cfg || !WS || ws) return;
    let sock: WebSocketLike;
    try { sock = new WS(cfg.url); } catch { retry(); return; }
    ws = sock;
    sock.onopen = () => {
      lastMsgAt = wall();
      raw({ t: 'hello', v: NETPLAY_VERSION, token, name: name || undefined, device, want, canHost, game: opts.game, max: opts.maxPlayers });
    };
    sock.onmessage = (ev) => onMessage(ev.data);
    sock.onclose = () => lost(sock, 'closed');
    // Browsers follow an error with close; Node's WebSocket, on a refused connection, never does.
    sock.onerror = () => lost(sock, 'error');
  }
  function retry(): void {
    if (closed) return;
    // A hidden tab does not play and its timers crawl: reconnect when it is looked at again.
    if (hidden()) { waitingVisible = true; return; }
    const wait = LADDER[Math.min(attempt, LADDER.length - 1)] as number;
    attempt += 1;
    reconnects += 1;
    setTimeout(open, wait);
  }

  if (offline) {
    // No shell (a plain file, a dev server): the game is its own host, offline.
    queueMicrotask(() => goOfflineHost('offline'));
  } else {
    post?.({ what: 'attached', v: NETPLAY_VERSION });
    open();
    // A relay that never answers must not leave a game on a black screen. But the wait is counted only while
    // this page is able to listen: a phone compiling shaders under load is blocked for seconds at a time, and
    // neither its socket's open nor the relay's welcome can be handled meanwhile. Giving up on the wall clock
    // started a private fight 1 at every loaded boot and swapped it for the room's a moment later. A socket
    // that is connecting or open gets CONNECT_OPEN_MAX_MS of that listening time; one that failed outright
    // (ws is null between retries) gets connectTimeoutMs.
    let listenedMs = 0;
    let lastCheckAt = wall();
    const connectCheck = (): void => {
      if (roleKnown) return;
      const t = wall();
      listenedMs += Math.min(t - lastCheckAt, 600);
      lastCheckAt = t;
      const live = Boolean(ws && (ws.readyState === 0 || ws.readyState === 1));
      if (listenedMs < (live ? CONNECT_OPEN_MAX_MS : connectTimeoutMs)) { connectTimer = setTimeout(connectCheck, 250); return; }
      goOfflineHost('relay-timeout');
    };
    connectTimer = setTimeout(connectCheck, 250);
    pingTimer = setInterval(ping, 2000);
    ckptTimer = setInterval(sendCheckpoint, checkpointMs);
    statsTimer = setInterval(() => notifyStats(true), 500);
    try {
      g.document?.addEventListener('visibilitychange', () => {
        if (!hidden() && waitingVisible) { waitingVisible = false; attempt = 0; open(); return; }
        if (!connected) return;
        if (hidden()) {
          // A hidden phone tab loses its timers and rAF: hand the round on before it stalls.
          if (role === 'host' && peers.size > 1) { sendCheckpoint(); raw({ t: 'yield' }); }
          ping();
        } else ping();
      });
      g.addEventListener?.('pagehide', () => { if (role === 'host') sendCheckpoint(); raw({ t: 'bye' }); });
    } catch { /* not a browser */ }
  }

  // ---------------------------------------------------------------- API
  const api: Netplay<S, A, C> = {
    get role() { return role; },
    get isHost() { return role === 'host'; },
    get seat() { return seat; },
    get spectator() { return seat === null && !offline; },
    get offline() { return offline; },
    get connected() { return connected; },
    get closedWhy() { return closedWhy; },
    get downMs() { return connected || !downSince ? 0 : wall() - downSince; },
    get owned() { return role === 'host' || offline || seat === null ? true : mine.own; },
    get id() { return id; },
    get name() { return name; },
    get colour() { return colour; },
    get device() { return device; },
    get host() { return host; },
    get peers() { return peers; },
    get roundInfo() { return roundInfo; },
    get slots() { return slots; },
    get announcement() { return announcement && (announcement.until === undefined || announcement.until > now()) ? announcement : null; },
    isMuted(s: number | null): boolean { return s !== null && (muted.get(s) ?? 0) > now(); },
    pickPlayer(s: number | null): void { post?.({ what: 'pick', seat: typeof s === 'number' ? s : null }); },
    ready,
    on(kind, fn) {
      (handlers[kind] as Set<unknown>).add(fn);
      return () => { (handlers[kind] as Set<unknown>).delete(fn); };
    },
    now,
    snapshotDue() {
      if (role !== 'host' || !connected || offline) return false;
      // Alone: 1 Hz, so a joiner's welcome carries a recent world. With company: snapshotHz.
      return wall() - lastSnapSentAt >= (peers.size > 1 ? snapshotMs : 1000) - 2;
    },
    snapshot(d, k, force = false) {
      if (role !== 'host' || offline || !connected) return false;
      if (!force && wall() - lastSnapSentAt < (peers.size > 1 ? snapshotMs : 1000) - 2) return false;
      tick = k ?? tick + 1;
      const st = now();
      const c = ctlWire();
      const text = JSON.stringify(c.length ? { t: 'snap', k: tick, st, d, c } : { t: 'snap', k: tick, st, d });
      if (!ws || ws.readyState !== 1) return false;
      // A congested socket drops a snapshot rather than queueing a stale one. At 3 KB (about six
      // snapshots), not 256 KB. A starved network thread on a loaded phone held a second of snapshots and then
      // flushed them at once; the relay counted 30+ in a second, dropped them, and called the host stalled.
      if ((ws.bufferedAmount ?? 0) > 3 * 1024) return false;
      try { ws.send(text); } catch { return false; }
      countBytes(bytesOut, text.length);
      lastSnapSentAt = wall();
      lastSnapBytes = text.length;
      maxSnapBytes = Math.max(maxSnapBytes, text.length);
      if (text.length > 8192) warnOnce('snap-size', `snapshot is ${text.length} B; the budget is 8 KB (move slow state to net.state())`);
      snapOut.hit(wall());
      return true;
    },
    checkpointNow: sendCheckpoint,
    handOff() {
      if (role !== 'host' || offline || !connected || peers.size < 2) return false;
      sendCheckpoint();
      return raw({ t: 'yield' });
    },
    round(r) {
      roundInfo = r;
      post?.({ what: 'round', round: r });
      if (role === 'host') raw({ t: 'round', round: r });
      emit('round', r);
    },
    roster(s) {
      slots = s.map((x) => ({ slot: x.slot, seat: x.seat, name: x.name, bot: x.bot }));
      post?.({ what: 'roster', slots });
      if (role === 'host') raw({ t: 'roster', slots });
    },
    state(key, d) {
      if (role !== 'host' && !offline) return false;
      const text = JSON.stringify(d ?? null);
      if (stateSent.get(key) === text) return false;
      stateSent.set(key, text);
      if (d === null || d === undefined) stateMap.delete(key); else stateMap.set(key, d);
      if (text.length > 6000) warnOnce(`state-size:${key}`, `state '${key}' is ${text.length} B; split it (8 KB cap per key)`);
      if (!offline) raw({ t: 'state', k: key, d: d ?? null });
      return true;
    },
    stateOf<T = unknown>(key: string) { return stateMap.get(key) as T | undefined; },
    stateKeys() { return [...stateMap.keys()]; },
    input(a, held) {
      pendingA = a;
      const list = heldList(held);
      let edge = false;
      for (const h of list) if (!prevHeld.has(h)) { pendingPresses[h] = (pendingPresses[h] ?? 0) + 1; edge = true; }
      prevHeld = new Set(list);
      pendingHeld = list;
      if (role === 'host' || seat === null || offline || !connected) { pendingPresses = {}; return; }
      scheduleInput(edge);
    },
    press(idp) {
      if (role === 'host' || seat === null || offline || !connected) return;
      pendingPresses[idp] = (pendingPresses[idp] ?? 0) + 1;
      scheduleInput(true);
    },
    send(kind, data, to) {
      if (offline) return;
      const m: Record<string, unknown> = { t: 'ev', k: kind, d: data ?? null };
      if (role === 'host' && (typeof to === 'number' || typeof to === 'string')) m['to'] = to;
      raw(m);
    },
    inputOf(s) { return inputs.get(s) ?? null; },
    avatar(s) {
      const f = inputs.get(s);
      if (!f) return null;
      sweepCtl();
      const e = ctlOf(s);
      return e.own && f.r === e.rs ? f.a : null;
    },
    takePresses(s) { const p = presses.get(s) ?? {}; presses.delete(s); return p; },
    control(s) { sweepCtl(); const e = ctlOf(s); return { seat: s, rs: e.rs, own: e.own, taken: e.taken, ack: e.ack }; },
    reset(s) { const e = ctlOf(s); e.rs += 1; return e.rs; },
    take(s, ms) { const e = ctlOf(s); e.own = false; e.taken = true; e.giveAt = ms && ms > 0 ? wall() + ms : 0; },
    give(s) { const e = ctlOf(s); if (e.taken) giveBack(e); },
    pending() {
      const out: PendingInput<A>[] = [];
      for (let i = 0; i < sentHist.length; i += 1) {
        const f = sentHist[i] as { q: number; a: A; h: string[]; at: number; r: number };
        if (f.r !== mine.rs || f.q <= mine.ack) continue;
        const next = sentHist[i + 1];
        out.push({ q: f.q, a: f.a, h: f.h, at: f.at, dt: Math.max(0, (next ? next.at : wall()) - f.at) });
      }
      return out;
    },
    sample(delayMs) {
      if (!buf.length) return null;
      const renderT = now() - (delayMs ?? interpDelay());
      const newest = buf[buf.length - 1] as Snapshot<S>;
      const oldest = buf[0] as Snapshot<S>;
      const t = wall();
      if (!starvedWindowAt) starvedWindowAt = t;
      if (t - starvedWindowAt >= 2000) { starvedPct = sampleFrames ? starvedFrames / sampleFrames : 0; sampleFrames = 0; starvedFrames = 0; starvedWindowAt = t; }
      sampleFrames += 1;
      if (renderT >= newest.st) {
        const over = renderT - newest.st;
        if (over > 0) {
          starvedFrames += 1;
          // An underrun: grow the buffer by exactly the overrun (up to 30 ms a frame). The picture was holding on
          // the newest snapshot anyway, so nothing jumps back, and the next snapshots continue instead of catching up.
          if (delayMs === undefined && opts.interpDelayMs === undefined && delaySmooth) delaySmooth = Math.min(400, delaySmooth + Math.min(30, over));
        }
        return { a: newest, b: newest, alpha: 1, renderT, starved: over };
      }
      if (renderT <= oldest.st) return { a: oldest, b: oldest, alpha: 0, renderT, starved: 0 };
      for (let i = buf.length - 1; i > 0; i -= 1) {
        const a = buf[i - 1] as Snapshot<S>;
        const b = buf[i] as Snapshot<S>;
        if (a.st <= renderT && renderT <= b.st) {
          const span = b.st - a.st;
          return { a, b, alpha: span > 0 ? (renderT - a.st) / span : 1, renderT, starved: 0 };
        }
      }
      return { a: newest, b: newest, alpha: 1, renderT, starved: 0 };
    },
    latest() { return buf.length ? buf[buf.length - 1] as Snapshot<S> : null; },
    stats: statsNow,
    expose(p) { probes = { ...probes, ...p }; },
    close() {
      closed = true;
      if (pingTimer) clearInterval(pingTimer);
      if (ckptTimer) clearInterval(ckptTimer);
      if (statsTimer) clearInterval(statsTimer);
      clearTimeout(connectTimer);
      try { raw({ t: 'bye' }); ws?.close(1000, 'bye'); } catch { /* gone */ }
    },
  };

  // Harness / console surface. Counters and probes, never controls.
  try {
    g.__homieNet = {
      get role() { return role; },
      get seat() { return seat; },
      get offline() { return offline; },
      get connected() { return connected; },
      get owned() { return api.owned; },
      get host() { return host; },
      get peers() { return [...peers.values()]; },
      get round() { return roundInfo; },
      get roster() { return slots; },
      get state() { return Object.fromEntries(stateMap); },
      get lastCheckpoint() { return lastCkpt ? { k: lastCkpt.k, st: lastCkpt.st } : null; },
      /** The newest snapshot this browser received: tick, server time, sender seat, local Date.now() of arrival. */
      get lastSnapshot() { return lastSnapInfo; },
      stats: statsNow,
      now,
      get probe() { return probes; },
    };
  } catch { /* frozen global */ }

  return api;
}
