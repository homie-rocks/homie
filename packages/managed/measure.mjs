/** Modest, alternating HTTP probe. Endpoints are fixed; only disposable test hosts accepted. */
import {writeFileSync} from 'node:fs';
const [managed,plain,output]=process.argv.slice(2);
for(const host of [managed,plain])if(!/^https:\/\/hm-test-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(host??''))throw Error('Explicit hm-test Workers URLs required');
if(!output)throw Error('Output JSON filename required');
const hosts={managed,plain},endpoints={page:'/gathering/open',asset:'/_homie/site.js',records:'/gathering/api/app/records/intentions',mcp:'/mcp',seat:'/coin-dash/api/lobby'},samples=[];
for(let round=0;round<6;round++)for(const [endpoint,path] of Object.entries(endpoints))for(const kind of round%2?['plain','managed']:['managed','plain']){
 const at=performance.now();const response=await fetch(hosts[kind]+path,{...(endpoint==='mcp'?{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})}:{}),signal:AbortSignal.timeout(30000)});
 const text=await response.text();samples.push({round,kind,endpoint,ms:Math.round(performance.now()-at),status:response.status,first:response.headers.get('x-hm-first'),calls:response.headers.get('x-hm-calls'),bytes:text.length});
 writeFileSync(output,JSON.stringify(samples,null,2)+'\n');if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status}`);
 await new Promise(r=>setTimeout(r,200));
}
console.log(`Saved ${samples.length} sequential samples to ${output}`);
