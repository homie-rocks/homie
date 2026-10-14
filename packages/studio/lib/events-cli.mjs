import {randomBytes} from 'node:crypto';
import {readStudio,writeStudio,siteUrl} from './studio.mjs';
import {runner} from './cloudflare.mjs';
import {connectToolClient} from './tools-cli.mjs';
import {validateWebhook,webhookSecret} from '../worker/event-webhook-config.mjs';

/** Call directly from MCP, never through a persisted CLI job (the result reveals the key once). */
export async function eventsWebhook(root,action,name,url,{run,connect=connectToolClient,log=()=>{},after=0}={}) {
  if(!['add','rotate','remove','status','test'].includes(action))throw new Error('Use events webhook add <feed> <url>, rotate, remove, status or test <feed>');
  const studio=readStudio(root),feed=studio.mcp?.events?.[name];
  if(!feed)throw new Error('Declare this feed in studio.json mcp.events first');
  if(['status','test'].includes(action)) {
    const target=url??siteUrl(root);if(!target)throw new Error('Pass --url or publish the studio first');
    const client=await connect(root,new URL(target),{log});
    try{const result=await client.callTool({name:'studio_events_webhook_'+action,arguments:{feed:name,...(action==='status'?{after:Number(after)}:{})}});return {ok:!result.isError,command:'events webhook '+action,result};}finally{await client.close();}
  }
  const cf=studio.cloudflare??{};
  if(!cf.worker||!cf.created?.includes('worker:'+cf.worker))throw new Error('Publish this studio once before provisioning its Worker secrets');
  if(action==='add'&&feed.webhook)throw new Error('Webhook already exists; remove it before changing its URL, or rotate its key');
  if(action!=='add'&&!feed.webhook)throw new Error('Webhook not configured');
  const id=action==='add'?randomBytes(16).toString('hex'):feed.webhook.id;
  const binding=webhookSecret(id);
  const hook=action==='add'?{url,id,secret:binding}:feed.webhook;
  validateWebhook(name,hook);
  const w=run??runner(root,cf.accountId?{CLOUDFLARE_ACCOUNT_ID:cf.accountId}:{});
  const secret=action==='remove'?null:'whsec_'+randomBytes(32).toString('base64');
  // The secret travels on stdin only. Never surface provider output, even on failure.
  let result;try{result=await w(['secret',action==='remove'?'delete':'put',binding,'--name',cf.worker],{input:secret?secret+'\n':'y\n'});}catch{throw new Error('Worker secret update failed; check Cloudflare sign-in and retry');}
  if(result.code!==0)throw new Error('Worker secret update failed; check Cloudflare sign-in and retry');
  if(action==='remove')delete feed.webhook;else feed.webhook=hook;
  writeStudio(root,studio);
  return {ok:true,command:'events webhook '+action,feed:name,...(secret?{secret}:{}),next:action==='rotate'?'Key replaced in the Worker. Configure the receiver with this key; it is shown only here.':'Build, commit and deploy the updated feed declaration through your usual authorized workflow.'};
}
export function eventsCommand(root,sub,positional,flags,options={}) {
  if(sub!=='webhook')throw new Error('Use events webhook <add|remove|rotate|status|test>');
  return eventsWebhook(root,positional[2],positional[3],positional[4]??flags.get('url'),{...options,after:flags.get('after')??0});
}
