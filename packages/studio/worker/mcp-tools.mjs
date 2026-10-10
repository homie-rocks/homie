import { selling } from './extensions.mjs';
import { withToolIdentity } from './tool-identity.mjs';
import { officeRoutes } from './office.mjs';
import { appRecordsRoute } from './app-records.mjs';
import { players } from './players.mjs';
import { readStats, rangeOf } from './stats.mjs';
import { publicCatalogue, settingsOf, launchOf } from './office.mjs';
export const object = (properties = {}, required = []) => ({type:'object',properties,required,additionalProperties:false});
const str = {type:'string',maxLength:128};
export async function allowed(audience, caller, env) {
  if (audience === 'public') return true;
  if (!caller.id) return false;
  if (audience === 'signed-in') return true;
  if (audience === 'owner') return caller.owner === true;
  if (audience && typeof audience === 'object' && audience.app && audience.role) {
    return caller.owner || Boolean(await env.DB.prepare('SELECT player FROM app_roles WHERE app=?1 AND role=?2 AND player=?3').bind(audience.app,audience.role,caller.id).first());
  }
  return false;
}
export async function currentCaller(env, props) {
  if (!props?.connection) return {id:null,owner:false,client:null};
  const row = await env.DB.prepare('SELECT * FROM mcp_connections WHERE id=?1 AND revoked=0').bind(props.connection).first();
  if (!row) throw new Error('connection revoked');
  if (row.person.startsWith('office-')) {
    const key = await env.DB.prepare("SELECT kind FROM stats_keys WHERE hash=?1 AND kind='session' AND expires_at>?2").bind(row.person.slice(7),Date.now()).first();
    if (!key) throw new Error('owner session expired');
    return {id:row.person,owner:true,client:row.client,connection:row.id};
  }
  const p = await env.DB.prepare('SELECT id,name,owner,guest FROM players WHERE id=?1').bind(row.person).first();
  if (!p || p.guest) throw new Error('account unavailable');
  const grants=(await env.DB.prepare('SELECT app,role FROM app_roles WHERE player=?1').bind(p.id).all()).results;
  const roles=Object.create(null);for(const grant of grants??[])(roles[grant.app]??=[]).push(grant.role);
  return {id:p.id,name:p.name,owner:p.owner===1,roles,client:row.client,connection:row.id};
}
export function services(env, cat, origin, caller, namespace, definition = {}) {
  const records = async ({app,role,collection,id,operation='read',data,version}) => {
    const meta = cat.games.find(g=>g.id===app && g.kind==='app');
    if (!meta || !/^[a-z][a-z0-9-]{0,39}$/.test(collection) || (id!==undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw new Error('unknown app, collection or record');
    if (!caller.owner && launchOf(meta,await settingsOf(env,{fresh:true}),env)!=='public') throw new Error('app is private');
    const url = new URL(`/${app}/api/app/records/${collection}${id ? '/'+id : ''}`,origin);if(role)url.searchParams.set('role',role);
    const method = {read:'GET',create:'POST',update:'PUT'}[operation];if (!method) throw new Error('unsupported operation');
    const request = withToolIdentity(new Request(url,{method,headers:{origin,'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({data,version})})}),caller);
    const response = await appRecordsRoute(request,env,meta,url,url.pathname.slice(app.length+2));
    const result = await response.json(); if(!response.ok) throw new Error(result.error);return result;
  };
  const office = async (path, body, query={}) => {
    const delegated=definition.delegateOffice && await allowed(definition.audience,caller,env);
    if ((!caller.owner && !delegated) || !/^\/_studio\/api\//.test(path) || path.includes('..') || path.includes('?')) throw new Error('owner only');
    const url = new URL(path,origin);
    for(const [key,value] of Object.entries(query))url.searchParams.set(key,String(value));
    const request = withToolIdentity(new Request(url,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),delegated?{...caller,owner:true}:caller);
    const response = await officeRoutes(request,env,url,{catalogueOf:async()=>cat});
    const result = response.headers.get('content-type')?.includes('application/json')?await response.json():{text:await response.text()}; if(!response.ok && response.status!==202) throw new Error(result.error);return result;
  };
  const key = v=>{if(typeof v!=='string'||v.length>128||!v.length)throw new Error('invalid key');return v;};
  return Object.freeze({
    caller:Object.freeze({...caller,roles:Object.freeze(Object.fromEntries(Object.entries(caller.roles??{}).map(([app,roles])=>[app,Object.freeze([...roles])])) )}), records, office,
    rooms:Object.freeze({send:args=>import('./tool-events.mjs').then(m=>m.sendToolEvent(env,caller,definition,args))}),
    shop:()=>office('/_studio/api/shop'),
    database:Object.freeze({
      async get(k){const r=await env.DB.prepare('SELECT value FROM tool_data WHERE namespace=?1 AND key=?2').bind(namespace,key(k)).first();return r?JSON.parse(r.value):null;},
      async put(k,value){const text=JSON.stringify(value);await env.DB.prepare('INSERT INTO tool_data(namespace,key,value) VALUES(?1,?2,?3) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').bind(namespace,key(k),text).run();},
    }),
    fetch:globalThis.fetch.bind(globalThis),
    // A named secret may authenticate an HTTPS request; its value is never returned.
    async fetchWithSecret(name,url,init={}) {
      const rule=cat.studio?.mcp?.secrets?.[name]; const target=new URL(url);
      if(!rule || target.protocol!=='https:' || target.origin!==rule.origin || (!caller.owner&&!rule.tools?.includes(definition.name))) throw new Error('secret capability refused');
      const secret=env[name];if(typeof secret!=='string')throw new Error('secret unavailable');
      const headers=new Headers(init.headers);headers.set(rule.header??'authorization',`${rule.prefix??'Bearer '}${secret}`);
      const res=await fetch(target,{...init,headers,redirect:'error'});
      // Do not return a remote echo of credentials.
      const text=await res.text();if(text.includes(secret))throw new Error('response contained a credential');
      return new Response([204,205,304].includes(res.status)?null:text,{status:res.status,headers:{'content-type':res.headers.get('content-type')??'text/plain'}});
    },
    async ai(model,input){if((!caller.owner&&!cat.studio?.mcp?.aiTools?.includes(definition.name))||!env.AI)throw new Error('Workers AI unavailable');return env.AI.run(model,input);},
  });
}
export function builtins(env,cat,origin) {
  const tool=(name,description,audience,inputSchema,handler)=>({name,description,audience,inputSchema,handler});
  const tools=[
    tool('studio_function_replay','Replay retained events for a declaration with replay: true.','owner',object({name:str},['name']),async({name})=>{
      const {replayFunction,runFunctions}=await import('./functions.mjs');
      await replayFunction(env,name);await runFunctions(env,cat,origin);return {ok:true};
    }),
    tool('studio_function_fire','Fire an event locally through the durable function dispatcher.','owner',object({event:str,id:str,data:{type:'object'}},['event']),async(args)=>{
      if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('Local testing only');
      const {emitEvent,runFunctions}=await import('./functions.mjs');
      const id=await emitEvent(env,args.event,args.data??{},{id:args.id});await runFunctions(env,cat,origin);return {id};
    }),
    tool('studio_info','The public studio, apps, games and posts.','public',object(),async()=>{const pub=publicCatalogue(cat,await settingsOf(env),env);return {studio:pub.studio?.name,games:pub.games.map(g=>({id:g.id,name:g.name,kind:g.kind??'game'})),posts:pub.posts};}),
    tool('studio_office','Live rooms and the players as shown in the office.','owner',object(),(_,ctx)=>ctx.office('/_studio/api/office')),
    tool('studio_shop','Orders, refunds and the shop state.','owner',object(),(_,ctx)=>ctx.shop()),
    tool('studio_players','The studio accounts as shown in the office.','owner',object({query:str}),({query})=>players.list(env,{q:query})),
    tool('studio_stats','Studio visits and plays.','owner',object(),()=>readStats(env,cat,{range:rangeOf(new URLSearchParams())})),
    tool('studio_posts','Published posts.','public',object(),()=>({posts:cat.posts??[]})),
    tool('studio_parts','Parts this studio has chosen to share.','public',object(),async()=>{const r=await env.ASSETS.fetch(new Request(origin+'/parts/index.json'));return r.ok?r.json():{parts:[]};}),
    tool('app_schema','Discover an app’s record fields, valid values and the roles available to this caller before reading or changing records.','public',object({app:str},['app']),async({app},ctx)=>{
      const meta=cat.games.find(g=>g.id===app&&g.kind==='app');
      if(!meta||(!ctx.caller.owner&&launchOf(meta,await settingsOf(env,{fresh:true}),env)!=='public'))throw new Error('app unavailable');
      const roles={};for(const [role,definition] of Object.entries(meta.roles??{}))if(!definition.signIn||await allowed({app,role},ctx.caller,env))roles[role]={can:definition.can,signIn:Boolean(definition.signIn)};
      const collections=new Set(Object.values(roles).flatMap(r=>r.can.map(cap=>cap.split(':')[1])));
      return {app,roles,collections:Object.fromEntries(Object.entries(meta.records?.collections??{}).filter(([name])=>collections.has(name)))};
    }),
    tool('app_records','List, read, create or update app records with the app role and record version.','public',object({app:str,role:str,collection:str,id:str,operation:{enum:['read','create','update']},data:{type:'object'},version:{type:'integer',minimum:1}},['app','collection']), (args,ctx)=>ctx.records(args)),
  ];
  for(const [name,path,description] of [
    ['room_announce','announce','Announce to a room.'],['room_kick','kick','Ask the owner to remove a player.'],['room_mute','mute','Ask the owner to mute a player.'],['room_close','close','Ask the owner to close a room.'],['studio_game','game','Ask the owner to change game access or room size.'],['shop_refund','shop/refund','Ask the owner to refund an order.'],
  ]) tools.push(tool(name,description,'owner',object({action:{type:'object'}},['action']),({action},ctx)=>ctx.office('/_studio/api/'+path,action)));
  const reads={rooms:'office',servers:'servers',members:'servers/members',chat:'chat',lounge:'lounge',shop:'shop',orders:'shop/orders.csv',lines:'shop/lines',received:'shop/received',statements:'shop/statements',invites:'invites'};
  tools.push(tool('studio_office_read','Read an office view; use query for its existing filters and pagination.','owner',object({view:{enum:Object.keys(reads)},query:{type:'object',additionalProperties:{type:'string'}}},['view']),({view,query},ctx)=>ctx.office('/_studio/api/'+reads[view],undefined,query)));
  const actions=['announce','kick','mute','close','game','servers','servers/set','servers/close','servers/member','room-level','agents/brain','chat/rules','chat/remove','chat/report','chat/budget','lounge/rules','lounge/night','lounge/mod','lounge/remove','lounge/hold','shop/release','shop/refund','shop/settle','invites','invites/revoke'];
  tools.push(tool('studio_office_action','Use an existing office control. Destructive changes return a browser confirmation for the owner.','owner',object({operation:{enum:actions},action:{type:'object'}},['operation','action']),({operation,action},ctx)=>ctx.office('/_studio/api/'+operation,action)));
  for (const op of ['sit','look','act','speak','stand']) tools.push(tool('agent_'+op, 'A marked AI guide: '+op+'. Room policy and declared vocabulary apply.', 'signed-in', object({game:str,role:str,server:str,room:str,goal:str,line:str,args:{type:'object'}},['game']), async (args,ctx)=>(await import('./mcp-room.mjs')).remoteSeat(env,cat,ctx.caller,op,args)));
  tools.push(...selling.customerTools(env,cat,origin));
  return tools.map(tool => ({...tool, delegateOffice:Object.hasOwn(cat.studio?.mcp?.audiences??{},tool.name), audience: cat.studio?.mcp?.audiences?.[tool.name] ?? tool.audience}));
}
