import {createHash} from 'node:crypto';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const history=JSON.parse(readFileSync(new URL('./app-preset-history.json',import.meta.url),'utf8'));
const presets=fileURLToPath(new URL('../app-starters/',import.meta.url));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
// A three-way merge: only values still equal to the old preset take the new default.
function merge(mine,old,next) {
 if(equal(mine,old))return next;
 if(!object(mine)||!object(old)||!object(next))return mine;
 const result={...mine};
 for(const key of new Set([...Object.keys(old),...Object.keys(next)])) {
  const value=merge(mine[key],old[key],next[key]);
  if(value===undefined)delete result[key];else result[key]=value;
 }
 return result;
}
export function appPresetChanges(root) {
 const changes=[];const apps=join(root,'apps');if(!existsSync(apps))return changes;
 for(const entry of readdirSync(apps,{withFileTypes:true})) {
  if(!entry.isDirectory())continue;
  const rel=`apps/${entry.name}`,file=join(root,rel,'app.json');if(!existsSync(file))continue;
  const text=readFileSync(file,'utf8');let mine;try{mine=JSON.parse(text);}catch{continue;}
  const kind=mine.starter?.kind,old=history[kind];if(!old)continue;
  const next=JSON.parse(readFileSync(join(presets,kind,'app.json'),'utf8'));
  const merged=merge(mine,old.meta,next);merged.id=mine.id;merged.name=mine.name;
  if(!equal(mine,merged))changes.push({file:rel+'/app.json',kind:'update-file',what:'refresh unchanged app preset defaults; keep studio edits',from:text,text:JSON.stringify(merged,null,2)+'\n'});
  for(const [path,hash] of Object.entries(old.files)) {
   if(path==='app.json'||!existsSync(join(root,rel,path))||!existsSync(join(presets,kind,path)))continue;
   const from=readFileSync(join(root,rel,path),'utf8');
   const normalized=from.replaceAll(`game: '${mine.id}'`,"game: 'welcome'");
   if(createHash('sha256').update(normalized).digest('hex')!==hash)continue;
   const want=readFileSync(join(presets,kind,path),'utf8').replaceAll("game: 'welcome'",`game: '${mine.id}'`);
   if(from!==want)changes.push({file:rel+'/'+path,kind:'update-file',what:'refresh untouched app preset file',from,text:want});
  }
 }
 return changes;
}
