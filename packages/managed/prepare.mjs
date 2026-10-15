import {cpSync, lstatSync, realpathSync, readdirSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

import {parse, printParseErrorCode} from 'jsonc-parser';
export const read = path => {
  const errors=[];const value=parse(readFileSync(path,'utf8'),errors,{allowTrailingComma:true});
  if(errors.length)throw new Error(`Invalid JSONC ${path}: ${errors.map(e=>printParseErrorCode(e.error)).join(', ')}`);
  return value;
};
export function prepare({studio, output, name, databaseId, accountId, hostname, controlHosts, deployed=null}) {
  if (!/^hm-test-[a-z0-9-]+$/.test(name)) throw new Error('Step 1 only accepts hm-test- resource names');
  if (!/^[0-9a-f-]{36}$/.test(databaseId) || !/^[0-9a-f]{32}$/.test(accountId)) throw new Error('Explicit database/account IDs required');
  if (!hostname || new URL('https://' + hostname).hostname !== hostname) throw new Error('Exact hostname required');
  studio=realpathSync(resolve(studio)); output=resolve(output);
  const inside=path=>{const rel=relative(studio,realpathSync(path));if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Artifact path escapes studio');};
  const rejectLinks=path=>{if(lstatSync(path).isSymbolicLink())throw new Error('Artifact symlinks are not accepted');if(lstatSync(path).isDirectory())for(const child of readdirSync(path))rejectLinks(join(path,child));};
  for(const path of ['wrangler.jsonc','site/src/runtime/current.json','site/dist']){inside(join(studio,path));rejectLinks(join(studio,path));}
  for(const path of ['studio.json','site/src/functions/declarations.json'])if(existsSync(join(studio,path))){inside(join(studio,path));rejectLinks(join(studio,path));}
  const source=read(join(studio,'wrangler.jsonc'));
  const current=read(join(studio,'site/src/runtime/current.json'));
  inside(current.main);rejectLinks(dirname(current.main));
  mkdirSync(output,{recursive:true});
  const artifact=mkdtempSync(join(output,'build-'));
  const runtime=join(artifact,'runtime'); mkdirSync(runtime,{recursive:true});
  const migrationsDir=join(artifact,'migrations');mkdirSync(migrationsDir,{recursive:true});
  const sourceMigrations=join(studio,'site/migrations');
  if(existsSync(sourceMigrations)){inside(sourceMigrations);rejectLinks(sourceMigrations);cpSync(sourceMigrations,migrationsDir,{recursive:true});}
  const toolkitMigrations=fileURLToPath(new URL('../../template/site/migrations/',import.meta.url));
  for(const file of readdirSync(toolkitMigrations))if(file.endsWith('.sql')&&!existsSync(join(migrationsDir,file)))cpSync(join(toolkitMigrations,file),join(migrationsDir,file));
  const assets=join(artifact,'assets');
  cpSync(join(studio,'site/dist'),assets,{recursive:true});
  const catalogue=read(join(assets,'games.json'));
  catalogue.studio={...catalogue.studio,canonical:'https://'+hostname,directory:false,concept:true,rooms:{share:false},stats:{share:false}};
  writeFileSync(join(assets,'games.json'),JSON.stringify(catalogue));
  cpSync(dirname(current.main),runtime,{recursive:true});
  writeFileSync(join(runtime,'managed.mjs'),`import worker from './worker.js';
export * from './worker.js';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__managed/')) {
      if (url.pathname !== '/__managed/tick' || request.method !== 'POST' || ctx.props?.managedTick !== true)
        return new Response('Not found', {status:404});
      const tick = await request.json();
      await worker.scheduled(tick, env, ctx);
      return new Response(null, {status:204});
    }
    return worker.fetch(request, env, ctx);
  }
};
`);
  // Deliberate allowlist: no source routes, secrets, remote bindings, AI, R2 or production IDs.
  const ownBindings=(source.durable_objects?.bindings??[]).filter(b=>!b.script_name).map(({name,class_name})=>({name,class_name}));
  const classes=[...new Set(ownBindings.map(b=>b.class_name))];
  if(classes.some(c=>!/^[$A-Za-z_][$A-Za-z0-9_]*$/.test(c)))throw new Error('Invalid DO class');
  // Provider settings, never the local output directory, are migration authority.
  const known=[...new Set((deployed?.bindings??[]).filter(b=>b.type==='durable_object_namespace'&&!b.script_name).map(b=>b.class_name))];
  if(known.some(c=>!classes.includes(c)))throw new Error('Removing DO classes requires an explicit storage migration');
  const added=classes.filter(c=>!known.includes(c));
  const tag=deployed?.migration_tag;
  if(deployed&&known.length&&!tag)throw new Error('Deployed migration tag missing');
  const migrations=tag?[{tag}]:[];
  if(added.length)migrations.push({tag:tag?tag+'-next':'v1',new_sqlite_classes:added});
  const dates=new Set(['2026-06-01','2026-10-01','2026-10-15']);
  const flags=new Set(['nodejs_compat','global_fetch_strictly_public','disallow_eval_during_startup']);
  if(!dates.has(source.compatibility_date))throw new Error('Compatibility date is not approved');
  if((source.compatibility_flags??[]).some(flag=>!flags.has(flag)))throw new Error('Compatibility flag is not approved');
  const config={name, account_id:accountId, main:join(runtime,'managed.mjs'),
    compatibility_date:source.compatibility_date,
    compatibility_flags:[...new Set([...(source.compatibility_flags??[]),'global_fetch_strictly_public'])],
    no_bundle:true, find_additional_modules:true,
    rules:[{type:'ESModule',globs:['**/*.js','**/*.mjs'],fallthrough:true}],
    assets:{directory:assets,binding:'ASSETS',run_worker_first:true},
    durable_objects:{bindings:ownBindings},
    migrations,
    d1_databases:[{binding:'DB',database_name:name+'-db',database_id:databaseId,migrations_dir:migrationsDir}],
    vars:{STUDIO_NAME:source.vars?.STUDIO_NAME ?? name, HOMIE_CONCEPT:'1',
      STUDIO_FUNCTION_CRONS:source.vars?.STUDIO_FUNCTION_CRONS ?? '[]',
      STUDIO_FUNCTION_MANAGED_CRONS:source.vars?.STUDIO_FUNCTION_MANAGED_CRONS ?? '[]'},
    tail_consumers:[{service:'hm-test-outbound'}],observability:{enabled:true}};
  writeFileSync(join(output,'user.json'),JSON.stringify(config,null,2)+'\n');
  const here=dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(output,'outbound.json'),JSON.stringify({name:'hm-test-outbound',account_id:accountId,main:join(here,'outbound.mjs'),compatibility_date:'2026-10-01',compatibility_flags:['global_fetch_strictly_public'],workers_dev:false,observability:{enabled:true},vars:{CONTROL_HOSTS:controlHosts??[hostname]}},null,2));
  writeFileSync(join(output,'dispatch.json'),JSON.stringify({name:'hm-test-dispatch',account_id:accountId,main:join(here,'dispatch-entry.mjs'),compatibility_date:'2026-10-01',workers_dev:true,
    dispatch_namespaces:[{binding:'STUDIOS',namespace:'homie-managed-test',outbound:{service:'hm-test-outbound',parameters:['tenant']}}],
    queues:{producers:[{binding:'TICKS',queue:'hm-test-ticks'}],consumers:[{queue:'hm-test-ticks',max_batch_size:1,max_retries:3,dead_letter_queue:'hm-test-ticks-dlq'},{queue:'hm-test-ticks-dlq',max_batch_size:1,max_retries:3}]},
    durable_objects:{bindings:[{name:'REGISTRY',class_name:'Registry'}]},migrations:[{tag:'v1',new_sqlite_classes:['Registry']}],triggers:{crons:['* * * * *']},observability:{enabled:true}},null,2));
  return config;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [studio,output,name,databaseId,accountId,hostname]=process.argv.slice(2);
  prepare({studio,output,name,databaseId,accountId,hostname});
}
