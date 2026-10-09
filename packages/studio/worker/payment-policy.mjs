/** One vocabulary for recovery, expiry, buyer locks and office status. */
export const jobStates = Object.freeze({
  submitted: { pending: true, terminal: false, blocks: true },
  paid_recording: { pending: true, terminal: false, blocks: true },
  recorded: { pending: true, terminal: false, blocks: true },
  processing: { pending: true, terminal: false, blocks: true },
  duplicate_refund: { pending: true, terminal: false, blocks: true },
  failed: { pending: false, terminal: true, blocks: false },
  complete: { pending: false, terminal: true, blocks: false },
  refunded: { pending: false, terminal: true, blocks: false },
  duplicate_refunded: { pending: false, terminal: true, blocks: false },
  manual_review: { pending: true, terminal: false, blocks: true },
});
export function jobPolicy(state) {
  if (!jobStates[state]) throw new Error(`Unknown payment job state: ${state}`);
  return jobStates[state];
}
export function jobsSQL(property, prefix = '') {
  const names = Object.entries(jobStates).filter(([state, policy]) => property === 'visible' ? policy.pending || ['failed','manual_review'].includes(state) : property === 'cleanup' ? state === 'failed' : policy[property]).map(([state]) => `'${state}'`);
  return `${prefix}state IN (${names.join(',')})`;
}
export const pendingJobsSQL = jobsSQL('pending');
export const blockingJobsSQL = jobsSQL('blocks');
export const REPLAY_LIMIT_MS = 23 * 60 * 60 * 1000;
export function definitiveRefusal(error) {
  const status = error.statusCode ?? error.status;
  if ([401,403,408,409,429].includes(status) || error.type === 'idempotency_error') return false;
  if (error.idempotentReplayed && status >= 400 && status < 500) return true;
  return status === 402 && (error.type === 'card_error' || error.raw?.type === 'card_error');
}
/** Ordered decision table. Storage faults can never authorize a refund. */
export function recoveryAction({ state, fulfilled, provider, files, settled, deadline = false }) {
  if (fulfilled || state === 'fulfilled') return 'final';
  if (['refunded','disputed','lapsed','lost'].includes(state)) return 'preserve';
  if (provider === 'paid' || settled || state === 'paid') return files === 'present' ? 'deliver' : 'storage_retry';
  if (provider === 'refused' || provider === 'absent' && deadline) return 'fail';
  if (provider === 'absent') return 'replay';
  if (provider === 'processing') return 'wait';
  return 'reconcile';
}
