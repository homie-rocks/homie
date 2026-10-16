import {catalogue} from './catalogue.mjs';
/** Uses the same live session/account checks as the studio office. */
export async function isOwner(request, env) {
  return (await import('./office.mjs')).isOwner(request, env);
}
/** Checks an app's declared role with its existing link, session and grant rules. */
export async function hasRole(request, env, app, role) {
  const url = new URL(request.url);
  const cat = await catalogue(env, url.origin);
  const meta = cat.games?.find(item => item.id === app && item.kind === 'app');
  if (!meta || typeof role !== 'string' || !Object.hasOwn(meta.roles ?? {}, role)) return false;
  url.searchParams.set('role', role);
  return (await (await import('./app-records.mjs')).appAccess(request, env, meta, url)).ok === true;
}
