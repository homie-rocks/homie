import {signControl,settingsOf,launchOf,seatsFor} from './office.mjs';
import {appAccess} from './app-records.mjs';
import {withToolIdentity} from './tool-identity.mjs';
import {serversOf,policyOf,roomServer,serverAccess} from './servers.mjs';
import {passRefusal} from './agents.mjs';
export async function remoteSeat(env,cat,caller,op,args) {
  if(!caller.connection)throw new Error('Connect a signed-in AI first');
  const meta=cat.games.find(g=>g.id===args.game);if(!meta)throw new Error('unknown experience');
  const settings=await settingsOf(env,{fresh:true});
  if(!caller.owner&&launchOf(meta,settings,env)!=='public')throw new Error('experience is private');
  if(meta.kind==='app'){
    const url=new URL(`https://studio/${meta.id}/open`);if(args.role)url.searchParams.set('role',args.role);
    const access=await appAccess(withToolIdentity(new Request(url),caller),env,meta,url);
    if(!access.ok)throw new Error('app role required');
  }
  const max=seatsFor(meta,settings),serverId=args.room?roomServer(args.room):args.server??'public';
  const srv=(await serversOf(env,meta,{fresh:true})).find(s=>s.id===serverId);
  if(!srv||srv.state!=='open')throw new Error('server unavailable');
  const door=await serverAccess(env,{game:meta.id,server:srv,holders:caller.owner?['o']:[`p-${caller.id}`]});
  if(!door.ok)throw new Error('server access refused');
  const policy=policyOf(srv,{seats:max});
  const refusal=passRefusal({live:true,game:meta.id,server:serverId,kind:caller.owner?'owner':'guest'},{game:meta.id,server:serverId,policy,launch:launchOf(meta,settings,env)});
  if(refusal)throw new Error(refusal.message);
  let room=args.room;
  if(!room&&op==='sit'){
    const joined=await env.LOBBY.get(env.LOBBY.idFromName(meta.id)).fetch(`https://lobby/join?max=${max}&server=${serverId}&agent=1&ai=${policy.aiSeats+policy.guides}`,{method:'POST'});room=(await joined.json()).room;
  }
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(room??''))throw new Error('No room with people; an AI never starts a room');
  const ctl=await signControl(env,{op:'mcp-seat',game:meta.id,room,args:{...args,operation:op,connection:caller.connection,person:caller.id,name:caller.name??'Studio AI'}});
  const response=await env.TABLE.get(env.TABLE.idFromName(`${meta.id}/${room}`)).fetch(`https://table/__mcp?game=${meta.id}&room=${room}&max=${max}`,{method:'POST',body:JSON.stringify(ctl)});
  const result=await response.json();if(!response.ok)throw new Error(result.error??'room refused');return {...result,game:meta.id,room};
}
/** Internal Table-only path, authenticated by the existing signed control protocol. */
export async function roomSeat(table,room,ctl) {
  const a=ctl.args;
  const active=await table.env.DB.prepare('SELECT id FROM mcp_connections WHERE id=?1 AND person=?2 AND revoked=0').bind(a.connection,a.person).first();
  const seats=table.mcpSeats??=new Map();let seat=seats.get(a.connection);
  if(!active){seat?.handle.onClose();seats.delete(a.connection);return {ok:false,error:'connection revoked'};}
  if(a.operation==='stand'){seat?.handle.onClose();seats.delete(a.connection);return {ok:true};}
  if(a.operation==='sit'&&(!seat||seat.closed)){
    for(const [id,old] of seats)if(old.closed)seats.delete(id);
    await table.readVocab(table.game);
    seat={closed:false,frames:[]};
    const conn={ip:null,player:a.person,via:'p-'+a.person,agent:{pass:a.connection.replaceAll('-','').slice(0,16),role:'guide',hands:'host',by:'studio',name:a.name},send:text=>{seat.frames.push(JSON.parse(text));if(seat.frames.length>20)seat.frames.shift();},close:()=>{seat.closed=true;},buffered:()=>0};
    seat.handle=room.attach(conn);seats.set(a.connection,seat);
    seat.handle.onMessage(JSON.stringify({t:'hello',v:1,rev:7,want:'play',canHost:false,agent:{hands:'host',role:'guide'}}));
  }
  if(!seat||seat.closed)return {ok:false,error:seat?.frames.find(f=>f.t==='error')?.code??'seat unavailable; sit again'};
  const client=room.clients.get(seat.handle.id);
  if(!client?.agent||!room.agentsAllowed())return {ok:false,error:'AI not allowed'};
  seat.handle.onMessage(JSON.stringify({t:'ping'}));
  if(a.operation==='act'||a.operation==='speak'){
    const frame={t:'ev',k:a.operation==='act'?'agent:do':'say:'+a.line,d:a.operation==='act'?{goal:a.goal,args:a.args??{}}:{args:a.args??{}}};
    // Check with the room's existing validator without consuming its rate timestamp twice.
    const before=client.doAt,valid=room.agentEvOk(client,frame.k,frame,JSON.stringify(frame).length,room.now());client.doAt=before;
    if(!valid)return {ok:false,error:'action, arguments, rate or speech policy refused'};
    seat.handle.onMessage(JSON.stringify(frame));
  }
  const result={ok:true,seat:client.seat,name:client.name,view:client.lastView,vocabulary:room.rawVocab,frames:seat.frames.filter(f=>f.t==='error'||f.k==='agent:view')};seat.frames=[];return result;
}
