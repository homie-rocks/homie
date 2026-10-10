import {createHash} from 'node:crypto';
import {refreshWorkerConfig} from './worker-config.mjs';
import {pathToFileURL} from 'node:url';
import {existsSync,mkdirSync,writeFileSync,renameSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,relative,basename} from 'node:path';
import {readConfig} from './routes.mjs';
import {workerDir} from './studio.mjs';
import {paidReleases} from './parts-upload.mjs';
/** Preserve dynamic imports as real Worker modules: page startup never evaluates MCP libraries. */
export async function buildWorker(root,esbuild) {
  const source=join(root,'site/src/worker.mjs');if(!existsSync(source))return;
  const out=join(root,'site/src/runtime');

  const alias={...(readConfig(root)?.alias??{})};
  const toolModule=join(root,'site/src/tools/index.mjs');
  const pricedTools=existsSync(toolModule) && (await import(pathToFileURL(toolModule).href+'?worker='+Date.now())).default.some(tool=>tool.price);
  if(paidReleases(root).length || existsSync(join(root,'shop.json')) || pricedTools)alias['@homie-rocks/studio/worker']='@homie-rocks/studio/worker/selling';
  const result=await esbuild.build({entryPoints:[source],absWorkingDir:root,alias,outdir:out,bundle:true,splitting:true,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*'],target:'es2022',write:false,minify:true,metafile:true,logLevel:'silent'});
  // A watcher may already have read the previous entry while this build is
  // publishing. Keep its entire graph available. Publish immutable modules first,
  // then switch the single entry atomically; never remove a running graph.
  const generation=createHash('sha256');
  for(const file of result.outputFiles)generation.update(basename(file.path)).update(file.contents);
  const id=generation.digest('hex').slice(0,24),dir=join(out,id);
  mkdirSync(out,{recursive:true});
  if(!existsSync(dir)) {
    const stage=mkdtempSync(join(out,'.generation-'));
    try {
      for(const file of result.outputFiles)writeFileSync(join(stage,basename(file.path)),file.contents);
      try {renameSync(stage,dir);} catch(error) {if(!existsSync(dir))throw error;}
    } finally {rmSync(stage,{recursive:true,force:true});}
  }
  const entry=`export * from './${id}/worker.js';\nexport {default} from './${id}/worker.js';\n`;
  const target=join(out,'worker.js');
  if(!existsSync(target)||readFileSync(target,'utf8')!==entry) {
    const temp=join(out,`.worker-${process.pid}.tmp`);
    writeFileSync(temp,entry);renameSync(temp,target);
  }
  // Wrangler's module root is the immutable generation, so old generations are
  // retained locally for in-flight reloads but are never added to a deployment.
  refreshWorkerConfig(root,{main:relative(workerDir(root),join(dir,'worker.js'))});
  const sizes=Object.entries(result.metafile.outputs).map(([path,value])=>({path:relative(root,join(dir,basename(path))),bytes:value.bytes,imports:value.imports}));
  writeFileSync(join(out,'modules.json'),JSON.stringify(sizes,null,2)+'\n');
  return sizes;
}
