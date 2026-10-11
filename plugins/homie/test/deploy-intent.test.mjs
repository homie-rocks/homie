import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deployIntent} from '../hooks/lib/deploy-intent.mjs';
test('deploy intent comes from requests, not questions, quotations or explicit refusals',()=>{
  for(const text of ['Please deploy this studio.','Fix movement, then deploy it when checks pass.','Put it online.','Deploy!', 'Would you deploy this?', 'Can you deploy my studio?', 'I want you to deploy it.', 'Deploy now.', 'Please deploy to Cloudflare.', 'Deploy crowd-circuit after the checks.', "Let's deploy the changes."])assert.equal(deployIntent(text),true,text);
  for(const text of ["Don't deploy it.",'Do not deploy this studio.','Deploy this only when I approve.'])assert.equal(deployIntent(text),false,text);
  assert.equal(deployIntent("Don't forget to deploy it after the checks."),true);
  for(const text of ['How do I deploy this?','Explain how to deploy this.','> Please deploy this.','```\ndeploy this\n```','Fix the movement.', 'The log says "deploy this".', 'The report says deploy this.', 'Our deploy command failed.', 'Deploy failed yesterday; fix movement.', 'Deploy is broken.', 'Deploy or not?'])assert.equal(deployIntent(text),null,text);
});

test('a failed deploy destination is a report, while an explicit retry remains approval',()=>{
  for(const text of [
    'Deploy to Cloudflare failed yesterday; explain the error.',
    'Publish to Pages was blocked by the hook.',
    'Deploy to staging is broken.',
    'Deploy to https://example.workers.dev failed yesterday.',
  ])assert.equal(deployIntent(text),null,text);
  for(const text of [
    'Deploy to Cloudflare failed yesterday. Please deploy it again.',
    'Deploy to Cloudflare failed, deploy it again.',
    'Deploy to Cloudflare if the previous attempt failed.',
    'Deploy to Cloudflare after fixing what failed.',
    'Deploy to Cloudflare (the previous attempt failed).',
  ])assert.equal(deployIntent(text),true,text);
});
