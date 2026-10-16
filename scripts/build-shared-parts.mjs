// Build self-contained previews, then use the canonical parts hasher. Never hand-write hashes.
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
import {writeHashes,publicPart,readPart,writePart} from '../packages/studio/lib/parts.mjs';
const base='packages/studio/parts';
await build({entryPoints:[`${base}/terrain-route-map/preview/main.mjs`],outfile:`${base}/terrain-route-map/preview/demo.js`,bundle:true,format:'esm',minify:true,legalComments:'inline'});
const ids=['owner-action-checklist','terrain-route-map'];
const mapDir=`${base}/terrain-route-map`;
const map=readPart(mapDir);
for(const file of map.files ?? []) {
  if(file.path==='preview/demo.js') file.rights={license:'Apache-2.0 AND MIT'};
  if(file.path==='THIRD-PARTY-LICENSE') file.rights={license:'MIT'};
}
writePart(mapDir,map);
const parts=ids.map(id=>publicPart(writeHashes(`${base}/${id}`)));
writeFileSync(`${base}/catalogue.json`,JSON.stringify({v:1,studio:{name:'Homie toolkit'},parts},null,2)+'\n');
console.log('Built previews and hashed',ids.join(', '));
