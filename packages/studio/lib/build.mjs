/**
 * `homie-studio build` — every game in games/ bundled into site/dist, plus the
 * catalogue the Worker serves (games.json).
 *
 *   site/dist/games/<id>/index.html        the game's page (the Worker adds HOMIE_NET)
 *   site/dist/games/<id>/assets/main.js    its bundle (esbuild; @homie-rocks/studio/netplay inlined)
 *   site/dist/games/<id>/...               everything in games/<id>/public/
 *   site/dist/games.json                   { studio, games[] } from studio.json and game.json files
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { listGames, readStudio } from './studio.mjs';
import { STUDIO_VERSION } from './version.mjs';

const SOURCE_SKIP = new Set(['node_modules', 'dist', '.git', '.wrangler']);
const TEXT = /\.(ts|tsx|js|mjs|jsx|json|html|css|md|txt|svg|glsl|wgsl|frag|vert)$/i;
/** Text files of a game folder, capped (2 MB total, 512 KB each): what `homie-studio game remix` takes. */
export function sourceOf(dir, id) {
  const files = {};
  let total = 0;
  const walk = (rel) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SOURCE_SKIP.has(entry.name)) continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (TEXT.test(entry.name)) {
        const text = readFileSync(join(dir, path), 'utf8');
        if (text.length > 512 * 1024 || total + text.length > 2 * 1024 * 1024) continue;
        files[path] = text;
        total += text.length;
      }
    }
  };
  walk('');
  return { v: 1, kind: 'homie-game-source', id, files };
}

export async function build(root, { only = null, log = () => {} } = {}) {
  const require = createRequire(join(root, 'package.json'));
  let esbuild;
  try { esbuild = require('esbuild'); } catch { esbuild = await import('esbuild'); }
  const studio = readStudio(root);
  const dist = join(root, 'site', 'dist');
  const games = listGames(root).filter((g) => !only || g.id === only);
  if (only && !games.length) throw new Error(`no game "${only}" in games/`);
  if (!only) rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const built = [];
  for (const g of games) {
    const out = join(dist, 'games', g.id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(join(out, 'assets'), { recursive: true });
    const entry = join(g.dir, g.entry ?? 'src/main.ts');
    if (!existsSync(entry)) throw new Error(`games/${g.id}: entry ${g.entry ?? 'src/main.ts'} not found`);
    const started = Date.now();
    const result = await esbuild.build({
      entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', minify: true, sourcemap: false,
      outfile: join(out, 'assets', 'main.js'), absWorkingDir: root, logLevel: 'silent', metafile: true,
      loader: { '.png': 'file', '.jpg': 'file', '.webp': 'file', '.mp3': 'file', '.ogg': 'file', '.wav': 'file', '.glb': 'file', '.svg': 'file' },
      assetNames: '[name]-[hash]',
    }).catch((error) => {
      const first = error.errors?.[0];
      throw new Error(`games/${g.id} did not build: ${first ? `${first.text}${first.location ? ` (${first.location.file}:${first.location.line})` : ''}` : error.message}`);
    });
    const html = join(g.dir, 'index.html');
    if (!existsSync(html)) throw new Error(`games/${g.id}/index.html is missing`);
    writeFileSync(join(out, 'index.html'), readFileSync(html, 'utf8'));
    if (existsSync(join(g.dir, 'public'))) cpSync(join(g.dir, 'public'), out, { recursive: true });
    // The game's own source, for other studios to remix (game.json "share": { "source": false } keeps it private).
    if (g.share?.source !== false) writeFileSync(join(out, 'source.json'), `${JSON.stringify(sourceOf(g.dir, g.id))}\n`);
    const bytes = statSync(join(out, 'assets', 'main.js')).size;
    built.push({ id: g.id, name: g.name, bytes, ms: Date.now() - started, warnings: result.warnings.length });
    log(`built ${g.id} (${Math.round(bytes / 1024)} KB)`);
  }
  const all = listGames(root);
  const catalogue = {
    studio: { name: studio.name, slug: studio.slug, version: STUDIO_VERSION },
    games: all.filter((g) => existsSync(join(dist, 'games', g.id, 'index.html'))).map((g) => ({
      id: g.id, name: g.name ?? g.id, blurb: g.blurb ?? '', players: g.players ?? { min: 1, max: 8 },
      roundSeconds: g.roundSeconds ?? null, movement: g.netplay?.movement ?? null, cover: g.cover ?? null,
    })),
  };
  writeFileSync(join(dist, 'games.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
  return { ok: true, command: 'build', dist, games: built, catalogue: catalogue.games.map((g) => g.id) };
}
