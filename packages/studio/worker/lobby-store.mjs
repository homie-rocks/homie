/** Row storage keeps a seat update from rewriting every room. The legacy snapshot
 * is imported once in the same SQLite transaction as the migration marker. */
export function lobbyStore(storage) {
  const sql=storage.sql;
  if(!sql)return {load:()=>storage.get('lobby'),save:value=>storage.put('lobby',value)};
  let previous=new Map(),previousMeta;
  const write=value=>{
    const rooms=new Map(value.rooms.map(room=>[room.name,JSON.stringify(room)]));
    const meta=JSON.stringify({current:value.current,next:value.next,closed:value.closed});
    storage.transactionSync(()=>{
      for(const [name,body] of rooms)if(previous.get(name)!==body)sql.exec('INSERT INTO matchmaking_rooms(name,body) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body',name,body);
      for(const name of previous.keys())if(!rooms.has(name))sql.exec('DELETE FROM matchmaking_rooms WHERE name=?',name);
      if(meta!==previousMeta)sql.exec("INSERT INTO matchmaking_meta(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",meta);
    });
    previous=rooms;previousMeta=meta;
  };
  return {
    async load() {
      sql.exec('CREATE TABLE IF NOT EXISTS matchmaking_rooms(name TEXT PRIMARY KEY,body TEXT NOT NULL)');
      sql.exec('CREATE TABLE IF NOT EXISTS matchmaking_meta(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL)');
      const meta=sql.exec('SELECT body FROM matchmaking_meta WHERE id=1').toArray()[0];
      if(!meta) {
        const legacy=await storage.get('lobby');
        write(legacy??{current:null,next:{public:1},closed:[],rooms:[]});
        // A crash before deletion is harmless: the SQLite marker wins next time.
        await storage.delete('lobby');
      } else {
        previousMeta=meta.body;
        previous=new Map(sql.exec('SELECT name,body FROM matchmaking_rooms').toArray().map(r=>[r.name,r.body]));
      }
      return {...JSON.parse(previousMeta),rooms:[...previous.values()].map(body=>JSON.parse(body))};
    },
    save:write,
  };
}
