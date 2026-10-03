#!/usr/bin/env node
/**
 * template/ — the public studio template that Cloudflare's "Deploy to Cloudflare" button copies:
 *
 *   https://deploy.workers.cloudflare.com/?url=https://github.com/homie-rocks/homie/tree/main/template
 *
 * It is exactly what `homie-studio new --template` writes for a studio called "My Studio" (a first game, a
 * "Connect this chat" band on Home, wrangler.jsonc at the root with Previews, and @homie-rocks/studio pinned to
 * this repository's version from registry.npmjs.org), so it is generated, never edited by hand:
 *
 *   node scripts/template.mjs          rewrite template/
 *   node scripts/template.mjs --check  exit 1 when template/ is not what the toolkit writes
 *
 * packages/studio/test/cloud.test.mjs checks the same thing on every pull request. The folder has no
 * package-lock.json: it pins @homie-rocks/studio and wrangler exactly, and a release publishes the version it
 * names (a template that names an unpublished version would not install; `--check` says so after a bump).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(ROOT, 'template');
const { newStudio } = await import(join(ROOT, 'packages', 'studio', 'lib', 'scaffold.mjs'));

function files(dir) {
  const list = [];
  const walk = (at) => {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(at, e.name);
      if (e.isDirectory()) walk(p); else list.push(relative(dir, p));
    }
  };
  if (existsSync(dir)) walk(dir);
  return list.sort();
}

const scratch = mkdtempSync(join(tmpdir(), 'homie-template-'));
try {
  const made = join(scratch, 'my-studio');
  newStudio(made, { name: 'My Studio', homie: 'https://homie.rocks', install: false, template: true });
  rmSync(join(made, '.git'), { recursive: true, force: true });
  const want = files(made);
  if (process.argv.includes('--check')) {
    const have = files(TEMPLATE);
    const differ = [...new Set([...want, ...have])].filter((f) => !want.includes(f) || !have.includes(f) || readFileSync(join(made, f), 'utf8') !== readFileSync(join(TEMPLATE, f), 'utf8'));
    if (differ.length) { process.stderr.write(`template/ is not what the toolkit writes (node scripts/template.mjs rewrites it): ${differ.join(', ')}\n`); process.exit(1); }
    process.stdout.write(`template/ is current (${want.length} files)\n`);
  } else {
    rmSync(TEMPLATE, { recursive: true, force: true });
    cpSync(made, TEMPLATE, { recursive: true });
    process.stdout.write(`wrote template/ (${want.length} files)\n`);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
