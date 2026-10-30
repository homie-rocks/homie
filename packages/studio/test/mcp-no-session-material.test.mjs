import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withoutSessionMaterial,resultWithoutSessionMaterial} from '../worker/mcp-result-safety.mjs';

const SESSION=/studio_player=|set-cookie|"cookies?"|HttpOnly|session_?token/i;
const leaked={ok:true,order:'ord_1',url:'https://checkout.stripe.com/c/pay/cs_test_a1',booking:'hold_'+'a'.repeat(48),
  account:{cookies:['studio_player=SECRET; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure']}};

test('studio_checkout-shaped results lose session cookies and keep the checkout',()=>{
  const out=withoutSessionMaterial(leaked);
  assert.deepEqual(out,{ok:true,order:'ord_1',url:leaked.url,booking:leaked.booking});
  assert.doesNotMatch(JSON.stringify(out),SESSION);
});

test('guest cart account keeps the player and loses the cookies; booking tokens stay',()=>{
  const out=withoutSessionMaterial({offerVersion:'v1',token:'b'.repeat(64),account:{player:{id:'p1',guest:true},cookies:['studio_player=x; Path=/; HttpOnly']},nested:[{'set-cookie':'a=b'},{sessionToken:'z',keep:1},'owner=s; Path=/; HttpOnly']});
  assert.deepEqual(out,{offerVersion:'v1',token:'b'.repeat(64),account:{player:{id:'p1',guest:true}},nested:[{},{keep:1}]});
  assert.doesNotMatch(JSON.stringify(out),SESSION);
});

test('protocol and paid tool results are scrubbed in content text and structuredContent',()=>{
  const out=resultWithoutSessionMaterial({content:[{type:'text',text:JSON.stringify(leaked)},{type:'text',text:'plain words about cookies'}],structuredContent:{data:leaked}});
  assert.doesNotMatch(JSON.stringify(out.content[0])+JSON.stringify(out.structuredContent),SESSION);
  assert.equal(out.content[1].text,'plain words about cookies');
  assert.equal(JSON.parse(out.content[0].text).url,leaked.url);
});

test('MCP bridges never copy Set-Cookie or session cookies into tool results',()=>{
  const read=f=>readFileSync(new URL('../worker/'+f,import.meta.url),'utf8');
  for(const f of ['customer-mcp.mjs','customer-shop.mjs'])assert.doesNotMatch(read(f),/getSetCookie|cookies:\s*session\.cookies|account:\{cookies/,f);
  const mcp=read('mcp.mjs');
  assert.match(mcp,/withoutSessionMaterial\(await \(await import\('\.\/app-tools\.mjs'\)\)\.invokeAppTool/);
  assert.match(mcp,/resultWithoutSessionMaterial\(await tool\.handler/);
  assert.match(mcp,/resultWithoutSessionMaterial\(await selling\.paidTool/);
});
