import {readFileSync,mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHmac} from 'node:crypto';
export function createLocalCredential(root) {
  const secret=randomBytes(32).toString('hex');
  mkdirSync(join(root,'.studio'),{recursive:true});
  const file=join(root,'.studio','local-test.json');
  writeFileSync(file,JSON.stringify({secret}),{mode:0o600});chmodSync(file,0o600);
  return secret;
}
export function localCredential(root,site) {
  if(!root||!['localhost','127.0.0.1','[::1]'].includes(new URL(site).hostname))return null;
  try{return JSON.parse(readFileSync(join(root,'.studio','local-test.json'),'utf8')).secret;}catch{return null;}
}
export function localCookie(secret,session) {
  const data=Buffer.from(JSON.stringify(session)).toString('base64url');
  return data+'.'+createHmac('sha256',secret).update(data).digest('hex');
}
