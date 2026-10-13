/** Two real Chrome views of a /tmp-only copy. Never modifies the source studio. */
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createServer} from 'node:http';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import {WebSocketServer} from 'ws';
import {prepareRules,loadRules,viewPlugin} from '../packages/studio/lib/rules-build.mjs';
import {NetRoom} from '../packages/studio/worker/room.mjs';
import {findChrome,chromeArgs} from '../packages/studio/lib/chrome.mjs';
const source=process.argv[2];if(!source)throw Error('Pass the read-only Octree Arena source directory');
const repo=fileURLToPath(new URL('../',import.meta.url)),root=mkdtempSync('/tmp/homie-physics-arena-'),dir=join(root,'games/octree-arena');
cpSync(resolve(source),dir,{recursive:true});symlinkSync(join(repo,'node_modules'),join(root,'node_modules'),'dir');mkdirSync(join(dir,'src'),{recursive:true});mkdirSync(join(dir,'map'),{recursive:true});
const fixture=join(repo,'packages/studio/test/fixtures/physics-arena');for(const name of ['rules.ts','move.ts'])cpSync(join(fixture,name),join(dir,'src',name));
writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-100,-100,-100],max:[100,100,100]},physics:{level:'examples/models/gltf/collision-world.glb'}}));
writeFileSync(join(dir,'tunables.json'),'{}');
const g={id:'octree-arena',dir,entry:'src/view.ts',players:{max:8},room:{host:'server',offline:false}};writeFileSync(join(dir,'game.json'),JSON.stringify(g,(k,v)=>k==='dir'?undefined:v,2));
const view=`import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {openRoom} from '@homie-rocks/studio/rules/view';
const win=globalThis as any;const room=win.room=openRoom({net:{config:{v:1,url:location.origin.replace('http','ws')+'/socket',room:'r',device:'desk',want:'play',name:new URLSearchParams(location.search).get('name')??'Player'},post:null}});
const scene=new THREE.Scene();scene.background=new THREE.Color('#9ed4ee');scene.add(new THREE.HemisphereLight(0xffffff,0x334422,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(10,-5,20);scene.add(light);
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.05,200);camera.up.set(0,0,1);const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);document.body.style.margin='0';document.body.append(renderer.domElement);
new GLTFLoader().load('/level.glb',g=>{g.scene.rotation.x=Math.PI/2;scene.add(g.scene);win.levelReady=true;});const meshes=new Map();const geometry=new THREE.CapsuleGeometry(.35,.65,6,12);geometry.rotateX(Math.PI/2);
win.axes={ax:0,ay:0,jump:false};win.samples=[];win.latencies=[];win.change=(ax:number,ay:number,jump=false)=>{const me=room.me,previous=win.axes;const action=jump&&!previous.jump&&me?.grounded?'jump':(ax||ay)&&!previous.ax&&!previous.ay?'walk':null;if(action&&me)win.pending={at:performance.now(),p:{...me.pos},action};win.axes={ax,ay,jump};room.input(win.axes);};
const keys=new Set();addEventListener('keydown',e=>{keys.add(e.code);if(e.code==='Space')e.preventDefault();win.change((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),keys.has('Space'));});addEventListener('keyup',e=>{keys.delete(e.code);win.change((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),keys.has('Space'));});
function frame(t:number){room.input(win.axes);const me=room.me;room.each('runner',body=>{let mesh=meshes.get(body.id);if(!mesh){mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:body.mine?0xffdd44:0x6d40dd}));meshes.set(body.id,mesh);scene.add(mesh);}mesh.position.set(body.pos.x,body.pos.y,body.pos.z);});if(me){camera.position.set(me.pos.x-5,me.pos.y-7,me.pos.z+4);camera.lookAt(me.pos.x,me.pos.y,me.pos.z);const prediction=win.__homieNet.probe.prediction();win.samples.push({t,pos:{...me.pos},vel:{...me.vel},grounded:me.grounded,prediction});if(win.pending?.p&&(win.pending.action==='jump'?me.pos.z>win.pending.p.z+1e-5:Math.hypot(me.pos.x-win.pending.p.x,me.pos.y-win.pending.p.y)>1e-5)){win.latencies.push({action:win.pending.action,ms:performance.now()-win.pending.at});win.pending=null;}}renderer.render(scene,camera);requestAnimationFrame(frame);}requestAnimationFrame(frame);
`;
writeFileSync(join(dir,'src/view.ts'),view);
const rules=await prepareRules(esbuild,root,g,{log:console.log});
const L=await loadRules(esbuild,root,g.id,rules.code,{physics:true});await L.initializePhysics(readFileSync(new URL(import.meta.resolve('@homie-rocks/physics/vendor/rapier.wasm'))));
const compiled=L.R.compileRules(L.def,{map:L.R.compileMap(rules.map),settings:rules.settings,seats:8});
const output=join(root,'view.js');await esbuild.build({entryPoints:['homie:view'],bundle:true,format:'esm',platform:'browser',outfile:output,plugins:[viewPlugin(g,rules,join(dir,'src/view.ts'))],logLevel:'silent'});
const bundle=readFileSync(output),level=readFileSync(join(dir,'examples/models/gltf/collision-world.glb'));
const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));const receipts=[];
try{for(const delay of [0,150]){
 const timers=new Set(),contexts=[];const later=fn=>{const id=setTimeout(()=>{timers.delete(id);fn();},delay);timers.add(id);};
 const server=createServer((req,res)=>{const path=req.url.split('?')[0];res.setHeader('content-type',path==='/view.js'?'text/javascript':path==='/level.glb'?'model/gltf-binary':'text/html');res.end(path==='/view.js'?bundle:path==='/level.glb'?level:'<title>Octree Arena — server rules physics proof</title><script type="module" src="/view.js"></script>');});
 const sockets=new WebSocketServer({server}),relay=new NetRoom({code:'r',rules:true,maxPlayers:8,tickHz:20});
 const host=L.H.createHost({game:g.id,compiled,random:()=>.37,send:(m,text)=>relay.hostFrame(m,text),clock:{now:Date.now,setTimer:setTimeout,clearTimer:clearTimeout}});relay.setServerHost(host);
 sockets.on('connection',socket=>{const wire=relay.attach({send:text=>later(()=>{if(socket.readyState===1)socket.send(text);}),close:(c,w)=>socket.close(c,w),buffered:()=>socket.bufferedAmount});socket.on('message',text=>later(()=>wire.onMessage(String(text))));socket.on('close',()=>wire.onClose());});
 const beat=setInterval(()=>relay.tick(),250);server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
 const pages=[];for(let n=0;n<2;n++){const context=await browser.createBrowserContext();contexts.push(context);const page=await context.newPage();pages.push(page);page.on('pageerror',e=>console.error('PAGE',e.message));await page.setViewport({width:960,height:640});await page.goto('http://127.0.0.1:'+server.address().port+'/?name=P'+n);await page.waitForFunction('window.levelReady && window.room?.me',{timeout:30000});}
 await sleep(12000);const before=await Promise.all(pages.map(p=>p.evaluate(()=>{samples=[];latencies=[];return __homieNet.probe.prediction();})));
 await Promise.all(pages.map(p=>p.keyboard.down('KeyD')));await sleep(1300);await Promise.all(pages.map(p=>p.keyboard.up('KeyD')));await sleep(700);await Promise.all(pages.map(p=>p.waitForFunction('room.me.grounded',{timeout:10000})));await Promise.all(pages.map(p=>p.keyboard.down('Space')));await sleep(100);await Promise.all(pages.map(p=>p.keyboard.up('Space')));await sleep(1300);await Promise.all(pages.map(p=>p.keyboard.down('KeyA')));await sleep(700);await Promise.all(pages.map(p=>p.keyboard.up('KeyA')));await sleep(1800);
 await Promise.all(pages.map((p,n)=>p.screenshot({path:join(root,`arena-${delay}-player-${n}.png`)})));
 const players=await Promise.all(pages.map(p=>p.evaluate(()=>({samples,latencies,prediction:__homieNet.probe.prediction()}))));
 const numbers=players.map((p,n)=>({corrections:p.prediction.count-before[n].count,maxCorrectionM:Math.max(0,...p.samples.filter((s,i)=>i&&s.prediction.count>p.samples[i-1].prediction.count).map(s=>s.prediction.last)),snaps:p.prediction.snaps-before[n].snaps,inputToMotionMs:p.latencies.map(v=>v.ms),latencySamples:p.latencies,maxFrameDisplacementM:Math.max(...p.samples.slice(1).map((s,i)=>Math.hypot(s.pos.x-p.samples[i].pos.x,s.pos.y-p.samples[i].pos.y,s.pos.z-p.samples[i].pos.z))),airborneFrames:p.samples.filter(s=>!s.grounded).length}));
 for(const player of players)assert.ok(player.latencies.some(v=>v.action==='jump'),'each real player must visibly jump');
 for(const player of numbers)assert.equal(player.corrections,0,'a player’s own capsule must not correct in the fixed-delay trial');
 const receipt={oneWayMs:delay,players:numbers,stats:host.core.stats};receipts.push(receipt);console.log(JSON.stringify(receipt));assert.equal(host.core.stats.errors,0);assert.equal(host.core.stats.budgetStops,0);
 writeFileSync(join(root,`samples-${delay}.json`),JSON.stringify(players));
 }finally{await Promise.all(contexts.map(c=>c.close()));clearInterval(beat);for(const id of timers)clearTimeout(id);host.stop();for(const socket of sockets.clients)socket.terminate();await new Promise(r=>sockets.close(r));await new Promise(r=>{server.close(r);server.closeAllConnections();});}
}
}finally{await browser.close();}
writeFileSync(join(root,'receipt.json'),JSON.stringify({root,receipts},null,2)+'\n');console.log('Receipt: '+join(root,'receipt.json'));
