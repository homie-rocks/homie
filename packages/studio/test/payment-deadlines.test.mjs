import {test} from 'node:test';
import assert from 'node:assert/strict';
import {card,base,orders,jobs,cron} from './paid-parts-review5-kit.mjs';
import {saveRecording,reconcileRecordings} from '../worker/payment-recovery.mjs';
import {REPLAY_LIMIT_MS} from '../worker/payment-policy.mjs';
import {manualRefundDetails,confirmManualRefund} from '../worker/payment-manual-refund.mjs';
import {keccak256,toHex} from 'viem';
test('old unresolved submissions stop before the provider idempotency window can expire',async()=>{
 const s=await card('old-submission');try{
  await s.post(s.body());const o=s.w.sql.prepare('SELECT * FROM purchase_orders').get();
  const id=await saveRecording(s.w.env,o,{amount:1000,currency:'usd',confirm:true,shared_payment_granted_token:s.spt()},{idempotencyKey:'old-attempt'});
  const saved=s.w.sql.prepare('SELECT payload FROM purchase_jobs WHERE id = ?').get(id);
  const payload={...JSON.parse(saved.payload),startedAt:Date.now()-REPLAY_LIMIT_MS-1};
  s.w.sql.prepare('UPDATE purchase_jobs SET payload = ? WHERE id = ?').run(JSON.stringify(payload),id);
  const before=s.w.st.reqs.length;
  await reconcileRecordings(s.w.env);await reconcileRecordings(s.w.env);
  assert.ok(s.w.st.reqs.slice(before).every((r) => r.method === 'GET'));assert.equal(jobs(s.w)[0].state,'failed');
  assert.equal((await s.post(s.body())).status,402);
 }finally{s.K.restore();await s.w.close();}
});
test('unrecorded Base payment has one job and a verified manual refund completion path',async()=>{
 const s=await base('manual-base');try{
  s.w.st.cryptoReject='Crypto transaction verification is not enabled on this account.';
  const challenge=await s.post(s.body());const result=await s.post(s.body(),await s.sign(challenge));assert.equal(result.status,200);await result.text();
  await cron(s.w,2);const order=orders(s.w)[0];
  assert.equal(jobs(s.w).length,1);assert.ok(['paid_recording','manual_review'].includes(jobs(s.w)[0].state));
  const evidence=(await manualRefundDetails(s.w.env,order)).transfers[0];
  assert.equal((await confirmManualRefund(s.w.env,order,evidence.transaction)).ok,false);
  const refund=`0x${'9'.repeat(64)}`;
 s.w.handle('mainnet.base.org',async(req)=>{const body=await req.json();const result=body.method==='eth_getBlockByNumber'?{timestamp:`0x${Math.floor(Date.now()/1000+60).toString(16)}`}:{status:'0x1',blockNumber:body.params[0]===refund?'0x12':'0x11',logs:[{address:evidence.token,topics:[keccak256(toHex('Transfer(address,address,uint256)')),`0x${evidence.recipient.slice(2).padStart(64,'0')}`,`0x${evidence.payer.slice(2).padStart(64,'0')}`],data:`0x${BigInt(evidence.amount).toString(16)}`}]};return Response.json({jsonrpc:'2.0',id:1,result});});
  assert.equal((await confirmManualRefund(s.w.env,order,refund)).ok,true);
  assert.equal(orders(s.w)[0].status,'refunded');
  assert.equal(s.w.sql.prepare('SELECT transaction_hash FROM purchase_manual_refunds').get().transaction_hash,refund);
 }finally{s.K.restore();await s.w.close();}
});
