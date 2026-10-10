import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

test('real Table SQL: pickup, abrupt object death, account recall into a second room and changed rules build',async()=>{
  const bundle=await build({stdin:{resolveDir:dirname(fileURLToPath(new URL('../worker/index.mjs',import.meta.url))),contents:`
    import {Table as BaseTable,hostRules} from './index.mjs';
    import {defineRules,defineMove,f,roomSettings} from '../rules/rules.ts';
    const rules=defineRules({contract:2,space:{dims:2},move:defineMove({runner(){}}),shapes:{commands:{pickup:{}}},
      entities:{runner:{player:true,fields:{coins:f.u32()},body:{shape:'circle',radius:.4,maxSpeed:1},commands:{pickup(w,s){s.coins++;}}}},
      room:{join(c,p){return {kind:'runner',at:p.character?.at??{x:0,y:0,z:0},fields:p.character?.fields};}}});
    function configure(build='one'){hostRules({world:{rules,settings:roomSettings({lifetime:'persistent',characters:true,tickHz:1}).settings,seats:8,build,stateHash:'same-state',map:{bounds:{min:[-10,-10],max:[10,10]}}}});}
    configure();
    const envFor=env=>({...env,HOMIE_ROOM_LOG:'0',ASSETS:{fetch:async()=>new Response('{}')}});
    export class Table extends BaseTable {
      constructor(ctx,env){super(ctx,envFor(env));}
      async fetch(req){const u=new URL(req.url);
        if(u.pathname==='/test/kill'){setTimeout(()=>this.ctx.abort('test abrupt death'),1);return new Response(null,{status:204});}
        if(u.pathname==='/test/build'){configure('two');return Response.json({ok:true});}
        if(u.pathname==='/test/state'){this.ensureHost(this.roomFor('world',u.searchParams.get('room'),8),true);return Response.json({save:this.roomSave,characters:[...(this.hostRt?.characters??[])],facts:this.hostRt?.facts(),error:this.room?.hostFailed});}
        if(u.pathname==='/test/tick'){this.hostRt.tickNow();return Response.json({ok:true});}
        return super.fetch(req);
      }
    }
    export class Lobby{fetch(){return new Response('{}');}}
    export default {fetch(req,env){const u=new URL(req.url);return env.TABLE.get(env.TABLE.idFromName('world/'+(u.searchParams.get('room')??'one'))).fetch(req);}};
  `},bundle:true,write:false,format:'esm',platform:'browser',conditions:['workerd','worker','browser'],external:['node:*','cloudflare:*']});
  const classes=['Table','Lobby'];
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'lasting',compatibilityDate:'2026-10-07',compatibilityFlags:['nodejs_compat'],manifest:{mainModule:'entry.mjs',modules:{'entry.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},exports:Object.fromEntries(classes.map(name=>[name,{type:'durable-object',storage:'sqlite'}])),env:Object.fromEntries(classes.map(name=>[name.toUpperCase(),{type:'durable-object',worker:'lasting',exportName:name}]))}}]});
  const sockets=[];
  const request=(path,room='one')=>mf.dispatchFetch(`https://local${path}?game=world&room=${room}`);
  const state=async(room='one')=>{const s=await(await request('/test/state',room)).json();assert.equal(s.error,null);return s;};
  const tick=async(room='one')=>{await request('/test/tick',room);};
  const connect=async(room='one',version='one')=>{
    const r=await mf.dispatchFetch(`https://local/__net?game=world&room=${room}&max=8&host=server&rules=1&hz=1&via=p-account-a&acct=1&cur=${version}&gv=${version}`,{headers:{Upgrade:'websocket'}});
    assert.equal(r.status,101,await (r.status===101?Promise.resolve(''):r.text()));const ws=r.webSocket;ws.accept();sockets.push(ws);
    const messages=[];ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
    ws.send(JSON.stringify({t:'hello',v:1,name:'Player',want:'play',rev:11,ver:version,rules:true}));
    // Request delivery is the barrier: virtual ticks drive gameplay, no soak.
    for(let i=0;i<20&&!messages.some(m=>m.t==='welcome'||m.t==='error');i++)await tick(room);
    assert.ok(messages.some(m=>m.t==='welcome'),JSON.stringify(messages));
    return {ws,messages};
  };
  try {
    const a=await connect();await tick();a.ws.send(JSON.stringify({t:'ev',k:'cmd',d:['pickup',{}]}));
    for(let i=0;i<4;i++)await tick();
    const before=await state();const saved=typeof before.save.host==='string'?JSON.parse(before.save.host):before.save.host;
    assert.equal(saved.core.ents.find(e=>e[11]===0)[17][0],1);
    await request('/test/build');
    await request('/test/kill');
    // Force the scheduled abort to run, then read through a new stub request.
    await new Promise(r=>setTimeout(r,30));
    const after=await state();const restored=typeof after.save.host==='string'?JSON.parse(after.save.host):after.save.host;
    assert.equal(restored.core.ents.find(e=>e[11]===0)[17][0],1);
    assert.ok(after.facts.epoch > before.facts.epoch,'the object actually restarted, rather than reading the old in-memory host');
    assert.equal(after.save.buildHash,'one','restored state came from the earlier build');
    const b=await connect('two','two');await tick('two');
    const second=await state('two');const next=typeof second.save.host==='string'?JSON.parse(second.save.host):second.save.host;
    assert.equal(next.core.ents.find(e=>e[11]===0)[17][0],1,'second room received the committed character');
    assert.equal((await state()).characters.filter(([,v])=>!v.returning).length,0,'first room has no holder');
    b.ws.close();await tick('two');
  } finally {for(const ws of sockets)try{ws.close();}catch{}await mf.dispose();}
});
