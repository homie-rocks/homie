/**
 * Room sizes, shared by the site Worker (worker/index.mjs) and `homie-studio build` (lib/build.mjs).
 *
 * A game names its seats in its netplay manifest (game.json `netplay.maxPlayers`, or `netplay.json` with
 * `maxPlayers` or `players.max`); every room of that game has that many, as chosen by the studio.
 */

import { stallOf, versionOf } from './room.mjs';

/** Room size is chosen by the studio, not capped by admission. */
export const seatCount = (n, fallback = 8) => Number.isSafeInteger(Number(n)) && Number(n) > 0 ? Number(n) : fallback;
export const seatsOf = (meta) => seatCount(meta?.players?.max);
/** Shared carrier addresses do not impose a guest ceiling. */
export const perAddress = () => 0;

/**
 * `net.prefs` (NETPLAY.md section 24): what the play page keeps for one game on one browser, because the game's frame
 * has no storage of its own. The helper (netplay/netplay.ts PREFS_LIMITS) has the same numbers; a test keeps them equal.
 */
export const PREFS_LIMITS = Object.freeze({ bytes: 16_384, keys: 32, key: 64 });

/**
 * THE ADDRESS'S SWITCHES (NETPLAY.md section 24). The game runs in a frame that cannot read the play page's address, so
 * the page passes a few of its query parameters in: these always (`?debug`, `?q=low`, and the three the port kit
 * reads), and the names the game declares (game.json `netplay.params`). Never a name the page uses itself (the room,
 * the seat's token, the ticket, the browser key…): a game can never ask to be handed those.
 */
export const PLAY_PARAMS = Object.freeze(['debug', 'q', 'touchdebug', 'cam', 'view']);
const RESERVED_PARAMS = new Set(['room', 'device', 'want', 'k', 'b', 't', 'name', 'hush', 'chat', 'bub', 'watch', 'follow', 'hand', 'screen', 'arrive', 'not', 'via', 'invite', 'w', 'gv', 'pf', 'server', 'token', 'key', 'code', 'access']);
const PARAM_NAME = /^[a-z][a-z0-9_-]{0,23}$/;
/** A switch's value as it is passed in: up to 48 of A-Z a-z 0-9 _ . ~ - (empty for a bare `?debug`). */
export const PARAM_VALUE = '^[A-Za-z0-9_.~-]{0,48}$';

/** The names a game may be handed: the defaults, then up to 12 of its own (lowercase, never one the page uses). */
export function playParams(meta) {
  const own = Array.isArray(meta?.netplay?.params) ? meta.netplay.params : [];
  const out = [...PLAY_PARAMS, ...(meta?.kind === 'app' ? ['role', 'surface', 'ticket'] : [])];
  for (const raw of own) {
    const k = String(raw ?? '');
    if (PARAM_NAME.test(k) && !RESERVED_PARAMS.has(k) && !out.includes(k)) out.push(k);
    if (out.length >= PLAY_PARAMS.length + 12) break;
  }
  return out;
}

/** The allowed switches of an address, by name (what `HOMIE_NET.params` and `net.params` carry). */
export function paramsFrom(searchParams, meta) {
  const ok = new RegExp(PARAM_VALUE);
  const out = {};
  for (const k of playParams(meta)) {
    const v = searchParams.get(k);
    if (v !== null && ok.test(v)) out[k] = v;
  }
  return out;
}

/**
 * What a game's netplay manifest tells its rooms beyond their size (the catalogue row's `netplay`, written by
 * `homie-studio build` from game.json `netplay`): `version` (the game's revision: a room runs one at a time, section
 * 23), `stallMs` (how long a host may send no snapshot before it is replaced, 1500 to 10000, section 22) and `params`
 * (the address's switches the game wants passed in, section 24). Null when it names none of them. `problems`: what was
 * named and could not be used, for the build to say.
 */
export function netplayRow(net) {
  const out = {};
  const problems = [];
  if (net?.version !== undefined && net.version !== null) {
    const v = versionOf(net.version);
    if (v) out.version = v; else problems.push('"netplay.version" is 1 to 32 letters, digits, ".", "_" or "-" (a number works too); left out');
  }
  if (net?.stallMs !== undefined && net.stallMs !== null) {
    const n = stallOf(net.stallMs);
    if (n === null) problems.push('"netplay.stallMs" is a number of milliseconds (1500 to 10000); left out');
    else { out.stallMs = n; if (n !== Math.floor(Number(net.stallMs))) problems.push(`"netplay.stallMs" is held to 1500 to 10000 ms; using ${n}`); }
  }
  if (net?.params !== undefined && net.params !== null) {
    const own = playParams({ netplay: { params: net.params } }).slice(PLAY_PARAMS.length);
    if (own.length) out.params = own;
    const asked = Array.isArray(net.params) ? net.params.filter((k) => !PLAY_PARAMS.includes(k)) : [];
    if (!Array.isArray(net.params) || own.length < asked.length) problems.push('"netplay.params" is a list of up to 12 names (a-z, 0-9, - and _, starting with a letter), none of them one the play page uses itself (room, name, k, t, b…); the others were left out');
  }
  return { row: Object.keys(out).length ? out : null, problems };
}
