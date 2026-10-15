export const LIVE_ROOMS_QUERY='SELECT game,rooms,updated FROM lobby_summaries LIMIT 500';
/** Queue order is not guaranteed. An older snapshot must never replace a newer one. */
export async function storeLobbySummary(env, message) {
  if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(message.game)||!Array.isArray(message.rooms)||message.rooms.length>512||!Number.isFinite(message.at))throw new Error('Invalid lobby snapshot');
  await env.DB.prepare(`INSERT INTO lobby_summaries(game,rooms,updated) VALUES(?1,?2,?3)
    ON CONFLICT(game) DO UPDATE SET rooms=excluded.rooms,updated=excluded.updated WHERE excluded.updated>lobby_summaries.updated`)
    .bind(message.game,JSON.stringify(message.rooms),message.at).run();
}
export async function liveRoomSummaries(env) {
  if(!env.BACKGROUND||!env.DB)return null; // Older wrappers still query their Lobby.
  const rows=(await env.DB.prepare(LIVE_ROOMS_QUERY).all()).results??[];
  const since=Date.now()-180000;
  return new Map(rows.map(row=>[row.game,row.updated>since?JSON.parse(row.rooms).filter(room=>room.at>since):[]]));
}
