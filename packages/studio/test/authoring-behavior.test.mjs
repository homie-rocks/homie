import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as runner from './authoring.mjs';
import { COIN_DASH } from './rules-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-request-proof-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
test('a comment edit cannot satisfy any of the three unattended requests', async () => {
  assert.equal(typeof runner.verifyRequest, 'function', 'the runner needs a behavioral verdict after a successful build');
  const dir = join(root, 'comments'); cpSync(COIN_DASH, dir, { recursive: true });
  const file = join(dir, 'src/rules.ts'); writeFileSync(file, readFileSync(file, 'utf8') + '\n// Edited.\n');
  for (const request of runner.REQUESTS) await assert.rejects(runner.verifyRequest(root, dir, request.id), /requested|expected/);
});
test('the fixed requests are judged by score, round deadlines and movement', async () => {
  assert.equal(typeof runner.verifyRequest, 'function');
  const dir = join(root, 'changed'); cpSync(COIN_DASH, dir, { recursive: true });
  const file = join(dir, 'src/rules.ts');
  writeFileSync(file, readFileSync(file, 'utf8').replace('self.score += 1', 'self.score += 2').replace('seconds: 60, breakSeconds: 8', 'seconds: 30, breakSeconds: 5').replace('maxSpeed: 6', 'maxSpeed: 4'));
  const tune = join(dir, 'tunables.json'); const value = JSON.parse(readFileSync(tune, 'utf8')); value.public.speed.value = 4; writeFileSync(tune, JSON.stringify(value));
  for (const request of runner.REQUESTS) await runner.verifyRequest(root, dir, request.id);
});
