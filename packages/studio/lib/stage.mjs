/**
 * WHERE A BUILD IS MADE, AND HOW IT BECOMES site/dist.
 *
 * `homie-studio build` used to empty site/dist and write into it. Two things went wrong with that: a build that
 * failed halfway left a site with no catalogue (and a deploy right after would have shipped it), and anything
 * running from site/dist (a static server started in site/dist/games/<id>, a capture or perf script loading the
 * built game, `homie-studio preview`) lost its files, or was left running in a folder that no longer existed.
 *
 * So a build is made in a folder of its own (.studio/build/<pid>-<n>/, git-ignored, on the same disk), and only a
 * build that finished is put in place, by `swapIn`:
 *
 *   - site/dist and its folders are never removed and made again: the folder a server was started in is still
 *     the folder the next build fills (a folder goes only when the new build has nothing left in it);
 *   - a file whose bytes did not change is not touched (its date stays, so a watcher sees only what changed);
 *   - a file that did change is moved in under its own name in one step (a rename: a reader gets the old file or
 *     the new one, never half of one);
 *   - the order is what a page needs first: scripts, pictures and sounds, then pages, then the catalogue
 *     (games.json) last, and only then is what the new build no longer has taken away. A page is therefore never
 *     in place before the hashed bundle it names.
 *
 * A build that throws never reaches `swapIn`: site/dist is exactly what it was.
 */
import { constants, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

let opened = 0;

/** Is this process still running? (A build folder whose process is gone was left by a build that was killed.) */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

/**
 * A new, empty folder to build in. With `from` (a one-game build), it starts as a copy of the site as it is, so
 * the rest of the site is still there when it is put back (the copy is a clone where the disk can make one, which
 * costs nothing however big the media is). Folders left by builds that were killed are removed here.
 */
export function openStage(root, { from = null } = {}) {
  const base = join(root, '.studio', 'build');
  mkdirSync(base, { recursive: true });
  for (const name of readdirSync(base)) {
    const pid = Number(/^(\d+)-\d+$/.exec(name)?.[1]);
    if (pid !== process.pid && !alive(pid)) rmSync(join(base, name), { recursive: true, force: true });
  }
  const stage = join(base, `${process.pid}-${++opened}`);
  rmSync(stage, { recursive: true, force: true });
  if (from && existsSync(from)) cpSync(from, stage, { recursive: true, mode: constants.COPYFILE_FICLONE });
  else mkdirSync(stage, { recursive: true });
  return stage;
}

/** Every file under a folder, as paths with forward slashes. */
function filesOf(dir, rel = '', out = []) {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) filesOf(dir, r, out); else out.push(r);
  }
  return out;
}

function sameBytes(a, b) {
  const sa = statSync(a); const sb = statSync(b);
  if (!sb.isFile() || sa.size !== sb.size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/** What goes in first (0), then the pages (1), then the catalogue (2): see the top of this file. */
const rank = (rel) => (rel === 'games.json' ? 2 : /\.(html?|json)$/i.test(rel) ? 1 : 0);

/**
 * Put a finished build in place (see the top of this file). Returns what it did: how many files it wrote, left as
 * they were and took away. The build folder is used up (its changed files are moved out of it).
 */
export function swapIn(stage, dist) {
  mkdirSync(dist, { recursive: true });
  const next = filesOf(stage).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const res = { written: 0, same: 0, removed: 0 };
  for (const rel of next) {
    const from = join(stage, rel);
    const to = join(dist, rel);
    let there = null;
    try { there = lstatSync(to); } catch { there = null; }
    // A folder where the new build has a file: the folder goes (nothing of the new build is in it).
    if (there?.isDirectory()) { rmSync(to, { recursive: true, force: true }); there = null; }
    if (there && sameBytes(from, to)) { res.same += 1; continue; }
    // A file where the new build has a folder, anywhere up the path.
    for (let up = dirname(to); up.length > dist.length; up = dirname(up)) {
      let st = null;
      try { st = lstatSync(up); } catch { continue; }
      if (!st.isDirectory()) rmSync(up, { force: true });
      break;
    }
    mkdirSync(dirname(to), { recursive: true });
    try { renameSync(from, to); } catch (error) {
      // Another disk (a .studio that is a mount of its own): copy beside it, then the same one-step rename. A file
      // something holds open on a system that will not rename over it: written over in place instead.
      if (error?.code === 'EXDEV') {
        const beside = `${to}.${process.pid}.new`;
        cpSync(from, beside);
        renameSync(beside, to);
      } else if (error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES') cpSync(from, to, { force: true });
      else throw error;
    }
    res.written += 1;
  }
  const keep = new Set(next);
  for (const rel of filesOf(dist)) {
    if (keep.has(rel)) continue;
    rmSync(join(dist, rel), { force: true });
    res.removed += 1;
    // A folder the new build left empty goes too, but never site/dist itself.
    for (let up = dirname(join(dist, rel)); up.length > dist.length; up = dirname(up)) {
      try { rmdirSync(up); } catch { break; }
    }
  }
  return res;
}
