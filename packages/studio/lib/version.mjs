/**
 * The one place @homie-rocks/studio says which version it is and where that exact
 * version lives. A studio pins this tarball (package.json + package-lock
 * integrity), so a published game never changes because Homie changed.
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const STUDIO_VERSION = pkg.version;

/** The pinned tarball of this version, on a Homie directory (homie.rocks by default). Kept for older studios. */
export function tarballUrl(base = 'https://homie.rocks', version = STUDIO_VERSION) {
  return `${String(base).replace(/\/+$/, '')}/npm/homie-studio-${version}.tgz`;
}

/**
 * What a studio's package.json names: this exact version, from registry.npmjs.org (package-lock.json keeps its
 * integrity). The public registry is what Cloudflare's Workers Builds and a Claude Code cloud session reach with
 * their default network settings; a directory's /npm/ tarball is not.
 */
export function packageSpec() { return STUDIO_VERSION; }
