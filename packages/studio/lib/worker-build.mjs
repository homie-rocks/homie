import {refreshWorkerConfig} from './worker-config.mjs';
import {pathToFileURL} from 'node:url';
import {existsSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,relative} from 'node:path';
import {readConfig} from './routes.mjs';
import {paidReleases} from './parts-upload.mjs';
/** Preserve dynamic imports as real Worker modules: page startup never evaluates MCP libraries. */
export async function buildWorker(root,esbuild) {
  const source=join(root,'site/src/worker.mjs');if(!existsSync(source))return;
  const out=join(root,'site/src/runtime');
  refreshWorkerConfig(root);
  const alias={...(readConfig(root)?.alias??{})};
  const toolModule=join(root,'site/src/tools/index.mjs');
  const pricedTools=existsSync(toolModule) && (await import(pathToFileURL(toolModule).href+'?worker='+Date.now())).default.some(tool=>tool.price);
  if(paidReleases(root).length || existsSync(join(root,'shop.json')) || pricedTools)alias['@homie-rocks/studio/worker']='@homie-rocks/studio/worker/selling';
  const result=await esbuild.build({entryPoints:[source],absWorkingDir:root,alias,outdir:out,bundle:true,splitting:true,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],target:'es2022',write:false,minify:true,metafile:true,logLevel:'silent'});
  rmSync(out,{recursive:true,force:true});
  mkdirSync(out,{recursive:true});
  for(const file of result.outputFiles)writeFileSync(file.path,file.contents);
  const sizes=Object.entries(result.metafile.outputs).map(([path,value])=>({path:relative(root,path),bytes:value.bytes,imports:value.imports}));
  writeFileSync(join(out,'modules.json'),JSON.stringify(sizes,null,2)+'\n');
  return sizes;
}
