import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import {configPath,workerDir} from './studio.mjs';
/**
 * A preprovisioned Workers for Platforms target, deployed by ordinary Wrangler
 * (https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/get-started/configuration/).
 * studio.json names it; the platform owns routing and resources and enforces the target at its API boundary:
 *
 *   "cloudflare": {"dispatchNamespace":"…","worker":"…","d1Id":"…","domain":"…",
 *                  "preview":{"worker":"…","d1Id":"…","domain":"…"}}
 *
 * `deploy --preview` sends the same build to the preview Worker and its own database.
 */
const NAME=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/,UUID=/^[0-9a-f-]{36}$/i,HOST=/^[a-z0-9.-]+$/i;
export function dispatchTarget(studio,{preview=false}={}) {
  const cf=studio.cloudflare??{};
  if(cf.dispatchNamespace===undefined) {
    if(preview)throw Error('deploy --preview needs a Workers for Platforms preview target in studio.json (cloudflare.preview)');
    return null;
  }
  if(typeof cf.dispatchNamespace!=='string'||!NAME.test(cf.dispatchNamespace))throw Error('Invalid cloudflare.dispatchNamespace');
  const t=preview?cf.preview:cf;
  if(!t||!NAME.test(t.worker??'')||!UUID.test(t.d1Id??'')||!HOST.test(t.domain??''))throw Error(`A dispatch target needs its preprovisioned worker, d1Id and domain in studio.json${preview?' (cloudflare.preview)':''}`);
  return {namespace:cf.dispatchNamespace,worker:t.worker,d1Id:t.d1Id,domain:t.domain.toLowerCase(),preview};
}
/** The studio's generated wrangler.jsonc, pointed at the target: its Worker name and its database. */
export function targetConfig(root,target) {
  const base=workerDir(root),json=JSON.parse(readFileSync(configPath(root),'utf8').replace(/^\s*\/\/.*$/gm,''));
  const abs=p=>p&&!isAbsolute(p)?join(base,p):p;
  delete json.$schema;
  json.name=target.worker;
  if(json.main)json.main=abs(json.main);
  if(json.assets?.directory)json.assets.directory=abs(json.assets.directory);
  if(!json.d1_databases?.length)throw Error('The studio has no D1 database in wrangler.jsonc');
  json.d1_databases=json.d1_databases.map((d,i)=>({...d,...(i===0?{database_id:target.d1Id}:{}),...(d.migrations_dir?{migrations_dir:abs(d.migrations_dir)}:{})}));
  // The platform routes its own hostnames; a dispatch Worker has neither routes nor workers.dev.
  for(const key of ['route','routes','workers_dev','preview_urls'])delete json[key];
  const file=join(base,'.wrangler',target.preview?'homie-preview.wrangler.json':'homie-target.wrangler.json');
  mkdirSync(dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;writeFileSync(temp,`${JSON.stringify(json,null,2)}\n`);renameSync(temp,file);
  return file;
}
export function dispatchArgs(args,target,config) {
  if(!target||args.includes('--local'))return args;
  if(args.some(a=>['--name','--dispatch-namespace','--config','-c'].includes(a)||/^--(name|dispatch-namespace|config)=/.test(a)))throw Error('The deployment target comes from studio.json');
  if(!config||!existsSync(config))throw Error('The deployment target configuration is missing');
  return ['deploy','secret'].includes(args[0])?[...args,'--config',config,'--dispatch-namespace',target.namespace]:[...args,'--config',config];
}
