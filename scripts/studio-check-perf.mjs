/** Validate the instrument's output, including a server room's two browser replicas. */
export function perfProblems(runs, { hosted = 'browser' } = {}) {
  const problems = [];
  if (runs.length !== 2 || runs.some((r) => !r)) problems.push('expected a computer run and a phone run');
  if (runs.filter(Boolean).map((r) => r.device).sort().join(',') !== 'computer,phone') problems.push('missing device');
  for (const run of runs.filter(Boolean)) {
    const roles = (run.browsers ?? []).map((b) => b.role).sort().join(',');
    const expected = hosted === 'server' ? 'replica,replica-2' : 'host,replica';
    if (roles !== expected) problems.push(`${run.device}: roles ${roles || 'none'} (expected ${expected})`);
    if (hosted === 'server' && run.room?.hosted !== 'server') problems.push(`${run.device}: no server host evidence`);
    for (const b of run.browsers ?? []) {
      if (hosted === 'server' && b.netplay?.hosted !== 'server') problems.push(`${run.device} ${b.role}: no server host evidence`);
      if (b.errors?.length) problems.push(`${run.device} ${b.role}: ${b.errors.join('; ')}`);
      const need = { 'load.playableMs': b.load?.playableMs, 'frames.n': b.frames?.n, 'frames.p95': b.frames?.p95, 'main.busyPerFrame': b.main?.busyPerFrame, 'heap.afterGcMb': b.heap?.afterGcMb, 'net.msgsOut': b.net?.msgsOut };
      for (const [k, v] of Object.entries(need)) if (!Number.isFinite(v)) problems.push(`${run.device} ${b.role}: no ${k}`);
    }
    if (/swiftshader|llvmpipe|software/i.test(run.renderer ?? '') && !run.blocked) problems.push(`${run.device}: software renderer but the run is not blocked`);
  }
  return problems;
}
