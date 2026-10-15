import {randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runner,configNames} from './cloudflare.mjs';
import {siteUrl} from './studio.mjs';
/** D1 administration uses the owner's existing Wrangler login. No bearer enters stdout or argv. */
export async function connectorToken(root,{url,tools,out,revoke,days=30,execute}={}) {
 const run=execute??(async file=>{const names=configNames(root);if(!names.d1)throw new Error('Studio database is not configured');const result=runner(root)(['d1','execute',names.d1,'--remote','--file',file]);if(result.code!==0)throw new Error('Connector token database operation failed; check the existing Wrangler login and studio database');});
 const scratch=mkdtempSync(join(tmpdir(),'homie-connector-'));
 const sql=async text=>{const file=join(scratch,'token.sql');writeFileSync(file,text,{mode:0o600});await run(file);};
 const quote=value=>"'"+value.replaceAll("'","''")+"'";
 try {
 if(revoke){if(!/^[a-f0-9]{64}$/.test(revoke))throw new Error('Invalid connector id');await sql(`DELETE FROM mcp_kv WHERE key='connector:${revoke}';`);return {ok:true,command:'connector',revoked:revoke};}
 if(!Array.isArray(tools)||!tools.length||tools.length>100||tools.some(t=>! /^[a-zA-Z0-9_-]{1,128}$/.test(t)))throw new Error('Provide explicit tool names with --tools (no wildcard)');
 if(!out)throw new Error('Provide --out for the private connector configuration');
 if(!Number.isInteger(days)||days<1||days>90)throw new Error('Expiry must be 1–90 days');
 const origin=new URL(url??siteUrl(root)).origin;if(!origin.startsWith('https://'))throw new Error('Connector requires HTTPS');
 const token='homie_owner_'+randomBytes(32).toString('hex');const id=createHash('sha256').update(token).digest('hex');
 const expires=Math.floor(Date.now()/1000)+days*86400;
 const value=JSON.stringify({origin,tools:[...new Set(tools)],expires});
 // Reserve the destination before minting; never overwrite a credential or follow a symlink.
 const path=resolve(root,out);writeFileSync(path,'',{flag:'wx',mode:0o600});
 try{
 await sql(`INSERT INTO mcp_kv(key,value,expires) VALUES('connector:${id}',${quote(value)},${expires});`);
 writeFileSync(path,JSON.stringify({mcpServers:{studio:{url:origin+'/mcp/auth',headers:{Authorization:'Bearer '+token}}}},null,2)+'\n',{mode:0o600});
 }catch(error){rmSync(path,{force:true});throw error;}
 return {ok:true,command:'connector',id,file:path,expires,tools:[...new Set(tools)]};
 }finally{rmSync(scratch,{recursive:true,force:true});}
}
