/** Local T2 recovery proof. Start studio dev with HOMIE_PREVIEW=1, then:
 * node packages/studio/test/rooms-restarts.mjs http://127.0.0.1:8792 200
 * Each trial uses eight socket players and a fresh room: consecutive short runs in one room deliberately trip
 * the restore-loop breaker. This measures real ctx.abort(), SQLite recovery and reconnects, not browser reloads
 * or Cloudflare's remote output gate. No credentials are read. A remote Preview requires the explicit --preview flag.
 */
import assert from 'node:assert/strict';
import { botClient, socketUrl, chaseCoins } from './bot-client.mjs';

const origin = process.argv[2] ?? 'http://127.0.0.1:8792';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname) || process.argv.includes('--preview'), 'remote runs require an explicit Preview');
const count = Number(process.argv[3] ?? 200);
assert.ok(Number.isInteger(count) && count > 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36);
const times = [];
let worstLoss = 0; let verified = 0;

async function trial(n) {
  const room = `restart-${stamp}-${n}`;
  const url = await socketUrl(origin, 'coin-dash', room);
  const history = new Map();
  class RecordingSocket extends WebSocket {
    constructor(url) { super(url); this.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.t === 'snap') history.set(m.k, m); }); }
  }
  const bots = Array.from({ length: 8 }, (_, i) => botClient({ url, name: `Bot ${i}`, steer: chaseCoins(), WebSocketImpl: RecordingSocket }));
  const back = [];
  try {
    await Promise.all(bots.map((b) => b.ready));
    await sleep(1200 + (n * 137) % 1000);
    const before = bots.map((b) => b.snap).sort((a, b) => b.k - a.k)[0];
    const start = performance.now();
    assert.equal((await fetch(`${origin}/coin-dash/__restart?room=${room}`, { method: 'POST' })).status, 200);
    const watchdog = setTimeout(() => { bots.forEach((b) => b.close()); back.forEach((b) => b.close()); }, 10_000);
    let first = null;
    try {
      await Promise.all(bots.map(async (old) => {
        while (!old.closed && performance.now() - start < 5000) await sleep(5);
        assert.ok(old.closed, 'ctx.abort closes each socket');
        await sleep(Math.random() * 2000);
        const b = botClient({ url, name: old.name, hello: { token: old.token }, steer: chaseCoins() }); back.push(b);
        await b.ready;
        const restored = b.welcome.snap;
        if (!first || restored.k < first.k) first = restored;
        while ((!b.snap || b.snap.e <= before.e || b.snap.k <= restored.k) && performance.now() - start < 10_000) await sleep(5);
        assert.ok(b.snap?.e > before.e && b.snap.k > restored.k, 'back means a new epoch has advanced');
        assert.equal(b.seat, old.seat); assert.ok(b.epoch > before.e);
        times.push(performance.now() - start);
      }));
      const loss = Math.max(0, before.k - first.k);
      assert.ok(loss <= 20, `lost ${loss} ticks, more than one second`);
      worstLoss = Math.max(worstLoss, loss);
      const prior = history.get(first.k);
      assert.ok(prior, `missing observed tick ${first.k}`);
      assert.deepEqual(first.d, prior.d, 'every entity, score and position matches the observed saved tick');
      verified += 1;
    } finally { clearTimeout(watchdog); }
  } finally { bots.forEach((b) => b.close()); back.forEach((b) => b.close()); }
}

for (let n = 0; n < count; n += 4) {
  await Promise.all(Array.from({ length: Math.min(4, count - n) }, (_, j) => trial(n + j)));
  if ((n + 4) % 20 === 0) console.log(JSON.stringify({ restarts: Math.min(n + 4, count), players: times.length, worstLossMs: worstLoss * 50 }));
}
times.sort((a, b) => a - b);
const within = times.filter((ms) => ms <= 3000).length / times.length;
const report = { restarts: verified, players: times.length, within3s: within, p95Ms: Math.round(times[Math.ceil(times.length * 0.95) - 1]), maxMs: Math.round(times.at(-1)), worstLossMs: worstLoss * 50 };
console.log(JSON.stringify(report));
assert.ok(within >= 0.95);
