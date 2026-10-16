import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeArgs } from '../packages/studio/lib/chrome.mjs';
import { ciLaunchOptions } from './chrome-launch-options.mjs';
test('owner Chrome flags work without inherited debugging pipes', () => {
  assert.ok(!chromeArgs().includes('--remote-debugging-pipe'));
});
test('CI pipe protocol uses the launch deadline, including explicit deadlines', () => {
  assert.deepEqual(ciLaunchOptions({ timeout: 1234, args: ['--headless'] }), { timeout: 1234, protocolTimeout: 1234, pipe: true, args: ['--headless'] });
  assert.equal(ciLaunchOptions({}).protocolTimeout, 30_000);
});
