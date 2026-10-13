#!/usr/bin/env node
/** Optional real-game proof. Reads the source studio; creates only /tmp copies and local servers. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync,writeFileSync,mkdirSync,cpSync,mkdtempSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const studio=process.argv[2];
if(!studio)throw new Error('Usage: node scripts/prove-ported-maps.mjs /path/to/arcade-studio (read-only source; proof writes to /tmp)');
const root=realpathSync(mkdtempSync('/tmp/homie-ported-maps-'));
mkdirSync(root+'/games');
for(const id of ['asteroids-arena','bone-burglar'])cpSync(resolve(studio,'games',id),join(root,'games',id),{recursive:true});
console.log('Proof artifacts: '+root);
const require=createRequire(repo+'/packages/studio/package.json');
const puppeteer=require('puppeteer-core'),{WebSocketServer}=require('ws');
const {findChrome,chromeArgs}=await import(repo+'/packages/studio/lib/chrome.mjs');
const {viewPlugin}=await import(repo+'/packages/studio/lib/rules-build.mjs');
const {NetRoom}=await import(repo+'/packages/studio/worker/room.mjs');
const {PKG,esbuildOf,loadGame,writeGame,prepareRuntimeFixture}=await import(repo+'/packages/studio/test/rules-kit.mjs');
const source=readFileSync(root+'/games/asteroids-arena/game.js','utf8');
const W=Number(source.match(/var W = (\d+)/)[1]),H=Number(source.match(/H = (\d+)/)[1]);
const unit=Number(source.match(/var UNIT = (\d+)/)[1]),maxV=Number(source.match(/var MAXV = (\d+)/)[1]);
const radius=Number(source.match(/var SHIP_R = (\d+)/)[1]),speed=maxV*1000/unit;
const ship=JSON.parse(source.match(/var SHIP_PTS = (\[[^;]+\])/)[1]);
const rock=JSON.parse(source.match(/var ROCK_PTS = (\[[^;]+\])/)[1]);
const asteroidDir=writeGame(root+'/games/asteroids-arena','rules-proof',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,entities:{runner:{player:true,input:{ax:f.i8()},fields:{neighbours:f.u8()},body:{shape:'circle',radius:${radius},maxSpeed:${speed}},tick(w,s){s.neighbours=w.near(s.pos,64,'runner').length;}},rock:{body:{shape:'circle',radius:60,maxSpeed:100}}},room:{bots:{keep:0},start(w){for(let i=0;i<4;i++)w.spawn('rock',{x:250+i*180,y:150+i*100,z:0});},join(c,p){return{kind:'runner',at:{x:p.seat===0?1180:20,y:420,z:0}};}}});`,move:`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:i.ax*${speed},y:0,z:0};c.map.sweep(b,c.math.scale(b.vel,c.dt));},rock(b,i,c){b.vel={x:45,y:25,z:0};c.map.sweep(b,c.math.scale(b.vel,c.dt));}});`});
mkdirSync(asteroidDir+'/map',{recursive:true});writeFileSync(asteroidDir+'/map/main.json',JSON.stringify({bounds:{min:[0,0],max:[W,H]},wrap:{x:true,y:true}}));
// Preserve the actual maze algorithm, replacing its local RNG with the room's
// seeded source. These edits and both proof scaffolds exist only in the /tmp copy.
const mazeSource=readFileSync(root+'/games/bone-burglar/rules.js','utf8');
let maze=mazeSource.slice(mazeSource.indexOf('function shuffled'),mazeSource.indexOf('function makeMover'));
maze=maze.replace('function shuffled(items, rng)','function shuffled(items, world)')
 .replaceAll('rng()', 'world.random()').replace('[out[i], out[j]] = [out[j], out[i]];', 'const saved = out[i]; out[i] = out[j]; out[j] = saved;')
 .replace('export function generateMaze(seed)','function generateMaze(world)').replace('  const rng = mulberry32(seed);','')
 .replaceAll(', rng)',', world)').replace('const walls = Array.from({ length: height }, () => Array(width).fill(true));',
 'const walls = []; for(let y=0;y<height;y++){const row=[];for(let x=0;x<width;x++)row.push(true);walls.push(row);}');
const boneDir=writeGame(root+'/games/bone-burglar','rules-proof',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
const TUNING={columns:25,rows:25};
${maze}
function level(w){const data=generateMaze(w).flat().map(v=>v?1:0);w.map.replace({bounds:{min:[0,0],max:[25,25]},wrap:{x:true},tiles:{width:25,height:25,data,flows:{home:[487]}}});}
export default defineRules({contract:2,space:{dims:2},move,shapes:{commands:{regenerate:{}},events:{regenerate:{}}},entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'circle',radius:.2,maxSpeed:4},commands:{regenerate(w,s){w.place(s,{x:12.5,y:19.5,z:0});w.sendRoom('regenerate');}}}},room:{bots:{keep:0},start(w){level(w);},on:{regenerate(w){level(w);}},join(){return{kind:'runner',at:{x:12.5,y:19.5,z:0}};}}});`,
move:`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){c.map.sweep(b,{x:i.ax*4*c.dt,y:0,z:0});}});`});
mkdirSync(boneDir+'/map',{recursive:true});writeFileSync(boneDir+'/map/main.json',JSON.stringify({bounds:{min:[0,0],max:[25,25]},wrap:{x:true}}));
const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
const receipts=[];const esbuild=await esbuildOf();
try{for(const [id,dir] of [['asteroids',asteroidDir],['bone-burglar',boneDir]]){
 const game={id,dir,players:{max:2},room:{host:'server',tickHz:20,view:{radiusM:id==='asteroids'?750:null}}};
 const rules=await prepareRuntimeFixture(esbuild,root,game),L=await loadGame(root,dir,id);
 const compiled=L.R.compileRules(L.def,{map:L.R.compileMap(rules.map),settings:rules.settings,seats:2});
 const entry=join(root,id+'-entry.ts'),output=join(root,id+'-view.js');
 writeFileSync(entry,`export {openRoom} from ${JSON.stringify(PKG+'/rules/view.ts')};`);
 await esbuild.build({stdin:{contents:`import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`,resolveDir:root},bundle:true,format:'esm',outfile:output,plugins:[viewPlugin(game,rules,entry)],logLevel:'silent'});
 const bundle=readFileSync(output),server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/view.js'?'text/javascript':'text/html');res.end(req.url==='/view.js'?bundle:'<body style="margin:0;background:#080e18"><canvas width="1200" height="840"></canvas><script type="module">import {openRoom} from "/view.js";window.openRoom=openRoom;</script>');});
 const sockets=new WebSocketServer({server}),relay=new NetRoom({code:'r',rules:true,maxPlayers:2,tickHz:20});
 sockets.on('connection',socket=>{const wire=relay.attach({send:text=>{if(socket.readyState===1)socket.send(text);},close:(c,w)=>socket.close(c,w),buffered:()=>socket.bufferedAmount});socket.on('message',text=>wire.onMessage(String(text)));socket.on('close',()=>wire.onClose());});
 const host=L.H.createHost({game:id,compiled,send:m=>relay.hostFrame(m),random:()=>.37,clock:{now:Date.now,setTimer:setTimeout,clearTimer:clearTimeout}});relay.setServerHost(host);
 const beat=setInterval(()=>relay.tick(),250);server.listen(0,'127.0.0.1');await once(server,'listening');const contexts=[],pages=[];
 try{
 for(let n=0;n<2;n++){const context=await browser.createBrowserContext();contexts.push(context);const page=await context.newPage();pages.push(page);await page.setViewport({width:1200,height:840});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction('window.openRoom');await page.evaluate(({n,id,ship,rock})=>{
 window.room=openRoom({net:{config:{v:1,url:location.origin.replace('http','ws')+'/socket',room:'r',device:'desk',want:'play',name:'P'+n},post:null}});window.samples=[];window.direction=0;
 const ctx=document.querySelector('canvas').getContext('2d');
 const path=(points,x,y,scale,color)=>{ctx.strokeStyle=color;ctx.beginPath();for(let i=0;i<points.length;i+=2){const px=x+points[i]*scale,py=y+points[i+1]*scale;i?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();ctx.stroke();};
 function frame(t){room.input({ax:direction});ctx.fillStyle='#080e18';ctx.fillRect(0,0,1200,840);ctx.fillStyle='#f1f4ff';ctx.font='20px monospace';ctx.fillText(id+' — rules map proof',24,32);
 if(id==='bone-burglar'&&room.map.tiles){const m=room.map.tiles;ctx.fillStyle='#446a9c';for(let y=0;y<25;y++)for(let x=0;x<25;x++)if(m.data[y*25+x])ctx.fillRect(40+x*29,60+y*29,27,27);}
 room.each('runner',e=>{if(id==='asteroids')for(const shift of [-1200,0,1200])path(ship,e.pos.x+shift,e.pos.y,1.8,e.mine?'#76ffcc':'#ffb875');else{ctx.fillStyle=e.mine?'#76ffcc':'#ffb875';ctx.beginPath();ctx.arc(40+e.pos.x*29,60+e.pos.y*29,7,0,Math.PI*2);ctx.fill();}});
 if(id==='asteroids')room.each('rock',e=>path(rock,e.pos.x,e.pos.y,6,'#a6bdff'));
 if(room.me)samples.push({t,x:room.me.pos.x,seen:room.me.neighbours});requestAnimationFrame(frame);};requestAnimationFrame(frame);
 },{n,id,ship,rock});await page.waitForFunction('room.me && room.status==="playing"',{timeout:15000});}
 await new Promise(r=>setTimeout(r,1200));
 if(id==='asteroids'){
 const views=await Promise.all(pages.map(p=>p.evaluate(()=>({mine:room.me.id,seen:room.me.neighbours,visible:(()=>{const ids=[];room.each('runner',e=>ids.push(e.id));return ids;})()}))));assert.ok(views.every(v=>v.visible.length===2&&v.seen===2));
 await pages[0].screenshot({path:root+'/asteroids-edge.png'});await pages[0].evaluate(()=>{samples=[];direction=1;});await new Promise(r=>setTimeout(r,1100));await pages[0].evaluate(()=>{direction=0;});
 const samples=await pages[0].evaluate(()=>samples);assert.ok(samples.some((p,i)=>i&&p.x<samples[i-1].x-600));const maxStep=Math.max(...samples.slice(1).map((p,i)=>Math.abs(((p.x-samples[i].x+1800)%1200)-600)));assert.ok(maxStep<100);
 receipts.push({game:id,views,width:W,height:H,originalUnitMs:unit,originalSpeedCap:speed,frames:samples.length,maxDrawStep:maxStep,stats:host.core.stats});
 }else{
 const before=await pages[0].evaluate(()=>room.map.tiles.data);const round=await pages[0].evaluate(()=>room.round.n);await pages[0].evaluate(()=>{direction=-1;});await new Promise(r=>setTimeout(r,5000));const first=await pages[0].evaluate(()=>room.me.pos.x);await pages[0].evaluate(()=>{direction=0;room.command('regenerate');});await new Promise(r=>setTimeout(r,1200));const after=await pages[0].evaluate(()=>room.map.tiles.data);assert.notDeepEqual(before,after);assert.equal(await pages[0].evaluate(()=>room.round.n),round);await pages[0].screenshot({path:root+'/bone-regenerated.png'});receipts.push({game:id,cells:before.length,firstWallStop:first,changedCells:before.filter((v,i)=>v!==after[i]).length,stats:host.core.stats});
 }
 assert.equal(host.core.stats.errors,0,host.core.stats.lastError);assert.equal(host.core.stats.ticksCut,0);
 }finally{for(const c of contexts)await c.close();clearInterval(beat);host.stop();for(const s of sockets.clients)s.terminate();await new Promise(r=>sockets.close(r));await new Promise(r=>server.close(r));}
}}finally{await browser.close();}
writeFileSync(root+'/chrome-receipt.json',JSON.stringify(receipts,null,2));console.log(JSON.stringify(receipts));
