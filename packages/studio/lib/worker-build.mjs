import {createHash} from 'node:crypto';
import {refreshWorkerConfig} from './worker-config.mjs';
import {pathToFileURL} from 'node:url';
import {existsSync,mkdirSync,writeFileSync,renameSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,relative,basename,sep,resolve} from 'node:path';
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
  refreshWorkerConfig(root);
  const current=join(out,'current.json'), pending=`${current}.${process.pid}.tmp`;
  writeFileSync(pending,JSON.stringify({main:join(dir,'worker.js')})+'\n');renameSync(pending,current);
  // Dev sometimes watches a copy with routes/remote AI removed. Publish its
  // entry too, keeping its local bindings and its module root at one generation.
  const local=join(workerDir(root),'.wrangler','homie-dev.wrangler.json');
  if(existsSync(local)) {
    const config=JSON.parse(readFileSync(local,'utf8'));
    if(typeof config.main==='string' && config.main.startsWith(out+sep)) {
      config.main=join(dir,'worker.js');
      const text=JSON.stringify(config,null,2)+'\n';
      if(readFileSync(local,'utf8')!==text) {const temp=`${local}.${process.pid}.tmp`;writeFileSync(temp,text);renameSync(temp,local);}
    }
  }
  const sizes=Object.entries(result.metafile.outputs).map(([path,value])=>({path:relative(root,join(dir,basename(path))),bytes:value.bytes,imports:value.imports}));
  writeFileSync(join(out,'modules.json'),JSON.stringify(sizes,null,2)+'\n');
  return sizes;
}

/** Local immutable entry; the committed config always names the stable shim. */
export function workerEntry(root) {
  const main=readConfig(root)?.main;
  // Explicit custom entry points remain the owner's choice.
  if(typeof main!=='string' || resolve(workerDir(root),main)!==resolve(root,'site/src/runtime/worker.js'))return null;
  const file=join(root,'site/src/runtime/current.json');
  return existsSync(file)?JSON.parse(readFileSync(file,'utf8')).main:null;
}
