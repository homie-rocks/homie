import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompactEncrypt, importSPKI } from 'jose';
import { shopConnect } from '../lib/stripe-connect.mjs';
function studio(t) {
  const root = mkdtempSync(join(tmpdir(), 'homie-app-connect-'));
  cpSync(new URL('./fixtures/studio-0.51.6-shop/', import.meta.url), root, { recursive: true });
  rmSync(join(root, '.studio', 'stripe-mcp.json'), { force: true });
  t.after(() => rmSync(root, { recursive: true, force: true })); return root;
}
test('one approval decrypts locally and installs both secrets only over Wrangler stdin', async t => {
  const root = studio(t), writes = [], logs = []; let started, opened = 0, ack = 0;
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/start')) { started = body; return Response.json({ id: 'setup', url: 'https://marketplace.stripe.com/oauth/v2/authorize?state=nonce' }); }
    assert.equal(body.collectToken, started.collectToken);
    if (url.endsWith('/ack')) { ack++; return Response.json({ ok: true }); }
    const key = await importSPKI(started.publicKey, 'RSA-OAEP-256');
    const encrypt = value => new CompactEncrypt(new TextEncoder().encode(value)).setProtectedHeader({ alg: 'RSA-OAEP-256', enc: 'A256GCM' }).encrypt(key);
    return Response.json({ status: 'ready', account: 'acct_fixture', mode: 'test', origin: started.origin,
      key: await encrypt('rk_test_fixture'), webhookSecret: await encrypt('whsec_fixture'), keyId: 'apikey_fixture', webhookId: 'we_fixture' });
  };
  const result = await shopConnect(root, { storage: join(root, 'private'), fetcher, open: () => opened++, log: x => logs.push(x),
    wrangler: async (args, options) => { writes.push({ args, input: options.input }); return { code: 0, out: 'private output' }; } });
  assert.equal(result.ok, true); assert.equal(opened, 1); assert.equal(ack, 1);
  assert.deepEqual(writes.map(w => w.args), [['secret','put','STRIPE_SETUP_CHALLENGE'], ['secret','put','STRIPE_KEY'], ['secret','put','STRIPE_WEBHOOK_SECRET']]);
  assert.equal(writes[1].input, 'rk_test_fixture'); assert.equal(writes[2].input, 'whsec_fixture');
  assert.doesNotMatch(JSON.stringify({ result, logs }), /rk_test_fixture|whsec_fixture|private output|PRIVATE KEY/);
});
test('malformed ciphertext and mismatched mode install no payment credentials; manual entry is refused', async t => {
  for (const mode of ['live', 'test']) {
    const root = studio(t), writes = [];
    const result = await shopConnect(root, { storage: join(root, 'private'), open: () => {}, wrangler: async args => { writes.push(args); return { code: 0 }; },
      fetcher: async url => Response.json(url.endsWith('/start') ? { id: 'setup', url: 'https://dashboard.stripe.com/approve' } : { status: 'ready', mode, origin: 'https://golf.example', account: 'acct_fixture', key: 'bad', webhookSecret: 'bad' }) });
    assert.equal(result.ok, false); assert.equal(writes.length, 1);
  }
  assert.equal((await shopConnect(studio(t), { manual: true })).needs, 'app-approval');
});

test('retry resumes encrypted delivery with no second approval after a private Wrangler failure', async t => {
  const root=studio(t), storage=join(root,'private');let started, opened=0, fail=true;
  const fetcher=async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.endsWith('/start')){assert.equal(started,undefined);started=body;return Response.json({id:'setup',url:'https://marketplace.stripe.com/oauth/v2/authorize?state=nonce'});}
    if(url.endsWith('/ack'))return Response.json({ok:true});
    const publicKey=await importSPKI(started.publicKey,'RSA-OAEP-256');
    const encrypt=value=>new CompactEncrypt(new TextEncoder().encode(value)).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM'}).encrypt(publicKey);
    return Response.json({status:'ready',mode:'test',origin:started.origin,account:'acct_fixture',keyId:'apikey_fixture',webhookId:'we_fixture',key:await encrypt('rk_test_fixture'),webhookSecret:await encrypt('whsec_fixture')});
  };
  const options={storage,fetcher,open:()=>opened++,wrangler:async args=>({code:args.at(-1)==='STRIPE_KEY'&&fail?1:0})};
  assert.equal((await shopConnect(root,options)).ok,false);fail=false;
  assert.equal((await shopConnect(root,options)).ok,true);assert.equal(opened,1);
});

test('migration deploys only after the old signed receipt, then removes retired bindings', async t => {
  const root=studio(t); const {writeFileSync}=await import('node:fs');
  writeFileSync(join(root,'.studio','stripe-mcp.json'),'{}');
  const sequence=[];let started, collected=0, drained=false;
  const fetcher=async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.endsWith('/start')){started=body;assert.equal(body.migration,true);return Response.json({id:'setup',url:'https://marketplace.stripe.com/oauth/v2/authorize?state=nonce'});}
    if(url.endsWith('/drained')){sequence.push('drained');drained=true;return Response.json({ok:true});}
    if(url.endsWith('/ack')){sequence.push('ack');return Response.json({ok:true});}
    if(!drained)return Response.json({status:'draining',open:collected++===0?1:0,complete:['cs_existing']});
    const key=await importSPKI(started.publicKey,'RSA-OAEP-256');const encrypt=value=>new CompactEncrypt(new TextEncoder().encode(value)).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM'}).encrypt(key);
    return Response.json({status:'ready',mode:'test',origin:started.origin,account:'acct_fixture',keyId:'apikey_fixture',webhookId:'we_fixture',key:await encrypt('rk_test_fixture'),webhookSecret:await encrypt('whsec_fixture')});
  };
  const wrangler=async(args,options)=>{
    if(args[0]==='d1'){sequence.push('receipt');return {code:0,stdout:JSON.stringify([{success:true,results:args.at(-1).includes('sqlite_master')?[{name:'shop_orders'}]:[{session:'cs_existing'}]}])};}
    if(args[1]==='list')return {code:0,stdout:JSON.stringify([{name:'STRIPE_SHOP_LINKS'}])};
    sequence.push(args[1]+':'+args[2]);return {code:0};
  };
  const result=await shopConnect(root,{storage:join(root,'private'),fetcher,wrangler,open:()=>{},wait:async()=>{},deploy:async()=>{sequence.push('deploy');return {ok:true};}});
  assert.equal(result.ok,true);assert.ok(sequence.indexOf('receipt')<sequence.indexOf('drained'));
  assert.ok(sequence.indexOf('drained')<sequence.indexOf('deploy'));assert.ok(sequence.indexOf('deploy')<sequence.indexOf('put:STRIPE_KEY'));
  assert.ok(sequence.indexOf('put:STRIPE_WEBHOOK_SECRET')<sequence.indexOf('delete:STRIPE_SHOP_LINKS'));
  assert.equal(sequence.at(-1),'ack');
});
