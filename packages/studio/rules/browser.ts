/*
 * The browser's adapter for the one host runtime. The build puts it with the guarded rules, either in a browser
 * host's bundle or in a server game's optional offline module. netplay owns elections and the transport; this file
 * supplies the clock and translates the runtime's saved bytes to the relay's existing JSON checkpoint.
 */
import { createHost } from './host.ts';
import { compileMap, compileRules } from './rules.ts';
import type { RoomSettings, RulesDef } from './rules.ts';
import { fromBytes, toBytes } from './pack.ts';
import { lab } from '../lab/lab.ts';
import type { RulesHostFactory, Peer } from '../netplay/netplay.ts';

export interface BrowserGame {
  id: string; build: string; tune: Record<string, unknown>; map: Parameters<typeof compileMap>[0];
  settings: RoomSettings; seats: number; vocab?: import('../agents/agents.ts').Vocabulary;
}

/** The rules and their private tunables stay inside this factory: the view is handed only the loader. */
export function browserHost(def: RulesDef, game: BrowserGame): RulesHostFactory {
  return (o) => {
    const tune = lab.rulesTune(game.tune);
    const compiled = compileRules(def, { ...game, tune, map: compileMap(game.map, String((game.map as { name?: string }).name ?? 'main')) });
    const checkpoint = o.restore as { rules?: string; data?: any } | null;
    if (o.restore && (checkpoint?.rules !== game.build || !checkpoint.data || typeof checkpoint.data !== 'object')) throw new Error('invalid checkpoint');
    // Check depth iteratively before clone/encoding can recurse on untrusted checkpoint data.
    if (checkpoint) {
      const pending: [unknown, number][] = [[checkpoint.data, 0]];
      let nodes = 0;
      while (pending.length) {
        const [value, depth] = pending.pop()!;
        if (depth > 64 || ++nodes > 500000) throw new Error('invalid checkpoint depth or size');
        if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push([child, depth + 1]);
      }
    }
    const saved = checkpoint ? structuredClone(checkpoint.data) : null;
    if (saved && o.peers && Array.isArray(saved.core?.ents) && Array.isArray(saved.core?.seats)) {
      // Identity is the relay's word. The previous host's save can preserve game state, never seat authority.
      const peers = new Map([...o.peers, ...(o.held ?? [])].filter((p) => p.seat !== null).map((p) => [p.seat, p]));
      const policy = o.policy;
      const count = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(game.seats - 1, Math.floor(n))) : 0;
      const reserved = policy?.kind === 'hybrid' || policy?.kind === 'beginner' ? Math.min(game.seats - 1, count(policy.aiSeats) + (policy.kind === 'beginner' ? count(policy.guides) : 0)) : 0;
      const identity = (seat: number): [string, string] => {
        const peer = peers.get(seat);
        return peer ? [peer.agent ? 'ai' : 'person', `p${peer.occ ?? peer.id}`] : seat >= game.seats - reserved && seat < game.seats ? ['ai', 'reserved'] : ['bot', ''];
      };
      const sameHolder = (q: any): boolean => !Array.isArray(q) || saved.core.seats.some((s: any) => Array.isArray(s) && s[0] === q[0] && s[1] === identity(q[0])[0] && s[2] === identity(q[0])[1]);
      if (Array.isArray(saved.queues)) saved.queues = saved.queues.filter(sameHolder);
      if (Array.isArray(saved.inputs)) saved.inputs = saved.inputs.filter(sameHolder);
      if (Array.isArray(saved.names)) saved.names = saved.names.filter((row: any) => {
        if (!Array.isArray(row)) return true;
        const previous = saved.core.seats.find((s: any) => Array.isArray(s) && s[0] === row[0]);
        return !(previous && previous[2] !== 'reserved' && identity(row[0])[1] === 'reserved');
      });
      for (const w of [...saved.core.ents, ...(Array.isArray(saved.core.spawns) ? saved.core.spawns : [])]) {
        if (!Array.isArray(w)) throw new Error('invalid checkpoint entity');
        const next = identity(w[11]);
        if (w[12] !== next[0] || w[13] !== next[1]) w[15] = null;
        [w[12], w[13]] = next;
      }
      for (const w of saved.core.seats) { if (!Array.isArray(w)) throw new Error('invalid checkpoint seat'); [w[1], w[2]] = identity(w[0]); }
      for (const item of Array.isArray(saved.core.queue) ? saved.core.queue : []) {
        if (Array.isArray(item) && item[6] === 'roundOver' && Array.isArray(item[7]?.results))
          for (const row of item[7].results) if (row && typeof row === 'object') row.driver = identity(row.seat)[0];
      }
      saved.core.ops = [];
    }
    // A new authority rebases every player's input clock. Timers, dice, entities and round still come from the save.

    const host = createHost({
      game: game.id, build: game.build, compiled, send: o.send, restore: saved ? toBytes(saved) : null,
      stage: lab.stage ?? undefined, startPaused: false, restoreEpoch: (Math.floor(Math.random() * 4294967296) >>> 0) || 1,
      clock: { now: o.now, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      onEnd: o.onEnd,
    });
    if (game.vocab) host.frame({ t: 'vocabulary', vocab: game.vocab });
    const present = new Set<number>();
    const sync = (peers: Peer[]): void => {
      const next = new Set(peers.flatMap((p) => p.seat === null ? [] : [p.seat]));
      for (const seat of present) if (!next.has(seat)) host.frame({ t: 'leave', seat });
      for (const body of host.core.bodies()) if (body.driver !== 'bot' && body.owner !== 'reserved' && !next.has(body.seat)) host.core.seatAway(body.seat, true);
      for (const peer of peers) if (peer.seat !== null) host.frame({ t: 'join', peer });
      present.clear(); for (const seat of next) present.add(seat);
    };
    return {
      frame: (m) => {
        if (m.t === 'join') { const p = m.peer as { seat?: number }; if (typeof p?.seat === 'number') present.add(p.seat); }
        if (m.t === 'leave' || m.t === 'free') present.delete(Number(m.seat));
        host.frame(m);
      },
      sync,
      // A restored room may be behind what its last host told the relay: the shared state is said again with the round.
      start: () => { host.start(); if (saved) o.send({ t: 'state', k: 'shared', d: host.core.shared() }); },
      stop: () => host.stop(),
      pause: () => host.pause(), resume: () => host.resume(), announce: () => host.announce(),
      save: () => ({ rules: game.build, data: fromBytes(host.save()) }),
      get tick() { return host.tick; },
      facts: () => host.facts(),
    };
  };
}
