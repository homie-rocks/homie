/**
 * `homie-studio preview <id> [--port 8788]` — ONE BUILT GAME'S FILES, served as they are, and nothing else.
 *
 * `dev` is the whole site: Wrangler, a local Durable Object for the rooms, D1. A capture script, a perf run or a
 * headless screenshot of one game needs none of that, only the game's built files at an address. Before this, the
 * way to get one was a static server started by hand inside site/dist/games/<id>, which the next build deleted the
 * folder from under.
 *
 * This serves site/dist/games/<id>/ at `/` (index.html, its hashed bundle and chunks, its public files), reading
 * each file when it is asked for, by its path: a build that finishes while it runs is simply what the next request
 * gets (lib/stage.mjs puts a build in place without removing the folder). It is the game's page as the build made
 * it, with no HOMIE_NET: the netplay helper finds no room and the game plays offline, alone with its bots, which is
 * what a capture of the game itself wants. Rooms, the play page's buttons and anything multiplayer are `dev`'s.
 *
 * It listens on this computer only (127.0.0.1), writes nothing, and stops with the process (Ctrl-C, or a signal).
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const PREVIEW_PORT = 8788;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.ktx2': 'image/ktx2',
  '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

/** The file a request path names inside the game's built folder, or null (outside it, or not a file). */
function fileFor(dir, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  if (rel.includes('\0')) return null;
  const abs = resolve(dir, `.${normalize(`/${rel}`)}`);
  if (abs !== dir && !abs.startsWith(`${dir}${sep}`)) return null;
  for (const f of [abs, join(abs, 'index.html')]) {
    try { if (statSync(f).isFile()) return f; } catch { /* next */ }
  }
  return null;
}

/**
 * Start it. Resolves { ok, server, url, port, game, dir } once it listens; `server.close()` stops it. A port that is
 * taken is not fought over: unless the port was asked for by name (`strict`), the next free one is used and said.
 */
export function previewServer(root, id, { port = PREVIEW_PORT, strict = false } = {}) {
  const dir = resolve(root, 'site', 'dist', 'games', String(id ?? ''));
  if (!id || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(String(id))) return Promise.resolve({ ok: false, command: 'preview', why: 'name the game: homie-studio preview <id>' });
  if (!existsSync(join(dir, 'index.html'))) return Promise.resolve({ ok: false, command: 'preview', why: `no build of ${id} in site/dist: run \`npx --no-install homie-studio build ${id}\` first` });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://preview.local');
    const headers = { 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' };
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers).end(); return; }
    const file = fileFor(dir, url.pathname);
    if (!file) { res.writeHead(404, { ...headers, 'content-type': 'text/plain; charset=utf-8' }).end(`not in the build of ${id}: ${url.pathname}\n`); return; }
    let body;
    try { body = readFileSync(file); } catch { res.writeHead(404, headers).end(); return; }
    res.writeHead(200, { ...headers, 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((done) => {
    const listen = (p, again) => {
      server.once('error', (error) => {
        if (error?.code === 'EADDRINUSE' && again) { listen(0, false); return; }
        done({ ok: false, command: 'preview', why: error?.code === 'EADDRINUSE' ? `port ${p} is in use: give another with --port` : String(error?.message ?? error) });
      });
      server.listen(p, '127.0.0.1', () => {
        const at = server.address().port;
        done({ ok: true, command: 'preview', server, port: at, url: `http://127.0.0.1:${at}/`, game: id, dir });
      });
    };
    listen(Number(port) || 0, !strict);
  });
}
