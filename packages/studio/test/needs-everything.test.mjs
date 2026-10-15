import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {proveAppNeeds} from '../lib/app-needs.mjs';
const ui = (click=async()=>{}, screenshot=async()=>{})=>[{name:'phone',frame:{waitForSelector:async()=>{},click},page:{screenshot}}];
const need={id:'role',statement:'Pick a role',steps:[{surface:'phone',selector:'#role',click:true}],assertions:[{surface:'phone',selector:'#chosen'}]};
test('passing assertions are met without captures, with actionable evidence guidance',async()=>{
 const [r]=await proveAppNeeds({plan:{needs:[need]},surfaces:ui()});
 assert.equal(r.status,'met');assert.match(r.why,/phone.*--shots/);
});
test('a failed capture identifies its surface and reason without changing acceptance',async()=>{
 const [r]=await proveAppNeeds({plan:{needs:[need]},surfaces:ui(undefined,async()=>{throw Error('disk full');}),shots:'/tmp'});
 assert.equal(r.status,'met');assert.match(r.why,/phone.*disk full.*--shots/);
});
test('a replaced role button is queried again and clicked',async()=>{
 let attempts=0;
 const [r]=await proveAppNeeds({plan:{needs:[need]},surfaces:ui(async()=>{if(++attempts===1)throw Error('Node is detached from document');})});
 assert.equal(r.status,'met');assert.equal(attempts,2);
});
test('headless calls, schedule effects, records, event feeds and handover are demonstrable',async()=>{
 const root=mkdtempSync(join(tmpdir(),'needs-'));writeFileSync(join(root,'HANDOVER.md'),'Connect your AI at /mcp. Reminders run daily.');
 const calls=[];
 try {
 const [r]=await proveAppNeeds({root,plan:{needs:[{id:'business',statement:'Book, remind and hand over',role:'customer',steps:[
 {mcp:{tool:'book',arguments:{name:'Ada'}},save:'booking'},
 {role:'owner',schedule:{name:'reminders',at:1800000000000},save:'tick'},
 {role:'owner',mcp:{tool:'studio_events_read',arguments:{feed:'bookings'}},save:'events'}],assertions:[
 {result:'booking',path:'id',equals:'one'},
 {role:'staff',records:{collection:'reminders'},contains:{records:[{data:{name:'Ada'}}]}},
 {result:'events',contains:{events:[{type:'record.changed'}]}},
 {file:'HANDOVER.md',text:['/mcp','Reminders run daily']}]}]},surfaces:[],headless:async(action,role)=>{
 calls.push({action,role});if(action.records)return {records:[{data:{name:'Ada'}}]};if(action.schedule)return {ok:true};return action.mcp.tool==='book'?{id:'one'}:{events:[{type:'record.changed'}]};
 }});
 assert.equal(r.status,'met',r.why);assert.deepEqual(calls.map(c=>c.role),['customer','owner','owner','staff']);
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('missing capabilities and wrong results remain not met with their exact cause',async()=>{
 const results=await proveAppNeeds({surfaces:[],plan:{needs:[
 {id:'ai',statement:'AI books',steps:[{mcp:{tool:'book'},save:'booking'}],assertions:[{result:'booking',equals:true}]},
 {id:'handover',statement:'Handover exists',assertions:[{file:'MISSING.md',text:'setup'}]}
 ]}});
 assert.equal(results[0].status,'not');assert.match(results[0].why,/MCP|headless/);assert.equal(results[1].status,'not');assert.match(results[1].why,/root|MISSING/);
});

test('eventual read assertions correlate the saved job, without repeating the action',async()=>{
 let writes=0,reads=0;
 const [result]=await proveAppNeeds({surfaces:[],plan:{needs:[{id:'delivery',statement:'This webhook reaches its receiver',role:'owner',steps:[{mcp:{tool:'send'},save:'job'}],assertions:[{mcp:{tool:'status'},waitMs:500,contains:{deliveries:[{id:{$result:'job.id'},state:'complete'}]}}]}]},headless:async item=>{
 if(item.mcp.tool==='send'){writes++;return {id:'new-job'};}
 return {deliveries:[{id:'old-job',state:'complete'},{id:'new-job',state:++reads===1?'running':'complete'}]};
 }});
 assert.equal(result.status,'met',result.why);assert.equal(writes,1);assert.equal(reads,2);
});
test('failed structured, file, saved-path and eventual assertions retain useful reasons',async()=>{
 const root=mkdtempSync(join(tmpdir(),'needs-negative-'));writeFileSync(join(root,'HANDOVER.md'),'Draft');
 try {
 const results=await proveAppNeeds({root,surfaces:[],headless:async()=>({value:1}),plan:{needs:[
 {id:'wrong',statement:'Correct result',steps:[{mcp:{tool:'read'},save:'x'}],assertions:[{result:'x',path:'value',equals:2}]},
 {id:'missing',statement:'Connection instructions',assertions:[{file:'HANDOVER.md',text:'/mcp'}]},
 {id:'path',statement:'Result field',steps:[{mcp:{tool:'read'},save:'x'}],assertions:[{result:'x',equals:{$result:'x.missing'}}]},
 {id:'eventual',statement:'Eventually complete',assertions:[{mcp:{tool:'status'},waitMs:1,contains:{value:2}}]}
 ]}});
 assert.ok(results.every(r=>r.status==='not'));assert.match(results[0].why,/result x.value.*expected equals 2/);assert.match(results[1].why,/HANDOVER.md.*\/mcp/);assert.match(results[2].why,/x.missing/);assert.match(results[3].why,/MCP status.*expected contains/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
