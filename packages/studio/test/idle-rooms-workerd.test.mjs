/** A room nobody plays rests and hibernates in real workerd, then wakes with its sockets and seats. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, ok, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await ok()) return;
  assert.fail(`timed out waiting for ${what}`);
}

test('an idle room holds no timer and hibernates; a phone back with its token wakes it, and the restored socket plays on', async () => {
  const bundle = await build({ stdin: { resolveDir: dirname(fileURLToPath(new URL('../worker/index.mjs', import.meta.url))), contents: `
    import {Table as BaseTable,Lobby,hostRules} from './index.mjs';
    import {defineRules,defineMove,f,roomSettings} from '../rules/rules.ts';
    export {Lobby};
    const rules=defineRules({contract:2,space:{dims:2},move:defineMove({runner(){}}),entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'circle',radius:.4,maxSpeed:1}}},room:{join(c,p){return {kind:'runner',at:{x:p.seat*2,y:0,z:0}};}}});
    hostRules({idle:{rules,settings:roomSettings({tickHz:10,restSeconds:1}).settings,seats:4,build:'b1',stateHash:'s1',map:{bounds:{min:[-20,-20],max:[20,20]}}}});
    // Every timer the object holds: a pending one keeps a Durable Object in memory, and charged for its time.
    const stats={constructed:0,pending:new Set()};
    const st=globalThis.setTimeout,si=globalThis.setInterval,ct=globalThis.clearTimeout,ci=globalThis.clearInterval;
    globalThis.setTimeout=(fn,ms,...a)=>{const h=st(()=>{stats.pending.delete(h);fn(...a);},ms);stats.pending.add(h);return h;};
    globalThis.setInterval=(fn,ms,...a)=>{const h=si(fn,ms,...a);stats.pending.add(h);return h;};
    globalThis.clearTimeout=h=>{stats.pending.delete(h);ct(h);};globalThis.clearInterval=h=>{stats.pending.delete(h);ci(h);};
    export class Table extends BaseTable{constructor(ctx,env){stats.constructed++;super(ctx,{...env,HOMIE_ROOM_LOG:'0',ASSETS:{fetch:async()=>new Response('{}')}});}}
    export default {fetch(req,env){const u=new URL(req.url);
      if(u.pathname==='/stats')return Response.json({constructed:stats.constructed,pending:stats.pending.size});
      return env.TABLE.get(env.TABLE.idFromName('idle/one')).fetch(new Request('https://table/__net?relay=1&game=idle&room=one&max=4&rules=1&hz=10&host=server&cur=b1&gv=b1',req));}};
  ` }, bundle: true, write: false, format: 'esm', platform: 'browser', conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'] });
  const classes = ['Table', 'Lobby'];
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: { name: 'idle', compatibilityDate: '2026-10-07', compatibilityFlags: ['nodejs_compat'], manifest: { mainModule: 'entry.mjs', modules: { 'entry.mjs': { type: 'esm', contents: bundle.outputFiles[0].text } } }, exports: Object.fromEntries(classes.map((name) => [name, { type: 'durable-object', storage: 'sqlite' }])), env: Object.fromEntries(classes.map((name) => [name.toUpperCase(), { type: 'durable-object', worker: 'idle', exportName: name }])) } }] });
  const stats = async () => (await mf.dispatchFetch('https://local/stats')).json();
  const phones = [];
  const phone = async (token = null) => {
    const r = await mf.dispatchFetch('https://local/__net', { headers: { Upgrade: 'websocket' } });
    assert.equal(r.status, 101);
    const ws = r.webSocket; ws.accept();
    const p = { ws, seat: null, token: null, resting: false, e: 0, ks: [], seq: 0 };
    ws.addEventListener('message', (ev) => {
      if (ev.data === 'homie-pong') return;
      const m = JSON.parse(ev.data);
      if (m.t === 'welcome') { p.seat = m.seat; p.token = m.token; }
      else if (m.t === 'snap') { p.e = m.e; p.ks.push(m.k); }
      else if (m.t === 'rest') p.resting = m.on;
    });
    // What the toolkit's own client says: a rules browser that understands a resting room.
    ws.send(JSON.stringify({ t: 'hello', v: 1, rev: 12, rules: true, rest: 1, coast: 1, want: 'play', name: 'Phone', token }));
    await until('a welcome and a snapshot', () => p.seat !== null && p.ks.length > 0);
    phones.push(p);
    return p;
  };
  // A resting page pings the edge every two seconds: Cloudflare answers it without waking the object.
  const pinging = setInterval(() => { for (const p of phones) if (p.resting) try { p.ws.send('homie-ping'); } catch { /* closed */ } }, 2000);
  const press = (p) => p.ws.send(JSON.stringify({ t: 'in', e: p.e, k: p.ks.at(-1) + 1, s: [[0, 1, -471, ++p.seq, 0]], r: 0 }));
  try {
    const a = await phone(), b = await phone();
    assert.notEqual(a.seat, b.seat);
    press(a);
    // Nobody plays for restSeconds: the room says it rests, and its tick, its relay beat and every other timer stop.
    await until('the room to rest', () => a.resting && b.resting);
    await until('no timer left in the object', async () => (await stats()).pending === 0);
    const frozen = a.ks.at(-1);
    await sleep(1000);
    assert.equal(a.ks.at(-1), frozen, 'a resting room sends no snapshots');
    // Hibernated: workerd puts away an object with no timer and only hibernatable sockets after about ten seconds.
    const before = (await stats()).constructed;
    await sleep(15_000);
    assert.equal((await stats()).constructed, before, 'nothing woke it while it slept');
    // Phone B slept and comes back with its token; phone A's socket was kept through hibernation and is not touched.
    b.ws.close(1001, 'phone slept');
    await until('the object to be built again from storage', async () => (await stats()).constructed === before + 1);
    const back = await phone(b.token);
    assert.equal(back.seat, b.seat, 'the phone that came back has its own seat');
    await until('the room to wake', () => !a.resting && !back.resting);
    const from = a.ks.length;
    await until('the restored socket to be sent the world again', () => a.ks.length >= from + 5);
    const ticks = a.ks.slice(from);
    assert.ok(ticks.every((k, i) => i === 0 || k > ticks[i - 1]), `the restored room ticks on: ${ticks}`);
    assert.ok((await stats()).pending > 0, 'and holds its tick timer again while people play');
    assert.equal((await stats()).constructed, before + 1, 'one restore, no restart loop');
  } finally { clearInterval(pinging); for (const p of phones) try { p.ws.close(); } catch { /* gone */ } await mf.dispose(); }
});
