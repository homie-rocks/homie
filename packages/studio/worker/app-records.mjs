import { linkConfig } from './shop-links.mjs';
import {localSession} from './local-test.mjs';
import { moveBooking } from './booking-store.mjs';
import { toolIdentity } from './tool-identity.mjs';
/** Lasting app records in the studio's own D1. Room hosts never authorize writes. */
import { appRole, recordProblem } from './app-format.mjs';
import { isOwner, sameOrigin } from './office.mjs';
import { players } from './players.mjs';
import { ownerAllowed } from './stats.mjs';
import { appOriginOf } from './standalone.mjs';
export const APPS_MIGRATION_FILE = '0014_studio_apps.sql';
export const APPS_MIGRATION = `CREATE TABLE IF NOT EXISTS app_records (
  app TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
  PRIMARY KEY (app, collection, id)
);
CREATE TABLE IF NOT EXISTS app_roles (
  app TEXT NOT NULL, role TEXT NOT NULL, player TEXT NOT NULL,
  PRIMARY KEY (app, role, player)
);
CREATE TABLE IF NOT EXISTS app_role_links (
  app TEXT NOT NULL, role TEXT NOT NULL, token TEXT NOT NULL,
  PRIMARY KEY (app, role)
);
`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status, error) => json({ ok: false, error }, status);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
async function bodyOf(request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0; const chunks = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 12_288) { await reader.cancel(); throw new Error('body too large'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes) || '{}');
}
/** Private links conceal staff addresses; a signed-in grant is still required on every request. */
export async function appAccess(request, env, meta, url) {
  const role = appRole(meta, url);
  const declared = Object.hasOwn(meta.roles ?? {}, role) ? meta.roles[role] : null;
  if (!declared) return { ok: false, status: 404, error: 'unknown role' };
  if (!declared.signIn) return { ok: true, role, can: declared.can };
  const session = await localSession(request, env);
  if (session?.app === meta.id && session.role === role) return {ok:true,role,can:declared.can};
  if (!env.DB) return { ok: false, status: 503, error: 'app roles need the studio database' };
  const caller = toolIdentity(request);
  if (caller) {
    if (caller.owner) return { ok: true, role, can: declared.can };
    if(env.HOMIE_LOCAL_TEST_SECRET && caller.localTest && caller.roles?.[meta.id]?.includes(role))return {ok:true,role,can:declared.can};
    if (!caller.id) return { ok: false, status: 401, error: 'sign in to this studio' };
    const grant = await env.DB.prepare("SELECT player FROM app_roles WHERE app IN (?1, '*') AND role = ?2 AND player = ?3").bind(meta.id, role, caller.id).first();
    return grant ? { ok: true, role, can: declared.can } : { ok: false, status: 403, error: 'this account has no role grant' };
  }
  const link = await env.DB.prepare('SELECT token FROM app_role_links WHERE app = ?1 AND role = ?2').bind(meta.id, role).first();
  if (!link || link.token !== url.searchParams.get('access')) return { ok: false, status: 404, error: 'private role link required' };
  if (await isOwner(request, env)) return { ok: true, role, can: declared.can };
  const person = await players.of(request, env);
  if (!person || person.guest) return { ok: false, status: 401, error: 'sign in to this studio' };
  const grant = await env.DB.prepare("SELECT player FROM app_roles WHERE app IN (?1, '*') AND role = ?2 AND player = ?3").bind(meta.id, role, person.id).first();
  return grant ? { ok: true, role, can: declared.can } : { ok: false, status: 403, error: 'this account has no role grant' };
}
export async function appRecordsRoute(request, env, meta, url, sub) {
  if (!sub.startsWith('api/app/')) return null;
  if (!env.DB) return fail(503, 'app records need the studio database');
  try {
    if (sub === 'api/app/roles') {
      const key = await ownerAllowed(request, env, { kinds: ['office'] });
      if (!key && !(await isOwner(request, env))) return fail(403, 'owner only');
      if (request.method !== 'POST') return fail(405, 'POST required');
      if (!key && !sameOrigin(request, url)) return fail(403, 'same origin required');
      const b = await bodyOf(request);
      if (!Object.hasOwn(meta.roles, b.role) || !meta.roles[b.role].signIn) return fail(400, 'name a sign-in role');
      if (b.player !== undefined) {
        if (!ID.test(b.player)) return fail(400, 'invalid account');
        const p = await players.get(b.player, env);
        if (!p || p.guest) return fail(400, 'role grants require an existing signed-in account');
        await env.DB.prepare(b.revoke === true ? 'DELETE FROM app_roles WHERE app = ?1 AND role = ?2 AND player = ?3' : 'INSERT OR IGNORE INTO app_roles (app, role, player) VALUES (?1, ?2, ?3)').bind(b.studio === true ? '*' : meta.id, b.role, b.player).run();
      }
      const token = crypto.randomUUID().replaceAll('-', '');
      if (b.rotate === true) await env.DB.prepare('DELETE FROM app_role_links WHERE app = ?1 AND role = ?2').bind(meta.id, b.role).run();
      await env.DB.prepare('INSERT OR IGNORE INTO app_role_links (app, role, token) VALUES (?1, ?2, ?3)').bind(meta.id, b.role, token).run();
      const row = await env.DB.prepare('SELECT token FROM app_role_links WHERE app = ?1 AND role = ?2').bind(meta.id, b.role).first();
      return json({ ok: true, link: `${url.origin.replace('127.0.0.1','localhost')}/${meta.id}/open?role=${b.role}&access=${row.token}`, role: b.role });
    }
    const match = /^api\/app\/records\/([a-z][a-z0-9-]{0,39})(?:\/([A-Za-z0-9_-]{1,64}))?$/.exec(sub);
    if(!match && /^api\/app\/records\/[^/]+\//.test(sub))return fail(400,'record id: 1–64 letters, digits, underscore or hyphen');
    if (!match || !Object.hasOwn(meta.records?.collections ?? {}, match[1])) return fail(404, 'unknown collection');
    if (meta.records.persist !== true) return fail(409, 'use netplay state for transient records, or enable records.persist');
    const access = await appAccess(request, env, meta, url);
    if (!access.ok) return fail(access.status, access.error);
    const [, collection, id] = match;
    const session = await localSession(request, env);
    const testScope = (session?.app === meta.id ? session.scope : null) ?? (env.HOMIE_LOCAL_TEST_SECRET ? toolIdentity(request)?.testScope : null);
    const recordApp = testScope ? `${meta.id}:check:${testScope}` : meta.id;
    const op = ({ GET: 'read', POST: 'create', PUT: 'update', DELETE: 'delete' })[request.method];
    if (!op || !access.can.includes(`${op}:${collection}`)) return fail(403, 'role cannot perform this operation');
    if (op !== 'read' && !sameOrigin(request, url) && !(appOriginOf(request) && !meta.roles[access.role].signIn)) return fail(403, 'same origin required');
    if (op === 'read') {
      const rows = id ? [await env.DB.prepare('SELECT id, value, version, updated_at FROM app_records WHERE app = ?1 AND collection = ?2 AND id = ?3').bind(recordApp, collection, id).first()].filter(Boolean)
        : (await env.DB.prepare('SELECT id, value, version, updated_at FROM app_records WHERE app = ?1 AND collection = ?2 ORDER BY updated_at, id').bind(recordApp, collection).all()).results;
      const records=[];
      for(const r of rows) {
        const record={id:r.id,data:JSON.parse(r.value),version:r.version,updatedAt:r.updated_at};
        const link=linkConfig(env)?.slots?.find(l=>l.app===meta.id&&l.slots===collection&&l.slot===r.id);
        if(link) {
          const saved=await env.DB.prepare('SELECT value FROM meta WHERE key=?1').bind(`shop-slot-link:${link.id}`).first();
          const observed=saved?JSON.parse(saved.value):null;
          const status=observed && observed.capacity===(link.limit??link.capacity) ? observed : link;
          const count=await env.DB.prepare("SELECT COALESCE(SUM(quantity),0) n FROM shop_bookings WHERE app=?1 AND slots=?2 AND slot=?3 AND state='confirmed'").bind(recordApp,collection,r.id).first();
          record.booking={full:!status.active||status.count>=(link.limit??link.capacity)||count.n>=link.capacity,available:status.active?Math.max(0,Math.min(link.capacity-count.n,(link.limit??link.capacity)-status.count)):0,synced:link.capacity===record.data.capacity};
        }
        records.push(record);
      }
      return json({ok:true,records});
    }
    if (!id) return fail(400, 'record id required');
    const body = await bodyOf(request);
    if (meta.records.collections[collection].booking) {
      if (op !== 'update' || !meta.roles[access.role].signIn) return fail(403, 'bookings are created and released through checkout');
      if (!Number.isSafeInteger(body.version) || !ID.test(body.data?.slot ?? '') || Object.keys(body.data ?? {}).some(k => k !== 'slot')) return fail(400, 'move requires slot and current version');
      const moved = await moveBooking(env, { app: recordApp, collection, id, slot: body.data.slot, version: body.version });
      return moved ? json({ ok: true, id, version: body.version + 1 }) : fail(409, 'booking changed or is released; reload');
    }
    if (op !== 'delete') { const bad = recordProblem(meta.records.collections[collection], body.data, { create: op === 'create' }); if (bad) return fail(400, bad); }
    if (op !== 'create' && (!Number.isSafeInteger(body.version) || body.version < 1)) return fail(400, 'record version required');
    const stmt = op === 'create'
      ? env.DB.prepare('INSERT OR IGNORE INTO app_records (app, collection, id, value, version, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)').bind(recordApp, collection, id, JSON.stringify(body.data), Date.now())
      : op === 'update' ? env.DB.prepare('UPDATE app_records SET value = ?4, version = version + 1, updated_at = ?5 WHERE app = ?1 AND collection = ?2 AND id = ?3 AND version = ?6').bind(recordApp, collection, id, JSON.stringify(body.data), Date.now(), body.version)
      : env.DB.prepare('DELETE FROM app_records WHERE app = ?1 AND collection = ?2 AND id = ?3 AND version = ?4').bind(recordApp, collection, id, body.version);
    const result = await stmt.run();
    return result.meta.changes ? json({ ok: true, id, version: op === 'create' ? 1 : body.version + 1 }) : fail(409, 'record changed or already exists; reload');
  } catch (error) {
    if (/booking capacity|capacity below|slot has active/.test(error.message)) return fail(409, error.message);
    if (error instanceof SyntaxError || error.message === 'body too large') return fail(400, error.message);
    return fail(503, 'app database unavailable; apply studio migrations');
  }
}
