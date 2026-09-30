/**
 * A QR encoder with no dependency, for the big-screen view's "join on your
 * phone" square. Byte mode (a URL keeps its case), versions 1–10, error
 * correction L/M/Q/H, the eight masks scored by the standard penalty rules
 * (ISO/IEC 18004). The same encoder the homie.rocks big screen draws, which
 * was checked against Apple's Vision barcode reader.
 *
 * `qrSvg(text)` is what the studio's pages use: one <svg> with crisp modules
 * and the mandatory four-module quiet zone.
 */

/* ========================================================================== */
/* Tables                                                                     */
/* ========================================================================== */

/**
 * Per (version, level): EC codewords per block, then one or two block groups as
 * [blockCount, dataCodewordsPerBlock].
 *
 * Transcribed from ISO/IEC 18004 Table 9. This is the single most error-prone
 * body of constants in the file — a wrong row does not throw, it produces a
 * plausible square that no phone can read. The homie.rocks checker exercises every
 * version reachable from a realistic join URL, which is what stands behind it.
 */
const EC_TABLE = {
  //         L                              M                              Q                              H
  1:  { L: [7,  [[1, 19]]],            M: [10, [[1, 16]]],            Q: [13, [[1, 13]]],            H: [17, [[1, 9]]] },
  2:  { L: [10, [[1, 34]]],            M: [16, [[1, 28]]],            Q: [22, [[1, 22]]],            H: [28, [[1, 16]]] },
  3:  { L: [15, [[1, 55]]],            M: [26, [[1, 44]]],            Q: [18, [[2, 17]]],            H: [22, [[2, 13]]] },
  4:  { L: [20, [[1, 80]]],            M: [18, [[2, 32]]],            Q: [26, [[2, 24]]],            H: [16, [[4, 9]]] },
  5:  { L: [26, [[1, 108]]],           M: [24, [[2, 43]]],            Q: [18, [[2, 15], [2, 16]]],   H: [22, [[2, 11], [2, 12]]] },
  6:  { L: [18, [[2, 68]]],            M: [16, [[4, 27]]],            Q: [24, [[4, 19]]],            H: [28, [[4, 15]]] },
  7:  { L: [20, [[2, 78]]],            M: [18, [[4, 31]]],            Q: [18, [[2, 14], [4, 15]]],   H: [26, [[4, 13], [1, 14]]] },
  8:  { L: [24, [[2, 97]]],            M: [22, [[2, 38], [2, 39]]],   Q: [22, [[4, 18], [2, 19]]],   H: [26, [[4, 14], [2, 15]]] },
  9:  { L: [30, [[2, 116]]],           M: [22, [[3, 36], [2, 37]]],   Q: [20, [[4, 16], [4, 17]]],   H: [24, [[4, 12], [4, 13]]] },
  10: { L: [18, [[2, 68], [2, 69]]],   M: [26, [[4, 43], [1, 44]]],   Q: [24, [[6, 19], [2, 20]]],   H: [28, [[6, 15], [2, 16]]] },
};

/** Alignment-pattern centre coordinates. Version 1 has none. ISO 18004 Annex E. */
const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Two-bit level indicator as it appears in the format information. Not the same order as the names. */
const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

/**
 * How many data bits a version+level holds, minus the byte-mode header.
 *
 * The character-count field is 8 bits for versions 1–9 and 16 bits from version
 * 10 — the boundary is inside our range, so it is computed rather than assumed.
 */
function byteCapacity(version, ecl) {
  const [, groups] = EC_TABLE[version][ecl];
  const dataCodewords = groups.reduce((n, [count, size]) => n + count * size, 0);
  const headerBits = 4 + (version >= 10 ? 16 : 8);
  return Math.floor((dataCodewords * 8 - headerBits) / 8);
}

/* ========================================================================== */
/* GF(256)                                                                    */
/* ========================================================================== */

/**
 * Reed–Solomon over GF(2^8) with the QR primitive polynomial 0x11d.
 *
 * Built once at module load, so a big screen draws its square at once.
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function buildTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

/** The generator polynomial for `degree` EC codewords: product of (x - 2^i). */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], 1);
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Polynomial long division; returns the `degree` remainder codewords. */
function ecCodewords(data, degree) {
  const gen = generatorPoly(degree);
  const rem = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* ========================================================================== */
/* Bit stream                                                                 */
/* ========================================================================== */

function bitStream() {
  const bits = [];
  return {
    bits,
    push(value, length) {
      for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    },
  };
}

/* ========================================================================== */
/* Encoding                                                                   */
/* ========================================================================== */

/**
 * Choose the smallest version that fits, preferring the strongest correction
 * level that fits *at that version*.
 *
 * The preference order is the interesting decision. Fewer, larger modules are
 * easier for a camera to resolve from a couch; more error correction survives a
 * bad angle, a reflection off a glossy panel, and a hand shaking on the third
 * drink. Growing the version costs module size for the whole square, while
 * raising the level inside a version costs nothing — so: smallest version wins
 * first, and within it we take the most redundancy we can get for free.
 */
function chooseFormat(byteLength, minLevel) {
  const order = ['H', 'Q', 'M', 'L'];
  const floorIndex = order.indexOf(minLevel);
  for (let version = 1; version <= 10; version++) {
    for (let i = 0; i <= floorIndex; i++) {
      const ecl = order[i];
      if (byteLength <= byteCapacity(version, ecl)) return { version, ecl };
    }
  }
  return null;
}

/** Mode indicator + length + payload + terminator + padding, to full codewords. */
function buildDataCodewords(bytes, version, ecl) {
  const [, groups] = EC_TABLE[version][ecl];
  const dataCodewords = groups.reduce((n, [count, size]) => n + count * size, 0);
  const capacityBits = dataCodewords * 8;

  const bs = bitStream();
  bs.push(0b0100, 4); // byte mode
  bs.push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) bs.push(b, 8);

  // Terminator: up to four zero bits, but never past the end.
  bs.push(0, Math.min(4, capacityBits - bs.bits.length));
  while (bs.bits.length % 8 !== 0) bs.bits.push(0);

  const out = new Uint8Array(dataCodewords);
  for (let i = 0; i < bs.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bs.bits[i + j];
    out[i / 8] = byte;
  }
  // The specified pad bytes, alternating. Not arbitrary filler: a decoder that
  // sees something else here on a damaged symbol has fewer clues to recover it.
  const PAD = [0xec, 0x11];
  for (let i = bs.bits.length / 8, k = 0; i < dataCodewords; i++, k++) out[i] = PAD[k % 2];
  return out;
}

/**
 * Split into blocks, compute EC, and interleave.
 *
 * The interleave is the whole point of blocking: a coffee stain or a thumb over
 * one corner of the square damages a contiguous run of the *final* stream, and
 * interleaving spreads that run across every block so each one loses only a few
 * codewords and stays inside its own correction budget. Get the order wrong and
 * an undamaged symbol still decodes — every block is intact — but a slightly
 * damaged one fails completely, which is a bug you will only meet in a living
 * room and never at a desk.
 */
function interleave(dataCodewords, version, ecl) {
  const [ecPerBlock, groups] = EC_TABLE[version][ecl];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const block = dataCodewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(ecCodewords(block, ecPerBlock));
    }
  }

  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

/* ========================================================================== */
/* The symbol                                                                 */
/* ========================================================================== */

function blankMatrix(size) {
  const m = [];
  for (let i = 0; i < size; i++) m.push(new Uint8Array(size));
  return m;
}

function drawFunctionPatterns(modules, reserved, version) {
  const size = modules.length;

  const set = (x, y, v) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = v;
    reserved[y][x] = 1;
  };

  // Finder patterns and their separators, at three corners.
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const inner = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark = inner && (dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        set(ox + dx, oy + dy, dark ? 1 : 0);
      }
    }
  }

  // Timing patterns. Row 6 and column 6, alternating from the origin.
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    set(i, 6, v);
    set(6, i, v);
  }

  // Alignment patterns, at every pair of centres except the three that would
  // sit on top of a finder.
  const centres = ALIGNMENT[version];
  for (const cy of centres) {
    for (const cx of centres) {
      const onFinder =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6);
      if (onFinder) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
          set(cx + dx, cy + dy, dark ? 1 : 0);
        }
      }
    }
  }

  // The dark module. Always set, always here. Its only job is to exist.
  set(8, size - 8, 1);

  // Reserve the format-information strips; the values are written after masking
  // because they encode which mask was chosen.
  for (let i = 0; i < 9; i++) {
    if (!reserved[i][8]) set(8, i, 0);
    if (!reserved[8][i]) set(i, 8, 0);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[size - 1 - i][8]) set(8, size - 1 - i, 0);
    if (!reserved[8][size - 1 - i]) set(size - 1 - i, 8, 0);
  }

  // Version information, versions 7 and up.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(a, b, bit);
      set(b, a, bit);
    }
  }
}

/** BCH(18,6) over the version number. Computed, not tabulated — a table of four
 *  magic constants is four chances to have typed one wrong. */
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem * 2) ^ ((rem >>> 11) * 0x1f25); // rem * 2 is rem shifted left one bit (rem stays under 2^13)
  return ((version << 12) | rem) & 0x3ffff;
}

/** BCH(15,5) over level+mask, then XORed with the spec's fixed pattern so that
 *  an all-zero format never appears (which would be unreadable as "no data"). */
function formatBits(ecl, mask) {
  const data = (ECL_BITS[ecl] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem * 2) ^ ((rem >>> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function drawFormat(modules, ecl, mask) {
  const size = modules.length;
  const bits = formatBits(ecl, mask);
  for (let i = 0; i < 15; i++) {
    const bit = (bits >>> i) & 1;
    // First copy, around the top-left finder, skipping the timing row/column.
    if (i < 6) modules[i][8] = bit;
    else if (i < 8) modules[i + 1][8] = bit;
    else if (i === 8) modules[8][7] = bit;
    else modules[8][14 - i] = bit;
    // Second copy, split between the other two finders, so a symbol with one
    // damaged corner still declares its own mask.
    if (i < 8) modules[8][size - 1 - i] = bit;
    else modules[size - 15 + i][8] = bit;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(modules, reserved, codewords) {
  const size = modules.length;
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // column 6 is the vertical timing pattern
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (reserved[y][x]) continue;
        // Past the end of the stream the remainder bits stay zero, which is what
        // the spec requires — they are not data and are not padded.
        modules[y][x] = bit < total ? (codewords[bit >> 3] >>> (7 - (bit & 7))) & 1 : 0;
        bit++;
      }
    }
  }
}

/**
 * Mask penalty, ISO 18004 §8.8.2.
 *
 * The four rules exist to stop a mask producing something that *looks* like a
 * finder pattern to a camera, or a field so lopsided that thresholding fails
 * under a dim room light. This is scored for all eight masks and the
 * lowest wins.
 */
function penalty(modules) {
  const size = modules.length;
  let score = 0;

  // Rule 1 — runs of five or more identical modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const read of [(k) => modules[i][k], (k) => modules[k][i]]) {
      let run = 1;
      for (let k = 1; k < size; k++) {
        if (read(k) === read(k - 1)) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // Rule 2 — every 2x2 block of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) score += 3;
    }
  }

  // Rule 3 — the finder-lookalike 1:1:3:1:1 with four light modules on a side.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < size; i++) {
    for (const read of [(k) => modules[i][k], (k) => modules[k][i]]) {
      for (let k = 0; k + 11 <= size; k++) {
        let mA = true; let mB = true;
        for (let j = 0; j < 11; j++) {
          const v = read(k + j);
          if (v !== A[j]) mA = false;
          if (v !== B[j]) mB = false;
        }
        if (mA) score += 40;
        if (mB) score += 40;
      }
    }
  }

  // Rule 4 — deviation from a 50/50 light/dark split.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += modules[y][x];
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/* ========================================================================== */
/* Public                                                                     */
/* ========================================================================== */

/**
 * Encode `text` as a QR symbol.
 *
 * Returns `{ size, version, ecl, mask, get(x, y) }` where `get` is true for a
 * dark module. Throws only for a text too long for version 10 — a caller that
 * can be handed an arbitrary URL should catch and show the address as text.
 *
 * `minLevel` is a floor, not a target: 'M' means "at least M", and a short URL
 * will happily come back as Q or H at the same physical size.
 */
export function encodeQr(text, { minLevel = 'M' } = {}) {
  const bytes = new TextEncoder().encode(text);
  const chosen = chooseFormat(bytes.length, minLevel);
  if (!chosen) {
    throw new Error(`QR: ${bytes.length} bytes will not fit in version 1-10 at level ${minLevel} or better`);
  }
  const { version, ecl } = chosen;
  const size = version * 4 + 17;

  const reserved = blankMatrix(size);
  const base = blankMatrix(size);
  drawFunctionPatterns(base, reserved, version);

  const codewords = interleave(buildDataCodewords(bytes, version, ecl), version, ecl);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const modules = base.map((row) => Uint8Array.from(row));
    placeData(modules, reserved, codewords);
    const fn = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && fn(y, x)) modules[y][x] ^= 1;
      }
    }
    drawFormat(modules, ecl, mask);
    const score = penalty(modules);
    if (!best || score < best.score) best = { score, mask, modules };
  }

  return {
    size,
    version,
    ecl,
    mask: best.mask,
    get: (x, y) => best.modules[y][x] === 1,
    /** Row-major 0/1 bytes. Only the harness and the canvas painter want this. */
    toBytes() {
      const out = new Uint8Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = best.modules[y][x];
      return out;
    },
  };
}


/** The symbol as an SVG string: one path, dark modules on a light square with the quiet zone. */
export function qrSvg(text, { minLevel = 'M', quiet = 4, dark = '#000000', light = '#ffffff', title = '' } = {}) {
  const q = encodeQr(text, { minLevel });
  const total = q.size + quiet * 2;
  let d = '';
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; x++) if (q.get(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }
  const t = String(title).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img"${t ? ` aria-label="${t}"` : ''}><rect width="${total}" height="${total}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
