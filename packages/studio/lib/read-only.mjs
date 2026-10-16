/**
 * homie-studio read-only on|off|status [--url <site>]
 *
 * Freezes the studio for a few minutes (a move to another host, maintenance) without losing anything: the Worker
 * secret STUDIO_READ_ONLY=1, set and deleted with the studio's own Wrangler sign-in. Cloudflare applies a secret to
 * the live Worker at once, with no build or deploy, and a deploy made while it is on keeps it on. What the Worker
 * does while it is on is worker/read-only.mjs. After the change the command reads the live site's /api/games
 * (`readOnly`) until it agrees, so the person is told what the site does, not only what was asked of Cloudflare.
 */
import {readStudio,siteUrl} from './studio.mjs';
import {runner} from './cloudflare.mjs';
import {redactText} from './redact.mjs';
import {READ_ONLY_HEADER,READ_ONLY_RETRY_SECONDS} from '../worker/read-only.mjs';

export const READ_ONLY_SETTING='STUDIO_READ_ONLY';
const ACTIONS=['on','off','status'];

const wranglerSaid=r=>redactText(String([r?.out,r?.stdout].filter(Boolean).join('\n')||'Wrangler failed')).text.trim().slice(-1200);

/** What the live site says now: true or false from /api/games, null when it could not be read. */
async function liveReadOnly(site,want,{fetchFn,wait,tries}) {
  let seen=null;
  for(let i=0;i<tries;i++) {
    if(i&&wait)await new Promise(r=>setTimeout(r,wait));
    try {
      const res=await fetchFn(new URL('/api/games',site),{headers:{accept:'application/json'},signal:AbortSignal.timeout(10_000)});
      const body=res.ok?await res.json():null;
      seen=typeof body?.readOnly==='boolean'?body.readOnly:null;
    } catch {seen=null;}
    if(seen===want)return seen;
  }
  return seen;
}

export async function readOnlyCommand(root,action,{run=null,fetchFn=fetch,url=null,wait=2000,tries=10}={}) {
  if(!ACTIONS.includes(action))throw new Error('Use homie-studio read-only on, off or status');
  const command=`read-only ${action}`;
  const studio=readStudio(root),cf=studio.cloudflare??{};
  if(!cf.worker)return {ok:false,command,needs:'deploy',why:'This studio is not on Cloudflare yet, so there is nothing to make read-only: deploy it first (homie-studio deploy).'};
  const w=run??runner(root,cf.accountId?{CLOUDFLARE_ACCOUNT_ID:cf.accountId}:{});
  const listed=await w(['secret','list','--name',cf.worker]);
  let names=null;
  try{names=listed.code===0?JSON.parse(listed.stdout??listed.out).map(s=>s.name):null;}catch{names=null;}
  if(!names)return {ok:false,command,needs:'cloudflare',why:`Wrangler could not read the Worker's settings (sign in with npx wrangler login, then run this again).\n${wranglerSaid(listed)}`};
  const was=names.includes(READ_ONLY_SETTING);
  const readOnly=action==='status'?was:action==='on';
  const already=action!=='status'&&was===readOnly;
  if(!already&&action!=='status') {
    // The value travels on stdin, as every Worker secret does here; Cloudflare applies it as a new Worker version.
    const changed=action==='on'
      ?await w(['secret','put',READ_ONLY_SETTING,'--name',cf.worker],{input:'1\n'})
      :await w(['secret','delete',READ_ONLY_SETTING,'--name',cf.worker],{input:'y\n'});
    if(changed.code!==0)return {ok:false,command,needs:'cloudflare',why:`Cloudflare did not take the change, so the studio is still ${was?'read-only':'open'}.\n${wranglerSaid(changed)}`};
  }
  const site=url??siteUrl(root,studio);
  const live=site?await liveReadOnly(site,readOnly,{fetchFn,wait,tries:action==='status'?1:tries}):null;
  const state=readOnly?'read-only':'open';
  const lines=[
    action==='status'?`The studio is ${state} (Cloudflare's setting ${READ_ONLY_SETTING} is ${was?'set':'not set'}).`
      :already?`The studio was already ${state}: nothing was changed.`
      :readOnly?`The studio is read-only now. Every change answers 503 with Retry-After: ${READ_ONLY_RETRY_SECONDS} and ${READ_ONLY_HEADER}: 1 until you run homie-studio read-only off. Pages, games and live rooms keep working, and Stripe payments are still fulfilled.`
      :'The studio is open again: changes are taken, and what waited (room records, queued work) is delivered.',
    live===null?(site?`${site}/api/games did not answer, so what the live site does is unmeasured: run homie-studio read-only status.`:'This computer does not know the site\'s address: pass --url to check it.')
      :live===readOnly?`${site}/api/games says readOnly: ${live}.`
      :`${site}/api/games still says readOnly: ${live}. Cloudflare takes a few seconds: run homie-studio read-only status.`,
  ];
  if(!already&&action!=='status')lines.push('Cloudflare applied it as a new version of the Worker, as a deploy does: anyone in a live room reconnects once.');
  return {ok:true,command,readOnly,already,setting:READ_ONLY_SETTING,header:READ_ONLY_HEADER,worker:cf.worker,site,live,message:lines.join('\n')};
}
