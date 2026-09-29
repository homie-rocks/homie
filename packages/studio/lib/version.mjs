/**
 * The one place @homie-rocks/studio says which version it is and where that exact
 * version lives. A studio pins this tarball (package.json + package-lock
 * integrity), so a published game never changes because Homie changed.
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const STUDIO_VERSION = pkg.version;

/** The pinned tarball of this version, on a Homie directory (homie.rocks by default). */
export function tarballUrl(base = 'https://homie.rocks', version = STUDIO_VERSION) {
  return `${String(base).replace(/\/+$/, '')}/npm/homie-studio-${version}.tgz`;
}

/** What a studio's package.json names: until @homie-rocks/studio is on the npm registry, its versioned tarball URL. */
export function packageSpec(base) { return tarballUrl(base); }
