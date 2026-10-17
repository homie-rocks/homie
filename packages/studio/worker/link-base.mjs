/**
 * A host in front of a studio may serve it, for one viewer, under a path of its own: a private preview, for one, lets
 * in only addresses under `/<its pass path>`. The host says so in the `homie-link-base` request header (an absolute
 * path). The studio's shared room links, the television's join code, the landing's phone code, the game frame and its
 * room sockets then start with it. The game frame runs at an opaque origin, which sends no cookie, so a pass in a
 * cookie never reaches its assets or sockets; one in the path does, and every relative address in the frame keeps it.
 * Hosts that require nothing send nothing, and every address stays as it was.
 */
export const LINK_BASE_HEADER = 'homie-link-base';
const SHAPE = /^(?:\/[A-Za-z0-9._~-]{1,200}){1,4}$/;
/** The path this request's addresses start with, or '' when the host requires none (or sent something malformed). */
export function linkBase(request) {
  const value = request?.headers?.get?.(LINK_BASE_HEADER) ?? '';
  return SHAPE.test(value) && !value.split('/').some((p) => p === '.' || p === '..') ? value : '';
}
/** An absolute `url` (or a path) with the host's base path put in front of its path. */
export function withLinkBase(url, base) {
  if (!base) return url;
  if (url.startsWith('/')) return base + url;
  const u = new URL(url);
  return u.origin + base + u.pathname + u.search + u.hash;
}
