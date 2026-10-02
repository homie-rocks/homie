/**
 * AN AI IN A SEAT, FROM THIS COMPUTER (@homie-rocks/studio 0.17.0, NETPLAY.md section 18): the local MCP's agent_sit,
 * agent_look, agent_do and agent_stand, and `homie-studio agents sit`. The person's own AI (Claude in the desktop app,
 * Claude Code, any MCP client) takes a guide's seat with hands `host`: the host's game moves the body every frame at the
 * party's dial, while this holds the socket between the AI's turns (about 30 s a decision), keeps the latest view the
 * host showed it and the asks made of it, and sends its goals and lines: only the game's own vocabulary (agents.json),
 * which the relay checks again. It always plays as "<label> · AI".
 *
 * The pass: one the owner gave (`hap_…`), or, from a studio folder, a one-day guide pass minted with the owner's office
 * key and revoked when the AI stands. The secret stays in this process; it is never printed or returned.
 */
import { parseDecision, renderLine, vocabularyOf } from '../worker/brain.mjs';
import { withKey } from './office.mjs';

const GAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SERVER = /^[a-z0-9][a-z0-9-]{1,19}$/;
const PASS = /^hap_[a-f0-9]{10}_[A-Za-z0-9_-]{40}$/;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class AgentSeat {
  /**
   * @param {object} o
   * @param {string} o.site     the studio's site (https://…, or http://127.0.0.1:8787 for `homie-studio dev`)
   * @param {string} o.game
   * @param {string} [o.server] a server id (else the pass's, else public)
   * @param {string} [o.pass]   an agent pass (hap_…); else one is minted from `root` with the office key
   * @param {string} [o.root]   the studio folder (for a pass of its own)
   */
  constructor({ site, game, server = null, pass = null, label = 'Claude', root = null, WebSocketImpl = globalThis.WebSocket, fetchImpl = globalThis.fetch }) {
    this.site = String(site ?? '').replace(/\/+$/, '');
    this.game = game;
    this.server = server;
    this.pass = pass;
    this.label = label;
    this.root = root;
    this.WS = WebSocketImpl;
    this.fetch = fetchImpl;
    this.minted = null;
    this.ws = null;
    this.seat = null;
    this.name = null;
    this.room = null;
    this.policy = null;
    this.view = null;
    this.viewAt = 0;
    this.asks = [];
    this.party = [];
    this.lastDo = null;
    this.doAt = 0;
    this.sayAt = 0;
    this.closed = null;
    this.errors = [];
    this.vocab = null;
    this.ping = null;
  }

  async sit() {
    if (!GAME.test(String(this.game ?? ''))) return { ok: false, why: 'game is the game\'s id' };
    if (this.server !== null && !SERVER.test(String(this.server)) && this.server !== 'public') return { ok: false, why: 'server is a server id' };
    if (!this.site) return { ok: false, why: 'no site: run the studio here (preview_run / homie-studio dev) or deploy it, or give url' };
    if (!this.WS) return { ok: false, why: 'this Node has no WebSocket (Node 22 or newer)' };
    // The vocabulary: what this AI may choose and say, from the built game.
    try {
      const res = await this.fetch(`${this.site}/games/${this.game}/agents.json`, { signal: AbortSignal.timeout(10_000) });
      if (res.ok) this.vocab = vocabularyOf(await res.json()).vocab;
    } catch { this.vocab = null; }
    if (!this.vocab) return { ok: false, why: `${this.game} has no agents.json (the guides' vocabulary): an AI with no game client has nothing to choose from` };
    if (!this.pass) {
      if (!this.root) return { ok: false, why: 'give pass (an agent pass, hap_…), or run this from the studio folder' };
      const r = await withKey(this.root, this.site, (call) => call('/_studio/api/agents/pass', { action: 'create', game: this.game, label: this.label, role: 'guide', hands: 'host', days: 1, server: this.server && this.server !== 'public' ? this.server : null }));
      if (!r.ok || !PASS.test(String(r.secret ?? ''))) return { ok: false, why: `could not make a pass: ${r.message ?? r.why ?? 'the office did not answer'}` };
      this.pass = r.secret;
      this.minted = r.pass?.id ?? null;
    }
    let sat;
    try {
      const res = await this.fetch(`${this.site}/${this.game}/api/agent`, {
        method: 'POST', headers: { authorization: `Bearer ${this.pass}`, 'content-type': 'application/json', 'user-agent': 'homie-studio-agent' },
        body: JSON.stringify(this.server ? { server: this.server } : {}), signal: AbortSignal.timeout(15_000),
      });
      sat = await res.json().catch(() => ({ ok: false, message: `the site answered ${res.status}` }));
    } catch (error) { sat = { ok: false, message: error.message }; }
    if (!sat.ok) { await this.revoke(); return { ok: false, why: sat.message ?? sat.error ?? 'the seat was refused', error: sat.error ?? null }; }
    if (sat.hands !== 'host') { await this.revoke(); return { ok: false, why: 'this pass is for an AI that runs the game itself (hands self); agent_sit needs hands host' }; }
    this.room = sat.room;
    this.server = sat.server;
    const ws = new this.WS(sat.ws);
    this.ws = ws;
    const welcome = await new Promise((done) => {
      const timer = setTimeout(() => done({ t: 'timeout' }), 12_000);
      ws.onopen = () => ws.send(JSON.stringify({ ...sat.hello, device: 'desk' }));
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.t === 'welcome' || (m.t === 'error' && !this.seat)) { clearTimeout(timer); done(m); }
        this.onFrame(m);
      };
      ws.onclose = (e) => { this.closed = this.closed ?? (e?.reason || 'closed'); clearTimeout(timer); done({ t: 'closed' }); };
      ws.onerror = () => {};
    });
    if (welcome.t !== 'welcome') { this.close(); await this.revoke(); return { ok: false, why: welcome.message ?? `no seat (${welcome.code ?? welcome.t})`, error: welcome.code ?? welcome.t }; }
    this.ping = setInterval(() => { try { ws.send(JSON.stringify({ t: 'ping', c: Date.now() })); } catch { /* closed */ } }, 2000);
    // The host shows a guide the game every 2 s: wait for the first look (up to 6 s).
    for (let i = 0; i < 30 && !this.view && !this.closed; i += 1) await wait(200);
    return { ok: true, seat: this.seat, name: this.name, room: this.room, server: this.server, ...this.look() };
  }

  onFrame(m) {
    switch (m.t) {
      case 'welcome': this.seat = m.seat; this.name = m.name; this.policy = m.policy ?? null; return;
      case 'policy': this.policy = m.policy ?? this.policy; return;
      case 'error': this.errors = [...this.errors, { code: m.code, message: m.message, at: Date.now() }].slice(-6); if (['agents-alone', 'agents-off', 'kicked', 'room-closed', 'agent-yield'].includes(m.code)) this.closed = m.code; return;
      case 'ev': {
        const k = String(m.k ?? '');
        const d = m.d && typeof m.d === 'object' ? m.d : {};
        if (k === 'agent:view') { this.view = d; this.viewAt = Date.now(); return; }
        const ask = /^ask:([a-z][a-z0-9_]{0,31})$/.exec(k)?.[1];
        if (ask && d.seat === this.seat) { this.asks = [...this.asks, { k: ask, args: d.args ?? {}, from: m.from, at: Date.now() }].slice(-6); return; }
        const line = /^say:([a-z][a-z0-9_]{0,31})$/.exec(k)?.[1];
        if (line && m.from !== this.seat) this.party = [...this.party, { seat: m.from, line, args: d.args ?? {}, at: Date.now() }].slice(-6);
        return;
      }
      default: return;
    }
  }

  /** What the AI needs to decide: the view, the asks made of it, the party's lines, its choices (ids only). */
  look() {
    const now = Date.now();
    const v = this.vocab;
    const describe = (entries) => Object.fromEntries(Object.entries(entries ?? {}).map(([id, e]) => [id, { ...(e.about ? { about: e.about } : { text: e.text }), args: Object.fromEntries(Object.entries(e.args ?? {}).map(([k, s]) => [k, s.kind === 'player' ? 'player (a seat number)' : s.kind === 'list' ? s.values : `view.${s.key}`])) }]));
    return {
      seat: this.seat, name: this.name, room: this.room, closed: this.closed,
      talking: Boolean(this.policy && ['workers-ai', 'owner-key'].includes(this.policy.brain) && this.policy.speech !== 'off'),
      view: this.view, viewAgeMs: this.viewAt ? now - this.viewAt : null,
      asks: this.asks.filter((a) => now - a.at < 60_000).map((a) => ({ ask: a.k, args: a.args, seat: a.from, text: v ? renderLine(v, a.k, a.args, { kind: 'asks', nameOf: (s) => `seat ${s}` }) : null, secondsAgo: Math.round((now - a.at) / 1000) })),
      party: this.party.filter((p) => now - p.at < 60_000).map((p) => ({ seat: p.seat, line: p.line, args: p.args })),
      lastDo: this.lastDo,
      choices: v ? { goals: describe(v.goals), lines: describe(v.lines) } : null,
      errors: this.errors.slice(-3),
    };
  }

  /** One decision: a goal (and at most one line) of the vocabulary, checked here first and again by the relay. */
  async do({ goal, args = {}, say = null, sayArgs = {} } = {}) {
    if (!this.ws || this.closed) return { ok: false, why: this.closed ? `the seat closed (${this.closed}); agent_sit again` : 'not seated: agent_sit first' };
    const p = parseDecision({ goal, args, say: say || null, sayArgs: say ? sayArgs : {} }, this.vocab, { view: this.view });
    if (!p.ok) return { ok: false, why: `${p.why}. Choose a goal and line from look().choices, with values the view offers.` };
    const now = Date.now();
    if (now - this.doAt < 3000) await wait(3000 - (now - this.doAt));
    if (!this.talking() && p.decision.say) return { ok: false, why: 'this server\'s AI may not talk (its owner has not turned AI talk on); choose a goal with say null' };
    if (p.decision.say && Date.now() - this.sayAt < 8000) return { ok: false, why: 'a guide says at most one line every 8 seconds; send the goal alone, or wait' };
    this.ws.send(JSON.stringify({ t: 'ev', k: 'agent:do', d: { goal: p.decision.goal, args: p.decision.args } }));
    this.doAt = Date.now();
    if (p.decision.say) { this.ws.send(JSON.stringify({ t: 'ev', k: `say:${p.decision.say}`, d: { args: p.decision.sayArgs } })); this.sayAt = Date.now(); }
    this.lastDo = { goal: p.decision.goal, args: p.decision.args, say: p.decision.say, at: new Date().toISOString() };
    this.asks = [];
    await wait(300);
    const refused = this.errors.find((e) => e.at >= this.doAt - 50);
    return refused ? { ok: false, why: `the room said ${refused.code}: ${refused.message}` } : { ok: true, sent: this.lastDo, text: p.decision.say ? renderLine(this.vocab, p.decision.say, p.decision.sayArgs, { me: this.name, nameOf: (s) => `seat ${s}`, view: this.view }) : null };
  }

  talking() { return Boolean(this.policy && ['workers-ai', 'owner-key'].includes(this.policy.brain) && this.policy.speech !== 'off'); }

  close() {
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    if (this.ws) { try { this.ws.send(JSON.stringify({ t: 'bye' })); } catch { /* closed */ } try { this.ws.close(1000, 'bye'); } catch { /* closed */ } }
    this.ws = null;
    this.closed = this.closed ?? 'stood';
  }

  /** A pass this seat minted ends with it. */
  async revoke() {
    if (!this.minted || !this.root) return;
    const id = this.minted;
    this.minted = null;
    await withKey(this.root, this.site, (call) => call('/_studio/api/agents/pass', { action: 'revoke', id })).catch(() => {});
  }

  async stand() {
    this.close();
    await this.revoke();
    return { ok: true, stood: true, room: this.room };
  }
}
