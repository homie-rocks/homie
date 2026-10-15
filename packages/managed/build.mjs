/** Step 2 boundary: remote Cloudflare Sandbox job, no operator-side build fallback. */
export async function buildInSandbox(job,runner) {
  if(!runner || runner.kind!=='cloudflare-sandbox')throw new Error('Isolated Cloudflare Sandbox runner required; local owner builds are disabled');
  if(!job?.sourceDigest || !job?.toolkitDigest)throw new Error('Immutable source and toolkit digests required');
  // The runner must mount only this tenant's snapshot, with no operator secrets,
  // enforce CPU/time/output quotas, and return immutable artifact metadata.
  const artifact=await runner.build({sourceDigest:job.sourceDigest,toolkitDigest:job.toolkitDigest,tenant:job.tenant});
  if(!artifact?.digest || !artifact?.manifest)throw new Error('Sandbox returned no sealed artifact');
  return artifact;
}
