// Explicit parity audit, outside the test inventory. Both Git refs must exist locally.
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const [baseline='c4fc93ba480549996869b4d6ca59d0c4a7a293ec',combined='runtime/split-parity']=process.argv.slice(2);
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trimEnd();
const differences={
 'docs/runtime-ci-evidence.md':'Part-specific evidence and limitations',
 'docs/runtime-owner-analytics.md':'Part-specific evidence and cleanup limitation',
 'docs/runtime-payment-delivery.md':'Queue/payment review scope and validation',
 'docs/runtime-request-performance.md':'Request evidence and its attribution',
 'docs/runtime-room-lifecycle.md':'Draft lifecycle status and missing proof',
 'docs/runtime-split-parity.md':'Split parity audit and reproduction instructions',
 'scripts/verify-runtime-split.mjs':'Reproducible parity/schema verification',
 'packages/studio/lib/scaffold.mjs':'Register separate feature migrations',
 'packages/studio/test/office.test.mjs':'Expect the separately owned migrations',
 'packages/studio/test/owner-analytics.test.mjs':'Move the two analytics regressions to the independent PR',
 'packages/studio/test/round-two.test.mjs':'Remove those two relocated regressions',
 'packages/studio/worker/analytics.mjs':'Export the analytics migration text and filename',
 'packages/studio/worker/build-id.mjs':'Recompute identity after migration exports change runtime bytes',
 'packages/studio/worker/operational-schema.mjs':'Separate payment and room-summary migration ownership',
 'template/site/migrations/0034_runtime_indexes.sql':'Retain only the MCP expiry index',
 'template/site/migrations/0035_payment_delivery.sql':'Stripe intake and shop-event retention indexes from original 0034',
 'template/site/migrations/0036_lobby_summaries.sql':'Room summaries from original 0034',
 'template/site/migrations/0037_owner_analytics.sql':'Analytics watermarks from original 0034',
};
const paths=git('diff','--name-only',baseline,combined).split('\n').filter(Boolean);
const unexpected=paths.filter(p=>!Object.hasOwn(differences,p));
if(unexpected.length)throw Error('Unreviewed differences: '+unexpected.join(', '));
const migrations=ref=>git('ls-tree','-r','--name-only',ref,'template/site/migrations').split('\n').filter(p=>p.endsWith('.sql')).sort();
function schema(ref){const db=new DatabaseSync(':memory:');try{for(const path of migrations(ref))db.exec(git('show',`${ref}:${path}`));return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();}finally{db.close();}}
const before=schema(baseline),after=schema(combined);
if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Final SQLite schemas differ');
console.log(JSON.stringify({baseline:{commit:git('rev-parse',baseline),tree:git('rev-parse',baseline+'^{tree}')},combined:{commit:git('rev-parse',combined),tree:git('rev-parse',combined+'^{tree}')},schemaEqual:true,schemaObjects:before.length,differences:paths.map(path=>({path,reason:differences[path]}))},null,2));
