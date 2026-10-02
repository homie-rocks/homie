/**
 * A build's progress feed (`.studio/progress/<build>.json`, @homie-rocks/studio lib/progress.mjs), read for a person
 * at a glance: the same numbers the status line, the Game Codex and the Claude app's card show (lib/feed-summary.mjs
 * in the studio package; test/mod-lib.test.mjs checks the two agree). Plain functions: no `$`, no I/O.
 */

const PASSED = new Set(['pass', 'skip']);
const KIND = 'homie-studio-progress';
export const BUILD_ID = /^[a-z0-9][a-z0-9-]{5,63}$/;

/** A parsed feed document, or null when it is not one. */
export function feedOf(text) {
  try {
    const d = typeof text === 'string' ? JSON.parse(text) : text;
    return d && d.kind === KIND && Array.isArray(d.stages) ? d : null;
  } catch { return null; }
}

/** One feed as a person reads it: how far along, the stage, the checks, the spend, the preview. */
export function summarize(doc) {
  if (!doc || !Array.isArray(doc.stages)) return null;
  const checks = Array.isArray(doc.checks) ? doc.checks : [];
  let units = 0;
  for (const s of doc.stages) {
    if (s.state === 'done' || s.state === 'skipped') units += 1;
    else if (s.state === 'running') {
      const own = checks.filter((c) => c.stage === s.id);
      units += own.length ? 0.1 + 0.85 * (own.filter((c) => PASSED.has(c.state)).length / own.length) : 0.35;
    }
  }
  const total = Math.max(1, doc.stages.length);
  const percent = doc.state === 'passed' ? 100 : Math.max(0, Math.min(99, Math.round((units / total) * 100)));
  const at = doc.stages.find((s) => s.id === doc.stage) ?? doc.stages.find((s) => s.state === 'running') ?? null;
  const spend = doc.spend ?? { unit: 'usd', used: 0, budget: null };
  const money = (n) => (spend.unit === 'credits' ? `${Math.round(Number(n))} credits` : `$${Number(n).toFixed(2)}`);
  const used = Number(spend.used) || 0;
  const hasBudget = spend.budget !== null && spend.budget !== undefined;
  return {
    build: doc.build, what: doc.what, id: doc.id ?? null, title: String(doc.title ?? doc.id ?? 'Build'), studio: doc.studio ?? '',
    state: doc.state, percent,
    stage: at ? { id: at.id, label: at.label, state: at.state, note: at.note ?? '' } : null,
    stages: doc.stages.map((s) => ({ id: s.id, label: s.label, state: doc.state === 'passed' && s.state === 'pending' ? 'skipped' : s.state, note: s.note ?? '' })),
    checks: checks.map((c) => ({ id: c.id, label: c.label ?? c.id, stage: c.stage ?? null, state: c.state, ms: c.ms ?? null, note: c.note ?? '' })),
    counts: {
      total: checks.length,
      pass: checks.filter((c) => PASSED.has(c.state)).length,
      fail: checks.filter((c) => c.state === 'fail').length,
      running: checks.filter((c) => c.state === 'running').length,
    },
    spend: { unit: spend.unit, used, budget: hasBudget ? Number(spend.budget) : null, text: used || hasBudget ? `${money(used)}${hasBudget ? ` of ${money(spend.budget)}` : ''}` : '' },
    preview: doc.preview?.url ?? null,
    previewImage: doc.preview?.image ?? null,
    previewCaption: doc.preview?.caption ?? '',
    previewAt: doc.preview?.at ?? null,
    stopping: Boolean(doc.stop?.requested) && doc.state === 'running',
    last: Array.isArray(doc.log) && doc.log.length ? doc.log[doc.log.length - 1].text : '',
    log: Array.isArray(doc.log) ? doc.log.slice(-6).map((l) => l.text) : [],
    error: doc.error ?? null,
    change: doc.change ?? null,
    site: doc.site ?? null,
    startedAt: doc.startedAt ?? null, updatedAt: doc.updatedAt ?? null, endedAt: doc.endedAt ?? null,
  };
}

/** A bar of `width` cells for a percentage: '▰▰▰▱▱'. */
export function bar(percent, width) {
  const full = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return { done: '▰'.repeat(full), left: '▱'.repeat(width - full) };
}

/** The mark and colour of a stage or check state. */
export function markOf(state) {
  switch (state) {
    case 'done': case 'pass': case 'passed': return { mark: '✓', color: 'green' };
    case 'failed': case 'fail': return { mark: '✗', color: 'red' };
    case 'running': return { mark: '●', color: 'cyan' };
    case 'skipped': case 'skip': return { mark: '–', color: undefined, dim: true };
    case 'stopped': return { mark: '■', color: 'yellow' };
    default: return { mark: '○', color: undefined, dim: true };
  }
}

/** How long ago an ISO time was, in a few words ("12 s ago", "3 min ago"). */
export function ago(iso, now) {
  const t = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
