const cache = new WeakMap();
/** Cache completed immutable data only. Never share pending I/O across requests. */
export async function catalogue(env, origin = 'https://studio.invalid') {
  const baked = (await import('./built-metadata.mjs')).default;
  if (baked) return baked.catalogue;
  const hit = cache.get(env.ASSETS);
  if (hit?.origin === origin && env.HOMIE_PREVIEW !== '1' && env.HOMIE_DEV !== '1') return hit.value;
  const response = await env.ASSETS.fetch(new Request(`${origin}/games.json`));
  if (!response.ok) return {studio: {name: env.STUDIO_NAME || 'Studio'}, games: []};
  const value = await response.json();
  cache.set(env.ASSETS, {origin, value});
  return value;
}
export async function builtPosts() {
  return (await import('./built-metadata.mjs')).default?.posts;
}
