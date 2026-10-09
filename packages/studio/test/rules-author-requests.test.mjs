import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRules } from '../lib/rules-build.mjs';
import { esbuildOf, writeGame } from './rules-kit.mjs';
import { requests } from './rules-author-requests.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-requests-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
for (const [id, request] of (process.env.RULES_EXTENDED ? requests : requests.slice(0, 3))) test(`author request: ${request}`, async () => {
  const fixture = new URL(`./fixtures/authored-games/${id}/`,import.meta.url);
  const read = name => readFileSync(new URL(name,fixture),'utf8');
  const dir = writeGame(root, id, { rules: read('rules.ts'), move: read('move.ts') });
  writeFileSync(join(dir, 'src/view.ts'), read('view.ts'));
  if (existsSync(new URL('agents.json', fixture))) writeFileSync(join(dir, 'agents.json'), read('agents.json'));
  mkdirSync(join(dir, 'map')); writeFileSync(join(dir, 'map/main.json'), read('map.json'));
  await prepareRules(await esbuildOf(), root, { id, dir, players:{max:4} });
});
