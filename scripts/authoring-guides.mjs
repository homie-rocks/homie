#!/usr/bin/env node
/** Plugin sources are canonical; npm carries the exact release's authoring guides. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'plugins/homie/skills/game'),out=join(root,'packages/studio/guides/game');
mkdirSync(out,{recursive:true});
for(const name of readdirSync(source).filter(n=>n.endsWith('.md'))) {
  const text=readFileSync(join(source,name),'utf8'),target=join(out,name);
  if(process.argv.includes('--check')) {
    if(readFileSync(target,'utf8')!==text)throw new Error(`stale npm guide ${name}: node scripts/authoring-guides.mjs`);
  } else writeFileSync(target,text);
}

const docs=join(root,'packages/studio/docs');mkdirSync(docs,{recursive:true});
for(const name of ['rooms-milestone-2-notes.md']) {
  const text=readFileSync(join(root,'docs',name),'utf8'),target=join(docs,name);
  if(process.argv.includes('--check')) {if(readFileSync(target,'utf8')!==text)throw new Error(`stale npm document ${name}`);}
  else writeFileSync(target,text);
}
