#!/usr/bin/env node
/**
 * Homie for the Claude desktop app: the Desktop Extension (.mcpb) that gives the plain Claude app Homie's local
 * tools and cards in the same chat (desktop/, packages/studio/lib/mcp.mjs).
 *
 *   node scripts/desktop.mjs            stage it, validate the manifest and pack desktop/dist/homie-studio-<version>.mcpb
 *   node scripts/desktop.mjs --check    the same, then unpack the .mcpb and run THE PACKED SERVER the way the app
 *                                       does (node <dir>/server/index.mjs --studios <folder>): handshake, tools,
 *                                       cards, setup status and a studio made with no game. CI runs this.
 *
 * The bundle is @homie-rocks/studio (its published files, no node_modules: what a studio builds with is the studio's
 * own pinned copy, installed in the studio) and the plugin's skills as Homie's guides. Its version is the toolkit's.
 * The manifest's tool list is filled from the server's own list of tools, so the app's install screen names them.
 * Validation and packing use Anthropic's own CLI, @anthropic-ai/mcpb, pinned. Nothing is signed here (see
 * desktop/README.md).
 */
import { spawn, spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MCPB = '@anthropic-ai/mcpb@2.1.2';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = join(ROOT, 'packages', 'studio');
const OUT = join(ROOT, 'desktop', 'dist');
const STAGE = join(OUT, 'stage');
const check = process.argv.includes('--check');
const say = (line) => process.stdout.write(`${line}\n`);

function mcpb(args, cwd = ROOT) {
  const r = spawnSync('npx', ['-y', MCPB, ...args], { cwd, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' }, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`mcpb ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
}

/** A host's side of the stdio transport, for one server process. */
export function talk(cmd, args, { cwd, env = {} } = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let seq = 0; let err = ''; const waiting = new Map();
  child.stderr.on('data', (d) => { err += d; });
  child.stdout.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => { if (waiting.has(id)) reject(new Error(`no answer to ${method}\n${err.slice(-1500)}`)); }, 60_000);
  });
  const close = () => new Promise((r) => { if (child.exitCode !== null) r(); else { child.on('close', r); child.stdin.end(); } });
  return { request, close, stderr: () => err };
}

/** The extension's icon as a PNG: a rounded yellow square with a darker base and a dark "H", anti-aliased edges. */
export function icon(N = 512) {
  const px = Buffer.alloc(N * N * 4);
  const s = N / 512;
  const R = 112 * s; const lo = 16 * s; const hi = 496 * s;
  const ink = [26, 20, 5]; const gold = [255, 207, 90]; const base = [214, 160, 40];
  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, lo + R), hi - R); const cy = Math.min(Math.max(y, lo + R), hi - R);
    return x >= lo && x <= hi && y >= lo && y <= hi && (x - cx) ** 2 + (y - cy) ** 2 <= R * R;
  };
  const inH = (x, y) => (y >= 128 * s && y < 384 * s) && ((x >= 150 * s && x < 214 * s) || (x >= 298 * s && x < 362 * s) || (x >= 150 * s && x < 362 * s && y >= 226 * s && y < 286 * s));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inRounded(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) cover++;
      if (!cover) continue;
      const c = inH(x, y) ? ink : y > 430 * s ? base : gold;
      const i = (y * N + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = Math.round((cover / 16) * 255);
    }
  }
  const raw = Buffer.alloc(N * (N * 4 + 1));
  for (let y = 0; y < N; y++) px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(STAGE, 'server'), { recursive: true });

// The toolkit, as npm would publish it (package.json `files`), and Homie's guides.
const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
for (const f of ['package.json', ...pkg.files]) {
  const from = join(PKG, f.replace(/\/$/, ''));
  // Filters read the path inside the package, never the checkout's own (CI's lives under a folder called work).
  if (existsSync(from)) cpSync(from, join(STAGE, 'server', 'studio', f.replace(/\/$/, '')), { recursive: true, filter: (p) => !/(^|[\\/])(test|node_modules)([\\/]|$)/.test(relative(PKG, p)) });
}
const SKILLS = join(ROOT, 'plugins', 'homie', 'skills');
cpSync(SKILLS, join(STAGE, 'server', 'skills'), { recursive: true, filter: (p) => !/(^|[\\/])(test|node_modules|work)([\\/]|$)/.test(relative(SKILLS, p)) && !/\.DS_Store$/.test(p) });
cpSync(join(ROOT, 'desktop', 'server', 'index.mjs'), join(STAGE, 'server', 'index.mjs'));
// The icon is drawn here (no binary files live in this repository): Homie's yellow mark with a dark H, 512 px.
writeFileSync(join(STAGE, 'icon.png'), icon());
for (const f of ['LICENSE', 'NOTICE']) cpSync(join(ROOT, f), join(STAGE, f));

// The manifest: this version, and the tools as the server lists them.
const manifest = JSON.parse(readFileSync(join(ROOT, 'desktop', 'manifest.json'), 'utf8'));
manifest.version = version;
{
  const s = talk(process.execPath, [join(STAGE, 'server', 'index.mjs'), '--studios', join(tmpdir(), 'homie-desktop-none')], { cwd: STAGE });
  await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'desktop.mjs', version } });
  const { tools } = (await s.request('tools/list')).result;
  await s.close();
  // The media tools appear only where their provider is set up; the install screen lists the ones every computer has.
  manifest.tools = tools.filter((t) => !['music', 'sound', 'art', 'video'].includes(t.name)).map((t) => ({ name: t.name, description: t.description.replace(/^Homie Studio: /, '').split(/(?<=[.])\s/)[0].slice(0, 200) }));
}
writeFileSync(join(STAGE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
say(mcpb(['validate', join(STAGE, 'manifest.json')]).trim());
mkdirSync(OUT, { recursive: true });
const file = join(OUT, `homie-studio-${version}.mcpb`);
rmSync(file, { force: true });
mcpb(['pack', STAGE, file]);
say(`packed ${file} (${Math.round(statSync(file).size / 1024)} KB, ${manifest.tools.length} tools listed)`);

if (check) {
  // The real bundle: unpacked, and its server started the way the Claude app starts it.
  const work = mkdtempSync(join(tmpdir(), 'homie-desktop-check-'));
  try {
    const dir = join(work, 'ext');
    mcpb(['unpack', file, dir]);
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const studios = join(work, 'Studios');
    const args = m.server.mcp_config.args.map((a) => a.replace('${__dirname}', dir).replace('${user_config.studios_folder}', studios));
    const s = talk('node', args, { cwd: work, env: { ...m.server.mcp_config.env } });
    const init = await s.request('initialize', { protocolVersion: '2025-11-25', capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } }, clientInfo: { name: 'claude-ai', version: 'check' } });
    if (init.result?.serverInfo?.version !== version) throw new Error(`the packed server says ${init.result?.serverInfo?.version}, not ${version}`);
    const tools = (await s.request('tools/list')).result.tools.map((t) => t.name);
    for (const t of m.tools) if (!tools.includes(t.name)) throw new Error(`the manifest lists ${t.name}, which the packed server does not have`);
    for (const uri of ['ui://homie-studio/setup', 'ui://homie-studio/build', 'ui://homie-studio/studio', 'ui://homie-studio/codex', 'ui://homie-studio/lab']) {
      const c = (await s.request('resources/read', { uri })).result.contents[0];
      if (!/ui\/initialize/.test(c.text) || /__name/.test(c.text)) throw new Error(`the card ${uri} is not right in the bundle`);
    }
    const status = (await s.request('tools/call', { name: 'setup_status', arguments: {} })).result;
    if (status.isError || status.structuredContent?.kind !== 'setup') throw new Error(`setup_status: ${JSON.stringify(status).slice(0, 400)}`);
    const guide = (await s.request('tools/call', { name: 'studio_guide', arguments: { topic: 'studio-setup' } })).result;
    if (guide.isError) throw new Error('the guides are not in the bundle');
    await s.close();
    // A studio made by the packed server, without npm install (no network in this check): no game, its home soon.
    const s2 = talk('node', [...args, '--no-install'], { cwd: work, env: { ...m.server.mcp_config.env } });
    await s2.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
    const made = (await s2.request('tools/call', { name: 'studio_scaffold', arguments: { name: 'Check Studio' } })).result;
    await s2.close();
    if (made.isError || !existsSync(join(studios, 'check-studio', 'studio.json')) || existsSync(join(studios, 'check-studio', 'games', 'gem-rush'))) throw new Error(`studio_scaffold from the bundle: ${made.content?.[0]?.text}`);
    // The folder setting is optional, so the app turns the extension on as it installs it (a required setting left it
    // off even with a default). When the app passes no folder (its placeholder as written, or an empty value), the
    // server uses the default: the Studios folder in the home folder.
    const setting = m.user_config?.studios_folder;
    if (setting?.required !== false || setting?.default !== '${HOME}/Studios') throw new Error(`the studios folder setting must be optional with the default \${HOME}/Studios: ${JSON.stringify(setting)}`);
    for (const [what, value] of [['its placeholder as written', '${user_config.studios_folder}'], ['an empty value', '']]) {
      const s3 = talk('node', [join(dir, 'server', 'index.mjs'), '--studios', value, '--no-install'], { cwd: work, env: { ...m.server.mcp_config.env, HOME: work } });
      await s3.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
      const st = (await s3.request('tools/call', { name: 'setup_status', arguments: {} })).result;
      await s3.close();
      if (st.structuredContent?.studiosDir !== join(work, 'Studios')) throw new Error(`with ${what} for the folder, the server used ${st.structuredContent?.studiosDir}, not the default`);
    }
    say(`the packed server answers: ${tools.length} tools, 5 cards, setup status, the guides, and a new studio with no game (${init.result.protocolVersion}); the folder setting is optional, and an unfilled one means the default`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}
