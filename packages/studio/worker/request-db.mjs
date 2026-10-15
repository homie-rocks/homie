export const ORIGINAL_DB=Symbol('original database');
export const MUTATIONS=Symbol('request mutations');
export const databaseBinding=db=>db?.[ORIGINAL_DB]??db;
/** One current metadata snapshot per request. Never cache authorization across requests.
 * Independent reads share a D1 batch, including the public records read when present.
 * Only the request owns the promise; an isolate never shares pending D1 I/O.
 */
export function requestDatabase(DB, request) {
 if(!DB)return DB;
 const queries=[['SELECT game, launch, max_players, updated_at FROM office_games LIMIT 500',[]],['SELECT * FROM servers LIMIT 2000',[]],['SELECT game, server, rules, updated_at FROM chat_rules LIMIT 1000',[]]];
 const url=new URL(request.url),match=/^\/([a-z0-9][a-z0-9-]{0,39})\/api\/app\/records\/([a-z][a-z0-9-]{0,39})(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(url.pathname);
 if(request.method==='GET'&&match){
  const [,app,collection,id]=match;
  queries.push(id?['SELECT id, value, version, updated_at FROM app_records WHERE app = ?1 AND collection = ?2 AND id = ?3',[app,collection,id]]:['SELECT id, value, version, updated_at FROM app_records WHERE app = ?1 AND collection = ?2 ORDER BY updated_at, id',[app,collection]]);
 }
 let snapshot,mutated=false;
 const writing=sql=>{if(!/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(sql)){snapshot=null;if(!/\bstats_daily\b/.test(sql))mutated=true;}};
 const prepare=(sql,args=[])=>{
  const index=queries.findIndex(([q,a])=>q===sql&&JSON.stringify(a)===JSON.stringify(args));
  const original=()=>{const stmt=DB.prepare(sql);return args.length?stmt.bind(...args):stmt;};
  const read=async()=>{snapshot??=DB.batch(queries.map(([q,a])=>{const s=DB.prepare(q);return a.length?s.bind(...a):s;}));return (await snapshot)[index];};
  return {bind:(...args)=>prepare(sql,args),first:async column=>{if(index<0){writing(sql);return original().first(column);}const row=(await read()).results?.[0]??null;return column&&row?row[column]:row;},all:()=>{writing(sql);return index<0?original().all():read();},run:()=>{writing(sql);return original().run();},raw:(...args)=>original().raw(...args),_original:original,_sql:sql};
 };
 return {[ORIGINAL_DB]:DB,get [MUTATIONS](){return mutated;},prepare,batch:statements=>{snapshot=null;for(const s of statements)writing(s._sql??'UPDATE');return DB.batch(statements.map(s=>s._original?.()??s));},exec:(...args)=>{snapshot=null;return DB.exec(...args);}};
}
