#!/usr/bin/env node
/** Plugin sources are canonical; npm carries the exact release's authoring guides. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
for (const topic of ['game', 'app', 'plan', 'playtest', 'style', 'art', 'models', 'sound', 'video', 'music', 'parts', 'studio-setup', 'shop', 'servers', 'functions', 'office']) {
const source=join(root,'plugins/homie/skills',topic),out=join(root,'packages/studio/guides',topic);
mkdirSync(out,{recursive:true});
const names = readdirSync(source, {recursive:true}).filter(n=> /\.(md|mjs|json|js|html|css)$/.test(n));
for (const stale of readdirSync(out, {recursive:true}).filter(n => /\.(md|mjs|json|js|html|css)$/.test(n) && !names.includes(n))) {
  if (process.argv.includes('--check')) throw new Error(`retired npm guide ${topic}/${stale}: node scripts/authoring-guides.mjs`);
  rmSync(join(out, stale));
}
for(const name of names) {
  const text=readFileSync(join(source,name),'utf8'),target=join(out,name);
  if(process.argv.includes('--check')) {
    if(readFileSync(target,'utf8')!==text)throw new Error(`stale npm guide ${name}: node scripts/authoring-guides.mjs`);
  } else { mkdirSync(dirname(target), {recursive:true}); writeFileSync(target,text); }
}

}
const docs=join(root,'packages/studio/docs');mkdirSync(docs,{recursive:true});
for(const name of ['rooms-milestone-2-notes.md']) {
  const text=readFileSync(join(root,'docs',name),'utf8'),target=join(docs,name);
  if(process.argv.includes('--check')) {if(readFileSync(target,'utf8')!==text)throw new Error(`stale npm document ${name}`);}
  else writeFileSync(target,text);
}
