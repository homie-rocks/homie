import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 for(const file of readdirSync(new URL('../../../template/site/migrations/',import.meta.url)).sort())sql.exec(readFileSync(new URL('../../../template/site/migrations/'+file,import.meta.url),'utf8'));
 const stmt=(q,a=[])=>({bind:(...x)=>stmt(q,x),first:async()=>sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)}),run:()=>/^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(q)?{results:sql.prepare(q).all(...a)}:{meta:{changes:sql.prepare(q).run(...a).changes}}});
 return {sql,prepare:stmt,batch:async xs=>{sql.exec('BEGIN');try{const r=[];for(const x of xs)r.push(x.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
