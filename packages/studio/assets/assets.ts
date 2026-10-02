/*
 * @homie-rocks/studio/assets — ONE MODEL LOADER FOR EVERY three.js GAME A STUDIO MAKES.
 *
 *   import { createModels } from '@homie-rocks/studio/assets';
 *   const models = createModels();                         // one per game
 *   const fox = await models.instance('./models/fox.glb');   // a copy to place (skinned models too)
 *   scene.add(fox);
 *
 * Every model is a self-contained glTF binary (.glb) from the game's own files (games/<id>/public/models/), made
 * phone-sized by `homie-studio assets add` or `assets optimise`: meshopt geometry and WebP pictures, decoded here.
 * Before three.js parses a byte, the file is checked (assets/safety.mjs, the same rules `assets check` and
 * `assets add` use): a file over the size cap, a buffer or picture loaded from an address (an external URI), an
 * accessor reaching past its buffer or an extension three.js cannot read is REFUSED. A refused or missing model
 * rejects with a plain-words Error; `models.placeholder()` is a grey box of the size it would have been, so a round
 * never waits on a model.
 *
 * Models load from the game's own origin only (relative addresses): a game never depends on another site at
 * runtime (homie.rocks's starter library is copied into the game, never hot-linked). `allowOrigins` opens one on
 * purpose.
 *
 * In development (localhost, or ?debug=1) a model over its budget says so in the console, and `stats()` (also
 * `window.__homieModels`) has the totals the perf skill reads: models, triangles, texture memory and refusals.
 *
 * KTX2 pictures (KHR_texture_basisu) need a transcoder (about 580 KB): pass your own KTX2Loader as `ktx2` when a
 * game ships them (`assets check` says when); WebP, the default, needs nothing.
 *
 * Things a game repeats (trees, gems, a fence) are instanced, one draw call per mesh however many there are:
 *
 *   const copies = instancedCopies((await models.load('./models/tree.glb')).scene, 40);
 *   copies.forEach((c) => { placeCopy(c, 0, where); c.mesh.count = 1; scene.add(c.mesh); });
 *
 * Never bake a mesh's own transform into its geometry for that (geometry.applyMatrix4): an optimised model's positions
 * are meshopt-quantized int16, dequantized by its node's scale, and a baked scale clips everything past one metre.
 *
 * A flat-coloured model (a library item with `paletteSwap`: its colours in one tiny palette picture) is repainted
 * into a game's own palette with `repaint(model, pick)`, once, on the loaded model, before it is copied.
 *
 * `stylize(model, style)` draws it the way the game's art direction says (style.json: `materials.model` toon, flat,
 * hand-painted or pbr, and `materials.outline`), the same material model and ink line the style board was drawn with.
 * Once, on the loaded model, after `repaint` and before it is copied: its outline hulls are instanced with it.
 */
import { BackSide, DoubleSide, Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, CanvasTexture, Color, DataTexture, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, MeshToonMaterial, NearestFilter, RedFormat, SRGBColorSpace, Vector3, type AnimationClip, type Group, type Material, type Object3D, type Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LIMITS, checkGlb, refusal } from './safety.mjs';

export { LIMITS, checkGlb } from './safety.mjs';

/** The size caps a file is checked against (assets/safety.mjs LIMITS.game unless a game narrows or widens them). */
export interface ModelLimits { bytes: number; json: number; buffer: number; dataUri: number; vertices: number; meshes: number; nodes: number; materials: number; images: number; textures: number; animations: number; skins: number; accessors: number }

/** What one model may cost on a phone (a prop 1,500 triangles and 512 px; a hero 8,000 and 1,024 px). */
export interface ModelBudget { triangles?: number; texturePx?: number; materials?: number; bytes?: number }

export interface LoadedModel {
  url: string;
  /** The model as loaded: never add this one to a scene twice; `instance()` gives copies. */
  scene: Group;
  animations: AnimationClip[];
  bytes: number;
  triangles: number;
  textures: number;
  /** GPU memory of its pictures, RGBA with mipmaps (what `gpuSize` in gltf-transform's inspect says). */
  textureBytes: number;
  warnings: string[];
}

export interface ModelsOptions {
  /** Narrow or widen the file checks (LIMITS.game by default). */
  limits?: Partial<ModelLimits>;
  /** A per-model budget for the development warnings (the prop tier by default). */
  budget?: ModelBudget;
  /** A KTX2Loader the game set up (transcoder path, renderer support): only for models with KTX2 pictures. */
  ktx2?: { load?: unknown } | null;
  /** Origins a game deliberately loads models from, besides its own. */
  allowOrigins?: string[];
  /** Where development warnings go (console.warn by default; outside development, nowhere). */
  onWarn?: (text: string) => void;
  /** Say budget warnings even outside development. */
  dev?: boolean;
}

export interface ModelStats { models: number; triangles: number; textureBytes: number; bytes: number; refused: { url: string; why: string }[] }

export interface Models {
  /** Load (once per address) and check one model. Rejects with a plain-words Error when it is refused or missing. */
  load(url: string, opts?: { limits?: Partial<ModelLimits>; budget?: ModelBudget }): Promise<LoadedModel>;
  /** A copy of a loaded model to place in the scene (skeletons cloned properly). */
  instance(url: string, opts?: { limits?: Partial<ModelLimits>; budget?: ModelBudget }): Promise<Object3D>;
  /** A grey box (metres), for a model that was refused, is missing or is still loading. */
  placeholder(size?: { x: number; y: number; z: number }, colour?: number): Mesh;
  /** Totals for the perf probe and the console. */
  stats(): ModelStats;
  /** Free every geometry, material and picture this loader made. */
  dispose(): void;
}

const PROP_BUDGET: Required<ModelBudget> = { triangles: 1500, texturePx: 512, materials: 1, bytes: 300 * 1024 };
const devHost = (): boolean => {
  try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; }
};

/** Where an address points: relative ones resolve against the page; another origin is refused unless allowed. */
function resolveUrl(url: string, allow: string[]): string {
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  const u = new URL(url, base);
  const own = typeof location !== 'undefined' ? location.origin : u.origin;
  if (u.origin !== own && !allow.includes(u.origin)) throw new Error(`refused ${url}: a model from another site (${u.origin}); copy it into the game's own files (homie-studio assets add)`);
  if (!/^https?:$/.test(u.protocol) && u.protocol !== 'blob:') throw new Error(`refused ${url}: not a web address`);
  return u.href;
}

/** The file's bytes, refusing early when it says (or turns out) to be over the cap. */
async function fetchCapped(url: string, cap: number): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const said = Number(res.headers.get('content-length') ?? NaN);
  // A served file may be compressed on the wire: the header is only trusted when the body is not.
  if (Number.isFinite(said) && !res.headers.get('content-encoding') && said > cap) throw new Error(`refused ${url}: ${Math.ceil(said / 1024)} KB, over ${Math.ceil(cap / 1024)} KB`);
  if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); if (b.byteLength > cap) throw new Error(`refused ${url}: over ${Math.ceil(cap / 1024)} KB`); return b; }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { void reader.cancel(); throw new Error(`refused ${url}: over ${Math.ceil(cap / 1024)} KB`); }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

/** GPU bytes of one picture: RGBA8 with mipmaps (x 4/3), or the compressed size a KTX2 upload names. */
function textureBytes(t: Texture): number {
  const img = t.image as { width?: number; height?: number } | undefined;
  const w = Number(img?.width ?? 0); const h = Number(img?.height ?? 0);
  return Math.round(w * h * 4 * (4 / 3));
}

/** Instanced copies of one mesh of a model, and the mesh's own place in the model (`base`). */
export interface Copies { mesh: InstancedMesh; base: Matrix4 }

/**
 * A loaded model (`(await models.load(url)).scene`, or a placeholder) as instanced copies: one InstancedMesh per mesh
 * in it, `count` copies at most, sharing the file's geometry and materials. Place copy `i` with placeCopy (where it
 * goes, times the mesh's own place in the model), then set `mesh.count`.
 */
export function instancedCopies(model: Object3D, count: number): Copies[] {
  model.updateMatrixWorld(true);
  const out: Copies[] = [];
  model.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) out.push({ mesh: new InstancedMesh(m.geometry, m.material, count), base: m.matrixWorld.clone() });
  });
  return out;
}

const placed = new Matrix4();
/** Copy `i` of `copy` at `where` (a world matrix: position, turn, scale). */
export function placeCopy(copy: Copies, i: number, where: Matrix4): void {
  copy.mesh.setMatrixAt(i, placed.multiplyMatrices(where, copy.base));
}

/**
 * Repaint a model's flat colours. `pick(r, g, b)` (sRGB, 0 to 255) returns the colour to paint instead, or null to
 * keep it. It reaches each material's own colour and its base-colour picture when that is a small palette picture (at
 * most `maxPx` a side: an optimised flat model's); a painted texture bigger than that is left as it is. Materials and
 * pictures change in place, so call it once on the loaded model (`(await models.load(url)).scene`), before copying.
 * Returns how many materials changed.
 */
export function repaint(model: Object3D, pick: (r: number, g: number, b: number) => [number, number, number] | null, { maxPx = 64 } = {}): number {
  let changed = 0;
  const seen = new Set<Material>();
  const c = new Color();
  model.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[]) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      const tex = mat.map;
      if (!tex) {
        if (!mat.color) continue;
        c.copy(mat.color).convertLinearToSRGB();
        const to = pick(Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255));
        if (to) { mat.color.setRGB(to[0] / 255, to[1] / 255, to[2] / 255, SRGBColorSpace); changed += 1; }
        continue;
      }
      const img = tex.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
      const w = Number(img?.width ?? 0); const h = Number(img?.height ?? 0);
      if (!img || !w || !h || w > maxPx || h > maxPx || typeof document === 'undefined') continue;
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      if (!g) continue;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, w, h);
      let n = 0;
      for (let i = 0; i < px.data.length; i += 4) {
        const to = pick(px.data[i] as number, px.data[i + 1] as number, px.data[i + 2] as number);
        if (to) { px.data[i] = to[0]; px.data[i + 1] = to[1]; px.data[i + 2] = to[2]; n += 1; }
      }
      if (!n) continue;
      g.putImageData(px, 0, 0);
      // The new picture samples exactly as the old one did (its orientation, wrapping and filters).
      const t = new CanvasTexture(canvas);
      Object.assign(t, { colorSpace: tex.colorSpace, flipY: tex.flipY, wrapS: tex.wrapS, wrapT: tex.wrapT, magFilter: tex.magFilter, minFilter: tex.minFilter, generateMipmaps: tex.generateMipmaps, channel: tex.channel });
      mat.map = t; mat.needsUpdate = true;
      changed += 1;
    }
  });
  return changed;
}

/** Every geometry, material and picture under `obj`, freed. */
/** What `stylize` reads from a game's style.json. */
export interface StyleLike {
  render?: string;
  materials?: { model?: string; outline?: boolean };
  palette?: { bg?: string; ink?: string };
}

let toonRamp: DataTexture | null = null;
function rampOf(): DataTexture {
  if (toonRamp) return toonRamp;
  const data = new Uint8Array([Math.round(0.2 * 255), Math.round(0.53 * 255), Math.round(0.87 * 255)]);
  toonRamp = new DataTexture(data, 3, 1, RedFormat);
  toonRamp.minFilter = NearestFilter; toonRamp.magFilter = NearestFilter; toonRamp.needsUpdate = true;
  return toonRamp;
}

/** One material in the style's material model (its colour, picture, vertex colours and transparency kept). */
function styledMaterial(mat: Material, model: string): Material {
  const src = mat as MeshStandardMaterial;
  const base = { color: src.color ? src.color.clone() : new Color('#cccccc'), map: (src.map ?? null) as Texture | null, vertexColors: Boolean(src.vertexColors), transparent: src.transparent, opacity: src.opacity, side: src.side, alphaTest: src.alphaTest };
  let out: Material;
  if (model === 'toon') out = new MeshToonMaterial({ ...base, gradientMap: rampOf() });
  else if (model === 'flat' || model === 'pixel') out = new MeshLambertMaterial({ ...base, flatShading: true });
  else if (model === 'hand-painted') {
    const m = new MeshStandardMaterial({ ...base, roughness: 0.95, metalness: 0 });
    // A painted look: the top of every surface a little lighter, the bottom a little cooler.
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvH = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(0.82, 0.86, 0.98), vec3(1.12, 1.06, 0.96), clamp(vH * 0.6 + 0.4, 0.0, 1.0));');
    };
    out = m;
  } else return mat;
  out.name = mat.name;
  return out;
}

/**
 * The outline's shell: the mesh's positions only, its corners welded, with smooth normals, so a flat-shaded low-poly
 * model's line stays one unbroken shell instead of a black flake on every face. One per geometry.
 */
const hullGeometries = new WeakMap<BufferGeometry, BufferGeometry | null>();
function hullGeometry(g: BufferGeometry): BufferGeometry | null {
  if (hullGeometries.has(g)) return hullGeometries.get(g) ?? null;
  let h: BufferGeometry | null;
  const only = new BufferGeometry();
  // Plain float positions (an optimised model's are quantized, often interleaved), read through the accessor.
  const src = g.getAttribute('position');
  const xyz = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) { xyz[i * 3] = src.getX(i); xyz[i * 3 + 1] = src.getY(i); xyz[i * 3 + 2] = src.getZ(i); }
  only.setAttribute('position', new Float32BufferAttribute(xyz, 3));
  if (g.index) only.setIndex(Array.from(g.index.array as ArrayLike<number>));
  h = mergeVertices(only);
  if (openShell(h) || paperThin(h)) h = null; else h.computeVertexNormals();
  hullGeometries.set(g, h);
  return h;
}

/**
 * How thick a closed shell is, about (3 x volume / area: a slab of thickness t gives 1.5 t), in its own units.
 */
function thicknessOf(h: BufferGeometry): number {
  const p = h.getAttribute('position'); const a = (h.index as NonNullable<BufferGeometry['index']>).array as ArrayLike<number>;
  let vol = 0; let area = 0;
  for (let i = 0; i + 2 < a.length; i += 3) {
    const i0 = a[i] as number; const i1 = a[i + 1] as number; const i2 = a[i + 2] as number;
    const ax = p.getX(i0); const ay = p.getY(i0); const az = p.getZ(i0);
    const bx = p.getX(i1); const by = p.getY(i1); const bz = p.getZ(i1);
    const cx = p.getX(i2); const cy = p.getY(i2); const cz = p.getZ(i2);
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax; const uy = by - ay; const uz = bz - az; const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area > 0 ? (3 * Math.abs(vol)) / area : 0;
}

/** Two cards back to back (leaves, grass): closed, but with no inside, so a shell would z-fight it black. */
function paperThin(h: BufferGeometry): boolean {
  h.computeBoundingBox();
  const size = (h.boundingBox as NonNullable<BufferGeometry['boundingBox']>).getSize(new Vector3());
  return thicknessOf(h) < 0.01 * Math.max(size.x, size.y, size.z);
}

/** An open surface (cards of leaves, grass, a sail): many edges belong to one triangle only. No outline shell for it. */
function openShell(h: BufferGeometry): boolean {
  const idx = h.index;
  if (!idx) return true;
  const edges = new Map<string, number>();
  const a = idx.array as ArrayLike<number>;
  for (let i = 0; i + 2 < a.length; i += 3) {
    for (const [u, v] of [[a[i], a[i + 1]], [a[i + 1], a[i + 2]], [a[i + 2], a[i]]] as [number, number][]) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n === 1) open += 1;
  return edges.size > 0 && open / edges.size > 0.15;
}

/**
 * The ink shell's vertex step: pushed out along its normal by `width` WORLD units (metres in a game), after every
 * transform (the model's scale, a quantized mesh's node, an instance's matrix), so a line is as thick on a flower as on
 * a tree and nothing about the model's own units matters.
 */
function inkShader(width: number): (sh: { vertexShader: string }) => void {
  const w = Math.max(0, width).toExponential(4);
  return (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', [
      'vec4 mvPosition = vec4( transformed, 1.0 );',
      'vec3 inkN = normal;',
      '#ifdef USE_INSTANCING',
      'mvPosition = instanceMatrix * mvPosition; inkN = mat3( instanceMatrix ) * inkN;',
      '#endif',
      'vec4 inkW = modelMatrix * mvPosition;',
      `inkW.xyz += normalize( mat3( modelMatrix ) * inkN ) * ${w};`,
      'mvPosition = viewMatrix * inkW;',
      'gl_Position = projectionMatrix * mvPosition;',
    ].join('\n'));
  };
}

const MODEL_OF_RENDER: Record<string, string> = { toon: 'toon', 'lowpoly-flat': 'flat', voxel: 'flat', 'pixel-hd2d': 'pixel', 'hand-painted': 'hand-painted', pbr: 'pbr', realistic: 'pbr' };

/**
 * Draw a loaded model the way the game's art direction says: its material model (style.json `materials.model`, else
 * the render style's) on every mesh, and with `materials.outline` an ink line (an inverted hull: a back-faced copy
 * pushed out along the normals, `line` metres in the world: as thick on a flower as on a tree, at whatever scale the
 * game draws it). Skinned meshes, two-sided cards and paper-thin shells get the material, not the line. Call it once on the loaded model, after `repaint`; `instancedCopies` copies the line with it. Returns how many
 * meshes changed.
 */
export function stylize(model: Object3D, style: StyleLike, { line = 0.05, ink }: { line?: number; ink?: string } = {}): number {
  const kind = style.materials?.model ?? MODEL_OF_RENDER[String(style.render ?? '')] ?? 'pbr';
  const swapped = new Map<Material, Material>();
  const meshes: Mesh[] = [];
  model.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.name !== 'hull') meshes.push(m); });
  for (const m of meshes) {
    const swap = (x: Material): Material => { let y = swapped.get(x); if (!y) { y = styledMaterial(x, kind); swapped.set(x, y); } return y; };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  }
  if (style.materials?.outline) {
    const colour = new Color(ink ?? (style.palette?.bg ? `#${new Color(style.palette.bg).lerp(new Color('#000000'), 0.7).getHexString()}` : '#1a1410'));
    const inkMaterial = new MeshBasicMaterial({ color: colour, side: BackSide });
    inkMaterial.onBeforeCompile = inkShader(line);
    inkMaterial.customProgramCacheKey = () => `ink:${line}`;
    for (const m of meshes) {
      // No line on a skinned mesh, nor on a two-sided card (leaves, grass: a shell around nothing draws it black).
      if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) continue;
      if ((Array.isArray(m.material) ? m.material : [m.material]).some((x) => x.side === DoubleSide)) continue;
      const shell = hullGeometry(m.geometry);
      if (!shell) continue;
      const hull = new Mesh(shell, inkMaterial);
      hull.name = 'hull';
      hull.castShadow = false; hull.receiveShadow = false;
      m.add(hull);
    }
  }
  return meshes.length;
}

export function disposeObject(obj: Object3D): void {
  obj.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as Material[];
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v && typeof v === 'object' && (v as Texture).isTexture) (v as Texture).dispose();
      mat.dispose();
    }
  });
}

export function createModels(opts: ModelsOptions = {}): Models {
  const limits = { ...LIMITS.game, ...(opts.limits ?? {}) } as ModelLimits;
  const allow = (opts.allowOrigins ?? []).map((o) => new URL(o).origin);
  const dev = opts.dev ?? devHost();
  const warn = (text: string): void => { if (dev) (opts.onWarn ?? ((t: string) => console.warn(`[models] ${t}`)))(text); };
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  if (opts.ktx2) loader.setKTX2Loader(opts.ktx2 as never);
  const cache = new Map<string, Promise<LoadedModel>>();
  const made: Object3D[] = [];
  const refused: { url: string; why: string }[] = [];
  const loaded: LoadedModel[] = [];

  async function loadOnce(url: string, lim: ModelLimits, budget: Required<ModelBudget>): Promise<LoadedModel> {
    let href: string;
    try { href = resolveUrl(url, allow); } catch (error) { refused.push({ url, why: (error as Error).message }); throw error; }
    let bytes: Uint8Array;
    try { bytes = await fetchCapped(href, lim.bytes); } catch (error) { refused.push({ url, why: (error as Error).message }); throw error; }
    const check = checkGlb(bytes, lim);
    if (!check.ok) { const why = refusal(url, check); refused.push({ url, why }); throw new Error(why); }
    if (check.info.extensions.required.includes('KHR_texture_basisu') && !opts.ktx2) {
      const why = `refused ${url}: it has KTX2 pictures and this game set up no KTX2 loader (createModels({ ktx2 }))`;
      refused.push({ url, why });
      throw new Error(why);
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((resolve, reject) => loader.parse(buffer, href.replace(/[^/]*$/, ''), resolve, reject));
    const scene = gltf.scene;
    let triangles = 0; let textures = 0; let tex = 0; let materials = 0;
    const seen = new Set<string>();
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      const count = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
      triangles += Math.floor(count / 3) * Number((m as unknown as { count?: number }).count ?? 1);
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as Material[]) {
        if (seen.has(mat.uuid)) continue;
        seen.add(mat.uuid); materials += 1;
        for (const v of Object.values(mat as unknown as Record<string, unknown>)) {
          const t = v as Texture;
          if (t && typeof t === 'object' && t.isTexture && !seen.has(t.uuid)) { seen.add(t.uuid); textures += 1; tex += textureBytes(t); }
        }
      }
    });
    const warnings = [...check.warnings];
    if (triangles > budget.triangles) warnings.push(`${triangles.toLocaleString('en-US')} triangles (its budget is ${budget.triangles.toLocaleString('en-US')})`);
    if (materials > budget.materials) warnings.push(`${materials} materials (its budget is ${budget.materials})`);
    if (bytes.byteLength > budget.bytes) warnings.push(`${Math.ceil(bytes.byteLength / 1024)} KB (its budget is ${Math.ceil(budget.bytes / 1024)} KB)`);
    const px = budget.texturePx * budget.texturePx * 4 * (4 / 3) * Math.max(1, textures);
    if (tex > px) warnings.push(`${(tex / 1024 / 1024).toFixed(1)} MB of picture memory (pictures over ${budget.texturePx} px)`);
    for (const w of warnings) warn(`${url}: ${w}`);
    const model: LoadedModel = { url, scene, animations: gltf.animations ?? [], bytes: bytes.byteLength, triangles, textures, textureBytes: tex, warnings };
    loaded.push(model);
    made.push(scene);
    return model;
  }

  const api: Models = {
    load(url, o = {}) {
      const key = url;
      let p = cache.get(key);
      if (!p) {
        p = loadOnce(url, { ...limits, ...(o.limits ?? {}) } as ModelLimits, { ...PROP_BUDGET, ...(opts.budget ?? {}), ...(o.budget ?? {}) });
        cache.set(key, p);
        p.catch(() => cache.delete(key));
      }
      return p;
    },
    async instance(url, o) {
      const m = await api.load(url, o);
      let skinned = false;
      m.scene.traverse((x) => { if ((x as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true; });
      return skinned ? cloneSkinned(m.scene) : m.scene.clone(true);
    },
    placeholder(size = { x: 0.5, y: 0.5, z: 0.5 }, colour = 0x8a8f99) {
      const geo = new BoxGeometry(size.x, size.y, size.z);
      geo.translate(0, size.y / 2, 0);
      const box = new Mesh(geo, new MeshStandardMaterial({ color: colour, roughness: 0.9 }));
      box.name = 'placeholder';
      made.push(box);
      return box;
    },
    stats() {
      return {
        models: loaded.length,
        triangles: loaded.reduce((n, m) => n + m.triangles, 0),
        textureBytes: loaded.reduce((n, m) => n + m.textureBytes, 0),
        bytes: loaded.reduce((n, m) => n + m.bytes, 0),
        refused: refused.slice(),
      };
    },
    dispose() {
      for (const o of made) disposeObject(o);
      made.length = 0; loaded.length = 0; cache.clear();
    },
  };
  try { (globalThis as unknown as { __homieModels?: () => ModelStats }).__homieModels = () => api.stats(); } catch { /* not a browser */ }
  return api;
}
