/**
 * THE STYLE BOARD AND THE LINEUP: pictures the engine draws for free (lib/render3d.mjs).
 *
 *   styleBoard(root, id)      three coherent directions (lib/decisions.mjs directionsFor), each drawn as the game would
 *                             draw it: its palette, light, camera, material model, fonts and proportions, with the
 *                             starter library family's own pieces re-tinted into its palette. Saved as
 *                             games/<id>/codex/board/<a|b|c>-swatch.jpg (private, under 300 KB each), the board in
 *                             decisions.json. A painted mood image per direction is optional and paid: the art skill
 *                             makes it on the creator's own fal account and `style mood` records it, labelled a target.
 *   assetsLineup(root, id)    every made asset at true scale on a 1 m grid under the game's light (front and
 *                             three-quarter), silhouettes black on white at 64 px tall, and flags: over budget, palette
 *                             drift (CIEDE2000 from the locked palette), an unreadable silhouette, another library family,
 *                             stale. .studio/art/<id>/lineup-*.jpg and lineup.json.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { readManifest } from './asset-manifest.mjs';
import { assetsCheck } from './asset-check.mjs';
import { mix, nearest } from './colour.mjs';
import { directionsFor, initDecisions, labelOf, lightColours, readDecisions, staleAssets, styleTokens, writeDecisions, addLatestLine } from './decisions.mjs';
import { PALETTE_KEYS } from './style-presets.mjs';
import { loadIndex, searchLibrary, fetchItemFile, libraryBase } from './library.mjs';
import { modelIn, saveDataUrl, withRenderer, dataUrlBytes } from './render3d.mjs';

const BOARD_DIR = join('codex', 'board');
const PICTURE_MAX = 300 * 1024;

/** A direction's (or a game's) style values as the render page's tokens. */
export function tokensOf(values) {
  const ui = values['style.ui'] ?? {};
  return {
    palette: values['style.palette'], light: values['style.light'], camera: values['style.camera'], render: values['style.render'],
    materials: values['style.materials'], fonts: { display: ui.display, body: ui.body }, shape: values['style.shape'], proportions: values['style.proportions'],
  };
}

/** Up to `n` library pieces of a family that suit the game's words, as model inputs (empty when no library is reachable). */
async function libraryPieces(family, query, n, log) {
  try {
    const { index, lib } = await loadIndex({ lib: libraryBase() });
    const picks = [];
    const seen = new Set();
    for (const q of [query, 'tree', 'rock', 'bush plant', 'crate barrel']) {
      for (const hit of searchLibrary(index, q, { family, limit: 6 })) {
        if (picks.length >= n) break;
        const it = hit.item;
        if (seen.has(it.id) || it.kind === 'texture' || it.kind === 'sky' || it.rigged) continue;
        seen.add(it.id);
        try { const { bytes } = await fetchItemFile(lib, it); picks.push(modelIn(it.id, bytes, { label: it.name })); } catch (error) { log(`library ${it.id}: ${error.message}`); }
      }
    }
    return picks;
  } catch (error) { log(`no library pieces: ${error.message}`); return []; }
}

/** Save a data: URL picture under `max` bytes (re-encoding JPEG quality down if it is over). */
async function savePicture(url, file, max = PICTURE_MAX) {
  let bytes = saveDataUrl(url, file);
  if (bytes <= max) return bytes;
  try {
    const sharp = (await import('sharp')).default;
    for (const q of [78, 68, 58]) {
      const out = await sharp(dataUrlBytes(url).bytes).jpeg({ quality: q, mozjpeg: true }).toBuffer();
      writeFileSync(file, out);
      bytes = out.byteLength;
      if (bytes <= max) break;
    }
  } catch { /* kept as it is */ }
  return bytes;
}

export async function styleBoard(root, id, { prompt = '', log = () => {}, library = true } = {}) {
  let doc = readDecisions(root, id);
  if (!doc) { initDecisions(root, id, { prompt, path: 'hands-on' }); doc = readDecisions(root, id); }
  const { directions } = directionsFor(root, id, { prompt: prompt || doc.prompt });
  let game = {};
  try { game = JSON.parse(readFileSync(join(root, 'games', id, 'game.json'), 'utf8')); } catch { game = {}; }
  const title = game.name ?? id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const words = [prompt, doc.prompt, (doc.decisions['cast.list']?.value ?? []).map((c) => c.id).join(' ')].join(' ');
  const dir = join(root, 'games', id, BOARD_DIR);
  mkdirSync(dir, { recursive: true });
  const pieces = {};
  if (library) for (const d of directions) if (!pieces[d.family]) pieces[d.family] = await libraryPieces(d.family, words, 4, log);
  const out = [];
  const renderer = await withRenderer(async (r) => {
    for (const d of directions) {
      const url = await r.swatch(tokensOf(d.values), pieces[d.family] ?? [], { title });
      const file = join(dir, `${d.id}-swatch.jpg`);
      const bytes = await savePicture(url, file);
      out.push({ ...d, swatch: relative(join(root, 'games', id), file), bytes, library: (pieces[d.family] ?? []).map((m) => m.id) });
    }
    return r.renderer;
  }, { log });
  const prev = doc.board?.directions ?? [];
  doc = readDecisions(root, id);
  // A pick survives a redraw only while its letter still names the same direction.
  const was = prev.find((p) => p.id === doc.board?.chosen);
  const still = was && out.some((d) => d.id === was.id && d.label === was.label);
  doc.board = {
    at: new Date().toISOString(), renderer, chosen: still ? was.id : null,
    directions: out.map((d) => ({ id: d.id, label: d.label, family: d.family, values: d.values, swatch: d.swatch.split('\\').join('/'), library: d.library, mood: prev.find((p) => p.id === d.id && p.label === d.label)?.mood ?? null })),
  };
  writeDecisions(root, id, doc);
  return { ok: true, command: 'style board', id, title, renderer, directions: boardView(root, id, doc) };
}

/** The board as cards and the CLI show it: per direction its rows (decision, label), swatch path and mood. */
export function boardView(root, id, doc = readDecisions(root, id)) {
  return (doc?.board?.directions ?? []).map((d) => ({
    id: d.id, label: d.label, family: d.family, swatch: d.swatch, mood: d.mood,
    chosen: doc.board.chosen === d.id,
    colours: PALETTE_KEYS.map((k) => d.values['style.palette']?.[k]).filter(Boolean),
    fonts: { display: d.values['style.ui']?.display, body: d.values['style.ui']?.body },
    rows: Object.entries(d.values).map(([k, v]) => ({ decision: k, label: labelOf(k, v), same: JSON.stringify(doc.decisions[k]?.value) === JSON.stringify(v), state: doc.decisions[k]?.state ?? null })),
  }));
}

/** `style mood <id> <dir> --image <file>`: a painted mood image for one direction (made and paid for by the art skill). */
export async function recordMood(root, id, dirId, image, { usd = null, receipt = null, model = null } = {}) {
  const doc = readDecisions(root, id);
  const d = doc?.board?.directions?.find((x) => x.id === dirId);
  if (!d) throw new Error(`no direction "${dirId}" on the style board (style board ${id} draws it first)`);
  if (!existsSync(image)) throw new Error(`no picture at ${image}`);
  const file = join(root, 'games', id, BOARD_DIR, `${dirId}-mood.jpg`);
  const sharp = (await import('sharp')).default;
  let q = 82;
  let out = await sharp(readFileSync(image)).resize(960, 540, { fit: 'cover' }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
  while (out.byteLength > PICTURE_MAX && q > 50) { q -= 10; out = await sharp(readFileSync(image)).resize(960, 540, { fit: 'cover' }).jpeg({ quality: q, mozjpeg: true }).toBuffer(); }
  writeFileSync(file, out);
  d.mood = { path: relative(join(root, 'games', id), file).split('\\').join('/'), usd: usd === null ? null : Number(usd), receipt, model, label: 'target (painted, not what the game draws)', at: new Date().toISOString() };
  writeDecisions(root, id, doc);
  return { ok: true, command: 'style mood', id, direction: dirId, mood: d.mood };
}

/** `style golden <id> add <image>`: one of two to six golden images (references for every concept call). */
export async function addGolden(root, id, image, { from = null } = {}) {
  const doc = readDecisions(root, id);
  if (!doc) throw new Error(`games/${id} has no decisions yet`);
  if (!existsSync(image)) throw new Error(`no picture at ${image}`);
  doc.golden = doc.golden ?? [];
  if (doc.golden.length >= 6) throw new Error('six golden images already: remove one first (style golden <id> remove <n>)');
  const n = doc.golden.reduce((m, g) => Math.max(m, Number(/(\d+)\.jpg$/.exec(g.path)?.[1] ?? 0)), 0) + 1;
  const dir = join(root, 'games', id, BOARD_DIR, 'golden');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${n}.jpg`);
  try {
    const sharp = (await import('sharp')).default;
    writeFileSync(file, await sharp(readFileSync(image)).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer());
  } catch { if (/\.jpe?g$/i.test(extname(image))) copyFileSync(image, file); else throw new Error('sharp could not read that picture'); }
  doc.golden.push({ path: relative(join(root, 'games', id), file).split('\\').join('/'), from: from ?? relative(root, image), approvedBy: 'person', at: new Date().toISOString() });
  writeDecisions(root, id, doc);
  addLatestLine(root, id, `Added golden image ${n} (from ${from ?? relative(root, image)}): every concept is made with it as a reference.`);
  return { ok: true, command: 'style golden', id, golden: doc.golden };
}

/* ------------------------------------------------------------------ the lineup */

const DRIFT = 18; // mean CIEDE2000 (area-weighted) from the palette above which an asset is flagged

export async function assetsLineup(root, id, { log = () => {} } = {}) {
  const manifest = readManifest(root, id);
  const doc = readDecisions(root, id);
  const tokens = styleTokens(doc) ?? { palette: { bg: '#20242c', ink: '#f2f2f2', accent: '#ffcf5a', accent2: '#7dffb0', danger: '#ff5d5d', good: '#5fdc8b', gold: '#f2c14e', ramp: [] } };
  const models = [];
  for (const a of manifest.assets) {
    const f = (a.files ?? []).find((x) => x.role === 'model');
    if (!f) continue;
    const abs = join(root, 'games', id, f.path);
    if (!existsSync(abs)) continue;
    // `inGame`: what the game's code does to it at runtime (drawn at another height, repainted from style.json): the
    // lineup draws it the same way (the repaint as the board's re-tint, the nearest the game's own swap can be shown).
    const scale = a.inGame?.heightM && a.measured?.heightM ? a.inGame.heightM / a.measured.heightM : null;
    // A character stands in its idle pose from its skeleton's clip library (not its bind pose: arms out in a T).
    const anims = a.rig?.anims && existsSync(join(root, 'games', id, a.rig.anims)) ? readFileSync(join(root, 'games', id, a.rig.anims)).toString('base64') : null;
    models.push({ a, input: modelIn(a.id, readFileSync(abs), { label: a.card ? String(a.card).split('/').pop() : a.id, ...(scale ? { scale } : {}), ...(anims ? { anims, pose: 'idle', poseAt: 0.3 } : {}), ...(a.inGame?.tint ? { tint: lightColours({ sky: a.inGame.tint, ground: a.inGame.tint }, tokens.palette).sky } : a.inGame?.repaint ? { retint: true } : Number(a.inGame?.pull) > 0 ? { pull: Number(a.inGame.pull) } : {}) }), abs });
  }
  if (!models.length) return { ok: false, command: 'assets lineup', id, why: `games/${id} has no recorded models yet (assets add, or the models skill)` };
  const dir = join(root, '.studio', 'art', id);
  mkdirSync(dir, { recursive: true });
  const shot = await withRenderer(async (r) => ({ renderer: r.renderer, ...(await r.lineup(models.map((m) => m.input), tokens)) }), { log });
  const images = { front: join(dir, 'lineup-front.jpg'), quarter: join(dir, 'lineup-quarter.jpg'), silhouettes: join(dir, 'lineup-silhouettes.png') };
  saveDataUrl(shot.front, images.front); saveDataUrl(shot.quarter, images.quarter); saveDataUrl(shot.silhouettes, images.silhouettes);
  const palette = [...PALETTE_KEYS.map((k) => tokens.palette[k]), ...(tokens.palette.ramp ?? [])].filter(Boolean);
  const family = doc?.decisions?.['cast.family']?.value ?? null;
  const check = await assetsCheck(root, id, { validate: false, write: true }).catch(() => null);
  const stale = doc ? staleAssets(doc, manifest) : [];
  const { albedoOf } = await import('./optimise.mjs');
  const rows = [];
  for (const m of models) {
    const flags = [];
    let drift = null;
    try {
      const colours = await albedoOf(m.abs);
      // A model the game pulls toward the palette (inGame.pull) is scored on the colours it is drawn in.
      const pull = Math.max(0, Math.min(1, Number(m.a.inGame?.pull) || 0));
      const drawn = colours.map((c) => (pull ? { ...c, hex: mix(c.hex, nearest(c.hex, palette).hex, pull) } : c));
      const scored = drawn.map((c) => { const n = nearest(c.hex, palette); return { hex: c.hex, share: c.share, palette: n.hex, delta: +n.delta.toFixed(1) }; });
      const mean = scored.reduce((n, c) => n + c.delta * c.share, 0) / Math.max(0.0001, scored.reduce((n, c) => n + c.share, 0));
      drift = { mean: +mean.toFixed(1), colours: scored };
      if (m.a.inGame?.repaint) drift.repaint = m.a.inGame.repaint;
      else if (mean > DRIFT) flags.push(`palette drift: its colours sit ${drift.mean} from the palette (over ${DRIFT}); a re-tint (free) or a remake`);
    } catch (error) { log(`${m.a.id}: colours not read (${error.message})`); }
    const row = shot.rows.find((x) => x.id === m.a.id);
    if (row && ['character', 'creature'].includes(m.a.kind) && (row.silhouette.widthPx < 6 || row.silhouette.fill > 0.92)) flags.push(`silhouette: ${row.silhouette.widthPx < 6 ? 'too thin to read at 64 px' : 'a blob at 64 px (no limbs, ears or tail break the outline)'}`);
    const c = check?.rows?.find((x) => x.id === m.a.id);
    if (c && !c.ok) flags.push(`over budget: ${c.problems[0]}`);
    if (family && m.a.route === 'library' && m.a.from?.pack && !String(m.a.from.pack).startsWith(family)) flags.push(`another library family (${m.a.from.pack}; the game's is ${family}): mixing families shows`);
    if (stale.some((s) => s.id === m.a.id)) flags.push('stale: made under an older decision');
    rows.push({ id: m.a.id, label: m.input.label, kind: m.a.kind, route: m.a.route, size: row?.size ?? null, silhouette: row?.silhouette ?? null, drift, flags });
  }
  const result = { ok: true, command: 'assets lineup', id, renderer: shot.renderer, images: Object.fromEntries(Object.entries(images).map(([k, v]) => [k, relative(root, v)])), rows, palette: palette.slice(0, 7), family, at: new Date().toISOString(), flagged: rows.filter((r) => r.flags.length).length };
  writeFileSync(join(dir, 'lineup.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** `assets review <id> --score n --outliers a,b`: a fresh reviewer's "one game?" score, and the assets it named. */
export function recordReview(root, id, { score, outliers = [], note = null, by = 'reviewer' } = {}) {
  const s = Number(score);
  if (!(s >= 1 && s <= 10)) throw new Error('--score 1 to 10 ("does it look like one game?")');
  const dir = join(root, '.studio', 'art', id);
  mkdirSync(dir, { recursive: true });
  const manifest = readManifest(root, id);
  const needs = new Set(outliers.filter(Boolean));
  if (s < 7) for (const a of manifest.assets) if (a.route !== 'procedural') needs.add(a.id);
  const review = { score: s, outliers: [...needs], note, by, at: new Date().toISOString(), verdict: s >= 7 && !outliers.length ? 'one game' : 'needs review' };
  writeFileSync(join(dir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`);
  return { ok: true, command: 'assets review', id, review };
}

