/**
 * A MODEL FILE INTO A GAME: the person's own (imported), or one a provider generated on their account (the models
 * skill's image-to-3D). `homie-studio assets add <id> --file <model> --license <kind>`.
 *
 * The file is checked first (assets/safety.mjs, the import limits: a self-contained GLB, or a .glb/.gltf whose
 * pictures sit beside it; no address anywhere in it; nothing over 64 MB, no buffer declaring more), then made
 * phone-sized (lib/optimise.mjs: its tier's triangles and picture size, pivot at the bottom centre, scaled to its card's
 * height), written to games/<id>/public/models/<asset>.glb, and recorded with its licence and every step that made it
 * (lib/asset-manifest.mjs). The raw file is kept beside its art job in art/<slug>/raw/ (git-ignored; the studio's R2 by
 * `media move` once it has storage): it is never shipped and never committed.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { LIMITS, checkGlb } from '../assets/safety.mjs';
import { ASSET_ID, KINDS, licenseInfo, readManifest, recordAsset } from './asset-manifest.mjs';
import { readDecisions } from './decisions.mjs';
import { budgetsFor, gameJson } from './asset-check.mjs';

const TIER_OF_KIND = { character: 'hero', creature: 'npc', prop: 'prop', kit: 'kit', environment: 'kit' };

/** Refuse what must never come in, before anything reads it as a model: the safety rules at the import limits. */
export function screenImport(path) {
  if (!existsSync(path)) throw new Error(`no file at ${path}`);
  const size = statSync(path).size;
  if (size > LIMITS.import.bytes) throw new Error(`refused ${basename(path)}: ${Math.round(size / 1024 / 1024)} MB is over the ${LIMITS.import.bytes / 1024 / 1024} MB a model may be when it comes in`);
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 4).toString('latin1') === 'glTF') {
    const safe = checkGlb(bytes, LIMITS.import);
    // A pack's .glb may name pictures that sit beside it ("Textures/colormap.png"): the optimiser reads those from the
    // file's own folder. Anything with a scheme (http:, file:), an absolute path or ".." is an external URI: refused.
    const sibling = (p) => { const m = /is loaded from an address \(([^)]*)\)/.exec(p); return Boolean(m) && !/^[a-z][a-z0-9+.-]*:|^\/|(^|[\\/])\.\.([\\/]|$)/i.test(m[1]); };
    const hard = safe.problems.filter((p) => !sibling(p));
    if (hard.length) throw new Error(`refused ${basename(path)}: ${hard.slice(0, 4).join('; ')}`);
    return { bytes: size, glb: true };
  }
  if (/\.gltf$/i.test(path)) {
    let json;
    try { json = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`refused ${basename(path)}: not JSON`); }
    for (const x of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      const u = String(x?.uri ?? '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(u) && !/^data:/i.test(u)) throw new Error(`refused ${basename(path)}: it loads ${u.slice(0, 60)} from an address (an external URI)`);
      if (u.split(/[\\/]/).includes('..')) throw new Error(`refused ${basename(path)}: it reaches outside its folder (${u.slice(0, 60)})`);
    }
    for (const b of json.buffers ?? []) if (Number(b?.byteLength) > LIMITS.import.buffer) throw new Error(`refused ${basename(path)}: a buffer declares ${Math.round(Number(b.byteLength) / 1024 / 1024)} MB`);
    return { bytes: size, glb: false };
  }
  if (/\.(fbx|obj|blend|dae|stl|usdz?)$/i.test(path)) throw new Error(`${basename(path)} is not glTF: export it as .glb (Blender: File > Export > glTF 2.0, binary), then add that`);
  throw new Error(`refused ${basename(path)}: not a glTF file (.glb or .gltf)`);
}

/**
 * Import one file. Options: as (asset id), kind, tier, card ("Items/Lantern"), height (m), triangles, texture (px),
 * license (kind), attribution, owner, notes, route ('imported' or 'generated'), steps (the made.steps before optimising:
 * the concept and mesh calls with their receipts and prices), slug (the art job's folder).
 */
export async function importModel(root, id, file, opts = {}) {
  const gdir = join(root, 'games', id);
  if (!existsSync(join(gdir, 'game.json')) && !existsSync(join(gdir, 'CODEX.md'))) throw new Error(`no game "${id}"`);
  const path = resolve(root, file);
  const route = opts.route === 'generated' ? 'generated' : 'imported';
  const licKind = opts.license ?? (route === 'generated' ? 'generated' : null);
  const info = licenseInfo(licKind);
  if (!info) throw new Error('say whose it is and under what licence: --license own (the person made it), cc0, cc-by-4.0 (with --attribution), eula:<store>, market:<listing> or other (with --notes)');
  if (info.attribution && !opts.attribution) throw new Error(`${info.label} needs credit: --attribution "<who made it, where it is from>"`);
  screenImport(path);
  const kind = KINDS.includes(opts.kind) ? opts.kind : 'prop';
  const asId = String(opts.as ?? basename(path).replace(/\.(glb|gltf)$/i, '')).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  if (!ASSET_ID.test(asId)) throw new Error('give it an id: --as <lowercase-id>');
  const tier = opts.tier ?? TIER_OF_KIND[kind] ?? 'prop';
  const doc = readDecisions(root, id);
  // The game's own per-model budget (game.json assets.budgets) counts here too: a file is made as small as the game
  // asks, not smaller.
  const budgets = budgetsFor(doc, gameJson(root, id));
  const b = budgets[tier] ?? budgets.prop;
  // The raw file stays on this computer, beside its art job (git-ignored), unless it is there already.
  const slug = String(opts.slug ?? asId);
  const rawDir = join(root, 'art', slug, 'raw');
  let rawPath = path;
  if (!path.startsWith(`${resolve(root, 'art')}/`)) {
    mkdirSync(rawDir, { recursive: true });
    rawPath = join(rawDir, basename(path));
    if (resolve(rawPath) !== path) copyFileSync(path, rawPath);
  }
  const { optimiseModel, inspectModel } = await import('./optimise.mjs');
  const out = join(gdir, 'public', 'models', `${asId}.glb`);
  const r = await optimiseModel(path, { out, triangles: Number(opts.triangles ?? b.triangles), texture: Number(opts.texture ?? b.texturePx), height: opts.height ? Number(opts.height) : null, rigged: Boolean(opts.rigged), metal: doc?.decisions?.['style.render']?.value === 'pbr', ...(opts.lo ? { lo: { ratio: Number(opts.lo) } } : {}) });
  if (!r.ok) throw new Error(`the optimised file is still refused: ${r.warnings.join('; ')}`);
  const ins = await inspectModel(out);
  const rel = relative(gdir, out).split('\\').join('/');
  const steps = [...(Array.isArray(opts.steps) ? opts.steps : []), { what: 'optimise', tool: r.tool, ops: r.ops, from: { bytes: r.rawBytes, sha256: r.rawSha256 } }];
  const entry = {
    id: asId, kind, tier, card: opts.card ?? null, route,
    ...(opts.height ? { heightM: Number(opts.height) } : {}),
    files: [
      { role: 'model', path: rel, bytes: r.bytes, sha256: r.sha256 },
      // The low copy for the far band (`--lo <ratio>`; lib/optimise.mjs): recorded beside the model with the ratio it
      // was made at, so `assets redo` makes it again and a check knows the file is this asset's.
      ...(r.lo ? [{ role: 'model-lo', path: relative(gdir, r.lo.path).split('\\').join('/'), bytes: r.lo.bytes, sha256: r.lo.sha256, tris: r.lo.triangles, ratio: r.lo.ratio }] : []),
      ...(opts.concept ? [{ role: 'concept', path: relative(gdir, resolve(root, opts.concept)).split('\\').join('/'), public: false }] : []),
      { role: 'raw', path: relative(gdir, rawPath).split('\\').join('/'), public: false, bytes: r.rawBytes, sha256: r.rawSha256 },
    ],
    made: { steps, ...(opts.under ? { under: opts.under } : {}) },
    license: { kind: info.kind, spdx: info.spdx, owner: opts.owner ?? (route === 'generated' || licKind === 'own' ? 'studio' : null), attribution: opts.attribution ?? null, ...(route === 'generated' ? { terms: [{ who: 'fal', url: 'https://fal.ai/terms', read: '2026-10-02', label: 'Commercial use' }], notes: 'Made through fal on the studio\'s own account; fal\'s terms do not assign output ownership expressly (RIGHTS.md).' } : opts.notes ? { notes: opts.notes } : {}) },
    measured: { tris: r.after.triangles, materials: r.after.materials, drawCalls: r.after.drawCalls, textures: r.after.textures.map((t) => ({ px: t.px, format: t.mimeType, gpuKB: Math.round(t.gpuBytes / 1024) })), bones: r.after.bones, clips: r.after.clips.length, heightM: r.after.heightM, box: r.after.box, glbKB: Math.round(r.bytes / 1024), flat: r.ops.some((o) => o.startsWith('palette')) && !r.after.textures.some((t) => t.slots?.includes('normalTexture')) },
    review: { state: 'auto' },
  };
  const { entry: e, pinned } = recordAsset(root, id, entry);
  return { ok: true, command: 'assets add', game: id, asset: e.id, route, file: rel, ...(opts.lo ? { lo: r.lo ? { path: relative(gdir, r.lo.path).split('\\').join('/'), triangles: r.lo.triangles, bytes: r.lo.bytes, sha256: r.lo.sha256 } : null } : {}), raw: relative(root, rawPath), before: { tris: r.before.triangles, kb: Math.round(r.rawBytes / 1024) }, after: { tris: r.after.triangles, kb: Math.round(r.bytes / 1024), heightM: r.after.heightM }, ops: r.ops, warnings: [...r.warnings, ...(ins.validator?.errors ? [`validator: ${ins.validator.messages[0]}`] : [])], pinned, license: info.label };
}


/**
 * MADE AGAIN FROM ITS RAW FILE, FREE: `homie-studio assets redo <id> <asset>`. The kept raw file (art/<slug>/raw/) is
 * checked against its recorded SHA-256 and optimised again under the game's budgets and render style now; the entry
 * keeps its route, licence, receipts and concept. Only the free steps run again, so the decisions a paid step baked
 * in (palette, shape, render) stay as they were recorded: an asset stale on those is still stale (a new concept and
 * mesh fix it); one stale only on its budgets is not.
 */
export async function redoModel(root, id, assetId) {
  const gdir = join(root, 'games', id);
  const e = readManifest(root, id).assets.find((a) => a.id === assetId);
  if (!e) throw new Error(`no asset "${assetId}" in games/${id}/assets/manifest.json`);
  const raw = (e.files ?? []).find((f) => f.role === 'raw');
  if (!raw) throw new Error(`${assetId} kept no raw file (${e.route === 'library' ? 'a library item: assets add it again' : 'add the file again'})`);
  const rawPath = resolve(gdir, raw.path);
  if (!rawPath.startsWith(`${resolve(root, 'art')}/`) || !existsSync(rawPath)) throw new Error(`the raw file ${raw.path} is not on this computer`);
  const { createHash } = await import('node:crypto');
  if (raw.sha256 && createHash('sha256').update(readFileSync(rawPath)).digest('hex') !== raw.sha256) throw new Error(`${raw.path} is not the file ${assetId} was made from (its SHA-256 differs)`);
  const doc = readDecisions(root, id);
  const under = { ...(e.made?.under ?? {}) };
  for (const d of ['cast.tiers', 'style.render']) if (d in under && doc?.decisions?.[d]) under[d] = doc.decisions[d].rev;
  const concept = (e.files ?? []).find((f) => f.role === 'concept');
  const slug = relative(join(root, 'art'), rawPath).split(/[\\/]/)[0];
  const r = await importModel(root, id, rawPath, {
    as: e.id, kind: e.kind, tier: e.tier, card: e.card, height: e.heightM ?? null, route: e.route,
    license: e.license?.kind, attribution: e.license?.attribution ?? undefined, owner: e.license?.owner ?? undefined, notes: e.license?.notes,
    steps: (e.made?.steps ?? []).filter((s) => s.what !== 'optimise'), concept: concept ? relative(root, resolve(gdir, concept.path)) : undefined,
    slug, rigged: Number(e.measured?.bones) > 0 || Number(e.measured?.clips) > 0, under,
    lo: (e.files ?? []).find((f) => f.role === 'model-lo')?.ratio ?? null,
  });
  return { ...r, command: 'assets redo' };
}
