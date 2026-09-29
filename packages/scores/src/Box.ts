/**
 * THE ONE WAY A RUNNING GAME TALKS TO THE HOMIE HOST IT IS RUNNING ON.
 *
 * One racing game hand-rolled this: an origin test, a `fetch` to
 * `/__homie/call`, a `try` around it, `keepalive: true`. Forty lines of
 * transport sitting in the one folder that is supposed to hold only what makes
 * that game itself — and it was the ONLY copy, which a search for duplicated
 * code cannot find. It is here now, once, and it answers honestly instead of
 * silently.
 *
 * ## Honest, not silent, and the difference is the whole file
 *
 * The hand-rolled version returned `undefined` and swallowed everything: on a
 * plain Vite dev server it skipped the POST, on a package origin with no session
 * it 409'd into a `catch`, and the game could not tell those apart from a call
 * that worked. A score that was never recorded and a score that was recorded
 * must never render as the same colour, so every method here answers
 * `{ ok } | { refused }` and `refused` is a sentence a person could act on.
 *
 * ## `offBox` is not a stub
 *
 * A game opened in a browser tab on a laptop is a legitimate state — that is how
 * every one of these games is developed — and it has no host. `offBox()` refuses
 * every call with one plain sentence and refuses IMMEDIATELY, so a results
 * screen shows *"no leaderboard here"* rather than a spinner that never resolves.
 */

/** What the host answers on `/__homie/call`. */
export type CallResult =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly error: string };

export interface Box {
  /**
   * Invoke one tool by its contract name. The capability gate has already run
   * on the far side; a denial arrives here as `{ ok: false, error }`, which is
   * the same shape as a network failure ON PURPOSE — the caller's job is to show
   * the room a sentence, not to classify why the host said no.
   */
  call(name: string, args: Record<string, unknown>): Promise<CallResult>;
}

/**
 * Post to `/__homie/call` on this page's own origin.
 *
 * Same-origin only, and that is a security property rather than a convenience:
 * a package origin is what the host authenticated the session against, so
 * there is no host to configure and nothing a page could point somewhere else.
 */
export function homieBox(o: { fetch?: typeof globalThis.fetch; path?: string } = {}): Box {
  const doFetch = o.fetch ?? globalThis.fetch?.bind(globalThis);
  const path = o.path ?? '/__homie/call';
  if (!doFetch) return offBox('this runtime has no fetch, so there is no way to reach the box');

  let id = 0;
  return {
    async call(name, args) {
      id += 1;
      let res: Response;
      try {
        res = await doFetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ t: 'call', id, name, args }),
          // A finish is submitted at the exact moment a results screen may
          // navigate away. Without this the request is cancelled and the score
          // is lost with nothing anywhere saying so.
          keepalive: true,
        });
      } catch (err) {
        return { ok: false, error: `${name}: the box did not answer — ${(err as Error).message}` };
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return { ok: false, error: `${name}: the box answered ${res.status} with something that is not JSON` };
      }
      if (!body || typeof body !== 'object') {
        return { ok: false, error: `${name}: the box answered ${res.status} with something that is not a result` };
      }
      const b = body as Record<string, unknown>;
      if (b['ok'] === true) return { ok: true, output: b['output'] };
      const why = typeof b['error'] === 'string' ? b['error'] : `the box answered ${res.status}`;
      return { ok: false, error: `${name}: ${why}` };
    },
  };
}

/** No host. Every call refused, immediately, with the reason given once. */
export function offBox(why: string): Box {
  return { call: async (name) => ({ ok: false, error: `${name}: ${why}` }) };
}

/**
 * Is this page being served BY a Homie host?
 *
 * A game under a plain Vite dev server is not, and posting there 404s into the
 * console on every finish. This is the same test the hand-rolled version made,
 * kept because it is right, and it is now the ONLY copy of it.
 *
 * It deliberately does NOT try to prove a session exists. That is a fact about
 * the host at this instant and a cached answer would outlive it. Ask by
 * calling; the refusal is the answer.
 */
export function servedByBox(loc: { hostname: string } | null = globalThis.location ?? null): boolean {
  if (!loc) return false;
  try {
    return /\.homie\.rocks$/.test(loc.hostname) || loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * The host if there is one, an honest refusal if there is not.
 *
 * One call at start-up, and every consumer below this line stops needing to
 * know which world it is in.
 */
export function boxForThisPage(o: { fetch?: typeof globalThis.fetch; path?: string } = {}): Box {
  return servedByBox()
    ? homieBox(o)
    : offBox('this page is not being served by a Homie box, so there is nothing to record against');
}
