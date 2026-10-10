import {existsSync,readdirSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
export function functionFiles(root) { const dir=join(root,'functions');return existsSync(dir)?readdirSync(dir).filter(f=>/^[a-z][a-z0-9-]*\.ts$/.test(f)).sort().map(f=>join(dir,f)):[]; }
export async function buildFunctions(root,esbuild) {
  const files=functionFiles(root),dir=join(root,'site/src/functions');mkdirSync(dir,{recursive:true});
  if(files.length) {
    const ts=require('typescript'),options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,strict:true,noEmit:true,skipLibCheck:true};
    const errors=ts.getPreEmitDiagnostics(ts.createProgram(files,options));
    if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
  }
  const contents=files.map((f,i)=>`import f${i} from ${JSON.stringify(f)};`).join('\n')+`\nexport default [${files.map((_,i)=>'f'+i).join(',')}];`;
  const built=await esbuild.build({stdin:{contents,resolveDir:root},bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent'});
  const file=join(dir,'index.mjs');writeFileSync(file,built.outputFiles[0].text);
  const definitions=(await import(pathToFileURL(file).href+'?build='+Date.now())).default;
  const names=new Set();
  for(const fn of definitions) {
    if(!/^[a-z][a-z0-9-]*$/.test(fn.name)||names.has(fn.name)||typeof fn.handler!=='function'||typeof fn.event!=='string'||!fn.event.trim())throw new Error('Function needs a unique name, event and handler');
    if(fn.schedule && (typeof fn.schedule!=='string'||fn.schedule.trim().split(/\s+/).length!==5))throw new Error('Function schedule needs a Cloudflare cron expression');
    names.add(fn.name);
  }
  const worker=join(root,'site/src/worker.mjs');
  if(existsSync(worker)) {let text=readFileSync(worker,'utf8');if(!text.includes('useFunctions(')){text+="\nimport { useFunctions } from '@homie-rocks/studio/worker';\nuseFunctions(async () => (await import('./functions/index.mjs')).default);\n";writeFileSync(worker,text);}}
  writeFileSync(join(dir,'declarations.json'),JSON.stringify(definitions.map(({name,event,schedule,replay})=>({name,event,schedule,replay})),null,2)+'\n');
  (await import('./worker-config.mjs')).refreshWorkerConfig(root);
  return definitions;
}
/** Install subscriptions before the new Worker can produce its first event. */
export function functionDeploymentSQL(root) {
  const file=join(root,'site/src/functions/declarations.json');
  const definitions=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
  const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
  return [...definitions.map(fn=>`INSERT INTO function_subscriptions(name,type,cursor,started) VALUES(${literal(fn.name)},${literal(fn.event)},(SELECT COALESCE(MAX(seq),0) FROM studio_events),unixepoch()*1000) ON CONFLICT(name) DO UPDATE SET type=excluded.type,cursor=excluded.cursor,started=excluded.started WHERE type!=excluded.type;`),`DELETE FROM function_subscriptions WHERE name NOT IN (${definitions.map(fn=>literal(fn.name)).join(',')||"''"});`,"INSERT INTO meta(key,value) VALUES('function-registry-deployed','1') ON CONFLICT(key) DO UPDATE SET value='1';"].join(' ');
}
