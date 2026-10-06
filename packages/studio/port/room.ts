/*
 * createRoom — the host scaffold every netplay port needs, so a port writes
 * its GAME, not its plumbing. It is the reference game's (Gem Rush's) room
 * logic made generic, and it is the part ports most often got subtly wrong:
 *
 *   - Instant start: the first browser hosts and starts round 1 at once, with
 *     bots in the empty seats (minBodies).
 *   - Join in progress: an arriving person takes a bot's body where it stands
 *     (the host resets that body so the new browser adopts it); a person who
 *     leaves hands the body back to a bot.
 *   - Rounds that never stop: live until endsAt, results for breakSeconds,
 *     then the next round, forever, with round numbers that only go up.
 *   - Host migration: a checkpoint every second; a promoted browser restores
 *     it, overlays the newer snapshot, reconciles who is still here, resets
 *     every claimed seat and keeps its own body where it was, then continues
 *     the SAME round.
 *   - Snapshots: one small row per body [slot, seat (-1 = bot), score, ...your
 *     fields], plus your fast world, at 20 Hz; replicas interpolate them.
 *
 *   - Seat or solo (NETPLAY.md section 28): a page in the room with no body is
 *     never left with nothing said. The host seats whoever is waiting when a
 *     body frees up and at every round start; `fallback` decides what the page
 *     does meanwhile (wait, a private round with bots, or watch), within
 *     `seatWaitMs`, and `room.standing` says where the player stands.
 *
 *   - Servers and agent seats (NETPLAY.md section 17): a hybrid server's AI
 *     seats are kept as AI bodies (the game's bots move them, marked AI), an AI
 *     that sits takes one, the server's `bots: 'off'` adds no filler bots, and
 *     `room.skillOf(body)` is the dial a bot plays at (the party votes it).
 *
 * What stays the game's: the rules (what a body does per frame), the bots'
 * brains, the drawing, and the camera. See the port skill's recipe.
 */
import {
  capMove, createNetplay, lerp, lerpAngle, placesOf, Roster,
  type Movement, type Netplay, type NetplayOptions, type Policy, type RoleChange, type RosterOptions, type RoundInfo, type RoundResult, type Skill, type Slot, type Snapshot, type TiePolicy,
} from '../netplay/netplay';

/** A body. `agent` (revision 6): this body is an AI's (a seat kept for AI, or an agent's), always marked AI. */
export interface BodyBase { slot: number; seat: number | null; name: string; bot: boolean; score: number; agent?: Slot['agent'] }

export interface RoomSnap<F = unknown> { r: [n: number, phase: number, startedAt: number, endsAt: number]; b: number[][]; w?: F }
export interface RoomCkpt<B, S> {
  round: RoundInfo | null; roster: Slot[]; bodies: B[]; world: S | null; tick: number; spawns?: [slot: number, index: number][];
  /** Which stay in its seat held each body ([seat, occ], from the relay's `peer.occ`): how a new host tells a player who came back from a new one in the same seat number. */
  occ?: [seat: number, occ: number][];
}
/**
 * Why a body changed hands (`onTakeover`'s second argument). `join`: a person arrived in a running round. `restore`:
 * this browser became host of a room that had emptied and still had its checkpoint, and the body was claimed as the
 * round came back. `migrate`: this browser was promoted in a live room and the body's player had arrived since the
 * last checkpoint. `own`: it is this browser's own body. `back`: its player held it before (a reload, a reconnect),
 * so a game that keeps a returning player's score reads this.
 */
export interface TakeoverInfo { why: 'join' | 'restore' | 'migrate'; own: boolean; back: boolean }

/**
 * SEAT OR SOLO (NETPLAY.md section 28): what a page does while the room has no body for it. `wait` (the default):
 * nothing but say so. `solo`: play a private round with bots, and move into the room the moment it has a body for
 * this player (at the latest its next round start). `spectate`: watch the room until then.
 */
export type Fallback = 'wait' | 'solo' | 'spectate';
/**
 * Where this player stands, in one word a game can act on. `joining`: not in the round yet (no welcome, or no body
 * yet and still inside `seatWaitMs`). `playing`: a body in the room. `solo`: playing by itself with bots (`why`:
 * `alone` or `offline` from the link, `no-body` or `full` from the fallback). `watching`: a screen or a watcher by
 * choice (`screen`), or the fallback's `spectate`. `waiting`: the fallback's `wait`, past `seatWaitMs`. `closed`:
 * the link stopped for good (`why` is `net.closedWhy`).
 */
export interface Standing {
  state: 'joining' | 'playing' | 'solo' | 'watching' | 'waiting' | 'closed';
  why: string;
  /** The sentence on screen for it (the line over the game), or null. */
  line: string | null;
}

export interface RoomOptions<B extends BodyBase, F = unknown, S = unknown> {
  /** The game id (the relay's logs). */
  game: string;
  /** Seats in a room (game.json players.max). */
  maxPlayers: number;
  /** Bodies from the first frame, people plus bots (default min(4, maxPlayers)). A lone visitor never plays alone. */
  minBodies?: number;
  /** 'owner' (default): each browser moves its own body at once, the host bounds it — action games.
   *  'host': the host's rules move every body from intents and the seat predicts — turn-based, grid, and rule-heavy games. */
  movement?: Movement;
  roundSeconds: number;
  /** Results on screen between rounds (default 7). */
  breakSeconds?: number;
  botName?: (slot: number) => string;
  /**
   * A fresh body for a slot. Spread the spawns with `index`: at a round start the bodies get 0, 1, 2… in slot order; a
   * body that arrives mid-round (a joiner with no bot to take over, a guide's seat) gets the lowest index no body in
   * the room holds, so two bodies never get the same one.
   */
  spawn: (slot: Slot, index: number) => B;
  /** The body's fast fields for the snapshot, after [slot, seat, score]: small numbers only (use q()). */
  pack: (b: B) => number[];
  /** Those fields back onto a body (replicas draw it; an adopting owner stands there). */
  unpack: (fields: number[], into: B) => void;
  /** Indexes (into pack()'s array) that are angles in radians: interpolated the short way round. */
  angles?: number[];
  /** Indexes that must NOT be interpolated (flags, animation frames, counters). */
  discrete?: number[];
  /** Host: round n starts; every body was just respawned. Reset the world here. */
  onRoundStart?: (n: number) => void;
  onRoundEnd?: (results: RoundResult[]) => void;
  /**
   * Host: a person took over `body` (it was a bot). Default: keep where it stands, score 0. Called for every such
   * claim, however it came about (NETPLAY.md section 25): a join in a running round, and the claims made when a
   * room that had emptied is revived from its checkpoint or a host is replaced, the new host's own body included.
   * `info` says which. Not called for a player whose body never left them.
   */
  onTakeover?: (body: B, info: TakeoverInfo) => void;
  /**
   * ADMISSION (section 25): which bot's body a NEW arrival takes, for a game where not every body will do (an
   * elimination round: a newcomer should not be handed a dead body while a living bot stands by). Called with the
   * bots' bodies the arrival may take, in slot order; return the one to give, `undefined` for the default (the
   * lowest slot), or `null` when none will do (a new body is spawned while the room has space; with none, the
   * default applies). Decide from the bodies' own state, so a new host makes the same choice. It is asked for fresh
   * joins and for the claims of a restored room or a new host alike; never for a player coming back to their own
   * body, never with a seat kept for AI when a person arrives. The host resets the body and checkpoints as always.
   */
  admit?: (candidates: B[], who: { seat: number; name: string; agent: boolean }) => B | null | undefined;
  /**
   * How results place equal scores (section 26). 'order' (the default, what results always were): 1, 2, 3… in the
   * order below, so two equal scores get different places. 'shared': equal scores share a place and the next is
   * skipped (1, 1, 3). 'dense': they share one and none is skipped (1, 1, 2). The order of the rows is always:
   * higher score first, then people before bots, then the lower slot.
   */
  ties?: TiePolicy;
  /** Host: the fast world beyond bodies (projectiles, pickups), sent with every snapshot. Keep it under ~1.5 KB. */
  fastWorld?: () => F;
  /** Host: everything else the rules need to continue (for checkpoints). */
  saveWorld?: () => S;
  /** A promoted host: put the world back (the snapshot's fast world is newer than the checkpoint's). */
  loadWorld?: (world: S | null, fast: F | undefined) => void;
  /** My own body was placed by the host (round start, takeover, the end of a knockback): stand exactly there. */
  adopt?: (body: B) => void;
  /** A replica's own body as it sees it right now (owner movement): a promotion keeps it exactly there. */
  local?: () => B | null;
  /**
   * SEAT OR SOLO (section 28): what this page does when it is in the room and the room has no body for it for
   * `seatWaitMs`: its host has not seated it (every body is somebody's), every seat is taken, or no snapshot has
   * shown its body yet. `'wait'` (the default) keeps what a game did before, and says so on the line over the game.
   * `'solo'`: a private round with bots, here, until the room has a body for this player (the host seats everybody
   * who is waiting at every round start and whenever a body frees up). `'spectate'`: `viewBody()` follows the room.
   */
  fallback?: Fallback;
  /** How long a page in the room waits for its body before the fallback applies. Default 4000 ms; 1000 to 30000. */
  seatWaitMs?: number;
  /** Where this player stands changed (also `room.standing`): draw your own words for it, or leave the line to say it. */
  onStanding?: (s: Standing) => void;
  /** Extra netplay options (snapshotHz, inputHz, config for tests). */
  netplay?: Partial<NetplayOptions<RoomCkpt<B, S>>>;
}

export interface Room<B extends BodyBase, F = unknown, S = unknown> {
  readonly net: Netplay<RoomSnap<F>, unknown[], RoomCkpt<B, S>>;
  /** True while this browser runs the rules: the room's, or (`solo`) a private round of its own. */
  readonly hosting: boolean;
  /** This browser plays a private round with bots while the room has no body for it (`fallback: 'solo'`). */
  readonly solo: boolean;
  /** Where this player stands (section 28): playing, on its own, watching, waiting, joining or closed, and why. */
  readonly standing: Standing;
  /** Host: every body by slot. */
  readonly bodies: Map<number, B>;
  /** The live round (host: authoritative; others: the relay's copy). */
  readonly round: RoundInfo | null;
  /** My seat (0 when offline: a solo game with bots, the way a plain file or a dev server plays). */
  mySeat(): number | null;
  /**
   * WATCHING (NETPLAY.md section 16): whose camera and HUD to draw. My own seat when I play (0 offline); for a
   * watcher, the seat it follows, or null for the overview camera. Point your camera at `viewBody()` (for your own
   * seat, keep drawing your local body) and your HUD at its numbers; null: your spectator overview.
   */
  viewSeat(): number | null;
  /** The body of viewSeat() as everyone draws it (host: the real one; others: interpolated), or null. */
  viewBody(): B | null;
  /** The skill dial a bot body plays at now (section 17): the party's vote, a guide's server level, else Fair. */
  skillOf(body: { slot: number }): Skill;
  /** Host: my own body. Replica: null (draw yours from your local state). */
  mine(): B | null;
  /** Host, every frame: the round clock and the snapshot. Replica: no-op. Call AFTER your rules moved the bodies. */
  update(): void;
  /** Host: the owner's latest avatar for this body's seat (owner movement), or null while taken/stale. */
  avatar(b: B): unknown[] | null;
  /** Host: take a claimed position if it is plausible; a teleport resets the owner. true when accepted. */
  bound(b: B & { x: number; y: number; z?: number }, claim: { x: number; y: number; z?: number }, maxSpeed: number, dt: number): boolean;
  /** Host: I moved this person's body myself (respawn, teleport): its owner adopts the new spot. */
  moved(b: B): void;
  /** Host: presses a seat sent since the last call ({ jump: 1 }). */
  presses(b: B): Record<string, number>;
  /** Replica, every frame: my avatar/intent and held buttons for the host (the helper paces and stamps it). */
  input(frame: unknown[], held?: Iterable<string>): void;
  /** Replica: a button press (never lost, even between snapshots). */
  press(id: string): void;
  /** Everyone: the bodies to draw. Host: the real ones; replica: interpolated from snapshots. */
  view(): B[];
  /** Replica: the newest fast world (projectiles, pickups) from the host. Host: fastWorld(). */
  fast(): F | undefined;
  /** Seconds left in this phase, and the phase. */
  clock(): { n: number; phase: 'live' | 'over' | 'none'; secondsLeft: number };
  /** Rank bodies by score (equal scores: people before bots, then the lower slot; their places as `ties` says). */
  results(): RoundResult[];
  /** One-shot events to everyone (sounds, hits, effects). */
  send(kind: string, data?: unknown): void;
  on: Netplay<RoomSnap<F>, unknown[], RoomCkpt<B, S>>['on'];
}

const BOT_NAMES = ['Rook', 'Vex', 'Moth', 'Kilo', 'Juno', 'Pike', 'Nyx', 'Ash', 'Oslo', 'Wren', 'Brio', 'Tace', 'Lumo', 'Fitz', 'Sable', 'Quill'];

export function createRoom<B extends BodyBase, F = unknown, S = unknown>(opts: RoomOptions<B, F, S>): Room<B, F, S> {
  const max = Math.max(1, opts.maxPlayers);
  const min = Math.max(1, Math.min(max, opts.minBodies ?? Math.min(4, max)));
  const roundMs = Math.max(10, opts.roundSeconds) * 1000;
  const breakMs = Math.max(3, opts.breakSeconds ?? 7) * 1000;
  const botName = opts.botName ?? ((slot: number) => BOT_NAMES[slot % BOT_NAMES.length] as string);
  const angles = new Set(opts.angles ?? []);
  const discrete = new Set(opts.discrete ?? []);

  // The roster keeps the server's AI seats (section 17); the policy is the room's, read when it fills.
  const policy = (): Policy => net.policy;
  // The game's admission choice (section 25), in bodies: the roster asks it for every new arrival's claim.
  const rosterOpts = (): RosterOptions => ({
    min, max, botName, policy,
    ...(opts.admit ? {
      admit: (cands, who) => {
        const list = cands.map((c) => bodies.get(c.slot)).filter((b): b is B => Boolean(b));
        // A round that has not spawned its bodies yet has nothing to choose between.
        if (!list.length) return undefined;
        const pick = (opts.admit as NonNullable<RoomOptions<B, F, S>['admit']>)(list, who);
        return pick === null ? null : pick ? pick.slot : undefined;
      },
    } : {}),
  });
  let roster = new Roster(rosterOpts());
  let bodies = new Map<number, B>();
  /** The index each body was spawned with (slot → index), so a body that arrives mid-round never gets one in use. */
  let spawned = new Map<number, number>();
  let round: RoundInfo | null = null;
  let hosting = false;
  let tick = 0;
  // Seat or solo (section 28).
  const fallback: Fallback = opts.fallback === 'solo' || opts.fallback === 'spectate' ? opts.fallback : 'wait';
  const seatWaitMs = Math.max(1000, Math.min(30_000, Number(opts.seatWaitMs) || 4000));
  /** A private round with bots while the room has no body for this page: `hosting` is true, and nothing is sent. */
  let solo = false;
  let standing: Standing = { state: 'joining', why: 'connecting', line: null };
  /** How long this page, in the room, has been without a body, counted only while it could listen (0: it has one). */
  let noBodyMs = 0;
  let lastCheckAt = 0;
  /** The seat this browser held in its room (and in a private round), for the moment the helper gives the room up. */
  let lastSeat: number | null = null;
  let soloSeat = 0;
  let saidLine: string | null = null;
  /** The host reset this seat and the snapshot that said so had no body for it yet: adopt when one does. */
  let adoptDue = false;

  const net = createNetplay<RoomSnap<F>, unknown[], RoomCkpt<B, S>>({
    game: opts.game, maxPlayers: max, movement: opts.movement ?? 'owner',
    snapshotHz: 20, inputHz: 20, checkpointMs: 1000,
    checkpoint: () => ({ round, roster: roster.toJSON(), bodies: [...bodies.values()].map((b) => ({ ...b })), world: opts.saveWorld ? opts.saveWorld() : null, tick, spawns: [...spawned].filter(([slot]) => bodies.has(slot)), occ: roster.occupants() }),
    ...(opts.netplay ?? {}),
    // createRoom claims an AI's slot for it (its join passes `p.agent`), so its host can move an AI's body.
    caps: [...new Set([...(opts.netplay?.caps ?? []), 'agents' as const])],
  });

  // Offline, and in a private round of a full room (no seat at all), this browser is seat 0 of its own round.
  const mySeat = (): number | null => (net.offline ? 0 : solo && net.seat === null ? 0 : net.seat);
  const bodyOfSeat = (seat: number | null): B | null => {
    if (seat === null) return null;
    for (const b of bodies.values()) if (!b.bot && b.seat === seat) return b;
    return null;
  };

  /** The lowest spawn index no body in the room holds. */
  function freeIndex(): number {
    const held = new Set<number>();
    for (const slot of bodies.keys()) { const i = spawned.get(slot); if (i !== undefined) held.add(i); }
    let i = 0;
    while (held.has(i)) i += 1;
    return i;
  }

  function syncBodies(): void {
    const seen = new Set<number>();
    for (const s of roster.slots) {
      seen.add(s.slot);
      const b = bodies.get(s.slot);
      if (!b) {
        // Mid-round (a joiner, a guide's seat): never an index another body holds, so never another body's spot.
        const i = freeIndex();
        const nb = opts.spawn(s, i); nb.slot = s.slot; nb.seat = s.seat; nb.name = s.name; nb.bot = s.bot; nb.score = nb.score ?? 0; if (s.agent) nb.agent = { ...s.agent };
        bodies.set(s.slot, nb); spawned.set(s.slot, i);
        continue;
      }
      b.seat = s.seat; b.name = s.name; b.bot = s.bot;
      if (s.agent) b.agent = { ...s.agent }; else delete b.agent;
    }
    for (const k of [...bodies.keys()]) if (!seen.has(k)) { bodies.delete(k); spawned.delete(k); }
  }

  function moved(b: B): void {
    if (b.bot || b.seat === null) return;
    if (b.seat === mySeat()) { opts.adopt?.(b); return; }
    if (!solo) net.reset(b.seat);
  }

  const packRow = (b: B): number[] => [b.slot, b.seat ?? -1, b.score, ...opts.pack(b)];
  function buildSnap(): RoomSnap<F> {
    const r = round ?? { n: 0, phase: 'live', startedAt: 0, endsAt: 0 };
    const snap: RoomSnap<F> = { r: [r.n, r.phase === 'over' ? 1 : 0, r.startedAt, r.endsAt], b: [...bodies.values()].map(packRow) };
    if (opts.fastWorld) snap.w = opts.fastWorld();
    return snap;
  }

  /**
   * Everybody who holds a seat and has no body is seated now (section 28). A join is claimed once, when it happens;
   * a claim that found no body free was never tried again, so that player watched for the rest of the visit, online
   * and with nothing said. Tried again whenever a body frees up, and at every round start.
   */
  function seatEveryone(quiet = false): boolean {
    if (!hosting || solo || net.offline) return false;
    let any = false;
    for (const p of net.peers.values()) {
      if (p.seat === null || p.seat === mySeat() || roster.bySeat(p.seat)) continue;
      const c = roster.claim(p.seat, p.name, p.agent ? { role: p.agent.role, hands: p.agent.hands } : null, p.occ ?? null);
      if (!c) continue;
      any = true;
      syncBodies();
      const b = bodies.get(c.slot.slot);
      if (!b) continue;
      if (c.yielded || c.added) takeover(b, { why: 'join', own: false, back: c.back });
      if (!quiet) moved(b);
    }
    return any;
  }

  function startRound(n: number, rollover = false): void {
    const now = net.now();
    roster.trim();
    // The next round of a running room seats whoever is still waiting for a body, before the bodies are dealt: the
    // trim above is what makes room for them (the seats a server no longer keeps for AI go at the round, not before).
    if (rollover) seatEveryone(true);
    syncBodies();
    let i = 0;
    spawned = new Map();
    for (const s of [...roster.slots].sort((a, c) => a.slot - c.slot)) {
      spawned.set(s.slot, i);
      const fresh = opts.spawn(s, i++);
      fresh.slot = s.slot; fresh.seat = s.seat; fresh.name = s.name; fresh.bot = s.bot; fresh.score = 0;
      if (s.agent) fresh.agent = { ...s.agent };
      bodies.set(s.slot, fresh);
    }
    round = { n, phase: 'live', startedAt: now, endsAt: now + roundMs };
    opts.onRoundStart?.(n);
    for (const b of bodies.values()) moved(b);
    // A private round (solo) is this browser's alone: the room's round, roster and snapshots are its host's to say.
    if (solo) return;
    net.round(round);
    net.roster(roster.toJSON());
    net.snapshot(buildSnap(), tick, true);
  }

  function rank(): RoundResult[] {
    // The order of the rows is fixed: score, then people before bots, then the lower slot. What place two equal
    // scores get is the game's to say (`ties`): by default the order itself, as results always were.
    const ranked = [...bodies.values()].sort((a, b) => b.score - a.score || Number(a.bot) - Number(b.bot) || a.slot - b.slot);
    const places = placesOf(ranked.map((b) => b.score), opts.ties ?? 'order');
    return ranked.map((b, i) => ({ slot: b.slot, seat: b.seat, name: b.name, score: b.score, bot: b.bot, place: places[i] as number, ...(b.agent ? { agent: true as const } : {}) }));
  }

  /** A body changed hands: the game's word on it (default: the newcomer starts from 0). */
  function takeover(b: B, info: TakeoverInfo): void {
    if (opts.onTakeover) opts.onTakeover(b, info); else b.score = 0;
  }

  function endRound(): void {
    if (!round) return;
    const now = net.now();
    const results = rank();
    round = { n: round.n, phase: 'over', startedAt: now, endsAt: now + breakMs, results };
    opts.onRoundEnd?.(results);
    if (!solo) net.round(round);
  }

  function restore(e: RoleChange<RoomSnap<F>, RoomCkpt<B, S>>): void {
    const ck = e.ckpt?.d ?? null;
    if (ck) {
      bodies = new Map(ck.bodies.map((b) => [b.slot, { ...b }]));
      roster = Roster.from(ck.roster, rosterOpts(), ck.occ ?? null);
      // A checkpoint from before spawns were kept: the round start's order (slot order) is the best guess.
      spawned = new Map(ck.spawns ?? [...bodies.keys()].sort((a, c) => a - c).map((slot, i) => [slot, i]));
      round = ck.round;
      tick = ck.tick;
    } else {
      roster = Roster.from(e.roster ?? [], rosterOpts());
      bodies = new Map();
      spawned = new Map();
      syncBodies();
    }
    // The snapshot is newer than the checkpoint (20 Hz vs 1 Hz): positions and scores from it.
    const s = e.snap;
    if (s && (!e.ckpt || s.st >= e.ckpt.st)) {
      for (const row of s.d.b) {
        const [slot, seat, score] = row as [number, number, number];
        let b = bodies.get(slot);
        if (!b) {
          const sl = roster.slots.find((r) => r.slot === slot) ?? { slot, seat: seat >= 0 ? seat : null, name: seat >= 0 ? `Player ${seat + 1}` : botName(slot), bot: seat < 0 };
          const i = freeIndex();
          b = opts.spawn(sl, i); b.slot = slot; b.seat = sl.seat; b.name = sl.name; b.bot = sl.bot;
          bodies.set(slot, b); spawned.set(slot, i);
        }
        b.score = score;
        opts.unpack(row.slice(3), b);
      }
      const [n, ph, startedAt, endsAt] = s.d.r;
      if (!round || n >= round.n) round = { n, phase: ph ? 'over' : 'live', startedAt, endsAt, ...(round?.n === n && round.results ? { results: round.results } : {}) };
      tick = Math.max(tick, s.k);
    }
    // A round the relay kept is at least as new as the checkpoint's.
    if (e.round && (!round || e.round.n > round.n || (e.round.n === round.n && e.round.phase === 'over' && round.phase === 'live'))) round = e.round;
    opts.loadWorld?.(ck?.world ?? null, s?.d.w);
    if (!round) { startRound(1); return; }
    net.round(round);
  }

  function becomeHost(e: RoleChange<RoomSnap<F>, RoomCkpt<B, S>>): void {
    // A browser that was in the room a moment ago (a replica being promoted) sees its own body somewhere real; one
    // that just arrived (its first role) does not: what it shows locally is a place it has never been.
    const arriving = e.prev === null;
    // It was playing a private round: what it shows locally is that round's place, not one in the room.
    const wasSolo = solo;
    solo = false;
    // THE ROOM DID NOT COME BACK (section 22): this browser was the room's host, cut off for `reconnectMaxMs`, and
    // plays alone from here. It keeps the round it was running: its own body is seat 0 of a round of its own now,
    // and everybody else's goes to a bot, exactly as if they had left.
    // The same for a private round the page was already playing when its link went: that round goes on.
    if (net.offline && hosting && round && (wasSolo || (e.why === 'reconnect-timeout' && e.prev === 'host'))) {
      const was = wasSolo ? soloSeat : lastSeat;
      const mineWas = was === null ? undefined : roster.slots.find((s) => !s.bot && !s.agent && s.seat === was);
      for (const s of roster.humans()) if (s.seat !== null && s !== mineWas) roster.release(s.seat);
      if (mineWas) { mineWas.seat = 0; mineWas.name = 'You'; } else roster.claim(0, 'You');
      syncBodies();
      net.roster(roster.toJSON());
      return;
    }
    // My own body was mine a moment ago: keep it exactly where I see it.
    const before = !hosting && !wasSolo && mySeat() !== null && opts.local && !(e.promoted && arriving) ? opts.local() : null;
    hosting = true;
    if (e.promoted) restore(e);
    else {
      roster = new Roster(rosterOpts());
      bodies = new Map();
      spawned = new Map();
      const seat = mySeat();
      if (seat !== null) roster.claim(seat, net.offline ? 'You' : net.name, null, net.offline ? null : myOcc());
      syncBodies();
      startRound((e.round?.n ?? 0) + 1);
    }
    const peers = net.offline ? [{ seat: 0, name: 'You' }] : [...net.peers.values()].filter((p) => p.seat !== null).map((p) => ({ seat: p.seat, name: p.name, agent: p.agent ?? null, occ: p.occ ?? null }));
    // THE RESTORED ROOM (section 25). Everyone left, the relay kept the checkpoint, and this browser arrives before it
    // is forgotten: it is the host of a round whose roster still names the players who left. The reconcile below hands
    // their bodies back to bots and claims one for everybody who is here now, through the same claim (and the game's
    // `admit`) as a fresh join. A seat NUMBER can be the same as a departed player's: the relay's `occ` says whose stay
    // it is; with a relay that does not, this browser at least knows its own (its welcome did not give it back a seat
    // its token named), and gives up the body it would otherwise have inherited without a word.
    const me = mySeat();
    if (e.promoted && arriving && !net.offline && me !== null && !net.resumed && roster.bySeat(me) && typeof myOcc() !== 'number') roster.vacate(me);
    const { claimed, back } = roster.reconcile(peers);
    syncBodies();
    for (const s of claimed) {
      const b = bodies.get(s.slot);
      if (!b) continue;
      const own = !b.bot && b.seat === mySeat();
      // A claim made as a round comes back is a takeover like any other: the same callback, and it says which.
      if (e.promoted) takeover(b, { why: arriving ? 'restore' : 'migrate', own, back: back.includes(s) });
      if (!own) moved(b);
    }
    const mine = bodyOfSeat(mySeat());
    if (mine && before) opts.unpack(opts.pack(before), mine);
    // A browser that arrived as the host of a restored round stands where its body stands (its own old one, or the
    // one it just took over): without this the game's local pose and the host's body disagreed until the next round.
    // The same for one that came out of a private round to host the room's.
    else if (mine && e.promoted && (arriving || wasSolo)) opts.adopt?.(mine);
    net.roster(roster.toJSON());
  }

  /** Which stay in its seat this browser's is (`peer.occ`), when the relay says. */
  function myOcc(): number | null {
    for (const p of net.peers.values()) if (p.id === net.id) return typeof p.occ === 'number' ? p.occ : null;
    return null;
  }

  net.on('role', (e) => {
    if (e.role === 'host') becomeHost(e);
    // A private round goes on while the room's own roles change around it.
    else if (!solo) hosting = false;
    check();
  });
  net.on('join', (p) => {
    if (!hosting || solo || p.seat === null) return;
    // An AI takes a seat kept for AI (its hands say who moves the body); a person never does (section 17).
    const c = roster.claim(p.seat, p.name, p.agent ? { role: p.agent.role, hands: p.agent.hands } : null, p.occ ?? null);
    if (!c) return; // full: they watch
    syncBodies();
    const b = bodies.get(c.slot.slot);
    if (b) {
      // A player whose body never left them (this host only missed that their socket changed) takes nothing over:
      // resetting their score here cost a returning player their round.
      if (c.yielded || c.added) takeover(b, { why: 'join', own: false, back: c.back });
      moved(b);
    }
    net.roster(roster.toJSON());
    net.snapshot(buildSnap(), tick, true);
  });
  net.on('leave', (p) => {
    if (!hosting || solo || p.seat === null) return;
    roster.release(p.seat); // the body stays, a bot drives it now
    syncBodies();
    // A body just went to a bot: somebody who was seated with none takes it now, not at the next round.
    const seated = seatEveryone();
    net.roster(roster.toJSON());
    if (seated) net.snapshot(buildSnap(), tick, true);
  });
  // The server's policy changed (a new server stamp, the owner): its AI seats come or go at once, filler at the round.
  net.on('policy', () => {
    if (!hosting || solo) return;
    roster.fill();
    syncBodies();
    seatEveryone();
    net.roster(roster.toJSON());
  });
  /** This seat's row in a snapshot of the room (the newest one, unless given): the body the room has for this page. */
  function roomRow(snap?: Snapshot<RoomSnap<F>> | null): number[] | null {
    if (net.seat === null) return null;
    const s = snap === undefined ? net.latest() : snap;
    return s?.d?.b?.find((r) => r[1] === net.seat) ?? null;
  }
  function adoptRow(row: number[]): void {
    adoptDue = false;
    if (!opts.adopt) return;
    const b = { slot: row[0], seat: row[1], score: row[2], name: net.name, bot: false } as unknown as B;
    opts.unpack(row.slice(3), b);
    opts.adopt(b);
  }
  net.on('control', (e) => {
    if (!e.reset) return;
    // In a private round the room's reset waits: this browser adopts its body when it moves in.
    const row = solo ? null : roomRow(e.snap as Snapshot<RoomSnap<F>> | null);
    // A reset whose snapshot has no body for this seat yet (the host knew the seat before it had a body for it) used
    // to be spent on nothing: the body that came later was never adopted. It is owed until a snapshot shows one.
    if (!row) { adoptDue = true; return; }
    adoptRow(row);
  });

  /* ------------------------------------------------------------ seat or solo (section 28) */
  function enterSolo(): void {
    solo = true;
    hosting = true;
    soloSeat = mySeat() as number;
    roster = new Roster(rosterOpts());
    bodies = new Map();
    spawned = new Map();
    roster.claim(mySeat() as number, net.name || 'You', null, null);
    syncBodies();
    // The room's own round number, so the HUD does not jump back to 1; the clock is this browser's.
    startRound(Math.max(1, net.roundInfo?.n ?? 1));
  }
  /** The room has a body for this page (or its link changed): the private round ends and it stands in the room. */
  function leaveSolo(): void {
    solo = false;
    hosting = false;
    bodies = new Map();
    spawned = new Map();
    round = null;
    const row = roomRow();
    if (row) adoptRow(row);
  }
  const SAYS: Record<string, string> = {
    joining: 'Joining the round…',
    'wait:no-body': 'Waiting for a place in this round…',
    'solo:no-body': 'Playing on your own until the next round',
    'solo:full': 'This room is full · playing on your own until a seat is free',
    'spectate:no-body': 'Watching until the next round',
  };
  function stand(state: Standing['state'], why: string, line: string | null): void {
    // The line over the game is the room's only while it has something to say: a game's own `net.line` is left alone.
    if (line !== saidLine) { saidLine = line; net.line(line); }
    if (standing.state === state && standing.why === why && standing.line === line) return;
    standing = { state, why, line };
    try { opts.onStanding?.(standing); } catch (err) { console.warn('[room] onStanding()', err); }
  }
  /** Where this player stands, worked out again: on every role and link change, and four times a second. */
  function check(): void {
    const link = net.link;
    const t = Date.now();
    // Only time this page could listen counts (as for the welcome): after a frame that blocked for seconds, this
    // timer runs before the snapshots queued behind it, and a body that is already on its way is not "missing".
    const heard = lastCheckAt ? Math.max(0, Math.min(t - lastCheckAt, 300)) : 0;
    lastCheckAt = t;
    if (!net.offline && net.seat !== null) lastSeat = net.seat;
    // Stopped for good. A page that plays a round of its own meanwhile (a private one, or the helper's own fallback
    // for a room that refused it) is still playing: the helper's line says why it is not in the room.
    if (link === 'closed') { noBodyMs = 0; stand(solo || (net.offline && hosting) ? 'solo' : 'closed', net.closedWhy ?? 'closed', solo ? saidLine : null); return; }
    // Playing alone (no room, or it never answered, or it did not come back): the helper's own line says which.
    if (net.offline) { noBodyMs = 0; stand('solo', link === 'offline' ? 'offline' : 'alone', null); return; }
    if (link === 'connecting') { noBodyMs = 0; stand('joining', 'connecting', null); return; }
    // A watcher, or a screen that never asked for a seat: watching is what it came for.
    if (net.watching || (net.seat === null && !net.full && !solo)) { noBodyMs = 0; stand('watching', 'screen', null); return; }
    const row = hosting && !solo ? null : roomRow();
    const has = hosting && !solo ? Boolean(bodyOfSeat(mySeat())) : Boolean(row);
    if (has && link === 'online') {
      if (solo) leaveSolo();
      else if (adoptDue && row) adoptRow(row);
      noBodyMs = 0;
      stand('playing', 'seated', null);
      return;
    }
    const why = net.full ? 'full' : 'no-body';
    if (solo) { stand('solo', why, SAYS[`solo:${why}`] as string); return; }
    // Cut off for a moment: still its player (the helper says "Reconnecting…", for a bounded time).
    if (link === 'reconnecting') { stand(has ? 'playing' : 'joining', 'reconnecting', null); return; }
    noBodyMs += heard;
    if (noBodyMs < seatWaitMs) { stand('joining', why, !net.full && noBodyMs >= 700 ? SAYS['joining'] as string : null); return; }
    // BOUNDED: past seatWaitMs the page is told where it stands and, when the game asked, given something to do.
    if (fallback === 'solo' && !hosting) { enterSolo(); stand('solo', why, SAYS[`solo:${why}`] as string); return; }
    if (fallback === 'spectate') { stand('watching', why, net.full ? null : SAYS['spectate:no-body'] as string); return; }
    stand('waiting', why, net.full ? null : SAYS['wait:no-body'] as string);
  }
  const checkTimer = setInterval(check, 250);
  // A room nobody closed must not keep a test or a tool alive.
  (checkTimer as unknown as { unref?: () => void }).unref?.();
  net.on('link', (e) => { check(); if (e.state === 'closed') clearInterval(checkTimer); });

  function interpolated(): B[] {
    const smp = net.sample();
    if (!smp) return [];
    const bySlot = new Map<number, number[]>(smp.a.d.b.map((r) => [r[0] as number, r]));
    const names = new Map<number, Slot>((net.slots ?? []).map((s) => [s.slot, s]));
    const out: B[] = [];
    for (const rb of smp.b.d.b) {
      const ra = bySlot.get(rb[0] as number) ?? rb;
      const fields: number[] = [];
      for (let i = 3; i < rb.length; i++) {
        const a = ra[i] as number; const b = rb[i] as number; const k = i - 3;
        fields.push(discrete.has(k) || !Number.isFinite(a) ? b : angles.has(k) ? lerpAngle(a, b, smp.alpha) : lerp(a, b, smp.alpha));
      }
      const slot = rb[0] as number; const seat = rb[1] as number; const sl = names.get(slot);
      const body = { slot, seat: seat >= 0 ? seat : null, score: rb[2] as number, bot: seat < 0, name: sl?.name ?? (seat >= 0 ? `Player ${seat + 1}` : botName(slot)) } as unknown as B;
      opts.unpack(fields, body);
      out.push(body);
    }
    return out;
  }

  const room: Room<B, F, S> = {
    net,
    get hosting() { return hosting; },
    get solo() { return solo; },
    get standing() { return standing; },
    get bodies() { return bodies; },
    get round() { return hosting ? round : (net.roundInfo ?? round); },
    mySeat,
    viewSeat: () => (net.offline || solo ? mySeat() : net.viewSeat),
    viewBody() {
      const s = net.offline || solo ? mySeat() : net.viewSeat;
      const all = room.view();
      if (s !== null) for (const b of all) if (!b.bot && b.seat === s) return b;
      // `fallback: 'spectate'`: no body of its own yet, so the camera follows the room (a person first, else anybody).
      if (standing.state === 'watching' && standing.why !== 'screen') return all.find((b) => !b.bot) ?? all[0] ?? null;
      return null;
    },
    skillOf: (body) => net.skillOf(body.slot),
    mine: () => (hosting ? bodyOfSeat(mySeat()) : null),
    update() {
      if (!hosting) return;
      tick += 1;
      const now = net.now();
      if (round && round.phase === 'live' && now >= round.endsAt) endRound();
      else if (round && round.phase === 'over' && now >= round.endsAt) startRound(round.n + 1, true);
      if (!solo && net.snapshotDue()) net.snapshot(buildSnap(), tick);
    },
    avatar: (b) => (b.bot || b.seat === null ? null : (net.avatar(b.seat) as unknown[] | null)),
    bound(b, claim, maxSpeed, dt) {
      if (b.seat === null) return false;
      const m = capMove(b, claim, maxSpeed * 1.3 * dt + maxSpeed * 0.02);
      if (m.over > maxSpeed * 0.5) { net.reset(b.seat); return false; }
      b.x = m.x; b.y = m.y; if (m.z !== undefined) b.z = m.z;
      return true;
    },
    moved,
    presses: (b) => (b.seat === null || b.bot ? {} : net.takePresses(b.seat)),
    input: (frame, held) => { if (!hosting && net.seat !== null) net.input(frame, held ? [...held] : []); },
    press: (id) => { if (!hosting) net.press(id); },
    view: () => (hosting ? [...bodies.values()] : interpolated()),
    fast: () => (hosting ? opts.fastWorld?.() : net.latest()?.d.w),
    clock() {
      const r = room.round;
      if (!r) return { n: 0, phase: 'none', secondsLeft: 0 };
      return { n: r.n, phase: r.phase, secondsLeft: Math.max(0, Math.ceil((r.endsAt - net.now()) / 1000)) };
    },
    results: () => (hosting ? rank() : (room.round?.results ?? [])),
    // A private round's effects are this browser's own: they are not sent into a room it is not playing in.
    send: (kind, data) => { if (!solo) net.send(kind, data); },
    on: net.on.bind(net) as Room<B, F, S>['on'],
  };
  return room;
}
