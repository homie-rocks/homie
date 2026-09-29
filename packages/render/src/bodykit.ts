/**
 * ============================================================================
 *  bodykit — the SMALL-BODY substrate the two racers share.
 * ============================================================================
 *  Seven declarations that stood byte-identical (comment wording aside) at the
 *  top of the projectile code in a kart racer and in a space racer: a 2D-canvas
 *  pair, its upload settings, a Sobel normal generator, a radial falloff
 *  sprite, and two geometry builders. Both games' projectile and item code
 *  stand on it — one visual language for every small object the item system
 *  puts on screen.
 *
 *  The BODIES those seven build are disjoint and are staying where they are.
 *  The kart racer throws its items at 33 m/s in the world frame under world
 *  gravity; the space racer fires eight weapons at up to 320
 *  m/s in the LAUNCHER'S frame, under no world gravity at all, curving along
 *  the deck normal instead. That is not two tunings of one thing, it is a
 *  different physics frame, and their own file headers argue it at length. The
 *  substrate never diverged; the ordnance did.
 *
 * ----------------------------------------------------------------------------
 *  `normalFromHeight` IS NOT `canvastex.ts`'s `normalFromHeight`
 * ----------------------------------------------------------------------------
 *  THE TWO FUNCTIONS SHARE A NAME AND ARE NOT THE SAME FUNCTION. This package
 *  now exports both, from two files, and picking the wrong one compiles
 *  cleanly, throws nothing, and silently recomputes every normal map on every
 *  prop in both racers. Three separate differences, any one of them fatal:
 *
 *    · KERNEL. This one is a full 8-tap Sobel. `canvastex`'s is a 2-tap
 *      central difference. Different gradients, so different normals.
 *    · WRAP. This one wraps in u and CLAMPS in v, because everything it
 *      dresses is a body of revolution whose UVs do exactly that. Ten lines up
 *      from here, `at()` is written to that rule. `canvastex`'s wraps in both,
 *      because it dresses tiling surfaces.
 *    · TEXTURE CLASS. This returns a `THREE.DataTexture` and configures its
 *      mips by hand (see the note in the body — the default is a normal map
 *      that crawls). `canvastex`'s returns a `THREE.CanvasTexture` through
 *      `finish()` and takes an `aniso` argument this one has no parameter for.
 *
 *  `canvastex.ts`'s own header sprang this trap once already, on `hash2`: a
 *  same-named function is not the same function. It is written down twice now
 *  because it has been true twice.
 *
 *  THE `!` ON THE TYPED-ARRAY READ. Identical reasoning to `canvastex.ts` and
 *  `Textures.ts`, whose comments state it at length: the games run
 *  `strict: false`, this package runs `noUncheckedIndexedAccess`, and `!`
 *  erases at emit — so the JavaScript that ships is character-for-character
 *  what the two games shipped. `at()` below wraps modulo `size` and clamps v,
 *  so its index is in range by construction. Widen that loop and the assertion
 *  is what you have to re-earn; the compiler will not ask you again.
 * ============================================================================
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Procedural texture kit
// ---------------------------------------------------------------------------

export interface Pad {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  size: number;
}

export function pad(size: number): Pad {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g, size };
}

export function padTexture(p: Pad, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(p.c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Sobel a height field into a tangent-space normal map. Wraps in u (these are
 * all bodies of revolution) and clamps in v, matching the geometry's UVs.
 *
 * NOT `canvastex.ts`'s function of the same name — see the header.
 */
export function normalFromHeight(h: Float32Array, size: number, strength: number): THREE.DataTexture {
  const px = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => {
    const xx = ((x % size) + size) % size;
    const yy = y < 0 ? 0 : y >= size ? size - 1 : y;
    return h[yy * size + xx]!;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      let nx = -dx * strength;
      let ny = -dy * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      nx *= inv; ny *= inv;
      const i = (y * size + x) * 4;
      px[i] = Math.round((nx * 0.5 + 0.5) * 255);
      px[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      px[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      px[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  // DataTexture defaults to NearestFilter with no mips. On a body of revolution
  // spinning past the camera that is a normal map that crawls and sparkles at
  // every distance — the aliasing tell both games' art direction rules out —
  // and it is a one-line fix that costs a third of a small texture.
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Radial falloff sprite, used for glows and the ground blobs. */
export function radialSprite(size: number, inner: number, gamma: number): THREE.CanvasTexture {
  const p = pad(size);
  const img = p.g.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const r = Math.hypot(dx, dy);
      let a = 1 - Math.max(0, (r - inner) / Math.max(1e-3, 1 - inner));
      a = Math.pow(Math.max(0, Math.min(1, a)), gamma);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  p.g.putImageData(img, 0, 0);
  const t = padTexture(p, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------------------
// Geometry builders
// ---------------------------------------------------------------------------

/**
 * Solid of revolution from a profile in (radius, height). Every profile the
 * two games feed this carries a deliberate chamfer at its silhouette edges — a
 * hard 90° lip catches no specular, and under the space racer's 0.18° key it
 * is the loudest amateur tell available.
 */
export function lathe(profile: number[][], segments: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (const [r, y] of profile) pts.push(new THREE.Vector2(Math.max(1e-4, r!), y!));
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

/**
 * Box with rounded edges. A subdivided cube pushed onto the offset surface of
 * its own inner core — cheap, exact, and it gives every edge a highlight.
 */
export function roundedBox(size: number, radius: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
  const p = g.attributes.position as THREE.BufferAttribute;
  const h = size * 0.5;
  const core = h - radius;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const cx = Math.max(-core, Math.min(core, v.x));
    const cy = Math.max(-core, Math.min(core, v.y));
    const cz = Math.max(-core, Math.min(core, v.z));
    const dx = v.x - cx, dy = v.y - cy, dz = v.z - cz;
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-6) {
      const s = radius / l;
      p.setXYZ(i, cx + dx * s, cy + dy * s, cz + dz * s);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * The paint for a body of revolution: a banded albedo down the profile, a
 * spatially varying roughness, a normal map off the turning marks, and an
 * emissive band wherever the design wants light. One generator instead of one
 * canvas routine per body, because N near-identical canvas routines is N places
 * for a palette to drift.
 *
 * EVERY COLOUR AND EVERY COUNT IS THE CALLER'S. There is no default anywhere in
 * `BodyPaintSpec` and there deliberately never will be: a default here is one
 * game's art direction shipped to the next one, which is the exact failure
 * `groundblob`'s AO tint already cost this repo. The function owns the
 * MECHANISM — the gradient walk, the wrapped turning marks and the height field
 * they write, the black-body/lit-band emissive, the speckled roughness — and
 * owns no look at all.
 *
 * `hotV` is where along the profile (v, 0 = nose) the emissive band sits and
 * `hotW` its half-width. `S` is the albedo edge; the emissive and roughness
 * pads are half that, since neither carries anything smaller than a band.
 */
export interface BodyPaintSpec {
  /** the body colour, and the darker colour at the profile's ends */
  base: string; trim: string;
  /** the emissive band's colour, its centre in v and its half-width */
  hot: string; hotV: number; hotW: number;
  /** the four albedo gradient stops, in v */
  bandStops: [number, number, number, number];
  /** turning marks: how many rings, their alpha, their two alternating
   *  colours, the ring's height in v, and how deep it cuts the height field */
  rings: number; ringAlpha: number; ringLight: string; ringDark: string;
  ringH: number; ringCut: number;
  /** stencil ticks: colour, alpha, and the two rects in fractions of S */
  stencil: string; stencilAlpha: number;
  stencilRects: readonly (readonly [number, number, number, number])[];
  /** the emissive pad's unlit colour */
  dark: string;
  /** the four roughness gradient stops, and their greys */
  roughStops: [number, number, number, number];
  roughGreys: [string, string, string, string];
  /** roughness speckle: count, alpha, its two colours and its radius range */
  speckles: number; speckleAlpha: number;
  speckleLight: string; speckleDark: string;
  speckleR0: number; speckleR1: number;
  /** Sobel strength for the turning marks */
  normalStrength: number;
}

export function bodyPaint(S: number, s: BodyPaintSpec): {
  map: THREE.CanvasTexture; emissive: THREE.CanvasTexture;
  rough: THREE.CanvasTexture; nrm: THREE.DataTexture;
} {
  const alb = pad(S);
  const g = alb.g;
  const grd = g.createLinearGradient(0, 0, 0, S);
  grd.addColorStop(s.bandStops[0], s.trim);
  grd.addColorStop(s.bandStops[1], s.base);
  grd.addColorStop(s.bandStops[2], s.base);
  grd.addColorStop(s.bandStops[3], s.trim);
  grd.addColorStop(1.00, s.base);
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);

  // Machined turning marks around the body, wrapped in u. A constant roughness
  // on anything with area reads as plastic; this is what decides whether a
  // metre-scale spindle reads as milled metal at the distance it is seen.
  const height = new Float32Array(S * S);
  g.globalAlpha = s.ringAlpha;
  for (let i = 0; i < s.rings; i++) {
    const v = (i / s.rings) * S;
    g.fillStyle = i % 3 === 0 ? s.ringLight : s.ringDark;
    g.fillRect(0, v, S, S * s.ringH);
    const row = Math.round(v);
    for (let x = 0; x < S; x++) if (row >= 0 && row < S) height[row * S + x]! -= s.ringCut;
  }
  g.globalAlpha = 1;

  // Stencilled serial ticks. At this texel density they are a couple of pixels;
  // they exist to break the band, not to be read.
  g.fillStyle = s.stencil;
  g.globalAlpha = s.stencilAlpha;
  for (const r of s.stencilRects) g.fillRect(S * r[0], S * r[1], S * r[2], S * r[3]);
  g.globalAlpha = 1;

  // --- emissive: the band only ---------------------------------------------
  // Black body, lit band. An emissive whole body is a lamp, and a lamp the size
  // of a projectile blooms into a formless dot at any distance.
  const ep = pad(S >> 1);
  const eg = ep.g;
  eg.fillStyle = s.dark;
  eg.fillRect(0, 0, ep.size, ep.size);
  const eGrd = eg.createLinearGradient(0, (s.hotV - s.hotW) * ep.size, 0, (s.hotV + s.hotW) * ep.size);
  eGrd.addColorStop(0.0, s.dark);
  eGrd.addColorStop(0.5, s.hot);
  eGrd.addColorStop(1.0, s.dark);
  eg.fillStyle = eGrd;
  eg.fillRect(0, (s.hotV - s.hotW) * ep.size, ep.size, s.hotW * 2 * ep.size);

  // --- roughness ------------------------------------------------------------
  const rp = pad(S >> 1);
  const rg = rp.g;
  const R = rp.size;
  const rgrd = rg.createLinearGradient(0, 0, 0, R);
  for (let i = 0; i < 4; i++) rgrd.addColorStop(s.roughStops[i]!, s.roughGreys[i]!);
  rg.fillStyle = rgrd;
  rg.fillRect(0, 0, R, R);
  rg.globalAlpha = s.speckleAlpha;
  for (let i = 0; i < s.speckles; i++) {
    rg.fillStyle = Math.random() > 0.5 ? s.speckleLight : s.speckleDark;
    rg.beginPath();
    rg.arc(Math.random() * R, Math.random() * R,
      s.speckleR0 + Math.random() * s.speckleR1, 0, Math.PI * 2);
    rg.fill();
  }
  rg.globalAlpha = 1;

  return {
    map: padTexture(alb, true),
    emissive: padTexture(ep, true),
    rough: padTexture(rp, false),
    nrm: normalFromHeight(height, S, s.normalStrength),
  };
}

/**
 * ===========================================================================
 *  A TUBE SWEPT ALONG A CIRCULAR ARC, tapered at both ends.
 * ===========================================================================
 *  `lathe` above turns a profile about an axis; this sweeps a section ALONG
 *  one, which is the other half of the same job and the shape nothing in the
 *  kit could make. The frame at each station is built from the arc tangent and
 *  a fixed reference axis rather than by parallel transport — the sweep is
 *  planar, so there is no twist to accumulate and Frenet's degenerate case at
 *  zero curvature cannot arise.
 *
 *  EVERY NUMBER THAT DECIDES WHAT THE OBJECT IS is an argument. The taper
 *  exponent, the waist fraction, the section's aspect and the droop are the
 *  difference between a banana, a croissant, a horn, a handle and a claw, and
 *  a default for any of them would be this kit having an opinion about what
 *  the caller is drawing.
 *
 *  @param arc      radians swept
 *  @param sweepR   radius of the arc the section travels along
 *  @param tubeR    the section's radius at the fattest station
 *  @param nj       stations along the arc
 *  @param ni       segments around the section
 *  @param taperPow exponent on `sin(pi*u)`. Below 1 the taper is blunt and the
 *                  ends read as a stem and a nub; at 1 it is a smooth spindle;
 *                  above 1 the ends draw out to needles.
 *  @param waist    the section radius at the very tips, as a fraction of
 *                  `tubeR`. 0 closes to a point.
 *  @param aspect   the section's minor axis over its major. 1 is a hose.
 *  @param droop    the arc centre is pulled back along +Y by
 *                  `sweepR * droop`, which is what puts the belly of the
 *                  sweep near the origin instead of the arc's own centre.
 * ===========================================================================
 */
export function sweepArc(
  arc: number,
  sweepR: number,
  tubeR: number,
  nj: number,
  ni: number,
  taperPow: number,
  waist: number,
  aspect: number,
  droop: number,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const nx = new THREE.Vector3();
  const bn = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);
  for (let j = 0; j <= nj; j++) {
    const u = j / nj;
    const a = -arc * 0.5 + arc * u;
    c.set(Math.sin(a) * sweepR, Math.cos(a) * sweepR - sweepR * droop, 0);
    tan.set(Math.cos(a), -Math.sin(a), 0).normalize();
    nx.crossVectors(tan, up).normalize();
    bn.crossVectors(nx, tan).normalize();
    const taper = Math.pow(Math.sin(Math.PI * u), taperPow);
    const r = tubeR * (waist + (1 - waist) * taper);
    for (let i = 0; i <= ni; i++) {
      const v = i / ni;
      const th = v * Math.PI * 2;
      const cx = Math.cos(th), sy = Math.sin(th);
      const px = nx.x * cx * r * 1.0 + bn.x * sy * r * aspect;
      const py = nx.y * cx * r * 1.0 + bn.y * sy * r * aspect;
      const pz = nx.z * cx * r * 1.0 + bn.z * sy * r * aspect;
      pos.push(c.x + px, c.y + py, c.z + pz);
      // The section's own outward direction. Normalising the offset is exact
      // for a circular section and very slightly off for an elliptical one;
      // it is what the shipped geometry used and the error at aspect 0.82 is
      // under two degrees, well inside what a specular highlight can show.
      const l = Math.hypot(px, py, pz) || 1;
      nrm.push(px / l, py / l, pz / l);
      uv.push(v, u);
    }
  }
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const a = j * (ni + 1) + i;
      const b = a + ni + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
