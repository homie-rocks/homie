#!/usr/bin/env node
// Homie 0.45.0 protocol: public __game bootstrap → __net → hello → snap / in.
// Single load process, bounded histograms/pending inputs; only two actual Chrome instances.
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import WebSocket from 'ws';
import puppeteer from 'puppeteer-core';
import { snapshotDecoder } from '../node_modules/@homie-rocks/studio/rules/interest.mjs';

const args = process.argv.slice(2), opts = {};
for (let i=0;i<args.length;i++) { if(!args[i].startsWith('--') || !args[i+1] || args[i+1].startsWith('--')) throw Error('Use --key value'); opts[args[i].slice(2)] = args[++i]; }
const allowed = ['url','n','seconds','room','out','ramp-ms','chrome','rss-mb','churn','churn-at','stall-ms'];
for(const k of Object.keys(opts)) if(!allowed.includes(k)) throw Error(`Unknown option --${k}`);
const origin = new URL(opts.url ?? 'http://127.0.0.1:8787').origin;
const n = Number(opts.n ?? 50), seconds = Number(opts.seconds ?? 180), rampMs=Number(opts['ramp-ms']??50), rssLimit=Number(opts['rss-mb']??512);
if(!Number.isInteger(n)||n<1||n>1000||!Number.isFinite(seconds)||seconds<1||seconds>3600||!Number.isFinite(rampMs)||rampMs<10||!Number.isFinite(rssLimit)||rssLimit<128) throw Error('n 1..1000, seconds 1..3600, ramp-ms >=10, rss-mb >=128');
const game='crowd-circuit', room=opts.room??`load-${n}-${Date.now().toString(36)}`;
if(!/^[A-Za-z0-9_-]{1,32}$/.test(room)) throw Error('Invalid room');
const out=resolve(opts.out??`reports/crowd-circuit/${room}`);
await mkdir(out,{recursive:true});
await writeFile(`${out}/driver-source.mjs`,await readFile(new URL(import.meta.url),'utf8'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Histogram {
  bins=new Uint32Array(60001); count=0; max=0;
  add(ms) {if(!Number.isFinite(ms)||ms<0)return;this.bins[Math.min(60000,Math.round(ms))]++;this.count++;this.max=Math.max(this.max,ms);}
  json(){ const p=q=>{let k=0;for(let i=0;i<this.bins.length;i++){k+=this.bins[i];if(k>=Math.ceil(this.count*q))return this.count?i:null;}return null;};return {count:this.count,p50:p(.5),p95:p(.95),p99:p(.99),max:this.max}; }
}
const firstState=new Histogram(), welcomeTime=new Histogram(), echo=new Histogram(), samples=[], errors=new Map(), clients=[], browsers=[], profiles=[], windows=[];
const loop=monitorEventLoopDelay({resolution:20});loop.enable();
let stopping=false, cleaningUp=false, stopReason=null, timer, measureStart=0, measureEnd=0, maxRss=0, peakLoopMs=0, expectedTimer=performance.now(), badLag=0;
let totalUp=0,totalDown=0,peakConnected=0;
let up=0,down=0,upFrames=0,downFrames=0,disconnects=0,ackSkipped=0,ackExpired=0;
const started=new Date().toISOString();
let roomEpoch=null, churn=null, rampLogAt=0;
const churnCount=Number(opts.churn??0);
if(!Number.isInteger(churnCount)||churnCount<0||churnCount>n)throw Error('churn must be 0..n');
function problem(type,text){ const key=type==='stale snapshot'?'stale snapshot: own state absent for more than 5 seconds':`${type}: ${String(text).slice(0,700)}`; if(errors.has(key)) errors.set(key,errors.get(key)+1);else if(errors.size<100||['close','upgrade','socket','fatal','room-over','host-fault','host-failed'].includes(type)){errors.set(key,1);console.error(JSON.stringify({phase:'error',at:new Date().toISOString(),text:key}));} }
function stop(reason){stopReason??=reason;stopping=true;}
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));
function send(c,m){ if(c.ws?.readyState!==WebSocket.OPEN)return;const text=JSON.stringify(m); if(c.ws.bufferedAmount>262144){problem('backpressure',c.i);stop('driver send backlog');return;} c.ws.send(text);totalUp+=Buffer.byteLength(text);if(measureStart&&!measureEnd){up+=Buffer.byteLength(text);upFrames++;c.up+=Buffer.byteLength(text);} }
function snapshot(c,raw){
  c.rawSnapshots=(c.rawSnapshots??0)+1;c.rawTick=raw.k;
  const snap=c.decoder.decode(raw); if(!snap){c.decodeMiss=(c.decodeMiss??0)+1;return;}
  const own=snap.d[1].find(e=>e[9]===c.seat && e[10]!==1); if(!own){c.ownMissing=(c.ownMissing??0)+1;c.missingSummary={tick:snap.k,seat:c.seat,entities:snap.d[1].length,seats:snap.d[1].slice(0,12).map(e=>[e[0],e[9],e[10]])};return;}
  const now=performance.now();
  roomEpoch??=snap.e;
  if(snap.e!==roomEpoch){problem('epoch','room epoch changed during step');stop('room restarted');}
  if(c.first===null){ c.first=now;firstState.add(now-c.began); }
  if(c.epoch!==snap.e){c.pending.clear();c.lastSent=0;c.epoch=snap.e;c.firstTick=null;}
  c.maxStateGapMs=Math.max(c.maxStateGapMs??0,c.at?now-c.at:0);c.observedFirstTick??=snap.k;c.observedFirstAt??=now;c.observedLastTick=snap.k;c.observedLastAt=now;
  c.k=snap.k;c.at=now;c.own=own;c.r=own[2];c.snapshots++;
  if(measureStart&&!measureEnd){if(c.firstTick===null){c.firstTick=snap.k;c.firstAt=now;}c.lastTick=snap.k;c.lastAt=now;}
  const control=snap.c?.find(row=>row[0]===c.seat);
  if(control){const ack=control[2];for(const [tick,at] of c.pending){if(tick<=ack){if(measureStart&&!measureEnd){if(tick===ack)echo.add(now-at);else ackSkipped++;}c.pending.delete(tick);}}}
}
async function connect(i, reusedKey, reusedToken){
  const key=reusedKey??randomBytes(18).toString('base64url');
  const c={i,key,seat:null,first:null,began:performance.now(),decoder:snapshotDecoder(),pending:new Map(),epoch:null,k:0,r:0,at:0,lastSent:0,firstTick:null,lastTick:null,firstAt:0,lastAt:0,up:0,down:0,snapshots:0,own:null,nextPing:0,welcomed:false};clients.push(c);
  // Read the same injected config a browser gets; preserves deployed version/query routing.
  const response=await fetch(`${origin}/${game}/__game/?room=${room}&device=desk&want=play&b=${key}`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`bootstrap HTTP ${response.status}: ${(await response.text()).slice(0,160)}`);
  const html=await response.text(), match=html.match(/window\.HOMIE_NET=(\{[^<]+\})<\/script>/);
  if(!match)throw Error('No HOMIE_NET bootstrap');const cfg=JSON.parse(match[1]);
  c.ws=new WebSocket(cfg.url,{origin:'null',handshakeTimeout:15000,perMessageDeflate:false});
  c.ws.on('open',()=>{c.helloAt=performance.now();send(c,{t:'hello',rules:true,v:1,rev:12,token:reusedToken??null,name:`Load ${i}`,device:'desk',want:'play',canHost:false,game,max:1000,...(cfg.ver?{ver:cfg.ver}:{})});});
  c.ws.on('message',data=>{
    totalDown+=data.length;c.lastMessage=performance.now();
    if(measureStart&&!measureEnd){down+=data.length;downFrames++;c.down+=data.length;}
    let m;try{m=JSON.parse(data.toString());}catch(e){problem('decode',e.message);return;}
    c.messageTypes??={};const mt=c.messageTypes[m.t]??={count:0,bytes:0};mt.count++;mt.bytes+=data.length;
    if(m.t==='snap'){c.snapshotShape={tick:m.k,totalBytes:data.length,roundBytes:Buffer.byteLength(JSON.stringify(Array.isArray(m.d)?m.d[0]:m.d?.round)??''),entitiesBytes:Buffer.byteLength(JSON.stringify(Array.isArray(m.d)?m.d[1]:m.d?.changed)??''),controlBytes:Buffer.byteLength(JSON.stringify(m.c)??'')};}
    if(m.t==='welcome'){ c.token=m.token;c.seat=m.seat;c.welcomed=true;c.hosted=m.hosted;welcomeTime.add(performance.now()-c.began);if(c.seat===null)problem('unseated',`client ${i}: full=${m.full}`);if(m.snap)snapshot(c,m.snap); }
    else if(m.t==='snap')snapshot(c,m);
    else if(m.t==='err'||m.t==='error'){problem(m.code??m.t,m.message??JSON.stringify(m));if(['room-over','host-fault','host-failed','closed'].includes(m.code))stop(`server ${m.code}`);}
    else if(m.t==='seat')c.seat=m.seat;
  });
  c.ws.on('error',e=>problem('socket',e.message));
  c.ws.on('unexpected-response',(_req,res)=>{problem('upgrade',`HTTP ${res.statusCode}`);res.resume();c.ws.terminate();});
  c.ws.on('close',(code,reason)=>{c.closeCode=code;c.closeReason=String(reason);c.closedAt=performance.now();if(!cleaningUp&&!c.intentional){disconnects++;problem('close',`${code} ${reason}`);}});
}
async function chromeWindow(i){
  const profile=await mkdtemp(`${tmpdir()}/crowd-load-`);profiles.push(profile);
  const browser=await puppeteer.launch({executablePath:opts.chrome??process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,userDataDir:profile,defaultViewport:{width:1000,height:760},args:['--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding',`--window-position=${i*550},${i*80}`,'--window-size=1020,840']});browsers.push(browser);
  const page=await browser.newPage();await page.setUserAgent(`${await browser.userAgent()} HomieCheck crowd-load`);
  page.on('pageerror',e=>problem(`chrome${i}`,e.message));
  page.on('console',m=>{if(m.type()==='error')problem(`chrome${i}`,m.text());});
  await page.goto(`${origin}/${game}/play?room=${room}&name=Chrome-${i+1}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__shell?.seat!==null && window.__shell?.stats?.role==='replica' && window.__shell?.arrival?.phase==='done',{timeout:60000}).catch(async()=>{
    await page.waitForFunction(()=>window.__shell?.stats?.role==='replica' && typeof window.__shell?.seat==='number',{timeout:15000});
  });
  const frame=page.frames().find(f=>f.url().includes('/__game/'));if(frame)await frame.click('canvas');
  windows.push({page,i,frame});return page;
}
async function browserFacts(w){return w.page.evaluate(()=>{const s=window.__shell;return {room:s?.room,seat:s?.seat,stats:s?.stats,arrival:s?.arrival,facts:{counts:s?.facts?.counts,hosted:s?.facts?.hosted,ticks:s?.facts?.ticks,stats:s?.facts?.stats},results:s?.results?.map(r=>({n:r.n,at:r.at,own:r.results?.find(p=>p.seat===s.seat)}))};});}

try{
  console.log(JSON.stringify({phase:'start',origin,room,n,seconds,play:`${origin}/${game}/play?room=${room}`}));
  // Two visible, independent profiles: these are players, not spectators.
  for(let i=0;i<2;i++)await chromeWindow(i);
  samples.push({phase:'before-ramp',browsers:await Promise.all(windows.map(browserFacts))});
  expectedTimer=performance.now();
  timer=setInterval(()=>{
    const now=performance.now(),lag=Math.max(0,now-expectedTimer-100);expectedTimer=now;peakLoopMs=Math.max(peakLoopMs,lag);
    badLag=lag>2000?badLag+1:0;if(badLag>=3)stop('driver event loop stalled');
    peakConnected=Math.max(peakConnected,clients.filter(c=>c.ws?.readyState===1).length);
    if(!measureStart&&now-rampLogAt>10000){rampLogAt=now;console.log(JSON.stringify({phase:'ramp',at:new Date().toISOString(),attempted:clients.length,connected:clients.filter(c=>c.ws?.readyState===1).length,joined:clients.filter(c=>c.first!==null).length,fresh:clients.filter(c=>c.own&&now-c.at<2000).length}));}
    const rss=process.memoryUsage().rss/1048576;maxRss=Math.max(maxRss,rss);if(rss>rssLimit)stop(`driver RSS exceeded ${rssLimit} MiB`);
    for(const c of clients){
      if(c.retired)continue;
      if(now>c.nextPing){send(c,{t:'ping',c:Date.now(),hid:false});c.nextPing=now+2000;}
      if(c.own&&now-c.at>5000&&!c.staleReported){c.staleReported=true;problem('stale snapshot',`client ${c.i}: no own state for 5s; rawTick=${c.rawTick}; decodedMiss=${c.decodeMiss??0}; ownMissing=${c.ownMissing??0}`);}
      if(c.own&&now-c.at>Number(opts['stall-ms']??240000))stop('server own state exceeded observation timeout');
      if(!c.own||now-c.at>2000)continue;
      // 10 Hz plausible varying stick, with the same 20 Hz tick-addressed input as the browser.
      // Three ticks of lead, plus snapshot age, allows relay transit. Exact ack latency includes that lead.
      const k=Math.max(c.lastSent+1,c.k+Math.min(10,Math.floor((now-c.at)/50))+3);
      const x=c.own[3][0],y=c.own[3][1];
      const east=Boolean(c.own[7][1]);
      const ax=east?127:-127,ay=y>55?-35:y< -55?35:Math.round(Math.sin(now/3100+c.i)*35);
      send(c,{t:'in',e:c.epoch,k,s:[[0,ax,ay]],r:c.r});c.pending.set(k,now);c.lastSent=k;
      for(const [tick,at]of c.pending)if(now-at>5000){c.pending.delete(tick);if(measureStart&&!measureEnd)ackExpired++;}
    }
  },100);
  const joining=new Set();
  for(let i=0;i<n&&!stopping;i++){while(joining.size>=8&&!stopping)await Promise.race(joining);if(stopping)break;const task=connect(i).catch(e=>problem('connect',e.message)).finally(()=>joining.delete(task));joining.add(task);await sleep(rampMs);}
  await Promise.all(joining);
  const deadline=performance.now()+30000;
  while(!stopping&&clients.some(c=>c.first===null)&&performance.now()<deadline)await sleep(250);
  if(stopping)throw Error(`Step stopped before steady measurement: ${stopReason}`);
  measureStart=performance.now();for(const c of clients){c.pending.clear();c.firstTick=null;c.up=0;c.down=0;}
  console.log(JSON.stringify({phase:'measuring',joined:clients.filter(c=>c.first!==null).length,n}));
  let nextSample=measureStart,nextShot=measureStart+5000,keyRight=true;
  let churnDone=false;
  while(!stopping&&performance.now()-measureStart<seconds*1000){
    if(churnCount&&!churnDone&&performance.now()-measureStart>=Number(opts['churn-at']??60)*1000){
      churnDone=true;const leaving=clients.filter(c=>c.first!==null&&c.ws?.readyState===1).slice(0,churnCount);
      churn={started:new Date().toISOString(),requested:churnCount,left:leaving.length};
      for(const c of leaving){c.intentional=true;c.retired=true;c.ws.close(1000,'100-player churn');}
      await sleep(1000);for(const c of leaving)if(c.ws.readyState!==3)c.ws.terminate();
      const at=performance.now(),offset=clients.length;
      await Promise.all(leaving.map(c=>connect(c.i,c.key,c.token).catch(e=>problem('churn connect',e.message))));
      const until=performance.now()+30000;
      while(!stopping&&clients.slice(offset).some(c=>c.first===null)&&performance.now()<until)await sleep(100);
      const joined=clients.slice(offset).filter(c=>c.first!==null);
      churn={...churn,rejoined:joined.length,sameSeat:joined.filter(c=>leaving.find(old=>old.i===c.i)?.seat===c.seat).length,rejoinElapsedMs:performance.now()-at,firstStateMs:joined.map(c=>c.first-c.began),finished:new Date().toISOString()};
      console.log(JSON.stringify({phase:'churn',...churn}));
    }
    if(performance.now()>=nextSample){
      const facts=await Promise.all(windows.map(browserFacts));
      for(const [i,f] of facts.entries())if(f.room!==room || f.stats?.role!=='replica' || !f.stats?.connected || f.stats?.offline || typeof f.seat!=='number'){problem('browser membership',JSON.stringify({i,room:f.room,seat:f.seat,role:f.stats?.role}));stop('Chrome is no longer a live server replica in requested room');}
      const sample={seconds:(performance.now()-measureStart)/1000,connected:clients.filter(c=>c.ws?.readyState===1).length,firstState:clients.filter(c=>!c.retired&&c.first!==null).length,freshState:clients.filter(c=>!c.retired&&c.own&&performance.now()-c.at<2000).length,rssMiB:process.memoryUsage().rss/1048576,loopP99Ms:loop.percentile(99)/1e6,browsers:facts};samples.push(sample);console.log(JSON.stringify({...sample,browsers:facts.map(f=>({room:f.room,seat:f.seat,role:f.stats?.role}))}));
      // Real keyboard input in both windows, alternating lines every five seconds.
      for(const w of windows){await w.page.keyboard.up(keyRight?'ArrowLeft':'ArrowRight');await w.page.keyboard.down(keyRight?'ArrowRight':'ArrowLeft');}
      keyRight=!keyRight;nextSample=performance.now()+5000;
    }
    if(performance.now()>=nextShot){for(const w of windows)await w.page.screenshot({path:`${out}/chrome-${w.i+1}.png`});nextShot=Infinity;}
    await sleep(100);
  }
  measureEnd=performance.now();
  for(const w of windows)await w.page.screenshot({path:`${out}/chrome-${w.i+1}-end.png`});
  // Landing stills from actual play, outside the measurement interval.
  for(const [i,w] of windows.entries()) {
    await w.page.setViewport(i===0?{width:1280,height:720}:{width:720,height:1280});
    await sleep(150);
    const canvas=await w.frame?.$('canvas');
    if(canvas)await canvas.screenshot({path:`${out}/${i===0?'wide':'tall'}.jpg`,type:'jpeg',quality:88});
  }
}catch(e){problem('fatal',e.stack??e.message);stop('fatal error');process.exitCode=1;}
finally{
  const connectedAtEnd=clients.filter(c=>c.ws?.readyState===1).length;
  try{samples.push({phase:'final',browsers:await Promise.all(windows.map(browserFacts))});}catch{}
  measureEnd||=performance.now();stopping=true;cleaningUp=true;clearInterval(timer);loop.disable();
  for(const c of clients)if(c.ws){c.ws.close(1000,'load step complete');}
  await sleep(1000);for(const c of clients)if(c.ws?.readyState!==3)c.ws?.terminate();
  await Promise.allSettled(browsers.map(b=>b.close()));
  await Promise.allSettled(profiles.map(p=>rm(p,{recursive:true,force:true})));
  const duration=measureStart?(measureEnd-measureStart)/1000:0;
  const rates=clients.map(c=>c.firstTick!==null&&c.lastAt-c.firstAt>=5000?(c.lastTick-c.firstTick)/((c.lastAt-c.firstAt)/1000):null).filter(x=>x!==null).sort((a,b)=>a-b);
  const report={started,measurementStarted:measureStart?new Date(performance.timeOrigin+measureStart).toISOString():null,attempted:clients.length,connectedAtEnd,ended:new Date().toISOString(),origin,game,room,toolkit:'0.45.0',n,chromePlayers:2,requestedSeconds:seconds,measuredSeconds:duration,stopReason,churn,joined:clients.filter(c=>c.first!==null).length,welcomeMs:welcomeTime.json(),firstStateMs:firstState.json(),inputAckMs:echo.json(),ackSkipped,ackExpired,disconnects,errors:[...errors].map(([text,count])=>({text,count})),tickHz:{min:rates[0]??null,median:rates[Math.floor(rates.length/2)]??null,max:rates.at(-1)??null},serverTickTimeMs:null,cleanup:{openSockets:clients.filter(c=>c.ws&&c.ws.readyState!==3).length,connectedBrowsers:browsers.filter(b=>b.connected).length},lifetime:{upBytes:totalUp,downBytes:totalDown,peakConnected},payload:{upBytes:up,downBytes:down,upFrames,downFrames,upBytesPerRequestedPlayerSecond:duration?up/n/duration:null,downBytesPerRequestedPlayerSecond:duration?down/n/duration:null},driver:{maxRssMiB:maxRss,eventLoopP99Ms:loop.percentile(99)/1e6,peakTimerLagMs:peakLoopMs},players:clients.map(c=>({i:c.i,seat:c.seat,helloAfterMs:c.helloAt?c.helloAt-c.began:null,closedAfterMs:c.closedAt?c.closedAt-c.began:null,closeCode:c.closeCode,closeReason:c.closeReason,firstStateMs:c.first===null?null:c.first-c.began,maxStateGapMs:c.maxStateGapMs,rawSnapshots:c.rawSnapshots,rawTick:c.rawTick,decodeMiss:c.decodeMiss??0,ownMissing:c.ownMissing??0,missingSummary:c.missingSummary,messageTypes:c.messageTypes,snapshotShape:c.snapshotShape,staleReported:c.staleReported??false,observedTickHz:c.observedLastAt>c.observedFirstAt?(c.observedLastTick-c.observedFirstTick)/((c.observedLastAt-c.observedFirstAt)/1000):null,snapshots:c.snapshots,upBytes:c.up,downBytes:c.down})),samples,notes:['N simulated players plus two Chrome players; capacity 1000 total.','Steady measurement starts after ramp + up to 30s join wait. First state is a decoded snapshot containing own body.','Bytes are UTF-8 WebSocket application payloads, excluding framing/TLS/HTTP and Chrome traffic.','Input latency is exact server control-table ack of a sent tick, not ping RTT; includes intentional 3-tick prediction lead. Superseded cumulative acks are counted separately.','Tick Hz is authoritative snapshot tick progress over client monotonic receive time; not server CPU time.','Stalls are reported at 5 seconds; default observation stop is 240 seconds so degraded delivery remains measurable. Inputs suspend after 2 seconds without own state, matching loss of usable feedback; freshState samples identify offered-load loss. Individual disconnects remain counted and do not abort other players; no automatic reconnect. Optional --churn 100 closes 100 sockets at --churn-at (default 60 seconds) and rejoins their same browser IDs concurrently after 1 second. Retired clients remain in evidence; aggregate bytes span churn.','Server execution milliseconds unavailable from public snapshots; null, not inferred from 50ms tick spacing.']};
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,players:undefined,samples:undefined}));
  if(report.joined!==n+(churn?.rejoined??0)||stopReason||disconnects||errors.size)process.exitCode=1;
}
// All owned sockets, Chrome children and profiles have been closed and the report
// has been awaited. Finish the CLI even if an imported library retains a timer.
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(process.exitCode ?? 0);
