/** Studio configuration only: register once at module evaluation, never per request. */
let handler = null;
export function useRoutes(routes) {
  if (routes !== null && typeof routes !== 'function') throw new TypeError('useRoutes expects a function or null');
  handler = routes;
}
export async function customRoute(request, env, ctx) {
  const response = await handler?.(request, env, ctx);
  if (response == null) return null;
  if (!(response instanceof Response)) throw new TypeError('A custom route must return a Response, null, or undefined');
  if (response.status === 101 || response.webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  if (!headers.has('referrer-policy')) headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers});
}
