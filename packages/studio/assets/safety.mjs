/**
 * IS THIS MODEL FILE SAFE TO LOAD? One answer for every place a model enters a game: the browser loader
 * (assets/assets.ts, before three.js parses a byte), `homie-studio assets add` and `assets check` (Node), and the
 * starter library's build. Plain JavaScript with no imports, so a browser bundle and Node read the same rules.
 *
 * A model is a glTF 2.0 binary (.glb): a 12-byte header, a JSON chunk and one binary chunk. It is refused when:
 *   - it is not a GLB (a bare .gltf names its buffers and pictures by address: that is an external file);
 *   - any buffer or picture names a `uri` other than a small `data:` one (an external URI could be fetched from
 *     anywhere, at any size, by every player's browser);
 *   - the file, its declared buffers, a buffer view or an accessor is bigger than the limits (a 200 MB buffer would
 *     take a phone's whole page memory before anything checked it), or an accessor reaches past its buffer;
 *   - it requires an extension three.js cannot read, or names more meshes, nodes, pictures or animations than any
 *     game asset needs.
 * Warnings (extensions used but not required, a picture type a phone may not decode) never refuse.
 */

/** The limits, in bytes and counts: `LIMITS.game` for a shipped asset, `LIMITS.import` for a raw file coming in. */
export const LIMITS = Object.freeze({
  game: Object.freeze({ bytes: 5 * 1024 * 1024, json: 2 * 1024 * 1024, buffer: 5 * 1024 * 1024, dataUri: 256 * 1024, vertices: 500_000, meshes: 512, nodes: 4096, materials: 64, images: 32, textures: 64, animations: 256, skins: 16, accessors: 8192 }),
  import: Object.freeze({ bytes: 64 * 1024 * 1024, json: 8 * 1024 * 1024, buffer: 64 * 1024 * 1024, dataUri: 1024 * 1024, vertices: 4_000_000, meshes: 4096, nodes: 16384, materials: 256, images: 128, textures: 256, animations: 1024, skins: 64, accessors: 32768 }),
});

/** Extensions three.js's GLTFLoader reads (r185). A file that REQUIRES any other is refused. */
export const READABLE_EXTENSIONS = Object.freeze([
  'KHR_meshopt_compression', 'EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_basisu', 'EXT_texture_webp',
  'EXT_texture_avif', 'KHR_texture_transform', 'KHR_materials_unlit', 'KHR_materials_emissive_strength', 'KHR_materials_clearcoat',
  'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_volume', 'KHR_materials_sheen',
  'KHR_materials_iridescence', 'KHR_materials_anisotropy', 'KHR_materials_dispersion', 'KHR_lights_punctual', 'EXT_mesh_gpu_instancing',
  'KHR_draco_mesh_compression',
]);

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/ktx2', 'image/avif'];
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

/** The bytes a `data:` URI decodes to, without decoding it. */
function dataUriBytes(uri) {
  const comma = uri.indexOf(',');
  if (comma < 0) return Infinity;
  const head = uri.slice(5, comma);
  const body = uri.length - comma - 1;
  return /;base64$/i.test(head) ? Math.floor((body * 3) / 4) : body;
}

/**
 * Read a GLB's header and chunks: { json, bin: { offset, length } | null } or throws a plain-words Error.
 * `bytes` is a Uint8Array (a Node Buffer is one).
 */
export function readGlb(bytes, { maxJson = LIMITS.import.json } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Error('not a file (expected bytes)');
  if (bytes.byteLength < 20) throw new Error('too short to be a glTF binary (.glb)');
  const dv = view(bytes);
  if (dv.getUint32(0, true) !== MAGIC) {
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(64, bytes.byteLength))).trimStart();
    throw new Error(head.startsWith('{') ? 'a .gltf with separate files (its buffers and pictures are loaded by address): only a self-contained .glb is loaded' : 'not a glTF binary (.glb)');
  }
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`glTF version ${version} (only 2 is read)`);
  const length = dv.getUint32(8, true);
  if (length > bytes.byteLength) throw new Error(`the header says ${size(length)} but the file has ${size(bytes.byteLength)}: it is cut short`);
  let at = 12;
  let json = null;
  let bin = null;
  while (at + 8 <= length) {
    const chunkLength = dv.getUint32(at, true);
    const type = dv.getUint32(at + 4, true);
    const start = at + 8;
    if (start + chunkLength > length) throw new Error('a chunk runs past the end of the file');
    if (type === JSON_CHUNK && json === null) {
      if (chunkLength > maxJson) throw new Error(`its JSON is ${size(chunkLength)}, over ${size(maxJson)}`);
      try { json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + chunkLength))); } catch { throw new Error('its JSON chunk is not JSON'); }
    } else if (type === BIN_CHUNK && bin === null) bin = { offset: start, length: chunkLength };
    at = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (!json || typeof json !== 'object') throw new Error('it has no JSON chunk');
  return { json, bin, length };
}

/**
 * Check a GLB against `limits` (LIMITS.game by default). Returns
 *   { ok, problems: [plain words], warnings: [plain words], info: { bytes, triangles, vertices, meshes, nodes,
 *     materials, images, textures, animations, skins, joints, extensions: { used, required } } }
 * Never throws: a file it cannot read is `ok: false` with the reason.
 *
 * The JSDoc types say what the code always took: any limits (numbers, a part of them is enough), and extension names
 * as strings. Without them a strict TypeScript caller read the frozen defaults as literal types and the empty lists
 * as never[].
 * @param {Uint8Array} bytes
 * @param {Partial<Record<keyof typeof LIMITS.game, number>>} [limits]
 */
export function checkGlb(bytes, limits = LIMITS.game) {
  const L = { ...LIMITS.game, ...limits };
  const problems = [];
  const warnings = [];
  const info = { bytes: bytes?.byteLength ?? 0, triangles: 0, vertices: 0, meshes: 0, nodes: 0, materials: 0, images: 0, textures: 0, animations: 0, skins: 0, joints: 0, extensions: { used: /** @type {string[]} */ ([]), required: /** @type {string[]} */ ([]) } };
  if (info.bytes > L.bytes) problems.push(`the file is ${size(info.bytes)}, over the ${size(L.bytes)} a model may be here`);
  let glb;
  try { glb = readGlb(bytes, { maxJson: L.json }); } catch (error) { problems.push(error.message); return { ok: false, problems, warnings, info }; }
  const j = glb.json;
  const arr = (k) => (Array.isArray(j[k]) ? j[k] : []);
  const v = String(j.asset?.version ?? '');
  if (!/^2\./.test(v)) problems.push(`asset.version is "${v || 'missing'}" (glTF 2.x is read)`);

  // Counts.
  const counts = { meshes: arr('meshes').length, nodes: arr('nodes').length, materials: arr('materials').length, images: arr('images').length, textures: arr('textures').length, animations: arr('animations').length, skins: arr('skins').length, accessors: arr('accessors').length };
  Object.assign(info, { meshes: counts.meshes, nodes: counts.nodes, materials: counts.materials, images: counts.images, textures: counts.textures, animations: counts.animations, skins: counts.skins });
  for (const [k, n] of Object.entries(counts)) if (L[k] !== undefined && n > L[k]) problems.push(`${n} ${k} (at most ${L[k]})`);

  // Extensions.
  const used = arr('extensionsUsed').map(String);
  const required = arr('extensionsRequired').map(String);
  info.extensions = { used, required };
  for (const e of required) if (!READABLE_EXTENSIONS.includes(e)) problems.push(`it requires the extension ${e}, which three.js cannot read`);
  for (const e of used) if (!required.includes(e) && !READABLE_EXTENSIONS.includes(e)) warnings.push(`it uses ${e}, which three.js ignores`);
  if (required.includes('KHR_draco_mesh_compression')) warnings.push('Draco geometry: the decoder is about 250 KB more to download; meshopt is the house format');

  // Buffers: only the GLB's own binary chunk, or a small data: URI. Never an address.
  let declared = 0;
  arr('buffers').forEach((b, i) => {
    const len = Number(b?.byteLength);
    if (!Number.isFinite(len) || len < 0) { problems.push(`buffer ${i} has no byteLength`); return; }
    // A meshopt fallback buffer (no uri, never loaded by a reader that decodes meshopt) holds nothing in the file.
    const fallback = b.uri === undefined && (b.extensions?.EXT_meshopt_compression?.fallback === true || b.extensions?.KHR_meshopt_compression?.fallback === true);
    if (fallback) { if (len > L.buffer * 4) problems.push(`buffer ${i} (a meshopt fallback) declares ${size(len)}`); return; }
    declared += len;
    if (len > L.buffer) problems.push(`buffer ${i} declares ${size(len)}, over ${size(L.buffer)}`);
    if (typeof b.uri === 'string') {
      if (!/^data:/i.test(b.uri)) problems.push(`buffer ${i} is loaded from an address (${b.uri.slice(0, 60)}): an external URI`);
      else if (dataUriBytes(b.uri) > L.dataUri) problems.push(`buffer ${i} is a data: URI of ${size(dataUriBytes(b.uri))}, over ${size(L.dataUri)}`);
    } else if (i === 0) {
      if (!glb.bin) problems.push('buffer 0 has no binary chunk to point at');
      else if (len > glb.bin.length) problems.push(`buffer 0 declares ${size(len)} but the binary chunk holds ${size(glb.bin.length)}`);
    } else problems.push(`buffer ${i} has no uri and is not the binary chunk`);
  });
  if (declared > L.bytes) problems.push(`its buffers declare ${size(declared)} in all, over ${size(L.bytes)}`);
  const bufLen = (i) => Number(arr('buffers')[i]?.byteLength ?? -1);

  // Buffer views and accessors stay inside what was declared.
  const views = arr('bufferViews');
  views.forEach((bv, i) => {
    const end = Number(bv?.byteOffset ?? 0) + Number(bv?.byteLength ?? NaN);
    if (!Number.isFinite(end) || bufLen(Number(bv?.buffer)) < 0 || end > bufLen(Number(bv.buffer))) problems.push(`buffer view ${i} reaches past its buffer`);
  });
  let maxCount = 0;
  arr('accessors').forEach((a, i) => {
    const count = Number(a?.count);
    if (!Number.isInteger(count) || count < 0) { problems.push(`accessor ${i} has no count`); return; }
    maxCount = Math.max(maxCount, count);
    if (count > L.vertices * 3) problems.push(`accessor ${i} holds ${count.toLocaleString('en-US')} elements`);
    if (a.bufferView === undefined) return;
    const bv = views[Number(a.bufferView)];
    const el = (COMPONENT_BYTES[a.componentType] ?? 0) * (TYPE_SIZE[a.type] ?? 0);
    if (!bv || !el) { problems.push(`accessor ${i} points at nothing it can read`); return; }
    const stride = Number(bv.byteStride ?? 0) || el;
    const need = Number(a.byteOffset ?? 0) + (count ? stride * (count - 1) + el : 0);
    // A meshopt-compressed view holds its decoded size in its extension; the plain view is the fallback.
    const decoded = Number(bv.extensions?.EXT_meshopt_compression?.byteLength ?? bv.extensions?.KHR_meshopt_compression?.byteLength ?? bv.byteLength);
    if (need > Math.max(Number(bv.byteLength), decoded)) problems.push(`accessor ${i} reaches past its buffer view`);
  });

  // Pictures: inside the file (a buffer view), or a small data: URI. Never an address.
  arr('images').forEach((im, i) => {
    if (typeof im?.uri === 'string') {
      if (!/^data:/i.test(im.uri)) problems.push(`picture ${i} is loaded from an address (${im.uri.slice(0, 60)}): an external URI`);
      else if (dataUriBytes(im.uri) > L.dataUri) problems.push(`picture ${i} is a data: URI of ${size(dataUriBytes(im.uri))}, over ${size(L.dataUri)}`);
    } else if (im?.bufferView === undefined) problems.push(`picture ${i} has neither a buffer view nor a uri`);
    const type = String(im?.mimeType ?? (typeof im?.uri === 'string' ? /^data:([^;,]+)/.exec(im.uri)?.[1] ?? '' : ''));
    if (type && !PICTURE_TYPES.includes(type)) warnings.push(`picture ${i} is ${type}`);
  });

  // Triangles and vertices, as drawn: each mesh times the nodes that place it (GPU instancing counted once per node).
  const accessors = arr('accessors');
  const meshTris = arr('meshes').map((m) => (Array.isArray(m?.primitives) ? m.primitives : []).reduce((n, p) => {
    const mode = p?.mode ?? 4;
    const count = p?.indices !== undefined ? Number(accessors[p.indices]?.count ?? 0) : Number(accessors[p?.attributes?.POSITION]?.count ?? 0);
    return n + (mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0);
  }, 0));
  const meshVerts = arr('meshes').map((m) => (Array.isArray(m?.primitives) ? m.primitives : []).reduce((n, p) => n + Number(accessors[p?.attributes?.POSITION]?.count ?? 0), 0));
  for (const node of arr('nodes')) {
    if (node?.mesh === undefined) continue;
    const inst = Number(accessors[node.extensions?.EXT_mesh_gpu_instancing?.attributes?.TRANSLATION]?.count ?? 1) || 1;
    info.triangles += (meshTris[node.mesh] ?? 0) * inst;
    info.vertices += (meshVerts[node.mesh] ?? 0) * inst;
  }
  info.joints = arr('skins').reduce((n, s) => Math.max(n, Array.isArray(s?.joints) ? s.joints.length : 0), 0);
  if (info.vertices > L.vertices) problems.push(`${info.vertices.toLocaleString('en-US')} vertices drawn (at most ${L.vertices.toLocaleString('en-US')})`);
  void maxCount;
  return { ok: problems.length === 0, problems, warnings, info };
}

/** One line for a refusal: "refused <label>: a; b". */
export function refusal(label, result) {
  return `refused ${label}: ${result.problems.slice(0, 4).join('; ')}${result.problems.length > 4 ? `; and ${result.problems.length - 4} more` : ''}`;
}
