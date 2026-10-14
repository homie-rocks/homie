/** Same-site destinations, including app routes and query strings. */
export function signinTarget(value, fallback = '/_studio/stats') {
  if (typeof value !== 'string' || !value.startsWith('/') || /^\/\//.test(value) || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const target = new URL(value, 'https://studio.invalid');
    return target.origin === 'https://studio.invalid' ? target.pathname + target.search + target.hash : fallback;
  } catch { return fallback; }
}
