/** Extracted from the studio runtime; behavior is unchanged. */
const catalogueCache = new WeakMap();

async function catalogue(env, origin) {
  try {
    const cached=catalogueCache.get(env.ASSETS);
    if(cached?.origin===origin && env.HOMIE_PREVIEW!=='1' && env.HOMIE_DEV!=='1')return cached.value;
    const res = await env.ASSETS.fetch(new Request(`${origin}/games.json`));
    if (!res.ok) return { studio: { name: env.STUDIO_NAME || 'Studio' }, games: [] };
    const tag = res.headers.get('etag');
    const hit = catalogueCache.get(env.ASSETS);
    if (tag && hit?.tag === tag && hit.origin === origin) { await res.body?.cancel(); return hit.value; }
    const value = await res.json();
    catalogueCache.set(env.ASSETS, { tag, origin, value });
    return value;
  } catch { return { studio: { name: env.STUDIO_NAME || 'Studio' }, games: [] }; }
}

export {catalogue};

