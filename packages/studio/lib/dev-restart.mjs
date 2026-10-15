import {readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {localCredential} from './local-test.mjs';
const read=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return null;}};
export function takeDevRestart(root,secret){
 const file=join(root,'.studio','restart-request.json'),value=read(file);
 if(!value)return null;
 rmSync(file,{force:true});
 return value.secret===secret&&typeof value.id==='string'?value.id:null;
}
export function acknowledgeDevRestart(root,id){writeFileSync(join(root,'.studio','restart-result.json'),JSON.stringify({id}),{mode:0o600});}
export async function requestDevRestart(root,url,{timeout=60000}={}){
 const secret=localCredential(root,url);if(!secret)throw new Error('Restart requires this studio’s local dev credential');
 const id=randomUUID(),file=join(root,'.studio','restart-request.json');
 writeFileSync(file,JSON.stringify({id,secret}),{mode:0o600});
 try{
  const end=Date.now()+timeout;
  while(Date.now()<end){
   if(read(join(root,'.studio','restart-result.json'))?.id===id)return;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Dev did not acknowledge restart; run the current homie-studio dev');
 }finally{if(read(file)?.id===id)rmSync(file,{force:true});}
}
