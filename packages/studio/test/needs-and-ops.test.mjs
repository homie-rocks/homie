import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proveAppNeeds} from '../lib/app-needs.mjs';

test('needs prove only the named tablet and kiosk, with explicit roles and useful waits',async()=>{
 const seen=[];
 const surfaces=['tablet','kiosk'].map(name=>({name,role:'staff',frame:{waitForSelector:async s=>{seen.push(s);if(s==='#missing')throw Error('Waiting failed: 30000ms exceeded');},click:async()=>{}},page:{screenshot:async()=>{}}}));
 const results=await proveAppNeeds({plan:{needs:[{id:'fit',statement:'My crew fits boards from a tablet',role:'staff',steps:[{surface:'tablet',selector:'#fit',click:true}],assertions:[{surface:'tablet',selector:'#done'},{surface:'kiosk',selector:'#done'}]},{id:'missing',statement:'Find booking',assertions:[{surface:'tablet',selector:'#missing'}]}]},surfaces,shots:'/tmp'});
 assert.equal(results[0].status,'met');assert.equal(results[0].captures.length,2);
 assert.match(results[1].why,/tablet.*#missing/);
});
test('a need cannot pass in the wrong role',async()=>{
 const [result]=await proveAppNeeds({plan:{needs:[{id:'staff',statement:'Staff fit',role:'staff',assertions:[{surface:'phone',selector:'#done'}]}]},surfaces:[{name:'phone',role:'customer',frame:{waitForSelector:async()=>{}},page:{screenshot:async()=>{}}}],shots:'/tmp'});
 assert.equal(result.status,'not');assert.match(result.why,/role/);
});
test('nonvisual need observes an effect after its action',async()=>{
 let effect=false;
 const frame={waitForSelector:async()=>{},click:async()=>{effect=true;},evaluate:async()=>{},waitForFunction:async(fn,opts,...args)=>{assert.equal(effect,true);assert.equal(args[0],'sound');}};
 const [result]=await proveAppNeeds({plan:{needs:[{id:'bell',statement:'A bell announces fitting',steps:[{surface:'tablet',selector:'#fit',click:true}],assertions:[{surface:'tablet',effect:'sound',name:'fit'}]}]},surfaces:[{name:'tablet',frame,page:{screenshot:async()=>{}}}],shots:'/tmp'});
 assert.equal(result.status,'met');
});
test('reload waits for readiness and replaces its frame before asserting',async()=>{
 const order=[]; const fresh={waitForSelector:async()=>order.push('assert')};
 const page={reload:async()=>order.push('reload'),screenshot:async()=>order.push('capture')};
 const [result]=await proveAppNeeds({plan:{needs:[{id:'reload',statement:'Survives reload',steps:[{surface:'tablet',reload:true}],assertions:[{surface:'tablet',selector:'#saved'}]}]},surfaces:[{name:'tablet',page,frame:{}}],shots:'/tmp',ready:async s=>{order.push('ready');s.frame=fresh;}});
 assert.equal(result.status,'met');assert.deepEqual(order,['reload','ready','assert','capture']);
});
test('local role sessions are scoped, authenticated and inert in production',async()=>{
 const {localSession}=await import('../worker/local-test.mjs');
 const {createHmac}=await import('node:crypto');
 const secret='test-secret'; const data=Buffer.from(JSON.stringify({app:'boards',role:'staff',scope:'run-one'})).toString('base64url');
 const token=data+'.'+createHmac('sha256',secret).update(data).digest('hex');
 const request=new Request('http://localhost/boards/play',{headers:{cookie:'homie_test='+token}});
 assert.equal((await localSession(request,{HOMIE_LOCAL_TEST_SECRET:secret})).role,'staff');
 assert.equal(await localSession(request,{}),null);
 assert.equal(await localSession(new Request('https://studio.test/boards/play',{headers:request.headers}),{HOMIE_LOCAL_TEST_SECRET:secret}),null);
 assert.equal(await localSession(request,{HOMIE_LOCAL_TEST_SECRET:'wrong'}),null);
});
test('headless local tools authenticate without a browser and preserve event references',async()=>{
 const {localCaller}=await import('../worker/local-test.mjs');
 const request=new Request('http://localhost/mcp',{headers:{authorization:'Bearer test-secret'}});
 assert.equal((await localCaller(request,{HOMIE_LOCAL_TEST_SECRET:'test-secret'})).owner,true);
 assert.equal(await localCaller(request,{}),null);
});
