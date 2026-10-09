/** Private Node installation for a Desktop host with a bundled runtime but no system Node.
 * Official archive + SHA-256, no shell, administrator rights or shell profile edits.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const nodeHome = (home = homedir()) => join(home, '.cache', 'homie-studio', 'node');
export async function prepareNode({ home = homedir(), platform = process.platform, arch = process.arch, fetchFn = fetch, exec = spawnSync } = {}) {
  const base = nodeHome(home);
  const bin = join(base, platform === 'win32' ? 'node.exe' : 'bin/node');
  if (existsSync(bin)) return { ok: true, bin, installed: false };
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch)) {
    return { ok: false, next: 'Ask the connected AI to install Node.js 22 or newer for this operating system.', open: 'https://nodejs.org/en/download' };
  }
  let scratch;
  try {
    const get = async (url) => {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Node download answered ${r.status}`);
      return r;
    };
    const url = 'https://nodejs.org/dist/latest-v22.x';
    const sums = await (await get(`${url}/SHASUMS256.txt`)).text();
    const suffix = `${platform === 'win32' ? 'win' : platform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
    const entry = sums.split('\n').map((s) => s.trim().split(/\s+/)).find(([hash, file]) => /^[a-f0-9]{64}$/.test(hash) && new RegExp(`^node-v22\\.\\d+\\.\\d+-${suffix.replaceAll('.', '\\.')}$`).test(file ?? ''));
    if (!entry) throw new Error('No supported Node archive in the official checksum list');
    const [hash, file] = entry;
    const data = Buffer.from(await (await get(`https://nodejs.org/dist/${file.match(/^node-(v22\.\d+\.\d+)-/)[1]}/${file}`)).arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== hash) throw new Error('Node archive checksum did not match');
    mkdirSync(join(home, '.cache', 'homie-studio'), { recursive: true });
    scratch = mkdtempSync(join(home, '.cache', 'homie-studio', 'node-'));
    const archive = join(scratch, file);
    writeFileSync(archive, data);
    const r = exec('tar', ['-xf', archive, '-C', scratch], { encoding: 'utf8', timeout: 10_000 });
    if (r.status !== 0) throw new Error('Could not unpack Node with the system archive tool');
    const unpacked = join(scratch, file.replace(/\.(tar\.gz|zip)$/, ''));
    const check = exec(join(unpacked, platform === 'win32' ? 'node.exe' : 'bin/node'), ['--version'], { encoding: 'utf8', timeout: 3000 });
    if (check.status !== 0 || !/^v22\./.test(check.stdout ?? '')) throw new Error('Downloaded Node did not start');
    renameSync(unpacked, base);
    return { ok: true, bin, installed: true };
  } catch (error) {
    return { ok: false, why: error.message, next: 'AI: retry setup_prepare; if the network still refuses, use the Node installer.', open: 'https://nodejs.org/en/download' };
  } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
}
