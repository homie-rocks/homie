/** Real socket/browser smoke; seeded virtual-time terrain tests own exhaustive timing. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {WebSocketServer} from 'ws';
import {findChrome,chromeArgs} from '../lib/chrome.mjs';
import {viewPlugin} from '../lib/rules-build.mjs';
import {NetRoom} from '../worker/room.mjs';
import {PKG,esbuildOf,loadGame,writeGame,prepareRuntimeFixture} from './rules-kit.mjs';
import {predictionShaper} from './prediction-shaper.mjs';
test('4058 solid shapes, six bodies and live cover over real Chrome sockets at 300 ms + 12% loss',{timeout:120000},async t=>{
 const scratch=mkdtempSync(join(tmpdir(),'homie-terrain-chrome-'));
 const dir=writeGame(scratch,'terrain',{rules:`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';export default defineRules({contract:2,space:{dims:3},map:'./map',move,entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'capsule',radius:.42,height:1.8,maxSpeed:22}},cover:{body:{shape:'box',radius:1,height:2.6,maxSpeed:0},collider:true}},room:{bots:{keep:6},join(){return{kind:'runner',at:{x:-4,y:7,z:0}};},start(w){w.spawn('cover',{x:0,y:-10,z:0});}}});`,move:`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){c.world.sweep(b,{x:i.ax*c.dt,y:0,z:0});}});`});
 const map=JSON.parse(readFileSync(join(PKG,'test/fixtures/stormbreak-terrain/map.json'),'utf8'));map.heightTiles=map.heightTiles.map(t=>({...t,base:0}));mkdirSync(join(dir,'map'));writeFileSync(join(dir,'map/main.json'),JSON.stringify(map));
 const esbuild=await esbuildOf(),game={id:'terrain',dir,players:{max:8},room:{host:'server'}},rules=await prepareRuntimeFixture(esbuild,scratch,game),L=await loadGame(scratch,dir);
 const compiled=L.R.compileRules(L.def,{map:L.R.compileMap(map),settings:rules.settings,seats:8});
 const entry=join(scratch,'entry.ts'),output=join(scratch,'view.js');writeFileSync(entry,`export {openRoom} from ${JSON.stringify(join(PKG,'rules/view.ts'))};`);
 await esbuild.build({stdin:{contents:`import 'homie:game';export {openRoom} from ${JSON.stringify(entry)};`,resolveDir:scratch},bundle:true,format:'esm',outfile:output,plugins:[viewPlugin(game,rules,entry)],logLevel:'silent'});
 const bundle=readFileSync(output),server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/view.js'?'text/javascript':'text/html');res.end(req.url==='/view.js'?bundle:'<script type="module">import {openRoom} from "/view.js";window.room=openRoom({net:{config:{v:1,url:location.origin.replace("http","ws")+"/socket",room:"r",device:"desk",want:"play",name:"Runner"},post:null}});window.samples=[];function frame(){if(room.me)samples.push(room.me.pos.x);requestAnimationFrame(frame)}frame();</script>');});
 const relay=new NetRoom({code:'r',rules:true,maxPlayers:8,tickHz:20}),sockets=new WebSocketServer({server}),timers=new Set(),shaper=predictionShaper({delay:300,loss:.12,seed:743});
 const shape=(text,link,send)=>{const ms=shaper(JSON.parse(text),link);if(ms===null)return;const timer=setTimeout(()=>{timers.delete(timer);send(text);},ms);timers.add(timer);};let links=0;
 sockets.on('connection',socket=>{const id=links++;const wire=relay.attach({send:text=>shape(text,id+':down',x=>{if(socket.readyState===1)socket.send(x);}),close:(c,w)=>socket.close(c,w),buffered:()=>socket.bufferedAmount});socket.on('message',text=>shape(String(text),id+':up',x=>wire.onMessage(x)));socket.on('close',()=>wire.onClose());});
 const host=L.H.createHost({game:'terrain',compiled,send:m=>relay.hostFrame(m),random:()=>.37,clock:{now:Date.now,setTimer:setTimeout,clearTimer:clearTimeout}});relay.setServerHost(host);const beat=setInterval(()=>relay.tick(),250);
 server.listen(0,'127.0.0.1');await once(server,'listening');const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
 try {const pages=[];for(let i=0;i<2;i++){const context=await browser.createBrowserContext(),page=await context.newPage();pages.push(page);await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction('window.room?.me');}
 await Promise.all(pages.map(p=>p.evaluate(()=>room.input({ax:22}))));
 await Promise.all(pages.map(p=>p.waitForFunction('Math.abs(room.me.pos.x+2.921)<.003',{timeout:20000})));
 await new Promise(r=>setTimeout(r,1200));
 for(const page of pages){const samples=await page.evaluate(()=>samples);assert.ok(samples.length>30);assert.ok(samples.every(x=>x<=-2.919),'no rendered penetration');}
 assert.equal(host.core.stats.errors,0,host.core.stats.lastError);assert.equal(host.core.save().ents.filter(e=>e[11]>=0).length,6);
 t.diagnostic(JSON.stringify(host.core.stats));
 } finally {await browser.close();host.stop();clearInterval(beat);for(const timer of timers)clearTimeout(timer);for(const socket of sockets.clients)socket.terminate();sockets.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(scratch,{recursive:true,force:true});}
});
