/** Omit error-page HTML (including client IP); retain status, timing and cf-ray. */
import {readdirSync,readFileSync,writeFileSync} from 'node:fs';import {resolve,basename} from 'node:path';
const dir=resolve(process.argv[2]);if(!/^managed-step-1-round\d+$/.test(basename(dir)))throw Error('Explicit managed proof directory required');
let changed=0;const clean=value=>{
 if(typeof value==='string'&&/<(?:!doctype|html)/i.test(value))return 'Cloudflare error-page HTML omitted; status and cf-ray retained';
 if(Array.isArray(value))return value.map(clean);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)]));
 return value;
};
for(const name of readdirSync(dir).filter(n=>n.endsWith('.json'))){const file=dir+'/'+name,raw=JSON.parse(readFileSync(file)),value=clean(raw);if(JSON.stringify(raw)!==JSON.stringify(value)){writeFileSync(file,JSON.stringify(value,null,2)+'\n');changed++;}}
console.log('Sanitized error pages in',changed,'proof files');
