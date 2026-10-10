import {existsSync,readdirSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {configPath} from './studio.mjs';
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
  const config=configPath(root);
  if(definitions.length && existsSync(config)) {
    const original=readFileSync(config,'utf8'),c=JSON.parse(original.replace(/^\s*\/\/.*$/gm,''));
    c.triggers={...c.triggers,crons:[...new Set([...(c.triggers?.crons??[]),'* * * * *',...definitions.map(f=>f.schedule).filter(Boolean)])].sort()};
    if(JSON.stringify(c)!==JSON.stringify(JSON.parse(original.replace(/^\s*\/\/.*$/gm,''))))writeFileSync(config,(original.match(/^(?:\s*\/\/[^\n]*\n)*/)?.[0]??'')+JSON.stringify(c,null,2)+'\n');
  }
  return definitions;
}
