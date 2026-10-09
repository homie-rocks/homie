/** The SDK graph is evaluated only when this selling Worker handles work. */
export * from '../index.mjs';
let loaded;
export const loadSelling = () => loaded ??= import('./runtime.mjs');
export default {
  async fetch(request, env, ctx) { return (await loadSelling()).default.fetch(request, env, ctx); },
  async scheduled(event, env, ctx) { return (await loadSelling()).default.scheduled(event, env, ctx); },
};
