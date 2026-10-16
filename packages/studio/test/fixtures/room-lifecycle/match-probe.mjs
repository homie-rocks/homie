import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {roomShard} from '../../../worker/lobby-shards.mjs';
const [base,output]=process.argv.slice(2),stamp=Date.now(),game='burst-'+stamp;
async function get(path){const response=await fetch(base+path,{signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);return response.json();}
const quiet=[];
for(let i=0;i<16;i++){
 const prefix='/proof-match?max=8&game=quiet-'+stamp+'-'+i+'&id=';
 const [a,b]=await Promise.all([get(prefix+'alice'),get(prefix+'bob')]);assert.equal(a.room,b.room);quiet.push(a.room);
}
const rooms=[],started=Date.now();let next=0;
await Promise.all(Array.from({length:32},async()=>{
 while(next<2048){const id=next++,path='/proof-match?game='+game+'&id=player-'+id;
 const [a,b]=await Promise.all([get(path),get(path)]);assert.equal(a.room,b.room);rooms.push(a.room);}
}));
assert.equal(new Set(rooms).size,2048);assert.equal(new Set(rooms.map(roomShard)).size,16);
const counts=[];
for(const name of [game,game+'/match-policy',...Array.from({length:16},(_,i)=>game+'/match/'+i),...Array.from({length:15},(_,i)=>game+'/shard/'+(i+1))])counts.push({name,...await get('/proof-lobby?name='+encodeURIComponent(name))});
const result={quietPairs:quiet.length,players:rooms.length,duplicateRequests:rooms.length,distinctRooms:new Set(rooms).size,shards:16,milliseconds:Date.now()-started,counts};
writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
assert.ok(Math.max(...counts.map(c=>c.requests))<600);
assert.ok(counts.find(c=>c.name.endsWith('/match-policy')).requests<150);
