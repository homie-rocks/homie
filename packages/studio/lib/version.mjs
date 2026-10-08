/**
 * The one place @homie-rocks/studio says which version it is and where that exact
 * version lives. A studio pins this version (package.json + package-lock
 * integrity), so a published game never changes because Homie changed.
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const STUDIO_VERSION = pkg.version;

/**
 * What a studio's package.json names: this exact version, from registry.npmjs.org (package-lock.json keeps its
 * integrity). The public registry is what Cloudflare's Workers Builds and a Claude Code cloud session reach with
 * their default network settings.
 */
export function packageSpec() { return STUDIO_VERSION; }
