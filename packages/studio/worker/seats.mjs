/**
 * Room sizes, shared by the site Worker (worker/index.mjs) and `homie-studio build` (lib/build.mjs).
 *
 * A game names its seats in its netplay manifest (game.json `netplay.maxPlayers`, or `netplay.json` with
 * `maxPlayers` or `players.max`); every room of that game has that many, up to SEAT_MAX (32).
 */

/** The most seats one room holds (NETPLAY.md §3). */
export const SEAT_MAX = 32;

/** A game's seats from its catalogue row: 1 to SEAT_MAX, 8 when it names none. */
export const seatsOf = (meta) => Math.max(1, Math.min(SEAT_MAX, Math.floor(Number(meta?.players?.max)) || 8));

/**
 * Sockets one client address may hold in one room: 12, or every seat plus four (a big screen or two, and a
 * visitor waiting for a seat) when that is more. A party of thirty phones and a TV on one Wi-Fi (or strangers
 * behind one carrier's shared address) fills a 32-seat room from a single address, and must be let in; an 8-seat
 * game keeps the old 12.
 */
export const perAddress = (seats) => Math.max(12, seats + 4);
