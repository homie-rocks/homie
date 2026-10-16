export let players = null;
let configured=false;
/**
 * The player-accounts API, handed over once by a studio's Worker that has it:
 * `{ get(id, env), of?(request, env), isOwner?(request, env) }` (worker/players.mjs `players` is exactly this).
 */
export function usePlayers(api) { configured=true; players = api && typeof api === 'object' ? api : null; }

export function defaultPlayers(api) { if(!configured)players=api; }
