/**
 * A build's preview as raw pixels, for Claude Code's Homie mod (the plugin's hooks/homie.mjs): a mod's code has no
 * image decoder, so the latest check frame is also kept, small, as plain RGB beside the feed:
 *
 *   .studio/progress/<build>.preview.<width>x<height>.rgb    width * height * 3 bytes, rows top to bottom
 *
 * The mod draws it as coloured terminal cells (or hands the file to the terminal as a picture). The feed's own JPEG
 * stays what the Claude app's card shows. Plain Node: zlib inflates the PNG Chrome wrote; nothing else is needed.
 */
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

/** A PNG (8-bit RGB or RGBA, not interlaced: what Chrome writes) as { w, h, rgba }. */
export function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8; let w = 0; let h = 0; let type = 0; const idat = [];
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs');
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp || !w || !h) throw new Error('only RGB or RGBA PNGs');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0;
      const b = y ? px[o - stride + x] : 0;
      const c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) { rgba[i * 4] = px[j]; rgba[i * 4 + 1] = px[j + 1]; rgba[i * 4 + 2] = px[j + 2]; rgba[i * 4 + 3] = bpp === 4 ? px[j + 3] : 255; }
  return { w, h, rgba };
}

/** A PNG scaled down (each pixel the average of the ones it covers) to at most `width` pixels wide, as plain RGB. */
export function rgbThumb(png, width = 160) {
  const img = decodePng(png);
  const w = Math.max(1, Math.min(width, img.w));
  const h = Math.max(1, Math.round((img.h * w) / img.w));
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.h) / h); const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.w) / w); const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.w) / w));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.w + xx) * 4; r += img.rgba[i]; g += img.rgba[i + 1]; b += img.rgba[i + 2]; n++; }
      const o = (y * w + x) * 3;
      rgb[o] = Math.round(r / n); rgb[o + 1] = Math.round(g / n); rgb[o + 2] = Math.round(b / n);
    }
  }
  return { w, h, rgb };
}

/** The file name of a build's raw preview. */
export const thumbName = (build, w, h) => `${build}.preview.${w}x${h}.rgb`;

/** Remove a build's earlier raw previews (one is kept: the newest). */
export function dropThumbs(dir, build) {
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) if (n.startsWith(`${build}.preview.`) && n.endsWith('.rgb')) rmSync(join(dir, n), { force: true });
}
