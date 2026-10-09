import { test } from 'node:test';
import assert from 'node:assert/strict';
import { states } from '../worker/purchase-core.mjs';
import { recoveryAction, jobPolicy, jobStates, definitiveRefusal } from '../worker/payment-policy.mjs';
for (const state of states) for (const provider of ['paid','refused','unknown']) for (const files of ['present','missing','unreachable']) for (const settled of [true,false]) for (const fulfilled of [true,false]) {
  test(`recovery ${state} provider ${provider} files ${files} settled ${settled} delivered ${fulfilled}`, () => {
    const action = recoveryAction({state,provider,files,settled,fulfilled});
    if (fulfilled || state === 'fulfilled') assert.equal(action,'final');
    else if (['refunded','disputed','lapsed','lost'].includes(state)) assert.equal(action,'preserve');
    else if (settled || provider === 'paid' || state === 'paid') assert.equal(action,files === 'present' ? 'deliver' : 'storage_retry');
    else assert.equal(action,provider === 'refused' ? 'fail' : 'reconcile');
    assert.notEqual(action,'refund');
  });
}
test('every job has one policy and provider refusals use both supported error fields', () => {
  for (const state of Object.keys(jobStates)) assert.notEqual(jobPolicy(state).pending,jobPolicy(state).terminal);
  for (const name of ['status','statusCode']) { assert.equal(definitiveRefusal({[name]:402,type:'card_error'}),true); assert.equal(definitiveRefusal({[name]:429}),false); }
});

for (const deadline of [false, true]) for (const provider of ['absent','processing','unknown','refused']) {
  test(`unresolved provider observation ${provider} deadline ${deadline}`, () => {
    const expected = provider === 'absent' ? deadline ? 'fail' : 'replay' : provider === 'processing' ? 'wait' : provider === 'refused' ? 'fail' : 'reconcile';
    assert.equal(recoveryAction({state:'started',provider,deadline}),expected);
  });
}
for (const status of [400,401,403,408,409,429,500]) test(`call failure ${status} cannot prove the original payment failed`, () => {
  assert.equal(definitiveRefusal({status,type:status===400?'idempotency_error':'api_error'}),false);
});
