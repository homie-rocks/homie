/**
 * Idle rooms in real workerd: Gem Rush rooms (rig.mjs) played by the toolkit's real client (phones.mjs).
 *
 *   node proof/idle-rooms/measure.mjs <toolkit checkout> <minutes idle> <out.json> <scratch dir>
 *
 * Each room runs in its own workerd process, so the process-wide counters belong to one room:
 *   - `constructedDuring`: how many times the room object was built during the idle stretch. workerd puts away an
 *     object that can hibernate about ten seconds after its last event; it is built again from storage when something
 *     (its alarm, a socket) next needs it.
 *   - `timerHeldShare`: the share of the idle stretch during which at least one timer (setTimeout or setInterval)
 *     was pending. A pending timer keeps a Durable Object in memory and charged for duration.
 * After the idle stretch every room is woken: a phone comes back with its token (the seat must be its own), then
 * everybody holds the stick for ten seconds, and each body must move on the server.
 */
import { Miniflare } from 'miniflare';
import { writeFileSync } from 'node:fs';
import { gemRush, roomWorker, phones, SCENARIOS } from './rig.mjs';

const [toolkit, minutesArg, out, scratch] = process.argv.slice(2);
const IDLE_MS = Number(minutesArg) * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const game = await gemRush({ toolkit, scratch });
const bundle = await roomWorker({ toolkit, game, instrument: true });

async function scenario({ room, name, phones: count, mode }) {
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: { name: 'rooms', compatibilityDate: '2026-06-01', compatibilityFlags: ['nodejs_compat'], manifest: { mainModule: 'entry.mjs', modules: { 'entry.mjs': { type: 'esm', contents: bundle } } }, exports: { Table: { type: 'durable-object', storage: 'sqlite' }, Lobby: { type: 'durable-object', storage: 'sqlite' } }, env: { TABLE: { type: 'durable-object', worker: 'rooms', exportName: 'Table' }, LOBBY: { type: 'durable-object', worker: 'rooms', exportName: 'Lobby' } } } }] });
  const base = await mf.ready;
  const stats = async () => (await fetch(new URL('/stats', base))).json();
  const group = await phones({ game, socketUrl: `${base.href.replace(/^http/, 'ws')}__net?room=${room}`, count, mode });
  try {
    await sleep(5000);
    const before = await stats(), facts0 = await group.ask('facts'), t0 = Date.now();
    await sleep(IDLE_MS);
    const ms = Date.now() - t0, after = await stats(), facts1 = await group.ask('facts');
    const idle = {
      ms,
      constructedDuring: after.constructed - before.constructed,
      timerHeldShare: Math.round(1000 * (after.heldMs - before.heldMs) / ms) / 1000,
      objectEvents: after.events - before.events,
      snapshotsPerPhonePerSecond: Math.round(100 * facts1.reduce((a, f, i) => a + f.snaps - facts0[i].snaps, 0) / count / (ms / 1000)) / 100,
      resting: facts1.every((f) => f.resting),
    };
    const woke = await group.ask('wake');
    return { room, name, phones: count, mode, idle, wake: { ...woke, constructedAtWake: (await stats()).constructed - after.constructed } };
  } finally { await group.ask('close').catch(() => {}); group.kill(); await mf.dispose(); }
}

const runs = await Promise.all(SCENARIOS.map(scenario));
const result = { where: 'local workerd (miniflare)', room: game.room, idleMinutes: Number(minutesArg), at: new Date().toISOString(), runs };
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
for (const r of runs) console.log(r.name, JSON.stringify(r.idle), JSON.stringify(r.wake));
