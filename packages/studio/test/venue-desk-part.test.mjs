import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const src = fileURLToPath(new URL('../parts/venue-desk/src/index.ts', import.meta.url));
async function load() {
  const out = await build({entryPoints: [src], bundle: true, format: 'esm', platform: 'neutral', write: false});
  const f = join(mkdtempSync(join(tmpdir(), 'venue-')), 'v.mjs'); writeFileSync(f, out.outputFiles[0].text);
  return import(pathToFileURL(f).href);
}
function db() {
  const m = new Map();
  return {
    async get(k) { return m.get(k)?.value ?? null; },
    async getVersioned(k) { return m.get(k) ?? null; },
    async put(k, value, {version} = {}) { const r = m.get(k); if (version === 0 && r) return {ok: false, conflict: true}; if (version > 0 && r?.version !== version) return {ok: false, conflict: true}; m.set(k, {value: structuredClone(value), version: (r?.version ?? 0) + 1}); return {ok: true, version: m.get(k).version}; },
    async append(k, v) { const r = m.get(k); const value = [...(r?.value ?? []), v]; m.set(k, {value, version: (r?.version ?? 0) + 1}); return {value, version: m.get(k).version}; },
    async list({prefix = '', after = '', limit = 100} = {}) { const items = [...m.keys()].sort().filter((k) => k.startsWith(prefix) && k > after).map((key) => ({key, ...m.get(key)})); return {items: items.slice(0, limit), next: items.length > limit ? items[limit - 1].key : null}; },
  };
}
function bookings() {
  const h = new Map();
  const own = ({id, token}) => { const x = h.get(id); if (!x || x.token !== token) throw new Error('not yours'); return x; };
  const pub = ({token, ...x}) => ({...x});
  return {
    hold(a) { h.set(a.id, {id: a.id, slot: a.slot, quantity: a.quantity ?? 1, state: 'held', version: 1, expiresAt: a.expiresAt, paid: false, token: a.token}); return pub(h.get(a.id)); },
    async get(a) { return pub(own(a)); },
    async confirm(a) { const x = own(a); assert.equal(a.version, x.version); x.state = 'confirmed'; x.version++; return pub(x); },
    async release(a) { const x = own(a); x.state = 'released'; x.version++; return pub(x); },
  };
}
const T = 'a'.repeat(64), U = 'b'.repeat(64);

test('venue desk: info, details, confirm, waitlist, offer', async () => {
  const m = await load(); const by = Object.fromEntries(m.tools.map((t) => [t.name, t]));
  for (const t of m.tools) { assert.match(t.name, /^venue_[a-z_]+$/); assert.equal(t.inputSchema.type, 'object'); assert.ok(t.description.length > 40); }
  const ctx = {database: db(), bookings: bookings()};
  assert.equal((await by.venue_info.handler({}, ctx)).set, false);
  await by.venue_info_set.handler({name: 'Surf School', type: 'SportsActivityLocation', timeZone: 'America/Vancouver', hours: [{days: ['Saturday'], opens: '09:00', closes: '17:00'}], exceptions: [{date: '2026-12-25', closed: true, note: 'Christmas'}], policies: {cancellation: '24 hours'}, faq: [{q: 'Wetsuits?', a: 'Yes'}], booking: {app: 'sunset', collection: 'bookings'}}, ctx);
  const i = await by.venue_info.handler({}, ctx);
  assert.equal(i.business['@type'], 'SportsActivityLocation'); assert.equal(i.business.specialOpeningHoursSpecification[0].closes, '00:00'); assert.equal(i.faq.mainEntity[0]['@type'], 'Question');
  ctx.bookings.hold({id: 'h1', slot: 's1', token: T, expiresAt: Date.now() + 6e5});
  await assert.rejects(by.venue_booking_confirm.handler({hold: 'h1', token: T}, ctx), /contact/);
  await assert.rejects(by.venue_booking_details.handler({hold: 'h1', token: U, name: 'A', email: 'a@x'}, ctx), /token/);
  await assert.rejects(by.venue_booking_details.handler({hold: 'h1', token: T, name: 'A'}, ctx), /email or a phone/);
  assert.equal((await by.venue_booking_details.handler({hold: 'h1', token: T, name: 'Ann', email: 'a@x', partySize: 2}, ctx)).next, 'venue_booking_confirm');
  const c = await by.venue_booking_confirm.handler({hold: 'h1', token: T}, ctx);
  assert.equal(c.reservation.reservationStatus, 'ReservationConfirmed');
  assert.equal((await by.venue_booking_confirm.handler({hold: 'h1', token: T}, ctx)).already, true);
  const w = await by.venue_waitlist_join.handler({id: 'w1', token: U, slot: 's1', name: 'Bo', phone: '555', partySize: 3}, ctx);
  assert.equal(w.entry.position, 1);
  await assert.rejects(by.venue_waitlist_join.handler({id: 'w1', token: T, slot: 's1', name: 'X', phone: '1', partySize: 1}, ctx), /taken/);
  await by.venue_waitlist_offer.handler({id: 'w1', slot: 's2', message: 'A spot opened'}, ctx);
  const desk = await by.venue_desk.handler({}, ctx);
  assert.equal(desk.bookings[0].contact.name, 'Ann'); assert.equal(desk.outbox.length, 1); assert.ok(!JSON.stringify(desk).includes('tokenHash'));
  assert.equal((await by.venue_waitlist_status.handler({id: 'w1', token: U}, ctx)).entry.state, 'offered');
  await by.venue_waitlist_offer.handler({id: 'w1', sent: true}, ctx);
  assert.equal((await by.venue_desk.handler({}, ctx)).outbox.length, 0);
  assert.equal((await by.venue_booking_cancel.handler({hold: 'h1', token: T}, ctx)).reservation.reservationStatus, 'ReservationCancelled');
  await by.venue_info_set.handler({booking: {app: 'sunset', collection: 'bookings', paymentInAdvance: true}}, ctx);
  ctx.bookings.hold({id: 'h2', slot: 's1', token: T, expiresAt: Date.now() + 6e5});
  await by.venue_booking_details.handler({hold: 'h2', token: T, name: 'C', phone: '1'}, ctx);
  assert.equal((await by.venue_booking_confirm.handler({hold: 'h2', token: T}, ctx)).next, 'studio_checkout');
});
