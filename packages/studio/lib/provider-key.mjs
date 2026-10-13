import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Read only; callers must expose source, never key. No environment mutation. */
export function providerKey(provider, env = process.env) {
  const variable = { fal: 'FAL_KEY', elevenlabs: 'ELEVENLABS_API_KEY' }[provider];
  if (!variable) throw new TypeError('unknown media provider');
  const value = String(env[variable] ?? '').trim();
  if (value) return { key: value, source: variable };
  // An explicitly supplied environment is also an isolated home in tests/tools.
  const home = env.HOME || env.USERPROFILE || (env === process.env ? homedir() : null);
  if (home) for (const relative of [`keys/${provider}-key`, `workspace/${provider}-key`]) {
    const path = join(home, '.homie', relative);
    try {
      const key = readFileSync(path, 'utf8').trim();
      if (key && !/[\r\n]/.test(key)) return { key, source: `~/.homie/${relative}` };
    } catch { /* Missing or unreadable files are not credentials. */ }
  }
  return { key: null, source: null };
}
