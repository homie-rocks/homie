import {api,state,local} from './operator.mjs';import {readFileSync,writeFileSync} from 'node:fs';
const db=state.tenant.production.databaseId;
if(process.argv[2]==='seed'){
 await api(`d1/database/${db}/query`,'POST',{sql:"INSERT INTO meta(key,value) VALUES('hm-s2-continuity','survives-code-rollback')"});
 const bindings=await api('workers/dispatch/namespaces/homie-managed-s2/scripts/'+state.tenant.production.script+'/bindings');writeFileSync(local+'continuity-before.json',JSON.stringify({db,bindings},null,2));
}else{
 const before=JSON.parse(readFileSync(local+'continuity-before.json'));const bindings=await api('workers/dispatch/namespaces/homie-managed-s2/scripts/'+state.tenant.production.script+'/bindings');
 const rows=await api(`d1/database/${db}/query`,'POST',{sql:"SELECT value FROM meta WHERE key='hm-s2-continuity'"});
 if(JSON.stringify(bindings)!==JSON.stringify(before.bindings)||db!==before.db||rows[0].results[0]?.value!=='survives-code-rollback')throw new Error('Rollback continuity failed');
 const proof={databaseId:db,bindingsUnchanged:true,dataRetained:true,durableNamespaces:bindings.filter(b=>b.type==='durable_object_namespace').map(b=>({class:b.class_name,id:b.namespace_id}))};writeFileSync(local+'continuity-after.json',JSON.stringify(proof,null,2));console.log(proof);
}
