// Measure the workerd process itself, excluding the client's HTTP and CPU work.
// ps has 10 ms resolution on macOS; operations are batched before differencing.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { build } from 'esbuild';
export async function workerCpu(source, run) {
  const dir = await mkdtemp(join(tmpdir(), 'nav-cpu-'));
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  let child;
  try {
    await build({
      stdin: {
        contents: source,
        resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      },
      bundle: true,
      platform: 'browser',
      format: 'esm',
      outfile: join(dir, 'worker.js'),
    });
    await writeFile(
      join(dir, 'config.capnp'),
      `
      using Workerd = import "/workerd/workerd.capnp";
      const config :Workerd.Config = (
        services=[(name="main",worker=(modules=[(name="worker.js",esModule=embed "worker.js")],compatibilityDate="2026-10-07"))],
        sockets=[(name="http",address="127.0.0.1:${port}",http=(),service="main")]);
    `,
    );
    child = spawn(
      fileURLToPath(new URL('../../../node_modules/.bin/workerd', import.meta.url)),
      ['serve', join(dir, 'config.capnp')],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    child.stderr.on('data', (b) => process.stderr.write(b));
    const request = async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (!response.ok) throw Error(await response.text());
      return response.json();
    };
    for (let i = 0; i < 300; i++) {
      try {
        await request('/ping');
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const cpu = () => {
      const text = execFileSync('ps', ['-p', String(child.pid), '-o', 'time='], {
        encoding: 'utf8',
      }).trim();
      return text.split(':').reduce((n, part) => n * 60 + Number(part), 0) * 1000;
    };
    const measure = async (path, count = 20) => {
      const before = cpu();
      await request(`${path}${path.includes('?') ? '&' : '?'}n=${count}`);
      return (cpu() - before) / count;
    };
    return await run(request, measure);
  } finally {
    if (child) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(dir, { recursive: true, force: true });
  }
}
