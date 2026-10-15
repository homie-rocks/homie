import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
test('fork copies source once, rewrites place and slot references, and drops credentials and deployment identity',async t=>{
 const {forkStudio}=await import('../lib/fork.mjs');const root=mkdtempSync(join(tmpdir(),'fork-place-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'example'),target=join(root,'new');mkdirSync(join(source,'apps/desk/src'),{recursive:true});mkdirSync(join(source,'.studio'));
 const put=(path,value)=>writeFileSync(join(source,path),JSON.stringify(value));
 put('studio.json',{name:'Old Place',slug:'old-place',cloudflare:{worker:'old',d1Id:'private-id',domain:'old.example',created:['old']}});put('package.json',{name:'old-place',dependencies:{}});put('apps/desk/app.json',{id:'desk',name:'Old Place',slots:[{id:'morning',name:'Old Place opening'}]});
 writeFileSync(join(source,'apps/desk/src/main.ts'),"export const slot='morning';export const app='desk';");writeFileSync(join(source,'.studio/token'),'private');writeFileSync(join(source,'.dev.vars'),'private');
 const result=await forkStudio(source,target,{name:'New Place',slug:'new-place'});assert.equal(result.ok,true);
 const meta=JSON.parse(readFileSync(join(target,'apps/new-place-desk/app.json')));assert.equal(meta.id,'new-place-desk');assert.equal(meta.slots[0].id,'new-place-morning');assert.equal(meta.name,'New Place');
 const renamed=await import(pathToFileURL(join(target,'apps/new-place-desk/src/main.ts')));assert.equal(renamed.slot,'new-place-morning');assert.equal(renamed.app,'new-place-desk');
 assert.equal(existsSync(join(target,'.studio/token')),false);assert.equal(existsSync(join(target,'.dev.vars')),false);
 const config=JSON.parse(readFileSync(join(target,'studio.json')));assert.equal(config.cloudflare.domain,undefined);assert.equal(config.cloudflare.d1Id,undefined);
 await assert.rejects(()=>forkStudio(source,target,{name:'Again',slug:'again'}),/exists/);
 assert.equal(JSON.parse(readFileSync(join(source,'studio.json'))).name,'Old Place');
});

test('fork renames slots declared in source and can run outside an existing studio',async t=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const root=mkdtempSync(join(tmpdir(),'fork-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'example'),target=join(root,'new');mkdirSync(join(source,'apps/desk'),{recursive:true});
 writeFileSync(join(source,'studio.json'),JSON.stringify({name:'Example',slug:'example',cloudflare:{}}));writeFileSync(join(source,'package.json'),JSON.stringify({name:'example'}));
 writeFileSync(join(source,'apps/desk/app.json'),JSON.stringify({id:'desk',name:'Example desk'}));writeFileSync(join(source,'apps/desk/seed.ts'),"export const slots=[{id:'morning',name:'Morning'}];export const selected='morning';");
 writeFileSync(join(source,'.gitignore'),'node_modules/\n.studio/\n');
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/homie-studio.mjs',import.meta.url)),'fork',source,target,'--name','Next Place','--slug','next','--json'],{cwd:root,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr+result.stdout);
 const seeded=await import(pathToFileURL(join(target,'apps/next-desk/seed.ts')));assert.equal(seeded.slots[0].id,'next-morning');assert.equal(seeded.selected,'next-morning');assert.equal(readFileSync(join(target,'.gitignore'),'utf8'),'node_modules/\n.studio/\n');
});
