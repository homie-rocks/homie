import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {configPath} from './studio.mjs';
/** Preserve a studio's custom bindings and ordering on repeat deploys. */
export function updateWorkerConfig(root,generated) {
  const file=configPath(root);
  if(!existsSync(file)){writeFileSync(file,generated);return;}
  const original=readFileSync(file,'utf8'),parse=t=>JSON.parse(t.replace(/^\s*\/\/.*$/gm,''));
  const current=parse(original),desired=parse(generated);
  const next={...current};
  for(const key of ['name','main','assets','ai','routes'])if(desired[key]!==undefined)next[key]=desired[key];
  const merge=(old=[],fresh=[],key)=>[...old.map(value=>fresh.find(item=>item[key]===value[key])??value),...fresh.filter(item=>!old.some(value=>value[key]===item[key]))];
  for(const key of ['d1_databases','r2_buckets'])if(desired[key])next[key]=merge(current[key],desired[key],'binding');
  if(desired.durable_objects)next.durable_objects={...current.durable_objects,bindings:merge(current.durable_objects?.bindings,desired.durable_objects.bindings,'name')};
  if(desired.migrations)next.migrations=merge(current.migrations,desired.migrations,'tag');
  for(const key of ['no_bundle','find_additional_modules'])next[key]=true;
  next.compatibility_flags=[...new Set([...(current.compatibility_flags??[]),...desired.compatibility_flags])];
  next.rules=[...(current.rules??[])];for(const rule of desired.rules??[])if(!next.rules.some(r=>JSON.stringify(r)===JSON.stringify(rule)))next.rules.push(rule);
  if(desired.alias)next.alias={...current.alias,...desired.alias};
  if(desired.triggers)next.triggers={...current.triggers,crons:[...new Set([...(current.triggers?.crons??[]),...desired.triggers.crons])].sort()};
  if(JSON.stringify(next)!==JSON.stringify(current))writeFileSync(file,(original.match(/^(?:\s*\/\/[^\n]*\n)*/)?.[0]??'')+JSON.stringify(next,null,2)+'\n');
}
