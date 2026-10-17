/**
 * A host in front of a studio may require a query on the studio's own links: a private preview, for one, lets in only
 * requests that carry its pass. The host says so in the `homie-link-query` request header (one `name=value`), and the
 * studio's share, join and QR links carry it, so a phone that scans the television's code gets in too. Hosts that
 * require nothing send nothing, and every link stays as it was.
 */
export const LINK_QUERY_HEADER = 'homie-link-query';
const SHAPE = /^[a-z][a-z0-9_]{0,31}=[A-Za-z0-9._~-]{1,1024}$/;
/** The query this request's links must carry, or '' when the host requires none (or sent something malformed). */
export function linkQuery(request) {
  const value = request?.headers?.get?.(LINK_QUERY_HEADER) ?? '';
  return SHAPE.test(value) ? value : '';
}
/** `url` with the host's query added (or unchanged when there is none). */
export function withLinkQuery(url, query) {
  if (!query) return url;
  const u = new URL(url), at = query.indexOf('=');
  u.searchParams.set(query.slice(0, at), query.slice(at + 1));
  return u.href;
}
