// Generate the private, pinned backend. Never modify node_modules or global Math.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = await readFile(new URL('../../../node_modules/navcat/dist/blocks.js', import.meta.url), 'utf8');
if (createHash('sha256').update(source).digest('hex') !== '59410daae61402995a09f41940e347e4368f2c20d85c7d05ccedc6cd559fe36e') throw Error('nav: backend changed; review patches and conformance fixtures');
const patched = source.replaceAll('Math.sin(', 'deterministicSin(').replaceAll('Math.cos(', 'deterministicCos(');
const destination = new URL('../src/internal/Generated.ts', import.meta.url);
const output = '// @ts-nocheck\n// Generated from the pinned MIT dependency; see distributed third-party license.\nimport { deterministicSin, deterministicCos } from "./Math.ts";\n' + patched.replace(/\/\/# sourceMappingURL=.*\n?$/, '');
if (await readFile(destination, 'utf8').catch(() => '') !== output) await writeFile(destination, output);
await mkdir(new URL('../dist/internal/', import.meta.url), { recursive: true });
await copyFile(new URL('../../../node_modules/navcat/LICENSE', import.meta.url), new URL('../dist/internal/NAVCAT-LICENSE', import.meta.url));
await copyFile(new URL('../../../node_modules/mathcat/LICENSE', import.meta.url), new URL('../dist/internal/MATHCAT-LICENSE', import.meta.url));
