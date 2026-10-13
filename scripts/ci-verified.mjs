#!/usr/bin/env node
// Fail closed: names alone are insufficient; checks must belong to one successful CI run on this SHA.
import { pathToFileURL } from 'node:url';
export const gates = ['Packages (Node 22)', 'Packages (Node 24)', 'Plugin', 'Changelog', 'A studio on Linux, no GPU (two browsers finish a round)'];
export function verified(run, checks, sha) {
  return run.head_sha === sha && run.path === '.github/workflows/ci.yml' &&
    ['push', 'pull_request'].includes(run.event) && run.status === 'completed' && run.conclusion === 'success' &&
    gates.every(name => checks.some(c => c.name === name && c.head_sha === sha && c.app?.slug === 'github-actions' &&
      c.check_suite?.id === run.check_suite_id && c.status === 'completed' && c.conclusion === 'success'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = process.env.TARGET_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('TARGET_SHA must be a complete commit SHA');
  const base = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  async function get(path) {
    const r = await fetch(base + path, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`CI verification refused: GitHub API ${r.status} for ${path}`);
    return r.json();
  }
  const checks = [];
  for (let page = 1; ; page++) {
    const d = await get(`/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`);
    checks.push(...d.check_runs);
    if (d.check_runs.length < 100) break;
  }
  const runs = await get(`/actions/workflows/ci.yml/runs?head_sha=${sha}&status=success&per_page=100`);
  const run = runs.workflow_runs.find(r => verified(r, checks, sha));
  if (!run) throw new Error(`CI verification refused: no successful CI run with all five required Actions gates on exact commit ${sha}. Run CI on this commit first; no tests were bypassed and nothing was published.`);
  console.log(`Verified exact commit ${sha}: ${run.html_url} (all ${gates.length} CI gates successful).`);
}
