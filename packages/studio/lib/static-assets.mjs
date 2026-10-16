/** Assets matching a protected namespace must pass through runtime authorization. */
export const WORKER_ROUTES = [
  '/', '/index.html', '/api/*', '/_studio/*', '/mcp', '/mcp/*', '/oauth/*', '/hooks/*',
  '/.well-known/*', '/_site/*', '/parts/*', '/games/*', '/account', '/account/*',
  '/shop', '/shop/*', '/lounge', '/lounge/*', '/_homie/*', '/media/*',
  '/robots.txt', '/sitemap.xml', '/llms.txt', '/llms-full.txt',
];
export function staticWorkerRoutes(catalogue) {
  if (catalogue?.studio?.concept === true) return true;
  return [...WORKER_ROUTES, ...(catalogue?.games ?? []).flatMap(game =>
    [`/${game.id}`, `/${game.id}/*`, ...(game.kind === 'app' ? [] : [`!/games/${game.id}/assets/*`, `!/games/${game.id}/_landing/*`])])];
}
/** Keep the owner's header rules last. Worker responses attach their own headers. */
export function staticHeaders(custom = '', {concept = false} = {}) {
  custom = custom.replace(/# BEGIN HOMIE HEADERS[\s\S]*?# END HOMIE HEADERS\n?/g, '');
  return `# BEGIN HOMIE HEADERS
# Studio defaults: public static assets are served without a Worker invocation.
/*
  Cache-Control: public, max-age=0, must-revalidate, no-transform
  X-Frame-Options: DENY${concept ? "\n  X-Robots-Tag: noindex, nofollow" : ""}
/games/*
  ! X-Frame-Options
/parts/*
  ! X-Frame-Options
# END HOMIE HEADERS
${custom}`;
}
