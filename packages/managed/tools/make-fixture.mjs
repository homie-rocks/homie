/** Trusted, repo-authored test fixture; no owner build scripts or example studio reads. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {build} from 'esbuild';
const root=resolve(process.argv[2]);
for(const d of ['site/src/runtime/built','site/src/functions','site/dist/_homie','site/dist/race'])mkdirSync(join(root,d),{recursive:true});
const source=resolve('packages/managed/tools/fixture-worker.mjs');
await build({entryPoints:[source],outdir:join(root,'site/src/runtime/built'),entryNames:'worker',splitting:true,minify:true,bundle:true,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['cloudflare:*','node:*'],logLevel:'silent'});
writeFileSync(join(root,'studio.json'),JSON.stringify({name:'Managed test fixture',slug:'hm-test-fixture',homie:{studio:'0.54.0',directory:null}}));
writeFileSync(join(root,'site/src/runtime/current.json'),JSON.stringify({main:join(root,'site/src/runtime/built/worker.js')}));
writeFileSync(join(root,'site/src/functions/declarations.json'),JSON.stringify([{name:'keep',event:'test.event'}]));
writeFileSync(join(root,'wrangler.jsonc'),JSON.stringify({compatibility_date:'2026-10-15',compatibility_flags:['nodejs_compat','global_fetch_strictly_public'],durable_objects:{bindings:['Table','Lobby','Gate','Concentrator','OwnerRoom'].map(class_name=>({name:class_name==='OwnerRoom'?'OWNER':class_name.toUpperCase(),class_name}))},vars:{STUDIO_FUNCTION_MANAGED_CRONS:'["* * * * *"]'}}));
writeFileSync(join(root,'site/dist/games.json'),JSON.stringify({studio:{name:'Managed test fixture',directory:false,stats:{share:false}},games:[{id:'cafe',name:'Cafe',kind:'app',roles:{customer:{can:['read:notes'],signIn:false}},surfaces:{phone:'customer'},records:{persist:true,collections:{notes:{fields:{text:{type:'string'}}}}}},{id:'race',name:'Race',players:{min:1,max:4},room:{host:'browser',tickHz:20},netplay:{v:1,public:true,maxPlayers:4}}]}));
writeFileSync(join(root,'site/dist/_homie/site.js'),'console.log("managed test asset");');
writeFileSync(join(root,'site/dist/race/index.html'),'<!doctype html><title>Managed test room</title>');
console.log(root);
