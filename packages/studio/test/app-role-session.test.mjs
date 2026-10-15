import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {database} from './place-database.mjs';
import worker from '../worker/index.mjs';
import {AppRecordStreams} from '../worker/app-streams.mjs';

// Exercise the private-link -> cookie -> records/SSE path without Chrome.
// In particular, do not forward a Secure cookie that a LAN HTTP browser rejects.
for (const origin of ['http://192.168.1.20:8787', 'https://studio.example']) {
  test(`staff role handoff survives removal of access on ${origin}`, {timeout:10000}, async t => {
    const DB = database(t);
    DB.batch = xs => Promise.all(xs.map(x => x.all()));
    const meta = {id:'welcome', name:'Welcome', kind:'app', launch:'public',
      roles:{customer:{can:['read:queue','create:queue']}, staff:{signIn:true,can:['read:queue']}},
      surfaces:{phone:'customer',tablet:'staff'},
      records:{persist:true,collections:{queue:{fields:{label:{type:'string'}}}}}};
    const token = 'b'.repeat(43);
    DB.sql.exec("INSERT INTO players(id,name,guest,created_at,seen_at) VALUES('staff','Staff',0,0,0); INSERT INTO app_roles VALUES('welcome','staff','staff'); INSERT INTO app_role_links VALUES('welcome','staff','secret')");
    DB.sql.prepare("INSERT INTO player_sessions(hash,player,kind,expires_at) VALUES(?,'staff','session',?)")
      .run(createHash('sha256').update(token).digest('hex'), Date.now()+3600000);
    const env = {DB, ASSETS:{fetch:async () => Response.json({studio:{name:'Test'},games:[meta]})}};
    const streams = new AppRecordStreams(env, {waitUntil(){}});
    t.after(() => streams.dispose());
    env.LOBBY = {idFromName:x=>x,get:()=>({fetch:async (_url,init) => {
      const body = JSON.parse(init.body);
      return body.op === 'open' ? streams.open(body) : streams.wake(body.meta);
    }})};
    const call = (path, cookie='', options={}) => worker.fetch(new Request(origin+'/welcome/'+path,
      {...options,headers:{origin,cookie,'content-type':'application/json'}}),env,{});
    const page = await call('open?role=staff&access=secret','studio_player='+token);
    assert.equal(page.status,200);
    const handoff = page.headers.get('set-cookie');
    assert.ok(handoff);
    assert.equal(/; Secure(?:;|$)/i.test(handoff), origin.startsWith('https:'),
      'handoff must be accepted on LAN HTTP and stay Secure on HTTPS');
    assert.match(handoff,/Path=\/welcome\/; Max-Age=300; HttpOnly/);
    assert.match(handoff,/SameSite=Strict/);
    assert.ok(!handoff.includes('secret'));
    const cookie = handoff.split(';')[0];
    const live = await call('api/app/live?role=staff&collection=queue',cookie);
    assert.equal(live.status,200);
    const reader = live.body.getReader();
    t.after(() => reader.cancel());
    assert.match(new TextDecoder().decode((await reader.read()).value),/"reset":true/);
    for (const id of ['one','two']) {
      const joined = await call('api/app/records/queue/'+id,'',
        {method:'POST',body:JSON.stringify({data:{label:id}})});
      assert.equal(joined.status,200,await joined.text());
    }
    await streams.wake(meta);
    assert.match(new TextDecoder().decode((await reader.read()).value),/"collections":\["queue"\]/);
    const records = await call('api/app/records/queue?role=staff',cookie);
    assert.equal(records.status,200);
    assert.equal((await records.json()).records.length,2);
    DB.sql.exec('DELETE FROM app_roles');
    assert.equal((await call('api/app/records/queue?role=staff',cookie)).status,404);
    assert.equal((await call('api/app/live?role=staff&collection=queue',cookie)).status,403);
  });
}
