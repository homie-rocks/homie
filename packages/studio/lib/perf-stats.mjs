/**
 * WHETHER A CHANGE MADE A GAME FASTER, OR ONLY LOOKS LIKE IT (`homie-studio perf compare`).
 *
 * Two builds are measured in turns (before, after, after, before, ...), several runs each, and every run gives one
 * number per metric (a run's 95th-percentile frame time, say). A browser's numbers move from run to run on their own:
 * another app wakes up, a garbage collection lands in the window, the bots wander somewhere busier. So a difference
 * between two medians means nothing by itself. A change counts as better only when all three hold:
 *
 *   - it is unlikely to be chance: a permutation test on the runs' ranks (Mann-Whitney U, exact for the small run
 *     counts used here), one-sided, p < 0.05;
 *   - the 95% bootstrap interval of the change in medians stays on the better side of zero;
 *   - it is big enough to matter: at least `min` (3%) better at the median.
 *
 * A guard (another metric that must not get worse) is judged the same way, stricter (p < 0.01, at least 5% worse),
 * because a handful of guards checked at 0.05 would flag a regression by chance on most changes. A metric that never
 * varies (bytes of a build) has no noise to test: any change of at least 1% counts.
 *
 * PAIRS. A shared computer drifts: measured on an Apple M4 while other work ran, the main thread per frame rose from
 * 0.88 to 1.25 ms over five runs of the SAME build as the load average went from 4 to 7.6, host and replica together.
 * When the runs were taken side by side (`try` measures before, after, after, before, … and labels each neighbouring
 * pair), the test is on the pairs instead: each after-run against the before-run next to it, as a ratio, so a drift
 * that hits both cancels. Wilcoxon signed-rank, exact: with 6 pairs, p < 0.05 needs the after-run to win at least 5
 * of the 6 pairs (and lose only the closest one). The change is the median ratio; its interval a bootstrap over pairs.
 *
 * Everything here is lower-is-better (milliseconds, bytes, messages); nothing reads a clock or the network.
 */

/** The q-quantile (0..1) of numbers, by linear interpolation between order statistics. null for none. */
export function quantile(values, q) {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const at = (xs.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return xs[lo] + (xs[hi] - xs[lo]) * (at - lo);
}

export const median = (values) => quantile(values, 0.5);

/** A small summary of numbers: n, median, the middle half, min, max, and the spread as a share of the median. */
export function summarize(values) {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return { n: 0, median: null, q1: null, q3: null, min: null, max: null, spread: null };
  const m = median(xs);
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  return { n: xs.length, median: round(m), q1: round(q1), q3: round(q3), min: round(Math.min(...xs)), max: round(Math.max(...xs)), spread: m ? round((q3 - q1) / Math.abs(m), 4) : null };
}

export const round = (x, digits = 3) => (Number.isFinite(x) ? Number(x.toFixed(digits)) : null);

/** Midranks of a joined list (ties share the average of their ranks), 1-based. */
function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k][1]] = mid;
    i = j + 1;
  }
  return r;
}

/**
 * Mann-Whitney U as an exact permutation test on rank sums: every way of choosing which runs were "after" is equally
 * likely when the change did nothing, so p is the share of those choices whose "after" ranks are as low (`less`) or as
 * high (`greater`) as the ones measured. Exact up to 200,000 choices (10 + 10 runs is 184,756), the normal
 * approximation with a tie correction past that.
 */
export function rankTest(before, after) {
  const a = before.filter(Number.isFinite);
  const b = after.filter(Number.isFinite);
  const n1 = a.length;
  const n2 = b.length;
  if (!n1 || !n2) return { n1, n2, u: null, less: null, greater: null, twoSided: null, exact: false };
  const r = ranks([...a, ...b]);
  const observed = r.slice(n1).reduce((s, x) => s + x, 0);
  const u = observed - (n2 * (n2 + 1)) / 2;
  const total = binom(n1 + n2, n2);
  const eps = 1e-9;
  if (total <= 200_000) {
    let le = 0;
    let ge = 0;
    let all = 0;
    const pick = (start, left, sum) => {
      if (left === 0) { all++; if (sum <= observed + eps) le++; if (sum >= observed - eps) ge++; return; }
      for (let i = start; i <= r.length - left; i++) pick(i + 1, left - 1, sum + r[i]);
    };
    pick(0, n2, 0);
    const less = le / all;
    const greater = ge / all;
    return { n1, n2, u, less: round(less, 5), greater: round(greater, 5), twoSided: round(Math.min(1, 2 * Math.min(less, greater)), 5), exact: true };
  }
  const n = n1 + n2;
  const mean = (n2 * (n + 1)) / 2;
  const counts = new Map();
  for (const x of r) counts.set(x, (counts.get(x) ?? 0) + 1);
  const ties = [...counts.values()].reduce((s, t) => s + (t ** 3 - t), 0);
  const sd = Math.sqrt(((n1 * n2) / 12) * ((n + 1) - ties / (n * (n - 1))));
  const z = sd ? (observed - mean) / sd : 0;
  const less = normalCdf(z + 0.5 / (sd || 1));
  const greater = 1 - normalCdf(z - 0.5 / (sd || 1));
  return { n1, n2, u, less: round(less, 5), greater: round(greater, 5), twoSided: round(Math.min(1, 2 * Math.min(less, greater)), 5), exact: false };
}

function binom(n, k) {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return Math.round(c);
}

function normalCdf(z) {
  // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** A seeded random number generator (mulberry32): the same runs always give the same interval. */
export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The 95% percentile-bootstrap interval of the relative change in medians, (after - before) / before: resample each
 * side's runs with replacement 4,000 times. Seeded, so the same numbers give the same interval.
 */
export function bootstrapChange(before, after, { iterations = 4000, seed = 7 } = {}) {
  const a = before.filter(Number.isFinite);
  const b = after.filter(Number.isFinite);
  if (!a.length || !b.length) return null;
  const rnd = seeded(seed);
  const draw = (xs) => { const out = new Array(xs.length); for (let i = 0; i < xs.length; i++) out[i] = xs[Math.floor(rnd() * xs.length)]; return out; };
  const changes = [];
  for (let i = 0; i < iterations; i++) {
    const ma = median(draw(a));
    const mb = median(draw(b));
    if (ma) changes.push((mb - ma) / Math.abs(ma));
  }
  if (!changes.length) return null;
  return [round(quantile(changes, 0.025), 4), round(quantile(changes, 0.975), 4)];
}

/**
 * One metric, before against after (lower is better). Returns the medians, the change, p, the interval and a verdict:
 * `better`, `worse` or `same` (within the noise), with `why` in words. `min` is the smallest change that counts as
 * better (0.03 = 3%); `worseMin` and `worseAlpha` the stricter bar for calling it worse.
 */
export function judge(before, after, { min = 0.03, alpha = 0.05, worseMin = 0.05, worseAlpha = 0.01, unit = '' } = {}) {
  const a = before.filter(Number.isFinite);
  const b = after.filter(Number.isFinite);
  const sa = summarize(a);
  const sb = summarize(b);
  const base = { before: sa, after: sb, change: null, p: null, pWorse: null, ci: null, verdict: 'unknown', why: null };
  if (!a.length || !b.length) return { ...base, why: `not measured on both sides (${a.length} before, ${b.length} after)` };
  const change = sa.median ? (sb.median - sa.median) / Math.abs(sa.median) : (sb.median === sa.median ? 0 : null);
  const fixed = sa.min === sa.max && sb.min === sb.max;
  const pct = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  const say = (x) => `${round(x, 2)}${unit}`;
  if (change === null) return { ...base, change: null, why: 'the before median is 0, so a relative change has no meaning' };
  if (fixed) {
    // Nothing to test: the same number every run (a build's bytes). Any real difference is the change itself.
    const verdict = change <= -0.01 ? 'better' : change >= 0.01 ? 'worse' : 'same';
    return { ...base, change: round(change, 4), verdict, exact: true, why: `${say(sa.median)} → ${say(sb.median)} (${pct(change)}, the same every run)` };
  }
  const t = rankTest(a, b);
  const ci = bootstrapChange(a, b);
  const res = { ...base, change: round(change, 4), p: t.less, pWorse: t.greater, ci, n: [t.n1, t.n2] };
  const head = `${say(sa.median)} → ${say(sb.median)} (${pct(change)}; 95% interval ${ci ? `${pct(ci[0])} to ${pct(ci[1])}` : 'n/a'}; p = ${t.less} better, ${t.greater} worse; ${t.n1} + ${t.n2} runs)`;
  if (t.less < alpha && ci && ci[1] < 0 && change <= -min) return { ...res, verdict: 'better', why: head };
  if (t.greater < worseAlpha && ci && ci[0] > 0 && change >= worseMin) return { ...res, verdict: 'worse', why: head };
  const reasons = [];
  if (change > -min) reasons.push(`smaller than the ${Math.round(min * 100)}% that counts`);
  if (t.less >= alpha) reasons.push(`p ${t.less} is not under ${alpha}`);
  if (ci && ci[1] >= 0) reasons.push('the interval reaches zero');
  return { ...res, verdict: 'same', why: `${head}: within the noise (${reasons.join('; ') || 'not clearly either way'})` };
}

/**
 * Wilcoxon signed-rank test on paired differences (after - before, or their log ratios), exact for up to 20 pairs
 * (every sign assignment), the normal approximation past that. Zeros are dropped. `less`: p that the after side is
 * lower by chance; `greater`: higher.
 */
export function signedRankTest(diffs) {
  const d = diffs.filter((x) => Number.isFinite(x) && x !== 0);
  const n = d.length;
  if (!n) return { n: 0, wins: 0, less: 1, greater: 1, exact: true };
  const r = ranks(d.map(Math.abs));
  const wPlus = d.reduce((s, x, i) => s + (x > 0 ? r[i] : 0), 0);
  const wins = d.filter((x) => x < 0).length;
  const eps = 1e-9;
  if (n <= 20) {
    let le = 0;
    let ge = 0;
    const total = 2 ** n;
    for (let mask = 0; mask < total; mask++) {
      let w = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) w += r[i];
      if (w <= wPlus + eps) le++;
      if (w >= wPlus - eps) ge++;
    }
    return { n, wins, less: round(le / total, 5), greater: round(ge / total, 5), exact: true };
  }
  const mean = (n * (n + 1)) / 4;
  const sd = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24);
  return { n, wins, less: round(normalCdf((wPlus + 0.5 - mean) / sd), 5), greater: round(1 - normalCdf((wPlus - 0.5 - mean) / sd), 5), exact: false };
}

/**
 * One metric from runs taken in pairs (before[k] beside after[k]); lower is better. The same verdicts and bars as
 * judge(), on the pairs' ratios.
 */
export function judgePaired(before, after, { min = 0.03, alpha = 0.05, worseMin = 0.05, worseAlpha = 0.01, unit = '' } = {}) {
  const pairs = before.map((a, i) => [a, after[i]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0);
  const sa = summarize(pairs.map(([a]) => a));
  const sb = summarize(pairs.map(([, b]) => b));
  const base = { before: sa, after: sb, change: null, p: null, pWorse: null, ci: null, verdict: 'unknown', why: null, paired: true };
  if (pairs.length < 3) return { ...base, why: `too few pairs measured on both sides (${pairs.length})` };
  const logs = pairs.map(([a, b]) => Math.log(b / a));
  const pct = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
  const say = (x) => `${round(x, 2)}${unit}`;
  if (logs.every((x) => x === 0)) return { ...base, change: 0, p: 1, pWorse: 1, verdict: 'same', why: `${say(sa.median)} → ${say(sb.median)}: identical in every pair` };
  const change = Math.exp(median(logs)) - 1;
  const t = signedRankTest(logs);
  const rnd = seeded(11);
  const boots = [];
  for (let i = 0; i < 4000; i++) { const draw = logs.map(() => logs[Math.floor(rnd() * logs.length)]); boots.push(Math.exp(median(draw)) - 1); }
  const ci = [round(quantile(boots, 0.025), 4), round(quantile(boots, 0.975), 4)];
  const res = { ...base, change: round(change, 4), p: t.less, pWorse: t.greater, ci, n: [pairs.length, pairs.length], wins: t.wins };
  const head = `${say(sa.median)} → ${say(sb.median)} (${pct(change)} in the median pair; after was lower in ${t.wins} of ${pairs.length} pairs run side by side; 95% interval ${pct(ci[0])} to ${pct(ci[1])}; p = ${t.less} better, ${t.greater} worse)`;
  if (t.less < alpha && ci[1] < 0 && change <= -min) return { ...res, verdict: 'better', why: head };
  // Few pairs cannot reach p < 0.01 (6 pairs: 1/64 at best), so the guard's bar is then "worse in every pair".
  const wa = Math.max(worseAlpha, 1.5 / 2 ** pairs.length);
  if (t.greater < wa && ci[0] > 0 && change >= worseMin) return { ...res, verdict: 'worse', why: head };
  const reasons = [];
  if (change > -min) reasons.push(`smaller than the ${Math.round(min * 100)}% that counts`);
  if (t.less >= alpha) reasons.push(`p ${t.less} is not under ${alpha}`);
  if (ci[1] >= 0) reasons.push('the interval reaches zero');
  return { ...res, verdict: 'same', why: `${head}: within the noise (${reasons.join('; ') || 'not clearly either way'})` };
}
