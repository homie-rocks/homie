/** The browser-hosted starter as released before slice 7, for old-game regression tests. */
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function legacyGame(root, id, name = id) {
  const dir = join(root, 'games', id);
  cpSync(fileURLToPath(new URL('./fixtures/legacy-ember-vale/', import.meta.url)), dir, { recursive: true });
  const file = join(dir, 'game.json'), meta = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...meta, id, name }, null, 2) + '\n');
  for (const file of ['src/main.ts', 'lab.json']) {
    const path = join(dir, file); writeFileSync(path, readFileSync(path, 'utf8').replaceAll('ember-vale', id));
  }
  return dir;
}
