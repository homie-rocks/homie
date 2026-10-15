import {Agent,fetch as edgeFetch} from 'undici';
/** Modest, alternating HTTP probe. Endpoints are fixed; only disposable test hosts accepted. */
import {writeFileSync} from 'node:fs';
const [managed,plain,output]=process.argv.slice(2);
for(const host of [managed,plain])if(!/^https:\/\/hm-test-[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev(?:\/speed)?$/.test(host??''))throw Error('Explicit hm-test Workers URLs required');
if(!output)throw Error('Output JSON filename required');
const dispatcher=process.env.HM_TEST_EDGE_IP?new Agent({connect:{lookup:(host,options,callback)=>callback(null,options.all?[{address:process.env.HM_TEST_EDGE_IP,family:4}]:process.env.HM_TEST_EDGE_IP,4)}}):undefined;
const requestFetch=dispatcher?(url,options)=>edgeFetch(url,{...options,dispatcher}):fetch;
const hosts={managed,plain},endpoints={page:'/cafe/open',asset:'/_homie/site.js',records:'/cafe/api/app/records/notes',mcp:'/mcp',seat:'/race/api/lobby'},samples=[];
for(let round=0;round<Number(process.env.HM_TEST_ROUNDS??30);round++)for(const [endpoint,path] of Object.entries(endpoints))for(const kind of round%2?['plain','managed']:['managed','plain']){
 const at=performance.now();let response;try{response=await requestFetch(hosts[kind]+path,{...(endpoint==='mcp'?{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})}:{}),signal:AbortSignal.timeout(30000)});}catch(error){samples.push({round,kind,endpoint,ms:Math.round(performance.now()-at),error:String(error),ray:null,colo:null});writeFileSync(output,JSON.stringify(samples,null,2)+'\n');continue;}
 const text=await response.text();samples.push({round,kind,endpoint,ms:Math.round(performance.now()-at),status:response.status,ray:response.headers.get('cf-ray'),colo:response.headers.get('cf-ray')?.split('-').at(-1),first:response.headers.get('x-hm-first'),routeMs:response.headers.get('x-hm-route-ms'),routeVersion:response.headers.get('x-hm-route-version'),calls:response.headers.get('x-hm-calls'),bytes:text.length});
 writeFileSync(output,JSON.stringify(samples,null,2)+'\n');if(!response.ok)throw Error(`${endpoint}: HTTP ${response.status}`);
 await new Promise(r=>setTimeout(r,200));
}
console.log(`Saved ${samples.length} sequential samples to ${output}`);

if(dispatcher)await dispatcher.close();
