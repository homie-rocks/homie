import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromeArgs } from '../packages/studio/lib/chrome.mjs';
import { ciLaunchOptions, launchWithDeadline } from './chrome-launch-options.mjs';
test('owner Chrome flags work without inherited debugging pipes', () => {
  assert.ok(!chromeArgs().includes('--remote-debugging-pipe'));
});
test('CI pipe launches keep the caller protocol timeout and default the launch deadline', () => {
  assert.deepEqual(ciLaunchOptions({ timeout: 1234, protocolTimeout: 180_000, args: ['--headless'] }), { timeout: 1234, protocolTimeout: 180_000, pipe: true, args: ['--headless'] });
  assert.equal(ciLaunchOptions({}).timeout, 30_000);
  assert.equal(ciLaunchOptions({}).protocolTimeout, undefined);
});
test('a Chrome that never starts fails at the launch deadline, and a late one is closed', async () => {
  let closed = false, resolveLate;
  const late = new Promise(r => { resolveLate = r; });
  await assert.rejects(launchWithDeadline(() => late, { timeout: 20 }), /did not start within 20 ms/);
  resolveLate({ close: async () => { closed = true; } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(closed, true);
});
test('a Chrome that starts in time is returned', async () => {
  const browser = { close: async () => {} };
  assert.equal(await launchWithDeadline(async () => browser, { timeout: 1000 }), browser);
});
