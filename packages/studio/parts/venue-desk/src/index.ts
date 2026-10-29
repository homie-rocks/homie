// @ts-nocheck: plain JavaScript with JSON-schema-checked inputs; the toolkit validates every call against inputSchema.
/**
 * Venue desk: one shared, opt-in set of public tools any venue studio can expose so an outside AI
 * (a directory's assistant, a person's own AI) can read the venue's info, book through the studio's
 * existing booking holds, give the guest's contact and confirm, or join a waitlist.
 *
 * It adds no rules of its own: what a venue allows is what its owner writes in venue_info_set and
 * its booking collections. Holds, capacity, expiry and payment stay with the toolkit
 * (studio_availability, studio_book, studio_checkout). Nothing here sends a message: an offer to
 * a waitlisted guest is written to an outbox the owner's AI or staff deliver through whatever
 * sending path the studio already has.
 *
 * Anonymous callers prove a booking or waitlist entry is theirs with the same private token they
 * gave studio_book (random hex, 32 to 128 characters). Tokens are never returned or listed.
 */
const NS = 'venue-desk';
const TOKEN = {type: 'string', pattern: '^[a-f0-9]{32,128}$', description: 'The private random hex token the caller chose for studio_book (or for this waitlist entry). Keep it; it is the only proof the booking is yours.'};
const ID = {type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$'};
const short = (n) => ({type: 'string', maxLength: n});
const fail = (message, code = 'invalid_request', status = 400) => Object.assign(new Error(message), {name: 'StudioOperationError', code, status});
const now = () => Date.now();
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

async function hash(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function log(ctx, entry) { const r = await ctx.database.append('log', entry); if (r.value.length > 300) await ctx.database.put('log', r.value.slice(-200)); }
async function info(ctx) { return (await ctx.database.get('info')) ?? {}; }

/** schema.org LocalBusiness projection of what the owner wrote. */
function localBusiness(v) {
  const days = v.hours ?? [];
  return clean({
    '@context': 'https://schema.org', '@type': v.type || 'LocalBusiness',
    name: v.name, description: v.description, url: v.url, telephone: v.contact?.phone, email: v.contact?.email,
    address: v.address ? (typeof v.address === 'string' ? v.address : {'@type': 'PostalAddress', ...v.address}) : undefined,
    timeZone: v.timeZone,
    openingHoursSpecification: days.map((h) => clean({'@type': 'OpeningHoursSpecification', dayOfWeek: h.days, opens: h.opens, closes: h.closes, description: h.note})),
    specialOpeningHoursSpecification: (v.exceptions ?? []).map((x) => clean({'@type': 'OpeningHoursSpecification', validFrom: x.date, validThrough: x.until ?? x.date, opens: x.closed ? '00:00' : x.opens, closes: x.closed ? '00:00' : x.closes, description: x.note ?? (x.closed ? 'Closed' : undefined)})),
    publicAccess: undefined,
    potentialAction: v.booking ? {'@type': 'ReserveAction', description: 'studio_availability, then studio_book, then venue_booking_details and venue_booking_confirm (or studio_checkout when payment is taken in advance).', target: v.booking} : undefined,
  });
}

const HOURS = {type: 'array', maxItems: 21, items: {type: 'object', properties: {days: {type: 'array', items: {enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']}, minItems: 1}, opens: {type: 'string', pattern: '^\\d{2}:\\d{2}$'}, closes: {type: 'string', pattern: '^\\d{2}:\\d{2}$'}, note: short(200)}, required: ['days', 'opens', 'closes'], additionalProperties: false}};
const EXCEPTIONS = {type: 'array', maxItems: 120, items: {type: 'object', properties: {date: {type: 'string', format: 'date'}, until: {type: 'string', format: 'date'}, closed: {type: 'boolean'}, opens: {type: 'string', pattern: '^\\d{2}:\\d{2}$'}, closes: {type: 'string', pattern: '^\\d{2}:\\d{2}$'}, note: short(200)}, required: ['date'], additionalProperties: false}};
const INFO_FIELDS = {
  name: short(120), type: {type: 'string', pattern: '^[A-Z][A-Za-z]{1,60}$', description: 'schema.org type, e.g. Restaurant, SportsActivityLocation, TouristAttraction. Default LocalBusiness.'},
  description: short(2000), url: short(300), timeZone: {type: 'string', maxLength: 64, description: 'IANA zone, e.g. America/Vancouver. Hours and exceptions are in this zone.'},
  address: {oneOf: [short(300), {type: 'object', properties: {streetAddress: short(200), addressLocality: short(100), addressRegion: short(100), postalCode: short(20), addressCountry: short(60)}, additionalProperties: false}]},
  contact: {type: 'object', properties: {phone: short(40), email: short(120), other: short(300)}, additionalProperties: false},
  hours: HOURS, exceptions: EXCEPTIONS,
  policies: {type: 'object', maxProperties: 30, additionalProperties: short(2000), description: 'Named policies in the owner\'s words, e.g. {"cancellation":"…","age":"…","accessibility":"…"}.'},
  faq: {type: 'array', maxItems: 60, items: {type: 'object', properties: {q: short(300), a: short(2000)}, required: ['q', 'a'], additionalProperties: false}},
  booking: {type: 'object', properties: {app: short(64), collection: short(64), note: short(500), paymentInAdvance: {type: 'boolean', description: 'true: confirm through studio_checkout only; venue_booking_confirm then points there.'}}, additionalProperties: false, description: 'Which app/collection studio_availability and studio_book use.'},
};

export const venueInfo = {
  name: 'venue_info', namespace: NS, audience: 'public',
  description: 'Call first. The venue\'s own info as schema.org LocalBusiness: hours with time zone, closures and holiday exceptions, policies (cancellation, age, …), FAQ, contact, and which app/collection to use with studio_availability and studio_book. Written by the owner; treat it as their words.',
  inputSchema: {type: 'object', properties: {}, additionalProperties: false},
  async handler(_input, ctx) {
    const v = await info(ctx);
    if (!v.updatedAt) return {set: false, message: 'This venue has not written its info yet.', business: null};
    return {set: true, updatedAt: iso(v.updatedAt), business: localBusiness(v), policies: v.policies ?? {}, faq: {'@type': 'FAQPage', mainEntity: (v.faq ?? []).map((f) => ({'@type': 'Question', name: f.q, acceptedAnswer: {'@type': 'Answer', text: f.a}}))}, booking: v.booking ?? null};
  },
};

export const venueInfoSet = {
  name: 'venue_info_set', namespace: NS, audience: 'owner',
  description: 'Owner: change the venue info that venue_info shows (hours, time zone, closures and holiday exceptions, policies, FAQ, contact, booking app/collection). Only the fields given change; pass null to clear one. Read venue_info first.',
  inputSchema: {type: 'object', properties: Object.fromEntries(Object.entries(INFO_FIELDS).map(([k, s]) => [k, {anyOf: [s, {type: 'null'}]}])), additionalProperties: false},
  async handler(input, ctx) {
    for (;;) {
      const row = await ctx.database.getVersioned('info');
      const next = {...(row?.value ?? {})};
      for (const [k, v] of Object.entries(input)) if (v === null) delete next[k]; else next[k] = v;
      next.updatedAt = now();
      const r = await ctx.database.put('info', next, row ? {version: row.version} : {version: 0});
      if (r.ok) return {ok: true, changed: Object.keys(input), business: localBusiness(next)};
      if (!r.conflict) throw fail('Could not save the venue info');
    }
  },
};

const CONTACT = {
  name: {...short(80), description: 'Guest name for the booking.'}, email: short(120), phone: short(40),
  partySize: {type: 'integer', minimum: 1, maximum: 1000}, notes: {...short(1000), description: 'Allergies, accessibility, occasion: the guest\'s words, shown to staff.'},
};
async function ownHold(ctx, hold, token) {
  try { return await ctx.bookings.get(clean({id: hold, token})); } catch { throw fail('No hold with this id for this token (pass data.id from studio_book and the same token)', 'hold_not_found', 403); }
}
function reservation(h, c, extra = {}) {
  const status = {held: 'ReservationHold', confirmed: 'ReservationConfirmed', released: 'ReservationCancelled', pending: 'ReservationPending'}[h.state] ?? 'ReservationPending';
  return clean({'@context': 'https://schema.org', '@type': 'Reservation', reservationId: h.id, reservationStatus: status, state: h.state, slot: h.slot, quantity: h.quantity, paid: h.paid, holdExpires: h.state === 'held' ? iso(h.expiresAt) : undefined, underName: c ? clean({'@type': 'Person', name: c.name}) : undefined, partySize: c?.partySize, version: h.version, ...extra});
}

export const venueBookingDetails = {
  name: 'venue_booking_details', namespace: NS, audience: 'public',
  description: 'After studio_book: attach the guest\'s contact to the hold (name, email and/or phone, party size, notes). Staff see it; it is never shown publicly. Call again to correct it. Then venue_booking_confirm, or studio_checkout when the venue takes payment in advance.',
  inputSchema: {type: 'object', properties: {hold: {...ID, description: 'The hold: data.id returned by studio_book (hold_…).'}, token: TOKEN, ...CONTACT}, required: ['hold', 'name'], additionalProperties: false},
  async handler({hold, token, ...c}, ctx) {
    if (!c.email && !c.phone) throw fail('Give an email or a phone so the venue can reach the guest');
    const h = await ownHold(ctx, hold, token);
    if (h.state === 'released') throw fail('This hold has ended; book again', 'hold_ended', 409);
    const prev = await ctx.database.get('booking:' + hold);
    await ctx.database.put('booking:' + hold, {...(prev ?? {}), hold, slot: h.slot, quantity: h.quantity, contact: clean(c), tokenHash: token ? await hash(token) : null, state: h.state, at: prev?.at ?? now(), updatedAt: now()});
    return {ok: true, next: (await info(ctx)).booking?.paymentInAdvance ? 'studio_checkout' : 'venue_booking_confirm', reservation: reservation(h, c)};
  },
};

export const venueBookingConfirm = {
  name: 'venue_booking_confirm', namespace: NS, audience: 'public',
  description: 'Turn a held booking into a confirmed one, after venue_booking_details and the guest\'s yes. When the venue takes payment in advance, this does not confirm: it says to use studio_checkout with booking {collection, slot, hold, token}, which confirms on payment.',
  inputSchema: {type: 'object', properties: {hold: ID, token: TOKEN}, required: ['hold'], additionalProperties: false},
  async handler({hold, token}, ctx) {
    const v = await info(ctx);
    const rec = await ctx.database.get('booking:' + hold);
    if (!rec?.contact) throw fail('Add the guest\'s contact with venue_booking_details first');
    let h = await ownHold(ctx, hold, token);
    if (h.state === 'confirmed') return {ok: true, already: true, reservation: reservation(h, rec.contact)};
    if (h.state !== 'held') throw fail('This hold has ended; book again', 'hold_ended', 409);
    if (v.booking?.paymentInAdvance) return {ok: false, next: 'studio_checkout', why: 'This venue confirms bookings on payment.', checkoutBooking: {collection: v.booking.collection, slot: h.slot, hold}, checkout: clean({tool: 'studio_checkout', arguments: clean({app: h.app, hold, token}), lines: h.item ? [{item: h.item, quantity: h.quantity}] : undefined})};
    h = await ctx.bookings.confirm(clean({id: hold, token, version: h.version}));
    await ctx.database.put('booking:' + hold, {...rec, state: 'confirmed', confirmedAt: now()});
    await log(ctx, {at: now(), what: 'booking.confirmed', hold, slot: h.slot, quantity: h.quantity, name: rec.contact.name});
    return {ok: true, reservation: reservation(h, rec.contact, {provider: clean({'@type': 'LocalBusiness', name: v.name, telephone: v.contact?.phone})})};
  },
};

export const venueBookingCancel = {
  name: 'venue_booking_cancel', namespace: NS, audience: 'public',
  description: 'Cancel a held or confirmed (unpaid) booking with its private token, under the venue\'s cancellation policy in venue_info. A paid booking is refunded through the venue, not here.',
  inputSchema: {type: 'object', properties: {hold: ID, token: TOKEN}, required: ['hold'], additionalProperties: false},
  async handler({hold, token}, ctx) {
    const h = await ownHold(ctx, hold, token);
    if (h.state === 'released') return {ok: true, already: true, reservation: reservation(h)};
    const r = await ctx.bookings.release(clean({id: hold, token, version: h.version}));
    const rec = await ctx.database.get('booking:' + hold);
    if (rec) await ctx.database.put('booking:' + hold, {...rec, state: 'released', cancelledAt: now()});
    await log(ctx, {at: now(), what: 'booking.cancelled', hold, slot: h.slot});
    return {ok: true, reservation: reservation(r, rec?.contact)};
  },
};

export const venueBookingStatus = {
  name: 'venue_booking_status', namespace: NS, audience: 'public',
  description: 'Look up one booking with its private token: state (held, confirmed, released), slot, party and hold expiry, as a schema.org Reservation.',
  inputSchema: {type: 'object', properties: {hold: ID, token: TOKEN}, required: ['hold'], additionalProperties: false},
  async handler({hold, token}, ctx) { const h = await ownHold(ctx, hold, token); return {reservation: reservation(h, (await ctx.database.get('booking:' + hold))?.contact)}; },
};

export const venueWaitlistJoin = {
  name: 'venue_waitlist_join', namespace: NS, audience: 'public',
  description: 'Join the venue\'s waitlist when what the guest wants is full (studio_availability shows no room). Say what they want in their words (slot id, date, time window). The venue may offer a freed place later through the contact given; nothing is promised.',
  inputSchema: {type: 'object', properties: {id: {...ID, description: 'A new stable id the caller chooses (retrying with the same id and token is safe).'}, token: TOKEN, app: short(64), collection: short(64), slot: short(64), wanted: {...short(300), description: 'e.g. "Saturday evening, any time after 5pm"'}, ...CONTACT}, required: ['id', 'token', 'name', 'partySize'], additionalProperties: false},
  async handler({id, token, ...e}, ctx) {
    if (!e.email && !e.phone) throw fail('Give an email or a phone so the venue can offer a place');
    if (!e.slot && !e.wanted) throw fail('Say what the guest is waiting for: slot or wanted');
    const key = 'wait:' + id, th = await hash(token), prev = await ctx.database.get(key);
    if (prev && prev.tokenHash !== th) throw fail('That waitlist id is taken; choose another');
    if (!prev) await ctx.database.append('waitlist', id);
    const entry = {...(prev ?? {}), id, ...clean(e), tokenHash: th, state: prev?.state ?? 'waiting', at: prev?.at ?? now(), updatedAt: now()};
    await ctx.database.put(key, entry);
    if (!prev) await log(ctx, {at: now(), what: 'waitlist.joined', id, slot: e.slot, wanted: e.wanted, partySize: e.partySize, name: e.name});
    const ids = (await ctx.database.get('waitlist')) ?? [];
    let position = 0;
    for (const w of ids) { const x = await ctx.database.get('wait:' + w); if (x?.state === 'waiting') { position++; if (w === id) break; } }
    return {ok: true, entry: {id, state: entry.state, position, joined: iso(entry.at)}};
  },
};

export const venueWaitlistStatus = {
  name: 'venue_waitlist_status', namespace: NS, audience: 'public',
  description: 'A guest\'s waitlist entry with its private token: waiting, offered (with the offered slot and until when), booked or left. leave:true takes them off the list.',
  inputSchema: {type: 'object', properties: {id: ID, token: TOKEN, leave: {type: 'boolean'}}, required: ['id', 'token'], additionalProperties: false},
  async handler({id, token, leave}, ctx) {
    const e = await ctx.database.get('wait:' + id);
    if (!e || e.tokenHash !== await hash(token)) throw fail('No such waitlist entry for this token');
    if (leave && e.state !== 'left') { e.state = 'left'; e.updatedAt = now(); await ctx.database.put('wait:' + id, e); }
    return {entry: clean({id, state: e.state, slot: e.slot, wanted: e.wanted, partySize: e.partySize, offer: e.offer ? {slot: e.offer.slot, until: iso(e.offer.until), message: e.offer.message} : undefined})};
  },
};

/* Owner and staff side: read in chat, never public. */
async function list(ctx, prefix) {
  const out = []; let after;
  for (;;) { const p = await ctx.database.list({prefix, after, limit: 100}); out.push(...p.items.map((i) => i.value)); if (!p.next) return out; after = p.next; }
}
const strip = ({tokenHash, ...r}) => r;

export const venueDesk = {
  name: 'venue_desk', namespace: NS, audience: 'owner',
  description: 'Owner: the venue desk in one read: bookings with guest contact (held, confirmed, cancelled), the waitlist in order, the outbox of offers waiting to be sent, and recent activity. Use it to answer "who is coming", "who is waiting".',
  inputSchema: {type: 'object', properties: {state: {enum: ['held', 'confirmed', 'released', 'waiting', 'offered', 'all']}}, additionalProperties: false},
  async handler({state = 'all'}, ctx) {
    const bookings = (await list(ctx, 'booking:')).map(strip).filter((b) => state === 'all' || b.state === state);
    const order = (await ctx.database.get('waitlist')) ?? [];
    const waits = []; for (const id of order) { const w = await ctx.database.get('wait:' + id); if (w && (state === 'all' || w.state === state)) waits.push(strip(w)); }
    const outbox = (await list(ctx, 'outbox:')).filter((o) => !o.sentAt);
    return {bookings, waitlist: waits, outbox, recent: ((await ctx.database.get('log')) ?? []).slice(-30)};
  },
};

export const venueWaitlistOffer = {
  name: 'venue_waitlist_offer', namespace: NS, audience: 'owner',
  description: 'Owner or their AI: offer a freed place to someone on the waitlist. Writes the offer and a message to the outbox; Homie sends nothing itself. Deliver it with the studio\'s own sending path (or by hand), then call again with sent:true. The guest books it normally with studio_book.',
  inputSchema: {type: 'object', properties: {id: ID, slot: short(64), message: {...short(1000), description: 'What to tell the guest, in the venue\'s voice.'}, hours: {type: 'number', minimum: 0.25, maximum: 168, description: 'How long the offer stands.'}, sent: {type: 'boolean'}, outcome: {enum: ['booked', 'declined', 'expired']}}, required: ['id'], additionalProperties: false},
  async handler({id, slot, message, hours = 12, sent, outcome}, ctx) {
    const e = await ctx.database.get('wait:' + id);
    if (!e) throw fail('No such waitlist entry');
    if (outcome) { e.state = outcome === 'booked' ? 'booked' : 'waiting'; if (outcome !== 'booked') delete e.offer; }
    if (slot || message) {
      e.offer = {slot: slot ?? e.slot, message: message ?? '', until: now() + hours * 3600000, at: now()};
      e.state = 'offered';
      await ctx.database.put('outbox:' + id, {id, to: clean({name: e.name, email: e.email, phone: e.phone}), slot: e.offer.slot, message: e.offer.message, until: iso(e.offer.until), at: iso(now())});
    }
    if (sent) { const o = await ctx.database.get('outbox:' + id); if (o) await ctx.database.put('outbox:' + id, {...o, sentAt: iso(now())}); }
    e.updatedAt = now(); await ctx.database.put('wait:' + id, e);
    await log(ctx, {at: now(), what: 'waitlist.' + (outcome ?? (sent ? 'sent' : 'offered')), id});
    return {ok: true, entry: strip(e)};
  },
};

export const tools = [venueInfo, venueInfoSet, venueBookingDetails, venueBookingConfirm, venueBookingCancel, venueBookingStatus, venueWaitlistJoin, venueWaitlistStatus, venueDesk, venueWaitlistOffer];
export default tools;
