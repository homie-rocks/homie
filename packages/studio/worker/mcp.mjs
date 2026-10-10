import { selling } from './extensions.mjs';
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { createMcpHandler } from 'agents/mcp/server';
import { McpServer, fromJsonSchema, ProtocolError } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { players } from './players.mjs';
import { isOwner, sameOrigin } from './office.mjs';
import { cookieValue } from './stats.mjs';
import { esc } from './site.mjs';
import { oauthStorage, rateLimit, audit, callsPerMinute } from './mcp-store.mjs';
import { allowed, currentCaller, services, builtins } from './mcp-tools.mjs';
const validator = new CfWorkerJsonSchemaValidator();
const json = (data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const html = (body,headers={})=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect your AI</title><style>body{font:18px system-ui;max-width:640px;margin:64px auto;padding:24px;background:#faf9f6;color:#252520}button,a{padding:12px}button{font:inherit}li{margin:16px 0}</style><main>${body}</main></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",...Object.fromEntries(new Headers(headers))}});
async function browserPerson(request,env) {
  const person=await players.of(request,env);
  if(person&&!person.guest)return person.id;
  if(await isOwner(request,env)) {
    const token=cookieValue(request,'studio_owner');
    if(token){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));return 'office-'+[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
  }
  return null;
}
export async function remoteMcp(request,env,ctx,{catalogueOf,definitions=[]}) {
  const url=new URL(request.url), origin=url.origin, path=url.pathname;
  if(!env.DB)return json({error:'studio database required'},503);
  if(request.headers.has('origin') && request.headers.get('origin')!==origin)return json({error:'origin refused'},403);
  if(path.startsWith('/hooks/tools/')) return (await import('./tool-webhook.mjs')).toolWebhook(request,env,{cat:await catalogueOf(),definitions});
  const scoped={...env,OAUTH_KV:oauthStorage(env.DB)};
  const api=async(request,env,ctx)=>{
    let caller;
    try{caller=await currentCaller(env,ctx.props);}catch{return new Response(JSON.stringify({error:'connection revoked'}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store','www-authenticate':`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`}});}
    const cat=await catalogueOf();const tools=[...builtins(env,cat,origin),...definitions];
    if(request.method==='POST') {
      const body=await request.clone().json().catch(()=>null);
      if(body?.method==='tools/call') {
        const tool=tools.find(t=>t.name===body.params?.name);
        const schema=tool?.price?{...tool.inputSchema,properties:{...tool.inputSchema.properties,_payment:{type:'object'}}}:tool?.inputSchema;
        if(tool&&!validator.getValidator(schema)(body.params?.arguments??{}).valid)await audit(env,caller,tool.name,'invalid');
        if(!tool)await audit(env,caller,'unknown-tool','denied');
      }
    }
    const rate=async fresh=>{
      const limit=callsPerMinute(cat);
      if(!await rateLimit(env,fresh.id??`public:${request.headers.get('cf-connecting-ip')??'local'}`,limit))throw new Error('Rate limit reached');
    };
    const read=async(name,handler)=>{
      let outcome='error';
      try{const fresh=await currentCaller(env,ctx.props);await rate(fresh);const result=await handler(fresh);outcome='ok';return result;}
      finally{await audit(env,caller,name,outcome);}
    };
    const server=async()=>{
      const capabilities=await selling.machineCapabilities(env);
      const s=new McpServer({name:cat.studio?.name??'Homie studio',version:'1.0.0'},{jsonSchemaValidator:validator,capabilities:{experimental:{payment:{methods:capabilities.machine?.card?{stripe:{intents:['charge']}}:{}}}}});
      const dispatch=new Map();
      for (const meta of cat.games.filter(g=>g.kind==='app' && g.records?.persist)) {
        for (const [role,declared] of Object.entries(meta.roles??{})) {
          if (declared.signIn && !await allowed({app:meta.id,role},caller,env)) continue;
          for (const collection of Object.keys(meta.records.collections??{})) {
            if (!declared.can.includes('read:'+collection)) continue;
            const uri=`studio://records/${meta.id}/${role}/${collection}`;
            s.registerResource(`${meta.id}_${role}_${collection}`,uri,{description:'Untrusted app record data',mimeType:'application/json'},async()=>read('resource:'+meta.id+':'+collection,async fresh=>{
              const data=await services(env,cat,origin,fresh,'records').records({app:meta.id,role,collection});
              return {contents:[{uri,mimeType:'application/json',text:JSON.stringify({kind:'untrusted-record-data',data})}]};
            }));
          }
        }
      }
      for(const tool of tools){
        if (!await allowed(tool.audience,caller,env)) continue;
        if (tool.kind==='prompt') {
          if (!await allowed(tool.audience,caller,env)) continue;
          s.registerPrompt(tool.name,{description:tool.description,argsSchema:fromJsonSchema(tool.inputSchema,validator)},async(args)=>read('prompt:'+tool.name,async fresh=>{
            if(!await allowed(tool.audience,fresh,env))throw new Error('Permission denied');
            const text=await tool.handler(args,services(env,cat,origin,fresh,tool.namespace??tool.name,tool));
            return {messages:[{role:'user',content:{type:'text',text:JSON.stringify({kind:'studio-prompt-data',prompt:tool.name,data:text})}}]};
          }));continue;
        }
        const schema=tool.price?{...tool.inputSchema,properties:{...tool.inputSchema.properties,_payment:{type:'object'}}}:tool.inputSchema;
        const handler=async(args,extra)=>{
          let outcome='error';
          try{
            // Recheck inside dispatch, even when a connection listed tools earlier.
            const fresh=await currentCaller(env,ctx.props);
            if(!await allowed(tool.audience,fresh,env)){outcome='denied';throw new Error('Permission denied');}
            try{await rate(fresh);}catch(error){outcome='limited';throw error;}
            const context=services(env,cat,origin,fresh,tool.namespace??tool.name,tool);
            if(tool.price) {const result=await selling.paidTool(env,cat,origin,tool,args,context,extra);outcome=result.isError?'error':'ok';return result;}
            if(tool.protocol) {const result=await tool.handler(args,{...context,paymentExtra:extra});outcome=result.isError?'error':'ok';return result;}
            const value=await tool.handler(args,context);
            const text=JSON.stringify({kind:'untrusted-tool-data',tool:tool.name,data:value});
            outcome='ok';return {content:[{type:'text',text}]};
          }catch(error){if(error?.code===-32042)throw error;return {isError:true,content:[{type:'text',text:outcome==='denied'||outcome==='limited'?error.message:'Tool failed. Check the office audit and the tool definition.'}]};}
          finally{await audit(env,caller,tool.name,outcome);}
        };
        s.registerTool(tool.name,{description:tool.description,inputSchema:fromJsonSchema(schema,validator)},handler);
        dispatch.set(tool.name,{schema,handler});
      }
      // Payment binding errors are JSON-RPC errors, not tool failures. The SDK's
      // convenience dispatcher turns arbitrary errors into isError results; use its
      // public protocol handler to preserve mppx's standard -32042 challenge.
      s.server.setRequestHandler('tools/call',async(input,extra)=>{
        const entry=dispatch.get(input.params.name);
        if(!entry)return {isError:true,content:[{type:'text',text:'Permission denied or unknown tool'}]};
        const args=input.params.arguments??{};
        if(!validator.getValidator(entry.schema)(args).valid)return {isError:true,content:[{type:'text',text:'Invalid arguments'}]};
        try{return await entry.handler(args,{...extra,_meta:input.params._meta});}
        catch(error){if(error?.code===-32042)throw new ProtocolError(error.code,error.message,error.data);throw error;}
      });
      return s;
    };
    return createMcpHandler(server)(request,env,ctx);
  };
  const provider=new OAuthProvider({
    apiRoute:'/mcp',apiHandler:{fetch:api},
    authorizeEndpoint:'/oauth/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
    resourceMetadata:{resource:origin+'/mcp',authorization_servers:[origin]},
    scopesSupported:['studio','offline_access'],requiredScopes:['studio'],
    accessTokenTTL:3600,
    defaultHandler:{async fetch(req,env,ctx){
      const u=new URL(req.url),person=await browserPerson(req,env),oauth=env.OAUTH_PROVIDER;
      if(u.pathname==='/oauth/authorize'){
        if(!person)return html(`<h1>Sign in to your studio</h1><p>Use your existing studio account, then approve your AI.</p><a href="/account?next=${esc(encodeURIComponent(u.pathname+u.search))}">Sign in</a>`,{'x-frame-options':'DENY'});
        try{
          if(req.method==='GET'){
            const auth=await oauth.parseAuthRequest(req),description=await oauth.describeConsent(auth),transaction=await oauth.beginConsent(auth);
            await env.OAUTH_KV.put('consent-person:'+transaction.handle,person,{expirationTtl:600});
            return html(`<h1>Connect your AI</h1><p><strong>${esc(description.clientName)}</strong> asks to use this studio with your current permissions.</p><p>The app supplies this name. Approve only if you started this connection and recognize the return address.</p><p>Return address: ${esc(description.redirectHost)}. ${description.redirectIsLoopback?'This is a local app; any local process could be listening.':''}</p><p>Your AI can use your app roles. If you own the studio, it can use the office. Destructive office actions still need your confirmation. Revoke this connection in the office at any time.</p><form method="post"><input type="hidden" name="handle" value="${esc(transaction.handle)}"><button name="decision" value="allow">Allow connection</button> <button name="decision" value="deny">Cancel</button></form>`,transaction.headers);
          }
          if(req.method!=='POST'||!sameOrigin(req,u))return json({error:'same-origin POST required'},403);
          const form=await req.formData(),handle=String(form.get('handle')??'');
          if(form.get('decision')!=='allow'){const denied=await oauth.denyConsent(req,handle);return new Response(null,{status:302,headers:denied.headers});}
          if(await env.OAUTH_KV.get('consent-person:'+handle)!==person)return json({error:'Sign-in changed; restart the connection'},403);
          const approved=await oauth.approveConsent(req,handle,{scope:['studio','offline_access']});
          await env.OAUTH_KV.delete('consent-person:'+handle);
          const connection=crypto.randomUUID();
          await env.DB.prepare('INSERT INTO mcp_connections(id,person,client,created) VALUES(?1,?2,?3,?4)').bind(connection,person,approved.request.clientId,Date.now()).run();
          const result=await oauth.completeAuthorization({request:approved.request,userId:person,scope:['studio','offline_access'],metadata:{connection},props:{connection}});
          approved.headers.set('location',result.redirectTo);return new Response(null,{status:302,headers:approved.headers});
        }catch{return json({error:'Invalid or expired authorization request'},400);}
      }
      if(u.pathname==='/_studio/office/connections'){
        if(!person)return html('<h1>Sign in to manage AI connections</h1><a href="/account?next=/_studio/office/connections">Sign in</a>');
        const owner=await isOwner(req,env);
        if(req.method==='POST'){
          if(!sameOrigin(req,u))return json({error:'origin refused'},403);
          const f=await req.formData();const id=String(f.get('connection')??'');
          const connection=await env.DB.prepare('SELECT * FROM mcp_connections WHERE id=?1').bind(id).first();
          if(connection&&(owner||connection.person===person)){
            // Local denial takes effect first, even if upstream token cleanup must be retried.
            await env.DB.prepare('UPDATE mcp_connections SET revoked=1 WHERE id=?1').bind(id).run();
            let cursor;
            do{const grants=await oauth.listUserGrants(connection.person,{limit:100,cursor});
              for(const grant of grants.items)if(grant.metadata?.connection===id)await oauth.revokeGrant(grant.id,connection.person);
              cursor=grants.cursor;
            }while(cursor);
          }
          return Response.redirect(origin+u.pathname,303);
        }
        const page=Math.max(0,Math.min(100,Number.parseInt(u.searchParams.get('page')??'0',10)||0)),offset=page*100;
        const rows=(await env.DB.prepare(owner?'SELECT c.*,p.name FROM mcp_connections c LEFT JOIN players p ON p.id=c.person ORDER BY c.created DESC LIMIT 100 OFFSET ?1':'SELECT c.*,p.name FROM mcp_connections c LEFT JOIN players p ON p.id=c.person WHERE c.person=?1 ORDER BY c.created DESC LIMIT 100 OFFSET ?2').bind(...(owner?[offset]:[person,offset])).all()).results;
        const events=owner?(await env.DB.prepare('SELECT a.*,p.name FROM mcp_audit a LEFT JOIN players p ON p.id=a.person ORDER BY a.id DESC LIMIT 100 OFFSET ?1').bind(offset).all()).results:[];
        const names=new Map(await Promise.all([...new Set([...rows,...events].map(r=>r.client).filter(Boolean))].map(async id=>[id,(await oauth.lookupClient(id).catch(()=>null))?.clientName??id])));
        return html(`<h1>Your studio's AI connections</h1><p>MCP address: <code>${esc(origin)}/mcp</code></p><ul>${rows.map(r=>`<li>${esc(r.name??(r.person.startsWith('office-')?'Owner browser':r.person))} · ${esc(names.get(r.client))} · ${r.revoked?'Revoked':`<form method="post"><input type="hidden" name="connection" value="${esc(r.id)}"><button>Revoke</button></form>`}</li>`).join('')}</ul><h2>Recent tool calls</h2><ul>${events.map(r=>`<li>${esc(new Date(r.at).toISOString())} · ${esc(r.name??(r.person?.startsWith('office-')?'Owner browser':r.person)??'Public')} · ${esc(names.get(r.client)??'Anonymous')} · ${esc(r.tool)} · ${esc(r.outcome)}</li>`).join('')}</ul><nav>${page?`<a href="?page=${page-1}">Newer</a>`:''}${rows.length===100||events.length===100?`<a href="?page=${page+1}">Older</a>`:''}</nav>`);
      }
      return json({error:'not found'},404);
    }},
  });
  if(path==='/mcp'&&!request.headers.has('authorization')){
    // Public tools remain available without an account. Clients can discover OAuth metadata directly.
    return api(request,scoped,ctx);
  }
  return provider.fetch(request,scoped,ctx);
}
