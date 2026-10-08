/** T2, against a disposable Preview using fixtures/rooms-saving.mjs. Run each size with 8 and 32 seats:
 * node packages/studio/test/rooms-saving.mjs <origin> <game> <save-bytes> <seats> [seconds=3600]
 * Sizes: 4000, 64000, 1000000, 3000000. Use a minimal rules game for the 4 KB case.
 * The deployed game must allow the requested seats. This measures the real host's store and output gate;
 * it never deploys or changes a studio. Add --analytics with CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
 * and HOMIE_T2_SCRIPT in the environment to check the per-object billing gate. Without it, billing is unproven. Run rooms-restarts.mjs separately on the same Preview for the 200-restart proof.
 */
import assert from 'node:assert/strict';
import { cfUsage } from '../lib/cf-usage.mjs';
import { botClient, socketUrl } from './bot-client.mjs';
const [origin, game, sizeArg, seatsArg, secondsArg = '3600'] = process.argv.slice(2);
assert.ok(origin && game, 'provide a Preview origin and game');
const size = Number(sizeArg); const seats = Number(seatsArg); const seconds = Number(secondsArg);
assert.ok([4000, 64000, 1_000_000, 3_000_000].includes(size));
assert.ok([8, 32].includes(seats)); assert.ok(seconds > 0 && Number.isFinite(seconds));
const room = `saving-${size}-${Date.now().toString(36)}`;
const url = await socketUrl(origin, game, room);
const holds = []; const actualBytes = new Set(); let object = null; let saves = 0;
class MeasuredSocket extends WebSocket {
  constructor(url) {
    super(url); let previous = null;
    this.addEventListener('message', (e) => {
      const m = JSON.parse(e.data); if (m.t !== 'snap') return;
      const now = performance.now();
      if (m.measure?.saved) {
        actualBytes.add(m.measure.bytes); object = m.measure.object; saves++;
        if (previous && m.k === previous.k + 1) holds.push(Math.max(0, now - previous.at - 50));
      }
      previous = { k: m.k, at: now };
    });
  }
}
const bots = Array.from({ length: seats }, (_, i) => botClient({ url, name: `Player ${i + 1}`, ...(i === 0 ? { WebSocketImpl: MeasuredSocket } : {}) }));
const since = new Date().toISOString();
try {
  await Promise.all(bots.map((b) => b.ready));
  assert.ok(bots.every((b) => b.seat !== null), 'all requested sockets are seated');
  const until = performance.now() + seconds * 1000;
  while (performance.now() < until) {
    await new Promise((r) => setTimeout(r, Math.min(1000, until - performance.now())));
    assert.ok(bots.every((b) => !b.closed), 'every player remains connected');
  }
  assert.deepEqual([...actualBytes], [size], 'the measured save has the requested size');
  assert.ok(saves >= seconds * 0.95 && holds.length > 0, 'whole saves continue once per second');
  holds.sort((a, b) => a - b);
  const p99 = holds[Math.ceil(holds.length * 0.99) - 1];
  const untilTime = new Date().toISOString();
  let usage = null;
  if (process.argv.includes('--analytics')) {
    usage = await cfUsage({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN, script: process.env.HOMIE_T2_SCRIPT, objectId: object, since, until: untilTime });
    assert.ok(usage.ok, usage.why);
    const expected = 3612 * Math.ceil(size / 1_000_000);
    const perHour = usage.rowsWritten / usage.hours;
    usage.rowsWithin10 = Math.abs(perHour - expected) <= expected * 0.1;
  }
  console.log(JSON.stringify({ origin, game, room, object, since, until: untilTime, size, seats, seconds, saves, saveHoldP99Ms: p99, players: bots.map((b) => b.report()), usage, billingProven: usage?.rowsWithin10 === true }));
  if (usage) assert.ok(usage.rowsWithin10, 'per-object rows written must be within 10% of the design; allow analytics to settle before querying again');
  if (size === 64000) assert.ok(p99 <= 50, `save hold p99 ${p99} ms exceeds one tick`);
} finally { bots.forEach((b) => b.close()); }
