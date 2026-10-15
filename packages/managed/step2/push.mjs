/** Test author action: modify only the disposable source copy and push one repo. */
import {readFileSync,writeFileSync} from 'node:fs';import {git} from './source.mjs';import {api,local,state,save} from './operator.mjs';
const variant=process.argv[2];if(!['one','two','three','four','fixture','bad-build','bad-check'].includes(variant))throw new Error('one|two|bad-build|bad-check');
const root=local+'source';
if(variant==='three'){
 git(['rm','-r','proof','perf'],{cwd:root});
 const p=JSON.parse(readFileSync(root+'/package.json'));p.scripts.build='node scripts/hm-s2-credential-probe.cjs && homie-studio build';writeFileSync(root+'/package.json',JSON.stringify(p,null,2)+'\n');
 writeFileSync(root+'/scripts/hm-s2-credential-probe.cjs',readFileSync(new URL('./credential-probe.cjs',import.meta.url)));
 git(['add','scripts/hm-s2-credential-probe.cjs'],{cwd:root});
}

if(variant==='fixture'){
 const path=root+'/apps/gathering/CODEX.md',source=readFileSync(path,'utf8');
 const match=/^```needs\s*\n([\s\S]*?)^```/m.exec(source);const needs=JSON.parse(match[1]);
 const shifts=needs.find(n=>n.id==='volunteer-shifts');
 shifts.steps=[{role:'owner',schedule:{name:'rolling-slots',at:Date.now()}},{surface:'phone',reload:true},{surface:'wall',reload:true}];
 writeFileSync(path,source.replace(match[0],'```needs\n'+JSON.stringify(needs,null,2)+'\n```'));
 git(['add','apps/gathering/CODEX.md'],{cwd:root});
}

if(variant==='bad-build'||variant==='bad-check'){
 const p=JSON.parse(readFileSync(root+'/package.json'));if(variant==='bad-check')p.scripts.build='node scripts/hm-s2-credential-probe.cjs && homie-studio build';p.scripts[variant==='bad-build'?'build':'check']='node -e "process.exit(17)"';writeFileSync(root+'/package.json',JSON.stringify(p,null,2)+'\n');
}else{const p=JSON.parse(readFileSync(root+'/studio.json'));p.tagline='Managed step 2 — '+variant;writeFileSync(root+'/studio.json',JSON.stringify(p,null,2)+'\n');}
git(['add','studio.json','package.json'],{cwd:root});git(['-c','user.name=Ryan Campbell','-c','user.email=ryan@ryancampbell.com','commit','-s','-m','Managed step 2 proof: '+variant],{cwd:root});
const t=await api('artifacts/namespaces/hm-s2-source/tokens','POST',{repo:'hm-s2-little-inlet',scope:'write',ttl:120});
try{git(['push',state.remote,'HEAD:main'],{cwd:root,token:t.plaintext});}finally{await api('artifacts/namespaces/hm-s2-source/tokens/'+t.id,'DELETE');}
const commit=git(['rev-parse','HEAD'],{cwd:root}).stdout.trim();state.pushes??=[];state.pushes.push({variant,commit,at:new Date().toISOString()});save();console.log({variant,commit});
