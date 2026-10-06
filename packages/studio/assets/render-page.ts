/*
 * THE STILL RENDERER (lib/render3d.mjs bundles this into one page and drives it in headless Chrome): the engine's
 * own pictures of art direction, made on the creator's computer for free.
 *
 *   swatch(tokens, models)   a style direction drawn as the game would draw it: its palette on a ground and a sky, its
 *                            light, fog and camera, its material model (flat, toon with ink outlines, painted, PBR,
 *                            pixel), a character stand-in at the decided proportions, a tree, a rock, a pick-up and the
 *                            library family's own pieces, with the title in the display font and the palette as chips
 *   lineup(models, tokens)   every asset side by side at true scale in front of a 1 m grid, front and three-quarter,
 *                            under the game's light, plus each one's silhouette black on white at 64 px tall
 *   thumb(model)             one asset, three-quarter, on a neutral ground (the library's thumbnails)
 *
 * Models arrive as base64 GLB bytes and are parsed here (meshopt decoded); nothing is fetched but Google Fonts.
 */
import {
  AmbientLight, BackSide, Box3, BufferGeometry, CanvasTexture, Float32BufferAttribute, Color, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, MeshStandardMaterial, MeshToonMaterial, NearestFilter, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Scene, SRGBColorSpace, Vector3, WebGLRenderer, PointLight, CylinderGeometry, ConeGeometry, IcosahedronGeometry, SphereGeometry, CapsuleGeometry,
  OctahedronGeometry, DataTexture, RedFormat, GridHelper, ACESFilmicToneMapping, NoToneMapping, PCFSoftShadowMap, type Material, type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationMixer, LoopRepeat, LoopOnce, type AnimationClip } from 'three';

interface Palette { bg: string; ink: string; accent: string; accent2: string; danger: string; good: string; gold: string; ramp?: string[] }
interface Tokens {
  palette: Palette;
  light?: { time?: string; key?: number[]; intensity?: number; hardness?: number; sky?: string; ground?: string; fog?: number; bloom?: number };
  camera?: { angle?: string; projection?: string; pitch?: number; distance?: number; fov?: number };
  render?: string;
  materials?: { model?: string; outline?: boolean };
  fonts?: { display?: string; body?: string };
  shape?: { language?: string; bevel?: number };
  proportions?: { heads?: number; heightM?: number };
}
interface ModelIn { id: string; glb: string; label?: string; place?: 'hero' | 'prop' | 'dressing'; scale?: number; retint?: boolean; tint?: string; pull?: number; anims?: string | string[]; pose?: string; poseAt?: number }

const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

const b64 = (s: string): ArrayBuffer => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
async function parse(m: ModelIn): Promise<Group> {
  const gltf = await new Promise<{ scene: Group; animations: AnimationClip[] }>((res, rej) => loader.parse(b64(m.glb), '', res as never, rej));
  gltf.scene.name = m.id;
  // A character with a clip library stands in a pose (idle, a little way in), not in its bind pose.
  // One clip library, or several (its skeleton's own, then any declared supplemental): a verb's first clip is kept.
  let clips = gltf.animations;
  if (m.anims) {
    clips = [];
    for (const lib of Array.isArray(m.anims) ? m.anims : [m.anims]) {
      const more = (await new Promise<{ animations: AnimationClip[] }>((res, rej) => loader.parse(b64(lib), '', res as never, rej))).animations;
      for (const c of more) if (!clips.some((x) => x.name === c.name)) clips.push(c);
    }
  }
  gltf.scene.userData.clips = clips;
  if (clips?.length && (m.anims || m.pose)) {
    const clip = clips.find((c) => c.name === (m.pose ?? 'idle')) ?? clips.find((c) => c.name === 'idle') ?? clips[0];
    if (clip) { const mixer = new AnimationMixer(gltf.scene); mixer.clipAction(clip).play(); mixer.setTime(Math.min(clip.duration, m.poseAt ?? 0.25)); gltf.scene.updateMatrixWorld(true); }
  }
  return gltf.scene;
}
const col = (hex: string | undefined, fallback = '#888888'): Color => new Color(/^#[0-9a-f]{3,8}$/i.test(String(hex)) ? hex as string : fallback);
const boxOf = (o: Object3D): Box3 => new Box3().setFromObject(o);

/** A toon ramp of `steps` bands. */
function ramp(steps: number): DataTexture {
  const n = Math.max(2, Math.min(5, steps));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round(((i + 0.6) / n) * 255);
  const t = new DataTexture(data, n, 1, RedFormat);
  t.minFilter = NearestFilter; t.magFilter = NearestFilter; t.needsUpdate = true;
  return t;
}

/** The direction's material model applied to one mesh's material (colour and picture kept). */
function styled(mat: Material, t: Tokens): Material {
  const src = mat as MeshStandardMaterial;
  const color = src.color ? src.color.clone() : new Color('#cccccc');
  const map = (src.map ?? null) as Texture | null;
  const model = t.materials?.model ?? 'flat';
  if (model === 'toon') return new MeshToonMaterial({ color, map, side: src.side, gradientMap: ramp(3) });
  if (model === 'flat' || model === 'pixel') return new MeshLambertMaterial({ color, map, side: src.side, flatShading: true });
  if (model === 'hand-painted') {
    const m = new MeshStandardMaterial({ color, map, side: src.side, roughness: 0.95, metalness: 0 });
    // A painted look: the top of every surface a little lighter, the bottom a little cooler (light baked gently in).
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvH = (modelMatrix * vec4(transformed, 1.0)).y;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(0.82, 0.86, 0.98), vec3(1.12, 1.06, 0.96), clamp(vH * 0.6 + 0.4, 0.0, 1.0));');
    };
    return m;
  }
  return new MeshStandardMaterial({ color, map, side: src.side, roughness: src.roughness ?? 0.6, metalness: src.metalness ?? 0 });
}

/** The outline's shell: positions only, corners welded, smooth normals (an unbroken line on a flat-shaded model). */
function hullGeometry(g: BufferGeometry): BufferGeometry | null {
  const only = new BufferGeometry();
  // Plain float positions (an optimised model's are quantized, often interleaved), read through the accessor.
  const src = g.getAttribute('position');
  const xyz = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) { xyz[i * 3] = src.getX(i); xyz[i * 3 + 1] = src.getY(i); xyz[i * 3 + 2] = src.getZ(i); }
  only.setAttribute('position', new Float32BufferAttribute(xyz, 3));
  if (g.index) only.setIndex(Array.from(g.index.array as ArrayLike<number>));
  const h = mergeVertices(only);
  if (openShell(h) || paperThin(h)) return null;
  h.computeVertexNormals();
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

/**
 * A part too thin for the line (a flower's stem, a post): its thickness as drawn under three line widths would turn it
 * into a dark stick, so it goes without. The shell's own units are measured against the mesh's world size.
 */
function tooThin(m: Mesh, shell: BufferGeometry, width: number, drawn: number): boolean {
  shell.computeBoundingBox();
  const local = (shell.boundingBox as Box3).getSize(new Vector3());
  const world = new Box3().setFromObject(m, true).getSize(new Vector3());
  const units = Math.max(world.x, world.y, world.z) / Math.max(1e-9, local.x, local.y, local.z);
  return thicknessOf(shell) * units * drawn < 3 * width;
}

/** Ink outlines (an inverted hull pushed out along the normals): the toon look's line. */
function outline(root: Object3D, ink: string, width: number, drawn = 1): void {
  const hulls: Mesh[] = [];
  root.updateMatrixWorld(true);
  const mat = new MeshBasicMaterial({ color: col(ink), side: BackSide });
  mat.onBeforeCompile = inkShader(width);
  mat.customProgramCacheKey = () => `ink:${width}`;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || m.name === 'hull') return;
    const shell = hullGeometry(m.geometry);
    if (!shell || tooThin(m, shell, width, drawn)) return;
    const h = new Mesh(shell, mat);
    h.name = 'hull';
    hulls.push(h);
    (m as unknown as { __hull?: Mesh }).__hull = h;
  });
  root.traverse((o) => { const h = (o as unknown as { __hull?: Mesh }).__hull; if (h) o.add(h); });
}

/**
 * A palette swap (the free fix when a palette changes): every colour of a model, its materials' and its pictures'
 * texels, moved to the nearest colour of the ramp in lightness and hue, keeping its own shading.
 */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const R = lin(r); const G = lin(g); const B = lin(b);
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047); const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722); const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function fromLab(L: number, A: number, B: number): [number, number, number] {
  const fy = (L + 16) / 116; const fx = fy + A / 500; const fz = fy - B / 200;
  const inv = (t: number): number => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047; const Y = inv(fy); const Z = inv(fz) * 1.08883;
  const R = X * 3.2406 - Y * 1.5372 - Z * 0.4986; const G = -X * 0.9689 + Y * 1.8758 + Z * 0.0415; const Bb = X * 0.0557 - Y * 0.204 + Z * 1.057;
  const enc = (v: number): number => Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055));
  return [enc(R), enc(G), enc(Bb)];
}
type Rgb = { r: number; g: number; b: number };
const lchCache = new Map<Rgb, [number, number, number]>();
const lchOf = (c: Rgb): [number, number, number] => { let v = lchCache.get(c); if (!v) { const [L, A, B] = lab(c.r, c.g, c.b); v = [L, Math.hypot(A, B), Math.atan2(B, A)]; lchCache.set(c, v); } return v; };
/**
 * A colour moved into the ramp: a coloured one takes the hue of the nearest coloured ramp entry (its own lightness and
 * most of its own strength kept, so shading survives); a grey one takes the nearest grey-ish entry's tint.
 */
function nearestOf(ramp: Rgb[], r: number, g: number, b: number): [number, number, number] {
  const [L, A, B] = lab(r, g, b);
  const C = Math.hypot(A, B); const H = Math.atan2(B, A);
  const pool = ramp.map((c) => [c, lchOf(c)] as const);
  if (C < 16) {
    const greys = pool.filter(([, v]) => v[1] < 24);
    const [, v] = (greys.length ? greys : pool).reduce((x, y) => (Math.abs(y[1][0] - L) < Math.abs(x[1][0] - L) ? y : x));
    return fromLab(L, Math.cos(v[2]) * Math.min(C, 6, v[1]), Math.sin(v[2]) * Math.min(C, 6, v[1]));
  }
  const hues = pool.filter(([, v]) => v[1] >= 18);
  if (!hues.length) return [r, g, b];
  let best = hues[0] as (typeof hues)[number]; let bd = Infinity;
  for (const h of hues) { const d = Math.abs(Math.atan2(Math.sin(h[1][2] - H), Math.cos(h[1][2] - H))) + Math.abs(h[1][0] - L) / 400; if (d < bd) { bd = d; best = h; } }
  const [L2, C2, H2] = best[1];
  const LL = L * 0.6 + L2 * 0.4; const CC = C * 0.45 + C2 * 0.55;
  return fromLab(LL, Math.cos(H2) * CC, Math.sin(H2) * CC);
}
export function retint(root: Object3D, hexes: string[], strength = 1): void {
  // sRGB 0..1, read straight from the hex (three.js's Color would hold linear values).
  const ramp: Rgb[] = hexes.filter((h) => /^#[0-9a-f]{6}$/i.test(h)).map((h) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 }));
  if (!ramp.length) return;
  const done = new Map<unknown, unknown>();
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[]) {
      if (done.has(mat)) continue;
      done.set(mat, true);
      if (mat.map?.image && !mat.map.userData.retinted) {
        const img = mat.map.image as CanvasImageSource & { width: number; height: number };
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d') as CanvasRenderingContext2D; g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height);
        const k = Math.max(0, Math.min(1, strength));
        for (let i = 0; i < d.data.length; i += 4) {
          const r = (d.data[i] as number) / 255; const gg = (d.data[i + 1] as number) / 255; const b = (d.data[i + 2] as number) / 255;
          const n = nearestOf(ramp, r, gg, b);
          d.data[i] = (r + (n[0] - r) * k) * 255; d.data[i + 1] = (gg + (n[1] - gg) * k) * 255; d.data[i + 2] = (b + (n[2] - b) * k) * 255;
        }
        g.putImageData(d, 0, 0);
        const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; t.flipY = mat.map.flipY; t.userData.retinted = true;
        mat.map = t; mat.needsUpdate = true;
      } else if (mat.color && !mat.map) {
        const s = mat.color.clone().convertLinearToSRGB();
        const n = nearestOf(ramp, s.r, s.g, s.b);
        const k = Math.max(0, Math.min(1, strength));
        mat.color.setRGB(s.r + (n[0] - s.r) * k, s.g + (n[1] - s.g) * k, s.b + (n[2] - s.b) * k).convertSRGBToLinear();
      }
    }
  });
}

/** One colour for the whole model (a game that paints it so: a gem in the palette's gold), its own shading kept by the light. */
function tintAll(root: Object3D, hex: string): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as MeshStandardMaterial[]) { mat.map = null; mat.color = col(hex); mat.needsUpdate = true; }
  });
}

/** `line`: the outline's thickness in world units (the board: a share of its size; the lineup: 5 cm at true scale). */
function restyle(root: Object3D, t: Tokens, size: number, line?: number, drawn = 1): void {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    m.material = Array.isArray(m.material) ? m.material.map((x) => styled(x, t)) : styled(m.material, t);
  });
  if (t.materials?.outline) outline(root, mixHex(t.palette.bg, '#000000', 0.7), line ?? Math.max(0.012, size * 0.03), drawn);
}

function mixHex(a: string, b: string, k: number): string { return `#${col(a).lerp(col(b), k).getHexString()}`; }

/** A sky: a vertical gradient from the light's sky colour to the palette's background. */
function skyTexture(top: string, bottom: string): CanvasTexture {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace;
  return t;
}

function lights(scene: Scene, t: Tokens, span: number): void {
  const L = t.light ?? {};
  const key = L.key ?? [-0.5, -1, -0.35];
  const sun = new DirectionalLight(0xffffff, (L.intensity ?? 2.2) * 1.05);
  sun.position.set(-key[0] * span, -key[1] * span, -key[2] * span);
  sun.color = col(L.time === 'night' ? mixHex(t.palette.accent2, '#ffffff', 0.55) : L.time === 'golden' ? mixHex(t.palette.gold, '#ffffff', 0.4) : '#ffffff');
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = span * 0.9;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.1, far: span * 4 });
  sun.shadow.radius = 2 + (1 - (L.hardness ?? 0.4)) * 6;
  scene.add(sun);
  scene.add(new HemisphereLight(col(L.time === 'night' ? mixHex(L.sky ?? t.palette.bg, '#9fb4ff', 0.5) : L.sky ?? t.palette.bg), col(L.ground ?? t.palette.accent2), L.time === 'night' ? 1.6 : 1.3));
  scene.add(new AmbientLight(0xffffff, L.time === 'night' ? 0.35 : 0.25));
}

function camera(t: Tokens, aspect: number, target: Vector3, span: number): PerspectiveCamera | OrthographicCamera {
  const c = t.camera ?? {};
  const pitch = ((c.pitch ?? 50) * Math.PI) / 180;
  const dist = Math.max(span * 0.55, (c.distance ?? 20) * (span / 20));
  const yaw = c.angle === 'side' ? 0 : c.angle === 'iso' ? Math.PI / 4 : Math.PI / 7;
  const pos = new Vector3(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist).add(target);
  let cam: PerspectiveCamera | OrthographicCamera;
  if (c.projection === 'orthographic') { const h = span * 0.42; cam = new OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.1, dist * 4); }
  else cam = new PerspectiveCamera(c.fov ?? 40, aspect, 0.1, dist * 6);
  cam.position.copy(pos); cam.lookAt(target);
  return cam;
}

/** The procedural stand-ins: a character at the decided proportions, a tree, a rock and a pick-up, in the palette. */
function standIns(t: Tokens): { character: Group; tree: Group; rock: Mesh; gem: Mesh } {
  const p = t.palette;
  const heads = t.proportions?.heads ?? 2.5; const h = t.proportions?.heightM ?? 1;
  const head = h / heads;
  const round = (t.shape?.language ?? 'round') === 'round'; const blocky = t.shape?.language === 'blocky';
  const ch = new Group();
  const body = new Mesh(blocky ? new CylinderGeometry(head * 0.55, head * 0.6, h - head, 4) : new CapsuleGeometry(head * 0.5, Math.max(0.01, h - head * 2), 6, round ? 14 : 6), new MeshStandardMaterial({ color: col(p.accent) }));
  body.position.y = (h - head) / 2 + (blocky ? 0 : head * 0.15);
  const hd = new Mesh(blocky ? new CylinderGeometry(head * 0.55, head * 0.55, head, 4) : new SphereGeometry(head * 0.55, round ? 18 : 7, round ? 14 : 5), new MeshStandardMaterial({ color: col(p.ramp?.[10] ?? p.ink) }));
  hd.position.y = h - head * 0.5;
  const eye = new MeshStandardMaterial({ color: col(p.bg) });
  for (const s of [-1, 1]) { const e = new Mesh(new SphereGeometry(head * 0.08, 8, 6), eye); e.position.set(s * head * 0.2, h - head * 0.45, head * 0.48); ch.add(e); }
  ch.add(body, hd);
  const tree = new Group();
  const trunk = new Mesh(new CylinderGeometry(0.12, 0.18, 1.2, round ? 8 : 5), new MeshStandardMaterial({ color: col(p.ramp?.[6] ?? '#6b4a2f') }));
  trunk.position.y = 0.6;
  const crown = new Mesh(round ? new IcosahedronGeometry(1.0, 1) : new ConeGeometry(0.9, 2.2, 6), new MeshStandardMaterial({ color: col(p.accent2) }));
  crown.position.y = round ? 1.9 : 2.2;
  tree.add(trunk, crown);
  const rock = new Mesh(new IcosahedronGeometry(0.55, 0), new MeshStandardMaterial({ color: col(mixHex(p.bg, '#9a9a9a', 0.55)) }));
  rock.scale.set(1.3, 0.75, 1.1); rock.position.y = 0.32;
  const gem = new Mesh(new OctahedronGeometry(0.28, 0), new MeshStandardMaterial({ color: col(p.gold), emissive: col(p.gold), emissiveIntensity: t.light?.time === 'night' ? 1.4 : (t.light?.bloom ?? 0) > 0.2 ? 0.6 : 0.15 }));
  gem.position.y = 0.55;
  return { character: ch, tree, rock, gem };
}

async function fontsReady(t: Tokens): Promise<void> {
  const fams = [t.fonts?.display, t.fonts?.body].filter(Boolean) as string[];
  if (!fams.length) return;
  const href = `https://fonts.googleapis.com/css2?${fams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`).join('&')}&display=block`;
  if (!document.querySelector(`link[href="${href}"]`)) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href;
    // The @font-face rules exist only once the stylesheet has loaded: wait for it, then for the faces.
    await new Promise((r) => { l.onload = r; l.onerror = r; setTimeout(r, 5000); document.head.appendChild(l); });
  }
  await Promise.race([Promise.all(fams.map((f) => document.fonts.load(`700 40px "${f}"`))), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
}

function snapshot(w: number, h: number, scene: Scene, cam: PerspectiveCamera | OrthographicCamera, pixel = false): HTMLCanvasElement {
  const scale = pixel ? 0.25 : 1;
  renderer.setPixelRatio(1);
  renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
  renderer.render(scene, cam);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d') as CanvasRenderingContext2D;
  g.imageSmoothingEnabled = !pixel;
  g.drawImage(canvas, 0, 0, w, h);
  return out;
}

/* ------------------------------------------------------------------ swatch */

async function swatch(t: Tokens, models: ModelIn[] = [], opts: { title?: string; w?: number; h?: number } = {}): Promise<string> {
  const w = opts.w ?? 960; const h = opts.h ?? 540;
  const p = t.palette;
  const scene = new Scene();
  const L = t.light ?? {};
  scene.background = skyTexture(L.sky ?? mixHex(p.bg, '#ffffff', 0.3), mixHex(L.sky ?? p.bg, p.bg, 0.6));
  renderer.toneMapping = t.materials?.model === 'pbr' ? ACESFilmicToneMapping : NoToneMapping;
  const span = 9;
  scene.fog = new Fog(col(L.sky ?? p.bg), span * (2.6 - (L.fog ?? 0.3) * 1.2), span * (5.2 - (L.fog ?? 0.3) * 2));
  lights(scene, t, span * 2);
  const ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: col(L.ground ?? p.accent2), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const world = new Group();
  const s = standIns(t);
  s.character.position.set(0, 0, 0.6);
  s.tree.position.set(-2.6, 0, -1.6);
  s.rock.position.set(2.2, 0.32, -0.6);
  s.gem.position.set(1.0, 0.55, 1.6);
  world.add(s.character, s.tree, s.rock, s.gem);
  // At night (or with a lot of glow) the world is lit by its own lamps: a warm light by the pick-up and one by the path.
  if (L.time === 'night' || (L.bloom ?? 0) > 0.3) {
    for (const [x, y, z, k] of [[1.0, 1.2, 1.6, 6], [-1.2, 1.6, -0.4, 4]] as const) { const pl = new PointLight(col(mixHex(p.gold, '#ffffff', 0.25)), k, 7, 1.6); pl.position.set(x, y, z); scene.add(pl); }
  }
  // A second tree and rock, so the scene reads as a place.
  const t2 = s.tree.clone(); t2.position.set(3.4, 0, -3.2); t2.scale.setScalar(1.25); world.add(t2);
  const r2 = s.rock.clone(); r2.position.set(-1.4, 0.2, 2.4); r2.scale.multiplyScalar(0.6); world.add(r2);
  // The library family's own pieces, at their true size, around the edge.
  const spots = [[-4.6, -0.2], [4.8, 0.8], [-3.2, 2.6], [2.8, 3.0], [-0.6, -3.6], [5.6, -2.2]];
  let i = 0;
  for (const m of models.slice(0, spots.length)) {
    try {
      const g = await parse(m);
      const b = boxOf(g); const size = b.getSize(new Vector3());
      const fit = size.y > 4 ? 4 / size.y : 1; g.scale.setScalar(fit);
      const [x, z] = spots[i++] as [number, number];
      g.position.set(x, -b.min.y * fit, z);
      world.add(g);
    } catch { /* a model that does not parse is left out of the picture */ }
  }
  // The family's own pieces in this direction's palette: what a palette swap does for free.
  for (const piece of world.children.filter((c) => c.name && c.name !== '' && models.some((m) => m.id === c.name))) retint(piece, [...(t.palette.ramp ?? []), t.palette.accent, t.palette.accent2, t.palette.gold, t.palette.good]);
  restyle(world, t, span / 9);
  scene.add(world);
  const cam = camera(t, w / h, new Vector3(0, 0.8, 0), span);
  const shot = snapshot(w, h, scene, cam, t.render === 'pixel-hd2d');
  await fontsReady(t);
  const g = shot.getContext('2d') as CanvasRenderingContext2D;
  // The title in the display font, and the palette as chips: what the codex, landing and HUD will wear.
  const display = t.fonts?.display ? `"${t.fonts.display}", ` : '';
  g.fillStyle = 'rgba(0,0,0,0.0)';
  const band = Math.round(h * 0.2);
  const grad = g.createLinearGradient(0, h - band, 0, h); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, `${p.bg}e6`);
  g.fillStyle = grad; g.fillRect(0, h - band, w, band);
  g.font = `700 ${Math.round(h * 0.075)}px ${display}system-ui, sans-serif`;
  g.fillStyle = p.ink; g.textBaseline = 'alphabetic';
  g.fillText(opts.title ?? 'Your game', Math.round(w * 0.035), h - Math.round(h * 0.07));
  const chips = [p.bg, p.ink, p.accent, p.accent2, p.danger, p.good, p.gold];
  const cs = Math.round(h * 0.05);
  chips.forEach((c, k) => { g.fillStyle = c; g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2; const x = w - Math.round(w * 0.035) - (chips.length - k) * (cs + 6); const y = h - Math.round(h * 0.07) - cs; g.beginPath(); g.roundRect(x, y, cs, cs, 6); g.fill(); g.stroke(); });
  disposeScene(scene);
  return shot.toDataURL('image/jpeg', 0.86);
}

/* ------------------------------------------------------------------ lineup */

interface LineupRow { id: string; label: string; size: number[]; silhouette: { fill: number; widthPx: number; heightPx: number } }

async function lineup(models: ModelIn[], t: Tokens, opts: { w?: number; h?: number } = {}): Promise<{ front: string; quarter: string; silhouettes: string; rows: LineupRow[] }> {
  const w = opts.w ?? 1280; const h = opts.h ?? 640;
  const p = t.palette;
  const parsed: { m: ModelIn; g: Group; size: Vector3 }[] = [];
  for (const m of models) {
    try { const g = await parse(m); if (m.tint) tintAll(g, m.tint); else if (m.retint || m.pull) retint(g, [...(p.ramp ?? []), p.accent, p.accent2, p.gold, p.good], m.pull ?? 1); restyle(g, t, Math.max(0.1, ...boxOf(g).getSize(new Vector3()).toArray()), Math.min(0.05, 0.06 * Math.max(...boxOf(g).getSize(new Vector3()).toArray()) * (m.scale && m.scale > 0 ? m.scale : 1)), m.scale && m.scale > 0 ? m.scale : 1); if (m.scale && m.scale > 0) { g.scale.multiplyScalar(m.scale); g.updateMatrixWorld(true); } const b = boxOf(g); g.position.y -= b.min.y; g.position.x -= (b.min.x + b.max.x) / 2; g.position.z -= (b.min.z + b.max.z) / 2; parsed.push({ m, g, size: b.getSize(new Vector3()) }); } catch { /* skipped */ }
  }
  const gap = 0.5;
  const room = 0.45; // under each shelf, for its labels
  const widthOf = (it: { size: Vector3 }): number => Math.max(0.3, it.size.x);
  const rowWidth = (row: typeof parsed): number => row.reduce((n, it) => n + widthOf(it), 0) + gap * Math.max(0, row.length - 1);
  const rowTall = (row: typeof parsed): number => Math.max(0.5, ...row.map((it) => it.size.y));
  // Many assets: shelves. The row is cut, in order, into the number of shelves that draws them largest, every shelf at
  // the same scale against the same 1 m grid (front view); in the three-quarter view the shelves stand as ranks.
  const split = (n: number): (typeof parsed)[] => {
    const target = rowWidth(parsed) / n;
    const out: (typeof parsed)[] = [[]];
    for (const it of parsed) {
      const cur = out[out.length - 1] as typeof parsed;
      if (cur.length && out.length < n && rowWidth([...cur, it]) > target * 1.04) out.push([it]); else cur.push(it);
    }
    return out;
  };
  let shelves: (typeof parsed)[] = [parsed];
  let best = 0;
  for (let n = 1; n <= Math.min(6, parsed.length); n++) {
    const cut = split(n);
    const fit = Math.min(w / Math.max(...cut.map(rowWidth)), h / cut.reduce((a, r) => a + rowTall(r) + room, 0));
    if (fit > best * 1.05) { best = fit; shelves = cut; }
  }
  const total = Math.max(...shelves.map(rowWidth));
  const tall = Math.max(1, ...parsed.map((x) => x.size.y));
  const stackH = shelves.reduce((a, r) => a + rowTall(r) + room, 0);
  const deep = Math.max(1, ...parsed.map((x) => x.size.z));
  const extent = Math.max(total, stackH, shelves.length * (deep + 1.2));
  const scene = new Scene();
  scene.background = col(mixHex(p.bg, '#ffffff', 0.08));
  renderer.toneMapping = NoToneMapping;
  lights(scene, t, extent * 1.5);
  const cells = Math.ceil(extent + 4);
  const grid = new GridHelper(cells, cells, col(mixHex(p.ink, p.bg, 0.4)), col(mixHex(p.ink, p.bg, 0.75)));
  scene.add(grid);
  // A 1 m grid stood up behind the row: heights read against it.
  const back = new GridHelper(cells + (cells % 2), cells + (cells % 2), col(mixHex(p.ink, p.bg, 0.5)), col(mixHex(p.ink, p.bg, 0.8)));
  back.rotation.x = Math.PI / 2;
  scene.add(back);
  const floor = new Mesh(new PlaneGeometry(200, 200), new MeshStandardMaterial({ color: col(mixHex(p.bg, '#ffffff', 0.12)), roughness: 1, side: DoubleSide }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.002; floor.receiveShadow = true;
  scene.add(floor);
  const base = new Map(parsed.map((it) => [it, it.g.position.clone()]));
  const row = new Group();
  for (const it of parsed) row.add(it.g);
  row.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  scene.add(row);
  // place(shelf k at height y, depth z): x across, centred; returns each asset's centre x for its label.
  const placed: { it: (typeof parsed)[number]; cx: number; y: number }[] = [];
  const place = (front: boolean): void => {
    placed.length = 0;
    let y = stackH;
    shelves.forEach((r, k) => {
      y -= rowTall(r) + room;
      const by = front ? y + room : 0;
      const z = front ? 0 : -k * (deep + 1.2);
      let x = -rowWidth(r) / 2;
      for (const it of r) {
        const wd = widthOf(it); const b0 = base.get(it) as Vector3;
        it.g.position.set(b0.x + x + wd / 2, b0.y + by, b0.z + z);
        placed.push({ it, cx: x + wd / 2, y: by });
        x += wd + gap;
      }
    });
    floor.visible = !front || shelves.length === 1;
    grid.visible = floor.visible;
    // The standing grid behind the last rank.
    back.position.set(0, (cells + (cells % 2)) / 2, (front ? 0 : -(shelves.length - 1) * (deep + 1.2)) - deep / 2 - 0.3);
  };
  // The front view fits the widest shelf and the stack, the lowest floor near the bottom edge.
  place(true);
  const halfH = Math.max((total / 2) * 1.06 * (h / w), (stackH / 2) * 1.07 + 0.05, shelves.length === 1 ? tall * 0.6 : 0);
  const halfW = halfH * (w / h);
  const camY = shelves.length === 1 ? halfH - tall * 0.08 : stackH / 2;
  const front = new OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200);
  front.position.set(0, camY, 50); front.lookAt(0, camY, 0);
  const f = snapshot(w, h, scene, front);
  place(false);
  const span = Math.max(total, tall * 1.6, shelves.length * (deep + 1.2));
  const quarter = new PerspectiveCamera(30, w / h, 0.1, 400);
  const d = span * (shelves.length > 1 ? 1.7 : 1.55);
  const mid = -((shelves.length - 1) * (deep + 1.2)) / 2;
  quarter.position.set(d * 0.45, d * 0.42, mid + d * 0.78); quarter.lookAt(0, tall * 0.35, mid);
  const q = snapshot(w, h, scene, quarter);
  place(true);
  // Labels under each asset in the front view (several lines when the names are wide for their place).
  const fg = f.getContext('2d') as CanvasRenderingContext2D;
  const px = w / (2 * halfW);
  const fontPx = Math.max(10, Math.min(15, Math.round(px * 0.28)));
  fg.font = `600 ${fontPx}px system-ui, sans-serif`; fg.fillStyle = p.ink; fg.textAlign = 'center';
  for (const { it, cx, y } of placed) {
    const sx = (cx + halfW) * px;
    const sy = (camY + halfH - y) * px + fontPx + 2;
    const room2 = Math.max(36, (widthOf(it) + gap) * px * 0.92);
    const name = it.m.label ?? it.m.id; const size = `${it.size.y.toFixed(2)} m`;
    if (fg.measureText(`${name} · ${size}`).width <= room2) fg.fillText(`${name} · ${size}`, sx, Math.min(h - 6, sy));
    else {
      let short = name;
      while (short.length > 3 && fg.measureText(short).width > room2) short = `${short.slice(0, -2)}…`;
      fg.fillText(short, sx, Math.min(h - fontPx - 8, sy)); fg.fillText(size, sx, Math.min(h - 6, sy + fontPx + 1));
    }
  }
  // Silhouettes: each alone, black on white, 64 px tall, side by side.
  const cell = 96;
  const sil = document.createElement('canvas'); sil.width = Math.max(cell, parsed.length * cell); sil.height = cell + 22;
  const sg = sil.getContext('2d') as CanvasRenderingContext2D;
  sg.fillStyle = '#ffffff'; sg.fillRect(0, 0, sil.width, sil.height);
  const rows: LineupRow[] = [];
  const black = new MeshBasicMaterial({ color: 0x000000 });
  const solo = new Scene(); solo.background = new Color('#ffffff');
  for (let k = 0; k < parsed.length; k++) {
    const it = parsed[k] as (typeof parsed)[number];
    // A skinned character's copy needs its own bones (a plain clone would draw with the original's, elsewhere).
    const clone = cloneSkinned(it.g);
    clone.position.set(0, 0, 0);
    clone.traverse((o) => { const m = o as Mesh; if (m.isMesh) m.material = black; });
    solo.add(clone);
    const hh = it.size.y; const ww = Math.max(it.size.x, it.size.z);
    const half = Math.max(hh, ww) / 2 * 1.02;
    const oc = new OrthographicCamera(-half, half, half, -half, 0.01, 100);
    oc.position.set(it.size.x * 0.4, hh / 2, 20); oc.lookAt(0, hh / 2, 0);
    renderer.setPixelRatio(1); renderer.setSize(64, 64, false); renderer.render(solo, oc);
    const px = new Uint8Array(64 * 64 * 4);
    const gl = renderer.getContext(); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let filled = 0; let minX = 64; let maxX = -1; let minY = 64; let maxY = -1;
    for (let yy = 0; yy < 64; yy++) for (let x2 = 0; x2 < 64; x2++) { const i = (yy * 64 + x2) * 4; if ((px[i] as number) < 128) { filled++; minX = Math.min(minX, x2); maxX = Math.max(maxX, x2); minY = Math.min(minY, yy); maxY = Math.max(maxY, yy); } }
    const bw = maxX - minX + 1; const bh = maxY - minY + 1;
    sg.drawImage(canvas, k * cell + 16, 8, 64, 64);
    sg.fillStyle = '#222'; sg.font = '600 11px system-ui, sans-serif'; sg.textAlign = 'center'; sg.fillText((it.m.label ?? it.m.id).slice(0, 14), k * cell + cell / 2, cell + 14);
    rows.push({ id: it.m.id, label: it.m.label ?? it.m.id, size: [it.size.x, it.size.y, it.size.z].map((v) => +v.toFixed(3)), silhouette: { fill: bw > 0 && bh > 0 ? +(filled / (bw * bh)).toFixed(3) : 0, widthPx: Math.max(0, bw), heightPx: Math.max(0, bh) } });
    solo.remove(clone);
  }
  disposeScene(scene);
  return { front: f.toDataURL('image/jpeg', 0.88), quarter: q.toDataURL('image/jpeg', 0.88), silhouettes: sil.toDataURL('image/png'), rows };
}

/* ------------------------------------------------------------------ thumbnail */

async function thumb(m: ModelIn, opts: { size?: number; bg?: string } = {}): Promise<{ image: string; size: number[] }> {
  const s = opts.size ?? 256;
  const g = await parse(m);
  const b = boxOf(g); const size = b.getSize(new Vector3()); const c = b.getCenter(new Vector3());
  g.position.sub(new Vector3(c.x, b.min.y, c.z));
  const scene = new Scene(); scene.background = col(opts.bg ?? '#e9e6df');
  renderer.toneMapping = NoToneMapping;
  const r = Math.max(size.x, size.y, size.z);
  lights(scene, { palette: { bg: '#e9e6df', ink: '#222', accent: '#888', accent2: '#cfc8b8', danger: '#c33', good: '#3a3', gold: '#ec3' }, light: { key: [-0.6, -1, -0.5], intensity: 2.4, hardness: 0.4, sky: '#ffffff', ground: '#bfb6a6' } }, r * 3);
  const floor = new Mesh(new PlaneGeometry(r * 20, r * 20), new MeshStandardMaterial({ color: col(opts.bg ?? '#e9e6df'), roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  g.traverse((o) => { const mm = o as Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } });
  scene.add(g);
  // Framed by the bounding sphere, so a box-shaped model's near corner is never cut.
  const radius = Math.max(0.001, size.length() / 2);
  const cam = new PerspectiveCamera(30, 1, radius * 0.01, radius * 60);
  const d = (radius / Math.sin((30 * Math.PI) / 360)) * 1.08;
  const dir = new Vector3(0.6, 0.45, 0.75).normalize();
  cam.position.copy(dir.multiplyScalar(d)).add(new Vector3(0, size.y / 2, 0)); cam.lookAt(0, size.y / 2, 0);
  const shot = snapshot(s, s, scene, cam);
  disposeScene(scene);
  return { image: shot.toDataURL('image/webp', 0.82), size: [size.x, size.y, size.z].map((v) => +v.toFixed(3)) };
}

/* ------------------------------------------------------------------ frames of a clip */

/**
 * A character playing its clips: for each verb, `count` frames spread over the clip (a loop's last frame is its first,
 * so it is left out), seen three-quarter on a ground under the game's light, each `size` pixels square. The card's
 * looping previews are made from these (lib/characters.mjs joins them into an animated WebP); `sheet` puts every verb
 * in a row on one picture for a person to look at.
 */
async function frames(m: ModelIn, t: Tokens, opts: { verbs?: string[]; count?: number; size?: number; sheet?: boolean; loops?: string[] } = {}): Promise<{ verbs: { verb: string; duration: number; frames: string[] }[]; sheet: string | null; missing: string[] }> {
  const size = opts.size ?? 160; const count = Math.max(2, Math.min(24, opts.count ?? 12));
  const g = await parse({ ...m, pose: undefined, anims: m.anims });
  const clips = (g.userData.clips ?? []) as AnimationClip[];
  const want = opts.verbs?.length ? opts.verbs : clips.map((c) => c.name);
  const p = t.palette;
  const scene = new Scene(); scene.background = col(mixHex(p.bg, '#ffffff', 0.1));
  renderer.toneMapping = NoToneMapping;
  const b = boxOf(g); const sz = b.getSize(new Vector3()); const c = b.getCenter(new Vector3());
  g.position.sub(new Vector3(c.x, b.min.y, c.z));
  const tall = Math.max(0.1, sz.y);
  lights(scene, t, tall * 4);
  const floor = new Mesh(new PlaneGeometry(tall * 40, tall * 40), new MeshStandardMaterial({ color: col(t.light?.ground ?? mixHex(p.accent2, p.bg, 0.5)), roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  g.traverse((o) => { const mm = o as Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = false; mm.frustumCulled = false; } });
  scene.add(g);
  const cam = new PerspectiveCamera(30, 1, tall * 0.02, tall * 60);
  const d = tall * 3.1;
  cam.position.set(d * 0.55, tall * 0.55 + d * 0.32, d * 0.78); cam.lookAt(0, tall * 0.45, 0);
  const mixer = new AnimationMixer(g);
  const out: { verb: string; duration: number; frames: string[] }[] = [];
  const missing: string[] = [];
  for (const verb of want) {
    const clip = clips.find((x) => x.name === verb);
    if (!clip) { missing.push(verb); continue; }
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    const loop = (opts.loops ?? []).includes(verb);
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity); action.clampWhenFinished = true; action.reset().play();
    const shots: string[] = [];
    for (let i = 0; i < count; i++) {
      const at = loop ? (clip.duration * i) / count : (clip.duration * i) / (count - 1);
      mixer.setTime(Math.min(clip.duration - 1e-4, at));
      g.updateMatrixWorld(true);
      shots.push(snapshot(size, size, scene, cam).toDataURL('image/png'));
    }
    action.stop();
    out.push({ verb, duration: +clip.duration.toFixed(3), frames: shots });
  }
  let sheet: string | null = null;
  if (opts.sheet && out.length) {
    const sc = document.createElement('canvas'); sc.width = size * count + 90; sc.height = size * out.length;
    const sg = sc.getContext('2d') as CanvasRenderingContext2D;
    sg.fillStyle = '#ffffff'; sg.fillRect(0, 0, sc.width, sc.height);
    for (let r = 0; r < out.length; r++) {
      const row = out[r] as (typeof out)[number];
      sg.fillStyle = '#222'; sg.font = '600 13px system-ui, sans-serif'; sg.fillText(row.verb, 6, r * size + size / 2);
      for (let k = 0; k < row.frames.length; k++) { const im = new Image(); im.src = row.frames[k] as string; await im.decode(); sg.drawImage(im, 90 + k * size, r * size); }
    }
    sheet = sc.toDataURL('image/jpeg', 0.85);
  }
  disposeScene(scene);
  return { verbs: out, sheet, missing };
}

function disposeScene(scene: Scene): void {
  scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) { m.geometry?.dispose(); const mats = Array.isArray(m.material) ? m.material : [m.material]; for (const x of mats) x?.dispose(); } });
}

(window as unknown as { homieRender: unknown }).homieRender = { swatch, lineup, thumb, frames, ready: true };
