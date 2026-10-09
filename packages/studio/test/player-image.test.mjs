import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { playerImage } from '../lib/player-image.mjs';
import { playerProperties } from '../worker/embed.mjs';

test('build measures card files and reports the filename and violated image rule', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'player-image-'));
  const cat = { studio: { site: {}, theme: {} } }, logs = [];
  const check = cover => playerImage(cat, { id: 'test', cover }, dist, m => logs.push(m));
  try {
    mkdirSync(join(dist, 'games/test'), { recursive: true });
    for (const [file, width, height] of [['small.png', 160, 90], ['tall.png', 450, 800], ['wide.png', 800, 450], ['og.png', 1200, 630], ['square.png', 480, 480], ['least.png', 350, 196]]) {
      await sharp({ create: { width, height, channels: 3, background: '#aabbcc' } }).png().toFile(join(dist, 'games/test', file));
    }
    writeFileSync(join(dist, 'games/test/big.png'), Buffer.alloc(5000000));
    writeFileSync(join(dist, 'games/test/broken.png'), 'not an image');
    // What X's reference says does not render is refused, with the file and the rule named.
    for (const cover of ['cover.svg', 'cover.avif', 'small.png', 'big.png', 'broken.png']) assert.equal(await check(cover), null);
    for (const [file, rule] of [['cover.svg', 'JPG'], ['cover.avif', 'AVIF'], ['small.png', '68,600'], ['big.png', 'under 5 MB'], ['broken.png', 'readable']]) {
      assert.ok(logs.some(l => l.includes(file) && l.includes(rule) && l.includes('keeping the picture card')), `${file}: ${logs}`);
    }
    // A picture X accepts always gets the card, whatever its shape: the standard social size, a square, a wide and a tall one.
    for (const [file, width, height] of [['og.png', 1200, 630], ['square.png', 480, 480], ['wide.png', 800, 450], ['tall.png', 450, 800], ['least.png', 350, 196]]) {
      const image = await check(file);
      assert.deepEqual([image.width, image.height, image.format], [width, height, 'png'], file); assert.ok(image.bytes > 0);
      const tags = playerProperties(cat, { id: 'test', name: 'Test', playerImage: image }, { origin: 'https://studio.example' });
      assert.equal(tags['twitter:card'], 'player', file); assert.equal(tags['twitter:image'], `https://studio.example/games/test/${file}`);
    }
    // A shape that is not the player's is said, as a warning that keeps the card; a square picture says nothing.
    for (const file of ['og.png', 'wide.png', 'tall.png']) assert.ok(logs.some(l => l.startsWith('warning:') && l.includes(file) && l.includes('player card is offered') && l.includes('480×480')), `${file}: ${logs}`);
    assert.ok(!logs.some(l => l.includes('square.png')), String(logs));
    // No handle is asked for, of anybody.
    assert.ok(!logs.some(l => /twitterSite|@handle/.test(l)), String(logs));
    await check(null); assert.ok(logs.some(l => l.includes('games/test/game.json') && l.includes('starters')));
    cat.studio.theme.social = 'https://other.example/picture.png'; await check(null);
    assert.ok(logs.some(l => l.includes(cat.studio.theme.social) && l.includes('local image')));
  } finally { rmSync(dist, { recursive: true, force: true }); }
});
