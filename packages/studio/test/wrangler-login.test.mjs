import {tmpdir} from 'node:os';
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

test('three studio processes recover together from a shared refresh collision',async t=>{
  const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
  const {join}=await import('node:path');
  const {spawn}=await import('node:child_process');
  const root=mkdtempSync(join(tmpdir(),'wrangler-login-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const script=`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const first=path.join(process.cwd(),'attempt');
if(!fs.existsSync(first)){fs.writeFileSync(first,'1');console.error('OAuth refresh token is invalid during concurrent refresh');process.exit(1);}
console.log(JSON.stringify({loggedIn:true,accounts:[{id:'shared-account',name:'Studio'}]}));
`;
  const jobs=Array.from({length:3},(_,i)=>{
    const studio=join(root,String(i));mkdirSync(join(studio,'node_modules/.bin'),{recursive:true});
    writeFileSync(join(studio,'node_modules/.bin/wrangler'),script,{mode:0o755});
    const source=`import {checkWranglerLogin} from ${JSON.stringify(new URL('../lib/cloudflare.mjs',import.meta.url).href)};const result=checkWranglerLogin(${JSON.stringify(studio)});console.log(JSON.stringify(result));process.exitCode=result.ok?0:1;`;
    return new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,['--input-type=module','-e',source]);let out='',err='';
      child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);child.on('error',reject);
      child.on('close',code=>{try{assert.equal(code,0,err);assert.equal(JSON.parse(out).who.accounts[0].id,'shared-account');resolve();}catch(error){reject(error);}});
    });
  });
  await Promise.all(jobs);
});
