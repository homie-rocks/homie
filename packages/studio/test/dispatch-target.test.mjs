import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {dispatchTarget,dispatchArgs,targetConfig} from '../lib/dispatch-target.mjs';
const db='0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',previewDb='1f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
const studio={cloudflare:{dispatchNamespace:'studios',worker:'my-studio',d1Id:db,domain:'my.example.com',preview:{worker:'my-studio-preview',d1Id:previewDb,domain:'preview-my.example.com'}}};
function site() {
 const root=mkdtempSync(join(tmpdir(),'dispatch-target-'));
 writeFileSync(join(root,'wrangler.jsonc'),'// generated\n'+JSON.stringify({$schema:'x',name:'my-studio',main:'worker/index.mjs',assets:{directory:'site/dist'},routes:[{pattern:'my.example.com',custom_domain:true}],workers_dev:true,triggers:{crons:['*/5 * * * *']},queues:{producers:[{binding:'BG',queue:'my-studio-background'}]},d1_databases:[{binding:'DB',database_name:'my',database_id:db,migrations_dir:'migrations'}]}));
 return root;
}
test('production and preview targets point the generated Wrangler config at their own Worker and database',()=>{
 const root=site();
 const prod=dispatchTarget(studio),preview=dispatchTarget(studio,{preview:true});
 assert.deepEqual([prod.worker,prod.d1Id,preview.worker,preview.d1Id,preview.domain],['my-studio',db,'my-studio-preview',previewDb,'preview-my.example.com']);
 const file=targetConfig(root,preview),json=JSON.parse(readFileSync(file,'utf8'));
 assert.equal(json.name,'my-studio-preview');
 assert.equal(json.d1_databases[0].database_id,previewDb);
 assert.equal(json.main,join(root,'worker/index.mjs'));
 assert.equal(json.d1_databases[0].migrations_dir,join(root,'migrations'));
 for(const key of ['routes','workers_dev','triggers','queues'])assert.equal(json[key],undefined,key);
 assert.deepEqual(dispatchArgs(['deploy','entry.mjs'],preview,file),['deploy','entry.mjs','--config',file,'--dispatch-namespace','studios']);
 assert.deepEqual(dispatchArgs(['d1','migrations','apply','DB','--remote'],preview,file),['d1','migrations','apply','DB','--remote','--config',file]);
 assert.deepEqual(dispatchArgs(['d1','execute','DB','--local'],preview,file),['d1','execute','DB','--local']);
});
test('a target never takes a name, namespace or config from the command line',()=>{
 const root=site(),target=dispatchTarget(studio),file=targetConfig(root,target);
 for(const extra of [['--name','other'],['--dispatch-namespace=x'],['--config','other.json']])assert.throws(()=>dispatchArgs(['deploy',...extra],target,file),/comes from studio.json/);
});
test('incomplete or malformed target fails instead of deploying to an account Worker',()=>{
 for(const cf of [{dispatchNamespace:'studios'},{dispatchNamespace:'../other',worker:'x',d1Id:db,domain:'example.com'},{...studio.cloudflare,d1Id:'not-a-uuid'}])assert.throws(()=>dispatchTarget({cloudflare:cf}));
 assert.throws(()=>dispatchTarget({cloudflare:{...studio.cloudflare,preview:undefined}},{preview:true}),/cloudflare.preview/);
 assert.throws(()=>dispatchTarget({cloudflare:{worker:'normal'}},{preview:true}),/preview target/);
 assert.equal(dispatchTarget({cloudflare:{worker:'normal'}}),null);
 assert.deepEqual(dispatchArgs(['deploy'],null),['deploy']);
});
