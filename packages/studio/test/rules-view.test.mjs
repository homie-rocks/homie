import { prepareRuntimeFixture } from './rules-kit.mjs';
/**
 * The view library of a rules game (rules/view.ts), built as `homie-studio build` builds it and run against a real
 * relay in both hosting modes (worker/room.mjs, rules/host.ts), on virtual time, including offline play and handover.
 *
 *   - `openRoom()` needs no argument: the build handed the library the game's declarations and its guarded move;
 *   - two views land in one room, each with its own body, the roster and the round, and neither is ever host;
 *   - a player's own body answers its input at once and the server follows it, held to the body's top speed;
 *   - the other view sees that body move, interpolated; entities enter and leave, and an effect the rules emit plays;
 *   - a full round is played with bots: both views get the same results from the server, and a view that claims a
 *     host's part (a snapshot, a round with results, shared state) changes nothing anyone sees;
 *   - input goes out as steps stamped with the room's tick, at most one frame a tick, with a keepalive when idle.
 * Run: node --test packages/studio/test/rules-view.test.mjs
 */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { prepareRules, viewPlugin } from '../lib/rules-build.mjs';
import { NetRoom } from '../worker/room.mjs';
import { Gate, multiplexSession } from '../worker/gate.mjs';
import { COIN_DASH, PKG, esbuildOf, loadGame } from './rules-kit.mjs';
import { virtualTime } from './virtual-time.mjs';
import { predictionShaper } from './prediction-shaper.mjs';

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-rules-view-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const json = (rel) => JSON.parse(readFileSync(join(COIN_DASH, rel), 'utf8'));

/** coin-dash's view library as its build bundles it (the declarations and the guarded move handed over first), and its rules for the server. */
let kit = null; let viewBuild = 0;
async function coinDashKit(mode = 'server', offline = false, tickHz = 20, runaway = false, predict = {}, radiusM = null, seats = 8) {
  if (kit && mode === 'server' && !offline && tickHz === 20 && !runaway && radiusM === null && seats === 8) return kit;
  const esbuild = await esbuildOf();
  let dir = COIN_DASH;
  if (runaway) {
    dir = join(scratch, `variant-${runaway}`); cpSync(COIN_DASH, dir, { recursive: true });
    const file = join(dir, 'src/rules.ts');
    if (runaway === 'validated-corner') {
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-10,-10],max:[10,10]},boxes:[{min:[0,1],max:[1,2]}]}));
      writeFileSync(file,`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';export default defineRules({contract:2,space:{dims:2},move,map:'./map',entities:{runner:{player:true,input:{ax:f.held()},body:{shape:'box',radius:.5,maxSpeed:60,move:'validated-owner'}}},room:{bots:{keep:0},join(){return{kind:'runner',at:{x:1.6,y:1.2,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){c.substeps(b,60,()=>{if(i.ax){b.pos={x:1.35,y:.5,z:0};b.grounded=true;}});}});`);
    } else if (runaway === 'validated-owner' || runaway === 'validated-owner-fast' || runaway === 'validated-owner-substeps' || runaway === 'validated-scene') {
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-100,-100],max:[100,100]},boxes:[{min:[-100,1],max:[100,3]}]}));
      writeFileSync(file,`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,map:'./map',shapes:{commands:{respawn:{},knock:{},point:{}}},entities:{runner:{player:true,input:{ax:f.held()},fields:{score:f.u16({score:true})},motion:{push:f.u8()},body:{shape:'box',radius:.5,maxSpeed:10,move:'validated-owner'},commands:{respawn(w,s){w.place(s,{x:0,y:.5},{vel:{x:0,y:0}});},knock(w,s){s.motion.push=4;},point(w,s){s.score++;}}}},room:{bots:{keep:0},join(){return{kind:'runner',at:{x:0,y:.5,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:b.motion.push?8:i.ax*4,y:0,z:0};if(b.motion.push)b.motion.push--;c.map.sweep(b,{x:b.vel.x*c.dt,y:0,z:0});}});`);
      if (runaway === 'validated-owner-fast') {
        writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-100000,-100],max:[100000,100]},boxes:[{min:[-100000,1],max:[100000,3]}]}));
        writeFileSync(file,readFileSync(file,'utf8').replace('maxSpeed:10','maxSpeed:60'));
        const m=join(dir,'src/move.ts');writeFileSync(m,readFileSync(m,'utf8').replace('i.ax*4','i.ax*54'));
      }
      if (runaway === 'validated-scene') {
        writeFileSync(file,readFileSync(file,'utf8').replace('entities:{runner:',"entities:{monster:{body:{shape:'box',radius:.5,maxSpeed:10}},runner:").replace('room:{bots:',"room:{start(w){w.spawn('monster',{x:0,y:-5,z:0});},bots:"));
        const m=join(dir,'src/move.ts');writeFileSync(m,readFileSync(m,'utf8').replace('defineMove({runner',"defineMove({monster(b,i,c){b.vel={x:4,y:0,z:0};b.pos={x:b.pos.x+4*c.dt,y:-5,z:0};},runner"));
      }
      if (runaway === 'validated-owner-substeps') writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:i.ax*4,y:0,z:0};c.substeps(b,60,s=>c.map.sweep(b,{x:b.vel.x*s.dt,y:0,z:0}));}});`);
    } else if (runaway === 'substeps') {
      writeFileSync(join(dir,'src/view.ts'), "import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();room.input({ax:1});");
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-20,-20],max:[20,20]}}));
      writeFileSync(file, "import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';export default defineRules({contract:2,space:{dims:2},move,entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'circle',radius:.2,maxSpeed:6}}},room:{bots:{keep:0},join(c,p){return{kind:'runner',at:{x:0,y:p.seat*2,z:0}};}}});");
      writeFileSync(join(dir,'src/move.ts'), "import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){c.substeps(b,300,s=>{const vx=i.ax*(s.index<7?6:s.index>7?-6:0);b.vel={x:vx,y:0,z:0};c.map.sweep(b,{x:vx*s.dt,y:0,z:0});});}});");
    } else if (runaway === 'generated') {
      writeFileSync(join(dir,'src/view.ts'),`import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();room.command('regenerate');`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[0,0],max:[25,25]},wrap:{x:true}}));
      writeFileSync(file,`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
function level(w){const data=[];for(let y=0;y<25;y++){for(let x=0;x<25;x++){data.push(y===12?0:x===0||x===24||y===0||y===24||x===w.shared.wall?1:0);}}w.map.replace({bounds:{min:[0,0],max:[25,25]},wrap:{x:true},tiles:{width:25,height:25,size:1,data,flows:{home:[301]}}});}
export default defineRules({contract:2,space:{dims:2},move,map:'./map',shared:{wall:f.u8({init:5})},shapes:{commands:{regenerate:{}},events:{regenerate:{}}},entities:{runner:{player:true,input:{ax:f.i8()},motion:{tile:f.u16(),distance:f.i16()},body:{shape:'circle',radius:.2,maxSpeed:4},commands:{regenerate(w){w.sendRoom('regenerate');}}}},room:{bots:{keep:0},start(w){level(w);},on:{regenerate(w){w.shared.wall=8;level(w);}},join(c,p){return{kind:'runner',at:{x:2,y:10+p.seat,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.motion.tile=c.map.tile(5,10);b.motion.distance=c.map.distance('home',Math.floor(b.pos.x),Math.floor(b.pos.y));c.world.sweep(b,{x:i.ax*4*c.dt,y:0,z:0});}});`);
    } else if (runaway === 'wrap2' || runaway === 'wrap3') {
      const dims=runaway==='wrap2'?2:3;
      writeFileSync(join(dir,'src/view.ts'),`import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();room.input({ax:1});`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[0,0,0],max:[20,20,20]},wrap:{x:true,y:true,...(dims===3?{z:true}:{})}}));
      writeFileSync(file,`import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:${dims}},move,map:'./map',entities:{runner:{player:true,input:{ax:f.i8()},body:{shape:'${dims===2?'circle':'sphere'}',radius:.2,maxSpeed:4},fields:{neighbours:f.u8()},tick(w,s){s.neighbours=w.near(s.pos,3,'runner').length;}}},room:{bots:{keep:0},join(c,p){return {kind:'runner',at:{x:p.seat===0?19:1,y:10,z:${dims===2?0:10}}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:i.ax*4,y:0,z:0};c.world.sweep(b,c.math.scale(b.vel,c.dt));}});`);
    } else if ((runaway === 'solid-ground' || runaway === 'solid-ground-box')) {
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-20,-20],max:[20,20]},boxes:[{min:[-8,0],max:[0,5]},{min:[-20,12],max:[20,15]}]}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,map:'./map',shapes:{commands:{respawn:{}}},entities:{runner:{player:true,input:{ax:f.held(),jump:f.held()},motion:{air:f.bit()},body:{shape:'${runaway === 'solid-ground-box' ? 'box' : 'circle'}',radius:.5,maxSpeed:30},commands:{respawn(w,s){w.place(s,{x:-3,y:-.5},{vel:{x:0,y:0}});s.motion.air=false;}}}},room:{bots:{keep:0},join(){return{kind:'runner',at:{x:-3,y:-.5,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){c.substeps(b,60,s=>{const vy=i.jump&&!b.motion.air?-15:Math.min(30,b.vel.y+40*s.dt);b.vel={x:i.ax*6,y:vy,z:0};c.map.sweep(b,{x:b.vel.x*s.dt,y:0,z:0});const hit=c.map.sweep(b,{x:0,y:vy*s.dt,z:0});b.motion.air=!hit;if(hit)b.vel={x:b.vel.x,y:0,z:0};});}});`);
    } else if (runaway === 'placement-clock') {
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-1000,-1000],max:[1000,1000]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,map:'./map',shapes:{commands:{respawn:{}}},entities:{runner:{player:true,input:{ax:f.held()},body:{shape:'circle',radius:.2,maxSpeed:4},commands:{respawn(w,s){w.place(s,{x:100,y:0},{vel:{x:2,y:0}});}}}},room:{bots:{keep:0},join(){return{kind:'runner',at:{x:0,y:0,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:2+2*i.ax,y:0,z:0};b.pos={x:b.pos.x+b.vel.x*c.dt,y:0,z:0};}});`);
    } else if (runaway === 'loss-physics') {
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-1000,-1000],max:[1000,1000]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,map:'./map',entities:{runner:{player:true,input:{ax:f.held()},body:{shape:'circle',radius:.2,maxSpeed:12}}},room:{bots:{keep:0},join(){return{kind:'runner',at:{x:0,y:0,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){const v=Math.max(-12,Math.min(12,(b.vel.x+i.ax*30*c.dt)*.9));b.vel={x:v,y:0,z:0};b.pos={x:b.pos.x+v*c.dt,y:0,z:0};}});`);
    } else if (runaway === 'pulses' || runaway === 'pulse-hold' || runaway === 'pulse-drop') {
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,map:'./map',shapes:{commands:{resume:{}}},entities:{runner:{player:${runaway==='pulses'?'true':`{control:'free',pulses:'${runaway==='pulse-hold'?'hold':'drop'}'}`},${runaway==='pulses'?'':`motion:{free:f.bit()},think(){return{};},commands:{resume(w,s){s.motion.free=true;}},`}input:{select:f.pulse()},fields:{actions:f.list(f.u8(),64),secret:f.text(20,{init:'brain-secret',visibility:'server'}),ammo:f.u8({init:24,visibility:'owner'}),damage:f.u16({init:52,visibility:'results'})},body:{shape:'circle',radius:.4,maxSpeed:0},tick(w,s){if(s.input.select)s.actions=[...s.actions,s.input.select];}}},room:{rounds:{seconds:60,breakSeconds:1},bots:{keep:0},join(c,p){return{kind:'runner',at:{x:p.seat*2,y:0,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(){}});`);
    } else if (runaway === 'rewind-stream') {
      // Stormbreak's reduction: a wide, continuously changing aim sample, a moving
      // target, reliable pulses and a held weapon cadence. A narrow stick-only
      // fixture never reached the relay's 2 KB cap when history was repeated.
      writeFileSync(join(dir,'src/view.ts'), `import {openRoom} from '@homie-rocks/studio/rules/view';openRoom();`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-1000,-1000,0],max:[1000,1000,20]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,map:'./map',shapes:{effects:{shot:{aim:f.fix(),y:f.fix(),hit:f.bit()},hit:{target:f.ref()}}},entities:{runner:{player:true,input:{ax:f.held(),fire:f.bit(),tap:f.pulse(),swap:f.pulse(),aimTick:f.fix(),aimY:f.fix(),${Array.from({length:16},(_,i)=>`look${i}:f.fix()`).join(',')}},fields:{shots:f.u16(),next:f.tick(),swaps:f.list(f.u8(),64)},body:{shape:'capsule',radius:.4,height:1.8,maxSpeed:8},tick(w,s){if(s.input.swap)s.swaps=[...s.swaps,s.input.swap];if((s.input.fire||s.input.tap)&&w.tick>=s.next){s.next=w.tick+4;s.shots++;const h=w.ray({x:0,y:s.input.aimY,z:1},{x:1,y:0,z:0},18,{kind:'target',atTick:s.input.aimTick});w.emit('shot',s.id,{aim:s.input.aimTick,y:s.input.aimY,hit:!!h},{to:s.id});if(h)w.emit('hit',s.id,{target:h.entity},{to:s.id});}}},target:{body:{shape:'box',radius:.15,height:2,maxSpeed:2}}},room:{historySeconds:1,rewindSeconds:.25,bots:{keep:0},join(){return{kind:'runner',at:{x:-2,y:0,z:0}};},start(w){w.spawn('target',{x:8,y:0,z:0});}}});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.pos={x:b.pos.x+i.ax*6.4*c.dt,y:0,z:0};},target(b,i,c){b.pos={x:8,y:c.tick*.1,z:0};b.vel={x:0,y:2,z:0};}});`);
    } else if (runaway === 'history') {
      writeFileSync(join(dir,'src/view.ts'),`import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();room.command('shoot',{at:room.viewTick,y:0});`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-100,-100,0],max:[100,100,20]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';export default defineRules({contract:2,space:{dims:3},move,map:'./map',shapes:{commands:{shoot:{at:f.fix(),y:f.fix()},block:{}},events:{block:{}}},entities:{runner:{player:true,fields:{hit:f.ref(),current:f.ref()},body:{shape:'capsule',radius:.4,height:1.8,maxSpeed:0},commands:{shoot(w,s,e){const from={x:0,y:e.y,z:1},d={x:1,y:0,z:0};s.hit=w.ray(from,d,18,{atTick:e.at,where:{hp:{gt:0}}})?.entity??'';s.current=w.ray(from,d,18,{where:{hp:{gt:0}}})?.entity??'';},block(w,s){for(const c of w.near(s.pos,64,'cover'))w.dispatch(c.id,'block');}}},target:{fields:{hp:f.u8({init:100})},body:{shape:'box',radius:.15,height:2,maxSpeed:2}},cover:{fields:{solid:f.bit(),hp:f.u8({init:100}),size:f.vec3({init:{x:1,y:100,z:3}})},collider:{enabled:'solid',size:'size'},body:{shape:'box',radius:.5,height:3,maxSpeed:0},on:{block(w,s){s.solid=true;}}}},room:{historySeconds:1,bots:{keep:0},join(c,p){return{kind:'runner',at:{x:-2,y:p.seat*4,z:0}};},start(w){w.spawn('target',{x:8,y:0,z:0});w.spawn('cover',{x:4,y:0,z:0});}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(){},target(b,i,c){b.pos={x:8,y:c.tick*.1,z:0};}});`);
    } else if (runaway === 'sequence') {
      writeFileSync(join(dir,'src/view.ts'),`import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();room.command('shoot');`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-20,-20,0],max:[20,20,20]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,map:'./map',shapes:{commands:{shoot:{},snapshot:{},retry:{}},events:{retry:{},damage:{amount:f.u8(),owner:f.ref()},credit:{}}},entities:{runner:{player:true,fields:{label:f.text(40),hits:f.list(f.ref(),8),credit:f.u8()},body:{shape:'capsule',radius:.4,height:1.8,maxSpeed:0},on:{credit(w,s){s.credit++;}},commands:{retry(w,s){w.sendRoom('retry');},snapshot(w,s){s.label=w.label(s.id);const scene=w.rays({where:{hp:{gt:0}}}),from={x:0,y:0,z:1},d={x:1,y:0,z:0},first=scene.ray(from,d,18);if(first?.entity)w.dispatch(first.entity,'damage',{amount:20,owner:s.id});s.hits=[scene.ray(from,d,18)?.entity??'',w.ray(from,d,18,{where:{hp:{gt:0}}})?.entity??''];},shoot(w,s){s.hits=[];for(let i=0;i<8;i++){const hit=w.ray({x:0,y:0,z:1},{x:1,y:0,z:0},18,{where:{hp:{gt:0}}});if(hit?.entity){s.hits=[...s.hits,hit.entity];w.dispatch(hit.entity,'damage',{amount:10,owner:s.id});}}}}},target:{body:{shape:'box',radius:.5,height:2,maxSpeed:0},collider:{enabled:'solid'},fields:{hp:f.u8({init:20}),solid:f.bit({init:true})},on:{damage(w,s,e){s.hp=Math.max(0,s.hp-e.amount);s.solid=s.hp>0;w.dispatch(e.owner,'credit');}}}},room:{on:{retry(w){w.round.restart();}},bots:{keep:0},join(c,p){return{kind:'runner',at:{x:-2,y:p.seat*4,z:0}};},start(w){w.spawn('target',{x:4,y:0,z:0});w.spawn('target',{x:8,y:0,z:0});w.spawn('target',{x:12,y:0,z:0});}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(){}});`);
    } else if (runaway === 'admission') {
      writeFileSync(join(dir,'src/view.ts'),`import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();room.command('accept');`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-100,-100],max:[100,100]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,map:'./map',shapes:{commands:{accept:{}}},entities:{runner:{player:{away:'think',leave:'bot',control:'accepted',takeover:'fitness'},fields:{fitness:f.fix(),hp:f.u8({init:73}),ammo:f.u8({init:7})},motion:{accepted:f.bit({init:true})},input:{ax:f.i8()},body:{shape:'circle',radius:.4,maxSpeed:4},think(){return {ax:1};},on:{takeover(w,s){s.motion.accepted=false;}},commands:{accept(w,s){s.motion.accepted=true;}}}},room:{bots:{keep:6},rounds:{seconds:12,breakSeconds:1},join(c,p){return{kind:'runner',at:{x:0,y:p.seat*2,z:0},fields:{fitness:10-p.seat}};}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.pos={x:b.pos.x+i.ax*c.dt,y:b.pos.y,z:0};}});`);
    } else if (runaway === 'queries') {
      writeFileSync(join(dir,'src/view.ts'), `import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom();room.ray({x:0,y:0,z:1},{x:1,y:0,z:0},18,{geometryOnly:true});room.rayAll({x:0,y:0,z:1},{x:1,y:0,z:0},18,{where:{hp:{gt:0}}});`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-20,-20,0],max:[20,20,20]},boxes:[{min:[12,-2,0],max:[13,2,3]}]}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,map:'./map',
shapes:{commands:{shoot:{mode:f.u8()}},events:{}},
entities:{runner:{player:true,body:{shape:'capsule',radius:.42,height:1.8,maxSpeed:4},motion:{ray:f.fix()},fields:{dist:f.fix(),part:f.text(16),count:f.u8(),deadTargets:f.u8()},
commands:{shoot(w,s,e){s.deadTargets=0;for(const target of w.near(s.pos,18)){if(target.kind==='target'&&target.hp===0)s.deadTargets++;}const origin={x:e.mode===8?10:0,y:e.mode>=10?.3:0,z:e.mode===1||e.mode>=10?1.85:e.mode===6?1.95:1};const opts=e.mode===10?{profile:'projectile',where:{hp:{gt:0}}}:e.mode===8?{geometryOnly:true}:e.mode===9?{geometryOnly:true,radius:.3,shape:'box' as const}:e.mode===7?{layer:'absent'}:e.mode===2?{geometryOnly:true}:e.mode===3?{entitiesOnly:true,kind:'target',tag:'fighter',layer:'actors',where:{hp:{gt:0}}}:e.mode===4?{geometryOnly:true,ignore:w.near(origin,20,'cover').map(e=>e.id)}:e.mode===5?{ignoreSelf:false,entitiesOnly:true,kind:'runner'}:{where:{hp:{gt:0}}};const hit=w.ray(origin,{x:1,y:0,z:0},e.mode===12?100:18,opts);s.dist=hit?hit.dist:-1;s.part=hit&&hit.part?hit.part:'';s.count=w.rayAll(origin,{x:1,y:0,z:0},18,opts).length;} }},
target:{body:{shape:'capsule',radius:.42,height:1.8,maxSpeed:0},query:{layer:'actors',tags:['fighter'],profiles:{projectile:{body:{shape:'box',radius:.42,height:1.9}}},parts:{body:{shape:'box',radius:.42,height:1.5},head:{shape:'box',radius:.24,height:.4,offset:{x:0,y:0,z:1.5}}}},fields:{hp:f.fix({init:100})}},
cover:{body:{shape:'box',radius:.5,height:3,maxSpeed:0},collider:true,motion:{ray:f.fix(),selfRay:f.fix()},fields:{hp:f.fix({init:100})}}},
room:{bots:{keep:0},join(c,p){return{kind:'runner',at:{x:1,y:p.seat*5,z:0}};},start(w){w.spawn('target',{x:4,y:0,z:0},{hp:0});w.spawn('target',{x:8,y:0,z:0});w.spawn('cover',{x:10,y:0,z:0});}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){const h=c.world.ray({x:0,y:0,z:1},{x:1,y:0,z:0},18,{geometryOnly:true});b.motion.ray=h?h.dist:-1;},cover(b,i,c){const from={x:b.pos.x,y:b.pos.y,z:b.pos.z+1},d={x:1,y:0,z:0};b.motion.ray=c.world.ray(from,d,8)?.dist??-1;b.motion.selfRay=c.world.rayAll(from,d,8,{ignoreSelf:false})[0]?.dist??-1;}});`);
    } else if (runaway === 'cover' || runaway === 'cover2' || runaway === 'terrain') {
      const dims = runaway === 'cover2' ? 2 : 3;
      const terrainMap=JSON.parse(readFileSync(join(PKG,'test/fixtures/stormbreak-terrain/map.json'),'utf8'));
      if(runaway==='terrain')terrainMap.heightTiles=terrainMap.heightTiles.map(t=>({...t,base:0}));
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify(runaway==='terrain'?terrainMap:{bounds:{min:[-20,-20,0],max:[20,20,20]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:${dims}},move,
shapes:{commands:{shoot:{direction:f.i8()},edit:{mode:f.u8()},place:{at:f.vec3()}},events:{edit:{mode:f.u8()}}},
entities:{runner:{player:true,fields:{ray:f.fix({init:-1})},input:{ax:f.i8(),ay:f.i8(),jump:f.press(),dash:f.bit(),dive:f.press(),launch:f.press(),hover:f.bit(),camera:f.bit()},motion:{difference:f.fix(),camera:f.fix(),support:f.fix(),blocked:f.bit()},body:{shape:'${dims===3?'capsule':'circle'}',radius:.4,height:1.8,maxSpeed:26,terrain:'exact'},
commands:{shoot(w,s,e){const hit=w.ray({x:s.pos.x,y:s.pos.y,z:s.pos.z+1},{x:e.direction,y:0,z:0},8);s.ray=hit?hit.dist:-1;},place(w,s,e){w.place(s,e.at);},edit(w,s,e){for(const c of w.near(s.pos,64,'cover'))w.send(c.id,'edit',e);if(e.mode===4)w.spawn('cover',{x:0,y:0,z:0});}}},
cover:{fields:{solid:f.bit({init:true}),size:f.vec3({init:{x:1,y:4,z:2.6}})},body:{shape:'${dims===3?'box':'circle'}',radius:.5,height:2.6,maxSpeed:0},collider:{size:'size',enabled:'solid'},
on:{edit(w,s,e){if(e.mode===0)s.solid=false;if(e.mode===1)s.solid=true;if(e.mode===2)s.size={x:2,y:4,z:2.6};if(e.mode===3)w.despawn(s);if(e.mode===5)w.place(s,{x:0,y:0,z:1});if(e.mode===6)w.place(s,{x:32,y:0,z:0});}}}},
room:{bots:{keep:0},join(c,p){return{kind:'runner',at:{x:-2,y:p.seat,z:0}};},start(w){w.spawn('cover',{x:0,y:0,z:0});${runaway==='terrain'?"for(let i=0;i<16;i++)w.spawn('cover',{x:40,y:20+i,z:0});":''}}},map:'./map'});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){
if(i.camera){const shape=c.world.rays({geometryOnly:true,radius:.4,height:1.8,shape:'capsule',terrain:'exact'}),scratch={pos:{...b.pos},grounded:b.grounded},reference={pos:{...b.pos},grounded:b.grounded};shape.sweep(scratch,{x:.1,y:.1,z:-.2});c.world.sweep(reference,{x:.1,y:.1,z:-.2});b.motion.difference=c.math.len(c.math.sub(scratch.pos,reference.pos));const scene=c.world.rays({geometryOnly:true,radius:.3,shape:'box'});b.motion.camera=6;for(const hit of scene.rayAll({x:b.pos.x,y:b.pos.y,z:b.pos.z+1.45},{x:-1,y:-1,z:-.2},6))b.motion.camera=Math.min(b.motion.camera,hit.dist);return;}
const support=c.world.support(b,20);b.motion.support=support?support.dist:20;b.motion.blocked=c.world.overlaps(b);
b.grounded=Boolean(c.world.support(b));if(i.hover)return;let vz=b.vel.z;
if(i.jump&&b.grounded)vz=12;
if(i.launch&&b.grounded&&!b.motion.blocked)vz=17;
if(i.dive&&!b.grounded&&b.motion.support>=1.8)vz=-26;
vz=${dims===3?'vz-22*c.dt':'0'};b.vel={x:i.ax*(i.dash?22:1),y:0,z:vz};
const delta={x:b.vel.x*c.dt,y:i.ay*c.dt,z:0};const before={x:b.pos.x,y:b.pos.y,z:b.pos.z};const hit=c.world.sweep(b,delta);
if(hit&&hit.normal.z>.5){const rest=c.math.sub(delta,c.math.sub(b.pos,before));c.world.sweep(b,c.math.sub(rest,c.math.scale(hit.normal,c.math.dot(rest,hit.normal))));}
c.world.sweep(b,{x:0,y:0,z:b.vel.z*c.dt});if(b.grounded)b.vel={x:b.vel.x,y:0,z:0};
}});`);
    } else if (runaway === 'pose') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100, 0], max: [100, 100, 3] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,shapes:{commands:{launch:{}}},entities:{runner:{player:true,motion:{launch:f.tick(),phase:f.u8()},input:{az:f.i8()},body:{shape:'capsule',radius:.4,height:1.7,maxSpeed:6},commands:{launch(w,s){s.motion.launch=w.tick;}}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){
        if(b.motion.launch){const age=c.tick-b.motion.launch;b.motion.phase=Math.min(20,age);if(age===1)b.pos={x:b.pos.x+4,y:0,z:0};b.grounded=age>=10;b.vel={x:0,y:0,z:age<10?1:0};b.pos={x:b.pos.x,y:0,z:age<10?age*.1:0};}
        else b.pos={x:0,y:0,z:b.pos.z+i.az/127};
      }});`);
    } else if (runaway === 'counter-knock') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100,-100], max: [100,100] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,map:'./map',shapes:{commands:{launch:{}}},entities:{runner:{player:true,input:{dash:f.pulse()},motion:{launch:f.tick(),dash:f.tick()},body:{shape:'circle',radius:.44,maxSpeed:36},commands:{launch(w,s){s.motion.launch=w.tick;}}}},room:{bots:{keep:0},join(){return{kind:'runner',at:{x:0,y:0,z:0}};}}});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){if(i.dash&&!b.motion.dash)b.motion.dash=c.tick;const d=b.motion.dash,k=b.motion.launch;const vx=!d&&k&&c.tick-k<=8?9:0,vy=d&&c.tick-d<8?-9:0;b.vel={x:vx,y:vy,z:0};b.pos=c.math.add(b.pos,c.math.scale(b.vel,c.dt));}});`);
    } else if (runaway === 'knock') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100, 0], max: [100, 100, 3] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,shapes:{commands:{launch:{}}},entities:{runner:{player:true,motion:{launch:f.tick()},body:{shape:'capsule',radius:.4,height:1.7,maxSpeed:6},commands:{launch(w,s){s.motion.launch=w.tick;}}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir, 'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules'; export const move=defineMove({runner(b,i,c){
const age=c.tick-b.motion.launch; b.vel={x:b.motion.launch&&age>0&&age<=8?24:0,y:0,z:0}; b.pos=c.math.add(b.pos,c.math.scale(b.vel,c.dt));
}});`);
    } else if (runaway === 'press') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-1000, -1000], max: [1000, 1000] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,entities:{runner:{player:true,motion:{jumps:f.u8()},input:{ax:f.i8(),jump:f.press()},body:{shape:'circle',radius:.5,maxSpeed:6}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){if(i.jump)b.motion.jumps+=1;b.pos={x:b.pos.x+i.ax/127*6*c.dt,y:b.motion.jumps,z:0};}});`);
    } else if (runaway === 'round3' || runaway === 'round3-open') {
      // 0.46.3: effects with an audience, an input averaged over its tick, predicted own actions, a capped rewind.
      writeFileSync(join(dir,'src/view.ts'),`import {openRoom} from '@homie-rocks/studio/rules/view';const room=openRoom({predict:{runner(me,input,ctx){if(input.swap)me.weapon=1-me.weapon;if(input.fire)ctx.effect('hit',me.id,{target:''});}}});room.command('shout',{to:''});room.input({ax:1,swap:true});`);
      writeFileSync(join(dir,'map/main.json'),JSON.stringify({bounds:{min:[-100,-100,0],max:[100,100,20]}}));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules';import {move} from './move';
export default defineRules({contract:2,space:{dims:3},move,map:'./map',
shapes:{commands:{shout:{to:f.ref()},shoot:{at:f.fix(),y:f.fix()}},events:{},effects:{ping:{n:f.u8()},whisper:{n:f.u8()},tell:{n:f.u8()},hit:{target:f.ref()}}},
entities:{runner:{player:true,input:{ax:f.held(),swap:f.press(),build:f.press(),fire:f.press(),tap:f.pulse(),snipe:f.press(),aimY:f.fix(),aimTick:f.fix()},fields:{sniped:f.u16(),weapon:f.u8(),builds:f.u8({init:2}),shots:f.u8(),hit:f.ref(),cool:f.tick(),taps:f.u8()},body:{shape:'capsule',radius:.4,height:1.8,maxSpeed:8},
tick(w,s){if(s.input.snipe){s.sniped++;const h=w.ray({x:0,y:s.input.aimY,z:1},{x:1,y:0,z:0},18,{kind:'mover',atTick:s.input.aimTick});if(h&&h.entity)w.emit('hit',s.id,{target:h.entity},{to:s.id});}if(s.input.swap)s.weapon=1-s.weapon;if(s.input.build&&s.builds>0){s.builds--;w.spawn('cover',{x:s.pos.x+2,y:s.pos.y,z:0});}if(s.input.fire){s.shots++;const h=w.ray({x:s.pos.x,y:s.pos.y,z:1},{x:0,y:1,z:0},10,{kind:'target'});if(h&&h.entity)w.emit('hit',s.id,{target:h.entity},{to:s.id});}if(s.input.tap){s.weapon=1-s.weapon;if(s.cool<=w.tick){s.cool=w.tick+6;s.taps++;w.emit('hit',s.id,{target:'tap'},{to:s.id});}}},
commands:{shout(w,s,e){w.emit('ping',s.pos,{n:1});w.emit('whisper',s.pos,{n:2},{within:5});w.emit('tell',s.id,{n:3},{to:[e.to]});},shoot(w,s,e){s.hit=w.ray({x:0,y:e.y,z:1},{x:1,y:0,z:0},18,{atTick:e.at,kind:'mover'})?.entity??'';}}},
target:{body:{shape:'box',radius:.5,height:2,maxSpeed:0}},mover:{body:{shape:'box',radius:.15,height:2,maxSpeed:2}},cover:{body:{shape:'box',radius:.5,height:2,maxSpeed:0}}},
room:{historySeconds:1,${runaway === 'round3' ? 'rewindSeconds:.25,' : ''}bots:{keep:0},join(c,p){return{kind:'runner',at:{x:p.seat===2?40:p.seat*3,y:0,z:0}};},start(w){w.spawn('target',{x:0,y:4,z:0});w.spawn('mover',{x:8,y:0,z:0});}}});`);
      writeFileSync(join(dir,'src/move.ts'),`import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.pos={x:b.pos.x+i.ax*6.4*c.dt,y:b.pos.y,z:0};},mover(b,i,c){b.pos={x:8,y:c.tick*.1,z:0};b.vel={x:0,y:.1/c.dt,z:0};}});`);
    } else if (runaway === 'push' || runaway === 'push-effects' || runaway === 'diagonal-push') {
      writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-1000, -1000], max: [1000, 1000] } }));
      writeFileSync(file, `import {defineRules,f} from '@homie-rocks/studio/rules'; import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,shapes:{commands:{bump:{}}${runaway==='push-effects'?',effects:{hit:{}}':''}},entities:{runner:{player:true,motion:{push:f.ticks()},input:{ax:f.i8()},body:{shape:'circle',radius:.5,maxSpeed:${runaway==='diagonal-push'?30:6}},commands:{bump(world,self){self.motion.push=world.ticks(.4);${runaway==='push-effects'?"world.emit('hit',self.id,{});":''}}}}},room:{bots:{keep:0},join(){return {kind:'runner',at:{x:0,y:0,z:0}}}},map:'./map'});`);
      writeFileSync(join(dir,'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({runner(b,i,c){b.vel={x:i.ax/127*6,y:${runaway==='diagonal-push'?20:0},z:0};if(b.motion.push>0){b.motion.push-=1;b.vel={x:0,y:${runaway==='diagonal-push'?20:12},z:0};}c.map.sweep(b,c.math.scale(b.vel,c.dt));}});`);
    } else writeFileSync(file, readFileSync(file, 'utf8').replace('commands: {},', 'commands: { boom: {} },').replace('fields: { score:', 'commands: { boom(world, self) { self.bomb = true; } }, fields: { bomb: f.bit(), score:').replace('tick(world, self) {', 'tick(world, self) { if (self.bomb) { while (true) {} }'));
  }
  const g = { ...json('game.json'), room: { host: mode, offline, tickHz, predict, view: { radiusM } }, dir };
  // This suite measures protocol outcomes on virtual time. The 60 Hz case uses the same checked fixture without
  // asking a busy parallel test runner to meet a 17 ms wall-clock build deadline (rules-build tests own that check).
  const rules = await prepareRuntimeFixture(esbuild, scratch, { ...g, room: { ...g.room, tickHz: 20 } });
  const L = await loadGame(scratch, dir, 'coin-dash');
  const compiled = L.R.compileRules(L.def, { tune: json('tunables.json'), map: L.R.compileMap(JSON.parse(readFileSync(join(dir, 'map/main.json'), 'utf8'))), settings: L.R.roomSettings(g.room).settings, seats });
  rules.settings = compiled.settings;
  rules.schema = L.R.schemaOf(compiled);
  const entry = join(scratch, 'entry.ts');
  writeFileSync(entry, `import { openRoom, blendHeading } from ${JSON.stringify(join(PKG, 'rules', 'view.ts'))};\n(globalThis as any).__openRoom = openRoom; (globalThis as any).__blendHeading = blendHeading;\n${mode === 'browser' ? "import { makeHost } from 'homie:host'; (globalThis as any).__makeHost = makeHost;" : ''}\n`);
  const file = join(scratch, `view-${mode}-${offline}-${tickHz}-${runaway}-${++viewBuild}.mjs`);
  await esbuild.build({ entryPoints: ['homie:view'], bundle: true, format: 'esm', platform: 'neutral', outfile: file, logLevel: 'silent', plugins: [viewPlugin(g, rules, entry)] });
  await import(pathToFileURL(file).href);
  const result = { L, compiled, openRoom: globalThis.__openRoom, makeHost: globalThis.__makeHost, bundle: readFileSync(file, 'utf8') };
  if (mode === 'server' && !offline && tickHz === 20 && !runaway && radiusM === null && seats === 8) kit = result;
  return result;
}

/** A relay with the server as host, on the test's clock, and sockets to it. */
function rig(L, compiled, mode = false, lag = 0, uplink = 0) {
  const browser = mode === true;
  const extra = typeof mode === "object" ? mode : {};
  const lines = [];
  const relay = () => new NetRoom({ code: 'r', rules: true, maxPlayers: compiled.seats, tickHz: compiled.settings.tickHz, log: (l) => lines.push(l) });
  let room = relay();
  const host = L.H.createHost({ game: 'coin-dash', compiled, send: (m, text) => room.hostFrame(m, text), log: (l) => lines.push(l), random: () => 0.37, clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) }, ...extra });
  if (!browser) room.setServerHost(host);
  const beat = setInterval(() => room.tick(), 250);
  const sockets = [];
  const network = { up: true };
  const socket = () => class MemorySocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
      this.link = sockets.length; sockets.push(this);
      this.h = room.attach({ send: (x) => { const delay = typeof lag === 'function' ? lag(JSON.parse(x), this.link) : lag; if (delay !== null) setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: x }); }, delay); }, close: () => { setTimeout(() => this.cut(), 0); }, buffered: () => 0 });
      setTimeout(() => { if (network.up) { this.readyState = 1; this.onopen?.({}); } }, 0);
    }
    send(x) { this.sent.push(JSON.parse(x)); const delay = typeof uplink === 'function' ? uplink(JSON.parse(x), this.link) : uplink; if (delay === null) return; if (delay) setTimeout(() => this.h?.onMessage(x), delay); else this.h?.onMessage(x); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose(); }
    cut() { if (this.readyState === 3) return; this.readyState = 3; this.h?.onClose('error'); this.onclose?.({}); }
  };
  return {
    get room() { return room; }, host, lines, sockets, socket, network, stop: () => { clearInterval(beat); host.stop(); },
    /** The relay is replaced by one with no memory (a Worker restart with nothing saved) and every socket drops. */
    restart() { room = relay(); for (const s of [...sockets]) s.cut(); },
  };
}
/**
 * The same, for a room large enough to use Gates (0.46.3): every browser's socket ends at one of two Gates, and each
 * Gate has one ordered channel to the room, `hop` ms each way. What a player receives is what its Gate sent it.
 */
function gateRig(L, compiled, mode = false, lag = 0, uplink = 0, hop = 4) {
  const lines = [];
  const plain = () => { const events = new Map(); return { accept() {}, addEventListener(t, fn) { const list = events.get(t) ?? []; list.push(fn); events.set(t, list); }, emit(t, value) { for (const fn of events.get(t) ?? []) fn(value); }, send() {}, close(code, reason) { this.closed = [code, reason]; this.emit('close', {}); } }; };
  const room = new NetRoom({ code: 'r', rules: true, maxPlayers: compiled.seats, tickHz: compiled.settings.tickHz, log: (l) => lines.push(l) });
  const host = L.H.createHost({ game: 'coin-dash', compiled, send: (m, text) => room.hostFrame(m, text), log: (l) => lines.push(l), random: () => 0.37, clock: { now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) } });
  room.setServerHost(host);
  const beat = setInterval(() => room.tick(), 250);
  const gates = [0, 1].map(() => {
    const gateEnd = plain(), roomEnd = plain();
    gateEnd.send = (text) => setTimeout(() => roomEnd.emit('message', { data: text }), hop);
    roomEnd.send = (text) => setTimeout(() => gateEnd.emit('message', { data: text }), hop);
    multiplexSession(roomEnd, async (req, client) => {
      const h = room.attach({ send: (text) => client.send(text), close: (code, why) => client.close(code, why), buffered: () => client.buffered(), snapshotGroup: client.snapshotGroup, subscribe: (seat) => client.subscribe(seat), transportFacts: client.transportFacts });
      client.addEventListener('message', (e) => h.onMessage(e.data, e.receivedAt));
      client.addEventListener('close', () => h.onClose('close'));
    });
    return new Gate({ waitUntil() {} }, { TABLE: { idFromName: (n) => n, get: () => ({ fetch: async () => ({ webSocket: gateEnd }) }) } });
  });
  const sockets = [];
  const socket = () => class GateSocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
      this.link = sockets.length; sockets.push(this);
      const server = this.server = plain();
      const parsed = (x) => { try { return JSON.parse(x); } catch { return { t: 'snap' }; } };
      server.send = (x) => { const delay = typeof lag === 'function' ? lag(parsed(x), this.link) : lag; if (delay !== null) setTimeout(() => { if (this.readyState === 1) this.onmessage?.({ data: x }); }, delay); };
      server.close = () => { setTimeout(() => { if (this.readyState !== 3) { this.readyState = 3; this.onclose?.({}); } }, 0); };
      gates[this.link % gates.length].connect(new Request(`https://table/__net?game=coin-dash&room=r&gates=2&gate=${this.link % gates.length}`), server).then(() => { this.readyState = 1; this.onopen?.({}); });
    }
    send(x) { this.sent.push(JSON.parse(x)); const delay = typeof uplink === 'function' ? uplink(JSON.parse(x), this.link) : uplink; if (delay === null) return; if (delay) setTimeout(() => this.server.emit('message', { data: x }), delay); else this.server.emit('message', { data: x }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.server.emit('close', {}); }
  };
  return { room, host, lines, sockets, socket, gates, stop: () => { clearInterval(beat); host.stop(); } };
}
const cfg = (who) => ({ v: 1, url: 'ws://relay/coin-dash/__net?room=r', room: 'r', device: 'desk', want: 'play', name: who });

test('two views in one server-hosted room: own bodies, the roster and the round, input that the server follows, and a full round nobody can forge', async (t) => {
  const { L, compiled, openRoom, bundle } = await coinDashKit();
  assert.doesNotMatch(bundle, /world\.spawn|"take"/, 'the bundle holds no handler of the rules');
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  t.after(() => r.stop());
  const open = (who) => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('Ada');
  assert.equal(a.status, 'connecting', 'openRoom returns at once');
  const b = open('Bo');
  const heard = { a: { ding: 0, enter: 0, leave: 0, rounds: [], placed: 0, status: [] }, b: { ding: 0, rounds: [] } };
  a.on('ding', (e) => { heard.a.ding += 1; assert.equal(typeof e.at.x, 'number'); });
  a.on('enter', () => { heard.a.enter += 1; });
  a.on('leave', () => { heard.a.leave += 1; });
  a.on('placed', () => { heard.a.placed += 1; });
  a.on('round', (x) => heard.a.rounds.push(x));
  a.on('status', (s) => heard.a.status.push(s));
  b.on('ding', () => { heard.b.ding += 1; });
  b.on('round', (x) => heard.b.rounds.push(x));
  t.after(() => { a.close(); b.close(); });
  await clock.wait(600);

  // Both are playing, seated, and neither is host: the server is.
  assert.deepEqual([a.status, b.status], ['playing', 'playing']);
  assert.deepEqual(heard.a.status, ['playing']);
  assert.deepEqual([a.seat, b.seat], [0, 1]);
  assert.deepEqual([a.net.role, b.net.role, a.net.isHost, b.net.isHost], ['replica', 'replica', false, false]);
  assert.deepEqual(a.net.host, { id: 'server', seat: null });
  assert.equal(r.room.hostId, null);
  assert.deepEqual([a.me.kind, a.me.mine, a.me.seat, a.me.driver, a.me.score], ['runner', true, 0, 'person', 0]);
  assert.equal(b.me.seat, 1);
  assert.deepEqual(a.roster.map((x) => [x.seat, x.name, x.driver, x.me]), [[0, 'Ada', 'person', true], [1, 'Bo', 'person', false], [6, 'Echo', 'bot', false], [7, 'Wren', 'bot', false]]);
  assert.equal(a.round.phase, 'live');
  assert.equal(a.round.n, 1);
  assert.ok(a.round.secondsLeft > 58 && a.round.secondsLeft <= 60, `the clock is the room's: ${a.round.secondsLeft} s left`);
  assert.deepEqual(a.shared, {});
  assert.equal(a.map.spots.start.length, 8);
  assert.equal(a.tune.speed, 6);
  let coins = 0;
  a.each('coin', () => { coins += 1; });
  assert.ok(coins > 10 && coins <= 16, `${coins} coins are drawn`);
  assert.ok(heard.a.enter >= coins + 4);

  // Ada holds right for a second. Her own body goes at once; the server follows it, held to its top speed.
  const x0 = a.me.pos.x;
  const serverX = () => r.host.core.snapshot()[1].find((w) => w[9] === 0)[3][0];
  const sx0 = serverX();
  const sent0 = r.sockets[0].sent.filter((m) => m.t === 'in').length;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(60);
  assert.ok(a.me.pos.x > x0, 'the stick answers on the next step, without waiting for the server');
  await clock.wait(940);
  const run = a.me.pos.x - x0;
  assert.ok(run > 5.2 && run <= 6.4, `she ran ${run} m in a second at 6 m/s`);
  const frames = r.sockets[0].sent.filter((m) => m.t === 'in').slice(sent0);
  assert.ok(frames.length >= 3 && frames.length <= 6, `${frames.length} input frames in a second: at most one a tick`);
  for (const f of frames) {
    assert.equal(f.e, r.host.epoch);
    assert.ok(f.s.length >= 1 && f.s.length <= 64);
    assert.equal(f.s.at(-1)[3], -471, 'versioned sequence and control-change trailer');
    assert.deepEqual(f.s.at(-1).slice(1, 3), [127, 0]);
  }
  assert.ok(frames.every((f,i)=>i===0 || f.k+f.s.at(-1)[0]>=frames[i-1].k+frames[i-1].s.at(-1)[0]),'newest stamps rise while history repeats');
  await clock.wait(200);
  const followed = serverX() - sx0;
  assert.ok(followed > 5 && followed <= 6 * 1.25 + 0.1, `the server moved her body ${followed} m`);
  assert.equal(r.host.core.stats.errors, 0);
  assert.ok(r.room.lastSnap.c.find((row) => row[0] === 0)[2] > 0, 'her input is acknowledged by its stamp');
  // Bo's view draws her there too, a little in the past.
  let seenByBo = null;
  b.each('runner', (e) => { if (e.seat === 0) seenByBo = e; });
  assert.ok(seenByBo && !seenByBo.mine);
  assert.ok(Math.abs(seenByBo.pos.x - serverX()) < 2.5, `Bo sees her at ${seenByBo.pos.x}, the server has her at ${serverX()}`);
  // Standing still: nothing is sent but a keepalive, about four a second.
  a.input({ ax: 0, ay: 0 });
  await clock.wait(300);
  const idle0 = r.sockets[0].sent.filter((m) => m.t === 'in').length;
  await clock.wait(2000);
  const idle = r.sockets[0].sent.filter((m) => m.t === 'in').length - idle0;
  assert.ok(idle >= 6 && idle <= 10, `${idle} frames in two idle seconds`);

  // A view that says what only a host may say changes nothing: the helper will not send it, and the relay would not take it.
  const before = JSON.stringify(r.room.lastRound);
  assert.equal(a.net.snapshot([[9, 0, 0], []], 999, true), false);
  a.net.round({ n: 1, phase: 'over', startedAt: 0, endsAt: 1, results: [{ slot: 0, seat: 0, name: 'Ada', score: 999, bot: false, place: 1 }] });
  assert.equal(a.net.state('shared', [999]), false);
  r.sockets[0].send(JSON.stringify({ t: 'round', round: { n: 1, phase: 'over', startedAt: 0, endsAt: 1, results: [{ slot: 0, seat: 0, name: 'Ada', score: 999, bot: false, place: 1 }] } }));
  r.sockets[0].send(JSON.stringify({ t: 'state', k: 'shared', d: [999] }));
  await clock.wait(100);
  assert.equal(JSON.stringify(r.room.lastRound), before);
  assert.equal(b.round.phase, 'live');
  assert.ok(b.roster.every((x) => x.score < 20));

  // The rest of the round: the bots take coins (each a ding on both views), then the server's results reach both.
  await clock.wait(57_500);
  assert.ok(heard.a.ding >= 10 && heard.a.ding === heard.b.ding, `${heard.a.ding} dings on one view, ${heard.b.ding} on the other`);
  assert.ok(heard.a.leave >= 10, 'a taken coin leaves the view');
  const overA = heard.a.rounds.at(-1);
  const overB = heard.b.rounds.at(-1);
  assert.equal(overA.phase, 'over');
  assert.equal(overA.results.length, 4);
  assert.deepEqual(overA.results, overB.results, 'both views have the server\'s results');
  assert.deepEqual(overA.results, r.room.lastRound.results);
  assert.equal(overA.results.reduce((n, x) => n + x.score, 0), 16, 'every coin was scored once');
  assert.ok(overA.results.every((x) => x.score !== 999));
  assert.deepEqual(a.roster.map((x) => x.score).sort(), overA.results.map((x) => x.score).sort(), 'the board is the server\'s scores');
  // The break, then round 2: the server places every body, and each view jumps its own.
  const placed = heard.a.placed;
  await clock.wait(9000);
  assert.equal(a.round.n, 2);
  assert.equal(a.round.phase, 'live');
  assert.ok(heard.a.placed > placed, 'placed by the server at the round\'s start');
  assert.deepEqual(a.roster.filter((x) => x.driver === 'person').map((x) => x.score), [0, 0], 'the scores started again (the bots are already at the new coins)');
  const spot = a.map.spots.start[0];
  assert.ok(Math.abs(a.me.pos.x - spot.x) < 0.01 && Math.abs(a.me.pos.y - spot.y) < 0.01, 'back on her start spot');
  assert.equal(r.host.core.stats.errors, 0);
  assert.equal(r.lines.filter((l) => l.ev === 'failed').length, 0);
});

test('a watcher follows server bodies, returns to Auto on leave and follows the same seat on reconnect', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit();
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  let token;
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: (m) => { if (m.what === 'token') token = m.token; } } });
  const w = openRoom({ net: { config: { ...cfg('Watcher'), watch: true, follow: 'auto' }, WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); w.close(); });
  await clock.wait(600);
  assert.equal(w.seat, null);
  assert.equal(w.net.isHost, false);
  const id = b.me.id;
  w.follow(id);
  assert.equal(w.net.viewSeat, b.seat);
  assert.ok(w.get(id));
  b.close(); await clock.wait(100);
  assert.equal(w.net.following, 'auto');
  const back = openRoom({ net: { config: { ...cfg('Second'), token }, WebSocketImpl: r.socket(), post: null } });
  t.after(() => back.close());
  await clock.wait(600);
  assert.equal(back.me.id, id);
  assert.equal(w.net.viewSeat, back.seat);
  w.follow(null); assert.equal(w.net.viewSeat, null);
});

test('a restored epoch past 32 bits reaches the view and its input reaches the host unchanged', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit(); const clock = virtualTime(t);
  const seed = rig(L, compiled); const saved = seed.host.save(); seed.stop();
  const r = rig(L, compiled, { restore: saved, restoreEpoch: 4294967296 });
  const view = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { view.close(); r.stop(); });
  await clock.wait(600); view.input({ ax: 127, ay: 0 }); await clock.wait(300);
  const inputs = r.sockets[0].sent.filter((m) => m.t === 'in');
  assert.ok(inputs.length > 0); assert.ok(inputs.every((m) => m.e === 4294967296));
  assert.ok(r.host.facts().ins > 0, 'the host accepts the untruncated epoch');
});

test('browser hosts run the same rules, hand the round to the other browser, and finish it with bots', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t);
  const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(600);
  assert.deepEqual([a.status, b.status], ['playing', 'playing']);
  assert.deepEqual([a.net.rulesHosting, b.net.rulesHosting], [true, false]);
  assert.deepEqual([a.seat, b.seat], [0, 1]);
  const x = b.me.pos.x;
  b.input({ ax: -127, ay: 0 });
  await clock.wait(1000);
  assert.ok(b.me.pos.x < x - 4);
  b.input({ ax: 0, ay: 0 });
  await clock.wait(2400);
  await clock.wait(375);
  const n = b.round.n;
  const left = b.round.secondsLeft;
  assert.ok(r.room.lastCkpt?.d?.data?.core, 'the complete runtime has a relay checkpoint');
  r.sockets[0].cut();
  a.close();
  await clock.wait(1000);
  assert.equal(b.net.rulesHosting, true);
  assert.ok(Math.abs(r.room.lastRound.endsAt - (Date.now() + (r.room.lastSnap.d[0][2] - r.room.lastSnap.k) * 50)) < 100, 'the relay deadline follows the restored tick');
  assert.equal(b.round.n, n);
  assert.ok(b.round.secondsLeft < left && b.round.secondsLeft > left - 2, 'handover keeps the round timer');
  assert.equal(b.status, 'playing');
  const rounds = [];
  b.on('round', (round) => rounds.push(round));
  await clock.wait(65_000);
  const over = rounds.find((round) => round.phase === 'over' && round.results);
  assert.ok(over, 'the elected browser finishes the round');
  assert.equal(over.results.reduce((sum, row) => sum + row.score, 0), 16);
  assert.equal(b.round.n, 2);
  assert.deepEqual(b.roster.filter((row) => row.driver === 'person').map((row) => row.seat), [1], 'the expired held seat is freed by the relay');
  assert.equal(r.lines.filter((line) => line.ev === 'failed').length, 0);
});

for (const mode of ['server', 'browser']) test(`${mode} rules play offline with a local body, input and bots`, async (t) => {
  const { openRoom } = await coinDashKit(mode, true);
  const clock = virtualTime(t);
  const a = openRoom({ net: { config: null, post: null } });
  t.after(() => a.close());
  await clock.wait(600);
  assert.equal(a.status, 'playing');
  assert.equal(a.net.rulesHosting, true);
  assert.equal(a.net.connected, false);
  assert.equal(a.me.driver, 'person');
  assert.equal(a.roster.filter((row) => row.driver === 'bot').length, 3);
  const x = a.me.pos.x;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(1000);
  assert.ok(a.me.pos.x > x + 4);
  a.input({ ax: 0, ay: 0 });
  const rounds = [];
  a.on('round', (round) => rounds.push(round));
  await clock.wait(61_000);
  assert.equal(rounds.find((round) => round.phase === 'over' && round.results)?.results.reduce((sum, row) => sum + row.score, 0), 16);
});

test('private server rules do not offer offline play', async (t) => {
  const { openRoom, bundle } = await coinDashKit();
  assert.doesNotMatch(bundle, /world\.spawn/);
  const clock = virtualTime(t);
  const a = openRoom({ net: { config: null, post: null } });
  t.after(() => a.close());
  await clock.wait(2000);
  assert.equal(a.net.rulesHosting, false);
  assert.equal(a.me, null);
  assert.equal(a.status, 'offline');
});


test('a lost server room falls back locally, reports no offline progress, then rejoins the server', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000);
  assert.equal(a.net.rulesHosting, false);
  r.network.up = false;
  r.sockets[0].cut();
  await clock.wait(6500);
  assert.equal(a.net.rulesHosting, true);
  assert.equal(a.status, 'playing');
  const frames = () => r.sockets.flatMap((s) => s.sent).filter((m) => ['snap', 'round', 'roster', 'ckpt', 'state'].includes(m.t));
  assert.deepEqual(frames(), []);
  a.input({ ax: 127, ay: 0 });
  await clock.wait(1000);
  assert.deepEqual(frames(), [], 'offline scores, state, snapshots and saves never go to the relay');
  r.network.up = true;
  // The pending silent socket times out, then the existing reconnect path opens another.
  await clock.wait(30_000);
  assert.equal(a.net.connected, true);
  assert.equal(a.net.rulesHosting, false, 'the local timer is stopped before using the server again');
  assert.equal(a.net.host.id, 'server');
  assert.deepEqual(frames(), []);
});


test('a sixty-tick browser host sends a snapshot a tick inside the relay allowance', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true, 60);
  const clock = virtualTime(t);
  const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2000);
  const before = r.room.lastSnap.k;
  const sent = r.sockets[0].sent.length;
  await clock.wait(1000);
  assert.ok(r.room.lastSnap.k - before >= 58, 'the simulation keeps sixty ticks a second');
  const snapshots = r.sockets[0].sent.slice(sent).filter((m) => m.t === 'snap');
  assert.ok(snapshots.length >= 59 && snapshots.length <= 61, `${snapshots.length} snapshots a second`);
  assert.equal(b.status, 'playing');
});


test('offline rules prefetch waits for playable and a closed view cannot start a late loader', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit();
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  let loads = 0;
  let starts = 0;
  let deliver;
  const pending = new Promise((resolve) => { deliver = resolve; });
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'server', offline: true, load: () => { loads += 1; return pending; } } } });
  t.after(() => { a.close(); r.stop(); });
  assert.equal(loads, 0);
  await clock.wait(1);
  assert.equal(loads, 0, 'a welcome is not a playable snapshot');
  await clock.wait(500);
  assert.equal(a.status, 'playing');
  assert.equal(loads, 1);
  a.close();
  deliver(() => { starts += 1; throw new Error('a closed view started a host'); });
  await clock.wait(100);
  assert.equal(starts, 0);
  const b = openRoom({ net: { config: null, post: null,
    rulesHost: { mode: 'server', offline: true, load: () => pending } } });
  b.close();
  await clock.wait(100);
  assert.equal(starts, 0, 'closing during offline startup also cancels the pending host');
});

test('promotion replaces a poisoned checkpoint and publishes the fresh round', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2200);
  r.room.lastCkpt.d.data.core.ents = {};
  r.sockets[0].cut(); a.close();
  await clock.wait(1500);
  assert.equal(b.net.rulesHosting, true);
  assert.equal(b.status, 'playing');
  assert.ok(Array.isArray(r.room.lastCkpt.d.data.core.ents));
  assert.ok(r.room.lastCkpt.k > 0);
  assert.ok(r.room.lastRound.endsAt > Date.now());
});

test('a failed browser runtime ends the room without electing its checkpoint again', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true, 20, true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1200);
  a.command('boom');
  await clock.wait(6000);
  assert.equal(r.room.hostId, null);
  assert.equal(r.room.lastCkpt, null);
  assert.equal(a.net.rulesHosting, false);
  assert.equal(b.net.rulesHosting, false);
  assert.equal(a.net.link, 'closed');
  assert.equal(b.net.link, 'closed');
  const fresh = openRoom({ net: { config: cfg('Fresh'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => fresh.close()); await clock.wait(500);
  assert.equal(fresh.net.rulesHosting, true);
  assert.equal(fresh.status, 'playing');
});

for (const offline of [true, false]) test(`a hidden solo host pauses and resumes, offline=${offline}`, async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const listeners = new Map();
  const previous = globalThis.document;
  globalThis.document = { hidden: false, removeEventListener() {}, addEventListener: (name, fn) => listeners.set(name, [...(listeners.get(name) ?? []), fn]) };
  const a = openRoom({ net: { config: offline ? null : cfg('Solo'), WebSocketImpl: r.socket(), post: null } });
  let currentTick = 0; a.net.on('snapshot', (s) => { currentTick = s.k; });
  t.after(() => { a.close(); r.stop(); if (previous) globalThis.document = previous; else delete globalThis.document; });
  await clock.wait(1000);
  globalThis.document.hidden = true; listeners.get('visibilitychange').forEach((fn) => fn());
  const tick = currentTick;
  await clock.wait(10000);
  assert.equal(currentTick, tick);
  assert.equal(a.net.rulesHosting, true);
  globalThis.document.hidden = false; listeners.get('visibilitychange').forEach((fn) => fn());
  await clock.wait(1000);
  assert.equal(currentTick, tick + 20);
});

test('a module that cannot load leaves no host without a runtime', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'browser', offline: true, load: () => { throw new Error('module unavailable'); } } } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(3000);
  assert.equal(a.net.rulesHosting, false); assert.equal(a.net.role, 'replica');
  assert.notEqual(a.net.link, 'closed'); assert.equal(r.room.hostId, null);
});

test('server reconnect survives an unavailable offline module', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t); const r = rig(L, compiled);
  const posts = [];
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: (m) => posts.push(m),
    rulesHost: { mode: 'server', offline: true, load: () => Promise.reject(new Error('offline chunk unavailable')) } } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(9000);
  assert.notEqual(a.net.link, 'closed');
  assert.match(posts.filter(m => m.what === 'line').at(-1)?.text, /needs a connection/i);
  r.network.up = true; await clock.wait(30000);
  assert.equal(a.net.connected, true); assert.equal(a.status, 'playing');
});

for (const frameType of ['snap', 'ckpt', 'state', 'ev', 'round', 'roster']) test(`a present seat ignores a delayed free and ${frameType} size failure is visible and terminal`, async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const posts = []; const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: (m) => posts.push(m) } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts.push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1000);
  r.sockets[0].onmessage({ data: JSON.stringify({ t: 'free', seat: a.seat }) });
  await clock.wait(200); assert.equal(a.me?.driver, 'person');
  r.sockets[0].send(JSON.stringify({ t: frameType, rules: true, d: 'x'.repeat(frameType === 'ckpt' ? 70000 : 17000) }));
  await clock.wait(500);
  assert.equal(a.net.rulesHosting, false); assert.equal(a.net.link, 'closed');
  assert.match(warnings.join(' '), /size cap/);
  assert.equal(b.net.link, 'closed'); assert.equal(r.room.hostId, null);
  assert.match(posts.filter(m => m.what === 'line').at(-1)?.text, /size|cap/);
});

for (const jump of [-10000, 30000]) test(`local snapshots keep rising when the wall clock moves ${jump} ms`, async (t) => {
  const { openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const wallNow = Date.now;
  let shift = 0; Date.now = () => wallNow() + shift;
  performance.now = () => wallNow() - 1000000;
  t.after(() => { Date.now = wallNow; });
  const a = openRoom({ net: { config: null, post: null } }); t.after(() => a.close());
  const snaps = []; a.net.on('snapshot', s => snaps.push(s));
  await clock.wait(1000); const before = snaps.at(-1);
  shift = jump; await clock.wait(1000);
  assert.equal(snaps.at(-1).k, before.k + 20);
  assert.ok(snaps.at(-1).st > before.st);
  assert.ok(a.net.sample().b.k >= before.k + 15, 'the rendered picture advances too');
  shift = 0; await clock.wait(1000);
  assert.equal(snaps.at(-1).k, before.k + 40);
  assert.ok(a.net.sample().b.k >= before.k + 35, 'clock correction also keeps rendering');
});

test('a solo online save survives a forgotten relay without uploading later offline progress', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('Solo'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(20000);
  r.network.up = false; r.sockets[0].cut();
  await clock.wait(6000);
  const savedTick = r.room.lastCkpt.k;
  let returnedTick = 0; a.net.on('snapshot', s => { if (r.network.up && a.net.connected && !returnedTick) returnedTick = s.k; });
  await clock.wait(65000);
  r.network.up = true; await clock.wait(30000);
  assert.equal(a.net.connected, true); assert.equal(a.me?.driver, 'person');
  assert.ok(returnedTick >= savedTick - 30 && returnedTick < savedTick + 300, 'the pre-offline save resumes');
});

test('browser rules carry reserved guides, validated goals, asks, answers and companion pacing', async (t) => {
  const { source, vocab: baseVocab } = await import('./rules-feature-kit.mjs');
  const vocab = { ...baseVocab, asks: { ...baseVocab.asks, no_thanks: { text: 'No thanks', leave: true } } };
  const { writeGame } = await import('./rules-kit.mjs');
  const dir = writeGame(scratch, 'browser-features', { rules: source });
  mkdirSync(join(dir, 'map'), { recursive: true });
  writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100], max: [100, 100] } }));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(vocab));
  const g = { id: 'browser-features', dir, players: { max: 4 }, room: { host: 'browser' } };
  const esbuild = await esbuildOf(); const rules = await prepareRuntimeFixture(esbuild, scratch, g);
  const L = await loadGame(scratch, dir, g.id);
  const c = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), settings: rules.settings, seats: 4 });
  const entry = join(scratch, 'features-view.ts'); writeFileSync(entry, `export { openRoom } from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  const file = join(scratch, 'features-view.mjs');
  await esbuild.build({ stdin: { contents: `import 'homie:game'; export { openRoom } from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: file, plugins: [viewPlugin(g, rules, entry)] });
  const { openRoom } = await import(pathToFileURL(file).href);
  const clock = virtualTime(t); const r = rig(L, c, true);
  r.room.setVocabulary(vocab); r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 1, bots: 'fill', brain: 'workers-ai' });
  r.room.decider = async () => ({ ok: true, by: 'ai', picks: { advance: false } });
  const a = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1200);
  assert.equal(a.net.rulesHosting, true);
  const saved = () => r.room.lastCkpt.d.data;
  assert.equal(saved().core.shared[1], 0, 'the remote decision reaches the rules rather than the floor');
  const guide = saved().core.ents.find(e => e[12] === 'ai' && e[11] === 3);
  assert.ok(guide); assert.equal(guide[17][2], 1, 'the reserved guide has a valid goal');
  const goals = []; a.on('goal', g => goals.push(g));
  let body; a.each('pawn', e => { if (e.seat === 3) body = e; });
  assert.ok(a.askButtons(body.id).some(b => b.k === 'visit' && b.args.place === 'camp'));
  a.ask(body.id, 'follow', { seat: 0 });
  await clock.wait(300);
  assert.ok(r.sockets[0].sent.some(m => m.k === 'agent:goal' && m.d?.goal?.goal === 'follow'));
  assert.ok(goals.some(g => g.goal?.goal === 'follow'), 'the hosting view receives its own goal');
  a.net.checkpointNow();
  const before = saved().core.ents.find(e => e[11] === 3)[17][0];
  await clock.wait(1000); a.net.checkpointNow();
  assert.equal(saved().core.ents.find(e => e[11] === 3)[17][0], before, 'an asked goal carries without repeating the floor');
});

test('a persistently slow visible browser yields to another ready player', async (t) => {
  const { L, compiled, openRoom, makeHost } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('Slow'), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'browser', offline: true, load: async () => o => makeHost({ ...o, now: () => performance.now() / 20 }) } } });
  const b = openRoom({ net: { config: cfg('Ready'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(8500);
  assert.equal(a.net.rulesHosting, false); assert.equal(b.net.rulesHosting, true);
  assert.equal(b.status, 'playing');
});

test('a failed offline runtime still reconnects to its healthy server room', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', true, 20, true);
  const clock = virtualTime(t); const r = rig(L, compiled);
  const posts = [];
  const a = openRoom({ net: { config: cfg('One'), WebSocketImpl: r.socket(), post: m => posts.push(m) } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(6000); assert.equal(a.net.rulesHosting, true);
  a.command('boom'); await clock.wait(3000);
  assert.equal(a.net.rulesHosting, false); assert.notEqual(a.net.link, 'closed');
  assert.match(posts.filter(m => m.what === 'line').at(-1).text, /offline|connection/i);
  r.network.up = true; await clock.wait(30000);
  assert.equal(a.net.connected, true); assert.equal(a.status, 'playing');
});


test('two equally slow browsers keep one host after measuring both', async (t) => {
  const { L, compiled, openRoom, makeHost } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null,
    rulesHost: { mode: 'browser', offline: true, load: async () => o => makeHost({ ...o, now: () => performance.now() / 20 }) } } });
  const a = open('First'); const b = open('Second');
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(40000);
  assert.ok(r.room.stats.promotions <= 1, `promotions: ${r.room.stats.promotions}`);
});

test('a held person retains identity and body across browser promotion', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('First'); const b = open('Held'); const c = open('Next');
  t.after(() => { a.close(); b.close(); c.close(); r.stop(); });
  await clock.wait(1000); const id = b.me.id;
  b.close(); await clock.wait(600); a.close(); await clock.wait(1200);
  assert.equal(c.get(id)?.driver, 'person');
  assert.equal(c.roster.find(s => s.seat === 1)?.name, 'Held');
});

async function featureKit(id, mode, mutate = s => s, tickHz = 20) {
  const { source, vocab: baseVocab } = await import('./rules-feature-kit.mjs');
  const vocab = { ...baseVocab, asks: { ...baseVocab.asks, no_thanks: { text: 'No thanks', leave: true } } };
  const { writeGame } = await import('./rules-kit.mjs');
  const dir = writeGame(scratch, id, { rules: mutate(source) });
  mkdirSync(join(dir, 'map'), { recursive: true });
  writeFileSync(join(dir, 'map/main.json'), JSON.stringify({ bounds: { min: [-100, -100], max: [100, 100] } }));
  writeFileSync(join(dir, 'agents.json'), JSON.stringify(vocab));
  const g = { id, dir, players: { max: 4 }, room: { host: mode, tickHz } };
  const esbuild = await esbuildOf(); const rules = await prepareRuntimeFixture(esbuild, scratch, g);
  const L = await loadGame(scratch, dir, id);
  const compiled = L.R.compileRules(L.def, { map: L.R.compileMap(rules.map), settings: rules.settings, seats: 4 });
  const entry = join(scratch, `${id}.ts`); writeFileSync(entry, `export { openRoom } from ${JSON.stringify(join(PKG, 'rules/view.ts'))};`);
  const file = join(scratch, `${id}.mjs`);
  await esbuild.build({ stdin: { contents: `import 'homie:game'; export { openRoom } from ${JSON.stringify(entry)};`, resolveDir: scratch }, bundle: true, format: 'esm', outfile: file, plugins: [viewPlugin(g, rules, entry)] });
  return { L, compiled, vocab, ...(await import(pathToFileURL(file).href)) };
}

for (const maxSpeed of [0, 100]) test(`movement probes derive stationary controls from the declared player speed ${maxSpeed}`, async t => {
  const { L, compiled, openRoom } = await featureKit(`movement-probe-${maxSpeed}`, 'server', s => {
    s = s.replace('maxSpeed: 100', `maxSpeed: ${maxSpeed}`);
    return maxSpeed === 0 ? s.replace('body.pos.x + input.ax / 100', 'body.pos.x') : s;
  });
  const clock = virtualTime(t); const r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(600);
  assert.equal(globalThis.__homieNet.probe.movement(), maxSpeed === 0 ? 'stationary' : 'spatial');
  assert.equal(a.status, 'playing');
  assert.equal(a.net.role, 'replica');
  const before = a.me.pos.x;
  a.input({ ax: 100 }); await clock.wait(600);
  if (maxSpeed === 0) assert.equal(a.me.pos.x, before, 'stationary rules use a no-op move and still receive real inputs');
  else assert.ok(a.me.pos.x > before, 'moving rules remain subject to movement checks');
});

for (const path of ['server', 'replica', 'hosting']) test(`public view session has the same results through ${path}`, async t => {
  const browser = path !== 'server';
  const { L, compiled, vocab, openRoom } = await featureKit(`public-${path}`, browser ? 'browser' : 'server', s => s.replace('commands: { done: {}, ask: {} }', 'effects: { pulse: {} }, commands: { done: {}, ask: {} }').replace('self.level = world.level;', "self.level = world.level; world.emit('pulse', self.pos, {});"));
  const clock = virtualTime(t); const r = rig(L, compiled, browser);
  r.room.setVocabulary(vocab); r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 1, bots: 'fill', brain: 'workers-ai' });
  r.room.decider = async () => ({ ok: true, by: 'ai', picks: { advance: true } });
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('First'); const b = open('Second'); const watcher = open('Watcher');
  const view = path === 'replica' ? b : a;
  const heard = { say: [], ask: [], goal: [], pulse: [] };
  for (const key of Object.keys(heard)) view.on(key, e => heard[key].push(e));
  const others = []; watcher.on('say', e => others.push(e));
  t.after(() => { a.close(); b.close(); watcher.close(); r.stop(); });
  await clock.wait(1200);
  let guide; view.each('pawn', e => { if (e.seat === 3) guide = e; });
  assert.ok(guide);
  assert.deepEqual(view.askButtons(guide.id).map(b => [b.k, b.args]), [['visit', { place: 'camp' }], ['follow', { seat: view.seat }], ['no_thanks', {}]]);
  assert.deepEqual(a.roster.map(s => [s.name, s.driver]), b.roster.map(s => [s.name, s.driver]));
  assert.ok(view.roster.filter(s => s.driver === 'ai').every(s => s.name.includes('AI')));
  assert.ok(heard.say.some(e => e.text === 'Hello!'));
  view.ask(guide.id, 'follow', { seat: view.seat });
  await clock.wait(300);
  assert.equal(heard.ask.at(-1).k, 'follow'); assert.equal(heard.goal.at(-1).goal.goal, 'follow');
  assert.equal(view.get(guide.id).goal.asked, true);
  view.command('ask'); await clock.wait(300); assert.ok(view.me.answered >= 1); assert.equal(view.shared.yes, true);
  assert.ok(heard.pulse.length > 20);
  let directDecision; view.net.decide({}, { ready: { type: 'noul', instructions: 'Ready?' } }, { floor: () => ({ ready: false }) }).then(r => { directDecision = r; });
  await clock.wait(100);
  assert.equal(directDecision?.why, 'not-host', 'a view never starts a second decision owner beside its runtime');
  view.net.send('say', { text: 'My own line', seat: 99 });
  await clock.wait(100);
  assert.equal(heard.say.find(e => e.text === 'My own line')?.seat, view.seat);
  assert.equal(others.find(e => e.text === 'My own line')?.seat, view.seat);
  b.net.send('say', { text: 'From second', ai: true, slot: 3 });
  await clock.wait(100);
  for (const events of [heard.say, others]) {
    const line = events.find(e => e.text === 'From second'); assert.equal(line?.seat, b.seat); assert.equal(line.ai, undefined); assert.equal(line.slot, -1, 'ordinary speech cannot impersonate an AI slot');
  }
  watcher.net.send('say', { text: 'From watcher' }); await clock.wait(100);
  assert.equal(heard.say.find(e => e.text === 'From watcher')?.seat, null);
  view.ask(guide.id, 'no_thanks'); await clock.wait(100);
  const goalsBefore = heard.goal.length;
  view.ask(guide.id, 'follow', { seat: view.seat }); await clock.wait(100);
  assert.equal(heard.goal.length, goalsBefore);
  r.room.setPolicy({ ...r.room.policy, speech: 'off' }); await clock.wait(50);
  a.net.send('say', { text: 'Muted' }); b.net.send('say', { text: 'Muted' }); await clock.wait(100);
  assert.ok(!heard.say.some(e => e.text === 'Muted'));
  const oldState = view.shared; assert.equal(view.net.state('shared', [999]), false);
  view.net.round({ n: 999 }); view.net.roster([]);
  assert.deepEqual(view.shared, oldState); assert.notEqual(view.round.n, 999);
  await clock.wait(1500);
  assert.deepEqual(a.round.results, b.round.results);
});

test('sixty ticks of effects per second reach both views without drops or elections', async t => {
  const { L, compiled, openRoom } = await featureKit('fx-sixty', 'browser', s => s.replace('commands: { done: {}, ask: {} }', 'effects: { pulse: { tick: f.u32() } }, commands: { done: {}, ask: {} }').replace('self.level = world.level;', "self.level = world.level; world.emit('pulse', self.pos, { tick: world.tick });").replace('seconds: 3', 'seconds: 60'), 60);
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  const counts = [0, 0]; a.on('pulse', () => counts[0]++); b.on('pulse', () => counts[1]++);
  await clock.wait(20000);
  assert.equal(r.room.stats.drops, 0); assert.equal(r.room.stats.promotions, 0);
  assert.ok(counts[1] >= 1190 * 2, `${counts[1]} effects received`);
  assert.ok(Math.abs(counts[0] - counts[1]) <= 40);
});

test('shared state that grows after build stops every page with the measured cap', async t => {
  const payload = JSON.stringify(Array(1024).fill(4000000000));
  const { L, compiled, openRoom } = await featureKit('state-growth', 'browser', s => s.replace('commands: { done: {}, ask: {} }', 'events: { grow: {} }, commands: { grow: {}, done: {}, ask: {} }').replace('answers: f.u16()', 'big: f.list(f.u32(), 1024), bigger: f.list(f.u32(), 1024), answers: f.u16()').replace('commands: { done(world', `commands: { grow(world) { world.sendRoom('grow', {}); }, done(world`).replace('on: { answer(world, e)', `on: { grow(world) { world.shared.big = ${payload}; world.shared.bigger = ${payload}; }, answer(world, e)`));
  const clock = virtualTime(t); const r = rig(L, compiled, true); const posts = [[], []];
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: m => posts[0].push(m) } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts[1].push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1000); a.command('grow'); await clock.wait(1000);
  assert.equal(a.net.link, 'closed'); assert.equal(b.net.link, 'closed'); assert.equal(r.room.stats.promotions, 0);
  for (const p of posts) assert.match(p.filter(m => m.what === 'line').at(-1).text, /state is \d+ B; the cap is 8192 B/);
});

test('runtime bursts drain without dropping output or ending the room', async t => {
  const { L, compiled, openRoom, makeHost } = await coinDashKit('browser', true);
  let output;
  const clock = virtualTime(t); const r = rig(L, compiled, true); const posts = [[], []];
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: m => posts[0].push(m), rulesHost: { mode: 'browser', offline: true, load: async () => o => { output = o.send; return makeHost(o); } } } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts[1].push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1000);
  for (let i = 0; i < 140; i++) output({ t: 'ev', k: 'say', d: { text: 'A burst' } });
  await clock.wait(1000);
  assert.equal(a.net.link, 'online'); assert.equal(b.net.link, 'online'); assert.equal(r.room.stats.promotions, 0);
  assert.equal(r.sockets[0].sent.filter(m => m.t === 'ev' && m.d?.text === 'A burst').length, 140);
  assert.equal(r.room.stats.drops, 0);
});

test('public browser views preserve the whole round through handover', async t => {
  const { L, compiled, vocab, openRoom } = await featureKit('public-handover', 'browser', s => s
    .replace('seconds: 3', 'seconds: 60')
    .replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}')
    .replace('floors: f.u16()', 'score: f.u16({ score: true }), dice: f.u32(), floors: f.u16()')
    .replace('self.level = world.level;', 'self.level = world.level; self.score += 1; self.dice = Math.floor(world.random() * 1000000);'));
  const clock = virtualTime(t);
  t.mock.method(Math, 'random', () => 0.37);
  const runs = [false, true].map(handover => {
    const r = rig(L, compiled, true);
    r.room.setVocabulary(vocab);
    r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 0, bots: 'fill', brain: 'workers-ai' });
    // Keep the request pending over the election; the rule's own deadline supplies its floor.
    r.room.decider = () => new Promise(() => {});
    const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
    const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
    const frames = new Map(); const lines = [];
    b.net.on('snapshot', s => frames.set(s.k, structuredClone(s.d)));
    b.on('say', e => lines.push(e.text));
    t.after(() => { a.close(); b.close(); r.stop(); });
    return { r, a, b, frames, lines, handover };
  });
  await clock.wait(600);
  for (const { a } of runs) {
    let guide; a.each('pawn', e => { if (e.seat === 3) guide = e; });
    a.ask(guide.id, 'follow', { seat: 1 });
    a.command('ask');
  }
  await clock.wait(150);
  const changed = runs[1];
  const before = { roster: changed.b.roster.map(s => [s.seat, s.name, s.driver]), round: changed.b.round.n };
  changed.a.net.checkpointNow();
  changed.r.sockets[0].send(JSON.stringify({ t: 'yield' }));
  await clock.wait(5500);
  assert.equal(changed.b.net.rulesHosting, true);
  assert.equal(changed.a.net.rulesHosting, false);
  assert.deepEqual(changed.b.roster.map(s => [s.seat, s.name, s.driver]), before.roster);
  assert.equal(changed.b.round.n, before.round);
  assert.ok(Math.abs(changed.b.round.endsAt - runs[0].b.round.endsAt) < 150);
  const common = [...changed.frames.keys()].filter(k => k > 16 && runs[0].frames.has(k));
  assert.ok(common.length > 15);
  for (const tick of common) assert.deepEqual(changed.frames.get(tick), runs[0].frames.get(tick), `public state at tick ${tick}: scores, dice, bodies, goals and clock`);
  assert.deepEqual(changed.b.shared, runs[0].b.shared);
  assert.ok(changed.a.me.answered > 0, 'the carried decision reaches its original body');
  assert.ok(runs[0].lines.includes('Hello!'), 'the comparison observes guide speech');
  assert.deepEqual(changed.lines, runs[0].lines, 'guide speech keeps its pacing');
});

for (const damage of ['field', 'queue', 'name', 'answer']) test(`public browser handover rejects a damaged ${damage} checkpoint and starts fresh`, async t => {
  const { L, compiled, vocab, openRoom } = await featureKit(`public-bad-${damage}`, 'browser', s => s.replace('seconds: 3', 'seconds: 60'));
  const clock = virtualTime(t); const r = rig(L, compiled, true); const posts = [];
  r.room.setVocabulary(vocab);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: m => posts.push(m) } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1500); a.net.checkpointNow(); await clock.wait(1);
  const bad = structuredClone(r.room.lastCkpt.d);
  const save = bad.data;
  if (damage === 'field') save.core.ents[0][17][0] = -99;
  if (damage === 'queue') save.queues.push([0, { ax: 999 }, null, 1, 1]);
  if (damage === 'name') save.names[0][1] = 'x'.repeat(41);
  if (damage === 'answer') save.core.queue.push([save.core.tick + 1, 0, '', save.core.seq++, '', 'room', 'answer', { ask: 'director', by: 'ai', picks: { advance: 'forged' } }, save.core.tick, 1]);
  r.sockets[0].send(JSON.stringify({ t: 'ckpt', rules: true, k: r.room.lastCkpt.k, d: bad }));
  r.sockets[0].send(JSON.stringify({ t: 'yield' }));
  await clock.wait(500);
  assert.equal(b.net.rulesHosting, true); assert.equal(b.status, 'playing');
  assert.ok(posts.some(m => m.what === 'line' && /new round/i.test(m.text)));
  assert.ok(b.net.latest().k < 20, 'a damaged round is replaced, not repaired');
});

for (const kind of ['react', 'say', 'vote', 'ping', 'in', 'ev', 'unknown']) test(`hosting player's ${kind} allowance and refusal match a replica`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t), r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2100);
  const clients = [...r.room.clients.values()];
  for (const c of clients) { c.rates.clear(); c.drops = []; }
  const frame = { t: kind, k: kind === 'ev' ? 'emote:wave' : 'heart', text: 'Hello', op: 'level', value: 2, c: 1, s: [] };
  for (const socket of r.sockets.slice(0, 2)) for (let i = 0; i < 65; i++) socket.send(JSON.stringify(frame));
  assert.equal(clients[0].drops.length, clients[1].drops.length);
  assert.ok(clients[0].drops.length > 0);
  await clock.wait(500);
  assert.equal(a.net.link, 'online'); assert.equal(b.net.link, 'online');
  assert.equal(r.room.stats.promotions, 0);
});

test('faulty reliable output hands over, excess snapshots only drop', async t => {
  const { L, compiled, openRoom } = await coinDashKit('browser', true);
  const clock = virtualTime(t), r = rig(L, compiled, true);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(2100);
  for (let i = 0; i < 100; i++) r.sockets[0].send(JSON.stringify({ t: 'snap', rules: true, k: 1, d: [] }));
  assert.equal(r.room.stats.promotions, 0);
  for (let i = 0; i < 30; i++) r.sockets[0].send(JSON.stringify({ t: 'round', rules: true, round: { n: 1, phase: 'live' } }));
  await clock.wait(1000);
  assert.equal(r.room.stats.promotions, 1); assert.equal(b.net.rulesHosting, true);
  assert.equal(a.net.link, 'online'); assert.equal(b.net.link, 'online');
});

const pendingDecisionGame = (s) => s.replace('seconds: 3', 'seconds: 60').replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}')
  .replace('floors: f.u16()', 'score: f.u16({ score: true }), dice: f.u32(), adv: f.u8(), by: f.u8(), floors: f.u16()').replace('on: { answer(world, self, e) { self.answered += 1; } }', "on: { answer(world, self, e) { self.answered += 1; self.adv = e.picks.advance ? 2 : 1; self.by = e.by === 'ai' ? 2 : 1; } }")
  .replace('self.level = world.level;', 'self.level = world.level; self.score += 1; self.dice = Math.floor(world.random() * 1000000);');
for (const answer of ['never (the floor at its deadline)', 'the relay answers 2 s after the handover', 'the relay refuses 1 s after the handover']) test(`a decision pending at a handover is answered exactly once: ${answer}`, async (t) => {
  const { L, compiled, vocab, openRoom } = await featureKit(`once-${answer.length}`, 'browser', pendingDecisionGame);
  const clock = virtualTime(t); t.mock.method(Math, 'random', () => 0.37);
  const r = rig(L, compiled, true); r.room.setVocabulary(vocab);
  r.room.setPolicy({ kind: 'beginner', guides: 1, aiSeats: 0, bots: 'fill', brain: 'workers-ai' });
  let asked = 0; let release = null;
  r.room.decider = () => { asked += 1; return new Promise((res) => { release = res; }); };
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1500);
  let guide; a.each('pawn', (e) => { if (e.seat === 3) guide = e; });
  a.ask(guide.id, 'no_thanks');                  // "leave me alone" from A
  b.ask(guide.id, 'follow', { seat: b.seat });   // B's ask: an asked goal carried by pacing
  await clock.wait(400);
  a.command('ask'); await clock.wait(200);
  const before = { tick: b.net.latest().k, score: a.me.score, bscore: b.me.score, goal: b.get(guide.id).goal?.goal, asked: b.get(guide.id).goal?.asked, roster: b.roster.map((s) => [s.seat, s.name, s.driver]), round: [b.round.n, b.round.phase], answers: b.shared.answers, answered: a.me.answered, endsAt: b.round.endsAt };
  assert.equal(before.answers, 0); assert.equal(asked, 1, 'one decide reached the relay before the handover');
  a.net.checkpointNow(); r.sockets[0].send(JSON.stringify({ t: 'yield' }));
  await clock.wait(1000);
  assert.equal(b.net.rulesHosting, true, 'B hosts'); assert.equal(a.net.rulesHosting, false);
  if (/answers/.test(answer)) { await clock.wait(1000); release({ ok: true, by: 'ai', picks: { advance: false } }); }
  if (/refuses/.test(answer)) { release({ ok: false, why: 'pace' }); }
  await clock.wait(9000);
  const after = { tick: b.net.latest().k, score: a.me.score, bscore: b.me.score, goal: b.get(guide.id).goal?.goal, asked: b.get(guide.id).goal?.asked, roster: b.roster.map((s) => [s.seat, s.name, s.driver]), round: [b.round.n, b.round.phase], answers: b.shared.answers, answered: a.me.answered, endsAt: b.round.endsAt };
  console.log(`[${answer}] before ${JSON.stringify(before)}\n   after ${JSON.stringify(after)}; decides the relay was asked ${asked}; decide frames from B ${r.sockets[1].sent.filter((m) => m.t === 'decide').length}; yes ${b.shared.yes}`);
  assert.equal(after.answered, 1, 'the asking body heard the answer once');
  assert.deepEqual(after.roster, before.roster); assert.deepEqual(after.round, before.round);
  assert.ok(Math.abs(after.endsAt - before.endsAt) < 150, `the round's clock: ${before.endsAt} -> ${after.endsAt}`);
  assert.ok(after.score > before.score && after.bscore > before.bscore, 'scores carried on');
  assert.equal(after.score - before.score, after.tick - before.tick, 'a score that counts ticks lost none and gained none');
  // "leave me alone" survives: A's ask is still refused; B's is taken
  const goalsBefore = b.get(guide.id).goal;
  a.ask(guide.id, 'follow', { seat: a.seat }); await clock.wait(400);
  assert.notEqual(b.get(guide.id).goal?.args?.seat, a.seat, 'the guide still leaves A alone');
  console.log(`   the answer the asking body got: advance ${a.me.adv === 2} by ${a.me.by === 2 ? 'ai' : 'floor/local'}`);
  if (/answers/.test(answer)) { assert.equal(a.me.by, 2, 'the AI answer, not the floor'); assert.equal(a.me.adv, 1, 'advance: false as the AI said (the floor says true)'); } else { assert.equal(a.me.by, 1); assert.equal(a.me.adv, 2); }
});


test('a sixty-second drop retries promptly while playing offline', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t), r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('Return'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(60000); assert.equal(a.net.offline, true); assert.equal(a.status, 'playing');
  r.network.up = true; await clock.wait(6500);
  assert.equal(a.net.link, 'online'); assert.equal(a.status, 'playing'); assert.equal(a.net.rulesHosting, false);
});


test('the browser online event retries a pending offline connection immediately', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', true);
  const clock = virtualTime(t), r = rig(L, compiled);
  const previous = globalThis.addEventListener; let online;
  globalThis.addEventListener = (type, fn) => { if (type === 'online') online = fn; };
  t.after(() => { if (previous) globalThis.addEventListener = previous; else delete globalThis.addEventListener; });
  const a = openRoom({ net: { config: cfg('Return'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(1000); r.network.up = false; r.sockets[0].cut();
  await clock.wait(60000); assert.equal(a.net.offline, true);
  r.network.up = true; online(); await clock.wait(100);
  assert.equal(a.net.link, 'online'); assert.equal(a.status, 'playing');
});

const pulses = s => s.replace('commands: { done: {}, ask: {} }', 'effects: { pulse: { tick: f.u32() } }, commands: { done: {}, ask: {} }')
  .replace('self.level = world.level;', "self.level = world.level; world.emit('pulse', self.pos, { tick: world.tick });")
  .replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}').replace('seconds: 3', 'seconds: 120');
/** What a third page is sent: every snapshot's tick in order of arrival, and how often each tick's effects came. */
function watch(socket) {
  const seen = { ticks: [], effects: new Map() };
  const deliver = socket.onmessage;
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'snap') seen.ticks.push(m.k);
    if (m.t === 'ev' && m.k === 'fx') seen.effects.set(m.d[0], (seen.effects.get(m.d[0]) ?? 0) + 1);
    deliver.call(socket, e);
  };
  return seen;
}
const rewind = (ticks) => ticks.reduce((worst, k, i) => Math.max(worst, i ? Math.max(...ticks.slice(0, i)) - k + 1 : 0), 0);

for (const hz of [20, 30, 60]) for (const how of ['yields', 'closes']) test(`a ${hz}-tick host that ${how} hands on its last tick: no page goes back and no effect plays twice`, async t => {
  const { L, compiled, openRoom } = await featureKit(`handover-${hz}-${how}`, 'browser', pulses, hz);
  const clock = virtualTime(t);
  // Ten moments across a tick and across the snapshot's allowance, each in a room of its own.
  for (let trial = 0; trial < 10; trial++) {
    // The relay's word takes 40 ms to come back: several ticks at any of these rates.
    const r = rig(L, compiled, true, 40);
    const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
    const a = open('First'); await clock.wait(300); const b = open('Second'); const c = open('Third');
    await clock.wait(1500 + trial * 7);
    assert.equal(a.net.rulesHosting, true);
    const seen = watch(r.sockets[2]); const from = r.sockets[0].sent.length;
    if (how === 'yields') assert.equal(a.net.handOff(), true); else a.close();
    await clock.wait(2500);
    const last = r.sockets[0].sent.slice(from).filter(m => ['ckpt', 'yield', 'bye'].includes(m.t)).map(m => m.t);
    assert.deepEqual(last.slice(0, 2), ['ckpt', how === 'yields' ? 'yield' : 'bye'], 'the checkpoint is on the wire before the role is given up');
    assert.equal(b.net.rulesHosting || c.net.rulesHosting, true); assert.equal(a.net.rulesHosting, false);
    assert.equal(rewind(seen.ticks), 0, `trial ${trial}: snapshot ticks ${seen.ticks.slice(0, 12)}`);
    assert.ok(seen.ticks.length > hz * 2, 'the next host carries on');
    assert.deepEqual([...seen.effects.values()].filter(n => n !== 1), [], 'each tick\'s effects arrive once');
    const ticks = [...seen.effects.keys()];
    for (let n = 1; n < ticks.length; n++) assert.equal(ticks[n], ticks[n - 1] + 1, 'and no tick\'s effects are missing');
    assert.equal(r.room.stats.drops, 0);
    if (how === 'yields') a.close(); b.close(); c.close(); r.stop();
  }
});

test('a yield the relay refuses costs nothing: the host carries on with every tick and effect in order', async t => {
  const { L, compiled, openRoom } = await featureKit('yield-refused', 'browser', pulses, 60);
  const clock = virtualTime(t); const r = rig(L, compiled, true, 40);
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(300);
  // The second page cannot host, so nobody can take the role.
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null, rulesHost: { mode: 'server', offline: false } } });
  t.after(() => { a.close(); b.close(); r.stop(); });
  await clock.wait(1500);
  const seen = watch(r.sockets[1]); const rounds = []; b.on('round', e => rounds.push(e.n));
  for (let n = 0; n < 3; n++) { assert.equal(a.net.handOff(), true); await clock.wait(700); }
  assert.equal(a.net.rulesHosting, true); assert.equal(r.room.stats.promotions, 0);
  assert.equal(rewind(seen.ticks), 0);
  assert.ok(seen.ticks.length >= 120, `${seen.ticks.length} snapshots in 2.1 s`);
  const ticks = [...seen.effects.keys()];
  assert.ok(ticks.length >= 120);
  for (let n = 1; n < ticks.length; n++) assert.equal(ticks[n], ticks[n - 1] + 1);
  assert.deepEqual([...seen.effects.values()].filter(n => n !== 1), []);
  assert.deepEqual(rounds, [], 'no round is announced again');
  assert.equal(r.room.stats.drops, 0);
});

test('a host that reconnects to a restarted relay says the round, roster and shared state again as rules output', async t => {
  const { L, compiled, openRoom } = await featureKit('relay-restart', 'browser', s => s.replace('seconds: 3, breakSeconds: 1', 'seconds: 4, breakSeconds: 1')
    .replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}').replace('on: { answer(world, e) {', 'on: { roundStart(world) { world.shared.answers += 7; }, answer(world, e) {'));
  const clock = virtualTime(t); const r = rig(L, compiled, true);
  // The same wait before each page knocks again, so the host, whose socket dropped first, is back first.
  t.mock.method(Math, 'random', () => 0.37);
  const open = who => openRoom({ net: { config: cfg(who), WebSocketImpl: r.socket(), post: null } });
  const a = open('First'); await clock.wait(800); const b = open('Second');
  let c = null;
  t.after(() => { a.close(); b.close(); c?.close(); r.stop(); });
  // Into the second round, so a relay that knew nothing would leave a replica on the first.
  await clock.wait(6500);
  assert.equal(a.net.rulesHosting, true); assert.equal(a.round.n, 2); assert.equal(a.round.phase, 'live'); assert.equal(b.round.n, 2);
  const shared = structuredClone(a.shared); assert.equal(shared.answers, 14);
  r.restart();
  await clock.wait(2500);
  assert.equal(a.net.connected, true); assert.equal(b.net.connected, true); assert.equal(a.net.rulesHosting, true); assert.equal(b.net.rulesHosting, false);
  assert.equal(a.round.n, 2, 'still the round it was');
  const held = { round: [r.room.lastRound?.n, r.room.lastRound?.phase], roster: r.room.lastRoster?.length, keys: [...r.room.state.keys()] };
  assert.deepEqual(held, { round: [a.round.n, a.round.phase], roster: a.roster.length, keys: ['shared'] }, 'the relay holds what the host holds');
  assert.equal(r.room.stats.drops, 0, 'nothing the host said was taken for a player\'s');
  assert.deepEqual([b.round.n, b.round.phase], [a.round.n, a.round.phase]); assert.deepEqual(b.shared, shared);
  assert.ok(Math.abs(b.round.endsAt - a.round.endsAt) < 100, 'the replica counts down with the host');
  c = open('Third'); await clock.wait(300);
  const welcome = r.sockets.at(-1); assert.equal(welcome.readyState, 1);
  assert.deepEqual([c.round?.n, c.round?.phase], [a.round.n, a.round.phase], 'a later joiner is welcomed with the live round');
  assert.deepEqual(c.shared, a.shared); assert.equal(c.roster.length, a.roster.length);
});

test('legacy speech keeps its published envelope even with arbitrary extra data', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit();
  const clock = virtualTime(t);
  const r = rig(L, compiled);
  t.after(() => r.stop());
  const view = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => view.close());
  const heard = [];
  view.on('say', e => heard.push(e));
  await clock.wait(600);
  r.room.broadcast({ t: 'ev', from: 0, k: 'say', d: { text: 'hello', line: 42, slot: 900, seat: 900 } });
  await clock.wait(10);
  assert.equal(heard.length, 1);
  assert.equal(heard[0].text, 'hello');
  assert.equal(heard[0].line, undefined);
  assert.equal(heard[0].seat, 0);
  assert.equal(heard[0].slot, -1);
});

for (const hz of [20, 30, 60]) for (const delay of [50, 150, 300]) test(`prediction: ${hz} ticks, ${delay} ms round trip, fresh input answers within a frame`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz);
  const clock = virtualTime(t), r = rig(L, compiled, false, delay / 2, delay / 2);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => a.close());
  await clock.wait(5000);
  const start = a.me.pos;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(16);
  assert.ok(a.me.pos.x > start.x, 'movement on the first drawn frame');
  const samples = [];
  for (let n = 0; n < 90; n++) { await clock.wait(16); samples.push(a.me.pos.x); }
  const backwards = samples.slice(1).filter((x, n) => x < samples[n] - 0.001);
  assert.equal(backwards.length, 0, `ordinary movement never rubber-bands: ${backwards.length} frames`);
  a.input({ ax: 0, ay: 0 }); await clock.wait(1500);
  const authoritative = r.host.core.snapshot()[1].find(e => e[9] === a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x - authoritative) < 0.001, 'server result wins after input settles');
  assert.equal(r.host.core.stats.errors, 0);
});

test('prediction: a late press stays predicted once until the authoritative press catches up', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'press');
  const clock=virtualTime(t);let extra=0;
  const r=rig(L,compiled,false,45,m=>m.t==='in'?45+extra:45);t.after(()=>r.stop());
  const a=openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});t.after(()=>a.close());
  await clock.wait(5000); extra=180;
  a.input({ax:0,jump:true});await clock.wait(60);
  assert.equal(a.me.motion.jumps,1);
  for(let i=0;i<20;i++){await clock.wait(16);assert.equal(a.me.motion.jumps,1,'a snapshot neither removes nor doubles the late press');}
  extra=0;await clock.wait(1000);
  assert.equal(a.me.motion.jumps,1);assert.equal(r.host.core.snapshot()[1].find(e=>e[9]===a.seat)[8][0],1);
});

for (const hz of [20, 60]) for (const delay of [150, 300]) test(`prediction clock: steering is not jitter at ${hz} Hz and ${delay} ms`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz);
  const clock = virtualTime(t), r = rig(L, compiled, false, delay / 2, delay / 2);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => a.close());
  const probe = globalThis.__homieNet.probe.prediction;
  await clock.wait(5000);
  const initial = probe();
  for (let n = 0; n < 80; n++) {
    await clock.wait(250);
    const p = probe();
    assert.equal(p.rebases, initial.rebases, 'a steady connection does not keep rebasing');
    assert.ok(p.lead < 2, `the clock's steering did not invent ${p.lead} ticks of network jitter`);
  }
});


for (const hz of [20, 60]) test(`prediction: overlapping corrections under dropped input at ${hz} Hz slow forward movement without reversing it`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz, 'press');
  const clock = virtualTime(t); let drops = 0, snapshots = 0;
  const r = rig(L, compiled, false, m => 300 + (m.t === 'snap' ? [0, 20, -20, 15, -15][snapshots++ % 5] : 0), m => m.t === 'in' && drops-- > 0 ? null : 300);
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => a.close());
  await clock.wait(12000);
  drops = 2; a.input({ ax: 127 });
  let previous = a.me.pos.x, backwards = 0;
  for (let n = 0; n < 190; n++) {
    await clock.wait(16);
    const x = a.me.pos.x;
    if (x - previous < -0.01) backwards++;
    previous = x;
  }
  const p = globalThis.__homieNet.probe.prediction();
  assert.ok(drops <= 0, 'the shaped connection dropped both input frames');
  assert.equal(backwards, 0, JSON.stringify(p));
  a.input({ ax: 0 }); await clock.wait(2000);
  const server = r.host.core.snapshot()[1].find(e => e[9] === a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x - server) < 0.001, 'the complete correction still reaches server truth');
});

for (const hz of [20, 60]) for (const seed of [417, 1, 42, 43, 60, 2026]) test(`prediction: ${hz} Hz jitter and loss remain steady, seed ${seed}`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz, 'press');
  const clock = virtualTime(t); let rng = seed;
  const leg = hz === 20 ? 300 : 150;
  const random = () => { rng = (Math.imul(rng,1664525)+1013904223)>>>0; return rng/4294967296; };
  const shape = m => ['in','snap'].includes(m.t) ? random() < .1 ? null : leg*(.75+random()*.5) : leg;
  const r = rig(L, compiled, false, shape, shape); t.after(()=>r.stop());
  const a = openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});t.after(()=>a.close());
  await clock.wait(12000); const start = globalThis.__homieNet.probe.prediction();
  a.input({ax:127}); let x=a.me.pos.x;
  for(let n=0;n<750;n++) {
    await clock.wait(16); const next=a.me.pos.x, p=globalThis.__homieNet.probe.prediction();
    assert.equal(p.rebases,start.rebases,JSON.stringify(p));
    assert.ok(next>=x-.01,`backward ${next-x}: ${JSON.stringify(p)}`); x=next;
  }
  a.input({ax:0}); await clock.wait(3000);
  const server = r.host.core.snapshot()[1].find(e=>e[9]===a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x-server)<.001,'the eased path converges to server truth after stopping');
});

for (const hz of [20, 30, 60]) for (const delay of [50, 150, 300]) for (const ax of [0, 127]) for (const phase of [0, 19]) test(`prediction: unseen pushes stay continuous on uneven frames at ${hz} Hz, ${delay} ms, input ${ax}, phase ${phase}`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, hz, 'push');
  const clock = virtualTime(t);
  let rng = 417;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const lag = m => ['in', 'snap'].includes(m.t) ? random() < .1 ? null : delay / 2 * (.75 + random() * .5) : delay / 2;
  const r = rig(L, compiled, false, lag, lag); t.after(() => r.stop());
  const other = openRoom({ timers: false, net: { config: cfg('Bo'), WebSocketImpl: r.socket(), post: null } }); t.after(() => other.close());
  await clock.wait(200);
  const a = openRoom({ timers: false, net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } }); t.after(() => a.close());
  for (let n = 0; n < 1500; n++) { await clock.wait(16); const input = { ax: n < 750 ? 0 : ax }; other.input(input); a.input(input); void other.me; void a.me; }
  await clock.wait(phase);
  a.command('bump'); let previous = a.me.pos, probeBefore = globalThis.__homieNet.probe.prediction();
  const bad = [];
  for (let n = 0; n < 120; n++) {
    const ms = [28, 5, 17, 33][n % 4]; await clock.wait(ms);
    const pos = a.me.pos, distance = Math.hypot(pos.x - previous.x, pos.y - previous.y);
    if (distance > 21 * ms / 1000 + .05) bad.push({ n, ms, distance, previous, pos, probeBefore, probe: globalThis.__homieNet.probe.prediction() });
    previous = pos; probeBefore = globalThis.__homieNet.probe.prediction();
  }
  assert.ok(a.me.pos.y > 2, 'the authoritative push wins');
  assert.deepEqual(bad, [], 'catch-up and its blend form one continuous path');
});

test('an effect read before a simulation step cannot leave a stale browser presentation', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'push-effects');
  const clock = virtualTime(t);
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  t.after(() => { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else delete globalThis.window; });
  const r = rig(L, compiled, false, 25, 25);
  const a = openRoom({ timers: false, net: { config: cfg('Effect reader'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(3000);
  a.input({ ax: 127 });
  let effects = 0;
  a.on('hit', () => effects++);
  for (let n = 0; n < 360; n++) {
    if (n % 60 === 0) a.command('bump');
    await clock.wait([28, 5, 17, 33][n % 4]);
    const first = a.me;
    assert.equal(a.me, first, 'unchanged synchronous reads share a presentation');
    await Promise.resolve();
    assert.deepEqual(a.me.pos, first.pos, 'clearing the cache without advancing time cannot change the drawn pose');
  }
  assert.equal(effects, 6, 'every authoritative effect exercised the own-entity read');
});

// Compile each fixture once; every case still opens fresh hosts, views and clocks.
const predictionKits = new Map();
async function predictionKit(mode, hz) {
  const key = `${mode}-${hz}`;
  if (!predictionKits.has(key)) predictionKits.set(key, coinDashKit(mode, false, hz, 'push'));
  return predictionKits.get(key);
}

// Same delay/loss/host matrix as the Chrome soak, on a clock independent of runner load.
for (const hz of [20, 30, 60]) for (const mode of ['server', 'browser'])
for (const delay of hz === 20 && mode === 'server' ? [50, 90, 150, 300] : [50, 150, 300])
for (const loss of delay === 90 ? [0] : [.02, .10])
for (const seed of hz === 60 && mode === 'browser' && delay === 300 && loss === .1 ? [417, 1, 42, 43, 60, 2026] : [417])
test(`prediction release matrix: ${hz} Hz ${mode}, ${delay} ms, ${loss} loss, seed ${seed}`, async t => {
  const { L, compiled, openRoom } = await predictionKit(mode, hz);
  const clock = virtualTime(t);
  const shape = predictionShaper({ delay, loss, seed, jitter: delay !== 90 });
  const r = rig(L, compiled, mode === 'browser', (m, link) => shape(m, `${link}:down`), (m, link) => shape(m, `${link}:up`));
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('First'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Second'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  assert.equal(b.status, 'playing');
  assert.equal(a.net.rulesHosting, mode === 'browser');
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe();
  a.input({ ax: 127 }); b.input({ ax: 127 });
  let previous = b.me.pos;
  await clock.wait(16);
  assert.ok(b.me.pos.x > previous.x, 'fresh input moves on the first drawing frame');
  previous = b.me.pos;
  const failures = [];
  for (let n = 0; n < 750; n++) {
    const ms = [16, 16, 33, 5][n % 4];
    await clock.wait(ms);
    const pos = b.me.pos;
    if (pos.x < previous.x - .001 || Math.hypot(pos.x - previous.x, pos.y - previous.y) > 21 * ms / 1000 + .05)
      failures.push({ n, ms, previous, pos, probe: probe() });
    previous = pos;
  }
  t.diagnostic(JSON.stringify({ hz, mode, delay, loss, seed, corrections: probe().count, catches: probe().catches, backwards: failures.length }));
  assert.deepEqual(failures, [], 'steady drawn motion is forward and continuous');
  assert.equal(probe().rebases, start.rebases);
  b.command('bump');
  for (let n = 0; n < 120; n++) {
    const ms = [28, 5, 17, 33][n % 4]; await clock.wait(ms);
    const pos = b.me.pos;
    assert.ok(Math.hypot(pos.x - previous.x, pos.y - previous.y) <= 21 * ms / 1000 + .05, 'push remains continuous');
    previous = pos;
  }
  assert.ok(b.me.pos.y > 2, 'authoritative push wins');
  assert.equal(probe().snaps, 0);
  a.input({ ax: 0 }); b.input({ ax: 0 }); await clock.wait(4000);
  const stopped = b.me.pos;
  const authoritative = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3];
  assert.ok(Math.hypot(stopped.x - authoritative[0], stopped.y - authoritative[1]) < .001, 'drawn correction converges to host truth');
  await clock.wait(1000);
  assert.ok(Math.hypot(b.me.pos.x - stopped.x, b.me.pos.y - stopped.y) < .001, 'correction settles');
});

test('prediction catch-up boundary: replaced history stays forward, seed 1', async t => {
  const seed = 1;
  const hz = 60, delay = 300;
  const { L, compiled, openRoom } = await predictionKit('browser', hz);
  const clock = virtualTime(t);
  // Preserve the failing release shaper's shared seeded stream here: virtual time fixes
  // its packet order. Seed 1 crosses replaced history by -0.105 m before the fix.
  let rng = seed;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const shape = m => ['in', 'snap'].includes(m.t) ? random() < .1 ? null : delay / 2 * (.75 + random() * .5) : delay / 2;
  let drop = 0;
  const r = rig(L, compiled, true, (m, link) => shape(m, `${link}:down`), (m, link) => {
    if (link === 1 && m.t === 'in' && drop > 0) { drop--; return null; }
    return shape(m, `${link}:up`);
  });
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe(); drop = 1;
  b.input({ ax: 127 });
  let previous = b.me.pos.x;
  const backwards = [];
  for (let n = 0; n < 250; n++) {
    const ms = [16, 33, 5, 17][n % 4]; await clock.wait(ms);
    b.input({ ax: 127 });
    const x = b.me.pos.x;
    assert.ok(x - previous <= 21 * ms / 1000 + .05, 'catch-up remains continuous');
    if (x < previous - .001) backwards.push({ n, step: x - previous, probe: probe() });
    previous = x;
  }
  assert.equal(probe().rebases, start.rebases);
  assert.equal(probe().snaps, 0);
  assert.equal(drop, 0, 'the shaper dropped the requested input frame');
  assert.deepEqual(backwards, [], 'catch-up must not cross a discontinuity between old and replaced history');
  b.input({ ax: 0 }); await clock.wait(4000);
  const server = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3][0];
  assert.ok(Math.abs(b.me.pos.x - server) < .001, 'the correction still converges to the host');
});

test('prediction clock slewing preserves the drawn pose on a delayed browser-host input path', async t => {
  const { L, compiled, openRoom } = await predictionKit('browser', 60);
  const clock = virtualTime(t);
  let extra = 0;
  const r = rig(L, compiled, true, 150, m => 150 + (m.t === 'in' ? extra : 0));
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  b.input({ ax: 127 }); await clock.wait(2000);
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe();
  extra = 200;
  let previous = b.me.pos.x;
  const backwards = [];
  for (let n = 0; n < 750; n++) {
    await clock.wait(16); b.input({ ax: 127 });
    const x = b.me.pos.x;
    if (x < previous - .001) backwards.push({ n, step: x - previous, probe: probe() });
    assert.ok(x - previous <= 21 * .016 + .05, 'recalibration remains continuous');
    previous = x;
  }
  assert.equal(probe().rebases, start.rebases, 'changed input delay must preserve the stamped input timeline');
  assert.deepEqual(backwards, [], 'a clock change must not place the drawn body back at the old snapshot');
  extra = 0; b.input({ ax: 0 }); await clock.wait(5000);
  const server = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3][0];
  assert.ok(Math.abs(b.me.pos.x - server) < .001, 'the corrected body converges to the host');
});

for (const mode of ['server', 'browser']) for (const hz of [20, 30, 60])
test(`prediction transport: ${mode} delivers a snapshot every ${hz} Hz tick on virtual time`, async t => {
  const { L, compiled, openRoom } = await predictionKit(mode, hz);
  const clock = virtualTime(t), r = rig(L, compiled, mode === 'browser');
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(2000);
  const firstTick = r.room.lastSnap.k, ticks = [];
  const socket = r.sockets[1], receive = socket.onmessage;
  socket.onmessage = event => {
    const frame = JSON.parse(event.data);
    if (frame.t === 'snap') ticks.push(frame.k);
    receive.call(socket, event);
  };
  await clock.wait(1000);
  assert.equal(r.room.lastSnap.k - firstTick, hz, 'the host keeps its configured rate on a punctual clock');
  assert.deepEqual(ticks, Array.from({ length: hz }, (_, n) => firstTick + n + 1), 'every completed tick reaches the replica exactly once');
});

test('prediction recalibration offset survives lossy reconciliation on server host', async t => {
  const mode = 'server';
  // A small explicit snap limit isolates the new correction from the carried clock
  // offset. The loaded Chrome regression clipped that offset with the default limit.
  const { L, compiled, openRoom } = await coinDashKit(mode, false, 60, 'push', { snapM: .5, catchM: 10 });
  const clock = virtualTime(t);
  let extra = 0;
  const shape = predictionShaper({ delay: 300, loss: .1, seed: 417 });
  const r = rig(L, compiled, mode === 'browser', (m, link) => shape(m, `${link}:down`), (m, link) => {
    const ms = shape(m, `${link}:up`);
    return ms === null ? null : ms + (m.t === 'in' ? extra : 0);
  });
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Host'), WebSocketImpl: r.socket(), post: null } });
  await clock.wait(1000);
  const b = openRoom({ net: { config: cfg('Replica'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(12000);
  b.input({ ax: 127 }); await clock.wait(2000);
  const probe = globalThis.__homieNet.probe.prediction;
  const start = probe();
  extra = 200;
  let previous = b.me.pos.x;
  const backwards = [];
  for (let n = 0; n < 750; n++) {
    await clock.wait(16); b.input({ ax: 127 });
    const x = b.me.pos.x;
    if (x < previous - .001) backwards.push({ n, step: x - previous, probe: probe() });
    assert.ok(x - previous <= 21 * .016 + .05, 'recalibration remains continuous');
    previous = x;
  }
  assert.equal(probe().rebases, start.rebases, 'changed input delay must preserve the stamped input timeline');
  assert.ok(probe().max <= .5, 'new errors stay inside the explicit snap limit');
  assert.equal(probe().snaps, 0, 'small reconciliation must not clip an existing clock correction');
  assert.deepEqual(backwards, [], 'a clock change must not place the drawn body back at the old snapshot');
  extra = 0; b.input({ ax: 0 }); await clock.wait(5000);
  const server = r.room.lastSnap.d[1].find(e => e[9] === b.seat)[3][0];
  assert.ok(Math.abs(b.me.pos.x - server) < .001, 'the corrected body converges to the host');
  // The cap still applies to a genuinely new large authoritative displacement.
  const socket = r.sockets[1], receive = socket.onmessage;
  let shifted = false;
  socket.onmessage = event => {
    const frame = JSON.parse(event.data);
    if (frame.t === 'snap') {
      const own = frame.d[1].find(e => e[9] === b.seat);
      own[3][0] += 10; shifted = true;
    }
    receive.call(socket, { data: JSON.stringify(frame) });
  };
  await clock.wait(500);
  assert.ok(shifted);
  assert.ok(probe().snaps > 0, 'a new ten-metre correction still exceeds the snap limit');

});

test('3D facing takes a continuous unit arc through horizontal and vertical half turns', async () => {
  await coinDashKit();
  const blend = globalThis.__blendHeading;
  for (const [a,b] of [[{x:1,y:0,z:0},{x:-1,y:0,z:0}],[{x:0,y:0,z:1},{x:0,y:0,z:-1}],[{x:1,y:0,z:0},{x:0,y:0,z:1}]]) {
    let last=a;
    for(let i=1;i<=60;i++){const v=blend(a,b,i/60,3);assert.ok(Math.abs(Math.hypot(v.x,v.y,v.z)-1)<1e-6);assert.ok(Math.hypot(v.x-last.x,v.y-last.y,v.z-last.z)<.053);last=v;}
    assert.deepEqual(last,b);
  }
});

test('seat-or-solo uses a private rules round while full, then joins the server without uploading private state', async t => {
  const {L,compiled,openRoom}=await coinDashKit('server',true);
  const clock=virtualTime(t),r=rig(L,compiled);t.after(()=>r.stop());
  const guests=Array.from({length:8},(_,i)=>openRoom({net:{config:cfg('P'+i),WebSocketImpl:r.socket(),post:null}}));
  t.after(()=>guests.forEach(g=>g.close()));await clock.wait(800);
  const waiting=openRoom({fallback:'solo',net:{config:cfg('Waiting'),WebSocketImpl:r.socket(),post:null}});t.after(()=>waiting.close());
  await clock.wait(5200);
  assert.equal(waiting.net.full,true);assert.equal(waiting.net.seat,null);assert.equal(waiting.status,'offline');assert.ok(waiting.me,'private room has its own body');
  const before=waiting.me.pos.x,wire=r.sockets.at(-1),sent=wire.sent.length;
  waiting.input({ax:127,ay:0});await clock.wait(500);assert.ok(waiting.me.pos.x>before);
  assert.equal(wire.sent.slice(sent).filter(m=>['in','snap','ckpt','state','round'].includes(m.t)).length,0,'private progress stays local');
  guests[0].close();await clock.wait(1500);
  assert.equal(waiting.status,'playing');assert.notEqual(waiting.net.seat,null);assert.equal(waiting.seat,waiting.net.seat);assert.ok(waiting.me);
  assert.equal(waiting.net.rulesHosting,false,'the waiting browser never takes over the online room');
});


test('3D prediction clamps vertical bounds and draws animation from the catch-up pose', async t => {
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,'pose');
  const clock=virtualTime(t),r=rig(L,compiled,false,150,150);t.after(()=>r.stop());
  const a=openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});t.after(()=>a.close());
  await clock.wait(12000);
  a.input({az:127});await clock.wait(500);
  assert.ok(Math.abs(a.me.pos.z-1.3)<.001,'predicted feet stop below the ceiling by the body height');
  a.input({az:-127});await clock.wait(500);
  assert.ok(Math.abs(a.me.pos.z)<.001,'predicted feet stop on the lower bound');
  a.input({az:0});await clock.wait(1500);a.command('launch');
  let catches=0, airborne=0;
  for(let i=0;i<100;i++){
    await clock.wait(16);const me=a.me,p=globalThis.__homieNet.probe.prediction();
    if(p.catchTick===null)continue;
    catches++;
    const age=Math.floor(p.catchTick)-me.motion.launch;
    assert.equal(me.motion.phase,Math.min(20,age),'motion belongs to the drawn historical tick');
    assert.equal(me.grounded,age>=10,'landing state belongs to the drawn path');
    if(age>=1 && age<9){airborne++;assert.equal(me.vel.z,1,'airborne velocity is not replaced by the present landing');}
  }
  assert.ok(catches>3 && airborne>0,'the unseen launch exercised airborne catch-up');
  assert.equal(r.host.core.stats.errors,0);
});

test('a late fast knock does not double its drawn speed while a large correction fades', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'knock');
  let muteUntil = 0;
  const clock = virtualTime(t), r = rig(L, compiled, false, m => m.t === 'snap' && Date.now() < muteUntil ? null : 150, 150); t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } }); t.after(() => a.close());
  await clock.wait(12000); muteUntil = Date.now() + 240; a.command('launch');
  let previous = a.me.pos.x, largest = 0, caught = false;
  for (let i = 0; i < 240; i++) {
    await clock.wait(16); const next = a.me.pos.x, p = globalThis.__homieNet.probe.prediction();
    largest = Math.max(largest, Math.abs(next - previous)); previous = next;
    caught ||= p.catchTick !== null;
  }
  t.diagnostic(`largest frame movement: ${largest} m`);
  assert.ok(caught, 'the delayed impulse requires catch-up');
  assert.ok(largest < .60, `one 16 ms frame moved ${largest} m`);
  const authoritative = r.host.core.snapshot()[1].find(e => e[9] === a.seat)[3][0];
  assert.ok(Math.abs(a.me.pos.x - authoritative) < .001, 'the correction converges after the knock ends');
  assert.equal(globalThis.__homieNet.probe.prediction().snaps, 0);
});

for (const phase of [5, 17, 33, 45]) test(`fresh 3D input preserves the pose at a ${phase} ms tick phase`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'pose');
  const clock = virtualTime(t), r = rig(L, compiled);
  const a = openRoom({ net: { config: cfg('Player'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(12000 + phase);
  const before = a.me.pos;
  a.input({ az: 127 });
  assert.deepEqual(a.me.pos, before, 'changing the preview cannot apply new input to time already elapsed');
  await clock.wait(5);
  assert.ok(a.me.pos.z > before.z, 'the new input still moves on the first drawing frame');
  assert.ok(a.me.pos.z - before.z <= .15, 'five milliseconds cannot draw most of a fifty-millisecond step');
});


test('spatial snapshots reach real views, preserve prediction, recover a lost keyframe and reconnect', async (t) => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, false, {}, 0);
  const clock = virtualTime(t);
  let lost = false;
  const r = rig(L, compiled, false, (m, link) => {
    if (link === 0 && m.t === 'snap' && Array.isArray(m.d) && m.k > 30 && !lost) { lost = true; return null; }
    return 0;
  });
  t.after(() => r.stop());
  const a = openRoom({ net: { config: cfg('Ada'), WebSocketImpl: r.socket(), post: null } });
  const prediction = globalThis.__homieNet.probe.prediction;
  const b = openRoom({ net: { config: cfg('Bo'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); b.close(); });
  await clock.wait(600);
  assert.equal(a.status, 'playing'); assert.equal(b.status, 'playing');
  const visible = () => { const ids = []; a.each('runner', e => ids.push(e.id)); return ids; };
  assert.deepEqual(visible(), [a.me.id]);
  const start = a.me.pos.x;
  a.input({ ax: 127, ay: 0 });
  await clock.wait(2800);
  assert.equal(lost, true);
  assert.ok(a.me.pos.x > start + 1, 'own prediction keeps moving through deltas and a lost keyframe');
  assert.deepEqual(visible(), [a.me.id]);
  const seat = a.seat;
  r.sockets[0].cut();
  for (let i = 0; i < 60 && !a.net.connected; i++) await clock.wait(50);
  assert.equal(a.net.connected, true);
  // Drop the next periodic keyframe: the welcome alone must seed the new socket.
  const nextSocket = r.sockets.at(-1);
  const incoming = nextSocket.onmessage;
  nextSocket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.t === 'snap' && Array.isArray(m.d)) return;
    incoming?.(event);
  };
  await clock.wait(150);
  assert.ok(r.host.tick - prediction().serverTick <= 1, 'new socket deltas advance the view immediately');
  const own = r.host.core.snapshot()[1].find(e => e[9] === seat);
  assert.ok(Math.abs(a.me.pos.x - own[3][0]) < 1, 'welcome baseline reconciles immediately, before another keyframe');
  assert.equal(a.seat, seat); assert.equal(a.status, 'playing');
  assert.deepEqual(visible(), [a.me.id]);
  assert.equal(r.host.core.stats.errors, 0);
});

for (const dims of [2,3]) for (const delayed of [false,true]) test(`live cover ${dims}D outside spatial interest: visible prediction, edits, rejoin and restore${delayed?' at 300 ms + 12% loss':''}`, async t=>{
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,dims===3?'cover':'cover2',{},.5);
  const clock=virtualTime(t),shape=predictionShaper({delay:delayed?300:0,loss:delayed?.12:0,seed:743});
  let inputSeed=743;const inputRandom=()=>{inputSeed=(Math.imul(inputSeed,1664525)+1013904223)>>>0;return inputSeed/4294967296;};
  const r=rig(L,compiled,false,shape,shape);
  const open=who=>openRoom({net:{config:cfg(who),WebSocketImpl:r.socket(),post:null}});
  let a=open('Builder');const b=open('Neighbour');t.after(()=>{a.close();b.close();r.stop();});
  await clock.wait(2000);
  const visibleCover=[];a.each('cover',e=>visibleCover.push(e.id));
  assert.deepEqual(visibleCover,[],'collider entity is outside visual interest');
  const place=async(at,hover=false)=>{a.input({ax:0,hover});await clock.wait(700);a.command('place',{at});await clock.wait(1000);};
  for(const [name,speed,dash] of [['walk',4,false],['sprint',9,false],['dash',1,true]]) {
    await place({x:-2,y:0,z:0});a.input({ax:speed,dash});
    for(let i=0;i<90;i++){if(i%3===0)a.input({ax:inputRandom()<.1?0:speed,dash});await clock.wait(16);assert.ok(a.me.pos.x<=-.899,`${name} predicted through wall: ${a.me.pos.x}`);}
    assert.ok(Math.abs(a.me.pos.x+.901)<.003,`${name} stops at ${a.me.pos.x}`);
  }
  a.input({ax:0});a.command('edit',{mode:0});await clock.wait(1000);
  a.input({ax:4});await clock.wait(900);assert.ok(a.me.pos.x>1,'disabled wall permits immediate movement');
  a.command('edit',{mode:1});await clock.wait(1000);
  await place({x:-2,y:0,z:0});assert.ok(a.me.pos.x< -1.5,`placed: ${a.me.pos.x} ${JSON.stringify(r.host.core.snapshot())}`);a.command('edit',{mode:2});await clock.wait(1000);
  a.input({ax:4});await clock.wait(1000);assert.ok(Math.abs(a.me.pos.x+1.401)<.004,`changed rectangular dimensions: ${a.me.pos.x}; ${JSON.stringify(r.host.core.stats)}`);
  a.command('edit',{mode:3});await clock.wait(1000);a.input({ax:4});await clock.wait(700);assert.ok(a.me.pos.x>0,'despawn removes collision');
  a.input({ax:0});b.command('place',{at:{x:-3,y:1,z:0}});await clock.wait(700);
  b.input({ax:1});a.command('edit',{mode:4});await clock.wait(2000);
  assert.ok(b.me.pos.x<=-.899,'build near another moving player participates in prediction');b.input({ax:0});
  if(dims===3){
    await place({x:-1.5,y:0,z:0});a.input({jump:true,ax:2});await clock.wait(500);a.input({ax:0});await clock.wait(1000);
    assert.ok(Math.abs(a.me.pos.z-2.601)<.02,'jump from the floor onto cover');
    await place({x:0,y:0,z:0});a.input({launch:true});await clock.wait(200);assert.ok(a.me.pos.z<.01,'overlapping cover gates launch');
    await place({x:0,y:0,z:2.601});assert.equal(a.me.grounded,true,'cover supports feet');
    a.input({jump:true});await clock.wait(180);assert.ok(a.me.pos.z>3,'jump off live support');
    a.input({ax:0});await clock.wait(1400);assert.ok(Math.abs(a.me.pos.z-2.601)<.02,'land on cover');
    a.command('edit',{mode:3});await clock.wait(1600);assert.ok(a.me.pos.z<.01,'destroy supporting cover and fall');
    a.command('edit',{mode:4});await clock.wait(800);
    await place({x:0,y:0,z:5},true);assert.ok(Math.abs(a.me.motion.support-2.4)<.15,'dive height is measured to cover');
    a.input({dive:true});await clock.wait(600);assert.ok(Math.abs(a.me.pos.z-2.601)<.02,'dive lands on cover');
    await place({x:-2,y:0,z:0});a.input({launch:true,ax:4});await clock.wait(160);assert.ok(a.me.pos.z>1,'launch beside cover predicts');a.input({ax:0});
    a.command('edit',{mode:5});await clock.wait(800);
    await place({x:0,y:0,z:3.601});assert.equal(a.me.grounded,true,'moved platform supports at its new height');
  }
  await place({x:-2,y:0,z:0});
  // A fresh view has no retained collision history; its first snapshot supplies it.
  a.close();a=open('Reloaded');await clock.wait(2000);a.command('place',{at:{x:-2,y:0,z:dims===3?1:0}});await clock.wait(1000);
  a.input({ax:4});await clock.wait(1200);assert.ok(a.me.pos.x<=-.899,'rejoin collision');
  const saved=r.host.core.save(),restored=L.C.createCore(compiled,{restore:saved});
  assert.deepEqual(restored.snapshot(),r.host.core.snapshot(),'saved room restores the identical collision revision');
  for(let i=0;i<12;i++){const inputs=new Map([[a.seat,{values:{ax:4}}]]);restored.step(inputs);}
  assert.equal(restored.stats.errors,0,restored.stats.lastError);
  assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
  const revived=rig(L,compiled,{restore:r.host.save(),restoreEpoch:r.host.core.epoch+1},shape,shape);
  const fresh=openRoom({net:{config:cfg('Restored'),WebSocketImpl:revived.socket(),post:null}});
  t.after(()=>{fresh.close();revived.stop();});
  await clock.wait(2000);
  fresh.input({ax:0});fresh.command('place',{at:{x:-2,y:0,z:dims===3?1:0}});await clock.wait(1000);
  fresh.input({ax:4});
  for(let i=0;i<80;i++){await clock.wait(16);assert.ok(fresh.me.pos.x<=-.899,`restored prediction: ${fresh.me.pos.x}`);}
  assert.equal(revived.host.core.stats.errors,0,revived.host.core.stats.lastError);
});

for(const delayed of [false,true]) test(`solid Stormbreak terrain: six bodies, traversal, combat rays, live cover, rejoin and restore${delayed?' at 300 ms + 12% loss':''}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'terrain',{},.5);
 const clock=virtualTime(t),shaper=predictionShaper({delay:delayed?300:0,loss:delayed?.12:0,seed:743});
 let inputSeed=743;const inputRandom=()=>{inputSeed=(Math.imul(inputSeed,1664525)+1013904223)>>>0;return inputSeed/4294967296;};
 const r=rig(L,compiled,false,shaper,shaper);
 const open=name=>openRoom({net:{config:cfg(name),WebSocketImpl:r.socket(),post:null}});
 let a=open('Runner');const runnerProbe=globalThis.__homieNet.probe.prediction;const others=Array.from({length:5},(_,i)=>open('Neighbour'+i));
 t.after(()=>{a.close();for(const b of others)b.close();r.stop();});await clock.wait(2500);
 const place=async(at)=>{a.input({ax:0,ay:0});await clock.wait(700);a.command('place',{at});await clock.wait(1100);};
 await place({x:-4,y:7,z:0});a.command('shoot',{direction:1});await clock.wait(1100);assert.ok(Math.abs(a.me.ray-1.5)<.002,`weapon/camera/blast ray hits solid side: ${a.me.ray}, pose ${JSON.stringify(a.me.pos)}, ${JSON.stringify(r.host.core.stats)}`);
 for(const sign of [-1,1]){await place({x:sign*4,y:7,z:0});a.command('shoot',{direction:-sign});await clock.wait(1100);assert.ok(Math.abs(a.me.ray-1.5)<.002,'ray from either side');a.input({ax:-sign,dash:true});
 for(let i=0;i<80;i++){if(i%3===0)a.input({ax:inputRandom()<.1?0:-sign,dash:true});await clock.wait(16);assert.ok(sign*a.me.pos.x>=2.899,`predicted side: ${a.me.pos.x}`);}a.input({ax:0});}
 await place({x:30,y:0,z:0});a.command('edit',{mode:6});await clock.wait(1100);a.input({ax:4});await clock.wait(1000);assert.ok(Math.abs(a.me.pos.x-31.099)<.003,'live cover in the full terrain');a.input({ax:0});a.command('edit',{mode:0});await clock.wait(1100);a.input({ax:4});await clock.wait(800);assert.ok(a.me.pos.x>32.5,'disabled cover permits traversal');a.input({ax:0});a.command('edit',{mode:1});await clock.wait(1100);
 await place({x:0,y:18,z:0});a.input({ay:-4});await clock.wait(1500);assert.ok(a.me.pos.z>1,'walk up ramp');
 a.input({ay:4});await clock.wait(1500);assert.ok(a.me.pos.z<.2,'walk down ramp');
 await place({x:-3.2,y:14,z:0});a.input({ax:3,jump:true});await clock.wait(550);a.input({ax:0});await clock.wait(1200);assert.ok(a.me.pos.z>.4,`jump onto ramp: ${JSON.stringify({pos:a.me.pos,prediction:runnerProbe(),host:r.host.core.stats})}`);
 a.input({jump:true});await clock.wait(200);assert.ok(a.me.pos.z>1.5,'jump off ramp');a.input({ax:0});
 // Dense hill rims from real-game movement failures, under the same network clock.
 for(const at of [{x:-10.89543,y:26.09822,z:.129555},{x:-19.84526,y:20.9344,z:.511}]){
  await place(at);a.input({ax:1,ay:3,camera:true});await clock.wait(700);a.input({ax:0,ay:0,camera:false});
  assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
  assert.ok(Number.isFinite(a.me.pos.z));assert.ok(a.me.motion.difference<.002,'scratch capsule sweep matches movement');
 }
 await place({x:-4,y:7,z:0});
 a.close();a=open('Rejoined');await clock.wait(2200);await place({x:-4,y:7,z:0});a.input({ax:1,dash:true});await clock.wait(1200);assert.ok(a.me.pos.x<=-2.899,'rejoined side');a.input({ax:0});
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
 const revived=rig(L,compiled,{restore:r.host.save(),restoreEpoch:r.host.core.epoch+1},shaper,shaper);
 const fresh=openRoom({net:{config:cfg('Restored terrain'),WebSocketImpl:revived.socket(),post:null}});
 t.after(()=>{fresh.close();revived.stop();});await clock.wait(2200);
 fresh.command('place',{at:{x:-4,y:7,z:0}});await clock.wait(1100);fresh.input({ax:1,dash:true});
 for(let i=0;i<90;i++){await clock.wait(16);assert.ok(fresh.me.pos.x<=-2.899,`restored solid terrain: ${fresh.me.pos.x}`);}
 fresh.input({ax:0});await clock.wait(1000);fresh.command('place',{at:{x:-4,y:8,z:0}});await clock.wait(1100);fresh.command('shoot',{direction:1});await clock.wait(1100);assert.ok(Math.abs(fresh.me.ray-1.5)<.002,`restored combat ray: ${fresh.me.ray}, ${JSON.stringify(fresh.me.pos)}, ${JSON.stringify(revived.host.core.stats)}`);
 fresh.command('place',{at:{x:0,y:18,z:0}});await clock.wait(1100);fresh.input({ay:-4});await clock.wait(1500);assert.ok(fresh.me.pos.z>1,'restored ascent');fresh.input({ay:4});await clock.wait(1500);assert.ok(fresh.me.pos.z<.2,'restored descent');
 assert.equal(revived.host.core.stats.errors,0,revived.host.core.stats.lastError);
 console.log('Stormbreak 4058 shapes, six clients, max tick units:',r.host.core.stats.maxTickUnits);
});

for(const delayed of [false,true]) test(`filtered rays and hit regions on authority and prediction${delayed?' at 300 ms with loss':''}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'queries');
 const clock=virtualTime(t),shape=predictionShaper({delay:delayed?300:0,loss:delayed?.05:0,seed:451});
 const r=rig(L,compiled,false,shape,shape);const a=openRoom({net:{config:cfg('Shooter'),WebSocketImpl:r.socket(),post:null}});const b=openRoom({net:{config:cfg('Neighbour'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();b.close();r.stop();});await clock.wait(2200);
 for(const [mode,dist,part,count] of [[0,7.58,'body',3],[1,7.76,'head',3],[2,9.5,'',2],[3,7.58,'body',1],[4,12,'',1],[5,.58,'',1],[6,9.5,'',2],[7,-1,'',0],[8,0,'',3],[9,9.2,'',2],[10,7.58,'body',3],[11,9.5,'',2],[12,9.5,'',2]]){
   a.command('shoot',{mode});await clock.wait(1300);assert.ok(Math.abs(a.me.dist-dist)<.001,`${mode}: ${a.me.dist}`);assert.equal(a.me.part,part);assert.equal(a.me.count,count);assert.equal(a.me.deadTargets,1);
 }
 assert.ok(Math.abs(a.me.motion.ray-9.5)<.001,'movement predicts the geometry ray');
 let movingCover; a.each('cover',e=>{movingCover=e;});assert.ok(movingCover);assert.equal(movingCover.motion.ray,2,'a live collider movement query ignores itself');assert.equal(movingCover.motion.selfRay,0,'movement can explicitly include its own collider');
 const opts={entitiesOnly:true,kind:'target',tag:'fighter',layer:'actors',where:{hp:{gt:0}}};
 const hit=a.ray({x:0,y:0,z:1.85},{x:1,y:0,z:0},18,opts);assert.equal(hit.part,'head');assert.ok(Math.abs(hit.dist-7.76)<.001);assert.equal(a.rayAll({x:0,y:0,z:1},{x:1,y:0,z:0},18,opts).length,1);
 const saved=r.host.core.save();const restored=L.C.createCore(compiled,{restore:saved});assert.deepEqual(restored.save(),saved);for(let i=0;i<8;i++){r.host.core.step();restored.step();assert.deepEqual(restored.save(),r.host.core.save());}assert.equal(r.host.core.stats.errors,0);
});

test('filtered ray declarations and API pass the strict author build',async()=>{
 await coinDashKit('server',false,20,'queries');
 const esbuild=await esbuildOf();
 await prepareRules(esbuild,scratch,{id:'queries',dir:join(scratch,'variant-queries'),players:{max:8},room:{host:'server'}});
});

for(const delayed of [false,true]) test(`ranked bot admission retains entity resources and gates player control${delayed?' with 300 ms and loss':''}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'admission');
 const clock=virtualTime(t),shape=predictionShaper({delay:delayed?300:0,loss:delayed?.05:0,seed:4511});
 const r=rig(L,compiled,false,shape,shape),a=openRoom({net:{config:cfg('First'),WebSocketImpl:r.socket(),post:null}});
 let b;t.after(()=>{a.close();b?.close();r.stop();});await clock.wait(2200);
 const bots=[];a.each('runner',e=>{if(e.driver==='bot')bots.push(e);});bots.sort((a,b)=>b.fitness-a.fitness);const chosen=bots[0];assert.ok(chosen);
 b=openRoom({net:{config:cfg('Late'),WebSocketImpl:r.socket(),post:null}});await clock.wait(2200);
 assert.equal(b.me.id,chosen.id);assert.equal(b.me.hp,73);assert.equal(b.me.ammo,7);assert.equal(b.me.motion.accepted,false);
 const before=b.me.pos.x;b.input({ax:-4});await clock.wait(1000);assert.ok(b.me.pos.x>before,'think keeps driving until consent');
 b.command('accept');await clock.wait(1300);assert.equal(b.me.motion.accepted,true);
 const accepted=b.me.pos.x;await clock.wait(500);assert.ok(b.me.pos.x<accepted,'player input drives after consent');
 const saved=r.host.core.save(),restored=L.C.createCore(compiled,{restore:saved});assert.deepEqual(restored.save(),saved);
 for(let i=0;i<8;i++){r.host.core.step();restored.step();assert.deepEqual(restored.save(),r.host.core.save());}
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

test('admission declarations pass the strict author build',async()=>{
 await coinDashKit('server',false,20,'admission');
 await prepareRules(await esbuildOf(),scratch,{id:'admission',dir:join(scratch,'variant-admission'),players:{max:8},room:{host:'server'}});
});

for(const delayed of [false,true]) test(`synchronous events preserve ordered pellet destruction and actor ownership${delayed?' with delay/loss':''}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'sequence');
 const clock=virtualTime(t),shape=predictionShaper({delay:delayed?300:0,loss:delayed?.05:0,seed:4512}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Shooter'),WebSocketImpl:r.socket(),post:null}}),b=openRoom({net:{config:cfg('Viewer'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();b.close();r.stop();});await clock.wait(2200);a.command('shoot');await clock.wait(1500);
 assert.equal(a.me.hits.length,6);assert.equal(a.me.credit,6);assert.equal(new Set(a.me.hits).size,3);
 for(let i=0;i<6;i+=2)assert.equal(a.me.hits[i],a.me.hits[i+1]);
 b.each('target',e=>{assert.equal(e.hp,0);assert.equal(e.solid,false);});
 const saved=r.host.core.save(),restored=L.C.createCore(compiled,{restore:saved});for(let i=0;i<8;i++){r.host.core.step();restored.step();assert.deepEqual(restored.save(),r.host.core.save());}assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});
test('synchronous event declaration passes the strict author build',async()=>{await coinDashKit('server',false,20,'sequence');await prepareRules(await esbuildOf(),scratch,{id:'sequence',dir:join(scratch,'variant-sequence'),players:{max:8},room:{host:'server'}});});

test('historical actor queries hit the rendered pose with 300 ms/loss and restore exactly',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'history');
 const clock=virtualTime(t),shape=predictionShaper({delay:300,loss:.05,seed:4513}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Shooter'),WebSocketImpl:r.socket(),post:null}}),b=openRoom({net:{config:cfg('Viewer'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();b.close();r.stop();});await clock.wait(2200);let target;a.each('target',e=>target=e);assert.ok(target);assert.ok(a.viewTick<r.host.core.tick);
 a.command('shoot',{at:a.viewTick,y:target.pos.y});await clock.wait(1500);assert.equal(a.me.hit,target.id);assert.equal(a.me.current,'','uncompensated query misses the moving actor');
 a.command('block');await clock.wait(1000);a.each('target',e=>target=e);a.command('shoot',{at:a.viewTick,y:target.pos.y});await clock.wait(1200);let cover;a.each('cover',e=>cover=e);assert.equal(a.me.hit,cover.id,'new cover stays authoritative during actor rewind');assert.equal(a.me.current,cover.id);
 const saved=r.host.core.save(),restored=L.C.createCore(compiled,{restore:saved});assert.deepEqual(restored.save(),saved);for(let i=0;i<8;i++){r.host.core.step();restored.step();assert.deepEqual(restored.save(),r.host.core.save());}assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
 const invalid=structuredClone(saved);invalid.history[0][1][0][1]=Infinity;assert.throws(()=>L.C.createCore(compiled,{restore:invalid}),/history/);
});
test('history query declaration passes the strict author build',async()=>{await coinDashKit('server',false,20,'history');await prepareRules(await esbuildOf(),scratch,{id:'history',dir:join(scratch,'variant-history'),players:{max:8},room:{host:'server'}});});

for(const delayed of [false,true]) test(`query snapshots preserve captured geometry and fields across dispatch${delayed?' with delay/loss':''}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'sequence');const clock=virtualTime(t),shaper=predictionShaper({delay:delayed?300:0,loss:delayed?.05:0,seed:4517}),r=rig(L,compiled,false,shaper,shaper);
 const a=openRoom({net:{config:cfg('Snapshot'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(2500);a.command('snapshot');await clock.wait(1800);
 assert.equal(a.me.label,'Snapshot');assert.equal(a.me.hits.length,2);assert.notEqual(a.me.hits[0],a.me.hits[1]);assert.ok(a.me.hits.every(Boolean));assert.equal(a.me.credit,1);assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
 const saved=r.host.save();assert.ok(saved);r.host.core.step();assert.equal(r.host.core.stats.errors,0);
});

 test('round retry skips results and intermission, preserves seats and restores pending intent',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'sequence'),clock=virtualTime(t),shape=predictionShaper({delay:300,loss:.05,seed:4521}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Retry'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(2500);const id=a.me.id,n=a.round.n;const phases=[];a.net.on('round',round=>phases.push(round));a.command('retry');await clock.wait(1500);assert.equal(a.round.n,n+1);assert.equal(a.round.phase,'live');assert.equal(a.me.id,id);assert.ok(phases.every(p=>p.phase!=='over'&&!p.results));
 const saved=r.host.core.save();saved.intent=[0,0,1];const x=L.C.createCore(compiled,{restore:saved}),y=L.C.createCore(compiled,{restore:saved});x.step();y.step();assert.equal(x.save().round[0],n+2);assert.deepEqual(x.save(),y.save());assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
 });

for(const delayed of [false,true])test(`valued one-frame input survives sampling and private fields stay off every recipient wire${delayed?' under seeded latency/loss':''}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'pulses'),clock=virtualTime(t),shape=predictionShaper({delay:delayed?600:0,loss:delayed?.2:0,seed:4527}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('One'),WebSocketImpl:r.socket(),post:null}}),b=openRoom({net:{config:cfg('Two'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();b.close();r.stop();});await clock.wait(2500);
 for(let i=0;i<20;i++){a.input({select:i%3+1});await clock.wait(1);a.input({select:0});await clock.wait(120);}
 await clock.wait(1200);assert.deepEqual([...a.me.actions],Array.from({length:20},(_,i)=>i%3+1));
 assert.equal(a.me.ammo,24);assert.equal(b.get(a.me.id).ammo,0);assert.equal(a.me.secret,'');assert.equal(a.get(b.me.id).secret,'');
 assert(!JSON.stringify(L.R.schemaOf(compiled)).includes('brain-secret'));
 const raw=r.host.core.snapshot(),round=raw[0],snap={e:r.host.epoch,k:r.host.tick,d:raw,c:[]};
 for(const seat of [null,0,1,7]){const filtered=r.host.projectSnapshot(snap,seat);assert(!JSON.stringify(filtered).includes('brain-secret'));for(const row of filtered.d[1]){assert.equal(row[7][1],null);if(row[9]!==seat)assert.equal(row[7][2],null);assert.equal(row[7][3],null);}}
 const over=r.host.projectSnapshot({...snap,d:[[round[0],0,round[2]],...raw.slice(1)]},null);assert(over.d[1].every(row=>row[7][3]===52));
 const saved=r.host.save(),restored=L.H.createHost({game:'test',compiled,restore:saved,clock:r.host.clock??{now:()=>Date.now(),setTimer:()=>0,clearTimer(){}},send(){}});assert.deepEqual(restored.core.save(),r.host.core.save());restored.stop();
});
test('low-latency player cannot request a one-second-old target pose, seed 4520',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'history'),clock=virtualTime(t),shape=predictionShaper({delay:0,loss:0,seed:4520}),r=rig(L,compiled,false,shape,shape),a=openRoom({net:{config:cfg('Shooter'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(2500);const tick=r.host.core.tick;
 a.command('shoot',{at:tick-18,y:(tick-18)*.1});await clock.wait(300);assert.equal(a.me.hit,'','forged 900 ms rewind must be clamped to measured latency and presentation margin');assert.equal(r.host.core.stats.errors,0);
});

/* ---------------------------------------------------------------- 0.46.3: what the second Stormbreak playtest asked for */

for(const via of ['a small room','Gates'])test('an effect with an audience reaches who may perceive it and nobody else, on the wire, seed 4611: '+via,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),clock=virtualTime(t),wire=new Map(),r=(via==='Gates'?gateRig:rig)(L,compiled,false,(m,link)=>{if(m.t==='ev'&&m.k==='fx'){if(!wire.has(link))wire.set(link,[]);wire.get(link).push(...m.d[1].map(x=>x[0]));}return 0;},0);
 const open=(who,watch=false)=>openRoom({net:{config:{...cfg(who),...(watch?{watch:true}:{})},WebSocketImpl:r.socket(),post:null}});
 // Seats are given in the order the room admits, which through Gates is not the order of opening: each is known by where it stands.
 const opened=[open('One'),open('Two'),open('Three')];t.after(()=>{for(const o of opened)o.close();w.close();r.stop();});await clock.wait(1500);const w=open('Watcher',true);await clock.wait(1500);
 const order=[0,1,2].sort((x,y)=>opened[x].me.pos.x-opened[y].me.pos.x),[a,b,c]=order.map(i=>opened[i]);
 assert.deepEqual([a.me.pos.x,b.me.pos.x,c.me.pos.x],[0,3,40]);
 const heard=new Map([[a,[]],[b,[]],[c,[]],[w,[]]]);for(const [room,list] of heard)for(const name of ['ping','whisper','tell'])room.on(name,e=>list.push(name+e.n));
 a.command('shout',{to:c.me.id});await clock.wait(600);
 assert.deepEqual(heard.get(a),['ping1','whisper2'],'the one who made it: public, and within five metres of itself');
 assert.deepEqual(heard.get(b),['ping1','whisper2'],'three metres away');
 assert.deepEqual(heard.get(c),['ping1','tell3'],'forty metres away, and named');
 assert.deepEqual(heard.get(w),['ping1','whisper2'],'a watcher perceives the room, in the order emitted, and never what was addressed to one player');
 // The frames themselves: nothing a seat may not perceive was ever sent to it.
 assert.deepEqual([...order.map(i=>wire.get(i)),wire.get(3)],[[0,1],[0,1],[0,2],[0,1]]);
 // A tick with no audience is one frame for everybody, the bytes as before.
 const before=r.sockets.map(s=>s.sent.length);r.host.core.stats;assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);assert.equal(before.length,4);
});

for(const via of ['a small room','Gates'])test('a held input moves for the part of the tick it was down: sixty-millisecond taps at every phase of the tick, seed 4612: '+via,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),clock=virtualTime(t),shape=predictionShaper({delay:0,loss:0,seed:4612}),r=(via==='Gates'?gateRig:rig)(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Tapper'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(2500);
 const frame=async ms=>{for(let left=ms;left>0;left-=Math.min(left,16)){a.pump();await clock.wait(Math.min(left,16));}a.pump();};
 const server=()=>{const row=r.host.core.save().ents.find(e=>e[11]===0);return row[7][0];};
 // The body is drawn stopping where it will rest. Through a Gate an entry can miss its tick (a Gate sends the room one
 // frame every 50 ms): the server then settles it over the next ticks, and when it has to spread that over more than
 // one, the drawn body is a few centimetres short for those ticks. Never in a small room; rarely, and bounded, through Gates.
 const drifted=[];
 for(const [ms,want] of [[60,.384],[120,.768],[30,.192]]){const moved=[];
  for(let i=0;i<10;i++){await frame(331+i*7);const from=a.me.pos.x;a.input({ax:i%2?-1:1});await frame(ms);a.input({ax:0});const stop=a.me.pos.x;await frame(450);if(Math.abs(a.me.pos.x-stop)>=.004)drifted.push(a.me.pos.x-stop);moved.push(Math.abs(a.me.pos.x-from));assert.ok(Math.abs(server()-a.me.pos.x)<(via==='Gates'?.01:.002),'the server moved the body as far as this browser predicted');}
  assert.ok(moved.every(m=>Math.abs(m-want)<.025),`${ms} ms taps move ${want} m at 6.4 m/s, whatever the phase: ${moved.map(m=>m.toFixed(3))}`);
 }
 // The same taps sampled at the tick's edge move one tick or two: this is what the field type is for.
 assert.ok(via==='Gates'?drifted.length<=2&&drifted.every(d=>Math.abs(d)<.08):drifted.length===0,`drift after a release: ${drifted.map(d=>d.toFixed(3))}`);
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

// Through Gates the connection is delayed, and neither lossy nor reordered: a Gate's deltas ride an ordered socket with no periodic keyframe.
for(const via of ['a small room','Gates'])test('own actions are predicted, confirmed and quietly retracted under 300 ms and loss, seed 4613: '+via,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),clock=virtualTime(t),shape=predictionShaper({delay:300,loss:via==='Gates'?0:.05,seed:4613,jitter:via!=='Gates'}),r=(via==='Gates'?gateRig:rig)(L,compiled,false,shape,shape);
 const predict={runner(me,input,ctx){if(input.swap)me.weapon=1-me.weapon;if(input.build&&me.builds>0){me.builds--;ctx.ghost('cover',{x:me.pos.x+2,y:me.pos.y,z:0});}if(input.fire)ctx.effect('hit',me.id,{target:'guess'});}};
 const pair=[openRoom({predict,net:{config:cfg('Sure'),WebSocketImpl:r.socket(),post:null}}),openRoom({predict,net:{config:cfg('Wrong'),WebSocketImpl:r.socket(),post:null}})];t.after(()=>{pair[0].close();pair[1].close();r.stop();});await clock.wait(3000);
 const [a,b]=pair.sort((x,y)=>x.seat-y.seat); // the target stands in front of seat 0, whoever was admitted first
 const frame=async ms=>{for(let left=ms;left>0;left-=16){a.pump();b.pump();await clock.wait(Math.min(left,16));}};
 const body=seat=>L.P.unpackFields(compiled.kinds[0].fields,r.host.core.save().ents.find(e=>e[11]===seat)[17],3);
 // A weapon swap: on the next drawn frame here, while the server has not heard of it; then the server's, with no flicker back.
 a.input({swap:true});await frame(16);assert.equal(a.me.weapon,1,'predicted on the next frame');assert.equal(body(0).weapon,0,'the server has not received it yet');
 const seen=new Set();for(let i=0;i<90;i++){await frame(16);seen.add(a.me.weapon);}assert.deepEqual([...seen],[1],'never drawn back to the old weapon');assert.equal(body(0).weapon,1);assert.equal(b.get(a.me.id).weapon,1);
 // Own cover: a provisional entity at once, then the server's, and exactly one is drawn the whole time.
 const notes=[];for(const name of ['confirm','retract'])a.on(name,e=>notes.push(name));
 const covers=()=>{const list=[];a.each('cover',e=>list.push(e));return list;};
 a.input({build:true});await frame(16);assert.equal(covers().length,1);assert.equal(covers()[0].provisional,true);assert.equal(a.me.builds,1);assert.equal(body(0).builds,2);
 const counts=new Set();for(let i=0;i<120;i++){await frame(16);counts.add(covers().length);}assert.deepEqual([...counts],[1],'the ghost gives way to the server\'s cover without a gap or a double');
 assert.equal(covers()[0].provisional,undefined);assert.deepEqual(notes,['confirm']);assert.equal(body(0).builds,1);
 // A provisional hit the server agrees with is confirmed; one it does not is retracted. Neither is heard twice as new.
 const hits=new Map([[a,[]],[b,[]]]);for(const [room,list] of hits){room.on('hit',e=>list.push(e.predicted?'predicted':e.confirms?'confirms:'+(e.target!==''):'new'));room.on('retract',e=>list.push('retract:'+e.effect));}
 a.input({fire:true});b.input({fire:true});await frame(16);assert.deepEqual(hits.get(a),['predicted']);assert.deepEqual(hits.get(b),['predicted']);
 await frame(1500);assert.deepEqual(hits.get(a),['predicted','confirms:true'],'the server\'s own effect arrives as the confirmation, with its exact data');assert.deepEqual(hits.get(b),['predicted','retract:hit'],'nothing stood in front of this one');
 assert.equal(body(0).shots,1);assert.equal(body(1).shots,1);assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

for(const via of ['a small room','Gates'])test('a predicted effect is shown once a tick whatever else the predictor shows beside it, seed 4615: '+via,async t=>{
 // The preview between ticks runs again whenever the input changes. A second effect that appears in a later run of the
 // same tick (a jump pressed while the trigger is held) must not make the first one count as new: effects are told
 // apart by their name and the game's own `key`, not by the order the predictor happened to ask in.
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),clock=virtualTime(t),shape=predictionShaper({delay:0,loss:0,seed:4615}),r=(via==='Gates'?gateRig:rig)(L,compiled,false,shape,shape);
 const predict={runner(me,input,ctx){if(input.swap){ctx.effect('ping',me.id,{n:7},{key:'swap'});ctx.effect('ping',me.id,{n:8},{key:'other'});}if(input.build)ctx.effect('ping',me.id,{n:9},{key:'build'});if(input.fire)ctx.effect('hit',me.id,{target:'guess'});}};
 const a=openRoom({predict,net:{config:cfg('Twice'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const frame=async ms=>{for(let left=ms;left>0;left-=4){a.pump();await clock.wait(Math.min(left,4));}a.pump();};
 const seen=[];a.on('hit',e=>{if(e.predicted)seen.push('hit');});a.on('ping',e=>{if(e.predicted)seen.push('ping'+e.n);});
 for(let i=0;i<8;i++){
  seen.length=0;await frame(203+i*7);
  // Trigger first, then a second action a few milliseconds later, then a third: mostly inside one tick.
  a.input({build:true});a.pump();await frame(4);a.input({fire:true});a.pump();await frame(4);a.input({swap:true});a.pump();await frame(120);
  assert.deepEqual([...seen].sort(),['hit','ping7','ping8','ping9'],`attempt ${i}: each predicted effect once, got ${seen}`);
 }
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

for(const via of ['a small room','Gates'])test('the server\'s word that arrives before the tick is predicted confirms the prediction instead of leaving it to be retracted, seed 4616: '+via,async t=>{
 // A valued pulse that names no tick (an older page, or one whose tick has already run) is acted on by the server the
 // moment it arrives, which at a low latency can be before this browser steps the tick that predicts the same action.
 // The effect is then already waiting to be shown when the predictor asks for it: the two are the same event, heard
 // once as predicted and once as its confirmation.
 // A snapshot is its own message behind the tick's effects, and arrives unevenly (here every third one 34 ms late): this
 // browser then steps the tick, and predicts, between a tick's effects and its snapshot.
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),clock=virtualTime(t),r=(via==='Gates'?gateRig:rig)(L,compiled,false,m=>m.t==='snap'?(m.k%3===0?38:4):0,0);
 const predict={runner(me,input,ctx){if(input.tap&&!ctx.preview&&me.cool<=ctx.tick){me.cool=ctx.tick+6;me.taps++;ctx.effect('hit',me.id,{target:'guess'});}}};
 class Unstamped extends r.socket(){send(x){const m=JSON.parse(x);if(m.t==='ev'&&m.k==='pulse'&&Array.isArray(m.d))m.d=m.d.slice(0,3);super.send(JSON.stringify(m));}}
 const a=openRoom({predict,net:{config:cfg('Early'),WebSocketImpl:Unstamped,post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const frame=async ms=>{for(let left=ms;left>0;left-=4){a.pump();await clock.wait(Math.min(left,4));}a.pump();};
 const heard=[];a.on('hit',e=>heard.push(e.predicted?'predicted':e.confirms?'confirms':'new'));a.on('retract',e=>heard.push('retract'));
 const seen=new Set();
 for(let i=0;i<16;i++){heard.length=0;await frame(397+i*3);a.input({tap:1});await frame(8);a.input({tap:0});await frame(700);seen.add(heard.join('+'));
  assert.ok(!heard.includes('retract'),`press ${i}: the server acted on it, so nothing is taken back: ${heard}`);
  assert.ok(heard.join('+')==='predicted+confirms'||heard.join('+')==='new',`press ${i}: heard once, as a prediction and its confirmation or as the server's alone: ${heard}`);}
 assert.ok(seen.has('predicted+confirms'));const body=L.P.unpackFields(compiled.kinds[0].fields,r.host.core.save().ents.find(e=>e[11]===0)[17],3);assert.equal(body.taps,16);assert.equal(a.me.taps,16);
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

for(const via of ['a small room','Gates'])test('a valued pulse is acted on in the tick it was predicted for: a predicted swap is drawn once and never drawn back, seed 4617: '+via,async t=>{
 // `f.pulse()` travels on its own reliable message. It says which tick this browser predicted it on, and the server acts
 // on it in that tick: the snapshot of that tick then holds what was predicted, at any latency, and nothing flickers.
 const clock=virtualTime(t);
 // Snapshots arrive unevenly (every third one 34 ms late), as on a real connection: without the tick, the server acts on
 // the pulse the moment it arrives, a tick before or after the one predicted, and a toggle is then drawn twice or undone.
 for(const delay of [0,150]){const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),r=(via==='Gates'?gateRig:rig)(L,compiled,false,m=>delay+(m.t==='snap'?(m.k%3===0?38:4):0),delay);
  const predict={runner(me,input){if(input.tap)me.weapon=1-me.weapon;}};
  const a=openRoom({predict,net:{config:cfg('Swap'),WebSocketImpl:r.socket(),post:null}});await clock.wait(3000);
  for(let i=0;i<12;i++){for(let left=403+i*7;left>0;left-=4){a.pump();await clock.wait(4);}const seen=[a.me.weapon];a.input({tap:1});
   for(let n=0;n<220;n++){a.pump();if(n===2)a.input({tap:0});await clock.wait(4);if(seen[seen.length-1]!==a.me.weapon)seen.push(a.me.weapon);}
   assert.deepEqual(seen,[i%2,1-i%2],`${delay} ms each way, press ${i}: the weapon is drawn changing once: ${seen}`);}
  assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);a.close();r.stop();}
});

for(const via of ['a small room','Gates'])test('a lying client cannot inflate its rewind: delayed acknowledgements, forged acknowledgements and the cap, seed 4614: '+via,async t=>{
 // (1) The playtest's client: it holds every latency answer back 900 ms and claims a view 18 ticks old. The round trip
 //     is timed on its input frames, which it sent at once, so its answers are not what is measured.
 {const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3-open',{},null,via==='Gates'?80:8),clock=virtualTime(t),shape=predictionShaper({delay:0,loss:0,seed:4614}),r=(via==='Gates'?gateRig:rig)(L,compiled,false,shape,shape);
  class Slow extends r.socket(){send(x){const m=JSON.parse(x);if(m.t==='probeAck'){setTimeout(()=>super.send(x),900);return;}super.send(x);}}
  const a=openRoom({net:{config:cfg('Slow answers'),WebSocketImpl:Slow,post:null}});await clock.wait(4000);a.input({ax:0});
  for(let i=0;i<9;i++){const tick=r.host.core.tick;a.command('shoot',{at:tick-18,y:(tick-18)*.1});await clock.wait(400);assert.equal(a.me.hit,'',`shot ${i}: a target as it stood 900 ms ago is not hit`);}
  const tick=r.host.core.tick;a.command('shoot',{at:tick-2,y:(tick-2)*.1});await clock.wait(400);assert.notEqual(a.me.hit,'','what it really saw is still hit');a.close();r.stop();}
 // (2) A client that forges the acknowledgements on its input frames too looks 900 ms away. Without a cap it is
 //     believed, as a player who is really that far away must be; the game's cap is what bounds it.
 for(const [variant,capped] of [['round3-open',false],['round3',true]]){const {L,compiled,openRoom}=await coinDashKit('server',false,20,variant,{},null,via==='Gates'?80:8),shape=predictionShaper({delay:0,loss:0,seed:4614}),r=(via==='Gates'?gateRig:rig)(L,compiled,false,shape,shape),clock={wait:async ms=>{for(let left=ms;left>0;left--){t.mock.timers.tick(1);await new Promise(done=>setImmediate(done));}}};
  class Forger extends r.socket(){send(x){const m=JSON.parse(x);if(m.t==='probeAck'){setTimeout(()=>super.send(x),900);return;}if(m.t==='in'&&Number.isInteger(m.g))m.g-=18;super.send(JSON.stringify(m));}}
  const a=openRoom({net:{config:cfg('Forger'),WebSocketImpl:Forger,post:null}});
  await clock.wait(2500);for(let i=0;i<40;i++){a.input({ax:i%2?.01:0});await clock.wait(50);}a.input({ax:0});await clock.wait(200);
  let landed=0;for(let i=0;i<9;i++){const tick=r.host.core.tick;a.command('shoot',{at:tick-18,y:(tick-18)*.1});await clock.wait(400);if(a.me.hit)landed++;}
  if(capped)assert.equal(landed,0,'rewindSeconds .25 holds a forged 900 ms to five ticks');else assert.equal(landed,9,'without a cap a connection that looks 900 ms away is compensated for it');
  const tick=r.host.core.tick;a.command('shoot',{at:tick-3,y:(tick-3)*.1});await clock.wait(400);assert.notEqual(a.me.hit,'','inside the cap the shot is judged where the shooter saw it');
  assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);a.close();r.stop();}
});

for(const via of ['a small room','Gates'])test('a held tap whose frames arrive late still moves for the time it was down, seed 4618: '+via,async t=>{
 // Frames delayed unevenly on the way up: some entries miss their tick. The tick they missed ran on the value before
 // them; the difference is owed and paid, so the server ends where the browser predicted.
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),clock=virtualTime(t);let rng=4618;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 // One ordered connection: a frame never overtakes the one before it.
 // The frames that carry a release are the ones held up, so the tap would be stretched, not just moved later.
 let last=0,level=0;const r=(via==='Gates'?gateRig:rig)(L,compiled,false,0,(m)=>{if(m.t!=='in')return 0;const ax=Number(m.s.at(-1)?.[1])||0,falling=ax<level;level=ax;const now=Date.now(),at=Math.max(last,now+(falling?40+random()*50:0));last=at;return at-now;});
 const a=openRoom({net:{config:cfg('Late'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(2500);
 const frame=async ms=>{for(let left=ms;left>0;left-=Math.min(left,16)){a.pump();await clock.wait(Math.min(left,16));}a.pump();};
 const server=()=>r.host.core.save().ents.find(e=>e[11]===0)[7][0];
 const moved=[];for(let i=0;i<24;i++){await frame(331+i*7);const from=server();a.input({ax:1});await frame(60);a.input({ax:0});await frame(700);moved.push(server()-from);}
 const late=r.lines.filter(l=>l.ev==='ticks').reduce((n,l)=>n+(l.lateEntries??0),0);
 assert.ok(moved.every(m=>Math.abs(m-.384)<.03),`every 60 ms tap moves .384 m on the server: ${moved.map(m=>m.toFixed(3))}`);
 assert.ok(Math.abs(server()-a.me.pos.x)<.002,'and the browser agrees');assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
 t.diagnostic(`late entries logged: ${late}`);
});

test('recipient-specific fields through Gates: an owner field reaches its owner alone and a server field nobody, seed 4619',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'pulses',{},null,80),clock=virtualTime(t),seen=[];
 const r=gateRig(L,compiled,false,(m)=>{seen.push(JSON.stringify(m));return 30;},30);
 const pair=[openRoom({net:{config:cfg('One'),WebSocketImpl:r.socket(),post:null}}),openRoom({net:{config:cfg('Two'),WebSocketImpl:r.socket(),post:null}})];t.after(()=>{pair[0].close();pair[1].close();r.stop();});await clock.wait(3000);
 const [a,b]=pair;
 for(let i=0;i<12;i++){a.input({select:i%3+1});await clock.wait(1);a.input({select:0});await clock.wait(140);}
 await clock.wait(800);assert.deepEqual([...a.me.actions],Array.from({length:12},(_,i)=>i%3+1),'every valued pulse arrived once, in order, through a Gate');
 assert.equal(a.me.ammo,24,'the owner reads its own field');assert.equal(b.get(a.me.id).ammo,0,'a rival is not sent it');assert.equal(a.get(b.me.id).ammo,0);
 assert.equal(a.me.secret,'');assert.equal(b.me.secret,'');
 assert.ok(seen.length>100&&!seen.some(text=>text.includes('brain-secret')),'a server-only value was never on any wire a Gate wrote');
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

for(const [each,expect] of [[0,'hits'],[75,'mixed'],[150,'misses']])test(`a predictor judges its own shot as the server will: the pose at the judged tick, ${each} ms each way, seed 4620`,async t=>{
 // The player aims at the mover where it is DRAWN. The server judges at the tick the player saw, held to how far back
 // this seat may look (rewindSeconds .25: five ticks). Beyond that it judges a NEWER pose, and the shot misses. The
 // predictor asks for that same tick (ctx.judgedTick) and that same pose (ctx.ray atTick), so its guess is the verdict.
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3'),clock=virtualTime(t),shape=predictionShaper({delay:each*2,loss:0,seed:4620,jitter:false}),r=rig(L,compiled,false,shape,shape);
 let helper=0;const predict={runner(me,input,ctx){helper=ctx.math.add({x:1,y:0,z:0},{x:1,y:0,z:0}).x;if(input.snipe){const h=ctx.ray({x:0,y:input.aimY,z:1},{x:1,y:0,z:0},18,{kind:'mover',atTick:ctx.judgedTick(input.aimTick)});if(h&&h.entity)ctx.effect('hit',me.id,{target:h.entity});}}};
 const a=openRoom({predict,net:{config:cfg('Sniper'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(4000);
 const frame=async ms=>{for(let left=ms;left>0;left-=16){a.pump();await clock.wait(Math.min(left,16));}};
 let mover;a.each('mover',e=>mover=e);assert.ok(mover);
 // Where a body was at a tick, from the snapshots held: exact between them, a marked guess past the newest.
 const newest=Math.floor(a.viewTick),past=a.poseAt(mover.id,newest-3.5),ahead=a.poseAt(mover.id,newest+40);
 assert.ok(past.known&&Math.abs(past.pos.y-(newest-3.5)*.1)<.001,'a held tick is the pose the server kept');assert.equal(ahead.known,false,'past the newest snapshot it is a guess, and says so');
 const out=[];a.on('hit',e=>out.push(e.predicted?'predicted':e.confirms?'confirmed':'unpredicted'));a.on('retract',()=>out.push('retracted'));
 for(let i=0;i<40;i++){await frame(203+i*11);const tick=a.viewTick;a.input({ax:0,snipe:true,aimTick:tick,aimY:a.poseAt(mover.id,tick).pos.y});await frame(16);a.input({ax:0,snipe:false,aimTick:tick,aimY:a.poseAt(mover.id,tick).pos.y});} // the aim is held: a press is taken on the next tick, with the values of that tick
 await frame(1500);
 const n=k=>out.filter(x=>x===k).length;t.diagnostic(`${each} ms each way: predicted ${n('predicted')}, confirmed ${n('confirmed')}, retracted ${n('retracted')}, not predicted ${n('unpredicted')}`);
 assert.equal(helper,2,'the rules\' own math is the predictor\'s');
 assert.equal(L.P.unpackFields(compiled.kinds[0].fields,r.host.core.save().ents.find(e=>e[11]===0)[17],3).sniped,40,'every shot was taken');
 assert.ok(n('unpredicted')<=1&&n('retracted')<=1,`the guess is the verdict: ${n('unpredicted')} not predicted, ${n('retracted')} taken back of 40`);
 if(expect==='hits')assert.ok(n('confirmed')>=38,'inside the allowance every shot at the drawn target lands');
 if(expect==='misses')assert.ok(n('predicted')<=2,'far past the cap the drawn target is not where the server looks, and the predictor shows no hit');
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

for (const dims of [2,3]) for (const delayed of [false,true]) test(`wrapped world ${dims}D: two spatial views, seam interpolation, replay and restore${delayed?' with 300 ms loss':''}`,async t=>{
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,'wrap'+dims,{},3);
  const clock=virtualTime(t),shape=predictionShaper({delay:delayed?300:0,loss:delayed?.12:0,seed:4700+dims});
  const r=gateRig(L,compiled,false,shape,shape);
  const a=openRoom({net:{config:cfg('Left'),WebSocketImpl:r.socket(),post:null}}),b=openRoom({net:{config:cfg('Right'),WebSocketImpl:r.socket(),post:null}});
  t.after(()=>{a.close();b.close();r.stop();});await clock.wait(2500);
  assert.ok(a.get(b.me.id),'player is visible across the edge');assert.ok(b.get(a.me.id),'visibility is symmetric');
  assert.equal(a.me.neighbours,2);assert.equal(b.me.neighbours,2);
  let prev=a.me.pos.x,crossed=false,maxStep=0; a.input({ax:1});
  for(let i=0;i<70;i++){await clock.wait(16);const x=a.me.pos.x,d=((x-prev+30)%20)-10;maxStep=Math.max(maxStep,Math.abs(d));if(x<prev-10)crossed=true;assert.ok(Math.abs(d)<.35,`seam streak ${prev} -> ${x}`);prev=x;}
  a.input({ax:0});await clock.wait(2000);assert.ok(crossed,'body wraps instead of clamping');
  const restored=L.C.createCore(compiled,{restore:r.host.core.save()});assert.deepEqual(restored.snapshot(),r.host.core.snapshot());
  assert.equal(r.host.core.stats.errors,0);t.diagnostic(JSON.stringify({dims,delayed,maxDrawStep:maxStep,stats:r.host.core.stats}));
});

for(const delayed of [false,true])test(`generated map: atomic collision revision, flow lookup, mid-round regeneration and restore${delayed?' at 300 ms loss':''}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'generated');
 const clock=virtualTime(t),shape=predictionShaper({delay:delayed?300:0,loss:delayed?.12:0,seed:4725}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Dog'),WebSocketImpl:r.socket(),post:null}}),b=openRoom({net:{config:cfg('Hunter'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();b.close();r.stop();});
 await clock.wait(2500);assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
 assert.equal(a.map.tiles.data[255],1);assert.equal(a.me.motion.tile,1);assert.ok(a.me.motion.distance>=0);
 a.input({ax:1});await clock.wait(1800);assert.ok(Math.abs(a.me.pos.x-4.799)<.003,`wall at 5: ${a.me.pos.x}`);
 const n=a.round.n;a.command('regenerate');await clock.wait(2200);assert.equal(a.round.n,n);assert.equal(a.map.tiles.data[255],0);assert.equal(b.map.tiles.data[258],1);assert.equal(a.me.motion.tile,0);
 assert.ok(Math.abs(a.me.pos.x-7.799)<.003,`new wall at 8: ${a.me.pos.x}`);
 const saved=r.host.core.save(),restored=L.C.createCore(compiled,{restore:saved});assert.deepEqual(restored.save(),saved);assert.deepEqual(restored.snapshot(),r.host.core.snapshot());
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);assert.equal(r.host.core.stats.ticksCut,0);t.diagnostic(JSON.stringify({delayed,mapBytes:JSON.stringify(saved.maps).length,stats:r.host.core.stats}));
});

test('generated map follows offline fallback and returns to the server revision',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',true,20,'generated');
 const clock=virtualTime(t),r=rig(L,compiled),a=openRoom({net:{config:cfg('Dog'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);assert.equal(a.map.tiles.data[255],1);
 r.network.up=false;r.sockets[0].cut();await clock.wait(6500);assert.equal(a.status,'playing');
 a.command('regenerate');await clock.wait(1200);assert.equal(a.map.tiles.data[255],0);assert.equal(a.map.tiles.data[258],1);
 r.network.up=true;await clock.wait(30000);assert.equal(a.net.connected,true);assert.equal(a.net.rulesHosting,false);
 assert.equal(a.map.tiles.data[255],1,'offline map never replaces the authoritative room map');
});

test('generated map activates immediately when its pending snapshot was lost',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'generated');
 const clock=virtualTime(t);let dropped=0,received=null;
 const r=rig(L,compiled,false,m=>{
  const meta=m.d?.[2]?.[3];
  if(meta?.previousMap&&meta.map?.[1]?.tiles?.data[255]===0){dropped++;return null;}
  return 0;
 });
 const a=openRoom({net:{config:cfg('Dog'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);assert.equal(a.map.tiles.data[255],1);
 const socket=r.sockets[0],deliver=socket.onmessage;
 socket.onmessage=e=>{const m=JSON.parse(e.data);deliver.call(socket,e);if(m.t==='snap'&&m.d?.[2]?.[3]?.map?.[1]?.tiles?.data[255]===0)received=m;};
 a.command('regenerate');
 for(let ms=0;ms<500&&!received;ms++)await clock.wait(1);
 assert.ok(dropped>0,'the pending revision was lost');assert.ok(received,'the active revision arrived');
 assert.equal(a.map.tiles.data[255],0,'map activation uses its own tick, not the live collider revision tick');
});

test('300 Hz substeps draw the within-tick path with two seeded 150 ms views and restore',async t=>{
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,'substeps');
  const clock=virtualTime(t),shape=predictionShaper({delay:150,loss:0,seed:480});
  const r=rig(L,compiled,false,shape,shape);
  const a=openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});
  const b=openRoom({net:{config:cfg('Bo'),WebSocketImpl:r.socket(),post:null}});
  t.after(()=>{a.close();b.close();r.stop();});
  await clock.wait(2500);a.input({ax:1});b.input({ax:1});
  await clock.wait(1500);
  const samples=[];
  for(let i=0;i<100;i++){await clock.wait(5);samples.push(a.me.pos.x);assert.ok(b.me);}
  assert.ok(Math.max(...samples)-Math.min(...samples)>.09,'draw the out-and-back path whose tick endpoints coincide');
  assert.ok(Math.max(...samples)<.17,'substeps stay on their integrated path');
  assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
  assert.equal(r.host.core.stats.budgetStops,0);
  const saved=r.host.core.save(),restored=L.C.createCore(compiled,{restore:saved});
  assert.deepEqual(restored.save(),saved);
});

test('predictor room reads cannot pump or preview recursively during replay, seed 4804', async t => {
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,'wrap2');
  const clock=virtualTime(t);
  // Identical rooms, one observer reads during every predictor call. Snapshots land
  // between sparse frames, after a tick edge: precisely the replay reentry window.
  const rooms=[rig(L,compiled,false,157,150),rig(L,compiled,false,157,150)];
  const views=[], probes=[]; let calls=0, reads=0;
  const warnings=[]; t.mock.method(console,'warn',(...args)=>warnings.push(args.join(' ')));
  for(let n=0;n<2;n++) {
    let room;
    room=openRoom({timers:false,predict:{runner(me,input,ctx){
      calls++;
      if(n && room) {
        const tick=probes[n].prediction().tick;
        room.each('runner',e=>{reads++; assert.ok(Object.isFrozen(e));});
        const own=room.me; if(own)assert.equal(room.get(own.id).id,own.id);
        ctx.each('runner',e=>assert.ok(Object.isFrozen(e)));
        room.ray({x:0,y:0,z:0},{x:1,y:0,z:0},20);
        assert.equal(probes[n].prediction().tick,tick,'a read must not advance the clock');
      }
    }},net:{config:cfg('Reader'),WebSocketImpl:rooms[n].socket(),post:null}});
    views.push(room); probes.push(globalThis.__homieNet.probe);
  }
  t.after(()=>{for(const v of views)v.close();for(const r of rooms)r.stop();});
  let seed=4804;
  for(let i=0;i<600;i++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    if(i%17===0)for(const v of views)v.input({ax:(seed&1)?1:-1});
    await clock.wait(31+seed%29);
    for(const v of views)v.pump();
    assert.deepEqual(views[1].me?.pos,views[0].me?.pos,`frame ${i}`);
    assert.deepEqual(probes[1].prediction(),probes[0].prediction(),`reconciliation ${i}`);
  }
  assert.ok(calls>100 && reads>100);
  assert.deepEqual(warnings,[]);
});

for(const via of ['small','Gates'])for(const mode of ['drop','burst'])test(`input history under loss: ${via}, ${mode}, seed 47101`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3',{},null,via==='Gates'?80:8),clock=virtualTime(t);
 for(const delay of [40,80,150,300])for(const loss of [.005,.01,.02,.05]){
  let rng=47101,last=0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const up=m=>{if(m.t!=='in')return delay;const lost=random()<loss;if(mode==='drop')return lost?null:delay;const at=Math.max(last,Date.now()+delay+(lost?2*delay:0));last=at;return at-Date.now();};
  const r=(via==='Gates'?gateRig:rig)(L,compiled,false,delay,up),a=openRoom({net:{config:cfg('Loss'),WebSocketImpl:r.socket(),post:null}});
  let previous=null,warps=[],measuring=false;
  const frame=async ms=>{for(let left=ms;left>0;){const dt=Math.min(left,16);a.pump();await clock.wait(dt);const next=a.me?.pos.x;if(measuring&&previous!==null&&next!==undefined&&Math.abs(next-previous)>8*dt/1000+.05)warps.push([dt,previous,next,globalThis.__homieNet.probe.prediction()]);previous=next??null;left-=dt;}a.pump();};
  try{
   await frame(3000);measuring=true;previous=a.me?.pos.x??null;const server=()=>r.host.core.save().ents.find(e=>e[11]===0)[7][0];
   const distances=[];
   for(let i=0;i<12;i++){await frame(71+i*3);const from=server();a.input({ax:1});await frame(80);a.input({ax:0});await frame(1800);distances.push(server()-from);}
   assert.ok(distances.every(d=>Math.abs(d-.512)<.04),`${delay} ms ${loss}: ${distances}`);
   assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
   const row=r.room.lastSnap.c.find(row=>row[0]===0);assert.equal(row[6],471,'applied ticks survive relay projection');
   const received=globalThis.__homieNet.probe.prediction().applications;
   assert.ok(received.length>0,'the client retained applied tick receipts');
   for(const [seq,tick] of received){const i=row.indexOf(seq,7);if(i>=7&&i%2===1)assert.equal(tick,row[i+1],'client and authority agree on the applied tick');}
   assert.equal(warps.length,0,`${delay} ms ${loss}: drawn warps ${JSON.stringify(warps.slice(0,5))}`);
  }finally{a.close();r.stop();}
 }
});


for(const policy of ['hold','drop'])test(`taken pulses use explicit ${policy} policy`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'pulse-'+policy),clock=virtualTime(t),r=rig(L,compiled),a=openRoom({net:{config:cfg('Taken'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);
 for(let i=1;i<=5;i++){a.input({select:i});await clock.wait(60);a.input({select:0});}
 await clock.wait(300);assert.deepEqual([...a.me.actions],[]);
 a.command('resume');await clock.wait(700);
 assert.deepEqual([...a.me.actions],policy==='hold'?[1,2,3,4,5]:[]);
});

test('a fresh held press after ten seconds without view frames has no backlog',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'round3'),clock=virtualTime(t),r=rig(L,compiled),a=openRoom({timers:false,net:{config:cfg('Stall'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);a.pump();
 await clock.wait(10000);const from=a.me.pos.x;a.input({ax:1});
 for(let i=0;i<10;i++){await clock.wait(15);a.pump();}a.input({ax:0});
 for(let i=0;i<60;i++){await clock.wait(16);a.pump();}
 assert.ok(Math.abs(a.me.pos.x-from-.96)<.05,`150 ms moves .96 m, got ${a.me.pos.x-from}`);
});

for(const via of ['small','Gates'])test(`twenty ordered pulses a second under 300 ms and 5% stalls: ${via}, seed 47120`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'pulses',{},null,via==='Gates'?80:8),clock=virtualTime(t);
 let rng=47120,last=0;const up=m=>{if(m.t!=='ev'&&m.t!=='in')return 300;rng=(Math.imul(rng,1664525)+1013904223)>>>0;const due=Math.max(last,Date.now()+300+(rng/4294967296<.05?600:0));last=due;return due-Date.now();};
 const r=(via==='Gates'?gateRig:rig)(L,compiled,false,300,up),a=openRoom({net:{config:cfg('Mash'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 for(let i=1;i<=60;i++){a.input({select:i});await clock.wait(1);a.input({select:0});await clock.wait(49);}
 await clock.wait(1500);assert.deepEqual([...a.me.actions],Array.from({length:60},(_,i)=>i+1));
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});


test('late movement replay equals on-time nonlinear acceleration, seed 47171',async()=>{
 const {L,compiled}=await coinDashKit('server',false,20,'loss-physics');
 for(const delay of [40,80,150,300])for(const loss of [.005,.01,.02,.05])for(const mode of ['drop','burst']){
  let now=0,rng=47171,lastDue=0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const make=()=>L.H.createHost({game:'loss-physics',compiled,random:()=>.37,send(){},clock:{now:()=>now,setTimer:()=>0,clearTimer(){}}});
  const reference=make(),subject=make(),frames=[],history=[];
  for(const h of [reference,subject]){h.frame({t:'join',peer:{seat:0,id:'one',name:'One'}});h.tickNow();}
  let ax=0;
  try{for(let tick=2;tick<=400;tick++){
   now=tick*50;
   if(tick%7===0)ax=tick<360?(random()<.5?-1:1)*(random()<.3?.25:1):0;
   const row=[tick,ax,-471,tick,0];history.push(row);if(history.length>32)history.shift();
   reference.frame({t:'in',from:0,e:reference.epoch,k:tick,s:[[0,...row.slice(1)]],r:0});
   const lost=random()<loss;
   if(mode!=='drop'||!lost){const due=mode==='burst'?Math.max(lastDue,now+delay+(lost?2*delay:0)):now+delay;lastDue=due;const k=history[0][0];frames.push({due,k,s:history.map(r=>[r[0]-k,...r.slice(1)])});}
   while(frames.length&&frames[0].due<=now){const f=frames.shift();subject.frame({t:'in',from:0,e:subject.epoch,k:f.k,s:f.s,r:0});}
   reference.tickNow();subject.tickNow();
  }
  const a=reference.core.snapshot()[1][0],b=subject.core.snapshot()[1][0];
  assert.deepEqual(b.slice(3,7),a.slice(3,7),`${delay} ms, ${loss}, ${mode}: pose and velocity`);
  assert.equal(subject.core.stats.errors,0,subject.core.stats.lastError);
  }finally{reference.stop();subject.stop();}
 }
});

test('missing receipts widen input history through a loss run beyond the latency window', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'round3');
  const clock = virtualTime(t);
  let blackoutUntil = 0;
  const r = rig(L, compiled, false, 40, m => m.t === 'in' && Date.now() < blackoutUntil ? null : 40);
  const a = openRoom({ net: { config: cfg('Recovery'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(3000);
  const serverX = () => r.host.core.save().ents.find(e => e[11] === 0)[7][0];
  const from = serverX();
  blackoutUntil = Date.now() + 650;
  a.input({ ax: 1 }); await clock.wait(80); a.input({ ax: 0 });
  await clock.wait(2000);
  // At 6.4 m/s an 80 ms tap travels .512 m. The 4 cm allowance covers
  // clock phase/held quantization; it is less than one 20 Hz physics step.
  assert.ok(Math.abs(serverX() - from - .512) < .04, `recovered tap: ${serverX() - from}`);
  assert.ok(Math.abs(a.me.pos.x - serverX()) < .001, 'the replay converges');
});

for (const via of ['small', 'Gates']) test(`a placement projects the body to its own tick without a second correction: ${via}`, async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'placement-clock', {}, null, via === 'Gates' ? 80 : 8);
  const clock = virtualTime(t), r = (via === 'Gates' ? gateRig : rig)(L, compiled, false, 300, 300);
  const a = openRoom({ net: { config: cfg('Placed'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(3000);
  const probe = globalThis.__homieNet.probe.prediction;
  let count = probe().count, worst = 0;
  a.command('respawn');
  for (let n = 0; n < 150; n++) {
    await clock.wait(16); a.pump();
    const p = probe();
    if (p.count !== count) worst = Math.max(worst, p.last);
    count = p.count;
  }
  assert.ok(a.me.pos.x >= 100, 'the placement arrived');
  assert.ok(worst < .002, `the new pose must not acquire a latency-sized correction: ${worst}`);
});

 test('a prior placement cannot inject held controls into the respawned body', async () => {
  const { L, compiled } = await coinDashKit('server', false, 20, 'placement-clock');
  let now = 0;
  const h = L.H.createHost({ game: 'placed', compiled, random: () => .37, send() {}, clock: { now: () => now, setTimer: () => 0, clearTimer() {} } });
  const step = () => { now += 50; h.tickNow(); };
  try {
    h.frame({ t: 'join', peer: { seat: 0, id: 'one', name: 'One' } }); step();
    const oldR = h.core.bodyOf(0).r;
    h.frame({ t: 'in', from: 0, e: h.epoch, k: h.core.tick + 6, r: oldR, s: [[0, 1, -471, 10, 0]] });
    h.frame({ t: 'ev', from: 0, k: 'cmd', d: ['respawn', {}] }); step();
    const r = h.core.bodyOf(0).r;
    assert.notEqual(r, oldR);
    const from = h.core.snapshot()[1][0][3][0];
    h.frame({ t: 'in', from: 0, e: h.epoch, k: h.core.tick + 1, r, s: [[0, 0, -471, 11, 0]] });
    h.frame({ t: 'in', from: 0, e: h.epoch, k: h.core.tick + 2, r: oldR, s: [[0, 1, -471, 12, 0]] });
    for (let n = 0; n < 12; n++) step();
    assert.ok(Math.abs(h.core.snapshot()[1][0][3][0] - from - 1.2) < .001, 'both queued and newly arriving stale controls are fenced');
  } finally { h.stop(); }
 });

test('an acknowledged release does not stop recovery of the missing tap before it', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'round3');
  const clock = virtualTime(t), r = rig(L, compiled, false, 40, 40);
  const Socket = r.socket();
  let recoverAt = 0;
  class HoleSocket extends Socket {
    send(text) {
      const m = JSON.parse(text);
      if (m.t === 'in' && Date.now() < recoverAt) m.s = m.s.filter(row => row[1] === 0);
      super.send(JSON.stringify(m));
    }
  }
  const a = openRoom({ net: { config: cfg('Hole'), WebSocketImpl: HoleSocket, post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(3000);
  const serverX = () => r.host.core.save().ents.find(e => e[11] === 0)[7][0];
  const from = serverX();
  recoverAt = Date.now() + 200;
  a.input({ ax: 1 }); await clock.wait(80); a.input({ ax: 0 });
  await clock.wait(240);
  assert.ok(Math.abs(serverX() - from - .512) < .04, `the earlier hole is recovered before an idle keepalive: ${serverX() - from}`);
});

 test('vertical travel cannot blend a horizontal correction against the held direction', async t => {
  const { L, compiled, openRoom } = await coinDashKit('server', false, 20, 'diagonal-push');
  const clock = virtualTime(t), r = rig(L, compiled, false, 300, 300);
  const a = openRoom({ net: { config: cfg('Diagonal'), WebSocketImpl: r.socket(), post: null } });
  t.after(() => { a.close(); r.stop(); });
  await clock.wait(3000); a.input({ ax: 127 }); await clock.wait(1500);
  a.command('bump');
  let previous = a.me.pos.x, worst = 0;
  for (let i = 0; i < 180; i++) {
    await clock.wait(16);
    const x = a.me.pos.x; worst = Math.min(worst, x - previous); previous = x;
  }
  assert.ok(worst >= -.001, `movement and the authoritative pause never move left, but drawing moved ${worst}`);
 });

// These nine compatibility cases also run unchanged against d9985c5a (0.48.0).
// The 0.48.1 runtime fails all nine; see docs/receipts/hit-rewind-0483.json.
for(const [delay,loss] of [[0,0],[75,0],[75,.02]])for(const trigger of ['held','pulse'])test(`rewind stream preserves ${trigger} aimed shots and cadence: ${delay} ms each way, ${loss} loss, seed 48301`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'rewind-stream');
 const clock=virtualTime(t),shape=predictionShaper({delay:delay*2,loss,seed:48301,jitter:false}),r=rig(L,compiled,false,shape,shape);
 const predicted=new Map(),shots=[],feedback=[];
 const a=openRoom({predict:{runner(me,i,c){if((i.fire||i.tap)&&c.tick>=me.next){me.next=c.tick+4;me.shots++;const judged=c.judgedTick(i.aimTick),h=c.ray({x:0,y:i.aimY,z:1},{x:1,y:0,z:0},18,{kind:'target',atTick:judged});if(!c.preview)predicted.set(c.tick,{aim:i.aimTick,y:i.aimY,judged,hit:!!h});if(h)c.effect('hit',me.id,{target:h.entity});}}},net:{config:cfg('Rewind'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(4000);
 a.on('shot',e=>shots.push(e));a.on('hit',e=>feedback.push(e.predicted?'predicted':e.confirms?'confirmed':'unpredicted'));a.on('retract',()=>feedback.push('retracted'));
 let target;a.each('target',e=>target=e);
 for(let frame=0;frame<600;frame++){
  const aimTick=a.viewTick,aimY=a.poseAt(target.id,aimTick).pos.y;
  // Release between cadence ticks, so packet phase cannot create a boundary shot.
  a.input({ax:0,fire:trigger==='held'&&frame<595,tap:trigger==='pulse'?Number(frame%12===0):Number(frame===0),aimTick,aimY,...Object.fromEntries(Array.from({length:16},(_,i)=>['look'+i,Math.sin(frame*.13+i)*10]))});
  await clock.wait(frame%3===2?18:16);
 }
 a.input({fire:false});await clock.wait(1000);
 const matched=shots.filter(e=>{const p=predicted.get(e.tick);return p&&p.hit===e.hit&&Math.abs(p.aim-e.aim)<.001&&Math.abs(p.y-e.y)<.001;});
 t.diagnostic(JSON.stringify({delay,loss,trigger,shots:shots.length,matched:matched.length,feedback:Object.fromEntries(['predicted','confirmed','unpredicted','retracted'].map(k=>[k,feedback.filter(x=>x===k).length])),oversize:r.room.stats.oversize,maxBytes:Math.max(...r.sockets[0].sent.filter(m=>m.t==='in').map(m=>JSON.stringify(m).length))}));
 assert.equal(r.room.stats.oversize,0,'history must fit the existing relay input byte limit');
 assert.equal(shots.length,50,`${trigger} cadence: fifty shots in ten seconds, as in 0.48.0`);
 assert.equal(a.net.stats().rtt,delay*2,'history must not change measured round trip');
 assert.equal(r.room.lastSnap.c.find(row=>row[0]===a.seat)[5],5,'rewind bound remains RTT plus presentation and input wait, capped at five ticks');
 for(const e of shots){const p=predicted.get(e.tick);if(p)assert.ok(Math.abs(p.judged-Math.max(e.tick-5,p.aim))<.001,'ctx.judgedTick names the same capped pose the server judges');}
 assert.ok(matched.length>=shots.length-2,`${matched.length}/${shots.length} shots have the predicted aim and verdict`);
 assert.ok(feedback.filter(x=>x==='confirmed').length>=49,'0.48.0 confirmed at least 49 of the 50 predicted effects on this seed');
 assert.ok(feedback.filter(x=>x==='retracted').length<=(loss?1:0),'predicted hit binding is at least as good as 0.48.0');
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

for(const delay of [0,75])test(`wide input preserves sub-tick held durations: ${delay} ms each way, seed 48302`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'rewind-stream');
 const clock=virtualTime(t),shape=predictionShaper({delay:delay*2,loss:0,seed:48302,jitter:false}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Held audit'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(4000);
 let rng=48302;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
 const send=ax=>a.input({ax,...Object.fromEntries(Array.from({length:16},(_,i)=>['look'+i,random()*20-10]))});
 const serverX=()=>r.host.core.save().ents.find(e=>e[11]===0)[7][0];
 for(const duration of [30,60,120])for(let i=0;i<8;i++){
  await clock.wait(250+Math.floor(random()*50));const before=serverX();send(1);
  for(let left=duration;left>0;){const step=Math.min(left,7);await clock.wait(step);left-=step;if(left)send(1);}
  send(0);await clock.wait(700);
  assert.ok(Math.abs(serverX()-before-duration/1000*6.4)<.025,`${duration} ms integrates to ${duration/1000*6.4} m, as in 0.48.0`);
  assert.ok(Math.abs(a.me.pos.x-serverX())<.01,'client and server settle to the same held duration');
 }
 assert.equal(r.room.stats.oversize,0);assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});


test('wide input preserves every numbered swap exactly once under repeated history, seed 48303',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'rewind-stream');
 const clock=virtualTime(t),shape=predictionShaper({delay:150,loss:.02,seed:48303,jitter:false}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Swap audit'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});await clock.wait(4000);
 for(let frame=0;frame<600;frame++){
  a.input({swap:frame%12===0?frame/12+1:0,...Object.fromEntries(Array.from({length:16},(_,i)=>['look'+i,Math.sin(frame*.13+i)*10]))});
  await clock.wait(frame%3===2?18:16);
 }
 await clock.wait(1000);
 assert.deepEqual([...a.me.swaps],Array.from({length:50},(_,i)=>i+1),'same ordered swaps as 0.48.0, without losses or duplicates');
 assert.equal(r.room.stats.oversize,0);assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});

for (const seed of [17,41,83]) test(`own drawing stays outside a solid ledge under repeated TCP stalls seed ${seed}`, async t => {
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground');
  const clock=virtualTime(t);let random=seed;const lanes=new Map();
  const lag=(m,l)=>{random=(Math.imul(random,1664525)+1013904223)>>>0;const due=Math.max(Date.now()+300+(random/4294967296<.05?600:0),lanes.get(l)??0);lanes.set(l,due);return due-Date.now();};
  const r=rig(L,compiled,false,(m,l)=>lag(m,'d'+l),(m,l)=>lag(m,'u'+l));
  const a=openRoom({net:{config:cfg('Ledge'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});
  await clock.wait(3000);let worst=0,example;
  for(let n=0;n<2400;n++){
    if(n%300===0)a.command('respawn');
    a.input({ax:n%300<100?1:n%300<180?-1:0,jump:n%97<5?1:0});
    await clock.wait(16);const p=a.me?.pos;if(!p)continue;
    for(const box of [{min:{x:-8,y:0},max:{x:0,y:5}},{min:{x:-20,y:12},max:{x:20,y:15}}]){
      const d=Math.min(p.x+.5-box.min.x,box.max.x-p.x+.5,p.y+.5-box.min.y,box.max.y-p.y+.5);
      if(d>worst){worst=d;example={n,p};}
    }
  }
  assert.ok(worst<=.1,`penetration ${worst}: ${JSON.stringify(example)}`);
});

 test('a square runner retains its shape on the wire and cannot enter an exact-contact floor', async t => {
  const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
  assert.equal(L.R.schemaOf(compiled).kinds.find(k=>k.name==='runner').shape,'box');
  const clock=virtualTime(t),r=rig(L,compiled,false,300,300);
  const a=openRoom({net:{config:cfg('Square'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});
  await clock.wait(3000);
  for(let n=0;n<120;n++){await clock.wait(16);assert.equal(a.me.pos.y,-.5,'zero-gap contact stops inward gravity');}
  a.input({jump:1});let minY=-.5;
  for(let n=0;n<60;n++){await clock.wait(16);minY=Math.min(minY,a.me.pos.y);}
  assert.ok(minY<-2,'the same contact lets the body jump away');
 });
for(const delay of [80,150,300])test(`counter-dash leaves knock catch-up on the press without a pose discontinuity: ${delay} ms`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'counter-knock',{catchM:.44,catchUp:1});
 const clock=virtualTime(t),r=rig(L,compiled,false,delay,delay);t.after(()=>r.stop());
 const a=openRoom({net:{config:cfg('Ada'),WebSocketImpl:r.socket(),post:null}});t.after(()=>a.close());
 await clock.wait(12000);a.command('launch');
 let caught=false;
 for(let i=0;i<120;i++){await clock.wait(16);void a.me;if(globalThis.__homieNet.probe.prediction().catchTick!==null){caught=true;break;}}
 assert.ok(caught,'real server knock entered catch-up');
 for(let i=0;i<12;i++){await clock.wait(16);void a.me;}
 const before=a.me.pos;a.input({dash:1});const immediate=a.me.pos;
 assert.ok(Math.hypot(immediate.x-before.x,immediate.y-before.y)<.001,'press preserves the drawn origin');
 await clock.wait(16);const next=a.me.pos;
 assert.ok(next.y<before.y-.05,`the counter moves on the next frame: ${before.y} -> ${next.y}`);
 let previous=next,largest=0;
 for(let i=0;i<120;i++){await clock.wait(16);const p=a.me.pos;largest=Math.max(largest,Math.hypot(p.x-previous.x,p.y-previous.y));previous=p;}
 assert.ok(largest<.7,`continuous frames: ${largest} m`);
 const authority=r.host.core.snapshot()[1].find(e=>e[9]===a.seat)[3];
 assert.ok(Math.hypot(a.me.pos.x-authority[0],a.me.pos.y-authority[1])<.001,'the blend converges to authority');
 assert.equal(r.host.core.stats.errors,0);
});

for (const seed of [17,41,83]) test(`solid correction remains continuous after placement, seed ${seed}`, async t => {
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),shape=predictionShaper({delay:300,loss:.05,seed,jitter:true}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Continuity'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});
 let placed=false;a.on('placed',()=>{placed=true;});await clock.wait(3000);
 let previous=a.me.pos,worst=0;
 for(let n=0;n<2400;n++){
  placed=false;if(n%300===0)a.command('respawn');
  a.input({ax:n%300<100?1:n%300<180?-1:0,jump:n%97<5?1:0});
  await clock.wait(16);const p=a.me.pos;
  if(!placed)worst=Math.max(worst,Math.hypot(p.x-previous.x,p.y-previous.y));previous=p;
 }
 assert.ok(worst<1.5,`non-placement frame moved ${worst} metres`);
});

test('a correction across a ledge cannot change the drawn side in one frame',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80),a=openRoom({net:{config:cfg('Corner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const socket=r.sockets[0],receive=socket.onmessage;socket.onmessage=event=>{const f=JSON.parse(event.data);if(f.t==='snap'){const own=f.d[1].find(e=>e[9]===a.seat);own[3][0]=2;own[3][1]=11.5;}receive.call(socket,{data:JSON.stringify(f)});};
 let p=a.me.pos,worst=0;
 for(let i=0;i<480;i++){await clock.wait(16);let q=a.me.pos;
 for(const box of [{min:{x:-8,y:0},max:{x:0,y:5}},{min:{x:-20,y:12},max:{x:20,y:15}}])assert.ok(Math.min(q.x+.5-box.min.x,box.max.x-q.x+.5,q.y+.5-box.min.y,box.max.y-q.y+.5)<=.1,'the entire route remains outside solids');
 worst=Math.max(worst,Math.hypot(q.x-p.x,q.y-p.y));p=q;}
 t.diagnostic(JSON.stringify({p,worst,stats:r.host.core.stats}));
 assert.ok(worst<1.5,`correction jumped ${worst} metres`);
 assert.ok(Math.abs(p.x-2)<.01&&Math.abs(p.y-11.5)<.01,'eventually reaches authority around the ledge');
});
test('a correction below the same ledge routes around its edge',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80),a=openRoom({net:{config:cfg('Corner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const socket=r.sockets[0],receive=socket.onmessage;socket.onmessage=event=>{const f=JSON.parse(event.data);if(f.t==='snap'){const own=f.d[1].find(e=>e[9]===a.seat);own[3][0]=-3;own[3][1]=11.5;}receive.call(socket,{data:JSON.stringify(f)});};
 let p=a.me.pos,worst=0;
 for(let i=0;i<480;i++){await clock.wait(16);let q=a.me.pos;
 for(const box of [{min:{x:-8,y:0},max:{x:0,y:5}},{min:{x:-20,y:12},max:{x:20,y:15}}])assert.ok(Math.min(q.x+.5-box.min.x,box.max.x-q.x+.5,q.y+.5-box.min.y,box.max.y-q.y+.5)<=.1,'the entire route remains outside solids');
 worst=Math.max(worst,Math.hypot(q.x-p.x,q.y-p.y));p=q;}
 t.diagnostic(JSON.stringify({p,worst,stats:r.host.core.stats}));
 assert.ok(worst<1.5,`correction jumped ${worst} metres`);
 assert.ok(Math.abs(p.x+3)<.01&&Math.abs(p.y-11.5)<.01,'eventually reaches authority around the ledge');
});

test('unchanged substep forecasts execute once across repeated view reads and refresh on input', async t => {
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'substeps');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80);let calls=0;
 const a=openRoom({move:{runner(b,i,c){calls++;c.substeps(b,60,s=>{b.pos={x:b.pos.x+i.ax*s.dt,y:b.pos.y,z:0};});}},net:{config:cfg('Forecast'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const before=a.me.pos, warm=calls;
 for(let i=0;i<100;i++)assert.deepEqual(a.me.pos,before);
 assert.equal(calls,warm,'the guarded movement result is reused for identical arguments');
 a.input({ax:1});await clock.wait(16);void a.me;
 assert.ok(calls>warm,'a changed input executes movement');
});

test('an entity traversal samples one presentation time for the entire group', async t => {
 const {L,compiled,openRoom}=await coinDashKit();
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80);
 const a=openRoom({net:{config:cfg('Sample'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const sample=a.net.sample;let calls=0,count=0;
 a.net.sample=(...args)=>{calls++;return sample(...args);};
 a.each('coin',()=>count++);
 assert.ok(count>1,'a real group of remote entities is drawn');
 assert.equal(calls,1,'every entity in a traversal uses the same network sample');
});

test('box presentation preserves an uncorrected substep jump arc through its apex', async t => {
 const circle=await coinDashKit('server',false,20,'solid-ground');
 const box=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),rc=rig(circle.L,circle.compiled,false,0,0),rb=rig(box.L,box.compiled,false,0,0);
 const a=circle.openRoom({net:{config:cfg('Circle arc'),WebSocketImpl:rc.socket(),post:null}});
 const b=box.openRoom({net:{config:cfg('Box arc'),WebSocketImpl:rb.socket(),post:null}});
 t.after(()=>{a.close();b.close();rc.stop();rb.stop();});await clock.wait(3000);
 let worst=0,example;
 for(const phase of [0,7,13]) {
  a.input({jump:0});b.input({jump:0});a.command('respawn');b.command('respawn');await clock.wait(1000+phase);
  const ay=a.me.pos.y,by=b.me.pos.y;a.input({jump:1});b.input({jump:1});
  for(let i=0;i<80;i++) {await clock.wait(16);if(i===3){a.input({jump:0});b.input({jump:0});}
   const delta=Math.abs((a.me.pos.y-ay)-(b.me.pos.y-by));if(delta>worst){worst=delta;example={phase,i,ay,by,a:a.me,b:b.me};}
  }
 }
 t.diagnostic(JSON.stringify({worst,example}));
 assert.ok(worst<.002,`the same vertical substeps diverged by ${worst} metres`);
});

test('interpolated remote poses do not fill the snapshot cache with one-use keys',async t=>{
 const {L,compiled,openRoom}=await coinDashKit();const clock=virtualTime(t),r=rig(L,compiled,false,0,0);
 const a=openRoom({net:{config:cfg('Viewer'),WebSocketImpl:r.socket(),post:null}}),b=openRoom({net:{config:cfg('Runner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();b.close();r.stop();});await clock.wait(5000);b.input({ax:0,ay:127});await clock.wait(317);
 let id;a.each('runner',e=>{if(e.seat===b.seat)id=e.id;});assert.ok(id);void a.get(id);
 const set=WeakMap.prototype.set;let transient=0,first,second;
 WeakMap.prototype.set=function(key,value){if(key?.id===id&&key?.fields)transient++;return set.call(this,key,value);};
 try{first=a.get(id);second=a.get(id);}finally{WeakMap.prototype.set=set;}
 assert.deepEqual(first.pos,second.pos);assert.ok(Object.isFrozen(first));assert.ok(Math.hypot(first.vel.x,first.vel.y)>1,'the remote body is moving');
 assert.equal(transient,0,'a freshly interpolated pose cannot be reused as a snapshot cache key');
});

test('unchanged delta snapshot rows reuse their immutable unpacked view',async t=>{
 const {L,compiled,openRoom}=await coinDashKit();const clock=virtualTime(t),r=rig(L,compiled,false,0,0);
 const a=openRoom({net:{config:cfg('Static rows'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const coins=new Map();a.each('coin',e=>coins.set(e.id,e));assert.ok(coins.size);let snapshots=0;a.net.on('snapshot',()=>snapshots++);
 await clock.wait(100);assert.ok(snapshots>0,'a newer snapshot arrived');
 let compared=0;a.each('coin',e=>{const before=coins.get(e.id);if(before&&JSON.stringify(before)===JSON.stringify(e)){compared++;assert.strictEqual(e,before,'an unchanged row does not allocate another immutable entity');}});assert.ok(compared,'some unchanged coins remain');
 const before=a.me.pos;a.input({ax:127});await clock.wait(100);
 assert.ok(a.me.pos.x>before.x,'changed own rows still advance');
});

test('a blocked correction does not route backwards against continuing horizontal movement',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80),a=openRoom({net:{config:cfg('Forward route'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const socket=r.sockets[0],receive=socket.onmessage;
 socket.onmessage=event=>{const f=JSON.parse(event.data);if(f.t==='snap'){const own=f.d[1].find(e=>e[9]===a.seat);own[3][0]=-3;own[3][1]=11.5;own[4][0]=-6;}receive.call(socket,{data:JSON.stringify(f)});};
 a.input({ax:-1});let p=a.me.pos,worstReverse=0;
 for(let i=0;i<240;i++){await clock.wait(16);const q=a.me.pos;if(i>10)worstReverse=Math.max(worstReverse,q.x-p.x);p=q;}
 t.diagnostic(JSON.stringify({worstReverse}));
 assert.ok(worstReverse<.01,`a correction routed backwards ${worstReverse} metres in one frame`);
});

test('held correction direction survives zero velocity at contact and neutral input can converge',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80);
 const a=openRoom({correctionDirection:i=>Number(i.ax)||0,move:{runner(b){b.vel={x:0,y:0,z:0};}},net:{config:cfg('Contact intent'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const socket=r.sockets[0],receive=socket.onmessage;
 socket.onmessage=event=>{const f=JSON.parse(event.data);if(f.t==='snap'){const own=f.d[1].find(e=>e[9]===a.seat);own[3][0]=-3;own[3][1]=11.5;own[4][0]=0;}receive.call(socket,{data:JSON.stringify(f)});};
 a.input({ax:1});let p=a.me.pos,worstReverse=0;
 for(let i=0;i<480;i++){await clock.wait(16);const q=a.me.pos;if(i>10)worstReverse=Math.max(worstReverse,p.x-q.x);p=q;}
 t.diagnostic(JSON.stringify({worstReverse}));
 assert.ok(worstReverse<.01,`held input was reversed at contact by ${worstReverse} metres`);
 a.input({ax:0});for(let i=0;i<480;i++){await clock.wait(16);p=a.me.pos;}
 assert.ok(Math.abs(p.x+3)<.01&&Math.abs(p.y-11.5)<.01,'neutral input releases the direction constraint and converges');
});

test('a delayed rendered frame cannot spend a multi-body-length movement backlog at once',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80),a=openRoom({net:{config:cfg('Delayed frame'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);a.input({ax:1});
 for(let i=0;i<12;i++){await clock.wait(16);void a.me;}
 const before=a.me.pos;await clock.wait(500);const after=a.me.pos;
 const gap=Math.hypot(after.x-before.x,after.y-before.y);t.diagnostic(JSON.stringify({gap}));
 assert.ok(gap<1.5,`the delayed frame moved ${gap} metres`);
 a.input({ax:0});for(let i=0;i<240;i++){await clock.wait(16);void a.me;}
 const authority=r.host.core.snapshot()[1].find(e=>e[9]===a.seat)[3];
 assert.ok(Math.hypot(a.me.pos.x-authority[0],a.me.pos.y-authority[1])<.01,'the limited drawing still converges after release');
});

test('a stationary correction uses blend speed rather than the declared terminal fall speed',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80);
 const a=openRoom({move:{runner(b){b.vel={x:0,y:0,z:0};}},net:{config:cfg('Blend speed'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const socket=r.sockets[0],receive=socket.onmessage;
 socket.onmessage=event=>{const f=JSON.parse(event.data);if(f.t==='snap'){const own=f.d[1].find(e=>e[9]===a.seat);own[3][0]=2;own[3][1]=11.5;own[4][0]=0;own[4][1]=0;}receive.call(socket,{data:JSON.stringify(f)});};
 let p=a.me.pos,worst=0;
 for(let i=0;i<480;i++){await clock.wait(16);const q=a.me.pos;worst=Math.max(worst,Math.hypot(q.x-p.x,q.y-p.y));p=q;}
 t.diagnostic(JSON.stringify({worst,p}));
 assert.ok(worst<.12,`a stationary correction spent fall-speed travel: ${worst} metres per 16 ms`);
 assert.ok(Math.abs(p.x-2)<.01&&Math.abs(p.y-11.5)<.01,'the slow blend still reaches authority around solids');
});

test('explicit correction intent overrides an opposite stale replay velocity',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80);
 const a=openRoom({correctionDirection:i=>Number(i.ax)||0,move:{runner(b){b.vel={x:-6,y:0,z:0};}},net:{config:cfg('Stale velocity'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 const socket=r.sockets[0],receive=socket.onmessage;
 socket.onmessage=event=>{const f=JSON.parse(event.data);if(f.t==='snap'){const own=f.d[1].find(e=>e[9]===a.seat);own[3][0]=-15;own[3][1]=11.5;own[4][0]=-6;}receive.call(socket,{data:JSON.stringify(f)});};
 a.input({ax:1});let p=a.me.pos,worstReverse=0;
 for(let i=0;i<240;i++){await clock.wait(16);const q=a.me.pos;if(i>40)worstReverse=Math.max(worstReverse,p.x-q.x);p=q;}
 t.diagnostic(JSON.stringify({worstReverse}));
 assert.ok(worstReverse<.01,`stale velocity overrode explicit intent by ${worstReverse} metres`);
});

for(const respawn of [false,true])test(`a reconnect after an outage ${respawn?'draws a placement the game names at once':'draws the own box runner continuously to where the server moved it'}`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'solid-ground-box');
 const clock=virtualTime(t),r=rig(L,compiled,false,80,80),asked=[],a=openRoom({respawned:(before,after)=>{asked.push([before.pos.x,after.pos.x]);return respawn;},net:{config:cfg('Outage'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);
 a.input({ax:1});await clock.wait(200);
 let p=a.me.pos,worst=0,at=null,back=0;
 const step=()=>{const q=a.me?.pos;if(!q)return;const d=Math.hypot(q.x-p.x,q.y-p.y);if(d>worst){worst=d;at={from:p,to:q,connected:a.net.connected};}p=q;};
 // The server still has the key held; this browser lets go while it cannot say so.
 r.network.up=false;r.sockets[0].cut();a.input({ax:0});
 for(let i=0;i<120;i++){await clock.wait(16);step();}
 r.network.up=true;
 for(let i=0;i<2000;i++){await clock.wait(16);step();if(a.net.connected&&!back)back=i;}
 t.diagnostic(JSON.stringify({worst,at,back,end:p}));
 assert.ok(back>0,'the view reconnected');
 assert.equal(asked.length,1,'the game is asked once about the returned revision');
 if(respawn){assert.ok(worst>.8,`a named placement is drawn at once, not glided (${worst})`);return;}
 // A return is not a placement: the body glides by about a frame's travel plus blend, never cut by its full error.
 assert.ok(worst<.5,`the reconnect cut the runner ${worst} metres in one frame`);
});

for (const delay of [0,150,300]) test(`validated owner keeps its own trajectory with delayed reports: ${delay} ms`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),shape=predictionShaper({delay,loss:.03,seed:116,jitter:true}),r=rig(L,compiled,false,shape,shape);
 const a=openRoom({net:{config:cfg('Owner'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});
 await clock.wait(4000);const x=a.me.pos.x;let previous=x;
 a.input({ax:1});
 for(let i=0;i<300;i++){await clock.wait(16);const p=a.me.pos.x;assert.ok(p>=previous-1e-6,`${previous} -> ${p}`);assert.ok(p-previous<.1,'no correction cut during valid movement');previous=p;}
 assert.ok(previous-x>18,'local motion stays at four units per second');
 assert.equal(r.host.core.stats.held,0,'all honest reports accepted');
 assert.equal(globalThis.__homieNet.probe.prediction().snaps,0);
 a.input({ax:0});await clock.wait(1500);const stop=a.me.pos.x;await clock.wait(1000);assert.equal(a.me.pos.x,stop,'snapshots cannot slide a stopped owner');
 a.command('point');await clock.wait(1500);assert.equal(a.me.score,1);
 let placed=null;a.on('placed',e=>placed=e.pos);a.command('respawn');await clock.wait(1500);assert.deepEqual(placed,{x:0,y:.5,z:0});assert.equal(a.me.pos.x,0);
 a.command('knock');await clock.wait(1500);assert.ok(a.me.pos.x>0,'server motion event cuts and then simulates locally');
 assert.equal(r.host.core.stats.errors,0,r.host.core.stats.lastError);
});
test('validated owner predicts through an outage, keeps score, and resumes without a wait',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled);const observer=openRoom({net:{config:cfg('Observer'),WebSocketImpl:r.socket(),post:null}});await clock.wait(300);const a=openRoom({net:{config:cfg('Owner outage'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();observer.close();r.stop();});
 await clock.wait(1000);a.command('point');await clock.wait(300);assert.equal(a.me.score,1);a.input({ax:1});await clock.wait(200);
 r.network.up=false;r.sockets.at(-1).cut();const x=a.me.pos.x;
 await clock.wait(8000);assert.ok(a.me.pos.x>x+30,'local physics continues');assert.equal(a.me.score,1);assert.equal(a.net.isHost,false,'no offline score authority');
 r.network.up=true;let prev=a.me.pos.x;for(let i=0;i<220;i++){await clock.wait(16);const x=a.me.pos.x;assert.ok(x>=prev-1e-6 && x-prev<.1,`return changed own trajectory: ${prev} -> ${x}`);prev=x;}assert.equal(a.net.connected,true);assert.equal(a.me.score,1);
 const resumed=a.me.pos.x;await clock.wait(100);assert.ok(a.me.pos.x>resumed+.3,'input moves immediately after return');
 assert.equal(r.host.core.stats.held,0);
});

test('validated owner draws a local corner landing without embedding the interpolated box',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-corner');
 const clock=virtualTime(t),r=rig(L,compiled),a=openRoom({net:{config:cfg('Corner'),WebSocketImpl:r.socket(),post:null}});t.after(()=>{a.close();r.stop();});
 await clock.wait(1000);assert.ok(a.me.pos.x>1.5);a.input({ax:1});
 for(let i=0;i<60;i++){await clock.wait(1);const p=a.me.pos;assert.ok(!(p.x-.5<1-1e-7 && p.y+.5>1+1e-7),`embedded local draw ${JSON.stringify(p)}`);}
 assert.ok(Math.abs(a.me.pos.x-1.35)<1e-6 && Math.abs(a.me.pos.y-.5)<1e-6);assert.equal(r.host.core.stats.held,0);
});

test('a slow synchronous reader crossing a tick boundary shares the current presentation', async t => {
 const {L,compiled,openRoom}=await coinDashKit('server',false,60,'push-effects');
 const clock=virtualTime(t);
 const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
 globalThis.window={addEventListener(){},removeEventListener(){}};
 t.after(()=>{if(previous)Object.defineProperty(globalThis,'window',previous);else delete globalThis.window;});
 const r=rig(L,compiled,false,25,25),a=openRoom({timers:false,net:{config:cfg('Slow reader'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(3000);a.input({ax:127});await clock.wait(100);
 const first=a.me,now=performance.now;
 performance.now=()=>now()+40; // CPU work crosses two ticks without an event-loop/microtask boundary.
 assert.equal(a.me,first);
 await Promise.resolve();assert.notEqual(a.me,first);
});

for (const stall of [3000,15000]) test(`validated owner recovers room clock after ${stall} ms server stall`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t);let until=0;
 const r=rig(L,compiled,{enforceOverrun:true,clock:{now:()=>Date.now(),setTimer:(fn,ms)=>{
   const run=()=>Date.now()<until?setTimeout(run,until-Date.now()):fn();return setTimeout(run,ms);
 },clearTimer:h=>clearTimeout(h)}});
 const a=openRoom({net:{config:cfg('Stalled owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);a.input({ax:1});await clock.wait(500);
 const revision=r.host.core.bodies()[0].r;
 until=Date.now()+stall;await clock.wait(stall+2000);
 assert.equal(r.host.core.stats.held,0,'an honest stalled owner must not be rejected');
 assert.equal(r.host.core.bodies()[0].r,revision,'recovery must not cut to an old authority pose');
 const start=r.host.core.listeners()[0].pos.x;await clock.wait(1000);
 assert.ok(r.host.core.listeners()[0].pos.x>start+3,'others see movement after recovery');
 a.command('point');await clock.wait(300);assert.equal(a.me.score,1,'score still confirms');
 assert.ok(Math.abs(globalThis.__homieNet.probe.prediction().tick-r.host.tick)<20,'clock is bounded');
});
test('validated owner retains unacknowledged reports while the server tick is stopped',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t);let until=0;
 const r=rig(L,compiled,{enforceOverrun:true,clock:{now:()=>Date.now(),setTimer:(fn,ms)=>{
  const run=()=>Date.now()<until?setTimeout(run,until-Date.now()):fn();return setTimeout(run,ms);
 },clearTimer:h=>clearTimeout(h)}},0,m=>m.t==='in'&&Date.now()<until?null:0);
 const a=openRoom({net:{config:cfg('Retained stalled owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);a.input({ax:1});await clock.wait(500);
 const revision=r.host.core.bodies()[0].r;until=Date.now()+15000;await clock.wait(18000);
 assert.equal(r.host.core.bodies()[0].r,revision,'no authority cut after packet loss during a stall');
 assert.equal(r.host.core.stats.held,0);
 assert.ok(Math.abs(a.me.pos.x-r.host.core.listeners()[0].pos.x)<1,'authority must catch up, not wait on an evicted report');
});
test('a delayed owner placement starts fresh reports near arrival time without granting travel', async t => {
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled,false,300,300);
 const a=openRoom({net:{config:cfg('Contact clock'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(4000);
 a.input({ax:1});await clock.wait(500);a.input({ax:0});
 a.command('respawn');await clock.wait(1500);
 assert.equal(a.me.pos.x,0,'clock lead does not project away from the spawn');
 a.input({ax:1});const ages=[];
 for(let i=0;i<40;i++){
   await clock.wait(50);
   const id=r.host.core.listeners()[0].id;
   for(const pose of r.host.core.world.movement(id)) ages.push(r.host.tick-pose.tick);
 }
 assert.ok(ages.length>20,'observed accepted movement, not just local predictions');
 assert.ok(Math.max(...ages)<=3,`honest reports exceed the 150 ms contact window: ${ages}`);
 assert.ok(Math.min(...ages)>=-3,`reports lead authority excessively: ${ages}`);
 assert.ok(a.me.pos.x>7.8 && a.me.pos.x<8.2,'clock calibration keeps two seconds of physical travel');
 assert.equal(r.host.core.stats.held,0);
 const before=a.me, x=before.pos.x;
 assert.ok(Object.isFrozen(before) && Object.isFrozen(before.motion));
 await clock.wait(100);assert.notEqual(a.me.pos.x,before.pos.x);
 assert.equal(before.pos.x,x,'a retained entity is a snapshot, not a mutable frame slot');
});

for(const drift of [.99,1.01])test(`validated owner clock tracks room at ${drift} clock rate`,async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),start=clock.now();
 const a=openRoom({now:()=> (clock.now()-start)*drift,net:{config:cfg('Drifting owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);
 for(let i=0;i<10;i++){a.input({ax:i%2?1:-1});await clock.wait(10000);}
 assert.equal(r.host.core.stats.held,0,'honest drift never rejected');
 assert.ok(Math.abs(globalThis.__homieNet.probe.prediction().tick-r.host.tick)<4,'drift stays bounded for 100 seconds');
 const x=r.host.core.listeners()[0].pos.x;a.input({ax:1});await clock.wait(1000);assert.ok(r.host.core.listeners()[0].pos.x>x+3);
});

test('validated owner shares presentation across microtasks within one browser frame and invalidates on input and the next frame',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),a=openRoom({net:{config:cfg('Frame cache'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);a.input({ax:1});await clock.wait(100);
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 globalThis.window={addEventListener(){},removeEventListener(){}};
 globalThis.document={timeline:{currentTime:1},hidden:false,addEventListener(){},removeEventListener(){}};
 t.after(()=>{if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;});
 const first=a.me;await Promise.resolve();assert.equal(a.me,first,'the second rAF callback reuses the same drawing');
 document.timeline.currentTime=2;assert.notEqual(a.me,first,'a new browser frame computes a new drawing');
 const second=a.me;a.input({ax:0});assert.notEqual(a.me,second,'new controls invalidate within the same browser frame');
 const third=a.me;await clock.wait(100);assert.notEqual(a.me,third,'stepping and snapshots invalidate even if the animation timeline pauses');
});

test('remote presentation is shared within a frame and refreshed by snapshots',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),a=openRoom({net:{config:cfg('Viewer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const b=openRoom({net:{config:cfg('Mover'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();b.close();r.stop();});await clock.wait(1000);b.input({ax:1});await clock.wait(300);
 const id=b.me.id,old=Object.getOwnPropertyDescriptor(globalThis,'document');
 globalThis.document={timeline:{currentTime:1},hidden:false,addEventListener(){},removeEventListener(){}};
 t.after(()=>{if(old)Object.defineProperty(globalThis,'document',old);else delete globalThis.document;});
 const first=a.get(id);await Promise.resolve();assert.equal(a.get(id),first);
 document.timeline.currentTime=2;assert.notEqual(a.get(id),first);
 const second=a.get(id);await clock.wait(200);assert.notEqual(a.get(id),second);
 assert.ok(a.get(id).pos.x>second.pos.x);
});

test('an observer switches an owner placement at its sampled time, without interpolating across the map',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),a=openRoom({net:{config:cfg('Placement viewer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const b=openRoom({net:{config:cfg('Placed owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();b.close();r.stop();});await clock.wait(1000);b.input({ax:1});await clock.wait(1000);b.input({ax:0});await clock.wait(300);
 const id=b.me.id,before=a.net.latest(),x=a.get(id).pos.x;
 b.command('respawn');await clock.wait(300);const after=a.net.latest(),sample=a.net.sample;
 t.after(()=>{a.net.sample=sample;});
 a.net.sample=()=>({a:before,b:after,alpha:.5});assert.equal(a.get(id).pos.x,x,'before the placement tick the old revision remains');
 a.net.sample=()=>({a:before,b:after,alpha:1});assert.equal(a.get(id).pos.x,0,'at the placement tick jump directly to spawn');
});

test('a three-second server stall does not rewind continued valid owner movement',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t);let until=0;
 const r=rig(L,compiled,{enforceOverrun:true,clock:{now:()=>Date.now(),setTimer:(fn,ms)=>{
   const run=()=>Date.now()<until?setTimeout(run,until-Date.now()):fn();return setTimeout(run,ms);
 },clearTimer:h=>clearTimeout(h)}});
 const a=openRoom({net:{config:cfg('Continued owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);a.input({ax:1});await clock.wait(500);
 until=Date.now()+3000;let previous=a.me.pos.x;
 for(let i=0;i<375;i++){await clock.wait(16);const x=a.me.pos.x;assert.ok(x>=previous-1e-6,`owner rewound ${previous} -> ${x}`);previous=x;}
 assert.equal(r.host.core.stats.held,0);
});

test('remote validated movement stays bounded while an owner catches up from an outage',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled);
 const viewer=openRoom({net:{config:cfg('Buffered viewer'),WebSocketImpl:r.socket(),post:null}});await clock.wait(300);
 const owner=openRoom({net:{config:cfg('Buffered owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);owner.input({ax:1});
 const id=owner.me.id;let previous=viewer.get(id).pos.x;
 for(let i=0;i<60;i++){await clock.wait(16);previous=viewer.get(id).pos.x;}
 r.network.up=false;r.sockets.at(-1).cut();await clock.wait(3000);r.network.up=true;
 for(let i=0;i<375;i++){await clock.wait(16);const x=viewer.get(id).pos.x;assert.ok(Math.abs(x-previous)<1.4+1e-6,`observer jumped ${previous} -> ${x}`);previous=x;}
 assert.ok(previous>8,'bounded drawing still makes progress');
});

test('committing a forecast preserves physics across control changes and isolates preview motion',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner-substeps');
 const clock=virtualTime(t),r=rig(L,compiled);let previews=0;
 const a=openRoom({predict:{runner(me,input,c){if(c.preview){previews++;me.motion.push=250;}}},net:{config:cfg('Forecast commit'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);
 let resets=0;a.on('placed',()=>resets++);
 for(let i=0;i<300;i++){a.input({ax:i%37<25?1:-1});await clock.wait(16);assert.equal(a.me.motion.push,0,'preview mutation cannot enter canonical movement');}
 a.input({ax:0});await clock.wait(500);
 assert.ok(previews>20);assert.equal(resets,0);assert.equal(r.host.core.stats.held,0);
 assert.ok(Math.abs(a.me.pos.x-r.host.core.listeners()[0].pos.x)<.01,'committed forecasts agree with separately validated server physics');
 });

test('remote owners stay on the shared scene timeline when newer reports arrive',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),viewer=openRoom({net:{config:cfg('One buffer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Fresh reports'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);
 const id=owner.me.id,scene=viewer.net.sample();viewer.net.sample=()=>scene;
 const start=viewer.get(id).pos.x;owner.input({ax:1});
 for(let i=0;i<90;i++){await clock.wait(16);viewer.get(id);}
 assert.equal(viewer.get(id).pos.x,start,'new reports cannot advance the runner beyond the scene containing its hazards');
});

test('owner confirmations ignore a sampled scene from before the current placement',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),a=openRoom({net:{config:cfg('Current acknowledgement'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1500);
 assert.ok(a.confirmedTick>0);const sample=a.net.sample.bind(a.net),before=sample();
 a.command('respawn');for(let i=0;i<20;i++){await clock.wait(16);a.viewTick;}a.net.sample=()=>before;
 assert.equal(a.confirmedTick,-1,'the old revision cannot acknowledge a new provisional contact');
 a.net.sample=sample;assert.ok(a.confirmedTick>0);
});


test('runner and monster interpolation use one fraction through a burst of reports',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-scene');
 const clock=virtualTime(t),r=rig(L,compiled),viewer=openRoom({net:{config:cfg('Scene viewer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Scene owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);owner.input({ax:1});await clock.wait(300);
 let monster;viewer.each('monster',e=>{monster=e.id;});assert.ok(monster);
 const id=owner.me.id,sample=viewer.net.sample.bind(viewer.net);
 const a=viewer.net.latest();await clock.wait(300);const b=viewer.net.latest();await clock.wait(200);
 const poses=alpha=>{viewer.net.sample=()=>({a,b,alpha});return [viewer.get(id).pos.x,viewer.get(monster).pos.x];};
 const lo=poses(0),hi=poses(1);assert.ok(hi[0]>lo[0]&&hi[1]>lo[1]);
 // Fresh reports keep arriving while the chosen scene stays between a and b.
 for(const alpha of [.1,.3,.7,.9]) {await clock.wait(100);const p=poses(alpha);for(let i=0;i<2;i++)assert.ok(Math.abs(p[i]-(lo[i]+(hi[i]-lo[i])*alpha))<1e-5,`body ${i} at ${alpha}: ${p[i]} expected ${lo[i]+(hi[i]-lo[i])*alpha}`);}
 viewer.net.sample=sample;
});

test('accepted runner ticks stay aligned with a patrol when uplink delay changes',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-scene');
 const clock=virtualTime(t);let delay=0;
 const r=rig(L,compiled,false,0,(message,link)=>link===1&&message.t==='in'?delay:0);
 const viewer=openRoom({net:{config:cfg('Shared clock viewer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Delayed source'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);owner.input({ax:1});
 let monster;viewer.each('monster',e=>{monster=e.id;});const id=owner.me.id;
 for(let i=0;i<120;i++){await clock.wait(16);viewer.get(id);viewer.get(monster);}
 const offset=viewer.get(id).pos.x-viewer.get(monster).pos.x;
 for(const ms of [80,150,300,0]){delay=ms;for(let i=0;i<120;i++){
  await clock.wait(16);const x=viewer.get(id).pos.x,m=viewer.get(monster).pos.x;
  assert.ok(Math.abs(x-m-offset)<.002,`delay ${ms}: runner/patrol separation changed from ${offset} to ${x-m}`);
 }}
});


test('receiving a placement preserves the moving runner history before its scene boundary',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),viewer=openRoom({net:{config:cfg('Old revision viewer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Moving placement'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);owner.input({ax:1});await clock.wait(300);
 const a=viewer.net.latest();await clock.wait(100);const b=viewer.net.latest();await clock.wait(100);
 viewer.net.sample=()=>({a,b,alpha:.37});const id=owner.me.id,x=viewer.get(id).pos.x;
 owner.command('respawn');await clock.wait(300);
 assert.equal(viewer.get(id).pos.x,x,'a newer placement cannot replace the older trajectory with a snapshot endpoint');
 const c=viewer.net.latest(),tick=b.k+(c.k-b.k)*.05,oldTick=a.k+(b.k-a.k)*.37;
 viewer.net.sample=()=>({a:b,b:c,alpha:.05});
 assert.ok(Math.abs(viewer.get(id).pos.x-(x+(tick-oldTick)*.2))<.002,'the last interval before the cut still samples the old input trajectory');
});

test('a stalled scene reaches fresh movement without replaying a long stationary tail',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t);let until=0;
 const r=rig(L,compiled,{enforceOverrun:true,clock:{now:()=>Date.now(),setTimer:(fn,ms)=>{
  const run=()=>Date.now()<until?setTimeout(run,until-Date.now()):fn();return setTimeout(run,ms);
 },clearTimer:h=>clearTimeout(h)}},80,80);
 const viewer=openRoom({net:{config:cfg('Paused scene'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Starts during pause'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1500);
 const id=owner.me.id,start=viewer.get(id).pos.x;until=Date.now()+3000;
 for(let i=0;i<188;i++){if(i===100)owner.input({ax:1});await clock.wait(16);viewer.get(id);}
 let first=null,previous=viewer.get(id).pos.x;
 for(let i=0;i<125;i++){
  await clock.wait(16);const x=viewer.get(id).pos.x;
  assert.ok(Math.abs(x-previous)<1.4+1e-6,`catch-up step exceeded the display bound: ${previous} -> ${x}`);
  if(first===null&&x>start+.02)first=(i+1)*16;previous=x;
 }
 assert.ok(owner.me.pos.x>8,'the owner continued moving during and after the pause');
 assert.ok(first!==null&&first<700,`observer kept replaying stationary history for ${first} ms after resume`);
 t.diagnostic({firstMotionAfterResumeMs:first});
});

test('an idle remote source cannot pin a moving runner and its patrol',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-scene');
 const clock=virtualTime(t);let delay=0;
 const r=rig(L,compiled,false,0,(message,link)=>link===0&&message.t==='in'?delay:0);
 const idle=openRoom({net:{config:cfg('Idle source'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Moving source'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const viewer=openRoom({net:{config:cfg('Third seat watcher'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{idle.close();owner.close();viewer.close();r.stop();});
 await clock.wait(1000);owner.input({ax:1});
 for(let i=0;i<90;i++){await clock.wait(16);viewer.viewTick;}
 let monster;viewer.each('monster',e=>{monster=e.id;});const id=owner.me.id;
 const start=viewer.get(id).pos.x,offset=start-viewer.get(monster).pos.x;delay=3000;
 let previous=start;
 for(let i=0;i<180;i++){
  await clock.wait(16);const x=viewer.get(id).pos.x;
  assert.ok(Math.abs(x-previous)<1.4,`moving source jumped ${previous} -> ${x}`);
  assert.ok(Math.abs(x-viewer.get(monster).pos.x-offset)<.002,'the runner and patrol must retain one clock');previous=x;
 }
 assert.ok(previous-start>9,`idle source held fresh movement to ${previous-start} tiles in 2.88 seconds`);
 delay=0;idle.input({ax:1});
 const resumed=previous;let idlePrevious=viewer.get(idle.me.id).pos.x;
 for(let i=0;i<90;i++){
  await clock.wait(16);const x=viewer.get(id).pos.x,idleX=viewer.get(idle.me.id).pos.x;
  assert.ok(Math.abs(x-previous)<1.4);assert.ok(Math.abs(idleX-idlePrevious)<1.4,'the returning source must also remain bounded');
  previous=x;idlePrevious=idleX;
 }
 assert.ok(previous-resumed>4,'resuming the idle source cannot freeze the other runner');
});

test('a placement after a long server pause does not replay a stationary spawn tail',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t);let until=0;
 const r=rig(L,compiled,{enforceOverrun:true,clock:{now:()=>Date.now(),setTimer:(fn,ms)=>{
  const run=()=>Date.now()<until?setTimeout(run,until-Date.now()):fn();return setTimeout(run,ms);
 },clearTimer:h=>clearTimeout(h)}},80,80);
 const viewer=openRoom({net:{config:cfg('Placement observer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Moving placed owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1500);owner.input({ax:1});
 const id=owner.me.id;until=Date.now()+15000;
 for(let i=0;i<950;i++){if(i===900)owner.command('respawn');await clock.wait(16);viewer.get(id);}
 let prior=viewer.get(id).pos.x,still=0,longest=0;
 for(let i=0;i<500;i++){
  await clock.wait(16);const x=viewer.get(id).pos.x;
  still=Math.abs(x-prior)<1e-8?still+16:0;longest=Math.max(longest,still);prior=x;
 }
 t.diagnostic(JSON.stringify({longest}));assert.ok(longest<=400,`observer froze at the placement for ${longest} ms`);
});

test('late movement after a stationary source cannot rewrite the drawn pose in one frame',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t);let held=false;
 const r=rig(L,compiled,false,0,(m,link)=>held&&link===0&&m.t==='in'?null:0);
 const owner=openRoom({net:{config:cfg('Late moving owner'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const viewer=openRoom({net:{config:cfg('Late movement observer'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{owner.close();viewer.close();r.stop();});await clock.wait(1000);const id=owner.me.id;
 held=true;owner.input({ax:1});for(let i=0;i<188;i++){await clock.wait(16);viewer.get(id);}
 held=false;let prev=viewer.get(id).pos.x,worst=0;
 for(let i=0;i<180;i++){await clock.wait(16);const x=viewer.get(id).pos.x;worst=Math.max(worst,Math.abs(x-prev));prev=x;}
 t.diagnostic(JSON.stringify({worst}));assert.ok(worst<1.4+1e-6,`late movement jumped ${worst} tiles`);
});

test('a fast path after a placement skips stationary history without spending future travel',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner-fast');
 const clock=virtualTime(t);let until=0;
 const r=rig(L,compiled,{enforceOverrun:true,clock:{now:()=>Date.now(),setTimer:(fn,ms)=>{
  const run=()=>Date.now()<until?setTimeout(run,until-Date.now()):fn();return setTimeout(run,ms);
 },clearTimer:h=>clearTimeout(h)}},80,80);
 const viewer=openRoom({net:{config:cfg('Placement observer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Moving placed owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1500);owner.input({ax:1});
 const id=owner.me.id;until=Date.now()+15000;
 for(let i=0;i<950;i++){if(i===850)owner.input({ax:0});if(i===900)owner.command('respawn');if(i===940)owner.input({ax:1});await clock.wait(16);viewer.get(id);}
 let prior=viewer.get(id).pos.x,still=0,longest=0;
 for(let i=0;i<500;i++){
  await clock.wait(16);const x=viewer.get(id).pos.x;
  still=Math.abs(x-prior)<1e-8?still+16:0;longest=Math.max(longest,still);prior=x;
 }
 t.diagnostic(JSON.stringify({longest}));assert.ok(longest<=700,`observer froze at the placement for ${longest} ms`);
});

test('a scene drains stationary history before charging newly moving travel',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner-fast');
 const clock=virtualTime(t),r=rig(L,compiled),viewer=openRoom({net:{config:cfg('Sleeping renderer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Fast late movement'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);
 const id=owner.me.id,start=viewer.get(id).pos.x;
 await clock.wait(5000);owner.input({ax:1});await clock.wait(300);
 let first=null,prior=start,worst=0;
 for(let i=0;i<125;i++){await clock.wait(16);const x=viewer.get(id).pos.x;worst=Math.max(worst,Math.abs(x-prior));if(first===null&&x>start+.02)first=(i+1)*16;prior=x;}
 t.diagnostic(JSON.stringify({first,worst}));
 assert.ok(first!==null&&first<400,`stationary prefix held the renderer for ${first} ms`);
 assert.ok(worst<1.4+1e-5,`moving travel exceeded its display bound: ${worst}`);
});

test('the first accepted path after a placement stays bounded from its drawn spawn',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner-fast');
 const clock=virtualTime(t);let held=false;
 const r=rig(L,compiled,false,300,(m,link)=>held&&link===0&&m.t==='in'?null:300);
 const owner=openRoom({net:{config:cfg('Placed late owner'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const viewer=openRoom({net:{config:cfg('Placed late observer'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{owner.close();viewer.close();r.stop();});await clock.wait(1000);owner.input({ax:1});await clock.wait(500);
 const id=owner.me.id;held=true;owner.command('respawn');
 for(let i=0;i<188;i++){await clock.wait(16);viewer.get(id);}
 held=false;let prev=viewer.get(id).pos.x,worst=0;
 for(let i=0;i<180;i++){await clock.wait(16);const x=viewer.get(id).pos.x;worst=Math.max(worst,Math.abs(x-prev));prev=x;}
 t.diagnostic(JSON.stringify({worst}));assert.ok(worst<1.4+1e-5,`first accepted path jumped ${worst} tiles from its spawn`);
});

test('input call time precedes time spent pumping pending room work',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t);let spent=0;
 const r=rig(L,compiled),a=openRoom({now:()=>performance.now()+spent,net:{config:cfg('Input call clock'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{a.close();r.stop();});await clock.wait(1000);
 // Simulate synchronous room work between entry into input() and held sampling.
 // The next pump reads offline before it takes its own clock reading.
 const descriptor=Object.getOwnPropertyDescriptor(a.net,'offline');
 let charge=false;
 Object.defineProperty(a.net,'offline',{configurable:true,get(){if(charge){spent+=4;charge=false;}return false;}});
 await clock.wait(10);const x=a.me.pos.x;charge=true;
 a.input({ax:1});
 const moved=a.me.pos.x-x;
 assert.ok(moved>=.015,`four milliseconds at 4 m/s must already belong to the press, got ${moved}`);
 if(descriptor)Object.defineProperty(a.net,'offline',descriptor);
});


test('latest entity reads reveal confirmed lifecycle fields without advancing the buffered scene',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner');
 const clock=virtualTime(t),r=rig(L,compiled),viewer=openRoom({net:{config:cfg('Lifecycle viewer'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Lifecycle owner'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);
 const sample=viewer.net.sample();viewer.net.sample=()=>sample;
 const id=owner.me.id,before=viewer.get(id),tick=viewer.viewTick;
 owner.command('point');owner.input({ax:1});await clock.wait(500);
 const current=viewer.get(id,{latest:true});
 assert.equal(current.score,1);assert.ok(current.pos.x>before.pos.x);
 assert.ok(Object.isFrozen(current));assert.equal(current.provisional,undefined);
 assert.equal(viewer.get(id).score,0);assert.equal(viewer.get(id).pos.x,before.pos.x);
 assert.equal(viewer.viewTick,tick,'authority reads must not fast-forward presentation');
 assert.equal(viewer.get('missing',{latest:true}),null);
});

test('opted-in remote forecasts and patrols share the owner clock under changing delivery delay',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-scene');
 const clock=virtualTime(t);let delay=0;
 const r=rig(L,compiled,false,0,(message,link)=>link===1&&message.t==='in'?delay:0);
 const viewer=openRoom({remoteInput:{runner:e=>({ax:Number(e.vel.x)/4}),monster:()=>({})},net:{config:cfg('Forecast scene'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Forecast source'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(1000);owner.input({ax:1});await clock.wait(500);
 let monster;viewer.each('monster',e=>{monster=e.id;});const id=owner.me.id;
 const offset=viewer.get(id).pos.x-viewer.get(monster).pos.x;
 for(const ms of [0,80,150,300,0]){delay=ms;for(let i=0;i<80;i++){
  await clock.wait(16);const a=viewer.get(id),b=viewer.get(monster);
  assert.ok(Math.abs(a.pos.x-b.pos.x-offset)<.01,`delay ${ms}, clocks disagree: ${a.pos.x-b.pos.x} vs ${offset}`);
 }}
 assert.equal(r.host.core.stats.held,0);assert.equal(r.host.core.stats.errors,0);
});

test('remote forecast corrections are bounded and placements discard old forecasts',async t=>{
 const {L,compiled,openRoom}=await coinDashKit('server',false,20,'validated-owner-fast');
 const clock=virtualTime(t),r=rig(L,compiled,false,0,300);
 const viewer=openRoom({remoteInput:{runner:e=>({ax:Math.sign(Number(e.vel.x))})},net:{config:cfg('Forecast correction'),WebSocketImpl:r.socket(),post:null}});
 await clock.wait(300);const owner=openRoom({net:{config:cfg('Changing source'),WebSocketImpl:r.socket(),post:null}});
 t.after(()=>{viewer.close();owner.close();r.stop();});await clock.wait(2000);owner.input({ax:1});await clock.wait(1000);
 const id=owner.me.id;let x=viewer.get(id).pos.x;
 owner.input({ax:-1});for(let i=0;i<100;i++){await clock.wait(16);const next=viewer.get(id).pos.x;assert.ok(Math.abs(next-x)<=1.40001,`forecast correction jumped ${next-x}`);x=next;}
 owner.input({ax:0});await clock.wait(600);owner.command('respawn');await clock.wait(600);
 assert.ok(Math.abs(viewer.get(id).pos.x)<.001,'placement discards the previous forecast');
 assert.equal(r.host.core.stats.held,0);
});
