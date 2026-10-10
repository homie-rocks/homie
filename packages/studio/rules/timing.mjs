/** Bounded stage samples. Frozen runtime clocks are unavailable, never zero CPU. */
export function stageTimings(now = () => globalThis.performance?.now?.() ?? 0, limit = 256) {
  const stages = new Map();
  return {
    now,
    record(stage, start) {
      const ms = Math.max(0, now() - start);
      const values = stages.get(stage) ?? [];
      values.push(ms); if (values.length > limit) values.shift(); stages.set(stage, values);
    },
    facts() {
      const advancing = [...stages.values()].some(values => values.some(ms => ms > 0));
      return { clock: advancing ? 'performance' : 'unavailable-or-below-resolution', ms: Object.fromEntries([...stages].map(([name, values]) => {
        const sorted = [...values].sort((a,b)=>a-b);
        return [name, advancing ? { samples: sorted.length, p50: sorted[Math.floor(sorted.length*.5)], p95: sorted[Math.floor(sorted.length*.95)], max: sorted.at(-1) } : null];
      })) };
    }
  };
}
