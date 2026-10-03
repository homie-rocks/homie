/**
 * `homie-studio assets check <id>`: static, free, on every asset and on the whole game.
 *
 *   per asset   the file is there and is the one recorded (SHA-256); the safety check (assets/safety.mjs); the Khronos
 *               glTF-Validator; triangles, materials, picture sizes, bones and bytes against its tier's budget
 *               (the game's cast.tiers decision, else the phone defaults); the pivot at the bottom centre; its height against
 *               the card's; its licence (lib/asset-manifest.mjs); whether a decision it was made under has moved on
 *   the game    shipped models with no record; draw calls, triangles and picture memory summed (each asset times its
 *               `placements`, instanced ones drawn once); the first-play download from the last build (gzip); a
 *               committed binary over 5 MB under games/ (it belongs in R2, never in git)
 *
 * The result also goes to .studio/art/<id>/check.json, which the Studio mod's Art tab and the cards read.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { licenceProblems, readManifest, unrecordedModels } from './asset-manifest.mjs';
import { readDecisions, staleAssets } from './decisions.mjs';

/** The phone tier: the defaults when the game has no cast.tiers decision. Hard caps are never loosened. */
export const BUDGETS = Object.freeze({
  hero: { triangles: 8000, texturePx: 1024, kb: 1536, bones: 48, materials: 1 },
  npc: { triangles: 3000, texturePx: 512, kb: 600, bones: 32, materials: 1 },
  prop: { triangles: 1500, texturePx: 512, kb: 300, bones: 0, materials: 1 },
  signature: { triangles: 5000, texturePx: 1024, kb: 800, bones: 0, materials: 1 },
  kit: { triangles: 1000, texturePx: 512, kb: 200, bones: 0, materials: 1 },
  scene: { drawCalls: 100, triangles: 150_000, textureMB: 48, firstPlayMB: 5 },
});
export const HARD_CAPS = Object.freeze({ triangles: { hero: 15000, npc: 6000, prop: 8000, signature: 8000, kit: 3000 }, texturePx: 2048, kb: 5120, bones: 64, materials: 2, scene: { drawCalls: 150, triangles: 250_000, textureMB: 64, firstPlayMB: 8 } });
const BIG_FILE = 5 * 1024 * 1024;

const tierOf = (a) => (BUDGETS[a.tier] ? a.tier : a.kind === 'character' ? 'hero' : a.kind === 'creature' ? 'npc' : a.kind === 'kit' || a.kind === 'environment' ? 'kit' : 'prop');

/** The budgets this game holds itself to: its cast.tiers decision over the phone defaults, never past a hard cap. */
export function budgetsFor(doc) {
  const v = doc?.decisions?.['cast.tiers']?.value ?? {};
  const out = {};
  for (const [k, def] of Object.entries(BUDGETS)) out[k] = { ...def, ...(typeof v[k] === 'object' ? v[k] : {}) };
  for (const t of ['hero', 'npc', 'prop', 'signature', 'kit']) {
    out[t].triangles = Math.min(out[t].triangles, HARD_CAPS.triangles[t]);
    out[t].texturePx = Math.min(out[t].texturePx, HARD_CAPS.texturePx);
    out[t].kb = Math.min(out[t].kb, HARD_CAPS.kb);
    out[t].bones = Math.min(out[t].bones ?? 0, HARD_CAPS.bones);
  }
  for (const k of ['drawCalls', 'triangles', 'textureMB', 'firstPlayMB']) out.scene[k] = Math.min(out.scene[k], HARD_CAPS.scene[k]);
  return out;
}

/** Files tracked by git under games/ over 5 MB (they belong in the studio's R2, never in git). */
export function bigCommittedFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z', '--', 'games'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter(Boolean).map((p) => { try { return { path: p, bytes: statSync(join(root, p)).size }; } catch { return null; } }).filter((x) => x && x.bytes > BIG_FILE);
}

/** The first-play download of the last build of this game: every file under site/dist/games/<id>, gzipped. */
export function firstPlayBytes(root, id) {
  const dir = join(root, 'site', 'dist', 'games', id);
  if (!existsSync(dir)) return null;
  let raw = 0; let gz = 0; let files = 0;
  // The same sound in several formats (an .ogg and its .wav fallback for an old Safari): a browser fetches one, so
  // only the smallest of each set counts.
  const audio = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '_landing') walk(p); continue; }
      if (/^(source|assets)\.json$|\.map$/.test(e.name)) continue;
      const b = readFileSync(p);
      if (/\.(ogg|mp3|m4a|aac|wav|webm|opus|flac)$/i.test(e.name)) {
        const stem = p.replace(/\.[^.\/]+$/, '');
        const prev = audio.get(stem);
        if (!prev || b.byteLength < prev) audio.set(stem, b.byteLength);
        continue;
      }
      raw += b.byteLength; files += 1;
      gz += /\.(png|jpe?g|webp|glb|mp4|woff2|ktx2)$/i.test(e.name) ? b.byteLength : gzipSync(b, { level: 6 }).byteLength;
    }
  };
  walk(dir);
  for (const bytes of audio.values()) { raw += bytes; gz += bytes; files += 1; }
  return { raw, gzip: gz, files };
}

const kb = (n) => Math.round(n / 1024);

/** `assets check`: { ok, game, rows, totals, budgets, licence, stale, unrecorded, bigFiles, firstPlay, problems }. */
export async function assetsCheck(root, id, { validate = true, write = true } = {}) {
  const manifest = readManifest(root, id);
  const doc = readDecisions(root, id);
  const budgets = budgetsFor(doc);
  const gdir = join(root, 'games', id);
  let tools = null;
  try { tools = await import('./optimise.mjs'); } catch { tools = null; }
  const rows = [];
  let tris = 0; let draws = 0; let texBytes = 0;
  const seenFiles = new Set();
  for (const a of manifest.assets) {
    const problems = []; const warnings = [];
    const tier = tierOf(a);
    const b = budgets[tier] ?? budgets.prop;
    const n = Math.max(1, Number(a.placements ?? 1) || 1);
    const model = (a.files ?? []).find((f) => f.role === 'model');
    let m = null;
    if (model) {
      const abs = join(gdir, model.path);
      if (!existsSync(abs)) problems.push(`${model.path} is missing`);
      else {
        const bytes = readFileSync(abs);
        const safe = checkGlb(bytes, LIMITS.game);
        if (!safe.ok) problems.push(...safe.problems.map((p) => `unsafe: ${p}`));
        if (model.sha256 && tools) { const sum = tools.sha256(bytes); if (sum !== model.sha256) warnings.push('the file changed since it was recorded (its SHA-256 differs): record it again (assets add) so its measurements and provenance are true'); }
        if (safe.ok && tools) {
          const ins = await tools.inspectModel(bytes, { limits: LIMITS.game }).catch((e) => ({ ok: false, why: e.message }));
          m = ins.measured;
          if (validate && ins.validator?.errors) problems.push(`the glTF-Validator found ${ins.validator.errors} error${ins.validator.errors === 1 ? '' : 's'}: ${ins.validator.messages.slice(0, 2).join('; ')}`);
          if (ins.why) problems.push(ins.why);
        }
        if (m) {
          if (m.triangles > HARD_CAPS.triangles[tier]) problems.push(`${m.triangles} triangles is over the hard cap of ${HARD_CAPS.triangles[tier]} for a ${tier}`);
          else if (m.triangles > b.triangles) problems.push(`${m.triangles} triangles (a ${tier}'s budget is ${b.triangles}): assets optimise --triangles ${b.triangles}`);
          if (m.maxTexturePx > b.texturePx) problems.push(`a ${m.maxTexturePx} px picture (a ${tier}'s budget is ${b.texturePx} px)`);
          if (m.materials > HARD_CAPS.materials) problems.push(`${m.materials} materials (at most ${HARD_CAPS.materials})`);
          else if (m.materials > b.materials) warnings.push(`${m.materials} materials (the budget is ${b.materials}: one draw call per material)`);
          if (bytes.byteLength / 1024 > b.kb) problems.push(`${kb(bytes.byteLength)} KB (a ${tier}'s budget is ${b.kb} KB)`);
          if (m.bones > (b.bones || HARD_CAPS.bones)) problems.push(`${m.bones} bones (a ${tier}'s budget is ${b.bones || HARD_CAPS.bones})`);
          if (m.pivot && !(m.pivot.bottom && m.pivot.centred)) warnings.push('its pivot is not at the bottom centre (assets optimise puts it there)');
          const want = Number(a.heightM ?? a.card?.heightM ?? 0);
          if (want > 0 && m.heightM && Math.abs(m.heightM / want - 1) > 0.1) warnings.push(`${m.heightM} m tall; its card says ${want} m`);
          if (!seenFiles.has(model.path)) { texBytes += m.textureGpuBytes; seenFiles.add(model.path); }
          tris += m.triangles * n;
          draws += a.instanced ? m.drawCalls : m.drawCalls * n;
        }
      }
    } else if (a.route !== 'procedural' && !['texture', 'sky'].includes(a.kind)) problems.push('no model file recorded');
    for (const f of (a.files ?? []).filter((x) => x.role !== 'model' && x.public !== false && /^public\//.test(x.path ?? ''))) {
      if (!existsSync(join(gdir, f.path))) problems.push(`${f.path} is missing`);
    }
    if (a.route === 'procedural' && a.measured) { tris += (a.measured.tris ?? 0) * n; draws += a.instanced ? (a.measured.drawCalls ?? 1) : (a.measured.drawCalls ?? 1) * n; }
    rows.push({ id: a.id, kind: a.kind, tier, route: a.route, ok: problems.length === 0, problems, warnings, measured: m ? { tris: m.triangles, drawCalls: m.drawCalls, materials: m.materials, maxTexturePx: m.maxTexturePx, textureKB: kb(m.textureGpuBytes), bones: m.bones, heightM: m.heightM, kb: model ? kb(statSync(join(gdir, model.path)).size) : null } : null, budget: b, placements: n });
  }
  const licence = licenceProblems(root, id, manifest, { public: publicSource(root, id) });
  const stale = doc ? staleAssets(doc, manifest) : [];
  const unrecorded = unrecordedModels(root, id, manifest);
  const bigFiles = bigCommittedFiles(root).filter((f) => f.path.startsWith(`games/${id}/`));
  const firstPlay = firstPlayBytes(root, id);
  const s = budgets.scene;
  const totals = { assets: manifest.assets.length, triangles: tris, drawCalls: draws, textureMB: +(texBytes / 1024 / 1024).toFixed(1), firstPlayMB: firstPlay ? +(firstPlay.gzip / 1024 / 1024).toFixed(2) : null };
  const problems = [];
  if (totals.drawCalls > s.drawCalls) problems.push(`about ${totals.drawCalls} draw calls in a scene (the phone budget is ${s.drawCalls}): instance repeated props (placements with instanced: true), or fewer materials`);
  if (totals.triangles > s.triangles) problems.push(`about ${totals.triangles.toLocaleString('en-US')} triangles in a scene (the phone budget is ${s.triangles.toLocaleString('en-US')})`);
  if (totals.textureMB > s.textureMB) problems.push(`${totals.textureMB} MB of picture memory (the phone budget is ${s.textureMB} MB; an iPhone page dies near 100 MB)`);
  if (totals.firstPlayMB !== null && totals.firstPlayMB > s.firstPlayMB) problems.push(`${totals.firstPlayMB} MB to download before the first round (the budget is ${s.firstPlayMB} MB)`);
  for (const l of licence.filter((x) => x.level === 'refuse')) problems.push(`${l.asset}: ${l.problem}${l.fix ? ` (${l.fix})` : ''}`);
  for (const f of bigFiles) problems.push(`${f.path} is ${(f.bytes / 1024 / 1024).toFixed(1)} MB in git: big files go to the studio's R2 (homie-studio storage add, then media move), raw files to art/<slug>/raw/ (git-ignored)`);
  const ok = rows.every((r) => r.ok) && problems.length === 0;
  const result = { ok, command: 'assets check', game: id, rows, totals, budgets: { ...s, tiers: Object.fromEntries(['hero', 'npc', 'prop', 'signature', 'kit'].map((t) => [t, budgets[t]])) }, licence, stale, unrecorded, bigFiles, firstPlay, problems, at: new Date().toISOString() };
  if (write) {
    const dir = join(root, '.studio', 'art', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'check.json'), `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

/** Whether a game's source is shared (game.json share.source is not false) and it is meant to be public. */
export function publicSource(root, id) {
  try { const g = JSON.parse(readFileSync(join(root, 'games', id, 'game.json'), 'utf8')); return g.share?.source !== false; } catch { return true; }
}

/** The check in lines a person reads. */
export function checkLines(r) {
  const lines = [`${r.ok ? 'PASS' : 'NOT YET'}: ${r.game}'s ${r.totals.assets} asset${r.totals.assets === 1 ? '' : 's'} against the phone budgets`];
  for (const row of r.rows) {
    const m = row.measured;
    lines.push(`  ${row.ok ? 'ok  ' : 'FIX '} ${row.id} (${row.kind}, ${row.tier}, ${row.route})${m ? `: ${m.tris} triangles, ${m.drawCalls} draw${m.drawCalls === 1 ? '' : 's'}, ${m.kb} KB, ${m.maxTexturePx ? `${m.maxTexturePx} px pictures` : 'no pictures'}${m.heightM ? `, ${m.heightM} m` : ''}` : ''}`);
    for (const p of row.problems) lines.push(`        ${p}`);
    for (const w of row.warnings) lines.push(`        note: ${w}`);
  }
  for (const u of r.unrecorded) lines.push(`  FIX  ${u}: shipped with no record (homie-studio assets add ${r.game} --file ${u} --license <kind>)`);
  const s = r.budgets;
  lines.push(`  scene: about ${r.totals.drawCalls} draw calls (budget ${s.drawCalls}), ${r.totals.triangles.toLocaleString('en-US')} triangles (${s.triangles.toLocaleString('en-US')}), ${r.totals.textureMB} MB of picture memory (${s.textureMB} MB)${r.totals.firstPlayMB !== null ? `, ${r.totals.firstPlayMB} MB first play (${s.firstPlayMB} MB)` : ', first play: build first'}`);
  for (const l of r.licence) lines.push(`  ${l.level === 'refuse' ? 'FIX ' : 'note'} licence ${l.asset}: ${l.problem}${l.fix ? ` (${l.fix})` : ''}`);
  for (const st of r.stale) lines.push(`  stale ${st.id}: made under an older ${st.decisions.map((d) => d.id).join(', ')} (homie-studio style blast shows the cost; nothing is remade by itself)`);
  for (const p of r.problems.filter((x) => !/^[a-z0-9-]+: /.test(x))) lines.push(`  FIX  ${p}`);
  return lines;
}
