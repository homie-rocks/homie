import { writeFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { workerCpu } from './worker-cpu.mjs';
import { editWorkload } from './edit-workload.mjs';
const stats = (a) => {
  a.sort((x, y) => x - y);
  return {
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.floor(a.length * 0.95)],
  };
};
const report = {
  cpu: cpus()[0].model,
  node: process.version,
  load: loadavg(),
  timing: 'user + system CPU ms',
  nodeRows: [],
};
for (const count of [100, 400, 1000])
  for (const edits of [false, true]) {
    const tick = editWorkload(count, edits);
    for (let i = 0; i < 30; i++) tick();
    const samples = [];
    for (let i = 0; i < 100; i++) {
      const before = process.cpuUsage();
      tick();
      const used = process.cpuUsage(before);
      samples.push((used.user + used.system) / 1000);
    }
    const row = { count, edits, ...stats(samples) };
    report.nodeRows.push(row);
    console.log(row);
  }
report.workerdRows = await workerCpu(
  `
  import { editWorkload } from './edit-workload.mjs';
  let tick;
  export default { fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === '/new') tick = editWorkload(Number(u.searchParams.get('count')), u.searchParams.get('edits') === 'true');
    if (u.pathname === '/tick') for (let i = 0; i < Number(u.searchParams.get('n') ?? 1); i++) tick();
    return Response.json({ok: true});
  }};
`,
  async (request, measure) => {
    const rows = [];
    for (const count of [100, 400, 1000])
      for (const edits of [false, true]) {
        await request('/new?count=' + count + '&edits=' + edits);
        await request('/tick?n=30');
        const samples = [];
        for (let i = 0; i < 7; i++) samples.push(await measure('/tick', 10));
        rows.push({ count, edits, ...stats(samples) });
      }
    return rows;
  },
);
await writeFile(
  new URL('edit-measurements.json', import.meta.url),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
