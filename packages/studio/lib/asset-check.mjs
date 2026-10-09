import { experienceDir, experienceFile } from './studio.mjs';
/**
 * `homie-studio assets check <id>`: static, free, on every asset and on the whole game. What it adds up is an
 * INVENTORY ESTIMATE: the recorded files' own triangles, draw calls and pictures times their declared placements. It
 * never ran the game, so it cannot see what the code builds or repeats (UNMEASURED_AT_RUNTIME); a pass here is not a
 * measured frame. The playtest and perf guides measure the running game.
 *
 *   per asset   the file is there and is the one recorded (SHA-256); the safety check (assets/safety.mjs); the Khronos
 *               glTF-Validator; triangles, materials, picture sizes, bones and bytes against its tier's budget
 *               (the game's cast.tiers decision, else the phone defaults); the pivot at the bottom centre; its height against
 *               the card's; its licence (lib/asset-manifest.mjs); whether a decision it was made under has moved on
 *   characters  four influences a vertex (three.js reads no more), bones within the tier, its skeleton's clip library
 *               present, and every verb the game needs (anim.clips) in it
 *   clips       a skeleton's clip library (kind clip): at most 1 MB (3 MB hard), sampled at no more than 30 a second
 *   pictures    a standalone texture or sky record: each shipped picture there, the one recorded (SHA-256), decodable,
 *               its size against PICTURES, and its mipmapped memory added ONCE per unique picture
 *   the game    shipped models with no record; shipped pictures with no record (named apart from pictures the game
 *               folder keeps but never ships); draw calls, triangles and picture memory summed (each asset times its
 *               `placements`, instanced ones drawn once; an asset whose `usage` is "unused" is checked but left out of
 *               the scene sums); the shipped payload of the last build (every built file, gzip: a conservative gate,
 *               never a trace of what a browser fetched before the first round); a
 *               committed binary over 5 MB under games/ (it belongs in R2, never in git); skinning on a phone: the
 *               room's players times the heaviest character's skinned vertices and bones, against SKINNING (beyond it,
 *               far characters must pose less often: @homie-rocks/studio/animate's crowd())
 *
 * The result also goes to .studio/art/<id>/check.json, which the Studio mod's Art tab and the cards read.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { licenceProblems, readManifest, unrecordedModels, unrecordedPictures, usageOf } from './asset-manifest.mjs';
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
/**
 * A standalone picture (a texture or sky record's own file, not one inside a .glb): the longest side it is expected
 * to stay under (a note past it) and the side no phone should be handed (a problem past it). A sky is one picture
 * around the whole world, so it is allowed twice a surface's.
 */
export const PICTURES = Object.freeze({ texture: { px: 1024, hardPx: 2048 }, sky: { px: 2048, hardPx: 4096 } });
/**
 * What this check cannot see, because it reads files and never runs the game. Printed with every result, so a pass is
 * never read as a measured frame.
 */
export const UNMEASURED_AT_RUNTIME = Object.freeze([
  'geometry the game\'s code builds (terrain, procedural props, generated meshes with no record)',
  'copies the code draws beyond each record\'s `placements` (repeated characters, weapons, scattered props)',
  'effects and particles',
  'shadow passes and post-processing passes (each draws the scene again)',
  'the HUD and any picture the code loads that has no record',
]);
/**
 * Skinning on a phone, every frame (judgment, from the house's 32-player rooms; the perf skill's measured gate decides):
 * the vertices the GPU skins and the bones the CPU poses. Characters past `crowdFrom` need crowd mode.
 */
export const SKINNING = Object.freeze({ vertices: 60_000, bones: 1_200, crowdFrom: 12, clipKB: 1024, clipHardKB: 3072, clipRate: 30 });
export const HARD_CAPS = Object.freeze({ triangles: { hero: 15000, npc: 6000, prop: 8000, signature: 8000, kit: 3000 }, texturePx: 2048, kb: 5120, bones: 64, materials: 2, scene: { drawCalls: 150, triangles: 250_000, textureMB: 64, firstPlayMB: 8 } });
const BIG_FILE = 5 * 1024 * 1024;

const TIERS = ['hero', 'npc', 'prop', 'signature', 'kit'];
/** The tiers a game may set a budget for (game.json assets.budgets.<tier>). */
export const BUDGET_TIERS = Object.freeze([...TIERS]);
const tierOf = (a) => (a.kind === 'clip' ? 'clip' : BUDGETS[a.tier] ? a.tier : a.kind === 'character' ? 'hero' : a.kind === 'creature' ? 'npc' : a.kind === 'kit' || a.kind === 'environment' ? 'kit' : 'prop');

/** A game's game.json, or {} (a planned game has none yet). */
export function gameJson(root, id) {
  try { return JSON.parse(readFileSync(experienceFile(root, id), 'utf8')) ?? {}; } catch { return {}; }
}

/*
 * ONE KEY, THREE READERS. game.json `assets.budgets` is read by `assets check` and `assets add` (budgetsFor, below)
 * and by the build, which hands it to the game's own loader (`createModels()`, as __HOMIE_MODEL_BUDGETS__). They are
 * one reading: `gameBudgets` is the only code that parses the key, `budgetsFor` is what a check and an import hold a
 * model of a tier to, and `loaderBudget` is what the build gives the loader, which knows no tiers: the loosest thing
 * the game declared, under the same hard caps. So the loader never warns about a model the check passes under the
 * game's own budgets, and a number past a hard cap is past it for all three.
 */
/** The fields a game may set per model (and per tier). `materials` is the loader's alone: the check's is a hard cap. */
export const BUDGET_FIELDS = Object.freeze(['triangles', 'bytes', 'texturePx']);
/** The most any tier may be allowed, whatever a game declares: what the loader's one budget is held under. */
export const LOADER_CAPS = Object.freeze({ get triangles() { return Math.max(...Object.values(HARD_CAPS.triangles)); }, get bytes() { return HARD_CAPS.kb * 1024; }, get texturePx() { return HARD_CAPS.texturePx; } });

/**
 * What the build hands the game's loader for one model, from the same declaration: per field, the largest the game
 * declared flat or for any tier, never past the hard cap. Null when the game declares none (the loader's own
 * defaults, a small prop's, then stand). `capped`: the fields that were over a cap, with what was asked.
 */
export function loaderBudget(game) {
  const d = gameBudgets(game);
  if (!d) return null;
  const out = {}; const capped = [];
  for (const k of BUDGET_FIELDS) {
    const asked = Math.max(0, d[k] ?? 0, ...Object.values(d.tiers ?? {}).map((t) => t[k] ?? 0));
    if (!asked) continue;
    out[k] = Math.min(asked, LOADER_CAPS[k]);
    if (asked > LOADER_CAPS[k]) capped.push({ field: k, asked, cap: LOADER_CAPS[k] });
  }
  return Object.keys(out).length ? { budget: out, capped } : null;
}

/**
 * The per-model budget a game declares for itself: game.json `assets.budgets` ({ triangles, bytes }, the same key the
 * runtime loader's development warnings read; `texturePx` too when given). Flat for every model, or one object a
 * tier ({ prop: { triangles }, hero: { ... } }). Absent, or not an object: null, and nothing changes.
 */
export function gameBudgets(game) {
  // `"assets": "library"` (a 3D starter's note of where its models come from) is a string, not budgets: none declared.
  const b = game?.assets && typeof game.assets === 'object' ? game.assets.budgets : undefined;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const read = (o) => {
    const out = {};
    // A whole number above zero, as the build reads it for the loader (lib/build.mjs modelBudgetsOf): one rule.
    for (const k of BUDGET_FIELDS) { const n = Math.floor(Number(o?.[k])); if (Number.isFinite(n) && n >= 1) out[k] = n; }
    return out;
  };
  const flat = read(b);
  const tiers = Object.fromEntries(TIERS.filter((t) => b[t] && typeof b[t] === 'object').map((t) => [t, read(b[t])]).filter(([, v]) => Object.keys(v).length));
  return Object.keys(flat).length || Object.keys(tiers).length ? { ...flat, ...(Object.keys(tiers).length ? { tiers } : {}) } : null;
}

/**
 * The budgets this game holds itself to: its cast.tiers decision over the phone defaults, then what its game.json
 * `assets.budgets` declares for a model (it RAISES a tier's triangles, bytes and picture size to that, so the check and
 * the loader's warnings agree; it never lowers a hero to a prop's size), never past a hard cap.
 */
export function budgetsFor(doc, game = null) {
  const v = doc?.decisions?.['cast.tiers']?.value ?? {};
  const out = {};
  for (const [k, def] of Object.entries(BUDGETS)) out[k] = { ...def, ...(typeof v[k] === 'object' ? v[k] : {}) };
  // The scene's payload budget under its honest name too (a decision written before it was renamed still counts).
  if (Number.isFinite(Number(v.scene?.shippedPayloadMB))) out.scene.firstPlayMB = Number(v.scene.shippedPayloadMB);
  const declared = gameBudgets(game);
  for (const t of TIERS) {
    const own = declared ? { ...declared, ...(declared.tiers?.[t] ?? {}) } : null;
    if (own?.triangles) out[t].triangles = Math.max(out[t].triangles, own.triangles);
    if (own?.bytes) out[t].kb = Math.max(out[t].kb, Math.ceil(own.bytes / 1024));
    if (own?.texturePx) out[t].texturePx = Math.max(out[t].texturePx, own.texturePx);
    out[t].triangles = Math.min(out[t].triangles, HARD_CAPS.triangles[t]);
    out[t].texturePx = Math.min(out[t].texturePx, HARD_CAPS.texturePx);
    out[t].kb = Math.min(out[t].kb, HARD_CAPS.kb);
    out[t].bones = Math.min(out[t].bones ?? 0, HARD_CAPS.bones);
  }
  for (const k of ['drawCalls', 'triangles', 'textureMB', 'firstPlayMB']) out.scene[k] = Math.min(out.scene[k], HARD_CAPS.scene[k]);
  out.scene.shippedPayloadMB = out.scene.firstPlayMB;
  return out;
}

/** Files tracked by git under games/ over 5 MB (they belong in the studio's R2, never in git). */
export function bigCommittedFiles(root) {
  const r = spawnSync('git', ['ls-files', '-z', '--', 'games'], { cwd: root, encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) return [];
  return r.stdout.split('\0').filter(Boolean).map((p) => { try { return { path: p, bytes: statSync(join(root, p)).size }; } catch { return null; } }).filter((x) => x && x.bytes > BIG_FILE);
}

/**
 * The SHIPPED PAYLOAD of the last build of this game: every file under site/dist/games/<id>, gzipped (one format a
 * sound). It is what the game ships, and so the most a first visit could fetch: a conservative gate. It is not what a
 * browser downloads before the first round (a model the code never loads and music that streams are both in it, and
 * nothing here watched a network): the playtest measures that.
 */
export function shippedPayloadBytes(root, id) {
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
/** The old name of shippedPayloadBytes (0.22.0 to 0.31): kept so a script that imports it still runs. */
export const firstPlayBytes = shippedPayloadBytes;

const PICTURE_FILE = /\.(png|jpe?g|webp|avif|gif|hdr|exr|ktx2)$/i;
const mipmapped = (w, h, bytesPerPixel = 4) => Math.round(w * h * bytesPerPixel * (4 / 3));

/**
 * One shipped picture, measured: its SHA-256, its size in pixels, whether it decodes, and the memory it takes once a
 * renderer has it with mipmaps (RGBA8: width x height x 4 x 4/3; a Radiance .hdr as half floats, twice that). An
 * estimate of what a GPU is asked for, never a reading of one. `why` says what stopped a measurement.
 */
export async function measurePicture(abs) {
  const bytes = readFileSync(abs);
  const base = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), px: null, format: null, gpuBytes: 0, why: null };
  if (/\.hdr$/i.test(abs)) {
    // A Radiance picture's size is in its text header ("-Y 1024 +X 2048"); its pixels are not decoded here.
    const m = /^[-+]Y\s+(\d+)\s+[-+]X\s+(\d+)\s*$/m.exec(bytes.subarray(0, 4096).toString('latin1'));
    if (!m) return { ...base, why: 'not a readable Radiance .hdr (no size in its header)' };
    return { ...base, px: [Number(m[2]), Number(m[1])], format: 'hdr', gpuBytes: mipmapped(Number(m[2]), Number(m[1]), 8), decoded: false };
  }
  if (/\.(exr|ktx2)$/i.test(abs)) return { ...base, why: `a ${abs.split('.').pop().toLowerCase()} picture: this check cannot decode it, so its size and memory are not measured` };
  let sharp = null;
  try { sharp = (await import('sharp')).default; } catch { sharp = null; }
  if (!sharp) return { ...base, why: 'sharp is not installed here, so pictures are not measured (npm install in the studio)' };
  try {
    const meta = await sharp(bytes).metadata();
    // Decoded all the way (a truncated file has a fine header): to a few pixels, which reads every row.
    await sharp(bytes).resize(8, 8, { fit: 'fill' }).raw().toBuffer();
    return { ...base, px: [meta.width, meta.height], format: meta.format ?? null, gpuBytes: mipmapped(meta.width, meta.height), decoded: true };
  } catch (error) { return { ...base, why: `it does not decode (${String(error.message).split('\n')[0].slice(0, 120)})` }; }
}

const kb = (n) => Math.round(n / 1024);

/**
 * `assets check`: { ok, scope: 'inventory-estimate', game, rows, totals, estimate, budgets, licence, stale, unrecorded,
 * unrecordedPictures, bigFiles, shippedPayload (and `firstPlay`, its old name), problems }.
 */
export async function assetsCheck(root, id, { validate = true, write = true } = {}) {
  const manifest = readManifest(root, id);
  const doc = readDecisions(root, id);
  const game = gameJson(root, id);
  const budgets = budgetsFor(doc, game);
  const gdir = experienceDir(root, id);
  let tools = null;
  try { tools = await import('./optimise.mjs'); } catch { tools = null; }
  const rows = [];
  let tris = 0; let draws = 0; let texBytes = 0; let unusedMapBytes = 0; let undeclaredMapBytes = 0; let pictureBytes = 0;
  const seenFiles = new Set();
  // A picture two records name (or one file copied to two paths) is one picture in memory: counted by its bytes.
  const seenPictures = new Set();
  const { verbsFor, librariesFor, duplicateLibraries } = await import('./characters.mjs');
  const needVerbs = verbsFor(doc);
  const strays = duplicateLibraries(manifest);
  let heaviest = { vertices: 0, bones: 0, id: null };
  // What the game draws a model's materials with: every map the file has (`all`), or its base colour only (`base`,
  // what stylize() keeps for a toon, flat, pixel or hand-painted look). Only a DECLARATION changes the sum: on one
  // record (`inGame.maps`) or for the whole manifest (its top-level `inGame.maps`). Nothing is read from the code.
  const mapsOf = (a) => (['base', 'all'].includes(a.inGame?.maps) ? a.inGame.maps : ['base', 'all'].includes(manifest.inGame?.maps) ? manifest.inGame.maps : null);
  for (const a of manifest.assets) {
    const problems = []; const warnings = [];
    const tier = tierOf(a);
    const b = budgets[tier] ?? budgets.prop;
    const n = Math.max(1, Number(a.placements ?? 1) || 1);
    if (a.kind === 'clip') { const row = await clipRow(gdir, a, tools); if (strays.has(a.id)) row.warnings.push(strays.get(a.id)); rows.push(row); continue; }
    // An asset the game no longer draws (usage "unused": a legacy model kept in the folder) is still checked, and still
    // ships, but is no part of a scene: it stays out of the sums.
    const usage = usageOf(a);
    const counted = usage !== 'unused';
    const model = (a.files ?? []).find((f) => f.role === 'model');
    let m = null; let unmeasured = null; let unusedKB = 0;
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
          if (m.influences > 4) problems.push(`${m.influences} joints move one vertex (JOINTS_1): three.js reads 4, so the rest are dropped and the mesh tears; export with 4 influences a vertex`);
          if (counted && m.skinnedVertices > heaviest.vertices) heaviest = { ...heaviest, vertices: m.skinnedVertices, id: a.id };
          if (counted && m.bones > heaviest.bones) heaviest.bones = m.bones;
          if (a.rig) {
            // The library is the one this model names (rig.anims), with any library declared supplemental for its
            // skeleton: never "whichever clip record of that skeleton was read last".
            const lib = librariesFor(manifest, a);
            const animsFile = a.rig.anims ? join(gdir, a.rig.anims) : null;
            if (!animsFile || !existsSync(animsFile)) problems.push(`its clip library ${a.rig.anims ?? '(none named)'} is missing: homie-studio anim add ${id} ${a.id} --verbs ${needVerbs.join(',')}`);
            else {
              const lacking = needVerbs.filter((v) => !lib.verbs.includes(v));
              if (lacking.length) warnings.push(`the game's clips (anim.clips) name ${lacking.join(', ')}, which ${a.id}'s clip library has not: homie-studio anim add ${id} ${a.id} --verbs ${lacking.join(',')}`);
            }
          }
          if (m.pivot && !(m.pivot.bottom && m.pivot.centred)) warnings.push('its pivot is not at the bottom centre (assets optimise puts it there)');
          const want = Number(a.heightM ?? a.card?.heightM ?? 0);
          if (want > 0 && m.heightM && Math.abs(m.heightM / want - 1) > 0.1) warnings.push(`${m.heightM} m tall; its card says ${want} m`);
          // Pictures no base-colour slot uses (normal, occlusion/roughness/metal, emissive): counted unless the game
          // DECLARES it draws base colour only. Said either way, so the number is never silently one or the other.
          const extra = m.textures.filter((t) => !(t.slots ?? []).includes('baseColorTexture')).reduce((s, t) => s + t.gpuBytes, 0);
          const maps = mapsOf(a);
          const dropped = maps === 'base' ? extra : 0;
          unusedKB = kb(dropped);
          if (extra && maps === 'base') warnings.push(`${(extra / 1024 / 1024).toFixed(1)} MB of its normal and roughness maps are left out of picture memory: declared base colour only (inGame.maps: "base"). The file still ships them (the download and the decode stay): assets optimise can drop them`);
          if (counted && !seenFiles.has(model.path)) {
            texBytes += m.textureGpuBytes - dropped; unusedMapBytes += dropped;
            if (extra && !maps) undeclaredMapBytes += extra;
            seenFiles.add(model.path);
          }
          if (counted) { tris += m.triangles * n; draws += a.instanced ? m.drawCalls : m.drawCalls * n; }
        }
      }
    } else if (a.route !== 'procedural' && !['texture', 'sky'].includes(a.kind)) problems.push('no model file recorded');
    // Standalone pictures (a texture or sky record's own files, and any shipped picture a model's record names beside
    // it): there, the ones recorded, decodable, within PICTURES, and in picture memory once each.
    const pictures = [];
    for (const f of (a.files ?? []).filter((x) => x.role !== 'model' && x.public !== false && /^public\//.test(x.path ?? ''))) {
      const abs = join(gdir, f.path);
      if (!existsSync(abs)) { problems.push(`${f.path} is missing`); continue; }
      if (!PICTURE_FILE.test(f.path)) continue;
      const p = await measurePicture(abs);
      if (f.sha256 && p.sha256 !== f.sha256) warnings.push(`${f.path} changed since it was recorded (its SHA-256 differs): record it again so its provenance is true`);
      if (!f.sha256) warnings.push(`${f.path} has no SHA-256 in its record: nothing proves it is the file that was recorded`);
      if (!p.px) { problems.push(`${f.path}: ${p.why}`); continue; }
      const lim = PICTURES[a.kind === 'sky' || f.role === 'sky' ? 'sky' : 'texture'];
      const side = Math.max(p.px[0], p.px[1]);
      if (side > lim.hardPx) problems.push(`${f.path} is ${p.px[0]} x ${p.px[1]} px (at most ${lim.hardPx} px a side for a ${lim === PICTURES.sky ? 'sky' : 'texture'})`);
      else if (side > lim.px) warnings.push(`${f.path} is ${p.px[0]} x ${p.px[1]} px: about ${(p.gpuBytes / 1024 / 1024).toFixed(1)} MB of picture memory with mipmaps (${lim.px} px is plenty on a phone)`);
      if (counted && !seenPictures.has(p.sha256)) { seenPictures.add(p.sha256); texBytes += p.gpuBytes; pictureBytes += p.gpuBytes; }
      pictures.push({ path: f.path, px: p.px, format: p.format, gpuKB: kb(p.gpuBytes), kb: kb(p.bytes) });
    }
    if (a.route === 'procedural' && a.measured && counted) { tris += (a.measured.tris ?? 0) * n; draws += a.instanced ? (a.measured.drawCalls ?? 1) : (a.measured.drawCalls ?? 1) * n; }
    let measured = m ? { tris: m.triangles, drawCalls: m.drawCalls, materials: m.materials, maxTexturePx: m.maxTexturePx, textureKB: kb(m.textureGpuBytes) - unusedKB + pictures.reduce((s, p) => s + p.gpuKB, 0), bones: m.bones, heightM: m.heightM, kb: model ? kb(statSync(join(gdir, model.path)).size) : null, ...(unusedKB ? { unusedTextureKB: unusedKB } : {}), ...(pictures.length ? { pictures } : {}) } : null;
    if (!m && pictures.length) measured = { tris: 0, drawCalls: 0, materials: 0, maxTexturePx: pictures.reduce((s, p) => Math.max(s, p.px[0], p.px[1]), 0), textureKB: pictures.reduce((s, p) => s + p.gpuKB, 0), bones: 0, heightM: null, kb: pictures.reduce((s, p) => s + p.kb, 0), pictures };
    // Nothing was measured: said, never shown as a plain pass. A procedural part's numbers are its record's own claim.
    if (!measured && !problems.length) unmeasured = a.route === 'procedural' ? (a.measured ? 'drawn by the game\'s code: the triangles and draw calls are what its record says, not a reading' : 'drawn by the game\'s code, with no numbers in its record: no part of the estimate') : 'no shipped file of it could be measured';
    rows.push({ id: a.id, kind: a.kind, tier, route: a.route, usage, counted, ok: problems.length === 0, problems, warnings, measured, ...(unmeasured ? { unmeasured } : {}), budget: b, placements: n });
  }
  // Skinning on a phone: the room's players, each the heaviest character (the worst case a room can draw).
  const players = Math.max(1, Number(game.players?.max ?? 8) || 8);
  const skinning = heaviest.vertices ? { players, character: heaviest.id, vertices: heaviest.vertices * players, bones: heaviest.bones * players, budget: { vertices: SKINNING.vertices, bones: SKINNING.bones } } : null;
  const licence = licenceProblems(root, id, manifest);
  const stale = doc ? staleAssets(doc, manifest) : [];
  const unrecorded = unrecordedModels(root, id, manifest);
  // Shipped pictures no record names: measured, so the gap has a size, but kept OUT of the sum (nothing says the game
  // loads them as textures: a cover and a HUD icon are pictures too). Apart from pictures the folder never ships.
  const loose = unrecordedPictures(root, id, manifest, { cover: game.cover ?? null });
  const shipped = [];
  for (const path of loose.shipped.slice(0, 60)) { const p = await measurePicture(join(gdir, path)).catch(() => null); shipped.push({ path, px: p?.px ?? null, gpuKB: p?.px ? kb(p.gpuBytes) : null, ...(p?.px ? {} : { why: p?.why ?? 'not read' }) }); }
  const unrecordedPics = { shipped, more: Math.max(0, loose.shipped.length - shipped.length), mipmappedMB: +(shipped.reduce((s, p) => s + (p.gpuKB ?? 0), 0) / 1024).toFixed(1), notShipped: loose.notShipped };
  const bigFiles = bigCommittedFiles(root).filter((f) => f.path.startsWith(`games/${id}/`));
  const shippedPayload = shippedPayloadBytes(root, id);
  const s = budgets.scene;
  const payloadMB = shippedPayload ? +(shippedPayload.gzip / 1024 / 1024).toFixed(2) : null;
  // Only what a record marks unused: a clip library is drawn by nothing and is no part of the sums either way.
  const unused = rows.filter((r) => r.usage === 'unused').map((r) => r.id);
  // `firstPlayMB` is the old key of `shippedPayloadMB` (the same number): the cards and scripts written against 0.30
  // still read it. It never was a measured first-play download.
  const totals = { assets: manifest.assets.length, triangles: tris, drawCalls: draws, textureMB: +(texBytes / 1024 / 1024).toFixed(1), standaloneTextureMB: +(pictureBytes / 1024 / 1024).toFixed(1), unusedMapMB: +(unusedMapBytes / 1024 / 1024).toFixed(1), shippedPayloadMB: payloadMB, firstPlayMB: payloadMB, skinnedVertices: skinning?.vertices ?? 0, bones: skinning?.bones ?? 0, unused: unused.length };
  const problems = [];
  if (skinning && (skinning.vertices > SKINNING.vertices || skinning.bones > SKINNING.bones)) {
    const crowd = `far characters must pose less often: call crowd(characters, camera) from @homie-rocks/studio/animate every frame (and lighter characters, or fewer, for the rest)`;
    if (players >= SKINNING.crowdFrom) problems.push(`a room of ${players} skins about ${skinning.vertices.toLocaleString('en-US')} vertices and poses ${skinning.bones.toLocaleString('en-US')} bones a frame on a phone (budget ${SKINNING.vertices.toLocaleString('en-US')} and ${SKINNING.bones.toLocaleString('en-US')}): ${crowd}`);
    else problems.push(`a room of ${players} skins about ${skinning.vertices.toLocaleString('en-US')} vertices and poses ${skinning.bones.toLocaleString('en-US')} bones a frame (budget ${SKINNING.vertices.toLocaleString('en-US')} and ${SKINNING.bones.toLocaleString('en-US')}): a lighter character (assets optimise --triangles), or ${crowd}`);
  }
  if (totals.drawCalls > s.drawCalls) problems.push(`the recorded assets alone add up to about ${totals.drawCalls} draw calls (the phone budget is ${s.drawCalls}): instance repeated props (placements with instanced: true), or fewer materials`);
  if (totals.triangles > s.triangles) problems.push(`the recorded assets alone add up to about ${totals.triangles.toLocaleString('en-US')} triangles (the phone budget is ${s.triangles.toLocaleString('en-US')})`);
  if (totals.textureMB > s.textureMB) problems.push(`about ${totals.textureMB} MB of picture memory in the recorded assets (the phone budget is ${s.textureMB} MB; an iPhone page dies near 100 MB)`);
  if (payloadMB !== null && payloadMB > s.shippedPayloadMB) problems.push(`${payloadMB} MB of shipped payload: every file of the last build, gzipped (the budget is ${s.shippedPayloadMB} MB). It is what the game ships, not what a browser fetched before the first round: files the code never loads and music that streams are in it. Remove what is unused; the playtest measures the real first play`);
  for (const l of licence.filter((x) => x.level === 'refuse')) problems.push(`${l.asset}: ${l.problem}${l.fix ? ` (${l.fix})` : ''}`);
  for (const f of bigFiles) problems.push(`${f.path} is ${(f.bytes / 1024 / 1024).toFixed(1)} MB in git: big files go to the studio's R2 (homie-studio storage add, then media move), raw files to art/<slug>/raw/ (git-ignored)`);
  const notes = [];
  if (undeclaredMapBytes) notes.push(`${(undeclaredMapBytes / 1024 / 1024).toFixed(1)} MB of the picture memory is normal and roughness maps. They are counted, because nothing says otherwise. If the game draws these models with base colour only (stylize() with a toon, flat, pixel or hand-painted material model keeps nothing else), say so and they leave the sum: "inGame": { "maps": "base" } on a record, or at the top of assets/manifest.json for every model`);
  if (unused.length) notes.push(`${unused.join(', ')}: marked unused, so left out of the scene sums. Still in the shipped payload until removed (homie-studio assets remove ${id} <asset>)`);
  const declared = gameBudgets(game);
  if (declared) notes.push(`game.json assets.budgets raises a model's budget to ${[declared.triangles ? `${declared.triangles.toLocaleString('en-US')} triangles` : null, declared.bytes ? `${kb(declared.bytes)} KB` : null, declared.texturePx ? `${declared.texturePx} px pictures` : null, declared.tiers ? `its own numbers for ${Object.keys(declared.tiers).join(', ')}` : null].filter(Boolean).join(', ')} (never past a hard cap)`);
  const ok = rows.every((r) => r.ok) && problems.length === 0;
  const estimate = { kind: 'inventory', basis: 'the recorded files\' own triangles, draw calls and pictures, each times its declared placements; nothing was run', unmeasured: [...UNMEASURED_AT_RUNTIME], measure: 'the playtest and perf guides measure the running game (draw calls, triangles and frame time on a real page)' };
  const result = { ok, command: 'assets check', scope: 'inventory-estimate', game: id, rows, totals, estimate, skinning, budgets: { ...s, skinning: SKINNING, pictures: PICTURES, game: declared, tiers: Object.fromEntries(TIERS.map((t) => [t, budgets[t]])) }, licence, stale, unrecorded, unrecordedPictures: unrecordedPics, bigFiles, shippedPayload, firstPlay: shippedPayload, notes, problems, at: new Date().toISOString() };
  if (write) {
    const dir = join(root, '.studio', 'art', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'check.json'), `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

/** A clip library's row: its file there and recorded, its size and sample rate against SKINNING, what it holds. */
async function clipRow(gdir, a, tools) {
  const problems = []; const warnings = [];
  const f = (a.files ?? []).find((x) => x.role === 'clip');
  let measured = null;
  if (!f) problems.push('no clip library file recorded');
  else if (!existsSync(join(gdir, f.path))) problems.push(`${f.path} is missing`);
  else {
    const bytes = readFileSync(join(gdir, f.path));
    const safe = checkGlb(bytes, LIMITS.game);
    if (!safe.ok) problems.push(...safe.problems.map((p) => `unsafe: ${p}`));
    const k = Math.round(bytes.byteLength / 1024);
    if (k > SKINNING.clipHardKB) problems.push(`${k} KB of clips (at most ${SKINNING.clipHardKB} KB): fewer verbs, or resample`);
    else if (k > SKINNING.clipKB) warnings.push(`${k} KB of clips (the budget is ${SKINNING.clipKB} KB a skeleton)`);
    if (f.sha256 && tools && tools.sha256(bytes) !== f.sha256) warnings.push('the file changed since it was recorded (its SHA-256 differs)');
    if (safe.ok && tools) {
      const ins = await tools.inspectModel(bytes, { limits: LIMITS.game }).catch(() => null);
      const m = ins?.measured;
      if (m) {
        measured = { clips: m.clips.length, verbs: m.clips, kb: k, rate: m.clipRate, seconds: m.clipSeconds, keys: m.clipKeys };
        if (m.clipRate > SKINNING.clipRate + 0.5) warnings.push(`sampled at about ${m.clipRate} keys a second (30 is plenty: homie-studio anim add bakes at 30)`);
        if (!m.clips.length) problems.push('it holds no clips');
      }
    }
  }
  return { id: a.id, kind: 'clip', tier: 'clip', route: a.route, usage: null, counted: false, ok: problems.length === 0, problems, warnings, measured: measured ? { tris: 0, drawCalls: 0, materials: 0, maxTexturePx: 0, textureKB: 0, bones: 0, heightM: null, kb: measured.kb, clips: measured.clips, verbs: measured.verbs, rate: measured.rate } : null, budget: { kb: SKINNING.clipKB }, placements: 1 };
}

/** The check in lines a person reads. */
export function checkLines(r) {
  const lines = [`${r.ok ? 'PASS' : 'NOT YET'}: ${r.game}'s ${r.totals.assets} asset${r.totals.assets === 1 ? '' : 's'} against the phone budgets (an inventory estimate from the recorded files; the running game was not measured)`];
  for (const row of r.rows) {
    const m = row.measured;
    if (row.kind === 'clip') { lines.push(`  ${row.ok ? 'ok  ' : 'FIX '} ${row.id} (clip library, ${row.route})${m ? `: ${m.clips} clips (${(m.verbs ?? []).join(', ')}), ${m.kb} KB, ${m.rate} keys a second` : ''}`); for (const p of row.problems) lines.push(`        ${p}`); for (const w of row.warnings) lines.push(`        note: ${w}`); continue; }
    // A row with nothing measured never reads "ok": it says what it could not see.
    const mark = !row.ok ? 'FIX ' : row.unmeasured ? '??  ' : 'ok  ';
    const what = `${row.kind}, ${row.tier}, ${row.route}${row.counted === false ? ', unused' : ''}`;
    const pics = m?.pictures?.length && !m.tris ? `: ${m.pictures.map((p) => `${p.px[0]} x ${p.px[1]} px`).join(', ')}, ${(m.textureKB / 1024).toFixed(1)} MB of picture memory with mipmaps, ${m.kb} KB` : null;
    lines.push(`  ${mark} ${row.id} (${what})${pics ?? (m ? `: ${m.tris} triangles, ${m.drawCalls} draw${m.drawCalls === 1 ? '' : 's'}, ${m.kb} KB, ${m.maxTexturePx ? `${m.maxTexturePx} px pictures` : 'no pictures'}${m.heightM ? `, ${m.heightM} m` : ''}${m.bones ? `, ${m.bones} bones` : ''}` : row.unmeasured ? `: not measured (${row.unmeasured})` : '')}`);
    for (const p of row.problems) lines.push(`        ${p}`);
    for (const w of row.warnings) lines.push(`        note: ${w}`);
  }
  for (const u of r.unrecorded) lines.push(`  FIX  ${u}: shipped with no record (homie-studio assets add ${r.game} --file ${u} --license <kind>)`);
  const up = r.unrecordedPictures;
  if (up?.shipped?.length) {
    lines.push(`  note ${up.shipped.length + (up.more ?? 0)} shipped picture${up.shipped.length + (up.more ?? 0) === 1 ? '' : 's'} with no record (about ${up.mipmappedMB} MB with mipmaps if the game loads them as textures; NOT in the sums below, and their hash and licence are unchecked):`);
    for (const p of up.shipped.slice(0, 8)) lines.push(`        ${p.path}${p.px ? ` (${p.px[0]} x ${p.px[1]} px)` : ` (${p.why})`}`);
    if (up.shipped.length > 8 || up.more) lines.push(`        and ${up.shipped.length - 8 + (up.more ?? 0)} more. Record the ones the game draws in assets/manifest.json (kind texture or sky, with a licence and SHA-256)`);
  }
  if (up?.notShipped?.length) lines.push(`  note ${up.notShipped.length} picture${up.notShipped.length === 1 ? '' : 's'} in the game's folder that the build never ships (raw or private art: not checked, not counted): ${up.notShipped.slice(0, 4).join(', ')}${up.notShipped.length > 4 ? ', …' : ''}`);
  const s = r.budgets;
  const payload = r.totals.shippedPayloadMB ?? r.totals.firstPlayMB ?? null;
  lines.push(`  inventory estimate: about ${r.totals.drawCalls} draw calls (budget ${s.drawCalls}), ${r.totals.triangles.toLocaleString('en-US')} triangles (${s.triangles.toLocaleString('en-US')}), ${r.totals.textureMB} MB of picture memory (${s.textureMB} MB)${r.totals.standaloneTextureMB ? `, ${r.totals.standaloneTextureMB} MB of it standalone textures and skies` : ''}`);
  lines.push(payload !== null ? `  shipped payload: ${payload} MB, every file of the last build gzipped (${s.shippedPayloadMB ?? s.firstPlayMB} MB); not a measured first-play download` : '  shipped payload: build first');
  if (r.estimate?.unmeasured?.length) lines.push(`  not measured here: ${r.estimate.unmeasured.join('; ')}. ${r.estimate.measure[0].toUpperCase()}${r.estimate.measure.slice(1)}.`);
  if (r.skinning) lines.push(`  skinning: a room of ${r.skinning.players} skins about ${r.skinning.vertices.toLocaleString('en-US')} vertices (budget ${r.skinning.budget.vertices.toLocaleString('en-US')}) and poses ${r.skinning.bones.toLocaleString('en-US')} bones (${r.skinning.budget.bones.toLocaleString('en-US')}) a frame on a phone; the heaviest is ${r.skinning.character}`);
  for (const n of r.notes ?? []) lines.push(`  note ${n}`);
  for (const l of r.licence) lines.push(`  ${l.level === 'refuse' ? 'FIX ' : 'note'} licence ${l.asset}: ${l.problem}${l.fix ? ` (${l.fix})` : ''}`);
  for (const st of r.stale) lines.push(`  stale ${st.id}: made under an older ${st.decisions.map((d) => d.id).join(', ')} (homie-studio style blast shows the cost; nothing is remade by itself)`);
  for (const p of r.problems.filter((x) => !/^[a-z0-9-]+: /.test(x))) lines.push(`  FIX  ${p}`);
  return lines;
}
