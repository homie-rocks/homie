/**
 * PICTURES SMALL ENOUGH FOR ONE ANSWER. The Claude desktop app refuses a tool result over 1 MB, and a picture travels
 * as base64 (a third bigger). So a picture a tool hands back is at most PICTURE_MAX raw: a bigger one becomes a
 * smaller JPEG copy (ffmpeg, else macOS's own sips), stepping down in width until it fits; with neither, it is
 * refused, naming the file, so the person can open it themselves. The original file is never changed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { which } from './jobs.mjs';

export const PICTURE_MAX = 600 * 1024;
const SOURCE_MAX = 40 * 1024 * 1024;
export const PICTURE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const WIDTHS = [1600, 1200, 900, 640, 480];

/** Which shrinker this computer has: { kind, bin } or null. */
export function shrinker() {
  const ff = which(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (ff) return { kind: 'ffmpeg', bin: ff };
  if (process.platform === 'darwin' && existsSync('/usr/bin/sips')) return { kind: 'sips', bin: '/usr/bin/sips' };
  return null;
}

function shrinkTo(tool, src, out, width) {
  const args = tool.kind === 'ffmpeg'
    ? ['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-q:v', '6', out]
    : ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', String(width), src, '--out', out];
  const r = spawnSync(tool.bin, args, { encoding: 'utf8', timeout: 30_000 });
  return r.status === 0 && existsSync(out);
}

/**
 * A picture file as MCP image content: { mimeType, data (base64), bytes, shrunk, width? }. Throws, naming `label`,
 * when it cannot be made small enough here.
 */
export function pictureFor(path, { label = path, max = PICTURE_MAX, tool = shrinker() } = {}) {
  const size = statSync(path).size;
  const mime = PICTURE_TYPES[extname(path).toLowerCase()] ?? 'image/png';
  if (size <= max) return { mimeType: mime, data: readFileSync(path).toString('base64'), bytes: size, shrunk: false };
  if (size > SOURCE_MAX) throw new Error(`${label} is ${Math.round(size / 1024 / 1024)} MB: too big to look at here; the person can open it themselves`);
  if (!tool) throw new Error(`${label} is ${Math.round(size / 1024)} KB, more than the ${Math.round(max / 1024)} KB a picture may be in one answer, and this computer has no ffmpeg (or sips) to make a smaller copy. The person can open it themselves: ${label}`);
  const tmp = mkdtempSync(join(tmpdir(), 'homie-picture-'));
  try {
    for (const width of WIDTHS) {
      const out = join(tmp, `w${width}.jpg`);
      if (!shrinkTo(tool, path, out, width)) break;
      const bytes = statSync(out).size;
      if (bytes <= max) return { mimeType: 'image/jpeg', data: readFileSync(out).toString('base64'), bytes, shrunk: true, width, from: size };
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  throw new Error(`${label} could not be made smaller than ${Math.round(max / 1024)} KB here; the person can open it themselves: ${label}`);
}

/** A picture already in an answer (base64): a smaller copy that fits, or null when there is none to be had. */
export function shrinkPictureData(data, mimeType, { max = PICTURE_MAX, tool = shrinker() } = {}) {
  if (!tool || typeof data !== 'string') return null;
  const ext = Object.entries(PICTURE_TYPES).find(([, m]) => m === mimeType)?.[0] ?? '.png';
  const tmp = mkdtempSync(join(tmpdir(), 'homie-picture-'));
  try {
    const src = join(tmp, `in${ext}`);
    writeFileSync(src, Buffer.from(data, 'base64'));
    const pic = pictureFor(src, { max, tool });
    return { mimeType: pic.mimeType, data: pic.data };
  } catch { return null; } finally { rmSync(tmp, { recursive: true, force: true }); }
}
