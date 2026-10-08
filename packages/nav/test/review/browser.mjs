// Emit a self-contained page for a browser when process launch is unavailable.
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { withoutClock } from '../scenario.mjs';
const entry = fileURLToPath(new URL('.', import.meta.url));
const result = await build({
  stdin: {
    contents: `import {init,measure} from './comparison-scene.mjs';
import {withoutClock} from '../scenario.mjs';
globalThis.run=async()=>{const out=document.querySelector('pre');
try{const expected=${JSON.stringify(withoutClock())};
out.textContent='Exact core state: '+(withoutClock()===expected)+'\\n';
await init();
for(let repeat=0;
repeat<2;
repeat++)for(const engine of ['navcat','recast'])out.textContent+=JSON.stringify({repeat,...measure(engine)})+'\\n';
out.textContent+='FINISHED';
}catch(error){out.textContent+=error.stack;
}};
`,
    resolveDir: entry,
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
});
await writeFile(
  process.argv[2] ?? '/tmp/nav-comparison.html',
  `<!doctype html><title>Navigation runtime comparison</title><h1>Navigation runtime comparison</h1><pre style="white-space:pre-wrap">Running</pre>
<script>${result.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>

<script>run()</script>
`,
);
