/** App metadata shared by the build and the Worker. No browser role grants authority. */
export const APP_SURFACES = ['phone', 'wall', 'kiosk', 'tablet'];
export const APP_WORDS = Object.freeze({ open: 'Open', join: 'Scan to join', one: 'person', many: 'people' });
const key = /^[a-z][a-z0-9-]{0,39}$/;
const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
export function appProblems(meta) {
  const bad = [];
  if (!object(meta)) return ['app.json must be an object'];
  const roles = object(meta.roles) ? meta.roles : {};
  const collections = object(meta.records?.collections) ? meta.records.collections : {};
  if (!object(meta.roles) || !Object.keys(meta.roles).length) bad.push('roles must declare at least one role');
  for (const [id, role] of Object.entries(roles)) {
    if (!key.test(id) || !object(role) || typeof role.signIn !== 'boolean' || !Array.isArray(role.can) || role.can.some((s) => !/^(read|create|update|delete):[a-z][a-z0-9-]{0,39}$/.test(s))) bad.push(`role ${id}: declare signIn and can (read/create/update/delete:collection)`);
  }
  if (!Object.values(roles).some((r) => r?.signIn === false)) bad.push('declare a public role');
  if (!object(meta.surfaces) || !Object.keys(meta.surfaces).length) bad.push('declare surfaces');
  for (const [surface, role] of Object.entries(meta.surfaces ?? {})) if (!APP_SURFACES.includes(surface) || !Object.hasOwn(meta.roles ?? {}, role)) bad.push(`surface ${surface}: name a declared role`);
  if (!object(meta.records) || typeof meta.records.persist !== 'boolean' || !object(meta.records.collections)) bad.push('records declares persist and collections');
  for (const [id, c] of Object.entries(collections)) {
    if (!key.test(id) || !object(c) || !object(c.fields)) { bad.push(`collection ${id}: declare fields`); continue; }
    for (const [field, spec] of Object.entries(c.fields)) if (!key.test(field) || !object(spec) || !['string', 'number', 'boolean'].includes(spec.type) || (spec.enum && (!Array.isArray(spec.enum) || !spec.enum.length))) bad.push(`collection ${id}.${field}: invalid field`);
  }
  for (const r of Object.values(roles)) for (const cap of Array.isArray(r?.can) ? r.can : []) if (!Object.hasOwn(meta.records?.collections ?? {}, String(cap).split(':')[1])) bad.push(`unknown collection in ${cap}`);
  for (const [k, v] of Object.entries(meta.words ?? {})) if (!Object.hasOwn(APP_WORDS, k) || typeof v !== 'string' || !v.trim() || v.length > 60) bad.push(`words.${k}: use a short label`);
  return bad;
}
export const appWords = (g) => g?.kind === 'app' ? { ...APP_WORDS, ...g.words } : { open: 'Play', join: 'Scan to play', one: 'player', many: 'players' };
export const openPath = (g) => `/${g.id}/${g.kind === 'app' ? 'open' : 'play'}`;
export function appRole(meta, url) {
  const surface = url.searchParams.get('surface') ?? ((url.pathname.endsWith('/tv') || url.pathname.endsWith('/watch')) || url.searchParams.get('want') === 'screen' ? 'wall' : 'phone');
  return url.searchParams.get('role') ?? meta.surfaces?.[surface] ?? Object.keys(meta.roles ?? {}).find((r) => !meta.roles[r].signIn);
}
export function recordProblem(collection, data, { create = false } = {}) {
  if (!object(data) || JSON.stringify(data).length > 8192) return 'record must be an object below 8 KB';
  for (const k of Object.keys(data)) if (!Object.hasOwn(collection.fields, k)) return `unknown field ${k}`;
  for (const [k, s] of Object.entries(collection.fields)) {
    const v = data[k];
    if (v === undefined) { if (s.required) return `missing ${k}`; continue; }
    if (typeof v !== s.type || (s.type === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && v.length > (s.maxLength ?? 256)) || (s.enum && !s.enum.includes(v)) || (create && s.initial !== undefined && v !== s.initial)) return `invalid ${k}`;
  }
  return null;
}
