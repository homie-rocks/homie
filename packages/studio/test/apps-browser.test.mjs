import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../lib/chrome.mjs';
import { appProof } from './apps-proof.mjs';
test('real Chrome: app check, LAN QR, phones, staff passkey/grant, revocation and durable reconnect', { timeout: 240000 }, async (t) => {
  const wrangler = process.env.HOMIE_APPS_WRANGLER ?? fileURLToPath(new URL('../../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  if (!existsSync(wrangler)) return t.skip('set HOMIE_APPS_WRANGLER to the installed Wrangler entry point');
  if (!findChrome()) return t.skip('set CHROME_PATH to real Chrome');
  await appProof({ wrangler, shots: process.env.HOMIE_APPS_SHOTS ?? null, log: (s) => t.diagnostic(s) });
});
