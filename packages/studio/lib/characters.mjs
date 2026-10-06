/**
 * CHARACTERS AND THEIR CLIPS IN A GAME (free, on this computer): a rigged character comes in from the starter library,
 * the person's files or a provider, and leaves as two files a phone can afford:
 *
 *   public/models/<asset>.glb       the character: its joints renamed to the skeleton standard (lib/rig.mjs), helper
 *                                   bones that move nothing removed, every part and every held thing it keeps merged
 *                                   into one skinned mesh (one draw call), phone-sized, no clips
 *   public/anims/<skeleton>.glb     the clip library of its skeleton: one clip per verb the game uses (idle, run, jump,
 *                                   attack, hit, die, ...), its own where it has them, else RETARGETED from a source
 *                                   (KayKit's CC0 humanoid clips by default) at build time; every character with that
 *                                   skeleton shares it
 *
 * Both are recorded in assets/manifest.json (the character, kind character or creature; the library, kind clip) with
 * where every clip came from and its licence, so RIGHTS.md and `assets check` see them. The model
 * names its clip library in its scene's extras (homie.anims), so the game's `loadCharacter(models, url)` finds it.
 *
 *   addCharacter(root, game, { item | file, ... })   in, optimised, clips baked, recorded
 *   bakeClips(root, game, asset, { verbs, from })     more verbs for a character's skeleton (retargeted from a source)
 *   animPlan(root, game)                              each character: its skeleton, its clips against the verbs the game
 *                                                     needs (anim.clips), what is missing and where it would come from
 *   animPreview(root, game, { asset, verbs })         looping previews: each verb as a small animated WebP, and a sheet
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { readManifest, recordAsset, writeManifest } from './asset-manifest.mjs';
import { VERBS, VERB_IDS, bakeLibrary, findClip, gaitOf, rigOf, writeLibrary } from './clips.mjs';
import { readDecisions } from './decisions.mjs';
import { FAMILIES, normaliseRig, skeletonOf, socketBone } from './rig.mjs';
import { GAME_ID } from './studio.mjs';

/** Where humanoid clips come from when a character has none of its own: KayKit's adventurers (CC0, 76 clips). */
export const CLIP_SOURCES = Object.freeze({
  humanoid: 'kaykit-adventurers/knight',
  mini: 'kaykit-adventurers/knight',
});
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const kb = (n) => Math.round(n / 1024);

/** The game's verbs: its anim.clips decision (words mapped to VERBS), always idle, plus any asked for. */
export function verbsFor(doc, extra = []) {
  const want = [...(doc?.decisions?.['anim.clips']?.value ?? ['idle', 'run', 'jump', 'attack', 'hit']), ...extra];
  const alias = { 'pick-up': 'pickup', pick: 'pickup', kick: 'attack2', aim: 'shoot', boost: 'run', crash: 'hit', walk: 'walk', swing: 'attack', punch: 'attack', bump: 'attack', cheer: 'emote', wave: 'emote', dance: 'emote', victory: 'win' };
  const out = new Set(['idle']);
  for (const w of want) { const v = alias[w] ?? w; if (VERB_IDS.includes(v)) out.add(v); }
  return [...out];
}

/** The model tools, once. */
async function tools() { const { modelTools } = await import('./optimise.mjs'); return modelTools(); }

/** A Document from bytes (or a path resolving its sibling pictures). */
async function docOf(input) {
  const t = await tools();
  const { selfContained } = await import('./optimise.mjs');
  const bytes = await selfContained(input, LIMITS.import);
  const safe = checkGlb(bytes, LIMITS.import);
  if (!safe.ok) throw new Error(`refused: ${safe.problems.slice(0, 3).join('; ')}`);
  const doc = await t.io.readBinary(bytes);
  doc.setLogger(t.logger);
  return { doc, bytes };
}

/** A clip source (a library item id, or a file): its Document renamed to the standard, and its clip names. */
async function clipSource(from, { lib = null, cache = new Map() } = {}) {
  if (cache.has(from)) return cache.get(from);
  let bytes; let pack = null;
  if (existsSync(resolve(String(from)))) bytes = readFileSync(resolve(String(from)));
  else {
    const { fetchItemFile, libraryBase, loadIndex } = await import('./library.mjs');
    const L = lib ?? libraryBase();
    const { index } = await loadIndex({ lib: L });
    const item = index.items.find((x) => x.id === from);
    if (!item) throw new Error(`no library item "${from}" to take clips from`);
    if (item.license !== 'cc0') throw new Error(`${from} is not CC0`);
    ({ bytes } = await fetchItemFile(L, item));
    // Whose clips these are, kept with the clip library: the credit for them must not depend on a model of the same
    // pack being in the game (a generated hero borrows the knight's clips and never has a knight).
    const p = index.packs?.find((x) => x.id === item.pack);
    pack = { id: item.pack, label: p?.label ?? item.pack, author: item.author ?? null, url: p?.url ?? item.origin ?? null };
  }
  const { doc } = await docOf(bytes);
  normaliseRig(doc, { merge: false, helpers: false, takeClips: false });
  const src = { from: String(from), pack, doc, rig: rigOf(doc), names: doc.getRoot().listAnimations().map((a) => a.getName()) };
  cache.set(from, src);
  return src;
}

/**
 * The clips for `verbs` on `target` (a rig): the character's own where it has one, else from `fallback` (retargeted).
 * Returns { sources: [{ rig, anim, verb, from }], missing: [verb] }.
 */
async function pickSources(own, verbs, fallback, opts) {
  const sources = []; const missing = [];
  let fb = null;
  for (const verb of verbs) {
    const mine = own ? findClip(own.names, verb) : null;
    if (mine) { sources.push({ rig: own.rig, anim: own.doc.getRoot().listAnimations().find((a) => a.getName() === mine), verb, from: own.from }); continue; }
    if (fallback && !fb) { try { fb = await clipSource(fallback, opts); } catch (error) { fb = { error: error.message }; } }
    const theirs = fb && !fb.error ? findClip(fb.names, verb) : null;
    if (theirs) sources.push({ rig: fb.rig, anim: fb.doc.getRoot().listAnimations().find((a) => a.getName() === theirs), verb, from: fb.from });
    else missing.push(verb);
  }
  return { sources, missing, fallbackError: fb?.error ?? null, packs: [own?.pack, fb?.pack].filter(Boolean) };
}

/** A clip library file's path in a game, for a skeleton. */
export const animsPath = (skeleton) => `public/anims/${skeleton}.glb`;

/** Read a clip library already in the game (its verbs), or null. */
async function existingLibrary(gdir, skeleton) {
  const file = join(gdir, animsPath(skeleton));
  if (!existsSync(file)) return null;
  const t = await tools();
  const doc = await t.io.readBinary(readFileSync(file));
  doc.setLogger(t.logger);
  return { doc, verbs: doc.getRoot().listAnimations().map((a) => a.getName()) };
}

/** Copy the animations of `from` (a baked library Document) into `into` (an existing one), by node name. */
function appendClips(into, from) {
  const root = into.getRoot();
  const buffer = root.listBuffers()[0] ?? into.createBuffer();
  const nodes = new Map(root.listNodes().map((n) => [n.getName(), n]));
  for (const a of from.getRoot().listAnimations()) {
    for (const old of root.listAnimations().filter((x) => x.getName() === a.getName())) old.dispose();
    const b = into.createAnimation(a.getName()).setExtras(a.getExtras());
    for (const ch of a.listChannels()) {
      const node = nodes.get(ch.getTargetNode()?.getName());
      if (!node) continue;
      const s = ch.getSampler();
      const sampler = into.createAnimationSampler()
        .setInput(into.createAccessor().setType('SCALAR').setArray(s.getInput().getArray().slice()).setBuffer(buffer))
        .setOutput(into.createAccessor().setType(s.getOutput().getType()).setArray(s.getOutput().getArray().slice()).setBuffer(buffer))
        .setInterpolation(s.getInterpolation());
      b.addSampler(sampler).addChannel(into.createAnimationChannel().setTargetNode(node).setTargetPath(ch.getTargetPath()).setSampler(sampler));
    }
  }
  const ex = root.getExtras()?.homie ?? {};
  root.setExtras({ homie: { ...ex, verbs: root.listAnimations().map((x) => x.getName()) } });
}

/**
 * Bake (or extend) a skeleton's clip library in a game and record it. `rig`: the normalised character's rig;
 * `own`: its own clips (a clip source) or null. Returns { path, skeleton, verbs, clips, missing, bytes, entry }.
 */
async function bakeFor(root, game, rig, own, verbs, { from = null, lib = null, cache = new Map(), license = null } = {}) {
  const gdir = join(root, 'games', game);
  const skel = rig.skeleton;
  const fallback = from ?? CLIP_SOURCES[skel.family] ?? null;
  const existing = await existingLibrary(gdir, skel.id);
  const todo = verbs.filter((v) => !existing?.verbs.includes(v));
  const { sources, missing, fallbackError, packs: sourcePacks } = await pickSources(own, todo, fallback, { lib, cache });
  const t = await tools();
  const rel = animsPath(skel.id);
  const manifest = readManifest(root, game);
  const entryId = `anims-${skel.id}`.slice(0, 48);
  const prev = manifest.assets.find((a) => a.id === entryId);
  let doc; let clips;
  if (sources.length || !existing) {
    ({ doc, clips } = await bakeLibrary(rig, sources, { core: t.core, logger: t.logger }));
    if (existing) { appendClips(existing.doc, doc); doc = existing.doc; }
  } else { doc = existing.doc; clips = []; }
  if (!sources.length && existing) return { path: rel, skeleton: skel.id, verbs: existing.verbs, clips: prev?.clips ?? [], missing, bytes: null, entry: prev ?? null, fallbackError };
  const out = await writeLibrary(doc, { tools: t });
  mkdirSync(dirname(join(gdir, rel)), { recursive: true });
  writeFileSync(join(gdir, rel), out.bytes);
  const allClips = [...(prev?.clips ?? []).filter((c) => !clips.some((n) => n.verb === c.verb)), ...clips].sort((a, b) => VERB_IDS.indexOf(a.verb) - VERB_IDS.indexOf(b.verb));
  const froms = [...new Set(allClips.map((c) => c.from).filter(Boolean))];
  const knownPacks = { ...(prev?.from?.packs ?? {}) };
  for (const p of sourcePacks ?? []) if (froms.some((f) => String(f).startsWith(`${p.id}/`))) knownPacks[p.id] = { label: p.label, author: p.author, url: p.url };
  // Clips taken from CC0 sources (KayKit, Kenney) stay CC0 when retargeted; a character's own clips carry its licence.
  const lic = license && license.kind !== 'cc0' && allClips.some((c) => c.from && !String(c.from).includes('/')) ? license : { kind: 'cc0', spdx: 'CC0-1.0', owner: null, attribution: null, notes: `Clips from ${froms.join(', ') || 'the character itself'} (CC0), ${allClips.some((c) => c.retargeted) ? 'retargeted onto this skeleton at build time' : 'as they came'}.` };
  const entry = {
    id: entryId, kind: 'clip', tier: 'clip', route: allClips.every((c) => !c.from || String(c.from).includes('/')) ? 'library' : 'imported',
    card: null,
    // `packs`: each source pack's name, author and page, kept across every later bake (and written by `assets remove`
    // when a pack's last model leaves), so credits.json can credit the animation for as long as the clips stay.
    from: froms.length ? { library: 'homie-starter', items: froms, ...(Object.keys(knownPacks).length ? { packs: knownPacks } : {}) } : null,
    files: [{ role: 'clip', path: rel, bytes: out.bytes.length, sha256: sha256(out.bytes) }],
    rig: { family: skel.family, skeleton: skel.id, fingerprint: skel.fingerprint },
    clips: allClips,
    measured: { clips: out.clips, keys: out.keys, kb: kb(out.bytes.length), fps: 30, verbs: allClips.map((c) => c.verb) },
    license: lic,
    made: { steps: [{ what: 'clips', tool: 'lib/clips.mjs (retarget and bake)', verbs: allClips.map((c) => `${c.verb}<${c.source}${c.retargeted ? ' (retargeted)' : ''}`) }] },
    review: { state: 'auto' },
  };
  const { entry: e } = recordAsset(root, game, entry);
  return { path: rel, skeleton: skel.id, verbs: allClips.map((c) => c.verb), clips: allClips, missing, bytes: out.bytes.length, entry: e, fallbackError };
}

/**
 * One rigged (or node-animated) character into a game. Options:
 *   item        a starter-library item id (kaykit-adventurers/knight), or
 *   file        a .glb on this computer, with license (own, cc0, cc-by-4.0, generated, ...)
 *   as          the asset id; kind character (default) or creature; card ("Characters/Knight")
 *   height      metres to scale it to (default: the game's cast.scale character height, else the item's suggestion)
 *   keep        the held things to keep (a sword, a shield, a hat: names; part swaps); null keeps them all
 *   verbs       verbs to bake besides the game's anim.clips
 *   clipsFrom   where clips it lacks come from (a library item or a file); default by its skeleton family
 *   texture     largest picture side (default 512: a character is a hundred pixels tall on a phone)
 *   triangles   budget (default: the tier's, a hero 8,000)
 *   route, steps, raw, concept, owner, attribution, notes: for a generated or imported file (as importModel takes)
 * Returns { ok, asset, model, anims, skeleton, verbs, missing, before, after, merged, dropped, removedHelpers }.
 */
export async function addCharacter(root, game, opts = {}) {
  if (!GAME_ID.test(String(game ?? ''))) throw new Error(`"${game}" is not a game id`);
  const gdir = join(root, 'games', game);
  if (!existsSync(join(gdir, 'game.json')) && !existsSync(join(gdir, 'CODEX.md'))) throw new Error(`no game "${game}"`);
  const t = await tools();
  const { optimiseModel, measureDoc } = await import('./optimise.mjs');
  const decisions = readDecisions(root, game);
  let bytes; let item = null; let idx = null; let lib = opts.lib ?? null;
  if (opts.item) {
    const L = await import('./library.mjs');
    lib = lib ?? L.libraryBase();
    idx = opts.index ?? (await L.loadIndex({ lib })).index;
    item = idx.items.find((x) => x.id === opts.item) ?? idx.items.find((x) => x.item === opts.item);
    if (!item) throw new Error(`no library item "${opts.item}" (assets find "<words>" --kind character lists them)`);
    if (item.license !== 'cc0') throw new Error(`${item.id} is not CC0; the starter library holds only CC0`);
    ({ bytes } = await L.fetchItemFile(lib, item));
  } else if (opts.file) {
    const { screenImport } = await import('./asset-import.mjs');
    screenImport(resolve(root, String(opts.file)));
    bytes = (await docOf(resolve(root, String(opts.file)))).bytes;
  } else throw new Error('a library item or a file');
  const id = String(opts.as ?? item?.item ?? 'character').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const kind = opts.kind === 'creature' || item?.kind === 'creature' ? 'creature' : 'character';
  const cache = new Map();

  // Its own clips, renamed to the standard (a separate copy: the model itself loses them).
  const ownDoc = (await docOf(bytes)).doc;
  const raw = skeletonOf(ownDoc);
  if (raw.family === 'none') throw new Error(`${item?.id ?? opts.file} has no skeleton and no moving parts: add it as a prop (assets add without a rig), or rig it first (the animate guide)`);
  normaliseRig(ownDoc, { merge: false, helpers: false, takeClips: false });
  const ownPack = item ? { id: item.pack, label: idx?.packs?.find((p) => p.id === item.pack)?.label ?? item.pack, author: item.author ?? null, url: idx?.packs?.find((p) => p.id === item.pack)?.url ?? item.origin ?? null } : null;
  const own = ownDoc.getRoot().listAnimations().length ? { from: item?.id ?? 'own', pack: ownPack, doc: ownDoc, rig: rigOf(ownDoc), names: ownDoc.getRoot().listAnimations().map((a) => a.getName()) } : null;

  // The character as shipped: renamed, helpers out, merged, clips out.
  const { doc } = await docOf(bytes);
  const rigged = normaliseRig(doc, { keep: opts.keep ?? null, takeClips: true });
  const rig = rigOf(doc);
  const verbs = verbsFor(decisions, opts.verbs ?? []);
  const anims = await bakeFor(root, game, rig, own, verbs, { from: opts.clipsFrom ?? null, lib, cache, license: opts.license ? { kind: opts.license } : null });

  // The model: phone-sized, its clip library named in its scene's extras.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  scene.setExtras({ ...(scene.getExtras() ?? {}), homie: { kind, skeleton: rig.skeleton.id, family: rig.skeleton.family, anims: `../anims/${rig.skeleton.id}.glb`, sockets: Object.fromEntries(['rightHand', 'leftHand', 'head', 'back'].map((s) => [s, socketBone(rig.nodes.map((n) => n.name), s)]).filter(([, b]) => b)) } });
  const normalised = await t.io.writeBinary(doc);
  const castH = Number(decisions?.decisions?.['cast.scale']?.value?.characterHeightM ?? 0);
  const height = Number(opts.height ?? 0) || castH || Number(item?.suggestM ?? 0) || null;
  const tri = Number(opts.triangles ?? 0) || (kind === 'creature' ? 3000 : 8000);
  const r = await optimiseModel(normalised, { height, triangles: tri, texture: Number(opts.texture ?? 512), rigged: true, metal: false });
  const rel = `public/models/${id}.glb`;
  mkdirSync(dirname(join(gdir, rel)), { recursive: true });
  writeFileSync(join(gdir, rel), r.glb);
  const after = r.after;
  const files = [{ role: 'model', path: rel, bytes: r.bytes, sha256: r.sha256 }];
  if (opts.rawPath) files.push({ role: 'raw', path: opts.rawPath, public: false });
  if (opts.concept) files.push({ role: 'concept', path: String(opts.concept).startsWith('../') ? String(opts.concept) : `../../${String(opts.concept).replace(/^\.\//, '')}`, public: false });
  const steps = [
    ...(item ? [{ what: 'library', item: item.id, sha256: item.files?.[0]?.sha256 ?? null }] : []),
    ...(opts.steps ?? []),
    { what: 'rig', tool: 'lib/rig.mjs', family: rig.skeleton.family, skeleton: rig.skeleton.id, renamed: rigged.renamed, removedHelpers: rigged.removedHelpers.length, merged: rigged.merged, dropped: rigged.dropped },
    { what: 'clips', anims: anims.path, verbs: anims.verbs },
    { what: 'optimise', tool: r.tool, ops: r.ops },
  ];
  const license = item
    ? { kind: 'cc0', spdx: 'CC0-1.0', owner: item.author ?? null, attribution: null, notes: `From the Homie starter library (${item.pack}); the pack's own licence text: ${idx?.packs?.find((p) => p.id === item.pack)?.licenseFile ?? 'licenses/'}` }
    : { kind: String(opts.license ?? ''), owner: opts.owner ?? (opts.license === 'generated' || opts.license === 'own' ? 'studio' : null), attribution: opts.attribution ?? null, notes: opts.notes ?? (opts.license === 'generated' ? 'Made through fal on the studio\'s own account (a concept image, then Meshy image-to-3D with its auto-rig); its clips are the starter library\'s CC0 clips retargeted onto its skeleton. fal\'s terms do not assign output ownership expressly (RIGHTS.md).' : null) };
  const entry = {
    id, kind, tier: kind === 'creature' ? 'npc' : 'hero', card: opts.card ?? null, route: item ? 'library' : (opts.route === 'generated' ? 'generated' : 'imported'),
    ...(item ? { from: { library: 'homie-starter', version: idx?.version ?? 'v0', pack: item.pack, packLabel: idx?.packs?.find((p) => p.id === item.pack)?.label ?? item.pack, packUrl: idx?.packs?.find((p) => p.id === item.pack)?.url ?? null, item: item.id, author: item.author ?? null, origin: item.origin ?? null, sha256: item.files?.[0]?.sha256 ?? null, paletteSwap: Boolean(item.paletteSwap) } } : {}),
    files,
    rig: { family: rig.skeleton.family, skeleton: rig.skeleton.id, fingerprint: rig.skeleton.fingerprint, skinned: rig.skeleton.skinned, bones: after.bones || rig.skeleton.bones, deform: rig.skeleton.deform, influences: rig.skeleton.influences, anims: anims.path, verbs: anims.verbs, keep: rigged.kept, dropped: rigged.dropped },
    measured: { tris: after.triangles, materials: after.materials, drawCalls: after.drawCalls, textures: after.textures.map((x) => ({ px: x.px, format: x.mimeType, gpuKB: Math.round(x.gpuBytes / 1024) })), bones: after.bones, clips: anims.verbs.length, heightM: after.heightM, box: after.box, glbKB: kb(r.bytes), animsKB: anims.bytes ? kb(anims.bytes) : null },
    license,
    made: { steps },
    review: { state: 'auto' },
  };
  const { entry: e, pinned } = recordAsset(root, game, entry);
  const gait = await recordGait(root, game, e.id).catch(() => null);
  return { ok: true, command: 'assets add', game, asset: e.id, gait, item: item?.id ?? null, route: e.route, raw: opts.rawPath ?? null, license: e.license.kind, model: rel, anims: anims.path, skeleton: rig.skeleton.id, family: rig.skeleton.family, verbs: anims.verbs, missing: anims.missing, clipsFrom: anims.clips.filter((c) => c.retargeted).map((c) => c.from).filter((v, i, a) => a.indexOf(v) === i), merged: rigged.merged, dropped: rigged.dropped, removedHelpers: rigged.removedHelpers.length, before: { tris: r.before.triangles, kb: kb(r.rawBytes), drawCalls: r.before.drawCalls }, after: { tris: after.triangles, kb: kb(r.bytes), heightM: after.heightM, drawCalls: after.drawCalls, bones: after.bones, animsKB: anims.bytes ? kb(anims.bytes) : null }, pinned, warnings: r.warnings, fallbackError: anims.fallbackError };
}

/** Whether a library item is a character with a rig or moving parts (assets add sends those here). */
export const isAnimated = (item) => Boolean(item && (item.rigged || (item.clips ?? []).length >= 1) && ['character', 'creature'].includes(item.kind));

/**
 * More verbs for a character already in the game: baked into its skeleton's clip library, retargeted from `from`
 * (a library item or a file; default: its family's clip source). Returns the bake's result.
 */
export async function bakeClips(root, game, asset, { verbs = [], from = null, lib = null } = {}) {
  const m = readManifest(root, game);
  const a = m.assets.find((x) => x.id === asset);
  if (!a?.rig) throw new Error(`${asset} is not a rigged character in ${game} (assets add brings one in)`);
  const t = await tools();
  const model = a.files.find((f) => f.role === 'model');
  const doc = await t.io.readBinary(readFileSync(join(root, 'games', game, model.path)));
  doc.setLogger(t.logger);
  const rig = rigOf(doc);
  if (rig.skeleton.id !== a.rig.skeleton) rig.skeleton.id = a.rig.skeleton;
  const want = verbs.filter((v) => VERB_IDS.includes(v));
  if (!want.length) throw new Error(`which verbs? ${VERB_IDS.join(', ')}`);
  let own = null;
  if (a.from?.item && !from) { try { own = await clipSource(a.from.item, { lib }); } catch { own = null; } }
  const r = await bakeFor(root, game, rig, own, want, { from, lib });
  // The character's own record learns its verbs.
  const fresh = readManifest(root, game);
  const me = fresh.assets.find((x) => x.id === asset);
  if (me?.rig) { me.rig.verbs = r.verbs; me.measured = { ...(me.measured ?? {}), clips: r.verbs.length }; writeManifest(root, game, fresh); }
  const gait = await recordGait(root, game, asset).catch(() => null);
  return { ok: true, command: 'anim add', game, asset, gait, skeleton: r.skeleton, anims: r.path, verbs: r.verbs, added: want.filter((v) => r.verbs.includes(v)), missing: r.missing, kb: r.bytes ? kb(r.bytes) : null, why: r.fallbackError };
}

const clipFile = (x) => (x?.files ?? []).find((f) => f.role === 'clip')?.path ?? null;
const clipVerbs = (x) => x?.clips?.map((c) => c.verb) ?? x?.measured?.verbs ?? [];

/**
 * A character's clip libraries, from the manifest: { primary, supplemental, verbs, files, clips }.
 *
 *   primary        the clip record whose file the MODEL names (rig.anims), which is what the game loads. Only when no
 *                  record has that file: the first library of its skeleton that is not declared supplemental.
 *   supplemental   libraries of the same skeleton that say so ("rig": { "supplemental": true }): more verbs beside the
 *                  base, which the game loads itself (loadCharacter(models, url, { anims: [base, extra] })).
 *
 * It used to be "the last clip record read for that skeleton": a second library of three verbs then stood in for the
 * first, every original verb read as missing and the previews drew nothing. A second library that is neither named by
 * the model nor declared is not in anyone's coverage (duplicateLibraries names it).
 */
export function librariesFor(manifest, a) {
  const all = manifest.assets.filter((x) => x.kind === 'clip' && x.rig?.skeleton && x.rig.skeleton === a?.rig?.skeleton);
  const primary = all.find((x) => a.rig?.anims && clipFile(x) === a.rig.anims) ?? all.find((x) => x.rig?.supplemental !== true) ?? null;
  const supplemental = all.filter((x) => x !== primary && x.rig?.supplemental === true);
  const clips = [...(primary?.clips ?? []), ...supplemental.flatMap((x) => (x.clips ?? []).filter((c) => !(primary?.clips ?? []).some((p) => p.verb === c.verb)))];
  const verbs = [...new Set([...(primary?.clips ? clipVerbs(primary) : a?.rig?.verbs ?? clipVerbs(primary)), ...supplemental.flatMap(clipVerbs)])];
  return { primary, supplemental, verbs, clips, files: [a?.rig?.anims ?? clipFile(primary), ...supplemental.map(clipFile)].filter(Boolean) };
}

/**
 * Clip records that are a SECOND library of a skeleton without saying what they are: Map(asset id -> what to do).
 * `recordAsset` refuses one at registration; a manifest edited by hand can still hold one, and the check says so.
 */
export function duplicateLibraries(manifest) {
  const out = new Map();
  const named = new Set(manifest.assets.map((a) => a.rig?.anims).filter(Boolean));
  const bySkeleton = new Map();
  for (const x of manifest.assets) if (x.kind === 'clip' && x.rig?.skeleton && x.rig.supplemental !== true) bySkeleton.set(x.rig.skeleton, [...(bySkeleton.get(x.rig.skeleton) ?? []), x]);
  for (const [skeleton, list] of bySkeleton) {
    if (list.length < 2) continue;
    const keep = list.find((x) => named.has(clipFile(x))) ?? list.find((x) => clipFile(x) === animsPath(skeleton)) ?? list[0];
    for (const x of list) if (x !== keep) out.set(x.id, `a second clip library for the skeleton ${skeleton} (its characters name ${keep.id}'s file): these verbs are in no character's coverage and no preview. Merge them into ${keep.id} (homie-studio anim add <game> <character> --verbs ${clipVerbs(x).join(',') || '…'} --from <this file>), or declare it ("rig": { "supplemental": true }) and load it in the game: loadCharacter(models, url, { anims: [<base>, <this>] })`);
  }
  return out;
}

/** A looping locomotion verb's default ground speed in animate (assets/animate.ts ANIM_TUNING), to compare a rig's against. */
const DEFAULT_SPEED = { walk: 1.5, run: 4.2 };

/**
 * How fast a character's walk and run clips move its feet over the ground, measured on ITS rig (the shipped model,
 * so in metres) from its clip libraries: { walk, run: { mps, seconds, default, feet }, method, note } or null when
 * neither could be read. A heuristic (lib/clips.mjs gaitOf), cheap enough to run on every bake.
 */
export async function measureGait(root, game, assetId) {
  const m = readManifest(root, game);
  const a = m.assets.find((x) => x.id === assetId);
  const model = (a?.files ?? []).find((f) => f.role === 'model');
  if (!a?.rig || !model) return null;
  const gdir = join(root, 'games', game);
  const t = await tools();
  const read = async (rel) => { const d = await t.io.readBinary(readFileSync(join(gdir, rel))); d.setLogger(t.logger); return d; };
  const rig = rigOf(await read(model.path));
  const anims = [];
  for (const f of librariesFor(m, a).files) if (existsSync(join(gdir, f))) for (const x of (await read(f)).getRoot().listAnimations()) if (!anims.some((y) => y.getName() === x.getName())) anims.push(x);
  const out = {};
  for (const verb of ['walk', 'run']) {
    const anim = anims.find((x) => x.getName() === verb);
    const g = anim ? gaitOf(rig, anim) : null;
    if (g) out[verb] = { mps: g.mps, seconds: g.seconds, feet: g.feet, default: DEFAULT_SPEED[verb] };
  }
  if (!Object.keys(out).length) return null;
  return { ...out, method: 'foot bones while down (lowest quarter of each foot\'s height), horizontal speed, averaged', note: 'a guide to start tuning walkSpeed and runSpeed from on this rig; not a verified foot contact' };
}

/** measureGait, kept on the character's own record (`rig.gait`): the same clips move a taller rig's feet further. */
export async function recordGait(root, game, assetId) {
  const gait = await measureGait(root, game, assetId);
  const m = readManifest(root, game);
  const a = m.assets.find((x) => x.id === assetId);
  if (!a?.rig) return gait;
  if (JSON.stringify(a.rig.gait ?? null) === JSON.stringify(gait)) return gait;
  if (gait) a.rig.gait = gait; else delete a.rig.gait;
  writeManifest(root, game, m);
  return gait;
}

/** Each character, its skeleton and its clips against the verbs the game needs. */
export function animPlan(root, game) {
  const m = readManifest(root, game);
  const doc = readDecisions(root, game);
  const need = verbsFor(doc);
  const rows = m.assets.filter((a) => (a.kind === 'character' || a.kind === 'creature') && a.rig).map((a) => {
    const libs = librariesFor(m, a);
    const L = libs.primary ? { ...libs.primary, clips: libs.clips } : null;
    const have = libs.verbs;
    return {
      id: a.id, kind: a.kind, route: a.route, family: a.rig.family, familyLabel: FAMILIES[a.rig.family]?.label ?? a.rig.family, skeleton: a.rig.skeleton, bones: a.rig.bones, anims: a.rig.anims,
      // Every library file its clips are in (its own first, then any declared supplemental), and its measured gait.
      libraries: libs.files, supplemental: libs.supplemental.map((x) => x.id), gait: a.rig.gait ?? null,
      clips: need.map((v) => { const c = L?.clips?.find((x) => x.verb === v); return { verb: v, note: VERBS[v]?.note ?? '', loop: Boolean(VERBS[v]?.loop), have: have.includes(v), source: c?.source ?? null, from: c?.from ?? null, retargeted: Boolean(c?.retargeted), seconds: c?.duration ?? null }; }),
      extra: have.filter((v) => !need.includes(v)),
      missing: need.filter((v) => !have.includes(v)),
      animsKB: libs.primary?.measured?.kb ?? null,
    };
  });
  const unrigged = m.assets.filter((a) => (a.kind === 'character' || a.kind === 'creature') && !a.rig).map((a) => a.id);
  const d = doc?.decisions ?? {};
  return {
    ok: true, command: 'anim plan', game, verbs: need, rows, unrigged,
    decisions: Object.fromEntries(['anim.style', 'anim.clips', 'anim.source', 'anim.motion', 'anim.blend', 'anim.procedural', 'rig.skeleton', 'rig.source', 'rig.bones', 'game.feel'].map((k) => [k, d[k] ? { label: d[k].label, state: d[k].state } : null])),
    lab: existsSync(join(root, 'games', game, 'lab.json')) ? JSON.parse(readFileSync(join(root, 'games', game, 'lab.json'), 'utf8')) : null,
  };
}

/**
 * Looping previews: each character's verbs as small animated WebP files (and one sheet a person can read), under the
 * game's light, in .studio/art/<game>/anim/. Free; one headless Chrome. Returns { rows: [{ id, verbs: [{ verb, file,
 * frames, seconds }], sheet }] }.
 */
export async function animPreview(root, game, { asset = null, verbs = null, size = 144, count = 12, log = () => {} } = {}) {
  const plan = animPlan(root, game);
  const rows = plan.rows.filter((r) => !asset || r.id === asset);
  if (!rows.length) return { ok: false, command: 'anim preview', game, why: asset ? `${asset} is not a rigged character in ${game}` : `${game} has no rigged characters yet (assets add <game> <character item>)` };
  const m = readManifest(root, game);
  const gdir = join(root, 'games', game);
  let tokens = null;
  try { tokens = JSON.parse(readFileSync(join(gdir, 'style.json'), 'utf8')); } catch { tokens = null; }
  tokens = tokens?.palette ? tokens : { palette: { bg: '#e9eef2', ink: '#1d2b3a', accent: '#ff8a5b', accent2: '#5cbf8a', danger: '#e2553f', good: '#45b36b', gold: '#ffd25a' } };
  const dir = join(root, '.studio', 'art', game, 'anim');
  mkdirSync(dir, { recursive: true });
  const { withRenderer, modelIn, dataUrlBytes } = await import('./render3d.mjs');
  let sharp = null;
  try { sharp = (await import('sharp')).default; } catch { sharp = null; }
  const out = [];
  await withRenderer(async (r) => {
    for (const row of rows) {
      const a = m.assets.find((x) => x.id === row.id);
      const model = readFileSync(join(gdir, a.files.find((f) => f.role === 'model').path));
      const animsFile = join(gdir, row.anims);
      if (!existsSync(animsFile)) { out.push({ id: row.id, verbs: [], why: `${row.anims} is missing` }); continue; }
      const want = verbs ?? row.clips.filter((c) => c.have).map((c) => c.verb).concat(row.extra);
      // Its own library, then every declared supplemental one that is on disk: all of them are in the preview.
      const libraries = [row.anims, ...(row.libraries ?? []).filter((f) => f !== row.anims)].filter((f) => existsSync(join(gdir, f)));
      const res = await r.frames(modelIn(row.id, model, { anims: libraries.map((f) => readFileSync(join(gdir, f)).toString('base64')) }), tokens, { verbs: want, count, size, sheet: true, loops: want.filter((v) => VERBS[v]?.loop) });
      const files = [];
      for (const v of res.verbs) {
        const file = join(dir, `${row.id}-${v.verb}.webp`);
        if (sharp) {
          const frames = v.frames.map((f) => dataUrlBytes(f).bytes);
          // One animated WebP a verb: the frames at the clip's own pace, looping.
          const delay = Math.max(40, Math.round((v.duration * 1000) / Math.max(1, frames.length)));
          await sharp(frames, { join: { animated: true } }).webp({ quality: 70, loop: 0, delay: frames.map(() => delay), effort: 4 }).toFile(file);
        } else writeFileSync(file.replace(/\.webp$/, '.png'), dataUrlBytes(v.frames[0]).bytes);
        files.push({ verb: v.verb, file: file.slice(root.length + 1), frames: v.frames.length, seconds: v.duration });
      }
      let sheet = null;
      if (res.sheet) { sheet = join(dir, `${row.id}-sheet.jpg`); writeFileSync(sheet, dataUrlBytes(res.sheet).bytes); sheet = sheet.slice(root.length + 1); }
      // The ground speed its walk and run cover on this rig, measured again here and kept on its record.
      const gait = await recordGait(root, game, row.id).catch(() => null);
      out.push({ id: row.id, verbs: files, sheet, missing: res.missing, libraries, gait });
      log(`${row.id}: ${files.length} preview(s)`);
    }
  }, { log });
  const result = { ok: true, command: 'anim preview', game, rows: out, at: new Date().toISOString() };
  writeFileSync(join(dir, 'previews.json'), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
