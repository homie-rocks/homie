import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { partsPlugin, resolvePartImport } from './parts-build.mjs';
const require=createRequire(import.meta.url);
export function toolFiles(root) {
  const dirs=[join(root,'tools')];
  const apps=join(root,'apps');if(existsSync(apps))for(const app of readdirSync(apps,{withFileTypes:true}))if(app.isDirectory())dirs.push(join(apps,app.name,'tools'));
  return dirs.flatMap(dir=>existsSync(dir)?readdirSync(dir).filter(f=>/^[a-z][a-z0-9-]*\.ts$/.test(f)).sort().map(f=>join(dir,f)):[]);
}
export async function buildTools(root,esbuild) {
  const files=toolFiles(root),dir=join(root,'site/src/tools');
  mkdirSync(dir,{recursive:true});
  if(files.length){
    const ts=require('typescript');
    const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,strict:true,noEmit:true,skipLibCheck:true,allowImportingTsExtensions:true};
    const host=ts.createCompilerHost(options);
    host.resolveModuleNames=(names,containing)=>names.map(name=>{
      if(name.startsWith('@parts/')){const part=resolvePartImport(root,name);if(part.path)return {resolvedFileName:part.path,extension:part.path.endsWith('.ts')?ts.Extension.Ts:ts.Extension.Js};}
      return ts.resolveModuleName(name,containing,options,host).resolvedModule;
    });
    const program=ts.createProgram(files,options,host);
    const errors=ts.getPreEmitDiagnostics(program);
    if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>root,getCanonicalFileName:f=>f,getNewLine:()=> '\n'}));
  }
  const contents=files.map((f,i)=>`import t${i} from ${JSON.stringify(f)};`).join('\n')+`\nexport default [${files.map((_,i)=>'t'+i).join(',')}];\n`;
  const result=await esbuild.build({stdin:{contents,resolveDir:root},bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,plugins:[partsPlugin(root)],logLevel:'silent'});
  const temp=join(dir,'index.mjs');writeFileSync(temp,result.outputFiles[0].text);
  // Trusted studio code, as with the existing build command. No Worker bindings exist during build.
  const defs=(await import(pathToFileURL(temp).href+'?build='+Date.now())).default;
  const { CfWorkerJsonSchemaValidator }=await import('@modelcontextprotocol/server/validators/cf-worker');
  const validator=new CfWorkerJsonSchemaValidator(),seen=new Set();
  for(const t of defs){
    if(!/^[a-z][a-z0-9_]{0,63}$/.test(t.name)||/^(studio_|app_|agent_|room_|shop_)/.test(t.name)||seen.has(t.name))throw new Error(`tool name is invalid, reserved or duplicated: ${t.name}`);
    seen.add(t.name);
    if(typeof t.description!=='string'||!t.description.trim()||typeof t.handler!=='function')throw new Error(`tool ${t.name} needs description and handler`);
    if(!['owner','signed-in','public'].includes(t.audience)&&!(t.audience&&typeof t.audience.app==='string'&&typeof t.audience.role==='string'))throw new Error(`tool ${t.name} needs an audience`);
    if(t.inputSchema?.type!=='object')throw new Error(`tool ${t.name} input schema must be an object`);
    validator.getValidator(t.inputSchema);
    if(t.price && (t.kind==='prompt'||!Number.isSafeInteger(t.price.amount)||t.price.amount<=0||! /^[a-z]{3}$/.test(t.price.currency)))throw new Error(`tool ${t.name}: price needs a positive minor-unit amount and currency`);
    if(t.kind!==undefined&&!['tool','prompt'].includes(t.kind))throw new Error(`tool ${t.name}: invalid kind`);
    if(t.webhook&&(!/^[A-Z][A-Z0-9_]{0,63}$/.test(t.webhook.secret)||typeof t.webhook.person!=='string'||!t.webhook.person))throw new Error(`tool ${t.name}: webhook needs a named secret and account`);
    for(const [name,event] of Object.entries(t.events??{})){
      if(!/^external:[a-z][a-z0-9_-]{0,40}$/.test(name)||!event.game||!event.schema)throw new Error(`tool ${t.name}: invalid external event`);
      validator.getValidator(event.schema);
    }
  }
  // Existing studios retain their Worker customization; install the small registry hook once.
  const worker=join(root,'site/src/worker.mjs');
  if(existsSync(worker)){
    let text=readFileSync(worker,'utf8');
    if(!text.includes('useTools(')){text += "\nimport { useTools } from '@homie-rocks/studio/worker';\nuseTools(async () => (await import('./tools/index.mjs')).default);\n";writeFileSync(worker,text);}
  }
  writeFileSync(join(dir,'declarations.json'),JSON.stringify({paid:defs.some(t=>t.price)})+'\n');
  return defs.map(t=>t.name);
}
