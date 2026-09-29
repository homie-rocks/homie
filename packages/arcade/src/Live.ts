/**
 * ============================================================================
 *  @homie-rocks/arcade/Live.ts — the feed, over a Homie host's party bridge.
 * ============================================================================
 *
 *  A Homie host mounts two routes on a package's own origin:
 *
 *    GET  /__homie/session   an SSE stream of the bridge's events
 *    POST /__homie/call      one tool call, capability-gated by the manifest
 *
 *  This file is the eighty lines that turn those into a `SeatFeed`. It is the
 *  ONLY file in this package that knows the bridge's wire shape, which is the
 *  point: `Table.ts` speaks `FeedEvent`, so a change on the bridge side is one
 *  file's problem and not four games'.
 *
 *  ## IT ASKS; IT DOES NOT REMEMBER
 *
 *  A cache of a fact will outlive the fact and then answer for it. This file
 *  caches nothing about the room. Every roster comes from a `hello` the bridge
 *  sent, and a reconnect re-sends the whole roster on purpose so a table that
 *  missed four seconds of a contended access point is corrected rather than
 *  confident.
 *
 *  ## THERE IS NO HOST HALF THE TIME AND THAT IS A LEGITIMATE STATE
 *
 *  Every one of these games is a web page that plays standalone in a browser,
 *  on a phone, independent of Homie. A boot probe starts all eight of the
 *  games this was extracted from that way, with no host anywhere.
 *
 *  So `/__homie/session` 404s on a Vite dev server, and that must be QUIET and
 *  must not be reported as an empty room. `Table.heard` stays false, the game
 *  keeps its keyboard, and `attention()` returns the fail-towards-the-room
 *  default. The one thing this file must never do is emit an empty roster on a
 *  failed connection — that is *"we could not measure it"* rendered as *"we
 *  measured it and the room is empty"*, and in a game that dims for an empty
 *  room it would dim a screen in front of people.
 * ============================================================================
 */

import type { FeedEvent, SeatFeed, SeatPerson } from './Table.ts';
import type { SeatId } from './Roles.ts';

/** Where the bridge is mounted. Not configurable: it is the host's path. */
export const SESSION_PATH = '/__homie/session';
export const CALL_PATH = '/__homie/call';

/**
 * The reconnect ladder, milliseconds.
 *
 * The same shape the host's phone pad bridge settled on — fast at first
 * because a LAN hiccup is usually over in a frame or two, then backing off so a package that is genuinely not the running session
 * does not hammer a 409 forever.
 */
const LADDER = [200, 400, 800, 1600, 3000, 4000];

/** The minimum the object below reads out of the browser. See `SeatFeed`. */
interface LiveHost {
  EventSource: typeof EventSource;
  fetch: typeof fetch;
}

/**
 * A feed over this package's own origin.
 *
 * `host` exists so a harness can drive this file without a browser. It is not
 * a convenience: a synthetic client that impersonates the real one destroys
 * the ability to tell them apart, and the alternative here — a global
 * `EventSource` monkey-patch — is exactly that impersonation.
 */
export function liveFeed(host: LiveHost = globalThis as unknown as LiveHost): SeatFeed {
  const handlers = new Set<(ev: FeedEvent) => void>();
  let es: EventSource | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /**
   * SOME ORIGINS ARE NOT A HOST AND NEVER WILL BE, AND THEY SAY SO.
   *
   * `retry()`'s ladder exists because a host may come up later, which is
   * true on a dev server and true on a phone on the LAN. It is NOT true of a
   * public page on homie.rocks: that origin has no bridge and cannot grow
   * one. It answers `{"error":"not-a-homie"}` with public CORS so this file
   * can tell the two apart, and once it has, knocking again is pure waste.
   */
  let closedForGood = false;

  const emit = (ev: FeedEvent): void => {
    for (const fn of [...handlers]) {
      // One game's bad handler must not stop the next event. Same rule the
      // pad bridge and the party bridge both keep.
      try { fn(ev); } catch (err) { console.warn('[arcade] feed handler', err); }
    }
  };

  const retry = (): void => {
    if (closedForGood) return;
    const wait = LADDER[Math.min(attempt, LADDER.length - 1)]!;
    attempt += 1;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(knock, wait);
    // A reconnect ladder must not be a reason a process cannot exit. In a
    // browser `setTimeout` returns a number and this is absent; in Node — a
    // harness or a boot probe — an un-unref'd ladder holds the process open
    // forever and the run has to be killed. Same call and the same reason as
    // the bridge's own heartbeat.
    (timer as { unref?: () => void }).unref?.();
  };

  /**
   * Read the refusal body, if there is one. A `not-a-homie` answer is the only
   * thing that stops this file permanently, so it is matched exactly and
   * anything unreadable is treated as "keep knocking" — a parse failure must
   * never be able to silence a real host.
   */
  const saysNotAHomie = async (res: Response): Promise<boolean> => {
    try {
      if (!(res.headers?.get('content-type') ?? '').includes('application/json')) return false;
      const body = await res.json() as { error?: unknown };
      return body?.error === 'not-a-homie';
    } catch { return false; }
  };

  /**
   * KNOCK BEFORE OPENING, AND KNOCK ON THE ONE DOOR THAT IS ALREADY EXPECTED.
   *
   * Opening an `EventSource` at a path that 404s produces a console error on
   * every attempt, and a boot probe that counts console errors excludes
   * exactly two URLs, `/favicon.ico` and `/__homie/call` (matching on Chrome's
   * generic 404 TEXT would swallow a missing module). So a package that opened
   * `/__homie/session` on a dev server would fail the boot gate for every
   * game, and the fix would have been to widen a shared harness's exclusion
   * list on behalf of one package. That is the wrong direction.
   *
   * A GET on `/__homie/call` answers this exactly, with no side effects at all:
   *
   *   405  the bridge is mounted and told us calls are POSTed. A room.
   *   409  a host is here and this package is not the running session.
   *        Connecting would be pointless; keep knocking.
   *   404 / network   there is no host. A standalone page. Keep knocking on
   *        the ladder, because *"ask, do not remember"* — a knock cached at
   *        boot is a stale fact, and a host may come up later.
   *
   * A GET is used rather than a POST precisely because `serveCall` refuses it
   * before parsing anything: no counter moves, no log line is written, and the
   * bridge cannot tell a knock from a mistake because there is nothing to tell.
   */
  function knock(): void {
    if (closedForGood) return;
    void host.fetch(CALL_PATH, { method: 'GET' })
      .then(async (res) => {
        // THE 405 PATH IS UNCHANGED AND READS NO BODY. Reading the refusal
        // first cost an extra microtask before `open()`, and a harness that
        // answers `{ status: 405 }` with no `headers` at all and then reaches
        // straight for the stream failed on `wire.onmessage` of undefined. A bridge that is there should not
        // wait on a body to find out, and a refusal is only ever on the road
        // that was about to back off anyway.
        if (res.status === 405) { open(); return; }
        if (await saysNotAHomie(res)) {
          closedForGood = true;
          if (timer !== null) { clearTimeout(timer); timer = null; }
          return;
        }
        retry();
      })
      .catch(() => { retry(); });
  }

  function open(): void {
    let stream: EventSource;
    try {
      stream = new host.EventSource(SESSION_PATH);
    } catch {
      // No EventSource at all, or a URL the browser refused. Not a room.
      return;
    }
    es = stream;
    stream.onopen = () => { attempt = 0; };
    stream.onerror = () => {
      // readyState 2 is CLOSED: the browser has given up and will not retry.
      // Anything else is its own retry in progress and must be left alone, or
      // two ladders race and the host sees double.
      //
      // THIS GOES THROUGH `retry()`, NOT STRAIGHT TO `knock()`. It used to
      // call `knock()` here, which meant a knock that was answered 405 by
      // something that is not a bridge produced knock → open → error → knock
      // with no wait anywhere in it: the ladder above was unreachable and the
      // loop ran as fast as the network allowed. MEASURED on homie.rocks
      // 2026-09-13..15: 98,642 requests, 99.88% of them 4xx, one page making
      // 5.5/s.
      // A stream that closed is exactly what the ladder is for.
      if (stream.readyState === 2) { try { stream.close(); } catch { /* gone */ } retry(); }
    };
    stream.onmessage = (msg: MessageEvent) => {
      let raw: unknown;
      try { raw = JSON.parse(String(msg.data)); } catch { return; }
      const ev = translate(raw);
      if (ev) emit(ev);
    };
  }

  knock();

  return {
    on(handler) {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
    show(seat: SeatId, html: string) {
      /*
       * THE `mute-surfaces` FAULT IS NOT HERE.
       *
       * It was here first, and a seat probe came back 39 pass / 0 fail with
       * nothing failed by the fault — a fault that injected nothing, reported
       * nothing, and would have been signed off as a validated instrument.
       * The probe drives `Local.ts`'s feed, so it never enters this function
       * at all: the anchor was in a file the measurement does not execute.
       *
       * It lives in `Table.#seat` now, which is where the OUTCOME is produced
       * — a placed seat either has a document or does not, whatever transport
       * carried it. Muting this fetch would have been a fault about the wire,
       * and the wire is the host bridge's to measure.
       */
      void host.fetch(CALL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'phone.show', args: { seat, view: { content: html } } }),
      }).then(async (res) => {
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (body.ok === false) console.warn(`[arcade] seat ${String(seat)} was not dressed — ${body.error ?? 'no reason given'}`);
      }).catch((err: Error) => {
        // A refusal is logged and never retried: re-posting a controller would
        // reload a page under somebody's thumb on every hiccup.
        console.warn(`[arcade] seat ${String(seat)} was not dressed — ${err.message}`);
      });
    },
  };

  function translate(raw: unknown): FeedEvent | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (r.t === 'hello') {
      const seats = Array.isArray(r.seats) ? r.seats : [];
      const people: SeatPerson[] = [];
      for (const s of seats) {
        if (!s || typeof s !== 'object') continue;
        const e = s as Record<string, unknown>;
        if (typeof e.seat !== 'number') continue;
        // A public-room reservation remains in the host's seat list while
        // its creator is away. It is an address held for reconnection, not a
        // person in this running game. Feeding it into RoleTable displaces the
        // first real visitor and can later make the absent slot a winner.
        if (e.presence === 'away') continue;
        people.push({
          seat: e.seat,
          name: typeof e.name === 'string' ? e.name : '',
          ...(typeof e.admission === 'string' && e.admission ? { admission: e.admission } : {}),
        });
      }
      return { kind: 'roster', people };
    }
    if (r.t === 'join' && typeof r.seat === 'number') {
      return {
        kind: 'join',
        person: {
          seat: r.seat,
          name: typeof r.name === 'string' ? r.name : '',
          ...(typeof r.admission === 'string' && r.admission ? { admission: r.admission } : {}),
        },
      };
    }
    if (r.t === 'leave' && typeof r.seat === 'number') {
      return { kind: 'leave', seat: r.seat };
    }
    if (r.t === 'answer' && typeof r.seat === 'number' && typeof r.id === 'string') {
      return { kind: 'input', seat: r.seat, id: r.id, value: typeof r.value === 'string' ? r.value : '' };
    }
    if (r.t === 'press' && typeof r.seat === 'number' && typeof r.id === 'string'
      && (r.phase === 'down' || r.phase === 'up')) {
      return { kind: 'input', seat: r.seat, id: r.id, value: r.phase };
    }
    if (r.t === 'bye') return { kind: 'closed' };
    // The bridge forwards declared phone button presses as well as answers.
    // The table/pad resolves the id against this game's declared controls.
    // Clock and host metadata are not controller input.
    return null;
  }
}
