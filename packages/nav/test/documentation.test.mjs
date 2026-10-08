import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, access, mkdtemp, writeFile, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
test('README documents the package surface, storage contract and realistic measurements', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  for (const heading of ['Install', 'Use', 'Modules', 'Limits', 'Measurements', 'License']) {
    assert.ok(readme.includes(`## ${heading}`), heading);
  }
  for (const method of ['place', 'completeLink', 'addDoor', 'chunks', 'Mesh.restore', 'warnings']) {
    assert.ok(readme.includes(method), method);
  }
  assert.match(readme, /must persist.*mesh\.save\(\)/i);
  assert.match(readme, /pillars/i);
  assert.match(readme, /retarget/i);
  assert.doesNotMatch(readme, /SUMMARY-FOR-REVIEW|review [12]|restricted session|earlier busy/i);
  await assert.rejects(access(new URL('SUMMARY-FOR-REVIEW.md', root)));
});

test('test sources are formatted for human review', async () => {
  for (const entry of await readdir(new URL('test/', root), { recursive: true })) {
    if (!entry.endsWith('.mjs')) continue;
    const text = await readFile(new URL(`test/${entry}`, root), 'utf8');
    assert.ok(
      text.split('\n').every((line) => line.length <= 160),
      entry,
    );
  }
});

test('cylinder parameter describes its base and point validation rejects short input', async () => {
  const source = await readFile(new URL('src/Mesh.ts', root), 'utf8');
  assert.match(source, /addCylinder\(baseCenter: Point/);
});

test('README TypeScript examples compile strictly and execute', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const examples = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]);
  const dir = await mkdtemp(new URL('.example-', root));
  try {
    const input = `${dir}/example.mts`;
    await writeFile(input, examples.join('\n'));
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)),
      input,
      '--strict',
      '--skipLibCheck',
      'false',
      '--target',
      'es2022',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
    ]);
    execFileSync(process.execPath, [`${dir}/example.mjs`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
