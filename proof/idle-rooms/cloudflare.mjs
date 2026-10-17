/**
 * Idle rooms on Cloudflare: the same rooms and phones as measure.mjs, deployed as two throwaway Workers (the toolkit
 * before and after the change, side by side), with what Cloudflare itself recorded for each room object read from
 * its GraphQL Analytics API (`durableObjectsPeriodicGroups`: active time, GB-seconds of duration, CPU, socket
 * messages, rows written). Both Workers are deleted at the end, and the deletion is checked.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *   node proof/idle-rooms/cloudflare.mjs <built studio> <toolkit before> <toolkit after> <minutes idle> <out.json> <worker name prefix>
 *
 * The token needs Workers Scripts edit and Account Analytics read. It is read from the environment and never printed.
 */
import { writeFileSync } from 'node:fs';
import { roomWorker, phone, wake, SCENARIOS } from './rig.mjs';

const [studio, before, after, minutesArg, out, prefix] = process.argv.slice(2);
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token || !prefix) throw new Error('needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and a worker name prefix');
const IDLE_MS = Number(minutesArg) * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && body.success !== false, body };
};
const say = (line) => console.log(`${new Date().toISOString()} ${line}`);

async function deploy(name, toolkit) {
  const bundle = await roomWorker({ studio, toolkit });
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({
    main_module: 'entry.mjs', compatibility_date: '2026-06-01', compatibility_flags: ['nodejs_compat'],
    bindings: [{ type: 'durable_object_namespace', name: 'TABLE', class_name: 'Table' }, { type: 'durable_object_namespace', name: 'LOBBY', class_name: 'Lobby' }],
    migrations: { new_tag: 'v1', new_sqlite_classes: ['Table', 'Lobby'] },
  })], { type: 'application/json' }));
  form.append('entry.mjs', new Blob([bundle], { type: 'application/javascript+module' }), 'entry.mjs');
  const put = await api(`/workers/scripts/${name}`, { method: 'PUT', body: form });
  if (!put.ok) throw new Error(`upload ${name}: ${put.status} ${JSON.stringify(put.body.errors)}`);
  const sub = await api(`/workers/scripts/${name}/subdomain`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
  if (!sub.ok) throw new Error(`workers.dev for ${name}: ${sub.status} ${JSON.stringify(sub.body.errors)}`);
  say(`deployed ${name} (${Math.round(bundle.length / 1024)} KB)`);
}

async function remove(name) {
  const del = await api(`/workers/scripts/${name}?force=true`, { method: 'DELETE' });
  const gone = await api(`/workers/scripts/${name}`);
  return { deleteStatus: del.status, deleted: del.ok, scriptLookupStatus: gone.status };
}

async function namespaces() {
  const r = await api('/workers/durable_objects/namespaces?per_page=1000');
  return (r.body.result ?? []).filter((n) => String(n.script ?? '').startsWith(prefix));
}

async function usage(namespaceId, since, until) {
  const query = `query($a: String!, $f: AccountDurableObjectsPeriodicGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $a }) {
    durableObjectsPeriodicGroups(limit: 10000, filter: $f) { dimensions { name datetimeMinute } sum { activeTime cpuTime duration inboundWebsocketMsgCount outboundWebsocketMsgCount rowsWritten rowsRead } } } } }`;
  let body;
  for (let tries = 0; ; tries++) {
    try { body = await (await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { a: account, f: { namespaceId, datetimeMinute_geq: since, datetimeMinute_lt: until } } }) })).json(); break; }
    catch (error) { if (tries >= 4) throw error; await sleep(5000); }
  }
  if (body.errors?.length) throw new Error(`analytics: ${body.errors[0].message}`);
  return body.data.viewer.accounts[0].durableObjectsPeriodicGroups;
}

const variants = [{ label: 'before', toolkit: before }, { label: 'after', toolkit: after }].map((v) => ({ ...v, name: `${prefix}-${v.label}` }));
const result = { where: 'Cloudflare (two throwaway Workers, deleted afterwards)', idleMinutes: Number(minutesArg), variants: {} };
const phones = [];
try {
  for (const v of variants) await deploy(v.name, v.toolkit);
  const subdomain = (await api('/workers/subdomain')).body.result.subdomain;
  for (const v of variants) {
    v.host = `${v.name}.${subdomain}.workers.dev`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`https://${v.host}/`)).ok) break; } catch { /* not yet */ } await sleep(2000); }
  }
  const open = (v, room) => (i) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${v.host}/__net?room=${room}&b=phone${i}`);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error(`socket to ${v.host}/${room} failed`)), { once: true });
  });
  const rooms = [];
  for (const v of variants) for (const s of SCENARIOS) {
    const list = Array.from({ length: s.phones }, (_, i) => phone(open(v, s.room), i, s.mode));
    for (const p of list) { await p.connect(); p.start(); phones.push(p); }
    rooms.push({ v, s, list });
  }
  say(`${phones.length} phones connected; idle for ${minutesArg} minutes`);
  await sleep(5000);
  const t0 = Date.now();
  await sleep(IDLE_MS);
  const t1 = Date.now();
  const restingAtEnd = rooms.map((r) => r.list.every((p) => p.resting));
  const woke = await Promise.all(rooms.map((r) => wake(r.list)));
  for (const p of phones) p.stop();
  say('woken and closed; waiting for Cloudflare analytics');
  // Whole minutes inside the idle stretch only.
  const minute = 60_000, since = new Date(Math.ceil(t0 / minute) * minute).toISOString(), until = new Date(Math.floor(t1 / minute) * minute).toISOString();
  const windowS = (Date.parse(until) - Date.parse(since)) / 1000;
  const spaces = await namespaces();
  // Analytics arrive minutes late. A room that never sleeps reports every minute; wait until each of those has,
  // then read once more a minute later so the late rows of the others are in too.
  const read = async () => {
    const rows = {};
    for (const v of variants) { const ns = spaces.find((n) => n.script === v.name && n.class === 'Table'); rows[v.label] = ns ? await usage(ns.id, since, until) : []; }
    return rows;
  };
  const awake = [...variants.map((v) => [v.label, 'play-1']), ...SCENARIOS.map((s) => ['before', s.room])];
  let rows = null;
  for (let tries = 0; tries < 40; tries++) {
    await sleep(30_000);
    rows = await read();
    if (awake.every(([label, room]) => rows[label].filter((g) => g.dimensions.name === `gem-rush/${room}`).length >= windowS / 60)) break;
  }
  await sleep(60_000);
  rows = await read();
  rooms.forEach((r, n) => {
    const groups = rows[r.v.label].filter((g) => g.dimensions.name === `gem-rush/${r.s.room}`);
    const sum = (k) => groups.reduce((a, g) => a + (Number(g.sum[k]) || 0), 0);
    (result.variants[r.v.label] ??= { worker: r.v.name, since, until, windowSeconds: windowS, rooms: [] }).rooms.push({
      room: r.s.room, name: r.s.name, phones: r.s.phones, mode: r.s.mode,
      minutesReported: groups.length,
      activeSeconds: Math.round(sum('activeTime') / 1e4) / 100,
      activeShare: Math.round(1000 * sum('activeTime') / 1e6 / windowS) / 1000,
      durationGbSeconds: Math.round(100 * sum('duration')) / 100,
      cpuMs: Math.round(sum('cpuTime') / 1000),
      socketMessagesIn: sum('inboundWebsocketMsgCount'),
      socketMessagesOut: sum('outboundWebsocketMsgCount'),
      rowsWritten: sum('rowsWritten'),
      perMinuteActiveMs: groups.map((g) => [g.dimensions.datetimeMinute.slice(11, 16), Math.round(g.sum.activeTime / 1000)]).sort(),
      restingAtEndOfIdle: restingAtEnd[n],
      wake: woke[n],
    });
  });
} finally {
  for (const p of phones) p.stop();
  result.cleanup = {};
  for (const v of variants) result.cleanup[v.name] = await remove(v.name);
  result.cleanup.namespacesLeft = (await namespaces()).map((n) => ({ script: n.script, class: n.class }));
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  say(`wrote ${out}`);
}
