/** Keep the transient chat window and its moderation buckets across hibernation.
 * These are room-local state, separate from an owner's optional history archive.
 */
export function idleChatSnapshot(table) {
  const room=table.room;
  if(!room)return null;
  return structuredClone({
    at:Date.now(),log:room.chatLog,buckets:room.chatBuckets,address:room.chatAddress,reacts:room.chatReacts,
    stats:Object.fromEntries(Object.entries(room.stats).filter(([key])=>key.startsWith('chat'))),
    sent:table.chatSent,pending:table.chatPend,
  });
}
export function restoreIdleChat(table,saved) {
  if(!saved||!table.room)return;
  table.room.chatLog=saved.log??[];
  table.room.chatBuckets=saved.buckets??new Map();
  table.room.chatAddress=saved.address??new Map();
  table.room.chatReacts=saved.reacts??[];
  Object.assign(table.room.stats,saved.stats??{});
  table.chatSent=saved.sent??table.chatSent;
  table.chatPend=saved.pending??table.chatPend;
}

const lifetime=15*60_000;
const encode=value=>JSON.stringify(value,(_key,item)=>item instanceof Map?{__roomMap:[...item]}:item===-Infinity?{__roomInfinity:-1}:item);
const decode=value=>JSON.parse(value,(_key,item)=>item?.__roomMap?new Map(item.__roomMap):item?.__roomInfinity===-1?-Infinity:item);
export async function readIdleChat(storage) {
  if(!storage.sql)return storage.get('watch-chat');
  storage.sql.exec('CREATE TABLE IF NOT EXISTS idle_chat(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,expires INTEGER NOT NULL)');
  storage.sql.exec('DELETE FROM idle_chat WHERE expires<=?',Date.now());
  const row=storage.sql.exec('SELECT body FROM idle_chat WHERE id=1').toArray()[0];
  return row?decode(row.body):null;
}
export async function writeIdleChat(storage,snapshot) {
  if(storage.sql) {
    storage.sql.exec('CREATE TABLE IF NOT EXISTS idle_chat(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,expires INTEGER NOT NULL)');
    storage.sql.exec('INSERT INTO idle_chat VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,expires=excluded.expires',encode(snapshot),snapshot.at+lifetime);
  } else await storage.put('watch-chat',snapshot);
  const alarm=await storage.getAlarm?.();
  if(alarm==null||alarm>snapshot.at+lifetime)await storage.setAlarm?.(snapshot.at+lifetime);
}
export async function expireIdleChat(storage) {
  if(!storage.sql)return;
  storage.sql.exec('CREATE TABLE IF NOT EXISTS idle_chat(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,expires INTEGER NOT NULL)');
  storage.sql.exec('DELETE FROM idle_chat WHERE expires<=?',Date.now());
  const row=storage.sql.exec('SELECT expires FROM idle_chat WHERE id=1').toArray()[0];
  if(row){const alarm=await storage.getAlarm();if(alarm==null||alarm>row.expires)await storage.setAlarm(row.expires);}
}
