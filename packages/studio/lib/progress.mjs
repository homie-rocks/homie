/**
 * THE PROGRESS FEED — what a build is doing right now, for a person watching from anywhere (a terminal, or the
 * Homie MCP's build progress widget in the Claude app on a phone).
 *
 * One build is one small JSON document (kind "homie-studio-progress", v 1), rewritten whole at every step:
 *
 *   .studio/progress/<build>.json   the feed
 *   .studio/progress/<build>.key    the shared copy's write key (only when shared; never printed, git-ignored)
 *   .studio/progress/current        the open build's id
 *
 * The stages depend on what is being made:
 *   a game   plan → build → checks → deploy
 *   a song   plan → render → lyric check → publish
 *   a video  plan → shots → cut → publish
 *
 * `homie-studio progress start` opens a feed. While one is open, `build`, `check`, `port check` and `deploy` write
 * their stage into it, their checks as each goes green or red, and a preview (a small picture of the game and the
 * address to play it), and they stop at the next safe point when a stop was asked. The AI marks what only it
 * knows (the plan, money spent, a song's lyric check, a video's shots) with the other `progress` commands.
 * WITHOUT AN OPEN FEED NOTHING CHANGES: every command behaves exactly as before.
 *
 * SHARED (`progress start --share`): the directory named in studio.json (homie.rocks by default) keeps a copy for
 * 24 hours, so the Homie MCP tool `build_progress { build }` can show it in the Claude app, and answers every
 * write with whether the person pressed Stop there. It receives the feed and nothing else: never a key, a file
 * path, code, or more than the feed's last few log lines. Only a loopback directory may be plain http.
 *
 * The document (every text is plain, bounded; pictures are small data: URLs):
 *   { v: 1, kind, build, what: game|song|video, id, title, studio,
 *     state: running|passed|failed|stopped, stage, startedAt, updatedAt, endedAt,
 *     stages: [{ id, label, state: pending|running|done|failed|skipped|stopped, startedAt, endedAt, note }],
 *     checks: [{ id, label, stage, state: pending|running|pass|fail|skip, ms, note }],
 *     preview: { url, image, caption, at } | null,
 *     spend: { unit: usd|credits, used, budget, items: [{ what, amount, at, receipt }] },
 *     stop: { requested, at, by },
 *     song?: { peaks: [0..1], lyrics: [{ line, sung: true|false|null }] },
 *     video?: { shots: [{ id, label, state, image }] },
 *     log: [{ at, text }], error, shared?: { build, directory } }
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { readStudio } from './studio.mjs';

export const PROGRESS_KIND = 'homie-studio-progress';
export const PROGRESS_DIR = join('.studio', 'progress');
export const STAGES = Object.freeze({
  game: [['plan', 'Plan'], ['build', 'Build'], ['checks', 'Checks'], ['deploy', 'Deploy']],
  song: [['plan', 'Plan'], ['render', 'Render'], ['check', 'Lyric check'], ['publish', 'Publish']],
  video: [['plan', 'Plan'], ['shots', 'Shots'], ['cut', 'Cut'], ['publish', 'Publish']],
});
/** The same bounds the directory enforces on a shared feed. */
export const LIMITS = Object.freeze({
  title: 120, note: 200, label: 80, logLines: 12, logLine: 160, checks: 24, shots: 24, items: 50, peaks: 240, lyrics: 80,
  image: 96 * 1024, shotImage: 32 * 1024, doc: 256 * 1024,
});
const STAGE_STATES = new Set(['pending', 'running', 'done', 'failed', 'skipped', 'stopped']);
const CHECK_STATES = new Set(['pending', 'running', 'pass', 'fail', 'skip']);
const END_STATES = new Set(['passed', 'failed', 'stopped']);
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BUILD_ID = /^[a-z0-9][a-z0-9-]{5,63}$/;
const REMOTE_ID = /^hb_[a-f0-9]{32}$/;
const PUSH_GAP_MS = 1200;
const HEARTBEAT_MS = 5000;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const now = () => new Date().toISOString();
/** Plain text of at most `max` characters: no control characters, trimmed. */
export const plain = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const dir = (root) => join(root, PROGRESS_DIR);
const docPath = (root, id) => join(dir(root), `${id}.json`);
const keyPath = (root, id) => join(dir(root), `${id}.key`);
const currentPath = (root) => join(dir(root), 'current');
const loopback = (url) => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname); } catch { return false; } };

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function readFeed(root, id) {
  if (!BUILD_ID.test(String(id ?? ''))) return null;
  try { const d = JSON.parse(readFileSync(docPath(root, id), 'utf8')); return d?.kind === PROGRESS_KIND ? d : null; } catch { return null; }
}

/** The open build's id, or null. */
export function currentId(root) {
  try { const id = readFileSync(currentPath(root), 'utf8').trim(); return readFeed(root, id)?.state === 'running' ? id : null; } catch { return null; }
}

/** A picture for the feed: a data: URL as it is, or a png/jpg/webp file, at most `max` bytes. */
export function imageData(value, max = LIMITS.image) {
  const raw = String(value ?? '');
  if (!raw) return null;
  if (raw.startsWith('data:')) {
    if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) throw new Error('a picture is a data:image/png, jpeg or webp base64 URL, or a .png/.jpg/.webp file');
    if (raw.length > Math.ceil(max * 4 / 3) + 40) throw new Error(`the picture is over ${Math.round(max / 1024)} KB; use a smaller JPEG`);
    return raw;
  }
  const type = IMAGE_TYPES[extname(raw).toLowerCase()];
  if (!type) throw new Error('a picture is a .png, .jpg or .webp file');
  if (!existsSync(raw) || !statSync(raw).isFile()) throw new Error(`no picture at ${raw}`);
  if (statSync(raw).size > max) throw new Error(`${raw} is over ${Math.round(max / 1024)} KB; use a smaller JPEG (about 480 px wide)`);
  return `data:${type};base64,${readFileSync(raw).toString('base64')}`;
}

/* ------------------------------------------------------------------ the shared copy */

const pushers = new Map();

async function pushDoc(root, id) {
  const doc = readFeed(root, id);
  if (!doc?.shared?.build) return null;
  let key = null;
  try { key = readFileSync(keyPath(root, id), 'utf8').trim(); } catch { return null; }
  const { shared, ...body } = doc;
  const res = await fetch(`${shared.directory}/api/studio/progress/${shared.build}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'user-agent': 'homie-studio' },
    body: JSON.stringify({ ...body, build: shared.build }),
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404 || res.status === 410) {
    // The shared copy ended (24 hours, or the directory dropped it): keep the local feed, stop sending.
    mutateDoc(root, id, (d) => { d.shared = { ...d.shared, ended: true }; });
    return null;
  }
  const reply = await res.json().catch(() => null);
  if (reply?.stop) {
    mutateDoc(root, id, (d) => {
      if (!d.stop?.requested) { d.stop = { requested: true, at: now(), by: 'person' }; pushLog(d, 'Stop pressed in the Claude app; stopping at the next safe point.'); }
    });
  }
  return reply;
}

function schedule(root, id, { soon = false } = {}) {
  const doc = readFeed(root, id);
  if (!doc?.shared?.build || doc.shared.ended) return;
  const p = pushers.get(id) ?? { root, last: 0, timer: null, inflight: null, dirty: false, beat: null };
  pushers.set(id, p);
  p.dirty = true;
  if (p.inflight) return;
  const wait = soon ? 0 : Math.max(0, p.last + PUSH_GAP_MS - Date.now());
  if (p.timer) { if (!soon) return; clearTimeout(p.timer); }
  p.timer = setTimeout(() => { p.timer = null; send(id, p); }, wait);
  p.timer.unref?.();
}

function send(id, p) {
  p.dirty = false;
  p.last = Date.now();
  p.inflight = pushDoc(p.root, id).catch(() => null).finally(() => {
    p.inflight = null;
    if (p.dirty) schedule(p.root, id);
  });
  return p.inflight;
}

/** While a stage runs, re-send the feed every few seconds: the widget sees it is alive, and hears Stop. */
function heartbeat(root, id, on) {
  const p = pushers.get(id) ?? { root, last: 0, timer: null, inflight: null, dirty: false, beat: null };
  pushers.set(id, p);
  if (on && !p.beat) { p.beat = setInterval(() => { if (!p.inflight) send(id, p); }, HEARTBEAT_MS); p.beat.unref?.(); }
  if (!on && p.beat) { clearInterval(p.beat); p.beat = null; }
}

/** Send whatever is waiting, now (a command calls this before it exits). Never throws, never waits past `ms`. */
export async function flushProgress(ms = 6000) {
  const waits = [];
  for (const [id, p] of pushers) {
    if (p.beat) { clearInterval(p.beat); p.beat = null; }
    if (p.timer) { clearTimeout(p.timer); p.timer = null; p.dirty = true; }
    if (p.inflight) waits.push(p.inflight.then(() => (p.dirty ? send(id, p) : null)));
    else if (p.dirty) waits.push(send(id, p));
  }
  if (!waits.length) return;
  await Promise.race([Promise.allSettled(waits), new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); })]);
}

/* ------------------------------------------------------------------ the document */

function pushLog(d, text) {
  d.log = [...(d.log ?? []), { at: now(), text: plain(text, LIMITS.logLine) }].slice(-LIMITS.logLines);
}

function mutateDoc(root, id, fn) {
  const d = readFeed(root, id);
  if (!d) return null;
  fn(d);
  d.updatedAt = now();
  let text = `${JSON.stringify(d, null, 1)}\n`;
  // A feed never grows past its bound: the oldest shot pictures, then the preview picture, give way first.
  while (text.length > LIMITS.doc && d.video?.shots?.some((s) => s.image)) { d.video.shots.find((s) => s.image).image = null; text = `${JSON.stringify(d, null, 1)}\n`; }
  if (text.length > LIMITS.doc && d.preview?.image) { d.preview.image = null; text = `${JSON.stringify(d, null, 1)}\n`; }
  writeAtomic(docPath(root, id), text);
  return d;
}

/** One open build's feed. Every call re-reads the file, changes it and writes it whole, so two commands can share it. */
export class Feed {
  constructor(root, id) { this.root = root; this.id = id; }

  get doc() { return readFeed(this.root, this.id); }

  change(fn, { soon = false } = {}) {
    const d = mutateDoc(this.root, this.id, fn);
    if (d) schedule(this.root, this.id, { soon });
    return d;
  }

  /** A stage's state. Starting one ends the stage before it (done) and skips any never started. */
  stage(stage, state, note) {
    if (!STAGE_STATES.has(state)) throw new Error(`a stage is ${[...STAGE_STATES].join(', ')}`);
    const d = this.change((doc) => {
      const at = doc.stages.findIndex((s) => s.id === stage);
      if (at < 0) throw new Error(`this ${doc.what} build has no stage "${stage}" (${doc.stages.map((s) => s.id).join(', ')})`);
      const s = doc.stages[at];
      if (state === 'running') {
        for (const before of doc.stages.slice(0, at)) {
          if (before.state === 'running') { before.state = 'done'; before.endedAt = now(); }
          else if (before.state === 'pending') before.state = 'skipped';
        }
        s.startedAt = now(); s.endedAt = null;
        doc.stage = stage;
      } else if (state !== 'pending') s.endedAt = now();
      s.state = state;
      if (note !== undefined) s.note = plain(note, LIMITS.note);
      if (state === 'failed' && note) doc.error = plain(note, LIMITS.note);
      if (state === 'running' || state === 'done') doc.error = null;
      pushLog(doc, `${s.label}: ${state}${note ? ` (${plain(note, 100)})` : ''}`);
    }, { soon: true });
    heartbeat(this.root, this.id, d?.stages?.some((s) => s.state === 'running') && d.state === 'running');
    return d;
  }

  /** One check's state; a check is added the first time it is named. */
  check(id, state, { label, note, ms, stage } = {}) {
    if (!CHECK_STATES.has(state)) throw new Error(`a check is ${[...CHECK_STATES].join(', ')}`);
    return this.change((doc) => {
      const key = plain(id, 40);
      let c = doc.checks.find((x) => x.id === key);
      if (!c) {
        if (doc.checks.length >= LIMITS.checks) return;
        c = { id: key, label: plain(label ?? key, LIMITS.label), stage: stage ?? doc.stage ?? null, state: 'pending', ms: null, note: '' };
        doc.checks.push(c);
      }
      c.state = state;
      if (label) c.label = plain(label, LIMITS.label);
      if (note !== undefined) c.note = plain(note, LIMITS.note);
      if (Number.isFinite(ms)) c.ms = Math.round(ms);
    });
  }

  /** Forget the checks of one stage (a stage run again starts its checks afresh). */
  resetChecks(stage) { return this.change((doc) => { doc.checks = doc.checks.filter((c) => c.stage !== stage); }); }

  preview({ url, image, caption } = {}) {
    const picture = image ? imageData(image) : undefined;
    return this.change((doc) => {
      doc.preview = {
        url: url ? String(url).slice(0, 300) : doc.preview?.url ?? null,
        image: picture ?? doc.preview?.image ?? null,
        caption: caption !== undefined ? plain(caption, LIMITS.label) : doc.preview?.caption ?? '',
        at: now(),
      };
    }, { soon: true });
  }

  spend(amount, what, { receipt, unit } = {}) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new Error('spend is a number of dollars (or credits) of 0 or more');
    return this.change((doc) => {
      if (unit && unit !== doc.spend.unit) throw new Error(`this build counts ${doc.spend.unit}, not ${unit}`);
      doc.spend.used = Math.round((doc.spend.used + n) * 10000) / 10000;
      doc.spend.items = [...doc.spend.items, { what: plain(what ?? 'spend', LIMITS.label), amount: n, at: now(), receipt: receipt ? plain(receipt, LIMITS.label) : null }].slice(-LIMITS.items);
      pushLog(doc, `Spent ${doc.spend.unit === 'usd' ? `$${n.toFixed(2)}` : `${n} credits`} on ${plain(what ?? 'spend', 80)}`);
    }, { soon: true });
  }

  log(text) { return this.change((doc) => pushLog(doc, text)); }

  /** A video's shot (it fills in with its picture as it renders). */
  shot(id, state, { label, image } = {}) {
    if (!CHECK_STATES.has(state)) throw new Error(`a shot is ${[...CHECK_STATES].join(', ')}`);
    const picture = image ? imageData(image, LIMITS.shotImage) : undefined;
    return this.change((doc) => {
      doc.video ??= { shots: [] };
      let s = doc.video.shots.find((x) => x.id === plain(id, 40));
      if (!s) { if (doc.video.shots.length >= LIMITS.shots) return; s = { id: plain(id, 40), label: plain(label ?? id, LIMITS.label), state: 'pending', image: null }; doc.video.shots.push(s); }
      s.state = state;
      if (label) s.label = plain(label, LIMITS.label);
      if (picture !== undefined) s.image = picture;
    });
  }

  /** A song's waveform (peaks of 0..1) and lyric lines as the check hears them. */
  song({ peaks, lyric, sung } = {}) {
    return this.change((doc) => {
      doc.song ??= { peaks: [], lyrics: [] };
      if (Array.isArray(peaks)) doc.song.peaks = peaks.slice(0, LIMITS.peaks).map((p) => Math.max(0, Math.min(1, Math.round(Number(p) * 1000) / 1000 || 0)));
      if (lyric) {
        const line = plain(lyric, LIMITS.label);
        const known = doc.song.lyrics.find((l) => l.line === line);
        const value = sung === true || sung === false ? sung : null;
        if (known) known.sung = value;
        else if (doc.song.lyrics.length < LIMITS.lyrics) doc.song.lyrics.push({ line, sung: value });
      }
    });
  }

  stopRequested() { return Boolean(this.doc?.stop?.requested); }

  /**
   * Ask the shared copy now (one write, answered with the person's Stop). A stage calls this before it starts,
   * so a Stop pressed in the Claude app while nothing was running still stops the next command before it opens a
   * browser or deploys. A local feed, or a directory that does not answer, changes nothing.
   */
  async sync() {
    if (!this.doc?.shared?.build || this.doc.shared.ended) return;
    await pushDoc(this.root, this.id).catch(() => null);
  }

  /** Ask the build to stop (the terminal's own Stop; the Claude app's arrives through the shared copy). */
  stop(by = 'local') {
    return this.change((doc) => { if (!doc.stop.requested) { doc.stop = { requested: true, at: now(), by }; pushLog(doc, 'Stop asked; stopping at the next safe point.'); } }, { soon: true });
  }

  /** The build is over: passed, failed or stopped. */
  end(state, note) {
    if (!END_STATES.has(state)) throw new Error(`a build ends ${[...END_STATES].join(', ')}`);
    const d = this.change((doc) => {
      for (const s of doc.stages) {
        if (s.state === 'running') { s.state = state === 'passed' ? 'done' : state === 'stopped' ? 'stopped' : 'failed'; s.endedAt = now(); }
      }
      for (const c of doc.checks) if (c.state === 'running') c.state = state === 'passed' ? 'pass' : 'skip';
      doc.state = state;
      doc.endedAt = now();
      if (note) { if (state === 'failed') doc.error = plain(note, LIMITS.note); pushLog(doc, note); }
      pushLog(doc, state === 'passed' ? 'Done.' : state === 'stopped' ? 'Stopped.' : 'Failed.');
    }, { soon: true });
    heartbeat(this.root, this.id, false);
    try { if (readFileSync(currentPath(this.root), 'utf8').trim() === this.id) rmSync(currentPath(this.root), { force: true }); } catch { /* none */ }
    return d;
  }
}

/** The open feed, or null (then a command reports nothing and behaves exactly as before). */
export function currentFeed(root) {
  const id = root ? currentId(root) : null;
  return id ? new Feed(root, id) : null;
}

/** The feed as the Claude app's widget and `progress show` see it (never the write key). */
export function publicFeed(doc) {
  if (!doc) return null;
  const { shared, ...rest } = doc;
  return { ...rest, ...(shared ? { shared: { build: shared.build, directory: shared.directory, ...(shared.ended ? { ended: true } : {}) } } : {}) };
}

/**
 * Open a feed for one build. `share` asks the studio's directory (studio.json `homie.directory`, or `directory`)
 * to keep a copy for the Claude app's widget; if it cannot, the build goes on with the local feed only.
 */
export async function startProgress(root, { what = 'game', id, title, budget, unit, share = false, directory } = {}) {
  if (!STAGES[what]) return { ok: false, command: 'progress start', why: `what is being made: ${Object.keys(STAGES).join(', ')}` };
  if (id !== undefined && id !== null && !SLUG.test(String(id))) return { ok: false, command: 'progress start', why: 'the id is the game, song or video id (lowercase letters, digits and hyphens)' };
  const studio = readStudio(root);
  const open = currentId(root);
  if (open) return { ok: false, command: 'progress start', why: `build ${open} is still open: end it first (homie-studio progress end passed|failed|stopped)`, build: open };
  const b = budget === undefined || budget === null || budget === true ? null : Number(budget);
  if (b !== null && (!Number.isFinite(b) || b < 0)) return { ok: false, command: 'progress start', why: 'the budget is a number (dollars, or credits with --unit credits)' };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').toLowerCase();
  const build = `${stamp}-${randomBytes(3).toString('hex')}`;
  const doc = {
    v: 1, kind: PROGRESS_KIND, build, what, id: id ?? null,
    title: plain(title || `${id ?? studio.name ?? 'Studio'}`, LIMITS.title),
    studio: plain(studio.name ?? '', 60),
    state: 'running', stage: STAGES[what][0][0], startedAt: now(), updatedAt: now(), endedAt: null,
    stages: STAGES[what].map(([sid, label], i) => ({ id: sid, label, state: i === 0 ? 'running' : 'pending', startedAt: i === 0 ? now() : null, endedAt: null, note: '' })),
    checks: [], preview: null,
    spend: { unit: unit === 'credits' ? 'credits' : 'usd', used: 0, budget: b, items: [] },
    stop: { requested: false, at: null, by: null },
    log: [{ at: now(), text: `Started: ${plain(title || id || what, 100)}` }],
    error: null,
  };
  mkdirSync(dir(root), { recursive: true });
  writeAtomic(docPath(root, build), `${JSON.stringify(doc, null, 1)}\n`);
  writeAtomic(currentPath(root), `${build}\n`);
  let shared = null;
  let why = null;
  if (share) {
    const at = String(directory || studio.homie?.directory || 'https://homie.rocks').replace(/\/+$/, '');
    if (!/^https:\/\//.test(at) && !(/^http:\/\//.test(at) && loopback(at))) why = `the directory ${at} is not https`;
    else {
      try {
        const res = await fetch(`${at}/api/studio/progress`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'homie-studio' },
          body: JSON.stringify({ what, id: id ?? null, title: doc.title, studio: doc.studio }), signal: AbortSignal.timeout(10_000),
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.ok && REMOTE_ID.test(String(body.build)) && /^hbk_[a-f0-9]{48}$/.test(String(body.key))) {
          writeFileSync(keyPath(root, build), `${body.key}\n`, { mode: 0o600 });
          try { chmodSync(keyPath(root, build), 0o600); } catch { /* not on this filesystem */ }
          shared = { build: body.build, directory: at, expiresAt: body.expiresAt ?? null };
          mutateDoc(root, build, (d) => { d.shared = { build: body.build, directory: at }; });
          schedule(root, build, { soon: true });
          heartbeat(root, build, true);
        } else why = body?.message ?? `${at} answered ${res.status}`;
      } catch (error) { why = `${at} did not answer (${error?.message ?? error})`; }
    }
  }
  return {
    ok: true, command: 'progress start', build, file: join(PROGRESS_DIR, `${build}.json`), what, id: id ?? null, title: doc.title,
    stages: doc.stages.map((s) => s.id), budget: doc.spend.budget, unit: doc.spend.unit,
    shared: shared ? { build: shared.build, directory: shared.directory, expiresAt: shared.expiresAt } : null,
    ...(share && !shared ? { sharedWhy: `not shared: ${why}; the feed is local only` } : {}),
    widget: shared ? `In the Claude app: call the Homie MCP tool build_progress with { "build": "${shared.build}" }` : null,
  };
}
