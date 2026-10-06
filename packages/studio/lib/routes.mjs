/**
 * THE ROUTES IN A STUDIO'S WRANGLER CONFIG: WHICH ARE THE STUDIO'S, AND WHICH ARE NOT ITS TO TOUCH.
 *
 * A studio on a custom domain shares that domain's Cloudflare zone with whatever else its owner runs there, and a
 * zone's Worker routes are one list for all of it. Three things went wrong with that:
 *
 *   1. `deploy` writes wrangler.jsonc again from studio.json, and it used to write it without `routes`. A studio whose
 *      owner had added the exact-host route its domain needed lost it at the next deploy, and the domain went back to
 *      whichever Worker the zone's wildcard route names.
 *   2. A zone that already has a wildcard route (`*example.com/*`, the router of another site) answers the studio's
 *      hostname FIRST: a route is matched before a custom domain. The studio deployed fine and its own domain showed
 *      somebody else's "not found". Nothing said why, or that one exact-host route fixes it.
 *   3. A config that itself names a catch-all (`*` + `/*`) hands every hostname of the zone to the studio's Worker
 *      the moment it deploys: another site on the zone stops answering.
 *
 * So: the routes the owner wrote for the studio's OWN hostnames (a custom domain, an exact host) are kept across
 * every rewrite; a wildcard or catch-all route is never deployed by the studio unless studio.json says the zone is
 * the studio's (`cloudflare.allowWildcardRoutes: true`); and a deploy whose domain answers as something else says
 * which route is needed. Nothing here calls Cloudflare: a zone's other routes belong to other Workers, and the
 * studio never lists, changes or removes one.
 */
import { readFileSync } from 'node:fs';
import { configPath } from './studio.mjs';

/** wrangler.jsonc as an object (whole-line comments left out, as the toolkit writes it), or null. */
export function readConfig(root) {
  try { return JSON.parse(readFileSync(configPath(root), 'utf8').replace(/^\s*\/\/.*$/gm, '')); } catch { return null; }
}

/** Wrangler takes a route as a string or an object, in `routes` or the older single `route`: one shape for all. */
export function routesOf(config) {
  const raw = [...(Array.isArray(config?.routes) ? config.routes : []), ...(config?.route ? [config.route] : [])];
  return raw.map((r) => (typeof r === 'string' ? { pattern: r } : r)).filter((r) => r && typeof r.pattern === 'string' && r.pattern.trim());
}

/** The hostname part of a route's pattern ("play.example.com/*" gives "play.example.com"; a scheme is left out). */
export function routeHost(route) {
  return String(route?.pattern ?? '').trim().replace(/^[a-z*]+:\/\//i, '').split('/')[0].toLowerCase();
}

/**
 * What kind of route it is:
 *   'custom-domain'  `custom_domain: true`: Cloudflare makes the DNS record and the certificate for that one host
 *   'exact-host'     one hostname, any path ("play.example.com/*"): only that host's requests
 *   'catch-all'      every hostname of the zone ("*" + "/*")
 *   'wildcard'       a `*` in the hostname ("*example.com/*", "*.example.com/*"): many hosts, maybe not the studio's
 */
export function routeKind(route) {
  if (route?.custom_domain === true) return 'custom-domain';
  const host = routeHost(route);
  if (host === '*' || host === '') return 'catch-all';
  return host.includes('*') ? 'wildcard' : 'exact-host';
}

/** Whether a route's hostname pattern covers a hostname ("*example.com" covers "play.example.com" and "example.com"). */
export function routeCovers(route, hostname) {
  const pattern = routeHost(route);
  if (!pattern) return false;
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(String(hostname ?? '').toLowerCase());
}

/**
 * The config's routes, sorted into the studio's own (kept across every rewrite of wrangler.jsonc, exactly as written)
 * and the wide ones (a wildcard or a catch-all).
 */
export function sortRoutes(config) {
  const own = [];
  const wide = [];
  for (const r of routesOf(config)) (['custom-domain', 'exact-host'].includes(routeKind(r)) ? own : wide).push(r);
  return { own, wide };
}

/**
 * The routes a rewrite of wrangler.jsonc carries over from the one on disk: the studio's own, and the wide ones
 * only when studio.json says the whole zone is the studio's. Null when there are none, so a studio without routes
 * gets byte for byte the config it always got.
 */
export function keptRoutes(root, studio = null) {
  const { own, wide } = sortRoutes(readConfig(root));
  const kept = [...own, ...(studio?.cloudflare?.allowWildcardRoutes === true ? wide : [])];
  return kept.length ? kept : null;
}

/**
 * Why a deploy of this config would reach past the studio, or null. A wide route in the studio's own config makes
 * its Worker answer for hostnames the studio does not have: said before anything is created or deployed.
 */
export function wideRouteRefusal(config, studio = null) {
  if (studio?.cloudflare?.allowWildcardRoutes === true) return null;
  const { own, wide } = sortRoutes(config);
  if (!wide.length) return null;
  const names = wide.map((r) => `"${r.pattern}"`).join(', ');
  const all = wide.some((r) => routeKind(r) === 'catch-all');
  const keep = own.length ? ` Its own route${own.length === 1 ? '' : 's'} (${own.map((r) => `"${r.pattern}"`).join(', ')}) stay${own.length === 1 ? 's' : ''}, and every deploy keeps ${own.length === 1 ? 'it' : 'them'}.` : '';
  return {
    needs: 'cloudflare-routes', routes: wide.map((r) => r.pattern),
    why: `wrangler.jsonc gives this studio's Worker the route${wide.length === 1 ? '' : 's'} ${names}: ${all ? 'a catch-all, which answers for EVERY hostname of the zone' : 'a wildcard, which answers for more hostnames than the studio\'s own'}. Deploying it would take those hostnames away from whatever serves them now (another site on the same domain stops answering), so nothing was deployed or changed on Cloudflare. Take ${wide.length === 1 ? 'that route' : 'those routes'} out of "routes" in wrangler.jsonc: a studio needs only its own hostname, as { "pattern": "<its hostname>", "custom_domain": true } or { "pattern": "<its hostname>/*", "zone_name": "<the domain>" }.${keep} If the whole zone really is this studio's, say so in studio.json ("cloudflare": { "allowWildcardRoutes": true }) and deploy again.`,
  };
}

/** The apex a hostname most likely belongs to ("play.example.com" gives "example.com"): a suggestion, never a lookup. */
export function likelyZone(hostname) {
  const parts = String(hostname ?? '').toLowerCase().split('.').filter(Boolean);
  return parts.slice(-2).join('.');
}

/** The exact-host route that makes a zone's Worker routes send one hostname to this studio's Worker. */
export function exactRouteFor(hostname, zone = likelyZone(hostname)) {
  return { pattern: `${String(hostname).toLowerCase()}/*`, zone_name: zone };
}

/**
 * The studio's custom domain answered, but not as this studio. With no exact-host route for that hostname in the
 * config, the likeliest reason is another Worker's route on the zone that covers it (a wildcard, or a catch-all):
 * a route is matched before a custom domain. Says which route is needed and that the other one is left alone; with
 * the exact-host route already there, says to wait and what to look at instead.
 */
export function shadowedDomain(config, hostname, answer = {}) {
  const host = String(hostname ?? '').toLowerCase();
  const own = sortRoutes(config).own;
  const exact = own.find((r) => routeKind(r) === 'exact-host' && routeHost(r) === host);
  const said = answer.status ? `answered ${answer.status}${answer.said ? ` ("${answer.said}")` : ''}` : 'answered';
  if (exact) {
    return { shadowed: false, why: `https://${host} ${said}, not as this studio, although wrangler.jsonc has its exact-host route ("${exact.pattern}"). A new route can take a minute to apply; if it stays like this, look at the zone's Workers Routes in the Cloudflare dashboard for a more specific route on that hostname.` };
  }
  const route = exactRouteFor(host);
  return {
    shadowed: true, route,
    why: `https://${host} ${said}, not as this studio: something else on the domain answers that hostname first. The usual reason is another Worker's route on the same zone that covers it (a wildcard like "*${route.zone_name}/*", or a catch-all): Cloudflare matches a route before a custom domain. The studio does not touch that route (it is not the studio's). Add the studio's own exact-host route to "routes" in wrangler.jsonc, which wins over a wildcard for this one hostname, and deploy again: ${JSON.stringify(route)} (zone_name is the domain as it is named in Cloudflare). Every deploy keeps it.`,
  };
}
