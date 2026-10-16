import {signAssertion} from './studios-keys.mjs';
import {Client, StreamableHTTPClientTransport, PrivateKeyJwtProvider} from 'mcp-studio-client';
export function studioOrigin(value,{allowPrivate=false}={}) {
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Studio requires a bare HTTPS origin');
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(!allowPrivate&&(url.port||host.includes(':')||/^[0-9.]+$/.test(host)||!host.includes('.')||/(^|\.)(localhost|local|internal)$/.test(host)))throw new Error('Studio requires a public DNS origin on port 443');
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
export function studioResult(result,source={origin:null,authenticated:false}) {
 let data=result.structuredContent;
 if(data===undefined&&result.content?.length===1&&result.content[0].type==='text'){
  try{const parsed=JSON.parse(result.content[0].text);if(parsed?.kind==='untrusted-tool-data')data=parsed;}catch{/* Ordinary MCP text remains content. */}
 }
 if(data?.kind==='untrusted-tool-data'&&Object.hasOwn(data,'data'))data=data.data;
 return {source,untrusted:true,isError:result.isError===true,...(data===undefined?{}:{data}),content:result.content??[]};
}
export function outboundRules(cat) {
 const rules=new Map();
 for(const [key,rule] of Object.entries(cat.studio?.mcp?.studios?.outbound??{})) {
  const origin=studioOrigin(key,{allowPrivate:rule.allowPrivate===true});
  if(rules.has(origin)||rule.origin!==undefined&&studioOrigin(rule.origin,{allowPrivate:rule.allowPrivate===true})!==origin)throw new Error('Studio configuration origin mismatch');
  rules.set(origin,rule);
 }
 return rules;
}
export function studiosClient(env,cat,definition,{fetchFn=globalThis.fetch.bind(globalThis),origin:ownOrigin}={}) {
 const providers=new Map(),discovery=new Map();
 const rules=outboundRules(cat);
 const run=async(origin,operation,options={})=>{
  const candidate=new URL(origin).origin,rule=rules.get(candidate);
  origin=studioOrigin(origin,{allowPrivate:rule?.allowPrivate===true});
  if(!rule)throw new Error('Studio destination is not configured');
  if(rule&&!rule.tools?.includes(definition.name))throw new Error('Studio connection not delegated to this tool');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('Studio request timed out')),10000);
  const client=new Client({name:'homie-studio',version:'1'});
  try{
   const authenticated=rule.anonymous!==true;
   let authProvider;
   if(authenticated){
    if(!ownOrigin||!env.STUDIO_SIGNING_KEY)throw new Error('Studio signing key unavailable');
    authProvider=providers.get(origin);
    if(!authProvider){
     authProvider=new PrivateKeyJwtProvider({clientId:ownOrigin,privateKey:{},algorithm:'EdDSA',scope:'studio',expectedIssuer:origin});
     authProvider.addClientAuthentication=async(_headers,params,url)=>{
      if(String(url)!==origin+'/oauth/token')throw new Error('Unexpected studio token endpoint');
      params.set('client_id',ownOrigin);
      params.set('client_assertion_type','urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      params.set('client_assertion',await signAssertion(env,ownOrigin,String(url)));
     };
     providers.set(origin,authProvider);
    }
   }
   const cachedFetch=async(request)=>{
    const url=new URL(request.url),cacheable=request.method==='GET'&&url.pathname.startsWith('/.well-known/');
    if(cacheable&&discovery.has(request.url))return discovery.get(request.url).clone();
    const response=await fetchFn(request);
    if(cacheable&&response.ok){const bounded=await (await boundedStudioFetch(origin,controller.signal,{fetchFn:async()=>response,maxBytes:32768})(request)).arrayBuffer();if(bounded.byteLength>32768)throw new Error('Discovery size exceeded');const saved=new Response(bounded,{status:response.status,headers:response.headers});discovery.set(request.url,saved);return saved.clone();}
    return response;
   };
   const headers={};
   if(options.assertedHandle!==undefined){
    if(!authenticated||typeof options.assertedHandle!=='string'||! /^[A-Za-z0-9._@-]{1,128}$/.test(options.assertedHandle))throw new Error('Acting-for needs an authenticated studio and a handle of 1–128 characters');
    headers['x-studio-asserted-handle']=encodeURIComponent(options.assertedHandle);
   }
   const transport=new StreamableHTTPClientTransport(new URL(authenticated?'/mcp/auth':'/mcp',origin),{fetch:boundedStudioFetch(origin,controller.signal,{fetchFn:async request=>cachedFetch(request)}),authProvider,requestInit:{headers}});
   await client.connect(transport,{signal:controller.signal,timeout:10000});
   return await operation(client,controller.signal,{origin,authenticated});
  }finally{controller.abort();clearTimeout(timer);await client.close();}
 };
 return Object.freeze({
  send:(origin,name,event)=>import('./studios-events.mjs').then(m=>m.sendStudioEvent(env,cat,ownOrigin,definition,origin,name,event,{fetchFn})),
  listTools:(origin,options)=>run(origin,async(client,signal,source)=>{const page=await client.listTools(options?.cursor?{cursor:options.cursor}:{},{signal,timeout:10000});return {...page,source,untrusted:true,tools:page.tools.map(tool=>({...tool,source,untrusted:true,description:'[Untrusted remote description] '+(tool.description??'')}))};},options),
  call:(origin,tool,args={},options)=>{
   if(new TextEncoder().encode(JSON.stringify(args)).length>65536)return Promise.reject(new Error('Studio arguments size exceeded'));
   return run(origin,async(client,signal,source)=>studioResult(await client.callTool({name:tool,arguments:args},{signal,timeout:10000}),source),options);
  },
 });
}
