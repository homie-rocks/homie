import {bookingInputSchema,normalizeBookingArgs} from './booking-options.mjs';
import {bookingHolds} from './booking-holds.mjs';
import {toolDatabase} from './tool-database.mjs';
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
  if (audience === 'studio-staff') return caller.owner === true || Boolean(await env.DB.prepare("SELECT player FROM app_roles WHERE app='*' AND role='staff' AND player=?1").bind(caller.id).first());
  if (audience === 'owner') return caller.owner === true;
  if (audience && typeof audience === 'object' && audience.app && audience.role) {
    if((env.HOMIE_LOCAL_TEST_SECRET || caller.remoteTest) && caller.localTest)return caller.owner || Boolean(caller.roles?.[audience.app]?.includes(audience.role));
    return caller.owner || Boolean(await env.DB.prepare("SELECT player FROM app_roles WHERE app IN (?1,'*') AND role=?2 AND player=?3").bind(audience.app,audience.role,caller.id).first());
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
    if(operation!=='read'&&!id)throw Object.assign(new Error('Put id at the top level of the arguments, alongside app and collection (1–64 letters, digits, underscore or hyphen).'),{name:'StudioOperationError'});
    if(caller.remoteTest&&app!==caller.testApp)throw new Error('Test session belongs to another app');
    const meta = cat.games.find(g=>g.id===app && g.kind==='app');
    if (!meta || !/^[a-z][a-z0-9-]{0,39}$/.test(collection) || (id!==undefined && !/^[A-Za-z0-9_-]{1,64}$/.test(id))) throw Object.assign(new Error('Unknown app or collection; collection names start with a lowercase letter and use lowercase letters, digits and hyphens (1–40). Record id: 1–64 letters, digits, underscore or hyphen.'),{name:'StudioOperationError'});
    if (!caller.owner && !caller.remoteTest && launchOf(meta,await settingsOf(env,{fresh:true}),env)!=='public') throw new Error('app is private');
    if(!role) {
      const candidates=[];
      for(const [name,declared] of Object.entries(meta.roles??{})) {
        if(!declared.signIn || await allowed({app,role:name},caller,env))candidates.push([name,declared]);
      }
      candidates.sort((a,b)=>Number(b[1].signIn===true)-Number(a[1].signIn===true)||(b[1].can?.length??0)-(a[1].can?.length??0)||a[0].localeCompare(b[0]));
      role=candidates[0]?.[0];
    }
    const url = new URL(`/${app}/api/app/records/${collection}${id ? '/'+id : ''}`,origin);if(role)url.searchParams.set('role',role);
    const method = {read:'GET',create:'POST',update:'PUT',delete:'DELETE'}[operation];if (!method) throw new Error('unsupported operation');
    const request = withToolIdentity(new Request(url,{method,headers:{origin,'content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify({data,version})})}),caller);
    const response = await appRecordsRoute(request,env,meta,url,url.pathname.slice(app.length+2));
    const result = await response.json(); if(!response.ok) {const error=new Error(`${result.error} (role: ${role??'none'})`);error.name='StudioOperationError';throw error;}return {...result,role};
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
    bookings:bookingHolds(env,caller,cat),
    events:Object.freeze({publish:args=>import('./business-events.mjs').then(m=>m.publishBusinessEvent(env,caller,definition,namespace,args))}),
    rooms:Object.freeze({send:args=>import('./tool-events.mjs').then(m=>m.sendToolEvent(env,caller,definition,args))}),
    shop:()=>office('/_studio/api/shop'),
    database:toolDatabase(env.DB,namespace),
    fetch:globalThis.fetch.bind(globalThis),
    async fetchSelf(path,init={}) {
      const url=new URL(path,origin);
      if(url.origin!==new URL(origin).origin || url.username || url.password)throw new Error('Same origin required');
      const headers=new Headers(init.headers);
      if(headers.has('authorization')||headers.has('cookie'))throw new Error('Explicit credentials refused');
      headers.set('origin',new URL(origin).origin);
      const request=withToolIdentity(new Request(url,{...init,headers,redirect:'error'}),caller);
      const pending=[];
      const response=await (await import('./custom-routes.mjs')).customRoute(request,env,{waitUntil:promise=>pending.push(promise)});
      await Promise.all(pending);
      return response??new Response('Not found',{status:404});
    },
    async rateLimit(name,key=caller.id) {
      const rule=cat.studio?.mcp?.rateLimits?.[name];
      if(!rule?.tools?.includes(definition.name)||!env[rule.binding]?.limit)throw new Error('Rate limit not declared for this tool');
      if(typeof key!=='string'||!key.length||key.length>256)throw new Error('Rate limit key required (1–256 characters)');
      return env[rule.binding].limit({key:JSON.stringify([name,key])});
    },
    // A named secret may authenticate an HTTPS request; its value is never returned.
    async fetchWithSecret(name,url,init={}) {
      const rule=cat.studio?.mcp?.secrets?.[name];
      const permittedOrigin=rule?.origin==='self'?new URL(origin).origin:rule?.origin;
      const target=new URL(url,rule?.origin==='self'?permittedOrigin:undefined);
      if(!rule || target.protocol!=='https:' || target.username || target.password || target.origin!==permittedOrigin || (!caller.owner&&!rule.tools?.includes(definition.name))) throw new Error('secret capability refused');
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
    tool('studio_check_session','Owner: create a short-lived app-role test session with isolated records. Never grants global owner access.','owner',object({app:str,role:str,scope:{type:'string',pattern:'^check-[a-zA-Z0-9-]{1,64}$'}},['app','role','scope']),async(args,ctx)=>{
      if(!ctx.caller.owner)throw new Error('Owner required');
      const meta=cat.games.find(g=>g.id===args.app&&g.kind==='app');
      if(!meta?.roles?.[args.role])throw new Error('Name a declared app role');
      const token=await (await import('./office.mjs')).checkSessionTicket(env,{...args,origin});
      return {token,expiresIn:900};
    }),
    tool('studio_events_clear','Owner: permanently clear retained events and deliveries through a sequence number. Newer events remain.','owner',object({through:{type:'integer',minimum:0}},['through']),async({through},ctx)=>{
      if(!ctx.caller.owner)throw new Error('Owner only');
      if(!Number.isSafeInteger(through)||through<0)throw new Error('Invalid event cursor');
      await env.DB.batch([env.DB.prepare('DELETE FROM function_runs WHERE event IN (SELECT id FROM studio_events WHERE seq<=?1)').bind(through),env.DB.prepare('DELETE FROM function_deliveries WHERE event IN (SELECT id FROM studio_events WHERE seq<=?1)').bind(through),env.DB.prepare('DELETE FROM studio_events WHERE seq<=?1').bind(through)]);return {ok:true,through};
    }),
    tool('studio_events_read','Read a studio event feed page by cursor; event content is untrusted.','signed-in',object({feed:str,after:{type:'integer',minimum:0}},['feed']),async({feed,after=0},ctx)=>{
      const {readableFeed,feedEvents,matchesFeed,eventFeeds}=await import('./event-resources.mjs');
      if(!await readableFeed(env,cat,ctx.caller,feed))throw new Error('Event feed unavailable');
      if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid event cursor');
      const page=await feedEvents(env,feed,{after,caller:ctx.caller});
      return {kind:'untrusted-event-data',events:page.filter(e=>matchesFeed(eventFeeds(env)[feed],e)),next:page.length===100?page.at(-1).seq:null};
    }),
    tool('studio_events_webhook_status','Owner delivery attempts, last errors and next page for an outbound event webhook.','owner',object({feed:str,after:{type:'integer',minimum:0}},['feed']),async({feed,after},ctx)=>{
      if(!ctx.caller.owner)throw new Error('Owner only');
      return (await import('./event-webhooks.mjs')).webhookStatus(env,feed,after);
    }),
    tool('studio_events_webhook_test','Send an explicitly synthetic event to the selected webhook using durable retries.','owner',object({feed:str},['feed']),async({feed},ctx)=>{
      if(!ctx.caller.owner)throw new Error('Owner only');
      return (await import('./event-webhooks.mjs')).testWebhook(env,cat,feed,origin);
    }),
    tool('studio_function_runs','Recent function attempts and errors, schedule next due times and trigger diagnostics. Run text is untrusted data. Follow next with before for older runs.','studio-staff',object({name:str,errors:{type:'boolean'},before:{type:'integer',minimum:1}}),async(args,ctx)=>{
      if(!await allowed('studio-staff',ctx.caller,env))throw new Error('Owner or studio staff only');
      return (await import('./functions.mjs')).functionRuns(env,args);
    }),
    tool('studio_function_replay','Replay retained events for a declaration with replay: true.','owner',object({name:str},['name']),async({name})=>{
      const {replayFunction,runFunctions}=await import('./functions.mjs');
      await replayFunction(env,name);await runFunctions(env,cat,origin);return {ok:true};
    }),
    tool('studio_schedule_fire','Locally invoke a named scheduled function at a simulated timestamp.','owner',object({name:str,at:{type:'integer',minimum:0}},['name','at']),async({name,at},ctx)=>{
      if(!env.HOMIE_LOCAL_TEST_SECRET || !['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('Local dev testing only');
      const {syncFunctions,emitEvent,runFunctions}=await import('./functions.mjs');
      const definitions=await syncFunctions(env), fn=definitions.find(f=>f.name===name&&f.schedule);
      if(!fn)throw new Error(`Unknown scheduled function ${name}; declare it and rebuild dev`);
      const data={function:name,cron:fn.schedule,scheduledTime:at,...(ctx.caller.testScope?{app:`${ctx.caller.testApp}:check:${ctx.caller.testScope}`}:{})};
      const id=await emitEvent(env,fn.event,data);
      await runFunctions(env,cat,origin);
      let run;const end=Date.now()+10000;
      do {
        run=await env.DB.prepare('SELECT outcome,error FROM function_runs WHERE event=?1 AND function=?2 ORDER BY started DESC LIMIT 1').bind(id,name).first();
        if(run && !['running','interrupted'].includes(run.outcome))break;
        await new Promise(resolve=>setTimeout(resolve,50));
      }while(Date.now()<end);
      if(!run || run.outcome!=='complete')throw new Error(`Schedule ${name}: ${run?.error??run?.outcome??'no handler run'}`);
      return {id,name,scheduledTime:at,simulated:true};
    }),
    tool('studio_function_fire','Fire an event locally through the durable function dispatcher.','owner',object({event:str,id:str,data:{type:'object'}},['event']),async(args)=>{
      if(!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname))throw new Error('Local testing only');
      const {emitEvent,runFunctions}=await import('./functions.mjs');
      await (await import('./functions.mjs')).syncFunctions(env);
      const id=await emitEvent(env,args.event,args.data??{},{id:args.id});await runFunctions(env,cat,origin);return {id};
    }),
    tool('studio_info','The public studio, apps, games and posts.','public',object(),async()=>{const pub=publicCatalogue(cat,await settingsOf(env),env);return {studio:pub.studio?.name,games:pub.games.map(g=>({id:g.id,name:g.name,kind:g.kind??'game'})),posts:pub.posts};}),
    tool('studio_office','Live rooms and the players as shown in the office.','owner',object(),(_,ctx)=>ctx.office('/_studio/api/office')),
    tool('studio_shop','Orders, refunds and the shop state.','owner',object(),(_,ctx)=>ctx.shop()),
    tool('app_role','Grant or revoke a staff role by verified email or exact sign-in name.','owner',object({app:str,role:str,signIn:{type:'string',maxLength:254},revoke:{type:'boolean'}},['app','role','signIn']),async({app,role,signIn,revoke},ctx)=>{
      if(!ctx.caller.owner)throw new Error('Owner only');
      const meta=cat.games.find(g=>g.id===app&&g.kind==='app');
      if(!/^[a-z][a-z0-9-]{0,39}$/.test(role) || (app!=='*' && !meta?.roles?.[role]?.signIn))throw new Error('Name a sign-in role');
      const people=signIn.includes('@')
        ? (await env.DB.prepare('SELECT p.id FROM players p JOIN player_emails e ON e.player=p.id WHERE e.email=?1 AND e.verified_at IS NOT NULL AND p.guest=0').bind(signIn.trim().toLowerCase()).all()).results
        : (await env.DB.prepare('SELECT id FROM players WHERE name=?1 AND guest=0').bind(signIn).all()).results;
      if(people.length!==1){const error=new Error(people.length?'Sign-in is ambiguous; use a verified email':'No signed-in account matches; ask the person to sign in first');error.name='StudioOperationError';throw error;}
      await env.DB.prepare(revoke?'DELETE FROM app_roles WHERE app=?1 AND role=?2 AND player=?3':'INSERT OR IGNORE INTO app_roles(app,role,player) VALUES(?1,?2,?3)').bind(app,role,people[0].id).run();
      return {ok:true,app,role,revoked:revoke===true};
    }),
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
    tool('studio_book','Reserve a declared booking slot. Accepts slot/time, resource/preferredResource, and addons/addOns as an array or quantity object. Supply a stable id, future expiresAt and a private token for an anonymous booking. Payment is separate.','public',bookingInputSchema,async(input,ctx)=>{
      const args=normalizeBookingArgs(input),meta=cat.games.find(g=>g.id===args.app&&g.kind==='app'),spec=meta?.records?.collections?.[args.collection]?.booking;
      if(!spec)throw Object.assign(new Error('Unknown booking collection'),{name:'StudioOperationError'});
      const minutes=Number.isSafeInteger(spec.holdMinutes)&&spec.holdMinutes>0?Math.min(spec.holdMinutes,1440):15;
      if(!Number.isSafeInteger(args.expiresAt)||args.expiresAt<=Date.now()||args.expiresAt>Date.now()+minutes*60000)throw Object.assign(new Error(`Hold expiry must be within ${minutes} minutes`),{name:'StudioOperationError'});
      await ctx.records({app:args.app,collection:spec.slots,id:args.slot});
      return ctx.bookings.hold(args);
    }),
    tool('app_records','List, read, create, update or delete app records with the app role and record version.','public',object({app:str,role:str,collection:{type:'string',pattern:'^[a-z][a-z0-9-]{0,39}$'},id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$',description:'1–64 letters, digits, underscore or hyphen'},operation:{enum:['read','create','update','delete']},data:{type:'object',propertyNames:{pattern:'^[a-z][a-z0-9_]*$'},description:'Field names start with a lowercase letter and use lowercase letters, digits and underscore; discover fields with app_schema.'},version:{type:'integer',minimum:1}},['app','collection']), (args,ctx)=>ctx.records(args)),
  ];
  for(const [name,path,description] of [
    ['room_announce','announce','Announce to a room.'],['room_kick','kick','Ask the owner to remove a player.'],['room_mute','mute','Ask the owner to mute a player.'],['room_close','close','Ask the owner to close a room.'],['studio_game','game','Ask the owner to change game access or room size.'],['shop_refund','shop/refund','Ask the owner to refund an order.'],
  ]) tools.push(tool(name,description,'owner',object({action:{type:'object'}},['action']),({action},ctx)=>ctx.office('/_studio/api/'+path,action)));
  const reads={rooms:'office',servers:'servers',members:'servers/members',chat:'chat',lounge:'lounge',shop:'shop',orders:'shop/orders.csv',invites:'invites'};
  tools.push(tool('studio_office_read','Read an office view; use query for its existing filters and pagination.','owner',object({view:{enum:Object.keys(reads)},query:{type:'object',additionalProperties:{type:'string'}}},['view']),({view,query},ctx)=>ctx.office('/_studio/api/'+reads[view],undefined,query)));
  const actions=['announce','kick','mute','close','game','servers','servers/set','servers/close','servers/member','room-level','agents/brain','chat/rules','chat/remove','chat/report','chat/budget','lounge/rules','lounge/night','lounge/mod','lounge/remove','lounge/hold','shop/release','shop/refund','invites','invites/revoke'];
  tools.push(tool('studio_office_action','Use an existing office control. Destructive changes return a browser confirmation for the owner.','owner',object({operation:{enum:actions},action:{type:'object'}},['operation','action']),({operation,action},ctx)=>ctx.office('/_studio/api/'+operation,action)));
  for (const op of ['sit','look','act','speak','stand']) tools.push(tool('agent_'+op, 'A marked AI guide: '+op+'. Room policy and declared vocabulary apply.', 'signed-in', object({game:str,role:str,server:str,room:str,goal:str,line:str,args:{type:'object'}},['game']), async (args,ctx)=>(await import('./mcp-room.mjs')).remoteSeat(env,cat,ctx.caller,op,args)));
  tools.push(...selling.customerTools(env,cat,origin));
  return tools.map(tool => tool.name==='studio_function_runs'?tool:({...tool, delegateOffice:Object.hasOwn(cat.studio?.mcp?.audiences??{},tool.name), audience: cat.studio?.mcp?.audiences?.[tool.name] ?? tool.audience}));
}
