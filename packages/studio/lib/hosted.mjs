/**
 * A STUDIO HOSTED BY A GIT HOST. Some studios do not deploy to their owner's own Cloudflare: a
 * hosting service keeps the source, builds a private preview on every push to main and puts a
 * version live when the owner says so. studio.json says so:
 *
 *   "hosting": { "git": "https://host.example/…/studio.git", "mcp": "https://host.example/…/mcp" }
 *
 * Then `deploy` is a push, the host's MCP server (if it has one) answers build progress and
 * publishing, and nothing here ever signs in to or deploys to a Cloudflare account.
 *
 * Signing in uses only published standards, so it works with any host that follows them:
 * the Git remote answers 401 with WWW-Authenticate naming its OAuth protected-resource metadata
 * (RFC 9728), whose authorization server is discovered by RFC 8414; this toolkit registers itself
 * (RFC 7591) and signs in with the authorization code flow and PKCE (RFC 7636, S256) on a
 * loopback redirect (RFC 8252), or the device flow (RFC 8628) when the server offers it and
 * --device is given, always naming the resource (RFC 8707). Git gets the access token through its
 * credential protocol (`git credential`), so no token is ever in a URL, a remote or Git config.
 * Tokens live in ~/.homie/secrets/git-oauth/ (mode 0600) and refresh themselves.
 */
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,readdirSync,chmodSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,basename,resolve} from 'node:path';

export const TOKENS_DIR=(home=homedir())=>join(home,'.homie','secrets','git-oauth');
const b64=bytes=>Buffer.from(bytes).toString('base64url');
const sha=text=>createHash('sha256').update(text).digest('hex');
const now=()=>Date.now();

/** The hosting block of a studio, or null when it deploys to its own Cloudflare. */
export function hostingOf(studio){
 const h=studio?.hosting;
 if(!h||typeof h.git!=='string')return null;
 const git=new URL(h.git);
 if(git.protocol!=='https:'&&!(git.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(git.hostname)))throw Error('hosting.git must be an https Git remote');
 return {git:git.href,mcp:typeof h.mcp==='string'?new URL(h.mcp).href:null,name:typeof h.name==='string'?h.name:git.hostname};
}
/** The words every hosted refusal and plan uses. */
export const hostedWords=hosting=>`This studio is hosted by ${hosting.name}: a push to main builds its private preview there, and the host puts a version live when the owner says so. It is never deployed to a Cloudflare account from this computer.`;

/* ------------------------------------------------------------------ discovery */
/** RFC 9728 §5.1: the resource_metadata parameter of a Bearer challenge. */
export function challengeMetadata(header){
 const m=String(header??'').match(/resource_metadata="([^"]+)"/i);
 return m?m[1]:null;
}
async function json(url,init={},fetcher=fetch){
 const r=await fetcher(url,{...init,headers:{accept:'application/json',...(init.headers??{})}});
 const text=await r.text();let body=null;try{body=JSON.parse(text);}catch{}
 if(!r.ok)throw Error(`${new URL(url).host} answered ${r.status}${body?.error?`: ${body.error}${body.error_description?` (${body.error_description})`:''}`:''}`);
 return body;
}
/** RFC 8414 §3: /.well-known/oauth-authorization-server inserted before the issuer's path. */
export function metadataURLs(issuer){
 const u=new URL(issuer),path=u.pathname.replace(/\/$/,'');
 return [`${u.origin}/.well-known/oauth-authorization-server${path}`,`${u.origin}/.well-known/openid-configuration${path}`,...(path?[`${u.origin}${path}/.well-known/openid-configuration`]:[])];
}
export async function discover(gitURL,{fetcher=fetch}={}){
 const probe=await fetcher(gitURL.replace(/\/$/,'')+'/info/refs?service=git-upload-pack',{redirect:'manual'});
 await probe.body?.cancel?.();
 if(probe.status!==401)throw Error(`${new URL(gitURL).host} did not ask for sign-in (HTTP ${probe.status}); it is not an OAuth-protected Git host`);
 const prmURL=challengeMetadata(probe.headers.get('www-authenticate'));
 if(!prmURL)throw Error(`${new URL(gitURL).host} asked for sign-in without OAuth protected-resource metadata (RFC 9728)`);
 const prm=await json(prmURL,{},fetcher);
 const issuer=prm.authorization_servers?.[0];
 if(!prm.resource||!issuer)throw Error('The protected-resource metadata names no resource or authorization server');
 let as=null,lastError;
 for(const url of metadataURLs(issuer)){try{as=await json(url,{},fetcher);break;}catch(error){lastError=error;}}
 if(!as)throw lastError??Error('No authorization server metadata');
 if(as.issuer&&as.issuer.replace(/\/$/,'')!==issuer.replace(/\/$/,''))throw Error('Authorization server metadata names a different issuer');
 if(!(as.code_challenge_methods_supported??['S256']).includes('S256'))throw Error('The authorization server does not offer PKCE S256');
 return {resource:prm.resource,scopes:prm.scopes_supported??as.scopes_supported??[],issuer,as};
}

/* ------------------------------------------------------------------ storage */
const fileFor=(dir,key)=>join(dir,sha(key).slice(0,32)+'.json');
/** The stored sign-in for a Git URL: matched by origin and path, longest prefix first. */
export function savedFor(url,{dir=TOKENS_DIR()}={}){
 if(!existsSync(dir))return null;
 const u=new URL(url),target=u.origin+u.pathname;
 const entries=readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(readFileSync(join(dir,f),'utf8'));}catch{return null;}}).filter(e=>e?.prefix&&target.startsWith(e.prefix));
 return entries.sort((a,b)=>b.prefix.length-a.prefix.length)[0]??null;
}
export function save(entry,{dir=TOKENS_DIR()}={}){
 mkdirSync(dir,{recursive:true,mode:0o700});chmodSync(dir,0o700);
 const file=fileFor(dir,entry.prefix);
 writeFileSync(file,JSON.stringify(entry,null,1),{mode:0o600});chmodSync(file,0o600);
 return file;
}
export function forget(prefix,{dir=TOKENS_DIR()}={}){rmSync(fileFor(dir,prefix),{force:true});}
/** The repository path prefix a sign-in covers: everything up to and including '<name>.git'. */
export const prefixOf=gitURL=>{const u=new URL(gitURL);return u.origin+u.pathname.replace(/\/$/,'');};

/* ------------------------------------------------------------------ sign-in */
async function register(as,redirect,{fetcher=fetch,name='Homie studio toolkit'}){
 if(!as.registration_endpoint)throw Error('The authorization server has no dynamic client registration (RFC 7591)');
 return json(as.registration_endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:name,redirect_uris:redirect?[redirect]:[],grant_types:redirect?['authorization_code','refresh_token']:['urn:ietf:params:oauth:grant-type:device_code','refresh_token'],response_types:redirect?['code']:[],token_endpoint_auth_method:'none'})},fetcher);
}
function token(as,params,fetcher){return json(as.token_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)},fetcher);}
const entryFrom=(base,tokens)=>({...base,access_token:tokens.access_token,refresh_token:tokens.refresh_token??base.refresh_token??null,expires_at:now()+(Number(tokens.expires_in)||900)*1000,scope:tokens.scope??base.scope??null});
export function openBrowser(url){
 const [cmd,args]=process.platform==='darwin'?['open',[url]]:process.platform==='win32'?['cmd',['/c','start','',url]]:['xdg-open',[url]];
 try{const child=spawn(cmd,args,{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref();return true;}catch{return false;}
}
/**
 * One browser approval: a loopback listener, a registered public client, PKCE, the resource.
 * `approve(url)` opens the page (a browser by default; tests drive it themselves).
 */
export async function signIn(gitURL,{fetcher=fetch,approve=openBrowser,log=()=>{},device=false,dir=TOKENS_DIR(),timeoutMs=10*60000}={}){
 const found=await discover(gitURL,{fetcher});
 const {as,resource,scopes}=found,scope=scopes.join(' ');
 const base={prefix:prefixOf(gitURL),resource,issuer:found.issuer,token_endpoint:as.token_endpoint,scope};
 if(device&&as.device_authorization_endpoint){
  const client=await register(as,null,{fetcher});
  const start=await json(as.device_authorization_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,scope,resource})},fetcher);
  log(`Approve at ${start.verification_uri_complete??start.verification_uri}${start.user_code?` with the code ${start.user_code}`:''}`);
  if(start.verification_uri_complete)approve(start.verification_uri_complete);
  const until=now()+Math.min(timeoutMs,(start.expires_in??600)*1000);let interval=(start.interval??5)*1000;
  while(now()<until){
   await new Promise(r=>setTimeout(r,interval));
   try{const tokens=await token(as,{grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:start.device_code,client_id:client.client_id,resource},fetcher);const entry=entryFrom({...base,client_id:client.client_id},tokens);save(entry,{dir});return entry;}
   catch(error){if(/slow_down/.test(error.message))interval+=5000;else if(!/authorization_pending/.test(error.message))throw error;}
  }
  throw Error('The approval was not finished in time');
 }
 const state=b64(randomBytes(16)),verifier=b64(randomBytes(32)),challenge=createHash('sha256').update(verifier).digest('base64url');
 let resolveCode,rejectCode;const code=new Promise((r,j)=>{resolveCode=r;rejectCode=j;});
 const server=createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(u.pathname!=='/callback'){res.writeHead(404);res.end();return;}
  const ok=u.searchParams.get('state')===state&&u.searchParams.get('code');
  res.writeHead(ok?200:400,{'content-type':'text/html;charset=utf-8'});
  res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Homie</title><p style="font:18px system-ui;margin:20vh auto;max-width:520px">${ok?'Signed in. You can close this tab and go back to your AI.':'The sign-in did not finish. Go back to your AI and try again.'}</p>`);
  if(ok)resolveCode(u.searchParams.get('code'));else rejectCode(Error(u.searchParams.get('error_description')??u.searchParams.get('error')??'The sign-in was refused'));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const redirect=`http://127.0.0.1:${server.address().port}/callback`;
 const timer=setTimeout(()=>rejectCode(Error('The approval was not finished in time')),timeoutMs);
 try{
  const client=await register(as,redirect,{fetcher});
  const url=new URL(as.authorization_endpoint);
  for(const [k,v] of Object.entries({response_type:'code',client_id:client.client_id,redirect_uri:redirect,state,code_challenge:challenge,code_challenge_method:'S256',resource,...(scope?{scope}:{})}))url.searchParams.set(k,v);
  log(`Approve this computer in the browser: ${url.href}`);
  approve(url.href);
  const tokens=await token(as,{grant_type:'authorization_code',code:await code,redirect_uri:redirect,client_id:client.client_id,code_verifier:verifier,resource},fetcher);
  const entry=entryFrom({...base,client_id:client.client_id},tokens);save(entry,{dir});return entry;
 }finally{clearTimeout(timer);server.close();}
}
/** A current access token for the URL, refreshed when it is about to expire. */
export async function accessFor(url,{fetcher=fetch,dir=TOKENS_DIR(),force=false}={}){
 const entry=savedFor(url,{dir});if(!entry)return null;
 if(!force&&entry.access_token&&entry.expires_at>now()+60000)return entry;
 if(!entry.refresh_token)return null;
 try{const tokens=await token({token_endpoint:entry.token_endpoint},{grant_type:'refresh_token',refresh_token:entry.refresh_token,client_id:entry.client_id,resource:entry.resource},fetcher);const next=entryFrom(entry,tokens);save(next,{dir});return next;}
 catch{return null;}
}

/* ------------------------------------------------------------------ git credential protocol */
export function parseCredential(text){return Object.fromEntries(String(text).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));}
/** `git credential` helper: get answers with the stored token; erase forgets the access token. */
export async function credential(action,input,{fetcher=fetch,dir=TOKENS_DIR()}={}){
 const c=parseCredential(input);
 if(!c.protocol||!c.host)return '';
 const url=`${c.protocol}://${c.host}/${c.path??''}`;
 if(action==='get'){
  const entry=await accessFor(url,{fetcher,dir});
  if(!entry)return '';
  return `username=oauth\npassword=${entry.access_token}\npassword_expiry_utc=${Math.floor(entry.expires_at/1000)}\n`;
 }
 if(action==='erase'){
  const entry=savedFor(url,{dir});
  if(entry&&(!c.password||c.password===entry.access_token))save({...entry,access_token:null,expires_at:0},{dir});
 }
 return '';
}
/** How Git runs this helper: this exact toolkit version, so it can be updated and never drifts. */
export function helperCommand(version){return `!npx --yes --package=@homie-rocks/studio@${version} homie-studio git-credential`;}

/* ------------------------------------------------------------------ connect, push, publish */
// Asynchronous on purpose: Git may call back into this process's own helpers and servers.
const git=(args,{cwd,env={}}={})=>new Promise((resolve,reject)=>{
 const p=spawn('git',args,{cwd,env:{...process.env,GIT_TERMINAL_PROMPT:'0',...env}});let out='',err='';
 p.stdout.on('data',d=>{out+=d;});p.stderr.on('data',d=>{err+=d;});p.on('error',reject);
 p.on('close',code=>code===0?resolve(out.trim()):reject(Error(`git ${args.find(a=>!a.startsWith('-')&&!a.includes('='))??''} failed: ${(err||out).trim().split('\n').slice(-2).join(' ')}`)));
});
/**
 * `homie-studio hosted connect <git url> [folder]`: sign in once, clone, point Git's credential
 * helper at this toolkit for that remote only, and mark the studio as hosted.
 */
export async function connectHosted(gitURL,folder,{version,helper=helperCommand(version),install=true,log=()=>{},fetcher=fetch,approve=openBrowser,device=false,dir=TOKENS_DIR()}={}){
 const remote=new URL(gitURL).href.replace(/\/$/,'');
 const entry=(await accessFor(remote,{fetcher,dir}))??await signIn(remote,{fetcher,approve,log,device,dir});
 const target=resolve(folder??basename(new URL(remote).pathname).replace(/\.git$/,''));
 if(existsSync(target)&&readdirSync(target).length)throw Error(`${target} is not empty`);
 const key=`credential.${prefixOf(remote)}`;
 await git(['-c',`${key}.helper=`,'-c',`${key}.helper=${helper}`,'-c',`${key}.useHttpPath=true`,'clone','-q',remote,target]);
 await git(['config','--replace-all',`${key}.helper`,''],{cwd:target});await git(['config','--add',`${key}.helper`,helper],{cwd:target});await git(['config',`${key}.useHttpPath`,'true'],{cwd:target});
 const file=join(target,'studio.json');let marked=false;
 if(existsSync(file)){
  const studio=JSON.parse(readFileSync(file,'utf8'));
  if(!studio.hosting?.git){studio.hosting={git:remote,mcp:entry.resource,name:new URL(remote).hostname};writeFileSync(file,`${JSON.stringify(studio,null,2)}\n`);marked=true;}
 }
 if(install&&existsSync(join(target,'package-lock.json'))){const r=spawnSync('npm',['ci','--no-audit','--no-fund'],{cwd:target,stdio:'ignore'});if(r.status!==0)log('npm ci did not finish; run it in the studio before building');}
 return {ok:true,command:'hosted connect',folder:target,remote,resource:entry.resource,marked,next:[`cd ${target}`,'Make changes with the toolkit as usual, commit, then git push origin HEAD:main (or homie-studio deploy): the host builds a private preview.',marked?'studio.json now says the studio is hosted; commit it with your first change.':null].filter(Boolean)};
}
/** A minimal MCP client (Streamable HTTP, JSON answers) for the host's own tools, same sign-in. */
export async function hostTool(hosting,name,args,{fetcher=fetch,dir=TOKENS_DIR()}={}){
 if(!hosting.mcp)return null;
 const entry=await accessFor(hosting.git,{fetcher,dir});
 if(!entry)throw Error(`Not signed in to ${hosting.name}: run homie-studio hosted connect ${hosting.git}`);
 const headers={authorization:'Bearer '+entry.access_token,'content-type':'application/json',accept:'application/json, text/event-stream'};
 const send=async(body,extra={})=>{const r=await fetcher(hosting.mcp,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});const text=await r.text();const raw=text.startsWith('event:')||text.startsWith('data:')?text.split('\n').find(l=>l.startsWith('data: '))?.slice(6):text;return {r,body:raw?JSON.parse(raw):null};};
 const init=await send({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'homie-studio',version:'1'}}});
 const session=init.r.headers.get('mcp-session-id');const extra={...(session?{'mcp-session-id':session}:{}),'mcp-protocol-version':init.body?.result?.protocolVersion??'2025-11-25'};
 await send({jsonrpc:'2.0',method:'notifications/initialized'},extra);
 const call=await send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name,arguments:args}},extra);
 if(call.body?.error)throw Error(call.body.error.message);
 return call.body?.result??null;
}
const resultText=result=>(result?.content??[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
/** `deploy` for a hosted studio: push main; the host builds the preview. */
export async function pushHosted(root,hosting,{log=()=>{},fetcher=fetch,dir=TOKENS_DIR()}={}){
 if(await git(['status','--porcelain'],{cwd:root}))log('Uncommitted changes are not pushed: commit them first.');
 const commit=await git(['rev-parse','HEAD'],{cwd:root});
 await git(['push','-q',hosting.git,'HEAD:refs/heads/main'],{cwd:root});
 let progress=null;try{progress=resultText(await hostTool(hosting,'build_progress',{commit},{fetcher,dir}));}catch{}
 return {ok:true,command:'deploy',hosted:true,host:hosting.name,commit,progress,url:null,next:`${hostedWords(hosting)} ${hosting.mcp?'build_progress on the host shows when the preview is ready.':''}`.trim()};
}
/** The host's publish, for this commit, with the live commit the AI reviewed. */
export async function publishHosted(root,hosting,{expected=null,fetcher=fetch,dir=TOKENS_DIR()}={}){
 if(!hosting.mcp)return {ok:false,command:'publish',why:`${hostedWords(hosting)} It names no MCP server, so publish on the host itself.`};
 const commit=await git(['rev-parse','HEAD'],{cwd:root});
 const result=await hostTool(hosting,'studio_publish',{commit,expected},{fetcher,dir});
 return {ok:!result?.isError,command:'publish',hosted:true,commit,answer:resultText(result),why:result?.isError?resultText(result):undefined};
}
