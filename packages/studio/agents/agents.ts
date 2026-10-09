/*
 * @homie-rocks/studio/agents — AI guides in a game (NETPLAY.md section 18, contract revision 7).
 * =============================================================================
 *
 * A beginner server keeps some seats in every room for AI guides (section 17). Their HANDS are the game's own bot
 * code, every frame, at the dial the party agreed. Their BRAIN picks a goal every few seconds and, when the server's
 * AI may talk, a line to say: only goals and lines from the game's own `agents.json` (its vocabulary), never free
 * text. The brain runs in the room's Table on the studio's Worker (Workers AI, or the owner's key), in the owner's
 * Claude through the local MCP (`agent_sit`), or (no AI at all, over budget, between decisions) in the host as the
 * game's own scripted `decide`. This file is the host's side of it, and every browser's side of the asks and lines:
 *
 *   const agents = useAgents(room.net, vocab, {
 *     view: (slot) => ({ ... }),     // host: what a guide sees, game state only, under 2 KB, at most every 2 s
 *     decide: (view) => ({ ... }),   // the scripted floor: synchronous, never waits
 *   });
 *   agents.goalOf(slot)              // hands, every host frame: the goal in force (null: the game's own bot code)
 *   agents.done(slot, ok)            // host: that goal finished (or failed): the brain thinks again
 *   agents.ask(slot, 'ask_help', { quest: 'king-slime' })   // a person's button: "Help me with King Slime"
 *   agents.on('say', ({ slot, text }) => bubble(slot, text)) // draw a guide's line; the text is the game's own
 *
 * Fixed rules, outside any model: a guide says at most one line every 8 s; after "no thanks" (an ask with `leave`)
 * it leaves that player alone for 10 minutes; a goal aimed at a player is never in a vocabulary; Quiet AI
 * (`net.hushed`) hides every AI line on this browser; the relay checks every frame again (an AI's line must be a
 * vocabulary line with arguments that fit, on a server whose AI may talk).
 * =============================================================================
 */
import { aiName, stripAi, type Netplay, type NetEvent, type Policy, type Slot } from '../netplay/netplay.ts';

/* ------------------------------------------------------------------ the vocabulary (agents.json) */

/** An argument's type: a seat in the room, a list of values, or a value the guide's latest view offers. */
export type ArgType = 'player' | readonly string[] | `view.${string}`;
export interface GoalDef { about: string; args?: Record<string, ArgType> }
export interface LineDef { text: string; args?: Record<string, ArgType> }
/** A person's ask: a button the game draws. `goal`/`say`: how the scripted floor answers it; `leave`: "no thanks". */
export interface AskDef { text: string; args?: Record<string, ArgType>; goal?: string; say?: string; leave?: boolean }
export interface Vocabulary {
  v: 1;
  persona?: string;
  /** The guides' names (" · AI" is added). */
  names?: string[];
  /** How a value reads aloud ("king-slime": "King Slime"); else its dashes become spaces. */
  labels?: Record<string, string>;
  goals: Record<string, GoalDef>;
  lines?: Record<string, LineDef>;
  asks?: Record<string, AskDef>;
}
/** What a brain (or the floor) chose: a goal of the vocabulary, and at most one of its lines. */
export interface Decision { goal?: string | null; args?: Record<string, unknown>; say?: string | null; sayArgs?: Record<string, unknown> }
export type GoalState = 'active' | 'done' | 'failed';
/** `asked`: this goal answered a person's ask; it is carried through until done (or 60 s), whatever a brain says. */
export interface Goal { goal: string; args: Record<string, unknown>; from: 'brain' | 'floor'; at: number; state: GoalState; asked?: boolean }
export interface Ask { k: string; args: Record<string, unknown>; from: number; at: number }
export interface SayEvent { slot: number; seat: number | null; line: string; args: Record<string, unknown>; text: string }
export interface GoalEvent { slot: number; goal: Goal; prev: Goal | null; askAt: number | null }
export interface AskButton { k: string; args: Record<string, unknown>; text: string }

export interface AgentsOptions {
  /** Runtime integration: a room clock and an explicit beat replace the browser timer. */
  now?: () => number;
  manual?: boolean;
  /** A rules view is always a client; the separate runtime owns guides. */
  viewOnly?: boolean;
  /** Keep an asked-for goal through scripted floor decisions until completion or sixty seconds. */
  carryFloor?: boolean;
  restore?: AgentsSaved;

  /** Host: what a guide in this slot sees. Game state only: never an account, an address or typed text. Under 2 KB. */
  view: (slot: number) => Record<string, unknown>;
  /** The scripted floor: runs with no AI, over budget, and between AI decisions. Synchronous; never waits. */
  decide?: (view: Record<string, unknown>, ctx: { slot: number; goal: Goal | null; asks: Ask[] }) => Decision | null;
  /** Which AI slots this game gives a brain (default: guides). */
  roles?: ('guide' | 'party')[];
  /** How long an AI's decision holds before the floor may decide again (default 45 s: an AI in a seat on the owner's computer decides about every 30 s). */
  holdMs?: number;
  /** How long an ask waits for an AI's answer before the floor answers it (default 4 s). */
  askWaitMs?: number;
}

export interface AgentsStats { views: number; dos: number; says: number; asks: number; drops: number; floors: number; viewBytes: number }

export interface AgentsSaved { goals: [number, Goal][]; asks: [number, Ask[]][]; avoid: [number, [number, number][]][]; sayAt: [number, number][]; viewAt: [number, number][]; floorAt: [number, number][]; askAt: [number, number][] }
export interface Agents {
  tick(): void;
  save(): AgentsSaved;
  forget(slot: number): void;
  /** Drop one slot's goal so its floor may run at once. Its pacing, its asks and who asked to be left alone all stay. */
  dropGoal(slot: number): void;

  readonly vocab: Vocabulary;
  /** Whether this server's AI may talk (its brain is workers-ai or owner-key, and speech is not off). */
  readonly talking: boolean;
  /** The AI slots that get a brain (a seat kept for a guide, or a guide's). */
  guides(): Slot[];
  /** The goal in force for a slot, or null (the game's own bot code drives). */
  goalOf(slot: number): Goal | null;
  /** Host: the asks made of this guide in the last 30 s, newest first. */
  asksFor(slot: number): Ask[];
  /** A person asks a guide (a button): false when not sent. */
  ask(slot: number, k: string, args?: Record<string, unknown>): boolean;
  /** The buttons to draw for a guide: each ask, one per value its argument may take (`offer`: what this browser knows). */
  askButtons(slot: number, offer?: Record<string, unknown>): AskButton[];
  /** Host: the goal in force finished (or failed). The brain thinks again; the floor decides at once. */
  done(slot: number, ok?: boolean): void;
  /** A line's (or an ask's) text, from the vocabulary, or null. */
  render(id: string, args: Record<string, unknown>, slot: number | null, kind?: 'lines' | 'asks'): string | null;
  on(kind: 'say', fn: (e: SayEvent) => void): () => void;
  on(kind: 'goal', fn: (e: GoalEvent) => void): () => void;
  on(kind: 'ask', fn: (e: Ask & { slot: number }) => void): () => void;
  stats(): AgentsStats;
  stop(): void;
}

const own = <T>(table: Record<string, T> | undefined, key: unknown): T | undefined => table && typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
const TALK = ['workers-ai', 'owner-key'];
export const AGENT_RULES = Object.freeze({ viewMs: 2050, floorMs: 1000, quietMs: 8000, leaveMs: 10 * 60_000, askMs: 30_000, holdMs: 45_000, askWaitMs: 4000, carryMs: 60_000, viewBytes: 1900 });
const VIEW_ARG = /^view\.([A-Za-z][A-Za-z0-9_]{0,23})$/;
const SLOT_IN_TEXT = /\{([a-z][a-z0-9_]{0,15})\}/g;

/** Whether a server's AI may talk (the owner's consent, agents_brain). */
export const talksOn = (p: Policy | null | undefined): boolean => Boolean(p && TALK.includes(p.brain) && p.speech !== 'off' && p.kind !== 'humans-only');

/** Whether one value fits its type (the same rule as the relay's, worker/brain.mjs `argOk`). */
export function argOk(type: ArgType | undefined, value: unknown, view: Record<string, unknown> | null, players: number[] | null): boolean {
  if (type === 'player') return Number.isInteger(value) && (value as number) >= 0 && (value as number) < 64 && (!players || players.includes(value as number));
  if (Array.isArray(type)) return typeof value === 'string' && type.includes(value);
  const m = typeof type === 'string' ? VIEW_ARG.exec(type) : null;
  if (!m || !view || (typeof value !== 'string' && typeof value !== 'number')) return false;
  const offered = view[m[1] as string];
  if (Array.isArray(offered)) return offered.some((o) => o === value || (o && typeof o === 'object' && (o as { id?: unknown }).id === value));
  return offered !== null && offered !== undefined && typeof offered !== 'object' && offered === value;
}

/** Why arguments do not fit (missing, extra, a wrong value), or null when they do. */
export function argsWhy(types: Record<string, ArgType> | undefined, args: unknown, view: Record<string, unknown> | null, players: number[] | null): string | null {
  const want = Object.keys(types ?? {});
  const a = (args === undefined || args === null ? {} : args) as Record<string, unknown>;
  if (typeof a !== 'object' || Array.isArray(a)) return 'args is an object';
  for (const k of Object.keys(a)) if (!want.includes(k)) return `no argument ${k}`;
  for (const k of want) {
    if (!(k in a)) return `missing ${k}`;
    if (!argOk((types as Record<string, ArgType>)[k], a[k], view, players)) return `${k} does not fit`;
  }
  return null;
}

export const labelOf = (vocab: Vocabulary, value: unknown): string => own(vocab.labels, String(value)) ?? String(value ?? '').replace(/[-_]+/g, ' ');

/* ------------------------------------------------------------------ useAgents */

export function useAgents(net: Netplay<any, any, any>, vocab: Vocabulary, opts: AgentsOptions): Agents {
  const roles = opts.roles ?? ['guide'];
  const holdMs = opts.holdMs ?? AGENT_RULES.holdMs;
  const askWaitMs = opts.askWaitMs ?? AGENT_RULES.askWaitMs;
  const goals = new Map<number, Goal>();
  const asks = new Map<number, Ask[]>();
  const avoid = new Map<number, Map<number, number>>();
  const sayAt = new Map<number, number>();
  const viewAt = new Map<number, number>();
  const lastView = new Map<number, Record<string, unknown>>();
  const floorAt = new Map<number, number>();
  const askAt = new Map<number, number>();
  const handlers = { say: new Set<(e: SayEvent) => void>(), goal: new Set<(e: GoalEvent) => void>(), ask: new Set<(e: Ask & { slot: number }) => void>() };
  const st: AgentsStats = { views: 0, dos: 0, says: 0, asks: 0, drops: 0, floors: 0, viewBytes: 0 };
  const wall = opts.now ?? (() => Date.now());
  if (opts.restore) {
    const entries = (v: unknown): [number, any][] => Array.isArray(v) ? v.slice(0, 256).filter((e) => Array.isArray(e) && e.length === 2 && Number.isSafeInteger(e[0]) && e[0] >= 0) : [];
    const stamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= wall();
    for (const [k, v] of entries(opts.restore.goals)) if (v && own(vocab.goals, v.goal) && stamp(v.at) && v.args && typeof v.args === 'object' && !Array.isArray(v.args)) goals.set(k, { ...v });
    for (const [k, v] of entries(opts.restore.asks)) if (Array.isArray(v)) asks.set(k, v.slice(0, 3).filter((a) => a && own(vocab.asks, a.k) && stamp(a.at) && Number.isSafeInteger(a.from) && a.from >= 0 && a.args && typeof a.args === 'object' && !Array.isArray(a.args)));
    for (const [k, v] of entries(opts.restore.avoid)) avoid.set(k, new Map(entries(v).filter(([, until]) => typeof until === 'number' && Number.isFinite(until) && until > wall() && until <= wall() + AGENT_RULES.leaveMs)));
    for (const [dst, src] of [[sayAt, opts.restore.sayAt], [viewAt, opts.restore.viewAt], [floorAt, opts.restore.floorAt], [askAt, opts.restore.askAt]] as const) for (const [k, v] of entries(src)) if (stamp(v)) dst.set(k, v);
  }

  const guides = (): Slot[] => (net.slots ?? []).filter((s) => s.agent && roles.includes(s.agent.role as 'guide' | 'party'));
  const slotOf = (slot: number): Slot | undefined => guides().find((s) => s.slot === slot);
  const slotOfSeat = (seat: number | null): Slot | undefined => (seat === null ? undefined : guides().find((s) => s.agent?.seat === seat));
  const people = (): number[] => [...net.peers.values()].filter((p) => p.seat !== null && !p.agent && !p.watch).map((p) => p.seat as number);
  const nameOf = (seat: unknown): string => {
    for (const p of net.peers.values()) if (p.seat === seat) return p.name;
    return `Player ${Number(seat) + 1}`;
  };
  const emit = (k: keyof typeof handlers, e: unknown): void => {
    for (const fn of handlers[k] as Set<(x: unknown) => void>) { try { fn(e); } catch { /* the game's own */ } }
  };
  const avoided = (slot: number): number[] => {
    const m = avoid.get(slot);
    if (!m) return [];
    const now = wall();
    for (const [s, until] of m) if (until <= now) m.delete(s);
    return [...m.keys()];
  };
  const touchesAvoided = (types: Record<string, ArgType> | undefined, a: Record<string, unknown>, slot: number): boolean => {
    const out = avoided(slot);
    return Object.entries(types ?? {}).some(([k, t]) => t === 'player' && out.includes(a[k] as number));
  };

  function render(id: string, args: Record<string, unknown>, slot: number | null, kind: 'lines' | 'asks' = 'lines'): string | null {
    const def = kind === 'asks' ? own(vocab.asks, id) : own(vocab.lines, id);
    if (!def) return null;
    const s = slot === null ? undefined : (net.slots ?? []).find((x) => x.slot === slot);
    const me = s ? stripAi(s.name) : 'Guide';
    return def.text.replace(SLOT_IN_TEXT, (_m, k: string) => (k === 'me' ? me : def.args?.[k] === 'player' ? nameOf(args[k]) : labelOf(vocab, args[k])));
  }

  /** A line the host lets a guide say: from the vocabulary, its arguments fit, not within 8 s of its last. */
  function say(slot: number, line: string, args: Record<string, unknown>): boolean {
    const def = own(vocab.lines, line);
    const now = wall();
    if (!def || !talksOn(net.policy) || now - (sayAt.get(slot) ?? -Infinity) < AGENT_RULES.quietMs) { st.drops += 1; return false; }
    if (argsWhy(def.args, args, lastView.get(slot) ?? null, people()) || touchesAvoided(def.args, args, slot)) { st.drops += 1; return false; }
    sayAt.set(slot, now);
    const s = slotOf(slot);
    const seat = s?.agent?.seat ?? null;
    // Everyone renders it from their own copy of the vocabulary; `ai` lets Quiet AI hide it on any browser.
    net.send(`say:${line}`, { slot, seat, args, ai: true });
    st.says += 1;
    const text = render(line, args, slot);
    if (text && !net.hushed) emit('say', { slot, seat, line, args, text });
    return true;
  }

  function setGoal(slot: number, d: Decision, from: 'brain' | 'floor', answering = true): boolean {
    if (!d.goal) return false;
    const def = own(vocab.goals, d.goal);
    const args = (d.args ?? {}) as Record<string, unknown>;
    if (!def || argsWhy(def.args, args, lastView.get(slot) ?? opts.view(slot), people()) || touchesAvoided(def.args, args, slot)) { st.drops += 1; return false; }
    const prev = goals.get(slot) ?? null;
    const same = prev && prev.goal === d.goal && JSON.stringify(prev.args) === JSON.stringify(args) && prev.state === 'active';
    const now = wall();
    if (same) { if (from === 'brain') { prev.from = 'brain'; prev.at = now; } return false; }
    const g: Goal = { goal: d.goal, args: { ...args }, from, at: now, state: 'active' };
    goals.set(slot, g);
    const pendingAsk = answering ? askAt.get(slot) ?? null : null;
    emit('goal', { slot, goal: g, prev, askAt: pendingAsk });
    return true;
  }

  function apply(slot: number, d: Decision | null, from: 'brain' | 'floor', speak: boolean): void {
    if (!d) return;
    // A person's ask is answered the way agents.json says (its `goal`): a brain's decision that does something else
    // leaves the ask open, and the floor answers it once the brain has had askWaitMs (a fixed rule, not the model's).
    const open = askAt.has(slot) ? (asks.get(slot) ?? []).at(-1) ?? null : null;
    const want = open ? own(vocab.asks, open.k)?.goal : undefined;
    const answering = !open || !want || (want === d.goal && Object.entries(open.args).every(([k, v]) => !own(own(vocab.goals, want)?.args, k) || d.args?.[k] === v));
    // What a person asked for is carried through until it is done (or 60 s): a brain's other goal waits.
    const cur = goals.get(slot);
    if (!open && from === 'brain' && cur && cur.asked && cur.state === 'active' && wall() - cur.at < AGENT_RULES.carryMs && (d.goal !== cur.goal || JSON.stringify(d.args ?? {}) !== JSON.stringify(cur.args))) { st.drops += 1; if (speak && d.say) say(slot, d.say, (d.sayArgs ?? {}) as Record<string, unknown>); return; }
    setGoal(slot, d, from, answering);
    if (open && answering && goals.get(slot)?.goal === d.goal && JSON.stringify(goals.get(slot)?.args) === JSON.stringify(d.args ?? {})) { askAt.delete(slot); asks.set(slot, []); const g = goals.get(slot); if (g && d.goal === g.goal) { g.asked = true; g.at = wall(); } }
    if (speak && d.say) say(slot, d.say, (d.sayArgs ?? {}) as Record<string, unknown>);
  }

  function viewOf(slot: number): Record<string, unknown> {
    let v: Record<string, unknown> = {};
    try { v = opts.view(slot) ?? {}; } catch { v = {}; }
    const g = goals.get(slot);
    return { ...v, ...(g ? { goal: { goal: g.goal, args: g.args, state: g.state } } : {}), ...(v['asks'] ? {} : { asks: asksFor(slot).slice(0, 3).map((a) => ({ k: a.k, args: a.args, from: a.from, at: a.at })) }) };
  }

  function asksFor(slot: number): Ask[] {
    const now = wall();
    const list = (asks.get(slot) ?? []).filter((a) => now - a.at < AGENT_RULES.askMs);
    asks.set(slot, list);
    return [...list].reverse();
  }

  /** The floor for one slot: the game's own decide, on its view. */
  function floor(slot: number, held: boolean): void {
    if (!opts.decide) { floorAt.set(slot, wall()); askAt.delete(slot); asks.set(slot, []); return; }
    const v = viewOf(slot);
    lastView.set(slot, v);
    let d: Decision | null = null;
    try { d = opts.decide(v, { slot, goal: goals.get(slot) ?? null, asks: asksFor(slot) }); } catch { d = null; }
    floorAt.set(slot, wall());
    // One floor attempt settles an ask, even if it declines or fails.
    if (!d) { askAt.delete(slot); asks.set(slot, []); return; }
    st.floors += 1;
    // The floor speaks only for a guide no AI holds (a held guide's own brain speaks for it).
    apply(slot, d, 'floor', !held);
    askAt.delete(slot); asks.set(slot, []);
  }

  /** A person's ask reached the host (theirs, or its own player's). */
  function onAsk(slot: number, k: string, args: Record<string, unknown>, from: number): void {
    const def = own(vocab.asks, k);
    const s = slotOf(slot);
    if (!def || !s || argsWhy(def.args, args, viewOf(slot), people())) { st.drops += 1; return; }
    const now = wall();
    if (def.leave) { const m = avoid.get(slot) ?? new Map<number, number>(); m.set(from, now + AGENT_RULES.leaveMs); avoid.set(slot, m); }
    asks.set(slot, [...(asks.get(slot) ?? []), { k, args, from, at: now }].slice(-4));
    askAt.set(slot, now);
    st.asks += 1;
    emit('ask', { slot, k, args, from, at: now });
    const held = s.agent?.seat !== null && s.agent?.seat !== undefined;
    // No AI holds this guide: the floor answers at once. Held: its brain has askWaitMs to answer first.
    if (!held) { if (opts.manual) floorAt.delete(slot); else floor(slot, false); }
  }

  const offEvent = net.on('event', (e: NetEvent) => {
    const k = e.k;
    const d = (e.d && typeof e.d === 'object' ? e.d : {}) as Record<string, unknown>;
    if (net.isHost && !opts.viewOnly) {
      const s = slotOfSeat(e.from);
      if (k === 'agent:do' && s) {
        st.dos += 1;
        apply(s.slot, { goal: d['goal'] as string, args: d['args'] as Record<string, unknown> }, 'brain', false);
        return;
      }
      const line = /^say:([a-z][a-z0-9_]{0,31})$/.exec(k)?.[1];
      if (line && s && d['ai'] === undefined) { say(s.slot, line, (d['args'] ?? {}) as Record<string, unknown>); return; }
      const ask = /^ask:([a-z][a-z0-9_]{0,31})$/.exec(k)?.[1];
      if (ask && e.from !== null && !net.isAgent(e.from) && Number.isInteger(d['slot'])) { onAsk(d['slot'] as number, ask, (d['args'] ?? {}) as Record<string, unknown>, e.from); return; }
      return;
    }
    if (k === 'agent:offer' && e.from === (opts.viewOnly ? null : net.host?.seat) && Number.isInteger(d['slot']) && d['view'] && typeof d['view'] === 'object') { lastView.set(d['slot'] as number, d['view'] as Record<string, unknown>); return; }
    // Every other browser: a guide's line the host relayed (Quiet AI already dropped it in the helper). Its words are
    // this browser's own copy of the vocabulary; an argument is a seat, a value of the line's list, or an id.
    const line = /^say:([a-z][a-z0-9_]{0,31})$/.exec(k)?.[1];
    if (e.from === (opts.viewOnly ? null : net.host?.seat) && line && d['ai'] === true && Number.isInteger(d['slot'])) {
      const args = (d['args'] ?? {}) as Record<string, unknown>;
      const def = own(vocab.lines, line);
      const ids = Object.fromEntries(Object.entries(def?.args ?? {}).map(([n, t]) => [n, t]).filter(([, t]) => typeof t === 'string' && VIEW_ARG.test(t)).map(([n, t]) => [VIEW_ARG.exec(t as string)![1], /^[a-z0-9][a-z0-9_-]{0,39}$/.test(String(args[n as string] ?? '')) ? [args[n as string]] : []]));
      if (!def || argsWhy(def.args, args, ids, null)) { st.drops += 1; return; }
      const text = render(line, args, d['slot'] as number);
      if (text && !net.hushed) emit('say', { slot: d['slot'] as number, seat: (d['seat'] as number | null) ?? null, line, args, text });
    }
  });

  // The host's beat: views to the guides an AI holds (at most one every 2 s each), the floor for the rest.
  const beat = (): void => {
    if (opts.viewOnly || !net.isHost || net.offline) return;
    const now = wall();
    for (const s of guides()) {
      const seat = s.agent?.seat ?? null;
      const held = seat !== null;
      if (held && now - (viewAt.get(s.slot) ?? -Infinity) >= AGENT_RULES.viewMs) {
        const v = viewOf(s.slot);
        const text = JSON.stringify(v);
        st.viewBytes = text.length;
        if (text.length <= AGENT_RULES.viewBytes) {
          lastView.set(s.slot, v);
          net.send('agent:view', v, seat as number);
          viewAt.set(s.slot, now);
          st.views += 1;
        } else st.drops += 1;
      }
      const g = goals.get(s.slot);
      const brainFresh = held && g && g.from === 'brain' && g.state === 'active' && now - g.at < holdMs;
      const waiting = held && askAt.has(s.slot) && now - (askAt.get(s.slot) as number) < askWaitMs;
      // The floor decides for a guide with no AI's decision in force, at most once a second; an ask an AI left
      // unanswered for askWaitMs is answered by the floor (silently: a held guide's lines are its brain's).
      const carried = opts.carryFloor && g?.asked && g.state === 'active' && now - g.at < AGENT_RULES.carryMs && !askAt.has(s.slot);
      if (!carried && ((!brainFresh && !waiting && now - (floorAt.get(s.slot) ?? -Infinity) >= AGENT_RULES.floorMs) || (held && askAt.has(s.slot) && !waiting))) floor(s.slot, held);
    }
    // Slots no longer an AI's: forget them.
    const live = new Set(guides().map((s) => s.slot));
    for (const map of [goals, asks, avoid, sayAt, viewAt, floorAt, askAt, lastView]) for (const k of [...map.keys()]) if (!live.has(k)) map.delete(k);
  };
  const timer = opts.manual ? null : setInterval(beat, 250);

  const agents: Agents = {
    tick: beat,
    forget: (slot) => { for (const map of [goals, asks, avoid, sayAt, viewAt, floorAt, askAt, lastView]) map.delete(slot); },
    dropGoal: (slot) => { goals.delete(slot); floorAt.delete(slot); },
    save: () => ({ goals: [...goals], asks: [...asks], avoid: [...avoid].map(([k, v]) => [k, [...v]]), sayAt: [...sayAt], viewAt: [...viewAt], floorAt: [...floorAt], askAt: [...askAt] }),
    vocab,
    get talking() { return talksOn(net.policy); },
    guides,
    goalOf: (slot) => goals.get(slot) ?? null,
    asksFor,
    ask(slot, k, args = {}) {
      const def = own(vocab.asks, k);
      const s = slotOf(slot);
      if (!def || !s) return false;
      const seat = s.agent?.seat ?? null;
      if (net.isHost && !opts.viewOnly) {
        const me = net.offline ? 0 : net.seat;
        if (me === null) return false;
        onAsk(slot, k, args, me);
        // The AI holding this guide hears its host's own player's ask directly.
        if (seat !== null) net.send(`ask:${k}`, { slot, seat, args }, seat);
        return true;
      }
      if (net.seat === null) return false;
      net.send(`ask:${k}`, { slot, seat, args });
      return true;
    },
    askButtons(slot, offer = {}) {
      if (!slotOf(slot)) return [];
      const out: AskButton[] = [];
      const view = { ...(lastView.get(slot) ?? {}), ...offer };
      for (const [k, def] of Object.entries(vocab.asks ?? {})) {
        const names = Object.keys(def.args ?? {});
        if (!names.length) { const text = render(k, {}, slot, 'asks'); if (text) out.push({ k, args: {}, text }); continue; }
        if (names.length !== 1) continue;
        const name = names[0] as string;
        const type = (def.args as Record<string, ArgType>)[name];
        const m = typeof type === 'string' ? VIEW_ARG.exec(type) : null;
        const values = Array.isArray(type) ? [...type] : type === 'player' ? (net.seat === null ? [] : [net.seat]) : m ? (Array.isArray(view[m[1] as string]) ? (view[m[1] as string] as unknown[]) : []) : [];
        for (const v of values.slice(0, 4)) {
          const value = v && typeof v === 'object' ? (v as { id?: unknown }).id : v;
          const text = render(k, { [name]: value }, slot, 'asks');
          if (text) out.push({ k, args: { [name]: value }, text });
        }
      }
      return out;
    },
    done(slot, ok = true) {
      const g = goals.get(slot);
      if (!g || g.state !== 'active') return;
      g.state = ok ? 'done' : 'failed';
      g.at = wall();
      const s = slotOf(slot);
      // A guide no AI holds decides again at once; one an AI holds hears it in its next view.
      if (s && (s.agent?.seat ?? null) === null) { if (opts.manual) floorAt.delete(slot); else floor(slot, false); }
    },
    render,
    on(kind: 'say' | 'goal' | 'ask', fn: (e: never) => void) {
      (handlers[kind] as Set<unknown>).add(fn);
      return () => { (handlers[kind] as Set<unknown>).delete(fn); };
    },
    stats: () => ({ ...st }),
    stop() { if (timer) clearInterval(timer); offEvent(); },
  } as Agents;
  return agents;
}

/** The name an AI guide plays under in a vocabulary (its n-th name, " · AI"). */
export const guideName = (vocab: Vocabulary, n: number): string => aiName(vocab.names?.[n % Math.max(1, vocab.names?.length ?? 0)] ?? 'Guide');
