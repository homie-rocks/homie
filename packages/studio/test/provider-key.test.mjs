import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerKey } from '../lib/provider-key.mjs';
import { setupStatus } from '../lib/doctor.mjs';

test('provider discovery: environment, canonical file, legacy file, no secret in status', async () => {
  const home = mkdtempSync(join(tmpdir(), 'homie-keys-'));
  try {
    mkdirSync(join(home, '.homie/workspace'), { recursive: true });
    mkdirSync(join(home, '.homie/keys'), { recursive: true });
    for (const [provider, variable] of [['fal', 'FAL_KEY'], ['elevenlabs', 'ELEVENLABS_API_KEY']]) {
      const legacy = join(home, `.homie/workspace/${provider}-key`);
      const canonical = join(home, `.homie/keys/${provider}-key`);
      const env = { HOME: home };
      assert.equal(providerKey(provider, env).key, null);
      writeFileSync(legacy, 'legacy-secret\n', { mode: 0o600 });
      assert.deepEqual(providerKey(provider, env), { key: 'legacy-secret', source: `~/.homie/workspace/${provider}-key` });
      writeFileSync(canonical, 'canonical-secret\n', { mode: 0o600 });
      assert.equal(providerKey(provider, env).key, 'canonical-secret');
      assert.deepEqual(providerKey(provider, { ...env, [variable]: ' environment-secret ' }), { key: 'environment-secret', source: variable });
      writeFileSync(canonical, '\n');
      assert.equal(providerKey(provider, env).key, 'legacy-secret');
    }
    let authenticated = false;
    const status = await setupStatus({ cwd: home, env: { HOME: home }, platform: 'linux', chrome: () => null,
      exec: async () => ({ code: 127, stdout: '', stderr: '' }),
      fetchFn: async (url, options) => {
        if (String(url).includes('api.fal.ai')) {
          authenticated = options.headers.Authorization === 'Key legacy-secret';
          return new Response('{}');
        }
        return new Response('{}', { status: 405 });
      },
    });
    assert.equal(authenticated, true);
    const output = JSON.stringify(status);
    assert.ok(!output.includes('legacy-secret'));
    assert.match(output, /workspace\/fal-key/);
    assert.match(output, /workspace\/elevenlabs-key/);
    assert.equal(readFileSync(new URL('../lib/provider-key.mjs', import.meta.url), 'utf8'), readFileSync(new URL('../../../plugins/homie/hooks/lib/provider-key.mjs', import.meta.url), 'utf8'));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
