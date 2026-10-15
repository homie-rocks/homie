import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {APP_SHELL_JS} from '../worker/app-shell.mjs';
function harness(fetcher){
 const channels=[];let lock=Promise.resolve();
 class Channel{constructor(){channels.push(this)}postMessage(data){for(const c of channels)if(c!==this)c.onmessage?.({data:structuredClone(data)})}}
 const locks={request:(_name,fn)=>{const p=lock.then(fn);lock=p.catch(()=>{});return p}};
 function screen(role='customer'){
  let receive;const results=[];const source={postMessage:m=>results.push(m)};
  vm.runInNewContext(APP_SHELL_JS,{window:{__HOMIE_PLAY:{kind:'app',game:'yard'}},document:{querySelector:()=>({contentWindow:source})},location:{search:'?role='+role,pathname:'/yard/open'},history:{replaceState(){}},URLSearchParams,fetch:fetcher,addEventListener:(_,fn)=>receive=fn,navigator:{locks},BroadcastChannel:Channel,Date,Map,Promise,JSON,setTimeout,clearTimeout,AbortSignal});
  let seq=0;return {results,request:(collection='arrivals',method='GET')=>receive({source,data:{type:'homie-app',id:(++seq).toString(16).padStart(32,'0'),collection,method,data:{label:'test'}}})};
 }
 return {screen};
}
test('four screens share simultaneous same-role reads and queue bursts',async()=>{
 let calls=0;const h=harness(async()=>{calls++;await new Promise(r=>setTimeout(r,2));return {ok:true,status:200,json:async()=>({ok:true,records:[]})}});
 const screens=Array.from({length:4},()=>h.screen());await Promise.all(screens.flatMap(s=>Array.from({length:12},()=>s.request())));
 assert.equal(calls,1);assert.equal(screens.flatMap(s=>s.results).length,48);assert.ok(screens.every(s=>s.results.every(r=>r.result.ok)));
});
test('roles are separate and writes are never coalesced',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return {ok:true,status:200,json:async()=>({ok:true,records:[]})}});const a=h.screen(),b=h.screen('staff');
 await Promise.all([a.request(),b.request()]);assert.equal(calls,2);await Promise.all([a.request('arrivals','POST'),a.request('arrivals','POST')]);assert.equal(calls,4);
});
test('a failed read backs off',async()=>{
 let calls=0;const h=harness(async()=>{calls++;return {ok:false,status:429,json:async()=>({ok:false,error:'too many requests'})}});const s=h.screen();await s.request();await s.request();assert.equal(calls,1);assert.match(s.results[0].result.error,/Reconnecting/);
});

test('a successful write invalidates reads in every screen',async()=>{
 let calls=0;const h=harness(async()=>({ok:true,status:200,json:async()=>({ok:true,records:[{value:++calls}]})}));const a=h.screen(),b=h.screen();
 await a.request();await b.request();assert.equal(calls,1);await b.request('arrivals','POST');await a.request();assert.equal(calls,3);
});
