import {allowed,currentCaller} from './mcp-tools.mjs';
import {settingsOf,launchOf} from './office.mjs';

/** Explicit studio declarations only; these also retain their event types. */
export function eventFeeds(env) {
  return JSON.parse(env.STUDIO_EVENT_FEEDS??'{}');
}
export function feedSubscriptions(env) {
  return Object.entries(eventFeeds(env)).map(([name,feed])=>({name:'@events/'+name,event:feed.event}));
}
export const feedUri=name=>'studio://events/'+name;
export async function readableFeed(env,cat,caller,name) {
  const feed=eventFeeds(env)[name];
  if(!feed||!caller.id||!await allowed(feed.audience??'owner',caller,env))return false;
  if(feed.event==='record.changed') {
    const app=cat.games.find(g=>g.id===feed.app&&g.kind==='app');
    if(!app||!app.records?.collections?.[feed.collection])return false;
    if(caller.owner)return true;
    if(launchOf(app,await settingsOf(env,{fresh:true}),env)!=='public')return false;
    return Object.entries(app.roles??{}).some(([role,decl])=>decl.can.includes('read:'+feed.collection)&&(!decl.signIn||caller.roles?.[app.id]?.includes(role)));
  }
  // Non-record events have no app read capability; they remain owner-only.
  return caller.owner===true;
}
export async function feedEvents(env,name,{after=0,through=Number.MAX_SAFE_INTEGER}={}) {
  const feed=eventFeeds(env)[name];if(!feed)return [];
  const rows=(await env.DB.prepare('SELECT seq,id,type,data,at FROM studio_events WHERE type=?1 AND seq>?2 AND seq<=?3 ORDER BY seq LIMIT 100').bind(feed.event,after,through).all()).results;
  return rows.map(r=>({...r,data:JSON.parse(r.data)}));
}
export function matchesFeed(feed,event) {
  return feed.event===event.type && (feed.event!=='record.changed'||(event.data.app===feed.app&&event.data.collection===feed.collection));
}
const key=(connection,name)=>'event-sub:'+connection+':'+name;
export async function subscribeFeed(env,cat,caller,uri,remove=false) {
  const name=uri?.startsWith('studio://events/')?uri.slice(16):'';
  if(!/^[a-z][a-z0-9-]*$/.test(name)||!await readableFeed(env,cat,caller,name))throw new Error('Event resource unavailable');
  if(remove)await env.DB.prepare('DELETE FROM mcp_kv WHERE key=?1').bind(key(caller.connection,name)).run();
  else {
    const seq=(await env.DB.prepare('SELECT COALESCE(MAX(seq),0) seq FROM studio_events').first()).seq;
    await env.DB.prepare('INSERT OR IGNORE INTO mcp_kv(key,value,expires) VALUES(?1,?2,NULL)').bind(key(caller.connection,name),JSON.stringify({connection:caller.connection,name,after:seq})).run();
  }
}
export function eventHub(env,connection) {return env.LOBBY.get(env.LOBBY.idFromName('@studio-events/'+connection));}
export async function pushEvents(env,cat,origin) {
  if(!env.LOBBY||!Object.keys(eventFeeds(env)).length)return;
  // Page subscriptions, without a studio-wide subscription or delivery cap.
  let after='';const seen=new Set();
  for(;;){
    const rows=(await env.DB.prepare("SELECT key,value FROM mcp_kv WHERE key LIKE 'event-sub:%' AND key>?1 ORDER BY key LIMIT 100").bind(after).all()).results;
    for(const row of rows){const {connection}=JSON.parse(row.value);if(seen.has(connection))continue;seen.add(connection);
      const response=await eventHub(env,connection).fetch('https://events/__studio_events',{method:'POST',body:JSON.stringify({op:'wake',connection,cat,origin})});
      if(!response.ok)throw new Error('Event stream wake failed');
    }
    if(rows.length<100)break;after=rows.at(-1).key;
  }
}

/** One existing Lobby object per OAuth connection: streams never live in a Worker isolate. */
export class EventStreams {
  constructor(env,ctx){this.env=env;this.ctx=ctx;this.stream=null;this.tail=Promise.resolve();}
  close(stream){stream.cancelled=true;stream.resume?.();try{stream.controller.close();}catch{}if(this.stream===stream)this.stream=null;}
  background(input){this.ctx.waitUntil(this.wake(input).catch(error=>{if(this.stream)this.close(this.stream);console.error('Event stream delivery failed',error);}));}
  async fetch(request) {
    const input=await request.json();
    if(input.op==='stream') {
      // A reconnect replaces the previous GET, including a half-open socket.
      if(this.stream)this.close(this.stream);
      await this.tail;
      const {connection,lastId}=input;
      const subscriptions=(await this.env.DB.prepare("SELECT value FROM mcp_kv WHERE key LIKE ?1").bind('event-sub:'+connection+':%').all()).results;
      let after=subscriptions.length?Math.min(...subscriptions.map(r=>JSON.parse(r.value).after)):(await this.env.DB.prepare('SELECT COALESCE(MAX(seq),0) seq FROM studio_events').first()).seq,name='';
      if(lastId){const parts=lastId.split('/');if(parts.length!==3||parts[0]!==connection||!/^\d+$/.test(parts[1]))return new Response('Invalid Last-Event-ID',{status:400});after=Number(parts[1]);name=parts[2];}
      const stream={...input,after,name,controller:null,cancelled:false,resume:null};
      const body=new ReadableStream({start:controller=>{stream.controller=controller;controller.enqueue(new TextEncoder().encode(': connected\n\n'));},pull:()=>{const resume=stream.resume;stream.resume=null;resume?.();},cancel:()=>this.close(stream)});
      this.stream=stream;
      // Replay and later wakes share one ordered pump. Backpressure must not
      // hold up the writer's request or a function handler.
      this.background(input);
      return new Response(body,{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});
    }
    this.background(input);return new Response(null,{status:204});
  }
  wake(input){const work=this.tail.then(()=>this.deliver(input));this.tail=work.catch(()=>{});return work;}
  async deliver(input) {
    const stream=this.stream;if(!stream)return;
    let caller;
    try{caller=await currentCaller(this.env,{connection:input.connection});}
    catch{this.close(stream);return;}
    const rows=(await this.env.DB.prepare("SELECT value FROM mcp_kv WHERE key LIKE ?1").bind('event-sub:'+caller.connection+':%').all()).results;
    const subscriptions=[];
    for(const row of rows){const sub=JSON.parse(row.value);if(await readableFeed(this.env,input.cat,caller,sub.name))subscriptions.push(sub);}
    const through=(await this.env.DB.prepare('SELECT COALESCE(MAX(seq),0) seq FROM studio_events').first()).seq;
    let cursor=Math.max(0,stream.after-1);
    for(;;){
      const events=(await this.env.DB.prepare('SELECT seq,id,type,data,at FROM studio_events WHERE seq>?1 AND seq<=?2 ORDER BY seq LIMIT 100').bind(cursor,through).all()).results;
      for(const raw of events){const event={...raw,data:JSON.parse(raw.data)};
        for(const sub of subscriptions.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
          if(event.seq<=sub.after||event.seq<stream.after||event.seq===stream.after&&sub.name<=stream.name||!matchesFeed(eventFeeds(this.env)[sub.name],event))continue;
          if(stream.cancelled)return;
          if(stream.controller.desiredSize<=0)await new Promise(resolve=>{stream.resume=resolve;});
          if(stream.cancelled)return;
          // Recheck identity and grants for every event, including replay.
          const fresh=await currentCaller(this.env,{connection:caller.connection}).catch(()=>null);
          if(!fresh){this.close(stream);return;}
          if(!await readableFeed(this.env,input.cat,fresh,sub.name))continue;
          const id=`${caller.connection}/${event.seq}/${sub.name}`;
          const notification={jsonrpc:'2.0',method:'notifications/resources/updated',params:{uri:feedUri(sub.name),_meta:{'studio/event':event}}};
          try{stream.controller.enqueue(new TextEncoder().encode(`id: ${id}\nevent: message\ndata: ${JSON.stringify(notification)}\n\n`));}catch{this.close(stream);return;}
          stream.after=event.seq;stream.name=sub.name;
        }
      }
      if(events.length<100)break;cursor=events.at(-1).seq;
    }
  }
}
