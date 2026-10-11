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

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!env.PROBE_KEY || request.headers.get('x-probe-key') !== env.PROBE_KEY) return new Response('not found', { status: 404 });
    if (url.pathname === '/hello') return Response.json({ ok: true, probe: 1 });
    const origin = url.searchParams.get('origin'), game = url.searchParams.get('game') ?? 'crowd-circuit', room = url.searchParams.get('room');
    const from = Number(url.searchParams.get('from') ?? 0), count = Math.min(5, Math.max(1, Number(url.searchParams.get('count') ?? 5)));
    const joinAt = Number(url.searchParams.get('joinAt')), rampMs = Number(url.searchParams.get('rampMs') ?? 50);
    const measureAt = Number(url.searchParams.get('measureAt')), endAt = Number(url.searchParams.get('endAt'));
    if (!/^https:\/\/[a-z0-9.-]+$/.test(origin ?? '') || !/^[A-Za-z0-9_-]{1,40}$/.test(room ?? '') || ![joinAt, measureAt, endAt].every(Number.isFinite) || endAt - joinAt > 900_000) return new Response('bad request', { status: 400 });
    const { readable, writable } = new TransformStream(), writer = writable.getWriter(), encoder = new TextEncoder();
    const line = (o) => writer.write(encoder.encode(JSON.stringify(o) + '\n')).catch(() => {});
    const tallies = { ack: new Tally(), gaps: new Tally(), loops: new Tally() }, players = [];
    const run = async () => {
      const join = async (i) => {
        const key = crypto.randomUUID().replaceAll('-', '');
        const player = { socket: null, client: null };
        player.client = crowdClient({ index: i, game, tallies, send: (text) => { try { player.socket?.send(text); } catch { /* closing */ } } });
        players.push(player);
        try {
          await sleep(Math.max(0, joinAt + i * rampMs - Date.now()));
          // As a browser arrives: the game's page says where its socket is.
          const page = await fetch(`${origin}/${game}/__game/?room=${encodeURIComponent(room)}&device=desk&want=play&b=${key}`);
          const match = (await page.text()).match(/window\.HOMIE_NET=(\{[^<]+\})<\/script>/);
          if (!page.ok || !match) throw new Error(`bootstrap HTTP ${page.status}`);
          const cfg = JSON.parse(match[1]);
          const answer = await fetch(cfg.url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket', Origin: 'null' } });
          const socket = answer.webSocket;
          if (!socket) throw new Error(`upgrade HTTP ${answer.status}`);
          socket.accept(); player.socket = socket;
          socket.addEventListener('message', (event) => { if (typeof event.data === 'string') player.client.message(event.data, Date.now()); });
          socket.addEventListener('close', (event) => player.client.close(event.code, event.reason));
          socket.addEventListener('error', () => player.client.close(1006, 'error'));
          player.client.open(Date.now());
        } catch (error) { player.client.c.errors.push(String(error?.message ?? error).slice(0, 120)); player.client.close(0, 'never connected'); }
      };
      const joins = Promise.all(Array.from({ length: count }, (_, n) => join(from + n)));
      let measuring = false, lastLine = 0, lastTick = Date.now(), worstLag = 0;
      while (Date.now() < endAt) {
        const now = Date.now();
        // This Worker's own lateness: how long past ten milliseconds its timer came back.
        worstLag = Math.max(worstLag, now - lastTick - 10); lastTick = now;
        if (!measuring && now >= measureAt) { measuring = true; for (const p of players) p.client.measure(); }
        for (const p of players) p.client.tick(now);
        if (now - lastLine >= 5000) { lastLine = now; await line({ t: 'sample', at: now, from, joined: players.filter((p) => p.client.c.first !== null).length, open: players.filter((p) => p.socket && !p.client.c.closed).length, measuring }); }
        await sleep(10);
      }
      await joins;
      const facts = players.map((p) => p.client.facts());
      for (const p of players) { try { p.socket?.close(1000, 'probe step complete'); } catch { /* gone */ } }
      await line({ t: 'final', from, count, colo: request.cf?.colo ?? null, measuredMs: Math.max(0, endAt - measureAt), worstTimerLagMs: worstLag, players: facts, tallies: { ack: tallies.ack.bins, gaps: tallies.gaps.bins, loops: tallies.loops.bins } });
    };
    ctx.waitUntil(run().catch((error) => line({ t: 'failed', from, error: String(error?.stack ?? error).slice(0, 400) })).finally(() => writer.close().catch(() => {})));
    return new Response(readable, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
  },
};
