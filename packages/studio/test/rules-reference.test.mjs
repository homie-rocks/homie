import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, realpathSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame, PKG } from './rules-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-reference-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
test('the complete companion example in the reference builds without source edits', async () => {
  const doc = readFileSync(join(PKG, '../../plugins/homie/skills/game/RULES.md'), 'utf8');
  const example = name => {
    const block = new RegExp(`<!-- companion-example:${name} -->\\s*\x60\x60\x60[^\\n]*\\n([\\s\\S]*?)\x60\x60\x60`).exec(doc);
    assert.ok(block, `complete ${name} example`); return block[1];
  };
  const dir = writeGame(root, 'reference', { rules: example('rules') });
  writeFileSync(join(dir, 'src/view.ts'), 'export {};');
  writeFileSync(join(dir, 'agents.json'), example('agents'));
  mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), example('map'));
  await prepareRules(await esbuildOf(), root, { id: 'reference', dir, players: { max: 4 } });
});
