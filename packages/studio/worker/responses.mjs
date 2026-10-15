import {GAME_FILES,PART_FILES} from './asset-paths.mjs';
export const json = (body, status = 200, extra = {}) => new Response(`${JSON.stringify(body)}\n`, {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
export function finish(res, path) {
  if (!res || res.status === 101 || res.webSocket) return res;
  if (!/text\/html/i.test(res.headers.get('content-type') ?? '')) return res;
  const cache = res.headers.get('cache-control') ?? '';
  const addNt = !/no-transform/i.test(cache);
  // GAME PARTS: a shared part's preview page is framed by the part's page and the hub, sandboxed (worker/parts.mjs).
  const playerFrame = /^\/[a-z0-9][a-z0-9-]{0,39}\/play\/embed$/.test('/' + path.split('/').filter(Boolean).join('/')) && res.status === 200 && /frame-ancestors/.test(res.headers.get('content-security-policy') ?? '');
  const addXfo = !playerFrame && !res.headers.has('x-frame-options') && !GAME_FILES.test(path) && !PART_FILES.test(path);
  if (!addNt && !addXfo) return res;
  const headers = new Headers(res.headers);
  if (addNt) headers.set('cache-control', cache ? `${cache}, no-transform` : 'no-transform');
  if (addXfo) headers.set('x-frame-options', 'DENY');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
