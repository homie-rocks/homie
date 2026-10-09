/**
 * `homie-studio lab check <game>`: the Game Lab, headless. The same lab page a person opens (lab/page) plays the take
 * in New and Today in a headless Chrome on this computer's GPU, then plays it again from a fresh load and compares
 * every frame, and writes what it saw:
 *
 *   .studio/lab/<game>/check-<time>/
 *     summary.json   per build: each phase (frames, ms), each tracked value (peak, when, where it ends), the game's
 *                    JavaScript per frame (median, p95), errors; whether a replay landed on the same frames
 *     REPORT.md      the same, New against Today, in a few lines a person reads
 *     sheet.png      the lab at the start of each phase, New beside Today
 *     still.jpg      New beside Today at the take's busiest moment (what the Homie card shows)
 *     page.jpg       the whole lab page at that moment
 *   .studio/lab/<game>/latest.json   the last check, in a few fields (where its files are, its phases and numbers): what a
 *                    Studio pane or a card shows without running anything (.studio/lab/server.json says where the
 *                    lab itself is running)
 *
 *   homie-studio lab check <game> [--take <name>] [--today HEAD|<ref>] [--device desk|phone] [--fps 60] [--frames 6]
 *                                 [--out <dir>] [--still <file.jpg>]
 *
 * It prints paths and a few numbers, never the data. The cost numbers are the game's JavaScript per frame on this
 * computer, both builds on the same frames: a hint that a feel change costs something, never a frame-rate claim (the
 * perf skill measures that, in two browsers in a room).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { chromeArgs, findChrome, noChrome, SOFTWARE_GL } from './chrome.mjs';
import { labDir, startLabServer } from './lab.mjs';
import { isRulesGame, listGames } from './studio.mjs';

const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const pct = (xs, p) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : null; };

/** One build's take, in numbers. */
export function summarise(pane, { fps, units }) {
  if (!pane?.available) return { available: false, why: pane?.why ?? null };
  const frames = pane.frames ?? [];
  const phases = (pane.phases ?? []).map((s) => ({ name: s.name, note: s.note ?? '', from: s.from + 1, to: s.to, frames: s.to - s.from, ms: round(((s.to - s.from) * 1000) / fps, 0) }));
  const names = new Set();
  for (const r of frames) for (const k of Object.keys(r?.tr ?? {})) names.add(k);
  const tracks = {};
  for (const name of names) {
    const xs = frames.map((r) => (r?.tr && Object.hasOwn(r.tr, name) ? r.tr[name] : null));
    let peak = null; let peakAt = null; let last = null;
    xs.forEach((v, i) => { if (v === null) return; if (peak === null || Math.abs(v) > Math.abs(peak)) { peak = v; peakAt = i + 1; } last = v; });
    const vals = xs.filter((v) => v !== null);
    tracks[name] = { unit: units?.[name] ?? '', peak: round(peak), peakAt, final: round(last), mean: round(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)) };
  }
  const ms = frames.map((r) => r?.ms).filter(Number.isFinite);
  return {
    available: true,
    instrumented: Boolean(pane.meta?.instrumented || pane.meta?.views?.length || pane.meta?.overlays?.length),
    frames: frames.filter(Boolean).length,
    phases, tracks,
    // Chrome's clock in a page is coarse (0.1 ms steps): the mean over every frame is the finer number.
    cost: { mean: round(ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length), 3), median: round(pct(ms, 0.5), 3), p95: round(pct(ms, 0.95), 3), max: round(Math.max(0, ...ms), 3) },
    views: pane.meta?.views ?? [], overlays: pane.meta?.overlays ?? [],
    errors: pane.meta?.errors ?? [],
  };
}

/** A rules take must actually advance its local runtime without joining a room. */
export function rulesRun(s) {
  return Boolean(s?.hosting && !s.connected && s.tick > 0 && s.status === 'playing');
}

/** Where two runs of one build first differ (frame number), or null when every frame matches. */
export function firstDifference(a, b) {
  const n = Math.max(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i += 1) if ((a?.[i]?.sig ?? null) !== (b?.[i]?.sig ?? null)) return i + 1;
  return null;
}

/** Frames worth a picture: where each phase starts (New's, then Today's), filled in evenly, at most `n`. */
export function keyFrames(newPhases, todayPhases, total, n = 6) {
  const want = [];
  const add = (f) => { if (f >= 1 && f <= total && !want.some((x) => Math.abs(x - f) < 3)) want.push(f); };
  for (const s of newPhases ?? []) add(Math.min(s.to, s.from + 3));
  for (const s of todayPhases ?? []) add(Math.min(s.to, s.from + 3));
  for (let i = 1; want.length < n && i <= n * 2; i += 1) add(Math.round((i / (n * 2 + 1)) * total));
  return want.sort((a, b) => a - b).slice(0, n);
}

function reportOf(r) {
  const n = r.new; const t = r.today;
  const lines = [`# ${r.game}: take "${r.take ?? '(none)'}"`, '', `${r.note ?? ''}`.trim(), '',
    `- ${r.frames} frames at ${r.fps} fps (${round(r.frames / r.fps, 2)} s), ${r.device}, seed ${r.seed}, ${r.inputs} input events.`,
    `- New: the working tree${r.newBuild?.dirty ? ` (${r.newBuild.dirty} changed in games/${r.game})` : ''}. Today: ${r.todayBuild?.commit ? `${r.todayBuild.commit.short} "${r.todayBuild.commit.subject}"` : r.todayBuild?.none ?? 'none'}.`,
    `- Replays: ${r.deterministic.new === null ? 'New replayed on the same frames' : `New DIFFERED from frame ${r.deterministic.new}`}${t.available ? `; ${r.deterministic.today === null ? 'Today replayed on the same frames' : `Today DIFFERED from frame ${r.deterministic.today}`}` : ''}.`,
    ...(Object.keys(r.overrides ?? {}).length ? [`- Sliders not kept yet: ${Object.entries(r.overrides).map(([k, v]) => `${k}=${v}`).join(', ')}`] : []),
    '', '## Phases', '', '| | New | Today |', '| --- | --- | --- |'];
  const names = [...new Set([...(n.phases ?? []).map((p) => p.name), ...(t.phases ?? []).map((p) => p.name)])];
  const of = (side, name) => (side.phases ?? []).filter((p) => p.name === name).map((p) => `F${p.from}-${p.to} (${p.frames} f, ${p.ms} ms)`).join(', ') || '-';
  for (const name of names) lines.push(`| ${name} | ${of(n, name)} | ${t.available ? of(t, name) : 'n/a'} |`);
  lines.push('', '## Tracked values (peak, at frame; where it ends)', '', '| | New | Today |', '| --- | --- | --- |');
  for (const name of [...new Set([...Object.keys(n.tracks ?? {}), ...Object.keys(t.tracks ?? {})])]) {
    const cell = (side) => { const x = side.tracks?.[name]; return x ? `${x.peak}${x.unit ? ` ${x.unit}` : ''} at F${x.peakAt}; ends ${x.final}` : '-'; };
    lines.push(`| ${name} | ${cell(n)} | ${t.available ? cell(t) : 'n/a'} |`);
  }
  lines.push('', `## The game's JavaScript per frame (this computer, the same frames)`, '',
    `New mean ${n.cost?.mean} ms (median ${n.cost?.median}, p95 ${n.cost?.p95})${t.available ? `; Today mean ${t.cost?.mean} ms (median ${t.cost?.median}, p95 ${t.cost?.p95})` : ''}. Chrome times a page in steps of about 0.1 ms, so the mean over every frame is the finer number. A hint, not a frame rate: the perf skill measures that.`);
  const errors = [...(n.errors ?? []).map((e) => `New: ${e}`), ...(t.errors ?? []).map((e) => `Today: ${e}`)];
  if (errors.length) lines.push('', '## Errors', '', ...errors.map((e) => `- ${e}`));
  lines.push('', `Pictures: sheet.png (the lab at ${r.keyFrames.map((f) => `F${f}`).join(', ')}), still.jpg (F${r.stillFrame}).`, '');
  return lines.join('\n');
}

export async function labCheck(root, id, { take = null, today = 'HEAD', device = null, fps = null, out = null, still = null, frames: nKey = 6, log = () => {} } = {}) {
  const games = listGames(root);
  const game = id ?? (games.length === 1 ? games[0].id : null);
  if (!game || !games.some((g) => g.id === game)) return { ok: false, command: 'lab check', why: `name the game: homie-studio lab check <${games.map((g) => g.id).join('|') || 'id'}>` };
  const chrome = findChrome();
  if (!chrome) return { ok: false, command: 'lab check', why: noChrome() };
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; } catch { return { ok: false, command: 'lab check', why: 'puppeteer-core is not installed (it comes with @homie-rocks/studio; run npm install)' }; }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = out ?? join(labDir(root, game), `check-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const server = await startLabServer(root, { port: 0, today, watchFiles: false, log: () => {} });
  let browser;
  try { browser = await puppeteer.launch({
    executablePath: chrome, headless: true, timeout: 150_000, protocolTimeout: 240_000,
    args: [...chromeArgs(), '--mute-audio', '--window-size=1600,1000', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'],
  }); } catch (error) { await server.close(); throw error; }
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    await page.setUserAgent(`${await browser.userAgent()} homie-studio-check homie-studio-lab`);
    const pageErrors = [];
    page.on('pageerror', (e) => { if (pageErrors.length < 10) pageErrors.push(String(e?.message ?? e).slice(0, 240)); });
    const q = new URLSearchParams({ check: '1', ...(take ? { take } : {}), ...(device ? { device } : {}), ...(fps ? { fps: String(fps) } : {}), ...(today !== 'HEAD' ? { today } : {}) });
    log(`lab: ${server.url}/${game}/ (headless)`);
    await page.goto(`${server.url}/${game}/?${q}`, { waitUntil: 'load', timeout: 90_000 });
    await page.waitForFunction(() => Boolean(window.labApp), { timeout: 30_000 });
    await page.evaluate(() => window.labApp.ready);
    const renderer = await page.evaluate(() => { try { const g = document.createElement('canvas').getContext('webgl'); const i = g?.getExtension('WEBGL_debug_renderer_info'); return i ? g.getParameter(i.UNMASKED_RENDERER_WEBGL) : null; } catch { return null; } });
    const first = await page.evaluate(() => window.labApp.data());
    if (!first.take && !Object.keys(first.tunables?.spec ?? {}).length) log('lab: this game has no take yet (lab.json): the check played a still take with no presses');
    log(`lab: played ${first.frames} frames in both builds; playing them again from a fresh load`);
    const second = await page.evaluate(() => window.labApp.rerun());
    const deterministic = {
      new: first.new.available ? firstDifference(first.new.frames, second.new.frames) : null,
      today: first.today.available ? firstDifference(first.today.frames, second.today.frames) : null,
    };
    const rules = isRulesGame(games.find((g) => g.id === game)) ? await page.evaluate(() => {
      const out = {};
      for (const pane of ['new', 'today']) {
        const frame = [...document.querySelectorAll('iframe')].find((f) => f.src.includes('/' + pane + '/'));
        const n = frame?.contentWindow?.__homieNet;
        out[pane] = n ? { format: typeof n.probe?.hosted === 'function', hosting: n.rulesHosting, connected: n.connected, tick: n.probe?.tick?.(), status: n.probe?.status?.() } : null;
      }
      return out;
    }) : null;
    if (rules && (!rulesRun(rules.new) || (first.today.available && rules.today?.format && !rulesRun(rules.today)))) pageErrors.push('A rules pane did not play on its local host runtime.');
    const summary = {
      ok: !rules || pageErrors.length === 0, rules, game, take: first.take, note: first.note, fps: first.fps, frames: first.frames, device: first.device, seed: first.seed, inputs: first.inputs,
      newBuild: first.newBuild, todayBuild: first.todayBuild, overrides: first.overrides, renderer, software: SOFTWARE_GL.test(String(renderer ?? '')),
      deterministic, new: summarise(first.new, first), today: summarise(first.today, first), pageErrors,
    };
    // Pictures: the lab at the start of each phase, New beside Today.
    const keys = keyFrames(first.new.phases, first.today.phases, first.frames, Math.max(1, Math.min(12, Number(nKey) || 6)));
    const shots = [];
    // Just the panes (their names above, their phases below), not the stage's empty margin.
    const panes = () => page.evaluate(() => {
      const rs = [...document.querySelectorAll('.slot')].filter((e) => !e.hidden).map((e) => e.getBoundingClientRect());
      const x = Math.min(...rs.map((r) => r.left)); const y = Math.min(...rs.map((r) => r.top));
      return { x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: Math.max(...rs.map((r) => r.right)) - x + 12, height: Math.max(...rs.map((r) => r.bottom)) - y + 12 };
    });
    for (const f of keys) {
      await page.evaluate((x) => window.labApp.seek(x), f);
      const png = await page.screenshot({ type: 'png', clip: await panes() });
      const at = (side) => side.phases?.find((p) => f >= p.from && f <= p.to)?.name ?? '';
      shots.push({ f, png: `data:image/png;base64,${Buffer.from(png).toString('base64')}`, label: `F${f} · ${round(f / first.fps, 2)} s`, newPhase: at(summary.new), todayPhase: summary.today.available ? at(summary.today) : '' });
    }
    // The still: the take's busiest moment (the first phase of New, a few frames in), the whole lab page.
    const stillFrame = summary.new.phases?.[0] ? Math.min(summary.new.phases[0].to, summary.new.phases[0].from + 6) : Math.round(first.frames / 2);
    await page.evaluate((x) => window.labApp.seek(x), stillFrame);
    const stillPath = still ?? join(dir, 'still.jpg');
    await page.screenshot({ path: stillPath, type: 'jpeg', quality: 84, clip: await panes() });
    await page.screenshot({ path: join(dir, 'page.jpg'), type: 'jpeg', quality: 82 });
    const sheet = await browser.newPage();
    await sheet.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await sheet.setContent(sheetHtml(summary, shots), { waitUntil: 'load' });
    await sheet.screenshot({ path: join(dir, 'sheet.png'), fullPage: true });
    summary.keyFrames = keys;
    summary.stillFrame = stillFrame;
    summary.ms = Date.now() - t0;
    writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(join(dir, 'REPORT.md'), reportOf(summary));
    const rel = (p) => relative(root, p) || p;
    const latest = {
      v: 1, at: new Date().toISOString(), game, take: summary.take, frames: summary.frames, fps: summary.fps, device: summary.device,
      out: rel(dir), report: rel(join(dir, 'REPORT.md')), sheet: rel(join(dir, 'sheet.png')), still: rel(stillPath), page: rel(join(dir, 'page.jpg')),
      today: summary.todayBuild?.commit?.short ?? null, deterministic,
      timeline: { new: (summary.new.phases ?? []).map(({ name, from, to }) => ({ name, from, to })), today: summary.today.available ? summary.today.phases.map(({ name, from, to }) => ({ name, from, to })) : null },
      cost: { new: summary.new.cost ?? null, today: summary.today.available ? summary.today.cost : null },
    };
    if (!out) writeFileSync(join(labDir(root, game), 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
    return {
      ok: summary.ok, rules: summary.rules, command: 'lab check', game, take: summary.take, out: rel(dir), report: rel(join(dir, 'REPORT.md')), sheet: rel(join(dir, 'sheet.png')), still: rel(stillPath),
      frames: summary.frames, fps: summary.fps, deterministic, renderer, software: summary.software,
      phases: { new: summary.new.phases?.map((p) => `${p.name} ${p.frames}f`) ?? [], today: summary.today.available ? summary.today.phases.map((p) => `${p.name} ${p.frames}f`) : null },
      timeline: { new: (summary.new.phases ?? []).map(({ name, from, to }) => ({ name, from, to })), today: summary.today.available ? summary.today.phases.map(({ name, from, to }) => ({ name, from, to })) : null },
      page: rel(join(dir, 'page.jpg')),
      cost: { new: summary.new.cost ?? null, today: summary.today.available ? summary.today.cost : null },
      errors: [...(summary.new.errors ?? []), ...(summary.today.errors ?? []), ...pageErrors].slice(0, 6),
      today: summary.todayBuild?.commit?.short ?? null, todayNote: summary.todayBuild?.none ?? summary.todayBuild?.error ?? null,
    };
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

function sheetHtml(summary, shots) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cells = shots.map((s) => `<figure><img src="${s.png}" alt=""><figcaption><b>${esc(s.label)}</b><span class="n">${esc(s.newPhase || '·')}</span><span class="t">${esc(s.todayPhase || '·')}</span></figcaption></figure>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #080b12; color: #e7eaf3; font: 600 13px/1.3 ui-monospace, Menlo, monospace; }
    h1 { margin: 0 0 4px; font-size: 16px; letter-spacing: .2em; } p { margin: 0 0 18px; color: #8d96b0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    figure { margin: 0; } img { width: 100%; display: block; border: 1px solid #232c42; }
    figcaption { display: flex; gap: 12px; margin-top: 6px; } .n { color: #ffad3b; } .t { color: #7cc4ff; }
  </style></head><body><h1>GAME LAB · ${esc(summary.game)} · ${esc(summary.take ?? 'no take')}</h1>
  <p>New (amber) beside Today (blue)${summary.todayBuild?.commit ? `, Today ${esc(summary.todayBuild.commit.short)}` : ''} · ${summary.frames} frames at ${summary.fps} fps · seed ${summary.seed}</p>
  <div class="grid">${cells}</div></body></html>`;
}

