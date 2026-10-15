/** Chat authorization, rate limits and history for a room. The relay owns its shared state. */





import { CHAT_LIMITS, CHAT_RATES, HELD_WORDS, allows, cleanText, floor, normalizeChat, windowMsOf } from './chat.mjs';
import { CONTROL_LIMITS, oneLine, handleFor, randomId } from './room-protocol.mjs';
export class RoomChat {
 constructor(room) {this.room=room;}
chatRules() {
    if (this.room.policy.chat) return this.room.policy.chat;
    const sig = `${this.room.policy.kids}|${this.room.policy.speech}`;
    if (!this.room.defaultChat || this.room.defaultChat.sig !== sig) this.room.defaultChat = { sig, rules: normalizeChat(null, { kids: this.room.policy.kids, speech: this.room.policy.speech }) };
    return this.room.defaultChat.rules;
  }
recentChat(now = this.room.now()) {
    const keep = windowMsOf(this.room.chatRules());
    return this.room.chatLog.filter((r) => now - r.at <= keep).slice(-CHAT_LIMITS.keep);
  }
hydrate(recs) {
    const have = new Set(this.room.chatLog.map((r) => r.id));
    const old = (Array.isArray(recs) ? recs : []).filter((r) => r && typeof r.id === 'string' && !have.has(r.id));
    this.room.chatLog = [...old, ...this.room.chatLog].sort((a, b) => a.at - b.at).slice(-CHAT_LIMITS.keep);
    this.room.hydrated = true;
    return old.length;
  }
wireLine(r) {
    const base = { id: r.id, at: r.at, name: r.name, seat: r.seat, colour: r.colour, by: r.by, ...(r.bubble ? { bubble: true } : {}), ...(r.acct ? { acct: true } : {}), ...(r.owner ? { owner: true } : {}), ...(r.mod ? { mod: true } : {}), ...(r.kept ? { kept: true } : {}) };
    if (r.kind === 'react') return { t: 'react', ...base, react: r.react, glyph: r.glyph };
    // A show-what-you-made card (0.29.0): a page that knows cards draws one; any other shows its words.
    return { t: 'line', ...base, text: r.text, ...(r.say ? { say: r.say } : {}), ...(r.kind === 'card' && r.card ? { card: r.card } : {}) };
  }
watchIdOf(conn) {
    let id = this.room.watchIds.get(conn);
    if (!id) { id = randomId(6); this.room.watchIds.set(conn, id); }
    return id;
  }
chatter(client, conn) {
    let g = client;
    if (!g && conn) {
      const mine = this.room.live().filter((o) => !o.agent && ((conn.browser && o.browser === conn.browser) || (conn.player && o.player === conn.player)));
      g = mine.find((o) => o.seat !== null) ?? mine.find((o) => o.watch) ?? mine[0] ?? null;
    }
    const via = String(g?.via ?? conn?.via ?? '');
    const owner = via.split('~').includes('o');
    const seat = g ? g.seat : null;
    const handle = handleFor(g?.token || g?.browser || conn?.browser || `w-${this.room.watchIdOf(conn ?? g?.conn ?? {})}`);
    // A watcher's name: its game's, else the account name the Worker vouched for (the Lounge), else a handle.
    const name = seat !== null ? g.name : oneLine(g?.typed, CHAT_LIMITS.name) || oneLine(conn?.name, CHAT_LIMITS.name) || handle;
    return {
      key: g ? `c:${g.id}` : `w:${this.room.watchIdOf(conn)}`, client: g, seat, name, colour: seat !== null ? g.colour : null,
      player: g?.player ?? conn?.player ?? null, acct: Boolean(g?.acct || conn?.acct), member: Boolean(g?.member || conn?.member) || owner,
      // A moderator the owner named (the Lounge): only the Worker's word, shown on their lines.
      mod: Boolean(conn?.mod) && !owner,
      owner, browser: g?.browser ?? conn?.browser ?? null, token: g?.token ?? null, ip: g?.ip ?? conn?.ip ?? null,
      watch: seat === null, hub: Boolean(conn?.hub) && !g, agent: Boolean(g?.agent), conn: conn ?? g?.conn ?? null,
    };
  }
takeToken(map, key, rate, now) {
    let b = map.get(key);
    if (!b) { b = { tokens: rate.burst, at: now }; map.set(key, b); }
    b.tokens = Math.min(rate.burst, b.tokens + (now - b.at) / rate.refillMs);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
onChat({ client = null, conn = null }, m) {
    const now = this.room.now();
    const rules = this.room.chatRules();
    const who = this.room.chatter(client, conn);
    const n = typeof m.n === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(m.n) ? m.n : null;
    const kind = m.t === 'react' ? 'react' : typeof m.say === 'string' || typeof m.line === 'string' ? 'line' : 'text';
    const stats = this.room.stats;
    const reply = (why, extra = {}) => {
      stats.chatHeld = stats.chatHeld ?? {};
      stats.chatHeld[why] = (stats.chatHeld[why] ?? 0) + 1;
      const out = JSON.stringify({ t: why === 'slow' ? 'slow' : 'held', why, message: HELD_WORDS[why] ?? HELD_WORDS.unknown, ...(n ? { n } : {}), ...extra });
      if (who.conn) this.room.sendText(who.conn, out);
      return { ok: false, why };
    };
    if (who.agent) return reply('ai_seat');
    if (!allows(rules, kind)) return reply(rules.mode === 'off' ? 'off' : rules.mode === 'emoji' ? 'emoji' : 'lines');
    if (who.hub && !rules.hub) return reply('hub');
    if (who.watch && !rules.watchers && !who.owner) return reply('watchers');
    const need = kind === 'text' ? rules.who : rules.react;
    if (!who.owner && need === 'signed-in' && !who.acct) return reply(kind === 'text' ? 'sign-in' : 'sign-in-react');
    if (!who.owner && need === 'members' && !who.member) return reply(kind === 'text' ? 'members' : 'members-react');
    const mute = this.room.muteOf({ token: who.token, browser: who.browser, player: who.player });
    if (mute) return reply('muted', { until: mute.until });
    const b = this.room.chatBuckets.get(who.key) ?? { lastSayAt: -Infinity, lastText: '', lastTextAt: -Infinity };
    this.room.chatBuckets.set(who.key, b);
    if (!this.room.takeToken(this.room.chatBuckets, `${who.key}|${kind === 'react' ? 'react' : 'say'}`, kind === 'react' ? CHAT_RATES.react : CHAT_RATES.say, now)) return reply('slow');
    if (who.ip && !this.room.takeToken(this.room.chatAddress, who.ip, CHAT_RATES.address, now)) return reply('slow');
    if (kind !== 'react' && rules.slow && !who.owner && now - b.lastSayAt < rules.slow * 1000) return reply('slow', { until: b.lastSayAt + rules.slow * 1000, slow: rules.slow });
    let rec;
    if (kind === 'react') {
      const k = String(m.kind ?? m.react ?? '');
      const r = rules.emoji.find((x) => x.k === k);
      if (!r) return reply('unknown');
      // A storm of reactions: the room fans out at most so many a second (the sender's own still floats for them).
      while (this.room.chatReacts.length && this.room.chatReacts[0] <= now - 1000) this.room.chatReacts.shift();
      if (this.room.chatReacts.length >= CHAT_RATES.roomReactsPerSecond) { stats.chatDrops = (stats.chatDrops ?? 0) + 1; return { ok: true, dropped: true }; }
      this.room.chatReacts.push(now);
      rec = { kind: 'react', react: r.k, glyph: r.e };
    } else if (kind === 'line') {
      const id = String(m.say ?? m.line ?? '');
      const l = rules.lines.find((x) => x.id === id);
      if (!l) return reply('unknown');
      rec = { kind: 'line', say: l.id, text: l.text };
    } else {
      const text = cleanText(m.text, rules.max);
      if (!text) return reply('empty');
      const f = floor(text, rules);
      if (!f.ok) return reply(f.why);
      if (b.lastText === text.toLowerCase() && now - b.lastTextAt < CHAT_LIMITS.repeatMs) return reply('repeat');
      b.lastText = text.toLowerCase();
      b.lastTextAt = now;
      rec = { kind: 'text', text };
    }
    if (kind !== 'react') b.lastSayAt = now;
    Object.assign(rec, {
      name: who.name, seat: who.seat, colour: who.colour, by: who.hub ? 'hub' : who.watch ? 'watcher' : 'player',
      bubble: m.bubble !== false && rules.bubbles && who.seat !== null, acct: who.acct, owner: who.owner, ...(who.mod ? { mod: true } : {}),
      // Only the office sees these: who sent it, so a mute or a kick from the line reaches them (never an address).
      from: { client: who.client?.id ?? null, token: who.token, browser: who.browser, player: who.player },
    });
    if (kind === 'text' && rules.ai && typeof this.room.review === 'function' && !who.owner) {
      if (this.room.chatPending >= CHAT_LIMITS.pending) return reply('busy');
      this.room.chatPending += 1;
      const t0 = now;
      Promise.resolve()
        .then(() => this.room.review(rec.text, { room: this.room.code, links: rules.links }))
        .then((v) => v, (error) => ({ ok: true, by: 'error', error: String(error?.message ?? error).slice(0, 120) }))
        .then((v) => {
          this.room.chatPending = Math.max(0, this.room.chatPending - 1);
          if (v && v.ok === false) {
            stats.chatAiHeld = (stats.chatAiHeld ?? 0) + 1;
            // What the review thought it was (insult, hate, sexual, grooming, harm, spam): counts for the office only.
            stats.chatAiWhy = stats.chatAiWhy ?? {};
            const why = String(v.why ?? 'held').slice(0, 24);
            stats.chatAiWhy[why] = (stats.chatAiWhy[why] ?? 0) + 1;
            reply('ai');
            return;
          }
          if (v?.by === 'error') stats.chatAiErrors = (stats.chatAiErrors ?? 0) + 1;
          rec.review = { by: v?.by ?? 'ai', ms: this.room.now() - t0, ...(Number.isFinite(v?.p) ? { p: v.p } : {}) };
          // A mute that came while it was being reviewed still holds it.
          if (this.room.muteOf({ token: who.token, browser: who.browser, player: who.player })) { reply('muted'); return; }
          this.room.publishChat(rec, who.conn, n);
        });
      return { ok: true, pending: true };
    }
    return this.room.publishChat(rec, who.conn, n);
  }
publishChat(rec, senderConn = null, n = null) {
    const now = this.room.now();
    rec.id = randomId(6);
    rec.at = now;
    this.room.chatLog.push(rec);
    const keep = windowMsOf(this.room.chatRules());
    while (this.room.chatLog.length > CHAT_LIMITS.keep || (this.room.chatLog.length && now - this.room.chatLog[0].at > keep)) this.room.chatLog.shift();
    const msg = this.room.wireLine(rec);
    const text = JSON.stringify(msg);
    const mine = n ? JSON.stringify({ ...msg, n }) : text;
    const hub = this.room.chatRules().hub;
    for (const o of this.room.live()) if (!this.room.lite(o)) this.room.sendText(o.conn, o.conn === senderConn ? mine : text);
    for (const w of this.room.watchers) if (!w.hub || hub) this.room.sendText(w, w === senderConn ? mine : text);
    if (rec.kind === 'react') this.room.stats.chatReacts = (this.room.stats.chatReacts ?? 0) + 1;
    else this.room.stats.chatLines = (this.room.stats.chatLines ?? 0) + 1;
    // Kept chat (0.29.0): a room whose rules keep history hands what was said to the Table (never a reaction).
    if (rec.kind !== 'react' && this.room.chatRules().history > 0 && typeof this.room.onPublished === 'function') { try { this.room.onPublished(rec); } catch { /* kept next time */ } }
    return { ok: true, id: rec.id };
  }
unsay(ids) {
    const gone = new Set(ids);
    const before = this.room.chatLog.length;
    this.room.chatLog = this.room.chatLog.filter((r) => !gone.has(r.id));
    const text = JSON.stringify({ t: 'unline', ids: [...gone] });
    for (const o of this.room.live()) if (!this.room.lite(o)) this.room.sendText(o.conn, text);
    for (const w of this.room.watchers) this.room.sendText(w, text);
    // Kept chat: what is taken down here is deleted where it was kept, older lines than the window too.
    if (typeof this.room.onUnsaid === 'function' && gone.size) { try { this.room.onUnsaid([...gone]); } catch { /* best effort */ } }
    return before - this.room.chatLog.length;
  }
ownLine(r, conn) {
    const f = r?.from ?? {};
    if (!conn || r?.kind === 'studio') return false;
    return Boolean((conn.player && f.player && f.player === conn.player) || (conn.browser && f.browser && f.browser === conn.browser && !f.player));
  }
unsayOwn(conn, id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) return { ok: false, error: 'no-line' };
    const r = this.room.chatLog.find((x) => x.id === id);
    if (!r || r.kind === 'studio') return { ok: false, error: 'no-line' };
    if (!this.room.ownLine(r, conn)) return { ok: false, error: 'not-yours' };
    this.room.unsay([id]);
    this.room.stats.chatOwnRemoved = (this.room.stats.chatOwnRemoved ?? 0) + 1;
    return { ok: true, removed: 1 };
  }
holdSender(line, minutes, now, { kick = false, message = '', purge = false } = {}) {
    const f = line.from ?? {};
    if (!f.token && !f.browser && !f.player) return { ok: false, error: 'no-player', message: 'that line has nobody to hold' };
    const until = now + minutes * 60_000;
    const hold = { token: f.token ?? null, browser: f.browser ?? null, player: f.player ?? null, name: line.name, seat: line.seat, until, at: now };
    if (kick) this.room.bans = [...this.room.bans, { ...hold, ip: null, pass: null, message }].slice(-CONTROL_LIMITS.bans);
    else this.room.mutes = [...this.room.mutes, hold].slice(-CONTROL_LIMITS.mutes);
    this.room.tellBrowser(hold, kick ? { t: 'kicked', room: this.room.code, until, message } : { t: 'muted', room: this.room.code, until });
    const removed = purge ? this.room.unsay(this.room.linesOf(f)) : 0;
    this.room.tellWatchers();
    return { ok: true, op: kick ? 'kick' : 'mute', name: line.name, seat: line.seat, until, sockets: 0, ...(removed ? { removed } : {}) };
  }
linesOf(from) {
    if (!from) return [];
    return this.room.chatLog.filter((r) => (from.client && r.from?.client === from.client) || (from.token && r.from?.token === from.token) || (from.browser && r.from?.browser === from.browser) || (from.player && r.from?.player === from.player)).map((r) => r.id);
  }}
