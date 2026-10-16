/** Hibernation keeps transports outside JavaScript. Only data crosses this
 * boundary; callbacks, bindings and sockets are reconstructed by the Table.
 */
// Only protocol identity, admission, controls and round deadlines survive here.
// World snapshots/checkpoints belong to the existing host/room save, not sessions.
const fields = new Set(`rawVocab vocab snapAt rates agentsAloneMs voteMs voteCooldownMs autoVoteMs policy level levelBy caps vote lastVoteOpen lastAutoVote lastHumanAt agentsOut officeDirty endedMatch code rules tickHz seatCap maxPlayers maxScreens perIp stallMs silentMs idleMs holdMs forgetMs persistMs gameVer currentVer occSeq seats hostId hostSince lastJoinAt lastRound lastRoster emptySince preferHost seatsDirty persistDirty lastPersistAt bans mutes announcement closedUntil closedWhy openedAt askedMax regate decideTimes defaultChat`.split(' '));
function urlDelta(base, value) {
  const a=new URL(base),b=new URL(value),changes=[];
  for(const key of new Set([...a.searchParams.keys(),...b.searchParams.keys()])) {
    const x=a.searchParams.getAll(key),y=b.searchParams.getAll(key);
    if(JSON.stringify(x)!==JSON.stringify(y))changes.push([key,y]);
  }
  return {path:b.pathname,changes};
}
function clientURL(base, delta) {
  const url=new URL(base);url.pathname=delta.path;
  for(const [key,values] of delta.changes){url.searchParams.delete(key);for(const value of values)url.searchParams.append(key,value);}
  return url.toString();
}
import {isQa} from './stats.mjs';
const qa = agent => isQa({headers:new Headers({'user-agent':agent??''})})?'homie-house-qa':null;
import {encodeSession as encode,decodeSession as decode} from './session-codec.mjs';
const legacyDecode=value=>JSON.parse(value,(_key,item)=>item?.__roomMap?new Map(item.__roomMap):item?.__roomSet?new Set(item.__roomSet):item?.__roomNumber?item.__roomNumber*Infinity:item);
export function roomSessions(storage) {
  const sql=storage.sql;let previous=new Map();
  return {
    read() {
      if(!sql)return null;
      sql.exec('CREATE TABLE IF NOT EXISTS room_sessions(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
      previous=new Map(sql.exec('SELECT key,value FROM room_sessions').toArray().map(row=>[row.key,row.value]));
      if(!previous.has('version'))return null;
      if(!['1','2','3'].includes(previous.get('version')))throw new Error('Unsupported room session snapshot');
      const read=previous.get('version')==='1'?legacyDecode:decode;
      const table=previous.has('table')?read(previous.get('table')):{};
      if(previous.get('version')==='3')table.relayDescriptors=[...previous].filter(([key])=>key.startsWith('relay:')).map(([key,value])=>{
        const relay=read(value),prefix='relay-client:'+key.slice(6)+':';
        relay.clients=[...previous].filter(([key])=>key.startsWith(prefix)).map(([,value])=>{const [id,clientId,delta,ip,agent]=read(value);return [id,clientId,clientURL(relay.url,delta),ip,qa(agent)];});
        return relay;
      });
      return {table,fields:new Map([...previous].filter(([key])=>key.startsWith('room:')).map(([key,value])=>[key.slice(5),read(value)])),clients:new Map([...previous].filter(([key])=>key.startsWith('client:')).map(([key,value])=>[key.slice(7),read(value)]))};
    },
    write(room,table = {}) {
      if(!sql)throw new Error('Room hibernation requires SQLite storage');
      const {relayDescriptors=[],...metadata}=table;
      const next=new Map([['version','3'],['table',encode(metadata)]]);
      relayDescriptors.forEach((relay,index)=>{
        next.set('relay:'+index,encode({url:relay.url}));
        for(const [id,clientId,url,ip,agent] of relay.clients)next.set('relay-client:'+index+':'+id,encode([id,clientId,urlDelta(relay.url,url),ip,qa(agent)]));
      });
      for(const [key,value] of Object.entries(room))if(fields.has(key)&&value!==undefined&&typeof value!=='function')next.set('room:'+key,encode(value));
      for(const [id,client] of room.clients){const {conn,lastSeen,probe,readyAt,ingressRateAt,rttWindow,rttReadAt,rttToldAt,measuredRtt,...state}=client;
        if(state.rates instanceof Map)state.rates=new Map([...state.rates].filter(([key])=>key!=='ping'&&key!=='ping:view'));next.set('client:'+id,encode(state));}
      storage.transactionSync(()=>{
        for(const [key,value] of next)if(previous.get(key)!==value)sql.exec('INSERT INTO room_sessions VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value);
        for(const key of previous.keys())if(!next.has(key))sql.exec('DELETE FROM room_sessions WHERE key=?',key);
      });
      previous=next;
    },
    clear() {if(sql&&previous.size){sql.exec('DELETE FROM room_sessions');previous.clear();}},
  };
}
export function restoreRoomFields(room,snapshot) {
  if(!snapshot)return;
  for(const [key,value] of snapshot.fields)if(fields.has(key)&&Object.hasOwn(room,key)&&typeof room[key]!=='function')room[key]=value;
}
