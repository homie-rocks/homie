/**
 * Idle rooms in real workerd: a Gem Rush room (the starter's own rules) played by scripted phones (rig.mjs).
 *
 *   node proof/idle-rooms/measure.mjs <built studio> <toolkit checkout> <minutes idle> <out.json>
 *
 * The studio is any studio built with `homie-studio build` that holds the gem-rush starter. Each scenario runs in its
 * own workerd process, so the process-wide counters belong to one room:
 *   - `constructedDuring`: how many times the room object was built during the idle stretch. workerd puts away an
 *     object that can hibernate after about ten seconds without events; it is built again from storage when
 *     something (its alarm, a socket) next needs it.
 *   - `timerHeldShare`: the share of the idle stretch during which at least one timer (setTimeout or setInterval)
 *     was pending. A pending timer keeps a Durable Object in memory and charged for duration.
 * After the idle stretch every room is woken (rig.mjs `wake`): a phone comes back with its token and must get its
 * own seat, and everyone plays for twenty seconds.
 */
import { Miniflare } from 'miniflare';
import { writeFileSync } from 'node:fs';
import { roomWorker, phone, wake, SCENARIOS } from './rig.mjs';

const [studio, toolkit, minutesArg, out] = process.argv.slice(2);
const IDLE_MS = Number(minutesArg) * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bundle = await roomWorker({ studio, toolkit, instrument: true });

async function scenario({ room, name, phones: count, mode }) {
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: { name: 'rooms', compatibilityDate: '2026-06-01', compatibilityFlags: ['nodejs_compat'], manifest: { mainModule: 'entry.mjs', modules: { 'entry.mjs': { type: 'esm', contents: bundle } } }, exports: { Table: { type: 'durable-object', storage: 'sqlite' }, Lobby: { type: 'durable-object', storage: 'sqlite' } }, env: { TABLE: { type: 'durable-object', worker: 'rooms', exportName: 'Table' }, LOBBY: { type: 'durable-object', worker: 'rooms', exportName: 'Lobby' } } } }] });
  const stats = async () => (await mf.dispatchFetch('https://studio.test/stats')).json();
  const open = async (i) => {
    const res = await mf.dispatchFetch(`https://studio.test/__net?room=${room}&b=phone${i}`, { headers: { Upgrade: 'websocket' } });
    if (res.status !== 101) throw new Error(`phone ${i}: ${res.status} ${await res.text()}`);
    res.webSocket.accept();
    return res.webSocket;
  };
  const phones = Array.from({ length: count }, (_, i) => phone(open, i, mode));
  try {
    for (const p of phones) { await p.connect(); p.start(); }
    await sleep(5000);
    const before = await stats(), snaps0 = phones.map((p) => p.snaps), sent0 = phones.reduce((a, p) => a + p.sent, 0), t0 = Date.now();
    await sleep(IDLE_MS);
    const ms = Date.now() - t0, after = await stats();
    const idle = {
      ms,
      constructedDuring: after.constructed - before.constructed,
      timerHeldShare: Math.round(1000 * (after.heldMs - before.heldMs) / ms) / 1000,
      timerFires: after.timerFires - before.timerFires,
      objectEvents: after.events - before.events,
      snapshotsPerPhonePerSecond: Math.round(100 * phones.reduce((a, p, i) => a + p.snaps - snaps0[i], 0) / count / (ms / 1000)) / 100,
      framesToObjectPerSecond: Math.round(100 * (phones.reduce((a, p) => a + p.sent, 0) - sent0) / (ms / 1000)) / 100,
      resting: phones.every((p) => p.resting),
    };
    const woke = await wake(phones);
    return { room, name, phones: count, mode, idle, wake: { ...woke, constructedAtWake: (await stats()).constructed - after.constructed } };
  } finally { for (const p of phones) p.stop(); await mf.dispose(); }
}

const runs = await Promise.all(SCENARIOS.map(scenario));
const result = { where: 'local workerd (miniflare)', idleMinutes: Number(minutesArg), at: new Date().toISOString(), runs };
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
for (const r of runs) console.log(r.name, JSON.stringify(r.idle), JSON.stringify(r.wake));
