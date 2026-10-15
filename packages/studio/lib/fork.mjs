import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {resolve,join,dirname,extname,relative} from 'node:path';
import {refreshWorkerConfig} from './worker-config.mjs';
/** Copy editable source, never account state, installed code or a deployment. */
export async function forkStudio(source,target,{name,slug,ids={}}={}) {
 source=resolve(source);target=resolve(target);
 if(existsSync(target))throw new Error('Fork target already exists');
 if(!/^[a-z][a-z0-9-]{0,39}$/.test(slug??'')||typeof name!=='string'||!name.trim())throw new Error('Supply name and a lowercase slug (1–40 letters, digits and hyphens)');
 if(!relative(source,target).startsWith('..'))throw new Error('Fork target must be outside the example');
 const studio=JSON.parse(readFileSync(join(source,'studio.json'),'utf8'));
 const excluded=new Set(['node_modules','.git','.studio','dist','.wrangler','.DS_Store','wrangler.json','wrangler.jsonc','wrangler.toml','wrangler.custom.json','package-lock.json']);
 const files=[];
 function walk(dir){for(const entry of readdirSync(join(source,dir),{withFileTypes:true})) {
  if(excluded.has(entry.name)||entry.name.startsWith('.')&&entry.name!=='.gitignore'||entry.name.startsWith('.dev.vars')||entry.name.endsWith('.sqlite')||entry.name.endsWith('.db')||entry.name.endsWith('.pem')||entry.name.endsWith('.key')||entry.isSymbolicLink())continue;
  const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(entry.isFile())files.push(path);
 }}walk('');
 const mapping=new Map([[studio.slug,slug],[studio.name,name]]);
 const collect=value=>{if(!value||typeof value!=='object')return;if(typeof value.id==='string'&&/^[a-z][a-z0-9-]*$/.test(value.id))mapping.set(value.id,ids[value.id]??`${slug}-${value.id}`);for(const child of Object.values(value))collect(child);};
 for(const file of files.filter(p=>p.endsWith('.json')&&!['studio.json','package.json'].includes(p)))try{collect(JSON.parse(readFileSync(join(source,file),'utf8')));}catch{}
 const ts=(await import('typescript')).default;
 for(const file of files.filter(p=>/\.(?:[cm]?js|tsx?)$/.test(p))) {
  const tree=ts.createSourceFile(file,readFileSync(join(source,file),'utf8'),ts.ScriptTarget.Latest,true);
  const visit=node=>{
   if(ts.isPropertyAssignment(node)&&(ts.isIdentifier(node.name)||ts.isStringLiteral(node.name))&&node.name.text==='id'&&ts.isStringLiteral(node.initializer))collect({id:node.initializer.text});
   ts.forEachChild(node,visit);
  };visit(tree);
 }
 for(const [old,next] of Object.entries(ids))mapping.set(old,next);
 for(const [old,next] of mapping)if(typeof next!=='string'||!next.length)throw new Error(`Invalid replacement for ${old}`);
 for(const [old,next] of mapping)if(old!==studio.name&&(!/^[a-z][a-z0-9-]{0,39}$/.test(next)))throw new Error(`Renamed id ${next} exceeds 40 characters; supply ids.${old}`);
 const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=new RegExp(`(?<![A-Za-z0-9_-])(?:${[...mapping.keys()].filter(Boolean).sort((a,b)=>b.length-a.length).map(escape).join('|')})(?![A-Za-z0-9_-])`,'g');
 const rewrite=s=>s.replace(pattern,value=>mapping.get(value));
 mkdirSync(target);
 try {
  for(const file of files) {
   const to=join(target,...file.split('/').map(part=>mapping.get(part)??part));mkdirSync(dirname(to),{recursive:true});
   if(['.json','.ts','.js','.mjs','.html','.css','.md','.sql','.txt','.svg','.yaml','.yml'].includes(extname(file)))writeFileSync(to,rewrite(readFileSync(join(source,file),'utf8')));else copyFileSync(join(source,file),to);
  }
  const fresh=JSON.parse(readFileSync(join(target,'studio.json'),'utf8'));fresh.name=name;fresh.slug=slug;delete fresh.github;delete fresh.template;
  fresh.cloudflare={worker:slug,d1:slug+'-db',created:[]};fresh.homie={...fresh.homie,directory:false};
  writeFileSync(join(target,'studio.json'),JSON.stringify(fresh,null,2)+'\n');
  const pkg=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));pkg.name=slug;delete pkg.repository;writeFileSync(join(target,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  refreshWorkerConfig(target);
  return {ok:true,command:'fork',root:target,renamed:Object.fromEntries(mapping),next:['npm install','homie-studio check']};
 }catch(error){rmSync(target,{recursive:true,force:true});throw error;}
}
