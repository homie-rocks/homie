/**
 * STANDALONE COPIES OF A GAME (standalone/STANDALONE.md): the same built game in a desktop or phone app
 * (`homie-studio standalone build`). The app's page is not served by this site, so it is another origin to this
 * Worker: `app://game` in the desktop app (Electron), `capacitor://localhost` on iOS and `https://localhost` on
 * Android (Capacitor). Those three are fixed by the shells, never by a game.
 *
 * A native shell may use public records for an app kind (worker/app-records.mjs), and otherwise: ask the Lobby which public room to join (`POST /<game>/api/lobby`),
 * and read the answer. The room's socket (`/<game>/__net`) never asked where a page came from, so it needs nothing.
 * Privileged records and everything else a page of this site does stay this site's own: no credentials are allowed across (there is no
 * `access-control-allow-credentials` anywhere here), the lobby is never opened to `*`, and the POSTs that check
 * `sameOrigin` (players, saves, the shop, chat reports, the office) still refuse an app, as they refuse any other
 * site. So an app has no account, no cloud saves and no shop, and says so.
 */

/** The origins of the app shells' own page. */
export const APP_ORIGINS = ['app://game', 'capacitor://localhost', 'https://localhost'];

/** The app origin this request came from, or null (this site's own pages, another site, a tool with no Origin). */
export function appOriginOf(request) {
  const origin = request.headers.get('origin');
  return origin && APP_ORIGINS.includes(origin) ? origin : null;
}

export const isAppOrigin = (request) => appOriginOf(request) !== null;

/** The answer as an app's page may read it: its own origin named, and nothing else. Any other request: unchanged. */
export function appCors(request, response) {
  const origin = appOriginOf(request);
  if (!origin) return response;
  const out = new Response(response.body, response);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.append('vary', 'origin');
  return out;
}
