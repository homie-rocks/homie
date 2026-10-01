/**
 * A build's progress feed (lib/progress.mjs), read for a person at a glance: how far along it is (a percentage and
 * the stage it is in), its checks, its preview and what it spent. The Game Codex page (lib/codex.mjs) and the Claude
 * Code status line (lib/statusline.mjs) both draw from this, so they always agree.
 *
 * Read-only and small on purpose: the status line runs it every few seconds, so it imports nothing but node:fs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KIND = 'homie-studio-progress';
const DIR = join('.studio', 'progress');
const BUILD_ID = /^[a-z0-9][a-z0-9-]{5,63}$/;

function read(root, id) {
  if (!BUILD_ID.test(String(id ?? ''))) return null;
  try { const d = JSON.parse(readFileSync(join(root, DIR, `${id}.json`), 'utf8')); return d?.kind === KIND ? d : null; } catch { return null; }
}

/** The open build's feed (`.studio/progress/current`), or null. */
export function currentFeedDoc(root) {
  try {
    const id = readFileSync(join(root, DIR, 'current'), 'utf8').trim();
    const doc = read(root, id);
    return doc?.state === 'running' ? doc : null;
  } catch { return null; }
}

/** The newest feed of one game, song or video (`id`), or of anything (`id` null): the open one first. */
export function latestFeedFor(root, id = null) {
  const open = currentFeedDoc(root);
  if (open && (id === null || open.id === id)) return open;
  let names = [];
  try { names = readdirSync(join(root, DIR)).filter((n) => n.endsWith('.json')); } catch { return null; }
  let best = null;
  for (const name of names) {
    const doc = read(root, name.slice(0, -5));
    if (!doc || (id !== null && doc.id !== id)) continue;
    if (!best || String(doc.updatedAt ?? '') > String(best.updatedAt ?? '')) best = doc;
  }
  return best;
}

const PASSED = new Set(['pass', 'skip']);

/**
 * One feed as a person reads it. `percent` counts every stage alike: a finished or skipped stage is whole, the
 * running one is part done (by its checks going green, when it has checks), and a build is 100 only once it passed.
 */
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
  const done = doc.stages.filter((s) => s.state === 'done' || s.state === 'skipped').length;
  const spend = doc.spend ?? { unit: 'usd', used: 0, budget: null };
  const money = (n) => (spend.unit === 'credits' ? `${n} credits` : `$${Number(n).toFixed(2)}`);
  return {
    build: doc.build, what: doc.what, id: doc.id ?? null, title: doc.title ?? doc.id ?? 'Build', studio: doc.studio ?? '',
    state: doc.state, percent, stagesDone: done, stagesTotal: doc.stages.length,
    stage: at ? { id: at.id, label: at.label, state: at.state, note: at.note ?? '' } : null,
    stages: doc.stages.map((s) => ({ id: s.id, label: s.label, state: s.state, note: s.note ?? '', checks: checks.filter((c) => c.stage === s.id) })),
    checks: {
      total: checks.length,
      pass: checks.filter((c) => PASSED.has(c.state)).length,
      fail: checks.filter((c) => c.state === 'fail').length,
      running: checks.filter((c) => c.state === 'running').length,
    },
    spend: { unit: spend.unit, used: Number(spend.used) || 0, budget: spend.budget ?? null, text: Number(spend.used) || spend.budget !== null ? `${money(Number(spend.used) || 0)}${spend.budget !== null && spend.budget !== undefined ? ` of ${money(spend.budget)}` : ''}` : '' },
    preview: doc.preview?.url ?? null,
    previewImage: doc.preview?.image ?? null,
    previewCaption: doc.preview?.caption ?? '',
    stopping: Boolean(doc.stop?.requested) && doc.state === 'running',
    last: Array.isArray(doc.log) && doc.log.length ? doc.log[doc.log.length - 1].text : '',
    error: doc.error ?? null,
    startedAt: doc.startedAt ?? null, updatedAt: doc.updatedAt ?? null, endedAt: doc.endedAt ?? null,
  };
}
