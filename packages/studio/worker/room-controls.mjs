/** Owner controls, moderation and launch transitions for a room. The relay owns its shared state. */




import { skillPreset } from './agents.mjs';

import { CHAT_LIMITS, HELD_WORDS, floor } from './chat.mjs';
import { STALL, stallOf, versionOf, CONTROL_LIMITS, oneLine, randomId, keptRef } from './room-protocol.mjs';
export class RoomControls {
 constructor(room) {this.room=room;}
findClient({ id = null, seat = null } = {}) {
    if (typeof id === 'string' && id) { const c = this.room.clients.get(id); if (c && c.helloed) return c; }
    if (Number.isInteger(seat)) return this.room.live().find((c) => c.seat === seat) ?? null;
    return null;
  }
banOf(c, token = c.token) {
    const now = this.room.now();
    const pass = c.agent?.pass ?? c.agentWord?.pass ?? null;
    return this.room.bans.find((b) => b.until > now && ((b.token && b.token === token) || (b.browser && b.browser === c.browser) || (b.player && b.player === c.player) || (b.ip && b.ip === c.ip) || (b.pass && b.pass === pass))) ?? null;
  }
muteOf(c) {
    const now = this.room.now();
    return this.room.mutes.find((m) => m.until > now && ((m.token && m.token === c.token) || (m.browser && m.browser === c.browser) || (m.player && m.player === c.player))) ?? null;
  }
liveAnnouncement() {
    const a = this.room.announcement;
    return a && a.until > this.room.now() ? a : null;
  }
heldNotice(conn) {
    const now = this.room.now();
    if (this.room.closedUntil > now) return { t: 'closed', room: this.room.code, until: this.room.closedUntil, message: this.room.closedWhy || 'The studio closed this room.' };
    const probe = { token: null, browser: conn.browser ?? null, player: conn.player ?? null, ip: null };
    if (!probe.browser && !probe.player) return null;
    const ban = this.room.banOf(probe, null);
    if (ban) return { t: 'kicked', room: this.room.code, until: ban.until, message: ban.message };
    const mute = this.room.muteOf(probe);
    return mute ? { t: 'muted', room: this.room.code, until: mute.until } : null;
  }
tellBrowser(who, msg) {
    const text = JSON.stringify(msg);
    for (const w of this.room.watchers) if ((who.browser && w.browser === who.browser) || (who.player && w.player === who.player)) this.room.sendText(w, text);
  }
control(op, a = {}) {
    const now = this.room.now();
    const minutes = Math.max(1, Math.min(CONTROL_LIMITS.minutes, Math.floor(Number(a.minutes) || 10)));
    this.room.bans = this.room.bans.filter((b) => b.until > now);
    this.room.mutes = this.room.mutes.filter((m) => m.until > now);
    switch (op) {
      case 'kick': {
        // From a chat line (section 19): its sender, in this room now or not (a watcher with no seat is held too). A line
        // older than the window comes from the room's kept history (the Worker read it: its sender's account only).
        const line = typeof a.line === 'string' ? this.room.chatLog.find((r) => r.id === a.line) ?? keptRef(a) : null;
        const target = this.room.findClient(a) ?? (line?.from?.client ? this.room.clients.get(line.from.client) ?? null : null);
        if (!target && line) return this.room.holdSender(line, minutes, now, { kick: true, message: oneLine(a.message, CONTROL_LIMITS.message) || 'The studio removed you from this room.', purge: a.purge === true });
        if (!target) return { ok: false, error: 'no-player', message: 'nobody is in that seat now' };
        const purged = a.purge === true ? this.room.unsay(this.room.linesOf({ client: target.id, token: target.token, browser: target.browser, player: target.player })) : 0;
        const until = now + minutes * 60_000;
        // The message is the studio's words; `until` says when (the shell says it in the player's own time).
        const message = oneLine(a.message, CONTROL_LIMITS.message) || 'The studio removed you from this room.';
        // An AI is held out by its pass (its seat becomes a brainless AI seat again); a person by token, browser, account.
        const ban = { token: target.token, browser: target.browser, player: target.player, ip: a.address ? target.ip : null, pass: target.agent?.pass ?? null, name: line?.name ?? target.name, seat: target.seat, until, at: now, message };
        this.room.bans = [...this.room.bans, ban].slice(-CONTROL_LIMITS.bans);
        // Every socket of that player in this room: the seat itself, and its browser's or account's other tabs.
        const out = this.room.live().filter((o) => o === target || (ban.browser && o.browser === ban.browser) || (ban.player && o.player === ban.player));
        for (const o of out) {
          const seat = o.seat;
          const token = o.token;
          this.room.error(o, 'kicked', message, { until });
          this.room.onClose(o, 'kicked');
          // The seat is free for somebody else at once, and its token resumes nothing.
          const s = seat === null ? null : this.room.seats.get(seat);
          if (s && s.token === token) { this.room.seats.delete(seat); this.room.seatsDirty = true; }
          try { o.conn.close(1008, 'kicked'); } catch { /* gone */ }
        }
        this.room.stats.ownerKicks = (this.room.stats.ownerKicks ?? 0) + 1;
        this.room.tellBrowser(ban, { t: 'kicked', room: this.room.code, until, message });
        this.room.persist(now);
        this.room.tellWatchers();
        return { ok: true, op, name: ban.name, seat: ban.seat, sockets: out.length, until, ...(purged ? { removed: purged } : {}) };
      }
      case 'mute': {
        const line = typeof a.line === 'string' ? this.room.chatLog.find((r) => r.id === a.line) ?? keptRef(a) : null;
        const target = this.room.findClient(a) ?? (line?.from?.client ? this.room.clients.get(line.from.client) ?? null : null);
        if (!target && line && a.off !== true) return this.room.holdSender(line, minutes, now, { kick: false, purge: a.purge === true });
        if (!target) return { ok: false, error: 'no-player', message: 'nobody is in that seat now' };
        const off = a.off === true;
        const purged = !off && a.purge === true ? this.room.unsay(this.room.linesOf({ client: target.id, token: target.token, browser: target.browser, player: target.player })) : 0;
        const same = (m) => (m.token && m.token === target.token) || (m.browser && m.browser === target.browser) || (m.player && m.player === target.player);
        this.room.mutes = this.room.mutes.filter((m) => !same(m));
        const until = off ? 0 : now + minutes * 60_000;
        if (!off) this.room.mutes = [...this.room.mutes, { token: target.token, browser: target.browser, player: target.player, name: line?.name ?? target.name, seat: target.seat, until, at: now }].slice(-CONTROL_LIMITS.mutes);
        const note = { t: 'mute', id: target.id, seat: target.seat, until };
        for (const o of this.room.live()) this.room.send(o, note);
        this.room.tellBrowser(target, { t: 'muted', room: this.room.code, until });
        this.room.tellWatchers();
        return { ok: true, op, name: line?.name ?? target.name, seat: target.seat, until, ...(purged ? { removed: purged } : {}) };
      }
      case 'card': {
        // Show what you made (0.29.0): a link card to a studio's game, which the Worker read from that studio's own
        // manifest and checked (its words passed the floor and the review there). Its sender's name and account are the
        // Worker's word; a mute holds a card as it holds a line.
        const c = a.card && typeof a.card === 'object' ? a.card : null;
        if (!c || typeof c.url !== 'string' || !/^https?:\/\//.test(c.url)) return { ok: false, error: 'card', message: 'no card' };
        const who = { token: null, browser: typeof a.browser === 'string' ? a.browser : null, player: typeof a.player === 'string' ? a.player : null, ip: null };
        if (a.owner !== true && this.room.banOf(who, null)) return { ok: false, error: 'kicked', message: 'The studio has held you out of this room for now.' };
        if (a.owner !== true && this.room.muteOf(who)) return { ok: false, error: 'muted', message: HELD_WORDS.muted };
        const card = { url: c.url.slice(0, 300), title: oneLine(c.title, 80), studio: oneLine(c.studio, 60), pitch: oneLine(c.pitch, 160), image: typeof c.image === 'string' && /^https:\/\//.test(c.image) ? c.image.slice(0, 400) : null, ...(typeof c.game === 'string' ? { game: c.game.slice(0, 40) } : {}) };
        const note = oneLine(a.note, CHAT_LIMITS.text);
        const rules = this.room.chatRules();
        if (rules.mode !== 'text' && a.owner !== true) return { ok: false, error: 'held', why: rules.mode === 'off' ? 'off' : 'lines', message: 'The Lounge isn\'t taking cards right now.' };
        // The card's words (the person's note, the game's own title and pitch) pass the floor like any typed line.
        const words = [note, card.title, card.pitch].filter(Boolean).join(' · ');
        const f = floor(words, { ...rules, links: 'block' });
        if (!f.ok && a.owner !== true) return { ok: false, error: 'held', why: f.why, message: HELD_WORDS[f.why] ?? HELD_WORDS.unknown };
        const rec = {
          kind: 'card', card, text: note || `Made: ${card.title}${card.studio ? ` by ${card.studio}` : ''}`,
          name: oneLine(a.name, CHAT_LIMITS.name) || 'Someone', seat: null, colour: null, by: 'watcher', bubble: false,
          acct: a.acct === true, owner: a.owner === true, ...(a.mod === true ? { mod: true } : {}),
          from: { client: null, token: null, browser: who.browser, player: who.player },
        };
        // And the studio's review, as a typed line gets it (the owner's own card is never reviewed).
        if (rules.ai && typeof this.room.review === 'function' && a.owner !== true) {
          return Promise.resolve()
            .then(() => this.room.review(words, { room: this.room.code, links: 'block' }))
            .then((v) => v, () => ({ ok: true, by: 'error' }))
            .then((v) => {
              if (v && v.ok === false) { this.room.stats.chatAiHeld = (this.room.stats.chatAiHeld ?? 0) + 1; return { ok: false, error: 'held', why: 'ai', message: HELD_WORDS.ai }; }
              rec.review = { by: v?.by ?? 'ai' };
              if (this.room.muteOf(who)) return { ok: false, error: 'muted', message: HELD_WORDS.muted };
              return { ...this.room.publishChat(rec), op };
            });
        }
        return { ...this.room.publishChat(rec), op };
      }
      case 'unsay': {
        // Room chat (section 19): the owner takes a message down (or every message: `all`), on every screen at once.
        const ids = a.all === true ? this.room.chatLog.map((r) => r.id) : (Array.isArray(a.ids) ? a.ids : [a.id]).filter((x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(x)).slice(0, 64);
        if (!ids.length) return { ok: false, error: 'no-line', message: 'which message?' };
        const removed = this.room.unsay(ids);
        this.room.stats.chatRemoved = (this.room.stats.chatRemoved ?? 0) + removed;
        return { ok: true, op, removed };
      }
      case 'announce': {
        const text = oneLine(a.text, CONTROL_LIMITS.announce);
        const prev = this.room.announcement;
        if (!text) {
          this.room.announcement = null;
          if (prev) { const clear = JSON.stringify({ t: 'announce', id: prev.id, text: null }); for (const o of this.room.live()) this.room.sendText(o.conn, clear); for (const w of this.room.watchers) this.room.sendText(w, clear); }
          this.room.tellWatchers();
          return { ok: true, op, cleared: Boolean(prev) };
        }
        const seconds = Math.max(5, Math.min(CONTROL_LIMITS.announceSeconds, Math.floor(Number(a.seconds) || 30)));
        this.room.announcement = { id: typeof a.id === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(a.id) ? a.id : randomId(6), text, at: now, until: now + seconds * 1000, from: 'studio' };
        const msg = JSON.stringify({ t: 'announce', ...this.room.announcement });
        for (const o of this.room.live()) this.room.sendText(o.conn, msg);
        for (const w of this.room.watchers) this.room.sendText(w, msg);
        // The room's chat shows it too, as the studio's own line (section 19).
        this.room.publishChat({ kind: 'studio', text, name: 'Studio', seat: null, colour: null, by: 'studio', bubble: false, acct: false, owner: true, from: null });
        this.room.tellWatchers();
        return { ok: true, op, id: this.room.announcement.id, people: this.room.live().length, until: this.room.announcement.until };
      }
      case 'close': {
        if (a.reopen === true) { this.room.closedUntil = 0; this.room.closedWhy = ''; this.room.tellWatchers(); return { ok: true, op, reopened: true }; }
        // `seconds` (10 s to a day) is a short close: everyone comes back through the game's door (a launch state change).
        const seconds = Math.floor(Number(a.seconds));
        const until = now + (seconds >= 10 ? Math.min(seconds, CONTROL_LIMITS.minutes * 60) * 1000 : minutes * 60_000);
        const message = oneLine(a.message, CONTROL_LIMITS.message) || 'The studio closed this room. Thanks for playing!';
        this.room.closedUntil = until;
        this.room.closedWhy = message;
        const people = this.room.live().length;
        for (const c of [...this.room.clients.values()]) {
          if (c.helloed) this.room.error(c, 'room-closed', message, { until });
          this.room.clients.delete(c.id);
          try { c.conn.close(1000, 'room-closed'); } catch { /* gone */ }
        }
        // Everything the room held goes, as when an empty room forgets (section 4).
        this.room.hostId = null;
        this.room.lastSnap = null; this.room.lastSnapText = null; this.room.lastCkpt = null; this.room.lastRound = null; this.room.lastRoster = null; this.room.rosterSent = null;
        this.room.state.clear(); this.room.stateBytes = 0; this.room.seats.clear(); this.room.preferHost = null; this.room.openedAt = 0; this.room.askedMax = null;
        this.room.emptySince = now; this.room.seatsDirty = false; this.room.persistDirty = false;
        try { this.room.store?.clear?.(); } catch { /* best effort */ }
        this.room.hosted.clear();
        try { this.room.onForget?.(); } catch { /* the room is closed either way */ }
        const msg = JSON.stringify({ t: 'closed', room: this.room.code, until, message });
        for (const w of this.room.watchers) this.room.sendText(w, msg);
        this.room.tellWatchers();
        return { ok: true, op, people, until };
      }
      case 'regate': {
        // A game's launch state changed (NETPLAY.md section 15): who may play is now narrower (`allow`: ticket kinds o,
        // i, p), or anyone again (`allow` absent: a pending change is cancelled). The current round finishes first.
        if (!Array.isArray(a.allow)) { const had = Boolean(this.room.regate); this.room.regate = null; this.room.tellWatchers(); return { ok: true, op, cancelled: had }; }
        const allow = a.allow.filter((k) => ['o', 'i', 'p'].includes(k));
        const leaving = this.room.live().filter((c) => !this.room.allowedAfter(c, allow)).length;
        if (!leaving) { this.room.regate = null; this.room.tellWatchers(); return { ok: true, op, leaving: 0 }; }
        const r = this.room.lastRound;
        const playing = Boolean(r && r.phase === 'live' && Number(r.endsAt) > now);
        const until = Math.min(now + 15 * 60_000, playing ? Number(r.endsAt) + 20_000 : now + 30_000);
        this.room.regate = { allow, roundN: playing ? Number(r.n) : null, until, at: now, message: oneLine(a.message, CONTROL_LIMITS.message) || 'Thanks for playing!' };
        const notice = oneLine(a.notice, CONTROL_LIMITS.announce);
        if (notice) this.room.control('announce', { text: notice, seconds: Math.ceil((until - now) / 1000) + 5 });
        this.room.tellWatchers();
        return { ok: true, op, leaving, until, afterRound: playing ? Number(r.n) : null };
      }
      case 'seats': {
        const n = Math.floor(Number(a.max));
        if (!(n >= 1)) return { ok: false, error: 'max', message: 'seats is a number of at least 1' };
        this.room.setSeats(n);
        this.room.tellWatchers();
        return { ok: true, op, max: this.room.maxPlayers };
      }
      case 'policy': {
        // The owner changed the server (section 17): its new policy now, and AI out after the round if it is humans-only.
        const r = this.room.setPolicy(a.pol, { force: true });
        return r.ok ? { ...r, op } : { ...r, op };
      }
      case 'level': {
        // The owner sets this room's dial (room_level): it applies at once, as a vote's result does.
        const n = Math.floor(Number(a.level));
        if (!(n >= 1 && n <= 5)) return { ok: false, error: 'level', message: 'level is 1 to 5' };
        this.room.level = Math.min(this.room.policy.levelMax, n);
        this.room.levelBy = 'owner';
        this.room.seatsDirty = true;
        this.room.tellPolicy();
        this.room.tellWatchers();
        return { ok: true, op, level: this.room.level, name: skillPreset(this.room.level, { kids: this.room.policy.kids }).name };
      }
      default:
        return { ok: false, error: 'op', message: `no control called ${String(op).slice(0, 24)}` };
    }
  }
allowedAfter(c, allow) {
    // The owner's own agent passes count as the owner's (only the owner can mint one).
    return String(c.via ?? '').split('~').some((part) => (part === 'o' && allow.includes('o')) || (part.startsWith('i-') && allow.includes('i')) || (part.startsWith('p-') && allow.includes('p'))
      || (part.startsWith('a-') && allow.includes('o') && c.agent?.by === 'studio'));
  }
applyRegate(now = this.room.now()) {
    const g = this.room.regate;
    if (!g) return 0;
    this.room.regate = null;
    // The holder of the room's storage keeps the owner's state (the Table writes it on its next tick).
    this.room.officeDirty = true;
    const out = this.room.live().filter((c) => !this.room.allowedAfter(c, g.allow));
    for (const c of out) {
      const seat = c.seat;
      const token = c.token;
      this.room.error(c, 'room-closed', g.message);
      this.room.onClose(c, 'regated');
      const s = seat === null ? null : this.room.seats.get(seat);
      if (s && s.token === token) { this.room.seats.delete(seat); this.room.seatsDirty = true; }
      try { c.conn.close(1000, 'room-closed'); } catch { /* gone */ }
      this.room.tellBrowser(c, { t: 'closed', room: this.room.code, message: g.message });
    }
    this.room.persist(now);
    this.room.tellWatchers();
    return out.length;
  }
setStall(ms) {
    this.room.stallMs = stallOf(ms) ?? STALL.ms;
    return this.room.stallMs;
  }
setCurrent(ver) {
    this.room.currentVer = ver === undefined ? undefined : versionOf(ver);
  }
forgetWorld(next) {
    this.room.log({ ev: 'build-changed', room: this.room.code, from: this.room.gameVer ?? null, to: next ?? null });
    this.room.lastSnap = null; this.room.lastSnapText = null; this.room.lastCkpt = null; this.room.lastRound = null; this.room.lastRoster = null; this.room.rosterSent = null;
    this.room.state.clear(); this.room.stateBytes = 0; this.room.preferHost = null;
    this.room.persistDirty = true;
  }
setSeats(n, perIp = null) {
    this.room.seatCap = Math.max(1, Math.floor(n));
    this.room.maxPlayers = Math.max(1, Math.min(this.room.seatCap, (this.room.server || this.room.rules) ? this.room.seatCap : this.room.askedMax ?? this.room.seatCap));
    if (Number.isFinite(perIp) && perIp >= 0) this.room.perIp = perIp;
  }
officeSaved() {
    const now = this.room.now();
    return {
      bans: this.room.bans.filter((b) => b.until > now), mutes: this.room.mutes.filter((m) => m.until > now),
      announcement: this.room.liveAnnouncement(), closedUntil: this.room.closedUntil > now ? this.room.closedUntil : 0, closedWhy: this.room.closedWhy,
      regate: this.room.regate, agentsOut: this.room.agentsOut,
    };
  }
restoreOffice(o) {
    if (!o || typeof o !== 'object') return;
    const now = this.room.now();
    this.room.bans = (Array.isArray(o.bans) ? o.bans : []).filter((b) => b && b.until > now).slice(-CONTROL_LIMITS.bans);
    this.room.mutes = (Array.isArray(o.mutes) ? o.mutes : []).filter((m) => m && m.until > now).slice(-CONTROL_LIMITS.mutes);
    this.room.announcement = o.announcement && o.announcement.until > now ? o.announcement : null;
    this.room.closedUntil = Number(o.closedUntil) > now ? Number(o.closedUntil) : 0;
    this.room.closedWhy = this.room.closedUntil ? String(o.closedWhy ?? '') : '';
    // A launch change still waiting comes back; one long past is over (whoever it was for has gone).
    this.room.regate = o.regate && Array.isArray(o.regate.allow) && Number(o.regate.until) > now - 120_000 ? o.regate : null;
    this.room.agentsOut = o.agentsOut && Number(o.agentsOut.until) > now - 120_000 ? o.agentsOut : null;
  }}
