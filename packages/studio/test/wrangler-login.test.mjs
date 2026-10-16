import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as cf from '../lib/cloudflare.mjs';
const yes={code:0,stdout:JSON.stringify({loggedIn:true,accounts:[{id:'a',name:'Studio'}],authType:'OAuth Token'})};
test('sign-in tolerates a refresh race and rereads Wrangler on each attempt',()=>{
  const waits=[], replies=[{code:1,out:'OAuth refresh token is invalid'}, {code:0,stdout:'{"loggedIn":false}'},yes];
  const result=cf.checkWranglerLogin('.',{}, {run:()=>replies.shift(),sleep:ms=>waits.push(ms)});
  assert.equal(result.ok,true);assert.deepEqual(result.who.accounts,[{id:'a',name:'Studio'}]);
  assert.equal(waits.length,2);assert.ok(waits[1]>waits[0]);
});
test('failed checks retain real diagnostics and distinguish expired auth from temporary failure',()=>{
  for(const [reply,needs] of [[{code:1,out:'OAuth refresh token expired'},'cloudflare-login'],[{code:1,out:'EBUSY: config is locked'},'cloudflare-auth-check'],[{code:1,out:'network unavailable'},'cloudflare-auth-check'],[{code:0,stdout:'{"loggedIn":false}'},'cloudflare-login']]){
    let calls=0;const result=cf.checkWranglerLogin('.',{},{run:()=>{calls++;return reply;},sleep:()=>{}});
    assert.equal(calls,4);assert.equal(result.ok,false);assert.equal(result.needs,needs);
    if(reply.out)assert.ok(result.why.includes(reply.out));
  }
});
