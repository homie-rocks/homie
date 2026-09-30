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
 * What stays the game's: the rules (what a body does per frame), the bots'
 * brains, the drawing, and the camera. See the port skill's recipe.
 */
import {
  capMove, createNetplay, lerp, lerpAngle, Roster,
  type Movement, type Netplay, type NetplayOptions, type RoleChange, type RoundInfo, type RoundResult, type Slot, type Snapshot,
} from '../netplay/netplay';

export interface BodyBase { slot: number; seat: number | null; name: string; bot: boolean; score: number }

export interface RoomSnap<F = unknown> { r: [n: number, phase: number, startedAt: number, endsAt: number]; b: number[][]; w?: F }
export interface RoomCkpt<B, S> { round: RoundInfo | null; roster: Slot[]; bodies: B[]; world: S | null; tick: number }

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
  /** A fresh body for a slot. `index` counts bodies at a round start (spread the spawns with it). */
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
  /** Host: a person took over `body` (it was a bot). Default: keep where it stands, score 0. */
  onTakeover?: (body: B) => void;
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
  /** Extra netplay options (snapshotHz, inputHz, config for tests). */
  netplay?: Partial<NetplayOptions<RoomCkpt<B, S>>>;
}

export interface Room<B extends BodyBase, F = unknown, S = unknown> {
  readonly net: Netplay<RoomSnap<F>, unknown[], RoomCkpt<B, S>>;
  /** True while this browser runs the rules. */
  readonly hosting: boolean;
  /** Host: every body by slot. */
  readonly bodies: Map<number, B>;
  /** The live round (host: authoritative; others: the relay's copy). */
  readonly round: RoundInfo | null;
  /** My seat (0 when offline: a solo game with bots, the way a plain file or a dev server plays). */
  mySeat(): number | null;
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
  /** Rank bodies by score (ties: people first). */
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

  let roster = new Roster({ min, max, botName });
  let bodies = new Map<number, B>();
  let round: RoundInfo | null = null;
  let hosting = false;
  let tick = 0;

  const net = createNetplay<RoomSnap<F>, unknown[], RoomCkpt<B, S>>({
    game: opts.game, maxPlayers: max, movement: opts.movement ?? 'owner',
    snapshotHz: 20, inputHz: 20, checkpointMs: 1000,
    checkpoint: () => ({ round, roster: roster.toJSON(), bodies: [...bodies.values()].map((b) => ({ ...b })), world: opts.saveWorld ? opts.saveWorld() : null, tick }),
    ...(opts.netplay ?? {}),
  });

  const mySeat = (): number | null => (net.offline ? 0 : net.seat);
  const bodyOfSeat = (seat: number | null): B | null => {
    if (seat === null) return null;
    for (const b of bodies.values()) if (!b.bot && b.seat === seat) return b;
    return null;
  };

  function syncBodies(atIndex = 0): void {
    const seen = new Set<number>();
    let i = atIndex;
    for (const s of roster.slots) {
      seen.add(s.slot);
      const b = bodies.get(s.slot);
      if (!b) { const nb = opts.spawn(s, i++); nb.slot = s.slot; nb.seat = s.seat; nb.name = s.name; nb.bot = s.bot; nb.score = nb.score ?? 0; bodies.set(s.slot, nb); continue; }
      b.seat = s.seat; b.name = s.name; b.bot = s.bot;
    }
    for (const k of [...bodies.keys()]) if (!seen.has(k)) bodies.delete(k);
  }

  function moved(b: B): void {
    if (b.bot || b.seat === null) return;
    if (b.seat === mySeat()) { opts.adopt?.(b); return; }
    net.reset(b.seat);
  }

  const packRow = (b: B): number[] => [b.slot, b.seat ?? -1, b.score, ...opts.pack(b)];
  function buildSnap(): RoomSnap<F> {
    const r = round ?? { n: 0, phase: 'live', startedAt: 0, endsAt: 0 };
    const snap: RoomSnap<F> = { r: [r.n, r.phase === 'over' ? 1 : 0, r.startedAt, r.endsAt], b: [...bodies.values()].map(packRow) };
    if (opts.fastWorld) snap.w = opts.fastWorld();
    return snap;
  }

  function startRound(n: number): void {
    const now = net.now();
    roster.trim();
    syncBodies();
    let i = 0;
    for (const s of [...roster.slots].sort((a, c) => a.slot - c.slot)) {
      const fresh = opts.spawn(s, i++);
      fresh.slot = s.slot; fresh.seat = s.seat; fresh.name = s.name; fresh.bot = s.bot; fresh.score = 0;
      bodies.set(s.slot, fresh);
    }
    round = { n, phase: 'live', startedAt: now, endsAt: now + roundMs };
    opts.onRoundStart?.(n);
    for (const b of bodies.values()) moved(b);
    net.round(round);
    net.roster(roster.toJSON());
    net.snapshot(buildSnap(), tick, true);
  }

  function rank(): RoundResult[] {
    const ranked = [...bodies.values()].sort((a, b) => b.score - a.score || Number(a.bot) - Number(b.bot) || a.slot - b.slot);
    return ranked.map((b, i) => ({ slot: b.slot, seat: b.seat, name: b.name, score: b.score, bot: b.bot, place: i + 1 }));
  }

  function endRound(): void {
    if (!round) return;
    const now = net.now();
    const results = rank();
    round = { n: round.n, phase: 'over', startedAt: now, endsAt: now + breakMs, results };
    opts.onRoundEnd?.(results);
    net.round(round);
  }

  function restore(e: RoleChange<RoomSnap<F>, RoomCkpt<B, S>>): void {
    const ck = e.ckpt?.d ?? null;
    if (ck) {
      roster = Roster.from(ck.roster, { min, max, botName });
      bodies = new Map(ck.bodies.map((b) => [b.slot, { ...b }]));
      round = ck.round;
      tick = ck.tick;
    } else {
      roster = Roster.from(e.roster ?? [], { min, max, botName });
      bodies = new Map();
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
          b = opts.spawn(sl, slot); b.slot = slot; b.seat = sl.seat; b.name = sl.name; b.bot = sl.bot;
          bodies.set(slot, b);
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
    // My own body was mine a moment ago: keep it exactly where I see it.
    const before = !hosting && mySeat() !== null && opts.local ? opts.local() : null;
    hosting = true;
    if (e.promoted) restore(e);
    else {
      roster = new Roster({ min, max, botName });
      bodies = new Map();
      const seat = mySeat();
      if (seat !== null) roster.claim(seat, net.offline ? 'You' : net.name);
      syncBodies();
      startRound((e.round?.n ?? 0) + 1);
    }
    const peers = net.offline ? [{ seat: 0, name: 'You' }] : [...net.peers.values()].filter((p) => p.seat !== null);
    const { claimed } = roster.reconcile(peers);
    syncBodies();
    for (const s of claimed) { const b = bodies.get(s.slot); if (b && b.seat !== mySeat()) moved(b); }
    const mine = bodyOfSeat(mySeat());
    if (mine && before) opts.unpack(opts.pack(before), mine);
    net.roster(roster.toJSON());
  }

  net.on('role', (e) => {
    if (e.role === 'host') becomeHost(e);
    else hosting = false;
  });
  net.on('join', (p) => {
    if (!hosting || p.seat === null) return;
    const c = roster.claim(p.seat, p.name);
    if (!c) return; // full: they watch
    syncBodies();
    const b = bodies.get(c.slot.slot);
    if (b) {
      if (opts.onTakeover) opts.onTakeover(b); else b.score = 0;
      moved(b);
    }
    net.roster(roster.toJSON());
    net.snapshot(buildSnap(), tick, true);
  });
  net.on('leave', (p) => {
    if (!hosting || p.seat === null) return;
    roster.release(p.seat); // the body stays, a bot drives it now
    syncBodies();
    net.roster(roster.toJSON());
  });
  net.on('control', (e) => {
    if (!e.reset || !opts.adopt) return;
    const snap = e.snap as Snapshot<RoomSnap<F>> | null;
    const row = snap?.d?.b?.find((r) => r[1] === net.seat);
    if (!row) return;
    const b = { slot: row[0], seat: row[1], score: row[2], name: net.name, bot: false } as unknown as B;
    opts.unpack(row.slice(3), b);
    opts.adopt(b);
  });

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
    get bodies() { return bodies; },
    get round() { return hosting ? round : (net.roundInfo ?? round); },
    mySeat,
    mine: () => (hosting ? bodyOfSeat(mySeat()) : null),
    update() {
      if (!hosting) return;
      tick += 1;
      const now = net.now();
      if (round && round.phase === 'live' && now >= round.endsAt) endRound();
      else if (round && round.phase === 'over' && now >= round.endsAt) startRound(round.n + 1);
      if (net.snapshotDue()) net.snapshot(buildSnap(), tick);
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
    send: (kind, data) => net.send(kind, data),
    on: net.on.bind(net) as Room<B, F, S>['on'],
  };
  return room;
}
