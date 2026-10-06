/**
 * WHAT A DEPLOY KEEPS ON THIS COMPUTER (all under .studio/, which git ignores): the lock that stops two deploys of
 * one studio running at once, and what the last deploy put live (each game's content hash), so the next one can say
 * which games changed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { gameDigest } from './build.mjs';
import { readLocal, writeLocal } from './studio.mjs';

/* ------------------------------------------------------------------ one deploy at a time */

/*
 * TWO DEPLOYS OF ONE STUDIO AT ONCE (two chats, or a chat and a terminal) both rewrite wrangler.jsonc and studio.json,
 * both build into site/dist, and both run `wrangler deploy`: the site that goes live is some mix of the two, and
 * neither says so. The lock is one small file, made with the "fail if it exists" flag so two starts cannot both win.
 * It names the process that holds it and when it started, and a lock is STALE, and simply taken over, when that
 * process is gone (a deploy that was killed never removed it) or when it is older than any deploy can run.
 */
export const DEPLOY_LOCK = '.studio/deploy.lock';
/** Older than this, a lock is taken over even if its process id is alive: by then the id belongs to something else. */
export const LOCK_MAX_AGE_MS = 2 * 60 * 60_000;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; } };

/** Whether a lock record still holds: its process runs on this computer and it is not older than any deploy. */
export function lockHolds(rec, { now = Date.now(), host = hostname(), isAlive = alive } = {}) {
  if (!rec || !Number.isInteger(rec.pid) || rec.pid <= 0) return false;
  const age = now - Date.parse(rec.at ?? '');
  if (!Number.isFinite(age) || age > LOCK_MAX_AGE_MS || age < -60_000) return false;
  // A lock written on another computer (a synced folder) cannot be checked by process id: only its age counts.
  return rec.host && rec.host !== host ? true : isAlive(rec.pid);
}

/**
 * Take the studio's deploy lock: { ok: true, release } or { ok: false, why, held }. `release` is safe to call twice
 * and removes only this process's own lock.
 */
export function lockDeploy(root, { pid = process.pid, now = () => Date.now(), host = hostname(), isAlive = alive } = {}) {
  const file = join(root, DEPLOY_LOCK);
  mkdirSync(dirname(file), { recursive: true });
  const mine = { pid, at: new Date(now()).toISOString(), host };
  for (let tries = 0; tries < 3; tries += 1) {
    try {
      writeFileSync(file, `${JSON.stringify(mine)}\n`, { flag: 'wx' });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try { if (JSON.parse(readFileSync(file, 'utf8')).pid === pid) rmSync(file, { force: true }); } catch { /* gone, or not ours */ }
      };
      return { ok: true, release, file: DEPLOY_LOCK };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    let held = null;
    try { held = JSON.parse(readFileSync(file, 'utf8')); } catch { held = null; }
    if (lockHolds(held, { now: now(), host, isAlive })) {
      const mins = Math.max(0, Math.round((now() - Date.parse(held.at)) / 60_000));
      return {
        ok: false, held, needs: 'deploy-running',
        why: `another deploy of this studio is already running (process ${held.pid}${held.host && held.host !== host ? ` on ${held.host}` : ''}, started ${mins < 1 ? 'under a minute' : `${mins} min`} ago), so this one did not start and changed nothing. Two deploys at once would overwrite each other's build and config. Wait for it to end, then deploy again; a deploy that was killed leaves a lock that the next one takes over by itself (${DEPLOY_LOCK} names the process).`,
      };
    }
    // Stale: the process that wrote it is gone, the file is torn, or it is older than any deploy. Take it over.
    rmSync(file, { force: true });
  }
  return { ok: false, held: null, needs: 'deploy-running', why: `could not take the deploy lock (${DEPLOY_LOCK}): another deploy keeps taking it. Try again in a moment.` };
}

/* ------------------------------------------------------------------ what went live */

/**
 * ONE HASH VOCABULARY. A game's hash is the BUILD's: the digest `homie-studio build` prints for it, keeps in
 * site/dist/_site/build.json, and that the live site says in /.well-known/homie-studio.json (`games[].build.hash`);
 * `perf` names the build it measured by the same one. A deploy used to compute a second, different hash of the same
 * folder (12 digits, with the landing's pictures in it), so "the hash the deploy printed" never matched "the hash the
 * build printed" or the one the live site answers with, and "is the live game the one I built?" could not be asked
 * of a deploy's own output. It reads the build's now. This is that digest for a game folder the build's report does
 * not name (a site built by an older toolkit): the same function, never a second recipe. Null when the game is not
 * built.
 */
export function gameHash(root, id) {
  return gameDigest(join(root, 'site', 'dist', 'games', id));
}

/** What the build said it made (site/dist/_site/build.json): { id: { hash, bundle, chunks, changed } }, or {}. */
export function buildReport(root) {
  try { return JSON.parse(readFileSync(join(root, 'site', 'dist', '_site', 'build.json'), 'utf8')).games ?? {}; } catch { return {}; }
}

/**
 * The built catalogue's games as a deploy sees them: { id: { hash } }. `hash` is the build's own when the
 * catalogue carries one for the game (a string `hash`), else gameHash.
 */
export function builtGames(root, ids) {
  let cat = null;
  try { cat = JSON.parse(readFileSync(join(root, 'site', 'dist', 'games.json'), 'utf8')); } catch { cat = null; }
  // The hash is the BUILD's own: from its report (build.json), else the catalogue's `built.hash`, else gameHash,
  // which is the same digest computed here.
  const report = buildReport(root);
  const out = {};
  for (const id of ids) {
    const row = (cat?.games ?? []).find((g) => g.id === id) ?? {};
    const said = report[id]?.hash ?? row.built?.hash;
    const own = typeof said === 'string' && /^[a-f0-9]{6,64}$/i.test(said) ? said.toLowerCase() : null;
    out[id] = { hash: own ?? gameHash(root, id) };
  }
  return out;
}

/**
 * This build against what the last deploy from this computer put live: per game 'new' (not deployed from here
 * before), 'changed' or 'unchanged'; and the games that are gone. `first` is true when this computer has no record of
 * a deploy (every game then reads 'new').
 *
 * `withdrawn`: the games the last deploy, made by a toolkit that still had remix, recorded as open to be taken whole
 * (`remix: true` in that record). This deploy serves no game's source, so a directory that listed the studio still
 * holds a stale offer for each until it reads the site again (lib/cloudflare.mjs asks it to, once: the record this
 * deploy writes has no such field, so the list is empty from then on).
 */
export function compareDeploy(now, before, older = before) {
  const prev = before?.games ?? null;
  const games = Object.entries(now).map(([id, g]) => {
    const was = prev?.[id];
    return { id, hash: g.hash, change: !was ? 'new' : was.hash === g.hash ? 'unchanged' : 'changed' };
  });
  const removed = Object.keys(prev ?? {}).filter((id) => !(id in now));
  // `older`: the record as it was written, whatever toolkit wrote it. A record from before deploys read the build's
  // hash is no record for comparing (lastDeploy), yet it is the one that says a game's whole source was offered.
  const offered = older?.games ?? {};
  const withdrawn = Object.keys(offered).filter((id) => offered[id]?.remix === true);
  return { first: !prev, games, removed, withdrawn };
}

/**
 * One game's line in a deploy's output, the same words in the terminal, in the deploy's steps and on the chat card:
 * "changed since the last deploy from this computer, build 0123456789abcdef". `change` is compareDeploy's
 * ('new' | 'changed' | 'unchanged'), or the result's 'first deploy from this computer'; a CI deploy has none.
 */
export function deployWords(g) {
  const build = g?.hash ? `build ${g.hash}` : 'no files';
  const c = g?.change;
  if (c === 'changed' || c === 'unchanged') return `${c} since the last deploy from this computer, ${build}`;
  if (c === 'new') return `new since the last deploy from this computer, ${build}`;
  return `${c ?? 'built'}, ${build}`;
}

/*
 * "CHANGED" IS SAID TWICE AND MEANS TWO THINGS. The build's report says changed since the last BUILD on this
 * computer; a deploy says changed since the last DEPLOY from this computer, from its own record here
 * (.studio/local.json `deployed`), because ten builds may sit between two deploys. Both compare the same hash.
 * A record written before deploys read the build's hash (no `hashes: 'build'`) holds the other recipe's hashes,
 * which compare unequal to everything: it is read as no record, so that one deploy says "first deploy from this
 * computer" instead of calling every game changed.
 */
/** What the last deploy from this computer put live ({ at, hashes, games }), or null. */
/** The last deploy's record exactly as written, by this toolkit or an older one (see compareDeploy's `older`). */
export function lastDeployRecord(root) { return readLocal(root).deployed ?? null; }
export function lastDeploy(root) {
  const rec = readLocal(root).deployed ?? null;
  return rec?.hashes === 'build' ? rec : null;
}
/** Record what this deploy put live, on this computer only. */
export function recordDeploy(root, now) { writeLocal(root, { deployed: { at: new Date().toISOString(), hashes: 'build', games: now } }); }
