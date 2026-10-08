/** Local deploy proof against a disposable Coin Dash studio running `homie-studio dev` with Preview enabled.
 * node packages/studio/test/rooms-deploys.mjs http://127.0.0.1:8792 .wrangler/slice-2-studio 20
 * Builds twenty different handler implementations. Wrangler's file watcher replaces the real local Worker;
 * old socket players must be refused and their replacements reclaim the saved match. Browser page reloads and
 * Cloudflare deployment timing require separate proof. This edits only the supplied studio, restoring its source.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { botClient, socketUrl, chaseCoins } from './bot-client.mjs';

const origin = process.argv[2] ?? 'http://127.0.0.1:8792';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname));
assert.ok(process.argv[3], 'name a disposable studio');
const studio = resolve(process.argv[3]); const count = Number(process.argv[4] ?? 20);
const spacing = Number(process.argv[5] ?? 10000);
assert.ok(Number.isFinite(spacing) && spacing >= 1000);
assert.ok(Number.isInteger(count) && count > 0);
const path = resolve(studio, 'games/coin-dash/src/rules.ts'); const original = readFileSync(path, 'utf8');
assert.ok(original.includes('self.score += 1;'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString(36); const times = []; let compared = 0;
const meta = () => JSON.parse(readFileSync(resolve(studio, 'site/dist/games.json'), 'utf8')).games.find((g) => g.id === 'coin-dash');
const room = `deploy-${stamp}`;
let downAt = null; const seen = new Map();
class RecordingSocket extends WebSocket {
  constructor(url) { super(url); this.addEventListener('close', () => { downAt ??= performance.now(); }); this.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.t === 'snap') seen.set(m.k, m); }); }
}
let url = await socketUrl(origin, 'coin-dash', room);
let bots = Array.from({ length: 8 }, (_, i) => botClient({ url, name: `Bot ${i}`, steer: chaseCoins(), WebSocketImpl: RecordingSocket }));
try {
  await Promise.all(bots.map((b) => b.ready));
  let nextUpdate = performance.now() + spacing;
  for (let n = 0; n < count; n++) {
    await sleep(Math.max(0, nextUpdate - performance.now())); nextUpdate += spacing; downAt = null;
    const beforeBuild = meta().room;
    writeFileSync(path, original.replace('self.score += 1;', `self.score += ${n + 2};`));
    // The dev server is the sole builder. Starting another build races its generated rules files.
    const limit = performance.now() + 30_000;
    while (meta().room.build === beforeBuild.build && performance.now() < limit) await sleep(100);
    const afterBuild = meta().room;
    assert.equal(afterBuild.stateHash, beforeBuild.stateHash); assert.notEqual(afterBuild.build, beforeBuild.build);
    while (!bots.every((b) => b.closed) && performance.now() < limit) await sleep(20);
    assert.ok(bots.every((b) => b.closed), 'replacement closes all sockets');
    const old = botClient({ url, hello: { token: bots[0].token } });
    try { await assert.rejects(old.ready); assert.equal(old.errors[0]?.code, 'stale'); } finally { old.close(); }
    let nextUrl;
    do { nextUrl = await socketUrl(origin, 'coin-dash', room); if (new URL(nextUrl).searchParams.get('gv') === afterBuild.build) break; await sleep(100); } while (performance.now() < limit);
    assert.equal(new URL(nextUrl).searchParams.get('gv'), afterBuild.build);
    const back = bots.map((b) => botClient({ url: nextUrl, name: b.name, hello: { token: b.token }, steer: chaseCoins(), WebSocketImpl: RecordingSocket }));
    const history = new Map(seen);
    try {
      await Promise.all(back.map(async (b, i) => {
        await b.ready; assert.equal(b.seat, bots[i].seat); assert.ok(b.epoch > bots[i].epoch);
        while ((!b.snap || b.snap.k <= b.welcome.snap.k) && performance.now() < limit) await sleep(5);
        assert.ok(b.snap.k > b.welcome.snap.k, 'the recovered room ticks'); times.push(performance.now() - downAt);
      }));
      const snap = back.map((b) => b.welcome.snap).sort((a, b) => a.k - b.k)[0];
      // A replacing Worker can save its last tick after its sockets have closed.
      // Compare every observed saved tick, and bound rollback even when that last frame never arrived.
      const lastObserved = Math.max(...history.keys());
      assert.ok(snap.k >= lastObserved - 20, `deploy rolled back more than a second: ${lastObserved} to ${snap.k}`);
      if (history.has(snap.k)) { assert.deepEqual(snap.d, history.get(snap.k).d); compared++; }
      else assert.ok(snap.k > lastObserved, `missing an earlier observed tick ${snap.k}`);
      console.log(JSON.stringify({ deploy: n + 1, tick: snap.k, eightSeatsReturned: true }));
    } catch (error) { back.forEach((b) => b.close()); throw error; }
    bots.forEach((b) => b.close()); bots = back; url = nextUrl;
  }
} finally { bots.forEach((b) => b.close()); writeFileSync(path, original); }
times.sort((a, b) => a - b);
const within = times.filter((t) => t <= 5000).length / times.length;
console.log(JSON.stringify({ deploys: count, comparedSavedFrames: compared, players: times.length, within5s: within, p95Ms: Math.round(times[Math.ceil(times.length * 0.95) - 1]), maxMs: Math.round(times.at(-1)) }));
assert.ok(within >= 0.95);
