import {Client, StreamableHTTPClientTransport, ClientCredentialsProvider} from 'mcp-studio-client';
export function studioOrigin(value) {
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Studio requires a bare HTTPS origin');
 return url.origin;
}
/** Bound bytes before SDK parsing; the SDK owns JSON-RPC, SSE and OAuth. */
export function boundedStudioFetch(origin,signal,{maxBytes=1024*1024,fetchFn=globalThis.fetch.bind(globalThis)}={}) {
 return async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.origin!==origin||url.username||url.password)throw new Error('Studio request escaped its origin');
  const response=await fetchFn(new Request(request,{redirect:'manual',signal:AbortSignal.any([signal,request.signal])}));
  if(response.status>=300&&response.status<400){await response.body?.cancel();throw new Error('Studio redirects refused');}
  if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new Error('Studio response size exceeded');}
  if(!response.body)return response;
  let bytes=0;
  const body=response.body.pipeThrough(new TransformStream({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>maxBytes)throw new Error('Studio response size exceeded');controller.enqueue(chunk);}}));
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
}
export function studioResult(result) {
 let data=result.structuredContent;
 if(data===undefined&&result.content?.length===1&&result.content[0].type==='text'){
  try{const parsed=JSON.parse(result.content[0].text);if(parsed?.kind==='untrusted-tool-data')data=parsed;}catch{/* Ordinary MCP text remains content. */}
 }
 if(data?.kind==='untrusted-tool-data'&&Object.hasOwn(data,'data'))data=data.data;
 return {isError:result.isError===true,...(data===undefined?{}:{data}),content:result.content??[]};
}
export function studiosClient(env,cat,definition,{fetchFn=globalThis.fetch.bind(globalThis)}={}) {
 const run=async(origin,operation,options={})=>{
  origin=studioOrigin(origin);
  const rule=cat.studio?.mcp?.studios?.outbound?.[origin];
  if(rule&&!rule.tools?.includes(definition.name))throw new Error('Studio connection not delegated to this tool');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Studio request timed out')),10000);
  const client=new Client({name:'homie-studio',version:'1'});
  try{
   const secret=rule?.secret?env[rule.secret]:undefined;
   if(rule&&(!rule.clientId||typeof secret!=='string'||!secret))throw new Error('Studio credential unavailable');
   const authProvider=rule?new ClientCredentialsProvider({clientId:rule.clientId,clientSecret:secret,scope:'studio',expectedIssuer:origin}):undefined;
   const headers={};
   if(options.actingFor!==undefined){
    if(!rule||typeof options.actingFor!=='string'||!options.actingFor.length||options.actingFor.length>128)throw new Error('Acting-for needs an authenticated studio and a handle of 1–128 characters');
    headers['x-studio-acting-for']=encodeURIComponent(options.actingFor);
   }
   const transport=new StreamableHTTPClientTransport(new URL(rule?'/mcp/auth':'/mcp',origin),{fetch:boundedStudioFetch(origin,controller.signal,{fetchFn}),authProvider,requestInit:{headers}});
   await client.connect(transport,{signal:controller.signal,timeout:10000});
   return await operation(client,controller.signal);
  }finally{controller.abort();clearTimeout(timer);await client.close();}
 };
 return Object.freeze({
  send:(origin,name,event)=>import('./studios-events.mjs').then(m=>m.sendStudioEvent(env,cat,null,definition,origin,name,event,{fetchFn})),
  listTools:(origin,options)=>run(origin,(client,signal)=>client.listTools(options?.cursor?{cursor:options.cursor}:{},{signal,timeout:10000}),options),
  call:(origin,tool,args={},options)=>{
   if(new TextEncoder().encode(JSON.stringify(args)).length>65536)return Promise.reject(new Error('Studio arguments size exceeded'));
   return run(origin,async(client,signal)=>studioResult(await client.callTool({name:tool,arguments:args},{signal,timeout:10000})),options);
  },
 });
}
