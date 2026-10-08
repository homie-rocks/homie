// Run with node packages/nav/test/browser-check.mjs, then open the printed URL.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { withoutClock } from './scenario.mjs';
const expected = withoutClock();
const bundle = await build({
  entryPoints: [new URL('./scenario.mjs', import.meta.url).pathname],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'navTest',
  write: false,
});
const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let actual = '';
    for await (const chunk of req) actual += chunk;
    try {
      assert.equal(actual, expected);
      console.log(
        `PASS: browser matches Node, ${expected.length} characters including baked bytes and restored crowd state`,
      );
      res.end('PASS: browser and Node produce identical baked bytes and restored crowd state.');
    } catch {
      process.exitCode = 1;
      console.error('FAIL: browser differs from Node');
      res.statusCode = 500;
      res.end('FAIL');
    }
    server.close();
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    `<!doctype html><title>Navigation runtime check</title><h1>Navigation runtime check</h1><p id="result">Running…</p>
<script>${bundle.outputFiles[0].text}</script>

<script>
fetch('/result',{method:'POST',body:navTest.withoutClock()})
.then(r=>r.text())
.then(t=>document.getElementById('result').textContent=t)
.catch(e=>document.getElementById('result').textContent=String(e));
</script>
`,
  );
});
server.listen(8794, '127.0.0.1', () => console.log('Open http://127.0.0.1:8794'));
server.setTimeout(30000);
setTimeout(() => {
  console.error('Browser check timed out');
  process.exit(1);
}, 180000).unref();
