/** Isolated local studio. The trial driver is copied byte-for-byte; no production bindings. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync,mkdtempSync,symlinkSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from '../lib/build.mjs';
import {build as bundle} from 'esbuild';
import {Miniflare} from 'miniflare';
import WebSocket from 'ws';
import {once} from 'node:events';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const root=process.env.CROWD_ROOT ?? mkdtempSync(join(tmpdir(),'homie-cloud-crowd-'));
if (!process.env.CROWD_ROOT) {
cpSync(join(repo,'template'),root,{recursive:true});
cpSync(fileURLToPath(new URL('./fixtures/crowd-circuit/game',import.meta.url)),join(root,'games/crowd-circuit'),{recursive:true});
cpSync(fileURLToPath(new URL('./fixtures/crowd-circuit/scripts',import.meta.url)),join(root,'scripts'),{recursive:true});
symlinkSync(join(repo,'node_modules'),join(root,'node_modules'));
await build(root,{log:line=>console.error(line)});
}
const delay=Number(process.env.CROWD_LINK_MS??5), cost=Number(process.env.CROWD_FRAME_MS??1);
// Each link has an ordered delivery lane. Delay is propagation;
// cost is service time per message, not per player or tick. Only test code injects it.
const injection=`
const delayed=new WeakMap();
function wire(socket){
 if(delayed.has(socket))return delayed.get(socket);
 let due=0;const handlers=[];
 socket.addEventListener('message',event=>{const now=Date.now();due=Math.max(now+${delay},due+${cost});setTimeout(()=>{for(const fn of handlers)fn(event);},Math.max(0,due-now));});
 const wrapped={accept:()=>socket.accept(),close:(...a)=>socket.close(...a),send:data=>socket.send(data),addEventListener(type,fn){if(type==='message')handlers.push(fn);else socket.addEventListener(type,fn);}};
 delayed.set(socket,wrapped);return wrapped;
}
`;
const result=await bundle({stdin:{resolveDir:root,contents:`
import worker,{Table,Lobby,Gate,Concentrator,hostRules} from '${repo}packages/studio/worker/index.mjs';
import rules from '${root}/site/src/rules/index.mjs';
hostRules(rules);export {Table,Lobby,Gate,Concentrator};export default {fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/test-facts'){return env.TABLE.get(env.TABLE.idFromName('crowd-circuit/'+url.searchParams.get('room'))).fetch('https://table/__facts?game=crowd-circuit&room='+url.searchParams.get('room')+'&max=1000');}return worker.fetch(request,env,ctx);}};`},plugins:[{name:'inter-object-cost',setup(b){b.onLoad({filter:/(worker\/(gate|room|index)\.mjs|rules\/(host\.ts|interest\.mjs))$/},async args=>{let source=process.env.CROWD_BASELINE ? execFileSync('git',['show','b04e6a714c71dfaa046e0ce9be3f97871e4bf62b:'+args.path.slice(repo.length)],{cwd:repo,encoding:'utf8'}) : readFileSync(args.path,'utf8');if(!args.path.endsWith('/gate.mjs'))return {contents:source,loader:args.path.endsWith('.ts')?'ts':'js',resolveDir:resolve(args.path,'..')};source=source.replace('const socket = response.webSocket;', 'const socket = wire(response.webSocket);').replace('server.accept(); multiplexSession(server, connect, options);','server.accept(); multiplexSession(wire(server), connect, options);');source=source.replace('server.accept(); multiplexSession(server, connect);','server.accept(); multiplexSession(wire(server), connect);');return {contents:injection+source,loader:'js',resolveDir:resolve(args.path,'..')};});}}],bundle:true,write:false,format:'esm',platform:'browser',mainFields:['module','main'],conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
const classes=['Table','Lobby','Gate','Concentrator'];
const basePort=Number(process.env.CROWD_PORT??8810);
const gateProcesses=Number(process.env.CROWD_GATE_PROCESSES??4);
const routing=`const remote=(port)=>({idFromName:n=>n,get:n=>({fetch(r){const u=new URL(typeof r==='string'?r:r.url);u.protocol='http:';u.host='127.0.0.1:'+port;return fetch(new Request(u,r instanceof Request?r:undefined));}})});const routed=(count,start)=>({idFromName:n=>n,get:n=>remote(start+Number(n.split('/').at(-1))%count).get(n)});const wired=env=>({...env,TABLE:remote(${basePort+1}),GATE:routed(${gateProcesses},${basePort+2}),CONCENTRATOR:routed(2,${basePort+2+gateProcesses})});`;
const source=result.outputFiles[0].text;
const names=['front','table',...Array.from({length:gateProcesses},(_,i)=>'gate'+i),'concentrator0','concentrator1'];
const instances=[];
const profiles=[];
async function profileWorker(mf,name) {
  const listing=await mf.getInspectorURL();listing.protocol='http:';listing.pathname='/json';
  const targets=await (await fetch(listing)).json();
  const target=targets.find(t=>t.id==='core:user:'+name);
  if(!target)throw Error('Missing workerd inspector target: '+name);
  const socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
  let sequence=0;const pending=new Map();
  socket.on('message',data=>{const m=JSON.parse(String(data)),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  const call=method=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Inspector timeout: '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method}));});
  await call('Profiler.enable');await call('Profiler.start');
  profiles.push(async()=>{try{const {profile}=await call('Profiler.stop');writeFileSync(join(process.env.CROWD_PROFILE_DIR,name+'.cpuprofile'),JSON.stringify(profile));}finally{socket.close();}});
}
for(const [index,name] of names.entries()) {
  const kind=index===1?'Table':index>=2+gateProcesses?'Concentrator':'Gate';
  const entry=index===0?`return worker.fetch(r,wired(e),c);`:`const u=new URL(r.url);const key=u.searchParams.get('game')+'/'+u.searchParams.get('room')+${kind==='Table'?"''":kind==='Gate'?"'/' + u.searchParams.get('gate')":"'/' + Math.floor(Number(u.searchParams.get('gate'))/8)"};return e.LOCAL.get(e.LOCAL.idFromName(key)).fetch(r);`;
  const wrapper=`import {default as worker,Table as T,Gate as G,Concentrator as C,Lobby} from './base.mjs';${routing}export {Lobby};export class Table extends T{constructor(ctx,env){super(ctx,wired(env));}}export class Gate extends G{constructor(ctx,env){super(ctx,wired(env));}}export class Concentrator extends C{constructor(ctx,env){super(ctx,wired(env));}}export default {fetch(r,e,c){${entry}}};`;
  const mf=new Miniflare({...(process.env.CROWD_PROFILE_DIR ? {inspectorPort:0} : {}),port:basePort+index,telemetry:{enabled:false},workers:[{config:{name,compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:wrapper},'base.mjs':{type:'esm',contents:source}}},exports:Object.fromEntries([...classes].map(n=>[n,{type:'durable-object',storage:'sqlite'}])),env:{LOCAL:{type:'durable-object',worker:name,exportName:kind},LOBBY:{type:'durable-object',worker:name,exportName:'Lobby'},ASSETS:{type:'assets'},HOMIE_PREVIEW:{type:'text',value:'1'}},assets:{directory:join(root,'site/dist'),hasUserWorker:true,runWorkerFirst:true}}}]});
  instances.push(mf);await mf.ready;
  if(process.env.CROWD_PROFILE_DIR)await profileWorker(mf,name);
}
if(process.env.CROWD_PROFILE_DIR)writeFileSync(join(process.env.CROWD_PROFILE_DIR,'profiled-worker.mjs'),source);
const mf={ready:instances[0].ready,dispose:async()=>{await Promise.allSettled(profiles.map(stop=>stop()));await Promise.all(instances.map(m=>m.dispose()));}};
const digest = value => createHash('sha256').update(value).digest('hex');
console.log(JSON.stringify({root,url:String(await mf.ready),delay,cost,gateProcesses,processes:instances.length,baseline:Boolean(process.env.CROWD_BASELINE),head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),workerSha256:digest(source),driverSha256:digest(readFileSync(join(root,'scripts/crowd-load.mjs'))),workingTreeDiffSha256:digest(execFileSync('git',['diff','HEAD','--','packages/studio/worker','packages/studio/rules'],{cwd:repo})),node:process.version,driver:join(root,'scripts/crowd-load.mjs')}));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await mf.dispose();process.exit(0);});
// Stop the profiler before Miniflare's process signal handlers dispose workerd.
process.on('message',async message=>{if(message?.stop){await mf.dispose();process.exit(0);}});
