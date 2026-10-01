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
 * WHERE A PERSON SEES IT: the Claude app's build card (shared feeds), the Build status tab of the game's codex page
 * (lib/codex.mjs: it redraws itself at every change), and Claude Code's status line (lib/statusline.mjs), all read
 * through lib/feed-summary.mjs so they agree.
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
 *     change?: { url, number, title, repo, branch, state: open|merged|closed, files, additions, deletions, preview, mark, at },
 *     site?: the studio's live address (for the Claude app's card to tell when a merged change is live),
 *     log: [{ at, text }], error, shared?: { build, directory } }
 *
 * A BUILD OPENED IN THE CHAT (`build_open`, the Claude app's "Build it" card): the chat gets the build id first
 * and shows its card; the Claude Code session that does the work attaches to it ONCE with
 * `progress attach <hb_…>`, and the directory hands the write key to that first attach only. No key ever travels
 * in a prompt; a second attach is refused.
 *
 * A CHANGE THAT GOES OUT AS A PULL REQUEST: `progress change "<what it does>"` writes changes/<date>-<mark>.json
 * (committed with the change; the site lists the newest marks in its manifest), and `progress pr --url <pr>` puts
 * the pull request on the card, whose Publish button opens it in GitHub for the person's one-tap merge. When the
 * live site lists the change's mark, Workers Builds has deployed it: the card says Live by itself.
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { refreshCodexFile } from './codex.mjs';
import { readStudio, siteUrl } from './studio.mjs';

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

/*
 * A CLAUDE CODE CLOUD SESSION WHOSE NETWORK BLOCKS THE DIRECTORY. The default "Trusted" network reached homie.rocks
 * in a real cloud session (2026-10-01); a stricter one makes the session's proxy answer 403 with
 * `x-deny-reason: host_not_allowed`. Then, and only then, say which setting lets the card follow the build,
 * instead of "did not answer"; the build itself goes on with its local feed.
 */
export function networkWhy(res, at) {
  if (res?.status === 403 && /host_not_allowed/i.test(res.headers?.get?.('x-deny-reason') ?? '')) {
    let host = at;
    try { host = new URL(at).host; } catch { /* as given */ }
    return `this Claude Code cloud environment's network does not reach ${host}. In claude.ai/code, open the environment's settings, set Network access to Custom, add ${host} (keep "Also include default list of common package managers"), and start a new session; until then the build goes on with its local feed only`;
  }
  return null;
}

/** The studio's live address for the card: an https origin (or this computer's own dev site), else null. */
export function liveSite(url) {
  try { const u = new URL(String(url ?? '')); return u.protocol === 'https:' || (u.protocol === 'http:' && loopback(u.href)) ? u.origin : null; } catch { return null; }
}

/** A change's mark: what the site lists once the change is live. It names the build without being able to read it. */
export const changeMark = (build) => createHash('sha256').update(`homie-change\n${build}`).digest('hex').slice(0, 16);

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
  const blocked = networkWhy(res, shared.directory);
  if (blocked) {
    mutateDoc(root, id, (d) => { d.shared = { ...d.shared, ended: true }; pushLog(d, `The Claude app cannot follow this build: ${blocked}`); });
    return null;
  }
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
    // The game's codex page on this computer (.studio/codex/<id>.html), when there is one, shows the change too.
    if (d?.what === 'game' && d.id) refreshCodexFile(this.root, d.id);
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

  /** The pull request this build's change went out as: the card's Publish button opens it for the person's merge. */
  pr({ url, number, title, repo, branch, state = 'open', files, additions, deletions, preview, site } = {}) {
    let u;
    try { u = new URL(String(url ?? '')); } catch { throw new Error('--url is the pull request\'s https://github.com/<owner>/<repo>/pull/<n> address'); }
    const m = /^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,7})\/?$/.exec(u.pathname);
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || !m) throw new Error('--url is the pull request\'s https://github.com/<owner>/<repo>/pull/<n> address');
    if (!['open', 'merged', 'closed'].includes(state)) throw new Error('a pull request is open, merged or closed');
    const count = (n) => (n === undefined || n === null || n === true ? null : Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.round(Number(n)) : null);
    return this.change((doc) => {
      const before = doc.change ?? {};
      doc.change = {
        url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`, number: Number(m[3]), repo: `${m[1]}/${m[2]}`,
        title: plain(title ?? before.title ?? doc.title, LIMITS.title), branch: branch ? plain(branch, 100) : before.branch ?? null, state,
        files: count(files) ?? before.files ?? null, additions: count(additions) ?? before.additions ?? null, deletions: count(deletions) ?? before.deletions ?? null,
        preview: preview ? String(preview).slice(0, 300) : before.preview ?? null, mark: before.mark ?? null, at: now(),
      };
      // The live address may have been learned after the build was opened (`setup attach`): the card reads it.
      if (liveSite(site)) doc.site = liveSite(site);
      const deploy = doc.stages.find((s) => s.id === 'deploy' || s.id === 'publish');
      if (deploy && state === 'open' && deploy.state === 'pending') { deploy.state = 'running'; deploy.startedAt = now(); deploy.note = 'Waiting for the merge: Publish on the card opens the pull request'; doc.stage = deploy.id; }
      pushLog(doc, `Pull request #${m[3]} ${state}`);
    }, { soon: true });
  }

  /** The studio's live address, so the card can read the site's own manifest for the change once it is merged. */
  site(url) { return this.change((doc) => { doc.site = url ? String(url).slice(0, 200) : null; }); }

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
export async function startProgress(root, { what = 'game', id, title, budget, unit, share = false, directory, attach = null } = {}) {
  if (attach !== null && !REMOTE_ID.test(String(attach))) return { ok: false, command: 'progress attach', why: 'attach to the build id the Claude app showed: hb_ and 32 hex digits' };
  if (attach) share = true;
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
  let live = null;
  try { live = siteUrl(root, studio); } catch { live = null; }
  if (liveSite(live)) doc.site = liveSite(live);
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
        // A build the chat opened is attached (once); otherwise a new one is opened here.
        const res = await fetch(attach ? `${at}/api/studio/progress/${attach}/attach` : `${at}/api/studio/progress`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'homie-studio' },
          body: JSON.stringify({ what, id: id ?? null, title: doc.title, studio: doc.studio }), signal: AbortSignal.timeout(10_000),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok && networkWhy(res, at)) why = networkWhy(res, at);
        else if (res.ok && body?.ok && REMOTE_ID.test(String(body.build)) && /^hbk_[a-f0-9]{48}$/.test(String(body.key))) {
          // The chat named the build: its title is the one the person saw.
          if (attach && body.title && !title) mutateDoc(root, build, (d) => { d.title = plain(body.title, LIMITS.title); });
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
  if (attach && !shared) {
    // Attaching is the point of `progress attach`: without it, say why and leave no open feed behind.
    rmSync(docPath(root, build), { force: true });
    rmSync(currentPath(root), { force: true });
    return { ok: false, command: 'progress attach', build: attach, why: `could not attach to ${attach}: ${why}` };
  }
  return {
    ok: true, command: attach ? 'progress attach' : 'progress start', build, file: join(PROGRESS_DIR, `${build}.json`), what, id: id ?? null, title: readFeed(root, build)?.title ?? doc.title,
    stages: doc.stages.map((s) => s.id), budget: doc.spend.budget, unit: doc.spend.unit,
    shared: shared ? { build: shared.build, directory: shared.directory, expiresAt: shared.expiresAt } : null,
    ...(share && !shared ? { sharedWhy: `not shared: ${why}; the feed is local only` } : {}),
    widget: shared ? `In the Claude app: call the Homie MCP tool build_progress with { "build": "${shared.build}" }` : null,
  };
}

/**
 * `progress change "<what it does>"`: the change's mark, as a small file the change commits (changes/<date>-<mark>.json).
 * `homie-studio build` lists the newest marks in the site's manifest; when the live site lists this one, the change
 * is deployed, and the Claude app's card says so. Returns the file, relative to the studio.
 */
export function recordChange(root, id, title) {
  const doc = readFeed(root, id);
  if (!doc) throw new Error('no build is open: start or attach one first');
  const mark = changeMark(doc.shared?.build ?? doc.build);
  const folder = join(root, 'changes');
  mkdirSync(folder, { recursive: true });
  if (!existsSync(join(folder, 'README.md'))) writeFileSync(join(folder, 'README.md'), CHANGES_README);
  const rel = join('changes', `${now().slice(0, 10)}-${mark.slice(0, 8)}.json`);
  const text = `${JSON.stringify({ v: 1, change: mark, title: plain(title || doc.title, LIMITS.title), at: now() }, null, 2)}\n`;
  writeFileSync(join(root, rel), text);
  mutateDoc(root, id, (d) => { d.change = { ...(d.change ?? {}), mark }; pushLog(d, `Change recorded: ${plain(title || doc.title, 100)}`); });
  schedule(root, id, { soon: true });
  return { file: rel, mark };
}

export const CHANGES_README = `# changes/

One small file per change this studio made through a pull request, written by \`homie-studio progress change\`:
what it does, when, and its mark. \`npm run build\` lists the newest marks in the site's
\`/.well-known/homie-studio.json\`, so the Claude app's card can tell when a merged change is live. Nothing in
here is secret; old files may be deleted.
`;
