import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGame, writeGame } from './rules-kit.mjs';
import { source } from './rules-feature-kit.mjs';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'homie-answer-boundary-')));
test.after(() => rmSync(root, { recursive: true, force: true }));
test('saved answer events cross the same declared question boundary before handlers run', async () => {
  const rules = source.replace("start(world) { world.ask('director', { danger: 1 }); }", 'start() {}');
  const L = await loadGame(root, writeGame(root, 'saved-answer', { rules }));
  const c = L.R.compileRules(L.def, { seats: 4 });
  const restore = (answer) => {
    const core = L.C.createCore(c, { seed: 7 });
    const saved = core.save();
    saved.queue.push([saved.tick + 1, 0, '', saved.seq++, '', 'room', 'answer', answer, saved.tick, 1]);
    const restored = L.C.createCore(c, { restore: saved });
    restored.step(); restored.drain();
    return restored.save().shared[0];
  };
  assert.equal(restore({ ask: 'director', by: 'floor', picks: { advance: true } }), 1);
  // A save is checked whole before any of it is used: an answer no floor could have given refuses the save.
  for (const answer of [{ ask: 'director', by: 'floor', picks: { advance: 'yes' } }, { ask: 'not-declared', by: 'floor', picks: { advance: true } }, { ask: 'director', by: 'invented', picks: { advance: true } }]) {
    assert.throws(() => restore(answer), /saved rules state is invalid/, JSON.stringify(answer));
  }
});
