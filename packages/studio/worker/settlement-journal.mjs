import { REPLAY_LIMIT_MS } from './payment-policy.mjs';
/** Write-ahead settlement journal. Only protocol-validated operations enter this module. */
import { digest } from "./purchase-crypto.mjs";

import { modeOf } from './stripe.mjs';

export { SETTLEMENT_SCHEMA } from './purchase-schema.mjs';

export async function beginSettlement(env, order, network, payload) {
  const { fromBlock: cursor, ...identity } = payload;
  const id = await digest(JSON.stringify({ order: order.id, network, payload: identity }));
  await env.DB.prepare("INSERT OR IGNORE INTO purchase_settlements (id,order_id,mode,network,payload,state,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,'settling',?6,?6)")
    .bind(id, order.id, order.mode, network, JSON.stringify({ ...payload, challengeId: order.challengeId }), Date.now()).run();
  return id;
}
export async function finishSettlement(env, id, reference) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(reference)) throw new Error('Invalid settlement reference');
  await env.DB.prepare("UPDATE purchase_settlements SET reference = ?2, state = 'settled', error = NULL, updated_at = ?3 WHERE id = ?1 AND state != 'complete'")
    .bind(id, reference, Date.now()).run();
}

export function journalFacilitator(env, order, facilitator, rpc) {
  return {
    verify: (...args) => facilitator.verify(...args),
    async settle(payload, requirements) {
      // Capture the scan cursor before submitting; the authorization nonce identifies
      // the transfer even if the facilitator's response disappears with this isolate.
      const fromBlock = await rpc('eth_blockNumber', []);
      const id = await beginSettlement(env, order, 'base', { payload, requirements, fromBlock });
      const result = await facilitator.settle(payload, requirements);
      if (result.success) await finishSettlement(env, id, result.transaction);
      return result;
    },
  };
}

export function rpcFor(env, network, mode = modeOf(env.STRIPE_KEY)) {
  const config = JSON.parse(env.PURCHASE_MACHINE_PAYMENTS ?? '{}')[mode] ?? {};
  const url = config.rpc?.[network] ?? (network === 'base'
    ? mode === 'live' ? 'https://mainnet.base.org' : 'https://sepolia.base.org'
    : mode === 'live' ? 'https://rpc.tempo.xyz' : 'https://rpc.moderato.tempo.xyz');
  return async (method, params) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error?.message ?? `Chain RPC answered ${response.status}`);
    return body.result;
  };
}

/** The final, canonical signed transaction is durable before an RPC may broadcast it. */
export async function journalTempoClient(env, order, chainId) {
  const { createClient, custom, keccak256 } = await import('viem');
  const { tempo, tempoModerato } = await import('viem/tempo/chains');
  const rpc = rpcFor(env, 'tempo', order.mode);
  return createClient({ chain: (chainId ?? (order.mode === 'live' ? tempo.id : tempoModerato.id)) === tempo.id ? tempo : tempoModerato, transport: custom({
    async request({ method, params }) {
      if (!['eth_sendRawTransaction', 'eth_sendRawTransactionSync'].includes(method)) return rpc(method, params);
      const raw = params[0];
      const reference = keccak256(raw);
      const id = await beginSettlement(env, order, 'tempo', { raw, reference });
      const result = await rpc(method, params);
      await finishSettlement(env, id, reference);
      return result;
    },
  }) });
}

/** Recover a fact from chain evidence, never from an unverified client receipt. */
export async function findSettlement(env, job, { rpc = rpcFor(env, job.network, job.mode) } = {}) {
  const payload = JSON.parse(job.payload);
  let reference = job.reference ?? payload.reference;
  if (!reference && job.network === 'base') {
    const { keccak256, toHex } = await import('viem');
    const auth = payload.payload.payload.authorization;
    const topic = keccak256(toHex('AuthorizationUsed(address,bytes32)'));
    const latest = BigInt(await rpc('eth_blockNumber', []));
    const from = BigInt(payload.fromBlock);
    const to = from + 1999n < latest ? from + 1999n : latest;
    const logs = await rpc('eth_getLogs', [{ address: payload.requirements.asset, fromBlock: payload.fromBlock, toBlock: `0x${to.toString(16)}`, topics: [topic, `0x${auth.from.slice(2).padStart(64, '0')}`, auth.nonce] }]);
    reference = logs[0]?.transactionHash;
    if (!reference && to < latest) {
      await env.DB.prepare('UPDATE purchase_settlements SET payload = ?2 WHERE id = ?1').bind(job.id, JSON.stringify({ ...payload, fromBlock: `0x${(to+1n).toString(16)}` })).run();
      return { scanning: true };
    }
  }
  if (!reference) return null;
  const receipt = await rpc('eth_getTransactionReceipt', [reference]);
  if (!receipt) return null;
  if (receipt.status === '0x0') return { unpaid: true, reason: 'The settlement transaction reverted.' };
  if (receipt.status !== '0x1') return null;
  if (job.network === 'base') {
    const { keccak256, toHex } = await import('viem');
    const auth = payload.payload.payload.authorization;
    const transfer = keccak256(toHex('Transfer(address,address,uint256)'));
    const found = receipt.logs?.some((log) => log.address.toLowerCase() === payload.requirements.asset.toLowerCase() && log.topics[0] === transfer && log.topics[1]?.slice(-40).toLowerCase() === auth.from.slice(2).toLowerCase() && log.topics[2]?.slice(-40).toLowerCase() === auth.to.slice(2).toLowerCase() && BigInt(log.data) === BigInt(auth.value));
    if (!found) throw new Error('Settlement receipt does not contain the accepted transfer');
  }
  // Tempo raw bytes are persisted only after mppx validates recipient, amount,
  // token and challenge binding; a successful receipt proves those exact calls ran.
  return reference;
}

/** Replaying the same authorization/raw transaction cannot transfer twice on chain. */
export async function resumeSettlement(env, job, dependencies = {}) {
  const rpc = dependencies.rpc ?? rpcFor(env, job.network, job.mode);
  const found = await findSettlement(env, job, { rpc });
  if (found?.scanning) return null;
  if (found) return found;
  const payload = JSON.parse(job.payload);
  if (job.network === 'base') {
    const finalBlock = await rpc('eth_getBlockByNumber', ['finalized', false]);
    if (finalBlock?.timestamp && BigInt(finalBlock.timestamp) > BigInt(payload.payload.payload.authorization.validBefore))
      return { unpaid: true, reason: 'The authorization expired without a transfer on the finalized chain.' };
  }
  if (Date.now() - job.created_at >= REPLAY_LIMIT_MS) return { manual: true, reason: 'Settlement deadline reached. Check the recorded transaction and payer before another payment; automatic broadcasting has stopped.' };
  if (job.network === 'tempo') {
    try { await rpc('eth_sendRawTransaction', [payload.raw]); }
    catch { /* It may already be mined; the chain receipt decides. */ }
  } else if (BigInt(payload.payload.payload.authorization.validBefore) > BigInt(Math.floor(Date.now() / 1000))) {
    let facilitator = dependencies.facilitator;
    if (!facilitator) {
      const { HTTPFacilitatorClient } = await import('@x402/core/server');
      const { createFacilitatorConfig } = await import('@coinbase/x402');
      facilitator = new HTTPFacilitatorClient(job.mode === 'live' ? createFacilitatorConfig(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET) : { url: 'https://x402.org/facilitator' });
    }
    const result = await facilitator.settle(payload.payload, payload.requirements);
    if (result.success) return result.transaction;
  }
  const recovered = await findSettlement(env, job, { rpc });
  if (recovered?.scanning) return null;
  if (recovered) return recovered;
  if (job.network === 'base') {
    const finalBlock = await rpc('eth_getBlockByNumber', ['finalized', false]);
    if (finalBlock?.timestamp && BigInt(finalBlock.timestamp) > BigInt(payload.payload.payload.authorization.validBefore))
      return { unpaid: true, reason: 'The authorization expired without a transfer on the finalized chain.' };
  }
  return null;
}
