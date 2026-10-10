import {existsSync,mkdirSync,writeFileSync,readFileSync,chmodSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
export function newTool(root,name,{app=null}={}) {
  if(!/^[a-z][a-z0-9-]{0,39}$/.test(name??'') || app!==null&&!/^[a-z][a-z0-9-]{0,39}$/.test(app))throw new Error('name uses lowercase letters, numbers and hyphens');
  if(app&&!existsSync(join(root,'apps',app,'app.json')))throw new Error('unknown app');
  const file=join(root,...(app?['apps',app,'tools']:['tools']),name+'.ts');if(existsSync(file))throw new Error('tool already exists');
  mkdirSync(dirname(file),{recursive:true});writeFileSync(file,`import { defineTool } from '@homie-rocks/studio/tools';\n\nexport default defineTool<{ message: string }>({\n  name: '${name.replaceAll('-','_')}',\n  description: 'Describe what this tool does and when to use it.',\n  audience: ${app?JSON.stringify({app,role:'staff'}):"'owner'"},\n  inputSchema: { type: 'object', properties: { message: { type: 'string', maxLength: 200 } }, required: ['message'], additionalProperties: false },\n  async handler({ message }, context) {\n    return { message, by: context.caller.id };\n  },\n});\n`);
  return {ok:true,command:'tool new',file,next:'Edit the definition, then homie-studio dev. Call it with homie-studio tool call '+name.replaceAll('-','_')+' --input \'{"message":"Hello"}\' --url http://localhost:8787'};
}
/** The official SDK owns discovery, registration, PKCE, refresh and issuer checks. */
export async function connectToolClient(root,site,{publicOnly=false,open=defaultOpen,log=()=>{}}={}) {
  const {Client,StreamableHTTPClientTransport,auth}=await import('mcp-studio-client');
  const url=new URL('/mcp',site);if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Use HTTPS, or localhost for local development');
  const client=new Client({name:'Homie studio tool CLI',version:'1.0.0'});
  if(publicOnly){await client.connect(new StreamableHTTPClientTransport(url));return client;}
  const file=join(root,'.studio','mcp',Buffer.from(url.origin).toString('base64url')+'.json');
  let state={};try{state=JSON.parse(readFileSync(file,'utf8'));}catch{}
  // Credentials without an issuer predate the SDK's OAuth binding fix; reconnect safely.
  if((state.tokens&&!state.tokens.issuer)||(state.client&&!state.client.issuer))state={};
  const save=()=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(state),{mode:0o600});chmodSync(file,0o600);};
  let accept;const returned=new Promise(resolve=>{accept=resolve;});
  const csrf=randomUUID();
  const server=createServer((req,res)=>{const back=new URL(req.url,'http://localhost');if(back.pathname!=='/callback'||back.searchParams.get('state')!==csrf){res.writeHead(400);res.end('Invalid callback');return;}res.end('Your AI is connected. You can close this tab.');accept(back);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const redirect=`http://127.0.0.1:${server.address().port}/callback`;
  const provider={redirectUrl:redirect,clientMetadata:{client_name:'Homie studio tool CLI',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'},state:()=>csrf,
    clientInformation:()=>state.client,saveClientInformation:v=>{state.client=v;save();},tokens:()=>state.tokens,saveTokens:v=>{state.tokens=v;save();},
    codeVerifier:()=>state.verifier,saveCodeVerifier:v=>{state.verifier=v;save();},
    discoveryState:()=>state.discovery,saveDiscoveryState:v=>{state.discovery=v;save();},
    invalidateCredentials:scope=>{if(scope==='all')state={};else {delete state[scope==='tokens'?'tokens':scope];if(scope==='tokens')delete state.client;}save();},
    redirectToAuthorization:async u=>{log('Approve this connection in your browser.');await open(u.href);},
  };
  try{
    // A new loopback port needs a matching registered redirect; refresh still uses the prior client.
    if(!state.tokens){delete state.client;delete state.discovery;}
    const result=await auth(provider,{serverUrl:url,scope:'studio offline_access'});
    if(result==='REDIRECT'){
      let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Browser approval timed out')),300000);});
      const back=await Promise.race([returned,timeout]).finally(()=>clearTimeout(timer));
      if(back.searchParams.has('error'))throw new Error('Connection declined');
      await auth(provider,{serverUrl:url,authorizationCode:back.searchParams.get('code'),iss:back.searchParams.get('iss')??undefined});
    }
    await client.connect(new StreamableHTTPClientTransport(url,{authProvider:provider}));return client;
  }finally{server.close();}
}
function defaultOpen(url){const cmd=process.platform==='darwin'?'open':process.platform==='win32'?'explorer':'xdg-open';const child=spawn(cmd,[url],{stdio:'ignore',detached:true});child.unref();}
export async function toolCommand(root,sub,positional,flags,{log=()=>{}}={}) {
  if(sub==='new')return newTool(root,positional[2],{app:flags.get('app')??null});
  if(!['call','list'].includes(sub))throw new Error('Use tool new <name>, tool list, or tool call <name> --input <JSON>');
  const client=await connectToolClient(root,flags.get('url')??'http://localhost:8787',{publicOnly:flags.has('public'),log});
  try{const result=sub==='list'?await client.listTools():await client.callTool({name:positional[2],arguments:JSON.parse(flags.get('input')??'{}')});return {ok:result.isError!==true,command:'tool '+sub,result,...(result.isError?{why:'The tool refused or failed; see its result.'}:{})};}finally{await client.close();}
}
