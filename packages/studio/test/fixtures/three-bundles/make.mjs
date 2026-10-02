#!/usr/bin/env node
/**
 * The two small three.js bundles test/perf.test.mjs reads (`perf sizes` telling minified code from shader source):
 *
 *   three-shaders.min.js   esbuild, minify (whitespace, syntax and names), as a game's build ships three.js
 *   three-shaders.js       the same bundle, not minified (indented, three.js's own names and comments)
 *
 * Both are three.js r185 (three@0.185.1, MIT licence, Copyright 2010-2026 Three.js Authors; its licence comment is
 * kept at the top of each): Vector3 with the Quaternion and MathUtils it uses, the Phong material's vertex and fragment
 * shaders and the lights' uniforms chunk (GLSL in template literals, which no minifier touches). Made from the
 * repository's own devDependency:
 *
 *   node packages/studio/test/fixtures/three-bundles/make.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..', '..', '..');
const entry = [
  "export { Vector3 } from 'three/src/math/Vector3.js';",
  "export { vertex as phongVertex, fragment as phongFragment } from 'three/src/renderers/shaders/ShaderLib/meshphong.glsl.js';",
  "export { default as lightsParsBegin } from 'three/src/renderers/shaders/ShaderChunk/lights_pars_begin.glsl.js';",
].join('\n');
const banner = '/**\n * @license\n * Copyright 2010-2026 Three.js Authors\n * SPDX-License-Identifier: MIT\n */';
for (const [file, minify] of [['three-shaders.min.js', true], ['three-shaders.js', false]]) {
  const res = await esbuild.build({ stdin: { contents: entry, resolveDir: ROOT, loader: 'js' }, bundle: true, format: 'esm', target: 'es2022', minify, banner: { js: banner }, legalComments: 'none', write: false, logLevel: 'silent' });
  writeFileSync(join(HERE, file), res.outputFiles[0].text);
  process.stdout.write(`${file}: ${res.outputFiles[0].text.length} bytes\n`);
}
