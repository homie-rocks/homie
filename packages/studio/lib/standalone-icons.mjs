/**
 * STANDALONE BUILDS, THE ICON (standalone/STANDALONE.md). An app needs an icon in a dozen sizes and three container
 * formats; a studio keeps ONE picture, or none. Every file here is made at build time into .studio/standalone/<id>/
 * and never committed.
 *
 * Where the picture comes from, first found:
 *   1. game.json `standalone.icon` (a path inside the game's folder)
 *   2. games/<id>/icon.png
 *   3. the game's cover (game.json `cover`), cropped square from its middle
 *   4. a tile in the game's colours with the first letter of its name
 * The plan says which one was used. Stores want a real square picture, 1024 by 1024, with no transparency: 3 and 4
 * are for trying a build, not for a store page.
 *
 * The pictures are drawn with sharp (this toolkit's own). The Windows .ico and the macOS .icns are written by
 * @shockpkg/icon-encoder, installed in the standalone project with the other wrapper tools: it writes both
 * containers from PNGs and depends only on a PNG reader, so no container format is written by hand here and no
 * second copy of sharp is installed. The phone icons and splash screens are @capacitor/assets' to make, from the
 * pictures in assets/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve, sep } from 'node:path';

const inside = (dir, rel) => { const abs = resolve(dir, String(rel)); return abs === dir || abs.startsWith(dir + sep) ? abs : null; };
const PICTURE = /\.(png|jpe?g|webp|svg)$/i;

/** Which picture the icon is made from: { from, file (null for the letter tile), note }. Reads nothing but names. */
export function iconSource(root, game, meta) {
  const dir = game.dir;
  if (meta.icon) {
    const f = inside(dir, meta.icon);
    if (f && existsSync(f) && PICTURE.test(f)) return { from: 'standalone.icon', file: f, note: `games/${game.id}/${relative(dir, f).split(sep).join('/')} (game.json standalone.icon)` };
  }
  const own = join(dir, 'icon.png');
  if (existsSync(own)) return { from: 'icon.png', file: own, note: `games/${game.id}/icon.png` };
  if (typeof game.cover === 'string' && game.cover && PICTURE.test(game.cover)) {
    for (const base of [join(root, 'site', 'dist', 'games', game.id), dir, join(dir, 'public')]) {
      const f = inside(base, game.cover);
      if (f && existsSync(f)) return { from: 'cover', file: f, note: `the game's cover (${game.cover}), cropped square. A store wants a real icon: a square 1024×1024 PNG at games/${game.id}/icon.png` };
    }
  }
  const asked = meta.icon ? `game.json standalone.icon names ${JSON.stringify(String(meta.icon).slice(0, 60))}, which is not a picture in the game's folder. ` : '';
  return { from: 'letter', file: null, note: `${asked}a tile with the letter ${JSON.stringify(letterOf(game.name ?? game.id))} in the game's colours, because the game has no icon and no cover. A store wants a real icon: a square 1024×1024 PNG at games/${game.id}/icon.png` };
}

const letterOf = (name) => (String(name ?? '').trim().match(/[\p{L}\p{N}]/u)?.[0] ?? 'G').toUpperCase();
const HEX = /^#[0-9a-f]{6}$/i;
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

/** The letter tile as an SVG, 1024 square: the game's paper, its text colour, its accent as a bar. */
export function letterTile(name, colours = null) {
  const paper = HEX.test(colours?.paper ?? '') ? colours.paper : '#10131c';
  const text = HEX.test(colours?.text ?? '') ? colours.text : '#eef1f8';
  const hot = HEX.test(colours?.hot ?? '') ? colours.hot : '#ffcf5a';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="${paper}"/><rect x="232" y="780" width="560" height="44" rx="22" fill="${hot}"/><text x="512" y="700" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="620" fill="${text}">${xml(letterOf(name))}</text></svg>`;
}

/**
 * Write every icon file the wrappers read into the standalone project `dir`:
 *   icons/icon.png (1024), icons/icon.ico, icons/icon.icns     the desktop app's
 *   assets/icon-only.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png   @capacitor/assets' sources
 * Returns { ok, wrote, ico, icns, why? }. A container that could not be written is said (`ico: false`), never passed over:
 * the desktop build then keeps Electron's own icon and says so.
 */
export async function writeIcons(dir, source, { name, colours = null } = {}) {
  let sharp;
  try { sharp = (await import('sharp')).default; } catch (error) { return { ok: false, wrote: [], ico: false, icns: false, why: `sharp did not load (${String(error?.message ?? error).split('\n')[0]}): no icon was made` }; }
  const paper = HEX.test(colours?.paper ?? '') ? colours.paper : '#10131c';
  const wrote = [];
  const put = (rel, buf) => { const f = join(dir, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, buf); wrote.push(rel); };
  let master;
  try {
    master = source.file
      ? await sharp(readFileSync(source.file), { density: 300 }).resize(1024, 1024, { fit: 'cover', position: 'centre' }).flatten({ background: paper }).png().toBuffer()
      : await sharp(Buffer.from(letterTile(name, colours))).resize(1024, 1024).png().toBuffer();
  } catch (error) { return { ok: false, wrote, ico: false, icns: false, why: `the icon's picture could not be read (${String(error?.message ?? error).split('\n')[0]})` }; }
  put('icons/icon.png', master);
  // Android's adaptive icon is two layers: the picture, smaller, over a plain colour (the launcher cuts the shape).
  const small = await sharp(master).resize(680, 680).png().toBuffer();
  const clear = { create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
  put('assets/icon-only.png', master);
  put('assets/icon-foreground.png', await sharp(clear).composite([{ input: small, gravity: 'centre' }]).png().toBuffer());
  put('assets/icon-background.png', await sharp({ create: { width: 1024, height: 1024, channels: 4, background: paper } }).png().toBuffer());
  const splash = await sharp({ create: { width: 2732, height: 2732, channels: 4, background: paper } }).composite([{ input: await sharp(master).resize(512, 512).png().toBuffer(), gravity: 'centre' }]).png().toBuffer();
  put('assets/splash.png', splash);
  put('assets/splash-dark.png', splash);
  // The desktop containers, by @shockpkg/icon-encoder from the project's own node_modules (absent until the desktop
  // tools are installed). It is handed one PNG a size, drawn here, and writes the two containers.
  let ico = false; let icns = false; let why;
  try {
    const { IconIco, IconIcns } = createRequire(join(dir, 'package.json'))('@shockpkg/icon-encoder');
    const at = new Map();
    const png = async (size) => { if (!at.has(size)) at.set(size, await sharp(master).resize(size, size).png().toBuffer()); return at.get(size); };
    const a = new IconIco();
    for (const size of [256, 128, 64, 48, 32, 24, 16]) await a.addFromPng(await png(size), null, false);
    put('icons/icon.ico', Buffer.from(a.encode()));
    ico = true;
    const b = new IconIcns();
    b.toc = true;
    // The order iconutil writes: each type with the size it holds.
    for (const [type, size] of [['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic04', 16], ['ic14', 512], ['ic09', 512], ['ic05', 32], ['ic10', 1024], ['ic11', 32]]) await b.addFromPng(await png(size), [type], false);
    put('icons/icon.icns', Buffer.from(b.encode()));
    icns = true;
  } catch (error) { why = error?.code === 'MODULE_NOT_FOUND' ? 'the icon encoder is not installed in the standalone project yet' : `the desktop icon could not be written (${String(error?.message ?? error).split('\n')[0]})`; }
  return { ok: true, wrote, ico, icns, ...(why ? { why } : {}) };
}
