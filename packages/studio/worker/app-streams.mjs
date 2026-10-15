import {databaseBinding} from './request-db.mjs';
import {appAccess} from './app-records.mjs';
import {localSession} from './local-test.mjs';
import {settingsOf,launchOf,accessOf} from './office.mjs';
export const APP_LIVE_MIGRATION_FILE='0027_app_live.sql';
export const APP_LIVE_MIGRATION=`
CREATE TABLE app_record_revisions(app TEXT NOT NULL,collection TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(app,collection));
${['INSERT','UPDATE','DELETE'].map(op=>{const row=op==='DELETE'?'OLD':'NEW';return `CREATE TRIGGER app_records_live_${op.toLowerCase()} AFTER ${op} ON app_records BEGIN
 INSERT INTO app_record_revisions VALUES(${row}.app,${row}.collection,1) ON CONFLICT(app,collection) DO UPDATE SET revision=revision+1;
END;`;}).join('\n')}
`;
const frame=value=>new TextEncoder().encode('data: '+JSON.stringify(value)+'\n\n');
export const appHub=(env,app)=>env.LOBBY.get(env.LOBBY.idFromName('@app-records/'+app));
const pushedRevisions=new WeakMap();
export async function pushAppRecords(env,cat){
 const apps=(cat.games??[]).filter(g=>g.kind==='app');
 if(!env.LOBBY||!env.DB||!apps.length)return;
 const rows=(await env.DB.prepare(`SELECT app,collection,revision FROM app_record_revisions
 UNION ALL SELECT a.app,'*',SUM(COALESCE(r.revision,0)) FROM app_tool_namespaces a LEFT JOIN tool_data_revisions r ON r.namespace=a.namespace GROUP BY a.app`).all()).results;
 const signatures=new Map();for(const row of rows){const app=row.app.split(':check:')[0];signatures.set(app,(signatures.get(app)??'')+JSON.stringify(row));}
 const binding=databaseBinding(env.DB),previous=pushedRevisions.get(binding)??new Map();
 for(const meta of apps){
  const signature=signatures.get(meta.id)??'';
  if((previous.get(meta.id)??'')===signature)continue;
  const response=await appHub(env,meta.id).fetch('https://app/__app_records',{method:'POST',body:JSON.stringify({op:'wake',meta})});
  if(!response.ok)throw new Error('App notification wake failed');
  previous.set(meta.id,signature);
 }
 pushedRevisions.set(binding,previous);
}
/** Collection invalidations, never record bodies or identifiers. Reads recheck current authorization. */
export class AppRecordStreams {
 constructor(env,ctx){this.env=env;this.ctx=ctx;this.streams=new Set();}
 dispose(){for(const s of [...this.streams])this.close(s);}
 close(s){if(!this.streams.delete(s))return;clearInterval(s.timer);try{s.controller.close();}catch{}this.presence();}
 count(s){return [...this.streams].filter(x=>x.app===s.app&&x.room===s.room).length;}
 send(s,data){if(s.controller.desiredSize<=0){this.close(s);return;}try{s.controller.enqueue(frame(data));}catch{this.close(s);}}
 presence(){for(const s of this.streams)this.send(s,{presence:this.count(s)});}
 async authorized(s){
  const access=await appAccess(s.request,this.env,s.meta,s.url);
  if(!access.ok||s.collections.some(c=>!access.can.includes('read:'+c)))return false;
  const launch=launchOf(s.meta,await settingsOf(this.env,{fresh:true}),this.env);
  return launch==='public'||(await accessOf(s.request,this.env,s.meta.id,launch)).ok;
 }
 async revisions(s){return (await this.env.DB.prepare("SELECT collection,revision FROM app_record_revisions WHERE app=?1 UNION ALL SELECT '*',COALESCE(SUM(r.revision),0) FROM app_tool_namespaces a JOIN tool_data_revisions r ON r.namespace=a.namespace WHERE a.app=?1").bind(s.app).all()).results;}
 async open({meta,url,headers,collections=[]}){
  if(!Array.isArray(collections)||collections.some(c=>typeof c!=='string'||!Object.hasOwn(meta.records?.collections??{},c)))return new Response('unknown collection',{status:400});
  const s={meta,url:new URL(url),request:new Request(url,{headers}),collections,seen:new Map()};
  if(!await this.authorized(s))return new Response('role cannot read collections',{status:403});
  const session=await localSession(s.request,this.env);
  s.app=session?.app===meta.id&&session.scope?`${meta.id}:check:${session.scope}`:meta.id;
  s.room=s.url.searchParams.get('room')??'main';
  for(const row of await this.revisions(s))s.seen.set(row.collection,row.revision);
  const body=new ReadableStream({start:controller=>{s.controller=controller;},cancel:()=>this.close(s)});
  this.streams.add(s);this.send(s,{collections:s.collections,presence:this.count(s),reset:true});
  for(const other of this.streams)if(other!==s)this.send(other,{presence:this.count(other)});
  // Recovery after a missed wake; this is not the screen's refresh clock.
  s.timer=setInterval(()=>this.ctx.waitUntil(this.pump(s,true)),15000);
  return new Response(body,{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});
 }
 async pump(s,recheck=false){
  if(!this.streams.has(s))return;if(s.busy){s.dirty=true;return;}s.busy=true;
  try{
   const changed=new Set();
   for(const row of await this.revisions(s)){if(s.seen.get(row.collection)!==row.revision){if(row.collection==='*')for(const c of s.collections)changed.add(c);else if(s.collections.includes(row.collection))changed.add(row.collection);}s.seen.set(row.collection,row.revision);}
   if(!changed.size&&!recheck)return;
   if(!await this.authorized(s)){this.close(s);return;}
   this.send(s,{collections:[...changed],presence:this.count(s)});
  }catch{this.close(s);}finally{s.busy=false;if(s.dirty){s.dirty=false;await this.pump(s);}}
 }
 async wake(meta){for(const s of this.streams)if(meta)s.meta=meta;await Promise.all([...this.streams].map(s=>this.pump(s)));return new Response('ok');}
}
