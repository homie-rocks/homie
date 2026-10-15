export const METADATA_REVISION=Symbol('metadata revision');
export const ORIGINAL_DB=Symbol('original database');
export const MUTATIONS=Symbol('request mutations');
export const databaseBinding=db=>db?.[ORIGINAL_DB]??db;
const metadata=new WeakMap();
const metadataQueries=new Set(['SELECT game, launch, max_players, updated_at FROM office_games LIMIT 500','SELECT * FROM servers LIMIT 2000','SELECT game, server, rules, updated_at FROM chat_rules LIMIT 1000']);
/** Cache only completed metadata, stamped by a trigger-maintained revision. Pending
 * D1 operations belong to one request. Cold metadata is one atomic batch.
 */
export function requestDatabase(DB, request, state={mutated:false}, binding=databaseBinding(DB)) {
 if(!DB)return DB;
 let revision,records,rows;
 const url=new URL(request.url),match=request.method==='GET'&&/^\/([a-z0-9][a-z0-9-]{0,39})\/api\/app\/records\/([a-z][a-z0-9-]{0,39})(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(url.pathname);
 const recordQuery=match&&(match[3]?'SELECT id, value, version, updated_at FROM app_records WHERE app = ?1 AND collection = ?2 AND id = ?3':'SELECT id, value, version, updated_at FROM app_records WHERE app = ?1 AND collection = ?2 ORDER BY updated_at, id');
 const stamp=()=>revision??=(async()=>{
  const query=DB.prepare("SELECT value FROM meta WHERE key='metadata-revision'");
  const cached=metadata.get(binding);
  // The revision and its rows must be from the same snapshot, including when
  // another request changes metadata while this request is awaiting D1.
  const queries=[...metadataQueries];
  const cold=!cached;
  const statements=[query,...(cold?queries.map(sql=>DB.prepare(sql)):[])];
  if(recordQuery)statements.push(DB.prepare(recordQuery).bind(...match.slice(1).filter(x=>x!==undefined)));
  const result=await DB.batch(statements);
  let version=result[0].results?.[0]?.value??null;
  if(recordQuery)records=result.at(-1);
  if(cold)rows=new Map(queries.map((sql,i)=>[sql,result[i+1]]));
  else if(cached.version===version)rows=cached.rows;
  else {
   const refreshed=await DB.batch([query,...queries.map(sql=>DB.prepare(sql))]);
   version=refreshed[0].results?.[0]?.value??null;
   rows=new Map(queries.map((sql,i)=>[sql,refreshed[i+1]]));
  }
  if(version!==null)metadata.set(binding,{version,rows});
  return version;
 })();
 const writing=sql=>{if(!/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)){if(/\bapp_records\b/.test(sql)){records=null;revision=null;}if(/\b(office_games|servers|chat_rules)\b/.test(sql)){revision=null;metadata.delete(binding);}if(!/\bstats_daily\b/.test(sql))state.mutated=true;}};
 const prepare=(sql,args=[])=>{
  const original=()=>{const stmt=DB.prepare(sql);return args.length?stmt.bind(...args):stmt;};
  const read=async()=>{
   if(sql===recordQuery&&JSON.stringify(args)===JSON.stringify(match.slice(1).filter(x=>x!==undefined))){await stamp();return records;}
   if(!metadataQueries.has(sql))return original().all();
   await stamp();
   return rows.get(sql);
  };
  return {bind:(...args)=>prepare(sql,args),first:async column=>{writing(sql);if(!metadataQueries.has(sql)&&sql!==recordQuery)return original().first(column);const row=(await read()).results?.[0]??null;return column&&row?row[column]:row;},all:()=>{writing(sql);return read();},run:()=>{writing(sql);return original().run();},raw:(...args)=>{writing(sql);return original().raw(...args);},_original:original,_sql:sql};
 };
 const methods={[METADATA_REVISION]:stamp,[ORIGINAL_DB]:binding,get [MUTATIONS](){return state.mutated;},prepare,batch:statements=>{for(const s of statements)writing(s._sql??'UPDATE');return DB.batch(statements.map(s=>s._original?.()??s));},exec:(sql,...args)=>{writing(sql);return DB.exec(sql,...args);},withSession:(...args)=>requestDatabase(DB.withSession(...args),request,state,binding)};
 return new Proxy(methods,{get(target,key){if(key in target)return target[key];const value=DB[key];return typeof value==='function'?value.bind(DB):value;}});
}

/** A background task may register more work while it settles. */
export async function drainPending(pending) {
 for(let done=0;done<pending.length;){const end=pending.length;await Promise.allSettled(pending.slice(done,end));done=end;}
}

/** Keep the runtime context intact and also deliver writes registered after the
 * response's original drain finished (for example from response-stream work). */
export function trackBackground(ctx,deliver) {
 const pending=[];let finished=false;
 const context=ctx?.waitUntil?new Proxy(ctx,{get(target,key){
  if(key==='waitUntil')return work=>{
   const task=Promise.resolve(work);pending.push(task);ctx.waitUntil(task);
   if(finished)ctx.waitUntil(Promise.allSettled([task]).then(deliver));
  };
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }}):ctx;
 return {context,async finish(){await drainPending(pending);finished=true;await deliver();}};
}
