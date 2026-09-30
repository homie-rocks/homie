/*
 * The studio's play page runs every game in a sandboxed frame WITHOUT
 * allow-same-origin: an opaque origin, so a stranger's game can never read the
 * site's storage or cookies. The price: web storage, cookies and (on WebKit)
 * the Gamepad API throw a SecurityError the moment a game touches them, and a
 * single-player game that saves a high score in localStorage dies at boot.
 *
 * installSandboxShims() puts working in-memory stand-ins in their place, only
 * where the real thing throws. Call it before the game's own code runs: a
 * bundled game imports '@homie-rocks/studio/port/early' first; a static game loads
 * `homie-port.js` as the first script in <head> (`homie-studio port import`
 * puts it there). Scores then last for the visit, not forever: the port plan
 * says so, and the game can keep a best score in the room's keyed state.
 */

export interface SandboxReport {
  localStorage: 'native' | 'memory';
  sessionStorage: 'native' | 'memory';
  cookie: 'native' | 'memory';
  gamepads: 'native' | 'guarded' | 'absent';
  indexedDB: 'native' | 'blocked' | 'absent';
}

/** A Storage that lives for the page: getItem/setItem/removeItem/clear/key/length, and `storage.key = v` too. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  const api = {
    get length() { return data.size; },
    key(i: number): string | null { return [...data.keys()][i] ?? null; },
    getItem(k: string): string | null { return data.has(String(k)) ? (data.get(String(k)) as string) : null; },
    setItem(k: string, v: unknown): void { data.set(String(k), String(v)); },
    removeItem(k: string): void { data.delete(String(k)); },
    clear(): void { data.clear(); },
  };
  // Old games write `localStorage.best = 12` and read `localStorage['best']`.
  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return Reflect.get(target, prop);
      return data.has(prop) ? data.get(prop) : undefined;
    },
    set(target, prop, value) {
      if (typeof prop === 'symbol' || prop in target) return false;
      data.set(prop, String(value));
      return true;
    },
    deleteProperty(_target, prop) { if (typeof prop === 'string') data.delete(prop); return true; },
    has(target, prop) { return prop in target || (typeof prop === 'string' && data.has(prop)); },
    ownKeys() { return [...data.keys()]; },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && data.has(prop)) return { value: data.get(prop), writable: true, enumerable: true, configurable: true };
      return undefined;
    },
  }) as unknown as Storage;
}

function works(read: () => unknown): boolean {
  try { read(); return true; } catch { return false; }
}

let report: SandboxReport | null = null;

/** Replace what an opaque-origin frame refuses with in-memory stand-ins. Safe to call twice; returns what it did. */
export function installSandboxShims(): SandboxReport {
  if (report) return report;
  const w = globalThis as unknown as Window & typeof globalThis;
  const out: SandboxReport = { localStorage: 'native', sessionStorage: 'native', cookie: 'native', gamepads: 'absent', indexedDB: 'absent' };
  if (typeof window === 'undefined') { report = out; return out; }
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (works(() => { const s = w[name]; s.getItem('__homie_probe__'); })) continue;
    try {
      Object.defineProperty(w, name, { value: memoryStorage(), configurable: true, enumerable: true, writable: false });
      out[name] = 'memory';
    } catch { /* leave it: the port plan flags storage use */ }
  }
  if (typeof document !== 'undefined' && !works(() => document.cookie)) {
    let jar = '';
    try {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => jar,
        set: (v: string) => {
          const [pair] = String(v).split(';');
          const [k] = String(pair).split('=');
          const rest = jar.split('; ').filter((c) => c && !c.startsWith(`${String(k).trim()}=`));
          jar = [...rest, String(pair).trim()].join('; ');
        },
      });
      out.cookie = 'memory';
    } catch { /* ignore */ }
  }
  const nav = w.navigator as Navigator & { getGamepads?: () => (Gamepad | null)[] };
  if (nav && typeof nav.getGamepads === 'function') {
    const real = nav.getGamepads.bind(nav);
    let dead = false;
    out.gamepads = 'native';
    try {
      // WebKit throws a SecurityError on EVERY poll in a sandboxed frame; one throw and it stops asking.
      Object.defineProperty(nav, 'getGamepads', {
        configurable: true,
        value: () => {
          if (dead) return [];
          try { return real(); } catch { dead = true; out.gamepads = 'guarded'; return []; }
        },
      });
    } catch { /* ignore */ }
  }
  if ('indexedDB' in w) out.indexedDB = works(() => w.indexedDB.open('__homie_probe__')) ? 'native' : 'blocked';
  report = out;
  return out;
}

export function sandboxReport(): SandboxReport | null { return report; }
