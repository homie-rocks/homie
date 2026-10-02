/**
 * MAKING A MODEL PHONE-SIZED, AND MEASURING IT (free, on this computer).
 *
 *   optimiseModel(input, { out, triangles, texture, height })   a raw .glb (a provider's, a pack's, the person's own)
 *       becomes one shipped .glb: flat colours into one palette picture, one draw call where it can, the pivot at the
 *       bottom centre, scaled to its size in metres, welded and simplified to its triangle budget (meshoptimizer),
 *       pictures resized and re-encoded as WebP (sharp), meshopt geometry, nothing unused. Raw files are never
 *       changed; the result says what each step did, before and after.
 *   inspectModel(input)                       triangles, vertices, draw calls, materials, pictures and their GPU memory,
 *       bones and clips, the bounding box in metres, the Khronos glTF-Validator's errors, and the file's own safety
 *       check (assets/safety.mjs).
 *   albedoOf(input)                           the model's dominant surface colours (k-means over its base-colour
 *       pictures and flat colours, weighted by how much of it they cover): the palette-drift check reads them.
 *
 * The tools are @gltf-transform (MIT), meshoptimizer (MIT), the Khronos glTF-Validator (Apache-2.0) and sharp
 * (Apache-2.0), all dependencies of @homie-rocks/studio, loaded only when a model command runs. Draco and KTX2 inputs
 * are refused here (ask for a plain .glb); KTX2 output needs KTX-Software's toktx and is not offered in phase 1: WebP
 * is the house default.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LIMITS, checkGlb, readGlb } from '../assets/safety.mjs';
import { dominant } from './colour.mjs';

let tools = null;

/** The glTF toolchain, loaded once: { core, ext, fn, mo, sharp, io, validator }. */
export async function modelTools() {
  if (tools) return tools;
  let core; let ext; let fn; let mo;
  try {
    [core, ext, fn, mo] = await Promise.all([import('@gltf-transform/core'), import('@gltf-transform/extensions'), import('@gltf-transform/functions'), import('meshoptimizer')]);
  } catch (error) {
    throw new Error(`the model tools are not installed here (${error.message.split('\n')[0]}): run npm install in the studio, then this again`);
  }
  await Promise.all([mo.MeshoptEncoder.ready, mo.MeshoptDecoder.ready, mo.MeshoptSimplifier.ready]);
  let sharp = null;
  try { sharp = (await import('sharp')).default; } catch { sharp = null; }
  let validator = null;
  try { const v = await import('gltf-validator'); validator = v.default ?? v; } catch { validator = null; }
  // Quiet: the steps report what they did in the result, never on the console.
  const logger = new core.Logger(core.Logger.Verbosity.ERROR);
  const io = new core.NodeIO().setLogger(logger).registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': mo.MeshoptDecoder, 'meshopt.encoder': mo.MeshoptEncoder });
  tools = { core, ext, fn, mo, sharp, io, validator, logger };
  return tools;
}

const bytesOf = (input) => (input instanceof Uint8Array ? input : readFileSync(input));

/**
 * A model on disk whose pictures or buffers sit beside it (a pack's .glb naming "Textures/colormap.png", a .gltf
 * with its .bin): its relative files are read from its own folder only (never "..", never an address, each within
 * the import cap), and the result is one self-contained GLB. Anything else is refused as an external URI.
 */
async function readLocal(path, limits) {
  const { io } = await modelTools();
  const raw = readFileSync(path);
  let json;
  if (raw.subarray(0, 4).toString('latin1') === 'glTF') json = readGlb(raw, { maxJson: limits.json }).json;
  else { try { json = JSON.parse(raw.toString('utf8')); } catch { throw new Error('not a glTF file (.glb or .gltf)'); } }
  const dir = dirname(resolve(path));
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])].map((x) => x?.uri).filter((u) => typeof u === 'string' && !/^data:/i.test(u));
  let total = raw.byteLength;
  for (const u of uris) {
    const rel = decodeURIComponent(u);
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith('/') || rel.split(/[\\/]/).includes('..')) throw new Error(`refused: it loads ${u.slice(0, 60)} from an address or outside its folder (an external URI)`);
    const abs = resolve(dir, rel);
    if (!existsSync(abs)) throw new Error(`it names ${rel}, which is not beside it`);
    total += statSync(abs).size;
    if (total > limits.bytes) throw new Error(`it and its files are over ${Math.round(limits.bytes / 1024 / 1024)} MB`);
  }
  const doc = await io.read(path);
  const { fn, logger } = await modelTools();
  doc.setLogger(logger);
  await doc.transform(fn.unpartition());
  const bytes = await io.writeBinary(doc);
  const safe = checkGlb(bytes, limits);
  if (!safe.ok) throw new Error(`refused: ${safe.problems.slice(0, 4).join('; ')}`);
  return { doc, safe, bytes };
}

/** Bytes of a model from a path (resolving its own sibling files) or from bytes: a self-contained GLB. */
export async function selfContained(input, limits = LIMITS.import) {
  if (input instanceof Uint8Array) return input;
  const bytes = readFileSync(input);
  if (checkGlb(bytes, limits).ok) return bytes;
  return (await readLocal(input, limits)).bytes;
}
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const round = (n, d = 3) => +Number(n).toFixed(d);

/** A Document from bytes, refusing what this pipeline cannot read (Draco, KTX2) in plain words. */
async function readDoc(bytes, limits = LIMITS.import) {
  const safe = checkGlb(bytes, limits);
  if (!safe.ok) throw new Error(`refused: ${safe.problems.slice(0, 4).join('; ')}`);
  const req = safe.info.extensions.required;
  if (req.includes('KHR_draco_mesh_compression')) throw new Error('Draco-compressed geometry: export it again as a plain .glb (meshopt is applied here)');
  if (req.includes('KHR_texture_basisu')) throw new Error('KTX2 pictures: export it again with PNG, JPEG or WebP pictures');
  const { io } = await modelTools();
  const doc = await io.readBinary(bytes);
  doc.setLogger(tools.logger);
  return { doc, safe };
}

/** Counts and sizes of a Document (what `assets check` holds against the budgets). */
export async function measureDoc(doc) {
  const { fn } = await modelTools();
  const root = doc.getRoot();
  let triangles = 0; let vertices = 0; let drawCalls = 0;
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const seenMaterials = new Set();
  if (scene) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      const inst = node.getExtension('EXT_mesh_gpu_instancing');
      const n = inst ? (inst.listAttributes()[0]?.getCount() ?? 1) : 1;
      for (const prim of mesh.listPrimitives()) {
        const idx = prim.getIndices();
        const pos = prim.getAttribute('POSITION');
        const c = idx ? idx.getCount() : (pos?.getCount() ?? 0);
        const mode = prim.getMode();
        triangles += (mode === 4 ? Math.floor(c / 3) : mode === 5 || mode === 6 ? Math.max(0, c - 2) : 0) * n;
        vertices += (pos?.getCount() ?? 0) * n;
        drawCalls += inst ? 1 : n;
        if (prim.getMaterial()) seenMaterials.add(prim.getMaterial());
      }
    });
  }
  const textures = root.listTextures().map((t) => {
    const px = t.getSize();
    const slots = fn.listTextureSlots(t);
    return { name: t.getName() || t.getURI() || '', mimeType: t.getMimeType(), px: px ? [px[0], px[1]] : null, bytes: t.getImage()?.byteLength ?? 0, gpuBytes: px ? Math.round(px[0] * px[1] * 4 * (4 / 3)) : 0, slots };
  });
  let box = null;
  if (scene) {
    const b = fn.getBounds(scene);
    if (Number.isFinite(b.min[0]) && Number.isFinite(b.max[0])) box = { min: b.min.map((v) => round(v)), max: b.max.map((v) => round(v)), size: b.max.map((v, i) => round(v - b.min[i])) };
  }
  const skins = root.listSkins();
  return {
    triangles, vertices, drawCalls,
    materials: seenMaterials.size,
    textures,
    textureGpuBytes: textures.reduce((s, t) => s + t.gpuBytes, 0),
    maxTexturePx: textures.reduce((m, t) => Math.max(m, ...(t.px ?? [0])), 0),
    bones: skins.reduce((m, s) => Math.max(m, s.listJoints().length), 0),
    skins: skins.length,
    clips: root.listAnimations().map((a) => a.getName() || 'clip'),
    box,
    heightM: box ? box.size[1] : null,
    // Where the pivot is: the bottom centre is (0, min.y = 0, 0) with the footprint around x = z = 0.
    pivot: box ? { bottom: Math.abs(box.min[1]) < 0.01 * Math.max(0.01, box.size[1]), centred: Math.abs((box.min[0] + box.max[0]) / 2) < 0.05 * Math.max(0.01, box.size[0]) && Math.abs((box.min[2] + box.max[2]) / 2) < 0.05 * Math.max(0.01, box.size[2]) } : null,
  };
}

/** The Khronos glTF-Validator's verdict: { errors, warnings, messages: [first few] } (null when it is not installed). */
export async function validateModel(bytes) {
  const { validator } = await modelTools();
  if (!validator?.validateBytes) return null;
  try {
    const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50, externalResourceFunction: (uri) => Promise.reject(new Error(`external resource ${uri} refused`)) });
    const msgs = (report.issues?.messages ?? []).filter((m) => m.severity <= 1).slice(0, 8).map((m) => `${m.severity === 0 ? 'error' : 'warning'} ${m.code}${m.pointer ? ` at ${m.pointer}` : ''}: ${m.message}`);
    return { errors: report.issues?.numErrors ?? 0, warnings: report.issues?.numWarnings ?? 0, messages: msgs };
  } catch (error) { return { errors: 1, warnings: 0, messages: [`the validator could not read it: ${error.message}`] }; }
}

/** inspectModel(path | bytes): the safety check, the validator and the measurements of one .glb. */
export async function inspectModel(input, { limits = LIMITS.game, resolveLocal = false } = {}) {
  const bytes = resolveLocal ? await selfContained(input, LIMITS.import) : bytesOf(input);
  const safe = checkGlb(bytes, limits);
  const base = { bytes: bytes.byteLength, sha256: sha256(bytes), safe };
  if (!safe.ok) return { ...base, ok: false, measured: null, validator: null };
  let doc;
  try { ({ doc } = await readDoc(bytes, LIMITS.import)); } catch (error) { return { ...base, ok: false, measured: null, validator: null, why: error.message }; }
  const measured = await measureDoc(doc);
  const validator = await validateModel(bytes);
  return { ...base, ok: !validator || validator.errors === 0, measured, validator };
}

/**
 * The dominant colours of a model's surface: [{ hex, share }]. Each triangle (up to 4,000, spread evenly) counts by its
 * area in metres: its colour is its material's base colour times the base-colour picture at the triangle's middle
 * (its UVs), so unused corners of a texture atlas never count.
 */
export async function albedoOf(input, { k = 5 } = {}) {
  const bytes = await selfContained(input, LIMITS.import);
  const { doc } = await readDoc(bytes, LIMITS.import);
  const { sharp } = await modelTools();
  const pictures = new Map();
  const pictureOf = async (tex) => {
    if (!tex || !sharp) return null;
    if (pictures.has(tex)) return pictures.get(tex);
    let pic = null;
    try { const r = await sharp(Buffer.from(tex.getImage())).resize(256, 256, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true }); pic = { w: r.info.width, h: r.info.height, data: r.data }; } catch { pic = null; }
    pictures.set(tex, pic);
    return pic;
  };
  const samples = [];
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  const prims = [];
  scene?.traverse((node) => { const mesh = node.getMesh(); if (mesh) for (const p of mesh.listPrimitives()) if (p.getMode() === 4) prims.push({ p, m: node.getWorldMatrix() }); });
  const totalTris = prims.reduce((n, { p }) => n + Math.floor((p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0) / 3), 0) || 1;
  const step = Math.max(1, Math.floor(totalTris / 4000));
  for (const { p, m } of prims) {
    const mat = p.getMaterial();
    const f = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    const pic = await pictureOf(mat?.getBaseColorTexture());
    const pos = p.getAttribute('POSITION'); const uv = p.getAttribute('TEXCOORD_0'); const idx = p.getIndices();
    if (!pos) continue;
    const n = Math.floor((idx ? idx.getCount() : pos.getCount()) / 3);
    const at = (i) => (idx ? idx.getScalar(i) : i);
    const a = [0, 0, 0]; const b = [0, 0, 0]; const c = [0, 0, 0];
    for (let t = 0; t < n; t += step) {
      const i0 = at(t * 3); const i1 = at(t * 3 + 1); const i2 = at(t * 3 + 2);
      pos.getElement(i0, a); pos.getElement(i1, b); pos.getElement(i2, c);
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2]; const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      const scale = Math.cbrt(Math.abs(m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]))) || 1;
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) * scale * scale;
      if (!(area > 0)) continue;
      let rgb = [f[0], f[1], f[2]].map((v) => linearToSrgb255(v));
      if (pic && uv) {
        const t0 = uv.getElement(i0, []); const t1 = uv.getElement(i1, []); const t2 = uv.getElement(i2, []);
        const u = (t0[0] + t1[0] + t2[0]) / 3; const v = (t0[1] + t1[1] + t2[1]) / 3;
        const x = Math.min(pic.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * pic.w))); const y = Math.min(pic.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * pic.h)));
        const o = (y * pic.w + x) * 3;
        rgb = [pic.data[o], pic.data[o + 1], pic.data[o + 2]].map((tx, ch) => linearToSrgb255(srgbToLinear01(tx) * f[ch]));
      }
      samples.push({ rgb, w: area * step });
    }
  }
  return dominant(samples, k);
}
const srgbToLinear01 = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const linearToSrgb255 = (v) => { const c = Math.max(0, Math.min(1, v)); return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); };

/**
 * One raw model into one shipped model. Options:
 *   out        where to write the .glb (else only the bytes come back)
 *   triangles  the triangle budget (a prop 1,500; a signature prop 5,000; a hero 8,000); 0: keep them
 *   texture    the largest picture side in pixels (512 for a prop, 1,024 for a hero)
 *   height     the asset's height in metres (it is scaled to it); null keeps its size
 *   quality    WebP quality for colour pictures (normal maps get more)
 *   rigged     keep the node tree and every primitive apart (skins and clips), even when it has none
 *   metal      keep metalness (a `pbr` game that lights with a reflection map); otherwise every material is drawn
 *              non-metal, because metal with nothing to reflect is black on a phone (a provider's textured prop
 *              usually says metallic 1 and leaves the rest to its texture)
 * Returns { ok, glb (the bytes), bytes (their count), sha256, out, before, after, ops, warnings }.
 */
export async function optimiseModel(input, { out = null, triangles = 1500, texture = 512, height = null, quality = 82, rigged = false, metal = false, log = () => {} } = {}) {
  const t = await modelTools();
  const { fn, mo, sharp, io } = t;
  const raw = await selfContained(input, LIMITS.import);
  const { doc } = await readDoc(raw, LIMITS.import);
  const before = await measureDoc(doc);
  const ops = [];
  const warnings = [];
  const hasRig = rigged || before.skins > 0 || before.clips.length > 0;

  await doc.transform(fn.dedup(), fn.prune());
  // Metal draws black without a reflection map, and a phone game has none: a flat colour exported as fully rough metal
  // (common in packs) is always plastic; with `metal` false (every style but pbr) so is everything else.
  let unmetal = 0;
  for (const m of doc.getRoot().listMaterials()) {
    const roughFlat = m.getMetallicFactor() >= 0.9 && m.getRoughnessFactor() >= 0.9 && !m.getMetallicRoughnessTexture();
    if (m.getMetallicFactor() > 0 && (roughFlat || !metal)) { m.setMetallicFactor(0); unmetal += 1; }
  }
  if (unmetal) ops.push(`metal -> 0 on ${unmetal} material${unmetal === 1 ? '' : 's'} (nothing to reflect on a phone)`);
  // Flat colours into one small palette picture, then one draw call per material where nothing moves on its own.
  if (!hasRig) {
    const flats = doc.getRoot().listMaterials().filter((m) => !m.getBaseColorTexture()).length;
    if (flats >= 2) { await doc.transform(fn.palette({ min: 2 })); ops.push(`palette (${flats} flat colours into one picture)`); }
    await doc.transform(fn.flatten(), fn.join());
    ops.push('flatten, join');
  }
  await doc.transform(fn.weld());
  ops.push('weld');

  // Scale to the card's height, then the pivot to the bottom centre (+Y up).
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (height && before.heightM) {
    const s = height / before.heightM;
    if (Math.abs(s - 1) > 0.001) {
      const wrap = doc.createNode('homie-scale').setScale([s, s, s]);
      for (const child of scene.listChildren()) { scene.removeChild(child); wrap.addChild(child); }
      scene.addChild(wrap);
      if (!hasRig) await doc.transform(fn.flatten());
      ops.push(`scale ${round(s, 4)} (to ${height} m)`);
    }
  }
  await doc.transform(fn.center({ pivot: 'below' }));
  ops.push('center bottom');

  // Simplify to the triangle budget, loosening the error until it fits (a closed silhouette first).
  let now = (await measureDoc(doc)).triangles;
  if (triangles > 0 && now > triangles) {
    for (const error of [0.002, 0.006, 0.015, 0.03, 0.06, 0.12]) {
      now = (await measureDoc(doc)).triangles;
      if (now <= triangles) break;
      const ratio = Math.max(0.005, Math.min(1, (triangles / now) * 0.97));
      await doc.transform(fn.simplify({ simplifier: mo.MeshoptSimplifier, ratio, error }));
    }
    now = (await measureDoc(doc)).triangles;
    ops.push(`simplify ${round(now / Math.max(1, before.triangles), 3)} (${before.triangles} to ${now} triangles)`);
    if (now > triangles) warnings.push(`still ${now} triangles after simplifying (its budget is ${triangles}): the shape resists; a lower-poly source, or a looser budget with a reason`);
  }
  if (hasRig) { await doc.transform(fn.resample()); ops.push('resample clips'); }

  // Pictures: no side over `texture`, WebP; normal maps at a higher quality.
  const textured = doc.getRoot().listTextures().length;
  if (textured) {
    if (sharp) {
      // A palette picture (flat colours, a few pixels a colour) is lossless: lossy WebP bleeds one colour into the next.
      await doc.transform(fn.textureCompress({ encoder: sharp, targetFormat: 'webp', lossless: true, pattern: /^Palette/ }));
      await doc.transform(fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texture, texture], quality, pattern: /^(?!Palette)/, slots: /^(?!normalTexture).*$/ }));
      await doc.transform(fn.textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texture, texture], quality: Math.min(95, quality + 10), pattern: /^(?!Palette)/, slots: /^normalTexture$/ }));
      ops.push(`resize ${texture}`, 'webp');
    } else warnings.push('sharp is not installed: the pictures were left as they were (npm install in the studio)');
  }
  if (hasRig) {
    // A skinned model keeps float positions: quantizing would move its scale into the inverse bind matrices, and every
    // measurement of the shipped file (its height, its box) would then be wrong. Meshopt's filters still compress it.
    await doc.transform(fn.prune(), fn.unpartition(), fn.reorder({ encoder: mo.MeshoptEncoder }));
    doc.createExtension(t.ext.EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: t.ext.EXTMeshoptCompression.EncoderMethod.FILTER });
    // The filters store normals and rotations as normalized integers, which glTF allows only with this extension.
    doc.createExtension(t.ext.KHRMeshQuantization).setRequired(true);
  } else await doc.transform(fn.prune(), fn.unpartition(), fn.meshopt({ encoder: mo.MeshoptEncoder, level: 'medium' }));
  ops.push(hasRig ? 'meshopt (filters, float positions)' : 'meshopt', 'prune');

  const after = await measureDoc(doc);
  const bytes = await io.writeBinary(doc);
  const safe = checkGlb(bytes, LIMITS.game);
  if (!safe.ok) warnings.push(...safe.problems.map((p) => `the result: ${p}`));
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, bytes); }
  log(`optimised: ${before.triangles} -> ${after.triangles} triangles, ${Math.round(raw.byteLength / 1024)} -> ${Math.round(bytes.byteLength / 1024)} KB`);
  return { ok: safe.ok, out, glb: bytes, bytes: bytes.byteLength, sha256: sha256(bytes), rawBytes: raw.byteLength, rawSha256: sha256(raw), before, after, ops, warnings, tool: `@gltf-transform/functions ${await toolVersion()}` };
}

let version = null;
async function toolVersion() {
  if (version) return version;
  // The package's exports map hides its package.json: resolve its entry, then read the package.json above it.
  try {
    const { createRequire } = await import('node:module');
    const entry = createRequire(import.meta.url).resolve('@gltf-transform/functions');
    const m = /^(.*[\\/]@gltf-transform[\\/]functions)[\\/]/.exec(entry);
    version = JSON.parse(readFileSync(`${m[1]}/package.json`, 'utf8')).version;
  } catch { version = 'unknown'; }
  return version;
}

/**
 * A grey box .glb of `size` metres (x, y, z), its pivot at the bottom centre: what a remix gets in place of an asset
 * it may not carry, and what a refused model is drawn as.
 */
export async function placeholderGlb(size = [0.5, 0.5, 0.5], { name = 'placeholder', colour = [0.54, 0.56, 0.6, 1] } = {}) {
  const { core, io } = await modelTools();
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const [x, y, z] = size.map((v) => Math.max(0.01, Number(v) || 0.5));
  const X = x / 2; const Z = z / 2;
  // 24 vertices (flat normals per face), 12 triangles.
  const faces = [
    [[1, 0, 0], [[X, 0, -Z], [X, y, -Z], [X, y, Z], [X, 0, Z]]], [[-1, 0, 0], [[-X, 0, Z], [-X, y, Z], [-X, y, -Z], [-X, 0, -Z]]],
    [[0, 1, 0], [[-X, y, -Z], [-X, y, Z], [X, y, Z], [X, y, -Z]]], [[0, -1, 0], [[-X, 0, Z], [-X, 0, -Z], [X, 0, -Z], [X, 0, Z]]],
    [[0, 0, 1], [[-X, 0, Z], [X, 0, Z], [X, y, Z], [-X, y, Z]]], [[0, 0, -1], [[X, 0, -Z], [-X, 0, -Z], [-X, y, -Z], [X, y, -Z]]],
  ];
  const pos = []; const nor = []; const idx = [];
  faces.forEach(([n, quad], f) => { for (const p of quad) { pos.push(...p); nor.push(...n); } const b = f * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); });
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(idx)).setBuffer(buffer))
    .setMaterial(doc.createMaterial(name).setBaseColorFactor(colour).setRoughnessFactor(0.9).setMetallicFactor(0));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  doc.createScene(name).addChild(doc.createNode(name).setMesh(mesh));
  return io.writeBinary(doc);
}

