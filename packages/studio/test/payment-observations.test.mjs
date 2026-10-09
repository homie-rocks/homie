import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, orders, jobs } from './paid-parts-review5-kit.mjs';
import { saveRecording, reconcileRecordings } from '../worker/payment-recovery.mjs';
for (const status of ['succeeded','canceled','requires_payment_method','requires_action','requires_confirmation','requires_capture','processing']) {
  test(`recovery reads the existing ${status} PaymentIntent before acting`, async () => {
    const s = await card(`observed-${status}`);
    try {
      await s.post(s.body()); const order = s.w.sql.prepare('SELECT * FROM purchase_orders').get();
      const pi = {id:'pi_observed',amount:order.amount,currency:order.currency,status,livemode:true,metadata:{order:order.id}};
      s.w.st.pis.set(pi.id,pi);
      await saveRecording(s.w.env,order,{amount:order.amount,currency:order.currency,metadata:{order:order.id}},{idempotencyKey:'observed'});
      const from=s.w.st.reqs.length;
      await reconcileRecordings(s.w.env,order.id);
      const calls=s.w.st.reqs.slice(from);
      assert.equal(calls[0].method,'GET');
      assert.equal(calls.filter((r)=>r.method==='POST'&&r.path==='/v1/payment_intents').length,0);
      if(status==='succeeded') assert.ok(['paid','fulfilled'].includes(orders(s.w)[0].status));
      else if(status==='processing') {
        assert.equal(jobs(s.w)[0].state,'processing');
        await reconcileRecordings(s.w.env,order.id,{cancel:true});
        assert.equal(jobs(s.w)[0].state,'failed');
      } else assert.equal(jobs(s.w)[0].state,'failed');
      assert.ok(orders(s.w).some((o)=>o.id===order.id),'the order remains available for a late webhook');
    } finally {s.K.restore();await s.w.close();}
  });
}
