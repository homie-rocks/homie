import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {ensureStudioSigningKey} from '../../packages/studio/lib/studios-keys.mjs';
import {build} from 'esbuild';
import {Client,StreamableHTTPClientTransport} from 'mcp-studio-client';
import {fixtureSource} from './fixture.mjs';
import {studioResult} from '../../packages/studio/worker/studios-client.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=fileURLToPath(new URL('./.local/',import.meta.url));mkdirSync(dir,{recursive:true});
const suffix=Date.now().toString(36),names=['a','b'].map(role=>'hm-s2s-'+role+'-'+suffix);
const resources=[],report={studios:names,started:new Date().toISOString(),cleanup:[]};
const run=(args,input)=>new Promise((resolve,reject)=>{
 const child=spawn('npx',['--yes','wrangler@4.151.0',...args],{cwd:dir,env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['pipe','pipe','pipe']});let output='';
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 child.on('close',code=>code?reject(new Error('Wrangler '+args.slice(0,2).join(' ')+' failed; private output withheld')):resolve(output));child.stdin.end(input);
});
const client=new Client({name:'studio-proof',version:'1'});
try{
 const who=await run(['whoami']);
 const account=/\b[a-f0-9]{32}\b/.exec(who)?.[0];if(!account)throw new Error('Account unavailable');
 const urls=[],proofSecret=randomBytes(32).toString('hex');
 for(const [i,role] of ['a','b'].entries()){
  console.log('Creating '+names[i]);
  const created=await run(['d1','create',names[i]]);const id=/"database_id":\s*"([^"]+)"/.exec(created)?.[1]??/database_id\s*=\s*"([^"]+)"/.exec(created)?.[1];if(!id)throw new Error('Cannot parse created database: '+created);
  const config=dir+role+'.jsonc';resources.push({name:names[i],id,config,worker:false});
  const bundled=await build({stdin:{contents:fixtureSource(role),resolveDir:root+'packages/studio'},write:false,bundle:true,minify:true,format:'esm',platform:'browser',conditions:['workerd','worker','browser'],mainFields:['module','main'],external:['node:*','cloudflare:*']});
  writeFileSync(dir+role+'.mjs',bundled.outputFiles[0].text);
  writeFileSync(config,JSON.stringify({name:names[i],account_id:account,main:role+'.mjs',compatibility_date:'2026-10-13',compatibility_flags:['nodejs_compat','global_fetch_strictly_public'],workers_dev:true,vars:{PEER:'https://pending.example'},d1_databases:[{binding:'DB',database_name:names[i],database_id:id}]}));
  const migrations=readdirSync(root+'template/site/migrations').sort().map(file=>readFileSync(root+'template/site/migrations/'+file,'utf8')).join('\n');writeFileSync(dir+'migrations.sql',migrations);
  await run(['d1','execute',names[i],'--remote','--file',dir+'migrations.sql','--config',config,'--yes']);
  const deployed=await run(['deploy','--config',config]);resources[i].worker=true;
  const url=/https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(deployed)?.[0];if(!url)throw new Error('Deploy did not report a Worker URL');urls.push(url);
  await ensureStudioSigningKey({mcp:{studios:{}}},async(args,options)=>({code:0,stdout:await run([...args,'--config',config],options?.input)}));
  if(i===0)await run(['secret','bulk','--config',config],JSON.stringify({PROOF_SECRET:proofSecret}));
 }
 for(let i=0;i<2;i++){
  const config=resources[i].config,value=JSON.parse(readFileSync(config,'utf8'));value.vars.PEER=urls[1-i];writeFileSync(config,JSON.stringify(value));
  await run(['deploy','--config',config]);
 }
 await run(['d1','execute',names[1],'--remote','--config',resources[1].config,'--yes','--command',`INSERT INTO mcp_kv(key,value) VALUES('studio-policy:${urls[0]}','{"allow":true}')`]);
 await run(['d1','execute',names[1],'--remote','--config',resources[1].config,'--yes','--command',`INSERT INTO app_records(app,collection,id,value,version,updated_at) VALUES('venue','slots','morning','{"capacity":1,"start":"2030-10-15T10:00:00Z","end":"2030-10-15T11:00:00Z"}',1,1)`]);
 await client.connect(new StreamableHTTPClientTransport(new URL(urls[0]+'/mcp'),{requestInit:{headers:{'x-proof-key':proofSecret}}}));
 let result;
 for(let attempt=0;attempt<5;attempt++){result=studioResult(await client.callTool({name:'drive',arguments:{}}));if(!result.isError||!JSON.stringify(result).includes('1042'))break;console.log('Fresh deployment routing returned 1042; retrying stable proof IDs');await new Promise(resolve=>setTimeout(resolve,3000));}
 if(result.isError)throw new Error(JSON.stringify(result));
 if(result.data.booked.booking.state!=='confirmed')throw new Error('Reservation was not confirmed');
 report.result=result.data;console.log('Verified booking and event accepted');
 const arrival=await run(['d1','execute',names[1],'--remote','--config',resources[1].config,'--json','--command',"SELECT value FROM tool_data WHERE namespace='function:arrival' AND key='arrival'"]);
 const rows=JSON.parse(arrival);if(!rows[0]?.results?.length)throw new Error('Arrival function did not save receipt');report.arrival=JSON.parse(rows[0].results[0].value);
 await run(['d1','execute',names[1],'--remote','--config',resources[1].config,'--yes','--command',`UPDATE mcp_kv SET value='{"allow":false}' WHERE key='studio-policy:${urls[0]}'`]);
 report.denied=(await client.callTool({name:'drive',arguments:{}})).isError===true;if(!report.denied)throw new Error('Denied sender was accepted');
 console.log('Allowlist denial proved');
}catch(error){report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{
 await client.close();
 for(const resource of resources.reverse()){
  try{if(resource.worker)await run(['delete','--config',resource.config,'--force']);await run(['d1','delete',resource.name,'--config',resource.config,'--skip-confirmation']);report.cleanup.push({name:resource.name,deleted:true});console.log('Deleted '+resource.name);}
  catch(error){report.cleanup.push({name:resource.name,deleted:false,error:error.message});process.exitCode=1;console.error(error.message);}
 }
 report.finished=new Date().toISOString();writeFileSync(dir+'live-result.json',JSON.stringify(report,null,2)+'\n');
}
