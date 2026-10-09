import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { PLAYER_IMAGE, playerEnabled, playerImageRule } from '../worker/embed.mjs';

/**
 * The picture a game's player card shows, measured by the build: the first of the wide landing still, the landing
 * cover, the game's cover and the studio's social picture that X's reference says will render (worker/embed.mjs
 * PLAYER_IMAGE: format, pixel count, size) and that this build can read whole. A refused picture is a warning
 * naming the file and the rule, and the page keeps the picture card it had. A picture whose shape is not the
 * player's still gets the card: the reference only says the two "should" match, so that is a warning too.
 * Only built local files are measured; a remote picture can change without this build knowing.
 */
export async function playerImage(cat, game, dist, log) {
  if (!playerEnabled(cat, game)) return null;
  const sources = [...new Set([game.landing?.hero?.wideImage, game.landing?.hero?.tallImage, game.landing?.cover,
    game.cover ? `/games/${game.id}/${game.cover}` : null, cat.studio.theme?.social].filter(Boolean))];
  const warn = (file, rule) => log(`warning: ${file}: player card needs ${rule}; keeping the picture card unless another image qualifies.`);
  if (!sources.length) warn(`${game.kind === 'app' ? 'apps' : 'games'}/${game.id}/${game.kind === 'app' ? 'app' : 'game'}.json`, 'a cover or a studio social picture in the built site (starters do not include one)');
  const root = realpathSync(dist);
  for (const src of sources) {
    if (!src.startsWith('/') || src.startsWith('//')) { warn(src, 'a local image the build can measure'); continue; }
    if (!/\.(jpe?g|png|webp|gif)$/i.test(src)) { warn(src, 'JPG, PNG, WEBP or GIF; SVG and AVIF are unsupported'); continue; }
    try {
      const file = realpathSync(resolve(dist, '.' + src));
      if (!file.startsWith(root + sep)) throw new Error('outside built assets');
      const bytes = statSync(file).size;
      if (!(bytes < PLAYER_IMAGE.maxBytes)) { warn(src, 'an image under 5 MB'); continue; }
      const sharp = (await import('sharp')).default;
      const data = readFileSync(file);
      const { width, height, format } = await sharp(data).metadata();
      const rule = playerImageRule({ width, height, format, bytes });
      if (rule === 'format') { warn(src, 'JPG, PNG, WEBP or GIF image contents'); continue; }
      if (rule) { warn(src, `at least 68,600 pixels; found ${width}×${height}`); continue; }
      // Decode as well as reading headers: a truncated/corrupt file is not a usable card picture.
      await sharp(data).resize(1, 1).raw().toBuffer();
      return { src, width, height, format, bytes };
    } catch { warn(src, 'a readable, complete image in the built assets'); }
  }
  return null;
}
