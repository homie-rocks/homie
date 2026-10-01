/*
 * saves.ts — cloud saves for a game on a Homie studio (@homie-rocks/studio/saves). SAVES.md beside it is the guide.
 * =============================================================================
 *
 *   import { createSaves } from '@homie-rocks/studio/saves';
 *   const saves = createSaves({ game: 'my-game' });
 *   const hero = (await saves.get<Hero>('hero')) ?? newHero();
 *   await saves.set('hero', hero);                       // safe in this browser at once, in the cloud when online
 *   saves.stats.add({ kills: 1, seconds: 30 });          // lifetime numbers that survive a wipe
 *   await saves.fall({ character: hero.name, summary: { level: hero.level }, wipe: true });  // hardcore death
 *   saves.on('player', () => reload());                  // the player signed in on this device: their saves changed
 *
 * WHERE IT KEEPS THINGS. A game on a studio site runs in a sandboxed frame that can keep nothing of its own. The
 * play shell around it (on the studio's own origin) does it: a local copy in that browser, an outbox that syncs to
 * the studio's Worker and D1, and the player's passkey sign-in. This file only talks to the shell (postMessage),
 * so the game never sees a session or a cookie, and can only reach its OWN game's saves. Without a shell (the
 * game opened as a plain file, a Vite dev server, a game.json with no "saves": true) it keeps everything in this
 * page's localStorage instead (mode 'local'), so the same code runs everywhere.
 *
 * ROOMS ARE NOT SAVES. A room forgets everything 60 s after its last player leaves. A character that must last
 * days lives in saves: load it when the player arrives, save it when it changes, and let the room carry only the
 * live round.
 *
 * It has no imports and uses only erasable TypeScript: vendor it into a game like netplay.ts, or import it.
 * =============================================================================
 */

export const SAVES_VERSION = 1;

export interface Player {
  /** `pl_…` on a studio site (null before this browser saved anything, and in local mode). */
  id: string | null;
  name: string;
  /** No passkey yet: progress is kept in this browser only until the player makes an account. */
  guest: boolean;
  /** The studio owner's own account (marked once with `homie-studio players owner`). Show, never trust. */
  owner: boolean;
  signedIn: boolean;
  /** No studio shell around the game: everything is in this page's localStorage. */
  local: boolean;
}

export interface SaveEntry { key: string; version: number; updatedAt: number | null; pending?: boolean }
export interface SetResult { ok: boolean; synced: boolean; version: number; error?: string; message?: string }
export interface Memorial { character: string; player: string; summary: Record<string, unknown>; at: number }
export interface SavesStatus { mode: 'cloud' | 'local'; online: boolean; pending: number; lastSyncAt: number | null; lastError: string | null }
export interface Conflict<T = unknown> { key: string; mine: T | null; theirs: T | null; theirsVersion: number }
export type SavesEvent = 'player' | 'synced' | 'conflict' | 'status' | 'error';

export interface SavesOptions {
  /** The game's id (its folder): names the local-mode store. On a studio site the shell's own game id is used. */
  game?: string;
  /**
   * Another device saved a key since this one's copy (this browser was offline, or two devices played at once).
   * Return the value to keep (merge them, or return `mine`), or `undefined` for the cloud's (the default: a stale
   * offline copy never overwrites newer progress, so a hardcore character cannot come back from the dead).
   */
  onConflict?: (c: Conflict) => unknown | Promise<unknown>;
  /** Tests and custom shells: where messages go (default: the parent frame) and the shell's answer window. */
  target?: { postMessage: (m: unknown, origin: string) => void } | null;
  /** Force local mode (true) or cloud mode (false). Default: cloud when the shell said so (HOMIE_NET.saves). */
  local?: boolean;
  /** Local mode's storage (default: localStorage when usable, else memory). */
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
}

export interface Saves {
  /** Resolves once the player and their saves are loaded (cloud mode: from the shell's copy, then the cloud). */
  readonly ready: Promise<Player>;
  readonly player: Player;
  readonly mode: 'cloud' | 'local';
  /** The last known value of a key, at once (for a render loop). `get` is the same, as a promise. */
  peek<T = unknown>(key: string): T | null;
  get<T = unknown>(key: string): Promise<T | null>;
  /** Keep a value (JSON, 64 KiB; 1 MiB with the studio's storage). Resolves when synced, or after ~4 s saved locally. */
  set<T = unknown>(key: string, value: T): Promise<SetResult>;
  remove(key: string): Promise<SetResult>;
  list(): Promise<SaveEntry[]>;
  /** Delete this game's saves (except `keep`): "new game". Lifetime stats and memorials stay. */
  wipe(opts?: { keep?: string[] }): Promise<{ ok: boolean; synced: boolean }>;
  readonly stats: {
    get(): Promise<Record<string, number>>;
    /** Add to counters: { kills: 1, gold: 25, seconds: 30 }. */
    add(values: Record<string, number>): Promise<{ ok: boolean }>;
    /** Keep the highest: { level: 12 }. */
    max(values: Record<string, number>): Promise<{ ok: boolean }>;
    /** Keep the lowest: { fastestRun: 312 }. */
    min(values: Record<string, number>): Promise<{ ok: boolean }>;
  };
  /**
   * A character died for good (hardcore): a memorial in the hall of the fallen (its name, your display name, a
   * small summary), and with `wipe: true` this game's saves are deleted in the same step (except `keep`).
   */
  fall(m: { character: string; summary?: Record<string, unknown>; wipe?: boolean; keep?: string[] }): Promise<{ ok: boolean; synced: boolean; memorial: Memorial | null }>;
  /** The hall of the fallen: the newest memorials of this game (everyone's), or `mine: true`. */
  fallen(opts?: { limit?: number; mine?: boolean }): Promise<Memorial[]>;
  /** Change the player's display name on this studio (the same rules as the account page). */
  rename(name: string): Promise<{ ok: boolean; name?: string; message?: string }>;
  /** Ask the shell to show its sign-in sheet (a passkey). Call it from a button the player pressed. */
  signIn(reason?: string): void;
  /** Wait until every change is in the cloud (or the network said no). */
  flush(): Promise<SavesStatus>;
  status(): SavesStatus;
  on(ev: 'player', fn: (p: Player) => void): () => void;
  on(ev: 'conflict', fn: (c: Conflict & { kept: 'theirs' | 'game' }) => void): () => void;
  on(ev: 'synced' | 'status', fn: (s: SavesStatus) => void): () => void;
  on(ev: 'error', fn: (e: { key?: string; error: string; message?: string }) => void): () => void;
}

const KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
type Msg = Record<string, unknown> & { t?: string; q?: number; ev?: string; ok?: boolean };

export function createSaves(opts: SavesOptions = {}): Saves {
  const g = globalThis as unknown as {
    HOMIE_NET?: { saves?: boolean }; parent?: unknown; addEventListener?: typeof addEventListener; localStorage?: Storage;
  };
  const cloud = opts.local === undefined ? Boolean(g.HOMIE_NET?.saves) : !opts.local;
  const game = String(opts.game ?? 'game').replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'game';
  const listeners = new Map<string, Set<(x: unknown) => void>>();
  const emit = (ev: string, x: unknown): void => { for (const fn of listeners.get(ev) ?? []) { try { fn(x); } catch { /* the game's */ } } };
  let player: Player = { id: null, name: 'Guest', guest: true, owner: false, signedIn: false, local: !cloud };
  let mirror: Record<string, unknown> = {};
  let st: SavesStatus = { mode: cloud ? 'cloud' : 'local', online: true, pending: 0, lastSyncAt: null, lastError: null };

  /* ------------------------------------------------------------ cloud mode: the shell */
  const target = opts.target !== undefined ? opts.target : (g.parent && g.parent !== (globalThis as unknown) ? g.parent as { postMessage: (m: unknown, o: string) => void } : null);
  let seq = 0;
  const waiting = new Map<number, (m: Msg) => void>();
  const ask = (op: string, args: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<Msg> => new Promise((resolve) => {
    if (!target) { resolve({ ok: false, error: 'no-shell', message: 'no studio shell around this game' }); return; }
    const q = ++seq;
    const timer = setTimeout(() => { waiting.delete(q); resolve({ ok: false, error: 'timeout', message: 'the play shell did not answer' }); }, timeoutMs);
    waiting.set(q, (m) => { clearTimeout(timer); resolve(m); });
    try { target.postMessage({ t: 'homie-save', q, op, ...args }, '*'); } catch { clearTimeout(timer); waiting.delete(q); resolve({ ok: false, error: 'no-shell' }); }
  });
  const asPlayer = (p: unknown): Player => {
    const o = (p ?? {}) as Partial<Player>;
    return { id: typeof o.id === 'string' ? o.id : null, name: typeof o.name === 'string' ? o.name : 'Guest', guest: o.guest !== false, owner: o.owner === true, signedIn: o.guest === false, local: false };
  };

  if (cloud && g.addEventListener) {
    g.addEventListener('message', (ev: MessageEvent) => {
      const m = ev.data as Msg;
      if (!m || typeof m !== 'object' || m.t !== 'homie-save') return;
      if (target && ev.source && ev.source !== (target as unknown)) return;
      if (typeof m.q === 'number' && waiting.has(m.q)) { const f = waiting.get(m.q)!; waiting.delete(m.q); f(m); return; }
      if (m.ev === 'player') {
        player = asPlayer(m.player);
        if (m.cache && typeof m.cache === 'object') mirror = { ...(m.cache as Record<string, unknown>) };
        emit('player', player);
      } else if (m.ev === 'status' || m.ev === 'synced') {
        if (m.status) st = { ...(m.status as SavesStatus) };
        emit(m.ev, st);
      } else if (m.ev === 'error') emit('error', { key: m.key, error: m.error, message: m.message });
      else if (m.ev === 'conflict') {
        const c = { key: String(m.key), mine: m.mine ?? null, theirs: m.theirs ?? null, theirsVersion: Number(m.theirsVersion) || 0 };
        if (typeof m.ask === 'number' && opts.onConflict) {
          Promise.resolve().then(() => opts.onConflict!(c)).then((keep) => {
            target?.postMessage({ t: 'homie-save', op: 'resolve', ask: m.ask, ...(keep === undefined ? { keep: 'theirs' } : { keep: 'value', value: keep }) }, '*');
          }, () => target?.postMessage({ t: 'homie-save', op: 'resolve', ask: m.ask, keep: 'theirs' }, '*'));
          return;
        }
        if (m.kept === 'theirs') { if (c.theirs === null) delete mirror[c.key]; else mirror[c.key] = c.theirs; }
        emit('conflict', { ...c, kept: m.kept === 'game' ? 'game' : 'theirs' });
      }
    });
  }

  /* ------------------------------------------------------------ local mode: this page's storage */
  const memory = new Map<string, string>();
  const store = opts.storage !== undefined && opts.storage !== null ? opts.storage : (() => {
    try { const ls = g.localStorage; if (ls) { ls.setItem('homie-saves.test', '1'); return ls; } } catch { /* sandboxed */ }
    return { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); } };
  })();
  interface LocalDb { saves: Record<string, { v: unknown; ver: number; at: number }>; stats: Record<string, number>; fallen: Memorial[] }
  const LOCAL = `homie-saves.local.${game}`;
  const readLocal = (): LocalDb => { try { const j = JSON.parse(store.getItem(LOCAL) ?? 'null'); if (j && j.saves) return j; } catch { /* fresh */ } return { saves: {}, stats: {}, fallen: [] }; };
  const writeLocal = (db: LocalDb): void => { try { store.setItem(LOCAL, JSON.stringify(db)); } catch { /* full */ } };

  /* ------------------------------------------------------------ ready */
  const ready: Promise<Player> = (async () => {
    if (!cloud || !target) {
      player = { id: null, name: 'You', guest: true, owner: false, signedIn: false, local: true };
      st = { ...st, mode: 'local' };
      const db = readLocal();
      mirror = Object.fromEntries(Object.entries(db.saves).map(([k, e]) => [k, e.v]));
      return player;
    }
    const r = await ask('hello', { v: SAVES_VERSION, resolver: Boolean(opts.onConflict) }, 15_000);
    if (r.ok) {
      player = asPlayer(r.player);
      mirror = { ...((r.cache as Record<string, unknown>) ?? {}) };
      if (r.status) st = { ...(r.status as SavesStatus) };
    } else st = { ...st, online: false, lastError: String(r.message ?? r.error ?? 'no shell') };
    return player;
  })();

  const checkKey = (key: string): string | null => (KEY.test(String(key)) ? null : 'a save key is 1 to 64 letters, digits, _ . : or -');

  const api: Saves = {
    ready,
    get player() { return player; },
    get mode() { return cloud && target ? 'cloud' : 'local'; },
    peek<T>(key: string): T | null { return (key in mirror ? mirror[key] : null) as T | null; },
    async get<T>(key: string): Promise<T | null> {
      await ready;
      if (checkKey(key)) return null;
      if (api.mode === 'local') return (readLocal().saves[key]?.v ?? null) as T | null;
      const r = await ask('get', { key });
      if (r.ok) { if (r.value === null || r.value === undefined) delete mirror[key]; else mirror[key] = r.value; }
      return (r.ok ? r.value ?? null : mirror[key] ?? null) as T | null;
    },
    async set<T>(key: string, value: T): Promise<SetResult> {
      await ready;
      const bad = checkKey(key);
      if (bad) return { ok: false, synced: false, version: 0, error: 'key', message: bad };
      if (value === undefined) return { ok: false, synced: false, version: 0, error: 'value', message: 'a save needs a value; use remove() to delete a key' };
      let copy: unknown;
      try { copy = JSON.parse(JSON.stringify(value)); } catch { return { ok: false, synced: false, version: 0, error: 'value', message: 'a save is JSON' }; }
      mirror[key] = copy;
      if (api.mode === 'local') {
        const db = readLocal();
        const ver = (db.saves[key]?.ver ?? 0) + 1;
        db.saves[key] = { v: copy, ver, at: Date.now() };
        writeLocal(db);
        return { ok: true, synced: true, version: ver };
      }
      const r = await ask('set', { key, value: copy });
      return { ok: Boolean(r.ok), synced: Boolean(r.synced), version: Number(r.version) || 0, ...(r.ok ? {} : { error: String(r.error), message: String(r.message ?? '') }) };
    },
    async remove(key: string): Promise<SetResult> {
      await ready;
      const bad = checkKey(key);
      if (bad) return { ok: false, synced: false, version: 0, error: 'key', message: bad };
      delete mirror[key];
      if (api.mode === 'local') { const db = readLocal(); delete db.saves[key]; writeLocal(db); return { ok: true, synced: true, version: 0 }; }
      const r = await ask('del', { key });
      return { ok: Boolean(r.ok), synced: Boolean(r.synced), version: 0, ...(r.ok ? {} : { error: String(r.error), message: String(r.message ?? '') }) };
    },
    async list(): Promise<SaveEntry[]> {
      await ready;
      if (api.mode === 'local') return Object.entries(readLocal().saves).sort(([a], [b]) => a.localeCompare(b)).map(([key, e]) => ({ key, version: e.ver, updatedAt: e.at }));
      const r = await ask('list');
      return Array.isArray(r.keys) ? r.keys as SaveEntry[] : [];
    },
    async wipe({ keep = [] } = {}) {
      await ready;
      for (const k of Object.keys(mirror)) if (!keep.includes(k)) delete mirror[k];
      if (api.mode === 'local') { const db = readLocal(); for (const k of Object.keys(db.saves)) if (!keep.includes(k)) delete db.saves[k]; writeLocal(db); return { ok: true, synced: true }; }
      const r = await ask('wipe', { keep });
      return { ok: Boolean(r.ok), synced: Boolean(r.synced) };
    },
    stats: {
      async get() {
        await ready;
        if (api.mode === 'local') return { ...readLocal().stats };
        const r = await ask('stats', { kind: 'get' });
        return (r.stats as Record<string, number>) ?? {};
      },
      add: (values) => bump('add', values),
      max: (values) => bump('max', values),
      min: (values) => bump('min', values),
    },
    async fall({ character, summary = {}, wipe = false, keep = [] }) {
      await ready;
      if (wipe) for (const k of Object.keys(mirror)) if (!keep.includes(k)) delete mirror[k];
      if (api.mode === 'local') {
        const db = readLocal();
        const memorial: Memorial = { character: String(character).slice(0, 32), player: player.name, summary, at: Date.now() };
        db.fallen.unshift(memorial);
        db.fallen = db.fallen.slice(0, 50);
        if (wipe) for (const k of Object.keys(db.saves)) if (!keep.includes(k)) delete db.saves[k];
        writeLocal(db);
        return { ok: true, synced: true, memorial };
      }
      const r = await ask('fall', { character, summary, wipe, keep });
      return { ok: Boolean(r.ok), synced: Boolean(r.synced), memorial: (r.memorial as Memorial) ?? null };
    },
    async fallen({ limit = 20, mine = false } = {}) {
      await ready;
      if (api.mode === 'local') return readLocal().fallen.slice(0, limit);
      const r = await ask('fallen', { limit, mine });
      return Array.isArray(r.fallen) ? r.fallen as Memorial[] : [];
    },
    async rename(name: string) {
      await ready;
      if (api.mode === 'local') { player = { ...player, name: String(name).slice(0, 24) }; emit('player', player); return { ok: true, name: player.name }; }
      const r = await ask('rename', { name });
      return { ok: Boolean(r.ok), ...(r.name ? { name: String(r.name) } : {}), ...(r.message ? { message: String(r.message) } : {}) };
    },
    signIn(reason?: string) { if (api.mode === 'cloud') void ask('signin', reason ? { reason } : {}); },
    async flush() {
      await ready;
      if (api.mode === 'local') return st;
      const r = await ask('flush', {}, 30_000);
      if (r.status) st = { ...(r.status as SavesStatus) };
      return st;
    },
    status() { return st; },
    on(ev: SavesEvent, fn: (x: never) => void) {
      const set = listeners.get(ev) ?? new Set();
      set.add(fn as (x: unknown) => void);
      listeners.set(ev, set);
      return () => { set.delete(fn as (x: unknown) => void); };
    },
  } as Saves;

  async function bump(kind: 'add' | 'max' | 'min', values: Record<string, number>): Promise<{ ok: boolean }> {
    await ready;
    if (api.mode === 'local') {
      const db = readLocal();
      for (const [k, raw] of Object.entries(values ?? {})) {
        const n = Number(raw);
        if (!Number.isFinite(n)) continue;
        const cur = db.stats[k];
        db.stats[k] = cur === undefined ? n : kind === 'add' ? cur + n : kind === 'max' ? Math.max(cur, n) : Math.min(cur, n);
      }
      writeLocal(db);
      return { ok: true };
    }
    const r = await ask('stats', { kind, values });
    return { ok: Boolean(r.ok) };
  }

  return api;
}
