/**
 * `homie-studio build --types` — the games' TypeScript, checked before anything is built.
 *
 * The build bundles with esbuild, which strips types and never reads them: `const hp: number = "full"` builds and
 * ships. This is the check a creator's agent would otherwise have no way to run, because a studio had no TypeScript
 * of its own to run `npx tsc` with.
 *
 *   - The compiler is the STUDIO'S OWN (`typescript` in its node_modules, which a new studio's package.json asks
 *     for). @homie-rocks/studio does not depend on it: the check is something a studio opts into, and a studio that
 *     never does pays nothing for it. Without it the command stops and says the one line that installs it.
 *   - A game with a tsconfig.json of its own is checked with it. Any other game is checked the way esbuild reads
 *     it: its entry and whatever that imports, as ES2022 for a browser, strictly, with the pictures, sounds and
 *     models it imports as addresses (the build's own loaders).
 *   - Only errors in the game's own files stop the build. A game imports the toolkit's helpers as TypeScript
 *     source, and a creator can do nothing about a line in node_modules; those are counted and said, never fatal.
 *
 * Never run unasked: a plain `build` is exactly as fast as it was.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** What the build's file loaders turn into an address (lib/build.mjs LOADERS): an import of one is a string. */
const ADDRESSES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'ogg', 'wav', 'm4a', 'glb', 'gltf', 'bin', 'hdr', 'svg', 'woff2', 'ttf'];
const AMBIENT = `// Written by homie-studio build --types: what the build's loaders give an import of each kind of file.\n${ADDRESSES.map((x) => `declare module '*.${x}' { const address: string; export default address; }`).join('\n')}\n`;

/** How a game with no tsconfig.json of its own is read: as the build reads it. */
const OPTIONS = {
  target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
  strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, resolveJsonModule: true,
  isolatedModules: true, allowJs: true, checkJs: false, useDefineForClassFields: true,
  // A studio's node_modules has Node's types (its tools bring them); a game runs in a browser, where a timer is a number.
  types: [],
};

/** The studio's own TypeScript: { tsc, version }, or null when it has none. */
export function studioTypescript(root) {
  try {
    const pkg = createRequire(join(root, 'package.json')).resolve('typescript/package.json');
    const tsc = join(dirname(pkg), 'bin', 'tsc');
    return existsSync(tsc) ? { tsc, version: JSON.parse(readFileSync(pkg, 'utf8')).version ?? null } : null;
  } catch { return null; }
}

export const NO_TYPESCRIPT = 'build --types checks the games\' TypeScript with the studio\'s own compiler, and this studio has none: run `npm install --save-dev typescript` in the studio, then build --types again (a plain build never needs it)';

/** The TypeScript a game's build starts from, or null (a plain-JavaScript game, or one with its own build). */
function entryOf(g) {
  const mode = g.build?.mode ?? 'bundle';
  if (mode === 'command') return null;
  const entry = mode === 'static' ? g.entry : (g.entry ?? 'src/main.ts');
  return typeof entry === 'string' && /\.(ts|tsx|mts)$/i.test(entry) && existsSync(join(g.dir, entry)) ? entry : null;
}

/**
 * Check every game given. Returns { typescript, games: [{ id, checked, with, errors, elsewhere, why }] } when none
 * of them has a type error in its own files; throws (so the command fails and nothing is built) when one has, with
 * the first errors as `file:line:column TS1234 message`, or when the studio has no TypeScript.
 */
export function typecheck(root, games, { log = () => {} } = {}) {
  const ts = studioTypescript(root);
  if (!ts) throw new Error(NO_TYPESCRIPT);
  const rows = [];
  const found = [];
  for (const g of games) {
    const entry = entryOf(g);
    if (!entry) { rows.push({ id: g.id, checked: false, why: (g.build?.mode ?? 'bundle') === 'command' ? 'it has a build of its own' : 'no TypeScript entry' }); continue; }
    let project = join(g.dir, 'tsconfig.json');
    const own = existsSync(project);
    if (!own) {
      const dir = join(root, '.studio', 'types', g.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'files.d.ts'), AMBIENT);
      project = join(dir, 'tsconfig.json');
      writeFileSync(project, `${JSON.stringify({ compilerOptions: OPTIONS, files: [join(g.dir, entry), join(dir, 'files.d.ts')] }, null, 2)}\n`);
    }
    const res = spawnSync(process.execPath, [ts.tsc, '-p', project, '--noEmit', '--pretty', 'false'], { cwd: root, encoding: 'utf8', timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    if (res.error) throw new Error(`build --types could not run TypeScript ${ts.version ?? ''}: ${res.error.message}`);
    let home = g.dir;
    try { home = realpathSync(g.dir); } catch { /* keep */ }
    const mine = [];
    let elsewhere = 0;
    for (const line of `${res.stdout ?? ''}\n${res.stderr ?? ''}`.split(/\r?\n/)) {
      const at = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
      if (at) {
        let file = isAbsolute(at[1]) ? at[1] : resolve(root, at[1]);
        try { file = realpathSync(file); } catch { /* keep */ }
        if (file.startsWith(`${home}${sep}`)) mine.push(`${relative(root, g.dir).split(sep).join('/')}/${relative(home, file).split(sep).join('/')}:${at[2]}:${at[3]} ${at[4]} ${at[5]}`);
        else elsewhere += 1;
        continue;
      }
      // An error with no file is the project itself (a tsconfig.json that does not read): the game's to fix.
      const bare = /^error (TS\d+): (.*)$/.exec(line);
      if (bare) mine.push(`games/${g.id}${own ? '/tsconfig.json' : ''} ${bare[1]} ${bare[2]}`);
    }
    rows.push({ id: g.id, checked: true, with: own ? 'its tsconfig.json' : 'the build\'s own settings', errors: mine.length, elsewhere });
    if (elsewhere) log(`types: games/${g.id}: ${elsewhere} ${elsewhere === 1 ? 'error' : 'errors'} outside the game's own files (a package it imports as source); not the game's, so not counted`);
    if (mine.length) found.push(...mine);
    else log(`types: games/${g.id} has no type errors (TypeScript ${ts.version ?? '?'}, ${own ? 'its tsconfig.json' : 'the build\'s own settings'})`);
  }
  if (found.length) {
    const shown = found.slice(0, 20);
    throw new Error(`${found.length} type ${found.length === 1 ? 'error' : 'errors'} (build --types); nothing was built:\n${shown.map((e) => `  ${e}`).join('\n')}${found.length > shown.length ? `\n  … and ${found.length - shown.length} more` : ''}`);
  }
  return { typescript: ts.version, games: rows };
}
