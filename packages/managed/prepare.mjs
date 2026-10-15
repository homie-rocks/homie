import {cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const read = path => JSON.parse(readFileSync(path,'utf8').replace(/^\s*\/\/.*$/gm,''));
export function prepare({studio, output, name, databaseId, accountId, hostname}) {
  if (!/^hm-test-[a-z0-9-]+$/.test(name)) throw new Error('Step 1 only accepts hm-test- resource names');
  if (!/^[0-9a-f-]{36}$/.test(databaseId) || !/^[0-9a-f]{32}$/.test(accountId)) throw new Error('Explicit database/account IDs required');
  if (!hostname || new URL('https://' + hostname).hostname !== hostname) throw new Error('Exact hostname required');
  studio=resolve(studio); output=resolve(output);
  const source=read(join(studio,'wrangler.jsonc'));
  const current=read(join(studio,'site/src/runtime/current.json'));
  mkdirSync(output,{recursive:true});
  const artifact=mkdtempSync(join(output,'build-'));
  const runtime=join(artifact,'runtime'); mkdirSync(runtime,{recursive:true});
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
  const config={name, account_id:accountId, main:join(runtime,'managed.mjs'),
    compatibility_date:source.compatibility_date, compatibility_flags:source.compatibility_flags,
    no_bundle:true, find_additional_modules:true,
    rules:[{type:'ESModule',globs:['**/*.js','**/*.mjs'],fallthrough:true}],
    assets:{directory:assets,binding:'ASSETS',run_worker_first:true},
    durable_objects:{bindings:['Table','Lobby','Gate','Concentrator'].map(class_name=>({name:class_name.toUpperCase(),class_name}))},
    migrations:[{tag:'v1',new_sqlite_classes:['Table','Lobby','Gate','Concentrator']}],
    d1_databases:[{binding:'DB',database_name:name+'-db',database_id:databaseId,migrations_dir:join(studio,'site/migrations')}],
    vars:{STUDIO_NAME:source.vars?.STUDIO_NAME ?? name, HOMIE_CONCEPT:'1',
      STUDIO_FUNCTION_CRONS:source.vars?.STUDIO_FUNCTION_CRONS ?? '[]',
      STUDIO_FUNCTION_MANAGED_CRONS:source.vars?.STUDIO_FUNCTION_MANAGED_CRONS ?? '[]'},
    observability:{enabled:true}};
  writeFileSync(join(output,'user.json'),JSON.stringify(config,null,2)+'\n');
  const here=dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(output,'outbound.json'),JSON.stringify({name:'hm-test-outbound',account_id:accountId,main:join(here,'outbound.mjs'),compatibility_date:'2026-10-01',workers_dev:false},null,2));
  writeFileSync(join(output,'dispatch.json'),JSON.stringify({name:'hm-test-dispatch',account_id:accountId,main:join(here,'dispatch.mjs'),compatibility_date:'2026-10-01',workers_dev:true,
    dispatch_namespaces:[{binding:'STUDIOS',namespace:'homie-managed-test',outbound:{service:'hm-test-outbound'}}],
    vars:{ROUTES:[{hostname,prefix:'/',script:name}]},triggers:{crons:['* * * * *']},observability:{enabled:true}},null,2));
  return config;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [studio,output,name,databaseId,accountId,hostname]=process.argv.slice(2);
  prepare({studio,output,name,databaseId,accountId,hostname});
}
