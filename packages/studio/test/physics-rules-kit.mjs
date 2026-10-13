import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as esbuild from 'esbuild';
import {guardRules} from '../lib/rules-guard.mjs';
import {loadRules,viewPlugin} from '../lib/rules-build.mjs';
import {bakePhysicsMesh} from '../lib/physics-mesh.mjs';
export async function physicsKit(root) {
 const fixture=fileURLToPath(new URL('./fixtures/physics-arena/',import.meta.url));
 const dir=join(root,'game');mkdirSync(join(dir,'src'),{recursive:true});
 for(const name of ['rules.ts','move.ts'])cpSync(join(fixture,name),join(dir,'src',name));
 const guarded=await guardRules(esbuild,root,dir);if(!guarded.ok)throw Error(JSON.stringify(guarded.problems));
 const map={bounds:{min:[-100,-100,-100],max:[100,100,100]},physics:await bakePhysicsMesh(join(fixture,'level.glb'))};
 const L=await loadRules(esbuild,root,'arena',guarded.code,{physics:true});
 await L.initializePhysics(readFileSync(new URL(import.meta.resolve('@homie-rocks/physics/vendor/rapier.wasm'))));
 const settings=L.R.roomSettings({host:'server',offline:false}).settings;
 const compiled=L.R.compileRules(L.def,{map:L.R.compileMap(map),seats:8,settings});
 const rules={code:guarded.code,files:guarded.files,map,settings,schema:L.R.schemaOf(compiled),publicTune:{},tune:{},seats:8,build:'physics-048'};
 const entry=join(root,'view-entry.ts');writeFileSync(entry,`import {openRoom} from ${JSON.stringify(fileURLToPath(new URL('../rules/view.ts',import.meta.url)))};globalThis.__physicsOpenRoom=openRoom;`);
 const file=join(root,'view.mjs');
 await esbuild.build({entryPoints:['homie:view'],bundle:true,format:'esm',platform:'browser',outfile:file,plugins:[viewPlugin({id:'arena',dir},rules,entry)],logLevel:'silent'});
 await import(pathToFileURL(file).href);
 return {L,compiled,openRoom:globalThis.__physicsOpenRoom,rules,dir,file};
}
