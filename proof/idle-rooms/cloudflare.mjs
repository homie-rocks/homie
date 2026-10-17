/**
 * Idle rooms on Cloudflare: the rooms of measure.mjs, deployed as two throwaway Workers (the toolkit before and after
 * the change, side by side, each with its own Gem Rush and its own client), played by the real client (phones.mjs),
 * with what Cloudflare itself recorded for each room object read from its GraphQL Analytics API: active time, GB-s of
 * duration, CPU and rows written (`durableObjectsPeriodicGroups`), and the requests by kind, alarms among them
 * (`durableObjectsInvocationsAdaptiveGroups`). Both Workers are deleted at the end, and the deletion is checked.
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
 *   node proof/idle-rooms/cloudflare.mjs <toolkit before> <toolkit after> <minutes idle> <out.json> <worker name prefix> <scratch dir>
 *
 * The token needs Workers Scripts edit and Account Analytics read. It is read from the environment and never printed.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gemRush, roomWorker, phones, SCENARIOS } from './rig.mjs';

const [before, after, minutesArg, out, prefix, scratch] = process.argv.slice(2);
const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token || !prefix || !scratch) throw new Error('needs CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, a worker name prefix and a scratch directory');
const IDLE_MS = Number(minutesArg) * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && body.success !== false, body };
};
const say = (line) => console.log(`${new Date().toISOString()} ${line}`);

async function deploy(name, bundle) {
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

async function graphql(query, variables) {
  for (let tries = 0; ; tries++) {
    try {
      const body = await (await fetch('https://api.cloudflare.com/client/v4/graphql', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) })).json();
      if (body.errors?.length) throw new Error(`analytics: ${body.errors[0].message}`);
      return body.data.viewer.accounts[0];
    } catch (error) { if (tries >= 4) throw error; await sleep(5000); }
  }
}
const usage = (namespaceId, since, until) => graphql(`query($a: String!, $f: AccountDurableObjectsPeriodicGroupsFilter_InputObject!, $i: AccountDurableObjectsInvocationsAdaptiveGroupsFilter_InputObject!) { viewer { accounts(filter: { accountTag: $a }) {
  periodic: durableObjectsPeriodicGroups(limit: 10000, filter: $f) { dimensions { name datetimeMinute } sum { activeTime cpuTime duration rowsWritten } }
  invocations: durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: $i) { dimensions { name type } sum { requests } } } } }`,
  { a: account, f: { namespaceId, datetimeMinute_geq: since, datetimeMinute_lt: until }, i: { namespaceId, datetimeMinute_geq: since, datetimeMinute_lt: until } });

const variants = [{ label: 'before', toolkit: before }, { label: 'after', toolkit: after }].map((v) => ({ ...v, name: `${prefix}-${v.label}` }));
const result = { where: 'Cloudflare (two throwaway Workers, deleted afterwards)', idleMinutes: Number(minutesArg), variants: {} };
const groups = [];
try {
  for (const v of variants) { v.game = await gemRush({ toolkit: v.toolkit, scratch: join(scratch, v.label) }); await deploy(v.name, await roomWorker({ toolkit: v.toolkit, game: v.game })); }
  const subdomain = (await api('/workers/subdomain')).body.result.subdomain;
  for (const v of variants) {
    v.host = `${v.name}.${subdomain}.workers.dev`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`https://${v.host}/`)).ok) break; } catch { /* not yet */ } await sleep(2000); }
  }
  const minute = 60_000, joinedAt = Date.now();
  const rooms = [];
  for (const v of variants) for (const s of SCENARIOS) {
    const g = await phones({ game: v.game, socketUrl: `wss://${v.host}/__net?room=${s.room}`, count: s.phones, mode: s.mode });
    groups.push(g); rooms.push({ v, s, g });
  }
  say(`${rooms.length} rooms connected; idle for ${minutesArg} minutes`);
  await sleep(IDLE_MS);
  const restingAtEnd = await Promise.all(rooms.map(async (r) => (await r.g.ask('facts')).every((f) => f.resting)));
  const t1 = Date.now();
  const woke = await Promise.all(rooms.map((r) => r.g.ask('wake')));
  for (const r of rooms) { await r.g.ask('close').catch(() => {}); r.g.kill(); }
  say('woken and closed; waiting for Cloudflare analytics');
  // Every whole minute from the one the phones joined in (a room plays on for restSeconds before it rests, and
  // Cloudflare reports that stretch under the minute it began) to the end of the idle stretch.
  const since = new Date(Math.floor(joinedAt / minute) * minute).toISOString(), until = new Date(Math.floor(t1 / minute) * minute).toISOString();
  const windowS = (Date.parse(until) - Date.parse(since)) / 1000;
  const spaces = await namespaces();
  const read = async () => {
    const rows = {};
    for (const v of variants) { const ns = spaces.find((n) => n.script === v.name && n.class === 'Table'); rows[v.label] = ns ? await usage(ns.id, since, until) : { periodic: [], invocations: [] }; }
    return rows;
  };
  // Analytics arrive minutes late. A room that never sleeps reports every minute: wait until each has, then read once
  // more two minutes later so the late rows of the others are in too.
  const awake = [...variants.map((v) => [v.label, 'play-1']), ...SCENARIOS.map((s) => ['before', s.room])];
  let rows = null;
  for (let tries = 0; tries < 40; tries++) {
    await sleep(30_000);
    rows = await read();
    if (awake.every(([label, room]) => rows[label].periodic.filter((g) => g.dimensions.name === `gem-rush/${room}`).length >= windowS / 60)) break;
  }
  await sleep(120_000);
  rows = await read();
  rooms.forEach((r, n) => {
    const periodic = rows[r.v.label].periodic.filter((g) => g.dimensions.name === `gem-rush/${r.s.room}`);
    const sum = (k) => periodic.reduce((a, g) => a + (Number(g.sum[k]) || 0), 0);
    const requests = Object.fromEntries(rows[r.v.label].invocations.filter((g) => g.dimensions.name === `gem-rush/${r.s.room}`).map((g) => [g.dimensions.type, g.sum.requests]));
    (result.variants[r.v.label] ??= { worker: r.v.name, room: r.v.game.room, since, until, windowSeconds: windowS, rooms: [] }).rooms.push({
      room: r.s.room, name: r.s.name, phones: r.s.phones, mode: r.s.mode,
      minutesReported: periodic.length,
      activeSeconds: Math.round(sum('activeTime') / 1e4) / 100,
      activeShare: Math.round(1000 * sum('activeTime') / 1e6 / windowS) / 1000,
      durationGbSeconds: Math.round(100 * sum('duration')) / 100,
      cpuMs: Math.round(sum('cpuTime') / 1000),
      rowsWritten: sum('rowsWritten'),
      requests,
      perMinuteActiveMs: periodic.map((g) => [g.dimensions.datetimeMinute.slice(11, 16), Math.round(g.sum.activeTime / 1000)]).sort(),
      restingAtEndOfIdle: restingAtEnd[n],
      wake: woke[n],
    });
  });
} finally {
  for (const g of groups) g.kill();
  result.cleanup = {};
  for (const v of variants) result.cleanup[v.name] = await remove(v.name);
  result.cleanup.namespacesLeft = (await namespaces()).map((n) => ({ script: n.script, class: n.class }));
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  say(`wrote ${out}`);
}
