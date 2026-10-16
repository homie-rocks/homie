import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eventTests,eventsAffected} from './ci-events.mjs';
import {inventory,selected} from './ci-shards.mjs';

test('focused Events gate covers all Events/webhook tests and retains full-suite coverage',()=>{
  const files=inventory().filter(f=>/^packages\/studio\/test\/(mcp-events|event-(delivery|resources|webhooks)|studios-events|sse-fixture).*\.test\.mjs$/.test(f));
  assert.deepEqual([...eventTests].sort(),files.sort());
  for(const file of eventTests){assert.ok(selected(inventory(),{full:true}).includes(file));assert.ok(eventsAffected([file]));}
  for(const path of ['packages/studio/worker/mcp.mjs','packages/studio/worker/studios-events.mjs','packages/studio/worker/functions.mjs','packages/studio/lib/functions-build.mjs','packages/studio/test/s2s-fixture.mjs','template/site/migrations/new.sql','package-lock.json','package.json','packages/studio/package.json','.github/workflows/ci.yml','scripts/ci-events.mjs'])assert.ok(eventsAffected([path]),path);
  for(const path of ['README.md','CHANGELOG.md','plugins/homie/skills/art/SKILL.md','packages/physics/src/index.ts'])assert.equal(eventsAffected([path]),false,path);
  assert.ok(eventsAffected(null));
  const workflow=readFileSync('.github/workflows/ci.yml','utf8');
  assert.match(workflow,/events: \$\{\{ steps\.events\.outputs\.needed \}\}/);
  assert.match(workflow,/node scripts\/ci-events\.mjs/);
  assert.match(workflow,/needs: \[package-shards, packaging, plugin, studio-scenarios, mcp-events\]/);
});
