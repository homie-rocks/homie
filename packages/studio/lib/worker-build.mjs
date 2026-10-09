import {existsSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,relative,dirname} from 'node:path';
import {readConfig} from './routes.mjs';
import {paidReleases} from './parts-upload.mjs';
import {configPath} from './studio.mjs';
/** Preserve dynamic imports as real Worker modules: page startup never evaluates MCP libraries. */
export async function buildWorker(root,esbuild) {
  const source=join(root,'site/src/worker.mjs');if(!existsSync(source))return;
  const out=join(root,'site/src/runtime');
  const alias={...(readConfig(root)?.alias??{})};
  if(paidReleases(root).length)alias['@homie-rocks/studio/worker']='@homie-rocks/studio/worker/selling';
  const result=await esbuild.build({entryPoints:[source],absWorkingDir:root,alias,outdir:out,bundle:true,splitting:true,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],target:'es2022',write:false,minify:true,metafile:true,logLevel:'silent'});
  rmSync(out,{recursive:true,force:true});
  mkdirSync(out,{recursive:true});
  for(const file of result.outputFiles)writeFileSync(file.path,file.contents);
  const config=configPath(root);
  if(existsSync(config)){
    const original=readFileSync(config,'utf8');
    const json=JSON.parse(original.replace(/^\s*\/\/.*$/gm,''));
    const before=JSON.stringify(json);
    json.main=relative(dirname(config),join(out,'worker.js')).split('\\').join('/');
    json.no_bundle=true;json.find_additional_modules=true;
    json.rules=[...(json.rules??[]).filter(r=>!r.homieMcp),{type:'ESModule',globs:['**/*.js'],fallthrough:true}];
    // No duplicate rule on rebuild.
    json.rules=json.rules.filter((r,i,all)=>all.findIndex(x=>JSON.stringify(x)===JSON.stringify(r))===i);
    json.compatibility_flags=[...new Set([...(json.compatibility_flags??[]),'nodejs_compat'])];
    if(JSON.stringify(json)!==before) {
      const comments=original.match(/^(?:\s*\/\/[^\n]*\n)*/)?.[0]??'';
      writeFileSync(config,comments+JSON.stringify(json,null,2)+'\n');
    }
  }
  const sizes=Object.entries(result.metafile.outputs).map(([path,value])=>({path:relative(root,path),bytes:value.bytes,imports:value.imports}));
  writeFileSync(join(out,'modules.json'),JSON.stringify(sizes,null,2)+'\n');
  return sizes;
}
