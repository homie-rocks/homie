/**
 * ===========================================================================
 *  @homie-rocks/ui/truetype.ts — a stroking pen, a TrueType binary writer, and the
 *  FontFace install path. It draws NO letters and it knows no family.
 * ===========================================================================
 *
 * WHY A GAME MAY NOT SHIP A FONT FILE, WHICH IS WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * One game's first rule is *"zero art assets: every texture, mesh, material
 * and sound is generated in code at load time"*, and a 14 KB blob of somebody
 * else's outlines is an art asset however it is encoded. Every experience
 * built on this engine inherits that rule, so every one of them either sets
 * its interface in a system stack — which is the automatic fail, and is identifiable in the
 * pixels — or builds a real font binary at boot.
 *
 * Building the binary is the hard, general, entirely un-game-specific half:
 * ten hand-rolled tables, a segmented `cmap`, a `loca`/`glyf` pair, and a
 * `checkSumAdjustment` that is a checksum of the file containing it. Nothing in
 * any of that is a colony, a racetrack or a coastline. It sat inside one
 * game's typeface module for a long time purely because that game was the
 * only one that had ever needed it, and a duplication counter cannot see a
 * mechanism that exists once.
 *
 * WHAT STAYED IN THE GAME, AND IT IS THE PART THAT MATTERS TO A PERSON
 * ---------------------------------------------------------------------------
 * The GLYPHS. Every centre-line skeleton, the 532 x-height against a 700 cap
 * that makes a technical grotesque rather than a geometric sans, the slashed
 * zero, which ~90 characters are in the set and which fall through to the
 * platform. That is art direction and it stays where the art direction is.
 *
 * THE CONSTRUCTION, so the next game's author does not re-derive it
 * ---------------------------------------------------------------------------
 * Every glyph is a SKELETON — centre lines, not outlines — stroked to a width
 * that comes from the weight. Strokes are emitted as independent closed
 * contours all wound the same way and left overlapping at the joins; TrueType
 * fills with the NON-ZERO winding rule, so overlapping same-direction contours
 * union for free and no join geometry is needed. Counters are the space the
 * strokes do not cover, so no glyph needs a hole except the true rings (O, o,
 * 0, D…), which emit an outer contour plus a reversed inner one.
 *
 * Every point is ON-CURVE, so `glyf` needs no quadratic control-point
 * bookkeeping and the arcs are already polygonal at a tolerance far under a
 * pixel at interface sizes.
 *
 * EVERY METRIC IS REQUIRED AND NOTHING HAS A DEFAULT
 * ---------------------------------------------------------------------------
 * A game that forgets a spec field should fail to compile, and a game that
 * silently gets a default inherits another game's art direction and it looks
 * completely fine. A default `capHeight` here would be a default
 * TYPEFACE, which is the single loudest thing an interface can inherit by
 * accident. So `FaceMetrics` has twelve required fields and `fixedAdv` is
 * `number | null` rather than optional — "is this family monospaced" is a
 * decision, and it has to be typed as one.
 *
 * IF ANYTHING HERE FAILS, NOTHING IS APPLIED
 * ---------------------------------------------------------------------------
 * `installFaces` resolves false and the caller keeps whatever stack its CSS was
 * authored with. It never half-applies — one family swapped and one not is
 * worse than neither, because it looks deliberate. A rejected `FontFace` is the
 * platform saying the binary is unacceptable, which is a bug in THIS file and
 * not a reason to break an interface somebody is reading.
 */

/** Flat `[x0,y0,x1,y1,…]`, closed implicitly. */
export type Contour = number[];

export interface Glyph {
  /** Advance width in font units. */
  adv: number;
  contours: Contour[];
}

/**
 * The pen. Everything draws through it, in font units, y up.
 *
 * `w` is the stroke width and it is the ONLY thing that changes between a 500
 * and a 700 — which is what makes them one family rather than two fonts that
 * happen to share a name.
 *
 * `sw` is the stroke width for SMALL features — a degree ring, an infinity
 * lobe, a chemistry subscript. It is a CONSTRUCTOR ARGUMENT rather than a
 * formula in here, because the formula is a type designer's judgement and this
 * file has none. The reason it is needed at all is worth keeping: a 112-unit
 * bold stem inside a 100-unit ring leaves a counter of negative width, which
 * does not render as a bold small glyph — it renders as a blob, and in H₂O it
 * renders as a blob in the middle of a resource code.
 */
export class Pen {
  contours: Contour[] = [];
  constructor(readonly w: number, readonly sw: number) {}

  /** Axis-aligned rectangle, counter-clockwise. */
  rect(x0: number, y0: number, x1: number, y1: number): void {
    if (x1 < x0) { const t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { const t = y0; y0 = y1; y1 = t; }
    this.contours.push([x0, y0, x1, y0, x1, y1, x0, y1]);
  }

  /** Vertical stem on a centre line, butt caps (so it stops exactly at y0/y1). */
  v(x: number, y0: number, y1: number): void {
    this.rect(x - this.w / 2, y0, x + this.w / 2, y1);
  }

  /** Horizontal bar on a centre line. */
  h(y: number, x0: number, x1: number): void {
    this.rect(x0, y - this.w / 2, x1, y + this.w / 2);
  }

  /** Diagonal stroke, butt caps. */
  d(x0: number, y0: number, x1: number, y1: number): void {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (this.w / 2), ny = (dx / len) * (this.w / 2);
    this.contours.push([
      x0 - nx, y0 - ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny, x0 + nx, y0 + ny,
    ]);
  }

  /**
   * Elliptical arc, stroked. Angles in degrees, counter-clockwise from +x.
   * `rx`/`ry` are CENTRE-LINE radii, so the ink runs rx ± w/2.
   */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number,
    width?: number): void {
    while (a1 <= a0) a1 += 360;
    const steps = Math.max(4, Math.ceil((a1 - a0) / 11));
    const half = (width === undefined ? this.w : width) / 2;
    const out: number[] = [];
    const inn: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = ((a0 + (a1 - a0) * (i / steps)) * Math.PI) / 180;
      const c = Math.cos(t), s = Math.sin(t);
      // Ellipse normal: gradient of (x/rx)^2+(y/ry)^2, normalised.
      let nx = c / rx, ny = s / ry;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      out.push(cx + rx * c + nx * half, cy + ry * s + ny * half);
      inn.push(cx + rx * c - nx * half, cy + ry * s - ny * half);
    }
    // Outer forward, inner backward: one closed, consistently wound sector.
    for (let i = inn.length - 2; i >= 0; i -= 2) out.push(inn[i]!, inn[i + 1]!);
    this.contours.push(out);
  }

  /** A closed ring: outer contour plus a reversed inner one, so it has a hole. */
  ring(cx: number, cy: number, rx: number, ry: number, width?: number): void {
    const half = (width === undefined ? this.w : width) / 2;
    const steps = 40;
    const o: number[] = [];
    const i2: number[] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      let nx = c / rx, ny = s / ry;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      o.push(cx + rx * c + nx * half, cy + ry * s + ny * half);
      i2.push(cx + rx * c - nx * half, cy + ry * s - ny * half);
    }
    this.contours.push(o);
    // Reversed: winding -1 against the outer +1, which is the hole.
    const rev: number[] = [];
    for (let i = i2.length - 2; i >= 0; i -= 2) rev.push(i2[i]!, i2[i + 1]!);
    this.contours.push(rev);
  }

  /** A dot — a full stop, a colon, a middle dot. Square. */
  dot(x: number, y: number): void {
    const r = this.w * 0.62;
    this.rect(x - r, y - r, x + r, y + r);
  }
}

/* ========================================================================== */
/* The face: what a game has to state before a binary can be written          */
/* ========================================================================== */

/**
 * The vertical and editorial metrics of ONE family. Twelve required fields;
 * see the header for why not one of them has a default.
 */
export interface FaceMetrics {
  /** Design grid. 1000 is the usual choice for a quadratic outline font. */
  unitsPerEm: number;
  capHeight: number;
  xHeight: number;
  /** Top of the tallest lowercase ascender. */
  ascender: number;
  /** NEGATIVE. Bottom of the deepest descender. */
  descender: number;
  /** Typographic leading between lines. */
  lineGap: number;
  /**
   * `hhea.ascender` and `OS/2.usWinAscent`. Usually a little above `ascender`,
   * and it is the number a browser lays a line box out with — so it is the one
   * that decides whether two stacked readouts touch.
   */
  winAscent: number;
  /** `OS/2.xAvgCharWidth`. Advisory, and some layout engines still read it. */
  avgCharWidth: number;
  /** NEGATIVE, from the baseline. */
  underlinePosition: number;
  underlineThickness: number;
  /** `OS/2.achVendID`. EXACTLY four ASCII characters. */
  vendor: string;
  /** Namespace for name id 3, the unique font identifier. */
  uniqueIdPrefix: string;
}

export interface FaceSpec {
  family: string;
  /** Subfamily — "Medium", "Bold". */
  sub: string;
  /** `OS/2.usWeightClass`. 700 and above sets the bold bits. */
  weight: number;
  /** Stroke width in font units. The only parameter separating the weights. */
  stem: number;
  /** Stroke width for small features. See `Pen`'s `sw`. */
  smallStem: number;
  /**
   * Fixed advance, for a monospaced family; glyphs are centred inside it.
   * `null` for a proportional family. NOT optional — see the header.
   */
  fixedAdv: number | null;
}

/** One entry of a glyph set: `[advance, draw]`, keyed by the character. */
export type GlyphEntry = readonly [number, (pen: Pen) => void];

/**
 * The glyph set, keyed by character exactly as a game authors it. Code point
 * order — which `cmap` requires and nothing else does — is worked out in here,
 * so a game never has to keep its table sorted.
 */
export type GlyphSet = Readonly<Record<string, GlyphEntry>>;

/* ========================================================================== */
/* The writer                                                                 */
/* ========================================================================== */

class Writer {
  private buf: number[] = [];
  u8(v: number): void { this.buf.push(v & 0xff); }
  u16(v: number): void { this.buf.push((v >> 8) & 0xff, v & 0xff); }
  i16(v: number): void { this.u16(v < 0 ? v + 0x10000 : v); }
  u32(v: number): void {
    this.buf.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }
  tag(s: string): void { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); }
  pad4(): void { while (this.buf.length % 4) this.buf.push(0); }
  get length(): number { return this.buf.length; }
  bytes(): Uint8Array { return new Uint8Array(this.buf); }
}

interface Built { adv: number; xMin: number; yMin: number; xMax: number; yMax: number; data: Uint8Array; }

function buildGlyf(g: Glyph): Built {
  const cs = g.contours.filter((c) => c.length >= 6);
  if (cs.length === 0) {
    return { adv: g.adv, xMin: 0, yMin: 0, xMax: 0, yMax: 0, data: new Uint8Array(0) };
  }
  let xMin = 1e9, yMin = 1e9, xMax = -1e9, yMax = -1e9;
  const pts: Array<[number, number]> = [];
  const ends: number[] = [];
  for (const c of cs) {
    for (let i = 0; i < c.length; i += 2) {
      const x = Math.round(c[i]!), y = Math.round(c[i + 1]!);
      pts.push([x, y]);
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
    ends.push(pts.length - 1);
  }
  const w = new Writer();
  w.i16(cs.length);
  w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
  for (const e of ends) w.u16(e);
  w.u16(0);                                  // no instructions
  for (let i = 0; i < pts.length; i++) w.u8(0x01);   // every point on-curve
  let px = 0;
  for (const p of pts) { w.i16(p[0] - px); px = p[0]; }
  let py = 0;
  for (const p of pts) { w.i16(p[1] - py); py = p[1]; }
  w.pad4();
  return { adv: g.adv, xMin, yMin, xMax, yMax, data: w.bytes() };
}

function nameTable(family: string, sub: string, uniqueIdPrefix: string): Uint8Array {
  const recs: Array<[number, string]> = [
    [1, family], [2, sub], [3, uniqueIdPrefix + ':' + family + ':' + sub],
    [4, family + ' ' + sub], [5, 'Version 1.000'],
    [6, family.replace(/\s+/g, '') + '-' + sub],
  ];
  const w = new Writer();
  w.u16(0); w.u16(recs.length); w.u16(6 + recs.length * 12);
  let off = 0;
  const strs: number[] = [];
  for (const [id, s] of recs) {
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      bytes.push((c >> 8) & 0xff, c & 0xff);
    }
    w.u16(3); w.u16(1); w.u16(0x0409); w.u16(id); w.u16(bytes.length); w.u16(off);
    off += bytes.length;
    for (const b of bytes) strs.push(b);
  }
  const head = w.bytes();
  const out = new Uint8Array(head.length + strs.length);
  out.set(head, 0);
  out.set(new Uint8Array(strs), head.length);
  return out;
}

function cmapTable(codes: number[]): Uint8Array {
  // One segment per contiguous run of code points, plus the mandatory 0xFFFF.
  const segs: Array<[number, number, number]> = [];   // start, end, startGid
  for (let i = 0; i < codes.length; i++) {
    const start = codes[i]!;
    const gid = i + 1;                                 // gid 0 is .notdef
    let j = i;
    while (j + 1 < codes.length && codes[j + 1] === codes[j]! + 1) j++;
    segs.push([start, codes[j]!, gid]);
    i = j;
  }
  segs.push([0xffff, 0xffff, 0]);
  const segX2 = segs.length * 2;
  let sr2 = 2;
  while (sr2 * 2 <= segX2) sr2 *= 2;
  const entrySel = Math.log2(sr2 / 2);

  const sub = new Writer();
  sub.u16(4);
  sub.u16(16 + segs.length * 8);
  sub.u16(0);
  sub.u16(segX2);
  sub.u16(sr2); sub.u16(entrySel); sub.u16(segX2 - sr2);
  for (const s of segs) sub.u16(s[1]);
  sub.u16(0);
  for (const s of segs) sub.u16(s[0]);
  // idDelta: gid = code + delta, modulo 65536. The 0xFFFF terminator maps to
  // gid 0 by convention, which is a delta of 1 (0xFFFF + 1 ≡ 0).
  for (const s of segs) sub.u16(s[0] === 0xffff ? 1 : (s[2] - s[0]) & 0xffff);
  for (let i = 0; i < segs.length; i++) sub.u16(0);   // idRangeOffset, all direct
  const subBytes = sub.bytes();

  const w = new Writer();
  w.u16(0); w.u16(1);
  w.u16(3); w.u16(1); w.u32(12);
  const head = w.bytes();
  const out = new Uint8Array(head.length + subBytes.length);
  out.set(head, 0);
  out.set(subBytes, head.length);
  return out;
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const v = ((data[i]! << 24) | ((data[i + 1] || 0) << 16)
      | ((data[i + 2] || 0) << 8) | (data[i + 3] || 0)) >>> 0;
    sum = (sum + v) >>> 0;
  }
  return sum;
}

/**
 * Ten tables, hand-rolled, and out the other end is a font binary a browser
 * will accept.
 */
export function buildFont(spec: FaceSpec, glyphSet: GlyphSet, m: FaceMetrics): Uint8Array {
  const chars = Object.keys(glyphSet).sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
  const glyphs: Built[] = [];
  // gid 0 — .notdef, deliberately empty rather than the usual hollow box: a
  // missing glyph should fall through to the platform face invisibly, not
  // print a tofu in the middle of a readout.
  glyphs.push({
    adv: spec.fixedAdv === null ? 500 : spec.fixedAdv,
    xMin: 0, yMin: 0, xMax: 0, yMax: 0, data: new Uint8Array(0),
  });

  for (const ch of chars) {
    const [adv, draw] = glyphSet[ch]!;
    const pen = new Pen(spec.stem, spec.smallStem);
    draw(pen);
    let contours = pen.contours;
    let advance = adv;
    if (spec.fixedAdv !== null) {
      // Mono: every advance identical, every glyph centred in its cell. This is
      // what makes '+', '−' and '·' occupy the same column.
      const shift = Math.round((spec.fixedAdv - adv) / 2);
      advance = spec.fixedAdv;
      if (shift !== 0) {
        contours = contours.map((c) => c.map((v, i) => (i % 2 === 0 ? v + shift : v)));
      }
    }
    glyphs.push(buildGlyf({ adv: advance, contours }));
  }

  const numGlyphs = glyphs.length;
  let xMin = 0, yMin = 0, xMax = 0, yMax = 0, maxPts = 0, maxCont = 0, advMax = 0;
  for (const g of glyphs) {
    if (g.data.length) {
      xMin = Math.min(xMin, g.xMin); yMin = Math.min(yMin, g.yMin);
      xMax = Math.max(xMax, g.xMax); yMax = Math.max(yMax, g.yMax);
      const nc = (g.data[0]! << 8) | g.data[1]!;
      maxCont = Math.max(maxCont, nc);
      maxPts = Math.max(maxPts, ((g.data[10 + (nc - 1) * 2]! << 8) | g.data[11 + (nc - 1) * 2]!) + 1);
    }
    advMax = Math.max(advMax, g.adv);
  }

  // glyf + loca
  const glyf = new Writer();
  const locas: number[] = [];
  let off = 0;
  for (const g of glyphs) {
    locas.push(off);
    for (let i = 0; i < g.data.length; i++) glyf.u8(g.data[i]!);
    off += g.data.length;
  }
  locas.push(off);
  const loca = new Writer();
  for (const o of locas) loca.u32(o);

  const hmtx = new Writer();
  for (const g of glyphs) { hmtx.u16(g.adv); hmtx.i16(g.data.length ? g.xMin : 0); }

  const head = new Writer();
  head.u32(0x00010000); head.u32(0x00010000);
  head.u32(0);                                   // checkSumAdjustment, patched
  head.u32(0x5f0f3cf5); head.u16(0x000b);
  head.u16(m.unitsPerEm);
  head.u32(0); head.u32(0);                      // created
  head.u32(0); head.u32(0);                      // modified
  head.i16(xMin); head.i16(yMin); head.i16(xMax); head.i16(yMax);
  head.u16(spec.weight >= 700 ? 1 : 0);          // macStyle bold
  head.u16(7); head.i16(2); head.i16(1); head.i16(0);

  const hhea = new Writer();
  hhea.u32(0x00010000);
  hhea.i16(m.winAscent); hhea.i16(m.descender); hhea.i16(m.lineGap);
  hhea.u16(advMax); hhea.i16(xMin); hhea.i16(0); hhea.i16(xMax);
  hhea.i16(1); hhea.i16(0); hhea.i16(0);
  hhea.i16(0); hhea.i16(0); hhea.i16(0); hhea.i16(0);
  hhea.i16(0); hhea.u16(numGlyphs);

  const maxp = new Writer();
  maxp.u32(0x00010000); maxp.u16(numGlyphs);
  maxp.u16(maxPts); maxp.u16(maxCont); maxp.u16(0); maxp.u16(0);
  maxp.u16(2); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0);
  maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0);

  const codes = chars.map((c) => c.codePointAt(0)!);
  const os2 = new Writer();
  os2.u16(4);
  os2.i16(m.avgCharWidth); os2.u16(spec.weight); os2.u16(5);
  os2.u16(0);
  os2.i16(650); os2.i16(-150); os2.i16(-200); os2.i16(300);      // subscript
  os2.i16(650); os2.i16(-150); os2.i16(-200); os2.i16(480);      // superscript
  os2.i16(50); os2.i16(m.capHeight / 2);
  os2.u16(0);                                                     // sFamilyClass
  for (let i = 0; i < 10; i++) os2.u8(0);                         // panose
  os2.u32(1); os2.u32(0); os2.u32(0); os2.u32(0);                 // unicode ranges
  os2.tag(m.vendor);
  os2.u16(spec.weight >= 700 ? 0x20 : 0x40);                      // fsSelection
  os2.u16(codes[0]!); os2.u16(codes[codes.length - 1]!);
  os2.i16(m.ascender); os2.i16(m.descender); os2.i16(m.lineGap);
  os2.u16(m.winAscent); os2.u16(-m.descender);
  os2.u32(1); os2.u32(0);
  os2.i16(m.xHeight); os2.i16(m.capHeight);
  os2.u16(32); os2.u16(32); os2.u16(2);

  const post = new Writer();
  post.u32(0x00030000); post.u32(0);
  post.i16(m.underlinePosition); post.i16(m.underlineThickness);
  post.u32(spec.fixedAdv !== null ? 1 : 0);
  post.u32(0); post.u32(0); post.u32(0); post.u32(0);

  const tables: Array<[string, Uint8Array]> = [
    ['OS/2', os2.bytes()],
    ['cmap', cmapTable(codes)],
    ['glyf', glyf.bytes()],
    ['head', head.bytes()],
    ['hhea', hhea.bytes()],
    ['hmtx', hmtx.bytes()],
    ['loca', loca.bytes()],
    ['maxp', maxp.bytes()],
    ['name', nameTable(spec.family, spec.sub, m.uniqueIdPrefix)],
    ['post', post.bytes()],
  ];
  tables.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const n = tables.length;
  let sr2 = 16;
  while (sr2 * 2 <= n * 16) sr2 *= 2;
  const dir = new Writer();
  dir.u32(0x00010000); dir.u16(n);
  dir.u16(sr2); dir.u16(Math.log2(sr2 / 16)); dir.u16(n * 16 - sr2);

  let pos = 12 + n * 16;
  const offsets: number[] = [];
  for (const [, data] of tables) {
    offsets.push(pos);
    pos += data.length + ((4 - (data.length % 4)) % 4);
  }
  for (let i = 0; i < n; i++) {
    dir.tag(tables[i]![0]);
    dir.u32(checksum(tables[i]![1]));
    dir.u32(offsets[i]!);
    dir.u32(tables[i]![1].length);
  }

  const out = new Uint8Array(pos);
  out.set(dir.bytes(), 0);
  for (let i = 0; i < n; i++) out.set(tables[i]![1], offsets[i]!);

  // head.checkSumAdjustment, which is a checksum of the whole file with this
  // field zeroed — it is already zero, so the sum can be taken as-is.
  const adj = (0xb1b0afba - checksum(out)) >>> 0;
  const headOff = offsets[tables.findIndex((t) => t[0] === 'head')]! + 8;
  out[headOff] = (adj >>> 24) & 0xff;
  out[headOff + 1] = (adj >>> 16) & 0xff;
  out[headOff + 2] = (adj >>> 8) & 0xff;
  out[headOff + 3] = adj & 0xff;
  return out;
}

/**
 * Build every face and hand them to the document.
 *
 * ALL OR NOTHING. It resolves true only when every face loaded; on anything
 * else it resolves false and the caller must leave its CSS alone. A half-
 * applied family — one weight swapped, one not — looks deliberate and is the
 * worse failure. The caller keeps the memo (a game re-creating its UI must not
 * rebuild four font binaries) because how often a UI is re-created is a fact
 * about that game and not about this file.
 */
export async function installFaces(
  specs: readonly FaceSpec[], glyphSet: GlyphSet, m: FaceMetrics,
): Promise<boolean> {
  if (typeof FontFace !== 'function' || !document.fonts) return false;
  try {
    const loaded = await Promise.all(specs.map(async (spec) => {
      const bin = buildFont(spec, glyphSet, m);
      const face = new FontFace(spec.family, bin.buffer as ArrayBuffer, {
        weight: String(spec.weight),
        style: 'normal',
      });
      await face.load();
      document.fonts.add(face);
      return true;
    }));
    return loaded.every(Boolean);
  } catch {
    // A rejected FontFace is the platform telling us the binary is not
    // acceptable. That is a bug in this file, not a reason to break an
    // interface.
    return false;
  }
}
