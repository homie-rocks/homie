import { browserRulesGame } from './browser-rules-game.mjs';
/**
 * `homie-studio build` for server and browser games using one rules-plus-view contract
 * (rooms-milestone-1-design.md sections 7 and 8).
 *
 *   - coin-dash builds: its view bundle holds the guarded move code and the rules' declarations as data, and none of
 *     the rules' own code; its rules go to site/src/rules/ as one module that imports only Homie's rules module and
 *     the guard, with a table the studio's Worker imports; the catalogue says its rules run on the server;
 *   - browser/offline games use guarded rules too; existing netplay builds remain supported;
 *   - rules the wall refuses stop the build with the line named, and leave the site and site/src/rules as they were;
 *   - rules that fail when they run stop the build with the handler named;
 *   - a new studio's Worker imports an empty table, and its config turns off evaluation at startup.
 * Run: node --test packages/studio/test/rules-build.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildGameFiles, build as buildSite } from '../lib/build.mjs';
import { webBundle } from '../lib/standalone.mjs';
import { starters, listGames } from '../lib/studio.mjs';
import { PKG, REPO_NM, esbuildOf } from './rules-kit.mjs';

const CLI = join(PKG, 'bin', 'homie-studio.mjs');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'homie-studio-rules-build-')));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args, '--json'], { cwd, encoding: 'utf8' });
const out = (r) => { try { return JSON.parse(r.stdout); } catch { throw new Error(`not JSON: ${r.stdout}${r.stderr}`); } };
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

function studio(name) {
  const dir = join(scratch, name);
  const r = run(['new', dir, '--name', 'Rule Owls', '--homie', 'https://homie.test', '--no-install'], scratch);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  mkdirSync(join(dir, 'node_modules', '@homie-rocks'), { recursive: true });
  symlinkSync(PKG, join(dir, 'node_modules', '@homie-rocks', 'studio'));
  symlinkSync(join(REPO_NM, 'esbuild'), join(dir, 'node_modules', 'esbuild'));
  return dir;
}

test('game hashes are reproducible, isolate unrelated builds, and distinguish code from state shape', () => {
  const dir = studio('hashes');
  assert.equal(run(['game', 'new', 'coin-dash', '--from', 'coin-dash'], dir).status, 0);
  browserRulesGame(dir, 'gems');
  const build = () => {
    const r = run(['build'], dir); assert.equal(r.status, 0, r.stdout + r.stderr);
    const trial = out(r).games.find(g => g.id === 'coin-dash').capacityTrial;
    assert.equal(trial.seats, 32); assert.equal(trial.host, 'Node'); assert.equal(trial.cloudflare, false);
    assert.equal(out(r).games.find(g => g.id === 'gems').capacityTrial.cloudflare, false, 'browser rules do not claim Cloudflare capacity');
    return JSON.parse(read(dir, 'site/dist/games.json')).games.find((g) => g.id === 'coin-dash');
  };
  const first = build();
  assert.deepEqual(build().room, first.room);
  assert.equal(first.netplay.version, first.room.build);
  const unrelated = 'games/gems/src/main.ts';
  writeFileSync(join(dir, unrelated), read(dir, unrelated) + '\nconsole.log("other game changed");\n');
  assert.deepEqual(build().room, first.room, 'another game does not reload this one');
  const view = 'games/coin-dash/src/view.ts';
  writeFileSync(join(dir, view), read(dir, view) + '\nconsole.log("view changed");\n');
  const viewed = build();
  assert.notEqual(viewed.room.build, first.room.build); assert.equal(viewed.room.stateHash, first.room.stateHash);
  const tunePath = 'games/coin-dash/tunables.json'; const tune = JSON.parse(read(dir, tunePath));
  tune.public.speed.value = 5;
  writeFileSync(join(dir, tunePath), JSON.stringify(tune));
  const tuned = build();
  assert.notEqual(tuned.room.build, viewed.room.build); assert.equal(tuned.room.stateHash, first.room.stateHash);
  const path = 'games/coin-dash/src/rules.ts'; const src = read(dir, path);
  writeFileSync(join(dir, path), src.replace('self.score += 1;', 'self.score += 2;'));
  const coded = build();
  assert.notEqual(coded.room.build, tuned.room.build); assert.equal(coded.room.stateHash, first.room.stateHash);
  writeFileSync(join(dir, path), src.replace('score: f.u16({ score: true })', 'score: f.u32({ score: true })'));
  const shaped = build(); assert.notEqual(shaped.room.stateHash, first.room.stateHash);
  const mapPath = 'games/coin-dash/map/main.json'; const map = JSON.parse(read(dir, mapPath));
  map.spots.start[0][0] += 1;
  writeFileSync(join(dir, mapPath), JSON.stringify(map));
  const mapped = build(); assert.notEqual(mapped.room.stateHash, shaped.room.stateHash); assert.notEqual(mapped.room.build, shaped.room.build);
});

