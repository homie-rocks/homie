import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { seller } from './paid-parts-review4-seller.mjs';
test('the official mppx validator accepts published discovery and challenges', { timeout: 240000 }, async () => {
  await import('../worker/purchase-machine.mjs');
  const world = await seller('validator');
  const server = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
      const response = await world.direct(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const discovery = await (await world.direct(new Request(`${origin}/openapi.json`))).json();
    const [path, operation] = Object.entries(discovery.paths)[0];
    const schema = operation.post.requestBody.content['application/json'].schema;
    const body = Object.fromEntries(Object.entries(schema.properties).filter(([, value]) => value.const !== undefined).map(([key, value]) => [key, value.const]));
    Object.assign(body, { buyer: 'a'.repeat(64), claim: 'b'.repeat(64) });
    const child = spawn(process.execPath, [new URL('../../../node_modules/mppx/dist/bin.js', import.meta.url).pathname, 'validate', origin, '--body', JSON.stringify({ [path]: body }), '--output-json'], { env: { ...process.env, NO_COLOR: '1' } });
    let output = ''; child.stdout.on('data', (data) => output += data); child.stderr.on('data', (data) => output += data);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(code, 0, output);
    assert.doesNotMatch(output, /"severity"\s*:\s*"fail"/, output);
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await world.close(); }
});
