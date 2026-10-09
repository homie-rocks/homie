import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Mppx, stripe } from 'mppx/client';
import { Receipt } from 'mppx';
import { seller } from './paid-parts-review4-seller.mjs';
import { registerResourceKind } from '../worker/resource-kinds.mjs';
import { digest, manifestHash, verifyGrant } from '../worker/purchase-crypto.mjs';
import { offerVersion, orderFact } from '../worker/purchase-core.mjs';

// This resource uses its own storage and quote rules. No purchase code is copied.
test('a second resource kind uses discovery, payment, delivery, receipts and refunds through the same order machine', async () => {
  const w = await seller('second-kind');
  try {
    const original = await (await fetch('https://seller.example/parts/camera/0.1.0/part.json')).json();
    const bytes = new TextEncoder().encode('A purchased field guide.');
    const file = {path:'guide.txt',bytes:bytes.length,sha256:await digest(bytes)};
    const guide = {id:'field-guide',name:'Field guide',version:'1.0.0',license:'LicenseRef-Guide',licenseTerms:'guide.txt',files:[file],sale:{...original.sale,refundWindowDays:14}};
    const offer = await offerVersion({kind:'guide',id:guide.id,release:guide.version,manifest:await manifestHash(guide)},guide.sale);
    registerResourceKind('guide',{
      list:async()=>[{id:guide.id,name:guide.name,version:guide.version,offer:guide.sale,offerVersion:offer.version}],
      get:async(_env,id,version)=>id===guide.id && version===guide.version ? guide : null,
      quote:async(resource,quantity,game,terms)=>digest(JSON.stringify({resource,quantity,game,terms})),
      terms:()=>({license:'Field guide licence'}), validate:()=>[],termsUrl:()=>'/guide/licence',
      covers:async(_env,_origin,bought,wanted)=>bought.id===wanted.id && bought.version===wanted.version,
      readFile:async(_env,wanted)=>wanted.sha256===file.sha256 ? {size:bytes.length,body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.buffer} : null,
    });
    const description = await (await fetch('https://seller.example/openapi.json')).json();
    const [path,operation] = Object.entries(description.paths).find(([path])=>path.includes('/guide/'));
    const properties = operation.post.requestBody.content['application/json'].schema.properties;
    const claim = '8'.repeat(64);
    const body = {...Object.fromEntries(Object.entries(properties).filter(([,v])=>v.const!==undefined).map(([k,v])=>[k,v.const])),buyer:'9'.repeat(64),claim};
    w.st.spts.set('spt_guide',{max:1000,currency:'usd'});
    const wallet = Mppx.create({polyfill:false,fetch:globalThis.fetch,methods:[stripe.charge({paymentMethod:'pm_card_person',createToken:async()=> 'spt_guide'})]});
    const response = await wallet.fetch(`https://seller.example${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,200,await response.clone().text());
    assert.equal(Receipt.fromResponse(response).status,'success');
    const delivered = await response.json();
    assert.equal(delivered.entitlement.resource.kind,'guide');
    assert.equal(Buffer.from(delivered.files[0].data,'base64').toString(),'A purchased field guide.');
    const keys = await (await fetch('https://seller.example/purchases/keys.json')).json();
    await verifyGrant(delivered.proof,keys.keys[0],{issuer:'https://seller.example',subject:body.buyer,resource:guide.id,kind:'guide',version:guide.version,proof:true});
    await assert.rejects(verifyGrant(delivered.proof,keys.keys[0],{issuer:'https://seller.example',kind:'part',proof:true}));
    assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM purchase_orders').get().n,1);
    assert.equal(w.sql.prepare('SELECT COUNT(*) n FROM shop_orders').get().n,0);
    assert.deepEqual(w.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'part_%'").all(),[]);
    assert.equal(w.sql.prepare('SELECT status FROM purchase_orders').get().status,'fulfilled');
    assert.throws(()=>orderFact(w.env,delivered.order,'details',{amount:1}),/Immutable purchase field/);
    await orderFact(w.env,delivered.order,'expired').run();
    assert.equal(w.sql.prepare('SELECT status FROM purchase_orders').get().status,'fulfilled','late expiry cannot revoke accepted money');
    const refund = await w.api('/api/purchases/refund',{},claim);
    assert.equal(refund.status,200,JSON.stringify(refund.data));
    assert.equal(w.sql.prepare('SELECT status FROM purchase_orders').get().status,'refunded');
    assert.equal((await w.api('/api/purchases/grant',{},claim)).status,402);
  } finally { await w.close(); }
});

test('payment modules have no resource-specific vocabulary and only the order writer changes lifecycle state', () => {
  const directory = new URL('../worker/',import.meta.url);
  const files = readdirSync(directory).filter((name)=>/^(purchase|payment|machine-payments|settlement-journal).*\.mjs$/.test(name));
  for (const file of files) {
    const text = readFileSync(new URL(file,directory),'utf8');
    assert.doesNotMatch(text,/part/i,file);
    if (file !== 'purchase-core.mjs') assert.doesNotMatch(text,/UPDATE purchase_orders/i,file);
  }
});
