/*
 * shop.ts — what a player owns in a game on a Homie studio (@homie-rocks/studio/shop). SHOP.md beside it is the guide.
 * =============================================================================
 *
 *   import { createShop } from '@homie-rocks/studio/shop';
 *   const shop = createShop();
 *   await shop.ready;
 *   if (shop.has('skin:ember')) hull.material = ember;     // what the player bought, by the key shop.json gives
 *   shop.on('change', () => redrawSkins());                // a purchase landed (or a refund took one back)
 *   button.onclick = () => shop.open('ember-skin');        // the store sheet; on a TV, a code to buy on a phone
 *   shop.used('skin:ember');                               // equipped: it is no longer refundable by the player
 *
 * WHERE IT COMES FROM. The game runs in a sandboxed frame that can see no cookie and send no request as the site. The
 * play shell around it (on the studio's own origin) asks the studio's Worker what the signed-in player owns and
 * answers this module by postMessage, only for THIS game. The Worker decides: an item bought with the studio's own
 * Stripe, paid (the signed webhook said so), not refunded, not ended. A game never sees a card, an email or an order.
 *
 * THE KIDS RULES (the kit's, not the game's to change): on a kids server there is no shop (`open` is false, `kids` is
 * true, `open()` shows "nothing is sold here"); on a beginner or kids server anything with a play advantage counts as
 * NOT owned; on a television `open()` shows only a code to scan and buy on a phone. A game never shows a countdown, a
 * random reward for money, or a buy button on its play button.
 *
 * Without a shell (a game opened as a file, a dev server, a studio with no shop) everything is empty and `open()` does
 * nothing, so the same code runs everywhere. It has no imports and uses only erasable TypeScript.
 * =============================================================================
 */

export const SHOP_VERSION = 1;

export interface ShopState {
  /** The studio sells something in this game, and this room may show it. */
  open: boolean;
  /** A kids server: nothing is sold or shown. */
  kids: boolean;
  /** This is the big screen: `open()` shows a code to buy on a phone. */
  screen: boolean;
}
export type ShopEvent = 'change' | 'closed';

export interface ShopOptions {
  /** Tests and custom shells: where messages go (default: the parent frame). */
  target?: { postMessage: (m: unknown, origin: string) => void } | null;
  /** How long to wait for the shell's first answer before treating the game as having no shop (ms). */
  timeoutMs?: number;
}

export interface Shop {
  /** Resolves once the shell answered (or after `timeoutMs` with no shell: an empty, closed shop). */
  readonly ready: Promise<ShopState>;
  readonly state: ShopState;
  /** Whether the player owns this entitlement key now ("skin:ember", "badge:supporter"). Synchronous, for a render loop. */
  has(key: string): boolean;
  /** Every key the player owns now. */
  entitlements(): string[];
  /** Ask the shell for a fresh answer (the shell also looks again by itself after a purchase). */
  refresh(): Promise<string[]>;
  /** Show the store sheet, at one item if given. Call it from a button the player pressed, never on a timer. */
  open(item?: string): void;
  close(): void;
  /** The player used something (equipped it, played with it): it leaves the player's own refund window. */
  used(key: string): Promise<boolean>;
  on(ev: 'change', fn: (owns: string[]) => void): () => void;
  on(ev: 'closed', fn: () => void): () => void;
}

type Msg = Record<string, unknown> & { t?: string; q?: number; ev?: string; ok?: boolean };
const KEY = /^[a-z0-9][a-z0-9_.:-]{0,63}$/;

export function createShop(opts: ShopOptions = {}): Shop {
  const g = globalThis as unknown as { HOMIE_NET?: { shop?: boolean }; parent?: unknown; addEventListener?: typeof addEventListener };
  const inShell = Boolean(g.HOMIE_NET?.shop);
  const target = opts.target !== undefined ? opts.target : (inShell && g.parent && g.parent !== g ? (g.parent as { postMessage: (m: unknown, o: string) => void }) : null);
  const listeners = new Map<string, Set<(x: unknown) => void>>();
  const emit = (ev: string, x: unknown): void => { for (const fn of listeners.get(ev) ?? []) { try { fn(x); } catch { /* the game's */ } } };
  let owns: string[] = [];
  const state: ShopState = { open: false, kids: false, screen: false };
  let seq = 0;
  const waiting = new Map<number, (m: Msg) => void>();
  const send = (m: Record<string, unknown>): Promise<Msg> => {
    if (!target) return Promise.resolve({ ok: false });
    const q = ++seq;
    return new Promise((resolve) => {
      waiting.set(q, resolve);
      try { target.postMessage({ t: 'homie-shop', q, ...m }, '*'); } catch { waiting.delete(q); resolve({ ok: false }); }
      setTimeout(() => { if (waiting.has(q)) { waiting.delete(q); resolve({ ok: false, error: 'timeout' }); } }, 8000);
    });
  };
  const setOwns = (next: unknown): boolean => {
    const list = Array.isArray(next) ? next.map(String).filter((k) => KEY.test(k)) : [];
    const before = owns.slice().sort().join(',');
    owns = list;
    return list.slice().sort().join(',') !== before;
  };
  if (target && g.addEventListener) {
    g.addEventListener('message', (e: MessageEvent) => {
      const m = e.data as Msg;
      if (!m || typeof m !== 'object' || m.t !== 'homie-shop') return;
      if (typeof m.q === 'number' && waiting.has(m.q)) { const r = waiting.get(m.q)!; waiting.delete(m.q); r(m); return; }
      if (m.ev === 'owns') { if (setOwns(m.owns)) emit('change', owns.slice()); }
      if (m.ev === 'closed') emit('closed', undefined);
    });
  }
  const ready: Promise<ShopState> = target
    ? Promise.race([
      send({ op: 'hello', v: SHOP_VERSION }).then((m) => {
        state.open = Boolean(m.ok && m.open); state.kids = Boolean(m.kids); state.screen = Boolean(m.screen);
        if (setOwns(m.owns)) emit('change', owns.slice());
        return { ...state };
      }),
      new Promise<ShopState>((r) => setTimeout(() => r({ ...state }), opts.timeoutMs ?? 4000)),
    ])
    : Promise.resolve({ ...state });

  const shop: Shop = {
    ready,
    get state() { return { ...state }; },
    has: (key) => owns.includes(String(key)),
    entitlements: () => owns.slice(),
    refresh: async () => { const m = await send({ op: 'owns' }); if (m.ok && setOwns(m.owns)) emit('change', owns.slice()); return owns.slice(); },
    open: (item) => { void send({ op: 'open', ...(typeof item === 'string' ? { item } : {}) }); },
    close: () => { void send({ op: 'close' }); },
    used: async (key) => (KEY.test(String(key)) && owns.includes(String(key)) ? Boolean((await send({ op: 'used', key })).ok) : false),
    on: ((ev: ShopEvent, fn: (x: unknown) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
      return () => { listeners.get(ev)?.delete(fn); };
    }) as Shop['on'],
  };
  return shop;
}
