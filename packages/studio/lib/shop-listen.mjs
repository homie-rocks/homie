/** Private local Stripe forwarding. Only the allowlisted readiness line reaches the model. */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {stripeProcess,completionArgs} from './stripe-connect.mjs';
export function saveLocalStripe(root,values) {
  const file=join(root,'.dev.vars');
  let text=existsSync(file)?readFileSync(file,'utf8'):'';
  for(const [key,value] of Object.entries(values)) {
    text=text.replace(new RegExp(`^${key}=.*\\n?`,'gm'),'');
    text+=`\n${key}=${value}\n`;
  }
  writeFileSync(file,text,{mode:0o600});
  chmodSync(file,0o600);
}
export async function shopListen(root,{profile,port=8787,log=()=>{},exec=stripeProcess,spawnProcess=spawn}={}) {
  if(!profile || !Number.isInteger(Number(port)) || Number(port)<1 || Number(port)>65535)throw new Error('Supply a sandbox profile and local port');
  const cli=args=>exec(['--project-name',profile,...args],{cwd:root});
  const probe=await cli(['get','/v1/products','-d','limit=1']);
  if(probe.code!==0) {
    const start=await cli(['login','--non-interactive']);
    let login;try{login=JSON.parse(start.stdout);}catch{}
    const complete=completionArgs(login?.next_step);
    const u=login?.browser_url;
    if(!complete || !/^https:\/\/(dashboard|access)\.stripe\.com\//.test(u??''))throw new Error('Update Stripe CLI and retry local browser approval');
    log(`Approve Stripe sandbox access: ${u}`);
    if((await cli(complete)).code!==0)throw new Error('Stripe browser approval did not finish');
  }
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('STRIPE_'))delete env[key];
  return new Promise((resolve,reject)=>{
    const child=spawnProcess('stripe',['--project-name',profile,'listen','--all-snapshot','--forward-to',`http://localhost:${port}/api/shop/hook`],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    let buffer='',ready=false;
    const capture=data=>{
      buffer=(buffer+data.toString()).slice(-8192);
      const secret=/whsec_[A-Za-z0-9+/=_-]+(?=[\s\x1b])/.exec(buffer)?.[0];
      if(secret && !ready){saveLocalStripe(root,{STRIPE_WEBHOOK_SECRET:secret});ready=true;buffer='';log('Stripe sandbox forwarding ready. Signing secret saved privately; start/restart homie-studio dev.');}
    };
    child.stdout.on('data',capture);child.stderr.on('data',capture);
    child.on('error',()=>reject(new Error('Install Stripe CLI before local forwarding')));
    const stop=()=>child.kill();process.once('SIGTERM',stop);process.once('SIGINT',stop);
    child.on('close',code=>{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);resolve({ok:ready&&code===0,command:'shop listen',ready});});
  });
}
