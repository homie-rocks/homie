/** Hibernation keeps transports outside JavaScript. Only data crosses this
 * boundary; callbacks, bindings and sockets are reconstructed by the Table.
 */
const transient=new Set(['chatOps','controls','store','now','log','clients','watchers','watchIds','review','onPublished','onUnsaid','decider','server','onForget','gateFacts','waitUntil']);
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
      if(!['1','2'].includes(previous.get('version')))throw new Error('Unsupported room session snapshot');
      const read=previous.get('version')==='1'?legacyDecode:decode;
      return {table:previous.has('table')?read(previous.get('table')):{},fields:new Map([...previous].filter(([key])=>key.startsWith('room:')).map(([key,value])=>[key.slice(5),read(value)])),clients:new Map([...previous].filter(([key])=>key.startsWith('client:')).map(([key,value])=>[key.slice(7),read(value)]))};
    },
    write(room,table = {}) {
      if(!sql)throw new Error('Room hibernation requires SQLite storage');
      const next=new Map([['version','2'],['table',encode(table)]]);
      for(const [key,value] of Object.entries(room))if(!transient.has(key)&&value!==undefined&&typeof value!=='function')next.set('room:'+key,encode(value));
      for(const [id,client] of room.clients){const {conn,...state}=client;next.set('client:'+id,encode(state));}
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
  for(const [key,value] of snapshot.fields)if(!transient.has(key)&&Object.hasOwn(room,key)&&typeof room[key]!=='function')room[key]=value;
}
