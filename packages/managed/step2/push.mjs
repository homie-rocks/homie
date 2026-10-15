/** Test author action: modify only the disposable source copy and push one repo. */
import {readFileSync,writeFileSync} from 'node:fs';import {git} from './source.mjs';import {api,local,state,save} from './operator.mjs';
const variant=process.argv[2];if(!['one','two','bad-build','bad-check'].includes(variant))throw new Error('one|two|bad-build|bad-check');
const root=local+'source';
if(variant==='bad-build'||variant==='bad-check'){
 const p=JSON.parse(readFileSync(root+'/package.json'));p.scripts[variant==='bad-build'?'build':'check']='node -e "process.exit(17)"';writeFileSync(root+'/package.json',JSON.stringify(p,null,2)+'\n');
}else{const p=JSON.parse(readFileSync(root+'/studio.json'));p.tagline='Managed step 2 — '+variant;writeFileSync(root+'/studio.json',JSON.stringify(p,null,2)+'\n');}
git(['add','studio.json','package.json'],{cwd:root});git(['-c','user.name=Ryan Campbell','-c','user.email=ryan@ryancampbell.com','commit','-s','-m','Managed step 2 proof: '+variant],{cwd:root});
const t=await api('artifacts/namespaces/hm-s2-source/tokens','POST',{repo:'hm-s2-little-inlet',scope:'write',ttl:120});
try{git(['push',state.remote,'HEAD:main'],{cwd:root,token:t.plaintext});}finally{await api('artifacts/namespaces/hm-s2-source/tokens/'+t.id,'DELETE');}
const commit=git(['rev-parse','HEAD'],{cwd:root}).stdout.trim();state.pushes??=[];state.pushes.push({variant,commit,at:new Date().toISOString()});save();console.log({variant,commit});
