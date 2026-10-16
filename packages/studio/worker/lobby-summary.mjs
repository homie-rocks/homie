export const LIVE_ROOMS_QUERY='SELECT game,rooms,updated FROM lobby_summaries ORDER BY game LIMIT 500';
/** Queue order is not guaranteed. An older snapshot must never replace a newer one. */
export async function storeLobbySummary(env, message) {
  if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(message.game)||!Array.isArray(message.rooms)||message.rooms.length>512||!Number.isFinite(message.at))throw new Error('Invalid lobby snapshot');
  const shard=message.shard??0;
  if(!Number.isInteger(shard)||shard<0||shard>=16)throw new Error('Invalid lobby shard');
  await env.DB.prepare(`INSERT INTO lobby_summaries(game,rooms,updated) VALUES(?1,?2,?3)
    ON CONFLICT(game) DO UPDATE SET rooms=excluded.rooms,updated=excluded.updated WHERE excluded.updated>lobby_summaries.updated`)
    .bind(shard?`${message.game}~${shard}`:message.game,JSON.stringify(message.rooms),message.at).run();
}
export async function liveRoomSummaries(env) {
  if(!env.BACKGROUND||!env.DB)return null; // Older wrappers still query their Lobby.
  const result=new Map(),since=Date.now()-180000;
  let cursor=null;
  for(;;){
    const query=cursor===null?env.DB.prepare(LIVE_ROOMS_QUERY):env.DB.prepare('SELECT game,rooms,updated FROM lobby_summaries WHERE game>? ORDER BY game LIMIT 500').bind(cursor);
    const rows=(await query.all()).results??[];
    for(const row of rows){
      const game=row.game.split('~')[0],rooms=result.get(game)??[];
      if(row.updated>since)rooms.push(...JSON.parse(row.rooms).filter(room=>room.at>since));
      result.set(game,rooms);
    }
    if(rows.length<500)break;
    cursor=rows.at(-1).game;
  }
  for(const [game,rooms] of result)result.set(game,[...new Map(rooms.map(room=>[room.name,room])).values()]);
  return result;
}
