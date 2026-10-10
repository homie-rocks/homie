/** Local capacity experiment: real host + relay, simulated WebSockets, virtual time.
 * No Cloudflare, network latency, browser rendering or Workers billing is measured.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fakeClock, loadGame, writeGame } from './rules-kit.mjs';
import { NetRoom } from '../worker/room.mjs';
import { snapshotDecoder } from '../rules/interest.mjs';

export async function interestWorkload({ seats = 300, ticks = 120, radiusM = 12, measure = false, view = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'homie-interest-'));
  let host;
  try {
    const game = writeGame(dir, 'crowd', {
      rules: `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,entities:{runner:{player:true,fields:{steps:f.u32()},input:{ax:f.i8()},body:{shape:'circle',radius:.4,maxSpeed:2},tick(w,s){s.steps+=1;}}},room:{bots:{keep:0},join(c,p){return {kind:'runner',at:{x:(p.seat%20)*4,y:Math.floor(p.seat/20)*4,z:0}}}}});`,
      move: `import {defineMove} from '@homie-rocks/studio/rules'; export const move=defineMove({runner(b,i,c){b.vel={x:i.ax/127*2,y:0,z:0};b.pos=c.math.add(b.pos,c.math.scale(b.vel,c.dt));}});`,
    });
    const L = await loadGame(dir, game);
    const compiled = L.R.compileRules(L.def, { seats, map: L.R.compileMap({ bounds: { min: [-100,-100], max: [200,200] } }), settings: L.R.roomSettings({ view: { radiusM, ...view }, budget: { tick: 5_000_000 } }).settings });
    assert.equal(compiled.seats, seats);
    const clock = fakeClock();
    const room = new NetRoom({ code: 'crowd', rules: true, maxPlayers: seats, tickHz: 20, perIp: seats, now: clock.now });
    host = L.H.createHost({ game: 'crowd', compiled, clock, random: () => .375, send: (m, text) => room.hostFrame(m, text) });
    room.setServerHost(host);
    let collecting = false, bytes = 0, snapshots = 0, peakVisible = 0;
    const clients = [];
    for (let seat = 0; seat < seats; seat++) {
      const decoder = snapshotDecoder();
      const client = { seat: null, latest: null, decoder, bytes: 0 };
      const h = room.attach({ send(text) {
        if (collecting) { bytes += Buffer.byteLength(text); client.bytes += Buffer.byteLength(text); }
        const m = JSON.parse(text);
        if (m.t === 'welcome') { client.seat = m.seat; if (m.snap) client.latest = decoder.decode(m.snap); }
        if (m.t === 'snap') { client.latest = decoder.decode(m); assert.ok(client.latest, 'ordered socket always has its baseline'); snapshots++;
          peakVisible = Math.max(peakVisible, client.latest.d[1].length);
        }
      }, close(code, why) { throw new Error(`client closed ${code}: ${why}`); }, buffered: () => 0, ip: `sim-${seat}` });
      client.send = m => h.onMessage(JSON.stringify(m));
      client.send({ t: 'hello', v: 1, rev: 11, rules: true, name: `P${seat}`, device: 'desk', want: 'play', canHost: false });
      assert.equal(client.seat, seat); clients.push(client);
    }
    const times = [];
    let peakHeap = 0, peakRSS = 0;
    // Seeded input; measurements include input handling, rules, relay encoding,
    // JSON serialization and all simulated clients parsing/decoding the result.
    let seed = 901;
    for (let tick = 0; tick < ticks + 20; tick++) {
      collecting = tick >= 20;
      const before = performance.now();
      for (const c of clients) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        c.send({ t: 'in', e: host.epoch, k: host.tick, s: [[1, (seed >>> 16) % 2 ? 127 : -127]], r: 0 });
      }
      clock.advance(50);
      if (collecting) times.push(performance.now() - before);
      if (tick % 40 === 0) for (const c of clients) c.send({ t: 'ping', c: clock.t });
      if (measure && tick % 20 === 0) { const m = process.memoryUsage(); peakHeap = Math.max(peakHeap, m.heapUsed); peakRSS = Math.max(peakRSS, m.rss); }
    }
    assert.equal(host.people, seats);
    assert.equal(host.core.stats.errors, 0);
    assert.equal(host.facts().dropped, 0);
    assert.ok(host.core.snapshot()[1].some(e => Math.abs(e[4][0]) === 2), 'simulated input actually moves bodies');
    assert.equal(host.core.stats.ticksCut, 0);
    for (const client of clients) {
      assert.ok(client.latest.d[1].some(e => e[9] === client.seat), `own body for seat ${client.seat}`);
      assert.equal(client.latest.c[0][0], client.seat, 'control table is not truncated at 64');
      assert.equal(client.latest.k, host.tick);
    }
    assert.equal(room.lastRoster.length, seats, 'all seats remain on the roster');
    times.sort((a,b) => a-b);
    return { platform: `${process.platform} ${process.arch}`, runtime: process.version, local: true, cloudflare: false, seats, tickHz: 20, ticks,
      radiusM, peakVisible, snapshots, tickMs: { p50: times[Math.floor(times.length*.5)], p95: times[Math.floor(times.length*.95)], p99: times[Math.floor(times.length*.99)], max: times.at(-1) },
      bytesPerPlayerSecond: bytes / seats / (ticks / 20), maxBytesPerPlayerSecond: Math.max(...clients.map(c => c.bytes)) / (ticks / 20), peakHeapBytes: peakHeap, peakRSSBytes: peakRSS };
  } finally { host?.stop(); rmSync(dir, { recursive: true, force: true }); }
}
