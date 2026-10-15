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
test('one approval installs the key privately and bootstraps the Worker-owned webhook', async t => {
  const root = studio(t), writes = [], logs = []; let started, opened = 0, ack = 0;
  const fetcher = async (url, options) => {
    if(url.endsWith('/api/shop/stripe-setup'))return Response.json({ok:true,webhookId:'we_fixture'});
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
  assert.deepEqual(writes.map(w => w.args), [['secret','put','STRIPE_SETUP_CHALLENGE'], ['secret','put','STRIPE_KEY']]);
  assert.equal(writes[1].input, 'rk_test_fixture');
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

test('retry requests a new approval after decrypted private key deletion', async t => {
  const root=studio(t), storage=join(root,'private');let started, opened=0, fail=true;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/api/shop/stripe-setup'))return Response.json({ok:true,webhookId:'we_fixture'});
    const body=JSON.parse(options.body);
    if(url.endsWith('/start')){started=body;return Response.json({id:'setup',url:'https://marketplace.stripe.com/oauth/v2/authorize?state=nonce'});}
    if(url.endsWith('/ack'))return Response.json({ok:true});
    const publicKey=await importSPKI(started.publicKey,'RSA-OAEP-256');
    const encrypt=value=>new CompactEncrypt(new TextEncoder().encode(value)).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM'}).encrypt(publicKey);
    return Response.json({status:'ready',mode:'test',origin:started.origin,account:'acct_fixture',keyId:'apikey_fixture',webhookId:'we_fixture',key:await encrypt('rk_test_fixture'),webhookSecret:await encrypt('whsec_fixture')});
  };
  const options={storage,fetcher,open:()=>opened++,wrangler:async args=>({code:args.at(-1)==='STRIPE_KEY'&&fail?1:0})};
  assert.equal((await shopConnect(root,options)).ok,false);fail=false;
  assert.equal((await shopConnect(root,options)).ok,true);assert.equal(opened,2);
});

test('migration deploys Checkout before cutover and drains before removing retired bindings', async t => {
  const root=studio(t); const {writeFileSync}=await import('node:fs');
  writeFileSync(join(root,'.studio','stripe-mcp.json'),'{}');
  const sequence=[];let started, collected=0, drained=false, cutover=false;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/api/shop/stripe-setup'))return Response.json({ok:true,webhookId:'we_fixture'});
    const body=JSON.parse(options.body);
    if(url.endsWith('/start')){started=body;assert.equal(body.migration,true);return Response.json({id:'setup',url:'https://marketplace.stripe.com/oauth/v2/authorize?state=nonce'});}
    if(url.endsWith('/cutover')){cutover=true;sequence.push('cutover');return Response.json({ok:true});}
    if(url.endsWith('/drained')){sequence.push('drained');drained=true;return Response.json({ok:true});}
    if(url.endsWith('/ack')){sequence.push('ack');return Response.json({ok:true});}
    if(cutover&&!drained)return Response.json({status:'draining',open:collected++===0?1:0,complete:['cs_existing']});
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
  assert.ok(sequence.indexOf('deploy')<sequence.indexOf('cutover'));assert.ok(sequence.indexOf('put:STRIPE_KEY')<sequence.indexOf('deploy'));
  assert.ok(sequence.indexOf('drained')<sequence.indexOf('delete:STRIPE_SHOP_LINKS'));
  assert.equal(sequence.at(-1),'ack');
});

test('round2 approval URL and state never enter job events',async t=>{
 const root=studio(t),events=[];
 await shopConnect(root,{storage:join(root,'private'),open:()=>{},onEvent:e=>events.push(e),wrangler:async()=>({code:0}),fetcher:async url=>Response.json(url.endsWith('/start')?{id:'setup',url:'https://marketplace.stripe.com/approve?state=private-state'}:{status:'failed'})});
 assert.doesNotMatch(JSON.stringify(events),/private-state|https:/);
});
test('round2 loopback displays account and requires local POST before confirm',async()=>{
 const {createApprovalListener}=await import('../lib/stripe-connect.mjs');let confirmed=0;
 const listener=await createApprovalListener({confirm:async value=>{assert.equal(value.account,'acct_owner');confirmed++;}});
 try{
 const page=await fetch(listener.url+'?id=setup&confirm='+ 'a'.repeat(64)+'&account=acct_owner');
 const html=await page.text();assert.match(html,/acct_owner/);assert.equal(confirmed,0);
 const token=/name="token" value="([a-f0-9]+)"/.exec(html)[1];
 assert.equal((await fetch(listener.url,{method:'POST',headers:{origin:new URL(listener.url).origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})})).status,200);
 assert.equal(confirmed,1);
 }finally{await listener.close();}
});
test('round2 documented RSA-OAEP and RSA-OAEP-256 envelopes decrypt',async()=>{
 const {decryptManagedKey}=await import('../lib/stripe-connect.mjs');const {generateKeyPairSync}=await import('node:crypto');
 const pair=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 for(const alg of ['RSA-OAEP','RSA-OAEP-256']){
 const key=await importSPKI(pair.publicKey,alg);const ciphertext=await new CompactEncrypt(new TextEncoder().encode('rk_test_fixture')).setProtectedHeader({alg,enc:'A256GCM'}).encrypt(key);
 assert.equal(await decryptManagedKey(ciphertext,pair.privateKey),'rk_test_fixture');
 }
});
