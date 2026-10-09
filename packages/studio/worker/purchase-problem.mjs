const titles = { 400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 410: 'Gone', 413: 'Content Too Large', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable' };
export function problem(status, detail, extra = {}) {
  return Response.json({ type: 'about:blank', title: titles[status] ?? 'Error', status, detail, ok: false, message: detail, ...extra }, { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } });
}
