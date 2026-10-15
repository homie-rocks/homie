import {canonicalJson} from './canonical-json.mjs';
export const BUSINESS_EVENTS_MIGRATION_FILE='0028_business_events.sql';
export const BUSINESS_EVENTS_MIGRATION=`
ALTER TABLE studio_events ADD COLUMN scope TEXT;
CREATE TABLE event_publications(id TEXT PRIMARY KEY,digest TEXT NOT NULL);
${['INSERT','UPDATE','DELETE'].map(op=>{const row=op==='DELETE'?'OLD':'NEW';return `
DROP TRIGGER IF EXISTS app_records_function_${op.toLowerCase()};
CREATE TRIGGER app_records_function_${op.toLowerCase()} AFTER ${op} ON app_records
WHEN EXISTS (SELECT 1 FROM function_subscriptions WHERE type='record.changed') BEGIN
 INSERT INTO studio_events(id,type,data,at) VALUES(lower(hex(randomblob(16))),'record.changed',
 json_object('app',${row}.app,'collection',${row}.collection,'record',${row}.id,'version',${row}.version,'operation','${op.toLowerCase()}',
 'data',json(${row}.value),'previous',${op==='INSERT'?'NULL':'json(OLD.value)'}),${row}.updated_at);
END;`;}).join('\n')}
`;
/** Durable idempotency survives feed retention/pruning; no sleep or read-back races. */
export async function publishBusinessEvent(env,caller,definition,namespace,{feed,id,data}){
 const declaration=JSON.parse(env.STUDIO_EVENT_FEEDS??'{}')[feed];
 if(!definition.publish?.includes(feed)||!declaration?.schema)throw new Error('Business feed must be declared with a schema and publish capability');
 if(typeof id!=='string'||!id.length||id.length>128)throw new Error('Event id must contain 1–128 characters');
 const {CfWorkerJsonSchemaValidator}=await import('@modelcontextprotocol/server/validators/cf-worker');
 if(!new CfWorkerJsonSchemaValidator().getValidator(declaration.schema)(data).valid)throw new Error('Event data does not match feed schema');
 const text=canonicalJson(data);if(text.length>8192)throw new Error('Event exceeds 8192 characters');
 const key=JSON.stringify([namespace,feed,id]),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(declaration.event+'\n'+text))),b=>b.toString(16).padStart(2,'0')).join('');
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO studio_events(id,type,data,at,scope) SELECT ?1,?2,?3,?4,?5 WHERE NOT EXISTS (SELECT 1 FROM event_publications WHERE id=?1)').bind(key,declaration.event,text,Date.now(),caller.testScope??null),
  env.DB.prepare('INSERT OR IGNORE INTO event_publications(id,digest) VALUES(?1,?2)').bind(key,digest)
 ]);
 const saved=await env.DB.prepare('SELECT digest FROM event_publications WHERE id=?1').bind(key).first();
 if(saved.digest!==digest)throw new Error('Event id already published with different data');
 return {id:key};
}
