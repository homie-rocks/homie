/**
 * The in-Cloudflare crowd probe: a Worker of its own that plays a few simulated players against a studio from
 * inside Cloudflare's network, so a trial can tell what the studio's servers can do from what one home connection
 * and one busy computer can carry. NOT part of a studio: nothing in a studio's Worker imports it. Deploy it beside
 * the studio only for a trial (`lib/crowd-probe/README.md`), and delete it after.
 *
 * One request plays up to FIVE players (a Worker may hold six connections open at once) for as long as the caller
 * keeps reading, and answers with a line of JSON every five seconds and a last one with everything it measured.
 * `lib/crowd-cloud.mjs` opens as many requests as the step needs and adds them up.
 *
 * It proves the room and its Gates at that many players. It says nothing of the last hop to a real player.
 */
import { Tally, crowdClient } from './client.mjs';
import { referenceWork } from './reference-work.mjs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.PROBE_KEY || request.headers.get('x-probe-key') !== env.PROBE_KEY) return new Response('not found', { status: 404 });
    if (url.pathname === '/hello') return Response.json({ ok: true, probe: 2 });
    if (url.pathname === '/calibrate') {
      // The reference work, `rounds` times, in one event. This Worker cannot time it: its clock stands still while
      // its code runs and reads a timer's due time when the timer fires, so whoever asked holds the stopwatch (the
      // time this request took, less the time one with no rounds took). `own` is what this Worker's clock said the
      // rounds took, across an awaited timer, for the record of what such a figure is worth.
      const rounds = Math.min(20, Math.max(0, Math.floor(Number(url.searchParams.get('rounds') ?? 0)) || 0));
      await sleep(2);
      const at = Date.now(); let check = 0;
      for (let i = 0; i < rounds; i += 1) check = referenceWork();
      await sleep(1);
      return Response.json({ ok: true, colo: request.cf?.colo ?? null, rounds, check, own: Date.now() - at });
    }
    const origin = url.searchParams.get('origin'), game = url.searchParams.get('game') ?? 'crowd-circuit', room = url.searchParams.get('room');
    const from = Number(url.searchParams.get('from') ?? 0), count = Math.min(5, Math.max(1, Number(url.searchParams.get('count') ?? 5)));
    const joinAt = Number(url.searchParams.get('joinAt')), rampMs = Number(url.searchParams.get('rampMs') ?? 50);
    const measureAt = Number(url.searchParams.get('measureAt')), endAt = Number(url.searchParams.get('endAt'));
    // `compress=1`: offer permessage-deflate as a browser does, so the studio's Gates compress for these players too.
    const compress = url.searchParams.get('compress') === '1';
    // `slowEvery=K`: every Kth player is a slow one (so every Gate holds some, beside healthy players). Each takes what it is sent at six frames a second, in
    // order, as a connection that carries no more does: it falls behind, says so (the tick it holds), and the
    // question is what that costs the players beside it. (A Worker cannot slow a socket's reads; a real slow
    // connection is played from a computer: `crowd-load.mjs --slow-every`.)
    const slowEvery = Math.max(0, Math.floor(Number(url.searchParams.get('slowEvery') ?? 0)) || 0);
    if (!/^https:\/\/[a-z0-9.-]+$/.test(origin ?? '') || !/^[A-Za-z0-9_-]{1,40}$/.test(room ?? '') || ![joinAt, measureAt, endAt].every(Number.isFinite) || endAt - joinAt > 900_000) return new Response('bad request', { status: 400 });
    const { readable, writable } = new TransformStream(), writer = writable.getWriter(), encoder = new TextEncoder();
    const line = (o) => writer.write(encoder.encode(JSON.stringify(o) + '\n')).catch(() => {});
    const tallies = { ack: new Tally(), gaps: new Tally(), loops: new Tally() }, players = [];
    // A slow player's own figures, apart: its acknowledgements are late by what it is.
    const slowTallies = { ack: new Tally(), gaps: new Tally(), loops: new Tally() };
    const run = async () => {
      const join = async (i) => {
        const key = crypto.randomUUID().replaceAll('-', '');
        const player = { socket: null, client: null, compressed: false, slow: slowEvery > 0 && i % slowEvery === 0, held: [], nextAt: 0 };
        player.client = crowdClient({ index: i, game, tallies: player.slow ? slowTallies : tallies, send: (text) => { try { player.socket?.send(text); } catch { /* closing */ } } });
        players.push(player);
        try {
          await sleep(Math.max(0, joinAt + i * rampMs - Date.now()));
          // As a browser arrives: the game's page says where its socket is.
          const page = await fetch(`${origin}/${game}/__game/?room=${encodeURIComponent(room)}&device=desk&want=play&b=${key}`);
          const match = (await page.text()).match(/window\.HOMIE_NET=(\{[^<]+\})<\/script>/);
          if (!page.ok || !match) throw new Error(`bootstrap HTTP ${page.status}`);
          const cfg = JSON.parse(match[1]);
          const answer = await fetch(cfg.url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket', Origin: 'null', ...(compress ? { 'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits' } : {}) } });
          player.compressed = /permessage-deflate/.test(answer.headers?.get?.('sec-websocket-extensions') ?? '');
          const socket = answer.webSocket;
          if (!socket) throw new Error(`upgrade HTTP ${answer.status}`);
          socket.accept(); player.socket = socket;
          socket.addEventListener('message', (event) => { if (typeof event.data !== 'string') return; if (player.slow) player.held.push(event.data); else player.client.message(event.data, Date.now()); });
          socket.addEventListener('close', (event) => player.client.close(event.code, event.reason));
          socket.addEventListener('error', () => player.client.close(1006, 'error'));
          player.client.open(Date.now());
        } catch (error) { player.client.c.errors.push(String(error?.message ?? error).slice(0, 120)); player.client.close(0, 'never connected'); }
      };
      const joins = Promise.all(Array.from({ length: count }, (_, n) => join(from + n)));
      let measuring = false, lastLine = 0, lastWhole = 0, lastTick = Date.now(), worstLag = 0;
      // Everything measured so far: the last line of a step, and every thirty seconds on the way, so a request that
      // is cut off before its end has still said most of what it saw.
      const whole = (t, now) => ({ t, from, count, colo: request.cf?.colo ?? null, measuredMs: Math.max(0, Math.min(now, endAt) - measureAt), worstTimerLagMs: worstLag, players: players.map((p) => ({ ...p.client.facts(), compressed: p.compressed, slow: p.slow, ...(p.slow ? { waiting: p.held.length } : {}) })), tallies: { ack: tallies.ack.bins, gaps: tallies.gaps.bins, loops: tallies.loops.bins }, slowAck: slowTallies.ack.bins });
      while (Date.now() < endAt) {
        const now = Date.now();
        // This Worker's own lateness: how long past ten milliseconds its timer came back.
        worstLag = Math.max(worstLag, now - lastTick - 10); lastTick = now;
        if (!measuring && now >= measureAt) { measuring = true; for (const p of players) p.client.measure(); }
        for (const p of players) { if (p.slow && p.held.length && now >= p.nextAt) { p.nextAt = now + 160; p.client.message(p.held.shift(), now); } p.client.tick(now); }
        if (measuring && now - lastWhole >= 30000) { lastWhole = now; await line(whole('partial', now)); }
        if (now - lastLine >= 5000) { lastLine = now; await line({ t: 'sample', at: now, from, joined: players.filter((p) => p.client.c.first !== null).length, open: players.filter((p) => p.socket && !p.client.c.closed).length, measuring }); }
        await sleep(10);
      }
      await Promise.race([joins, sleep(5000)]);
      const last = whole('final', endAt);
      for (const p of players) { try { p.socket?.close(1000, 'probe step complete'); } catch { /* gone */ } }
      await line(last);
    };
    ctx.waitUntil(run().catch((error) => line({ t: 'failed', from, error: String(error?.stack ?? error).slice(0, 400) })).finally(() => writer.close().catch(() => {})));
    return new Response(readable, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
  },
};
