/** Exact chain evidence for the studio's explicitly accepted manual refund duty. */
export async function manualRefundDetails(env, order) {
  if (order.payment || !order.paid_at) return null;
  const rows = (await env.DB.prepare("SELECT network,reference,payload FROM purchase_settlements WHERE order_id = ?1 AND state IN ('settled','complete')").bind(order.id).all()).results ?? [];
  const transfers = rows.map((row) => {
    const data = JSON.parse(row.payload);
    const auth = data.payload?.payload?.authorization;
    return { network: row.network, transaction: row.reference ?? data.reference, payer: auth?.from ?? null,
      amount: auth?.value ?? null, token: data.requirements?.asset ?? null, recipient: auth?.to ?? null };
  });
  return { status: 'manual_refund_required', order: order.id, delivered: Boolean(order.fulfilled_at), transfers,
    message: 'Stripe has not recorded this chain payment. The selling studio owes any requested refund directly to the original payer. Use the exact network, token, amount and transaction below; record the refund transaction in the order note. Do not mark refunded until the transfer is confirmed.' };
}

/** Owner-supplied refund transaction must actually return the exact token amount to the payer. */
export async function confirmManualRefund(env, order, transaction) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transaction ?? '')) return { ok: false, error: 'refund-transaction', message: 'Supply the confirmed Base refund transaction hash.' };
  const manual = await manualRefundDetails(env, order);
  if (!manual?.transfers.length || manual.transfers.some((t) => t.network !== 'base')) return { ok:false, error:'refund-evidence', message:'Verified Base transfers are required.' };
  const original = manual.transfers[0];
  if (manual.transfers.some((t) => ['payer','token','recipient','amount'].some((key) => t[key]?.toLowerCase() !== original[key]?.toLowerCase()))) return { ok: false, error: 'refund-evidence', message: 'These transfers need separate refund evidence.' };
  if (transaction.toLowerCase() === original.transaction?.toLowerCase()) return {ok:false,error:'refund-evidence',message:'The original payment is not a refund.'};
  const { rpcFor } = await import('./settlement-journal.mjs');
  const rpc = rpcFor(env,'base',order.mode);
  const receipt = await rpc('eth_getTransactionReceipt',[transaction]);
  const paidReceipt = await rpc('eth_getTransactionReceipt',[original.transaction]);
  if (!receipt?.blockNumber || !paidReceipt?.blockNumber || BigInt(receipt.blockNumber) <= BigInt(paidReceipt.blockNumber)) return { ok: false, error: 'refund-evidence', message: 'The refund must be mined after the original payment.' };
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
  if (!block?.timestamp || Number(BigInt(block.timestamp)) * 1000 <= order.created_at) return { ok: false, error: 'refund-evidence', message: 'The refund must be sent after this order.' };
  const { keccak256, toHex } = await import('viem');
  const topic = keccak256(toHex('Transfer(address,address,uint256)'));
  if (receipt?.status !== '0x1' || !receipt.logs?.some((log) => log.address.toLowerCase() === original.token.toLowerCase() && log.topics[0] === topic && log.topics[1]?.slice(-40).toLowerCase() === original.recipient.slice(2).toLowerCase() && log.topics[2]?.slice(-40).toLowerCase() === original.payer.slice(2).toLowerCase() && BigInt(log.data) === BigInt(original.amount)))
    return {ok:false,error:'refund-evidence',message:'The chain receipt does not prove the exact refund to the original payer.'};
  const { orderFact } = await import('./purchase-core.mjs');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO purchase_manual_refunds (transaction_hash,order_id) VALUES (?1,?2)').bind(transaction.toLowerCase(),order.id),
    orderFact(env,order.id,'refunded',{refund:transaction,refunded_at:Date.now(),note:JSON.stringify({sender:original.recipient,payer:original.payer,amount:original.amount,transaction})}),
  ]);
  return {ok:true,order:order.id,status:'succeeded',refund:transaction};
}
