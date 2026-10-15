/** Owner CLI authorization and private stdin handoff, restored from the 0.51.x flow. */
import { randomUUID } from 'node:crypto';
import { completionArgs, stripeProcess } from './stripe-connect.mjs';
import { SHOP_EVENTS } from '../worker/stripe-events.mjs';
import { WEBHOOK_SECRET_SHAPE, formEncode } from '../worker/stripe.mjs';
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
export async function ownerStripeApi({ root, profile, mode, account, process: run = stripeProcess, open, log = () => {}, onEvent, installExec }) {
 const cli = args => run(['--project-name', profile, ...args], { cwd: root });
 if ((await cli(['--version'])).code !== 0) {
  const result = await (installExec ?? ((command,args)=>stripeProcess(args,{cwd:root,command})))(process.platform==='win32'?'npm.cmd':'npm',['install','--global','@stripe/cli@latest']);
  if (result.code !== 0 || (await cli(['--version'])).code !== 0) throw new Error('Install the official Stripe CLI and retry');
 }
 const readAccount = () => cli(['get','/v1/account',...(mode==='live'?['--live']:[])]);
 let probe = await readAccount();
 if (probe.code !== 0 || !/^acct_[A-Za-z0-9]+$/.test(parse(probe.stdout)?.id ?? '')) {
  const start = await cli(['login','--non-interactive']);
  const login = parse(start.stdout), complete = completionArgs(login?.next_step);
  let validURL=false;try {const url=new URL(login?.browser_url);validURL=url.protocol==='https:'&&['dashboard.stripe.com','access.stripe.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port;}catch{}
  if(start.code!==0 || !complete || !validURL || !/^[a-zA-Z0-9 -]{1,100}$/.test(login?.verification_code??''))throw new Error('Stripe browser approval unavailable');
  log(`Approve the Stripe link for your studio account. Pairing code: ${login.verification_code}. ${login.browser_url}`);
  onEvent?.({type:'stripe.pairing',code:login.verification_code,url:login.browser_url});
  open(login.browser_url);
  if((await cli(complete)).code!==0)throw new Error('Stripe approval unfinished');
  probe=await readAccount();
 }
 const identity=parse(probe.stdout)?.id;
 if(probe.code!==0 || !/^acct_[A-Za-z0-9]+$/.test(identity??'') || account && identity!==account)throw new Error('Stripe account mismatch');
 const api=async(method,path,params={},idempotency)=>{
  const args=[method.toLowerCase(),path,'--stripe-version','2025-03-31.basil',...(mode==='live'?['--live']:[]),...(idempotency?['--idempotency',idempotency]:[])];
  if(method==='DELETE')args.push('--confirm');
  for(const [k,v] of formEncode(params))args.push('-d',`${k}=${v}`);
  const result=await cli(args),body=parse(result.stdout);
  if(result.code!==0 || !body || body.error)throw Object.assign(new Error('Private Stripe request failed'),{status:body?.error?.code==='resource_missing'?404:undefined});
  return body;
 };
 return {api,account:identity};
}
export async function installStripeWebhook({api,account,origin,mode,w,receipt={},save}) {
 const listed=await w(['secret','list']);
 const names=parse(listed.stdout??listed.out);
 if(listed.code!==0 || !Array.isArray(names))throw new Error('Cannot inspect Worker secret names');
 const url=origin+'/api/shop/hook';
 const id=receipt.webhookId??receipt.endpoint;
 let endpoint;
 if(id && receipt.url===url) {
  // A missing endpoint can be replaced, but permission/network errors cannot.
  const page=await api('GET','/v1/webhook_endpoints',{limit:100});
  let cursor, current=page;
  while(true){endpoint=current.data?.find(e=>e.id===id);if(endpoint||!current.has_more)break;const next=current.data?.at(-1)?.id;if(!next||next===cursor)throw new Error('Invalid endpoint cursor');cursor=next;current=await api('GET','/v1/webhook_endpoints',{limit:100,starting_after:cursor});}
 }
 if(endpoint?.url===url && endpoint.status==='enabled' && names.some(s=>s.name==='STRIPE_WEBHOOK_SECRET')) {
  if(endpoint.enabled_events?.length!==SHOP_EVENTS.length || !SHOP_EVENTS.every(e=>endpoint.enabled_events.includes(e)))await api('POST','/v1/webhook_endpoints/'+id,{enabled_events:SHOP_EVENTS});
 } else {
  const pending=receipt.url===url && receipt.pending ? receipt.pending : randomUUID();
  save({...receipt,account,mode,url,pending});
  endpoint=await api('POST','/v1/webhook_endpoints',{url,enabled_events:SHOP_EVENTS,api_version:'2025-03-31.basil',metadata:{homie:'shop-v1'},description:'Studio shop'},'webhook-'+pending);
  if(!/^we_[A-Za-z0-9]+$/.test(endpoint.id??'') || !WEBHOOK_SECRET_SHAPE.test(endpoint.secret??''))throw new Error('Invalid webhook');
  if((await w(['secret','put','STRIPE_WEBHOOK_SECRET'],{input:endpoint.secret})).code!==0)throw new Error('Webhook secret installation failed');
 }
 const installed={account,mode,url,webhookId:endpoint.id};save(installed);return installed;
}
